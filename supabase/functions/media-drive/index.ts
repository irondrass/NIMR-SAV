import { createClient } from "npm:@supabase/supabase-js@2.111.0";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_API = "https://www.googleapis.com/drive/v3";
const GOOGLE_DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_FOLDER_NAME = "NIMR-SAV-PROD";
const MAX_UPLOAD_BYTES_DEFAULT = 512 * 1024 * 1024;

const ROOT_ADMIN_ROLES = new Set(["admin_technique", "directeur"]);
const MEDIA_WRITE_ROLES = new Set([
  "admin_technique",
  "directeur",
  "chef_atelier",
  "reception",
  "technicien",
  "controle_qualite",
  "responsable_garantie_support",
]);
const MEDIA_READ_ROLES = new Set([...MEDIA_WRITE_ROLES, "lecture_seule"]);
const CONTEXT_WRITE_ROLES = Object.freeze({
  reception: new Set(["admin_technique", "directeur", "chef_atelier", "reception"]),
  diagnostic: new Set(["admin_technique", "directeur", "chef_atelier", "technicien", "responsable_garantie_support"]),
  repair: new Set(["admin_technique", "directeur", "chef_atelier", "technicien"]),
  qc: new Set(["admin_technique", "directeur", "chef_atelier", "controle_qualite"]),
  delivery: new Set(["admin_technique", "directeur", "chef_atelier", "reception"]),
  warranty: new Set(["admin_technique", "directeur", "chef_atelier", "responsable_garantie_support"]),
});
const CONTEXT_DELETE_ROLES = Object.freeze({
  reception: new Set(["admin_technique", "directeur", "chef_atelier"]),
  diagnostic: new Set(["admin_technique", "directeur", "chef_atelier"]),
  repair: new Set(["admin_technique", "directeur", "chef_atelier"]),
  qc: new Set(["admin_technique", "directeur"]),
  delivery: new Set(["admin_technique", "directeur", "chef_atelier"]),
  warranty: new Set(["admin_technique", "directeur"]),
});
const CONTEXT_READ_ROLES = Object.freeze({
  reception: new Set([...CONTEXT_WRITE_ROLES.reception, "lecture_seule"]),
  diagnostic: new Set([...CONTEXT_WRITE_ROLES.diagnostic, "lecture_seule"]),
  repair: new Set([...CONTEXT_WRITE_ROLES.repair, "lecture_seule"]),
  qc: new Set([...CONTEXT_WRITE_ROLES.qc]),
  delivery: new Set([...CONTEXT_WRITE_ROLES.delivery, "lecture_seule"]),
  warranty: new Set([...CONTEXT_WRITE_ROLES.warranty]),
});
const ACTIONS = new Set([
  "capabilities",
  "bootstrap_root",
  "resolve_folder",
  "begin_upload",
  "finalize_upload",
  "read_metadata",
  "read_content",
  "delete_media",
]);
const VEHICLE_CONTEXTS = new Set(["reception", "diagnostic", "repair", "qc", "delivery"]);
const WARRANTY_SECTIONS = new Set(["photos", "videos", "diagnostic", "documents"]);
const UPLOAD_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

const CORS_HEADERS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Pragma": "no-cache",
});

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function failure(code, message, status = 400) {
  return response({ ok: false, code, message }, status);
}

function cleanText(value, limit = 512) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/gu, "").trim().slice(0, limit)
    : "";
}

function cleanToken(value, limit = 80) {
  return cleanText(value, limit).toLowerCase().replace(/[^a-z0-9_-]/gu, "");
}

function parseRequestBody(request) {
  return request.json()
    .then((value) => value && typeof value === "object" && !Array.isArray(value) ? value : null)
    .catch(() => null);
}

function readPublishableKey(environment) {
  const dictionary = environment.get("SUPABASE_PUBLISHABLE_KEYS");
  if (dictionary !== undefined) {
    try {
      const parsed = JSON.parse(dictionary);
      const value = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed.default
        : "";
      return typeof value === "string" ? value.trim() : "";
    } catch {
      return "";
    }
  }
  return String(environment.get("SUPABASE_PUBLISHABLE_KEY") || "").trim();
}

function readGoogleConfig(environment) {
  return {
    clientId: String(environment.get("GOOGLE_DRIVE_CLIENT_ID") || "").trim(),
    clientSecret: String(environment.get("GOOGLE_DRIVE_CLIENT_SECRET") || ""),
    refreshToken: String(environment.get("GOOGLE_DRIVE_REFRESH_TOKEN") || ""),
    rootFolderId: String(environment.get("GOOGLE_DRIVE_ROOT_FOLDER_ID") || "").trim(),
  };
}

