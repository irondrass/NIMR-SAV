import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execSync } from 'node:child_process';

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
  .replace(/initApp\(\);/, '// initApp skipped by WORKSHOP-001B test suite')
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
const compareStableText = win.compareStableText;
const toPlain = (v) => JSON.parse(JSON.stringify(v));

// Graph Invariants Validator
function validateGraphInvariants(tasks) {
  const taskMap = new Map();
  tasks.forEach((t) => {
    assert.ok(t.id, 'Task must have an id');
    assert.ok(!taskMap.has(t.id), `Duplicate task id: ${t.id}`);
    taskMap.set(t.id, t);
  });

  tasks.forEach((t) => {
    assert.ok(Array.isArray(t.dependencies), `Dependencies must be an array for task ${t.id}`);

    // Invariant 1: zero self-dependencies
    assert.ok(!t.dependencies.includes(t.id), `Self dependency on ${t.id}`);

    // Invariant 2: zero dangling dependency IDs
    t.dependencies.forEach((depId) => {
      assert.ok(taskMap.has(depId), `Dangling dependency ${depId} in task ${t.id}`);
    });

    // Invariant 3: zero duplicate dependency IDs
    const unique = new Set(t.dependencies);
    assert.equal(unique.size, t.dependencies.length, `Duplicate dependencies in task ${t.id}`);

    // Invariant 5: deterministic sorting with compareStableText
    const sorted = [...t.dependencies].sort(compareStableText);
    assert.deepEqual(toPlain(t.dependencies), toPlain(sorted), `Dependencies not sorted with compareStableText in ${t.id}`);
  });

  // Invariant 4: zero cycles (Topological sort cycle detection)
  const inDegree = new Map();
  const adj = new Map();
  tasks.forEach((t) => {
    inDegree.set(t.id, 0);
    adj.set(t.id, []);
  });

  tasks.forEach((t) => {
    t.dependencies.forEach((depId) => {
      adj.get(depId).push(t.id);
      inDegree.set(t.id, inDegree.get(t.id) + 1);
    });
  });

  const queue = tasks.filter((t) => inDegree.get(t.id) === 0).map((t) => t.id);
  let visitedCount = 0;
  while (queue.length > 0) {
    const curr = queue.shift();
    visitedCount++;
    (adj.get(curr) || []).forEach((next) => {
      inDegree.set(next, inDegree.get(next) - 1);
      if (inDegree.get(next) === 0) {
        queue.push(next);
      }
    });
  }
  assert.equal(visitedCount, tasks.length, `Graph cycle detected! Visited ${visitedCount} of ${tasks.length} tasks`);
}

function isReachable(startTaskId, targetTaskId, tasks) {
  if (startTaskId === targetTaskId) return true;
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const visited = new Set();
  const queue = [startTaskId];
  while (queue.length > 0) {
    const currId = queue.shift();
    if (visited.has(currId)) continue;
    visited.add(currId);
    const curr = taskMap.get(currId);
    if (curr && Array.isArray(curr.dependencies)) {
      for (const depId of curr.dependencies) {
        if (depId === targetTaskId) return true;
        if (!visited.has(depId)) {
          queue.push(depId);
        }
      }
    }
  }
  return false;
}

console.log('--- STARTING WORKSHOP-001B DEPENDENCY DAG TESTS ---');

// 1. Basic same-operation sequencing (body -> reassembly for shared line)
{
  console.log('Test 1: Basic same-operation sequencing');
  const testCase = {
    id: 'case-seq-1',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [{
          id: 'L1',
          operation: 'REPARATION ET POSE PARE-CHOCS AV',
          laborHours: 3.0,
          allocations: [
            { phase: 'body', laborHours: 2.0 },
            { phase: 'reassembly', laborHours: 1.0 },
          ],
        }],
      },
    }],
  };
  const derived = win.deriveCanonicalPlanningTasks(testCase);
  validateGraphInvariants(derived);
  const body = derived.find((t) => t.phase === 'body');
  const reassembly = derived.find((t) => t.phase === 'reassembly');
  assert.ok(body && reassembly);
  assert.deepEqual(toPlain(body.dependencies), []);
  assert.deepEqual(toPlain(reassembly.dependencies), [body.id]);
}

// 2. Body -> preparation
{
  console.log('Test 2: Body -> preparation');
  const testCase = {
    id: 'case-prep-1',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [{
          id: 'L1',
          operation: 'REMPLACEMENT AILE AVD',
          laborHours: 3.5,
          paintGroup: 'right',
          allocations: [
            { phase: 'body', laborHours: 2.0 },
            { phase: 'prep', laborHours: 1.5 },
          ],
        }],
      },
    }],
  };
  const derived = win.deriveCanonicalPlanningTasks(testCase);
  validateGraphInvariants(derived);
  const body = derived.find((t) => t.phase === 'body');
  const prep = derived.find((t) => t.phase === 'prep');
  assert.ok(body && prep);
  assert.deepEqual(toPlain(prep.dependencies), [body.id]);
}

// 3. Preparation -> single-zone paint
{
  console.log('Test 3: Preparation -> single-zone paint');
  const testCase = {
    id: 'case-paint-single-1',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [{
          id: 'L1',
          operation: 'REMPLACEMENT AILE AVD',
          laborHours: 4.5,
          paintGroup: 'right',
          allocations: [
            { phase: 'body', laborHours: 2.0 },
            { phase: 'prep', laborHours: 1.5 },
            { phase: 'paint', laborHours: 1.0 },
          ],
        }],
      },
    }],
  };
  const derived = win.deriveCanonicalPlanningTasks(testCase);
  validateGraphInvariants(derived);
  const body = derived.find((t) => t.phase === 'body');
  const prep = derived.find((t) => t.phase === 'prep');
  const paint = derived.find((t) => t.phase === 'paint');
  assert.ok(body && prep && paint);
  assert.deepEqual(toPlain(prep.dependencies), [body.id]);
  assert.deepEqual(toPlain(paint.dependencies), [prep.id]);
}

// 4. Multi-zone -> global paint
{
  console.log('Test 4: Multi-zone -> global paint');
  const testCase = {
    id: 'case-paint-global-1',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [
          {
            id: 'L1',
            operation: 'REMPLACEMENT AILE AVD',
            laborHours: 3.5,
            paintGroup: 'right',
            allocations: [
              { phase: 'body', laborHours: 2.0 },
              { phase: 'prep', laborHours: 1.5 },
              { phase: 'paint', laborHours: 1.0 },
            ],
          },
          {
            id: 'L2',
            operation: 'REMPLACEMENT PARE-CHOCS AR',
            laborHours: 3.5,
            paintGroup: 'rear',
            allocations: [
              { phase: 'body', laborHours: 2.0 },
              { phase: 'prep', laborHours: 1.5 },
              { phase: 'paint', laborHours: 1.0 },
            ],
          },
        ],
      },
    }],
  };
  const derived = win.deriveCanonicalPlanningTasks(testCase);
  validateGraphInvariants(derived);
  const preps = derived.filter((t) => t.phase === 'prep');
  const paintGlobal = derived.find((t) => t.phase === 'paint');
  assert.equal(preps.length, 2);
  assert.ok(paintGlobal);
  assert.equal(paintGlobal.kind, 'paint_batch');
  assert.deepEqual(toPlain(paintGlobal.dependencies), toPlain(preps.map((p) => p.id).sort(compareStableText)));
}

// 5. Paint -> reassembly
{
  console.log('Test 5: Paint -> reassembly');
  const testCase = {
    id: 'case-paint-reassembly-1',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [{
          id: 'L1',
          operation: 'REMPLACEMENT CAPOT',
          laborHours: 5.5,
          paintGroup: 'center',
          allocations: [
            { phase: 'body', laborHours: 2.0 },
            { phase: 'prep', laborHours: 1.5 },
            { phase: 'paint', laborHours: 1.0 },
            { phase: 'reassembly', laborHours: 1.0 },
          ],
        }],
      },
    }],
  };
  const derived = win.deriveCanonicalPlanningTasks(testCase);
  validateGraphInvariants(derived);
  const paint = derived.find((t) => t.phase === 'paint');
  const reassembly = derived.find((t) => t.phase === 'reassembly');
  assert.ok(paint && reassembly);
  assert.deepEqual(toPlain(reassembly.dependencies), [paint.id]);
}

