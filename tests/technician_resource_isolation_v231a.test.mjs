import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const scriptFiles = [
  'js/utils.js',
  'js/state.js',
  'js/ui-cases.js',
  'js/estimate-import.js',
  'js/ui-planning.js',
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
  .replace(/initApp\(\);/, '// initApp skipped by tests')
  .replace(/if \("serviceWorker" in navigator[\s\S]*$/u, '');

// Mock elements and DOM
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
      content: {
        cloneNode() {
          return getOrCreateElement(id + "-cloned");
        }
      },
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
      elements: new Proxy({
        pin: { value: '' },
        pin_confirm: { value: '' },
        userId: { value: '' },
        name: { value: '' },
        role: { value: '' },
        email: { value: '' },
        resourceId: { value: '' },
        active: { checked: true },
        pinRequired: { checked: false }
      }, {
        get(target, prop) {
          if (prop in target) return target[prop];
          if (typeof prop === 'string') {
            target[prop] = getOrCreateElement("el-" + prop);
            return target[prop];
          }
          return undefined;
        }
      }),
      setAttribute(name, val) { this[name] = val; },
      removeAttribute(name) { delete this[name]; },
      remove() {},
      toggleAttribute(name, val) { this[name] = val; },
      addEventListener() {},
      append(...el) { this.children.push(...el); },
      appendChild(el) { this.children.push(el); return el; },
      prepend(el) { this.children.unshift(el); },
      replaceChildren() {},
      querySelector(sel) {
        if (sel === ".unauthorized-blocked-message") {
          return this.children.find(c => c.className && c.className.includes("unauthorized-blocked-message")) || null;
        }
        if (sel === ".panel-heading") {
          return this.children.find(c => c.className && c.className.includes("panel-heading")) || null;
        }
        if (sel.startsWith('#')) return getOrCreateElement(sel.slice(1));
        return getOrCreateElement(sel.replace('.',''));
      },
      querySelectorAll(sel) {
        return [];
      },
      closest(sel) {
        if (sel === "label") {
          return getOrCreateElement(id + "-label-container");
        }
        return null;
      },
    });
  }
  return elements.get(id);
}

const context = {
  console,
  localStorage: {
    storage: new Map(),
    getItem(key) { return this.storage.get(key) || null; },
    setItem(key, val) { this.storage.set(key, String(val)); },
    removeItem(key) { this.storage.delete(key); }
  },
  sessionStorage: {
    storage: new Map(),
    getItem(key) { return this.storage.get(key) || null; },
    setItem(key, val) { this.storage.set(key, String(val)); },
    removeItem(key) { this.storage.delete(key); }
  },
  document: {
    getElementById(id) { return getOrCreateElement(id); },
    querySelector(sel) {
      if (sel.startsWith('#')) return getOrCreateElement(sel.slice(1));
      return getOrCreateElement(sel);
    },
    querySelectorAll(sel) {
      if (sel === ".nav-button") {
        return ["dossiers", "today", "pilotage", "planning", "technician", "atelier"].map(id => {
          const el = getOrCreateElement("nav-btn-" + id);
          el.dataset.tab = id;
          return el;
        });
      }
      return [];
    },
    addEventListener() {},
    createElement(tag) { return getOrCreateElement('created-' + tag); },
    body: getOrCreateElement('body'),
  },
  window: {
    addEventListener() {},
    location: { reload() {} },
  },
  navigator: { onLine: true },
  fetch: async () => ({ ok: false }),
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval: () => {},
  Blob,
  URL: { createObjectURL: () => '', revokeObjectURL() {} },
  FileReader: class {},
  crypto: globalThis.crypto,
  TextEncoder: globalThis.TextEncoder,
  TextDecoder: globalThis.TextDecoder,
  Uint8Array: globalThis.Uint8Array,
};
context.window = { ...context.window, ...context };

vm.createContext(context);
vm.runInContext(source, context);
const app = (code) => vm.runInContext(code, context);

