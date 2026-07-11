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
  .replace(/initApp\(\);/, '// initApp skipped by dynamic reschedule tests')
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
    getElementById: () => stubElement(),
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

// Force UTC behavior for Date inside VM
vm.runInContext(`
  Date.prototype.getHours = Date.prototype.getUTCHours;
  Date.prototype.setHours = function(h, m, s, ms) {
    return this.setUTCHours(
      h,
      m !== undefined ? m : this.getUTCMinutes(),
      s !== undefined ? s : this.getUTCSeconds(),
      ms !== undefined ? ms : this.getUTCMilliseconds()
    );
  };
  Date.prototype.getDay = Date.prototype.getUTCDay;
  Date.prototype.getDate = Date.prototype.getUTCDate;
  Date.prototype.setDate = Date.prototype.setUTCDate;
  Date.prototype.getMonth = Date.prototype.getUTCMonth;
  Date.prototype.setMonth = Date.prototype.setUTCMonth;
  Date.prototype.getFullYear = Date.prototype.getUTCFullYear;
  Date.prototype.setFullYear = Date.prototype.setUTCFullYear;
`, context);

vm.runInContext(source, context);
const app = (code) => vm.runInContext(code, context);

// Setup Mock Date inside VM
vm.runInContext(`
  let mockTime = null;
  const OriginalDate = Date;
  Date = class extends OriginalDate {
    constructor(...args) {
      if (args.length === 0 && mockTime) {
        super(mockTime);
      } else {
        super(...args);
      }
    }
    static now() {
      return mockTime ? new OriginalDate(mockTime).getTime() : OriginalDate.now();
    }
  };
`, context);

function setMockTime(isoString) {
  vm.runInContext(`mockTime = '${isoString}';`, context);
}

// ----------------------------------------------------
// Setup initial case and bookings for test
// Case details: Peugeot Partner
// Step A (Body): 08:00 -> 10:00 (planned)
// Step B (Prep): 10:00 -> 11:30 (planned)
// Step C (Paint): 11:30 -> 13:00 (planned)
// ----------------------------------------------------
function setupPlanningRescheduleState() {
  setMockTime('2026-06-02T08:00:00.000Z');
  vm.runInContext(`
    state = normalizeState({
      users: [{ id: 'user-chief', name: 'Chef Atelier', role: 'chef_atelier', active: true }],
      currentUserId: 'user-chief',
      resources: [
        { id: 'tech-body', name: 'Tôlier 1', role: 'tolier', active: true },
        { id: 'tech-painter', name: 'Peintre 1', role: 'peintre', active: true }
      ],
      cases: [{
        id: 'case-reschedule',
        clientName: 'Client Reschedule',
        vehicle: 'Peugeot Partner',
        plate: '228 TN 123',
        flags: { received: true, workStarted: false, workCompleted: false, clientApproved: true, expertApproved: true },
        appointment: { start: '2026-06-02T08:00:00.000Z', end: '2026-06-02T13:00:00.000Z', delivery: '2026-06-02T13:15:00.000Z', marginMinutes: 15 },
        durations: { body: 2, prep: 1.5, paint: 1.5 },
        claims: [{ type: 'client', includeInPlanning: true, clientApproved: true, expertApproved: true, estimate: { lines: [
          { phase: 'body', laborHours: 2 },
          { phase: 'prep', laborHours: 1.5 },
          { phase: 'paint', laborHours: 1.5 }
        ] } }]
      }],
      bookings: [
        {
          id: 'booking-a-body',
          caseId: 'case-reschedule',
          key: 'body',
          title: 'Tôlerie',
          resourceIds: ['tech-body'],
          primaryResourceId: 'tech-body',
          segments: [{ start: '2026-06-02T08:00:00.000Z', end: '2026-06-02T10:00:00.000Z' }],
          start: '2026-06-02T08:00:00.000Z',
          end: '2026-06-02T10:00:00.000Z',
          plannedStart: '2026-06-02T08:00:00.000Z',
          plannedEnd: '2026-06-02T10:00:00.000Z',
          plannedMinutes: 120,
          status: 'planned'
        },
        {
          id: 'booking-b-prep',
          caseId: 'case-reschedule',
          key: 'prep',
          title: 'Préparation',
          resourceIds: ['tech-painter'],
          primaryResourceId: 'tech-painter',
          segments: [{ start: '2026-06-02T10:00:00.000Z', end: '2026-06-02T11:30:00.000Z' }],
          start: '2026-06-02T10:00:00.000Z',
          end: '2026-06-02T11:30:00.000Z',
          plannedStart: '2026-06-02T10:00:00.000Z',
          plannedEnd: '2026-06-02T11:30:00.000Z',
          plannedMinutes: 90,
          status: 'planned'
        },
        {
          id: 'booking-c-paint',
          caseId: 'case-reschedule',
          key: 'paint',
          title: 'Peinture',
          resourceIds: ['tech-painter'],
          primaryResourceId: 'tech-painter',
          segments: [{ start: '2026-06-02T11:30:00.000Z', end: '2026-06-02T13:00:00.000Z' }],
          start: '2026-06-02T11:30:00.000Z',
          end: '2026-06-02T13:00:00.000Z',
          plannedStart: '2026-06-02T11:30:00.000Z',
          plannedEnd: '2026-06-02T13:00:00.000Z',
          plannedMinutes: 90,
          status: 'planned'
        }
      ]
    });
  `, context);
}

