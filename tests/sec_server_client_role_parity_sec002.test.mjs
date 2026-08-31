import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const repoRoot = process.cwd();

const CANONICAL_ROLES_7 = [
  "admin_technique",
  "directeur",
  "chef_atelier",
  "reception",
  "technicien",
  "controle_qualite",
  "lecture_seule",
];

const sqlMigration = fs.readFileSync(repoRoot + "/supabase_sec_002_server_client_role_parity.sql", "utf8");
const uiReceptionSource = fs.readFileSync(repoRoot + "/js/ui-reception.js", "utf8");
const supabaseClientSource = fs.readFileSync(repoRoot + "/js/supabase-client.js", "utf8");
const supabaseSyncSource = fs.readFileSync(repoRoot + "/js/supabase-sync.js", "utf8");

function createAppContext({ loadReception = false } = {}) {
  const sandbox = {
    window: {},
    console: { log() {}, warn() {}, error() {} },
    localStorage: {
      _store: new Map(),
      getItem(k) { return this._store.get(k) || null; },
      setItem(k, v) { this._store.set(k, String(v)); },
      removeItem(k) { this._store.delete(k); },
      clear() { this._store.clear(); }
    },
    sessionStorage: {
      _store: new Map(),
      getItem(k) { return this._store.get(k) || null; },
      setItem(k, v) { this._store.set(k, String(v)); },
      removeItem(k) { this._store.delete(k); },
      clear() { this._store.clear(); }
    },
    navigator: { onLine: true },
    $: () => null,
    $$: () => [],
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    atob: (str) => Buffer.from(str, "base64").toString("binary"),
    btoa: (str) => Buffer.from(str, "binary").toString("base64"),
    crypto: {
      randomUUID: () => "00000000-0000-0000-0000-000000000001",
      getRandomValues: (arr) => arr,
    },
    setTimeout,
    clearTimeout,
    structuredClone,
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);

  const versionSrc = fs.readFileSync(repoRoot + "/js/version.js", "utf8");
  vm.runInContext(versionSrc, context);

  const utilsSrc = fs.readFileSync(repoRoot + "/js/utils.js", "utf8");
  vm.runInContext(utilsSrc, context);

  const configSrc = fs.readFileSync(repoRoot + "/js/supabase-config.js", "utf8");
  vm.runInContext(configSrc, context);

  const stateSrc = fs.readFileSync(repoRoot + "/js/state.js", "utf8");
  vm.runInContext(stateSrc, context);

  const clientSrc = fs.readFileSync(repoRoot + "/js/supabase-client.js", "utf8");
  vm.runInContext(clientSrc, context);

  if (loadReception) vm.runInContext(uiReceptionSource, context);

  return context;
}

function installSupabaseMock(ctx, { user, membership, membershipError = null, rpcResult = { data: {}, error: null } }) {
  const calls = { membership: 0, rpc: 0 };
  ctx.window.supabase = {
    createClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: user || null }, error: null }),
      },
      from: (table) => {
        assert.equal(table, "workshop_members");
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  calls.membership += 1;
                  return { data: membership || null, error: membershipError };
                },
              }),
            }),
          }),
        };
      },
      rpc: async (name, payload) => {
        calls.rpc += 1;
        calls.rpcName = name;
        calls.rpcPayload = payload;
        return rpcResult;
      },
    }),
  };
  return calls;
}

function prepareQualityUiContext(role = "controle_qualite") {
  const ctx = createAppContext({ loadReception: true });
  vm.runInContext(`
    state = normalizeState({
      users: [{
        id: "local-qc",
        authUserId: "auth-qc",
        email: "qc@nimr.tn",
        name: "Contrôle qualité",
        role: "controle_qualite",
        canonicalRole: "controle_qualite",
        active: true
      }],
      currentUserId: "local-qc",
      cases: [{
        id: "case-01",
        clientName: "Client",
        vehicle: "Véhicule",
        flags: { qualityApproved: false, delivered: false, workCompleted: true, workStarted: true },
        receptionWorkflow: { qualityStatus: "in_progress", qualityReviewHistory: [] },
        history: [],
        localRevision: 7
      }],
      auditLog: []
    });
    state.users[0].role = ${JSON.stringify(role)};
    state.users[0].canonicalRole = ${JSON.stringify(role)};
    __notifications = [];
    __saveCalls = [];
    __adoptCalls = [];
    __genericOutboxCreated = 0;
    __observedServerVersion = null;
    notifyUser = (message, level) => __notifications.push({ message, level });
    renderReceptionWorkspace = () => {};
    renderCases = () => {};
  `, ctx);
  return ctx;
}

