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

const stateSource = fs.readFileSync('js/state.js', 'utf8');
const appSource = fs.readFileSync('app.js', 'utf8');
const swSource = fs.readFileSync('sw.js', 'utf8');
const versionSource = fs.readFileSync('js/version.js', 'utf8');
const indexSource = fs.readFileSync('index.html', 'utf8');
assert.match(stateSource, /APP_VERSION\s*=\s*"v23\.1\.8"/, 'APP_VERSION doit être en v23.1.8');
assert.match(appSource, /serviceWorker\.register\("sw\.js\?v=23\.1\.8"/, 'le service worker doit pointer vers sw.js?v=23.1.8');
assert.match(swSource, /nimr-sav-v23\.1\.8-roles-governance-hardening/, 'le cache PWA doit être en v23.1.8');
assert.match(versionSource, /NIMR_BUILD\s*=\s*"v23\.1\.8"/, 'js/version.js doit exposer v23.1.8');
[...indexSource.matchAll(/\?v=(\d+\.\d+(?:\.\d+)?)/g)].forEach((match) => {
  assert.equal(match[1], '23.1.8', `référence index.html incohérente: ?v=${match[1]}`);
});

app(`
  state = normalizeState({
    cases: [],
    resources: [{ id: 'tech-1', name: 'ALI', role: 'mecanicien', active: true }],
    bookings: []
  });
`);

assert.equal(app('Array.isArray(state.users)'), true, 'ancien state sans users doit migrer');
assert.equal(app('state.users.length >= 1'), true, 'bootstrap doit créer un utilisateur');
assert.equal(app('getCurrentUser().role'), 'admin', 'premier utilisateur local doit être admin');
assert.equal(app('Boolean(getCurrentUser() && getCurrentUser().active)'), true, 'un utilisateur courant actif ou de secours doit être retourné');

const actor = app('getCurrentActor()');
assert.equal(Boolean(actor.userId), true, 'acteur courant doit contenir userId');
assert.equal(actor.userRole, 'admin', 'acteur courant doit contenir userRole');
assert.equal(Boolean(actor.userName), true, 'acteur courant doit contenir userName');

app(`
  state = normalizeState({
    users: [{ id: 'u-admin', name: 'Chef SAV', role: 'admin', active: true }],
    currentUserId: 'u-admin',
    resources: [],
    bookings: [],
    cases: [{
      id: 'case-old-history',
      clientName: 'Client ancien',
      plate: '123TU1000',
      history: [{ id: 'h-old', at: '2026-01-01T08:00:00.000Z', type: 'note', label: 'Ancienne action', details: '', user: 'Atelier' }]
    }]
  });
`);
assert.equal(app('state.cases[0].history[0].user'), 'Atelier', 'ancien historique doit garder user Atelier');

app(`
  addHistory(state.cases[0], 'test.actor', 'Action avec acteur', 'Détail');
`);
assert.equal(app('state.cases[0].history[0].userId'), 'u-admin', 'nouvel historique doit contenir userId');
assert.equal(app('state.cases[0].history[0].userName'), 'Chef SAV', 'nouvel historique doit contenir userName');
assert.equal(app('state.cases[0].history[0].userRole'), 'admin', 'nouvel historique doit contenir userRole');
assert.equal(app('state.cases[0].history[0].user'), 'Chef SAV', 'champ user doit rester compatible');

assert.equal(app("hasPermission('settings.edit', { userId: 'u-admin' })"), true, 'admin technique doit tout autoriser');

app(`
  state = normalizeState({
    users: [
      { id: 'u-read', name: 'Lecture', role: 'readonly', active: true },
      { id: 'u-tech', name: 'Tech', role: 'technicien', resourceId: 'tech-1', active: true },
      { id: 'u-chef', name: 'Chef', role: 'chef_atelier', active: true }
    ],
    currentUserId: 'u-read',
    resources: [{ id: 'tech-1', name: 'Tech ressource', role: 'mecanicien', active: true }],
    bookings: [],
    cases: []
  });
`);
assert.equal(app("hasPermission('task.start')"), false, 'readonly ne doit pas avoir permission mutation');
assert.equal(app("hasPermission('print.task')"), true, 'readonly peut imprimer selon permissions minimales');
assert.equal(app('isReadOnlyMode()'), true, 'mode lecture seule doit être détecté');
assert.equal(app("setCurrentUser('u-tech')"), true, 'setCurrentUser doit accepter un utilisateur actif');
assert.equal(app('getCurrentUser().resourceId'), 'tech-1', 'technicien doit être lié à resourceId');
assert.equal(app("hasPermission('task.start')"), true, 'technicien doit avoir task.start');
assert.equal(app("canActOnTechnicianTask(getCurrentUser(), { resourceIds: ['tech-1'] })"), true, 'technicien doit agir sur sa ressource');
assert.equal(app("canActOnTechnicianTask(getCurrentUser(), { resourceIds: ['tech-2'] })"), false, 'technicien ne doit pas agir hors ressource');
assert.equal(app("canActOnTechnicianTask(getUserById('u-chef'), { resourceIds: ['tech-2'] })"), true, 'chef atelier doit pouvoir superviser');

app(`
  state = normalizeState({
    users: [
      { id: 'inactive-admin', name: 'Ancien admin', role: 'admin', active: false },
      { id: 'active-reception', name: 'Réception', role: 'reception', active: true }
    ],
    currentUserId: 'inactive-admin',
    resources: [],
    bookings: [],
    cases: []
  });
`);
assert.notEqual(app('state.currentUserId'), 'inactive-admin', 'utilisateur inactif ne doit pas rester sélectionné');
assert.equal(app('getCurrentUser().active'), true, 'fallback utilisateur actif obligatoire');

app(`
  state = normalizeState({
    users: [{ id: 'local-admin', name: 'Admin local', role: 'admin', active: true }],
    currentUserId: 'local-admin',
    resources: [],
    bookings: [],
    cases: []
  });
  syncCurrentUserWithSupabaseAuth({ id: 'auth-123', email: 'admin@nimr.local' });
`);
assert.equal(app('getCurrentUser().authUserId'), 'auth-123', 'authUserId Supabase doit pouvoir être lié');
assert.equal(app('getCurrentUser().email'), 'admin@nimr.local', 'email Supabase doit pouvoir être lié');

app(`
  state = normalizeState({
    cases: [],
    resources: [],
    bookings: []
  });
`);
assert.equal(app('getCurrentUser().role'), 'admin', 'offline/local sans Supabase doit fonctionner');

console.log('Users roles foundation v22.29 OK');
