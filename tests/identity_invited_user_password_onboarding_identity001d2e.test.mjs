import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BASE_SHA = "c7a05dcb465ede8620f2cedfe94d3511364d09ed";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readProjectFile = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const sourceSlice = (source, start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `source slice missing: ${start} -> ${end}`);
  return source.slice(startIndex, endIndex);
};

const edgeSource = readProjectFile("supabase/functions/workshop-user-admin/index.ts");
const clientSource = readProjectFile("js/supabase-client.js");
const syncSource = readProjectFile("js/supabase-sync.js");
const appSource = readProjectFile("app.js");
const indexSource = readProjectFile("index.html");
const serviceWorkerSource = readProjectFile("sw.js");

function createClientFixture({
  href = "https://irondrass.github.io/NIMR-SAV/",
  metadata = { display_name: "Invited", nimr_password_setup_required: true },
  user = null,
  sharedLocalStorage = null,
  sharedSessionStorage = null,
  signOutError = null,
} = {}) {
  const events = [];
  const storageWrites = [];
  const localStore = sharedLocalStorage || new Map();
  const sessionStore = sharedSessionStorage || new Map();
  const replacements = [];
  let currentUser = user || { id: "auth-invited", email: "invite@example.test", user_metadata: { ...metadata } };
  const fixture = {
    events,
    storageWrites,
    replacements,
    localStore,
    sessionStore,
    updatePayload: null,
    recoveryRequest: null,
    signInRequest: null,
  };
  const membership = {
    workshop_id: "workshop-a",
    user_id: currentUser.id,
    role: "directeur",
    resource_id: null,
  };
  const query = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() {
      events.push("membership_revalidated");
      return { data: { ...membership }, error: null };
    },
  };
  const client = {
    auth: {
      async getSession() {
        events.push("getSession");
        return { data: { session: { user: currentUser } }, error: null };
      },
      async getUser() {
        events.push("getUser");
        return { data: { user: currentUser }, error: null };
      },
      async updateUser(payload) {
        events.push("updateUser");
        fixture.updatePayload = structuredClone(payload);
        currentUser = { ...currentUser, user_metadata: { ...payload.data } };
        return { data: { user: currentUser }, error: null };
      },
      async resetPasswordForEmail(email, options) {
        events.push("resetPasswordForEmail");
        fixture.recoveryRequest = { email, options: structuredClone(options) };
        return { data: {}, error: null };
      },
      async signInWithPassword(credentials) {
        events.push("signInWithPassword");
        fixture.signInRequest = { ...credentials };
        return { data: { user: currentUser, session: { user: currentUser } }, error: null };
      },
      async signOut() {
        events.push("signOut");
        return { error: signOutError };
      },
    },
    from(table) {
      assert.equal(table, "workshop_members");
      return query;
    },
  };
  const context = vm.createContext({
    URL,
    URLSearchParams,
    Date,
    console,
    structuredClone,
    atob,
    localStorage: {
      getItem(key) { return localStore.get(key) ?? null; },
      setItem(key, value) {
        storageWrites.push({ area: "localStorage", key: String(key), value: String(value) });
        localStore.set(String(key), String(value));
      },
      removeItem(key) { localStore.delete(String(key)); },
    },
    sessionStorage: {
      getItem(key) { return sessionStore.get(key) ?? null; },
      setItem(key, value) {
        storageWrites.push({ area: "sessionStorage", key: String(key), value: String(value) });
        sessionStore.set(String(key), String(value));
      },
      removeItem(key) { sessionStore.delete(String(key)); },
    },
    location: { href },
    history: {
      state: null,
      replaceState(_state, _title, destination) { replacements.push(String(destination)); },
    },
    NIMR_DEFAULT_WORKSHOP_ID: "workshop-a",
    NIMR_SUPABASE_CONFIG: {
      enabled: true,
      url: "https://example.supabase.co",
      anonKey: "sb_publishable_identity001d2e",
      workshopId: "workshop-a",
    },
    supabase: { createClient: () => client },
    $: () => null,
  });
  context.window = context;
  vm.runInContext(readProjectFile("js/supabase-client.js"), context, { filename: "supabase-client.identity001d2e.js" });
  fixture.context = context;
  fixture.setCurrentUser = (newUser) => { currentUser = newUser; };
  return fixture;
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

