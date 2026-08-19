import assert from "node:assert/strict";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { context, run } = createNimrVmContext({ filename: "canonical-roles-statuses-v236.js" });

const roleCases = {
  admin: "admin_technique",
  "admin technique": "admin_technique",
  administrateur: "admin_technique",
  directeur_sav: "directeur",
  "directeur sav": "directeur",
  direction: "directeur",
  "chef atelier": "chef_atelier",
  receptionnaire: "reception",
  technician: "technicien",
  qualite: "controle_qualite",
  "quality controller": "controle_qualite",
  readonly: "lecture_seule",
  "lecture seule": "lecture_seule",
};

for (const [legacyRole, canonicalRole] of Object.entries(roleCases)) {
  const user = JSON.parse(run(`JSON.stringify(normalizeUser({ id: "u", name: "Test", role: ${JSON.stringify(legacyRole)} }))`));
  assert.equal(user.role, canonicalRole, `${legacyRole} doit être persisté sous sa forme canonique`);
  assert.equal(user.canonicalRole, canonicalRole, `${legacyRole} doit conserver son identité canonique`);
  assert.equal("runtimeRole" in user, false, `${legacyRole} ne doit pas persister runtimeRole`);
  assert.equal(run(`toRuntimeUserRole(${JSON.stringify(canonicalRole)})`), canonicalRole === "admin_technique" ? "admin" : canonicalRole === "directeur" ? "directeur_sav" : canonicalRole === "lecture_seule" ? "readonly" : canonicalRole, `${canonicalRole} doit conserver sa clé runtime compatible`);
}

const roundTrip = JSON.parse(run(`JSON.stringify(normalizeState({ users: [{ id: "legacy", name: "Legacy", role: "directeur_sav" }], resources: [], cases: [], bookings: [] }))`));
const roundTripAgain = JSON.parse(run(`JSON.stringify(normalizeState(${JSON.stringify(roundTrip)}, { skipMigration: true }))`));
assert.equal(roundTrip.users[0].role, "directeur");
assert.equal(roundTripAgain.users[0].role, "directeur");
assert.equal(roundTripAgain.users[0].canonicalRole, "directeur");
assert.equal("runtimeRole" in roundTrip.users[0], false);
assert.equal("runtimeRole" in roundTripAgain.users[0], false);

const staleRuntimeRole = JSON.parse(run(`JSON.stringify(normalizeUser({ id: "stale", name: "Stale", role: "directeur", runtimeRole: "admin" }))`));
assert.equal(staleRuntimeRole.role, "directeur", "runtimeRole obsolète ne doit pas changer l'identité canonique");
assert.equal("runtimeRole" in staleRuntimeRole, false, "runtimeRole obsolète doit être supprimé à la normalisation");

const receptionStaleAdmin = JSON.parse(run(`JSON.stringify(normalizeUser({ id: "reception", name: "Reception", role: "reception", canonicalRole: "admin_technique" }))`));
assert.equal(receptionStaleAdmin.role, "reception");
assert.equal(receptionStaleAdmin.canonicalRole, "reception");
assert.equal(run(`getCanonicalUserRole(${JSON.stringify(receptionStaleAdmin)})`), "reception");
assert.equal(run(`hasPermission("users.manage", { user: ${JSON.stringify(receptionStaleAdmin)} })`), false);
assert.equal(run(`hasPermission("settings.edit", { user: ${JSON.stringify(receptionStaleAdmin)} })`), false);
assert.equal(run(`hasPermission("supabase.configure", { user: ${JSON.stringify(receptionStaleAdmin)} })`), false);
assert.equal(run(`hasPermission("supabase.restore", { user: ${JSON.stringify(receptionStaleAdmin)} })`), false);
assert.equal(run(`hasPermission("import.backup", { user: ${JSON.stringify(receptionStaleAdmin)} })`), false);

