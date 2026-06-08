import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

console.log("Demarrage tests v23.2.3 security exports PIN and Supabase hardening...");

const scriptFiles = [
  "js/utils.js",
  "js/state.js",
  "js/storage.js",
  "js/supabase-client.js",
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
};
context.window = { ...context.window, ...context };

vm.createContext(context);
vm.runInContext(source, context);
const app = (code) => vm.runInContext(code, context);

const indexSource = fs.readFileSync("index.html", "utf8");
const appSource = fs.readFileSync("app.js", "utf8");
const stateSource = fs.readFileSync("js/state.js", "utf8");
const storageSource = fs.readFileSync("js/storage.js", "utf8");
const supabaseClientSource = fs.readFileSync("js/supabase-client.js", "utf8");
const supabaseConfigSource = fs.readFileSync("js/supabase-config.js", "utf8");
const supabaseSyncSource = fs.readFileSync("js/supabase-sync.js", "utf8");
const versionSource = fs.readFileSync("js/version.js", "utf8");
const swSource = fs.readFileSync("sw.js", "utf8");
const vehiclesSource = fs.readFileSync("data/vehicles.json", "utf8").trim();

assert.match(stateSource, /APP_VERSION\s*=\s*"v23\.2\.3"/, "APP_VERSION v23.2.3 attendu");
assert.match(appSource, /serviceWorker\.register\("sw\.js\?v=23\.2\.3"/, "service worker v23.2.3 attendu");
assert.match(versionSource, /NIMR_CACHE_NAME\s*=\s*"nimr-sav-v23\.2\.3-offline-sync-conflict-local-data-hardening"/, "cache annonce v23.2.3 attendu");
assert.match(swSource, /nimr-sav-v23\.2\.3-offline-sync-conflict-local-data-hardening/, "cache PWA v23.2.3 attendu");

const weakBootstrap = Array(4).fill("0").join("");
assert.equal(app(`validateLocalPinStrength(${JSON.stringify(weakBootstrap)}).ok`), false, "PIN faible historique refuse");
assert.equal(app(`validateLocalPinStrength("111111").ok`), false, "PIN repetitif refuse");
assert.equal(app(`validateLocalPinStrength("123456").ok`), false, "PIN sequentiel refuse");
assert.equal(app(`validateLocalPinStrength("1234").ok`), false, "PIN trop court refuse");
assert.equal(app(`validateLocalPinStrength("730184").ok`), true, "PIN robuste accepte");

assert.doesNotMatch(indexSource, /PIN temporaire|different de 0{4}|différent de 0{4}|0{4}.*recommand/i, "l'UI ne doit plus recommander l'ancien code faible");
assert.doesNotMatch(appSource, /deriveLocalPinHash\(["']0{4}|pinVal\s*===\s*["']0{4}|PIN temporaire/i, "app.js ne doit plus dependre du code faible nominal");
assert.match(appSource, /createLocalPinCredentials\(pin\)/, "creation utilisateur doit hacher un PIN robuste fourni");
assert.match(appSource, /Définissez un PIN initial robuste/, "creation compte sensible sans PIN doit etre bloquee");

app(`
  state = normalizeState({
    cases: [],
    resources: [],
    bookings: [],
    users: [
      { id: "u-admin", name: "Admin", role: "admin", active: true },
      { id: "u-directeur", name: "Directeur", role: "directeur_sav", active: true },
      { id: "u-chef", name: "Chef", role: "chef_atelier", active: true },
      { id: "u-reception", name: "Reception", role: "reception", active: true },
      { id: "u-readonly", name: "Lecture", role: "readonly", active: true }
    ],
    currentUserId: "u-directeur"
  });
`);
assert.equal(app(`guardSensitiveAction("export.backup").ok`), true, "directeur SAV conserve export autorise");
app(`state.currentUserId = "u-reception"`);
assert.equal(app(`guardSensitiveAction("export.backup").ok`), false, "reception ne peut pas exporter JSON");
app(`state.currentUserId = "u-readonly"`);
assert.equal(app(`guardSensitiveAction("export.backup").ok`), false, "lecture seule ne peut pas exporter JSON");
app(`state.currentUserId = "u-admin"`);
assert.equal(app(`guardSensitiveAction("import.backup").ok`), true, "admin technique peut restaurer");

assert.match(storageSource, /PLAIN_JSON_EXPORT_CONFIRMATION\s*=\s*"EXPORT NON CHIFFRE"/, "confirmation forte export JSON attendue");
assert.match(storageSource, /RESTORE_BACKUP_CONFIRMATION\s*=\s*"RESTAURER"/, "confirmation forte restauration attendue");
assert.match(storageSource, /exportBackup[\s\S]*PLAIN_JSON_EXPORT_CONFIRMATION/, "export JSON doit demander confirmation forte");
assert.match(storageSource, /restoreLatestAutomaticSnapshot[\s\S]*RESTORE_BACKUP_CONFIRMATION/, "restauration snapshot doit demander confirmation forte");
assert.match(storageSource, /importBackup[\s\S]*RESTORE_BACKUP_CONFIRMATION/, "import backup doit demander confirmation forte");
assert.match(stateSource, /cleanLocalWorkstation[\s\S]*showPromptModal[\s\S]*NETTOYER/, "nettoyage poste doit demander confirmation forte");

[
  "backup.exported",
  "backup.encrypted.exported",
  "backup.safety_snapshot.exported",
  "backup.imported",
  "backup.import_failed",
].forEach((token) => assert.ok(storageSource.includes(token), `journalisation ${token} attendue`));
[
  "backup.cloud.exported",
  "backup.cloud.imported",
  "backup.cloud.import_failed",
].forEach((token) => assert.ok(supabaseSyncSource.includes(token), `journalisation ${token} attendue`));
assert.ok(stateSource.includes("security.workstation_clean_requested"), "journalisation nettoyage poste attendue");
assert.ok(appSource.includes("security.shared_workstation_user_switch"), "changement utilisateur poste partage doit etre journalise");

const supabaseWording = `${indexSource}\n${supabaseClientSource}\n${supabaseConfigSource}\n${supabaseSyncSource}`;
assert.doesNotMatch(supabaseWording, /legacy anon key|clé anon publique|Clé anon publique/i, "ancien wording anon/legacy interdit");
assert.match(supabaseWording, /publishable key \/ clé publique Supabase/, "wording publishable key attendu");
assert.match(supabaseWording, /service_role/, "rappel service_role interdit attendu");
assert.match(supabaseWording, /RLS/, "rappel RLS attendu");
assert.match(supabaseClientSource, /looksLikeSupabaseServiceRoleKey/, "detection service_role attendue");

assert.equal(vehiclesSource, "[]", "data/vehicles.json doit rester vide");
assert.doesNotMatch(swSource, /data\/vehicles\.json/, "data/vehicles.json ne doit pas etre precache");

console.log("Tests v23.2.3 security exports PIN and Supabase hardening OK");
