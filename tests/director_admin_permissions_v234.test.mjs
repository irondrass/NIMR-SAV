import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const scriptFiles = [
  'js/utils.js', 'js/state.js', 'js/ui-cases.js', 'js/ui-planning.js',
  'js/storage.js', 'js/planning.js', 'js/exports.js', 'js/supabase-client.js',
  'app.js',
];
const source = scriptFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n')
  .replace(/initApp\(\);/, '// initApp skipped by permissions tests')
  .replace(/if \("serviceWorker" in navigator[\s\S]*$/u, '');
const element = () => ({ value: '', textContent: '', innerHTML: '', hidden: false, disabled: false,
  title: '', dataset: {}, style: {}, elements: {}, classList: { add() {}, remove() {}, toggle() {} },
  setAttribute() {}, removeAttribute() {}, remove() {}, addEventListener() {}, querySelector: element,
  querySelectorAll: () => [], closest: () => null });
const context = {
  console,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 },
  document: { querySelector: element, querySelectorAll: () => [], addEventListener() {}, createElement: element, body: element() },
  window: { addEventListener() {}, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    NIMR_SUPABASE_RUNTIME_CONFIG_KEY: 'nimr-supabase-runtime-config',
    NIMR_DEFAULT_WORKSHOP_ID: '00000000-0000-0000-0000-000000000001' },
  navigator: { onLine: true }, fetch: async () => ({ ok: false }), setTimeout, clearTimeout,
  setInterval: () => 0, clearInterval() {}, Blob, URL: { createObjectURL: () => '', revokeObjectURL() {} },
  FileReader: class {}, crypto: { randomUUID: () => 'test-id' },
};
context.window = { ...context.window, ...context };
vm.createContext(context);
vm.runInContext(source, context);
const app = (code) => vm.runInContext(code, context);

app(`state = normalizeState({ users: [
  { id: 'director', name: 'Directeur SAV', role: 'directeur_sav', active: true },
  { id: 'admin', name: 'Admin technique', role: 'admin_technique', active: true },
  { id: 'chief', name: 'Chef atelier', role: 'chef_atelier', active: true },
  { id: 'reception', name: 'Réception', role: 'reception', active: true },
  { id: 'tech', name: 'Technicien', role: 'technicien', active: true },
  { id: 'readonly', name: 'Lecture seule', role: 'lecture_seule', active: true }
], currentUserId: 'director' })`);

for (const permission of ['dashboard.view', 'case.view', 'case.edit', 'planning.view', 'planning.edit',
  'task.override', 'quality.validate', 'quality.reject', 'delivery.complete', 'audit.view', 'notes.direction']) {
  assert.equal(app(`hasPermission(${JSON.stringify(permission)})`), true, `directeur autorisé: ${permission}`);
}
for (const permission of ['users.manage', 'supabase.configure', 'supabase.restore', 'system.security.edit',
  'workstation.purge', 'system.reset', 'import.backup', 'settings.edit', 'supabase.access']) {
  assert.equal(app(`guardSensitiveAction(${JSON.stringify(permission)}, {}, { notify: false }).ok`), false, `directeur refusé: ${permission}`);
}
assert.equal(app(`hasPermission('supabase.status.view')`), true, 'directeur voit la santé cloud en lecture seule');
assert.equal(app(`guardSensitiveAction('export.backup', {}, { notify: false }).ok`), true, 'directeur conserve export');
assert.equal(app(`state.currentUserId = 'admin'; guardSensitiveAction('supabase.configure', {}, { notify: false }).ok`), true, 'admin configure Supabase');
assert.equal(app(`guardSensitiveAction('supabase.restore', {}, { notify: false }).ok`), true, 'admin restaure Supabase');
assert.equal(app(`guardSensitiveAction('users.manage', {}, { notify: false }).ok`), true, 'admin gère les utilisateurs');
assert.equal(app(`hasPermission('supabase.status.view')`), true, 'admin voit la santé cloud');
const uiPanel = element();
const uiStatusPanel = element();
const uiConfig = element();
const uiAccess = element();
const uiRestore = element();
const uiImport = element();
uiConfig.dataset.supabaseAdminControl = 'configure';
uiAccess.dataset.supabaseAdminControl = 'access';
uiRestore.dataset.supabaseAdminControl = 'restore';
context.document.querySelectorAll = (selector) => selector === '[data-admin-technical-panel]'
  ? [uiPanel]
  : selector === '[data-supabase-status-panel]'
    ? [uiStatusPanel]
    : selector === '[data-supabase-admin-control]'
      ? [uiConfig, uiAccess, uiRestore]
      : [];
context.document.getElementById = (id) => ({
  'import-backup': uiImport,
}[id] || null);
app(`state.currentUserId = 'director'; renderAdminTechnicalVisibility()`);
assert.equal(uiStatusPanel.hidden, false, 'directeur voit le panneau de santé Supabase');
assert.equal(uiConfig.hidden, true, 'directeur ne voit pas la configuration Supabase');
assert.equal(uiAccess.hidden, true, 'directeur ne voit pas les actions cloud');
assert.equal(uiRestore.hidden, true, 'directeur ne voit pas les actions de restauration cloud');
assert.equal(uiImport.hidden, true, 'directeur ne voit pas l’import backup');
app(`state.currentUserId = 'admin'; renderAdminTechnicalVisibility()`);
assert.equal(uiStatusPanel.hidden, false, 'admin voit le panneau de santé Supabase');
assert.equal(uiConfig.hidden, false, 'admin voit la configuration Supabase');
assert.equal(uiAccess.hidden, false, 'admin voit les actions cloud');
assert.equal(uiRestore.hidden, false, 'admin voit les actions de restauration cloud');
assert.equal(uiImport.hidden, false, 'admin voit l’import backup');
assert.equal(app(`state.currentUserId = 'director'; normalizeUserRole('directeur_sav')`), 'directeur', 'alias historique directeur conservé');

const uiCases = fs.readFileSync('js/ui-cases.js', 'utf8');
const state = fs.readFileSync('js/state.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
assert.match(uiCases, /data-admin-technical-panel/);
assert.match(uiCases, /hasPermission\("users\.manage"/);
assert.match(uiCases, /hasPermission\("supabase\.status\.view"/);
assert.match(index, /data-supabase-status-panel/);
assert.match(index, /data-supabase-admin-control="configure"/);
assert.match(index, /data-supabase-admin-control="access"/);
assert.match(state, /cleanLocalWorkstation\(\)[\s\S]*guardSensitiveAction\("workstation\.purge"\)/);
assert.match(state, /createUserLocal[\s\S]*hasPermission\("users\.manage"/);
console.log('Director/Admin permission separation OK');
