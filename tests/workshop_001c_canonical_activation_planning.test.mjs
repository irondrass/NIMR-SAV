import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const silentConsole = { log() {}, warn() {}, error: console.error };
const { context, run } = createNimrVmContext({
  filename: "workshop-001c-canonical-activation.js",
  console: silentConsole,
});

const toPlain = (v) => JSON.parse(JSON.stringify(v));

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

function resetState({ resources = baseResources, cases = [], bookings = [], holidays = [], settings = {} } = {}) {
  context.__rawState = {
    currentUser: { id: "admin-1", role: "admin", name: "Directeur" },
    currentUserId: "admin-1",
    users: [{ id: "admin-1", role: "admin", name: "Directeur", active: true }],
    settings: { calendar: CALENDAR, fastLaneEnabled: false, ...settings },
    resources,
    cases,
    bookings,
    holidays,
  };
  run("state = normalizeState(__rawState); generatedProposals = {};");
}

function addCase(item) {
  context.__caseItem = item;
  run("state.cases.push(__caseItem);");
}

function addBooking(booking) {
  context.__bookingItem = booking;
  run("state.bookings.push(__bookingItem);");
}

function getBookings() {
  return toPlain(run("state.bookings"));
}

function schedule(item, bookings = [], start = "2026-09-07T08:00:00+01:00") {
  context.__schedItem = item;
  context.__schedBookings = bookings;
  context.__schedStart = start;
  return toPlain(run("schedulePipeline(__schedItem, new Date(__schedStart), __schedBookings);"));
}

function generateSingle(item, start = "2026-09-07T08:00:00+01:00") {
  context.__propItem = item;
  context.__propStart = start;
  return toPlain(run("generateSingleProposal(__propItem, new Date(__propStart));"));
}

function applyProposal(item, proposal, options = { throwOnError: true }) {
  context.__appItem = item;
  context.__appProp = proposal;
  context.__appOptions = options;
  return toPlain(run("applyAcceptedPlanningProposal(__appItem, __appProp, __appOptions);"));
}

function getTasks(item) {
  context.__tasksItem = item;
  return toPlain(run("getCasePlanningTasks(__tasksItem);"));
}

const START_DATE = "2026-09-07T08:00:00+01:00";

console.log("--- STARTING WORKSHOP-001C CANONICAL ACTIVATION TESTS ---");

// Test 1: Source-derived case activates canonical task graph
{
  console.log("Test 1: Source-derived case activates canonical task graph");
  resetState();
  const testCase = {
    id: "case-act-1",
    claims: [{
      id: "claim-1",
      estimate: {
        originalLines: [
          {
            id: "L1",
            operation: "REPARATION AILE ARD",
            laborHours: 2.0,
            allocations: [{ phase: "body", laborHours: 2.0 }],
          },
          {
            id: "L-prep",
            operation: "PREPARATION AILE ARD",
            laborHours: 0.5,
            allocations: [{ phase: "prep", laborHours: 0.5 }],
          },
          {
            id: "L2",
            operation: "PEINTURE AILE ARD",
            laborHours: 1.5,
            allocations: [{ phase: "paint", laborHours: 1.5 }],
          },
        ],
      },
    }],
  };
  addCase(testCase);
  const proposal = schedule(testCase, []);
  assert.equal(proposal.taskGraph, true, "Proposal must be scheduled as taskGraph");
  assert.ok(Array.isArray(proposal.steps), "Proposal must contain steps");
  assert.equal(proposal.steps.length, 3, "Must schedule 3 tasks: body op, prep batch, paint batch");
}

