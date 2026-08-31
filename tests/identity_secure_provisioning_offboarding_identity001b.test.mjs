import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BASE_SHA = "a96f62caf7185931da2f6e589c5b87c2c66321ca";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browserSmokeRequested = process.argv.includes("--browser-smoke");
const readProjectFile = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const readBaseFile = (relativePath) => execFileSync("git", ["show", `${BASE_SHA}:${relativePath}`], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 40 * 1024 * 1024,
});
const normalizeEol = (value) => String(value || "").replace(/\r\n/gu, "\n");
const sourceSlice = (source, start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `source slice missing: ${start} -> ${end}`);
  return source.slice(startIndex, endIndex);
};

const edgeSource = readProjectFile("supabase/functions/workshop-user-admin/index.ts");
const clientSource = readProjectFile("js/supabase-client.js");
const uiSource = readProjectFile("js/ui-planning.js");
const appSource = readProjectFile("app.js");
const indexSource = readProjectFile("index.html");
const stateSource = readProjectFile("js/state.js");

function loadEdgeFactory() {
  const require = createRequire(import.meta.url);
  const typescript = require(path.join(repoRoot, "apps/nimr-sav-react/node_modules/typescript"));
  const testableSource = edgeSource.replace(
    /^import \{ createClient \} from "npm:@supabase\/supabase-js@2\.111\.0";$/mu,
    "const createClient = globalThis.__edgeCreateClient;",
  );
  const compiled = typescript.transpileModule(testableSource, {
    compilerOptions: {
      target: typescript.ScriptTarget.ES2022,
      module: typescript.ModuleKind.CommonJS,
      strict: true,
    },
    reportDiagnostics: true,
  });
  const syntaxErrors = (compiled.diagnostics || []).filter((diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error);
  assert.deepEqual(syntaxErrors, [], "Edge Function TypeScript must transpile without syntax errors");
  const context = vm.createContext({
    module: { exports: {} },
    exports: {},
    require,
    Request,
    Response,
    Headers,
    URL,
    console,
    setTimeout,
    clearTimeout,
    __edgeCreateClient: () => { throw new Error("default client must not be used by tests"); },
  });
  context.globalThis = context;
  context.exports = context.module.exports;
  vm.runInContext(compiled.outputText, context, { filename: "workshop-user-admin.compiled.cjs" });
  return context.module.exports.createWorkshopUserAdminHandler;
}

const createWorkshopUserAdminHandler = loadEdgeFactory();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createEdgeFixture(overrides = {}) {
  const fixture = {
    caller: { id: "auth-admin", email: "admin@example.test" },
    memberships: [
      { workshop_id: "workshop-a", user_id: "auth-admin", role: "admin_technique", resource_id: null, deleted_at: null },
      { workshop_id: "workshop-a", user_id: "auth-admin-2", role: "admin_technique", resource_id: null, deleted_at: null },
    ],
    resources: [
      { id: "resource-human", workshop_id: "workshop-a", local_id: "local-human", name: "Technicien humain", type: "tolier", active: true, deleted_at: null },
      { id: "resource-equipment", workshop_id: "workshop-a", local_id: "local-booth", name: "Cabine", type: "cabine", active: true, deleted_at: null },
      { id: "resource-inactive", workshop_id: "workshop-a", local_id: "local-inactive", name: "Peintre inactif", type: "peintre", active: false, deleted_at: null },
    ],
    events: [],
    inviteError: null,
    membershipInsertError: null,
    authDeleteError: null,
    nextInvitedUserId: "auth-invited",
    ...overrides,
  };
  fixture.memberships = clone(overrides.memberships || fixture.memberships);
  fixture.resources = clone(overrides.resources || fixture.resources);

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.operation = "read";
      this.operationValue = null;
      this.maxRows = null;
    }
    select() { return this; }
    eq(field, value) { this.filters.push((row) => String(row?.[field] ?? "") === String(value ?? "")); return this; }
    is(field, value) { this.filters.push((row) => (value === null ? row?.[field] == null : row?.[field] === value)); return this; }
    order() { return this; }
    limit(value) { this.maxRows = Number(value); return this; }
    insert(value) { this.operation = "insert"; this.operationValue = value; return this; }
    update(value) { this.operation = "update"; this.operationValue = value; return this; }
    maybeSingle() { return this.execute(true); }
    single() { return this.execute(true); }
    then(resolve, reject) { return this.execute(false).then(resolve, reject); }
    async execute(single) {
      const store = this.table === "workshop_members" ? fixture.memberships : fixture.resources;
      if (this.operation === "insert") {
        if (fixture.membershipInsertError) return { data: null, error: fixture.membershipInsertError };
        const inserted = { ...clone(this.operationValue), created_at: "2026-08-31T12:00:00.000Z" };
        fixture.memberships.push(inserted);
        fixture.events.push("membership_insert");
        return { data: inserted, error: null };
      }
      let rows = store.filter((row) => this.filters.every((filter) => filter(row)));
      if (this.operation === "update") {
        rows.forEach((row) => Object.assign(row, clone(this.operationValue)));
        if (rows.length) fixture.events.push("membership_revoke");
      }
      if (this.maxRows != null) rows = rows.slice(0, this.maxRows);
      const data = single ? (rows[0] || null) : clone(rows);
      return { data, error: null };
    }
  }

  const adminClient = {
    from(table) { return new Query(table); },
    auth: {
      admin: {
        async inviteUserByEmail(email, options) {
          fixture.events.push("auth_invite");
          fixture.lastInvite = { email, options: clone(options) };
          if (fixture.inviteError) return { data: null, error: fixture.inviteError };
          return { data: { user: { id: fixture.nextInvitedUserId, email } }, error: null };
        },
        async deleteUser(userId, shouldSoftDelete = false) {
          fixture.events.push("auth_delete");
          fixture.deletedAuthUserId = userId;
          fixture.lastAuthDeleteSoft = shouldSoftDelete === true;
          return { data: null, error: fixture.authDeleteError };
        },
      },
    },
  };
  const userClient = {
    auth: {
      async getUser(jwt) {
        fixture.receivedJwt = jwt;
        return { data: { user: fixture.caller }, error: fixture.authError || null };
      },
    },
  };
  fixture.clientFactory = (_url, key) => key === "publishable-test" ? userClient : adminClient;
  fixture.environment = {
    get(name) {
      return {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "publishable-test" }),
        SUPABASE_SECRET_KEYS: JSON.stringify({ default: "secret-test" }),
      }[name];
    },
  };
  return fixture;
}

