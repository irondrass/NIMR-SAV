import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { context, run } = createNimrVmContext({
  filename: "planner-scale-regression-gate-p1007.js",
  console: { log() {}, warn() {}, error: console.error },
});

const START = "2026-09-07T07:00:00.000Z";
const UNRELATED_START = "2027-01-04T07:00:00.000Z";
const UNRELATED_END = "2027-01-04T08:00:00.000Z";
const SCALE_TIERS = [0, 2000, 10000];
const WORK_HOURS = {
  0: [],
  1: [["08:00", "12:00"], ["13:00", "17:00"]],
  2: [["08:00", "12:00"], ["13:00", "17:00"]],
  3: [["08:00", "12:00"], ["13:00", "17:00"]],
  4: [["08:00", "12:00"], ["13:00", "17:00"]],
  5: [["08:00", "12:00"], ["13:00", "17:00"]],
  6: [],
};
const CLOSED_HOURS = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function resource(id, role, overrides = {}) {
  return {
    id,
    name: id,
    role,
    category: role,
    site: "internal",
    active: true,
    calendar: { workHours: WORK_HOURS },
    ...overrides,
  };
}

const BASE_RESOURCES = [
  resource("body-1", "tolier"),
  resource("body-2", "tolier"),
  resource("paint-1", "peintre"),
  resource("paint-2", "peintre"),
  resource("prep-zone", "zone_preparation"),
  resource("paint-booth", "cabine"),
  resource("history-resource", "history"),
];

function booking(id, caseId, resourceIds, start, end, overrides = {}) {
  const segments = [{ start, end }];
  return {
    id,
    caseId,
    key: "body",
    taskId: id,
    businessTaskId: id,
    title: id,
    start,
    end,
    segments,
    plannedSegments: segments,
    plannedMinutes: (new Date(end) - new Date(start)) / 60000,
    durationMinutes: (new Date(end) - new Date(start)) / 60000,
    resourceIds,
    primaryResourceId: resourceIds[0] || "",
    equipmentResourceIds: resourceIds.slice(1),
    status: "planned",
    vehicleExclusive: true,
    parallelizable: false,
    vehicleLocation: "internal",
    ...overrides,
  };
}

const unrelatedCache = new Map();
function unrelatedBookings(count) {
  if (!unrelatedCache.has(count)) {
    unrelatedCache.set(count, Array.from({ length: count }, (_, index) => booking(
      `unrelated-${count}-${index}`,
      `unrelated-case-${count}-${index}`,
      ["history-resource"],
      UNRELATED_START,
      UNRELATED_END,
    )));
  }
  return unrelatedCache.get(count).map((entry) => ({
    ...entry,
    resourceIds: [...entry.resourceIds],
    equipmentResourceIds: [...entry.equipmentResourceIds],
    segments: entry.segments.map((segment) => ({ ...segment })),
    plannedSegments: entry.plannedSegments.map((segment) => ({ ...segment })),
  }));
}

function canonicalTask(id, key = "body", dependencies = [], overrides = {}) {
  const requiredRole = {
    body: "tolier",
    reassembly: "tolier",
    prep: "peintre",
    paint: "peintre",
    finish: "peintre",
  }[key] || "tolier";
  const equipmentRole = key === "prep" ? "zone_preparation" : (key === "paint" ? "cabine" : "");
  return {
    id,
    taskId: id,
    key,
    title: `${key}-${id}`,
    durationMinutes: 60,
    dependencies,
    requiredRole,
    equipmentRole,
    parallelizable: false,
    vehicleExclusive: false,
    vehicleLocation: "internal",
    sourceKind: "canonical_graph",
    taskModelVersion: 1,
    ...overrides,
  };
}

function install({ resources = BASE_RESOURCES, bookings = [], cases = [] } = {}) {
  context.__p1007State = {
    resources,
    bookings,
    cases,
    users: [{ id: "chief", name: "Chief", role: "chef_atelier", active: true }],
    currentUserId: "chief",
    settings: { calendar: WORK_HOURS, fastLaneEnabled: false },
  };
  run("state = normalizeState(__p1007State); generatedProposals = {}; invalidateStateReplacementIndexes();");
}

