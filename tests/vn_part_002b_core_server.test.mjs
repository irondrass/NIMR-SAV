import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const migrationFile = path.join(repoRoot, "supabase/migrations/20260912131623_vn_part_002b_core_server.sql");
assert.equal(fs.existsSync(migrationFile), true, "La migration vn_part_002b_core_server doit exister");
const sql = fs.readFileSync(migrationFile, "utf8");

test("1. Schema contains all required tables and views", () => {
  assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+public\.vn_part_removals/i);
  assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+public\.vn_part_approvals/i);
  assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+public\.vn_part_audit_events/i);
  assert.match(sql, /create\s+or\s+replace\s+view\s+public\.vn_part_donor_state_v1/i);
});

test("2. All 8 lifecycle states exist in check constraint", () => {
  const expectedStates = [
    "EN_ATTENTE_VALIDATIONS",
    "REFUSE",
    "AUTORISE_A_PRELEVER",
    "PRELEVE_EN_ATTENTE_PIECE",
    "PIECE_DISPONIBLE",
    "RESTITUE_AU_VN",
    "CLOTURE",
    "ANNULE",
  ];
  for (const state of expectedStates) {
    assert.match(sql, new RegExp(`'${state}'`, "i"), `Status ${state} must exist in migration`);
  }
});

test("3. Exactly 3 mandatory approver roles", () => {
  const expectedApprovers = ["directeur", "directeur_pieces", "responsable_qualite_parc_vn"];
  const approverMatch = sql.match(/approval_role\s+in\s*\(([^)]+)\)/i);
  assert.ok(approverMatch, "Approval role check must exist");
  const extracted = approverMatch[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ""));
  assert.deepEqual(extracted.sort(), expectedApprovers.sort());
});

test("4. controle_qualite is excluded from VN approver authority", () => {
  assert.doesNotMatch(sql, /approval_role\s+in\s*\([^)]*controle_qualite/i);
  assert.doesNotMatch(sql, /v_caller_role\s+in\s*\([^)]*controle_qualite[^)]*\)\s*then\s*--.*APPROVE/i);
});

test("5. Initiator roles correct: chef_atelier, responsable_garantie_support", () => {
  assert.match(sql, /v_caller_role\s+not\s+in\s*\('chef_atelier',\s*'responsable_garantie_support'\)/i);
});

test("6. Directeur Pièces approval requires ETA", () => {
  assert.match(sql, /v_caller_role\s*=\s*'directeur_pieces'\s+then[\s\S]*?ETA_REQUIRED/i);
  assert.match(sql, /expected_replacement_date/i);
});

test("7. Parc VN approval requires donor model + VIN", () => {
  assert.match(sql, /v_caller_role\s*=\s*'responsable_qualite_parc_vn'\s+then[\s\S]*?DONOR_DATA_REQUIRED/i);
  assert.match(sql, /donor_model/i);
  assert.match(sql, /donor_vin/i);
});

test("8. Past ETA allowed: no constraint enforcing expected_replacement_date >= current_date", () => {
  assert.doesNotMatch(sql, /expected_replacement_date\s*>=/i);
  assert.doesNotMatch(sql, /expected_replacement_date\s*>\s*current_date/i);
});

test("9. 3 approvals required before authorization", () => {
  assert.match(sql, /v_approvals_count\s*=\s*3\s+then[\s\S]*?status\s*=\s*'AUTORISE_A_PRELEVER'/i);
});

test("10. Refusal requires mandatory reason", () => {
  assert.match(sql, /v_action\s*=\s*'REFUSE'[\s\S]*?REASON_REQUIRED/i);
});

test("11. Physical removal requires authorization (AUTORISE_A_PRELEVER)", () => {
  assert.match(sql, /v_action\s*=\s*'CONFIRM_REMOVAL'[\s\S]*?v_row\.status\s*<>\s*'AUTORISE_A_PRELEVER'/i);
  assert.match(sql, /PRELEVE_EN_ATTENTE_PIECE/i);
});

test("12. Availability requires prior removal (PRELEVE_EN_ATTENTE_PIECE)", () => {
  assert.match(sql, /v_action\s*=\s*'MARK_REPLACEMENT_AVAILABLE'[\s\S]*?v_row\.status\s*<>\s*'PRELEVE_EN_ATTENTE_PIECE'/i);
  assert.match(sql, /PIECE_DISPONIBLE/i);
});