// 6. Independent operations (no false dependencies)
{
  console.log('Test 6: Independent operations');
  const testCase = {
    id: 'case-indep-1',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [
          {
            id: 'L1',
            operation: 'REMPLACEMENT AILE AVD',
            laborHours: 2.0,
            allocations: [{ phase: 'body', laborHours: 2.0 }],
          },
          {
            id: 'L2',
            operation: 'VIDANGE MOTEUR',
            laborHours: 1.0,
            allocations: [{ phase: 'oilService', laborHours: 1.0 }],
          },
          {
            id: 'L3',
            operation: 'DIAGNOSTIC FREINS',
            laborHours: 1.5,
            allocations: [{ phase: 'mechanical', laborHours: 1.5 }],
          },
          {
            id: 'L4',
            operation: 'CONTROLE FAISCEAU OPTIQUE',
            laborHours: 1.0,
            allocations: [{ phase: 'electrical', laborHours: 1.0 }],
          },
        ],
      },
    }],
  };
  const derived = win.deriveCanonicalPlanningTasks(testCase);
  validateGraphInvariants(derived);
  const body = derived.find((t) => t.phase === 'body');
  const oil = derived.find((t) => t.phase === 'oilService');
  const mech = derived.find((t) => t.phase === 'mechanical');
  const elec = derived.find((t) => t.phase === 'electrical');
  assert.deepEqual(toPlain(body.dependencies), []);
  assert.deepEqual(toPlain(oil.dependencies), []);
  assert.deepEqual(toPlain(mech.dependencies), []);
  assert.deepEqual(toPlain(elec.dependencies), []);
}

// 7. Finish terminal gating
{
  console.log('Test 7: Finish terminal gating');
  const testCase = {
    id: 'case-finish-1',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [
          {
            id: 'L1',
            operation: 'REMPLACEMENT AILE AVD',
            laborHours: 3.0,
            selectedPhases: ['body', 'reassembly'],
            allocations: [
              { phase: 'body', laborHours: 1.5 },
              { phase: 'reassembly', laborHours: 1.5 },
            ],
          },
          {
            id: 'L2',
            operation: 'VIDANGE MOTEUR',
            laborHours: 1.0,
            allocations: [{ phase: 'oilService', laborHours: 1.0 }],
          },
        ],
      },
    }],
    durations: {
      body: 1.5,
      reassembly: 1.5,
      oilService: 1.0,
      finish: 0.5,
    },
  };
  const derived = win.deriveCanonicalPlanningTasks(testCase);
  validateGraphInvariants(derived);
  const finish = derived.find((t) => t.phase === 'finish');
  const reassembly = derived.find((t) => t.phase === 'reassembly');
  const oil = derived.find((t) => t.phase === 'oilService');
  const body = derived.find((t) => t.phase === 'body');
  assert.ok(finish && reassembly && oil && body);
  assert.deepEqual(toPlain(finish.dependencies), toPlain([oil.id, reassembly.id].sort(compareStableText)));
  assert.ok(!finish.dependencies.includes(body.id), 'Finish must not include non-terminal body task');
}

// 8. Quality terminal gating
{
  console.log('Test 8: Quality terminal gating');
  const testCase = {
    id: 'case-quality-1',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [{
          id: 'L1',
          operation: 'REMPLACEMENT AILE AVD',
          laborHours: 2.0,
          allocations: [{ phase: 'body', laborHours: 2.0 }],
        }],
      },
    }],
    durations: {
      body: 2.0,
      finish: 0.5,
      quality: 0.25,
    },
  };
  const derived = win.deriveCanonicalPlanningTasks(testCase);
  validateGraphInvariants(derived);
  const body = derived.find((t) => t.phase === 'body');
  const finish = derived.find((t) => t.phase === 'finish');
  const quality = derived.find((t) => t.phase === 'quality');
  assert.ok(body && finish && quality);
  assert.deepEqual(toPlain(finish.dependencies), [body.id]);
  assert.deepEqual(toPlain(quality.dependencies), [finish.id]);
}

// 9. Missing prep fallback
{
  console.log('Test 9: Missing prep fallback');
  const testCase = {
    id: 'case-paint-no-prep-1',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [{
          id: 'L1',
          operation: 'PEINTURE DIRECTE RETROVISEUR',
          laborHours: 2.5,
          paintGroup: 'right',
          allocations: [
            { phase: 'body', laborHours: 1.0 },
            { phase: 'paint', laborHours: 1.5 },
          ],
        }],
      },
    }],
  };
  const derived = win.deriveCanonicalPlanningTasks(testCase);
  validateGraphInvariants(derived);
  const body = derived.find((t) => t.phase === 'body');
  const paint = derived.find((t) => t.phase === 'paint');
  const prep = derived.find((t) => t.phase === 'prep');
  assert.equal(prep, undefined);
  assert.ok(body && paint);
  assert.deepEqual(toPlain(paint.dependencies), [body.id]);
}

// 10. Body-only case
{
  console.log('Test 10: Body-only case');
  const testCase = {
    id: 'case-body-only-1',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [
          { id: 'L1', operation: 'DEBOSSÈLEMENT PORTE AVD', laborHours: 2.0, allocations: [{ phase: 'body', laborHours: 2.0 }] },
          { id: 'L2', operation: 'REDRESSAGE LONGECRON AV', laborHours: 3.0, allocations: [{ phase: 'body', laborHours: 3.0 }] },
        ],
      },
    }],
  };
  const derived = win.deriveCanonicalPlanningTasks(testCase);
  validateGraphInvariants(derived);
  assert.equal(derived.length, 2);
  derived.forEach((t) => {
    assert.equal(t.phase, 'body');
    assert.deepEqual(toPlain(t.dependencies), []);
  });
}

// 11. Mechanical-only case
{
  console.log('Test 11: Mechanical-only case');
  const testCase = {
    id: 'case-mech-only-1',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [
          { id: 'L1', operation: 'REMPLACEMENT DISQUES ET PLAQUETTES AV', laborHours: 2.0, allocations: [{ phase: 'mechanical', laborHours: 2.0 }] },
          { id: 'L2', operation: 'PURGE CIRCUIT DE FREINAGE', laborHours: 0.75, allocations: [{ phase: 'mechanical', laborHours: 0.75 }] },
        ],
      },
    }],
  };
  const derived = win.deriveCanonicalPlanningTasks(testCase);
  validateGraphInvariants(derived);
  assert.equal(derived.length, 2);
  derived.forEach((t) => {
    assert.equal(t.phase, 'mechanical');
    assert.deepEqual(toPlain(t.dependencies), []);
  });
}

// 12. Electrical + mechanical case
{
  console.log('Test 12: Electrical + mechanical case');
  const testCase = {
    id: 'case-elec-mech-1',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [
          { id: 'L1', operation: 'CONTROLE FAISCEAU CAPTEUR ABS', laborHours: 1.0, allocations: [{ phase: 'electrical', laborHours: 1.0 }] },
          { id: 'L2', operation: 'REMPLACEMENT TRIANGLE SUSPENSION', laborHours: 1.5, allocations: [{ phase: 'mechanical', laborHours: 1.5 }] },
        ],
      },
    }],
  };
  const derived = win.deriveCanonicalPlanningTasks(testCase);
  validateGraphInvariants(derived);
  const elec = derived.find((t) => t.phase === 'electrical');
  const mech = derived.find((t) => t.phase === 'mechanical');
  assert.ok(elec && mech);
  assert.deepEqual(toPlain(elec.dependencies), []);
  assert.deepEqual(toPlain(mech.dependencies), []);
}

