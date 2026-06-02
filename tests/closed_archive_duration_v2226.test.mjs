import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const files = [
  '../js/utils.js',
  '../js/state.js',
  '../js/planning.js',
  '../js/ui-cases.js',
  '../js/exports.js',
  '../js/supabase-sync.js',
];

const source = files.map((file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
const context = {
  console,
  Date,
  Map,
  Set,
  Promise,
  structuredClone: globalThis.structuredClone,
  setTimeout: () => 0,
  clearTimeout: () => {},
  navigator: { onLine: true },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: {
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ classList: { add: () => {}, toggle: () => {} }, dataset: {}, prepend: () => {}, querySelector: () => null, querySelectorAll: () => [] }),
  },
  window: {
    prompt: () => '',
    open: () => ({ document: { write: () => {}, close: () => {} } }),
  },
  notifyMessages: [],
};
context.window.window = context.window;
context.window.document = context.document;
context.window.navigator = context.navigator;
context.window.localStorage = context.localStorage;
context.window.sessionStorage = context.sessionStorage;
context.notifyUser = (message, type = 'info') => context.notifyMessages.push({ message, type });
context.saveState = () => {};
context.render = () => {};
context.renderCases = () => {};
context.renderCaseDetail = () => {};
context.renderPlanning = () => {};
context.renderMetrics = () => {};
context.setActiveTab = () => {};
context.showConfirmModal = async () => true;
context.showPromptModal = async () => true;
context.restorePhotoRecords = async () => 0;

vm.createContext(context);
vm.runInContext(source, context);

function run(code, extra = {}) {
  return vm.runInContext(code, Object.assign(context, extra));
}

function resetState(payload) {
  return run('state = normalizeState(__payload); state;', { __payload: payload });
}

const adminUser = {
  id: 'user-admin',
  name: 'Admin atelier',
  role: 'admin',
  active: true,
  resourceId: 'tech-1',
};

const resource = { id: 'tech-1', name: 'Alaa', role: 'mecanicien', active: true };

function createCase(overrides = {}) {
  return {
    id: overrides.id || 'case-archive',
    clientName: 'Client Test',
    vehicle: 'T5 EVO',
    plate: '3159TU244',
    flags: {
      received: true,
      workStarted: true,
      workCompleted: true,
      qualityApproved: true,
      delivered: true,
      invoiced: true,
      ...(overrides.flags || {}),
    },
    durations: { oilService: 3, quality: 0.25 },
    history: [],
    claims: [],
    supplements: [],
    ...overrides,
  };
}

function createBooking(overrides = {}) {
  return {
    id: overrides.id || 'booking-vidange',
    caseId: overrides.caseId || 'case-archive',
    key: 'oilService',
    title: 'VIDANGE',
    status: 'planned',
    resourceIds: ['tech-1'],
    start: '2026-05-23T08:00:00.000Z',
    end: '2026-05-25T07:00:00.000Z',
    plannedMinutes: 180,
    plannedSegments: [{ start: '2026-05-23T08:00:00.000Z', end: '2026-05-23T11:00:00.000Z' }],
    segments: [{ start: '2026-05-23T08:00:00.000Z', end: '2026-05-25T07:00:00.000Z' }],
    workSessions: [{ startedAt: '2026-05-23T08:00:00.000Z', completedAt: '2026-05-25T08:23:00.000Z' }],
    ...overrides,
  };
}

resetState({
  users: [adminUser],
  currentUserId: 'user-admin',
  resources: [resource],
  cases: [createCase()],
  bookings: [createBooking()],
});

assert.equal(run('isCaseReadonlyArchive(state.cases[0])'), true, 'dossier facturé doit être archive lecture seule');
assert.equal(run('guardCaseEdit(state.cases[0], { notify: false }).ok'), false, 'édition dossier clôturé refusée');
assert.equal(run('guardAppointmentSchedule(state.cases[0], { notify: false }).ok'), false, 'planning dossier clôturé refusé');
assert.equal(run('guardVehicleReceive(state.cases[0], { notify: false }).ok'), false, 'réception dossier clôturé refusée');
assert.equal(run('guardDeliveryComplete(state.cases[0], { notify: false }).ok'), false, 'livraison dossier clôturé refusée');
assert.match(run('getArchivedCaseMessage(state.cases[0])'), /Dossier clôturé/, 'message archive attendu');

assert.equal(run('canRenderAction("print.task", { item: state.cases[0] })'), true, 'impression reste autorisée selon permission');
assert.equal(run('startTechnicianTask(state.cases[0], "booking-vidange", "tech-1").ok'), false, 'démarrage tâche archive refusé');
assert.equal(run('completeTechnicianTask(state.cases[0], "booking-vidange", "tech-1", { skipPhotoCheck: true }).ok'), false, 'fin tâche archive refusée');
assert.equal(await run('handleBookingTaskAction(state.cases[0], "start", "booking-vidange", { allowOverride: false }).then((result) => result.ok)'), false, 'handler planning refuse tâche archive');

