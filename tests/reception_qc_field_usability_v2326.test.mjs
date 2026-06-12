import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

console.log("Demarrage tests v23.2.6 reception and QC field usability polish...");

const scriptFiles = [
  "js/utils.js",
  "js/state.js",
  "js/storage.js",
  "js/supabase-config.js",
  "js/supabase-client.js",
  "js/supabase-sync.js",
  "js/ui-cases.js",
  "js/ui-reception.js",
];

const source = scriptFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");

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
    options: [],
    children: [],
    elements: {},
    tagName: "DIV",
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {},
    removeAttribute() {},
    remove() {},
    toggleAttribute() {},
    append() {},
    appendChild() {},
    prepend() {},
    replaceChildren() {},
    addEventListener() {},
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
    getElementById: () => stubElement(),
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
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 31 + 17) % 256;
      return bytes;
    },
  },
  $: () => stubElement(),
  $$: () => [],
};
context.window = { ...context.window, ...context };

vm.createContext(context);
vm.runInContext(source, context);
const app = (code) => vm.runInContext(code, context);

const vehiclesSource = fs.readFileSync("data/vehicles.json", "utf8").trim();
const swSource = fs.readFileSync("sw.js", "utf8");
const stateSource = fs.readFileSync("js/state.js", "utf8");
const versionSource = fs.readFileSync("js/version.js", "utf8");
const appSource = fs.readFileSync("app.js", "utf8");
const indexSource = fs.readFileSync("index.html", "utf8");
const uiCasesSource = fs.readFileSync("js/ui-cases.js", "utf8");
const uiReceptionSource = fs.readFileSync("js/ui-reception.js", "utf8");

