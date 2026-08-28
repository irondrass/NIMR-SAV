import assert from "node:assert/strict";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { context, run } = createNimrVmContext({
  filename: "indexed-planner-view-p1004.js",
  console: { log() {}, warn() {}, error: console.error },
});

const START = "2026-09-07T08:00:00+01:00";
const CALENDAR = {
  0: "",
  1: "08:00-12:00,13:00-17:00",
  2: "08:00-12:00,13:00-17:00",
  3: "08:00-12:00,13:00-17:00",
  4: "08:00-12:00,13:00-17:00",
  5: "08:00-12:00,13:00-17:00",
  6: "",
};
const RESOURCES = [
  { id: "body-1", name: "Body 1", role: "tolier", active: true, calendar: CALENDAR },
  { id: "body-2", name: "Body 2", role: "tolier", active: true, calendar: CALENDAR },
  { id: "painter", name: "Painter", role: "peintre", active: true, calendar: CALENDAR },
  { id: "prep-zone", name: "Prep", role: "zone_preparation", active: true, calendar: CALENDAR },
  { id: "booth", name: "Booth", role: "cabine", active: true, calendar: CALENDAR },
  { id: "carrier", name: "Carrier", role: "transport", active: true, calendar: CALENDAR },
  { id: "external", name: "External", role: "peintre", category: "peintre", kind: "external", site: "external", external: true, active: true, calendar: CALENDAR, transportResourceId: "carrier", standardLeadTimeMinutes: 60 },
];

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function booking(id, caseId, resourceIds, start, end, overrides = {}) {
  return {
    id,
    caseId,
    key: "body",
    taskId: id,
    title: id,
    start,
    end,
    segments: [{ start, end }],
    resourceIds,
    primaryResourceId: resourceIds[0] || "",
    equipmentResourceIds: resourceIds.slice(1),
    status: "planned",
    vehicleExclusive: true,
    vehicleLocation: "internal",
    ...overrides,
  };
}

function install(bookings = [], cases = []) {
  context.__p1004State = {
    resources: RESOURCES,
    cases,
    bookings,
    users: [{ id: "chief", name: "Chief", role: "chef_atelier", active: true }],
    currentUserId: "chief",
    settings: { calendar: CALENDAR, fastLaneEnabled: false },
  };
  run("state = normalizeState(__p1004State); generatedProposals = {}; invalidateStateReplacementIndexes();");
}

