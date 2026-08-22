import assert from "node:assert/strict";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { context, run } = createNimrVmContext({ filename: "runtime-indexes-p007-contract.js" });

const identityCases = [
  { id: "case-a", local_id: "LOCAL-A", orNavNumber: "OR-100", vin: "VF1 ABC-123", plate: "123 TU 4567" },
  { id: "case-b", localId: "LOCAL-B", orNavNumber: "OR-200", vin: "VIN-B", plate: "200 TU 0002" },
  { id: "case-c", orNavNumber: "OR-DUP", vin: "VIN-DUP", plate: "PLATE-DUP" },
  { id: "case-d", orNavNumber: "OR-DUP", vin: "VIN-DUP", plate: "PLATE-DUP" },
];
context.__p007IdentityCases = identityCases;

function selectedId(identity, expression = "__p007IdentityCases") {
  context.__p007Identity = identity;
  return run(`findCaseBySelectionIdentity(__p007Identity, ${expression})?.id || null`);
}

assert.equal(selectedId({ id: "case-b" }), "case-b", "exact id resolves directly");
assert.equal(selectedId({ vin: "VF1 ABC-123" }), "case-a", "VIN-only lookup resolves");
assert.equal(selectedId({ plate: "123 TU 4567" }), "case-a", "plate-only lookup resolves");
assert.equal(selectedId({ orNavNumber: "OR-100" }), "case-a", "OR-only lookup resolves");
assert.equal(selectedId({ vin: "  vf1abc 123  " }), "case-a", "VIN keeps current whitespace/casing/punctuation normalization");
assert.equal(selectedId({ plate: " 123-tu-4567 " }), "case-a", "plate keeps current whitespace/casing/punctuation normalization");
assert.equal(selectedId({ orNavNumber: " or 100 " }), "case-a", "OR keeps current whitespace/casing/punctuation normalization");
assert.equal(selectedId({ vin: "" }), null, "blank identity does not match");
assert.equal(selectedId({ plate: null }), null, "null identity does not match");
assert.equal(selectedId({ orNavNumber: "missing" }), null, "missing identity does not match");
assert.equal(selectedId({ vin: "VIN-DUP" }), null, "duplicate VIN is ambiguous");
assert.equal(selectedId({ plate: "PLATE-DUP" }), null, "duplicate plate is ambiguous");
assert.equal(selectedId({ orNavNumber: "OR-DUP" }), null, "duplicate OR is ambiguous");
assert.equal(selectedId({ id: "case-b", orNavNumber: "OR-100", vin: "VF1 ABC-123" }), "case-b", "exact id has highest precedence");
assert.equal(selectedId({ localId: "LOCAL-B", orNavNumber: "OR-100", vin: "VF1 ABC-123", plate: "123 TU 4567" }), "case-b", "local id precedes OR/VIN/plate");
assert.equal(selectedId({ orNavNumber: "OR-200", vin: "VF1 ABC-123", plate: "123 TU 4567" }), "case-b", "OR precedes VIN and plate");
assert.equal(selectedId({ vin: "VIN-B", plate: "123 TU 4567" }), "case-b", "VIN precedes plate");
assert.equal(selectedId({ orNavNumber: "OR-DUP", vin: "VIN-B" }), "case-b", "an ambiguous higher-priority token falls through to the next unique token");

const calendar = Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, "00:00-23:59"]));
run(`state = normalizeState(${JSON.stringify({
  settings: { calendar },
  resources: [
    { id: "r1", name: "Resource 1", role: "tolier", active: true, calendar },
    { id: "r2", name: "Resource 2", role: "peintre", active: true, calendar },
  ],
  cases: [{ id: "case-a" }, { id: "case-b" }],
  bookings: [],
})})`);

function booking(id, resourceIds, start, end, extra = {}) {
  return {
    id,
    caseId: extra.caseId || "case-a",
    key: "body",
    title: id,
    start,
    end,
    segments: extra.withoutSegments ? undefined : (extra.segments || [{ start, end }]),
    resourceIds,
    status: "planned",
    ...extra,
  };
}

