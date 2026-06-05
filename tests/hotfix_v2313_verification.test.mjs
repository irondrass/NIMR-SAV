// tests/hotfix_v2313_verification.test.mjs
// Suite de tests pour valider le hotfix v23.1.5 :
// 1. Suppression/désactivation du verrou local "Poste atelier verrouillé".
// 2. Création de dossier directement depuis l'espace Réception avec initialisation des réclamations/demandes.

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
      hidden: true, dataset: { tab: id }, style: {}, children: [],
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        toggle(c, force) { if (force !== undefined) { force ? this.classes.add(c) : this.classes.delete(c); } else { if (this.classes.has(c)) this.classes.delete(c); else this.classes.add(c); } return this.classes.has(c); },
        contains(c) { return this.classes.has(c); }
      },
      setAttribute(name, val) {
        if (name === 'inert') this.inert = true;
      },
      removeAttribute(name) {
        if (name === 'inert') this.inert = false;
      },
      toggleAttribute() {},
      addEventListener() {}, append() {}, appendChild(el) { this.children.push(el); return el; },
      querySelector(sel) {
        if (sel === 'input[name="newPin"]') return getOrCreateElement('newPin');
        if (sel === 'input[name="confirmNewPin"]') return getOrCreateElement('confirmNewPin');
        return stubElement();
      },
      querySelectorAll() { return []; }, closest() { return this; },
      inert: false
    });
  }
  return elements.get(id);
}

function stubElement() {
  return {
    value: '', textContent: '', innerHTML: '', hidden: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {},
    addEventListener() {}, querySelector() { return null; }
  };
}

const storage = new Map();
const contextObject = {
  console, setTimeout, clearTimeout,
  newDate: (val) => val ? new Date(val) : new Date(),
  document: {
    getElementById: (id) => getOrCreateElement(id),
    querySelector: (sel) => {
      if (sel.startsWith('#')) return getOrCreateElement(sel.slice(1));
      if (sel === '.app-shell') return getOrCreateElement('app-shell');
      return getOrCreateElement(sel.replace('.', ''));
    },
    querySelectorAll: (sel) => {
      if (sel === '.nav-button') return [getOrCreateElement('btn-dossiers')];
      return [];
    },
    addEventListener: () => {}
  },
  window: {
    addEventListener: () => {},
    location: { reload: () => {} },
    open: () => ({ document: { write: () => {}, close: () => {} } }),
    setTimeout,
    clearTimeout
  },
  navigator: { serviceWorker: { addEventListener: () => {} } },
  sessionStorage: {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => { storage.set(key, String(value)); },
    removeItem: (key) => { storage.delete(key); }
  },
  localStorage: {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => { storage.set(key, String(value)); },
    removeItem: (key) => { storage.delete(key); }
  },
  alert: () => {}, confirm: () => true, prompt: () => '',
  fetch: async () => ({ ok: true, json: async () => ({}) })
};

const context = vm.createContext(contextObject);
vm.runInContext(source, context);

// Override mocks
context.saveState = () => {};
context.lastNotification = null;
context.notifyUser = (msg, type) => {
  context.lastNotification = { msg, type };
  console.log(`[Notification] ${type || 'info'}: ${msg}`);
};
context.render = () => {};
context.renderCases = () => {};

function app(expr) { return vm.runInContext(expr, context); }

console.log('Démarrage des tests v23.1.5 : Hotfix local PIN & Case Creation...');

// ==========================================
// Test 0 : Reception-first startup
// ==========================================
console.log('Test 0 : Démarrage orienté Réception...');
assert.equal(app('activeTab'), 'reception-workspace', 'Le démarrage doit privilégier le flux Réception');
assert.deepEqual(Array.from(app('getAllowedTabsForCurrentUser()').slice(0, 2)), ['reception-workspace', 'dossiers'], 'Réception doit être le premier onglet autorisé pour l’admin');
console.log('-> Test 0 (Démarrage Réception) : OK');

// ==========================================
// Test 1 : Deactivation of local lock PIN
// ==========================================
console.log('Test 1 : Désactivation du verrou local...');

// Configurer de fausses données de sécurité locales antérieures dans le storage
storage.set('nimr-carrosserie-v1:local-security', JSON.stringify({ enabled: true, salt: 'abc', hash: 'xyz' }));
storage.set('nimr-carrosserie-v1:local-security-failures', JSON.stringify({ attempts: 3 }));
storage.set('nimr-carrosserie-v1:local-security-unlocked', 'false');