assert.match(stateSource, /APP_VERSION\s*=\s*"v23\.2\.6"/, "APP_VERSION v23.2.6 attendu");
assert.match(versionSource, /NIMR_CACHE_NAME\s*=\s*"nimr-sav-v23\.2\.6-reception-qc-field-usability"/, "cache annonce v23.2.6 attendu");
assert.match(swSource, /CACHE_NAME\s*=\s*"nimr-sav-v23\.2\.6-reception-qc-field-usability"/, "cache PWA v23.2.6 attendu");
assert.match(appSource, /serviceWorker\.register\("sw\.js\?v=23\.2\.6"/, "service worker v23.2.6 attendu");
assert.match(indexSource, /v=23\.2\.6/, "index.html doit reference v23.2.6");
assert.equal(vehiclesSource, "[]", "data/vehicles.json doit rester []");
assert.doesNotMatch(swSource, /data\/vehicles\.json/, "sw.js ne doit pas precacher data/vehicles.json");
console.log("  [OK] version/cache + data publique");

assert.match(indexSource, /data-filter="created-today"/, "Reception doit proposer le filtre dossiers crees aujourd'hui");
assert.match(uiReceptionSource, /RECEPTION_QUICK_MOTIFS/, "Reception doit declarer des motifs frequents");
assert.match(uiReceptionSource, /reception-quick-motif/, "Reception doit rendre les boutons de motifs frequents");
assert.match(uiReceptionSource, /reception-today-created-summary/, "Reception doit afficher les dossiers crees aujourd'hui");
console.log("  [OK] reception rapide: motifs + dossiers du jour");

assert.match(uiCasesSource, /buildWorkshopFieldGroups/, "Chef Atelier doit disposer de groupes atelier terrain");
[
  "En attente diagnostic",
  "En attente pièce",
  "En réparation",
  "Travail terminé / attente QC",
  "QC refusé / retour atelier",
  "Livrable aujourd'hui",
  "Bloqué > 48h",
  "Bloqué > 7 jours",
].forEach((label) => assert.ok(uiCasesSource.includes(label), `Groupe atelier manquant: ${label}`));
console.log("  [OK] groupes Chef Atelier presents");

assert.match(uiCasesSource, /QC_PRESET_REASONS/, "QC doit proposer des motifs de refus predefinis");
assert.match(uiCasesSource, /Valider QC en 1 clic/, "QC doit proposer la validation 1 clic");
assert.match(uiCasesSource, /qc-quality-note/, "QC doit proposer une note qualite rapide");
assert.match(uiCasesSource, /Retravail terminé — à revalider/, "QC doit afficher les dossiers a revalider");
console.log("  [OK] vue QC amelioree");

app(`
  state.users = [
    { id: "u-admin", name: "Admin technique", role: "admin", active: true, pin: "" },
    { id: "u-dir", name: "Directeur SAV", role: "directeur_sav", active: true, pin: "" },
    { id: "u-qc", name: "Qualite", role: "qualite", active: true, pin: "" },
    { id: "u-rec", name: "Reception", role: "reception", active: true, pin: "" },
    { id: "u-read", name: "Lecture seule", role: "readonly", active: true, pin: "" },
  ];
  state.currentUserId = "u-qc";
  state.ui = {
    savDashboardPeriod: "today",
    savDashboardTypeFilter: "all",
    savDashboardStatusFilter: "all",
  };
  state.resources = [];
  state.bookings = [];
  const now = "2026-06-12T10:00:00.000Z";
  const old = "2026-06-04T09:00:00.000Z";
  state.cases = [
    normalizeCase({ id: "diag-case", clientName: "Client A", plate: "DIAG-1", createdAt: now, updatedAt: now, flags: { received: true, workStarted: false, workCompleted: false, qualityApproved: false, delivered: false }, claims: [{ id: "c1", type: "diagnostic", title: "Diagnostic", clientApproved: true, expertApproved: true }] }),
    normalizeCase({ id: "parts-case", clientName: "Client B", plate: "PARTS-1", createdAt: old, updatedAt: old, partsStatus: "waiting_parts", blockerReason: "waiting_parts", flags: { received: true, workStarted: true, workCompleted: false, qualityApproved: false, delivered: false }, claims: [{ id: "c2", type: "client", title: "Piece", clientApproved: true, expertApproved: true }] }),
    normalizeCase({ id: "repair-case", clientName: "Client C", plate: "REP-1", createdAt: now, updatedAt: now, flags: { received: true, workStarted: true, workCompleted: false, qualityApproved: false, delivered: false }, claims: [{ id: "c3", type: "mechanical_client", title: "Reparation", clientApproved: true, expertApproved: true }] }),
    normalizeCase({ id: "waiting-qc", clientName: "Client D", plate: "QC-1", createdAt: now, updatedAt: now, flags: { received: true, workStarted: true, workCompleted: true, qualityApproved: false, delivered: false }, receptionWorkflow: { sentToWorkshopAt: now, qualityStatus: "not_started" }, claims: [{ id: "c4", type: "client", title: "QC", clientApproved: true, expertApproved: true }] }),
    normalizeCase({ id: "rejected-qc", clientName: "Client E", plate: "QCR-1", createdAt: now, updatedAt: now, flags: { received: true, workStarted: true, workCompleted: true, qualityApproved: false, delivered: false }, receptionWorkflow: { sentToWorkshopAt: now, qualityStatus: "rejected", qualityReturnReason: "Défaut peinture" }, claims: [{ id: "c5", type: "client", title: "QC reject", clientApproved: true, expertApproved: true }] }),
    normalizeCase({ id: "deliverable-today", clientName: "Client F", plate: "LIV-1", createdAt: now, updatedAt: now, appointment: { delivery: "2026-06-12T15:00:00.000Z" }, flags: { received: true, workStarted: true, workCompleted: true, qualityApproved: true, delivered: false }, receptionWorkflow: { qualityStatus: "validated" }, claims: [{ id: "c6", type: "client", title: "Livraison", clientApproved: true, expertApproved: true }] }),
    normalizeCase({ id: "blocked-7d", clientName: "Client G", plate: "BLK-7", createdAt: old, updatedAt: old, partsStatus: "blocked_parts", blockerReason: "waiting_parts", flags: { received: true, workStarted: true, workCompleted: false, qualityApproved: false, delivered: false }, claims: [{ id: "c7", type: "client", title: "Blocage", clientApproved: true, expertApproved: true }] }),
    normalizeCase({ id: "qc-one-click", clientName: "Client H", plate: "OK-1", createdAt: now, updatedAt: now, flags: { received: true, workStarted: true, workCompleted: true, qualityApproved: false, delivered: false }, receptionWorkflow: { sentToWorkshopAt: now, qualityStatus: "not_started" }, claims: [{ id: "c8", type: "client", title: "Validation", clientApproved: true, expertApproved: true }] }),
    normalizeCase({ id: "qc-refuse", clientName: "Client I", plate: "NO-1", createdAt: now, updatedAt: now, flags: { received: true, workStarted: true, workCompleted: true, qualityApproved: false, delivered: false }, receptionWorkflow: { sentToWorkshopAt: now, qualityStatus: "not_started" }, claims: [{ id: "c9", type: "client", title: "Refus", clientApproved: true, expertApproved: true }] }),
    normalizeCase({ id: "delivery-blocked", clientName: "Client J", plate: "WAIT-1", createdAt: now, updatedAt: now, flags: { received: true, workStarted: true, workCompleted: true, qualityApproved: false, delivered: false }, receptionWorkflow: { sentToWorkshopAt: now, qualityStatus: "not_started" }, claims: [{ id: "c10", type: "client", title: "Livraison bloquee", clientApproved: true, expertApproved: true }] }),
    normalizeCase({ id: "notes-case", clientName: "Client K", plate: "NOTE-1", createdAt: now, updatedAt: now, flags: { delivered: false }, claims: [{ id: "c11", type: "client", title: "Notes", clientApproved: true, expertApproved: true }] }),
  ];
`);

const groupCounts = JSON.parse(app(`JSON.stringify(Object.fromEntries(Object.entries(buildWorkshopFieldGroups(new Date("2026-06-12T10:00:00.000Z"))).map(([key, items]) => [key, items.length])))`));
assert.ok(groupCounts.diagnostic >= 1, "Chef Atelier doit voir En attente diagnostic");
assert.ok(groupCounts.parts >= 1, "Chef Atelier doit voir En attente piece");
assert.ok(groupCounts.repair >= 1, "Chef Atelier doit voir En reparation");
assert.ok(groupCounts.workDoneQc >= 1, "Chef Atelier doit voir Travail termine / attente QC");
assert.ok(groupCounts.qcReturn >= 1, "Chef Atelier doit voir QC refuse / retour atelier");
assert.ok(groupCounts.deliverableToday >= 1, "Chef Atelier doit voir Livrable aujourd'hui");
assert.ok(groupCounts.blocked48 >= 1, "Chef Atelier doit voir Bloque > 48h");
assert.ok(groupCounts.blocked7 >= 1, "Chef Atelier doit voir Bloque > 7 jours");
console.log("  [OK] groupes atelier calcules");

const kpiLabels = JSON.parse(app(`JSON.stringify(buildSavKpis(new Date("2026-06-12T10:00:00.000Z")).map((kpi) => kpi.label))`));
[
  "Dossiers ouverts",
  "Bloqués > 48h",
  "Bloqués > 7 jours",
  "Attente QC",
  "QC refusés",
  "Livrables aujourd'hui",
  "Charge réception",
  "Charge atelier",
  "Charge QC",
].forEach((label) => assert.ok(kpiLabels.includes(label), `KPI Directeur SAV manquant: ${label}`));
console.log("  [OK] KPI terrain Directeur SAV");

const qcResults = app(`(() => {
  const validate = advanceReceptionWorkflow("qc-one-click", "update_quality_status", { status: "validated" });
  const reject = advanceReceptionWorkflow("qc-refuse", "update_quality_status", { status: "rejected", reason: "Défaut peinture" });
  const back = advanceReceptionWorkflow("qc-refuse", "return_to_workshop", { reason: "Retour atelier clair" });
  const item = state.cases.find((c) => c.id === "qc-refuse");
  item.flags.workCompleted = true;
  const revalidate = advanceReceptionWorkflow("qc-refuse", "update_quality_status", { status: "validated" });
  return {
    validate,
    reject,
    back,
    revalidate,
    qcOneClick: state.cases.find((c) => c.id === "qc-one-click").receptionWorkflow.qualityStatus,
    qcRefuse: state.cases.find((c) => c.id === "qc-refuse").receptionWorkflow.qualityStatus,
  };
})()`);
assert.equal(qcResults.validate.ok, true, "QC doit pouvoir valider en 1 clic");
assert.equal(qcResults.reject.ok, true, "QC doit pouvoir refuser avec motif predefini");
assert.equal(qcResults.back.ok, true, "QC doit pouvoir renvoyer en atelier");
assert.equal(qcResults.revalidate.ok, true, "QC doit pouvoir revalider apres retravail");
assert.equal(qcResults.qcOneClick, "validated", "Validation 1 clic doit passer le statut a validated");
assert.equal(qcResults.qcRefuse, "validated", "Revalidation QC doit repasser le statut a validated");
console.log("  [OK] transitions QC terrain");

const deliveryBlocked = app(`advanceReceptionWorkflow("delivery-blocked", "deliver_vehicle")`);
assert.equal(deliveryBlocked.ok, false, "Livraison doit rester bloquee si QC non valide");
assert.match(deliveryBlocked.message, /qualit/i, "Message de blocage livraison doit mentionner le QC");
console.log("  [OK] livraison bloquee sans QC valide");

const notesVisibility = app(`(() => {
  state.currentUserId = "u-admin";
  updateCaseNote("notes-case", "direction", "Secret direction terrain");
  const item = state.cases.find((c) => c.id === "notes-case");
  return {
    directeur: JSON.stringify(getCaseNotesForRole(item, "directeur_sav")),
    admin: JSON.stringify(getCaseNotesForRole(item, "admin")),
    reception: JSON.stringify(getCaseNotesForRole(item, "reception")),
    qualite: JSON.stringify(getCaseNotesForRole(item, "qualite")),
    readonly: JSON.stringify(getCaseNotesForRole(item, "readonly")),
  };
})()`);
assert.match(notesVisibility.directeur, /Secret direction terrain/, "Directeur SAV doit voir les notes direction");
assert.match(notesVisibility.admin, /Secret direction terrain/, "Admin autorise doit voir les notes direction");
assert.doesNotMatch(notesVisibility.reception, /Secret direction terrain/, "Reception ne doit pas voir les notes direction");
assert.doesNotMatch(notesVisibility.qualite, /Secret direction terrain/, "Qualite ne doit pas voir les notes direction");
assert.doesNotMatch(notesVisibility.readonly, /Secret direction terrain/, "Lecture seule ne doit pas voir les notes direction");
console.log("  [OK] notes direction protegees");

// Scénarios de robustesse et de checklist QC (v23.2.6)
const robustCheck = app(`(() => {
  // Dossier sans checklist QC (qualityChecklist absent ou undefined)
  const caseNoChecklist = normalizeCase({
    id: "case-no-checklist",
    clientName: "Client No Checklist",
    plate: "NOCK-1",
    flags: { received: true, workCompleted: true, qualityApproved: false },
    receptionWorkflow: { sentToWorkshopAt: "2026-06-12T10:00:00.000Z", qualityStatus: "not_started" }
  });
  delete caseNoChecklist.qualityChecklist;

  // Dossier avec checklist partielle
  const casePartialChecklist = normalizeCase({
    id: "case-partial-checklist",
    clientName: "Client Partial",
    plate: "PART-1",
    flags: { received: true, workCompleted: true, qualityApproved: false },
    receptionWorkflow: { sentToWorkshopAt: "2026-06-12T10:00:00.000Z", qualityStatus: "not_started" },
    qualityChecklist: {}
  });
  // Seul le premier élément est validé
  if (Array.isArray(DEFAULT_QUALITY_CHECKS) && DEFAULT_QUALITY_CHECKS.length > 0) {
    casePartialChecklist.qualityChecklist[DEFAULT_QUALITY_CHECKS[0]] = true;
  }

  // Dossier avec checklist complète
  const caseCompleteChecklist = normalizeCase({
    id: "case-complete-checklist",
    clientName: "Client Complete",
    plate: "COMP-1",
    flags: { received: true, workCompleted: true, qualityApproved: false },
    receptionWorkflow: { sentToWorkshopAt: "2026-06-12T10:00:00.000Z", qualityStatus: "not_started" },
    qualityChecklist: {}
  });
  if (Array.isArray(DEFAULT_QUALITY_CHECKS)) {
    DEFAULT_QUALITY_CHECKS.forEach((k) => {
      caseCompleteChecklist.qualityChecklist[k] = true;
    });
  }

  // Injecter ces cas
  state.cases.push(caseNoChecklist, casePartialChecklist, caseCompleteChecklist);

  // Vérifier la fonction isCaseQualityChecklistComplete
  const resNo = isCaseQualityChecklistComplete(caseNoChecklist);
  const resPart = isCaseQualityChecklistComplete(casePartialChecklist);
  const resComp = isCaseQualityChecklistComplete(caseCompleteChecklist);

  // Exécuter buildSavKpis, buildPilotageAlerts et buildSavPerformanceDashboard pour prouver la robustesse
  let didKpiCrash = false;
  let didAlertCrash = false;
  try {
    buildSavKpis(new Date("2026-06-12T10:00:00.000Z"));
  } catch (e) {
    didKpiCrash = true;
  }

  try {
    buildPilotageAlerts(new Date("2026-06-12T10:00:00.000Z"), { cases: state.cases });
  } catch (e) {
    didAlertCrash = true;
  }

  return { resNo, resPart, resComp, didKpiCrash, didAlertCrash };
})()`);

assert.equal(robustCheck.resNo, false, "Un dossier sans checklist QC ne doit pas être complet");
assert.equal(robustCheck.resPart, false, "Un dossier avec checklist partielle ne doit pas être complet");
assert.equal(robustCheck.resComp, true, "Un dossier avec checklist complète doit être complet");
assert.equal(robustCheck.didKpiCrash, false, "buildSavKpis ne doit jamais planter");
assert.equal(robustCheck.didAlertCrash, false, "buildPilotageAlerts ne doit jamais planter");
console.log("  [OK] robustesse KPI, alertes et checklists QC validée");

assert.match(uiCasesSource, /data-workshop-field-groups/, "Synthese atelier doit etre identifiee pour l'UI");
assert.match(uiCasesSource, /qc-preset-reason/, "Motifs QC predefinis doivent etre cliquables");
assert.match(uiReceptionSource, /applyReceptionQuickMotif/, "Raccourcis reception doivent etre relies au formulaire");

console.log("Tests v23.2.6 reception and QC field usability polish OK");

