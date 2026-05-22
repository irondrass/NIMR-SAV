async function signInSupabaseFromForm(event) {
  event.preventDefault();
  const client = getSupabaseClient();
  if (!client) {
    refreshSupabasePanel();
    return;
  }
  const form = event.currentTarget;
  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;
  if (!email || !password) {
    setSupabaseStatus("Email et mot de passe requis.", "error");
    return;
  }
  setSupabaseStatus("Connexion en cours...");
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    console.error("Connexion Supabase impossible", error);
    setSupabaseStatus(`Connexion refusée : ${error.message}`, "error");
    notifyUser("Connexion Supabase impossible. Vérifiez email/mot de passe.", "error");
    return;
  }
  form.elements.password.value = "";
  await refreshSupabasePanel();
  startSupabaseLiveSync();
  await pullLatestSupabaseBackup("connexion");
  scheduleAutoSupabaseBackup("connexion");
  notifyUser("Connexion Supabase réussie. Synchronisation atelier multi-PC activée.", "success");
}

async function signOutSupabase() {
  const client = getSupabaseClient();
  if (!client) return;
  stopSupabaseLiveSync();
  await client.auth.signOut();
  await refreshSupabasePanel();
  notifyUser("Déconnecté de Supabase.", "success");
}

async function testSupabaseConnection() {
  const client = getSupabaseClient();
  if (!client) {
    refreshSupabasePanel();
    return;
  }
  setSupabaseStatus("Test de connexion...");
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData?.user) {
    setSupabaseStatus("Connexion requise avant le test.", "warn");
    setSupabaseDetails("Connectez-vous d'abord avec email + mot de passe.");
    return;
  }

  const backupTable = getSupabaseConfig().backupTable || "cloud_backups";
  const backupCheck = await client.from(backupTable).select("id").limit(1);
  if (backupCheck.error) {
    console.error("Test Supabase impossible", backupCheck.error);
    setSupabaseStatus(`Erreur Supabase : ${backupCheck.error.message}`, "error");
    setSupabaseDetails("Exécutez le nouveau supabase-schema.sql dans SQL Editor, puis réessayez.");
    return;
  }

  const orderCheck = await client.from("repair_orders").select("id").limit(1);
  if (orderCheck.error) {
    console.warn("Tables métier Supabase indisponibles", orderCheck.error);
    setSupabaseStatus("Connexion OK, mais tables métier absentes.", "warn");
    setSupabaseDetails("La sauvegarde JSON fonctionne, mais repair_orders est inaccessible. Exécutez supabase-schema.sql v22.10.");
    return;
  }

  const settingsCheck = await client.from("app_settings").select("id").limit(1);
  if (settingsCheck.error) {
    console.warn("Table app_settings indisponible", settingsCheck.error);
    setSupabaseStatus("Connexion OK, mais réglages structurés absents.", "warn");
    setSupabaseDetails("Exécutez supabase-schema.sql v22.10 pour créer app_settings et activer la synchronisation live, puis relancez le test.");
    return;
  }

  const claimCheck = await client.from("repair_claims").select("id").limit(1);
  if (claimCheck.error) {
    console.warn("Table repair_claims indisponible", claimCheck.error);
    setSupabaseStatus("Connexion OK, cache Supabase à rafraîchir.", "warn");
    setSupabaseDetails("La table vient probablement d’être créée. Exécutez le SQL v22.10, puis patientez 30 secondes et relancez le contrôle.");
    return;
  }

  setSupabaseStatus("Connexion Supabase OK.", "ok");
  setSupabaseDetails("cloud_backups, repair_orders, repair_claims et app_settings sont accessibles.");
}

async function buildCloudBackupPayload() {
  const payload = await buildBackupPayload();
  return {
    ...payload,
    syncedAt: new Date().toISOString(),
  };
}

async function upsertCloudBackupRow(client, tableName, row) {
  const scopedRow = withWorkshopId(row);
  let { error } = await client.from(tableName).upsert(scopedRow, { onConflict: "workshop_id,backup_key" });
  if (error && isWorkshopSchemaUnavailable(error)) {
    const { workshop_id, ...legacyRow } = scopedRow;
    ({ error } = await client.from(tableName).upsert(legacyRow, { onConflict: "backup_key" }));
  }
  if (error) throw error;
}

async function selectCloudBackupRow(client, tableName, backupKey, columns) {
  let { data, error } = await client
    .from(tableName)
    .select(columns)
    .eq("workshop_id", getSupabaseWorkshopId())
    .eq("backup_key", backupKey)
    .maybeSingle();
  if (error && isWorkshopSchemaUnavailable(error)) {
    ({ data, error } = await client
      .from(tableName)
      .select(columns)
      .eq("backup_key", backupKey)
      .maybeSingle());
  }
  if (error) throw error;
  return data || null;
}

function uniqueByLocalId(rows) {
  const map = new Map();
  rows.forEach((row) => {
    if (row?.local_id) map.set(row.local_id, row);
  });
  return [...map.values()];
}

function safeIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeSyncToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function caseSyncLocalId(item) {
  const orderNumber = normalizeSyncToken(item.orNavNumber);
  if (orderNumber) return `case-or:${orderNumber}`;
  const vin = normalizeSyncToken(item.vin);
  if (vin) return `case-vin:${vin}`;
  const plate = normalizeSyncToken(item.plate);
  const client = normalizeSyncToken(item.clientName);
  if (plate || client) return `case:${plate || "no-plate"}:${client || "no-client"}`;
  return item.id;
}

function caseClientLocalId(item) {
  return `client:${caseSyncLocalId(item)}`;
}

function caseVehicleLocalId(item) {
  return `vehicle:${caseSyncLocalId(item)}`;
}

function makeMapByLocalId(rows) {
  return new Map((rows || []).filter((row) => row.local_id && row.id).map((row) => [row.local_id, row.id]));
}

function buildWorkshopSettingsPayload(localState) {
  return {
    schemaVersion: 1,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: { ...(localState.settings || {}) },
    workHours: cloneWorkHours(localState.workHours || DEFAULT_WORK_HOURS),
    holidays: Array.isArray(localState.holidays) ? localState.holidays.map((holiday) => ({ ...holiday })) : [],
    resources: Array.isArray(localState.resources) ? localState.resources.map((resource) => ({ ...resource })) : [],
    planningDate: localState.planningDate || todayKey(new Date()),
  };
}

async function syncWorkshopSettingsToSupabase(client, localState, user) {
  const payload = buildWorkshopSettingsPayload(localState);
  const now = new Date().toISOString();
  const row = withWorkshopId({
    setting_key: "workshop_settings",
    value: payload,
    description: "Réglages atelier: ressources, horaires, jours fériés, Fast Lane et paramètres planning",
    updated_by: user?.id || null,
    updated_at: now,
  });
  let { error } = await client.from("app_settings").upsert(row, { onConflict: "workshop_id,setting_key" });
  if (error && isWorkshopSchemaUnavailable(error)) {
    const { workshop_id, ...legacyRow } = row;
    ({ error } = await client.from("app_settings").upsert(legacyRow, { onConflict: "setting_key" }));
  }
  if (error) throw new Error(`app_settings: ${error.message}`);
  return {
    settings: Object.keys(payload.settings || {}).length,
    workHoursDays: Object.keys(payload.workHours || {}).length,
    holidays: payload.holidays.length,
    resources: payload.resources.length,
  };
}

function applyWorkshopSettingsToState(settingsPayload) {
  if (!settingsPayload || typeof settingsPayload !== "object") return false;
  const nextState = normalizeState({
    ...state,
    settings: {
      ...(state.settings || {}),
      ...(settingsPayload.settings || {}),
    },
    workHours: settingsPayload.workHours || state.workHours,
    holidays: Array.isArray(settingsPayload.holidays) ? settingsPayload.holidays : state.holidays,
    resources: Array.isArray(settingsPayload.resources) ? settingsPayload.resources : state.resources,
    planningDate: settingsPayload.planningDate || state.planningDate,
  });
  state.settings = nextState.settings;
  state.workHours = nextState.workHours;
  state.holidays = nextState.holidays;
  state.resources = nextState.resources;
  state.bookings = normalizeBookings(state.bookings, state.resources);
  state.planningDate = nextState.planningDate;
  return true;
}

async function restoreWorkshopSettingsFromSupabase(client) {
  let { data, error } = await client
    .from("app_settings")
    .select("value, updated_at")
    .eq("workshop_id", getSupabaseWorkshopId())
    .eq("setting_key", "workshop_settings")
    .maybeSingle();
  if (error && isWorkshopSchemaUnavailable(error)) {
    ({ data, error } = await client
      .from("app_settings")
      .select("value, updated_at")
      .eq("setting_key", "workshop_settings")
      .maybeSingle());
  }
  if (error) throw new Error(`app_settings: ${error.message}`);
  if (!data?.value) return null;
  return { value: data.value, updatedAt: data.updated_at };
}

function isSchemaCacheTableError(error) {
  const message = String(error?.message || error || "");
  return /schema cache|Could not find the table|relation .* does not exist|does not exist/i.test(message);
}

function isWorkshopSchemaUnavailable(error) {
  const message = String(error?.message || error || "");
  return /workshop_id|workshop_id,local_id|workshop_id,backup_key|workshop_id,setting_key|no unique or exclusion constraint|column .* does not exist/i.test(message);
}

function withWorkshopId(row) {
  return { ...row, workshop_id: getSupabaseWorkshopId() };
}

async function safeBusinessSyncStep(label, callback) {
  try {
    return { skipped: false, value: await callback() };
  } catch (error) {
    if (isSchemaCacheTableError(error)) {
      console.warn(`${label} ignoré temporairement: cache schéma Supabase pas encore rafraîchi`, error);
      return { skipped: true, error };
    }
    throw error;
  }
}

