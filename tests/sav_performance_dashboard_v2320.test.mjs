import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

console.log('Demarrage tests v23.2.0 dashboard performance SAV...');

const scriptFiles = [
  'js/utils.js',
  'js/state.js',
  'js/ui-cases.js',
  'js/photos.js',
];

const source = scriptFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');

function stubElement() {
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    title: '',
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
  URL: { createObjectURL: () => '', revokeObjectURL() {} },
  FileReader: class {},
  crypto: { randomUUID: () => `id-${Math.random().toString(16).slice(2)}` },
};
context.window = { ...context.window, ...context };

vm.createContext(context);
vm.runInContext(source, context);
const app = (code) => vm.runInContext(code, context);

const now = '2026-06-06T10:00:00.000Z';
app(`
  state = normalizeState({
    users: [
      { id: 'u-admin', name: 'Admin technique', role: 'admin', active: true },
      { id: 'u-directeur', name: 'Directeur SAV', role: 'directeur_sav', active: true },
      { id: 'u-readonly', name: 'Lecture seule', role: 'readonly', active: true },
      { id: 'u-reception', name: 'Reception', role: 'reception', active: true }
    ],
    currentUserId: 'u-directeur',
    resources: [
      { id: 'tolier-1', name: 'Tolier', role: 'tolier', active: true },
      { id: 'peintre-1', name: 'Peintre', role: 'peintre', active: true },
      { id: 'meca-1', name: 'Mecanicien', role: 'mecanicien', active: true },
      { id: 'elec-1', name: 'Electricien', role: 'electricien', active: true },
      { id: 'pont-v', name: 'Pont vidange', role: 'pont_vidange', active: true },
      { id: 'pont-m', name: 'Pont mecanique', role: 'pont_mecanique', active: true },
      { id: 'cabine-1', name: 'Cabine', role: 'cabine', active: true }
    ],
    ui: {
      savDashboardPeriod: 'today',
      savDashboardTypeFilter: 'all',
      savDashboardStatusFilter: 'all'
    },
    cases: [
      {
        id: 'case-active-created',
        clientName: 'Client Alpha',
        vehicle: 'Peugeot sensible',
        plate: '123 TU 456',
        vin: 'VF3ABCDEFGH1234567',
        createdAt: '2026-06-06T08:00:00.000Z',
        updatedAt: '2026-06-06T09:00:00.000Z',
        flags: { received: true, workStarted: true, workCompleted: true, qualityApproved: false, delivered: false, invoiced: false },
        receptionWorkflow: { vehicleReceivedAt: '2026-06-06T08:30:00.000Z', qualityStatus: 'pending' },
        appointment: { start: '2026-06-06T08:00:00.000Z', end: '2026-06-06T08:30:00.000Z', delivery: '2026-06-06T09:00:00.000Z' },
        claims: [{ type: 'client', includeInPlanning: true, clientApproved: true, expertApproved: true }],
        durations: { mechanical: 2, quality: 0.25 },
        history: [{ type: 'vehicle.received', at: '2026-06-06T08:30:00.000Z' }],
        qualityChecklist: Object.fromEntries(DEFAULT_QUALITY_CHECKS.map((label) => [label, true]))
      },
      {
        id: 'case-blocked',
        clientName: 'Client Beta',
        vehicle: 'Modele masque',
        plate: '987 TU 654',
        createdAt: '2026-06-05T08:00:00.000Z',
        updatedAt: '2026-06-06T08:00:00.000Z',
        partsStatus: 'waiting_parts',
        blockerReason: 'waiting_parts',
        blockerDetails: 'Appeler Client Beta pour plaque 987 TU 654',
        flags: { received: true, workStarted: false, workCompleted: false, qualityApproved: false, delivered: false, invoiced: false },
        receptionWorkflow: { vehicleReceivedAt: '2026-06-05T10:00:00.000Z' },
        appointment: { start: '2026-06-05T08:00:00.000Z', end: '2026-06-05T08:30:00.000Z', delivery: '2026-06-07T18:00:00.000Z' },
        claims: [{ type: 'assurance', includeInPlanning: true, clientApproved: false, expertApproved: false }],
        durations: { body: 3 },
        history: [],
        qualityChecklist: {}
      },
      {
        id: 'case-delivery-today',
        clientName: 'Client Gamma',
        vehicle: 'Citadine',
        plate: '555 TU 111',
        createdAt: '2026-06-04T08:00:00.000Z',
        updatedAt: '2026-06-06T07:00:00.000Z',
        flags: { received: true, workStarted: true, workCompleted: false, qualityApproved: false, delivered: false, invoiced: false },
        receptionWorkflow: { vehicleReceivedAt: '2026-06-04T09:00:00.000Z' },
        appointment: { start: '2026-06-04T08:00:00.000Z', end: '2026-06-04T08:30:00.000Z', delivery: '2026-06-06T17:00:00.000Z' },
        claims: [{ type: 'mechanical_client', includeInPlanning: true, clientApproved: true, expertApproved: true }],
        durations: { mechanical: 2 },
        history: [],
        qualityChecklist: {}
      },
      {
        id: 'case-no-action',
        clientName: 'Client Delta',
        vehicle: 'Compacte',
        plate: '222 TU 333',
        createdAt: '2026-06-06T07:00:00.000Z',
        updatedAt: '2026-06-06T07:00:00.000Z',
        flags: { received: false, workStarted: false, workCompleted: false, qualityApproved: false, delivered: false, invoiced: false },
        claims: [{ type: 'diagnostic', includeInPlanning: true, clientApproved: true, expertApproved: true }],
        durations: { electrical: 1 },
        history: [],
        qualityChecklist: {}
      },
      {
        id: 'case-delivered-cycle',
        clientName: 'Client Epsilon',
        vehicle: 'Livree',
        plate: '444 TU 555',
        createdAt: '2026-06-01T09:00:00.000Z',
        updatedAt: '2026-06-06T09:30:00.000Z',
        flags: { received: true, workStarted: true, workCompleted: true, qualityApproved: true, delivered: true, invoiced: false },
        receptionWorkflow: { vehicleReceivedAt: '2026-06-01T10:00:00.000Z', deliveredAt: '2026-06-06T09:30:00.000Z' },
        appointment: { start: '2026-06-01T09:00:00.000Z', end: '2026-06-01T09:30:00.000Z', delivery: '2026-06-06T09:30:00.000Z' },
        claims: [{ type: 'client', includeInPlanning: true, clientApproved: true, expertApproved: true }],
        durations: { finish: 1, quality: 0.25 },
        history: [{ type: 'vehicle.delivered', at: '2026-06-06T09:30:00.000Z' }],
        qualityChecklist: Object.fromEntries(DEFAULT_QUALITY_CHECKS.map((label) => [label, true]))
      }
    ],
    bookings: [
      { id: 'book-fast', caseId: 'case-active-created', key: 'oilService', resourceIds: ['meca-1', 'pont-v'], primaryResourceId: 'meca-1', segments: [{ start: '2026-06-06T08:00:00.000Z', end: '2026-06-06T09:00:00.000Z' }], start: '2026-06-06T08:00:00.000Z', end: '2026-06-06T09:00:00.000Z' },
      { id: 'book-heavy', caseId: 'case-delivery-today', key: 'mechanical', resourceIds: ['meca-1', 'pont-m'], primaryResourceId: 'meca-1', segments: [{ start: '2026-06-06T09:00:00.000Z', end: '2026-06-06T11:00:00.000Z' }], start: '2026-06-06T09:00:00.000Z', end: '2026-06-06T11:00:00.000Z' },
      { id: 'book-body', caseId: 'case-blocked', key: 'body', resourceIds: ['tolier-1'], primaryResourceId: 'tolier-1', segments: [{ start: '2026-06-06T10:00:00.000Z', end: '2026-06-06T12:00:00.000Z' }], start: '2026-06-06T10:00:00.000Z', end: '2026-06-06T12:00:00.000Z' },
      { id: 'book-electric', caseId: 'case-no-action', key: 'electrical', resourceIds: ['elec-1'], primaryResourceId: 'elec-1', segments: [{ start: '2026-06-06T07:00:00.000Z', end: '2026-06-06T08:00:00.000Z' }], start: '2026-06-06T07:00:00.000Z', end: '2026-06-06T08:00:00.000Z' }
    ]
  });
`);

