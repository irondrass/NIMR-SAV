import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createNimrVmContext } from "../helpers/nimr_vm_context.mjs";

const quietConsole = { log() {}, warn() {}, error: console.error };
const { context, run } = createNimrVmContext({
  filename: "planner-scalability-p1001.js",
  console: quietConsole,
});

const START = "2026-09-07T08:00:00+01:00";
const WORK_HOURS = {
  0: [],
  1: [["08:00", "12:00"], ["13:00", "17:00"]],
  2: [["08:00", "12:00"], ["13:00", "17:00"]],
  3: [["08:00", "12:00"], ["13:00", "17:00"]],
  4: [["08:00", "12:00"], ["13:00", "17:00"]],
  5: [["08:00", "12:00"], ["13:00", "17:00"]],
  6: [["08:00", "13:00"]],
};

const resources = [
  ...Array.from({ length: 4 }, (_, index) => ({ id: `body-${index + 1}`, name: `Tôlier ${index + 1}`, role: "tolier", category: "tolier", active: true })),
  ...Array.from({ length: 3 }, (_, index) => ({ id: `painter-${index + 1}`, name: `Peintre ${index + 1}`, role: "peintre", category: "peintre", active: true })),
  { id: "prep-zone-1", name: "Zone préparation 1", role: "zone_preparation", active: true },
  { id: "prep-zone-2", name: "Zone préparation 2", role: "zone_preparation", active: true },
  { id: "booth-1", name: "Cabine 1", role: "cabine", active: true },
  { id: "booth-2", name: "Cabine 2", role: "cabine", active: true },
  { id: "mechanic-1", name: "Mécanicien", role: "mecanicien", active: true },
  { id: "lift-1", name: "Pont mécanique", role: "pont_mecanique", active: true },
  { id: "electrician-1", name: "Électricien", role: "electricien", active: true },
  { id: "quality-1", name: "Contrôle", role: "controle", active: true },
];

const bookingResourceIds = resources.map((resource) => resource.id);
const oneStepItem = { id: "bench-one", durations: { body: 1 } };
const sequentialItem = {
  id: "bench-sequential",
  durations: { body: 1, mechanical: 1, electrical: 1, prep: 1, paint: 1, reassembly: 1, finish: 0.5, quality: 0.5 },
};
const graphTasks = [
  { id: "01-body", key: "body", durationMinutes: 45, requiredRole: "tolier" },
  { id: "02-mechanical", key: "mechanical", durationMinutes: 45, requiredRole: "mecanicien", equipmentRole: "pont_mecanique", dependencies: ["01-body"] },
  { id: "03-electrical", key: "electrical", durationMinutes: 45, requiredRole: "electricien", dependencies: ["01-body"] },
  { id: "04-prep-a", key: "prep", durationMinutes: 45, requiredRole: "peintre", equipmentRole: "zone_preparation", dependencies: ["02-mechanical", "03-electrical"] },
  { id: "05-prep-b", key: "prep", durationMinutes: 45, requiredRole: "peintre", equipmentRole: "zone_preparation", dependencies: ["02-mechanical", "03-electrical"] },
  { id: "06-paint", key: "paint", durationMinutes: 45, requiredRole: "peintre", equipmentRole: "cabine", dependencies: ["04-prep-a", "05-prep-b"] },
  { id: "07-reassembly", key: "reassembly", durationMinutes: 45, requiredRole: "tolier", dependencies: ["06-paint"] },
  { id: "08-finish", key: "finish", durationMinutes: 45, requiredRole: "peintre", dependencies: ["07-reassembly"] },
  { id: "09-quality", key: "quality", durationMinutes: 45, requiredRole: "controle", dependencies: ["08-finish"] },
  { id: "10-final-electric", key: "electrical", durationMinutes: 45, requiredRole: "electricien", dependencies: ["09-quality"] },
];

