import assert from "node:assert/strict";
import fs from "node:fs";

console.log("Démarrage tests statut RDV canonique sync v23.1.3...");

const utilsJs = fs.readFileSync("./js/utils.js", "utf8");
const stateJs = fs.readFileSync("./js/state.js", "utf8");
const syncJs = fs.readFileSync("./js/supabase-sync.js", "utf8");

const localStorageMock = `
  const __store = new Map();
  const localStorage = {
    getItem: (key) => __store.has(key) ? __store.get(key) : null,
    setItem: (key, value) => { __store.set(key, String(value)); },
    removeItem: (key) => { __store.delete(key); },
  };
  const sessionStorage = localStorage;
  const navigator = { onLine: true };
  const window = { setTimeout, clearTimeout };
`;

const script = `
  ${localStorageMock}
  ${utilsJs}
  ${stateJs.replace(/let state = loadState\(\);/, "let state = { cases: [], bookings: [], syncConflicts: [], syncLog: [], auditLog: [], resources: [], users: [], currentUserId: '' };")}
  const __saveCalls = [];
  const __notifications = [];
  function render() {}
  function setSupabaseStatus(label, level) { global.__lastSupabaseStatus = { label, level }; }
  function setSupabaseDetails(details) { global.__lastSupabaseDetails = details; }
  function notifyUser(message, variant) { __notifications.push({ message, variant }); }
  function quietNotify(message, variant) { global.__lastQuietNotify = { message, variant }; }
  async function restorePhotoRecords() { return 0; }
  function isSupabaseConfigured() { return true; }
  async function buildBackupPayload() { return { state, photos: [] }; }
  function getSupabaseConfig() { return { backupTable: "cloud_backups", backupKey: "nimr-carrosserie-main" }; }
  function getSupabaseWorkshopId() { return "main"; }
  
  let __mockPushFails = false;
  const __mockSupabaseClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          delete: async () => {
            if (__mockPushFails) throw new Error("mock delete fail");
            return { error: null };
          },
          select: () => ({ error: null }),
        }),
      }),
      upsert: async () => {
        if (__mockPushFails) throw new Error("mock upsert fail");
        return { error: null };
      },
      delete: () => ({
        eq: async () => {
          if (__mockPushFails) throw new Error("mock delete eq fail");
          return { error: null };
        }
      })
    })
  };
  function getSupabaseClient() { return __mockSupabaseClient; }
  
  let __mockSupabaseUser = { id: "u-1" };
  async function getSupabaseUser() { return __mockSupabaseUser; }
  
  function shouldApplyRemoteBackup() { return true; }
  async function confirmRemoteBackupConflict(data, reason) { return true; }
  async function createSyncSafetySnapshot() { return { id: "snap" }; }
  function getTimestampMs(value) { return value ? new Date(value).getTime() || 0 : 0; }
  
  ${syncJs}
  
  // Override functions after syncJs loads to avoid them being overwritten
  upsertCloudBackupRow = async function(client, tableName, data) {
    if (__mockPushFails) throw new Error("Supabase push failed");
  };
  syncBusinessTablesToSupabase = async function(payload, user) {
    if (__mockPushFails) throw new Error("Supabase business tables failed");
    return { repairOrders: 1, clients: 1, vehicles: 1, repairSteps: 1, resources: 1, holidays: 1, workHoursDays: 1, planningSlots: 1, claims: 1, supplements: 1, photos: 1 };
  };
  
  module.exports = {
    mergeRemoteStateIntoLocal,
    applyRemoteSupabaseBackup,
    normalizeSyncConflicts,
    getOpenSyncConflicts,
    resolveSyncConflict,
    getAggregatedActivityLog,
    clearLocalUserChangeAt,
    resolveKeptConflictsAfterPush,
    autoBackupToSupabase,
    setMockPushFails: (val) => { __mockPushFails = val; },
    getState: () => state,
    setState: (next) => { state = next; },
    getNotifications: () => __notifications,
    getLastStatus: () => global.__lastSupabaseStatus,
    getLastDetails: () => global.__lastSupabaseDetails,
    buildSyncConflictKey,
    hasRealBooking,
    normalizeCase,
  };
`;

