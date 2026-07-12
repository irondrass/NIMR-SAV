import assert from "node:assert/strict";
import fs from "node:fs";

console.log("Démarrage tests auto-résolution conflits sync v23.0.5...");

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
  function cloneSyncStateSnapshot(candidateState = state) {
    return JSON.parse(JSON.stringify(candidateState || {}));
  }
  function buildSyncFingerprintState(candidateState = state) {
    const snapshot = cloneSyncStateSnapshot(candidateState);
    delete snapshot.syncLog;
    return snapshot;
  }
  function getSyncStateFingerprint(candidateState = state) {
    return JSON.stringify(buildSyncFingerprintState(candidateState));
  }
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
  };
`;

const mod = { exports: {} };
new Function("module", "global", script)(mod, global);

const {
  mergeRemoteStateIntoLocal,
  applyRemoteSupabaseBackup,
  normalizeSyncConflicts,
  getOpenSyncConflicts,
  resolveSyncConflict,
  getAggregatedActivityLog,
  clearLocalUserChangeAt,
  resolveKeptConflictsAfterPush,
  autoBackupToSupabase,
  setMockPushFails,
  getState,
  setState,
  getNotifications,
  getLastStatus,
  getLastDetails,
} = mod.exports;

function baseCase(phone = "111") {
  return { id: "case-1", orNavNumber: "OR-1", clientName: "Client", phone, flags: {}, history: [] };
}

// 1. kept_local case flags.received + push réussi => status resolved.
{
  setState({
    cases: [baseCase("111")],
    bookings: [],
    syncConflicts: [
      {
        id: "c-received",
        entity: "case",
        entityId: "case-1",
        field: "flags.received",
        decision: "kept_local",
        status: "open",
        localValue: true,
        remoteValue: false,
      }
    ],
    syncLog: [],
    auditLog: [],
    resources: [],
    users: [],
    currentUserId: ''
  });
  
  setMockPushFails(false);
  await autoBackupToSupabase("autosave", { force: true });
  
  const conflicts = getState().syncConflicts;
  const target = conflicts.find(c => c.id === "c-received");
  assert.equal(target.status, "resolved", "Case flags.received conflict resolved after successful push");
  assert.equal(target.resolvedBy, "Système (Sync)", "Correct resolvedBy agent");
  assert.ok(target.resolvedAt, "Correct resolvedAt timestamp");
}

// 2. kept_local case flags.workStarted + push réussi => status resolved.
{
  setState({
    cases: [baseCase("111")],
    bookings: [],
    syncConflicts: [
      {
        id: "c-started",
        entity: "case",
        entityId: "case-1",
        field: "flags.workStarted",
        decision: "kept_local",
        status: "open",
        localValue: true,
        remoteValue: false,
      }
    ],
    syncLog: [],
    auditLog: [],
    resources: [],
    users: [],
    currentUserId: ''
  });
  
  await autoBackupToSupabase("autosave", { force: true });
  
  const conflicts = getState().syncConflicts;
  const target = conflicts.find(c => c.id === "c-started");
  assert.equal(target.status, "resolved", "Case flags.workStarted conflict resolved after successful push");
}

// 3. kept_local booking case + push réussi => status resolved.
{
  setState({
    cases: [baseCase("111")],
    bookings: [],
    syncConflicts: [
      {
        id: "c-booking",
        entity: "booking",
        entityId: "b-1",
        field: "case",
        decision: "kept_local",
        status: "open",
        localValue: "case-1",
        remoteValue: "case-2",
      }
    ],
    syncLog: [],
    auditLog: [],
    resources: [],
    users: [],
    currentUserId: ''
  });
  
  await autoBackupToSupabase("autosave", { force: true });
  
  const conflicts = getState().syncConflicts;
  const target = conflicts.find(c => c.id === "c-booking");
  assert.equal(target.status, "resolved", "Booking case conflict resolved after successful push");
}

// 4. kept_remote + push réussi => status resolved.
{
  setState({
    cases: [baseCase("111")],
    bookings: [],
    syncConflicts: [
      {
        id: "c-remote",
        entity: "case",
        entityId: "case-1",
        field: "phone",
        decision: "kept_remote",
        status: "open",
        localValue: "111",
        remoteValue: "222",
      }
    ],
    syncLog: [],
    auditLog: [],
    resources: [],
    users: [],
    currentUserId: ''
  });
  
  await autoBackupToSupabase("autosave", { force: true });
  
  const conflicts = getState().syncConflicts;
  const target = conflicts.find(c => c.id === "c-remote");
  assert.equal(target.status, "resolved", "kept_remote conflict resolved after successful push");
}

// 5. resolved/ignored non comptés par le Cloud indicator.
{
  setState({
    cases: [baseCase("111")],
    bookings: [],
    syncConflicts: [
      { id: "c-1", entity: "case", status: "resolved" },
      { id: "c-2", entity: "case", status: "ignored" }
    ],
    syncLog: [],
    auditLog: []
  });
  
  const openConflictsCount = getOpenSyncConflicts().length;
  assert.equal(openConflictsCount, 0, "compteur Cloud ignore les conflits resolved/ignored");
}

// 6. resolved/ignored ne déclenchent pas de toast.
{
  setState({
    cases: [baseCase("111")],
    bookings: [],
    syncConflicts: [
      { id: "c-1", entity: "case", status: "resolved", conflictKey: "key-1" }
    ],
    syncLog: [],
    auditLog: []
  });
  
  // Clear notification mock
  getNotifications().length = 0;
  
  const payload = {
    updated_at: "2026-06-04T12:00:00.000Z",
    state: {
      cases: [baseCase("111")],
      bookings: [],
      syncConflicts: [
        { id: "c-1", entity: "case", status: "resolved", conflictKey: "key-1" }
      ],
      syncLog: [],
      auditLog: []
    }
  };
  
  await applyRemoteSupabaseBackup(payload, "test");
  const warnings = getNotifications().filter(n => n.message.includes("Conflit"));
  assert.equal(warnings.length, 0, "Les conflits résolus ne déclenchent pas de toast de conflit");
}

// 7. conflit identique avec conflictKey déjà resolved/ignored non recréé open.
{
  const localState = {
    cases: [baseCase("111")],
    bookings: [],
    syncConflicts: [
      {
        id: "c-1",
        entity: "case",
        entityId: "case-1",
        field: "phone",
        localValue: "111",
        remoteValue: "222",
        status: "resolved", // already resolved
      }
    ],
    syncLog: [],
    auditLog: []
  };
  
  const remoteState = {
    cases: [baseCase("222")], // different phone -> will regenerate the conflict
    bookings: [],
    syncConflicts: []
  };
  
  const first = mergeRemoteStateIntoLocal(localState, remoteState);
  assert.equal(first.stats.newConflicts, 0, "Aucun nouveau conflit car la clé de conflit existe déjà comme résolue");
  assert.equal(first.state.syncConflicts[0].status, "resolved", "Conflit existant reste résolu");
}

// 8. local/remote équivalents après normalisation => auto_resolved.
{
  const conflict = {
    id: "c-eq",
    entity: "case",
    field: "phone",
    localValue: " 111 ", // leading/trailing spaces
    remoteValue: "111",
    status: "open"
  };
  
  const normalized = normalizeSyncConflicts([conflict]);
  assert.equal(normalized[0].status, "resolved", "Passé en resolved car équivalent après normalisation");
  assert.equal(normalized[0].decision, "auto_resolved", "Marqué decision auto_resolved");
}

// 9. fallback label/details jamais null.
{
  const conflict = {
    id: "c-fallback",
    entity: "case",
    field: "phone",
    localValue: "111",
    remoteValue: "222",
    status: "open",
    label: "",
    details: ""
  };
  
  const normalized = normalizeSyncConflicts([conflict]);
  assert.ok(normalized[0].label, "Label non nul présent");
  assert.ok(normalized[0].details, "Details non nul présent");
}

// 10. conflit open sans décision reste open.
{
  setState({
    cases: [baseCase("111")],
    bookings: [],
    syncConflicts: [
      {
        id: "c-open",
        entity: "case",
        entityId: "case-1",
        field: "phone",
        decision: "needs_review", // open conflict needing review
        status: "open",
        localValue: "111",
        remoteValue: "222",
      }
    ],
    syncLog: [],
    auditLog: []
  });
  
  await autoBackupToSupabase("autosave", { force: true });
  
  const conflicts = getState().syncConflicts;
  const target = conflicts.find(c => c.id === "c-open");
  assert.equal(target.status, "open", "Le conflit open sans décision reste open");
}

// 11. push échoué => kept_local reste open.
{
  setState({
    cases: [baseCase("111")],
    bookings: [],
    syncConflicts: [
      {
        id: "c-failed",
        entity: "case",
        entityId: "case-1",
        field: "phone",
        decision: "kept_local",
        status: "open",
        localValue: "111",
        remoteValue: "222",
      }
    ],
    syncLog: [],
    auditLog: []
  });
  
  setMockPushFails(true);
  try {
    await autoBackupToSupabase("autosave", { force: true });
  } catch (err) {
    // ignore expected error
  }
  
  const conflicts = getState().syncConflicts;
  const target = conflicts.find(c => c.id === "c-failed");
  assert.equal(target.status, "open", "Le conflit reste open si le push a échoué");
}

// 12. non-régression sync_conflict_resolution_v2304.
{
  const localState = { cases: [baseCase("111")], bookings: [], syncConflicts: [], syncLog: [], auditLog: [] };
  const remoteState = { cases: [baseCase("222")], bookings: [], syncConflicts: [], syncLog: [], auditLog: [] };
  const first = mergeRemoteStateIntoLocal(localState, remoteState, { reason: "test" });
  assert.equal(first.stats.newConflicts, 1, "premier conflit détecté (needs_review par défaut)");
  const key = first.state.syncConflicts[0].conflictKey;
  assert.ok(key, "clé stable créée");

  const second = mergeRemoteStateIntoLocal(first.state, remoteState, { reason: "test-repeat" });
  assert.equal(second.stats.newConflicts, 0, "conflit déjà connu non renotifié");
  assert.equal(second.state.syncConflicts.filter((item) => item.conflictKey === key).length, 1, "conflit dédupliqué");
}

console.log("Tous les tests d'auto-résolution conflits sync v23.0.5 validés avec succès !");
