import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const testDirectory = path.dirname(
  fileURLToPath(import.meta.url),
);
const repositoryRoot = path.resolve(
  testDirectory,
  "..",
);
const require = createRequire(import.meta.url);

const runtimePath = path.join(
  repositoryRoot,
  "js",
  "sync-v2-shadow-readonly.js",
);
const shadowPath = path.join(
  repositoryRoot,
  "js",
  "sync-v2-shadow.js",
);
const corePath = path.join(
  repositoryRoot,
  "js",
  "sync-v2-core.js",
);
const indexPath = path.join(
  repositoryRoot,
  "index.html",
);
const appPath = path.join(
  repositoryRoot,
  "app.js",
);
const serviceWorkerPath = path.join(
  repositoryRoot,
  "sw.js",
);
const vehiclesPath = path.join(
  repositoryRoot,
  "data",
  "vehicles.json",
);

assert.equal(
  fs.existsSync(runtimePath),
  true,
  "Le runtime C2 lecture seule doit exister.",
);

const source = fs.readFileSync(
  runtimePath,
  "utf8",
);
const indexSource = fs.readFileSync(
  indexPath,
  "utf8",
);
const appSource = fs.readFileSync(
  appPath,
  "utf8",
);
const serviceWorkerSource = fs.readFileSync(
  serviceWorkerPath,
  "utf8",
);