async function upsertAndMap(client, table, rows) {
  const cleanRows = uniqueByLocalId(rows).filter((row) => row.local_id);
  if (!cleanRows.length) return new Map();
  let { data, error } = await client
    .from(table)
    .upsert(cleanRows.map(withWorkshopId), { onConflict: "workshop_id,local_id" })
    .select("id, local_id");
  if (error && isWorkshopSchemaUnavailable(error)) {
    ({ data, error } = await client.from(table).upsert(cleanRows, { onConflict: "local_id" }).select("id, local_id"));
  }
  if (error) {
    const duplicateOrderNumber = table === "repair_orders" && String(error.message || "").includes("repair_orders_order_number_key");
    if (duplicateOrderNumber) {
      throw new Error("repair_orders: contrainte unique restante sur order_number. Dans Supabase > SQL Editor, executez le supabase-schema.sql v22.10, puis relancez la sauvegarde.");
    }
    throw new Error(`${table}: ${error.message}`);
  }
  return makeMapByLocalId(data);
}

function buildRepairStatus(item) {
  const flags = item.flags || {};
  if (flags.delivered) return "delivered";
  if (flags.qualityApproved) return "quality_approved";
  if (flags.workCompleted) return "work_completed";
  if (flags.workStarted) return "in_progress";
  if (flags.received) return "received";
  if (flags.clientApproved) return "client_approved";
  if (flags.expertApproved) return "expert_approved";
  if (item.appointmentStatus === "scheduled") return "appointment_scheduled";
  return "new";
}

function getAppointmentIso(item) {
  if (!item.appointment) return null;
  if (typeof item.appointment === "string") return safeIso(item.appointment);
  return safeIso(item.appointment.start || item.appointment.date || item.appointment.at);
}

function getHistoryIso(item, eventType) {
  const found = (item.history || []).find((entry) => entry.type === eventType);
  return safeIso(found?.at);
}

function splitVehicleLabel(label = "") {
  const parts = String(label).trim().split(/\s+/).filter(Boolean);
  return {
    brand: parts[0] || null,
    model: parts.slice(1).join(" ") || null,
  };
}

function stepStatus(item, key) {
  const flags = item.flags || {};
  if (key === "quality" && flags.qualityApproved) return "done";
  if (flags.delivered) return "done";
  if (flags.workCompleted) return "done";
  if (flags.workStarted) return "in_progress";
  return "todo";
}

