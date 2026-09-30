import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHash, webcrypto } from "node:crypto";

const read = (file) => fs.readFileSync(file, "utf8");
const WORKSHOP_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const ORDER_ID = "10000000-0000-4000-8000-000000000001";
const VEHICLE_ID = "20000000-0000-4000-8000-000000000001";
const CLAIM_ID = "30000000-0000-4000-8000-000000000001";
const ROOT_ID = "drive-root-001";

function loadEdgeFactory() {
  let source = read("supabase/functions/media-drive/index.ts");
  source = source.replace(
    /^import\s+\{\s*createClient\s*\}\s+from\s+["'][^"']+["'];?\s*$/mu,
    "const createClient = (...args) => globalThis.__clientFactory(...args);",
  );
  source = source.replace(
    "export function createMediaDriveHandler",
    "function createMediaDriveHandler",
  );
  source = source.replace(
    /if \(typeof Deno !== ["']undefined["'][\s\S]*$/mu,
    "",
  );
  source += "\nglobalThis.__mediaDriveFactory = createMediaDriveHandler;";
  const context = {
    console,
    Request,
    Response,
    Headers,
    URL,
    URLSearchParams,
    AbortSignal,
    TextEncoder,
    Uint8Array,
    crypto: webcrypto,
    setTimeout,
    clearTimeout,
    __clientFactory: null,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

function environment(values = {}) {
  const map = new Map(Object.entries({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "publishable",
    GOOGLE_DRIVE_CLIENT_ID: "google-client-id",
    GOOGLE_DRIVE_CLIENT_SECRET: "google-client-secret",
    GOOGLE_DRIVE_REFRESH_TOKEN: "google-refresh-token",
    GOOGLE_DRIVE_ROOT_FOLDER_ID: ROOT_ID,
    ...values,
  }));
  return { get: (name) => map.get(name) };
}

function createSupabaseClient(role = "reception", records = {}, options = {}) {
  const auditSink = Array.isArray(options.auditSink) ? options.auditSink : [];
  const auditError = options.auditError || null;
  const tableRecords = {
    workshop_members: {
      workshop_id: WORKSHOP_ID,
      user_id: USER_ID,
      role,
    },
    repair_orders: {
      id: ORDER_ID,
      workshop_id: WORKSHOP_ID,
      local_id: "case-001",
      order_number: "OR/2026/001",
      vehicle_id: VEHICLE_ID,
    },
    vehicles: {
      id: VEHICLE_ID,
      workshop_id: WORKSHOP_ID,
      vin: "LGJE1FE59RM123456",
    },
    repair_claims: {
      id: CLAIM_ID,
      workshop_id: WORKSHOP_ID,
      local_id: "GAR-001",
      repair_order_id: ORDER_ID,
    },
    ...records,
  };
  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: USER_ID } },
        error: null,
      }),
    },
    from(table) {
      const filters = [];
      const chain = {
        select() { return chain; },
        eq(column, value) { filters.push(["eq", column, value]); return chain; },
        is(column, value) { filters.push(["is", column, value]); return chain; },
        async insert(row) {
          if (table !== "audit_logs") return { data: null, error: new Error("unexpected insert") };
          if (auditError) return { data: null, error: auditError };
          auditSink.push(structuredClone(row));
          return { data: row, error: null };
        },
        async maybeSingle() {
          const row = tableRecords[table] ?? null;
          if (!row) return { data: null, error: null };
          for (const [, column, value] of filters.filter(([kind]) => kind === "eq")) {
            if (String(row[column] ?? "") !== String(value ?? "")) {
              return { data: null, error: null };
            }
          }
          return { data: { ...row }, error: null };
        },
      };
      return chain;
    },
  };
}

function clientFactoryFor(role = "reception", records = {}, options = {}) {
  return () => createSupabaseClient(role, records, options);
}

function localHash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function tokenResponse(accessToken = "google-access-token") {
  return jsonResponse({
    access_token: accessToken,
    expires_in: 3600,
    token_type: "Bearer",
  });
}

