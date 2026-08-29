import assert from "node:assert/strict";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { context, run } = createNimrVmContext({
  filename: "graph-continuity-assignment-locks-p1006.js",
  console: { log() {}, warn() {}, error: console.error },
});

const START = "2026-09-07T07:00:00.000Z";
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

const DEFAULT_RESOURCES = [
  resource("body-1", "tolier", { compatibleRoles: ["tolier", "senior"] }),
  resource("body-2", "tolier", { compatibleRoles: ["tolier", "senior"] }),
  resource("paint-1", "peintre"),
  resource("paint-2", "peintre"),
  resource("prep-zone", "zone_preparation"),
  resource("paint-booth", "cabine"),
  resource("lift-1", "pont_mecanique"),
  resource("lift-2", "pont_mecanique"),
  resource("quality", "controle"),
];

function install({ resources = DEFAULT_RESOURCES, bookings = [], cases = [] } = {}) {
  context.__p1006State = {
    resources,
    bookings,
    cases,
    users: [{ id: "chief", name: "Chief", role: "chef_atelier", active: true }],
    currentUserId: "chief",
    settings: { calendar: WORK_HOURS, fastLaneEnabled: false },
  };
  run("state = normalizeState(__p1006State); generatedProposals = {}; invalidateStateReplacementIndexes();");
}

function canonicalTask(id, key, dependencies = [], overrides = {}) {
  const templateRole = {
    body: "tolier",
    reassembly: "tolier",
    prep: "peintre",
    paint: "peintre",
    finish: "peintre",
    mechanical: "mecanicien",
    quality: "controle",
  }[key] || "tolier";
  const equipmentRole = key === "prep" ? "zone_preparation" : (key === "paint" ? "cabine" : "");
  return {
    id,
    taskId: id,
    key,
    title: `${key}-${id}`,
    durationMinutes: 60,
    dependencies,
    requiredRole: templateRole,
    equipmentRole,
    parallelizable: false,
    vehicleExclusive: false,
    vehicleLocation: "internal",
    sourceKind: "canonical_graph",
    taskModelVersion: 1,
    ...overrides,
  };
}

function scheduleGraph(item, tasks = item.planningTasks) {
  install({ cases: [{ ...item, planningTasks: tasks }] });
  context.__p1006Item = run("state.cases[0]");
  return toPlain(run("scheduleTaskGraph(__p1006Item, __p1006Item.planningTasks, new Date('2026-09-07T07:00:00.000Z'), [])"));
}

function scheduleSequential(item, resources = DEFAULT_RESOURCES, bookings = []) {
  install({ resources, bookings, cases: [item] });
  context.__p1006Item = run("state.cases[0]");
  return toPlain(run("scheduleSequentialPipeline(__p1006Item, new Date('2026-09-07T07:00:00.000Z'), state.bookings)"));
}

function step(proposal, key) {
  return proposal.steps.find((entry) => entry.key === key);
}

function expectPlanningError(callback, code) {
  let thrown = null;
  try {
    callback();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, `expected ${code}`);
  assert.equal(thrown.code, code, thrown.message);
  assert.match(thrown.message, /verrou|lock|ressource/i);
  return thrown;
}

const checks = [];
function check(name, callback) {
  try {
    callback();
    checks.push({ name, pass: true });
  } catch (error) {
    checks.push({ name, pass: false, error: error.message || String(error) });
  }
}

check("A sequential body to reassembly continuity", () => {
  const proposal = scheduleSequential({ id: "seq-body", durations: { body: 1, reassembly: 1 }, stepPreferredResources: { body: "body-1" } });
  assert.equal(step(proposal, "body").primaryResourceId, "body-1");
  assert.equal(step(proposal, "reassembly").primaryResourceId, "body-1");
});

