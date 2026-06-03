const SUPABASE_SCHEMA_HINT =
  "Exécutez le dernier supabase-schema.sql fourni avec cette version si le test indique que cloud_backups, Realtime, app_settings ou les politiques atelier manquent.";

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
  quietNotify("Connexion Supabase réussie. Synchronisation atelier multi-PC activée.", "success");
}

async function signOutSupabase() {
  const client = getSupabaseClient();
  if (!client) return;
  stopSupabaseLiveSync();
  await client.auth.signOut();
  await refreshSupabasePanel();
  quietNotify("Déconnecté de Supabase.", "success");
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
    setSupabaseDetails(`La sauvegarde JSON fonctionne, mais repair_orders est inaccessible. ${SUPABASE_SCHEMA_HINT}`);
    return;
  }

  const settingsCheck = await client.from("app_settings").select("id").limit(1);
  if (settingsCheck.error) {
    console.warn("Table app_settings indisponible", settingsCheck.error);
    setSupabaseStatus("Connexion OK, mais réglages structurés absents.", "warn");
    setSupabaseDetails(SUPABASE_SCHEMA_HINT);
    return;
  }

  const claimCheck = await client.from("repair_claims").select("id").limit(1);
  if (claimCheck.error) {
    console.warn("Table repair_claims indisponible", claimCheck.error);
    setSupabaseStatus("Connexion OK, cache Supabase à rafraîchir.", "warn");
    setSupabaseDetails(`La table vient probablement d’être créée. ${SUPABASE_SCHEMA_HINT} Patientez 30 secondes puis relancez le contrôle.`);
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
      throw new Error(`repair_orders: contrainte unique restante sur order_number. Dans Supabase > SQL Editor, ${SUPABASE_SCHEMA_HINT.toLowerCase()} Puis relancez la sauvegarde.`);
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
    notes: [
      item.damageNotes,
      item.ownerName ? `Propriétaire/société: ${item.ownerName}` : "",
      item.driverName ? `Déposant: ${item.driverName}${item.driverPhone ? ` (${item.driverPhone})` : ""}` : "",
      item.insurance ? `Assurance: ${item.insurance}` : "",
      item.expertName ? `Expert: ${item.expertName}` : "",
    ].filter(Boolean).join("\n"),
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
  const permissionGuard = guardSensitiveAction("export.backup");
  if (!permissionGuard.ok) return;
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
    addAuditLog("backup.cloud.exported", "Sauvegarde Supabase envoyée", `${payload.state.cases.length} dossier(s), ${payload.photos.length} photo(s).`);
    saveState({ skipCloud: true, skipSnapshot: true });

    setSupabaseStatus("Sauvegarde Supabase terminée.", "ok");
    setSupabaseDetails(`${stats.repairOrders} dossier(s), ${stats.clients} client(s), ${stats.vehicles} véhicule(s), ${stats.repairSteps} étape(s), ${stats.resources} ressource(s), ${stats.holidays} jour(s) férié(s), ${stats.workHoursDays} jour(s) horaire(s), ${stats.planningSlots} créneau(x), ${stats.claims || 0} ordre(s), ${stats.supplements || 0} complément(s), ${stats.photos} photo(s) synchronisé(s). Réglages enregistrés dans app_settings.`);
    quietNotify("Sauvegarde envoyée vers Supabase, réglages atelier inclus.", "success");
  } catch (error) {
    console.error("Sauvegarde Supabase impossible", error);
    setSupabaseStatus(`Sauvegarde impossible : ${error.message}`, "error");
    notifyUser(error.message || "Sauvegarde Supabase impossible.", "error");
  }
}

