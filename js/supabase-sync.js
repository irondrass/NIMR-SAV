const SUPABASE_SCHEMA_HINT =
  "Exécutez en priorité supabase_nimr_sav_v23_2_8_full_audit.sql dans SQL Editor. supabase-schema.sql reste le schéma de compatibilité historique.";

async function signInSupabaseFromForm(event) {
  event.preventDefault();
  const permissionGuard = guardSensitiveAction("supabase.access");
  if (!permissionGuard.ok) return;
  const client = getSupabaseClient();
  if (!client) {
    refreshSupabasePanel();
    return;
  }
  const form = event.currentTarget;
  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;
  if (!email || !password) {
    setSupabaseStatus("Email et mot de passe Supabase requis pour ouvrir la session cloud.", "error");
    return;
  }
  setSupabaseStatus("Connexion en cours...");
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    console.error("Connexion Supabase impossible", error);
    setSupabaseStatus(`Connexion refusée : ${error.message}`, "error");
    notifyUser("Connexion Supabase impossible. Vérifiez email, mot de passe et droits d'accès atelier.", "error");
    return;
  }
  form.elements.password.value = "";
  if (typeof hydrateLargeStateIfAvailable === "function") await hydrateLargeStateIfAvailable();
  if (typeof loadDurableOutboxOperations === "function") await loadDurableOutboxOperations();
  await refreshSupabasePanel();
  startSupabaseLiveSync();
  await pullLatestSupabaseBackup("connexion");
  await processOfflineQueue();
  await pullLatestSupabaseBackup("convergence-apres-outbox");
  scheduleAutoSupabaseBackup("connexion-convergee");
  quietNotify("Connexion Supabase réussie. Synchronisation atelier multi-PC activée.", "success");
}

async function signOutSupabase() {
  const permissionGuard = guardSensitiveAction("supabase.access");
  if (!permissionGuard.ok) return;
  const client = getSupabaseClient();
  if (!client) return;
  setSupabaseStatus("Synchronisation avant déconnexion...");
  if (typeof persistLargeStateSnapshot === "function") {
    await persistLargeStateSnapshot(state, { appVersion: APP_VERSION, reason: "supabase-signout" });
  }
  if (navigator.onLine !== false) {
    await processOfflineQueue().catch((error) => {
      console.warn("Outbox conservée avant déconnexion", error?.message || error);
    });
  }
  stopSupabaseLiveSync();
  const { error } = await client.auth.signOut();
  if (error) {
    setSupabaseStatus(`Déconnexion Supabase impossible : ${error.message}`, "error");
    return;
  }
  await refreshSupabasePanel();
  quietNotify("Déconnecté de Supabase.", "success");
}

async function testSupabaseConnection() {
  const permissionGuard = guardSensitiveAction("supabase.access");
  if (!permissionGuard.ok) return;
  const client = getSupabaseClient();
  if (!client) {
    refreshSupabasePanel();
    return;
  }
  setSupabaseStatus("Test de connexion...");
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData?.user) {
    setSupabaseStatus("Connexion requise avant le test.", "warn");
    setSupabaseDetails("Connectez-vous d'abord avec email + mot de passe Supabase, puis relancez le test.");
    return;
  }

  const backupTable = getSupabaseConfig().backupTable || "cloud_backups";
  const backupCheck = await client.from(backupTable).select("id").limit(1);
  if (backupCheck.error) {
    console.error("Test Supabase impossible", backupCheck.error);
    setSupabaseStatus(`Erreur Supabase : ${backupCheck.error.message}`, "error");
    setSupabaseDetails(`${SUPABASE_SCHEMA_HINT} Puis réessayez.`);
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
  const stateSnapshot = cloneSyncStateSnapshot(payload.state);
  return {
    ...payload,
    state: stateSnapshot,
    snapshotFingerprint: getSyncStateFingerprint(stateSnapshot),
    syncedAt: new Date().toISOString(),
  };
}

async function upsertCloudBackupRow(client, tableName, row) {
  const scopedRow = withWorkshopId(row);
  const { error } = await client.from(tableName).upsert(scopedRow, { onConflict: "workshop_id,backup_key" });
  if (error && isWorkshopSchemaUnavailable(error)) {
    throwWorkshopIsolationRequired(tableName, error);
  }
  if (error) throw error;
}

