import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

console.log("Demarrage tests v23.2.7 offline sync conflict and local data integrity...");

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
    elements: {
      url: { value: "" },
      anonKey: { value: "" },
      workshopId: { value: "" },
      backupKey: { value: "" },
      email: { value: "" },
      password: { value: "" },
    },
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
    focus() { this.focused = true; },
  };
}

const storage = new Map();
const fakeTimeout = (callback, ...args) => {
  if (typeof callback === "function") callback(...args);
  return 0;
};
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
    setTimeout: fakeTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    NIMR_SUPABASE_RUNTIME_CONFIG_KEY: "nimr-supabase-runtime-config",
    NIMR_DEFAULT_WORKSHOP_ID: "00000000-0000-0000-0000-000000000001",
  },
  navigator: { onLine: true },
  fetch: async () => ({ ok: false }),
  setTimeout: fakeTimeout,
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

// --- ADDITIONAL TESTS FOR HOTFIX v23.2.7 ---
console.log("Running additional hotfix assertions...");

await app(`
  downloadJsonCalls = [];
  downloadJson = function(payload, filename) {
    downloadJsonCalls.push({ payload, filename });
  };
  confirmStrongSensitiveAction = async () => true;
  showConfirmModal = async () => true;
  getAllPhotoRecords = async () => [];
  getAllDocumentRecords = async () => [];
  guardSensitiveAction = () => ({ ok: true });
  clearPhotoStore = async () => {};
  restorePhotoRecords = async () => [];
  render = () => {};

  // Override Object.keys for mock localStorage in tests
  Object.keys = (obj) => {
    if (obj === localStorage) {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) keys.push(k);
      }
      return keys;
    }
    return Object.getOwnPropertyNames(obj);
  };

  // Clear any existing snapshots
  localStorage.removeItem("nimr-sav-restore-safety-snapshot:last");
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("nimr-sav-conflict-safety-snapshot:")) {
      localStorage.removeItem(key);
      i--;
    }
  }
`);

// Test A: accept_cloud creates local snapshot and triggers no auto-download
await app(`
  state.cases = state.cases.filter(c => c.id !== "case-conflict");
  state.cases.push(${JSON.stringify(localCase)});
  state.syncConflicts = [
    {
      id: "conf-new-1",
      type: "case_conflict",
      caseId: "case-conflict",
      localCase: ${JSON.stringify(localCase)},
      remoteCase: ${JSON.stringify(remoteCase)},
      localValue: ${JSON.stringify(localCase)},
      remoteValue: ${JSON.stringify(remoteCase)},
      status: "open"
    }
  ];
  downloadJsonCalls = [];
  var res = resolveSyncConflict("conf-new-1", "accept_cloud");
`);

let dlCalls = app("downloadJsonCalls.length");
assert.equal(dlCalls, 0, "accept_cloud must not trigger any automatic download");

let snap = app('localStorage.getItem("nimr-sav-conflict-safety-snapshot:case-conflict:conf-new-1")');
assert.ok(snap, "accept_cloud should create a safety snapshot in localStorage");
let snapPayload = JSON.parse(snap);
assert.equal(snapPayload.cases[0].id, "case-conflict", "Snapshot case ID should match");

// Test B: keep_local and defer_manual_merge trigger no auto-download
app(`
  downloadJsonCalls = [];
  resolveSyncConflict("conf-new-1", "keep_local");
`);
assert.equal(app("downloadJsonCalls.length"), 0, "keep_local must not trigger any automatic download");

app(`
  state.syncConflicts[0].status = "open"; // Re-open
  downloadJsonCalls = [];
  resolveSyncConflict("conf-new-1", "defer_manual_merge");
`);
assert.equal(app("downloadJsonCalls.length"), 0, "defer_manual_merge must not trigger any automatic download");

