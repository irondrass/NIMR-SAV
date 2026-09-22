import assert from "node:assert/strict";
import test from "node:test";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { context, run } = createNimrVmContext({
  filename: "zone-plan-001-equipment-continuity.js",
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
  resource("prep-zone-1", "zone_preparation", { type: "equipment" }),
  resource("prep-zone-2", "zone_preparation", { type: "equipment" }),
  resource("paint-booth-1", "cabine", { type: "equipment" }),
  resource("paint-booth-2", "cabine", { type: "equipment" }),
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
  return JSON.parse(JSON.stringify(run(`scheduleTaskGraph(__caItem, __caItem.planningTasks, new Date('${startAfter}'), state.bookings)`)));
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// ZONE-PLAN-001: Equipment continuity for zone_preparation
// ---------------------------------------------------------------------------

test("ZP-1: Same case, multiple canonical preparation operations, equipmentRole=zone_preparation, two zones available: all operations must use the SAME physical zone", () => {
  // Given: two prep zones available
  // When: scheduling multiple prep operations in same case
  // Then: all prep operations must use the same zone_preparation resource
  const tasks = [
    canonicalTask("prep-1", "prep", []),
    canonicalTask("prep-2", "prep", ["prep-1"]),
    canonicalTask("prep-3", "prep", ["prep-2"]),
  ];
  const proposal = scheduleGraph({ id: "case-zp1" }, tasks);
  const prepSteps = proposal.steps.filter((s) => s.key === "prep");
  const zones = prepSteps.flatMap((s) => s.equipmentResourceIds || []);
  const uniqueZones = new Set(zones);
  assert.equal(uniqueZones.size, 1, `Expected exactly 1 zone_preparation across all prep operations but got: ${[...uniqueZones].join(", ")}`);
  // Verify it's actually zone_preparation type
  zones.forEach((zoneId) => {
    const zone = DEFAULT_RESOURCES.find((r) => r.id === zoneId);
    assert.ok(zone, `Zone ${zoneId} not found in resources`);
    assert.equal(zone.role, "zone_preparation", `Resource ${zoneId} is not a zone_preparation`);
  });
});

test("ZP-2: First operation establishes Zone preparation 2. Before the next operation, Zone preparation 2 is temporarily busy while Zone preparation 1 is free. Expected: wait for Zone preparation 2. Never substitute Zone preparation 1", () => {
  // Given: Zone preparation 2 is occupied by another case at the time the second prep operation would start
  // When: scheduling second prep operation
  // Then: planner must wait for prep-zone-2 rather than switching to prep-zone-1
  const priorBookings = [{
    id: "prior-occupancy",
    caseId: "other-case",
    key: "prep",
    taskId: "prior-prep",
    resourceIds: ["paint-1", "prep-zone-2"],
    primaryResourceId: "paint-1",
    equipmentResourceIds: ["prep-zone-2"],
    start: "2026-09-07T08:00:00.000Z",
    end: "2026-09-07T10:00:00.000Z",
    segments: [{ start: "2026-09-07T08:00:00.000Z", end: "2026-09-07T10:00:00.000Z" }],
    status: "planned",
    temporary: false,
  }];
  install({ bookings: priorBookings });
  const tasks = [
    canonicalTask("prep-initial", "prep", [], { preferredResourceId: "paint-1", preferredEquipmentId: "prep-zone-2" }),
    canonicalTask("prep-subsequent", "prep", ["prep-initial"]),
  ];
  context.__caItem = { id: "case-zp2", planningTasks: tasks };
  const proposal = toPlain(run("scheduleTaskGraph(__caItem, __caItem.planningTasks, new Date('2026-09-07T07:00:00.000Z'), state.bookings)"));
  const prepSteps = proposal.steps.filter((s) => s.key === "prep");
  // First step establishes prep-zone-2
  assert.equal(prepSteps[0].equipmentResourceIds[0], "prep-zone-2", "First prep must use prep-zone-2");
  // Second step must wait for prep-zone-2, not switch to prep-zone-1
  assert.equal(prepSteps[1].equipmentResourceIds[0], "prep-zone-2", "Second prep must wait for prep-zone-2 and not switch to prep-zone-1");
});

test("ZP-3: Parallel-ready/sibling preparation operations: same equipmentRole => same zone", () => {
  // Given: two parallel prep operations (siblings, no dependencies)
  // When: scheduling both
  // Then: both must use the same zone_preparation resource
  const tasks = [
    canonicalTask("prep-para-1", "prep", [], { parallelizable: true }),
    canonicalTask("prep-para-2", "prep", [], { parallelizable: true }),
  ];
  const proposal = scheduleGraph({ id: "case-zp3" }, tasks);
  const prepSteps = proposal.steps.filter((s) => s.key === "prep");
  const zones = prepSteps.flatMap((s) => s.equipmentResourceIds || []);
  const uniqueZones = new Set(zones);
  assert.equal(uniqueZones.size, 1, `Expected exactly 1 zone_preparation across parallel prep operations but got: ${[...uniqueZones].join(", ")}`);
  // Verify they don't overlap in time (serialized on same zone)
  const step1 = prepSteps[0];
  const step2 = prepSteps[1];
  const overlaps = new Date(step1.start) < new Date(step2.end) && new Date(step1.end) > new Date(step2.start);
  assert.equal(overlaps, false, "Two prep tasks for the same zone cannot overlap in time");
});

test("ZP-4: Different equipment roles remain independent: zone_preparation does not lock cabine", () => {
  // Given: prep uses zone_preparation, paint uses cabine
  // When: scheduling both
  // Then: zone_preparation continuity does not affect cabine selection
  const tasks = [
    canonicalTask("prep-step", "prep", []),
    canonicalTask("paint-step", "paint", ["prep-step"]),
  ];
  const proposal = scheduleGraph({ id: "case-zp4" }, tasks);
  const prep = proposal.steps.find((s) => s.key === "prep");
  const paint = proposal.steps.find((s) => s.key === "paint");
  // Same painter (human continuity)
  assert.equal(prep.primaryResourceId, paint.primaryResourceId, "Same painter for prep and paint");
  // Equipment varies independently: zone_preparation for prep, cabine for paint
  assert.notEqual(prep.equipmentResourceIds[0], paint.equipmentResourceIds[0], "Prep and paint must use different equipment types");
  // Verify equipment roles are correct
  assert.ok(prep.equipmentResourceIds[0].startsWith("prep-zone"), `Prep must use zone_preparation, got ${prep.equipmentResourceIds[0]}`);
  assert.ok(paint.equipmentResourceIds[0].startsWith("paint-booth"), `Paint must use cabine, got ${paint.equipmentResourceIds[0]}`);
});

test("ZP-5: Established equipment owner + conflicting task.resourceIds equipment: fail closed with an explicit continuity conflict", () => {
  // Given: First prep establishes prep-zone-2 via resourceIds
  // When: Second prep explicitly requests prep-zone-1 via resourceIds
  // Then: fail with assignment_equipment_continuity_conflict
  install();
  const tasks = [
    canonicalTask("init-prep", "prep", [], { resourceIds: ["paint-1", "prep-zone-2"] }),
    canonicalTask("conflict-prep", "prep", ["init-prep"], { resourceIds: ["paint-1", "prep-zone-1"] }),
  ];
  context.__caItem = { id: "case-zp5", planningTasks: tasks };
  let errorCaught = null;
  try {
    run("scheduleTaskGraph(__caItem, __caItem.planningTasks, new Date('2026-09-07T07:00:00.000Z'), state.bookings)");
  } catch (error) {
    errorCaught = error;
  }
  assert.ok(errorCaught, "Expected equipment continuity conflict error when resourceIds conflicts with established zone continuity");
  assert.equal(
    errorCaught.code,
    "assignment_equipment_continuity_conflict",
    `Expected assignment_equipment_continuity_conflict, got ${errorCaught.code}`
  );
});

test("ZP-6: Historical accepted/productive booking with one unambiguous zone_preparation resource seeds equipment continuity", () => {
  // Given: Historical productive booking for this case used prep-zone-2
  // When: Scheduling new prep operations
  // Then: New prep operations must inherit prep-zone-2 from history
  const historicalBooking = {
    id: "hist-prep-1",
    caseId: "case-zp6",
    key: "prep",
    taskId: "hist-prep",
    resourceIds: ["paint-1", "prep-zone-2"],
    primaryResourceId: "paint-1",
    equipmentResourceIds: ["prep-zone-2"],
    start: "2026-09-07T08:00:00.000Z",
    end: "2026-09-07T09:00:00.000Z",
    segments: [{ start: "2026-09-07T08:00:00.000Z", end: "2026-09-07T09:00:00.000Z" }],
    status: "completed",
    actualStart: "2026-09-07T08:00:00.000Z",
    actualWorkedMinutes: 60,
    temporary: false,
  };
  install({ bookings: [historicalBooking] });
  const tasks = [
    canonicalTask("new-prep-task", "prep", []),
  ];
  context.__caItem = { id: "case-zp6", planningTasks: tasks };
  const proposal = toPlain(run("scheduleTaskGraph(__caItem, __caItem.planningTasks, new Date('2026-09-07T09:00:00.000Z'), state.bookings)"));
  const prep = proposal.steps.find((s) => s.key === "prep");
  assert.equal(prep.equipmentResourceIds[0], "prep-zone-2", "New prep task must inherit prep-zone-2 from productive history");
});
test("ZP-7: Conflicting productive history for the same equipment role fails closed", () => {
  // Given: Two productive historical prep bookings for the same case
  // used two different physical preparation zones.
  // Then: planner must not arbitrarily choose one zone.
  // It must fail closed with an explicit historical equipment continuity conflict.
  const history = [
    {
      id: "hist-zp7-zone-1",
      caseId: "case-zp7",
      key: "prep",
      taskId: "hist-zp7-task-1",
      resourceIds: ["paint-1", "prep-zone-1"],
      primaryResourceId: "paint-1",
      equipmentResourceIds: ["prep-zone-1"],
      start: "2026-09-07T07:00:00.000Z",
      end: "2026-09-07T08:00:00.000Z",
      segments: [{
        start: "2026-09-07T07:00:00.000Z",
        end: "2026-09-07T08:00:00.000Z"
      }],
      status: "completed",
      actualStart: "2026-09-07T07:00:00.000Z",
      actualWorkedMinutes: 60,
      temporary: false,
    },
    {
      id: "hist-zp7-zone-2",
      caseId: "case-zp7",
      key: "prep",
      taskId: "hist-zp7-task-2",
      resourceIds: ["paint-1", "prep-zone-2"],
      primaryResourceId: "paint-1",
      equipmentResourceIds: ["prep-zone-2"],
      start: "2026-09-07T08:00:00.000Z",
      end: "2026-09-07T09:00:00.000Z",
      segments: [{
        start: "2026-09-07T08:00:00.000Z",
        end: "2026-09-07T09:00:00.000Z"
      }],
      status: "completed",
      actualStart: "2026-09-07T08:00:00.000Z",
      actualWorkedMinutes: 60,
      temporary: false,
    },
  ];

  install({ bookings: history });

  const tasks = [
    canonicalTask("new-prep-zp7", "prep", []),
  ];

  context.__caItem = {
    id: "case-zp7",
    planningTasks: tasks,
  };

  let errorCaught = null;

  try {
    run(
      "scheduleTaskGraph(__caItem, __caItem.planningTasks, new Date('2026-09-07T09:00:00.000Z'), state.bookings)"
    );
  } catch (error) {
    errorCaught = error;
  }

  assert.ok(
    errorCaught,
    "Expected conflicting productive equipment history to fail closed"
  );

  assert.equal(
    errorCaught.code,
    "assignment_equipment_continuity_conflict",
    `Expected assignment_equipment_continuity_conflict, got ${errorCaught.code}`
  );

  assert.equal(
    errorCaught.conflictType,
    "historical_productive_equipment_split",
    `Expected historical_productive_equipment_split, got ${errorCaught.conflictType}`
  );

  assert.equal(
    errorCaught.equipmentRole,
    "zone_preparation",
    `Expected zone_preparation, got ${errorCaught.equipmentRole}`
  );

  assert.equal(
    Array.from(errorCaught.equipmentResourceIds || []).sort().join(","),
    "prep-zone-1,prep-zone-2",
    "Conflict must expose both historical physical zones"
  );
});