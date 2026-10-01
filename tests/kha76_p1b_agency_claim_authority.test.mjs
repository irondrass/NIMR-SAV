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
    .filter((name) => name.endsWith("_kha76_p1b_agency_claim_authority.sql"));
  assert.equal(matches.length, 1, "exactly one P1B migration is required");
  return path.join(migrationsDir, matches[0]);
}
const sql = () => fs.readFileSync(migrationPath(), "utf8");

test("P1B adds explicit agency ownership to ORs and structured diagnostic fields to canonical claims", () => {
  const source = sql();
  assert.match(source, /alter\s+table\s+public\.repair_orders\s+add\s+column\s+if\s+not\s+exists\s+agency_id\s+text/iu);
  for (const col of [
    "agency_complaint_verbatim",
    "agency_diagnostic_findings",
    "agency_suspected_cause",
    "agency_causal_part_reference",
    "agency_dtc",
    "agency_mileage_at_diagnosis",
    "agency_diagnostic_recorded_at",
    "agency_diagnostic_recorded_by",
    "agency_idempotency_key",
  ]) {
    assert.match(source, new RegExp("\\b" + col + "\\b", "iu"));
  }
  assert.doesNotMatch(source, /create\s+table\s+[^;]*(?:warranty_cases|claims_network)/iu);
});

test("P1B derives agency from active server membership and fails closed on ambiguity", () => {
  const source = sql();
  assert.match(source, /from\s+public\.warranty_agency_members/iu);
  assert.match(source, /user_id\s*=\s*auth\.uid\(\)/iu);
  assert.match(source, /capability\s*=\s*'agent_agence'/iu);
  assert.match(source, /active\s*=\s*true/iu);
  assert.match(source, /P1B_AGENCY_SCOPE_FORBIDDEN/iu);
  assert.match(source, /P1B_AGENCY_SCOPE_AMBIGUOUS/iu);
  assert.doesNotMatch(source, /p_agency_id\s+text/iu);
});

test("P1B requires the OR to belong to the same workshop and derived agency", () => {
  const source = sql();
  assert.match(source, /from\s+public\.repair_orders/iu);
  assert.match(source, /workshop_id\s*=\s*p_workshop_id/iu);
  assert.match(source, /agency_id\s*=\s+agency_id_value/iu);
  assert.match(source, /deleted_at\s+is\s+null/iu);
  assert.match(source, /P1B_REPAIR_ORDER_SCOPE_FORBIDDEN/iu);
});

test("P1B validates exact AgencyDiagnostic vocabulary and rejects free-form authority fields", () => {
  const source = sql();
  for (const key of [
    "complaintVerbatim", "findings", "suspectedCause",
    "causalPartReference", "dtc", "mileageAtDiagnosis",
  ]) {
    assert.match(source, new RegExp("'" + key + "'", "u"));
  }
  for (const err of [
    "P1B_UNKNOWN_DIAGNOSTIC_FIELD",
    "P1B_COMPLAINT_REQUIRED",
    "P1B_FINDINGS_REQUIRED",
    "P1B_SUSPECTED_CAUSE_REQUIRED",
    "P1B_MILEAGE_INVALID",
    "P1B_DTC_INVALID",
  ]) {
    assert.match(source, new RegExp(err, "u"));
  }
  const whitelist = source.match(
    /jsonb_object_keys\(p_diagnostic\)[\s\S]*?where key <> all\(array\[([\s\S]*?)\]::text\[\]\)/iu,
  );
  assert.ok(whitelist, "diagnostic whitelist not found");
  assert.doesNotMatch(
    whitelist[1],
    /'agencyId'|'workshopId'|'status'|'oem_status'|'payment_status'/u,
  );
});

