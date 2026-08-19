import assert from "node:assert/strict";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { context, run, source } = createNimrVmContext({
  filename: "planning-dead-code-cleanup-v236.js",
});

const calendar = {
  0: "",
  1: "08:00-12:00,13:00-17:00",
  2: "08:00-12:00,13:00-17:00",
  3: "08:00-12:00,13:00-17:00",
  4: "08:00-12:00,13:00-17:00",
  5: "08:00-12:00,13:00-17:00",
  6: "",
};

const resources = [
  { id: "tolier-1", name: "Tôlier 1", role: "tolier", active: true },
  { id: "mecanicien-1", name: "Mécanicien 1", role: "mecanicien", active: true },
  { id: "peintre-1", name: "Peintre 1", role: "peintre", active: true },
  { id: "zone-1", name: "Zone 1", role: "zone_preparation", active: true },
  { id: "cabine-1", name: "Cabine 1", role: "cabine", active: true },
];

run(`state = normalizeState(${JSON.stringify({ settings: { calendar }, resources, bookings: [], cases: [] })})`);

function snapshot(item, bookings, split) {
  const encodedItem = JSON.stringify(item);
  const encodedBookings = JSON.stringify(bookings);
  const encodedSplit = JSON.stringify(split);
  return JSON.parse(run(`JSON.stringify(schedulePipelineWithAnticipatedNewParts(${encodedItem}, new Date("2026-05-18T08:00:00+01:00"), ${encodedBookings}, ${encodedSplit}))`));
}

function activeSnapshot(item, bookings) {
  return JSON.parse(run(`JSON.stringify(scheduleSequentialPipeline(${JSON.stringify(item)}, new Date("2026-05-18T08:00:00+01:00"), ${JSON.stringify(bookings)}))`));
}

const fixtures = [
  { id: "normal", durations: { body: 2, prep: 1, paint: 1 } },
  { id: "anticipated", durations: { body: 2, prep: 2, paint: 1 }, split: { prep: 1, paint: 0, rows: [{ label: "Aile", hours: 1 }] } },
  { id: "no-anticipated", durations: { body: 1, paint: 1 }, split: { prep: 0, paint: 0, rows: [] } },
  { id: "parallel-capable", durations: { body: 1, prep: 1, paint: 1 }, split: { prep: 0, paint: 0, rows: [], parallel: true } },
];

for (const fixture of fixtures) {
  const bookings = fixture.id === "normal"
    ? [{ id: "existing", caseId: "other", resourceIds: ["tolier-1"], primaryResourceId: "tolier-1", segments: [{ start: "2026-05-18T08:00:00+01:00", end: "2026-05-18T09:00:00+01:00" }], start: "2026-05-18T08:00:00+01:00", end: "2026-05-18T09:00:00+01:00", status: "planned" }]
    : [];
  const { split = { prep: 0, paint: 0, rows: [] }, ...item } = fixture;
  assert.deepEqual(snapshot(item, bookings, split), activeSnapshot(item, bookings), `${fixture.id}: active return must remain equivalent to sequential scheduling`);
}

const noSlotItem = { id: "no-slot", durations: { body: 1 } };
run("state.resources = []");
const unavailableBookings = resources.map((resource, index) => ({
  id: `busy-${index}`,
  caseId: `other-${index}`,
  resourceIds: [resource.id],
  primaryResourceId: resource.id,
  segments: [{ start: "2026-05-18T08:00:00+01:00", end: "2026-05-18T17:00:00+01:00" }],
  start: "2026-05-18T08:00:00+01:00",
  end: "2026-05-18T17:00:00+01:00",
  status: "planned",
}));
assert.throws(
  () => snapshot(noSlotItem, unavailableBookings, { prep: 1, paint: 0, rows: [] }),
  "no-slot failure must remain on the active path",
);
assert.equal(typeof context.schedulePipelineWithAnticipatedNewParts, "function", "public planning function must remain available");
assert.match(source, /return scheduleSequentialPipeline\(item, startAfter, bookings\);/u, "active sequential return must remain present");
assert.doesNotMatch(source, /Étape héritée désactivée|prep-only-if-capacity|originalPrepHours/u, "obsolete unreachable implementation must be absent");
assert.match(source, /function schedulePipelineWithAnticipatedNewParts\(item, startAfter, bookings, split\)/u, "function signature must remain unchanged");

console.log("PLANNING ACTIVE PATH CHARACTERIZATION OK");