test("13. Restitution requires availability (PIECE_DISPONIBLE)", () => {
  assert.match(sql, /v_action\s*=\s*'CONFIRM_RESTITUTION'[\s\S]*?v_row\.status\s*<>\s*'PIECE_DISPONIBLE'/i);
});

test("14. Cancellation impossible after removal", () => {
  assert.match(sql, /v_action\s*=\s*'CANCEL'[\s\S]*?v_row\.status\s*not\s*in\s*\('EN_ATTENTE_VALIDATIONS',\s*'AUTORISE_A_PRELEVER'\)[\s\S]*?CANNOT_CANCEL_AFTER_REMOVAL/i);
});

test("15. CAS / version guard exists and requires p_expected_version", () => {
  assert.match(sql, /EXPECTED_VERSION_REQUIRED/i);
  assert.match(sql, /v_row\.version\s*<>\s*p_expected_version[\s\S]*?VERSION_CONFLICT/i);
});

test("16. Successful mutation increments version", () => {
  assert.match(sql, /version\s*=\s*v_row\.version\s*\+\s*1/i);
});

test("17. Stale version fails with VERSION_CONFLICT code and structured payload", () => {
  assert.match(sql, /'code',\s*'VERSION_CONFLICT'/i);
  assert.match(sql, /'expected_version',\s*p_expected_version/i);
  assert.match(sql, /'current_version',\s*v_row\.version/i);
});

test("18. Audit is immutable: trigger prevents update and delete", () => {
  assert.match(sql, /create\s+or\s+replace\s+function\s+nimr_internal\.vn_part_prevent_audit_mutation/i);
  assert.match(sql, /before\s+update\s+or\s+delete\s+on\s+public\.vn_part_audit_events/i);
  assert.match(sql, /strictement immuables/i);
});

test("19. Every mutation path appends audit", () => {
  const expectedAuditActions = [
    "CREATE_REQUEST",
    "APPROVE",
    "REFUSE",
    "CANCEL",
    "REVISE_ETA",
    "REVISE_DONOR",
    "AUTHORIZE",
    "CONFIRM_REMOVAL",
    "STORE_ACK",
    "MARK_REPLACEMENT_AVAILABLE",
    "CONFIRM_RESTITUTION",
    "CLOSE",
  ];
  for (const action of expectedAuditActions) {
    assert.match(sql, new RegExp(`'${action}'`, "i"), `Audit action ${action} must be recorded`);
  }
});

test("20. Direct client business DML blocked", () => {
  assert.match(sql, /revoke\s+insert,\s*update,\s*delete\s+on\s+public\.vn_part_removals\s+from\s+public,\s*anon,\s*authenticated/i);
  assert.match(sql, /revoke\s+insert,\s*update,\s*delete\s+on\s+public\.vn_part_approvals\s+from\s+public,\s*anon,\s*authenticated/i);
  assert.match(sql, /revoke\s+insert,\s*update,\s*delete\s+on\s+public\.vn_part_audit_events\s+from\s+public,\s*anon,\s*authenticated/i);
});

