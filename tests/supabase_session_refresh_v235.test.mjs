import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const files = [
  "js/utils.js",
  "js/state.js",
  "js/ui-cases.js",
  "js/storage.js",
  "js/supabase-client.js",
  "js/supabase-sync.js",
  "app.js",
];

const listeners = new Map();
const makeElement = (id = "") => {
  const element = {
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    disabled: false,
    title: "",
    dataset: {},
    style: {},
    elements: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    removeAttribute() {},
    remove() {},
    matches(selector) { return selector === "form" && this.isForm === true; },
    addEventListener(type, handler) {
      const key = `${this.id}:${type}`;
      listeners.set(key, (listeners.get(key) || 0) + 1);
      this[`on${type}`] = handler;
    },
    querySelector() { return null; },
    querySelectorAll() { return this.children || []; },
    closest() { return null; },
    focus() {},
  };
  return element;
};

const elements = new Map();
const ids = [
  "supabase-login-form", "supabase-signout", "supabase-test", "supabase-save",
  "supabase-restore", "supabase-config-form", "supabase-config-clear",
  "supabase-url", "supabase-key", "supabase-login-email", "supabase-login-password",
  "sidebar-user-name", "user-login-overlay", "first-access-overlay", "case-detail", "gantt",
];
ids.forEach((id) => elements.set(id, makeElement(id)));
elements.get("supabase-login-form").isForm = true;
elements.get("supabase-login-form").children = [elements.get("supabase-login-email"), elements.get("supabase-login-password")];
elements.get("supabase-config-form").isForm = true;
elements.get("supabase-config-form").children = [elements.get("supabase-url"), elements.get("supabase-key")];
elements.get("supabase-config-form").elements = {
  url: elements.get("supabase-url"),
  anonKey: elements.get("supabase-key"),
  workshopId: makeElement("supabase-workshop-id"),
  backupTable: makeElement("supabase-backup-table"),
  backupKey: makeElement("supabase-backup-key"),
};

const context = {
  console,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 },
  document: {
    getElementById: (id) => elements.get(id) || null,
    querySelector: (selector) => selector.startsWith("#") ? elements.get(selector.slice(1)) || null : null,
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => makeElement(),
    body: makeElement("body"),
    visibilityState: "visible",
    activeElement: null,
  },
  window: {
    addEventListener() {},
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval() {},
    NIMR_SUPABASE_RUNTIME_CONFIG_KEY: "nimr-supabase-runtime-config",
    NIMR_DEFAULT_WORKSHOP_ID: "00000000-0000-0000-0000-000000000001",
  },
  navigator: { onLine: true },
  fetch: async () => ({ ok: false }),
  setTimeout,
  clearTimeout,
  setInterval: () => 1,
  clearInterval() {},
  Blob,
  URL: { createObjectURL: () => "", revokeObjectURL() {} },
  FileReader: class {},
  crypto: { randomUUID: () => "session-refresh-test" },
};
context.window = { ...context.window, ...context };
vm.createContext(context);
const source = files.map((file) => fs.readFileSync(file, "utf8")).join("\n")
  .replace(/initApp\(\);/, "// initApp skipped by session refresh test")
  .replace(/if \("serviceWorker" in navigator[\s\S]*$/u, "");
vm.runInContext(source, context);
const run = (code) => vm.runInContext(code, context);

run(`state = normalizeState({
  users: [
    { id: "director", name: "Directeur SAV", role: "directeur_sav", active: true },
    { id: "admin", name: "Admin technique", role: "admin_technique", active: true },
    { id: "readonly", name: "Lecture seule", role: "lecture_seule", active: true }
  ],
  currentUserId: ""
})`);

let startCalls = 0;
let stopCalls = 0;
let pullCalls = 0;
let outboxCalls = 0;
run(`refreshSupabasePanel = () => Promise.resolve();`);
run(`renderAdminTechnicalVisibility = () => {};`);
run(`startSupabaseLiveSync = async () => { startCalls += 1; await pullLatestSupabaseBackup("authenticated-start"); return true; };`);
run(`stopSupabaseLiveSync = () => { stopCalls += 1; };`);
run(`pullLatestSupabaseBackup = async () => { pullCalls += 1; };`);
run(`processOfflineQueue = async () => { outboxCalls += 1; };`);
context.startCalls = 0;
context.stopCalls = 0;
context.pullCalls = 0;
context.outboxCalls = 0;

run("bindSupabaseActions()");
assert.equal(elements.get("supabase-login-email").disabled, true, "fresh startup disables session controls without a local actor");
assert.equal(elements.get("supabase-test").disabled, true, "fresh startup disables sync diagnostics without a local actor");
assert.equal(elements.get("supabase-config-form").children[0].disabled, true, "fresh startup disables configuration");
const initialLoginBindings = listeners.get("supabase-login-form:submit");
const initialConfigBindings = listeners.get("supabase-config-form:submit");

run("bindSupabaseActions()");
assert.equal(listeners.get("supabase-login-form:submit"), initialLoginBindings, "rebind does not duplicate login listeners");
assert.equal(listeners.get("supabase-config-form:submit"), initialConfigBindings, "rebind does not duplicate configuration listeners");

run(`render = () => {}; saveState = () => {}; hideUserLoginScreen = () => {}; ensureCurrentTabAllowed = () => {}; resetUserSessionIdleTimer = () => {}; quietNotify = () => {}; addAuditLog = () => {};`);
run("completeUserLogin(getUserById('director'))");
await Promise.resolve();
await Promise.resolve();
assert.equal(elements.get("supabase-login-email").disabled, false, "Director can authenticate after fresh local login");
assert.equal(elements.get("supabase-test").disabled, false, "Director can use operational Supabase diagnostics");
assert.equal(elements.get("supabase-save").disabled, false, "Director retains cloud export");
assert.equal(elements.get("supabase-restore").disabled, true, "Director cannot restore cloud state");
assert.equal(elements.get("supabase-config-form").children[0].disabled, true, "Director cannot configure Supabase");
assert.equal(run("startCalls") > 0, true, "Director login resumes Realtime startup");
assert.equal(run("pullCalls") > 0, true, "Director login resumes cloud pull");
assert.equal(run("outboxCalls") > 0, true, "Director login resumes outbox processing");

run("completeUserLogin(getUserById('admin'))");
assert.equal(elements.get("supabase-config-form").children[0].disabled, false, "Admin login enables Supabase configuration");
assert.equal(elements.get("supabase-restore").disabled, false, "Admin login enables restore");

await run("triggerLogout()");
assert.equal(elements.get("supabase-login-email").disabled, true, "logout disables Supabase session controls");
assert.equal(elements.get("supabase-test").disabled, true, "logout disables operational sync controls");
assert.equal(run("stopCalls") > 0, true, "logout stops Realtime");

run("completeUserLogin(getUserById('readonly'))");
assert.equal(elements.get("supabase-test").disabled, true, "downgrade disables operational sync controls");
assert.equal(run("stopCalls") > 1, true, "role downgrade stops Realtime again");

run(`state = normalizeState({ users: [], currentUserId: "" }); const firstAccess = createFirstAccessUserLocal({ name: "Premier directeur", role: "directeur_sav", pinHash: "hash", pinSalt: "salt" }); refreshSupabasePermissionState("first-access-test");`);
assert.equal(run("firstAccess.ok"), true, "first-access creates the legitimate local actor");
assert.equal(elements.get("supabase-test").disabled, false, "first-access refreshes operational permissions without reload");
assert.equal(elements.get("supabase-config-form").children[0].disabled, true, "first-access Director remains barred from configuration");

console.log("Supabase session permission refresh regression OK");
