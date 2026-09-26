import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertReleaseConsumers() {
  const versionSource = readProjectFile("js/version.js");
  const match = versionSource.match(/^window\.APP_VERSION = "(v\d+\.\d+\.\d+)";$/mu);
  assert.ok(match, "Canonical APP_VERSION must be a complete semantic version");
  const version = match[1];
  const numericVersion = version.slice(1);
  const declarations = [
    [versionSource, /^window\.NIMR_BUILD = "([^"]+)";$/mu, version, "NIMR_BUILD"],
    [versionSource, /^window\.NIMR_CACHE_NAME = "([^"]+)";$/mu, "nimr-sav-" + version, "NIMR_CACHE_NAME"],
    [readProjectFile("js/state.js"), /^const APP_VERSION = "([^"]+)";$/mu, version, "state APP_VERSION"],
    [readProjectFile("sw.js"), /^const CACHE_NAME = "([^"]+)";$/mu, "nimr-sav-" + version, "service worker cache"],
  ];
  for (const [source, pattern, expected, label] of declarations) {
    const declaration = source.match(pattern);
    assert.ok(declaration, "Missing " + label);
    assert.equal(declaration[1], expected, label + " must match the canonical release");
  }
  const index = readProjectFile("index.html");
  for (const asset of ["app.js", "styles.css"]) {
    const references = [...index.matchAll(new RegExp('(?:src|href)="' + escapeRegExp(asset) + '\\?v=([^"]+)"', "gu"))];
    assert.equal(references.length, 1, "Expected one versioned " + asset + " reference");
    assert.equal(references[0][1], numericVersion, asset + " must match the canonical release");
  }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readProjectFile = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const normalizeEol = (value) => String(value || "").replace(/\r\n/gu, "\n");
const sourceSlice = (source, start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `source slice missing: ${start} -> ${end}`);
  return source.slice(startIndex, endIndex);
};

const configSource = readProjectFile("supabase/config.toml");
const edgeSource = readProjectFile("supabase/functions/workshop-user-admin/index.ts");
const indexSource = readProjectFile("index.html");
const stateSource = readProjectFile("js/state.js");
const clientSource = readProjectFile("js/supabase-client.js");

function assertMirrorGuards() {
  const fixture = createNimrVmContext();
  const { run } = fixture;
  run(`
    state = normalizeState({
      users: [
        { id: "admin", name: "Admin", role: "admin_technique", active: true },
        { id: "mirror", name: "Mirror", role: "reception", authUserId: "server-user", active: true },
        { id: "local", name: "Local", role: "reception", active: true }
      ], currentUserId: "admin", resources: [], cases: [], bookings: []
    });
    navigator.onLine = true;
    window.__nimrValidatedAuthUserId = "server-user";
    setAccountAccessRuntimeContext(
      { id: "server-user" },
      { workshop_id: "workshop-a", user_id: "server-user", role: "reception" }
    );
  `);
  assert.equal(run("isServerManagedLocalProfile({ authUserId: 'server-user' })"), true);
  assert.equal(run("isServerManagedLocalProfile({ authSource: 'supabase_membership' })"), true);
  assert.equal(run("isServerManagedLocalProfile({ id: 'local' })"), false);
  assert.equal(run("hasValidatedOnlineServerAuthority()"), true);
  const before = run("JSON.stringify(state)");
  assert.equal(run("updateUserLocal('mirror', { name: 'Changed', role: 'admin_technique' }).code"), "SERVER_MANAGED_PROFILE_READ_ONLY");
  assert.equal(run("JSON.stringify(state)"), before, "Denied mirror update must not mutate state");
  assert.equal(run("updateUserLocal('local', { name: 'Local changed', role: 'reception' }).ok"), true);
  assert.equal(run("getUserById('local').name"), "Local changed");
  run("window.__nimrValidatedAuthUserId = 'different-user'");
  assert.equal(run("hasValidatedOnlineServerAuthority()"), false);
  run("window.__nimrValidatedAuthUserId = 'server-user'; navigator.onLine = false");
  assert.equal(run("hasValidatedOnlineServerAuthority()"), false);
  return fixture;
}

