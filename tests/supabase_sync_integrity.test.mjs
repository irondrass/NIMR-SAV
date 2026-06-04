import assert from "node:assert/strict";
import fs from "node:fs";

console.log("Démarrage des tests intégrité Supabase Sync...");

// 1. Charger et évaluer les fonctions de js/supabase-sync.js et js/state.js
const utilsJs = fs.readFileSync("./js/utils.js", "utf8");
const syncJs = fs.readFileSync("./js/supabase-sync.js", "utf8");
const stateJs = fs.readFileSync("./js/state.js", "utf8");

// Mock global
global.APP_VERSION = "v22.33";
global.uid = (prefix) => `${prefix}-${Math.random().toString(36).substring(2)}`;
global.todayKey = () => "2026-06-03";
global.normalizeState = (s) => s;
global.isProtectedCase = (item) => Boolean(item?.flags?.delivered || item?.flags?.invoiced || item?.closedAt || item?.deletedAt);
global.getCurrentActor = () => ({ role: "admin" });

// Dummy eval context for state.js and supabase-sync.js
const evalContext = `
  ${utilsJs}
  ${stateJs.replace(/window\.getAggregatedActivityLog.*/, "").replace(/let state = loadState\(\);/, "let state = { cases: [], bookings: [], syncConflicts: [] };").replace(/function normalizeState\(/, "function _normalizeState(")}
  ${syncJs}
  module.exports = { mergeRemoteStateIntoLocal, mergeCaseEntity, getAggregatedActivityLog, getState: () => state, setState: (s) => state = s };
`;

const mod = { exports: {} };
new Function("module", "global", evalContext)(mod, global);
const { mergeRemoteStateIntoLocal, mergeCaseEntity, getAggregatedActivityLog, getState, setState } = mod.exports;

// Test 1: PC1 modifie téléphone local, PC2 modifie planning même OR
{
  const localCase = { id: "c1", orNavNumber: "OR-01", phone: "0600000000", flags: {} };
  const remoteCase = { id: "c1", orNavNumber: "OR-01", phone: "0600000000", flags: {} };
  const localState = { cases: [localCase], bookings: [], syncConflicts: [] };
  const remoteState = { cases: [remoteCase], bookings: [{ id: "b1", caseId: "c1", segments: [{ start: "2026-06-03T10:00", end: "2026-06-03T11:00" }] }], syncConflicts: [] };
  
  const result = mergeRemoteStateIntoLocal(localState, remoteState);
  assert.equal(result.state.cases[0].phone, "0600000000");
  assert.equal(result.state.bookings.length, 1);
}

// Test 2: PC1 téléphone, PC2 téléphone différent
{
  const localCase = { id: "c2", orNavNumber: "OR-02", phone: "0611111111", flags: {} };
  const remoteCase = { id: "c2", orNavNumber: "OR-02", phone: "0622222222", flags: {} };
  const localState = { cases: [localCase], bookings: [], syncConflicts: [] };
  const remoteState = { cases: [remoteCase], bookings: [], syncConflicts: [] };
  
  const result = mergeRemoteStateIntoLocal(localState, remoteState);
  assert.equal(result.state.cases[0].phone, "0611111111", "Téléphone local conservé");
  const phoneConflict = result.conflicts.find(c => c.field === "phone");
  assert.ok(phoneConflict, "syncConflict field phone créé");
  assert.equal(phoneConflict.decision, "needs_review");
}

// Test 3: Remote champ vide ne supprime pas VIN/plaque local
{
  const localCase = { id: "c3", orNavNumber: "OR-03", vin: "VIN123", plate: "AB-123-CD", flags: {} };
  const remoteCase = { id: "c3", orNavNumber: "OR-03", vin: "", plate: null, flags: {} };
  const localState = { cases: [localCase], bookings: [], syncConflicts: [] };
  const remoteState = { cases: [remoteCase], bookings: [], syncConflicts: [] };
  
  const result = mergeRemoteStateIntoLocal(localState, remoteState);
  assert.equal(result.state.cases[0].vin, "VIN123");
  assert.equal(result.state.cases[0].plate, "AB-123-CD");
  assert.ok(result.conflicts.some(c => c.field === "vin" && c.decision === "kept_local"), "champ VIN vide distant doit créer un conflit conservant local");
}