check("B sequential prep to paint to finish continuity", () => {
  const proposal = scheduleSequential({ id: "seq-paint", durations: { prep: 1, paint: 1, finish: 1 }, stepPreferredResources: { prep: "paint-1" } });
  assert.deepEqual(proposal.steps.filter((entry) => ["prep", "paint", "finish"].includes(entry.key)).map((entry) => entry.primaryResourceId), ["paint-1", "paint-1", "paint-1"]);
});

check("C graph body to reassembly continuity", () => {
  const tasks = [
    canonicalTask("op-17", "body", [], { preferredResourceId: "body-1" }),
    canonicalTask("op-81", "reassembly", ["op-17"]),
  ];
  const proposal = scheduleGraph({ id: "graph-body", durations: {}, planningTasks: tasks }, tasks);
  assert.equal(step(proposal, "body").primaryResourceId, "body-1");
  assert.equal(step(proposal, "reassembly").primaryResourceId, "body-1");
});

check("D graph prep to paint to finish continuity", () => {
  const tasks = [
    canonicalTask("source-prep", "prep", [], { preferredResourceId: "paint-1" }),
    canonicalTask("middle-paint", "paint", ["source-prep"]),
    canonicalTask("last-finish", "finish", ["middle-paint"]),
  ];
  const proposal = scheduleGraph({ id: "graph-paint", durations: {}, planningTasks: tasks }, tasks);
  assert.deepEqual(proposal.steps.filter((entry) => ["prep", "paint", "finish"].includes(entry.key)).map((entry) => entry.primaryResourceId), ["paint-1", "paint-1", "paint-1"]);
});

check("E soft continuity falls back when continuity resource has no horizon slot", () => {
  const resources = [
    resource("body-1", "tolier", { calendar: { workHours: CLOSED_HOURS } }),
    resource("body-2", "tolier"),
  ];
  install({ resources });
  context.__p1006GraphItem = {
    id: "fallback",
    planningTasks: [
      canonicalTask("body-source", "body", [], { resourceIds: ["body-1"], durationMinutes: 0 }),
      canonicalTask("reassembly-target", "reassembly", ["body-source"]),
    ],
  };
  const assignment = toPlain(run("createPlanningAssignmentContext()"));
  assignment.tolierId = "body-1";
  context.__p1006Assignment = assignment;
  context.__p1006Task = canonicalTask("reassembly-target", "reassembly", []);
  context.__p1006Item = { id: "fallback", stepPreferredResources: {}, stepAssignmentLocks: {} };
  const result = toPlain(run("buildInternalTaskStep(__p1006Item, __p1006Task, new Date('2026-09-07T07:00:00.000Z'), [], __p1006Assignment)"));
  assert.equal(result.primaryResourceId, "body-2");
});

check("F manual preference overrides automatic continuity", () => {
  const tasks = [
    canonicalTask("body-source", "body", [], { preferredResourceId: "body-1" }),
    canonicalTask("reassembly-target", "reassembly", ["body-source"], { preferredResourceId: "body-2" }),
  ];
  const proposal = scheduleGraph({ id: "manual-over-continuity", durations: {}, planningTasks: tasks }, tasks);
  assert.equal(step(proposal, "reassembly").primaryResourceId, "body-2");
});

check("G hard lock overrides preference", () => {
  const proposal = scheduleSequential({
    id: "lock-over-preference",
    durations: { body: 1 },
    stepPreferredResources: { body: "body-1" },
    stepAssignmentLocks: { body: { resourceId: "body-2" } },
  });
  assert.equal(step(proposal, "body").primaryResourceId, "body-2");
});

check("H hard lock overrides graph continuity", () => {
  const tasks = [canonicalTask("body-source", "body", [], { preferredResourceId: "body-1" }), canonicalTask("reassembly-target", "reassembly", ["body-source"])];
  const proposal = scheduleGraph({ id: "lock-over-continuity", durations: {}, planningTasks: tasks, stepAssignmentLocks: { reassembly: { resourceId: "body-2" } } }, tasks);
  assert.equal(step(proposal, "reassembly").primaryResourceId, "body-2");
});

