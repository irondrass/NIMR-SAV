import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const BASE_SHA = "4d57a8e23e4161cdbd065daaebfc979c490c9c5b";
const browserSmokeRequested = process.argv.includes("--browser-smoke");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readBaseFile(relativePath) {
  return execFileSync("git", ["show", `${BASE_SHA}:${relativePath.replaceAll("\\", "/")}`], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 40 * 1024 * 1024,
  });
}

function normalizeEol(value) {
  return String(value).replaceAll("\r\n", "\n");
}

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

const appSource = readProjectFile("app.js");
const indexSource = readProjectFile("index.html");
const stateSource = readProjectFile("js/state.js");
const uiPlanningSource = readProjectFile("js/ui-planning.js");
const uiCasesSource = readProjectFile("js/ui-cases.js");
const versionSource = readProjectFile("js/version.js");
const estimateImportSource = readProjectFile("js/estimate-import.js");
const offlineSource = readProjectFile("offline.html");
const stylesSource = readProjectFile("styles.css");
const swSource = readProjectFile("sw.js");

const passed = [];
const failures = [];

function check(name, callback) {
  try {
    callback();
    passed.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL ${name}: ${String(error.message || error).split(/Input:\s*$/mu)[0].trim()}`);
  }
}

function createIdentityContext(filename) {
  return createNimrVmContext({ filename });
}

check("A v23.3.20 is exact and schema constants are unchanged", () => {
  assert.match(versionSource, /^window\.APP_VERSION = "v23\.3\.20";$/mu);
  assert.match(versionSource, /^window\.NIMR_BUILD = "v23\.3\.20";$/mu);
  assert.match(versionSource, /^window\.NIMR_CACHE_NAME = "nimr-sav-v23\.3\.20";$/mu);
  assert.match(stateSource, /^const APP_VERSION = "v23\.3\.20";$/mu);
  assert.match(stateSource, /^const DB_VERSION = 2;$/mu);
  assert.match(stateSource, /^const CURRENT_DATA_SCHEMA_VERSION = 2;$/mu);
  assert.match(stateSource, /^const CANONICAL_TASK_MODEL_VERSION = 1;$/mu);
  assert.match(swSource, /^const CACHE_NAME = "nimr-sav-v23\.3\.20";$/mu);
  assert.match(appSource, /pdf\.worker\.min\.js\?v=23\.3\.20/u);
  assert.match(appSource, /sw\.js\?v=23\.3\.20/u);
  assert.match(estimateImportSource, /pdf\.worker\.min\.js\?v=23\.3\.20/u);
  assert.match(indexSource, /styles\.css\?v=23\.3\.20/u);
  assert.match(indexSource, /app\.js\?v=23\.3\.20/u);
  assert.match(offlineSource, /styles\.css\?v=23\.3\.20/u);
  assert.doesNotMatch([appSource, indexSource, stateSource, versionSource, estimateImportSource, offlineSource, swSource].join("\n"), /23\.3\.18/u);
});

check("B Comptes & accès exists inside Paramètres without a new navigation permission or tab", () => {
  const settingsStart = indexSource.indexOf('id="settings-workspace-administration"');
  const settingsEnd = indexSource.indexOf('</main>', settingsStart);
  const accountsPosition = indexSource.indexOf('<h1>Comptes & accès</h1>');
  assert.ok(settingsStart >= 0 && settingsEnd > settingsStart);
  assert.ok(accountsPosition > settingsStart && accountsPosition < settingsEnd);
  assert.equal((indexSource.match(/<h1>Comptes & accès<\/h1>/gu) || []).length, 1);
  assert.equal((indexSource.match(/data-settings-workspace="/gu) || []).length, 2);
  assert.doesNotMatch(indexSource, /data-tab="(?:accounts|comptes|access|acces)"/iu);
});

check("C Permission matrices and role navigation contracts remain identical to base", () => {
  const baseState = readBaseFile("js/state.js");
  for (const [start, end] of [
    ["const DIRECTOR_PERMISSIONS", "const READ_ONLY_PERMISSIONS"],
    ["const ROLE_PERMISSIONS", "const MUTATION_PERMISSIONS"],
    ["const ROLE_TABS", "// Tab par défaut"],
    ["const ROLE_DEFAULT_TABS", "// v23.2.5"],
  ]) {
    assert.equal(normalizeEol(sourceSlice(stateSource, start, end)), normalizeEol(sourceSlice(baseState, start, end)), start);
  }
});

check("D Account snapshot is read-only and server membership remains the online authority", () => {
  const { context, run } = createIdentityContext("identity001a-authority.js");
  run(`state = normalizeState({
    users: [{ id: "local-admin", authUserId: "auth-1", name: "Miroir local", email: "user@example.test", role: "admin_technique", active: true }],
    currentUserId: "local-admin",
    resources: [], cases: [], bookings: []
  });
  __identityBefore = JSON.stringify(state);
  __identitySnapshot = getAccountAccessSnapshot({
    online: true,
    workshopId: "workshop-1",
    authIdentity: { id: "auth-1", email: "user@example.test", user_metadata: { role: "admin_technique" } },
    serverMembership: { workshop_id: "workshop-1", user_id: "auth-1", role: "reception", resource_id: null }
  });
  __wrongWorkshopSnapshot = getAccountAccessSnapshot({
    online: true,
    workshopId: "workshop-1",
    authIdentity: { id: "auth-1", email: "user@example.test" },
    serverMembership: { workshop_id: "other-workshop", user_id: "auth-1", role: "reception", resource_id: null }
  });`);
  const snapshot = JSON.parse(run("JSON.stringify(__identitySnapshot)"));
  assert.equal(snapshot.serverRole, "reception");
  assert.equal(snapshot.localRole, "admin_technique");
  assert.equal(snapshot.roleParity, "warning");
  assert.equal(snapshot.serverAuthorityActive, true);
  assert.ok(snapshot.issues.some((issue) => issue.code === "ROLE_PARITY_MISMATCH"));
  assert.equal(run("__wrongWorkshopSnapshot.membershipStatus"), "not_authorized");
  assert.equal(run("__wrongWorkshopSnapshot.issues.some((issue) => issue.code === 'MEMBERSHIP_WORKSHOP_MISMATCH')"), true);
  assert.equal(run("JSON.stringify(state)"), run("__identityBefore"));
  assert.equal(run("Object.hasOwn(state, 'accountAccess')"), false);
  assert.deepEqual(Object.keys(snapshot.authIdentity).sort(), ["email", "id"]);
  assert.match(stateSource, /function getAccountAccessSnapshot\(options = \{\}\)/u);
});

check("E Local profiles are explicitly mirrors and never presented as server account creation", () => {
  assert.match(indexSource, /Source : Miroir local/u);
  assert.match(indexSource, /Les droits réels en ligne proviennent du compte Supabase et de l'appartenance atelier\./u);
  assert.match(indexSource, /Ce profil local ne crée pas de compte Supabase\./u);
  assert.match(indexSource, /Ajouter un profil local/u);
  assert.doesNotMatch(indexSource, /Ajouter l'utilisateur/u);
  assert.match(appSource, /Profil local créé\./u);
});

check("F Local PIN is identified as workstation protection, not server authentication", () => {
  assert.match(indexSource, /PIN local — protection du poste/u);
  assert.match(indexSource, /Le PIN protège l’interface locale, mais ne chiffre pas les données locales et ne remplace pas une authentification serveur\./u);
  assert.match(indexSource, /Mot de passe Supabase/u);
  assert.match(indexSource, /id="local-pin-form"/u);
  assert.match(stateSource, /saveState\(\{ skipCloud: true, skipSnapshot: true \}\)/u);
});

check("G Online authority blocks selector impersonation and server-managed mirror mutation", () => {
  const selectorHandler = sourceSlice(appSource, '$("#current-user-selector")?.addEventListener("change"', "bindWorkHoursInputs();");
  assert.match(selectorHandler, /validatedOnlineIdentity/u);
  assert.match(selectorHandler, /hasValidatedOnlineServerAuthority/u);
  assert.match(selectorHandler, /Identité serveur inchangée/u);
  assert.ok(selectorHandler.indexOf("if (validatedOnlineIdentity)") < selectorHandler.indexOf("setCurrentUser(newUserId)"));
  const userFormHandler = sourceSlice(appSource, '$("#user-form")?.addEventListener("submit"', '$("#user-cancel-btn")?.addEventListener("click"');
  assert.ok(userFormHandler.indexOf("if (!result.ok)") < userFormHandler.indexOf("saveState()"));
  const updateUserSource = sourceSlice(stateSource, "function updateUserLocal", "function resolvePermissionUser");
  assert.match(updateUserSource, /SERVER_MANAGED_PROFILE_READ_ONLY/u);
  assert.ok(updateUserSource.indexOf("hasValidatedOnlineServerAuthority()") < updateUserSource.indexOf("user.name = name"));
  assert.match(uiPlanningSource, /Géré par Supabase/u);
  assert.match(uiPlanningSource, /mutationDisabled/u);
  assert.match(uiPlanningSource, /switcher\.disabled = onlineAuthority \|\| !canManageUsers/u);
  assert.match(indexSource, /Profil local actif — LOCAL \/ HORS LIGNE/u);
  assert.doesNotMatch(indexSource, /simuler ou basculer les permissions locales/u);

  const { run } = createIdentityContext("identity001a-server-managed-mutation.js");
  run(`state = normalizeState({
    resources: [{ id: "resource-local", name: "Ressource locale", role: "tolier", active: true }],
    users: [
      {
        id: "server-mirror", authUserId: "auth-admin", authSource: "supabase_membership",
        membershipWorkshopId: "workshop-1", membershipValidatedAt: "2026-08-31T12:00:00.000Z",
        name: "Admin miroir", email: "admin@example.test", role: "admin_technique", resourceId: "", active: true
      },
      { id: "pure-local", name: "Profil local", email: "local@example.test", role: "reception", resourceId: "", active: true }
    ],
    currentUserId: "server-mirror", cases: [], bookings: []
  });
  navigator.onLine = true;
  setAccountAccessRuntimeContext(
    { id: "auth-admin", email: "admin@example.test" },
    { workshop_id: "workshop-1", user_id: "auth-admin", role: "admin_technique", resource_id: null }
  );
  window.__nimrValidatedAuthUserId = "auth-admin";
  __beforeManagedMutation = JSON.stringify(state);
  __managedMutation = updateUserLocal("server-mirror", {
    name: "Nom falsifié", role: "reception", email: "changed@example.test",
    resourceId: "resource-local", active: false, authUserId: "changed-auth"
  });
  __afterManagedMutation = JSON.stringify(state);
  __beforeResourceStatusMutation = JSON.stringify(state);
  __resourceStatusMutation = updateUserLocal("server-mirror", {
    name: "Admin miroir", role: "admin_technique", email: "admin@example.test",
    resourceId: "resource-local", active: false
  });
  __afterResourceStatusMutation = JSON.stringify(state);
  __pureLocalMutation = updateUserLocal("pure-local", {
    name: "Profil local ajusté", role: "reception", email: "local.updated@example.test",
    resourceId: "", active: true
  });`);
  assert.equal(run("hasValidatedOnlineServerAuthority()"), true);
  assert.equal(run("__managedMutation.ok"), false);
  assert.equal(run("__managedMutation.code"), "SERVER_MANAGED_PROFILE_READ_ONLY");
  assert.equal(run("__beforeManagedMutation === __afterManagedMutation"), true);
  assert.equal(run("getUserById('server-mirror').role"), "admin_technique");
  assert.equal(run("state.currentUserId"), "server-mirror");
  assert.equal(run("__resourceStatusMutation.ok"), false);
  assert.equal(run("__resourceStatusMutation.code"), "SERVER_MANAGED_PROFILE_READ_ONLY");
  assert.equal(run("__beforeResourceStatusMutation === __afterResourceStatusMutation"), true);
  assert.equal(run("__pureLocalMutation.ok"), true);
  assert.equal(run("getUserById('pure-local').name"), "Profil local ajusté");
  assert.equal(run("getUserById('pure-local').email"), "local.updated@example.test");
  run("navigator.onLine = false;");
  assert.equal(run("hasValidatedOnlineServerAuthority()"), false);
});

check("H Technician membership is healthy only with a valid active human resource", () => {
  const { run } = createIdentityContext("identity001a-technician-human.js");
  run(`state = normalizeState({
    resources: [{ id: "tech-human", name: "Amine", role: "tolier", active: true }],
    users: [{ id: "local-tech", authUserId: "auth-tech", name: "Amine", role: "technicien", resourceId: "tech-human", active: true }],
    currentUserId: "local-tech", cases: [], bookings: []
  });
  __snapshot = getAccountAccessSnapshot({
    online: true,
    workshopId: "workshop-1",
    authIdentity: { id: "auth-tech", email: "tech@example.test" },
    serverMembership: { workshop_id: "workshop-1", user_id: "auth-tech", role: "technicien", resource_id: "tech-human" }
  });`);
  assert.equal(run("__snapshot.technicianResourceStatus"), "valid");
  assert.equal(run("__snapshot.overallStatus"), "active");
  assert.equal(run("__snapshot.resource.role"), "tolier");
  assert.equal(run("__snapshot.issues.some((issue) => issue.severity === 'error')"), false);
});

check("I Equipment resource is rejected as technician identity linkage", () => {
  const { run } = createIdentityContext("identity001a-technician-equipment.js");
  run(`state = normalizeState({
    resources: [{ id: "paint-booth", name: "Cabine", role: "cabine", active: true }],
    users: [{ id: "local-tech", authUserId: "auth-tech", name: "Tech", role: "technicien", resourceId: "paint-booth", active: true }],
    currentUserId: "local-tech", cases: [], bookings: []
  });
  __before = JSON.stringify(state);
  __snapshot = getAccountAccessSnapshot({
    online: true,
    workshopId: "workshop-1",
    authIdentity: { id: "auth-tech", email: "tech@example.test" },
    serverMembership: { workshop_id: "workshop-1", user_id: "auth-tech", role: "technicien", resource_id: "paint-booth" }
  });`);
  assert.equal(run("__snapshot.technicianResourceStatus"), "equipment");
  assert.equal(run("__snapshot.overallStatus"), "resource_missing");
  assert.equal(run("__snapshot.issues.some((issue) => issue.code === 'TECHNICIAN_RESOURCE_EQUIPMENT')"), true);
  assert.equal(run("JSON.stringify(state)"), run("__before"));
});

check("J Role/resource mismatch and duplicate linkage diagnose without mutation", () => {
  const { run } = createIdentityContext("identity001a-diagnostics.js");
  run(`state = normalizeState({
    resources: [
      { id: "tech-a", name: "Tech A", role: "tolier", active: true, authUserId: "auth-tech" },
      { id: "tech-b", name: "Tech B", role: "peintre", active: true, authUserId: "auth-tech" }
    ],
    users: [
      { id: "local-a", authUserId: "auth-tech", name: "Local A", role: "admin_technique", resourceId: "tech-a", active: true },
      { id: "local-b", name: "Local B", role: "technicien", resourceId: "tech-a", active: true }
    ],
    currentUserId: "local-a", cases: [], bookings: []
  });
  __before = JSON.stringify(state);
  __snapshot = getAccountAccessSnapshot({
    online: true,
    workshopId: "workshop-1",
    authIdentity: { id: "auth-tech", email: "tech@example.test" },
    serverMembership: { workshop_id: "workshop-1", user_id: "auth-tech", role: "technicien", resource_id: "tech-a" }
  });`);
  const issueCodes = JSON.parse(run("JSON.stringify(__snapshot.issues.map((issue) => issue.code))"));
  assert.ok(issueCodes.includes("ROLE_PARITY_MISMATCH"));
  assert.ok(issueCodes.includes("ACCOUNT_MULTIPLE_HUMAN_RESOURCES"));
  assert.ok(issueCodes.includes("DUPLICATE_ACTIVE_RESOURCE_LINK"));
  assert.equal(run("JSON.stringify(state)"), run("__before"));
});

check("K No Auth Admin API, administrative secret or service role is introduced in browser code", () => {
  const productionDiff = execFileSync("git", ["diff", "--unified=0", BASE_SHA, "--", "app.js", "index.html", "js", "styles.css", "sw.js", "offline.html"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 40 * 1024 * 1024,
  });
  const additions = productionDiff.split(/\r?\n/u).filter((line) => line.startsWith("+") && !line.startsWith("+++")).join("\n");
  assert.doesNotMatch(additions, /sb_secret_|service[_-]?role|\.auth\.admin\b|auth\.admin\b|createUser\s*\(/iu);
  assert.match(indexSource, /Inviter un collaborateur/u);
  assert.match(indexSource, /id="invite-workshop-member-btn"[\s\S]*Inviter un collaborateur<\/button>/u);
  assert.match(readProjectFile("js/supabase-client.js"), /client\.functions\.invoke\("workshop-user-admin"/u);
  assert.doesNotMatch(readProjectFile("js/supabase-client.js"), /\.auth\.admin\b|auth\.admin\b/iu);
});

check("L Planning, Supabase, SQL, UX-007, UX-009 and write behavior remain protected", () => {
  for (const protectedFile of [
    "js/planning.js",
    "js/supabase-sync.js",
    "js/supabase-config.js",
    "supabase-schema.sql",
  ]) {
    assert.equal(normalizeEol(readProjectFile(protectedFile)), normalizeEol(readBaseFile(protectedFile)), protectedFile);
  }
  const sqlFiles = execFileSync("git", ["ls-tree", "-r", "--name-only", BASE_SHA], { cwd: repoRoot, encoding: "utf8" })
    .split(/\r?\n/u)
    .filter((file) => file.endsWith(".sql"));
  for (const sqlFile of sqlFiles) {
    assert.equal(normalizeEol(readProjectFile(sqlFile)), normalizeEol(readBaseFile(sqlFile)), sqlFile);
  }
  const baseUiCases = readBaseFile("js/ui-cases.js");
  for (const [start, end] of [
    ["function buildSavKpis", "function renderSavDashboardLoads"],
    ["function buildDirectorDashboardSnapshot", "function buildSavPerformanceDashboard"],
    ["const WORKSHOP_PROGRESS_STALE_HOURS", "function getTechnicianDashboardResources"],
  ]) {
    assert.equal(normalizeEol(sourceSlice(uiCasesSource, start, end)), normalizeEol(sourceSlice(baseUiCases, start, end)), start);
  }
  const snapshotSource = sourceSlice(stateSource, "function getAccountAccessSnapshot", "function getCurrentActor");
  assert.doesNotMatch(snapshotSource, /saveState\s*\(|state\.[A-Za-z0-9_$.[\]]+\s*=/u);
  assert.doesNotMatch(snapshotSource, /\.from\s*\(|\.insert\s*\(|\.update\s*\(|\.upsert\s*\(/u);
  const changed = execFileSync("git", ["diff", "--name-only", BASE_SHA], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(fs.existsSync(path.join(repoRoot, "supabase/functions/workshop-user-admin/index.ts")), true);
  assert.doesNotMatch(changed, /\.sql(?:\n|$)/u);
});

assert.equal(passed.length + failures.length, 12, "IDENTITY-001A must contain exactly checks A-L");

if (failures.length) {
  console.error(`\nIDENTITY-001A REGRESSION SUITE: ${passed.length}/12 CHECKS PASSED (${failures.length} FAILED)`);
  failures.forEach(({ name, error }) => console.error(`\n${name}\n${error.stack || error.message}`));
  process.exitCode = 1;
} else {
  console.log("\nIDENTITY-001A REGRESSION SUITE: 12/12 CHECKS PASSED");
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
          for (let attempt = 0; attempt < 100; attempt += 1) {
            if (predicate()) return;
            await new Promise((resolveWait) => setTimeout(resolveWait, 100));
          }
          throw new Error(message);
        };
        await waitUntil(() => typeof state !== "undefined" && Array.isArray(state.users), "state unavailable");
        const form = document.getElementById("first-access-form");
        const overlay = document.getElementById("first-access-overlay");
        if (form && overlay?.hidden === false) {
          const authUser = { id: "identity-browser-auth", email: "admin.identity@example.test", user_metadata: { name: "Admin Identity" } };
          const membership = { workshop_id: "00000000-0000-0000-0000-000000000001", user_id: authUser.id, role: "admin_technique", resource_id: null };
          window.authenticateSupabaseUser = async () => ({ ok: true, user: authUser, membership });
          window.getSupabaseUser = async () => authUser;
          window.resolveSupabaseWorkshopMembership = async () => ({ ok: true, membership });
          window.pullLatestSupabaseBackup = async () => ({ ok: true });
          window.startSupabaseLiveSync = async () => true;
          window.signOutSupabaseSession = async () => ({ ok: true });
          window.invokeWorkshopUserAdmin = async (action) => {
            const snapshot = typeof getAccountAccessSnapshot === "function" ? getAccountAccessSnapshot() : null;
            return action === "capabilities"
              ? {
                  ok: true,
                  can_manage_accounts: true,
                  provisioning_available: true,
                  caller_role: snapshot?.serverRole || "admin_technique",
                  workshop_id: snapshot?.serverMembership?.workshop_id || membership.workshop_id,
                  human_resources: [],
                }
              : { ok: false, code: "NOT_USED_BY_IDENTITY001A" };
          };
          form.elements.email.value = authUser.email;
          form.elements.password.value = "Pass123456";
          form.requestSubmit();
          await waitUntil(() => state.currentUserId && document.getElementById("first-access-overlay")?.hidden !== false, "fixture login failed");
        }
        Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
        window.__setIdentity001aFixture = ({ serverRole, localRole, resourceRole = "", serverResourceId = "", localResourceId = serverResourceId, online = true, includeAlternate = false }) => {
          Object.defineProperty(window.navigator, "onLine", { configurable: true, value: online });
          const authId = "identity-browser-auth";
          const resources = resourceRole ? [normalizeResource({ id: serverResourceId || "identity-resource", name: resourceRole === "cabine" ? "Cabine identité" : "Technicien identité", role: resourceRole, active: true })] : [];
          state.resources.splice(0, state.resources.length, ...resources);
          const local = normalizeUser({
            id: "identity-local-current", authUserId: authId, authSource: "supabase_membership",
            membershipValidatedAt: "2026-08-31T12:00:00.000Z", membershipWorkshopId: "00000000-0000-0000-0000-000000000001",
            name: "Profil local identité", email: "admin.identity@example.test", role: localRole,
            resourceId: localResourceId, active: true
          }, state.resources);
          const alternates = includeAlternate ? [normalizeUser({ id: "identity-local-alternate", name: "Profil local alternatif", role: "admin_technique", active: true }, state.resources)] : [];
          state.users.splice(0, state.users.length, local, ...alternates);
          state.currentUserId = local.id;
          if (online) {
            window.__nimrValidatedAuthUserId = authId;
            setAccountAccessRuntimeContext(
              { id: authId, email: "admin.identity@example.test" },
              { workshop_id: "00000000-0000-0000-0000-000000000001", user_id: authId, role: serverRole, resource_id: serverResourceId || null }
            );
          } else {
            window.__nimrValidatedAuthUserId = "";
            clearAccountAccessRuntimeContext();
          }
          renderAccountAccessFoundation();
          renderUsersAndRoles();
          return getAccountAccessSnapshot();
        };
        __setIdentity001aFixture({ serverRole: "admin_technique", localRole: "admin_technique", includeAlternate: true });
        setActiveTab("atelier");
        setSettingsWorkspace("administration");
        render();
        return { tab: activeTab, workspace: activeSettingsWorkspace };
      })()
    `);
    assert.deepEqual(boot, { tab: "atelier", workspace: "administration" });
    await waitFor(`document.getElementById("account-access-foundation")?.offsetParent !== null`);
    assert.equal(await evaluate(`document.getElementById("account-auth-identity")?.textContent.trim()`), "admin.identity@example.test");
    assert.equal(await evaluate(`document.getElementById("account-access-overall-status")?.textContent.trim()`), "Actif");
    assert.equal(await evaluate(`document.getElementById("account-local-name")?.textContent.trim()`), "Profil local identité");
    assert.equal(await evaluate(`document.getElementById("current-user-selector")?.disabled`), true);
    assert.equal(await evaluate(`document.getElementById("current-user-selector-note")?.textContent.includes("droits serveur")`), true);

    const serverManagedProfile = await evaluate(`(() => {
      const editButton = document.querySelector('[data-edit-user="identity-local-current"]');
      const toggleButton = document.querySelector('[data-toggle-user-status="identity-local-current"]');
      const alternateEditButton = document.querySelector('[data-edit-user="identity-local-alternate"]');
      const card = editButton?.closest(".user-card");
      const before = JSON.stringify(state);
      const result = updateUserLocal("identity-local-current", {
        name: "Mutation interdite", role: "reception", email: "changed@example.test",
        resourceId: "changed-resource", active: false
      });
      return {
        managedLabelVisible: card?.textContent.includes("Géré par Supabase"),
        editDisabled: editButton?.disabled,
        editTitle: editButton?.title,
        toggleDisabled: toggleButton?.disabled,
        toggleTitle: toggleButton?.title,
        pureLocalEditDisabled: alternateEditButton?.disabled,
        result,
        stateUnchanged: before === JSON.stringify(state),
        currentRole: getCanonicalUserRole(getUserById("identity-local-current")),
        currentUserId: state.currentUserId,
        overall: document.getElementById("account-access-overall-status")?.textContent.trim()
      };
    })()`);
    assert.equal(serverManagedProfile.managedLabelVisible, true);
    assert.equal(serverManagedProfile.editDisabled, true);
    assert.match(serverManagedProfile.editTitle, /géré par Supabase/u);
    assert.equal(serverManagedProfile.toggleDisabled, true);
    assert.match(serverManagedProfile.toggleTitle, /géré par Supabase/u);
    assert.equal(serverManagedProfile.pureLocalEditDisabled, false);
    assert.equal(serverManagedProfile.result.ok, false);
    assert.equal(serverManagedProfile.result.code, "SERVER_MANAGED_PROFILE_READ_ONLY");
    assert.equal(serverManagedProfile.stateUnchanged, true);
    assert.equal(serverManagedProfile.currentRole, "admin_technique");
    assert.equal(serverManagedProfile.currentUserId, "identity-local-current");
    assert.equal(serverManagedProfile.overall, "Actif");

    const impersonation = await evaluate(`(() => {
      const before = { currentUserId: state.currentUserId, authUserId: window.__nimrValidatedAuthUserId };
      const select = document.getElementById("current-user-selector");
      select.value = "identity-local-alternate";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return { before, after: { currentUserId: state.currentUserId, authUserId: window.__nimrValidatedAuthUserId } };
    })()`);
    assert.deepEqual(impersonation.after, impersonation.before);

    const reception = await evaluate(`(() => {
      const snapshot = __setIdentity001aFixture({ serverRole: "reception", localRole: "reception" });
      return { serverRole: snapshot.serverRole, visibleRole: document.getElementById("account-server-role")?.textContent.trim(), selectorDisabled: document.getElementById("current-user-selector")?.disabled };
    })()`);
    assert.deepEqual(reception, { serverRole: "reception", visibleRole: "Réception", selectorDisabled: true });

    const validTechnician = await evaluate(`(() => {
      const snapshot = __setIdentity001aFixture({ serverRole: "technicien", localRole: "technicien", resourceRole: "tolier", serverResourceId: "human-tech" });
      return { status: snapshot.technicianResourceStatus, overall: document.getElementById("account-access-overall-status")?.textContent.trim(), diagnostic: document.getElementById("account-access-diagnostics")?.textContent };
    })()`);
    assert.equal(validTechnician.status, "valid");
    assert.equal(validTechnician.overall, "Actif");
    assert.match(validTechnician.diagnostic, /Ressource humaine valide\s*PASS/u);

    const equipment = await evaluate(`(() => {
      const before = JSON.stringify(state);
      const snapshot = __setIdentity001aFixture({ serverRole: "technicien", localRole: "technicien", resourceRole: "cabine", serverResourceId: "equipment-booth" });
      const stable = JSON.stringify(state);
      renderAccountAccessFoundation(snapshot);
      return { before: stable, after: JSON.stringify(state), status: snapshot.technicianResourceStatus, overall: document.getElementById("account-access-overall-status")?.textContent.trim(), issues: document.getElementById("account-access-issues")?.textContent };
    })()`);
    assert.equal(equipment.before, equipment.after);
    assert.equal(equipment.status, "equipment");
    assert.equal(equipment.overall, "Ressource manquante");
    assert.match(equipment.issues, /ERREUR/u);

    const mismatch = await evaluate(`(() => {
      const snapshot = __setIdentity001aFixture({ serverRole: "reception", localRole: "admin_technique" });
      return { serverRole: snapshot.serverRole, localRole: snapshot.localRole, parity: snapshot.roleParity, issues: document.getElementById("account-access-issues")?.textContent };
    })()`);
    assert.deepEqual({ serverRole: mismatch.serverRole, localRole: mismatch.localRole, parity: mismatch.parity }, { serverRole: "reception", localRole: "admin_technique", parity: "warning" });
    assert.match(mismatch.issues, /ATTENTION/u);
    assert.match(mismatch.issues, /serveur reste autoritaire/u);

    const offline = await evaluate(`(() => {
      const snapshot = __setIdentity001aFixture({ serverRole: "admin_technique", localRole: "admin_technique", online: false });
      return { session: snapshot.sessionStatus, overall: document.getElementById("account-access-overall-status")?.textContent.trim(), source: document.getElementById("account-local-title")?.parentElement?.textContent };
    })()`);
    assert.equal(offline.session, "offline_local");
    assert.equal(offline.overall, "Hors ligne / identité locale");
    assert.match(offline.source, /Miroir local/u);

    await evaluate(`(() => {
      __setIdentity001aFixture({ serverRole: "admin_technique", localRole: "admin_technique", includeAlternate: true, online: true });
      setActiveTab("atelier");
      setSettingsWorkspace("administration");
      render();
      return true;
    })()`);
    const focusStyle = await evaluate(`(() => {
      const button = document.getElementById("change-user-settings-btn");
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
        const foundation = document.getElementById("account-access-foundation").getBoundingClientRect();
        return { innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, panelLeft: panel.left, panelRight: panel.right, foundationLeft: foundation.left, foundationRight: foundation.right };
      })()`);
      assert.ok(dimensions.documentWidth <= dimensions.innerWidth, `${viewport.width}px document overflow`);
      assert.ok(dimensions.bodyWidth <= dimensions.innerWidth, `${viewport.width}px body overflow`);
      assert.ok(dimensions.panelLeft >= 0 && dimensions.panelRight <= dimensions.innerWidth + 1, `${viewport.width}px panel overflow: ${JSON.stringify(dimensions)}`);
      assert.ok(dimensions.foundationLeft >= 0 && dimensions.foundationRight <= dimensions.innerWidth + 1, `${viewport.width}px foundation overflow: ${JSON.stringify(dimensions)}`);
      viewportResults.push({ ...viewport, overflow: false });
    }
    const errors = findings.filter((finding) => String(finding.text || "").trim());
    const authNoise = errors.filter((finding) => /Failed to load resource: the server responded with a status of 401/iu.test(finding.text));
    const identityErrors = errors.filter((finding) => !authNoise.includes(finding));
    assert.deepEqual(identityErrors, []);
    return {
      adminHealthy: "PASS",
      receptionAuthority: "PASS",
      technicianHuman: "PASS",
      technicianEquipment: "ERREUR VISIBLE",
      roleParityWarning: "ATTENTION VISIBLE",
      offlineLocal: "PASS",
      onlineImpersonationBlocked: "PASS",
      serverManagedMirrorReadOnly: "PASS",
      pureLocalProfileCompatibility: "PASS",
      keyboardFocus: "PASS",
      viewportResults,
      consoleErrorsCausedByIdentity001a: 0,
      ignoredFixtureAuth401: authNoise.length,
    };
  });
}

if (browserSmokeRequested && failures.length === 0) {
  try {
    const result = await runBrowserSmoke();
    console.log("\nIDENTITY-001A BROWSER/RESPONSIVE SMOKE: PASS");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`\nIDENTITY-001A BROWSER/RESPONSIVE SMOKE: FAIL\n${error.stack || error.message}`);
    process.exitCode = 1;
  }
}
