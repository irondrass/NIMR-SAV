import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";
import { createGranularSupabaseAdapter } from "./helpers/granular_supabase_adapter.mjs";

const WORKSHOP_ID = "00000000-0000-0000-0000-000000000001";
const syncSource = fs.readFileSync(new URL("../js/supabase-sync.js", import.meta.url), "utf8");

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createMemoryIndexedDbRequest() {
  const request = {};
  Object.defineProperty(request, Symbol.toStringTag, { value: "IDBRequest" });
  return request;
}

function createMemoryIndexedDb() {
  const databases = new Map();
  function createDatabase(name, version) {
    const stores = new Map();
    const database = {
      name,
      version,
      stores,
      objectStoreNames: { contains: (storeName) => stores.has(storeName) },
      createObjectStore(storeName, options = {}) {
        const entries = new Map();
        const definition = { entries, keyPath: options.keyPath || null, indexes: new Map() };
        stores.set(storeName, definition);
        return {
          createIndex(indexName, keyPath, indexOptions = {}) {
            definition.indexes.set(indexName, { keyPath, ...indexOptions });
          },
        };
      },
      transaction(storeNames, mode) {
        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        const working = new Map(names.map((storeName) => {
          const definition = stores.get(storeName);
          if (!definition) throw new Error(`Missing object store: ${storeName}`);
          return [storeName, new Map([...definition.entries].map(([key, value]) => [key, clone(value)]))];
        }));
        let pending = 0;
        let scheduled = false;
        let failed = null;
        const transaction = {
          mode,
          error: null,
          oncomplete: null,
          onerror: null,
          onabort: null,
          objectStore(storeName) {
            const definition = stores.get(storeName);
            const entries = working.get(storeName);
            const request = (operation) => {
              const result = createMemoryIndexedDbRequest();
              pending += 1;
              queueMicrotask(() => {
                try {
                  result.result = operation();
                } catch (error) {
                  failed = error;
                  result.error = error;
                } finally {
                  pending -= 1;
                  scheduleCompletion();
                }
              });
              return result;
            };
            return {
              put(value) {
                const copy = clone(value);
                return request(() => {
                  const key = definition.keyPath ? copy[definition.keyPath] : undefined;
                  if (key === undefined || key === null || key === "") throw new Error(`Missing keyPath ${definition.keyPath}`);
                  entries.set(key, copy);
                  return key;
                });
              },
              get(key) { return request(() => clone(entries.get(key))); },
              getAll() { return request(() => [...entries.values()].map(clone)); },
              delete(key) { return request(() => entries.delete(key)); },
              clear() { return request(() => entries.clear()); },
            };
          },
          abort() {
            failed = new Error("Transaction aborted");
            transaction.error = failed;
            scheduleCompletion();
          },
        };
        function scheduleCompletion() {
          if (scheduled || pending) return;
          scheduled = true;
          setTimeout(() => {
            if (failed) {
              transaction.error = failed;
              transaction.onerror?.();
              return;
            }
            working.forEach((entries, storeName) => {
              stores.get(storeName).entries = entries;
            });
            transaction.oncomplete?.();
          }, 0);
        }
        setTimeout(scheduleCompletion, 0);
        return transaction;
      },
      close() {},
    };
    databases.set(name, database);
    return database;
  }
  return {
    databases,
    open(name, version) {
      const request = createMemoryIndexedDbRequest();
      setTimeout(() => {
        let database = databases.get(name);
        const needsUpgrade = !database || Number(version) > Number(database.version || 0);
        if (!database) database = createDatabase(name, version);
        if (needsUpgrade) {
          database.version = version;
          request.result = database;
          request.onupgradeneeded?.();
        }
        request.result = database;
        request.onsuccess?.();
      }, 0);
      return request;
    },
  };
}