check("I locked resource unavailable is explicit and never falls back", () => {
  const resources = [resource("body-1", "tolier", { calendar: { workHours: CLOSED_HOURS } }), resource("body-2", "tolier")];
  expectPlanningError(() => scheduleSequential({ id: "lock-unavailable", durations: { body: 1 }, stepAssignmentLocks: { body: { resourceId: "body-1" } } }, resources), "assignment_lock_unavailable");
});

check("J inactive locked resource is incompatible", () => {
  const resources = [resource("body-1", "tolier", { active: false }), resource("body-2", "tolier")];
  expectPlanningError(() => scheduleSequential({ id: "lock-inactive", durations: { body: 1 }, stepAssignmentLocks: { body: { resourceId: "body-1" } } }, resources), "assignment_lock_incompatible");
});

check("K missing locked resource is explicit", () => {
  expectPlanningError(() => scheduleSequential({ id: "lock-missing", durations: { body: 1 }, stepAssignmentLocks: { body: { resourceId: "missing" } } }), "assignment_lock_resource_missing");
});

check("L wrong-role locked resource is incompatible", () => {
  expectPlanningError(() => scheduleSequential({ id: "lock-role", durations: { body: 1 }, stepAssignmentLocks: { body: { resourceId: "paint-1" } } }), "assignment_lock_incompatible");
});

check("M wrong-category locked resource is incompatible", () => {
  const resources = [resource("body-basic", "tolier"), resource("body-senior", "tolier", { compatibleRoles: ["tolier", "senior"] })];
  const tasks = [canonicalTask("category-task", "body", [], { requiredCategory: "senior" })];
  expectPlanningError(() => {
    install({ resources, cases: [{ id: "lock-category", planningTasks: tasks, stepAssignmentLocks: { body: { resourceId: "body-basic" } } }] });
    run("scheduleTaskGraph(state.cases[0], state.cases[0].planningTasks, new Date('2026-09-07T07:00:00.000Z'), [])");
  }, "assignment_lock_incompatible");
});

check("N wrong-site locked resource is incompatible", () => {
  const resources = [resource("body-external", "tolier", { site: "external" }), resource("body-2", "tolier")];
  expectPlanningError(() => scheduleSequential({ id: "lock-site", durations: { body: 1 }, stepAssignmentLocks: { body: { resourceId: "body-external" } } }, resources), "assignment_lock_incompatible");
});

check("O explicit canonical task resourceIds is hard primary", () => {
  const tasks = [canonicalTask("hard-primary", "body", [], { resourceIds: ["body-2"], preferredResourceId: "body-1" })];
  const proposal = scheduleGraph({ id: "hard-primary", durations: {}, planningTasks: tasks }, tasks);
  assert.deepEqual(proposal.steps[0].resourceIds, ["body-2"]);
});

check("P explicit canonical technician and equipment pair is hard", () => {
  const resources = [...DEFAULT_RESOURCES, resource("mechanic", "mecanicien")];
  install({ resources });
  context.__p1006Task = canonicalTask("hard-pair", "mechanical", [], { resourceIds: ["mechanic", "lift-1"], equipmentRole: "pont_mecanique" });
  context.__p1006Item = { id: "hard-pair", stepPreferredResources: {}, stepAssignmentLocks: {} };
  const result = toPlain(run("buildInternalTaskStep(__p1006Item, __p1006Task, new Date('2026-09-07T07:00:00.000Z'), [])"));
  assert.deepEqual(result.resourceIds, ["mechanic", "lift-1"]);
});

check("Q explicit equipment unavailable never substitutes another equipment", () => {
  const resources = [...DEFAULT_RESOURCES.filter((entry) => entry.id !== "lift-1"), resource("mechanic", "mecanicien"), resource("lift-1", "pont_mecanique", { calendar: { workHours: CLOSED_HOURS } })];
  install({ resources });
  context.__p1006Task = canonicalTask("hard-pair-unavailable", "mechanical", [], { resourceIds: ["mechanic", "lift-1"], equipmentRole: "pont_mecanique" });
  context.__p1006Item = { id: "hard-pair-unavailable" };
  assert.throws(() => run("buildInternalTaskStep(__p1006Item, __p1006Task, new Date('2026-09-07T07:00:00.000Z'), [])"), /combinaison|ressource/i);
});