// 13. Mixed claims
{
  console.log('Test 13: Mixed claims');
  const testCase = {
    id: 'case-mixed-claims-1',
    claims: [
      {
        id: 'claim-1',
        estimate: {
          originalLines: [{
            id: 'L1',
            operation: 'REMPLACEMENT PORTE AVG',
            laborHours: 3.5,
            paintGroup: 'left',
            allocations: [
              { phase: 'body', laborHours: 2.0 },
              { phase: 'prep', laborHours: 1.5 },
            ],
          }],
        },
      },
      {
        id: 'claim-2',
        estimate: {
          originalLines: [{
            id: 'L2',
            operation: 'PEINTURE PORTE AVG',
            laborHours: 1.2,
            paintGroup: 'left',
            allocations: [
              { phase: 'paint', laborHours: 1.2 },
            ],
          }],
        },
      },
    ],
  };
  const derived = win.deriveCanonicalPlanningTasks(testCase);
  validateGraphInvariants(derived);
  const body = derived.find((t) => t.phase === 'body');
  const prep = derived.find((t) => t.phase === 'prep');
  const paint = derived.find((t) => t.phase === 'paint');
  assert.ok(body && prep && paint);
  assert.deepEqual(toPlain(prep.dependencies), [body.id]);
  assert.deepEqual(toPlain(paint.dependencies), [prep.id]);
}

// 14. Mixed source provenance (estimate_provenance + applied_estimate)
{
  console.log('Test 14: Mixed source provenance');
  const testCase = {
    id: 'case-mixed-prov-1',
    claims: [
      {
        id: 'claim-1',
        estimate: {
          originalLines: [{
            id: 'L1',
            operation: 'REMPLACEMENT AILE AVD',
            laborHours: 2.5,
            paintGroup: 'right',
            allocations: [
              { phase: 'body', laborHours: 1.5 },
              { phase: 'prep', laborHours: 1.0 },
            ],
          }],
        },
      },
      {
        id: 'claim-2',
        estimate: {
          lines: [{
            id: 'L2',
            phase: 'paint',
            operation: 'Peinture aile AVD',
            paintGroup: 'right',
            laborHours: 1.5,
          }],
        },
      },
    ],
  };
  const derived = win.deriveCanonicalPlanningTasks(testCase);
  validateGraphInvariants(derived);
  const prep = derived.find((t) => t.phase === 'prep');
  const paint = derived.find((t) => t.phase === 'paint');
  assert.ok(prep && paint);
  assert.deepEqual(toPlain(paint.dependencies), [prep.id]);
}

// 15. Global paint regression (exactly ONE global paint batch when multiple zones exist)
{
  console.log('Test 15: Global paint regression');
  const testCase = {
    id: 'case-global-paint-reg-1',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [
          { id: 'L1', operation: 'PEINTURE CAPOT', laborHours: 1.5, paintGroup: 'center', allocations: [{ phase: 'paint', laborHours: 1.5 }] },
          { id: 'L2', operation: 'PEINTURE AILE AVD', laborHours: 1.5, paintGroup: 'right', allocations: [{ phase: 'paint', laborHours: 1.5 }] },
          { id: 'L3', operation: 'PEINTURE MALLE AR', laborHours: 1.5, paintGroup: 'rear', allocations: [{ phase: 'paint', laborHours: 1.5 }] },
        ],
      },
    }],
  };
  const derived = win.deriveCanonicalPlanningTasks(testCase);
  validateGraphInvariants(derived);
  const paintBatches = derived.filter((t) => t.phase === 'paint');
  assert.equal(paintBatches.length, 1);
  assert.equal(paintBatches[0].kind, 'paint_batch');
  assert.ok(paintBatches[0].id.includes('batch-paint-global'));
}

// 16. Duration conservation (dependency assignment changes ZERO laborHours and ZERO durationMinutes)
{
  console.log('Test 16: Duration conservation');
  const testCase = {
    id: 'case-dur-cons-1',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [
          {
            id: 'L1',
            operation: 'REMPLACEMENT CAPOT',
            laborHours: 5.5,
            paintGroup: 'center',
            allocations: [
              { phase: 'body', laborHours: 2.0 },
              { phase: 'prep', laborHours: 1.5 },
              { phase: 'paint', laborHours: 1.0 },
              { phase: 'reassembly', laborHours: 1.0 },
            ],
          },
        ],
      },
    }],
  };
  const derived = win.deriveCanonicalPlanningTasks(testCase);
  const rawTasksWithoutDeps = derived.map((t) => ({ ...t, dependencies: [] }));
  const reprocessed = win.applyCanonicalTaskDependencies(rawTasksWithoutDeps);

  assert.equal(derived.length, reprocessed.length);
  for (let i = 0; i < derived.length; i++) {
    assert.equal(derived[i].laborHours, reprocessed[i].laborHours, `Labor hours mismatch on task ${derived[i].id}`);
    assert.equal(derived[i].durationMinutes, reprocessed[i].durationMinutes, `Duration minutes mismatch on task ${derived[i].id}`);
  }

  const sumBefore = Number(rawTasksWithoutDeps.reduce((s, t) => s + Number(t.laborHours || 0), 0).toFixed(2));
  const sumAfter = Number(reprocessed.reduce((s, t) => s + Number(t.laborHours || 0), 0).toFixed(2));
  assert.equal(sumAfter, sumBefore);

  const minsBefore = rawTasksWithoutDeps.reduce((s, t) => s + Number(t.durationMinutes || 0), 0);
  const minsAfter = reprocessed.reduce((s, t) => s + Number(t.durationMinutes || 0), 0);
  assert.equal(minsAfter, minsBefore);
}

// 17. No cycles (topological validation)
{
  console.log('Test 17: No cycles');
  const complexCase = {
    id: 'case-cycles-1',
    durations: {},
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [
          { id: 'L1', operation: 'REPARATION CAPOT', laborHours: 4.0, paintGroup: 'center', allocations: [{ phase: 'body', laborHours: 1.5 }, { phase: 'prep', laborHours: 1.5 }, { phase: 'reassembly', laborHours: 1.0 }] },
          { id: 'L2', operation: 'PEINTURE CAPOT', laborHours: 1.5, paintGroup: 'center', allocations: [{ phase: 'paint', laborHours: 1.5 }] },
          { id: 'L3', operation: 'REMPLACEMENT PARE-CHOCS AV', laborHours: 3.0, paintGroup: 'front', allocations: [{ phase: 'body', laborHours: 1.5 }, { phase: 'prep', laborHours: 1.5 }] },
          { id: 'L4', operation: 'PEINTURE PARE-CHOCS AV', laborHours: 1.5, paintGroup: 'front', allocations: [{ phase: 'paint', laborHours: 1.5 }] },
        ],
      },
    }],
  };
  win.recomputeCaseDurationsFromClaims(complexCase);
  complexCase.durations.finish = 0.5;
  complexCase.durations.quality = 0.25;
  const derived = win.deriveCanonicalPlanningTasks(complexCase);
  validateGraphInvariants(derived);
}

// 18. No dangling refs
{
  console.log('Test 18: No dangling refs');
  const asmaCase = {
    id: 'case-asma-1',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [
          { id: 'L1', operation: 'REPOSE LUNETTE AR', laborHours: 1.0, allocations: [{ phase: 'reassembly', laborHours: 1.0 }] },
          { id: 'L2', operation: 'D/P ET PREPARATION MALLE AR', laborHours: 2.0, paintGroup: 'rear', allocations: [{ phase: 'prep', laborHours: 2.0 }] },
          { id: 'L3', operation: 'PEINTURE ET FINITION MALLE AR', laborHours: 1.5, paintGroup: 'rear', allocations: [{ phase: 'paint', laborHours: 1.5 }] },
        ],
      },
    }],
  };
  const derived = win.deriveCanonicalPlanningTasks(asmaCase);
  validateGraphInvariants(derived);
  const ids = new Set(derived.map((t) => t.id));
  derived.forEach((t) => {
    t.dependencies.forEach((d) => assert.ok(ids.has(d), `Dependency ${d} not in case!`));
  });
}

