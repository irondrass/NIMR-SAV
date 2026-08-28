import assert from "node:assert/strict";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { context, run } = createNimrVmContext({
  filename: "canonical-task-model-p1003.js",
  console: { log() {}, warn() {}, error: console.error },
});

const START = "2026-09-07T08:00:00+01:00";
const CALENDAR = {
  0: "",
  1: "08:00-12:00,13:00-16:00",
  2: "08:00-12:00,13:00-16:00",
  3: "08:00-12:00,13:00-16:00",
  4: "08:00-12:00,13:00-16:00",
  5: "08:00-12:00,13:00-16:00",
  6: "",
};
const RESOURCES = [
  { id: "body-1", name: "Tolier", role: "tolier", active: true, calendar: CALENDAR },
  { id: "body-2", name: "Tolier 2", role: "tolier", active: true, calendar: CALENDAR },
  { id: "mechanic", name: "Mecanicien", role: "mecanicien", active: true, calendar: CALENDAR },
  { id: "lift", name: "Pont", role: "pont_mecanique", active: true, calendar: CALENDAR },
  { id: "electrician", name: "Electricien", role: "electricien", active: true, calendar: CALENDAR },
  { id: "painter", name: "Peintre", role: "peintre", active: true, calendar: CALENDAR },
  { id: "prep-zone", name: "Zone preparation", role: "zone_preparation", active: true, calendar: CALENDAR },
  { id: "booth", name: "Cabine", role: "cabine", active: true, calendar: CALENDAR },
  { id: "quality", name: "Controle", role: "controle", active: true, calendar: CALENDAR },
  { id: "carrier", name: "Convoyeur", role: "transport", active: true, calendar: CALENDAR },
  {
    id: "paint-external",
    name: "Partenaire peinture",
    role: "peintre",
    category: "peintre",
    kind: "external",
    site: "external",
    external: true,
    active: true,
    calendar: CALENDAR,
    transportResourceId: "carrier",
    outboundTransferMinutes: 30,
    returnTransferMinutes: 30,
    standardLeadTimeMinutes: 120,
  },
];

const scenarios = [];

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function check(name, callback) {
  try {
    callback();
    scenarios.push({ name, pass: true });
  } catch (error) {
    scenarios.push({ name, pass: false, error: error.message || String(error) });
  }
}

function normalizeCaseThroughState(item, bookings = []) {
  context.__p1003RawState = {
    resources: RESOURCES,
    users: [{ id: "chief", name: "Chef", role: "chef_atelier", active: true }],
    currentUserId: "chief",
    cases: [item],
    bookings,
    settings: { calendar: CALENDAR, fastLaneEnabled: false },
  };
  return toPlain(run("normalizeState(__p1003RawState)"));
}

function scheduleCase(item, tasks = item.planningTasks || []) {
  context.__p1003Item = item;
  context.__p1003Tasks = tasks;
  context.__p1003Start = START;
  return toPlain(run("scheduleTaskGraph(__p1003Item, __p1003Tasks, new Date(__p1003Start), [])"));
}

function canonicalTask(overrides = {}) {
  return {
    id: "canonical-body",
    taskId: "canonical-body",
    key: "body",
    phase: "body",
    title: "Carrosserie canonique",
    durationMinutes: 60,
    requiredRole: "tolier",
    dependencies: [],
    parallelizable: false,
    vehicleExclusive: true,
    vehicleLocation: "internal",
    sourceKind: "canonical_graph",
    source: "manual",
    sourceLineIds: ["line-1"],
    sourceOperations: ["REPARATION AILE"],
    sourceLaborHours: 1,
    taskModelVersion: 1,
    ...overrides,
  };
}

