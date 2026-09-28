import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../js/ui-planning.js', import.meta.url), 'utf8');
const start = '2024-06-10T08:00:00Z';
const end = '2024-06-10T12:00:00Z';
const booking = { id: 'booking-abc', caseId: 'case-001', key: 'body', type: 'work', resourceIds: ['res-01'], start, end, segments: [{ start, end }] };
const other = { ...booking, id: 'booking-other', caseId: 'case-other', resourceIds: ['res-02'] };
const state = {
  bookings: [booking, other],
  cases: [
    { id: 'case-001', orNumber: 'OR-2024-001', vehicle: 'Renault Clio', plate: 'AB-123-CD', clientName: 'Dupont Jean' },
    { id: 'case-other', orNumber: 'OR-OTHER', vehicle: 'Peugeot', plate: 'ZZ-999-ZZ' },
  ],
  resources: [{ id: 'res-01', name: 'Martin Pierre', role: 'tolier' }, { id: 'res-02', name: 'Autre technicien', role: 'tolier' }],
};

function element(id) {
  const handlers = new Map();
  return {
    id, hidden: id === 'booking-side-panel' || id === 'bsp-open-or', innerHTML: '', textContent: '', dataset: {}, attrs: {},
    addEventListener(type, fn) { handlers.set(type, fn); },
    dispatch(type, event = {}) { handlers.get(type)?.({ preventDefault() {}, stopPropagation() {}, ...event }); },
    click() { this.dispatch('click'); },
    focus() { this.focused = true; },
    setAttribute(name, value) { this.attrs[name] = value; },
  };
}

function harness() {
  const ids = ['booking-side-panel', 'bsp-body', 'bsp-title', 'bsp-open-or', 'bsp-close-top', 'bsp-close', 'gantt', 'mobile-planning-list'];
  const elements = Object.fromEntries(ids.map(id => [id, element(id)]));
  const nav = element('nav-dossiers');
  let navigations = 0;
  nav.addEventListener('click', () => { navigations++; });
  const document = {
    handlers: new Map(),
    getElementById(id) { return elements[id] || null; },
    querySelector(selector) { return selector === '[data-tab="dossiers"]' ? nav : null; },
    addEventListener(type, fn) { this.handlers.set(type, fn); },
    dispatch(type, event) { this.handlers.get(type)?.({ preventDefault() {}, ...event }); },
  };
  const context = vm.createContext({
    document, state, activeCaseId: null,
    getDurationLabel: () => 'Tôlerie',
    getBookingOperationalStatus: () => 'planned',
    getBookingStatusLabel: () => 'Planifié',
    isCaseOperationallyClosed: () => false,
    isBookingVisibleForResource: (b, id) => b.resourceIds.includes(id),
    isEquipmentResource: () => false,
    shortVehicleModel: value => value,
    escapeHtml: value => String(value),
    escapeAttr: value => String(value),
    formatTime: date => new Date(date).toISOString().slice(11, 16),
    formatDateTime: value => new Date(value).toISOString().slice(0, 16).replace('T', ' '),
    todayKey: date => new Date(date).toISOString().slice(0, 10),
    getDayIntervals: () => [{ start: new Date(start), end: new Date(end) }],
    maxDate: (a, b) => new Date(Math.max(a, b)),
    minDate: (a, b) => new Date(Math.min(a, b)),
    diffMinutes: (a, b) => (b - a) / 60000,
    getBookingPlanningColor: () => '#123456',
    ROLE_LABELS: { tolier: 'Tôlier' },
    $: selector => elements[selector.slice(1)] || null,
  });
  vm.runInContext(source, context, { filename: 'js/ui-planning.js' });
  return { context, document, elements, get navigations() { return navigations; }, run: code => vm.runInContext(code, context) };
}

test('Gantt et carte mobile exposent l’identifiant du booking réel', () => {
  const h = harness();
  const gantt = h.run("renderResourceBookings(state.resources[0], new Date('2024-06-10T00:00:00Z'), new Date('2024-06-10T08:00:00Z'), new Date('2024-06-10T12:00:00Z'), 240)");
  assert.match(gantt, /data-booking-id="booking-abc"/);
  assert.match(gantt, /data-case-id="case-001"/);
  h.run("renderMobilePlanningList(new Date('2024-06-10T00:00:00Z'), [state.resources[0]], null)");
  assert.match(h.elements['mobile-planning-list'].innerHTML, /data-booking-id="booking-abc"/);
  assert.match(h.elements['mobile-planning-list'].innerHTML, /data-case-id="case-001"/);
});

test('ouverture sélectionne le bon booking et affiche ses détails sans mutation', () => {
  const h = harness();
  const beforeBookings = JSON.stringify(state.bookings);
  const beforeCases = JSON.stringify(state.cases);
  h.run("openBookingSidePanel('booking-abc')");
  const panel = h.elements['booking-side-panel'];
  const body = h.elements['bsp-body'].innerHTML;
  assert.equal(panel.hidden, false);
  assert.equal(panel.attrs['aria-hidden'], 'false');
  for (const value of ['OR-2024-001', 'Renault Clio', 'AB-123-CD', 'Martin Pierre', '2024-06-10 08:00', '2024-06-10 12:00', '4h', 'Planifié']) {
    assert.ok(body.includes(value), `Détail absent : ${value}`);
  }
  assert.equal(h.elements['bsp-open-or'].dataset.caseId, 'case-001');
  assert.ok(!body.includes('OR-OTHER'));
  assert.equal(JSON.stringify(state.bookings), beforeBookings);
  assert.equal(JSON.stringify(state.cases), beforeCases);
});

test('fermeture par bouton et Escape', () => {
  const h = harness();
  h.run("openBookingSidePanel('booking-abc')");
  h.elements['bsp-close'].click();
  assert.equal(h.elements['booking-side-panel'].hidden, true);
  h.run("openBookingSidePanel('booking-abc')");
  h.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(h.elements['booking-side-panel'].hidden, true);
  assert.equal(h.elements['booking-side-panel'].attrs['aria-hidden'], 'true');
});

test('clic, Enter et Espace ouvrent le booking depuis Gantt ou mobile', () => {
  const h = harness();
  const target = { dataset: { bookingId: 'booking-abc' }, closest: () => target };
  h.elements.gantt.dispatch('click', { target });
  assert.equal(h.elements['booking-side-panel'].hidden, false);
  h.run('closeBookingSidePanel()');
  h.elements.gantt.dispatch('keydown', { key: 'Enter', target });
  assert.equal(h.elements['booking-side-panel'].hidden, false);
  h.run('closeBookingSidePanel()');
  h.elements['mobile-planning-list'].dispatch('keydown', { key: ' ', target });
  assert.equal(h.elements['booking-side-panel'].hidden, false);
});

test('Ouvrir OR positionne activeCaseId et déclenche la navigation dossiers', () => {
  const h = harness();
  const beforeBookings = JSON.stringify(state.bookings);
  const beforeCases = JSON.stringify(state.cases);
  h.run("openBookingSidePanel('booking-abc')");
  h.elements['bsp-open-or'].click();
  assert.equal(h.context.activeCaseId, 'case-001');
  assert.equal(h.navigations, 1);
  assert.equal(h.elements['booking-side-panel'].hidden, true);
  assert.equal(JSON.stringify(state.bookings), beforeBookings);
  assert.equal(JSON.stringify(state.cases), beforeCases);
});
