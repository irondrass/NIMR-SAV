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
  fs.existsSync(shadowPath),
  true,
  "Le runtime shadow C1 doit exister.",
);

const source = fs.readFileSync(
  shadowPath,
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
  /\bnimr_apply_repair_order_patch_v2\b/u,
  /\benqueueDurableOutboxOperation\b/u,
  /\bputDurableOutboxOperation\b/u,
  /\bprocessOfflineQueue\b/u,
  /\bpullLatestSupabaseBackup\b/u,
  /\bautoBackupToSupabase\b/u,
  /\bcloud_backups\b/u,
  /\.rpc\s*\(/u,
  /\.from\s*\(/u,
  /\bfetch\s*\(/u,
]) {
  assert.doesNotMatch(
    source,
    forbidden,
    `Le runtime shadow ne doit contenir aucun transport : ${forbidden}`,
  );
}

assert.match(
  source,
  /nimr-sav-sync-v2-shadow-enabled:v1/u,
  "Le feature flag shadow est manquant.",
);
assert.match(
  source,
  /const\s+SYNC_V2_SHADOW_DB_NAME\s*=\s*"nimr-sav-sync-v2-shadow"/u,
  "La base IndexedDB shadow séparée est manquante.",
);
assert.match(
  source,
  /transportAttempted:\s*false/u,
  "Chaque observation doit déclarer l'absence de transport.",
);
assert.match(
  source,
  /supabaseWrites:\s*0/u,
  "Le statut shadow doit certifier zéro écriture Supabase.",
);
assert.match(
  source,
  /legacyOutboxWrites:\s*0/u,
  "Le statut shadow doit certifier zéro écriture outbox legacy.",
);

const coreIndex = indexSource.indexOf(
  'src="js/sync-v2-core.js?v=23.3.0"',
);
const shadowIndex = indexSource.indexOf(
  'src="js/sync-v2-shadow.js?v=23.3.0"',
);
const supabaseIndex = indexSource.indexOf(
  'src="js/supabase-sync.js?v=23.3.0"',
);
const appIndex = indexSource.indexOf(
  'src="app.js?v=23.3.0"',
);

assert.ok(
  coreIndex >= 0,
  "sync-v2-core.js doit être chargé par index.html.",
);
assert.ok(
  shadowIndex > coreIndex,
  "Le shadow runtime doit être chargé après le core.",
);
assert.ok(
  supabaseIndex > shadowIndex,
  "Le shadow runtime doit être chargé avant le moteur Supabase.",
);
assert.ok(
  appIndex > supabaseIndex,
  "app.js doit rester chargé en dernier.",
);

for (const runtimeAsset of [
  './js/sync-v2-core.js?v=23.3.0',
  './js/sync-v2-shadow.js?v=23.3.0',
]) {
  assert.equal(
    serviceWorkerSource.includes(runtimeAsset),
    true,
    `Le service worker doit précacher ${runtimeAsset}.`,
  );
}

assert.match(
  appSource,
  /typeof\s+initSyncV2ShadowMode\s*===\s*"function"[\s\S]*?await\s+initSyncV2ShadowMode\s*\(\s*\(\s*\)\s*=>\s*state\s*\)/u,
  "initApp doit fournir l'état hydraté au shadow mode.",
);
assert.doesNotMatch(
  source,
  /root\.state/u,
  "Le shadow runtime ne doit pas lire window.state : state est un binding lexical.",
);

assert.deepEqual(
  JSON.parse(
    fs.readFileSync(vehiclesPath, "utf8"),
  ),
  [],
  "data/vehicles.json doit rester exactement un tableau vide.",
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
require(corePath);
const shadow = require(shadowPath);

assert.equal(
  shadow.isSyncV2ShadowEnabled(),
  false,
  "Le shadow mode doit être désactivé par défaut.",
);

shadow.setSyncV2ShadowEnabled(true);
assert.equal(
  shadow.isSyncV2ShadowEnabled(),
  true,
  "Le flag doit pouvoir être activé localement.",
);
shadow.setSyncV2ShadowEnabled(false);
assert.equal(
  shadow.isSyncV2ShadowEnabled(),
  false,
  "Le flag doit pouvoir être désactivé localement.",
);

const providerState = {
  currentUserId: "provider-user",
  cases: [
    {
      id: "provider-case",
      localId: "case-or:provider-case",
    },
  ],
};
shadow.setSyncV2ShadowEnabled(true);
const providerStatus = await shadow.initSyncV2ShadowMode(
  () => providerState,
);
assert.equal(
  providerStatus.baselineCases,
  1,
  "Le shadow mode doit lire l'état via le fournisseur transmis par app.js.",
);
assert.equal(
  shadow.getSyncV2ShadowRuntimeState(),
  providerState,
  "Le fournisseur doit retourner le binding state courant.",
);
shadow.stopSyncV2ShadowMode("contract-test");
shadow.setSyncV2ShadowEnabled(false);

globalThis.caseSyncLocalId = () =>
  "case-or:or-srv-shadow-001";
globalThis.buildRepairStatus = (item) =>
  item.shadowStatus || "new";
globalThis.getSupabaseWorkshopId = () =>
  "00000000-0000-0000-0000-000000000001";
globalThis.getCurrentActor = () => ({
  userId: "00000000-0000-4000-8000-000000000002",
});

const previousCase = {
  id: "case-1",
  estimateNumber: "DEV-100",
  nextAction: "Réception",
  shadowStatus: "new",
  headerVersion: 3,
  statusVersion: 7,
};
const currentCase = {
  ...previousCase,
  estimateNumber: "DEV-101",
  nextAction: "Planning",
  shadowStatus: "received",
};

let operationCounter = 0;
const observations =
  shadow.buildSyncV2ShadowCandidates(
    previousCase,
    currentCase,
    {
      createdAt: "2026-07-12T22:30:00.000Z",
      deviceId: "device-shadow-test",
      operationIdFactory(domain) {
        operationCounter += 1;
        return `00000000-0000-4000-8000-00000000000${operationCounter}`;
      },
    },
  );

assert.equal(
  observations.length,
  2,
  "Une modification header + status doit produire deux candidats.",
);
assert.deepEqual(
  observations.map((entry) => entry.domain),
  ["header", "status"],
);
assert.equal(
  observations.every(
    (entry) => entry.outcome === "valid",
  ),
  true,
  "Les opérations shadow produites doivent respecter le core Sync V2.",
);

const headerOperation =
  observations.find(
    (entry) => entry.domain === "header",
  ).operation;
assert.deepEqual(
  headerOperation.payload.changes,
  {
    estimate_number: "DEV-101",
    next_action: "Planning",
  },
);
assert.equal(
  headerOperation.expectedVersion,
  3,
);
assert.equal(
  headerOperation.entityType,
  "repair_order",
);
assert.equal(
  headerOperation.entityId,
  "case-or:or-srv-shadow-001",
);
assert.equal(
  Object.prototype.hasOwnProperty.call(
    headerOperation.payload,
    "state",
  ),
  false,
);

const statusOperation =
  observations.find(
    (entry) => entry.domain === "status",
  ).operation;
assert.deepEqual(
  statusOperation.payload.changes,
  { status: "received" },
);
assert.equal(
  statusOperation.expectedVersion,
  7,
);

const unchanged =
  shadow.buildSyncV2ShadowCandidates(
    currentCase,
    { ...currentCase },
    {
      operationIdFactory: () =>
        "00000000-0000-4000-8000-000000000099",
    },
  );
assert.equal(
  unchanged.length,
  0,
  "Aucun changement ne doit produire d'opération.",
);

const newCase =
  shadow.buildSyncV2ShadowCandidates(
    null,
    {
      id: "case-new",
      estimateNumber: "DEV-NEW",
      shadowStatus: "pdf_ready_for_planning",
    },
    {
      operationIdFactory: (domain) =>
        domain === "header"
          ? "00000000-0000-4000-8000-000000000091"
          : "00000000-0000-4000-8000-000000000092",
    },
  );
assert.equal(
  newCase.every(
    (entry) => entry.operation.expectedVersion === 0,
  ),
  true,
  "Un nouveau dossier shadow doit partir de la version 0.",
);

console.log(
  "SYNC V2 SHADOW CONTRACT V23.4.0 C1 OK",
);