function loadSyncVm(label, options = {}) {
  const contract = createNimrVmContext({
    filename: `${label}-state.js`,
    console: { ...console, warn() {}, error() {} },
    ...options,
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
  contract.context.getSupabaseUser = async () => ({ id: "user-director", email: "director@example.test" });
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

function makeCase(id, overrides = {}) {
  return {
    id,
    clientName: `Client ${id}`,
    vehicle: "Véhicule test",
    plate: `PL-${id}`,
    orNavNumber: `OR-${id}`,
    localRevision: 1,
    updatedAt: "2026-09-03T08:00:00.000Z",
    history: [],
    claims: [],
    durations: {},
    flags: {},
    ...overrides,
  };
}

function makeBooking(id, overrides = {}) {
  return {
    id,
    title: `RDV ${id}`,
    date: "2026-09-03",
    time: "09:00",
    clientName: `Client ${id}`,
    ...overrides,
  };
}

const passed = [];
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

// ========================================================================
// 1. Tombstone-Safe Active Probe & Self-Heal Trigger (production scenario)
// ========================================================================
await check("1 tombstone-safe active probe triggers self-heal despite leading tombstones", async () => {
  const adapter = createGranularSupabaseAdapter();
  adapter.send({
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: "case-lead-tomb-1",
    entityVersion: 2,
    operationId: "op-del-1",
    action: "delete",
    payload: {},
    updatedAt: "2026-09-01T08:00:00.000Z",
  });
  adapter.send({
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: "case-lead-tomb-2",
    entityVersion: 2,
    operationId: "op-del-2",
    action: "delete",
    payload: {},
    updatedAt: "2026-09-01T08:01:00.000Z",
  });
  for (let i = 1; i <= 5; i += 1) {
    adapter.send({
      workshopId: WORKSHOP_ID,
      entityType: "case",
      entityId: `case-prod-00${i}`,
      entityVersion: 1,
      operationId: `op-act-${i}`,
      action: "upsert",
      payload: { entity: makeCase(`case-prod-00${i}`) },
      updatedAt: `2026-09-01T08:0${i + 1}:00.000Z`,
    });
  }

  const vmInstance = loadSyncVm("check-1");
  vmInstance.context.getSupabaseClient = () => adapter.client;

  const bootstrapKey = vmInstance.context.getGranularSyncMetadataKey(WORKSHOP_ID, "bootstrap");
  const caseMetaKey = vmInstance.context.getGranularSyncMetadataKey(WORKSHOP_ID, "case");
  await vmInstance.context.putSyncMetadata(bootstrapKey, { initialized: true, legacyAttempted: false, legacyApplied: false });
  await vmInstance.context.putSyncMetadata(caseMetaKey, {
    cursor: { updatedAt: "2026-09-01T08:09:00.000Z", entityId: "case-prod-005" },
    initialized: true,
  });
  vmInstance.run("state.cases = []; state.bookings = []; state.auditLog = [];");

  const hasActive = await vmInstance.context.NIMR_GRANULAR_SYNC_TEST_API.probeActiveRemoteGranularEntity(adapter.client, WORKSHOP_ID, "case");
  assert.equal(hasActive, true, "Probe must find active cases despite leading tombstones");

  const result = await vmInstance.context.pullLatestSupabaseBackup("test-tombstone-safe-recovery");
  assert.equal(result.selfHealed, true, "Self-heal must be triggered");
  assert.equal(result.initialized, true);
  assert.equal(vmInstance.run("state.cases.length"), 5, "All 5 active cases must be materialized locally");
  assert.equal(vmInstance.run("state.cases.some(c => c.id === 'case-lead-tomb-1')"), false, "Tombstones must not be in active cases");
});

// ========================================================================
// 2. Booking Success Cannot Mask Case Failure
// ========================================================================
await check("2 booking success cannot mask case failure during bootstrap certification", async () => {
  const adapter = createGranularSupabaseAdapter();
  adapter.send({
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: "case-critical-1",
    entityVersion: 1,
    operationId: "op-c-1",
    action: "upsert",
    payload: { entity: makeCase("case-critical-1") },
  });
  adapter.send({
    workshopId: WORKSHOP_ID,
    entityType: "booking",
    entityId: "booking-ok-1",
    entityVersion: 1,
    operationId: "op-b-1",
    action: "upsert",
    payload: { entity: makeBooking("booking-ok-1") },
  });

  const vmInstance = loadSyncVm("check-2");
  vmInstance.context.getSupabaseClient = () => adapter.client;
  vmInstance.run("state.cases = []; state.bookings = []; state.auditLog = [];");

  const originalApply = vmInstance.context.NIMR_GRANULAR_SYNC_TEST_API.applyRemoteEntityRow;
  vmInstance.context.applyRemoteEntityRow = async (row, options) => {
    if (row.entity_type === "case") return { applied: false, accounted: false, status: "unaccounted" };
    return originalApply(row, options);
  };

  const result = await vmInstance.context.pullLatestSupabaseBackup("test-booking-cannot-mask-case");
  assert.equal(result.caseStats.groupCertified, false, "Case group must NOT be certified when case rows fail");
  assert.equal(result.bookingStats.groupCertified, true, "Booking group succeeds");
  assert.equal(result.initialized, false, "Global bootstrap must NOT be certified when case group failed");
});

// ========================================================================
// 3. Cursor Safe-Accounting Invariant Halts on Unaccounted Row
// ========================================================================
await check("3 cursor safe-accounting halts at last accounted row", async () => {
  const adapter = createGranularSupabaseAdapter();
  adapter.send({
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: "case-seq-1",
    entityVersion: 1,
    operationId: "op-seq-1",
    action: "upsert",
    payload: { entity: makeCase("case-seq-1") },
    updatedAt: "2026-09-01T10:00:00.000Z",
  });
  adapter.send({
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: "case-seq-2",
    entityVersion: 1,
    operationId: "op-seq-2",
    action: "upsert",
    payload: { entity: makeCase("case-seq-2") },
    updatedAt: "2026-09-01T10:01:00.000Z",
  });

  const vmInstance = loadSyncVm("check-3");
  vmInstance.context.getSupabaseClient = () => adapter.client;
  vmInstance.run("state.cases = []; state.bookings = []; state.auditLog = [];");

  const originalApply = vmInstance.context.NIMR_GRANULAR_SYNC_TEST_API.applyRemoteEntityRow;
  vmInstance.context.applyRemoteEntityRow = async (row, options) => {
    if (row.entity_id === "case-seq-2") return { applied: false, accounted: false, status: "unaccounted" };
    return originalApply(row, options);
  };

  const stats = await vmInstance.context.pullGranularEntityGroup(adapter.client, "case", 500, true);
  assert.equal(stats.fetched, 2);
  assert.equal(stats.accounted, 1);
  assert.equal(stats.unaccounted, 1);
  assert.equal(stats.cursor.entityId, "case-seq-1", "Cursor must advance only to row 1, NOT row 2");
  assert.equal(stats.groupCertified, false);

  const caseMetaKey = vmInstance.context.getGranularSyncMetadataKey(WORKSHOP_ID, "case");
  const storedMeta = await vmInstance.context.loadSyncMetadata(caseMetaKey);
  assert.equal(storedMeta.cursor.entityId, "case-seq-1");
  assert.equal(storedMeta.initialized, false, "Sync metadata must NOT be marked initialized on partial failure");
});

// ========================================================================
// 4. Same Canonical Version + Entity Missing Locally => Materializes
// ========================================================================
await check("4 same canonical version and entity missing locally materializes cleanly", async () => {
  const adapter = createGranularSupabaseAdapter();
  adapter.send({
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: "case-missing-4",
    entityVersion: 1,
    operationId: "op-4",
    action: "upsert",
    payload: { entity: makeCase("case-missing-4") },
  });

  const vmInstance = loadSyncVm("check-4");
  vmInstance.context.getSupabaseClient = () => adapter.client;

  await vmInstance.context.rememberObservedGranularEntityMetadata({
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: "case-missing-4",
    serverVersion: 1,
    lastOperationId: "op-4",
    deleted: false,
    updatedAt: "2026-09-01T10:00:00.000Z",
  });
  vmInstance.run("state.cases = []; state.bookings = []; state.auditLog = [];");

  const row = adapter.canonical(WORKSHOP_ID, "case", "case-missing-4");
  const outcome = await vmInstance.context.NIMR_GRANULAR_SYNC_TEST_API.applyRemoteEntityRow(row);
  assert.equal(outcome.applied, true, "Missing entity must be applied");
  assert.equal(outcome.status, "materialized");
  assert.equal(vmInstance.run("state.cases.length"), 1);
  assert.equal(vmInstance.run("state.cases[0].id"), "case-missing-4");
});

// ========================================================================
// 5. Same Canonical Version + Entity Already Present => Safe No-Op
// ========================================================================
await check("5 same canonical version and entity already present is a safe no-op", async () => {
  const adapter = createGranularSupabaseAdapter();
  adapter.send({
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: "case-present-5",
    entityVersion: 1,
    operationId: "op-5",
    action: "upsert",
    payload: { entity: makeCase("case-present-5") },
  });

  const vmInstance = loadSyncVm("check-5");
  vmInstance.context.getSupabaseClient = () => adapter.client;
  vmInstance.run(`state.cases = [${JSON.stringify(makeCase("case-present-5"))}]; state.bookings = []; state.auditLog = [];`);

  await vmInstance.context.rememberObservedGranularEntityMetadata({
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: "case-present-5",
    serverVersion: 1,
    lastOperationId: "op-5",
    deleted: false,
  });

  const row = adapter.canonical(WORKSHOP_ID, "case", "case-present-5");
  const outcome = await vmInstance.context.NIMR_GRANULAR_SYNC_TEST_API.applyRemoteEntityRow(row);
  assert.equal(outcome.applied, false, "Already present row must not re-trigger state change");
  assert.equal(outcome.accounted, true);
  assert.equal(outcome.status, "already_present_same_canonical_version");
  assert.equal(vmInstance.run("state.cases.length"), 1, "No duplicate rows created");
});

// ========================================================================
// 6. Pending/Conflicted Outbox Preserved (Entity Present Locally)
// ========================================================================
await check("6 pending local outbox operation is preserved during self-heal pull", async () => {
  const adapter = createGranularSupabaseAdapter();
  adapter.send({
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: "case-outbox-6",
    entityVersion: 1,
    operationId: "op-remote-old",
    action: "upsert",
    payload: { entity: makeCase("case-outbox-6", { clientName: "Serveur Ancien" }) },
    updatedAt: "2026-09-01T08:00:00.000Z",
  });

  const vmInstance = loadSyncVm("check-6");
  vmInstance.context.getSupabaseClient = () => adapter.client;

  const localCase = makeCase("case-outbox-6", { clientName: "Local Modifié Non-Envoyé" });
  vmInstance.run(`state.cases = [${JSON.stringify(localCase)}]; state.bookings = []; state.auditLog = [];`);

  vmInstance.context.loadDurableOutboxOperations = async () => [{
    operationId: "op-local-pending-6",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: "case-outbox-6",
    baseVersion: 1,
    action: "upsert",
    syncStatus: "pending",
    payload: { entity: localCase },
  }];

  const stats = await vmInstance.context.pullGranularEntityGroup(adapter.client, "case", 500, true);
  assert.equal(stats.pendingIntentPreserved, 1);
  assert.equal(stats.accounted, 1);
  assert.equal(
    vmInstance.run("state.cases.find(c => c.id === 'case-outbox-6').clientName"),
    "Local Modifié Non-Envoyé",
    "Local unpushed intent must be preserved",
  );
});

// ========================================================================
// 7. Genuinely Empty Server => No Endless Self-Heal
// ========================================================================
await check("7 genuinely empty server is certified and avoids infinite self-heal probes", async () => {
  const adapter = createGranularSupabaseAdapter();
  const vmInstance = loadSyncVm("check-7");
  vmInstance.context.getSupabaseClient = () => adapter.client;
  vmInstance.context.fetchLatestCloudBackup = async () => null;
  vmInstance.run("state.cases = []; state.bookings = []; state.auditLog = [];");

  const firstPull = await vmInstance.context.pullLatestSupabaseBackup("first-empty-bootstrap");
  assert.equal(firstPull.initialized, true, "Empty server must certify bootstrap");
  assert.equal(firstPull.selfHealed, false);

  const secondPoll = await vmInstance.context.pullLatestSupabaseBackup("second-empty-poll");
  assert.equal(secondPoll.initialized, true);
  assert.equal(secondPoll.selfHealed, false, "Subsequent poll must not trigger self-heal probe on certified empty server");
});

// ========================================================================
// 8. All Remote Tombstones => Safe Stable State
// ========================================================================
await check("8 all remote tombstones produce safe stable state and certified bootstrap", async () => {
  const adapter = createGranularSupabaseAdapter();
  for (let i = 1; i <= 3; i += 1) {
    adapter.send({
      workshopId: WORKSHOP_ID,
      entityType: "case",
      entityId: `case-tomb-${i}`,
      entityVersion: 2,
      operationId: `op-del-${i}`,
      action: "delete",
      payload: {},
      updatedAt: `2026-09-01T08:0${i}:00.000Z`,
    });
  }

  const vmInstance = loadSyncVm("check-8");
  vmInstance.context.getSupabaseClient = () => adapter.client;
  vmInstance.run("state.cases = []; state.bookings = []; state.auditLog = [];");

  const result = await vmInstance.context.pullLatestSupabaseBackup("all-tombstones-bootstrap");
  assert.equal(result.caseStats.tombstoneAccounted, 3);
  assert.equal(result.caseStats.active, 0);
  assert.equal(result.caseStats.groupCertified, true);
  assert.equal(result.initialized, true);
  assert.equal(vmInstance.run("state.cases.length"), 0);
});

// ========================================================================
// 9. Normal Incremental Cursor Path Remains Valid
// ========================================================================
await check("9 normal incremental cursor path pulls only new delta", async () => {
  const adapter = createGranularSupabaseAdapter();
  adapter.send({
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: "case-inc-1",
    entityVersion: 1,
    operationId: "op-inc-1",
    action: "upsert",
    payload: { entity: makeCase("case-inc-1") },
    updatedAt: "2026-09-01T08:00:00.000Z",
  });

  const vmInstance = loadSyncVm("check-9");
  vmInstance.context.getSupabaseClient = () => adapter.client;
  vmInstance.run("state.cases = []; state.bookings = []; state.auditLog = [];");

  await vmInstance.context.pullLatestSupabaseBackup("initial-pull");
  assert.equal(vmInstance.run("state.cases.length"), 1);

  adapter.send({
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: "case-inc-2",
    entityVersion: 1,
    operationId: "op-inc-2",
    action: "upsert",
    payload: { entity: makeCase("case-inc-2") },
    updatedAt: "2026-09-02T08:00:00.000Z",
  });

  const incrementalResult = await vmInstance.context.pullLatestSupabaseBackup("incremental-pull");
  assert.equal(incrementalResult.selfHealed, false);
  assert.equal(incrementalResult.cases, 1, "Only new delta row pulled");
  assert.equal(vmInstance.run("state.cases.length"), 2);
  assert.equal(vmInstance.run("state.cases.some(c => c.id === 'case-inc-2')"), true);
});

// ========================================================================
// 10. Zero Server Mutations During Self-Healing Recovery
// ========================================================================
await check("10 recovery performs zero server mutations (SELECT only)", async () => {
  const adapter = createGranularSupabaseAdapter();
  adapter.send({
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: "case-ro-1",
    entityVersion: 1,
    operationId: "op-ro-1",
    action: "upsert",
    payload: { entity: makeCase("case-ro-1") },
  });

  const vmInstance = loadSyncVm("check-10");
  vmInstance.context.getSupabaseClient = () => adapter.client;

  const caseMetaKey = vmInstance.context.getGranularSyncMetadataKey(WORKSHOP_ID, "case");
  const bootstrapKey = vmInstance.context.getGranularSyncMetadataKey(WORKSHOP_ID, "bootstrap");
  await vmInstance.context.putSyncMetadata(bootstrapKey, { initialized: true });
  await vmInstance.context.putSyncMetadata(caseMetaKey, {
    cursor: { updatedAt: "2026-09-01T00:00:00.000Z", entityId: "case-old" },
    initialized: true,
  });
  vmInstance.run("state.cases = []; state.bookings = []; state.auditLog = [];");

  const callsBefore = adapter.calls.length;
  await vmInstance.context.pullLatestSupabaseBackup("self-heal-readonly-probe");

  const mutatingCalls = adapter.calls.slice(callsBefore).filter((call) =>
    ["insert", "update", "upsert", "delete", "rpc"].includes(call.operation)
  );
  assert.equal(mutatingCalls.length, 0, "Recovery must execute zero mutating operations on server");
});

// ========================================================================
// 11. Legacy Backup Compatibility A: Granular Empty + Legacy Has Cases
// ========================================================================
await check("11 granular empty + legacy backup with cases => restore legacy, initialized true", async () => {
  const adapter = createGranularSupabaseAdapter();
  const vmInstance = loadSyncVm("check-11");
  vmInstance.context.getSupabaseClient = () => adapter.client;
  vmInstance.run("state.cases = []; state.bookings = []; state.auditLog = [];");

  const legacyCases = [makeCase("legacy-case-A"), makeCase("legacy-case-B")];
  vmInstance.context.fetchLatestCloudBackup = async () => ({
    state: { cases: legacyCases, bookings: [], auditLog: [] },
    updated_at: new Date(Date.now() + 86400000).toISOString(),
    app_version: "v23.3.20",
    updated_by: "legacy-test",
  });

  const result = await vmInstance.context.pullLatestSupabaseBackup("legacy-restore-test");
  assert.equal(result.bootstrap, true);
  assert.equal(result.legacyAttempted, true);
  assert.equal(result.legacyApplied, true);
  assert.equal(result.initialized, true, "Legacy backup must certify initialization");
  assert.equal(vmInstance.run("state.cases.length"), 2, "Legacy cases must be visible");
  assert.equal(vmInstance.run("state.cases.some(c => c.id === 'legacy-case-A')"), true);
  assert.equal(vmInstance.run("state.cases.some(c => c.id === 'legacy-case-B')"), true);
});

// ========================================================================
// 12. Legacy Backup Compatibility B: Granular Empty + No Legacy => Init True
// ========================================================================
await check("12 granular empty + no legacy backup => initialized true, genuinely empty", async () => {
  const adapter = createGranularSupabaseAdapter();
  const vmInstance = loadSyncVm("check-12");
  vmInstance.context.getSupabaseClient = () => adapter.client;
  vmInstance.run("state.cases = []; state.bookings = []; state.auditLog = [];");

  vmInstance.context.fetchLatestCloudBackup = async () => null;

  const result = await vmInstance.context.pullLatestSupabaseBackup("empty-no-legacy");
  assert.equal(result.bootstrap, true);
  assert.equal(result.legacyAttempted, true);
  assert.equal(result.legacyApplied, false);
  assert.equal(result.initialized, true, "Genuinely empty workshop must be certified");
  assert.equal(vmInstance.run("state.cases.length"), 0);

  const secondPoll = await vmInstance.context.pullLatestSupabaseBackup("second-poll");
  assert.equal(secondPoll.bootstrap, false, "Must not re-bootstrap on second poll");
  assert.equal(secondPoll.initialized, true);
});

// ========================================================================
// 13. Legacy Backup Compatibility C: Granular Non-Empty => No Legacy
// ========================================================================
await check("13 granular non-empty => legacy backup must NOT be applied", async () => {
  const adapter = createGranularSupabaseAdapter();
  adapter.send({
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: "case-granular-fresh",
    entityVersion: 1,
    operationId: "op-gran-1",
    action: "upsert",
    payload: { entity: makeCase("case-granular-fresh") },
  });

  const vmInstance = loadSyncVm("check-13");
  vmInstance.context.getSupabaseClient = () => adapter.client;
  vmInstance.run("state.cases = []; state.bookings = []; state.auditLog = [];");

  let legacyCalled = false;
  vmInstance.context.fetchLatestCloudBackup = async () => {
    legacyCalled = true;
    return { value: JSON.stringify({ cases: [makeCase("stale-legacy-case")], bookings: [], auditLog: [] }) };
  };

  const result = await vmInstance.context.pullLatestSupabaseBackup("granular-over-legacy");
  assert.equal(legacyCalled, false, "Legacy backup must NOT be fetched when granular has rows");
  assert.equal(result.legacyAttempted, false);
  assert.equal(result.legacyApplied, false);
  assert.equal(result.initialized, true);
  assert.equal(vmInstance.run("state.cases.length"), 1);
  assert.equal(vmInstance.run("state.cases[0].id"), "case-granular-fresh");
});

// ========================================================================
// 14. Active Probe Fail-Closed: probe returns null => skip, do not certify
// ========================================================================
await check("14 active probe returns null (unknown) => fail-closed, bootstrap NOT certified", async () => {
  const adapter = createGranularSupabaseAdapter();
  adapter.send({
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: "case-probe-fail-14",
    entityVersion: 1,
    operationId: "op-pf-14",
    action: "upsert",
    payload: { entity: makeCase("case-probe-fail-14") },
  });

  const vmInstance = loadSyncVm("check-14");

  const brokenClient = {
    from() {
      return {
        select() {
          return {
            eq() { return this; },
            is() { return this; },
            order() { return this; },
            or() { return this; },
            limit() { return this; },
            maybeSingle() { return Promise.reject(new Error("Network timeout")); },
            then(resolve, reject) { return Promise.reject(new Error("Network timeout")).then(resolve, reject); },
          };
        },
      };
    },
  };

  vmInstance.context.getSupabaseClient = () => brokenClient;

  const bootstrapKey = vmInstance.context.getGranularSyncMetadataKey(WORKSHOP_ID, "bootstrap");
  const caseMetaKey = vmInstance.context.getGranularSyncMetadataKey(WORKSHOP_ID, "case");
  await vmInstance.context.putSyncMetadata(bootstrapKey, { initialized: true });
  await vmInstance.context.putSyncMetadata(caseMetaKey, {
    cursor: { updatedAt: "2026-09-01T08:00:00.000Z", entityId: "case-old" },
    initialized: true,
  });
  vmInstance.run("state.cases = []; state.bookings = []; state.auditLog = [];");

  const result = await vmInstance.context.pullLatestSupabaseBackup("probe-failure-test");
  assert.equal(result.probeUnknown, true, "probeUnknown must be flagged");
  assert.equal(result.initialized, false, "Bootstrap must NOT be certified when probe is unknown");
  assert.equal(result.selfHealed, false, "No self-heal attempted when probe unknown");
  assert.equal(vmInstance.run("state.cases.length"), 0, "State must remain as-is");

  const caseMetaAfter = await vmInstance.context.loadSyncMetadata(caseMetaKey);
  assert.equal(caseMetaAfter.cursor.entityId, "case-old", "Stale cursor must NOT be replaced");
  assert.equal(caseMetaAfter.initialized, true, "Stale case metadata must NOT be overwritten");

  const bootstrapMetaAfter = await vmInstance.context.loadSyncMetadata(bootstrapKey);
  assert.equal(bootstrapMetaAfter.initialized, true, "Bootstrap metadata must NOT be overwritten on probe failure");
});

// ========================================================================
// 15. LocalStorage Fallback Recovery Path
// ========================================================================
await check("15 localStorage fallback: persisted snapshot contains recovered cases", async () => {
  const adapter = createGranularSupabaseAdapter();
  for (let i = 1; i <= 3; i += 1) {
    adapter.send({
      workshopId: WORKSHOP_ID,
      entityType: "case",
      entityId: `case-ls-${i}`,
      entityVersion: 1,
      operationId: `op-ls-${i}`,
      action: "upsert",
      payload: { entity: makeCase(`case-ls-${i}`) },
      updatedAt: `2026-09-01T08:0${i}:00.000Z`,
    });
  }

  const vmInstance = loadSyncVm("check-15");
  vmInstance.context.getSupabaseClient = () => adapter.client;
  vmInstance.context.shouldPersistStateInIndexedDb = () => false;

  const bootstrapKey = vmInstance.context.getGranularSyncMetadataKey(WORKSHOP_ID, "bootstrap");
  const caseMetaKey = vmInstance.context.getGranularSyncMetadataKey(WORKSHOP_ID, "case");
  await vmInstance.context.putSyncMetadata(bootstrapKey, { initialized: true });
  await vmInstance.context.putSyncMetadata(caseMetaKey, {
    cursor: { updatedAt: "2026-09-01T00:00:00.000Z", entityId: "case-old" },
    initialized: true,
  });
  vmInstance.run("state.cases = []; state.bookings = []; state.auditLog = [];");

  await vmInstance.context.pullLatestSupabaseBackup("durable-recovery-ls");
  assert.equal(vmInstance.run("state.cases.length"), 3);

  const storageKey = vmInstance.run("STORAGE_KEY");
  const persisted = vmInstance.localStorage.getItem(storageKey);
  assert.ok(persisted, "localStorage must contain persisted state after recovery");
  const parsed = JSON.parse(persisted);
  assert.ok(!parsed.largeState, "localStorage fallback must contain full state, not largeState marker");
  assert.ok(Array.isArray(parsed.cases), "Persisted state must contain cases array");
  assert.equal(parsed.cases.length, 3, "Persisted localStorage must contain 3 recovered cases");
});

// ========================================================================
// 16. LocalStorage Fallback Reload Hydration
// ========================================================================
await check("16 localStorage fallback reload hydration: recovered cases survive reload via localStorage", async () => {
  const adapter = createGranularSupabaseAdapter();
  for (let i = 1; i <= 2; i += 1) {
    adapter.send({
      workshopId: WORKSHOP_ID,
      entityType: "case",
      entityId: `case-lshyd-${i}`,
      entityVersion: 1,
      operationId: `op-lshyd-${i}`,
      action: "upsert",
      payload: { entity: makeCase(`case-lshyd-${i}`) },
      updatedAt: `2026-09-01T08:0${i}:00.000Z`,
    });
  }

  const vm1 = loadSyncVm("check-16a");
  vm1.context.getSupabaseClient = () => adapter.client;
  vm1.context.shouldPersistStateInIndexedDb = () => false;
  const bootstrapKey = vm1.context.getGranularSyncMetadataKey(WORKSHOP_ID, "bootstrap");
  const caseMetaKey = vm1.context.getGranularSyncMetadataKey(WORKSHOP_ID, "case");
  await vm1.context.putSyncMetadata(bootstrapKey, { initialized: true });
  await vm1.context.putSyncMetadata(caseMetaKey, {
    cursor: { updatedAt: "2026-09-01T00:00:00.000Z", entityId: "old" },
    initialized: true,
  });
  vm1.run("state.cases = []; state.bookings = []; state.auditLog = [];");

  await vm1.context.pullLatestSupabaseBackup("hydration-recovery-ls");
  assert.equal(vm1.run("state.cases.length"), 2);

  const storageKey = vm1.run("STORAGE_KEY");
  const persistedJson = vm1.localStorage.getItem(storageKey);
  assert.ok(persistedJson);

  const vm2 = createNimrVmContext({
    filename: "check-16b-hydrated.js",
    console: { ...console, warn() {}, error() {} },
    localStorage: { [storageKey]: persistedJson },
  });
  vm2.run("state = loadState();");

  const hydratedCases = vm2.run("Array.isArray(state.cases) ? state.cases.length : -1");
  assert.equal(hydratedCases, 2, "Hydrated VM must contain the 2 recovered cases from localStorage");
  assert.equal(vm2.run("state.cases.some(c => c.id === 'case-lshyd-1')"), true);
  assert.equal(vm2.run("state.cases.some(c => c.id === 'case-lshyd-2')"), true);
});

// ========================================================================
// 17. BLOCKER 1: Remote Active + Local Missing + Pending UPSERT
// ========================================================================
await check("17 remote active + local missing + pending UPSERT => entity visible from intent, never silently certified invisible", async () => {
  const adapter = createGranularSupabaseAdapter();
  adapter.send({
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: "case-pending-reconstruct",
    entityVersion: 1,
    operationId: "op-remote-1",
    action: "upsert",
    payload: { entity: makeCase("case-pending-reconstruct", { clientName: "Serveur Ancien" }) },
    updatedAt: "2026-09-01T08:00:00.000Z",
  });

  const vmInstance = loadSyncVm("check-17");
  vmInstance.context.getSupabaseClient = () => adapter.client;

  // Local cache was lost / empty
  vmInstance.run("state.cases = []; state.bookings = []; state.auditLog = [];");

  // Valid durable pending operation in outbox
  const localCase = makeCase("case-pending-reconstruct", { clientName: "Client Intent Récent" });
  vmInstance.context.loadDurableOutboxOperations = async () => [{
    operationId: "op-local-pending-17",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: "case-pending-reconstruct",
    baseVersion: 1,
    action: "upsert",
    syncStatus: "pending",
    payload: { entity: localCase },
  }];

  const row = adapter.canonical(WORKSHOP_ID, "case", "case-pending-reconstruct");
  const outcome = await vmInstance.context.NIMR_GRANULAR_SYNC_TEST_API.applyRemoteEntityRow(row);
  assert.equal(outcome.applied, true, "Pending intent must be materialized");
  assert.equal(outcome.accounted, true);
  assert.equal(outcome.status, "pending_local_intent_materialized");
  assert.equal(vmInstance.run("state.cases.length"), 1, "Entity must become visible in local state");
  assert.equal(vmInstance.run("state.cases[0].clientName"), "Client Intent Récent", "Local pending intent preserved");

  // Now test invalid/unreconstructible schema: bootstrap must FAIL closed
  vmInstance.run("state.cases = [];");
  vmInstance.context.loadDurableOutboxOperations = async () => [{
    operationId: "op-corrupted-17",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: "case-pending-reconstruct",
    baseVersion: 1,
    action: "upsert",
    syncStatus: "pending",
    payload: null, // Corrupted payload
  }];
  const badOutcome = await vmInstance.context.NIMR_GRANULAR_SYNC_TEST_API.applyRemoteEntityRow(row);
  assert.equal(badOutcome.accounted, false, "Corrupted intent must NOT be safely accounted");
  assert.equal(badOutcome.status, "unaccounted");
});

// ========================================================================
// 18. BLOCKER 1: Remote Active + Local Missing + Pending DELETE
// ========================================================================
await check("18 remote active + local missing + pending DELETE => absence is intentional and safely accounted", async () => {
  const adapter = createGranularSupabaseAdapter();
  adapter.send({
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: "case-pending-delete",
    entityVersion: 1,
    operationId: "op-remote-del",
    action: "upsert",
    payload: { entity: makeCase("case-pending-delete") },
  });

  const vmInstance = loadSyncVm("check-18");
  vmInstance.context.getSupabaseClient = () => adapter.client;
  vmInstance.run("state.cases = []; state.bookings = []; state.auditLog = [];");

  // Pending delete in outbox
  vmInstance.context.loadDurableOutboxOperations = async () => [{
    operationId: "op-local-del-18",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: "case-pending-delete",
    baseVersion: 1,
    action: "delete",
    syncStatus: "pending",
    payload: { entityId: "case-pending-delete" },
  }];

  const row = adapter.canonical(WORKSHOP_ID, "case", "case-pending-delete");
  const outcome = await vmInstance.context.NIMR_GRANULAR_SYNC_TEST_API.applyRemoteEntityRow(row);
  assert.equal(outcome.accounted, true, "Pending delete absence must be safely accounted");
  assert.equal(outcome.status, "pending_local_intent_preserved");
  assert.equal(outcome.deleted, true);
  assert.equal(vmInstance.run("state.cases.length"), 0, "Deleted case remains absent locally");
});

// ========================================================================
// 19. BLOCKER 1: 5 Remote Cases, 1 Pending UPSERT, Local Cache Empty => All 5 Visible
// ========================================================================
await check("19 recovery with 5 remote cases and 1 pending UPSERT materializes all 5 visible cases", async () => {
  const adapter = createGranularSupabaseAdapter();
  for (let i = 1; i <= 5; i += 1) {
    adapter.send({
      workshopId: WORKSHOP_ID,
      entityType: "case",
      entityId: `case-batch-${i}`,
      entityVersion: 1,
      operationId: `op-srv-${i}`,
      action: "upsert",
      payload: { entity: makeCase(`case-batch-${i}`, { clientName: `Serveur ${i}` }) },
      updatedAt: `2026-09-01T08:0${i}:00.000Z`,
    });
  }

  const vmInstance = loadSyncVm("check-19");
  vmInstance.context.getSupabaseClient = () => adapter.client;

  // Stale browser state with empty local cache
  const bootstrapKey = vmInstance.context.getGranularSyncMetadataKey(WORKSHOP_ID, "bootstrap");
  const caseMetaKey = vmInstance.context.getGranularSyncMetadataKey(WORKSHOP_ID, "case");
  await vmInstance.context.putSyncMetadata(bootstrapKey, { initialized: true });
  await vmInstance.context.putSyncMetadata(caseMetaKey, {
    cursor: { updatedAt: "2026-09-01T08:05:00.000Z", entityId: "case-batch-5" },
    initialized: true,
  });
  vmInstance.run("state.cases = []; state.bookings = []; state.auditLog = [];");

  // Case 3 has pending local outbox UPSERT
  const localCase3 = makeCase("case-batch-3", { clientName: "Local Edit Pending Outbox" });
  vmInstance.context.loadDurableOutboxOperations = async () => [{
    operationId: "op-pending-case-3",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: "case-batch-3",
    baseVersion: 1,
    action: "upsert",
    syncStatus: "pending",
    payload: { entity: localCase3 },
  }];

  const result = await vmInstance.context.pullLatestSupabaseBackup("five-cases-outbox-recovery");
  assert.equal(result.selfHealed, true, "Self-heal must trigger");
  assert.equal(result.initialized, true, "Bootstrap must certify");
  assert.equal(vmInstance.run("state.cases.length"), 5, "All 5 cases must be visible locally");

  const case3 = vmInstance.run("state.cases.find(c => c.id === 'case-batch-3')");
  assert.equal(case3.clientName, "Local Edit Pending Outbox", "Pending local outbox edit must be preserved");

  for (let i of [1, 2, 4, 5]) {
    const c = vmInstance.run(`state.cases.find(c => c.id === 'case-batch-${i}')`);
    assert.equal(c.clientName, `Serveur ${i}`, `Remote case ${i} must be materialized from server`);
  }
});

// ========================================================================
// 20. BLOCKER 2: REAL IndexedDB Persistence Write & Readback
// ========================================================================
await check("20 REAL IndexedDB persistence write and readback via loadLargeStateSnapshot", async () => {
  const adapter = createGranularSupabaseAdapter();
  for (let i = 1; i <= 4; i += 1) {
    adapter.send({
      workshopId: WORKSHOP_ID,
      entityType: "case",
      entityId: `case-real-idb-${i}`,
      entityVersion: 1,
      operationId: `op-idb-${i}`,
      action: "upsert",
      payload: { entity: makeCase(`case-real-idb-${i}`) },
      updatedAt: `2026-09-01T08:0${i}:00.000Z`,
    });
  }

  const vmInstance = loadSyncVm("check-20");
  const memoryIdb = createMemoryIndexedDb();
  vmInstance.context.indexedDB = memoryIdb;
  vmInstance.context.getSupabaseClient = () => adapter.client;

  // Verify shouldPersistStateInIndexedDb is NOT disabled and evaluates true
  const usesIdb = vmInstance.run("shouldPersistStateInIndexedDb(state)");
  assert.equal(usesIdb, true, "Must use real IndexedDB persistence path");

  const bootstrapKey = vmInstance.context.getGranularSyncMetadataKey(WORKSHOP_ID, "bootstrap");
  const caseMetaKey = vmInstance.context.getGranularSyncMetadataKey(WORKSHOP_ID, "case");
  await vmInstance.context.putSyncMetadata(bootstrapKey, { initialized: true });
  await vmInstance.context.putSyncMetadata(caseMetaKey, {
    cursor: { updatedAt: "2026-09-01T00:00:00.000Z", entityId: "old" },
    initialized: true,
  });
  vmInstance.run("state.cases = []; state.bookings = []; state.auditLog = [];");

  const result = await vmInstance.context.pullLatestSupabaseBackup("real-idb-recovery");
  assert.equal(result.selfHealed, true);
  assert.equal(result.initialized, true);

  // Read back directly from IndexedDB via loadLargeStateSnapshot (not state memory!)
  const idbSnapshot = await vmInstance.context.loadLargeStateSnapshot();
  assert.ok(idbSnapshot, "IndexedDB snapshot must exist");
  assert.ok(idbSnapshot.state, "IndexedDB snapshot state must exist");
  assert.equal(idbSnapshot.state.cases.length, 4, "IndexedDB backing store must contain 4 recovered cases");

  const idbCaseIds = idbSnapshot.state.cases.map((c) => c.id).sort();
  assert.deepEqual(idbCaseIds, [
    "case-real-idb-1",
    "case-real-idb-2",
    "case-real-idb-3",
    "case-real-idb-4",
  ], "Recovered case IDs in IndexedDB must match remote canonical cases");
});

// ========================================================================
// 21. BLOCKER 2: REAL IndexedDB Reload / Hydration via hydrateLargeStateIfAvailable
// ========================================================================
await check("21 REAL IndexedDB reload hydration via hydrateLargeStateIfAvailable", async () => {
  const adapter = createGranularSupabaseAdapter();
  for (let i = 1; i <= 3; i += 1) {
    adapter.send({
      workshopId: WORKSHOP_ID,
      entityType: "case",
      entityId: `case-idb-hyd-${i}`,
      entityVersion: 1,
      operationId: `op-idb-hyd-${i}`,
      action: "upsert",
      payload: { entity: makeCase(`case-idb-hyd-${i}`, { clientName: `Client IDB ${i}` }) },
      updatedAt: `2026-09-01T08:0${i}:00.000Z`,
    });
  }

  // --- Phase 1: Self-heal into IndexedDB ---
  const sharedIdb = createMemoryIndexedDb();
  const vm1 = loadSyncVm("check-21a");
  vm1.context.indexedDB = sharedIdb;
  vm1.context.getSupabaseClient = () => adapter.client;

  const bootstrapKey = vm1.context.getGranularSyncMetadataKey(WORKSHOP_ID, "bootstrap");
  const caseMetaKey = vm1.context.getGranularSyncMetadataKey(WORKSHOP_ID, "case");
  await vm1.context.putSyncMetadata(bootstrapKey, { initialized: true });
  await vm1.context.putSyncMetadata(caseMetaKey, {
    cursor: { updatedAt: "2026-09-01T00:00:00.000Z", entityId: "old" },
    initialized: true,
  });
  vm1.run("state.cases = []; state.bookings = []; state.auditLog = [];");

  await vm1.context.pullLatestSupabaseBackup("real-idb-hydration-setup");
  assert.equal(vm1.run("state.cases.length"), 3);

  // --- Phase 2: Fresh VM context connected to same IndexedDB ---
  const vm2 = loadSyncVm("check-21b");
  vm2.context.indexedDB = sharedIdb;

  // Before hydration, vm2 has default/empty state
  assert.equal(vm2.run("state.cases.length"), 0);

  // Execute the REAL hydrateLargeStateIfAvailable path
  const hydrationOutcome = await vm2.context.hydrateLargeStateIfAvailable();
  assert.equal(hydrationOutcome.hydrated, true, "hydrateLargeStateIfAvailable must succeed");

  // Verify all 3 cases are fully hydrated into vm2 state.cases
  const hydratedCases = vm2.run("state.cases");
  assert.equal(hydratedCases.length, 3, "All 3 cases must be hydrated into memory from IndexedDB");
  assert.equal(hydratedCases[0].id, "case-idb-hyd-1");
  assert.equal(hydratedCases[1].id, "case-idb-hyd-2");
  assert.equal(hydratedCases[2].id, "case-idb-hyd-3");
});

// ========================================================================
// TOTAL CHECK
// ========================================================================
const TOTAL = 21;
assert.equal(passed.length + failures.length, TOTAL, `SYNC-001 regression suite must contain checks 1-${TOTAL}`);

if (failures.length) {
  console.error(`\nSYNC-001 REGRESSION SUITE: ${passed.length}/${TOTAL} CHECKS PASSED (${failures.length} FAILED)`);
  process.exitCode = 1;
} else {
  console.log(`\nSYNC-001 REGRESSION SUITE: ${TOTAL}/${TOTAL} CHECKS PASSED`);
}
