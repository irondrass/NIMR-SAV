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
  .replace(/initApp\(\);/, '// initApp skipped by v22.21 technician safety tests')
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
    open: () => ({ document: { write() {}, close() {} } }),
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
assert.match(stateSource, /APP_VERSION\s*=\s*"v23\.0\.4"/, 'APP_VERSION doit être en v23.0.4');
assert.match(appSource, /serviceWorker\.register\("sw\.js\?v=23\.0\.4"/, 'le service worker doit pointer vers sw.js?v=23.0.4');
assert.match(swSource, /nimr-sav-v23\.0\.4-sync-conflict-resolution/, 'le cache PWA doit être en v23.0.4');
assert.match(versionSource, /NIMR_BUILD\s*=\s*"v23\.0\.4"/, 'js/version.js doit exposer v23.0.4');
[...indexSource.matchAll(/\?v=(\d+\.\d+(?:\.\d+)?)/g)].forEach((match) => {
  assert.equal(match[1], '23.0.4', `référence index.html incohérente: ?v=${match[1]}`);
});

function setupSafetyState(extraBookings = '') {
  vm.runInContext(`
    state = normalizeState({
      resources: [
        { id: 'tech-1', name: 'Technicien 1', role: 'mecanicien', active: true },
        { id: 'tech-2', name: 'Technicien 2', role: 'mecanicien', active: true },
        { id: 'pont-1', name: 'Pont 1', role: 'pont_mecanique', active: true }
      ],
      cases: [{
        id: 'case-safety',
        clientName: 'Client Sécurité',
        phone: '+216 55 000 000',
        vehicle: 'Peugeot 208',
        plate: '123 TU 456',
        orNavNumber: 'OR-SAFE',
        flags: { received: true },
        appointment: {
          start: '2026-06-01T08:00:00.000Z',
          end: '2026-06-01T12:00:00.000Z',
          delivery: '2026-06-01T12:00:00.000Z',
          marginMinutes: 15
        },
        claims: [{
          type: 'client',
          includeInPlanning: true,
          expertApproved: true,
          clientApproved: true,
          estimate: {
            lines: [
              { phase: 'body', operation: 'Tôlerie', laborHours: 1 },
              { phase: 'mechanical', operation: 'Mécanique', laborHours: 1 },
              { phase: 'prep', operation: 'Préparation', laborHours: 1 }
            ]
          }
        }]
      }],
      bookings: [
        {
          id: 'booking-body',
          caseId: 'case-safety',
          key: 'body',
          title: 'Tôlerie + démontage',
          resourceIds: ['tech-1'],
          primaryResourceId: 'tech-1',
          segments: [{ start: '2026-06-01T08:00:00.000Z', end: '2026-06-01T09:00:00.000Z' }],
          start: '2026-06-01T08:00:00.000Z',
          end: '2026-06-01T09:00:00.000Z',
          plannedStart: '2026-06-01T08:00:00.000Z',
          plannedEnd: '2026-06-01T09:00:00.000Z',
          plannedMinutes: 60
        },
        {
          id: 'booking-main',
          caseId: 'case-safety',
          key: 'mechanical',
          title: 'Réparation mécanique',
          resourceIds: ['tech-1', 'pont-1'],
          primaryResourceId: 'tech-1',
          segments: [{ start: '2026-06-01T09:00:00.000Z', end: '2026-06-01T11:00:00.000Z' }],
          start: '2026-06-01T09:00:00.000Z',
          end: '2026-06-01T11:00:00.000Z',
          plannedStart: '2026-06-01T09:00:00.000Z',
          plannedEnd: '2026-06-01T11:00:00.000Z',
          plannedMinutes: 120
        },
        {
          id: 'booking-prep',
          caseId: 'case-safety',
          key: 'prep',
          title: 'Préparation',
          resourceIds: ['tech-1'],
          primaryResourceId: 'tech-1',
          segments: [{ start: '2026-06-01T09:00:00.000Z', end: '2026-06-01T10:00:00.000Z' }],
          start: '2026-06-01T09:00:00.000Z',
          end: '2026-06-01T10:00:00.000Z',
          plannedStart: '2026-06-01T09:00:00.000Z',
          plannedEnd: '2026-06-01T10:00:00.000Z',
          plannedMinutes: 60
        }
        ${extraBookings}
      ]
    });
  `, context);
}

setupSafetyState();
app(`
  const item = state.cases[0];
  item.partsStatus = 'waiting_parts';
  item.blockerReason = 'waiting_customer';
  item.blockerDetails = 'Blocage manuel réception';
  item.blockerSource = 'manual';
`);
let manualBlockResult = app(`blockTechnicianTask(state.cases[0], 'booking-main', 'tech-1', 'attente pièces', 'Filtre non reçu')`);
assert.equal(manualBlockResult.ok, true, 'une tâche peut être bloquée même si le dossier a déjà un blocage manuel');
let manualClearResult = app(`clearTechnicianTaskBlock(state.cases[0], 'booking-main', 'tech-1')`);
assert.equal(manualClearResult.ok, true, 'le blocage tâche doit pouvoir être levé');
assert.equal(app(`state.cases[0].blockerReason`), 'waiting_customer', 'le motif dossier manuel doit être conservé');
assert.equal(app(`state.cases[0].blockerDetails`), 'Blocage manuel réception', 'le détail manuel doit être conservé');
assert.equal(app(`state.cases[0].partsStatus`), 'waiting_parts', 'le statut pièces manuel doit être conservé');

setupSafetyState();
let firstBlock = app(`blockTechnicianTask(state.cases[0], 'booking-main', 'tech-1', 'attente pièces', 'Filtre non reçu')`);
let secondBlock = app(`blockTechnicianTask(state.cases[0], 'booking-prep', 'tech-1', 'attente chef atelier', 'Validation complément')`);
assert.equal(firstBlock.ok, true);
assert.equal(secondBlock.ok, true);
let firstClear = app(`clearTechnicianTaskBlock(state.cases[0], 'booking-main', 'tech-1')`);
assert.equal(firstClear.ok, true);
assert.equal(app(`isCaseBlocked(state.cases[0])`), true, 'un autre blocage tâche doit garder le dossier bloqué');
assert.equal(app(`isBookingTaskBlocked(state.bookings.find((booking) => booking.id === 'booking-prep'))`), true, 'l’autre tâche bloquée doit rester bloquée');
assert.equal(JSON.stringify(app(`state.cases[0].blockerSourceBookingIds`)), JSON.stringify(['booking-prep']));

setupSafetyState(`,
        {
          id: 'leave-overlap',
          type: 'leave',
          caseId: '__leave__',
          key: 'leave',
          title: 'Congé technicien',
          resourceIds: ['tech-1'],
          primaryResourceId: 'tech-1',
          segments: [{ start: '2026-06-01T10:00:00.000Z', end: '2026-06-01T10:30:00.000Z' }],
          start: '2026-06-01T10:00:00.000Z',
          end: '2026-06-01T10:30:00.000Z'
        }`);
let leaveOverlapResult = app(`startTechnicianTask(state.cases[0], 'booking-main', 'tech-1')`);
assert.equal(leaveOverlapResult.ok, false, 'un congé qui chevauche le créneau doit bloquer le démarrage');
assert.match(leaveOverlapResult.message, /indisponible pendant le créneau/i);

setupSafetyState(`,
        {
          id: 'leave-outside',
          type: 'leave',
          caseId: '__leave__',
          key: 'leave',
          title: 'Congé hors créneau',
          resourceIds: ['tech-1'],
          primaryResourceId: 'tech-1',
          segments: [{ start: '2026-06-01T12:00:00.000Z', end: '2026-06-01T13:00:00.000Z' }],
          start: '2026-06-01T12:00:00.000Z',
          end: '2026-06-01T13:00:00.000Z'
        }`);
let leaveOutsideResult = app(`startTechnicianTask(state.cases[0], 'booking-main', 'tech-1')`);
assert.equal(leaveOutsideResult.ok, true, 'un congé hors créneau ne doit pas bloquer le démarrage');

setupSafetyState(`,
        {
          id: 'leave-before-remainder',
          type: 'leave',
          caseId: '__leave__',
          key: 'leave',
          title: 'Congé avant reliquat',
          resourceIds: ['tech-1'],
          primaryResourceId: 'tech-1',
          segments: [{ start: '2026-06-01T09:15:00.000Z', end: '2026-06-01T09:45:00.000Z' }],
          start: '2026-06-01T09:15:00.000Z',
          end: '2026-06-01T09:45:00.000Z'
        },
        {
          id: 'booking-remainder',
          caseId: 'case-safety',
          key: 'mechanical',
          title: 'Reliquat mécanique',
          resourceIds: ['tech-1', 'pont-1'],
          primaryResourceId: 'tech-1',
          parentBookingId: 'booking-main',
          remainingFromPaused: true,
          remainingMinutes: 60,
          segments: [{ start: '2026-06-01T12:00:00.000Z', end: '2026-06-01T13:00:00.000Z' }],
          start: '2026-06-01T12:00:00.000Z',
          end: '2026-06-01T13:00:00.000Z',
          plannedStart: '2026-06-01T12:00:00.000Z',
          plannedEnd: '2026-06-01T13:00:00.000Z',
          plannedMinutes: 60
        }`);
app(`const original = state.bookings.find((booking) => booking.id === 'booking-main'); original.status = 'paused'; original.remainingMinutes = 60; original.pausedAt = '2026-06-01T10:00:00.000Z';`);
let resumeRemainderResult = app(`resumeTechnicianTask(state.cases[0], 'booking-main', 'tech-1')`);
assert.equal(resumeRemainderResult.ok, true, 'un reliquat hors congé doit pouvoir être repris');
assert.equal(app(`state.bookings.find((booking) => booking.id === 'booking-remainder').status`), 'started');

setupSafetyState();
let blockedGlobalResult = await app(`completeCaseWorkWithChiefOverride(state.cases[0], { allowOverride: false })`);
assert.equal(blockedGlobalResult.ok, false, 'la clôture globale ne doit pas terminer silencieusement les tâches affectées');
assert.equal(app(`state.bookings.find((booking) => booking.id === 'booking-main').status`), 'planned');

let missingOverrideReason = await app(`completeCaseWorkWithChiefOverride(state.cases[0], { overrideConfirmed: true })`);
assert.equal(missingOverrideReason.ok, false, 'un override chef atelier doit exiger un motif');
assert.match(missingOverrideReason.message, /Motif override/i);

let overrideResult = await app(`completeCaseWorkWithChiefOverride(state.cases[0], { overrideConfirmed: true, overrideReason: 'Clôture chef atelier après contrôle terrain' })`);
assert.equal(overrideResult.ok, true, 'un override motivé doit pouvoir clôturer les tâches');
assert.equal(app(`state.bookings.filter((booking) => booking.caseId === 'case-safety' && booking.type !== 'leave').every((booking) => booking.status === 'completed')`), true);
assert.equal(app(`state.bookings.find((booking) => booking.id === 'booking-main').completedByOverride`), 'chef-atelier');
assert.equal(app(`state.cases[0].history.some((entry) => entry.type === 'planning.work.completed.override' && /Clôture chef atelier/.test(entry.details))`), true, 'l’override global doit être historisé');

setupSafetyState();
let precedenceResult = app(`startTechnicianTask(state.cases[0], 'booking-prep', 'tech-1')`);
assert.equal(precedenceResult.ok, false, 'la préparation standard doit attendre la tâche précédente obligatoire');
assert.match(precedenceResult.message, /tâche précédente obligatoire/i);

setupSafetyState();
app(`state.bookings.find((booking) => booking.id === 'booking-prep').planningMode = 'anticipated-new-part'`);
let anticipatedPrepResult = app(`startTechnicianTask(state.cases[0], 'booking-prep', 'tech-1')`);
assert.equal(anticipatedPrepResult.ok, true, 'la préparation anticipée pièces neuves doit rester autorisée en parallèle');

console.log('Technician flow v22.21 safety OK');
