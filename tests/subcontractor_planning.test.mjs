import assert from "node:assert/strict";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { context, run } = createNimrVmContext({ filename: "subcontractor-planning-contract.js" });
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
    { id: "paint-internal", name: "Peintre interne", role: "peintre", active: true, calendar },
    { id: "booth-internal", name: "Cabine interne", role: "cabine", active: true, calendar },
    { id: "carrier", name: "Convoyeur", role: "transport", active: true, calendar },
    {
      id: "paint-external",
      name: "Partenaire peinture",
      role: "peintre",
      category: "peintre",
      kind: "external",
      site: "external",
      external: true,
      active: true,
      capacity: 1,
      calendar,
      transportResourceId: "carrier",
      outboundTransferMinutes: 30,
      returnTransferMinutes: 30,
      standardLeadTimeMinutes: 180
    }
  ],
  users: [{ id: "chief-sub", name: "Chef sous-traitance", role: "chef_atelier", active: true }],
  currentUserId: "chief-sub",
  cases: [{ id: "case-sub", clientName: "Sous-traitance", vehicle: "Véhicule test", plate: "123 TU 4567" }],
  bookings: [{
    id: "paint-internal-busy",
    caseId: "another-case",
    key: "paint",
    title: "Occupation peintre",
    resourceIds: ["paint-internal"],
    start: "2026-05-18T07:00:00.000Z",
    end: "2026-05-18T16:00:00.000Z",
    segments: [
      { start: "2026-05-18T07:00:00.000Z", end: "2026-05-18T11:00:00.000Z" },
      { start: "2026-05-18T12:00:00.000Z", end: "2026-05-18T16:00:00.000Z" }
    ],
    status: "planned"
  }]
})})`);

const item = run('state.cases.find((entry) => entry.id === "case-sub")');
const task = {
  id: "external-paint-task",
  taskId: "external-paint-task",
  key: "paint",
  title: "Peinture complète",
  durationMinutes: 120,
  requiredRole: "peintre",
  requiredCategory: "peintre",
  serviceMode: "external",
};
const start = new Date("2026-05-18T08:00:00.000Z");

const preview = context.buildSubcontractPlan(item, task, "paint-external", start, run("state.bookings"));
assert.deepEqual(Array.from(preview.steps, (step) => step.subcontractPhase), [
  "subcontract_transfer_out",
  "subcontract_work",
  "subcontract_transfer_return",
]);
assert.ok(new Date(preview.steps[1].start) >= new Date(preview.steps[0].end), "le travail externe suit le transfert aller");
assert.ok(new Date(preview.steps[2].start) >= new Date(preview.steps[1].end), "le retour suit le travail externe");
assert.equal(preview.workMinutes, 180, "le délai standard du sous-traitant doit primer sur la durée plus courte");

run(`state.cases.push(normalizeCase({
  id: "case-external-mode",
  clientName: "Choix externe UI",
  durations: { paint: 2 },
  stepExecutionModes: { paint: "external" },
  stepSubcontractorIds: { paint: "paint-external" }
}))`);
const externalModeCase = run('state.cases.find((entry) => entry.id === "case-external-mode")');
const externalModeProposal = context.generateSingleProposal(externalModeCase, start);
assert.deepEqual(
  Array.from(externalModeProposal.steps, (step) => step.subcontractPhase),
  ["subcontract_transfer_out", "subcontract_work", "subcontract_transfer_return"],
  "le choix externe persisté dans le dossier doit piloter le planning réel",
);

const comparison = context.chooseTaskServicePlan(item, { ...task, serviceMode: "auto" }, start, { allowExternal: true });
assert.ok(comparison.alternatives.some((choice) => choice.mode === "internal"), "l'option interne doit être comparée");
assert.ok(comparison.alternatives.some((choice) => choice.mode === "external"), "l'option externe doit être comparée");
assert.equal(comparison.selected.mode, "external", "le partenaire disponible doit être proposé avant le peintre interne saturé");

const reserved = context.reserveSubcontractPlan(item, task, "paint-external", start, { reason: "Capacité interne saturée" });
assert.equal(reserved.ok, true, reserved.message || "la sous-traitance doit être réservée");
assert.equal(reserved.bookings.length, 3);
assert.equal(reserved.assignment.providerId, "paint-external");
assert.equal(item.subcontracting.assignments.length, 1);
assert.deepEqual(Array.from(context.findPlanningConflicts(run("state.bookings"))), [], "les transports et le travail externe ne doivent pas se chevaucher");

const originalReturn = reserved.assignment.plannedReturnAt;
const delayed = context.updateSubcontractDelay(item, reserved.assignment.id, 60, "Cabine partenaire indisponible");
assert.equal(delayed.ok, true, delayed.message || "le retard doit être enregistré");
assert.equal(delayed.assignment.status, "delayed");
assert.ok(new Date(delayed.assignment.plannedReturnAt) > new Date(originalReturn), "le retour prévu doit être décalé");
assert.ok(item.deliveryEstimate.reasonCodes.includes("subcontractor_delay"), "le retard doit rendre la livraison à confirmer");

const departure = context.recordSubcontractDeparture(item, reserved.assignment.id, "2026-05-18T09:00:00.000Z");
const receipt = context.recordSubcontractReceipt(item, reserved.assignment.id, "2026-05-18T09:30:00.000Z");
const returned = context.recordSubcontractReturn(item, reserved.assignment.id, "2026-05-18T14:30:00.000Z");
assert.equal(departure.ok, true);
assert.equal(receipt.ok, true);
assert.equal(returned.ok, true);
assert.equal(returned.assignment.status, "returned");
assert.equal(returned.assignment.actualDepartureAt, "2026-05-18T09:00:00.000Z");
assert.equal(returned.assignment.actualReceivedAt, "2026-05-18T09:30:00.000Z");
assert.equal(returned.assignment.actualReturnAt, "2026-05-18T14:30:00.000Z");
assert.ok(returned.assignment.history.length >= 4, "la chronologie sous-traitant doit être historisée");

console.log("SUBCONTRACTOR PLANNING OK");
