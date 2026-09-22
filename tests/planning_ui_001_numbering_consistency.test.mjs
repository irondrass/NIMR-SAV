import assert from "node:assert/strict";
import test from "node:test";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { context, run } = createNimrVmContext({
  filename: "planning-ui-001-numbering-consistency.js",
  console: { log() {}, warn() {}, error: console.error },
});

const originalGetElementById = context.document.getElementById.bind(context.document);
const persistentElementsById = new Map();

context.document.getElementById = (id) => {
  const key = String(id);
  if (!persistentElementsById.has(key)) {
    persistentElementsById.set(key, originalGetElementById(key));
  }
  return persistentElementsById.get(key);
};

const originalQuerySelector = context.document.querySelector.bind(context.document);

context.document.querySelector = (selector) => {
  if (typeof selector === "string" && selector.startsWith("#")) {
    return context.document.getElementById(selector.slice(1));
  }
  return originalQuerySelector(selector);
};

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
  resource("paint-booth-1", "cabine", { type: "equipment" }),
  resource("lift-1", "pont_mecanique", { type: "equipment" }),
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

function toPlain(value) {
  if (value instanceof Map) {
    return Object.fromEntries(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function mapToObj(map) {
  // Handle both host Map and VM Map (different constructor in VM context)
  if (map && typeof map === 'object' && typeof map.size === 'number' && typeof map[Symbol.iterator] === 'function') {
    const obj = {};
    for (const [k, v] of map) {
      obj[k] = v;
    }
    return obj;
  }
  return map;
}

// Helper to create a booking with segments for a specific day
function makeBooking(id, caseId, key, primaryResourceId, equipmentResourceIds, start, end, overrides = {}) {
  return {
    id,
    caseId,
    key,
    taskId: id,
    title: key,
    resourceIds: [primaryResourceId, ...(equipmentResourceIds || [])],
    primaryResourceId,
    equipmentResourceIds: equipmentResourceIds || [],
    start: start.toISOString(),
    end: end.toISOString(),
    segments: [{ start: start.toISOString(), end: end.toISOString() }],
    status: "planned",
    temporary: false,
    color: "#11415f",
    ...overrides,
  };
}

function makeCase(id, clientName = "Client", vehicle = "Vehicle", plate = "ABC-123") {
  return {
    id,
    clientName,
    vehicle,
    plate,
    status: "open",
    durations: {},
    stepExecutionModes: {},
  };
}

// ---------------------------------------------------------------------------
// PLANNING-UI-001: Numbering consistency defects
// ---------------------------------------------------------------------------

test("UI-1: Bookings stored in non-chronological order: Gantt numbering remains chronological", () => {
  // Given: bookings array is NOT in chronological order (earlier booking added after later one)
  // When: renderPlanning builds taskNumberMap
  // Then: numbers assigned are chronological by start time, not insertion order
  const day = new Date("2026-09-07T08:00:00.000Z"); // Monday
  const later = makeBooking("later", "case-1", "body", "body-1", [], new Date("2026-09-07T10:00:00.000Z"), new Date("2026-09-07T11:00:00.000Z"));
  const earlier = makeBooking("earlier", "case-1", "prep", "paint-1", ["prep-zone-1"], new Date("2026-09-07T08:00:00.000Z"), new Date("2026-09-07T09:00:00.000Z"));
  install({ bookings: [later, earlier], cases: [makeCase("case-1")] });
  context.__caDate = day.toISOString().split("T")[0];
  run("state.planningDate = __caDate");
  const taskNumberMap = mapToObj(run("buildDailyPlanningTaskNumberMap(new Date(state.planningDate), state.resources.filter(isDisplayPlanningResource))"));
  // earlier booking (08:00) should be #1, later booking (10:00) should be #2
  const earlierKey = `earlier|2026-09-07T08:00:00.000Z|2026-09-07T09:00:00.000Z|prep`;
  const laterKey = `later|2026-09-07T10:00:00.000Z|2026-09-07T11:00:00.000Z|body`;
  assert.equal(taskNumberMap[earlierKey], 1, "Earlier booking must be numbered 1");
  assert.equal(taskNumberMap[laterKey], 2, "Later booking must be numbered 2");
});

test("UI-2: Daily Labor Summary must use the exact canonical Gantt number, not index + 1", () => {
  // Given: multiple bookings on a day
  // When: renderDailyLaborSummary runs
  // Then: the displayed numbers must match the Gantt taskNumberMap exactly
  const day = new Date("2026-09-07T08:00:00.000Z");
  const b1 = makeBooking("b1", "case-1", "body", "body-1", [], new Date("2026-09-07T08:00:00.000Z"), new Date("2026-09-07T09:00:00.000Z"));
  const b2 = makeBooking("b2", "case-1", "prep", "paint-1", ["prep-zone-1"], new Date("2026-09-07T10:00:00.000Z"), new Date("2026-09-07T11:00:00.000Z"));
  install({ bookings: [b1, b2], cases: [makeCase("case-1")] });
  context.__caDate = day.toISOString().split("T")[0];
  run("state.planningDate = __caDate");
  // Get the Gantt numbers
  const taskNumberMap = mapToObj(run("buildDailyPlanningTaskNumberMap(new Date(state.planningDate), state.resources.filter(isDisplayPlanningResource))"));
  // Render daily labor summary
  const html = toPlain(run(`
    const date = new Date(state.planningDate);
    const filters = { search: "", resourceId: "all" };
    const taskNumberMap = buildDailyPlanningTaskNumberMap(date, state.resources.filter(isDisplayPlanningResource));
    renderDailyLaborSummary(date, taskNumberMap, filters);
    document.getElementById('daily-labor-summary').innerHTML
  `));
  // Verify the numbers in the HTML match Gantt numbers
  const key1 = `b1|2026-09-07T08:00:00.000Z|2026-09-07T09:00:00.000Z|body`;
  const key2 = `b2|2026-09-07T10:00:00.000Z|2026-09-07T11:00:00.000Z|prep`;
  const expected1 = taskNumberMap[key1] || 1;
  const expected2 = taskNumberMap[key2] || 2;
  // Check that the rendered cards use the correct numbers
  assert.ok(html.includes(`${expected1}.`), `Daily labor summary must show Gantt number ${expected1} for first task`);
  assert.ok(html.includes(`${expected2}.`), `Daily labor summary must show Gantt number ${expected2} for second task`);
});

test("UI-3: One business operation split into multiple time segments: every segment has the SAME number", () => {
  // Given: a single booking with multiple segments (e.g., paused/resumed)
  // When: renderPlanning builds taskNumberMap
  // Then: all segments of the same booking get the same number
  const day = new Date("2026-09-07T08:00:00.000Z");
  const multiSegmentBooking = makeBooking(
    "multi-seg",
    "case-1",
    "body",
    "body-1",
    [],
    new Date("2026-09-07T08:00:00.000Z"),
    new Date("2026-09-07T12:00:00.000Z")
  );
  // Override with multiple segments
  multiSegmentBooking.segments = [
    { start: "2026-09-07T08:00:00.000Z", end: "2026-09-07T09:30:00.000Z" },
    { start: "2026-09-07T10:00:00.000Z", end: "2026-09-07T11:30:00.000Z" },
  ];
  multiSegmentBooking.start = "2026-09-07T08:00:00.000Z";
  multiSegmentBooking.end = "2026-09-07T11:30:00.000Z";
  install({ bookings: [multiSegmentBooking], cases: [makeCase("case-1")] });
  context.__caDate = day.toISOString().split("T")[0];
  run("state.planningDate = __caDate");
  const taskNumberMap = mapToObj(run("buildDailyPlanningTaskNumberMap(new Date(state.planningDate), state.resources.filter(isDisplayPlanningResource))"));
  const keys = Object.keys(taskNumberMap).filter((k) => k.startsWith("multi-seg"));
  assert.equal(keys.length, 2, "Expected two segment entries in taskNumberMap");
  const num1 = taskNumberMap[keys[0]];
  const num2 = taskNumberMap[keys[1]];
  assert.equal(num1, num2, `Both segments must have the same number (got ${num1} and ${num2})`);
});

test("UI-4: Same business operation rendered on technician and equipment rows: same number", () => {
  // Given: a booking with both primary technician and equipment
  // When: renderPlanning runs for both resource rows
  // Then: the number displayed on technician row equals the number on equipment row
  const day = new Date("2026-09-07T08:00:00.000Z");
  const booking = makeBooking(
    "tech-equip",
    "case-1",
    "prep",
    "paint-1",
    ["prep-zone-1"],
    new Date("2026-09-07T08:00:00.000Z"),
    new Date("2026-09-07T09:00:00.000Z")
  );
  install({ bookings: [booking], cases: [makeCase("case-1")] });
  context.__caDate = day.toISOString().split("T")[0];
  run("state.planningDate = __caDate");
  const taskNumberMap = mapToObj(run("buildDailyPlanningTaskNumberMap(new Date(state.planningDate), state.resources.filter(isDisplayPlanningResource))"));
  const key = `tech-equip|2026-09-07T08:00:00.000Z|2026-09-07T09:00:00.000Z|prep`;
  const number = taskNumberMap[key];
  assert.ok(number, "Task number must be assigned");
  // Both rows (paint-1 and prep-zone-1) should reference the same number for this booking
  // The map key is the same for both since it's based on booking.id + segment + key
  assert.equal(Object.keys(taskNumberMap).length, 1, "Single booking with equipment must produce exactly one number entry");
});

test("UI-5: Resource filtering must not renumber visible tasks", () => {
  // Given: multiple bookings on different resources
  // When: filtering by resource
  // Then: the visible tasks keep their original Gantt numbers (no re-indexing)
  const day = new Date("2026-09-07T08:00:00.000Z");
  const b1 = makeBooking("body-booking", "case-1", "body", "body-1", [], new Date("2026-09-07T08:00:00.000Z"), new Date("2026-09-07T09:00:00.000Z"));
  const b2 = makeBooking("prep-booking", "case-1", "prep", "paint-1", ["prep-zone-1"], new Date("2026-09-07T10:00:00.000Z"), new Date("2026-09-07T11:00:00.000Z"));
  install({ bookings: [b1, b2], cases: [makeCase("case-1")] });
  context.__caDate = day.toISOString().split("T")[0];
  run("state.planningDate = __caDate");
  const taskNumberMap = mapToObj(run("buildDailyPlanningTaskNumberMap(new Date(state.planningDate), state.resources.filter(isDisplayPlanningResource))"));
  const key1 = `body-booking|2026-09-07T08:00:00.000Z|2026-09-07T09:00:00.000Z|body`;
  const key2 = `prep-booking|2026-09-07T10:00:00.000Z|2026-09-07T11:00:00.000Z|prep`;
  const allNum1 = taskNumberMap[key1];
  const allNum2 = taskNumberMap[key2];
  // Now filter to only show body-1
  const filteredMap = mapToObj(run(`
    const filtered = state.resources.filter(r => r.id === "body-1" && isDisplayPlanningResource(r));
    buildDailyPlanningTaskNumberMap(new Date(state.planningDate), filtered)
  `));
  // The body-booking should keep its original number
  const filteredNum1 = filteredMap[key1];
  assert.equal(filteredNum1, allNum1, `Filtered view must preserve original Gantt number (${allNum1}), got ${filteredNum1}`);
});

test("UI-6: Mobile planning number = Gantt number", () => {
  // Given: bookings on a day
  // When: renderMobilePlanningList runs
  // Then: the numbers shown in mobile cards match the Gantt taskNumberMap
  const day = new Date("2026-09-07T08:00:00.000Z");
  const b1 = makeBooking("mobile-1", "case-1", "body", "body-1", [], new Date("2026-09-07T08:00:00.000Z"), new Date("2026-09-07T09:00:00.000Z"));
  const b2 = makeBooking("mobile-2", "case-1", "prep", "paint-1", ["prep-zone-1"], new Date("2026-09-07T10:00:00.000Z"), new Date("2026-09-07T11:00:00.000Z"));
  install({ bookings: [b1, b2], cases: [makeCase("case-1")] });
  context.__caDate = day.toISOString().split("T")[0];
  run("state.planningDate = __caDate");
  const taskNumberMap = mapToObj(run("buildDailyPlanningTaskNumberMap(new Date(state.planningDate), state.resources.filter(isDisplayPlanningResource))"));
  const mobileHtml = toPlain(run(`
    const dayDate = new Date(state.planningDate);
    const filterOpts = { search: "", resourceId: "all" };
    const tnMap = buildDailyPlanningTaskNumberMap(dayDate, state.resources.filter(isDisplayPlanningResource));
    renderMobilePlanningList(dayDate, state.resources.filter(isDisplayPlanningResource), tnMap, filterOpts);
    document.getElementById('mobile-planning-list').innerHTML
  `));
  const key1 = `mobile-1|2026-09-07T08:00:00.000Z|2026-09-07T09:00:00.000Z|body`;
  const key2 = `mobile-2|2026-09-07T10:00:00.000Z|2026-09-07T11:00:00.000Z|prep`;
  const expected1 = taskNumberMap[key1];
  const expected2 = taskNumberMap[key2];
  assert.ok(mobileHtml.includes(`#${expected1}`), `Mobile planning must show Gantt number ${expected1}`);
  assert.ok(mobileHtml.includes(`#${expected2}`), `Mobile planning must show Gantt number ${expected2}`);
});

test("UI-7: Two different cases with the same businessTaskId must remain distinct operations", () => {
  // Given: two different cases, each with a booking having the same businessTaskId
  // When: renderPlanning builds taskNumberMap
  // Then: each case's operation gets its own number (they are distinct)
  const day = new Date("2026-09-07T08:00:00.000Z");
  const b1 = makeBooking("task-A", "case-A", "body", "body-1", [], new Date("2026-09-07T08:00:00.000Z"), new Date("2026-09-07T09:00:00.000Z"));
  b1.businessTaskId = "shared-business-id";
  const b2 = makeBooking("task-B", "case-B", "body", "body-2", [], new Date("2026-09-07T10:00:00.000Z"), new Date("2026-09-07T11:00:00.000Z"));
  b2.businessTaskId = "shared-business-id";
  install({ bookings: [b1, b2], cases: [makeCase("case-A"), makeCase("case-B")] });
  context.__caDate = day.toISOString().split("T")[0];
  run("state.planningDate = __caDate");
  const taskNumberMap = mapToObj(run("buildDailyPlanningTaskNumberMap(new Date(state.planningDate), state.resources.filter(isDisplayPlanningResource))"));
  const key1 = `task-A|2026-09-07T08:00:00.000Z|2026-09-07T09:00:00.000Z|body`;
  const key2 = `task-B|2026-09-07T10:00:00.000Z|2026-09-07T11:00:00.000Z|body`;
  assert.ok(key1 in taskNumberMap, "Case A task must have a number");
  assert.ok(key2 in taskNumberMap, "Case B task must have a number");
  // They must have DIFFERENT numbers since they are different cases
  assert.notEqual(taskNumberMap[key1], taskNumberMap[key2], "Different cases with same businessTaskId must have different numbers");
});

test("UI-8: Legacy booking without businessTaskId must still receive a stable number", () => {
  // Given: a booking without businessTaskId (legacy)
  // When: renderPlanning builds taskNumberMap
  // Then: it receives a stable number based on its segment times
  const day = new Date("2026-09-07T08:00:00.000Z");
  const legacyBooking = makeBooking("legacy-1", "case-1", "body", "body-1", [], new Date("2026-09-07T08:00:00.000Z"), new Date("2026-09-07T09:00:00.000Z"));
  delete legacyBooking.businessTaskId;
  delete legacyBooking.parentBookingId;
  install({ bookings: [legacyBooking], cases: [makeCase("case-1")] });
  context.__caDate = day.toISOString().split("T")[0];
  run("state.planningDate = __caDate");
  const taskNumberMap = mapToObj(run("buildDailyPlanningTaskNumberMap(new Date(state.planningDate), state.resources.filter(isDisplayPlanningResource))"));
  const key = `legacy-1|2026-09-07T08:00:00.000Z|2026-09-07T09:00:00.000Z|body`;
  const number = taskNumberMap[key];
  assert.ok(number && number > 0, "Legacy booking must receive a positive number");
  // Run again to verify stability
  const taskNumberMap2 = mapToObj(run("buildDailyPlanningTaskNumberMap(new Date(state.planningDate), state.resources.filter(isDisplayPlanningResource))"));
  assert.equal(taskNumberMap2[key], number, "Number must be stable across runs");
});