import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const utilsSource = fs.readFileSync(new URL("../js/utils.js", import.meta.url), "utf8");
const stateSource = fs.readFileSync(new URL("../js/state.js", import.meta.url), "utf8");
const clientSource = fs.readFileSync(new URL("../js/supabase-client.js", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

const WORKSHOP_ID = "00000000-0000-0000-0000-000000000001";

function createStorage() {
  const values = new Map();
  return {
    values,
    api: {
      getItem: (key) => (values.has(key) ? values.get(key) : null),
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
      clear: () => values.clear(),
    },
  };
}

function createHarness({
  online = true,
  mockClient = null,
  resolveMembership = null,
  users = [],
  currentUserId = "",
  sessionUnlockedUserId = null,
} = {}) {
  const localStore = createStorage();
  const sessionStore = createStorage();
  if (sessionUnlockedUserId) {
    sessionStore.api.setItem("nimr-user-pin-unlocked", sessionUnlockedUserId);
  }

  const elements = {};
  const getElement = (idOrSelector) => {
    const id = String(idOrSelector || "").replace(/^[.#]/u, "");
    if (!elements[id]) {
      elements[id] = {
        id,
        hidden: true,
        disabled: false,
        value: "",
        innerHTML: "",
        textContent: "",
        dataset: {},
        style: {},
        attributes: new Map(),
        listeners: new Map(),
        classList: {
          classes: new Set(),
          add(c) { this.classes.add(c); },
          remove(c) { this.classes.delete(c); },
          contains(c) { return this.classes.has(c); },
          toggle(c, force) {
            if (force === undefined) {
              if (this.classes.has(c)) this.classes.delete(c); else this.classes.add(c);
            } else if (force) {
              this.classes.add(c);
            } else {
              this.classes.delete(c);
            }
          },
        },
        addEventListener(type, listener) {
          if (!this.listeners.has(type)) this.listeners.set(type, []);
          this.listeners.get(type).push(listener);
        },
        removeEventListener() {},
        setAttribute(name, value) { this.attributes.set(name, value); },
        removeAttribute(name) { this.attributes.delete(name); },
        hasAttribute(name) { return this.attributes.has(name); },
        getAttribute(name) { return this.attributes.get(name) || null; },
        appendChild(child) { return child; },
        removeChild(child) { return child; },
        replaceChildren() {},
        contains: () => false,
        closest: () => null,
        querySelector: (sel) => getElement(sel),
        querySelectorAll: () => [],
        focus() {},
      };
    }
    return elements[id];
  };

  const body = getElement("body");
  const appShell = getElement("app-shell");
  appShell.contains = () => false;

  let renderCount = 0;

  const defaultMockClient = mockClient || {
    auth: {
      async getUser() {
        return { data: { user: null }, error: null };
      },
      async getSession() {
        return { data: { session: null }, error: null };
      },
    },
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: null, error: null }; },
      };
    },
  };

  const context = {
    window: {},
    console,
    navigator: { onLine: online },
    document: {
      body,
      activeElement: body,
      getElementById: (id) => getElement(id),
      querySelector: (selector) => {
        if (selector === ".app-shell") return appShell;
        return getElement(selector);
      },
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
      createElement: (tag) => getElement(`elem-${tag}-${Object.keys(elements).length}`),
    },
    localStorage: localStore.api,
    sessionStorage: sessionStore.api,
    NIMR_SUPABASE_CONFIG: {
      enabled: true,
      url: "https://test-workshop.supabase.co",
      anonKey: "mock-anon-key",
      workshopId: WORKSHOP_ID,
    },
    getSupabaseWorkshopId: () => WORKSHOP_ID,
    getSupabaseClient: () => defaultMockClient,
    resolveSupabaseWorkshopMembership: resolveMembership || (async () => ({ ok: false, code: "NOT_A_MEMBER" })),
    isLocalSessionUnlocked: () => true,
    ensureCurrentTabAllowed: () => {},
    render: () => { renderCount += 1; },
    resetUserSessionIdleTimer: () => {},
    notifyUser: () => {},
    quietNotify: () => {},
    async pullLatestSupabaseBackup() { return { ok: true }; },
    async startSupabaseLiveSync() { return true; },
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
  };
  context.window = context;

  vm.createContext(context);
  vm.runInContext(utilsSource, context);
  vm.runInContext(stateSource, context);
  vm.runInContext("window.state = state;", context);
  vm.runInContext(clientSource, context);
  vm.runInContext(
    appSource
      .replace("initApp();", "/* initApp(); */")
      .replace(/document\.addEventListener\("DOMContentLoaded",\s*init\);/u, "/* init skipped */")
      .replace(/document\.addEventListener\("DOMContentLoaded",\s*setupMobileMenu\);/u, "/* setupMobileMenu skipped */")
      .replace(/window\.addEventListener\("load",\s*setupMobileMenu\);/u, "/* setupMobileMenu skipped */"),
    context
  );

  context.getSupabaseClient = () => defaultMockClient;
  if (resolveMembership) {
    context.resolveSupabaseWorkshopMembership = resolveMembership;
  }
  context.isLocalSessionUnlocked = () => true;
  context.render = () => { renderCount += 1; };
  context.ensureCurrentTabAllowed = () => {};

  context.state.users = JSON.parse(JSON.stringify(users));
  context.state.currentUserId = currentUserId;

  return {
    context,
    getElement,
    get renderCount() { return renderCount; },
    sessionStore,
  };
}

