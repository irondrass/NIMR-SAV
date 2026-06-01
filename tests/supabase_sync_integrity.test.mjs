import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = [
  '../js/state.js',
  '../js/utils.js',
  '../js/supabase-sync.js',
]
  .map((file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8'))
  .join('\n');

const storage = new Map();
const context = {
  console,
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
  sessionStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
  window: {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener: () => {},
  },
  document: {
    addEventListener: () => {},
    visibilityState: 'visible',
  },
  navigator: { onLine: true },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Date,
};

vm.createContext(context);
vm.runInContext(source, context);

const baseResources = [
  { id: 'tech-karim', name: 'Karim', role: 'mecanicien', active: true },
  { id: 'tech-amin', name: 'Amin', role: 'controle', active: true },
  { id: 'pont-1', name: 'Pont vidange 1', role: 'pont_vidange', active: true },
];

function caseItem(id, extra = {}) {
  return {
    id,
    clientName: `Client ${id}`,
    vehicle: 'T5 EVO',
    plate: `${id.toUpperCase()}TU`,
    createdAt: '2026-05-29T07:00:00.000Z',
    flags: {
      expertApproved: true,
      clientApproved: true,
      received: true,
      workStarted: false,
      workCompleted: false,
      qualityApproved: false,
      delivered: false,
      invoiced: false,
      ...(extra.flags || {}),
    },
    history: [
      { id: `hist-${id}-local`, at: '2026-05-29T07:00:00.000Z', type: 'case.created', label: 'Dossier créé', details: '' },
      ...(extra.history || []),
    ],
    photos: extra.photos || [],
    ...extra,
  };
}

function booking(id, caseId, status = 'planned', extra = {}) {
  return {
    id,
    caseId,
    type: 'work',
    key: 'oilService',
    title: 'Vidange / entretien rapide',
    start: '2026-05-29T08:00:00.000Z',
    end: '2026-05-29T09:00:00.000Z',
    resourceIds: ['tech-karim', 'pont-1'],
    primaryResourceId: 'tech-karim',
    equipmentResourceIds: ['pont-1'],
    segments: [{ start: '2026-05-29T08:00:00.000Z', end: '2026-05-29T09:00:00.000Z' }],
    plannedStart: '2026-05-29T08:00:00.000Z',
    plannedEnd: '2026-05-29T09:00:00.000Z',
    plannedSegments: [{ start: '2026-05-29T08:00:00.000Z', end: '2026-05-29T09:00:00.000Z' }],
    plannedMinutes: 60,
    status,
    ...extra,
  };
}

function merge(localState, remoteState, options = {}) {
  return vm.runInContext(
    `mergeRemoteStateIntoLocal(__localState, __remoteState, __options)`,
    Object.assign(context, { __localState: localState, __remoteState: remoteState, __options: options }),
  );
}

{
  const local = {
    resources: baseResources,
    cases: [caseItem('case-1')],
    bookings: [booking('booking-1', 'case-1', 'started', { startedAt: '2026-05-29T08:00:00.000Z', actualStart: '2026-05-29T08:00:00.000Z' })],
  };
  const remote = {
    resources: baseResources,
    cases: [caseItem('case-2')],
    bookings: [],
  };
  const result = merge(local, remote, { reason: 'pc2-new-case' });
  assert.ok(result.state.cases.some((item) => item.id === 'case-1'), 'PC1 conserve son dossier local absent du cloud');
  assert.ok(result.state.cases.some((item) => item.id === 'case-2'), 'PC1 reçoit le nouveau dossier distant');
  assert.ok(result.state.bookings.some((item) => item.id === 'booking-1'), 'PC1 conserve son planning démarré absent du cloud');
}

{
  const localBooking = booking('booking-started', 'case-1', 'started', {
    startedAt: '2026-05-29T08:00:00.000Z',
    actualStart: '2026-05-29T08:00:00.000Z',
    workSessions: [{ startedAt: '2026-05-29T08:00:00.000Z', startedBy: 'tech-karim' }],
  });
  const remoteBooking = booking('booking-started', 'case-1', 'planned');
  const result = merge(
    { resources: baseResources, cases: [caseItem('case-1')], bookings: [localBooking] },
    { resources: baseResources, cases: [caseItem('case-1')], bookings: [remoteBooking] },
    { reason: 'remote-stale' },
  );
  const merged = result.state.bookings.find((item) => item.id === 'booking-started');
  assert.equal(merged.status, 'started', 'une tâche started locale ne redevient pas planned');
  assert.ok(result.stats.conflicts >= 1, 'la rétrogradation started -> planned crée un conflit');
}

{
  const localBooking = booking('booking-done', 'case-1', 'completed', {
    completedAt: '2026-05-29T08:36:00.000Z',
    actualEnd: '2026-05-29T08:36:00.000Z',
    actualWorkedMinutes: 36,
  });
  const remoteBooking = booking('booking-done', 'case-1', 'planned');
  const result = merge(
    { resources: baseResources, cases: [caseItem('case-1')], bookings: [localBooking] },
    { resources: baseResources, cases: [caseItem('case-1')], bookings: [remoteBooking] },
    { reason: 'remote-stale' },
  );
  const merged = result.state.bookings.find((item) => item.id === 'booking-done');
  assert.equal(merged.status, 'completed', 'une tâche completed locale ne redevient pas planned/started');
  assert.equal(merged.completedAt, '2026-05-29T08:36:00.000Z', 'completedAt local protégé est conservé');
}

{
  const local = caseItem('case-history', {
    history: [{ id: 'hist-local-only', at: '2026-05-29T08:00:00.000Z', type: 'planning.task.started', label: 'Tâche démarrée', details: 'Karim' }],
  });
  const remote = caseItem('case-history', {
    history: [
      { id: 'hist-local-only', at: '2026-05-29T08:00:00.000Z', type: 'planning.task.started', label: 'Tâche démarrée', details: 'Karim' },
      { id: 'hist-remote-only', at: '2026-05-29T08:30:00.000Z', type: 'planning.task.note', label: 'Note ajoutée', details: 'PC2' },
    ],
  });
  const result = merge(
    { resources: baseResources, cases: [local], bookings: [] },
    { resources: baseResources, cases: [remote], bookings: [] },
    { reason: 'history-merge' },
  );
  const history = result.state.cases.find((item) => item.id === 'case-history').history;
  assert.equal(history.filter((entry) => entry.id === 'hist-local-only').length, 1, 'historique local non dupliqué');
  assert.ok(history.some((entry) => entry.id === 'hist-remote-only'), 'historique distant ajouté');
}

{
  const result = merge(
    { resources: baseResources, cases: [caseItem('case-missing-photo', { photos: [{ id: 'photo-local', name: 'Avant', category: 'before' }] })], bookings: [] },
    { resources: baseResources, cases: [caseItem('case-missing-photo', { photos: [] })], bookings: [] },
    { reason: 'photo-missing-remote' },
  );
  const photos = result.state.cases.find((item) => item.id === 'case-missing-photo').photos;
  assert.ok(photos.some((photo) => photo.id === 'photo-local'), 'une photo locale absente du cloud incomplet n’est pas supprimée');
}

{
  const result = merge(
    { resources: baseResources, cases: [caseItem('case-delete')], bookings: [] },
    { resources: baseResources, cases: [caseItem('case-delete', { deletedAt: '2026-05-29T09:00:00.000Z', deletedBy: 'admin-1', deleteReason: 'doublon' })], bookings: [] },
    { reason: 'explicit-delete' },
  );
  const item = result.state.cases.find((candidate) => candidate.id === 'case-delete');
  assert.equal(item.deletedAt, '2026-05-29T09:00:00.000Z', 'une suppression explicite conserve deletedAt');
  assert.equal(item.deletedBy, 'admin-1', 'une suppression explicite conserve deletedBy');
  assert.equal(item.deleteReason, 'doublon', 'une suppression explicite conserve deleteReason');
}

{
  const local = {
    resources: baseResources,
    cases: [caseItem('case-closed', { flags: { delivered: true, invoiced: true } })],
    bookings: [booking('booking-closed', 'case-closed', 'completed', { completedAt: '2026-05-29T09:00:00.000Z' })],
  };
  const remote = {
    resources: baseResources,
    cases: [caseItem('case-closed', { flags: { delivered: false, invoiced: false } })],
    bookings: [],
  };
  const result = merge(local, remote, { reason: 'closed-protected' });
  const item = result.state.cases.find((candidate) => candidate.id === 'case-closed');
  assert.equal(item.flags.delivered, true, 'dossier livré local protégé conservé');
  assert.equal(item.flags.invoiced, true, 'dossier facturé local protégé conservé');
  assert.ok(result.state.bookings.some((candidate) => candidate.id === 'booking-closed'), 'booking clôturé local absent du cloud conservé');
}

{
  vm.runInContext(`state = normalizeState(__stateForApply)`, Object.assign(context, {
    __stateForApply: {
      resources: baseResources,
      cases: [caseItem('case-apply')],
      bookings: [booking('booking-apply', 'case-apply', 'completed', { completedAt: '2026-05-29T09:00:00.000Z' })],
    },
  }));
  vm.runInContext(`
    lastKnownCloudUpdatedAt = new Date('2026-05-29T08:00:00.000Z').getTime();
    activeCaseId = 'case-apply';
    activeCaseDetailTab = 'atelier';
    generatedProposals = {};
  `, context);
  context.render = () => {};
  context.setSupabaseStatus = () => {};
  context.setSupabaseDetails = () => {};
  context.notifyUser = () => {};
  context.restorePhotoRecords = async () => 0;
  const applied = await vm.runInContext(`applyRemoteSupabaseBackup(__remoteApply, 'test-apply')`, Object.assign(context, {
    __remoteApply: {
      updated_at: '2026-05-29T09:30:00.000Z',
      app_version: 'v22.25-test',
      updated_by: 'pc2',
      state: { resources: baseResources, cases: [caseItem('case-apply')], bookings: [] },
      photos: [],
    },
  }));
  assert.equal(applied, true, 'la sauvegarde distante est appliquée par fusion');
  const bookingsAfterApply = vm.runInContext(`state.bookings`, context);
  assert.ok(bookingsAfterApply.some((item) => item.id === 'booking-apply'), 'applyRemoteSupabaseBackup ne vide pas le planning local protégé');
  assert.ok(storage.get('nimr-carrosserie-v1:sync-safety-last'), 'un snapshot local de sécurité est mémorisé avant fusion');
}

console.log('Supabase sync integrity OK');