test("P1B create RPC forces a safe warranty draft and server-owned scope", () => {
  const source = sql();
  assert.match(source, /create\s+or\s+replace\s+function\s+public\.nimr_create_agency_warranty_draft/iu);
  assert.match(source, /type[\s\S]*'garantie'/iu);
  assert.match(source, /status[\s\S]*'draft'/iu);
  assert.match(source, /include_in_planning[\s\S]*false/iu);
  assert.match(source, /expert_approved[\s\S]*false/iu);
  assert.match(source, /client_approved[\s\S]*false/iu);
  assert.match(source, /amount[\s\S]*null/iu);
  assert.match(source, /agency_id[\s\S]*agency_id_value/iu);
  assert.match(source, /created_by[\s\S]*auth\.uid\(\)/iu);
});

test("P1B create RPC is idempotent and conflicts fail closed", () => {
  const source = sql();
  assert.match(source, /agency_idempotency_key/iu);
  assert.match(source, /unique\s+index[\s\S]*agency_idempotency_key/iu);
  assert.match(source, /P1B_IDEMPOTENCY_KEY_REQUIRED/iu);
  assert.match(source, /P1B_IDEMPOTENCY_CONFLICT/iu);
  assert.match(source, /'idempotent'\s*,\s*true/iu);
});

test("P1B update RPC is draft-only, same-agency and optimistic-versioned", () => {
  const source = sql();
  assert.match(source, /create\s+or\s+replace\s+function\s+public\.nimr_update_agency_warranty_draft/iu);
  assert.match(source, /p_expected_version\s+bigint/iu);
  assert.match(source, /P1B_CLAIM_SCOPE_FORBIDDEN/iu);
  assert.match(source, /P1B_DRAFT_LOCKED/iu);
  assert.match(source, /P1B_VERSION_CONFLICT/iu);
  assert.match(source, /where\s+id\s*=\s*p_claim_id[\s\S]*version\s*=\s*p_expected_version/iu);
});

test("P1B audit is append-only to authenticated clients and agency-scoped for reads", () => {
  const source = sql();
  assert.match(source, /create\s+table\s+if\s+not\s+exists\s+public\.warranty_agency_claim_events/iu);
  assert.match(source, /agency_draft_created/iu);
  assert.match(source, /agency_diagnostic_updated/iu);
  assert.match(source, /revoke\s+all\s+privileges\s+on\s+table\s+public\.warranty_agency_claim_events\s+from\s+public\s*,\s*anon\s*,\s*authenticated/iu);
  assert.match(source, /grant\s+select\s+on\s+table\s+public\.warranty_agency_claim_events\s+to\s+authenticated/iu);
  assert.doesNotMatch(source, /grant\s+(?:insert|update|delete)[^;]*warranty_agency_claim_events[^;]*authenticated/iu);
  assert.match(source, /nimr_is_warranty_agency_member\s*\(\s*workshop_id\s*,\s*agency_id\s*\)/iu);
});

test("P1B RPCs are authenticated-only and generic claim DML remains revoked", () => {
  const source = sql();
  assert.match(source, /revoke\s+all\s+on\s+function\s+public\.nimr_create_agency_warranty_draft[\s\S]*from\s+public/iu);
  assert.match(source, /revoke\s+all\s+on\s+function\s+public\.nimr_create_agency_warranty_draft[\s\S]*from\s+anon/iu);
  assert.match(source, /grant\s+execute\s+on\s+function\s+public\.nimr_create_agency_warranty_draft[\s\S]*to\s+authenticated/iu);
  assert.match(source, /revoke\s+insert\s*,\s*update\s*,\s*delete\s+on\s+table\s+public\.repair_claims\s+from\s+authenticated/iu);
  assert.doesNotMatch(source, /grant\s+(?:insert|update|delete)[^;]*public\.repair_claims[^;]*authenticated/iu);
});

test("P1B does not introduce submission, internal review, OEM, payment or stock authority", () => {
  const source = sql();
  assert.doesNotMatch(source, /nimr_(?:submit|review|approve|reject|reserve|ship)_agency/iu);
  assert.doesNotMatch(source, /oem_status|payment_status|stock_movement|inventory_movement/iu);
});