async function invokeEdge(payload, overrides = {}, options = {}) {
  const fixture = createEdgeFixture(overrides);
  const handler = createWorkshopUserAdminHandler({ environment: fixture.environment, clientFactory: fixture.clientFactory });
  const headers = { "Content-Type": "application/json" };
  if (options.auth !== false) headers.Authorization = "Bearer verified-user-jwt";
  const result = await handler(new Request("https://example.supabase.co/functions/v1/workshop-user-admin", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  }));
  return { fixture, status: result.status, body: await result.json() };
}

const passed = [];
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

await check("A Edge Function requires an authenticated user JWT and has no anonymous mutation model", async () => {
  assert.match(edgeSource, /@supabase\/supabase-js@2\.111\.0/u);
  assert.match(edgeSource, /request\.headers\.get\("Authorization"\)/u);
  assert.match(edgeSource, /userClient\.auth\.getUser\(jwt\)/u);
  assert.doesNotMatch(edgeSource, /verify_jwt\s*=\s*false/iu);
  const result = await invokeEdge({ action: "capabilities", workshop_id: "workshop-a" }, {}, { auth: false });
  assert.equal(result.status, 401);
  assert.equal(result.body.code, "UNAUTHENTICATED");
  assert.match(readProjectFile("js/version.js"), /^window\.APP_VERSION = "v23\.3\.20";$/mu);
});

await check("B Browser code contains no Auth Admin API, secret key or privileged client", () => {
  const browserFiles = ["index.html", "app.js", "js/supabase-client.js", "js/ui-planning.js", "js/state.js", "js/supabase-config.js"];
  const browserSource = browserFiles.map(readProjectFile).join("\n");
  assert.doesNotMatch(browserSource, /\.auth\.admin\b|auth\.admin\b|SUPABASE_SECRET_KEYS|SUPABASE_SECRET_KEY/iu);
  const browserDiff = execFileSync("git", ["diff", "--unified=0", BASE_SHA, "--", ...browserFiles], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 40 * 1024 * 1024,
  });
  const browserAdditions = browserDiff.split(/\r?\n/u).filter((line) => line.startsWith("+") && !line.startsWith("+++")).join("\n");
  assert.doesNotMatch(browserAdditions, /sb_secret_|service[_-]?role|\.auth\.admin\b|auth\.admin\b|SUPABASE_SECRET_KEYS|SUPABASE_SECRET_KEY/iu);
  assert.match(clientSource, /client\.functions\.invoke\("workshop-user-admin"/u);
  assert.match(edgeSource, /SUPABASE_SECRET_KEYS/u);
  assert.doesNotMatch(edgeSource, /sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{20,}/u);
});

