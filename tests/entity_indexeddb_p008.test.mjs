import assert from "node:assert/strict";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createMemoryIndexedDb() {
  const databases = new Map();
  let failNextTransaction = false;
  let failNextWriteTransaction = false;
  let delayNextTransactionMs = 0;

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
        const shouldFail = failNextTransaction || (failNextWriteTransaction && mode === "readwrite");
        const completionDelay = delayNextTransactionMs;
        failNextTransaction = false;
        if (mode === "readwrite") failNextWriteTransaction = false;
        delayNextTransactionMs = 0;
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
            if (!definition || !entries) throw new Error(`Store not in transaction: ${storeName}`);
            const request = (operation) => {
              const result = {};
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
                return request(() => {
                  const copy = clone(value);
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
            if (shouldFail) failed = new Error("Injected transaction failure");
            if (failed) {
              transaction.error = failed;
              transaction.onerror?.();
              return;
            }
            working.forEach((entries, storeName) => {
              stores.get(storeName).entries = entries;
            });
            transaction.oncomplete?.();
          }, completionDelay);
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
    failNextTransaction() { failNextTransaction = true; },
    failNextWriteTransaction() { failNextWriteTransaction = true; },
    delayNextTransaction(milliseconds) { delayNextTransactionMs = milliseconds; },
    open(name, version) {
      const request = {};
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

const vm = createNimrVmContext({ filename: "entity-indexeddb-p008-contract.js" });
const memoryIndexedDb = createMemoryIndexedDb();
vm.context.indexedDB = memoryIndexedDb;

const persisted = {
  schemaVersion: 7,
  dataSchemaVersion: 4,
  currentUserId: "user-1",
  users: [{ id: "user-1", name: "Admin", role: "admin", active: true }],
  resources: [{ id: "resource-1", name: "Tôlier", role: "tolier", active: true }],
  settings: { calendar: { 1: "08:00-17:00" }, custom: true },
  ui: { activeTab: "planning", customFilter: "open" },
  syncLog: [{ at: "2026-08-22T00:00:00.000Z", status: "ok" }],
  forwardCompatibleRoot: { retained: true },
  cases: [{
    id: "case-1",
    vin: "VIN-1",
    plate: "123 TU 4567",
    orNavNumber: "OR-1",
    flags: { received: true, workStarted: true },
    history: [{ type: "case.created", at: "2026-08-20T08:00:00.000Z" }],
    claims: [{ id: "claim-1", status: "approved", extra: { retained: true } }],
    receptionWorkflow: { planningCycles: 2, customerDecision: "approved" },
    arbitrarySupportedField: { nested: [1, 2, 3] },
  }],
  bookings: [{
    id: "booking-1",
    caseId: "case-1",
    resourceIds: ["resource-1"],
    start: "2026-08-23T08:00:00.000Z",
    end: "2026-08-25T10:00:00.000Z",
    segments: [{ start: "2026-08-23T08:00:00.000Z", end: "2026-08-25T10:00:00.000Z" }],
    temporary: true,
    arbitraryBookingField: { retained: true },
  }],
  auditLog: [
    { at: "2026-08-22T08:00:00.000Z", type: "first", details: "A" },
    { id: "audit-2", at: "2026-08-22T09:00:00.000Z", type: "second", details: "B" },
  ],
};
vm.context.__p008State = persisted;

await vm.run("persistLargeStateSnapshot(__p008State, { reason: 'characterization' })");
const loaded = await vm.run("loadLargeStateSnapshot()");
const loadedState = JSON.parse(JSON.stringify(loaded.state));
assert.deepEqual(loadedState, persisted, "save then load preserves the complete observable state shape");
assert.deepEqual(loadedState.cases[0], persisted.cases[0], "case nested and arbitrary fields survive");
assert.deepEqual(loadedState.bookings[0], persisted.bookings[0], "booking segments, temporary flag, and arbitrary fields survive");
assert.deepEqual(loadedState.auditLog, persisted.auditLog, "audit order and content survive");
assert.deepEqual(loadedState.forwardCompatibleRoot, { retained: true }, "unknown top-level fields survive");

const database = memoryIndexedDb.databases.get("nimr-sav-large-state");
const entries = (storeName) => database.stores.get(storeName).entries;
assert.equal(database.version, 3, "database upgrades from v2 to v3");
assert.deepEqual(
  [...database.stores.keys()].sort(),
  ["audit_log", "bookings", "cases", "outbox", "snapshots", "state_meta", "sync_metadata"].sort(),
  "v3 adds entity stores without deleting legacy/outbox/sync stores",
);
const firstMeta = entries("state_meta").get("latest");
assert.equal(firstMeta.format, "nimr-sav-entity-state");
assert.equal(firstMeta.formatVersion, 1);
assert.equal(Object.hasOwn(firstMeta.root, "cases"), false);
assert.equal(Object.hasOwn(firstMeta.root, "bookings"), false);
assert.equal(Object.hasOwn(firstMeta.root, "auditLog"), false);
assert.equal(entries("cases").size, 1);
assert.equal(entries("bookings").size, 1);
assert.equal(entries("audit_log").size, 2);
assert.deepEqual(Object.keys(entries("cases").get("case-1")).sort(), ["id", "order", "value"]);
assert.equal(Object.hasOwn(loadedState.cases[0], "order"), false, "case storage metadata does not leak into state");
assert.equal(Object.hasOwn(loadedState.bookings[0], "order"), false, "booking storage metadata does not leak into state");
assert.equal(Object.hasOwn(loadedState.auditLog[0], "order"), false, "audit storage metadata does not leak into state");

vm.context.__p008Empty = { ...persisted, cases: [], bookings: [], auditLog: [] };
await vm.run("persistLargeStateSnapshot(__p008Empty, { reason: 'empty-characterization', forceFull: true })");
const emptyLoaded = await vm.run("loadLargeStateSnapshot()");
assert.deepEqual(JSON.parse(JSON.stringify(emptyLoaded.state.cases)), []);
assert.deepEqual(JSON.parse(JSON.stringify(emptyLoaded.state.bookings)), []);
assert.deepEqual(JSON.parse(JSON.stringify(emptyLoaded.state.auditLog)), []);
await vm.run("persistLargeStateSnapshot(__p008State, { reason: 'restore-characterization', forceFull: true })");

const stateBeforePersistenceReads = JSON.stringify(persisted);
await vm.run("loadLargeStateSnapshot()");
assert.equal(JSON.stringify(persisted), stateBeforePersistenceReads, "entity persistence reads do not mutate state");

const originalStringify = vm.run("JSON.stringify");
vm.context.__p008GuardedState = persisted;
vm.context.__p008OriginalStringify = originalStringify;
vm.run(`JSON.stringify = function(value, ...args) {
  if (value === __p008GuardedState) throw new Error("FULL_STATE_STRINGIFY_FORBIDDEN");
  return __p008OriginalStringify(value, ...args);
}`);
await vm.run("persistLargeStateSnapshot(__p008GuardedState, { reason: 'no-full-json-guard' })");
vm.run("JSON.stringify = __p008OriginalStringify");

persisted.cases[0].vin = "VIN-UPDATED";
vm.run("markEntityCaseDirty('case-1')");
await vm.run("persistLargeStateSnapshot(__p008State, { reason: 'one-case' })");
let stats = vm.run("getEntityPersistenceStats()");
assert.equal(stats.caseWrites, 1);
assert.equal(stats.bookingWrites, 0);
assert.equal((await vm.run("loadLargeStateSnapshot()")).state.cases[0].vin, "VIN-UPDATED");

persisted.bookings[0].resourceIds = ["resource-2"];
vm.context.__p008DirtyBooking = persisted.bookings[0];
vm.run("markEntityBookingDirty(__p008DirtyBooking)");
await vm.run("persistLargeStateSnapshot(__p008State, { reason: 'one-booking' })");
stats = vm.run("getEntityPersistenceStats()");
assert.equal(stats.caseWrites, 0);
assert.equal(stats.bookingWrites, 1);
assert.deepEqual(JSON.parse(JSON.stringify((await vm.run("loadLargeStateSnapshot()")).state.bookings[0].resourceIds)), ["resource-2"]);

persisted.cases.push({ id: "case-added", vin: "DUPLICATE-VIN", plate: "DUP" });
await vm.run("persistLargeStateSnapshot(__p008State, { reason: 'add-case' })");
stats = vm.run("getEntityPersistenceStats()");
assert.equal(stats.caseWrites, 1);
assert.equal(entries("cases").size, 2);
persisted.cases.splice(1, 1);
await vm.run("persistLargeStateSnapshot(__p008State, { reason: 'delete-case' })");
stats = vm.run("getEntityPersistenceStats()");
assert.equal(stats.caseDeletes, 1);
assert.equal((await vm.run("loadLargeStateSnapshot()")).state.cases.some((item) => item.id === "case-added"), false);

persisted.bookings.push({ id: "booking-added", caseId: "case-1", resourceIds: [], start: "2026-09-01", end: "2026-09-02", segments: [] });
await vm.run("persistLargeStateSnapshot(__p008State, { reason: 'add-booking' })");
stats = vm.run("getEntityPersistenceStats()");
assert.equal(stats.bookingWrites, 1);
persisted.bookings.splice(1, 1);
await vm.run("persistLargeStateSnapshot(__p008State, { reason: 'delete-booking' })");
stats = vm.run("getEntityPersistenceStats()");
assert.equal(stats.bookingDeletes, 1);
assert.equal((await vm.run("loadLargeStateSnapshot()")).state.bookings.some((item) => item.id === "booking-added"), false);

const appendedAudit = { at: "2026-08-22T10:00:00.000Z", type: "third", details: "C" };
persisted.auditLog.unshift(appendedAudit);
vm.context.__p008Audit = appendedAudit;
vm.run("markEntityAuditEntryDirty(__p008Audit)");
await vm.run("persistLargeStateSnapshot(__p008State, { reason: 'append-audit' })");
stats = vm.run("getEntityPersistenceStats()");
assert.equal(stats.auditWrites, 1);
assert.deepEqual(
  JSON.parse(JSON.stringify((await vm.run("loadLargeStateSnapshot()")).state.auditLog.map((entry) => entry.type))),
  ["third", "first", "second"],
  "audit append preserves exact order",
);

persisted.settings.rootOnlyChange = "saved";
await vm.run("persistLargeStateSnapshot(__p008State, { reason: 'root-only' })");
stats = vm.run("getEntityPersistenceStats()");
assert.deepEqual(
  { rootWrites: stats.rootWrites, caseWrites: stats.caseWrites, bookingWrites: stats.bookingWrites, auditWrites: stats.auditWrites },
  { rootWrites: 1, caseWrites: 0, bookingWrites: 0, auditWrites: 0 },
);
assert.equal((await vm.run("loadLargeStateSnapshot()")).state.settings.rootOnlyChange, "saved");
await vm.run("persistLargeStateSnapshot(__p008State, { reason: 'no-change' })");
stats = vm.run("getEntityPersistenceStats()");
assert.equal(stats.caseWrites, 0);
assert.equal(stats.bookingWrites, 0);

const medium = {
  ...persisted,
  cases: Array.from({ length: 100 }, (_, index) => ({ id: `medium-case-${index}`, vin: index < 2 ? "DUPLICATE-VIN" : `VIN-${index}`, nested: { index } })),
  bookings: Array.from({ length: 300 }, (_, index) => ({
    id: `medium-booking-${index}`,
    caseId: `medium-case-${index % 100}`,
    resourceIds: [`resource-${index % 4}`],
    start: "2026-08-23T08:00:00.000Z",
    end: "2026-08-23T10:00:00.000Z",
    segments: [{ start: "2026-08-23T08:00:00.000Z", end: "2026-08-23T10:00:00.000Z" }],
  })),
  auditLog: Array.from({ length: 20 }, (_, index) => ({ id: `audit-${index}`, at: `2026-08-22T${String(index).padStart(2, "0")}:00:00.000Z`, type: "medium" })),
};
vm.context.__p008Medium = medium;
await vm.run("persistLargeStateSnapshot(__p008Medium, { reason: 'medium-full', forceFull: true })");
const mediumLoaded = await vm.run("loadLargeStateSnapshot()");
assert.equal(mediumLoaded.state.cases.length, 100);
assert.equal(mediumLoaded.state.bookings.length, 300);
assert.equal(mediumLoaded.state.auditLog.length, 20);
assert.deepEqual(JSON.parse(JSON.stringify(mediumLoaded.state.cases[50])), medium.cases[50]);

const smaller = { ...persisted, cases: [{ id: "smaller-case", vin: "SMALL" }], bookings: [], auditLog: [] };
vm.context.__p008Smaller = smaller;
await vm.run("persistLargeStateSnapshot(__p008Smaller, { reason: 'full-replacement', forceFull: true })");
assert.equal(entries("cases").size, 1, "full replacement removes orphan cases");
assert.equal(entries("bookings").size, 0, "full replacement removes orphan bookings");
assert.equal(entries("audit_log").size, 0, "full replacement removes orphan audit rows");

smaller.cases[0].vin = "FAILED-WRITE";
vm.run("markEntityCaseDirty('smaller-case')");
memoryIndexedDb.failNextWriteTransaction();
await assert.rejects(vm.run("persistLargeStateSnapshot(__p008Smaller, { reason: 'injected-failure' })"), /Injected transaction failure/);
assert.equal((await vm.run("loadLargeStateSnapshot()")).state.cases[0].vin, "SMALL", "failed transaction leaves previous committed state intact");
smaller.cases[0].vin = "RETRIED-WRITE";
await vm.run("persistLargeStateSnapshot(__p008Smaller, { reason: 'retry-after-failure' })");
assert.equal((await vm.run("loadLargeStateSnapshot()")).state.cases[0].vin, "RETRIED-WRITE");

const rapidA = { ...smaller, cases: [{ id: "rapid", vin: "A" }], bookings: [], auditLog: [] };
const rapidB = { ...smaller, cases: [{ id: "rapid", vin: "B" }], bookings: [], auditLog: [] };
vm.context.__p008RapidA = rapidA;
vm.context.__p008RapidB = rapidB;
memoryIndexedDb.delayNextTransaction(30);
const saveA = vm.run("persistLargeStateSnapshot(__p008RapidA, { reason: 'rapid-a', forceFull: true })");
const saveB = vm.run("persistLargeStateSnapshot(__p008RapidB, { reason: 'rapid-b', forceFull: true })");
await Promise.all([saveA, saveB]);
assert.equal((await vm.run("loadLargeStateSnapshot()")).state.cases[0].vin, "B", "serialized queue leaves the newer rapid save durable");

await vm.run("runIndexedDbTransaction('outbox', 'readwrite', (store) => store.put({ operationId: 'keep-outbox', syncStatus: 'pending', createdAt: '2026-08-22' }))");
await vm.run("runIndexedDbTransaction('sync_metadata', 'readwrite', (store) => store.put({ key: 'keep-sync', value: true }))");
await vm.run("removeLargeStateSnapshot()");
assert.equal(await vm.run("loadLargeStateSnapshot()"), null, "remove deletes persisted application state");
assert.equal(entries("outbox").size, 1, "entity reset preserves durable outbox");
assert.equal(entries("sync_metadata").size, 1, "entity reset preserves sync metadata");

vm.context.__p008Legacy = persisted;
await vm.run("runLargeStateTransaction('readwrite', (store) => store.put({ id: LARGE_STATE_KEY, savedAt: 'legacy-state', state: __p008Legacy }))");
const migratedLegacyState = await vm.run("loadLargeStateSnapshot()");
assert.deepEqual(JSON.parse(JSON.stringify(migratedLegacyState.state)), persisted, "legacy v2 record.state remains readable and migrates");
assert.equal(migratedLegacyState.migratedFromLegacy, true);
assert.equal(entries("snapshots").has("latest"), true, "verified migration retains the legacy source");
const secondLegacyLoad = await vm.run("loadLargeStateSnapshot()");
assert.equal(secondLegacyLoad.migratedFromLegacy, undefined, "migration is idempotent after entity metadata activates");
assert.equal(entries("cases").size, persisted.cases.length, "idempotent reload does not duplicate cases");

await vm.run("removeLargeStateSnapshot()");
await vm.run("runLargeStateTransaction('readwrite', (store) => store.put({ id: LARGE_STATE_KEY, savedAt: 'legacy-json', stateJson: JSON.stringify(__p008Legacy) }))");
const migratedLegacyJson = await vm.run("loadLargeStateSnapshot()");
assert.deepEqual(JSON.parse(JSON.stringify(migratedLegacyJson.state)), persisted, "legacy v2 record.stateJson remains readable and migrates");

await vm.run("removeLargeStateSnapshot()");
await vm.run("runLargeStateTransaction('readwrite', (store) => store.put({ id: LARGE_STATE_KEY, savedAt: 'legacy-failure', state: __p008Legacy }))");
memoryIndexedDb.failNextWriteTransaction();
const failedMigration = await vm.run("loadLargeStateSnapshot()");
assert.equal(failedMigration.migrationFailed, true);
assert.deepEqual(JSON.parse(JSON.stringify(failedMigration.state)), persisted, "failed migration still returns the recoverable legacy state");
assert.equal(entries("snapshots").has("latest"), true, "failed migration never destroys its legacy source");
assert.equal(entries("state_meta").size, 0, "failed migration does not claim an active entity state");

const appState = {
  ...persisted,
  cases: [{ id: "save-state-case", vin: "SAVE-A" }],
  bookings: [{ id: "save-state-booking", caseId: "save-state-case", resourceIds: ["resource-1"], start: "2026-08-23T08:00:00.000Z", end: "2026-08-23T09:00:00.000Z", segments: [] }],
  auditLog: [],
};
vm.context.__p008AppState = appState;
await vm.run("state = __p008AppState; initializeLastKnownCasesComparable(); markEntityStateFullReplacement(); saveState({ skipCloud: true, skipSnapshot: true })");
let marker = JSON.parse(vm.localStorage.getItem("nimr-carrosserie-v1"));
assert.equal(marker.entityState, true);
assert.equal(marker.formatVersion, 1);
assert.equal(Object.hasOwn(marker, "cases"), false, "large-state marker stays compact");
vm.run("state.cases[0].vin = 'SAVE-B'");
await vm.run("saveState({ skipCloud: true, skipSnapshot: true })");
stats = vm.run("getEntityPersistenceStats()");
assert.equal(stats.caseWrites, 1, "central save detects and persists one in-place case edit");
vm.run("state.bookings[0].start = '2026-08-24T08:00:00.000Z'; markEntityBookingDirty(state.bookings[0])");
await vm.run("saveState({ skipCloud: true, skipSnapshot: true })");
stats = vm.run("getEntityPersistenceStats()");
assert.equal(stats.bookingWrites, 1, "tracked in-place booking edit writes one booking");

const envelope = vm.run("buildAutosaveEnvelope()");
vm.context.__p008Envelope = envelope;
assert.equal(vm.run("__p008Envelope.state === state"), true, "backup/autosave envelope keeps the application state shape");
assert.equal(Object.hasOwn(envelope.state, "uiRuntimeIndexes"), false, "P0-007 runtime indexes never enter persisted state");

console.log("P0-008 ENTITY INDEXEDDB CHARACTERIZATION OK");
