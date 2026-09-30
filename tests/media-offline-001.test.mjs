import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const media = fs.readFileSync(new URL("../js/media-upload.js", import.meta.url), "utf8");
const storage = fs.readFileSync(new URL("../js/storage.js", import.meta.url), "utf8");
const sync = fs.readFileSync(new URL("../js/supabase-sync.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("KHA-49 uses the durable outbox without storing media blobs in queue payloads", () => {
  assert.match(media, /MEDIA_OFFLINE_ENTITY_TYPE = "media_upload"/);
  assert.match(media, /enqueueDurableOutboxOperation/);
  assert.match(media, /payload: \{ caseId: String\(item\.id\), mediaId: String\(media\.id\) \}/);
  assert.doesNotMatch(media, /payload:\s*\{[^}]*blob/s);
  assert.match(storage, /nextAttemptAt: input\.nextAttemptAt \|\| null/);
  assert.match(storage, /processingStartedAt: input\.processingStartedAt \|\| null/);
});

test("KHA-49 isolates media uploads from the generic CAS sync worker", () => {
  assert.match(sync, /entry\.entityType !== "media_upload"/);
  assert.match(media, /processMediaOfflineOperation/);
  assert.match(media, /retryMediaUpload\(item, media\)/);
  assert.match(media, /acknowledgeDurableOutboxOperation\(operation\.operationId\)/);
});

test("KHA-49 recovery is foreground deterministic and bounded", () => {
  assert.match(media, /MEDIA_OFFLINE_MAX_RETRIES = 10/);
  assert.match(media, /MEDIA_OFFLINE_PROCESSING_LEASE_MS = 2 \* 60 \* 1000/);
  assert.match(media, /mediaOfflineBackoffMs/);
  assert.match(media, /window\.addEventListener\("online"/);
  assert.match(media, /window\.addEventListener\("focus"/);
  assert.match(media, /window\.addEventListener\("pageshow"/);
  assert.match(media, /document\.addEventListener\("visibilitychange"/);
  assert.match(app, /bindMediaOfflineRecovery/);
});

test("KHA-49 preserves immediate local-first UX", () => {
  assert.match(media, /navigator\.onLine === false/);
  assert.match(media, /OFFLINE_QUEUED/);
  assert.match(media, /media\.uploadStatus = "pending"/);
  assert.match(media, /scheduleMediaOfflineDrain\(0\)/);
});
