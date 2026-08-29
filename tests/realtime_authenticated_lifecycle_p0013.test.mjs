import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const WORKSHOP_ID = "00000000-0000-0000-0000-000000000001";
const USER_ONE = { id: "supabase-user-one", email: "one@example.test" };
const USER_TWO = { id: "supabase-user-two", email: "two@example.test" };
const syncSource = fs.readFileSync(new URL("../js/supabase-sync.js", import.meta.url), "utf8");
const clientSource = fs.readFileSync(new URL("../js/supabase-client.js", import.meta.url), "utf8");

function createStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
  };
}

function createElement() {
  return {
    disabled: false,
    title: "",
    textContent: "",
    dataset: {},
    style: {},
    matches() { return false; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
}

function createRealtimeHarness({ autoSubscribe = true } = {}) {
  const localStorage = createStorage();
  const timeoutCallbacks = [];
  const intervalCallbacks = new Map();
  const metadata = new Map();
  const observed = new Map();
  const channels = [];
  const removedChannels = [];
  const saveCalls = [];
  const dirtyCalls = [];
  const authCallbacks = [];
  let nextTimerId = 1;
  let renderCalls = 0;
  let processOfflineQueueCalls = 0;
  let realtimeSetAuthCalls = 0;
  let currentUser = null;

  class FakeChannel {
    constructor(name) {
      this.name = name;
      this.handlers = [];
      this.statusCallback = null;
    }

    on(kind, filter, callback) {
      this.handlers.push({ kind, filter, callback });
      return this;
    }

    subscribe(callback) {
      this.statusCallback = callback;
      if (autoSubscribe) callback("SUBSCRIBED");
      return this;
    }
  }

  const client = {
    auth: {
      onAuthStateChange(callback) {
        authCallbacks.push(callback);
        return {
          data: {
            subscription: {
              unsubscribe() {
                const index = authCallbacks.indexOf(callback);
                if (index >= 0) authCallbacks.splice(index, 1);
              },
            },
          },
        };
      },
    },
    realtime: {
      async setAuth() { realtimeSetAuthCalls += 1; },
    },
    channel(name) {
      const channel = new FakeChannel(name);
      channels.push(channel);
      return channel;
    },
    removeChannel(channel) {
      removedChannels.push(channel);
      return Promise.resolve("ok");
    },
  };

  const context = {
    console: { ...console, warn() {}, error() {} },
    localStorage,
    sessionStorage: createStorage(),
    document: {
      getElementById: () => createElement(),
      querySelector: () => createElement(),
      querySelectorAll: () => [],
      addEventListener() {},
      visibilityState: "visible",
    },
    navigator: { onLine: true },
    window: null,
    state: { cases: [], bookings: [], auditLog: [], syncConflicts: [] },
    STORAGE_KEY: "nimr-sav-state",
    APP_VERSION: "v23.3.8",
    CURRENT_DATA_SCHEMA_VERSION: 1,
    setTimeout(callback) {
      timeoutCallbacks.push(callback);
      return nextTimerId++;
    },
    clearTimeout() {},
    setInterval(callback) {
      const id = nextTimerId++;
      intervalCallbacks.set(id, callback);
      return id;
    },
    clearInterval(id) { intervalCallbacks.delete(id); },
    structuredClone,
    crypto: globalThis.crypto,
    Blob,
    URL: { createObjectURL: () => "", revokeObjectURL() {} },
    getSupabaseWorkshopId: () => WORKSHOP_ID,
    getSupabaseClient: () => client,
    getSupabaseUser: async () => currentUser,
    isSupabaseConfigured: () => true,
    guardSensitiveAction: () => ({ ok: true, message: "" }),
    refreshSupabaseConfigPermissionState: () => ({ ok: true }),
    renderAdminTechnicalVisibility() {},
    setSupabaseDetails() {},
    setSupabaseStatus() {},
    notifyUser() {},
    quietNotify() {},
    hydrateObservedGranularEntityMetadata: async () => {},
    loadSyncMetadata: async (key) => metadata.get(key) || null,
    putSyncMetadata: async (key, value) => {
      metadata.set(key, { ...(metadata.get(key) || {}), ...structuredClone(value) });
    },
    getObservedGranularEntityMetadata(workshopId, entityType, entityId) {
      return observed.get(`${workshopId}\u0000${entityType}\u0000${entityId}`) || null;
    },
    async rememberObservedGranularEntityMetadata(value) {
      observed.set(`${value.workshopId}\u0000${value.entityType}\u0000${value.entityId}`, structuredClone(value));
    },
    findActiveDurableOutboxOperationForEntity: async () => null,
    getComparableRuntimeScope: () => ({ lastKnownCasesComparable: Object.create(null) }),
    getComparableCaseJSON: (value) => JSON.stringify(value),
    markEntityCaseDirty(value, options) { dirtyCalls.push({ type: "case", value, options }); },
    markEntityCaseDeleted(value, options) { dirtyCalls.push({ type: "case-delete", value, options }); },
    markEntityBookingDirty(value, options) { dirtyCalls.push({ type: "booking", value, options }); },
    markEntityBookingDeleted(value, options) { dirtyCalls.push({ type: "booking-delete", value, options }); },
    markEntityAuditEntryDirty(value, options) { dirtyCalls.push({ type: "audit", value, options }); },
    invalidateStateReplacementIndexes() {},
    async saveState(options) { saveCalls.push(structuredClone(options)); return true; },
    render() { renderCalls += 1; },
    renderSyncStatusStrip() {},
    renderSupabaseSyncHealth: async () => {},
    loadDurableOutboxOperations: async () => [],
    getOpenSyncConflicts: () => [],
    getCurrentActor: () => ({ userId: "local-admin", userName: "Admin", userRole: "admin_technique" }),
    processOfflineQueue: async () => {
      processOfflineQueueCalls += 1;
      return { processed: 0 };
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(syncSource, context, { filename: "p0-013-supabase-sync.js" });
  const productionPullLatestSupabaseBackup = context.pullLatestSupabaseBackup;
  context.pullLatestSupabaseBackup = async () => ({ granular: true, cases: 0, bookings: 0 });

  return {
    context,
    client,
    channels,
    removedChannels,
    intervalCallbacks,
    timeoutCallbacks,
    metadata,
    observed,
    saveCalls,
    dirtyCalls,
    authCallbacks,
    setUser(user) { currentUser = user; },
    get renderCalls() { return renderCalls; },
    get processOfflineQueueCalls() { return processOfflineQueueCalls; },
    get realtimeSetAuthCalls() { return realtimeSetAuthCalls; },
    useProductionPull() { context.pullLatestSupabaseBackup = productionPullLatestSupabaseBackup; },
    run(code) { return vm.runInContext(code, context); },
    async flushTimeouts() {
      while (timeoutCallbacks.length) await timeoutCallbacks.shift()();
    },
    async flushLifecycle() {
      for (let attempt = 0; attempt < 20; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    },
    emitAuth(event, session) {
      [...authCallbacks].forEach((callback) => callback(event, session));
    },
  };
}

// A — an application permission is not proof of Supabase authentication.
const lifecycle = createRealtimeHarness();
lifecycle.context.refreshSupabasePermissionState("initialisation");
await lifecycle.flushLifecycle();
assert.equal(lifecycle.channels.length, 0, "aucun channel postgres_changes ne doit être créé avant authentification Supabase");
assert.equal(lifecycle.context.NIMR_REALTIME_STATUS.status, "waiting_auth");
assert.equal(lifecycle.context.NIMR_REALTIME_STATUS.connected, false);
assert.equal(lifecycle.context.NIMR_REALTIME_STATUS.authBound, false);

// B/F — auth creates one exact-workshop channel; refreshing the same session
// reuses it and does not duplicate subscriptions.
lifecycle.context.bindSupabaseAuthLifecycle();
assert.equal(lifecycle.authCallbacks.length, 1, "le listener auth doit être lié une seule fois");
lifecycle.setUser(USER_ONE);
lifecycle.emitAuth("SIGNED_IN", { user: USER_ONE });
await lifecycle.flushLifecycle();
assert.equal(lifecycle.channels.length, 1, "le login doit créer exactement un channel authentifié");
assert.equal(lifecycle.realtimeSetAuthCalls, 1, "Realtime doit adopter la session auth courante avant le channel");
assert.equal(lifecycle.channels[0].handlers.every((entry) => entry.filter.filter === `workshop_id=eq.${WORKSHOP_ID}`), true);
assert.equal(lifecycle.context.NIMR_REALTIME_STATUS.status, "subscribed_authenticated");
assert.equal(lifecycle.context.NIMR_REALTIME_STATUS.connected, true);
assert.equal(lifecycle.context.NIMR_REALTIME_STATUS.authBound, true);
assert.equal(lifecycle.context.NIMR_REALTIME_STATUS.userId, USER_ONE.id);
await lifecycle.context.startSupabaseLiveSync();
lifecycle.emitAuth("TOKEN_REFRESHED", { user: USER_ONE });
await lifecycle.flushLifecycle();
assert.equal(lifecycle.channels.length, 1, "la même session ne doit pas créer un deuxième channel");
assert.equal(lifecycle.authCallbacks.length, 1, "le refresh auth ne doit pas doubler le listener");

// INITIAL_SESSION — a persisted Supabase session restored during browser load
// must bind exactly one authenticated workshop channel. The subsequent
// SIGNED_IN/TOKEN_REFRESHED events for the same user only refresh auth.
const initialSession = createRealtimeHarness();
initialSession.context.bindSupabaseAuthLifecycle();
assert.equal(initialSession.authCallbacks.length, 1, "INITIAL_SESSION doit utiliser un listener auth unique");
initialSession.setUser(USER_ONE);
initialSession.emitAuth("INITIAL_SESSION", { user: USER_ONE });
await initialSession.flushLifecycle();
assert.equal(initialSession.channels.length, 1, "la session persistée doit créer exactement un channel");
assert.equal(initialSession.realtimeSetAuthCalls, 1, "la session persistée doit être liée à Realtime");
assert.equal(initialSession.channels[0].handlers.every((entry) => entry.filter.filter === `workshop_id=eq.${WORKSHOP_ID}`), true);
assert.equal(initialSession.context.NIMR_REALTIME_STATUS.status, "subscribed_authenticated");
assert.equal(initialSession.context.NIMR_REALTIME_STATUS.connected, true);
assert.equal(initialSession.context.NIMR_REALTIME_STATUS.authBound, true);
assert.equal(initialSession.context.NIMR_REALTIME_STATUS.userId, USER_ONE.id);
assert.equal(initialSession.context.NIMR_REALTIME_STATUS.workshopId, WORKSHOP_ID);

initialSession.emitAuth("SIGNED_IN", { user: USER_ONE });
await initialSession.flushLifecycle();
assert.equal(initialSession.channels.length, 1, "SIGNED_IN du même utilisateur ne doit pas dupliquer le channel initial");
assert.equal(initialSession.removedChannels.length, 0, "SIGNED_IN du même utilisateur ne doit pas recréer le channel");
assert.equal(initialSession.authCallbacks.length, 1);
const setAuthCallsAfterSignedIn = initialSession.realtimeSetAuthCalls;
assert.ok(setAuthCallsAfterSignedIn >= 2, "SIGNED_IN doit pouvoir réappliquer l'auth Realtime");

initialSession.emitAuth("TOKEN_REFRESHED", { user: USER_ONE });
await initialSession.flushLifecycle();
assert.equal(initialSession.channels.length, 1, "TOKEN_REFRESHED ne doit pas dupliquer le channel initial");
assert.equal(initialSession.removedChannels.length, 0);
assert.equal(initialSession.authCallbacks.length, 1);
assert.ok(initialSession.realtimeSetAuthCalls > setAuthCallsAfterSignedIn, "TOKEN_REFRESHED doit réappliquer l'auth Realtime");

// An empty persisted session remains waiting for authentication and must not
// create an anonymous postgres_changes subscription.
const emptyInitialSession = createRealtimeHarness();
emptyInitialSession.context.bindSupabaseAuthLifecycle();
assert.equal(emptyInitialSession.authCallbacks.length, 1);
emptyInitialSession.setUser(null);
emptyInitialSession.emitAuth("INITIAL_SESSION", null);
await emptyInitialSession.flushLifecycle();
assert.equal(emptyInitialSession.channels.length, 0);
assert.equal(emptyInitialSession.context.NIMR_REALTIME_STATUS.status, "waiting_auth");
assert.equal(emptyInitialSession.context.NIMR_REALTIME_STATUS.connected, false);
assert.equal(emptyInitialSession.context.NIMR_REALTIME_STATUS.authBound, false);

// C/E — a stale/pre-auth binding or a different user must be removed before a
// fresh authenticated channel is created.
const stale = createRealtimeHarness();
const staleChannel = { name: "pre-auth-stale" };
stale.context.__staleChannel = staleChannel;
stale.context.__staleClient = stale.client;
stale.run("supabaseLiveSyncChannel = __staleChannel; supabaseLiveSyncClient = __staleClient; supabaseLiveSyncIdentity = ''; ");
stale.setUser(USER_ONE);
await stale.context.startSupabaseLiveSync();
assert.equal(stale.removedChannels.includes(staleChannel), true, "le channel pré-auth stale doit être supprimé");
assert.equal(stale.channels.length, 1);
stale.setUser(USER_TWO);
await stale.context.startSupabaseLiveSync();
assert.equal(stale.removedChannels.includes(stale.channels[0]), true, "un changement de compte doit retirer l'ancien channel");
assert.equal(stale.channels.length, 2);
assert.equal(stale.context.NIMR_REALTIME_STATUS.userId, USER_TWO.id);

// D — sign-out closes the channel, clears polling and reports an honest state.
stale.context.bindSupabaseAuthLifecycle();
assert.equal(stale.intervalCallbacks.size, 1, "un unique polling de secours doit accompagner le channel");
stale.setUser(null);
stale.emitAuth("SIGNED_OUT", null);
await stale.flushLifecycle();
assert.equal(stale.removedChannels.includes(stale.channels[1]), true);
assert.equal(stale.intervalCallbacks.size, 0, "le polling doit être arrêté au logout");
assert.equal(stale.context.NIMR_REALTIME_STATUS.connected, false);
assert.equal(stale.context.NIMR_REALTIME_STATUS.status, "stopped");
assert.equal(stale.context.NIMR_REALTIME_STATUS.authBound, false);

// A Supabase runtime configuration/client reset must tear down the channel and
// its auth listener before discarding the owning client.
{
  let stopped = 0;
  let unbound = 0;
  const clientContext = {
    window: {
      NIMR_SUPABASE_CONFIG: {
        enabled: true,
        url: "https://project.example.test",
        anonKey: "sb_publishable_test",
        workshopId: WORKSHOP_ID,
      },
      supabase: { createClient: () => ({ id: "configured-client" }) },
    },
    stopSupabaseLiveSync() { stopped += 1; },
    unbindSupabaseAuthLifecycle() { unbound += 1; },
    console,
    atob,
  };
  clientContext.globalThis = clientContext;
  vm.createContext(clientContext);
  vm.runInContext(clientSource, clientContext, { filename: "p0-013-supabase-client.js" });
  assert.ok(clientContext.getSupabaseClient());
  clientContext.resetSupabaseClient();
  assert.equal(stopped, 1, "le reset client doit arrêter le channel détenu par l'ancien client");
  assert.equal(unbound, 1, "le reset client doit retirer l'ancien listener auth");
}

// Telemetry distinguishes connecting and channel errors without claiming an
// authenticated connection prematurely.
const telemetry = createRealtimeHarness({ autoSubscribe: false });
telemetry.setUser(USER_ONE);
await telemetry.context.startSupabaseLiveSync();
assert.equal(telemetry.context.NIMR_REALTIME_STATUS.status, "connecting");
assert.equal(telemetry.context.NIMR_REALTIME_STATUS.connected, false);
telemetry.channels[0].statusCallback("SUBSCRIBED");
assert.equal(telemetry.context.NIMR_REALTIME_STATUS.status, "subscribed_authenticated");
telemetry.channels[0].statusCallback("CHANNEL_ERROR");
assert.equal(telemetry.context.NIMR_REALTIME_STATUS.status, "channel_error");
assert.equal(telemetry.context.NIMR_REALTIME_STATUS.connected, false);

// Realtime INSERT/UPDATE apply the canonical entity, persist with skipCloud,
// render immediately and never create a reflected outbound mutation.
const inbound = createRealtimeHarness();
inbound.setUser(USER_ONE);
await inbound.context.startSupabaseLiveSync();
inbound.context.__handleRemoteCaseCalls = 0;
inbound.context.__applyRemoteEntityCalls = 0;
inbound.run(`
  const __productionHandleRemoteCaseChange = handleRemoteCaseChange;
  const __productionApplyRemoteEntityRow = applyRemoteEntityRow;
  handleRemoteCaseChange = async (...args) => {
    __handleRemoteCaseCalls += 1;
    return __productionHandleRemoteCaseChange(...args);
  };
  applyRemoteEntityRow = async (...args) => {
    __applyRemoteEntityCalls += 1;
    return __productionApplyRemoteEntityRow(...args);
  };
`);
const entityHandler = inbound.channels[0].handlers.find((entry) => entry.filter.table === "sync_entities")?.callback;
assert.equal(typeof entityHandler, "function");
const insertedRow = {
  workshop_id: WORKSHOP_ID,
  entity_type: "case",
  entity_id: "case-realtime",
  entity_version: 1,
  last_operation_id: "remote-op-1",
  payload: { id: "case-realtime", clientName: "Client INSERT" },
  deleted_at: null,
  updated_at: "2026-08-28T11:40:00.000Z",
};
entityHandler({ table: "sync_entities", eventType: "INSERT", new: insertedRow, commit_timestamp: insertedRow.updated_at });
assert.ok(inbound.context.NIMR_REALTIME_STATUS.lastEventAt, "la réception doit dater lastEventAt");
await inbound.flushTimeouts();
assert.equal(inbound.context.state.cases[0].clientName, "Client INSERT");
assert.equal(inbound.context.__handleRemoteCaseCalls, 1);
assert.equal(inbound.context.__applyRemoteEntityCalls, 1);
assert.equal(inbound.renderCalls, 1);
assert.equal(inbound.saveCalls.every((options) => options.skipCloud === true), true);
assert.equal(inbound.dirtyCalls.every((entry) => entry.options?.skipCloud === true), true);

const updatedRow = {
  ...insertedRow,
  entity_version: 2,
  last_operation_id: "remote-op-2",
  payload: { id: "case-realtime", clientName: "Client UPDATE" },
  updated_at: "2026-08-28T11:41:00.000Z",
};
entityHandler({ table: "sync_entities", eventType: "UPDATE", new: updatedRow, commit_timestamp: updatedRow.updated_at });
await inbound.flushTimeouts();
assert.equal(inbound.context.state.cases[0].clientName, "Client UPDATE");
assert.equal(inbound.context.__handleRemoteCaseCalls, 2);
assert.equal(inbound.context.__applyRemoteEntityCalls, 2);
assert.equal(inbound.renderCalls, 2);
assert.ok(inbound.context.localStorage.getItem("nimr-sav-state:last-granular-server-confirmation"));

// Polling remains an independently testable convergence path when Realtime is
// subscribed but no postgres_changes event arrives.
const polling = createRealtimeHarness();
polling.setUser(USER_ONE);
polling.context.NIMR_REALTIME_STATUS = {
  connected: true,
  status: "subscribed_authenticated",
  authBound: true,
  workshopId: WORKSHOP_ID,
  userId: USER_ONE.id,
  lastEventAt: "",
};
polling.context.state.cases = [{ id: "case-poll", clientName: "Version N" }];
polling.observed.set(`${WORKSHOP_ID}\u0000case\u0000case-poll`, {
  workshopId: WORKSHOP_ID,
  entityType: "case",
  entityId: "case-poll",
  serverVersion: 4,
  lastOperationId: "remote-op-4",
  deleted: false,
});
polling.metadata.set(`granular-sync:${WORKSHOP_ID}:bootstrap`, { initialized: true });
polling.metadata.set(`granular-sync:${WORKSHOP_ID}:case`, {
  initialized: true,
  cursor: { updatedAt: "2026-08-28T11:42:00.000Z", entityId: "case-poll" },
});
let casePageRead = false;
polling.context.fetchGranularEntityPage = async (_client, entityType, cursor) => {
  if (entityType !== "case" || casePageRead) return { rows: [], cursor, hasMore: false };
  casePageRead = true;
  return {
    rows: [{
      workshop_id: WORKSHOP_ID,
      entity_type: "case",
      entity_id: "case-poll",
      entity_version: 5,
      last_operation_id: "remote-op-5",
      payload: { id: "case-poll", clientName: "Version N+1" },
      deleted_at: null,
      updated_at: "2026-08-28T11:43:00.000Z",
    }],
    cursor: { updatedAt: "2026-08-28T11:43:00.000Z", entityId: "case-poll" },
    hasMore: false,
  };
};
polling.context.pullGranularAuditGroup = async () => 0;
polling.context.restoreGranularWorkshopSettings = async () => false;
polling.context.performLegacyCloudBootstrap = async () => false;
polling.useProductionPull();
const pollingResult = await polling.context.runSupabasePollingFallback();
assert.equal(pollingResult.cases, 1);
assert.equal(polling.context.state.cases[0].clientName, "Version N+1");
assert.equal(polling.context.NIMR_REALTIME_STATUS.lastEventAt, "", "la convergence testée provient du polling, pas d'un faux événement Realtime");
assert.equal(polling.renderCalls, 1, "le polling doit rendre la version reçue visible sans F5");
assert.equal(polling.saveCalls.every((options) => options.skipCloud === true), true);
assert.equal(polling.dirtyCalls.every((entry) => entry.options?.skipCloud === true), true);
assert.ok(polling.context.localStorage.getItem("nimr-sav-state:last-granular-server-confirmation"));

// A successful no-change granular poll is still a current server confirmation,
// while the legacy backup timestamp remains a separately named diagnostic.
const noChangePull = createRealtimeHarness();
noChangePull.setUser(USER_ONE);
noChangePull.metadata.set(`granular-sync:${WORKSHOP_ID}:bootstrap`, { initialized: true });
noChangePull.context.fetchGranularEntityPage = async (_client, _entityType, cursor) => ({ rows: [], cursor, hasMore: false });
noChangePull.context.pullGranularAuditGroup = async () => 0;
noChangePull.context.restoreGranularWorkshopSettings = async () => false;
noChangePull.useProductionPull();
await noChangePull.context.pullLatestSupabaseBackup("confirmation-sans-changement");
assert.ok(noChangePull.context.localStorage.getItem("nimr-sav-state:last-granular-server-confirmation"));
assert.equal(noChangePull.renderCalls, 0);

// PWA delivery contract: every runtime reference must force v23.3.8.
const versionSource = fs.readFileSync(new URL("../js/version.js", import.meta.url), "utf8");
const stateSource = fs.readFileSync(new URL("../js/state.js", import.meta.url), "utf8");
const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const serviceWorkerSource = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const offlineSource = fs.readFileSync(new URL("../offline.html", import.meta.url), "utf8");
assert.match(versionSource, /window\.APP_VERSION = "v23\.3\.8"/u);
assert.match(versionSource, /window\.NIMR_CACHE_NAME = "nimr-sav-v23\.3\.8"/u);
assert.match(stateSource, /const APP_VERSION = "v23\.3\.8"/u);
assert.match(serviceWorkerSource, /const CACHE_NAME = "nimr-sav-v23\.3\.8"/u);
for (const match of indexSource.matchAll(/\?v=([0-9.]+)/gu)) assert.equal(match[1], "23.3.8");
assert.match(appSource, /serviceWorker\.register\("sw\.js\?v=23\.3\.8"/u);
assert.match(offlineSource, /styles\.css\?v=23\.3\.8/u);

console.log("P0-013 AUTHENTICATED REALTIME LIFECYCLE OK");
