import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const migrationsDir = path.join(root, "supabase", "migrations");
const runnerPath = path.join(root, "tests", "helpers", "kha76_p1b_staging_e2e_runner.mjs");

function migrationSource() {
  const matches = fs.readdirSync(migrationsDir)
    .filter((name) => name.endsWith("_kha76_p1b1_version_conflict_http.sql"));
  assert.equal(matches.length, 1, "exactly one P1B.1 migration is required");
  return fs.readFileSync(path.join(migrationsDir, matches[0]), "utf8");
}

test("P1B.1 replaces application misuse of serialization_failure", () => {
  const source = migrationSource();
  assert.doesNotMatch(source, /errcode\s*=\s*['"]40001['"]/iu);
  assert.doesNotMatch(source, /raise\s+sqlstate\s+['"]40001['"]/iu);
  const conflicts = source.match(/raise\s+sqlstate\s+['"]PT412['"]\s+using\s+message\s*=\s*['"]P1B_VERSION_CONFLICT['"]/giu) || [];
  assert.equal(conflicts.length, 3);
});
test("P1B.1 keeps the update RPC bounded and authenticated-only", () => {
  const source = migrationSource();
  assert.match(source, /create\s+or\s+replace\s+function\s+public\.nimr_update_agency_warranty_draft/iu);
  assert.match(source, /security\s+definer/iu);
  assert.match(source, /set\s+search_path\s*=\s*''/iu);
  assert.match(source, /claim_row\.status\s*<>\s*'draft'/iu);
  assert.match(source, /nimr_internal\.nimr_normalize_agency_diagnostic/iu);
  assert.match(source, /revoke\s+all\s+on\s+function[\s\S]*from\s+public\s*,\s*anon/iu);
  assert.match(source, /grant\s+execute\s+on\s+function[\s\S]*to\s+authenticated/iu);
});

test("P1B staging E2E expects HTTP 412 and refuses PROD", () => {
  const source = fs.readFileSync(runnerPath, "utf8");
  assert.match(source, /const\s+ref\s*=\s*['"]ijgstcdptyxjzgqlvooc['"]/u);
  assert.match(source, /const\s+prodRef\s*=\s*['"]mkecnwolvzgxltrasbmr['"]/u);
  assert.match(source, /PROD project is forbidden/u);
  assert.match(source, /stale_version_denied['"],\s*stale,\s*['"]PT412['"]/u);
  assert.match(source, /cleanup_verified_zero_residue/u);
  assert.doesNotMatch(source, /console\.log\([^\n]*(?:secret|password|token)/iu);
});