test("21. Workshop isolation enforced in RLS policies and RPC", () => {
  assert.match(sql, /create\s+policy\s+vn_part_removals_read_policy[\s\S]*?public\.nimr_has_workshop_role\(workshop_id,/i);
  assert.match(sql, /create\s+policy\s+vn_part_approvals_read_policy[\s\S]*?public\.nimr_has_workshop_role\(workshop_id,/i);
  assert.match(sql, /create\s+policy\s+vn_part_audit_events_read_policy[\s\S]*?public\.nimr_has_workshop_role\(workshop_id,/i);
  assert.match(sql, /where\s+id\s*=\s*p_removal_id\s+and\s+workshop_id\s*=\s*p_workshop_id/i);
});

test("22. Reception denied: reception not in RLS allowed list", () => {
  const rlsMatch = sql.match(/create\s+policy\s+vn_part_removals_read_policy[\s\S]*?array\[([\s\S]*?)\]/i);
  assert.ok(rlsMatch, "RLS array must exist");
  assert.doesNotMatch(rlsMatch[1], /'reception'/i);
});

test("23. Technicien denied: technicien not in RLS allowed list", () => {
  const rlsMatch = sql.match(/create\s+policy\s+vn_part_removals_read_policy[\s\S]*?array\[([\s\S]*?)\]/i);
  assert.ok(rlsMatch, "RLS array must exist");
  assert.doesNotMatch(rlsMatch[1], /'technicien'/i);
});

test("24. Controle_qualite denied by default: controle_qualite not in RLS allowed list", () => {
  const rlsMatch = sql.match(/create\s+policy\s+vn_part_removals_read_policy[\s\S]*?array\[([\s\S]*?)\]/i);
  assert.ok(rlsMatch, "RLS array must exist");
  assert.doesNotMatch(rlsMatch[1], /'controle_qualite'/i);
});

test("25. admin_technique read-only/audit access only: not permitted in business mutating actions", () => {
  assert.match(sql, /'admin_technique'/i, "admin_technique must be in read RLS");
  assert.doesNotMatch(sql, /v_caller_role\s*in\s*\([^)]*admin_technique[^)]*\)\s*then/i, "admin_technique has no business workflow mutations");
});

test("26. responsable_magasin can mark availability but not administer workflow generally", () => {
  assert.match(sql, /v_action\s*=\s*'MARK_REPLACEMENT_AVAILABLE'[\s\S]*?v_caller_role\s*not\s*in\s*\('responsable_magasin',\s*'directeur_pieces'\)/i);
  assert.match(sql, /v_action\s*=\s*'STORE_ACK'[\s\S]*?v_caller_role\s*<>\s*'responsable_magasin'/i);

  const removalStartIndex = sql.indexOf("v_action = 'CONFIRM_REMOVAL'");
  const removalEndIndex = sql.indexOf("v_action = 'STORE_ACK'");
  const removalSection = sql.slice(removalStartIndex, removalEndIndex);
  assert.doesNotMatch(removalSection, /responsable_magasin/i);

  const restitutionStartIndex = sql.indexOf("v_action = 'CONFIRM_RESTITUTION'");
  const restitutionSection = sql.slice(restitutionStartIndex);
  assert.doesNotMatch(restitutionSection, /responsable_magasin/i);
});

test("27. Directeur Pièces can revise ETA", () => {
  assert.match(sql, /v_action\s*=\s*'REVISE_ETA'[\s\S]*?v_caller_role\s*<>\s*'directeur_pieces'/i);
});

test("28. Parc VN can revise donor data pre-removal", () => {
  assert.match(sql, /v_action\s*=\s*'REVISE_DONOR'[\s\S]*?v_caller_role\s*<>\s*'responsable_qualite_parc_vn'/i);
  assert.match(sql, /v_row\.status\s*not\s*in\s*\('EN_ATTENTE_VALIDATIONS',\s*'AUTORISE_A_PRELEVER'\)/i);
});

test("29. Donor physical incompleteness begins only after CONFIRM_REMOVAL (removed_at is not null)", () => {
  const viewStartIndex = sql.indexOf("create or replace view public.vn_part_donor_state_v1");
  const viewEndIndex = sql.indexOf("from public.vn_part_removals r");
  const viewSection = sql.slice(viewStartIndex, viewEndIndex);

  assert.match(viewSection, /where\s+r\.removed_at\s+is\s+not\s+null\s+and\s+r\.restored_at\s+is\s+null\s*\)\s*as\s+active_removals_remaining/i);
  assert.doesNotMatch(viewSection, /active_removals_remaining[\s\S]*?'AUTORISE_A_PRELEVER'/i);
});

test("30. can_be_restored_today semantics correct: active_removals_remaining > 0 and waiting_replacement_count = 0", () => {
  assert.match(sql, /count\(\*\)\s+filter\s*\(\s*where\s+r\.removed_at\s+is\s+not\s+null\s+and\s+r\.restored_at\s+is\s+null\s*\)\s*>\s*0[\s\S]*?and[\s\S]*?count\(\*\)\s+filter\s*\(\s*where\s+r\.removed_at\s+is\s+not\s+null\s+and\s+r\.restored_at\s+is\s+null\s+and\s+r\.replacement_available_at\s+is\s+null\s*\)\s*=\s*0[\s\S]*?as\s+can_be_restored_today/i);
});

test("31. is_fully_restored semantics correct: has historical physical removal and active_removals_remaining = 0", () => {
  assert.match(sql, /count\(\*\)\s+filter\s*\(\s*where\s+r\.removed_at\s+is\s+not\s+null\s*\)\s*>\s*0[\s\S]*?and[\s\S]*?count\(\*\)\s+filter\s*\(\s*where\s+r\.removed_at\s+is\s+not\s+null\s+and\s+r\.restored_at\s+is\s+null\s*\)\s*=\s*0[\s\S]*?as\s+is_fully_restored/i);
});