await check("C Caller membership is resolved server-side and requires admin_technique or directeur", async () => {
  assert.match(edgeSource, /\.from\("workshop_members"\)[\s\S]*?\.eq\("user_id", callerId\)[\s\S]*?\.is\("deleted_at", null\)/u);
  assert.match(edgeSource, /WORKSHOP_ADMIN_ROLES = new Set\(\["admin_technique", "directeur"\]\)/u);
  const result = await invokeEdge(
    { action: "capabilities", workshop_id: "workshop-a" },
    { memberships: [{ workshop_id: "workshop-a", user_id: "auth-admin", role: "technicien", resource_id: "resource-human", deleted_at: null }] },
  );
  assert.equal(result.status, 403);
  assert.equal(result.body.code, "FORBIDDEN_WORKSHOP_ADMIN");
});

await check("D Cross-workshop operations are rejected", async () => {
  const result = await invokeEdge({ action: "capabilities", workshop_id: "workshop-b" });
  assert.equal(result.status, 403);
  assert.equal(result.body.code, "WORKSHOP_SCOPE_MISMATCH");
});

await check("E Canonical target role whitelist is exact and enforced", async () => {
  for (const role of ["admin_technique", "directeur", "chef_atelier", "reception", "technicien", "controle_qualite", "lecture_seule"]) {
    assert.match(edgeSource, new RegExp(`"${role}"`, "u"));
  }
  const result = await invokeEdge({ action: "invite_member", workshop_id: "workshop-a", email: "user@example.test", name: "User", role: "admin" });
  assert.equal(result.body.code, "INVALID_WORKSHOP_ROLE");
  assert.deepEqual(result.fixture.events, []);
  const invalidName = await invokeEdge({ action: "invite_member", workshop_id: "workshop-a", email: "user@example.test", name: "\u0007", role: "reception" });
  assert.equal(invalidName.body.code, "INVALID_MEMBER_NAME");
  assert.deepEqual(invalidName.fixture.events, []);
});

await check("F Technicien requires a valid active HUMAN planning resource", async () => {
  const missing = await invokeEdge({ action: "invite_member", workshop_id: "workshop-a", email: "tech@example.test", name: "Tech", role: "technicien", resource_id: "" });
  assert.equal(missing.body.code, "TECHNICIAN_RESOURCE_REQUIRED");
  const inactive = await invokeEdge({ action: "invite_member", workshop_id: "workshop-a", email: "tech@example.test", name: "Tech", role: "technicien", resource_id: "resource-inactive" });
  assert.equal(inactive.body.code, "RESOURCE_INACTIVE");
  const valid = await invokeEdge({ action: "invite_member", workshop_id: "workshop-a", email: "tech@example.test", name: " Tech Human ", role: "technicien", resource_id: "resource-human" });
  assert.equal(valid.body.ok, true);
  assert.equal(valid.fixture.memberships.at(-1).resource_id, "resource-human");
});

await check("G Equipment resources are rejected as technician identities", async () => {
  const result = await invokeEdge({ action: "invite_member", workshop_id: "workshop-a", email: "tech@example.test", name: "Tech", role: "technicien", resource_id: "resource-equipment" });
  assert.equal(result.body.code, "RESOURCE_NOT_HUMAN");
  assert.deepEqual(result.fixture.events, []);
});

await check("H Duplicate active resource/account linkage is rejected", async () => {
  const result = await invokeEdge(
    { action: "invite_member", workshop_id: "workshop-a", email: "tech2@example.test", name: "Tech 2", role: "technicien", resource_id: "resource-human" },
    { memberships: [
      { workshop_id: "workshop-a", user_id: "auth-admin", role: "admin_technique", resource_id: null, deleted_at: null },
      { workshop_id: "workshop-a", user_id: "auth-existing-tech", role: "technicien", resource_id: "resource-human", deleted_at: null },
    ] },
  );
  assert.equal(result.body.code, "RESOURCE_ALREADY_LINKED");
  assert.deepEqual(result.fixture.events, []);
});