const dashboard = app(`buildSavPerformanceDashboard(new Date('${now}'))`);
assert.equal(dashboard.metrics.activeCases, 4, 'le dashboard doit compter les dossiers actifs de la periode');
assert.equal(dashboard.metrics.createdCases, 2, 'les dossiers crees aujourd hui doivent etre comptes');
assert.equal(dashboard.metrics.receivedVehicles, 1, 'les vehicules recus aujourd hui doivent etre comptes');
assert.equal(dashboard.metrics.plannedDeliveries, 3, 'les livraisons prevues aujourd hui doivent etre comptees');
assert.equal(dashboard.metrics.overdueDeliveries, 1, 'les livraisons en retard doivent etre detectees');
assert.equal(dashboard.metrics.blockedCases, 1, 'les dossiers bloques doivent etre detectes');
assert.equal(dashboard.metrics.pendingAgreements, 1, 'les accords client/expert en attente doivent etre detectes');
assert.equal(dashboard.metrics.pendingQualityControls, 1, 'les controles qualite en attente doivent etre detectes');
assert.equal(dashboard.metrics.withoutNextAction, 1, 'les dossiers sans jalon futur doivent etre detectes');
assert.ok(dashboard.metrics.humanLoadPercent > 0, 'la charge humaine doit etre calculee');
assert.ok(dashboard.metrics.equipmentLoadPercent > 0, 'la charge materiel doit etre calculee');
assert.ok(dashboard.metrics.liftLoadPercent > 0, 'la charge ponts doit etre calculee');
assert.ok(dashboard.metrics.averageCycleHours > 0, 'le temps moyen de cycle doit etre calcule');
const serviceLoadKeys = JSON.parse(app(`JSON.stringify(buildSavPerformanceDashboard(new Date('${now}')).serviceLoads.map((item) => item.key))`));
assert.deepEqual(serviceLoadKeys, ['fast', 'heavy', 'body', 'electrical'], 'la charge atelier doit etre detaillee par service');