check("A generic fan-in graph survives normalizeState", () => {
  const normalized = normalizeCaseThroughState({
    id: "case-generic",
    durations: {},
    planningTasks: [
      canonicalTask({ id: "T1", taskId: "T1", key: "body", dependencies: [], parallelizable: true, vehicleExclusive: false }),
      canonicalTask({ id: "T2", taskId: "T2", key: "electrical", phase: "electrical", requiredRole: "electricien", dependencies: [], parallelizable: true, vehicleExclusive: false }),
      canonicalTask({ id: "T3", taskId: "T3", key: "reassembly", phase: "reassembly", dependencies: ["T1", "T2"] }),
    ],
  }).cases[0];
  const byId = Object.fromEntries(normalized.planningTasks.map((task) => [task.taskId, task]));
  assert.deepEqual(byId.T1.dependencies, []);
  assert.deepEqual(byId.T2.dependencies, []);
  assert.deepEqual(byId.T3.dependencies, ["T1", "T2"]);
  assert.equal(byId.T1.parallelizable, true);
  assert.equal(byId.T2.parallelizable, true);
});

check("B case PDF source alone cannot override canonical graph source", () => {
  const normalized = normalizeCaseThroughState({
    id: "case-pdf-history",
    source: "pdf_estimate",
    durations: {},
    planningTasks: [
      canonicalTask({ id: "paint-first", taskId: "paint-first", key: "paint", phase: "paint", requiredRole: "peintre", dependencies: [] }),
      canonicalTask({ id: "body-after", taskId: "body-after", key: "body", phase: "body", dependencies: ["paint-first"] }),
    ],
  }).cases[0];
  assert.deepEqual(normalized.planningTasks.map((task) => task.taskId), ["paint-first", "body-after"]);
  assert.deepEqual(normalized.planningTasks[1].dependencies, ["paint-first"]);
});

check("C explicit PDF task set remains canonical sequential", () => {
  const normalized = normalizeCaseThroughState({
    id: "case-real-pdf",
    source: "pdf_estimate",
    durations: {},
    planningTasks: [
      canonicalTask({ id: "pdf-paint", taskId: "pdf-paint", key: "paint", phase: "paint", requiredRole: "peintre", sourceKind: "pdf_estimate", source: "pdf_estimate", sourceLineIds: ["p2"], dependencies: ["pdf-body"] }),
      canonicalTask({ id: "pdf-body", taskId: "pdf-body", key: "body", phase: "body", sourceKind: "pdf_estimate", source: "pdf_estimate", sourceLineIds: ["p1"], dependencies: [] }),
    ],
  }).cases[0];
  assert.deepEqual(normalized.planningTasks.map((task) => task.taskId), ["pdf-paint", "pdf-body"], "a canonical PDF graph must be preserved after its import boundary");
  assert.deepEqual(normalized.planningTasks.map((task) => task.dependencies), [["pdf-body"], []]);

  context.__p1003LegacyPdf = [
    { id: "legacy-paint", phase: "paint", source: "pdf_estimate", sourceLineIds: ["l2"] },
    { id: "legacy-body", phase: "body", source: "pdf_estimate", sourceLineIds: ["l1"] },
  ];
  const legacy = toPlain(run("normalizePdfPlanningTasksForCase(__p1003LegacyPdf)"));
  assert.deepEqual(legacy.map((task) => task.taskId), ["legacy-body", "legacy-paint"]);
  assert.deepEqual(legacy[1].dependencies, ["legacy-body"]);
});

const provenanceState = normalizeCaseThroughState({ id: "case-provenance-runtime", durations: {}, planningTasks: [canonicalTask()] });
context.__p1003NormalizedState = provenanceState;
run("state = __p1003NormalizedState");
check("D provenance survives task to proposal to booking to reload", () => {
  const item = toPlain(run("state.cases[0]"));
  const proposal = scheduleCase(item, item.planningTasks);
  context.__p1003Step = proposal.steps[0];
  context.__p1003Item = item;
  const booking = toPlain(run("stepToBooking(__p1003Item, __p1003Step, false)"));
  context.__p1003Booking = booking;
  const reloaded = toPlain(run("normalizeBooking(__p1003Booking, new Set(state.resources.map((resource) => resource.id)))"));
  assert.equal(proposal.steps[0].taskModelVersion, 1);
  assert.equal(proposal.steps[0].sourceKind, "canonical_graph");
  assert.equal(reloaded.taskModelVersion, 1);
  assert.equal(reloaded.sourceKind, "canonical_graph");
  assert.deepEqual(reloaded.sourceLineIds, ["line-1"]);
  assert.deepEqual(reloaded.sourceOperations, ["REPARATION AILE"]);
  assert.equal(reloaded.sourceLaborHours, 1);
  assert.equal(reloaded.taskId, "canonical-body");
  assert.equal(reloaded.businessTaskId, "canonical-body");
});

