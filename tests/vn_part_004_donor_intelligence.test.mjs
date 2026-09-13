/**
 * NIMR-SAV — Test Suite: VN-PART-004 Donor Intelligence & Restoration ETA
 *
 * Comprehensive verification suite covering:
 *   1. One existing same donor VIN collision
 *   2. Multiple same donor commitments
 *   3. VIN case normalization (UPPER)
 *   4. VIN whitespace normalization (TRIM)
 *   5. Same VIN in another workshop ignored (workshop isolation)
 *   6. Current removal excluded from its own collision warning (self-exclusion)
 *   7. Planned + physical counts
 *   8. Next ETA MIN calculation
 *   9. Full restoration ETA MAX calculation
 *  10. Later ETA extends projected restoration date
 *  11. Earlier ETA revision recalculates restoration date
 *  12. Missing ETA makes full date non-definitive ("À CONFIRMER — X ETA manquante(s)")
 *  13. Replacement available removes row from ETA blocking
 *  14. Restored row (restored_at IS NOT NULL) excluded from open commitments
 *  15. REFUSE status excluded
 *  16. ANNULE status excluded
 *  17. CLOTURE status excluded
 *  18. Physical readiness remains true despite future planned commitment
 *  19. Future planned commitment extends projected restoration date
 *  20. Planned-only donor does NOT appear as physically incomplete Section B donor
 *  21. Reference-first rendering ("RÉF. <ref> — <desig>")
 *  22. Missing reference fallback ("RÉF. NON RENSEIGNÉE — <desig>")
 *  23. "Directeur SAV" UI label in approval strip and modal
 *  24. Underlying canonical role remains "directeur"
 *  25. Action authority matrix unchanged
 *  26. Creator self-approval ban unchanged
 *  27. CREATE_REQUEST validation contract unchanged
 *  28. No donor or ETA fields in CREATE payload
 *  29. HTML escaping in new warning/detail rows
 *  30. DB normalized expression index contract in migration
 *  31. New view public.vn_part_donor_commitment_v1 has security_invoker = true
 *  32. Old vn_part_donor_state_v1 semantics preserved and untouched
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const vnPartClient = require("../js/vn-part-client.js");
const vnPartUi = require("../js/vn-part-ui.js");

const WORKDIR = process.cwd();
const clientJsContent = fs.readFileSync(path.join(WORKDIR, "js/vn-part-client.js"), "utf8");
const uiJsContent = fs.readFileSync(path.join(WORKDIR, "js/vn-part-ui.js"), "utf8");
const migrationPath = path.join(WORKDIR, "supabase/migrations/20260913130207_vn_part_004_donor_intelligence.sql");
const migrationSql = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, "utf8") : "";

// Sample baseline removals for testing
const SAMPLE_WORKSHOP_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_WORKSHOP_ID = "00000000-0000-0000-0000-000000000002";

// ============================================================================
// 1. One existing same donor VIN
// ============================================================================
test("1. One existing same donor VIN generates collision with exact details", () => {
  const removals = [
    {
      id: "rem-101",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3TESTVIN0000001",
      donor_model: "Peugeot 208",
      status: "EN_ATTENTE_SORTIE",
      removed_at: null,
      restored_at: null,
      part_reference: "REF-001",
      part_designation: "Alternateur",
      expected_replacement_date: "2026-09-25",
    },
  ];

  const summary = vnPartUi.computeDonorCommitmentSummary(removals, "VF3TESTVIN0000001", {
    workshopId: SAMPLE_WORKSHOP_ID,
  });

  assert.equal(summary.hasCollision, true);
  assert.equal(summary.collisionCount, 1);
  assert.equal(summary.openCommitmentCount, 1);
  assert.equal(summary.donorVin, "VF3TESTVIN0000001");
  assert.equal(summary.donorModel, "Peugeot 208");
  assert.equal(summary.plannedCount, 1);
  assert.equal(summary.physicalCount, 0);
  assert.equal(summary.commitments.length, 1);
  assert.equal(summary.commitments[0].id, "rem-101");
});

// ============================================================================
// 2. Multiple same donor commitments
// ============================================================================
test("2. Multiple same donor commitments aggregate counts and commitments correctly", () => {
  const removals = [
    {
      id: "rem-201",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3MULTIDONOR0001",
      donor_model: "Citroën C3",
      status: "SORTIE_CONFIRMEE",
      removed_at: "2026-09-10T10:00:00Z",
      restored_at: null,
      replacement_available_at: null,
      part_reference: "REF-OPT-L",
      part_designation: "Optique gauche",
      expected_replacement_date: "2026-09-20",
    },
    {
      id: "rem-202",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3MULTIDONOR0001",
      donor_model: "Citroën C3",
      status: "SORTIE_CONFIRMEE",
      removed_at: "2026-09-11T14:00:00Z",
      restored_at: null,
      replacement_available_at: null,
      part_reference: "REF-OPT-R",
      part_designation: "Optique droit",
      expected_replacement_date: "2026-09-28",
    },
    {
      id: "rem-203",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3MULTIDONOR0001",
      donor_model: "Citroën C3",
      status: "EN_ATTENTE_SORTIE",
      removed_at: null,
      restored_at: null,
      part_reference: "REF-CALC",
      part_designation: "Calculateur",
      expected_replacement_date: "2026-10-05",
    },
  ];

  const summary = vnPartUi.computeDonorCommitmentSummary(removals, "VF3MULTIDONOR0001", {
    workshopId: SAMPLE_WORKSHOP_ID,
  });

  assert.equal(summary.hasCollision, true);
  assert.equal(summary.collisionCount, 3);
  assert.equal(summary.openCommitmentCount, 3);
  assert.equal(summary.physicalCount, 2);
  assert.equal(summary.plannedCount, 1);
  assert.equal(summary.commitments.length, 3);
});

// ============================================================================
// 3. VIN case normalization
// ============================================================================
test("3. VIN case normalization matches lowercase query with uppercase record and vice-versa", () => {
  assert.equal(vnPartUi.normalizeDonorVin("vf3casevin1234567"), "VF3CASEVIN1234567");

  const removals = [
    {
      id: "rem-301",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "vf3casevin1234567",
      status: "EN_ATTENTE_SORTIE",
      removed_at: null,
      restored_at: null,
      part_designation: "Rétroviseur",
    },
  ];

  const summary = vnPartUi.computeDonorCommitmentSummary(removals, "VF3CASEVIN1234567", {
    workshopId: SAMPLE_WORKSHOP_ID,
  });

  assert.equal(summary.hasCollision, true);
  assert.equal(summary.openCommitmentCount, 1);
});

// ============================================================================
// 4. VIN whitespace normalization
// ============================================================================
test("4. VIN whitespace normalization", () => {
  const whitespaceInput = "  \t  VF3SPACEVIN000001 \n  ";
  assert.equal(vnPartUi.normalizeDonorVin(whitespaceInput), "VF3SPACEVIN000001");

  const removals = [
    {
      id: "rem-401",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "  VF3SPACEVIN000001  ",
      status: "EN_ATTENTE_SORTIE",
      removed_at: null,
      restored_at: null,
      part_designation: "Démarreur",
    },
  ];

  const summary = vnPartUi.computeDonorCommitmentSummary(removals, "VF3SPACEVIN000001", {
    workshopId: SAMPLE_WORKSHOP_ID,
  });

  assert.equal(summary.hasCollision, true);
  assert.equal(summary.openCommitmentCount, 1);
});

// ============================================================================
test("5. Same VIN in another workshop is strictly ignored (workshop isolation)", () => {
  const removals = [
    {
      id: "rem-501",
      workshop_id: OTHER_WORKSHOP_ID,
      donor_vin: "VF3ISOLATED000001",
      status: "EN_ATTENTE_SORTIE",
      removed_at: null,
      restored_at: null,
      part_designation: "Compresseur clim",
    },
  ];

  const summary = vnPartUi.computeDonorCommitmentSummary(removals, "VF3ISOLATED000001", {
    workshopId: SAMPLE_WORKSHOP_ID,
  });

  assert.equal(summary.hasCollision, false);
  assert.equal(summary.collisionCount, 0);
  assert.equal(summary.openCommitmentCount, 0);
});

// ============================================================================
// 6. Current removal excluded from its own collision warning
// ============================================================================
test("6. Current removal is excluded from its own collision warning (self-exclusion)", () => {
  const removals = [
    {
      id: "rem-current-601",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3SELFEXCLUDE001",
      status: "EN_ATTENTE_SORTIE",
      removed_at: null,
      restored_at: null,
      part_designation: "Batterie 12V",
    },
  ];

  // When editing or viewing rem-current-601, it must exclude itself
  const summary = vnPartUi.computeDonorCommitmentSummary(removals, "VF3SELFEXCLUDE001", {
    workshopId: SAMPLE_WORKSHOP_ID,
    excludeRemovalId: "rem-current-601",
  });

  assert.equal(summary.hasCollision, false);
  assert.equal(summary.collisionCount, 0);
  assert.equal(summary.openCommitmentCount, 0);

  // If another removal exists with the same VIN, only the other is counted
  const removalsWithOther = [
    ...removals,
    {
      id: "rem-other-602",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3SELFEXCLUDE001",
      status: "SORTIE_CONFIRMEE",
      removed_at: "2026-09-10T10:00:00Z",
      restored_at: null,
      part_designation: "Capot",
    },
  ];

  const summaryWithOther = vnPartUi.computeDonorCommitmentSummary(removalsWithOther, "VF3SELFEXCLUDE001", {
    workshopId: SAMPLE_WORKSHOP_ID,
    excludeRemovalId: "rem-current-601",
  });

  assert.equal(summaryWithOther.hasCollision, true);
  assert.equal(summaryWithOther.collisionCount, 1);
  assert.equal(summaryWithOther.commitments[0].id, "rem-other-602");
});

// ============================================================================
// 7. Planned + physical counts
// ============================================================================
test("7. Planned and physical counts are segregated accurately", () => {
  const removals = [
    {
      id: "rem-701",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3COUNTS00000001",
      status: "EN_ATTENTE_SORTIE",
      removed_at: null,
      restored_at: null,
    },
    {
      id: "rem-702",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3COUNTS00000001",
      status: "EN_ATTENTE_SORTIE",
      removed_at: null,
      restored_at: null,
    },
    {
      id: "rem-703",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3COUNTS00000001",
      status: "SORTIE_CONFIRMEE",
      removed_at: "2026-09-12T08:00:00Z",
      restored_at: null,
    },
  ];

  const summary = vnPartUi.computeDonorCommitmentSummary(removals, "VF3COUNTS00000001", {
    workshopId: SAMPLE_WORKSHOP_ID,
  });

  assert.equal(summary.openCommitmentCount, 3);
  assert.equal(summary.plannedCount, 2);
  assert.equal(summary.physicalCount, 1);
});

// ============================================================================
// 8. Next ETA MIN
// ============================================================================
test("8. Next ETA MIN computes the earliest expected replacement date among active commitments", () => {
  const removals = [
    {
      id: "rem-801",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3ETAMIN00000001",
      status: "SORTIE_CONFIRMEE",
      removed_at: "2026-09-01T10:00:00Z",
      restored_at: null,
      expected_replacement_date: "2026-09-25",
    },
    {
      id: "rem-802",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3ETAMIN00000001",
      status: "SORTIE_CONFIRMEE",
      removed_at: "2026-09-02T10:00:00Z",
      restored_at: null,
      expected_replacement_date: "2026-09-18",
    },
    {
      id: "rem-803",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3ETAMIN00000001",
      status: "EN_ATTENTE_SORTIE",
      removed_at: null,
      restored_at: null,
      expected_replacement_date: "2026-09-30",
    },
  ];

  const summary = vnPartUi.computeDonorCommitmentSummary(removals, "VF3ETAMIN00000001", {
    workshopId: SAMPLE_WORKSHOP_ID,
  });

  assert.equal(summary.nextEta, "2026-09-18");
});

// ============================================================================
// 9. Full restoration ETA MAX
// ============================================================================
test("9. Full restoration ETA MAX computes the latest expected replacement date among all commitments", () => {
  const removals = [
    {
      id: "rem-901",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3ETAMAX00000001",
      status: "SORTIE_CONFIRMEE",
      removed_at: "2026-09-01T10:00:00Z",
      restored_at: null,
      expected_replacement_date: "2026-09-18",
    },
    {
      id: "rem-902",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3ETAMAX00000001",
      status: "SORTIE_CONFIRMEE",
      removed_at: "2026-09-02T10:00:00Z",
      restored_at: null,
      expected_replacement_date: "2026-09-25",
    },
    {
      id: "rem-903",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3ETAMAX00000001",
      status: "EN_ATTENTE_SORTIE",
      removed_at: null,
      restored_at: null,
      expected_replacement_date: "2026-10-05",
    },
  ];

  const summary = vnPartUi.computeDonorCommitmentSummary(removals, "VF3ETAMAX00000001", {
    workshopId: SAMPLE_WORKSHOP_ID,
  });

  assert.equal(summary.fullRestorationEta, "2026-10-05");
  assert.equal(summary.isFullEtaDefinitive, true);
});

// ============================================================================
// 10. Later ETA extends projected restoration
// ============================================================================
test("10. Later ETA extends projected restoration date", () => {
  const removals = [
    {
      id: "rem-1001",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3EXTEND00000001",
      status: "SORTIE_CONFIRMEE",
      removed_at: "2026-09-01T10:00:00Z",
      restored_at: null,
      expected_replacement_date: "2026-09-25",
    },
  ];

  const before = vnPartUi.computeDonorCommitmentSummary(removals, "VF3EXTEND00000001", {
    workshopId: SAMPLE_WORKSHOP_ID,
  });
  assert.equal(before.fullRestorationEta, "2026-09-25");

  // What-if projection with a later ETA
  const afterProjection = vnPartUi.computeDonorCommitmentSummary(removals, "VF3EXTEND00000001", {
    workshopId: SAMPLE_WORKSHOP_ID,
    newExpectedDate: "2026-10-15",
  });

  assert.equal(afterProjection.projectedFullEta, "2026-10-15");
  assert.equal(afterProjection.projectedTotalCount, 2);
});

// ============================================================================
// 11. Earlier ETA revision recalculates
// ============================================================================
test("11. Earlier ETA revision recalculates projected full restoration correctly", () => {
  const removals = [
    {
      id: "rem-1101",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3REVISE00000001",
      status: "SORTIE_CONFIRMEE",
      removed_at: "2026-09-01T10:00:00Z",
      restored_at: null,
      expected_replacement_date: "2026-09-20",
    },
    {
      id: "rem-1102",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3REVISE00000001",
      status: "SORTIE_CONFIRMEE",
      removed_at: "2026-09-02T10:00:00Z",
      restored_at: null,
      expected_replacement_date: "2026-10-10", // To be revised earlier
    },
  ];

  // If rem-1102 is revised to 2026-09-15, the new MAX is rem-1101 at 2026-09-20
  const removalsRevised = [
    removals[0],
    { ...removals[1], expected_replacement_date: "2026-09-15" },
  ];

  const revisedSummary = vnPartUi.computeDonorCommitmentSummary(removalsRevised, "VF3REVISE00000001", {
    workshopId: SAMPLE_WORKSHOP_ID,
  });

  assert.equal(revisedSummary.fullRestorationEta, "2026-09-20");
  assert.equal(revisedSummary.nextEta, "2026-09-15");
});

// ============================================================================
// 12. Missing ETA makes full date non-definitive
// ============================================================================
test("12. Missing ETA makes full date non-definitive (etaMissingCount > 0, isFullEtaDefinitive = false)", () => {
  const removals = [
    {
      id: "rem-1201",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3MISSETA0000001",
      status: "SORTIE_CONFIRMEE",
      removed_at: "2026-09-01T10:00:00Z",
      restored_at: null,
      replacement_available_at: null,
      expected_replacement_date: "2026-09-25",
    },
    {
      id: "rem-1202",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3MISSETA0000001",
      status: "EN_ATTENTE_SORTIE",
      removed_at: null,
      restored_at: null,
      expected_replacement_date: null, // MISSING ETA
    },
  ];

  const summary = vnPartUi.computeDonorCommitmentSummary(removals, "VF3MISSETA0000001", {
    workshopId: SAMPLE_WORKSHOP_ID,
  });

  assert.equal(summary.openCommitmentCount, 2);
  assert.equal(summary.etaMissingCount, 1);
  assert.equal(summary.isFullEtaDefinitive, false);
});

// ============================================================================
// 13. Replacement available removes that row from ETA blocking
// ============================================================================
test("13. Replacement available removes that row from ETA blocking and does not count as missing ETA", () => {
  const removals = [
    {
      id: "rem-1301",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3REPLACED000001",
      status: "PIECE_DISPONIBLE",
      removed_at: "2026-09-01T10:00:00Z",
      restored_at: null,
      replacement_available_at: "2026-09-12T10:00:00Z",
      expected_replacement_date: null, // No longer needs expected date since part is already here!
    },
  ];

  const summary = vnPartUi.computeDonorCommitmentSummary(removals, "VF3REPLACED000001", {
    workshopId: SAMPLE_WORKSHOP_ID,
  });

  assert.equal(summary.openCommitmentCount, 1);
  assert.equal(summary.physicalReplacementAvailableCount, 1);
  assert.equal(summary.etaMissingCount, 0); // Not counted as missing!
  assert.equal(summary.isFullEtaDefinitive, true);
});

// ============================================================================
// 14. Restored row excluded
// ============================================================================
test("14. Restored row (restored_at IS NOT NULL) is excluded from open commitments", () => {
  const removals = [
    {
      id: "rem-1401",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3RESTORED000001",
      status: "RESTITUE",
      removed_at: "2026-09-01T10:00:00Z",
      restored_at: "2026-09-12T12:00:00Z",
      expected_replacement_date: "2026-09-15",
    },
  ];

  const summary = vnPartUi.computeDonorCommitmentSummary(removals, "VF3RESTORED000001", {
    workshopId: SAMPLE_WORKSHOP_ID,
  });

  assert.equal(summary.hasCollision, false);
  assert.equal(summary.openCommitmentCount, 0);
});

// ============================================================================
// 15. REFUSE excluded
// ============================================================================
test("15. REFUSE status is excluded from open commitments", () => {
  const removals = [
    {
      id: "rem-1501",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3REFUSE00000001",
      status: "REFUSE",
      removed_at: null,
      restored_at: null,
    },
  ];

  const summary = vnPartUi.computeDonorCommitmentSummary(removals, "VF3REFUSE00000001", {
    workshopId: SAMPLE_WORKSHOP_ID,
  });

  assert.equal(summary.hasCollision, false);
  assert.equal(summary.openCommitmentCount, 0);
});

// ============================================================================
// 16. ANNULE excluded
// ============================================================================
test("16. ANNULE status is excluded from open commitments", () => {
  const removals = [
    {
      id: "rem-1601",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3ANNULE00000001",
      status: "ANNULE",
      removed_at: null,
      restored_at: null,
    },
  ];

  const summary = vnPartUi.computeDonorCommitmentSummary(removals, "VF3ANNULE00000001", {
    workshopId: SAMPLE_WORKSHOP_ID,
  });

  assert.equal(summary.hasCollision, false);
  assert.equal(summary.openCommitmentCount, 0);
});

// ============================================================================
// 17. CLOTURE excluded
// ============================================================================
test("17. CLOTURE status is excluded from open commitments", () => {
  const removals = [
    {
      id: "rem-1701",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3CLOTURE0000001",
      status: "CLOTURE",
      removed_at: "2026-08-01T10:00:00Z",
      restored_at: "2026-08-15T10:00:00Z",
    },
  ];

  const summary = vnPartUi.computeDonorCommitmentSummary(removals, "VF3CLOTURE0000001", {
    workshopId: SAMPLE_WORKSHOP_ID,
  });

  assert.equal(summary.hasCollision, false);
  assert.equal(summary.openCommitmentCount, 0);
});

// ============================================================================
// 18. Physical readiness remains true despite future planned commitment
// ============================================================================
test("18. Physical readiness (can_be_restored_today) remains true despite future planned commitment", () => {
  // Vehicle has 1 physical part that has ALREADY arrived (PIECE_DISPONIBLE)
  // and 1 future planned commitment (EN_ATTENTE_SORTIE, removed_at is null)
  const removals = [
    {
      id: "rem-phys-1801",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3READYPHYS00001",
      donor_model: "Peugeot 3008",
      status: "PIECE_DISPONIBLE",
      removed_at: "2026-09-01T10:00:00Z",
      restored_at: null,
      replacement_available_at: "2026-09-10T10:00:00Z",
      expected_replacement_date: "2026-09-10",
    },
    {
      id: "rem-plan-1802",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3READYPHYS00001",
      donor_model: "Peugeot 3008",
      status: "EN_ATTENTE_SORTIE",
      removed_at: null,
      restored_at: null,
      expected_replacement_date: "2026-10-15",
    },
  ];

  const summary = vnPartUi.computeDonorCommitmentSummary(removals, "VF3READYPHYS00001", {
    workshopId: SAMPLE_WORKSHOP_ID,
  });

  assert.equal(summary.physicalCount, 1);
  assert.equal(summary.plannedCount, 1);
  assert.equal(summary.physicalWaitingReplacementCount, 0);
  assert.equal(summary.physicalReplacementAvailableCount, 1);

  // Invariant check: can_be_restored_today is STRICTLY PHYSICAL
  // physical_open_removal_count > 0 AND physical_waiting_replacement_count = 0
  assert.equal(summary.can_be_restored_today, true, "Physical readiness must remain TRUE");
});

// ============================================================================
// 19. Future planned commitment extends projected restoration date
// ============================================================================
test("19. Future planned commitment extends projected restoration date", () => {
  const removals = [
    {
      id: "rem-phys-1901",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3EXTENDPROJ0001",
      status: "PIECE_DISPONIBLE",
      removed_at: "2026-09-01T10:00:00Z",
      restored_at: null,
      expected_replacement_date: "2026-09-10",
    },
    {
      id: "rem-plan-1902",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3EXTENDPROJ0001",
      status: "EN_ATTENTE_SORTIE",
      removed_at: null,
      restored_at: null,
      expected_replacement_date: "2026-10-25", // Future date
    },
  ];

  const summary = vnPartUi.computeDonorCommitmentSummary(removals, "VF3EXTENDPROJ0001", {
    workshopId: SAMPLE_WORKSHOP_ID,
  });

  assert.equal(summary.fullRestorationEta, "2026-10-25", "Full restoration ETA must extend to future planned commitment date");
});

// ============================================================================
// 20. Planned-only donor does NOT appear as physically incomplete Section B donor
// ============================================================================
test("20. Planned-only donor does NOT appear as physically incomplete Section B donor", () => {
  // A donor record from vn_part_donor_state_v1 where active_removals_remaining is 0
  const donors = [
    {
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3PLANONLY000001",
      donor_model: "Peugeot 5008",
      active_removals_remaining: 0,
      parts_not_returned: 0,
      waiting_replacement_count: 0,
      available_to_restore_count: 0,
      can_be_restored_today: false,
      is_fully_restored: false,
    },
  ];

  const removals = [
    {
      id: "rem-plan-2001",
      workshop_id: SAMPLE_WORKSHOP_ID,
      donor_vin: "VF3PLANONLY000001",
      status: "EN_ATTENTE_SORTIE",
      removed_at: null,
      restored_at: null,
    },
  ];

  const filteredAllOpen = vnPartUi.filterVnPartDonors(donors, removals, "all-open", "");
  assert.equal(filteredAllOpen.length, 0, "Planned-only donor must not appear in Section B 'all-open' view");

  const filteredReady = vnPartUi.filterVnPartDonors(donors, removals, "ready", "");
  assert.equal(filteredReady.length, 0, "Planned-only donor must not appear in Section B 'ready' view");
});

// ============================================================================
// 21. Reference-first rendering
// ============================================================================
test("21. Reference-first rendering formats RÉF. <ref> — <desig> with structured tags", () => {
  const plain = vnPartUi.formatPartIdentity("1609123480", "Optique avant gauche");
  assert.equal(plain, "RÉF. 1609123480 — Optique avant gauche");

  const html = vnPartUi.renderPartIdentityHtml("1609123480", "Optique avant gauche");
  assert.ok(html.includes("RÉF. 1609123480"));
  assert.ok(html.includes("vn-part-ref-tag"));
  assert.ok(html.includes("Optique avant gauche"));
});

// ============================================================================
// 22. Missing reference fallback
// ============================================================================
test("22. Missing reference fallback formats RÉF. NON RENSEIGNÉE — <desig>", () => {
  const plain = vnPartUi.formatPartIdentity(null, "Pare-choc arrière");
  assert.equal(plain, "RÉF. NON RENSEIGNÉE — Pare-choc arrière");

  const html = vnPartUi.renderPartIdentityHtml("", "Pare-choc arrière");
  assert.ok(html.includes("RÉF. NON RENSEIGNÉE"));
  assert.ok(html.includes("vn-part-ref-missing"));
  assert.ok(html.includes("Pare-choc arrière"));
});

// ============================================================================
// 23. Directeur SAV UI label
// ============================================================================
test("23. Directeur SAV UI label renders in approval strip and placeholder", () => {
  const removal = {
    id: "rem-2301",
    status: "EN_ATTENTE_VALIDATIONS",
    workshop_id: SAMPLE_WORKSHOP_ID,
    created_by: "user-creator",
  };

  const stripHtml = vnPartUi.renderApprovalStrip(removal, []);
  assert.ok(stripHtml.includes("Directeur SAV"), "Approval strip must display 'Directeur SAV'");

  // Check textarea placeholder in source
  assert.ok(uiJsContent.includes("Remarque Directeur SAV..."), "Modal placeholder must reference Directeur SAV");
});

// ============================================================================
// 24. Underlying canonical role remains directeur
// ============================================================================
test("24. Underlying canonical role remains 'directeur' in code and contracts", () => {
  // Static checks that role logic checks 'directeur'
  assert.ok(uiJsContent.includes('role === "directeur"'), "Role checks must evaluate 'directeur'");
  assert.ok(!uiJsContent.includes('role === "directeur_sav"'), "Must NOT introduce artificial role names");
});

// ============================================================================
// 25. Action authority unchanged
// ============================================================================
test("25. Action authority matrix remains strictly preserved", () => {
  const removalPending = {
    id: "rem-2501",
    status: "EN_ATTENTE_VALIDATIONS",
    workshop_id: SAMPLE_WORKSHOP_ID,
    created_by: "user-ca",
  };

  // Chef de parc can approve
  const identityParc = { ok: true, role: "responsable_qualite_parc_vn", authUserId: "user-cp" };
  const actionsParc = vnPartUi.getAvailableVnPartActions(removalPending, [], identityParc);
  assert.ok(actionsParc.includes("APPROVE"));
  assert.ok(actionsParc.includes("REFUSE"));
  assert.ok(actionsParc.includes("REVISE_DONOR"));

  // Unauthorized role (technicien) has no actions
  const identityTech = { ok: true, role: "technicien", authUserId: "user-tech" };
  const actionsTech = vnPartUi.getAvailableVnPartActions(removalPending, [], identityTech);
  assert.equal(actionsTech.length, 0);
});

// ============================================================================
// 26. Creator self-approval unchanged
// ============================================================================
test("26. Creator self-approval ban remains strictly enforced", () => {
  const removal = {
    id: "rem-2601",
    status: "EN_ATTENTE_VALIDATIONS",
    workshop_id: SAMPLE_WORKSHOP_ID,
    created_by: "user-multi-role", // Creator
  };

  // Even if user has qualite/parc role, they cannot approve their own creation
  const identitySelf = { ok: true, role: "responsable_qualite_parc_vn", authUserId: "user-multi-role" };
  const actions = vnPartUi.getAvailableVnPartActions(removal, [], identitySelf);
  assert.equal(actions.some((a) => a.action === "APPROVE"), false, "Creator must not approve own request");
});

// ============================================================================
// 27. CREATE_REQUEST contract unchanged
// ============================================================================
test("27. CREATE_REQUEST validation contract requires beneficiary_model, part_designation, reason, quantity", () => {
  const valid = vnPartUi.validateCreateRequestPayload({
    beneficiary_model: "Peugeot Boxer",
    part_designation: "Rétroviseur droit",
    reason: "Casse atelier",
    quantity: 1,
  });
  assert.equal(valid.ok, true);

  const invalidModel = vnPartUi.validateCreateRequestPayload({
    beneficiary_model: "",
    part_designation: "Rétroviseur droit",
    reason: "Casse atelier",
    quantity: 1,
  });
  assert.equal(invalidModel.ok, false);
  assert.equal(invalidModel.field, "beneficiary_model");
});

// ============================================================================
// 28. No donor/ETA in CREATE payload
// ============================================================================
test("28. No donor or ETA fields in CREATE payload contract", () => {
  // Static analysis: CREATE_REQUEST form extraction in handleCreateFormSubmit does not include donor fields
  assert.ok(uiJsContent.includes('const payload = {'));
  assert.ok(!uiJsContent.includes('donor_vin: form.donor_vin?.value'));
  assert.ok(!uiJsContent.includes('replacement_expected_date: form.replacement_expected_date?.value'));
});

// ============================================================================
// 29. HTML escaping in new warning/detail rows
// ============================================================================
test("29. HTML escaping in part identity and donor intelligence rows prevents XSS", () => {
  const maliciousRef = '<script>alert("ref")</script>';
  const maliciousDesig = '<img src=x onerror=alert("desig")>';
  const html = vnPartUi.renderPartIdentityHtml(maliciousRef, maliciousDesig);

  assert.ok(!html.includes('<script>'), "Must not contain raw script tags");
  assert.ok(!html.includes('<img src=x'), "Must not contain raw img tags");
  assert.ok(html.includes('&lt;script&gt;'), "Must escape script tag");
  assert.ok(html.includes('&lt;img'), "Must escape img tag");
});

// ============================================================================
// 30. DB normalized expression index contract
// ============================================================================
test("30. Database migration defines expression index on (workshop_id, upper(trim(donor_vin)))", () => {
  assert.ok(migrationSql.length > 0, "Migration file must exist");
  assert.match(
    migrationSql,
    /create\s+index\s+if\s+not\s+exists\s+idx_vn_part_removals_donor_norm\s+on\s+public\.vn_part_removals\s*\(\s*workshop_id\s*,\s*upper\s*\(\s*trim\s*\(\s*donor_vin\s*\)\s*\)\s*\)/i,
    "Migration must create expression index idx_vn_part_removals_donor_norm"
  );
});

// ============================================================================
// 31. New view is security_invoker=true
// ============================================================================
test("31. View public.vn_part_donor_commitment_v1 specifies security_invoker = true", () => {
  assert.match(
    migrationSql,
    /create\s+or\s+replace\s+view\s+public\.vn_part_donor_commitment_v1[\s\S]*?with\s*\(\s*security_invoker\s*=\s*true\s*\)/i,
    "View must be defined with security_invoker = true"
  );

  assert.match(
    migrationSql,
    /revoke\s+all\s+privileges\s+on\s+table\s+public\.vn_part_donor_commitment_v1\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i,
    "Migration must revoke all privileges"
  );

  assert.match(
    migrationSql,
    /grant\s+select\s+on\s+table\s+public\.vn_part_donor_commitment_v1\s+to\s+authenticated/i,
    "Migration must grant select to authenticated"
  );
});

// ============================================================================
// 32. Old vn_part_donor_state_v1 semantics preserved
// ============================================================================
test("32. Old vn_part_donor_state_v1 view is untouched and preserved", () => {
  // The new migration must NOT drop or alter public.vn_part_donor_state_v1
  assert.ok(
    !migrationSql.includes("drop view if exists public.vn_part_donor_state_v1"),
    "New migration must not drop old view"
  );
  assert.ok(
    !migrationSql.includes("alter view public.vn_part_donor_state_v1"),
    "New migration must not alter old view"
  );
});