// Test 2: Canonical operation titles become planning step titles
{
  console.log("Test 2: Canonical operation titles become planning step titles");
  resetState();
  const testCase = {
    id: "case-act-2",
    claims: [{
      id: "claim-1",
      estimate: {
        originalLines: [
          {
            id: "L1",
            operation: "REPARATION AILE ARD",
            laborHours: 2.0,
            allocations: [{ phase: "body", laborHours: 2.0 }],
          },
          {
            id: "L-prep",
            operation: "PREPARATION AILE ARD",
            laborHours: 0.5,
            allocations: [{ phase: "prep", laborHours: 0.5 }],
          },
          {
            id: "L2",
            operation: "PEINTURE AILE ARD",
            laborHours: 1.0,
            allocations: [{ phase: "paint", laborHours: 1.0 }],
          },
        ],
      },
    }],
  };
  addCase(testCase);
  const proposal = schedule(testCase, []);
  const titles = proposal.steps.map((s) => s.title);
  assert.ok(titles.includes("REPARATION AILE ARD"), "Must include operation title REPARATION AILE ARD");
  assert.ok(titles.some((t) => t.startsWith("PRÉPARATION GLOBALE")), "Must include preparation batch title");
  assert.ok(titles.some((t) => t.startsWith("PEINTURE")), "Must include paint batch title");
  assert.ok(!titles.includes("Tôlerie"), "Must NOT merely show phase label Tôlerie");
}

// Test 3: Canonical IDs and dependencies survive scheduling
{
  console.log("Test 3: Canonical IDs and dependencies survive scheduling");
  resetState();
  const testCase = {
    id: "case-act-3",
    claims: [{
      id: "claim-1",
      estimate: {
        originalLines: [
          {
            id: "L1",
            operation: "REMPLACEMENT PORTE AVD",
            laborHours: 2.0,
            allocations: [{ phase: "body", laborHours: 2.0 }],
          },
          {
            id: "L2",
            operation: "PEINTURE PORTE AVD",
            laborHours: 1.5,
            allocations: [{ phase: "paint", laborHours: 1.5 }],
          },
        ],
      },
    }],
  };
  addCase(testCase);
  const proposal = schedule(testCase, []);
  const bodyStep = proposal.steps.find((s) => s.title === "REMPLACEMENT PORTE AVD");
  assert.ok(bodyStep, "Body step must exist");
  assert.ok(bodyStep.taskId.startsWith("task-op|case-act-3|claim-1|L1|body"), "Body step must retain canonical taskId");
  assert.equal(bodyStep.taskModelVersion, 1, "Body step must retain taskModelVersion 1");
  assert.deepEqual(bodyStep.sourceLineIds, ["L1"], "Body step must retain sourceLineIds");
  assert.deepEqual(bodyStep.sourceClaimIds, ["claim-1"], "Body step must retain sourceClaimIds");

  const paintStep = proposal.steps.find((s) => s.key === "paint");
  assert.ok(paintStep, "Paint step must exist");
  assert.ok(paintStep.dependencies.length > 0, "Paint step must have dependencies");
}

// Test 4: Duration-only legacy case remains sequential fallback
{
  console.log("Test 4: Duration-only legacy case remains sequential fallback");
  resetState();
  const legacyCase = {
    id: "case-legacy-4",
    durations: {
      body: 2.0,
      paint: 1.0,
    },
  };
  addCase(legacyCase);
  const proposal = schedule(legacyCase, []);
  assert.notEqual(proposal.taskGraph, true, "Legacy duration-only case must NOT be taskGraph");
  const titles = proposal.steps.map((s) => s.title);
  assert.deepEqual(titles, ["Tôlerie + démontage", "Peinture + vernis"], "Legacy case must retain sequential phase titles");
}

// Test 5: Explicit planningTasks remain authoritative
{
  console.log("Test 5: Explicit planningTasks remain authoritative");
  resetState();
  const explicitCase = {
    id: "case-explicit-5",
    claims: [{
      id: "claim-1",
      estimate: {
        originalLines: [
          {
            id: "L1",
            operation: "CANONICAL DERIVED OP",
            laborHours: 2.0,
            allocations: [{ phase: "body", laborHours: 2.0 }],
          },
        ],
      },
    }],
    planningTasks: [
      {
        id: "explicit-task-1",
        taskId: "explicit-task-1",
        key: "body",
        title: "TACHE EXPLICITE MANUELLE",
        durationMinutes: 60,
        requiredRole: "tolier",
        dependencies: [],
      },
    ],
  };
  addCase(explicitCase);
  const proposal = schedule(explicitCase, []);
  assert.equal(proposal.steps.length, 1, "Must schedule only the explicit task");
  assert.equal(proposal.steps[0].title, "TACHE EXPLICITE MANUELLE", "Explicit planning task title must win");
  assert.equal(proposal.steps[0].taskId, "explicit-task-1", "Explicit taskId must be preserved");
}

