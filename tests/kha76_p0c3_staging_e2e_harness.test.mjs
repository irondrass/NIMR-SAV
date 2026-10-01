import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_STAGING_URL,
  buildPreloadScript,
  classifyAuthError,
  validateConfig,
} from "./helpers/kha76_p0c3_staging_e2e_runner.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const runnerPath = path.join(root, "tests", "helpers", "kha76_p0c3_staging_e2e_runner.mjs");
const browserHelperPath = path.join(root, "tests", "helpers", "cdp_browser_harness.mjs");

const baseConfig = {
  url: EXPECTED_STAGING_URL,
  anonKey: "sb_publishable_test_only",
  workshopId: "11111111-1111-4111-8111-111111111111",
  email: "e2e@example.test",
  password: "test-only-password",
  authMode: "existing",
};

test("KHA-76 E2E accepts only the canonical STAGING URL", () => {
  assert.equal(validateConfig(baseConfig).ok, true);
  const prod = validateConfig({
    ...baseConfig,
    url: "https://mkecnwolvzgxltrasbmr.supabase.co",
  });
  assert.equal(prod.ok, false);
  assert.equal(prod.status, "STAGING_URL_REJECTED");
});

test("KHA-76 E2E refuses secret/service_role keys", () => {
  for (const anonKey of ["sb_secret_example", "service_role", "service-role"]) {
    const checked = validateConfig({ ...baseConfig, anonKey });
    assert.equal(checked.ok, false);
    assert.equal(checked.status, "SECRET_KEY_REJECTED");
  }
});

test("KHA-76 E2E classifies Supabase auth blockers", () => {
  assert.equal(classifyAuthError("email rate limit exceeded"), "AUTH_BLOCKED");
  assert.equal(classifyAuthError("Email not confirmed"), "AUTH_CONFIRMATION_REQUIRED");
  assert.equal(classifyAuthError("Invalid login credentials"), "AUTH_INVALID");
});

test("KHA-76 E2E preloads STAGING config before app startup", () => {
  const source = buildPreloadScript(baseConfig);
  assert.match(source, /nimr-sav:supabase-runtime-config:v1/u);
  assert.match(source, /ijgstcdptyxjzgqlvooc\.supabase\.co/u);
  assert.match(source, /11111111-1111-4111-8111-111111111111/u);
  assert.doesNotMatch(source, /mkecnwolvzgxltrasbmr/u);
});

test("shared CDP helper supports pre-navigation injection", () => {
  const source = fs.readFileSync(browserHelperPath, "utf8");
  assert.match(source, /Page\.addScriptToEvaluateOnNewDocument/u);
  assert.match(source, /options\.preloadScript/u);
  assert.match(source, /options\.readyExpression/u);
});

test("KHA-76 E2E exercises the real P0c.3 authority boundary", () => {
  const source = fs.readFileSync(runnerPath, "utf8");
  assert.match(source, /upsertLegacyRepairClaims\(client, \[row\]\)/u);
  assert.match(source, /from\("repair_claims"\)\.insert/u);
  assert.match(source, /\.update\(\{ title: "DIRECT UPDATE MUST FAIL" \}\)/u);
  assert.match(source, /from\("repair_claims"\)\.delete/u);
  assert.match(source, /P0C3_STATUS_CHANGE_FORBIDDEN/u);
  assert.match(source, /directInsertBlocked/u);
  assert.match(source, /directUpdateBlocked/u);
  assert.match(source, /directDeleteBlocked/u);
  assert.match(source, /forgeBlocked/u);
});

test("KHA-76 E2E never logs password/token fields", () => {
  const source = fs.readFileSync(runnerPath, "utf8");
  assert.doesNotMatch(source, /console\.log\([^\n]*(?:password|access_token|refresh_token)/iu);
  assert.doesNotMatch(source, /service_role/u);
});
