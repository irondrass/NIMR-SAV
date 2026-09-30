const MEDIA_UPLOAD_CONTEXTS = new Set(["reception", "diagnostic", "repair", "qc", "warranty", "delivery"]);
const MEDIA_UPLOAD_EVIDENCE = new Set([
  "general", "odometer", "registration", "vin",
  "exterior_damage", "interior", "causal_part", "other",
]);
const MEDIA_UPLOAD_STATUSES = new Set(["pending", "uploading", "uploaded", "failed"]);
const MEDIA_DRIVE_CAPABILITY_TTL_MS = 60 * 1000;
const MEDIA_OFFLINE_ENTITY_TYPE = "media_upload";
const MEDIA_OFFLINE_MAX_RETRIES = 10;
const MEDIA_OFFLINE_BASE_DELAY_MS = 5000;
const MEDIA_OFFLINE_MAX_DELAY_MS = 15 * 60 * 1000;
const MEDIA_OFFLINE_PROCESSING_LEASE_MS = 2 * 60 * 1000;
let mediaOfflineDrainPromise = null;
let mediaOfflineDrainTimer = null;
function findMediaOfflineTarget(mediaId, caseId = "") {
  const cases = Array.isArray(state?.cases) ? state.cases : [];
  const item = caseId ? cases.find((candidate) => String(candidate?.id || "") === String(caseId)) : cases.find((candidate) => (candidate?.photos || []).some((media) => String(media?.id || "") === String(mediaId)));
  if (!item) return null;
  const media = (item.photos || []).find((candidate) => String(candidate?.id || "") === String(mediaId));
  return media ? { item, media } : null;
}
function mediaOfflineBackoffMs(retryCount = 0) {
  const attempt = Math.max(1, Number(retryCount || 0));
  const exponential = Math.min(MEDIA_OFFLINE_MAX_DELAY_MS, MEDIA_OFFLINE_BASE_DELAY_MS * (2 ** Math.min(8, attempt - 1)));
  return Math.min(MEDIA_OFFLINE_MAX_DELAY_MS, exponential + Math.floor(exponential * 0.2 * Math.random()));
}
function isMediaOfflineRetryable(result = {}) { return !["LOCAL_MEDIA_MISSING", "MEDIA_CONTEXT_REQUIRED", "CLAIM_REQUIRED", "UPLOAD_REJECTED"].includes(String(result?.code || "")); }
async function enqueueMediaOfflineUpload(item, media, options = {}) {
  if (!item?.id || !media?.id || typeof enqueueDurableOutboxOperation !== "function") return null;
  const workshopId = String(typeof getSupabaseWorkshopId === "function" ? getSupabaseWorkshopId() || "" : "").trim() || "local-workshop";
  const existing = typeof loadDurableOutboxOperations === "function" ? (await loadDurableOutboxOperations()).find((entry) => entry.entityType === MEDIA_OFFLINE_ENTITY_TYPE && entry.workshopId === workshopId && entry.entityId === String(media.id) && ["pending", "processing", "failed"].includes(entry.syncStatus)) : null;
  if (existing) return existing;
  const operationId = "media-upload:" + workshopId + ":" + media.id;
  const operation = await enqueueDurableOutboxOperation({ operationId, idempotencyKey: operationId, workshopId, entityType: MEDIA_OFFLINE_ENTITY_TYPE, entityId: String(media.id), action: "upload", payload: { caseId: String(item.id), mediaId: String(media.id) }, syncStatus: "pending", retryCount: 0, nextAttemptAt: options.nextAttemptAt || new Date().toISOString(), description: "Média " + (media.name || media.id) + " à envoyer" });
  if (media.uploadStatus !== "uploaded") { media.uploadStatus = "pending"; await persistLocalMediaMeta(item, media); }
  scheduleMediaOfflineDrain(0); return operation;
}
async function updateMediaOfflineOperation(operation, changes = {}) { return typeof updateDurableOutboxOperation === "function" ? updateDurableOutboxOperation(operation.operationId, changes) : null; }
async function cancelMediaOfflineUpload(mediaId) {
  if (!mediaId || typeof loadDurableOutboxOperations !== "function" || typeof deleteDurableOutboxOperation !== "function") return false;
  const records = await loadDurableOutboxOperations();
  const matches = records.filter((entry) => entry.entityType === MEDIA_OFFLINE_ENTITY_TYPE && entry.entityId === String(mediaId));
  for (const operation of matches) await deleteDurableOutboxOperation(operation.operationId);
  return matches.length > 0;
}
async function processMediaOfflineOperation(operation) {
  const target = findMediaOfflineTarget(operation.entityId, operation.payload?.caseId);
  if (!target) { await updateMediaOfflineOperation(operation, { syncStatus: "failed", retryCount: MEDIA_OFFLINE_MAX_RETRIES, lastError: "Média local introuvable.", nextAttemptAt: null }); return { ok: false, terminal: true, code: "LOCAL_MEDIA_MISSING" }; }
  const { item, media } = target;
  if (media.uploadStatus === "uploaded" && media.driveFileId) { await acknowledgeDurableOutboxOperation(operation.operationId); return { ok: true, deduplicated: true }; }
  await updateMediaOfflineOperation(operation, { syncStatus: "processing", processingStartedAt: new Date().toISOString(), lastError: "" });
  const result = await retryMediaUpload(item, media);
  if (result?.ok) { await acknowledgeDurableOutboxOperation(operation.operationId); return result; }
  const retryCount = Math.min(MEDIA_OFFLINE_MAX_RETRIES, Number(operation.retryCount || 0) + 1);
  const retryable = isMediaOfflineRetryable(result) && retryCount < MEDIA_OFFLINE_MAX_RETRIES;
  await updateMediaOfflineOperation(operation, { syncStatus: "failed", retryCount, lastError: String(result?.message || result?.code || "Upload média impossible."), nextAttemptAt: retryable ? new Date(Date.now() + mediaOfflineBackoffMs(retryCount)).toISOString() : null, processingStartedAt: null });
  return { ...result, retryable, terminal: !retryable };
}
async function drainMediaOfflineQueue(reason = "foreground") {
  if (mediaOfflineDrainPromise) return mediaOfflineDrainPromise;
  if (navigator.onLine === false || typeof loadDurableOutboxOperations !== "function") return { processed: 0, reason: "offline" };
  const run = (async () => {
    const now = Date.now(); const records = await loadDurableOutboxOperations(); const mediaOps = records.filter((entry) => entry.entityType === MEDIA_OFFLINE_ENTITY_TYPE); let processed = 0;
    for (const operation of mediaOps) {
      if (operation.retryCount >= MEDIA_OFFLINE_MAX_RETRIES) continue;
      const processingAt = Date.parse(operation.processingStartedAt || operation.updatedAt || "");
      const staleProcessing = operation.syncStatus === "processing" && (!Number.isFinite(processingAt) || now - processingAt >= MEDIA_OFFLINE_PROCESSING_LEASE_MS);
      const nextAt = Date.parse(operation.nextAttemptAt || ""); const due = !Number.isFinite(nextAt) || nextAt <= now;
      if (!(operation.syncStatus === "pending" || operation.syncStatus === "failed" || staleProcessing) || !due) continue;
      processed += 1; await processMediaOfflineOperation(operation);
    }
    const remaining = (await loadDurableOutboxOperations()).filter((entry) => entry.entityType === MEDIA_OFFLINE_ENTITY_TYPE && entry.retryCount < MEDIA_OFFLINE_MAX_RETRIES && ["pending", "failed", "processing"].includes(entry.syncStatus));
    const nextTimes = remaining.map((entry) => Date.parse(entry.nextAttemptAt || "")).filter(Number.isFinite);
    if (nextTimes.length) scheduleMediaOfflineDrain(Math.max(1000, Math.min(...nextTimes) - Date.now()));
    return { processed, remaining: remaining.length, reason };
  })();
  mediaOfflineDrainPromise = run; try { return await run; } finally { if (mediaOfflineDrainPromise === run) mediaOfflineDrainPromise = null; }
}
function scheduleMediaOfflineDrain(delayMs = 0) { if (mediaOfflineDrainTimer) clearTimeout(mediaOfflineDrainTimer); mediaOfflineDrainTimer = setTimeout(() => { mediaOfflineDrainTimer = null; void drainMediaOfflineQueue("scheduled"); }, Math.max(0, Number(delayMs || 0))); }
function bindMediaOfflineRecovery() {
  const resume = () => { if (navigator.onLine !== false) scheduleMediaOfflineDrain(250); };
  window.addEventListener("online", () => scheduleMediaOfflineDrain(0)); window.addEventListener("focus", resume); window.addEventListener("pageshow", resume);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") resume(); }); resume();
}

