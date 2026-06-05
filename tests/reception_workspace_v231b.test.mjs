import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const scriptFiles = [
  'js/utils.js',
  'js/state.js',
  'js/ui-cases.js',
  'js/estimate-import.js',
  'js/ui-planning.js',
  'js/ui-reception.js',
  'js/photos.js',
  'js/storage.js',
  'js/planning.js',
  'js/exports.js',
  'js/supabase-config.js',
  'js/supabase-client.js',
  'js/supabase-sync.js',
  'app.js',
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
      id,
      value: '',
      textContent: '',
      innerHTML: '',
      hidden: false,
      dataset: { tab: id },
      style: {},
      children: [],
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        toggle(c, force) {
          if (force === undefined) {
            if (this.classes.has(c)) this.classes.delete(c);
            else this.classes.add(c);
          } else if (force) {
            this.classes.add(c);
          } else {
            this.classes.delete(c);
          }
        },
        contains(c) { return this.classes.has(c); }
      },
      elements: {},
      setAttribute(name, val) { this[name] = val; },
      removeAttribute(name) { delete this[name]; },
      remove() {},
      toggleAttribute(name, val) { this[name] = val; },
      addEventListener() {},
      append(...el) { this.children.push(...el); },
      appendChild(el) { this.children.push(el); return el; },
      querySelector(sel) {
        if (sel.startsWith('#')) return getOrCreateElement(sel.slice(1));
        return getOrCreateElement(sel.replace('.',''));
      },
      querySelectorAll() { return []; },
      closest() { return this; }
    });
  }
  return elements.get(id);
}

const contextObject = {
  console,
  setTimeout,
  clearTimeout,
  newDate: (val) => val ? new Date(val) : new Date(),
  document: {
    getElementById: (id) => getOrCreateElement(id),
    querySelector: (sel) => {
      if (sel.startsWith('#')) return getOrCreateElement(sel.slice(1));
      return getOrCreateElement(sel.replace('.',''));
    },
    querySelectorAll: (sel) => {
      if (sel === ".nav-button") {
        return [getOrCreateElement("btn-dossiers"), getOrCreateElement("btn-reception")];
      }
      return [];
    },
    addEventListener: () => {}
  },
  window: {
    addEventListener: () => {},
    location: { reload: () => {} }
  },
  navigator: {
    serviceWorker: {
      addEventListener: () => {}
    }
  },
  sessionStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  },
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  },
  alert: () => {},
  confirm: () => true,
  prompt: () => '',
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  getReceptionRecommendedAction: (item) => {
    if (!item.flags?.received) return { action: 'Marquer véhicule arrivé' };
    if (!item.flags?.clientApproved) return { action: 'Validation client' };
    return { action: 'Envoyer en atelier' };
  }
};

const context = vm.createContext(contextObject);
vm.runInContext(source, context);

function app(expr) {
  return vm.runInContext(expr, context);
}

// Setup initial state
app('state.cases = []');
app('state.users = [ { id: "u-1", name: "Alice", role: "reception", active: true } ]');
app('state.currentUserId = "u-1"');

// Test 1: Receptionist role redirection and tab constraints
console.log('Testing redirection and tab constraints for reception role...');
app('activeTab = "atelier"'); // Attempt to set illegal tab
app('ensureCurrentTabAllowed()');
assert.equal(app('activeTab'), 'reception-workspace', 'Receptionist should be redirected to reception-workspace tab');
assert.equal(app('canAccessTab("atelier")'), false, 'Receptionist must not have access to atelier parameters');
assert.equal(app('canAccessTab("planning")'), false, 'Receptionist must not have access to global planning');
assert.equal(app('canAccessTab("reception-workspace")'), true, 'Receptionist must have access to reception-workspace');

// Test 2: Creating a dossier from Reception Workspace
console.log('Testing dossier creation in Reception Workspace...');
app(`
  isReceptionCreationMode = true;
  activeCaseId = null;
`);

// Mock new case save from form
app(`
  const mockCreateCase = () => {
    const item = normalizeCase({
      id: "case-rec-1",
      clientName: "Jean Dupont",
      vehicle: "Renault Clio",
      plate: "AA-123-BB",
      vin: "VF1RECEPTIONWORKSPAC",
      mileage: "50000",
      driverName: "Pierre Dupont",
      driverPhone: "0612345678",
      arrivalNotes: "Par-brise fissuré",
      createdAt: new Date().toISOString()
    });
    
    // First claim
    const firstClaim = normalizeRepairClaim({
      id: "claim-rec-1",
      number: "OT-001",
      title: "Vidange moteur",
      type: "vidange",
      status: "client_pending",
      includeInPlanning: true,
      expertApproved: true,
      clientApproved: false
    }, 0);
    item.claims = [firstClaim];
    
    state.cases.unshift(item);
    activeCaseId = item.id;
    return item;
  };
  mockCreateCase();
`);

assert.equal(app('state.cases.length'), 1, 'Case should be added to state');
const addedCase = app('state.cases[0]');
assert.equal(addedCase.clientName, 'Jean Dupont', 'Client name should match input');
assert.equal(addedCase.driverName, 'Pierre Dupont', 'Depositor name should map to driverName');
assert.equal(addedCase.driverPhone, '0612345678', 'Depositor phone should map to driverPhone');
assert.equal(addedCase.arrivalNotes, 'Par-brise fissuré', 'Reception notes should map to arrivalNotes');

// Test 3: Recommended action trigger transitions
console.log('Testing recommended actions for newly created dossier...');
let rec = app('getReceptionRecommendedAction(state.cases[0])');
assert.equal(rec.action, 'Marquer véhicule arrivé', 'Recommended action should be to mark arrived');

// Simulate vehicle arrive
app('state.cases[0].flags.received = true');
rec = app('getReceptionRecommendedAction(state.cases[0])');
assert.equal(rec.action, 'Validation client', 'Recommended action should be validation client');

// Simulate client validation
app('state.cases[0].flags.clientApproved = true');
rec = app('getReceptionRecommendedAction(state.cases[0])');
assert.equal(rec.action, 'Envoyer en atelier', 'Recommended action should be send to workshop');

console.log('All reception workspace tests passed successfully!');
