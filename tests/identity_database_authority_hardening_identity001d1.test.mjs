import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LOGICAL_NAME = "identity_001d1_database_authority_hardening";
function assertSourceOrder(source, before, after) {
  const beforeIndex = source.indexOf(before);
  const afterIndex = source.indexOf(after);
  assert.ok(beforeIndex >= 0, "Missing prerequisite: " + before);
  assert.ok(afterIndex > beforeIndex, "Expected " + before + " before " + after);
}

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
const sourceSlice = (source, start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `source slice missing: ${start} -> ${end}`);
  return source.slice(startIndex, endIndex);
};
const withoutSqlComments = (source) => source.replace(/--[^\r\n]*/gu, "");

const migrationsDirectory = path.join(repoRoot, "supabase", "migrations");
const migrationNames = fs.readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(`_${LOGICAL_NAME}.sql`));
assert.equal(migrationNames.length, 1, "IDENTITY-001D1 must have exactly one generated migration");
const migrationName = migrationNames[0];
const migrationRelativePath = path.posix.join("supabase", "migrations", migrationName);
const migrationSource = readProjectFile(migrationRelativePath);
const migrationSql = withoutSqlComments(migrationSource);
const edgeSource = readProjectFile("supabase/functions/workshop-user-admin/index.ts");

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
  vm.runInContext(compiled.outputText, context, { filename: "workshop-user-admin.identity001d1.cjs" });
  return context.module.exports.createWorkshopUserAdminHandler;
}

async function invokeLastAdminRace(options = {}) {
  const createWorkshopUserAdminHandler = loadEdgeFactory();
  const memberships = [
    { workshop_id: "workshop-a", user_id: "auth-director", role: "directeur", resource_id: null, deleted_at: null },
    { workshop_id: "workshop-a", user_id: "auth-target", role: "admin_technique", resource_id: null, deleted_at: null },
    { workshop_id: "workshop-a", user_id: "auth-other-admin", role: "admin_technique", resource_id: null, deleted_at: null },
  ];
  const events = [];
  const linking = options.action === "link_technician_resource";
  if (linking) memberships[1].role = "technicien";

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.operation = "read";
    }
    select() { return this; }
    eq(field, value) {
      this.filters.push((row) => String(row?.[field] ?? "") === String(value ?? ""));
      return this;
    }
    is(field, value) {
      this.filters.push((row) => value === null ? row?.[field] == null : row?.[field] === value);
      return this;
    }
    limit() { return this; }
    update(values) { this.operation = "update"; this.values = values; return this; }
    maybeSingle() { return this.execute(true); }
    then(resolve, reject) { return this.execute(false).then(resolve, reject); }
    async execute(single) {
      if (this.table === "planning_resources") {
        return { data: { id: "resource-a", workshop_id: "workshop-a", type: "mecanicien", active: true, deleted_at: null }, error: null };
      }
      assert.equal(this.table, "workshop_members");
      const rows = memberships.filter((row) => this.filters.every((filter) => filter(row)));
      if (this.operation === "update") {
        if (linking) {
          events.push("resource_link_update");
          return { data: null, error: options.error };
        }
        if (options.revokeSucceeded) {
          events.push("membership_revoked");
          Object.assign(rows[0], this.values);
          return { data: structuredClone(rows[0]), error: null };
        }
        events.push("membership_revoke_rejected");
        return { data: null, error: options.error || { message: "new row violates invariant: NIMR_LAST_ADMIN_FORBIDDEN" } };
      }
      return { data: single ? (rows[0] || null) : structuredClone(rows), error: null };
    }
  }

  const adminClient = {
    from(table) { return new Query(table); },
    auth: {
      admin: {
        async deleteUser(userId, softDelete) {
          assert.equal(userId, "auth-target");
          assert.equal(softDelete, true);
          events.push("auth_delete");
          return { data: null, error: options.cleanupError || null };
        },
      },
    },
  };
  const userClient = {
    auth: {
      async getUser() {
        return { data: { user: { id: "auth-director" } }, error: null };
      },
    },
  };
  const environment = {
    get(name) {
      return {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "publishable-test" }),
        SUPABASE_SECRET_KEYS: JSON.stringify({ default: "secret-test" }),
      }[name];
    },
  };
  const handler = createWorkshopUserAdminHandler({
    environment,
    clientFactory(_url, key) {
      return key === "publishable-test" ? userClient : adminClient;
    },
  });
  const result = await handler(new Request("https://example.supabase.co/functions/v1/workshop-user-admin", {
    method: "POST",
    headers: { Authorization: "Bearer verified-user-jwt", "Content-Type": "application/json" },
    body: JSON.stringify({ action: options.action || "offboard_member", workshop_id: "workshop-a", user_id: "auth-target", expected_resource_id: null, resource_id: "resource-a" }),
  }));
  return { status: result.status, body: await result.json(), events };
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