// Rendre l'app shell initialement inerte
const appShell = getOrCreateElement('app-shell');
appShell.inert = true;

const lockOverlay = getOrCreateElement('local-lock-overlay');
lockOverlay.hidden = false;

// 1.isLocalPinEnabled() doit retourner false
assert.equal(app('isLocalPinEnabled()'), false, 'isLocalPinEnabled() doit retourner false unconditionally');

// 2. initLocalSecurityGate() doit être appelé
app('initLocalSecurityGate()');

// 3. Vérifier que les anciennes clés sont nettoyées
assert.equal(storage.get('nimr-carrosserie-v1:local-security'), undefined, 'LOCAL_SECURITY_KEY doit être supprimé');
assert.equal(storage.get('nimr-carrosserie-v1:local-security-failures'), undefined, 'LOCAL_SECURITY_FAILURE_KEY doit être supprimé');
assert.equal(storage.get('nimr-carrosserie-v1:local-security-unlocked'), undefined, 'LOCAL_SECURITY_SESSION_KEY doit être supprimé');

// 4. Vérifier que l'overlay est masqué et l'app shell n'est plus inerte
assert.equal(lockOverlay.hidden, true, 'L\'overlay lock doit être masqué (hidden = true)');
assert.equal(appShell.inert, false, 'L\'app shell ne doit pas rester inert');

console.log('-> Test 1 (Désactivation PIN local) : OK');

// ==========================================
// Test 2 : Dossier creation from Reception Workspace
// ==========================================
console.log('Test 2 : Création de dossier depuis l\'espace Réception...');

// Setup state
app('state.cases = []; state.auditLog = [];');
app('state.users = [{ id: "u-reception", name: "Marie", role: "reception", active: true }]');
app('state.currentUserId = "u-reception"');

// Simuler le clic sur le bouton "Nouveau dossier"
app('isReceptionCreationMode = true; activeCaseId = null;');

const mockForm = getOrCreateElement('reception-case-create-form');
context.FormData = class {
  constructor(form) {
    this.form = form;
  }
  get(name) {
    return this.form.elements[name]?.value || null;
  }
};

function setReceptionCreateForm(values = {}) {
  const defaults = {
    clientName: 'Jean Dupont',
    phone: '0612345678',
    vehicle: '',
    plate: '',
    vin: '',
    mileage: '15000',
    driverName: 'Jean Dupont',
    driverPhone: '0612345678',
    arrivalNotes: 'Véhicule propre',
    orderType: 'mecanique',
    orderTitle: 'Entretien annuel',
    customerClaimsText: '',
    customerRequestsText: '',
  };
  mockForm.elements = Object.fromEntries(
    Object.entries({ ...defaults, ...values }).map(([key, value]) => [key, { value }])
  );
  return mockForm;
}

function resetReceptionCreateState() {
  app('state.cases = []; state.auditLog = []; activeCaseId = null; isReceptionCreationMode = true;');
  context.lastNotification = null;
}

async function submitReceptionCreate(values = {}) {
  resetReceptionCreateState();
  setReceptionCreateForm(values);
  await app(`handleCreateCase(document.getElementById('reception-case-create-form'))`);
  return {
    count: app('state.cases.length'),
    item: app('state.cases[0]'),
    notification: context.lastNotification,
  };
}

// Soumettre le formulaire
await submitReceptionCreate({
  vehicle: 'Peugeot 208',
  plate: 'AB-123-CD',
  vin: 'VF312345678901234',
  customerClaimsText: 'Bruit suspect à l\'avant\nClimatisation ne refroidit plus',
  customerRequestsText: 'Lavage carrosserie\nPrêt véhicule de courtoisie',
});

// Vérifier que le dossier a été créé
assert.equal(app('state.cases.length'), 1, 'Un dossier doit être créé dans l\'état');

const createdCase = app('state.cases[0]');
assert.equal(createdCase.clientName, 'Jean Dupont', 'Client name correct');
assert.equal(createdCase.vehicle, 'Peugeot 208', 'Vehicle name correct');
assert.equal(createdCase.plate, 'AB-123-CD', 'Plate correct');