// Test 6: Existing source-aware legacy explicit tasks remain authoritative
{
  console.log("Test 6: Existing source-aware legacy explicit tasks remain authoritative");
  resetState();
  const legacySourcedCase = {
    id: "case-legacy-sourced-6",
    claims: [{
      id: "claim-1",
      estimate: {
        originalLines: [
          {
            id: "L1",
            operation: "CANONICAL DERIVED OP",
            laborHours: 2.0,
            allocations: [{ phase: "body", laborHours: 2.0 }],
          },
        ],
      },
    }],
    tasks: [
      {
        id: "pdf-explicit-1",
        taskId: "pdf-explicit-1",
        key: "body",
        title: "TACHE PDF EXPLICITE",
        durationMinutes: 90,
        requiredRole: "tolier",
        sourceKind: "pdf_estimate",
        dependencies: [],
      },
    ],
  };
  addCase(legacySourcedCase);
  const proposal = schedule(legacySourcedCase, []);
  assert.equal(proposal.steps.length, 1, "Must schedule the source-aware item.tasks");
  assert.equal(proposal.steps[0].title, "TACHE PDF EXPLICITE", "Source-aware item.tasks title must win");
}

// Test 7: External explicit planning flow remains unchanged
{
  console.log("Test 7: External explicit planning flow remains unchanged");
  resetState({
    resources: [
      ...baseResources,
      { id: "subcontractor-1", name: "Sous-traitant Peinture", role: "peintre", active: true, site: "external" },
    ],
  });
  const externalCase = {
    id: "case-ext-7",
    durations: { body: 1.0, paint: 2.0 },
    stepExecutionModes: { paint: "external" },
    stepSubcontractorIds: { paint: "subcontractor-1" },
  };
  addCase(externalCase);
  const proposal = schedule(externalCase, []);
  assert.equal(proposal.taskGraph, true, "External step pipeline must use taskGraph");
  const externalStep = proposal.steps.find((s) => s.key === "subcontract_work");
  assert.ok(externalStep, "Subcontract work step must exist");
  assert.equal(externalStep.serviceMode, "external", "Subcontract work step must be external");
}

// Test 8: Proposal generation does not write item.planningTasks
{
  console.log("Test 8: Proposal generation does not write item.planningTasks");
  resetState();
  const pristineCase = {
    id: "case-pristine-8",
    claims: [{
      id: "claim-1",
      estimate: {
        originalLines: [
          {
            id: "L1",
            operation: "REDRESSAGE LONGERON",
            laborHours: 3.0,
            allocations: [{ phase: "body", laborHours: 3.0 }],
          },
        ],
      },
    }],
  };
  addCase(pristineCase);
  assert.equal(pristineCase.planningTasks, undefined, "planningTasks must be undefined before proposal");
  const proposal = schedule(pristineCase, []);
  assert.ok(proposal, "Proposal generated");
  assert.equal(pristineCase.planningTasks, undefined, "schedulePipeline must NOT mutate item.planningTasks");

  context.__pristineItem = pristineCase;
  const options = toPlain(run("generateAppointmentOptions(__pristineItem);"));
  assert.ok(options.proposal, "Appointment options generated");
  assert.equal(pristineCase.planningTasks, undefined, "generateAppointmentOptions must NOT mutate item.planningTasks");
}

