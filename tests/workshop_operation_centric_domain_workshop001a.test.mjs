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
  .replace(/initApp\(\);/, '// initApp skipped by WORKSHOP-001A test suite')
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
    getElementById: () => stubElement(),
    querySelector: () => stubElement(),
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => stubElement(),
    body: stubElement(),
  },
  navigator: { onLine: true, serviceWorker: undefined, storage: { estimate: async () => ({}) } },
  window: {
    addEventListener() {},
    location: { reload() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    prompt: () => 'override',
  },
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

const win = context.window;
const toPlain = (v) => JSON.parse(JSON.stringify(v));

const ALL_PRODUCTIVE_PHASES = ['body', 'oilService', 'mechanical', 'electrical', 'prep', 'paint', 'reassembly', 'finish', 'quality'];
function sumAllProductiveCaseDurations(item) {
  const durations = item?.durations || {};
  return Number(
    ALL_PRODUCTIVE_PHASES
      .reduce((sum, phase) => sum + Number(durations[phase] || 0), 0)
      .toFixed(2)
  );
}

console.log('--- STARTING WORKSHOP-001A CANONICAL TASK DERIVATION TESTS ---');

// 1. Element extraction tests
console.log('Test 1: Bodyshop element extraction');
assert.equal(win.extractBodyshopElement('REPOSE LUNETTE AR'), 'Lunette AR');
assert.equal(win.extractBodyshopElement('D/P ET PREPARATION MALLE AR'), 'Malle AR');
assert.equal(win.extractBodyshopElement('PEINTURE ET FINITION MALLE AR'), 'Malle AR');
assert.equal(win.extractBodyshopElement('D/P ET PREPARATION PARE CHOC AR'), 'Pare-chocs AR');
assert.equal(win.extractBodyshopElement('PEINTURE ET FINITION PARE CHOC AR'), 'Pare-chocs AR');
assert.equal(win.extractBodyshopElement('DEPOSE ET REPOSE CAPOT AVANT'), 'Capot');
assert.equal(win.extractBodyshopElement('MO-TOL DEPOSE PARE CHOCS AV'), 'Pare-chocs AV');
assert.equal(win.extractBodyshopElement('REMPLACEMENT AILE ARD'), 'Aile ARD');

// 2. Batch titles formatting
console.log('Test 2: Batch title formatting');
assert.equal(win.formatPreparationBatchTitle('rear'), 'PRÉPARATION GLOBALE — LOT ARRIÈRE');
assert.equal(win.formatPreparationBatchTitle('front'), 'PRÉPARATION GLOBALE — LOT AVANT');
assert.equal(win.formatPreparationBatchTitle('left'), 'PRÉPARATION GLOBALE — LOT CÔTÉ GAUCHE');
assert.equal(win.formatPreparationBatchTitle('right'), 'PRÉPARATION GLOBALE — LOT CÔTÉ DROIT');
assert.equal(win.formatPreparationBatchTitle('center'), 'PRÉPARATION GLOBALE — LOT CAPOT / CENTRE');
assert.equal(win.formatPreparationBatchTitle('general'), 'PRÉPARATION GLOBALE — LOT GÉNÉRAL');
assert.equal(win.formatPaintBatchTitle('rear'), 'PEINTURE + VERNIS — LOT ARRIÈRE');
assert.equal(win.formatPaintBatchTitle('front'), 'PEINTURE + VERNIS — LOT AVANT');

// 3. ASMA Concrete Fixture Verification
console.log('Test 3: ASMA Fixture canonical derivation and duration invariants');
const asmaCase = {
  id: 'case-asma-1',
  clientName: 'Client ASMA',
  plate: '123TU456',
  durations: {},
  claims: [
    {
      id: 'claim-asma-1',
      number: 'OT-001',
      title: 'Sinistre arrière',
      type: 'client',
      estimate: {
        reference: 'DEV-ASMA-001',
        originalLines: [
          { id: 'line-1', operation: 'REPOSE LUNETTE AR', laborHours: 6, selectedPhases: ['reassembly'] },
          { id: 'line-2', operation: 'D/P ET PREPARATION MALLE AR', laborHours: 3, selectedPhases: ['body', 'reassembly'] },
          { id: 'line-3', operation: 'PEINTURE ET FINITION MALLE AR', laborHours: 6, selectedPhases: ['prep', 'paint'] },
          { id: 'line-4', operation: 'D/P ET PREPARATION PARE CHOC AR', laborHours: 2.5, selectedPhases: ['body', 'reassembly'] },
          { id: 'line-5', operation: 'PEINTURE ET FINITION PARE CHOC AR', laborHours: 4.5, selectedPhases: ['prep', 'paint'] },
        ],
      },
    },
  ],
};

// Recompute case durations
win.recomputeCaseDurationsFromClaims(asmaCase);

assert.equal(asmaCase.durations.body, 2.75, 'Body duration must be 2.75h');
assert.equal(asmaCase.durations.prep, 7.0, 'Prep duration must be 7.0h');
assert.equal(asmaCase.durations.paint, 3.38, 'Paint duration must be 3.38h');
assert.equal(asmaCase.durations.reassembly, 8.75, 'Reassembly duration must be 8.75h');

const totalCaseDuration = sumAllProductiveCaseDurations(asmaCase);
assert.equal(totalCaseDuration, 21.88, 'Total case duration must be 21.88h');

// Derive canonical tasks
const derivedTasks = win.deriveCanonicalPlanningTasks(asmaCase);
assert.equal(derivedTasks.length, 7, 'ASMA case must produce exactly 7 canonical tasks');

// Verify task breakdown:
// Task 1: Body Malle AR
const task1 = derivedTasks[0];
assert.equal(task1.id, 'task-op|case-asma-1|claim-asma-1|line-2|body');
assert.equal(task1.kind, 'operation');
assert.equal(task1.phase, 'body');
assert.equal(task1.laborHours, 1.5);
assert.equal(task1.title, 'D/P ET PREPARATION MALLE AR');
assert.deepEqual(toPlain(task1.elements), ['Malle AR']);
assert.equal(task1.requiredRole, 'tolier');
assert.equal(task1.sourceKind, 'estimate_provenance');
assert.equal(task1.taskModelVersion, 1);
assert.equal(task1.vehicleExclusive, true);

// Task 2: Body Pare-chocs AR
const task2 = derivedTasks[1];
assert.equal(task2.id, 'task-op|case-asma-1|claim-asma-1|line-4|body');
assert.equal(task2.kind, 'operation');
assert.equal(task2.phase, 'body');
assert.equal(task2.laborHours, 1.25);
assert.equal(task2.title, 'D/P ET PREPARATION PARE CHOC AR');
assert.deepEqual(toPlain(task2.elements), ['Pare-chocs AR']);
assert.equal(task2.requiredRole, 'tolier');

// Task 3: Preparation Batch (Rear)
const task3 = derivedTasks[2];
assert.equal(task3.id, 'task-batch-prep|case-asma-1|rear');
assert.equal(task3.kind, 'preparation_batch');
assert.equal(task3.phase, 'prep');
assert.equal(task3.title, 'PRÉPARATION GLOBALE — LOT ARRIÈRE');
assert.equal(task3.laborHours, 7.0, 'Prep batch hours must equal 4h + 3h = 7h (no mutualization reduction)');
assert.deepEqual(toPlain(task3.elements.sort()), ['Malle AR', 'Pare-chocs AR'].sort());
assert.deepEqual(toPlain(task3.sourceLineIds.sort()), ['line-3', 'line-5'].sort());
assert.equal(task3.requiredRole, 'peintre');
assert.equal(task3.equipmentRole, 'zone_preparation');

// Task 4: Paint Batch (Rear)
const task4 = derivedTasks[3];
assert.equal(task4.id, 'task-batch-paint|case-asma-1|rear');
assert.equal(task4.kind, 'paint_batch');
assert.equal(task4.phase, 'paint');
assert.equal(task4.title, 'PEINTURE + VERNIS — LOT ARRIÈRE');
assert.equal(task4.laborHours, 3.38, 'Paint batch laborHours must match item.durations.paint (3.38h)');
assert.equal(task4.rawContributionHours, 3.38);
assert.equal(task4.sourceLaborHours, 3.5, 'Raw labor hours = 2h + 1.5h = 3.5h');
assert.deepEqual(toPlain(task4.elements.sort()), ['Malle AR', 'Pare-chocs AR'].sort());
assert.deepEqual(toPlain(task4.sourceLineIds.sort()), ['line-3', 'line-5'].sort());
assert.equal(task4.requiredRole, 'peintre');
assert.equal(task4.equipmentRole, 'cabine');

// Tasks 5-7: Reassembly tasks
const task5 = derivedTasks[4];
assert.equal(task5.id, 'task-op|case-asma-1|claim-asma-1|line-1|reassembly');
assert.equal(task5.kind, 'operation');
assert.equal(task5.phase, 'reassembly');
assert.equal(task5.laborHours, 6.0);
assert.deepEqual(toPlain(task5.elements), ['Lunette AR']);
assert.equal(task5.requiredRole, 'tolier');

const task6 = derivedTasks[5];
assert.equal(task6.id, 'task-op|case-asma-1|claim-asma-1|line-2|reassembly');
assert.equal(task6.kind, 'operation');
assert.equal(task6.phase, 'reassembly');
assert.equal(task6.laborHours, 1.5);
assert.deepEqual(toPlain(task6.elements), ['Malle AR']);

const task7 = derivedTasks[6];
assert.equal(task7.id, 'task-op|case-asma-1|claim-asma-1|line-4|reassembly');
assert.equal(task7.kind, 'operation');
assert.equal(task7.phase, 'reassembly');
assert.equal(task7.laborHours, 1.25);
assert.deepEqual(toPlain(task7.elements), ['Pare-chocs AR']);

// Exact duration conservation invariant:
const taskDurationSum = Number(derivedTasks.reduce((sum, t) => sum + t.laborHours, 0).toFixed(2));
assert.equal(taskDurationSum, totalCaseDuration, 'Sum of all task laborHours must exactly match total case durations');

// 4. Multi-Zone Paint Mutualization & Quality Exclusion
console.log('Test 4: Multi-zone paint batch mutualization alignment & quality exclusion');
const multiZoneCase = {
  id: 'case-multi-zone',
  durations: {},
  claims: [
    {
      id: 'claim-mz-1',
      type: 'client',
      estimate: {
        originalLines: [
          { id: 'line-f', operation: 'PEINTURE ET FINITION PARE CHOC AV', laborHours: 3, selectedPhases: ['paint'] },
          { id: 'line-r', operation: 'PEINTURE ET FINITION MALLE AR', laborHours: 4, selectedPhases: ['paint'] },
        ],
      },
    },
  ],
};
win.recomputeCaseDurationsFromClaims(multiZoneCase);

// Authoritative optimizer check: Front (3.0h) + Rear (4.0h * 1.5 = 6.0h) -> 6.0 + 3.0 * 0.40 = 7.20h
assert.equal(multiZoneCase.durations.paint, 7.20, 'Production optimizer produces 7.20h for multi-zone paint');

const mzTasks = win.deriveCanonicalPlanningTasks(multiZoneCase);
const mzPaintBatches = mzTasks.filter((t) => t.kind === 'paint_batch');
assert.equal(mzPaintBatches.length, 1, 'Multi-zone paint must derive exactly ONE authoritative global paint_batch');

const globalPaintBatch = mzPaintBatches[0];
assert.equal(globalPaintBatch.id, 'task-batch-paint-global|case-multi-zone');
assert.equal(globalPaintBatch.title, 'PEINTURE + VERNIS — LOT GLOBAL');
assert.equal(globalPaintBatch.phase, 'paint');
assert.equal(globalPaintBatch.laborHours, multiZoneCase.durations.paint, 'Global paint batch laborHours must match item.durations.paint');
assert.equal(globalPaintBatch.laborHours, 7.20);
assert.equal(globalPaintBatch.rawContributionHours, 9.0, 'rawContributionHours is sum of group totals (3.0 + 6.0 = 9.0h) before inter-group mutualization');
assert.notEqual(globalPaintBatch.rawContributionHours, globalPaintBatch.laborHours, 'rawContributionHours must not be overwritten with final duration');
assert.equal(globalPaintBatch.sourceLaborHours, 7.0, 'Raw source hours sum must be 3 + 4 = 7h');
assert.equal(globalPaintBatch.bodyZone, 'general');
assert.deepEqual(toPlain(globalPaintBatch.bodyZones), ['front', 'rear'], 'bodyZones must be sorted deterministically');
assert.deepEqual(toPlain(globalPaintBatch.elements), ['Malle AR', 'Pare-chocs AV'], 'elements must be sorted deterministically');
assert.deepEqual(toPlain(globalPaintBatch.sourceLineIds), ['line-f', 'line-r'], 'sourceLineIds must be sorted deterministically');
assert.equal(globalPaintBatch.requiredRole, 'peintre');
assert.equal(globalPaintBatch.equipmentRole, 'cabine');
assert.equal(globalPaintBatch.vehicleExclusive, true);
assert.equal(globalPaintBatch.taskModelVersion, 1);

assert.equal(globalPaintBatch.paintGroups.length, 2, 'paintGroups must contain breakdown for each zone');
assert.deepEqual(toPlain(globalPaintBatch.paintGroups), [
  {
    zone: 'front',
    rawContributionHours: 3.0,
    elements: ['Pare-chocs AV'],
    sourceLineIds: ['line-f'],
  },
  {
    zone: 'rear',
    rawContributionHours: 6.0,
    elements: ['Malle AR'],
    sourceLineIds: ['line-r'],
  },
], 'paintGroups nested metadata must be sorted deterministically by zone');

// Invariant: sum of task laborHours equals total case durations
const mzTotalHours = Number(mzTasks.reduce((sum, t) => sum + t.laborHours, 0).toFixed(2));
assert.equal(mzTotalHours, sumAllProductiveCaseDurations(multiZoneCase), 'Multi-zone total task hours must equal sumAllProductiveCaseDurations');

// Determinism on multi-zone
const mzRun1 = win.deriveCanonicalPlanningTasks(multiZoneCase);
const mzRun2 = win.deriveCanonicalPlanningTasks(multiZoneCase);
assert.deepEqual(toPlain(mzRun1), toPlain(mzRun2), 'Multi-zone derivation must be 100% deterministic');
const mzCloned = JSON.parse(JSON.stringify(multiZoneCase));
const mzRunCloned = win.deriveCanonicalPlanningTasks(mzCloned);
assert.deepEqual(toPlain(mzRun1), toPlain(mzRunCloned), 'Deep cloned multi-zone case must produce identical tasks');

// Determinism of nested metadata under input line reordering
const caseReorderedLines = {
  id: 'case-multi-zone',
  durations: {},
  claims: [
    {
      id: 'claim-mz-1',
      type: 'client',
      estimate: {
        originalLines: [
          { id: 'line-r', operation: 'PEINTURE ET FINITION MALLE AR', laborHours: 4, selectedPhases: ['paint'] },
          { id: 'line-f', operation: 'PEINTURE ET FINITION PARE CHOC AV', laborHours: 3, selectedPhases: ['paint'] },
        ],
      },
    },
  ],
};
win.recomputeCaseDurationsFromClaims(caseReorderedLines);
const mzTasksReordered = win.deriveCanonicalPlanningTasks(caseReorderedLines);
assert.deepEqual(toPlain(mzTasks), toPlain(mzTasksReordered), 'Canonical tasks and nested metadata must be identical when lines are reordered');

// Determinism under claim reordering
const multiClaimCaseA = {
  id: 'case-mc',
  durations: {},
  claims: [
    { id: 'claim-1', estimate: { originalLines: [{ id: 'line-1', operation: 'PEINTURE CAPOT', laborHours: 2, selectedPhases: ['paint'] }] } },
    { id: 'claim-2', estimate: { originalLines: [{ id: 'line-2', operation: 'PEINTURE MALLE AR', laborHours: 2, selectedPhases: ['paint'] }] } },
  ],
};
const multiClaimCaseB = {
  id: 'case-mc',
  durations: {},
  claims: [
    { id: 'claim-2', estimate: { originalLines: [{ id: 'line-2', operation: 'PEINTURE MALLE AR', laborHours: 2, selectedPhases: ['paint'] }] } },
    { id: 'claim-1', estimate: { originalLines: [{ id: 'line-1', operation: 'PEINTURE CAPOT', laborHours: 2, selectedPhases: ['paint'] }] } },
  ],
};
win.recomputeCaseDurationsFromClaims(multiClaimCaseA);
win.recomputeCaseDurationsFromClaims(multiClaimCaseB);
const mcTasksA = win.deriveCanonicalPlanningTasks(multiClaimCaseA);
const mcTasksB = win.deriveCanonicalPlanningTasks(multiClaimCaseB);
assert.deepEqual(toPlain(mcTasksA), toPlain(mcTasksB), 'Tasks and nested metadata must be identical when claims are reordered');

// Baseline Optimizer Coefficients Regression Validation
console.log('Test 4b: Baseline optimizer intra-group (0.25) and inter-group (0.40) coefficient regression');
// Intra-group test: 2 elements in same zone (rear)
const intraGroupLines = [
  { id: 'ig-1', operation: 'PEINTURE ET FINITION MALLE AR', laborHours: 4, selectedPhases: ['paint'] }, // two_sides => 4 * 1.5 = 6.0h
  { id: 'ig-2', operation: 'PEINTURE ET FINITION PARE CHOC AR', laborHours: 2, selectedPhases: ['paint'] }, // outside => 2 * 1.0 = 2.0h
];
const optIntra = win.optimizeEstimateAllocationsFromOriginalLines(intraGroupLines);
assert.equal(optIntra.paintOptimization.length, 1);
// Intra-group formula: max(6.0) + others(2.0) * 0.25 = 6.0 + 0.5 = 6.5h
assert.equal(optIntra.paintOptimization[0].total, 6.5, 'Intra-group coefficient must be strictly 0.25');

// Inter-group test: 2 zones (rear: 6.5h, front: 3.0h)
const interGroupLines = [
  { id: 'ig-1', operation: 'PEINTURE ET FINITION MALLE AR', laborHours: 4, selectedPhases: ['paint'] }, // rear: 6.0h
  { id: 'ig-2', operation: 'PEINTURE ET FINITION PARE CHOC AR', laborHours: 2, selectedPhases: ['paint'] }, // rear: 2.0h -> rear total = 6.5h
  { id: 'ig-3', operation: 'PEINTURE ET FINITION PARE CHOC AV', laborHours: 3, selectedPhases: ['paint'] }, // front: 3.0h -> front total = 3.0h
];
const optInter = win.optimizeEstimateAllocationsFromOriginalLines(interGroupLines);
assert.equal(optInter.paintOptimization.length, 2);
// Inter-group formula: largest(6.5) + others(3.0) * 0.40 = 6.5 + 1.2 = 7.7h
assert.equal(optInter.totals.paint, 7.7, 'Inter-group coefficient must be strictly 0.40');

// Quality Exclusion Test: Quality phase lines must NOT derive unit operation tasks
const qualityCase = {
  id: 'case-quality-check',
  durations: {},
  claims: [
    {
      id: 'claim-q',
      estimate: {
        originalLines: [
          { id: 'line-q1', operation: 'CONTROLE QUALITE FINAL', laborHours: 1.5, selectedPhases: ['quality'] },
          { id: 'line-q2', operation: 'D/P CAPOT AVANT', laborHours: 2, selectedPhases: ['body'] },
        ],
      },
    },
  ],
};
win.recomputeCaseDurationsFromClaims(qualityCase);
const qTasks = win.deriveCanonicalPlanningTasks(qualityCase);
assert.equal(qTasks.length, 1, 'Quality line must NOT generate a unit task; only body task generated');
assert.equal(qTasks[0].phase, 'body');
assert.equal(qTasks[0].id, 'task-op|case-quality-check|claim-q|line-q2|body');
assert.ok(!qTasks.some((t) => t.phase === 'quality'), 'Quality phase must not generate unit task');

// 5. Fallback B: Applied lines fallback
console.log('Test 5: Fallback B - Applied estimate lines');
const fallbackBCase = {
  id: 'case-fb-b',
  durations: { body: 2, prep: 1.5, paint: 1 },
  claims: [
    {
      id: 'claim-b',
      estimate: {
        lines: [
          { id: 'app-1', phase: 'body', operation: 'Redressage aile', laborHours: 2 },
          { id: 'app-2', phase: 'prep', operation: 'Préparation aile', laborHours: 1.5, paintGroup: 'left' },
          { id: 'app-3', phase: 'paint', operation: 'Peinture aile', laborHours: 1, paintGroup: 'left' },
        ],
      },
    },
  ],
};
const fbBTasks = win.deriveCanonicalPlanningTasks(fallbackBCase);
assert.equal(fbBTasks.length, 3);
assert.equal(fbBTasks[0].sourceKind, 'applied_estimate');
assert.equal(fbBTasks[0].kind, 'operation');
assert.equal(fbBTasks[1].kind, 'preparation_batch');
assert.equal(fbBTasks[2].kind, 'paint_batch');

assert.equal(Number(fbBTasks.reduce((s, t) => s + t.laborHours, 0).toFixed(2)), sumAllProductiveCaseDurations(fallbackBCase));

// 6. Fallback C: Generic phase steps
console.log('Test 6: Fallback C - Legacy durations generic steps');
const fallbackCCase = {
  id: 'case-fb-c',
  durations: { body: 4, prep: 2, paint: 2, mechanical: 1 },
  claims: [],
};
const fbCTasks = win.deriveCanonicalPlanningTasks(fallbackCCase);
assert.equal(fbCTasks.length, 4);
fbCTasks.forEach((t) => {
  assert.equal(t.kind, 'legacy_step');
  assert.equal(t.sourceKind, 'legacy_duration_fallback');
  assert.equal(t.taskModelVersion, 1);
});
assert.equal(fbCTasks[0].phase, 'body');
assert.equal(fbCTasks[0].laborHours, 4);
assert.equal(fbCTasks[1].phase, 'mechanical');
assert.equal(fbCTasks[1].laborHours, 1);
assert.equal(fbCTasks[2].phase, 'prep');
assert.equal(fbCTasks[2].laborHours, 2);
assert.equal(fbCTasks[3].phase, 'paint');
assert.equal(fbCTasks[3].laborHours, 2);
assert.equal(Number(fbCTasks.reduce((s, t) => s + t.laborHours, 0).toFixed(2)), sumAllProductiveCaseDurations(fallbackCCase));

// 5b. Mixed Provenance: Claim A (original lines) + Claim B (applied lines)
console.log('Test 5b: Mixed Provenance - Claim A (originalLines) + Claim B (applied lines)');
const mixedCase = {
  id: 'case-mixed-provenance',
  durations: {},
  claims: [
    {
      id: 'claim-mixed-a',
      estimate: {
        originalLines: [
          { id: 'line-ma-1', operation: 'D/P MALLE AR', laborHours: 2, selectedPhases: ['body'] },
          { id: 'line-ma-2', operation: 'PEINTURE MALLE AR', laborHours: 3, selectedPhases: ['prep', 'paint'] },
        ],
      },
    },
    {
      id: 'claim-mixed-b',
      estimate: {
        lines: [
          { id: 'app-mb-1', phase: 'mechanical', operation: 'CONTROLE GEOMETRIE', laborHours: 1.5 },
          { id: 'app-mb-2', phase: 'reassembly', operation: 'REPOSE BOUCLIER', laborHours: 1.0 },
        ],
      },
    },
  ],
};
win.recomputeCaseDurationsFromClaims(mixedCase);
const mixedTasks = win.deriveCanonicalPlanningTasks(mixedCase);

// Check that tasks contain operations from both Claim A and Claim B
assert.ok(mixedTasks.some((t) => t.sourceClaimIds.includes('claim-mixed-a') && t.phase === 'body'), 'Body task from Claim A');
assert.ok(mixedTasks.some((t) => t.sourceClaimIds.includes('claim-mixed-a') && t.phase === 'prep'), 'Prep batch from Claim A');
assert.ok(mixedTasks.some((t) => t.sourceClaimIds.includes('claim-mixed-a') && t.phase === 'paint'), 'Paint batch from Claim A');
assert.ok(mixedTasks.some((t) => t.sourceClaimIds.includes('claim-mixed-b') && t.phase === 'mechanical'), 'Mechanical task from Claim B');
assert.ok(mixedTasks.some((t) => t.sourceClaimIds.includes('claim-mixed-b') && t.phase === 'reassembly'), 'Reassembly task from Claim B');

// Invariant: sum of task laborHours equals total case durations across all phases
const mixedTotalHours = Number(mixedTasks.reduce((sum, t) => sum + t.laborHours, 0).toFixed(2));
assert.equal(mixedTotalHours, sumAllProductiveCaseDurations(mixedCase), 'Mixed provenance total task hours must equal sumAllProductiveCaseDurations');

// Determinism on mixed case
const mixedRun1 = win.deriveCanonicalPlanningTasks(mixedCase);
const mixedRun2 = win.deriveCanonicalPlanningTasks(mixedCase);
assert.deepEqual(toPlain(mixedRun1), toPlain(mixedRun2), 'Mixed provenance derivation must be 100% deterministic');

// Determinism under claim reordering on mixed case
const mixedCaseReorderedClaims = {
  id: 'case-mixed-provenance',
  durations: {},
  claims: [
    mixedCase.claims[1],
    mixedCase.claims[0],
  ],
};
win.recomputeCaseDurationsFromClaims(mixedCaseReorderedClaims);
const mixedReorderedTasks = win.deriveCanonicalPlanningTasks(mixedCaseReorderedClaims);
assert.deepEqual(toPlain(mixedTasks), toPlain(mixedReorderedTasks), 'Mixed provenance must be identical regardless of claim ordering');

// 5c. Multi-Claim Paint Semantics
console.log('Test 5c: Multi-Claim Paint Semantics (Two claims with paint operations)');
const multiClaimPaintCase = {
  id: 'case-mc-paint',
  durations: {},
  claims: [
    {
      id: 'claim-p1',
      estimate: {
        originalLines: [
          { id: 'line-p1', operation: 'PEINTURE MALLE AR', laborHours: 4, selectedPhases: ['paint'] },
        ],
      },
    },
    {
      id: 'claim-p2',
      estimate: {
        originalLines: [
          { id: 'line-p2', operation: 'PEINTURE PARE CHOC AV', laborHours: 3, selectedPhases: ['paint'] },
        ],
      },
    },
  ],
};
win.recomputeCaseDurationsFromClaims(multiClaimPaintCase);
const mcPaintTasks = win.deriveCanonicalPlanningTasks(multiClaimPaintCase);
const mcGlobalPaint = mcPaintTasks.find((t) => t.kind === 'paint_batch');
assert.ok(mcGlobalPaint, 'Global paint batch must exist for multi-claim multi-zone paint');
assert.deepEqual(toPlain(mcGlobalPaint.sourceClaimIds), ['claim-p1', 'claim-p2'], 'Global paint batch must link both contributing claims');
assert.equal(mcGlobalPaint.laborHours, multiClaimPaintCase.durations.paint, 'Global paint laborHours matches authoritative case paint duration');
const mcPaintTotalHours = Number(mcPaintTasks.reduce((sum, t) => sum + t.laborHours, 0).toFixed(2));
assert.equal(mcPaintTotalHours, sumAllProductiveCaseDurations(multiClaimPaintCase), 'Multi-claim paint duration conservation');

// 5d. Finish Residual Legacy Step Rule
console.log('Test 5d: Finish residual legacy step rule (item.durations.finish > 0)');
const finishCase = {
  id: 'case-finish-residual',
  durations: { body: 2, finish: 1.5 },
  claims: [
    {
      id: 'claim-f1',
      estimate: {
        originalLines: [
          { id: 'line-f1', operation: 'D/P CAPOT', laborHours: 2, selectedPhases: ['body'] },
        ],
      },
    },
  ],
};
const finishTasks = win.deriveCanonicalPlanningTasks(finishCase);
const finishTask = finishTasks.find((t) => t.phase === 'finish');
assert.ok(finishTask, 'Legacy residual finish task must be generated');
assert.equal(finishTask.id, 'task-legacy-residual|case-finish-residual|finish');
assert.equal(finishTask.kind, 'legacy_step');
assert.equal(finishTask.sourceKind, 'legacy_duration_fallback');
assert.equal(finishTask.laborHours, 1.5);
assert.deepEqual(toPlain(finishTask.sourceLineIds), []);
assert.deepEqual(toPlain(finishTask.sourceOperations), []);
assert.equal(Number(finishTasks.reduce((sum, t) => sum + t.laborHours, 0).toFixed(2)), sumAllProductiveCaseDurations(finishCase));

// 5e. Quality Residual Legacy Step Rule
console.log('Test 5e: Quality residual legacy step rule (item.durations.quality > 0)');
const qualityResidualCase = {
  id: 'case-quality-residual',
  durations: { body: 3, quality: 1.0 },
  claims: [
    {
      id: 'claim-q1',
      estimate: {
        originalLines: [
          { id: 'line-qr-1', operation: 'D/P AILE ARD', laborHours: 3, selectedPhases: ['body'] },
          { id: 'line-qr-2', operation: 'CONTROLE QUALITE FINAL', laborHours: 1.0, selectedPhases: ['quality'] },
        ],
      },
    },
  ],
};
const qualityResidualTasks = win.deriveCanonicalPlanningTasks(qualityResidualCase);
// Estimate line line-qr-2 is excluded from unit tasks
assert.ok(!qualityResidualTasks.some((t) => t.sourceLineIds.includes('line-qr-2')), 'Estimate line for quality excluded from unit tasks');
// But dossier-level quality is reconciled as a residual legacy step
const qualityTask = qualityResidualTasks.find((t) => t.phase === 'quality');
assert.ok(qualityTask, 'Quality residual legacy step must be generated');
assert.equal(qualityTask.id, 'task-legacy-residual|case-quality-residual|quality');
assert.equal(qualityTask.kind, 'legacy_step');
assert.equal(qualityTask.sourceKind, 'legacy_duration_fallback');
assert.equal(qualityTask.laborHours, 1.0);
assert.deepEqual(toPlain(qualityTask.sourceLineIds), []);
assert.equal(Number(qualityResidualTasks.reduce((sum, t) => sum + t.laborHours, 0).toFixed(2)), sumAllProductiveCaseDurations(qualityResidualCase));

// 5f. Static Code Analysis Guard
console.log('Test 5f: Static Code Analysis Guard - No duplicate paint formula in deriveCanonicalPlanningTasks');
const brSource = fs.readFileSync('js/business-rules-v2187.js', 'utf8');
const deriveMatch = brSource.match(/function deriveCanonicalPlanningTasks\([\s\S]*?\n  \}/);
assert.ok(deriveMatch, 'deriveCanonicalPlanningTasks function must be found in source');
const deriveCode = deriveMatch[0];
assert.ok(!deriveCode.includes('* 0.25'), 'deriveCanonicalPlanningTasks must NOT contain "* 0.25"');
assert.ok(!deriveCode.includes('* 0.4'), 'deriveCanonicalPlanningTasks must NOT contain "* 0.4"');
assert.ok(!deriveCode.includes('* 0.40'), 'deriveCanonicalPlanningTasks must NOT contain "* 0.40"');
assert.ok(!deriveCode.match(/\b0\.25\b/), 'deriveCanonicalPlanningTasks must NOT contain literal 0.25');
assert.ok(!deriveCode.match(/\b0\.40?\b/), 'deriveCanonicalPlanningTasks must NOT contain literal 0.4 or 0.40');
console.log('Static code guard passed: deriveCanonicalPlanningTasks contains zero duplicate paint coefficients!');

// 5g. Micro-Labor Regression (Exact minutes, zero 15-minute clamp)
console.log('Test 5g: Micro-labor exact minutes (no 15-minute canonical clamp)');
const microLaborCase = {
  id: 'case-micro-labor',
  durations: { body: 0.30, prep: 0.20 },
  claims: [
    {
      id: 'claim-micro',
      type: 'client',
      estimate: {
        originalLines: [
          { id: 'm-line-1', operation: 'CONTROLE JEU AILE 1', laborHours: 0.10, selectedPhases: ['body'] },
          { id: 'm-line-2', operation: 'CONTROLE JEU AILE 2', laborHours: 0.10, selectedPhases: ['body'] },
          { id: 'm-line-3', operation: 'CONTROLE JEU AILE 3', laborHours: 0.10, selectedPhases: ['body'] },
          { id: 'm-line-4', operation: 'NETTOYAGE SURFACE AVANT 1', laborHours: 0.10, selectedPhases: ['prep'], paintGroup: 'front', bodyZone: 'front' },
          { id: 'm-line-5', operation: 'NETTOYAGE SURFACE AVANT 2', laborHours: 0.10, selectedPhases: ['prep'], paintGroup: 'front', bodyZone: 'front' },
        ],
      },
    },
  ],
};
const microTasks = win.deriveCanonicalPlanningTasks(microLaborCase);
const bodyTasks = microTasks.filter((t) => t.phase === 'body');
assert.equal(bodyTasks.length, 3);
bodyTasks.forEach((t) => {
  assert.equal(t.laborHours, 0.10);
  assert.equal(t.durationMinutes, 6, '0.10h must convert faithfully to 6 minutes, NOT 15 minutes');
});
const totalBodyMinutes = bodyTasks.reduce((sum, t) => sum + t.durationMinutes, 0);
assert.equal(totalBodyMinutes, 18, 'Total body minutes must be 6 + 6 + 6 = 18 minutes, NOT 45 minutes');

const prepBatch = microTasks.find((t) => t.kind === 'preparation_batch');
assert.ok(prepBatch);
assert.equal(prepBatch.laborHours, 0.20);
assert.equal(prepBatch.durationMinutes, 12, '0.20h preparation batch must convert to 12 minutes, NOT 15 minutes');

// 5h. Static Code Guard - Zero 15-minute clamp in deriveCanonicalPlanningTasks and domain helpers
console.log('Test 5h: Static Code Guard - Zero 15-minute clamp in canonical domain code');
const brSourcePhase24 = fs.readFileSync('js/business-rules-v2187.js', 'utf8');
const domainSectionMatch = brSourcePhase24.match(/function canonicalLaborMinutes[\s\S]*?\n  function getCasePlanningTasks/);
assert.ok(domainSectionMatch, 'canonical domain section must be found in business-rules-v2187.js');
const domainCode = domainSectionMatch[0];
assert.ok(!domainCode.includes('Math.max(15'), 'Canonical domain code must NOT contain "Math.max(15"');
assert.ok(!domainCode.match(/Math\.max\(\s*15\b/), 'Canonical domain code must NOT contain Math.max(15');
assert.ok(!domainCode.includes('15,'), 'Canonical domain code must NOT contain clamp minimum 15');
console.log('Static code guard passed: canonical domain code contains zero 15-minute clamp logic!');

// 5i. Static Code Guard - Zero localeCompare in deriveCanonicalPlanningTasks and domain helpers
console.log('Test 5i: Static Code Guard - Zero localeCompare in canonical domain code');
assert.ok(!domainCode.includes('localeCompare'), 'Canonical domain code must NOT contain "localeCompare"');
console.log('Static code guard passed: canonical domain code contains zero localeCompare usage!');

// 7. Determinism & Idempotency
console.log('Test 7: Determinism & Idempotency');
const run1 = win.deriveCanonicalPlanningTasks(asmaCase);
const run2 = win.deriveCanonicalPlanningTasks(asmaCase);
assert.deepEqual(toPlain(run1), toPlain(run2), 'Derivation must be 100% deterministic on repeat calls');

const clonedCase = JSON.parse(JSON.stringify(asmaCase));
const runCloned = win.deriveCanonicalPlanningTasks(clonedCase);
assert.deepEqual(toPlain(run1), toPlain(runCloned), 'Deep cloned case must produce identical canonical tasks');

// 7b. Cross-Runtime Deterministic Unicode Sorting
console.log('Test 7b: Cross-Runtime Deterministic Unicode Sorting');
const unicodeTerms = ['AILE', 'ÉLARGISSEUR', 'PRÉPARATION', 'PARE-CHOCS', 'ÉQUIPEMENT', 'ZÉRO'];
const stableSorted = [...unicodeTerms].sort(win.compareStableText);
const expectedCodePointOrder = ['AILE', 'PARE-CHOCS', 'PRÉPARATION', 'ZÉRO', 'ÉLARGISSEUR', 'ÉQUIPEMENT'];
assert.deepEqual(stableSorted, expectedCodePointOrder, 'compareStableText must sort in strict code-point order regardless of host locale');

function makeUnicodeCase(elementsOrder) {
  return {
    id: 'case-unicode',
    durations: {},
    claims: [
      {
        id: 'claim-u',
        type: 'client',
        estimate: {
          originalLines: elementsOrder.map((elem, i) => ({
            id: `u-line-${elem}`,
            operation: `REMPLACEMENT ${elem}`,
            laborHours: 1,
            selectedPhases: ['body'],
          })),
        },
      },
    ],
  };
}

const uCase1 = makeUnicodeCase(['ÉQUIPEMENT', 'AILE', 'ZÉRO', 'ÉLARGISSEUR', 'PARE-CHOCS', 'PRÉPARATION']);
const uCase2 = makeUnicodeCase(['PRÉPARATION', 'ÉLARGISSEUR', 'PARE-CHOCS', 'AILE', 'ÉQUIPEMENT', 'ZÉRO']);
const uTasks1 = win.deriveCanonicalPlanningTasks(uCase1);
const uTasks2 = win.deriveCanonicalPlanningTasks(uCase2);
assert.deepEqual(toPlain(uTasks1), toPlain(uTasks2), 'Unicode tasks must be 100% deterministic regardless of input line ordering');

const uCloned = JSON.parse(JSON.stringify(uCase1));
const uTasksCloned = win.deriveCanonicalPlanningTasks(uCloned);
assert.deepEqual(toPlain(uTasks1), toPlain(uTasksCloned), 'Deep cloned Unicode case must produce identical tasks');

// 8. XSS Payload Safety
console.log('Test 8: XSS payload safety');
const xssPayloads = [
  '<script>alert("xss")</script>',
  '<img src=x onerror=alert(1)>',
  '"><svg/onload=alert(1)>',
  '<iframe src="javascript:alert(1)"></iframe>',
];
xssPayloads.forEach((payload, idx) => {
  const xssCase = {
    id: `case-xss-${idx}`,
    claims: [
      {
        id: `claim-xss-${idx}`,
        estimate: {
          originalLines: [
            { id: `xss-line-${idx}`, operation: `D/P MALLE AR ${payload}`, laborHours: 2, selectedPhases: ['body'] },
          ],
        },
      },
    ],
  };
  const xssTasks = win.deriveCanonicalPlanningTasks(xssCase);
  assert.equal(xssTasks.length, 1);
  assert.ok(xssTasks[0].title.includes(payload), 'Payload must be preserved verbatim as raw string');
  assert.ok(!xssTasks[0].title.includes('<executed>'));
});

// 9. State Normalization and Persistence Survival
console.log('Test 9: State normalization and persistence survival');
const normalizeState = (s) => vm.runInContext('normalizeState', context)(s);
const testState = normalizeState({
  cases: [
    {
      id: 'case-state-1',
      planningTasks: derivedTasks,
      durations: asmaCase.durations,
    },
  ],
});
const preservedTasks = testState.cases[0].planningTasks;
assert.equal(preservedTasks.length, 7);
assert.equal(preservedTasks[0].kind, 'operation');
assert.equal(preservedTasks[2].kind, 'preparation_batch');
assert.equal(preservedTasks[3].kind, 'paint_batch');
assert.deepEqual(toPlain(preservedTasks[2].elements.sort()), ['Malle AR', 'Pare-chocs AR'].sort());

const reNormalizedState = normalizeState(testState);
assert.deepEqual(toPlain(reNormalizedState.cases[0].planningTasks), toPlain(preservedTasks), 'Idempotent state normalization');

// Strict kind normalization tests
const normalizeTask = (t) => vm.runInContext('normalizeCasePlanningTask', context)(t);

// 1. Valid kinds survive:
assert.equal(normalizeTask({ id: 't-1', kind: 'operation' }).kind, 'operation');
assert.equal(normalizeTask({ id: 't-2', kind: 'preparation_batch' }).kind, 'preparation_batch');
assert.equal(normalizeTask({ id: 't-3', kind: 'paint_batch' }).kind, 'paint_batch');
assert.equal(normalizeTask({ id: 't-4', kind: 'legacy_step' }).kind, 'legacy_step');

// 2. Invalid kinds do NOT survive (deleted/undefined):
const invalidTask1 = normalizeTask({ id: 't-5', kind: 'invalid_random_kind' });
assert.strictEqual(invalidTask1.kind, undefined, 'Invalid task kind must not survive normalization');

const invalidTask2 = normalizeTask({ id: 't-6', kind: 'bogus' });
assert.strictEqual(invalidTask2.kind, undefined, 'Invalid task kind "bogus" must be deleted');

// 3. Empty or missing kinds do NOT create arbitrary values:
const emptyKindTask = normalizeTask({ id: 't-7', kind: '' });
assert.strictEqual(emptyKindTask.kind, undefined, 'Empty task kind must not create arbitrary value');

const nullKindTask = normalizeTask({ id: 't-8', kind: null });
assert.strictEqual(nullKindTask.kind, undefined, 'Null task kind must not create arbitrary value');

const noKindTask = normalizeTask({ id: 't-9' });
assert.strictEqual(noKindTask.kind, undefined, 'Missing task kind must remain undefined');

// 10. Planner Safety Guard
console.log('Test 10: Planner safety - empty planningTasks not auto-injected');
const untouchedCase = {
  id: 'case-clean',
  durations: { body: 2 },
};
const normalizedCleanCase = normalizeState({ cases: [untouchedCase] }).cases[0];
assert.ok(!normalizedCleanCase.planningTasks || normalizedCleanCase.planningTasks.length === 0,
  'normalizeState MUST NOT auto-populate case.planningTasks so sequential planner is not disrupted');

// getCasePlanningTasks lazy access
const lazyTasks = win.getCasePlanningTasks(asmaCase);
assert.equal(lazyTasks.length, 7);
assert.ok(!asmaCase.planningTasks, 'getCasePlanningTasks must not mutate case.planningTasks implicitly');

// 11. Performance Benchmark (10, 30, 60, 100 lines)
console.log('Test 11: Performance benchmark');
function generateSyntheticCase(lineCount) {
  const operations = [
    { op: 'REPOSE LUNETTE AR', hours: 2, phases: ['reassembly'] },
    { op: 'D/P ET PREPARATION MALLE AR', hours: 3, phases: ['body', 'reassembly'] },
    { op: 'PEINTURE ET FINITION MALLE AR', hours: 4, phases: ['prep', 'paint'] },
    { op: 'D/P ET PREPARATION PARE CHOC AV', hours: 2.5, phases: ['body', 'reassembly'] },
    { op: 'PEINTURE ET FINITION PARE CHOC AV', hours: 3.5, phases: ['prep', 'paint'] },
    { op: 'REMPLACEMENT AILE AVD', hours: 2, phases: ['body'] },
    { op: 'CONTROLE GEOMETRIE TRAIN AVANT', hours: 1, phases: ['mechanical'] },
  ];
  const lines = [];
  for (let i = 0; i < lineCount; i++) {
    const template = operations[i % operations.length];
    lines.push({
      id: `bench-line-${i + 1}`,
      operation: `${template.op} (${i + 1})`,
      laborHours: template.hours,
      selectedPhases: template.phases,
    });
  }
  return {
    id: `case-bench-${lineCount}`,
    durations: {},
    claims: [{ id: 'claim-bench', estimate: { originalLines: lines } }],
  };
}

const benchmarkSizes = [10, 30, 60, 100];
const benchResults = {};

benchmarkSizes.forEach((size) => {
  const benchCase = generateSyntheticCase(size);
  win.recomputeCaseDurationsFromClaims(benchCase);
  const iterations = 50;
  const runtimes = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const tasks = win.deriveCanonicalPlanningTasks(benchCase);
    const end = performance.now();
    assert.ok(tasks.length > 0);
    runtimes.push(end - start);
  }

  runtimes.sort((a, b) => a - b);
  const median = runtimes[Math.floor(iterations / 2)].toFixed(4);
  const max = Math.max(...runtimes).toFixed(4);
  benchResults[size] = { medianMs: Number(median), maxMs: Number(max) };
  console.log(`Benchmark ${size} lines: median = ${median} ms, max = ${max} ms`);
  assert.ok(Number(max) < 15, `Benchmark ${size} lines max runtime (${max}ms) must be strictly < 15ms`);
  assert.ok(Number(median) < 15, `Benchmark ${size} lines median runtime (${median}ms) must be strictly < 15ms`);
});
console.log('All benchmarks strictly asserted under 15ms threshold!');

// 12. Collision-Safe Canonical Task IDs Regression Test
console.log('Test 12: Collision-safe canonical task IDs regression test');
// Scenario A: Hyphenated parts collision safety
const colId1 = win.buildCanonicalTaskId('op', 'case-1', 'a-b', 'c', 'body');
const colId2 = win.buildCanonicalTaskId('op', 'case-1', 'a', 'b-c', 'body');
assert.notEqual(colId1, colId2, 'Hyphenated IDs must never collide');
assert.equal(colId1, 'task-op|case-1|a-b|c|body');
assert.equal(colId2, 'task-op|case-1|a|b-c|body');

// Scenario B: Pipe characters in component payloads are percent-encoded
const colIdPipe1 = win.buildCanonicalTaskId('op', 'case-1', 'a|b', 'c', 'body');
const colIdPipe2 = win.buildCanonicalTaskId('op', 'case-1', 'a', 'b|c', 'body');
assert.notEqual(colIdPipe1, colIdPipe2, 'Pipe-containing IDs must encode safely and not collide');
assert.equal(colIdPipe1, 'task-op|case-1|a%7Cb|c|body');
assert.equal(colIdPipe2, 'task-op|case-1|a|b%7Cc|body');

// Scenario C: Operation task vs legacy residual task collision safety
const opId = win.buildCanonicalTaskId('op', 'case-1', 'legacy', 'residual', 'finish');
const resId = win.buildCanonicalTaskId('legacy-residual', 'case-1', 'finish');
assert.notEqual(opId, resId, 'Operation task and residual legacy task must have distinct categories');
assert.equal(opId, 'task-op|case-1|legacy|residual|finish');
assert.equal(resId, 'task-legacy-residual|case-1|finish');

// Scenario D: Legacy fallback vs legacy residual task
const legId = win.buildCanonicalTaskId('legacy', 'case-1', 'finish');
assert.notEqual(legId, resId, 'Legacy fallback and legacy residual task must not collide');
assert.equal(legId, 'task-legacy|case-1|finish');

// 13. Mixed Source Provenance & Batch Fusion Test
console.log('Test 13: Mixed Source Provenance - Multi-claim batch fusion');
const mixedBatchCase = {
  id: 'case-mixed-batch',
  durations: {},
  claims: [
    {
      id: 'claim-orig',
      type: 'client',
      estimate: {
        originalLines: [
          { id: 'orig-p', operation: 'PREPARATION AILE AR', laborHours: 2.0, selectedPhases: ['prep'], paintGroup: 'rear', bodyZone: 'rear' },
          { id: 'orig-pt', operation: 'PEINTURE AILE AR', laborHours: 2.0, selectedPhases: ['paint'], paintGroup: 'rear', bodyZone: 'rear' },
        ],
      },
    },
    {
      id: 'claim-app',
      type: 'client',
      estimate: {
        lines: [
          { id: 'app-p', phase: 'prep', operation: 'PREPARATION MALLE AR', laborHours: 1.5, paintGroup: 'rear' },
          { id: 'app-pt', phase: 'paint', operation: 'PEINTURE MALLE AR', laborHours: 1.5, paintGroup: 'rear' },
        ],
      },
    },
  ],
};
win.recomputeCaseDurationsFromClaims(mixedBatchCase);
const mixedBatchTasks = win.deriveCanonicalPlanningTasks(mixedBatchCase);

const mPrep = mixedBatchTasks.find((t) => t.kind === 'preparation_batch');
assert.ok(mPrep, 'Preparation batch must exist');
assert.equal(mPrep.sourceKind, 'canonical_graph', 'Mixed batch must have sourceKind "canonical_graph"');
assert.deepEqual(toPlain(mPrep.sourceKinds), ['applied_estimate', 'estimate_provenance'], 'Mixed batch must declare both sourceKinds stably sorted');
assert.deepEqual(toPlain(mPrep.sourceClaimIds), ['claim-app', 'claim-orig'], 'Contributing claims must be tracked and stably sorted');
assert.equal(mPrep.laborHours, 3.5, 'Prep hours = 2.0 + 1.5 = 3.5h');

const mPaint = mixedBatchTasks.find((t) => t.kind === 'paint_batch');
assert.ok(mPaint, 'Paint batch must exist');
assert.equal(mPaint.sourceKind, 'canonical_graph', 'Mixed paint batch must have sourceKind "canonical_graph"');
assert.deepEqual(toPlain(mPaint.sourceKinds), ['applied_estimate', 'estimate_provenance'], 'Mixed paint batch must declare both sourceKinds stably sorted');
assert.deepEqual(toPlain(mPaint.sourceClaimIds), ['claim-app', 'claim-orig'], 'Contributing claims must be tracked and stably sorted');

// Total duration conservation invariant:
assert.equal(
  Number(mixedBatchTasks.reduce((s, t) => s + t.laborHours, 0).toFixed(2)),
  sumAllProductiveCaseDurations(mixedBatchCase),
  'Duration conservation invariant must hold for mixed batch fusion'
);

// 14. State Normalization of sourceKinds Array
console.log('Test 14: State normalization of sourceKinds array');
const normT1 = vm.runInContext('normalizeCasePlanningTask', context)({
  id: 'norm-t1',
  sourceKinds: ['estimate_provenance', 'applied_estimate', 'invalid_kind', 'estimate_provenance', ''],
});
assert.deepEqual(toPlain(normT1.sourceKinds), ['applied_estimate', 'estimate_provenance'], 'sourceKinds must be filtered, deduplicated, and sorted');

const normT2 = vm.runInContext('normalizeCasePlanningTask', context)({
  id: 'norm-t2',
  sourceKinds: 'not-an-array',
});
assert.strictEqual(normT2.sourceKinds, undefined, 'Invalid sourceKinds type must be ignored');

// 15. Hard Baseline Guard - Zero alterations to pre-existing business rules
console.log('Test 15: Hard Baseline Guard - Zero alterations to pre-existing business rules');
const { execSync } = await import('child_process');
const baselineSource = execSync('git show 89d50347172d08ed4cbc39dc25cd4c46872c5bcc:js/business-rules-v2187.js', { encoding: 'utf8' });
const currentSource = fs.readFileSync('js/business-rules-v2187.js', 'utf8');

// 1. Prove normalizeOriginalLineForPlanning paintGroup expression === baseline semantics
const baselineNormMatch = baselineSource.match(/function normalizeOriginalLineForPlanning[\s\S]*?\n  \}/);
const currentNormMatch = currentSource.match(/function normalizeOriginalLineForPlanning[\s\S]*?\n  \}/);
assert.ok(baselineNormMatch && currentNormMatch, 'normalizeOriginalLineForPlanning must exist in both');
assert.equal(currentNormMatch[0], baselineNormMatch[0], 'normalizeOriginalLineForPlanning must be 100% identical to baseline');
assert.ok(currentNormMatch[0].includes('const paintGroup = line?.paintGroup || inferPaintGroup(operation);'),
  'normalizeOriginalLineForPlanning paintGroup expression must match baseline semantics exactly');
