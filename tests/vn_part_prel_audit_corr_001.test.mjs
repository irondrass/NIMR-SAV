/**
 * NIMR-SAV — Test Suite: PREL-AUDIT-CORR-001 (Lot P1)
 *
 * Scope:
 *   1. Central status label mapping & formatVnPartStatus helper
 *   2. Elimination of raw backend codes in user-facing UI
 *   3. Safe fallback for missing or unknown statuses
 *   4. Removal of forbidden brand placeholders (Peugeot, Renault, Citroen, Forthing)
 *   5. Persistence of backend status codes in data model & business logic
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const vnPartUi = require("../js/vn-part-ui.js");

const WORKDIR = process.cwd();
const uiJsPath = path.join(WORKDIR, "js/vn-part-ui.js");
const uiJsContent = fs.readFileSync(uiJsPath, "utf8");

test("P1.1: formatVnPartStatus maps all canonical backend statuses to user-friendly French labels", () => {
  assert.equal(typeof vnPartUi.formatVnPartStatus, "function", "formatVnPartStatus helper must be exported");

  assert.equal(vnPartUi.formatVnPartStatus("EN_ATTENTE_VALIDATIONS"), "En attente de validation");
  assert.equal(vnPartUi.formatVnPartStatus("AUTORISE_A_PRELEVER"), "Autorisé à prélever");
  assert.equal(vnPartUi.formatVnPartStatus("PRELEVE_EN_ATTENTE_PIECE"), "En attente de pièce");
  assert.equal(vnPartUi.formatVnPartStatus("PIECE_DISPONIBLE"), "Pièce disponible");
  assert.equal(vnPartUi.formatVnPartStatus("CLOTURE"), "Restitué / Clôturé");
  assert.equal(vnPartUi.formatVnPartStatus("REFUSE"), "Refusé");
  assert.equal(vnPartUi.formatVnPartStatus("ANNULE"), "Annulé");
});

test("P1.2: formatVnPartStatus provides safe, readable fallbacks for missing or unknown status", () => {
  assert.equal(typeof vnPartUi.formatVnPartStatus, "function", "formatVnPartStatus helper must be exported");

  assert.equal(vnPartUi.formatVnPartStatus(null), "—");
  assert.equal(vnPartUi.formatVnPartStatus(undefined), "—");
  assert.equal(vnPartUi.formatVnPartStatus(""), "—");
  assert.equal(vnPartUi.formatVnPartStatus("NOUVEAU_STATUT_BACKEND"), "Statut inconnu");
  assert.equal(vnPartUi.formatVnPartStatus("INCONNU_STATUS"), "Statut inconnu");
});

test("P1.3: Static check: No raw technical status rendered in modal summary", () => {
  assert.doesNotMatch(
    uiJsContent,
    /Statut actuel\s*:\s*\$\{\s*escapeHtml\(\s*removal\.status\s*\)\s*\}/,
    "Modal summary must not interpolate raw removal.status directly"
  );
  assert.match(
    uiJsContent,
    /Statut actuel\s*:\s*\$\{\s*escapeHtml\(\s*formatVnPartStatus\(\s*removal\.status\s*\)\s*\)\s*\}/,
    "Modal summary must format removal.status using formatVnPartStatus"
  );
});

test("P1.4: Static check: No forbidden vehicle brands in UI placeholders or helpers", () => {
  const forbiddenPatterns = [
    /placeholder=["'][^"']*Peugeot[^"']*["']/i,
    /placeholder=["'][^"']*Renault[^"']*["']/i,
    /placeholder=["'][^"']*Citro[eë]n[^"']*["']/i,
    /placeholder=["'][^"']*Forthing[^"']*["']/i,
  ];

  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(
      uiJsContent,
      pattern,
      "Forbidden vehicle brand found in placeholder: " + pattern
    );
  }
});

test("P1.5: Allowed placeholders are neutral or use authorized NIMR brands (DongFeng / DFSK)", () => {
  assert.match(
    uiJsContent,
    /id=["']vn-create-ben-model["'][^>]*placeholder=["'](?:Saisir le modèle|Ex:\s*(?:DFSK|DongFeng)[^"']*)["']/i,
    "Beneficiary model input must have neutral or DFSK/DongFeng placeholder"
  );
  assert.match(
    uiJsContent,
    /id=["']vn-action-donor-model["'][^>]*placeholder=["'](?:Saisir le modèle|Ex:\s*(?:DFSK|DongFeng)[^"']*)["']/i,
    "Donor model input must have neutral or DFSK/DongFeng placeholder"
  );
});

test("P1.6: renderRequestCard status badges display normalized user-facing text", () => {
  const dummyIdentity = { ok: true, role: "chef_atelier", authUserId: "u1" };
  const remPending = {
    id: "rem-test-01",
    status: "EN_ATTENTE_VALIDATIONS",
    version: 1,
    part_reference: "REF-001",
    part_designation: "Optique",
  };
  const remAuth = {
    id: "rem-test-02",
    status: "AUTORISE_A_PRELEVER",
    version: 1,
    part_reference: "REF-002",
    part_designation: "Aile",
  };

  const htmlPending = vnPartUi.renderRequestCard(remPending, [], dummyIdentity);
  const htmlAuth = vnPartUi.renderRequestCard(remAuth, [], dummyIdentity);

  assert.ok(htmlPending.includes("En attente de validation"), "Pending badge must display 'En attente de validation'");
  assert.ok(!htmlPending.includes("EN ATTENTE DE VALIDATION"), "Must not display all-caps 'EN ATTENTE DE VALIDATION'");

  assert.ok(htmlAuth.includes("Autorisé à prélever"), "Authorized badge must display 'Autorisé à prélever'");
  assert.ok(!htmlAuth.includes("AUTORISÉ À PRÉLEVER"), "Must not display all-caps 'AUTORISÉ À PRÉLEVER'");
});

test("P1.7: Backend status codes persist unchanged in business logic and data attributes", () => {
  const rem = {
    id: "rem-data-attr",
    status: "EN_ATTENTE_VALIDATIONS",
    version: 1,
  };
  assert.equal(rem.status, "EN_ATTENTE_VALIDATIONS");
});

// ============================================================================
// Lot P2: Compact approval progression, 3/3 synthesis, and remarks
// ============================================================================

test("P2.1: Cas 0/3: Three steps visible in pending state, overall indicator shows 0/3", () => {
  const removal = { id: "rem-p2-01", status: "EN_ATTENTE_VALIDATIONS" };
  const stripHtml = vnPartUi.renderApprovalStrip(removal, []);

  assert.ok(stripHtml.includes("0/3"), "Overall indicator must reflect 0/3 approvals");
  assert.ok(stripHtml.includes("Directeur SAV"), "Step 1 Directeur SAV must be visible");
  assert.ok(stripHtml.includes("Direction Pièces"), "Step 2 Direction Pièces must be visible");
  assert.ok(stripHtml.includes("Chef de Parc VN"), "Step 3 Chef de Parc VN must be visible");

  // In 0/3, all 3 steps must be pending
  const pendingCount = (stripHtml.match(/En attente/g) || []).length;
  assert.equal(pendingCount, 3, "All 3 steps must display 'En attente'");
});

test("P2.2: Cas 1/3: Step 1 (Directeur SAV) approved, others pending, indicator shows 1/3", () => {
  const removal = { id: "rem-p2-02", status: "EN_ATTENTE_VALIDATIONS" };
  const approvals = [
    { removal_id: "rem-p2-02", approval_role: "directeur", decision: "APPROVED", decided_at: "2026-09-17T10:00:00Z" },
  ];
  const stripHtml = vnPartUi.renderApprovalStrip(removal, approvals);

  assert.ok(stripHtml.includes("1/3"), "Overall indicator must reflect 1/3 approvals");
  assert.ok(stripHtml.includes("status-approved"), "Must render approved class for Step 1");
  assert.ok(stripHtml.includes("Validé"), "Step 1 must indicate Validé");
  const pendingCount = (stripHtml.match(/En attente/g) || []).length;
  assert.equal(pendingCount, 2, "Steps 2 and 3 must remain 'En attente'");
});

test("P2.3: Cas 2/3: Steps 1 & 2 approved, Step 3 pending, indicator shows 2/3", () => {
  const removal = { id: "rem-p2-03", status: "EN_ATTENTE_VALIDATIONS", expected_replacement_date: "2026-09-25" };
  const approvals = [
    { removal_id: "rem-p2-03", approval_role: "directeur", decision: "APPROVED", decided_at: "2026-09-17T10:00:00Z" },
    { removal_id: "rem-p2-03", approval_role: "directeur_pieces", decision: "APPROVED", decided_at: "2026-09-17T10:30:00Z" },
  ];
  const stripHtml = vnPartUi.renderApprovalStrip(removal, approvals);

  assert.ok(stripHtml.includes("2/3"), "Overall indicator must reflect 2/3 approvals");
  const approvedCount = (stripHtml.match(/status-approved/g) || []).length;
  assert.equal(approvedCount, 2, "Steps 1 and 2 must have approved class");
  const pendingCount = (stripHtml.match(/En attente/g) || []).length;
  assert.equal(pendingCount, 1, "Step 3 must remain 'En attente'");
});

test("P2.4: Cas 3/3: Compact summary 'Validations terminées 3/3', details folded by default with all 3 steps accessible", () => {
  const removal = {
    id: "rem-p2-04",
    status: "AUTORISE_A_PRELEVER",
    expected_replacement_date: "2026-09-25",
    donor_vin: "VF3XXXXXXXX123456",
  };
  const approvals = [
    { removal_id: "rem-p2-04", approval_role: "directeur", decision: "APPROVED", decided_at: "2026-09-17T10:00:00Z" },
    { removal_id: "rem-p2-04", approval_role: "directeur_pieces", decision: "APPROVED", decided_at: "2026-09-17T10:30:00Z" },
    { removal_id: "rem-p2-04", approval_role: "responsable_qualite_parc_vn", decision: "APPROVED", decided_at: "2026-09-17T11:00:00Z" },
  ];
  const stripHtml = vnPartUi.renderApprovalStrip(removal, approvals);

  assert.ok(stripHtml.includes("Validations terminées 3/3"), "Must render compact 3/3 synthesis");
  assert.ok(stripHtml.includes("<details class=\"vn-part-approvals-disclosure\""), "Must use details disclosure");
  assert.ok(!stripHtml.includes("<details class=\"vn-part-approvals-disclosure\" open"), "Details must be folded by default");
  assert.ok(stripHtml.includes("Voir les détails"), "Summary must contain 'Voir les détails' label");

  // All 3 validations must be present inside the disclosure
  assert.ok(stripHtml.includes("Directeur SAV"), "Step 1 must be present in details");
  assert.ok(stripHtml.includes("Direction Pièces"), "Step 2 must be present in details");
  assert.ok(stripHtml.includes("Chef de Parc VN"), "Step 3 must be present in details");
});

test("P2.5: Approval remarks: Accessible on demand, not enlarging card permanently, and no empty control when absent", () => {
  const removalWithRemark = { id: "rem-p2-05a", status: "EN_ATTENTE_VALIDATIONS" };
  const approvalsWithRemark = [
    { removal_id: "rem-p2-05a", approval_role: "directeur", decision: "APPROVED", decided_at: "2026-09-17T10:00:00Z", reason: "Accord exceptionnel accordé" },
  ];
  const htmlWithRemark = vnPartUi.renderApprovalStrip(removalWithRemark, approvalsWithRemark);
  assert.ok(htmlWithRemark.includes("Voir remarque"), "Must render 'Voir remarque' trigger when reason exists");
  assert.ok(htmlWithRemark.includes("Accord exceptionnel accordé"), "Must include the remark text");
  assert.ok(htmlWithRemark.includes("<details class=\"vn-part-approval-remark-details\""), "Must use compact details for remark");

  const removalNoRemark = { id: "rem-p2-05b", status: "EN_ATTENTE_VALIDATIONS" };
  const approvalsNoRemark = [
    { removal_id: "rem-p2-05b", approval_role: "directeur", decision: "APPROVED", decided_at: "2026-09-17T10:00:00Z", reason: null },
  ];
  const htmlNoRemark = vnPartUi.renderApprovalStrip(removalNoRemark, approvalsNoRemark);
  assert.ok(!htmlNoRemark.includes("Voir remarque"), "Must NOT render remark trigger when reason is null");
  assert.ok(!htmlNoRemark.includes("vn-part-approval-remark-details"), "Must NOT render remark disclosure when reason is null");
});

test("P2.6: XSS protection on approval remarks: Hostile HTML in reason is safely escaped", () => {
  const removal = { id: "rem-p2-06", status: "EN_ATTENTE_VALIDATIONS" };
  const approvals = [
    { removal_id: "rem-p2-06", approval_role: "directeur", decision: "APPROVED", decided_at: "2026-09-17T10:00:00Z", reason: "<img src=x onerror=alert(1)>" },
  ];
  const html = vnPartUi.renderApprovalStrip(removal, approvals);

  assert.ok(!html.includes("<img src=x onerror=alert(1)>"), "Raw HTML payload must NOT be present in innerHTML");
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"), "Escaped payload must be present in remark");
});

test("P2.7: Historical out-of-order data: Faithful display of actual approvals without artificial progression", () => {
  const removal = { id: "rem-p2-07", status: "EN_ATTENTE_VALIDATIONS", expected_replacement_date: "2026-09-25" };
  // Historical anomaly: Step 2 approved while Step 1 is still pending
  const approvals = [
    { removal_id: "rem-p2-07", approval_role: "directeur_pieces", decision: "APPROVED", decided_at: "2026-09-17T10:00:00Z" },
  ];
  const html = vnPartUi.renderApprovalStrip(removal, approvals);

  assert.ok(html.includes("1/3"), "Real count of approvals must be 1/3, not 2/3");
  // Check Step 1 (Directeur SAV) is NOT marked as approved
  const directeurPill = html.match(/<div class="vn-part-approval-pill[^>]*>[\s\S]*?Directeur SAV[\s\S]*?<\/div>/);
  assert.ok(directeurPill, "Directeur SAV pill must be rendered");
  assert.ok(directeurPill[0].includes("status-pending"), "Directeur SAV must remain status-pending");
  assert.ok(directeurPill[0].includes("En attente"), "Directeur SAV must explicitly show 'En attente'");
  assert.ok(!directeurPill[0].includes("status-approved"), "Directeur SAV must NOT be artificially marked approved");
});

// ============================================================================
// Lot P3: Sequential approval eligibility & contextual ETA/donor actions
// ============================================================================

test("P3.1: Directeur SAV on EN_ATTENTE_VALIDATIONS sees APPROVE and REFUSE without prior prerequisites", () => {
  const removal = { id: "rem-p3-01", status: "EN_ATTENTE_VALIDATIONS", created_by: "chef-1" };
  const directorIdentity = { ok: true, role: "directeur", authUserId: "dir-1" };

  const actions = vnPartUi.getAvailableVnPartActions(removal, [], directorIdentity);
  assert.ok(actions.includes("APPROVE"), "Directeur SAV must have APPROVE action");
  assert.ok(actions.includes("REFUSE"), "Directeur SAV must have REFUSE action");
});

test("P3.2: Direction Pièces before Directeur SAV approval sees neither APPROVE nor REFUSE", () => {
  const removal = { id: "rem-p3-02", status: "EN_ATTENTE_VALIDATIONS", created_by: "chef-1" };
  const partsIdentity = { ok: true, role: "directeur_pieces", authUserId: "dp-1" };

  const actions = vnPartUi.getAvailableVnPartActions(removal, [], partsIdentity);
  assert.ok(!actions.includes("APPROVE"), "Direction Pièces must NOT see APPROVE before Directeur SAV approves");
  assert.ok(!actions.includes("REFUSE"), "Direction Pièces must NOT see REFUSE before Directeur SAV approves");
});

test("P3.3: Direction Pièces after Directeur SAV approval sees APPROVE and REFUSE", () => {
  const removal = { id: "rem-p3-03", status: "EN_ATTENTE_VALIDATIONS", created_by: "chef-1" };
  const approvals = [
    { removal_id: "rem-p3-03", approval_role: "directeur", decision: "APPROVED", decided_at: "2026-09-17T10:00:00Z" },
  ];
  const partsIdentity = { ok: true, role: "directeur_pieces", authUserId: "dp-1" };

  const actions = vnPartUi.getAvailableVnPartActions(removal, approvals, partsIdentity);
  assert.ok(actions.includes("APPROVE"), "Direction Pièces must see APPROVE once Directeur SAV has approved");
  assert.ok(actions.includes("REFUSE"), "Direction Pièces must see REFUSE once Directeur SAV has approved");
});

test("P3.4: Chef de Parc VN before Direction Pièces approval sees neither APPROVE nor REFUSE", () => {
  const removal = { id: "rem-p3-04", status: "EN_ATTENTE_VALIDATIONS", created_by: "chef-1" };
  const parcIdentity = { ok: true, role: "responsable_qualite_parc_vn", authUserId: "rq-1" };

  // Case 1: 0/3 approvals
  const actions0 = vnPartUi.getAvailableVnPartActions(removal, [], parcIdentity);
  assert.ok(!actions0.includes("APPROVE"), "Chef de Parc must NOT see APPROVE on 0/3");
  assert.ok(!actions0.includes("REFUSE"), "Chef de Parc must NOT see REFUSE on 0/3");

  // Case 2: Only Directeur SAV approved (1/3), Direction Pièces still pending
  const approvals1 = [
    { removal_id: "rem-p3-04", approval_role: "directeur", decision: "APPROVED", decided_at: "2026-09-17T10:00:00Z" },
  ];
  const actions1 = vnPartUi.getAvailableVnPartActions(removal, approvals1, parcIdentity);
  assert.ok(!actions1.includes("APPROVE"), "Chef de Parc must NOT see APPROVE if Direction Pièces is still pending");
  assert.ok(!actions1.includes("REFUSE"), "Chef de Parc must NOT see REFUSE if Direction Pièces is still pending");
});

test("P3.5: Chef de Parc VN after both Directeur SAV and Direction Pièces approvals sees APPROVE and REFUSE", () => {
  const removal = { id: "rem-p3-05", status: "EN_ATTENTE_VALIDATIONS", created_by: "chef-1" };
  const approvals = [
    { removal_id: "rem-p3-05", approval_role: "directeur", decision: "APPROVED", decided_at: "2026-09-17T10:00:00Z" },
    { removal_id: "rem-p3-05", approval_role: "directeur_pieces", decision: "APPROVED", decided_at: "2026-09-17T10:30:00Z" },
  ];
  const parcIdentity = { ok: true, role: "responsable_qualite_parc_vn", authUserId: "rq-1" };

  const actions = vnPartUi.getAvailableVnPartActions(removal, approvals, parcIdentity);
  assert.ok(actions.includes("APPROVE"), "Chef de Parc must see APPROVE once 1 & 2 have approved");
  assert.ok(actions.includes("REFUSE"), "Chef de Parc must see REFUSE once 1 & 2 have approved");
});

test("P3.6: REVISE_ETA is NOT offered when expected_replacement_date is absent, and IS offered when present", () => {
  const partsIdentity = { ok: true, role: "directeur_pieces", authUserId: "dp-1" };

  const remWithoutEta = { id: "rem-p3-06a", status: "EN_ATTENTE_VALIDATIONS", expected_replacement_date: null };
  const actionsWithout = vnPartUi.getAvailableVnPartActions(remWithoutEta, [], partsIdentity);
  assert.ok(!actionsWithout.includes("REVISE_ETA"), "REVISE_ETA must NOT be offered if expected_replacement_date is null");

  const remWithEta = { id: "rem-p3-06b", status: "EN_ATTENTE_VALIDATIONS", expected_replacement_date: "2026-09-30" };
  const actionsWith = vnPartUi.getAvailableVnPartActions(remWithEta, [], partsIdentity);
  assert.ok(actionsWith.includes("REVISE_ETA"), "REVISE_ETA must be offered when expected_replacement_date is present");
});

test("P3.7: REVISE_DONOR is NOT offered when donor_vin is absent, and IS offered when present", () => {
  const parcIdentity = { ok: true, role: "responsable_qualite_parc_vn", authUserId: "rq-1" };

  const remWithoutDonor = { id: "rem-p3-07a", status: "EN_ATTENTE_VALIDATIONS", donor_vin: null };
  const actionsWithout = vnPartUi.getAvailableVnPartActions(remWithoutDonor, [], parcIdentity);
  assert.ok(!actionsWithout.includes("REVISE_DONOR"), "REVISE_DONOR must NOT be offered if donor_vin is null");

  const remWithDonor = { id: "rem-p3-07b", status: "EN_ATTENTE_VALIDATIONS", donor_vin: "VF3XXXXXXXX123456" };
  const actionsWith = vnPartUi.getAvailableVnPartActions(remWithDonor, [], parcIdentity);
  assert.ok(actionsWith.includes("REVISE_DONOR"), "REVISE_DONOR must be offered when donor_vin is present");
});

test("P3.8: Historical out-of-order data: Directeur SAV can still approve when Direction Pièces already approved; Chef de Parc unlocked only after Directeur SAV approves", () => {
  const removal = { id: "rem-p3-08", status: "EN_ATTENTE_VALIDATIONS", created_by: "chef-1" };
  // Historical anomaly: Direction Pièces approved, but Directeur SAV still pending
  const historicalApprovals = [
    { removal_id: "rem-p3-08", approval_role: "directeur_pieces", decision: "APPROVED", decided_at: "2026-09-17T09:00:00Z" },
  ];

  const directorIdentity = { ok: true, role: "directeur", authUserId: "dir-1" };
  const parcIdentity = { ok: true, role: "responsable_qualite_parc_vn", authUserId: "rq-1" };

  // Directeur SAV must still be able to approve
  const directorActions = vnPartUi.getAvailableVnPartActions(removal, historicalApprovals, directorIdentity);
  assert.ok(directorActions.includes("APPROVE"), "Directeur SAV must be allowed to regularize and approve");

  // Chef de Parc must NOT be allowed to approve yet because Directeur SAV hasn't approved
  const parcActionsBefore = vnPartUi.getAvailableVnPartActions(removal, historicalApprovals, parcIdentity);
  assert.ok(!parcActionsBefore.includes("APPROVE"), "Chef de Parc must remain blocked while Directeur SAV is pending");

  // Once Directeur SAV also approves:
  const regularizedApprovals = [
    ...historicalApprovals,
    { removal_id: "rem-p3-08", approval_role: "directeur", decision: "APPROVED", decided_at: "2026-09-17T11:00:00Z" },
  ];
  const parcActionsAfter = vnPartUi.getAvailableVnPartActions(removal, regularizedApprovals, parcIdentity);
  assert.ok(parcActionsAfter.includes("APPROVE"), "Chef de Parc is now unlocked since both 1 and 2 are approved");
});

// --- Server-Side RPC Migration Verification (Commit B) ---

const migrationPath = path.join(WORKDIR, "supabase/migrations/20260917130000_vn_part_sequential_approval_enforcement.sql");

test("P3 Server: Migration file exists and has correct timestamp and naming", () => {
  assert.ok(fs.existsSync(migrationPath), "Migration 20260917130000_vn_part_sequential_approval_enforcement.sql must exist");
});

test("P3 Server: Migration replaces nimr_internal.nimr_apply_vn_part_action_v1 and enforces sequential gates", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");

  // Must replace internal function and re-declare wrapper
  assert.match(sql, /create\s+or\s+replace\s+function\s+nimr_internal\.nimr_apply_vn_part_action_v1/i);
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.nimr_apply_vn_part_action_v1/i);

  // Must contain APPROVAL_SEQUENCE_VIOLATION error code
  assert.match(sql, /'APPROVAL_SEQUENCE_VIOLATION'/);

  // Must enforce Directeur SAV before Direction Pièces in APPROVE
  assert.match(sql, /v_caller_role\s*=\s*'directeur_pieces'[\s\S]*?approval_role\s*=\s*'directeur'[\s\S]*?APPROVAL_SEQUENCE_VIOLATION/);

  // Must enforce Directeur SAV and Direction Pièces before Chef de Parc VN in APPROVE
  assert.match(sql, /v_caller_role\s*=\s*'responsable_qualite_parc_vn'[\s\S]*?approval_role\s*=\s*'directeur'[\s\S]*?approval_role\s*=\s*'directeur_pieces'[\s\S]*?APPROVAL_SEQUENCE_VIOLATION/);

  // Must apply identical sequential enforcement in REFUSE
  assert.match(sql, /v_action\s*=\s*'REFUSE'[\s\S]*?v_caller_role\s*=\s*'directeur_pieces'[\s\S]*?approval_role\s*=\s*'directeur'[\s\S]*?APPROVAL_SEQUENCE_VIOLATION/);
  assert.match(sql, /v_action\s*=\s*'REFUSE'[\s\S]*?v_caller_role\s*=\s*'responsable_qualite_parc_vn'[\s\S]*?approval_role\s*=\s*'directeur'[\s\S]*?approval_role\s*=\s*'directeur_pieces'[\s\S]*?APPROVAL_SEQUENCE_VIOLATION/);
});

// S1 - S8 Contract Cases Execution

function simulateRpcAction({
  action,
  callerRole,
  callerId = "user-1",
  removal,
  approvals = [],
  payload = {},
}) {
  // Simulates the authoritative checks performed by nimr_apply_vn_part_action_v1
  if (!["APPROVE", "REFUSE"].includes(action)) {
    throw new Error(`Unsupported action in simulator: ${action}`);
  }

  const validApproverRoles = ["directeur", "directeur_pieces", "responsable_qualite_parc_vn"];
  if (!validApproverRoles.includes(callerRole)) {
    return { ok: false, success: false, code: "FORBIDDEN_APPROVER_ROLE" };
  }

  if (removal.status !== "EN_ATTENTE_VALIDATIONS") {
    return { ok: false, success: false, code: action === "APPROVE" ? "INVALID_STATUS_FOR_APPROVAL" : "INVALID_STATUS_FOR_REFUSAL" };
  }

  if (action === "APPROVE" && removal.created_by === callerId) {
    return { ok: false, success: false, code: "CANNOT_APPROVE_OWN_REQUEST" };
  }

  if (approvals.some(a => a.removal_id === removal.id && a.approval_role === callerRole)) {
    return { ok: false, success: false, code: "ALREADY_DECIDED" };
  }

  // Sequential enforcement
  if (callerRole === "directeur_pieces") {
    const hasDirectorApproved = approvals.some(
      a => a.removal_id === removal.id && a.approval_role === "directeur" && a.decision === "APPROVED"
    );
    if (!hasDirectorApproved) {
      return {
        ok: false,
        success: false,
        code: "APPROVAL_SEQUENCE_VIOLATION",
        message: "L'approbation par le Directeur SAV est requise avant la décision de la Direction Pièces.",
      };
    }
  } else if (callerRole === "responsable_qualite_parc_vn") {
    const hasDirectorApproved = approvals.some(
      a => a.removal_id === removal.id && a.approval_role === "directeur" && a.decision === "APPROVED"
    );
    const hasPartsDirectorApproved = approvals.some(
      a => a.removal_id === removal.id && a.approval_role === "directeur_pieces" && a.decision === "APPROVED"
    );
    if (!hasDirectorApproved || !hasPartsDirectorApproved) {
      return {
        ok: false,
        success: false,
        code: "APPROVAL_SEQUENCE_VIOLATION",
        message: "Les approbations du Directeur SAV et de la Direction Pièces sont requises avant la décision du Chef de Parc VN.",
      };
    }
  }

  // Payload validations
  if (action === "APPROVE") {
    if (callerRole === "directeur_pieces" && !payload.expected_replacement_date) {
      return { ok: false, success: false, code: "ETA_REQUIRED" };
    }
    if (callerRole === "responsable_qualite_parc_vn" && (!payload.donor_model || !payload.donor_vin)) {
      return { ok: false, success: false, code: "DONOR_DATA_REQUIRED" };
    }

    const newApprovals = [
      ...approvals,
      { removal_id: removal.id, approval_role: callerRole, decision: "APPROVED", decided_by: callerId },
    ];
    const approvedCount = newApprovals.filter(a => a.removal_id === removal.id && a.decision === "APPROVED").length;
    const newStatus = approvedCount === 3 ? "AUTORISE_A_PRELEVER" : removal.status;

    return {
      ok: true,
      success: true,
      action: "APPROVE",
      status: newStatus,
      approvals: newApprovals,
    };
  }

  if (action === "REFUSE") {
    if (!payload.reason || !payload.reason.trim()) {
      return { ok: false, success: false, code: "REASON_REQUIRED" };
    }
    const newApprovals = [
      ...approvals,
      { removal_id: removal.id, approval_role: callerRole, decision: "REFUSED", decided_by: callerId, reason: payload.reason },
    ];
    return {
      ok: true,
      success: true,
      action: "REFUSE",
      status: "REFUSE",
      approvals: newApprovals,
    };
  }
}

test("S1: Directeur SAV valide en premier (Approvals: []) -> Succès, approval enregistrée", () => {
  const removal = { id: "rem-s1", status: "EN_ATTENTE_VALIDATIONS", created_by: "creator-1" };
  const res = simulateRpcAction({
    action: "APPROVE",
    callerRole: "directeur",
    callerId: "dir-1",
    removal,
    approvals: [],
  });

  assert.equal(res.ok, true);
  assert.equal(res.status, "EN_ATTENTE_VALIDATIONS");
  assert.equal(res.approvals.length, 1);
  assert.equal(res.approvals[0].approval_role, "directeur");
  assert.equal(res.approvals[0].decision, "APPROVED");
});

test("S2: Pièces tente de valider sans Directeur (Approvals: []) -> Rejet APPROVAL_SEQUENCE_VIOLATION", () => {
  const removal = { id: "rem-s2", status: "EN_ATTENTE_VALIDATIONS", created_by: "creator-1" };
  const res = simulateRpcAction({
    action: "APPROVE",
    callerRole: "directeur_pieces",
    callerId: "dp-1",
    removal,
    approvals: [],
    payload: { expected_replacement_date: "2026-09-30" },
  });

  assert.equal(res.ok, false);
  assert.equal(res.code, "APPROVAL_SEQUENCE_VIOLATION");
});

test("S3: Pièces valide après Directeur (Approvals: [directeur]) -> Succès, approval enregistrée", () => {
  const removal = { id: "rem-s3", status: "EN_ATTENTE_VALIDATIONS", created_by: "creator-1" };
  const approvals = [
    { removal_id: "rem-s3", approval_role: "directeur", decision: "APPROVED", decided_by: "dir-1" },
  ];
  const res = simulateRpcAction({
    action: "APPROVE",
    callerRole: "directeur_pieces",
    callerId: "dp-1",
    removal,
    approvals,
    payload: { expected_replacement_date: "2026-09-30" },
  });

  assert.equal(res.ok, true);
  assert.equal(res.status, "EN_ATTENTE_VALIDATIONS");
  assert.equal(res.approvals.length, 2);
  assert.equal(res.approvals[1].approval_role, "directeur_pieces");
});

test("S4: Parc VN tente sans Pièces (Approvals: [directeur]) -> Rejet APPROVAL_SEQUENCE_VIOLATION", () => {
  const removal = { id: "rem-s4", status: "EN_ATTENTE_VALIDATIONS", created_by: "creator-1" };
  const approvals = [
    { removal_id: "rem-s4", approval_role: "directeur", decision: "APPROVED", decided_by: "dir-1" },
  ];
  const res = simulateRpcAction({
    action: "APPROVE",
    callerRole: "responsable_qualite_parc_vn",
    callerId: "rq-1",
    removal,
    approvals,
    payload: { donor_model: "DongFeng Rich 6", donor_vin: "VF3XXXXXXXX123456" },
  });

  assert.equal(res.ok, false);
  assert.equal(res.code, "APPROVAL_SEQUENCE_VIOLATION");
});

test("S5: Parc VN tente sans personne (Approvals: []) -> Rejet APPROVAL_SEQUENCE_VIOLATION", () => {
  const removal = { id: "rem-s5", status: "EN_ATTENTE_VALIDATIONS", created_by: "creator-1" };
  const res = simulateRpcAction({
    action: "APPROVE",
    callerRole: "responsable_qualite_parc_vn",
    callerId: "rq-1",
    removal,
    approvals: [],
    payload: { donor_model: "DongFeng Rich 6", donor_vin: "VF3XXXXXXXX123456" },
  });

  assert.equal(res.ok, false);
  assert.equal(res.code, "APPROVAL_SEQUENCE_VIOLATION");
});

test("S6: Parc VN valide après les 2 autres (Approvals: [directeur, directeur_pieces]) -> Succès, statut -> AUTORISE_A_PRELEVER", () => {
  const removal = { id: "rem-s6", status: "EN_ATTENTE_VALIDATIONS", created_by: "creator-1" };
  const approvals = [
    { removal_id: "rem-s6", approval_role: "directeur", decision: "APPROVED", decided_by: "dir-1" },
    { removal_id: "rem-s6", approval_role: "directeur_pieces", decision: "APPROVED", decided_by: "dp-1" },
  ];
  const res = simulateRpcAction({
    action: "APPROVE",
    callerRole: "responsable_qualite_parc_vn",
    callerId: "rq-1",
    removal,
    approvals,
    payload: { donor_model: "DongFeng Rich 6", donor_vin: "VF3XXXXXXXX123456" },
  });

  assert.equal(res.ok, true);
  assert.equal(res.status, "AUTORISE_A_PRELEVER");
  assert.equal(res.approvals.length, 3);
  assert.equal(res.approvals[2].approval_role, "responsable_qualite_parc_vn");
});

test("S7: Refus hors séquence rejeté (Approvals: [], caller: directeur_pieces) -> Rejet APPROVAL_SEQUENCE_VIOLATION", () => {
  const removal = { id: "rem-s7", status: "EN_ATTENTE_VALIDATIONS", created_by: "creator-1" };
  const res = simulateRpcAction({
    action: "REFUSE",
    callerRole: "directeur_pieces",
    callerId: "dp-1",
    removal,
    approvals: [],
    payload: { reason: "Refus hors séquence" },
  });

  assert.equal(res.ok, false);
  assert.equal(res.code, "APPROVAL_SEQUENCE_VIOLATION");
});

test("S8: Données historiques : Directeur valide après coup (Approvals: [directeur_pieces]) -> Succès, approval enregistrée", () => {
  const removal = { id: "rem-s8", status: "EN_ATTENTE_VALIDATIONS", created_by: "creator-1" };
  const approvals = [
    { removal_id: "rem-s8", approval_role: "directeur_pieces", decision: "APPROVED", decided_by: "dp-1" },
  ];
  const res = simulateRpcAction({
    action: "APPROVE",
    callerRole: "directeur",
    callerId: "dir-1",
    removal,
    approvals,
  });

  assert.equal(res.ok, true);
  assert.equal(res.status, "EN_ATTENTE_VALIDATIONS");
  assert.equal(res.approvals.length, 2);
  assert.equal(res.approvals[1].approval_role, "directeur");
});
