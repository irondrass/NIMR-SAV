import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function loadMediaUpload(overrides = {}) {
  const window = overrides.window || {};
  const context = {
    console,
    Date,
    Set,
    String,
    Number,
    Object,
    Error,
    Promise,
    ...overrides,
    window,
    globalThis: null,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read("js/media-upload.js"), context, { filename: "media-upload.js" });
  return { api: window.__mediaUploadTest, window, context };
}

function migrationSource() {
  const files = fs.readdirSync(path.join(ROOT, "supabase", "migrations"))
    .filter((name) => name.includes("media_upload_001"))
    .sort();
  assert.deepEqual(files, [
    "20260929220514_media_upload_001_additive_model.sql",
    "20260929220555_media_upload_001_fk_indexes.sql",
  ]);
  return files.map((file) => read(path.join("supabase", "migrations", file))).join("\n");
}

test("KHA-48 migration is additive and defines canonical media lifecycle", () => {
  const sql = migrationSource();
  for (const column of [
    "vehicle_id", "claim_id", "repair_step_id", "source_task_id",
    "media_type", "business_context", "evidence_kind",
    "drive_file_id", "drive_folder_id", "checksum_sha256", "caption",
    "upload_status", "uploaded_by", "uploaded_at",
    "last_upload_error", "upload_attempts",
  ]) {
    assert.match(sql, new RegExp(`add column if not exists ${column}\\b`, "u"));
  }
  assert.match(sql, /upload_status in \('pending','uploading','uploaded','failed'\)/u);
  assert.match(sql, /photos_drive_file_unique/u);
  assert.match(sql, /photos_vehicle_fk_idx/u);
  assert.match(sql, /photos_claim_fk_idx/u);
  assert.match(sql, /photos_repair_step_fk_idx/u);
  assert.match(sql, /upload_status <> 'uploaded'.*drive_file_id/su);
  assert.doesNotMatch(sql, /drop\s+(?:table|column)\b/iu);
});

test("media metadata normalization preserves explicit business dimensions", () => {
  const { api } = loadMediaUpload();
  const meta = api.normalizeMediaUploadMeta({
    mediaType: "video",
    businessContext: "QC",
    evidenceKind: "VIN",
    uploadStatus: "failed",
    uploadAttempts: 3,
  });
  assert.equal(meta.mediaType, "video");
  assert.equal(meta.businessContext, "qc");
  assert.equal(meta.evidenceKind, "vin");
  assert.equal(meta.uploadStatus, "failed");
  assert.equal(meta.uploadAttempts, 3);
});