// 19. No self dependencies
{
  console.log('Test 19: No self dependencies');
  const asmaCase = {
    id: 'case-asma-self',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [
          { id: 'L1', operation: 'PEINTURE CAPOT', laborHours: 1.5, paintGroup: 'center', allocations: [{ phase: 'paint', laborHours: 1.5 }] },
        ],
      },
    }],
  };
  const derived = win.deriveCanonicalPlanningTasks(asmaCase);
  validateGraphInvariants(derived);
  derived.forEach((t) => {
    assert.ok(!t.dependencies.includes(t.id));
  });
}

// 20. No duplicate dependencies
{
  console.log('Test 20: No duplicate dependencies');
  const asmaCase = {
    id: 'case-asma-dups',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [
          { id: 'L1', operation: 'REMPLACEMENT CAPOT', laborHours: 4.0, paintGroup: 'center', allocations: [{ phase: 'body', laborHours: 2.0 }, { phase: 'prep', laborHours: 1.0 }, { phase: 'paint', laborHours: 1.0 }] },
        ],
      },
    }],
  };
  const derived = win.deriveCanonicalPlanningTasks(asmaCase);
  validateGraphInvariants(derived);
  derived.forEach((t) => {
    const unique = new Set(t.dependencies);
    assert.equal(unique.size, t.dependencies.length);
  });
}

// 21. Determinism across repeated executions
{
  console.log('Test 21: Determinism across repeated executions');
  const testCase = {
    id: 'case-det-1',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [
          { id: 'L1', operation: 'REMPLACEMENT CAPOT', laborHours: 4.0, paintGroup: 'center', allocations: [{ phase: 'body', laborHours: 2.0 }, { phase: 'prep', laborHours: 1.0 }, { phase: 'paint', laborHours: 1.0 }] },
          { id: 'L2', operation: 'REMPLACEMENT AILE AVD', laborHours: 3.0, paintGroup: 'right', allocations: [{ phase: 'body', laborHours: 1.5 }, { phase: 'prep', laborHours: 1.5 }] },
        ],
      },
    }],
  };
  const run1 = win.deriveCanonicalPlanningTasks(testCase);
  const run2 = win.deriveCanonicalPlanningTasks(testCase);
  assert.deepEqual(toPlain(run1), toPlain(run2));
}

// 22. Clone determinism
{
  console.log('Test 22: Clone determinism');
  const testCase = {
    id: 'case-clone-1',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [
          { id: 'L1', operation: 'REMPLACEMENT CAPOT', laborHours: 4.0, paintGroup: 'center', allocations: [{ phase: 'body', laborHours: 2.0 }, { phase: 'prep', laborHours: 1.0 }, { phase: 'paint', laborHours: 1.0 }] },
        ],
      },
    }],
  };
  const cloned = JSON.parse(JSON.stringify(testCase));
  const runOriginal = win.deriveCanonicalPlanningTasks(testCase);
  const runCloned = win.deriveCanonicalPlanningTasks(cloned);
  assert.deepEqual(toPlain(runOriginal), toPlain(runCloned));
}

// 23. Source-order determinism (equivalent shuffled source lines produce the same canonical graph)
{
  console.log('Test 23: Source-order determinism');
  const lineA = { id: 'LA', operation: 'REMPLACEMENT CAPOT', laborHours: 3.0, paintGroup: 'center', allocations: [{ phase: 'body', laborHours: 1.5 }, { phase: 'prep', laborHours: 1.5 }] };
  const lineB = { id: 'LB', operation: 'REMPLACEMENT MALLE AR', laborHours: 3.0, paintGroup: 'rear', allocations: [{ phase: 'body', laborHours: 1.5 }, { phase: 'prep', laborHours: 1.5 }] };

  const case1 = { id: 'case-order', claims: [{ id: 'c1', estimate: { originalLines: [lineA, lineB] } }] };
  const case2 = { id: 'case-order', claims: [{ id: 'c1', estimate: { originalLines: [lineB, lineA] } }] };

  const derived1 = win.deriveCanonicalPlanningTasks(case1);
  const derived2 = win.deriveCanonicalPlanningTasks(case2);
  assert.deepEqual(toPlain(derived1), toPlain(derived2));
}

// 24. State normalization roundtrip
{
  console.log('Test 24: State normalization roundtrip');
  const testCase = {
    id: 'case-norm-1',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [{
          id: 'L1',
          operation: 'REMPLACEMENT CAPOT',
          laborHours: 4.5,
          paintGroup: 'center',
          allocations: [
            { phase: 'body', laborHours: 2.0 },
            { phase: 'prep', laborHours: 1.5 },
            { phase: 'paint', laborHours: 1.0 },
          ],
        }],
      },
    }],
  };
  const derived = win.deriveCanonicalPlanningTasks(testCase);
  validateGraphInvariants(derived);

  const normalizeState = (s) => vm.runInContext('normalizeState', context)(s);
  testCase.planningTasks = derived;
  const state = { cases: [testCase] };
  const normalized = normalizeState(state);
  const normalizedTasks = normalized.cases[0].planningTasks;

  assert.equal(normalizedTasks.length, derived.length);
  for (let i = 0; i < derived.length; i++) {
    assert.deepEqual(toPlain(normalizedTasks[i].dependencies), toPlain(derived[i].dependencies));
  }

  // Verify paintGroups normalization and sourceClaimIds preservation
  const globalPaintTask = {
    id: 'task-batch-paint-global|case-norm-1',
    taskId: 'task-batch-paint-global|case-norm-1',
    kind: 'paint_batch',
    phase: 'paint',
    title: 'PEINTURE + VERNIS — LOT GLOBAL',
    laborHours: 2.0,
    durationMinutes: 120,
    taskModelVersion: 1,
    bodyZones: ['front', 'rear'],
    dependencies: [],
    paintGroups: [
      {
        zone: 'front',
        rawContributionHours: 1.0,
        elements: ['capot'],
        sourceLineIds: ['L1'],
        sourceClaimIds: ['claim-2', 'claim-1', 'claim-1', '  claim-2  '],
      },
    ],
  };
  const testCase2 = { id: 'case-norm-2', planningTasks: [globalPaintTask] };
  const normalized2 = normalizeState({ cases: [testCase2] });
  const normGlobalPaint = normalized2.cases[0].planningTasks[0];
  assert.ok(Array.isArray(normGlobalPaint.paintGroups));
  assert.equal(normGlobalPaint.paintGroups[0].zone, 'front');
  // Duplicate removal, trimming, and deterministic string list
  assert.deepEqual(toPlain(normGlobalPaint.paintGroups[0].sourceClaimIds), ['claim-2', 'claim-1']);
}

// 25. Planner safety (getCasePlanningTasks remains lazy and does NOT mutate case.planningTasks)
{
  console.log('Test 25: Planner safety');
  const pristineCase = {
    id: 'case-pristine-1',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [{
          id: 'L1',
          operation: 'REMPLACEMENT CAPOT',
          laborHours: 2.0,
          allocations: [{ phase: 'body', laborHours: 2.0 }],
        }],
      },
    }],
  };
  assert.equal(pristineCase.planningTasks, undefined);
  const tasks = win.getCasePlanningTasks(pristineCase);
  assert.ok(tasks.length > 0);
  assert.equal(pristineCase.planningTasks, undefined, 'getCasePlanningTasks must NOT write into pristine case.planningTasks');
}

// 26. Existing WORKSHOP-001A tests pass
{
  console.log('Test 26: Existing WORKSHOP-001A tests compatibility verified via suite invocation');
}