const hour = { start: "2026-05-18T08:00:00.000Z", end: "2026-05-18T09:00:00.000Z" };
const base = booking("base", ["r1"], hour.start, hour.end);
assert.equal(context.findConflict({ start: "2026-05-18T10:00:00.000Z", end: "2026-05-18T11:00:00.000Z" }, ["r1"], [base]), null, "non-overlap has no conflict");
assert.ok(context.findConflict(hour, ["r1"], [base]), "exact overlap conflicts");
assert.ok(context.findConflict({ start: "2026-05-18T08:30:00.000Z", end: "2026-05-18T09:30:00.000Z" }, ["r1"], [base]), "partial overlap conflicts");
assert.equal(context.findConflict({ start: hour.end, end: "2026-05-18T10:00:00.000Z" }, ["r1"], [base]), null, "touching boundaries do not overlap");

const r2Only = booking("r2-only", ["r2"], hour.start, hour.end);
assert.ok(context.findConflict(hour, ["r1", "r2"], [r2Only]), "any conflicting resource blocks a multi-resource slot");

const segmented = booking("segmented", ["r1"], "2026-05-18T07:00:00.000Z", "2026-05-18T12:00:00.000Z", {
  segments: [
    { start: "2026-05-18T07:00:00.000Z", end: "2026-05-18T08:00:00.000Z" },
    { start: "2026-05-18T10:00:00.000Z", end: "2026-05-18T12:00:00.000Z" },
  ],
});
assert.equal(context.findConflict({ start: "2026-05-18T08:30:00.000Z", end: "2026-05-18T09:30:00.000Z" }, ["r1"], [segmented]), null, "gaps between segments remain free");
assert.ok(context.findConflict({ start: "2026-05-18T10:30:00.000Z", end: "2026-05-18T11:00:00.000Z" }, ["r1"], [segmented]), "individual segments conflict");

const withoutSegments = booking("without-segments", ["r1"], hour.start, hour.end, { withoutSegments: true });
assert.ok(context.findConflict(hour, ["r1"], [withoutSegments]), "start/end fallback conflicts without segments");

const temporary = booking("temporary", ["r1"], hour.start, hour.end, { temporary: true });
assert.ok(context.findConflict(hour, ["r1"], [temporary]), "temporary bookings participate in conflict checks");

const overnight = booking("overnight", ["r1"], "2026-05-18T22:00:00.000Z", "2026-05-19T02:00:00.000Z", { withoutSegments: true });
assert.ok(context.findConflict({ start: "2026-05-19T00:30:00.000Z", end: "2026-05-19T01:00:00.000Z" }, ["r1"], [overnight]), "overnight start/end bookings conflict on the next day");

const multiDay = booking("multi-day", ["r1"], "2026-05-18T08:00:00.000Z", "2026-05-21T17:00:00.000Z", { withoutSegments: true });
assert.ok(context.findConflict({ start: "2026-05-20T09:00:00.000Z", end: "2026-05-20T10:00:00.000Z" }, ["r1"], [multiDay]), "multi-day bookings conflict on intermediate days");

const arbitrary = [booking("arbitrary", ["r1"], hour.start, hour.end)];
assert.ok(context.findConflict(hour, ["r1"], arbitrary), "arbitrary booking arrays are honored");
arbitrary.push(booking("proposal", ["r2"], hour.start, hour.end, { temporary: true }));
assert.ok(context.findConflict(hour, ["r2"], arbitrary), "newly pushed temporary proposals are honored");

assert.ok(context.findConflict(hour, ["r1"], [base], { caseId: "case-a" }), "same-case bookings still conflict when not excluded");
assert.equal(context.findConflict(hour, ["r1"], [base], { caseId: "case-a", bookingId: "base" }), null, "booking-id exclusion ignores the edited booking");

function indexedCaseId(identity) {
  context.__p007Identity = identity;
  return run("findCaseBySelectionIdentity(__p007Identity)?.id || null");
}