const readonlyStaleAdmin = JSON.parse(run(`JSON.stringify(normalizeUser({ id: "readonly", name: "Readonly", role: "lecture_seule", canonicalRole: "admin_technique" }))`));
assert.equal(readonlyStaleAdmin.role, "lecture_seule");
assert.equal(readonlyStaleAdmin.canonicalRole, "lecture_seule");
assert.equal(run(`getCanonicalUserRole(${JSON.stringify(readonlyStaleAdmin)})`), "lecture_seule");
assert.equal(run(`hasPermission("settings.edit", { user: ${JSON.stringify(readonlyStaleAdmin)} })`), false);
assert.equal(run(`hasPermission("case.create", { user: ${JSON.stringify(readonlyStaleAdmin)} })`), false);

const legacyDirectorConflict = JSON.parse(run(`JSON.stringify(normalizeUser({ id: "director", name: "Director", role: "directeur_sav", canonicalRole: "admin_technique" }))`));
assert.equal(legacyDirectorConflict.role, "directeur");
assert.equal(legacyDirectorConflict.canonicalRole, "directeur");
const canonicalOnlyDirector = JSON.parse(run(`JSON.stringify(normalizeUser({ id: "director-only", name: "Director", canonicalRole: "directeur" }))`));
assert.equal(canonicalOnlyDirector.role, "directeur");
assert.equal(canonicalOnlyDirector.canonicalRole, "directeur");
const unknownRoleConflict = JSON.parse(run(`JSON.stringify(normalizeUser({ id: "unknown", name: "Unknown", role: "not-a-real-role", canonicalRole: "admin_technique" }))`));
assert.equal(unknownRoleConflict.role, "lecture_seule", "un rôle explicite inconnu doit échouer fermé");
assert.equal(unknownRoleConflict.canonicalRole, "lecture_seule");
assert.equal(run(`hasPermission("users.manage", { user: ${JSON.stringify(unknownRoleConflict)} })`), false);

const conflictingState = JSON.parse(run(`JSON.stringify(normalizeState({ users: [{ id: "conflict", name: "Conflict", role: "reception", canonicalRole: "admin_technique" }], resources: [], cases: [], bookings: [] }))`));
const conflictingStateAgain = JSON.parse(run(`JSON.stringify(normalizeState(${JSON.stringify(conflictingState)}, { skipMigration: true }))`));
assert.equal(conflictingState.users[0].role, "reception");
assert.equal(conflictingState.users[0].canonicalRole, conflictingState.users[0].role);
assert.equal(conflictingStateAgain.users[0].role, "reception");
assert.equal(conflictingStateAgain.users[0].canonicalRole, conflictingStateAgain.users[0].role);
assert.equal("runtimeRole" in conflictingState.users[0], false);
assert.equal("runtimeRole" in conflictingStateAgain.users[0], false);

run(`state = normalizeState({
  users: [
    { id: "admin", name: "Admin", role: "admin_technique", active: true },
    { id: "director", name: "Director", role: "directeur", active: true },
    { id: "chief", name: "Chief", role: "chef_atelier", active: true },
    { id: "reception", name: "Reception", role: "reception", active: true },
    { id: "technician", name: "Technician", role: "technicien", active: true },
    { id: "qc", name: "QC", role: "controle_qualite", active: true },
    { id: "readonly", name: "Readonly", role: "lecture_seule", active: true }
  ],
  currentUserId: "admin",
  auditLog: [],
  cases: [],
  resources: [],
  bookings: []
})`);
for (const [id, role] of Object.entries({ admin: "admin_technique", director: "directeur", chief: "chef_atelier", reception: "reception", technician: "technicien", qc: "controle_qualite", readonly: "lecture_seule" })) {
  assert.equal(run(`updateUserLocal(${JSON.stringify(id)}, { name: ${JSON.stringify(id)}, role: ${JSON.stringify(role)}, active: true }).ok`), true);
  assert.equal(run(`state.users.find((user) => user.id === ${JSON.stringify(id)}).role`), role);
  assert.equal(run(`"runtimeRole" in state.users.find((user) => user.id === ${JSON.stringify(id)})`), false);
}
const auditBeforeSameRole = JSON.parse(run(`JSON.stringify(state.auditLog.filter((entry) => entry.type === "users.role_changed"))`));
assert.equal(run(`updateUserLocal("director", { name: "Director", role: "directeur", active: true }).ok`), true);
assert.equal(run(`state.auditLog.filter((entry) => entry.type === "users.role_changed").length`), auditBeforeSameRole.length, "un rôle équivalent ne doit pas créer un faux changement");
assert.equal(run(`updateUserLocal("director", { name: "Director", role: "chef_atelier", active: true }).ok`), true);
assert.equal(run(`state.auditLog.filter((entry) => entry.type === "users.role_changed").length`), auditBeforeSameRole.length + 1, "un vrai changement doit être journalisé");
assert.match(run(`state.auditLog.find((entry) => entry.type === "users.role_changed").label`), /Directeur|Director/u);

