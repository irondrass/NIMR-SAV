import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const stateSource = fs.readFileSync(new URL("../js/state.js", import.meta.url), "utf8");
const versionSource = fs.readFileSync(new URL("../js/version.js", import.meta.url), "utf8");
const swSource = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const offlineSource = fs.readFileSync(new URL("../offline.html", import.meta.url), "utf8");
const configSource = fs.readFileSync(new URL("../js/supabase-config.js", import.meta.url), "utf8");
const clientSource = fs.readFileSync(new URL("../js/supabase-client.js", import.meta.url), "utf8");
const utilsSource = fs.readFileSync(new URL("../js/utils.js", import.meta.url), "utf8");
const schemaSource = fs.readFileSync(new URL("../supabase-schema.sql", import.meta.url), "utf8");

const results = [];

function check(name, callback) {
  callback();
  results.push(name);
  console.log(`PASS ${name}`);
}

async function checkAsync(name, callback) {
  await callback();
  results.push(name);
  console.log(`PASS ${name}`);
}

function createStorage() {
  const values = new Map();
  return {
    values,
    api: {
      getItem: (key) => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
      clear: () => values.clear(),
    },
  };
}

function createAppHarness({ online = true, getSupabaseUser, resolveMembership } = {}) {
  const local = createStorage();
  const session = createStorage();
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
        classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
        addEventListener(type, listener) {
          if (!this.listeners.has(type)) this.listeners.set(type, []);
          this.listeners.get(type).push(listener);
        },
        setAttribute(name, value) { this.attributes.set(name, value); },
        removeAttribute(name) { this.attributes.delete(name); },
        contains: () => false,
        closest: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        focus() {},
      };
    }
    return elements[id];
  };
  const body = { dataset: {} };
  let renderCount = 0;
  const context = {
    window: {},
    console,
    navigator: { onLine: online },
    document: {
      body,
      activeElement: body,
      getElementById: (id) => getElement(id),
      querySelector: (selector) => getElement(selector),
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
      createElement: () => getElement(`created-${Object.keys(elements).length}`),
    },
    localStorage: local.api,
    sessionStorage: session.api,
    getSupabaseWorkshopId: () => "00000000-0000-0000-0000-000000000001",
    getSupabaseUser: getSupabaseUser || (async () => null),
    resolveSupabaseWorkshopMembership: resolveMembership || (async () => ({ ok: false, code: "NOT_A_MEMBER" })),
    ensureCurrentTabAllowed() {},
    render: () => { renderCount += 1; },
    isLocalSessionUnlocked: () => true,
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
  vm.runInContext(appSource.replace("initApp();", "/* initApp(); */"), context);
  context.ensureCurrentTabAllowed = () => {};
  context.render = () => { renderCount += 1; };
  context.isLocalSessionUnlocked = () => true;
  return { context, elements, getElement, local, session, get renderCount() { return renderCount; } };
}

function stubInitDependencies(context) {
  [
    "configurePdfWorker", "bindMainNavigation", "bindCaseList", "bindCaseCreation",
    "bindQuickCreateMode", "populateCaseStatusFilters", "bindCaseFilters", "bindPlanningToolbar",
    "bindWorkshopForms", "bindSettingsWorkspaceNavigation", "bindBackupActions", "bindUserSessionActions",
    "bindUserSessionIdleEvents", "bindLocalSecurityControls", "bindOfflineStatus", "bindSyncConflictUsability",
    "bindSupabaseActions", "bindVehicleLookup", "bindKeyboardShortcuts", "bindAutoSaveSafety",
    "bindMobileResumeSafety", "migratePlanningLogicV28", "migratePlanningLogicV36", "initLocalSecurityGate",
    "resetUserSessionIdleTimer", "bindWorkHoursInputs", "loadBundledVehicleDatabase", "migrateLegacyPhotos",
    "registerServiceWorker",
  ].forEach((name) => { context[name] = () => {}; });
  context.hydrateLargeStateIfAvailable = async () => true;
  context.loadDurableOutboxOperations = async () => [];
  context.cleanupOrphanedStorage = async () => true;
}

// Check A — RELEASE / SCHEMA
check("A Release and schema baseline constants", () => {
  const versionMatch = versionSource.match(/window\.APP_VERSION = "([^"]+)";/u);
  assert.ok(versionMatch, "APP_VERSION present in version.js");
  const currentVersion = versionMatch[1];
  const queryVersion = currentVersion.replace(/^v/u, "");
  const cacheName = `nimr-sav-${currentVersion}`;

  assert.match(versionSource, new RegExp(`window\\.APP_VERSION = "${currentVersion}";`, "u"));
  assert.match(versionSource, new RegExp(`window\\.NIMR_BUILD = "${currentVersion}";`, "u"));
  assert.match(versionSource, new RegExp(`window\\.NIMR_CACHE_NAME = "${cacheName}";`, "u"));
  assert.match(stateSource, new RegExp(`const APP_VERSION = "${currentVersion}";`, "u"));
  assert.match(stateSource, /const DB_VERSION = 2;/u);
  assert.match(stateSource, /const CURRENT_DATA_SCHEMA_VERSION = 2;/u);
  assert.match(stateSource, /const CANONICAL_TASK_MODEL_VERSION = 1;/u);
  assert.match(swSource, new RegExp(`const CACHE_NAME = "${cacheName}";`, "u"));
  assert.match(appSource, new RegExp(`pdf\\.worker\\.min\\.js\\?v=${queryVersion}`, "u"));
  assert.match(appSource, new RegExp(`sw\\.js\\?v=${queryVersion}`, "u"));
  assert.match(indexSource, new RegExp(`styles\\.css\\?v=${queryVersion}`, "u"));
  assert.match(indexSource, new RegExp(`app\\.js\\?v=${queryVersion}`, "u"));
  assert.match(offlineSource, new RegExp(`styles\\.css\\?v=${queryVersion}`, "u"));
});