async function syncBusinessTablesToSupabase(payload, user) {
  const client = getSupabaseClient();
  const localState = normalizeState(payload.state);
  const now = new Date().toISOString();

  const clientRows = localState.cases.map((item) => ({
    local_id: caseClientLocalId(item),
    full_name: item.clientName || "Client",
    phone: item.phone || null,
    email: null,
    address: null,
    updated_at: now,
  }));
  const clientMap = await upsertAndMap(client, "clients", clientRows);

  const vehicleRows = localState.cases.map((item) => {
    const parsed = splitVehicleLabel(item.vehicle);
    return {
      local_id: caseVehicleLocalId(item),
      client_id: clientMap.get(caseClientLocalId(item)) || null,
      vin: item.vin || null,
      registration: item.plate || null,
      brand: parsed.brand,
      model: parsed.model,
      mileage: item.mileage ? Number(String(item.mileage).replace(/\D/g, "")) || null : null,
      color: item.color || null,
      energy: null,
      updated_at: now,
    };
  });
  const vehicleMap = await upsertAndMap(client, "vehicles", vehicleRows);

  const resourceRows = localState.resources.map((resource) => ({
    local_id: resource.id,
    name: resource.name || "Ressource",
    type: resource.role || "atelier",
    capacity: 1,
    active: resource.active !== false,
  }));
  const resourceMap = await upsertAndMap(client, "planning_resources", resourceRows);
  const settingsStats = await syncWorkshopSettingsToSupabase(client, localState, user);

  const orderRows = localState.cases.map((item) => ({
    local_id: caseSyncLocalId(item),
    order_number: item.orNavNumber || item.id,
    client_id: clientMap.get(caseClientLocalId(item)) || null,
    vehicle_id: vehicleMap.get(caseVehicleLocalId(item)) || null,
    status: buildRepairStatus(item),
    expert_agreement: Boolean(item.flags?.expertApproved || item.expertEstimate?.confirmed),
    client_agreement: Boolean(item.flags?.clientApproved),
    reception_planned_at: getAppointmentIso(item),
    reception_done_at: getHistoryIso(item, "vehicle.received"),
    delivery_planned_at: null,
    delivery_done_at: getHistoryIso(item, "vehicle.delivered"),
    estimated_amount: null,
    customer_balance: null,
    notes: [item.damageNotes, item.insurance ? `Assurance: ${item.insurance}` : "", item.expertName ? `Expert: ${item.expertName}` : ""].filter(Boolean).join("\n"),
    updated_at: now,
  }));
  const orderMap = await upsertAndMap(client, "repair_orders", orderRows);

  const stepRows = [];
  localState.cases.forEach((item) => {
    const orderId = orderMap.get(caseSyncLocalId(item));
    if (!orderId) return;
    DURATIONS.forEach(([key, label]) => {
      stepRows.push({
        local_id: `${caseSyncLocalId(item)}:${key}`,
        repair_order_id: orderId,
        step_key: key,
        label,
        status: stepStatus(item, key),
        planned_hours: Number(item.durations?.[key] || 0),
        actual_hours: 0,
        started_at: item.flags?.workStarted ? getHistoryIso(item, "work.started") : null,
        completed_at: key === "quality" && item.flags?.qualityApproved ? getHistoryIso(item, "quality.approved") : item.flags?.workCompleted ? getHistoryIso(item, "work.completed") : null,
        updated_at: now,
      });
    });
  });
  await upsertAndMap(client, "repair_steps", stepRows);

  const bookingRows = [];
  localState.bookings.forEach((booking) => {
    const bookingCase = localState.cases.find((candidate) => candidate.id === booking.caseId);
    const orderId = bookingCase ? orderMap.get(caseSyncLocalId(bookingCase)) : orderMap.get(booking.caseId);
    if (!orderId) return;
    booking.segments.forEach((segment, index) => {
      const startAt = safeIso(segment.start);
      const endAt = safeIso(segment.end);
      if (!startAt || !endAt) return;
      const firstResourceId = booking.resourceIds?.[0];
      bookingRows.push({
        local_id: `${booking.caseId || booking.id}:${booking.key || "step"}:${index}:${startAt}`,
        repair_order_id: orderId,
        resource_id: firstResourceId ? resourceMap.get(firstResourceId) || null : null,
        title: booking.title || getDurationLabel(booking.key),
        start_at: startAt,
        end_at: endAt,
        status: booking.temporary ? "temporary" : "planned",
        updated_at: now,
      });
    });
  });
  await upsertAndMap(client, "planning_slots", bookingRows);


  const claimRows = [];
  const claimLineRows = [];
  localState.cases.forEach((item) => {
    const orderId = orderMap.get(caseSyncLocalId(item));
    if (!orderId) return;
    (item.claims || []).forEach((claim, index) => {
      const claimLocalId = `${caseSyncLocalId(item)}:${claim.id || claim.number || index}`;
      claimRows.push({
        local_id: claimLocalId,
        repair_order_id: orderId,
        number: claim.number || `OT-${String(index + 1).padStart(3, '0')}`,
        title: claim.title || null,
        vehicle_area: claim.vehicleArea || null,
        type: claim.type || 'assurance',
        status: claim.status || 'draft',
        include_in_planning: claim.includeInPlanning !== false,
        expert_approved: Boolean(claim.expertApproved),
        client_approved: Boolean(claim.clientApproved),
        estimate_number: claim.estimateNumber || claim.estimate?.reference || null,
        or_number: claim.orNumber || null,
        amount: Number(claim.amount || 0) || null,
        source_file: claim.estimate?.sourceFile || null,
        created_at: safeIso(claim.createdAt) || now,
        updated_at: safeIso(claim.updatedAt) || now,
      });
      (claim.estimate?.lines || []).forEach((line) => {
        claimLineRows.push({
          local_id: `${claimLocalId}:${line.id}`,
          claim_local_id: claimLocalId,
          phase: line.phase || 'body',
          operation: line.operation || null,
          labor_hours: Number(line.laborHours || 0),
          raw_text: line.rawText || null,
          created_at: now,
          updated_at: now,
        });
      });
    });
  });
  let claimMap = new Map();
  let claimsSkipped = false;
  const claimSync = await safeBusinessSyncStep("repair_claims", () => upsertAndMap(client, "repair_claims", claimRows));
  if (claimSync.skipped) {
    claimsSkipped = true;
  } else {
    claimMap = claimSync.value || new Map();
    const resolvedClaimLineRows = claimLineRows
      .map((row) => {
        const { claim_local_id, ...rest } = row;
        return { ...rest, claim_id: claimMap.get(claim_local_id) || null };
      })
      .filter((row) => row.claim_id);
    const claimLineSync = await safeBusinessSyncStep("repair_claim_labor_lines", () => upsertAndMap(client, "repair_claim_labor_lines", resolvedClaimLineRows));
    if (claimLineSync.skipped) claimsSkipped = true;
  }

  const supplementRows = [];
  const supplementLineRows = [];
  localState.cases.forEach((item) => {
    const orderId = orderMap.get(caseSyncLocalId(item));
    if (!orderId) return;
    (item.supplements || []).forEach((supplement) => {
      const supplementLocalId = `${caseSyncLocalId(item)}:${supplement.id}`;
      supplementRows.push({
        local_id: supplementLocalId,
        repair_order_id: orderId,
        claim_id: claimMap.get(`${caseSyncLocalId(item)}:${supplement.claimId}`) || null,
        number: supplement.number || null,
        title: supplement.title || 'Réparation complémentaire',
        reason: supplement.reason || null,
        vehicle_area: supplement.vehicleArea || null,
        status: supplement.status || 'draft',
        expert_approved: Boolean(supplement.expertApproved),
        client_approved: Boolean(supplement.clientApproved),
        integrated: Boolean(supplement.integrated),
        integrated_at: safeIso(supplement.integratedAt),
        parts: supplement.parts || [],
        created_at: safeIso(supplement.createdAt) || now,
        updated_at: safeIso(supplement.updatedAt) || now,
      });
      (supplement.laborLines || []).forEach((line) => {
        supplementLineRows.push({
          local_id: `${supplementLocalId}:${line.id}`,
          supplement_local_id: supplementLocalId,
          phase: line.phase || 'body',
          operation: line.operation || null,
          labor_hours: Number(line.laborHours || 0),
          created_at: now,
          updated_at: now,
        });
      });
    });
  });
  let supplementMap = new Map();
  let supplementsSkipped = false;
  const supplementSync = await safeBusinessSyncStep("repair_supplements", () => upsertAndMap(client, "repair_supplements", supplementRows));
  if (supplementSync.skipped) supplementsSkipped = true;
  else supplementMap = supplementSync.value || new Map();
  const resolvedSupplementLineRows = supplementLineRows
    .map((row) => {
      const { supplement_local_id, ...rest } = row;
      return { ...rest, supplement_id: supplementMap.get(supplement_local_id) || null };
    })
    .filter((row) => row.supplement_id);
  const supplementLineSync = await safeBusinessSyncStep("repair_supplement_lines", () => upsertAndMap(client, "repair_supplement_lines", resolvedSupplementLineRows));
  if (supplementLineSync.skipped) supplementsSkipped = true;

  const photoRows = (payload.photos || []).map((photo) => ({
    local_id: photo.id,
    repair_order_id: (() => {
      const photoCase = localState.cases.find((candidate) => candidate.id === photo.caseId);
      return photoCase ? orderMap.get(caseSyncLocalId(photoCase)) : orderMap.get(photo.caseId);
    })(),
    step_key: photo.category || null,
    storage_bucket: "local-backup",
    storage_path: `local/${photo.caseId || "unknown"}/${photo.id || photo.name || "photo"}`,
    filename: photo.name || null,
    mime_type: photo.type || null,
    size_bytes: Number(photo.size || 0) || null,
  })).filter((row) => row.repair_order_id);
  await upsertAndMap(client, "photos", photoRows);

  const auditRows = [];
  localState.cases.forEach((item) => {
    const orderId = orderMap.get(caseSyncLocalId(item));
    if (!orderId) return;
    (item.history || []).forEach((entry) => {
      auditRows.push({
        local_id: entry.id || `${caseSyncLocalId(item)}:${entry.type}:${entry.at}`,
        repair_order_id: orderId,
        action: entry.label || entry.type || "Action dossier",
        entity_type: "repair_order",
        entity_id: orderId,
        before_data: null,
        after_data: {
          type: entry.type || null,
          details: entry.details || null,
          user: entry.user || null,
          at: entry.at || null,
        },
        created_at: safeIso(entry.at) || now,
      });
    });
  });
  if (auditRows.length) {
    // v21.11: audit_logs peut provenir d'anciennes bases sans contrainte unique utilisable.
    // On tente d'abord l'upsert; si Supabase refuse ON CONFLICT, on insere uniquement les lignes manquantes.
    const uniqueAuditRows = uniqueByLocalId(auditRows);
    let { error } = await client.from("audit_logs").upsert(uniqueAuditRows.map(withWorkshopId), { onConflict: "workshop_id,local_id" });
    if (error && isWorkshopSchemaUnavailable(error)) {
      ({ error } = await client.from("audit_logs").upsert(uniqueAuditRows, { onConflict: "local_id" }));
    }
    if (error) {
      if (!/ON CONFLICT|unique or exclusion constraint/i.test(error.message || "")) {
        throw new Error(`audit_logs: ${error.message}`);
      }
      let { data: existing, error: readError } = await client
        .from("audit_logs")
        .select("local_id")
        .eq("workshop_id", getSupabaseWorkshopId())
        .in("local_id", uniqueAuditRows.map((row) => row.local_id).filter(Boolean));
      if (readError && isWorkshopSchemaUnavailable(readError)) {
        ({ data: existing, error: readError } = await client
          .from("audit_logs")
          .select("local_id")
          .in("local_id", uniqueAuditRows.map((row) => row.local_id).filter(Boolean)));
      }
      if (readError) throw new Error(`audit_logs: ${readError.message}`);
      const existingIds = new Set((existing || []).map((row) => row.local_id));
      const missingRows = uniqueAuditRows.filter((row) => row.local_id && !existingIds.has(row.local_id));
      if (missingRows.length) {
        let { error: insertError } = await client.from("audit_logs").insert(missingRows.map(withWorkshopId));
        if (insertError && isWorkshopSchemaUnavailable(insertError)) {
          ({ error: insertError } = await client.from("audit_logs").insert(missingRows));
        }
        if (insertError) throw new Error(`audit_logs: ${insertError.message}`);
      }
    }
  }

  return {
    clients: clientRows.length,
    vehicles: vehicleRows.length,
    repairOrders: orderRows.length,
    repairSteps: stepRows.length,
    resources: resourceRows.length,
    settings: settingsStats.settings,
    workHoursDays: settingsStats.workHoursDays,
    holidays: settingsStats.holidays,
    planningSlots: bookingRows.length,
    claims: claimRows.length,
    claimLines: claimLineRows.length,
    supplements: supplementRows.length,
    supplementLines: supplementLineRows.length,
    photos: photoRows.length,
    auditLogs: auditRows.length,
    claimsSkipped,
    supplementsSkipped,
  };
}