// ----------------------------------------------------
// Assertion 15: Preview sans application ne modifie pas state.bookings
// ----------------------------------------------------
setupPlanningRescheduleState();
assert.equal(app(`startTechnicianTask(state.cases[0], 'booking-a-body', 'tech-body').ok`), true);
setMockTime('2026-06-02T09:00:00.000Z'); // completes A 1 hour early!
assert.equal(app(`completeTechnicianTask(state.cases[0], 'booking-a-body', 'tech-body', { skipPhotoCheck: true }).ok`), true);

const initialBookingsJson = app(`JSON.stringify(state.bookings)`);
const previews = app(`previewDependentBookingReschedule(state.cases[0], state.bookings.find(b => b.id === 'booking-a-body'))`);
assert.ok(previews.length > 0, 'il doit y avoir des propositions de recalage');
assert.equal(app(`JSON.stringify(state.bookings)`), initialBookingsJson, 'preview ne doit pas muter les bookings réels');

// Verify preview output properties
assert.equal(previews[0].bookingId, 'booking-b-prep');
assert.equal(previews[0].newStart, '2026-06-02T09:00:00.000Z', 'Step B should start at 09:00 (completion time of A)');
assert.equal(previews[1].bookingId, 'booking-c-paint');
assert.equal(previews[1].newStart, '2026-06-02T10:30:00.000Z', 'Step C should start at 10:30 (simulated end of B)');

// ----------------------------------------------------
// Assertion 1: Tâche A finit plus tôt, tâche B dépendante est avancée.
// Assertion 2: Tâche B planned uniquement est déplacée.
// Assertion 14: Historique contient ancienne/nouvelle heure, acteur et raison.
// ----------------------------------------------------
const applyResult = app(`applyDependentBookingReschedule(state.cases[0], ${JSON.stringify(previews)}, 'Chef Atelier')`);
assert.equal(applyResult.ok, true);
assert.equal(applyResult.rescheduled, 2);

const bBooking = app(`state.bookings.find(b => b.id === 'booking-b-prep')`);
assert.equal(bBooking.start, '2026-06-02T09:00:00.000Z');
assert.equal(bBooking.end, '2026-06-02T10:30:00.000Z');

const cBooking = app(`state.bookings.find(b => b.id === 'booking-c-paint')`);
assert.equal(cBooking.start, '2026-06-02T10:30:00.000Z');
assert.equal(cBooking.end, '2026-06-02T12:00:00.000Z');

const history = app(`state.cases[0].history`);
const rescheduledLogs = history.filter(h => h.type === 'planning.task.rescheduled');
assert.equal(rescheduledLogs.length, 2, 'Historique doit loguer les deux recalages');
const prepLog = rescheduledLogs.find(h => h.details.includes('Préparation'));
assert.ok(prepLog, 'Le log de Préparation doit exister');
assert.ok(prepLog.details.includes('Chef Atelier'), 'acteur doit être logué');
assert.ok(prepLog.details.includes('De ') && prepLog.details.includes(' vers '), 'ancienne et nouvelle heure doivent être loguées');
assert.ok(prepLog.details.includes('dynamic-reschedule-v22.28'), 'source doit être loguée');