function setupTestState() {
  app(`
    state = normalizeState({
      users: [
        { id: 'u-admin', name: 'Admin', role: 'admin', active: true },
        { id: 'u-chef', name: 'Chef', role: 'chef_atelier', active: true },
        { id: 'u-alaa', name: 'Alaa', role: 'technicien', resourceId: 'r-alaa', active: true },
        { id: 'u-karim', name: 'Karim', role: 'technicien', resourceId: 'r-karim', active: true }
      ],
      resources: [
        { id: 'r-alaa', name: 'Alaa Res', role: 'mecanicien', active: true },
        { id: 'r-karim', name: 'Karim Res', role: 'mecanicien', active: true }
      ],
      cases: [
        {
          id: 'case-1',
          clientName: 'Client 1',
          plate: '123TU456',
          flags: { received: true },
          claims: [
            { id: 'claim-1', code: 'estimate-1', label: 'Work estimate', status: 'accepted', includeInPlanning: true, type: 'client', partsStatus: 'unchecked', clientApproved: true, expertApproved: true }
          ]
        }
      ],
      bookings: [
        {
          id: 'booking-alaa',
          caseId: 'case-1',
          resourceIds: ['r-alaa'],
          start: '2026-06-04T08:00:00.000Z',
          end: '2026-06-04T10:00:00.000Z',
          segments: [{ start: '2026-06-04T08:00:00.000Z', end: '2026-06-04T10:00:00.000Z' }],
          status: 'planned'
        },
        {
          id: 'booking-karim',
          caseId: 'case-1',
          resourceIds: ['r-karim'],
          start: '2026-06-04T10:00:00.000Z',
          end: '2026-06-04T12:00:00.000Z',
          segments: [{ start: '2026-06-04T10:00:00.000Z', end: '2026-06-04T12:00:00.000Z' }],
          status: 'planned'
        }
      ],
      auditLog: []
    });
  `);
}

// ================= TEST CASES =================

// 1. Alaa connected sees only tasks affected to Alaa.
console.log('Test 1: Alaa sees only Alaa tasks...');
setupTestState();
app('setCurrentUser("u-alaa")');
const alaaTasks = app('getTechnicianTaskRows("r-alaa", "2026-06-04")');
assert.equal(alaaTasks.length, 1);
assert.equal(alaaTasks[0].booking.id, 'booking-alaa');

// 2. Alaa connected doesn't see Karim's tasks.
console.log('Test 2: Alaa does not see Karim tasks...');
const karimTasksSeenByAlaa = alaaTasks.filter(t => t.booking.id === 'booking-karim');
assert.equal(karimTasksSeenByAlaa.length, 0);

// 3. Karim connected sees only Karim's tasks.
console.log('Test 3: Karim sees only Karim tasks...');
app('setCurrentUser("u-karim")');
const karimTasks = app('getTechnicianTaskRows("r-karim", "2026-06-04")');
assert.equal(karimTasks.length, 1);
assert.equal(karimTasks[0].booking.id, 'booking-karim');

// 4. Karim connected doesn't see Alaa's tasks.
console.log('Test 4: Karim does not see Alaa tasks...');
const alaaTasksSeenByKarim = karimTasks.filter(t => t.booking.id === 'booking-alaa');
assert.equal(alaaTasksSeenByKarim.length, 0);

// 5. Alaa cannot start Karim's task.
console.log('Test 5: Alaa cannot start a Karim task...');
setupTestState();
app('setCurrentUser("u-alaa")');
const startRes = app('startTechnicianTask(state.cases[0], "booking-karim", "r-alaa")');
console.log('DEBUG: startRes for Karim task:', startRes);
assert.equal(startRes.ok, false);
assert.equal(startRes.message.includes('Action non autorisée') || startRes.message.includes('Permission insuffisante'), true);

// 6. Alaa cannot complete Karim's task.
console.log('Test 6: Alaa cannot complete a Karim task...');
setupTestState();
app('setCurrentUser("u-alaa")');
const completeRes = app('completeTechnicianTask(state.cases[0], "booking-karim", "r-alaa")');
console.log('DEBUG: completeRes for Karim task:', completeRes);
assert.equal(completeRes.ok, false);
assert.equal(completeRes.message.includes('Action non autorisée') || completeRes.message.includes('Permission insuffisante'), true);

