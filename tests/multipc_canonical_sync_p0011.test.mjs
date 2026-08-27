import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";
import { createGranularSupabaseAdapter } from "./helpers/granular_supabase_adapter.mjs";

const WORKSHOP_ID = "00000000-0000-0000-0000-000000000001";
const CASE_ID = "case-live-or-srv-ch2602731";
const syncSource = fs.readFileSync(new URL("../js/supabase-sync.js", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

const productionCreateHandler = appSource.slice(
  appSource.indexOf("function bindCaseCreation"),
  appSource.indexOf("function focusPdfEstimateImport"),
);
assert.match(productionCreateHandler, /await\s+createAndPersistCaseFromPdfEstimate\s*\(/u, "le submit UI réel doit attendre création + persistance canonical");

function loadSyncVm(label) {
  const contract = createNimrVmContext({
    filename: `${label}-state.js`,
    console: { ...console, warn() {}, error() {} },
  });
  contract.context.getSupabaseWorkshopId = () => WORKSHOP_ID;
  contract.context.getSupabaseConfig = () => ({
    backupTable: "cloud_backups",
    backupKey: "nimr-sav-main",
  });
  vm.runInContext(syncSource, contract.context, { filename: `${label}-supabase-sync.js` });
  contract.context.guardSensitiveAction = () => ({ ok: true });
  contract.context.hasPermission = () => true;
  contract.context.navigator.onLine = true;
  contract.context.getSupabaseUser = async () => ({ id: "user-admin", email: "admin@example.test" });
  contract.context.render = () => {};
  contract.context.setSupabaseStatus = () => {};
  contract.context.setSupabaseDetails = () => {};
  contract.context.quietNotify = () => {};
  contract.context.notifyUser = () => {};
  contract.context.renderSupabaseSyncHealth = async () => {};
  contract.context.createSyncSafetySnapshot = async () => ({ ok: true });
  contract.context.restoreGranularWorkshopSettings = async () => false;
  return contract;
}

function makeCase(overrides = {}) {
  return {
    id: CASE_ID,
    clientName: "Client multi-PC",
    vehicle: "Véhicule test",
    plate: "CH-2602731",
    orNavNumber: "OR-SRV-CH2602731",
    localRevision: 0,
    updatedAt: "2026-08-27T08:00:00.000Z",
    history: [],
    claims: [],
    durations: {},
    flags: {},
    ...overrides,
  };
}

function makePdfCreationDraft({
  orNavNumber,
  clientName = "Client multi-PC",
  plate = "CH-2602731",
} = {}) {
  const lineId = `estimate-line-${String(orNavNumber || "case").toLowerCase()}`;
  return {
    signature: `${orNavNumber}.pdf|1024|1`,
    metadata: {},
    hasDetailedLabor: true,
    parsed: {
      sourceType: "pdf",
      fileName: `${orNavNumber}.pdf`,
      info: {
        clientName,
        vehicle: "Véhicule test",
        plate,
        orNumber: orNavNumber,
        estimateNumber: `DV-${orNavNumber}`,
      },
      allocations: {
        oilService: 0,
        mechanical: 0,
        electrical: 0,
        body: 1,
        prep: 0,
        paint: 0,
        reassembly: 0,
        finish: 0,
        quality: 0,
      },
      detectedHours: 1,
      laborLines: [{
        id: lineId,
        type: "labor",
        text: "DRESSAGE 1 33,000",
        operation: "DRESSAGE",
        hours: 1,
        distributions: [{
          phase: "body",
          operation: "DRESSAGE",
          laborHours: 1,
        }],
      }],
      distributedLines: [{
        id: `distributed-${lineId}`,
        sourceLineId: lineId,
        sourceOperation: "DRESSAGE",
        phase: "body",
        operation: "DRESSAGE",
        laborHours: 1,
      }],
      partsLines: [],
    },
  };
}

function canonicalRows(adapter, entityType) {
  return [...adapter.entities.values()]
    .filter((row) => row.workshop_id === WORKSHOP_ID && row.entity_type === entityType)
    .map((row) => structuredClone(row));
}

function createReadClient({ entities = [], backup = null } = {}) {
  return {
    from(table) {
      return {
        select() {
          const filters = {};
          let rowLimit = Number.MAX_SAFE_INTEGER;
          const query = {
            eq(column, value) { filters[column] = value; return query; },
            order() { return query; },
            limit(value) { rowLimit = Number(value); return query; },
            or() { return query; },
            maybeSingle() {
              let row = null;
              if (table === "cloud_backups") row = backup;
              if (table === "app_settings") row = null;
              return Promise.resolve({ data: row ? structuredClone(row) : null, error: null });
            },
            then(resolve, reject) {
              let rows = [];
              if (table === "sync_entities") rows = entities;
              if (table === "audit_logs") rows = [];
              rows = rows
                .filter((row) => Object.entries(filters).every(([column, value]) => row[column] === value))
                .sort((left, right) => String(left.updated_at).localeCompare(String(right.updated_at))
                  || String(left.entity_id || left.local_id).localeCompare(String(right.entity_id || right.local_id)))
                .slice(0, rowLimit)
                .map((row) => structuredClone(row));
              return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
            },
          };
          return query;
        },
      };
    },
  };
}

function makeLegacyBackup(caseItem = makeCase()) {
  return {
    state: {
      cases: [caseItem],
      bookings: [],
      users: [],
      resources: [],
      holidays: [],
      workHours: {},
      settings: {},
      auditLog: [],
      syncConflicts: [],
    },
    photos: [],
    app_version: "23.3.1",
    updated_at: "2026-08-27T09:00:00.000Z",
    updated_by: "user-admin",
    cases_count: 1,
    photos_count: 0,
  };
}

// PC1 creation: invoke the exact production creation/persistence function used
// by bindCaseCreation(). The test must not manually call revision/dirty/save
// helpers to manufacture a successful granular mutation.
const pc1 = loadSyncVm("p0-011-pc1");
const adapter = createGranularSupabaseAdapter();
pc1.context.getSupabaseClient = () => adapter.client;
pc1.context.scheduleAutoSupabaseBackup = () => {};
let productionFlushRequests = 0;
pc1.context.flushSupabaseBackup = async () => {
  productionFlushRequests += 1;
  return { acknowledged: false, reason: "deterministic-test-drain" };
};
pc1.run("state.cases = []; state.bookings = []; state.auditLog = []; activeCaseId = null; initializeLastKnownCasesComparable();");
const firstCreated = await pc1.context.createAndPersistCaseFromPdfEstimate(
  makePdfCreationDraft({ orNavNumber: "OR-SRV-CH2602731" }),
  null,
  {},
  { skipSnapshot: true },
);
const firstCaseId = firstCreated.item.id;
assert.equal(pc1.run(`state.cases.some((item) => item.id === ${JSON.stringify(firstCaseId)})`), true);

let operations = await pc1.context.loadDurableOutboxOperations();
const createdOperation = operations.find((entry) => entry.entityType === "case" && entry.entityId === firstCaseId);
assert.ok(createdOperation, "case.create doit créer une opération durable case/upsert");
assert.equal(createdOperation.action, "upsert");
assert.equal(createdOperation.workshopId, WORKSHOP_ID);
assert.equal(createdOperation.payload.entity.id, firstCaseId);
assert.equal(createdOperation.payload.entity.orNavNumber, "OR-SRV-CH2602731");
assert.equal(productionFlushRequests, 1, "le handler production doit déclencher le drain canonical immédiat après durabilité locale");
assert.equal(adapter.calls.length, 0, "la mutation volatile ne doit pas être ACK avant le serveur");

// Lost ACK: the canonical server applies once, the durable envelope remains,
// then the immutable operationId is retried idempotently and finally ACKed.
const originalComplete = pc1.context.completeDurableOutboxOperationAtomically;
let loseFirstAck = true;
pc1.context.completeDurableOutboxOperationAtomically = async (...args) => {
  if (loseFirstAck) {
    loseFirstAck = false;
    throw new Error("injected ACK loss");
  }
  return originalComplete(...args);
};
const firstDrain = await pc1.context.processOfflineQueue();
assert.equal(firstDrain.acknowledged, false);
operations = await pc1.context.loadDurableOutboxOperations();
const retained = operations.find((entry) => entry.operationId === createdOperation.operationId);
assert.ok(retained, "l'enveloppe doit survivre à la perte d'ACK");
assert.equal(retained.syncStatus, "failed");
assert.equal(canonicalRows(adapter, "case").length, 1, "le serveur canonique a appliqué la mutation une seule fois");

pc1.context.completeDurableOutboxOperationAtomically = originalComplete;
const retryDrain = await pc1.context.processOfflineQueue();
assert.equal(retryDrain.acknowledged, true);
assert.equal((await pc1.context.loadDurableOutboxOperations()).some((entry) => entry.operationId === createdOperation.operationId), false);
assert.equal(canonicalRows(adapter, "case").length, 1, "le retry ne doit pas dupliquer l'entité canonique");
const observed = pc1.context.getObservedGranularEntityMetadata(WORKSHOP_ID, "case", firstCaseId);
assert.ok(Number(observed?.serverVersion) > 0, "la version canonique ACK doit être mémorisée");

// PC2 virgin: canonical rows are the primary automatic bootstrap path.
const pc2 = loadSyncVm("p0-011-pc2-canonical");
const readClient = createReadClient({ entities: canonicalRows(adapter, "case") });
pc2.context.getSupabaseClient = () => readClient;
pc2.run("state.cases = []; state.bookings = []; state.auditLog = []; activeCaseId = null; initializeLastKnownCasesComparable();");
const canonicalPull = await pc2.context.pullLatestSupabaseBackup("pc2-startup");
assert.equal(canonicalPull.cases, 1);
assert.equal(pc2.run(`state.cases.some((item) => item.id === ${JSON.stringify(firstCaseId)})`), true);
assert.equal((await pc2.context.loadDurableOutboxOperations()).filter((entry) => ["case", "booking"].includes(entry.entityType)).length, 0, "un pull distant ne doit pas produire d'écho sortant");

// PC2 is already initialized. A second case created through the same real
// production handler must arrive through incremental granular sync only.
const bootstrapKey = pc2.context.getGranularSyncMetadataKey(WORKSHOP_ID, "bootstrap");
assert.equal((await pc2.context.loadSyncMetadata(bootstrapKey)).initialized, true);
await new Promise((resolve) => setTimeout(resolve, 5));
const secondCreated = await pc1.context.createAndPersistCaseFromPdfEstimate(
  makePdfCreationDraft({
    orNavNumber: "OR-SRV-CH2602732",
    clientName: "Second client multi-PC",
    plate: "CH-2602732",
  }),
  null,
  {},
  { skipSnapshot: true },
);
const secondCaseId = secondCreated.item.id;
const secondOperation = (await pc1.context.loadDurableOutboxOperations())
  .find((entry) => entry.entityType === "case" && entry.entityId === secondCaseId);
assert.ok(secondOperation, "la seconde création production doit créer une opération case/upsert");
assert.equal((await pc1.context.processOfflineQueue()).acknowledged, true);
const secondCanonical = adapter.canonical(WORKSHOP_ID, "case", secondCaseId);
assert.ok(Number(secondCanonical?.entity_version) > Number(observed.serverVersion));
let pc2LegacyFetchesAfterInitialization = 0;
pc2.context.getSupabaseClient = () => createReadClient({ entities: canonicalRows(adapter, "case") });
pc2.context.fetchLatestCloudBackup = async () => {
  pc2LegacyFetchesAfterInitialization += 1;
  throw new Error("cloud_backups ne doit pas être utilisé après initialisation granulaire");
};
const incrementalSecondPull = await pc2.context.pullLatestSupabaseBackup("pc2-initialized-second-case");
assert.equal(incrementalSecondPull.bootstrap, false);
assert.equal(pc2.run(`state.cases.some((item) => item.id === ${JSON.stringify(secondCaseId)})`), true);
assert.equal(pc2LegacyFetchesAfterInitialization, 0);
assert.equal((await pc2.context.loadSyncMetadata(bootstrapKey)).initialized, true, "le pull incrémental ne doit pas réinitialiser le bootstrap");

// A freshly configured browser may have local user/config/audit noise and a
// local-change timestamp, but no unsynchronized business entity. Legacy backup
// fallback must still bootstrap it automatically when the canonical store is empty.
const noisyPc2 = loadSyncVm("p0-011-pc2-noisy-bootstrap");
const legacyBackup = makeLegacyBackup();
let legacyFetches = 0;
noisyPc2.context.getSupabaseClient = () => ({});
noisyPc2.context.pullGranularEntityGroup = async () => 0;
noisyPc2.context.pullGranularAuditGroup = async () => 0;
noisyPc2.context.fetchLatestCloudBackup = async () => {
  legacyFetches += 1;
  return structuredClone(legacyBackup);
};
noisyPc2.context.scheduleAutoSupabaseBackup = () => {};
noisyPc2.run(`
  state.cases = [];
  state.bookings = [];
  state.users = [{ id: "local-admin", role: "admin_technique" }];
  state.settings = { configuredLocally: true };
  state.auditLog = [{ id: "config-audit", at: "2026-08-27T10:00:00.000Z", type: "config.saved" }];
  markEntityAuditEntryDirty(state.auditLog[0]);
  initializeLastKnownCasesComparable();
`);
assert.equal(await noisyPc2.context.saveState({ skipSnapshot: true }), true);
noisyPc2.context.rememberLocalUserChangeAt("2026-08-27T10:00:00.000Z");
const setupNoiseOperations = await noisyPc2.context.loadDurableOutboxOperations();
assert.ok(setupNoiseOperations.some((entry) => ["audit", "workshop_settings"].includes(entry.entityType)));
assert.equal(setupNoiseOperations.some((entry) => ["case", "booking"].includes(entry.entityType)), false);
const noisyBootstrap = await noisyPc2.context.pullLatestSupabaseBackup("fresh-browser-with-local-setup");
assert.equal(noisyPc2.run(`state.cases.some((item) => item.id === ${JSON.stringify(CASE_ID)})`), true, "le bruit local non métier ne doit pas bloquer le bootstrap entrant");
assert.equal(noisyBootstrap.legacyApplied, true);
assert.equal(legacyFetches, 1);

// A failed/non-applied fallback must stay retryable instead of being marked as
// initialized forever. The second focus/poll can receive the backup later.
const retryPc2 = loadSyncVm("p0-011-pc2-bootstrap-retry");
let retryFetches = 0;
retryPc2.context.getSupabaseClient = () => ({});
retryPc2.context.pullGranularEntityGroup = async () => 0;
retryPc2.context.pullGranularAuditGroup = async () => 0;
retryPc2.context.fetchLatestCloudBackup = async () => {
  retryFetches += 1;
  return retryFetches === 1 ? null : structuredClone(legacyBackup);
};
retryPc2.run("state.cases = []; state.bookings = []; state.auditLog = []; initializeLastKnownCasesComparable();");
const failedBootstrap = await retryPc2.context.pullLatestSupabaseBackup("startup-no-backup-yet");
assert.equal(failedBootstrap.initialized, false);
const retryMetaKey = retryPc2.context.getGranularSyncMetadataKey(WORKSHOP_ID, "bootstrap");
assert.equal((await retryPc2.context.loadSyncMetadata(retryMetaKey)).initialized, false);
const successfulRetry = await retryPc2.context.pullLatestSupabaseBackup("focus-retry");
assert.equal(successfulRetry.legacyApplied, true);
assert.equal(retryFetches, 2);
assert.equal(retryPc2.run(`state.cases.some((item) => item.id === ${JSON.stringify(CASE_ID)})`), true);

// A real local unsynchronized case remains protected and keeps bootstrap
// retryable; it is never replaced merely because the browser is new.
const protectedPc = loadSyncVm("p0-011-pc2-protected-local");
protectedPc.context.getSupabaseClient = () => ({});
protectedPc.context.pullGranularEntityGroup = async () => 0;
protectedPc.context.pullGranularAuditGroup = async () => 0;
protectedPc.context.fetchLatestCloudBackup = async () => structuredClone(legacyBackup);
protectedPc.context.__localCase = makeCase({ id: "local-unsynced-case", orNavNumber: "LOCAL-ONLY", localRevision: 2, syncRevision: 1 });
protectedPc.run(`
  state.cases = [normalizeCase(__localCase)];
  state.bookings = [];
  initializeLastKnownCasesComparable();
  rememberLocalUserChangeAt("2026-08-27T10:00:00.000Z");
`);
const protectedResult = await protectedPc.context.pullLatestSupabaseBackup("protect-real-local-business");
assert.equal(protectedPc.run(`state.cases.some((item) => item.id === "local-unsynced-case")`), true);
assert.equal(protectedPc.run(`state.cases.some((item) => item.id === ${JSON.stringify(CASE_ID)})`), false);
assert.equal(protectedResult.initialized, false);

// An already acknowledged local case is not proof of unsynchronized business
// work. Generic setup noise after that ACK must not permanently block a legacy
// bootstrap/fallback needed during canonical-store migration.
const acknowledgedPc = loadSyncVm("p0-011-pc2-acknowledged-local");
acknowledgedPc.context.getSupabaseClient = () => ({});
acknowledgedPc.context.pullGranularEntityGroup = async () => 0;
acknowledgedPc.context.pullGranularAuditGroup = async () => 0;
acknowledgedPc.context.fetchLatestCloudBackup = async () => structuredClone(legacyBackup);
acknowledgedPc.context.__acknowledgedCase = makeCase({
  id: "already-synchronized-case",
  orNavNumber: "ALREADY-SYNCED",
  localRevision: 4,
  syncRevision: 4,
});
acknowledgedPc.run(`
  state.cases = [normalizeCase(__acknowledgedCase)];
  state.cases[0].localRevision = 4;
  state.cases[0].syncRevision = 4;
  state.bookings = [];
  initializeLastKnownCasesComparable();
  rememberLocalUserChangeAt("2026-08-27T10:00:00.000Z");
`);
const acknowledgedFallback = await acknowledgedPc.context.pullLatestSupabaseBackup("acknowledged-case-plus-setup-noise");
assert.equal(acknowledgedFallback.legacyApplied, true, "une case déjà ACK ne doit pas être confondue avec une mutation métier locale");
assert.equal(acknowledgedPc.run(`state.cases.some((item) => item.id === ${JSON.stringify(CASE_ID)})`), true);

// A subsequent business edit also uses its real production mutation function;
// the test does not manually prime the revision/dirty/save machinery.
pc1.context.guardAction = () => ({ ok: true });
pc1.context.getCurrentUser = () => ({ id: "user-admin", role: "admin" });
assert.equal(pc1.context.updateCaseNote(firstCaseId, "reception", "Modification PC1 après bootstrap").ok, true);
let updatedOperation = null;
for (let attempt = 0; attempt < 20 && !updatedOperation; attempt += 1) {
  const pending = await pc1.context.loadDurableOutboxOperations();
  updatedOperation = pending.find((entry) => entry.entityType === "case" && entry.entityId === firstCaseId) || null;
  if (!updatedOperation) await new Promise((resolve) => setTimeout(resolve, 0));
}
assert.ok(updatedOperation, "la mutation métier production doit atteindre l'outbox sans préparation manuelle");
await pc1.context.processOfflineQueue();
const updatedCanonical = adapter.canonical(WORKSHOP_ID, "case", firstCaseId);
assert.ok(updatedCanonical.entity_version > observed.serverVersion);
await pc2.context.handleRemoteCaseChange(updatedCanonical, "UPDATE");
assert.equal(pc2.run(`state.cases.find((item) => item.id === ${JSON.stringify(firstCaseId)}).notes.reception`), "Modification PC1 après bootstrap");

// Static anti-overwrite boundary: the automatic outbox sender cannot serialize
// or upload a whole local state before incoming bootstrap.
const automaticBody = syncSource.slice(
  syncSource.indexOf("async function autoBackupToSupabase"),
  syncSource.indexOf("function refreshSupabasePermissionState"),
);
const manualBackupBody = syncSource.slice(
  syncSource.indexOf("async function saveLocalToSupabase"),
  syncSource.indexOf("async function restoreLocalFromSupabase"),
);
assert.doesNotMatch(automaticBody, /buildCloudBackupPayload\s*\(|buildBackupPayload\s*\(|upsertCloudBackupRow\s*\(/u);
assert.match(syncSource, /rpc\("nimr_apply_sync_entity_v2"/u);
assert.doesNotMatch(manualBackupBody, /nimr_apply_sync_entity_v2|applyCanonicalSyncEntity/u, "la sauvegarde complète reste un backup/projection, pas un second sender canonique");
assert.doesNotMatch(manualBackupBody, /markLocalCasesAsSynced\s*\(/u, "un backup/projection ne doit jamais fabriquer un ACK canonical local");

console.log("P0-011 MULTI-PC CANONICAL SYNC BOOTSTRAP OK");