async function restoreLocalFromSupabase() {
  const permissionGuard = guardSensitiveAction("import.backup");
  if (!permissionGuard.ok) return;
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

    const restoreActor = getCurrentActor();
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
    if (typeof clearDocumentStore === "function") {
      await clearDocumentStore();
    }
    const restoredPhotos = await restorePhotoRecords(Array.isArray(data.photos) ? data.photos : []);
    if (typeof cleanupOrphanedStorage === "function") {
      cleanupOrphanedStorage().catch(() => null);
    }
    addAuditLog("backup.cloud.imported", "Restauration Supabase effectuée", `${state.cases.length} dossier(s), ${restoredPhotos} photo(s).`, { actor: restoreActor });
    lastKnownCloudUpdatedAt = new Date(data.updated_at || 0).getTime() || lastKnownCloudUpdatedAt;
    if (typeof rememberKnownCloudUpdatedAt === "function" && lastKnownCloudUpdatedAt) rememberKnownCloudUpdatedAt(lastKnownCloudUpdatedAt);
    if (typeof clearLocalUserChangeAt === "function") clearLocalUserChangeAt();
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
let pendingAutoSupabaseBackupReason = "";
let lastAutoSupabaseBackupAt = 0;
let lastKnownCloudUpdatedAt = typeof getStoredCloudUpdatedAt === "function" ? getStoredCloudUpdatedAt() : 0;
let supabaseLiveSyncChannel = null;
let supabaseLivePullTimer = null;
let applyingRemoteSupabaseState = false;
let remoteConflictMutedUntil = 0;
const SUPABASE_LIVE_PULL_INTERVAL_MS = 3000;
const SUPABASE_AUTO_BACKUP_MIN_INTERVAL_MS = 1200;

function shouldAutoBackupToSupabase() {
  return Boolean(!applyingRemoteSupabaseState && getSupabaseClient && getSupabaseClient() && navigator.onLine !== false);
}

function scheduleAutoSupabaseBackup(reason = "autosave") {
  if (!shouldAutoBackupToSupabase()) return;
  if (applyingRemoteSupabaseState) return;
  window.clearTimeout(autoSupabaseBackupTimer);
  autoSupabaseBackupTimer = window.setTimeout(() => autoBackupToSupabase(reason), AUTOSAVE_CLOUD_DEBOUNCE_MS);
}

async function flushSupabaseBackup(reason = "manual") {
  window.clearTimeout(autoSupabaseBackupTimer);
  autoSupabaseBackupTimer = null;
  return autoBackupToSupabase(reason, { force: true });
}

async function autoBackupToSupabase(reason = "autosave", options = {}) {
  if (autoSupabaseBackupRunning) {
    pendingAutoSupabaseBackupReason = reason;
    return;
  }
  if (!shouldAutoBackupToSupabase()) return;
  const now = Date.now();
  if (!options.force && now - lastAutoSupabaseBackupAt < SUPABASE_AUTO_BACKUP_MIN_INTERVAL_MS) {
    window.clearTimeout(autoSupabaseBackupTimer);
    autoSupabaseBackupTimer = window.setTimeout(
      () => autoBackupToSupabase(reason),
      Math.max(250, SUPABASE_AUTO_BACKUP_MIN_INTERVAL_MS - (now - lastAutoSupabaseBackupAt)),
    );
    return;
  }
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
    if (typeof rememberKnownCloudUpdatedAt === "function") rememberKnownCloudUpdatedAt(updatedAt);
    if (typeof clearLocalUserChangeAt === "function") clearLocalUserChangeAt();
    localStorage.setItem(`${STORAGE_KEY}:last-cloud-autosave`, new Date().toISOString());
    localStorage.removeItem(`${STORAGE_KEY}:last-cloud-autosave-error`);
    if (typeof renderSyncStatusStrip === "function") renderSyncStatusStrip();
    if (typeof setSupabaseDetails === "function") {
      const partial = stats.claimsSkipped || stats.supplementsSkipped ? " · tables récemment créées: cache Supabase en rafraîchissement, données JSON cloud OK" : "";
      setSupabaseDetails(`Sauvegarde automatique cloud OK (${reason}) : ${new Date().toLocaleTimeString()}${partial}`);
    }
  } catch (error) {
    console.warn("Sauvegarde automatique Supabase impossible", error);
    localStorage.setItem(`${STORAGE_KEY}:last-cloud-autosave-error`, String(error.message || error));
    if (typeof renderSyncStatusStrip === "function") renderSyncStatusStrip();
  } finally {
    autoSupabaseBackupRunning = false;
    if (pendingAutoSupabaseBackupReason) {
      const pendingReason = pendingAutoSupabaseBackupReason;
      pendingAutoSupabaseBackupReason = "";
      scheduleAutoSupabaseBackup(pendingReason);
    }
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

const PROTECTED_CASE_FLAGS = ["received", "workStarted", "workCompleted", "qualityApproved", "delivered", "invoiced"];
const BOOKING_STATUS_RANK = {
  temporary: 0,
  planned: 1,
  paused: 2,
  started: 3,
  completed: 4,
};

function makeEntityKey(entity, fallbackPrefix = "entity") {
  if (!entity || typeof entity !== "object") return `${fallbackPrefix}:empty`;
  if (entity.id) return `id:${entity.id}`;
  return [
    fallbackPrefix,
    entity.at || entity.createdAt || entity.startedAt || entity.completedAt || "",
    entity.type || entity.status || entity.label || "",
    entity.label || entity.operation || entity.text || entity.name || "",
    entity.details || entity.pauseReason || "",
  ].join("|");
}

function mergeArrayById(localEntries = [], remoteEntries = [], options = {}) {
  const fallbackPrefix = options.fallbackPrefix || "entry";
  const preferRemote = options.preferRemote !== false;
  const map = new Map();
  (Array.isArray(localEntries) ? localEntries : []).forEach((entry) => {
    map.set(makeEntityKey(entry, fallbackPrefix), entry);
  });
  (Array.isArray(remoteEntries) ? remoteEntries : []).forEach((entry) => {
    const key = makeEntityKey(entry, fallbackPrefix);
    if (!map.has(key)) {
      map.set(key, entry);
      return;
    }
    map.set(key, preferRemote ? { ...map.get(key), ...entry } : { ...entry, ...map.get(key) });
  });
  return [...map.values()];
}

function mergePrimitiveList(localEntries = [], remoteEntries = []) {
  return [...new Set([...(Array.isArray(localEntries) ? localEntries : []), ...(Array.isArray(remoteEntries) ? remoteEntries : [])].filter(Boolean))];
}

function mergeHistoryAppendOnly(localHistory = [], remoteHistory = []) {
  const before = Array.isArray(localHistory) ? localHistory.length : 0;
  const merged = mergeArrayById(localHistory, remoteHistory, { fallbackPrefix: "history", preferRemote: false })
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  return {
    history: merged,
    added: Math.max(0, merged.length - before),
  };
}

function getBookingStatusRank(booking) {
  const status = typeof getBookingOperationalStatus === "function"
    ? getBookingOperationalStatus(booking)
    : (booking?.status || "planned");
  return BOOKING_STATUS_RANK[status] ?? BOOKING_STATUS_RANK.planned;
}

function isProtectedBooking(booking) {
  if (!booking) return false;
  const status = typeof getBookingOperationalStatus === "function"
    ? getBookingOperationalStatus(booking)
    : (booking.status || "planned");
  return status === "started"
    || status === "completed"
    || Boolean(booking.startedAt)
    || Boolean(booking.completedAt)
    || Boolean(booking.actualStart)
    || Boolean(booking.actualEnd)
    || (Array.isArray(booking.workSessions) && booking.workSessions.length > 0);
}

function isProtectedCase(item) {
  if (!item) return false;
  const flags = item.flags || {};
  return Boolean(flags.delivered || flags.invoiced || item.closedAt || item.deletedAt);
}

function isBookingProtectedByCase(booking, caseById) {
  if (!booking?.caseId || !caseById) return false;
  const item = caseById.get(booking.caseId);
  return typeof isCaseOperationallyClosed === "function" ? isCaseOperationallyClosed(item) : isProtectedCase(item);
}

function shouldKeepLocalEntity(localEntity, remoteEntity) {
  if (!localEntity) return false;
  if (!remoteEntity) return true;
  if (isProtectedBooking(localEntity) && getBookingStatusRank(localEntity) > getBookingStatusRank(remoteEntity)) return true;
  if (isProtectedCase(localEntity) && !isProtectedCase(remoteEntity)) return true;
  return false;
}

function pushSyncConflict(stats, conflict) {
  const entry = {
    id: uid("sync-conflict"),
    at: new Date().toISOString(),
    resolution: "kept_local",
    ...conflict,
  };
  stats.conflictEntries.push(entry);
  stats.conflicts += 1;
  return entry;
}

function mergeCaseFlags(localCase, remoteCase, stats) {
  const localFlags = localCase?.flags || {};
  const remoteFlags = remoteCase?.flags || {};
  const merged = { ...localFlags, ...remoteFlags };
  PROTECTED_CASE_FLAGS.forEach((flag) => {
    if (localFlags[flag] === true && remoteFlags[flag] === false) {
      merged[flag] = true;
      pushSyncConflict(stats, {
        entity: "case",
        entityId: localCase.id,
        field: `flags.${flag}`,
        reason: "Statut dossier local protégé conservé.",
        localValue: true,
        remoteValue: false,
      });
    }
  });
  return merged;
}

const CRITICAL_CASE_SYNC_FIELDS = [
  "clientName", "phone", "vehicle", "plate", "vin", "mileage", "color",
  "insurerName", "expertName", "damageNotes", "receptionNotes",
  "appointment", "appointmentStatus", "partsStatus",
  "blockerReason", "blockerDetails", "orNavNumber"
];

function isEmptySyncValue(value) {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === "object" && Object.keys(value).length === 0) return true;
  return false;
}

function normalizeSyncComparableValue(value) {
  if (isEmptySyncValue(value)) return null;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).trim();
}

