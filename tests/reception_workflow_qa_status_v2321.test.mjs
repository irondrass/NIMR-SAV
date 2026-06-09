import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

console.log("Demarrage tests v23.2.5 reception workflow QA/status...");

const scriptFiles = [
  "js/utils.js",
  "js/state.js",
  "js/ui-cases.js",
  "js/photos.js",
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
    elements: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {},
    removeAttribute() {},
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

const context = {
  console,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 },
  document: {
    querySelector: () => stubElement(),
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => stubElement(),
    body: stubElement(),
  },
  window: { addEventListener() {} },
  navigator: { onLine: true },
  fetch: async () => ({ ok: false }),
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval: () => {},
  Blob,
  URL: { createObjectURL: () => "", revokeObjectURL() {} },
  FileReader: class {},
  crypto: { randomUUID: () => `id-${Math.random().toString(16).slice(2)}` },
};
context.window = { ...context.window, ...context };

vm.createContext(context);
vm.runInContext(source, context);
const app = (code) => vm.runInContext(code, context);

const stateSource = fs.readFileSync("js/state.js", "utf8");
const swSource = fs.readFileSync("sw.js", "utf8");
assert.match(stateSource, /APP_VERSION\s*=\s*"v23\.2\.5"/, "APP_VERSION v23.2.5 attendu");
assert.match(swSource, /nimr-sav-v23\.2\.5-role-based-workspaces-qc-view/, "cache PWA v23.2.5 attendu");
assert.equal(swSource.includes("./data/vehicles.json"), false, "data/vehicles.json ne doit pas etre precache");
assert.deepEqual(JSON.parse(fs.readFileSync("data/vehicles.json", "utf8")), [], "data/vehicles.json doit rester public vide");

const statusValues = app("CASE_STATUS_DEFINITIONS.map(([value]) => value)");
const statusLabels = app("CASE_STATUS_DEFINITIONS.map(([, label]) => label)");
assert.equal(new Set(statusValues).size, statusValues.length, "les statuts dossier doivent etre uniques");
assert.equal(statusValues.includes("estimate"), false, "estimate ne doit plus etre un statut metier actif");
assert.equal(statusLabels.includes("Fiche dossier"), false, "Fiche dossier ne doit plus etre un libelle statut actif");
assert.equal(app("normalizeCaseStatusFilter('estimate')"), "receptionDraft", "estimate doit rester un alias legacy");
assert.equal(app("isValidCaseStatusTransition('quality', 'qualityRejected')"), true, "QC valide -> QC refuse doit etre une transition connue");
assert.equal(app("isValidCaseStatusTransition('qualityRejected', 'qualityRework')"), true, "QC refuse -> retravail doit etre une transition connue");

app(`
  state = normalizeState({
    users: [
      { id: 'u-admin', name: 'Admin technique', role: 'admin', active: true },
      { id: 'u-directeur', name: 'Directeur SAV', role: 'directeur_sav', active: true },
      { id: 'u-readonly', name: 'Lecture seule', role: 'readonly', active: true }
    ],
    currentUserId: 'u-admin',
    resources: [{ id: 'tech-1', name: 'Technicien', role: 'mecanicien', active: true }],
    ui: { savDashboardPeriod: 'today', savDashboardStatusFilter: 'all', savDashboardTypeFilter: 'all' },
    cases: [
      {
        id: 'case-active',
        clientName: 'Client Recherche',
        phone: '+216 55 111 222',
        driverName: 'Depot One',
        driverPhone: '+216 22 333 444',
        vehicle: 'Peugeot 208',
        plate: '123 TU 456',
        vin: 'VF3ABCDEFG1234567',
        orNavNumber: 'OR-2026-123',
        createdAt: '2026-06-08T08:00:00.000Z',
        flags: { received: true, workStarted: true, workCompleted: true },
        receptionWorkflow: { sentToWorkshopAt: '2026-06-08T08:30:00.000Z', qualityStatus: 'not_started' },
        claims: [{ number: 'OT-ABC', orNumber: 'OR-CLAIM-9', type: 'client', includeInPlanning: true, clientApproved: true, expertApproved: true }],
        qualityChecklist: Object.fromEntries(DEFAULT_QUALITY_CHECKS.map((label) => [label, true])),
        history: []
      },
      {
        id: 'case-closed',
        clientName: 'Client Clos',
        phone: '+216 99 000 111',
        plate: '999 TU 888',
        vin: 'VF3ZZZZZZZZ123456',
        orNavNumber: 'OR-CLOSED-1',
        createdAt: '2026-06-01T08:00:00.000Z',
        deliveredAt: '2026-06-08T09:00:00.000Z',
        flags: { received: true, workStarted: true, workCompleted: true, qualityApproved: true, delivered: true, invoiced: true },
        receptionWorkflow: { qualityStatus: 'validated', deliveredAt: '2026-06-08T09:00:00.000Z' },
        claims: [{ number: 'OT-CLOSED', type: 'client', includeInPlanning: true, clientApproved: true, expertApproved: true }],
        history: []
      }
    ],
    bookings: [{ id: 'booking-active', caseId: 'case-active', resourceIds: ['tech-1'], segments: [{ start: '2026-06-08T08:00:00.000Z', end: '2026-06-08T09:00:00.000Z' }], start: '2026-06-08T08:00:00.000Z', end: '2026-06-08T09:00:00.000Z' }]
  });
`);

