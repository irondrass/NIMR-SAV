import assert from "node:assert/strict";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { context, run } = createNimrVmContext({ filename: "role-permissions-contract.js" });

const aliases = {
  admin: "admin_technique",
  "Administrateur technique": "admin_technique",
  "DIRECTEUR-SAV": "directeur",
  "chef atelier": "chef_atelier",
  "Réceptionnaire": "reception",
  technician: "technicien",
  "lecture seule": "lecture_seule",
  qualite: "lecture_seule",
};
Object.entries(aliases).forEach(([legacy, canonical]) => {
  assert.equal(context.normalizeUserRole(legacy), canonical, `${legacy} doit migrer vers ${canonical}`);
});

const empty = context.createDefaultState();
assert.equal(empty.users.length, 0, "aucun administrateur implicite ne doit être créé");
assert.equal(empty.currentUserId, "", "aucune session implicite ne doit être ouverte");

run("state = createDefaultState()");
const firstAccess = context.createFirstAccessUserLocal({
  id: "first-director",
  name: "Direction explicite",
  role: "directeur",
  pinHash: "hash-test",
  pinSalt: "salt-test",
});
assert.equal(firstAccess.ok, true, "le premier accès explicite doit créer le premier compte");
assert.equal(firstAccess.user.canonicalRole, "directeur");
assert.equal(run("state.currentUserId"), "first-director");
assert.equal(context.createFirstAccessUserLocal({ name: "Second", role: "admin", pinHash: "h", pinSalt: "s" }).ok, false, "le bootstrap doit être à usage unique");

run(`state = normalizeState({
  resources: [
    { id: "tech-1", name: "Technicien 1", role: "mecanicien", active: true },
    { id: "tech-2", name: "Technicien 2", role: "mecanicien", active: true }
  ],
  users: [
    { id: "admin", name: "Admin", role: "admin", active: true },
    { id: "director", name: "Directeur", role: "directeur_sav", active: true },
    { id: "chief", name: "Chef", role: "chef_atelier", active: true },
    { id: "front", name: "Réception", role: "reception", active: true },
    { id: "worker", name: "Technicien", role: "technicien", resourceId: "tech-1", active: true },
    { id: "reader", name: "Lecture", role: "readonly", active: true }
  ],
  currentUserId: "admin",
  cases: [{ id: "case-role", clientName: "Permissions" }],
  bookings: []
})`);

const matrix = [
  ["admin", "users.manage", true],
  ["admin", "supabase.configure", true],
  ["director", "users.manage", true],
  ["director", "planning.edit", true],
  ["chief", "planning.edit", true],
  ["chief", "users.manage", false],
  ["front", "case.create", true],
  ["front", "planning.edit", false],
  ["worker", "task.start", true],
  ["worker", "case.edit", false],
  ["reader", "case.view", true],
  ["reader", "case.edit", false],
];
matrix.forEach(([userId, permission, expected]) => {
  run(`state.currentUserId = ${JSON.stringify(userId)}`);
  assert.equal(context.hasPermission(permission), expected, `${userId} / ${permission}`);
});

run('state.currentUserId = "worker"');
const ownTask = {
  id: "own-task",
  caseId: "case-role",
  resourceIds: ["tech-1"],
  primaryResourceId: "tech-1",
  status: "planned",
};
const otherTask = { ...ownTask, id: "other-task", resourceIds: ["tech-2"], primaryResourceId: "tech-2" };
assert.equal(context.guardAction("task.start", { booking: ownTask }, { notify: false }).ok, true, "un technicien peut agir sur sa tâche");
assert.equal(context.guardAction("task.start", { booking: otherTask }, { notify: false }).ok, false, "un technicien ne peut pas agir sur la tâche d'un collègue");

run('state.currentUserId = "front"');
const spoofed = context.guardAction("users.manage", { user: "admin" }, { notify: false });
assert.equal(spoofed.ok, false, "un acteur fourni dans le contexte ne doit pas permettre d'usurper l'admin");
assert.equal(spoofed.message, "Action non autorisée pour le rôle utilisateur : reception");

console.log("ROLE PERMISSIONS OK");