await check("A CLI-generated migration path contains the expected logical name", () => {
  assert.match(migrationName, /^\d{14}_identity_001d1_database_authority_hardening\.sql$/u);
  assert.equal(migrationRelativePath, `supabase/migrations/${migrationName}`);
  assert.match(migrationSource, /IDENTITY-001D1 — Database Authority Hardening Migration/u);
});

await check("B migration uses transaction-local timeouts and write-blocking authority-table locks", () => {
  assert.match(migrationSql, /^\s*begin\s*;/iu);
  assert.match(migrationSql, /set\s+local\s+lock_timeout\s*=\s*'5s'\s*;/iu);
  assert.match(migrationSql, /set\s+local\s+statement_timeout\s*=\s*'60s'\s*;/iu);
  assert.match(migrationSql, /lock\s+table\s+public\.workshop_members\s*,\s*public\.planning_resources\s+in\s+share\s+row\s+exclusive\s+mode\s*;/iu);
  assert.doesNotMatch(migrationSql, /create\s+(?:unique\s+)?index\s+concurrently/iu);
  assert.match(migrationSql, /commit\s*;\s*$/iu);
});

await check("C orphan and cross-workshop resource preflights fail closed", () => {
  const preflight = sourceSlice(migrationSql, "do $identity_001d1$", "create schema if not exists private");
  assert.match(preflight, /left\s+join\s+public\.planning_resources[\s\S]*?wm\.resource_id\s+is\s+not\s+null[\s\S]*?pr\.id\s+is\s+null/iu);
  assert.match(preflight, /IDENTITY_001D1_ORPHAN_RESOURCE/u);
  assert.match(preflight, /join\s+public\.planning_resources[\s\S]*?wm\.workshop_id\s*<>\s*pr\.workshop_id/iu);
  assert.match(preflight, /IDENTITY_001D1_CROSS_WORKSHOP_RESOURCE/u);
});

await check("D duplicate-active-resource and admin-continuity preflights fail closed without repair", () => {
  const preflight = sourceSlice(migrationSql, "do $identity_001d1$", "create schema if not exists private");
  assert.match(preflight, /wm\.deleted_at\s+is\s+null[\s\S]*?wm\.resource_id\s+is\s+not\s+null[\s\S]*?group\s+by\s+wm\.workshop_id\s*,\s*wm\.resource_id[\s\S]*?having\s+count\(\*\)\s*>\s*1/iu);
  assert.match(preflight, /IDENTITY_001D1_DUPLICATE_ACTIVE_RESOURCE/u);
  assert.match(preflight, /count\(\*\)\s+filter\s*\(\s*where\s+wm\.role\s*=\s*'admin_technique'\s*\)\s*=\s*0/iu);
  assert.match(preflight, /IDENTITY_001D1_ADMIN_CONTINUITY_BASELINE/u);
  assert.doesNotMatch(preflight, /\b(?:insert\s+into|update\s+public|delete\s+from)\b/iu);
});

await check("E composite resource parent uniqueness and full child index exist", () => {
  assert.match(migrationSql, /create\s+unique\s+index\s+if\s+not\s+exists\s+planning_resources_workshop_id_id_uidx\s+on\s+public\.planning_resources\s*\(\s*workshop_id\s*,\s*id\s*\)\s*;/iu);
  assert.match(migrationSql, /create\s+index\s+if\s+not\s+exists\s+workshop_members_workshop_id_resource_id_idx\s+on\s+public\.workshop_members\s*\(\s*workshop_id\s*,\s*resource_id\s*\)\s*;/iu);
});

await check("F nullable resource receives a same-workshop composite FK without delete cascade", () => {
  const foreignKey = sourceSlice(migrationSql, "add constraint workshop_members_workshop_resource_fkey", "end if;");
  assert.match(foreignKey, /foreign\s+key\s*\(\s*workshop_id\s*,\s*resource_id\s*\)/iu);
  assert.match(foreignKey, /references\s+public\.planning_resources\s*\(\s*workshop_id\s*,\s*id\s*\)/iu);
  assert.match(foreignKey, /on\s+update\s+no\s+action/iu);
  assert.match(foreignKey, /on\s+delete\s+restrict/iu);
  assert.doesNotMatch(foreignKey, /cascade/iu);
  assert.doesNotMatch(migrationSql, /alter\s+column\s+resource_id\s+set\s+not\s+null/iu);
});

