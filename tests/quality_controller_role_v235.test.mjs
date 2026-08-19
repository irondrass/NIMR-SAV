import assert from "node:assert/strict";
import fs from "node:fs";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const stateSource = fs.readFileSync(new URL("../js/state.js", import.meta.url), "utf8");
assert.match(indexSource, /option value=["']controle_qualite["'][^>]*>Contrôleur Qualité/u);
assert.match(stateSource, /controle_qualite:\s*["']Contrôleur Qualité["']/u);

const { context, run } = createNimrVmContext({ filename: "quality-controller-role-v235.js" });

const roleAliases = {
  controle_qualite: "controle_qualite",
  qualite: "controle_qualite",
  readonly: "lecture_seule",
  lecture: "lecture_seule",
  "lecture seule": "lecture_seule",
  "read only": "lecture_seule",
  lecture_seule: "lecture_seule",
};
for (const [alias, canonical] of Object.entries(roleAliases)) {
  assert.equal(context.normalizeUserRole(alias), canonical, `${alias} doit normaliser vers ${canonical}`);
}

run(`state = normalizeState({
  users: [
    { id: "qc", name: "Contrôleur", role: "qualite", active: true },
    { id: "readonly", name: "Lecture seule", role: "lecture seule", active: true }
  ],
  currentUserId: "qc",
  cases: [],
  bookings: []
})`);
assert.equal(run(`state.users.find((user) => user.id === "qc").role`), "controle_qualite");
assert.equal(run(`state.users.find((user) => user.id === "qc").canonicalRole`), "controle_qualite");

run(`(() => {
  const nodes = new Map();
  nodes.set("sidebar-user-name", { textContent: "" });
  document.getElementById = (id) => nodes.get(id) || {
    textContent: "", checked: false,
    addEventListener() {}, setAttribute() {},
    closest: () => ({ style: {}, title: "" }),
  };
  state = normalizeState({
    users: [
      { id: "admin", name: "Admin", role: "admin", active: true },
      { id: "director", name: "Direction", role: "directeur_sav", active: true },
      { id: "chief", name: "Chef", role: "chef_atelier", active: true },
      { id: "front", name: "Réception", role: "reception", active: true },
      { id: "worker", name: "Technicien", role: "technicien", active: true },
      { id: "qc", name: "Contrôleur", role: "controle_qualite", active: true },
      { id: "qc-label", name: "Qualité", role: "qualite", active: true },
      { id: "reader", name: "Lecture", role: "readonly", active: true },
    ],
    currentUserId: "admin",
    cases: [],
    bookings: [],
  });
  globalThis.__qualityRoleLabelNodes = nodes;
})()`);
const sessionLabels = {
  admin: "Admin technique",
  director: "Directeur SAV",
  chief: "Chef atelier",
  front: "Réception",
  worker: "Technicien",
  "qc-label": "Contrôleur Qualité",
  reader: "Lecture seule",
};
for (const [userId, expectedLabel] of Object.entries(sessionLabels)) {
  run(`state.currentUserId = ${JSON.stringify(userId)}; renderCurrentSessionIndicator()`);
  assert.equal(run("__qualityRoleLabelNodes.get('sidebar-user-name').textContent"), `${userId === "qc-label" ? "Qualité" : userId === "admin" ? "Admin" : userId === "director" ? "Direction" : userId === "chief" ? "Chef" : userId === "front" ? "Réception" : userId === "worker" ? "Technicien" : "Lecture"} (${expectedLabel})`);
}
run(`state.currentUserId = "qc"`);

const qcAllowed = [
  "dashboard.view", "case.view", "planning.view", "resource.view", "print.case",
  "quality.validate", "quality.reject", "quality.revalidate",
];
const qcDenied = [
  "users.manage", "settings.edit", "supabase.access", "supabase.configure", "supabase.restore",
  "supabase.session.manage", "supabase.sync.use", "import.backup", "case.create", "estimate.import",
  "planning.edit", "resource.manage", "task.override", "notes.direction", "customer_claim.manage",
  "delivery.complete", "case.close", "appointment.schedule", "vehicle.receive", "financial.manage",
];
for (const permission of qcAllowed) {
  assert.equal(context.hasPermission(permission), true, `QC doit autoriser ${permission}`);
}
for (const permission of qcDenied) {
  assert.equal(context.hasPermission(permission), false, `QC doit refuser ${permission}`);
}

const qualityCase = {
  id: "quality-case",
  flags: { workCompleted: true, qualityApproved: false, delivered: false },
  customerClaims: [],
  receptionWorkflow: { qualityStatus: "not_started" },
};
run(`state.cases = [normalizeCase(${JSON.stringify(qualityCase)})]`);
assert.equal(run(`advanceReceptionWorkflow("quality-case", "update_quality_status", { status: "validated" }).ok`), true);
assert.equal(run(`state.cases[0].receptionWorkflow.qualityStatus`), "validated");
assert.equal(run(`advanceReceptionWorkflow("quality-case", "update_quality_status", { status: "rejected", reason: "Peinture à reprendre" }).ok`), true);
assert.equal(run(`state.cases[0].receptionWorkflow.qualityStatus`), "rejected");
assert.equal(run(`advanceReceptionWorkflow("quality-case", "update_quality_status", { status: "validated" }).ok`), true);
assert.equal(run(`state.cases[0].receptionWorkflow.qualityStatus`), "validated");

run(`state.currentUserId = "readonly"`);
assert.equal(context.hasPermission("quality.validate"), false);
assert.equal(context.hasPermission("quality.reject"), false);
assert.equal(context.hasPermission("quality.revalidate"), false);
run(`state.cases = [normalizeCase(${JSON.stringify(qualityCase)})]`);
assert.equal(run(`advanceReceptionWorkflow("quality-case", "update_quality_status", { status: "validated" }).ok`), false, "lecture seule ne doit pas valider le contrôle qualité");
assert.equal(run(`state.cases[0].receptionWorkflow.qualityStatus`), "not_started");
for (const permission of qcDenied.concat(["quality.validate", "quality.reject", "quality.revalidate"])) {
  assert.equal(context.hasPermission(permission), false, `lecture seule doit refuser ${permission}`);
}

console.log("QUALITY CONTROLLER ROLE OK");