function createValidTechnicianUser(overrides = {}) {
  return {
    id: "u-tech-1",
    name: "Tahar Technicien",
    email: "tahar@nimr.tn",
    role: "technicien",
    active: true,
    resourceId: "r-tech-1",
    authUserId: "auth-uuid-tech-1",
    authSource: "supabase_membership",
    membershipValidatedAt: "2026-09-08T08:00:00.000Z",
    membershipWorkshopId: WORKSHOP_ID,
    pinHash: "",
    pinRequired: false,
    ...overrides,
  };
}

function createValidDirectorUser(overrides = {}) {
  return {
    id: "u-dir-1",
    name: "Mohamed Directeur",
    email: "mohamed@nimr.tn",
    role: "directeur",
    active: true,
    resourceId: "",
    authUserId: "auth-uuid-dir-1",
    authSource: "supabase_membership",
    membershipValidatedAt: "2026-09-08T08:00:00.000Z",
    membershipWorkshopId: WORKSHOP_ID,
    pinHash: "hash-director-secret",
    pinSalt: "salt-director-secret",
    pinRequired: true,
    ...overrides,
  };
}

// ==============================================================================
// SCENARIO A: EXISTING OFFLINE CONTRACT (navigator.onLine = false)
// ==============================================================================
test("Scenario A: Existing offline contract allows validated cached identity (PASSES CURRENT + FUTURE)", async () => {
  const techUser = createValidTechnicianUser();
  const harness = createHarness({
    online: false,
    users: [techUser],
    currentUserId: techUser.id,
  });

  const result = await harness.context.checkUserSessionStartup();

  assert.equal(result.ok, true, "Startup must be allowed offline for validated cached user");
  assert.equal(result.code, "OFFLINE_CURRENT_IDENTITY");
  assert.equal(result.user?.id, techUser.id);
  assert.equal(harness.getElement("first-access-overlay").hidden, true, "First-access overlay must be hidden");
  assert.equal(harness.renderCount, 1, "Workspace must be rendered");
});

// ==============================================================================
// SCENARIO B: STRUCTURED SUPABASE TRANSPORT FAILURE (AuthRetryableFetchError)
// ==============================================================================
test("Scenario B: Structured Supabase transport failure while navigator.onLine=true falls back to validated cache (FAILS CURRENT)", async () => {
  const techUser = createValidTechnicianUser();
  const mockClient = {
    auth: {
      async getUser() {
        return {
          data: { user: null },
          error: {
            name: "AuthRetryableFetchError",
            message: "Failed to fetch",
            status: 0,
          },
        };
      },
      async getSession() {
        return { data: { session: { user: { id: techUser.authUserId } } }, error: null };
      },
    },
  };

  const harness = createHarness({
    online: true,
    mockClient,
    users: [techUser],
    currentUserId: techUser.id,
  });

  const result = await harness.context.checkUserSessionStartup();

  assert.equal(result.ok, true, "Transport error must not lock out validated offline identity");
  assert.notEqual(result.code, "NO_CLOUD_SESSION", "Transport failure must not be collapsed to NO_CLOUD_SESSION");
  assert.equal(harness.getElement("first-access-overlay").hidden, true, "First-access cloud overlay must NOT be displayed");
  assert.equal(harness.renderCount, 1, "Workspace must render for validated technician");
});

