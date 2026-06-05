import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const scriptFiles = [
  'js/utils.js',
  'js/state.js',
  'js/ui-cases.js',
  'js/estimate-import.js',
  'js/ui-planning.js',
  'js/photos.js',
  'js/storage.js',
  'js/planning.js',
  'js/exports.js',
  'app.js',
  'js/business-rules-v2187.js',
];

const source = scriptFiles
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n')
  .replace(/initApp\(\);/, '// initApp skipped by permissions tests')
  .replace(/if \("serviceWorker" in navigator[\s\S]*$/u, '');

function stubElement() {
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
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

const writes = [];
const context = {
  console,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: {
    querySelector: () => stubElement(),
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => stubElement(),
    body: stubElement(),
  },
  window: {
    addEventListener() {},
    open: () => ({ document: { write(html) { writes.push(html); }, close() {} } }),
    prompt: () => '',
  },
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

const stateSource = fs.readFileSync('js/state.js', 'utf8');
const appSource = fs.readFileSync('app.js', 'utf8');
const swSource = fs.readFileSync('sw.js', 'utf8');
assert.match(stateSource, /APP_VERSION\s*=\s*"v23\.1.0"/, 'APP_VERSION doit rester en v23.1.0 pour cette branche');
assert.match(appSource, /serviceWorker\.register\("sw\.js\?v=23\.1.0"/, 'le service worker doit pointer vers sw.js?v=23.1.0');
assert.match(swSource, /nimr-sav-v23\.1.0-appointment-status-canonical-sync/, 'le cache PWA doit refléter v23.1.0');

function setupPermissionState(currentUserId = 'u-admin', options = {}) {
  const now = new Date();
  const start = new Date(now.getTime() - 30 * 60000).toISOString();
  const end = new Date(now.getTime() + 90 * 60000).toISOString();
  const laterStart = new Date(now.getTime() + 3 * 60 * 60000).toISOString();
  const laterEnd = new Date(now.getTime() + 5 * 60 * 60000).toISOString();
  const users = options.withoutUsers ? '' : `
    users: [
      { id: 'u-admin', name: 'Admin SAV', role: 'admin', active: true },
      { id: 'u-chef', name: 'Chef atelier', role: 'chef_atelier', active: true },
      { id: 'u-reception', name: 'Réception', role: 'reception', active: true },
      { id: 'u-tech-1', name: 'Tech 1', role: 'technicien', resourceId: 'tech-1', active: true },
      { id: 'u-tech-2', name: 'Tech 2', role: 'technicien', resourceId: 'tech-2', active: true },
      { id: 'u-tech-no-resource', name: 'Tech sans ressource', role: 'technicien', active: true },
      { id: 'u-qualite', name: 'Qualité', role: 'qualite', active: true },
      { id: 'u-readonly', name: 'Lecture', role: 'readonly', active: true }
    ],
    currentUserId: '${currentUserId}',`;
  app(`
    state = normalizeState({
      ${users}
      resources: [
        { id: 'tech-1', name: 'Technicien 1', role: 'mecanicien', active: true },
        { id: 'tech-2', name: 'Technicien 2', role: 'mecanicien', active: true },
        { id: 'pont-1', name: 'Pont 1', role: 'pont_mecanique', active: true }
      ],
      cases: [
        {
          id: 'case-perm-1',
          clientName: 'Client Permissions',
          vehicle: 'Peugeot 208',
          plate: '111 TU 222',
          flags: { received: true, clientApproved: true, expertApproved: true },
          durations: { mechanical: 2, quality: 0.25 },
          claims: [{ type: 'client', includeInPlanning: true, clientApproved: true, expertApproved: true, estimate: { lines: [{ phase: 'mechanical', operation: 'MO', laborHours: 2 }] } }]
        },
        {
          id: 'case-perm-2',
          clientName: 'Client Autre Tech',
          vehicle: 'Citroen C3',
          plate: '333 TU 444',
          flags: { received: true, clientApproved: true, expertApproved: true },
          durations: { mechanical: 1, quality: 0.25 },
          claims: [{ type: 'client', includeInPlanning: true, clientApproved: true, expertApproved: true, estimate: { lines: [{ phase: 'mechanical', operation: 'MO', laborHours: 1 }] } }]
        }
      ],
      bookings: [
        { id: 'booking-tech-1', caseId: 'case-perm-1', key: 'mechanical', title: 'Réparation mécanique', resourceIds: ['tech-1', 'pont-1'], primaryResourceId: 'tech-1', segments: [{ start: '${start}', end: '${end}' }], start: '${start}', end: '${end}', plannedStart: '${start}', plannedEnd: '${end}', plannedMinutes: 120 },
        { id: 'booking-tech-2', caseId: 'case-perm-2', key: 'mechanical', title: 'Diagnostic mécanique', resourceIds: ['tech-2', 'pont-1'], primaryResourceId: 'tech-2', segments: [{ start: '${laterStart}', end: '${laterEnd}' }], start: '${laterStart}', end: '${laterEnd}', plannedStart: '${laterStart}', plannedEnd: '${laterEnd}', plannedMinutes: 120 }
      ]
    });
  `);
}

setupPermissionState('u-admin');
assert.equal(app(`startTechnicianTask(state.cases[0], 'booking-tech-1', 'tech-1').ok`), true, 'admin peut démarrer une tâche affectée');
assert.equal(app(`pauseTechnicianTask(state.cases[0], 'booking-tech-1', 'tech-1', 'pause repas').ok`), true, 'admin peut pauser une tâche');
const adminRemainderId = app(`state.bookings.find((booking) => booking.parentBookingId === 'booking-tech-1').id`);
assert.equal(app(`resumeTechnicianTask(state.cases[0], '${adminRemainderId}', 'tech-1').ok`), true, 'admin peut reprendre une tâche');
assert.equal(app(`completeTechnicianTask(state.cases[0], '${adminRemainderId}', 'tech-1', { skipPhotoCheck: true }).ok`), true, 'admin peut terminer une tâche');

setupPermissionState('u-chef');
assert.equal(app(`startTechnicianTask(state.cases[1], 'booking-tech-2', 'tech-2').ok`), true, 'chef atelier peut agir sur toutes les tâches');

setupPermissionState('u-chef');
assert.equal(app(`runWorkshopChiefOverride(state.cases[0], state.bookings[0], 'start', '').ok`), false, 'override sans motif doit être refusé');
const overrideResult = app(`runWorkshopChiefOverride(state.cases[0], state.bookings[0], 'start', 'Rééquilibrage planning').ok`);
assert.equal(overrideResult, true, 'chef atelier peut override avec motif');
assert.equal(app(`state.cases[0].history[0].userId`), 'u-chef', 'override doit historiser acteur');
assert.equal(app(`state.cases[0].history[0].userRole`), 'chef_atelier', 'override doit historiser rôle');

setupPermissionState('u-tech-1');
const techStart = app(`startTechnicianTask(state.cases[0], 'booking-tech-1', 'tech-1')`);
assert.equal(techStart.ok, true, 'technicien peut démarrer sa tâche');
assert.equal(app(`state.cases[0].history[0].userId`), 'u-tech-1', 'action technicien doit historiser userId');
assert.equal(app(`state.cases[0].history[0].userRole`), 'technicien', 'action technicien doit historiser userRole');

setupPermissionState('u-tech-1');
const otherStart = app(`startTechnicianTask(state.cases[1], 'booking-tech-2', 'tech-2')`);
assert.equal(otherStart.ok, false, 'technicien ne peut pas démarrer la tâche d’un autre');
assert.match(otherStart.message, /autre technicien/i);
app(`state.bookings.find((booking) => booking.id === 'booking-tech-2').status = 'started'`);
const otherComplete = app(`completeTechnicianTask(state.cases[1], 'booking-tech-2', 'tech-2', { skipPhotoCheck: true })`);
assert.equal(otherComplete.ok, false, 'technicien ne peut pas terminer la tâche d’un autre');

setupPermissionState('u-tech-1');
assert.equal(app(`guardAction('planning.edit').ok`), false, 'technicien ne peut pas éditer le planning');
assert.match(app(`rescheduleCaseBooking(state.cases[0], 'booking-tech-1', new Date().toISOString()).message`), /chef atelier\/admin/i);

setupPermissionState('u-tech-no-resource');
const noResource = app(`startTechnicianTask(state.cases[0], 'booking-tech-1', 'tech-1')`);
assert.equal(noResource.ok, false, 'technicien sans ressource ne doit pas démarrer');
assert.match(noResource.message, /Aucune ressource technicien/i);

setupPermissionState('u-reception');
assert.equal(app(`startTechnicianTask(state.cases[0], 'booking-tech-1', 'tech-1').ok`), false, 'réception ne démarre pas une tâche atelier');
assert.equal(app(`completeTechnicianTask(state.cases[0], 'booking-tech-1', 'tech-1', { skipPhotoCheck: true }).ok`), false, 'réception ne termine pas une tâche atelier');
assert.equal(app(`guardAction('planning.edit').ok`), false, 'réception ne déplace pas le planning');

setupPermissionState('u-qualite');
assert.equal(app(`startTechnicianTask(state.cases[0], 'booking-tech-1', 'tech-1').ok`), false, 'qualité ne démarre pas une tâche atelier');
assert.equal(app(`completeTechnicianTask(state.cases[0], 'booking-tech-1', 'tech-1', { skipPhotoCheck: true }).ok`), false, 'qualité ne termine pas une tâche atelier');

setupPermissionState('u-readonly');
assert.equal(app(`startTechnicianTask(state.cases[0], 'booking-tech-1', 'tech-1').ok`), false, 'readonly ne fait aucune mutation tâche');
assert.equal(app(`guardAction('planning.edit').ok`), false, 'readonly ne fait aucune mutation planning');

setupPermissionState('u-chef');
assert.equal(app(`guardAction('planning.edit').ok`), true, 'chef atelier peut éditer le planning');
assert.equal(app(`rescheduleCaseBooking(state.cases[1], 'booking-tech-2', new Date(Date.now() + 6 * 60 * 60000).toISOString()).ok`), true, 'chef atelier peut déplacer une tâche');

setupPermissionState('u-reception');
assert.equal(app(`rescheduleCaseBooking(state.cases[1], 'booking-tech-2', new Date(Date.now() + 6 * 60 * 60000).toISOString()).ok`), false, 'réception ne peut pas déplacer une tâche');

setupPermissionState('u-admin', { withoutUsers: true });
assert.equal(app(`getCurrentUser().role`), 'admin', 'ancien atelier sans users doit bootstrap admin');
assert.equal(app(`startTechnicianTask(state.cases[0], 'booking-tech-1', 'tech-1').ok`), true, 'bootstrap admin évite le blocage des anciens ateliers');

console.log('Users roles permissions technician/planning OK');