function qualitySubmitEvent(ctx, status = "validated", reason = "") {
  const fields = {
    "[name=qualityStatus]": { value: status },
    "[name=qualityReason]": { value: reason },
  };
  const form = {
    id: "reception-quality-form",
    dataset: { caseId: "case-01" },
    querySelector: (selector) => fields[selector] || null,
  };
  ctx.__qualityEvent = { preventDefault() {}, target: form, currentTarget: form };
  return form;
}

// CHECK A: Release & Schema Baseline Constants
{
  const ctx = createAppContext();
  assert.equal(ctx.APP_VERSION, "v23.3.19", "APP_VERSION must be v23.3.19");
  assert.equal(ctx.NIMR_BUILD, "v23.3.19", "NIMR_BUILD must be v23.3.19");
  assert.equal(ctx.NIMR_CACHE_NAME, "nimr-sav-v23.3.19", "NIMR_CACHE_NAME must be nimr-sav-v23.3.19");

  const dbVersion = vm.runInContext("DB_VERSION", ctx);
  const schemaVersion = vm.runInContext("CURRENT_DATA_SCHEMA_VERSION", ctx);
  const taskModelVersion = vm.runInContext("CANONICAL_TASK_MODEL_VERSION", ctx);

  assert.equal(dbVersion, 2, "DB_VERSION must remain 2");
  assert.equal(schemaVersion, 2, "CURRENT_DATA_SCHEMA_VERSION must remain 2");
  assert.equal(taskModelVersion, 1, "CANONICAL_TASK_MODEL_VERSION must remain 1");
  console.log("PASS A Release and schema baseline constants");
}

// CHECK B: Canonical Role Parity (7 Roles Frontend & SQL)
{
  const ctx = createAppContext();
  const canonicalObj = vm.runInContext("CANONICAL_USER_ROLES", ctx) || {};
  const stateRoles = Object.keys(canonicalObj);
  for (const role of CANONICAL_ROLES_7) {
    assert.ok(stateRoles.includes(role), "Frontend CANONICAL_USER_ROLES missing " + role);
  }
  assert.equal(CANONICAL_ROLES_7.length, 7, "Exactly 7 canonical roles");
  assert.match(sqlMigration, /check\s*\(\s*role\s+in\s*\(\s*'admin_technique',\s*'directeur',\s*'chef_atelier',\s*'reception',\s*'technicien',\s*'controle_qualite',\s*'lecture_seule'\s*\)\s*\)/i);
  const executableSql = sqlMigration.replace(/^\s*--.*$/gm, "").trim();
  assert.match(executableSql, /^begin\s*;/i, "SEC-002 migration must begin transactionally");
  assert.match(sqlMigration, /commit\s*;\s*$/i, "SEC-002 migration must commit transactionally");
  const orderedMarkers = [
    "create or replace function public.nimr_canonical_role",
    "drop constraint if exists workshop_members_role_canonical_check",
    "add constraint workshop_members_role_canonical_check",
    "update public.workshop_members",
    "validate constraint workshop_members_role_canonical_check",
    "create or replace function public.nimr_apply_quality_review_v1",
    "revoke all on function public.nimr_apply_quality_review_v1",
    "grant execute on function public.nimr_apply_quality_review_v1",
    "commit;",
  ];
  let previousPosition = -1;
  for (const marker of orderedMarkers) {
    const position = sqlMigration.toLowerCase().indexOf(marker);
    assert.ok(position > previousPosition, `Unsafe migration order near: ${marker}`);
    previousPosition = position;
  }
  assert.match(sqlMigration, /add constraint workshop_members_role_canonical_check[\s\S]*?not valid\s*;/i);
  console.log("PASS B Canonical role parity (7 roles Frontend and SQL)");
}

