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
  .replace(/initApp\(\);/, '// initApp skipped by v22.29 tests')
  .replace(/if \("serviceWorker" in navigator[\s\S]*$/u, '');

function stubElement() {
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    appendChild() {},
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
  navigator: { onLine: true, serviceWorker: undefined, storage: { estimate: async () => ({}) } },
  window: { addEventListener() {}, location: { reload() {} }, matchMedia: () => ({ matches: false, addEventListener() {} }), prompt: () => 'override' },
  setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 1; },
  clearTimeout: () => {},
  setInterval: () => 1,
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

function setupBusinessTaskState() {
  vm.runInContext(`
    state = normalizeState({
      settings: {
        workHours: {
          1: [['08:00', '12:00'], ['13:00', '17:00']],
          2: [['08:00', '12:00'], ['13:00', '17:00']],
          3: [['08:00', '12:00'], ['13:00', '17:00']],
          4: [['08:00', '12:00'], ['13:00', '17:00']],
          5: [['08:00', '12:00'], ['13:00', '17:00']]
        }
      },
      users: [{ id: 'admin', name: 'Admin', role: 'admin', active: true }],
      currentUserId: 'admin',
      resources: [
        { id: 'tech-body', name: 'Tôlier', role: 'tolier', active: true },
        { id: 'tech-prep', name: 'Préparateur', role: 'peintre', active: true },
        { id: 'tech-paint', name: 'Peintre', role: 'peintre', active: true }
      ],
      cases: [{
        id: 'case-v2229',
        clientName: 'Client v22.29',
        vehicle: 'Vehicule test',
        plate: '123TU456',
        flags: { received: true, expertApproved: true, clientApproved: true },
        durations: { body: 1, prep: 3, paint: 1, quality: 0.25 },
        claims: [{ id: 'claim-1', type: 'client', includeInPlanning: true, clientApproved: true, estimate: { lines: [{ phase: 'prep', operation: 'Préparation', laborHours: 3 }] } }]
      }],
      bookings: [
        {
          id: 'booking-body',
          caseId: 'case-v2229',
          key: 'body',
          title: 'Tôlerie',
          resourceIds: ['tech-body'],
          primaryResourceId: 'tech-body',
          segments: [{ start: '2026-06-02T08:00:00.000Z', end: '2026-06-02T09:00:00.000Z' }],
          start: '2026-06-02T08:00:00.000Z',
          end: '2026-06-02T09:00:00.000Z',
          actualEnd: '2026-06-02T09:00:00.000Z',
          status: 'completed',
          plannedMinutes: 60
        },
        {
          id: 'booking-prep-old',
          caseId: 'case-v2229',
          key: 'prep',
          title: 'Préparation ancienne amplitude',
          resourceIds: ['tech-prep'],
          primaryResourceId: 'tech-prep',
          segments: [{ start: '2026-06-04T08:00:00.000Z', end: '2026-06-06T17:00:00.000Z' }],
          start: '2026-06-04T08:00:00.000Z',
          end: '2026-06-06T17:00:00.000Z',
          status: 'planned'
        }
      ]
    });
  `, context);
}

setupBusinessTaskState();
assert.equal(app(`getBookingEffectivePlanningMinutes(state.bookings.find((booking) => booking.id === 'booking-prep-old'), state.cases[0])`), 180, 'ancien booking sans plannedMinutes doit utiliser item.durations');
assert.equal(app(`getBookingDurationMinutes(state.bookings.find((booking) => booking.id === 'booking-prep-old'))`) > 180, true, 'le booking ancien porte bien une amplitude technique multi-jours');
assert.equal(app(`refreshCaseAppointmentFromBookings(state.cases[0]); state.cases[0].appointment.marginMinutes`), 60, 'refreshCaseAppointmentFromBookings doit utiliser les durées productives, pas une amplitude multi-jours');

const previewBefore = app(`JSON.stringify(state.bookings)`);
const previews = app(`previewDependentBookingReschedule(state.cases[0], state.bookings.find((booking) => booking.id === 'booking-body'))`);
assert.equal(app(`JSON.stringify(state.bookings)`), previewBefore, 'preview v22.29 ne doit pas muter les bookings');
assert.equal(previews.length, 1, 'la tâche dépendante doit être proposée au recalage');
assert.equal(previews[0].plannedMinutes, 180, 'le recalage dynamique doit utiliser la durée productive');
assert.equal(app(`sumBookingSegmentsMinutes(${JSON.stringify(previews[0].segments)})`), 180, 'le preview doit porter des segments valides de 3 h');
assert.equal(previews[0].newStart, '2026-06-02T09:00:00.000Z', 'le recalage démarre au plus tôt après la tâche précédente');
assert.match(previews[0].newEnd, /^2026-06-02T/, 'la fin recalée reste le même jour et ne reprend pas une amplitude multi-jours');

const applyResult = app(`applyDependentBookingReschedule(state.cases[0], ${JSON.stringify(previews)}, 'Chef Atelier')`);
assert.equal(applyResult.ok, true);
assert.equal(applyResult.rescheduled, 1);
assert.equal(app(`state.bookings.find((booking) => booking.id === 'booking-prep-old').plannedMinutes`), 180, 'la tâche recalée conserve plannedMinutes productif');
assert.equal(app(`sumBookingSegmentsMinutes(state.bookings.find((booking) => booking.id === 'booking-prep-old').segments)`), 180, 'le Gantt conserve les segments techniques utiles');

vm.runInContext(`
  state = normalizeState({
    users: [{ id: 'admin', name: 'Admin', role: 'admin', active: true }],
    currentUserId: 'admin',
    resources: [{ id: 'tech-1', name: 'Technicien', role: 'mecanicien', active: true }],
    cases: [{ id: 'case-pause', clientName: 'Client pause', flags: { received: true }, durations: { mechanical: 2 }, claims: [{ type: 'client', includeInPlanning: true, clientApproved: true, estimate: { lines: [{ phase: 'mechanical', operation: 'MO', laborHours: 2 }] } }] }],
    bookings: [
      {
        id: 'pause-parent',
        caseId: 'case-pause',
        businessTaskId: 'pause-parent',
        key: 'mechanical',
        title: 'Réparation mécanique',
        resourceIds: ['tech-1'],
        primaryResourceId: 'tech-1',
        segments: [{ start: '2026-06-02T08:00:00.000Z', end: '2026-06-02T09:00:00.000Z' }],
        start: '2026-06-02T08:00:00.000Z',
        end: '2026-06-02T09:00:00.000Z',
        plannedMinutes: 120,
        remainingMinutes: 60,
        status: 'paused',
        pauseReason: 'attente pièces',
        supersededBy: 'pause-remainder'
      },
      {
        id: 'pause-remainder',
        caseId: 'case-pause',
        businessTaskId: 'pause-parent',
        parentBookingId: 'pause-parent',
        remainingFromPaused: true,
        key: 'mechanical',
        title: 'Reprise - Réparation mécanique',
        resourceIds: ['tech-1'],
        primaryResourceId: 'tech-1',
        segments: [{ start: '2026-06-02T10:00:00.000Z', end: '2026-06-02T11:00:00.000Z' }],
        start: '2026-06-02T10:00:00.000Z',
        end: '2026-06-02T11:00:00.000Z',
        plannedMinutes: 60,
        status: 'planned'
      }
    ]
  });
`, context);

let rows = app(`getCaseBusinessTaskRows(state.cases[0])`);
assert.equal(rows.length, 1, 'détail dossier doit agréger parent + reliquat en une tâche métier');
assert.equal(rows[0].status, 'paused', 'parent paused + reliquat planned doit afficher En pause');
assert.equal(rows[0].pauseRemainder, true, 'la ligne métier signale une reprise planifiée');
assert.equal(rows[0].actionBookingId, 'pause-remainder', 'l’action opérationnelle cible le reliquat');
assert.equal(app(`getCaseIncompleteTechnicianBookings(state.cases[0]).length`), 1, 'clôture globale compte une famille incomplète comme une seule tâche');
assert.equal(app(`isBusinessTaskFamilyCompleted(getCaseBusinessTaskRows(state.cases[0])[0].bookings)`), false, 'famille incomplète tant que le reliquat est planned');
assert.equal(app(`state.bookings.length`), 2, 'les segments techniques restent présents pour le planning');
assert.equal(app(`state.bookings.find((booking) => booking.id === 'pause-parent').status`), 'paused', 'pause ne marque pas le parent comme completed');

vm.runInContext(`state.bookings.find((booking) => booking.id === 'pause-remainder').status = 'started';`, context);
rows = app(`getCaseBusinessTaskRows(state.cases[0])`);
assert.equal(rows.length, 1, 'reprise en cours reste une seule ligne métier');
assert.equal(rows[0].status, 'in_progress', 'reprise en cours doit afficher En cours');

vm.runInContext(`
  state.bookings.find((booking) => booking.id === 'pause-parent').status = 'completed';
  state.bookings.find((booking) => booking.id === 'pause-remainder').status = 'completed';
`, context);
rows = app(`getCaseBusinessTaskRows(state.cases[0])`);
assert.equal(rows.length, 1, 'fin après reprise reste une seule ligne métier');
assert.equal(rows[0].status, 'done', 'famille complétée doit afficher Terminée');
assert.equal(app(`isBusinessTaskFamilyCompleted(getCaseBusinessTaskRows(state.cases[0])[0].bookings)`), true, 'famille complète seulement quand tous les segments sont completed');
assert.equal(app(`getCaseIncompleteTechnicianBookings(state.cases[0]).length`), 0, 'clôture globale ne voit plus de tâche incomplète');

vm.runInContext(`state.cases[0].flags.delivered = true;`, context);
assert.equal(app(`previewDependentBookingReschedule(state.cases[0], state.bookings[0]).length`), 0, 'dossier livré/clôturé opérationnel v22.26 non affecté par le recalage');

console.log('Planning business task aggregation v22.29 OK');