// Test C: confirmRemoteBackupConflict triggers no auto-download and creates global safety snapshot
app(`
  downloadJsonCalls = [];
  localStorage.removeItem("nimr-sav-restore-safety-snapshot:last");
  remoteConflictMutedUntil = 0;
  // Set change timestamp to mock unsynced local changes
  lastKnownCloudUpdatedAt = 1000;
  getLocalUserChangeAt = () => 5000;
  var remoteData = { updated_at: new Date(6000).toISOString(), state: { cases: [] } };
`);
await app(`confirmRemoteBackupConflict(remoteData, "test_reason")`);
// It will call showConfirmModal which returns true, then save snapshot
assert.equal(app("downloadJsonCalls.length"), 0, "confirmRemoteBackupConflict must not trigger auto download");
assert.ok(app('localStorage.getItem("nimr-sav-restore-safety-snapshot:last")'), "confirmRemoteBackupConflict should create a global safety snapshot");

// Test D: restoreLocalFromSupabase triggers no auto-download and creates global safety snapshot
app(`
  downloadJsonCalls = [];
  localStorage.removeItem("nimr-sav-restore-safety-snapshot:last");

  // Mock Supabase select to succeed
  var chainMock = {
    eq: function() { return chainMock; },
    single: async () => ({ data: { state: { cases: [] }, photos: [] } }),
    maybeSingle: async () => ({ data: { state: { cases: [] }, photos: [] } })
  };
  var clientMock = {
    auth: { getUser: async () => ({ data: { user: { id: "u-admin", email: "admin@nimr.com" } } }) },
    from: () => ({
      select: () => chainMock
    })
  };
  getSupabaseClient = () => clientMock;
  getSupabaseUser = async () => ({ id: "u-admin", email: "admin@nimr.com" });
  isSupabaseConfigured = () => true;
`);

// Trigger restoreLocalFromSupabase
app(`
  restoreLocalFromSupabase();
`);

// Wait a tiny moment for async execution
await new Promise(resolve => setTimeout(resolve, 100));

assert.equal(app("downloadJsonCalls.length"), 0, "restoreLocalFromSupabase must not trigger auto download");
assert.ok(app('localStorage.getItem("nimr-sav-restore-safety-snapshot:last")'), "restoreLocalFromSupabase should create a global safety snapshot");

// Test E: snapshot clean-up keeps only the latest snapshot per caseId
app(`
  // Clear conflict snapshots
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("nimr-sav-conflict-safety-snapshot:")) {
      localStorage.removeItem(key);
      i--;
    }
  }

  // Create conflict snapshot 1
  state.cases = [{ id: "case-cleanup-test", clientName: "Original" }];
  state.syncConflicts = [
    { id: "conf-cleanup-1", type: "case_conflict", caseId: "case-cleanup-test", remoteValue: { id: "case-cleanup-test", clientName: "New" }, status: "open" }
  ];
  resolveSyncConflict("conf-cleanup-1", "accept_cloud");
`);

// Verify snapshot 1 exists
assert.ok(app('localStorage.getItem("nimr-sav-conflict-safety-snapshot:case-cleanup-test:conf-cleanup-1")'), "Snapshot 1 should be created");

// Re-open and accept another cloud conflict for the same case but different conflictId
app(`
  state.cases = [{ id: "case-cleanup-test", clientName: "Updated" }];
  state.syncConflicts = [
    { id: "conf-cleanup-2", type: "case_conflict", caseId: "case-cleanup-test", remoteValue: { id: "case-cleanup-test", clientName: "Latest" }, status: "open" }
  ];
  resolveSyncConflict("conf-cleanup-2", "accept_cloud");
`);

// Snapshot 1 should be deleted, only snapshot 2 should remain
assert.equal(app('localStorage.getItem("nimr-sav-conflict-safety-snapshot:case-cleanup-test:conf-cleanup-1")'), null, "Snapshot 1 should have been cleaned up");
assert.ok(app('localStorage.getItem("nimr-sav-conflict-safety-snapshot:case-cleanup-test:conf-cleanup-2")'), "Snapshot 2 should exist");