// Check B — ZERO-CONFIG PUBLIC SUPABASE
check("B Zero-config bundled public Supabase defaults", () => {
  assert.match(configSource, /https:\/\/mkecnwolvzgxltrasbmr\.supabase\.co/u);
  assert.match(configSource, /sb_publishable_v1a1PN7erXlVLCSk3OqVqA_NJ4RX1-Y/u);
  assert.match(configSource, /00000000-0000-0000-0000-000000000001/u);
  assert.match(configSource, /enabled:\s*true/u);
  assert.match(configSource, /backupKey:\s*["']nimr-sav-main["']/u);
  assert.doesNotMatch(configSource, /["']service_role["']/u);
  assert.doesNotMatch(configSource, /["']sb_secret_/u);

  const context = { window: {}, console, localStorage: { getItem: () => null } };
  vm.createContext(context);
  vm.runInContext(clientSource, context);
  assert.equal(context.looksLikeSupabaseServiceRoleKey("sb_secret_1234567890"), true);
  assert.equal(context.looksLikeSupabaseServiceRoleKey("sb_publishable_v1a1PN7erXlVLCSk3OqVqA_NJ4RX1-Y"), false);
});

// Check C — FRESH DEVICE LOGIN GATE
check("C Fresh device cloud login gate without self-provisioning", () => {
  const formMatch = indexSource.match(/<form[^>]*id="first-access-form"[\s\S]*?<\/form>/u);
  assert.ok(formMatch, "first-access-form exists in index.html");
  const formHtml = formMatch[0];
  assert.match(formHtml, /Connexion NIMR SAV/u);
  assert.match(formHtml, /input name="email"/u);
  assert.match(formHtml, /input name="password"/u);
  assert.doesNotMatch(formHtml, /select name="role"/u);
  assert.doesNotMatch(formHtml, /input name="name"/u);
  assert.doesNotMatch(formHtml, /Premier accès/u);
});

// Check D — FAIL-CLOSED APPLICATION ACCESS
await checkAsync("D Startup awaits identity gate with shell blocked and no early business render", async () => {
  const initBody = appSource.slice(appSource.indexOf("async function initApp()"), appSource.indexOf("function bindQuickCreateMode"));
  assert.ok(initBody.indexOf('setAttribute("inert", "")') < initBody.indexOf("await hydrateLargeStateIfAvailable"));
  assert.match(initBody, /await checkUserSessionStartup\(\)/u);
  assert.doesNotMatch(initBody, /\brender\(\)/u);
  assert.doesNotMatch(initBody, /\bsetActiveTab\(/u);

  let releaseAuth;
  let authStarted = false;
  const authPending = new Promise((resolve) => { releaseAuth = resolve; });
  const harness = createAppHarness({
    online: true,
    getSupabaseUser: async () => {
      authStarted = true;
      return authPending;
    },
    resolveMembership: async (authUser) => ({
      ok: true,
      membership: {
        workshop_id: "00000000-0000-0000-0000-000000000001",
        user_id: authUser.id,
        role: "reception",
        resource_id: null,
      },
    }),
  });
  stubInitDependencies(harness.context);
  harness.context.saveState = async () => true;

  const startup = harness.context.initApp();
  for (let attempt = 0; attempt < 20 && !authStarted; attempt += 1) await Promise.resolve();
  assert.equal(authStarted, true, "La vérification Supabase doit être atteinte");
  assert.equal(harness.getElement("app-shell").attributes.has("inert"), true, "Le shell doit être inerte pendant l'attente auth");
  assert.equal(harness.renderCount, 0, "Aucun rendu métier avant la décision d'identité");
  assert.equal(harness.context.__nimrAppReady, false, "L'application ne doit pas être prête pendant l'attente auth");

  releaseAuth({ id: "auth-delayed", email: "delayed@nimr.test" });
  await startup;
  assert.equal(harness.renderCount, 1, "Un seul rendu autorisé après résolution du gate");
  assert.equal(harness.context.__nimrAppReady, true);
});

// Check E — SERVER MEMBERSHIP REQUIRED
await checkAsync("E Server membership query required and fails closed on unlisted user", async () => {
  const context = {
    window: {},
    console,
    getSupabaseWorkshopId: () => "00000000-0000-0000-0000-000000000001",
    normalizeUserRole: (r) => r,
    isKnownUserRole: (r) => ["admin_technique", "technicien", "reception", "directeur"].includes(r),
  };
  vm.createContext(context);
  vm.runInContext(clientSource, context);

  // Missing user -> fails closed
  const noUserRes = await context.resolveSupabaseWorkshopMembership(null);
  assert.equal(noUserRes.ok, false);
  assert.equal(noUserRes.code, "NO_AUTH_USER");

  // Mock client returning valid membership
  let queriedTable = "";
  let selectFields = "";
  let filters = {};
  context.getSupabaseClient = () => ({
    from: (table) => {
      queriedTable = table;
      return {
        select: (fields) => {
          selectFields = fields;
          return {
            eq: (col1, val1) => ({
              eq: (col2, val2) => {
                filters[col1] = val1;
                filters[col2] = val2;
                return {
                  maybeSingle: async () => ({
                    data: {
                      workshop_id: "00000000-0000-0000-0000-000000000001",
                      user_id: "user-123",
                      role: "technicien",
                      resource_id: "res-tolier-1",
                    },
                    error: null,
                  }),
                };
              },
            }),
          };
        },
      };
    },
  });

  const validRes = await context.resolveSupabaseWorkshopMembership({ id: "user-123", email: "tech@nimr.com.tn" });
  assert.equal(validRes.ok, true);
  assert.equal(validRes.membership.role, "technicien");
  assert.equal(validRes.membership.resource_id, "res-tolier-1");
  assert.equal(queriedTable, "workshop_members");
  assert.equal(selectFields, "workshop_id, user_id, role, resource_id");
  assert.equal(filters.workshop_id, "00000000-0000-0000-0000-000000000001");
  assert.equal(filters.user_id, "user-123");

  // User authenticated in auth.users but not listed in workshop_members -> denied
  context.getSupabaseClient = () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    }),
  });
  const notMemberRes = await context.resolveSupabaseWorkshopMembership({ id: "user-unauthorized" });
  assert.equal(notMemberRes.ok, false);
  assert.equal(notMemberRes.code, "NOT_A_MEMBER");

  const responseFor = (response) => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => response }),
        }),
      }),
    }),
  });
  context.getSupabaseClient = () => responseFor({ data: null, error: { message: "membership db unavailable" } });
  const dbErrorRes = await context.resolveSupabaseWorkshopMembership({ id: "user-123" });
  assert.equal(dbErrorRes.ok, false);
  assert.equal(dbErrorRes.code, "DB_ERROR");

  context.getSupabaseClient = () => ({ from: () => { throw new Error("membership exception"); } });
  const exceptionRes = await context.resolveSupabaseWorkshopMembership({ id: "user-123" });
  assert.equal(exceptionRes.ok, false);
  assert.equal(exceptionRes.code, "EXCEPTION");

  for (const unsupportedRole of ["administrateur", "custom_role_unknown"]) {
    context.getSupabaseClient = () => responseFor({
      data: {
        workshop_id: "00000000-0000-0000-0000-000000000001",
        user_id: "user-123",
        role: unsupportedRole,
        resource_id: null,
      },
      error: null,
    });
    const roleRes = await context.resolveSupabaseWorkshopMembership({ id: "user-123" });
    assert.equal(roleRes.ok, false, `${unsupportedRole} doit être refusé`);
    assert.equal(roleRes.code, "UNSUPPORTED_ROLE");
  }

  const cachedDirector = `
    state.users = [{
      id: "cached-director", name: "Cached Director", email: "director@nimr.test",
      role: "directeur", active: true, authUserId: "auth-director",
      authSource: "supabase_membership", membershipValidatedAt: "2026-08-29T08:00:00.000Z",
      membershipWorkshopId: "00000000-0000-0000-0000-000000000001"
    }];
    state.currentUserId = "cached-director";
  `;
  const noSessionHarness = createAppHarness({ online: true, getSupabaseUser: async () => null });
  vm.runInContext(cachedDirector, noSessionHarness.context);
  const noSessionResult = await noSessionHarness.context.checkUserSessionStartup();
  assert.equal(noSessionResult.code, "NO_CLOUD_SESSION");
  assert.equal(noSessionHarness.renderCount, 0);
  assert.equal(noSessionHarness.getElement("first-access-overlay").hidden, false);

  const membershipErrorHarness = createAppHarness({
    online: true,
    getSupabaseUser: async () => ({ id: "auth-director", email: "director@nimr.test" }),
    resolveMembership: async () => ({ ok: false, code: "DB_ERROR", message: "membership db unavailable" }),
  });
  vm.runInContext(cachedDirector, membershipErrorHarness.context);
  const membershipErrorResult = await membershipErrorHarness.context.checkUserSessionStartup();
  assert.equal(membershipErrorResult.code, "DB_ERROR");
  assert.equal(membershipErrorHarness.renderCount, 0);

  const membershipExceptionHarness = createAppHarness({
    online: true,
    getSupabaseUser: async () => ({ id: "auth-director", email: "director@nimr.test" }),
    resolveMembership: async () => { throw new Error("membership exploded"); },
  });
  vm.runInContext(cachedDirector, membershipExceptionHarness.context);
  const membershipExceptionResult = await membershipExceptionHarness.context.checkUserSessionStartup();
  assert.equal(membershipExceptionResult.code, "ONLINE_AUTH_CHECK_FAILED");
  assert.equal(membershipExceptionHarness.renderCount, 0);

  const authExceptionHarness = createAppHarness({
    online: true,
    getSupabaseUser: async () => { throw new Error("auth lookup exploded"); },
  });
  vm.runInContext(cachedDirector, authExceptionHarness.context);
  const authExceptionResult = await authExceptionHarness.context.checkUserSessionStartup();
  assert.equal(authExceptionResult.code, "ONLINE_AUTH_CHECK_FAILED");
  assert.equal(authExceptionHarness.renderCount, 0);

  const syncFailureHarness = createAppHarness({
    online: true,
    getSupabaseUser: async () => ({ id: "auth-director", email: "director@nimr.test" }),
    resolveMembership: async () => ({
      ok: true,
      membership: {
        workshop_id: "00000000-0000-0000-0000-000000000001",
        user_id: "auth-director",
        role: "directeur",
        resource_id: null,
      },
    }),
  });
  vm.runInContext(cachedDirector, syncFailureHarness.context);
  syncFailureHarness.context.syncLocalUserFromSupabaseMembership = () => ({ ok: false, code: "MIRROR_REJECTED" });
  const syncFailureResult = await syncFailureHarness.context.checkUserSessionStartup();
  assert.equal(syncFailureResult.code, "MIRROR_REJECTED");
  assert.equal(syncFailureHarness.renderCount, 0);
});

