import assert from "node:assert/strict";
import fs from "node:fs";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const START = "2026-09-07T08:00:00.000Z";
const END = "2026-09-07T09:00:00.000Z";
const CALENDAR = {
  0: "",
  1: "08:00-12:00,13:00-17:00",
  2: "08:00-12:00,13:00-17:00",
  3: "08:00-12:00,13:00-17:00",
  4: "08:00-12:00,13:00-17:00",
  5: "08:00-12:00,13:00-17:00",
  6: "",
};

const { context, run } = createNimrVmContext({ filename: "planning-acceptance-safety-p1002.js" });

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeCase(id = "case-p1002", overrides = {}) {
  const flags = {
    expertApproved: true,
    clientApproved: true,
    received: false,
    workStarted: false,
    workCompleted: false,
    qualityApproved: false,
    delivered: false,
    ...(overrides.flags || {}),
  };
  return {
    id,
    clientName: `Client ${id}`,
    plate: `P1-${id}`,
    durations: { body: 1 },
    serverPlanningVersion: 4,
    flags,
    claims: [{
      id: `claim-${id}`,
      type: "client",
      status: "approved",
      includeInPlanning: true,
      expertApproved: true,
      clientApproved: true,
      estimate: { lines: [{ phase: "body", operation: "Réparation", laborHours: 1 }] },
    }],
    ...overrides,
    flags,
  };
}

function makeBooking(id, caseId, overrides = {}) {
  return {
    id,
    caseId,
    key: "body",
    taskId: "body",
    title: id,
    start: START,
    end: END,
    plannedStart: START,
    plannedEnd: END,
    resourceIds: ["body-1"],
    primaryResourceId: "body-1",
    equipmentResourceIds: [],
    segments: [{ start: START, end: END }],
    plannedSegments: [{ start: START, end: END }],
    plannedMinutes: 60,
    status: "planned",
    actualWorkedMinutes: 0,
    temporary: false,
    ...overrides,
  };
}

function reset(options = {}) {
  const item = makeCase(options.caseId || "case-p1002", options.caseOverrides || {});
  const users = [
    { id: "chief", name: "Chef", role: "chef_atelier", active: true },
    { id: "reception", name: "Réception", role: "reception", active: true },
    { id: "tech", name: "Tech", role: "technicien", active: true, resourceId: "body-1" },
    { id: "quality", name: "Qualité", role: "controle_qualite", active: true },
    { id: "readonly", name: "Lecture", role: "lecture_seule", active: true },
  ];
  const resources = [
    { id: "body-1", name: "Tôlier 1", role: "tolier", category: "body", active: true, dailyCapacityMinutes: 480 },
    { id: "body-2", name: "Tôlier 2", role: "tolier", category: "body", active: true, dailyCapacityMinutes: 480 },
  ];
  const bookings = options.bookings || [];
  const extraCases = options.extraCases || [];
  context.__seed = {
    settings: { calendar: CALENDAR, fastLaneEnabled: false },
    resources,
    users,
    currentUserId: options.userId || "chief",
    cases: [item, ...extraCases],
    bookings,
    holidays: [],
  };
  run(`
    state = normalizeState(__seed);
    generatedProposals = {};
    invalidateUiRuntimeIndexes();
    __notifications = [];
    __saveCalls = [];
    __deletedBookingMarkers = [];
    __dirtyBookingMarkers = [];
    __reserveCalls = [];
    __serverAcknowledged = false;
    __postAckGenerateCalls = 0;
    window.NIMR_PLANNING_RECONCILIATION_REQUIRED = null;
    notifyUser = (message, type = "info") => { __notifications.push({ message: String(message), type }); };
    saveState = (options = {}) => { __saveCalls.push(options); return Promise.resolve(true); };
    markEntityBookingDeleted = (id) => { __deletedBookingMarkers.push(String(id)); };
    markEntityBookingDirty = (booking) => { __dirtyBookingMarkers.push(booking?.id || ""); };
    render = () => {};
    renderCaseDetail = () => {};
    setActiveTab = () => {};
    reservePlanningProposalAtomically = async (caseItem, proposal) => {
      __reserveCalls.push({ caseId: caseItem.id, proposal: JSON.parse(JSON.stringify(proposal)) });
      __serverAcknowledged = true;
      return { ok: true, acknowledged: true, planningVersion: Number(proposal.acceptance?.baseServerPlanningVersion || 0) + 1 };
    };
  `);
  return run(`state.cases.find((candidate) => candidate.id === ${JSON.stringify(item.id)})`);
}

// vm.runInContext does not support an injected globals argument; keep proposal
// assignment explicit and centralized.
function rememberDisplayed(item, proposal) {
  context.__proposal = proposal;
  run(`generatedProposals[${JSON.stringify(item.id)}] = { proposal: __proposal, availableDates: [] };`);
  return proposal;
}

function displayed(item) {
  return rememberDisplayed(item, context.generateSingleProposal(item, new Date(START)));
}