// Test 9: Acceptance creates operation-level bookings
{
  console.log("Test 9: Acceptance creates operation-level bookings");
  resetState();
  const testCase = {
    id: "case-accept-9",
    flags: {},
    claims: [{
      id: "claim-1",
      estimate: {
        originalLines: [
          {
            id: "L1",
            operation: "REMPLACEMENT AILE ARG",
            laborHours: 2.0,
            allocations: [{ phase: "body", laborHours: 2.0 }],
          },
        ],
      },
    }],
  };
  addCase(testCase);
  const single = generateSingle(testCase);
  assert.ok(single.acceptance, "Proposal has acceptance metadata");
  const accepted = applyProposal(testCase, single);
  assert.equal(accepted, true, "Proposal must be accepted");
  const caseBookings = getBookings().filter((b) => b.caseId === testCase.id);
  assert.ok(caseBookings.length > 0, "Bookings must be created");
  const bodyBooking = caseBookings.find((b) => b.key === "body");
  assert.ok(bodyBooking, "Body booking must exist");
  assert.equal(bodyBooking.title, "REMPLACEMENT AILE ARG", "Booking title must be canonical operation title");
  assert.ok(bodyBooking.taskId.startsWith("task-op|case-accept-9|claim-1|L1|body"), "Booking taskId must be canonical");
}

// Test 10: sourceClaimIds survive task -> step -> booking -> normalizeState
{
  console.log("Test 10: sourceClaimIds survive task -> step -> booking -> normalizeState");
  resetState();
  const testCase = {
    id: "case-claimids-10",
    flags: {},
    claims: [{
      id: "claim-alpha",
      estimate: {
        originalLines: [
          {
            id: "L1",
            operation: "TÔLERIE CAPOT",
            laborHours: 1.5,
            allocations: [{ phase: "body", laborHours: 1.5 }],
          },
        ],
      },
    }],
  };
  addCase(testCase);
  const single = generateSingle(testCase);
  const bodyStep = single.steps.find((s) => s.key === "body");
  assert.deepEqual(bodyStep.sourceClaimIds, ["claim-alpha"], "Step must have sourceClaimIds");

  applyProposal(testCase, single);
  const createdBooking = getBookings().find((b) => b.caseId === testCase.id && b.key === "body");
  assert.ok(createdBooking, "Booking created");
  assert.deepEqual(createdBooking.sourceClaimIds, ["claim-alpha"], "Booking must have sourceClaimIds");

  // Normalize state roundtrip
  run("state = normalizeState(state);");
  const restoredBooking = getBookings().find((b) => b.caseId === testCase.id && b.key === "body");
  assert.ok(restoredBooking, "Booking restored after normalizeState");
  assert.deepEqual(restoredBooking.sourceClaimIds, ["claim-alpha"], "sourceClaimIds must survive normalizeState roundtrip");
}

// Test 11: Duplicate raw sourceLineIds across claims remain isolated
{
  console.log("Test 11: Duplicate raw sourceLineIds across claims remain isolated");
  resetState();
  const testCase = {
    id: "case-dup-lines-11",
    flags: {},
    claims: [
      {
        id: "claim-A",
        estimate: {
          originalLines: [
            {
              id: "line-shared-1",
              operation: "REPARATION PORTE AV",
              laborHours: 1.0,
              allocations: [{ phase: "body", laborHours: 1.0 }],
            },
          ],
        },
      },
      {
        id: "claim-B",
        estimate: {
          originalLines: [
            {
              id: "line-shared-1",
              operation: "REPARATION PORTE AR",
              laborHours: 1.0,
              allocations: [{ phase: "body", laborHours: 1.0 }],
            },
          ],
        },
      },
    ],
  };
  addCase(testCase);
  const single = generateSingle(testCase);
  assert.equal(single.steps.length, 2, "Two distinct operations for the two claims");
  const stepA = single.steps.find((s) => s.title === "REPARATION PORTE AV");
  const stepB = single.steps.find((s) => s.title === "REPARATION PORTE AR");
  assert.ok(stepA && stepB, "Both steps must exist");
  assert.notEqual(stepA.taskId, stepB.taskId, "Task IDs must be distinct despite duplicate raw lineId");
  assert.deepEqual(stepA.sourceClaimIds, ["claim-A"], "Step A must have claim-A");
  assert.deepEqual(stepB.sourceClaimIds, ["claim-B"], "Step B must have claim-B");

  applyProposal(testCase, single);
  const bookingA = getBookings().find((b) => b.title === "REPARATION PORTE AV");
  const bookingB = getBookings().find((b) => b.title === "REPARATION PORTE AR");
  assert.deepEqual(bookingA.sourceClaimIds, ["claim-A"]);
  assert.deepEqual(bookingB.sourceClaimIds, ["claim-B"]);
}