// Check F — SERVER ROLE / RESOURCE AUTHORITY
check("F Server role and resource authority overrides local state", () => {
  const mockStore = new Map();
  const context = {
    window: {},
    console,
    localStorage: {
      getItem: (k) => mockStore.get(k) || null,
      setItem: (k, v) => mockStore.set(k, String(v)),
      removeItem: (k) => mockStore.delete(k),
    },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    getSupabaseWorkshopId: () => "00000000-0000-0000-0000-000000000001",
  };
  vm.createContext(context);
  vm.runInContext(utilsSource, context);
  vm.runInContext(stateSource, context);

  // Initialize resources in state
  vm.runInContext(`
    state.resources = [
      { id: "res-tech-1", name: "Ahmed Tech", role: "tolier", active: true },
      { id: "res-chef-1", name: "Chef Atelier", role: "chef_atelier", active: true }
    ];
  `, context);

  const authUser = { id: "auth-uuid-999", email: "ahmed@nimr.com.tn", user_metadata: { name: "Ahmed Ben Salah" } };
  const serverMembership = {
    workshop_id: "00000000-0000-0000-0000-000000000001",
    user_id: "auth-uuid-999",
    role: "technicien",
    resource_id: "res-tech-1",
  };

  const res = context.syncLocalUserFromSupabaseMembership(authUser, serverMembership);
  assert.equal(res.ok, true);
  assert.equal(context.getCurrentUser().id, res.user.id);
  assert.equal(res.user.authUserId, "auth-uuid-999");
  assert.equal(res.user.email, "ahmed@nimr.com.tn");
  assert.equal(res.user.role, "technicien");
  assert.equal(res.user.resourceId, "res-tech-1");
  assert.equal(res.user.authSource, "supabase_membership");

  // Server role update overrides local stale role
  const updatedMembership = { ...serverMembership, role: "chef_atelier", resource_id: "res-chef-1" };
  const res2 = context.syncLocalUserFromSupabaseMembership(authUser, updatedMembership);
  assert.equal(res2.ok, true);
  assert.equal(res2.user.role, "chef_atelier");
  assert.equal(res2.user.resourceId, "res-chef-1");
  assert.equal(context.getCurrentUser().role, "chef_atelier");

  const wrongUser = context.syncLocalUserFromSupabaseMembership(authUser, { ...serverMembership, user_id: "auth-other" });
  assert.equal(wrongUser.ok, false);
  assert.equal(wrongUser.code, "MEMBERSHIP_USER_MISMATCH");
  const wrongWorkshop = context.syncLocalUserFromSupabaseMembership(authUser, { ...serverMembership, workshop_id: "workshop-other" });
  assert.equal(wrongWorkshop.ok, false);
  assert.equal(wrongWorkshop.code, "MEMBERSHIP_WORKSHOP_MISMATCH");

  vm.runInContext(`
    state.users = [normalizeUser({
      id: "same-auth", name: "Same Auth", email: "pin@nimr.test", role: "reception", active: true,
      authUserId: "auth-pin", pinHash: "pin-hash-same", pinSalt: "pin-salt-same"
    }, state.resources)];
    state.currentUserId = "same-auth";
  `, context);
  const sameAuth = context.syncLocalUserFromSupabaseMembership(
    { id: "auth-pin", email: "pin@nimr.test" },
    { ...serverMembership, user_id: "auth-pin", role: "reception", resource_id: null },
  );
  assert.equal(sameAuth.ok, true);
  assert.equal(sameAuth.user.pinHash, "pin-hash-same", "Le même authUserId peut conserver son PIN");
  assert.equal(sameAuth.user.pinSalt, "pin-salt-same");

  vm.runInContext(`
    state.users = [normalizeUser({
      id: "other-auth", name: "Other Auth", email: "shared@nimr.test", role: "directeur", active: true,
      authUserId: "auth-old", pinHash: "pin-hash-old", pinSalt: "pin-salt-old"
    }, state.resources)];
    state.currentUserId = "other-auth";
  `, context);
  const differentAuth = context.syncLocalUserFromSupabaseMembership(
    { id: "auth-new", email: "shared@nimr.test" },
    { ...serverMembership, user_id: "auth-new", role: "reception", resource_id: null },
  );
  assert.equal(differentAuth.ok, true);
  assert.notEqual(differentAuth.user.id, "other-auth", "Un authUserId différent doit créer un miroir séparé");
  assert.equal(differentAuth.user.pinHash, "", "Le nouveau miroir ne doit jamais hériter du PIN");
  assert.equal(differentAuth.user.pinSalt, "");
  assert.equal(vm.runInContext("state.users.find((user) => user.id === 'other-auth').pinHash", context), "pin-hash-old");

  vm.runInContext(`
    state.users = [normalizeUser({
      id: "email-migration", name: "Email Migration", email: "migration@nimr.test", role: "reception", active: true,
      authUserId: "", pinHash: "legacy-pin-hash", pinSalt: "legacy-pin-salt"
    }, state.resources)];
    state.currentUserId = "email-migration";
  `, context);
  const emailMigration = context.syncLocalUserFromSupabaseMembership(
    { id: "auth-migrated", email: "migration@nimr.test" },
    { ...serverMembership, user_id: "auth-migrated", role: "reception", resource_id: null },
  );
  assert.equal(emailMigration.user.id, "email-migration");
  assert.equal(emailMigration.user.pinHash, "", "Une migration email doit invalider le PIN lié à l'ancienne identité");
  assert.equal(emailMigration.user.pinSalt, "");

  vm.runInContext(`
    state.resources = [{ id: "res-old-1", name: "Ancienne ressource", role: "tolier", active: true }];
    state.users = [];
    state.currentUserId = "";
  `, context);
  const staleResourceMirror = context.syncLocalUserFromSupabaseMembership(
    { id: "auth-server-resource", email: "resource@nimr.test" },
    { ...serverMembership, user_id: "auth-server-resource", role: "technicien", resource_id: "res-server-new" },
  );
  assert.equal(staleResourceMirror.ok, true);
  assert.equal(staleResourceMirror.user.resourceId, "res-server-new", "La ressource serveur ne doit pas être effacée par un cache local obsolète");
  assert.equal(vm.runInContext("state.resources.some((resource) => resource.id === 'res-server-new')", context), false, "Le miroir utilisateur ne doit pas créer de fausse ressource");
});