run(`state.cases = ${JSON.stringify([
  { id: "life-a", localId: "life-local", vin: "LIFE-VIN", plate: "LIFE-PLATE", orNavNumber: "LIFE-OR" },
  { id: "life-b", vin: "OTHER-VIN", plate: "OTHER-PLATE", orNavNumber: "OTHER-OR" },
])}; state.bookings = ${JSON.stringify([
  booking("life-booking", ["r1"], "2026-05-18T08:00:00.000Z", "2026-05-18T09:00:00.000Z", { caseId: "life-a" }),
])}; invalidateUiRuntimeIndexes();`);

const coldStats = run("getUiRuntimeIndexStats()");
const warmStats = run("getUiRuntimeIndexStats()");
assert.equal(warmStats.buildCount, coldStats.buildCount, "consecutive warm reads do not rebuild indexes");
assert.equal(run("getPlanningCaseIndex() === getUiRuntimeIndexes().caseById"), true, "planning delegates to the shared case-id map");

const beforeRenderBuilds = run("getUiRuntimeIndexStats().buildCount");
run("render(); render();");
const afterRenderBuilds = run("getUiRuntimeIndexStats().buildCount");
assert.equal(afterRenderBuilds, beforeRenderBuilds, "two renders without mutations reuse the warm indexes");

run('state.cases.push({ id: "life-pushed", vin: "PUSHED-VIN" })');
assert.equal(indexedCaseId({ vin: "PUSHED-VIN" }), "life-pushed", "case push is detected by length");
run('state.cases.splice(state.cases.findIndex((item) => item.id === "life-pushed"), 1)');
assert.equal(indexedCaseId({ vin: "PUSHED-VIN" }), null, "case removal is detected by length");
run('state.cases = [{ id: "life-replaced", vin: "REPLACED-VIN", plate: "REPLACED-PLATE", orNavNumber: "REPLACED-OR" }]');
assert.equal(indexedCaseId({ vin: "REPLACED-VIN" }), "life-replaced", "case-array replacement is detected by reference");

run('state.cases[0].vin = "MUTATED-VIN"; saveState({ skipCloud: true, skipSnapshot: true })');
assert.equal(indexedCaseId({ vin: "MUTATED-VIN" }), "life-replaced", "in-place VIN edits are fresh after the central save hook");
run('state.cases[0].plate = "MUTATED-PLATE"; saveState({ skipCloud: true, skipSnapshot: true })');
assert.equal(indexedCaseId({ plate: "MUTATED-PLATE" }), "life-replaced", "in-place plate edits are fresh after the central save hook");
run('state.cases[0].orNavNumber = "MUTATED-OR"; saveState({ skipCloud: true, skipSnapshot: true })');
assert.equal(indexedCaseId({ orNavNumber: "MUTATED-OR" }), "life-replaced", "in-place OR edits are fresh after the central save hook");
run('state.cases[0].id = "life-mutated-id"; saveState({ skipCloud: true, skipSnapshot: true })');
assert.equal(indexedCaseId({ id: "life-mutated-id" }), "life-mutated-id", "in-place case-id edits are fresh after the central save hook");

run(`state.bookings = ${JSON.stringify([
  booking("booking-a", ["r1"], "2026-05-18T08:00:00.000Z", "2026-05-18T09:00:00.000Z", { caseId: "life-mutated-id" }),
])}`);
assert.equal(run('getIndexedCaseBookings("life-mutated-id").length'), 1, "booking-array replacement is detected by reference");
run(`state.bookings.push(${JSON.stringify(booking("booking-pushed", ["r2"], "2026-05-18T10:00:00.000Z", "2026-05-18T11:00:00.000Z", { caseId: "life-mutated-id" }))})`);
assert.equal(run('getIndexedResourceBookings("r2").length'), 1, "booking push is detected by length");
run('state.bookings.splice(state.bookings.findIndex((item) => item.id === "booking-pushed"), 1)');
assert.equal(run('getIndexedResourceBookings("r2").length'), 0, "booking removal is detected by length");