let mediaDriveCapabilityCache = null;

function mediaUploadCleanText(value, limit = 512) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/gu, "").trim().slice(0, limit)
    : "";
}

function mediaUploadTypeFromMime(mimeType) {
  return String(mimeType || "").toLowerCase().startsWith("video/") ? "video" : "photo";
}

function mediaUploadUuidOrNull(value) {
  const clean = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(clean)
    ? clean
    : null;
}

function normalizeMediaUploadMeta(media = {}) {
  const mediaType = media.mediaType === "video" || media.media_type === "video" ? "video" : "photo";
  const businessContext = mediaUploadCleanText(media.businessContext || media.business_context, 40).toLowerCase();
  const evidenceKind = mediaUploadCleanText(media.evidenceKind || media.evidence_kind, 40).toLowerCase();
  const uploadStatus = mediaUploadCleanText(media.uploadStatus || media.upload_status, 24).toLowerCase();
  return {
    mediaType,
    businessContext: MEDIA_UPLOAD_CONTEXTS.has(businessContext) ? businessContext : "",
    evidenceKind: MEDIA_UPLOAD_EVIDENCE.has(evidenceKind) ? evidenceKind : "general",
    caption: mediaUploadCleanText(media.caption, 500),
    uploadStatus: MEDIA_UPLOAD_STATUSES.has(uploadStatus) ? uploadStatus : "pending",
    driveFileId: mediaUploadCleanText(media.driveFileId || media.drive_file_id, 256),
    driveFolderId: mediaUploadCleanText(media.driveFolderId || media.drive_folder_id, 256),
    checksumSha256: mediaUploadCleanText(media.checksumSha256 || media.checksum_sha256, 128).toLowerCase(),
    uploadedAt: mediaUploadCleanText(media.uploadedAt || media.uploaded_at, 80),
    lastUploadError: mediaUploadCleanText(media.lastUploadError || media.last_upload_error, 500),
    uploadAttempts: Math.max(0, Number.parseInt(media.uploadAttempts ?? media.upload_attempts ?? 0, 10) || 0),
    claimId: mediaUploadCleanText(media.claimId || media.claim_id, 80),
    repairStepId: mediaUploadCleanText(media.repairStepId || media.repair_step_id, 80),
    sourceTaskId: mediaUploadCleanText(media.sourceTaskId || media.source_task_id, 160),
  };
}