await check("G active workshop-resource mapping is partial and unique", () => {
  assert.match(migrationSql, /create\s+unique\s+index\s+if\s+not\s+exists\s+workshop_members_active_workshop_resource_uidx\s+on\s+public\.workshop_members\s*\(\s*workshop_id\s*,\s*resource_id\s*\)\s+where\s+deleted_at\s+is\s+null\s+and\s+resource_id\s+is\s+not\s+null\s*;/iu);
});

await check("H user_id FK support index exists without changing the primary key", () => {
  assert.match(migrationSql, /create\s+index\s+if\s+not\s+exists\s+workshop_members_user_id_idx\s+on\s+public\.workshop_members\s*\(\s*user_id\s*\)\s*;/iu);
  assert.doesNotMatch(migrationSql, /drop\s+constraint\s+[^;]*workshop_members_pkey|drop\s+index\s+[^;]*workshop_members_pkey/iu);
});

await check("I authenticated membership mutation policies are removed without replacements", () => {
  for (const operation of ["insert", "update", "delete"]) {
    assert.match(migrationSql, new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+nimr_workshop_members_${escapeRegExp(operation)}\\s+on\\s+public\\.workshop_members`, "iu"));
    assert.doesNotMatch(migrationSql, new RegExp(`create\\s+policy\\s+nimr_workshop_members_${escapeRegExp(operation)}`, "iu"));
  }
  assert.doesNotMatch(migrationSql, /on\s+public\.workshop_members\s+for\s+(?:insert|update|delete)\s+to\s+authenticated/iu);
});

await check("J authenticated table privileges are SELECT-only without anon/service_role changes", () => {
  assert.match(migrationSql, /revoke\s+all\s+privileges\s+on\s+table\s+public\.workshop_members\s+from\s+authenticated\s*;/iu);
  assert.match(migrationSql, /grant\s+select\s+on\s+table\s+public\.workshop_members\s+to\s+authenticated\s*;/iu);
  assert.doesNotMatch(migrationSql, /grant\s+(?:insert|update|delete|truncate|references|trigger|all)[^;]*\bto\s+authenticated\b/iu);
  assert.doesNotMatch(migrationSql, /\bgrant\b[^;]*\bto\s+anon\b/iu);
  assert.doesNotMatch(migrationSql, /\brevoke\b[^;]*\bfrom\s+service_role\b/iu);
});

await check("K SELECT policy preserves scope semantics and auth.uid initPlan", () => {
  const policy = sourceSlice(migrationSql, "create policy nimr_workshop_members_select", "revoke all privileges");
  assert.match(policy, /on\s+public\.workshop_members\s+for\s+select\s+to\s+authenticated/iu);
  assert.match(policy, /user_id\s*=\s*\(\s*select\s+auth\.uid\(\)\s*\)/iu);
  assert.match(policy, /or\s+public\.nimr_is_workshop_member\s*\(\s*workshop_id\s*\)/iu);
  assert.doesNotMatch(policy, /auth\.uid\(\)\s*=\s*user_id|user_id\s*=\s*auth\.uid\(\)/iu);
});

await check("L last-admin trigger covers every removal path with parent-row serialization", () => {
  const helper = sourceSlice(migrationSql, "create or replace function private.nimr_prevent_last_admin_removal", "revoke execute on function");
  assert.match(migrationSql, /create\s+trigger\s+nimr_prevent_last_admin_removal\s+before\s+update\s+or\s+delete\s+on\s+public\.workshop_members\s+for\s+each\s+row/iu);
  assert.match(helper, /old\.deleted_at\s+is\s+not\s+null[\s\S]*?old\.role\s+is\s+distinct\s+from\s+'admin_technique'/iu);
  assert.match(helper, /new\.deleted_at\s+is\s+null[\s\S]*?new\.role\s*=\s*'admin_technique'[\s\S]*?new\.workshop_id\s*=\s*old\.workshop_id/iu);
  assert.match(helper, /from\s+public\.workshops[\s\S]*?w\.id\s*=\s*old\.workshop_id[\s\S]*?for\s+update/iu);
  assert.match(helper, /select\s+count\(\*\)[\s\S]*?wm\.user_id\s*<>\s*old\.user_id[\s\S]*?wm\.deleted_at\s+is\s+null[\s\S]*?wm\.role\s*=\s*'admin_technique'/iu);
  assert.match(helper, /message\s*=\s*'NIMR_LAST_ADMIN_FORBIDDEN'/iu);
  assert.match(helper, /errcode\s*=\s*'23514'/iu);
  assert.match(helper, /if\s+not\s+found[\s\S]*?tg_op\s*=\s*'DELETE'[\s\S]*?return\s+old/iu);
});

await check("M private SECURITY DEFINER helper has no direct public execution path", () => {
  assert.match(migrationSql, /create\s+schema\s+if\s+not\s+exists\s+private/iu);
  assert.match(migrationSql, /revoke\s+all\s+on\s+schema\s+private\s+from\s+public/iu);
  assert.match(migrationSql, /revoke\s+all\s+on\s+schema\s+private\s+from\s+anon\s*,\s*authenticated/iu);
  const helperBody = sourceSlice(
    migrationSql,
    "create or replace function private.nimr_prevent_last_admin_removal",
    "\n$identity_001d1$;\n\nrevoke execute",
  );
  const helperPrivileges = sourceSlice(migrationSql, "revoke execute on function", "drop trigger if exists");
  assert.match(helperBody, /security\s+definer/iu);
  assert.match(helperBody, /set\s+search_path\s*=\s*''/iu);
  assert.match(helperBody, /public\.workshops|public\.workshop_members/iu);
  assert.doesNotMatch(helperBody, /\bexecute\b|format\s*\(|user_metadata|auth\.jwt|auth\.uid/iu);
  assert.match(helperPrivileges, /revoke\s+execute\s+on\s+function\s+private\.nimr_prevent_last_admin_removal\(\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/iu);
});

await check("N Edge race mapping is narrow and preserves revoke-before-Auth cleanup", async () => {
  const invite = sourceSlice(edgeSource, "async function handleInviteMember", "async function handleOffboardMember");
  assert.match(invite, /adminClient\.auth\.admin\.inviteUserByEmail\(email,\s*\{\s*data:\s*\{\s*display_name:\s*name,\s*nimr_password_setup_required:\s*true,?\s*\}/u);
  assert.match(invite, /workshop_id:\s*authority\.workshopId,\s*user_id:\s*invitedUserId,\s*role,\s*resource_id:\s*resourceValidation\.resourceId/u);
  assert.match(invite, /\.from\("workshop_members"\)\s*\.insert\(membershipRow\)/u);
  assert.match(invite, /if \(membershipError \|\| !membership\)\s*\{\s*const \{ error: compensationError \} = await adminClient\.auth\.admin\.deleteUser\(invitedUserId\)/u);
  assert.match(invite, /compensation_succeeded:\s*!compensationError/u);
  const offboarding = sourceSlice(edgeSource, "async function handleOffboardMember", "export function createWorkshopUserAdminHandler");
  assert.match(offboarding, /revokeError[\s\S]*?\.message[\s\S]*?NIMR_LAST_ADMIN_FORBIDDEN[\s\S]*?LAST_ADMIN_FORBIDDEN[\s\S]*?409[\s\S]*?membership_revoked:\s*false/u);
  assertSourceOrder(offboarding, '.update({', "auth.admin.deleteUser(targetUserId, true)");
  assert.match(offboarding, /MEMBERSHIP_REVOKE_FAILED/u);
  const race = await invokeLastAdminRace();
  assert.equal(race.status, 409);
  assert.equal(race.body.code, "LAST_ADMIN_FORBIDDEN");
  assert.equal(race.body.membership_revoked, false);
  assert.deepEqual(race.events, ["membership_revoke_rejected"]);
  for (const error of [
    { code: "23514", message: "unrelated check violation" },
    { code: "P0001", message: "unrelated trigger failure" },
    { message: "backend unavailable" },
  ]) {
    const rejected = await invokeLastAdminRace({ error });
    assert.equal(rejected.status, 500);
    assert.equal(rejected.body.code, "MEMBERSHIP_REVOKE_FAILED");
    assert.equal(rejected.body.ok, false);
    assert.deepEqual(rejected.events, ["membership_revoke_rejected"]);
  }
  for (const cleanupError of [null, { message: "backend unavailable" }]) {
    const revoked = await invokeLastAdminRace({ revokeSucceeded: true, cleanupError });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.membership_revoked, true);
    assert.equal(revoked.body.auth_cleanup, !cleanupError);
    if (cleanupError) assert.equal(revoked.body.code, "AUTH_CLEANUP_PENDING");
    assert.deepEqual(revoked.events, ["membership_revoked", "auth_delete"]);
  }
  const linkErrors = [
    [{ code: "23505", message: 'duplicate key value violates unique constraint "workshop_members_active_workshop_resource_uidx"' }, 409],
    [{ code: "23503", message: 'insert or update violates foreign key constraint "workshop_members_workshop_resource_fkey"' }, 409],
    [{ code: "23505", message: 'duplicate key value violates unique constraint "unrelated_key"' }, 500],
    [{ code: "23503", message: 'violates foreign key constraint "workshop_members_user_id_fkey"' }, 500],
    [{ code: "23505", message: 'constraint "workshop_members_active_workshop_resource_uidx_extra"' }, 500],
    [{ code: "23514", message: "NIMR_LAST_ADMIN_FORBIDDEN" }, 500],
    [{ code: "P0001", message: "custom trigger failure" }, 500],
    [{ code: "XX000", message: 'internal error "workshop_members_workshop_resource_fkey"' }, 500],
    [{ code: "23505", message: "unknown unique violation" }, 500],
    [{ code: "23503", message: "unknown foreign key violation" }, 500],
    [{ message: "backend unavailable" }, 500],
  ];
  for (const [error, expectedStatus] of linkErrors) {
    const linked = await invokeLastAdminRace({ action: "link_technician_resource", error });
    assert.equal(linked.status, expectedStatus, `resource link: ${JSON.stringify(error)}`);
    assert.equal(linked.body.code, expectedStatus === 409 ? "RESOURCE_LINK_FAILED" : "RESOURCE_LINK_UPDATE_FAILED");
    assert.equal(linked.body.ok, false);
    assert.deepEqual(linked.events, ["resource_link_update"]);
    assert.equal(JSON.stringify(linked.body).includes(error.message), false, "SQL/backend details must not reach the client");
  }
  const changedPaths = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repoRoot, encoding: "utf8" })
    .split(/\r?\n/u).filter(Boolean).map((line) => line.slice(3).trim());

  // Découplage architectural : contrôle de surface restreint exclusivement à l'autorité Identité
  const isIdentityAuthoritySurface = (file) => {
    const normalized = file.replaceAll("\\", "/");
    return (
      normalized.startsWith("supabase/functions/") ||
      (normalized.startsWith("supabase/migrations/") && /identity|workshop_members|user_admin/iu.test(normalized)) ||
      normalized.startsWith("tests/identity_")
    );
  };
  const identitySensitiveChangedPaths = changedPaths.filter(isIdentityAuthoritySurface);
  const allowedIdentityAuthorityPaths = new Set([
    migrationRelativePath.replaceAll("\\", "/"),
    "supabase/functions/workshop-user-admin/index.ts",
    "tests/identity_accounts_access_foundation_identity001a.test.mjs",
    "tests/identity_secure_provisioning_offboarding_identity001b.test.mjs",
    "tests/identity_production_authority_hardening_identity001c.test.mjs",
    "tests/identity_database_authority_hardening_identity001d1.test.mjs",
    "tests/identity_invited_user_password_onboarding_identity001d2e.test.mjs",
    "tests/identity_password_recovery_otp_identity001d2f.test.mjs",
  ]);
  assert.equal(
    identitySensitiveChangedPaths.every((file) => allowedIdentityAuthorityPaths.has(file.replaceAll("\\", "/"))),
    true,
    `Toute modification dans la surface d'autorité Identité doit être autorisée. Rejeté: ${identitySensitiveChangedPaths.filter((f) => !allowedIdentityAuthorityPaths.has(f.replaceAll("\\", "/"))).join(", ")}`
  );
  const forbiddenCommands = [
    ["supabase", "db", "push"].join(" "),
    ["supabase", "migration", "up"].join(" "),
    ["supabase", "functions", "deploy"].join(" "),
    ["supabase", "secrets", "set"].join(" "),
  ];
  for (const command of forbiddenCommands) assert.equal(`${migrationSql}\n${edgeSource}`.includes(command), false, command);
  assertReleaseConsumers();
});

assert.equal(passed.length + failures.length, 14, "IDENTITY-001D1 must contain exactly checks A-N");

if (failures.length) {
  console.error(`\nIDENTITY-001D1 REGRESSION SUITE: ${passed.length}/14 CHECKS PASSED (${failures.length} FAILED)`);
  failures.forEach(({ name, error }) => console.error(`\n${name}\n${error.stack || error.message}`));
  process.exitCode = 1;
} else {
  console.log("\nIDENTITY-001D1 REGRESSION SUITE: 14/14 CHECKS PASSED");
}