// Test 12: Global paint remains one scheduled batch
{
  console.log("Test 12: Global paint remains one scheduled batch");
  resetState();
  const multiZoneCase = {
    id: "case-global-paint-12",
    claims: [{
      id: "claim-1",
      estimate: {
        originalLines: [
          {
            id: "L1",
            operation: "PEINTURE AILE AVD",
            laborHours: 1.0,
            paintGroup: "front",
            allocations: [{ phase: "paint", laborHours: 1.0 }],
          },
          {
            id: "L2",
            operation: "PEINTURE AILE ARD",
            laborHours: 1.0,
            paintGroup: "rear",
            allocations: [{ phase: "paint", laborHours: 1.0 }],
          },
        ],
      },
    }],
  };
  addCase(multiZoneCase);
  const proposal = schedule(multiZoneCase, []);
  const paintSteps = proposal.steps.filter((s) => s.key === "paint");
  assert.equal(paintSteps.length, 1, "Must schedule exactly ONE global paint batch");
  assert.ok(paintSteps[0].taskId.startsWith("task-batch-paint-global|case-global-paint-12"), "TaskId must be global paint batch");
}

// Test 13: Partial-prep global paint waits for all legitimate prerequisites
{
  console.log("Test 13: Partial-prep global paint waits for all legitimate prerequisites");
  resetState();
  const testCase = {
    id: "case-partial-prep-13",
    claims: [{
      id: "claim-1",
      estimate: {
        originalLines: [
          {
            id: "L1",
            operation: "PREPARATION FACE AVANT",
            laborHours: 1.0,
            paintGroup: "front",
            bodyZone: "front",
            allocations: [{ phase: "prep", laborHours: 1.0 }],
          },
          {
            id: "L2",
            operation: "TÔLERIE ARRIÈRE",
            laborHours: 2.0,
            paintGroup: "rear",
            bodyZone: "rear",
            allocations: [{ phase: "body", laborHours: 2.0 }],
          },
          {
            id: "L3",
            operation: "PEINTURE FACE AVANT",
            laborHours: 1.0,
            paintGroup: "front",
            bodyZone: "front",
            allocations: [{ phase: "paint", laborHours: 1.0 }],
          },
          {
            id: "L4",
            operation: "PEINTURE ARRIÈRE",
            laborHours: 1.0,
            paintGroup: "rear",
            bodyZone: "rear",
            allocations: [{ phase: "paint", laborHours: 1.0 }],
          },
        ],
      },
    }],
  };
  addCase(testCase);
  const proposal = schedule(testCase, []);
  const prepStep = proposal.steps.find((s) => s.key === "prep");
  const bodyStep = proposal.steps.find((s) => s.key === "body");
  const paintStep = proposal.steps.find((s) => s.key === "paint");
  assert.ok(prepStep && bodyStep && paintStep, "All three steps must exist");

  const paintStart = new Date(paintStep.start).getTime();
  const prepEnd = new Date(prepStep.end).getTime();
  const bodyEnd = new Date(bodyStep.end).getTime();
  assert.ok(paintStart >= prepEnd, "Paint start must be >= prep end");
  assert.ok(paintStart >= bodyEnd, "Paint start must be >= body end (missing prep fallback)");
}