function proposalSignature(proposal) {
  return (proposal?.steps || []).map((step) => ({
    key: step.key,
    taskId: step.taskId,
    businessTaskId: step.businessTaskId,
    resourceIds: [...(step.resourceIds || [])],
    primaryResourceId: step.primaryResourceId || "",
    equipmentResourceIds: [...(step.equipmentResourceIds || [])],
    start: step.start,
    end: step.end,
    segments: (step.segments || []).map((segment) => ({ start: segment.start, end: segment.end })),
    dependencies: [...(step.dependencies || [])],
    parallelizable: step.parallelizable === true,
    vehicleExclusive: step.vehicleExclusive !== false,
    sourceKind: step.sourceKind,
    taskModelVersion: step.taskModelVersion,
  }));
}

function generate(item, { resources = BASE_RESOURCES, bookings = [], cases = null } = {}) {
  const installedCases = cases || [item];
  install({ resources, bookings, cases: installedCases });
  context.__p1007Item = run("state.cases[0]");
  context.__p1007Start = START;
  const before = JSON.stringify(toPlain(run("state.bookings")));
  const startedAt = performance.now();
  const proposal = toPlain(run("generateSingleProposal(__p1007Item, new Date(__p1007Start))"));
  const elapsedMs = performance.now() - startedAt;
  return {
    proposal,
    signature: proposalSignature(proposal),
    stats: toPlain(run("getLastIndexedPlannerViewStats()")),
    slotStats: toPlain(run("getPlanningSlotSearchStats()")),
    conflictStats: toPlain(run("getPlanningConflictCandidateStats()")),
    before,
    after: JSON.stringify(toPlain(run("state.bookings"))),
    elapsedMs,
  };
}

function productiveMinutes(step) {
  return (step?.segments || []).reduce(
    (sum, segment) => sum + ((new Date(segment.end) - new Date(segment.start)) / 60000),
    0,
  );
}

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  return null;
}

const checks = [];
const metrics = {
  tiers: {},
  relevantConflict: {},
  appointmentDates: {},
  longWork600: {},
  resourceCount: {},
  technicianEquipment: {},
  deterministicRepeat: {},
};

function check(name, callback) {
  try {
    callback();
    checks.push({ name, pass: true });
  } catch (error) {
    checks.push({ name, pass: false, error: error?.stack || error?.message || String(error) });
  }
}

const parityItem = {
  id: "scale-parity",
  planningTasks: [canonicalTask("scale-body", "body")],
};
const tierRuns = new Map();

check("A unrelated history parity at 0, 2000 and 10000", () => {
  for (const count of SCALE_TIERS) {
    const result = generate(parityItem, { bookings: unrelatedBookings(count) });
    tierRuns.set(count, result);
    metrics.tiers[count] = {
      elapsedMs: Number(result.elapsedMs.toFixed(3)),
      selectedPrimaryResource: result.proposal.steps[0].primaryResourceId,
      indexBuildRows: count,
      conflictCandidateSourceCount: result.conflictStats.sourceCount,
      conflictCandidateRowsReturned: result.conflictStats.candidateCount,
      ...result.stats,
    };
    assert.equal(result.before, result.after, `tier ${count} must not mutate productive history`);
  }
  const baseline = tierRuns.get(0).signature;
  assert.deepEqual(tierRuns.get(2000).signature, baseline);
  assert.deepEqual(tierRuns.get(10000).signature, baseline);
});

check("B zero full-array candidate scans at every scale", () => {
  for (const count of SCALE_TIERS) {
    assert.equal(tierRuns.get(count).stats.fullArrayScansInCandidateLoops, 0, `tier ${count}`);
  }
});

check("C candidate work is independent of unrelated history", () => {
  const values = SCALE_TIERS.map((count) => tierRuns.get(count).stats.candidateEvaluations);
  assert.deepEqual(values, [values[0], values[0], values[0]]);
  assert.ok(values[0] > 0);
});