async function saveLocalToSupabase() {
  const client = getSupabaseClient();
  if (!client) {
    refreshSupabasePanel();
    return;
  }
  const user = await getSupabaseUser();
  if (!user) {
    setSupabaseStatus("Connectez-vous avant de sauvegarder.", "warn");
    return;
  }
  const confirmed = await showConfirmModal("Sauvegarder les données locales actuelles vers Supabase ? Une copie JSON locale sera téléchargée avant l'envoi.");
  if (!confirmed) return;

  try {
    setSupabaseStatus("Préparation sauvegarde locale...");
    const payload = await buildCloudBackupPayload();
    downloadJson(payload, `nimr-carrosserie-avant-cloud-${todayKey(new Date())}.json`);
    const tableName = getSupabaseConfig().backupTable || "cloud_backups";
    const backupKey = getSupabaseConfig().backupKey || "nimr-carrosserie-main";
    setSupabaseStatus("Envoi sauvegarde complète vers Supabase...");
    const updatedAt = new Date().toISOString();
    await upsertCloudBackupRow(client, tableName, {
      backup_key: backupKey,
      app_version: APP_VERSION,
      state: payload.state,
      photos: payload.photos,
      cases_count: payload.state.cases.length,
      photos_count: payload.photos.length,
      updated_by: user.id,
      updated_at: updatedAt,
    });
    lastKnownCloudUpdatedAt = new Date(updatedAt).getTime();

    setSupabaseStatus("Remplissage des tables métier...");
    const stats = await syncBusinessTablesToSupabase(payload, user);

    setSupabaseStatus("Sauvegarde Supabase terminée.", "ok");
    setSupabaseDetails(`${stats.repairOrders} dossier(s), ${stats.clients} client(s), ${stats.vehicles} véhicule(s), ${stats.repairSteps} étape(s), ${stats.resources} ressource(s), ${stats.holidays} jour(s) férié(s), ${stats.workHoursDays} jour(s) horaire(s), ${stats.planningSlots} créneau(x), ${stats.claims || 0} ordre(s), ${stats.supplements || 0} complément(s), ${stats.photos} photo(s) synchronisé(s). Réglages enregistrés dans app_settings.`);
    notifyUser("Sauvegarde envoyée vers Supabase, réglages atelier inclus.", "success");
  } catch (error) {
    console.error("Sauvegarde Supabase impossible", error);
    setSupabaseStatus(`Sauvegarde impossible : ${error.message}`, "error");
    notifyUser(error.message || "Sauvegarde Supabase impossible.", "error");
  }
}