function makeDriveMock({
  metadataById = {},
  existingMedia = [],
  uploadLocation = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=session-123",
  permissionsById = {},
  contentById = {},
} = {}) {
  const folders = [];
  const calls = [];
  let sequence = 0;

  function queryValue(q, pattern) {
    return String(q || "").match(pattern)?.[1] || "";
  }

  async function fetchFn(url, options = {}) {
    const parsed = new URL(url);
    const method = options.method || "GET";
    calls.push({ url, method, headers: options.headers || {}, body: options.body || null });

    if (url === "https://oauth2.googleapis.com/token") return tokenResponse();

    if (parsed.origin === "https://www.googleapis.com"
      && parsed.pathname === "/drive/v3/files"
      && method === "GET") {
      const q = parsed.searchParams.get("q") || "";
      const parentId = queryValue(q, /'([^']+)' in parents/u);
      const localMediaHash = queryValue(q, /key='nimr_local_hash' and value='([^']+)'/u);
      if (localMediaHash) {
        return jsonResponse({
          files: existingMedia.filter((file) =>
            file.parents?.includes(parentId)
            && file.appProperties?.nimr_local_hash === localMediaHash
            && file.appProperties?.nimr_workshop === WORKSHOP_ID
            && file.trashed !== true
          ),
        });
      }
      const logicalKey = queryValue(q, /key='nimr_key' and value='([^']+)'/u);
      return jsonResponse({
        files: folders.filter((folder) =>
          folder.parents?.includes(parentId)
          && folder.appProperties?.nimr_key === logicalKey
          && folder.trashed !== true
        ),
      });
    }

    if (parsed.origin === "https://www.googleapis.com"
      && parsed.pathname === "/drive/v3/files"
      && method === "POST") {
      const body = JSON.parse(String(options.body || "{}"));
      sequence += 1;
      const folder = {
        id: `folder-${sequence}`,
        name: body.name,
        mimeType: body.mimeType,
        parents: body.parents,
        appProperties: body.appProperties,
        createdTime: `2026-09-29T20:00:${String(sequence).padStart(2, "0")}Z`,
        trashed: false,
      };
      folders.push(folder);
      return jsonResponse(folder);
    }

    if (parsed.origin === "https://www.googleapis.com"
      && parsed.pathname.endsWith("/permissions")
      && method === "GET") {
      const id = decodeURIComponent(parsed.pathname.split("/").at(-2));
      return jsonResponse({ permissions: permissionsById[id] || [{ id: "owner", type: "user", role: "owner" }] });
    }

    if (parsed.origin === "https://www.googleapis.com"
      && parsed.pathname.startsWith("/drive/v3/files/")
      && parsed.searchParams.get("alt") === "media"
      && method === "GET") {
      const id = decodeURIComponent(parsed.pathname.split("/").pop());
      return new Response(contentById[id] || "binary-media", { status: 200, headers: { "Content-Type": metadataById[id]?.mimeType || "application/octet-stream" } });
    }

    if (parsed.origin === "https://www.googleapis.com"
      && parsed.pathname.startsWith("/drive/v3/files/")
      && method === "PATCH") {
      const id = decodeURIComponent(parsed.pathname.split("/").pop());
      const folder = folders.find((entry) => entry.id === id);
      if (folder) folder.trashed = true;
      return jsonResponse(folder || { id });
    }

    if (parsed.origin === "https://www.googleapis.com"
      && parsed.pathname.startsWith("/drive/v3/files/")
      && method === "GET") {
      const id = decodeURIComponent(parsed.pathname.split("/").pop());
      return metadataById[id]
        ? jsonResponse(metadataById[id])
        : jsonResponse({ error: "not-found" }, 404);
    }

    if (parsed.origin === "https://www.googleapis.com"
      && parsed.pathname === "/upload/drive/v3/files"
      && method === "POST") {
      return new Response("", {
        status: 200,
        headers: { Location: uploadLocation },
      });
    }

    return jsonResponse({ error: "unexpected", url, method }, 500);
  }

  return { fetchFn, calls, folders };
}

async function invoke(handler, payload, { bearer = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (bearer) headers.Authorization = "Bearer supabase-user-jwt";
  return handler(new Request("https://example.test/functions/v1/media-drive", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  }));
}

test("surface KHA-47 exists, verify_jwt is true, and browser files contain no Google Drive secret", () => {
  assert.ok(fs.existsSync("supabase/functions/media-drive/index.ts"));
  const config = read("supabase/config.toml");
  assert.match(config, /\[functions\.media-drive\][\s\S]*verify_jwt\s*=\s*true/u);
  const browserSources = [
    "js/supabase-client.js",
    "js/photos.js",
    "js/state.js",
    "js/ui-cases.js",
  ].map(read).join("\n");
  assert.doesNotMatch(
    browserSources,
    /GOOGLE_DRIVE_(?:CLIENT_ID|CLIENT_SECRET|REFRESH_TOKEN|ROOT_FOLDER_ID)|oauth2\.googleapis\.com/iu,
  );
});

