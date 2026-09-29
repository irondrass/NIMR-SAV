import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createNimrVmContext } from './helpers/nimr_vm_context.mjs';

function fixture() {
  const h = createNimrVmContext();
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) {
      const handlers = new Map();
      elements.set(id, { value: '', innerHTML: '', hidden: false, dataset: {}, attrs: {},
        setAttribute(k, v) { this.attrs[k] = v; }, focus() {},
        addEventListener(k, fn) { handlers.set(k, fn); },
        fire(k, e = {}) { handlers.get(k)?.({ preventDefault() {}, stopPropagation() {}, ...e }); }
      });
    }
    return elements.get(id);
  };
  h.context.document.querySelector = selector => el(selector.slice(1));
  h.context.document.getElementById = el;
  h.run(`
    state = normalizeState({
      planningDate: '2026-09-09',
      workHours: {0: [], 1: [['07:45','12:00'],['13:00','16:45']], 2: [['09:00','15:00']],
        3: [['08:00','16:00']], 4: [['08:00','16:00']], 5: [['08:00','16:00']], 6: []},
      holidays: [{date:'2026-09-10', label:'Fête test'}],
      resources: [{id:'r1', name:'Technicien A', role:'tolier', active:true},
        {id:'r2', name:'Technicien B', role:'tolier', active:true}],
      cases: [normalizeCase({id:'c1', clientName:'Alice', plate:'AAA', vehicle:'Clio'}),
        normalizeCase({id:'c2', clientName:'Bob', plate:'BBB', vehicle:'Polo'})],
      bookings: [
        {id:'b1',caseId:'c1',key:'body',type:'work',resourceIds:['r1'],status:'planned',
          segments:[{start:'2026-09-07T10:00:00',end:'2026-09-09T11:00:00'}]},
        {id:'b2',caseId:'c2',key:'body',type:'work',resourceIds:['r2'],status:'planned',
          segments:[{start:'2026-09-07T09:00:00',end:'2026-09-07T10:00:00'},
            {start:'2026-09-11T09:00:00',end:'2026-09-11T10:00:00'}]}
      ]
    });
    state.cases.forEach(item => delete item.planningColor);
    invalidateUiRuntimeIndexes();
    saveState = () => {};
    renderMetrics = () => {};
    bindPlanningToolbar();
    initBookingSidePanel();
  `);
  return { ...h, el, week() { el('planning-view-week').fire('click'); },
    html(id = 'gantt') { return el(id).innerHTML; } };
}

