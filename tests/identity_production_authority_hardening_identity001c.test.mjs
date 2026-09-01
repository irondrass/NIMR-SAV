import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BASE_SHA = "c07e3fa9c8035686789b0e0fcf2f0e5df93f3acc";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
const withoutSourceSlice = (source, start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `source slice missing: ${start} -> ${end}`);
  return source.slice(0, startIndex) + source.slice(endIndex);
};

const configSource = readProjectFile("supabase/config.toml");
const edgeSource = readProjectFile("supabase/functions/workshop-user-admin/index.ts");
const baseEdgeSource = readBaseFile("supabase/functions/workshop-user-admin/index.ts");
const indexSource = readProjectFile("index.html");
const stateSource = readProjectFile("js/state.js");
const baseStateSource = readBaseFile("js/state.js");
const clientSource = readProjectFile("js/supabase-client.js");

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
  assert.match(edgeSource, /FUNCTION_ACTIONS = new Set\(\["capabilities", "invite_member", "offboard_member"\]\)/u);
  assert.match(clientSource, /client\.functions\.invoke\("workshop-user-admin"/u);
  assert.doesNotMatch(clientSource, /\.from\(\s*["']workshop_members["']\s*\)[\s\S]{0,600}\.(?:insert|update|delete|upsert)\s*\(/u);
});

await check("I IDENTITY-001B caller JWT and membership authorization remains intact", () => {
  const currentWithoutKeyHelper = withoutSourceSlice(edgeSource, "function readNamedKey", "function isExistingAuthUserError");
  const baseWithoutKeyHelper = withoutSourceSlice(baseEdgeSource, "function readNamedKey", "function isExistingAuthUserError");
  assert.equal(normalizeEol(currentWithoutKeyHelper), normalizeEol(baseWithoutKeyHelper));
  assert.match(edgeSource, /request\.headers\.get\("Authorization"\)/u);
  assert.match(edgeSource, /userClient\.auth\.getUser\(jwt\)/u);
  assert.match(edgeSource, /\.eq\("user_id", callerId\)[\s\S]*?\.is\("deleted_at", null\)/u);
  assert.match(edgeSource, /WORKSHOP_ADMIN_ROLES = new Set\(\["admin_technique", "directeur"\]\)/u);
});

await check("J IDENTITY-001A server-managed local mirror guard remains intact", () => {
  for (const [start, end] of [
    ["function isServerManagedLocalProfile", "function hasValidatedOnlineServerAuthority"],
    ["function hasValidatedOnlineServerAuthority", "function isAccountAccessHumanResource"],
    ["function updateUserLocal", "function resolvePermissionUser"],
  ]) {
    assert.equal(
      normalizeEol(sourceSlice(stateSource, start, end)),
      normalizeEol(sourceSlice(baseStateSource, start, end)),
      start,
    );
  }
  assert.match(stateSource, /code: "SERVER_MANAGED_PROFILE_READ_ONLY"/u);
});

await check("K ticket introduces no migration, SQL execution or deployment path", () => {
  const status = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });
  const changedPaths = status.split(/\r?\n/u).filter(Boolean).map((line) => line.slice(3).trim());
  assert.equal(changedPaths.some((file) => /(?:^|\/)supabase\/migrations\//u.test(file)), false);
  assert.equal(changedPaths.some((file) => /\.sql$/iu.test(file)), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "supabase", "migrations")), false);
  assert.doesNotMatch(`${configSource}\n${edgeSource}`, /supabase\s+(?:db\s+(?:push|reset)|migration\s+up|functions\s+deploy|secrets\s+set)/iu);
});

await check("L protected role, permission, planning and release contracts are unchanged", () => {
  for (const file of [
    "app.js",
    "js/planning.js",
    "js/state.js",
    "js/supabase-client.js",
    "js/supabase-config.js",
    "js/supabase-sync.js",
    "js/ui-cases.js",
    "js/ui-planning.js",
  ]) {
    assert.equal(normalizeEol(readProjectFile(file)), normalizeEol(readBaseFile(file)), file);
  }
  for (const block of ["CANONICAL_USER_ROLES", "DIRECTOR_PERMISSIONS", "ROLE_PERMISSIONS", "ROLE_TABS", "ROLE_DEFAULT_TABS"]) {
    assert.ok(stateSource.includes(`const ${block}`), block);
  }
  assert.match(readProjectFile("js/version.js"), /^window\.APP_VERSION = "v23\.3\.20";$/mu);
});

assert.equal(passed.length + failures.length, 12, "IDENTITY-001C must contain exactly checks A-L");

if (failures.length) {
  console.error(`\nIDENTITY-001C REGRESSION SUITE: ${passed.length}/12 CHECKS PASSED (${failures.length} FAILED)`);
  failures.forEach(({ name, error }) => console.error(`\n${name}\n${error.stack || error.message}`));
  process.exitCode = 1;
} else {
  console.log("\nIDENTITY-001C REGRESSION SUITE: 12/12 CHECKS PASSED");
}