for (const query of ["Client Recherche", "55111222", "123TU456", "vf3abcdefg1234567", "OR-2026-123", "OT-ABC"]) {
  assert.equal(app(`caseMatchesGlobalSearch(state.cases[0], ${JSON.stringify(query)})`), true, `recherche active manquante: ${query}`);
}
assert.equal(app(`caseMatchesGlobalSearch(state.cases[1], 'OR-CLOSED-1')`), true, "la recherche doit inclure les dossiers clos locaux");

let validation = app(`validateReceptionCaseCandidate({ clientName: 'Client', phone: 'abc', plate: '', vin: '', mileage: '12A' })`);
assert.equal(validation.ok, false, "creation sans immat/VIN et formats invalides doit etre bloquee");
assert.ok(validation.messages.some((message) => /immatriculation ou un VIN/i.test(message)), "message identite vehicule attendu");
assert.ok(validation.messages.some((message) => /t.l.phone client/i.test(message)), "message telephone attendu");
assert.ok(validation.messages.some((message) => /kilom.trage/i.test(message)), "message kilometrage attendu");
validation = app(`validateReceptionCaseCandidate({ clientName: 'Client', phone: '+216 55 111 222', plate: '123 TU 456', mileage: '120000' })`);
assert.equal(validation.ok, true, "creation avec identite vehicule et formats valides doit passer");
validation = app(`validateReceptionCaseCandidate({ clientName: 'Client', plate: 'VF3ABCDEFG1234567' })`);
assert.equal(validation.ok, true, "VIN saisi dans le champ immatriculation doit etre reconnu");
assert.equal(validation.normalized.vin, "VF3ABCDEFG1234567", "VIN doit etre deplace dans le champ vin normalise");

app(`
  state.currentUserId = 'u-admin';
  state.cases[0].flags.qualityApproved = false;
  state.cases[0].flags.workCompleted = true;
  state.cases[0].receptionWorkflow.qualityStatus = 'not_started';
`);
let result = app(`advanceReceptionWorkflow('case-active', 'update_quality_status', { status: 'rejected', reason: 'Defaut peinture' })`);
assert.equal(result.ok, true, "QC refuse doit etre accepte avec motif");
assert.equal(app(`getCaseStatus(state.cases[0])`), "qualityRejected", "statut dossier QC refuse attendu");
assert.equal(app(`state.cases[0].flags.qualityApproved`), false, "QC refuse doit retirer qualityApproved");
assert.ok(app(`state.cases[0].history.some((entry) => /QC refus/i.test(entry.label))`), "historique QC refuse attendu");

result = app(`advanceReceptionWorkflow('case-active', 'return_to_workshop', { reason: 'Reprise voile pare-chocs' })`);
assert.equal(result.ok, true, "retour atelier doit etre accepte");
assert.equal(app(`getCaseStatus(state.cases[0])`), "qualityRework", "statut retravail attendu");
assert.equal(app(`state.cases[0].flags.workCompleted`), false, "retravail doit rouvrir les travaux");