// Test 14: Canonical productive minute total is conserved
{
  console.log("Test 14: Canonical productive minute total is conserved");
  resetState();
  const testCase = {
    id: "case-duration-14",
    claims: [{
      id: "claim-1",
      estimate: {
        originalLines: [
          {
            id: "L1",
            operation: "TÔLERIE AILE",
            laborHours: 1.25,
            allocations: [{ phase: "body", laborHours: 1.25 }],
          },
          {
            id: "L2",
            operation: "PEINTURE AILE",
            laborHours: 0.75,
            allocations: [{ phase: "paint", laborHours: 0.75 }],
          },
        ],
      },
    }],
  };
  addCase(testCase);
  const canonicalTasks = getTasks(testCase);
  const expectedTotalMinutes = canonicalTasks.reduce((sum, t) => sum + t.durationMinutes, 0);

  const proposal = schedule(testCase, []);
  const proposalProductiveMinutes = proposal.steps.reduce((sum, step) => {
    return sum + (step.segments || []).reduce((segSum, seg) => {
      return segSum + Math.round((new Date(seg.end) - new Date(seg.start)) / 60000);
    }, 0);
  }, 0);

  assert.equal(proposalProductiveMinutes, expectedTotalMinutes, "Planned productive minutes must exactly equal canonical durationMinutes");
}

// Test 15: Existing productive booking cannot be replaced
{
  console.log("Test 15: Existing productive booking cannot be replaced");
  resetState();
  const testCase = {
    id: "case-prod-15",
    flags: { workStarted: false },
    claims: [{
      id: "claim-1",
      estimate: {
        originalLines: [
          {
            id: "L1",
            operation: "TÔLERIE",
            laborHours: 1.0,
            allocations: [{ phase: "body", laborHours: 1.0 }],
          },
        ],
      },
    }],
  };
  addCase(testCase);
  // Add a productive booking (started)
  addBooking({
    id: "b-started-1",
    caseId: testCase.id,
    type: "work",
    title: "Tôlerie en cours",
    key: "body",
    status: "in_progress",
    actualStart: "2026-09-07T08:00:00.000Z",
    actualWorkedMinutes: 45,
    resourceIds: ["body-1"],
    segments: [{ start: "2026-09-07T08:00:00.000Z", end: "2026-09-07T08:45:00.000Z" }],
  });

  const single = generateSingle(testCase);
  assert.throws(
    () => applyProposal(testCase, single),
    /ProductivePlanningHistoryError|travail atelier a déjà commencé/i,
    "Must throw ProductivePlanningHistoryError when trying to replace started booking"
  );
}

// Test 16: Replaceable planned booking can be recalculated through canonical graph
{
  console.log("Test 16: Replaceable planned booking can be recalculated through canonical graph");
  resetState();
  const testCase = {
    id: "case-replan-16",
    flags: {},
    claims: [{
      id: "claim-1",
      estimate: {
        originalLines: [
          {
            id: "L1",
            operation: "REMPLACEMENT PARE-BRISE",
            laborHours: 2.0,
            allocations: [{ phase: "body", laborHours: 2.0 }],
          },
        ],
      },
    }],
  };
  addCase(testCase);
  // Existing planned booking (no productive work sessions or worked minutes)
  addBooking({
    id: "b-planned-old",
    caseId: testCase.id,
    type: "work",
    title: "Ancienne planification",
    key: "body",
    status: "planned",
    resourceIds: ["body-1"],
    segments: [{ start: "2026-09-07T08:00:00.000Z", end: "2026-09-07T10:00:00.000Z" }],
  });

  const single = generateSingle(testCase);
  const success = applyProposal(testCase, single);
  assert.equal(success, true, "Must successfully replace replaceable planned booking");
  const newBookings = getBookings().filter((b) => b.caseId === testCase.id);
  assert.equal(newBookings.length, 1, "Old booking replaced by new canonical booking");
  assert.equal(newBookings[0].title, "REMPLACEMENT PARE-BRISE", "New booking has canonical operation title");
}

