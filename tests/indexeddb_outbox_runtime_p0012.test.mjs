import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

class BrowserLikeIDBRequest {
  constructor() {
    this._result = undefined;
    this.error = null;
    this.readyState = "pending";
    this.onsuccess = null;
    this.onerror = null;
  }

  get result() {
    return this._result;
  }
}

Object.defineProperty(BrowserLikeIDBRequest.prototype, Symbol.toStringTag, {
  configurable: true,
  value: "IDBRequest",
});

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createBrowserLikeIndexedDb() {
  const databases = new Map();
  const metrics = { clearCalls: 0, deleteCalls: 0, opens: 0 };
  let failNextRequest = false;
  let failNextTransaction = false;

  function makeRequest() {
    const request = new BrowserLikeIDBRequest();
    assert.equal(Object.hasOwn(request, "result"), false, "le mock doit reproduire l'accessor Web IDL hérité");
    assert.equal("result" in request, true);
    return request;
  }

  function createDatabase(name, version) {
    const definitions = new Map();
    const database = {
      name,
      version,
      objectStoreNames: { contains: (storeName) => definitions.has(storeName) },
      createObjectStore(storeName, options = {}) {
        const definition = { entries: new Map(), keyPath: options.keyPath || null, indexes: new Map() };
        definitions.set(storeName, definition);
        return {
          createIndex(indexName, keyPath, indexOptions = {}) {
            definition.indexes.set(indexName, { keyPath, ...indexOptions });
          },
        };
      },
      transaction(storeNames, mode) {
        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        const working = new Map(names.map((storeName) => {
          const definition = definitions.get(storeName);
          if (!definition) throw new Error(`Missing object store: ${storeName}`);
          return [storeName, new Map([...definition.entries].map(([key, value]) => [key, clone(value)]))];
        }));
        let pending = 0;
        let completionScheduled = false;
        let failure = null;
        const transaction = {
          mode,
          error: null,
          oncomplete: null,
          onerror: null,
          onabort: null,
          objectStore(storeName) {
            const definition = definitions.get(storeName);
            const entries = working.get(storeName);
            if (!definition || !entries) throw new Error(`Store not in transaction: ${storeName}`);
            const requestFor = (operation) => {
              const request = makeRequest();
              pending += 1;
              queueMicrotask(() => {
                try {
                  if (failNextRequest) {
                    failNextRequest = false;
                    throw new Error("Injected IDBRequest failure");
                  }
                  request._result = operation();
                  request.readyState = "done";
                  request.onsuccess?.({ target: request });
                } catch (error) {
                  request.error = error;
                  request.readyState = "done";
                  failure = error;
                  request.onerror?.({ target: request });
                } finally {
                  pending -= 1;
                  scheduleCompletion();
                }
              });
              return request;
            };
            const store = {
              put(value) {
                const copy = clone(value);
                return requestFor(() => {
                  const key = definition.keyPath ? copy[definition.keyPath] : undefined;
                  if (key === undefined || key === null || key === "") throw new Error(`Missing keyPath ${definition.keyPath}`);
                  entries.set(key, copy);
                  return key;
                });
              },
              get(key) { return requestFor(() => clone(entries.get(key))); },
              getAll() { return requestFor(() => [...entries.values()].map(clone)); },
              delete(key) {
                metrics.deleteCalls += 1;
                return requestFor(() => entries.delete(key));
              },
              clear() {
                metrics.clearCalls += 1;
                return requestFor(() => entries.clear());
              },
              index(indexName) {
                const indexDefinition = definition.indexes.get(indexName);
                if (!indexDefinition) throw new Error(`Missing index: ${indexName}`);
                const matching = (key) => [...entries.values()].filter((entry) => entry[indexDefinition.keyPath] === key);
                return {
                  get(key) { return requestFor(() => clone(matching(key)[0])); },
                  getAll(key) { return requestFor(() => matching(key).map(clone)); },
                };
              },
            };
            return store;
          },
          abort() {
            failure = new Error("Transaction aborted");
            transaction.error = failure;
            scheduleCompletion();
          },
        };

        function scheduleCompletion() {
          if (completionScheduled || pending > 0) return;
          completionScheduled = true;
          setTimeout(() => {
            if (failNextTransaction) {
              failNextTransaction = false;
              failure = new Error("Injected IndexedDB transaction failure");
            }
            if (failure) {
              transaction.error = failure;
              transaction.onerror?.({ target: transaction });
              return;
            }
            working.forEach((entries, storeName) => {
              definitions.get(storeName).entries = entries;
            });
            transaction.oncomplete?.({ target: transaction });
          }, 0);
        }

        setTimeout(scheduleCompletion, 0);
        return transaction;
      },
      close() {},
      inspect(storeName) {
        return [...(definitions.get(storeName)?.entries.values() || [])].map(clone);
      },
    };
    databases.set(name, database);
    return database;
  }

  return {
    databases,
    metrics,
    failNextRequest() { failNextRequest = true; },
    failNextTransaction() { failNextTransaction = true; },
    open(name, version) {
      metrics.opens += 1;
      const request = makeRequest();
      setTimeout(() => {
        let database = databases.get(name);
        const needsUpgrade = !database || Number(version) > Number(database.version || 0);
        if (!database) database = createDatabase(name, version);
        if (needsUpgrade) {
          database.version = version;
          request._result = database;
          request.onupgradeneeded?.({ target: request });
        }
        request._result = database;
        request.readyState = "done";
        request.onsuccess?.({ target: request });
      }, 0);
      return request;
    },
  };
}