for (const forbidden of [
  /\.insert\s*\(/u,
  /\.upsert\s*\(/u,
  /\.update\s*\(/u,
  /\.delete\s*\(/u,
  /\.remove\s*\(/u,
  /\.rpc\s*\(/u,
  /\benqueueDurableOutboxOperation\b/u,
  /\bputDurableOutboxOperation\b/u,
  /\bprocessOfflineQueue\b/u,
  /\bpullLatestSupabaseBackup\b/u,
  /\bautoBackupToSupabase\b/u,
  /\bcloud_backups\b/u,
  /\bsync_operations\b/u,
  /\bsync_conflicts\b/u,
  /\baudit_logs\b/u,
]) {
  assert.doesNotMatch(
    source,
    forbidden,
    `Le runtime C2 contient une écriture ou un flux interdit : ${forbidden}`,
  );
}

assert.match(
  source,
  /nimr-sav-sync-v2-shadow-readonly-enabled:v1/u,
  "Le feature flag C2 est manquant.",
);
assert.match(
  source,
  /\.from\("repair_orders"\)[\s\S]*?\.select\(/u,
  "C2 doit utiliser un SELECT ciblé sur repair_orders.",
);
assert.match(
  source,
  /\.eq\("workshop_id",\s*workshopId\)/u,
  "Le SELECT C2 doit être isolé par workshop_id.",
);
assert.match(
  source,
  /\.eq\(column,\s*value\)/u,
  "Le SELECT C2 doit être ciblé par identifiant dossier.",
);
assert.match(
  source,
  /serverWrites:\s*0/u,
);
assert.match(
  source,
  /rpcCalls:\s*0/u,
);
assert.match(
  source,
  /legacyOutboxWrites:\s*0/u,
);
assert.match(
  source,
  /globalPulls:\s*0/u,
);
assert.match(
  source,
  /writeAttempted:\s*false/u,
);
assert.match(
  source,
  /globalPullAttempted:\s*false/u,
);

const coreIndex = indexSource.indexOf(
  'src="js/sync-v2-core.js?v=23.3.0"',
);
const shadowIndex = indexSource.indexOf(
  'src="js/sync-v2-shadow.js?v=23.3.0"',
);
const clientIndex = indexSource.indexOf(
  'src="js/supabase-client.js?v=23.3.0"',
);
const readonlyIndex = indexSource.indexOf(
  'src="js/sync-v2-shadow-readonly.js?v=23.3.0"',
);
const syncIndex = indexSource.indexOf(
  'src="js/supabase-sync.js?v=23.3.0"',
);
const appIndex = indexSource.indexOf(
  'src="app.js?v=23.3.0"',
);

assert.ok(coreIndex >= 0);
assert.ok(shadowIndex > coreIndex);
assert.ok(clientIndex > shadowIndex);
assert.ok(readonlyIndex > clientIndex);
assert.ok(syncIndex > readonlyIndex);
assert.ok(appIndex > syncIndex);

assert.equal(
  serviceWorkerSource.includes(
    './js/sync-v2-shadow-readonly.js?v=23.3.0',
  ),
  true,
  "Le service worker doit précacher C2.",
);

assert.match(
  appSource,
  /typeof\s+initSyncV2ShadowReadonlyMode\s*===\s*"function"[\s\S]*?await\s+initSyncV2ShadowReadonlyMode\s*\(\s*\(\s*\)\s*=>\s*state\s*\)/u,
  "app.js doit fournir le binding state courant à C2.",
);

assert.deepEqual(
  JSON.parse(
    fs.readFileSync(vehiclesPath, "utf8"),
  ),
  [],
  "data/vehicles.json doit rester exactement [].",
);

const storage = new Map();
globalThis.localStorage = {
  getItem(key) {
    return storage.has(key)
      ? storage.get(key)
      : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  },
};
globalThis.setInterval = () => 101;
globalThis.clearInterval = () => {};
globalThis.setTimeout = () => 202;
globalThis.clearTimeout = () => {};

require(corePath);
const shadow = require(shadowPath);

globalThis.caseSyncLocalId = (item) =>
  item.localId || item.local_id || item.id;
globalThis.buildRepairStatus = (item) =>
  item.shadowStatus || "new";
globalThis.getSupabaseWorkshopId = () =>
  "00000000-0000-0000-0000-000000000001";
globalThis.getSupabaseUser = async () => ({
  id: "00000000-0000-4000-8000-000000000002",
});

const serverRow = {
  id: "00000000-0000-4000-8000-000000000010",
  workshop_id:
    "00000000-0000-0000-0000-000000000001",
  local_id: "case-or:or-srv-c2",
  estimate_number: "DEV-C2",
  next_action: "Planning",
  status: "received",
  header_version: 2,
  status_version: 4,
  header_updated_at: "2026-07-12T22:00:00.000Z",
  header_updated_by:
    "00000000-0000-4000-8000-000000000002",
  status_updated_at: "2026-07-12T22:00:00.000Z",
  status_updated_by:
    "00000000-0000-4000-8000-000000000002",
  updated_at: "2026-07-12T22:00:00.000Z",
};

const calls = [];
let currentServerRow = { ...serverRow };

function makeReadonlyQuery() {
  return {
    select(columns) {
      calls.push({ type: "select", columns });
      return this;
    },
    eq(column, value) {
      calls.push({ type: "eq", column, value });
      return this;
    },
    async maybeSingle() {
      calls.push({ type: "maybeSingle" });
      return {
        data: currentServerRow
          ? { ...currentServerRow }
          : null,
        error: null,
      };
    },
  };
}

globalThis.getSupabaseClient = () => ({
  from(table) {
    calls.push({ type: "from", table });
    return makeReadonlyQuery();
  },
});

const readonly = require(runtimePath);

assert.equal(
  readonly.isSyncV2ShadowReadonlyEnabled(),
  false,
  "C2 doit être désactivé par défaut.",
);

const runtimeState = {
  currentUserId: "local-user",
  cases: [],
};
await readonly.initSyncV2ShadowReadonlyMode(
  () => runtimeState,
);
assert.equal(
  calls.length,
  0,
  "Le démarrage avec flag OFF ne doit effectuer aucun SELECT.",
);

const localCase = {
  id: "local-case-c2",
  localId: "case-or:or-srv-c2",
  estimateNumber: "DEV-C2",
  nextAction: "Planning",
  shadowStatus: "received",
  headerVersion: 2,
  statusVersion: 4,
};
runtimeState.cases.push(localCase);

readonly.setSyncV2ShadowReadonlyEnabled(true);
const matching = await (
  readonly.compareSyncV2ShadowCaseWithServer(
    localCase,
    { reason: "contract-match" },
  )
);

assert.equal(matching.outcome, "match");
assert.equal(
  matching.comparison.code,
  "values_and_versions_match",
);
assert.equal(
  matching.readOnlySelectAttempted,
  true,
);
assert.equal(matching.writeAttempted, false);
assert.equal(matching.rpcAttempted, false);
assert.equal(matching.outboxAttempted, false);
assert.equal(matching.globalPullAttempted, false);

assert.equal(
  calls.some(
    (entry) => (
      entry.type === "from"
      && entry.table === "repair_orders"
    ),
  ),
  true,
);
assert.equal(
  calls.some(
    (entry) => (
      entry.type === "eq"
      && entry.column === "workshop_id"
    ),
  ),
  true,
);
assert.equal(
  calls.some(
    (entry) => (
      entry.type === "eq"
      && entry.column === "local_id"
      && entry.value === "case-or:or-srv-c2"
    ),
  ),
  true,
);
assert.equal(
  calls.some(
    (entry) => ![
      "from",
      "select",
      "eq",
      "maybeSingle",
    ].includes(entry.type),
  ),
  false,
  "Le client mock ne doit recevoir aucune opération d'écriture.",
);

currentServerRow = {
  ...serverRow,
  next_action: "Server value",
};
const drift = await (
  readonly.compareSyncV2ShadowCaseWithServer(
    localCase,
    { reason: "contract-drift" },
  )
);

assert.equal(drift.outcome, "drift");
assert.equal(
  drift.comparison.code,
  "same_version_mismatch",
);
assert.deepEqual(
  drift.comparison.domains.header.changedFields,
  ["next_action"],
);

currentServerRow = null;
const missing = await (
  readonly.compareSyncV2ShadowCaseWithServer(
    localCase,
    { reason: "contract-missing" },
  )
);
assert.equal(missing.outcome, "missing");
assert.equal(
  missing.comparison.code,
  "server_row_missing",
);

const status =
  globalThis.NIMR_SYNC_V2_SHADOW_READONLY_STATUS;
assert.equal(status.serverWrites, 0);
assert.equal(status.rpcCalls, 0);
assert.equal(status.legacyOutboxWrites, 0);
assert.equal(status.globalPulls, 0);
assert.equal(status.matches, 1);
assert.equal(status.drifts, 1);
assert.equal(status.missing, 1);

const journal =
  await shadow.loadSyncV2ShadowObservations(20);
assert.equal(
  journal.filter(
    (entry) => entry.kind === "server_comparison",
  ).length >= 3,
  true,
);

readonly.setSyncV2ShadowReadonlyEnabled(false);
const callsBeforeDisabledAttempt = calls.length;
await assert.rejects(
  readonly.fetchSyncV2ShadowReadonlyServerRow(
    "case-or:or-srv-c2",
  ),
  (error) => (
    error?.syncV2ReadonlyCode
    === "readonly_feature_flag_disabled"
  ),
);
assert.equal(
  calls.length,
  callsBeforeDisabledAttempt,
  "Flag OFF : aucune requête ne doit partir.",
);

console.log(
  "SYNC V2 SHADOW READONLY CONTRACT V23.4.0 C2 OK",
);
