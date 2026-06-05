// tests/reception_guided_workflow_v231c.test.mjs
// Suite de tests pour le workflow guidé réception v23.1C
// Teste la machine d'état (getReceptionWorkflowStep, canAdvanceReceptionStep, advanceReceptionWorkflow)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const scriptFiles = [
  'js/utils.js', 'js/state.js', 'js/ui-cases.js', 'js/estimate-import.js',
  'js/ui-planning.js', 'js/ui-reception.js', 'js/photos.js', 'js/storage.js',
  'js/planning.js', 'js/exports.js', 'js/supabase-config.js',
  'js/supabase-client.js', 'js/supabase-sync.js', 'app.js',
  'js/business-rules-v2187.js',
];

const source = scriptFiles
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n')
  .replace(/initApp\(\);/, '// initApp skipped')
  .replace(/if \("serviceWorker" in navigator[\s\S]*$/u, '');

const elements = new Map();
function getOrCreateElement(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      id, value: '', textContent: '', innerHTML: '',
      hidden: false, dataset: { tab: id }, style: {}, children: [],
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        toggle(c, force) { if (force !== undefined) { force ? this.classes.add(c) : this.classes.delete(c); } else { if (this.classes.has(c)) this.classes.delete(c); else this.classes.add(c); } return this.classes.has(c); },
        contains(c) { return this.classes.has(c); }
      },
      setAttribute() {}, removeAttribute() {}, toggleAttribute() {},
      addEventListener() {}, append() {}, appendChild(el) { this.children.push(el); return el; },
      querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return this; }
    });
  }
  return elements.get(id);
}

const contextObject = {
  console, setTimeout, clearTimeout,
  newDate: (val) => val ? new Date(val) : new Date(),
  document: {
    getElementById: (id) => getOrCreateElement(id),
    querySelector: (sel) => { if (sel.startsWith('#')) return getOrCreateElement(sel.slice(1)); return getOrCreateElement(sel.replace('.', '')); },
    querySelectorAll: (sel) => { if (sel === '.nav-button') return [getOrCreateElement('btn-dossiers')]; return []; },
    addEventListener: () => {}
  },
  window: { addEventListener: () => {}, location: { reload: () => {} }, open: () => ({ document: { write: () => {}, close: () => {} } }) },
  navigator: { serviceWorker: { addEventListener: () => {} } },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  alert: () => {}, confirm: () => true, prompt: () => '',
  fetch: async () => ({ ok: true, json: async () => ({}) })
};

const context = vm.createContext(contextObject);
vm.runInContext(source, context);
context.saveState = () => {};
context.notifyUser = (msg, type) => console.log(`[Notification] ${type || 'info'}: ${msg}`);
context.render = () => {};
context.renderReceptionWorkspace = () => {};

function app(expr) { return vm.runInContext(expr, context); }

// Setup
app('state.cases = []; state.auditLog = [];');
app('state.users = [{ id: "u-reception", name: "Marie", role: "reception", active: true }, { id: "u-admin", name: "Chef", role: "admin", active: true }]');
app('state.currentUserId = "u-reception"');

// ─── Test 1 : Nouveau dossier — étape initiale = 2 ──────────────────────────
console.log('Test 1 — Étape initiale pour un nouveau dossier...');
app(`
  const item1 = normalizeCase({ id: "case-wf-1", clientName: "Alice Martin", vehicle: "Renault Clio", plate: "AB-001-CD", createdAt: new Date().toISOString() });
  state.cases.unshift(item1);
`);
const step1 = app('getReceptionWorkflowStep(state.cases[0])');
assert.equal(step1, 2, 'Un nouveau dossier doit être à l\'étape 2 (demande planning)');

const stepStatus1 = app('getReceptionStepStatus(state.cases[0], 1)');
assert.equal(stepStatus1, 'completed', 'L\'étape 1 (création) doit être completed');