await check("A invitations persist only the password-setup onboarding flag alongside display name", () => {
  const match = edgeSource.match(/inviteUserByEmail\(email,\s*\{\s*data:\s*\{([\s\S]*?)\}\s*,?\s*\}\)/u);
  assert.ok(match, "inviteUserByEmail metadata block missing");
  assert.match(match[1], /display_name:\s*name/u);
  assert.match(match[1], /nimr_password_setup_required:\s*true/u);
});

await check("B invitation metadata does not become role or workshop authority", () => {
  const match = edgeSource.match(/inviteUserByEmail\(email,\s*\{\s*data:\s*\{([\s\S]*?)\}\s*,?\s*\}\)/u);
  assert.ok(match);
  assert.doesNotMatch(match[1], /\brole\b|workshop|permission|resource_id/iu);
  assert.match(clientSource, /from\("workshop_members"\)[\s\S]*?select\("workshop_id, user_id, role, resource_id"\)/u);
});

await check("C authenticated password setup updates the password and preserved metadata", async () => {
  const fixture = createClientFixture();
  const result = await fixture.context.completeSupabasePasswordSetup("LongPassword!2026");
  assert.equal(result.ok, true);
  assert.equal(fixture.updatePayload.password, "LongPassword!2026");
  assert.equal(fixture.updatePayload.data.display_name, "Invited");
});

await check("D password values never enter browser storage, local users or audit logging", async () => {
  const fixture = createClientFixture();
  const password = "NeverPersist!2026";
  await fixture.context.completeSupabasePasswordSetup(password);
  assert.equal(fixture.storageWrites.some(({ key, value }) => key.includes(password) || value.includes(password)), false);
  const setupSource = sourceSlice(clientSource, "async function completeSupabasePasswordSetup", "window.completeSupabasePasswordSetup");
  const setupUiSource = sourceSlice(appSource, "const passwordSetupForm", "const bindPasswordRecoveryButton");
  assert.doesNotMatch(`${setupSource}\n${setupUiSource}`, /localStorage|indexedDB|state\.users|addAuditLog/iu);
});

await check("E password setup clears the persistent requirement and records completion time", async () => {
  const fixture = createClientFixture();
  const result = await fixture.context.completeSupabasePasswordSetup("LongPassword!2026");
  assert.equal(result.ok, true);
  assert.equal(fixture.updatePayload.data.nimr_password_setup_required, false);
  assert.match(fixture.updatePayload.data.nimr_password_setup_completed_at, /^\d{4}-\d{2}-\d{2}T/u);
});

await check("F membership is revalidated after updateUser and remains the role authority", async () => {
  const fixture = createClientFixture();
  const result = await fixture.context.completeSupabasePasswordSetup("LongPassword!2026");
  assert.equal(result.membership.role, "directeur");
  assert.ok(fixture.events.lastIndexOf("membership_revalidated") > fixture.events.lastIndexOf("updateUser"));
  assert.equal(fixture.events.filter((event) => event === "getUser").length, 2);
});

await check("G the activation overlay keeps the application shell inert until completion", () => {
  assert.match(indexSource, /id="supabase-password-setup-overlay"[\s\S]*?Activer votre compte NIMR SAV[\s\S]*?Nouveau mot de passe[\s\S]*?Confirmer le mot de passe[\s\S]*?Activer mon compte/u);
  const gateSource = sourceSlice(appSource, "function showSupabasePasswordSetupGate", "window.showSupabasePasswordSetupGate");
  assert.match(gateSource, /__nimrValidatedAuthUserId\s*=\s*""/u);
  assert.match(gateSource, /\.app-shell[\s\S]*?setAttribute\("inert",\s*""\)/u);
  assert.match(appSource, /PASSWORD_SETUP_REQUIRED/u);
});

