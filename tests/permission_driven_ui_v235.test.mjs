import assert from "node:assert/strict";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { context, run } = createNimrVmContext({
  filename: "permission-driven-ui-v235.js",
  scriptFiles: ["../../js/state.js", "../../js/utils.js", "../../js/ui-reception.js"],
});

run(`state = normalizeState({
  users: [
    { id: "admin", name: "Admin", role: "admin", active: true },
    { id: "director", name: "Direction", role: "directeur_sav", active: true },
    { id: "chef", name: "Chef", role: "chef_atelier", active: true },
    { id: "reception", name: "Réception", role: "reception", active: true },
    { id: "tech", name: "Technicien", role: "technicien", resourceId: "res-tech", active: true },
    { id: "qc", name: "Qualité", role: "controle_qualite", active: true },
    { id: "readonly", name: "Lecture", role: "readonly", active: true }
  ],
  currentUserId: "admin",
  cases: [{ id: "ui-case", clientName: "UI", flags: {}, customerClaims: [], receptionWorkflow: { qualityStatus: "not_started" } }],
  bookings: [],
  resources: [{ id: "res-tech", name: "Tech", role: "mecanicien", active: true }]
})`);

const expectations = {
  admin: {
    allow: ["users.manage", "settings.edit", "supabase.configure", "delivery.override"], deny: [],
  },
  director: {
    allow: ["export.backup", "supabase.status.view", "supabase.sync.use", "supabase.session.manage", "delivery.override"],
    deny: ["users.manage", "settings.edit", "supabase.configure", "supabase.restore", "import.backup"],
  },
  chef: {
    allow: ["planning.edit", "resource.manage", "task.override", "delivery.override"], deny: ["users.manage", "supabase.configure"],
  },
  reception: {
    allow: ["vehicle.receive", "delivery.complete"], deny: ["planning.edit", "resource.manage", "users.manage", "delivery.override"],
  },
  tech: {
    allow: ["task.start"], deny: ["planning.edit", "case.edit", "users.manage", "delivery.override"],
  },
  qc: {
    allow: ["dashboard.view", "case.view", "planning.view", "resource.view", "print.case", "quality.validate", "quality.reject", "quality.revalidate"],
    deny: ["planning.edit", "resource.manage", "case.create", "users.manage", "supabase.configure", "supabase.sync.use", "delivery.override"],
  },
  readonly: {
    allow: ["dashboard.view", "case.view", "planning.view", "resource.view", "print.case"],
    deny: ["quality.validate", "quality.reject", "quality.revalidate", "case.create", "planning.edit", "resource.manage", "users.manage", "delivery.override"],
  },
};
for (const [userId, matrix] of Object.entries(expectations)) {
  run(`state.currentUserId = ${JSON.stringify(userId)}`);
  const actionContext = userId === "tech" ? { booking: { caseId: "ui-case", resourceIds: ["res-tech"] } } : {};
  for (const permission of matrix.allow) {
    assert.equal(context.canRenderAction(permission, actionContext), true, `${userId}: UI doit autoriser ${permission}`);
    assert.equal(context.guardAction(permission, actionContext, { notify: false }).ok, true, `${userId}: guard doit autoriser ${permission}`);
  }
  for (const permission of matrix.deny) {
    assert.equal(context.canRenderAction(permission, actionContext), false, `${userId}: UI doit refuser ${permission}`);
    assert.equal(context.guardAction(permission, actionContext, { notify: false }).ok, false, `${userId}: guard doit refuser ${permission}`);
  }
}

run(`state.currentUserId = "qc"`);
const qcHtml = run("renderStep10_QualityCheck(state.cases[0])");
const qcForm = qcHtml.slice(qcHtml.indexOf('<form id="reception-quality-form"'), qcHtml.indexOf("</form>") + 7);
assert.doesNotMatch(qcForm, /disabled/u, "QC doit voir le formulaire qualité activé");

run(`state.currentUserId = "readonly"`);
const readonlyHtml = run("renderStep10_QualityCheck(state.cases[0])");
const readonlyForm = readonlyHtml.slice(readonlyHtml.indexOf('<form id="reception-quality-form"'), readonlyHtml.indexOf("</form>") + 7);
assert.match(readonlyForm, /disabled/u, "lecture seule ne doit pas voir les mutations qualité activées");

const claimCase = { id: "claim-case", plate: "AA-001", customerClaims: [{ status: "open", text: "Claim" }], flags: {} };
run('showConfirmModal = async () => true');
run('showTextPromptModal = async () => "Motif de dérogation"');
for (const userId of ["admin", "director", "chef"]) {
  run(`state.currentUserId = ${JSON.stringify(userId)}`);
  assert.equal((await run(`verifyDeliveryClaimsBlock(${JSON.stringify(claimCase)})`)), true, `${userId}: override réclamation doit être accepté`);
}
for (const userId of ["reception", "tech", "qc", "readonly"]) {
  run(`state.currentUserId = ${JSON.stringify(userId)}`);
  assert.equal((await run(`verifyDeliveryClaimsBlock(${JSON.stringify(claimCase)})`)), false, `${userId}: override réclamation doit rester bloqué`);
}

run('state.currentUserId = "director"');
assert.equal(context.isWorkshopManager(context.getCurrentUser()), true, "Director conserve task.override pour les actions d'atelier prévues");
run('state.currentUserId = "reception"');
assert.equal(context.isWorkshopManager(context.getCurrentUser()), false, "Reception ne peut pas bypasser les tâches technicien");

console.log("PERMISSION-DRIVEN UI OK");