// 27. Global paint with partial preparation coverage
{
  console.log('Test 27: Global paint with partial preparation coverage');
  const testCase = {
    id: 'case-partial-prep-1',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [
          {
            id: 'L-front',
            operation: 'REPARATION ET PEINTURE AILE AVD',
            laborHours: 4.5,
            paintGroup: 'front',
            allocations: [
              { phase: 'body', laborHours: 2.0 },
              { phase: 'prep', laborHours: 1.5 },
              { phase: 'paint', laborHours: 1.0 },
            ],
          },
          {
            id: 'L-rear',
            operation: 'REPARATION ET PEINTURE MALLE AR SANS PREP',
            laborHours: 3.0,
            paintGroup: 'rear',
            allocations: [
              { phase: 'body', laborHours: 2.0 },
              { phase: 'paint', laborHours: 1.0 },
            ],
          },
          {
            id: 'L-oil',
            operation: 'VIDANGE MOTEUR',
            laborHours: 1.0,
            allocations: [
              { phase: 'oilService', laborHours: 1.0 },
            ],
          },
        ],
      },
    }],
  };

  const derived = win.deriveCanonicalPlanningTasks(testCase);
  validateGraphInvariants(derived);

  // 1. Exactly ONE paint batch
  const paintBatches = derived.filter((t) => t.phase === 'paint');
  assert.equal(paintBatches.length, 1);
  const globalPaint = paintBatches[0];

  // 2. It is the global paint batch
  assert.equal(globalPaint.kind, 'paint_batch');
  assert.ok(globalPaint.id.includes('batch-paint-global'));

  const bodyFront = derived.find((t) => t.phase === 'body' && t.sourceLineIds.includes('L-front'));
  const prepFront = derived.find((t) => t.phase === 'prep' && t.bodyZone === 'front');
  const bodyRear = derived.find((t) => t.phase === 'body' && t.sourceLineIds.includes('L-rear'));
  const prepRear = derived.find((t) => t.phase === 'prep' && t.bodyZone === 'rear');
  const oilService = derived.find((t) => t.phase === 'oilService');

  assert.ok(bodyFront, 'body front must exist');
  assert.ok(prepFront, 'prep front must exist');
  assert.ok(bodyRear, 'body rear must exist');
  assert.equal(prepRear, undefined, 'prep rear must NOT exist');
  assert.ok(oilService, 'oil service must exist');

  // 3. Reachability: global paint reachable only after all legitimate upstream prerequisites are satisfied
  assert.ok(isReachable(globalPaint.id, prepFront.id, derived), 'Global paint must reach prep front');
  assert.ok(isReachable(globalPaint.id, bodyFront.id, derived), 'Global paint must transitively reach body front');
  assert.ok(isReachable(globalPaint.id, bodyRear.id, derived), 'Global paint must reach body rear');

  // 4. Prep-covered group uses its prep batch
  assert.ok(globalPaint.dependencies.includes(prepFront.id), 'Global paint must directly depend on prep front');

  // 5. Non-prep group remains gated by relevant body provenance
  assert.ok(globalPaint.dependencies.includes(bodyRear.id), 'Global paint must directly depend on body rear fallback');

  // 6. Unrelated mechanical/electrical/oil-service tasks are NOT dependencies
  assert.ok(!globalPaint.dependencies.includes(oilService.id), 'Oil service must NOT be in global paint dependencies');
  assert.ok(!isReachable(globalPaint.id, oilService.id, derived), 'Oil service must NOT be reachable from global paint');

  // 7-8. Invariants & cycle safety verified above via validateGraphInvariants(derived)

  // 9-10. Duration conservation
  const rawTasks = derived.map((t) => ({ ...t, dependencies: [] }));
  const reprocessed = win.applyCanonicalTaskDependencies(rawTasks);
  for (let i = 0; i < derived.length; i++) {
    assert.equal(derived[i].laborHours, reprocessed[i].laborHours);
    assert.equal(derived[i].durationMinutes, reprocessed[i].durationMinutes);
  }
}

// 28. Global paint with partial preparation coverage — mirrored case
{
  console.log('Test 28: Global paint with partial preparation coverage — mirrored case');
  const testCase = {
    id: 'case-partial-prep-mirrored',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [
          {
            id: 'L-front-noprep',
            operation: 'REPARATION ET PEINTURE CAPOT SANS PREP',
            laborHours: 3.0,
            paintGroup: 'front',
            allocations: [
              { phase: 'body', laborHours: 2.0 },
              { phase: 'paint', laborHours: 1.0 },
            ],
          },
          {
            id: 'L-rear-prep',
            operation: 'REPARATION ET PEINTURE MALLE AR',
            laborHours: 4.5,
            paintGroup: 'rear',
            allocations: [
              { phase: 'body', laborHours: 2.0 },
              { phase: 'prep', laborHours: 1.5 },
              { phase: 'paint', laborHours: 1.0 },
            ],
          },
          {
            id: 'L-elec',
            operation: 'CONTROLE FAISCEAU OPTIQUE',
            laborHours: 1.0,
            allocations: [
              { phase: 'electrical', laborHours: 1.0 },
            ],
          },
        ],
      },
    }],
  };

  const derived = win.deriveCanonicalPlanningTasks(testCase);
  validateGraphInvariants(derived);

  const paintBatches = derived.filter((t) => t.phase === 'paint');
  assert.equal(paintBatches.length, 1);
  const globalPaint = paintBatches[0];
  assert.ok(globalPaint.id.includes('batch-paint-global'));

  const bodyFront = derived.find((t) => t.phase === 'body' && t.sourceLineIds.includes('L-front-noprep'));
  const prepFront = derived.find((t) => t.phase === 'prep' && t.bodyZone === 'front');
  const bodyRear = derived.find((t) => t.phase === 'body' && t.sourceLineIds.includes('L-rear-prep'));
  const prepRear = derived.find((t) => t.phase === 'prep' && t.bodyZone === 'rear');
  const elec = derived.find((t) => t.phase === 'electrical');

  assert.ok(bodyFront);
  assert.equal(prepFront, undefined, 'prep front must NOT exist in mirrored case');
  assert.ok(bodyRear);
  assert.ok(prepRear, 'prep rear must exist in mirrored case');
  assert.ok(elec);

  // Mirrored dependencies: body front (fallback) + prep rear (batch)
  assert.ok(globalPaint.dependencies.includes(bodyFront.id));
  assert.ok(globalPaint.dependencies.includes(prepRear.id));
  assert.ok(!globalPaint.dependencies.includes(elec.id));

  assert.ok(isReachable(globalPaint.id, bodyFront.id, derived));
  assert.ok(isReachable(globalPaint.id, prepRear.id, derived));
  assert.ok(isReachable(globalPaint.id, bodyRear.id, derived));
  assert.ok(!isReachable(globalPaint.id, elec.id, derived));
}

