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
  .replace(/initApp\(\);/, '// initApp skipped by hotfix tests')
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
        pin: { value: '1234' },
        confirmPin: { value: '1234' },
        userId: { value: '' },
        name: { value: '' },
        role: { value: '' },
        email: { value: '' },
        resourceId: { value: '' },
        active: { checked: true }
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
        if (sel === "input, button" || sel === "input, select, textarea, button") {
          return [];
        }
        return [];
      },
      closest(sel) {
        if (sel === ".users-roles-panel") {
          return getOrCreateElement("users-roles-panel-container");
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
    getItem() { return null; },
    setItem() {},
    removeItem() {}
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
      if (sel.includes("data-case-tab") || sel === "[data-case-tab]") {
        return ["claims", "photos", "planning", "atelier", "livraison"].map(id => {
          const el = getOrCreateElement("case-tab-" + id);
          el.dataset.caseTab = id;
          return el;
        });
      }
      if (sel.includes("data-case-panel")) {
        return ["claims", "photos", "planning", "atelier", "livraison"].map(id => {
          const el = getOrCreateElement("case-panel-" + id);
          el.dataset.casePanel = id;
          return el;
        });
      }
      if (sel.startsWith('[data-toggle]')) {
        return [];
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
  crypto: { randomUUID: () => `id-${Math.random().toString(16).slice(2)}` },
};
context.window = { ...context.window, ...context };

vm.createContext(context);
vm.runInContext(source, context);
const app = (code) => vm.runInContext(code, context);

// Spies for view rendering functions
app(`
  let renderCasesCount = 0;
  let renderPlanningCount = 0;
  let renderTechnicianCount = 0;

  const origRenderCases = renderCases;
  renderCases = function() {
    renderCasesCount++;
    return origRenderCases.apply(this, arguments);
  };

  const origRenderPlanning = renderPlanning;
  renderPlanning = function() {
    renderPlanningCount++;
    return origRenderPlanning.apply(this, arguments);
  };

  const origRenderTechnician = renderTechnicianDashboard;
  renderTechnicianDashboard = function() {
    renderTechnicianCount++;
    return origRenderTechnician.apply(this, arguments);
  };
`);

function setupUserState(userId, role, resourceId = null) {
  app(`
    state = normalizeState({
      users: [
        { id: 'u-admin', name: 'Admin', role: 'admin', active: true },
        { id: 'u-chef', name: 'Chef', role: 'chef_atelier', active: true },
        { id: 'u-reception', name: 'Reception', role: 'reception', active: true },
        { id: 'u-tech', name: 'Technicien 1', role: 'technicien', resourceId: 'r-tech-1', active: true },
        { id: 'u-qualite', name: 'Qualite', role: 'qualite', active: true },
        { id: 'u-readonly', name: 'Readonly', role: 'readonly', active: true }
      ],
      currentUserId: '${userId}',
      resources: [
        { id: 'r-tech-1', name: 'Tech 1', role: 'mecanicien', active: true },
        { id: 'r-tech-2', name: 'Tech 2', role: 'mecanicien', active: true }
      ],
      cases: [
        { id: 'case-1', clientName: 'Client 1', plate: '123TU456', flags: {} }
      ],
      bookings: []
    });
  `);
}

// Reset spies count
function resetSpies() {
  app(`
    renderCasesCount = 0;
    renderPlanningCount = 0;
    renderTechnicianCount = 0;
  `);
}

// ================= TEST CASES =================

// 1. ADMIN sees all tabs
console.log('Test 1: Admin access...');
setupUserState('u-admin', 'admin');
app('activeTab = "planning"');
resetSpies();
app('render()');
assert.equal(app('activeTab'), 'planning', 'Admin ne doit pas être redirigé de planning');
assert.equal(app('renderPlanningCount'), 1, 'Admin doit exécuter le planning');

// 2. TECHNICIEN sees only technician tab
console.log('Test 2: Technicien tab restriction...');
setupUserState('u-tech', 'technicien');
assert.equal(app('JSON.stringify(getAllowedTabsForCurrentUser())'), '["technician"]', 'Technicien doit avoir uniquement technician');

// 3. TECHNICIEN redirected if activeTab is dossiers
console.log('Test 3: Technicien redirection...');
app('activeTab = "dossiers"');
resetSpies();
app('render()');
assert.equal(app('activeTab'), 'technician', 'Technicien sur dossiers doit être redirigé vers technician');
assert.equal(app('renderTechnicianCount'), 1, 'Technicien doit exécuter le dashboard technicien');
assert.equal(app('renderCasesCount'), 0, 'Technicien ne doit pas exécuter le rendu dossiers');

// 4. TECHNICIEN view blocking checks
console.log('Test 4: Technicien view blocking...');
// Check that view-planning has blocked message shown and its original children hidden
const viewPlanning = app('document.getElementById("view-planning")');
assert.equal(viewPlanning.children.some(c => c.id === 'created-div' && c.className.includes('unauthorized-blocked-message')), true, 'Un message bloqué doit être ajouté pour le planning');

// 5. RECEPTION does not see Paramètres admin (atelier)
console.log('Test 5: Réception tab restriction...');
setupUserState('u-reception', 'reception');
assert.equal(app('canAccessTab("atelier")'), false, 'Réception ne doit pas avoir accès aux paramètres/atelier');
assert.equal(app('canAccessTab("planning")'), false, 'Réception ne doit pas avoir accès au planning global');
app('activeTab = "atelier"');
app('render()');
assert.notEqual(app('activeTab'), 'atelier', 'Réception sur atelier doit être redirigé');

// 6. CHEF_ATELIER sees dossiers & planning but parameters are limited
console.log('Test 6: Chef atelier access...');
setupUserState('u-chef', 'chef_atelier');
assert.equal(app('canAccessTab("planning")'), true, 'Chef atelier doit pouvoir accéder au planning');
assert.equal(app('canAccessTab("dossiers")'), true, 'Chef atelier doit pouvoir accéder aux dossiers');
assert.equal(app('canAccessTab("atelier")'), true, 'Chef atelier doit pouvoir accéder aux paramètres');

// 7. CHEF_ATELIER does not see users and roles form or list
console.log('Test 7: Chef atelier users panel hidden...');
app('renderUsersAndRoles()');
const userForm = app('document.getElementById("user-form")');
const usersList = app('document.getElementById("users-list")');
assert.equal(userForm.hidden, true, 'Formulaire utilisateurs doit être masqué pour le chef atelier');
assert.equal(usersList.hidden, true, 'Liste utilisateurs doit être masquée pour le chef atelier');

// 8. CHEF_ATELIER cannot configure Supabase (anonKey/url inputs are disabled)
console.log('Test 8: Chef atelier cannot configure Supabase...');
app('bindSupabaseConfigForm()');
const configForm = app('document.getElementById("supabase-config-form")');
assert.equal(app('guardAction("supabase.configure").ok'), false, 'Chef atelier ne doit pas avoir la permission de configurer Supabase');

// 9. QUALITE access limited to claims, photos and livraison tabs
console.log('Test 9: Qualité sub-tabs restriction...');
setupUserState('u-qualite', 'qualite');
app('activeCaseDetailTab = "planning"');
app('setupCaseDetailTabs(document.getElementById("body"), state.cases[0])');
assert.notEqual(app('activeCaseDetailTab'), 'planning', 'Qualité ne doit pas rester sur planning dans le détail dossier');
assert.equal(app('activeCaseDetailTab'), 'claims', 'Qualité doit être redirigé vers claims par défaut');

// 10. READONLY cannot mutate state
console.log('Test 10: Readonly mutation checks...');
setupUserState('u-readonly', 'readonly');
assert.equal(app('guardSensitiveAction("case.delete").ok'), false, 'Readonly ne doit pas pouvoir supprimer un dossier');
assert.equal(app('guardSensitiveAction("case.create").ok'), false, 'Readonly ne doit pas pouvoir créer un dossier');
assert.equal(app('guardSensitiveAction("settings.edit").ok'), false, 'Readonly ne doit pas pouvoir modifier les paramètres PIN/nettoyage');

// 11. Changing user from admin -> technician redirects tab
console.log('Test 11: Switch user redirection...');
setupUserState('u-admin', 'admin');
app('activeTab = "planning"');
app('render()');
assert.equal(app('activeTab'), 'planning');
app(`
  document.getElementById("case-detail").innerHTML = "<strong>SECRET_DOSSIER_ADMIN</strong>";
  document.getElementById("gantt").innerHTML = "<strong>SECRET_PLANNING_ADMIN</strong>";
`);

// Switch active user using select change handler
app(`
  const select = document.getElementById("current-user-selector");
  select.value = "u-tech";
  const changeEvent = { currentTarget: select };
  // Trigger change listener manually
  const handlers = [];
  select.addEventListener = (evt, cb) => { if (evt === 'change') handlers.push(cb); };
`);
app('setCurrentUser("u-tech")');
resetSpies();
app('render()');
assert.equal(app('activeTab'), 'technician', 'La bascule utilisateur vers technicien doit forcer la redirection immédiate');
assert.equal(app('document.getElementById("case-detail").innerHTML.includes("SECRET_DOSSIER_ADMIN")'), false, 'Le détail dossier ancien ne doit pas rester dans le DOM pour un technicien');
assert.equal(app('document.getElementById("gantt").innerHTML.includes("SECRET_PLANNING_ADMIN")'), false, 'Le planning ancien ne doit pas rester dans le DOM pour un technicien');

// 12. Non-regression check on legacy roles tests
console.log('Test 12: Non-regression checks...');
setupUserState('u-admin', 'admin');
assert.equal(app('guardSensitiveAction("case.delete").ok'), true, 'Admin doit pouvoir supprimer un dossier');
assert.equal(app('guardSensitiveAction("settings.edit").ok'), true, 'Admin doit pouvoir modifier les paramètres');

console.log('ALL ACCESS MATRIX TESTS PASSED!');
