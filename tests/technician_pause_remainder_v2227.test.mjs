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
  .replace(/initApp\(\);/, '// initApp skipped by technician pause/remainder tests')
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

function setupPauseState() {
  const now = new Date();
  const start = new Date(now.getTime() - 30 * 60000).toISOString();
  const end = new Date(now.getTime() + 90 * 60000).toISOString();
  vm.runInContext(`
    state = normalizeState({
      users: [{ id: 'user-tech', name: 'Technicien 1', role: 'technicien', resourceId: 'tech-1', active: true }],
      currentUserId: 'user-tech',
      resources: [
        { id: 'tech-1', name: 'Technicien 1', role: 'mecanicien', active: true },
        { id: 'pont-1', name: 'Pont 1', role: 'pont_mecanique', active: true }
      ],
      cases: [{
        id: 'case-pause',
        clientName: 'Client Pause',
        vehicle: 'Peugeot 208',
        plate: '123 TU 456',
        flags: { received: true },
        appointment: { start: '${start}', end: '${end}', delivery: '${end}', marginMinutes: 15 },
        durations: { mechanical: 2 },
        claims: [{ type: 'client', includeInPlanning: true, expertApproved: true, clientApproved: true, estimate: { lines: [{ phase: 'mechanical', operation: 'MO', laborHours: 2 }] } }]
      }],
      bookings: [{
        id: 'booking-main',
        caseId: 'case-pause',
        key: 'mechanical',
        title: 'Réparation mécanique',
        resourceIds: ['tech-1', 'pont-1'],
        primaryResourceId: 'tech-1',
        segments: [{ start: '${start}', end: '${end}' }],
        start: '${start}',
        end: '${end}',
        plannedStart: '${start}',
        plannedEnd: '${end}',
        plannedMinutes: 120,
        status: 'planned'
      }]
    });
  `, context);
}

setupPauseState();
assert.equal(app(`startTechnicianTask(state.cases[0], 'booking-main', 'tech-1').ok`), true, 'la tâche doit démarrer');
const pauseResult = app(`pauseTechnicianTask(state.cases[0], 'booking-main', 'tech-1', 'attente pièces')`);
assert.equal(pauseResult.ok, true, 'la tâche démarrée doit pouvoir être mise en pause');
assert.equal(app(`state.bookings.length`), 2, 'la pause doit conserver un reliquat technique dans le planning');
assert.equal(app(`state.bookings.find((booking) => booking.parentBookingId === 'booking-main').remainingFromPaused`), true, 'le reliquat technique garde son origine pause');
assert.equal(app(`state.bookings.find((booking) => booking.id === 'booking-main').businessTaskId`), 'booking-main', 'le parent porte le businessTaskId');
assert.equal(app(`state.bookings.find((booking) => booking.parentBookingId === 'booking-main').businessTaskId`), 'booking-main', 'le reliquat partage le businessTaskId');
assert.equal(app(`state.bookings.find((booking) => booking.id === 'booking-main').supersededBy === state.bookings.find((booking) => booking.parentBookingId === 'booking-main').id`), true, 'le parent pointe vers le reliquat actif');

let rows = app(`getTechnicianTaskRows('tech-1', todayKey(new Date()))`);
assert.equal(rows.length, 1, 'Mes tâches doit afficher une seule carte après pause');
assert.equal(rows[0].status, 'paused', 'la carte unique doit être en pause');
assert.equal(rows[0].booking.id, 'booking-main', 'l’affichage reste sur la tâche métier parent');
assert.equal(rows[0].actionBookingId, app(`state.bookings.find((booking) => booking.parentBookingId === 'booking-main').id`), 'l’action Reprendre cible le reliquat technique');
assert.equal(rows[0].pauseRemainder, true, 'la carte signale discrètement une reprise planifiée');

assert.equal(app(`getTechnicianTaskRows('', todayKey(new Date())).length`), 1, 'le suivi chef atelier ne doit pas compter deux tâches identiques');
assert.equal(app(`getPrintableTechnicianBusinessAssignments(state.bookings.filter((booking) => booking.caseId === 'case-pause')).length`), 1, 'les ordres techniciens opérationnels agrègent parent et reliquat');