const openCase = createCase({
  id: 'case-open',
  flags: { received: true, delivered: false, invoiced: false, workStarted: false, workCompleted: false, qualityApproved: false },
});
resetState({
  users: [adminUser],
  currentUserId: 'user-admin',
  resources: [resource],
  cases: [openCase],
  bookings: [createBooking({ caseId: 'case-open' })],
});
assert.equal(run('guardCaseEdit(state.cases[0], { notify: false }).ok'), true, 'dossier ouvert garde les actions normales');

resetState({
  users: [adminUser],
  currentUserId: 'user-admin',
  resources: [resource],
  cases: [createCase()],
  bookings: [createBooking()],
});

assert.equal(run('getBookingPlannedMinutes(state.bookings[0])'), 180, 'durée utile planifiée vidange = 3 h');
assert.equal(run('getValidatedAppointmentRows(state.cases[0])[0].minutes'), 180, 'affichage planning dossier utilise 3 h utiles, pas 47 h');
assert.equal(run('estimateBookingWorkedMinutes(state.bookings[0], new Date("2026-05-25T08:23:00.000Z"))'), 180, 'durée réelle productive plafonnée à 3 h utiles');
assert.equal(run('isActivePrintableWorkBooking(state.bookings[0], state.cases[0])'), false, 'planning imprimé actif exclut dossier clôturé');
assert.equal(run('getTechnicianTaskRows("tech-1", "2026-05-23").length'), 0, 'ordre technicien clôturé non proposé comme tâche à exécuter');

const legacyBooking = createBooking({
  id: 'booking-legacy-vidange',
  caseId: 'case-legacy-duration',
  start: '2026-05-30T08:00:00.000Z',
  end: '2026-06-01T07:00:00.000Z',
  segments: [{ start: '2026-05-30T08:00:00.000Z', end: '2026-06-01T07:00:00.000Z' }],
  plannedSegments: [],
  plannedMinutes: 0,
  workSessions: [{ startedAt: '2026-05-30T08:00:00.000Z', completedAt: '2026-06-01T07:00:00.000Z' }],
});
delete legacyBooking.plannedSegments;
delete legacyBooking.plannedMinutes;
resetState({
  users: [adminUser],
  currentUserId: 'user-admin',
  resources: [resource],
  cases: [createCase({ id: 'case-legacy-duration', durations: { oilService: 3, quality: 0.25 } })],
  bookings: [legacyBooking],
});
assert.ok(run('state.bookings[0].plannedMinutes') > 180, 'fixture ancien booking normalisé avec amplitude calendrier');
assert.equal(run('getBookingPlannedMinutes(state.bookings[0], state.cases[0])'), 180, 'ancien booking sans durée fiable retombe sur la durée métier 3 h');
assert.equal(run('getValidatedAppointmentRows(state.cases[0])[0].minutes'), 180, 'ancien booking multi-jours affiche 3 h utiles, pas 47 h');
assert.equal(run('estimateBookingWorkedMinutes(state.bookings[0], new Date("2026-06-01T07:00:00.000Z"))'), 180, 'ancienne session réelle multi-jours est plafonnée à 3 h productives');

resetState({
  users: [adminUser],
  currentUserId: 'user-admin',
  resources: [resource],
  cases: [createCase()],
  bookings: [createBooking()],
});

context.notifyMessages = [];
run('printTechnicianWorkOrders(state.cases[0])');
assert.match(fs.readFileSync(new URL('../js/exports.js', import.meta.url), 'utf8'), /Dossier clôturé : les ordres techniciens opérationnels ne sont plus proposés/, 'impression ordres techniciens opérationnels prévient en archive');

const localState = normalizeForSync({
  users: [adminUser],
  currentUserId: 'user-admin',
  resources: [resource],
  cases: [createCase({ id: 'case-sync' })],
  bookings: [createBooking({ id: 'booking-sync', caseId: 'case-sync', status: 'planned', start: '2026-05-23T08:00:00.000Z' })],
});
const remoteState = normalizeForSync({
  users: [adminUser],
  currentUserId: 'user-admin',
  resources: [resource],
  cases: [createCase({ id: 'case-sync', flags: { delivered: true, invoiced: false } })],
  bookings: [createBooking({ id: 'booking-sync', caseId: 'case-sync', status: 'planned', start: '2026-05-26T08:00:00.000Z', plannedMinutes: 480 })],
});
const mergeResult = run('mergeRemoteStateIntoLocal(__localState, __remoteState, { reason: "test-v2226" })', {
  __localState: localState,
  __remoteState: remoteState,
});
const protectedBooking = mergeResult.state.bookings.find((booking) => booking.id === 'booking-sync');
assert.equal(protectedBooking.start, '2026-05-23T08:00:00.000Z', 'sync conserve le booking local planned lié au dossier clôturé/livré');
assert.equal(protectedBooking.plannedMinutes, 180, 'sync conserve la durée locale protégée');
assert.ok(mergeResult.stats.conflicts >= 1, 'sync crée un conflit pour booking de dossier clôturé protégé');

function normalizeForSync(payload) {
  return run('normalizeState(__payload)', { __payload: payload });
}

console.log('Closed archive duration v22.26 OK');