async function mediaSha256Hex(blob) {
  if (!blob?.arrayBuffer || !globalThis.crypto?.subtle) return "";
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function readMediaDriveInvokeError(error) {
  try {
    if (error?.context?.json) {
      const payload = await error.context.json();
      if (payload && typeof payload === "object") return payload;
    }
  } catch {
    // Keep the connector error sanitized.
  }
  return null;
}

async function invokeMediaDrive(params = {}) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, code: "OFFLINE", message: "Connexion internet requise." };
  }
  const client = typeof getSupabaseClient === "function" ? getSupabaseClient() : null;
  if (!client?.functions?.invoke) {
    return { ok: false, code: "NO_CLIENT", message: "Client Supabase non configuré." };
  }
  try {
    const user = typeof getSupabaseUser === "function" ? await getSupabaseUser() : null;
    if (!user?.id) return { ok: false, code: "UNAUTHENTICATED", message: "Session Supabase requise." };
    const workshopId = String(typeof getSupabaseWorkshopId === "function" ? getSupabaseWorkshopId() || "" : "").trim();
    if (!workshopId) return { ok: false, code: "WORKSHOP_REQUIRED", message: "Atelier Supabase indisponible." };

    if (typeof resolveSupabaseWorkshopMembership === "function") {
      const membership = await resolveSupabaseWorkshopMembership(user);
      if (!membership?.ok
        || String(membership.membership?.user_id || "") !== String(user.id)
        || String(membership.membership?.workshop_id || "") !== workshopId) {
        return { ok: false, code: "INVALID_MEMBERSHIP", message: "Accès atelier non autorisé." };
      }
    }

    const { data, error } = await client.functions.invoke("media-drive", {
      body: { ...params, workshop_id: workshopId },
    });
    if (error) {
      return (await readMediaDriveInvokeError(error)) || {
        ok: false,
        code: "MEDIA_DRIVE_INVOKE_FAILED",
        message: error.message || "Service média indisponible.",
      };
    }
    return data && typeof data === "object"
      ? data
      : { ok: false, code: "INVALID_SERVER_RESPONSE", message: "Réponse média invalide." };
  } catch (error) {
    return {
      ok: false,
      code: "MEDIA_DRIVE_EXCEPTION",
      message: error?.message || "Appel média impossible.",
    };
  }
}

