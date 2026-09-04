import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BASE_SHA = "b4409d0fac18b9ffaf521511e9c31f20b8a7f7f6";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readProjectFile = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const sourceSlice = (source, start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `source slice missing: ${start} -> ${end}`);
  return source.slice(startIndex, endIndex);
};

const clientSource = readProjectFile("js/supabase-client.js");
const syncSource = readProjectFile("js/supabase-sync.js");
const appSource = readProjectFile("app.js");
const indexSource = readProjectFile("index.html");
const serviceWorkerSource = readProjectFile("sw.js");
const d1Source = readProjectFile("tests/identity_database_authority_hardening_identity001d1.test.mjs");

function createClientFixture({
  verifyError = null,
  getUserOverride = null,
  href = "https://irondrass.github.io/NIMR-SAV/",
} = {}) {
  const events = [];
  const storageWrites = [];
  const localStore = new Map();
  const sessionStore = new Map();
  let currentUser = {
    id: "recovery-user",
    email: "User@Example.Test",
    user_metadata: { display_name: "Recovery User" },
  };
  let contextRef = null;
  const fixture = {
    events,
    storageWrites,
    localStore,
    sessionStore,
    verifyPayload: null,
    recoveryRequest: null,
    pendingDuringVerify: null,
  };

  const client = {
    auth: {
      async resetPasswordForEmail(email, options) {
        events.push("resetPasswordForEmail");
        fixture.recoveryRequest = { email, options: structuredClone(options) };
        return { data: {}, error: null };
      },
      async verifyOtp(payload) {
        events.push("verifyOtp");
        fixture.verifyPayload = structuredClone(payload);
        fixture.pendingDuringVerify = contextRef?.__nimrRecoveryOtpVerificationPending;
        if (verifyError) {
          return { data: { user: null, session: null }, error: verifyError };
        }
        return {
          data: {
            user: currentUser,
            session: { user: currentUser },
          },
          error: null,
        };
      },
      async getUser() {
        events.push("getUser");
        if (getUserOverride) {
          return { data: { user: getUserOverride }, error: null };
        }
        return { data: { user: currentUser }, error: null };
      },
      async getSession() {
        events.push("getSession");
        return { data: { session: { user: currentUser } }, error: null };
      },
      async signInWithPassword(credentials) {
        events.push("signInWithPassword");
        return { data: { user: currentUser, session: { user: currentUser } }, error: null };
      },
      async updateUser(payload) {
        events.push("updateUser");
        currentUser = {
          ...currentUser,
          user_metadata: { ...(currentUser.user_metadata || {}), ...(payload.data || {}) },
        };
        return { data: { user: currentUser }, error: null };
      },
      async signOut() {
        events.push("signOut");
        return { error: null };
      },
    },
    from(table) {
      assert.equal(table, "workshop_members");
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          events.push("membership_revalidated");
          return {
            data: {
              workshop_id: "workshop-a",
              user_id: currentUser.id,
              role: "directeur",
              resource_id: null,
            },
            error: null,
          };
        },
      };
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
      getItem(key) { return localStore.get(String(key)) ?? null; },
      setItem(key, value) {
        storageWrites.push({ area: "localStorage", key: String(key), value: String(value) });
        localStore.set(String(key), String(value));
      },
      removeItem(key) { localStore.delete(String(key)); },
    },
    sessionStorage: {
      getItem(key) { return sessionStore.get(String(key)) ?? null; },
      setItem(key, value) {
        storageWrites.push({ area: "sessionStorage", key: String(key), value: String(value) });
        sessionStore.set(String(key), String(value));
      },
      removeItem(key) { sessionStore.delete(String(key)); },
    },
    location: { href },
    history: { state: null, replaceState() {} },
    NIMR_DEFAULT_WORKSHOP_ID: "workshop-a",
    NIMR_SUPABASE_CONFIG: {
      enabled: true,
      url: "https://example.supabase.co",
      anonKey: "sb_publishable_identity001d2f",
      workshopId: "workshop-a",
    },
    supabase: { createClient: () => client },
    $: () => null,
  });
  context.window = context;
  contextRef = context;
  vm.runInContext(clientSource, context, { filename: "supabase-client.identity001d2f.js" });
  fixture.context = context;
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