const fixture = createNimrVmContext({
  filename: "indexeddb-outbox-runtime-p0012.js",
  scriptFiles: ["../../js/storage.js"],
});
const indexedDb = createBrowserLikeIndexedDb();
fixture.context.IDBRequest = BrowserLikeIDBRequest;
fixture.context.indexedDB = indexedDb;
fixture.context.state = { currentUserId: "user-p0012" };

const inheritedRequest = new BrowserLikeIDBRequest();
assert.equal(Object.hasOwn(inheritedRequest, "result"), false);
assert.equal("result" in inheritedRequest, true);
assert.equal(Object.getOwnPropertyDescriptor(BrowserLikeIDBRequest.prototype, "result")?.get instanceof Function, true);

const operation = {
  operationId: "op-existing-outbox",
  idempotencyKey: "op-existing-outbox",
  workshopId: "00000000-0000-0000-0000-000000000001",
  entityType: "case",
  entityId: "case-existing",
  action: "upsert",
  baseVersion: 0,
  expectedVersion: 0,
  entityVersion: null,
  syncStatus: "pending",
  payload: {
    entity: {
      id: "case-existing",
      clientName: "Client durable existant",
      orNavNumber: "OR-IDB-001",
    },
  },
  createdAt: "2026-08-27T12:00:00.000Z",
  updatedAt: "2026-08-27T12:00:00.000Z",
};

// A/F: write requests resolve to request.result after transaction completion.
assert.equal(
  await fixture.context.runIndexedDbTransaction("outbox", "readwrite", (store) => store.put(operation)),
  operation.operationId,
);

// A/E: browser-like getAll() resolves to the inherited request.result Array.
const directAll = await fixture.context.runIndexedDbTransaction("outbox", "readonly", (store) => store.getAll());
assert.equal(Array.isArray(directAll), true);
assert.equal(directAll.length, 1);
assert.equal(directAll[0].operationId, operation.operationId);

// The real durable outbox loader must no longer receive IDBRequest and call .map on it.
const loaded = await fixture.context.loadDurableOutboxOperations();
assert.equal(Array.isArray(loaded), true);
assert.equal(loaded.length, 1);
assert.equal(loaded[0].operationId, operation.operationId);
assert.equal(loaded[0].entityType, operation.entityType);
assert.equal(loaded[0].entityId, operation.entityId);
assert.equal(loaded[0].syncStatus, operation.syncStatus);
assert.deepEqual(loaded[0].payload, operation.payload);

// B: deferred result callback remains supported.
assert.deepEqual(
  await fixture.context.runIndexedDbTransaction("outbox", "readonly", () => () => ({ deferred: true })),
  { deferred: true },
);

// C: an ordinary business object, even one named `result`, is not an IDBRequest.
const plainBusinessObject = { result: "business-field", kind: "ordinary" };
assert.deepEqual(
  await fixture.context.runIndexedDbTransaction("outbox", "readonly", () => plainBusinessObject),
  plainBusinessObject,
);

// C2: the Node fallback must not unwrap an ordinary business object when the
// execution context does not expose the global IDBRequest constructor.
const noIdbRequestFixture = createNimrVmContext({
  filename: "indexeddb-no-idbrequest-p0012.js",
  scriptFiles: ["../../js/storage.js"],
});
noIdbRequestFixture.context.indexedDB = createBrowserLikeIndexedDb();
assert.equal(noIdbRequestFixture.run("typeof IDBRequest"), "undefined");
const plainBusinessObjectWithoutConstructor = { result: "business-field", kind: "ordinary" };
assert.deepEqual(
  await noIdbRequestFixture.context.runIndexedDbTransaction(
    "outbox",
    "readonly",
    () => plainBusinessObjectWithoutConstructor,
  ),
  plainBusinessObjectWithoutConstructor,
  "un objet métier avec son propre champ result doit rester intact sans constructeur IDBRequest global",
);

// D: get() returns the stored business record, never the request envelope.
const directGet = await fixture.context.runIndexedDbTransaction("outbox", "readonly", (store) => store.get(operation.operationId));
assert.equal(directGet.operationId, operation.operationId);
assert.equal(directGet.payload.entity.clientName, "Client durable existant");

// Index requests share the same browser IDBRequest contract.
const indexedPending = await fixture.context.runIndexedDbTransaction(
  "outbox",
  "readonly",
  (store) => store.index("syncStatus").getAll("pending"),
);
assert.equal(Array.isArray(indexedPending), true);
assert.equal(indexedPending.length, 1);