const stepStatus2 = app('getReceptionStepStatus(state.cases[0], 2)');
assert.equal(stepStatus2, 'active', 'L\'étape 2 (planning) doit être active');

const stepStatus3 = app('getReceptionStepStatus(state.cases[0], 3)');
assert.equal(stepStatus3, 'pending', 'L\'étape 3 doit être pending');

const stepStatus5 = app('getReceptionStepStatus(state.cases[0], 5)');
assert.equal(stepStatus5, 'locked', 'L\'étape 5 doit être locked');

// ─── Test 2 : Demande de planning ────────────────────────────────────────────
console.log('Test 2 — Demande de planning (étape 2 → 3)...');
const r2 = app('advanceReceptionWorkflow("case-wf-1", "request_planning", { comment: "Client pressé, avant fin du mois" })');
assert.ok(r2.ok, 'La demande de planning doit réussir');

const caseAfterPlanning = app('state.cases[0]');
assert.ok(caseAfterPlanning.receptionWorkflow.planningRequestedAt, 'planningRequestedAt doit être défini');
assert.equal(caseAfterPlanning.receptionWorkflow.planningCycles, 1, 'planningCycles doit être 1 après première demande');
assert.equal(caseAfterPlanning.receptionWorkflow.planningComment, 'Client pressé, avant fin du mois', 'Le commentaire doit être enregistré');

const stepAfterPlanning = app('getReceptionWorkflowStep(state.cases[0])');
assert.equal(stepAfterPlanning, 3, 'Après demande planning, étape = 3');

// ─── Test 3 : Réception et acceptation du planning ───────────────────────────
console.log('Test 3 — Réception et acceptation planning (étape 3 → 4)...');
const r3a = app(`advanceReceptionWorkflow("case-wf-1", "receive_planning", {
  startDate: new Date(Date.now() + 86400000).toISOString(),
  deliveryDate: new Date(Date.now() + 3 * 86400000).toISOString(),
  workshopNote: "Créneaux disponibles"
})`);
assert.ok(r3a.ok, 'La réception du planning doit réussir');

const r3b = app('advanceReceptionWorkflow("case-wf-1", "accept_planning")');
assert.ok(r3b.ok, 'L\'acceptation du planning doit réussir');

const stepAfterAccept = app('getReceptionWorkflowStep(state.cases[0])');
assert.equal(stepAfterAccept, 4, 'Après acceptation planning, étape = 4');

// ─── Test 4 : Contact client ─────────────────────────────────────────────────
console.log('Test 4 — Contact client (étape 4 → 5)...');
const r4 = app(`advanceReceptionWorkflow("case-wf-1", "contact_customer", {
  outcome: "contacted",
  note: "Informé de la date de début"
})`);
assert.ok(r4.ok, 'Le contact client doit réussir');

const caseAfterContact = app('state.cases[0]');
assert.ok(caseAfterContact.receptionWorkflow.customerContactedAt, 'customerContactedAt doit être défini');
assert.equal(caseAfterContact.receptionWorkflow.customerContactHistory.length, 1, 'customerContactHistory doit avoir 1 entrée');

const stepAfterContact = app('getReceptionWorkflowStep(state.cases[0])');
assert.equal(stepAfterContact, 5, 'Après contact client, étape = 5');

// ─── Test 5 : Décision client — confirmation ─────────────────────────────────
console.log('Test 5 — Décision client : confirmation (étape 5 → 6)...');
const r5 = app(`advanceReceptionWorkflow("case-wf-1", "set_customer_decision", { decision: "confirmed" })`);
assert.ok(r5.ok, 'La confirmation client doit réussir');

const stepAfterDecision = app('getReceptionWorkflowStep(state.cases[0])');
assert.equal(stepAfterDecision, 6, 'Après confirmation client, étape = 6');