function makeCanonicalTask(overrides = {}) {
  return {
    id: "task-body",
    taskId: "task-body",
    key: "body",
    title: "Body",
    durationMinutes: 60,
    requiredRole: "tolier",
    dependencies: [],
    parallelizable: false,
    vehicleExclusive: true,
    vehicleLocation: "internal",
    taskModelVersion: 1,
    sourceKind: "canonical_graph",
    ...overrides,
  };
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

install();
check("A zero bookings expose an empty indexed view", () => {
  assert.equal(run("typeof createIndexedPlannerBookingView"), "function");
  assert.equal(run("createIndexedPlannerBookingView(state.bookings).getCaseBookings('none').length"), 0);
});

const one = booking("one", "case-one", ["body-1"], "2026-09-07T07:00:00.000Z", "2026-09-07T08:00:00.000Z");
install([one]);
check("B one booking is indexed by case/resource/day/resource-day", () => {
  context.__p1004View = run("createIndexedPlannerBookingView(state.bookings)");
  assert.equal(run("__p1004View.getCaseBookings('case-one').length"), 1);
  assert.equal(run("__p1004View.getResourceBookings('body-1').length"), 1);
  assert.equal(run("__p1004View.getDayBookings('2026-09-07').length"), 1);
  assert.equal(run("__p1004View.getResourceDayBookings('body-1', '2026-09-07').length"), 1);
});

const unrelated = Array.from({ length: 2000 }, (_, index) => booking(
  `unrelated-${index}`,
  `case-${index}`,
  [index % 2 ? "painter" : "body-2"],
  "2026-10-05T07:00:00.000Z",
  "2026-10-05T08:00:00.000Z",
));
install([one, ...unrelated]);
check("C unrelated bookings are excluded from slot candidates", () => {
  context.__p1004View = run("createIndexedPlannerBookingView(state.bookings)");
  const candidates = toPlain(run("__p1004View.getConflictCandidates({ start: '2026-09-07T07:30:00.000Z', end: '2026-09-07T08:30:00.000Z', segments: [{ start: '2026-09-07T07:30:00.000Z', end: '2026-09-07T08:30:00.000Z' }] }, ['body-1'], 'new-case')"));
  assert.deepEqual(candidates.map((row) => row.id), ["one"]);
});

check("D resource lookup preserves source order", () => {
  const rows = toPlain(run("__p1004View.getResourceBookings('body-2')"));
  assert.deepEqual(rows.slice(0, 3).map((row) => row.id), ["unrelated-0", "unrelated-2", "unrelated-4"]);
});

check("E resource-day load equals the reference scan", () => {
  const indexed = run("__p1004View.getResourceDailyLoadMinutes('body-1', new Date('2026-09-07T07:00:00.000Z'))");
  const reference = run("getResourceLoadMinutesInRange('body-1', state.bookings, startOfDay(new Date('2026-09-07T07:00:00.000Z')), addDays(startOfDay(new Date('2026-09-07T07:00:00.000Z')), 1))");
  assert.equal(indexed, reference);
});

check("F case lookup returns every same-case booking", () => {
  install([one, booking("one-2", "case-one", ["body-2"], "2026-09-08T07:00:00.000Z", "2026-09-08T08:00:00.000Z")]);
  context.__p1004View = run("createIndexedPlannerBookingView(state.bookings)");
  assert.deepEqual(toPlain(run("__p1004View.getCaseBookings('case-one').map((row) => row.id)")), ["one", "one-2"]);
});

check("G proposal overlay is visible to later tasks but never stored", () => {
  install();
  context.__p1004View = run("createIndexedPlannerBookingView(state.bookings)");
  context.__p1004Overlay = booking("overlay", "proposal-case", ["body-1"], "2026-09-07T07:00:00.000Z", "2026-09-07T08:00:00.000Z", { temporary: true });
  run("__p1004View.addOverlay(__p1004Overlay)");
  assert.equal(run("__p1004View.getResourceBookings('body-1').length"), 1);
  assert.equal(run("state.bookings.length"), 0);
});

check("H balancing uses cached loads with two resources", () => {
  install([booking("busy", "old", ["body-1"], "2026-09-07T13:00:00.000Z", "2026-09-07T16:00:00.000Z")]);
  context.__p1004Item = { id: "balance", durations: { body: 1 } };
  const proposal = toPlain(run("generateSingleProposal(__p1004Item, new Date('2026-09-07T07:00:00.000Z'))"));
  assert.equal(proposal.steps[0].primaryResourceId, "body-2");
});

check("I technician plus equipment remains collision free", () => {
  install([booking("zone-busy", "old", ["prep-zone"], "2026-09-07T07:00:00.000Z", "2026-09-07T08:00:00.000Z")]);
  context.__p1004Item = { id: "paint-case", durations: { prep: 1 } };
  const proposal = toPlain(run("generateSingleProposal(__p1004Item, new Date('2026-09-07T07:00:00.000Z'))"));
  assert.ok(new Date(proposal.steps[0].start) >= new Date("2026-09-07T08:00:00.000Z"));
  assert.deepEqual(proposal.steps[0].resourceIds.sort(), ["painter", "prep-zone"].sort());
});

check("J vehicleExclusive proposal-local conflicts remain enforced", () => {
  install();
  context.__p1004View = run("createIndexedPlannerBookingView(state.bookings)");
  context.__p1004ExistingVehicle = booking("vehicle", "same-car", ["body-1"], "2026-09-07T07:00:00.000Z", "2026-09-07T08:00:00.000Z", { temporary: true });
  context.__p1004View.addOverlay(context.__p1004ExistingVehicle);
  context.__p1004Candidate = booking("candidate", "same-car", ["painter"], "2026-09-07T07:00:00.000Z", "2026-09-07T08:00:00.000Z");
  const indexed = toPlain(run("validatePlanningCandidate(__p1004Candidate, __p1004View)"));
  const reference = toPlain(run("validatePlanningCandidate(__p1004Candidate, [__p1004ExistingVehicle], { runtimeIndexCandidates: false })"));
  assert.equal(indexed.conflicts.some((row) => row.code === "vehicle_double_booking"), true);
  assert.deepEqual(indexed.conflicts.map((row) => row.code), reference.conflicts.map((row) => row.code));
});

check("K explicitly parallel non-exclusive tasks may overlap", () => {
  context.__p1004Candidate.vehicleExclusive = false;
  context.__p1004Candidate.parallelizable = true;
  run("__p1004View.clearOverlay(); __p1004View.addOverlay({ ...__p1004Candidate, id: 'parallel-existing', resourceIds: ['body-1'] })");
  context.__p1004Candidate = { ...context.__p1004Candidate, id: "parallel-candidate", resourceIds: ["painter"] };
  assert.equal(run("validatePlanningCandidate(__p1004Candidate, __p1004View).ok"), true);
});

check("L dependencies remain ordered", () => {
  install();
  context.__p1004Item = { id: "graph", durations: {}, planningTasks: [
    makeCanonicalTask({ id: "a", taskId: "a", parallelizable: true, vehicleExclusive: false }),
    makeCanonicalTask({ id: "b", taskId: "b", key: "paint", requiredRole: "peintre", parallelizable: true, vehicleExclusive: false }),
    makeCanonicalTask({ id: "c", taskId: "c", dependencies: ["a", "b"] }),
  ] };
  const proposal = toPlain(run("generateSingleProposal(__p1004Item, new Date('2026-09-07T07:00:00.000Z'))"));
  const byId = Object.fromEntries(proposal.steps.map((step) => [step.taskId, step]));
  assert.ok(new Date(byId.c.start) >= new Date(byId.a.end));
  assert.ok(new Date(byId.c.start) >= new Date(byId.b.end));
});

check("M canonical graph metadata is unchanged", () => {
  const proposal = toPlain(run("generateSingleProposal(__p1004Item, new Date('2026-09-07T07:00:00.000Z'))"));
  assert.deepEqual(proposal.steps.find((step) => step.taskId === "c").dependencies, ["a", "b"]);
});

check("N legacy graph remains schedulable", () => {
  install();
  context.__p1004Item = { id: "legacy", durations: {}, planningTasks: [{ id: "legacy-body", taskId: "legacy-body", key: "body", durationMinutes: 60, requiredRole: "tolier", resourceIds: ["body-2"], dependencies: [], parallelizable: false }] };
  const proposal = toPlain(run("generateSingleProposal(__p1004Item, new Date('2026-09-07T07:00:00.000Z'))"));
  assert.deepEqual(proposal.steps[0].resourceIds, ["body-2"]);
});

check("O PDF sequential graph retains its order", () => {
  install();
  context.__p1004Item = { id: "pdf", source: "pdf_estimate", durations: { body: 1, prep: 1, paint: 1 } };
  const proposal = toPlain(run("generateSingleProposal(__p1004Item, new Date('2026-09-07T07:00:00.000Z'))"));
  assert.deepEqual(proposal.steps.map((step) => step.key), ["body", "prep", "paint"]);
});

check("P external subcontract steps use the same overlay", () => {
  install();
  context.__p1004Item = { id: "external-case", durations: {} };
  context.__p1004Task = makeCanonicalTask({ id: "external-task", taskId: "external-task", key: "paint", requiredRole: "peintre", requiredCategory: "peintre", serviceMode: "external" });
  const plan = toPlain(run("buildSubcontractPlan(__p1004Item, __p1004Task, 'external', new Date('2026-09-07T07:00:00.000Z'), createIndexedPlannerBookingView(state.bookings))"));
  assert.equal(plan.steps.length, 3);
  assert.ok(new Date(plan.steps[1].start) >= new Date(plan.steps[0].end));
  assert.ok(new Date(plan.steps[2].start) >= new Date(plan.steps[1].end));
});

for (const [letter, status] of [["Q", "completed"], ["R", "started"], ["S", "completed"], ["T", "paused"]]) {
  check(`${letter} ${status} booking semantics remain unchanged`, () => {
    const row = booking(`${status}-${letter}`, "history", ["body-1"], "2026-09-07T07:00:00.000Z", "2026-09-07T08:00:00.000Z", { status, actualWorkedMinutes: status === "planned" ? 0 : 15 });
    install([row]);
    context.__p1004Row = row;
    assert.equal(run("isPlanningBlockingBooking(__p1004Row)"), status !== "completed");
  });
}

check("U overlay conflict advances the next proposal task", () => {
  install();
  context.__p1004Item = { id: "two-steps", durations: { body: 1, reassembly: 1 } };
  const proposal = toPlain(run("generateSingleProposal(__p1004Item, new Date('2026-09-07T07:00:00.000Z'))"));
  assert.ok(new Date(proposal.steps[1].start) >= new Date(proposal.steps[0].end));
});

check("V overlay load changes balancing", () => {
  install();
  context.__p1004View = run("createIndexedPlannerBookingView(state.bookings)");
  context.__p1004View.addOverlay(booking("overlay-load", "proposal-a", ["body-1"], "2026-09-07T13:00:00.000Z", "2026-09-07T16:00:00.000Z", { temporary: true }));
  const loaded = run("__p1004View.getResourceLoadMinutes('body-1', new Date('2026-09-07T07:00:00.000Z'))");
  const recomputations = run("__p1004View.getStats().resourceLoadRecomputations");
  assert.ok(loaded > run("__p1004View.getResourceLoadMinutes('body-2', new Date('2026-09-07T07:00:00.000Z'))"));
  assert.equal(run("__p1004View.getResourceLoadMinutes('body-1', new Date('2026-09-07T07:00:00.000Z'))"), loaded);
  assert.equal(run("__p1004View.getStats().resourceLoadRecomputations"), recomputations + 1, "only the first body-2 read may add one recomputation");
});

check("W candidate dates reuse indexed productive bookings", () => {
  install(unrelated);
  context.__p1004Item = { id: "dates", durations: { body: 1 } };
  const dates = toPlain(run("buildAvailableAppointmentDates(__p1004Item, new Date('2026-09-07T07:00:00.000Z'), 3, 2)"));
  assert.equal(dates.length, 2);
});

check("X overlay teardown leaves state and a new view clean", () => {
  install();
  context.__p1004View = run("createIndexedPlannerBookingView(state.bookings)");
  context.__p1004View.addOverlay(booking("ephemeral", "case", ["body-1"], "2026-09-07T07:00:00.000Z", "2026-09-07T08:00:00.000Z", { temporary: true }));
  run("__p1004View.clearOverlay(); __p1004Fresh = createIndexedPlannerBookingView(state.bookings)");
  assert.equal(run("__p1004View.getOverlaySize()"), 0);
  assert.equal(run("__p1004Fresh.getResourceBookings('body-1').length"), 0);
  assert.equal(run("state.bookings.length"), 0);
});

check("Y repeated results are deterministic and candidate loops avoid full scans", () => {
  install(unrelated);
  context.__p1004Item = { id: "deterministic", durations: { body: 1 } };
  const first = toPlain(run("generateSingleProposal(__p1004Item, new Date('2026-09-07T07:00:00.000Z'))"));
  const firstStats = toPlain(run("getLastIndexedPlannerViewStats()"));
  context.__p1004FinalStats = firstStats;
  const second = toPlain(run("generateSingleProposal(__p1004Item, new Date('2026-09-07T07:00:00.000Z'))"));
  assert.deepEqual(second.steps, first.steps);
  assert.equal(firstStats.fullArrayScansInCandidateLoops, 0);
  assert.ok(firstStats.indexLookups > 0);
  assert.ok(firstStats.candidateEvaluations > 0);
});

for (const result of checks) {
  console.log(`${result.pass ? "PASS" : "FAIL"} ${result.name}${result.error ? `: ${result.error}` : ""}`);
}
const failures = checks.filter((result) => !result.pass);
if (failures.length) throw new Error(`P1-004 indexed planner view failures: ${failures.length}/${checks.length}`);
console.log(`P1-004 INDEXED PLANNER VIEW OK (${checks.length} scenarios)`);
console.log(JSON.stringify({ plannerViewStats: context.__p1004FinalStats }, null, 2));