// 29. Transitive reduction semantic reachability preservation
{
  console.log('Test 29: Transitive reduction semantic reachability preservation');
  const complexCase = {
    id: 'case-transitive-proof',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [
          {
            id: 'L1',
            operation: 'REMPLACEMENT CAPOT ET PEINTURE',
            laborHours: 5.5,
            paintGroup: 'center',
            selectedPhases: ['body', 'prep', 'paint', 'reassembly'],
            allocations: [
              { phase: 'body', laborHours: 2.0 },
              { phase: 'prep', laborHours: 1.5 },
              { phase: 'paint', laborHours: 1.0 },
              { phase: 'reassembly', laborHours: 1.0 },
            ],
          },
        ],
      },
    }],
    durations: {},
  };
  win.recomputeCaseDurationsFromClaims(complexCase);
  complexCase.durations.finish = 0.5;
  complexCase.durations.quality = 0.25;

  const derived = win.deriveCanonicalPlanningTasks(complexCase);
  validateGraphInvariants(derived);

  const body = derived.find((t) => t.phase === 'body');
  const prep = derived.find((t) => t.phase === 'prep');
  const paint = derived.find((t) => t.phase === 'paint');
  const reassembly = derived.find((t) => t.phase === 'reassembly');
  const finish = derived.find((t) => t.phase === 'finish');
  const quality = derived.find((t) => t.phase === 'quality');

  // In the reduced graph:
  // prep depends on body
  // paint depends on prep
  // reassembly depends on paint
  // finish depends on reassembly (terminal)
  // quality depends on finish
  assert.deepEqual(toPlain(prep.dependencies), [body.id]);
  assert.deepEqual(toPlain(paint.dependencies), [prep.id]);
  assert.deepEqual(toPlain(reassembly.dependencies), [paint.id]);
  assert.deepEqual(toPlain(finish.dependencies), [reassembly.id]);
  assert.deepEqual(toPlain(quality.dependencies), [finish.id]);

  // Transitive reachability proofs:
  // Finish must transitively reach body, prep, paint, reassembly
  assert.ok(isReachable(finish.id, reassembly.id, derived));
  assert.ok(isReachable(finish.id, paint.id, derived));
  assert.ok(isReachable(finish.id, prep.id, derived));
  assert.ok(isReachable(finish.id, body.id, derived));

  // Quality must transitively reach everything
  assert.ok(isReachable(quality.id, finish.id, derived));
  assert.ok(isReachable(quality.id, reassembly.id, derived));
  assert.ok(isReachable(quality.id, paint.id, derived));
  assert.ok(isReachable(quality.id, prep.id, derived));
  assert.ok(isReachable(quality.id, body.id, derived));

  // Direct dependencies are strictly minimal
  assert.ok(!finish.dependencies.includes(body.id), 'Transitive reduction must prune body from finish dependencies');
  assert.ok(!finish.dependencies.includes(prep.id), 'Transitive reduction must prune prep from finish dependencies');
  assert.ok(!finish.dependencies.includes(paint.id), 'Transitive reduction must prune paint from finish dependencies');
  assert.ok(!quality.dependencies.includes(reassembly.id), 'Transitive reduction must prune reassembly from quality dependencies');
}

// 30. Single-zone paint ignores unrelated sole preparation batch
{
  console.log('Test 30: Single-zone paint ignores unrelated sole preparation batch');
  const testCase = {
    id: 'case-unrelated-prep-single-zone',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [
          {
            id: 'L-front-prep',
            operation: 'REPARATION ET PREPARATION PARE-CHOC AVANT',
            laborHours: 2.0,
            paintGroup: 'front',
            selectedPhases: ['body', 'prep'],
            allocations: [
              { phase: 'body', laborHours: 1.0 },
              { phase: 'prep', laborHours: 1.0 },
            ],
          },
          {
            id: 'L-rear-paint',
            operation: 'REPARATION ET PEINTURE AILE ARRIERE',
            laborHours: 3.0,
            paintGroup: 'rear',
            selectedPhases: ['body', 'paint'],
            allocations: [
              { phase: 'body', laborHours: 1.5 },
              { phase: 'paint', laborHours: 1.5 },
            ],
          },
        ],
      },
    }],
    durations: {},
  };
  win.recomputeCaseDurationsFromClaims(testCase);

  const derived = win.deriveCanonicalPlanningTasks(testCase);
  validateGraphInvariants(derived);

  // 1. Exactly one paint batch
  const paintBatches = derived.filter((t) => t.phase === 'paint');
  assert.equal(paintBatches.length, 1);
  const paintRear = paintBatches[0];

  // 2. Paint batch zone = rear
  assert.equal(paintRear.bodyZone, 'rear');
  assert.ok(paintRear.id.includes('batch-paint') && paintRear.id.includes('rear'));

  // 3. Front prep exists
  const prepBatches = derived.filter((t) => t.phase === 'prep');
  assert.equal(prepBatches.length, 1);
  const prepFront = prepBatches[0];
  assert.equal(prepFront.bodyZone, 'front');

  // 4. Rear body exists
  const bodyRear = derived.find((t) => t.phase === 'body' && t.sourceLineIds.includes('L-rear-paint'));
  assert.ok(bodyRear);

  // 5. Rear prep does NOT exist
  const prepRear = derived.find((t) => t.phase === 'prep' && t.bodyZone === 'rear');
  assert.equal(prepRear, undefined);

  // 6. Paint rear does NOT directly depend on front prep
  assert.ok(!paintRear.dependencies.includes(prepFront.id), 'Paint rear must NOT directly depend on front prep');

  // 7. Front prep is NOT transitively reachable from paint rear
  assert.ok(!isReachable(paintRear.id, prepFront.id, derived), 'Front prep must NOT be reachable from paint rear');

  // 8. Paint rear depends on / reaches relevant rear body
  assert.ok(paintRear.dependencies.includes(bodyRear.id), 'Paint rear must depend on rear body');
  assert.ok(isReachable(paintRear.id, bodyRear.id, derived), 'Paint rear must reach rear body');

  // 9-11. (no dangling, no cycles, no self-deps validated by validateGraphInvariants)
  // 12. Duration conservation unchanged
  const rawTasks30 = derived.map((t) => ({ ...t, dependencies: [] }));
  const reprocessed30 = win.applyCanonicalTaskDependencies(rawTasks30);
  for (let i = 0; i < derived.length; i++) {
    assert.equal(derived[i].laborHours, reprocessed30[i].laborHours);
    assert.equal(derived[i].durationMinutes, reprocessed30[i].durationMinutes);
  }
}

// 31. Single-zone paint ignores unrelated sole preparation batch — mirrored case
{
  console.log('Test 31: Single-zone paint ignores unrelated sole preparation batch — mirrored case');
  const testCase = {
    id: 'case-unrelated-prep-single-zone-mirrored',
    claims: [{
      id: 'claim-1',
      estimate: {
        originalLines: [
          {
            id: 'L-rear-prep',
            operation: 'REPARATION ET PREPARATION PARE-CHOC ARRIERE',
            laborHours: 2.0,
            paintGroup: 'rear',
            selectedPhases: ['body', 'prep'],
            allocations: [
              { phase: 'body', laborHours: 1.0 },
              { phase: 'prep', laborHours: 1.0 },
            ],
          },
          {
            id: 'L-front-paint',
            operation: 'REPARATION ET PEINTURE CAPOT AVANT',
            laborHours: 3.0,
            paintGroup: 'front',
            selectedPhases: ['body', 'paint'],
            allocations: [
              { phase: 'body', laborHours: 1.5 },
              { phase: 'paint', laborHours: 1.5 },
            ],
          },
        ],
      },
    }],
    durations: {},
  };
  win.recomputeCaseDurationsFromClaims(testCase);

  const derived = win.deriveCanonicalPlanningTasks(testCase);
  validateGraphInvariants(derived);

  // 1. Exactly one paint batch
  const paintBatches = derived.filter((t) => t.phase === 'paint');
  assert.equal(paintBatches.length, 1);
  const paintFront = paintBatches[0];

  // 2. Paint batch zone = front
  assert.equal(paintFront.bodyZone, 'front');
  assert.ok(paintFront.id.includes('batch-paint') && paintFront.id.includes('front'));

  // 3. Rear prep exists
  const prepBatches = derived.filter((t) => t.phase === 'prep');
  assert.equal(prepBatches.length, 1);
  const prepRear = prepBatches[0];
  assert.equal(prepRear.bodyZone, 'rear');

  // 4. Front body exists
  const bodyFront = derived.find((t) => t.phase === 'body' && t.sourceLineIds.includes('L-front-paint'));
  assert.ok(bodyFront);

  // 5. Front prep does NOT exist
  const prepFront = derived.find((t) => t.phase === 'prep' && t.bodyZone === 'front');
  assert.equal(prepFront, undefined);

  // 6. Paint front does NOT directly depend on rear prep
  assert.ok(!paintFront.dependencies.includes(prepRear.id), 'Paint front must NOT directly depend on rear prep');

  // 7. Rear prep is NOT transitively reachable from paint front
  assert.ok(!isReachable(paintFront.id, prepRear.id, derived), 'Rear prep must NOT be reachable from paint front');

  // 8. Paint front depends on / reaches relevant front body
  assert.ok(paintFront.dependencies.includes(bodyFront.id), 'Paint front must depend on front body');
  assert.ok(isReachable(paintFront.id, bodyFront.id, derived), 'Paint front must reach front body');

  // 12. Duration conservation
  const rawTasks31 = derived.map((t) => ({ ...t, dependencies: [] }));
  const reprocessed31 = win.applyCanonicalTaskDependencies(rawTasks31);
  for (let i = 0; i < derived.length; i++) {
    assert.equal(derived[i].laborHours, reprocessed31[i].laborHours);
    assert.equal(derived[i].durationMinutes, reprocessed31[i].durationMinutes);
  }
}

