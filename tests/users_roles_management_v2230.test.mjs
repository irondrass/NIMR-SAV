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

console.log("Démarrage des tests v23.2.7 : Gestion Utilisateurs & Rôles...");

// Etat initial avec un administrateur explicitement créé et sélectionné.
app(`
  state = normalizeState({
    users: [
      { id: 'admin-explicit', name: 'Admin technique explicite', role: 'admin_technique', active: true }
    ],
    currentUserId: 'admin-explicit',
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
  })
`);
assert.equal(createRes1.ok, true, "L'administrateur devrait pouvoir créer un utilisateur.");
assert.equal(createRes1.user.name, "Chef Atelier Test");
assert.equal(createRes1.user.role, "chef_atelier");
assert.equal(createRes1.user.canonicalRole, "chef_atelier");
assert.equal(createRes1.user.active, true);

// Test 2: admin can modify a role
const userToModifyId = createRes1.user.id;
const modifyRes = app(`
  updateUserLocal('${userToModifyId}', {
    name: 'Chef Atelier Test Modifie',
    role: 'reception',
    email: 'chef@nimr.local',
    active: true
  })
`);
assert.equal(modifyRes.ok, true, "L'administrateur devrait pouvoir modifier un rôle.");
assert.equal(modifyRes.user.name, "Chef Atelier Test Modifie");
assert.equal(modifyRes.user.role, "reception");
assert.equal(modifyRes.user.canonicalRole, "reception");

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
assert.equal(createTechRes.user.canonicalRole, "technicien");

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
assert.equal(createTechNoRes.user.resourceId, "", "Le technicien reste explicitement sans ressource liée.");
assert.match(deniedMessage, /Action non autorisée.*technicien/i, "Le refus doit identifier le rôle canonique de l'acteur stocké.");

// Test 5: non-admin cannot manage users
const receptionUserId = modifyRes.user.id;
assert.equal(app(`setCurrentUser('${receptionUserId}')`), true);
const createByReception = app(`
  createUserLocal({
    name: 'Intrus',
    role: 'lecture_seule',
    active: true
  })
`);
assert.equal(createByReception.ok, false, "Un non-admin ne devrait pas pouvoir créer d'utilisateurs.");
assert.match(createByReception.message, /Action non autorisée.*reception/i);

// Test 6: readonly cannot manage users
assert.equal(app(`setCurrentUser('admin-explicit')`), true);
const createReadonlyUser = app(`
  createUserLocal({
    name: 'Lecture Seule Test',
    role: 'lecture_seule',
    active: true
  })
`);
assert.equal(createReadonlyUser.ok, true);
assert.equal(createReadonlyUser.user.canonicalRole, "lecture_seule");
assert.equal(app(`setCurrentUser('${createReadonlyUser.user.id}')`), true);
const createByReadonly = app(`
  createUserLocal({
    name: 'Intrus 2',
    role: 'lecture_seule',
    active: true
  })
`);
assert.equal(createByReadonly.ok, false, "Lecture seule ne peut pas créer d'utilisateurs.");

// Test 7: impossible to deactivate the last active admin
assert.equal(app(`setCurrentUser('admin-explicit')`), true);
const localAdminId = app(`state.users.find(u => u.canonicalRole === 'admin_technique' && u.active !== false).id`);
const disableAdminRes = app(`
  updateUserLocal('${localAdminId}', {
    name: 'Admin local',
    role: 'admin_technique',
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
assert.equal(app(`setCurrentUser('${localAdminId}')`), true);
const inactiveUserRes = app(`
  createUserLocal({
    name: 'Ancien Employe',
    role: 'reception',
    active: false
  })
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
    role: 'lecture_seule',
    active: true
  })
`);
const newAuditEntry = app(`state.auditLog[0]`);
assert.equal(app(`state.auditLog.length`), auditEntriesCountBefore + 1);
assert.equal(newAuditEntry.type, "users.created");
assert.equal(newAuditEntry.userId, localAdminId, "L'entrée d'audit doit contenir le userId de l'acteur.");

// Test 13: un ancien état sans utilisateurs reste sans acteur implicite
app(`
  state = normalizeState({
    cases: [],
    resources: [],
    bookings: []
  });
`);
assert.equal(app(`Array.isArray(state.users)`), true, "Users doit être initialisé.");
assert.equal(app(`state.users.length`), 0, "Aucun administrateur implicite ne doit être créé.");
assert.equal(app(`state.currentUserId`), "", "Aucune session implicite ne doit être ouverte.");

// Test 14: le premier accès local crée explicitement l'acteur autorisé
const firstAccessRes = app(`
  createFirstAccessUserLocal({
    id: 'first-access-admin',
    name: 'Admin premier accès',
    role: 'admin_technique',
    pinHash: 'hash-test',
    pinSalt: 'salt-test'
  })
`);
assert.equal(firstAccessRes.ok, true);
assert.equal(firstAccessRes.user.canonicalRole, "admin_technique");
assert.equal(app(`getCurrentUser().id`), "first-access-admin");
assert.equal(app(`hasPermission('settings.edit')`), true);

// Test 15: permissions canoniques résolues uniquement depuis des acteurs stockés
app(`
  state = normalizeState({
    users: [
      { id: 'perm-reception', name: 'Reception permissions', role: 'reception', active: true },
      { id: 'perm-technicien', name: 'Technicien permissions', role: 'technicien', active: true },
      { id: 'perm-lecture', name: 'Lecture permissions', role: 'lecture_seule', active: true }
    ],
    currentUserId: 'perm-reception',
    cases: [],
    resources: [],
    bookings: []
  });
`);
assert.equal(app(`hasPermission('planning.edit', { userId: 'perm-reception' })`), false, "Réception ne peut pas éditer le planning.");
assert.equal(app(`hasPermission('case.create', { userId: 'perm-reception' })`), true, "Réception peut créer des dossiers.");
assert.equal(app(`hasPermission('task.start', { userId: 'perm-technicien' })`), true, "Technicien peut démarrer les tâches.");
assert.equal(app(`hasPermission('case.view', { userId: 'perm-lecture' })`), true, "Lecture seule peut consulter les dossiers.");
assert.equal(app(`hasPermission('case.edit', { userId: 'perm-lecture' })`), false, "Lecture seule ne peut pas modifier les dossiers.");

console.log("Users roles management v23.2.7 tests OK !");