async function selectCloudBackupRow(client, tableName, backupKey, columns) {
  const { data, error } = await client
    .from(tableName)
    .select(columns)
    .eq("workshop_id", getSupabaseWorkshopId())
    .eq("backup_key", backupKey)
    .maybeSingle();
  if (error && isWorkshopSchemaUnavailable(error)) {
    throwWorkshopIsolationRequired(tableName, error);
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
  const workHours = cloneWorkHours(localState.workHours || DEFAULT_WORK_HOURS);
  const workHoursFingerprint = typeof getWorkHoursFingerprint === "function"
    ? getWorkHoursFingerprint(workHours)
    : "";
  const workHoursSyncMeta = typeof getWorkHoursSyncMeta === "function"
    ? getWorkHoursSyncMeta()
    : {};
  return {
    schemaVersion: 1,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: { ...(localState.settings || {}) },
    workHours,
    workHoursSync: {
      version: 1,
      fingerprint: workHoursFingerprint,
      changedAt: workHoursSyncMeta.localChangedAt || "",
      acknowledgedAt: workHoursSyncMeta.acknowledgedAt || "",
      pending: Boolean(workHoursSyncMeta.pending),
    },
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
  const { error } = await client.from("app_settings").upsert(row, { onConflict: "workshop_id,setting_key" });
  if (error && isWorkshopSchemaUnavailable(error)) {
    throwWorkshopIsolationRequired("app_settings", error);
  }
  if (error) throw new Error(`app_settings: ${error.message}`);
  return {
    settings: Object.keys(payload.settings || {}).length,
    workHoursDays: Object.keys(payload.workHours || {}).length,
    workHoursFingerprint: payload.workHoursSync?.fingerprint || "",
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
  if (typeof acceptRemoteWorkHoursSync === "function") {
    acceptRemoteWorkHoursSync(state.workHours, {
      updatedAt: settingsPayload.workHoursSync?.changedAt || new Date(),
      decision: "manual_app_settings_restore",
    });
  }
  state.holidays = nextState.holidays;
  state.resources = nextState.resources;
  state.bookings = normalizeBookings(state.bookings, state.resources);
  state.planningDate = nextState.planningDate;
  return true;
}

async function restoreWorkshopSettingsFromSupabase(client) {
  const { data, error } = await client
    .from("app_settings")
    .select("value, updated_at")
    .eq("workshop_id", getSupabaseWorkshopId())
    .eq("setting_key", "workshop_settings")
    .maybeSingle();
  if (error && isWorkshopSchemaUnavailable(error)) {
    throwWorkshopIsolationRequired("app_settings", error);
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

function throwWorkshopIsolationRequired(scope, error) {
  throw new Error(`${scope}: isolation atelier indisponible. ${SUPABASE_SCHEMA_HINT} ${error?.message || ""}`.trim());
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
  const { data, error } = await client
    .from(table)
    .upsert(cleanRows.map(withWorkshopId), { onConflict: "workshop_id,local_id" })
    .select("id, local_id");
  if (error && isWorkshopSchemaUnavailable(error)) {
    throwWorkshopIsolationRequired(table, error);
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


const AUDIT_LOGS_SYNC_BATCH_SIZE = 200;

function chunkSyncRows(rows, batchSize = AUDIT_LOGS_SYNC_BATCH_SIZE) {
  const size = Math.max(1, Number(batchSize || AUDIT_LOGS_SYNC_BATCH_SIZE));
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function isPostgresUniqueViolation(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || error || "");
  return code === "23505" || /duplicate key|unique constraint/i.test(message);
}

async function readExistingAuditLocalIds(client, localIds, batchSize = AUDIT_LOGS_SYNC_BATCH_SIZE) {
  const existingIds = new Set();
  const uniqueIds = [...new Set((localIds || []).filter(Boolean))];
  for (const batch of chunkSyncRows(uniqueIds, batchSize)) {
    const { data, error } = await client
      .from("audit_logs")
      .select("local_id")
      .eq("workshop_id", getSupabaseWorkshopId())
      .in("local_id", batch);
    if (error && isWorkshopSchemaUnavailable(error)) {
      throwWorkshopIsolationRequired("audit_logs", error);
    }
    if (error) throw new Error(`audit_logs: ${error.message || error}`);
    (data || []).forEach((row) => {
      if (row?.local_id) existingIds.add(row.local_id);
    });
  }
  return existingIds;
}

async function insertAuditRowsAppendOnly(client, rows, batchSize = AUDIT_LOGS_SYNC_BATCH_SIZE) {
  let inserted = 0;
  for (const batch of chunkSyncRows(rows, batchSize)) {
    const { error } = await client.from("audit_logs").insert(batch.map(withWorkshopId));
    if (!error) {
      inserted += batch.length;
      continue;
    }
    if (error && isWorkshopSchemaUnavailable(error)) {
      throwWorkshopIsolationRequired("audit_logs", error);
    }
    if (!isPostgresUniqueViolation(error)) {
      throw new Error(`audit_logs: ${error.message || error}`);
    }

    // Une autre synchronisation a pu inserer une partie du lot entre le SELECT
    // et l'INSERT. On relit le serveur puis on tente seulement les lignes encore
    // absentes. Une nouvelle collision 23505 est consideree comme acquittee.
    const existingIds = await readExistingAuditLocalIds(
      client,
      batch.map((row) => row.local_id),
      batchSize,
    );
    const remaining = batch.filter((row) => !existingIds.has(row.local_id));
    for (const row of remaining) {
      const { error: rowError } = await client.from("audit_logs").insert([withWorkshopId(row)]);
      if (!rowError) {
        inserted += 1;
        continue;
      }
      if (rowError && isWorkshopSchemaUnavailable(rowError)) {
        throwWorkshopIsolationRequired("audit_logs", rowError);
      }
      if (!isPostgresUniqueViolation(rowError)) {
        throw new Error(`audit_logs: ${rowError.message || rowError}`);
      }
    }
  }
  return inserted;
}

async function syncAuditLogsAppendOnly(client, rows, options = {}) {
  const uniqueRows = uniqueByLocalId(rows || []).filter((row) => row.local_id);
  if (!uniqueRows.length) return { total: 0, existing: 0, inserted: 0 };
  const batchSize = Math.max(1, Number(options.batchSize || AUDIT_LOGS_SYNC_BATCH_SIZE));
  const existingIds = await readExistingAuditLocalIds(
    client,
    uniqueRows.map((row) => row.local_id),
    batchSize,
  );
  const missingRows = uniqueRows.filter((row) => !existingIds.has(row.local_id));
  const inserted = missingRows.length
    ? await insertAuditRowsAppendOnly(client, missingRows, batchSize)
    : 0;
  return { total: uniqueRows.length, existing: existingIds.size, inserted };
}

function buildRepairStatus(item) {
  const flags = item.flags || {};
  if (flags.delivered) return "delivered";
  if (flags.qualityApproved) return "quality_approved";
  if (flags.workCompleted) return "work_completed";
  if (flags.workStarted) return "in_progress";
  if (flags.received) return "received";
  if (item.source === "pdf_estimate" && item.pdfImportStatus === "chief_validation_pending") return "pdf_chief_validation_pending";
  if (item.source === "pdf_estimate" && item.pdfImportStatus === "ready_for_planning") return "pdf_ready_for_planning";
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

function buildRepairOrderNotesForSync(item) {
  const roleNotes = item.notes && typeof item.notes === "object" ? item.notes : {};
  return [
    item.damageNotes,
    item.ownerName ? `Propriétaire/société: ${item.ownerName}` : "",
    item.driverName ? `Déposant: ${item.driverName}${item.driverPhone ? ` (${item.driverPhone})` : ""}` : "",
    item.insurance ? `Assurance: ${item.insurance}` : "",
    item.expertName ? `Expert: ${item.expertName}` : "",
    roleNotes.reception ? `Note réception: ${roleNotes.reception}` : "",
    roleNotes.technique ? `Note technique: ${roleNotes.technique}` : "",
    roleNotes.qualite ? `Note qualité: ${roleNotes.qualite}` : "",
    roleNotes.direction ? `Note direction: ${roleNotes.direction}` : "",
    item.source === "pdf_estimate" ? "Source dossier: pdf_estimate" : "",
    item.importedAt ? `Date import PDF: ${item.importedAt}` : "",
    item.pdfImportStatus ? `État import PDF: ${item.pdfImportStatus}` : "",
    item.pdfValidatedAt ? `Validation Chef Atelier PDF: ${item.pdfValidatedAt}${item.pdfValidatedBy ? ` par ${item.pdfValidatedBy}` : ""}` : "",
  ].filter(Boolean).join("\n");
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
    category: resource.category || resource.role || "atelier",
    kind: resource.kind || (resource.external ? "external" : "internal"),
    site: resource.site || (resource.external ? "external" : "internal"),
    capacity: Math.max(1, Number(resource.capacity || 1) || 1),
    simultaneous_capacity: Math.max(1, Number(resource.simultaneousCapacity || resource.capacity || 1) || 1),
    daily_capacity_minutes: Number(resource.dailyCapacityMinutes || 0) || null,
    calendar: resource.calendar || {},
    compatible_roles: Array.isArray(resource.compatibleRoles) ? resource.compatibleRoles : [],
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
    delivery_planned_at: safeIso(item.revisedEstimatedDelivery || item.deliveryEstimate?.current || item.appointment?.delivery),
    delivery_done_at: safeIso(item.closedAt) || getHistoryIso(item, "case.invoiced") || getHistoryIso(item, "vehicle.delivered"),
    estimated_amount: null,
    customer_balance: null,
    notes: buildRepairOrderNotesForSync(item),
    updated_at: now,
  }));
  const orderMap = await upsertAndMap(client, "repair_orders", orderRows);

  const bookingStatsByCaseAndKey = new Map();
  localState.bookings.forEach((booking) => {
    if (!booking?.caseId || !booking?.key || booking.type === "leave" || booking.temporary === true) return;
    const key = `${booking.caseId}:${booking.key}`;
    const stats = bookingStatsByCaseAndKey.get(key) || { actualMinutes: 0, startedAt: [], completedAt: [] };
    stats.actualMinutes += Math.max(0, Number(booking.actualWorkedMinutes || 0) || 0);
    if (booking.actualStart || booking.startedAt) stats.startedAt.push(booking.actualStart || booking.startedAt);
    if (booking.actualEnd || booking.completedAt) stats.completedAt.push(booking.actualEnd || booking.completedAt);
    bookingStatsByCaseAndKey.set(key, stats);
  });
  const stepRows = [];
  localState.cases.forEach((item) => {
    const orderId = orderMap.get(caseSyncLocalId(item));
    if (!orderId) return;
    DURATIONS.forEach(([key, label]) => {
      const actual = bookingStatsByCaseAndKey.get(`${item.id}:${key}`) || { actualMinutes: 0, startedAt: [], completedAt: [] };
      stepRows.push({
        local_id: `${caseSyncLocalId(item)}:${key}`,
        repair_order_id: orderId,
        step_key: key,
        label,
        status: stepStatus(item, key),
        planned_hours: Number(item.durations?.[key] || 0),
        actual_hours: Math.round((actual.actualMinutes / 60) * 100) / 100,
        started_at: safeIso(actual.startedAt.sort()[0]) || (item.flags?.workStarted ? getHistoryIso(item, "work.started") : null),
        completed_at: safeIso(actual.completedAt.sort().at(-1)) || (item.flags?.workCompleted ? getHistoryIso(item, "work.completed") : null),
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
      const mappedResourceIds = (booking.resourceIds || []).map((resourceId) => resourceMap.get(resourceId)).filter(Boolean);
      const mappedEquipmentIds = (booking.equipmentResourceIds || []).map((resourceId) => resourceMap.get(resourceId)).filter(Boolean);
      bookingRows.push({
        local_id: `${booking.caseId || booking.id}:${booking.key || "step"}:${index}:${startAt}`,
        repair_order_id: orderId,
        resource_id: firstResourceId ? resourceMap.get(firstResourceId) || null : null,
        resource_ids: mappedResourceIds,
        primary_resource_id: booking.primaryResourceId ? resourceMap.get(booking.primaryResourceId) || null : mappedResourceIds[0] || null,
        equipment_resource_ids: mappedEquipmentIds,
        task_id: booking.taskId || booking.businessTaskId || booking.id,
        step_key: booking.key || null,
        dependencies: Array.isArray(booking.dependencies) ? booking.dependencies : [],
        title: booking.title || getDurationLabel(booking.key),
        start_at: startAt,
        end_at: endAt,
        status: typeof getBookingOperationalStatus === "function" ? getBookingOperationalStatus(booking) : (booking.status || "planned"),
        planned_minutes: Math.max(0, Number(booking.plannedMinutes || 0) || 0),
        actual_worked_minutes: Math.max(0, Number(booking.actualWorkedMinutes || 0) || 0),
        actual_start_at: safeIso(booking.actualStart || booking.startedAt),
        actual_end_at: safeIso(booking.actualEnd || booking.completedAt),
        vehicle_location: booking.vehicleLocation || "internal",
        service_mode: booking.serviceMode || "internal",
        subcontract_id: booking.subcontractId || null,
        temporary: booking.temporary === true,
        updated_at: now,
      });
    });
  });
  // Les créneaux sont créés/modifiés exclusivement par
  // nimr_reserve_planning_atomic. Une écriture REST directe contournerait les
  // verrous, l'idempotence et le contrôle de capacité du RPC.


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
  await syncAuditLogsAppendOnly(client, auditRows);

  return {
    clients: clientRows.length,
    vehicles: vehicleRows.length,
    repairOrders: orderRows.length,
    repairSteps: stepRows.length,
    resources: resourceRows.length,
    settings: settingsStats.settings,
    workHoursDays: settingsStats.workHoursDays,
    workHoursFingerprint: settingsStats.workHoursFingerprint,
    holidays: settingsStats.holidays,
    planningSlots: 0,
    planningSlotsManagedByRpc: bookingRows.length,
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
    setSupabaseStatus("Connectez-vous à Supabase avant de sauvegarder.", "warn");
    setSupabaseDetails("La sauvegarde cloud est bloquée tant qu'aucune session Supabase active n'est détectée.");
    return;
  }
  const workHoursBlock =
    getWorkHoursOutboundBlock();
  if (workHoursBlock) {
    setSupabaseStatus(
      "Sauvegarde cloud bloquée : conflit horaires atelier.",
      "warn",
    );
    setSupabaseDetails(
      "Résolvez le conflit des horaires atelier avant "
      + "tout envoi du snapshot local complet.",
    );
    if (typeof notifyUser === "function") {
      notifyUser(
        "Sauvegarde cloud bloquée : conflit horaires "
        + "atelier non résolu.",
        "warn",
      );
    }
    return workHoursBlock;
  }
  const confirmed = await showConfirmModal("Sauvegarder les données locales actuelles vers Supabase ? Une copie JSON locale de sécurité sera téléchargée avant l'envoi. Vérifiez que l'authentification et les règles RLS Supabase sont actives.");
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
    if (
      typeof acknowledgeWorkHoursSync === "function"
      && typeof getWorkHoursFingerprint === "function"
    ) {
      const sentWorkHoursFingerprint = getWorkHoursFingerprint(payload.state?.workHours || {});
      acknowledgeWorkHoursSync(state.workHours, {
        cloudBackupFingerprint: sentWorkHoursFingerprint,
        appSettingsFingerprint: stats.workHoursFingerprint,
        updatedAt,
      });
    }
    if (typeof resolveKeptConflictsAfterPush === "function") {
      resolveKeptConflictsAfterPush();
    }
    addAuditLog("backup.cloud.exported", "Sauvegarde Supabase envoyée", formatSensitiveActionAuditDetails("cloud-export", {
      cases: payload.state.cases.length,
      photos: payload.photos.length,
      documents: payload.documents?.length || 0,
      supabaseUser: user.email || user.id,
    }));
    saveState({ skipCloud: true, skipSnapshot: true });
    markLocalCasesAsSynced();

    setSupabaseStatus("Sauvegarde Supabase terminée.", "ok");
    setSupabaseDetails(`${stats.repairOrders} dossier(s), ${stats.clients} client(s), ${stats.vehicles} véhicule(s), ${stats.repairSteps} étape(s), ${stats.resources} ressource(s), ${stats.holidays} jour(s) férié(s), ${stats.workHoursDays} jour(s) horaire(s), ${stats.planningSlotsManagedByRpc ?? stats.planningSlots ?? 0} créneau(x) protégé(s) par RPC atomique, ${stats.claims || 0} ordre(s), ${stats.supplements || 0} complément(s), ${stats.photos} photo(s) synchronisé(s). Réglages enregistrés dans app_settings.`);
    quietNotify("Sauvegarde envoyée vers Supabase, réglages atelier inclus.", "success");
  } catch (error) {
    console.error("Sauvegarde Supabase impossible", error);
    setSupabaseStatus(`Sauvegarde impossible : ${error.message}`, "error");
    setSupabaseDetails("La copie locale n'a pas été remplacée. Vérifiez la connexion, les policies Supabase et le schéma SQL.");
    notifyUser(error.message || "Sauvegarde Supabase impossible. Vérifiez la connexion et les droits cloud.", "error");
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
    setSupabaseStatus("Connectez-vous à Supabase avant de restaurer.", "warn");
    setSupabaseDetails("La restauration cloud est bloquée tant qu'aucune session Supabase active n'est détectée.");
    return;
  }
  const restoreWarning = `Restaurer les données depuis Supabase ? Une copie locale de sécurité sera enregistrée avant remplacement.<br><br>` +
    `<strong>Attention :</strong> Restaurer depuis le Cloud écrase et remplace les données locales de ce poste avec les données partagées de Supabase.<br><br>` +
    `Vérifiez que l'authentification Supabase et les règles RLS sont actives avant usage réel.<br><br>` +
    `Tapez ${RESTORE_BACKUP_CONFIRMATION} pour confirmer la restauration.`;

  const confirmed = await confirmStrongSensitiveAction(
    restoreWarning,
    RESTORE_BACKUP_CONFIRMATION,
    "Restaurer les données depuis Supabase ? Écrase les données locales.",
  );

  if (!confirmed) return;

  try {
    const tableName = getSupabaseConfig().backupTable || "cloud_backups";
    const backupKey = getSupabaseConfig().backupKey || "nimr-carrosserie-main";
    setSupabaseStatus("Lecture sauvegarde Supabase...");
    const data = await selectCloudBackupRow(client, tableName, backupKey, "state, photos, app_version, updated_at, cases_count, photos_count");
    if (!data?.state) {
      setSupabaseStatus("Aucune sauvegarde Supabase trouvée.", "warn");
      setSupabaseDetails("Faites d'abord une sauvegarde local → Supabase depuis un poste autorisé, puis relancez la restauration.");
      return;
    }

    const safetyPayload = await buildBackupPayload();
    const safetySnapshotGate = await createRequiredRestoreSafetySnapshot(
      safetyPayload,
      {
        type: "restore_global",
        reason: "manual-cloud-restore",
        remoteUpdatedAt: data.updated_at || "",
      },
    );
    if (!safetySnapshotGate.allowed) return;

    const restoreActor = getCurrentActor();
    const previousSelection = typeof captureCaseSelectionIdentity === "function"
      ? captureCaseSelectionIdentity()
      : { id: activeCaseId };
    state = normalizeState(data.state);
    if (typeof initializeLastKnownCasesComparable === "function") {
      initializeLastKnownCasesComparable();
    }
    let settingsRestored = false;
    try {
      const settingsBackup = await restoreWorkshopSettingsFromSupabase(client);
      settingsRestored = applyWorkshopSettingsToState(settingsBackup?.value);
    } catch (settingsError) {
      console.warn("Restauration app_settings impossible, utilisation de cloud_backups uniquement", settingsError);
    }
    if (typeof reconcileActiveCaseSelection === "function") reconcileActiveCaseSelection(previousSelection);
    else activeCaseId = state.cases[0]?.id ?? null;
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
    addAuditLog("backup.cloud.imported", "Restauration Supabase effectuée", formatSensitiveActionAuditDetails("cloud-restore", {
      cases: state.cases.length,
      photos: restoredPhotos,
      supabaseUser: user.email || user.id,
      sourceVersion: data.app_version || "inconnue",
    }, restoreActor), { actor: restoreActor });
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
    addAuditLog("backup.cloud.import_failed", "Restauration Supabase échouée", error.message || "Erreur inconnue.", { actor: getCurrentActor() });
    saveState({ skipCloud: true, skipSnapshot: true });
    setSupabaseStatus(`Restauration impossible : ${error.message}`, "error");
    setSupabaseDetails("Les données locales n'ont pas été remplacées. Vérifiez la connexion, les policies Supabase et le schéma SQL.");
    notifyUser(error.message || "Restauration Supabase impossible. Vérifiez la connexion et les droits cloud.", "error");
  }
}

let autoSupabaseBackupTimer = null;
let autoSupabaseBackupRunning = false;

let autoSupabaseBackupPromise = null;
let pendingAutoSupabaseBackupReason = "";
let lastAutoSupabaseBackupAt = 0;
let lastKnownCloudUpdatedAt = typeof getStoredCloudUpdatedAt === "function" ? getStoredCloudUpdatedAt() : 0;
let supabaseLiveSyncChannel = null;
let supabaseLivePullTimer = null;
let supabaseLivePullPromise = null;
let applyingRemoteSupabaseState = false;
let remoteConflictMutedUntil = 0;
const processedRealtimeEventIds = new Set();
const SUPABASE_LIVE_PULL_INTERVAL_MS = 3000;
const SUPABASE_AUTO_BACKUP_MIN_INTERVAL_MS = 1200;

function getWorkHoursOutboundBlock(
  options = {},
) {
  const blocked = Boolean(
    typeof hasBlockingWorkHoursConflict === "function"
    && hasBlockingWorkHoursConflict(
      state?.workHours || {},
    ),
  );
  if (!blocked) return null;

  const message = [
    "Synchronisation cloud bloquée : un conflit",
    "non résolu existe sur les horaires atelier.",
    "Le snapshot local complet ne sera pas envoyé.",
  ].join(" ");

  if (options.requireAck) {
    throw new Error(message);
  }

  return {
    acknowledged: false,
    reason: "work-hours-conflict",
    error: message,
  };
}

function shouldAutoBackupToSupabase() {
  return Boolean(!applyingRemoteSupabaseState && getSupabaseClient && getSupabaseClient() && navigator.onLine !== false);
}

function scheduleAutoSupabaseBackup(reason = "autosave") {
  if (getWorkHoursOutboundBlock()) return;
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
  const initialWorkHoursBlock =
    getWorkHoursOutboundBlock(options);
  if (initialWorkHoursBlock) {
    return initialWorkHoursBlock;
  }
  if (autoSupabaseBackupPromise) {
    pendingAutoSupabaseBackupReason = reason;
    return autoSupabaseBackupPromise;
  }
  if (!shouldAutoBackupToSupabase()) {
    if (options.requireAck) throw new Error("Synchronisation serveur indisponible ; l'opération reste dans l'outbox.");
    return { acknowledged: false, reason: "unavailable" };
  }
  const now = Date.now();
  if (!options.force && now - lastAutoSupabaseBackupAt < SUPABASE_AUTO_BACKUP_MIN_INTERVAL_MS) {
    window.clearTimeout(autoSupabaseBackupTimer);
    autoSupabaseBackupTimer = window.setTimeout(
      () => autoBackupToSupabase(reason),
      Math.max(250, SUPABASE_AUTO_BACKUP_MIN_INTERVAL_MS - (now - lastAutoSupabaseBackupAt)),
    );
    return { acknowledged: false, reason: "throttled" };
  }

  const run = (async () => {
    autoSupabaseBackupRunning = true;
    try {
      const client = getSupabaseClient();
      const user = await getSupabaseUser();
      if (!client || !user) {
        if (options.requireAck) throw new Error("Session Supabase requise ; l'opération reste dans l'outbox.");
        return { acknowledged: false, reason: "authentication-required" };
      }
      const preBuildWorkHoursBlock =
        getWorkHoursOutboundBlock(options);
      if (preBuildWorkHoursBlock) {
        return preBuildWorkHoursBlock;
      }
      const payload = await buildCloudBackupPayload();
      const sentFingerprint = payload.snapshotFingerprint
        || getSyncStateFingerprint(payload.state);
      const sentWorkHoursFingerprint = typeof getWorkHoursFingerprint === "function"
        ? getWorkHoursFingerprint(payload.state?.workHours || {})
        : "";
      const tableName = getSupabaseConfig().backupTable || "cloud_backups";
      const backupKey = getSupabaseConfig().backupKey || "nimr-carrosserie-main";
      const updatedAt = new Date().toISOString();
      const preWriteWorkHoursBlock =
        getWorkHoursOutboundBlock(options);
      if (preWriteWorkHoursBlock) {
        return preWriteWorkHoursBlock;
      }
    // --- MODIFICATION CRITIQUE ---
    // On désactive l'envoi du gros snapshot JSON dans cloud_backups pour éviter 
    // que le Poste A n'écrase les données du Poste B.
    // L'application utilise désormais syncBusinessTablesToSupabase pour pousser les données.
    /* 
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
    */
    
    // On se contente de synchroniser les tables relationnelles (repair_orders, planning_slots, etc.)
    const stats = await syncBusinessTablesToSupabase(payload, user);
      const expectedVersion = Math.max(
        0,
        ...(payload.state?.cases || []).map(
          (item) => Number(item.localRevision || 0),
        ),
      );
      const acknowledgement = {
        acknowledged: true,
        updatedAt,
        workshopId: getSupabaseWorkshopId(),
        userId: user.id,
        expectedVersion,
        snapshotFingerprint: sentFingerprint,
      };
      if (typeof acknowledgeEquivalentDurableOutboxOperations === "function") {
        await acknowledgeEquivalentDurableOutboxOperations({
          workshopId: getSupabaseWorkshopId(),
          entityType: "workshop_state",
          entityId: getSupabaseWorkshopId(),
          action: "upsert_snapshot",
          expectedVersion,
          snapshotFingerprint: sentFingerprint,
        }, acknowledgement);
      }

      const currentFingerprint = getSyncStateFingerprint(state);
      const snapshotStillCurrent =
        currentFingerprint === sentFingerprint;
      acknowledgement.snapshotStillCurrent = snapshotStillCurrent;
      if (
        typeof acknowledgeWorkHoursSync === "function"
        && sentWorkHoursFingerprint
      ) {
        const workHoursAcknowledgement = acknowledgeWorkHoursSync(state.workHours, {
          cloudBackupFingerprint: sentWorkHoursFingerprint,
          appSettingsFingerprint: stats.workHoursFingerprint,
          updatedAt,
        });
        acknowledgement.workHoursAcknowledged = Boolean(
          workHoursAcknowledgement.acknowledged,
        );
      }

      if (
        snapshotStillCurrent
        && typeof resolveKeptConflictsAfterPush === "function"
      ) {
        resolveKeptConflictsAfterPush();
      }

      markLocalCasesAsSynced(payload.state);
      lastAutoSupabaseBackupAt = Date.now();
      lastKnownCloudUpdatedAt = new Date(updatedAt).getTime();
      if (typeof rememberKnownCloudUpdatedAt === "function") {
        rememberKnownCloudUpdatedAt(updatedAt);
      }
      if (
        snapshotStillCurrent
        && typeof clearLocalUserChangeAt === "function"
      ) {
        clearLocalUserChangeAt();
      } else if (
        !snapshotStillCurrent
        && typeof enqueueOfflineAction === "function"
      ) {
        enqueueOfflineAction(
          "sync_push",
          "Modification locale détectée pendant la synchronisation",
        );
      }
      localStorage.setItem(
        `${STORAGE_KEY}:last-cloud-autosave`,
        new Date().toISOString(),
      );
      localStorage.removeItem(
        `${STORAGE_KEY}:last-cloud-autosave-error`,
      );
      if (typeof renderSyncStatusStrip === "function") {
        renderSyncStatusStrip();
      }
      if (typeof setSupabaseDetails === "function") {
        const partial =
          stats.claimsSkipped || stats.supplementsSkipped
            ? " · tables récemment créées: cache Supabase en rafraîchissement, données JSON cloud OK"
            : "";
        const pending =
          snapshotStillCurrent
            ? ""
            : " · une modification locale plus récente reste en attente";
        setSupabaseDetails(
          `Sauvegarde automatique cloud OK (${reason}) : ${
            new Date().toLocaleTimeString()
          }${partial}${pending}`,
        );
      }
      return acknowledgement;
    } catch (error) {
      console.warn("Sauvegarde automatique Supabase impossible", error);
      localStorage.setItem(`${STORAGE_KEY}:last-cloud-autosave-error`, String(error.message || error));
      if (!options.requireAck && typeof enqueueOfflineAction === "function") {
        enqueueOfflineAction("sync_push", "Sauvegarde automatique échouée");
      }
      if (typeof renderSyncStatusStrip === "function") renderSyncStatusStrip();
      if (options.requireAck) throw error;
      return { acknowledged: false, reason: "error", error: String(error?.message || error) };
    } finally {
      autoSupabaseBackupRunning = false;
    }
  })();

  autoSupabaseBackupPromise = run;
  try {
    return await run;
  } finally {
    if (autoSupabaseBackupPromise === run) autoSupabaseBackupPromise = null;
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
  if (!stats.conflictEntries) stats.conflictEntries = [];
  const entryKey = typeof buildSyncConflictKey === "function" ? buildSyncConflictKey(conflict) : (conflict.conflictKey || "");
  const isAlreadyOpen = (
    stats.conflictEntries.some(e => e.conflictKey === entryKey) ||
    (state?.syncConflicts || []).some(e => (e.conflictKey === entryKey || (conflict.caseId && e.caseId === conflict.caseId && e.status === "open" && conflict.field === e.field)))
  );
  if (isAlreadyOpen) return null;

  const entityType = conflict.entityType || conflict.entity || "case";
  let label = conflict.label;
  if (!label) {
    label = conflict.field === "appointmentStatus" ? "Conflit statut RDV" : `Conflit ${entityType}`;
  }
  let details = conflict.details || conflict.reason;
  if (!details) {
    if (conflict.field === "appointmentStatus") {
      details = `Conflit sur le statut RDV pour le dossier ${conflict.caseNumber || conflict.caseId || ""}.`;
    } else {
      details = "Données locales protégées conservées.";
    }
  }
  const entry = {
    id: uid("sync-conflict"),
    at: new Date().toISOString(),
    resolution: "kept_local",
    decision: "kept_local",
    status: "open",
    ...conflict,
    label,
    details,
    conflictKey: entryKey,
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
  "ownerName", "driverName", "driverPhone", "insurance",
  "expertName", "expertPhone", "expertEmail", "damageNotes", "arrivalNotes", "receptionNotes",
  "appointment", "appointmentStatus", "partsStatus",
  "blockerReason", "blockerDetails", "orNavNumber", "planningColor",
  "durations", "stepServiceTypes", "stepPreferredResources", "stepAssignmentLocks",
  "source", "importedAt", "pdfImportStatus", "pdfValidatedAt", "pdfValidatedBy",
  "pdfEstimateFileName", "pdfImportWarning", "pdfImportTaskCount",
  "closedAt", "archivedAt"
];

function isEmptySyncValue(value) {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === "object" && Object.keys(value).length === 0) return true;
  return false;
}

function normalizeSyncComparableValue(value) {
  if (isEmptySyncValue(value)) return null;
  if (typeof value === "object") return stableSyncStringify(value);
  return String(value).trim();
}

function stableSyncStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableSyncStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSyncStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function makeSupabaseConflictHash(value) {
  const text = stableSyncStringify(value ?? "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function buildSupabaseConflictKey(context = {}) {
  const entityType = context.entityType || context.entity || "case";
  const entityId = context.entityId || context.caseId || "";
  const field = context.field || "";
  const localHash = context.localValueHash || makeSupabaseConflictHash(context.localValue);
  const remoteHash = context.remoteValueHash || makeSupabaseConflictHash(context.remoteValue);
  if (field) {
    const sorted = [localHash, remoteHash].sort();
    return [entityType, entityId, field, sorted[0], sorted[1]].map((part) => String(part || "-")).join(":");
  }
  return [entityType, entityId, field, localHash, remoteHash].map((part) => String(part || "-")).join(":");
}

function pushCaseFieldConflict(stats, context) {
  const now = new Date().toISOString();
  const localValueHash = makeSupabaseConflictHash(context.localValue);
  const remoteValueHash = makeSupabaseConflictHash(context.remoteValue);

  let label = context.label;
  if (!label) {
    label = context.field === "appointmentStatus" ? "Conflit statut RDV" : "Conflit dossier";
  }

  let details = context.details || context.reason;
  if (!details) {
    if (context.field === "appointmentStatus") {
      details = `Conflit sur le statut RDV pour le dossier ${context.caseNumber || context.caseId || ""}.`;
    } else {
      details = "Valeurs locales et cloud différentes sur champ critique.";
    }
  }

  const entry = {
    id: uid("sync-conflict"),
    at: now,
    createdAt: now,
    type: "case_field_conflict",
    entityType: "case",
    entity: "case",
    entityId: context.caseId,
    caseId: context.caseId,
    caseNumber: context.caseNumber,
    field: context.field,
    localValue: context.localValue,
    remoteValue: context.remoteValue,
    localValueHash,
    remoteValueHash,
    conflictKey: buildSupabaseConflictKey({ ...context, entityType: "case", entityId: context.caseId, localValueHash, remoteValueHash }),
    decision: context.decision,
    status: context.status || "open",
    reason: context.reason,
    source: context.source || "supabase",
    level: "warn",
    actorName: "Système",
    label,
    details
  };
  stats.conflictEntries.push(entry);
  if (entry.status === "open") {
    stats.conflicts += 1;
  }
  return entry;
}

function hasRealBooking(caseId, bookings) {
  if (!caseId) return false;
  let list = [];
  if (Array.isArray(bookings) && bookings.length > 0) {
    list = bookings;
  } else {
    try {
      if (typeof state !== "undefined" && state && Array.isArray(state.bookings)) {
        list = state.bookings;
      }
    } catch (e) {
      // state is in Temporal Dead Zone during startup
    }
  }
  return list.some((b) => {
    if (b.caseId !== caseId) return false;
    if (b.type === "leave" || b.type === "absence" || b.caseId === "__leave__") return false;
    if (b.temporary === true) return false;
    if (b.status === "cancelled" || b.status === "deleted") return false;
    if (b.deletedAt && b.deletedAt !== "") return false;
    return true;
  });
}

function resolveCanonicalAppointmentStatus(localCase, remoteCase, localState, remoteState) {
  const localVal = localCase?.appointmentStatus || "none";
  const remoteVal = remoteCase?.appointmentStatus || "none";

  if (localVal === remoteVal) return null;

  const localHas = hasRealBooking(localCase?.id, localState?.bookings);
  const remoteHas = hasRealBooking(remoteCase?.id, remoteState?.bookings);
  const hasPlanning = localHas || remoteHas;

  if (hasPlanning) {
    return "scheduled";
  }

  // If neither has planning:
  if ((localVal === "scheduled" && remoteVal === "none") || (localVal === "none" && remoteVal === "scheduled")) {
    return "none";
  }
  if ((localVal === "scheduled" && remoteVal === "no_show") || (localVal === "no_show" && remoteVal === "scheduled")) {
    return "no_show";
  }
  if ((localVal === "scheduled" && remoteVal === "reschedule_pending") || (localVal === "reschedule_pending" && remoteVal === "scheduled")) {
    return "reschedule_pending";
  }

  return null;
}

function mergeCriticalCaseField(localCase, remoteCase, field, stats, localState = {}, remoteState = {}) {
  const localVal = localCase[field];
  const remoteVal = remoteCase[field];
  const localIsEmpty = isEmptySyncValue(localVal);
  const remoteIsEmpty = isEmptySyncValue(remoteVal);

  if (localIsEmpty && !remoteIsEmpty) return remoteVal;
  if (!localIsEmpty && remoteIsEmpty) {
    pushCaseFieldConflict(stats, {
      caseId: localCase.id,
      caseNumber: localCase.orNavNumber || localCase.id,
      field,
      localValue: localVal,
      remoteValue: remoteVal,
      decision: "kept_local",
      reason: "Valeur distante vide ignorée pour éviter une suppression silencieuse."
    });
    return localVal;
  }

  const localNorm = normalizeSyncComparableValue(localVal);
  const remoteNorm = normalizeSyncComparableValue(remoteVal);

  if (localNorm === remoteNorm) return localVal;

  if (field === "appointmentStatus") {
    const canonicalValue = resolveCanonicalAppointmentStatus(localCase, remoteCase, localState, remoteState);
    if (canonicalValue !== null) {
      pushCaseFieldConflict(stats, {
        caseId: localCase.id,
        caseNumber: localCase.orNavNumber || localCase.id,
        field,
        localValue: localVal,
        remoteValue: remoteVal,
        decision: "kept_canonical",
        status: "resolved",
        reason: "Auto-résolution du statut RDV basé sur les données de planning réelles.",
        label: "Conflit statut RDV",
        details: `Auto-résolution : valeur '${canonicalValue}' choisie pour le dossier ${localCase.orNavNumber || localCase.id} car le planning réel ${hasRealBooking(localCase.id, localState?.bookings) || hasRealBooking(remoteCase.id, remoteState?.bookings) ? "existe" : "n'existe pas"}.`
      });
      return canonicalValue;
    }
  }

  if (isProtectedCase(localCase)) {
    pushCaseFieldConflict(stats, {
      caseId: localCase.id,
      caseNumber: localCase.orNavNumber || localCase.id,
      field,
      localValue: localVal,
      remoteValue: remoteVal,
      decision: "kept_local",
      reason: "Dossier local livré/facturé/clôturé protégé conservé."
    });
    return localVal;
  }

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

function mergeCaseEntity(localCase, remoteCase, stats, localState = {}, remoteState = {}) {
  if (!localCase) {
    stats.casesMerged += 1;
    return remoteCase;
  }
  if (!remoteCase) {
    stats.protectedKept += 1;
    return localCase;
  }

  const hasRevisionMetadata = [localCase.localRevision, localCase.syncRevision, remoteCase.localRevision, remoteCase.syncRevision]
    .some((value) => Number(value || 0) > 0);
  if (!hasRevisionMetadata) {
    const mergedCriticalCase = { ...localCase };
    CRITICAL_CASE_SYNC_FIELDS.forEach((field) => {
      if (localCase[field] === undefined && remoteCase[field] === undefined) return;
      mergedCriticalCase[field] = mergeCriticalCaseField(localCase, remoteCase, field, stats, localState, remoteState);
    });
    return mergedCriticalCase;
  }

  const getComparable = typeof getComparableCaseJSON === "function"
    ? getComparableCaseJSON
    : ((typeof window !== "undefined" && window.getComparableCaseJSON) || ((c) => JSON.stringify(c)));

  const localModified = Number(localCase.localRevision || 0) > Number(localCase.syncRevision || 0);
  const remoteModified = Number(remoteCase.localRevision || 0) > Number(localCase.syncRevision || 0);
  const isDifferent = getComparable(localCase) !== getComparable(remoteCase);

  if (localModified && remoteModified && isDifferent) {
    const nowStr = new Date().toISOString();
    const localValHash = makeSupabaseConflictHash(localCase);
    const remoteValHash = makeSupabaseConflictHash(remoteCase);
    const sortedHashes = [localValHash, remoteValHash].sort();
    const conflictKey = `case:${localCase.id}:all:${sortedHashes[0]}:${sortedHashes[1]}`;

    const details = `Le dossier ${localCase.orNavNumber || localCase.id || ""} a été modifié localement (révision ${localCase.localRevision}) et sur le cloud (révision ${remoteCase.localRevision}).`;

    const entry = {
      id: uid("sync-conflict"),
      at: nowStr,
      createdAt: nowStr,
      type: "case_conflict",
      entityType: "case",
      entity: "case",
      entityId: localCase.id,
      caseId: localCase.id,
      caseNumber: localCase.orNavNumber || localCase.id,
      localCase: JSON.parse(JSON.stringify(localCase)),
      remoteCase: JSON.parse(JSON.stringify(remoteCase)),
      localValue: JSON.parse(JSON.stringify(localCase)),
      remoteValue: JSON.parse(JSON.stringify(remoteCase)),
      status: "open",
      decision: "needs_review",
      reason: "Modifications concurrentes locales et cloud.",
      label: "Conflit de synchronisation du dossier",
      details,
      conflictKey
    };

    if (!stats.conflictEntries) stats.conflictEntries = [];
    const isAlreadyOpen = (
      (localState?.syncConflicts || []).some(e => (e.conflictKey === conflictKey || (e.caseId === localCase.id && e.status === "open" && e.type === "case_conflict"))) ||
      stats.conflictEntries.some(e => e.conflictKey === conflictKey)
    );
    if (!isAlreadyOpen) {
      stats.conflictEntries.push(entry);
      stats.conflicts = (stats.conflicts || 0) + 1;
      stats.newConflicts = (stats.newConflicts || 0) + 1;
    }

    if (typeof logSyncConflict === "function") {
      logSyncConflict(localCase.id, details);
    }

    return localCase;
  }

  if (remoteModified && !localModified) {
    stats.casesMerged += 1;
    return {
      ...remoteCase,
      syncRevision: remoteCase.localRevision
    };
  }

  if (localModified && !remoteModified) {
    return localCase;
  }

  return localCase;
}

function mergeCasesById(localCases = [], remoteCases = [], stats = createEmptySyncMergeStats(), localState = {}, remoteState = {}) {
  const remoteById = new Map((Array.isArray(remoteCases) ? remoteCases : []).filter((item) => item?.id).map((item) => [item.id, item]));
  const usedRemoteIds = new Set();
  const cases = [];
  (Array.isArray(localCases) ? localCases : []).forEach((localCase) => {
    const remoteCase = localCase?.id ? remoteById.get(localCase.id) : null;
    if (remoteCase) usedRemoteIds.add(localCase.id);
    cases.push(mergeCaseEntity(localCase, remoteCase, stats, localState, remoteState));
  });
  (Array.isArray(remoteCases) ? remoteCases : []).forEach((remoteCase) => {
    if (!remoteCase?.id || usedRemoteIds.has(remoteCase.id)) return;
    cases.push(mergeCaseEntity(null, remoteCase, stats, localState, remoteState));
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
    newConflicts: 0,
    protectedKept: 0,
    conflictEntries: [],
  };
}

function mergeSyncConflictsForRemoteMerge(localConflicts = [], remoteConflicts = [], generatedConflicts = []) {
  const existing = normalizeSyncConflicts([...(localConflicts || []), ...(remoteConflicts || [])]);
  const existingByKey = new Map(existing.map((conflict) => [conflict.conflictKey || conflict.id, conflict]));
  const newEntries = [];
  normalizeSyncConflicts(generatedConflicts).forEach((conflict) => {
    const key = conflict.conflictKey || conflict.id;
    const previous = existingByKey.get(key);
    if (previous) {
      existingByKey.set(key, previous);
      return;
    }
    conflict.lastNotifiedAt = conflict.lastNotifiedAt || new Date().toISOString();
    newEntries.push(conflict);
    existingByKey.set(key, conflict);
  });
  return {
    conflicts: normalizeSyncConflicts(Array.from(existingByKey.values())),
    newEntries,
  };
}

function mergeRemoteStateIntoLocal(localState, remoteState, options = {}) {
  const stats = createEmptySyncMergeStats();
  const normalizedLocal = normalizeState(localState);
  const normalizedRemote = normalizeState(remoteState);
  const mergedCases = mergeCasesById(normalizedLocal.cases, normalizedRemote.cases, stats, normalizedLocal, normalizedRemote).cases;
  const localCaseById = new Map(normalizedLocal.cases.map((item) => [item.id, item]));
  const remoteCaseById = new Map(normalizedRemote.cases.map((item) => [item.id, item]));
  const mergedBookings = mergeBookingsById(normalizedLocal.bookings, normalizedRemote.bookings, stats, { localCaseById, remoteCaseById }).bookings;
  const workHoursMerge = typeof resolveWorkHoursRemoteMerge === "function"
    ? resolveWorkHoursRemoteMerge(
        normalizedLocal.workHours,
        normalizedRemote.workHours,
        { remoteUpdatedAt: options.remoteUpdatedAt || "" },
      )
    : {
        workHours: normalizedRemote.workHours,
        decision: "accept_remote_legacy",
        conflict: null,
      };
  if (workHoursMerge.conflict) stats.conflictEntries.push(workHoursMerge.conflict);
  const conflictMerge = mergeSyncConflictsForRemoteMerge(
    normalizedLocal.syncConflicts,
    normalizedRemote.syncConflicts,
    stats.conflictEntries,
  );
  stats.conflicts = conflictMerge.newEntries.length;
  stats.newConflicts = conflictMerge.newEntries.length;
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
    workHoursDecision: workHoursMerge.decision || "",
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
    syncConflicts: conflictMerge.conflicts,
    syncLog: [syncLogEntry, ...(normalizedLocal.syncLog || []), ...(normalizedRemote.syncLog || [])],
    settings: {
      ...(normalizedLocal.settings || {}),
      ...(normalizedRemote.settings || {}),
    },
    workHours: workHoursMerge.workHours,
    ui: normalizedLocal.ui,
    currentUserId: normalizedLocal.currentUserId || normalizedRemote.currentUserId,
  };
  return {
    state: normalizeState(mergedRaw),
    stats,
    log: syncLogEntry,
    conflicts: conflictMerge.newEntries,
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
  const entityType = conflict.entityType || conflict.entity || "case";
  let label = conflict.label;
  if (!label) {
    label = conflict.field === "appointmentStatus" ? "Conflit statut RDV" : `Conflit ${entityType}`;
  }
  let details = conflict.details || conflict.reason;
  if (!details) {
    if (conflict.field === "appointmentStatus") {
      details = `Conflit sur le statut RDV pour le dossier ${conflict.caseNumber || conflict.caseId || ""}.`;
    } else {
      details = "Conflit mémorisé.";
    }
  }
  const entry = {
    id: uid("sync-conflict"),
    at: new Date().toISOString(),
    resolution: "kept_local",
    decision: "kept_local",
    status: "open",
    ...conflict,
    label,
    details,
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

const RESTORE_SAFETY_SNAPSHOT_LOCAL_KEY =
  "nimr-sav-restore-safety-snapshot:last";
const RESTORE_SAFETY_SNAPSHOT_IDB_KEY =
  "restore-safety-snapshot:last";

function isRestoreSafetySnapshotQuotaError(error) {
  return Boolean(
    error
    && (
      error.name === "QuotaExceededError"
      || error.name === "NS_ERROR_DOM_QUOTA_REACHED"
      || error.code === 22
      || error.code === 1014
      || /quota/i.test(String(error.message || error))
    )
  );
}

async function saveRestoreSafetySnapshot(payload, metadata = {}) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Copie de sécurité locale invalide.");
  }

  const savedAt = new Date().toISOString();
  const payloadJson = JSON.stringify(payload);
  const record = {
    key: RESTORE_SAFETY_SNAPSHOT_IDB_KEY,
    savedAt,
    storage: "indexeddb",
    bytes: payloadJson.length * 2,
    casesCount: Number(payload.state?.cases?.length || 0),
    photosCount: Number(payload.photos?.length || 0),
    metadata: { ...metadata },
    payloadJson,
  };

  if (typeof runIndexedDbTransaction === "function") {
    try {
      await runIndexedDbTransaction(
        "sync_metadata",
        "readwrite",
        (store) => store.put(record),
      );

      try {
        localStorage.removeItem(
          RESTORE_SAFETY_SNAPSHOT_LOCAL_KEY,
        );
        localStorage.setItem(
          RESTORE_SAFETY_SNAPSHOT_LOCAL_KEY,
          JSON.stringify({
            storage: "indexeddb",
            key: RESTORE_SAFETY_SNAPSHOT_IDB_KEY,
            savedAt,
            bytes: record.bytes,
            casesCount: record.casesCount,
            photosCount: record.photosCount,
          }),
        );
      } catch (metadataError) {
        console.warn(
          "Index local du snapshot de sécurité non mémorisé",
          metadataError?.message || metadataError,
        );
      }

      return {
        saved: true,
        storage: "indexeddb",
        savedAt,
        bytes: record.bytes,
      };
    } catch (indexedDbError) {
      console.warn(
        "Snapshot de sécurité IndexedDB impossible, repli localStorage",
        indexedDbError?.message || indexedDbError,
      );
    }
  }

  try {
    localStorage.setItem(
      RESTORE_SAFETY_SNAPSHOT_LOCAL_KEY,
      payloadJson,
    );
    return {
      saved: true,
      storage: "localStorage",
      savedAt,
      bytes: payloadJson.length * 2,
    };
  } catch (storageError) {
    const quotaExceeded =
      isRestoreSafetySnapshotQuotaError(storageError);
    console.warn(
      quotaExceeded
        ? "Quota localStorage insuffisant pour le snapshot de sécurité"
        : "Snapshot de sécurité local non mémorisé",
      storageError?.message || storageError,
    );
    if (typeof addAuditLog === "function") {
      addAuditLog("storage.safety_snapshot_failed", {
        type: "restore_safety_snapshot",
        storage: "localStorage",
        quotaExceeded,
        bytes: payloadJson.length * 2,
        timestamp: savedAt,
        error: storageError?.message || String(storageError),
      });
    }
    return {
      saved: false,
      storage: "none",
      savedAt,
      bytes: payloadJson.length * 2,
      quotaExceeded,
      error: storageError?.message || String(storageError),
    };
  }
}

async function createRequiredRestoreSafetySnapshot(payload, metadata = {}) {
  const result = await saveRestoreSafetySnapshot(payload, metadata);
  if (!result.saved) {
    setSupabaseStatus(
      "Synchronisation interrompue : copie de sécurité locale impossible.",
      "error",
    );
    setSupabaseDetails(
      "Les données locales ont été conservées. Libérez de l'espace de stockage "
        + "ou exportez une sauvegarde JSON avant de relancer l'opération.",
    );
    if (typeof notifyUser === "function") {
      notifyUser(
        "Opération annulée : aucune copie de sécurité locale n'a pu être créée.",
        "error",
      );
    }
    if (typeof refreshSupabasePanel === "function") {
      setTimeout(refreshSupabasePanel, 0);
    }
    return { ...result, allowed: false };
  }

  if (typeof addAuditLog === "function") {
    const snapshotType =
      metadata.type || "restore_safety_snapshot";
    const snapshotLabel =
      snapshotType === "cloud_merge_replace"
        ? "Copie de sécurité avant fusion cloud créée"
        : "Copie de sécurité avant restauration créée";
    const snapshotDetails = [
      `type=${snapshotType}`,
      `storage=${result.storage}`,
      `bytes=${Number(result.bytes || 0)}`,
      `timestamp=${
        result.savedAt || new Date().toISOString()
      }`,
    ].join(" ; ");
    addAuditLog(
      "conflict.safety_snapshot.created",
      snapshotLabel,
      snapshotDetails,
    );
  }
  if (typeof refreshSupabasePanel === "function") {
    setTimeout(refreshSupabasePanel, 0);
  }
  return { ...result, allowed: true };
}

async function loadRestoreSafetySnapshot() {
  if (typeof runIndexedDbTransaction === "function") {
    try {
      const record = await runIndexedDbTransaction(
        "sync_metadata",
        "readonly",
        (store) => store.get(RESTORE_SAFETY_SNAPSHOT_IDB_KEY),
      );
      if (record?.payload && typeof record.payload === "object") {
        return record.payload;
      }
      if (typeof record?.payloadJson === "string") {
        return JSON.parse(record.payloadJson);
      }
    } catch (indexedDbError) {
      console.warn(
        "Lecture du snapshot de sécurité IndexedDB impossible",
        indexedDbError?.message || indexedDbError,
      );
    }
  }

  const snapshotStr = localStorage.getItem(
    RESTORE_SAFETY_SNAPSHOT_LOCAL_KEY,
  );
  if (!snapshotStr) return null;

  const parsed = JSON.parse(snapshotStr);
  if (
    parsed?.storage === "indexeddb"
    && parsed?.key === RESTORE_SAFETY_SNAPSHOT_IDB_KEY
  ) {
    return null;
  }
  return parsed;
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
      + "Continuer va créer une copie locale de sécurité puis fusionner ce poste avec la version cloud. Annuler conserve ce poste inchangé.",
  );
  if (!confirmed) {
    remoteConflictMutedUntil = Date.now() + 60 * 1000;
    setSupabaseDetails("Synchronisation entrante annulée : modifications locales conservées sur ce poste.");
    return false;
  }
  const safetyPayload = await buildBackupPayload();
  const safetySnapshotGate = await createRequiredRestoreSafetySnapshot(
    safetyPayload,
    {
      type: "cloud_merge_replace",
      reason,
      remoteUpdatedAt: data.updated_at || "",
    },
  );
  return safetySnapshotGate.allowed;
}

async function applyRemoteSupabaseBackup(data, reason = "cloud") {
  if (!shouldApplyRemoteBackup(data)) return false;
  const canApply = await confirmRemoteBackupConflict(data, reason);
  if (!canApply) return false;
  applyingRemoteSupabaseState = true;
  try {
    const previousSelection = typeof captureCaseSelectionIdentity === "function"
      ? captureCaseSelectionIdentity()
      : { id: activeCaseId };
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
    if (typeof initializeLastKnownCasesComparable === "function") {
      initializeLastKnownCasesComparable();
    }
    if (typeof reconcileActiveCaseSelection === "function") reconcileActiveCaseSelection(previousSelection);
    else activeCaseId = state.cases[0]?.id ?? null;
    activeCaseDetailTab = previousTab || "resume";
    generatedProposals = {};
    if (Array.isArray(data.photos)) {
      await restorePhotoRecords(data.photos);
    }
    lastKnownCloudUpdatedAt = getTimestampMs(data.updated_at) || Date.now();
    if (typeof rememberKnownCloudUpdatedAt === "function") rememberKnownCloudUpdatedAt(lastKnownCloudUpdatedAt);
    const openConflicts = typeof getOpenSyncConflicts === "function" ? getOpenSyncConflicts().length : 0;
    if (mergeResult.stats.newConflicts > 0) {
      if (typeof rememberLocalUserChangeAt === "function") rememberLocalUserChangeAt(new Date());
    } else if (!openConflicts && typeof clearLocalUserChangeAt === "function") {
      clearLocalUserChangeAt();
    }
    saveState({ skipCloud: true });
    render();
    if (mergeResult.stats.newConflicts > 0) {
      setSupabaseStatus("Conflit de synchronisation détecté.", "warn");
      setSupabaseDetails(`Données locales protégées conservées : ${mergeResult.stats.newConflicts} nouveau(x) conflit(s), ${mergeResult.stats.protectedKept} élément(s) protégé(s).`);
      notifyUser("Conflit de synchronisation détecté — données locales conservées.", "warn");
    } else if (openConflicts) {
      setSupabaseStatus("Synchronisé avec conflit à résoudre.", "warn");
      setSupabaseDetails(`${openConflicts} conflit(s) de synchronisation déjà signalé(s) restent à traiter. Aucune nouvelle alerte répétée.`);
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
  if (supabaseLivePullPromise) return supabaseLivePullPromise;

  const run = (async () => {
    const permissionGuard =
      typeof guardSensitiveAction === "function"
        ? guardSensitiveAction(
            "supabase.access",
            {},
            { notify: false },
          )
        : { ok: false };
    if (!permissionGuard.ok) return false;
    const client = getSupabaseClient();
    const user = await getSupabaseUser();
    if (!client || !user || navigator.onLine === false) {
      return false;
    }
    try {
      const data = await fetchLatestCloudBackup(client);
      return await applyRemoteSupabaseBackup(data, reason);
    } catch (error) {
      console.warn("Lecture cloud live impossible", error);
      return false;
    }
  })();

  supabaseLivePullPromise = run;
  try {
    return await run;
  } finally {
    if (supabaseLivePullPromise === run) {
      supabaseLivePullPromise = null;
    }
  }
}

// REMPLACER l'ancienne fonction startSupabaseLiveSync par celle-ci
function startSupabaseLiveSync() {
  const permissionGuard = typeof guardSensitiveAction === "function"
    ? guardSensitiveAction("supabase.access", {}, { notify: false })
    : { ok: false };
  if (!permissionGuard.ok) return;
  
  const client = getSupabaseClient();
  if (!client || supabaseLiveSyncChannel) return;
  
  const workshopId = getSupabaseWorkshopId();
  
  // Nouvelle fonction pour gérer les changements en temps réel de manière granulaire
  const handleGranularChange = (payload) => {
    const row = payload.new || payload.old || {};
    if (row.workshop_id && row.workshop_id !== workshopId) return;
    
    const eventId = [payload.table, row.id || row.local_id, payload.commit_timestamp || row.updated_at || "event"].join(":");
    if (processedRealtimeEventIds.has(eventId)) return;
    processedRealtimeEventIds.add(eventId);
    if (processedRealtimeEventIds.size > 500) processedRealtimeEventIds.delete(processedRealtimeEventIds.values().next().value);
    
    window.NIMR_REALTIME_STATUS = { connected: true, workshopId, lastEventAt: new Date().toISOString(), lastEventId: eventId };
    
    // On attend 200ms pour éviter les déclenchements multiples trop rapides
    window.setTimeout(async () => {
      // Si c'est un dossier qui change, on le met à jour directement dans l'état local
      if (payload.table === "repair_orders") {
        handleRemoteCaseChange(payload.new, payload.eventType);
      } else {
        // Pour les autres tables, on force un rafraîchissement léger
        if (typeof pullLatestSupabaseBackup === "function") await pullLatestSupabaseBackup(`realtime:${payload.table}`);
      }
      if (typeof processOfflineQueue === "function") await processOfflineQueue();
    }, 200);
  };

  try {
    supabaseLiveSyncChannel = client
      .channel(`nimr-sav-live-${workshopId}`)
      // On écoute la table des dossiers
      .on("postgres_changes", { event: "*", schema: "public", table: "repair_orders", filter: `workshop_id=eq.${workshopId}` }, handleGranularChange)
      // On écoute la table du planning
      .on("postgres_changes", { event: "*", schema: "public", table: "planning_slots", filter: `workshop_id=eq.${workshopId}` }, handleGranularChange)
      // On écoute les ressources
      .on("postgres_changes", { event: "*", schema: "public", table: "planning_resources", filter: `workshop_id=eq.${workshopId}` }, handleGranularChange)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          window.NIMR_REALTIME_STATUS = { connected: true, workshopId, subscribedAt: new Date().toISOString(), lastEventAt: "" };
          setSupabaseDetails("Synchronisation temps réel granulaire active.");
        }
        if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
          window.NIMR_REALTIME_STATUS = { connected: false, workshopId, status, updatedAt: new Date().toISOString() };
          setSupabaseDetails("Realtime indisponible temporairement : polling de secours actif.");
        }
      });
  } catch (error) {
    console.warn("Realtime Supabase indisponible, polling actif", error);
    supabaseLiveSyncChannel = null;
  }
  
  // Polling de secours : on passe de 3 secondes à 15 secondes pour réduire la charge réseau
  // car le Realtime granulaire prend le relais
  window.clearInterval(supabaseLivePullTimer);
  supabaseLivePullTimer = window.setInterval(() => {
    pullLatestSupabaseBackup("poll-secours");
    if (typeof processOfflineQueue === "function") processOfflineQueue();
  }, 15000); 
}

// AJOUTER cette nouvelle fonction pour mettre à jour un dossier sans tout recharger
function handleRemoteCaseChange(remoteCase, eventType) {
  if (!remoteCase || !remoteCase.id) return;
  
  // Si le dossier a été supprimé sur un autre poste
  if (eventType === "DELETE") {
    state.cases = state.cases.filter(c => c.id !== remoteCase.id);
    if (typeof render === "function") render();
    return;
  }
  
  // Chercher si le dossier existe déjà localement
  const localIndex = state.cases.findIndex(c => c.id === remoteCase.id);
  
  if (localIndex !== -1) {
    // Le dossier existe : on ne l'écrase que si la version distante est plus récente
    const localRev = Number(state.cases[localIndex].localRevision || 0);
    const remoteRev = Number(remoteCase.version || 0);
    
    if (remoteRev >= localRev) {
      // Fusion basique : on garde les données locales non synchronisées si besoin, 
      // mais on prend les champs principaux du distant
      state.cases[localIndex] = {
        ...state.cases[localIndex],
        ...remoteCase,
        syncRevision: remoteRev,
        localRevision: remoteRev // On aligne la révision locale
      };
      if (typeof render === "function") render();
    }
  } else {
    // Nouveau dossier créé sur un autre poste : on l'ajoute localement
    state.cases.push({
      ...remoteCase,
      syncRevision: Number(remoteCase.version || 0),
      localRevision: Number(remoteCase.version || 0)
    });
    if (typeof render === "function") render();
  }
}

function stopSupabaseLiveSync() {
  const client = getSupabaseClient();
  if (client && supabaseLiveSyncChannel) {
    try { client.removeChannel(supabaseLiveSyncChannel); } catch (error) { console.warn("Arrêt realtime Supabase impossible", error); }
  }
  supabaseLiveSyncChannel = null;
  window.NIMR_REALTIME_STATUS = { connected: false, workshopId: typeof getSupabaseWorkshopId === "function" ? getSupabaseWorkshopId() : "", stoppedAt: new Date().toISOString() };
  window.clearInterval(supabaseLivePullTimer);
  supabaseLivePullTimer = null;
}

function setSyncHealthValue(key, value, stateName = "") {
  const element = document.querySelector(`[data-sync-health="${key}"]`);
  if (!element) return;
  element.textContent = String(value ?? "—");
  element.dataset.state = stateName;
}

async function getSupabaseServerCounts(client, user) {
  if (!client || !user || navigator.onLine === false) return { cases: null, resources: null, error: "" };
  try {
    const [casesResult, resourcesResult] = await Promise.all([
      client.from("repair_orders").select("id", { count: "exact", head: true }).eq("workshop_id", getSupabaseWorkshopId()),
      client.from("planning_resources").select("id", { count: "exact", head: true }).eq("workshop_id", getSupabaseWorkshopId()),
    ]);
    const error = casesResult.error || resourcesResult.error;
    return {
      cases: Number.isFinite(casesResult.count) ? casesResult.count : null,
      resources: Number.isFinite(resourcesResult.count) ? resourcesResult.count : null,
      error: error ? String(error.message || error) : "",
    };
  } catch (error) {
    return { cases: null, resources: null, error: String(error?.message || error) };
  }
}

async function resolveAtomicPlanningResourceIds(client, requestedIds = []) {
  const localIds = [...new Set(requestedIds.map((value) => String(value || "").trim()).filter(Boolean))];
  if (!localIds.length) return new Map();

  const { data, error } = await client
    .from("planning_resources")
    .select("id,local_id")
    .eq("workshop_id", getSupabaseWorkshopId());
  if (error) {
    throw new Error(`Résolution des ressources Supabase impossible : ${error.message || error}`);
  }

  const resourceMap = new Map();
  (Array.isArray(data) ? data : []).forEach((row) => {
    if (!row?.id) return;
    resourceMap.set(String(row.id), String(row.id));
    if (row.local_id) resourceMap.set(String(row.local_id), String(row.id));
  });
  const missing = localIds.filter((resourceId) => !resourceMap.has(resourceId));
  if (missing.length) {
    throw new Error(`Ressources planning absentes de Supabase : ${missing.join(", ")}. Synchronisez les ressources puis réessayez.`);
  }
  return resourceMap;
}

async function reservePlanningProposalAtomically(item, proposal) {
  if (!isSupabaseConfigured()) return { skipped: true, reason: "supabase-not-configured" };
  if (navigator.onLine === false) throw new Error("Réservation serveur impossible hors ligne. La proposition reste non validée.");
  const client = getSupabaseClient();
  const user = await getSupabaseUser();
  if (!client || !user) throw new Error("Connexion Supabase requise pour réserver ce planning.");
  const steps = Array.isArray(proposal.steps) ? proposal.steps : [];
  const requestedResourceIds = steps.flatMap((step) => [
    ...(Array.isArray(step.resourceIds) ? step.resourceIds : []),
    ...(Array.isArray(step.equipmentResourceIds) ? step.equipmentResourceIds : []),
  ]);
  const resourceMap = await resolveAtomicPlanningResourceIds(client, requestedResourceIds);
  const planningCaseReference = caseSyncLocalId(item) || item.orNavNumber || item.id;
  let expectedPlanningVersion = Number(
    item.serverPlanningVersion
    ?? item.planningVersion
    ?? item.planning_version
    ?? item.serverVersion
    ?? 0
  );

  const {
    data: currentOrder,
    error: currentOrderError,
  } = await client
    .from("repair_orders")
    .select("planning_version")
    .eq("workshop_id", getSupabaseWorkshopId())
    .eq("local_id", planningCaseReference)
    .maybeSingle();

  if (currentOrderError) {
    throw new Error(
      `Lecture de la version planning Supabase impossible : ${
        currentOrderError.message || currentOrderError
      }`,
    );
  }

  if (currentOrder?.planning_version != null) {
    expectedPlanningVersion = Number(
      currentOrder.planning_version || 0,
    );
    item.serverPlanningVersion = expectedPlanningVersion;
    item.serverVersion = expectedPlanningVersion;
  }
  const idempotencyKey = `planning:${getSupabaseWorkshopId()}:${planningCaseReference}:${Number(item.localRevision || 0)}:${makeSupabaseConflictHash({ start: proposal.start, steps })}`;
  const bookings = steps.flatMap((step) => {
    const taskId = step.taskId || step.key || "";
    const resourceIds = [...new Set((step.resourceIds || []).map((resourceId) => resourceMap.get(String(resourceId))).filter(Boolean))];
    const equipmentResourceIds = [...new Set((step.equipmentResourceIds || []).map((resourceId) => resourceMap.get(String(resourceId))).filter(Boolean))];
    const segments = Array.isArray(step.segments) && step.segments.length
      ? step.segments
      : [{ start: step.start, end: step.end }];
    return segments.map((segment, segmentIndex) => ({
      localId: `${planningCaseReference}:${taskId}:${segmentIndex}:${segment.start}`,
      taskId,
      stepKey: step.key || taskId,
      title: step.title || "Tâche atelier",
      dependencies: Array.isArray(step.dependencies)
        ? [...step.dependencies]
        : [],
      startAt: segment.start,
      endAt: segment.end,
      resourceIds,
      primaryResourceId: resourceMap.get(String(step.primaryResourceId || "")) || resourceIds[0] || null,
      equipmentResourceIds,
      status: "planned",
      vehicleExclusive: step.vehicleExclusive !== false,
      vehicleLocation: step.vehicleLocation || "internal",
      serviceMode: step.serviceMode || "internal",
      plannedMinutes: Math.max(0, Math.round((new Date(segment.end) - new Date(segment.start)) / 60000)),
      expectedVersion: Number(step.serverVersion ?? step.version ?? 0),
    }));
  });
  const { data, error } = await client.rpc("nimr_reserve_planning_atomic", {
    p_workshop_id: getSupabaseWorkshopId(),
    p_case_id: planningCaseReference,
    p_expected_version: expectedPlanningVersion,
    p_idempotency_key: idempotencyKey,
    p_bookings: bookings,
  });
  if (error) {
    const conflict = /conflict|overlap|version|23P01|409/i.test(String(error.message || error));
    const wrapped = new Error(conflict
      ? "Conflit de réservation : un autre poste a pris ce créneau. Recalculez le planning."
      : `Réservation atomique Supabase impossible : ${error.message || error}`);
    wrapped.name = conflict ? "PlanningConflictError" : "SupabaseAtomicBookingError";
    throw wrapped;
  }
  if (!data || data.ok === false) {
    const wrapped = new Error(data?.message || "La réservation atomique n'a pas été confirmée par le serveur.");
    wrapped.name = data?.conflict || data?.status === "conflict" || /conflict|overlap|version/i.test(String(data?.code || ""))
      ? "PlanningConflictError"
      : "SupabaseAtomicBookingError";
    throw wrapped;
  }
  item.serverPlanningVersion = Number(data.planningVersion ?? data.version ?? data.new_version ?? item.serverPlanningVersion ?? item.serverVersion ?? 0);
  item.serverVersion = item.serverPlanningVersion;
  return { ...data, acknowledged: true, idempotencyKey };
}

if (typeof window !== "undefined") window.reservePlanningProposalAtomically = reservePlanningProposalAtomically;

async function renderSupabaseSyncHealth() {
  if (typeof document === "undefined" || typeof document.getElementById !== "function" || !document.getElementById("supabase-sync-health")) return;
  const configured = isSupabaseConfigured();
  const online = navigator.onLine !== false;
  const client = getSupabaseClient();
  const user = client ? await getSupabaseUser() : null;
  const operations = typeof loadDurableOutboxOperations === "function" ? await loadDurableOutboxOperations() : [];
  const pending = operations.filter((entry) => ["pending", "processing", "failed", "conflict"].includes(entry.syncStatus)).length;
  const outboxConflicts = operations.filter((entry) => entry.syncStatus === "conflict").length;
  const stateConflicts = typeof getOpenSyncConflicts === "function" ? getOpenSyncConflicts().length : 0;
  const actor = typeof getCurrentActor === "function" ? getCurrentActor() : {};
  const realtime = window.NIMR_REALTIME_STATUS || { connected: false };
  const lastSync = localStorage.getItem(`${STORAGE_KEY}:last-cloud-autosave`) || "";
  const cloudError = localStorage.getItem(`${STORAGE_KEY}:last-cloud-autosave-error`) || "";
  const lastOutboxError = operations.findLast?.((entry) => entry.lastError)?.lastError
    || operations.slice().reverse().find((entry) => entry.lastError)?.lastError
    || "";
  const server = await getSupabaseServerCounts(client, user);
  const connectionOk = Boolean(configured && online && client && user);

  setSyncHealthValue("connection", !configured ? "Non configurée" : !online ? "Hors ligne" : user ? "Connectée et authentifiée" : "Authentification requise", connectionOk ? "ok" : "warn");
  setSyncHealthValue("identity", `${user?.email || actor.userName || "Non connecté"} / ${getSupabaseWorkshopId()} / ${actor.userRole || actor.role || "inconnu"}`, user ? "ok" : "warn");
  setSyncHealthValue("versions", `schéma ${typeof CURRENT_DATA_SCHEMA_VERSION === "number" ? CURRENT_DATA_SCHEMA_VERSION : state?.dataSchemaVersion || "—"} / ${APP_VERSION}`);
  setSyncHealthValue("realtime", realtime.connected ? `Actif · atelier ${realtime.workshopId || getSupabaseWorkshopId()}` : "Inactif · polling de secours", realtime.connected ? "ok" : "warn");
  setSyncHealthValue("last-sync", lastSync ? new Date(lastSync).toLocaleString("fr-FR") : "Jamais confirmé", lastSync && pending === 0 ? "ok" : "warn");
  setSyncHealthValue("cases", `${Number(state?.cases?.length || 0)} / ${server.cases ?? "—"}`, server.cases === null ? "warn" : "ok");
  setSyncHealthValue("resources", `${Number(state?.resources?.length || 0)} / ${server.resources ?? "—"}`, server.resources === null ? "warn" : "ok");
  setSyncHealthValue("pending", pending, pending ? "warn" : "ok");
  setSyncHealthValue("conflicts", outboxConflicts + stateConflicts, outboxConflicts + stateConflicts ? "error" : "ok");
  setSyncHealthValue("error", lastOutboxError || cloudError || server.error || "Aucune", lastOutboxError || cloudError || server.error ? "error" : "ok");
}

async function exportSupabaseSyncDiagnostic() {
  const operations = typeof loadDurableOutboxOperations === "function" ? await loadDurableOutboxOperations() : [];
  const diagnostic = {
    generatedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    schemaVersion: typeof CURRENT_DATA_SCHEMA_VERSION === "number" ? CURRENT_DATA_SCHEMA_VERSION : state?.dataSchemaVersion,
    configured: isSupabaseConfigured(),
    online: navigator.onLine !== false,
    workshopId: getSupabaseWorkshopId(),
    realtime: window.NIMR_REALTIME_STATUS || { connected: false },
    localCounts: { cases: state?.cases?.length || 0, bookings: state?.bookings?.length || 0, resources: state?.resources?.length || 0 },
    outbox: operations.map(({ payload, ...entry }) => ({ ...entry, payloadSummary: {
      casesCount: payload?.casesCount,
      bookingsCount: payload?.bookingsCount,
      resourcesCount: payload?.resourcesCount,
    } })),
    openConflictCount: typeof getOpenSyncConflicts === "function" ? getOpenSyncConflicts().length : 0,
    lastServerConfirmation: localStorage.getItem(`${STORAGE_KEY}:last-cloud-autosave`) || "",
    lastError: localStorage.getItem(`${STORAGE_KEY}:last-cloud-autosave-error`) || "",
  };
  downloadJson(diagnostic, `nimr-sav-sync-diagnostic-${todayKey(new Date())}.json`);
}

function bindSupabaseSyncHealthActions() {
  $("#supabase-sync-retry")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await processOfflineQueue();
      await pullLatestSupabaseBackup("relance-manuelle");
      await renderSupabaseSyncHealth();
    } finally {
      button.disabled = false;
    }
  });
  $("#supabase-sync-export-diagnostic")?.addEventListener("click", () => exportSupabaseSyncDiagnostic().catch((error) => notifyUser(error.message || "Export diagnostic impossible.", "error")));
  $("#supabase-sync-show-errors")?.addEventListener("click", () => {
    setActiveTab("atelier");
    const panel = document.getElementById("panel-activity-log");
    if (panel) panel.hidden = false;
    const filter = document.getElementById("activity-log-filter");
    if (filter) filter.value = "errors";
    if (typeof renderActivityLog === "function") renderActivityLog();
  });
  $("#supabase-sync-show-conflicts")?.addEventListener("click", () => navigateToConflictsAndFocus());
  $("#supabase-sync-export-backup")?.addEventListener("click", () => exportSafetySnapshotNow());
}

function bindSupabaseActions() {
  if (typeof bindSupabaseConfigForm === "function") bindSupabaseConfigForm();
  const form = $("#supabase-login-form");
  form?.addEventListener("submit", signInSupabaseFromForm);
  $("#supabase-signout")?.addEventListener("click", signOutSupabase);
  $("#supabase-test")?.addEventListener("click", testSupabaseConnection);
  $("#supabase-save")?.addEventListener("click", saveLocalToSupabase);
  $("#supabase-restore")?.addEventListener("click", restoreLocalFromSupabase);
  bindSupabaseSyncHealthActions();
  const accessGuard = typeof guardSensitiveAction === "function"
    ? guardSensitiveAction("supabase.access", {}, { notify: false })
    : { ok: false, message: "Accès Supabase non autorisé." };
  ["supabase-login-form", "supabase-signout", "supabase-test", "supabase-save", "supabase-restore"].forEach((id) => {
    const element = document.getElementById(id);
    if (!element) return;
    const controls = element.matches?.("form") ? [...element.querySelectorAll("input, button")] : [element];
    controls.forEach((control) => {
      control.disabled = !accessGuard.ok;
      control.title = accessGuard.message || "";
    });
  });
  $("#supabase-download-safety-snapshot")?.addEventListener("click", async () => {
    if (typeof guardSensitiveAction === "function") {
      const guard = guardSensitiveAction("export.backup");
      if (!guard.ok) {
        notifyUser(guard.message || "Export non autorisé.", "warn");
        return;
      }
    }
    try {
      const payload = await loadRestoreSafetySnapshot();
      if (!payload) {
        notifyUser("Aucune copie de sécurité trouvée.", "warn");
        return;
      }
      if (typeof downloadJson !== "function") {
        notifyUser("Téléchargement impossible.", "warn");
        return;
      }
      downloadJson(
        payload,
        `nimr-carrosserie-avant-restauration-cloud-${todayKey(new Date())}.json`,
      );
      if (typeof addAuditLog === "function") {
        addAuditLog("conflict.local_downloaded", {
          type: "restore_safety_snapshot",
          timestamp: new Date().toISOString(),
        });
      }
      notifyUser("Copie de sécurité locale téléchargée.", "success");
    } catch (error) {
      console.error("Lecture snapshot échouée", error);
      notifyUser("Lecture de la copie de sécurité impossible.", "warn");
    }
  });
  refreshSupabasePanel();
  if (accessGuard.ok) {
    startSupabaseLiveSync();
    pullLatestSupabaseBackup("initialisation");
    if (typeof processOfflineQueue === "function") processOfflineQueue();
  }
  window.addEventListener("focus", () => {
    pullLatestSupabaseBackup("focus");
    if (typeof processOfflineQueue === "function") processOfflineQueue();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      pullLatestSupabaseBackup("retour application");
      if (typeof processOfflineQueue === "function") processOfflineQueue();
    } else {
      flushSupabaseBackup("mise-en-arriere-plan");
    }
  });
  window.addEventListener("online", () => {
    pullLatestSupabaseBackup("retour connexion");
    if (typeof processOfflineQueue === "function") processOfflineQueue();
  });
  window.addEventListener("pagehide", () => flushSupabaseBackup("fermeture-page"));
}

function markLocalCasesAsSynced(syncedState = state) {
  if (!state || !Array.isArray(state.cases)) return 0;
  const syncedCases = new Map((syncedState?.cases || [])
    .filter((item) => item?.id)
    .map((item) => [item.id, item]));
  let confirmed = 0;
  state.cases.forEach((caseItem) => {
    const syncedCase = syncedCases.get(caseItem.id);
    if (!syncedCase) return;
    const localRevision = Number(caseItem.localRevision || 0);
    const syncedRevision = Number(syncedCase.localRevision || 0);
    if (localRevision !== syncedRevision) return;
    caseItem.syncRevision = localRevision;
    confirmed += 1;
  });
  saveState({ skipCloud: true });
  if (typeof initializeLastKnownCasesComparable === "function") {
    initializeLastKnownCasesComparable();
  }
  return confirmed;
}

let offlineQueue = [];

function loadOfflineQueue() {
  try {
    const raw = localStorage.getItem("nimr-sav-offline-queue");
    offlineQueue = raw ? JSON.parse(raw) : [];
  } catch {
    offlineQueue = [];
  }
  if (typeof loadDurableOutboxOperations === "function") {
    loadDurableOutboxOperations().then((records) => {
      offlineQueue = records;
      window.offlineQueue = offlineQueue;
      if (typeof renderSyncStatusStrip === "function") renderSyncStatusStrip();
      if (typeof renderSupabaseSyncHealth === "function") renderSupabaseSyncHealth();
    }).catch(() => null);
  }
  window.offlineQueue = offlineQueue;
  return offlineQueue;
}

function saveOfflineQueue() {
  try {
    const compact = (offlineQueue || []).map((action) => ({
      id: action.operationId || action.id,
      operationId: action.operationId || action.id,
      type: action.type || (action.entityType === "workshop_state" ? "sync_push" : action.action),
      entityType: action.entityType || (action.type === "sync_push" ? "workshop_state" : "application_event"),
      entityId: action.entityId || (action.type === "sync_push" ? action.workshopId || getSupabaseWorkshopId() : action.operationId || action.id),
      action: action.action || (action.type === "sync_push" ? "upsert_snapshot" : action.type),
      workshopId: action.workshopId || getSupabaseWorkshopId(),
      expectedVersion: Number(action.expectedVersion || 0),
      snapshotFingerprint: String(
        action.snapshotFingerprint
        || action.payload?.snapshotFingerprint
        || "",
      ),
      status: action.status || action.syncStatus || "pending",
      attempts: Number(action.attempts || action.retryCount || 0),
      error: action.error || action.lastError || "",
      timestamp: action.timestamp || action.createdAt || new Date().toISOString(),
      description: action.description || action.payload?.description || "",
    }));
    localStorage.setItem("nimr-sav-offline-queue", JSON.stringify(compact));
  } catch (error) {
    console.warn("Impossible de mettre à jour le miroir compact de l'outbox", error?.message || error);
  }
}

function areOfflineSnapshotOperationsSameTarget(left = {}, right = {}) {
  return String(left.workshopId || "") === String(right.workshopId || "")
    && String(left.entityType || "") === String(right.entityType || "")
    && String(left.entityId || "") === String(right.entityId || "")
    && String(left.action || "") === String(right.action || "")
    && String(left.entityType || "") === "workshop_state"
    && String(left.action || "") === "upsert_snapshot";
}

function enqueueOfflineAction(type = "sync_push", description = "Mise à jour des données") {
  loadOfflineQueue();
  const expectedVersion = Math.max(
    0,
    ...(state?.cases || []).map(
      (item) => Number(item.localRevision || 0),
    ),
  );
  const snapshotFingerprint =
    type === "sync_push"
      ? getSyncStateFingerprint(state)
      : "";
  const workshopId = getSupabaseWorkshopId();
  const reference = {
    workshopId,
    entityType: type === "sync_push" ? "workshop_state" : "application_event",
    entityId: type === "sync_push" ? workshopId : "",
    action: type === "sync_push" ? "upsert_snapshot" : type,
    expectedVersion,
    snapshotFingerprint,
  };
  const existing = type === "sync_push"
    ? offlineQueue.find((action) => {
        const candidate = {
          workshopId: action.workshopId || workshopId,
          entityType: action.entityType || (action.type === "sync_push" ? "workshop_state" : "application_event"),
          entityId: action.entityId || (action.type === "sync_push" ? workshopId : action.operationId || action.id),
          action: action.action || (action.type === "sync_push" ? "upsert_snapshot" : action.type),
          expectedVersion: action.expectedVersion ?? expectedVersion,
          snapshotFingerprint: action.snapshotFingerprint
            || action.payload?.snapshotFingerprint
            || "",
        };
        return ["pending", "processing", "failed", "conflict"].includes(action.status || action.syncStatus)
          && (
            areOfflineSnapshotOperationsSameTarget(candidate, reference)
            || (typeof areDurableOutboxOperationsEquivalent === "function"
              ? areDurableOutboxOperationsEquivalent(candidate, reference)
              : candidate.workshopId === reference.workshopId
                && candidate.entityType === reference.entityType
                && candidate.entityId === reference.entityId
                && candidate.action === reference.action
                && Number(candidate.expectedVersion) === Number(reference.expectedVersion))
          );
      })
    : null;
  const operationId = existing?.operationId || existing?.id
    || (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? `operation-${crypto.randomUUID()}` : uid("operation"));
  const action = {
    id: operationId,
    operationId,
    timestamp: existing?.timestamp || existing?.createdAt || new Date().toISOString(),
    type,
    entityType: reference.entityType,
    entityId: type === "sync_push" ? workshopId : operationId,
    action: reference.action,
    workshopId,
    expectedVersion,
    snapshotFingerprint,
    description,
    status: existing?.status === "processing" || existing?.syncStatus === "processing" ? "processing" : "pending",
    attempts: existing?.status === "processing" || existing?.syncStatus === "processing"
      ? Number(existing.attempts || existing.retryCount || 0)
      : 0,
    error: "",
  };
  if (type === "sync_push") {
    offlineQueue = offlineQueue.filter((entry) => {
      const sameId = (entry.operationId || entry.id) === operationId;
      if (sameId) return false;
      const candidate = {
        workshopId: entry.workshopId || workshopId,
        entityType: entry.entityType || (entry.type === "sync_push" ? "workshop_state" : "application_event"),
        entityId: entry.entityId || (entry.type === "sync_push" ? workshopId : entry.operationId || entry.id),
        action: entry.action || (entry.type === "sync_push" ? "upsert_snapshot" : entry.type),
        expectedVersion: entry.expectedVersion ?? expectedVersion,
        snapshotFingerprint: entry.snapshotFingerprint
          || entry.payload?.snapshotFingerprint
          || "",
      };
      const sameSnapshotTarget = areOfflineSnapshotOperationsSameTarget(candidate, reference);
      const exactlyEquivalent = typeof areDurableOutboxOperationsEquivalent === "function"
        ? areDurableOutboxOperationsEquivalent(candidate, reference)
        : candidate.workshopId === reference.workshopId
          && candidate.entityType === reference.entityType
          && candidate.entityId === reference.entityId
          && candidate.action === reference.action
          && Number(candidate.expectedVersion) === Number(reference.expectedVersion);
      return !(sameSnapshotTarget || exactlyEquivalent);
    });
  }
  offlineQueue.push(action);
  saveOfflineQueue();
  window.offlineQueue = offlineQueue;
  if (typeof enqueueDurableOutboxOperation === "function") {
    enqueueDurableOutboxOperation({
      operationId,
      entityType: reference.entityType,
      entityId: action.entityId,
      action: reference.action,
      payload: {
        snapshotKey: "latest",
        appVersion: APP_VERSION,
        casesCount: Number(state?.cases?.length || 0),
        bookingsCount: Number(state?.bookings?.length || 0),
        resourcesCount: Number(state?.resources?.length || 0),
        snapshotFingerprint,
        description,
      },
      workshopId,
      userId: getCurrentActor()?.userId || "",
      expectedVersion,
      snapshotFingerprint,
      retryCount: action.attempts,
      lastError: "",
      createdAt: action.timestamp,
      syncStatus: action.status,
      description,
    }).then((record) => {
      action.id = record.operationId;
      action.operationId = record.operationId;
      action.status = record.syncStatus;
      action.attempts = record.retryCount;
      action.error = record.lastError;
      if (typeof loadDurableOutboxOperations === "function") {
        return loadDurableOutboxOperations().then((records) => {
          offlineQueue = records;
          window.offlineQueue = offlineQueue;
        });
      }
      return null;
    }).catch((error) => console.warn("Écriture outbox IndexedDB impossible", error?.message || error));
  }
  saveOfflineQueue();
  if (typeof renderSyncStatusStrip === "function") renderSyncStatusStrip();
  if (typeof renderSupabaseSyncHealth === "function") renderSupabaseSyncHealth();
  return action;
}

let isProcessingOfflineQueue = false;

let offlineQueueProcessingPromise = null;

async function processOfflineQueue() {
  if (offlineQueueProcessingPromise) return offlineQueueProcessingPromise;
  const run = (async () => {
    if (typeof consolidateDurableOutboxOperations === "function") {
      await consolidateDurableOutboxOperations();
    }
    const records = typeof loadDurableOutboxOperations === "function"
      ? await loadDurableOutboxOperations()
      : loadOfflineQueue();
    offlineQueue = records;
    window.offlineQueue = offlineQueue;
    const pending = offlineQueue.filter((action) => ["pending", "processing", "failed"].includes(action.syncStatus || action.status));
    if (!pending.length) return { processed: 0 };

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return { processed: 0, reason: "offline" };
    }

    const client = getSupabaseClient();
    const user = await getSupabaseUser();
    if (!client || !user) return { processed: 0, reason: "authentication-required" };

    isProcessingOfflineQueue = true;
    let processed = 0;
    try {
      for (const action of pending) {
        const operationId = action.operationId || action.id;
        const actionSnapshotFingerprint = String(
          action.snapshotFingerprint
          || action.payload?.snapshotFingerprint
          || getSyncStateFingerprint(state),
        );
        const actionReference = {
          ...action,
          snapshotFingerprint: actionSnapshotFingerprint,
          payload: {
            ...(action.payload || {}),
            snapshotFingerprint: actionSnapshotFingerprint,
          },
        };
        const joiningActiveSync = Boolean(autoSupabaseBackupPromise);
        const currentRetryCount = Number(
          action.retryCount || action.attempts || 0,
        );
        const retryCount = joiningActiveSync
          ? currentRetryCount
          : Math.min(10, currentRetryCount + 1);
        if (typeof updateDurableOutboxOperation === "function") {
          await updateDurableOutboxOperation(operationId, {
            snapshotFingerprint: actionSnapshotFingerprint,
            payload: actionReference.payload,
            syncStatus: "processing",
            retryCount,
            lastError: "",
          });
        }
        if (typeof renderSyncStatusStrip === "function") {
          renderSyncStatusStrip();
        }

        try {
          const acknowledgement = await autoBackupToSupabase(
            `outbox:${operationId}`,
            { force: true, requireAck: true },
          );
          if (!acknowledgement?.acknowledged) {
            throw new Error(
              "Aucun accusé de réception serveur.",
            );
          }
          const acknowledgedFingerprint = String(
            acknowledgement.snapshotFingerprint || "",
          );
          if (
            Number(acknowledgement.expectedVersion)
              !== Number(action.expectedVersion)
            || acknowledgedFingerprint
              !== actionSnapshotFingerprint
          ) {
            if (typeof updateDurableOutboxOperation === "function") {
              await updateDurableOutboxOperation(operationId, {
                expectedVersion: Math.max(
                  0,
                  ...(state?.cases || []).map(
                    (item) => Number(item.localRevision || 0),
                  ),
                ),
                snapshotFingerprint:
                  getSyncStateFingerprint(state),
                syncStatus: "pending",
                retryCount: currentRetryCount,
                lastError: "",
              });
            }
            continue;
          }
          if (
            typeof acknowledgeEquivalentDurableOutboxOperations
              === "function"
          ) {
            await acknowledgeEquivalentDurableOutboxOperations(
              actionReference,
              acknowledgement,
            );
          } else {
            if (typeof updateDurableOutboxOperation === "function") {
              await updateDurableOutboxOperation(operationId, {
                syncStatus: "acknowledged",
                retryCount,
                lastError: "",
                acknowledgedAt: acknowledgement.updatedAt,
              });
            }
            if (typeof deleteDurableOutboxOperation === "function") {
              await deleteDurableOutboxOperation(operationId);
            }
          }
          localStorage.removeItem(
            `${STORAGE_KEY}:last-cloud-autosave-error`,
          );
          logSyncSuccess({
            ...actionReference,
            description:
              action.description
              || action.payload?.description
              || "Mise à jour durable",
          });
          processed += 1;
        } catch (err) {
          const conflict =
            /conflict|version|409|23P01|serialization/i.test(
              String(err?.message || err),
            );
          if (typeof updateDurableOutboxOperation === "function") {
            await updateDurableOutboxOperation(operationId, {
              syncStatus: conflict ? "conflict" : "failed",
              retryCount,
              lastError: String(err?.message || err),
            });
          }
          logSyncFailure({
            ...actionReference,
            description:
              action.description
              || action.payload?.description
              || "Mise à jour durable",
          }, err);
          break;
        }
      }
      return { processed };
    } finally {
      offlineQueue = typeof loadDurableOutboxOperations === "function" ? await loadDurableOutboxOperations() : [];
      window.offlineQueue = offlineQueue;
      isProcessingOfflineQueue = false;
      if (typeof renderSyncStatusStrip === "function") renderSyncStatusStrip();
      if (typeof renderSupabaseSyncHealth === "function") renderSupabaseSyncHealth();
    }
  })();

  offlineQueueProcessingPromise = run;
  try {
    return await run;
  } finally {
    if (offlineQueueProcessingPromise === run) offlineQueueProcessingPromise = null;
  }
}

function logSyncSuccess(action) {
  if (!state.syncLog) state.syncLog = [];
  const entry = {
    id: uid("sync-log"),
    at: new Date().toISOString(),
    status: "success",
    source: "offline_queue",
    reason: "retry",
    items: state.cases.length,
    details: `Sync réussie (action offline : ${action.description})`
  };
  state.syncLog.unshift(entry);
  state.syncLog = state.syncLog.slice(0, 100);
  saveState({ skipCloud: true });
}

function logSyncFailure(action, error) {
  if (!state.syncLog) state.syncLog = [];
  const entry = {
    id: uid("sync-log"),
    at: new Date().toISOString(),
    status: "failed",
    source: "offline_queue",
    reason: "retry",
    details: `Échec sync (action offline : ${action.description}). Erreur: ${error.message || error}`
  };
  state.syncLog.unshift(entry);
  state.syncLog = state.syncLog.slice(0, 100);
  saveState({ skipCloud: true });
}

function logSyncConflict(caseId, details) {
  if (!state.syncLog) state.syncLog = [];
  const entry = {
    id: uid("sync-log"),
    at: new Date().toISOString(),
    status: "conflict",
    source: "sync",
    reason: "conflict",
    details: `Conflit détecté pour le dossier ${caseId}. ${details}`
  };
  state.syncLog.unshift(entry);
  state.syncLog = state.syncLog.slice(0, 100);
}

if (typeof window !== "undefined") {
  window.createRequiredRestoreSafetySnapshot =
    createRequiredRestoreSafetySnapshot;
  window.markLocalCasesAsSynced = markLocalCasesAsSynced;
  window.enqueueOfflineAction = enqueueOfflineAction;
  window.processOfflineQueue = processOfflineQueue;
  window.logSyncConflict = logSyncConflict;
  window.offlineQueue = offlineQueue;
}