await check("H PASSWORD_RECOVERY enters the same blocking password setup gate", () => {
  assert.match(syncSource, /event\s*===\s*"PASSWORD_RECOVERY"[\s\S]*?showSupabasePasswordSetupGate\(event\s*===\s*"PASSWORD_RECOVERY"\s*\?\s*"recovery"/u);
});

await check("I password recovery validates email and uses resetPasswordForEmail", async () => {
  const fixture = createClientFixture();
  const invalid = await fixture.context.requestSupabasePasswordRecovery("not-an-email");
  assert.equal(invalid.code, "INVALID_EMAIL");
  const valid = await fixture.context.requestSupabasePasswordRecovery("User@Example.Test");
  assert.equal(valid.ok, true);
  assert.equal(fixture.recoveryRequest.email, "user@example.test");
  assert.ok(indexSource.match(/Mot de passe oublié \?/gu)?.length >= 2);
});

await check("J recovery redirect is derived from the deployed base path without localhost", async () => {
  const fixture = createClientFixture({ href: "https://irondrass.github.io/NIMR-SAV/index.html?tab=login#local" });
  await fixture.context.requestSupabasePasswordRecovery("user@example.test");
  assert.equal(fixture.recoveryRequest.options.redirectTo, "https://irondrass.github.io/NIMR-SAV/");
  assert.doesNotMatch(fixture.recoveryRequest.options.redirectTo, /localhost|127\.0\.0\.1/iu);
});

await check("K added authentication code never logs URL tokens or password secrets", () => {
  const browserDiff = execFileSync("git", ["diff", "--unified=0", BASE_SHA, "--", "app.js", "js/supabase-client.js", "js/supabase-sync.js"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const addedConsoleLines = browserDiff.split(/\r?\n/u)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .filter((line) => /console\./u.test(line));
  assert.equal(addedConsoleLines.some((line) => /access_token|refresh_token|token_hash|\bpassword\b/iu.test(line)), false);
});

await check("L sensitive Auth URL cleanup occurs only after session recovery and preserves /NIMR-SAV/", () => {
  const fixture = createClientFixture({
    href: "https://irondrass.github.io/NIMR-SAV/?view=activation&type=signup&token_hash=hidden#access_token=hidden&refresh_token=hidden&type=signup",
  });
  fixture.context.getSupabaseClient();
  assert.deepEqual(fixture.replacements, []);
  fixture.context.markSupabaseAuthSessionRecovered("SIGNED_IN", { user: { id: "auth-invited" } });
  assert.deepEqual(fixture.replacements, ["/NIMR-SAV/?view=activation"]);
  assert.match(clientSource, /if\s*\(!nimrSupabaseSessionRecovered[\s\S]*?history\.replaceState/u);
});

await check("M existing email/password login remains supported without a setup flag", async () => {
  const fixture = createClientFixture({ metadata: { display_name: "Existing" } });
  const result = await fixture.context.authenticateSupabaseUser("existing@example.test", "ExistingPassword!2026");
  assert.equal(result.ok, true);
  assert.equal(result.passwordSetupRequired, undefined);
  assert.equal(result.membership.role, "directeur");
  assert.equal(fixture.events.includes("signInWithPassword"), true);
});

await check("N this source ticket introduces no SQL or migration", () => {
  const changedPaths = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).split(/\r?\n/u).filter(Boolean).map((line) => line.slice(3).replaceAll("\\", "/"));
  assert.equal(changedPaths.some((file) => file.startsWith("supabase/migrations/") || /\.sql$/iu.test(file)), false);
});

await check("O browser changes add no service-role secret or privileged Supabase client", () => {
  const browserDiff = execFileSync("git", ["diff", "--unified=0", BASE_SHA, "--", "index.html", "app.js", "js/supabase-client.js", "js/supabase-sync.js"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const additions = browserDiff.split(/\r?\n/u).filter((line) => line.startsWith("+") && !line.startsWith("+++"));
  assert.doesNotMatch(additions.join("\n"), /SUPABASE_SECRET|auth\.admin|service[_-]?role/iu);
});

await check("P the service-worker source changes while the v23.3.27 cache contract stays fixed", () => {
  assert.match(serviceWorkerSource, /IDENTITY-001D2-E source refresh/u);
  assert.match(serviceWorkerSource, /const CACHE_NAME = "nimr-sav-v23\.3\.27"/u);
  assert.match(readProjectFile("js/version.js"), /^window\.APP_VERSION = "v23\.3\.27";$/mu);
  assert.match(indexSource, /app\.js\?v=23\.3\.27/u);
});

await check("Q auth URL detection requires genuine auth token material and ignores arbitrary type query or hash alone", () => {
  const realAuth = createClientFixture({
    href: "https://irondrass.github.io/NIMR-SAV/#access_token=real_token&refresh_token=real_refresh&type=signup",
    metadata: { display_name: "RealAuth" },
  });
  realAuth.context.getSupabaseClient();
  assert.equal(realAuth.context.detectSupabaseAuthUrlFlow(), "invitation");

  const hashSignupAlone = createClientFixture({
    href: "https://irondrass.github.io/NIMR-SAV/#type=signup",
    metadata: { display_name: "NoAuthMaterial" },
  });
  hashSignupAlone.context.getSupabaseClient();
  assert.equal(hashSignupAlone.context.detectSupabaseAuthUrlFlow(), "");
  assert.equal(hashSignupAlone.context.hasSupabaseAuthCallbackEvidence(), false);

  const queryRecoveryAlone = createClientFixture({
    href: "https://irondrass.github.io/NIMR-SAV/?type=recovery",
    metadata: { display_name: "NoAuthMaterial" },
  });
  queryRecoveryAlone.context.getSupabaseClient();
  assert.equal(queryRecoveryAlone.context.detectSupabaseAuthUrlFlow(), "");
  assert.equal(queryRecoveryAlone.context.hasSupabaseAuthCallbackEvidence(), false);

  const tokenHashOnly = createClientFixture({
    href: "https://irondrass.github.io/NIMR-SAV/?token_hash=fake&type=recovery",
    metadata: { display_name: "TokenHashWithoutVerification" },
  });
  tokenHashOnly.context.getSupabaseClient();
  assert.equal(tokenHashOnly.context.detectSupabaseAuthUrlFlow(), "");
  assert.equal(tokenHashOnly.context.hasSupabaseAuthCallbackEvidence(), false);

  const codeOnly = createClientFixture({
    href: "https://irondrass.github.io/NIMR-SAV/?code=fake&type=signup",
    metadata: { display_name: "CodeWithoutExchange" },
  });
  codeOnly.context.getSupabaseClient();
  assert.equal(codeOnly.context.detectSupabaseAuthUrlFlow(), "");
  assert.equal(codeOnly.context.hasSupabaseAuthCallbackEvidence(), false);
});

await check("R existing session on normal report/code URLs preserves parameters and getSupabaseUser does not clean them", async () => {
  const fixture = createClientFixture({
    href: "https://irondrass.github.io/NIMR-SAV/?type=report&code=ABC&error=none#section-kpis",
    metadata: { display_name: "NormalUser" },
  });
  const user = await fixture.context.getSupabaseUser();
  assert.equal(user.id, "auth-invited");
  assert.deepEqual(fixture.replacements, []);
  assert.equal(fixture.context.hasSupabaseAuthCallbackEvidence(), false);
  assert.equal(fixture.context.cleanSensitiveSupabaseAuthUrlAfterSessionRecovery(), false);
});

await check("S recovery setup requirement survives tab close and sessionStorage loss via user-scoped persistent marker", async () => {
  const sharedLocalStorage = new Map();
  const session1 = createClientFixture({
    href: "https://irondrass.github.io/NIMR-SAV/#access_token=rec_token&refresh_token=rec_refresh&type=recovery",
    metadata: { display_name: "RecoveryUser" },
    user: { id: "user-recovery-42", email: "recovery@nimr.test", user_metadata: { display_name: "RecoveryUser" } },
    sharedLocalStorage,
  });

  session1.context.markSupabaseAuthSessionRecovered("PASSWORD_RECOVERY", {
    user: { id: "user-recovery-42", email: "recovery@nimr.test" },
  });
  assert.equal(session1.context.getSupabasePasswordSetupMode({ id: "user-recovery-42" }), "recovery");
  assert.equal(sharedLocalStorage.has("nimr-auth-password-setup-required"), true);
  const storedMarker = JSON.parse(sharedLocalStorage.get("nimr-auth-password-setup-required"));
  assert.equal(storedMarker.user_id, "user-recovery-42");
  assert.equal(storedMarker.mode, "recovery");
  assert.equal("access_token" in storedMarker, false);
  assert.equal("refresh_token" in storedMarker, false);
  assert.equal("password" in storedMarker, false);

  // Tab close simulation: brand new context, empty sessionStorage, shared localStorage
  const session2 = createClientFixture({
    href: "https://irondrass.github.io/NIMR-SAV/",
    metadata: { display_name: "RecoveryUser" },
    user: { id: "user-recovery-42", email: "recovery@nimr.test", user_metadata: { display_name: "RecoveryUser" } },
    sharedLocalStorage,
  });
  const setupModeAfterTabClose = await session2.context.getSupabaseSessionPasswordSetupMode();
  assert.equal(setupModeAfterTabClose, "recovery");
  assert.equal(session2.context.isSupabasePasswordSetupRequired({ id: "user-recovery-42" }), true);
});

await check("T persistent recovery marker is isolated by user ID and does not block other users", async () => {
  const sharedLocalStorage = new Map();
  const sharedSessionStorage = new Map();
  sharedLocalStorage.set("nimr-auth-password-setup-required", JSON.stringify({
    user_id: "user-A",
    mode: "recovery",
  }));
  sharedSessionStorage.set("nimr-auth-activation-flow", JSON.stringify({
    user_id: "user-A",
    mode: "recovery",
  }));

  const userBFixture = createClientFixture({
    href: "https://irondrass.github.io/NIMR-SAV/",
    user: { id: "user-B", email: "userb@nimr.test", user_metadata: { display_name: "User B" } },
    sharedLocalStorage,
    sharedSessionStorage,
  });
  assert.equal(userBFixture.context.getSupabasePasswordSetupMode({ id: "user-B" }), "");
  assert.equal(userBFixture.context.isSupabasePasswordSetupRequired({ id: "user-B" }), false);

  const userAFixture = createClientFixture({
    href: "https://irondrass.github.io/NIMR-SAV/",
    user: { id: "user-A", email: "usera@nimr.test", user_metadata: { display_name: "User A" } },
    sharedLocalStorage,
    sharedSessionStorage,
  });
  assert.equal(userAFixture.context.getSupabasePasswordSetupMode({ id: "user-A" }), "recovery");
  assert.equal(userAFixture.context.isSupabasePasswordSetupRequired({ id: "user-A" }), true);
});

await check("U sign-out clears the recovery gate and never persists sensitive tokens", async () => {
  const sharedLocalStorage = new Map();
  const fixture = createClientFixture({
    href: "https://irondrass.github.io/NIMR-SAV/",
    user: { id: "user-to-signout", email: "signout@nimr.test", user_metadata: { display_name: "SignOutUser" } },
    sharedLocalStorage,
  });
  fixture.context.writePersistentPasswordSetupRequirement("user-to-signout", "recovery");
  assert.equal(sharedLocalStorage.has("nimr-auth-password-setup-required"), true);

  await fixture.context.signOutSupabaseSession();
  assert.equal(sharedLocalStorage.has("nimr-auth-password-setup-required"), false);
  assert.equal(fixture.context.getSupabasePasswordSetupMode({ id: "user-to-signout" }), "");
});

await check("V failed sign-out preserves the recovery requirement for the still-persisted session", async () => {
  const sharedLocalStorage = new Map();
  const sharedSessionStorage = new Map();
  const fixture = createClientFixture({
    href: "https://irondrass.github.io/NIMR-SAV/",
    user: { id: "user-signout-failure", email: "failure@nimr.test", user_metadata: { display_name: "FailureUser" } },
    sharedLocalStorage,
    sharedSessionStorage,
    signOutError: new Error("signout refused"),
  });
  fixture.context.writePersistentPasswordSetupRequirement("user-signout-failure", "recovery");
  fixture.context.writeSupabaseAuthFlowSessionMarker("user-signout-failure", "recovery");

  const result = await fixture.context.signOutSupabaseSession();
  assert.equal(result.ok, false);
  assert.equal(sharedLocalStorage.has("nimr-auth-password-setup-required"), true);
  assert.equal(fixture.context.getSupabasePasswordSetupMode({ id: "user-signout-failure" }), "recovery");
});

await check("W successful sign-out clears only the current user's scoped recovery markers", async () => {
  const sharedLocalStorage = new Map();
  const sharedSessionStorage = new Map();
  const fixture = createClientFixture({
    href: "https://irondrass.github.io/NIMR-SAV/",
    user: { id: "user-current", email: "current@nimr.test", user_metadata: { display_name: "CurrentUser" } },
    sharedLocalStorage,
    sharedSessionStorage,
  });
  fixture.context.writePersistentPasswordSetupRequirement("user-current", "recovery");
  fixture.context.writeSupabaseAuthFlowSessionMarker("user-current", "recovery");

  const result = await fixture.context.signOutSupabaseSession();
  assert.equal(result.ok, true);
  assert.equal(sharedLocalStorage.has("nimr-auth-password-setup-required"), false);
  assert.equal(sharedSessionStorage.has("nimr-auth-activation-flow"), false);
});

assert.equal(passed.length + failures.length, 23, "IDENTITY-001D2-E must contain exactly checks A-W");

if (failures.length) {
  console.error(`\nIDENTITY-001D2-E REGRESSION SUITE: ${passed.length}/23 CHECKS PASSED (${failures.length} FAILED)`);
  failures.forEach(({ name, error }) => console.error(`\n${name}\n${error.stack || error.message}`));
  process.exitCode = 1;
} else {
  console.log("\nIDENTITY-001D2-E REGRESSION SUITE: 23/23 CHECKS PASSED");
}
