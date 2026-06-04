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
  .replace(/initApp\(\);/, '// initApp skipped by technician flow tests')
  .replace(/if \("serviceWorker" in navigator[\s\S]*$/u, '');

function stubElement() {
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    dataset: {},
    style: {},
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
const versionSource = fs.readFileSync('js/version.js', 'utf8');
const indexSource = fs.readFileSync('index.html', 'utf8');
const appVersion = stateSource.match(/APP_VERSION\s*=\s*"(v\d+\.\d+(?:\.\d+)?)"/)?.[1];
assert.equal(appVersion, 'v23.0.3', 'APP_VERSION doit rester en v23.0.3 pour cette branche');
assert.match(appSource, /serviceWorker\.register\("sw\.js\?v=23\.0\.3"/, 'le service worker doit être enregistré avec sw.js?v=23.0.3');
assert.match(swSource, /nimr-sav-v23\.0\.3-role-access-dom-scrub/, 'le cache PWA doit être en v23.0.3');
assert.match(versionSource, /NIMR_BUILD\s*=\s*"v23\.0\.3"/, 'js/version.js doit exposer v23.0.3');
[...indexSource.matchAll(/\?v=(\d+\.\d+(?:\.\d+)?)/g)].forEach((match) => {
  assert.equal(match[1], '23.0.3', `référence index.html incohérente: ?v=${match[1]}`);
});

function setupTechnicianState() {
  const now = new Date();
  const start = new Date(now.getTime() - 30 * 60000).toISOString();
  const end = new Date(now.getTime() + 90 * 60000).toISOString();
  vm.runInContext(`
    state = normalizeState({
      resources: [
        { id: 'tech-1', name: 'Technicien 1', role: 'mecanicien', active: true },
        { id: 'tech-2', name: 'Technicien 2', role: 'mecanicien', active: true },
        { id: 'pont-1', name: 'Pont 1', role: 'pont_mecanique', active: true }
      ],
      cases: [
        {
          id: 'case-tech',
          clientName: 'Client Tech',
          phone: '+216 55 000 000',
          vehicle: 'Peugeot 208',
          plate: '123 TU 456',
          orNavNumber: 'OR-TECH',
          flags: { received: true },
          appointment: { start: '${start}', end: '${end}', delivery: '${end}', marginMinutes: 15 },
          claims: [{ type: 'client', includeInPlanning: true, expertApproved: true, clientApproved: true, estimate: { lines: [{ phase: 'mechanical', operation: 'MO', laborHours: 2 }] } }]
        },
        {
          id: 'case-tech-2',
          clientName: 'Client Concurrent',
          vehicle: 'Citroen C3',
          plate: '456 TU 789',
          flags: { received: true },
          appointment: { start: '${start}', end: '${end}', delivery: '${end}', marginMinutes: 15 },
          claims: [{ type: 'client', includeInPlanning: true, expertApproved: true, clientApproved: true, estimate: { lines: [{ phase: 'mechanical', operation: 'MO', laborHours: 1 }] } }]
        }
      ],
      bookings: [
        { id: 'booking-main', caseId: 'case-tech', key: 'mechanical', title: 'Réparation mécanique', resourceIds: ['tech-1', 'pont-1'], primaryResourceId: 'tech-1', segments: [{ start: '${start}', end: '${end}' }], start: '${start}', end: '${end}', plannedStart: '${start}', plannedEnd: '${end}', plannedMinutes: 120 },
        { id: 'booking-concurrent', caseId: 'case-tech-2', key: 'mechanical', title: 'Diagnostic mécanique', resourceIds: ['tech-1', 'pont-1'], primaryResourceId: 'tech-1', segments: [{ start: '${start}', end: '${end}' }], start: '${start}', end: '${end}', plannedStart: '${start}', plannedEnd: '${end}', plannedMinutes: 60 }
      ]
    });
  `, context);
}

setupTechnicianState();

const startResult = app(`startTechnicianTask(state.cases[0], 'booking-main', 'tech-1')`);
assert.equal(startResult.ok, true, 'un technicien doit pouvoir démarrer une tâche prête');
assert.equal(app(`state.bookings.find((booking) => booking.id === 'booking-main').status`), 'started');
assert.equal(app(`state.bookings.find((booking) => booking.id === 'booking-main').startedBy`), 'tech-1');

const concurrentResult = app(`startTechnicianTask(state.cases[1], 'booking-concurrent', 'tech-1')`);
assert.equal(concurrentResult.ok, false, 'un technicien ne doit pas démarrer deux tâches simultanées');
assert.match(concurrentResult.message, /déjà une tâche en cours/i);

const pauseWithoutReason = app(`pauseTechnicianTask(state.cases[0], 'booking-main', 'tech-1', '')`);
assert.equal(pauseWithoutReason.ok, false, 'une pause doit exiger un motif');

const pauseResult = app(`pauseTechnicianTask(state.cases[0], 'booking-main', 'tech-1', 'attente pièces')`);
assert.equal(pauseResult.ok, true, 'une tâche démarrée doit pouvoir être mise en pause');
const pausedOriginal = app(`state.bookings.find((booking) => booking.id === 'booking-main')`);
const remainder = app(`state.bookings.find((booking) => booking.parentBookingId === 'booking-main')`);
assert.equal(pausedOriginal.status, 'paused');
assert.equal(pausedOriginal.pausedBy, 'tech-1');
assert.ok(pausedOriginal.actualWorkedMinutes > 0, 'le temps travaillé doit être conservé');
assert.equal(remainder.remainingFromPaused, true, 'la pause doit créer un reliquat planifié');

const resumeResult = app(`resumeTechnicianTask(state.cases[0], '${remainder.id}', 'tech-1')`);
assert.equal(resumeResult.ok, true, 'le reliquat doit pouvoir être repris');
assert.equal(app(`state.bookings.find((booking) => booking.id === '${remainder.id}').status`), 'started');

const noteResult = app(`addTechnicianTaskNote(state.cases[0], '${remainder.id}', 'tech-1', 'Contrôle serrage OK')`);
assert.equal(noteResult.ok, true, 'une note technicien doit être ajoutée');
assert.equal(app(`state.bookings.find((booking) => booking.id === '${remainder.id}').notes.length`), 1);

const completeResult = app(`completeTechnicianTask(state.cases[0], '${remainder.id}', 'tech-1', { note: 'Terminé proprement', skipPhotoCheck: true })`);
assert.equal(completeResult.ok, true, 'une tâche reprise doit pouvoir être terminée');
assert.equal(app(`state.bookings.find((booking) => booking.id === '${remainder.id}').status`), 'completed');
assert.equal(app(`state.bookings.find((booking) => booking.id === 'booking-main').status`), 'completed');
assert.equal(app(`state.cases[0].flags.workCompleted`), true, 'la dernière tâche atelier doit envoyer le dossier vers contrôle qualité');

setupTechnicianState();
const blockResult = app(`blockTechnicianTask(state.cases[0], 'booking-main', 'tech-1', 'attente pièces', 'Filtre non reçu')`);
assert.equal(blockResult.ok, true, 'une tâche doit pouvoir être bloquée avec motif');
assert.equal(app(`state.bookings.find((booking) => booking.id === 'booking-main').blockReason`), 'attente pièces');
assert.equal(app(`state.cases[0].blockerReason`), 'waiting_parts');
assert.equal(app(`getTechnicianTaskStatus(state.cases[0], state.bookings.find((booking) => booking.id === 'booking-main'))`), 'blocked');

setupTechnicianState();
app(`state.bookings.find((booking) => booking.id === 'booking-main').resourceIds = ['pont-1']; state.bookings.find((booking) => booking.id === 'booking-main').primaryResourceId = 'pont-1';`);
const noTechnicianHandleResult = await app(`handleBookingTaskAction(state.cases[0], 'start', 'booking-main', { allowOverride: false, silent: true, persist: false, skipRender: true })`);
assert.equal(noTechnicianHandleResult.ok, false, 'handleBookingTaskAction ne doit pas démarrer sans technicien');
assert.equal(app(`state.bookings.find((booking) => booking.id === 'booking-main').status`), 'planned');

setupTechnicianState();
app(`state.cases[0].flags.received = false`);
const notReceivedHandleResult = await app(`handleBookingTaskAction(state.cases[0], 'start', 'booking-main', { allowOverride: false, silent: true, persist: false, skipRender: true })`);
assert.equal(notReceivedHandleResult.ok, false, 'handleBookingTaskAction doit refuser un véhicule non réceptionné');
assert.match(notReceivedHandleResult.message, /réception/i);

setupTechnicianState();
const wrongTechnicianHandleResult = await app(`handleBookingTaskAction(state.cases[0], 'start', 'booking-main', { technicianId: 'tech-2', allowOverride: false, silent: true, persist: false, skipRender: true })`);
assert.equal(wrongTechnicianHandleResult.ok, false, 'handleBookingTaskAction doit refuser une tâche non affectée au technicien');
assert.match(wrongTechnicianHandleResult.message, /affectée/i);

setupTechnicianState();
app(`state.cases[0].claims[0].clientApproved = false`);
const missingApprovalHandleResult = await app(`handleBookingTaskAction(state.cases[0], 'start', 'booking-main', { allowOverride: false, silent: true, persist: false, skipRender: true })`);
assert.equal(missingApprovalHandleResult.ok, false, 'handleBookingTaskAction doit refuser un accord requis manquant');
assert.match(missingApprovalHandleResult.message, /validation client|accord/i);

setupTechnicianState();
const guardedStartResult = await app(`handleBookingTaskAction(state.cases[0], 'start', 'booking-main', { allowOverride: false, silent: true, persist: false, skipRender: true })`);
assert.equal(guardedStartResult.ok, true, 'handleBookingTaskAction doit démarrer via le flux technicien sécurisé');
const guardedConcurrentResult = await app(`handleBookingTaskAction(state.cases[1], 'start', 'booking-concurrent', { allowOverride: false, silent: true, persist: false, skipRender: true })`);
assert.equal(guardedConcurrentResult.ok, false, 'handleBookingTaskAction doit refuser deux tâches actives pour le même technicien');
assert.match(guardedConcurrentResult.message, /déjà une tâche en cours/i);

setupTechnicianState();
app(`const b = state.bookings.find((booking) => booking.id === 'booking-main'); b.status = 'started'; b.startedBy = ''; b.resourceIds = ['pont-1']; b.primaryResourceId = 'pont-1';`);
const completeWithoutTechnicianResult = await app(`handleBookingTaskAction(state.cases[0], 'complete', 'booking-main', { allowOverride: false, skipConfirmation: true, silent: true, persist: false, skipRender: true })`);
assert.equal(completeWithoutTechnicianResult.ok, false, 'handleBookingTaskAction ne doit pas terminer sans completedBy/technicien ou override');
assert.equal(app(`state.bookings.find((booking) => booking.id === 'booking-main').completedBy`), '');

setupTechnicianState();
app(`state.cases[0].flags.received = false`);
const overrideResult = await app(`handleBookingTaskAction(state.cases[0], 'start', 'booking-main', { overrideConfirmed: true, overrideReason: 'Urgence chef atelier', silent: true, persist: false, skipRender: true })`);
assert.equal(overrideResult.ok, true, 'un override chef atelier explicite doit permettre une exception contrôlée');
assert.equal(app(`state.bookings.find((booking) => booking.id === 'booking-main').status`), 'started');
assert.equal(app(`state.cases[0].history.some((entry) => entry.type === 'planning.task.override' && /Urgence chef atelier/.test(entry.details))`), true, 'override chef atelier doit être historisé avec motif');

const legacyState = app(`normalizeState({
  resources: [{ id: 'tech-legacy', name: 'Ancien tech', role: 'mecanicien', active: true }],
  cases: [{ id: 'case-legacy', clientName: 'Ancien dossier' }],
  bookings: [
    { id: 'legacy-started', caseId: 'case-legacy', key: 'mechanical', status: 'in_progress', resourceIds: ['tech-legacy'], segments: [{ start: '2026-05-25T08:00:00.000Z', end: '2026-05-25T09:00:00.000Z' }] },
    { id: 'legacy-done', caseId: 'case-legacy', key: 'mechanical', status: 'done', resourceIds: ['tech-legacy'], segments: [{ start: '2026-05-25T09:00:00.000Z', end: '2026-05-25T10:00:00.000Z' }] }
  ]
})`, context);
assert.equal(legacyState.bookings[0].status, 'started', 'alias in_progress doit être accepté');
assert.equal(legacyState.bookings[1].status, 'completed', 'alias done doit être accepté');
assert.equal(Array.isArray(legacyState.bookings[0].notes), true, 'ancien booking sans notes doit recevoir un tableau notes');
assert.equal(legacyState.bookings[0].notes.length, 0, 'ancien booking sans notes reste compatible');

setupTechnicianState();
writes.length = 0;
app(`printTechnicianTaskSheet(state.cases[0], 'booking-main', 'tech-1')`);
assert.ok(writes.join('').includes('Fiche de travail technicien'), 'la fiche technicien doit être imprimable');
assert.ok(writes.join('').includes('□ tâche démarrée'), 'la fiche technicien doit contenir les cases de suivi');

writes.length = 0;
app(`state.bookings.push({ id: 'leave-tech', type: 'leave', caseId: '__leave__', key: 'leave', title: 'Congé tech', resourceIds: ['tech-1'], primaryResourceId: 'tech-1', segments: [{ start: '2026-05-25T10:00:00.000Z', end: '2026-05-25T11:00:00.000Z' }], start: '2026-05-25T10:00:00.000Z', end: '2026-05-25T11:00:00.000Z' }); printDailyPlanning('2026-05-25')`);
assert.equal(writes.join('').includes('Congé tech</td>'), false, 'le planning journalier ne doit pas mélanger absences et travaux');

console.log('Technician flow regression OK');