check("D lookup workload excludes one-time index construction", () => {
  const lookups = SCALE_TIERS.map((count) => tierRuns.get(count).stats.indexLookups);
  assert.deepEqual(lookups, [lookups[0], lookups[0], lookups[0]]);
  assert.ok(lookups[0] > 0);
  assert.deepEqual(SCALE_TIERS.map((count) => metrics.tiers[count].indexBuildRows), SCALE_TIERS);
  assert.deepEqual(
    SCALE_TIERS.map((count) => tierRuns.get(count).conflictStats.sourceCount),
    SCALE_TIERS,
  );
  const candidateRows = SCALE_TIERS.map((count) => tierRuns.get(count).conflictStats.candidateCount);
  assert.deepEqual(candidateRows, [candidateRows[0], candidateRows[0], candidateRows[0]]);
  assert.equal(tierRuns.get(10000).conflictStats.indexed, true);
});

check("E resource-load cache work is bounded by queried resources", () => {
  const recomputations = SCALE_TIERS.map((count) => tierRuns.get(count).stats.resourceLoadRecomputations);
  assert.deepEqual(recomputations, [recomputations[0], recomputations[0], recomputations[0]]);
  const compatibleResourceCount = 2;
  const queriedLoadWindowsPerResource = 2; // planning horizon load + candidate-day load
  assert.ok(
    recomputations[0] <= compatibleResourceCount * queriedLoadWindowsPerResource,
    "load recomputations must be bounded by queried resources and load windows",
  );
});

check("F relevant conflict behavior is unchanged by 10000 unrelated rows", () => {
  const relevant = booking(
    "relevant-conflict",
    "existing-case",
    ["body-1"],
    "2026-09-07T07:00:00.000Z",
    "2026-09-07T08:00:00.000Z",
  );
  const item = {
    id: "scale-conflict",
    planningTasks: [canonicalTask("conflict-body", "body", [], { resourceIds: ["body-1"] })],
  };
  const relevantOnly = generate(item, { bookings: [relevant] });
  const scaled = generate(item, { bookings: [relevant, ...unrelatedBookings(10000)] });
  metrics.relevantConflict = {
    relevantOnly: { indexedView: relevantOnly.stats, conflictCandidates: relevantOnly.conflictStats },
    scaled: { indexedView: scaled.stats, conflictCandidates: scaled.conflictStats },
  };
  assert.deepEqual(scaled.signature, relevantOnly.signature);
  assert.equal(scaled.proposal.steps[0].start, "2026-09-07T08:00:00.000Z");
  assert.equal(scaled.stats.fullArrayScansInCandidateLoops, 0);
  assert.equal(scaled.stats.candidateEvaluations, relevantOnly.stats.candidateEvaluations);
  assert.equal(scaled.conflictStats.candidateCount, relevantOnly.conflictStats.candidateCount);
  assert.equal(scaled.conflictStats.sourceCount, 10001);
  assert.equal(scaled.conflictStats.indexed, true);
});

check("G appointment-date search reuses indexed history without mutation", () => {
  const item = { id: "scale-dates", planningTasks: [canonicalTask("date-body", "body")] };
  const runDates = (bookings) => {
    install({ bookings, cases: [item] });
    context.__p1007Item = run("state.cases[0]");
    const before = JSON.stringify(toPlain(run("state.bookings")));
    const dates = toPlain(run("buildAvailableAppointmentDates(__p1007Item, new Date('2026-09-07T07:00:00.000Z'), 7, 3)"));
    const stats = toPlain(run("getLastIndexedPlannerViewStats()"));
    return { dates, stats, before, after: JSON.stringify(toPlain(run("state.bookings"))) };
  };
  const relevantOnly = runDates([]);
  const scaled = runDates(unrelatedBookings(10000));
  metrics.appointmentDates = { count: scaled.dates.length, stats: scaled.stats };
  assert.equal(scaled.dates.length, 3);
  assert.deepEqual(scaled.dates, relevantOnly.dates);
  assert.equal(scaled.before, scaled.after);
  assert.equal(scaled.stats.fullArrayScansInCandidateLoops, 0);
});

