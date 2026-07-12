import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { currentBuild, getVersionedAssetQueries } from './helpers/build_version.mjs';

console.log(`Demarrage tests ${currentBuild.appVersion} roles and governance hardening...`);

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
  'js/supabase-client.js',
  'app.js',
  'js/business-rules-v2187.js',
];

const source = scriptFiles
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n')
  .replace(/initApp\(\);/, '// initApp skipped by governance tests')
  .replace(/if \("serviceWorker" in navigator[\s\S]*$/u, '');

function stubElement() {
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    title: '',
    dataset: {},
    style: {},
    elements: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {},
    removeAttribute() {},
    remove() {},
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

const context = {
  console,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 },
  document: {
    querySelector: () => stubElement(),
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => stubElement(),
    body: stubElement(),
  },
  window: {
    addEventListener() {},
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    NIMR_SUPABASE_RUNTIME_CONFIG_KEY: 'nimr-supabase-runtime-config',
    NIMR_DEFAULT_WORKSHOP_ID: '00000000-0000-0000-0000-000000000001',
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

const stateSource = fs.readFileSync('js/state.js', 'utf8');
const appSource = fs.readFileSync('app.js', 'utf8');
const swSource = fs.readFileSync('sw.js', 'utf8');
const versionSource = fs.readFileSync('js/version.js', 'utf8');
const indexSource = fs.readFileSync('index.html', 'utf8');

assert.ok(stateSource.includes(`const APP_VERSION = "${currentBuild.appVersion}"`), 'APP_VERSION déclaré attendu');
assert.ok(appSource.includes(`serviceWorker.register("sw.js?v=${currentBuild.queryVersion}"`), 'service worker avec query déclarée attendu');
assert.ok(swSource.includes(`const CACHE_NAME = "${currentBuild.cacheName}"`), 'cache PWA déclaré attendu');
assert.ok(versionSource.includes(`window.NIMR_BUILD = "${currentBuild.buildVersion}"`), 'NIMR_BUILD déclaré attendu');
getVersionedAssetQueries(indexSource).forEach((queryVersion) => {
  assert.equal(queryVersion, currentBuild.queryVersion, `reference index.html incoherente: ?v=${queryVersion}`);
});
assert.match(indexSource, /Admin technique/, 'libelle UI Admin technique attendu');
assert.match(indexSource, /Directeur SAV[\s\S]*Pilotage métier/, 'resume permissions Directeur SAV attendu');
assert.match(stateSource, /const DIRECTOR_PERMISSIONS\s*=\s*\[[\s\S]*"audit\.view"[\s\S]*"dashboard\.view"[\s\S]*"export\.backup"[\s\S]*\]/, 'le directeur doit avoir des permissions metier explicites');
assert.match(stateSource, /directeur:\s*DIRECTOR_PERMISSIONS/, 'le role canonique directeur doit utiliser ses permissions explicites');
assert.equal(/directeur:\s*\[\s*"\*"\s*\]/.test(stateSource), false, 'le directeur ne doit pas recevoir un wildcard implicite');
assert.match(stateSource, /cleanLocalWorkstation\(\)[\s\S]*guardSensitiveAction\("workstation\.purge"\)/, 'nettoyage poste doit rester garde par workstation.purge');
assert.match(stateSource, /createUserLocal[\s\S]*hasPermission\("users\.manage"/, 'creation utilisateur doit rester gardee par users.manage');

function setupGovernanceRole(role) {
  app(`
    state = normalizeState({
      users: [
        { id: 'u-admin_technique', name: 'Admin technique', role: 'admin_technique', active: true },
        { id: 'u-directeur', name: 'Directeur SAV', role: 'directeur', active: true },
        { id: 'u-chef_atelier', name: 'Chef atelier', role: 'chef_atelier', active: true },
        { id: 'u-reception', name: 'Reception', role: 'reception', active: true },
        { id: 'u-technicien', name: 'Technicien', role: 'technicien', resourceId: 'tech-1', active: true },
        { id: 'u-lecture_seule', name: 'Lecture seule', role: 'lecture_seule', active: true }
      ],
      currentUserId: 'u-${role}',
      resources: [{ id: 'tech-1', name: 'Technicien 1', role: 'mecanicien', active: true }],
      cases: [{
        id: 'case-governance',
        clientName: 'Client Gouvernance',
        vehicle: 'Peugeot 208',
        plate: '111 TU 222',
        flags: {
          expertApproved: true,
          clientApproved: true,
          received: true,
          workStarted: true,
          workCompleted: true,
          invoiced: false
        },
        customerClaims: [{ id: 'claim-open', status: 'open', text: 'Reserve client' }],
        appointment: { start: '2026-06-03T08:00:00.000Z', delivery: '2026-06-03T18:00:00.000Z', end: '2026-06-03T09:00:00.000Z' },
        durations: { mechanical: 1 },
        claims: [{ type: 'client', includeInPlanning: true, clientApproved: true, expertApproved: true }],
        history: []
      }],
      auditLog: [],
      bookings: [{ id: 'booking-governance', caseId: 'case-governance', resourceIds: ['tech-1'], segments: [{ start: '2026-06-03T08:00:00.000Z', end: '2026-06-03T09:00:00.000Z' }], status: 'completed' }]
    });
  `);
}

setupGovernanceRole('directeur');
assert.equal(app(`getCurrentUser().canonicalRole`), 'directeur', 'la session doit utiliser le role canonique directeur');
const directorTabs = app('getAllowedTabsForCurrentUser()');
for (const tab of ['dossiers', 'today', 'pilotage', 'planning', 'atelier']) {
  assert.ok(directorTabs.includes(tab), `directeur SAV doit consulter ${tab}`);
}
assert.equal(app(`hasPermission('audit.view')`), true, 'directeur SAV peut consulter le journal');
assert.equal(app(`hasPermission('dashboard.view')`), true, 'directeur SAV peut consulter le dashboard performance');
assert.equal(app(`guardSensitiveAction('export.backup').ok`), true, 'directeur SAV peut exporter');
assert.equal(app(`guardDeliveryComplete(state.cases[0]).ok`), true, 'directeur SAV garde override livraison');
assert.equal(app(`guardSensitiveAction('settings.edit').ok`), true, 'directeur SAV peut administrer les reglages autorises');
assert.equal(app(`guardSensitiveAction('case.delete', { item: state.cases[0] }).ok`), false, 'directeur SAV ne peut pas supprimer donnees dossier');
assert.equal(app(`guardSensitiveAction('import.backup').ok`), true, 'directeur SAV peut restaurer une sauvegarde');
assert.equal(app(`guardSensitiveAction('supabase.configure').ok`), true, 'directeur SAV peut administrer la configuration cloud');
assert.equal(app(`guardSensitiveAction('users.manage').ok`), true, 'directeur SAV peut gerer les utilisateurs');
assert.equal(app(`guardAction('planning.edit').ok`), true, 'directeur SAV peut editer le planning');
assert.equal(app(`hasPermission('permission.inconnue')`), false, 'les permissions directeur restent explicites sans wildcard');

setupGovernanceRole('admin_technique');
assert.equal(app(`getCurrentUser().canonicalRole`), 'admin_technique', 'la session doit utiliser le role canonique admin technique');
assert.equal(app(`guardSensitiveAction('settings.edit').ok`), true, 'admin technique peut gerer parametres systeme sensibles');
assert.equal(app(`guardSensitiveAction('case.delete', { item: state.cases[0] }).ok`), true, 'admin technique peut supprimer donnees');
assert.equal(app(`guardSensitiveAction('import.backup').ok`), true, 'admin technique peut restaurer completement');
assert.equal(app(`guardSensitiveAction('supabase.configure').ok`), true, 'admin technique peut configurer Supabase');
assert.equal(app(`guardSensitiveAction('users.manage').ok`), true, 'admin technique peut gerer permissions critiques');

setupGovernanceRole('chef_atelier');
assert.equal(app(`guardAction('planning.edit').ok`), true, 'chef atelier conserve planning.edit');
assert.equal(app(`guardSensitiveAction('export.backup').ok`), true, 'chef atelier conserve export');
assert.equal(app(`guardSensitiveAction('supabase.configure').ok`), false, 'chef atelier ne configure pas Supabase');

setupGovernanceRole('reception');
assert.equal(app(`guardCaseCreate().ok`), true, 'reception conserve creation dossier');
assert.equal(app(`guardDeliveryComplete(state.cases[0]).ok`), true, 'reception conserve la permission livraison standard');
assert.equal(app(`canAdvanceReceptionStep(state.cases[0], 11, { role: 'reception' }).ok`), false, 'reception ne fait pas override avec reclamation ouverte');

setupGovernanceRole('technicien');
assert.equal(app(`hasPermission('task.start')`), true, 'technicien conserve task.start');
assert.equal(app(`guardSensitiveAction('export.backup').ok`), false, 'technicien ne fait pas export');

setupGovernanceRole('lecture_seule');
assert.equal(app(`getCurrentUser().canonicalRole`), 'lecture_seule', 'la session doit utiliser le role canonique lecture seule');
assert.equal(app(`hasPermission('dashboard.view')`), true, 'lecture seule peut consulter le dashboard performance');
assert.equal(app(`hasPermission('print.task')`), true, 'lecture seule conserve impression');
assert.equal(app(`guardCaseCreate().ok`), false, 'lecture seule ne cree pas');
assert.equal(app(`guardSensitiveAction('settings.edit').ok`), false, 'lecture seule ne touche pas aux reglages sensibles');

console.log(`Tests ${currentBuild.appVersion} roles and governance hardening OK`);