async function getMediaDriveCapabilities(force = false) {
  const now = Date.now();
  if (!force && mediaDriveCapabilityCache && now - mediaDriveCapabilityCache.at < MEDIA_DRIVE_CAPABILITY_TTL_MS) {
    return mediaDriveCapabilityCache.value;
  }
  const value = await invokeMediaDrive({ action: "capabilities" });
  mediaDriveCapabilityCache = { at: now, value };
  return value;
}

async function resolveMediaRepairOrder(client, item, workshopId) {
  const localId = typeof caseSyncLocalId === "function"
    ? caseSyncLocalId(item)
    : String(item?.id || "");
  if (!localId) return null;
  const { data, error } = await client
    .from("repair_orders")
    .select("id, vehicle_id, local_id")
    .eq("workshop_id", workshopId)
    .eq("local_id", localId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadExistingMediaRow(client, workshopId, localId) {
  const { data, error } = await client
    .from("photos")
    .select("local_id, upload_status, drive_file_id, drive_folder_id, checksum_sha256, uploaded_at, upload_attempts, last_upload_error")
    .eq("workshop_id", workshopId)
    .eq("local_id", localId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function restoreMediaFromDatabase(media, row) {
  if (!row) return media;
  media.uploadStatus = row.upload_status || media.uploadStatus || "pending";
  media.driveFileId = row.drive_file_id || media.driveFileId || "";
  media.driveFolderId = row.drive_folder_id || media.driveFolderId || "";
  media.checksumSha256 = row.checksum_sha256 || media.checksumSha256 || "";
  media.uploadedAt = row.uploaded_at || media.uploadedAt || "";
  media.uploadAttempts = Math.max(Number(media.uploadAttempts || 0), Number(row.upload_attempts || 0));
  media.lastUploadError = row.last_upload_error || media.lastUploadError || "";
  return media;
}

function buildMediaDatabaseRow({ workshopId, userId, item, media, repairOrder, status }) {
  const meta = normalizeMediaUploadMeta({ ...media, uploadStatus: status || media.uploadStatus });
  const driveFileId = meta.driveFileId || null;
  return {
    workshop_id: workshopId,
    local_id: media.id,
    repair_order_id: repairOrder?.id || null,
    vehicle_id: repairOrder?.vehicle_id || null,
    claim_id: mediaUploadUuidOrNull(meta.claimId),
    repair_step_id: mediaUploadUuidOrNull(meta.repairStepId),
    source_task_id: meta.sourceTaskId || null,
    step_key: media.category || null,
    storage_bucket: driveFileId ? "google-drive" : "local-backup",
    storage_path: driveFileId
      ? `drive:${driveFileId}`
      : `local/${item?.id || "unknown"}/${media.id || media.name || "media"}`,
    filename: media.name || null,
    mime_type: media.type || null,
    size_bytes: Number(media.size || 0) || null,
    media_type: meta.mediaType,
    business_context: meta.businessContext || null,
    evidence_kind: meta.evidenceKind,
    drive_file_id: driveFileId,
    drive_folder_id: meta.driveFolderId || null,
    checksum_sha256: meta.checksumSha256 || null,
    caption: meta.caption || null,
    upload_status: meta.uploadStatus,
    uploaded_by: meta.uploadStatus === "uploaded" ? userId : null,
    uploaded_at: meta.uploadStatus === "uploaded" ? (meta.uploadedAt || new Date().toISOString()) : null,
    last_upload_error: meta.lastUploadError || null,
    upload_attempts: meta.uploadAttempts,
    sync_source: "media-upload-001",
  };
}

async function upsertMediaDatabaseRow(client, args) {
  const row = buildMediaDatabaseRow(args);
  const { data, error } = await client
    .from("photos")
    .upsert(row, { onConflict: "workshop_id,local_id" })
    .select("id, local_id, upload_status, drive_file_id, drive_folder_id, checksum_sha256")
    .single();
  if (error) throw error;
  return data;
}

async function persistLocalMediaMeta(item, media) {
  const record = await getPhotoRecord(media.id).catch(() => null);
  if (record?.blob) await savePhotoRecord(item.id, media, record.blob);
  saveState({ changedCase: item });
  if (typeof renderCaseDetail === "function") renderCaseDetail();
}

async function markMediaUploadFailure(item, media, error) {
  media.uploadStatus = "failed";
  media.lastUploadError = mediaUploadCleanText(error?.message || error?.code || "Échec upload média.", 500);
  media.uploadAttempts = Math.max(0, Number(media.uploadAttempts || 0));
  await persistLocalMediaMeta(item, media);

  try {
    const client = typeof getSupabaseClient === "function" ? getSupabaseClient() : null;
    const user = typeof getSupabaseUser === "function" ? await getSupabaseUser() : null;
    const workshopId = String(typeof getSupabaseWorkshopId === "function" ? getSupabaseWorkshopId() || "" : "").trim();
    if (!client || !user?.id || !workshopId) return;
    const repairOrder = await resolveMediaRepairOrder(client, item, workshopId);
    if (!repairOrder?.id) return;
    await upsertMediaDatabaseRow(client, {
      workshopId, userId: user.id, item, media, repairOrder, status: "failed",
    });
  } catch {
    // Failure state remains persisted locally and is retryable.
  }
}

async function putMediaBlob(uploadUrl, blob, mimeType) {
  const result = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType || "application/octet-stream" },
    body: blob,
  });
  if (!result.ok) {
    const error = new Error(`Google Drive upload HTTP ${result.status}`);
    error.code = result.status === 408 || result.status === 429 || result.status >= 500
      ? "RETRYABLE_UPLOAD_ERROR"
      : "UPLOAD_REJECTED";
    throw error;
  }
  try {
    return await result.json();
  } catch {
    throw new Error("Réponse finale Google Drive invalide.");
  }
}

async function uploadMediaNow(item, media) {
  const client = typeof getSupabaseClient === "function" ? getSupabaseClient() : null;
  const user = typeof getSupabaseUser === "function" ? await getSupabaseUser() : null;
  const workshopId = String(typeof getSupabaseWorkshopId === "function" ? getSupabaseWorkshopId() || "" : "").trim();
  if (!client || !user?.id || !workshopId) {
    return { ok: false, code: "UPLOAD_PREREQUISITES_MISSING" };
  }
  const record = await getPhotoRecord(media.id).catch(() => null);
  if (!record?.blob) return { ok: false, code: "LOCAL_MEDIA_MISSING" };

  let meta = normalizeMediaUploadMeta(media);
  if (!meta.businessContext) return { ok: false, code: "MEDIA_CONTEXT_REQUIRED" };
  if (meta.businessContext === "warranty" && !mediaUploadUuidOrNull(meta.claimId)) {
    return { ok: false, code: "CLAIM_REQUIRED" };
  }

  const repairOrder = await resolveMediaRepairOrder(client, item, workshopId);
  if (!repairOrder?.id) return { ok: false, code: "REPAIR_ORDER_NOT_SYNCED" };

  const existingRow = await loadExistingMediaRow(client, workshopId, media.id);
  restoreMediaFromDatabase(media, existingRow);
  meta = normalizeMediaUploadMeta(media);
  if (meta.uploadStatus === "uploaded" && meta.driveFileId) {
    await persistLocalMediaMeta(item, media);
    return { ok: true, deduplicated: true, drive_file_id: meta.driveFileId };
  }

  media.checksumSha256 = meta.checksumSha256 || await mediaSha256Hex(record.blob);
  media.uploadAttempts = meta.uploadAttempts + 1;
  media.lastUploadError = "";

  if (media.driveFileId) {
    const finalized = await invokeMediaDrive({
      action: "finalize_upload",
      scope: meta.businessContext === "warranty" ? "warranty" : "vehicle",
      repair_order_id: repairOrder.id,
      business_context: meta.businessContext,
      claim_id: meta.claimId || undefined,
      warranty_section: meta.businessContext === "warranty" ? (media.warrantySection || "photos") : undefined,
      local_id: media.id,
      drive_file_id: media.driveFileId,
    });
    if (!finalized?.ok) throw Object.assign(new Error(finalized?.message || finalized?.code || "Finalisation impossible."), finalized);
    media.uploadStatus = "uploaded";
    media.driveFolderId = finalized.file?.parent_id || media.driveFolderId || "";
    media.uploadedAt = new Date().toISOString();
    await upsertMediaDatabaseRow(client, { workshopId, userId: user.id, item, media, repairOrder, status: "uploaded" });
    await persistLocalMediaMeta(item, media);
    return { ok: true, resumed: true, file: finalized.file };
  }
  media.uploadStatus = "uploading";
  await upsertMediaDatabaseRow(client, {
    workshopId, userId: user.id, item, media, repairOrder, status: "uploading",
  });
  await persistLocalMediaMeta(item, media);

  const begin = await invokeMediaDrive({
    action: "begin_upload",
    scope: meta.businessContext === "warranty" ? "warranty" : "vehicle",
    repair_order_id: repairOrder.id,
    business_context: meta.businessContext,
    claim_id: meta.claimId || undefined,
    warranty_section: meta.businessContext === "warranty" ? (media.warrantySection || "photos") : undefined,
    local_id: media.id,
    filename: media.name,
    mime_type: media.type,
    size_bytes: Number(media.size || record.blob.size || 0),
  });
  if (!begin?.ok) {
    throw Object.assign(new Error(begin?.message || begin?.code || "Session upload impossible."), begin || {});
  }

  media.driveFolderId = begin.folder_id || "";
  let driveFileId = "";
  if (begin.already_uploaded && begin.drive_file_id) {
    driveFileId = mediaUploadCleanText(begin.drive_file_id, 256);
  } else {
    if (!begin.upload_url) {
      throw Object.assign(new Error(begin?.message || begin?.code || "Session upload impossible."), begin || {});
    }
    const uploaded = await putMediaBlob(begin.upload_url, record.blob, media.type);
    driveFileId = mediaUploadCleanText(uploaded?.id, 256);
  }
  if (!driveFileId) throw new Error("Google Drive n'a pas retourné d'identifiant fichier.");
  media.driveFileId = driveFileId;
  await persistLocalMediaMeta(item, media);

  const finalized = await invokeMediaDrive({
    action: "finalize_upload",
    scope: meta.businessContext === "warranty" ? "warranty" : "vehicle",
    repair_order_id: repairOrder.id,
    business_context: meta.businessContext,
    claim_id: meta.claimId || undefined,
    warranty_section: meta.businessContext === "warranty" ? (media.warrantySection || "photos") : undefined,
    local_id: media.id,
    drive_file_id: driveFileId,
  });
  if (!finalized?.ok) {
    throw Object.assign(new Error(finalized?.message || finalized?.code || "Finalisation upload impossible."), finalized || {});
  }

  media.uploadStatus = "uploaded";
  media.driveFolderId = finalized.file?.parent_id || media.driveFolderId || "";
  media.uploadedAt = new Date().toISOString();
  media.lastUploadError = "";
  await upsertMediaDatabaseRow(client, {
    workshopId, userId: user.id, item, media, repairOrder, status: "uploaded",
  });
  await persistLocalMediaMeta(item, media);
  return { ok: true, file: finalized.file };
}

async function retryMediaUpload(item, media) {
  try {
    const result = await uploadMediaNow(item, media);
    if (!result?.ok && !["UPLOAD_PREREQUISITES_MISSING", "REPAIR_ORDER_NOT_SYNCED"].includes(result?.code)) {
      throw Object.assign(new Error(result?.message || result?.code || "Upload impossible."), result || {});
    }
    return result;
  } catch (error) {
    await markMediaUploadFailure(item, media, error);
    return { ok: false, code: error?.code || "MEDIA_UPLOAD_FAILED", message: error?.message || "Upload impossible." };
  }
}

async function tryAutoUploadMedia(item, media) {
  try {
    const capabilities = await getMediaDriveCapabilities();
    if (!capabilities?.ok || !capabilities.oauth_configured || !capabilities.root_configured) {
      return { ok: false, code: "MEDIA_DRIVE_NOT_READY" };
    }
    const queued = await enqueueMediaOfflineUpload(item, media);
    if (navigator.onLine === false) return { ok: false, code: "OFFLINE_QUEUED", queued: Boolean(queued) };
    return await drainMediaOfflineQueue("auto-upload");
  } catch {
    return { ok: false, code: "MEDIA_DRIVE_NOT_READY" };
  }
}

function mediaUploadStatusLabel(media) {
  const status = normalizeMediaUploadMeta(media).uploadStatus;
  return {
    pending: "En attente cloud",
    uploading: "Envoi en cours",
    uploaded: "Cloud OK",
    failed: "Échec cloud",
  }[status] || "En attente cloud";
}

window.enqueueMediaOfflineUpload = enqueueMediaOfflineUpload;
window.drainMediaOfflineQueue = drainMediaOfflineQueue;
window.cancelMediaOfflineUpload = cancelMediaOfflineUpload;
window.bindMediaOfflineRecovery = bindMediaOfflineRecovery;
window.invokeMediaDrive = invokeMediaDrive;
window.getMediaDriveCapabilities = getMediaDriveCapabilities;
window.tryAutoUploadMedia = tryAutoUploadMedia;
window.retryMediaUpload = retryMediaUpload;
window.mediaUploadStatusLabel = mediaUploadStatusLabel;
window.normalizeMediaUploadMeta = normalizeMediaUploadMeta;

window.__mediaUploadTest = {
  normalizeMediaUploadMeta,
  mediaUploadTypeFromMime,
  buildMediaDatabaseRow,
};