check("H fixed-resource 600-minute work stays bounded at scale", () => {
  const item = {
    id: "scale-long-work",
    planningTasks: [canonicalTask("long-body", "body", [], { durationMinutes: 600, resourceIds: ["body-1"] })],
  };
  const result = generate(item, { bookings: unrelatedBookings(10000) });
  const step = result.proposal.steps[0];
  metrics.longWork600 = { indexedView: result.stats, slotSearch: result.slotStats };
  assert.equal(result.proposal.steps.length, 1);
  assert.ok(step.segments.length > 1);
  assert.equal(productiveMinutes(step), 600);
  assert.deepEqual(step.resourceIds, ["body-1"]);
  assert.ok(result.slotStats.candidateEvaluations <= 1);
  assert.ok(result.slotStats.slotRebuilds <= 1);
  assert.equal(result.slotStats.daysSearched, 2);
  assert.equal(result.stats.fullArrayScansInCandidateLoops, 0);
});

check("I hard assignment locks retain strict errors at scale", () => {
  const validItem = {
    id: "scale-lock-valid",
    durations: { body: 1 },
    stepAssignmentLocks: { body: { resourceId: "body-1" } },
  };
  const valid = generate(validItem, { bookings: unrelatedBookings(10000) });
  assert.deepEqual(valid.proposal.steps[0].resourceIds, ["body-1"]);

  const unavailableResources = BASE_RESOURCES.map((entry) => (
    entry.id === "body-1" ? { ...entry, calendar: { workHours: CLOSED_HOURS } } : entry
  ));
  install({ resources: unavailableResources, bookings: unrelatedBookings(10000), cases: [validItem] });
  context.__p1007Item = run("state.cases[0]");
  const unavailable = captureError(() => run("generateSingleProposal(__p1007Item, new Date('2026-09-07T07:00:00.000Z'))"));
  assert.equal(unavailable?.code, "assignment_lock_unavailable");

  const inactiveResources = BASE_RESOURCES.map((entry) => (
    entry.id === "body-1" ? { ...entry, active: false } : entry
  ));
  install({ resources: inactiveResources, bookings: unrelatedBookings(10000), cases: [validItem] });
  context.__p1007Item = run("state.cases[0]");
  const incompatible = captureError(() => run("generateSingleProposal(__p1007Item, new Date('2026-09-07T07:00:00.000Z'))"));
  assert.equal(incompatible?.code, "assignment_lock_incompatible");
});

check("J canonical task resourceIds outranks a conflicting assignment lock at scale", () => {
  const item = {
    id: "scale-hard-precedence",
    stepAssignmentLocks: { body: { resourceId: "body-2" } },
    stepPreferredResources: { body: "body-2" },
    planningTasks: [canonicalTask("hard-body", "body", [], {
      resourceIds: ["body-1"],
      preferredResourceId: "body-2",
    })],
  };
  const result = generate(item, { bookings: unrelatedBookings(10000) });
  assert.deepEqual(result.proposal.steps[0].resourceIds, ["body-1"]);
  assert.equal(result.proposal.steps[0].primaryResourceId, "body-1");
});

check("K graph continuity remains soft and ancestor-derived at scale", () => {
  const tasks = [
    canonicalTask("body-source", "body", [], { preferredResourceId: "body-1" }),
    canonicalTask("reassembly-target", "reassembly", ["body-source"]),
    canonicalTask("prep-source", "prep", [], { preferredResourceId: "paint-1" }),
    canonicalTask("paint-target", "paint", ["prep-source"]),
    canonicalTask("finish-target", "finish", ["paint-target"]),
  ];
  const result = generate({ id: "scale-continuity", planningTasks: tasks }, { bookings: unrelatedBookings(10000) });
  const byTask = Object.fromEntries(result.proposal.steps.map((step) => [step.taskId, step]));
  assert.equal(byTask["body-source"].primaryResourceId, byTask["reassembly-target"].primaryResourceId);
  assert.equal(byTask["prep-source"].primaryResourceId, byTask["paint-target"].primaryResourceId);
  assert.equal(byTask["paint-target"].primaryResourceId, byTask["finish-target"].primaryResourceId);
  assert.deepEqual(byTask["reassembly-target"].dependencies, ["body-source"]);
  assert.deepEqual(byTask["paint-target"].dependencies, ["prep-source"]);
  assert.deepEqual(byTask["finish-target"].dependencies, ["paint-target"]);
});