const mod = { exports: {} };
new Function("module", "global", script)(mod, global);

const {
  mergeRemoteStateIntoLocal,
  normalizeSyncConflicts,
  getOpenSyncConflicts,
  getState,
  setState,
  buildSyncConflictKey,
  hasRealBooking,
  normalizeCase,
} = mod.exports;

// Helper to construct a base case
function createCase(id, status = "none") {
  return { id, orNavNumber: "OR-" + id, clientName: "Client", phone: "111", appointmentStatus: status, flags: {}, history: [] };
}

// 1. ConflictKey non-directionnelle
// scheduled:none et none:scheduled produisent la même conflictKey
{
  const key1 = buildSyncConflictKey({
    entityType: "case",
    entityId: "case-1",
    field: "appointmentStatus",
    localValue: "scheduled",
    remoteValue: "none",
  });
  const key2 = buildSyncConflictKey({
    entityType: "case",
    entityId: "case-1",
    field: "appointmentStatus",
    localValue: "none",
    remoteValue: "scheduled",
  });
  assert.equal(key1, key2, "scheduled:none et none:scheduled doivent produire la même conflictKey");
  console.log("-> Test 1 (ConflictKey non-directionnelle) OK");
}

// 2. Déduplication miroir & Conflit open identique non renotifié / non recréé
{
  const localState = {
    cases: [createCase("case-1", "scheduled")],
    bookings: [],
    syncConflicts: [
      {
        id: "c-1",
        entityType: "case",
        entityId: "case-1",
        field: "appointmentStatus",
        localValue: "scheduled",
        remoteValue: "none",
        status: "open",
        decision: "needs_review",
      }
    ],
    syncLog: [],
    auditLog: []
  };

  const remoteState = {
    cases: [createCase("case-1", "none")],
    bookings: [],
    syncConflicts: []
  };

  // We perform the merge
  const result = mergeRemoteStateIntoLocal(localState, remoteState);
  assert.equal(result.stats.newConflicts, 0, "Le conflit miroir existant ne doit pas être recréé comme nouveau conflit");
  assert.equal(result.state.syncConflicts.length, 1, "Il ne doit y avoir qu'un seul conflit dans la liste");
  console.log("-> Test 2 (Déduplication miroir) OK");
}

// 3. Conflit resolved/ignored identique non recréé open
{
  const localState = {
    cases: [createCase("case-1", "scheduled")],
    bookings: [],
    syncConflicts: [
      {
        id: "c-1",
        entityType: "case",
        entityId: "case-1",
        field: "appointmentStatus",
        localValue: "scheduled",
        remoteValue: "none",
        status: "resolved",
        decision: "kept_local",
      }
    ],
    syncLog: [],
    auditLog: []
  };

  const remoteState = {
    cases: [createCase("case-1", "none")],
    bookings: [],
    syncConflicts: []
  };

  const result = mergeRemoteStateIntoLocal(localState, remoteState);
  assert.equal(result.stats.newConflicts, 0, "Un conflit résolu/ignoré identique ne doit pas repasser open");
  assert.equal(result.state.syncConflicts[0].status, "resolved", "Le conflit doit rester résolu");
  console.log("-> Test 3 (Conflit resolved/ignored identique non recréé open) OK");
}

// 4. appointmentStatus = scheduled si booking actif réel existe
{
  const testCase = createCase("case-1", "none");
  const bookings = [
    { id: "b-1", caseId: "case-1", type: "work", temporary: false, status: "active", deletedAt: null }
  ];
  const normalized = normalizeCase(testCase, bookings);
  assert.equal(normalized.appointmentStatus, "scheduled", "Le statut doit être scheduled s'il y a un booking actif réel");
  console.log("-> Test 4 (appointmentStatus = scheduled si booking actif réel) OK");
}