test("32. Overdue is derived, not a lifecycle status, and excludes PIECE_DISPONIBLE (replacement_available_at is null)", () => {
  assert.doesNotMatch(sql, /'EN_RETARD'/i);
  assert.doesNotMatch(sql, /'RETARD'/i);
  assert.doesNotMatch(sql, /'OVERDUE'/i);
  assert.match(sql, /where\s+r\.removed_at\s+is\s+not\s+null[\s\S]*?and\s+r\.replacement_available_at\s+is\s+null[\s\S]*?and\s+r\.expected_replacement_date\s*<\s*current_date[\s\S]*?as\s+overdue_count/i);
});

test("33. No price, currency or accounting fields", () => {
  assert.doesNotMatch(sql, /\b(?:price|cost|montant|devise|currency|tva|ht|ttc|invoice_amount|facturation)\b/i);
});

test("34. No stock quantity, warehouse bin or purchase workflow", () => {
  assert.doesNotMatch(sql, /\b(?:bin_location|emplacement_magasin|stock_qty|quantite_stock|purchase_order|commande_fournisseur)\b/i);
});

test("35. No NAVISION mutation", () => {
  assert.doesNotMatch(sql, /\b(?:navision|nav_sync|nav_export|nav_write)\b/i);
});

test("36. No email dispatcher in Phase 2", () => {
  assert.doesNotMatch(sql, /\b(?:send_email|email_queue|mail_dispatcher|smtp)\b/i);
});

test("37. No frontend VN-PART UI introduced in Phase 2", () => {
  const indexHtml = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  assert.doesNotMatch(indexHtml, /data-tab="vn-part"/i);
  assert.doesNotMatch(indexHtml, /VN restant à restituer/i);
});

test("38. Beneficiary VIN and Donor VIN collision check", () => {
  assert.match(sql, /vn_part_beneficiary_donor_vin_check/i);
  assert.match(sql, /BENEFICIARY_DONOR_VIN_COLLISION/i);
});

test("39. Self-approval prohibited", () => {
  assert.match(sql, /v_row\.created_by\s*=\s*v_caller_id[\s\S]*?CANNOT_APPROVE_OWN_REQUEST/i);
});

test("40. Concurrency Simulation: Version increment and collision rejection", () => {
  let version = 1;
  const simulateAction = (expectedVersion) => {
    if (expectedVersion !== version) {
      return { success: false, code: "VERSION_CONFLICT" };
    }
    version += 1;
    return { success: true, newVersion: version };
  };

  const firstCall = simulateAction(1);
  assert.equal(firstCall.success, true);
  assert.equal(firstCall.newVersion, 2);

  const staleCall = simulateAction(1);
  assert.equal(staleCall.success, false);
  assert.equal(staleCall.code, "VERSION_CONFLICT");

  const correctCall = simulateAction(2);
  assert.equal(correctCall.success, true);
  assert.equal(correctCall.newVersion, 3);
});

const calculateDonorState = (removals) => {
  const activeRemovals = removals.filter(r => r.removed_at != null && r.restored_at == null);
  const active_removals_remaining = activeRemovals.length;
  const parts_not_returned = active_removals_remaining;
  const waiting_replacement_count = activeRemovals.filter(r => r.replacement_available_at == null).length;
  const available_to_restore_count = activeRemovals.filter(r => r.replacement_available_at != null).length;
  const overdue_count = activeRemovals.filter(r => r.replacement_available_at == null && r.expected_replacement_date && new Date(r.expected_replacement_date) < new Date("2026-09-12")).length;
  const can_be_restored_today = active_removals_remaining > 0 && waiting_replacement_count === 0;
  const historicalRemovals = removals.filter(r => r.removed_at != null);
  const is_fully_restored = historicalRemovals.length > 0 && active_removals_remaining === 0;

  return {
    active_removals_remaining,
    parts_not_returned,
    waiting_replacement_count,
    available_to_restore_count,
    overdue_count,
    can_be_restored_today,
    is_fully_restored,
  };
};

test("41. Scenario A: Authorized but never removed", () => {
  const state = calculateDonorState([{
    status: "AUTORISE_A_PRELEVER",
    removed_at: null,
    replacement_available_at: null,
    restored_at: null,
  }]);
  assert.equal(state.active_removals_remaining, 0);
  assert.equal(state.waiting_replacement_count, 0);
  assert.equal(state.can_be_restored_today, false);
  assert.equal(state.is_fully_restored, false, "Must NOT be considered fully restored if it was never removed");
});

test("42. Scenario B: Refused request", () => {
  const state = calculateDonorState([{
    status: "REFUSE",
    removed_at: null,
    replacement_available_at: null,
    restored_at: null,
  }]);
  assert.equal(state.active_removals_remaining, 0);
  assert.equal(state.is_fully_restored, false, "Refused request must not flag donor as restored");
});

