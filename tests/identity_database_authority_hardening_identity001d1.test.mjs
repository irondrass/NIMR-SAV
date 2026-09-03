import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BASE_SHA = "f1c69cfb67a8897ed163b11e2a97cbba1be897a1";
const LOGICAL_NAME = "identity_001d1_database_authority_hardening";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readProjectFile = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const readBaseFile = (relativePath) => execFileSync("git", ["show", `${BASE_SHA}:${relativePath}`], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 40 * 1024 * 1024,
});
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
const baseEdgeSource = readBaseFile("supabase/functions/workshop-user-admin/index.ts");

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
  vm.runInContext(compiled.outputText, context, { filename: "workshop-user-admin.identity001d1.cjs" });
  return context.module.exports.createWorkshopUserAdminHandler;
}

async function invokeLastAdminRace() {
  const createWorkshopUserAdminHandler = loadEdgeFactory();
  const memberships = [
    { workshop_id: "workshop-a", user_id: "auth-director", role: "directeur", resource_id: null, deleted_at: null },
    { workshop_id: "workshop-a", user_id: "auth-target", role: "admin_technique", resource_id: null, deleted_at: null },
    { workshop_id: "workshop-a", user_id: "auth-other-admin", role: "admin_technique", resource_id: null, deleted_at: null },
  ];
  const events = [];

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
    update() { this.operation = "update"; return this; }
    maybeSingle() { return this.execute(true); }
    then(resolve, reject) { return this.execute(false).then(resolve, reject); }
    async execute(single) {
      assert.equal(this.table, "workshop_members");
      const rows = memberships.filter((row) => this.filters.every((filter) => filter(row)));
      if (this.operation === "update") {
        events.push("membership_revoke_rejected");
        return { data: null, error: { message: "new row violates invariant: NIMR_LAST_ADMIN_FORBIDDEN" } };
      }
      return { data: single ? (rows[0] || null) : structuredClone(rows), error: null };
    }
  }

  const adminClient = {
    from(table) { return new Query(table); },
    auth: {
      admin: {
        async deleteUser() {
          events.push("auth_delete");
          return { data: null, error: null };
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
    body: JSON.stringify({ action: "offboard_member", workshop_id: "workshop-a", user_id: "auth-target" }),
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
    assert.match(migrationSql, new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+nimr_workshop_members_${operation}\\s+on\\s+public\\.workshop_members`, "iu"));
    assert.doesNotMatch(migrationSql, new RegExp(`create\\s+policy\\s+nimr_workshop_members_${operation}`, "iu"));
  }
  assert.doesNotMatch(migrationSql, /on\s+public\.workshop_members\s+for\s+(?:insert|update|delete)\s+to\s+authenticated/iu);
});

await check("J authenticated table privileges are SELECT-only without anon/service_role changes", () => {
  assert.match(migrationSql, /revoke\s+all\s+privileges\s+on\s+table\s+public\.workshop_members\s+from\s+authenticated\s*;/iu);
  assert.match(migrationSql, /grant\s+select\s+on\s+table\s+public\.workshop_members\s+to\s+authenticated\s*;/iu);
  assert.doesNotMatch(migrationSql, /grant\s+(?:insert|update|delete|truncate|references|trigger|all)[\s\S]{0,120}?to\s+authenticated/iu);
  assert.doesNotMatch(migrationSql, /\bgrant\b[\s\S]{0,120}?\bto\s+anon\b/iu);
  assert.doesNotMatch(migrationSql, /\brevoke\b[\s\S]{0,120}?\bfrom\s+service_role\b/iu);
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
  const currentInvite = sourceSlice(edgeSource, "async function handleInviteMember", "async function handleOffboardMember")
    .replace(
      /data:\s*\{\s*display_name:\s*name,\s*nimr_password_setup_required:\s*true,?\s*\}/u,
      "data: { display_name: name }",
    );
  assert.equal(
    currentInvite,
    sourceSlice(baseEdgeSource, "async function handleInviteMember", "async function handleOffboardMember"),
    "invitation behavior outside the IDENTITY-001D2-E onboarding flag must remain unchanged",
  );
  const offboarding = sourceSlice(edgeSource, "async function handleOffboardMember", "export function createWorkshopUserAdminHandler");
  assert.match(offboarding, /revokeError[\s\S]*?\.message[\s\S]*?NIMR_LAST_ADMIN_FORBIDDEN[\s\S]*?LAST_ADMIN_FORBIDDEN[\s\S]*?409[\s\S]*?membership_revoked:\s*false/u);
  assert.ok(offboarding.indexOf('.update({') < offboarding.indexOf("auth.admin.deleteUser(targetUserId, true)"));
  assert.match(offboarding, /MEMBERSHIP_REVOKE_FAILED/u);
  const race = await invokeLastAdminRace();
  assert.equal(race.status, 409);
  assert.equal(race.body.code, "LAST_ADMIN_FORBIDDEN");
  assert.equal(race.body.membership_revoked, false);
  assert.deepEqual(race.events, ["membership_revoke_rejected"]);
  const changedPaths = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repoRoot, encoding: "utf8" })
    .split(/\r?\n/u).filter(Boolean).map((line) => line.slice(3).trim());
  const fetchedHistoricalMigrations = new Set([
    "supabase/migrations/20260827081041_nimr_sav_v23_2_8_full_audit.sql",
    "supabase/migrations/20260827081238_v23_3_0_planning_dependencies.sql",
    "supabase/migrations/20260827081339_p0_009_granular_sync_entities.sql",
    "supabase/migrations/20260827081513_p0_010_offline_concurrency.sql",
    "supabase/migrations/20260827081659_p1_002_planning_acceptance_safety.sql",
    "supabase/migrations/20260827082138_p1_002_acl_hardening.sql",
  ]);
  assert.equal(changedPaths.every((file) => [
    migrationRelativePath,
    "supabase/functions/workshop-user-admin/index.ts",
    "tests/identity_database_authority_hardening_identity001d1.test.mjs",
    "tests/identity_production_authority_hardening_identity001c.test.mjs",
    "tests/identity_accounts_access_foundation_identity001a.test.mjs",
    "tests/identity_secure_provisioning_offboarding_identity001b.test.mjs",
    "tests/identity_invited_user_password_onboarding_identity001d2e.test.mjs",
    "tests/identity_password_recovery_otp_identity001d2f.test.mjs",
    "tests/perf_fast_pwa_startup_perf001.test.mjs",
    "tests/ux_visual_system_2026_ux010.test.mjs",
    "tests/sync_granular_bootstrap_self_heal_sync001.test.mjs",
    "tests/sync_conflict_reconcile_and_collapse_sync002.test.mjs",
    "tests/sync_equivalent_cas_auto_reconcile_sync0021.test.mjs",
    "tests/offline_concurrency_chaos_p010.test.mjs",
    "tests/helpers/granular_supabase_adapter.mjs",
    "app.js",
    "index.html",
    "js/state.js",
    "js/storage.js",
    "js/supabase-client.js",
    "js/supabase-sync.js",
    "js/ui-cases.js",
    "styles.css",
    "sw.js",
  ].includes(file.replaceAll("\\", "/")) || fetchedHistoricalMigrations.has(file.replaceAll("\\", "/"))), true);
  const forbiddenCommands = [
    ["supabase", "db", "push"].join(" "),
    ["supabase", "migration", "up"].join(" "),
    ["supabase", "functions", "deploy"].join(" "),
    ["supabase", "secrets", "set"].join(" "),
  ];
  for (const command of forbiddenCommands) assert.equal(`${migrationSql}\n${edgeSource}`.includes(command), false, command);
  assert.equal(readProjectFile("js/version.js"), readBaseFile("js/version.js"));
  assert.match(readProjectFile("js/version.js"), /^window\.APP_VERSION = "v23\.3\.20";$/mu);
});

assert.equal(passed.length + failures.length, 14, "IDENTITY-001D1 must contain exactly checks A-N");

if (failures.length) {
  console.error(`\nIDENTITY-001D1 REGRESSION SUITE: ${passed.length}/14 CHECKS PASSED (${failures.length} FAILED)`);
  failures.forEach(({ name, error }) => console.error(`\n${name}\n${error.stack || error.message}`));
  process.exitCode = 1;
} else {
  console.log("\nIDENTITY-001D1 REGRESSION SUITE: 14/14 CHECKS PASSED");
}