// ==============================================================================
// SCENARIO C: THROWN FETCH TRANSPORT FAILURE (TypeError: Failed to fetch)
// ==============================================================================
test("Scenario C: Thrown fetch transport failure while navigator.onLine=true falls back to validated cache (FAILS CURRENT)", async () => {
  const techUser = createValidTechnicianUser();
  const mockClient = {
    auth: {
      async getUser() {
        throw new TypeError("Failed to fetch");
      },
      async getSession() {
        return { data: { session: { user: { id: techUser.authUserId } } }, error: null };
      },
    },
  };

  const harness = createHarness({
    online: true,
    mockClient,
    users: [techUser],
    currentUserId: techUser.id,
  });

  const result = await harness.context.checkUserSessionStartup();

  assert.equal(result.ok, true, "Thrown transport error must not lock out validated offline identity");
  assert.notEqual(result.code, "ONLINE_AUTH_CHECK_FAILED", "Transport exception must not trigger fatal cloud denial");
  assert.equal(harness.getElement("first-access-overlay").hidden, true, "First-access cloud overlay must NOT be displayed");
  assert.equal(harness.renderCount, 1, "Workspace must render for validated technician");
});

// ==============================================================================
// SCENARIO D: SENSITIVE ROLE / PIN LOCKED ON TRANSPORT FAILURE
// ==============================================================================
test("Scenario D: Sensitive role with transport failure enforces local PIN gate (FAILS CURRENT)", async () => {
  const directorUser = createValidDirectorUser();
  const mockClient = {
    auth: {
      async getUser() {
        return {
          data: { user: null },
          error: {
            name: "AuthRetryableFetchError",
            message: "Failed to fetch",
            status: 0,
          },
        };
      },
      async getSession() {
        return { data: { session: { user: { id: directorUser.authUserId } } }, error: null };
      },
    },
  };

  const harness = createHarness({
    online: true,
    mockClient,
    users: [directorUser],
    currentUserId: directorUser.id,
    sessionUnlockedUserId: null,
  });

  const result = await harness.context.checkUserSessionStartup();

  assert.equal(harness.getElement("first-access-overlay").hidden, true, "Cloud first-access overlay must remain hidden");
  assert.equal(harness.getElement("user-login-overlay").hidden, false, "Local PIN gate must be shown for sensitive role");
  assert.equal(harness.renderCount, 0, "Sensitive workspace must remain locked before PIN entry");
});

// ==============================================================================
// SCENARIO E: TRANSPORT FAILURE WITHOUT VALID CACHED IDENTITY
// ==============================================================================
test("Scenario E: Transport failure without valid cached identity fails closed (FAILS CURRENT on error classification)", async () => {
  const mockClient = {
    auth: {
      async getUser() {
        return {
          data: { user: null },
          error: {
            name: "AuthRetryableFetchError",
            message: "Failed to fetch",
            status: 0,
          },
        };
      },
      async getSession() {
        return { data: { session: null }, error: null };
      },
    },
  };

  const harness = createHarness({
    online: true,
    mockClient,
    users: [],
    currentUserId: "",
  });

  const result = await harness.context.checkUserSessionStartup();

  assert.equal(result.ok, false, "Startup without cached identity must be denied");
  assert.equal(result.code, "OFFLINE_IDENTITY_REQUIRED", "Must classify failure as OFFLINE_IDENTITY_REQUIRED rather than NO_CLOUD_SESSION");
  assert.equal(harness.getElement("first-access-overlay").hidden, false, "First-access overlay must be shown");
  assert.equal(harness.renderCount, 0, "No business workspace rendering allowed");
});