check("E vehicleExclusive remains independent from parallelizable", () => {
  const shared = {
    caseId: "case-vehicle",
    start: "2026-09-07T07:00:00.000Z",
    end: "2026-09-07T08:00:00.000Z",
    segments: [{ start: "2026-09-07T07:00:00.000Z", end: "2026-09-07T08:00:00.000Z" }],
    status: "planned",
    vehicleLocation: "internal",
    parallelizable: true,
  };
  context.__p1003Existing = [{ ...shared, id: "existing", resourceIds: ["body-1"], vehicleExclusive: true }];
  context.__p1003Candidate = { ...shared, id: "candidate", resourceIds: ["electrician"], vehicleExclusive: true };
  assert.ok(run("findVehicleBookingConflict(__p1003Candidate, __p1003Existing)"));
  context.__p1003Existing = [{ ...context.__p1003Existing[0], vehicleExclusive: false }];
  context.__p1003Candidate = { ...context.__p1003Candidate, vehicleExclusive: false };
  assert.equal(run("findVehicleBookingConflict(__p1003Candidate, __p1003Existing)"), null);
});

check("F historical booking receives no invented provenance", () => {
  const raw = {
    id: "historical-booking",
    caseId: "historical-case",
    key: "body",
    title: "Historique",
    resourceIds: ["body-1"],
    start: "2026-09-07T07:00:00.000Z",
    end: "2026-09-07T08:00:00.000Z",
    segments: [{ start: "2026-09-07T07:00:00.000Z", end: "2026-09-07T08:00:00.000Z" }],
    status: "completed",
  };
  context.__p1003Historical = raw;
  const normalized = toPlain(run("normalizeBooking(__p1003Historical, new Set(['body-1']))"));
  for (const field of ["taskModelVersion", "sourceKind", "sourceLineIds", "sourceOperations", "sourceLaborHours"]) {
    assert.equal(Object.hasOwn(normalized, field), false, `${field} must remain absent`);
  }
});

check("G legacy unknown graph is preserved and normalization is idempotent", () => {
  const input = {
    id: "case-legacy-graph",
    durations: {},
    planningTasks: [
      { id: "legacy-a", key: "paint", durationMinutes: 30, dependencies: [], parallelizable: true, vehicleExclusive: false },
      { id: "legacy-b", key: "body", durationMinutes: 30, dependencies: ["legacy-a"], parallelizable: false, vehicleExclusive: true },
    ],
  };
  const once = normalizeCaseThroughState(input).cases[0];
  const twice = normalizeCaseThroughState(once).cases[0];
  assert.deepEqual(once.planningTasks, twice.planningTasks);
  assert.deepEqual(once.planningTasks.map((task) => task.taskId), ["legacy-a", "legacy-b"]);
  assert.deepEqual(once.planningTasks[1].dependencies, ["legacy-a"]);
  assert.equal(once.planningTasks[0].sourceKind, "legacy_unknown");

  const simple = normalizeCaseThroughState({
    id: "case-simple-legacy",
    durations: { body: 1, paint: 1 },
    tasks: [{ key: "body", durationMinutes: 60 }, { key: "paint", durationMinutes: 60 }],
  }).cases[0];
  context.__p1003SimpleLegacy = simple;
  assert.deepEqual(toPlain(run("getExplicitPlanningTasks(__p1003SimpleLegacy)")), []);
});