function readMaxUploadBytes(environment) {
  const raw = Number(environment.get("MEDIA_DRIVE_MAX_UPLOAD_BYTES"));
  return Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : MAX_UPLOAD_BYTES_DEFAULT;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    .test(String(value || "").trim());
}

function safeDriveSegment(value, fallback = "UNKNOWN") {
  const normalized = cleanText(value, 160)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^A-Za-z0-9._-]+/gu, "_")
    .replace(/^[_ .-]+|[_ .-]+$/gu, "")
    .slice(0, 96);
  return normalized || fallback;
}

function safeFileName(value) {
  const raw = cleanText(value, 180);
  const parts = raw.split(".");
  const ext = parts.length > 1 ? "." + safeDriveSegment(parts.pop(), "") : "";
  const stem = safeDriveSegment(parts.join(".") || raw, "media").slice(0, 120);
  return (stem + ext.slice(0, 16)).slice(0, 140);
}

function escapeDriveQuery(value) {
  return String(value || "").replace(/\\/gu, "\\\\").replace(/'/gu, "\\'");
}

function buildLogicalKey(kind, id = "") {
  return id ? `${kind}:${id}` : kind;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function driveHeaders(accessToken, extra = {}) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    ...extra,
  };
}

class MediaDriveError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = "MediaDriveError";
    this.code = code;
    this.status = status;
  }
}

async function fetchWithTimeout(fetchFn, url, options = {}, timeoutMs = 12000) {
  const requestOptions = { ...options };
  if (!requestOptions.signal
    && typeof AbortSignal !== "undefined"
    && typeof AbortSignal.timeout === "function") {
    requestOptions.signal = AbortSignal.timeout(timeoutMs);
  }
  try {
    return await fetchFn(url, requestOptions);
  } catch {
    throw new MediaDriveError("GOOGLE_DRIVE_UNAVAILABLE", 502);
  }
}

async function fetchJson(fetchFn, url, options, code, timeoutMs = 12000) {
  const result = await fetchWithTimeout(fetchFn, url, options, timeoutMs);
  if (!result?.ok) throw new MediaDriveError(code, 502);
  try {
    return await result.json();
  } catch {
    throw new MediaDriveError("GOOGLE_DRIVE_INVALID_RESPONSE", 502);
  }
}

async function refreshGoogleAccessToken(fetchFn, config) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  });
  const result = await fetchWithTimeout(fetchFn, GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  }, 10000);
  if (!result?.ok) throw new MediaDriveError("GOOGLE_OAUTH_REFRESH_FAILED", 502);
  let payload;
  try {
    payload = await result.json();
  } catch {
    throw new MediaDriveError("GOOGLE_OAUTH_INVALID_RESPONSE", 502);
  }
  const accessToken = cleanText(payload?.access_token, 4096);
  if (!accessToken) throw new MediaDriveError("GOOGLE_OAUTH_REFRESH_FAILED", 502);
  return accessToken;
}

function actionAllowed(role, action) {
  if (action === "bootstrap_root") return ROOT_ADMIN_ROLES.has(role);
  if (action === "read_metadata" || action === "read_content" || action === "capabilities") return MEDIA_READ_ROLES.has(role);
  if (action === "delete_media") return MEDIA_WRITE_ROLES.has(role);
  return MEDIA_WRITE_ROLES.has(role);
}

function mediaContextKey(scope, businessContext) {
  return scope === "warranty" ? "warranty" : cleanToken(businessContext, 40);
}

function assertMediaContextAllowed(role, scope, businessContext, mode = "write") {
  const key = mediaContextKey(scope, businessContext);
  const matrix = mode === "read"
    ? CONTEXT_READ_ROLES
    : mode === "delete"
      ? CONTEXT_DELETE_ROLES
      : CONTEXT_WRITE_ROLES;
  if (!key || !matrix[key]?.has(role)) {
    throw new MediaDriveError("FORBIDDEN_MEDIA_CONTEXT", 403);
  }
}

