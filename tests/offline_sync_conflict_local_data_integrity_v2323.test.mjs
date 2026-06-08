import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

console.log("Demarrage tests v23.2.3 offline sync conflict and local data integrity...");

const scriptFiles = [
  "js/utils.js",
  "js/state.js",
  "js/storage.js",
  "js/supabase-config.js",
  "js/supabase-client.js",
  "js/supabase-sync.js",
];

const source = scriptFiles
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");

function stubElement() {
  return {
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    disabled: false,
    title: "",
    dataset: {},
    style: {},
    elements: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {},
    removeAttribute() {},
    remove() {},
    toggleAttribute() {},
    addEventListener() {},
    append() {},
    appendChild() {},
    prepend() {},
    replaceChildren() {},
    querySelector: () => stubElement(),
    querySelectorAll: () => [],
    closest: () => null,
  };
}

const storage = new Map();
const context = {
  console,
  localStorage: {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
    key: (index) => [...storage.keys()][index] || null,
    get length() { return storage.size; },
  },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 },
  document: {
    querySelector: () => stubElement(),
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => stubElement(),
    body: stubElement(),
  },
  window: {
    addEventListener() {},
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    NIMR_SUPABASE_RUNTIME_CONFIG_KEY: "nimr-supabase-runtime-config",
    NIMR_DEFAULT_WORKSHOP_ID: "00000000-0000-0000-0000-000000000001",
  },
  navigator: { onLine: true },
  fetch: async () => ({ ok: false }),
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval: () => {},
  Blob,
  URL: { createObjectURL: () => "", revokeObjectURL() {} },
  FileReader: class {},
  TextEncoder,
  TextDecoder,
  btoa: (value) => Buffer.from(value, "binary").toString("base64"),
  atob: (value) => Buffer.from(value, "base64").toString("binary"),
  crypto: {
    randomUUID: () => `id-${Math.random().toString(16).slice(2)}`,
    getRandomValues(bytes) {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 37 + 11) % 256;
      return bytes;
    },
  },
  $: () => stubElement(),
};
context.window = { ...context.window, ...context };

vm.createContext(context);
vm.runInContext(source, context);
const app = (code) => vm.runInContext(code, context);

// 1. Vehicles validation
const vehiclesSource = fs.readFileSync("data/vehicles.json", "utf8").trim();
const swSource = fs.readFileSync("sw.js", "utf8");
assert.equal(vehiclesSource, "[]", "data/vehicles.json doit rester vide");
assert.doesNotMatch(swSource, /data\/vehicles\.json/, "data/vehicles.json ne doit pas etre precache");

// 2. Setup state
app(`
  state = normalizeState({
    cases: [
      {
        id: "case-1",
        clientName: "Client A",
        vehicle: "Ford",
        plate: "123 TU 456",
        localRevision: 1,
        syncRevision: 1,
        updatedAt: new Date().toISOString(),
        updatedBy: "Chef",
        history: []
      }
    ],
    resources: [],
    bookings: [],
    users: [
      { id: "u-admin", name: "Admin", role: "admin", active: true },
      { id: "u-chef", name: "Chef", role: "chef_atelier", active: true }
    ],
    currentUserId: "u-chef"
  });
  initializeLastKnownCasesComparable();
`);

// Verify initial comparable cache
assert.ok(app("window.lastKnownCasesComparable['case-1']"), "Comparable cache should be initialized");

// 3. Test offline creation/modification and queueing
// Go offline
app("navigator.onLine = false");

// Modify the case
app(`
  state.cases[0].clientName = "Client A Modifié";
  saveState();
`);

// Verify localRevision incremented
const updatedCase = app("state.cases[0]");
assert.equal(updatedCase.localRevision, 2, "localRevision should increment by 1 on local modification");
assert.equal(updatedCase.clientName, "Client A Modifié", "Client name should be modified");

// Verify offlineQueue contains a sync_push action
let rawQueue = storage.get("nimr-sav-offline-queue");
let queue = JSON.parse(rawQueue || "[]");
assert.ok(queue.some(a => a.type === "sync_push" && a.status === "pending"), "Pending sync_push should be enqueued when offline");

// Verify deduplication: modifying again should not add a duplicate sync_push
app(`
  state.cases[0].vehicle = "Ford Mustang";
  saveState();
`);
rawQueue = storage.get("nimr-sav-offline-queue");
queue = JSON.parse(rawQueue || "[]");
const pendingPushes = queue.filter(a => a.type === "sync_push" && a.status === "pending");
assert.equal(pendingPushes.length, 1, "Duplicate sync_push actions should be deduplicated");

// 4. Test conflict detection in mergeCaseEntity
const stats = { conflictEntries: [], conflicts: 0, newConflicts: 0, casesMerged: 0, protectedKept: 0 };
const localCase = {
  id: "case-conflict",
  clientName: "Local Client",
  vehicle: "Local Vehicle",
  localRevision: 3,
  syncRevision: 1,
  updatedAt: new Date().toISOString(),
  updatedBy: "Chef"
};
const remoteCase = {
  id: "case-conflict",
  clientName: "Remote Client",
  vehicle: "Remote Vehicle",
  localRevision: 2,
  syncRevision: 1,
  updatedAt: new Date().toISOString(),
  updatedBy: "Supabase"
};

// Call mergeCaseEntity
const mergeResult = app(`mergeCaseEntity(${JSON.stringify(localCase)}, ${JSON.stringify(remoteCase)}, ${JSON.stringify(stats)})`);
// Verify localCase is kept unchanged (no silent overwrite)
assert.equal(mergeResult.clientName, "Local Client", "mergeCaseEntity should not overwrite local modifications");

