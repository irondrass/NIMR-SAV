// tests/reception_delivery_sheet_v231c.test.mjs
// Tests fiche de livraison + gate livraison v23.1C

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

const writes = [];

const source = scriptFiles
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n')
  .replace(/initApp\(\);/, '// initApp skipped')
  .replace(/if \("serviceWorker" in navigator[\s\S]*$/u, '');

function stubElement() {
  return {
    value: '', textContent: '', innerHTML: '', hidden: false, dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {}, toggleAttribute() {}, addEventListener() {},
    append() {}, appendChild() {}, prepend() {}, replaceChildren() {},
    querySelector: () => stubElement(), querySelectorAll: () => [], closest: () => null,
    id: '', children: [],
  };
}

const contextObject = {
  console, setTimeout, clearTimeout,
  newDate: (val) => val ? new Date(val) : new Date(),
  document: {
    getElementById: () => stubElement(),
    querySelector: () => stubElement(),
    querySelectorAll: () => [],
    createElement: () => stubElement(),
    body: stubElement(),
    addEventListener: () => {}
  },
  window: {
    addEventListener: () => {},
    location: { reload: () => {} },
    open: () => ({ document: { write(html) { writes.push(html); }, close() {} } }),
  },
  navigator: { serviceWorker: { addEventListener: () => {} }, onLine: true },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  alert: () => {}, confirm: () => true, prompt: () => '',
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  Blob, URL: { createObjectURL: () => '', revokeObjectURL() {} },
  crypto: { randomUUID: () => `id-${Math.random().toString(16).slice(2)}` },
};

const context = vm.createContext(contextObject);
vm.runInContext(source, context);
context.saveState = () => {};
context.notifyUser = (msg, type) => console.log(`[Notification] ${type || 'info'}: ${msg}`);
context.render = () => {};
context.renderReceptionWorkspace = () => {};
context.renderCases = () => {};

function app(expr) { return vm.runInContext(expr, context); }

// Setup état initial
app('state.cases = []; state.auditLog = [];');
app('state.users = [{ id: "u-admin", name: "Admin", role: "admin", active: true }, { id: "u-rec", name: "Receptionist", role: "reception", active: true }]');

// ─── Test 1 : printDeliverySheet génère du HTML valide ───────────────────────
console.log('Test 1 — printDeliverySheet génère du HTML valide...');
app(`
  const itemPrint = normalizeCase({
    id: "case-print-1",
    clientName: "Pierre Dubois",
    phone: "0612345678",
    vehicle: "BMW X5",
    plate: "AB-123-CD",
    vin: "WBA12345678",
    mileage: "55000",
    createdAt: new Date().toISOString()
  });
  itemPrint.customerClaims = [
    normalizeCustomerClaim({ type: "claim", text: "Bruit suspension", priority: "high", status: "resolved", createdBy: "Marie" }),
    normalizeCustomerClaim({ type: "request", text: "Vérifier pression pneus", priority: "normal", status: "explained_to_customer", createdBy: "Marie" })
  ];
  itemPrint.receptionWorkflow.vehicleMileageEntry = "55000";
  itemPrint.receptionWorkflow.vehicleConditionNote = "Rayure légère aile avant";
  itemPrint.receptionWorkflow.qualityStatus = "validated";
  state.cases.unshift(itemPrint);
`);

app('state.currentUserId = "u-admin"');
const printBefore = writes.length;
app('printDeliverySheet(state.cases[0])');
assert.ok(writes.length > printBefore, 'printDeliverySheet doit générer du contenu HTML');

const deliveryHtml = writes[writes.length - 1];
assert.ok(deliveryHtml.includes('Pierre Dubois'), 'La fiche doit contenir le nom du client');
assert.ok(deliveryHtml.includes('BMW X5'), 'La fiche doit contenir le modèle du véhicule');
assert.ok(deliveryHtml.includes('AB-123-CD'), 'La fiche doit contenir l\'immatriculation');
assert.ok(deliveryHtml.includes('55000'), 'La fiche doit contenir le kilométrage');

// ─── Test 2 : Fiche contient les réclamations client ─────────────────────────
console.log('Test 2 — La fiche contient les réclamations client...');
assert.ok(deliveryHtml.includes('Bruit suspension'), 'La fiche doit contenir la première réclamation');
assert.ok(deliveryHtml.includes('Vérifier pression pneus'), 'La fiche doit contenir la deuxième demande');
assert.ok(deliveryHtml.includes('Résolue'), 'La fiche doit afficher le statut résolu');

// ─── Test 3 : Fiche contient les zones de signature ──────────────────────────
console.log('Test 3 — La fiche contient les zones de signature...');
assert.ok(deliveryHtml.includes('Signature du client'), 'La fiche doit avoir une zone signature client');
assert.ok(deliveryHtml.includes('Signature du responsable'), 'La fiche doit avoir une zone signature réception');

// ─── Test 4 : Fiche contient les observations ────────────────────────────────
console.log('Test 4 — La fiche contient les observations...');
assert.ok(deliveryHtml.includes('Rayure légère aile avant'), 'La fiche doit contenir les observations');

// ─── Test 5 : Fiche contient l\'en-tête NIMR SAV ────────────────────────────
console.log('Test 5 — La fiche contient l\'en-tête workshop...');
assert.ok(deliveryHtml.includes('NIMR SAV'), 'La fiche doit contenir le nom du workshop');
assert.ok(deliveryHtml.includes('FICHE DE LIVRAISON'), 'La fiche doit avoir le titre correct');

// ─── Test 6 : mark_delivery_sheet_printed enregistre horodatage ──────────────
console.log('Test 6 — mark_delivery_sheet_printed enregistre l\'horodatage...');
app('state.auditLog = []');
const r6 = app('advanceReceptionWorkflow("case-print-1", "mark_delivery_sheet_printed")');
assert.ok(r6.ok, 'Marquer fiche imprimée doit réussir');

const caseAfterPrint = app('state.cases[0]');
assert.ok(caseAfterPrint.receptionWorkflow.deliverySheetPrintedAt, 'deliverySheetPrintedAt doit être défini');

const printAudit = app('state.auditLog.find(l => l.type === "reception.delivery_sheet_printed")');
assert.ok(printAudit, 'L\'audit log d\'impression doit être présent');

// ─── Test 7 : mark_sheet_signed enregistre le signataire ─────────────────────
console.log('Test 7 — mark_sheet_signed enregistre le signataire...');
const r7 = app('advanceReceptionWorkflow("case-print-1", "mark_sheet_signed", { clientName: "Pierre Dubois" })');
assert.ok(r7.ok, 'Marquer fiche signée doit réussir');

const caseAfterSign = app('state.cases[0]');
assert.ok(caseAfterSign.receptionWorkflow.deliverySheetSignedByClient, 'deliverySheetSignedByClient doit être true');
assert.equal(caseAfterSign.receptionWorkflow.deliverySheetClientName, 'Pierre Dubois', 'Le nom du signataire doit être enregistré');

const signAudit = app('state.auditLog.find(l => l.type === "reception.customer_signature_captured")');
assert.ok(signAudit, 'L\'audit log de signature doit être présent');

// ─── Test 8 : verifyDeliveryClaimsBlock — blocage réceptionniste ──────────────
console.log('Test 8 — verifyDeliveryClaimsBlock bloque la réception si réclamations ouvertes...');
app(`
  const itemBlock = normalizeCase({
    id: "case-block-1",
    clientName: "Test Block",
    vehicle: "Audi A3",
    plate: "GH-456-IJ",
    createdAt: new Date().toISOString()
  });
  itemBlock.customerClaims = [
    normalizeCustomerClaim({ text: "Réclamation non résolue", status: "open", priority: "high" })
  ];
  state.cases.unshift(itemBlock);
`);

app('state.currentUserId = "u-rec"');
contextObject.showConfirmModal = async () => true;

const blockResultRec = await app('verifyDeliveryClaimsBlock(state.cases.find(c => c.id === "case-block-1"))');
assert.equal(blockResultRec, false, 'Le réceptionniste doit être bloqué si réclamation ouverte');

const warningAudit = app('state.auditLog.find(l => l.type === "reception.delivery_warning")');
assert.ok(warningAudit, 'L\'audit de warning livraison doit être présent');

// ─── Test 9 : verifyDeliveryClaimsBlock — override admin ─────────────────────
console.log('Test 9 — verifyDeliveryClaimsBlock autorise l\'admin avec motif...');
app('state.currentUserId = "u-admin"');
contextObject.showTextPromptModal = async () => 'Client confirmé livraison malgré réclamation';

const blockResultAdmin = await app('verifyDeliveryClaimsBlock(state.cases.find(c => c.id === "case-block-1"))');
assert.equal(blockResultAdmin, true, 'L\'admin peut forcer la livraison avec motif');

const overrideAudit = app('state.auditLog.find(l => l.type === "reception.delivery_override")');
assert.ok(overrideAudit, 'L\'audit override doit être présent');
assert.ok(overrideAudit.details.includes('Client confirmé livraison'), 'L\'audit doit contenir le motif');

// ─── Test 10 : deliver_vehicle finalise le dossier ────────────────────────────
console.log('Test 10 — deliver_vehicle finalise le dossier...');
app('state.cases[0].flags.qualityApproved = true');
app('state.cases[0].receptionWorkflow.readyForDeliveryAt = new Date().toISOString()');
app('state.currentUserId = "u-admin"');

const r10 = app('advanceReceptionWorkflow("case-block-1", "deliver_vehicle")');
assert.ok(r10.ok, 'La livraison doit réussir');

const caseDelivered = app('state.cases.find(c => c.id === "case-block-1")');
assert.ok(caseDelivered.flags.delivered, 'flags.delivered doit être true');
assert.ok(caseDelivered.receptionWorkflow.deliveredAt, 'deliveredAt doit être défini');

const deliveryAudit = app('state.auditLog.find(l => l.type === "reception.delivery_completed")');
assert.ok(deliveryAudit, 'L\'audit de livraison doit être présent');

console.log('\n✅ Tous les tests reception_delivery_sheet_v231c ont réussi !');
