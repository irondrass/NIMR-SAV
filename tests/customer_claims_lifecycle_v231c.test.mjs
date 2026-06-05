// tests/customer_claims_lifecycle_v231c.test.mjs
// Tests cycle de vie réclamations/demandes client v23.1C
// Inclut le nouveau champ "type" (claim/request), "title" et "description"

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
      id, value: '', textContent: '', innerHTML: '', hidden: false,
      dataset: { tab: id }, style: {}, children: [],
      classList: { classes: new Set(), add(c) { this.classes.add(c); }, remove(c) { this.classes.delete(c); }, contains(c) { return this.classes.has(c); } },
      setAttribute() {}, removeAttribute() {}, addEventListener() {}, append() {}, appendChild(el) { this.children.push(el); return el; },
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
    querySelectorAll: () => [],
    addEventListener: () => {}
  },
  window: { addEventListener: () => {}, location: { reload: () => {} }, open: () => ({ document: { write() {}, close() {} } }) },
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
app('state.users = [{ id: "u-rec", name: "Marc", role: "reception", active: true }]');
app('state.currentUserId = "u-rec"');

app(`
  const caseLC = normalizeCase({
    id: "case-lc-1",
    clientName: "Sophie Bernard",
    vehicle: "Volkswagen Golf",
    plate: "IJ-789-KL",
    createdAt: new Date().toISOString()
  });
  state.cases.unshift(caseLC);
  activeCaseId = "case-lc-1";
`);

// ─── Test 1 : normalizeCustomerClaim — champs v23.1C ─────────────────────────
console.log('Test 1 — normalizeCustomerClaim inclut type, title, description...');
const claimNorm = app(`normalizeCustomerClaim({
  type: "request",
  title: "Vérifier freins",
  text: "Vérifier freins",
  description: "Bruit lors du freinage à haute vitesse",
  priority: "high",
  status: "open"
})`);

assert.equal(claimNorm.type, 'request', 'type doit être request');
assert.equal(claimNorm.title, 'Vérifier freins', 'title doit être défini');
assert.equal(claimNorm.text, 'Vérifier freins', 'text doit être défini');
assert.equal(claimNorm.description, 'Bruit lors du freinage à haute vitesse', 'description doit être défini');
assert.equal(claimNorm.priority, 'high', 'priority doit être high');
assert.equal(claimNorm.status, 'open', 'status doit être open');
assert.ok(claimNorm.id, 'id doit être auto-généré');

// Type par défaut = claim
const claimDefault = app(`normalizeCustomerClaim({ text: "Problème" })`);
assert.equal(claimDefault.type, 'claim', 'Le type par défaut doit être claim');

// Type invalide → claim
const claimInvalidType = app(`normalizeCustomerClaim({ type: "invalid", text: "Test" })`);
assert.equal(claimInvalidType.type, 'claim', 'Un type invalide doit être normalisé vers claim');

// Priorité invalide → normal
const claimInvalidPriority = app(`normalizeCustomerClaim({ text: "Test", priority: "extreme" })`);
assert.equal(claimInvalidPriority.priority, 'normal', 'Une priorité invalide doit être normalisée vers normal');

// ─── Test 2 : handleAddCustomerClaim avec type ────────────────────────────────
console.log('Test 2 — handleAddCustomerClaim avec type claim/request...');
app('handleAddCustomerClaim("case-lc-1", "Bruits de caisse", "urgent", "claim")');
app('handleAddCustomerClaim("case-lc-1", "Nettoyage intérieur", "low", "request")');

const caseLC = app('state.cases[0]');
assert.equal(caseLC.customerClaims.length, 2, 'Doit avoir 2 réclamations');
assert.equal(caseLC.customerClaims[0].type, 'claim', 'Première : type claim');
assert.equal(caseLC.customerClaims[1].type, 'request', 'Deuxième : type request');

const claimAudit = app('state.auditLog.find(l => l.type === "customer_claim.created")');
assert.ok(claimAudit, 'L\'audit de création doit être présent');

// ─── Test 3 : Changements de statut ───────────────────────────────────────────
console.log('Test 3 — Changements de statut des réclamations...');
const claimId0 = app('state.cases[0].customerClaims[0].id');
app(`handleClaimStatusChange("case-lc-1", "${claimId0}", "in_progress")`);
assert.equal(app('state.cases[0].customerClaims[0].status'), 'in_progress', 'Statut doit être in_progress');

app(`handleClaimStatusChange("case-lc-1", "${claimId0}", "resolved")`);
const resolvedClaim = app('state.cases[0].customerClaims[0]');
assert.equal(resolvedClaim.status, 'resolved', 'Statut doit être resolved');
assert.ok(resolvedClaim.resolvedAt, 'resolvedAt doit être défini');
assert.ok(resolvedClaim.resolvedBy, 'resolvedBy doit être défini');

// ─── Test 4 : Explication au client ───────────────────────────────────────────
console.log('Test 4 — Explication au client...');
const claimId1 = app('state.cases[0].customerClaims[1].id');
app(`handleExplainClaim("case-lc-1", "${claimId1}")`);

const explainedClaim = app('state.cases[0].customerClaims[1]');
assert.equal(explainedClaim.status, 'explained_to_customer', 'Statut doit être explained_to_customer');
assert.equal(explainedClaim.comments.length, 1, 'Un commentaire automatique doit être ajouté');
assert.equal(explainedClaim.comments[0].text, 'Explication fournie au client.', 'Le commentaire doit être le texte automatique');

const explainAudit = app('state.auditLog.filter(l => l.type === "customer_claim.status_changed")');
assert.ok(explainAudit.length >= 1, 'L\'audit de changement de statut doit être présent');