// Let's call the actual mergeCaseEntity in context to verify stats object modifications
app(`
  var testStats = { conflictEntries: [], conflicts: 0, newConflicts: 0, casesMerged: 0, protectedKept: 0 };
  var localObj = ${JSON.stringify(localCase)};
  var remoteObj = ${JSON.stringify(remoteCase)};
  var res = mergeCaseEntity(localObj, remoteObj, testStats);
`);
const testStats = app("testStats");
assert.equal(testStats.conflicts, 1, "Should count 1 conflict");
assert.equal(testStats.conflictEntries.length, 1, "Should generate exactly 1 conflict entry");
assert.equal(testStats.conflictEntries[0].type, "case_conflict", "Conflict type should be case_conflict");
assert.equal(testStats.conflictEntries[0].status, "open", "Conflict should be open");

// 5. Test sensitive action blocking on conflicted case
// Push conflict into state.syncConflicts to mock it
app(`
  state.syncConflicts = [
    {
      id: "conf-1",
      type: "case_conflict",
      caseId: "case-conflict",
      localCase: ${JSON.stringify(localCase)},
      remoteCase: ${JSON.stringify(remoteCase)},
      localValue: ${JSON.stringify(localCase)},
      remoteValue: ${JSON.stringify(remoteCase)},
      status: "open"
    }
  ];
`);

// Try sensitive action on conflicted case
const caseContext = { caseId: "case-conflict" };
const guardEdit = app(`guardAction("case.edit", ${JSON.stringify(caseContext)})`);
assert.equal(guardEdit.ok, false, "Sensitive action edit should be blocked");
assert.match(guardEdit.message, /présente un conflit de synchronisation/i, "Blocked message should explain the sync conflict");

const guardStart = app(`guardAction("task.start", ${JSON.stringify(caseContext)})`);
assert.equal(guardStart.ok, false, "Sensitive task start should be blocked");

// Non-sensitive action should not be blocked
const guardView = app(`guardAction("dashboard.view", ${JSON.stringify(caseContext)})`);
assert.equal(guardView.ok, true, "Non-sensitive action view should not be blocked");

// 6. Test conflict resolutions
// A. resolveSyncConflict keep_local
// Add the conflicted case to state.cases
app(`
  state.cases.push(${JSON.stringify(localCase)});
  initializeLastKnownCasesComparable();
`);
const resolveKeepResult = app(`resolveSyncConflict("conf-1", "keep_local")`);
assert.equal(resolveKeepResult.ok, true, "resolveSyncConflict keep_local should succeed");
assert.equal(resolveKeepResult.conflict.status, "resolved", "Conflict should be marked as resolved");

const caseAfterKeep = app(`state.cases.find(c => c.id === "case-conflict")`);
assert.equal(caseAfterKeep.localRevision, 4, "keep_local should increment localRevision of localCase");

// B. resolveSyncConflict accept_cloud
// Re-open/Reset conflict and case
app(`
  state.cases = state.cases.filter(c => c.id !== "case-conflict");
  state.cases.push(${JSON.stringify(localCase)});
  initializeLastKnownCasesComparable();
  state.syncConflicts = [
    {
      id: "conf-1",
      type: "case_conflict",
      caseId: "case-conflict",
      localCase: ${JSON.stringify(localCase)},
      remoteCase: ${JSON.stringify(remoteCase)},
      localValue: ${JSON.stringify(localCase)},
      remoteValue: ${JSON.stringify(remoteCase)},
      status: "open"
    }
  ];
`);

const resolveAcceptResult = app(`resolveSyncConflict("conf-1", "accept_cloud")`);
console.log("resolveAcceptResult:", resolveAcceptResult);
assert.equal(resolveAcceptResult.ok, true, "resolveSyncConflict accept_cloud should succeed");

const caseAfterAccept = app(`state.cases.find(c => c.id === "case-conflict")`);
assert.equal(caseAfterAccept.clientName, "Remote Client", "accept_cloud should replace case with remoteCase");
assert.equal(caseAfterAccept.syncRevision, 2, "accept_cloud should set syncRevision to remote localRevision");

// C. resolveSyncConflict defer_manual_merge
app(`
  state.cases = state.cases.filter(c => c.id !== "case-conflict");
  state.cases.push(${JSON.stringify(localCase)});
  initializeLastKnownCasesComparable();
  state.syncConflicts = [
    {
      id: "conf-1",
      type: "case_conflict",
      caseId: "case-conflict",
      localCase: ${JSON.stringify(localCase)},
      remoteCase: ${JSON.stringify(remoteCase)},
      localValue: ${JSON.stringify(localCase)},
      remoteValue: ${JSON.stringify(remoteCase)},
      status: "open"
    }
  ];
`);
const resolveDeferResult = app(`resolveSyncConflict("conf-1", "defer_manual_merge")`);
assert.equal(resolveDeferResult.ok, true, "resolveSyncConflict defer_manual_merge should succeed");
assert.equal(resolveDeferResult.conflict.status, "open", "defer_manual_merge should keep conflict open");

const guardEditAfterDefer = app(`guardAction("case.edit", ${JSON.stringify(caseContext)})`);
assert.equal(guardEditAfterDefer.ok, false, "Sensitive actions must remain blocked after deferring manual merge");

console.log("Tests v23.2.3 offline sync conflict and local data integrity OK");