function resolveTypeScript(rootDirectory) {
  const require = createRequire(import.meta.url);
  try {
    return require("typescript");
  } catch {}

  const localAppTs = path.join(rootDirectory, "apps/nimr-sav-react/node_modules/typescript");
  if (fs.existsSync(localAppTs)) return require(localAppTs);

  try {
    const commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: rootDirectory, encoding: "utf8" }).trim();
    if (commonDir) {
      const mainRepo = path.dirname(path.resolve(rootDirectory, commonDir));
      const mainTs = path.join(mainRepo, "apps/nimr-sav-react/node_modules/typescript");
      if (fs.existsSync(mainTs)) return require(mainTs);
    }
  } catch {}

  try {
    const worktrees = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: rootDirectory, encoding: "utf8" });
    for (const line of worktrees.split(/\r?\n/u)) {
      if (line.startsWith("worktree ")) {
        const wtPath = line.slice(9).trim();
        const candidate = path.join(wtPath, "apps/nimr-sav-react/node_modules/typescript");
        if (fs.existsSync(candidate)) return require(candidate);
      }
    }
  } catch {}

  throw new Error("TypeScript dependency could not be resolved from current worktree or linked git worktrees.");
}

function loadEdgeFactory() {
  const require = createRequire(import.meta.url);
  const typescript = resolveTypeScript(repoRoot);
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
  const syntaxErrors = (compiled.diagnostics || []).filter(
    (diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error,
  );
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
    __edgeCreateClient: () => { throw new Error("default Edge client must not be used by tests"); },
  });
  context.globalThis = context;
  context.exports = context.module.exports;
  vm.runInContext(compiled.outputText, context, { filename: "workshop-user-admin.identity001c.cjs" });
  return context.module.exports.createWorkshopUserAdminHandler;
}

const createWorkshopUserAdminHandler = loadEdgeFactory();

async function probeConfiguration(overrides) {
  const values = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "publishable-default" }),
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: "secret-default" }),
    SUPABASE_PUBLISHABLE_KEY: "publishable-single",
    SUPABASE_SECRET_KEY: "secret-single",
    ...overrides,
  };
  let clientFactoryCalls = 0;
  const handler = createWorkshopUserAdminHandler({
    environment: {
      get(name) {
        return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined;
      },
    },
    clientFactory() {
      clientFactoryCalls += 1;
      throw new Error("configuration failure must occur before client creation");
    },
  });
  const result = await handler(new Request("https://example.supabase.co/functions/v1/workshop-user-admin", {
    method: "POST",
    headers: { Authorization: "Bearer local-mock-user-jwt", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "capabilities", workshop_id: "workshop-a" }),
  }));
  return { status: result.status, body: await result.json(), clientFactoryCalls };
}

async function probeManualAuthentication(mode) {
  const events = [];
  const userClient = {
    auth: {
      async getUser(jwt) {
        events.push(`auth_get_user:${jwt}`);
        if (mode === "invalid_user") return { data: { user: null }, error: { message: "invalid jwt" } };
        return { data: { user: { id: "auth-caller" } }, error: null };
      },
    },
  };
  const adminClient = {
    from(table) {
      events.push(`read:${table}`);
      return {
        select() { return this; },
        eq() { return this; },
        is() { return this; },
        then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); },
      };
    },
    auth: {
      admin: {
        async inviteUserByEmail() { events.push("mutation:auth_invite"); throw new Error("unexpected mutation"); },
        async deleteUser() { events.push("mutation:auth_delete"); throw new Error("unexpected mutation"); },
      },
    },
  };
  const handler = createWorkshopUserAdminHandler({
    environment: {
      get(name) {
        return {
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "publishable-default" }),
          SUPABASE_SECRET_KEYS: JSON.stringify({ default: "secret-default" }),
        }[name];
      },
    },
    clientFactory(_url, key) {
      if (key === "publishable-default") {
        events.push("client:user");
        return userClient;
      }
      events.push("client:admin");
      return adminClient;
    },
  });
  const headers = { "Content-Type": "application/json" };
  if (mode !== "missing_bearer") headers.Authorization = "Bearer local-manual-auth-jwt";
  const result = await handler(new Request("https://example.supabase.co/functions/v1/workshop-user-admin", {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "invite_member",
      workshop_id: "workshop-a",
      name: "Test User",
      email: "test@example.test",
      role: "reception",
    }),
  }));
  return { status: result.status, body: await result.json(), events };
}