function deterministicBookings(count) {
  const base = Date.parse("2025-01-06T08:00:00+01:00");
  return Array.from({ length: count }, (_, index) => {
    const day = index % 300;
    const hour = 8 + (index % 8);
    const start = new Date(base + day * 86_400_000 + hour * 3_600_000);
    const end = new Date(start.getTime() + 30 * 60_000);
    const resourceId = bookingResourceIds[index % bookingResourceIds.length];
    return {
      id: `bulk-${count}-${index}`,
      caseId: `bulk-case-${index}`,
      key: "body",
      title: "Charge historique déterministe",
      resourceIds: [resourceId],
      primaryResourceId: resourceId,
      start: start.toISOString(),
      end: end.toISOString(),
      segments: [{ start: start.toISOString(), end: end.toISOString() }],
      status: "planned",
      temporary: false,
    };
  });
}

function installState(bookings) {
  context.__benchState = {
    settings: { fastLaneEnabled: false, fastLaneMaxHours: 4 },
    workHours: WORK_HOURS,
    holidays: [],
    resources,
    cases: [oneStepItem, sequentialItem, { id: "bench-graph", durations: {} }],
    bookings,
    planningDate: "2026-09-07",
  };
  run("state = __benchState; generatedProposals = {}; invalidateUiRuntimeIndexes(); invalidatePlanningRuntimeIndexes();");
}

function measure(name, iterations, operation, metadata = {}) {
  const heapBefore = process.memoryUsage().heapUsed;
  const durations = [];
  let lastResult;
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    lastResult = operation();
    durations.push(performance.now() - started);
  }
  const heapAfter = process.memoryUsage().heapUsed;
  durations.sort((left, right) => left - right);
  return {
    name,
    iterations,
    wallMs: Number(durations.reduce((sum, value) => sum + value, 0).toFixed(2)),
    averageMs: Number((durations.reduce((sum, value) => sum + value, 0) / durations.length).toFixed(2)),
    medianMs: Number(durations[Math.floor(durations.length / 2)].toFixed(2)),
    minMs: Number(durations[0].toFixed(2)),
    maxMs: Number(durations.at(-1).toFixed(2)),
    heapDeltaMiB: Number(((heapAfter - heapBefore) / (1024 * 1024)).toFixed(2)),
    ...metadata,
    resultSummary: typeof lastResult === "object" && lastResult !== null
      ? { steps: lastResult.steps?.length, dates: Array.isArray(lastResult) ? lastResult.length : undefined, bookings: Array.isArray(lastResult) && !lastResult[0]?.date ? lastResult.length : undefined }
      : {},
  };
}

function pendingProposalFixture() {
  const pendingCases = Array.from({ length: 10 }, (_, index) => ({ id: `pending-${index}`, durations: { body: 1 } }));
  context.__pendingCases = pendingCases;
  run("state.cases.push(...__pendingCases); generatedProposals = {};");
  for (let index = 0; index < pendingCases.length; index += 1) {
    const start = new Date(Date.parse(START) + index * 60 * 60_000);
    const end = new Date(start.getTime() + 60 * 60_000);
    context.__pendingId = pendingCases[index].id;
    context.__pendingProposal = {
      start: start.toISOString(),
      end: end.toISOString(),
      delivery: end.toISOString(),
      marginMinutes: 0,
      steps: [{
        key: "body",
        taskId: `pending-task-${index}`,
        title: "Pending",
        start: start.toISOString(),
        end: end.toISOString(),
        segments: [{ start: start.toISOString(), end: end.toISOString() }],
        resourceIds: [`body-${(index % 4) + 1}`],
        vehicleExclusive: true,
      }],
    };
    run("generatedProposals[__pendingId] = { proposal: __pendingProposal, availableDates: [] };");
  }
}

const sizes = [1_000, 10_000, 100_000, 300_000];
const result = {
  suite: "P1-001 planner scalability",
  generatedAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  methodology: {
    deterministic: true,
    historicalBookingsOutsideCandidateHorizon: true,
    productionAppointmentLimit: 14,
    boundedLargeScaleAppointmentLimit: 1,
    abortedUnboundedTrial: "A direct all-tier run with appointment limit 14 exceeded 360000 ms and was manually stopped without output; 100k/300k appointment probes are therefore bounded to one returned candidate date.",
    note: "Iterations are intentionally bounded; this is characterization, not a production load test.",
  },
  runs: [],
};