// ─── Test 6 : Confirmation RDV ────────────────────────────────────────────────
console.log('Test 6 — Confirmation RDV (étape 6 → 7)...');
const r6 = app(`advanceReceptionWorkflow("case-wf-1", "confirm_rdv", { channel: "phone", reminderSent: true, note: "RDV confirmé par téléphone" })`);
assert.ok(r6.ok, 'La confirmation RDV doit réussir');

const caseAfterRDV = app('state.cases[0]');
assert.ok(caseAfterRDV.receptionWorkflow.rdvConfirmedAt, 'rdvConfirmedAt doit être défini');
assert.equal(caseAfterRDV.receptionWorkflow.rdvChannel, 'phone', 'rdvChannel doit être phone');

const stepAfterRDV = app('getReceptionWorkflowStep(state.cases[0])');
assert.equal(stepAfterRDV, 7, 'Après confirmation RDV, étape = 7');

// ─── Test 7 : Réception physique du véhicule ─────────────────────────────────
console.log('Test 7 — Réception véhicule (étape 7 → 8)...');
const r7 = app(`advanceReceptionWorkflow("case-wf-1", "receive_vehicle", {
  mileage: "48000",
  accessories: "Carte grise",
  conditionNote: "Rayure portière arrière droite"
})`);
assert.ok(r7.ok, 'La réception véhicule doit réussir');

const caseAfterReceive = app('state.cases[0]');
assert.ok(caseAfterReceive.flags.received, 'flags.received doit être true');
assert.equal(caseAfterReceive.receptionWorkflow.vehicleMileageEntry, '48000', 'Kilométrage doit être enregistré');

const stepAfterReceive = app('getReceptionWorkflowStep(state.cases[0])');
assert.equal(stepAfterReceive, 8, 'Après réception véhicule, étape = 8');

// ─── Test 8 : Envoi atelier ───────────────────────────────────────────────────
console.log('Test 8 — Envoi atelier (étape 8 → 9)...');
const r8 = app(`advanceReceptionWorkflow("case-wf-1", "send_to_workshop", { note: "Priorité client" })`);
assert.ok(r8.ok, 'L\'envoi en atelier doit réussir');

const caseAfterWorkshop = app('state.cases[0]');
assert.ok(caseAfterWorkshop.receptionWorkflow.sentToWorkshopAt, 'sentToWorkshopAt doit être défini');
assert.ok(caseAfterWorkshop.flags.workStarted, 'flags.workStarted doit être true');

const stepAfterWorkshop = app('getReceptionWorkflowStep(state.cases[0])');
assert.equal(stepAfterWorkshop, 9, 'Après envoi atelier, étape = 9');

// ─── Test 9 : Note de suivi ───────────────────────────────────────────────────
console.log('Test 9 — Note de suivi (étape 9)...');
const r9 = app(`advanceReceptionWorkflow("case-wf-1", "add_followup_note", { text: "Travaux 50% avancés" })`);
assert.ok(r9.ok, 'La note de suivi doit réussir');

const caseAfterFollowup = app('state.cases[0]');
assert.equal(caseAfterFollowup.receptionWorkflow.followupNotes.length, 1, 'followupNotes doit avoir 1 entrée');

// Note de suivi sans texte doit échouer
const r9fail = app(`advanceReceptionWorkflow("case-wf-1", "add_followup_note", { text: "" })`);
assert.equal(r9fail.ok, false, 'La note vide doit être refusée');

// ─── Test 10 : Contrôle qualité (étape 9 → 10 → 11) ─────────────────────────
console.log('Test 10 — Contrôle qualité (étape 10)...');
// Simuler workCompleted pour déclencher passage à l'étape 10
app('state.cases[0].flags.workCompleted = true');

const stepAfterWorkCompleted = app('getReceptionWorkflowStep(state.cases[0])');
assert.equal(stepAfterWorkCompleted, 10, 'Après workCompleted, étape = 10');

const r10 = app(`advanceReceptionWorkflow("case-wf-1", "update_quality_status", { status: "validated" })`);
assert.ok(r10.ok, 'La validation qualité doit réussir');