// Test 3B: Les champs réception/concession réels sont protégés
{
  const localCase = {
    id: "c3b",
    orNavNumber: "OR-03B",
    ownerName: "Société Alpha",
    driverName: "Khaled",
    driverPhone: "+216 22 333 444",
    insurance: "Assurance locale",
    arrivalNotes: "Rayure constatée à la réception",
    expertPhone: "+216 55 111 222",
    expertEmail: "expert-local@example.com",
    flags: {}
  };
  const remoteCase = {
    id: "c3b",
    orNavNumber: "OR-03B",
    ownerName: "Société Beta",
    driverName: "Autre déposant",
    driverPhone: "",
    insurance: "Assurance distante",
    arrivalNotes: "",
    expertPhone: "+216 99 000 000",
    expertEmail: "expert-cloud@example.com",
    flags: {}
  };
  const result = mergeRemoteStateIntoLocal({ cases: [localCase], bookings: [], syncConflicts: [] }, { cases: [remoteCase], bookings: [], syncConflicts: [] });
  const mergedCase = result.state.cases[0];
  assert.equal(mergedCase.ownerName, "Société Alpha", "propriétaire/société local conservé");
  assert.equal(mergedCase.driverName, "Khaled", "déposant local conservé");
  assert.equal(mergedCase.driverPhone, "+216 22 333 444", "téléphone déposant non vidé par cloud");
  assert.equal(mergedCase.insurance, "Assurance locale", "assurance locale conservée");
  assert.equal(mergedCase.arrivalNotes, "Rayure constatée à la réception", "notes réception non vidées par cloud");
  assert.equal(mergedCase.expertPhone, "+216 55 111 222", "téléphone expert local conservé");
  assert.equal(mergedCase.expertEmail, "expert-local@example.com", "email expert local conservé");
  ["ownerName", "driverName", "driverPhone", "insurance", "arrivalNotes", "expertPhone", "expertEmail"].forEach((field) => {
    assert.ok(result.conflicts.some(c => c.field === field), `conflit attendu pour ${field}`);
  });
}

// Test 4: Appointment local vs remote différent
{
  const localCase = { id: "c4", orNavNumber: "OR-04", appointment: "2026-06-03T10:00", flags: {} };
  const remoteCase = { id: "c4", orNavNumber: "OR-04", appointment: "2026-06-03T14:00", flags: {} };
  const localState = { cases: [localCase], bookings: [], syncConflicts: [] };
  const remoteState = { cases: [remoteCase], bookings: [], syncConflicts: [] };
  
  const result = mergeRemoteStateIntoLocal(localState, remoteState);
  assert.equal(result.state.cases[0].appointment, "2026-06-03T10:00");
  const apptConflict = result.conflicts.find(c => c.field === "appointment");
  assert.ok(apptConflict, "Conflit lisible créé pour appointment");
  assert.equal(apptConflict.localValue, "2026-06-03T10:00");
}

// Test 5: Dossier livré/facturé/clôturé ne régresse pas
{
  const localCase = { id: "c5", flags: { delivered: true }, phone: "123" };
  const remoteCase = { id: "c5", flags: { delivered: false }, phone: "456" };
  const localState = { cases: [localCase], bookings: [], syncConflicts: [] };
  const remoteState = { cases: [remoteCase], bookings: [], syncConflicts: [] };
  
  const result = mergeRemoteStateIntoLocal(localState, remoteState);
  assert.equal(result.state.cases[0].flags.delivered, true);
  assert.equal(result.state.cases[0].phone, "123");
}

// Test 8: syncConflict visible via getAggregatedActivityLog()
{
  setState({ syncConflicts: [
    { id: "c1", at: new Date().toISOString(), type: "case_field_conflict", caseNumber: "OR-99", field: "phone", decision: "needs_review", localValue: "111", remoteValue: "222" }
  ] });
  const logs = getAggregatedActivityLog(10, "admin");
  const phoneLog = logs.find(l => l.details.includes("champ phone") && l.details.includes("revue nécessaire"));
  assert.ok(phoneLog, "syncConflict est visible et lisible dans getAggregatedActivityLog");
}

console.log("Tests intégrité Supabase Sync validés avec succès.");