async function restoreLocalFromSupabase() {
  const client = getSupabaseClient();
  if (!client) {
    refreshSupabasePanel();
    return;
  }
  const user = await getSupabaseUser();
  if (!user) {
    setSupabaseStatus("Connectez-vous avant de restaurer.", "warn");
    return;
  }
  const confirmed = await showConfirmModal("Restaurer les données depuis Supabase ? Une sauvegarde JSON locale sera téléchargée avant remplacement.<br><br>Êtes-vous sûr de vouloir continuer ?");
  if (!confirmed) return;

  try {
    const tableName = getSupabaseConfig().backupTable || "cloud_backups";
    const backupKey = getSupabaseConfig().backupKey || "nimr-carrosserie-main";
    setSupabaseStatus("Lecture sauvegarde Supabase...");
    const data = await selectCloudBackupRow(client, tableName, backupKey, "state, photos, app_version, updated_at, cases_count, photos_count");
    if (!data?.state) {
      setSupabaseStatus("Aucune sauvegarde Supabase trouvée.", "warn");
      setSupabaseDetails("Faites d'abord une sauvegarde local → Supabase.");
      return;
    }

    const safetyPayload = await buildBackupPayload();
    downloadJson(safetyPayload, `nimr-carrosserie-avant-restauration-cloud-${todayKey(new Date())}.json`);

    state = normalizeState(data.state);
    let settingsRestored = false;
    try {
      const settingsBackup = await restoreWorkshopSettingsFromSupabase(client);
      settingsRestored = applyWorkshopSettingsToState(settingsBackup?.value);
    } catch (settingsError) {
      console.warn("Restauration app_settings impossible, utilisation de cloud_backups uniquement", settingsError);
    }
    activeCaseId = state.cases[0]?.id ?? null;
    activeCaseDetailTab = "resume";
    generatedProposals = {};
    await clearPhotoStore();
    const restoredPhotos = await restorePhotoRecords(Array.isArray(data.photos) ? data.photos : []);
    lastKnownCloudUpdatedAt = new Date(data.updated_at || 0).getTime() || lastKnownCloudUpdatedAt;
    saveState({ skipCloud: true });
    render();
    setSupabaseStatus("Restauration Supabase terminée.", "ok");
    setSupabaseDetails(`${state.cases.length} dossier(s), ${restoredPhotos} photo(s) restauré(s). Réglages structurés ${settingsRestored ? "restaurés depuis app_settings" : "restaurés depuis cloud_backups"}. Dernière sauvegarde cloud : ${data.updated_at || "date inconnue"}.`);
    notifyUser("Données et réglages restaurés depuis Supabase.", "success");
  } catch (error) {
    console.error("Restauration Supabase impossible", error);
    setSupabaseStatus(`Restauration impossible : ${error.message}`, "error");
    notifyUser(error.message || "Restauration Supabase impossible.", "error");
  }
}