await check("A recovery request remains enumeration-safe and announces a code rather than a link", async () => {
  const fixture = createClientFixture();
  const result = await fixture.context.requestSupabasePasswordRecovery("User@Example.Test");
  assert.equal(result.ok, true);
  assert.match(result.message, /code de récupération/iu);
  assert.doesNotMatch(result.message, /\blien\b/iu);
  assert.equal(fixture.recoveryRequest.email, "user@example.test");
});

await check("B recovery request keeps the production base-path redirect as a safe fallback", async () => {
  const fixture = createClientFixture({
    href: "https://irondrass.github.io/NIMR-SAV/index.html?tab=login#local",
  });
  await fixture.context.requestSupabasePasswordRecovery("user@example.test");
  assert.equal(
    fixture.recoveryRequest.options.redirectTo,
    "https://irondrass.github.io/NIMR-SAV/",
  );
  assert.doesNotMatch(fixture.recoveryRequest.options.redirectTo, /localhost|127\.0\.0\.1/iu);
});

await check("C OTP verification rejects malformed email and non-six-digit code before network use", async () => {
  const fixture = createClientFixture();
  const badEmail = await fixture.context.verifySupabaseRecoveryOtp("not-email", "123456");
  const badOtp = await fixture.context.verifySupabaseRecoveryOtp("user@example.test", "12 34");
  assert.equal(badEmail.code, "INVALID_EMAIL");
  assert.equal(badOtp.code, "INVALID_OTP");
  assert.equal(fixture.events.includes("verifyOtp"), false);
});

await check("D recovery OTP is verified with normalized email, six digits and type recovery", async () => {
  const fixture = createClientFixture();
  const result = await fixture.context.verifySupabaseRecoveryOtp(
    " User@Example.Test ",
    "123 456",
  );
  assert.equal(result.ok, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(fixture.verifyPayload)),
    { email: "user@example.test", token: "123456", type: "recovery" },
  );
});

await check("E successful OTP verification creates only a user-scoped non-secret recovery requirement", async () => {
  const fixture = createClientFixture();
  const otp = "654321";
  const result = await fixture.context.verifySupabaseRecoveryOtp("user@example.test", otp);
  assert.equal(result.ok, true);
  const marker = JSON.parse(fixture.localStore.get("nimr-auth-password-setup-required"));
  assert.equal(marker.user_id, "recovery-user");
  assert.equal(marker.mode, "recovery");
  assert.equal(fixture.storageWrites.some(({ key, value }) => key.includes(otp) || value.includes(otp)), false);
});

await check("F OTP verification revalidates the authenticated user after the session is created", async () => {
  const fixture = createClientFixture();
  const result = await fixture.context.verifySupabaseRecoveryOtp("user@example.test", "123456");
  assert.equal(result.ok, true);
  assert.ok(fixture.events.indexOf("getUser") > fixture.events.indexOf("verifyOtp"));
});

await check("G an OTP verification error remains fail-closed and does not create a recovery marker", async () => {
  const fixture = createClientFixture({ verifyError: new Error("otp expired") });
  const result = await fixture.context.verifySupabaseRecoveryOtp("user@example.test", "123456");
  assert.equal(result.ok, false);
  assert.equal(result.code, "RECOVERY_OTP_REJECTED");
  assert.equal(fixture.localStore.has("nimr-auth-password-setup-required"), false);
});

await check("H a mismatched post-verification identity is also marked recovery-required and stays blocked", async () => {
  const fixture = createClientFixture({
    getUserOverride: {
      id: "different-user",
      email: "other@example.test",
      user_metadata: {},
    },
  });
  const result = await fixture.context.verifySupabaseRecoveryOtp("user@example.test", "123456");
  assert.equal(result.ok, false);
  assert.equal(result.code, "AUTH_REVALIDATION_FAILED");
  assert.equal(fixture.context.getSupabasePasswordSetupMode({ id: "different-user" }), "recovery");
});