function pushCaseFieldConflict(stats, context) {
  const entry = {
    id: uid("sync-conflict"),
    at: new Date().toISOString(),
    type: "case_field_conflict",
    caseId: context.caseId,
    caseNumber: context.caseNumber,
    field: context.field,
    localValue: context.localValue,
    remoteValue: context.remoteValue,
    decision: context.decision,
    reason: context.reason,
    source: context.source || "supabase",
    level: "warn",
    actorName: "Système"
  };
  stats.conflictEntries.push(entry);
  stats.conflicts += 1;
  return entry;
}

function mergeCriticalCaseField(localCase, remoteCase, field, stats) {
  const localVal = localCase[field];
  const remoteVal = remoteCase[field];
  const localIsEmpty = isEmptySyncValue(localVal);
  const remoteIsEmpty = isEmptySyncValue(remoteVal);

  if (localIsEmpty && !remoteIsEmpty) return remoteVal;
  if (!localIsEmpty && remoteIsEmpty) return localVal;

  const localNorm = normalizeSyncComparableValue(localVal);
  const remoteNorm = normalizeSyncComparableValue(remoteVal);
  
  if (localNorm === remoteNorm) return localVal;

  if (isProtectedCase(localCase)) return localVal;

  pushCaseFieldConflict(stats, {
    caseId: localCase.id,
    caseNumber: localCase.orNavNumber || localCase.id,
    field,
    localValue: localVal,
    remoteValue: remoteVal,
    decision: "needs_review",
    reason: "Valeurs conflictuelles sur champ critique."
  });
  return localVal;
}

