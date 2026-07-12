import assert from "node:assert/strict";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { context, run } = createNimrVmContext({ filename: "pdf-first-status-contract.js" });
run(`state = normalizeState({
  users: [{ id: "chief-status", name: "Chef", role: "chef_atelier", active: true }],
  currentUserId: "chief-status",
  cases: [{
    id: "case-status",
    source: "pdf_estimate",
    pdfImportStatus: "chief_validation_pending",
    plate: "123 TU 4567",
    claims: [{ type: "client", includeInPlanning: true, estimate: { lines: [{ phase: "body", laborHours: 1 }] } }]
  }]
})`);
const item = run("state.cases[0]");
assert.equal(context.getCaseStatus(item), "chief_validation");
assert.equal(context.getCaseNextAction(item).code, "validate_pdf_work");
item.pdfImportStatus = "ready_for_planning";
assert.equal(context.getNextWorkflowAction(item), "appointment");
item.appointment = { start: "2026-08-01T08:00:00.000Z" };
assert.equal(context.getNextWorkflowAction(item), "received");
console.log("PDF FIRST WORKFLOW STATUS OK");