// Check G — PERSISTED SESSION STARTUP
await checkAsync("G Persisted session startup seamlessly authenticates and authorizes app", async () => {
  const mockStore = new Map();
  const elements = {};
  let renderCount = 0;
  let convergenceObserved = false;
  const getEl = (id) => {
    const cleanId = id.replace(/[.#]/g, "");
    if (!elements[cleanId]) {
      const attributes = new Set();
      elements[cleanId] = {
        id: cleanId,
        hidden: true,
        textContent: "",
        setAttribute: (name) => attributes.add(name),
        removeAttribute: (name) => attributes.delete(name),
        hasAttribute: (name) => attributes.has(name),
        addEventListener: () => {},
        classList: { add: () => {}, remove: () => {}, contains: () => false },
        dataset: {},
        closest: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        focus: () => {},
      };
    }
    return elements[cleanId];
  };

  const context = {
    window: {},
    console,
    navigator: { onLine: true },
    document: {
      getElementById: (id) => getEl(id),
      querySelector: (sel) => getEl(sel),
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    localStorage: {
      getItem: (k) => mockStore.get(k) || null,
      setItem: (k, v) => mockStore.set(k, String(v)),
      removeItem: (k) => mockStore.delete(k),
    },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    getSupabaseWorkshopId: () => "00000000-0000-0000-0000-000000000001",
    getSupabaseUser: async () => ({ id: "auth-user-persisted", email: "persisted@nimr.com.tn" }),
    resolveSupabaseWorkshopMembership: async () => ({
      ok: true,
      membership: {
        workshop_id: "00000000-0000-0000-0000-000000000001",
        user_id: "auth-user-persisted",
        role: "reception",
        resource_id: "res-server-authoritative",
      }
    }),
    pullLatestSupabaseBackup: async () => {
      assert.equal(getEl("app-shell").hasAttribute("inert"), true, "Le shell doit rester inerte pendant la convergence");
      assert.equal(renderCount, 0, "Aucun rendu métier ne doit précéder la convergence");
      vm.runInContext(`
        const convergingUser = state.users.find((user) => user.authUserId === "auth-user-persisted");
        convergingUser.role = "directeur";
        convergingUser.resourceId = "res-legacy-director";
      `, context);
      convergenceObserved = true;
      return { ok: true };
    },
    startSupabaseLiveSync: async () => {
      assert.equal(getEl("app-shell").hasAttribute("inert"), true, "Le shell doit rester inerte pendant le bootstrap live");
      assert.equal(renderCount, 0, "Le bootstrap live doit finir avant le rendu métier");
      return true;
    },
    ensureCurrentTabAllowed: () => {},
    render: () => { renderCount += 1; },
    isLocalSessionUnlocked: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(utilsSource, context);
  vm.runInContext(stateSource, context);
  const cleanApp = appSource.replace("initApp();", "/* initApp(); */");
  vm.runInContext(cleanApp, context);

  await context.checkUserSessionStartup();
  assert.equal(getEl("first-access-overlay").hidden, true, "Overlay doit être masqué");
  assert.equal(context.getCurrentUser().authUserId, "auth-user-persisted");
  assert.equal(convergenceObserved, true);
  assert.equal(context.getCurrentUser().role, "reception", "Le rôle workshop_members doit gagner après convergence");
  assert.equal(context.getCurrentUser().resourceId, "res-server-authoritative", "La ressource workshop_members doit gagner après convergence");
  assert.equal(renderCount, 1, "La session cloud validée doit rendre l'application une fois");
  assert.ok(
    [...mockStore.values()].some((value) => String(value).includes('"authUserId":"auth-user-persisted"') && String(value).includes('"membershipValidatedAt"')),
    "Le miroir validé doit être persisté localement avant l'accès",
  );
  assert.ok(
    [...mockStore.values()].some((value) => String(value).includes('"role":"reception"') && String(value).includes('"resourceId":"res-server-authoritative"')),
    "Le miroir workshop_members réappliqué après convergence doit être repersisté",
  );

  const cachedOnlineHarness = createAppHarness({ online: true, getSupabaseUser: async () => null });
  vm.runInContext(`
    state.users = [{
      id: "cached-online-director", name: "Cached Director", role: "directeur", active: true,
      authUserId: "auth-cached-director", authSource: "supabase_membership",
      membershipValidatedAt: "2026-08-29T08:00:00.000Z",
      membershipWorkshopId: "00000000-0000-0000-0000-000000000001"
    }];
    state.currentUserId = "cached-online-director";
  `, cachedOnlineHarness.context);
  const denied = await cachedOnlineHarness.context.checkUserSessionStartup();
  assert.equal(denied.code, "NO_CLOUD_SESSION");
  assert.equal(cachedOnlineHarness.renderCount, 0, "Le cache local ne remplace jamais une session cloud en ligne");
  assert.equal(cachedOnlineHarness.getElement("first-access-overlay").hidden, false);

  let postConvergenceMembershipCall = 0;
  const revokedDuringConvergenceHarness = createAppHarness({
    online: true,
    getSupabaseUser: async () => ({ id: "auth-revoked", email: "revoked@nimr.test" }),
    resolveMembership: async () => {
      postConvergenceMembershipCall += 1;
      if (postConvergenceMembershipCall === 1) {
        return {
          ok: true,
          membership: {
            workshop_id: "00000000-0000-0000-0000-000000000001",
            user_id: "auth-revoked",
            role: "reception",
            resource_id: null,
          },
        };
      }
      return { ok: false, code: "NOT_A_MEMBER", message: "membership revoked" };
    },
  });
  const revokedDuringConvergence = await revokedDuringConvergenceHarness.context.checkUserSessionStartup();
  assert.equal(revokedDuringConvergence.code, "NOT_A_MEMBER");
  assert.equal(revokedDuringConvergenceHarness.renderCount, 0, "Une appartenance révoquée pendant la convergence doit bloquer le rendu");
  assert.equal(revokedDuringConvergenceHarness.getElement("first-access-overlay").hidden, false);

  const persistenceFailureHarness = createAppHarness({
    online: true,
    getSupabaseUser: async () => ({ id: "auth-new-mirror", email: "new@nimr.test" }),
    resolveMembership: async () => ({
      ok: true,
      membership: {
        workshop_id: "00000000-0000-0000-0000-000000000001",
        user_id: "auth-new-mirror",
        role: "reception",
        resource_id: null,
      },
    }),
  });
  vm.runInContext("state.users = []; state.currentUserId = '';", persistenceFailureHarness.context);
  persistenceFailureHarness.context.saveState = async () => false;
  const persistenceFailure = await persistenceFailureHarness.context.checkUserSessionStartup();
  assert.equal(persistenceFailure.code, "LOCAL_MIRROR_PERSIST_FAILED");
  assert.equal(persistenceFailureHarness.renderCount, 0);
  assert.equal(vm.runInContext("state.users.length", persistenceFailureHarness.context), 0, "Un miroir non persisté doit être annulé");
  assert.equal(vm.runInContext("state.currentUserId", persistenceFailureHarness.context), "");
});

// Check H — SHARED DEVICE IDENTITY
await checkAsync("H Shared device logout clears session and returns to login gate", async () => {
  let supabaseSignedOut = false;
  const executeSupabaseSignOut = async (signOut) => {
    const clientContext = {
      console,
      localStorage: { getItem: () => null },
      NIMR_SUPABASE_CONFIG: {
        enabled: true,
        url: "https://sec001.supabase.co",
        anonKey: "sb_publishable_sec001_test",
        workshopId: "00000000-0000-0000-0000-000000000001",
      },
      supabase: { createClient: () => ({ auth: { signOut } }) },
    };
    clientContext.window = clientContext;
    vm.createContext(clientContext);
    vm.runInContext(clientSource, clientContext);
    return clientContext.signOutSupabaseSession();
  };
  const verifiedSuccess = await executeSupabaseSignOut(async () => ({ error: null }));
  const verifiedReturnedError = await executeSupabaseSignOut(async () => ({ error: new Error("network") }));
  const verifiedThrownError = await executeSupabaseSignOut(async () => { throw new Error("network thrown"); });
  const verifiedMissingResult = await executeSupabaseSignOut(async () => undefined);
  assert.equal(verifiedSuccess.ok, true, "{ error: null } doit confirmer la déconnexion");
  assert.equal(verifiedReturnedError.ok, false, "Une erreur retournée doit rejeter la déconnexion");
  assert.match(verifiedReturnedError.message, /network/u);
  assert.equal(verifiedThrownError.ok, false, "Une exception signOut doit rejeter la déconnexion");
  assert.match(verifiedThrownError.message, /network thrown/u);
  assert.equal(verifiedMissingResult.ok, false, "Une réponse absente ne doit pas confirmer la déconnexion");

  const mockStore = new Map();
  const sessionStore = createStorage();
  const elements = {};
  const getEl = (id) => {
    const cleanId = id.replace(/[.#]/g, "");
    if (!elements[cleanId]) {
      elements[cleanId] = {
        id: cleanId,
        hidden: true,
        textContent: "",
        setAttribute: () => {},
        removeAttribute: () => {},
        addEventListener: () => {},
        classList: { add: () => {}, remove: () => {}, contains: () => false },
        dataset: {},
        closest: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        focus: () => {},
      };
    }
    return elements[cleanId];
  };

  const context = {
    window: {},
    console,
    navigator: { onLine: true },
    document: {
      getElementById: (id) => getEl(id),
      querySelector: (sel) => getEl(sel),
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    localStorage: {
      getItem: (k) => mockStore.get(k) || null,
      setItem: (k, v) => mockStore.set(k, String(v)),
      removeItem: (k) => mockStore.delete(k),
    },
    sessionStorage: sessionStore.api,
    signOutSupabaseSession: async () => { supabaseSignedOut = true; return verifiedSuccess; },
    getSupabaseWorkshopId: () => "00000000-0000-0000-0000-000000000001",
    render: () => {},
    quietNotify: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(utilsSource, context);
  vm.runInContext(stateSource, context);
  const cleanApp = appSource.replace("initApp();", "/* initApp(); */");
  vm.runInContext(cleanApp, context);
  const logoutErrors = [];
  context.notifyUser = (message, type) => logoutErrors.push({ message, type });

  // Set active user inside VM
  vm.runInContext("state.currentUserId = 'user-active'; window.__nimrValidatedAuthUserId = 'auth-active';", context);
  sessionStore.api.setItem("nimr-user-pin-unlocked", "user-active");
  const successfulLogout = await context.triggerLogout();

  assert.equal(supabaseSignedOut, true, "signOutSupabaseSession doit être appelé");
  assert.equal(successfulLogout.ok, true);
  const currentId = vm.runInContext("state.currentUserId", context);
  assert.equal(currentId, "", "currentUserId doit être vidé");
  assert.equal(sessionStore.api.getItem("nimr-user-pin-unlocked"), null);
  assert.equal(getEl("first-access-overlay").hidden, false, "first-access-overlay doit s'afficher");

  vm.runInContext("state.currentUserId = 'user-active'; window.__nimrValidatedAuthUserId = 'auth-active';", context);
  sessionStore.api.setItem("nimr-user-pin-unlocked", "user-active");
  getEl("first-access-overlay").hidden = true;
  context.signOutSupabaseSession = async () => verifiedReturnedError;
  const returnedErrorLogout = await context.triggerLogout();
  assert.equal(returnedErrorLogout.ok, false);
  assert.equal(vm.runInContext("state.currentUserId", context), "user-active", "Une erreur retournée doit préserver l'identité courante");
  assert.equal(context.__nimrValidatedAuthUserId, "auth-active", "Le marqueur cloud doit être préservé en cas d'échec");
  assert.equal(sessionStore.api.getItem("nimr-user-pin-unlocked"), "user-active", "Le jeton PIN ne doit pas être supprimé en cas d'échec");
  assert.equal(getEl("first-access-overlay").hidden, true, "Une erreur retournée ne doit pas afficher un faux écran de reconnexion");

  context.signOutSupabaseSession = async () => { throw new Error("network thrown"); };
  const thrownLogout = await context.triggerLogout();
  assert.equal(thrownLogout.ok, false);
  assert.equal(vm.runInContext("state.currentUserId", context), "user-active", "Une exception doit préserver l'identité courante");
  assert.equal(context.__nimrValidatedAuthUserId, "auth-active");
  assert.equal(sessionStore.api.getItem("nimr-user-pin-unlocked"), "user-active");
  assert.equal(getEl("first-access-overlay").hidden, true, "Une exception ne doit pas afficher un faux écran de reconnexion");
  assert.equal(logoutErrors.length, 2, "Chaque échec de déconnexion doit être signalé explicitement");

  const identityHarness = createAppHarness({ online: true });
  vm.runInContext(`
    state.users = [
      {
        id: "cloud-tech", name: "Cloud Tech", email: "tech@nimr.test", role: "technicien", active: true,
        authUserId: "auth-tech", authSource: "supabase_membership",
        membershipValidatedAt: "2026-08-29T08:00:00.000Z",
        membershipWorkshopId: "00000000-0000-0000-0000-000000000001"
      },
      {
        id: "cached-director", name: "Cached Director", email: "director@nimr.test", role: "directeur", active: true,
        authUserId: "auth-director", authSource: "supabase_membership",
        membershipValidatedAt: "2026-08-29T08:00:00.000Z",
        membershipWorkshopId: "00000000-0000-0000-0000-000000000001"
      }
    ];
    state.currentUserId = "cloud-tech";
  `, identityHarness.context);
  const select = identityHarness.getElement("user-login-select");
  identityHarness.context.renderUserLoginScreen();
  assert.match(select.innerHTML, /Cloud Tech/u);
  assert.doesNotMatch(select.innerHTML, /Cached Director/u, "Une identité cachée distincte ne doit pas être sélectionnable");
  assert.equal(select.disabled, true);

  const loginForm = identityHarness.getElement("user-login-form");
  loginForm.elements = { userId: { value: "cached-director" }, pin: { value: "" } };
  identityHarness.getElement("first-access-form").elements = {};
  identityHarness.getElement("user-pin-change-form").elements = {};
  identityHarness.context.bindUserSessionActions();
  const submissions = loginForm.listeners.get("submit") || [];
  await Promise.all(submissions.map((listener) => listener({ preventDefault() {} })));
  assert.equal(vm.runInContext("state.currentUserId", identityHarness.context), "cloud-tech");
  assert.match(identityHarness.getElement("user-login-status").textContent, /ne correspond pas à la session authentifiée/u);
});

// Check I — OFFLINE SECURITY
await checkAsync("I Offline policy blocks fresh devices and allows validated cached identities", async () => {
  const mockStore = new Map();
  const elements = {};
  const getEl = (id) => {
    const cleanId = id.replace(/[.#]/g, "");
    if (!elements[cleanId]) {
      elements[cleanId] = {
        id: cleanId,
        hidden: true,
        textContent: "",
        setAttribute: () => {},
        removeAttribute: () => {},
        addEventListener: () => {},
        classList: { add: () => {}, remove: () => {}, contains: () => false },
        dataset: {},
        closest: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        focus: () => {},
      };
    }
    return elements[cleanId];
  };

  const context = {
    window: {},
    console,
    navigator: { onLine: false },
    document: {
      getElementById: (id) => getEl(id),
      querySelector: (sel) => getEl(sel),
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    localStorage: {
      getItem: (k) => mockStore.get(k) || null,
      setItem: (k, v) => mockStore.set(k, String(v)),
      removeItem: (k) => mockStore.delete(k),
    },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    getSupabaseWorkshopId: () => "00000000-0000-0000-0000-000000000001",
    ensureCurrentTabAllowed: () => {},
    render: () => {},
    isLocalSessionUnlocked: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(utilsSource, context);
  vm.runInContext(stateSource, context);
  const cleanApp = appSource.replace("initApp();", "/* initApp(); */");
  vm.runInContext(cleanApp, context);

  // 1. Fresh device offline -> blocked
  vm.runInContext("state.users = []; state.currentUserId = '';", context);
  await context.checkUserSessionStartup();
  assert.equal(getEl("first-access-overlay").hidden, false);
  assert.match(getEl("first-access-status").textContent, /Première connexion internet requise/u);

  // 2. Previously validated cached identity -> allowed
  const now = new Date().toISOString();
  vm.runInContext(`
    state.users = [
      {
        id: "u-cached",
        name: "Cached Tech",
        role: "technicien",
        active: true,
        authUserId: "auth-cached",
        authSource: "supabase_membership",
        membershipValidatedAt: "${now}",
        membershipWorkshopId: "00000000-0000-0000-0000-000000000001",
      }
    ];
    state.currentUserId = "u-cached";
  `, context);
  getEl("first-access-overlay").hidden = true;
  await context.checkUserSessionStartup();
  assert.equal(getEl("first-access-overlay").hidden, true, "Utilisateur validé continue hors ligne");

  const twoIdentityHarness = createAppHarness({ online: false });
  vm.runInContext(`
    state.users = [
      {
        id: "offline-tech", name: "Offline Tech", role: "technicien", active: true,
        authUserId: "auth-offline-tech", authSource: "supabase_membership",
        membershipValidatedAt: "${now}", membershipWorkshopId: "00000000-0000-0000-0000-000000000001"
      },
      {
        id: "offline-director", name: "Offline Director", role: "directeur", active: true,
        authUserId: "auth-offline-director", authSource: "supabase_membership",
        membershipValidatedAt: "${now}", membershipWorkshopId: "00000000-0000-0000-0000-000000000001",
        pinHash: "mockhash:739251:salt-director", pinSalt: "salt-director"
      }
    ];
    state.currentUserId = "offline-tech";
  `, twoIdentityHarness.context);
  const offlineResult = await twoIdentityHarness.context.checkUserSessionStartup();
  assert.equal(offlineResult.code, "OFFLINE_CURRENT_IDENTITY");
  assert.equal(twoIdentityHarness.renderCount, 1);

  const offlineSelect = twoIdentityHarness.getElement("user-login-select");
  twoIdentityHarness.context.renderUserLoginScreen();
  assert.match(offlineSelect.innerHTML, /Offline Tech/u);
  assert.doesNotMatch(offlineSelect.innerHTML, /Offline Director/u, "Le sélecteur hors ligne ne doit jamais exposer une autre identité");
  assert.equal(offlineSelect.disabled, true);

  const offlineLoginForm = twoIdentityHarness.getElement("user-login-form");
  offlineLoginForm.elements = { userId: { value: "offline-director" }, pin: { value: "739251", focus() {} } };
  twoIdentityHarness.getElement("first-access-form").elements = {};
  twoIdentityHarness.getElement("user-pin-change-form").elements = {};
  twoIdentityHarness.context.bindUserSessionActions();
  const offlineSubmissions = offlineLoginForm.listeners.get("submit") || [];
  await Promise.all(offlineSubmissions.map((listener) => listener({ preventDefault() {} })));
  assert.equal(vm.runInContext("state.currentUserId", twoIdentityHarness.context), "offline-tech");
  assert.match(twoIdentityHarness.getElement("user-login-status").textContent, /ne correspond pas à la session authentifiée/u);
});

// Check J — SAFETY
check("J Schema contracts, database RLS and scope integrity remain untouched", () => {
  assert.match(schemaSource, /alter table public\.workshop_members enable row level security/i);
  assert.match(schemaSource, /alter table public\.cloud_backups enable row level security/i);
  assert.match(schemaSource, /public\.is_workshop_member\(workshop_id\)/u);
  assert.doesNotMatch(appSource, /eval\(/u);
});

console.log(`\nALL ${results.length} SEC-001 CHECKS PASSED`);
