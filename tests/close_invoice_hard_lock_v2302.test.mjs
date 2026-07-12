import assert from "node:assert/strict";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { context, run } = createNimrVmContext({ filename: "workshop-close-hard-lock.js" });
run(`state = normalizeState({
  users: [
    { id: "chief-close", name: "Chef", role: "chef_atelier", active: true },
    { id: "front-close", name: "Réception", role: "reception", active: true }
  ],
  currentUserId: "chief-close",
  resources: [{ id: "tech-close", name: "Technicien", role: "mecanicien", active: true }],
  cases: [{
    id: "case-close",
    plate: "123 TU 4567",
    flags: { received: true },
    appointment: { start: "2026-06-02T08:00:00.000Z" },
    claims: [{ type: "client", includeInPlanning: true, estimate: { lines: [{ phase: "mechanical", laborHours: 1 }] } }]
  }],
  bookings: [{
    id: "booking-close",
    caseId: "case-close",
    key: "mechanical",
    title: "Réparation",
    resourceIds: ["tech-close"],
    start: "2026-06-02T08:00:00.000Z",
    end: "2026-06-02T09:00:00.000Z",
    segments: [{ start: "2026-06-02T08:00:00.000Z", end: "2026-06-02T09:00:00.000Z" }],
    status: "planned"
  }]
})`);
const item = run("state.cases[0]");
let result = context.applyWorkflowAction(item, "close");
assert.equal(result.ok, false);
assert.match(result.message, /Démarrer les travaux/u);

item.flags.workStarted = true;
result = context.applyWorkflowAction(item, "close");
assert.equal(result.ok, false);
assert.match(result.message, /Terminer les travaux|tâches atelier/u);

context.completeCaseWorkBookingsNow(item, new Date("2026-06-02T09:00:00.000Z"), { keepEmptyBookings: true, completedByOverride: "chief-close" });
result = context.applyWorkflowAction(item, "close");
assert.equal(result.ok, true);
assert.equal(context.isCaseReadonlyArchive(item), false);
assert.equal(context.getCaseStatus(item), "closed");
assert.equal(context.getCaseNextAction(item).code, "archive_case");

result = context.applyWorkflowAction(item, "archive");
assert.equal(result.ok, true);
assert.equal(context.isCaseReadonlyArchive(item), true);
assert.equal(context.guardCaseEdit(item, { notify: false }).ok, false);
assert.equal(context.getCaseStatus(item), "archived");
assert.equal(context.getCaseNextAction(item).code, "done");

run('state.currentUserId = "front-close"');
assert.equal(context.guardAction("case.close", { item: { id: "other" } }, { notify: false }).ok, false);
console.log("WORKSHOP CLOSE HARD LOCK OK");
