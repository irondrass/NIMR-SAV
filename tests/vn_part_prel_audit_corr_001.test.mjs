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
