import assert from "node:assert/strict";
import test from "node:test";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { context, run } = createNimrVmContext({
  filename: "ca-plan-001-same-specialty-continuity.js",
  console: { log() {}, warn() {}, error: console.error },
});

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
  resource("body-1", "tolier"),
  resource("body-2", "tolier"),
  resource("paint-1", "peintre"),
  resource("paint-2", "peintre"),
  resource("meca-1", "mecanicien"),
  resource("meca-2", "mecanicien"),
  resource("elec-1", "electricien"),
  resource("elec-2", "electricien"),
  resource("ctrl-1", "controle"),
  resource("ctrl-2", "controle"),
  resource("prep-zone", "zone_preparation", { type: "equipment" }),
  resource("paint-booth", "cabine", { type: "equipment" }),
  resource("lift-1", "pont_mecanique", { type: "equipment" }),
  resource("lift-2", "pont_mecanique", { type: "equipment" }),
  resource("ext-body", "tolier", {
    kind: "external",
    site: "external",
    external: true,
    transportResourceId: "carrier",
    outboundTransferMinutes: 30,
    returnTransferMinutes: 30,
    standardLeadTimeMinutes: 120,
  }),
  resource("carrier", "transport", { type: "equipment" }),
];

function install({ resources = DEFAULT_RESOURCES, bookings = [], cases = [] } = {}) {
  context.__caState = {
    resources,
    bookings,
    cases,
    users: [{ id: "chief", name: "Chief", role: "chef_atelier", active: true }],
    currentUserId: "chief",
    settings: { calendar: WORK_HOURS, fastLaneEnabled: false },
  };
  run("state = normalizeState(__caState); generatedProposals = {}; invalidateStateReplacementIndexes();");
}