function caseBookings(caseId) {
  return plain(run(`state.bookings.filter((booking) => booking.caseId === ${JSON.stringify(caseId)})`));
}

function allBookings() {
  return plain(run("state.bookings"));
}

function caseState(caseId) {
  return plain(run(`state.cases.find((item) => item.id === ${JSON.stringify(caseId)})`));
}

async function accept(item, proposal) {
  return context.acceptProposalAtomically(item, proposal);
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("A authorized initial appointment acceptance succeeds", async () => {
  const item = reset();
  const proposal = displayed(item);
  assert.equal(await accept(item, proposal), true);
  assert.ok(caseBookings(item.id).length > 0);
  assert.equal(run("__saveCalls.length"), 1);
});

test("A-role canonical appointment.schedule permits reception and denies operational/read-only roles", async () => {
  const item = reset({ userId: "reception" });
  assert.equal(run(`hasPermission("appointment.schedule")`), true);
  assert.equal(await accept(item, displayed(item)), true, "la réception canonique doit franchir la frontière locale");
  const directItem = reset({ userId: "reception" });
  assert.equal(context.acceptProposal(directItem, displayed(directItem)), true, "la réception doit aussi franchir la mutation locale de niveau inférieur");
  for (const userId of ["tech", "quality", "readonly"]) {
    reset({ userId });
    assert.equal(run(`hasPermission("appointment.schedule")`), false, `${userId} ne doit pas recevoir appointment.schedule`);
  }
});

test("B unauthorized direct calls are rejected at both mutation boundaries", async () => {
  const item = reset({ userId: "tech" });
  const proposal = displayed(item);
  assert.equal(await accept(item, proposal), false);
  assert.equal(context.acceptProposal(item, proposal), false);
  assert.equal(caseBookings(item.id).length, 0);
  assert.match(run("__notifications.at(-1)?.message || ''"), /non autoris|permission/i);
});

test("C readonly role is rejected", async () => {
  const item = reset({ userId: "readonly" });
  assert.equal(await accept(item, displayed(item)), false);
  assert.equal(caseBookings(item.id).length, 0);
});

test("D archived case remains rejected", async () => {
  const item = reset({ caseOverrides: { archivedAt: "2026-09-01T00:00:00.000Z" } });
  const proposal = context.generateSingleProposal(item, new Date(START));
  assert.equal(await accept(item, proposal), false);
  assert.equal(caseBookings(item.id).length, 0);
});

test("BG1 planned-only same-case reschedule succeeds", async () => {
  const old = makeBooking("old-planned", "case-p1002", { start: "2026-09-08T08:00:00.000Z", end: "2026-09-08T09:00:00.000Z", segments: [{ start: "2026-09-08T08:00:00.000Z", end: "2026-09-08T09:00:00.000Z" }] });
  const item = reset({ bookings: [old] });
  const proposal = displayed(item);
  assert.equal(await accept(item, proposal), true);
  assert.equal(caseBookings(item.id).some((booking) => booking.id === old.id), false);
  assert.ok(caseBookings(item.id).length > 0);
});

for (const [label, status] of [["BG2 started", "started"], ["BG3 paused", "paused"], ["BG4 completed", "completed"]]) {
  test(`${label} booking prevents normal acceptance`, async () => {
    const protectedBooking = makeBooking(`productive-${status}`, "case-p1002", { status });
    const item = reset({ bookings: [protectedBooking] });
    const before = JSON.stringify(allBookings());
    assert.equal(await accept(item, displayed(item)), false);
    assert.equal(JSON.stringify(allBookings()), before);
  });
}

test("BG5 actualWorkedMinutes protects even malformed planning status", async () => {
  const productive = makeBooking("worked", "case-p1002", { status: "mystery", actualWorkedMinutes: 7 });
  const item = reset({ bookings: [productive] });
  assert.equal(await accept(item, displayed(item)), false);
  assert.equal(caseBookings(item.id)[0].actualWorkedMinutes, 7);
});

test("BG6 normalized non-planned operational state fails closed before reservation", async () => {
  const protectedBooking = makeBooking("blocked-operational", "case-p1002", {
    status: "blocked",
    blockedAt: "2026-09-07T08:15:00.000Z",
    blockReason: "Pièce indisponible",
  });
  const unrelated = makeBooking("other-case-row", "case-other", { status: "planned" });
  const otherCase = makeCase("case-other");
  const item = reset({ bookings: [protectedBooking, unrelated], extraCases: [otherCase] });
  assert.equal(caseBookings(item.id)[0].status, "blocked", "normalizeBooking doit conserver le statut opérationnel blocked");
  const before = JSON.stringify(allBookings());
  assert.equal(await accept(item, displayed(item)), false);
  assert.equal(JSON.stringify(allBookings()), before);
  assert.deepEqual(plain(run("__deletedBookingMarkers")), []);
  assert.deepEqual(plain(run("__dirtyBookingMarkers")), []);
  assert.equal(run("__saveCalls.length"), 0);
  assert.equal(run("__reserveCalls.length"), 0);
});

test("BG7 planned status with technician blocking metadata is operational and protected", async () => {
  const blockedPlanned = makeBooking("blocked-planned", "case-p1002", {
    status: "planned",
    blockedAt: "2026-09-07T08:20:00.000Z",
    blockedBy: "tech",
    blockReason: "Attente pièces",
  });
  const item = reset({ bookings: [blockedPlanned] });
  assert.equal(caseBookings(item.id)[0].status, "planned");
  assert.equal(run(`isBookingTaskBlocked(state.bookings[0])`), true, "les métadonnées de blocage représentent un état technicien opérationnel");
  const before = JSON.stringify(allBookings());
  assert.equal(await accept(item, displayed(item)), false);
  assert.equal(JSON.stringify(allBookings()), before);
  assert.deepEqual(plain(run("__deletedBookingMarkers")), []);
  assert.deepEqual(plain(run("__dirtyBookingMarkers")), []);
  assert.equal(run("__saveCalls.length"), 0);
  assert.equal(run("__reserveCalls.length"), 0);
});

test("J workflow productive/completed flags prevent destructive acceptance", async () => {
  for (const flag of ["workStarted", "workCompleted", "qualityApproved", "delivered"]) {
    const item = reset({ caseOverrides: { flags: { [flag]: true } } });
    const before = JSON.stringify(caseState(item.id).flags);
    assert.equal(await accept(item, displayed(item)), false, flag);
    assert.equal(JSON.stringify(caseState(item.id).flags), before, flag);
  }
});

test("K received alone allows planned-only rescheduling", async () => {
  const item = reset({ caseOverrides: { flags: { received: true } }, bookings: [makeBooking("received-plan", "case-p1002")] });
  assert.equal(await accept(item, displayed(item)), true);
  assert.equal(caseState(item.id).flags.received, true);
});

test("L rejected productive booking is field-equivalent", async () => {
  const productive = makeBooking("byte-equivalent", "case-p1002", { status: "paused", actualWorkedMinutes: 19, pausedAt: START, remainingMinutes: 41 });
  const item = reset({ bookings: [productive] });
  const before = JSON.stringify(caseBookings(item.id)[0]);
  assert.equal(await accept(item, displayed(item)), false);
  assert.equal(JSON.stringify(caseBookings(item.id)[0]), before);
});

test("M unrelated-case bookings remain unchanged", async () => {
  const unrelatedCase = makeCase("other-case");
  const unrelated = makeBooking("other-booking", unrelatedCase.id, { resourceIds: ["body-2"], primaryResourceId: "body-2" });
  const item = reset({ bookings: [makeBooking("replace-me", "case-p1002"), unrelated], extraCases: [unrelatedCase] });
  const before = JSON.stringify(allBookings().find((booking) => booking.id === unrelated.id));
  assert.equal(await accept(item, displayed(item)), true);
  assert.equal(JSON.stringify(allBookings().find((booking) => booking.id === unrelated.id)), before);
});

test("N appointment acceptance never resets workflow flags", async () => {
  const item = reset({ caseOverrides: { flags: { received: true } } });
  const before = plain(caseState(item.id).flags);
  assert.equal(await accept(item, displayed(item)), true);
  assert.deepEqual(caseState(item.id).flags, before);
});

test("O resource-changing recalculation rejects displayed proposal as stale", async () => {
  const otherCase = makeCase("resource-blocker");
  const item = reset({ extraCases: [otherCase] });
  const proposal = displayed(item);
  const first = proposal.steps[0];
  context.__blocker = makeBooking("resource-blocker-booking", otherCase.id, {
    start: first.start,
    end: first.end,
    segments: plain(first.segments),
    resourceIds: plain(first.resourceIds),
    primaryResourceId: first.primaryResourceId,
  });
  run("state.bookings = [...state.bookings, __blocker]; invalidateUiRuntimeIndexes();");
  assert.equal(await accept(item, proposal), false);
  assert.equal(caseBookings(item.id).length, 0);
  assert.match(run("__notifications.at(-1)?.message || ''"), /chang|obsol|recalcul/i);
});

test("P same-case planning base change rejects displayed proposal", async () => {
  const item = reset({ bookings: [makeBooking("base-plan", "case-p1002")] });
  const proposal = displayed(item);
  context.__newBase = makeBooking("new-base-plan", item.id, { start: "2026-09-09T08:00:00.000Z", end: "2026-09-09T09:00:00.000Z", segments: [{ start: "2026-09-09T08:00:00.000Z", end: "2026-09-09T09:00:00.000Z" }] });
  run("state.bookings = [...state.bookings, __newBase]; invalidateUiRuntimeIndexes();");
  assert.equal(await accept(item, proposal), false);
  assert.equal(run("__reserveCalls.length"), 0);
});

test("Q proposal server base version is never silently upgraded", async () => {
  const item = reset();
  const proposal = displayed(item);
  assert.equal(proposal.acceptance.baseServerPlanningVersion, 4);
  run("state.cases[0].serverPlanningVersion = 5; state.cases[0].serverVersion = 5;");
  assert.equal(await accept(item, proposal), false);
  assert.equal(run("__reserveCalls.length"), 0);
});

for (const [label, errorName] of [["R server version conflict", "PlanningConflictError"], ["S server rejection", "SupabaseAtomicBookingError"]]) {
  test(`${label} causes zero local booking mutation`, async () => {
    const existing = makeBooking(`existing-${errorName}`, "case-p1002");
    const item = reset({ bookings: [existing] });
    const proposal = displayed(item);
    run(`reservePlanningProposalAtomically = async () => { const error = new Error("server rejected"); error.name = ${JSON.stringify(errorName)}; throw error; };`);
    const before = JSON.stringify(allBookings());
    assert.equal(await accept(item, proposal), false);
    assert.equal(JSON.stringify(allBookings()), before);
    assert.equal(run("__saveCalls.length"), 0);
  });
}

test("T successful ACK applies the exact submitted recalculated plan", async () => {
  const item = reset();
  const proposal = displayed(item);
  assert.equal(await accept(item, proposal), true);
  const submitted = plain(run("__reserveCalls[0].proposal"));
  const accepted = caseBookings(item.id);
  assert.equal(accepted.length, submitted.steps.length);
  accepted.forEach((booking, index) => {
    const step = submitted.steps[index];
    assert.deepEqual({
      taskId: booking.taskId,
      key: booking.key,
      start: booking.start,
      end: booking.end,
      segments: booking.segments,
      resourceIds: booking.resourceIds,
      primaryResourceId: booking.primaryResourceId,
      equipmentResourceIds: booking.equipmentResourceIds,
      serviceMode: booking.serviceMode,
      subcontractId: booking.subcontractId,
    }, {
      taskId: step.taskId || step.key || "",
      key: step.key,
      start: step.start,
      end: step.end,
      segments: plain(step.segments),
      resourceIds: plain(step.resourceIds),
      primaryResourceId: step.primaryResourceId || step.resourceIds?.[0] || null,
      equipmentResourceIds: plain(step.equipmentResourceIds || step.resourceIds?.slice(1) || []),
      serviceMode: step.serviceMode || "internal",
      subcontractId: step.subcontractId || "",
    });
  });

  const raceItem = reset({ bookings: [makeBooking("became-productive", "case-p1002")] });
  const raceProposal = displayed(raceItem);
  run(`
    reservePlanningProposalAtomically = async () => {
      state.bookings[0].status = "started";
      __serverAcknowledged = true;
      return { ok: true, acknowledged: true, planningVersion: 5 };
    };
  `);
  assert.equal(await accept(raceItem, raceProposal), false, "l'application locale doit recontrôler l'historique après l'ACK");
  assert.equal(caseBookings(raceItem.id)[0].id, "became-productive");
  assert.equal(caseBookings(raceItem.id)[0].status, "started");
  assert.deepEqual(plain(run("__deletedBookingMarkers")), []);
  assert.ok(run("Boolean(window.NIMR_PLANNING_RECONCILIATION_REQUIRED)"));
});

test("U acceptance recalculates exactly once", async () => {
  const item = reset();
  const proposal = displayed(item);
  run(`
    __recalculateCount = 0;
    __originalRecalculate = recalculateProposalForAcceptance;
    recalculateProposalForAcceptance = (...args) => { __recalculateCount += 1; return __originalRecalculate(...args); };
  `);
  assert.equal(await accept(item, proposal), true);
  assert.equal(run("__recalculateCount"), 1);
});

test("V no proposal generation or recalculation occurs after server ACK", async () => {
  const item = reset();
  const proposal = displayed(item);
  run(`
    __originalGenerate = generateSingleProposal;
    generateSingleProposal = (...args) => {
      if (__serverAcknowledged) __postAckGenerateCalls += 1;
      return __originalGenerate(...args);
    };
  `);
  assert.equal(await accept(item, proposal), true);
  assert.equal(run("__postAckGenerateCalls"), 0);
});

test("W double click does not duplicate bookings or reserve twice", async () => {
  const item = reset();
  const proposal = displayed(item);
  run(`
    __reservationResolvers = [];
    reservePlanningProposalAtomically = async (caseItem, acceptedProposal) => {
      __reserveCalls.push({ caseId: caseItem.id, proposal: JSON.parse(JSON.stringify(acceptedProposal)) });
      await new Promise((resolve) => { __reservationResolvers.push(resolve); });
      __serverAcknowledged = true;
      return { ok: true, acknowledged: true, planningVersion: 5 };
    };
  `);
  const first = accept(item, proposal);
  const second = accept(item, proposal);
  await new Promise((resolve) => setTimeout(resolve, 0));
  run("__reservationResolvers.forEach((resolve) => resolve())");
  assert.equal(await first, true);
  assert.equal(await second, false);
  assert.equal(run("__reserveCalls.length"), 1);
  assert.equal(caseBookings(item.id).length, proposal.steps.length);
  const afterFirstAcceptance = JSON.stringify(allBookings());
  assert.equal(await accept(item, proposal), false, "un clic répété après succès doit être rejeté comme obsolète");
  assert.equal(run("__reserveCalls.length"), 1);
  assert.equal(JSON.stringify(allBookings()), afterFirstAcceptance);
});

test("X configured Supabase offline rejection leaves local planning untouched", async () => {
  const existing = makeBooking("offline-existing", "case-p1002");
  const item = reset({ bookings: [existing] });
  const proposal = displayed(item);
  run(`reservePlanningProposalAtomically = async () => { throw new Error("Réservation serveur impossible hors ligne. La proposition reste non validée."); };`);
  const before = JSON.stringify(allBookings());
  assert.equal(await accept(item, proposal), false);
  assert.equal(JSON.stringify(allBookings()), before);
});

test("Y local mode retains acceptance with productive safeguards", async () => {
  const item = reset();
  const proposal = displayed(item);
  run(`reservePlanningProposalAtomically = async () => ({ skipped: true, reason: "supabase-not-configured" });`);
  assert.equal(await accept(item, proposal), true);
  const protectedBooking = makeBooking("local-started", item.id, { status: "started" });
  reset({ bookings: [protectedBooking] });
  const current = run("state.cases[0]");
  assert.equal(await accept(current, displayed(current)), false);
  assert.equal(caseBookings(current.id)[0].id, protectedBooking.id);
});

test("Z saveState/outbox receives only final accepted mutation", async () => {
  const item = reset();
  const proposal = displayed(item);
  assert.equal(run("__saveCalls.length"), 0);
  assert.equal(await accept(item, proposal), true);
  assert.equal(run("__saveCalls.length"), 1);
  assert.equal(run("__saveCalls[0].cloudReason"), "appointment-accepted");
});

test("AA only authorized planned replacement emits deletion/upsert markers", async () => {
  const item = reset({ bookings: [makeBooking("planned-delete", "case-p1002")] });
  assert.equal(await accept(item, displayed(item)), true);
  assert.deepEqual(plain(run("__deletedBookingMarkers")), ["planned-delete"]);
  assert.equal(run("__dirtyBookingMarkers.length"), caseBookings(item.id).length);
});

test("AB productive rejection never emits booking deletion markers", async () => {
  const item = reset({ bookings: [makeBooking("never-delete", "case-p1002", { status: "completed" })] });
  assert.equal(await accept(item, displayed(item)), false);
  assert.deepEqual(plain(run("__deletedBookingMarkers")), []);
  assert.deepEqual(plain(run("__dirtyBookingMarkers")), []);
});

test("LR2-client superseded replay produces zero local planning mutation", async () => {
  const existing = makeBooking("u2-current-plan", "case-p1002");
  const unrelatedCase = makeCase("case-unrelated-lr2");
  const unrelated = makeBooking("unrelated-lr2", unrelatedCase.id);
  const item = reset({
    bookings: [existing, unrelated],
    extraCases: [unrelatedCase],
    caseOverrides: { serverPlanningVersion: 5 },
  });
  const proposal = displayed(item);
  const before = JSON.stringify(allBookings());
  run(`
    reservePlanningProposalAtomically = async (caseItem) => {
      __reserveCalls.push({ caseId: caseItem.id });
      caseItem.serverPlanningVersion = Math.max(Number(caseItem.serverPlanningVersion || 0), 6);
      const error = new Error("Historique V5, autorité courante V6.");
      error.name = "PlanningConflictError";
      error.code = "idempotent_replay_superseded";
      error.idempotentReplay = true;
      error.superseded = true;
      error.historicalAcknowledged = true;
      error.acceptedPlanningVersion = 5;
      error.planningVersion = 6;
      error.requiresPlanningReconciliation = true;
      throw error;
    };
  `);
  assert.equal(await accept(item, proposal), false);
  assert.equal(JSON.stringify(allBookings()), before);
  assert.deepEqual(plain(run("__deletedBookingMarkers")), []);
  assert.deepEqual(plain(run("__dirtyBookingMarkers")), []);
  assert.equal(run("__saveCalls.length"), 0);
  assert.equal(run("__reserveCalls.length"), 1);
  assert.equal(caseState(item.id).serverPlanningVersion, 6);
  assert.equal(run("window.NIMR_PLANNING_RECONCILIATION_REQUIRED?.historicalAcknowledged"), true);
});

test("LR3-client productive late replay cannot authorize local replacement", async () => {
  const item = reset({
    bookings: [makeBooking("became-productive-after-u1", "case-p1002")],
    caseOverrides: { serverPlanningVersion: 5 },
  });
  const proposal = displayed(item);
  run(`
    reservePlanningProposalAtomically = async () => {
      __reserveCalls.push({ caseId: state.cases[0].id });
      state.bookings[0].status = "started";
      state.bookings[0].actualStartedAt = ${JSON.stringify(START)};
      const error = new Error("Le travail productif a commencé après l'acquittement historique.");
      error.name = "PlanningConflictError";
      error.code = "idempotent_replay_productive_history";
      error.idempotentReplay = true;
      error.superseded = true;
      error.historicalAcknowledged = true;
      error.acceptedPlanningVersion = 5;
      error.planningVersion = 5;
      error.requiresPlanningReconciliation = true;
      throw error;
    };
  `);
  assert.equal(await accept(item, proposal), false);
  assert.equal(caseBookings(item.id)[0].id, "became-productive-after-u1");
  assert.equal(caseBookings(item.id)[0].status, "started");
  assert.deepEqual(plain(run("__deletedBookingMarkers")), []);
  assert.deepEqual(plain(run("__dirtyBookingMarkers")), []);
  assert.equal(run("__saveCalls.length"), 0);
  assert.equal(caseState(item.id).serverPlanningVersion, 5);
  assert.ok(run("Boolean(window.NIMR_PLANNING_RECONCILIATION_REQUIRED)"));
});

const migrationUrl = new URL("../supabase_p1_002_planning_acceptance_safety.sql", import.meta.url);
const migrationSql = fs.readFileSync(migrationUrl, "utf8");
const compactMigrationSql = migrationSql.replace(/--.*$/gmu, " ").replace(/\s+/gu, " ");
const syncSource = fs.readFileSync(new URL("../js/supabase-sync.js", import.meta.url), "utf8");
const lowerPlanningSql = fs.readFileSync(new URL("../supabase_v23_3_0_planning_dependencies.sql", import.meta.url), "utf8");
const productionFrontendSource = fs.readdirSync(new URL("../js/", import.meta.url))
  .filter((name) => name.endsWith(".js"))
  .map((name) => fs.readFileSync(new URL(`../js/${name}`, import.meta.url), "utf8"))
  .join("\n");

function roleSetFromFunctionSource(source, functionName) {
  const start = source.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${functionName}\\s*\\(`, "iu"));
  assert.ok(start >= 0, `${functionName} absent`);
  const functionTail = source.slice(start);
  const roleGuard = functionTail.match(/nimr_has_workshop_role\s*\(\s*p_workshop_id\s*,\s*array\[([\s\S]*?)\]\s*\)/iu);
  assert.ok(roleGuard, `garde de rôles ${functionName} absente`);
  return [...roleGuard[1].matchAll(/'([^']+)'/gu)].map((match) => match[1]);
}

test("AC server RPC fails closed on productive history", () => {
  assert.match(migrationSql, /productive_history_conflict/iu);
  assert.match(migrationSql, /public\.planning_slots[\s\S]*?actual_worked_minutes[\s\S]*?actual_start_at[\s\S]*?actual_end_at/iu);
  assert.match(migrationSql, /lower\(coalesce\(planning_slot\.status, ''\)\)[\s\S]*?'started'[\s\S]*?'paused'[\s\S]*?'completed'/iu);
  assert.match(migrationSql, /public\.repair_steps[\s\S]*?actual_hours[\s\S]*?started_at[\s\S]*?completed_at/iu);
  assert.match(migrationSql, /public\.sync_entities[\s\S]*?entity_type = 'booking'[\s\S]*?payload ->> 'caseId' = sync_case_entity_id[\s\S]*?actualWorkedMinutes/iu);
  assert.match(migrationSql, /booking_entity\.payload ->> 'operationalStatus'[\s\S]*?\)\) <> 'planned'/iu);
  assert.match(migrationSql, /booking_entity\.payload ->> 'blockedAt'[\s\S]*?booking_entity\.payload ->> 'blockReason'/iu);
  assert.match(migrationSql, /sync_case_payload #>> '\{flags,workStarted\}'[\s\S]*?sync_case_payload #>> '\{flags,delivered\}'/iu);
  assert.match(migrationSql, /sync_case_missing_after_lock[\s\S]*?'case_state_conflict'/iu);
  assert.match(migrationSql, /repair_order_row\.status[\s\S]*?'in_progress'[\s\S]*?'work_completed'[\s\S]*?'quality_approved'[\s\S]*?'delivered'/iu);
  assert.doesNotMatch(migrationSql, /repair_order_row\.status[\s\S]{0,160}'received'/iu);
});

test("AD server planned-only replacement is rollback-safe", () => {
  const guardIndex = compactMigrationSql.indexOf("productive_history_conflict");
  const allocationDeleteIndex = compactMigrationSql.indexOf("update public.planning_slot_allocations");
  const slotDeleteIndex = compactMigrationSql.indexOf("update public.planning_slots");
  assert.ok(guardIndex >= 0 && allocationDeleteIndex > guardIndex && slotDeleteIndex > guardIndex);
  assert.match(migrationSql, /local_id = planning_slot\.local_id \|\| ':replaced:' \|\| operation_id_value::text/iu);
  assert.match(migrationSql, /P1_002_RESERVATION_ROLLBACK/iu);
  assert.match(migrationSql, /nimr_reserve_planning_slots\s*\(/iu);
});

test("AE server workshop isolation and grants remain narrow", () => {
  assert.match(migrationSql, /^begin;/mu);
  assert.match(migrationSql, /^commit;/mu);
  assert.match(migrationSql, /security definer[\s\S]*?set search_path = pg_catalog, public/iu);
  assert.match(migrationSql, /auth\.uid\(\) is null/iu);
  assert.match(migrationSql, /nimr_has_workshop_role\s*\([\s\S]*?p_workshop_id/iu);
  const roleGuard = migrationSql.match(/nimr_has_workshop_role\s*\(\s*p_workshop_id\s*,\s*array\[([\s\S]*?)\]\s*\)/iu);
  assert.ok(roleGuard, "le contrat de rôles du RPC planning doit être explicite");
  const serverRoles = [...roleGuard[1].matchAll(/'([^']+)'/gu)].map((match) => match[1]);
  assert.deepEqual(serverRoles, ["admin_technique", "directeur", "chef_atelier", "reception"]);
  assert.match(migrationSql, /where candidate\.workshop_id = p_workshop_id[\s\S]*?for update/iu);
  assert.match(migrationSql, /pg_advisory_xact_lock\(hashtextextended\([\s\S]*?p_workshop_id::text \|\| ':case:' \|\| sync_case_entity_id/iu);
  assert.match(migrationSql, /booking_entity\.workshop_id = p_workshop_id/iu);
  assert.match(migrationSql, /planning_slot\.workshop_id = p_workshop_id[\s\S]*?planning_slot\.repair_order_id = repair_order_row\.id/iu);
  assert.match(migrationSql, /revoke all on function public\.nimr_reserve_planning_atomic\(uuid, text, bigint, text, jsonb\)[^;]+from public, anon, authenticated/isu);
  assert.match(migrationSql, /grant execute on function public\.nimr_reserve_planning_atomic\(uuid, text, bigint, text, jsonb\)[^;]+to authenticated/isu);
  assert.doesNotMatch(migrationSql, /grant[^;]+to anon/iu);
  assert.doesNotMatch(migrationSql, /service_role/iu);
});

test("D1 nested lower authorization is aligned with canonical appointment.schedule", () => {
  const canonicalRoles = ["admin_technique", "directeur", "chef_atelier", "reception"];
  assert.deepEqual(
    roleSetFromFunctionSource(lowerPlanningSql, "nimr_reserve_planning_slots"),
    ["admin_technique", "directeur", "chef_atelier"],
    "le lower historique reproduit bien l'échec Reception pré-correction",
  );
  assert.deepEqual(roleSetFromFunctionSource(migrationSql, "nimr_reserve_planning_atomic"), canonicalRoles);
  const legacyGuard = migrationSql.match(/lower_legacy_role_guard[^:]*:=\s*'([^;]+)'/iu)?.[1] || "";
  const canonicalGuard = migrationSql.match(/lower_canonical_role_guard[^:]*:=\s*'([^;]+)'/iu)?.[1] || "";
  assert.deepEqual([...legacyGuard.matchAll(/''([^']+)''/gu)].map((match) => match[1]), canonicalRoles.slice(0, 3));
  assert.deepEqual([...canonicalGuard.matchAll(/''([^']+)''/gu)].map((match) => match[1]), canonicalRoles);
  assert.match(migrationSql, /(?:pg_catalog\.)?replace\(\s*lower_function_definition,\s*lower_legacy_role_guard,\s*lower_canonical_role_guard\s*\)/iu);
});

test("D2 lower RPC final privilege boundary is internal-only", () => {
  const signature = "public.nimr_reserve_planning_slots(uuid, uuid, text, jsonb)";
  const lowerStatements = [...migrationSql.matchAll(/(?:revoke|grant)[\s\S]*?public\.nimr_reserve_planning_slots\s*\(\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*jsonb\s*\)[\s\S]*?;/giu)];
  assert.ok(lowerStatements.length > 0, "aucun contrat de privilège final pour le lower RPC");
  const lastStatement = lowerStatements.at(-1)[0];
  assert.match(lastStatement, /revoke\s+all[\s\S]*?from\s+public\s*,\s*anon\s*,\s*authenticated\s*;/iu, signature);
  assert.doesNotMatch(lastStatement, /grant\s+execute/iu);
  const lastRevokeEnd = lowerStatements.at(-1).index + lastStatement.length;
  assert.doesNotMatch(
    migrationSql.slice(lastRevokeEnd),
    /grant\s+execute\s+on\s+function\s+public\.nimr_reserve_planning_slots\s*\([^;]+to\s+(?:public|anon|authenticated)\s*;/iu,
    "aucun GRANT navigateur ne doit suivre le REVOKE final",
  );
  assert.match(
    migrationSql,
    /grant\s+execute\s+on\s+function\s+public\.nimr_reserve_planning_atomic\(uuid, text, bigint, text, jsonb\)[^;]+to authenticated;/isu,
  );
  assert.doesNotMatch(productionFrontendSource, /\.rpc\(\s*["']nimr_reserve_planning_slots["']/u);
});

test("D3 lower reservation implementation and nested execution retain parity", () => {
  assert.match(migrationSql, /pg_get_functiondef\s*\(\s*'public\.nimr_reserve_planning_slots\(uuid, uuid, text, jsonb\)'::regprocedure\s*\)/iu);
  assert.match(migrationSql, /lower_function_definition_role_replacements\s*<>\s*1/iu);
  assert.match(migrationSql, /execute\s+lower_function_definition/iu);
  assert.match(migrationSql, /lower_function_owner[\s\S]*?outer_function_owner[\s\S]*?<>/iu);
  for (const contract of [
    /security definer/iu,
    /set search_path to 'pg_catalog', 'public'/iu,
    /payload_hash_value/iu,
    /pg_advisory_xact_lock/iu,
    /expected_version_value/iu,
    /dependencies_value/iu,
    /resource_capacity/iu,
    /vehicle_double_booking/iu,
    /planning_slot_allocations/iu,
    /sync_conflicts/iu,
    /reserved_slots/iu,
  ]) assert.match(lowerPlanningSql, contract);
});

test("AF server planning CAS and idempotency remain intact", () => {
  assert.match(migrationSql, /current_planning_version is distinct from coalesce\(p_expected_version, 0\)/iu);
  assert.match(migrationSql, /idempotentReplay/iu);
  assert.ok(compactMigrationSql.indexOf("idempotentReplay") < compactMigrationSql.indexOf("current_planning_version is distinct"));
  assert.match(migrationSql, /planning_version = planning_version \+ 1/iu);
  assert.match(syncSource, /planning_version:\s*Math\.max\(0, Number\([\s\S]*?item\.serverPlanningVersion[\s\S]*?item\.localRevision/iu);
  assert.match(migrationSql, /p1-002-planning-acceptance-safety/iu);
});

test("LR1 immediate lost-ACK replay remains applicable only while current and safe", () => {
  assert.match(migrationSql, /acceptedPlanningVersion/iu);
  assert.match(migrationSql, /idempotentReplay[\s\S]*?superseded/iu);
  assert.match(migrationSql, /current_planning_version\s*=\s*accepted_planning_version/iu);
  assert.match(migrationSql, /current_slots_match_accepted_plan/iu);
  assert.ok(compactMigrationSql.indexOf("current_slots_match_accepted_plan") < compactMigrationSql.indexOf("rpc_result := public.nimr_reserve_planning_slots"));
});

test("LR2 late U1 replay after U2 is explicitly superseded", () => {
  assert.match(migrationSql, /idempotent_replay_superseded/iu);
  assert.match(migrationSql, /'acceptedPlanningVersion', accepted_planning_version[\s\S]*?'planningVersion', current_planning_version[\s\S]*?'superseded', true/iu);
  assert.match(syncSource, /acceptedPlanningVersion/iu);
  assert.match(syncSource, /superseded/iu);
});

test("LR3 productive state after historical acceptance makes replay non-applicable", () => {
  assert.match(migrationSql, /productive_history_exists/iu);
  assert.match(migrationSql, /idempotent_replay_productive_history/iu);
  assert.match(migrationSql, /productive_history_exists\s+is\s+false/iu);
});

test("LR4 planning version and projection remain monotonic", () => {
  assert.match(syncSource, /rememberMonotonicPlanningVersion/iu);
  assert.match(syncSource, /acceptedPlanningVersion[\s\S]*?planningVersion/iu);
  assert.match(syncSource, /item\.serverPlanningVersion[\s\S]*?Math\.max/iu);
  assert.match(syncSource, /planning_version:\s*Math\.max\(0, Number\([\s\S]*?item\.serverPlanningVersion/iu);
});

test("LR5 idempotency payload collisions remain conflicts and evidence is preserved", () => {
  assert.match(migrationSql, /existing_operation\.payload_hash is distinct from payload_hash_value/iu);
  assert.match(migrationSql, /idempotency_payload_mismatch/iu);
  assert.doesNotMatch(migrationSql, /delete\s+from\s+public\.sync_operations/iu);
});

test("LR-lower historical authenticated grant required slot identity and is now revoked", () => {
  assert.match(lowerPlanningSql, /grant execute on function public\.nimr_reserve_planning_slots\([\s\S]*?\) to authenticated/iu);
  assert.doesNotMatch(lowerPlanningSql, /planning_version/iu);
  assert.match(migrationSql, /current_slots_match_accepted_plan/iu);
  assert.match(migrationSql, /revoke all on function public\.nimr_reserve_planning_slots\(uuid, uuid, text, jsonb\)[\s\S]*?from public, anon, authenticated/iu);
});

const failures = [];
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

assert.equal(failures.length, 0, `${failures.length} P1-002 scenario(s) failed:\n${failures.map(({ name, error }) => `- ${name}: ${error.message}`).join("\n")}`);
console.log(`PLANNING ACCEPTANCE SAFETY P1-002 OK (${tests.length} scenarios)`);