const remainderId = rows[0].actionBookingId;
assert.equal(app(`resumeTechnicianTask(state.cases[0], '${remainderId}', 'tech-1').ok`), true, 'le reliquat doit pouvoir être repris depuis la carte unique');
rows = app(`getTechnicianTaskRows('tech-1', todayKey(new Date()))`);
assert.equal(rows.length, 1, 'Mes tâches doit rester à une seule carte après reprise');
assert.equal(rows[0].status, 'in_progress', 'la carte unique doit repasser en cours');
assert.equal(rows.filter((row) => row.status === 'paused').length, 0, 'l’ancienne tâche pause ne doit pas rester visible comme deuxième carte');
assert.equal(app(`state.cases[0].history.some((entry) => entry.type === 'planning.task.paused')`), true, 'l’historique conserve la pause');
assert.equal(app(`state.cases[0].history.some((entry) => entry.type === 'planning.task.resumed')`), true, 'l’historique conserve la reprise');
assert.ok(app(`state.bookings.find((booking) => booking.id === 'booking-main').actualWorkedMinutes`) > 0, 'le temps travaillé est conservé');
assert.ok(app(`state.bookings.find((booking) => booking.parentBookingId === 'booking-main').plannedMinutes`) > 0, 'le temps restant est conservé dans le reliquat');

assert.equal(app(`completeTechnicianTask(state.cases[0], '${remainderId}', 'tech-1', { skipPhotoCheck: true }).ok`), true, 'la tâche reprise doit pouvoir être terminée');
assert.equal(app(`state.bookings.every((booking) => booking.caseId !== 'case-pause' || booking.status === 'completed')`), true, 'terminer le reliquat termine toute la tâche métier');
assert.equal(app(`state.cases[0].flags.workCompleted`), true, 'le dossier ne passe en travaux terminés que lorsque la famille technique est finie');
rows = app(`getTechnicianTaskRows('tech-1', todayKey(new Date()))`);
assert.equal(rows.filter((row) => row.status !== 'done').length, 0, 'aucune carte active ne reste après completion');

const legacyState = app(`normalizeState({
  resources: [{ id: 'tech-legacy', name: 'Ancien tech', role: 'mecanicien', active: true }],
  cases: [{ id: 'case-legacy', clientName: 'Ancien dossier', flags: { received: true } }],
  bookings: [
    { id: 'legacy-parent', caseId: 'case-legacy', key: 'mechanical', status: 'paused', resourceIds: ['tech-legacy'], segments: [{ start: '2026-06-01T08:00:00.000Z', end: '2026-06-01T09:00:00.000Z' }] },
    { id: 'legacy-remainder', caseId: 'case-legacy', key: 'mechanical', status: 'planned', parentBookingId: 'legacy-parent', remainingFromPaused: true, resourceIds: ['tech-legacy'], segments: [{ start: '2026-06-01T09:00:00.000Z', end: '2026-06-01T10:00:00.000Z' }] }
  ]
})`);
assert.equal(legacyState.bookings[0].businessTaskId, 'legacy-parent', 'ancien parent sans businessTaskId reste compatible');
assert.equal(legacyState.bookings[1].businessTaskId, 'legacy-parent', 'ancien reliquat sans businessTaskId est rattaché au parent');

// Test 3: Production Overdue Task Pause (Dossier OR-SRV-CH2602498, SOFIENE, 09:00 -> 09:24, pause at 09:25)
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

function clearMockTime() {
  vm.runInContext(`mockTime = null;`, context);
}

// 1. Setup production state
setMockTime('2026-06-02T09:00:00.000Z');
vm.runInContext(`
  state = normalizeState({
    users: [{ id: 'SOFIENE', name: 'SOFIENE', role: 'technicien', resourceId: 'tech-sofiene', active: true }],
    currentUserId: 'SOFIENE',
    resources: [
      { id: 'tech-sofiene', name: 'SOFIENE', role: 'mecanicien', active: true }
    ],
    cases: [{
      id: 'OR-SRV-CH2602498',
      clientName: 'Client Production',
      vehicle: 'Peugeot Partner',
      plate: '2498 TN 123',
      flags: { received: true },
      appointment: { start: '2026-06-02T09:00:00.000Z', end: '2026-06-02T09:24:00.000Z', delivery: '2026-06-02T09:39:00.000Z', marginMinutes: 15 },
      durations: { oilService: 0.4 },
      claims: [{ type: 'client', includeInPlanning: true, expertApproved: true, clientApproved: true, estimate: { lines: [{ phase: 'oilService', operation: 'Vidange / entretien rapide', laborHours: 0.4 }] } }]
    }],
    bookings: [{
      id: 'booking-production',
      caseId: 'OR-SRV-CH2602498',
      key: 'oilService',
      title: 'Vidange / entretien rapide',
      resourceIds: ['tech-sofiene'],
      primaryResourceId: 'tech-sofiene',
      segments: [{ start: '2026-06-02T09:00:00.000Z', end: '2026-06-02T09:24:00.000Z' }],
      start: '2026-06-02T09:00:00.000Z',
      end: '2026-06-02T09:24:00.000Z',
      plannedStart: '2026-06-02T09:00:00.000Z',
      plannedEnd: '2026-06-02T09:24:00.000Z',
      plannedMinutes: 24,
      status: 'planned'
    }]
  });
`, context);