let autoSupabaseBackupTimer = null;
let autoSupabaseBackupRunning = false;
let lastAutoSupabaseBackupAt = 0;
let lastKnownCloudUpdatedAt = 0;
let supabaseLiveSyncChannel = null;
let supabaseLivePullTimer = null;
let applyingRemoteSupabaseState = false;
const SUPABASE_LIVE_PULL_INTERVAL_MS = 15000;

function shouldAutoBackupToSupabase() {
  return Boolean(!applyingRemoteSupabaseState && getSupabaseClient && getSupabaseClient() && navigator.onLine !== false);
}

function scheduleAutoSupabaseBackup(reason = "autosave") {
  if (!shouldAutoBackupToSupabase()) return;
  if (applyingRemoteSupabaseState) return;
  window.clearTimeout(autoSupabaseBackupTimer);
  autoSupabaseBackupTimer = window.setTimeout(() => autoBackupToSupabase(reason), AUTOSAVE_CLOUD_DEBOUNCE_MS);
}

async function autoBackupToSupabase(reason = "autosave") {
  if (autoSupabaseBackupRunning || !shouldAutoBackupToSupabase()) return;
  const now = Date.now();
  if (now - lastAutoSupabaseBackupAt < 15000) return;
  autoSupabaseBackupRunning = true;
  try {
    const client = getSupabaseClient();
    const user = await getSupabaseUser();
    if (!client || !user) return;
    const payload = await buildCloudBackupPayload();
    const tableName = getSupabaseConfig().backupTable || "cloud_backups";
    const backupKey = getSupabaseConfig().backupKey || "nimr-carrosserie-main";
    const updatedAt = new Date().toISOString();
    await upsertCloudBackupRow(client, tableName, {
      backup_key: backupKey,
      app_version: APP_VERSION,
      state: payload.state,
      photos: payload.photos,
      cases_count: payload.state.cases.length,
      photos_count: payload.photos.length,
      updated_by: user.id,
      updated_at: updatedAt,
    });
    const stats = await syncBusinessTablesToSupabase(payload, user);
    lastAutoSupabaseBackupAt = Date.now();
    lastKnownCloudUpdatedAt = new Date(updatedAt).getTime();
    localStorage.setItem(`${STORAGE_KEY}:last-cloud-autosave`, new Date().toISOString());
    localStorage.removeItem(`${STORAGE_KEY}:last-cloud-autosave-error`);
    if (typeof setSupabaseDetails === "function") {
      const partial = stats.claimsSkipped || stats.supplementsSkipped ? " · tables récemment créées: cache Supabase en rafraîchissement, données JSON cloud OK" : "";
      setSupabaseDetails(`Sauvegarde automatique cloud OK (${reason}) : ${new Date().toLocaleTimeString()}${partial}`);
    }
  } catch (error) {
    console.warn("Sauvegarde automatique Supabase impossible", error);
    localStorage.setItem(`${STORAGE_KEY}:last-cloud-autosave-error`, String(error.message || error));
  } finally {
    autoSupabaseBackupRunning = false;
  }
}