check("H canonical identity is strict at graph use but legacy loading remains tolerant", () => {
  const missing = normalizeCaseThroughState({
    id: "case-missing-id",
    durations: {},
    planningTasks: [{
      key: "body",
      title: "Canonical sans identite",
      durationMinutes: 60,
      requiredRole: "tolier",
      taskModelVersion: 1,
      sourceKind: "canonical_graph",
    }],
  }).cases[0];
  context.__p1003Missing = missing;
  assert.throws(() => run("buildCaseTaskGraph(__p1003Missing, __p1003Missing.planningTasks)"), /identit|ID/i);

  context.__p1003Duplicate = [canonicalTask({ id: "dup", taskId: "dup" }), canonicalTask({ id: "dup", taskId: "dup", key: "paint", requiredRole: "peintre" })];
  assert.throws(() => run("buildCaseTaskGraph({ id: 'dup-case' }, __p1003Duplicate)"), /dupliqu/i);

  const legacy = normalizeCaseThroughState({ id: "legacy-no-id", durations: { body: 1 }, tasks: [{ key: "body", durationMinutes: 60 }] }).cases[0];
  assert.equal(legacy.planningTasks.length, 1);
});

check("I subcontract technical steps retain canonical businessTaskId", () => {
  const stateValue = normalizeCaseThroughState({ id: "case-subcontract", durations: {} });
  context.__p1003SubState = stateValue;
  run("state = __p1003SubState");
  context.__p1003SubTask = canonicalTask({
    id: "canonical-external",
    taskId: "canonical-external",
    key: "paint",
    requiredRole: "peintre",
    requiredCategory: "peintre",
    serviceMode: "external",
  });
  const plan = toPlain(run("buildSubcontractPlan(state.cases[0], __p1003SubTask, 'paint-external', new Date('2026-09-07T07:00:00.000Z'), [])"));
  for (const step of plan.steps) {
    context.__p1003SubStep = step;
    const booking = toPlain(run("stepToBooking(state.cases[0], __p1003SubStep, false)"));
    assert.match(booking.taskId, /^canonical-external:/);
    assert.equal(booking.businessTaskId, "canonical-external");
  }
});

check("J anticipated new-parts compatibility remains disabled", () => {
  const stateValue = normalizeCaseThroughState({ id: "case-no-anticipated", durations: { body: 1 } });
  context.__p1003State = stateValue;
  run("state = __p1003State");
  const item = toPlain(run("state.cases[0]"));
  context.__p1003Item = item;
  const proposal = toPlain(run("schedulePipelineWithAnticipatedNewParts(__p1003Item, new Date('2026-09-07T07:00:00.000Z'), [], {})"));
  assert.equal(proposal.anticipatedNewParts, null);
});

check("K mixed PDF and manual task sets preserve the explicit graph", () => {
  const normalized = normalizeCaseThroughState({
    id: "case-mixed-source",
    source: "pdf_estimate",
    durations: {},
    planningTasks: [
      {
        id: "legacy-pdf-branch",
        taskId: "legacy-pdf-branch",
        key: "paint",
        phase: "paint",
        durationMinutes: 60,
        requiredRole: "peintre",
        source: "pdf_estimate",
        sourceLineIds: ["mixed-pdf-line"],
        dependencies: [],
        parallelizable: true,
        vehicleExclusive: false,
      },
      canonicalTask({
        id: "manual-branch",
        taskId: "manual-branch",
        key: "body",
        sourceKind: "manual",
        source: "pdf_estimate",
        dependencies: [],
        parallelizable: true,
        vehicleExclusive: false,
      }),
      canonicalTask({
        id: "mixed-join",
        taskId: "mixed-join",
        key: "reassembly",
        dependencies: ["legacy-pdf-branch", "manual-branch"],
      }),
    ],
  }).cases[0];
  assert.deepEqual(normalized.planningTasks.map((task) => task.taskId), ["legacy-pdf-branch", "manual-branch", "mixed-join"]);
  assert.deepEqual(normalized.planningTasks[2].dependencies, ["legacy-pdf-branch", "manual-branch"]);
  assert.equal(normalized.planningTasks[0].sourceKind, "pdf_estimate");
  assert.equal(normalized.planningTasks[1].sourceKind, "manual");
});