run('state.bookings[0].caseId = "case-after-edit"; state.bookings[0].resourceIds = ["r2"]; saveState({ skipCloud: true, skipSnapshot: true })');
assert.equal(run('getIndexedCaseBookings("life-mutated-id").length'), 0, "in-place booking caseId edits remove stale membership");
assert.equal(run('getIndexedCaseBookings("case-after-edit").length'), 1, "in-place booking caseId edits add fresh membership");
assert.equal(run('getIndexedResourceBookings("r1").length'), 0, "in-place resource edits remove stale membership");
assert.equal(run('getIndexedResourceBookings("r2").length'), 1, "in-place resource edits add fresh membership");

run('state.bookings[0].segments = undefined; state.bookings[0].start = "2026-05-20T08:00:00.000Z"; state.bookings[0].end = "2026-05-20T09:00:00.000Z"; saveState({ skipCloud: true, skipSnapshot: true })');
assert.equal(run('getIndexedDayBookings("2026-05-18").length'), 0, "in-place start/end edits remove stale day membership");
assert.equal(run('getIndexedDayBookings("2026-05-20").length'), 1, "in-place start/end edits add fresh day membership");
run('state.bookings[0].segments = [{ start: "2026-05-22T08:00:00.000Z", end: "2026-05-22T09:00:00.000Z" }]; saveState({ skipCloud: true, skipSnapshot: true })');
assert.equal(run('getIndexedDayBookings("2026-05-20").length'), 0, "in-place segment edits remove stale day membership");
assert.equal(run('getIndexedDayBookings("2026-05-22").length'), 1, "in-place segment edits add fresh day membership");

run(`state.bookings = [${JSON.stringify(multiDay)}]; invalidateUiRuntimeIndexes()`);
assert.equal(run('getIndexedDayBookings("2026-05-18").length'), 1, "multi-day start day is indexed");
assert.equal(run('getIndexedDayBookings("2026-05-19").length'), 1, "first intermediate day is indexed");
assert.equal(run('getIndexedDayBookings("2026-05-20").length'), 1, "second intermediate day is indexed");
assert.equal(run('getIndexedDayBookings("2026-05-21").length'), 1, "multi-day end day is indexed when touched");

run(`state = normalizeState(${JSON.stringify({ settings: { calendar }, resources: [], cases: [{ id: "restored", vin: "RESTORE-VIN" }], bookings: [] })}); reconcileActiveCaseSelection({ vin: "RESTORE-VIN" })`);
assert.equal(indexedCaseId({ vin: "RESTORE-VIN" }), "restored", "restore/import-style state replacement invalidates indexes");
run(`state = normalizeState(${JSON.stringify({ settings: { calendar }, resources: [], cases: [{ id: "synced", vin: "SYNC-VIN" }], bookings: [] })}); reconcileActiveCaseSelection({ vin: "SYNC-VIN" })`);
assert.equal(indexedCaseId({ vin: "SYNC-VIN" }), "synced", "sync-style state replacement invalidates indexes");
run('getUiRuntimeIndexes(); state.cases[0] = { ...state.cases[0], vin: "SYNC-IN-PLACE-VIN" }; invalidateStateReplacementIndexes()');
assert.equal(indexedCaseId({ vin: "SYNC-IN-PLACE-VIN" }), "synced", "cloud-style same-length case replacement is fresh after explicit invalidation");

run(`state.cases = ${JSON.stringify([
  { id: "dup-a", vin: "DUP", plate: "DUP-PLATE", orNavNumber: "DUP-OR" },
  { id: "dup-b", vin: "DUP", plate: "DUP-PLATE", orNavNumber: "DUP-OR" },
  { id: "unique", vin: "UNIQUE", plate: "UNIQUE-PLATE", orNavNumber: "UNIQUE-OR" },
])}; invalidateUiRuntimeIndexes()`);
assert.equal(indexedCaseId({ vin: "DUP" }), null, "indexed duplicate VIN remains ambiguous");
assert.equal(indexedCaseId({ plate: "DUP-PLATE" }), null, "indexed duplicate plate remains ambiguous");
assert.equal(indexedCaseId({ orNavNumber: "DUP-OR" }), null, "indexed duplicate OR remains ambiguous");
assert.equal(indexedCaseId({ orNavNumber: "DUP-OR", vin: "UNIQUE" }), "unique", "indexed ambiguous precedence still falls through");