// CHECK C: SQL Canonical Alias Normalization
{
  const canonicalFunction = sqlMigration.match(/create or replace function public\.nimr_canonical_role[\s\S]*?\$nimr\$\s*;/i)?.[0] || "";
  const aliases = [...canonicalFunction.matchAll(/when\s+'([^']+)'\s+then\s+'([^']+)'/gi)]
    .map((match) => `${match[1]}=>${match[2]}`);
  assert.deepEqual(aliases, [
    "admin=>admin_technique",
    "admin_technique=>admin_technique",
    "directeur=>directeur",
    "directeur_sav=>directeur",
    "chef_atelier=>chef_atelier",
    "reception=>reception",
    "receptionnaire=>reception",
    "technicien=>technicien",
    "technician=>technicien",
    "controle_qualite=>controle_qualite",
    "controleur_qualite=>controle_qualite",
    "quality_controller=>controle_qualite",
    "qualite=>controle_qualite",
    "lecture_seule=>lecture_seule",
    "readonly=>lecture_seule",
    "member=>lecture_seule",
  ], "Only the historical aliases plus explicit SEC-002 QC aliases are allowed");
  assert.doesNotMatch(sqlMigration, /when\s+'qualite'\s+then\s+'lecture_seule'/i);
  assert.doesNotMatch(canonicalFunction, /\b(direction|directeur_general|chef_d_atelier|chef|reception_atelier|mecanicien|carrossier|peintre|visiteur|consultation|invite)\b/i);
  const roleUpdate = sqlMigration.match(/update public\.workshop_members[\s\S]*?;/i)?.[0] || "";
  assert.match(roleUpdate, /where role in\s*\(\s*'controleur_qualite',\s*'quality_controller',\s*'qualite'\s*\)/i);
  assert.doesNotMatch(roleUpdate, /lecture_seule/i, "Existing lecture_seule rows must never be bulk converted");
  console.log("PASS C SQL canonical alias normalization");
}

// CHECK D: Membership Resolver Accepts controle_qualite
{
  const ctx = createAppContext();
  let queriedRole = "controle_qualite";
  ctx.window.supabase = {
    createClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: "user-qc-01", email: "qc@nimr.tn" } }, error: null }),
      },
      from: (table) => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { workshop_id: "00000000-0000-0000-0000-000000000001", user_id: "user-qc-01", role: queriedRole, resource_id: null },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
  };
  const res = await vm.runInContext('resolveSupabaseWorkshopMembership({ id: "user-qc-01", email: "qc@nimr.tn" })', ctx);
  assert.equal(res.ok, true);
  assert.equal(res.membership.role, "controle_qualite");
  const syncRes = vm.runInContext('syncLocalUserFromSupabaseMembership({ id: "user-qc-01", email: "qc@nimr.tn", user_metadata: { name: "Contrôleur Qualité" } }, ' + JSON.stringify(res.membership) + ')', ctx);
  assert.equal(syncRes.ok, true);
  assert.equal(syncRes.user.canonicalRole, "controle_qualite");
  console.log("PASS D Membership resolver accepts controle_qualite");
}

// CHECK E: No Privilege Broadening in Generic Sync or Planning
{
  const p010Sql = fs.readFileSync(repoRoot + "/supabase_p0_010_offline_concurrency.sql", "utf8");
  const matchGenericRoles = p010Sql.match(/nimr_has_workshop_role\s*\(\s*p_workshop_id\s*,\s*array\[([^\]]+)\]/i);
  assert.ok(matchGenericRoles);
  assert.doesNotMatch(matchGenericRoles[1], /'controle_qualite'/i);
  const sec002Sql = fs.readFileSync(repoRoot + "/supabase_sec_002_server_client_role_parity.sql", "utf8");
  assert.doesNotMatch(sec002Sql, /grant\s+insert\s+on\s+public\.planning/i);
  assert.doesNotMatch(sec002Sql, /grant\s+insert\s+on\s+public\.resources/i);
  assert.doesNotMatch(sec002Sql, /grant\s+insert\s+on\s+public\.app_settings/i);
  assert.doesNotMatch(sec002Sql, /grant\s+insert\s+on\s+public\.cloud_backups/i);
  console.log("PASS E No privilege broadening in generic sync or planning");
}