function mergeCaseEntity(localCase, remoteCase, stats) {
  if (!localCase) {
    stats.casesMerged += 1;
    return remoteCase;
  }
  if (!remoteCase) {
    stats.protectedKept += 1;
    return localCase;
  }
  const historyResult = mergeHistoryAppendOnly(localCase.history, remoteCase.history);
  stats.historyMerged += historyResult.added;
  const merged = {
    ...localCase,
    ...remoteCase,
    flags: mergeCaseFlags(localCase, remoteCase, stats),
    history: historyResult.history,
    photos: mergeArrayById(localCase.photos, remoteCase.photos, { fallbackPrefix: "photo", preferRemote: true }),
    claims: mergeArrayById(localCase.claims, remoteCase.claims, { fallbackPrefix: "claim", preferRemote: true }),
    supplements: mergeArrayById(localCase.supplements, remoteCase.supplements, { fallbackPrefix: "supplement", preferRemote: true }),
    blockerSourceBookingIds: mergePrimitiveList(localCase.blockerSourceBookingIds, remoteCase.blockerSourceBookingIds),
    deletedAt: remoteCase.deletedAt || localCase.deletedAt || "",
    deletedBy: remoteCase.deletedBy || localCase.deletedBy || "",
    deleteReason: remoteCase.deleteReason || localCase.deleteReason || "",
  };
  
  CRITICAL_CASE_SYNC_FIELDS.forEach(field => {
    merged[field] = mergeCriticalCaseField(localCase, remoteCase, field, stats);
  });

  if (isProtectedCase(localCase) && !isProtectedCase(remoteCase)) {
    // Other fields that might not be in CRITICAL_CASE_SYNC_FIELDS
    stats.protectedKept += 1;
  }
  stats.casesMerged += 1;
  return merged;
}