check("R independent parallel graph tasks receive no hidden continuity dependency", () => {
  const tasks = [
    canonicalTask("a-body", "body", [], { preferredResourceId: "body-1", parallelizable: true }),
    canonicalTask("z-reassembly", "reassembly", [], { parallelizable: true }),
  ];
  const proposal = scheduleGraph({ id: "parallel", durations: {}, planningTasks: tasks }, tasks);
  assert.deepEqual(step(proposal, "reassembly").dependencies, []);
  assert.equal(step(proposal, "reassembly").primaryResourceId, "body-2");
  assert.equal(step(proposal, "body").start, step(proposal, "reassembly").start);
});

check("S locked long-work remains one 600-minute booking on one resource", () => {
  const proposal = scheduleSequential({ id: "locked-long", durations: { body: 10 }, stepAssignmentLocks: { body: { resourceId: "body-1" } } });
  const body = step(proposal, "body");
  assert.deepEqual(body.resourceIds, ["body-1"]);
  assert.equal(body.segments.reduce((sum, segment) => sum + ((new Date(segment.end) - new Date(segment.start)) / 60000), 0), 600);
  assert.ok(body.segments.length > 1);
});

check("T proposal overlay carries graph continuity without mutating state.bookings", () => {
  const tasks = [canonicalTask("body-source", "body", [], { preferredResourceId: "body-1" }), canonicalTask("reassembly-target", "reassembly", ["body-source"])];
  install({ cases: [{ id: "overlay-continuity", planningTasks: tasks }] });
  const before = toPlain(run("state.bookings"));
  const proposal = toPlain(run("generateSingleProposal(state.cases[0], new Date('2026-09-07T07:00:00.000Z'))"));
  assert.equal(step(proposal, "reassembly").primaryResourceId, "body-1");
  assert.deepEqual(toPlain(run("state.bookings")), before);
});

check("U overlay capacity still constrains a hard-locked dependent task", () => {
  const resources = DEFAULT_RESOURCES.map((entry) => entry.id === "body-1" ? { ...entry, simultaneousCapacity: 1, dailyCapacityMinutes: 480 } : entry);
  const tasks = [canonicalTask("first", "body", [], { resourceIds: ["body-1"], durationMinutes: 300 }), canonicalTask("second", "reassembly", ["first"], { durationMinutes: 300 })];
  install({ resources, cases: [{ id: "overlay-lock", planningTasks: tasks, stepAssignmentLocks: { reassembly: { resourceId: "body-1" } } }] });
  const proposal = toPlain(run("generateSingleProposal(state.cases[0], new Date('2026-09-07T07:00:00.000Z'))"));
  assert.equal(step(proposal, "reassembly").primaryResourceId, "body-1");
  assert.ok(step(proposal, "reassembly").segments.some((segment) => segment.start.slice(0, 10) === "2026-09-08"));
});

check("V acceptance and reload preserve assignment identity and graph fields", () => {
  const tasks = [canonicalTask("accepted-body", "body", [], { durationMinutes: 600 })];
  install({ cases: [{ id: "accepted-lock", planningTasks: tasks, stepAssignmentLocks: { body: { resourceId: "body-1" } } }] });
  context.__p1006Proposal = run("generateSingleProposal(state.cases[0], new Date('2026-09-07T07:00:00.000Z'))");
  assert.equal(run("applyAcceptedPlanningProposal(state.cases[0], __p1006Proposal, { throwOnError: true, notify: false })"), true);
  context.__p1006Reload = run("normalizeState({ ...state, bookings: JSON.parse(JSON.stringify(state.bookings)) })");
  const booking = toPlain(run("__p1006Reload.bookings[0]"));
  assert.deepEqual(booking.resourceIds, ["body-1"]);
  assert.equal(booking.primaryResourceId, "body-1");
  assert.equal(booking.taskId, "accepted-body");
  assert.equal(booking.businessTaskId, "accepted-body");
  assert.deepEqual(booking.dependencies, []);
  assert.equal(booking.vehicleExclusive, false);
  assert.equal(booking.parallelizable, false);
  assert.ok(booking.segments.length > 1);
});