// ─── Test 5 : Commentaires sur réclamation ────────────────────────────────────
console.log('Test 5 — Commentaires sur réclamation...');
app(`handleAddClaimComment("case-lc-1", "${claimId0}", "Pièce commandée, arrivée demain")`);

const claimWithComment = app(`state.cases[0].customerClaims.find(c => c.id === "${claimId0}")`);
const commentsCount = claimWithComment.comments.length;
assert.ok(commentsCount >= 1, 'La réclamation doit avoir au moins 1 commentaire');

const lastComment = claimWithComment.comments[commentsCount - 1];
assert.equal(lastComment.text, 'Pièce commandée, arrivée demain', 'Le texte du commentaire doit correspondre');
assert.ok(lastComment.createdAt, 'createdAt doit être défini sur le commentaire');
assert.ok(lastComment.createdBy, 'createdBy doit être défini sur le commentaire');

const commentAudit = app('state.auditLog.find(l => l.type === "customer_claim.comment_added")');
assert.ok(commentAudit, 'L\'audit de commentaire doit être présent');

// ─── Test 6 : Inclusion dans la fiche de livraison ───────────────────────────
console.log('Test 6 — Les réclamations apparaissent dans la fiche de livraison...');
// Vérifier que canAdvanceReceptionStep étape 11 bloque si réclamation open
app('state.cases[0].receptionWorkflow.qualityStatus = "validated"');
app('state.cases[0].customerClaims[0].status = "open"'); // reset pour test

const canDeliverReception = app(`canAdvanceReceptionStep(state.cases[0], 11, { role: "reception" })`);
assert.equal(canDeliverReception.ok, false, 'La réception ne peut pas livrer avec réclamation ouverte');
assert.ok(canDeliverReception.message.includes('réclamation'), 'Le message doit mentionner les réclamations');

// Admin peut outrepasser
const canDeliverAdmin = app(`canAdvanceReceptionStep(state.cases[0], 11, { role: "admin" })`);
assert.ok(canDeliverAdmin.ok, 'L\'admin peut livrer même avec réclamation ouverte');

// ─── Test 7 : Aucune réclamation — pas de blocage ────────────────────────────
console.log('Test 7 — Aucune réclamation active → livraison non bloquée...');
app(`
  const caseNoBlock = normalizeCase({
    id: "case-no-block",
    clientName: "Test No Block",
    vehicle: "Tesla Model 3",
    plate: "MN-012-OP",
    createdAt: new Date().toISOString()
  });
  caseNoBlock.customerClaims = [
    normalizeCustomerClaim({ text: "Réclamation résolue", status: "resolved" }),
    normalizeCustomerClaim({ text: "Demande expliquée", status: "explained_to_customer", type: "request" })
  ];
  caseNoBlock.receptionWorkflow.qualityStatus = "validated";
  state.cases.unshift(caseNoBlock);
`);

const canDeliverNoBlock = app(`canAdvanceReceptionStep(state.cases.find(c => c.id === "case-no-block"), 11, { role: "reception" })`);
assert.ok(canDeliverNoBlock.ok, 'Pas de blocage si toutes les réclamations sont résolues ou expliquées');

// ─── Test 8 : Title = text si title non fourni ────────────────────────────────
console.log('Test 8 — Title fallback sur text...');
const claimTextOnly = app(`normalizeCustomerClaim({ text: "Problème chauffage", status: "open" })`);
assert.equal(claimTextOnly.title, 'Problème chauffage', 'title doit utiliser text comme fallback');
assert.equal(claimTextOnly.text, 'Problème chauffage', 'text doit rester text');

// ─── Test 9 : Persistance receptionWorkflow dans normalizeCase ────────────────
console.log('Test 9 — receptionWorkflow est persisté et normalisé dans normalizeCase...');
const caseWithRW = app(`normalizeCase({
  id: "case-rw-persist",
  clientName: "Test RW",
  vehicle: "Kia Sportage",
  receptionWorkflow: {
    planningCycles: 2,
    planningComment: "Urgence client",
    qualityStatus: "in_progress",
    deliverySheetSignedByClient: true,
    followupNotes: [{ at: new Date().toISOString(), by: "u-rec", text: "Note de test" }]
  }
})`);

assert.equal(caseWithRW.receptionWorkflow.planningCycles, 2, 'planningCycles doit être persisté');
assert.equal(caseWithRW.receptionWorkflow.planningComment, 'Urgence client', 'planningComment doit être persisté');
assert.equal(caseWithRW.receptionWorkflow.qualityStatus, 'in_progress', 'qualityStatus doit être persisté');
assert.equal(caseWithRW.receptionWorkflow.deliverySheetSignedByClient, true, 'deliverySheetSignedByClient doit être persisté');
assert.equal(caseWithRW.receptionWorkflow.followupNotes.length, 1, 'followupNotes doit être persisté');

// ─── Test 10 : Statuts invalides sont normalisés ──────────────────────────────
console.log('Test 10 — Statuts invalides dans normalizeCustomerClaim sont normalisés...');
const claimInvalidStatus = app(`normalizeCustomerClaim({ text: "Test", status: "nonexistent_status" })`);
assert.equal(claimInvalidStatus.status, 'open', 'Un statut invalide doit être normalisé vers open');

const rwInvalidQC = app(`normalizeReceptionWorkflow({ qualityStatus: "unknown" })`);
assert.equal(rwInvalidQC.qualityStatus, 'not_started', 'Un qualityStatus invalide doit être normalisé vers not_started');

console.log('\n✅ Tous les tests customer_claims_lifecycle_v231c ont réussi !');