const caseAfterQC = app('state.cases[0]');
assert.equal(caseAfterQC.receptionWorkflow.qualityStatus, 'validated', 'qualityStatus doit être validated');
assert.ok(caseAfterQC.flags.qualityApproved, 'flags.qualityApproved doit être true après QC validé');
assert.ok(caseAfterQC.receptionWorkflow.readyForDeliveryAt, 'readyForDeliveryAt doit être défini');

const stepAfterQC = app('getReceptionWorkflowStep(state.cases[0])');
assert.equal(stepAfterQC, 11, 'Après validation QC, étape = 11');

// ─── Test 11 : Boucle planning — 3 cycles max ────────────────────────────────
console.log('Test 11 — Boucle planning (3 cycles max)...');
app(`
  const item2 = normalizeCase({ id: "case-wf-cycles", clientName: "Bob Cycles", vehicle: "Peugeot 308", plate: "CD-002-EF", createdAt: new Date().toISOString() });
  state.cases.unshift(item2);
`);

// Cycle 1
app('advanceReceptionWorkflow("case-wf-cycles", "request_planning", { comment: "Cycle 1" })');
app('advanceReceptionWorkflow("case-wf-cycles", "receive_planning", { startDate: new Date().toISOString(), deliveryDate: new Date().toISOString() })');
app('advanceReceptionWorkflow("case-wf-cycles", "accept_planning")');
app('advanceReceptionWorkflow("case-wf-cycles", "contact_customer", { outcome: "contacted" })');
app('advanceReceptionWorkflow("case-wf-cycles", "set_customer_decision", { decision: "new_date" })');

const itemCycles = app('state.cases.find(c => c.id === "case-wf-cycles")');
assert.equal(itemCycles.receptionWorkflow.planningCycles, 1, 'planningCycles doit être 1 après cycle 1');

// Retour à l'étape 2 après révision
const stepAfterNewDate = app('getReceptionWorkflowStep(state.cases.find(c => c.id === "case-wf-cycles"))');
assert.equal(stepAfterNewDate, 2, 'Après demande nouvelle date, retour à étape 2');

// Cycle 2
app('advanceReceptionWorkflow("case-wf-cycles", "request_planning", { comment: "Cycle 2" })');
app('advanceReceptionWorkflow("case-wf-cycles", "receive_planning", { startDate: new Date().toISOString(), deliveryDate: new Date().toISOString() })');
app('advanceReceptionWorkflow("case-wf-cycles", "accept_planning")');
app('advanceReceptionWorkflow("case-wf-cycles", "contact_customer", { outcome: "contacted" })');

const r_newdate2 = app('advanceReceptionWorkflow("case-wf-cycles", "set_customer_decision", { decision: "new_date" })');
assert.ok(r_newdate2.ok, 'Le cycle 2 doit réussir');

// Cycle 3
app('advanceReceptionWorkflow("case-wf-cycles", "request_planning", { comment: "Cycle 3" })');
const item3rdCycle = app('state.cases.find(c => c.id === "case-wf-cycles")');
assert.equal(item3rdCycle.receptionWorkflow.planningCycles, 3, 'planningCycles doit être 3 après 3 cycles');

// Tentative de 4ème cycle — doit être bloquée
app('advanceReceptionWorkflow("case-wf-cycles", "receive_planning", { startDate: new Date().toISOString(), deliveryDate: new Date().toISOString() })');
app('advanceReceptionWorkflow("case-wf-cycles", "accept_planning")');
app('advanceReceptionWorkflow("case-wf-cycles", "contact_customer", { outcome: "contacted" })');
const rCycleMax = app('advanceReceptionWorkflow("case-wf-cycles", "set_customer_decision", { decision: "new_date" })');
assert.equal(rCycleMax.ok, false, 'Le 4ème cycle doit être refusé (max 3)');