// ==============================================================================
// SCENARIO F: SEMANTIC AUTH REJECTION (HTTP 401 / Invalid Session)
// ==============================================================================
test("Scenario F: Semantic authentication rejection fails closed without offline fallback (PASSES CURRENT + FUTURE)", async () => {
  const techUser = createValidTechnicianUser();
  const mockClient = {
    auth: {
      async getUser() {
        return {
          data: { user: null },
          error: {
            name: "AuthApiError",
            message: "Invalid Refresh Token: Refresh Token Not Found",
            status: 401,
          },
        };
      },
      async getSession() {
        return { data: { session: null }, error: null };
      },
    },
  };

  const harness = createHarness({
    online: true,
    mockClient,
    users: [techUser],
    currentUserId: techUser.id,
  });

  const result = await harness.context.checkUserSessionStartup();

  assert.equal(result.ok, false, "Semantic auth rejection must deny startup");
  assert.equal(harness.getElement("first-access-overlay").hidden, false, "First-access cloud overlay must be shown");
  assert.equal(harness.renderCount, 0, "No business workspace rendering allowed on semantic auth failure");
});

// ==============================================================================
// SCENARIO G: SERVER MEMBERSHIP DENIED
// ==============================================================================
test("Scenario G: Server membership denial fails closed without offline fallback (PASSES CURRENT + FUTURE)", async () => {
  const techUser = createValidTechnicianUser();
  const mockClient = {
    auth: {
      async getUser() {
        return {
          data: { user: { id: techUser.authUserId, email: techUser.email } },
          error: null,
        };
      },
      async getSession() {
        return { data: { session: { user: { id: techUser.authUserId } } }, error: null };
      },
    },
  };

  const harness = createHarness({
    online: true,
    mockClient,
    resolveMembership: async () => ({
      ok: false,
      code: "NOT_A_MEMBER",
      message: "Votre compte n'est pas autorisé pour cet atelier.",
    }),
    users: [techUser],
    currentUserId: techUser.id,
  });

  const result = await harness.context.checkUserSessionStartup();

  assert.equal(result.ok, false, "Membership denial must deny startup");
  assert.equal(result.code, "NOT_A_MEMBER");
  assert.equal(harness.getElement("first-access-overlay").hidden, false, "First-access cloud overlay must be shown");
  assert.equal(harness.renderCount, 0, "No business workspace rendering allowed on membership denial");
});

// ==============================================================================
// SCENARIO H: EXPLICIT LOGOUT / NO CURRENT USER
// ==============================================================================
test("Scenario H: Explicit logout / no current user fails closed on transport failure (PASSES CURRENT + FUTURE)", async () => {
  const techUser = createValidTechnicianUser();
  const mockClient = {
    auth: {
      async getUser() {
        return {
          data: { user: null },
          error: {
            name: "AuthRetryableFetchError",
            message: "Failed to fetch",
            status: 0,
          },
        };
      },
      async getSession() {
        return { data: { session: null }, error: null };
      },
    },
  };

  const harness = createHarness({
    online: true,
    mockClient,
    users: [techUser],
    currentUserId: "", // Logged out state
  });

  const result = await harness.context.checkUserSessionStartup();

  assert.equal(result.ok, false, "Logged out state must deny startup");
  assert.equal(harness.getElement("first-access-overlay").hidden, false, "First-access cloud overlay must be shown");
  assert.equal(harness.renderCount, 0, "No business workspace rendering allowed");
});

// ==============================================================================
// SCENARIO I: WORKSHOP MISMATCH
// ==============================================================================
test("Scenario I: Cached identity with workshop mismatch fails closed on transport failure (PASSES CURRENT + FUTURE)", async () => {
  const foreignTechUser = createValidTechnicianUser({
    membershipWorkshopId: "different-workshop-uuid-9999",
  });
  const mockClient = {
    auth: {
      async getUser() {
        return {
          data: { user: null },
          error: {
            name: "AuthRetryableFetchError",
            message: "Failed to fetch",
            status: 0,
          },
        };
      },
      async getSession() {
        return { data: { session: null }, error: null };
      },
    },
  };

  const harness = createHarness({
    online: true,
    mockClient,
    users: [foreignTechUser],
    currentUserId: foreignTechUser.id,
  });

  const result = await harness.context.checkUserSessionStartup();

  assert.equal(result.ok, false, "Workshop mismatch must deny startup");
  assert.equal(harness.getElement("first-access-overlay").hidden, false, "First-access cloud overlay must be shown");
  assert.equal(harness.renderCount, 0, "No business workspace rendering allowed");
});