test("database row stays local-backup until Drive is authoritative", () => {
  const { api } = loadMediaUpload();
  const row = api.buildMediaDatabaseRow({
    workshopId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    item: { id: "case-1" },
    repairOrder: {
      id: "33333333-3333-4333-8333-333333333333",
      vehicle_id: "44444444-4444-4444-8444-444444444444",
    },
    media: {
      id: "media-1",
      name: "preuve.jpg",
      type: "image/jpeg",
      size: 1200,
      category: "before",
      businessContext: "reception",
      evidenceKind: "general",
      uploadStatus: "pending",
    },
  });
  assert.equal(row.storage_bucket, "local-backup");
  assert.match(row.storage_path, /^local\//u);
  assert.equal(row.drive_file_id, null);
  assert.equal(row.upload_status, "pending");
  assert.equal(row.media_type, "photo");
});

test("uploaded row switches authority to Google Drive", () => {
  const { api } = loadMediaUpload();
  const row = api.buildMediaDatabaseRow({
    workshopId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    item: { id: "case-1" },
    repairOrder: {
      id: "33333333-3333-4333-8333-333333333333",
      vehicle_id: null,
    },
    status: "uploaded",
    media: {
      id: "media-2",
      name: "preuve.mp4",
      type: "video/mp4",
      size: 5000,
      category: "during",
      mediaType: "video",
      businessContext: "repair",
      evidenceKind: "general",
      driveFileId: "drive-file-1",
      driveFolderId: "folder-1",
      uploadStatus: "uploaded",
      uploadedAt: "2026-09-29T20:00:00Z",
    },
  });
  assert.equal(row.storage_bucket, "google-drive");
  assert.equal(row.storage_path, "drive:drive-file-1");
  assert.equal(row.drive_file_id, "drive-file-1");
  assert.equal(row.media_type, "video");
  assert.equal(row.upload_status, "uploaded");
});

test("browser surface supports video, retry, and direct Google upload CSP", () => {
  const index = read("index.html");
  const ui = read("js/ui-cases.js");
  const photos = read("js/photos.js");
  const sw = read("sw.js");
  assert.match(index, /video\/mp4/u);
  assert.match(index, /https:\/\/www\.googleapis\.com/u);
  assert.match(index, /media-src 'self' blob:/u);
  assert.match(index, /js\/media-upload\.js/u);
  assert.match(sw, /js\/media-upload\.js/u);
  assert.match(ui, /data-photo-video/u);
  assert.match(ui, /data-retry-media/u);
  assert.match(photos, /prepareMediaForStorage/u);
  assert.match(photos, /ALLOWED_MEDIA_TYPES/u);
});

test("frontend finalizes an already-uploaded Drive file without issuing another PUT", async () => {
  const invokeCalls = [];
  const upserts = [];
  let fetchCalls = 0;
  const workshopId = "11111111-1111-4111-8111-111111111111";
  const userId = "22222222-2222-4222-8222-222222222222";
  const repairOrder = {
    id: "33333333-3333-4333-8333-333333333333",
    vehicle_id: "44444444-4444-4444-8444-444444444444",
    local_id: "case-or:or-1",
  };

  const makeSelectChain = (row) => {
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      is() { return chain; },
      async maybeSingle() { return { data: row, error: null }; },
    };
    return chain;
  };
  const client = {
    functions: {
      async invoke(_name, { body }) {
        invokeCalls.push(body);
        if (body.action === "begin_upload") {
          return {
            data: {
              ok: true,
              action: "begin_upload",
              already_uploaded: true,
              drive_file_id: "file-existing",
              folder_id: "folder-4",
            },
            error: null,
          };
        }
        if (body.action === "finalize_upload") {
          return {
            data: { ok: true, file: { id: "file-existing", parent_id: "folder-4" } },
            error: null,
          };
        }
        return { data: { ok: true }, error: null };
      },
    },
    from(table) {
      if (table === "repair_orders") return makeSelectChain(repairOrder);
      if (table === "photos") {
        const chain = makeSelectChain(null);
        chain.upsert = (row) => {
          upserts.push(row);
          return {
            select() {
              return {
                async single() {
                  return {
                    data: {
                      id: "55555555-5555-4555-8555-555555555555",
                      local_id: row.local_id,
                      upload_status: row.upload_status,
                      drive_file_id: row.drive_file_id,
                    },
                    error: null,
                  };
                },
              };
            },
          };
        };
        return chain;
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };

  const { window } = loadMediaUpload({
    navigator: { onLine: true },
    fetch: async () => { fetchCalls += 1; throw new Error("unexpected PUT"); },
    getSupabaseClient: () => client,
    getSupabaseUser: async () => ({ id: userId }),
    getSupabaseWorkshopId: () => workshopId,
    resolveSupabaseWorkshopMembership: async () => ({
      ok: true,
      membership: { user_id: userId, workshop_id: workshopId },
    }),
    caseSyncLocalId: () => "case-or:or-1",
    getPhotoRecord: async () => ({ blob: { size: 2500 } }),
    savePhotoRecord: async () => true,
    saveState: () => Promise.resolve(true),
    renderCaseDetail: () => {},
  });
  const item = { id: "case-1" };
  const media = {
    id: "media-existing",
    name: "preuve.jpg",
    type: "image/jpeg",
    size: 2500,
    category: "during",
    businessContext: "repair",
    evidenceKind: "general",
    uploadStatus: "pending",
    checksumSha256: "a".repeat(64),
  };

  const result = await window.retryMediaUpload(item, media);
  assert.equal(result.ok, true);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(invokeCalls.map((call) => call.action), ["begin_upload", "finalize_upload"]);
  assert.equal(media.driveFileId, "file-existing");
  assert.equal(media.uploadStatus, "uploaded");
  assert.ok(upserts.some((row) => row.upload_status === "uploaded" && row.drive_file_id === "file-existing"));
});

test("anti-duplicate and partial-success resume are explicit", () => {
  const source = read("js/media-upload.js");
  const edge = read("supabase/functions/media-drive/index.ts");
  const ui = read("js/ui-cases.js");
  assert.match(source, /loadExistingMediaRow/u);
  assert.match(source, /deduplicated:\s*true/u);
  assert.match(source, /if \(media\.driveFileId\)/u);
  assert.match(source, /begin\.already_uploaded/u);
  assert.match(source, /action:\s*"finalize_upload"/u);
  assert.match(source, /RETRYABLE_UPLOAD_ERROR/u);
  assert.match(edge, /listManagedMediaByLocalHash/u);
  assert.match(edge, /MEDIA_IDEMPOTENCY_CONTENT_MISMATCH/u);
  assert.match(ui, /suppression locale est bloquée/u);
});

test("browser source contains no Google OAuth secrets", () => {
  const browser = [
    read("index.html"),
    read("js/media-upload.js"),
    read("js/photos.js"),
    read("js/ui-cases.js"),
    read("js/supabase-sync.js"),
  ].join("\n");
  assert.doesNotMatch(browser, /GOOGLE_DRIVE_(?:CLIENT_SECRET|REFRESH_TOKEN)/u);
  assert.doesNotMatch(browser, /client_secret\s*[:=]/iu);
  assert.doesNotMatch(browser, /refresh_token\s*[:=]/iu);
});