// ─── Test 12 : Blocage livraison sans QC validé ───────────────────────────────
console.log('Test 12 — canAdvanceReceptionStep vérifie QC avant livraison...');
app(`
  const item3 = normalizeCase({ id: "case-wf-qc", clientName: "Eve QC", vehicle: "Citroën C3", plate: "EF-003-GH" });
  item3.receptionWorkflow.sentToWorkshopAt = new Date().toISOString();
  item3.flags.workCompleted = true;
  // qualityStatus reste "not_started"
  state.cases.unshift(item3);
`);

const actorReception = { role: 'reception' };
const canDeliver = app(`canAdvanceReceptionStep(state.cases.find(c => c.id === "case-wf-qc"), 11, { role: "reception" })`);
assert.equal(canDeliver.ok, false, 'La réception ne peut pas livrer sans QC validé');

// Admin peut outrepasser le QC non validé
const canDeliverAdmin = app(`canAdvanceReceptionStep(state.cases.find(c => c.id === "case-wf-qc"), 11, { role: "admin" })`);
assert.ok(canDeliverAdmin.ok, 'L\'admin peut livrer même sans QC validé');

// ─── Test 13 : Technicien ne peut pas avancer le workflow réception ───────────
console.log('Test 13 — Technicien bloqué sur le workflow réception...');
const canTech = app(`canAdvanceReceptionStep(state.cases[0], 2, { role: "technician" })`);
assert.equal(canTech.ok, false, 'Le technicien ne peut pas avancer le workflow réception');

// ─── Test 14 : Audit log généré pour chaque transition ────────────────────────
console.log('Test 14 — Audit log pour chaque transition...');
app('state.auditLog = []');
app(`advanceReceptionWorkflow("case-wf-1", "add_followup_note", { text: "Vérification audit" })`);
const auditFollowup = app(`state.auditLog.find(l => l.type === "reception.vehicle_status_followed")`);
assert.ok(auditFollowup, 'L\'audit log de suivi doit être enregistré');

// ─── Test 15 : normalizeReceptionWorkflow — valeurs par défaut ────────────────
console.log('Test 15 — normalizeReceptionWorkflow retourne des valeurs par défaut sûres...');
const rwDefault = app('normalizeReceptionWorkflow({})');
assert.equal(rwDefault.planningCycles, 0, 'planningCycles doit être 0 par défaut');
assert.equal(rwDefault.qualityStatus, 'not_started', 'qualityStatus doit être not_started par défaut');
assert.equal(rwDefault.deliverySheetSignedByClient, false, 'deliverySheetSignedByClient doit être false par défaut');
assert.equal(rwDefault.customerContactHistory.length, 0, 'customerContactHistory doit être vide par défaut');
assert.equal(rwDefault.followupNotes.length, 0, 'followupNotes doit être vide par défaut');

// planningCycles ne doit pas dépasser 3
const rwCapped = app('normalizeReceptionWorkflow({ planningCycles: 99 })');
assert.equal(rwCapped.planningCycles, 3, 'planningCycles doit être cappé à 3');

// ─── Test 16 : Fiche signée et livraison ─────────────────────────────────────
console.log('Test 16 — Fiche signée et livraison...');
const r16sign = app(`advanceReceptionWorkflow("case-wf-1", "mark_sheet_signed", { clientName: "Alice Martin" })`);
assert.ok(r16sign.ok, 'La signature doit réussir');
const caseAfterSign = app('state.cases.find(c => c.id === "case-wf-1")');
assert.ok(caseAfterSign.receptionWorkflow.deliverySheetSignedByClient, 'deliverySheetSignedByClient doit être true');
assert.equal(caseAfterSign.receptionWorkflow.deliverySheetClientName, 'Alice Martin', 'Nom signataire doit être Alice Martin');

console.log('\n✅ Tous les tests reception_guided_workflow_v231c ont réussi !');