// 5. appointmentStatus = none si aucun booking actif réel
{
  const testCase = createCase("case-1", "scheduled");
  const bookings = [];
  const normalized = normalizeCase(testCase, bookings);
  assert.equal(normalized.appointmentStatus, "none", "Le statut doit être none s'il n'y a aucun booking");
  console.log("-> Test 5 (appointmentStatus = none si aucun booking actif réel) OK");
}

// 6. leave / absence / temp / cancelled / deleted ne comptent pas comme booking réel
{
  const casesToTest = [
    { type: "leave", temporary: false, status: "active", deletedAt: null },
    { type: "absence", temporary: false, status: "active", deletedAt: null },
    { type: "work", temporary: true, status: "active", deletedAt: null },
    { type: "work", temporary: false, status: "cancelled", deletedAt: null },
    { type: "work", temporary: false, status: "deleted", deletedAt: null },
    { type: "work", temporary: false, status: "active", deletedAt: "2026-06-04T12:00:00Z" }
  ];
  
  casesToTest.forEach((booking, index) => {
    const hasBooking = hasRealBooking("case-1", [{ id: "b-" + index, caseId: "case-1", ...booking }]);
    assert.equal(hasBooking, false, `Le booking de type ${booking.type} / status ${booking.status} / temp ${booking.temporary} ne doit pas compter comme réel`);
  });
  console.log("-> Test 6 (Bookings exclus du calcul réel) OK");
}

// 7. scheduled/none auto-résolu si canonical value déterminée lors de la fusion (Sync merge)
// Si local/remote ont des bookings différents mais un a un booking réel
{
  const localCase = createCase("case-1", "none");
  const remoteCase = createCase("case-1", "scheduled");
  
  const localState = {
    cases: [localCase],
    bookings: [], // no real booking local
    syncConflicts: [],
    syncLog: [],
    auditLog: [],
    resources: [{ id: "tech-1", name: "ALI", role: "technicien", active: true }]
  };

  const remoteState = {
    cases: [remoteCase],
    bookings: [
      {
        id: "b-1",
        caseId: "case-1",
        type: "work",
        temporary: false,
        status: "active",
        resourceIds: ["tech-1"],
        segments: [{ start: "2026-06-04T08:00:00Z", end: "2026-06-04T09:00:00Z" }]
      }
    ],
    syncConflicts: [],
    resources: [{ id: "tech-1", name: "ALI", role: "technicien", active: true }]
  };

  const result = mergeRemoteStateIntoLocal(localState, remoteState);
  // Merged value should be scheduled
  const mergedCase = result.state.cases.find(c => c.id === "case-1");
  assert.equal(mergedCase.appointmentStatus, "scheduled", "Le statut fusionné doit être scheduled (valeur canonique)");
  
  // Conflict should be pushed as resolved/kept_canonical
  const conflict = result.stats.conflictEntries.find(c => c.field === "appointmentStatus");
  assert.ok(conflict, "Un conflit doit être enregistré");
  assert.equal(conflict.status, "resolved", "Le conflit doit être résolu");
  assert.equal(conflict.decision, "kept_canonical", "La décision doit être kept_canonical");
  console.log("-> Test 7 (Auto-résolution lors du Sync merge) OK");
}

// 8. Conflit reste open si impossible de déterminer la valeur canonique
// (Par exemple si aucun booking n'est trouvé et qu'on a un statut personnalisé non dérivé comme reschedule_pending)
{
  const localCase = createCase("case-1", "reschedule_pending");
  const remoteCase = createCase("case-1", "no_show");
  
  const localState = {
    cases: [localCase],
    bookings: [],
    syncConflicts: [],
    syncLog: [],
    auditLog: []
  };

  const remoteState = {
    cases: [remoteCase],
    bookings: [],
    syncConflicts: []
  };

  const result = mergeRemoteStateIntoLocal(localState, remoteState);
  const conflict = result.state.syncConflicts.find(c => c.field === "appointmentStatus");
  assert.ok(conflict, "Conflit doit exister");
  assert.equal(conflict.status, "open", "Le conflit doit rester open");
  console.log("-> Test 8 (Conflit reste open si pas de valeur canonique) OK");
}