const canonicalCaseStatuses = ["chief_validation", "planning", "in_progress", "completed", "closed", "archived"];
for (const status of canonicalCaseStatuses) assert.equal(run(`normalizeCaseStatus(${JSON.stringify(status)})`), status);
const caseStatusAliases = {
  estimate: "chief_validation",
  receptionDraft: "chief_validation",
  receptiondraft: "chief_validation",
  reception: "chief_validation",
  approvals: "chief_validation",
  pdfChiefValidation: "chief_validation",
  pdfchiefvalidation: "chief_validation",
  appointment: "planning",
  appointmentScheduled: "planning",
  appointmentscheduled: "planning",
  noShow: "planning",
  noshow: "planning",
  awaitingVehicle: "planning",
  awaitingvehicle: "planning",
  vehicleReceived: "in_progress",
  vehiclereceived: "in_progress",
  workScheduled: "in_progress",
  workscheduled: "in_progress",
  work: "in_progress",
  quality: "completed",
  qualityRejected: "in_progress",
  qualityRework: "in_progress",
  delivered: "closed",
  invoiced: "closed",
};
for (const [alias, canonical] of Object.entries(caseStatusAliases)) {
  assert.equal(run(`normalizeCaseStatus(${JSON.stringify(alias)})`), canonical, `alias case ${alias}`);
}
assert.equal(run("normalizeCaseStatus(null)"), "chief_validation");
assert.equal(run("normalizeCaseStatus('')"), "chief_validation");
assert.equal(run("normalizeCaseStatus('unknown_status')"), "chief_validation");

assert.equal(run("normalizeCaseStatus('vehicleReceived')"), "in_progress");
assert.equal(run("normalizeWorkshopCaseStatus('vehiclereceived', {})"), "planning");
assert.equal(run("normalizeCaseStatus('invoiced')"), "closed");
assert.equal(run("normalizeWorkshopCaseStatus('invoiced', {})"), "archived");

for (const status of ["not_started", "in_progress", "validated", "rejected", "rework"]) {
  assert.equal(run(`normalizeQualityStatus(${JSON.stringify(status)})`), status);
}
for (const [alias, canonical] of Object.entries({
  pending: "not_started",
  approved: "validated",
  refused: "rejected",
  return_to_workshop: "rework",
})) {
  assert.equal(run(`normalizeQualityStatus(${JSON.stringify(alias)})`), canonical, `alias qualité ${alias}`);
}
assert.equal(run("normalizeQualityStatus(null)"), "not_started");
assert.equal(run("normalizeQualityStatus('unknown_quality')"), "not_started");

run(`state = normalizeState({
  users: [{ id: "qc", name: "QC", role: "controle_qualite", active: true }],
  currentUserId: "qc",
  cases: [{ id: "quality-case", flags: {}, receptionWorkflow: { qualityStatus: "approved", qualityReviewHistory: [] } }],
  resources: [],
  bookings: []
})`);
assert.equal(run(`state.cases[0].receptionWorkflow.qualityStatus`), "validated", "approved doit devenir validated au chargement");
assert.equal(run(`advanceReceptionWorkflow("quality-case", "update_quality_status", { status: "rejected", reason: "Défaut détecté" }).ok`), true);
assert.equal(run(`state.cases[0].receptionWorkflow.qualityStatus`), "rejected");
assert.equal(run(`advanceReceptionWorkflow("quality-case", "update_quality_status", { status: "validated", reason: "Contrôle repris" }).ok`), true);
assert.equal(run(`state.cases[0].receptionWorkflow.qualityStatus`), "validated");

console.log("CANONICAL ROLES AND STATUSES OK");