// ----------------------------------------------------
// Assertion 3, 4, 5, 6: started, paused, completed, blocked ne sont jamais déplacées
// ----------------------------------------------------
setupPlanningRescheduleState();
// Make C complete, B started, another case booking paused, and another blocked
vm.runInContext(`
  state.bookings.find(b => b.id === 'booking-c-paint').status = 'completed';
  state.bookings.find(b => b.id === 'booking-b-prep').status = 'started';
  state.bookings.push({
    id: 'booking-paused',
    caseId: 'case-reschedule',
    key: 'mechanical',
    resourceIds: ['tech-body'],
    segments: [{ start: '2026-06-02T14:00:00.000Z', end: '2026-06-02T15:00:00.000Z' }],
    start: '2026-06-02T14:00:00.000Z',
    end: '2026-06-02T15:00:00.000Z',
    status: 'paused'
  });
  state.bookings.push({
    id: 'booking-blocked',
    caseId: 'case-reschedule',
    key: 'electrical',
    resourceIds: ['tech-body'],
    segments: [{ start: '2026-06-02T15:00:00.000Z', end: '2026-06-02T16:00:00.000Z' }],
    start: '2026-06-02T15:00:00.000Z',
    end: '2026-06-02T16:00:00.000Z',
    status: 'planned',
    blockReason: 'attente pièces',
    blockedAt: '2026-06-02T08:00:00.000Z'
  });
`, context);

const nonPlannedPreviews = app(`previewDependentBookingReschedule(state.cases[0], state.bookings.find(b => b.id === 'booking-a-body'))`);
assert.equal(nonPlannedPreviews.some(p => ['booking-b-prep', 'booking-c-paint', 'booking-paused', 'booking-blocked'].includes(p.bookingId)), false, 'Started/completed/paused/blocked ne doivent jamais figurer dans le preview');

// ----------------------------------------------------
// Assertion 7: Ressource indisponible bloque ou décale le recalage.
// ----------------------------------------------------
setupPlanningRescheduleState();
// Add another overlapping booking on painter (tech-painter) from 09:00 -> 10:00
vm.runInContext(`
  state.bookings.push({
    id: 'booking-clash',
    caseId: 'case-another',
    key: 'body',
    resourceIds: ['tech-painter'],
    segments: [{ start: '2026-06-02T09:00:00.000Z', end: '2026-06-02T10:00:00.000Z' }],
    start: '2026-06-02T09:00:00.000Z',
    end: '2026-06-02T09:00:00.000Z', // instant segment
    status: 'planned'
  });
  // Mutate segment directly to avoid normalization discard
  state.bookings.find(b => b.id === 'booking-clash').segments = [{ start: '2026-06-02T09:00:00.000Z', end: '2026-06-02T10:00:00.000Z' }];
  state.bookings.find(b => b.id === 'booking-clash').end = '2026-06-02T10:00:00.000Z';
`, context);

app(`startTechnicianTask(state.cases[0], 'booking-a-body', 'tech-body').ok`);
setMockTime('2026-06-02T09:00:00.000Z');
app(`completeTechnicianTask(state.cases[0], 'booking-a-body', 'tech-body', { skipPhotoCheck: true }).ok`);

const clashPreviews = app(`previewDependentBookingReschedule(state.cases[0], state.bookings.find(b => b.id === 'booking-a-body'))`);
// Since painter is busy 09:00 -> 10:00, Step B (which needs tech-painter) should be delayed until 10:00!
// So it starts at 10:00, which is its original start time. Thus, it cannot be advanced!
assert.equal(clashPreviews.some(p => p.bookingId === 'booking-b-prep'), false, 'Step B ne doit pas être avancée si la ressource est occupée');

// ----------------------------------------------------
// Assertion 8: Congé technicien bloque ou décale le recalage.
// ----------------------------------------------------
setupPlanningRescheduleState();
// Add a leave entry for tech-painter from 09:00 -> 10:00
vm.runInContext(`
  state.bookings.push({
    id: 'leave-painter',
    caseId: '__leave__',
    type: 'leave',
    key: 'leave',
    resourceIds: ['tech-painter'],
    segments: [{ start: '2026-06-02T09:00:00.000Z', end: '2026-06-02T10:00:00.000Z' }],
    start: '2026-06-02T09:00:00.000Z',
    end: '2026-06-02T10:00:00.000Z',
    status: 'planned'
  });
`, context);