// Test F: Deduplication prevents duplicate open conflicts
app(`
  state.syncConflicts = [];
  var statsTest = { conflictEntries: [], conflicts: 0, newConflicts: 0 };
  var localCaseItem = { id: "case-dedup-test", localRevision: 3, syncRevision: 1, clientName: "Local" };
  var remoteCaseItem = { id: "case-dedup-test", localRevision: 2, syncRevision: 1, clientName: "Remote" };
  var localStateMock = { syncConflicts: [] };

  // Call mergeCaseEntity first time -> should generate conflict
  mergeCaseEntity(localCaseItem, remoteCaseItem, statsTest, localStateMock);
`);
assert.equal(app("statsTest.conflictEntries.length"), 1, "Should generate one conflict entry");

app(`
  // Mock pushing the conflict to client state.syncConflicts
  state.syncConflicts = [statsTest.conflictEntries[0]];

  // Call mergeCaseEntity again on the same case -> should NOT generate another conflict
  var statsTest2 = { conflictEntries: [], conflicts: 0, newConflicts: 0 };
  mergeCaseEntity(localCaseItem, remoteCaseItem, statsTest2, state);
`);
assert.equal(app("statsTest2.conflictEntries.length"), 0, "Deduplication should prevent duplicate conflict generation");

// Test G: Workstation cleanup deletes the safety snapshots
app(`
  localStorage.setItem("nimr-sav-conflict-safety-snapshot:case-cleanup-test:conf-cleanup-2", "{}");
  localStorage.setItem("nimr-sav-restore-safety-snapshot:last", "{}");
  showPromptModal = async () => true; // auto-confirm cleanup
  deleteApplicationIndexedDatabases = async () => {};
  showWorkstationCleanedScreen = () => {};
`);

await app(`cleanLocalWorkstation()`);

assert.equal(app('localStorage.getItem("nimr-sav-conflict-safety-snapshot:case-cleanup-test:conf-cleanup-2")'), null, "Cleanup should remove conflict safety snapshots");
assert.equal(app('localStorage.getItem("nimr-sav-restore-safety-snapshot:last")'), null, "Cleanup should remove restore safety snapshots");

// Test H: Sync status strip improvement tests
console.log("Running Sync status strip improvement tests...");

app(`
  var elements = {};
  function getOrCreateMockElement(selector) {
    if (!elements[selector]) {
      elements[selector] = {
        value: "",
        textContent: "",
        innerHTML: "",
        hidden: false,
        disabled: false,
        title: "",
        dataset: {},
        style: {},
        children: [],
        elements: {
          url: { value: "" },
          anonKey: { value: "" },
          workshopId: { value: "" },
          backupKey: { value: "" },
          email: { value: "" },
          password: { value: "" },
        },
        classList: {
          add() {},
          remove() {},
          toggle() {},
          contains: () => false
        },
        setAttribute() {},
        removeAttribute() {},
        remove() {},
        toggleAttribute() {},
        append() {},
        appendChild() {},
        prepend() {},
        replaceChildren() {},
        querySelector: function(sel) { return getOrCreateMockElement(sel); },
        querySelectorAll: function() { return []; },
        closest: function() { return null; },
        addEventListener: function(event, cb) {
          this.listeners = this.listeners || {};
          this.listeners[event] = this.listeners[event] || [];
          this.listeners[event].push(cb);
        },
        click: function() {
          if (this.listeners && this.listeners.click) {
            this.listeners.click.forEach(cb => cb());
          }
          if (this.onclick) this.onclick();
        },
        focus: function() {
          this.focused = true;
        },
        scrollIntoView: function() {
          this.scrolledIntoView = true;
        }
      };
    }
    return elements[selector];
  }

  // Override document methods instead of reassigning constant variables
  document.querySelector = getOrCreateMockElement;
  document.getElementById = (id) => getOrCreateMockElement("#" + id);
  document.querySelectorAll = () => [];

  // Set default tab navigation mocks
  activeTab = "dossiers";
  canAccessTab = (tab) => tab === "atelier" || tab === "dossiers";
  getAllowedTabsForCurrentUser = () => ["atelier", "dossiers"];
  hasPermission = () => true;
  getActiveCase = () => null;
  renderPlanning = () => {};
  renderTechnicianDashboard = () => {};
  renderTodayWorkshop = () => {};
  renderResources = () => {};
  renderHolidays = () => {};
  renderResourceLeaves = () => {};
  renderFastLaneSettings = () => {};
  renderWorkHoursSettings = () => {};
  migrateLegacyPhotos = () => {};
`);