await check("I Invite uses Auth Admin only server-side and inserts server-validated membership values", async () => {
  const result = await invokeEdge({ action: "invite_member", workshop_id: "workshop-a", email: " NEW@EXAMPLE.TEST ", name: " New Member ", role: "reception", resource_id: "resource-human" });
  assert.equal(result.status, 201);
  assert.equal(result.body.ok, true);
  assert.deepEqual(result.fixture.events, ["auth_invite", "membership_insert"]);
  assert.equal(result.fixture.lastInvite.email, "new@example.test");
  assert.deepEqual(result.fixture.lastInvite.options.data, { display_name: "New Member" });
  const member = result.fixture.memberships.at(-1);
  assert.deepEqual(
    { workshop_id: member.workshop_id, role: member.role, resource_id: member.resource_id, created_by: member.created_by, deleted_at: member.deleted_at, sync_source: member.sync_source },
    { workshop_id: "workshop-a", role: "reception", resource_id: null, created_by: "auth-admin", deleted_at: null, sync_source: "identity_provisioning" },
  );
});

await check("J Invite compensates a failed membership creation without silent orphaning", async () => {
  const result = await invokeEdge(
    { action: "invite_member", workshop_id: "workshop-a", email: "new@example.test", name: "New Member", role: "reception" },
    { membershipInsertError: { message: "insert failed" } },
  );
  assert.equal(result.body.code, "MEMBERSHIP_CREATE_FAILED");
  assert.equal(result.body.compensation_succeeded, true);
  assert.deepEqual(result.fixture.events, ["auth_invite", "auth_delete"]);
  assert.equal(result.fixture.deletedAuthUserId, "auth-invited");
  assert.equal(result.fixture.lastAuthDeleteSoft, false, "A newly-created orphan invite may be compensated by hard deletion");
});