check("L canonical constraint fields round-trip and resourceIds remain hard", () => {
  const task = canonicalTask({
    id: "hard-resource-task",
    taskId: "hard-resource-task",
    resourceIds: ["body-2"],
    preferredResourceId: "body-1",
    preferredEquipmentId: "prep-zone",
    requiredSite: "internal",
    requiredCategory: "",
    equipmentRole: "",
    serviceMode: "internal",
    subcontractorId: "",
    vehicleLocation: "internal",
  });
  const normalized = normalizeCaseThroughState({ id: "case-hard-resource", durations: {}, planningTasks: [task] }).cases[0];
  assert.deepEqual(normalized.planningTasks[0].resourceIds, ["body-2"]);
  assert.equal(normalized.planningTasks[0].preferredResourceId, "body-1");
  assert.equal(normalized.planningTasks[0].preferredEquipmentId, "prep-zone");
  assert.equal(normalized.planningTasks[0].requiredSite, "internal");
  const proposal = scheduleCase(normalized, normalized.planningTasks);
  assert.deepEqual(proposal.steps[0].resourceIds, ["body-2"]);
  assert.equal(proposal.steps[0].vehicleLocation, "internal");
});

check("M PDF import boundary stamps canonical source metadata once", () => {
  context.__p1003ParsedPdf = {
    distributedLines: [
      { phase: "paint", laborHours: 2, sourceLineId: "pdf-line-2", sourceOperation: "PEINTURE" },
      { phase: "body", laborHours: 1, sourceLineId: "pdf-line-1", sourceOperation: "DEPOSE" },
    ],
  };
  const tasks = toPlain(run("getPdfEstimateTaskRows(__p1003ParsedPdf)"));
  assert.deepEqual(tasks.map((task) => task.phase), ["body", "paint"]);
  assert.deepEqual(tasks.map((task) => task.dependencies), [[], ["pdf-task-body"]]);
  assert.ok(tasks.every((task) => task.taskModelVersion === 1));
  assert.ok(tasks.every((task) => task.sourceKind === "pdf_estimate" && task.source === "pdf_estimate"));
  assert.deepEqual(tasks.map((task) => task.sourceLaborHours), [1, 2]);
});

check("N JSON persistence and granular case payload preserve canonical graph", () => {
  const normalized = normalizeCaseThroughState({
    id: "case-sync-roundtrip",
    durations: {},
    planningTasks: [
      canonicalTask({ id: "sync-a", taskId: "sync-a", dependencies: [], parallelizable: true, vehicleExclusive: false }),
      canonicalTask({ id: "sync-b", taskId: "sync-b", key: "electrical", requiredRole: "electricien", dependencies: ["sync-a"] }),
    ],
  });
  context.__p1003SerializedState = JSON.parse(JSON.stringify(normalized));
  const reloaded = toPlain(run("normalizeState(__p1003SerializedState)"));
  assert.deepEqual(reloaded.cases[0].planningTasks, normalized.cases[0].planningTasks);

  context.__p1003SyncState = reloaded;
  run("state = __p1003SyncState; markEntityCaseDirty(state.cases[0]);");
  const batch = toPlain(run("captureEntityMutationBatch(state, { workshopId: 'workshop-p1003' })"));
  const mutation = batch.find((entry) => entry.entityType === "case" && entry.entityId === "case-sync-roundtrip");
  assert.ok(mutation);
  assert.deepEqual(mutation.payload.entity.planningTasks, reloaded.cases[0].planningTasks);
});

for (const scenario of scenarios) {
  console.log(`${scenario.pass ? "PASS" : "FAIL"} ${scenario.name}${scenario.error ? `: ${scenario.error}` : ""}`);
}

const failures = scenarios.filter((scenario) => !scenario.pass);
if (failures.length) {
  throw new Error(`P1-003 canonical task model failures: ${failures.length}/${scenarios.length}`);
}

console.log(`P1-003 CANONICAL TASK MODEL OK (${scenarios.length} scenarios)`);
