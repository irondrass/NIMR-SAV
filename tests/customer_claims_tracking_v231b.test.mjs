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
        contains(c) { return this.classes.has(c); }
      },
      setAttribute() { },
      removeAttribute() { }
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
    querySelectorAll: () => [],
    addEventListener: () => {}
  },
  window: {
    addEventListener: () => {},
    location: { reload: () => {} }
  },
  navigator: {
    serviceWorker: { addEventListener: () => {} }
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
  fetch: async () => ({ ok: true, json: async () => ({}) })
};

const context = vm.createContext(contextObject);
vm.runInContext(source, context);

// Override UI and storage side-effects
context.saveState = () => {};
context.notifyUser = (msg, type) => { console.log(`[Notification] ${type || 'info'}: ${msg}`); };
context.quietNotify = () => {};
context.render = () => {};
context.renderReceptionWorkspace = () => {};

function app(expr) {
  return vm.runInContext(expr, context);
}

// Setup initial state
app('state.cases = []');
app('state.auditLog = []');

// Create a test case
app(`
  const item = normalizeCase({
    id: "case-claims-1",
    clientName: "Bob Smith",
    vehicle: "Peugeot 208",
    plate: "XX-999-YY",
    createdAt: new Date().toISOString()
  });
  state.cases.unshift(item);
  activeCaseId = item.id;
`);

// Test 1: Claim lifecycle creation
console.log('Testing claim creation...');
app('state.currentUserId = "u-reception"');
app('state.users = [ { id: "u-reception", name: "Marc", role: "reception", active: true } ]');
app('handleAddCustomerClaim("case-claims-1", "Bruit suspect dans la portiere", "high")');

const caseObj = app('state.cases[0]');
assert.equal(caseObj.customerClaims.length, 1, 'Claim should be added');
const claim = caseObj.customerClaims[0];
assert.equal(claim.text, 'Bruit suspect dans la portiere', 'Claim text should match');
assert.equal(claim.priority, 'high', 'Claim priority should be high');
assert.equal(claim.status, 'open', 'Default claim status should be open');

// Verify audit log
let createdAudit = app('state.auditLog.find(log => log.type === "customer_claim.created")');
assert.ok(createdAudit, 'customer_claim.created audit log should be present');
assert.match(createdAudit.details, /Bruit suspect dans la portiere/, 'Audit log should describe the claim text');

// Test 2: Comment timeline and status change
console.log('Testing comments timeline and status changes...');
app(`handleAddClaimComment("case-claims-1", "${claim.id}", "Démontage garniture effectué")`);
assert.equal(claim.comments.length, 1, 'Comment should be added to claim');
assert.equal(claim.comments[0].text, 'Démontage garniture effectué', 'Comment text should match');

let commentAudit = app('state.auditLog.find(log => log.type === "customer_claim.comment_added")');
assert.ok(commentAudit, 'customer_claim.comment_added audit log should be present');

// Change status
app(`handleClaimStatusChange("case-claims-1", "${claim.id}", "in_progress")`);
assert.equal(claim.status, 'in_progress', 'Claim status should change to in_progress');

// Test 3: Explain claim to customer action
console.log('Testing explain claim action...');
app(`handleExplainClaim("case-claims-1", "${claim.id}")`);
assert.equal(claim.status, 'explained_to_customer', 'Claim status should change to explained_to_customer');
assert.equal(claim.comments.length, 2, 'Should have 2 comments now');
assert.equal(claim.comments[1].text, 'Explication fournie au client.', 'Should append standard explanation comment');

// Test 4: Delivery validation warning block and override rules
console.log('Testing delivery warning block and override rules...');

// Add an unresolved claim to test blockage
app('handleAddCustomerClaim("case-claims-1", "Autre probleme de vibrations", "normal")');
const unresolvedClaim = claim; // The second one is now unresolved
// Reset override variables
app('state.cases[0].flags.qualityApproved = true');
app('state.cases[0].flags.delivered = false');

// Mock dialog functions in context
contextObject.showConfirmModal = async () => true;
// Receptionist override attempt should be rejected
app('state.currentUserId = "u-reception"');
app('state.users = [ { id: "u-reception", name: "Marc", role: "reception", active: true } ]');

// verifyDeliveryClaimsBlock returns promise
const verifyBlockResultRec = await app('verifyDeliveryClaimsBlock(state.cases[0])');
assert.equal(verifyBlockResultRec, false, 'Receptionist must be blocked from delivery override');

// Verify warning audit log
let warningAudit = app('state.auditLog.find(log => log.type === "reception.delivery_warning")');
assert.ok(warningAudit, 'reception.delivery_warning audit log should be recorded');

// Admin override attempt with reason should succeed
app('state.currentUserId = "u-admin"');
app('state.users = [ { id: "u-admin", name: "Chef", role: "admin", active: true } ]');

// Mock prompt return for override reason
contextObject.showTextPromptModal = async () => 'Client accepte de repasser lundi';

const verifyBlockResultAdmin = await app('verifyDeliveryClaimsBlock(state.cases[0])');
assert.equal(verifyBlockResultAdmin, true, 'Admin should be allowed to override with reason');

// Verify override audit log and history
let overrideAudit = app('state.auditLog.find(log => log.type === "reception.delivery_override")');
assert.ok(overrideAudit, 'reception.delivery_override audit log should be recorded');
assert.match(overrideAudit.details, /Client accepte de repasser lundi/, 'Audit should contain override reason');

const overrideHistory = app('state.cases[0].history.find(h => h.type === "reception.delivery_override")');
assert.ok(overrideHistory, 'Override should be recorded in case history');
assert.match(overrideHistory.details, /Client accepte de repasser lundi/, 'Case history should contain override reason');

console.log('All customer claims tracking tests passed successfully!');