// 9. Label / details jamais null
{
  const entry = normalizeSyncConflicts([
    {
      id: "c-test-fallback",
      entityType: "case",
      entityId: "case-1",
      field: "appointmentStatus",
      localValue: "scheduled",
      remoteValue: "none",
      status: "open",
      label: null,
      details: null
    }
  ])[0];
  assert.equal(entry.label, "Conflit statut RDV", "Label fallback pour appointmentStatus");
  assert.ok(entry.details.includes("Conflit sur le statut RDV pour le dossier"), "Details fallback pour appointmentStatus");
  console.log("-> Test 9 (Label/details jamais null) OK");
}

// 10. Compteur Cloud ignore resolved/ignored
{
  setState({
    cases: [],
    bookings: [],
    syncConflicts: [
      { id: "c-1", entityType: "case", entityId: "case-1", field: "appointmentStatus", status: "resolved", decision: "kept_canonical" },
      { id: "c-2", entityType: "case", entityId: "case-1", field: "appointmentStatus", status: "ignored" }
    ],
    syncLog: [],
    auditLog: []
  });
  const openConflicts = getOpenSyncConflicts();
  assert.equal(openConflicts.length, 0, "Le compteur Cloud ignore les résolus et ignorés");
  console.log("-> Test 10 (Compteur Cloud ignore les résolus/ignorés) OK");
}

// 11. Non-régression v23.0.5 auto-resolve
{
  // Normalisation auto-résout si local et remote sont équivalents après normalisation
  const conflicts = normalizeSyncConflicts([
    {
      id: "c-eq",
      entityType: "case",
      entityId: "case-1",
      field: "phone",
      localValue: "  123  ",
      remoteValue: "123",
      status: "open"
    }
  ]);
  assert.equal(conflicts[0].status, "resolved", "Doit être auto-résolu si équivalent");
  assert.equal(conflicts[0].decision, "auto_resolved", "Décision doit être auto_resolved");
  console.log("-> Test 11 (Non-régression v23.0.5) OK");
}

// 12. Non-régression v23.0.4 sync conflict resolution
{
  // Si le conflit existant est déjà résolu, il n'est pas recréé
  const localState = {
    cases: [createCase("case-1", "scheduled")],
    bookings: [],
    syncConflicts: [
      {
        id: "c-1",
        entityType: "case",
        entityId: "case-1",
        field: "phone",
        localValue: "111",
        remoteValue: "222",
        status: "resolved",
        decision: "kept_local",
      }
    ],
    syncLog: [],
    auditLog: []
  };

  const remoteState = {
    cases: [createCase("case-1", "none")],
    bookings: [],
    syncConflicts: []
  };
  remoteState.cases[0].phone = "222";

  const result = mergeRemoteStateIntoLocal(localState, remoteState);
  assert.equal(result.stats.newConflicts, 0, "Pas de nouveau conflit généré pour une clé déjà résolue");
  console.log("-> Test 12 (Non-régression v23.0.4) OK");
}

// 13. Version/cache v23.1.3 validés
{
  const stateSource = fs.readFileSync('js/state.js', 'utf8');
  const swSource = fs.readFileSync('sw.js', 'utf8');
  const versionSource = fs.readFileSync('js/version.js', 'utf8');
  const indexSource = fs.readFileSync('index.html', 'utf8');
  const appSource = fs.readFileSync('app.js', 'utf8');

  assert.match(stateSource, /APP_VERSION\s*=\s*"v23\.1.3"/, "state.js n'a pas la bonne version");
  assert.match(swSource, /nimr-sav-v23\.1.3-reception-create-case-local-pin-fix/, "sw.js n'a pas le bon cache");
  assert.match(versionSource, /NIMR_BUILD\s*=\s*"v23\.1.3"/, "version.js n'a pas la bonne version");
  assert.match(appSource, /sw\.js\?v=23\.1.3/, "app.js n'appelle pas le bon sw.js");
  console.log("-> Test 13 (Version/cache v23.1.3) OK");
}

console.log("Tous les tests statut RDV canonique sync v23.1.3 passés avec succès !");