function mergeCasesById(localCases = [], remoteCases = [], stats = createEmptySyncMergeStats()) {
  const remoteById = new Map((Array.isArray(remoteCases) ? remoteCases : []).filter((item) => item?.id).map((item) => [item.id, item]));
  const usedRemoteIds = new Set();
  const cases = [];
  (Array.isArray(localCases) ? localCases : []).forEach((localCase) => {
    const remoteCase = localCase?.id ? remoteById.get(localCase.id) : null;
    if (remoteCase) usedRemoteIds.add(localCase.id);
    cases.push(mergeCaseEntity(localCase, remoteCase, stats));
  });
  (Array.isArray(remoteCases) ? remoteCases : []).forEach((remoteCase) => {
    if (!remoteCase?.id || usedRemoteIds.has(remoteCase.id)) return;
    cases.push(mergeCaseEntity(null, remoteCase, stats));
  });
  return { cases, stats };
}

function mergeBookingEntity(localBooking, remoteBooking, stats, context = {}) {
  if (!localBooking) {
    stats.bookingsMerged += 1;
    return remoteBooking;
  }
  if (!remoteBooking) {
    stats.protectedKept += 1;
    return localBooking;
  }
  const localRank = getBookingStatusRank(localBooking);
  const remoteRank = getBookingStatusRank(remoteBooking);
  const protectedByClosedCase = isBookingProtectedByCase(localBooking, context.localCaseById);
  const merged = {
    ...localBooking,
    ...remoteBooking,
    notes: mergeArrayById(localBooking.notes, remoteBooking.notes, { fallbackPrefix: "task-note", preferRemote: false }),
    photoIds: mergePrimitiveList(localBooking.photoIds, remoteBooking.photoIds),
    workSessions: mergeArrayById(localBooking.workSessions, remoteBooking.workSessions, { fallbackPrefix: "work-session", preferRemote: true }),
    deletedAt: remoteBooking.deletedAt || localBooking.deletedAt || "",
    deletedBy: remoteBooking.deletedBy || localBooking.deletedBy || "",
    deleteReason: remoteBooking.deleteReason || localBooking.deleteReason || "",
  };
  if (protectedByClosedCase) {
    [
      "status",
      "start",
      "end",
      "segments",
      "plannedStart",
      "plannedEnd",
      "plannedSegments",
      "plannedMinutes",
      "actualStart",
      "actualEnd",
      "startedAt",
      "startedBy",
      "pausedAt",
      "pausedBy",
      "resumedAt",
      "resumedBy",
      "completedAt",
      "completedBy",
      "completedByOverride",
      "actualWorkedMinutes",
      "resourceIds",
      "remainingMinutes",
      "parentBookingId",
      "remainingFromPaused",
      "pauseReason",
    ].forEach((field) => {
      if (localBooking[field] !== undefined) merged[field] = localBooking[field];
    });
    pushSyncConflict(stats, {
      entity: "booking",
      entityId: localBooking.id,
      field: "case",
      reason: "Réservation locale conservée car le dossier est livré, facturé ou clôturé.",
      localValue: localBooking.caseId,
      remoteValue: remoteBooking.caseId,
    });
    stats.protectedKept += 1;
    stats.bookingsMerged += 1;
    return merged;
  }
  if (localRank > remoteRank) {
    [
      "status",
      "start",
      "end",
      "segments",
      "plannedStart",
      "plannedEnd",
      "plannedSegments",
      "plannedMinutes",
      "actualStart",
      "actualEnd",
      "startedAt",
      "startedBy",
      "pausedAt",
      "pausedBy",
      "resumedAt",
      "resumedBy",
      "completedAt",
      "completedBy",
      "completedByOverride",
      "actualWorkedMinutes",
      "remainingMinutes",
      "parentBookingId",
      "remainingFromPaused",
      "pauseReason",
    ].forEach((field) => {
      merged[field] = localBooking[field];
    });
    pushSyncConflict(stats, {
      entity: "booking",
      entityId: localBooking.id,
      field: "status",
      reason: "Statut tâche local protégé conservé.",
      localValue: localBooking.status,
      remoteValue: remoteBooking.status,
    });
    stats.protectedKept += 1;
  } else if (localRank === remoteRank && isProtectedBooking(localBooking)) {
    merged.actualWorkedMinutes = Math.max(Number(localBooking.actualWorkedMinutes || 0), Number(remoteBooking.actualWorkedMinutes || 0));
    merged.startedAt = remoteBooking.startedAt || localBooking.startedAt || "";
    merged.completedAt = remoteBooking.completedAt || localBooking.completedAt || "";
  }
  stats.bookingsMerged += 1;
  return merged;
}