// Test 17: Repeated canonical scheduling is deterministic
{
  console.log("Test 17: Repeated canonical scheduling is deterministic");
  resetState();
  const testCase = {
    id: "case-determ-17",
    claims: [{
      id: "claim-1",
      estimate: {
        originalLines: [
          { id: "L1", operation: "TÔLERIE PORTE", laborHours: 2.0, allocations: [{ phase: "body", laborHours: 2.0 }] },
          { id: "L2", operation: "PEINTURE PORTE", laborHours: 1.5, allocations: [{ phase: "paint", laborHours: 1.5 }] },
        ],
      },
    }],
  };
  addCase(testCase);

  const runs = [];
  for (let i = 0; i < 5; i++) {
    const p = schedule(testCase, []);
    runs.push({
      start: p.start,
      end: p.end,
      delivery: p.delivery,
      marginMinutes: p.marginMinutes,
      steps: p.steps.map((s) => ({
        taskId: s.taskId,
        title: s.title,
        start: s.start,
        end: s.end,
        resourceIds: s.resourceIds,
        dependencies: s.dependencies,
      })),
    });
  }

  for (let i = 1; i < 5; i++) {
    assert.deepEqual(runs[i], runs[0], "Run " + i + " must be identical to Run 0");
  }
}

// Test 18: Malformed canonical graph surfaces real error (no silent sequential fallback)
{
  console.log("Test 18: Malformed canonical graph surfaces real error (no silent sequential fallback)");
  resetState();
  const invalidCase = {
    id: "case-invalid-18",
    durations: { body: 1.0 },
    claims: [{
      id: "claim-1",
      estimate: {
        originalLines: [
          {
            id: "L1",
            operation: "OP SANS DUREE",
            laborHours: 5.0, // exceeds authoritative duration of 1.0 -> duration invariant error
            allocations: [{ phase: "body", laborHours: 5.0 }],
          },
        ],
      },
    }],
  };
  addCase(invalidCase);
  assert.throws(
    () => schedule(invalidCase, []),
    /Duration invariant violation/i,
    "Must surface real duration invariant violation error instead of falling back to sequential"
  );
}

// Test 19: Performance benchmark across 10, 30, 60, 100 source lines
{
  console.log("Test 19: Performance benchmark across 10, 30, 60, 100 source lines");
  const lineCounts = [10, 30, 60, 100];

  lineCounts.forEach((count) => {
    resetState();
    const originalLines = [];
    for (let i = 1; i <= count; i++) {
      const isPaint = i % 2 === 0;
      originalLines.push({
        id: "L-" + i,
        operation: "OPERATION " + (isPaint ? "PEINTURE" : "TOLERIE") + " ELEMENT " + i,
        laborHours: 0.5,
        allocations: [{ phase: isPaint ? "paint" : "body", laborHours: 0.5, bodyZone: "zone-" + (i % 4) }],
      });
    }

    const benchCase = {
      id: "case-bench-" + count,
      claims: [{
        id: "claim-bench",
        estimate: { originalLines },
      }],
    };
    addCase(benchCase);

    // Warm-up
    schedule(benchCase, []);

    // Benchmark DAG derivation
    const dagDurations = [];
    for (let iter = 0; iter < 10; iter++) {
      const t0 = performance.now();
      getTasks(benchCase);
      dagDurations.push(performance.now() - t0);
    }
    dagDurations.sort((a, b) => a - b);
    const medianDag = dagDurations[Math.floor(dagDurations.length / 2)];

    // Benchmark Full Planning Proposal Pipeline
    const planDurations = [];
    for (let iter = 0; iter < 10; iter++) {
      const t0 = performance.now();
      schedule(benchCase, []);
      planDurations.push(performance.now() - t0);
    }
    planDurations.sort((a, b) => a - b);
    const medianPlan = planDurations[Math.floor(planDurations.length / 2)];

    console.log("Benchmark " + count + " lines: median DAG = " + medianDag.toFixed(2) + "ms, median Planning Proposal = " + medianPlan.toFixed(2) + "ms");
    assert.ok(medianDag < 30, "DAG median (" + medianDag + "ms) should be < 30ms");
    assert.ok(medianPlan < 2500, "Planning proposal median (" + medianPlan + "ms) should be responsive");
  });
}

console.log("--- ALL WORKSHOP-001C TESTS PASSED SUCCESSFULLY ---");
