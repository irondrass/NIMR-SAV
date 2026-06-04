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
  'js/supabase-client.js',
  'app.js',
  'js/business-rules-v2187.js',
];

const source = scriptFiles
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n')
  .replace(/initApp\(\);/, '// initApp skipped by permissions tests')
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
const uiCasesSource = fs.readFileSync('js/ui-cases.js', 'utf8');
const storageSource = fs.readFileSync('js/storage.js', 'utf8');
const exportsSource = fs.readFileSync('js/exports.js', 'utf8');
const estimateSource = fs.readFileSync('js/estimate-import.js', 'utf8');
const supabaseClientSource = fs.readFileSync('js/supabase-client.js', 'utf8');
const swSource = fs.readFileSync('sw.js', 'utf8');

assert.match(stateSource, /estimate\.import/, 'permission estimate.import attendue');
assert.match(stateSource, /appointment\.schedule/, 'permission appointment.schedule attendue');
assert.match(stateSource, /vehicle\.receive/, 'permission vehicle.receive attendue');
assert.match(storageSource, /guardSensitiveAction\("import\.backup"/, 'import backup doit être gardé avant restauration');
assert.match(storageSource, /guardSensitiveAction\("export\.backup"/, 'export backup doit être gardé');
assert.match(exportsSource, /guardSensitiveAction\("case\.delete"/, 'suppression dossier doit être gardée');
assert.match(estimateSource, /guardEstimateImport\(item\)/, 'import devis doit être gardé');
assert.match(supabaseClientSource, /guardSensitiveAction\("supabase\.configure"/, 'configuration Supabase doit être gardée');
assert.match(uiCasesSource, /guardWorkflowAction\(action, item, true\)/, 'workflow dossier doit être gardé côté fonction');
assert.match(swSource, /nimr-sav-v23\.0\.4-sync-conflict-resolution/, 'cache PWA v23.0.4 attendu');

function setupRole(role, extra = {}) {
  app(`
    state = normalizeState({
      users: [
        { id: 'u-admin', name: 'Admin SAV', role: 'admin', active: true },
        { id: 'u-chef', name: 'Chef atelier', role: 'chef_atelier', active: true },
        { id: 'u-reception', name: 'Réception', role: 'reception', active: true },
        { id: 'u-tech', name: 'Technicien', role: 'technicien', resourceId: 'tech-1', active: true },
        { id: 'u-qualite', name: 'Contrôle qualité', role: 'qualite', active: true },
        { id: 'u-readonly', name: 'Lecture seule', role: 'readonly', active: true }
      ],
      currentUserId: 'u-${role}',
      resources: [
        { id: 'tech-1', name: 'Technicien 1', role: 'mecanicien', active: true }
      ],
      cases: [{
        id: 'case-rq',
        clientName: 'Client Permission',
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
        appointment: { start: '2026-06-03T08:00:00.000Z', delivery: '2026-06-03T18:00:00.000Z', end: '2026-06-03T09:00:00.000Z' },
        qualityChecklist: Object.fromEntries(DEFAULT_QUALITY_CHECKS.map(l => [l, true])),
        durations: { mechanical: 1, quality: 0.25 },
        claims: [{ type: 'client', includeInPlanning: true, clientApproved: true, expertApproved: true, estimate: { lines: [{ phase: 'mechanical', operation: 'MO', laborHours: 1 }] } }],
        history: []
      }],
      auditLog: [],
      bookings: [{ id: 'b-rq-1', caseId: 'case-rq', resourceIds: ['tech-1'], segments: [{ start: '2026-06-03T08:00:00.000Z', end: '2026-06-03T09:00:00.000Z' }], status: 'completed' }]
    });
    state.currentUserId = '${extra.currentUserId || `u-${role}`}';
  `);
}

setupRole('reception');
assert.equal(app(`guardCaseCreate().ok`), true, 'réception peut créer dossier');
assert.equal(app(`guardEstimateImport(state.cases[0]).ok`), true, 'réception peut importer devis');
assert.equal(app(`guardAppointmentSchedule(state.cases[0]).ok`), true, 'réception peut planifier RDV');
assert.equal(app(`guardVehicleReceive(state.cases[0]).ok`), true, 'réception peut réceptionner véhicule');
assert.equal(app(`guardDeliveryComplete(state.cases[0]).ok`), true, 'réception peut livrer véhicule');
assert.equal(app(`guardSensitiveAction('case.delete', { item: state.cases[0] }).ok`), false, 'réception ne peut pas supprimer dossier');
assert.equal(app(`guardSensitiveAction('supabase.configure').ok`), false, 'réception ne configure pas Supabase');
assert.equal(app(`guardSensitiveAction('import.backup').ok`), false, 'réception ne restaure pas de sauvegarde');

setupRole('tech');
assert.equal(app(`guardVehicleReceive(state.cases[0]).ok`), false, 'technicien ne réceptionne pas véhicule');
assert.equal(app(`guardDeliveryComplete(state.cases[0]).ok`), false, 'technicien ne livre pas véhicule');
assert.equal(app(`guardQualityValidate(state.cases[0]).ok`), false, 'technicien ne valide pas qualité');
assert.equal(app(`guardSensitiveAction('export.backup').ok`), false, 'technicien ne fait pas de backup');

setupRole('qualite');
assert.equal(app(`guardQualityValidate(state.cases[0]).ok`), true, 'qualité peut valider qualité');
assert.equal(app(`guardAction('quality.reject', { item: state.cases[0] }).ok`), true, 'qualité peut refuser qualité');
assert.equal(app(`guardDeliveryComplete(state.cases[0]).ok`), false, 'qualité ne livre pas');
assert.equal(app(`applyWorkflowAction(state.cases[0], 'qualityApproved'); state.cases[0].flags.qualityApproved`), true, 'qualité peut appliquer validation qualité');
assert.equal(app(`state.cases[0].history[0].userId`), 'u-qualite', 'historique qualité contient userId');
assert.equal(app(`state.cases[0].history[0].userRole`), 'qualite', 'historique qualité contient userRole');

setupRole('readonly');
assert.equal(app(`guardCaseCreate().ok`), false, 'readonly ne crée pas');
assert.equal(app(`guardCaseEdit(state.cases[0]).ok`), false, 'readonly ne modifie pas');
assert.equal(app(`guardQualityValidate(state.cases[0]).ok`), false, 'readonly ne valide pas qualité');
assert.equal(app(`guardDeliveryComplete(state.cases[0]).ok`), false, 'readonly ne livre pas');
assert.equal(app(`guardSensitiveAction('export.backup').ok`), false, 'readonly ne fait aucune mutation sensible');
assert.match(app(`guardSensitiveAction('export.backup').message`), /lecture seule/i);

setupRole('admin');
assert.equal(app(`guardSensitiveAction('case.delete', { item: state.cases[0] }).ok`), true, 'admin peut supprimer dossier');
assert.equal(app(`guardSensitiveAction('import.backup').ok`), true, 'admin peut importer backup');
assert.equal(app(`guardSensitiveAction('settings.edit').ok`), true, 'admin peut modifier settings');
assert.equal(app(`guardSensitiveAction('supabase.configure').ok`), true, 'admin peut configurer Supabase');
app(`addAuditLog('case.deleted', 'Dossier supprimé', 'Test suppression', { item: state.cases[0] })`);
assert.equal(app(`state.auditLog[0].userId`), 'u-admin', 'audit suppression contient userId');
assert.equal(app(`state.auditLog[0].userRole`), 'admin', 'audit suppression contient userRole');
app(`addAuditLog('backup.imported', 'Sauvegarde importée', 'Test import')`);
app(`addAuditLog('backup.exported', 'Sauvegarde exportée', 'Test export')`);
assert.equal(app(`state.auditLog[0].userId`), 'u-admin', 'audit export contient acteur');
assert.equal(app(`state.auditLog[1].userName`), 'Admin SAV', 'audit import contient nom acteur');

setupRole('chef');
app(`state.cases[0].flags.qualityApproved = true;`);
assert.equal(app(`guardQualityValidate(state.cases[0]).ok`), true, 'chef atelier peut valider qualité');
assert.equal(app(`guardDeliveryComplete(state.cases[0]).ok`), true, 'chef atelier peut livrer');
assert.equal(app(`guardSensitiveAction('export.backup').ok`), true, 'chef atelier peut exporter backup');
assert.equal(app(`guardSensitiveAction('import.backup').ok`), false, 'chef atelier ne restaure pas backup');
assert.equal(app(`guardSensitiveAction('supabase.configure').ok`), false, 'chef atelier ne configure pas Supabase');
app(`applyWorkflowAction(state.cases[0], 'delivered')`);
assert.equal(app(`state.cases[0].history[0].userId`), 'u-chef', 'historique livraison contient userId');
assert.equal(app(`state.cases[0].history[0].userRole`), 'chef_atelier', 'historique livraison contient rôle');

setupRole('reception');
assert.equal(app(`canRenderAction('print.task')`), true, 'print.* autorise les impressions');
assert.equal(app(`hasPermission('print.*')`), true, 'réception conserve impression générale');
assert.equal(app(`guardSensitiveAction('export.backup').ok`), false, 'print.* ne donne pas export.backup');

setupRole('admin', { currentUserId: '' });
app(`state = normalizeState({ cases: [], resources: [], bookings: [] })`);
assert.equal(app(`getCurrentUser().role`), 'admin', 'bootstrap admin conserve le mode offline/local');

console.log('Users roles permissions reception/quality/sensitive OK');