function mergeBookingsById(localBookings = [], remoteBookings = [], stats = createEmptySyncMergeStats(), context = {}) {
  const remoteById = new Map((Array.isArray(remoteBookings) ? remoteBookings : []).filter((booking) => booking?.id).map((booking) => [booking.id, booking]));
  const usedRemoteIds = new Set();
  const bookings = [];
  (Array.isArray(localBookings) ? localBookings : []).forEach((localBooking) => {
    const remoteBooking = localBooking?.id ? remoteById.get(localBooking.id) : null;
    if (remoteBooking) usedRemoteIds.add(localBooking.id);
    bookings.push(mergeBookingEntity(localBooking, remoteBooking, stats, context));
  });
  (Array.isArray(remoteBookings) ? remoteBookings : []).forEach((remoteBooking) => {
    if (!remoteBooking?.id || usedRemoteIds.has(remoteBooking.id)) return;
    bookings.push(mergeBookingEntity(null, remoteBooking, stats, context));
  });
  return { bookings, stats };
}

function createEmptySyncMergeStats() {
  return {
    casesMerged: 0,
    bookingsMerged: 0,
    historyMerged: 0,
    conflicts: 0,
    protectedKept: 0,
    conflictEntries: [],
  };
}

function mergeRemoteStateIntoLocal(localState, remoteState, options = {}) {
  const stats = createEmptySyncMergeStats();
  const normalizedLocal = normalizeState(localState);
  const normalizedRemote = normalizeState(remoteState);
  const mergedCases = mergeCasesById(normalizedLocal.cases, normalizedRemote.cases, stats).cases;
  const localCaseById = new Map(normalizedLocal.cases.map((item) => [item.id, item]));
  const remoteCaseById = new Map(normalizedRemote.cases.map((item) => [item.id, item]));
  const mergedBookings = mergeBookingsById(normalizedLocal.bookings, normalizedRemote.bookings, stats, { localCaseById, remoteCaseById }).bookings;
  const syncLogEntry = {
    id: uid("sync-log"),
    at: new Date().toISOString(),
    source: options.source || options.reason || "supabase",
    reason: options.reason || "cloud",
    localVersion: APP_VERSION,
    remoteVersion: options.remoteVersion || remoteState?.appVersion || "",
    remoteUpdatedAt: options.remoteUpdatedAt || "",
    casesMerged: stats.casesMerged,
    bookingsMerged: stats.bookingsMerged,
    historyMerged: stats.historyMerged,
    conflicts: stats.conflicts,
    protectedKept: stats.protectedKept,
    details: options.details || "",
  };
  const mergedRaw = {
    ...normalizedLocal,
    ...normalizedRemote,
    cases: mergedCases,
    bookings: mergedBookings,
    resources: mergeArrayById(normalizedLocal.resources, normalizedRemote.resources, { fallbackPrefix: "resource", preferRemote: true }),
    users: mergeArrayById(normalizedLocal.users, normalizedRemote.users, { fallbackPrefix: "user", preferRemote: true }),
    auditLog: mergeArrayById(normalizedLocal.auditLog, normalizedRemote.auditLog, { fallbackPrefix: "audit", preferRemote: false }),
    syncConflicts: [...stats.conflictEntries, ...(normalizedLocal.syncConflicts || []), ...(normalizedRemote.syncConflicts || [])],
    syncLog: [syncLogEntry, ...(normalizedLocal.syncLog || []), ...(normalizedRemote.syncLog || [])],
    settings: {
      ...(normalizedLocal.settings || {}),
      ...(normalizedRemote.settings || {}),
    },
    ui: normalizedLocal.ui,
    currentUserId: normalizedLocal.currentUserId || normalizedRemote.currentUserId,
  };
  return {
    state: normalizeState(mergedRaw),
    stats,
    log: syncLogEntry,
    conflicts: stats.conflictEntries,
  };
}