// CHECK F: Dedicated QC RPC Role Gate
{
  const rpcRoleMatch = sqlMigration.match(/nimr_apply_quality_review_v1[\s\S]*?nimr_has_workshop_role\s*\(\s*p_workshop_id\s*,\s*array\[([^\]]+)\]/i);
  assert.ok(rpcRoleMatch);
  const allowedRoles = rpcRoleMatch[1].toLowerCase();
  assert.ok(allowedRoles.includes("'admin_technique'"));
  assert.ok(allowedRoles.includes("'directeur'"));
  assert.ok(allowedRoles.includes("'chef_atelier'"));
  assert.ok(allowedRoles.includes("'controle_qualite'"));
  assert.ok(!allowedRoles.includes("'reception'"));
  assert.ok(!allowedRoles.includes("'technicien'"));
  assert.ok(!allowedRoles.includes("'lecture_seule'"));
  assert.match(sqlMigration, /p_operation_id\s+text\s*\)/i, "operation_id must not have a default");
  assert.doesNotMatch(sqlMigration, /p_operation_id\s+text\s+default/i);
  assert.match(sqlMigration, /nullif\s*\(\s*trim\s*\(\s*p_operation_id\s*\)\s*,\s*''\s*\)\s+is\s+null/i);
  assert.match(sqlMigration, /op_id\s*:=\s*'quality-review:'\s*\|\|\s*trim\s*\(\s*p_operation_id\s*\)/i);
  assert.doesNotMatch(sqlMigration, /gen_random_uuid/i, "Server must not invent a QC operation ID");
  assert.ok((sqlMigration.match(/quality review receipt target mismatch/gi) || []).length >= 2, "Receipt target must be checked before and after the lock");
  console.log("PASS F Dedicated QC RPC role gate");
}