await check("K Server invite UI invokes only the Edge Function and never local user authority functions", () => {
  const inviteHandler = sourceSlice(appSource, 'inviteForm?.addEventListener("submit"', '$("#current-user-selector")');
  assert.match(inviteHandler, /invokeWorkshopUserAdmin\("invite_member", request\)/u);
  assert.doesNotMatch(inviteHandler, /createUserLocal\s*\(|updateUserLocal\s*\(/u);
  assert.match(indexSource, /<dialog[^>]+id="invite-workshop-member-dialog"/u);
  assert.match(uiSource, /WORKSHOP_USER_ADMIN_HUMAN_TYPES/u);
  assert.doesNotMatch(uiSource, /humanResources[\s\S]{0,400}cabine|pont_mecanique|zone_preparation/u);
});

await check("L Offboarding soft-revokes history before Auth cleanup and preserves revocation on cleanup failure", async () => {
  const memberships = [
    { workshop_id: "workshop-a", user_id: "auth-admin", role: "admin_technique", resource_id: null, deleted_at: null },
    { workshop_id: "workshop-a", user_id: "auth-admin-2", role: "admin_technique", resource_id: null, deleted_at: null },
    { workshop_id: "workshop-a", user_id: "auth-target", role: "reception", resource_id: null, deleted_at: null },
  ];
  const success = await invokeEdge({ action: "offboard_member", workshop_id: "workshop-a", user_id: "auth-target" }, { memberships });
  assert.equal(success.body.ok, true);
  assert.deepEqual(success.fixture.events, ["membership_revoke", "auth_delete"]);
  assert.ok(success.fixture.memberships.find((member) => member.user_id === "auth-target")?.deleted_at);
  assert.equal(success.fixture.lastAuthDeleteSoft, true, "Offboarding must preserve membership history through a soft Auth deletion");
  const partial = await invokeEdge(
    { action: "offboard_member", workshop_id: "workshop-a", user_id: "auth-target" },
    { memberships, authDeleteError: { message: "cleanup unavailable" } },
  );
  assert.equal(partial.body.ok, true);
  assert.equal(partial.body.code, "AUTH_CLEANUP_PENDING");
  assert.equal(partial.body.membership_revoked, true);
  assert.equal(partial.body.auth_cleanup, false);
  assert.ok(partial.fixture.memberships.find((member) => member.user_id === "auth-target")?.deleted_at);
  assert.equal(partial.fixture.lastAuthDeleteSoft, true);
});

await check("M Self-offboarding and last-admin offboarding are rejected server-side", async () => {
  assert.match(edgeSource, /active_admin_technique_count:\s*activeAdminTechnicalCount/u);
  assert.match(uiSource, /isLastActiveTechnicalAdmin[\s\S]*?activeAdminTechnicalCount\s*<=\s*1/u);
  assert.match(uiSource, /Le dernier administrateur technique actif ne peut pas être retiré\./u);
  const self = await invokeEdge({ action: "offboard_member", workshop_id: "workshop-a", user_id: "auth-admin" });
  assert.equal(self.body.code, "SELF_OFFBOARD_FORBIDDEN");
  assert.deepEqual(self.fixture.events, []);
  const lastAdmin = await invokeEdge(
    { action: "offboard_member", workshop_id: "workshop-a", user_id: "auth-last-admin" },
    { memberships: [
      { workshop_id: "workshop-a", user_id: "auth-director", role: "directeur", resource_id: null, deleted_at: null },
      { workshop_id: "workshop-a", user_id: "auth-last-admin", role: "admin_technique", resource_id: null, deleted_at: null },
    ], caller: { id: "auth-director", email: "director@example.test" } },
  );
  assert.equal(lastAdmin.body.code, "LAST_ADMIN_FORBIDDEN");
  assert.deepEqual(lastAdmin.fixture.events, []);
});

await check("N Offline/local compatibility and IDENTITY-001A server-mirror guard remain intact", () => {
  const baseState = readBaseFile("js/state.js");
  for (const [start, end] of [
    ["function isServerManagedLocalProfile", "function hasValidatedOnlineServerAuthority"],
    ["function hasValidatedOnlineServerAuthority", "function isAccountAccessHumanResource"],
    ["function updateUserLocal", "function resolvePermissionUser"],
  ]) {
    assert.equal(normalizeEol(sourceSlice(stateSource, start, end)), normalizeEol(sourceSlice(baseState, start, end)), start);
  }
  assert.match(clientSource, /code: "OFFLINE_NOT_ALLOWED"[\s\S]*opération de sécurité ne sera pas mise en attente/u);
  assert.match(uiSource, /Hors ligne : invitations et retraits d’accès serveur indisponibles/u);
  assert.match(uiSource, /serverManagedReadOnly = onlineAuthority && serverManagedProfile/u);
  for (const block of ["const CANONICAL_USER_ROLES", "const DIRECTOR_PERMISSIONS", "const ROLE_PERMISSIONS", "const ROLE_TABS", "const ROLE_DEFAULT_TABS"]) {
    const nextBlock = block === "const ROLE_DEFAULT_TABS" ? "const USER_ROLE_ALIASES" : "const ";
    const currentStart = stateSource.indexOf(block);
    const baseStart = baseState.indexOf(block);
    assert.ok(currentStart >= 0 && baseStart >= 0, block);
    const currentEnd = stateSource.indexOf(nextBlock, currentStart + block.length);
    const baseEnd = baseState.indexOf(nextBlock, baseStart + block.length);
    assert.equal(normalizeEol(stateSource.slice(currentStart, currentEnd)), normalizeEol(baseState.slice(baseStart, baseEnd)), block);
  }
});

assert.equal(passed.length + failures.length, 14, "IDENTITY-001B must contain exactly checks A-N");

if (failures.length) {
  console.error(`\nIDENTITY-001B REGRESSION SUITE: ${passed.length}/14 CHECKS PASSED (${failures.length} FAILED)`);
  failures.forEach(({ name, error }) => console.error(`\n${name}\n${error.stack || error.message}`));
  process.exitCode = 1;
} else {
  console.log("\nIDENTITY-001B REGRESSION SUITE: 14/14 CHECKS PASSED");
}

async function runBrowserSmoke() {
  const { withBrowserPage } = await import("./helpers/cdp_browser_harness.mjs");
  const viewports = [
    { width: 375, height: 812 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ];
  return withBrowserPage(repoRoot, async ({ send, sessionId, findings, evaluate, waitFor }) => {
    await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false }, sessionId);
    const boot = await evaluate(`
      (async () => {
        const waitUntil = async (predicate, message) => {
          for (let attempt = 0; attempt < 120; attempt += 1) {
            if (predicate()) return;
            await new Promise((resolveWait) => setTimeout(resolveWait, 100));
          }
          throw new Error(message);
        };
        await waitUntil(() => typeof state !== "undefined" && Array.isArray(state.users), "state unavailable");
        window.__identity001bServerRole = "admin_technique";
        window.__identity001bActiveAdminCount = 2;
        window.__identity001bCalls = [];
        window.invokeWorkshopUserAdmin = async (action, payload = {}) => {
          window.__identity001bCalls.push({ action, payload: JSON.parse(JSON.stringify(payload || {})) });
          if (navigator.onLine === false) throw new Error("offline server call forbidden");
          if (action === "capabilities") {
            if (!["admin_technique", "directeur"].includes(window.__identity001bServerRole)) {
              return { ok: false, code: "FORBIDDEN_WORKSHOP_ADMIN", message: "Administration non autorisée." };
            }
            return {
              ok: true, can_manage_accounts: true, provisioning_available: true,
              caller_role: window.__identity001bServerRole,
              workshop_id: "00000000-0000-0000-0000-000000000001",
              active_admin_technique_count: window.__identity001bActiveAdminCount,
              human_resources: [
                { id: "server-human-uuid", local_id: "local-human", name: "Technicien humain", type: "tolier" },
              ]
            };
          }
          if (action === "invite_member") return { ok: true, action, member: { user_id: "mock-invited", role: payload.role, resource_id: payload.resource_id || null } };
          if (action === "offboard_member") return { ok: true, action, membership_revoked: true, auth_cleanup: true };
          return { ok: false, code: "INVALID_ACTION" };
        };
        const form = document.getElementById("first-access-form");
        const overlay = document.getElementById("first-access-overlay");
        const authUser = { id: "identity001b-auth", email: "admin.identity001b@example.test", user_metadata: { name: "Admin Identity001B" } };
        const membership = { workshop_id: "00000000-0000-0000-0000-000000000001", user_id: authUser.id, role: "admin_technique", resource_id: null };
        window.getSupabaseUser = async () => authUser;
        window.resolveSupabaseWorkshopMembership = async () => ({ ok: true, membership: { ...membership, role: window.__identity001bServerRole } });
        if (form && overlay?.hidden === false) {
          window.authenticateSupabaseUser = async () => ({ ok: true, user: authUser, membership });
          window.pullLatestSupabaseBackup = async () => ({ ok: true });
          window.startSupabaseLiveSync = async () => true;
          window.signOutSupabaseSession = async () => ({ ok: true });
          form.elements.email.value = authUser.email;
          form.elements.password.value = "Pass123456";
          form.requestSubmit();
          await waitUntil(() => state.currentUserId && document.getElementById("first-access-overlay")?.hidden !== false, "fixture login failed");
        }
        window.__setIdentity001bFixture = async ({ serverRole = "admin_technique", online = true, activeAdminCount = 2, otherServerRole = "reception" }) => {
          Object.defineProperty(window.navigator, "onLine", { configurable: true, value: online });
          window.__identity001bServerRole = serverRole;
          window.__identity001bActiveAdminCount = activeAdminCount;
          const authId = "identity001b-auth";
          const resources = [normalizeResource({ id: "local-human", name: "Technicien humain", role: "tolier", active: true })];
          state.resources.splice(0, state.resources.length, ...resources);
          const current = normalizeUser({
            id: "identity001b-current", authUserId: authId, authSource: "supabase_membership",
            membershipValidatedAt: "2026-08-31T12:00:00.000Z", membershipWorkshopId: "00000000-0000-0000-0000-000000000001",
            name: "Compte serveur courant", email: "admin.identity001b@example.test", role: serverRole,
            resourceId: serverRole === "technicien" ? "local-human" : "", active: true
          }, resources);
          const otherServer = normalizeUser({
            id: "identity001b-other-server", authUserId: "identity001b-other-auth", authSource: "supabase_membership",
            membershipValidatedAt: "2026-08-31T12:00:00.000Z", membershipWorkshopId: "00000000-0000-0000-0000-000000000001",
            name: "Autre compte serveur", email: "other@example.test", role: otherServerRole, active: true
          }, resources);
          const local = normalizeUser({ id: "identity001b-local", name: "Profil purement local", email: "local@example.test", role: "reception", active: true }, resources);
          state.users.splice(0, state.users.length, current, otherServer, local);
          state.currentUserId = current.id;
          if (online) {
            window.__nimrValidatedAuthUserId = authId;
            setAccountAccessRuntimeContext(
              { id: authId, email: "admin.identity001b@example.test" },
              { workshop_id: "00000000-0000-0000-0000-000000000001", user_id: authId, role: serverRole, resource_id: serverRole === "technicien" ? "local-human" : null }
            );
          } else {
            window.__nimrValidatedAuthUserId = "";
            clearAccountAccessRuntimeContext();
          }
          await refreshWorkshopUserAdminCapabilities({ force: true });
          setActiveTab("atelier");
          setSettingsWorkspace("administration");
          render();
          renderUsersAndRoles();
          return getAccountAccessSnapshot();
        };
        await window.__setIdentity001bFixture({ serverRole: "admin_technique", online: true });
        return { tab: activeTab, workspace: activeSettingsWorkspace };
      })()
    `);
    assert.deepEqual(boot, { tab: "atelier", workspace: "administration" });
    await waitFor(`document.getElementById("account-access-foundation")?.offsetParent !== null`);

    const adminUi = await evaluate(`(() => {
      const currentEdit = document.querySelector('[data-edit-user="identity001b-current"]');
      const currentToggle = document.querySelector('[data-toggle-user-status="identity001b-current"]');
      const currentOffboard = document.querySelector('[data-offboard-user="identity001b-current"]');
      const otherOffboard = document.querySelector('[data-offboard-user="identity001b-other-server"]');
      const localEdit = document.querySelector('[data-edit-user="identity001b-local"]');
      return {
        inviteDisabled: document.getElementById("invite-workshop-member-btn")?.disabled,
        editDisabled: currentEdit?.disabled,
        toggleDisabled: currentToggle?.disabled,
        currentOffboardDisabled: currentOffboard?.disabled,
        otherOffboardEnabled: otherOffboard?.disabled === false,
        localEditEnabled: localEdit?.disabled === false,
        selectorDisabled: document.getElementById("current-user-selector")?.disabled,
        managedBadge: currentEdit?.closest(".user-card")?.textContent.includes("Géré par Supabase"),
      };
    })()`);
    assert.deepEqual(adminUi, {
      inviteDisabled: false,
      editDisabled: true,
      toggleDisabled: true,
      currentOffboardDisabled: true,
      otherOffboardEnabled: true,
      localEditEnabled: true,
      selectorDisabled: true,
      managedBadge: true,
    });

    await evaluate(`document.getElementById("invite-workshop-member-btn").click(); true`);
    assert.equal(await evaluate(`document.getElementById("invite-workshop-member-dialog")?.open`), true);
    const dialogAccess = await evaluate(`(() => {
      const role = document.getElementById("invite-workshop-member-role");
      role.value = "technicien";
      role.dispatchEvent(new Event("change", { bubbles: true }));
      const resource = document.getElementById("invite-workshop-member-resource");
      return {
        labelled: document.getElementById("invite-workshop-member-dialog")?.getAttribute("aria-labelledby"),
        resourceRequired: resource.required,
        resourceHidden: document.getElementById("invite-workshop-member-resource-field").hidden,
        resourceOptions: [...resource.options].map((option) => option.textContent.trim()),
      };
    })()`);
    assert.equal(dialogAccess.labelled, "invite-workshop-member-title");
    assert.equal(dialogAccess.resourceRequired, true);
    assert.equal(dialogAccess.resourceHidden, false);
    assert.ok(dialogAccess.resourceOptions.some((label) => /Technicien humain/u.test(label)));
    assert.equal(dialogAccess.resourceOptions.some((label) => /Cabine|pont|zone/iu.test(label)), false);

    const beforeInvite = await evaluate(`JSON.stringify(state.users.map((user) => ({ id: user.id, role: getCanonicalUserRole(user), email: user.email })))`);
    await evaluate(`(() => {
      document.getElementById("invite-workshop-member-name").value = "Nouvelle technicienne";
      document.getElementById("invite-workshop-member-email").value = "new.tech@example.test";
      document.getElementById("invite-workshop-member-resource").value = "server-human-uuid";
      document.getElementById("invite-workshop-member-form").requestSubmit();
      return true;
    })()`);
    await waitFor(`window.__identity001bCalls.some((call) => call.action === "invite_member")`);
    await waitFor(`document.getElementById("invite-workshop-member-dialog")?.open === false`);
    const afterInvite = await evaluate(`JSON.stringify(state.users.map((user) => ({ id: user.id, role: getCanonicalUserRole(user), email: user.email })))`);
    assert.equal(afterInvite, beforeInvite);
    const inviteCall = await evaluate(`window.__identity001bCalls.find((call) => call.action === "invite_member")`);
    assert.deepEqual(inviteCall.payload, { name: "Nouvelle technicienne", email: "new.tech@example.test", role: "technicien", resource_id: "server-human-uuid" });
    assert.equal(await evaluate(`document.getElementById("account-auth-identity")?.textContent.trim()`), "admin.identity001b@example.test");

    const director = await evaluate(`window.__setIdentity001bFixture({ serverRole: "directeur", online: true, activeAdminCount: 1, otherServerRole: "admin_technique" }).then(() => ({
      inviteDisabled: document.getElementById("invite-workshop-member-btn").disabled,
      lastAdminDisabled: document.querySelector('[data-offboard-user="identity001b-other-server"]')?.disabled,
      lastAdminTitle: document.querySelector('[data-offboard-user="identity001b-other-server"]')?.title
    }))`);
    assert.equal(director.inviteDisabled, false);
    assert.equal(director.lastAdminDisabled, true);
    assert.match(director.lastAdminTitle, /dernier administrateur technique/iu);

    const technician = await evaluate(`window.__setIdentity001bFixture({ serverRole: "technicien", online: true }).then(() => ({
      inviteDisabled: document.getElementById("invite-workshop-member-btn").disabled,
      offboardCount: document.querySelectorAll("[data-offboard-user]").length,
      localEditDisabled: document.querySelector('[data-edit-user="identity001b-current"]')?.disabled
    }))`);
    assert.deepEqual(technician, { inviteDisabled: true, offboardCount: 0, localEditDisabled: true });

    const callsBeforeOffline = await evaluate(`window.__identity001bCalls.length`);
    const offline = await evaluate(`window.__setIdentity001bFixture({ serverRole: "admin_technique", online: false }).then(() => ({
      inviteDisabled: document.getElementById("invite-workshop-member-btn").disabled,
      offboardCount: document.querySelectorAll("[data-offboard-user]").length,
      localEditDisabled: document.querySelector('[data-edit-user="identity001b-local"]')?.disabled,
      selectorDisabled: document.getElementById("current-user-selector")?.disabled,
      note: document.getElementById("account-provisioning-note")?.textContent
    }))`);
    const callsAfterOffline = await evaluate(`window.__identity001bCalls.length`);
    assert.equal(callsAfterOffline, callsBeforeOffline);
    assert.equal(offline.inviteDisabled, true);
    assert.equal(offline.offboardCount, 0);
    assert.equal(offline.localEditDisabled, false);
    assert.equal(offline.selectorDisabled, false);
    assert.match(offline.note, /Hors ligne/u);

    await evaluate(`window.__setIdentity001bFixture({ serverRole: "admin_technique", online: true })`);
    const focusStyle = await evaluate(`(() => {
      const button = document.getElementById("invite-workshop-member-btn");
      button.focus();
      const style = getComputedStyle(button);
      return { tag: button.tagName, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
    })()`);
    assert.equal(focusStyle.tag, "BUTTON");
    assert.notEqual(focusStyle.outlineStyle, "none");
    assert.ok(Number.parseFloat(focusStyle.outlineWidth) >= 3);

    const viewportResults = [];
    for (const viewport of viewports) {
      await send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width <= 768 }, sessionId);
      await evaluate(`window.dispatchEvent(new Event("resize")); true`);
      const dimensions = await evaluate(`(() => {
        const panel = document.querySelector(".users-roles-panel").getBoundingClientRect();
        return { innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, panelLeft: panel.left, panelRight: panel.right };
      })()`);
      assert.ok(dimensions.documentWidth <= dimensions.innerWidth, `${viewport.width}px document overflow`);
      assert.ok(dimensions.bodyWidth <= dimensions.innerWidth, `${viewport.width}px body overflow`);
      assert.ok(dimensions.panelLeft >= 0 && dimensions.panelRight <= dimensions.innerWidth + 1, `${viewport.width}px panel overflow`);
      viewportResults.push({ ...viewport, overflow: false });
    }
    const errors = findings.filter((finding) => String(finding.text || "").trim());
    const fixtureNoise = errors.filter((finding) => /Failed to load resource: the server responded with a status of 401/iu.test(finding.text));
    const identityErrors = errors.filter((finding) => !fixtureNoise.includes(finding));
    assert.deepEqual(identityErrors, []);
    return {
      adminInvite: "PASS",
      directorInvite: "PASS",
      technicianDenied: "PASS",
      serverManagedLocalGuards: "PASS",
      separateOffboardAction: "PASS",
      currentCallerProtected: "PASS",
      lastAdminProtected: "PASS",
      offlineNoServerCall: "PASS",
      pureLocalCompatibility: "PASS",
      accessibleDialog: "PASS",
      keyboardFocus: "PASS",
      viewportResults,
      consoleErrorsCausedByIdentity001b: 0,
    };
  });
}

if (browserSmokeRequested && failures.length === 0) {
  try {
    const result = await runBrowserSmoke();
    console.log("\nIDENTITY-001B BROWSER/RESPONSIVE SMOKE: PASS");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`\nIDENTITY-001B BROWSER/RESPONSIVE SMOKE: FAIL\n${error.stack || error.message}`);
    process.exitCode = 1;
  }
}