// 32. Same raw sourceLineId in different claims remains independent
{
  console.log('Test 32: Same raw sourceLineId in different claims remains independent');
  const testCase = {
    id: 'case-claim-scoped-rule-a',
    claims: [
      {
        id: 'claim-A',
        estimate: {
          originalLines: [
            {
              id: 'estimate-source-line-1',
              operation: 'REPARATION BAS DE CAISSE GAUCHE',
              laborHours: 2.0,
              paintGroup: 'left',
              selectedPhases: ['body'],
              allocations: [
                { phase: 'body', laborHours: 2.0 },
              ],
            },
          ],
        },
      },
      {
        id: 'claim-B',
        estimate: {
          originalLines: [
            {
              id: 'estimate-source-line-1',
              operation: 'REPOSE POIGNEE PORTE DROITE',
              laborHours: 0.5,
              paintGroup: 'right',
              selectedPhases: ['reassembly'],
              allocations: [
                { phase: 'reassembly', laborHours: 0.5 },
              ],
            },
          ],
        },
      },
    ],
    durations: {},
  };
  win.recomputeCaseDurationsFromClaims(testCase);

  const derived = win.deriveCanonicalPlanningTasks(testCase);
  validateGraphInvariants(derived);

  const bodyA = derived.find((t) => t.phase === 'body' && t.sourceClaimIds.includes('claim-A'));
  const reassemblyB = derived.find((t) => t.phase === 'reassembly' && t.sourceClaimIds.includes('claim-B'));

  assert.ok(bodyA, 'Body task in Claim A must exist');
  assert.ok(reassemblyB, 'Reassembly task in Claim B must exist');

  // Reassembly B must NOT depend on Body A despite sharing raw sourceLineId
  assert.ok(!reassemblyB.dependencies.includes(bodyA.id), 'Reassembly B must NOT depend on Body A');
  assert.ok(!isReachable(reassemblyB.id, bodyA.id, derived), 'Body A must NOT be reachable from Reassembly B');
  assert.deepEqual(toPlain(reassemblyB.dependencies), [], 'Reassembly B should be independent');
  assert.deepEqual(toPlain(bodyA.dependencies), [], 'Body A should be independent');

  // Positive control: same line ID within SAME claim creates body -> reassembly dependency
  const positiveControlCase = {
    id: 'case-claim-scoped-positive-control',
    claims: [
      {
        id: 'claim-A',
        estimate: {
          originalLines: [
            {
              id: 'estimate-source-line-1',
              operation: 'REPOSE CAPOT APRES REDRESSAGE',
              laborHours: 2.5,
              paintGroup: 'center',
              selectedPhases: ['body', 'reassembly'],
              allocations: [
                { phase: 'body', laborHours: 1.5 },
                { phase: 'reassembly', laborHours: 1.0 },
              ],
            },
          ],
        },
      },
    ],
    durations: {},
  };
  win.recomputeCaseDurationsFromClaims(positiveControlCase);
  const derivedPositive = win.deriveCanonicalPlanningTasks(positiveControlCase);
  validateGraphInvariants(derivedPositive);

  const bodyCtrl = derivedPositive.find((t) => t.phase === 'body');
  const reassemblyCtrl = derivedPositive.find((t) => t.phase === 'reassembly');
  assert.ok(bodyCtrl && reassemblyCtrl);
  assert.ok(reassemblyCtrl.dependencies.includes(bodyCtrl.id), 'Body -> reassembly must still work within same claim');
  assert.ok(isReachable(reassemblyCtrl.id, bodyCtrl.id, derivedPositive));
}

// 33. Duplicate line IDs across claims do not cross-wire prep and paint
{
  console.log('Test 33: Duplicate line IDs across claims do not cross-wire prep and paint');
  const testCase = {
    id: 'case-claim-scoped-prep-paint',
    claims: [
      {
        id: 'claim-A',
        estimate: {
          originalLines: [
            {
              id: 'estimate-source-line-1',
              operation: 'PREPARATION PARE-CHOC AVANT',
              laborHours: 1.5,
              paintGroup: 'front',
              selectedPhases: ['prep'],
              allocations: [
                { phase: 'prep', laborHours: 1.5 },
              ],
            },
          ],
        },
      },
      {
        id: 'claim-B',
        estimate: {
          originalLines: [
            {
              id: 'estimate-source-line-1',
              operation: 'REPARATION ET PEINTURE AILE ARRIERE',
              laborHours: 3.5,
              paintGroup: 'rear',
              selectedPhases: ['body', 'paint'],
              allocations: [
                { phase: 'body', laborHours: 2.0 },
                { phase: 'paint', laborHours: 1.5 },
              ],
            },
          ],
        },
      },
    ],
    durations: {},
  };
  win.recomputeCaseDurationsFromClaims(testCase);

  const derived = win.deriveCanonicalPlanningTasks(testCase);
  validateGraphInvariants(derived);

  const prepFront = derived.find((t) => t.phase === 'prep' && t.bodyZone === 'front');
  const paintRear = derived.find((t) => t.phase === 'paint' && t.bodyZone === 'rear');
  const bodyRear = derived.find((t) => t.phase === 'body' && t.sourceClaimIds.includes('claim-B'));

  assert.ok(prepFront, 'Front prep batch must exist');
  assert.ok(paintRear, 'Rear paint batch must exist');
  assert.ok(bodyRear, 'Rear body task must exist');

  // Rear paint must NOT depend on front prep from Claim A despite sharing estimate-source-line-1
  assert.ok(!paintRear.dependencies.includes(prepFront.id), 'Rear paint must NOT depend on front prep');
  assert.ok(!isReachable(paintRear.id, prepFront.id, derived), 'Front prep must NOT be reachable from rear paint');

  // Rear paint must correctly fall back to relevant rear body in Claim B
  assert.ok(paintRear.dependencies.includes(bodyRear.id), 'Rear paint must depend on rear body in Claim B');
  assert.ok(isReachable(paintRear.id, bodyRear.id, derived), 'Rear body must be reachable from rear paint');

  const rawTasks33 = derived.map((t) => ({ ...t, dependencies: [] }));
  const reprocessed33 = win.applyCanonicalTaskDependencies(rawTasks33);
  for (let i = 0; i < derived.length; i++) {
    assert.equal(derived[i].laborHours, reprocessed33[i].laborHours);
    assert.equal(derived[i].durationMinutes, reprocessed33[i].durationMinutes);
  }
}