async function fetchLatestCloudBackup(client = getSupabaseClient()) {
  if (!client) return null;
  const tableName = getSupabaseConfig().backupTable || "cloud_backups";
  const backupKey = getSupabaseConfig().backupKey || "nimr-carrosserie-main";
  return selectCloudBackupRow(client, tableName, backupKey, "state, photos, app_version, updated_at, updated_by, cases_count, photos_count");
}

function getTimestampMs(value) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function shouldApplyRemoteBackup(data) {
  if (!data?.state) return false;
  const remoteCloudTime = getTimestampMs(data.updated_at);
  const remoteStateTime = getTimestampMs(data.state.updatedAt || data.state.savedAt);
  const localStateTime = getTimestampMs(state?.updatedAt);
  if (remoteCloudTime && remoteCloudTime <= lastKnownCloudUpdatedAt) return false;
  if (remoteStateTime && localStateTime && localStateTime > remoteStateTime + 2000) {
    scheduleAutoSupabaseBackup("local-newer-than-cloud");
    return false;
  }
  return true;
}

async function applyRemoteSupabaseBackup(data, reason = "cloud") {
  if (!shouldApplyRemoteBackup(data)) return false;
  applyingRemoteSupabaseState = true;
  try {
    const previousActiveCaseId = activeCaseId;
    const previousTab = activeCaseDetailTab;
    state = normalizeState(data.state);
    if (previousActiveCaseId && state.cases.some((item) => item.id === previousActiveCaseId)) activeCaseId = previousActiveCaseId;
    else activeCaseId = state.cases[0]?.id ?? null;
    activeCaseDetailTab = previousTab || "resume";
    generatedProposals = {};
    if (Array.isArray(data.photos)) {
      await clearPhotoStore();
      await restorePhotoRecords(data.photos);
    }
    lastKnownCloudUpdatedAt = getTimestampMs(data.updated_at) || Date.now();
    saveState({ skipCloud: true });
    render();
    setSupabaseStatus("Synchronisation atelier à jour.", "ok");
    setSupabaseDetails(`Dernière mise à jour reçue (${reason}) : ${new Date(lastKnownCloudUpdatedAt).toLocaleTimeString()}`);
    notifyUser("Mise à jour reçue depuis un autre poste.", "info");
    return true;
  } catch (error) {
    console.warn("Application de la sauvegarde cloud impossible", error);
    setSupabaseDetails(`Synchronisation entrante impossible : ${error.message || error}`);
    return false;
  } finally {
    applyingRemoteSupabaseState = false;
  }
}

async function pullLatestSupabaseBackup(reason = "poll") {
  const client = getSupabaseClient();
  const user = await getSupabaseUser();
  if (!client || !user || navigator.onLine === false) return false;
  try {
    const data = await fetchLatestCloudBackup(client);
    return await applyRemoteSupabaseBackup(data, reason);
  } catch (error) {
    console.warn("Lecture cloud live impossible", error);
    return false;
  }
}

function startSupabaseLiveSync() {
  const client = getSupabaseClient();
  if (!client || supabaseLiveSyncChannel) return;
  const tableName = getSupabaseConfig().backupTable || "cloud_backups";
  const backupKey = getSupabaseConfig().backupKey || "nimr-carrosserie-main";
  try {
    supabaseLiveSyncChannel = client
      .channel(`nimr-sav-live-${backupKey}`)
      .on("postgres_changes", { event: "*", schema: "public", table: tableName, filter: `backup_key=eq.${backupKey}` }, () => {
        window.setTimeout(() => pullLatestSupabaseBackup("realtime"), 500);
      })
      .subscribe();
  } catch (error) {
    console.warn("Realtime Supabase indisponible, polling actif", error);
    supabaseLiveSyncChannel = null;
  }
  window.clearInterval(supabaseLivePullTimer);
  supabaseLivePullTimer = window.setInterval(() => pullLatestSupabaseBackup("poll"), SUPABASE_LIVE_PULL_INTERVAL_MS);
}

function stopSupabaseLiveSync() {
  const client = getSupabaseClient();
  if (client && supabaseLiveSyncChannel) {
    try { client.removeChannel(supabaseLiveSyncChannel); } catch (error) { console.warn("Arrêt realtime Supabase impossible", error); }
  }
  supabaseLiveSyncChannel = null;
  window.clearInterval(supabaseLivePullTimer);
  supabaseLivePullTimer = null;
}

function bindSupabaseActions() {
  if (typeof bindSupabaseConfigForm === "function") bindSupabaseConfigForm();
  const form = $("#supabase-login-form");
  form?.addEventListener("submit", signInSupabaseFromForm);
  $("#supabase-signout")?.addEventListener("click", signOutSupabase);
  $("#supabase-test")?.addEventListener("click", testSupabaseConnection);
  $("#supabase-save")?.addEventListener("click", saveLocalToSupabase);
  $("#supabase-restore")?.addEventListener("click", restoreLocalFromSupabase);
  refreshSupabasePanel();
  startSupabaseLiveSync();
  pullLatestSupabaseBackup("initialisation");
}