async function createSyncSafetySnapshot(reason = "remote-sync", metadata = {}) {
  if (typeof forceEmergencyAutosave === "function") forceEmergencyAutosave();
  const payload = typeof buildBackupPayload === "function"
    ? await buildBackupPayload()
    : {
        app: BACKUP_APP_ID,
        version: BACKUP_FORMAT_VERSION,
        appVersion: APP_VERSION,
        exportedAt: new Date().toISOString(),
        state,
        photos: [],
      };
  payload.syncSafety = {
    reason,
    createdAt: new Date().toISOString(),
    localVersion: APP_VERSION,
    ...metadata,
  };
  try {
    localStorage.setItem(`${STORAGE_KEY}:sync-safety-last`, JSON.stringify({
      createdAt: payload.syncSafety.createdAt,
      reason,
      metadata,
      casesCount: payload.state?.cases?.length || 0,
      bookingsCount: payload.state?.bookings?.length || 0,
    }));
  } catch (error) {
    console.warn("Snapshot sync local non mémorisé", error);
  }
  if (metadata.download === true && typeof downloadJson === "function") {
    downloadJson(payload, `nimr-sav-snapshot-sync-${todayKey(new Date())}.json`);
  }
  return payload;
}

function recordSyncConflict(conflict) {
  const entry = {
    id: uid("sync-conflict"),
    at: new Date().toISOString(),
    resolution: "kept_local",
    ...conflict,
  };
  state.syncConflicts = normalizeSyncConflicts([entry, ...(state.syncConflicts || [])]);
  return entry;
}

function shouldApplyRemoteBackup(data) {
  if (!data?.state) return false;
  const remoteCloudTime = getTimestampMs(data.updated_at);
  if (!remoteCloudTime) return false;
  return remoteCloudTime > lastKnownCloudUpdatedAt;
}

async function confirmRemoteBackupConflict(data, reason) {
  const remoteCloudTime = getTimestampMs(data.updated_at);
  const localChangeAt = typeof getLocalUserChangeAt === "function" ? getLocalUserChangeAt() : 0;
  const hasUnsyncedLocalChanges = localChangeAt && localChangeAt > lastKnownCloudUpdatedAt;
  if (!hasUnsyncedLocalChanges) return true;
  if (localChangeAt >= remoteCloudTime) {
    setSupabaseDetails("Synchronisation entrante ignorée : ce poste possède des modifications locales plus récentes à envoyer.");
    return false;
  }
  if (Date.now() < remoteConflictMutedUntil) return false;
  setSupabaseStatus("Conflit de synchronisation détecté.", "warn");
  const confirmed = await showConfirmModal(
    `Des modifications locales non synchronisées existent sur ce poste depuis ${new Date(localChangeAt).toLocaleString()}.<br><br>`
      + `Une version cloud plus récente existe depuis ${new Date(remoteCloudTime).toLocaleString()} (${reason}).<br><br>`
      + "Continuer va télécharger une sauvegarde locale de sécurité puis remplacer ce poste par la version cloud. Annuler conserve ce poste inchangé.",
  );
  if (!confirmed) {
    remoteConflictMutedUntil = Date.now() + 60 * 1000;
    setSupabaseDetails("Synchronisation entrante annulée : modifications locales conservées sur ce poste.");
    return false;
  }
  const safetyPayload = await buildBackupPayload();
  downloadJson(safetyPayload, `nimr-sav-conflit-local-avant-cloud-${todayKey(new Date())}.json`);
  return true;
}

