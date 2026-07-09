import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const scriptFiles = [
  'js/utils.js',
  'js/state.js',
  'js/photos.js',
  'js/planning.js',
  'js/ui-cases.js',
  'js/estimate-import.js',
  'js/storage.js',
  'js/exports.js',
  'js/business-rules-v2187.js',
];

function elementStub() {
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    checked: false,
    disabled: false,
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    removeAttribute() {},
    toggleAttribute() {},
    addEventListener() {},
    append() {},
    appendChild() {},
    remove() {},
    replaceChildren() {},
    querySelector: () => elementStub(),
    querySelectorAll: () => [],
    closest: () => elementStub(),
  };
}

const context = {
  console,
  TextEncoder,
  TextDecoder,
  Blob,
  URL: { createObjectURL: () => '', revokeObjectURL() {} },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: {
    querySelector: () => elementStub(),
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => elementStub(),
    getElementById: () => elementStub(),
    body: elementStub(),
  },
  window: { addEventListener() {}, open: () => ({ document: { write() {}, close() {} } }) },
  navigator: {},
  fetch: async () => ({ ok: false }),
  setTimeout,
  clearTimeout,
  crypto: { randomUUID: () => `test-${Math.random().toString(16).slice(2)}` },
};
context.window = context;
vm.createContext(context);

const source = scriptFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
vm.runInContext(source, context, { filename: 'simplified-workflow-app.js' });

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function runJson(expression) {
  return JSON.parse(vm.runInContext(expression, context));
}

const html = fs.readFileSync('index.html', 'utf8');
const appSource = fs.readFileSync('app.js', 'utf8');
const vehicles = JSON.parse(fs.readFileSync('data/vehicles.json', 'utf8'));

test('PDF files are accepted for estimate import', () => {
  assert.equal(context.validateEstimateImportFile({ name: 'devis.pdf', size: 1024 }), '');
});

test('XLSX estimate import is rejected', () => {
  assert.match(context.validateEstimateImportFile({ name: 'devis.xlsx', size: 1024 }), /PDF atelier/);
});

test('CSV estimate import is rejected', () => {
  assert.match(context.validateEstimateImportFile({ name: 'devis.csv', size: 1024 }), /PDF atelier/);
});