function listBrowserFiles() {
  const files = ["app.js", "index.html", "offline.html", "sw.js"];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(path.join(repoRoot, directory), { withFileTypes: true })) {
      const relative = path.posix.join(directory.replaceAll("\\", "/"), entry.name);
      if (entry.isDirectory()) visit(relative);
      else if (entry.isFile() && entry.name.endsWith(".js")) files.push(relative);
    }
  };
  visit("js");
  return files.sort();
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

await check("A gateway JWT verification is enabled and the browser Supabase SDK is pinned", () => {
  assert.equal(normalizeEol(configSource).trim(), "[functions.workshop-user-admin]\nverify_jwt = true");
  assert.doesNotMatch(configSource, /verify_jwt\s*=\s*false/iu);
  assert.match(edgeSource, /request\.headers\.get\("Authorization"\)/u);
  assert.match(edgeSource, /authorization\.match\(\/\^Bearer\\s\+\(\.\+\)\$\/iu\)/u);
  assert.match(edgeSource, /if \(!jwt\) return failure\("UNAUTHENTICATED"[\s\S]*?, 401\)/u);
  const noVerifyFlag = ["--no", "verify-jwt"].join("-");
  assert.equal(`${configSource}\n${edgeSource}`.includes(noVerifyFlag), false);
  assert.match(indexSource, /https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.111\.0/u);
  assert.doesNotMatch(indexSource, /@supabase\/supabase-js@2(?:["/?])/u);
  assert.equal((configSource.match(/\[functions\./gu) || []).length, 1);
});

await check("B manual authenticated-user validation rejects anonymous, invalid and membership-less callers before mutation", async () => {
  assert.match(edgeSource, /userClient\.auth\.getUser\(jwt\)/u);
  assert.match(edgeSource, /if \(authError \|\| !caller\?\.id\) return failure\("UNAUTHENTICATED"[\s\S]*?, 401\)/u);
  const missing = await probeManualAuthentication("missing_bearer");
  assert.equal(missing.status, 401);
  assert.equal(missing.body.code, "UNAUTHENTICATED");
  assert.deepEqual(missing.events, []);
  const invalid = await probeManualAuthentication("invalid_user");
  assert.equal(invalid.status, 401);
  assert.equal(invalid.body.code, "UNAUTHENTICATED");
  assert.deepEqual(invalid.events, ["client:user", "auth_get_user:local-manual-auth-jwt"]);
  const noMembership = await probeManualAuthentication("no_membership");
  assert.equal(noMembership.status, 403);
  assert.equal(noMembership.body.code, "WORKSHOP_SCOPE_MISMATCH");
  assert.deepEqual(noMembership.events, [
    "client:user",
    "auth_get_user:local-manual-auth-jwt",
    "client:admin",
    "read:workshop_members",
  ]);
  assert.equal([missing, invalid, noMembership].some(({ events }) => events.some((event) => event.startsWith("mutation:"))), false);
});

await check("C hosted publishable dictionary accepts only its default key", async () => {
  const result = await probeConfiguration({
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ secondary: "publishable-arbitrary" }),
  });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "SERVER_CONFIGURATION_ERROR");
  assert.equal(result.clientFactoryCalls, 0, "present hosted dictionary must not fall back to the single key");
});

await check("D hosted secret dictionary accepts only its default key", async () => {
  const result = await probeConfiguration({
    SUPABASE_SECRET_KEYS: JSON.stringify({ secondary: "secret-arbitrary" }),
  });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "SERVER_CONFIGURATION_ERROR");
  assert.equal(result.clientFactoryCalls, 0, "present hosted dictionary must not fall back to the single key");
});

await check("E dictionary presence never uses an arbitrary or single-key fallback", async () => {
  const helper = sourceSlice(edgeSource, "function readNamedKey", "function isExistingAuthUserError");
  assert.match(helper, /const dictionary = environment\.get\(dictionaryName\)/u);
  assert.match(helper, /if \(dictionary !== undefined\)/u);
  assert.match(helper, /const defaultKey = \(parsed as Record<string, unknown>\)\.default/u);
  assert.match(helper, /return typeof defaultKey === "string" \? defaultKey\.trim\(\) : ""/u);
  assert.doesNotMatch(helper, /Object\.values|Object\.keys|\[0\]/u);
  for (const overrides of [
    { SUPABASE_PUBLISHABLE_KEYS: "" },
    { SUPABASE_SECRET_KEYS: "" },
    { SUPABASE_PUBLISHABLE_KEYS: "not-json" },
    { SUPABASE_SECRET_KEYS: JSON.stringify({ default: "" }) },
    { SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: { unexpected: "value" } }) },
  ]) {
    const result = await probeConfiguration(overrides);
    assert.equal(result.body.code, "SERVER_CONFIGURATION_ERROR");
    assert.equal(result.clientFactoryCalls, 0);
  }
  assert.match(helper, /return String\(environment\.get\(singleName\) \|\| ""\)\.trim\(\)/u);
});