await check("I the recovery verification runtime flag is active only during verifyOtp and cleared afterward", async () => {
  const fixture = createClientFixture();
  await fixture.context.verifySupabaseRecoveryOtp("user@example.test", "123456");
  assert.equal(fixture.pendingDuringVerify, true);
  assert.equal(fixture.context.__nimrRecoveryOtpVerificationPending, false);
});

await check("J auth lifecycle converts any event emitted during OTP verification into the blocking recovery path", () => {
  assert.match(syncSource, /recoveryOtpVerificationPending\s*=\s*window\.__nimrRecoveryOtpVerificationPending\s*===\s*true/u);
  assert.match(syncSource, /recoveryOtpVerificationPending\s*\?\s*"PASSWORD_RECOVERY"\s*:\s*event/u);
  assert.match(syncSource, /event\s*===\s*"PASSWORD_RECOVERY"\s*\|\|\s*recoveryOtpVerificationPending\s*\|\|\s*passwordSetupMode/u);
  assert.match(syncSource, /showSupabasePasswordSetupGate\(event\s*===\s*"PASSWORD_RECOVERY"\s*\?\s*"recovery"\s*:\s*recoveryOtpVerificationPending\s*\?\s*"recovery"/u);
});

await check("K the recovery OTP dialog is accessible and uses one-time-code semantics", () => {
  assert.match(indexSource, /id="supabase-recovery-otp-overlay"[\s\S]*?Vérifier votre identité/u);
  assert.match(indexSource, /name="token"[\s\S]*?inputmode="numeric"[\s\S]*?autocomplete="one-time-code"/u);
  assert.match(indexSource, /pattern="\[0-9\]\{6\}"[\s\S]*?maxlength="6"/u);
  assert.match(indexSource, /id="supabase-recovery-otp-cancel"[\s\S]*?>Retour</u);
});

await check("L showing the OTP dialog blocks the app and clears validated runtime authority", () => {
  const gate = sourceSlice(appSource, "function showSupabaseRecoveryOtpGate", "window.showSupabaseRecoveryOtpGate");
  assert.match(gate, /__nimrValidatedAuthUserId\s*=\s*""/u);
  assert.match(gate, /clearAccountAccessRuntimeContext/u);
  assert.match(gate, /stopSupabaseLiveSync\(\{\s*status:\s*"waiting_auth"\s*\}\)/u);
  assert.match(gate, /\.app-shell[\s\S]*?setAttribute\("inert",\s*""\)/u);
});

await check("M a successful recovery request opens the OTP gate without authorizing the application", () => {
  const binding = sourceSlice(appSource, "const bindPasswordRecoveryButton", "bindPasswordRecoveryButton(\"first-access-password-recovery\"");
  assert.match(binding, /requestSupabasePasswordRecovery\(email\)/u);
  assert.match(binding, /result\?\.ok[\s\S]*?showSupabaseRecoveryOtpGate\(email\)/u);
  assert.doesNotMatch(binding, /persistValidatedSupabaseIdentity|startSupabaseLiveSync/u);
});

await check("N OTP form success enters the existing recovery password-setup gate while failure remains on OTP", () => {
  const binding = sourceSlice(appSource, "const recoveryOtpForm", "const bindPasswordRecoveryButton");
  assert.match(binding, /verifySupabaseRecoveryOtp\(email,\s*token\)/u);
  assert.match(binding, /if\s*\(!verification\?\.ok\)[\s\S]*?return/u);
  assert.match(binding, /showSupabasePasswordSetupGate\("recovery"\)/u);
});

await check("O cancellation always returns to the explicit login gate after runtime authority was cleared", () => {
  const hideGate = sourceSlice(appSource, "function hideSupabaseRecoveryOtpGate", "window.hideSupabaseRecoveryOtpGate");
  assert.match(hideGate, /if\s*\(options\.returnToSource\s*===\s*true\)\s*\{\s*showFirstAccessRecovery\(\)/u);
  assert.ok(hideGate.indexOf("showFirstAccessRecovery()") < hideGate.indexOf("checkOverlaysInertState()"));
  assert.doesNotMatch(hideGate, /__nimrValidatedAuthUserId\s*=/u);
  assert.match(appSource, /bindPasswordRecoveryButton\("supabase-password-recovery",\s*"supabase-login-form",\s*""\)/u);
});

await check("P recovery password setup gets recovery-specific wording while invitation wording remains intact", () => {
  const gate = sourceSlice(appSource, "function showSupabasePasswordSetupGate", "window.showSupabasePasswordSetupGate");
  assert.match(gate, /Choisir un nouveau mot de passe/u);
  assert.match(gate, /Enregistrer le nouveau mot de passe/u);
  assert.match(gate, /Activer votre compte NIMR SAV/u);
  assert.match(gate, /Activer mon compte/u);
});

await check("Q password update still revalidates workshop_members after updateUser", () => {
  const setup = sourceSlice(clientSource, "async function completeSupabasePasswordSetup", "window.completeSupabasePasswordSetup");
  assert.match(setup, /client\.auth\.updateUser/u);
  assert.match(setup, /resolveSupabaseWorkshopMembership\(confirmedUser\)/u);
  assert.ok(setup.indexOf("resolveSupabaseWorkshopMembership(confirmedUser)") > setup.indexOf("client.auth.updateUser"));
});

await check("R the OTP itself is never persisted, audited or logged by the new recovery code", () => {
  const verifySource = sourceSlice(clientSource, "async function verifySupabaseRecoveryOtp", "window.verifySupabaseRecoveryOtp");
  const otpUiSource = sourceSlice(appSource, "const recoveryOtpForm", "const bindPasswordRecoveryButton");
  assert.doesNotMatch(`${verifySource}\n${otpUiSource}`, /addAuditLog|console\.|indexedDB/iu);
  assert.doesNotMatch(verifySource, /localStorage\.setItem|sessionStorage\.setItem/iu);
});

await check("S this ticket introduces no SQL, migration or service-role authority and D1 permits its test path", () => {
  const changedPaths = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).split(/\r?\n/u).filter(Boolean).map((line) => line.slice(3).replaceAll("\\", "/"));
  assert.equal(changedPaths.some((file) => file.startsWith("supabase/migrations/") || /\.sql$/iu.test(file)), false);
  const additions = execFileSync("git", ["diff", "--unified=0", BASE_SHA, "--", "app.js", "index.html", "js/supabase-client.js", "js/supabase-sync.js"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).split(/\r?\n/u).filter((line) => line.startsWith("+") && !line.startsWith("+++")).join("\n");
  assert.doesNotMatch(additions, /SUPABASE_SECRET|auth\.admin|service[_-]?role/iu);
  assert.match(d1Source, /tests\/identity_password_recovery_otp_identity001d2f\.test\.mjs/u);
});

await check("T PWA source refresh changes without changing the v23.3.28 cache/version contract", () => {
  assert.match(serviceWorkerSource, /IDENTITY-001D2-F source refresh/u);
  assert.match(serviceWorkerSource, /const CACHE_NAME = "nimr-sav-v23\.3\.28"/u);
  assert.match(readProjectFile("js/version.js"), /^window\.APP_VERSION = "v23\.3\.28";$/mu);
  assert.match(indexSource, /app\.js\?v=23\.3\.28/u);
});

assert.equal(passed.length + failures.length, 20, "IDENTITY-001D2-F must contain exactly checks A-T");

if (failures.length) {
  console.error(`\nIDENTITY-001D2-F REGRESSION SUITE: ${passed.length}/20 CHECKS PASSED (${failures.length} FAILED)`);
  failures.forEach(({ name, error }) => console.error(`\n${name}\n${error.stack || error.message}`));
  process.exitCode = 1;
} else {
  console.log("\nIDENTITY-001D2-F REGRESSION SUITE: 20/20 CHECKS PASSED");
}
