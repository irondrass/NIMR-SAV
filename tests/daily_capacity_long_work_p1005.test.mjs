import assert from "node:assert/strict";
import fs from "node:fs";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { context, run } = createNimrVmContext({
  filename: "daily-capacity-long-work-p1005.js",
  console: { log() {}, warn() {}, error: console.error },
});

const MONDAY = "2026-09-07T07:00:00.000Z"; // 08:00 Africa/Tunis
const SATURDAY = "2026-09-12T08:00:00.000Z"; // 09:00 Africa/Tunis
const WORKSHOP_CALENDAR = {
  0: "",
  1: "08:00-12:00,13:00-17:00",
  2: "08:00-12:00,13:00-17:00",
  3: "08:00-12:00,13:00-17:00",
  4: "08:00-12:00,13:00-17:00",
  5: "08:00-12:00,13:00-17:00",
  6: "09:00-12:00",
};
const RESOURCE_WORK_HOURS = {
  0: [],
  1: [["08:00", "12:00"], ["13:00", "17:00"]],
  2: [["08:00", "12:00"], ["13:00", "17:00"]],
  3: [["08:00", "12:00"], ["13:00", "17:00"]],
  4: [["08:00", "12:00"], ["13:00", "17:00"]],
  5: [["08:00", "12:00"], ["13:00", "17:00"]],
  6: [["09:00", "12:00"]],
};

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function resource(id, role = "tolier", overrides = {}) {
  return {
    id,
    name: id,
    role,
    active: true,
    calendar: { workHours: RESOURCE_WORK_HOURS },
    ...overrides,
  };
}

