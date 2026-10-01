import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const migrationsDir = path.join(root, "supabase", "migrations");

function migrationPath() {
  const matches = fs.readdirSync(migrationsDir)
    .filter((name) => name.endsWith("_kha76_p1a_agency_scope_foundation.sql"));
  assert.equal(matches.length, 1, "exactly one P1A agency-scope migration is required");
  return path.join(migrationsDir, matches[0]);
}
const sql = () => fs.readFileSync(migrationPath(), "utf8");

test("P1A keeps agent_agence outside broad workshop membership", () => {
  const source = sql();
  assert.doesNotMatch(source, /workshop_members_role_canonical_check[\s\S]*agent_agence/iu);
  assert.doesNotMatch(source, /insert\s+into\s+public\.workshop_members[\s\S]*agent_agence/iu);
});

test("P1A adds nullable agency identity to canonical repair_claims only", () => {
  const source = sql();
  assert.match(source, /alter\s+table\s+public\.repair_claims\s+add\s+column\s+if\s+not\s+exists\s+agency_id\s+text/iu);
  assert.doesNotMatch(source, /create\s+table\s+[^;]*(?:warranty_cases|claims_network)/iu);
});

test("P1A creates server-authoritative agency memberships", () => {
  const source = sql();
  assert.match(source, /create\s+table\s+if\s+not\s+exists\s+public\.warranty_agency_members/iu);
  for (const col of ["workshop_id", "agency_id", "user_id", "capability", "active"]) {
    assert.match(source, new RegExp("\\b" + col + "\\b", "iu"));
  }
  assert.match(source, /capability[\s\S]*agent_agence/iu);
  assert.match(source, /foreign\s+key\s*\(\s*workshop_id\s*\)[\s\S]*public\.workshops/iu);
  assert.match(source, /foreign\s+key\s*\(\s*user_id\s*\)[\s\S]*auth\.users/iu);
});

test("P1A derives agency authority from auth.uid server-side", () => {
  const source = sql();
  assert.match(source, /nimr_is_warranty_agency_member/iu);
  assert.match(source, /auth\.uid\(\)/iu);
  assert.match(source, /agency_id/iu);
  assert.match(source, /active\s*=\s*true/iu);
});

test("P1A RLS permits only same-agency warranty claim reads", () => {
  const source = sql();
  assert.match(source, /create\s+policy\s+warranty_agency_repair_claims_select/iu);
  assert.match(source, /type\s*=\s*'garantie'/iu);
  assert.match(source, /agency_id\s+is\s+not\s+null/iu);
  assert.match(source, /nimr_is_warranty_agency_member\s*\(\s*workshop_id\s*,\s*agency_id\s*\)/iu);
});

test("P1A agency memberships are read-only from browser", () => {
  const source = sql();
  assert.match(source, /revoke\s+all\s+privileges\s+on\s+table\s+public\.warranty_agency_members\s+from\s+public\s*,\s*anon\s*,\s*authenticated/iu);
  assert.match(source, /grant\s+select\s+on\s+table\s+public\.warranty_agency_members\s+to\s+authenticated/iu);
  assert.doesNotMatch(source, /grant\s+(?:insert|update|delete)[^;]*warranty_agency_members[^;]*authenticated/iu);
});

test("P1A own membership visibility does not disclose other agencies", () => {
  const source = sql();
  assert.match(source, /create\s+policy\s+warranty_agency_members_self_select/iu);
  assert.match(source, /user_id\s*=\s*\(\s*select\s+auth\.uid\(\)\s*\)/iu);
});

test("P1A preserves P0c3 direct repair_claim DML revocation", () => {
  const source = sql();
  assert.doesNotMatch(source, /grant\s+(?:insert|update|delete)[^;]*public\.repair_claims[^;]*authenticated/iu);
});