assert.ok(!currentNormMatch[0].includes('bodyZone'),
  'normalizeOriginalLineForPlanning must NOT contain bodyZone');

// 2. Prove paintFactor unchanged
const baselinePaintFactorMatch = baselineSource.match(/function paintFactor[\s\S]*?\n  \}/);
const currentPaintFactorMatch = currentSource.match(/function paintFactor[\s\S]*?\n  \}/);
assert.ok(baselinePaintFactorMatch && currentPaintFactorMatch, 'paintFactor must exist in both');
assert.equal(currentPaintFactorMatch[0], baselinePaintFactorMatch[0], 'paintFactor must be 100% identical to baseline');

// 3. Prove optimizeEstimateAllocationsFromOriginalLines unchanged
const baselineOptMatch = baselineSource.match(/function optimizeEstimateAllocationsFromOriginalLines[\s\S]*?\n  \}/);
const currentOptMatch = currentSource.match(/function optimizeEstimateAllocationsFromOriginalLines[\s\S]*?\n  \}/);
assert.ok(baselineOptMatch && currentOptMatch, 'optimizeEstimateAllocationsFromOriginalLines must exist in both');
assert.equal(currentOptMatch[0], baselineOptMatch[0], 'optimizeEstimateAllocationsFromOriginalLines must be 100% identical to baseline');

// 4. Prove complete pre-existing section before WORKSHOP-001A domain block is 100% byte-identical
const marker = 'window.renderPaintOptimizationSummary = renderPaintOptimizationSummary;\n';
const baselinePreMarkerIndex = baselineSource.indexOf(marker);
const currentPreMarkerIndex = currentSource.indexOf(marker);
assert.ok(baselinePreMarkerIndex > 0 && currentPreMarkerIndex > 0, 'marker must exist in both');
const baselinePrefix = baselineSource.slice(0, baselinePreMarkerIndex + marker.length);
const currentPrefix = currentSource.slice(0, currentPreMarkerIndex + marker.length);
assert.equal(currentPrefix, baselinePrefix, 'Complete pre-existing business-rules section must be 100% byte-identical to baseline');
console.log('Hard baseline guard passed: complete pre-existing business-rules section is 100% byte-identical to baseline!');

console.log('--- ALL WORKSHOP-001A TESTS PASSED SUCCESSFULLY ---');