function canonicalTask(id, key, dependencies = [], overrides = {}) {
  const templateRole = {
    body: "tolier",
    reassembly: "tolier",
    prep: "peintre",
    paint: "peintre",
    finish: "peintre",
    mechanical: "mecanicien",
    electrical: "electricien",
    quality: "controle",
  }[key] || "tolier";
  const equipmentRole = key === "prep" ? "zone_preparation" : (key === "paint" ? "cabine" : (key === "mechanical" ? "pont_mecanique" : ""));
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

function scheduleGraph(item, tasks = item.planningTasks, startAfter = "2026-09-07T07:00:00.000Z") {
  install({ cases: [{ ...item, planningTasks: tasks }] });
  context.__caItem = run("state.cases[0]");
  return toPlain(run(`scheduleTaskGraph(__caItem, __caItem.planningTasks, new Date('${startAfter}'), state.bookings)`));
}

// ---------------------------------------------------------------------------
// T1: Tôlerie 3 sibling tasks (EXPECTED RED on main)
// ---------------------------------------------------------------------------
test("T1: Tôlerie 3 sibling tasks all use same Tôlier", () => {
  const tasks = [
    canonicalTask("body-a", "body", []),
    canonicalTask("body-b", "body", []),
    canonicalTask("body-c", "body", []),
  ];
  const proposal = scheduleGraph({ id: "case-t1" }, tasks);
  const primaryIds = proposal.steps.map((s) => s.primaryResourceId);
  assert.equal(new Set(primaryIds).size, 1, `Expected 1 unique tolier but got: ${primaryIds.join(", ")}`);
});

// ---------------------------------------------------------------------------
// T2: Mechanical tasks continuity (EXPECTED RED on main)
// ---------------------------------------------------------------------------
test("T2: Mechanical tasks continuity all use same Mécanicien", () => {
  const tasks = [
    canonicalTask("meca-a", "mechanical", []),
    canonicalTask("meca-b", "mechanical", ["meca-a"]),
    canonicalTask("meca-c", "mechanical", ["meca-b"]),
  ];
  const proposal = scheduleGraph({ id: "case-t2" }, tasks);
  const primaryIds = proposal.steps.map((s) => s.primaryResourceId);
  assert.equal(new Set(primaryIds).size, 1, `Expected 1 unique mecanicien but got: ${primaryIds.join(", ")}`);
});

// ---------------------------------------------------------------------------
// T3: Electrical tasks continuity (EXPECTED RED on main)
// ---------------------------------------------------------------------------
test("T3: Electrical tasks continuity all use same Électricien", () => {
  const tasks = [
    canonicalTask("elec-a", "electrical", []),
    canonicalTask("elec-b", "electrical", ["elec-a"]),
    canonicalTask("elec-c", "electrical", ["elec-b"]),
  ];
  const proposal = scheduleGraph({ id: "case-t3" }, tasks);
  const primaryIds = proposal.steps.map((s) => s.primaryResourceId);
  assert.equal(new Set(primaryIds).size, 1, `Expected 1 unique electricien but got: ${primaryIds.join(", ")}`);
});

// ---------------------------------------------------------------------------
// T4: Control tasks continuity (EXPECTED RED on main)
// ---------------------------------------------------------------------------
test("T4: Control tasks continuity all use same Contrôleur", () => {
  const tasks = [
    canonicalTask("ctrl-a", "quality", []),
    canonicalTask("ctrl-b", "quality", ["ctrl-a"]),
  ];
  const proposal = scheduleGraph({ id: "case-t4" }, tasks);
  const primaryIds = proposal.steps.map((s) => s.primaryResourceId);
  assert.equal(new Set(primaryIds).size, 1, `Expected 1 unique controleur but got: ${primaryIds.join(", ")}`);
});

// ---------------------------------------------------------------------------
// T5: Later availability — wait for same technician (EXPECTED RED on main)
// ---------------------------------------------------------------------------
test("T5: Later availability waits for established technician and does not switch to achieve earlier slot", () => {
  // body-1 is occupied between 08:00 and 12:00 on day 1 for another case.
  // body-2 is free at 08:00.
  // Task 1 establishes body-1 (starts at 13:00).
  // Task 2 arrives: body-1 is free at 14:00. body-2 is free at 08:00 on day 1.
  // The planner must wait for body-1 rather than rotating to body-2.
  const priorBookings = [{
    id: "prior-occupancy",
    caseId: "other-case",
    key: "body",
    taskId: "prior-task",
    resourceIds: ["body-1"],
    primaryResourceId: "body-1",
    start: "2026-09-07T08:00:00.000Z",
    end: "2026-09-07T12:00:00.000Z",
    segments: [{ start: "2026-09-07T08:00:00.000Z", end: "2026-09-07T12:00:00.000Z" }],
    status: "planned",
    temporary: false,
  }];
  install({ bookings: priorBookings });
  const tasks = [
    canonicalTask("body-1-task", "body", [], { preferredResourceId: "body-1" }),
    canonicalTask("body-2-task", "body", ["body-1-task"]),
  ];
  context.__caItem = { id: "case-t5", planningTasks: tasks };
  const proposal = toPlain(run("scheduleTaskGraph(state.cases[0] || __caItem, __caItem.planningTasks, new Date('2026-09-07T07:00:00.000Z'), state.bookings)"));
  assert.equal(proposal.steps[0].primaryResourceId, "body-1");
  assert.equal(proposal.steps[1].primaryResourceId, "body-1", "Task 2 must wait for body-1 and not switch to body-2");
});

// ---------------------------------------------------------------------------
// T6: Preferred resource cannot override continuity (EXPECTED RED on main)
// ---------------------------------------------------------------------------
test("T6: Preferred resource cannot switch technician once continuity is established", () => {
  const tasks = [
    canonicalTask("body-initial", "body", [], { preferredResourceId: "body-1" }),
    canonicalTask("body-subsequent", "body", ["body-initial"], { preferredResourceId: "body-2" }),
  ];
  const proposal = scheduleGraph({ id: "case-t6" }, tasks);
  assert.equal(proposal.steps[0].primaryResourceId, "body-1");
  assert.equal(proposal.steps[1].primaryResourceId, "body-1", "Preference for body-2 must not override established continuity of body-1");
});

// ---------------------------------------------------------------------------
// T7: Explicit manual lock conflict fails closed (EXPECTED RED on main)
// ---------------------------------------------------------------------------
test("T7: Explicit manual lock conflicting with established continuity fails closed", () => {
  install();
  context.__caItem = {
    id: "case-t7",
    stepAssignmentLocks: {
      reassembly: { resourceId: "body-2" },
    },
    planningTasks: [
      canonicalTask("body-initial", "body", [], { preferredResourceId: "body-1" }),
      canonicalTask("reassembly-step", "reassembly", ["body-initial"]),
    ],
  };
  let errorCaught = null;
  try {
    run("scheduleTaskGraph(__caItem, __caItem.planningTasks, new Date('2026-09-07T07:00:00.000Z'), state.bookings)");
  } catch (error) {
    errorCaught = error;
  }
  assert.ok(errorCaught, "Expected planning conflict error when lock conflicts with established continuity");
  assert.equal(errorCaught.code, "assignment_specialty_continuity_conflict");
  assert.equal(errorCaught.continuityResourceId, "body-1");
  assert.equal(errorCaught.lockedResourceId, "body-2");
});

// ---------------------------------------------------------------------------
// T8: Productive history seeding (EXPECTED RED on main)
// ---------------------------------------------------------------------------
test("T8: Productive history establishes authoritative specialty owner for subsequent tasks", () => {
  const historicalBooking = {
    id: "hist-body-1",
    caseId: "case-t8",
    key: "body",
    taskId: "hist-body",
    resourceIds: ["body-2"],
    primaryResourceId: "body-2",
    start: "2026-09-07T08:00:00.000Z",
    end: "2026-09-07T09:00:00.000Z",
    segments: [{ start: "2026-09-07T08:00:00.000Z", end: "2026-09-07T09:00:00.000Z" }],
    status: "started",
    actualStart: "2026-09-07T08:00:00.000Z",
    actualWorkedMinutes: 30,
    temporary: false,
  };
  install({ bookings: [historicalBooking] });
  const tasks = [
    canonicalTask("new-body-task", "body", []),
  ];
  context.__caItem = { id: "case-t8", planningTasks: tasks };
  const proposal = toPlain(run("scheduleTaskGraph(__caItem, __caItem.planningTasks, new Date('2026-09-07T09:00:00.000Z'), state.bookings)"));
  assert.equal(proposal.steps[0].primaryResourceId, "body-2", "New body task must inherit body-2 from productive history");
});

// ---------------------------------------------------------------------------
// T9: Productive history split fails closed (EXPECTED RED on main)
// ---------------------------------------------------------------------------
test("T9: Productive history containing multiple technicians for same specialty fails closed", () => {
  const historicalBookings = [
    {
      id: "hist-split-1",
      caseId: "case-t9",
      key: "body",
      taskId: "hist-1",
      resourceIds: ["body-1"],
      primaryResourceId: "body-1",
      start: "2026-09-07T08:00:00.000Z",
      end: "2026-09-07T09:00:00.000Z",
      segments: [{ start: "2026-09-07T08:00:00.000Z", end: "2026-09-07T09:00:00.000Z" }],
      status: "completed",
      actualStart: "2026-09-07T08:00:00.000Z",
      actualWorkedMinutes: 60,
      temporary: false,
    },
    {
      id: "hist-split-2",
      caseId: "case-t9",
      key: "body",
      taskId: "hist-2",
      resourceIds: ["body-2"],
      primaryResourceId: "body-2",
      start: "2026-09-07T09:00:00.000Z",
      end: "2026-09-07T10:00:00.000Z",
      segments: [{ start: "2026-09-07T09:00:00.000Z", end: "2026-09-07T10:00:00.000Z" }],
      status: "started",
      actualStart: "2026-09-07T09:00:00.000Z",
      actualWorkedMinutes: 30,
      temporary: false,
    },
  ];
  install({ bookings: historicalBookings });
  const tasks = [canonicalTask("new-task", "body", [])];
  context.__caItem = { id: "case-t9", planningTasks: tasks };
  let errorCaught = null;
  try {
    run("scheduleTaskGraph(__caItem, __caItem.planningTasks, new Date('2026-09-07T10:00:00.000Z'), state.bookings)");
  } catch (error) {
    errorCaught = error;
  }
  assert.ok(errorCaught, "Expected productive split to fail closed with conflict");
  assert.equal(errorCaught.code, "assignment_specialty_continuity_conflict");
  assert.equal(errorCaught.conflictType, "historical_productive_split");
});

// ---------------------------------------------------------------------------
// T10: No slot in horizon fails explicitly (EXPECTED RED on main)
// ---------------------------------------------------------------------------
test("T10: When established specialist has no slot in horizon, planner fails explicitly without falling back", () => {
  // body-1 is closed for the entire horizon.
  // body-2 is open.
  // Established specialist is body-1.
  const customResources = [
    resource("body-1", "tolier", { calendar: { workHours: CLOSED_HOURS } }),
    resource("body-2", "tolier"),
  ];
  const historicalBooking = {
    id: "hist-body-1",
    caseId: "case-t10",
    key: "body",
    taskId: "hist-body",
    resourceIds: ["body-1"],
    primaryResourceId: "body-1",
    start: "2026-09-07T07:00:00.000Z",
    end: "2026-09-07T08:00:00.000Z",
    segments: [{ start: "2026-09-07T07:00:00.000Z", end: "2026-09-07T08:00:00.000Z" }],
    status: "completed",
    actualStart: "2026-09-07T07:00:00.000Z",
    actualWorkedMinutes: 60,
    temporary: false,
  };
  install({ resources: customResources, bookings: [historicalBooking] });
  const tasks = [canonicalTask("next-task", "body", [])];
  context.__caItem = { id: "case-t10", planningTasks: tasks };
  assert.throws(
    () => run("scheduleTaskGraph(__caItem, __caItem.planningTasks, new Date('2026-09-07T08:00:00.000Z'), state.bookings)"),
    /ressource|disponib|horizon|impossible|verrou/i,
  );
});

// ---------------------------------------------------------------------------
// T11: Parallel same-specialty tasks do not allocate two people (EXPECTED RED on main)
// ---------------------------------------------------------------------------
test("T11: Parallelizable same-specialty tasks serialize on same technician and never allocate two people", () => {
  const tasks = [
    canonicalTask("para-1", "body", [], { parallelizable: true }),
    canonicalTask("para-2", "body", [], { parallelizable: true }),
  ];
  const proposal = scheduleGraph({ id: "case-t11" }, tasks);
  const primaryIds = proposal.steps.map((s) => s.primaryResourceId);
  assert.equal(new Set(primaryIds).size, 1, `Expected exactly 1 technician across parallel tasks but got: ${primaryIds.join(", ")}`);
  // End of task 1 must be <= start of task 2 (or vice versa), i.e. serialized
  const step1 = proposal.steps[0];
  const step2 = proposal.steps[1];
  const overlaps = new Date(step1.start) < new Date(step2.end) && new Date(step1.end) > new Date(step2.start);
  assert.equal(overlaps, false, "Two tasks for the same technician cannot overlap in time");
});

// ---------------------------------------------------------------------------
// T12: Cross-specialty independence (BASELINE REGRESSION GUARD)
// ---------------------------------------------------------------------------
test("T12: Cross-specialty tasks may allocate different specialists", () => {
  const tasks = [
    canonicalTask("meca", "mechanical", []),
    canonicalTask("elec", "electrical", ["meca"]),
    canonicalTask("body", "body", ["elec"]),
    canonicalTask("prep", "prep", ["body"]),
    canonicalTask("paint", "paint", ["prep"]),
    canonicalTask("ctrl", "quality", ["paint"]),
  ];
  const proposal = scheduleGraph({ id: "case-t12" }, tasks);
  const mecaId = proposal.steps.find((s) => s.key === "mechanical")?.primaryResourceId;
  const elecId = proposal.steps.find((s) => s.key === "electrical")?.primaryResourceId;
  const bodyId = proposal.steps.find((s) => s.key === "body")?.primaryResourceId;
  const paintId = proposal.steps.find((s) => s.key === "paint")?.primaryResourceId;
  const ctrlId = proposal.steps.find((s) => s.key === "quality")?.primaryResourceId;
  // All roles are distinct specialties and can be different people
  assert.ok(mecaId && elecId && bodyId && paintId && ctrlId);
});

// ---------------------------------------------------------------------------
// T13: Equipment independence (BASELINE REGRESSION GUARD)
// ---------------------------------------------------------------------------
test("T13: Equipment resources vary independently of human technician continuity", () => {
  const tasks = [
    canonicalTask("prep-step", "prep", []),
    canonicalTask("paint-step", "paint", ["prep-step"]),
  ];
  const proposal = scheduleGraph({ id: "case-t13" }, tasks);
  const prep = proposal.steps.find((s) => s.key === "prep");
  const paint = proposal.steps.find((s) => s.key === "paint");
  // Same painter
  assert.equal(prep.primaryResourceId, paint.primaryResourceId);
  // Equipment varies: zone_preparation for prep, cabine for paint
  assert.notEqual(prep.equipmentResourceIds[0], paint.equipmentResourceIds[0]);
});

// ---------------------------------------------------------------------------
// T14: Deterministic replan (BASELINE REGRESSION GUARD)
// ---------------------------------------------------------------------------
test("T14: Deterministic replanning produces identical specialty assignments across repeated runs", () => {
  const tasks = [
    canonicalTask("d-body-1", "body", []),
    canonicalTask("d-body-2", "body", ["d-body-1"]),
    canonicalTask("d-prep", "prep", ["d-body-2"]),
    canonicalTask("d-paint", "paint", ["d-prep"]),
  ];
  const run1 = scheduleGraph({ id: "case-t14" }, tasks);
  const run2 = scheduleGraph({ id: "case-t14" }, tasks);
  assert.deepEqual(
    run1.steps.map((s) => ({ key: s.key, primary: s.primaryResourceId, start: s.start })),
    run2.steps.map((s) => ({ key: s.key, primary: s.primaryResourceId, start: s.start })),
  );
});

// ---------------------------------------------------------------------------
// T15: Sanitized 2906TU250 production case structure (EXPECTED RED on main)
// ---------------------------------------------------------------------------
test("T15: Sanitized 2906TU250 production case retains 1 tôlier and 1 painter across multiple body/prep/paint operations", () => {
  const tasks = [
    canonicalTask("op1-body", "body", []),
    canonicalTask("op2-body", "body", []),
    canonicalTask("op3-body", "body", []),
    canonicalTask("op4-prep", "prep", ["op1-body", "op2-body", "op3-body"]),
    canonicalTask("op5-paint", "paint", ["op4-prep"]),
    canonicalTask("op6-prep", "prep", ["op5-paint"]),
    canonicalTask("op7-paint", "paint", ["op6-prep"]),
  ];
  const proposal = scheduleGraph({ id: "case-2906TU250" }, tasks);
  const bodyTechnicians = new Set(proposal.steps.filter((s) => s.key === "body").map((s) => s.primaryResourceId));
  const paintTechnicians = new Set(proposal.steps.filter((s) => ["prep", "paint"].includes(s.key)).map((s) => s.primaryResourceId));
  assert.equal(bodyTechnicians.size, 1, `Expected exactly 1 tôlier across all body operations but got: ${[...bodyTechnicians].join(", ")}`);
  assert.equal(paintTechnicians.size, 1, `Expected exactly 1 peintre across all prep/paint operations but got: ${[...paintTechnicians].join(", ")}`);
});

// ---------------------------------------------------------------------------
// T16: Direct task.resourceIds establishes initial continuity (EXPECTED RED on main)
// ---------------------------------------------------------------------------
test("T16: Direct task.resourceIds establishes initial specialty continuity for subsequent tasks", () => {
  const tasks = [
    canonicalTask("dir-1", "body", [], { resourceIds: ["body-2"] }),
    canonicalTask("dir-2", "body", ["dir-1"]), // automatic selection should inherit body-2
  ];
  const proposal = scheduleGraph({ id: "case-t16" }, tasks);
  assert.equal(proposal.steps[0].primaryResourceId, "body-2");
  assert.equal(proposal.steps[1].primaryResourceId, "body-2", "Subsequent task must inherit body-2 established via resourceIds");
});

// ---------------------------------------------------------------------------
// T17: Conflicting task.resourceIds fails closed (EXPECTED RED on main)
// ---------------------------------------------------------------------------
test("T17: Direct task.resourceIds conflicting with established continuity fails closed", () => {
  install();
  const tasks = [
    canonicalTask("init-1", "body", [], { resourceIds: ["body-1"] }),
    canonicalTask("conflict-2", "body", ["init-1"], { resourceIds: ["body-2"] }),
  ];
  context.__caItem = { id: "case-t17", planningTasks: tasks };
  let errorCaught = null;
  try {
    run("scheduleTaskGraph(__caItem, __caItem.planningTasks, new Date('2026-09-07T07:00:00.000Z'), state.bookings)");
  } catch (error) {
    errorCaught = error;
  }
  assert.ok(errorCaught, "Expected conflict error when resourceIds conflicts with established specialty continuity");
  assert.equal(errorCaught.code, "assignment_specialty_continuity_conflict");
  assert.equal(errorCaught.continuityResourceId, "body-1");
  assert.equal(errorCaught.lockedResourceId, "body-2");
});

// ---------------------------------------------------------------------------
// T18: History seeding with case-excluded view (EXPECTED RED on main)
// ---------------------------------------------------------------------------
test("T18: History seeding still operates when planning conflict booking view excludes current case", () => {
  // body-2 owns the case in productive history.
  // body-1 is preferred on the new task (or naturally earlier/lower load).
  // Without history seeding, main picks body-1. With history seeding, it must pick body-2.
  const historicalBooking = {
    id: "started-body-booking",
    caseId: "case-t18",
    key: "body",
    taskId: "hist-body-t18",
    resourceIds: ["body-2"],
    primaryResourceId: "body-2",
    start: "2026-09-07T08:00:00.000Z",
    end: "2026-09-07T10:00:00.000Z",
    segments: [{ start: "2026-09-07T08:00:00.000Z", end: "2026-09-07T10:00:00.000Z" }],
    status: "started",
    actualStart: "2026-09-07T08:00:00.000Z",
    actualWorkedMinutes: 60,
    temporary: false,
  };
  install({ bookings: [historicalBooking] });
  context.__caItem = {
    id: "case-t18",
    durations: { body: 1 },
    planningTasks: [canonicalTask("new-sibling", "body", [], { preferredResourceId: "body-1" })],
  };
  // Simulate proposal flow where indexed view excludes case-t18 for conflict detection
  const result = toPlain(run(`
    (() => {
      const indexedView = createIndexedPlannerBookingView(state.bookings, { excludedCaseId: 'case-t18' });
      return scheduleTaskGraph(__caItem, __caItem.planningTasks, new Date('2026-09-07T10:00:00.000Z'), indexedView);
    })()
  `));
  assert.equal(result.steps[0].primaryResourceId, "body-2", "New body sibling must inherit body-2 from history despite case exclusion in booking view");
});

// ---------------------------------------------------------------------------
// T19: Generic specialty owner beats legacy ancestor continuity (EXPECTED RED on main)
// ---------------------------------------------------------------------------
test("T19: Established generic specialty owner precedes legacy ancestor continuity", () => {
  // Test scenario:
  // We invoke scheduleTaskGraph directly on two tasks:
  // Task 1: "source-prep" (prep, painter)
  // Task 2: "target-finish" (finish, painter, depends on source-prep)
  // We explicitly pre-seed assignment context with primaryResourceBySpecialty["peintre"] = "paint-1".
  // However, source-prep is scheduled with paint-2 (e.g. by passing scheduledTasks with paint-2, or by testing getGraphContinuityPrimaryResourceId directly).
  // Let's test getGraphContinuityPrimaryResourceId directly under VM:
  // task = { id: "finish-1", key: "finish", requiredRole: "peintre" }
  // scheduledTasks = Map of { "prep-1": { task: { id: "prep-1", key: "prep" }, end: "...", steps: [{ key: "prep", primaryResourceId: "paint-2" }] } }
  // ancestorIndex = Map of { "finish-1": Set(["prep-1"]) }
  // assignment = { primaryResourceBySpecialty: { peintre: "paint-1" } }
  // On untouched baseline: getGraphContinuityPrimaryResourceId ignores assignment, traverses ancestors, and returns "paint-2"!
  // On CA-PLAN-001: getGraphContinuityPrimaryResourceId inspects assignment.primaryResourceBySpecialty first and returns "paint-1"!
  install();
  const res = run(`
    (() => {
      const task = { id: "finish-1", key: "finish", requiredRole: "peintre" };
      const scheduledTasks = new Map([
        ["prep-1", { task: { id: "prep-1", key: "prep" }, end: "2026-09-07T09:00:00.000Z", steps: [{ key: "prep", primaryResourceId: "paint-2" }] }]
      ]);
      const ancestorIndex = new Map([["finish-1", new Set(["prep-1"])]]);
      const assignment = { primaryResourceBySpecialty: { peintre: "paint-1" } };
      return getGraphContinuityPrimaryResourceId(task, scheduledTasks, ancestorIndex, assignment);
    })()
  `);
  assert.equal(res, "paint-1", "Established generic owner paint-1 must precede ancestor continuity result paint-2");
});

// ---------------------------------------------------------------------------
// T20: External subcontract resource does not become owner (EXPECTED RED on main)
// ---------------------------------------------------------------------------
test("T20: External subcontract provider does not populate internal specialty continuity map", () => {
  const tasks = [
    canonicalTask("ext-body-step", "body", [], {
      serviceMode: "external",
      subcontractorId: "ext-body",
      durationMinutes: 60,
    }),
  ];
  install();
  context.__caItem = { id: "case-t20", planningTasks: tasks };
  // The external step should schedule with external provider
  const proposal = toPlain(run("scheduleTaskGraph(__caItem, __caItem.planningTasks, new Date('2026-09-07T07:00:00.000Z'), state.bookings)"));
  assert.ok(proposal.steps.length > 0);
  // An internal task scheduled in the same case afterwards must NOT consider ext-body as the internal specialty owner
  const internalTasks = [
    canonicalTask("int-body-1", "body", []),
    canonicalTask("int-body-2", "body", ["int-body-1"]),
  ];
  const internalProposal = scheduleGraph({ id: "case-t20-internal" }, internalTasks);
  const internalTechs = internalProposal.steps.map((s) => s.primaryResourceId);
  assert.ok(!internalTechs.includes("ext-body"), "External subcontractor must not become internal specialty technician");
});

// ---------------------------------------------------------------------------
// T21: Internal -> external -> internal sequence preserves tech (EXPECTED RED on main)
// ---------------------------------------------------------------------------
test("T21: Sequence of internal -> external -> internal body work preserves initial internal technician", () => {
  const tasks = [
    canonicalTask("body-phase-1", "body", [], { preferredResourceId: "body-1" }),
    canonicalTask("body-external", "body", ["body-phase-1"], {
      serviceMode: "external",
      subcontractorId: "ext-body",
      durationMinutes: 60,
    }),
    canonicalTask("body-phase-2", "body", ["body-external"]),
  ];
  install();
  context.__caItem = { id: "case-t21", planningTasks: tasks };
  const proposal = toPlain(run("scheduleTaskGraph(__caItem, __caItem.planningTasks, new Date('2026-09-07T07:00:00.000Z'), state.bookings)"));
  const phase1 = proposal.steps.find((s) => s.taskId === "body-phase-1");
  const phase2 = proposal.steps.find((s) => s.taskId === "body-phase-2");
  assert.equal(phase1.primaryResourceId, "body-1");
  assert.equal(phase2.primaryResourceId, "body-1", "Internal body phase 2 must retain body-1 from phase 1, ignoring external subcontract provider");
});