app(`state.cases[0].flags.workCompleted = true;`);
result = app(`advanceReceptionWorkflow('case-active', 'update_quality_status', { status: 'validated', reason: 'Recontrole OK' })`);
assert.equal(result.ok, true, "QC revalide doit etre accepte");
assert.equal(app(`state.cases[0].flags.qualityApproved`), true, "QC revalide doit remettre qualityApproved");
assert.equal(app(`Boolean(state.cases[0].receptionWorkflow.qualityRevalidatedAt)`), true, "date de revalidation attendue");
assert.ok(app(`state.cases[0].history.some((entry) => /QC revalid/i.test(entry.label))`), "historique QC revalide attendu");

app(`state.cases[0].flags.qualityApproved = false; state.cases[0].receptionWorkflow.qualityStatus = 'in_progress';`);
result = app(`advanceReceptionWorkflow('case-active', 'deliver_vehicle')`);
assert.equal(result.ok, false, "livraison sans QC valide doit etre bloquee dans la transition metier");
app(`state.cases[0].flags.qualityApproved = true; state.cases[0].receptionWorkflow.qualityStatus = 'validated'; state.cases[0].partsStatus = 'blocked_parts'; state.cases[0].blockerReason = 'waiting_parts';`);
result = app(`advanceReceptionWorkflow('case-active', 'deliver_vehicle')`);
assert.equal(result.ok, false, "livraison avec blocage ouvert doit etre bloquee dans la transition metier");

app(`
  state = normalizeState({
    users: [
      { id: 'u-directeur', name: 'Directeur SAV', role: 'directeur_sav', active: true },
      { id: 'u-readonly', name: 'Lecture seule', role: 'readonly', active: true }
    ],
    currentUserId: 'u-directeur',
    resources: [{ id: 'tech-1', name: 'Technicien', role: 'mecanicien', active: true }],
    ui: { savDashboardPeriod: 'today', savDashboardStatusFilter: 'all', savDashboardTypeFilter: 'all' },
    cases: [
      {
        id: 'case-qc-rejected',
        clientName: 'Client A',
        plate: '100 TU 100',
        createdAt: '2026-06-08T08:00:00.000Z',
        flags: { received: true, workStarted: true, workCompleted: true, qualityApproved: false },
        receptionWorkflow: { sentToWorkshopAt: '2026-06-08T08:30:00.000Z', qualityStatus: 'rejected', qualityReviewedAt: '2026-06-08T09:00:00.000Z', qualityReturnReason: 'Defaut peinture' },
        claims: [{ type: 'client', includeInPlanning: true, clientApproved: true, expertApproved: true }],
        qualityChecklist: {}
      },
      {
        id: 'case-qc-rework',
        clientName: 'Client B',
        plate: '200 TU 200',
        createdAt: '2026-06-08T08:10:00.000Z',
        flags: { received: true, workStarted: true, workCompleted: false, qualityApproved: false },
        receptionWorkflow: { sentToWorkshopAt: '2026-06-08T08:30:00.000Z', qualityStatus: 'rework', qualityReworkStartedAt: '2026-06-08T09:30:00.000Z' },
        claims: [{ type: 'client', includeInPlanning: true, clientApproved: true, expertApproved: true }],
        qualityChecklist: {}
      }
    ],
    bookings: []
  });
`);
const dashboard = app(`buildSavPerformanceDashboard(new Date('2026-06-08T10:00:00.000Z'))`);
assert.equal(dashboard.metrics.pendingQualityControls, 2, "dashboard doit compter QC refuse et retravail");
const alerts = app(`buildPilotageAlerts(new Date('2026-06-08T10:00:00.000Z'), { limit: 10 })`);
assert.ok(alerts.some((alert) => alert.title === "QC refusé"), "alerte QC refuse attendue");
assert.ok(alerts.some((alert) => alert.title === "Retour atelier / retravail"), "alerte retravail attendue");
assert.equal(app(`hasPermission('dashboard.view', { userId: 'u-directeur' })`), true, "Directeur SAV doit voir le dashboard");
assert.equal(app(`hasPermission('dashboard.view', { userId: 'u-readonly' })`), true, "lecture seule doit voir le dashboard");

console.log("Tests v23.2.5 reception workflow QA/status OK");
