import assert from "node:assert/strict";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const silentConsole = { log() {}, warn() {}, error: console.error };
const { context, run } = createNimrVmContext({
  filename: "planner-canonical-behavior-p1001.js",
  console: silentConsole,
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

const baseResources = [
  { id: "body-1", name: "Tôlier A", role: "tolier", active: true, dailyCapacityMinutes: 420 },
  { id: "body-2", name: "Tôlier B", role: "tolier", active: true, dailyCapacityMinutes: 420 },
  { id: "painter-1", name: "Peintre A", role: "peintre", active: true, dailyCapacityMinutes: 420 },
  { id: "painter-2", name: "Peintre B", role: "peintre", active: true, dailyCapacityMinutes: 420 },
  { id: "prep-zone", name: "Zone préparation", role: "zone_preparation", active: true, dailyCapacityMinutes: 420 },
  { id: "booth", name: "Cabine", role: "cabine", active: true, dailyCapacityMinutes: 420 },
  { id: "mechanic", name: "Mécanicien", role: "mecanicien", active: true, dailyCapacityMinutes: 420 },
  { id: "lift", name: "Pont", role: "pont_mecanique", active: true, dailyCapacityMinutes: 420 },
  { id: "electrician", name: "Électricien", role: "electricien", active: true, dailyCapacityMinutes: 420 },
  { id: "quality", name: "Contrôle", role: "controle", active: true, dailyCapacityMinutes: 420 },
];

const results = [];
const unexpected = [];

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function resetState({ resources = baseResources, cases = [], bookings = [], holidays = [], settings = {}, workHours } = {}) {
  context.__p1001State = {
    settings: { calendar: CALENDAR, fastLaneEnabled: false, ...settings },
    resources,
    cases,
    bookings,
    holidays,
    ...(workHours ? { workHours } : {}),
  };
  run("state = normalizeState(__p1001State); generatedProposals = {};");
}

function schedule(item, bookings = [], start = START) {
  context.__p1001Item = item;
  context.__p1001Bookings = bookings;
  context.__p1001Start = start;
  return toPlain(run("schedulePipeline(__p1001Item, new Date(__p1001Start), __p1001Bookings)"));
}

function graph(item, tasks, bookings = [], start = START) {
  context.__p1001Item = item;
  context.__p1001Tasks = tasks;
  context.__p1001Bookings = bookings;
  context.__p1001Start = start;
  return toPlain(run("scheduleTaskGraph(__p1001Item, __p1001Tasks, new Date(__p1001Start), __p1001Bookings)"));
}

function booking({ id, caseId = "other", resourceIds, start = START, end, type = "work", status = "planned", ...extra }) {
  const actualEnd = end || new Date(new Date(start).getTime() + 60 * 60_000).toISOString();
  return {
    id,
    caseId,
    type,
    key: extra.key || "body",
    title: id,
    resourceIds,
    start: new Date(start).toISOString(),
    end: actualEnd,
    segments: [{ start: new Date(start).toISOString(), end: actualEnd }],
    status,
    ...extra,
  };
}

function overlaps(left, right) {
  return left.segments.some((a) => right.segments.some((b) => new Date(a.start) < new Date(b.end) && new Date(a.end) > new Date(b.start)));
}

function totalMinutes(step) {
  return step.segments.reduce((sum, segment) => sum + Math.round((new Date(segment.end) - new Date(segment.start)) / 60_000), 0);
}

function scenario(id, title, classification, check) {
  try {
    const evidence = check() || {};
    results.push({ id, title, classification, evidence });
  } catch (error) {
    unexpected.push({ id, title, error: error.stack || error.message || String(error) });
  }
}

scenario("A", "single sequential case / no conflicts", "PASS", () => {
  resetState();
  const proposal = schedule({ id: "a", durations: { body: 1 } });
  assert.equal(proposal.steps.length, 1);
  assert.equal(proposal.steps[0].planningMode, "standard");
  return { start: proposal.start, resource: proposal.steps[0].primaryResourceId };
});

scenario("B", "explicit task graph with linear dependencies", "PASS", () => {
  resetState();
  const proposal = graph({ id: "b", durations: {} }, [
    { id: "b1", key: "body", durationMinutes: 60, requiredRole: "tolier" },
    { id: "b2", key: "prep", durationMinutes: 60, requiredRole: "peintre", equipmentRole: "zone_preparation", dependencies: ["b1"] },
    { id: "b3", key: "paint", durationMinutes: 60, requiredRole: "peintre", equipmentRole: "cabine", dependencies: ["b2"] },
  ]);
  assert.equal(proposal.taskGraph, true);
  assert.ok(new Date(proposal.steps[1].start) >= new Date(proposal.steps[0].end));
  assert.ok(new Date(proposal.steps[2].start) >= new Date(proposal.steps[1].end));
  return { order: proposal.steps.map((step) => step.taskId) };
});

scenario("C", "two independent graph tasks allowed to run in parallel", "PASS", () => {
  resetState();
  const proposal = graph({ id: "c", durations: {} }, [
    { id: "body", key: "body", durationMinutes: 60, requiredRole: "tolier", parallelizable: true },
    { id: "electric", key: "electrical", durationMinutes: 60, requiredRole: "electricien", parallelizable: true },
  ]);
  assert.equal(proposal.steps[0].start, proposal.steps[1].start);
  return { starts: proposal.steps.map((step) => step.start) };
});

scenario("D", "dependency blocks illegal parallel execution", "PASS", () => {
  resetState();
  const proposal = graph({ id: "d", durations: {} }, [
    { id: "body", key: "body", durationMinutes: 120, requiredRole: "tolier", parallelizable: true },
    { id: "electric", key: "electrical", durationMinutes: 60, requiredRole: "electricien", parallelizable: true, dependencies: ["body"] },
  ]);
  assert.ok(new Date(proposal.steps[1].start) >= new Date(proposal.steps[0].end));
  return { predecessorEnd: proposal.steps[0].end, dependentStart: proposal.steps[1].start };
});

scenario("E", "vehicleExclusive prevents incompatible overlap", "PASS", () => {
  resetState();
  const proposal = graph({ id: "e", durations: {} }, [
    { id: "body", key: "body", durationMinutes: 60, requiredRole: "tolier", vehicleExclusive: true },
    { id: "electric", key: "electrical", durationMinutes: 60, requiredRole: "electricien", vehicleExclusive: true },
  ]);
  assert.equal(overlaps(proposal.steps[0], proposal.steps[1]), false);
  return { sequentialized: true };
});

scenario("F", "two different vehicles may use different resources concurrently", "PASS", () => {
  resetState();
  const first = schedule({ id: "f-one", durations: { body: 1 } });
  const occupied = first.steps.map((step) => toPlain(context.stepToBooking({ id: "f-one" }, step, true)));
  const second = schedule({ id: "f-two", durations: { electrical: 1 } }, occupied);
  assert.equal(first.start, second.start);
  assert.notEqual(first.steps[0].primaryResourceId, second.steps[0].primaryResourceId);
  return { concurrentStart: first.start };
});

scenario("G", "technician collision", "PASS", () => {
  resetState({ resources: [baseResources[0]] });
  const busy = booking({ id: "g-busy", resourceIds: ["body-1"] });
  const proposal = schedule({ id: "g", durations: { body: 1 } }, [busy]);
  assert.ok(new Date(proposal.start) >= new Date(busy.end));
  return { delayedTo: proposal.start };
});

scenario("H", "equipment collision", "PASS", () => {
  resetState({ resources: [baseResources[2], baseResources[5]] });
  const busy = booking({ id: "h-busy", resourceIds: ["booth"], key: "paint" });
  const proposal = schedule({ id: "h", durations: { paint: 1 } }, [busy]);
  assert.ok(new Date(proposal.start) >= new Date(busy.end));
  return { delayedTo: proposal.start };
});

scenario("I", "technician + equipment simultaneous requirement", "PASS", () => {
  resetState({ resources: [baseResources[2], baseResources[5]] });
  const proposal = schedule({ id: "i", durations: { paint: 1 } });
  assert.deepEqual(proposal.steps[0].resourceIds, ["painter-1", "booth"]);
  return { resources: proposal.steps[0].resourceIds };
});

scenario("J", "work-hours boundary", "PASS", () => {
  resetState({ resources: [baseResources[0]] });
  const proposal = schedule({ id: "j", durations: { body: 2 } }, [], "2026-09-07T15:30:00+01:00");
  assert.ok(proposal.steps[0].segments.length >= 2);
  assert.notEqual(run(`todayKey(new Date(${JSON.stringify(proposal.steps[0].segments[0].start)}))`), run(`todayKey(new Date(${JSON.stringify(proposal.steps[0].segments.at(-1).start)}))`));
  return { segments: proposal.steps[0].segments };
});

scenario("K", "lunch/non-working interval", "PASS", () => {
  resetState({ resources: [baseResources[0]] });
  const proposal = schedule({ id: "k", durations: { body: 2 } }, [], "2026-09-07T11:00:00+01:00");
  assert.equal(proposal.steps[0].segments.length, 2);
  assert.equal(totalMinutes(proposal.steps[0]), 120);
  return { segments: proposal.steps[0].segments };
});

scenario("L", "holiday", "PASS", () => {
  resetState({ resources: [baseResources[0]], holidays: [{ date: "2026-09-07", label: "Férié" }] });
  const proposal = schedule({ id: "l", durations: { body: 1 } });
  assert.equal(run(`todayKey(new Date(${JSON.stringify(proposal.start)}))`), "2026-09-08");
  return { start: proposal.start };
});

scenario("M", "resource leave", "PASS", () => {
  resetState({ resources: [baseResources[0]] });
  const leave = booking({ id: "leave", caseId: "__leave__", type: "leave", resourceIds: ["body-1"], end: "2026-09-07T12:00:00+01:00" });
  const proposal = schedule({ id: "m", durations: { body: 1 } }, [leave]);
  assert.ok(new Date(proposal.start) >= new Date(leave.end));
  return { start: proposal.start };
});

scenario("N", "inactive resource", "PASS", () => {
  resetState({ resources: [{ ...baseResources[0], active: false }] });
  assert.throws(() => schedule({ id: "n", durations: { body: 1 } }), /Aucun technicien|capacité/i);
  return { rejected: true };
});

scenario("O", "requiredRole mismatch", "PASS", () => {
  resetState({ resources: [baseResources[0]] });
  assert.throws(() => graph({ id: "o", durations: {} }, [{ id: "paint", key: "paint", durationMinutes: 60, requiredRole: "peintre", resourceIds: ["body-1"] }]), /Aucune combinaison/i);
  return { rejected: true };
});

scenario("P", "requiredCategory mismatch", "PASS", () => {
  resetState({ resources: [{ ...baseResources[0], category: "junior", compatibleRoles: ["tolier", "junior"] }] });
  assert.throws(() => graph({ id: "p", durations: {} }, [{ id: "body", key: "body", durationMinutes: 60, requiredRole: "tolier", requiredCategory: "senior" }]), /Aucune combinaison/i);
  return { rejected: true };
});

scenario("Q", "site mismatch", "PASS", () => {
  resetState({ resources: [{ ...baseResources[2], id: "external-only", site: "external", external: true }] });
  assert.throws(() => graph({ id: "q", durations: {} }, [{ id: "paint", key: "paint", durationMinutes: 60, requiredRole: "peintre", requiredSite: "internal" }]), /Aucune combinaison/i);
  return { rejected: true };
});

scenario("R", "manual preferred resource", "AMBIGUOUS", () => {
  resetState({ resources: [baseResources[0], baseResources[1]] });
  const proposal = schedule({ id: "r", durations: { body: 1 }, stepPreferredResources: { body: "body-2" } });
  assert.equal(proposal.steps[0].primaryResourceId, "body-2");
  return { selected: "body-2", ambiguity: "preference outranks earlier completion and therefore behaves as a hard priority" };
});

scenario("S", "manual locked resource", "FAIL", () => {
  resetState({ resources: [{ ...baseResources[0], active: false }, baseResources[1]] });
  const proposal = schedule({ id: "s", durations: { body: 1 }, stepAssignmentLocks: { body: { resourceId: "body-1" } } });
  assert.equal(proposal.steps[0].primaryResourceId, "body-2");
  return { selected: "body-2", failure: "an inactive locked resource is silently replaced; lock is implemented as preference" };
});

scenario("T", "pending proposal blocks capacity before acceptance", "PASS", () => {
  const pendingCase = { id: "pending", durations: { body: 1 } };
  const target = { id: "target", durations: { body: 1 } };
  resetState({ resources: [baseResources[0]], cases: [pendingCase, target] });
  const pending = schedule(pendingCase);
  context.__pendingProposal = pending;
  run("generatedProposals.pending = { proposal: __pendingProposal, availableDates: [] };");
  context.__targetItem = target;
  const proposal = toPlain(run("generateSingleProposal(__targetItem, new Date(__p1001Start))"));
  assert.ok(new Date(proposal.start) >= new Date(pending.end));
  return { pendingEnd: pending.end, targetStart: proposal.start };
});

scenario("U", "accepted booking blocks capacity", "PASS", () => {
  const busy = booking({ id: "u-busy", resourceIds: ["body-1"] });
  resetState({ resources: [baseResources[0]], bookings: [busy] });
  const proposal = schedule({ id: "u", durations: { body: 1 } }, [busy]);
  assert.ok(new Date(proposal.start) >= new Date(busy.end));
  return { delayedTo: proposal.start };
});

scenario("V", "closed/archived cases do not produce pending planning load", "PASS", () => {
  const closed = { id: "closed", closedAt: "2026-09-01T00:00:00.000Z", durations: { body: 1 } };
  const target = { id: "v-target", durations: { body: 1 } };
  resetState({ resources: [baseResources[0]], cases: [closed, target] });
  const closedProposal = schedule(closed);
  context.__closedProposal = closedProposal;
  run("generatedProposals.closed = { proposal: __closedProposal, availableDates: [] };");
  assert.equal(toPlain(run("getPendingProposalBookings('v-target')")).length, 0);
  return { pendingBookings: 0 };
});

scenario("W", "external task behavior", "PASS", () => {
  const resources = [
    { id: "carrier", name: "Convoyeur", role: "transport", active: true, dailyCapacityMinutes: 420 },
    { id: "external-paint", name: "Peinture externe", role: "peintre", category: "peintre", site: "external", external: true, active: true, transportResourceId: "carrier", outboundTransferMinutes: 30, returnTransferMinutes: 30, standardLeadTimeMinutes: 120 },
  ];
  resetState({ resources });
  const proposal = graph({ id: "w", durations: {} }, [{ id: "paint", key: "paint", durationMinutes: 60, requiredRole: "peintre", serviceMode: "external", subcontractorId: "external-paint" }]);
  assert.deepEqual(proposal.steps.map((step) => step.subcontractPhase), ["subcontract_transfer_out", "subcontract_work", "subcontract_transfer_return"]);
  return { phases: proposal.steps.map((step) => step.subcontractPhase) };
});

scenario("X", "long task greater than daily capacity", "FAIL", () => {
  resetState({ resources: [baseResources[2], baseResources[5]] });
  const proposal = graph({ id: "x", durations: {} }, [{ id: "paint", key: "paint", durationMinutes: 600, requiredRole: "peintre", equipmentRole: "cabine" }]);
  assert.equal(proposal.steps.length, 1);
  assert.equal(totalMinutes(proposal.steps[0]), 600);
  assert.ok(proposal.steps[0].segments.length > 2);
  assert.deepEqual(proposal.steps[0].resourceIds, ["painter-1", "booth"]);
  assert.equal(run(`todayKey(new Date(${JSON.stringify(proposal.start)}))`), "2026-09-12");
  return {
    representation: "one step, multi-day productive segments",
    start: proposal.start,
    segments: proposal.steps[0].segments.length,
    failure: "with default 8-hour weekdays and a 420-minute cap, the search skips whole over-capacity days and delays the 600-minute task to the 5-hour Saturday",
  };
});

scenario("Y", "very long task spanning multiple days", "FAIL", () => {
  resetState({ resources: [baseResources[0]] });
  assert.throws(
    () => schedule({ id: "y", durations: { body: 20 } }),
    /supérieure à la capacité journalière|capacité atelier/i,
  );
  return { failure: "the multi-day slot builder exists, but higher-level resource validation fails for this duration" };
});

scenario("Z", "body to prep to paint to reassembly to finish flow", "FAIL", () => {
  resetState();
  const tasks = [
    { id: "body", key: "body", durationMinutes: 60, requiredRole: "tolier" },
    { id: "prep", key: "prep", durationMinutes: 60, requiredRole: "peintre", equipmentRole: "zone_preparation", dependencies: ["body"] },
    { id: "paint", key: "paint", durationMinutes: 60, requiredRole: "peintre", equipmentRole: "cabine", dependencies: ["prep"] },
    { id: "reassembly", key: "reassembly", durationMinutes: 60, requiredRole: "tolier", dependencies: ["paint"] },
    { id: "finish", key: "finish", durationMinutes: 60, requiredRole: "peintre", dependencies: ["reassembly"] },
  ];
  const proposal = graph({ id: "z", durations: {} }, tasks);
  const byKey = Object.fromEntries(proposal.steps.map((step) => [step.key, step]));
  assert.notEqual(byKey.body.primaryResourceId, byKey.reassembly.primaryResourceId);
  assert.deepEqual(byKey.prep.equipmentResourceIds, ["prep-zone"]);
  assert.deepEqual(byKey.paint.equipmentResourceIds, ["booth"]);
  return {
    bodyworkerByStep: { body: byKey.body.primaryResourceId, reassembly: byKey.reassembly.primaryResourceId },
    painterByStep: { prep: byKey.prep.primaryResourceId, paint: byKey.paint.primaryResourceId, finish: byKey.finish.primaryResourceId },
    failure: "task-graph allocation does not apply the sequential bodyworker/painter continuity preferences",
  };
});

scenario("AA", "same case regeneration ignores its own existing proposal/booking", "PASS", () => {
  const own = booking({ id: "aa-own", caseId: "aa", resourceIds: ["body-1"] });
  const item = { id: "aa", durations: { body: 1 } };
  resetState({ resources: [baseResources[0]], cases: [item], bookings: [own] });
  context.__aaItem = item;
  const proposal = toPlain(run("generateSingleProposal(__aaItem, new Date(__p1001Start))"));
  assert.equal(new Date(proposal.start).getTime(), new Date(own.start).getTime());
  return { regeneratedStart: proposal.start, oldStart: own.start };
});

scenario("AB", "two equal resources produce deterministic allocation", "PASS", () => {
  resetState({ resources: [baseResources[0], baseResources[1]] });
  const winners = Array.from({ length: 5 }, () => schedule({ id: "ab", durations: { body: 1 } }).steps[0].primaryResourceId);
  assert.equal(new Set(winners).size, 1);
  return { winner: winners[0], runs: winners.length };
});

scenario("AC", "appointment-date search deterministic across repeated runs", "PASS", () => {
  resetState({ resources: [baseResources[0]] });
  context.__acItem = { id: "ac", durations: { body: 1 } };
  const first = toPlain(run("buildAvailableAppointmentDates(__acItem, new Date('2026-09-07T00:00:00+01:00'), 7, 7)"));
  const second = toPlain(run("buildAvailableAppointmentDates(__acItem, new Date('2026-09-07T00:00:00+01:00'), 7, 7)"));
  assert.deepEqual(first, second);
  return { dates: first.map((entry) => entry.date) };
});

scenario("AD", "PDF explicit tasks preserve aggregation and canonical dependencies", "PASS", () => {
  context.__adTasks = [
    { id: "pdf-task-paint", phase: "paint", sourceLineIds: ["l2"], sourceOperations: ["PEINTURE"], sourceLaborHours: 2, dependencies: [] },
    { id: "pdf-task-body", phase: "body", sourceLineIds: ["l1"], sourceOperations: ["DÉMONTAGE"], sourceLaborHours: 3, dependencies: ["pdf-task-paint"] },
  ];
  const normalized = toPlain(run("normalizePdfPlanningTasksForCase(__adTasks)"));
  assert.deepEqual(normalized.map((task) => task.phase), ["body", "paint"]);
  assert.deepEqual(normalized[1].dependencies, ["pdf-task-body"]);
  assert.deepEqual(normalized[0].sourceOperations, ["DÉMONTAGE"]);
  assert.equal(normalized[1].sourceLaborHours, 2);
  return { phases: normalized.map((task) => task.phase), dependencies: normalized.map((task) => task.dependencies) };
});

scenario("AE", "legacy sequential fallback remains functional", "PASS", () => {
  resetState({ resources: [baseResources[0]] });
  const proposal = schedule({ id: "ae", durations: { body: 1 }, tasks: [{ id: "legacy-row", title: "Legacy UI row" }] });
  assert.equal(proposal.taskGraph, undefined);
  assert.equal(proposal.steps[0].planningMode, "standard");
  return { mode: "sequential" };
});

scenario("AF", "anticipated-parts compatibility function creates no special booking", "PASS", () => {
  resetState({ resources: [baseResources[0], baseResources[2], baseResources[4], baseResources[5]] });
  context.__afItem = { id: "af", durations: { body: 1, prep: 1, paint: 1 } };
  const compatibility = toPlain(run("schedulePipelineWithAnticipatedNewParts(__afItem, new Date(__p1001Start), [], { prep: 60, paint: 0, rows: [{ label: 'Aile' }] })"));
  const sequential = toPlain(run("scheduleSequentialPipeline(__afItem, new Date(__p1001Start), [])"));
  assert.deepEqual(compatibility, sequential);
  assert.equal(compatibility.steps.some((step) => /anticip/i.test(step.title)), false);
  return { anticipatedNewParts: compatibility.anticipatedNewParts };
});

resetState({ resources: [baseResources[0], baseResources[2], baseResources[5]] });
const longTaskObservations = {};
for (const minutes of [600, 840, 1200]) {
  let sequential = null;
  let taskGraph = null;
  let sequentialError = "";
  let taskGraphError = "";
  try {
    sequential = schedule({ id: `long-seq-${minutes}`, durations: { body: minutes / 60 } });
  } catch (error) {
    sequentialError = error.message || String(error);
  }
  try {
    taskGraph = graph({ id: `long-graph-${minutes}`, durations: {} }, [{ id: "paint", key: "paint", durationMinutes: minutes, requiredRole: "peintre", equipmentRole: "cabine" }]);
  } catch (error) {
    taskGraphError = error.message || String(error);
  }
  longTaskObservations[minutes] = {
    sequential: sequential
      ? { result: "scheduled", steps: sequential.steps.length, segments: sequential.steps[0].segments.length, productiveSegments: sequential.steps[0].segments, minutes: totalMinutes(sequential.steps[0]), start: sequential.start, end: sequential.end }
      : { result: "failed", error: sequentialError },
    taskGraph: taskGraph
      ? { result: "scheduled", steps: taskGraph.steps.length, segments: taskGraph.steps[0].segments.length, productiveSegments: taskGraph.steps[0].segments, minutes: totalMinutes(taskGraph.steps[0]), start: taskGraph.start, end: taskGraph.end, resources: taskGraph.steps[0].resourceIds }
      : { result: "failed", error: taskGraphError },
  };
}

const alignedSevenHourWorkHours = {
  0: [],
  1: [["08:00", "12:00"], ["13:00", "16:00"]],
  2: [["08:00", "12:00"], ["13:00", "16:00"]],
  3: [["08:00", "12:00"], ["13:00", "16:00"]],
  4: [["08:00", "12:00"], ["13:00", "16:00"]],
  5: [["08:00", "12:00"], ["13:00", "16:00"]],
  6: [],
};
resetState({ resources: [baseResources[0], baseResources[2], baseResources[5]], workHours: alignedSevenHourWorkHours });
const alignedCapacityObservations = {};
for (const minutes of [600, 840, 1200]) {
  const sequential = schedule({ id: `aligned-seq-${minutes}`, durations: { body: minutes / 60 } });
  const taskGraph = graph({ id: `aligned-graph-${minutes}`, durations: {} }, [{ id: "paint", key: "paint", durationMinutes: minutes, requiredRole: "peintre", equipmentRole: "cabine" }]);
  alignedCapacityObservations[minutes] = {
    sequential: { result: "scheduled", segments: sequential.steps[0].segments.length, start: sequential.start, end: sequential.end },
    taskGraph: { result: "scheduled", segments: taskGraph.steps[0].segments.length, start: taskGraph.start, end: taskGraph.end },
  };
  assert.equal(totalMinutes(sequential.steps[0]), minutes);
  assert.equal(totalMinutes(taskGraph.steps[0]), minutes);
}

context.__primitiveStart = START;
const crossDayPrimitive = toPlain(run("buildWorkingSlot(new Date(__primitiveStart), 1200)"));
assert.equal(totalMinutes(crossDayPrimitive), 1200);

resetState();
context.__legacyGraphCase = {
  id: "legacy-normalization-drift",
  source: "manual",
  durations: {},
  planningTasks: [
    { id: "later", phase: "paint", dependencies: [], parallelizable: true },
    { id: "first", phase: "body", dependencies: ["later"], parallelizable: true },
  ],
};
const normalizedLegacyGraph = toPlain(run("normalizeCase(__legacyGraphCase, []).planningTasks"));
assert.deepEqual(normalizedLegacyGraph.map((task) => task.phase), ["paint", "body"]);
assert.deepEqual(normalizedLegacyGraph.map((task) => task.dependencies), [[], ["later"]]);
assert.deepEqual(normalizedLegacyGraph.map((task) => task.parallelizable), [true, true]);
assert.deepEqual(normalizedLegacyGraph.map((task) => task.sourceKind), ["legacy_unknown", "legacy_unknown"]);

assert.equal(unexpected.length, 0, unexpected.map((entry) => `${entry.id}: ${entry.error}`).join("\n\n"));
assert.equal(results.length, 32);

const counts = results.reduce((summary, result) => {
  summary[result.classification] = (summary[result.classification] || 0) + 1;
  return summary;
}, { PASS: 0, FAIL: 0, UNSUPPORTED: 0, AMBIGUOUS: 0 });

const output = {
  suite: "P1-001 planner canonical behavior",
  counts,
  scenarios: results,
  longTaskObservations,
  alignedCapacityObservations,
  crossDayPrimitive: { minutes: totalMinutes(crossDayPrimitive), segments: crossDayPrimitive.segments.length, start: crossDayPrimitive.start, end: crossDayPrimitive.end },
  deterministicRegressions: [
    "Manual assignment locks are treated as preferences and may silently fall back.",
    "normalizeCase applies the PDF sequentializer to all planningTasks/tasks, overwriting non-PDF dependency and parallelism semantics.",
    "Same-case accepted bookings are deliberately excluded during regeneration; later acceptance replaces every booking for the case.",
  ],
};

console.log(JSON.stringify(output, null, 2));