// Vérifier les réclamations et demandes initiales
assert.equal(createdCase.customerClaims.length, 4, 'Doit contenir 4 réclamations / demandes client au total');

// 2 réclamations
const claims = createdCase.customerClaims.filter(c => c.type === 'claim');
assert.equal(claims.length, 2, '2 réclamations de type claim');
assert.equal(claims[0].text, 'Bruit suspect à l\'avant', 'Texte réclamation 1 correct');
assert.equal(claims[0].status, 'open', 'Statut réclamation 1 est open');
assert.equal(claims[0].priority, 'normal', 'Priorité réclamation 1 est normal');

// 2 demandes
const requests = createdCase.customerClaims.filter(c => c.type === 'request');
assert.equal(requests.length, 2, '2 demandes de type request');
assert.equal(requests[0].text, 'Lavage carrosserie', 'Texte demande 1 correct');
assert.equal(requests[0].status, 'open', 'Statut demande 1 est open');
assert.equal(requests[0].priority, 'normal', 'Priorité demande 1 est normal');

// Vérifier que le dossier nouvellement créé est actif et creationMode est désactivé
assert.equal(app('activeCaseId'), createdCase.id, 'activeCaseId doit pointer sur le nouveau dossier');
assert.equal(app('isReceptionCreationMode'), false, 'isReceptionCreationMode doit repasser à false');

// Vérifier que l'étape active du dossier est l'étape 2 (Demande de planning)
const activeStep = app('getReceptionWorkflowStep(state.cases[0])');
assert.equal(activeStep, 2, 'L\'étape active du nouveau dossier doit être l\'étape 2 (demande de planning)');

console.log('-> Test 2 (Création dossier Réception) : OK');

// ==========================================
// Test 3 : BUG-VAL-01 — validation identité véhicule
// ==========================================
console.log('Test 3 : BUG-VAL-01 validation identité véhicule...');

const rejectedNoVehicleIdentity = await submitReceptionCreate({
  clientName: 'Client Sans Vehicule',
  vehicle: '',
  plate: '',
  vin: '',
});
assert.equal(rejectedNoVehicleIdentity.count, 0, 'Aucun dossier ne doit être créé sans véhicule, immatriculation ou VIN');
assert.deepEqual(
  rejectedNoVehicleIdentity.notification,
  { msg: "Renseignez au moins le véhicule, l'immatriculation ou le VIN.", type: 'error' },
  'La création sans identité véhicule doit afficher le message bloquant'
);

const acceptedPlateOnly = await submitReceptionCreate({
  clientName: 'Client Plaque Seule',
  vehicle: '',
  plate: 'AA-111-AA',
  vin: '',
});
assert.equal(acceptedPlateOnly.count, 1, 'Un dossier avec immatriculation seule doit être accepté');
assert.equal(acceptedPlateOnly.item.vehicle, 'Véhicule à compléter', 'Le libellé véhicule par défaut ne doit être appliqué qu’après validation');
assert.equal(acceptedPlateOnly.item.plate, 'AA-111-AA', 'La plaque seule doit être conservée');

const acceptedVinOnly = await submitReceptionCreate({
  clientName: 'Client VIN Seul',
  vehicle: '',
  plate: '',
  vin: 'VF3ABCDEF12345678',
});
assert.equal(acceptedVinOnly.count, 1, 'Un dossier avec VIN seul doit être accepté');
assert.equal(acceptedVinOnly.item.vehicle, 'Véhicule à compléter', 'Le libellé véhicule par défaut doit compléter les dossiers acceptés par VIN seul');
assert.equal(acceptedVinOnly.item.vin, 'VF3ABCDEF12345678', 'Le VIN seul doit être conservé');

const acceptedVehicleOnly = await submitReceptionCreate({
  clientName: 'Client Vehicule Seul',
  vehicle: 'Citroën C3',
  plate: '',
  vin: '',
});
assert.equal(acceptedVehicleOnly.count, 1, 'Un dossier avec véhicule seul doit être accepté');
assert.equal(acceptedVehicleOnly.item.vehicle, 'Citroën C3', 'Le véhicule saisi doit être conservé');

console.log('-> Test 3 (BUG-VAL-01 identité véhicule) : OK');

console.log('\n✅ TOUS LES TESTS HOTFIX v23.1.5 REUSSIS AVEC SUCCES !');
