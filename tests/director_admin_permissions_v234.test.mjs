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
for (const permission of ['supabase.access', 'supabase.configure', 'supabase.restore', 'import.backup',
  'users.manage', 'settings.edit', 'system.security.edit', 'workstation.purge', 'system.reset']) {
  assert.equal(app(`guardSensitiveAction(${JSON.stringify(permission)}, {}, { notify: false }).ok`), false, `directeur refusé: ${permission}`);
}
assert.equal(app(`hasPermission('supabase.status.view')`), true, 'directeur voit la santé cloud en lecture seule');
assert.equal(app(`hasPermission('supabase.sync.use')`), true, 'directeur peut synchroniser Supabase');
assert.equal(app(`hasPermission('supabase.session.manage')`), true, 'directeur peut gérer sa session Supabase');
assert.equal(app(`guardSensitiveAction('supabase.sync.use', {}, { notify: false }).ok`), true, 'directeur peut utiliser la synchronisation');
assert.equal(app(`guardSensitiveAction('supabase.session.manage', {}, { notify: false }).ok`), true, 'directeur peut ouvrir/fermer sa session');
assert.equal(app(`guardSensitiveAction('export.backup', {}, { notify: false }).ok`), true, 'directeur conserve export');
assert.equal(app(`state.currentUserId = 'admin'; guardSensitiveAction('supabase.configure', {}, { notify: false }).ok`), true, 'admin configure Supabase');
assert.equal(app(`guardSensitiveAction('supabase.restore', {}, { notify: false }).ok`), true, 'admin restaure Supabase');
assert.equal(app(`guardSensitiveAction('users.manage', {}, { notify: false }).ok`), true, 'admin gère les utilisateurs');
assert.equal(app(`hasPermission('supabase.status.view')`), true, 'admin voit la santé cloud');
assert.equal(app(`hasPermission('supabase.sync.use')`), true, 'admin peut synchroniser Supabase');
assert.equal(app(`hasPermission('supabase.session.manage')`), true, 'admin peut gérer sa session Supabase');
const uiPanel = element();
const uiStatusPanel = element();
const uiConfig = element();
const uiSync = element();
const uiSession = element();
const uiExport = element();
const uiRestore = element();
const uiImport = element();
uiConfig.dataset.supabaseAdminControl = 'configure';
uiSync.dataset.supabaseAdminControl = 'sync';
uiSession.dataset.supabaseAdminControl = 'session';
uiExport.dataset.supabaseAdminControl = 'export';
uiRestore.dataset.supabaseAdminControl = 'restore';
context.document.querySelectorAll = (selector) => selector === '[data-admin-technical-panel]'
  ? [uiPanel]
  : selector === '[data-supabase-status-panel]'
    ? [uiStatusPanel]
    : selector === '[data-supabase-admin-control]'
      ? [uiConfig, uiSync, uiSession, uiExport, uiRestore]
      : [];
context.document.getElementById = (id) => ({
  'import-backup': uiImport,
}[id] || null);
app(`state.currentUserId = 'director'; renderAdminTechnicalVisibility()`);
assert.equal(uiStatusPanel.hidden, false, 'directeur voit le panneau de santé Supabase');
assert.equal(uiConfig.hidden, true, 'directeur ne voit pas la configuration Supabase');
assert.equal(uiSync.hidden, false, 'directeur voit les actions de synchronisation');
assert.equal(uiSession.hidden, false, 'directeur voit les actions de session');
assert.equal(uiExport.hidden, false, 'directeur conserve les exports cloud');
assert.equal(uiRestore.hidden, true, 'directeur ne voit pas les actions de restauration cloud');
assert.equal(uiImport.hidden, true, 'directeur ne voit pas l’import backup');
app(`state.currentUserId = 'admin'; renderAdminTechnicalVisibility()`);
assert.equal(uiStatusPanel.hidden, false, 'admin voit le panneau de santé Supabase');
assert.equal(uiConfig.hidden, false, 'admin voit la configuration Supabase');
assert.equal(uiSync.hidden, false, 'admin voit les actions de synchronisation');
assert.equal(uiSession.hidden, false, 'admin voit les actions de session');
assert.equal(uiExport.hidden, false, 'admin voit les exports cloud');
assert.equal(uiRestore.hidden, false, 'admin voit les actions de restauration cloud');
assert.equal(uiImport.hidden, false, 'admin voit l’import backup');
assert.equal(app(`state.currentUserId = 'director'; normalizeUserRole('directeur_sav')`), 'directeur', 'alias historique directeur conservé');

const uiCases = fs.readFileSync('js/ui-cases.js', 'utf8');
const state = fs.readFileSync('js/state.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const sync = fs.readFileSync('js/supabase-sync.js', 'utf8');
assert.match(uiCases, /data-admin-technical-panel/);
assert.match(uiCases, /hasPermission\("users\.manage"/);
assert.match(uiCases, /hasPermission\("supabase\.status\.view"/);
assert.match(index, /data-supabase-status-panel/);
assert.match(index, /data-supabase-admin-control="configure"/);
assert.doesNotMatch(index, /data-supabase-admin-control="access"/);
assert.match(index, /data-supabase-admin-control="sync"/);
assert.match(index, /data-supabase-admin-control="session"/);
assert.match(index, /data-supabase-admin-control="export"/);
assert.match(sync, /signInSupabaseFromForm[\s\S]*guardSensitiveAction\("supabase\.session\.manage"/);
assert.match(sync, /signOutSupabase[\s\S]*guardSensitiveAction\("supabase\.session\.manage"/);
assert.match(sync, /pullLatestSupabaseBackup[\s\S]*supabase\.sync\.use/);
assert.match(sync, /startSupabaseLiveSync[\s\S]*supabase\.sync\.use/);
assert.match(sync, /processOfflineQueue[\s\S]*supabase\.sync\.use/);
assert.match(sync, /shouldAutoBackupToSupabase[\s\S]*hasPermission\("supabase\.sync\.use"/);
assert.match(state, /cleanLocalWorkstation\(\)[\s\S]*guardSensitiveAction\("workstation\.purge"\)/);
assert.match(state, /createUserLocal[\s\S]*hasPermission\("users\.manage"/);
console.log('Director/Admin permission separation OK');
