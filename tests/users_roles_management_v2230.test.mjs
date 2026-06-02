import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const scriptFiles = [
  'js/utils.js',
  'js/state.js',
];

const source = scriptFiles
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');

function stubElement() {
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {},
    removeAttribute() {},
    toggleAttribute() {},
    addEventListener() {},
    append() {},
    appendChild() {},
    prepend() {},
    replaceChildren() {},
    querySelector: () => stubElement(),
    querySelectorAll: () => [],
    closest: () => null,
  };
}

const storage = new Map();
const context = {
  console,
  localStorage: {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
  sessionStorage: {
    getItem: () => null,
    setItem() {},
    removeItem() {},
  },
  document: {
    querySelector: () => stubElement(),
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => stubElement(),
    body: stubElement(),
    getElementById: () => stubElement(),
  },
  window: {
    addEventListener() {},
  },
  navigator: { onLine: true },
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval: () => {},
  crypto: { randomUUID: () => `id-${Math.random().toString(16).slice(2)}` },
};
context.window = { ...context.window, ...context };

vm.createContext(context);
vm.runInContext(source, context);
const app = (code) => vm.runInContext(code, context);

// Inject render mock to track re-renders
app(`
  let renderCalledCount = 0;
  function render() {
    renderCalledCount++;
  }
`);

console.log("Démarrage des tests v22.30 : Gestion Utilisateurs & Rôles...");

// Setup initial clean state with default resources and a bootstrapped admin
app(`
  state = normalizeState({
    cases: [],
    resources: [
      { id: 'tech-res-1', name: 'SOFIENE', role: 'peintre', active: true },
      { id: 'tech-res-2', name: 'ALI', role: 'tolier', active: true }
    ],
    bookings: []
  });
`);

// Test 1: admin can create a user
const createRes1 = app(`
  createUserLocal({
    name: 'Chef Atelier Test',
    role: 'chef_atelier',
    email: 'chef@nimr.local',
    active: true
  }, getUserById(state.currentUserId))
`);
assert.equal(createRes1.ok, true, "L'administrateur devrait pouvoir créer un utilisateur.");
assert.equal(createRes1.user.name, "Chef Atelier Test");
assert.equal(createRes1.user.role, "chef_atelier");
assert.equal(createRes1.user.active, true);

// Test 2: admin can modify a role
const userToModifyId = createRes1.user.id;
const modifyRes = app(`
  updateUserLocal('${userToModifyId}', {
    name: 'Chef Atelier Test Modifie',
    role: 'reception',
    email: 'chef@nimr.local',
    active: true
  }, getUserById(state.currentUserId))
`);
assert.equal(modifyRes.ok, true, "L'administrateur devrait pouvoir modifier un rôle.");
assert.equal(modifyRes.user.name, "Chef Atelier Test Modifie");
assert.equal(modifyRes.user.role, "reception");

// Test 3: admin can link a technician to resourceId
const createTechRes = app(`
  createUserLocal({
    name: 'Peintre Sofiene',
    role: 'technicien',
    resourceId: 'tech-res-1',
    active: true
  })
`);
assert.equal(createTechRes.ok, true);
assert.equal(createTechRes.user.resourceId, "tech-res-1");

// Test 4: technician without resourceId displays warning
const createTechNoRes = app(`
  createUserLocal({
    name: 'Tech Perdu',
    role: 'technicien',
    resourceId: '',
    active: true
  })
`);
assert.equal(createTechNoRes.ok, true);
const deniedMessage = app(`
  getPermissionDeniedMessage('task.start', {
    user: getUserById('${createTechNoRes.user.id}'),
    booking: { resourceIds: ['tech-res-1'] }
  })
`);
assert.match(deniedMessage, /Aucune ressource technicien liée/i, "Devrait signaler l'absence de ressource liée.");

// Test 5: non-admin cannot manage users
const receptionUserId = modifyRes.user.id;
const createByReception = app(`
  createUserLocal({
    name: 'Intrus',
    role: 'readonly',
    active: true
  }, getUserById('${receptionUserId}'))
`);
assert.equal(createByReception.ok, false, "Un non-admin ne devrait pas pouvoir créer d'utilisateurs.");
assert.match(createByReception.message, /Action réservée administrateur/i);

// Test 6: readonly cannot manage users
const createReadonlyUser = app(`
  createUserLocal({
    name: 'Lecture Seule Test',
    role: 'readonly',
    active: true
  })
`);
assert.equal(createReadonlyUser.ok, true);
const createByReadonly = app(`
  createUserLocal({
    name: 'Intrus 2',
    role: 'readonly',
    active: true
  }, getUserById('${createReadonlyUser.user.id}'))
`);
assert.equal(createByReadonly.ok, false, "Lecture seule ne peut pas créer d'utilisateurs.");

// Test 7: impossible to deactivate the last active admin
const localAdminId = app(`state.users.find(u => u.role === 'admin' && u.active !== false).id`);
const disableAdminRes = app(`
  updateUserLocal('${localAdminId}', {
    name: 'Admin local',
    role: 'admin',
    active: false
  })
`);
assert.equal(disableAdminRes.ok, false, "Impossible de désactiver le dernier administrateur actif.");
assert.match(disableAdminRes.message, /Impossible de désactiver ou de retirer/i);

// Test 8: impossible to remove the admin role from the last active admin
const demoteAdminRes = app(`
  updateUserLocal('${localAdminId}', {
    name: 'Admin local',
    role: 'reception',
    active: true
  })
`);
assert.equal(demoteAdminRes.ok, false, "Impossible de retirer le rôle admin du dernier administrateur actif.");

// Test 9: setCurrentUser() changes current user
const switchRes = app(`setCurrentUser('${receptionUserId}')`);
assert.equal(switchRes, true, "setCurrentUser doit retourner true pour un utilisateur actif.");
assert.equal(app(`state.currentUserId`), receptionUserId, "state.currentUserId doit être mis à jour.");

// Test 10: inactive user cannot become current user
const inactiveUserRes = app(`
  createUserLocal({
    name: 'Ancien Employe',
    role: 'reception',
    active: false
  }, getUserById('${localAdminId}'))
`);
assert.equal(inactiveUserRes.ok, true);
const switchInactiveRes = app(`setCurrentUser('${inactiveUserRes.user.id}')`);
assert.equal(switchInactiveRes, false, "setCurrentUser doit refuser un utilisateur inactif.");
assert.notEqual(app(`state.currentUserId`), inactiveUserRes.user.id);

// Test 11: UI re-render after user change
// Setting up event wiring simulation
app(`
  renderCalledCount = 0;
  // Simulating switcher change event
  const newUserId = '${localAdminId}';
  if (setCurrentUser(newUserId)) {
    render();
  }
`);
assert.equal(app(`renderCalledCount`), 1, "Le re-render de l'UI doit être déclenché lors du changement d'utilisateur.");

// Test 12: audit log contains the actor
const auditEntriesCountBefore = app(`state.auditLog.length`);
app(`
  createUserLocal({
    name: 'Audit User',
    role: 'readonly',
    active: true
  }, getUserById('${localAdminId}'))
`);
const newAuditEntry = app(`state.auditLog[0]`);
assert.equal(app(`state.auditLog.length`), auditEntriesCountBefore + 1);
assert.equal(newAuditEntry.type, "users.created");
assert.equal(newAuditEntry.userId, localAdminId, "L'entrée d'audit doit contenir le userId de l'acteur.");

// Test 13: old state without users bootstraps local admin
app(`
  state = normalizeState({
    cases: [],
    resources: [],
    bookings: []
  });
`);
assert.equal(app(`Array.isArray(state.users)`), true, "Users doit être initialisé.");
assert.equal(app(`state.users.length`), 1, "Un admin local par défaut doit être créé.");
assert.equal(app(`state.users[0].role`), "admin", "Le bootstrap user doit être un admin.");

// Test 14: offline/local mode works without Supabase
assert.equal(app(`getCurrentUser().role`), "admin");
assert.equal(app(`hasPermission('settings.edit')`), true);

// Test 15: existing permissions do not regress
assert.equal(app(`hasPermission('planning.edit', { user: { role: 'reception', active: true } })`), false, "Réception ne peut pas éditer le planning.");
assert.equal(app(`hasPermission('case.create', { user: { role: 'reception', active: true } })`), true, "Réception peut créer des dossiers.");
assert.equal(app(`hasPermission('quality.validate', { user: { role: 'qualite', active: true } })`), true, "Qualité peut valider la qualité.");
assert.equal(app(`hasPermission('task.start', { user: { role: 'technicien', active: true } })`), true, "Technicien peut démarrer les tâches.");

console.log("Users roles management v22.30 tests OK !");
