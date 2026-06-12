import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

console.log("Demarrage tests v23.2.6 sync conflict badge usability hotfix...");

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
    children: [],
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

// 1. Files & caching validations
const vehiclesSource = fs.readFileSync("data/vehicles.json", "utf8").trim();
const swSource = fs.readFileSync("sw.js", "utf8");
const indexSource = fs.readFileSync("index.html", "utf8");
const stateSource = fs.readFileSync("js/state.js", "utf8");
const versionSource = fs.readFileSync("js/version.js", "utf8");
const appSource = fs.readFileSync("app.js", "utf8");

assert.equal(vehiclesSource, "[]", "data/vehicles.json doit rester vide");
assert.doesNotMatch(swSource, /data\/vehicles\.json/, "data/vehicles.json ne doit pas etre precache");
assert.match(stateSource, /APP_VERSION\s*=\s*"v23\.2\.6"/, "state.js doit utiliser v23.2.6");
assert.match(swSource, /CACHE_NAME\s*=\s*"nimr-sav-v23\.2\.6-reception-qc-field-usability"/, "sw.js doit precacher avec le cache v23.2.6");
assert.match(versionSource, /APP_VERSION\s*=\s*"v23\.2\.6"/, "version.js doit exposer APP_VERSION v23.2.6");
assert.match(versionSource, /NIMR_CACHE_NAME\s*=\s*"nimr-sav-v23\.2\.6-reception-qc-field-usability"/, "version.js doit exposer NIMR_CACHE_NAME v23.2.6");
assert.match(appSource, /serviceWorker\.register\("sw\.js\?v=23\.2\.6"/, "app.js doit enregistrer sw.js?v=23.2.6");

// 2. Setup mock UI elements
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
        setAttribute(k, v) { this[k] = v; },
        removeAttribute(k) { delete this[k]; },
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

  document.querySelector = getOrCreateMockElement;
  document.getElementById = (id) => getOrCreateMockElement("#" + id);
  document.querySelectorAll = () => [];

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

  downloadJsonCalls = [];
  downloadJson = function(payload, filename) {
    downloadJsonCalls.push({ payload, filename });
  };
`);

// Load ui-cases.js and app.js into context
vm.runInContext(fs.readFileSync("js/ui-cases.js", "utf8"), context);
vm.runInContext(fs.readFileSync("app.js", "utf8"), context);

// Test conflict states
app(`
  state = normalizeState({
    cases: [
      {
        id: "case-test-strip",
        caseNumber: "2026-TEST",
        localRevision: 2,
        syncRevision: 1,
        updatedAt: new Date().toISOString(),
        updatedBy: "Chef",
        history: []
      }
    ],
    resources: [],
    bookings: [],
    users: [],
    currentUserId: "u-chef"
  });

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

  isSupabaseConfigured = () => true;
  renderSyncStatusStrip();
`);

// Assert: conflit ouvert => badge Cloud affiche “Résoudre”
const cloudText = app('getOrCreateMockElement("[data-sync-cloud]").textContent');
assert.ok(cloudText.includes("Résoudre"), "Le badge doit inclure 'Résoudre' en cas de conflit");

// Assert: badge Cloud est un bouton/focusable
const cloudEl = app('getOrCreateMockElement("[data-sync-cloud]")');
assert.equal(cloudEl.tabindex, "0", "Le badge doit avoir un tabindex de 0");
assert.equal(cloudEl.style.cursor, "pointer", "Le badge doit avoir un cursor pointer");
assert.equal(cloudEl.style.textDecoration, "underline", "Le badge doit être souligné");

// Assert: bouton fallback visible si conflit ouvert
const fallbackBtn = app('getOrCreateMockElement("#fallback-resolve-conflict-btn")');
assert.equal(fallbackBtn.hidden, false, "Le bouton de secours doit être visible");

// Test: clic badge => panneau conflit visible
app(`
  getOrCreateMockElement("#panel-activity-log").hidden = true;
  getOrCreateMockElement("#sync-conflict-panel").hidden = true;
  getOrCreateMockElement("#sync-conflict-panel").scrolledIntoView = false;
  activeTab = "dossiers";
  getOrCreateMockElement("[data-sync-cloud]").click();
`);
assert.equal(app('activeTab'), 'atelier', "setActiveTab('atelier') doit être appelé lors du clic");
assert.equal(app('getOrCreateMockElement("#panel-activity-log").hidden'), false, "Le panneau d'activité doit être visible");
assert.equal(app('getOrCreateMockElement("#sync-conflict-panel").hidden'), false, "Le panneau de conflits doit être visible");
assert.equal(app('getOrCreateMockElement("#sync-conflict-panel").scrolledIntoView'), true, "Le panneau de conflits doit être défilé");

// Test: Enter/Espace sur badge => panneau conflit visible
app(`
  getOrCreateMockElement("#panel-activity-log").hidden = true;
  getOrCreateMockElement("#sync-conflict-panel").hidden = true;
  getOrCreateMockElement("#sync-conflict-panel").scrolledIntoView = false;
  activeTab = "dossiers";
  const badge = getOrCreateMockElement("[data-sync-cloud]");
  if (badge.listeners && badge.listeners.keydown) {
    badge.listeners.keydown.forEach(cb => cb({ key: "Enter", preventDefault() {} }));
  }
  if (badge.onkeydown) {
    badge.onkeydown({ key: "Enter", preventDefault() {} });
  }
`);
assert.equal(app('activeTab'), 'atelier', "L'appui sur Enter doit activer la navigation");
assert.equal(app('getOrCreateMockElement("#sync-conflict-panel").hidden'), false, "L'appui sur Enter doit unhide le panneau");

// Test: utilisateur sans audit.view voit le panneau conflit mais pas les logs sensibles
app(`
  hasPermission = (permission) => {
    if (permission === "audit.view") return false;
    return true;
  };
  getOrCreateMockElement("#panel-activity-log").hidden = true;
  getOrCreateMockElement("#sync-conflict-panel").hidden = true;
  renderActivityLog();
`);
assert.equal(app('getOrCreateMockElement("#panel-activity-log").hidden'), false, "Le panneau principal doit être visible même sans permission s'il y a des conflits");
const headingStyle = app('getOrCreateMockElement("#panel-activity-log").querySelector(".panel-heading").style.display');
assert.equal(headingStyle, 'none', "L'en-tête doit être masqué sans permission");
const tableContainerStyle = app('getOrCreateMockElement("#panel-activity-log").querySelector(".table-container").style.display');
assert.equal(tableContainerStyle, 'none', "La table des logs doit être masquée sans permission");

// Test: conflit résolu => badge “Conflit détecté” disparaît et fallback bouton masqué
app(`
  hasPermission = () => true;
  resolveSyncConflict("conf-test-strip", "keep_local");
`);
const cloudTextAfter = app('getOrCreateMockElement("[data-sync-cloud]").textContent');
assert.ok(!cloudTextAfter.includes("Conflit"), "Le badge de conflit doit disparaître après résolution");
assert.equal(app('getOrCreateMockElement("#fallback-resolve-conflict-btn").hidden'), true, "Le bouton de secours doit être masqué après résolution");

// Test: modifications en attente revient à 0 quand localRevision == syncRevision
app(`
  state.cases[0].localRevision = 5;
  state.cases[0].syncRevision = 5;
  localStorage.setItem("nimr-sav-offline-queue", "[]");
  renderSyncStatusStrip();
`);
const pendingText = app('getOrCreateMockElement("[data-sync-pending]").textContent');
assert.equal(pendingText, "0", "Le compteur de modifications en attente doit revenir à 0");

// Test: aucun téléchargement automatique
assert.equal(app('downloadJsonCalls.length'), 0, "Aucun téléchargement automatique ne doit être déclenché");

console.log("Tests v23.2.6 sync conflict badge usability hotfix OK");
