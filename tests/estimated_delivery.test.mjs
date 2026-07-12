import assert from "node:assert/strict";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { context, run } = createNimrVmContext({ filename: "estimated-delivery-contract.js" });
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
  resources: [
    { id: "body-delivery", name: "Tôlier livraison", role: "tolier", active: true, calendar },
    { id: "paint-delivery", name: "Peintre livraison", role: "peintre", active: true, calendar },
  ],
  cases: [{
    id: "case-delivery",
    clientName: "Livraison estimée",
    appointment: { start: "2026-05-18T08:00:00.000Z", marginMinutes: 60 },
  }],
  bookings: [
    {
      id: "delivery-body",
      caseId: "case-delivery",
      key: "body",
      title: "Tôlerie",
      resourceIds: ["body-delivery"],
      start: "2026-05-18T08:00:00.000Z",
      end: "2026-05-18T10:00:00.000Z",
      segments: [{ start: "2026-05-18T08:00:00.000Z", end: "2026-05-18T10:00:00.000Z" }],
      status: "planned"
    },
    {
      id: "delivery-paint",
      caseId: "case-delivery",
      key: "paint",
      title: "Peinture",
      dependencies: ["delivery-body"],
      resourceIds: ["paint-delivery"],
      start: "2026-05-18T10:00:00.000Z",
      end: "2026-05-18T12:00:00.000Z",
      segments: [{ start: "2026-05-18T10:00:00.000Z", end: "2026-05-18T12:00:00.000Z" }],
      status: "planned"
    }
  ]
})})`);

const item = run('state.cases.find((entry) => entry.id === "case-delivery")');
const initial = context.recalculateEstimatedDelivery(item, "Planning initial", { userName: "Chef" }, { referenceDate: "2026-05-18T07:00:00.000Z" });
assert.equal(initial.ok, true);
assert.equal(initial.status, "confirmed");
assert.equal(
  initial.current,
  context.addWorkingMinutes(new Date("2026-05-18T12:00:00.000Z"), 60).toISOString(),
  "la marge d'une heure doit suivre les horaires atelier locaux",
);
assert.equal(item.deliveryEstimate.initial, initial.current);
assert.equal(item.deliveryEstimate.history.length, 1);

run(`(() => {
  const booking = state.bookings.find((entry) => entry.id === "delivery-paint");
  booking.start = "2026-05-18T13:00:00.000Z";
  booking.end = "2026-05-18T15:00:00.000Z";
  booking.segments = [{ start: booking.start, end: booking.end }];
  booking.plannedStart = booking.start;
  booking.plannedEnd = booking.end;
})()`);
const revised = context.recalculateEstimatedDelivery(item, "Peinture décalée", { userName: "Chef" }, { referenceDate: "2026-05-18T07:00:00.000Z" });
assert.equal(revised.status, "confirmed");
assert.ok(new Date(revised.current) > new Date(initial.current), "la livraison révisée doit suivre le retard réel du planning");
assert.ok(item.deliveryEstimate.delayMinutes > 0);
assert.equal(item.deliveryEstimate.history[0].reason, "Peinture décalée");
assert.equal(item.deliveryEstimate.history[0].previous, initial.current);

run(`(() => {
  const booking = state.bookings.find((entry) => entry.id === "delivery-paint");
  booking.status = "blocked";
  booking.blockReason = "Pièce manquante";
})()`);
const blocked = context.recalculateEstimatedDelivery(item, "Pièce manquante", null, { referenceDate: "2026-05-18T07:00:00.000Z" });
assert.equal(blocked.status, "to_confirm");
assert.ok(blocked.reasonCodes.includes("blocked_task"));
assert.ok(blocked.reasons.some((reason) => reason.includes("Pièce manquante")));

run(`(() => {
  const body = state.bookings.find((entry) => entry.id === "delivery-body");
  const paint = state.bookings.find((entry) => entry.id === "delivery-paint");
  body.status = "completed";
  body.actualEnd = "2026-05-18T09:30:00.000Z";
  paint.status = "completed";
  paint.blockReason = "";
  paint.actualEnd = "2026-05-18T14:00:00.000Z";
})()`);
const completed = context.recalculateEstimatedDelivery(item, "Temps réels saisis", { userName: "Technicien" }, { referenceDate: "2026-05-18T14:05:00.000Z" });
assert.equal(completed.status, "confirmed");
assert.equal(completed.current, "2026-05-18T15:00:00.000Z");
assert.ok(item.deliveryEstimate.history.length >= 4, "chaque révision significative doit être historisée");

run(`state.cases.push(normalizeCase({
  id: "case-incomplete-delivery",
  clientName: "Planning incomplet",
  planningTasks: [{ id: "missing", key: "mechanical", title: "Diagnostic", durationMinutes: 0, requiredRole: "mecanicien" }]
}))`);
const incomplete = run('state.cases.find((entry) => entry.id === "case-incomplete-delivery")');
const toConfirm = context.recalculateEstimatedDelivery(incomplete, "Audit planning incomplet", null, { referenceDate: "2026-05-18T07:00:00.000Z" });
assert.equal(toConfirm.status, "to_confirm");
assert.ok(toConfirm.reasonCodes.includes("dependency_unplanned"));
assert.ok(toConfirm.reasonCodes.includes("missing_duration"));

console.log("ESTIMATED DELIVERY OK");
