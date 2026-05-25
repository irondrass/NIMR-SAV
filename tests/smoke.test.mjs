import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const scriptFiles = [
  '../js/state.js',
  '../js/ui-cases.js',
  '../js/estimate-import.js',
  '../js/ui-planning.js',
  '../js/photos.js',
  '../js/storage.js',
  '../js/planning.js',
  '../js/exports.js',
  '../js/utils.js',
  '../app.js',
];

const appSource = scriptFiles
  .map((file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8'))
  .join('\n')
  .replace(/initApp\(\);/, '// initApp skipped by smoke tests')
  .replace(/if \("serviceWorker" in navigator[\s\S]*$/u, '');

function createElementStub() {
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    removeAttribute() {},
    toggleAttribute() {},
    addEventListener() {},
    append() {},
    appendChild() {},
    replaceChildren() {},
    querySelector: () => createElementStub(),
    querySelectorAll: () => [],
  };
}

const context = {
  console,
  localStorage: { getItem: () => null, setItem: () => {} },
  document: {
    querySelector: () => createElementStub(),
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => createElementStub(),
  },
  window: { addEventListener: () => {} },
  navigator: {},
  fetch: async () => ({ ok: false }),
  setTimeout,
  clearTimeout,
  Blob,
  URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
  FormData: class FormData {},
};

vm.createContext(context);
vm.runInContext(appSource, context, { filename: 'app.js' });

assert.equal(context.parseLocalizedDecimal('1,5'), 1.5, 'les décimales françaises doivent être acceptées');
assert.equal(context.formatLocalizedDecimal(1.5), '1,5', 'les heures doivent rester lisibles en français');
assert.equal(context.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;', 'les valeurs utilisateur injectées en HTML doivent être échappées');

assert.equal(context.shortVehicleModel('PICKUP DFM RICH6 4X4 EN SKD'), 'RICH 6', 'RICH6 sans espace doit être affiché seulement RICH 6');
assert.equal(context.shortVehicleModel('DFM RICH 6 4X2'), 'RICH 6', 'RICH 6 avec espace doit rester seulement RICH 6');

const normalized = context.normalizeState({
  ui: { caseStatusFilter: 'delivered', caseSort: 'client' },
  cases: [{ clientName: 'Test', flags: { delivered: true } }],
});
assert.equal(normalized.ui.caseStatusFilter, 'delivered', 'le filtre dossiers doit être conservé');
assert.equal(normalized.ui.caseSort, 'client', 'le tri dossiers doit être conservé');
assert.ok(normalized.resources.some((resource) => resource.role === 'cabine'), 'les ressources indispensables doivent être restaurées');

const badUi = context.normalizeState({ ui: { caseStatusFilter: 'bad', caseSort: 'bad' }, cases: [] });
assert.equal(badUi.ui.caseStatusFilter, 'all', 'un filtre invalide doit revenir à tous les statuts');
assert.equal(badUi.ui.caseSort, 'recent', 'un tri invalide doit revenir aux plus récents');

vm.runInContext(`state = normalizeState({ cases: [{ clientName: 'A', vin: 'VF123', plate: '123 TU 4567' }] });`, context);
assert.ok(context.findDuplicateCase({ vin: ' vf123 ', plate: '' }), 'la détection doublon VIN doit ignorer casse et espaces');
assert.ok(context.findDuplicateCase({ vin: '', plate: '123 tu 4567' }), 'la détection doublon immatriculation doit ignorer casse');
assert.equal(context.findDuplicateCase({ vin: 'NEW', plate: '999 TU 9999' }), null, 'un nouveau véhicule ne doit pas être signalé comme doublon');

const quickVehicleLookupRegression = JSON.parse(vm.runInContext(`(() => {
  vehicleRecords = [
    normalizeVehicleRecord({ vin: 'LGJF1EE26KT418026', plate: '5544TU243', vehicle: 'DFM S50', clientName: 'Client VIN' }),
    normalizeVehicleRecord({ vin: 'ZFA3120000J578190', plate: '2212TU189', vehicle: 'Fiat 500', clientName: 'Autre client' }),
  ];
  const byPlate = findVehicleRecordsByVehicleQuery('5544TU243', 5).map((record) => record.vin);
  const byVinPart = findVehicleRecordsByVehicleQuery('KT418', 5).map((record) => record.plate);
  return JSON.stringify({ byPlate, byVinPart });
})()`, context));
assert.deepEqual(quickVehicleLookupRegression.byPlate, ['LGJF1EE26KT418026'], 'le guichet rapide doit chercher depuis le champ immatriculation visible');
assert.deepEqual(quickVehicleLookupRegression.byVinPart, ['5544TU243'], 'le guichet rapide doit chercher par fragment de VIN');


const validBackup = context.validateBackupPayload({
  app: 'nimr-carrosserie',
  version: 2,
  appVersion: 'v21.3',
  exportedAt: '2026-05-12T10:00:00.000Z',
  state: { cases: [] },
  photos: [],
});
assert.equal(validBackup.isLegacy, false, 'une sauvegarde officielle doit être reconnue');
assert.deepEqual(validBackup.photos, [], 'les photos de sauvegarde doivent être transmises séparément');

assert.throws(
  () => context.validateBackupPayload({ app: 'autre-application', version: 2, state: { cases: [] } }),
  /ne provient pas de NIMR SAV/,
  'un JSON externe ne doit pas être accepté comme sauvegarde',
);
assert.throws(
  () => context.validateBackupPayload({ app: 'nimr-carrosserie', version: 99, state: { cases: [] } }),
  /version plus récente/,
  'une sauvegarde de format futur doit être refusée',
);
assert.throws(
  () => context.validateBackupPayload({ app: 'nimr-carrosserie', version: 2, appVersion: 'v99.0', state: { cases: [] } }),
  /plus récent que/,
  'une sauvegarde applicative future doit être refusée',
);
assert.equal(context.validateBackupPayload({ cases: [] }).isLegacy, true, 'les anciennes sauvegardes état brut restent importables');

const workflowWithReceivedVehicle = context.getWorkflowValues({
  photos: [],
  expertName: '',
  expertPhone: '',
  expertEmail: '',
  flags: { received: true },
  appointment: '2026-05-12T08:00:00',
  expertEstimate: {},
});
assert.equal(workflowWithReceivedVehicle.vehiclePending, true, 'en attente réception doit rester cochée après réception véhicule');
assert.equal(workflowWithReceivedVehicle.received, true, 'véhicule reçu doit être coché après réception');

const workflowWithoutReception = context.getWorkflowValues({
  photos: [],
  expertName: '',
  expertPhone: '',
  expertEmail: '',
  flags: { received: false },
  appointment: '2026-05-12T08:00:00',
  expertEstimate: {},
});
assert.equal(workflowWithoutReception.vehiclePending, true, 'en attente réception doit être cochée dès qu’un RDV est fixé');
assert.equal(workflowWithoutReception.received, false, 'véhicule reçu reste décoché avant réception physique');



const dressageDistribution = context.distributeLaborHours('DRESSAGE ET PEINTURE MALLE ARR', 8);
assert.equal(dressageDistribution.length, 3, 'DRESSAGE doit être réparti sur 3 phases');
assert.equal(JSON.stringify(dressageDistribution.map((d) => d.phase)), JSON.stringify(['body', 'prep', 'paint']), 'DRESSAGE doit aller vers tôlerie, préparation et peinture');
assert.equal(JSON.stringify(dressageDistribution.map((d) => d.laborHours)), JSON.stringify([2.666667, 2.666667, 2.666666]), 'DRESSAGE 8h doit être réparti en tiers précis');

const dressageOnlyDistribution = context.distributeLaborHours('DRESSAGE JUPE ARRIERE', 3);
assert.equal(JSON.stringify(dressageOnlyDistribution.map((d) => d.phase)), JSON.stringify(['body', 'prep', 'paint']), 'DRESSAGE seul doit suivre la même règle de tiers');
assert.equal(JSON.stringify(dressageOnlyDistribution.map((d) => d.laborHours)), JSON.stringify([1, 1, 1]), 'DRESSAGE 3h doit donner 1h par phase');


const parsedDressageEstimate = context.parseEstimateText(`D/P ET PREPARATION PARE CHOC ARR 2,5 33,000 82,500
PEINTURE ET FINITION PARE CHOC ARR 4,5 33,000 148,500
DRESSAGE ET PEINTURE JUPE ARRIERE 8 33,000 264,000
REMP FEU ARR GH FIX LED 0,5 33,000 16,500
REMP FEU ARR GH MOBILE LED 0,5 33,000 16,500
DRESSAGE ET PEINTURE MALLE ARR 8 33,000 264,000`);
assert.ok(Math.abs(parsedDressageEstimate.allocations.body - 6.583334) < 0.00001, 'le devis exemple doit garder les remplacements hors tôlerie');
assert.equal(parsedDressageEstimate.allocations.reassembly, 2.25, 'le devis exemple doit mettre les remplacements au remontage');
assert.ok(Math.abs(parsedDressageEstimate.allocations.prep - 7.583334) < 0.00001, 'le devis exemple doit répartir DRESSAGE en préparation');
assert.ok(Math.abs(parsedDressageEstimate.allocations.paint - 7.583332) < 0.00001, 'le devis exemple doit répartir DRESSAGE en peinture');

const normalizedDurations = context.normalizeState({ cases: [{ clientName: 'Durées', durations: { body: '-3', paint: '999', finish: '1,5' } }] });
assert.equal(normalizedDurations.cases[0].durations.body, 0, 'les durées négatives doivent être ramenées à zéro');
assert.equal(normalizedDurations.cases[0].durations.paint, 80, 'les durées irréalistes doivent être plafonnées');
assert.equal(normalizedDurations.cases[0].durations.finish, 1.5, 'les durées importées conservent les décimales françaises');

const normalizedBookings = context.normalizeState({
  resources: [{ id: 'r1', name: 'Tôlier', role: 'tolier', active: true }],
  cases: [{ id: 'c1', clientName: 'Planning' }],
  bookings: [
    { caseId: 'c1', title: 'OK', resourceIds: ['r1'], segments: [{ start: '2026-05-12T08:00:00.000Z', end: '2026-05-12T09:00:00.000Z' }] },
    { caseId: 'c1', title: 'KO', resourceIds: ['missing'], segments: [{ start: 'bad', end: 'bad' }] },
  ],
});
assert.equal(normalizedBookings.bookings.length, 1, 'les réservations invalides importées doivent être ignorées');

const earlyTaskCompletion = JSON.parse(vm.runInContext(`(() => {
  state = normalizeState({
    resources: [{ id: 'mec-1', name: 'Mécanicien', role: 'mecanicien', active: true }],
    cases: [{ id: 'early-case', clientName: 'Planning libéré', flags: { received: true, workStarted: true }, durations: { mechanical: 2, quality: 0 } }],
    bookings: [{
      id: 'booking-early',
      caseId: 'early-case',
      key: 'mechanical',
      title: 'Réparation mécanique',
      resourceIds: ['mec-1'],
      start: '2026-05-12T08:00:00.000Z',
      end: '2026-05-12T10:00:00.000Z',
      plannedStart: '2026-05-12T08:00:00.000Z',
      plannedEnd: '2026-05-12T10:00:00.000Z',
      plannedMinutes: 120,
      status: 'started',
      actualStart: '2026-05-12T08:00:00.000Z',
      segments: [{ start: '2026-05-12T08:00:00.000Z', end: '2026-05-12T10:00:00.000Z' }]
    }]
  });
  const item = state.cases[0];
  const result = completeCaseBookingTaskNow(item, 'booking-early', new Date('2026-05-12T08:30:00.000Z'));
  const booking = state.bookings.find((row) => row.id === 'booking-early');
  return JSON.stringify({ ok: result.ok, end: booking.end, status: booking.status, workCompleted: item.flags.workCompleted, minutes: getBookingDurationMinutes(booking) });
})()`, context));
assert.equal(earlyTaskCompletion.ok, true, 'terminer une tâche en avance doit réussir');
assert.equal(earlyTaskCompletion.end, '2026-05-12T08:30:00.000Z', 'la réservation doit être coupée à l’heure réelle de fin');
assert.equal(earlyTaskCompletion.minutes, 30, 'seule la durée réellement utilisée doit rester réservée');
assert.equal(earlyTaskCompletion.workCompleted, true, 'les travaux doivent passer terminés quand toutes les tâches productives sont clôturées');

const globalWorkCompletion = JSON.parse(vm.runInContext(`(() => {
  state = normalizeState({
    resources: [
      { id: 'mec-1', name: 'Mécanicien', role: 'mecanicien', active: true },
      { id: 'ctrl-1', name: 'Contrôle', role: 'controle', active: true }
    ],
    cases: [{ id: 'global-case', clientName: 'Clôture globale', flags: { received: true, workStarted: true }, durations: { mechanical: 2, electrical: 1, quality: 0.25 } }],
    bookings: [
      {
        id: 'booking-active',
        caseId: 'global-case',
        key: 'mechanical',
        title: 'Vidange rapide',
        resourceIds: ['mec-1'],
        start: '2026-05-12T08:00:00.000Z',
        end: '2026-05-12T10:00:00.000Z',
        plannedMinutes: 120,
        status: 'started',
        actualStart: '2026-05-12T08:00:00.000Z',
        segments: [{ start: '2026-05-12T08:00:00.000Z', end: '2026-05-12T10:00:00.000Z' }]
      },
      {
        id: 'booking-future',
        caseId: 'global-case',
        key: 'electrical',
        title: 'Diagnostic électrique',
        resourceIds: ['mec-1'],
        start: '2026-05-12T11:00:00.000Z',
        end: '2026-05-12T12:00:00.000Z',
        plannedMinutes: 60,
        status: 'planned',
        segments: [{ start: '2026-05-12T11:00:00.000Z', end: '2026-05-12T12:00:00.000Z' }]
      },
      {
        id: 'booking-quality',
        caseId: 'global-case',
        key: 'quality',
        title: 'Contrôle qualité',
        resourceIds: ['ctrl-1'],
        start: '2026-05-12T12:00:00.000Z',
        end: '2026-05-12T12:15:00.000Z',
        plannedMinutes: 15,
        status: 'planned',
        segments: [{ start: '2026-05-12T12:00:00.000Z', end: '2026-05-12T12:15:00.000Z' }]
      }
    ]
  });
  const item = state.cases[0];
  const result = completeCaseWorkBookingsNow(item, new Date('2026-05-12T08:30:00.000Z'));
  return JSON.stringify({
    completed: result.completed,
    removed: result.removed,
    freedMinutes: result.freedMinutes,
    keys: state.bookings.map((booking) => booking.key),
    activeEnd: state.bookings.find((booking) => booking.id === 'booking-active')?.end,
    qualityStatus: state.bookings.find((booking) => booking.key === 'quality')?.status,
  });
})()`, context));
assert.equal(globalWorkCompletion.completed, 2, 'Terminer travaux doit clôturer les réservations productives restantes');
assert.equal(globalWorkCompletion.removed, 1, 'les réservations productives futures doivent être supprimées pour libérer le planning');
assert.equal(globalWorkCompletion.activeEnd, '2026-05-12T08:30:00.000Z', 'la tâche en cours doit être tronquée à l’heure réelle de fin');
assert.deepEqual(globalWorkCompletion.keys, ['mechanical', 'quality'], 'le contrôle qualité doit rester planifié, mais les travaux futurs doivent être libérés');
assert.equal(globalWorkCompletion.qualityStatus, 'planned', 'Terminer travaux ne doit pas valider le contrôle qualité');

const alerts = context.buildPilotageAlerts(new Date('2026-05-12T12:00:00.000Z'));
assert.ok(Array.isArray(alerts), 'le pilotage doit produire une liste d’alertes');

const normalizedReception = context.normalizeState({
  cases: [{
    clientName: 'Réception',
    ownerName: 'Société Alpha',
    driverName: 'Chauffeur Atelier',
    driverPhone: '+216 22 333 444',
    arrivalNotes: 'Pare-chocs rayé à l’arrivée',
  }],
});
assert.equal(normalizedReception.cases[0].arrivalNotes, 'Pare-chocs rayé à l’arrivée', 'les observations de réception doivent être conservées');
assert.equal(normalizedReception.cases[0].ownerName, 'Société Alpha', 'la société/propriétaire doit être conservée');
assert.equal(normalizedReception.cases[0].driverName, 'Chauffeur Atelier', 'la personne déposante doit être conservée');
assert.equal(normalizedReception.cases[0].driverPhone, '+216 22 333 444', 'le téléphone déposant doit être conservé');

const quickManualCase = context.normalizeCase({
  id: 'quick-manual',
  clientName: 'Client manuel',
  plate: '100TU2000',
  claims: [{ id: 'claim-manual', type: 'mechanical_client', includeInPlanning: true, title: 'Diagnostic mécanique' }],
});
assert.equal(context.getNextWorkflowAction(quickManualCase), 'labor', 'un dossier rapide avec ordre déjà créé doit demander la saisie MO, pas la création d’un nouvel ordre');

vm.runInContext(`
state = normalizeState({
  cases: [],
  resources: [
    { id: 'tolier-1', name: 'Tôlier', role: 'tolier', active: true },
    { id: 'peintre-1', name: 'Peintre', role: 'peintre', active: true },
    { id: 'cabine-1', name: 'Cabine', role: 'cabine', active: true },
    { id: 'zone-1', name: 'Zone préparation', role: 'zone_preparation', active: true },
    { id: 'controle-1', name: 'Contrôle', role: 'controle', active: true }
  ]
});
`, context);
const approvalCase = context.normalizeCase({
  id: 'approval-case',
  clientName: 'Flux accords',
  plate: '100 TU 2000',
  insurance: 'Assurance',
  photos: [{ id: 'photo-1', category: 'before', name: 'avant.jpg' }],
  durations: { body: 1, prep: 1, paint: 1, reassembly: 1, finish: 1, quality: 1 },
  claims: [{
    id: 'claim-1',
    type: 'assurance',
    includeInPlanning: true,
    estimate: { lines: [{ phase: 'body', operation: 'Dépose', laborHours: 1 }] },
  }],
});
assert.equal(context.getNextWorkflowAction(approvalCase), 'expertApproved', 'le prochain jalon doit demander l’accord expert');
assert.equal(context.getBusinessRuleIssues(approvalCase, 'expertApproved').length, 0, 'le bouton accord expert ne doit pas être bloqué par l’accord qu’il doit justement valider');
context.applyWorkflowAction(approvalCase, 'expertApproved');
assert.equal(approvalCase.claims[0].expertApproved, true, 'l’action globale doit valider l’accord expert sur l’ordre inclus');
assert.equal(context.getNextWorkflowAction(approvalCase), 'appointment', 'après expert, le flux doit permettre un RDV prévisionnel avant validation client');
assert.equal(context.getBusinessRuleIssues(approvalCase, 'appointment').length, 0, 'le RDV prévisionnel ne doit pas être bloqué si la MO et les ressources sont prêtes');
assert.ok(context.getBusinessRuleWarnings(approvalCase, 'appointment').some((warning) => warning.includes('client/interne')), 'le RDV prévisionnel doit avertir sur la validation client/interne manquante');
assert.equal(context.getBusinessRuleIssues(approvalCase, 'clientApproved').length, 0, 'le bouton accord client ne doit pas être bloqué par l’accord qu’il doit valider');
context.applyWorkflowAction(approvalCase, 'clientApproved');
assert.equal(approvalCase.claims[0].clientApproved, true, 'l’action globale doit valider l’accord client sur l’ordre inclus');
assert.equal(context.getNextWorkflowAction(approvalCase), 'appointment', 'après les accords, le flux doit passer au RDV');


const columnarEstimateText = `Désignation
FEU ARRIÈRE GAUCHE FIXE LED
PRODUIT DE PEINTURE
D/P ET PREPARATION PARE CHOC ARR
PEINTURE ET FINITION PARE CHOC ARR
DRESSAGE ET PEINTURE JUPE ARRIERE
REMP FEU ARR GH FIX LED
REMP FEU ARR GH MOBILE LED
DRESSAGE ET PEINTURE MALLE ARR
PETIT FOURNITURE
Code modèle
Qté
Prix
unitaire
Montant
1
3
2,5
4,5
8
0,5
0,5
8
0,5
521,950
180,000
33,000
33,000
33,000
33,000
33,000
33,000
33,000`;
const parsedColumnarEstimate = context.parseEstimateText(columnarEstimateText);
assert.equal(parsedColumnarEstimate.detectedHours, 24, 'le devis PDF extrait en colonnes doit retrouver les 24h MO');
assert.ok(Math.abs(parsedColumnarEstimate.allocations.body - 6.583334) < 0.00001, 'le devis colonne doit garder les remplacements hors tôlerie');
assert.ok(Math.abs(parsedColumnarEstimate.allocations.prep - 7.583334) < 0.00001, 'le devis colonne doit répartir la préparation correctement');
assert.ok(Math.abs(parsedColumnarEstimate.allocations.paint - 7.583332) < 0.00001, 'le devis colonne doit répartir la peinture correctement');
assert.equal(parsedColumnarEstimate.allocations.reassembly, 2.25, 'le devis colonne doit conserver le remontage D/P et les remplacements');

const previewRatioEstimate = context.prepareEstimateImportPreview(parsedColumnarEstimate, { durations: { quality: 0.25 } });
const paintPlanningTotal = parsedColumnarEstimate.allocations.prep + parsedColumnarEstimate.allocations.paint;
assert.ok(Math.abs(previewRatioEstimate.durations.prep - context.roundPlanningHours(paintPlanningTotal * (2 / 3))) < 0.00001, 'la préparation planning doit prendre deux tiers du total préparation+peinture');
assert.ok(Math.abs(previewRatioEstimate.durations.paint - context.roundPlanningHours(paintPlanningTotal - previewRatioEstimate.durations.prep)) < 0.00001, 'la peinture planning doit prendre le tiers restant');


const normalizedSupplementState = context.normalizeState({
  cases: [{
    clientName: 'Complément',
    supplements: [{
      title: 'Renfort découvert',
      reason: 'Renfort arrière cassé après démontage',
      status: 'expert_pending',
      parts: [{ designation: 'Renfort pare-chocs arrière', quantity: '1' }],
      laborLines: [{ phase: 'body', operation: 'D/P renfort AR', laborHours: '1,5' }],
    }],
  }],
});
assert.equal(normalizedSupplementState.cases[0].supplements.length, 1, 'les compléments doivent être conservés dans la normalisation');
assert.equal(normalizedSupplementState.cases[0].supplements[0].laborLines[0].laborHours, 1.5, 'les heures MO complémentaires doivent accepter les décimales françaises');
assert.equal(vm.runInContext('PHOTO_CATEGORIES.supplement', context), 'Complément avant accord', 'la catégorie photo complément avant accord doit exister');


const activeClaimCase = context.normalizeCase({
  id: 'case-active-claim',
  clientName: 'Flux actif',
  plate: '111 TU 2222',
  insurance: 'Assurance',
  photos: [{ id: 'p1', name: 'apres.jpg', category: 'after' }],
  claims: [{
    title: 'Sinistre principal',
    includeInPlanning: true,
    expertApproved: false,
    clientApproved: false,
    estimate: { lines: [{ phase: 'body', operation: 'D/P aile', laborHours: 2 }] },
  }],
});
assert.ok(
  context.getBusinessRuleIssues(activeClaimCase, 'expertApproved').some((issue) => issue.includes('Avant réparation')),
  'l’accord expert doit exiger une vraie photo Avant réparation, pas une photo après réparation',
);

const excludedUnapprovedCase = context.normalizeCase({
  id: 'case-excluded-claim',
  clientName: 'Flux sinistre exclu',
  plate: '222 TU 3333',
  insurance: 'Assurance',
  photos: [{ id: 'p2', name: 'avant.jpg', category: 'before' }],
  durations: { body: 2, prep: 1, paint: 1, reassembly: 1, finish: 1, quality: 0.25 },
  claims: [
    {
      title: 'Sinistre inclus',
      includeInPlanning: true,
      expertApproved: true,
      clientApproved: true,
      estimate: { lines: [{ phase: 'body', operation: 'D/P aile', laborHours: 2 }] },
    },
    {
      title: 'Sinistre refusé/exclu',
      includeInPlanning: false,
      expertApproved: false,
      clientApproved: false,
      estimate: { lines: [] },
    },
  ],
});
context.refreshCaseApprovalFlagsFromClaims(excludedUnapprovedCase);
assert.equal(excludedUnapprovedCase.flags.expertApproved, true, 'un sinistre exclu sans accord ne doit pas bloquer le flux du sinistre inclus');
assert.equal(excludedUnapprovedCase.flags.clientApproved, true, 'un sinistre exclu sans accord client ne doit pas bloquer le RDV du sinistre inclus');
assert.equal(context.getNextWorkflowAction(excludedUnapprovedCase), 'appointment', 'le prochain flux doit aller au RDV quand le sinistre inclus est complet');

const appointmentWithoutLabor = context.normalizeCase({
  id: 'case-no-labor',
  clientName: 'Flux sans MO',
  plate: '333 TU 4444',
  insurance: 'Assurance',
  photos: [{ id: 'p3', name: 'avant.jpg', category: 'before' }],
  flags: { expertApproved: true, clientApproved: true },
  claims: [{ title: 'Sinistre', includeInPlanning: true, expertApproved: true, clientApproved: true, estimate: { lines: [] } }],
});
assert.ok(
  context.getBusinessRuleIssues(appointmentWithoutLabor, 'appointment').some((issue) => issue.includes('main-d’œuvre')),
  'un RDV atelier ne doit pas être calculé sans lignes de main-d’œuvre incluses',
);

const qualityGateCase = context.normalizeCase({
  id: 'case-quality-gate',
  clientName: 'Contrôle avec fin travaux',
  plate: '444 TU 5555',
  photos: [{ id: 'p-before', name: 'avant.jpg', category: 'before' }],
  flags: { expertApproved: true, clientApproved: true, received: true, workStarted: true },
  appointment: { start: '2026-05-12T08:00:00.000Z', delivery: '2026-05-12T09:00:00.000Z' },
  qualityChecklist: Object.fromEntries(vm.runInContext('DEFAULT_QUALITY_CHECKS', context).map((label) => [label, true])),
  claims: [{ type: 'client', includeInPlanning: true, expertApproved: true, clientApproved: true, estimate: { lines: [{ phase: 'body', operation: 'Réparation', laborHours: 1 }] } }],
});
vm.runInContext(`state.bookings = [{ id: 'b-quality', caseId: 'case-quality-gate', resourceIds: ['tolier-1'], segments: [{ start: '2026-05-12T08:00:00.000Z', end: '2026-05-12T09:00:00.000Z' }] }];`, context);
assert.equal(context.getNextWorkflowAction(qualityGateCase), 'workCompleted', 'le flux doit distinguer démarrage travaux et travaux terminés');
assert.ok(
  context.getBusinessRuleIssues(qualityGateCase, 'qualityApproved').some((issue) => issue.includes('travaux terminés')),
  'le contrôle qualité ne doit pas être validé avant fin travaux'
);
context.applyWorkflowAction(qualityGateCase, 'workCompleted');
assert.equal(context.getNextWorkflowAction(qualityGateCase), 'qualityApproved', 'après fin travaux, le flux doit passer au contrôle qualité');

const insuranceDeliveryCase = context.normalizeCase({
  id: 'case-delivery-photo',
  clientName: 'Livraison assurance',
  plate: '555 TU 6666',
  photos: [{ id: 'p-before-only', name: 'avant.jpg', category: 'before' }],
  flags: { expertApproved: true, clientApproved: true, received: true, workStarted: true, workCompleted: true, qualityApproved: true },
  appointment: { start: '2026-05-12T08:00:00.000Z', delivery: '2026-05-12T09:00:00.000Z' },
  claims: [{ type: 'assurance', includeInPlanning: true, expertApproved: true, clientApproved: true, estimate: { lines: [{ phase: 'body', operation: 'Réparation', laborHours: 1 }] } }],
});
vm.runInContext(`state.bookings = [{ id: 'b-delivery', caseId: 'case-delivery-photo', resourceIds: ['tolier-1'], segments: [{ start: '2026-05-12T08:00:00.000Z', end: '2026-05-12T09:00:00.000Z' }] }];`, context);
assert.ok(
  context.getBusinessRuleIssues(insuranceDeliveryCase, 'delivered').some((issue) => issue.includes('Après réparation')),
  'la livraison assurance doit exiger au moins une photo après réparation'
);
insuranceDeliveryCase.photos.push({ id: 'p-after', name: 'apres.jpg', category: 'after' });
assert.equal(context.getBusinessRuleIssues(insuranceDeliveryCase, 'delivered').length, 0, 'la photo après réparation doit débloquer la livraison assurance');

const zeroLaborApprovalCase = context.normalizeCase({
  id: 'case-zero-labor-approval',
  clientName: 'Validation MO zéro',
  plate: '777 TU 8888',
  insurance: 'Assurance',
  photos: [{ id: 'p-before-zero', name: 'avant.jpg', category: 'before' }],
  claims: [{ type: 'assurance', includeInPlanning: true, expertApproved: false, clientApproved: false, estimate: { lines: [{ phase: 'body', operation: 'Pièce seule', laborHours: 0 }] } }],
});
assert.ok(
  context.validateClaimFieldChange(zeroLaborApprovalCase, zeroLaborApprovalCase.claims[0], 'expertApproved', true).some((issue) => issue.includes('main-d’œuvre')),
  'un accord expert ne doit pas accepter un devis sans heure de main-d’œuvre réelle',
);
assert.ok(
  context.validateClaimFieldChange(zeroLaborApprovalCase, zeroLaborApprovalCase.claims[0], 'clientApproved', true).some((issue) => issue.includes('main-d’œuvre')),
  'un accord client ne doit pas accepter un devis avec uniquement des lignes à 0 h',
);

const inconsistentDeliveryCase = context.normalizeCase({
  id: 'case-delivery-sequence',
  clientName: 'Livraison incohérente',
  plate: '888 TU 9999',
  photos: [{ id: 'p-after-sequence', name: 'apres.jpg', category: 'after' }],
  flags: { qualityApproved: true },
  claims: [{ type: 'client', includeInPlanning: true, expertApproved: true, clientApproved: true, estimate: { lines: [{ phase: 'mechanical', operation: 'Réparation', laborHours: 1 }] } }],
});
assert.ok(
  context.getBusinessRuleIssues(inconsistentDeliveryCase, 'delivered').some((issue) => issue.includes('réception physique')),
  'la livraison doit refuser un dossier qualité importé sans réception véhicule',
);
assert.ok(
  context.getBusinessRuleIssues(inconsistentDeliveryCase, 'delivered').some((issue) => issue.includes('Aucune affectation')),
  'la livraison doit refuser un dossier sans affectation atelier',
);

console.log('Smoke tests OK');

vm.runInContext(`
state = normalizeState({
  settings: { calendar: { 0: '', 1: '08:00-12:00,14:00-17:00', 2: '08:00-12:00,14:00-17:00', 3: '08:00-12:00,14:00-17:00', 4: '08:00-12:00,14:00-17:00', 5: '08:00-12:00,14:00-17:00', 6: '08:00-12:00' } },
  resources: [
    { id: 'tolier-a', name: 'A', role: 'tolier', active: true },
    { id: 'tolier-b', name: 'B', role: 'tolier', active: true },
    { id: 'peintre-a', name: 'P1', role: 'peintre', active: true },
    { id: 'peintre-b', name: 'P2', role: 'peintre', active: true },
    { id: 'zone-a', name: 'Zone', role: 'zone_preparation', active: true },
    { id: 'cabine-a', name: 'Cabine', role: 'cabine', active: true },
    { id: 'controle-a', name: 'QC', role: 'controle', active: true },
  ],
  bookings: [
    { id: 'old', caseId: 'old', key: 'body', title: 'Ancienne charge', primaryResourceId: 'tolier-a', resourceIds: ['tolier-a'], segments: [{ start: '2026-05-13T08:00:00.000Z', end: '2026-05-13T12:00:00.000Z' }] },
  ],
  cases: [],
});
`, context);
const balancedProposal = context.schedulePipeline({ id: 'case-balance', durations: { body: 1, reassembly: 1, prep: 1, paint: 1 } }, new Date('2026-05-13T08:00:00.000Z'), vm.runInContext('state.bookings', context));
const bodyStep = balancedProposal.steps.find((step) => step.key === 'body');
const reassemblyStep = balancedProposal.steps.find((step) => step.key === 'reassembly');
const prepStep = balancedProposal.steps.find((step) => step.key === 'prep');
const paintStep = balancedProposal.steps.find((step) => step.key === 'paint');
assert.equal(bodyStep.primaryResourceId, 'tolier-b', 'le planning doit équilibrer la charge entre tôliers et choisir le moins chargé');
assert.equal(reassemblyStep.primaryResourceId, bodyStep.primaryResourceId, 'le remontage doit rester chez le même tôlier que la tôlerie/démontage');
assert.equal(paintStep.primaryResourceId, prepStep.primaryResourceId, 'la peinture doit rester chez le même peintre que la préparation quand il est disponible');

vm.runInContext(`state = normalizeState({
  cases: [],
  resources: [
    { id: 't1', name: 'SASSI', role: 'tolier', location: 'Poste A', active: true },
    { id: 't2', name: 'IMED', role: 'tolier', location: 'Poste B', active: true },
    { id: 'p1', name: 'ANIS', role: 'peintre', location: 'Zone peinture', active: true },
    { id: 'p2', name: 'KHAIRI', role: 'peintre', location: 'Préparation', active: true },
    { id: 'z1', name: 'Zone préparation 1', role: 'zone_preparation', location: 'Zone 1', active: true },
    { id: 'c1', name: 'Cabine peinture', role: 'cabine', location: 'Cabine 1', active: true },
    { id: 'q1', name: 'Chef atelier', role: 'controle', location: 'Final', active: true },
  ],
  workHours: { monday: '08:00-12:00,14:00-17:00', tuesday: '08:00-12:00,14:00-17:00', wednesday: '08:00-12:00,14:00-17:00', thursday: '08:00-12:00,14:00-17:00', friday: '08:00-12:00,14:00-17:00', saturday: '08:00-12:00', sunday: 'closed' },
  bookings: [],
});`, context);
const continuityItem = { id: 'case-continuity', durations: { body: 2, prep: 1.5, paint: 1.5, reassembly: 1, finish: 0.5, quality: 0.25 } };
const continuityProposal = context.generateSingleProposal(continuityItem, new Date('2026-05-14T08:00:00.000Z'));
const continuityBodyStep = continuityProposal.steps.find((step) => step.key === 'body');
const continuityReassemblyStep = continuityProposal.steps.find((step) => step.key === 'reassembly');
const continuityPrepStep = continuityProposal.steps.find((step) => step.key === 'prep');
const continuityPaintStep = continuityProposal.steps.find((step) => step.key === 'paint');
const continuityFinishStep = continuityProposal.steps.find((step) => step.key === 'finish');
assert.equal(continuityReassemblyStep.primaryResourceId, continuityBodyStep.primaryResourceId, 'le tôlier du démontage doit conserver le remontage');
assert.equal(continuityPaintStep.primaryResourceId, continuityPrepStep.primaryResourceId, 'le peintre de la préparation doit conserver la peinture');
assert.equal(continuityFinishStep.primaryResourceId, continuityPrepStep.primaryResourceId, 'le peintre de la préparation doit conserver la finition');
assert.ok(continuityPrepStep.equipmentResourceIds.includes('z1'), 'la zone de préparation doit rester réservée');
assert.ok(continuityPaintStep.equipmentResourceIds.includes('c1'), 'la cabine peinture doit rester réservée');

vm.runInContext(`state = normalizeState({
  cases: [],
  resources: [
    { id: 't-order', name: 'Tolier', role: 'tolier', active: true },
    { id: 'm-order', name: 'Mecanicien', role: 'mecanicien', active: true },
    { id: 'e-order', name: 'Electricien', role: 'electricien', active: true },
    { id: 'p-order', name: 'Peintre', role: 'peintre', active: true },
    { id: 'zone-order', name: 'Zone', role: 'zone_preparation', active: true },
    { id: 'cabine-order', name: 'Cabine', role: 'cabine', active: true },
    { id: 'pont-order', name: 'Pont', role: 'pont_mecanique', active: true },
  ],
  bookings: [],
});`, context);
const sinistreOrder = context.schedulePipeline({ id: 'case-sequence', durations: { body: 1, mechanical: 1, prep: 1, paint: 1, electrical: 1, reassembly: 1 } }, new Date('2026-05-18T08:00:00.000Z'), []);
const orderKeys = sinistreOrder.steps.map((step) => step.key).join('>');
assert.equal(orderKeys, 'body>mechanical>prep>paint>electrical>reassembly', 'ordre SAV sinistre attendu: tôlerie, mécanique, préparation, peinture, électrique, remontage');
console.log('Planning sequence regression OK');

const clientFastCase = context.normalizeCase({
  clientName: 'Client rapide',
  claims: [{
    type: 'vidange',
    includeInPlanning: true,
    expertApproved: true,
    clientApproved: true,
    estimate: { lines: [{ phase: 'oilService', operation: 'VIDANGE', laborHours: 1.5 }] },
  }],
});
context.recomputeCaseDurationsFromClaims(clientFastCase);
assert.equal(clientFastCase.durations.finish, 0, 'les ordres client hors sinistre ne doivent pas ajouter finition/lavage');
assert.equal(clientFastCase.durations.quality, 0.25, 'les réparations rapides client doivent garder 15 min de contrôle qualité');

const manualLaborLine = context.buildManualClaimLaborLine({ phase: 'mechanical', operation: 'Diagnostic freinage', laborHours: '1,5' });
const manualLaborCase = context.normalizeCase({
  clientName: 'MO manuelle',
  claims: [{
    type: 'mechanical_client',
    includeInPlanning: true,
    expertApproved: true,
    clientApproved: true,
    estimate: { originalLines: [manualLaborLine] },
  }],
});
context.recomputeCaseDurationsFromClaims(manualLaborCase);
assert.equal(manualLaborCase.durations.mechanical, 1.5, 'la main-d’œuvre manuelle d’un ordre doit alimenter les durées planning');
vm.runInContext(`state = normalizeState({
  cases: [],
  resources: [
    { id: 'mec-manual', name: 'Mécanicien manuel', role: 'mecanicien', active: true },
    { id: 'pont-manual', name: 'Pont mécanique manuel', role: 'pont_mecanique', active: true },
    { id: 'quality-manual', name: 'Contrôle manuel', role: 'controle', active: true }
  ],
  bookings: []
});`, context);
const manualPlanningProposal = context.generateSingleProposal(manualLaborCase, new Date('2026-05-19T08:00:00.000Z'));
assert.ok(manualPlanningProposal.steps.some((step) => step.key === 'mechanical'), 'un ordre sans devis mais avec MO manuelle doit pouvoir réserver le planning mécanique');
assert.equal(context.isClientOnlyRepairClaim({ type: 'garantie' }), true, 'un ordre garantie ne doit pas demander un expert assurance');

const clientLongCase = context.normalizeCase({
  clientName: 'Client long',
  claims: [{
    type: 'mechanical_client',
    includeInPlanning: true,
    expertApproved: true,
    clientApproved: true,
    estimate: { lines: [{ phase: 'mechanical', operation: 'REPARATION MECANIQUE', laborHours: 6 }] },
  }],
});
context.recomputeCaseDurationsFromClaims(clientLongCase);
assert.equal(clientLongCase.durations.finish, 0, 'les réparations longues client ne doivent pas ajouter finition/lavage');
assert.equal(clientLongCase.durations.quality, 0.25, 'le contrôle qualité doit rester forfaitaire à 0,25 h');

const insuranceCase = context.normalizeCase({
  clientName: 'Sinistre',
  claims: [{
    type: 'assurance',
    includeInPlanning: true,
    estimate: { lines: [{ phase: 'body', operation: 'TOLERIE', laborHours: 2 }] },
  }],
});
context.recomputeCaseDurationsFromClaims(insuranceCase);
assert.equal(insuranceCase.durations.finish, 0, 'sans peinture, les sinistres ne doivent pas ajouter finition/lavage');
assert.equal(insuranceCase.durations.quality, 0.25, 'le contrôle qualité sinistre doit rester forfaitaire à 0,25 h');
console.log('Client order quality regression OK');

assert.equal(context.getTabForAction('expertApproved'), 'claims', 'Continuer sur accord expert doit ouvrir Ordres & devis');
assert.equal(context.getTabForAction('clientApproved'), 'claims', 'Continuer sur accord client doit ouvrir Ordres & devis');

const clientWorkflowCase = context.normalizeCase({
  clientName: 'Client carrosserie',
  plate: '901 TU 2026',
  claims: [{
    type: 'client',
    includeInPlanning: true,
    expertApproved: true,
    clientApproved: false,
    estimateNumber: 'DV-SRV-CH26001628',
    orNumber: 'OR-SRV-CH2602232',
    estimate: { lines: [{ phase: 'reassembly', operation: 'REMPL SERRURE', laborHours: 1 }] },
  }],
});
assert.equal(context.getNextWorkflowAction(clientWorkflowCase), 'appointment', 'un ordre client doit pouvoir réserver un RDV prévisionnel sans repasser par expert');
assert.equal(context.getWorkflowStepsForCase(clientWorkflowCase).some(([key]) => key === 'expertApproved'), false, 'le process client doit masquer accord expert');
assert.equal(context.getWorkflowStepsForCase(clientWorkflowCase).some(([key]) => key === 'expert'), false, 'le process client doit masquer expert assigné');
assert.equal(context.inferOrderTypeFromEstimate({ laborLines: [{ operation: 'rempl serrure av gh', text: 'rempl serrure av gh 1 35,000 35,000' }] }), 'client', 'un remplacement carrosserie client doit proposer Carrosserie client');
assert.equal(context.inferOrderTypeFromEstimate({ laborLines: [{ operation: 'vidange moteur', text: 'vidange moteur 1 35,000 35,000' }] }), 'vidange', 'un devis vidange doit proposer ordre vidange');
assert.equal(context.shouldClearPlanningAfterClaimFieldChange('clientApproved', true), false, 'valider client/interne après un RDV prévisionnel ne doit pas annuler le planning');
assert.equal(context.shouldClearPlanningAfterClaimFieldChange('clientApproved', false), true, 'retirer la validation client/interne doit annuler le planning');

const fastStartCase = context.normalizeCase({
  id: 'case-fast-start',
  clientName: 'Service rapide réel',
  plate: '111 TU 2222',
  flags: { received: true },
  appointment: { start: '2026-05-12T08:00:00.000Z', end: '2026-05-12T09:00:00.000Z', delivery: '2026-05-12T09:15:00.000Z' },
  claims: [{
    type: 'vidange',
    includeInPlanning: true,
    expertApproved: true,
    clientApproved: false,
    estimate: { lines: [{ phase: 'oilService', operation: 'VIDANGE MOTEUR', laborHours: 1 }] },
  }],
});
vm.runInContext(`state.bookings = [{ id: 'fast-booking', caseId: 'case-fast-start', key: 'oilService', resourceIds: ['pont-1'], segments: [{ start: '2026-05-12T08:00:00.000Z', end: '2026-05-12T09:00:00.000Z' }] }];`, context);
assert.ok(context.getBusinessRuleIssues(fastStartCase, 'workStarted').some((issue) => issue.includes('client/interne')), 'le démarrage réel doit rester bloqué sans validation client/interne');
context.applyWorkflowAction(fastStartCase, 'clientApproved');
assert.equal(context.getBusinessRuleIssues(fastStartCase, 'workStarted').length, 0, 'la validation client/interne doit débloquer le démarrage service rapide');
console.log('Client workflow summary regression OK');

const noShowAppointmentCase = context.normalizeCase({
  id: 'case-no-show',
  clientName: 'Absent RDV',
  plate: '909 TU 2026',
  appointmentStatus: 'no_show',
  appointment: { start: '2026-05-20T08:00:00.000Z', end: '2026-05-20T10:00:00.000Z', delivery: '2026-05-20T10:30:00.000Z' },
  claims: [{
    type: 'mechanical_client',
    includeInPlanning: true,
    expertApproved: true,
    clientApproved: true,
    estimate: { lines: [{ phase: 'mechanical', operation: 'Diagnostic', laborHours: 1 }] },
  }],
});
assert.equal(context.getNextWorkflowAction(noShowAppointmentCase), 'appointment', 'un client absent doit retourner vers le report RDV, pas vers la réception');
assert.ok(context.getBusinessRuleIssues(noShowAppointmentCase, 'received').some((issue) => issue.includes('Reporter le RDV')), 'la réception doit rester bloquée tant que le RDV absent n’est pas reporté');

const noIdentityCase = context.normalizeCase({
  id: 'case-no-identity',
  clientName: 'Identité manquante',
  vehicle: 'Véhicule',
  claims: [{ type: 'client', includeInPlanning: true, expertApproved: true, clientApproved: true, estimate: { lines: [{ phase: 'mechanical', operation: 'Diagnostic', laborHours: 1 }] } }],
});
assert.equal(context.getCaseNextAction(noIdentityCase).code, 'complete_vehicle_identity', 'un dossier sans VIN/immat doit demander l’identité véhicule');

const noLaborCockpitCase = context.normalizeCase({
  id: 'case-no-labor-cockpit',
  clientName: 'Sans MO',
  plate: '101 TU 2026',
  claims: [{ type: 'client', includeInPlanning: true, expertApproved: true, clientApproved: true, estimate: { lines: [] } }],
});
assert.equal(context.getCaseNextAction(noLaborCockpitCase).code, 'add_labor', 'un dossier sans main-d’œuvre doit demander la MO');

const laborNoPlanningCase = context.normalizeCase({
  id: 'case-labor-no-planning',
  clientName: 'MO sans planning',
  plate: '102 TU 2026',
  claims: [{ type: 'mechanical_client', includeInPlanning: true, expertApproved: true, clientApproved: true, estimate: { lines: [{ phase: 'mechanical', operation: 'Réparation', laborHours: 2 }] } }],
});
assert.equal(context.getCaseNextAction(laborNoPlanningCase).code, 'schedule_work', 'un dossier avec MO mais sans planning doit proposer de planifier les travaux');

const blockedCockpitCase = context.normalizeCase({
  id: 'case-blocked-cockpit',
  clientName: 'Pièces attente',
  plate: '103 TU 2026',
  partsStatus: 'waiting_parts',
  blockerReason: 'waiting_parts',
  blockerDetails: 'Pare-chocs non reçu',
  claims: [{ type: 'client', includeInPlanning: true, expertApproved: true, clientApproved: true, estimate: { lines: [{ phase: 'body', operation: 'Réparation', laborHours: 1 }] } }],
});
assert.equal(context.isCaseBlocked(blockedCockpitCase), true, 'un statut pièces bloquant doit bloquer le dossier');
assert.equal(context.getCaseNextAction(blockedCockpitCase).code, 'resolve_blocker', 'un dossier bloqué doit prioriser la résolution du blocage');
blockedCockpitCase.partsStatus = 'available';
blockedCockpitCase.blockerReason = '';
blockedCockpitCase.blockerDetails = '';
assert.equal(context.isCaseBlocked(blockedCockpitCase), false, 'retirer statut/motif doit débloquer le dossier');

const cockpitFlowCase = context.normalizeCase({
  id: 'case-flow-cockpit',
  clientName: 'Flux cockpit',
  plate: '104 TU 2026',
  appointment: { start: '2026-05-25T08:00:00.000Z', end: '2026-05-25T10:00:00.000Z', delivery: '2026-05-25T17:00:00.000Z' },
  flags: { received: true, workStarted: true, workCompleted: true },
  claims: [{ type: 'client', includeInPlanning: true, expertApproved: true, clientApproved: true, estimate: { lines: [{ phase: 'mechanical', operation: 'Réparation', laborHours: 2 }] } }],
});
vm.runInContext(`state.bookings = [{ id: 'flow-booking', caseId: 'case-flow-cockpit', key: 'mechanical', resourceIds: ['pont-1'], segments: [{ start: '2026-05-25T08:00:00.000Z', end: '2026-05-25T10:00:00.000Z' }] }];`, context);
const cockpitFlow = context.getCaseStageFlow(cockpitFlowCase);
assert.equal(cockpitFlow.length, 10, 'le fil cockpit doit contenir les 10 étapes métier demandées');
assert.equal(cockpitFlow.find((step) => step.key === 'quality').state, 'current', 'après travaux terminés, Qualité doit être l’étape en cours');

const zeroTodayGroups = JSON.parse(vm.runInContext(`(() => {
  state = normalizeState({ cases: [], bookings: [], resources: [] });
  const groups = buildTodayWorkshopGroups(new Date('2026-05-25T10:00:00.000Z'));
  return JSON.stringify(Object.values(groups).map((items) => items.length));
})()`, context));
assert.equal(zeroTodayGroups.every((count) => count === 0), true, 'la vue Aujourd’hui doit accepter zéro dossier');

const todayGroupsRegression = JSON.parse(vm.runInContext(`(() => {
  state = normalizeState({
    resources: [{ id: 'r1', name: 'R1', role: 'mecanicien', active: true }],
    cases: [
      { id: 'today-expected', clientName: 'RDV attendu', plate: '201 TU 2026', appointment: { start: '2026-05-25T11:00:00.000Z', end: '2026-05-25T12:00:00.000Z', delivery: '2026-05-25T16:00:00.000Z' }, claims: [{ type: 'client', includeInPlanning: true, expertApproved: true, clientApproved: true, estimate: { lines: [{ phase: 'mechanical', operation: 'MO', laborHours: 1 }] } }] },
      { id: 'today-unplanned', clientName: 'Reçu non planifié', plate: '202 TU 2026', flags: { received: true }, claims: [{ type: 'client', includeInPlanning: true, expertApproved: true, clientApproved: true, estimate: { lines: [{ phase: 'mechanical', operation: 'MO', laborHours: 1 }] } }] },
      { id: 'today-start', clientName: 'À démarrer', plate: '203 TU 2026', flags: { received: true }, claims: [{ type: 'client', includeInPlanning: true, expertApproved: true, clientApproved: true, estimate: { lines: [{ phase: 'mechanical', operation: 'MO', laborHours: 1 }] } }] },
      { id: 'today-progress', clientName: 'En cours', plate: '204 TU 2026', flags: { received: true, workStarted: true }, claims: [{ type: 'client', includeInPlanning: true, expertApproved: true, clientApproved: true, estimate: { lines: [{ phase: 'mechanical', operation: 'MO', laborHours: 1 }] } }] },
      { id: 'today-late', clientName: 'Retard', plate: '205 TU 2026', appointment: { start: '2026-05-24T08:00:00.000Z', end: '2026-05-24T10:00:00.000Z', delivery: '2026-05-24T17:00:00.000Z' }, flags: { received: true }, claims: [{ type: 'client', includeInPlanning: true, expertApproved: true, clientApproved: true, estimate: { lines: [{ phase: 'mechanical', operation: 'MO', laborHours: 1 }] } }] },
      { id: 'today-quality', clientName: 'Qualité', plate: '206 TU 2026', flags: { received: true, workStarted: true, workCompleted: true }, claims: [{ type: 'client', includeInPlanning: true, expertApproved: true, clientApproved: true, estimate: { lines: [{ phase: 'mechanical', operation: 'MO', laborHours: 1 }] } }] },
      { id: 'today-delivery', clientName: 'Livraison', plate: '207 TU 2026', appointment: { start: '2026-05-25T08:00:00.000Z', end: '2026-05-25T10:00:00.000Z', delivery: '2026-05-25T15:00:00.000Z' }, flags: { received: true, workStarted: true, workCompleted: true, qualityApproved: true }, claims: [{ type: 'client', includeInPlanning: true, expertApproved: true, clientApproved: true, estimate: { lines: [{ phase: 'mechanical', operation: 'MO', laborHours: 1 }] } }] },
      { id: 'today-blocked', clientName: 'Bloqué', plate: '208 TU 2026', partsStatus: 'blocked_parts', blockerReason: 'waiting_parts', claims: [{ type: 'client', includeInPlanning: true, expertApproved: true, clientApproved: true, estimate: { lines: [{ phase: 'mechanical', operation: 'MO', laborHours: 1 }] } }] }
    ],
    bookings: [
      { id: 'b-start', caseId: 'today-start', key: 'mechanical', resourceIds: ['r1'], segments: [{ start: '2026-05-25T13:00:00.000Z', end: '2026-05-25T14:00:00.000Z' }] },
      { id: 'b-progress', caseId: 'today-progress', key: 'mechanical', resourceIds: ['r1'], segments: [{ start: '2026-05-25T08:00:00.000Z', end: '2026-05-25T12:00:00.000Z' }] },
      { id: 'b-late', caseId: 'today-late', key: 'mechanical', resourceIds: ['r1'], segments: [{ start: '2026-05-24T08:00:00.000Z', end: '2026-05-24T10:00:00.000Z' }] }
    ]
  });
  const groups = buildTodayWorkshopGroups(new Date('2026-05-25T10:00:00.000Z'));
  return JSON.stringify(Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, value.length])));
})()`, context));
assert.equal(todayGroupsRegression.expected, 1, 'Aujourd’hui doit lister les RDV attendus');
assert.equal(todayGroupsRegression.receivedUnplanned, 1, 'Aujourd’hui doit lister les véhicules reçus non planifiés');
assert.ok(todayGroupsRegression.toStart >= 1, 'Aujourd’hui doit lister les travaux à démarrer');
assert.equal(todayGroupsRegression.inProgress, 1, 'Aujourd’hui doit lister les travaux en cours');
assert.ok(todayGroupsRegression.late >= 1, 'Aujourd’hui doit lister les travaux en retard');
assert.equal(todayGroupsRegression.quality, 1, 'Aujourd’hui doit lister le contrôle qualité à faire');
assert.equal(todayGroupsRegression.deliveries, 1, 'Aujourd’hui doit lister les livraisons prévues');
assert.equal(todayGroupsRegression.blocked, 1, 'Aujourd’hui doit lister les dossiers bloqués');
console.log('Cockpit atelier quotidien regression OK');

const printPlanningRegression = JSON.parse(vm.runInContext(`(() => {
  const writes = [];
  window.open = () => ({ document: { write(html) { writes.push(html); }, close() {} } });
  state = normalizeState({
    resources: [
      { id: 'tech-print', name: 'Technicien impression', role: 'mecanicien', active: true },
      { id: 'pont-print', name: 'Pont impression', role: 'pont_mecanique', active: true }
    ],
    cases: [{
      id: 'case-print',
      clientName: 'Client imprimé',
      phone: '+216 55 000 000',
      vehicle: 'DFM S50',
      plate: '123 TU 4567',
      vin: 'VINPRINT',
      orNavNumber: 'OR-PRINT-1',
      orderType: 'mechanical_client',
      partsStatus: 'waiting_parts',
      blockerReason: 'waiting_parts',
      blockerDetails: 'Filtre non reçu',
      flags: { received: true, workStarted: true },
      claims: [{ type: 'mechanical_client', includeInPlanning: true, expertApproved: true, clientApproved: true, estimate: { lines: [{ phase: 'mechanical', operation: 'Diagnostic', laborHours: 1 }] } }]
    }],
    bookings: [
      {
        id: 'work-print',
        caseId: 'case-print',
        key: 'mechanical',
        title: 'Travail mécanique',
        resourceIds: ['tech-print', 'pont-print'],
        primaryResourceId: 'tech-print',
        segments: [{ start: '2026-05-20T08:00:00.000Z', end: '2026-05-20T09:00:00.000Z' }],
        start: '2026-05-20T08:00:00.000Z',
        end: '2026-05-20T09:00:00.000Z'
      },
      {
        id: 'material-only-print',
        caseId: 'case-print',
        key: 'mechanical',
        title: 'Réservation pont seule',
        resourceIds: ['pont-print'],
        primaryResourceId: 'pont-print',
        segments: [{ start: '2026-05-20T09:00:00.000Z', end: '2026-05-20T09:30:00.000Z' }],
        start: '2026-05-20T09:00:00.000Z',
        end: '2026-05-20T09:30:00.000Z'
      },
      {
        id: 'leave-print',
        type: 'leave',
        caseId: '__leave__',
        key: 'leave',
        title: 'Congé technicien',
        resourceIds: ['tech-print'],
        primaryResourceId: 'tech-print',
        segments: [{ start: '2026-05-20T10:00:00.000Z', end: '2026-05-20T11:00:00.000Z' }],
        start: '2026-05-20T10:00:00.000Z',
        end: '2026-05-20T11:00:00.000Z'
      }
    ]
  });
  printDailyPlanning('2026-05-20');
  const daily = writes.join('');
  writes.length = 0;
  printDailyPlanningGantt('2026-05-20');
  const gantt = writes.join('');
  writes.length = 0;
  printRepairOrder(state.cases[0]);
  const repairOrder = writes.join('');
  writes.length = 0;
  printTechnicianWorkOrders(state.cases[0]);
  const technicianOrders = writes.join('');
  const deliveryLines = buildDeliveryPdfLines(state.cases[0]);
  const qualityLines = buildQualityPdfLines(state.cases[0]);
  return JSON.stringify({ daily, gantt, repairOrder, technicianOrders, deliveryLines, qualityLines });
})()`, context));
assert.ok(printPlanningRegression.daily.includes('Travail mécanique'), 'l’impression journalière doit conserver les tâches atelier');
assert.equal(printPlanningRegression.daily.includes('Congé technicien'), false, 'l’impression journalière ne doit pas afficher les congés comme travail');
assert.equal(printPlanningRegression.gantt.includes('Congé technicien'), false, 'l’impression Gantt ne doit pas afficher les congés comme tâches production');
assert.equal(JSON.stringify(printPlanningRegression).includes('NIMR CARROSSERIE'), false, 'les imprimés ne doivent plus contenir l’ancien nom société');
assert.equal(JSON.stringify(printPlanningRegression).includes('OR NAV'), false, 'les imprimés ne doivent plus afficher le libellé OR NAV');
assert.ok(printPlanningRegression.daily.includes('Réf. OR'), 'le planning journalier doit afficher Réf. OR');
assert.ok(printPlanningRegression.daily.includes('Statut pièces'), 'le planning journalier doit afficher le statut pièces');
assert.ok(printPlanningRegression.repairOrder.includes('Statut pièces'), 'l’ordre atelier doit inclure le statut pièces');
assert.ok(printPlanningRegression.repairOrder.includes('Détail blocage'), 'l’ordre atelier doit inclure le détail de blocage');
assert.ok(printPlanningRegression.technicianOrders.includes('Début réel'), 'l’ordre technicien doit prévoir le début réel');
assert.ok(printPlanningRegression.technicianOrders.includes('Pause / cause'), 'l’ordre technicien doit prévoir les pauses');
assert.equal(printPlanningRegression.technicianOrders.includes('Technicien / ressource :</strong> Pont impression'), false, 'un équipement seul ne doit pas générer une page technicien');
assert.ok(printPlanningRegression.deliveryLines.includes('Signature client: ______________________________'), 'le PV livraison doit contenir la signature client');
assert.ok(printPlanningRegression.deliveryLines.some((line) => line.includes('Kilométrage sortie')), 'le PV livraison doit contenir le kilométrage sortie');
assert.ok(printPlanningRegression.deliveryLines.some((line) => line.includes('Réserves client')), 'le PV livraison doit contenir les réserves client');
assert.ok(printPlanningRegression.deliveryLines.some((line) => line.includes('Contrôle qualité validé')), 'le PV livraison doit mentionner le contrôle qualité');
assert.ok(printPlanningRegression.qualityLines.some((line) => line.includes('Serrages contrôlés')), 'la fiche qualité mécanique doit utiliser une checklist adaptée');

const leaveConflictRegression = JSON.parse(vm.runInContext(`(() => {
  state = normalizeState({
    resources: [{ id: 'tech-leave', name: 'Technicien absence', role: 'mecanicien', active: true }],
    cases: [{ id: 'case-leave', clientName: 'Conflit absence' }],
    bookings: [{
      id: 'work-leave',
      caseId: 'case-leave',
      key: 'mechanical',
      title: 'Diagnostic planifié',
      resourceIds: ['tech-leave'],
      primaryResourceId: 'tech-leave',
      segments: [{ start: '2026-05-20T08:00:00.000Z', end: '2026-05-20T09:00:00.000Z' }],
      start: '2026-05-20T08:00:00.000Z',
      end: '2026-05-20T09:00:00.000Z'
    }]
  });
  return JSON.stringify(getResourceLeaveConflicts('tech-leave', new Date('2026-05-20T08:30:00.000Z'), new Date('2026-05-20T10:00:00.000Z')).map((booking) => booking.id));
})()`, context));
assert.deepEqual(leaveConflictRegression, ['work-leave'], 'une absence ne doit pas être posée silencieusement sur une tâche déjà réservée');

const pausedTaskRegression = JSON.parse(vm.runInContext(`(() => {
  const now = new Date();
  const start = new Date(now.getTime() - 30 * 60000).toISOString();
  const end = new Date(now.getTime() + 90 * 60000).toISOString();
  state = normalizeState({
    resources: [
      { id: 'tech-pause', name: 'Technicien pause', role: 'tolier', active: true },
      { id: 'tech-pause-2', name: 'Technicien reprise', role: 'tolier', active: true }
    ],
    cases: [{
      id: 'case-pause',
      clientName: 'Pause atelier',
      flags: { received: true },
      appointment: { start, end, delivery: end, marginMinutes: 15 },
      durations: { body: 2 }
    }],
    bookings: [{
      id: 'booking-live',
      caseId: 'case-pause',
      key: 'body',
      title: 'Tôlerie + démontage',
      resourceIds: ['tech-pause'],
      primaryResourceId: 'tech-pause',
      segments: [{ start, end }],
      plannedStart: start,
      plannedEnd: end,
      plannedMinutes: 120,
      status: 'planned'
    }]
  });
  const item = state.cases[0];
  const startResult = startCaseBookingTask(item, 'booking-live');
  const pauseResult = pauseCaseBookingTask(item, 'booking-live', 'Attente pièce');
  return JSON.stringify({
    startOk: startResult.ok,
    pauseOk: pauseResult.ok,
    bookingCount: state.bookings.length,
    original: state.bookings.find((booking) => booking.id === 'booking-live'),
    remainder: state.bookings.find((booking) => booking.parentBookingId === 'booking-live')
  });
})()`, context));
assert.equal(pausedTaskRegression.startOk, true, 'une tâche planifiée doit pouvoir démarrer');
assert.equal(pausedTaskRegression.pauseOk, true, 'une tâche démarrée doit pouvoir être mise en pause');
assert.equal(pausedTaskRegression.bookingCount, 2, 'la pause doit créer un reliquat planifié');
assert.equal(pausedTaskRegression.original.status, 'paused', 'la tâche originale doit être marquée en pause');
assert.equal(pausedTaskRegression.remainder.status, 'planned', 'le reliquat doit rester planifié');
assert.equal(pausedTaskRegression.remainder.remainingFromPaused, true, 'le reliquat doit garder son origine pause');
console.log('Task pause/remainder regression OK');