for (const bookingCount of sizes) {
  const bookings = deterministicBookings(bookingCount);
  installState(bookings);
  const iterations = bookingCount <= 10_000 ? 3 : bookingCount <= 100_000 ? 2 : 1;
  const heavyIterations = bookingCount <= 10_000 ? 2 : 1;
  const appointmentLimit = bookingCount <= 10_000 ? 14 : 1;
  const measurements = [];

  context.__oneStepItem = oneStepItem;
  context.__sequentialItem = sequentialItem;
  context.__graphItem = { id: "bench-graph", durations: {} };
  context.__graphTasks = graphTasks;
  context.__start = START;
  context.__bookings = bookings;

  measurements.push(measure("generateSingleProposal", iterations, () => run("generateSingleProposal(__oneStepItem, new Date(__start))"), {
    bookingsSupplied: bookingCount, resources: resources.length, tasks: 1, candidateDates: 1,
  }));

  for (const horizonDays of [7, 30, 60]) {
    const available = measure(`buildAvailableAppointmentDates:${horizonDays}`, heavyIterations, () => run(`buildAvailableAppointmentDates(__oneStepItem, new Date(__start), ${horizonDays}, ${appointmentLimit})`), {
      bookingsSupplied: bookingCount, resources: resources.length, tasks: 1, horizonDays, candidateDates: Math.min(horizonDays, appointmentLimit), appointmentLimit,
    });
    measurements.push(available);
  }

  measurements.push(measure("findBestResourceSlot", iterations, () => run("findBestResourceSlot({ key: 'body', title: 'Tôlerie', role: 'tolier' }, new Date(__start), 60, __bookings, false, null, null, 'bench-core', { caseId: 'bench-core', stepKey: 'body', requiredSite: 'internal', vehicleLocation: 'internal', vehicleExclusive: true })"), {
    bookingsSupplied: bookingCount, resources: 4, tasks: 1, candidateDates: 1,
  }));

  measurements.push(measure("scheduleTaskGraph:10", heavyIterations, () => run("scheduleTaskGraph(__graphItem, __graphTasks, new Date(__start), __bookings)"), {
    bookingsSupplied: bookingCount, resources: resources.length, tasks: graphTasks.length, candidateDates: 1,
  }));

  measurements.push(measure("scheduleSequentialPipeline:8", heavyIterations, () => run("scheduleSequentialPipeline(__sequentialItem, new Date(__start), __bookings)"), {
    bookingsSupplied: bookingCount, resources: resources.length, tasks: 8, candidateDates: 1,
  }));

  pendingProposalFixture();
  measurements.push(measure("getPendingProposalBookings:10", iterations, () => run("getPendingProposalBookings('bench-one')"), {
    bookingsSupplied: bookingCount, resources: resources.length, tasks: 10, candidateDates: 0, pendingProposals: 10,
  }));

  const conflictStats = run("getPlanningConflictCandidateStats()");
  result.runs.push({ bookingCount, measurements, lastConflictCandidateStats: { ...conflictStats } });
  console.error(JSON.stringify({ progress: "completed", bookingCount, measurements: measurements.map(({ name, averageMs }) => ({ name, averageMs })) }));
  run("state.bookings = []; state.cases = []; generatedProposals = {}; invalidateUiRuntimeIndexes(); invalidatePlanningRuntimeIndexes();");
  context.__bookings = null;
  context.__benchState = null;
}

for (const runResult of result.runs) {
  assert.equal(runResult.measurements.length, 8);
  runResult.measurements.forEach((measurement) => {
    assert.ok(Number.isFinite(measurement.averageMs));
    assert.ok(measurement.averageMs >= 0);
  });
}

console.log(JSON.stringify(result, null, 2));