async function applyRemoteSupabaseBackup(data, reason = "cloud") {
  if (!shouldApplyRemoteBackup(data)) return false;
  const canApply = await confirmRemoteBackupConflict(data, reason);
  if (!canApply) return false;
  applyingRemoteSupabaseState = true;
  try {
    const previousActiveCaseId = activeCaseId;
    const previousTab = activeCaseDetailTab;
    await createSyncSafetySnapshot("remote-before-merge", {
      reason,
      remoteUpdatedAt: data.updated_at || "",
      remoteVersion: data.app_version || "",
      source: data.updated_by || "supabase",
    });
    const mergeResult = mergeRemoteStateIntoLocal(state, data.state, {
      reason,
      source: data.updated_by || "supabase",
      remoteUpdatedAt: data.updated_at || "",
      remoteVersion: data.app_version || "",
    });
    state = mergeResult.state;
    if (previousActiveCaseId && state.cases.some((item) => item.id === previousActiveCaseId)) activeCaseId = previousActiveCaseId;
    else activeCaseId = state.cases[0]?.id ?? null;
    activeCaseDetailTab = previousTab || "resume";
    generatedProposals = {};
    if (Array.isArray(data.photos)) {
      await restorePhotoRecords(data.photos);
    }
    lastKnownCloudUpdatedAt = getTimestampMs(data.updated_at) || Date.now();
    if (typeof rememberKnownCloudUpdatedAt === "function") rememberKnownCloudUpdatedAt(lastKnownCloudUpdatedAt);
    if (mergeResult.stats.conflicts > 0) {
      if (typeof rememberLocalUserChangeAt === "function") rememberLocalUserChangeAt(new Date());
    } else if (typeof clearLocalUserChangeAt === "function") {
      clearLocalUserChangeAt();
    }
    saveState({ skipCloud: true });
    render();
    if (mergeResult.stats.conflicts > 0) {
      setSupabaseStatus("Conflit de synchronisation détecté.", "warn");
      setSupabaseDetails(`Données locales protégées conservées : ${mergeResult.stats.conflicts} conflit(s), ${mergeResult.stats.protectedKept} élément(s) protégé(s).`);
      notifyUser("Conflit de synchronisation détecté — données locales conservées.", "warn");
    } else {
      setSupabaseStatus("Synchronisation atelier à jour.", "ok");
      setSupabaseDetails(`Dernière mise à jour reçue (${reason}) : ${new Date(lastKnownCloudUpdatedAt).toLocaleTimeString()} · ${mergeResult.stats.casesMerged} dossier(s), ${mergeResult.stats.bookingsMerged} tâche(s) fusionné(s).`);
      quietNotify("Mise à jour reçue depuis un autre poste.", "info");
    }
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
        window.setTimeout(() => pullLatestSupabaseBackup("realtime"), 200);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setSupabaseDetails("Synchronisation temps réel active. Polling de secours toutes les 3 s.");
          pullLatestSupabaseBackup("realtime-connect");
        }
        if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
          setSupabaseDetails("Realtime indisponible temporairement : polling de secours actif toutes les 3 s.");
        }
      });
  } catch (error) {
    console.warn("Realtime Supabase indisponible, polling actif", error);
    supabaseLiveSyncChannel = null;
  }
  window.clearInterval(supabaseLivePullTimer);
  supabaseLivePullTimer = window.setInterval(() => pullLatestSupabaseBackup("poll"), SUPABASE_LIVE_PULL_INTERVAL_MS);
  pullLatestSupabaseBackup("live-start");
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
  window.addEventListener("focus", () => pullLatestSupabaseBackup("focus"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pullLatestSupabaseBackup("retour application");
    else flushSupabaseBackup("mise-en-arriere-plan");
  });
  window.addEventListener("online", () => pullLatestSupabaseBackup("retour connexion"));
  window.addEventListener("pagehide", () => flushSupabaseBackup("fermeture-page"));
}