run(`state.resources = ${JSON.stringify([
  { id: "r1", name: "Resource 1", role: "tolier", active: true, calendar },
  { id: "r2", name: "Resource 2", role: "peintre", active: true, calendar },
])}`);
context.__p007Ephemeral = [booking("ephemeral", ["r1"], hour.start, hour.end)];
assert.ok(run('findConflict({ start: "2026-05-18T08:00:00.000Z", end: "2026-05-18T09:00:00.000Z" }, ["r1"], __p007Ephemeral)'), "ephemeral index initially sees a conflict");
context.__p007Ephemeral.push(booking("ephemeral-push", ["r2"], hour.start, hour.end, { temporary: true }));
assert.ok(run('findConflict({ start: "2026-05-18T08:00:00.000Z", end: "2026-05-18T09:00:00.000Z" }, ["r2"], __p007Ephemeral)'), "ephemeral cache detects array length changes");
context.__p007Ephemeral[0].resourceIds = ["r2"];
run("invalidateBookingRuntimeIndexes(__p007Ephemeral)");
assert.equal(run('findConflict({ start: "2026-05-18T08:00:00.000Z", end: "2026-05-18T09:00:00.000Z" }, ["r1"], __p007Ephemeral)'), null, "explicit ephemeral invalidation handles in-place edits");

run(`state.resources = ${JSON.stringify([
  { id: "r1", name: "Resource 1", role: "tolier", active: true, calendar },
  { id: "r2", name: "Resource 2", role: "peintre", active: true, calendar },
])}; state.cases = [{ id: "case-a" }, { id: "case-b" }]; invalidateUiRuntimeIndexes()`);
const parityScenarios = [
  [hour, ["r1"], [base], {}],
  [{ start: hour.end, end: "2026-05-18T10:00:00.000Z" }, ["r1"], [base], {}],
  [{ start: "2026-05-18T10:30:00.000Z", end: "2026-05-18T11:00:00.000Z" }, ["r1"], [segmented], {}],
  [{ start: "2026-05-20T09:00:00.000Z", end: "2026-05-20T10:00:00.000Z" }, ["r1"], [multiDay], {}],
  [hour, ["r1"], [base], { caseId: "case-a", bookingId: "base" }],
];
parityScenarios.forEach(([candidateSlot, resourceIds, bookings, options], index) => {
  const indexed = context.findConflict(candidateSlot, resourceIds, bookings, options);
  const unindexed = context.findConflict(candidateSlot, resourceIds, bookings, { ...options, runtimeIndexCandidates: false });
  assert.equal(JSON.stringify(indexed), JSON.stringify(unindexed), `indexed conflict result ${index + 1} matches the exact full-scan predicate`);
});

const noise = Array.from({ length: 100 }, (_, index) => booking(
  `noise-${index}`,
  ["r2"],
  "2026-06-01T08:00:00.000Z",
  "2026-06-01T09:00:00.000Z",
  { caseId: `noise-case-${index}` },
));
context.__p007Candidates = [...noise, base];
run('findConflict({ start: "2026-05-18T08:00:00.000Z", end: "2026-05-18T09:00:00.000Z" }, ["r1"], __p007Candidates)');
assert.deepEqual(
  JSON.parse(JSON.stringify(run("getPlanningConflictCandidateStats()"))),
  { sourceCount: 101, candidateCount: 1, indexed: true },
  "conflict candidate selection combines resource and day",
);

const stateBeforeRead = run("JSON.stringify(state)");
run('getUiRuntimeIndexes(); getIndexedCaseById("case-a"); getIndexedResourceBookings("r1"); getPlanningCaseIndex()');
assert.equal(run("JSON.stringify(state)"), stateBeforeRead, "runtime index reads never mutate application state");
assert.equal(run('Object.hasOwn(state, "uiRuntimeIndexes")'), false, "runtime indexes are not stored in state");

console.log("P0-007 RUNTIME INDEX CHARACTERIZATION OK");