check("W repeated locked graph scheduling is deterministic", () => {
  const tasks = [canonicalTask("body-source", "body"), canonicalTask("reassembly-target", "reassembly", ["body-source"])];
  const item = { id: "repeat", durations: {}, planningTasks: tasks, stepAssignmentLocks: { body: { resourceId: "body-2" } } };
  const first = scheduleGraph(item, tasks);
  const second = scheduleGraph(item, tasks);
  assert.deepEqual(second, first);
});

check("X legacy manual preference remains soft", () => {
  const unavailable = DEFAULT_RESOURCES.map((entry) => entry.id === "body-1" ? { ...entry, calendar: { workHours: CLOSED_HOURS } } : entry);
  const proposal = scheduleSequential({ id: "legacy-soft", durations: { body: 1 }, stepPreferredResources: { body: "body-1" } }, unavailable);
  assert.equal(step(proposal, "body").primaryResourceId, "body-2");
});

check("Y productive bookings are only read and never reassigned", () => {
  const productive = ["planned", "started", "paused", "completed"].map((status, index) => ({
    id: `history-${status}`,
    caseId: `history-${index}`,
    key: "body",
    taskId: `history-${status}`,
    businessTaskId: `history-${status}`,
    resourceIds: ["body-1"],
    primaryResourceId: "body-1",
    equipmentResourceIds: [],
    start: `2026-09-${String(8 + index).padStart(2, "0")}T07:00:00.000Z`,
    end: `2026-09-${String(8 + index).padStart(2, "0")}T08:00:00.000Z`,
    segments: [{ start: `2026-09-${String(8 + index).padStart(2, "0")}T07:00:00.000Z`, end: `2026-09-${String(8 + index).padStart(2, "0")}T08:00:00.000Z` }],
    status,
  }));
  install({ bookings: productive, cases: [{ id: "new-case", durations: { body: 1 } }] });
  const before = toPlain(run("state.bookings"));
  run("generateSingleProposal(state.cases[0], new Date('2026-09-07T07:00:00.000Z'))");
  assert.deepEqual(toPlain(run("state.bookings")), before);
});

check("Z assignment alternatives honor hard lock but retain soft alternatives", () => {
  install({ cases: [{ id: "alternatives-lock", durations: { body: 1 }, stepAssignmentLocks: { body: { resourceId: "body-2" } } }] });
  let alternatives = toPlain(run("getResourceAssignmentAlternatives(state.cases[0], 'body', new Date('2026-09-07T07:00:00.000Z'))"));
  assert.deepEqual(alternatives.map((entry) => entry.resourceId), ["body-2"]);
  install({ cases: [{ id: "alternatives-soft", durations: { body: 1 }, stepPreferredResources: { body: "body-2" } }] });
  alternatives = toPlain(run("getResourceAssignmentAlternatives(state.cases[0], 'body', new Date('2026-09-07T07:00:00.000Z'))"));
  assert.ok(alternatives.some((entry) => entry.resourceId === "body-1"));
  assert.ok(alternatives.some((entry) => entry.resourceId === "body-2"));
});

checks.forEach((entry) => console.log(`${entry.pass ? "PASS" : "FAIL"} ${entry.name}${entry.error ? ` — ${entry.error}` : ""}`));
const failures = checks.filter((entry) => !entry.pass);
console.log(`P1-006 graph continuity / assignment locks: ${checks.length - failures.length}/${checks.length} PASS`);
if (failures.length) process.exitCode = 1;
