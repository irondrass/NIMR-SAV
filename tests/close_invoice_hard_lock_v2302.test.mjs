import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'vm';

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
  'js/supabase-config.js',
  'js/supabase-client.js',
  'js/supabase-sync.js',
  'app.js',
  'js/business-rules-v2187.js',
];

const source = scriptFiles
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n')
  .replace(/initApp\(\);/, '// initApp skipped by hotfix tests')
  .replace(/if \("serviceWorker" in navigator[\s\S]*$/u, '');

const elements = new Map();
function getOrCreateElement(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      id,
      value: '',
      textContent: '',
      innerHTML: '',
      hidden: false,
      dataset: { tab: id },
      style: {},
      children: [],
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        contains(c) { return this.classes.has(c); }
      },
      setAttribute() {},
      removeAttribute() {},
      addEventListener() {},
      append(...el) { this.children.push(...el); },
      appendChild(el) { this.children.push(el); return el; },
      querySelector(sel) { return null; },
      querySelectorAll(sel) { return []; },
      closest(sel) { return null; },
    });
  }
  return elements.get(id);
}

const context = {
  console,
  localStorage: {
    storage: new Map(),
    getItem(key) { return this.storage.get(key) || null; },
    setItem(key, val) { this.storage.set(key, String(val)); },
    removeItem(key) { this.storage.delete(key); }
  },
  sessionStorage: {
    getItem() { return null; },
    setItem() {},
    removeItem() {}
  },
  document: {
    getElementById(id) { return getOrCreateElement(id); },
    querySelector(sel) { return getOrCreateElement(sel); },
    querySelectorAll(sel) { return []; },
    createElement(tag) { return getOrCreateElement('created-' + tag); },
    body: getOrCreateElement('body'),
  },
  window: {
    addEventListener() {},
    location: { reload() {} },
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

// Test harness variables
function setupValidCaseState(role = 'admin') {
  app(`
    state = normalizeState({
      users: [
        { id: 'u-admin', name: 'Admin SAV', role: 'admin', active: true },
        { id: 'u-chef', name: 'Chef atelier', role: 'chef_atelier', active: true },
        { id: 'u-reception', name: 'Réception', role: 'reception', active: true },
        { id: 'u-tech', name: 'Technicien', role: 'technicien', resourceId: 'tech-1', active: true },
        { id: 'u-qualite', name: 'Contrôle qualité', role: 'qualite', active: true },
        { id: 'u-readonly', name: 'Lecture seule', role: 'readonly', active: true }
      ],
      currentUserId: 'u-${role}',
      resources: [
        { id: 'tech-1', name: 'Technicien 1', role: 'peintre', active: true }
      ],
      cases: [{
        id: 'case-test',
        clientName: 'Client Hard Lock',
        vehicle: 'Peugeot 208',
        plate: '111 TU 222',
        flags: {
          expertApproved: true,
          clientApproved: true,
          received: true,
          workStarted: true,
          workCompleted: true,
          qualityApproved: true,
          delivered: true,
          invoiced: false
        },
        appointment: { start: '2026-06-03T08:00:00.000Z', delivery: '2026-06-03T18:00:00.000Z', end: '2026-06-03T09:00:00.000Z' },
        qualityChecklist: Object.fromEntries(DEFAULT_QUALITY_CHECKS.map(l => [l, true])),
        durations: { mechanical: 1, quality: 0.25 },
        claims: [{ type: 'client', includeInPlanning: true, clientApproved: true, expertApproved: true, estimate: { lines: [{ phase: 'mechanical', operation: 'MO', laborHours: 1 }] } }],
        history: []
      }],
      bookings: [{ id: 'b-test-1', caseId: 'case-test', resourceIds: ['tech-1'], segments: [{ start: '2026-06-03T08:00:00.000Z', end: '2026-06-03T09:00:00.000Z' }], status: 'completed' }]
    });
  `);
}

console.log('Starting v23.0.2 Close Invoice Hard Lock Tests...');

// 1. Refus facturation si qualité non validée
console.log('Test 1: Quality Validation Gate...');
setupValidCaseState('admin');
app(`state.cases[0].flags.qualityApproved = false;`);
let res = app(`applyWorkflowAction(state.cases[0], 'invoiced')`);
assert.equal(res.ok, false, 'Doit retourner ok: false');
assert.match(res.message, /qualité/i, 'Doit mentionner le contrôle qualité');
assert.equal(app(`state.cases[0].flags.invoiced`), false, 'Dossier ne doit pas être facturé');
assert.equal(app(`state.cases[0].history.some(h => h.type === 'case.invoiced')`), false, 'Aucun historique ne doit être écrit');

// 2. Refus facturation si livraison non confirmée
console.log('Test 2: Delivery Gate...');
setupValidCaseState('admin');
app(`state.cases[0].flags.delivered = false;`);
res = app(`applyWorkflowAction(state.cases[0], 'invoiced')`);
assert.equal(res.ok, false);
assert.match(res.message, /livre/i);
assert.equal(app(`state.cases[0].flags.invoiced`), false);

// 3. Refus facturation si validation client/interne manquante
console.log('Test 3: Client Validation Gate...');
setupValidCaseState('admin');
app(`state.cases[0].claims[0].clientApproved = false;`);
res = app(`applyWorkflowAction(state.cases[0], 'invoiced')`);
assert.equal(res.ok, false);
assert.match(res.message, /client/i);
assert.equal(app(`state.cases[0].flags.invoiced`), false);

// 4. Refus facturation si dossier assurance sans validation expert
console.log('Test 4: Expert Approval Gate for Insurance Claims...');
setupValidCaseState('admin');
app(`
  state.cases[0].claims[0].type = 'assurance';
  state.cases[0].claims[0].expertApproved = false;
`);
res = app(`applyWorkflowAction(state.cases[0], 'invoiced')`);
assert.equal(res.ok, false);
assert.match(res.message, /expert/i);
assert.equal(app(`state.cases[0].flags.invoiced`), false);

// 5. Refus facturation si blocage actif
console.log('Test 5: Active Blocker Gate...');
setupValidCaseState('admin');
app(`state.cases[0].blockerReason = 'waiting_parts';`);
res = app(`applyWorkflowAction(state.cases[0], 'invoiced')`);
assert.equal(res.ok, false);
assert.match(res.message, /blocage/i);
assert.equal(app(`state.cases[0].flags.invoiced`), false);

// 6. Refus facturation si tâche technicien incomplète
console.log('Test 6: Incomplete Task Gate...');
setupValidCaseState('admin');
app(`state.bookings[0].status = 'started';`);
res = app(`applyWorkflowAction(state.cases[0], 'invoiced')`);
assert.equal(res.ok, false);
assert.match(res.message, /tâches/i);
assert.equal(app(`state.cases[0].flags.invoiced`), false);

// 7. Refus facturation si reliquat pause planifié non terminé
console.log('Test 7: Paused Remainder Booking Gate...');
setupValidCaseState('admin');
app(`
  // Booking parent complété
  state.bookings[0].status = 'completed';
  // Ajout d'un reliquat planifié (planned) non terminé partagé par businessTaskId
  state.bookings.push({
    id: 'b-remainder',
    caseId: 'case-test',
    resourceIds: ['tech-1'],
    segments: [{ start: '2026-06-03T10:00:00.000Z', end: '2026-06-03T11:00:00.000Z' }],
    status: 'planned',
    parentBookingId: 'b-test-1',
    businessTaskId: 'b-test-1'
  });
`);
res = app(`applyWorkflowAction(state.cases[0], 'invoiced')`);
assert.equal(res.ok, false);
assert.match(res.message, /tâches/i);
assert.equal(app(`state.cases[0].flags.invoiced`), false);

// 8. Refus facturation pour rôle reception
console.log('Test 8: Reception Role Block...');
setupValidCaseState('reception');
res = app(`applyWorkflowAction(state.cases[0], 'invoiced')`);
assert.equal(res.ok, false);
assert.match(res.message, /chef atelier\/admin/i);
assert.equal(app(`state.cases[0].flags.invoiced`), false);

// 9. Acceptation facturation pour admin si toutes conditions OK
console.log('Test 9: Admin Role Success...');
setupValidCaseState('admin');
res = app(`applyWorkflowAction(state.cases[0], 'invoiced')`);
assert.equal(res.ok, true, 'Admin doit pouvoir clôturer si OK');
assert.equal(app(`state.cases[0].flags.invoiced`), true);
assert.equal(app(`state.cases[0].history[0].type`), 'case.invoiced');
assert.equal(app(`state.cases[0].history[0].userId`), 'u-admin');
assert.equal(app(`state.cases[0].history[0].userRole`), 'admin');

// 10. Acceptation facturation pour chef_atelier si toutes conditions OK
console.log('Test 10: Chef Atelier Role Success...');
setupValidCaseState('chef');
res = app(`applyWorkflowAction(state.cases[0], 'invoiced')`);
assert.equal(res.ok, true, 'Chef atelier doit pouvoir clôturer si OK');
assert.equal(app(`state.cases[0].flags.invoiced`), true);
assert.equal(app(`state.cases[0].history[0].userId`), 'u-chef');
assert.equal(app(`state.cases[0].history[0].userRole`), 'chef_atelier');

// 11. Non-régression matrice d'accès v23.0.1 (réception peut toujours livrer)
console.log('Test 11: Non-regression reception delivery.complete...');
setupValidCaseState('reception');
// Le rôle réception a la permission 'delivery.complete'
assert.equal(app(`guardDeliveryComplete(state.cases[0]).ok`), true, 'Réception doit pouvoir livrer');

console.log('ALL CLOSE INVOICE HARD LOCK TESTS PASSED!');