// 2. démarrer la tâche à 09:00
assert.equal(app(`startTechnicianTask(state.cases[0], 'booking-production', 'tech-sofiene').ok`), true, 'la tâche prod doit démarrer');

// 3. simuler le temps qui passe : pause cliquée à 09:25 (overdue)
setMockTime('2026-06-02T09:25:00.000Z');
const prodPauseResult = app(`pauseTechnicianTask(state.cases[0], 'booking-production', 'tech-sofiene', 'Pause café')`);
assert.equal(prodPauseResult.ok, true, 'la pause overdue doit réussir');

// 4. Vérifier que l’ancien segment est bien en pause et pas complété
const parentBooking = app(`state.bookings.find((b) => b.id === 'booking-production')`);
assert.equal(parentBooking.status, 'paused', 'le parent doit être marqué paused');
assert.ok(!parentBooking.completedAt, 'le parent ne doit pas avoir de completedAt');
assert.equal(app(`state.bookings.length`), 2, 'un reliquat a dû être créé');

// 5. Vérifier que getTechnicianTaskRows() retourne une seule carte unique, statut "paused"
let prodRows = app("getTechnicianTaskRows('tech-sofiene', todayKey(new Date('2026-06-02T09:00:00.000Z')))");
assert.equal(prodRows.length, 1, 'Mes tâches doit afficher une seule carte pour la famille prod');
assert.equal(prodRows[0].status, 'paused', 'la carte prod unique doit être en pause');
assert.equal(prodRows[0].booking.id, 'booking-production', 'la carte prod montre toujours la tâche métier principale');

// 6. reprendre la tâche (à 09:30 par exemple)
setMockTime('2026-06-02T09:30:00.000Z');
const prodRemainderId = prodRows[0].actionBookingId;
assert.equal(app(`resumeTechnicianTask(state.cases[0], '${prodRemainderId}', 'tech-sofiene').ok`), true, 'la reprise du reliquat prod doit réussir');

// 7. vérifier que la carte unique est repassée en "in_progress"
prodRows = app("getTechnicianTaskRows('tech-sofiene', todayKey(new Date('2026-06-02T09:00:00.000Z')))");
assert.equal(prodRows.length, 1, 'une seule carte prod après reprise');
assert.equal(prodRows[0].status, 'in_progress', 'le statut prod est repassé en cours');

// 8. terminer la tâche réelle (à 09:40)
setMockTime('2026-06-02T09:40:00.000Z');
assert.equal(app(`completeTechnicianTask(state.cases[0], '${prodRemainderId}', 'tech-sofiene', { skipPhotoCheck: true }).ok`), true, 'la complétion réelle doit réussir');

// 9. vérifier que tout est maintenant bien terminé
const allProdCompleted = app(`state.bookings.every((b) => b.caseId !== 'OR-SRV-CH2602498' || b.status === 'completed')`);
assert.equal(allProdCompleted, true, 'tous les segments prod doivent être completed');
assert.equal(app(`state.cases[0].flags.workCompleted`), true, 'le dossier prod doit avoir workCompleted à true');

prodRows = app("getTechnicianTaskRows('tech-sofiene', todayKey(new Date('2026-06-02T09:00:00.000Z')))");
assert.equal(prodRows.filter((r) => r.status !== 'done').length, 0, 'aucune carte active prod ne reste');

// Rétablir Date d'origine
clearMockTime();
vm.runInContext(`Date = OriginalDate;`, context);

console.log('Technician pause/remainder v22.27 OK');