function sections(html) {
  return [...html.matchAll(/<section[^>]*data-planning-day="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)]
    .map(([, day, body]) => ({ day, body }));
}

test('native accessible switch defaults to Jour and updates pressed state without persistence', () => {
  const markup = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const [id, label, pressed] of [['day', 'Jour', 'true'], ['week', 'Semaine', 'false']]) {
    assert.match(markup, new RegExp(`<button[^>]*type="button"[^>]*id="planning-view-${id}"[^>]*aria-pressed="${pressed}"[^>]*>${label}</button>`));
  }
  const h = fixture();
  h.run('renderPlanning()');
  assert.equal(h.el('planning-view-day').attrs['aria-pressed'], 'true');
  assert.equal(sections(h.html()).length, 0);
  h.week();
  assert.equal(h.el('planning-view-week').attrs['aria-pressed'], 'true');
  assert.equal(h.run("'planningView' in state || 'planningView' in state.ui"), false);
  h.el('planning-view-day').fire('click');
  assert.equal(sections(h.html()).length, 0);
  assert.equal(h.el('planning-print-details').hidden, false);
});

test('containing week starts Monday, including Sunday anchors and year boundary', () => {
  const h = fixture();
  for (const [anchor, first, last] of [['2026-09-09','2026-09-07','2026-09-13'],
    ['2026-09-13','2026-09-07','2026-09-13'], ['2027-01-01','2026-12-28','2027-01-03']]) {
    h.run(`state.planningDate = '${anchor}'`);
    h.week();
    assert.equal(h.run('todayKey(getPlanningWeekDates(parseDateKey(state.planningDate))[0])'), first);
    assert.equal(h.run('todayKey(getPlanningWeekDates(parseDateKey(state.planningDate))[6])'), last);
    assert.ok(h.el('planning-day-label').textContent.includes(h.run(`longDate(parseDateKey('${first}'))`)));
    assert.ok(h.el('planning-day-label').textContent.includes(h.run(`longDate(parseDateKey('${last}'))`)));
    assert.equal(h.run('state.planningDate'), anchor);
  }
});

test('toolbar navigation steps one day or seven days; picker anchors containing week', () => {
  const h = fixture();
  h.el('next-day').fire('click');
  assert.equal(h.run('state.planningDate'), '2026-09-10');
  h.el('prev-day').fire('click');
  assert.equal(h.run('state.planningDate'), '2026-09-09');
  h.week();
  h.el('next-day').fire('click');
  assert.equal(h.run('state.planningDate'), '2026-09-16');
  h.el('prev-day').fire('click');
  assert.equal(h.run('state.planningDate'), '2026-09-09');
  h.el('planning-date').value = '2026-09-20';
  h.el('planning-date').fire('change');
  assert.equal(h.run('state.planningDate'), '2026-09-20');
  assert.equal(sections(h.html())[0].day, '2026-09-14');
  h.el('today-button').fire('click');
  assert.equal(h.run('state.planningDate'), h.run('todayKey(new Date())'));
});

test('closed Sunday omitted, holiday explicit with no fabricated ticks; configured hours used', () => {
  const h = fixture(); h.week();
  const days = sections(h.html());
  assert.deepEqual(days.map(x => x.day), ['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11']);
  assert.match(days[0].body, /07:45/);
  assert.match(days[1].body, /09:00/);
  assert.doesNotMatch(days[1].body, />08:00</);
  assert.match(days[3].body, /Jour férié: Fête test/);
  assert.doesNotMatch(days[3].body, /gantt-grid|class="tick"|08:00|17:00/);
  h.run("state.workHours[0] = [['10:00','13:00']]; renderPlanning()");
  const sunday = sections(h.html()).at(-1);
  assert.equal(sunday.day, '2026-09-13');
  assert.match(sunday.body, /10:00/);
  assert.match(sunday.body, /13:00/);
});

test('segments appear only on intersecting days, clipped also on interior days', () => {
  const h = fixture(); h.week();
  for (const id of ['gantt','mobile-planning-list']) {
    const days = sections(h.html(id));
    assert.deepEqual(days.filter(x => x.body.includes('data-booking-id="b1"')).map(x => x.day),
      ['2026-09-07','2026-09-08','2026-09-09']);
    assert.deepEqual(days.filter(x => x.body.includes('data-booking-id="b2"')).map(x => x.day),
      ['2026-09-07','2026-09-11']);
    assert.match(days[1].body, /09:00/);
    assert.match(days[1].body, /15:00/);
    assert.match(days[2].body, /11:00/);
  }
});

test('search and resource filters apply uniformly to Gantt and mobile week', () => {
  const h = fixture(); h.week();
  for (const [selector, value, visible, absent] of [['planning-search','Alice','b1','b2'],
    ['planning-resource-filter','r2','b2','b1']]) {
    h.el('planning-search').value = '';
    h.el('planning-resource-filter').value = 'all';
    h.el(selector).value = value;
    h.run('renderPlanning()');
    for (const id of ['gantt','mobile-planning-list']) {
      assert.ok(h.html(id).includes(`data-booking-id="${visible}"`));
      assert.ok(!h.html(id).includes(`data-booking-id="${absent}"`));
    }
  }
});

test('week mobile groups cards with real identifiers; delegated click, Enter and Space resolve panel', () => {
  const h = fixture(); h.week();
  assert.equal(sections(h.html('mobile-planning-list')).length, 5);
  assert.match(h.html('mobile-planning-list'), /class="mobile-planning-card[^]*data-booking-id="b1" data-case-id="c1"/);
  for (const id of ['gantt','mobile-planning-list']) {
    for (const key of [null, 'Enter', ' ']) {
      h.run('closeBookingSidePanel()');
      const target = { dataset: { bookingId: 'b1', caseId: 'c1' }, closest() { return this; } };
      h.el(id).fire(key ? 'keydown' : 'click', { target, key });
      assert.equal(h.el('booking-side-panel').hidden, false);
      assert.equal(h.el('bsp-open-or').dataset.caseId, 'c1');
    }
  }
});

test('week rendering does not mutate state, including cases without planningColor; no weekly labor/print', () => {
  const h = fixture();
  const before = h.run('JSON.stringify(state)');
  h.week(); h.run('renderPlanning()');
  assert.equal(h.run('JSON.stringify(state)'), before);
  assert.match(h.html('daily-labor-summary'), /Détail main-d’œuvre disponible en vue Jour/);
  assert.equal(h.el('planning-print-details').hidden, true);
});

test('empty calendar has no fallback hours and a Sunday holiday remains visible', () => {
  const h = fixture();
  h.run("state.workHours = {}; state.holidays = []");
  h.week();
  for (const id of ['gantt', 'mobile-planning-list']) {
    assert.match(h.html(id), /Aucun jour travaillé/);
    assert.doesNotMatch(h.html(id), /08:00|17:00|gantt-grid|mobile-planning-card/);
  }
  h.run("state.holidays = [{date:'2026-09-13',label:'Dimanche férié'}]; renderPlanning()");
  assert.deepEqual(sections(h.html()).map(x => x.day), ['2026-09-13']);
  assert.match(h.html(), /Jour férié: Dimanche férié/);
});

test('midnight endpoint and actual completion do not create next-day cards', () => {
  const h = fixture();
  h.run(`state.bookings = [{...state.bookings[0],
    segments:[{start:'2026-09-07T10:00:00',end:'2026-09-09T00:00:00'}]}];
    invalidateUiRuntimeIndexes()`);
  h.week();
  for (const id of ['gantt','mobile-planning-list']) {
    assert.deepEqual(sections(h.html(id)).filter(x => x.body.includes('data-booking-id="b1"')).map(x => x.day),
      ['2026-09-07','2026-09-08']);
  }
  h.run(`state.bookings[0].status = 'completed'; state.bookings[0].actualEnd = '2026-09-07T11:00:00';
    invalidateUiRuntimeIndexes(); renderPlanning()`);
  for (const id of ['gantt','mobile-planning-list']) {
    assert.deepEqual(sections(h.html(id)).filter(x => x.body.includes('data-booking-id="b1"')).map(x => x.day),
      ['2026-09-07']);
  }
});