// CHECK G: Payload Confinement
{
  assert.match(sqlMigration, /current_payload\s*:=\s*coalesce\s*\(\s*current_row\.payload/i);
  assert.match(sqlMigration, /jsonb_set\s*\(\s*current_payload\s*,\s*'\{receptionWorkflow\}'/i);
  assert.match(sqlMigration, /jsonb_set\s*\(\s*current_payload\s*,\s*'\{flags\}'/i);
  assert.doesNotMatch(sqlMigration, /current_payload\s*:=\s*p_payload/i);
  const workflowFields = [
    "qualityStatus",
    "qualityReviewedAt",
    "qualityReviewHistory",
    "readyForDeliveryAt",
    "qualityRevalidatedAt",
    "qualityReturnRequestedAt",
    "qualityReturnReason",
    "qualityReworkStartedAt",
    "sentToWorkshopAt",
  ];
  for (const field of workflowFields) {
    assert.match(sqlMigration, new RegExp(`jsonb_set\\s*\\(\\s*reception_workflow\\s*,\\s*'\\{${field}\\}'`, "i"), `${field} must be patched inside receptionWorkflow`);
    assert.doesNotMatch(sqlMigration, new RegExp(`jsonb_set\\s*\\(\\s*current_payload\\s*,\\s*'\\{${field}\\}'`, "i"), `${field} must not be written at case root`);
  }
  const flagFields = [...sqlMigration.matchAll(/jsonb_set\s*\(\s*flags\s*,\s*'\{([^}]+)\}'/gi)].map((match) => match[1]);
  assert.deepEqual([...new Set(flagFields)].sort(), ["delivered", "qualityApproved", "workCompleted", "workStarted"].sort());
  assert.ok(sqlMigration.lastIndexOf("current_payload := jsonb_set(current_payload, '{receptionWorkflow}', reception_workflow);")
    > sqlMigration.lastIndexOf("current_payload := jsonb_set(current_payload, '{flags}', flags);"), "receptionWorkflow must be the final payload patch");
  console.log("PASS G Payload confinement");
}

// CHECK H: Quality Transition Rules in SQL RPC
{
  assert.match(sqlMigration, /clean_status\s*=\s*'rejected'\s+and\s+clean_reason\s*=\s*''/i);
  assert.match(sqlMigration, /clean_status\s*=\s*'validated'[\s\S]*?flags\s*:=\s*jsonb_set\s*\(\s*flags\s*,\s*'\{qualityApproved\}'\s*,\s*'true'::jsonb\s*\)/i);
  assert.match(sqlMigration, /flags\s*:=\s*jsonb_set\s*\(\s*flags\s*,\s*'\{qualityApproved\}'\s*,\s*'false'::jsonb\s*\)/i);
  assert.match(sqlMigration, /clean_status\s*=\s*'rework'[\s\S]*?\{workCompleted\}'[\s\S]*?'false'::jsonb/i);
  assert.match(sqlMigration, /clean_status\s*=\s*'rework'[\s\S]*?\{workStarted\}'[\s\S]*?'true'::jsonb/i);
  console.log("PASS H Quality transition rules in SQL RPC");
}

// CHECK I: Server Identity & Timestamp Authority
{
  assert.match(sqlMigration, /auth\.uid\(\)\s+is\s+null/i);
  assert.match(sqlMigration, /'by',\s*auth\.uid\(\)::text/i);
  assert.match(sqlMigration, /now_value\s+timestamptz\s*:=\s*clock_timestamp\(\)/i);
  const receiptInsert = sqlMigration.match(/insert into public\.sync_entity_operation_receipts\s*\(([^)]+)\)/i)?.[1] || "";
  assert.deepEqual(receiptInsert.split(",").map((column) => column.trim()), [
    "workshop_id",
    "local_operation_id",
    "entity_type",
    "entity_id",
    "accepted_version",
    "accepted_at",
  ]);
  assert.doesNotMatch(receiptInsert, /actor_user_id/i);
  assert.doesNotMatch(sqlMigration, /actor_user_id/i);
  console.log("PASS I Server identity and timestamp authority");
}

// CHECK J: QC RPC Helper Fails Closed Before Server Invocation
{
  const offlineCtx = createAppContext();
  offlineCtx.navigator.onLine = false;
  const offline = await vm.runInContext('submitSupabaseQualityReview({ caseId: "case-01", status: "validated", operationId: "op-offline" })', offlineCtx);
  assert.equal(offline.ok, false);
  assert.equal(offline.code, "OFFLINE_NOT_ALLOWED");

  const unauthCtx = createAppContext();
  const unauthCalls = installSupabaseMock(unauthCtx, { user: null, membership: null });
  const unauth = await vm.runInContext('submitSupabaseQualityReview({ caseId: "case-01", status: "validated", operationId: "op-unauth" })', unauthCtx);
  assert.equal(unauth.ok, false);
  assert.equal(unauth.code, "UNAUTHENTICATED");
  assert.equal(unauthCalls.membership, 0);
  assert.equal(unauthCalls.rpc, 0);

  const invalidMembershipCtx = createAppContext();
  const invalidMembershipCalls = installSupabaseMock(invalidMembershipCtx, {
    user: { id: "auth-qc", email: "qc@nimr.tn" },
    membership: null,
  });
  const invalidMembership = await vm.runInContext('submitSupabaseQualityReview({ caseId: "case-01", status: "validated", operationId: "op-invalid-membership" })', invalidMembershipCtx);
  assert.equal(invalidMembership.ok, false);
  assert.equal(invalidMembership.code, "NOT_A_MEMBER");
  assert.equal(invalidMembershipCalls.rpc, 0);

  const mismatchedMembershipCtx = createAppContext();
  const mismatchedCalls = installSupabaseMock(mismatchedMembershipCtx, {
    user: { id: "auth-qc", email: "qc@nimr.tn" },
    membership: {
      workshop_id: "00000000-0000-0000-0000-000000000001",
      user_id: "auth-other",
      role: "controle_qualite",
      resource_id: null,
    },
  });
  const mismatched = await vm.runInContext('submitSupabaseQualityReview({ caseId: "case-01", status: "validated", operationId: "op-mismatch" })', mismatchedMembershipCtx);
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.code, "MEMBERSHIP_IDENTITY_MISMATCH");
  assert.equal(mismatchedCalls.rpc, 0);

  const validCtx = createAppContext();
  const validCalls = installSupabaseMock(validCtx, {
    user: { id: "auth-qc", email: "qc@nimr.tn" },
    membership: {
      workshop_id: "00000000-0000-0000-0000-000000000001",
      user_id: "auth-qc",
      role: "controle_qualite",
      resource_id: null,
    },
    rpcResult: { data: { accepted: true }, error: null },
  });
  const missingOperation = await vm.runInContext('submitSupabaseQualityReview({ caseId: "case-01", status: "validated" })', validCtx);
  assert.equal(missingOperation.ok, false);
  assert.equal(missingOperation.code, "OPERATION_ID_REQUIRED");
  assert.equal(validCalls.rpc, 0);
  const valid = await vm.runInContext('submitSupabaseQualityReview({ caseId: "case-01", status: "validated", operationId: "op-valid" })', validCtx);
  assert.equal(valid.ok, true);
  assert.equal(validCalls.rpc, 1);
  assert.equal(validCalls.rpcName, "nimr_apply_quality_review_v1");
  assert.equal(validCalls.rpcPayload.p_operation_id, "op-valid");
  console.log("PASS J QC RPC helper fails closed before server invocation");
}

// CHECK K: Generic Permissions and Dedicated QC UI Mutation Isolation
{
  const ctx = createAppContext();
  const checkPerm = (role, perm) => {
    return vm.runInContext(
      '(() => { state = normalizeState({ users: [{ id: "u1", name: "User", role: "' + role + '", active: true }], currentUserId: "u1" }); return hasPermission("' + perm + '"); })()',
      ctx
    );
  };
  assert.equal(checkPerm("controle_qualite", "quality.validate"), true);
  assert.equal(checkPerm("controle_qualite", "quality.reject"), true);
  assert.equal(checkPerm("controle_qualite", "planning.edit"), false);
  assert.equal(checkPerm("controle_qualite", "users.manage"), false);
  assert.equal(checkPerm("controle_qualite", "supabase.configure"), false);
  assert.equal(checkPerm("admin_technique", "quality.validate"), true);
  assert.equal(checkPerm("directeur", "quality.validate"), true);
  assert.equal(checkPerm("chef_atelier", "quality.validate"), true);
  assert.equal(checkPerm("reception", "quality.validate"), false);
  assert.equal(checkPerm("technicien", "quality.validate"), false);
  assert.equal(checkPerm("lecture_seule", "quality.validate"), false);

  assert.match(supabaseClientSource, /resolveSupabaseWorkshopMembership\s*\(\s*authUser\s*\)/u);
  const dedicatedRolePredicate = uiReceptionSource.match(/const usesDedicatedQualityRpc\s*=\s*([^;]+);/u)?.[1]?.replace(/\s+/gu, " ").trim();
  assert.equal(dedicatedRolePredicate, 'canonicalRole === "controle_qualite"', "Only controle_qualite may use the dedicated QC frontend route");
  const controllerPathStart = uiReceptionSource.indexOf("if (usesDedicatedQualityRpc) {");
  const legacyQualityPathStart = uiReceptionSource.indexOf('const result = advanceReceptionWorkflow(caseId, "update_quality_status"', controllerPathStart);
  assert.ok(controllerPathStart >= 0 && legacyQualityPathStart > controllerPathStart);
  assert.doesNotMatch(uiReceptionSource.slice(controllerPathStart, legacyQualityPathStart), /advanceReceptionWorkflow/u);
  assert.match(uiReceptionSource, /applyRemoteEntityRow\s*\(\s*\{\s*\.\.\.canonical\s*,\s*entity_version:\s*serverVersion\s*\}\s*,\s*\{\s*force:\s*true\s*\}\s*\)/u);
  assert.match(supabaseSyncSource, /async function applyRemoteEntityRow[\s\S]*?rememberObservedGranularEntityMetadata\s*\(\s*observed\s*\)/u);

  const frontendRouteResults = {};
  for (const role of ["controle_qualite", "admin_technique", "directeur", "chef_atelier"]) {
    const routeCtx = prepareQualityUiContext(role);
    qualitySubmitEvent(routeCtx);
    vm.runInContext(`
      navigator.onLine = false;
      __advanceCalls = 0;
      __rpcCalls = 0;
      advanceReceptionWorkflow = () => { __advanceCalls += 1; return { ok: true }; };
      submitSupabaseQualityReview = async () => { __rpcCalls += 1; return { ok: false, message: "must not reach RPC while offline" }; };
      applyRemoteEntityRow = async () => { throw new Error("must not adopt"); };
      saveState = (options) => {
        __saveCalls.push(options);
        if (!options?.skipCloud) __genericOutboxCreated += 1;
        return true;
      };
    `, routeCtx);
    await vm.runInContext("handleReceptionFormSubmit(__qualityEvent)", routeCtx);
    frontendRouteResults[role] = {
      advanceCalls: routeCtx.__advanceCalls,
      rpcCalls: routeCtx.__rpcCalls,
      saveCalls: routeCtx.__saveCalls,
      notifications: routeCtx.__notifications,
    };
  }

  const qualityControllerRoute = frontendRouteResults.controle_qualite;
  assert.equal(qualityControllerRoute.advanceCalls, 0, "controle_qualite must not use the legacy QC mutation path");
  assert.equal(qualityControllerRoute.rpcCalls, 0, "Offline controle_qualite must be denied before the dedicated RPC call");
  assert.equal(qualityControllerRoute.saveCalls.length, 0, "Offline controle_qualite denial must not persist");
  assert.match(qualityControllerRoute.notifications.at(-1).message, /Connexion internet requise/i);

  for (const role of ["admin_technique", "directeur", "chef_atelier"]) {
    const route = frontendRouteResults[role];
    assert.equal(route.advanceCalls, 1, `${role} must retain the legacy QC mutation path while offline`);
    assert.equal(route.rpcCalls, 0, `${role} must not use the dedicated QC RPC frontend path`);
    assert.equal(route.saveCalls.length, 1, `${role} must retain legacy QC persistence behavior while offline`);
    assert.equal(route.saveCalls[0].flushCloud, true, `${role} legacy QC persistence must remain unchanged`);
  }

  console.log("  QUALITY_CONTROLLER_USES_DEDICATED_RPC = YES");
  console.log("  ADMIN_USES_DEDICATED_RPC = NO");
  console.log("  DIRECTOR_USES_DEDICATED_RPC = NO");
  console.log("  CHEF_ATELIER_USES_DEDICATED_RPC = NO");
  console.log("  QUALITY_CONTROLLER_OFFLINE = DENIED");
  console.log("  ADMIN_OFFLINE_QC_REGRESSION = NO");
  console.log("  DIRECTOR_OFFLINE_QC_REGRESSION = NO");
  console.log("  CHEF_ATELIER_OFFLINE_QC_REGRESSION = NO");

  const failureCtx = prepareQualityUiContext();
  qualitySubmitEvent(failureCtx, "rejected", "Défaut peinture");
  vm.runInContext(`
    __advanceCalls = 0;
    advanceReceptionWorkflow = () => { __advanceCalls += 1; throw new Error("must not mutate"); };
    submitSupabaseQualityReview = async () => ({ ok: false, code: "RPC_ERROR", message: "refused" });
    applyRemoteEntityRow = async () => { throw new Error("must not adopt refused RPC"); };
    saveState = async (options) => {
      __saveCalls.push(options);
      if (!options?.skipCloud) __genericOutboxCreated += 1;
      return true;
    };
  `, failureCtx);
  const beforeFailure = vm.runInContext('JSON.stringify({ item: state.cases[0], auditLog: state.auditLog })', failureCtx);
  await vm.runInContext("handleReceptionFormSubmit(__qualityEvent)", failureCtx);
  const afterFailure = vm.runInContext('JSON.stringify({ item: state.cases[0], auditLog: state.auditLog })', failureCtx);
  assert.equal(afterFailure, beforeFailure, "RPC refusal must not mutate case, history, audit, or revision");
  assert.equal(failureCtx.__advanceCalls, 0, "Real state workflow engine must not run before RPC");
  assert.equal(failureCtx.__saveCalls.length, 0, "RPC refusal must not persist a false mutation");
  assert.equal(failureCtx.__genericOutboxCreated, 0, "RPC refusal must not create a generic outbox operation");

  const missingHelperCtx = prepareQualityUiContext();
  qualitySubmitEvent(missingHelperCtx);
  vm.runInContext(`
    submitSupabaseQualityReview = undefined;
    applyRemoteEntityRow = async () => true;
    saveState = async (options) => { __saveCalls.push(options); return true; };
  `, missingHelperCtx);
  const beforeMissingHelper = vm.runInContext("JSON.stringify(state.cases[0])", missingHelperCtx);
  await vm.runInContext("handleReceptionFormSubmit(__qualityEvent)", missingHelperCtx);
  assert.equal(vm.runInContext("JSON.stringify(state.cases[0])", missingHelperCtx), beforeMissingHelper);
  assert.equal(missingHelperCtx.__saveCalls.length, 0);
  assert.match(missingHelperCtx.__notifications.at(-1).message, /Erreur technique.*service serveur/i);

  const successCtx = prepareQualityUiContext();
  qualitySubmitEvent(successCtx);
  vm.runInContext(`
    __canonicalPayload = JSON.parse(JSON.stringify(state.cases[0]));
    __canonicalPayload.receptionWorkflow.qualityStatus = "validated";
    __canonicalPayload.receptionWorkflow.qualityReviewedAt = "2026-08-30T12:00:00.000Z";
    __canonicalPayload.flags.qualityApproved = true;
    submitSupabaseQualityReview = async () => ({
      ok: true,
      data: {
        accepted: true,
        accepted_version: 42,
        server_version: 42,
        canonical: {
          workshop_id: "00000000-0000-0000-0000-000000000001",
          entity_type: "case",
          entity_id: "case-01",
          payload: __canonicalPayload,
          server_version: 42,
          last_operation_id: "quality-review:qc-op-test",
          updated_at: "2026-08-30T12:00:00.000Z"
        }
      }
    });
    applyRemoteEntityRow = async (row, options) => {
      __adoptCalls.push({ row, options });
      state.cases[0] = { ...row.payload, id: row.entity_id };
      __observedServerVersion = row.entity_version;
      return true;
    };
    saveState = async (options) => {
      __saveCalls.push(options);
      if (!options?.skipCloud) __genericOutboxCreated += 1;
      return true;
    };
  `, successCtx);
  await vm.runInContext("handleReceptionFormSubmit(__qualityEvent)", successCtx);
  assert.equal(vm.runInContext("state.cases[0].receptionWorkflow.qualityStatus", successCtx), "validated");
  assert.equal(successCtx.__adoptCalls.length, 1);
  assert.equal(successCtx.__adoptCalls[0].options.force, true);
  assert.equal(successCtx.__observedServerVersion, 42, "Canonical server version must enter P0-010 adoption");
  assert.equal(successCtx.__genericOutboxCreated, 0, "Canonical adoption must not create a generic outbox operation");
  assert.ok(successCtx.__saveCalls.length > 0);
  assert.ok(successCtx.__saveCalls.every((options) => options.skipCloud === true && options.flushCloud !== true));
  console.log("PASS K Generic permissions and dedicated QC UI mutation isolation");
}

console.log("\nALL 11 SEC-002 CHECKS PASSED (11/11 PASS)\n");