test("43. Scenario C: Cancelled request", () => {
  const state = calculateDonorState([{
    status: "ANNULE",
    removed_at: null,
    replacement_available_at: null,
    restored_at: null,
  }]);
  assert.equal(state.active_removals_remaining, 0);
  assert.equal(state.is_fully_restored, false, "Cancelled request must not flag donor as restored");
});

test("44. Scenario D: Removed and overdue", () => {
  const state = calculateDonorState([{
    status: "PRELEVE_EN_ATTENTE_PIECE",
    removed_at: "2026-09-01T10:00:00Z",
    replacement_available_at: null,
    restored_at: null,
    expected_replacement_date: "2026-09-05",
  }]);
  assert.equal(state.active_removals_remaining, 1);
  assert.equal(state.waiting_replacement_count, 1);
  assert.equal(state.overdue_count, 1, "Must count as overdue when replacement_available_at is null and ETA < today");
  assert.equal(state.can_be_restored_today, false);
  assert.equal(state.is_fully_restored, false);
});

test("45. Scenario E: Replacement becomes available after ETA", () => {
  const state = calculateDonorState([{
    status: "PIECE_DISPONIBLE",
    removed_at: "2026-09-01T10:00:00Z",
    replacement_available_at: "2026-09-10T15:00:00Z",
    restored_at: null,
    expected_replacement_date: "2026-09-05",
  }]);
  assert.equal(state.active_removals_remaining, 1);
  assert.equal(state.waiting_replacement_count, 0);
  assert.equal(state.available_to_restore_count, 1);
  assert.equal(state.overdue_count, 0, "Overdue count must be 0 once replacement_available_at is set");
  assert.equal(state.can_be_restored_today, true);
  assert.equal(state.is_fully_restored, false);
});

test("46. Scenario F: Mixed donor with 2 active removals (1 available, 1 waiting)", () => {
  const state = calculateDonorState([
    {
      status: "PIECE_DISPONIBLE",
      removed_at: "2026-09-01T10:00:00Z",
      replacement_available_at: "2026-09-10T15:00:00Z",
      restored_at: null,
      expected_replacement_date: "2026-09-05",
    },
    {
      status: "PRELEVE_EN_ATTENTE_PIECE",
      removed_at: "2026-09-02T11:00:00Z",
      replacement_available_at: null,
      restored_at: null,
      expected_replacement_date: "2026-09-20",
    },
  ]);
  assert.equal(state.active_removals_remaining, 2);
  assert.equal(state.available_to_restore_count, 1);
  assert.equal(state.waiting_replacement_count, 1);
  assert.equal(state.overdue_count, 0);
  assert.equal(state.can_be_restored_today, false, "Cannot be restored today while 1 part is still waiting replacement");
  assert.equal(state.is_fully_restored, false);
});

test("47. Scenario G: All active pieces available", () => {
  const state = calculateDonorState([
    {
      status: "PIECE_DISPONIBLE",
      removed_at: "2026-09-01T10:00:00Z",
      replacement_available_at: "2026-09-10T15:00:00Z",
      restored_at: null,
    },
    {
      status: "PIECE_DISPONIBLE",
      removed_at: "2026-09-02T11:00:00Z",
      replacement_available_at: "2026-09-11T09:00:00Z",
      restored_at: null,
    },
  ]);
  assert.equal(state.active_removals_remaining, 2);
  assert.equal(state.waiting_replacement_count, 0);
  assert.equal(state.available_to_restore_count, 2);
  assert.equal(state.can_be_restored_today, true);
  assert.equal(state.is_fully_restored, false);
});

test("48. Scenario H: All physically restored", () => {
  const state = calculateDonorState([
    {
      status: "CLOTURE",
      removed_at: "2026-09-01T10:00:00Z",
      replacement_available_at: "2026-09-05T12:00:00Z",
      restored_at: "2026-09-06T16:00:00Z",
    },
    {
      status: "RESTITUE_AU_VN",
      removed_at: "2026-09-02T11:00:00Z",
      replacement_available_at: "2026-09-07T08:00:00Z",
      restored_at: "2026-09-08T14:00:00Z",
    },
  ]);
  assert.equal(state.active_removals_remaining, 0);
  assert.equal(state.can_be_restored_today, false);
  assert.equal(state.is_fully_restored, true, "Must be true because donor had removals and all are restored");
});