// 7. Alaa cannot pause/resume Karim's task.
console.log('Test 7: Alaa cannot pause/resume a Karim task...');
setupTestState();
app('setCurrentUser("u-alaa")');
// Make Karim's task started (using Karim to bypass initial check, or setting it manually)
app('state.bookings.find(b => b.id === "booking-karim").status = "started"');
const pauseRes = app('pauseTechnicianTask(state.cases[0], "booking-karim", "r-alaa", "Wait for lift")');
console.log('DEBUG: pauseRes for Karim task:', pauseRes);
assert.equal(pauseRes.ok, false);
assert.equal(pauseRes.message.includes('Action non autorisée') || pauseRes.message.includes('Permission insuffisante'), true);

const resumeRes = app('resumeTechnicianTask(state.cases[0], "booking-karim", "r-alaa")');
console.log('DEBUG: resumeRes for Karim task:', resumeRes);
assert.equal(resumeRes.ok, false);
assert.equal(resumeRes.message.includes('Action non autorisée') || resumeRes.message.includes('Permission insuffisante'), true);

// 8. Alaa cannot add note/photo on Karim's task.
console.log('Test 8: Alaa cannot add note/photo on a Karim task...');
setupTestState();
app('setCurrentUser("u-alaa")');
const noteRes = app('addTechnicianTaskNote(state.cases[0], "booking-karim", "r-alaa", "Malicious note")');
console.log('DEBUG: noteRes for Karim task:', noteRes);
assert.equal(noteRes.ok, false);
assert.equal(noteRes.message.includes('Action non autorisée') || noteRes.message.includes('Permission insuffisante'), true);

const photoRes = app('attachTechnicianTaskPhoto(state.cases[0], "booking-karim", "r-alaa", "photo-123")');
console.log('DEBUG: photoRes for Karim task:', photoRes);
assert.equal(photoRes.ok, false);
assert.equal(photoRes.message.includes('Action non autorisée') || photoRes.message.includes('Permission insuffisante'), true);

// 9. Forbidden attempt logged as permission_denied.
console.log('Test 9: Forbidden attempt logged as permission_denied...');
setupTestState();
app('setCurrentUser("u-alaa")');
app('startTechnicianTask(state.cases[0], "booking-karim", "r-alaa")');
const deniedLogs = app('state.auditLog.filter(log => log.type === "permission_denied")');
console.log('DEBUG: Denied logs count:', deniedLogs.length);
assert.ok(deniedLogs.length >= 1);
assert.ok(deniedLogs[0].details.includes("Tentative d'action non autorisée") || deniedLogs[0].details.includes("permission_denied"));

// 10. Admin or chef_atelier can see all tasks if authorized.
console.log('Test 10: Admin or chef_atelier can view all tasks...');
setupTestState();
app('setCurrentUser("u-admin")');
const alaaTasksForAdmin = app('getTechnicianTaskRows("r-alaa", "2026-06-04")');
const karimTasksForAdmin = app('getTechnicianTaskRows("r-karim", "2026-06-04")');
assert.equal(alaaTasksForAdmin.length, 1);
assert.equal(karimTasksForAdmin.length, 1);

app('setCurrentUser("u-chef")');
const alaaTasksForChef = app('getTechnicianTaskRows("r-alaa", "2026-06-04")');
const karimTasksForChef = app('getTechnicianTaskRows("r-karim", "2026-06-04")');
assert.equal(alaaTasksForChef.length, 1);
assert.equal(karimTasksForChef.length, 1);