function booking(id, caseId, resourceIds, segments, overrides = {}) {
  const normalizedSegments = segments.map(([start, end]) => ({ start, end }));
  return {
    id,
    caseId,
    key: "body",
    taskId: id,
    businessTaskId: id,
    title: id,
    start: normalizedSegments[0]?.start || "",
    end: normalizedSegments.at(-1)?.end || "",
    segments: normalizedSegments,
    plannedSegments: normalizedSegments,
    plannedMinutes: normalizedSegments.reduce((sum, segment) => sum + ((new Date(segment.end) - new Date(segment.start)) / 60000), 0),
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

function install({ resources = [resource("tech")], bookings = [], cases = [] } = {}) {
  context.__p1005State = {
    resources,
    cases,
    bookings,
    users: [{ id: "chief", name: "Chief", role: "chef_atelier", active: true }],
    currentUserId: "chief",
    settings: { calendar: WORKSHOP_CALENDAR, fastLaneEnabled: false },
  };
  run("state = normalizeState(__p1005State); generatedProposals = {}; invalidateStateReplacementIndexes();");
}

function findSlot(resourceIds, duration, start = MONDAY, options = {}) {
  context.__p1005ResourceIds = resourceIds;
  context.__p1005Duration = duration;
  context.__p1005Start = start;
  context.__p1005Options = options;
  return toPlain(run("findEarliestSlot(__p1005ResourceIds, new Date(__p1005Start), __p1005Duration, createIndexedPlannerBookingView(state.bookings), __p1005Options)"));
}

function segmentMinutes(slot) {
  return (slot?.segments || []).reduce((sum, segment) => sum + ((new Date(segment.end) - new Date(segment.start)) / 60000), 0);
}

function dayMinutes(slot, dateKey) {
  return (slot?.segments || [])
    .filter((segment) => segment.start.slice(0, 10) === dateKey)
    .reduce((sum, segment) => sum + ((new Date(segment.end) - new Date(segment.start)) / 60000), 0);
}

function assertOrderedSegments(slot) {
  let previousEnd = null;
  for (const segment of slot.segments) {
    const start = new Date(segment.start);
    const end = new Date(segment.end);
    assert.ok(start < end, "each working segment must have positive duration");
    if (previousEnd) assert.ok(start >= previousEnd, "segments must be ordered and non-overlapping");
    previousEnd = end;
  }
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
check("A zero-minute work creates no logical booking", () => {
  context.__p1005Item = { id: "zero", durations: { body: 0 } };
  assert.throws(
    () => run("generateSingleProposal(__p1005Item, new Date('2026-09-07T07:00:00.000Z'))"),
    /durée atelier/u,
  );
  assert.equal(run("state.bookings.length"), 0);
});

const longWorkSearchStats = {};
for (const duration of [15, 60, 479, 480, 481, 600, 840, 1200]) {
  check(`long-work ${duration} minutes remains one slot with exact productive duration`, () => {
    install();
    const slot = findSlot(["tech"], duration);
    assert.ok(slot, `expected a slot for ${duration} minutes`);
    assert.equal(segmentMinutes(slot), duration);
    assertOrderedSegments(slot);
    if (duration > 480) assert.ok(slot.segments.length > 1, "long work must span multiple working segments");
    if (duration >= 600) {
      const stats = toPlain(run("getPlanningSlotSearchStats()"));
      longWorkSearchStats[duration] = stats;
      assert.ok(stats.candidateEvaluations <= 1, "one fixed-resource candidate should be evaluated once");
      assert.ok(stats.slotRebuilds <= 1, "one fixed-resource slot should be built once");
      assert.ok(stats.daysSearched <= 3, "long-work search must remain bounded to productive days");
      assert.equal(stats.segmentCount, slot.segments.length);
    }
  });
}

check("B 600-minute wall-clock gaps are not productive time", () => {
  install();
  const slot = findSlot(["tech"], 600);
  assert.equal(segmentMinutes(slot), 600);
  assert.ok((new Date(slot.end) - new Date(slot.start)) / 60000 > 600);
  assert.equal(slot.segments.some((segment) => segment.start.slice(11, 16) === "11:00" && segment.end.slice(11, 16) === "12:00"), false);
});

check("C derived daily capacity equals usable calendar unit-minutes", () => {
  install();
  assert.equal(run("getEffectiveResourceDailyCapacityMinutes(state.resources[0], new Date('2026-09-07T07:00:00.000Z'))"), 480);
});

check("D explicit minute and hour capacities have precedence", () => {
  install({ resources: [resource("minutes", "tolier", { dailyCapacityMinutes: 300 }), resource("hours", "tolier", { dailyCapacityHours: 6 })] });
  assert.equal(run("getEffectiveResourceDailyCapacityMinutes(state.resources[0], new Date('2026-09-07T07:00:00.000Z'))"), 300);
  assert.equal(run("getEffectiveResourceDailyCapacityMinutes(state.resources[1], new Date('2026-09-07T07:00:00.000Z'))"), 360);
});

check("E derived capacity applies simultaneousCapacity but explicit capacity does not", () => {
  install({ resources: [resource("derived", "tolier", { simultaneousCapacity: 2 }), resource("explicit", "tolier", { simultaneousCapacity: 2, dailyCapacityMinutes: 600 })] });
  assert.equal(run("getEffectiveResourceDailyCapacityMinutes(state.resources[0], new Date('2026-09-07T07:00:00.000Z'))"), 960);
  assert.equal(run("getEffectiveResourceDailyCapacityMinutes(state.resources[1], new Date('2026-09-07T07:00:00.000Z'))"), 600);
});

check("F closed resource day has zero effective capacity", () => {
  install({ resources: [resource("closed", "tolier", { calendar: { workHours: RESOURCE_WORK_HOURS, closedDates: ["2026-09-07"] } })] });
  assert.equal(run("getEffectiveResourceDailyCapacityMinutes(state.resources[0], new Date('2026-09-07T07:00:00.000Z'))"), 0);
  assert.equal(findSlot(["closed"], 60).start.slice(0, 10), "2026-09-08");
});

check("G blackout reduces derived capacity and splits work", () => {
  install({ resources: [resource("blackout", "tolier", { calendar: { workHours: RESOURCE_WORK_HOURS, blackouts: [{ start: "2026-09-07T09:00:00.000Z", end: "2026-09-07T10:00:00.000Z" }] } })] });
  assert.equal(run("getEffectiveResourceDailyCapacityMinutes(state.resources[0], new Date('2026-09-07T07:00:00.000Z'))"), 420);
  const slot = findSlot(["blackout"], 420);
  assert.equal(segmentMinutes(slot), 420);
  assert.equal(slot.segments.some((segment) => new Date(segment.start) < new Date("2026-09-07T10:00:00.000Z") && new Date(segment.end) > new Date("2026-09-07T09:00:00.000Z")), false);
});

check("H technician and equipment use the exact calendar intersection", () => {
  const techHours = { ...RESOURCE_WORK_HOURS };
  const equipmentHours = { ...RESOURCE_WORK_HOURS, 1: [["09:00", "12:00"], ["14:00", "16:00"]] };
  install({ resources: [resource("tech"), resource("lift", "pont", { calendar: { workHours: equipmentHours } })] });
  const slot = findSlot(["tech", "lift"], 300, MONDAY, { requiredRolesByResource: { tech: "tolier", lift: "pont" } });
  assert.equal(slot.start, "2026-09-07T08:00:00.000Z");
  assert.equal(segmentMinutes(slot), 300);
  assert.deepEqual(slot.segments.map((segment) => [segment.start, segment.end]), [
    ["2026-09-07T08:00:00.000Z", "2026-09-07T11:00:00.000Z"],
    ["2026-09-07T13:00:00.000Z", "2026-09-07T15:00:00.000Z"],
  ]);
});

check("I same-day search uses remaining capacity before the next day", () => {
  const used = booking("used-300", "old", ["tech"], [
    ["2026-09-07T07:00:00.000Z", "2026-09-07T11:00:00.000Z"],
    ["2026-09-07T12:00:00.000Z", "2026-09-07T13:00:00.000Z"],
  ]);
  install({ resources: [resource("tech", "tolier", { dailyCapacityMinutes: 480 })], bookings: [used] });
  const slot = findSlot(["tech"], 300);
  assert.equal(slot.start, "2026-09-07T13:00:00.000Z");
  assert.equal(dayMinutes(slot, "2026-09-07"), 180);
  assert.equal(dayMinutes(slot, "2026-09-08"), 120);
});

for (const [name, usedMinutes, expectedToday] of [
  ["25 percent", 120, 360],
  ["50 percent", 240, 240],
  ["nearly full", 450, 30],
  ["exactly full", 480, 0],
  ["historically over capacity", 540, 0],
]) {
  check(`J ${name} daily usage is handled deterministically`, () => {
    const end = new Date(new Date(MONDAY).getTime() + usedMinutes * 60000).toISOString();
    const used = booking(`used-${usedMinutes}`, "old", ["tech"], [[MONDAY, end]], { vehicleExclusive: false });
    install({ resources: [resource("tech", "tolier", { dailyCapacityMinutes: 480, simultaneousCapacity: 2 })], bookings: [used] });
    const slot = findSlot(["tech"], 480, MONDAY, { vehicleExclusive: false });
    assert.equal(dayMinutes(slot, "2026-09-07"), expectedToday);
    assert.equal(segmentMinutes(slot), 480);
  });
}

check("K Saturday hours are used and Sunday remains closed", () => {
  install();
  const slot = findSlot(["tech"], 240, SATURDAY);
  assert.equal(dayMinutes(slot, "2026-09-12"), 180);
  assert.equal(dayMinutes(slot, "2026-09-13"), 0);
  assert.equal(dayMinutes(slot, "2026-09-14"), 60);
});

check("L derived capacity supports two simultaneous one-unit jobs", () => {
  const first = booking("first", "old", ["bay"], [["2026-09-07T07:00:00.000Z", "2026-09-07T11:00:00.000Z"], ["2026-09-07T12:00:00.000Z", "2026-09-07T16:00:00.000Z"]], { vehicleExclusive: false });
  install({ resources: [resource("bay", "pont", { simultaneousCapacity: 2 })], bookings: [first] });
  const slot = findSlot(["bay"], 480, MONDAY, { vehicleExclusive: false });
  assert.equal(slot.start, MONDAY);
  assert.equal(dayMinutes(slot, "2026-09-07"), 480);
});

check("M resourceUnits consume simultaneous and daily unit-minute capacity", () => {
  install({ resources: [resource("bay", "pont", { simultaneousCapacity: 2 })] });
  const slot = findSlot(["bay"], 481, MONDAY, { resourceUnits: { bay: 2 }, vehicleExclusive: false });
  assert.equal(dayMinutes(slot, "2026-09-07"), 480);
  assert.equal(dayMinutes(slot, "2026-09-08"), 1);
});

check("N impossible resourceUnits fail permanently without horizon spinning", () => {
  install({ resources: [resource("bay", "pont", { simultaneousCapacity: 2 })] });
  context.__p1005View = run("createIndexedPlannerBookingView(state.bookings)");
  const slot = run("findEarliestSlot(['bay'], new Date('2026-09-07T07:00:00.000Z'), 60, __p1005View, { resourceUnits: { bay: 3 } })");
  assert.equal(slot, null);
  assert.ok(run("__p1005View.getStats().candidateEvaluations") <= 1);
});

check("O proposal overlay daily usage constrains the next task", () => {
  install({ resources: [resource("tech", "tolier", { dailyCapacityMinutes: 480, simultaneousCapacity: 2 })] });
  context.__p1005View = run("createIndexedPlannerBookingView(state.bookings)");
  context.__p1005Overlay = booking("overlay", "case-a", ["tech"], [["2026-09-07T07:00:00.000Z", "2026-09-07T11:00:00.000Z"]], { temporary: true, vehicleExclusive: false });
  run("__p1005View.addOverlay(__p1005Overlay)");
  context.__p1005Slot = run("findEarliestSlot(['tech'], new Date('2026-09-07T07:00:00.000Z'), 360, __p1005View, { vehicleExclusive: false })");
  const slot = toPlain(context.__p1005Slot);
  assert.equal(dayMinutes(slot, "2026-09-07"), 240);
  assert.equal(segmentMinutes(slot), 360);
  assert.equal(run("state.bookings.length"), 0);
});

check("P productive history is planned around and never rewritten", () => {
  const rows = ["planned", "started", "paused", "completed"].map((status, index) => booking(
    `history-${status}`,
    `old-${index}`,
    ["tech"],
    [[`2026-09-0${7 + index}T07:00:00.000Z`, `2026-09-0${7 + index}T08:00:00.000Z`]],
    { status, actualWorkedMinutes: status === "planned" ? 0 : 30 },
  ));
  install({ bookings: rows });
  const before = toPlain(run("state.bookings"));
  findSlot(["tech"], 60);
  assert.deepEqual(toPlain(run("state.bookings")), before);
});

check("Q legacy booking without segments remains readable without invented persisted segments", () => {
  const legacy = {
    id: "legacy-no-segments",
    caseId: "legacy-case",
    key: "body",
    title: "Legacy",
    start: "2026-09-07T07:00:00.000Z",
    end: "2026-09-07T08:00:00.000Z",
    resourceIds: ["tech"],
    status: "planned",
  };
  install({ bookings: [legacy] });
  assert.equal(run("state.bookings.length"), 1);
  assert.equal(run("getPlanningSlotSegments(state.bookings[0]).length"), 1);
  assert.equal(Object.hasOwn(legacy, "segments"), false, "normalization must not mutate the historical source object");
});

check("R proposal booking reload preserves one logical multi-segment task", () => {
  const item = {
    id: "long-case",
    durations: {},
    planningTasks: [{
      id: "long-task",
      taskId: "long-task",
      businessTaskId: "long-task",
      key: "body",
      title: "Long body task",
      durationMinutes: 600,
      requiredRole: "tolier",
      resourceIds: ["tech"],
      dependencies: [],
      parallelizable: true,
      vehicleExclusive: false,
      vehicleLocation: "internal",
      taskModelVersion: 1,
      sourceKind: "canonical_graph",
    }],
  };
  install({ cases: [item] });
  context.__p1005Item = run("state.cases[0]");
  context.__p1005Proposal = run("generateSingleProposal(__p1005Item, new Date('2026-09-07T07:00:00.000Z'))");
  context.__p1005PreparedBookings = run("proposalToBookings(__p1005Item, __p1005Proposal, false)");
  assert.equal(run("applyAcceptedPlanningProposal(__p1005Item, __p1005Proposal, { throwOnError: true, notify: false })"), true);
  context.__p1005Accepted = run("state.bookings");
  assert.equal(run("__p1005Accepted.length"), 1);
  assert.equal(run("__p1005Accepted[0].taskId"), "long-task");
  assert.equal(run("__p1005Accepted[0].businessTaskId"), "long-task");
  assert.equal(run("sumBookingSegmentsMinutes(__p1005Accepted[0].segments)"), 600);
  context.__p1005Reload = run("normalizeState({ ...state, bookings: JSON.parse(JSON.stringify(__p1005Accepted)) })");
  const before = toPlain(run("__p1005Accepted[0]"));
  const after = toPlain(run("__p1005Reload.bookings[0]"));
  assert.equal(after.taskId, before.taskId);
  assert.equal(after.businessTaskId, before.businessTaskId);
  assert.deepEqual(after.resourceIds, before.resourceIds);
  assert.deepEqual(after.segments, before.segments);
  assert.equal(after.start, before.start);
  assert.equal(after.end, before.end);
  assert.deepEqual(after.dependencies, before.dependencies);
  assert.equal(after.vehicleExclusive, false);
  assert.equal(after.parallelizable, true);
});

check("S identical inputs produce byte-identical deterministic slots", () => {
  install();
  const first = findSlot(["tech"], 1200);
  const second = findSlot(["tech"], 1200);
  assert.deepEqual(second, first);
});

check("T canonical sync representation retains full booking JSON and RPC segment rows", () => {
  const syncSource = fs.readFileSync(new URL("../js/supabase-sync.js", import.meta.url), "utf8");
  assert.match(syncSource, /const segments = Array\.isArray\(step\.segments\)/u);
  assert.match(syncSource, /return segments\.map\(\(segment, segmentIndex\)/u);
  run("markEntityBookingDirty(__p1005Accepted[0])");
  context.__p1005Mutation = run("captureEntityMutationBatch(state, { workshopId: 'local-workshop' }).find((entry) => entry.entityType === 'booking')");
  assert.deepEqual(toPlain(run("__p1005Mutation.payload.entity.segments")), toPlain(run("__p1005Accepted[0].segments")));
});

const failed = checks.filter((entry) => !entry.pass);
checks.forEach((entry) => console.log(`${entry.pass ? "PASS" : "FAIL"} ${entry.name}${entry.error ? ` — ${entry.error}` : ""}`));
console.log(`P1-005 daily capacity / long work: ${checks.length - failed.length}/${checks.length} PASS`);
console.log(`P1-005 bounded search stats: ${JSON.stringify(longWorkSearchStats)}`);
if (failed.length) process.exitCode = 1;