app(`startTechnicianTask(state.cases[0], 'booking-a-body', 'tech-body').ok`);
setMockTime('2026-06-02T09:00:00.000Z');
app(`completeTechnicianTask(state.cases[0], 'booking-a-body', 'tech-body', { skipPhotoCheck: true }).ok`);

const leavePreviews = app(`previewDependentBookingReschedule(state.cases[0], state.bookings.find(b => b.id === 'booking-a-body'))`);
assert.equal(leavePreviews.some(p => p.bookingId === 'booking-b-prep'), false, 'Step B ne doit pas être avancée pendant un congé du technicien');

// ----------------------------------------------------
// Assertion 9: Pause déjeuner / fermeture atelier respectée.
// ----------------------------------------------------
setupPlanningRescheduleState();
// Set B to start at 11:30 and require 2 hours (120 mins).
// Workshop shift lunch break is 12:00 -> 13:00.
// If B starts at 11:30, it should split and end at 14:30.
const slotLunch = app(`buildWorkingSlot('2026-06-02T11:30:00.000Z', 120)`);
assert.equal(slotLunch.start.toISOString(), '2026-06-02T11:30:00.000Z');
assert.equal(slotLunch.end.toISOString(), '2026-06-02T14:30:00.000Z', 'Le créneau doit intégrer la pause déjeuner de 12:00 à 13:00 (+1h)');

// ----------------------------------------------------
// Assertion 10: Précédence métier respectée.
// ----------------------------------------------------
setupPlanningRescheduleState();
// Check that C (paint) predecessors include B (prep)
const predecessorsOfC = app(`getPreviousRequiredBookings(state.cases[0], state.bookings.find(b => b.id === 'booking-c-paint')).map(b => b.id)`);
assert.ok(predecessorsOfC.includes('booking-b-prep'), 'Peinture doit dépendre de Préparation');

// ----------------------------------------------------
// Assertion 11: Préparation anticipée pièces neuves reste parallèle.
// ----------------------------------------------------
setupPlanningRescheduleState();
// Set B (prep) as an anticipated new part preparation
vm.runInContext(`
  state.bookings.find(b => b.id === 'booking-b-prep').planningMode = 'anticipated-new-part';
`, context);
const predecessorsOfAnticipated = app(`getPreviousRequiredBookings(state.cases[0], state.bookings.find(b => b.id === 'booking-b-prep'))`);
assert.equal(predecessorsOfAnticipated.length, 0, 'La préparation anticipée ne doit dépendre d’aucune étape précédente');

// ----------------------------------------------------
// Assertion 12: Dossier clôturé/facturé/archive non recalé.
// ----------------------------------------------------
setupPlanningRescheduleState();
vm.runInContext(`
  state.cases[0].closedAt = '2026-06-02T08:00:00.000Z';
`, context);
const closedPreviews = app(`previewDependentBookingReschedule(state.cases[0], state.bookings.find(b => b.id === 'booking-a-body'))`);
assert.equal(closedPreviews.length, 0, 'Un dossier clôturé ne doit jamais générer de prévisualisation de recalage');

// ----------------------------------------------------
// Assertion 13: Reliquat pause/reprise v22.27 non cassé.
// ----------------------------------------------------
setupPlanningRescheduleState();
// Pause A (booking-a-body) to create a remainder, and verify that the remainder is a candidate and can be advanced normally.
app(`startTechnicianTask(state.cases[0], 'booking-a-body', 'tech-body').ok`);
setMockTime('2026-06-02T08:30:00.000Z');
const pauseRes = app(`pauseTechnicianTask(state.cases[0], 'booking-a-body', 'tech-body', 'attente pièces')`);
assert.equal(pauseRes.ok, true, 'La pause doit réussir');
assert.equal(app(`state.bookings.length`), 4, 'Un reliquat A a dû être créé');
const remainderA = app(`state.bookings.find(b => b.parentBookingId === 'booking-a-body')`);
assert.equal(remainderA.remainingFromPaused, true);
assert.equal(remainderA.status, 'planned');

console.log('Dynamic Reschedule v22.28 OK');