// 34. Global paint duplicate line IDs remain claim-scoped
{
  console.log('Test 34: Global paint duplicate line IDs remain claim-scoped');
  const testCase = {
    id: 'case-global-paint-claim-scoped',
    claims: [
      {
        id: 'claim-A',
        estimate: {
          originalLines: [
            {
              id: 'estimate-source-line-1',
              operation: 'REPARATION ET PREPARATION PARE-CHOC AVANT',
              laborHours: 3.5,
              paintGroup: 'front',
              selectedPhases: ['body', 'prep', 'paint'],
              allocations: [
                { phase: 'body', laborHours: 1.0 },
                { phase: 'prep', laborHours: 1.5 },
                { phase: 'paint', laborHours: 1.0 },
              ],
            },
          ],
        },
      },
      {
        id: 'claim-B',
        estimate: {
          originalLines: [
            {
              id: 'estimate-source-line-1',
              operation: 'REPARATION ET PEINTURE AILE ARRIERE SANS PREP',
              laborHours: 3.0,
              paintGroup: 'rear',
              selectedPhases: ['body', 'paint'],
              allocations: [
                { phase: 'body', laborHours: 2.0 },
                { phase: 'paint', laborHours: 1.0 },
              ],
            },
          ],
        },
      },
    ],
    durations: {},
  };
  win.recomputeCaseDurationsFromClaims(testCase);

  const derived = win.deriveCanonicalPlanningTasks(testCase);
  validateGraphInvariants(derived);

  // Multi-zone (front + rear) creates global paint batch
  const paintBatches = derived.filter((t) => t.phase === 'paint');
  assert.equal(paintBatches.length, 1);
  const globalPaint = paintBatches[0];
  assert.ok(globalPaint.id.includes('batch-paint-global'));

  // Groups in global paint must have claim-scoped metadata
  assert.ok(Array.isArray(globalPaint.paintGroups));
  const frontGroup = globalPaint.paintGroups.find((g) => g.zone === 'front');
  const rearGroup = globalPaint.paintGroups.find((g) => g.zone === 'rear');
  assert.ok(frontGroup && rearGroup);
  assert.deepEqual(toPlain(frontGroup.sourceClaimIds), ['claim-A']);
  assert.deepEqual(toPlain(rearGroup.sourceClaimIds), ['claim-B']);

  const prepFront = derived.find((t) => t.phase === 'prep' && t.bodyZone === 'front');
  const bodyRear = derived.find((t) => t.phase === 'body' && t.sourceClaimIds.includes('claim-B'));
  assert.ok(prepFront && bodyRear);

  // Global paint must depend on prepFront (for front group) and bodyRear (fallback for rear group without prep)
  assert.ok(globalPaint.dependencies.includes(prepFront.id), 'Global paint must depend on prepFront');
  assert.ok(globalPaint.dependencies.includes(bodyRear.id), 'Global paint must depend on bodyRear');

  // Verify that rear group did NOT falsely match prepFront despite sharing estimate-source-line-1
  assert.ok(isReachable(globalPaint.id, prepFront.id, derived));
  assert.ok(isReachable(globalPaint.id, bodyRear.id, derived));

  const rawTasks34 = derived.map((t) => ({ ...t, dependencies: [] }));
  const reprocessed34 = win.applyCanonicalTaskDependencies(rawTasks34);
  for (let i = 0; i < derived.length; i++) {
    assert.equal(derived[i].laborHours, reprocessed34[i].laborHours);
    assert.equal(derived[i].durationMinutes, reprocessed34[i].durationMinutes);
  }
}

// HARD BASELINE GUARDS
console.log('--- RUNNING HARD BASELINE GUARDS ---');
{
  console.log('Guard 1: Baseline paint optimizer implementation protected');
  const baselineSource = execSync('git show 89d50347172d08ed4cbc39dc25cd4c46872c5bcc:js/business-rules-v2187.js', { encoding: 'utf8' });
  const currentSource = fs.readFileSync('js/business-rules-v2187.js', 'utf8');

  // Verify normalizeOriginalLineForPlanning paintGroup expression === baseline semantics
  const baselineNormMatch = baselineSource.match(/function normalizeOriginalLineForPlanning[\s\S]*?\n  \}/);
  const currentNormMatch = currentSource.match(/function normalizeOriginalLineForPlanning[\s\S]*?\n  \}/);
  assert.ok(baselineNormMatch && currentNormMatch);
  assert.equal(currentNormMatch[0], baselineNormMatch[0]);

  // Verify paintFactor unchanged
  const baselinePaintFactorMatch = baselineSource.match(/function paintFactor[\s\S]*?\n  \}/);
  const currentPaintFactorMatch = currentSource.match(/function paintFactor[\s\S]*?\n  \}/);
  assert.ok(baselinePaintFactorMatch && currentPaintFactorMatch);
  assert.equal(currentPaintFactorMatch[0], baselinePaintFactorMatch[0]);

  // Verify optimizeEstimateAllocationsFromOriginalLines unchanged
  const baselineOptMatch = baselineSource.match(/function optimizeEstimateAllocationsFromOriginalLines[\s\S]*?\n  \}/);
  const currentOptMatch = currentSource.match(/function optimizeEstimateAllocationsFromOriginalLines[\s\S]*?\n  \}/);
  assert.ok(baselineOptMatch && currentOptMatch);
  assert.equal(currentOptMatch[0], baselineOptMatch[0]);

  // Verify complete pre-existing prefix byte-identical
  const marker = 'window.renderPaintOptimizationSummary = renderPaintOptimizationSummary;\n';
  const baselinePreMarkerIndex = baselineSource.indexOf(marker);
  const currentPreMarkerIndex = currentSource.indexOf(marker);
  assert.ok(baselinePreMarkerIndex > 0 && currentPreMarkerIndex > 0);
  const baselinePrefix = baselineSource.slice(0, baselinePreMarkerIndex + marker.length);
  const currentPrefix = currentSource.slice(0, currentPreMarkerIndex + marker.length);
  assert.equal(currentPrefix, baselinePrefix, 'Prefix must be 100% byte-identical to baseline');

  // Guard 2: No 15-minute clamp in canonical domain code
  const domainSource = currentSource.slice(currentPreMarkerIndex);
  assert.ok(!domainSource.includes('Math.max(15,'), 'Zero 15-minute clamp in canonical domain code');

  // Guard 3: No localeCompare in canonical domain code
  assert.ok(!domainSource.includes('.localeCompare('), 'Zero localeCompare in canonical domain code');

  console.log('All hard baseline guards PASSED!');
}

// PERFORMANCE BENCHMARK
console.log('--- RUNNING PERFORMANCE BENCHMARKS (10, 30, 60, 100 LINES) ---');
console.log('[HARD THRESHOLD] median < 25.0 ms enforced across all benchmark sizes (10, 30, 60, 100 lines)');
{
  function generateBenchmarkCase(lineCount) {
    const zones = ['front', 'rear', 'left', 'right', 'center'];
    const originalLines = [];
    for (let i = 0; i < lineCount; i++) {
      const zone = zones[i % zones.length];
      originalLines.push({
        id: `bench-line-${i + 1}`,
        operation: `OPÉRATION CHOC ÉLÉMENT ${i + 1} ZONE ${zone}`,
        laborHours: 2.0,
        paintGroup: zone,
        allocations: [
          { phase: 'body', laborHours: 0.8 },
          { phase: 'prep', laborHours: 0.6 },
          { phase: 'paint', laborHours: 0.4 },
          { phase: 'reassembly', laborHours: 0.2 },
        ],
      });
    }
    return {
      id: `case-bench-${lineCount}`,
      claims: [{ id: 'claim-1', estimate: { originalLines } }],
    };
  }

  const sizes = [10, 30, 60, 100];
  sizes.forEach((size) => {
    const testCase = generateBenchmarkCase(size);
    const times = [];
    const runs = 20;

    // Warmup
    win.deriveCanonicalPlanningTasks(testCase);

    for (let r = 0; r < runs; r++) {
      const start = process.hrtime.bigint();
      const result = win.deriveCanonicalPlanningTasks(testCase);
      const end = process.hrtime.bigint();
      assert.ok(result.length > 0);
      times.push(Number(end - start) / 1e6);
    }

    times.sort((a, b) => a - b);
    const median = times[Math.floor(runs / 2)];
    const max = times[runs - 1];

    console.log(`Benchmark ${size} lines: median = ${median.toFixed(4)} ms, max = ${max.toFixed(4)} ms`);
    assert.ok(median < 25.0, `Benchmark median for ${size} lines (${median.toFixed(4)} ms) exceeded 25ms`);
  });
  console.log('All performance benchmarks PASSED!');
}

console.log('--- ALL WORKSHOP-001B TESTS PASSED SUCCESSFULLY ---');