const kpiLabels = app(`buildSavKpis(new Date('${now}')).map((item) => item.label)`);
for (const expected of [
  'Dossiers actifs',
  "Créés aujourd'hui",
  "Véhicules reçus aujourd'hui",
  "Livraisons prévues aujourd'hui",
  'Livraisons en retard',
  'Dossiers bloqués',
  'Accords en attente',
  'Contrôles qualité en attente',
  'Charge humaine vs capacité',
  'Matériel / ponts / cabine',
  'Temps moyen cycle dossier',
  'Sans prochaine action',
  'Priorités Directeur SAV',
]) {
  assert.ok(kpiLabels.includes(expected), `KPI manquant: ${expected}`);
}

const alerts = app(`buildPilotageAlerts(new Date('${now}'), { limit: 20 })`);
assert.ok(alerts.some((alert) => alert.title === 'Dossier bloqué'), 'une alerte de blocage doit remonter');
assert.ok(alerts.some((alert) => alert.title === 'Accord en attente'), 'une alerte accord en attente doit remonter');
const renderedAlertText = JSON.stringify(alerts);
for (const sensitive of ['Client Alpha', 'Client Beta', '123 TU 456', '987 TU 654', 'VF3ABCDEFGH1234567', 'Peugeot sensible', 'Appeler Client Beta']) {
  assert.equal(renderedAlertText.includes(sensitive), false, `le dashboard ne doit pas afficher ${sensitive}`);
}

assert.equal(app(`hasPermission('dashboard.view', { userId: 'u-directeur' })`), true, 'Directeur SAV doit voir le dashboard');
assert.equal(app(`hasPermission('dashboard.view', { userId: 'u-readonly' })`), true, 'Lecture seule doit consulter le dashboard');
assert.equal(app(`hasPermission('dashboard.view', { userId: 'u-admin' })`), true, 'Admin technique garde acces par wildcard');
assert.equal(app(`hasPermission('dashboard.view', { userId: 'u-reception' })`), false, 'Reception ne doit pas recevoir le dashboard performance');
assert.equal(app(`guardSensitiveAction('settings.edit', { userId: 'u-directeur' }, { notify: false }).ok`), false, 'Dashboard ne donne pas les actions systeme au Directeur SAV');

app(`state.ui.savDashboardTypeFilter = 'diagnostic';`);
const diagnosticDashboard = app(`buildSavPerformanceDashboard(new Date('${now}'))`);
assert.equal(diagnosticDashboard.metrics.activeCases, 1, 'le filtre diagnostic doit fonctionner');
assert.equal(diagnosticDashboard.metrics.withoutNextAction, 1, 'le filtre diagnostic doit conserver les KPI associes');

console.log('Tests v23.2.0 dashboard performance SAV OK');