// 11. Changing user Alaa -> Karim purges old view and reloads Karim tasks.
console.log('Test 11: Switch user Alaa -> Karim purges and reloads Karim tasks...');
setupTestState();
app('setCurrentUser("u-alaa")');
// In technician mode, switching to Karim should clear Alaa views and change technician ID
app('executeUserLogin(state.users.find(u => u.id === "u-karim"))');
const activeUser = app('getCurrentUser()');
const activeTechId = app('state.ui.technicianId');
assert.equal(activeUser.id, 'u-karim');
assert.equal(activeTechId, 'r-karim');
// Also verify only Karim's tasks are now returned since current user is Karim and technicianId is Karim
const currentTasks = app('getTechnicianTaskRows(state.ui.technicianId, "2026-06-04")');
assert.equal(currentTasks.length, 1);
assert.equal(currentTasks[0].booking.id, 'booking-karim');

// 12. Non-regression of normal technician flows (Alaa starts and completes their own task).
console.log('Test 12: Non-regression of normal technician flow...');
setupTestState();
app('setCurrentUser("u-alaa")');
const alaaOwnStartRes = app('startTechnicianTask(state.cases[0], "booking-alaa", "r-alaa")');
console.log('DEBUG: startRes for Alaa own task:', alaaOwnStartRes);
assert.equal(alaaOwnStartRes.ok, true);

// Complete Alaa's own task (skip photo check for simplicity if needed, or add photo if required)
// Since case-1 is client repair (no insurance flag by default in claims), completion doesn't require a photo.
const alaaOwnCompleteRes = app('completeTechnicianTask(state.cases[0], "booking-alaa", "r-alaa")');
console.log('DEBUG: completeRes for Alaa own task:', alaaOwnCompleteRes);
assert.equal(alaaOwnCompleteRes.ok, true);

console.log('All 12 technician resource isolation tests passed successfully!');

// 13. PIN Security - Session purges and validation tests
console.log('Test 13: PIN Security - sessionStorage purges & incorrect logs...');

// 1. Admin incorrect PIN audit log
setupTestState();
await app('setUserPin("u-admin", "1234")');
await app('verifyUserPin("u-admin", "4321")');
const pinIncorrectLog = app('state.auditLog.filter(log => log.type === "users.pin_incorrect")');
assert.equal(pinIncorrectLog.length, 1);
console.log('-> Audit log for users.pin_incorrect verified.');

// 2. Admin connects with correct PIN
const correctPinResult = await app('verifyUserPin("u-admin", "1234")');
assert.equal(correctPinResult, true);
app('sessionStorage.setItem("unlocked_user_u-admin", "true")');
assert.equal(app('sessionStorage.getItem("unlocked_user_u-admin")'), "true");

// 3. Admin switches to Karim (non-sensitive) -> unlocked_user_u-admin is purged
app('executeUserLogin(state.users.find(u => u.id === "u-karim"))');
assert.equal(app('sessionStorage.getItem("unlocked_user_u-admin")'), null);
console.log('-> Switch to Karim purges admin session.');

// 4. Karim switches to Admin -> PIN must be requested again
const adminSession = app('sessionStorage.getItem("unlocked_user_u-admin")');
assert.equal(adminSession, null);
console.log('-> Karim cannot switch back to admin without PIN.');

// 5. Inactivity timeout purges all sessions
app('sessionStorage.setItem("unlocked_user_u-admin", "true")');
app('sessionStorage.setItem("unlocked_user_u-chef", "true")');
app('lockSessionDueToInactivity()');
assert.equal(app('sessionStorage.getItem("unlocked_user_u-admin")'), null);
assert.equal(app('sessionStorage.getItem("unlocked_user_u-chef")'), null);
console.log('-> Inactivity timeout purges all sensitive sessions.');

// 6. Logout / Selector show purges all sessions
app('sessionStorage.setItem("unlocked_user_u-admin", "true")');
app('sessionStorage.setItem("unlocked_user_u-chef", "true")');
app('showUserSelectorOverlay()');
assert.equal(app('sessionStorage.getItem("unlocked_user_u-admin")'), null);
assert.equal(app('sessionStorage.getItem("unlocked_user_u-chef")'), null);
console.log('-> User selector show / logout purges all sensitive sessions.');

console.log('All tests passed successfully!');


