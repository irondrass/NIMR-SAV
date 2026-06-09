import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

console.log('Demarrage tests v23.2.5 roles and governance hardening...');

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

assert.match(stateSource, /APP_VERSION\s*=\s*"v23\.2\.5"/, 'APP_VERSION v23.2.5 attendu');
assert.match(appSource, /serviceWorker\.register\("sw\.js\?v=23\.2\.5"/, 'service worker v23.2.5 attendu');
assert.match(swSource, /nimr-sav-v23\.2\.5-role-based-workspaces-qc-view/, 'cache PWA v23.2.5 attendu');
assert.match(versionSource, /NIMR_BUILD\s*=\s*"v23\.2\.5"/, 'version.js v23.2.5 attendu');
[...indexSource.matchAll(/\?v=(\d+\.\d+(?:\.\d+)?)/g)].forEach((match) => {
  assert.equal(match[1], '23.2.5', `reference index.html incoherente: ?v=${match[1]}`);
});
assert.match(indexSource, /Admin technique/, 'libelle UI Admin technique attendu');
assert.match(indexSource, /Directeur SAV[\s\S]*Pilotage métier/, 'resume permissions Directeur SAV attendu');
assert.match(stateSource, /directeur_sav:\s*\[[\s\S]*"audit\.view"[\s\S]*"dashboard\.view"[\s\S]*"export\.backup"[\s\S]*\]/, 'directeur_sav doit avoir des permissions metier explicites');
assert.equal(/directeur_sav:\s*\[\s*"\*"\s*\]/.test(stateSource), false, 'directeur_sav ne doit plus avoir le wildcard admin');
assert.match(stateSource, /cleanLocalWorkstation\(\)[\s\S]*guardSensitiveAction\("settings\.edit"\)/, 'nettoyage poste doit rester garde par settings.edit');
assert.match(stateSource, /createUserLocal[\s\S]*hasPermission\("users\.manage"/, 'creation utilisateur doit rester gardee par users.manage');

function setupGovernanceRole(role) {
  app(`
    state = normalizeState({
      users: [
        { id: 'u-admin', name: 'Admin technique', role: 'admin', active: true },
        { id: 'u-directeur_sav', name: 'Directeur SAV', role: 'directeur_sav', active: true },
        { id: 'u-chef_atelier', name: 'Chef atelier', role: 'chef_atelier', active: true },
        { id: 'u-reception', name: 'Reception', role: 'reception', active: true },
        { id: 'u-technicien', name: 'Technicien', role: 'technicien', resourceId: 'tech-1', active: true },
        { id: 'u-qualite', name: 'Qualite', role: 'qualite', active: true },
        { id: 'u-readonly', name: 'Lecture seule', role: 'readonly', active: true }
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
          qualityApproved: false,
          delivered: false,
          invoiced: false
        },
        receptionWorkflow: { qualityStatus: 'pending' },
        customerClaims: [{ id: 'claim-open', status: 'open', text: 'Reserve client' }],
        appointment: { start: '2026-06-03T08:00:00.000Z', delivery: '2026-06-03T18:00:00.000Z', end: '2026-06-03T09:00:00.000Z' },
        qualityChecklist: Object.fromEntries(DEFAULT_QUALITY_CHECKS.map(l => [l, true])),
        durations: { mechanical: 1, quality: 0.25 },
        claims: [{ type: 'client', includeInPlanning: true, clientApproved: true, expertApproved: true }],
        history: []
      }],
      auditLog: [],
      bookings: [{ id: 'booking-governance', caseId: 'case-governance', resourceIds: ['tech-1'], segments: [{ start: '2026-06-03T08:00:00.000Z', end: '2026-06-03T09:00:00.000Z' }], status: 'completed' }]
    });
  `);
}

setupGovernanceRole('directeur_sav');
const directorTabs = app('getAllowedTabsForCurrentUser()');
for (const tab of ['dossiers', 'today', 'pilotage', 'planning', 'atelier']) {
  assert.ok(directorTabs.includes(tab), `directeur SAV doit consulter ${tab}`);
}
assert.equal(app(`hasPermission('audit.view')`), true, 'directeur SAV peut consulter le journal');
assert.equal(app(`hasPermission('dashboard.view')`), true, 'directeur SAV peut consulter le dashboard performance');
assert.equal(app(`guardSensitiveAction('export.backup').ok`), true, 'directeur SAV peut exporter');
assert.equal(app(`guardDeliveryComplete(state.cases[0]).ok`), true, 'directeur SAV garde override livraison');
assert.equal(app(`canAdvanceReceptionStep(state.cases[0], 11, { role: 'directeur_sav' }).ok`), false, 'directeur SAV ne contourne pas un QC non valide');
app(`state.cases[0].flags.qualityApproved = true; state.cases[0].receptionWorkflow.qualityStatus = 'validated';`);
assert.equal(app(`canAdvanceReceptionStep(state.cases[0], 11, { role: 'directeur_sav' }).ok`), true, 'directeur SAV peut override livraison avec reclamation ouverte si QC valide');
assert.equal(app(`guardSensitiveAction('settings.edit').ok`), false, 'directeur SAV ne peut pas nettoyer poste');
assert.equal(app(`guardSensitiveAction('case.delete', { item: state.cases[0] }).ok`), false, 'directeur SAV ne peut pas supprimer donnees dossier');
assert.equal(app(`guardSensitiveAction('import.backup').ok`), false, 'directeur SAV ne peut pas restaurer completement');
assert.equal(app(`guardSensitiveAction('supabase.configure').ok`), false, 'directeur SAV ne peut pas modifier la config cloud critique');
assert.equal(app(`guardSensitiveAction('users.manage').ok`), false, 'directeur SAV ne gere pas les permissions critiques');
assert.equal(app(`guardAction('planning.edit').ok`), false, 'directeur SAV consulte le planning sans edition planning');

setupGovernanceRole('admin');
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

setupGovernanceRole('qualite');
assert.equal(app(`guardQualityValidate(state.cases[0]).ok`), true, 'qualite conserve validation qualite');
assert.equal(app(`guardDeliveryComplete(state.cases[0]).ok`), false, 'qualite ne livre pas');

setupGovernanceRole('readonly');
assert.equal(app(`hasPermission('dashboard.view')`), true, 'lecture seule peut consulter le dashboard performance');
assert.equal(app(`hasPermission('print.task')`), true, 'lecture seule conserve impression');
assert.equal(app(`guardCaseCreate().ok`), false, 'lecture seule ne cree pas');
assert.equal(app(`guardSensitiveAction('settings.edit').ok`), false, 'lecture seule ne touche pas aux reglages sensibles');

console.log('Tests v23.2.5 roles and governance hardening OK');