test('case creation form requires a PDF estimate', () => {
  assert.match(html, /name="estimateFile"[^>]+accept="\.pdf,application\/pdf"[^>]+required/);
  assert.match(appSource, /point d'entrée obligatoire du dossier atelier/);
});

const headerEstimate = `Client STE ATELIER TEST
Tel 98321415
DV-SRV-CH26001606 OR-SRV-CH2602209
DFM T5 EVO 1.5L TURBO 52 000
6286TU243 LMXA14AF6RZ352028
VIDANGE MOTEUR 1 33,000 33,000`;
const headerParsed = context.parseEstimateText(headerEstimate, { fileName: 'devis.pdf', claimType: 'atelier' });

test('PDF text extraction captures customer identity', () => {
  assert.equal(headerParsed.info.clientName, 'STE ATELIER TEST');
  assert.equal(headerParsed.info.phone, '98321415');
});

test('PDF text extraction captures vehicle identity', () => {
  assert.equal(headerParsed.info.vehicle, 'T5 EVO 1.5L TURBO');
  assert.equal(headerParsed.info.plate, '6286TU243');
  assert.equal(headerParsed.info.vin, 'LMXA14AF6RZ352028');
  assert.equal(headerParsed.info.mileage, '52000');
});

test('PDF text extraction captures estimate and OR references', () => {
  assert.equal(headerParsed.info.estimateNumber, 'DV-SRV-CH26001606');
  assert.equal(headerParsed.info.orNumber, 'OR-SRV-CH2602209');
});

test('part import stores quantities but no price fields', () => {
  const part = context.classifyEstimatePartLine('TUBE COLLE PARE-BRISE 1 32,850 32,850');
  const stored = context.buildEstimatePartLines({ partsLines: [part] });
  assert.equal(stored.length, 1);
  assert.equal('unitPrice' in stored[0], false);
  assert.equal('amount' in stored[0], false);
});

test('oil service keywords map to oilService', () => {
  for (const label of ['VIDANGE MOTEUR', 'ENTRETIEN', 'REMP FILTRE A AIR']) {
    assert.equal(context.distributeLaborHours(label, 1, { claimType: 'atelier' })[0].phase, 'oilService');
  }
});

test('mechanical keywords map to mecanicien work', () => {
  for (const label of ['REPARATION MECANIQUE FREINS', 'SUSPENSION TRAIN AVANT GEOMETRIE']) {
    assert.equal(context.distributeLaborHours(label, 1, { claimType: 'atelier' })[0].phase, 'mechanical');
  }
});

test('electrical and diagnostic keywords map to electrical work', () => {
  const line = 'DIAGNOSTIC VALISE VOYANT BCM FAISCEAU BATTERIE ELECTRIQUE';
  assert.equal(context.distributeLaborHours(line, 1, { claimType: 'atelier' })[0].phase, 'electrical');
});

test('body keywords map to body work', () => {
  const line = 'TOLERIE REDRESSAGE PARE-CHOCS AILE PORTE CHOC CARROSSERIE';
  assert.equal(context.distributeLaborHours(line, 1, { claimType: 'atelier' })[0].phase, 'body');
});

test('paint keywords map to paint work', () => {
  const line = 'PEINTURE VERNIS TEINTE CABINE';
  assert.equal(context.distributeLaborHours(line, 1, { claimType: 'atelier' })[0].phase, 'paint');
});

test('final verification keywords map to finalCheck', () => {
  const line = 'CONTROLE FINAL ESSAI VERIFICATION FINALE';
  assert.equal(context.distributeLaborHours(line, 1, { claimType: 'atelier' })[0].phase, 'finalCheck');
});

test('business rules require Chef Atelier validation before planning', () => {
  const result = runJson(`(() => {
    state = normalizeState({
      resources: [
        { id: 'mec-1', name: 'Mecanicien', role: 'mecanicien', active: true },
        { id: 'pont-1', name: 'Pont', role: 'pont_mecanique', active: true }
      ],
      cases: []
    });
    const item = normalizeCase({
      id: 'chef-required',
      clientName: 'Chef required',
      plate: '123TU2026',
      claims: [{ type: 'atelier', includeInPlanning: true, estimate: { lines: [{ phase: 'mechanical', operation: 'Freins', laborHours: 1 }] } }]
    });
    return JSON.stringify({ action: getNextWorkflowAction(item), issues: getBusinessRuleIssues(item, 'appointment') });
  })()`);
  assert.equal(result.action, 'validate_chef_atelier');
  assert.ok(result.issues.some((issue) => issue.includes('Chef Atelier')));
});

test('Chef Atelier validation unlocks planning', () => {
  const result = runJson(`(() => {
    state = normalizeState({
      resources: [
        { id: 'mec-1', name: 'Mecanicien', role: 'mecanicien', active: true },
        { id: 'pont-1', name: 'Pont', role: 'pont_mecanique', active: true }
      ],
      cases: []
    });
    const item = normalizeCase({
      id: 'chef-ok',
      clientName: 'Chef OK',
      plate: '124TU2026',
      flags: { chefValidated: true },
      claims: [{ type: 'atelier', includeInPlanning: true, estimate: { lines: [{ phase: 'mechanical', operation: 'Freins', laborHours: 1 }] } }]
    });
    applyWorkflowAction(item, 'chefValidated');
    return JSON.stringify({ action: getNextWorkflowAction(item), issues: getBusinessRuleIssues(item, 'appointment'), status: item.claims[0].status });
  })()`);
  assert.equal(result.action, 'appointment');
  assert.equal(result.issues.length, 0);
  assert.equal(result.status, 'atelier_validated');
});

test('planning is blocked when a required role is missing', () => {
  const result = runJson(`(() => {
    state = normalizeState({ resources: [{ id: 'mec-1', name: 'Mecanicien', role: 'mecanicien', active: true }], cases: [] });
    state.resources = [{ id: 'mec-1', name: 'Mecanicien', role: 'mecanicien', active: true }];
    const item = normalizeCase({
      id: 'missing-role',
      clientName: 'Missing role',
      plate: '125TU2026',
      flags: { chefValidated: true },
      durations: { mechanical: 1 },
      claims: [{ type: 'atelier', includeInPlanning: true, estimate: { lines: [{ phase: 'mechanical', operation: 'Freins', laborHours: 1 }] } }]
    });
    return JSON.stringify(getBusinessRuleIssues(item, 'appointment'));
  })()`);
  assert.ok(result.some((issue) => issue.includes('ressource')), JSON.stringify(result));
});

test('booking conflict detection prevents overlapping resource use', () => {
  const result = runJson(`(() => {
    state = normalizeState({
      resources: [{ id: 'mec-1', name: 'Mecanicien', role: 'mecanicien', active: true }],
      cases: [{ id: 'c1', clientName: 'C1' }],
      bookings: [{
        id: 'b1',
        caseId: 'c1',
        key: 'mechanical',
        title: 'Task',
        resourceIds: ['mec-1'],
        segments: [{ start: '2026-07-10T08:00:00.000Z', end: '2026-07-10T10:00:00.000Z' }]
      }]
    });
    return JSON.stringify(Boolean(resourceHasConflict('mec-1', new Date('2026-07-10T09:00:00.000Z'), new Date('2026-07-10T10:30:00.000Z'), state.bookings)));
  })()`);
  assert.equal(result, true);
});

test('booking conflict ignores completed tasks', () => {
  const result = runJson(`(() => {
    state = normalizeState({
      resources: [{ id: 'mec-1', name: 'Mecanicien', role: 'mecanicien', active: true }],
      cases: [{ id: 'c1', clientName: 'C1' }],
      bookings: [{
        id: 'b1',
        caseId: 'c1',
        key: 'mechanical',
        title: 'Task',
        status: 'completed',
        resourceIds: ['mec-1'],
        segments: [{ start: '2026-07-10T08:00:00.000Z', end: '2026-07-10T10:00:00.000Z' }]
      }]
    });
    return JSON.stringify(Boolean(resourceHasConflict('mec-1', new Date('2026-07-10T09:00:00.000Z'), new Date('2026-07-10T10:30:00.000Z'), state.bookings)));
  })()`);
  assert.equal(result, false);
});

test('bodywork planning reserves only one tolier', () => {
  const result = runJson(`(() => {
    state = normalizeState({
      resources: [
        { id: 'sassi', name: 'SASSI', role: 'tolier', active: true },
        { id: 'imed', name: 'IMED', role: 'tolier', active: true }
      ],
      cases: [],
      bookings: []
    });
    const item = normalizeCase({
      id: 'single-tolier-body',
      clientName: 'Single tolier',
      plate: '140TU2026',
      flags: { chefValidated: true },
      durations: { body: 6.75, oilService: 0, mechanical: 0, electrical: 0, prep: 0, paint: 0, reassembly: 0, finish: 0, finalCheck: 0, quality: 0 }
    });
    const proposal = schedulePipeline(item, new Date('2026-07-13T08:00:00.000Z'), []);
    const bookings = proposalToBookings(item, proposal, false);
    const bodySteps = proposal.steps.filter((step) => step.key === 'body');
    const bodyBookings = bookings.filter((booking) => booking.key === 'body');
    return JSON.stringify({
      bodyStepCount: bodySteps.length,
      bodyBookingCount: bodyBookings.length,
      resourceCount: bodyBookings[0]?.resourceIds.length || 0,
      resourceIds: bodyBookings[0]?.resourceIds || [],
      humanResourceCount: (bodyBookings[0]?.resourceIds || []).filter((id) => ['sassi', 'imed'].includes(id)).length,
      ganttDuplicates: bodyBookings.flatMap((booking) => (booking.resourceIds || []).map((id) => booking.id + ':' + id)).length
    });
  })()`);
  assert.equal(result.bodyStepCount, 1);
  assert.equal(result.bodyBookingCount, 1);
  assert.equal(result.resourceCount, 1);
  assert.equal(result.humanResourceCount, 1);
  assert.ok(['sassi', 'imed'].includes(result.resourceIds[0]));
  assert.equal(result.ganttDuplicates, 1);
});

test('new parts never create anticipated preparation planning', () => {
  const result = runJson(`(() => {
    state = normalizeState({
      resources: [
        { id: 'tolier', name: 'Tolier', role: 'tolier', active: true },
        { id: 'peintre', name: 'Peintre', role: 'peintre', active: true },
        { id: 'cabine', name: 'Cabine', role: 'cabine', active: true }
      ],
      cases: [],
      bookings: []
    });
    const item = normalizeCase({
      id: 'no-anticipated-new-parts',
      clientName: 'No anticipated',
      plate: '141TU2026',
      flags: { chefValidated: true },
      durations: { body: 2, oilService: 0, mechanical: 0, electrical: 0, prep: 1.5, paint: 1, reassembly: 0, finish: 0, finalCheck: 0, quality: 0 },
      claims: [{
        type: 'atelier',
        includeInPlanning: true,
        estimate: {
          lines: [
            { phase: 'body', operation: 'Tolerie demontage', laborHours: 2 },
            { phase: 'prep', operation: 'Preparation pare-chocs neuf', laborHours: 1.5 },
            { phase: 'paint', operation: 'Peinture pare-chocs neuf', laborHours: 1 }
          ],
          originalLines: [{
            operation: 'REMPLACEMENT PARE-CHOCS NEUF',
            pieceKind: 'new',
            allocations: [
              { phase: 'prep', operation: 'Preparation pare-chocs neuf', laborHours: 1.5 },
              { phase: 'paint', operation: 'Peinture pare-chocs neuf', laborHours: 1 }
            ]
          }]
        }
      }]
    });
    const proposal = schedulePipeline(item, new Date('2026-07-13T08:00:00.000Z'), []);
    const bookings = proposalToBookings(item, proposal, false);
    const fold = (value) => String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
    const text = [...proposal.steps, ...bookings].map((entry) => fold([entry.title, entry.details, entry.planningMode].join(' '))).join(' ');
    return JSON.stringify({
      stepKeys: proposal.steps.map((step) => step.key),
      hasForbiddenText: text.includes('preparation anticipee') || text.includes('pieces neuves') || text.includes('piece neuve') || text.includes('anticipated-new-part'),
      anticipatedCount: proposal.steps.filter((step) => step.planningMode === 'anticipated-new-part').length
    });
  })()`);
  assert.deepEqual(result.stepKeys, ['body', 'prep', 'paint']);
  assert.equal(result.hasForbiddenText, false);
  assert.equal(result.anticipatedCount, 0);
});

test('bodywork duration UI hides redundant service selector', () => {
  const result = runJson(`(() => {
    state = normalizeState({
      resources: [
        { id: 'sassi', name: 'SASSI', role: 'tolier', active: true },
        { id: 'imed', name: 'IMED', role: 'tolier', active: true }
      ],
      cases: [],
      bookings: []
    });
    const item = normalizeCase({
      id: 'body-ui-no-double-menu',
      clientName: 'Body UI',
      plate: '142TU2026',
      durations: { body: 6.75, oilService: 0, mechanical: 0, electrical: 0, prep: 0, paint: 0, reassembly: 0, finish: 0, finalCheck: 0, quality: 0 }
    });
    const makeElement = () => ({
      value: '',
      textContent: '',
      innerHTML: '',
      hidden: false,
      dataset: {},
      style: {},
      parentNode: { insertBefore() {} },
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {},
      removeAttribute() {},
      addEventListener() {},
      append() {},
      appendChild() {},
      remove() {},
      querySelector: () => null,
      querySelectorAll: () => []
    });
    const durationField = makeElement();
    const totalField = makeElement();
    const root = {
      querySelector(selector) {
        if (selector === "[data-field='durations']") return durationField;
        if (selector === "[data-field='total-duration']") return totalField;
        if (selector === "[data-field='validated-appointment-plan']") return null;
        if (selector === "[data-field='imported-labor-review']") return null;
        return makeElement();
      },
      querySelectorAll: () => []
    };
    renderDurations(root, item);
    return JSON.stringify({
      hasTechnicianSelector: durationField.innerHTML.includes('Technicien à réserver'),
      hasServiceSelector: durationField.innerHTML.includes('Service à réserver dans le planning'),
      hasAutoTolier: durationField.innerHTML.includes('Auto recommandé - Tôlier')
    });
  })()`);
  assert.equal(result.hasTechnicianSelector, true);
  assert.equal(result.hasServiceSelector, false);
  assert.equal(result.hasAutoTolier, false);
});

test('task can start from planned state', () => {
  const result = runJson(`(() => {
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 60000).toISOString();
    const end = new Date(now.getTime() + 90 * 60000).toISOString();
    state = normalizeState({
      resources: [{ id: 'tech', name: 'Tech', role: 'mecanicien', active: true }],
      cases: [{ id: 'task-case', clientName: 'Task case', plate: '126TU2026', flags: { chefValidated: true }, appointment: { start, end, delivery: end } }],
      bookings: [{ id: 'task', caseId: 'task-case', key: 'mechanical', title: 'Freins', resourceIds: ['tech'], plannedMinutes: 120, segments: [{ start, end }], start, end, status: 'planned' }]
    });
    const item = state.cases[0];
    const started = startCaseBookingTask(item, 'task');
    return JSON.stringify({ ok: started.ok, status: state.bookings[0].status, workStarted: item.flags.workStarted });
  })()`);
  assert.deepEqual(result, { ok: true, status: 'started', workStarted: true });
});

test('started task can pause and create a planned remainder', () => {
  const result = runJson(`(() => {
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 60000).toISOString();
    const end = new Date(now.getTime() + 90 * 60000).toISOString();
    state = normalizeState({
      resources: [{ id: 'tech', name: 'Tech', role: 'mecanicien', active: true }],
      cases: [{ id: 'pause-case', clientName: 'Pause case', plate: '127TU2026', flags: { chefValidated: true }, appointment: { start, end, delivery: end } }],
      bookings: [{ id: 'task', caseId: 'pause-case', key: 'mechanical', title: 'Freins', resourceIds: ['tech'], plannedMinutes: 120, segments: [{ start, end }], start, end, status: 'planned' }]
    });
    const item = state.cases[0];
    startCaseBookingTask(item, 'task');
    const paused = pauseCaseBookingTask(item, 'task', 'Attente piece');
    const remainder = state.bookings.find((booking) => booking.parentBookingId === 'task');
    return JSON.stringify({ ok: paused.ok, original: state.bookings.find((booking) => booking.id === 'task').status, remainder: remainder?.status, remaining: Boolean(remainder?.remainingFromPaused) });
  })()`);
  assert.deepEqual(result, { ok: true, original: 'paused', remainder: 'planned', remaining: true });
});

test('planned remainder can resume by starting it', () => {
  const result = runJson(`(() => {
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 60000).toISOString();
    const end = new Date(now.getTime() + 90 * 60000).toISOString();
    state = normalizeState({
      resources: [{ id: 'tech', name: 'Tech', role: 'mecanicien', active: true }],
      cases: [{ id: 'resume-case', clientName: 'Resume case', plate: '128TU2026', flags: { chefValidated: true }, appointment: { start, end, delivery: end } }],
      bookings: [{ id: 'task', caseId: 'resume-case', key: 'mechanical', title: 'Freins', resourceIds: ['tech'], plannedMinutes: 120, segments: [{ start, end }], start, end, status: 'planned' }]
    });
    const item = state.cases[0];
    startCaseBookingTask(item, 'task');
    pauseCaseBookingTask(item, 'task', 'Pause test');
    const remainder = state.bookings.find((booking) => booking.parentBookingId === 'task');
    const resumed = startCaseBookingTask(item, remainder.id);
    return JSON.stringify({ ok: resumed.ok, status: remainder.status });
  })()`);
  assert.deepEqual(result, { ok: true, status: 'started' });
});

test('task can be blocked with a reason', () => {
  const result = runJson(`(() => {
    const start = '2026-07-10T08:00:00.000Z';
    const end = '2026-07-10T10:00:00.000Z';
    state = normalizeState({
      resources: [{ id: 'tech', name: 'Tech', role: 'mecanicien', active: true }],
      cases: [{ id: 'block-case', clientName: 'Block case', plate: '129TU2026', flags: { chefValidated: true }, appointment: { start, end, delivery: end } }],
      bookings: [{ id: 'task', caseId: 'block-case', key: 'mechanical', title: 'Freins', resourceIds: ['tech'], plannedMinutes: 120, segments: [{ start, end }], start, end, status: 'planned' }]
    });
    const item = state.cases[0];
    const blocked = blockCaseBookingTask(item, 'task', 'Attente diagnostic');
    const startBlocked = startCaseBookingTask(item, 'task');
    const completeBlocked = completeCaseBookingTaskNow(item, 'task', new Date(start));
    return JSON.stringify({ ok: blocked.ok, status: state.bookings[0].status, startOk: startBlocked.ok, completeOk: completeBlocked.ok });
  })()`);
  assert.deepEqual(result, { ok: true, status: 'blocked', startOk: false, completeOk: false });
});

test('task completion marks atelier work completed when all tasks are done', () => {
  const result = runJson(`(() => {
    const start = '2026-07-10T08:00:00.000Z';
    const end = '2026-07-10T10:00:00.000Z';
    state = normalizeState({
      resources: [{ id: 'tech', name: 'Tech', role: 'mecanicien', active: true }],
      cases: [{ id: 'complete-case', clientName: 'Complete case', plate: '130TU2026', flags: { chefValidated: true }, appointment: { start, end, delivery: end } }],
      bookings: [{ id: 'task', caseId: 'complete-case', key: 'mechanical', title: 'Freins', resourceIds: ['tech'], plannedMinutes: 120, segments: [{ start, end }], start, end, status: 'planned' }]
    });
    const item = state.cases[0];
    startCaseBookingTask(item, 'task');
    const done = completeCaseBookingTaskNow(item, 'task', new Date('2026-07-10T09:00:00.000Z'));
    return JSON.stringify({ ok: done.ok, status: state.bookings[0].status, workCompleted: item.flags.workCompleted });
  })()`);
  assert.deepEqual(result, { ok: true, status: 'completed', workCompleted: true });
});

test('atelier closure is blocked while tasks are open', () => {
  const result = runJson(`(() => {
    const start = '2026-07-10T08:00:00.000Z';
    const end = '2026-07-10T10:00:00.000Z';
    state = normalizeState({
      resources: [{ id: 'tech', name: 'Tech', role: 'mecanicien', active: true }],
      cases: [{ id: 'close-open', clientName: 'Close open', plate: '131TU2026', flags: { chefValidated: true, workCompleted: true }, appointment: { start, end, delivery: end } }],
      bookings: [{ id: 'task', caseId: 'close-open', key: 'mechanical', title: 'Freins', resourceIds: ['tech'], segments: [{ start, end }], start, end, status: 'planned' }]
    });
    return JSON.stringify(getBusinessRuleIssues(state.cases[0], 'atelierClosed'));
  })()`);
  assert.ok(result.some((issue) => issue.includes('tache') || issue.includes('tâche')));
});

test('atelier closure is allowed when all tasks are completed', () => {
  const result = runJson(`(() => {
    const start = '2026-07-10T08:00:00.000Z';
    const end = '2026-07-10T10:00:00.000Z';
    state = normalizeState({
      resources: [{ id: 'tech', name: 'Tech', role: 'mecanicien', active: true }],
      cases: [{ id: 'close-ok', clientName: 'Close ok', plate: '132TU2026', flags: { chefValidated: true, workCompleted: true }, appointment: { start, end, delivery: end } }],
      bookings: [{ id: 'task', caseId: 'close-ok', key: 'mechanical', title: 'Freins', resourceIds: ['tech'], segments: [{ start, end }], start, end, status: 'completed' }]
    });
    return JSON.stringify(getBusinessRuleIssues(state.cases[0], 'atelierClosed'));
  })()`);
  assert.equal(result.length, 0);
});

test('archive is blocked until atelier closure', () => {
  const result = runJson(`(() => {
    const item = normalizeCase({ id: 'archive-blocked', clientName: 'Archive blocked', plate: '133TU2026', flags: { chefValidated: true, workCompleted: true } });
    return JSON.stringify(getBusinessRuleIssues(item, 'archived'));
  })()`);
  assert.ok(result.some((issue) => issue.includes('Cloturer') || issue.includes('Clôturer')));
});

test('archive succeeds after atelier closure', () => {
  const result = runJson(`(() => {
    const item = normalizeCase({ id: 'archive-ok', clientName: 'Archive ok', plate: '134TU2026', flags: { chefValidated: true, workCompleted: true } });
    applyWorkflowAction(item, 'atelierClosed');
    applyWorkflowAction(item, 'archived');
    return JSON.stringify({ closed: item.flags.atelierClosed, archived: item.flags.archived, status: getCaseStatus(item) });
  })()`);
  assert.deepEqual(result, { closed: true, archived: true, status: 'archive' });
});

test('removed workflow actions are rejected by business rules', () => {
  const item = context.normalizeCase({ id: 'removed', clientName: 'Removed', plate: '135TU2026' });
  for (const action of ['expertApproved', 'clientApproved', 'received', 'qualityApproved', 'delivered', 'invoiced']) {
    assert.match(context.getBusinessRuleIssues(item, action)[0], /supprimee|supprimée/i);
  }
});

test('status set is the simplified atelier set', () => {
  const expected = ['devis_importe', 'a_valider_chef_atelier', 'valide_atelier', 'planifie', 'en_cours', 'en_pause', 'bloque', 'termine_atelier', 'cloture_atelier', 'archive'];
  for (const status of expected) assert.match(html, new RegExp(`value="${status}"`));
  assert.equal(html.includes('value="delivered"'), false);
});

test('export archive HTML hides client folder export', () => {
  assert.match(html, /id="export-client-folder" hidden/);
});

test('admin technique can export clear JSON', () => {
  assert.equal(context.canExportClearJson('admin_technique'), true);
});

test('technician cannot export clear JSON', () => {
  assert.equal(context.canExportClearJson('technicien'), false);
  assert.throws(() => context.assertCanExportClearJson('technicien'), /admin technique/);
});

test('encrypted backup is not treated as clear JSON export', () => {
  assert.match(fs.readFileSync('js/storage.js', 'utf8'), /clearJson:\s*false/);
});

test('vehicle base stays empty', () => {
  assert.deepEqual(vehicles, []);
});

test('no visible pricing columns remain in archive exports', () => {
  const exportSource = fs.readFileSync('js/exports.js', 'utf8');
  assert.equal(/<th>PU<\/th>|<th>Montant<\/th>|Facture|Paiement/.test(exportSource), false);
});

test('no active PV or delivery document is exported', () => {
  const exportSource = fs.readFileSync('js/exports.js', 'utf8');
  assert.equal(/PV_DE_RESTITUTION|PV de restitution|Controle_qualite|Confirmation_client/.test(exportSource), false);
});

test('estimate optimization writes finalCheck and not quality duration', () => {
  const result = runJson(`(() => {
    const parsed = parseEstimateText('PEINTURE ET FINITION PARE CHOC 2 33,000 66,000', { fileName: 'final.pdf', claimType: 'atelier' });
    const lines = buildAppliedEstimateLines(parsed);
    const phases = lines.map((line) => line.phase);
    const item = normalizeCase({ id: 'final-check', clientName: 'Final', plate: '136TU2026', claims: [{ includeInPlanning: true, estimate: { lines, originalLines: buildOriginalEstimateLines(parsed) } }] });
    recomputeCaseDurationsFromClaims(item);
    return JSON.stringify({ phases, finalCheck: item.durations.finalCheck, quality: item.durations.quality });
  })()`);
  assert.ok(result.phases.includes('finalCheck'));
  assert.equal(result.quality, 0);
  assert.ok(result.finalCheck > 0);
});

test('status computation follows atelier workflow', () => {
  const result = runJson(`(() => {
    state = normalizeState({ resources: [{ id: 'tech', name: 'Tech', role: 'mecanicien', active: true }], cases: [], bookings: [] });
    const item = normalizeCase({
      id: 'status-case',
      clientName: 'Status',
      plate: '137TU2026',
      claims: [{ includeInPlanning: true, estimate: { lines: [{ phase: 'mechanical', operation: 'MO', laborHours: 1 }] } }]
    });
    const imported = getCaseStatus(item);
    applyWorkflowAction(item, 'chefValidated');
    const validated = getCaseStatus(item);
    state.bookings.push({ id: 'b', caseId: item.id, key: 'mechanical', title: 'MO', resourceIds: ['tech'], segments: [{ start: '2026-07-10T08:00:00.000Z', end: '2026-07-10T09:00:00.000Z' }], start: '2026-07-10T08:00:00.000Z', end: '2026-07-10T09:00:00.000Z', status: 'planned' });
    const planned = getCaseStatus(item);
    item.flags.workStarted = true;
    const progress = getCaseStatus(item);
    item.flags.workCompleted = true;
    const done = getCaseStatus(item);
    item.flags.atelierClosed = true;
    const closed = getCaseStatus(item);
    item.flags.archived = true;
    const archived = getCaseStatus(item);
    return JSON.stringify({ imported, validated, planned, progress, done, closed, archived });
  })()`);
  assert.deepEqual(result, {
    imported: 'a_valider_chef_atelier',
    validated: 'valide_atelier',
    planned: 'planifie',
    progress: 'en_cours',
    done: 'termine_atelier',
    closed: 'cloture_atelier',
    archived: 'archive',
  });
});

test('status computation handles blocked and paused tasks', () => {
  const result = runJson(`(() => {
    state = normalizeState({ resources: [{ id: 'tech', name: 'Tech', role: 'mecanicien', active: true }], cases: [], bookings: [] });
    const item = normalizeCase({ id: 'status-paused', clientName: 'Status paused', plate: '138TU2026', flags: { chefValidated: true } });
    state.bookings = [{ id: 'b', caseId: item.id, key: 'mechanical', title: 'MO', resourceIds: ['tech'], segments: [{ start: '2026-07-10T08:00:00.000Z', end: '2026-07-10T09:00:00.000Z' }], start: '2026-07-10T08:00:00.000Z', end: '2026-07-10T09:00:00.000Z', status: 'paused' }];
    const paused = getCaseStatus(item);
    state.bookings[0].status = 'blocked';
    const blocked = getCaseStatus(item);
    return JSON.stringify({ paused, blocked });
  })()`);
  assert.deepEqual(result, { paused: 'en_pause', blocked: 'bloque' });
});

test('case status performance stays acceptable at 4000 cases', () => {
  const result = runJson(`(() => {
    state = normalizeState({ resources: [], cases: [], bookings: [] });
    const cases = Array.from({ length: 4000 }, (_, index) => normalizeCase({
      id: 'perf-' + index,
      clientName: 'Perf ' + index,
      plate: String(200000 + index),
      flags: { chefValidated: index % 3 === 0, workStarted: index % 7 === 0, workCompleted: index % 11 === 0 }
    }));
    const start = Date.now();
    const statuses = cases.map((item) => getCaseStatus(item));
    return JSON.stringify({ ms: Date.now() - start, count: statuses.length });
  })()`);
  assert.equal(result.count, 4000);
  assert.ok(result.ms < 2500, `status pass took ${result.ms} ms`);
});

console.log(`Simplified NIMR SAV workflow regression OK (${passed} checks)`);
