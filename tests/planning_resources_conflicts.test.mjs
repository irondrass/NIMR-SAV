import assert from "node:assert/strict";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { context, run } = createNimrVmContext({ filename: "planning-resources-conflicts-contract.js" });

const calendar = {
  0: "",
  1: "08:00-12:00,13:00-17:00",
  2: "08:00-12:00,13:00-17:00",
  3: "08:00-12:00,13:00-17:00",
  4: "08:00-12:00,13:00-17:00",
  5: "08:00-12:00,13:00-17:00",
  6: "",
};

run(`state = normalizeState(${JSON.stringify({
  settings: { calendar },
  resources: [
    { id: "tolier", name: "Tôlier", role: "tolier", active: true, calendar },
    { id: "electricien", name: "Électricien", role: "electricien", active: true, calendar },
    { id: "peintre", name: "Peintre", role: "peintre", active: true, calendar },
    { id: "zone-capacity", name: "Zone capacité 2", role: "zone_preparation", capacity: 2, simultaneousCapacity: 2, active: true, calendar },
    { id: "external-paint", name: "Peinture externe", role: "peintre", site: "external", external: true, active: true, calendar },
  ],
  cases: [{ id: "graph-case", clientName: "Graphe planning" }],
  bookings: [],
})})`);

function slot(id, caseId, resourceIds, start, end, extra = {}) {
  return {
    id,
    caseId,
    key: extra.key || "prep",
    title: id,
    start,
    end,
    segments: [{ start, end }],
    resourceIds,
    status: "planned",
    ...extra,
  };
}

const start = "2026-05-18T08:00:00.000Z";
const end = "2026-05-18T09:00:00.000Z";
const capacityOne = slot("capacity-1", "case-a", ["zone-capacity"], start, end, { capacityUnits: 1 });
const capacityTwo = slot("capacity-2", "case-b", ["zone-capacity"], start, end, { capacityUnits: 1 });
const capacityThree = slot("capacity-3", "case-c", ["zone-capacity"], start, end, { capacityUnits: 1 });
assert.equal(context.validatePlanningCandidate(capacityTwo, [capacityOne]).ok, true, "une ressource de capacité 2 accepte deux occupations");
const overflow = context.validatePlanningCandidate(capacityThree, [capacityOne, capacityTwo]);
assert.equal(overflow.ok, false);
assert.ok(overflow.conflicts.some((conflict) => conflict.code === "simultaneous_capacity"), "la troisième occupation doit être refusée");

const incompatible = context.validatePlanningCandidate(
  slot("wrong-role", "case-role", ["tolier"], start, end, { requiredRolesByResource: { tolier: "peintre" } }),
  [],
);
assert.ok(incompatible.conflicts.some((conflict) => conflict.code === "incompatible_resource"), "le métier requis doit être contrôlé");

const sunday = context.validatePlanningCandidate(
  slot("sunday", "case-sunday", ["tolier"], "2026-05-17T08:00:00.000Z", "2026-05-17T09:00:00.000Z"),
  [],
);
assert.ok(sunday.conflicts.some((conflict) => conflict.code === "resource_calendar"), "le calendrier de la ressource doit être respecté");

const inside = slot("inside", "same-vehicle", ["tolier"], start, end, { vehicleExclusive: true, vehicleLocation: "internal" });
const outside = slot("outside", "same-vehicle", ["external-paint"], "2026-05-18T08:30:00.000Z", "2026-05-18T09:30:00.000Z", { vehicleExclusive: true, vehicleLocation: "external" });
const vehicleConflict = context.validatePlanningCandidate(outside, [inside]);
assert.ok(vehicleConflict.conflicts.some((conflict) => conflict.code === "vehicle_double_booking"), "un véhicule ne peut pas être simultanément interne et externe");

const dependency = slot("dependency", "case-dependency", ["tolier"], start, "2026-05-18T10:00:00.000Z", { key: "body" });
const tooEarly = slot("dependent", "case-dependency", ["peintre"], "2026-05-18T09:00:00.000Z", "2026-05-18T10:00:00.000Z", { key: "paint", dependencies: ["dependency"] });
const dependencyValidation = context.validatePlanningCandidate(tooEarly, [dependency]);
assert.ok(dependencyValidation.conflicts.some((conflict) => conflict.code === "dependency_not_finished"), "une dépendance doit précéder sa tâche");

const graphCase = run('state.cases.find((item) => item.id === "graph-case")');
const proposal = context.scheduleTaskGraph(graphCase, [
  { id: "body", key: "body", title: "Tôlerie", durationMinutes: 120, requiredRole: "tolier", parallelizable: true },
  { id: "electric", key: "electrical", title: "Électricité indépendante", durationMinutes: 60, requiredRole: "electricien", parallelizable: true },
  { id: "paint", key: "paint", title: "Peinture", durationMinutes: 60, requiredRole: "peintre", dependencies: ["body"] },
], new Date(start), []);
const body = proposal.steps.find((step) => step.taskId === "body");
const electric = proposal.steps.find((step) => step.taskId === "electric");
const paint = proposal.steps.find((step) => step.taskId === "paint");
assert.equal(body.start, electric.start, "deux tâches explicitement parallélisables peuvent démarrer ensemble");
assert.ok(new Date(paint.start) >= new Date(body.end), "la peinture doit attendre la tôlerie");

const proposalBookings = proposal.steps.map((step, index) => slot(
  `graph-${index}`,
  "graph-case",
  step.resourceIds,
  step.start,
  step.end,
  {
    key: step.key,
    taskId: step.taskId,
    dependencies: step.dependencies,
    parallelizable: step.parallelizable,
    vehicleExclusive: step.vehicleExclusive,
    vehicleLocation: step.vehicleLocation,
  },
));
assert.deepEqual(Array.from(context.findPlanningConflicts(proposalBookings)), [], "le graphe calculé ne doit contenir aucune double réservation");

console.log("PLANNING RESOURCES CONFLICTS OK");