check("L independent parallel graph branches remain parallel at scale", () => {
  const tasks = [
    canonicalTask("parallel-body", "body", [], { preferredResourceId: "body-1", parallelizable: true, vehicleExclusive: false }),
    canonicalTask("parallel-reassembly", "reassembly", [], { parallelizable: true, vehicleExclusive: false }),
  ];
  const result = generate({ id: "scale-parallel", planningTasks: tasks }, { bookings: unrelatedBookings(10000) });
  const byTask = Object.fromEntries(result.proposal.steps.map((step) => [step.taskId, step]));
  assert.deepEqual(byTask["parallel-body"].dependencies, []);
  assert.deepEqual(byTask["parallel-reassembly"].dependencies, []);
  assert.equal(byTask["parallel-body"].parallelizable, true);
  assert.equal(byTask["parallel-reassembly"].parallelizable, true);
  assert.equal(byTask["parallel-body"].vehicleExclusive, false);
  assert.equal(byTask["parallel-reassembly"].vehicleExclusive, false);
  assert.equal(byTask["parallel-body"].start, byTask["parallel-reassembly"].start);
});

check("M candidate evaluations scale with compatible resource count only", () => {
  for (const count of [2, 8, 24]) {
    const resources = [resource("history-resource", "history"), ...Array.from({ length: count }, (_, index) => resource(`body-${index + 1}`, "tolier"))];
    const item = { id: `resource-scale-${count}`, planningTasks: [canonicalTask(`resource-task-${count}`, "body")] };
    const result = generate(item, { resources, bookings: unrelatedBookings(10000) });
    metrics.resourceCount[count] = result.stats;
    assert.equal(result.stats.candidateEvaluations, count, `candidate evaluations should equal ${count} compatible resources`);
    assert.equal(result.stats.fullArrayScansInCandidateLoops, 0);
  }
});

check("N technician-equipment work scales with combinations, not history", () => {
  const resources = [
    resource("history-resource", "history"),
    ...Array.from({ length: 4 }, (_, index) => resource(`scale-paint-${index + 1}`, "peintre")),
    ...Array.from({ length: 3 }, (_, index) => resource(`scale-booth-${index + 1}`, "cabine")),
  ];
  const item = { id: "combo-scale", planningTasks: [canonicalTask("combo-paint", "paint")] };
  const relevantOnly = generate(item, { resources, bookings: [] });
  const scaled = generate(item, { resources, bookings: unrelatedBookings(10000) });
  metrics.technicianEquipment = { relevantOnly: relevantOnly.stats, scaled: scaled.stats, combinations: 12 };
  assert.deepEqual(scaled.signature, relevantOnly.signature);
  assert.equal(scaled.stats.candidateEvaluations, 12);
  assert.equal(scaled.stats.candidateEvaluations, relevantOnly.stats.candidateEvaluations);

  const hardItem = {
    id: "combo-hard-scale",
    stepAssignmentLocks: { paint: { resourceId: "scale-paint-2" } },
    planningTasks: [canonicalTask("combo-hard-paint", "paint", [], {
      resourceIds: ["scale-paint-1", "scale-booth-1"],
    })],
  };
  const hard = generate(hardItem, { resources, bookings: unrelatedBookings(10000) });
  assert.deepEqual(hard.proposal.steps[0].resourceIds, ["scale-paint-1", "scale-booth-1"]);
});

check("O forty-task canonical graph preserves every node and edge", () => {
  const chainCount = 4;
  const tasksPerChain = 10;
  const resources = [resource("history-resource", "history")];
  const tasks = [];
  for (let chain = 0; chain < chainCount; chain += 1) {
    const resourceId = `graph-body-${chain}`;
    resources.push(resource(resourceId, "tolier"));
    for (let index = 0; index < tasksPerChain; index += 1) {
      const taskId = `chain-${chain}-task-${index}`;
      tasks.push(canonicalTask(taskId, "body", index ? [`chain-${chain}-task-${index - 1}`] : [], {
        durationMinutes: 15,
        resourceIds: [resourceId],
        parallelizable: true,
        vehicleExclusive: false,
      }));
    }
  }
  const result = generate({ id: "scale-graph-40", planningTasks: tasks }, { resources, bookings: unrelatedBookings(10000) });
  assert.equal(result.proposal.steps.length, 40);
  assert.equal(new Set(result.proposal.steps.map((step) => step.taskId)).size, 40);
  assert.deepEqual(result.proposal.steps.map((step) => step.taskId).sort(), tasks.map((task) => task.taskId).sort());
  for (const task of tasks) {
    const step = result.proposal.steps.find((entry) => entry.taskId === task.taskId);
    assert.equal(step.businessTaskId, task.taskId);
    assert.deepEqual(step.dependencies, task.dependencies);
  }
});