// ==============================================================================
// SCENARIO J: AuthRetryableFetchError WITH POSITIVE HTTP STATUS (status 503)
// ==============================================================================
test("Scenario J: AuthRetryableFetchError with HTTP status 503 fails closed without offline fallback (PASSES CURRENT + FUTURE)", async () => {
  const techUser = createValidTechnicianUser();
  const mockClient = {
    auth: {
      async getUser() {
        return {
          data: { user: null },
          error: {
            name: "AuthRetryableFetchError",
            message: "Service Unavailable",
            status: 503,
          },
        };
      },
      async getSession() {
        return { data: { session: { user: { id: techUser.authUserId } } }, error: null };
      },
    },
  };

  const harness = createHarness({
    online: true,
    mockClient,
    users: [techUser],
    currentUserId: techUser.id,
  });

  const result = await harness.context.checkUserSessionStartup();

  assert.equal(result.ok, false, "Positive HTTP 503 status must NOT trigger transport fallback");
  assert.equal(harness.getElement("first-access-overlay").hidden, false, "First-access overlay must be shown");
  assert.equal(harness.renderCount, 0, "No business workspace rendering allowed on server 503 error");
});

// ==============================================================================
// SCENARIO K: getSession REFRESH TRANSPORT FAILURE (status 0 / AuthRetryableFetchError)
// ==============================================================================
test("Scenario K: getSession refresh transport failure falls back to validated cache (FAILS CURRENT)", async () => {
  const techUser = createValidTechnicianUser();
  const mockClient = {
    auth: {
      async getSession() {
        return {
          data: { session: null },
          error: {
            name: "AuthRetryableFetchError",
            message: "Failed to fetch",
            status: 0,
          },
        };
      },
      async getUser() {
        return { data: { user: null }, error: null };
      },
    },
  };

  const harness = createHarness({
    online: true,
    mockClient,
    users: [techUser],
    currentUserId: techUser.id,
  });

  const result = await harness.context.checkUserSessionStartup();

  assert.equal(result.ok, true, "Transport error during getSession refresh must allow offline fallback");
  assert.equal(harness.getElement("first-access-overlay").hidden, true, "First-access cloud overlay must NOT be displayed");
  assert.equal(harness.renderCount, 1, "Workspace must render for validated technician");
});

// ==============================================================================
// SCENARIO L: MISSING getSupabaseSessionState FAILS CLOSED WITHOUT FALLBACK
// ==============================================================================
test("Scenario L: missing getSupabaseSessionState fails closed with AUTH_PROVIDER_UNAVAILABLE without calling getSupabaseUser", async () => {
  const techUser = createValidTechnicianUser();
  let getSupabaseUserCalled = false;

  const harness = createHarness({
    online: true,
    users: [techUser],
    currentUserId: techUser.id,
  });

  harness.context.getSupabaseUser = async () => {
    getSupabaseUserCalled = true;
    return { id: "tech-auth-id" };
  };
  harness.context.getSupabaseSessionState = undefined;
  harness.context.window.getSupabaseSessionState = undefined;

  const result = await harness.context.checkUserSessionStartup();

  assert.equal(result.ok, false, "Missing getSupabaseSessionState must fail startup");
  assert.equal(result.code, "AUTH_PROVIDER_UNAVAILABLE", "Missing getSupabaseSessionState must yield AUTH_PROVIDER_UNAVAILABLE");
  assert.equal(getSupabaseUserCalled, false, "Legacy getSupabaseUser must NOT be called as fallback");
  assert.equal(harness.getElement("first-access-overlay").hidden, false, "First access overlay must be displayed");
  assert.equal(harness.renderCount, 0, "No business workspace rendering permitted when session provider is absent");
});