// F: readwrite delete/clear keep their request-result behavior without touching the durable outbox.
const metadata = { key: "temporary-metadata", value: true };
assert.equal(
  await fixture.context.runIndexedDbTransaction("sync_metadata", "readwrite", (store) => store.put(metadata)),
  metadata.key,
);
assert.equal(
  await fixture.context.runIndexedDbTransaction("sync_metadata", "readwrite", (store) => store.delete(metadata.key)),
  true,
);
await fixture.context.runIndexedDbTransaction("sync_metadata", "readwrite", (store) => store.clear());

// G: request and transaction failures reject rather than reporting false success.
indexedDb.failNextRequest();
await assert.rejects(
  fixture.context.runIndexedDbTransaction("outbox", "readonly", (store) => store.getAll()),
  /Injected IDBRequest failure/,
);
indexedDb.failNextTransaction();
await assert.rejects(
  fixture.context.runIndexedDbTransaction("outbox", "readonly", (store) => store.getAll()),
  /Injected IndexedDB transaction failure/,
);

// H: existing stores, DB version, and durable operations remain intact; no outbox clear/delete occurs.
const database = indexedDb.databases.get("nimr-sav-large-state");
assert.equal(database.version, 3);
assert.equal(database.inspect("outbox").length, 1);
assert.equal(database.inspect("outbox")[0].operationId, operation.operationId);
assert.equal(indexedDb.metrics.clearCalls, 1, "seul le store metadata de test est vidé");
assert.equal(indexedDb.metrics.deleteCalls, 1, "seule la ligne metadata de test est supprimée");

// The real diagnostic path can map/export the recovered outbox without changing business data.
const diagnosticFixture = createNimrVmContext({ filename: "indexeddb-diagnostic-p0012.js" });
const diagnosticIndexedDb = createBrowserLikeIndexedDb();
diagnosticFixture.context.IDBRequest = BrowserLikeIDBRequest;
diagnosticFixture.context.indexedDB = diagnosticIndexedDb;
diagnosticFixture.context.isSupabaseConfigured = () => true;
diagnosticFixture.context.getSupabaseWorkshopId = () => operation.workshopId;
diagnosticFixture.context.getOpenSyncConflicts = () => [];
let exportedDiagnostic = null;
diagnosticFixture.context.downloadJson = (payload, filename) => {
  exportedDiagnostic = { payload: clone(payload), filename };
};
vm.runInContext(
  fs.readFileSync(new URL("../js/supabase-sync.js", import.meta.url), "utf8"),
  diagnosticFixture.context,
  { filename: "supabase-sync-diagnostic-p0012.js" },
);
await diagnosticFixture.context.runIndexedDbTransaction("outbox", "readwrite", (store) => store.put(operation));
const businessStateBeforeDiagnostic = diagnosticFixture.run("JSON.stringify(state)");
const durableOutboxBeforeDiagnostic = diagnosticIndexedDb.databases
  .get("nimr-sav-large-state")
  .inspect("outbox");
await diagnosticFixture.run("exportSupabaseSyncDiagnostic()");
assert.ok(exportedDiagnostic?.filename.startsWith("nimr-sav-sync-diagnostic-"));
assert.equal(Array.isArray(exportedDiagnostic?.payload?.outbox), true);
assert.equal(exportedDiagnostic.payload.outbox[0].operationId, operation.operationId);
assert.equal(diagnosticFixture.run("JSON.stringify(state)"), businessStateBeforeDiagnostic);
assert.deepEqual(
  diagnosticIndexedDb.databases.get("nimr-sav-large-state").inspect("outbox"),
  durableOutboxBeforeDiagnostic,
);

// PWA release contract: a new cache/query version is required to deliver storage.js to real browsers.
const versionSource = fs.readFileSync(new URL("../js/version.js", import.meta.url), "utf8");
const stateSource = fs.readFileSync(new URL("../js/state.js", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const serviceWorkerSource = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
assert.match(versionSource, /window\.APP_VERSION = "v23\.3\.5"/u);
assert.match(versionSource, /window\.NIMR_BUILD = "v23\.3\.5"/u);
assert.match(versionSource, /window\.NIMR_CACHE_NAME = "nimr-sav-v23\.3\.5"/u);
assert.match(stateSource, /const APP_VERSION = "v23\.3\.5"/u);
assert.match(appSource, /serviceWorker\.register\("sw\.js\?v=23\.3\.5"/u);
assert.match(serviceWorkerSource, /const CACHE_NAME = "nimr-sav-v23\.3\.5"/u);
assert.doesNotMatch(indexSource, /\?v=23\.3\.1/u);
for (const match of indexSource.matchAll(/\?v=([0-9.]+)/gu)) assert.equal(match[1], "23.3.5");

console.log("P0-012 INDEXEDDB OUTBOX RUNTIME OK");
