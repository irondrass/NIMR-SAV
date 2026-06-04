import assert from "node:assert/strict";
import fs from "node:fs";

console.log("Démarrage tests résolution conflits sync v23.0.4...");

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
  const __cloudFlushes = [];
  const __notifications = [];
  function render() {}
  function setSupabaseStatus(label, level) { global.__lastSupabaseStatus = { label, level }; }
  function setSupabaseDetails(details) { global.__lastSupabaseDetails = details; }
  function notifyUser(message, variant) { __notifications.push({ message, variant }); }
  function quietNotify(message, variant) { global.__lastQuietNotify = { message, variant }; }
  async function restorePhotoRecords() {}
  function isSupabaseConfigured() { return true; }
  function getSupabaseClient() { return null; }
  async function getSupabaseUser() { return null; }
  function shouldApplyRemoteBackup() { return true; }
  async function confirmRemoteBackupConflict() { return true; }
  async function createSyncSafetySnapshot() { return { id: "snap" }; }
  function getTimestampMs(value) { return value ? new Date(value).getTime() || 0 : 0; }
  ${syncJs}
  module.exports = {
    mergeRemoteStateIntoLocal,
    applyRemoteSupabaseBackup,
    normalizeSyncConflicts,
    getOpenSyncConflicts,
    resolveSyncConflict,
    getAggregatedActivityLog,
    clearLocalUserChangeAt,
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
  getState,
  setState,
  getNotifications,
  getLastStatus,
  getLastDetails,
} = mod.exports;

function baseCase(phone = "111") {
  return { id: "case-1", orNavNumber: "OR-1", clientName: "Client", phone, flags: {}, history: [] };
}

// 1. Même conflit répété : une seule entrée stable, aucun nouveau conflit au second merge.
{
  const localState = { cases: [baseCase("111")], bookings: [], syncConflicts: [], syncLog: [], auditLog: [] };
  const remoteState = { cases: [baseCase("222")], bookings: [], syncConflicts: [], syncLog: [], auditLog: [] };
  const first = mergeRemoteStateIntoLocal(localState, remoteState, { reason: "test" });
  assert.equal(first.stats.newConflicts, 1, "premier conflit détecté");
  assert.equal(first.conflicts.length, 1, "premier conflit retourné");
  const key = first.state.syncConflicts[0].conflictKey;
  assert.ok(key, "clé stable créée");

  const second = mergeRemoteStateIntoLocal(first.state, remoteState, { reason: "test-repeat" });
  assert.equal(second.stats.newConflicts, 0, "conflit déjà connu non renotifié");
  assert.equal(second.conflicts.length, 0, "aucun nouveau conflit retourné");
  assert.equal(second.state.syncConflicts.filter((item) => item.conflictKey === key).length, 1, "conflit dédupliqué");
}

// 2. Un conflit résolu ne réapparaît pas avec les mêmes valeurs.
{
  const localState = { cases: [baseCase("111")], bookings: [], syncConflicts: [], syncLog: [], auditLog: [] };
  const remoteState = { cases: [baseCase("222")], bookings: [], syncConflicts: [], syncLog: [], auditLog: [] };
  const first = mergeRemoteStateIntoLocal(localState, remoteState, { reason: "test" });
  first.state.syncConflicts[0].status = "resolved";
  const second = mergeRemoteStateIntoLocal(first.state, remoteState, { reason: "test-resolved" });
  assert.equal(second.stats.newConflicts, 0, "conflit résolu non rouvert");
  assert.equal(second.state.syncConflicts[0].status, "resolved", "statut résolu conservé");
}

// 3. Nouvelle valeur distante = nouveau conflit légitime.
{
  const localState = { cases: [baseCase("111")], bookings: [], syncConflicts: [], syncLog: [], auditLog: [] };
  const first = mergeRemoteStateIntoLocal(localState, { cases: [baseCase("222")], bookings: [] }, { reason: "test" });
  const second = mergeRemoteStateIntoLocal(first.state, { cases: [baseCase("333")], bookings: [] }, { reason: "test-new-value" });
  assert.equal(second.stats.newConflicts, 1, "nouvelle valeur distante crée un nouveau conflit");
  assert.equal(second.state.syncConflicts.length, 2, "ancien et nouveau conflits conservés");
}

// 4. Résolution keep_local ferme le conflit et conserve la valeur locale.
{
  const merged = mergeRemoteStateIntoLocal({ cases: [baseCase("111")], bookings: [], syncConflicts: [] }, { cases: [baseCase("222")], bookings: [] });
  setState(merged.state);
  const result = resolveSyncConflict(merged.state.syncConflicts[0].id, "keep_local");
  assert.equal(result.ok, true);
  assert.equal(getState().cases[0].phone, "111");
  assert.equal(getOpenSyncConflicts().length, 0, "conflit fermé après garder local");
  assert.equal(getState().syncConflicts[0].status, "resolved");
}

// 5. Résolution accept_cloud applique la valeur distante.
{
  const merged = mergeRemoteStateIntoLocal({ cases: [baseCase("111")], bookings: [], syncConflicts: [] }, { cases: [baseCase("222")], bookings: [] });
  setState(merged.state);
  const result = resolveSyncConflict(merged.state.syncConflicts[0].id, "accept_cloud");
  assert.equal(result.ok, true);
  assert.equal(getState().cases[0].phone, "222");
  assert.equal(getOpenSyncConflicts().length, 0, "conflit fermé après acceptation cloud");
}

// 6. Journal activité expose un conflit lisible sans undefined.
{
  const merged = mergeRemoteStateIntoLocal({ cases: [baseCase("111")], bookings: [], syncConflicts: [] }, { cases: [baseCase("222")], bookings: [] });
  setState(merged.state);
  const logs = getAggregatedActivityLog(20, "admin");
  const conflictLog = logs.find((log) => log.type === "sync.conflict");
  assert.ok(conflictLog, "conflit visible dans journal");
  assert.ok(conflictLog.details.includes("à résoudre"), "statut ouvert lisible");
  assert.ok(!conflictLog.details.includes("undefined"), "pas de undefined dans le journal");
}

// 7. Application cloud répétée : un seul toast pour le conflit nouveau.
{
  setState({ cases: [baseCase("111")], bookings: [], syncConflicts: [], syncLog: [], auditLog: [] });
  const payload = {
    updated_at: "2026-06-04T10:00:00.000Z",
    updated_by: "pc2",
    app_version: "v23.0.4",
    state: { cases: [baseCase("222")], bookings: [], syncConflicts: [], syncLog: [], auditLog: [] },
  };
  await applyRemoteSupabaseBackup(payload, "test");
  clearLocalUserChangeAt();
  await applyRemoteSupabaseBackup({ ...payload, updated_at: "2026-06-04T10:01:00.000Z" }, "test-repeat");
  const conflictToasts = getNotifications().filter((item) => item.message.includes("Conflit de synchronisation détecté"));
  assert.equal(conflictToasts.length, 1, "toast conflit affiché une seule fois pour le même conflit");
  assert.ok(getLastStatus().label.includes("Conflit") || getLastStatus().label.includes("Synchronisé"));
  assert.ok(getLastDetails(), "détails Supabase renseignés");
}

console.log("Tests résolution conflits sync v23.0.4 validés.");