// Load ui-cases.js and app.js into context
const uiCasesSource = fs.readFileSync("js/ui-cases.js", "utf8");
const appJsSource = fs.readFileSync("app.js", "utf8");
vm.runInContext(uiCasesSource, context);
vm.runInContext(appJsSource, context);

// Test 1: Conflit ouvert => badge “Conflit détecté”
app(`
  // Ensure the case exists in state.cases
  state.cases.push({
    id: "case-test-strip",
    caseNumber: "2026-TEST",
    localRevision: 1,
    syncRevision: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: "Chef",
    history: []
  });

  // Mock open sync conflicts with actual differing objects so they don't get auto-resolved
  state.syncConflicts = [
    {
      id: "conf-test-strip",
      type: "case_conflict",
      caseId: "case-test-strip",
      caseNumber: "2026-TEST",
      localValue: { clientName: "Local Client" },
      remoteValue: { clientName: "Remote Client" },
      localCase: { clientName: "Local Client" },
      remoteCase: { clientName: "Remote Client" },
      status: "open"
    }
  ];

  // Set isSupabaseConfigured to true so cloud sync status is evaluated
  isSupabaseConfigured = () => true;

  // Run renderSyncStatusStrip
  renderSyncStatusStrip();
`);

const cloudText = app('getOrCreateMockElement("[data-sync-cloud]").textContent');
assert.match(cloudText, /conflit/i, "Le badge Cloud doit mentionner 'conflit'");
assert.match(cloudText, /1/, "Le badge Cloud doit afficher le nombre de conflits ouverts");
assert.match(cloudText, /Résoudre/, "Le badge Cloud doit proposer de résoudre");

// Test 2: Clic badge => panneau conflit visible et navigation
// Verify initial hidden states
app(`
  getOrCreateMockElement("#panel-activity-log").hidden = true;
  getOrCreateMockElement("#sync-conflict-panel").hidden = true;
  getOrCreateMockElement("#sync-conflict-panel").scrolledIntoView = false;
  activeTab = "dossiers";
`);

// Trigger click on cloud badge
app('getOrCreateMockElement("[data-sync-cloud]").click()');

// Assert values after click
assert.equal(app('activeTab'), 'atelier', "setActiveTab('atelier') doit être appelé lors du clic");
assert.equal(app('getOrCreateMockElement("#panel-activity-log").hidden'), false, "Le panneau Journal d'activité doit être visible");
assert.equal(app('getOrCreateMockElement("#sync-conflict-panel").hidden'), false, "Le panneau Conflits doit être visible");
assert.equal(app('getOrCreateMockElement("#sync-conflict-panel").scrolledIntoView'), true, "Le panneau Conflits doit être défilé dans la vue");

// Test 3: Conflit résolu => badge disparaît
app(`
  // Resolve conflict
  resolveSyncConflict("conf-test-strip", "keep_local");
`);

// The conflict is resolved, so open conflicts length is 0.
const cloudTextAfter = app('getOrCreateMockElement("[data-sync-cloud]").textContent');
assert.ok(!/conflit/i.test(cloudTextAfter), "Le badge de conflit doit disparaître après résolution");

// Test 4: localRevision == syncRevision => modifications en attente revient à 0
app(`
  // Ensure localRevision == syncRevision for all cases
  state.cases.forEach(c => {
    c.localRevision = 5;
    c.syncRevision = 5;
  });

  // Ensure offline queue is empty
  localStorage.setItem("nimr-sav-offline-queue", "[]");

  // Re-run render
  renderSyncStatusStrip();
`);

const pendingText = app('getOrCreateMockElement("[data-sync-pending]").textContent');
assert.equal(pendingText, "0", "Le compteur de modifications en attente doit revenir à 0");

console.log("Additional hotfix assertions OK");
console.log("Tests v23.2.7 offline sync conflict and local data integrity OK");