check("P representative 10000-history workload is byte-deterministic", () => {
  const bookings = unrelatedBookings(10000);
  install({ bookings, cases: [parityItem] });
  context.__p1007Item = run("state.cases[0]");
  const runs = [];
  for (let index = 0; index < 3; index += 1) {
    const proposal = toPlain(run("generateSingleProposal(__p1007Item, new Date('2026-09-07T07:00:00.000Z'))"));
    runs.push({ signature: proposalSignature(proposal), stats: toPlain(run("getLastIndexedPlannerViewStats()")) });
  }
  metrics.deterministicRepeat = runs.map((entry) => entry.stats);
  assert.deepEqual(runs[1], runs[0]);
  assert.deepEqual(runs[2], runs[0]);
});

check("Q mixed productive history remains byte-identical", () => {
  const mixed = ["planned", "started", "paused", "completed"].map((status, index) => booking(
    `productive-${status}`,
    `productive-case-${index}`,
    ["history-resource"],
    `2026-10-${String(index + 5).padStart(2, "0")}T07:00:00.000Z`,
    `2026-10-${String(index + 5).padStart(2, "0")}T08:00:00.000Z`,
    { status, actualWorkedMinutes: status === "planned" ? 0 : 15 },
  ));
  const bookings = [...mixed, ...unrelatedBookings(10000)];
  install({ bookings, cases: [parityItem] });
  context.__p1007Item = run("state.cases[0]");
  const before = JSON.stringify(toPlain(run("state.bookings")));
  run("generateSingleProposal(__p1007Item, new Date('2026-09-07T07:00:00.000Z'))");
  run("generateSingleProposal(__p1007Item, new Date('2026-09-07T07:00:00.000Z'))");
  assert.equal(JSON.stringify(toPlain(run("state.bookings"))), before);
});

check("R proposal overlay remains local, capacity-aware and fully torn down", () => {
  const resources = BASE_RESOURCES.map((entry) => (
    entry.id === "body-1" ? { ...entry, simultaneousCapacity: 1, dailyCapacityMinutes: 480 } : entry
  ));
  const tasks = [
    canonicalTask("overlay-a", "body", [], { durationMinutes: 300, resourceIds: ["body-1"] }),
    canonicalTask("overlay-b", "reassembly", ["overlay-a"], { durationMinutes: 300, resourceIds: ["body-1"] }),
  ];
  const result = generate({ id: "scale-overlay", planningTasks: tasks }, { resources, bookings: unrelatedBookings(10000) });
  const second = result.proposal.steps.find((step) => step.taskId === "overlay-b");
  assert.ok(second.segments.some((segment) => segment.start.slice(0, 10) === "2026-09-08"));
  assert.equal(result.before, result.after);
  assert.equal(result.stats.fullArrayScansInCandidateLoops, 0);
  assert.equal(result.stats.maxOverlaySize, 2);
  context.__p1007Fresh = run("createIndexedPlannerBookingView(state.bookings)");
  assert.equal(run("__p1007Fresh.getOverlaySize()"), 0);
});

for (const result of checks) {
  console.log(`${result.pass ? "PASS" : "FAIL"} ${result.name}${result.error ? `\n${result.error}` : ""}`);
}
const failures = checks.filter((result) => !result.pass);
console.log(`P1-007 planner scale regression gate: ${checks.length - failures.length}/${checks.length} PASS`);
console.log(JSON.stringify({ scaleTiers: SCALE_TIERS, metrics }, null, 2));
if (failures.length) process.exitCode = 1;
