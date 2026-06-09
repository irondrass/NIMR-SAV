import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

console.log("Demarrage tests v23.2.5 role-based workspaces and dedicated QC view...");

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

// ─── 1. Version & Cache ─────────────────────────────────────────────────────
const vehiclesSource = fs.readFileSync("data/vehicles.json", "utf8").trim();
const swSource       = fs.readFileSync("sw.js", "utf8");
const stateSource    = fs.readFileSync("js/state.js", "utf8");
const versionSource  = fs.readFileSync("js/version.js", "utf8");
const appSource      = fs.readFileSync("app.js", "utf8");
const indexSource    = fs.readFileSync("index.html", "utf8");
const uiCasesSource  = fs.readFileSync("js/ui-cases.js", "utf8");
const supabaseSyncSource = fs.readFileSync("js/supabase-sync.js", "utf8");

assert.equal(vehiclesSource, "[]", "data/vehicles.json doit rester vide");
assert.doesNotMatch(swSource, /data\/vehicles\.json/, "data/vehicles.json ne doit pas etre precache");

assert.match(stateSource, /APP_VERSION\s*=\s*"v23\.2\.5"/, "state.js doit utiliser v23.2.5");
assert.match(swSource, /CACHE_NAME\s*=\s*"nimr-sav-v23\.2\.5-role-based-workspaces-qc-view"/, "sw.js doit utiliser le cache v23.2.5");
assert.match(versionSource, /APP_VERSION\s*=\s*"v23\.2\.5"/, "version.js doit exposer APP_VERSION v23.2.5");
assert.match(versionSource, /NIMR_CACHE_NAME\s*=\s*"nimr-sav-v23\.2\.5-role-based-workspaces-qc-view"/, "version.js doit exposer NIMR_CACHE_NAME v23.2.5");
assert.match(appSource, /serviceWorker\.register\("sw\.js\?v=23\.2\.5"/, "app.js doit enregistrer sw.js?v=23.2.5");
assert.match(indexSource, /v=23\.2\.5/, "index.html doit reference v23.2.5");
console.log("  [OK] Version & cache v23.2.5");

// ─── 2. guardUserSwitch ─────────────────────────────────────────────────────
app(`
  // Reset state
  state.currentUserId = null;
  state.users = [
    { id: "u-admin", name: "Admin", role: "admin", active: true, pin: "" },
    { id: "u-chef", name: "Chef", role: "chef_atelier", active: true, pin: "" },
    { id: "u-qualite", name: "Qualite", role: "qualite", active: true, pin: "" },
    { id: "u-reception", name: "Reception", role: "reception", active: true, pin: "" },
    { id: "u-tech", name: "Tech", role: "technicien", active: true, pin: "" },
    { id: "u-dir", name: "Directeur", role: "directeur_sav", active: true, pin: "" },
    { id: "u-readonly", name: "ReadOnly", role: "readonly", active: true, pin: "" },
  ];
`);

// No session: ok
{
  const result = app(`guardUserSwitch()`);
  assert.equal(result.ok, true, "guardUserSwitch() doit retourner ok=true quand aucune session active");
  const tabs = app(`JSON.stringify(getAllowedTabsForCurrentUser())`);
  assert.equal(tabs, "[]", "aucune session active ne doit heriter des onglets admin");
}
console.log("  [OK] guardUserSwitch: pas de session => ok=true");

// Admin: ok
{
  app(`state.currentUserId = "u-admin";`);
  const result = app(`guardUserSwitch()`);
  assert.equal(result.ok, true, "guardUserSwitch() doit retourner ok=true pour Admin");
}
console.log("  [OK] guardUserSwitch: admin => ok=true");

// Chef Atelier: blocked
{
  app(`state.currentUserId = "u-chef";`);
  const result = app(`guardUserSwitch()`);
  assert.equal(result.ok, false, "guardUserSwitch() doit bloquer le Chef Atelier");
  assert.ok(result.message && result.message.length > 0, "guardUserSwitch() doit fournir un message d'erreur");
}
console.log("  [OK] guardUserSwitch: chef_atelier => ok=false (bloque)");

// Qualite: blocked
{
  app(`state.currentUserId = "u-qualite";`);
  const result = app(`guardUserSwitch()`);
  assert.equal(result.ok, false, "guardUserSwitch() doit bloquer le role qualite");
}
console.log("  [OK] guardUserSwitch: qualite => ok=false (bloque)");

// Directeur SAV: blocked (pas users.manage)
{
  app(`state.currentUserId = "u-dir";`);
  const result = app(`guardUserSwitch()`);
  assert.equal(result.ok, false, "guardUserSwitch() doit bloquer le Directeur SAV");
}
console.log("  [OK] guardUserSwitch: directeur_sav => ok=false (bloque)");

// ─── 3. Admin : users.manage permission ─────────────────────────────────────
{
  app(`state.currentUserId = "u-admin";`);
  const canManage = app(`hasPermission("users.manage")`);
  assert.equal(canManage, true, "Admin doit avoir users.manage");

  app(`state.currentUserId = "u-chef";`);
  const chefCannotManage = app(`hasPermission("users.manage")`);
  assert.equal(chefCannotManage, false, "Chef Atelier ne doit pas avoir users.manage");

  app(`state.currentUserId = "u-dir";`);
  const dirCannotManage = app(`hasPermission("users.manage")`);
  assert.equal(dirCannotManage, false, "Directeur SAV ne doit pas avoir users.manage");
}
console.log("  [OK] users.manage : reserve a admin uniquement");

// Directeur SAV : pilotage metier sans administration technique
{
  app(`state.currentUserId = "u-dir";`);
  const allowedTabs = app(`JSON.stringify(getAllowedTabsForRole("directeur_sav"))`);
  assert.equal(
    allowedTabs,
    JSON.stringify(["dossiers", "today", "pilotage", "planning", "qc-workspace", "atelier"]),
    "Directeur SAV doit avoir uniquement les workspaces metier valides"
  );
  for (const permission of ["users.manage", "supabase.configure", "settings.edit", "import.backup", "case.delete"]) {
    const allowed = app(`hasPermission("${permission}")`);
    assert.equal(allowed, false, `Directeur SAV ne doit pas avoir ${permission}`);
  }
  for (const permission of ["dashboard.view", "export.backup", "quality.validate", "quality.reject", "quality.revalidate", "notes.direction"]) {
    const allowed = app(`hasPermission("${permission}")`);
    assert.equal(allowed, true, `Directeur SAV doit garder ${permission}`);
  }
}
console.log("  [OK] Directeur SAV : workspaces metier sans admin technique");

// ─── 4. Matrice d'accès aux tabs par rôle ────────────────────────────────────
const tabMatrix = {
  admin:         { "qc-workspace": true, "atelier": true, "technician": true, "planning": true, "reception-workspace": true, "pilotage": true },
  directeur_sav: { "qc-workspace": true, "atelier": true, "technician": false, "planning": true, "reception-workspace": false, "pilotage": true },
  chef_atelier:  { "qc-workspace": false, "atelier": true, "technician": true, "planning": true, "reception-workspace": true, "pilotage": true },
  reception:     { "qc-workspace": false, "atelier": false, "technician": false, "reception-workspace": true },
  technicien:    { "qc-workspace": false, "atelier": false, "reception-workspace": false, "technician": true },
  qualite:       { "qc-workspace": true, "atelier": false, "reception-workspace": false, "technician": false, "pilotage": false },
  readonly:      { "qc-workspace": false, "atelier": false, "reception-workspace": false, "pilotage": true, "dossiers": false },
};

for (const [role, tabs] of Object.entries(tabMatrix)) {
  for (const [tab, expected] of Object.entries(tabs)) {
    const userId = `u-${role === "directeur_sav" ? "dir" : role === "chef_atelier" ? "chef" : role === "technicien" ? "tech" : role}`;
    app(`state.currentUserId = "${userId}";`);
    const allowed = app(`getAllowedTabsForRole("${role}").includes("${tab}")`);
    assert.equal(allowed, expected, `Role ${role}: tab "${tab}" expected ${expected} but got ${allowed}`);
  }
}
console.log("  [OK] Matrice d'acces aux tabs par role");

// ─── 5. getDefaultTabForRole ────────────────────────────────────────────────
const defaultTabExpected = {
  admin:         "dossiers",
  directeur_sav: "pilotage",
  chef_atelier:  "planning",
  reception:     "reception-workspace",
  technicien:    "technician",
  qualite:       "qc-workspace",
  readonly:      "pilotage",
};

for (const [role, expectedTab] of Object.entries(defaultTabExpected)) {
  const result = app(`getDefaultTabForRole("${role}")`);
  assert.equal(result, expectedTab, `getDefaultTabForRole("${role}") doit retourner "${expectedTab}" mais retourne "${result}"`);
}
console.log("  [OK] getDefaultTabForRole: mapping role => tab correct");

// ─── 6. Vue QC — classification des dossiers ────────────────────────────────
app(`
  const now = new Date().toISOString();
  const qcCase1 = normalizeCase({
    id: "qc-case-1",
    clientName: "Client QC Pending",
    flags: { workCompleted: true, delivered: false, qualityApproved: false },
    receptionWorkflow: { qualityStatus: "" },
  });
  const qcCase2 = normalizeCase({
    id: "qc-case-2",
    clientName: "Client QC Rejected",
    flags: { workCompleted: false, delivered: false },
    receptionWorkflow: { qualityStatus: "rejected" },
  });
  const qcCase3 = normalizeCase({
    id: "qc-case-3",
    clientName: "Client QC Rework Done",
    flags: { workCompleted: true, delivered: false },
    receptionWorkflow: { qualityStatus: "rework" },
  });
  const qcCase4 = normalizeCase({
    id: "qc-case-4",
    clientName: "Client Delivered",
    flags: { workCompleted: true, delivered: true, qualityApproved: true },
    receptionWorkflow: { qualityStatus: "validated" },
  });
  state.cases = [qcCase1, qcCase2, qcCase3, qcCase4];
`);

{
  // Pending: workCompleted=true, NOT delivered, qualityStatus "not_started" (default for empty)
  const isPending = app(`
    (function() {
      const c = state.cases.find(c => c.id === "qc-case-1");
      const rw = c.receptionWorkflow || {};
      const qStatus = normalizeQualityStatus(rw.qualityStatus);
      // not_started est le statut par defaut quand qualityStatus est vide
      return c.flags.workCompleted && !c.flags.delivered &&
        (!qStatus || qStatus === "not_started" || qStatus === "in_progress");
    })()
  `);
  assert.equal(isPending, true, "qc-case-1 doit etre en attente QC (not_started)");
}
console.log("  [OK] QC workspace: dossier en attente QC detecte");

{
  // Rejected: qualityStatus === "rejected"
  const isRejected = app(`
    (function() {
      const c = state.cases.find(c => c.id === "qc-case-2");
      const rw = c.receptionWorkflow || {};
      const qStatus = normalizeQualityStatus(rw.qualityStatus);
      return qStatus === "rejected" && !c.flags.delivered;
    })()
  `);
  assert.equal(isRejected, true, "qc-case-2 doit etre en etat refuse");
}
console.log("  [OK] QC workspace: dossier refuse QC detecte");

{
  // Rework done: qualityStatus === "rework" AND workCompleted
  const isReworkDone = app(`
    (function() {
      const c = state.cases.find(c => c.id === "qc-case-3");
      const rw = c.receptionWorkflow || {};
      const qStatus = normalizeQualityStatus(rw.qualityStatus);
      return qStatus === "rework" && c.flags.workCompleted && !c.flags.delivered;
    })()
  `);
  assert.equal(isReworkDone, true, "qc-case-3 doit etre retravail termine a revalider");
}
console.log("  [OK] QC workspace: retravail termine a revalider detecte");

{
  // Livré ne doit pas apparaitre dans les listes QC
  const deliveredExcluded = app(`
    (function() {
      const c = state.cases.find(c => c.id === "qc-case-4");
      return c.flags.delivered === true;
    })()
  `);
  assert.equal(deliveredExcluded, true, "qc-case-4 (livre) doit etre exclu des listes QC");
}
console.log("  [OK] QC workspace: dossiers livres exclus");

// ─── 7. Livraison bloquee si QC non valide ──────────────────────────────────
{
  app(`
    const pendingQcCase = normalizeCase({
      id: "qc-blocked-delivery",
      clientName: "Client Non QC",
      flags: { workCompleted: true, qualityApproved: false },
      receptionWorkflow: { qualityStatus: "pending" },
    });
    state.cases = [pendingQcCase];
    state.currentUserId = "u-admin";
  `);
  const deliveryRes = app(`advanceReceptionWorkflow("qc-blocked-delivery", "deliver_vehicle", {})`);
  assert.equal(deliveryRes.ok, false, "Livraison doit etre bloquee si QC non valide");
  assert.ok(deliveryRes.message && deliveryRes.message.length > 0, "Message d'erreur livraison attendu");
}
console.log("  [OK] Livraison bloquee si QC non valide");

// ─── 8. Notes par rôle — getCaseNotesForRole ────────────────────────────────
app(`
  const noteCase = normalizeCase({
    id: "note-case-1",
    notes: {
      reception:  "Note reception test",
      technique:  "Note technique test",
      qualite:    "Note qualite test",
      direction:  "Note direction confidentielle",
    },
  });
  state.cases = [noteCase];
`);

// admin: voit tout
{
  const notes = app(`getCaseNotesForRole(state.cases[0], "admin")`);
  assert.ok("direction" in notes, "admin doit voir les notes direction");
  assert.ok("reception" in notes, "admin doit voir les notes reception");
  assert.ok("qualite" in notes, "admin doit voir les notes qualite");
}
console.log("  [OK] getCaseNotesForRole: admin voit toutes les notes");

// directeur_sav: voit direction
{
  const notes = app(`getCaseNotesForRole(state.cases[0], "directeur_sav")`);
  assert.ok("direction" in notes, "directeur_sav doit voir les notes direction");
  assert.ok("qualite" in notes, "directeur_sav doit voir les notes qualite");
}
console.log("  [OK] getCaseNotesForRole: directeur_sav voit direction + qualite + reception + technique");

// chef_atelier: voit reception, technique, qualite — pas direction
{
  const notes = app(`getCaseNotesForRole(state.cases[0], "chef_atelier")`);
  assert.ok("reception" in notes, "chef_atelier doit voir notes reception");
  assert.ok("qualite" in notes, "chef_atelier doit voir notes qualite");
  assert.ok(!("direction" in notes), "chef_atelier ne doit PAS voir notes direction");
}
console.log("  [OK] getCaseNotesForRole: chef_atelier NE voit PAS direction");

// reception: voit reception, technique — pas qualite, pas direction
{
  const notes = app(`getCaseNotesForRole(state.cases[0], "reception")`);
  assert.ok("reception" in notes, "reception doit voir ses propres notes");
  assert.ok("technique" in notes, "reception doit voir notes technique");
  assert.ok(!("qualite" in notes), "reception ne doit PAS voir notes qualite");
  assert.ok(!("direction" in notes), "reception ne doit PAS voir notes direction");
}
console.log("  [OK] getCaseNotesForRole: reception NE voit PAS direction ni qualite");

// technicien: voit uniquement technique
{
  const notes = app(`getCaseNotesForRole(state.cases[0], "technicien")`);
  assert.ok("technique" in notes, "technicien doit voir notes technique");
  assert.ok(!("reception" in notes), "technicien ne doit PAS voir notes reception");
  assert.ok(!("qualite" in notes), "technicien ne doit PAS voir notes qualite");
  assert.ok(!("direction" in notes), "technicien ne doit PAS voir notes direction");
}
console.log("  [OK] getCaseNotesForRole: technicien voit uniquement technique");

// qualite: voit technique + qualite — pas direction, pas reception
{
  const notes = app(`getCaseNotesForRole(state.cases[0], "qualite")`);
  assert.ok("technique" in notes, "qualite doit voir notes technique");
  assert.ok("qualite" in notes, "qualite doit voir notes qualite");
  assert.ok(!("direction" in notes), "qualite ne doit PAS voir notes direction");
  assert.ok(!("reception" in notes), "qualite ne doit PAS voir notes reception");
}
console.log("  [OK] getCaseNotesForRole: qualite NE voit PAS direction ni reception");

// readonly: voit rien
{
  const notes = app(`getCaseNotesForRole(state.cases[0], "readonly")`);
  assert.equal(Object.keys(notes).length, 0, "readonly ne doit voir aucune note");
}
console.log("  [OK] getCaseNotesForRole: readonly voit aucune note");

// ─── 9. updateCaseNote — permissions ────────────────────────────────────────
app(`
  const updCase = normalizeCase({ id: "update-note-case", clientName: "Update Test" });
  state.cases = [updCase];
`);

// Technicien ne peut pas modifier note direction
{
  app(`state.currentUserId = "u-tech";`);
  const res = app(`updateCaseNote("update-note-case", "direction", "contenu confidentiel")`);
  assert.equal(res.ok, false, "technicien ne doit pas pouvoir modifier note direction");
}
console.log("  [OK] updateCaseNote: technicien bloque sur note direction");

// Qualite ne peut pas modifier note direction
{
  app(`state.currentUserId = "u-qualite";`);
  const res = app(`updateCaseNote("update-note-case", "direction", "contenu confidentiel")`);
  assert.equal(res.ok, false, "qualite ne doit pas pouvoir modifier note direction");
}
console.log("  [OK] updateCaseNote: qualite bloque sur note direction");

// Admin peut modifier note direction
{
  app(`state.currentUserId = "u-admin";`);
  const res = app(`updateCaseNote("update-note-case", "direction", "Note direction admin")`);
  assert.equal(res.ok, true, "admin doit pouvoir modifier note direction");
  const content = app(`state.cases.find(c => c.id === "update-note-case").notes.direction`);
  assert.equal(content, "Note direction admin", "note direction doit etre mise a jour");
}
console.log("  [OK] updateCaseNote: admin peut modifier note direction");

// Directeur SAV peut modifier note direction
{
  app(`state.currentUserId = "u-dir";`);
  const res = app(`updateCaseNote("update-note-case", "direction", "Note direction directeur")`);
  assert.equal(res.ok, true, "directeur_sav doit pouvoir modifier note direction");
}
console.log("  [OK] updateCaseNote: directeur_sav peut modifier note direction");

// ─── 10. normalizeCase — champ notes initialisé ──────────────────────────────
{
  const normalized = app(`normalizeCase({ id: "norm-test", clientName: "Test" })`);
  assert.ok(normalized && typeof normalized.notes === "object", "normalizeCase doit initialiser notes");
  assert.ok("reception" in normalized.notes, "notes.reception doit exister");
  assert.ok("technique" in normalized.notes, "notes.technique doit exister");
  assert.ok("qualite" in normalized.notes, "notes.qualite doit exister");
  assert.ok("direction" in normalized.notes, "notes.direction doit exister");
}
console.log("  [OK] normalizeCase: champ notes initialise avec 4 champs");

// ─── 11. ROLE_TABS — contient qc-workspace pour qualite et admin ─────────────
assert.match(stateSource, /qualite.*qc-workspace|qc-workspace.*qualite/, "ROLE_TABS qualite doit inclure qc-workspace");
assert.match(stateSource, /admin.*qc-workspace|qc-workspace.*admin/, "ROLE_TABS admin doit inclure qc-workspace");
assert.match(stateSource, /directeur_sav.*qc-workspace|qc-workspace.*directeur_sav/, "ROLE_TABS directeur_sav doit inclure qc-workspace");
console.log("  [OK] ROLE_TABS: qc-workspace present pour qualite, admin, directeur_sav");

// ─── 12. index.html — view-qc-workspace present ─────────────────────────────
assert.match(indexSource, /id="view-qc-workspace" hidden/, "index.html doit contenir view-qc-workspace masque par defaut");
assert.match(indexSource, /data-tab="qc-workspace"/, "index.html doit contenir nav button qc-workspace");
assert.match(indexSource, /users-roles-panel" data-admin-technical-panel/, "panneau utilisateurs doit etre marque admin technique");
assert.match(indexSource, /security-panel" data-admin-technical-panel/, "panneau securite poste doit etre marque admin technique");
assert.match(indexSource, /supabase-panel" data-admin-technical-panel/, "panneau Supabase doit etre marque admin technique");
console.log("  [OK] index.html: view-qc-workspace et panneaux admin technique");

// ─── 13. ui-cases.js — renderQcWorkspace definie ─────────────────────────────
assert.match(uiCasesSource, /function renderQcWorkspace\(\)/, "ui-cases.js doit definir renderQcWorkspace");
assert.match(uiCasesSource, /qc-workspace/, "ui-cases.js doit inclure qc-workspace dans la liste des tabs bloqués");
assert.match(uiCasesSource, /function renderNavigationVisibility\(\)/, "ui-cases.js doit filtrer les onglets par role");
assert.match(uiCasesSource, /function renderAdminTechnicalVisibility\(\)/, "ui-cases.js doit masquer les panneaux admin technique hors Admin");
assert.match(uiCasesSource, /escapeHtml\(c\.clientName/, "cartes QC doivent echapper les noms clients");
assert.match(uiCasesSource, /escapeAttr\(c\.id/, "cartes QC doivent echapper les identifiants en attribut");
console.log("  [OK] ui-cases.js: renderQcWorkspace, acces et echappement presents");

// ─── 14. data/vehicles.json = [] et non precache ─────────────────────────────
assert.equal(vehiclesSource, "[]", "data/vehicles.json doit etre []");
assert.doesNotMatch(swSource, /data\/vehicles\.json/, "data/vehicles.json ne doit pas etre precache dans sw.js");
console.log("  [OK] data/vehicles.json = [] et non precache");

// ─── 15. quality.revalidate — permissions ────────────────────────────────────
assert.match(stateSource, /quality\.revalidate/, "state.js doit definir quality.revalidate");
{
  app(`state.currentUserId = "u-qualite";`);
  const canRevalidate = app(`hasPermission("quality.revalidate")`);
  assert.equal(canRevalidate, true, "qualite doit avoir quality.revalidate");

  app(`state.currentUserId = "u-chef";`);
  const chefRevalidate = app(`hasPermission("quality.revalidate")`);
  assert.equal(chefRevalidate, true, "chef_atelier doit avoir quality.revalidate");

  app(`state.currentUserId = "u-reception";`);
  const recepNoRevalidate = app(`hasPermission("quality.revalidate")`);
  assert.equal(recepNoRevalidate, false, "reception ne doit pas avoir quality.revalidate");
}
console.log("  [OK] quality.revalidate: permissions correctes");

// ─── 16. Bouton Changer => Deconnexion pour non-admin ───────────────────────
assert.match(appSource, /changeBtn\.textContent = isAdmin \? "Changer" : "Déconnexion"/, "bouton sidebar doit devenir Deconnexion hors admin");
assert.match(appSource, /settingsChangeBtn\.textContent = isAdmin \? "Changer d'utilisateur" : "Déconnexion"/, "bouton parametres doit devenir Deconnexion hors admin");
assert.match(appSource, /function triggerLogout\(\)[\s\S]*state\.currentUserId = ""/, "triggerLogout doit effacer la session active");
const changeScreenSource = appSource.slice(appSource.indexOf("function triggerUserChangeScreen"), appSource.indexOf("function triggerLogout"));
assert.doesNotMatch(changeScreenSource, /notifyUser/, "clic Deconnexion non-admin ne doit pas afficher une erreur de changement utilisateur");
console.log("  [OK] Bouton Changer: non-admin => deconnexion propre");

// ─── 17. Notes direction sync + audit confidentiel ──────────────────────────
assert.match(supabaseSyncSource, /function buildRepairOrderNotesForSync/, "Supabase doit construire les notes dossier synchronisees");
assert.match(supabaseSyncSource, /roleNotes\.direction/, "note direction doit etre incluse dans la synchronisation dossier Supabase");
assert.match(stateSource, /\[contenu confidentiel\]/, "audit note direction ne doit pas exposer le contenu complet");
assert.match(stateSource, /saveState\(\{ flushCloud: true, cloudReason: "case-note" \}\)/, "mise a jour note doit declencher sync cloud");
console.log("  [OK] Notes direction: sync Supabase et audit sans contenu complet");

console.log("\nTous les tests v23.2.5 role-based workspaces and dedicated QC view PASSES.");