async function resolveCaller(clientFactory, supabaseUrl, publishableKey, jwt, workshopId, action) {
  const client = clientFactory(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await client.auth.getUser(jwt);
  const user = authData?.user;
  if (authError || !user?.id) {
    return { ok: false, response: failure("UNAUTHENTICATED", "Identité Supabase invalide ou expirée.", 401) };
  }

  const { data: membership, error: membershipError } = await client
    .from("workshop_members")
    .select("workshop_id, user_id, role")
    .eq("workshop_id", workshopId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  const role = cleanToken(membership?.role, 80);
  if (membershipError
    || !membership
    || String(membership.workshop_id || "") !== workshopId
    || String(membership.user_id || "") !== String(user.id)
    || !actionAllowed(role, action)) {
    return { ok: false, response: failure("FORBIDDEN_MEDIA_DRIVE", "Accès média non autorisé.", 403) };
  }
  return { ok: true, user, membership, role, client };
}

async function loadRepairOrder(client, workshopId, repairOrderId) {
  if (!isUuid(repairOrderId)) throw new MediaDriveError("INVALID_REPAIR_ORDER", 400);
  const { data, error } = await client
    .from("repair_orders")
    .select("id, workshop_id, local_id, order_number, vehicle_id")
    .eq("id", repairOrderId)
    .eq("workshop_id", workshopId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) throw new MediaDriveError("REPAIR_ORDER_NOT_FOUND", 404);
  return data;
}

async function loadVehicle(client, workshopId, vehicleId) {
  if (!isUuid(vehicleId)) throw new MediaDriveError("VEHICLE_NOT_FOUND", 404);
  const { data, error } = await client
    .from("vehicles")
    .select("id, workshop_id, vin")
    .eq("id", vehicleId)
    .eq("workshop_id", workshopId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data || !cleanText(data.vin, 80)) throw new MediaDriveError("VEHICLE_VIN_REQUIRED", 409);
  return data;
}

async function loadClaim(client, workshopId, claimId) {
  if (!isUuid(claimId)) throw new MediaDriveError("INVALID_CLAIM", 400);
  const { data, error } = await client
    .from("repair_claims")
    .select("id, workshop_id, local_id, repair_order_id")
    .eq("id", claimId)
    .eq("workshop_id", workshopId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) throw new MediaDriveError("CLAIM_NOT_FOUND", 404);
  return data;
}

async function buildBusinessFolderSpec(client, workshopId, payload) {
  const scope = cleanToken(payload.scope, 40);
  if (scope === "vehicle") {
    const context = cleanToken(payload.business_context, 40);
    if (!VEHICLE_CONTEXTS.has(context)) throw new MediaDriveError("INVALID_BUSINESS_CONTEXT", 400);
    const order = await loadRepairOrder(client, workshopId, cleanText(payload.repair_order_id, 80));
    const vehicle = await loadVehicle(client, workshopId, order.vehicle_id);
    const vin = safeDriveSegment(String(vehicle.vin || "").toUpperCase(), "VIN");
    const orderLabel = safeDriveSegment(order.order_number || order.local_id || order.id, "OR");
    return {
      scope,
      businessContext: context,
      descriptors: [
        { name: "VEHICLES", key: "static:vehicles" },
        { name: vin, key: buildLogicalKey("vehicle", vehicle.id) },
        { name: `OR-${orderLabel}-${String(order.id).slice(0, 8)}`, key: buildLogicalKey("repair-order", order.id) },
        { name: context.toUpperCase(), key: buildLogicalKey(`repair-order:${order.id}:context`, context) },
      ],
    };
  }
  if (scope === "warranty") {
    const section = cleanToken(payload.warranty_section, 40);
    if (!WARRANTY_SECTIONS.has(section)) throw new MediaDriveError("INVALID_WARRANTY_SECTION", 400);
    const claim = await loadClaim(client, workshopId, cleanText(payload.claim_id, 80));
    const repairOrderId = cleanText(payload.repair_order_id, 80);
    if (repairOrderId) {
      const order = await loadRepairOrder(client, workshopId, repairOrderId);
      if (String(claim.repair_order_id || "") !== String(order.id)) {
        throw new MediaDriveError("CLAIM_REPAIR_ORDER_MISMATCH", 409);
      }
    }
    const claimLabel = safeDriveSegment(claim.local_id || claim.id, "CLAIM");
    return {
      scope,
      businessContext: "warranty",
      descriptors: [
        { name: "WARRANTY", key: "static:warranty" },
        { name: `CLAIM-${claimLabel}-${String(claim.id).slice(0, 8)}`, key: buildLogicalKey("claim", claim.id) },
        { name: section.toUpperCase(), key: buildLogicalKey(`claim:${claim.id}:section`, section) },
      ],
    };
  }
  throw new MediaDriveError("INVALID_MEDIA_SCOPE", 400);
}

async function listManagedFolders(fetchFn, accessToken, parentId, logicalKey) {
  const q = [
    `'${escapeDriveQuery(parentId)}' in parents`,
    "trashed = false",
    `mimeType = '${DRIVE_FOLDER_MIME}'`,
    `appProperties has { key='nimr_key' and value='${escapeDriveQuery(logicalKey)}' }`,
  ].join(" and ");
  const params = new URLSearchParams({
    q,
    spaces: "drive",
    pageSize: "100",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
    fields: "files(id,name,mimeType,parents,appProperties,createdTime,trashed)",
  });
  const payload = await fetchJson(
    fetchFn,
    `${GOOGLE_DRIVE_API}/files?${params}`,
    { method: "GET", headers: driveHeaders(accessToken) },
    "GOOGLE_DRIVE_FOLDER_LOOKUP_FAILED",
  );
  return Array.isArray(payload?.files) ? payload.files : [];
}

function chooseStableFolder(rows) {
  return rows
    .filter((row) => row && row.id && row.trashed !== true && row.mimeType === DRIVE_FOLDER_MIME)
    .sort((a, b) =>
      String(a.createdTime || "").localeCompare(String(b.createdTime || ""))
      || String(a.id).localeCompare(String(b.id))
    )[0] || null;
}

async function listManagedMediaByLocalHash(fetchFn, accessToken, parentId, workshopId, localHash) {
  const q = [
    `'${escapeDriveQuery(parentId)}' in parents`,
    "trashed = false",
    `appProperties has { key='nimr_managed' and value='true' }`,
    `appProperties has { key='nimr_workshop' and value='${escapeDriveQuery(workshopId)}' }`,
    `appProperties has { key='nimr_local_hash' and value='${escapeDriveQuery(localHash)}' }`,
  ].join(" and ");
  const params = new URLSearchParams({
    q,
    spaces: "drive",
    pageSize: "100",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
    fields: "files(id,name,mimeType,size,parents,appProperties,createdTime,modifiedTime,trashed,md5Checksum,sha256Checksum)",
  });
  const payload = await fetchJson(
    fetchFn,
    `${GOOGLE_DRIVE_API}/files?${params}`,
    { method: "GET", headers: driveHeaders(accessToken) },
    "GOOGLE_DRIVE_MEDIA_LOOKUP_FAILED",
  );
  return Array.isArray(payload?.files) ? payload.files : [];
}

function chooseStableMedia(rows) {
  return rows
    .filter((row) => row && row.id && row.trashed !== true && row.mimeType !== DRIVE_FOLDER_MIME)
    .sort((a, b) =>
      String(a.createdTime || "").localeCompare(String(b.createdTime || ""))
      || String(a.id).localeCompare(String(b.id))
    )[0] || null;
}

async function createManagedFolder(fetchFn, accessToken, parentId, name, logicalKey, workshopId) {
  return fetchJson(
    fetchFn,
    `${GOOGLE_DRIVE_API}/files?fields=id,name,mimeType,parents,appProperties,createdTime&supportsAllDrives=true`,
    {
      method: "POST",
      headers: driveHeaders(accessToken, { "Content-Type": "application/json; charset=UTF-8" }),
      body: JSON.stringify({
        name,
        mimeType: DRIVE_FOLDER_MIME,
        parents: [parentId],
        appProperties: {
          nimr_managed: "true",
          nimr_key: logicalKey,
          nimr_workshop: workshopId,
        },
      }),
    },
    "GOOGLE_DRIVE_FOLDER_CREATE_FAILED",
  );
}

async function trashManagedDuplicate(fetchFn, accessToken, fileId) {
  const result = await fetchWithTimeout(
    fetchFn,
    `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
    {
      method: "PATCH",
      headers: driveHeaders(accessToken, { "Content-Type": "application/json; charset=UTF-8" }),
      body: JSON.stringify({ trashed: true }),
    },
  );
  if (!result?.ok) throw new MediaDriveError("GOOGLE_DRIVE_DUPLICATE_CLEANUP_FAILED", 502);
}

async function ensureManagedFolder(fetchFn, accessToken, parentId, descriptor, workshopId) {
  const existing = chooseStableFolder(await listManagedFolders(
    fetchFn,
    accessToken,
    parentId,
    descriptor.key,
  ));
  if (existing) return existing;

  const created = await createManagedFolder(
    fetchFn,
    accessToken,
    parentId,
    descriptor.name,
    descriptor.key,
    workshopId,
  );
  const afterCreate = await listManagedFolders(fetchFn, accessToken, parentId, descriptor.key);
  const winner = chooseStableFolder(afterCreate) || created;
  if (created?.id && winner?.id && created.id !== winner.id) {
    await trashManagedDuplicate(fetchFn, accessToken, created.id);
  }
  return winner;
}

async function ensureBusinessFolder(fetchFn, accessToken, rootFolderId, spec, workshopId) {
  let parentId = rootFolderId;
  const resolved = [];
  for (const descriptor of spec.descriptors) {
    const folder = await ensureManagedFolder(fetchFn, accessToken, parentId, descriptor, workshopId);
    if (!folder?.id) throw new MediaDriveError("GOOGLE_DRIVE_FOLDER_RESOLVE_FAILED", 502);
    parentId = String(folder.id);
    resolved.push({ id: parentId, name: descriptor.name });
  }
  return { folderId: parentId, resolved };
}

async function bootstrapRoot(fetchFn, accessToken, workshopId) {
  const descriptor = { name: ROOT_FOLDER_NAME, key: "nimr-sav-prod-root" };
  const folder = await ensureManagedFolder(fetchFn, accessToken, "root", descriptor, workshopId);
  if (!folder?.id) throw new MediaDriveError("GOOGLE_DRIVE_ROOT_BOOTSTRAP_FAILED", 502);
  return { id: String(folder.id), name: ROOT_FOLDER_NAME };
}

function validateUploadInput(payload, maxUploadBytes) {
  const localId = cleanText(payload.local_id, 160);
  const rawFileName = cleanText(payload.filename, 180);
  const fileName = safeFileName(rawFileName);
  const mimeType = cleanText(payload.mime_type, 120).toLowerCase();
  const sizeBytes = Number(payload.size_bytes);
  const checksumSha256 = cleanText(payload.checksum_sha256, 128).toLowerCase();
  if (!localId) throw new MediaDriveError("LOCAL_ID_REQUIRED", 400);
  if (!rawFileName || !fileName) throw new MediaDriveError("FILENAME_REQUIRED", 400);
  if (!UPLOAD_MIME_TYPES.has(mimeType)) throw new MediaDriveError("UNSUPPORTED_MEDIA_TYPE", 415);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxUploadBytes) {
    throw new MediaDriveError("INVALID_MEDIA_SIZE", 413);
  }
  if (!/^[a-f0-9]{64}$/u.test(checksumSha256)) throw new MediaDriveError("INVALID_MEDIA_CHECKSUM", 400);
  return { localId, fileName, mimeType, sizeBytes, checksumSha256 };
}

async function beginResumableUpload(fetchFn, accessToken, folderId, workshopId, spec, input) {
  const localHash = await sha256Hex(input.localId);
  const result = await fetchWithTimeout(
    fetchFn,
    `${GOOGLE_DRIVE_UPLOAD}/files?uploadType=resumable&fields=id,name,mimeType,size,parents,appProperties,md5Checksum,sha256Checksum&supportsAllDrives=true`,
    {
      method: "POST",
      headers: driveHeaders(accessToken, {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": input.mimeType,
        "X-Upload-Content-Length": String(input.sizeBytes),
      }),
      body: JSON.stringify({
        name: input.fileName,
        parents: [folderId],
        appProperties: {
          nimr_managed: "true",
          nimr_workshop: workshopId,
          nimr_local_hash: localHash,
          nimr_content_sha256: input.checksumSha256,
          nimr_scope: spec.scope,
          nimr_context: spec.businessContext,
        },
      }),
    },
    12000,
  );
  if (!result?.ok) throw new MediaDriveError("GOOGLE_DRIVE_UPLOAD_SESSION_FAILED", 502);
  const uploadUrl = String(result.headers?.get?.("Location") || "").trim();
  if (!uploadUrl.startsWith("https://www.googleapis.com/upload/drive/")) {
    throw new MediaDriveError("GOOGLE_DRIVE_UPLOAD_SESSION_INVALID", 502);
  }
  return uploadUrl;
}

async function assertNoPublicPermissions(fetchFn, accessToken, fileId) {
  const id = cleanText(fileId, 256);
  const params = new URLSearchParams({ fields: "permissions(id,type,role,allowFileDiscovery)", supportsAllDrives: "true" });
  const payload = await fetchJson(
    fetchFn,
    `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(id)}/permissions?${params}`,
    { method: "GET", headers: driveHeaders(accessToken) },
    "GOOGLE_DRIVE_PERMISSION_READ_FAILED",
  );
  const permissions = Array.isArray(payload?.permissions) ? payload.permissions : [];
  if (permissions.some((permission) => ["anyone", "domain"].includes(cleanToken(permission?.type, 40)))) {
    throw new MediaDriveError("MEDIA_PUBLIC_PERMISSION_DETECTED", 409);
  }
}
async function readDriveFileContent(fetchFn, accessToken, fileId) {
  const id = cleanText(fileId, 256);
  const result = await fetchWithTimeout(fetchFn, `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { method: "GET", headers: driveHeaders(accessToken) }, 30000);
  if (!result?.ok) throw new MediaDriveError("GOOGLE_DRIVE_CONTENT_READ_FAILED", 502);
  return result;
}
async function trashManagedMedia(fetchFn, accessToken, fileId) {
  const id = cleanText(fileId, 256);
  const result = await fetchWithTimeout(fetchFn, `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(id)}?supportsAllDrives=true`, {
    method: "PATCH", headers: driveHeaders(accessToken, { "Content-Type": "application/json; charset=UTF-8" }), body: JSON.stringify({ trashed: true }),
  });
  if (!result?.ok) throw new MediaDriveError("GOOGLE_DRIVE_MEDIA_DELETE_FAILED", 502);
}
async function getDriveFileMetadata(fetchFn, accessToken, fileId) {
  const id = cleanText(fileId, 256);
  if (!id) throw new MediaDriveError("DRIVE_FILE_ID_REQUIRED", 400);
  const params = new URLSearchParams({
    fields: "id,name,mimeType,size,parents,appProperties,trashed,md5Checksum,sha256Checksum,createdTime,modifiedTime",
    supportsAllDrives: "true",
  });
  return fetchJson(
    fetchFn,
    `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(id)}?${params}`,
    { method: "GET", headers: driveHeaders(accessToken) },
    "GOOGLE_DRIVE_FILE_READ_FAILED",
  );
}

function sanitizeDriveMetadata(file) {
  return {
    id: cleanText(file?.id, 256),
    name: cleanText(file?.name, 256),
    mime_type: cleanText(file?.mimeType, 160),
    size_bytes: Number.isFinite(Number(file?.size)) ? Number(file.size) : null,
    parent_id: Array.isArray(file?.parents) ? cleanText(file.parents[0], 256) || null : null,
    md5_checksum: cleanText(file?.md5Checksum, 256) || null,
    sha256_checksum: cleanText(file?.sha256Checksum, 256) || null,
    created_at: cleanText(file?.createdTime, 80) || null,
    modified_at: cleanText(file?.modifiedTime, 80) || null,
  };
}

function assertManagedFile(file, workshopId, expected = {}) {
  if (!file || file.trashed === true) throw new MediaDriveError("MEDIA_FILE_NOT_AVAILABLE", 404);
  const props = file.appProperties && typeof file.appProperties === "object"
    ? file.appProperties
    : {};
  if (props.nimr_managed !== "true" || String(props.nimr_workshop || "") !== workshopId) {
    throw new MediaDriveError("MEDIA_FILE_SCOPE_MISMATCH", 403);
  }
  if (expected.parentId
    && (!Array.isArray(file.parents) || !file.parents.map(String).includes(String(expected.parentId)))) {
    throw new MediaDriveError("MEDIA_FILE_PARENT_MISMATCH", 403);
  }
  if (expected.localHash && String(props.nimr_local_hash || "") !== String(expected.localHash)) {
    throw new MediaDriveError("MEDIA_FILE_IDEMPOTENCY_MISMATCH", 409);
  }
  if (expected.contentSha256 && String(props.nimr_content_sha256 || "") !== String(expected.contentSha256)) {
    throw new MediaDriveError("MEDIA_FILE_INTEGRITY_MISMATCH", 409);
  }
}

function googleConfigReady(config) {
  return Boolean(config.clientId && config.clientSecret && config.refreshToken);
}


function auditDescriptor(payload, action) {
  const repairOrderId = isUuid(payload.repair_order_id) ? String(payload.repair_order_id) : null;
  const claimId = isUuid(payload.claim_id) ? String(payload.claim_id) : null;
  const localId = cleanText(payload.local_id, 160) || null;
  const scope = cleanToken(payload.scope, 40) || null;
  const businessContext = cleanToken(payload.business_context, 40) || null;
  const warrantySection = cleanToken(payload.warranty_section, 40) || null;

  return {
    repairOrderId,
    row: {
      local_id: localId,
      repair_order_id: repairOrderId,
      action: `media_drive.${action}`,
      entity_type: claimId ? "repair_claim" : repairOrderId ? "repair_order" : "google_drive",
      entity_id: claimId || repairOrderId || null,
      after_data: {
        status: "attempted",
        drive_file_id: cleanText(payload.drive_file_id, 256) || null,
        scope,
        business_context: businessContext,
        warranty_section: warrantySection,
      },
    },
  };
}

async function writeAuditAttempt(client, userId, workshopId, action, payload) {
  const descriptor = auditDescriptor(payload, action);
  const { error } = await client.from("audit_logs").insert({
    workshop_id: workshopId,
    ...descriptor.row,
    created_by: userId,
    updated_by: userId,
    sync_source: "media_drive",
  });
  if (error) throw new MediaDriveError("MEDIA_DRIVE_AUDIT_FAILED", 500);
}

export function createMediaDriveHandler(overrides = {}) {
  const environment = overrides.environment || Deno.env;
  const clientFactory = overrides.clientFactory || createClient;
  const fetchFn = overrides.fetchFn || fetch;

  return async function mediaDrive(request) {
    if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
    if (request.method !== "POST") return failure("METHOD_NOT_ALLOWED", "Méthode non autorisée.", 405);

    const authorization = String(request.headers.get("Authorization") || "").trim();
    const jwt = authorization.match(/^Bearer\s+(.+)$/iu)?.[1]?.trim() || "";
    if (!jwt) return failure("UNAUTHENTICATED", "Jeton utilisateur Supabase requis.", 401);

    const payload = await parseRequestBody(request);
    if (!payload) return failure("INVALID_REQUEST", "Corps JSON invalide.");

    const action = cleanToken(payload.action, 80);
    if (!ACTIONS.has(action)) return failure("INVALID_ACTION", "Action média non autorisée.");

    const workshopId = cleanText(payload.workshop_id, 128);
    if (!isUuid(workshopId)) return failure("WORKSHOP_REQUIRED", "Atelier invalide.");

    const supabaseUrl = String(environment.get("SUPABASE_URL") || "").trim();
    const publishableKey = readPublishableKey(environment);
    if (!supabaseUrl || !publishableKey) {
      return failure("SERVER_CONFIGURATION_ERROR", "Configuration serveur Supabase indisponible.", 503);
    }

    const caller = await resolveCaller(
      clientFactory,
      supabaseUrl,
      publishableKey,
      jwt,
      workshopId,
      action,
    );
    if (!caller.ok) return caller.response;

    const googleConfig = readGoogleConfig(environment);
    if (action === "capabilities") {
      return response({
        ok: true,
        action,
        workshop_id: workshopId,
        caller_role: caller.role,
        oauth_configured: googleConfigReady(googleConfig),
        root_configured: Boolean(googleConfig.rootFolderId),
        scope: GOOGLE_DRIVE_SCOPE,
      });
    }

    if (!googleConfigReady(googleConfig)) {
      return failure("GOOGLE_DRIVE_NOT_CONFIGURED", "Configuration Google Drive indisponible.", 503);
    }
    if (action !== "bootstrap_root" && !googleConfig.rootFolderId) {
      return failure("GOOGLE_DRIVE_ROOT_NOT_CONFIGURED", "Racine Google Drive non configurée.", 503);
    }

    try {
      let spec = null;
      let uploadInput = null;
      let finalizeLocalHash = "";
      let finalizeContentSha256 = "";

      if (!["bootstrap_root", "read_metadata", "read_content", "delete_media"].includes(action)) {
        spec = await buildBusinessFolderSpec(caller.client, workshopId, payload);
        assertMediaContextAllowed(caller.role, spec.scope, spec.businessContext, "write");
        if (action === "begin_upload") {
          uploadInput = validateUploadInput(payload, readMaxUploadBytes(environment));
        }
        if (action === "finalize_upload") {
          const finalizeLocalId = cleanText(payload.local_id, 160);
          if (!finalizeLocalId) throw new MediaDriveError("LOCAL_ID_REQUIRED", 400);
          finalizeLocalHash = await sha256Hex(finalizeLocalId);
          finalizeContentSha256 = cleanText(payload.checksum_sha256, 128).toLowerCase();
          if (!/^[a-f0-9]{64}$/u.test(finalizeContentSha256)) throw new MediaDriveError("INVALID_MEDIA_CHECKSUM", 400);
        }
      }

      await writeAuditAttempt(caller.client, String(caller.user.id), workshopId, action, payload);
      const accessToken = await refreshGoogleAccessToken(fetchFn, googleConfig);

      if (action === "bootstrap_root") {
        const root = await bootstrapRoot(fetchFn, accessToken, workshopId);
        return response({
          ok: true,
          action,
          root_folder_id: root.id,
          root_name: root.name,
        });
      }

      if (["read_metadata", "read_content", "delete_media"].includes(action)) {
        const file = await getDriveFileMetadata(fetchFn, accessToken, payload.drive_file_id);
        assertManagedFile(file, workshopId);
        const props = file.appProperties && typeof file.appProperties === "object" ? file.appProperties : {};
        const scope = cleanToken(props.nimr_scope, 40);
        const context = cleanToken(props.nimr_context, 40);
        assertMediaContextAllowed(caller.role, scope, context, action === "delete_media" ? "delete" : "read");
        await assertNoPublicPermissions(fetchFn, accessToken, payload.drive_file_id);
        if (action === "read_metadata") return response({ ok: true, action, file: sanitizeDriveMetadata(file) });
        if (action === "delete_media") {
          await trashManagedMedia(fetchFn, accessToken, payload.drive_file_id);
          return response({ ok: true, action, drive_file_id: cleanText(payload.drive_file_id, 256), deleted: true });
        }
        const content = await readDriveFileContent(fetchFn, accessToken, payload.drive_file_id);
        const headers = new Headers({
          "Content-Type": cleanText(file.mimeType, 160) || "application/octet-stream",
          "Content-Disposition": `inline; filename="${safeFileName(file.name || "media")}"`,
          "Cache-Control": "private, no-store",
          "Pragma": "no-cache",
          "X-Content-Type-Options": "nosniff",
        });
        return new Response(content.body, { status: 200, headers });
      }

      const folder = await ensureBusinessFolder(
        fetchFn,
        accessToken,
        googleConfig.rootFolderId,
        spec,
        workshopId,
      );

      if (action === "resolve_folder") {
        return response({
          ok: true,
          action,
          scope: spec.scope,
          business_context: spec.businessContext,
          folder_id: folder.folderId,
        });
      }

      if (action === "begin_upload") {
        const localHash = await sha256Hex(uploadInput.localId);
        const existingFile = chooseStableMedia(await listManagedMediaByLocalHash(
          fetchFn,
          accessToken,
          folder.folderId,
          workshopId,
          localHash,
        ));
        if (existingFile) {
          assertManagedFile(existingFile, workshopId, {
            parentId: folder.folderId,
            localHash,
          });
          if (String(existingFile.mimeType || "") !== uploadInput.mimeType
            || Number(existingFile.size) !== uploadInput.sizeBytes) {
            throw new MediaDriveError("MEDIA_IDEMPOTENCY_CONTENT_MISMATCH", 409);
          }
          return response({
            ok: true,
            action,
            already_uploaded: true,
            drive_file_id: String(existingFile.id),
            file: sanitizeDriveMetadata(existingFile),
            mime_type: uploadInput.mimeType,
            size_bytes: uploadInput.sizeBytes,
            local_id: uploadInput.localId,
            folder_id: folder.folderId,
          });
        }

        const uploadUrl = await beginResumableUpload(
          fetchFn,
          accessToken,
          folder.folderId,
          workshopId,
          spec,
          uploadInput,
        );
        return response({
          ok: true,
          action,
          already_uploaded: false,
          upload_url: uploadUrl,
          upload_method: "PUT",
          mime_type: uploadInput.mimeType,
          size_bytes: uploadInput.sizeBytes,
          local_id: uploadInput.localId,
          folder_id: folder.folderId,
        });
      }

      const file = await getDriveFileMetadata(fetchFn, accessToken, payload.drive_file_id);
      assertManagedFile(file, workshopId, {
        parentId: folder.folderId,
        localHash: finalizeLocalHash,
        contentSha256: finalizeContentSha256,
      });

      const matchingFiles = await listManagedMediaByLocalHash(
        fetchFn,
        accessToken,
        folder.folderId,
        workshopId,
        finalizeLocalHash,
      );
      for (const candidate of matchingFiles) {
        assertManagedFile(candidate, workshopId, {
          parentId: folder.folderId,
          localHash: finalizeLocalHash,
          contentSha256: finalizeContentSha256,
        });
        if (String(candidate.mimeType || "") !== String(file.mimeType || "")
          || Number(candidate.size) !== Number(file.size)) {
          throw new MediaDriveError("MEDIA_IDEMPOTENCY_CONTENT_MISMATCH", 409);
        }
      }
      const canonicalFile = chooseStableMedia(matchingFiles) || file;
      for (const duplicate of matchingFiles) {
        if (!duplicate?.id || String(duplicate.id) === String(canonicalFile.id)) continue;
        await trashManagedDuplicate(fetchFn, accessToken, String(duplicate.id));
      }

      return response({
        ok: true,
        action: "finalize_upload",
        scope: spec.scope,
        business_context: spec.businessContext,
        file: sanitizeDriveMetadata(canonicalFile),
      });
    } catch (error) {
      if (error instanceof MediaDriveError) {
        const message = error.code === "MEDIA_DRIVE_AUDIT_FAILED"
          ? "Journalisation média indisponible."
          : "Service Google Drive indisponible ou requête refusée.";
        return failure(error.code, message, error.status);
      }
      return failure("MEDIA_DRIVE_CONNECTOR_FAILED", "Service Google Drive indisponible.", 502);
    }
  };
}

if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve(createMediaDriveHandler());
}