test("missing bearer is rejected before Supabase or Google access", async () => {
  const edge = loadEdgeFactory();
  let clientCalls = 0;
  let fetchCalls = 0;
  edge.__clientFactory = () => { clientCalls += 1; return createSupabaseClient(); };
  const handler = edge.__mediaDriveFactory({
    environment: environment(),
    fetchFn: async () => { fetchCalls += 1; throw new Error("unexpected"); },
  });
  const response = await invoke(handler, {
    action: "capabilities",
    workshop_id: WORKSHOP_ID,
  }, { bearer: false });
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.code, "UNAUTHENTICATED");
  assert.equal(clientCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("non-media workshop role is forbidden before any Google request", async () => {
  const edge = loadEdgeFactory();
  edge.__clientFactory = clientFactoryFor("directeur_pieces");
  let fetchCalls = 0;
  const handler = edge.__mediaDriveFactory({
    environment: environment(),
    fetchFn: async () => { fetchCalls += 1; throw new Error("unexpected"); },
  });
  const response = await invoke(handler, {
    action: "resolve_folder",
    workshop_id: WORKSHOP_ID,
    scope: "vehicle",
    repair_order_id: ORDER_ID,
    business_context: "reception",
  });
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.code, "FORBIDDEN_MEDIA_DRIVE");
  assert.equal(fetchCalls, 0);
});

test("capabilities exposes only booleans, role and narrow OAuth scope", async () => {
  const edge = loadEdgeFactory();
  edge.__clientFactory = clientFactoryFor("lecture_seule");
  let fetchCalls = 0;
  const handler = edge.__mediaDriveFactory({
    environment: environment(),
    fetchFn: async () => { fetchCalls += 1; throw new Error("unexpected"); },
  });
  const response = await invoke(handler, {
    action: "capabilities",
    workshop_id: WORKSHOP_ID,
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.oauth_configured, true);
  assert.equal(body.root_configured, true);
  assert.equal(body.caller_role, "lecture_seule");
  assert.equal(body.scope, "https://www.googleapis.com/auth/drive.file");
  assert.equal(JSON.stringify(body).includes("google-client-secret"), false);
  assert.equal(JSON.stringify(body).includes("google-refresh-token"), false);
  assert.equal(fetchCalls, 0);
});

test("bootstrap_root is admin-only and creates the app-managed root through OAuth", async () => {
  const edge = loadEdgeFactory();
  edge.__clientFactory = clientFactoryFor("admin_technique");
  const drive = makeDriveMock();
  const handler = edge.__mediaDriveFactory({
    environment: environment({ GOOGLE_DRIVE_ROOT_FOLDER_ID: "" }),
    fetchFn: drive.fetchFn,
  });
  const response = await invoke(handler, {
    action: "bootstrap_root",
    workshop_id: WORKSHOP_ID,
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.root_name, "NIMR-SAV-PROD");
  assert.match(body.root_folder_id, /^folder-/u);
  const createCall = drive.calls.find((call) =>
    call.method === "POST" && new URL(call.url).pathname === "/drive/v3/files"
  );
  assert.ok(createCall);
  const created = JSON.parse(String(createCall.body));
  assert.equal(created.name, "NIMR-SAV-PROD");
  assert.equal(created.parents[0], "root");
  assert.equal(created.appProperties.nimr_key, "nimr-sav-prod-root");
  const rootLookups = drive.calls.filter((call) =>
    call.method === "GET" && new URL(call.url).pathname === "/drive/v3/files"
  );
  assert.ok(rootLookups.length >= 2);
  assert.ok(rootLookups.every((call) =>
    (new URL(call.url).searchParams.get("q") || "").includes("appProperties")
  ));
  assert.ok(rootLookups.every((call) =>
    !(new URL(call.url).searchParams.get("q") || "").includes("name =")
  ));
  assert.ok(rootLookups.every((call) =>
    new URL(call.url).searchParams.get("supportsAllDrives") === "true"
  ));
  assert.ok(rootLookups.every((call) =>
    new URL(call.url).searchParams.get("includeItemsFromAllDrives") === "true"
  ));
});

test("bootstrap_root self-heals a concurrent duplicate by keeping the oldest managed folder", async () => {
  const edge = loadEdgeFactory();
  edge.__clientFactory = clientFactoryFor("admin_technique");
  const calls = [];
  let lookupCount = 0;
  const oldFolder = {
    id: "folder-old",
    name: "NIMR-SAV-PROD",
    mimeType: "application/vnd.google-apps.folder",
    parents: ["root"],
    appProperties: { nimr_managed: "true", nimr_key: "nimr-sav-prod-root", nimr_workshop: WORKSHOP_ID },
    createdTime: "2026-09-29T19:00:00Z",
    trashed: false,
  };
  const newFolder = {
    ...oldFolder,
    id: "folder-new",
    createdTime: "2026-09-29T20:00:00Z",
  };
  const fetchFn = async (url, options = {}) => {
    const parsed = new URL(url);
    const method = options.method || "GET";
    calls.push({ url, method, body: options.body || null });
    if (url === "https://oauth2.googleapis.com/token") return tokenResponse();
    if (parsed.pathname === "/drive/v3/files" && method === "GET") {
      lookupCount += 1;
      return jsonResponse({ files: lookupCount === 1 ? [] : [newFolder, oldFolder] });
    }
    if (parsed.pathname === "/drive/v3/files" && method === "POST") return jsonResponse(newFolder);
    if (parsed.pathname === "/drive/v3/files/folder-new" && method === "PATCH") return jsonResponse({ ...newFolder, trashed: true });
    return jsonResponse({ error: "unexpected" }, 500);
  };
  const handler = edge.__mediaDriveFactory({
    environment: environment({ GOOGLE_DRIVE_ROOT_FOLDER_ID: "" }),
    fetchFn,
  });
  const response = await invoke(handler, {
    action: "bootstrap_root",
    workshop_id: WORKSHOP_ID,
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.root_folder_id, "folder-old");
  assert.ok(calls.some((call) => call.method === "PATCH" && call.url.includes("/folder-new")));
});

test("reception cannot bootstrap the production root", async () => {
  const edge = loadEdgeFactory();
  edge.__clientFactory = clientFactoryFor("reception");
  let fetchCalls = 0;
  const handler = edge.__mediaDriveFactory({
    environment: environment({ GOOGLE_DRIVE_ROOT_FOLDER_ID: "" }),
    fetchFn: async () => { fetchCalls += 1; throw new Error("unexpected"); },
  });
  const response = await invoke(handler, {
    action: "bootstrap_root",
    workshop_id: WORKSHOP_ID,
  });
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.code, "FORBIDDEN_MEDIA_DRIVE");
  assert.equal(fetchCalls, 0);
});

test("resolve_folder derives VEHICLES/VIN/OR/context from Supabase and ignores free path input", async () => {
  const edge = loadEdgeFactory();
  edge.__clientFactory = clientFactoryFor("reception");
  const drive = makeDriveMock();
  const handler = edge.__mediaDriveFactory({
    environment: environment(),
    fetchFn: drive.fetchFn,
  });
  const response = await invoke(handler, {
    action: "resolve_folder",
    workshop_id: WORKSHOP_ID,
    scope: "vehicle",
    repair_order_id: ORDER_ID,
    business_context: "reception",
    path: "../../EVIL/FOLDER",
    vin: "CLIENT-SUPPLIED-VIN",
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.scope, "vehicle");
  assert.equal(body.business_context, "reception");
  assert.match(body.folder_id, /^folder-/u);
  assert.deepEqual(
    drive.folders.filter((folder) => !folder.trashed).map((folder) => folder.name),
    ["VEHICLES", "LGJE1FE59RM123456", "OR-OR_2026_001-10000000", "RECEPTION"],
  );
  assert.equal(JSON.stringify(drive.folders).includes("EVIL"), false);
  assert.equal(JSON.stringify(drive.folders).includes("CLIENT-SUPPLIED-VIN"), false);
});

test("context RBAC prevents a QC role from creating Reception folders", async () => {
  const edge = loadEdgeFactory();
  let fetchCalls = 0;
  const auditSink = [];
  edge.__clientFactory = clientFactoryFor("controle_qualite", {}, { auditSink });
  const handler = edge.__mediaDriveFactory({
    environment: environment(),
    fetchFn: async () => { fetchCalls += 1; throw new Error("unexpected"); },
  });
  const response = await invoke(handler, {
    action: "resolve_folder",
    workshop_id: WORKSHOP_ID,
    scope: "vehicle",
    repair_order_id: ORDER_ID,
    business_context: "reception",
  });
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.code, "FORBIDDEN_MEDIA_CONTEXT");
  assert.equal(auditSink.length, 0);
  assert.equal(fetchCalls, 0);
});

test("context RBAC lets QC resolve QC and blocks a technician from Warranty", async () => {
  const qcEdge = loadEdgeFactory();
  qcEdge.__clientFactory = clientFactoryFor("controle_qualite");
  const qcDrive = makeDriveMock();
  const qcHandler = qcEdge.__mediaDriveFactory({
    environment: environment(),
    fetchFn: qcDrive.fetchFn,
  });
  const qcResponse = await invoke(qcHandler, {
    action: "resolve_folder",
    workshop_id: WORKSHOP_ID,
    scope: "vehicle",
    repair_order_id: ORDER_ID,
    business_context: "qc",
  });
  assert.equal(qcResponse.status, 200);

  const techEdge = loadEdgeFactory();
  let techFetchCalls = 0;
  techEdge.__clientFactory = clientFactoryFor("technicien");
  const techHandler = techEdge.__mediaDriveFactory({
    environment: environment(),
    fetchFn: async () => { techFetchCalls += 1; throw new Error("unexpected"); },
  });
  const warrantyResponse = await invoke(techHandler, {
    action: "resolve_folder",
    workshop_id: WORKSHOP_ID,
    scope: "warranty",
    claim_id: CLAIM_ID,
    warranty_section: "photos",
  });
  const warrantyBody = await warrantyResponse.json();
  assert.equal(warrantyResponse.status, 403);
  assert.equal(warrantyBody.code, "FORBIDDEN_MEDIA_CONTEXT");
  assert.equal(techFetchCalls, 0);
});

test("warranty folder uses canonical claim data and section whitelist", async () => {
  const edge = loadEdgeFactory();
  edge.__clientFactory = clientFactoryFor("responsable_garantie_support");
  const drive = makeDriveMock();
  const handler = edge.__mediaDriveFactory({
    environment: environment(),
    fetchFn: drive.fetchFn,
  });
  const response = await invoke(handler, {
    action: "resolve_folder",
    workshop_id: WORKSHOP_ID,
    scope: "warranty",
    claim_id: CLAIM_ID,
    warranty_section: "videos",
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(
    drive.folders.filter((folder) => !folder.trashed).map((folder) => folder.name),
    ["WARRANTY", "CLAIM-GAR-001-30000000", "VIDEOS"],
  );
});

test("warranty media rejects a claim that belongs to another repair order", async () => {
  const edge = loadEdgeFactory();
  edge.__clientFactory = clientFactoryFor("responsable_garantie_support", {
    repair_claims: {
      id: CLAIM_ID,
      workshop_id: WORKSHOP_ID,
      local_id: "GAR-001",
      repair_order_id: "99999999-0000-4000-8000-000000000999",
    },
  });
  let fetchCalls = 0;
  const handler = edge.__mediaDriveFactory({
    environment: environment(),
    fetchFn: async () => { fetchCalls += 1; throw new Error("unexpected"); },
  });
  const response = await invoke(handler, {
    action: "begin_upload",
    workshop_id: WORKSHOP_ID,
    scope: "warranty",
    repair_order_id: ORDER_ID,
    claim_id: CLAIM_ID,
    warranty_section: "photos",
    business_context: "warranty",
    local_id: "warranty-media-1",
    filename: "cause.jpg",
    mime_type: "image/jpeg",
    size_bytes: 1024,
  });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "CLAIM_REPAIR_ORDER_MISMATCH");
  assert.equal(fetchCalls, 0);
});

test("begin_upload creates a resumable session only after validating MIME and size", async () => {
  const edge = loadEdgeFactory();
  const auditSink = [];
  edge.__clientFactory = clientFactoryFor("technicien", {}, { auditSink });
  const drive = makeDriveMock();
  const handler = edge.__mediaDriveFactory({
    environment: environment(),
    fetchFn: drive.fetchFn,
  });
  const response = await invoke(handler, {
    action: "begin_upload",
    workshop_id: WORKSHOP_ID,
    scope: "vehicle",
    repair_order_id: ORDER_ID,
    business_context: "repair",
    local_id: "media-local-001",
    checksum_sha256: "a".repeat(64),
    filename: "photo défaut avant.jpg",
    mime_type: "image/jpeg",
    size_bytes: 2500000,
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Pragma"), "no-cache");
  assert.equal(body.upload_method, "PUT");
  assert.match(body.upload_url, /^https:\/\/www\.googleapis\.com\/upload\/drive\//u);
  assert.equal(body.local_id, "media-local-001");
  const uploadCall = drive.calls.find((call) =>
    new URL(call.url).pathname === "/upload/drive/v3/files"
  );
  assert.ok(uploadCall);
  assert.equal(uploadCall.headers["X-Upload-Content-Type"], "image/jpeg");
  assert.equal(uploadCall.headers["X-Upload-Content-Length"], "2500000");
  const metadata = JSON.parse(String(uploadCall.body));
  assert.equal(metadata.parents[0], body.folder_id);
  assert.equal(metadata.appProperties.nimr_local_hash, localHash("media-local-001"));
  assert.equal("nimr_local_id" in metadata.appProperties, false);
  assert.equal(metadata.appProperties.nimr_workshop, WORKSHOP_ID);
  assert.equal(JSON.stringify(body).includes("google-access-token"), false);
  assert.equal(JSON.stringify(body).includes("google-refresh-token"), false);
  assert.equal(auditSink.length, 1);
  assert.equal(auditSink[0].action, "media_drive.begin_upload");
  assert.equal(auditSink[0].workshop_id, WORKSHOP_ID);
  assert.equal(auditSink[0].repair_order_id, ORDER_ID);
  assert.equal(auditSink[0].created_by, USER_ID);
  assert.equal(auditSink[0].sync_source, "media_drive");
  assert.equal(auditSink[0].after_data.status, "attempted");
  assert.equal(JSON.stringify(auditSink[0]).includes("upload_id="), false);
  assert.equal(JSON.stringify(auditSink[0]).includes("google-refresh-token"), false);
});

test("begin_upload reuses a completed managed file with the same local id instead of creating a duplicate", async () => {
  const edge = loadEdgeFactory();
  edge.__clientFactory = clientFactoryFor("technicien");
  const drive = makeDriveMock({
    existingMedia: [{
      id: "file-existing",
      name: "photo défaut avant.jpg",
      mimeType: "image/jpeg",
      size: "2500000",
      parents: ["folder-4"],
      appProperties: {
        nimr_managed: "true",
        nimr_workshop: WORKSHOP_ID,
        nimr_local_hash: localHash("media-local-001"),
        nimr_content_sha256: "a".repeat(64),
        nimr_scope: "vehicle",
        nimr_context: "repair",
      },
      createdTime: "2026-09-29T20:00:00Z",
      modifiedTime: "2026-09-29T20:01:00Z",
      trashed: false,
    }],
  });
  const handler = edge.__mediaDriveFactory({ environment: environment(), fetchFn: drive.fetchFn });
  const response = await invoke(handler, {
    action: "begin_upload",
    workshop_id: WORKSHOP_ID,
    scope: "vehicle",
    repair_order_id: ORDER_ID,
    business_context: "repair",
    local_id: "media-local-001",
    checksum_sha256: "a".repeat(64),
    filename: "photo défaut avant.jpg",
    mime_type: "image/jpeg",
    size_bytes: 2500000,
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.already_uploaded, true);
  assert.equal(body.drive_file_id, "file-existing");
  assert.equal(body.upload_url, undefined);
  assert.equal(drive.calls.some((call) =>
    call.method === "POST" && new URL(call.url).pathname === "/upload/drive/v3/files"
  ), false);
});

test("begin_upload refuses same local id when Drive content metadata differs", async () => {
  const edge = loadEdgeFactory();
  edge.__clientFactory = clientFactoryFor("technicien");
  const drive = makeDriveMock({
    existingMedia: [{
      id: "file-conflict",
      name: "wrong.mp4",
      mimeType: "video/mp4",
      size: "2500000",
      parents: ["folder-4"],
      appProperties: {
        nimr_managed: "true",
        nimr_workshop: WORKSHOP_ID,
        nimr_local_hash: localHash("media-local-001"),
        nimr_content_sha256: "a".repeat(64),
        nimr_scope: "vehicle",
        nimr_context: "repair",
      },
      createdTime: "2026-09-29T20:00:00Z",
      trashed: false,
    }],
  });
  const handler = edge.__mediaDriveFactory({ environment: environment(), fetchFn: drive.fetchFn });
  const response = await invoke(handler, {
    action: "begin_upload",
    workshop_id: WORKSHOP_ID,
    scope: "vehicle",
    repair_order_id: ORDER_ID,
    business_context: "repair",
    local_id: "media-local-001",
    checksum_sha256: "a".repeat(64),
    filename: "photo défaut avant.jpg",
    mime_type: "image/jpeg",
    size_bytes: 2500000,
  });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "MEDIA_IDEMPOTENCY_CONTENT_MISMATCH");
});

test("invalid upload type fails before Drive folder creation", async () => {
  const edge = loadEdgeFactory();
  edge.__clientFactory = clientFactoryFor("technicien");
  const drive = makeDriveMock();
  const handler = edge.__mediaDriveFactory({
    environment: environment(),
    fetchFn: drive.fetchFn,
  });
  const response = await invoke(handler, {
    action: "begin_upload",
    workshop_id: WORKSHOP_ID,
    scope: "vehicle",
    repair_order_id: ORDER_ID,
    business_context: "repair",
    local_id: "media-local-002",
    checksum_sha256: "a".repeat(64),
    filename: "payload.exe",
    mime_type: "application/x-msdownload",
    size_bytes: 1000,
  });
  const body = await response.json();
  assert.equal(response.status, 415);
  assert.equal(body.code, "UNSUPPORTED_MEDIA_TYPE");
  assert.equal(drive.folders.length, 0);
  const driveApiCalls = drive.calls.filter((call) =>
    new URL(call.url).origin === "https://www.googleapis.com"
  );
  assert.equal(driveApiCalls.length, 0);
});

test("audit failure blocks Google before any external request", async () => {
  const edge = loadEdgeFactory();
  let fetchCalls = 0;
  edge.__clientFactory = clientFactoryFor("reception", {}, { auditError: new Error("audit unavailable") });
  const handler = edge.__mediaDriveFactory({
    environment: environment(),
    fetchFn: async () => { fetchCalls += 1; throw new Error("unexpected"); },
  });
  const response = await invoke(handler, {
    action: "resolve_folder",
    workshop_id: WORKSHOP_ID,
    scope: "vehicle",
    repair_order_id: ORDER_ID,
    business_context: "reception",
  });
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.equal(body.code, "MEDIA_DRIVE_AUDIT_FAILED");
  assert.equal(fetchCalls, 0);
});

test("read_metadata permits lecture_seule but returns only sanitized managed metadata", async () => {
  const edge = loadEdgeFactory();
  edge.__clientFactory = clientFactoryFor("lecture_seule");
  const drive = makeDriveMock({
    metadataById: {
      "file-1": {
        id: "file-1",
        name: "preuve.jpg",
        mimeType: "image/jpeg",
        size: "1234",
        parents: ["folder-proof"],
        appProperties: {
          nimr_managed: "true",
          nimr_workshop: WORKSHOP_ID,
          nimr_local_hash: localHash("local-1"),
          nimr_scope: "vehicle",
          nimr_context: "repair",
          secret_note: "must-not-return",
        },
        md5Checksum: "md5",
        sha256Checksum: "sha256",
        createdTime: "2026-09-29T20:00:00Z",
        modifiedTime: "2026-09-29T20:01:00Z",
        trashed: false,
        webContentLink: "hidden",
      },
    },
  });
  const handler = edge.__mediaDriveFactory({
    environment: environment(),
    fetchFn: drive.fetchFn,
  });
  const response = await invoke(handler, {
    action: "read_metadata",
    workshop_id: WORKSHOP_ID,
    drive_file_id: "file-1",
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.file.id, "file-1");
  assert.equal(body.file.size_bytes, 1234);
  assert.equal(body.file.sha256_checksum, "sha256");
  assert.equal(JSON.stringify(body).includes("must-not-return"), false);
  assert.equal(JSON.stringify(body).includes("webContentLink"), false);
});

test("finalize_upload requires local_id before audit or Google access", async () => {
  const edge = loadEdgeFactory();
  let fetchCalls = 0;
  const auditSink = [];
  edge.__clientFactory = clientFactoryFor("reception", {}, { auditSink });
  const handler = edge.__mediaDriveFactory({
    environment: environment(),
    fetchFn: async () => { fetchCalls += 1; throw new Error("unexpected"); },
  });
  const response = await invoke(handler, {
    action: "finalize_upload",
    workshop_id: WORKSHOP_ID,
    scope: "vehicle",
    repair_order_id: ORDER_ID,
    business_context: "reception",
    drive_file_id: "file-no-local",
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.code, "LOCAL_ID_REQUIRED");
  assert.equal(auditSink.length, 0);
  assert.equal(fetchCalls, 0);
});

test("finalize_upload accepts only the managed file resolved into the canonical parent", async () => {
  const edge = loadEdgeFactory();
  edge.__clientFactory = clientFactoryFor("reception");
  const drive = makeDriveMock({
    metadataById: {
      "file-ok": {
        id: "file-ok",
        name: "preuve.jpg",
        mimeType: "image/jpeg",
        size: "2048",
        parents: ["folder-4"],
        appProperties: {
          nimr_managed: "true",
          nimr_workshop: WORKSHOP_ID,
          nimr_local_hash: localHash("media-local-ok"),
        nimr_content_sha256: "a".repeat(64),
          nimr_scope: "vehicle",
          nimr_context: "reception",
        },
        sha256Checksum: "sha256-ok",
        trashed: false,
      },
    },
  });
  const handler = edge.__mediaDriveFactory({
    environment: environment(),
    fetchFn: drive.fetchFn,
  });
  const response = await invoke(handler, {
    action: "finalize_upload",
    workshop_id: WORKSHOP_ID,
    scope: "vehicle",
    repair_order_id: ORDER_ID,
    business_context: "reception",
    local_id: "media-local-ok",
    checksum_sha256: "a".repeat(64),
    drive_file_id: "file-ok",
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.file.id, "file-ok");
  assert.equal(body.file.parent_id, "folder-4");
  assert.equal(body.file.sha256_checksum, "sha256-ok");
  assert.equal(JSON.stringify(body).includes("nimr_workshop"), false);
});

test("finalize_upload collapses concurrent duplicate files to the oldest canonical media", async () => {
  const edge = loadEdgeFactory();
  edge.__clientFactory = clientFactoryFor("reception");
  const commonProps = {
    nimr_managed: "true",
    nimr_workshop: WORKSHOP_ID,
    nimr_local_hash: localHash("media-race"),
        nimr_content_sha256: "a".repeat(64),
    nimr_scope: "vehicle",
    nimr_context: "reception",
  };
  const oldFile = {
    id: "file-old",
    name: "preuve.jpg",
    mimeType: "image/jpeg",
    size: "2048",
    parents: ["folder-4"],
    appProperties: commonProps,
    createdTime: "2026-09-29T20:00:00Z",
    trashed: false,
  };
  const newFile = {
    ...oldFile,
    id: "file-new",
    createdTime: "2026-09-29T20:00:01Z",
  };
  const drive = makeDriveMock({
    metadataById: { "file-new": newFile },
    existingMedia: [newFile, oldFile],
  });
  const handler = edge.__mediaDriveFactory({
    environment: environment(),
    fetchFn: drive.fetchFn,
  });
  const response = await invoke(handler, {
    action: "finalize_upload",
    workshop_id: WORKSHOP_ID,
    scope: "vehicle",
    repair_order_id: ORDER_ID,
    business_context: "reception",
    local_id: "media-race",
    checksum_sha256: "a".repeat(64),
    drive_file_id: "file-new",
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.file.id, "file-old");
  assert.ok(drive.calls.some((call) =>
    call.method === "PATCH" && new URL(call.url).pathname.endsWith("/file-new")
  ));
  assert.equal(drive.calls.some((call) =>
    call.method === "PATCH" && new URL(call.url).pathname.endsWith("/file-old")
  ), false);
});

test("finalize_upload fails closed when the file belongs to another workshop", async () => {
  const edge = loadEdgeFactory();
  edge.__clientFactory = clientFactoryFor("reception");
  const drive = makeDriveMock({
    metadataById: {
      "file-wrong-workshop": {
        id: "file-wrong-workshop",
        name: "preuve.jpg",
        mimeType: "image/jpeg",
        size: "100",
        parents: ["folder-4"],
        appProperties: {
          nimr_managed: "true",
          nimr_workshop: "99999999-9999-4999-8999-999999999999",
          nimr_local_hash: localHash("media-local-003"),
        nimr_content_sha256: "a".repeat(64),
        },
        trashed: false,
      },
    },
  });
  const handler = edge.__mediaDriveFactory({
    environment: environment(),
    fetchFn: drive.fetchFn,
  });
  const response = await invoke(handler, {
    action: "finalize_upload",
    workshop_id: WORKSHOP_ID,
    scope: "vehicle",
    repair_order_id: ORDER_ID,
    business_context: "reception",
    local_id: "media-local-003",
    checksum_sha256: "a".repeat(64),
    drive_file_id: "file-wrong-workshop",
  });
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.code, "MEDIA_FILE_SCOPE_MISMATCH");
});

test("missing configured root fails before OAuth refresh", async () => {
  const edge = loadEdgeFactory();
  edge.__clientFactory = clientFactoryFor("reception");
  let fetchCalls = 0;
  const handler = edge.__mediaDriveFactory({
    environment: environment({ GOOGLE_DRIVE_ROOT_FOLDER_ID: "" }),
    fetchFn: async () => { fetchCalls += 1; throw new Error("unexpected"); },
  });
  const response = await invoke(handler, {
    action: "resolve_folder",
    workshop_id: WORKSHOP_ID,
    scope: "vehicle",
    repair_order_id: ORDER_ID,
    business_context: "reception",
  });
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, "GOOGLE_DRIVE_ROOT_NOT_CONFIGURED");
  assert.equal(fetchCalls, 0);
});

test("OAuth refresh failure is sanitized and never returns server credentials", async () => {
  const edge = loadEdgeFactory();
  edge.__clientFactory = clientFactoryFor("admin_technique");
  const handler = edge.__mediaDriveFactory({
    environment: environment({ GOOGLE_DRIVE_ROOT_FOLDER_ID: "" }),
    fetchFn: async (url) => {
      if (url === "https://oauth2.googleapis.com/token") {
        return jsonResponse({
          error: "invalid_grant",
          client_secret: "google-client-secret",
          refresh_token: "google-refresh-token",
        }, 400);
      }
      throw new Error("unexpected");
    },
  });
  const response = await invoke(handler, {
    action: "bootstrap_root",
    workshop_id: WORKSHOP_ID,
  });
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.code, "GOOGLE_OAUTH_REFRESH_FAILED");
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes("google-client-secret"), false);
  assert.equal(serialized.includes("google-refresh-token"), false);
});

test("source has no console token logging and never consumes a free-form Drive path", () => {
  const source = read("supabase/functions/media-drive/index.ts");
  assert.doesNotMatch(source, /console\.(?:log|debug|info|warn|error)\s*\(/u);
  assert.doesNotMatch(source, /payload\.(?:path|folder_path|drive_path)/u);
  assert.match(source, /GOOGLE_DRIVE_SCOPE\s*=\s*"https:\/\/www\.googleapis\.com\/auth\/drive\.file"/u);
  assert.match(source, /nimr_local_hash/u);
  assert.doesNotMatch(source, /appProperties[\s\S]{0,300}nimr_local_id/u);
  assert.match(source, /appProperties/u);
});

test("KHA-50 blocks public Drive permissions before returning managed metadata", async () => {
  const edge = loadEdgeFactory();
  edge.__clientFactory = clientFactoryFor("lecture_seule");
  const drive = makeDriveMock({
    metadataById: { "public-1": { id: "public-1", name: "preuve.jpg", mimeType: "image/jpeg", size: "10", parents: ["p"], appProperties: { nimr_managed: "true", nimr_workshop: WORKSHOP_ID, nimr_scope: "vehicle", nimr_context: "repair" }, trashed: false } },
    permissionsById: { "public-1": [{ id: "any", type: "anyone", role: "reader" }] },
  });
  const handler = edge.__mediaDriveFactory({ environment: environment(), fetchFn: drive.fetchFn });
  const response = await invoke(handler, { action: "read_metadata", workshop_id: WORKSHOP_ID, drive_file_id: "public-1" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "MEDIA_PUBLIC_PERMISSION_DETECTED");
});

test("KHA-50 read_content streams only authorized private managed media with no-store headers", async () => {
  const edge = loadEdgeFactory();
  const auditSink = [];
  edge.__clientFactory = clientFactoryFor("lecture_seule", {}, { auditSink });
  const file = { id: "private-1", name: "preuve.jpg", mimeType: "image/jpeg", size: "12", parents: ["p"], appProperties: { nimr_managed: "true", nimr_workshop: WORKSHOP_ID, nimr_scope: "vehicle", nimr_context: "repair" }, trashed: false };
  const drive = makeDriveMock({ metadataById: { "private-1": file }, contentById: { "private-1": "hello-media" } });
  const handler = edge.__mediaDriveFactory({ environment: environment(), fetchFn: drive.fetchFn });
  const response = await invoke(handler, { action: "read_content", workshop_id: WORKSHOP_ID, drive_file_id: "private-1" });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "hello-media");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(auditSink[0].action, "media_drive.read_content");
});

test("KHA-50 QC and Warranty proofs cannot be read by lecture_seule", async () => {
  for (const [id, scope, context] of [["qc-1", "vehicle", "qc"], ["war-1", "warranty", "warranty"]]) {
    const edge = loadEdgeFactory(); edge.__clientFactory = clientFactoryFor("lecture_seule");
    const drive = makeDriveMock({ metadataById: { [id]: { id, name: "proof.jpg", mimeType: "image/jpeg", size: "10", parents: ["p"], appProperties: { nimr_managed: "true", nimr_workshop: WORKSHOP_ID, nimr_scope: scope, nimr_context: context }, trashed: false } } });
    const handler = edge.__mediaDriveFactory({ environment: environment(), fetchFn: drive.fetchFn });
    const response = await invoke(handler, { action: "read_metadata", workshop_id: WORKSHOP_ID, drive_file_id: id });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "FORBIDDEN_MEDIA_CONTEXT");
  }
});

test("KHA-50 delete_media is controlled and QC deletion is director/admin only", async () => {
  const file = { id: "qc-del", name: "qc.jpg", mimeType: "image/jpeg", size: "10", parents: ["p"], appProperties: { nimr_managed: "true", nimr_workshop: WORKSHOP_ID, nimr_scope: "vehicle", nimr_context: "qc" }, trashed: false };
  {
    const edge = loadEdgeFactory(); edge.__clientFactory = clientFactoryFor("chef_atelier");
    const drive = makeDriveMock({ metadataById: { "qc-del": file } });
    const handler = edge.__mediaDriveFactory({ environment: environment(), fetchFn: drive.fetchFn });
    const response = await invoke(handler, { action: "delete_media", workshop_id: WORKSHOP_ID, drive_file_id: "qc-del" });
    assert.equal(response.status, 403);
  }
  {
    const edge = loadEdgeFactory(); const auditSink = []; edge.__clientFactory = clientFactoryFor("directeur", {}, { auditSink });
    const drive = makeDriveMock({ metadataById: { "qc-del": file } });
    const handler = edge.__mediaDriveFactory({ environment: environment(), fetchFn: drive.fetchFn });
    const response = await invoke(handler, { action: "delete_media", workshop_id: WORKSHOP_ID, drive_file_id: "qc-del" });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).deleted, true);
    assert.equal(auditSink[0].action, "media_drive.delete_media");
    assert.ok(drive.calls.some((call) => call.method === "PATCH" && String(call.body).includes('"trashed":true')));
  }
});