await check("F browser production code contains no privileged Supabase authority", () => {
  const browserSource = listBrowserFiles().map((file) => `\n/* ${file} */\n${readProjectFile(file)}`).join("\n");
  assert.doesNotMatch(browserSource, /\.auth\.admin\b|auth\.admin\b|SUPABASE_SECRET_KEYS|SUPABASE_SECRET_KEY/iu);
  assert.doesNotMatch(browserSource, /sb_secret_[A-Za-z0-9_-]{12,}/u);
  assert.match(clientSource, /function looksLikeSupabaseServiceRoleKey/u, "browser must retain secret-key rejection");
});

await check("G production browser has no direct workshop_members mutation path", () => {
  const references = [];
  for (const file of listBrowserFiles()) {
    const source = readProjectFile(file);
    const pattern = /\.from\(\s*["']workshop_members["']\s*\)/gu;
    for (const match of source.matchAll(pattern)) {
      const semicolon = source.indexOf(";", match.index);
      assert.ok(semicolon > match.index, `${file}: unterminated workshop_members chain`);
      const chain = source.slice(match.index, semicolon + 1);
      assert.doesNotMatch(chain, /\.(?:insert|update|delete|upsert)\s*\(/u, `${file}: direct membership write`);
      assert.match(chain, /\.select\s*\(/u, `${file}: membership access must be read-only`);
      references.push({ file, chain });
    }
  }
  assert.deepEqual(references.map(({ file }) => file), ["js/supabase-client.js"]);
  assert.match(references[0].chain, /\.eq\("user_id", authUser\.id\)[\s\S]*?\.maybeSingle\(\)/u);
});

await check("H Edge Function remains the only invite and offboard membership mutation authority", () => {
  assert.match(edgeSource, /\.from\("workshop_members"\)[\s\S]*?\.insert\(membershipRow\)/u);
  assert.match(edgeSource, /\.from\("workshop_members"\)[\s\S]*?\.update\(\{[\s\S]*?sync_source: "identity_offboarding"/u);
  assert.match(edgeSource, /FUNCTION_ACTIONS = new Set\(\["capabilities", "invite_member", "offboard_member", "link_technician_resource"\]\)/u);
  assert.match(edgeSource, /RESOURCE_LINKED_WORKSHOP_ROLES = new Set\(\[\s*"technicien",\s*"controle_qualite",\s*"chef_atelier",?\s*\]\)/u);
  assert.match(edgeSource, /RESOURCE_REQUIRED_WORKSHOP_ROLES = new Set\(\[\s*"technicien",\s*"controle_qualite",?\s*\]\)/u);
  assert.match(edgeSource, /function validateWorkshopResourceLink\(/u);
  assert.match(clientSource, /client\.functions\.invoke\("workshop-user-admin"/u);
  assert.doesNotMatch(clientSource, /\.from\(\s*["']workshop_members["']\s*\)[\s\S]{0,600}\.(?:insert|update|delete|upsert)\s*\(/u);
});

await check("I IDENTITY-001B caller JWT and membership authorization remains intact", () => {
  assert.match(edgeSource, /request\.headers\.get\("Authorization"\)/u);
  assert.match(edgeSource, /userClient\.auth\.getUser\(jwt\)/u);
  assert.match(edgeSource, /"UNAUTHENTICATED"/u);
  assert.match(edgeSource, /\.eq\("user_id", callerId\)[\s\S]*?\.is\("deleted_at", null\)/u);
  assert.match(edgeSource, /WORKSHOP_ADMIN_ROLES = new Set\(\["admin_technique", "directeur"\]\)/u);
  const caller = sourceSlice(edgeSource, "async function resolveCallerAuthority", "async function listHumanResources");
  assert.match(caller, /if \(!WORKSHOP_ADMIN_ROLES\.has\(role\)\)\s*\{\s*return \{ ok: false, response: failure\("FORBIDDEN_WORKSHOP_ADMIN"/u);
  assert.match(caller, /if \(!scopedMembership\)\s*\{\s*return \{ ok: false, response: failure\("WORKSHOP_SCOPE_MISMATCH"/u);
  const invite = sourceSlice(edgeSource, "async function handleInviteMember", "async function handleOffboardMember");
  assert.match(invite, /const role = normalizeTargetRole\(payload\.role\)/u);
  assert.match(invite, /if \(!isValidMemberName\(name\)\) return failure\("INVALID_MEMBER_NAME"/u);
  assert.match(invite, /if \(!isValidEmail\(email\)\) return failure\("INVALID_MEMBER_EMAIL"/u);
  assert.match(invite, /if \(!role\) return failure\("INVALID_WORKSHOP_ROLE"/u);
  assert.match(invite, /await validateWorkshopResourceLink\(adminClient, authority\.workshopId, role, payload\.resource_id\)/u);
  assert.match(invite, /if \(!resourceValidation\.ok\) return resourceValidation\.response/u);
  assert.match(edgeSource, /adminClient\.auth\.admin\.inviteUserByEmail/u);
  assert.match(edgeSource, /\.from\("workshop_members"\)[\s\S]*?\.insert\(membershipRow\)/u);
  assert.match(edgeSource, /adminClient\.auth\.admin\.deleteUser\(invitedUserId\)/u);
  assert.match(edgeSource, /"SELF_OFFBOARD_FORBIDDEN"/u);
  assert.match(edgeSource, /"LAST_ADMIN_FORBIDDEN"/u);
  assert.match(edgeSource, /sync_source:\s*"identity_offboarding"/u);
});

await check("J IDENTITY-001A server-managed local mirror guard remains intact", () => {
  assertMirrorGuards();
  assert.match(stateSource, /code: "SERVER_MANAGED_PROFILE_READ_ONLY"/u);
});

await check("K ticket introduces no migration, SQL execution or deployment path", () => {
  const changedPaths = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repoRoot, encoding: "utf8" })
    .split(/\r?\n/u).filter(Boolean).map((line) => line.slice(3).replaceAll("\\", "/"));
  const allowedSql = new Set([
    "supabase/migrations/20260923064000_qc_pro_dynamic_checklist_server.sql",
    "supabase/migrations/20260923213000_qc_pro_booking_authority_hardening.sql",
  ]);
  assert.deepEqual(changedPaths.filter((file) => (file.startsWith("supabase/migrations/") || /\.sql$/iu.test(file)) && !allowedSql.has(file)), []);
  assert.doesNotMatch(configSource + "\n" + edgeSource, /supabase\s+(?:db\s+(?:push|reset)|migration\s+up|functions\s+deploy|secrets\s+set)/iu);
});

await check("L role, planning and UI authority contracts are enforced", async () => {
  assertReleaseConsumers();
  const { context, run } = createNimrVmContext();
  assert.deepEqual(JSON.parse(run("JSON.stringify(ROLE_PERMISSIONS.admin_technique)")), ["*"]);
  for (const role of ["technicien", "reception", "lecture_seule"]) {
    const grants = run("ROLE_PERMISSIONS")[role];
    assert.equal(grants.some((grant) => run("permissionMatches")(grant, "users.manage")), false, role);
  }
  assert.equal(run("getDefaultTabForRole('technicien')"), "technician");
  assert.equal(run("getDefaultTabForRole('controle_qualite')"), "technician");

  run(`
    state.resources = [
      { id: "human", name: "Human", role: "tolier", active: true },
      { id: "equipment", name: "Equipment", role: "cabine", active: true },
      { id: "inactive", name: "Inactive", role: "peintre", active: false }
    ];
  `);
  assert.deepEqual(JSON.parse(run("JSON.stringify(getTechnicianDashboardResources().map(resource => resource.id))")), ["human"]);
  const bookings = [
    { id: "one", caseId: "case-a", resourceIds: ["human"] },
    { id: "two", caseId: "case-b", resourceIds: ["other"] },
  ];
  const view = run("createIndexedPlannerBookingView")(bookings, { excludedCaseId: "case-a" });
  assert.equal(run("isIndexedPlannerBookingView")(view), true);
  assert.equal(run("isIndexedPlannerBookingView")({ kind: "invalid" }), false);
  assert.equal(view.getSourceCount(), 1);
  assert.equal(view.getCaseBookings("case-a").length, 0);
  assert.deepEqual(Array.from(view.getResourceBookings("other"), (row) => row.id), ["two"]);
  view.addOverlay({ id: "overlay", caseId: "case-c", resourceIds: ["human"] });
  assert.deepEqual(Array.from(view.getResourceBookings("human"), (row) => row.id), ["overlay"]);
  assert.equal(bookings.length, 2, "Planner overlay must not mutate the source bookings");

  run(`
    navigator.onLine = true;
    window.__nimrValidatedAuthUserId = "admin-auth";
    setAccountAccessRuntimeContext(
      { id: "admin-auth" },
      { workshop_id: "workshop-a", user_id: "admin-auth", role: "admin_technique" }
    );
  `);
  const snapshot = {
    online: true, membershipStatus: "active", overallStatus: "active",
    serverRole: "admin_technique", authIdentity: { id: "admin-auth" },
    serverMembership: { workshop_id: "workshop-a", user_id: "admin-auth" },
  };
  for (const role of ["admin_technique", "directeur", "technicien", "reception", "chef_atelier", "controle_qualite", "lecture_seule"]) {
    assert.equal(run("getWorkshopUserAdminBaseDecision")({ ...snapshot, serverRole: role }).ok,
      ["admin_technique", "directeur"].includes(role), "Server account administration role: " + role);
  }
  assert.equal(run("getWorkshopUserAdminBaseDecision")({ ...snapshot, online: false }).ok, false);
  assert.equal(run("getWorkshopUserAdminBaseDecision")({ ...snapshot, membershipStatus: "not_authorized" }).ok, false);
  const calls = [];
  context.getAccountAccessSnapshot = () => snapshot;
  context.invokeWorkshopUserAdmin = async (action, payload) => {
    calls.push({ action, payload: JSON.parse(JSON.stringify(payload)) });
    return { ok: true, can_manage_accounts: true, provisioning_available: true,
      caller_role: "admin_technique", workshop_id: "workshop-a", active_admin_technique_count: 2,
      human_resources: [] };
  };
  await run("refreshWorkshopUserAdminCapabilities")({ snapshot, force: true });
  assert.deepEqual(calls, [{ action: "capabilities", payload: {} }]);
  assert.equal(run("getWorkshopUserAdminUiDecision")(snapshot).allowed, true);
  assert.equal(run("getWorkshopUserAdminUiDecision")({ ...snapshot, serverRole: "directeur" }).allowed, false);
  await run("refreshWorkshopUserAdminCapabilities")({ snapshot: { ...snapshot, online: false }, force: true });
  assert.equal(calls.length, 1, "Offline administration must not call the server");
  assert.equal(run("getWorkshopUserAdminUiDecision")({ ...snapshot, online: false }).allowed, false);

  const uiPlanningSource = readProjectFile("js/ui-planning.js");
  const renderUsers = sourceSlice(uiPlanningSource, "function renderUsersAndRoles()", "const selectorNote =");
  assert.match(renderUsers, /canRenderAction\("users\.manage"\)/u);
  assert.match(renderUsers, /serverManagedReadOnly = onlineAuthority && serverManagedProfile/u);
  assert.match(renderUsers, /mutationDisabled = !canManageLocalUsers \|\| serverManagedReadOnly/u);
  assert.match(renderUsers, /switcher\.disabled = onlineAuthority \|\| !canManageUsers/u);
  assert.doesNotMatch(uiPlanningSource, /\.auth\.admin\b|SUPABASE_SECRET/iu);
});

assert.equal(passed.length + failures.length, 12, "IDENTITY-001C must contain exactly checks A-L");

if (failures.length) {
  console.error(`\nIDENTITY-001C REGRESSION SUITE: ${passed.length}/12 CHECKS PASSED (${failures.length} FAILED)`);
  failures.forEach(({ name, error }) => console.error(`\n${name}\n${error.stack || error.message}`));
  process.exitCode = 1;
} else {
  console.log("\nIDENTITY-001C REGRESSION SUITE: 12/12 CHECKS PASSED");
}
