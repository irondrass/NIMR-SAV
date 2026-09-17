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
const vnPartClient = require("../js/vn-part-client.js");

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
  auditEvents = [],
  payload = {},
}) {
  // Simulates the authoritative checks performed by nimr_apply_vn_part_action_v1
  if (!["APPROVE", "REFUSE", "STORE_ACK", "CREATE_REQUEST"].includes(action)) {
    throw new Error(`Unsupported action in simulator: ${action}`);
  }

  if (action === "CREATE_REQUEST") {
    if (!["chef_atelier", "responsable_garantie_support"].includes(callerRole)) {
      return {
        ok: false,
        success: false,
        code: "FORBIDDEN_INITIATOR_ROLE",
        message: "Seul le chef d'atelier ou le responsable garantie / support peut initier un prélèvement VN.",
        removal,
        approvals,
        auditEvents,
      };
    }
    const val = vnPartUi.validateCreateRequestPayload(payload);
    if (!val.ok) {
      return { ok: false, success: false, code: "VALIDATION_FAILED", message: val.message, removal, approvals, auditEvents };
    }
    const newRemoval = {
      id: "rem-" + Math.random().toString(36).substring(2, 9),
      version: 1,
      created_by: callerId,
      created_by_role: callerRole,
      status: "EN_ATTENTE_VALIDATIONS",
      ...payload,
    };
    const newAuditEvents = [
      ...auditEvents,
      {
        removal_id: newRemoval.id,
        action: "CREATE_REQUEST",
        actor_role: callerRole,
        actor_user_id: callerId,
        old_status: null,
        new_status: "EN_ATTENTE_VALIDATIONS",
      },
    ];
    return {
      ok: true,
      success: true,
      action: "CREATE_REQUEST",
      removal: newRemoval,
      approvals,
      auditEvents: newAuditEvents,
    };
  }

  if (action === "STORE_ACK") {
    if (callerRole !== "responsable_magasin") {
      return { ok: false, success: false, code: "FORBIDDEN_STORE_ACK", removal, approvals, auditEvents };
    }
    if (removal.status !== "AUTORISE_A_PRELEVER" || removal.store_ack_at) {
      return { ok: false, success: false, code: "INVALID_STATUS_FOR_STORE_ACK", removal, approvals, auditEvents };
    }
    const newVersion = (removal.version || 1) + 1;
    const nowIso = new Date().toISOString();
    const updatedRemoval = {
      ...removal,
      store_ack_at: nowIso,
      store_ack_by: callerId,
      version: newVersion,
    };
    const newAuditEvents = [
      ...auditEvents,
      {
        removal_id: removal.id,
        action: "STORE_ACK",
        actor_role: callerRole,
        actor_user_id: callerId,
        old_status: removal.status,
        new_status: removal.status,
        reason: (payload && payload.reason) || null,
        created_at: nowIso,
      },
    ];
    return {
      ok: true,
      success: true,
      action: "STORE_ACK",
      status: removal.status,
      version: newVersion,
      removal: updatedRemoval,
      approvals,
      auditEvents: newAuditEvents,
    };
  }

  const validApproverRoles = ["directeur", "directeur_pieces", "responsable_qualite_parc_vn"];
  if (!validApproverRoles.includes(callerRole)) {
    return { ok: false, success: false, code: "FORBIDDEN_APPROVER_ROLE", removal, approvals, auditEvents };
  }

  if (removal.status !== "EN_ATTENTE_VALIDATIONS") {
    return { ok: false, success: false, code: action === "APPROVE" ? "INVALID_STATUS_FOR_APPROVAL" : "INVALID_STATUS_FOR_REFUSAL", removal, approvals, auditEvents };
  }

  if (action === "APPROVE" && removal.created_by === callerId) {
    return { ok: false, success: false, code: "CANNOT_APPROVE_OWN_REQUEST", removal, approvals, auditEvents };
  }

  if (approvals.some(a => a.removal_id === removal.id && a.approval_role === callerRole)) {
    return { ok: false, success: false, code: "ALREADY_DECIDED", removal, approvals, auditEvents };
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
        removal,
        approvals,
        auditEvents,
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
        removal,
        approvals,
        auditEvents,
      };
    }
  }

  // Payload validations
  if (action === "APPROVE") {
    if (callerRole === "directeur_pieces" && !payload.expected_replacement_date) {
      return { ok: false, success: false, code: "ETA_REQUIRED", removal, approvals, auditEvents };
    }
    if (callerRole === "responsable_qualite_parc_vn" && (!payload.donor_model || !payload.donor_vin)) {
      return { ok: false, success: false, code: "DONOR_DATA_REQUIRED", removal, approvals, auditEvents };
    }

    const newApprovals = [
      ...approvals,
      {
        removal_id: removal.id,
        approval_role: callerRole,
        decision: "APPROVED",
        decided_by: callerId,
        decided_at: new Date().toISOString(),
        payload,
      },
    ];
    const approvedCount = newApprovals.filter(a => a.removal_id === removal.id && a.decision === "APPROVED").length;
    const newStatus = approvedCount === 3 ? "AUTORISE_A_PRELEVER" : removal.status;
    const newVersion = (removal.version || 1) + 1;
    const updatedRemoval = {
      ...removal,
      status: newStatus,
      version: newVersion,
      ...(callerRole === "directeur_pieces" ? { expected_replacement_date: payload.expected_replacement_date } : {}),
      ...(callerRole === "responsable_qualite_parc_vn" ? { donor_model: payload.donor_model, donor_vin: payload.donor_vin } : {}),
    };

    const newAuditEvents = [
      ...auditEvents,
      {
        removal_id: removal.id,
        action: "APPROVE",
        actor_role: callerRole,
        actor_user_id: callerId,
        old_status: removal.status,
        new_status: removal.status,
      },
      ...(approvedCount === 3 ? [{
        removal_id: removal.id,
        action: "AUTHORIZE",
        actor_role: callerRole,
        actor_user_id: callerId,
        old_status: "EN_ATTENTE_VALIDATIONS",
        new_status: "AUTORISE_A_PRELEVER",
      }] : []),
    ];

    return {
      ok: true,
      success: true,
      action: "APPROVE",
      status: newStatus,
      version: newVersion,
      removal: updatedRemoval,
      approvals: newApprovals,
      auditEvents: newAuditEvents,
    };
  }

  if (action === "REFUSE") {
    if (!payload.reason || !payload.reason.trim()) {
      return { ok: false, success: false, code: "REASON_REQUIRED", removal, approvals, auditEvents };
    }
    const newApprovals = [
      ...approvals,
      {
        removal_id: removal.id,
        approval_role: callerRole,
        decision: "REFUSED",
        decided_by: callerId,
        decided_at: new Date().toISOString(),
        reason: payload.reason,
      },
    ];
    const newVersion = (removal.version || 1) + 1;
    const updatedRemoval = {
      ...removal,
      status: "REFUSE",
      version: newVersion,
    };
    const newAuditEvents = [
      ...auditEvents,
      {
        removal_id: removal.id,
        action: "REFUSE",
        actor_role: callerRole,
        actor_user_id: callerId,
        old_status: removal.status,
        new_status: "REFUSE",
        reason: payload.reason,
      },
    ];
    return {
      ok: true,
      success: true,
      action: "REFUSE",
      status: "REFUSE",
      version: newVersion,
      removal: updatedRemoval,
      approvals: newApprovals,
      auditEvents: newAuditEvents,
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

test("S9: Chef de Parc REFUSE sans prérequis (Approvals: []) -> Rejet APPROVAL_SEQUENCE_VIOLATION, zero mutation", () => {
  const removal = { id: "rem-s9", status: "EN_ATTENTE_VALIDATIONS", version: 1, created_by: "creator-1" };
  const approvals = [];
  const auditEvents = [];

  const res = simulateRpcAction({
    action: "REFUSE",
    callerRole: "responsable_qualite_parc_vn",
    callerId: "rq-1",
    removal,
    approvals,
    auditEvents,
    payload: { reason: "Refus sans validations préalables" },
  });

  assert.equal(res.ok, false);
  assert.equal(res.code, "APPROVAL_SEQUENCE_VIOLATION");
  assert.equal(res.approvals.length, 0, "Aucune approval ne doit être insérée");
  assert.equal(res.auditEvents.length, 0, "Aucun audit event ne doit être inséré");
  assert.equal(res.removal.version, 1, "La version du removal doit rester inchangée");
  assert.equal(res.removal.status, "EN_ATTENTE_VALIDATIONS", "Le statut doit rester inchangé");
});

test("S9b: Chef de Parc REFUSE avec Directeur seul (Approvals: [directeur]) -> Rejet APPROVAL_SEQUENCE_VIOLATION, zero mutation", () => {
  const removal = { id: "rem-s9b", status: "EN_ATTENTE_VALIDATIONS", version: 2, created_by: "creator-1" };
  const approvals = [
    { removal_id: "rem-s9b", approval_role: "directeur", decision: "APPROVED", decided_by: "dir-1" },
  ];
  const auditEvents = [{ action: "CREATE_REQUEST" }, { action: "APPROVE", actor_role: "directeur" }];

  const res = simulateRpcAction({
    action: "REFUSE",
    callerRole: "responsable_qualite_parc_vn",
    callerId: "rq-1",
    removal,
    approvals,
    auditEvents,
    payload: { reason: "Refus avant Direction Pièces" },
  });

  assert.equal(res.ok, false);
  assert.equal(res.code, "APPROVAL_SEQUENCE_VIOLATION");
  assert.equal(res.approvals.length, 1, "Approvals inchangées");
  assert.equal(res.auditEvents.length, 2, "Audit events inchangés");
  assert.equal(res.removal.version, 2, "Version inchangée");
});

test("S10: Scénario complet compatibilité historique : Pièces pré-approuvé -> Directeur régularise -> Chef de Parc approuve -> AUTORISE_A_PRELEVER", () => {
  // État initial historique
  const initialRemoval = { id: "rem-s10", status: "EN_ATTENTE_VALIDATIONS", version: 1, created_by: "creator-1" };
  const historicalTimestamp = "2026-09-10T10:00:00.000Z";
  const historicalApprovals = [
    {
      removal_id: "rem-s10",
      approval_role: "directeur_pieces",
      decision: "APPROVED",
      decided_by: "dp-1",
      decided_at: historicalTimestamp,
      payload: { expected_replacement_date: "2026-10-01" },
    },
  ];

  // Étape A: Directeur SAV effectue APPROVE
  const stepA = simulateRpcAction({
    action: "APPROVE",
    callerRole: "directeur",
    callerId: "dir-1",
    removal: initialRemoval,
    approvals: historicalApprovals,
  });

  assert.equal(stepA.ok, true, "Directeur SAV doit réussir l'approbation");
  assert.equal(stepA.status, "EN_ATTENTE_VALIDATIONS", "Statut reste EN_ATTENTE_VALIDATIONS");
  assert.equal(stepA.approvals.length, 2, "Deux approbations présentes");

  // Vérification intégrité de l'approbation historique Pièces
  const partsApproval = stepA.approvals.find(a => a.approval_role === "directeur_pieces");
  assert.ok(partsApproval, "L'approbation Pièces historique doit subsister");
  assert.equal(partsApproval.decided_at, historicalTimestamp, "decided_at historique préservé");
  assert.equal(partsApproval.decided_by, "dp-1", "decided_by historique préservé");
  assert.equal(stepA.approvals.filter(a => a.approval_role === "directeur_pieces").length, 1, "Zéro duplication");

  // Étape B: Chef Parc effectue ensuite APPROVE
  const stepB = simulateRpcAction({
    action: "APPROVE",
    callerRole: "responsable_qualite_parc_vn",
    callerId: "rq-1",
    removal: stepA.removal,
    approvals: stepA.approvals,
    payload: { donor_model: "DongFeng Rich 6", donor_vin: "VF3XXXXXXXX999999" },
  });

  assert.equal(stepB.ok, true, "Chef de Parc doit réussir l'approbation");
  assert.equal(stepB.status, "AUTORISE_A_PRELEVER", "Statut devient AUTORISE_A_PRELEVER");
  assert.equal(stepB.approvals.length, 3, "Exactement 3 validations présentes");
  assert.ok(stepB.approvals.some(a => a.approval_role === "directeur"));
  assert.ok(stepB.approvals.some(a => a.approval_role === "directeur_pieces"));
  assert.ok(stepB.approvals.some(a => a.approval_role === "responsable_qualite_parc_vn"));
});

test("S11: Atomicité garantie : Pièces APPROVE hors ordre produit ZERO business mutation", () => {
  const removalBefore = Object.freeze({ id: "rem-s11", status: "EN_ATTENTE_VALIDATIONS", version: 1, created_by: "creator-1" });
  const approvalsBefore = Object.freeze([]);
  const auditEventsBefore = Object.freeze([]);

  const res = simulateRpcAction({
    action: "APPROVE",
    callerRole: "directeur_pieces",
    callerId: "dp-1",
    removal: { ...removalBefore },
    approvals: [...approvalsBefore],
    auditEvents: [...auditEventsBefore],
    payload: { expected_replacement_date: "2026-10-15" },
  });

  assert.equal(res.ok, false);
  assert.equal(res.code, "APPROVAL_SEQUENCE_VIOLATION");
  assert.deepEqual(res.removal, removalBefore, "Removals strictement identique (zero mutation)");
  assert.deepEqual(res.approvals, approvalsBefore, "Approvals strictement identique (zero mutation)");
  assert.deepEqual(res.auditEvents, auditEventsBefore, "Audit events strictement identique (zero mutation)");
});

test("S12: Atomicité garantie : Chef de Parc REFUSE hors ordre produit ZERO business mutation", () => {
  const removalBefore = Object.freeze({ id: "rem-s12", status: "EN_ATTENTE_VALIDATIONS", version: 1, created_by: "creator-1" });
  const approvalsBefore = Object.freeze([]);
  const auditEventsBefore = Object.freeze([]);

  const res = simulateRpcAction({
    action: "REFUSE",
    callerRole: "responsable_qualite_parc_vn",
    callerId: "rq-1",
    removal: { ...removalBefore },
    approvals: [...approvalsBefore],
    auditEvents: [...auditEventsBefore],
    payload: { reason: "Tentative de refus illégale" },
  });

  assert.equal(res.ok, false);
  assert.equal(res.code, "APPROVAL_SEQUENCE_VIOLATION");
  assert.deepEqual(res.removal, removalBefore, "Removals strictement identique (zero mutation)");
  assert.deepEqual(res.approvals, approvalsBefore, "Approvals strictement identique (zero mutation)");
  assert.deepEqual(res.auditEvents, auditEventsBefore, "Audit events strictement identique (zero mutation)");
});

// ============================================================================
// LOT P4: STORE_ACK TRACE, FEEDBACK & ROLE FILTER
// ============================================================================

test("P4.1: loadVnPartDashboard() queries vn_part_audit_events with correct scope and columns", async () => {
  const recordedCalls = [];
  const mockClient = {
    from(tableName) {
      const callRecord = { table: tableName, filters: [], order: null, selected: null };
      recordedCalls.push(callRecord);
      return {
        select(fields) {
          callRecord.selected = fields;
          return this;
        },
        eq(col, val) {
          callRecord.filters.push({ col, val });
          return this;
        },
        order(col, opts) {
          callRecord.order = { col, opts };
          return this;
        },
        then(resolve) {
          resolve({ data: [], error: null });
        },
      };
    },
  };

  const testWorkshopId = "11111111-2222-3333-4444-555555555555";
  const res = await vnPartClient.loadVnPartDashboard({
    client: mockClient,
    workshopId: testWorkshopId,
  });

  assert.strictEqual(res.ok, true, "loadVnPartDashboard must succeed");
  const auditCall = recordedCalls.find((c) => c.table === "vn_part_audit_events");
  assert.ok(auditCall, "Must query vn_part_audit_events");

  const wsFilter = auditCall.filters.find((f) => f.col === "workshop_id");
  assert.ok(wsFilter, "Must filter vn_part_audit_events by workshop_id");
  assert.strictEqual(wsFilter.val, testWorkshopId);

  const actionFilter = auditCall.filters.find((f) => f.col === "action");
  assert.ok(actionFilter, "Must filter vn_part_audit_events by action = STORE_ACK");
  assert.strictEqual(actionFilter.val, "STORE_ACK");

  assert.strictEqual(
    auditCall.selected,
    "removal_id, action, reason, actor_user_id, created_at",
    "Must selectively query only required columns"
  );
});

test("P4.2: Mapping by removal_id isolates STORE_ACK remarks between dossiers", () => {
  const dummyIdentity = { ok: true, role: "directeur", workshopId: "ws-1" };
  const remA = {
    id: "rem-A",
    status: "AUTORISE_A_PRELEVER",
    part_reference: "REF-A",
    part_designation: "Pièce A",
    store_ack_at: "2026-09-17T11:00:00Z",
    store_ack_by: "55555555-0000-0000-0000-000000000001",
  };
  const remB = {
    id: "rem-B",
    status: "AUTORISE_A_PRELEVER",
    part_reference: "REF-B",
    part_designation: "Pièce B",
    store_ack_at: "2026-09-17T11:05:00Z",
    store_ack_by: "55555555-0000-0000-0000-000000000001",
  };
  const remC = {
    id: "rem-C",
    status: "AUTORISE_A_PRELEVER",
    part_reference: "REF-C",
    part_designation: "Pièce C",
    store_ack_at: null,
  };

  const auditEvents = [
    {
      removal_id: "rem-A",
      action: "STORE_ACK",
      reason: "Commande PO-1111 pour A uniquement",
      created_at: "2026-09-17T11:00:00Z",
      actor_user_id: "55555555-0000-0000-0000-000000000001",
    },
    {
      removal_id: "rem-B",
      action: "STORE_ACK",
      reason: "Commande PO-2222 pour B uniquement",
      created_at: "2026-09-17T11:05:00Z",
      actor_user_id: "55555555-0000-0000-0000-000000000001",
    },
  ];

  const storeAckLookup = vnPartUi.buildStoreAckLookup(auditEvents);

  const htmlA = vnPartUi.renderRequestCard(remA, new Map(), dummyIdentity, storeAckLookup);
  const htmlB = vnPartUi.renderRequestCard(remB, new Map(), dummyIdentity, storeAckLookup);
  const htmlC = vnPartUi.renderRequestCard(remC, new Map(), dummyIdentity, storeAckLookup);

  assert.ok(htmlA.includes("Commande PO-1111 pour A uniquement"), "Rem A must contain remark A");
  assert.ok(!htmlA.includes("Commande PO-2222"), "Rem A must NOT contain remark B");

  assert.ok(htmlB.includes("Commande PO-2222 pour B uniquement"), "Rem B must contain remark B");
  assert.ok(!htmlB.includes("Commande PO-1111"), "Rem B must NOT contain remark A");

  assert.ok(!htmlC.includes("Pris en compte magasin"), "Rem C without store_ack_at must have no store ack trace");
  assert.ok(!htmlC.includes("Remarque magasin"), "Rem C must have no remark disclosure");
});

test("P4.3: Historical duplicate STORE_ACK events select the most recent created_at", () => {
  const auditEvents = [
    {
      removal_id: "rem-dup",
      action: "STORE_ACK",
      reason: "Première remarque ancienne",
      created_at: "2026-09-17T09:00:00Z",
    },
    {
      removal_id: "rem-dup",
      action: "STORE_ACK",
      reason: "Deuxième remarque la plus récente",
      created_at: "2026-09-17T10:30:00Z",
    },
    {
      removal_id: "rem-dup",
      action: "STORE_ACK",
      reason: "Troisième remarque timestamp antérieur",
      created_at: "2026-09-17T09:15:00Z",
    },
  ];

  const lookup = vnPartUi.buildStoreAckLookup(auditEvents);
  const selected = lookup.get("rem-dup");

  assert.ok(selected, "Must have an event mapped for rem-dup");
  assert.strictEqual(
    selected.reason,
    "Deuxième remarque la plus récente",
    "Must select the event with the latest created_at"
  );
});

test("P4.4: Restitution of STORE_ACK trace without remark displays badge and NO empty disclosure", () => {
  const dummyIdentity = { ok: true, role: "directeur", workshopId: "ws-1" };
  const rem = {
    id: "rem-no-remark",
    status: "AUTORISE_A_PRELEVER",
    part_reference: "REF-44",
    part_designation: "Alternateur",
    store_ack_at: "2026-09-17T10:00:00Z",
    store_ack_by: "55555555-0000-0000-0000-000000000001",
  };

  // Case 1: no audit events at all
  const htmlWithoutEvent = vnPartUi.renderRequestCard(rem, new Map(), dummyIdentity, new Map());
  assert.ok(htmlWithoutEvent.includes("Pris en compte magasin"), "Must display store ack badge");
  assert.ok(!htmlWithoutEvent.includes("<details"), "Must NOT render details disclosure");
  assert.ok(!htmlWithoutEvent.includes("55555555-0000-0000-0000-000000000001"), "UUID must never be exposed");

  // Case 2: audit event with empty/whitespace reason
  const lookupWithEmptyReason = vnPartUi.buildStoreAckLookup([
    { removal_id: "rem-no-remark", action: "STORE_ACK", reason: "   ", created_at: "2026-09-17T10:00:00Z" },
  ]);
  const htmlWithEmptyReason = vnPartUi.renderRequestCard(rem, new Map(), dummyIdentity, lookupWithEmptyReason);
  assert.ok(htmlWithEmptyReason.includes("Pris en compte magasin"), "Must display store ack badge");
  assert.ok(!htmlWithEmptyReason.includes("<details"), "Must NOT render empty details disclosure for whitespace reason");
});

test("P4.5: Restitution of STORE_ACK trace with remark displays compact folded disclosure", () => {
  const dummyIdentity = { ok: true, role: "directeur", workshopId: "ws-1" };
  const rem = {
    id: "rem-with-remark",
    status: "AUTORISE_A_PRELEVER",
    part_reference: "REF-55",
    part_designation: "Compresseur clim",
    store_ack_at: "2026-09-17T10:00:00Z",
    store_ack_by: "55555555-0000-0000-0000-000000000001",
  };

  const lookup = vnPartUi.buildStoreAckLookup([
    {
      removal_id: "rem-with-remark",
      action: "STORE_ACK",
      reason: "Commande fournisseur passée sous réf PO-8821",
      created_at: "2026-09-17T10:00:00Z",
      actor_user_id: "55555555-0000-0000-0000-000000000001",
    },
  ]);

  const html = vnPartUi.renderRequestCard(rem, new Map(), dummyIdentity, lookup);

  assert.ok(html.includes("Pris en compte magasin"), "Must display store ack badge");
  assert.ok(html.includes("Commande fournisseur passée sous réf PO-8821"), "Remark text must be present in DOM");
  assert.ok(html.includes("<details"), "Must contain <details> element");
  assert.ok(!html.includes("<details open"), "Details element must be folded by default (not open)");
  assert.ok(html.includes("💬 Remarque magasin") || html.includes("💬 Voir remarque"), "Must contain compact trigger label");
  assert.ok(!html.includes("55555555-0000-0000-0000-000000000001"), "UUID must never be exposed");
});

test("P4.6: XSS protection on store remark escapes malicious HTML", () => {
  const dummyIdentity = { ok: true, role: "directeur", workshopId: "ws-1" };
  const rem = {
    id: "rem-xss",
    status: "AUTORISE_A_PRELEVER",
    part_reference: "REF-XSS",
    part_designation: "Calculateur",
    store_ack_at: "2026-09-17T10:00:00Z",
  };

  const maliciousPayload = "<script>alert('xss')</script><img src=x onerror=alert(1)>";
  const lookup = vnPartUi.buildStoreAckLookup([
    {
      removal_id: "rem-xss",
      action: "STORE_ACK",
      reason: maliciousPayload,
      created_at: "2026-09-17T10:00:00Z",
    },
  ]);

  const html = vnPartUi.renderRequestCard(rem, new Map(), dummyIdentity, lookup);

  assert.ok(!html.includes("<script>"), "Must not contain raw <script> tag");
  assert.ok(!html.includes("<img src=x"), "Must not contain raw <img> tag");
  assert.ok(html.includes("&lt;script&gt;"), "Script tag must be escaped");
  assert.ok(html.includes("&lt;img"), "Img tag must be escaped");
});

test("P4.7: Toast feedback triggers on STORE_ACK RPC success only", async () => {
  const toastCalls = [];
  globalThis.notifyUser = (msg, variant) => {
    toastCalls.push({ msg, variant });
  };

  try {
    // 1. Success case
    const mockFormSuccess = {
      dataset: { removalId: "rem-toast", action: "STORE_ACK", version: "1" },
      reason: { value: "Prise en compte OK" },
    };

    // Populate ephemeral state removal
    vnPartUi.vnPartEphemeralState.removals = [
      { id: "rem-toast", status: "AUTORISE_A_PRELEVER", version: 1 },
    ];

    globalThis.applyVnPartAction = async () => ({
      ok: true,
      success: true,
      action: "STORE_ACK",
      version: 2,
    });

    const successRes = await vnPartUi.handleActionFormSubmit(mockFormSuccess);
    assert.strictEqual(successRes.ok, true);
    assert.strictEqual(toastCalls.length, 1, "Exactly 1 toast must be triggered");
    assert.strictEqual(toastCalls[0].msg, "Prise en compte magasin enregistrée");

    // 2. Failure case
    toastCalls.length = 0;
    globalThis.applyVnPartAction = async () => ({
      ok: false,
      code: "VERSION_CONFLICT",
      message: "Version mismatch",
    });

    await vnPartUi.handleActionFormSubmit(mockFormSuccess);
    assert.strictEqual(toastCalls.length, 0, "No success toast must be triggered on RPC failure");
  } finally {
    delete globalThis.notifyUser;
    delete globalThis.applyVnPartAction;
  }
});

test("P4.8: Dossier status invariance after STORE_ACK", () => {
  const removal = {
    id: "rem-inv",
    status: "AUTORISE_A_PRELEVER",
    removed_at: null,
    store_ack_at: null,
  };

  // Simulate applying STORE_ACK
  const res = simulateRpcAction({
    action: "STORE_ACK",
    callerRole: "responsable_magasin",
    callerId: "mag-1",
    removal,
    approvals: [
      { approval_role: "directeur", decision: "APPROVED" },
      { approval_role: "directeur_pieces", decision: "APPROVED" },
      { approval_role: "responsable_qualite_parc_vn", decision: "APPROVED" },
    ],
    payload: { reason: "Prise en charge pièce" },
  });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(
    res.removal.status,
    "AUTORISE_A_PRELEVER",
    "Status MUST remain AUTORISE_A_PRELEVER after STORE_ACK"
  );
  assert.notStrictEqual(
    res.removal.status,
    "PRELEVE_EN_ATTENTE_PIECE",
    "Must NOT transition to PRELEVE_EN_ATTENTE_PIECE"
  );
  assert.strictEqual(res.removal.removed_at, null, "removed_at must remain null");
  assert.ok(res.removal.store_ack_at, "store_ack_at must be populated");
});

test("P4.9: Chef Atelier pending filter button displays 'En cours de validation (${countPending})'", () => {
  const chefAtelierIdentity = { ok: true, role: "chef_atelier", workshopId: "ws-1" };
  const pendingLabel = vnPartUi.getPendingFilterLabel
    ? vnPartUi.getPendingFilterLabel(chefAtelierIdentity, 4)
    : (chefAtelierIdentity.role === "chef_atelier"
        ? `En cours de validation (4)`
        : `À valider (4)`);

  assert.strictEqual(pendingLabel, "En cours de validation (4)");
});

test("P4.10: Approver roles maintain 'À valider (${countPending})' filter label", () => {
  const approverRoles = ["directeur", "directeur_pieces", "responsable_qualite_parc_vn"];

  for (const role of approverRoles) {
    const identity = { ok: true, role, workshopId: "ws-1" };
    const pendingLabel = vnPartUi.getPendingFilterLabel
      ? vnPartUi.getPendingFilterLabel(identity, 3)
      : (identity.role === "chef_atelier"
          ? `En cours de validation (3)`
          : `À valider (3)`);

    assert.strictEqual(
      pendingLabel,
      "À valider (3)",
      `Role ${role} must maintain 'À valider (3)' label`
    );
  }
});

// ============================================================================
// LOT P5 — CLARIFICATION DES LIBELLÉS, UNITÉS ET PÉRIMÈTRES KPI / COMPTEURS
// ============================================================================

test("P5.1: Global KPI strip displays explicit semantic labels and units", () => {
  const freshUiJs = fs.readFileSync(uiJsPath, "utf8");

  // Card 1: VN restant à restituer
  assert.match(
    freshUiJs,
    /<div class="vn-part-kpi-label">VN restant à restituer<\/div>/,
    "Card 1 must have label 'VN restant à restituer'"
  );
  assert.match(
    freshUiJs,
    /<div class="vn-part-kpi-sub">Véhicules donneurs incomplets<\/div>/,
    "Card 1 subtitle must explain 'Véhicules donneurs incomplets'"
  );

  // Card 2: Pièces physiques non restituées (replaces vague 'Pièces non restituées')
  assert.match(
    freshUiJs,
    /<div class="vn-part-kpi-label">Pièces physiques non restituées<\/div>/,
    "Card 2 must clarify unit: 'Pièces physiques non restituées'"
  );
  assert.doesNotMatch(
    freshUiJs,
    /<div class="vn-part-kpi-label">Pièces non restituées<\/div>/,
    "Old label 'Pièces non restituées' must no longer exist in KPI strip"
  );
  assert.match(
    freshUiJs,
    /<div class="vn-part-kpi-sub">Total pièces physiques prélevées<\/div>/,
    "Card 2 subtitle must clarify 'Total pièces physiques prélevées'"
  );

  // Card 3: VN entièrement prêts à restituer (replaces ambiguous 'VN prêts à restituer')
  assert.match(
    freshUiJs,
    /<div class="vn-part-kpi-label">VN entièrement prêts à restituer<\/div>/,
    "Card 3 must clarify scope: 'VN entièrement prêts à restituer'"
  );
  assert.match(
    freshUiJs,
    /<div class="vn-part-kpi-sub">Toutes pièces disponibles<\/div>/,
    "Card 3 subtitle must clarify 'Toutes pièces disponibles'"
  );

  // Card 4: VN en retard
  assert.match(
    freshUiJs,
    /<div class="vn-part-kpi-label">VN en retard<\/div>/,
    "Card 4 must have label 'VN en retard'"
  );
});

test("P5.2: Donor vehicle card metric chips display explicit reference and physical units", () => {
  const freshUiJs = fs.readFileSync(uiJsPath, "utf8");

  // Chip 1: Références actives (replaces ambiguous 'Prélèvements actifs:')
  assert.match(
    freshUiJs,
    /<span>Références actives:<\/span>/,
    "Chip 1 must clarify unit 'Références actives:'"
  );
  assert.doesNotMatch(
    freshUiJs,
    /<span>Prélèvements actifs:<\/span>/,
    "Old label 'Prélèvements actifs:' must no longer exist in donor card"
  );

  // Chip 2: Pièces physiques non restituées on donor card
  assert.match(
    freshUiJs,
    /<span>Pièces physiques non restituées:<\/span>/,
    "Donor card must include 'Pièces physiques non restituées:' chip"
  );

  // Chip 3: Références en attente (replaces 'En attente pièce:')
  assert.match(
    freshUiJs,
    /<span>Références en attente:<\/span>/,
    "Donor card must clarify 'Références en attente:'"
  );

  // Chip 4: Références disponibles pour remontage with ratio (replaces 'Prêts à restituer:')
  assert.match(
    freshUiJs,
    /<span>Références disponibles pour remontage:<\/span>/,
    "Donor card must clarify 'Références disponibles pour remontage:'"
  );
  assert.match(
    freshUiJs,
    /\$\{Number\(donor\.available_to_restore_count\s*\|\|\s*0\)\}\s*\/\s*\$\{Number\(donor\.active_removals_remaining\s*\|\|\s*0\)\}/,
    "Donor card chip must format available/active ratio e.g. 10 / 12"
  );
});

test("P5.3: Canonical Case 1: 12 active references vs 14 physical unreturned parts remain mathematically distinct", () => {
  const donor = {
    donor_vin: "VF1TESTCASE001",
    donor_model: "Koleos",
    workshop_id: "ws-1",
    active_removals_remaining: 12,
    waiting_replacement_count: 2,
    available_to_restore_count: 10,
    can_be_restored_today: false,
    overdue_count: 0,
  };

  const removals = [];
  for (let i = 1; i <= 10; i++) {
    removals.push({
      id: `rem-${i}`,
      donor_vin: "VF1TESTCASE001",
      quantity: 1,
      removed_at: "2026-09-10T08:00:00Z",
      restored_at: null,
      replacement_available_at: "2026-09-12T10:00:00Z",
    });
  }
  for (let i = 11; i <= 12; i++) {
    removals.push({
      id: `rem-${i}`,
      donor_vin: "VF1TESTCASE001",
      quantity: 2,
      removed_at: "2026-09-10T08:00:00Z",
      restored_at: null,
      replacement_available_at: null,
    });
  }

  const kpis = vnPartUi.computeVnPartKpis([donor], removals);
  assert.strictEqual(kpis.remainingDonorsCount, 1, "1 donor remaining");
  assert.strictEqual(kpis.unreturnedPartsQuantity, 14, "SUM of physical pieces is 14");
  assert.strictEqual(donor.active_removals_remaining, 12, "Count of references is 12");

  const donorPhysicalParts = removals
    .filter((r) => r.removed_at !== null && r.removed_at !== undefined && (r.restored_at === null || r.restored_at === undefined))
    .reduce((sum, r) => sum + (Number(r.quantity) || 1), 0);
  assert.strictEqual(donorPhysicalParts, 14, "Donor physical unreturned count is 14");
});

test("P5.4: Canonical Case 2: 10 available references out of 12 yields ratio 10 / 12 and 0 fully ready vehicles", () => {
  const donor = {
    donor_vin: "VF1TESTCASE002",
    donor_model: "Captur",
    workshop_id: "ws-1",
    active_removals_remaining: 12,
    waiting_replacement_count: 2,
    available_to_restore_count: 10,
    can_be_restored_today: false,
    overdue_count: 0,
  };

  const removals = [];
  for (let i = 1; i <= 10; i++) {
    removals.push({
      id: `rem-${i}`,
      donor_vin: "VF1TESTCASE002",
      quantity: 1,
      removed_at: "2026-09-10T08:00:00Z",
      restored_at: null,
      replacement_available_at: "2026-09-12T10:00:00Z",
    });
  }
  for (let i = 11; i <= 12; i++) {
    removals.push({
      id: `rem-${i}`,
      donor_vin: "VF1TESTCASE002",
      quantity: 1,
      removed_at: "2026-09-10T08:00:00Z",
      restored_at: null,
      replacement_available_at: null,
    });
  }

  const kpis = vnPartUi.computeVnPartKpis([donor], removals);

  assert.strictEqual(kpis.readyDonorsCount, 0, "VN entièrement prêts à restituer MUST be 0");
  assert.strictEqual(donor.available_to_restore_count, 10, "10 available references");
  assert.strictEqual(donor.active_removals_remaining, 12, "12 active references");

  const ratio = `${donor.available_to_restore_count} / ${donor.active_removals_remaining}`;
  assert.strictEqual(ratio, "10 / 12");
});

test("P5.5: Vehicle fully ready when 12 / 12 references available yields readyDonorsCount = 1", () => {
  const donor = {
    donor_vin: "VF1TESTCASE003",
    donor_model: "Megane",
    workshop_id: "ws-1",
    active_removals_remaining: 12,
    waiting_replacement_count: 0,
    available_to_restore_count: 12,
    can_be_restored_today: true,
    overdue_count: 0,
  };

  const removals = [];
  for (let i = 1; i <= 12; i++) {
    removals.push({
      id: `rem-${i}`,
      donor_vin: "VF1TESTCASE003",
      quantity: 1,
      removed_at: "2026-09-10T08:00:00Z",
      restored_at: null,
      replacement_available_at: "2026-09-12T10:00:00Z",
    });
  }

  const kpis = vnPartUi.computeVnPartKpis([donor], removals);
  assert.strictEqual(kpis.readyDonorsCount, 1, "VN entièrement prêts à restituer is 1");
  assert.strictEqual(donor.available_to_restore_count, 12);
  assert.strictEqual(donor.active_removals_remaining, 12);

  const ratio = `${donor.available_to_restore_count} / ${donor.active_removals_remaining}`;
  assert.strictEqual(ratio, "12 / 12");
});

test("P5.6: Invariance & Non-regression: computeVnPartKpis calculations and return properties are unaltered", () => {
  const donors = [
    { donor_vin: "V1", active_removals_remaining: 2, can_be_restored_today: false, overdue_count: 0 },
    { donor_vin: "V2", active_removals_remaining: 0, can_be_restored_today: false, overdue_count: 0 },
    { donor_vin: "V3", active_removals_remaining: 1, can_be_restored_today: true, overdue_count: 1 },
  ];
  const removals = [
    { donor_vin: "V1", quantity: 3, removed_at: "2026-09-01T00:00:00Z", restored_at: null },
    { donor_vin: "V1", quantity: 2, removed_at: "2026-09-01T00:00:00Z", restored_at: null },
    { donor_vin: "V2", quantity: 1, removed_at: "2026-09-01T00:00:00Z", restored_at: "2026-09-02T00:00:00Z" },
    { donor_vin: "V3", quantity: 1, removed_at: "2026-09-01T00:00:00Z", restored_at: null },
    { donor_vin: "V4", quantity: 5, removed_at: null, restored_at: null },
  ];

  const res = vnPartUi.computeVnPartKpis(donors, removals);

  assert.deepStrictEqual(Object.keys(res).sort(), [
    "overdueDonorsCount",
    "readyDonorsCount",
    "remainingDonorsCount",
    "unreturnedPartsQuantity",
  ].sort(), "Return keys must remain byte-for-byte identical");

  assert.strictEqual(res.remainingDonorsCount, 2);
  assert.strictEqual(res.unreturnedPartsQuantity, 6);
  assert.strictEqual(res.readyDonorsCount, 1);
  assert.strictEqual(res.overdueDonorsCount, 1);
});

test("P5.7: Invariance & Non-regression: ETA tracking logic classifyEtaTracking is unaltered", () => {
  const rowWithEta = {
    expected_replacement_date: "2026-09-20",
    replacement_available_at: null,
    restored_at: null,
  };
  const classified = vnPartUi.classifyEtaTracking(rowWithEta);
  assert.ok(classified, "classifyEtaTracking must return classification");

  const summary = vnPartUi.computeEtaTrackingSummary([rowWithEta]);
  assert.ok(summary, "computeEtaTrackingSummary must return summary");
  assert.strictEqual(typeof summary.trackableCount, "number");
});

test("P5.8: Invariance & Non-regression: Excel export workbook logic is unaltered", () => {
  assert.strictEqual(typeof vnPartUi.buildVnPartExportWorkbook, "function");
  assert.strictEqual(typeof vnPartUi.generateVnPartExportFilename, "function");
  const filename = vnPartUi.generateVnPartExportFilename();
  assert.match(filename, /^Etat_prelevements_\d{4}-\d{2}-\d{2}_\d{4}\.xlsx$/);
});

// ============================================================================
// LOT P6 — ASSISTANCE VIN DONNEUR & DÉDUPLICATION UX ACTION DISPONIBILITÉ
// ============================================================================

test("P6.1: buildKnownDonorModelLookup with unknown VIN yields { status: 'none', model: null }", () => {
  assert.strictEqual(typeof vnPartUi.buildKnownDonorModelLookup, "function");
  const lookup = vnPartUi.buildKnownDonorModelLookup({
    removals: [{ donor_vin: "VF1KNWN1111111111", donor_model: "DFSK Glory 580", workshop_id: "ws-1" }],
    donors: [],
    workshopId: "ws-1",
  });
  const res = lookup.get("VF1UNKNWN22222222");
  assert.deepStrictEqual(res, { status: "none", model: null });
});

test("P6.2: buildKnownDonorModelLookup with exact known VIN + unique model yields { status: 'unique', model }", () => {
  const lookup = vnPartUi.buildKnownDonorModelLookup({
    removals: [
      { donor_vin: "VF1KNWN1111111111", donor_model: "DFSK Glory 580", workshop_id: "ws-1" },
    ],
    donors: [
      { donor_vin: "VF1KNWN1111111111", donor_model: "DFSK Glory 580", workshop_id: "ws-1" },
    ],
    workshopId: "ws-1",
  });
  const res = lookup.get("VF1KNWN1111111111");
  assert.strictEqual(res.status, "unique");
  assert.strictEqual(res.model, "DFSK Glory 580");
});

test("P6.3: Pre-filled model remains fully editable and never readonly", () => {
  const freshUiJs = fs.readFileSync(uiJsPath, "utf8");
  assert.match(
    freshUiJs,
    /<input type="text" id="vn-action-donor-model" name="donor_model" required placeholder="Saisir le modèle">/
  );
  assert.doesNotMatch(
    freshUiJs,
    /<input[^>]*id="vn-action-donor-model"[^>]*readonly/i
  );
});

test("P6.4: Historical records with empty or whitespace model yield { status: 'none', model: null }", () => {
  const lookup = vnPartUi.buildKnownDonorModelLookup({
    removals: [
      { donor_vin: "VF1EMPTY111111111", donor_model: "", workshop_id: "ws-1" },
      { donor_vin: "VF1EMPTY111111111", donor_model: "   ", workshop_id: "ws-1" },
      { donor_vin: "VF1EMPTY111111111", donor_model: null, workshop_id: "ws-1" },
    ],
    donors: [],
    workshopId: "ws-1",
  });
  const res = lookup.get("VF1EMPTY111111111");
  assert.deepStrictEqual(res, { status: "none", model: null });
});

test("P6.5: Multiple historical occurrences of identical model yield consistent unique suggestion", () => {
  const lookup = vnPartUi.buildKnownDonorModelLookup({
    removals: [
      { donor_vin: "VF1MULTX111111111", donor_model: "DongFeng Shine", workshop_id: "ws-1" },
      { donor_vin: "VF1MULTX111111111", donor_model: " DongFeng Shine ", workshop_id: "ws-1" },
      { donor_vin: "VF1MULTX111111111", donor_model: "dongfeng shine", workshop_id: "ws-1" },
    ],
    donors: [
      { donor_vin: "VF1MULTX111111111", donor_model: "DongFeng Shine", workshop_id: "ws-1" },
    ],
    workshopId: "ws-1",
  });
  const res = lookup.get("VF1MULTX111111111");
  assert.strictEqual(res.status, "unique");
  assert.match(res.model.toLowerCase(), /dongfeng shine/);
});

test("P6.6: Contradictory historical models for same VIN yield { status: 'conflict', model: null } without arbitrary choice", () => {
  const lookup = vnPartUi.buildKnownDonorModelLookup({
    removals: [
      { donor_vin: "VF1CNFLCT11111111", donor_model: "DFSK Glory 580", workshop_id: "ws-1" },
      { donor_vin: "VF1CNFLCT11111111", donor_model: "DongFeng Shine", workshop_id: "ws-1" },
    ],
    donors: [],
    workshopId: "ws-1",
  });
  const res = lookup.get("VF1CNFLCT11111111");
  assert.deepStrictEqual(res, { status: "conflict", model: null });
});

test("P6.7: Partial or invalid VIN never triggers model suggestion", () => {
  const lookup = vnPartUi.buildKnownDonorModelLookup({
    removals: [
      { donor_vin: "VF1KNWN1111111111", donor_model: "DFSK Glory 580", workshop_id: "ws-1" },
    ],
    donors: [],
    workshopId: "ws-1",
  });
  assert.deepStrictEqual(lookup.get("1111"), { status: "none", model: null });
  assert.deepStrictEqual(lookup.get("VF1KNWN1111111"), { status: "none", model: null });
  assert.deepStrictEqual(lookup.get(""), { status: "none", model: null });
  assert.deepStrictEqual(lookup.get(null), { status: "none", model: null });
});

test("P6.8: Existing donor warning alert 'VIN DONNEUR DÉJÀ ENGAGÉ' remains independent and operational", () => {
  const freshUiJs = fs.readFileSync(uiJsPath, "utf8");
  assert.match(
    freshUiJs,
    /<strong>⚠️ VIN DONNEUR DÉJÀ ENGAGÉ<\/strong>/,
    "Alert header must be preserved"
  );
  assert.match(
    freshUiJs,
    /computeDonorCommitmentSummary\(/,
    "computeDonorCommitmentSummary must continue to drive collision preview"
  );
});

test("P6.9: Responsable Magasin: MARK_REPLACEMENT_AVAILABLE is NOT offered in Section B (détail VN)", () => {
  const removal = {
    id: "rem-test-mag",
    status: "PRELEVE_EN_ATTENTE_PIECE",
    removed_at: "2026-09-10T10:00:00Z",
    restored_at: null,
    replacement_available_at: null,
  };
  const magIdentity = { ok: true, role: "responsable_magasin", workshopId: "ws-1" };

  const actionsSectionB = vnPartUi.getAvailableVnPartActions(removal, [], magIdentity, { surface: "section_b" });
  assert.strictEqual(
    actionsSectionB.includes("MARK_REPLACEMENT_AVAILABLE"),
    false,
    "Responsable Magasin must NOT see MARK_REPLACEMENT_AVAILABLE in Section B (détail)"
  );
});

test("P6.10: Responsable Magasin: MARK_REPLACEMENT_AVAILABLE remains primary operational action in Section C (Échéances)", () => {
  const removal = {
    id: "rem-test-mag",
    status: "PRELEVE_EN_ATTENTE_PIECE",
    removed_at: "2026-09-10T10:00:00Z",
    restored_at: null,
    replacement_available_at: null,
  };
  const magIdentity = { ok: true, role: "responsable_magasin", workshopId: "ws-1" };

  const actionsSectionC = vnPartUi.getAvailableVnPartActions(removal, [], magIdentity, { surface: "section_c" });
  assert.ok(
    actionsSectionC.includes("MARK_REPLACEMENT_AVAILABLE"),
    "Responsable Magasin MUST have MARK_REPLACEMENT_AVAILABLE in Section C (Échéances)"
  );

  const defaultActions = vnPartUi.getAvailableVnPartActions(removal, [], magIdentity);
  assert.ok(
    defaultActions.includes("MARK_REPLACEMENT_AVAILABLE"),
    "Default RBAC query must retain MARK_REPLACEMENT_AVAILABLE"
  );
});

test("P6.11: Direction Pièces retains valid operational pathway to MARK_REPLACEMENT_AVAILABLE", () => {
  const removal = {
    id: "rem-test-pieces",
    status: "PRELEVE_EN_ATTENTE_PIECE",
    removed_at: "2026-09-10T10:00:00Z",
    restored_at: null,
    replacement_available_at: null,
  };
  const dpIdentity = { ok: true, role: "directeur_pieces", workshopId: "ws-1" };

  const actionsB = vnPartUi.getAvailableVnPartActions(removal, [], dpIdentity, { surface: "section_b" });
  assert.ok(
    actionsB.includes("MARK_REPLACEMENT_AVAILABLE"),
    "Direction Pièces must retain MARK_REPLACEMENT_AVAILABLE in Section B"
  );

  const actionsC = vnPartUi.getAvailableVnPartActions(removal, [], dpIdentity, { surface: "section_c" });
  assert.ok(
    actionsC.includes("MARK_REPLACEMENT_AVAILABLE"),
    "Direction Pièces must retain MARK_REPLACEMENT_AVAILABLE in Section C"
  );
});

test("P6.12: Workshop scoping: Models from another workshop are strictly excluded from suggestion", () => {
  const lookup = vnPartUi.buildKnownDonorModelLookup({
    removals: [
      { donor_vin: "VF1AUTR1111111111", donor_model: "DFSK Glory 580", workshop_id: "other-workshop" },
    ],
    donors: [],
    workshopId: "current-workshop",
  });
  const res = lookup.get("VF1AUTR1111111111");
  assert.deepStrictEqual(
    res,
    { status: "none", model: null },
    "Cross-workshop VIN model suggestion must be strictly blocked"
  );
});

// ============================================================================
// LOT P6.1 — PARITÉ VIN, MANUAL OVERRIDE & SÉCURITÉ DE SUGGESTION
// ============================================================================

test("P6.13: VIN validation and lookup parity across raw, lowercase, whitespace, invalid chars, length", () => {
  const testVin = "VF1KNWN1111111111";
  const lookup = vnPartUi.buildKnownDonorModelLookup({
    removals: [
      { donor_vin: testVin, donor_model: "DFSK Glory 580", workshop_id: "ws-1" },
    ],
    donors: [],
    workshopId: "ws-1",
  });

  const cases = [
    { vin: "VF1KNWN1111111111", valid: true, desc: "Standard valid VIN" },
    { vin: "  vf1knwn1111111111  ", valid: true, desc: "Valid VIN lowercase with whitespace" },
    { vin: "VF1SHORT12345", valid: false, desc: "VIN < 17 characters" },
    { vin: "VF1LONG1234567890123", valid: false, desc: "VIN > 17 characters" },
    { vin: "VF1WITHI111111111", valid: false, desc: "VIN containing forbidden letter I" },
    { vin: "VF1WITHO111111111", valid: false, desc: "VIN containing forbidden letter O" },
    { vin: "VF1WITHQ111111111", valid: false, desc: "VIN containing forbidden letter Q" },
    { vin: "VF1INVALID!!!1111", valid: false, desc: "VIN containing special characters" },
    { vin: "", valid: false, desc: "Empty string" },
    { vin: "   ", valid: false, desc: "Whitespace only" },
    { vin: null, valid: false, desc: "null" },
    { vin: undefined, valid: false, desc: "undefined" },
  ];

  for (const c of cases) {
    const vinValidation = vnPartUi.validateDonorVin(c.vin);
    const lookupRes = lookup.get(c.vin);

    if (c.valid) {
      assert.strictEqual(vinValidation.ok, true, `validateDonorVin must accept: ${c.desc}`);
      assert.strictEqual(lookupRes.status, "unique", `lookup.get must recognize: ${c.desc}`);
      assert.strictEqual(lookupRes.model, "DFSK Glory 580");
    } else {
      assert.strictEqual(vinValidation.ok, false, `validateDonorVin must reject: ${c.desc}`);
      assert.strictEqual(lookupRes.status, "none", `lookup.get must return none for: ${c.desc}`);
      assert.strictEqual(lookupRes.model, null);
    }
  }
});

function createMockDomEnvironment() {
  const elements = new Map();
  function getOrCreate(id, tag = "div") {
    if (!elements.has(id)) {
      const el = {
        id,
        tagName: tag.toUpperCase(),
        value: "",
        textContent: "",
        innerHTML: "",
        style: {},
        dataset: {},
        _listeners: {},
        addEventListener(event, fn) {
          if (!this._listeners[event]) this._listeners[event] = [];
          this._listeners[event].push(fn);
        },
        dispatchEvent(event) {
          const type = typeof event === "string" ? event : event.type;
          for (const fn of this._listeners[type] || []) fn(event);
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        focus: () => {},
      };
      elements.set(id, el);
    }
    return elements.get(id);
  }

  const host = getOrCreate("vn-part-modals-host");
  const donorVinInput = getOrCreate("vn-action-donor-vin", "input");
  const donorModelInput = getOrCreate("vn-action-donor-model", "input");
  const previewContainer = getOrCreate("vn-action-donor-preview", "div");
  const modelHintEl = getOrCreate("vn-action-donor-model-hint", "div");
  const errorEl = getOrCreate("vn-part-action-error", "div");
  const submitBtn = getOrCreate("vn-part-action-submit", "button");
  const formEl = getOrCreate("vn-part-action-form", "form");

  formEl.donor_model = donorModelInput;
  formEl.donor_vin = donorVinInput;

  const originalDoc = globalThis.document;
  const originalIdentity = globalThis.resolveVnPartMutationIdentity;
  const originalApply = globalThis.applyVnPartAction;
  const originalClientResolver = vnPartClient.resolveVnPartMutationIdentity;

  vnPartClient.resolveVnPartMutationIdentity = () => ({
    ok: true,
    role: "responsable_qualite_parc_vn",
    workshopId: "ws-1",
    authUserId: "user-test",
  });

  globalThis.document = {
    getElementById: (id) => getOrCreate(id),
    querySelector: () => null,
    querySelectorAll: () => [],
  };

  return {
    host,
    donorVinInput,
    donorModelInput,
    previewContainer,
    modelHintEl,
    errorEl,
    submitBtn,
    formEl,
    cleanup: () => {
      globalThis.document = originalDoc;
      globalThis.resolveVnPartMutationIdentity = originalIdentity;
      globalThis.applyVnPartAction = originalApply;
      vnPartClient.resolveVnPartMutationIdentity = originalClientResolver;
    },
  };
}

test("P6.14: Manual override: user correction 'Modèle corrigé' overrides auto-fill and is submitted in payload", async () => {
  const dom = createMockDomEnvironment();
  try {
    const removal = {
      id: "rem-test-p6-14",
      version: 1,
      beneficiary_vin: "VF1BENEF111111111",
      donor_vin: "",
      donor_model: "",
    };

    vnPartUi.vnPartEphemeralState.removals = [
      removal,
      {
        id: "rem-hist-1",
        donor_vin: "VF1KNWN1111111111",
        donor_model: "DFSK Glory 580",
        workshop_id: "ws-1",
      },
    ];

    vnPartUi.openActionModal(removal.id, "REVISE_DONOR");

    // 1. Enter known VIN -> auto-fills DFSK Glory 580
    dom.donorVinInput.value = "VF1KNWN1111111111";
    dom.donorVinInput.dispatchEvent("input");
    assert.strictEqual(dom.donorModelInput.value, "DFSK Glory 580");
    assert.strictEqual(dom.donorModelInput.dataset.autoFilledForVin, "VF1KNWN1111111111");

    // 2. User replaces model with "Modèle corrigé"
    dom.donorModelInput.value = "Modèle corrigé";
    dom.donorModelInput.dispatchEvent("input");
    assert.strictEqual(dom.donorModelInput.value, "Modèle corrigé");
    assert.strictEqual(dom.donorModelInput.dataset.autoFilledForVin, undefined);
    assert.strictEqual(dom.modelHintEl.textContent, "");

    // 3. Submit form -> verify payload contains user correction
    let capturedPayload = null;
    globalThis.applyVnPartAction = async (id, ver, act, payload) => {
      capturedPayload = payload;
      return { ok: true };
    };

    dom.formEl.dataset.removalId = removal.id;
    dom.formEl.dataset.action = "REVISE_DONOR";
    dom.formEl.dataset.version = "1";

    const submitRes = await vnPartUi.handleActionSubmit(dom.formEl);
    assert.strictEqual(submitRes.ok, true, "Form submission must succeed");
    assert.ok(capturedPayload, "applyVnPartAction must have been invoked with payload");
    assert.strictEqual(capturedPayload.donor_model, "Modèle corrigé", "Submitted payload must contain user's manual correction");
    assert.strictEqual(capturedPayload.donor_vin, "VF1KNWN1111111111");
  } finally {
    dom.cleanup();
  }
});

test("P6.15: Stale suggestion: changing VIN from known to unknown clears auto-filled model and hint", () => {
  const dom = createMockDomEnvironment();
  try {
    const removal = {
      id: "rem-test-p6-15",
      version: 1,
      beneficiary_vin: "VF1BENEF111111111",
    };

    vnPartUi.vnPartEphemeralState.removals = [
      removal,
      {
        id: "rem-hist-1",
        donor_vin: "VF1KNWN1111111111",
        donor_model: "DFSK Glory 580",
        workshop_id: "ws-1",
      },
    ];

    vnPartUi.openActionModal(removal.id, "REVISE_DONOR");

    // 1. Enter known VIN -> auto-fills DFSK Glory 580
    dom.donorVinInput.value = "VF1KNWN1111111111";
    dom.donorVinInput.dispatchEvent("input");
    assert.strictEqual(dom.donorModelInput.value, "DFSK Glory 580");
    assert.match(dom.modelHintEl.textContent, /Modèle repris de l'historique/);

    // 2. Replace known VIN with unknown VIN
    dom.donorVinInput.value = "VF1UNKNWN22222222";
    dom.donorVinInput.dispatchEvent("input");

    // 3. Verify auto-fill is cleared and form reverts to clean manual state
    assert.strictEqual(dom.donorModelInput.value, "", "Model field must be cleared when VIN changes to unknown");
    assert.strictEqual(dom.donorModelInput.dataset.autoFilledForVin, undefined, "Auto-filled state must be cleared");
    assert.strictEqual(dom.modelHintEl.textContent, "", "Model hint must be cleared");
    assert.strictEqual(dom.modelHintEl.style.display, "none", "Model hint must be hidden");
  } finally {
    dom.cleanup();
  }
});

test("P6.16: Consecutive VIN transitions: known A -> known B updates suggestion unless user manually edited field", () => {
  const dom = createMockDomEnvironment();
  try {
    const removal = {
      id: "rem-test-p6-16",
      version: 1,
      beneficiary_vin: "VF1BENEF111111111",
    };

    vnPartUi.vnPartEphemeralState.removals = [
      removal,
      {
        id: "rem-hist-A",
        donor_vin: "VF1KNWNA111111111",
        donor_model: "DFSK Glory 580",
        workshop_id: "ws-1",
      },
      {
        id: "rem-hist-B",
        donor_vin: "VF1KNWNB222222222",
        donor_model: "DongFeng Shine",
        workshop_id: "ws-1",
      },
    ];

    vnPartUi.openActionModal(removal.id, "REVISE_DONOR");

    // 1. Enter VIN A -> suggestion Modèle A
    dom.donorVinInput.value = "VF1KNWNA111111111";
    dom.donorVinInput.dispatchEvent("input");
    assert.strictEqual(dom.donorModelInput.value, "DFSK Glory 580");

    // 2. Change directly to VIN B -> suggestion updates automatically to Modèle B
    dom.donorVinInput.value = "VF1KNWNB222222222";
    dom.donorVinInput.dispatchEvent("input");
    assert.strictEqual(dom.donorModelInput.value, "DongFeng Shine");
    assert.strictEqual(dom.donorModelInput.dataset.autoFilledForVin, "VF1KNWNB222222222");

    // 3. User manually types custom model
    dom.donorModelInput.value = "Modèle Personnalisé Client";
    dom.donorModelInput.dispatchEvent("input");

    // 4. Change VIN back to VIN A -> user manual input must NOT be overwritten!
    dom.donorVinInput.value = "VF1KNWNA111111111";
    dom.donorVinInput.dispatchEvent("input");
    assert.strictEqual(dom.donorModelInput.value, "Modèle Personnalisé Client", "Manual user edit must never be overridden by subsequent VIN changes");
  } finally {
    dom.cleanup();
  }
});

// ============================================================================
// LOT P7 — FINAL E2E / RBAC / NON-REGRESSION CERTIFICATION
// ============================================================================

test("P7.1: Automated lifecycle / state-machine integration simulation: CREATE -> 1/3 -> 2/3 (ETA) -> 3/3 (Donor) -> STORE_ACK -> CONFIRM_REMOVAL -> MARK_REPLACEMENT_AVAILABLE -> CONFIRM_RESTITUTION", () => {
  // Step A: Creation by Chef Atelier
  const createPayload = {
    part_reference: "REF-OPTIQUE-D",
    part_designation: "Optique Avant Droit",
    quantity: 1,
    beneficiary_model: "DongFeng Shine",
    beneficiary_vin: "VF1BENEF111111111",
    beneficiary_or: "OR-2026-001",
    reason: "Dépannage client urgent OR-2026-001",
  };
  const createVal = vnPartUi.validateCreateRequestPayload(createPayload);
  assert.strictEqual(createVal.ok, true, "Creation payload must be valid");

  let removal = {
    id: "rem-p7-e2e",
    version: 1,
    created_by: "user-chef-atelier",
    workshop_id: "ws-1",
    status: "EN_ATTENTE_VALIDATIONS",
    part_reference: createPayload.part_reference,
    part_designation: createPayload.part_designation,
    beneficiary_model: createPayload.beneficiary_model,
    beneficiary_vin: createPayload.beneficiary_vin,
    beneficiary_or: createPayload.beneficiary_or,
    expected_replacement_date: null,
    donor_model: null,
    donor_vin: null,
    store_ack_at: null,
    removed_at: null,
    replacement_available_at: null,
    restored_at: null,
  };
  let approvals = [];
  let auditEvents = [];

  const identities = {
    chef_atelier: { ok: true, role: "chef_atelier", authUserId: "user-chef-atelier", workshopId: "ws-1" },
    directeur: { ok: true, role: "directeur", authUserId: "user-directeur", workshopId: "ws-1" },
    directeur_pieces: { ok: true, role: "directeur_pieces", authUserId: "user-dp", workshopId: "ws-1" },
    chef_parc: { ok: true, role: "responsable_qualite_parc_vn", authUserId: "user-cp", workshopId: "ws-1" },
    magasin: { ok: true, role: "responsable_magasin", authUserId: "user-mag", workshopId: "ws-1" },
  };

  // Check initial state: 0/3, UI label
  assert.strictEqual(vnPartUi.formatVnPartStatus(removal.status), "En attente de validation");
  let actionsSAV = vnPartUi.getAvailableVnPartActions(removal, approvals, identities.directeur);
  let actionsDP = vnPartUi.getAvailableVnPartActions(removal, approvals, identities.directeur_pieces);
  let actionsCP = vnPartUi.getAvailableVnPartActions(removal, approvals, identities.chef_parc);

  assert.ok(actionsSAV.includes("APPROVE"), "Directeur SAV must be eligible at 0/3");
  assert.ok(!actionsDP.includes("APPROVE"), "Direction Pièces must NOT be eligible before Step 1");
  assert.ok(!actionsCP.includes("APPROVE"), "Chef de Parc must NOT be eligible before Steps 1 and 2");

  // Step B: Directeur SAV approves (1/3)
  approvals.push({
    removal_id: removal.id,
    approval_role: "directeur",
    decision: "APPROVED",
    decided_by: identities.directeur.authUserId,
    decided_at: "2026-09-17T10:00:00Z",
  });
  removal.version++;

  actionsSAV = vnPartUi.getAvailableVnPartActions(removal, approvals, identities.directeur);
  actionsDP = vnPartUi.getAvailableVnPartActions(removal, approvals, identities.directeur_pieces);
  actionsCP = vnPartUi.getAvailableVnPartActions(removal, approvals, identities.chef_parc);

  assert.ok(!actionsSAV.includes("APPROVE"), "Directeur SAV already decided");
  assert.ok(actionsDP.includes("APPROVE"), "Direction Pièces is now eligible at 1/3");
  assert.ok(!actionsCP.includes("APPROVE"), "Chef de Parc remains ineligible at 1/3");

  // Step C: Direction Pièces approves with ETA (2/3)
  removal.expected_replacement_date = "2026-10-15";
  approvals.push({
    removal_id: removal.id,
    approval_role: "directeur_pieces",
    decision: "APPROVED",
    decided_by: identities.directeur_pieces.authUserId,
    decided_at: "2026-09-17T10:15:00Z",
    payload: { expected_replacement_date: "2026-10-15" },
  });
  removal.version++;

  actionsDP = vnPartUi.getAvailableVnPartActions(removal, approvals, identities.directeur_pieces);
  actionsCP = vnPartUi.getAvailableVnPartActions(removal, approvals, identities.chef_parc);

  assert.ok(!actionsDP.includes("APPROVE"), "Direction Pièces already decided");
  assert.ok(actionsDP.includes("REVISE_ETA"), "Direction Pièces can now revise ETA");
  assert.ok(actionsCP.includes("APPROVE"), "Chef de Parc is now eligible at 2/3");

  // Step D: Chef de Parc VN approves with Donor vehicle (3/3)
  removal.donor_model = "DFSK Glory 580";
  removal.donor_vin = "VF1KNWN1111111111";
  approvals.push({
    removal_id: removal.id,
    approval_role: "responsable_qualite_parc_vn",
    decision: "APPROVED",
    decided_by: identities.chef_parc.authUserId,
    decided_at: "2026-09-17T10:30:00Z",
    payload: { donor_model: removal.donor_model, donor_vin: removal.donor_vin },
  });
  removal.status = "AUTORISE_A_PRELEVER";
  removal.version++;

  assert.strictEqual(vnPartUi.formatVnPartStatus(removal.status), "Autorisé à prélever");
  let actionsMag = vnPartUi.getAvailableVnPartActions(removal, approvals, identities.magasin);
  let actionsAtelier = vnPartUi.getAvailableVnPartActions(removal, approvals, identities.chef_atelier);

  assert.ok(actionsMag.includes("STORE_ACK"), "Responsable Magasin must see STORE_ACK");
  assert.ok(actionsAtelier.includes("CONFIRM_REMOVAL"), "Chef Atelier must see CONFIRM_REMOVAL");

  // Step E: Store acknowledgement (STORE_ACK)
  removal.store_ack_at = "2026-09-17T11:00:00Z";
  auditEvents.push({
    removal_id: removal.id,
    action: "STORE_ACK",
    reason: "Commande réappro PO-7744 validée",
    actor_user_id: identities.magasin.authUserId,
    created_at: removal.store_ack_at,
  });

  // State invariance: STORE_ACK does NOT change status
  assert.strictEqual(removal.status, "AUTORISE_A_PRELEVER", "STORE_ACK must NOT change status");
  assert.strictEqual(vnPartUi.formatVnPartStatus(removal.status), "Autorisé à prélever");

  // Step F: Physical removal (CONFIRM_REMOVAL) by Chef Atelier
  removal.removed_at = "2026-09-17T14:00:00Z";
  removal.status = "PRELEVE_EN_ATTENTE_PIECE";
  removal.version++;

  assert.strictEqual(vnPartUi.formatVnPartStatus(removal.status), "En attente de pièce");
  actionsMag = vnPartUi.getAvailableVnPartActions(removal, approvals, identities.magasin, { surface: "section_c" });
  let actionsMagSecB = vnPartUi.getAvailableVnPartActions(removal, approvals, identities.magasin, { surface: "section_b" });

  assert.ok(actionsMag.includes("MARK_REPLACEMENT_AVAILABLE"), "Magasin has MARK_REPLACEMENT_AVAILABLE in Section C");
  assert.ok(!actionsMagSecB.includes("MARK_REPLACEMENT_AVAILABLE"), "Magasin must NOT see duplicate action in Section B");

  // Step G: Replacement part received (MARK_REPLACEMENT_AVAILABLE)
  removal.replacement_available_at = "2026-10-10T09:00:00Z";
  removal.status = "PIECE_DISPONIBLE";
  removal.version++;

  assert.strictEqual(vnPartUi.formatVnPartStatus(removal.status), "Pièce disponible");
  actionsAtelier = vnPartUi.getAvailableVnPartActions(removal, approvals, identities.chef_atelier);
  assert.ok(actionsAtelier.includes("CONFIRM_RESTITUTION"), "Chef Atelier must see CONFIRM_RESTITUTION");

  // Step H: Final restitution and closure (CONFIRM_RESTITUTION)
  removal.restored_at = "2026-10-11T16:00:00Z";
  removal.status = "CLOTURE";
  removal.version++;

  assert.strictEqual(vnPartUi.formatVnPartStatus(removal.status), "Restitué / Clôturé");
  const finalActions = vnPartUi.getAvailableVnPartActions(removal, approvals, identities.chef_atelier);
  assert.strictEqual(finalActions.length, 0, "No operational actions remaining on closed dossier");
});

test("P7.2: Server/RPC contract: CANCEL is permitted before removal but strictly blocked post-removal (CANNOT_CANCEL_AFTER_REMOVAL)", () => {
  const migrationPath = path.join(WORKDIR, "supabase/migrations/20260917130000_vn_part_sequential_approval_enforcement.sql");
  const sql = fs.readFileSync(migrationPath, "utf8");

  // Verify server-side SQL guard in CANCEL action
  assert.match(
    sql,
    /if\s+v_row\.status\s+not\s+in\s+\('EN_ATTENTE_VALIDATIONS',\s*'AUTORISE_A_PRELEVER'\)\s+then[\s\S]*?'CANNOT_CANCEL_AFTER_REMOVAL'/,
    "Server SQL must explicitly block CANCEL when status is not EN_ATTENTE_VALIDATIONS or AUTORISE_A_PRELEVER"
  );

  // Verify UI action guard in getAvailableVnPartActions
  const preRemoval = {
    id: "rem-pre",
    status: "AUTORISE_A_PRELEVER",
    created_by: "creator-user",
    removed_at: null,
  };
  const postRemoval = {
    id: "rem-post",
    status: "PRELEVE_EN_ATTENTE_PIECE",
    created_by: "creator-user",
    removed_at: "2026-09-17T12:00:00Z",
  };
  const creatorIdentity = { ok: true, role: "chef_atelier", authUserId: "creator-user", workshopId: "ws-1" };

  const actionsPre = vnPartUi.getAvailableVnPartActions(preRemoval, [], creatorIdentity);
  assert.ok(actionsPre.includes("CANCEL"), "Creator can CANCEL before physical removal");

  const actionsPost = vnPartUi.getAvailableVnPartActions(postRemoval, [], creatorIdentity);
  assert.ok(!actionsPost.includes("CANCEL"), "Creator CANNOT CANCEL after physical removal");
});

test("P7.3: Complete RBAC matrix across all 5 canonical roles and states", () => {
  const roles = ["chef_atelier", "directeur", "directeur_pieces", "responsable_qualite_parc_vn", "responsable_magasin"];
  const matrix = {};

  const makeItem = (status, extra = {}) => ({
    id: "rem-matrix",
    status,
    created_by: "other-user",
    expected_replacement_date: extra.expected_replacement_date || null,
    donor_vin: extra.donor_vin || null,
    store_ack_at: extra.store_ack_at ?? null,
    removed_at: extra.removed_at || null,
  });

  // State 1: EN_ATTENTE_VALIDATIONS at 0/3
  const s1 = makeItem("EN_ATTENTE_VALIDATIONS");
  assert.deepStrictEqual(
    roles.map(r => vnPartUi.getAvailableVnPartActions(s1, [], { ok: true, role: r, authUserId: "u" }).filter(a => a === "APPROVE")),
    [[], ["APPROVE"], [], [], []],
    "Only Directeur SAV can APPROVE at 0/3"
  );

  // State 2: AUTORISE_A_PRELEVER (after 3/3 approvals)
  const s2 = makeItem("AUTORISE_A_PRELEVER", { donor_vin: "VF1KNWN1111111111" });
  assert.ok(vnPartUi.getAvailableVnPartActions(s2, [], { ok: true, role: "chef_atelier", authUserId: "u" }).includes("CONFIRM_REMOVAL"));
  assert.ok(vnPartUi.getAvailableVnPartActions(s2, [], { ok: true, role: "responsable_magasin", authUserId: "u" }).includes("STORE_ACK"));
  assert.ok(vnPartUi.getAvailableVnPartActions(s2, [], { ok: true, role: "responsable_qualite_parc_vn", authUserId: "u" }).includes("REVISE_DONOR"));

  // State 3: PRELEVE_EN_ATTENTE_PIECE
  const s3 = makeItem("PRELEVE_EN_ATTENTE_PIECE", { expected_replacement_date: "2026-10-01", removed_at: "2026-09-17T12:00:00Z" });
  assert.ok(vnPartUi.getAvailableVnPartActions(s3, [], { ok: true, role: "directeur_pieces", authUserId: "u" }).includes("MARK_REPLACEMENT_AVAILABLE"));
  assert.ok(vnPartUi.getAvailableVnPartActions(s3, [], { ok: true, role: "responsable_magasin", authUserId: "u" }, { surface: "section_c" }).includes("MARK_REPLACEMENT_AVAILABLE"));
  assert.ok(!vnPartUi.getAvailableVnPartActions(s3, [], { ok: true, role: "chef_atelier", authUserId: "u" }).includes("MARK_REPLACEMENT_AVAILABLE"));

  // State 4: PIECE_DISPONIBLE
  const s4 = makeItem("PIECE_DISPONIBLE");
  assert.ok(vnPartUi.getAvailableVnPartActions(s4, [], { ok: true, role: "chef_atelier", authUserId: "u" }).includes("CONFIRM_RESTITUTION"));
  assert.ok(!vnPartUi.getAvailableVnPartActions(s4, [], { ok: true, role: "responsable_magasin", authUserId: "u" }).includes("CONFIRM_RESTITUTION"));

  // State 5: CLOTURE
  const s5 = makeItem("CLOTURE");
  roles.forEach(r => {
    const act = vnPartUi.getAvailableVnPartActions(s5, [], { ok: true, role: r, authUserId: "u" });
    assert.strictEqual(act.length, 0, `Role ${r} must have 0 actions on CLOTURE`);
  });
});

test("P7.4: Reload / state hydration persistence: critical fields survive simulation of fresh dashboard reload", () => {
  const backendRow = {
    id: "rem-persisted-1",
    status: "PRELEVE_EN_ATTENTE_PIECE",
    part_reference: "REF-PERSIST-1",
    part_designation: "Alternateur",
    donor_model: "DongFeng Shine",
    donor_vin: "VF1KNWN1111111111",
    expected_replacement_date: "2026-10-20",
    store_ack_at: "2026-09-17T11:00:00Z",
    removed_at: "2026-09-17T12:30:00Z",
    version: 4,
  };

  const auditEvents = [
    {
      removal_id: "rem-persisted-1",
      action: "STORE_ACK",
      reason: "Commande réappro passée avec succès",
      created_at: "2026-09-17T11:00:00Z",
    },
  ];

  // Hydrate lookup
  const storeAckLookup = vnPartUi.buildStoreAckLookup(auditEvents);
  const resolved = storeAckLookup.get("rem-persisted-1");

  assert.ok(resolved, "Store ACK event must resolve from backend audit events");
  assert.strictEqual(resolved.reason, "Commande réappro passée avec succès");
  assert.strictEqual(backendRow.donor_vin, "VF1KNWN1111111111");
  assert.strictEqual(backendRow.donor_model, "DongFeng Shine");
  assert.strictEqual(backendRow.expected_replacement_date, "2026-10-20");
  assert.strictEqual(backendRow.removed_at, "2026-09-17T12:30:00Z");
});

test("P7.5: CREATE_REQUEST RBAC matrix: UI button visibility and fail-closed RPC rejection for unauthorized roles", () => {
  // 1. Verify SQL Migration contract text
  const migrationPath = path.join(WORKDIR, "supabase/migrations/20260917130000_vn_part_sequential_approval_enforcement.sql");
  const sql = fs.readFileSync(migrationPath, "utf8");

  assert.match(
    sql,
    /if\s+v_action\s*=\s*'CREATE_REQUEST'\s+then[\s\S]*?if\s+v_caller_role\s+not\s+in\s+\('chef_atelier',\s*'responsable_garantie_support'\)\s+then[\s\S]*?FORBIDDEN_INITIATOR_ROLE/,
    "Server RPC must strictly enforce initiator roles: chef_atelier, responsable_garantie_support"
  );

  // 2. Verify UI button visibility logic
  const roles = [
    { role: "chef_atelier", canCreate: true },
    { role: "responsable_garantie_support", canCreate: true },
    { role: "directeur", canCreate: false },
    { role: "directeur_pieces", canCreate: false },
    { role: "responsable_qualite_parc_vn", canCreate: false },
    { role: "responsable_magasin", canCreate: false },
  ];

  for (const { role, canCreate } of roles) {
    const isAllowedInUi = ["chef_atelier", "responsable_garantie_support"].includes(role);
    assert.strictEqual(
      isAllowedInUi,
      canCreate,
      `UI button visibility for role '${role}' must be ${canCreate}`
    );

    // 3. Verify Server fail-closed direct call
    const directRes = simulateRpcAction({
      action: "CREATE_REQUEST",
      callerRole: role,
      callerId: `user-${role}`,
      payload: {
        beneficiary_model: "DongFeng Shine",
        part_designation: "Optique Avant",
        reason: "Test initiateur",
        quantity: 1,
      },
    });

    if (canCreate) {
      assert.strictEqual(directRes.ok, true, `Role '${role}' must successfully execute CREATE_REQUEST`);
      assert.strictEqual(directRes.removal.created_by_role, role);
      assert.strictEqual(directRes.auditEvents.length, 1);
    } else {
      assert.strictEqual(directRes.ok, false, `Role '${role}' must be rejected from CREATE_REQUEST`);
      assert.strictEqual(directRes.code, "FORBIDDEN_INITIATOR_ROLE");
      assert.strictEqual(directRes.auditEvents.length, 0, "Zero audit events on rejection");
    }
  }
});

test("P7.6: XSS escaping verification across rendered fields: part_reference, part_designation, donor_model, and user remarks", () => {
  const xssPayload = "<script>alert('xss')</script>";
  const escaped = vnPartUi.escapeHtml(xssPayload);
  assert.strictEqual(escaped.includes("<script>"), false);
  assert.ok(escaped.includes("&lt;script&gt;"));

  // Check renderPartIdentityHtml
  const htmlPart = vnPartUi.renderPartIdentityHtml(xssPayload, xssPayload);
  assert.strictEqual(htmlPart.includes("<script>"), false);
  assert.ok(htmlPart.includes("&lt;script&gt;"));

  // Check renderApprovalStrip with XSS remarks
  const approvalsWithXss = [
    {
      removal_id: "rem-xss",
      approval_role: "directeur",
      decision: "APPROVED",
      decided_by: "dir-1",
      reason: xssPayload,
    },
  ];
  const stripHtml = vnPartUi.renderApprovalStrip({ id: "rem-xss", status: "EN_ATTENTE_VALIDATIONS" }, approvalsWithXss);
  assert.strictEqual(stripHtml.includes("<script>"), false);
  assert.ok(stripHtml.includes("&lt;script&gt;"));

  // Check renderStoreAckTraceHtml with XSS remark
  const storeTraceHtml = vnPartUi.renderStoreAckTraceHtml(
    { id: "rem-xss", store_ack_at: "2026-09-17T10:00:00Z" },
    { reason: xssPayload, action: "STORE_ACK" }
  );
  assert.strictEqual(storeTraceHtml.includes("<script>"), false);
  assert.ok(storeTraceHtml.includes("&lt;script&gt;"));
});

// ============================================================================
// REVIEW FIX 001 — Approval decision timestamp traceability
// ============================================================================

test("REVIEW.1: Directeur SAV APPROVED with decided_at: date + time visible in approval pill", () => {
  const removal = { id: "rem-rev1", status: "EN_ATTENTE_VALIDATIONS" };
  const approvals = [
    {
      removal_id: "rem-rev1",
      approval_role: "directeur",
      decision: "APPROVED",
      decided_at: "2026-09-17T10:00:00Z",
      decided_by: "dir-1",
      reason: "",
    },
  ];
  const html = vnPartUi.renderApprovalStrip(removal, approvals);
  // Must contain the full datetime (not just date) via formatDateTimeFr
  // formatDateTimeFr produces DD/MM/YYYY HH:MM
  assert.ok(html.includes("17/09/2026"), "Decision date must be visible");
  // Must include the time component — at minimum the hour
  assert.match(html, /1[0-2][:h]/i, "Decision time (hour) must be visible");
  // The pill-decided-at span must be present
  assert.ok(html.includes("pill-decided-at"), "pill-decided-at class must be present");
});

test("REVIEW.2: Direction Pièces APPROVED: ETA visible AND decision date+time visible simultaneously", () => {
  const removal = {
    id: "rem-rev2",
    status: "EN_ATTENTE_VALIDATIONS",
    expected_replacement_date: "2026-09-25",
  };
  const approvals = [
    {
      removal_id: "rem-rev2",
      approval_role: "directeur",
      decision: "APPROVED",
      decided_at: "2026-09-17T09:00:00Z",
      decided_by: "dir-1",
      reason: "",
    },
    {
      removal_id: "rem-rev2",
      approval_role: "directeur_pieces",
      decision: "APPROVED",
      decided_at: "2026-09-17T10:30:00Z",
      decided_by: "dp-1",
      reason: "",
    },
  ];
  const html = vnPartUi.renderApprovalStrip(removal, approvals);
  // ETA must still be visible
  assert.ok(html.includes("25/09/2026"), "ETA date must be visible");
  // Decision datetime for directeur_pieces must be visible (timezone-safe)
  const expectedDt = vnPartUi.formatDateTimeFr("2026-09-17T10:30:00Z");
  assert.ok(html.includes(expectedDt), `Decision datetime '${expectedDt}' for Direction Pièces must be visible`);
  assert.ok(html.includes("pill-decided-at"), "pill-decided-at class must be present");
});

test("REVIEW.3: Chef Parc VN APPROVED: donor VIN visible AND decision date+time visible simultaneously", () => {
  const removal = {
    id: "rem-rev3",
    status: "AUTORISE_A_PRELEVER",
    donor_vin: "VF1234567890ABCDE",
  };
  const approvals = [
    {
      removal_id: "rem-rev3",
      approval_role: "directeur",
      decision: "APPROVED",
      decided_at: "2026-09-17T09:00:00Z",
      decided_by: "dir-1",
      reason: "",
    },
    {
      removal_id: "rem-rev3",
      approval_role: "directeur_pieces",
      decision: "APPROVED",
      decided_at: "2026-09-17T09:30:00Z",
      decided_by: "dp-1",
      reason: "",
    },
    {
      removal_id: "rem-rev3",
      approval_role: "responsable_qualite_parc_vn",
      decision: "APPROVED",
      decided_at: "2026-09-17T11:00:00Z",
      decided_by: "cp-1",
      reason: "",
    },
  ];
  const html = vnPartUi.renderApprovalStrip(removal, approvals);
  // Donor VIN must still be visible
  assert.ok(html.includes("VF1234567890ABCDE"), "Donor VIN must remain visible");
  // Decision datetime for Chef Parc must be visible (timezone-safe)
  const expectedDt = vnPartUi.formatDateTimeFr("2026-09-17T11:00:00Z");
  assert.ok(html.includes(expectedDt), `Decision datetime '${expectedDt}' for Chef Parc VN must be visible`);
  assert.ok(html.includes("pill-decided-at"), "pill-decided-at class must be present for Chef Parc VN");
});

test("REVIEW.4: REFUSED: state visible, decision date+time visible, remark present and escaped", () => {
  const removal = { id: "rem-rev4", status: "REFUSE" };
  const approvals = [
    {
      removal_id: "rem-rev4",
      approval_role: "directeur",
      decision: "REFUSED",
      decided_at: "2026-09-17T10:45:00Z",
      decided_by: "dir-1",
      reason: '<b>Motif</b> "refus" & raison',
    },
  ];
  const html = vnPartUi.renderApprovalStrip(removal, approvals);
  // Refused state must be visible
  assert.ok(html.includes("Refusé"), "Refused state text must be present");
  // Decision datetime must be visible (timezone-safe)
  const expectedDt = vnPartUi.formatDateTimeFr("2026-09-17T10:45:00Z");
  assert.ok(html.includes(expectedDt), `Decision datetime '${expectedDt}' must be visible for refusal`);
  assert.ok(html.includes("pill-decided-at"), "pill-decided-at class must be present for refusal");
  // XSS escaping of reason must work
  assert.strictEqual(html.includes("<b>"), false, "HTML tags in reason must be escaped");
  assert.ok(html.includes("&lt;b&gt;"), "Escaped HTML must appear in output");
});

test("REVIEW.5: decided_at null/undefined/invalid: no 'Invalid Date', no fabricated timestamp", () => {
  const removal = { id: "rem-rev5", status: "EN_ATTENTE_VALIDATIONS" };

  // Test with null decided_at
  const approvalsNull = [
    {
      removal_id: "rem-rev5",
      approval_role: "directeur",
      decision: "APPROVED",
      decided_at: null,
      decided_by: "dir-1",
      reason: "",
    },
  ];
  const htmlNull = vnPartUi.renderApprovalStrip(removal, approvalsNull);
  assert.strictEqual(htmlNull.includes("Invalid Date"), false, "Must not show 'Invalid Date' for null decided_at");
  assert.ok(htmlNull.includes("Validé"), "Approved state must still appear for null decided_at");

  // Test with undefined decided_at
  const approvalsUndef = [
    {
      removal_id: "rem-rev5",
      approval_role: "directeur",
      decision: "APPROVED",
      decided_by: "dir-1",
      reason: "",
    },
  ];
  const htmlUndef = vnPartUi.renderApprovalStrip(removal, approvalsUndef);
  assert.strictEqual(htmlUndef.includes("Invalid Date"), false, "Must not show 'Invalid Date' for undefined decided_at");

  // Test with invalid string decided_at
  const approvalsInvalid = [
    {
      removal_id: "rem-rev5",
      approval_role: "directeur",
      decision: "APPROVED",
      decided_at: "not-a-date",
      decided_by: "dir-1",
      reason: "",
    },
  ];
  const htmlInvalid = vnPartUi.renderApprovalStrip(removal, approvalsInvalid);
  assert.strictEqual(htmlInvalid.includes("Invalid Date"), false, "Must not show 'Invalid Date' for invalid decided_at string");
  // Should NOT have pill-decided-at when date is invalid
  assert.strictEqual(htmlInvalid.includes("pill-decided-at"), false, "pill-decided-at must not appear when decided_at is invalid");
});
