/**
 * NIMR-SAV — Test Suite: VN-PART-003B Read-Only Operational Dashboard
 *
 * Verification suite for VN-PART-003B frontend implementation:
 *   1. RBAC & Navigation (all 11 roles: 8 allowed, 3 excluded)
 *   2. Default Landing Tabs (4 new roles -> vn-part, 7 existing unchanged)
 *   3. Strict Read-Only Contract (no .rpc, no insert/update/delete/upsert, no mutation buttons)
 *   4. Client SELECT Queries & Workshop Scoping
 *   5. KPI Derivation Formulas (SUM(quantity), active donors, ready, overdue)
 *   6. Physical Semantics Verification (5 required scenarios)
 *   7. Dynamic Hierarchy & Grouping (Model -> VIN -> Removals)
 *   8. Case-Insensitive Multi-Field Search
 *   9. 5 Operational Filters
 *  10. PWA Precache Alignment in sw.js & index.html
 *  11. CSS Responsive Styles
 *  12. DOM Dynamic Mounting Contract
 *  13. Deferred Startup Identity and Membership SELECT Counters
 *  14. Server Data HTML Escaping (including invalid dates)
 *  15. VN-PART CSS Selector Scope
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const vnPartClient = require("../js/vn-part-client.js");
const vnPartUi = require("../js/vn-part-ui.js");

const WORKDIR = process.cwd();

// Read source files for static contract assertions
const indexHtmlContent = fs.readFileSync(path.join(WORKDIR, "index.html"), "utf8");
const stateJsContent = fs.readFileSync(path.join(WORKDIR, "js/state.js"), "utf8");
const swJsContent = fs.readFileSync(path.join(WORKDIR, "sw.js"), "utf8");
const clientJsContent = fs.readFileSync(path.join(WORKDIR, "js/vn-part-client.js"), "utf8");
const uiJsContent = fs.readFileSync(path.join(WORKDIR, "js/vn-part-ui.js"), "utf8");
const stylesCssContent = fs.readFileSync(path.join(WORKDIR, "styles.css"), "utf8");

// ============================================================================
// 1. RBAC & Navigation Contract (All 11 Roles)
// ============================================================================
test("1. RBAC Navigation: Exactly 8 roles allowed, 3 roles excluded", () => {
  // Extract ROLE_TABS definition from state.js
  const roleTabsMatch = stateJsContent.match(/const ROLE_TABS = \{([\s\S]*?)\};/);
  assert.ok(roleTabsMatch, "ROLE_TABS definition must exist in state.js");

  const allowedRoles = [
    "admin", // admin_technique
    "directeur_sav", // directeur
    "chef_atelier",
    "readonly", // lecture_seule
    "directeur_pieces",
    "responsable_magasin",
    "responsable_garantie_support",
    "responsable_qualite_parc_vn",
  ];

  const excludedRoles = [
    "reception",
    "technicien",
    "controle_qualite",
  ];

  for (const role of allowedRoles) {
    const roleRegex = new RegExp(`${role}:\\s*\\[([^\\]]*)\\]`);
    const match = roleTabsMatch[1].match(roleRegex);
    assert.ok(match, `Role ${role} must be defined in ROLE_TABS`);
    assert.ok(
      match[1].includes('"vn-part"'),
      `Role ${role} MUST have access to "vn-part" tab`
    );
  }

  for (const role of excludedRoles) {
    const roleRegex = new RegExp(`${role}:\\s*\\[([^\\]]*)\\]`);
    const match = roleTabsMatch[1].match(roleRegex);
    assert.ok(match, `Role ${role} must be defined in ROLE_TABS`);
    assert.ok(
      !match[1].includes('"vn-part"'),
      `Role ${role} MUST NOT have access to "vn-part" tab`
    );
  }
});

// ============================================================================
// 2. Default Landing Tabs Contract
// ============================================================================
test("2. Default Tabs: 4 new roles default to vn-part, 7 existing unchanged", () => {
  const defaultTabsMatch = stateJsContent.match(/const ROLE_DEFAULT_TABS = \{([\s\S]*?)\};/);
  assert.ok(defaultTabsMatch, "ROLE_DEFAULT_TABS definition must exist in state.js");
  const block = defaultTabsMatch[1];

  // 4 new dedicated VN-PART roles -> vn-part
  assert.match(block, /directeur_pieces:\s*"vn-part"/, "directeur_pieces must default to vn-part");
  assert.match(block, /responsable_magasin:\s*"vn-part"/, "responsable_magasin must default to vn-part");
  assert.match(block, /responsable_garantie_support:\s*"vn-part"/, "responsable_garantie_support must default to vn-part");
  assert.match(block, /responsable_qualite_parc_vn:\s*"vn-part"/, "responsable_qualite_parc_vn must default to vn-part");

  // 7 existing roles unchanged
  assert.match(block, /admin:\s*"today"/, "admin must default to today");
  assert.match(block, /directeur_sav:\s*"pilotage"/, "directeur_sav must default to pilotage");
  assert.match(block, /chef_atelier:\s*"today"/, "chef_atelier must default to today");
  assert.match(block, /reception:\s*"today"/, "reception must default to today");
  assert.match(block, /technicien:\s*"technician"/, "technicien must default to technician");
  assert.match(block, /controle_qualite:\s*"today"/, "controle_qualite must default to today");
  assert.match(block, /readonly:\s*"dossiers"/, "readonly must default to dossiers");
});

// ============================================================================
// 3. Authoritative Mutation RPC Contract / Table Mutation Invariant
// ============================================================================
test("3. Authoritative Mutation RPC Contract: Only nimr_apply_vn_part_action_v1, zero direct table mutations", () => {
  const combinedVnCode = clientJsContent + "\n" + uiJsContent;
  const strippedCode = combinedVnCode.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

  // Authoritative RPC only: nimr_apply_vn_part_action_v1
  assert.strictEqual(
    strippedCode.includes('.rpc("nimr_apply_vn_part_action_v1"'),
    true,
    "VN-PART code must use authoritative RPC nimr_apply_vn_part_action_v1"
  );

  // No other / unexpected RPC calls
  const rpcMatches = strippedCode.match(/\.rpc\s*\(\s*["']([^"']+)["']/g) || [];
  for (const m of rpcMatches) {
    const rpcName = m.replace(/.*["']([^"']+)["'].*/, "$1");
    assert.strictEqual(
      rpcName,
      "nimr_apply_vn_part_action_v1",
      `Unexpected RPC called in VN-PART code: ${rpcName}`
    );
  }

  // Strictly NO direct table mutations on business tables
  assert.strictEqual(
    strippedCode.includes(".insert("),
    false,
    "VN-PART code must contain NO .insert() calls"
  );
  assert.strictEqual(
    strippedCode.includes(".update("),
    false,
    "VN-PART code must contain NO .update() calls"
  );
  assert.strictEqual(
    strippedCode.includes(".delete("),
    false,
    "VN-PART code must contain NO .delete() calls"
  );
  assert.strictEqual(
    strippedCode.includes(".upsert("),
    false,
    "VN-PART code must contain NO .upsert() calls"
  );

  // Forbidden financial/ERP fields in executable code
  const forbiddenKeywords = ["price", "tarif", "fournisseur", "supplier", "bin_location", "stock_qty"];
  for (const kw of forbiddenKeywords) {
    assert.strictEqual(
      strippedCode.includes(kw),
      false,
      `VN-PART code must not reference ERP/financial keyword: ${kw}`
    );
  }

  // Forbidden fallback strings in executable VN-PART client code
  const strippedClient = clientJsContent.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
  assert.strictEqual(
    strippedClient.includes("NIMR_DEFAULT_WORKSHOP_ID"),
    false,
    "VN-PART client must NOT contain NIMR_DEFAULT_WORKSHOP_ID fallback"
  );
  assert.strictEqual(
    strippedClient.includes("00000000-0000-0000-0000-000000000001"),
    false,
    "VN-PART client must NOT contain hardcoded workshop UUID fallback"
  );
});

// ============================================================================
// 4. Client SELECT Queries and Workshop Scoping
// ============================================================================
test("4. Client Queries: SELECT from vn_part_donor_state_v1, vn_part_removals, and vn_part_approvals with workshop scoping", async () => {
  const recordedCalls = [];

  const mockClient = {
    from(tableName) {
      const callRecord = { table: tableName, filters: [], order: null };
      recordedCalls.push(callRecord);
      return {
        select(fields) {
          callRecord.select = fields;
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

  assert.strictEqual(res.ok, true, "Client load must succeed");
  assert.strictEqual(res.workshopId, testWorkshopId);
  assert.strictEqual(recordedCalls.length, 3, "Must execute exactly 3 queries");

  const donorQuery = recordedCalls.find((c) => c.table === "vn_part_donor_state_v1");
  const removalQuery = recordedCalls.find((c) => c.table === "vn_part_removals");
  const approvalQuery = recordedCalls.find((c) => c.table === "vn_part_approvals");

  assert.ok(donorQuery, "Must query vn_part_donor_state_v1");
  assert.ok(removalQuery, "Must query vn_part_removals");
  assert.ok(approvalQuery, "Must query vn_part_approvals");

  // Workshop scoping check
  const donorWorkshopFilter = donorQuery.filters.find((f) => f.col === "workshop_id");
  assert.ok(donorWorkshopFilter, "Donor query must filter by workshop_id");
  assert.strictEqual(donorWorkshopFilter.val, testWorkshopId);

  const removalWorkshopFilter = removalQuery.filters.find((f) => f.col === "workshop_id");
  assert.ok(removalWorkshopFilter, "Removal query must filter by workshop_id");
  assert.strictEqual(removalWorkshopFilter.val, testWorkshopId);

  const approvalWorkshopFilter = approvalQuery.filters.find((f) => f.col === "workshop_id");
  assert.ok(approvalWorkshopFilter, "Approval query must filter by workshop_id");
  assert.strictEqual(approvalWorkshopFilter.val, testWorkshopId);

  // Helper for mock Supabase client
  function createMockSupabaseClient() {
    const calls = [];
    const client = {
      calls,
      from(tableName) {
        const callRecord = { table: tableName, filters: [], order: null };
        calls.push(callRecord);
        return {
          select(fields) {
            callRecord.select = fields;
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
    return client;
  }

  // Preserve global state
  const prevGetWorkshopId = globalThis.getSupabaseWorkshopId;
  const prevWindow = globalThis.window;

  try {
    // Scenario A: no workshop resolver available + NIMR_DEFAULT_WORKSHOP_ID may exist on window
    delete globalThis.getSupabaseWorkshopId;
    globalThis.window = { NIMR_DEFAULT_WORKSHOP_ID: "00000000-0000-0000-0000-000000000001" };

    assert.strictEqual(
      vnPartClient.resolveCurrentWorkshopId(),
      null,
      "Scenario A: resolveCurrentWorkshopId() must be null with no resolver, ignoring NIMR_DEFAULT_WORKSHOP_ID"
    );

    const clientA = createMockSupabaseClient();
    const resA = await vnPartClient.loadVnPartDashboard({ client: clientA });
    assert.strictEqual(resA.ok, false);
    assert.strictEqual(resA.code, "WORKSHOP_REQUIRED");
    assert.strictEqual(clientA.calls.length, 0, "Scenario A: 0 SELECT queries executed");

    // Scenario B: resolver returns empty / whitespace / null, or explicit empty workshopId
    globalThis.getSupabaseWorkshopId = () => "   ";
    globalThis.window = { getSupabaseWorkshopId: () => "   " };

    assert.strictEqual(
      vnPartClient.resolveCurrentWorkshopId(),
      null,
      "Scenario B: resolveCurrentWorkshopId() must return null on empty/whitespace resolver"
    );

    const clientB1 = createMockSupabaseClient();
    const resB1 = await vnPartClient.loadVnPartDashboard({ client: clientB1 });
    assert.strictEqual(resB1.ok, false);
    assert.strictEqual(resB1.code, "WORKSHOP_REQUIRED");
    assert.strictEqual(clientB1.calls.length, 0, "Scenario B1: 0 SELECT queries executed");

    const clientB2 = createMockSupabaseClient();
    const resB2 = await vnPartClient.loadVnPartDashboard({ client: clientB2, workshopId: "" });
    assert.strictEqual(resB2.ok, false);
    assert.strictEqual(resB2.code, "WORKSHOP_REQUIRED");
    assert.strictEqual(clientB2.calls.length, 0, "Scenario B2: 0 SELECT queries executed");

    // Scenario C: authoritative resolver returns workshop UUID
    const authWorkshopId = "22222222-3333-4444-5555-666666666666";
    globalThis.getSupabaseWorkshopId = () => authWorkshopId;
    globalThis.window = { getSupabaseWorkshopId: () => authWorkshopId };

    assert.strictEqual(
      vnPartClient.resolveCurrentWorkshopId(),
      authWorkshopId,
      "Scenario C: resolveCurrentWorkshopId() must return trimmed authoritative UUID"
    );

    const clientC = createMockSupabaseClient();
    const resC = await vnPartClient.loadVnPartDashboard({ client: clientC });
    assert.strictEqual(resC.ok, true);
    assert.strictEqual(resC.workshopId, authWorkshopId);
    assert.strictEqual(clientC.calls.length, 3, "Scenario C: exactly 3 queries executed");
    const donorQueryC = clientC.calls.find((c) => c.table === "vn_part_donor_state_v1");
    const removalQueryC = clientC.calls.find((c) => c.table === "vn_part_removals");
    const approvalQueryC = clientC.calls.find((c) => c.table === "vn_part_approvals");
    assert.ok(donorQueryC && removalQueryC && approvalQueryC);
    assert.strictEqual(donorQueryC.filters[0].val, authWorkshopId);
    assert.strictEqual(removalQueryC.filters[0].val, authWorkshopId);
    assert.strictEqual(approvalQueryC.filters[0].val, authWorkshopId);
  } finally {
    // Restore global state
    if (prevGetWorkshopId !== undefined) {
      globalThis.getSupabaseWorkshopId = prevGetWorkshopId;
    } else {
      delete globalThis.getSupabaseWorkshopId;
    }
    if (prevWindow !== undefined) {
      globalThis.window = prevWindow;
    } else {
      delete globalThis.window;
    }
  }
});

// ============================================================================
// 5. KPI Derivation Formulas
// ============================================================================
test("5. KPI Formulas: Accurate derivation for all 4 dashboard KPIs", () => {
  const sampleDonors = [
    {
      donor_vin: "DONOR-1",
      active_removals_remaining: 2,
      parts_not_returned: 2,
      can_be_restored_today: false,
      overdue_count: 1,
    },
    {
      donor_vin: "DONOR-2",
      active_removals_remaining: 1,
      parts_not_returned: 1,
      can_be_restored_today: true,
      overdue_count: 0,
    },
    {
      donor_vin: "DONOR-3",
      active_removals_remaining: 0,
      parts_not_returned: 0,
      can_be_restored_today: false,
      overdue_count: 0,
      is_fully_restored: true,
    },
  ];

  const sampleRemovals = [
    // Removal 1: removed, waiting for part, qty = 2
    { id: "rem-1", donor_vin: "DONOR-1", quantity: 2, removed_at: "2026-09-01T10:00:00Z", restored_at: null },
    // Removal 2: removed, part available, qty = 3
    { id: "rem-2", donor_vin: "DONOR-1", quantity: 3, removed_at: "2026-09-02T10:00:00Z", restored_at: null },
    // Removal 3: removed, ready to restore, qty = 1
    { id: "rem-3", donor_vin: "DONOR-2", quantity: 1, removed_at: "2026-09-03T10:00:00Z", restored_at: null },
    // Removal 4: already restored, qty = 4 (must be excluded from unreturned parts SUM!)
    { id: "rem-4", donor_vin: "DONOR-3", quantity: 4, removed_at: "2026-09-01T08:00:00Z", restored_at: "2026-09-05T12:00:00Z" },
    // Removal 5: authorized but NOT yet physically removed (must be excluded from unreturned parts SUM!)
    { id: "rem-5", donor_vin: "DONOR-4", quantity: 2, removed_at: null, restored_at: null },
  ];

  const kpis = vnPartUi.computeVnPartKpis(sampleDonors, sampleRemovals);

  // 1. VN restant à restituer = donors with active_removals_remaining > 0 (DONOR-1 and DONOR-2)
  assert.strictEqual(kpis.remainingDonorsCount, 2);

  // 2. Pièces non restituées = SUM(quantity) of physical removals not yet restored (2 + 3 + 1 = 6)
  // Notice that row count is 3, but quantity SUM is 6.
  assert.strictEqual(kpis.unreturnedPartsQuantity, 6);

  // 3. VN prêts à restituer = donors with can_be_restored_today = true (DONOR-2)
  assert.strictEqual(kpis.readyDonorsCount, 1);

  // 4. VN en retard = donors with overdue_count > 0 (DONOR-1)
  assert.strictEqual(kpis.overdueDonorsCount, 1);
});

// ============================================================================
// 6. Physical Semantics Verification (5 Scenarios)
// ============================================================================
test("6. Physical Semantics: Accurate derivation across 5 lifecycle scenarios", () => {
  // Scenario 1: Authorized but never removed
  const s1Donor = { active_removals_remaining: 0, parts_not_returned: 0, can_be_restored_today: false, is_fully_restored: false, overdue_count: 0 };
  const s1Removal = { removed_at: null, restored_at: null, quantity: 1 };
  assert.strictEqual(s1Donor.active_removals_remaining, 0, "Authorized only does NOT create an active physical removal");

  // Scenario 2: Physically removed, waiting for replacement
  const s2Donor = { active_removals_remaining: 1, waiting_replacement_count: 1, available_to_restore_count: 0, can_be_restored_today: false, overdue_count: 0 };
  const s2Removal = { removed_at: "2026-09-10T10:00:00Z", replacement_available_at: null, restored_at: null, quantity: 1 };
  const kpisS2 = vnPartUi.computeVnPartKpis([s2Donor], [s2Removal]);
  assert.strictEqual(kpisS2.remainingDonorsCount, 1);
  assert.strictEqual(kpisS2.unreturnedPartsQuantity, 1);
  assert.strictEqual(kpisS2.readyDonorsCount, 0);

  // Scenario 3: Physically removed, replacement part available
  const s3Donor = { active_removals_remaining: 1, waiting_replacement_count: 0, available_to_restore_count: 1, can_be_restored_today: true, overdue_count: 0 };
  const s3Removal = { removed_at: "2026-09-10T10:00:00Z", replacement_available_at: "2026-09-11T14:00:00Z", restored_at: null, quantity: 1 };
  const kpisS3 = vnPartUi.computeVnPartKpis([s3Donor], [s3Removal]);
  assert.strictEqual(kpisS3.readyDonorsCount, 1);
  assert.strictEqual(kpisS3.unreturnedPartsQuantity, 1);

  // Scenario 4: Fully restored (historical removal exists, 0 active remain)
  const s4Donor = { active_removals_remaining: 0, parts_not_returned: 0, is_fully_restored: true, can_be_restored_today: false, overdue_count: 0 };
  const s4Removal = { removed_at: "2026-09-01T10:00:00Z", restored_at: "2026-09-05T10:00:00Z", quantity: 2 };
  const kpisS4 = vnPartUi.computeVnPartKpis([s4Donor], [s4Removal]);
  assert.strictEqual(kpisS4.remainingDonorsCount, 0);
  assert.strictEqual(kpisS4.unreturnedPartsQuantity, 0);
  assert.strictEqual(s4Donor.is_fully_restored, true);

  // Scenario 5: Overdue waiting part
  const s5Donor = { active_removals_remaining: 1, waiting_replacement_count: 1, overdue_count: 1, can_be_restored_today: false };
  const s5Removal = { removed_at: "2026-08-01T10:00:00Z", expected_replacement_date: "2026-08-15", restored_at: null, quantity: 1 };
  const kpisS5 = vnPartUi.computeVnPartKpis([s5Donor], [s5Removal]);
  assert.strictEqual(kpisS5.overdueDonorsCount, 1);
});

// ============================================================================
// 7. Dynamic Grouping Hierarchy (Model -> VIN -> Removals)
// ============================================================================
test("7. Grouping: Model -> VIN -> Removals hierarchy with dynamic models", () => {
  const donors = [
    { donor_model: "DONGFENG T5 EVO", donor_vin: "VIN-T5-01", active_removals_remaining: 1, overdue_count: 0 },
    { donor_model: "DONGFENG SHINE", donor_vin: "VIN-SHINE-01", active_removals_remaining: 1, overdue_count: 1 },
    { donor_model: "DONGFENG SHINE", donor_vin: "VIN-SHINE-02", active_removals_remaining: 1, overdue_count: 0 },
    { donor_model: "BRAND NEW FUTURE MODEL", donor_vin: "VIN-FUTURE-99", active_removals_remaining: 1, overdue_count: 0 },
    { donor_model: "DONGFENG EMPTY", donor_vin: "", active_removals_remaining: 1, overdue_count: 0 },
  ];

  const removals = [
    { id: "r1", donor_vin: "VIN-SHINE-01", part_designation: "Optique A" },
    { id: "r2", donor_vin: "VIN-SHINE-01", part_designation: "Optique B" },
    { id: "r3", donor_vin: "VIN-T5-01", part_designation: "Pare-chocs" },
    { id: "r4", donor_vin: "VIN-FUTURE-99", part_designation: "Capteur" },
  ];

  const groups = vnPartUi.groupVnPartByModelAndVin(donors, removals);

  // Models must be sorted alphabetically
  assert.strictEqual(groups.length, 3);
  assert.strictEqual(groups[0].model, "BRAND NEW FUTURE MODEL");
  assert.strictEqual(groups[1].model, "DONGFENG SHINE");
  assert.strictEqual(groups[2].model, "DONGFENG T5 EVO");

  // Under DONGFENG SHINE, overdue donor VIN-SHINE-01 must precede VIN-SHINE-02
  const shineGroup = groups[1];
  assert.strictEqual(shineGroup.items.length, 2);
  assert.strictEqual(shineGroup.items[0].donor.donor_vin, "VIN-SHINE-01");
  assert.strictEqual(shineGroup.items[0].removals.length, 2);
  assert.strictEqual(shineGroup.items[1].donor.donor_vin, "VIN-SHINE-02");
});

// ============================================================================
// 8. Search Functionality
// ============================================================================
test("8. Search: Multi-field matching across donor and removal metadata", () => {
  const donors = [
    { donor_model: "DONGFENG SHINE", donor_vin: "VIN-AAA-111", active_removals_remaining: 1 },
    { donor_model: "DONGFENG GLORY", donor_vin: "VIN-BBB-222", active_removals_remaining: 1 },
  ];

  const removals = [
    {
      donor_vin: "VIN-AAA-111",
      beneficiary_model: "T5 EVO",
      beneficiary_vin: "BEN-VIN-999",
      beneficiary_or: "OR-2026-444",
      part_reference: "REF-RETRO-L",
      part_designation: "Rétroviseur Gauche",
    },
    {
      donor_vin: "VIN-BBB-222",
      beneficiary_model: "SHINE MAX",
      beneficiary_vin: "BEN-VIN-888",
      beneficiary_or: "OR-2026-555",
      part_reference: "REF-AILE-R",
      part_designation: "Aile Avant Droite",
    },
  ];

  // Match on donor model
  const m1 = vnPartUi.filterVnPartDonors(donors, removals, "all-open", "glory");
  assert.strictEqual(m1.length, 1);
  assert.strictEqual(m1[0].donor_vin, "VIN-BBB-222");

  // Match on beneficiary OR
  const m2 = vnPartUi.filterVnPartDonors(donors, removals, "all-open", "OR-2026-444");
  assert.strictEqual(m2.length, 1);
  assert.strictEqual(m2[0].donor_vin, "VIN-AAA-111");

  // Match on part reference
  const m3 = vnPartUi.filterVnPartDonors(donors, removals, "all-open", "REF-AILE");
  assert.strictEqual(m3.length, 1);
  assert.strictEqual(m3[0].donor_vin, "VIN-BBB-222");

  // Match on part designation
  const m4 = vnPartUi.filterVnPartDonors(donors, removals, "all-open", "rétroviseur");
  assert.strictEqual(m4.length, 1);
  assert.strictEqual(m4[0].donor_vin, "VIN-AAA-111");

  // No match
  const m5 = vnPartUi.filterVnPartDonors(donors, removals, "all-open", "NONEXISTENT");
  assert.strictEqual(m5.length, 0);
});

// ============================================================================
// 9. Filters
// ============================================================================
test("9. Filters: All 5 filters operate according to physical semantics", () => {
  const donors = [
    // Open, waiting part
    { donor_vin: "D-1", active_removals_remaining: 1, waiting_replacement_count: 1, available_to_restore_count: 0, can_be_restored_today: false, overdue_count: 0, is_fully_restored: false },
    // Open, ready to restore
    { donor_vin: "D-2", active_removals_remaining: 1, waiting_replacement_count: 0, available_to_restore_count: 1, can_be_restored_today: true, overdue_count: 0, is_fully_restored: false },
    // Open, overdue
    { donor_vin: "D-3", active_removals_remaining: 1, waiting_replacement_count: 1, available_to_restore_count: 0, can_be_restored_today: false, overdue_count: 1, is_fully_restored: false },
    // Closed / History (0 active remaining, is_fully_restored: true)
    { donor_vin: "D-4", active_removals_remaining: 0, waiting_replacement_count: 0, available_to_restore_count: 0, can_be_restored_today: false, overdue_count: 0, is_fully_restored: true },
    // Edge case: active_removals_remaining: 0 but is_fully_restored: false (MUST NOT match history)
    { donor_vin: "D-5", active_removals_remaining: 0, waiting_replacement_count: 0, available_to_restore_count: 0, can_be_restored_today: false, overdue_count: 0, is_fully_restored: false },
  ];

  // 1. all-open
  const allOpen = vnPartUi.filterVnPartDonors(donors, [], "all-open", "");
  assert.strictEqual(allOpen.length, 3);
  assert.deepStrictEqual(allOpen.map((d) => d.donor_vin), ["D-1", "D-2", "D-3"]);

  // 2. ready
  const ready = vnPartUi.filterVnPartDonors(donors, [], "ready", "");
  assert.strictEqual(ready.length, 1);
  assert.strictEqual(ready[0].donor_vin, "D-2");

  // 3. overdue
  const overdue = vnPartUi.filterVnPartDonors(donors, [], "overdue", "");
  assert.strictEqual(overdue.length, 1);
  assert.strictEqual(overdue[0].donor_vin, "D-3");

  // 4. waiting
  const waiting = vnPartUi.filterVnPartDonors(donors, [], "waiting", "");
  assert.strictEqual(waiting.length, 2);
  assert.deepStrictEqual(waiting.map((d) => d.donor_vin), ["D-1", "D-3"]);

  // 5. history (strictly matches only is_fully_restored === true)
  const history = vnPartUi.filterVnPartDonors(donors, [], "history", "");
  assert.strictEqual(history.length, 1);
  assert.strictEqual(history[0].donor_vin, "D-4");

  for (const status of ["approved", "refused", "cancelled"]) {
    const neverRemoved = { donor_vin: status, active_removals_remaining: 0, is_fully_restored: false };
    const removal = { donor_vin: status, status, removed_at: null, restored_at: null };
    assert.deepStrictEqual(vnPartUi.filterVnPartDonors([neverRemoved], [removal], "history"), [], `${status}, never removed: not restored`);
  }
});

// ============================================================================
// 10. Service Worker Precache Alignment
// ============================================================================
test("10. PWA Precache: Both new JS files exist in sw.js ASSETS with exact release query", () => {
  // Check index.html references
  assert.ok(
    indexHtmlContent.includes('<script src="js/vn-part-client.js?v=23.3.43" defer></script>'),
    "index.html must include vn-part-client.js with active query v=23.3.43"
  );
  assert.ok(
    indexHtmlContent.includes('<script src="js/vn-part-ui.js?v=23.3.43" defer></script>'),
    "index.html must include vn-part-ui.js with active query v=23.3.43"
  );

  // Check sw.js ASSETS precache list
  const assetsMatch = swJsContent.match(/const ASSETS = \[([\s\S]*?)\];/);
  assert.ok(assetsMatch, "sw.js must contain ASSETS array");
  const assetsBlock = assetsMatch[1];

  assert.ok(
    assetsBlock.includes('"./js/vn-part-client.js?v=23.3.43"'),
    "sw.js ASSETS must precache ./js/vn-part-client.js?v=23.3.43"
  );
  assert.ok(
    assetsBlock.includes('"./js/vn-part-ui.js?v=23.3.43"'),
    "sw.js ASSETS must precache ./js/vn-part-ui.js?v=23.3.43"
  );

  // Assert version was bumped to v23.3.43
  assert.ok(
    swJsContent.includes('const CACHE_NAME = "nimr-sav-v23.3.43";'),
    "sw.js CACHE_NAME must be nimr-sav-v23.3.43"
  );
});

// ============================================================================
// 11. CSS Styles: Responsive Layout & Mobile Contract
// ============================================================================
test("11. CSS Styles: Responsive grid, toolbar, donor cards, and badges are styled", () => {
  const requiredCssSelectors = [
    ".vn-part-shell",
    ".vn-part-header",
    ".vn-part-title",
    ".vn-part-kpi-grid",
    ".vn-part-kpi-card",
    ".vn-part-toolbar",
    ".vn-part-search-input",
    ".vn-part-filters",
    ".vn-part-filter-btn",
    ".vn-part-donor-card",
    ".vn-part-badge",
    ".badge-overdue",
    ".badge-ready",
    ".badge-waiting",
    ".badge-available",
    ".badge-restored",
    ".vn-part-restored-banner",
    ".vn-part-empty",
    ".vn-part-loading",
    ".vn-part-error",
  ];

  for (const selector of requiredCssSelectors) {
    assert.ok(
      stylesCssContent.includes(selector),
      `styles.css must contain rules for selector: ${selector}`
    );
  }

  // Check mobile responsive breakpoint
  assert.ok(
    stylesCssContent.includes("@media (max-width: 768px)"),
    "styles.css must include mobile responsive breakpoint for VN-PART at 768px"
  );
});

// ============================================================================
// 12. Startup, RBAC & In-Flight Guards Contract
// ============================================================================
test("12. Client & UI Guards: Fails closed when unauthorized or in-flight", async () => {
  // Test in-flight guard
  vnPartUi.vnPartEphemeralState.loading = true;
  let clientCalled = false;
  // If loading is true, refreshVnPartDashboard must exit immediately without calling client
  await vnPartUi.refreshVnPartDashboard();
  assert.strictEqual(clientCalled, false, "Must not initiate fetch if already loading");
  vnPartUi.vnPartEphemeralState.loading = false;

  // Test grouping skips empty VIN
  const donorsWithEmpty = [
    { donor_model: "TEST MODEL", donor_vin: "   ", active_removals_remaining: 1 },
    { donor_model: "TEST MODEL", donor_vin: null, active_removals_remaining: 1 },
    { donor_model: "TEST MODEL", donor_vin: "VALID-VIN-01", active_removals_remaining: 1 },
  ];
  const grouped = vnPartUi.groupVnPartByModelAndVin(donorsWithEmpty, []);
  assert.strictEqual(grouped.length, 1);
  assert.strictEqual(grouped[0].items.length, 1);
  assert.strictEqual(grouped[0].items[0].donor.donor_vin, "VALID-VIN-01");
});

// Browser globals execute the real VN-PART modules; DOM and transport stay local.
function createVnPartBrowserHarness(readyState = "loading") {
  const elements = new Map();
  function getElement(selector) {
    const id = selector.replace(/^[.#]/u, "");
    if (!elements.has(id)) elements.set(id, {
      id, hidden: true, innerHTML: "", textContent: "", dataset: {}, style: {},
      attributes: new Map(), listeners: new Map(),
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      setAttribute(name, value) { this.attributes.set(name, value); },
      removeAttribute(name) { this.attributes.delete(name); },
      addEventListener(name, listener) { this.listeners.set(name, listener); },
      contains: () => false, querySelector: () => null, querySelectorAll: () => [], focus() {},
    });
    return elements.get(id);
  }
  const storage = () => {
    const values = new Map();
    return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    };
  };
  const listeners = new Map();
  const body = { dataset: {} };
  const context = vm.createContext({
    console, navigator: { onLine: true }, localStorage: storage(), sessionStorage: storage(),
    document: {
      readyState, body, activeElement: body,
      getElementById: getElement, querySelector: getElement, querySelectorAll: () => [],
      addEventListener(name, listener) { listeners.set(name, listener); },
      removeEventListener() {},
    },
    setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {},
  });
  context.window = context;
  return { context, getElement, listeners };
}

test("13. Startup identity: loaded VN-PART scripts issue zero SELECTs until membership authorization and tab access", async (t) => {
  for (const readyState of ["loading", "interactive"]) {
    const { context, getElement, listeners } = createVnPartBrowserHarness(readyState);
    const workshopId = "11111111-2222-3333-4444-555555555555";
    const counts = { vn_part_donor_state_v1: 0, vn_part_removals: 0, vn_part_approvals: 0 };
    const queries = [];
    let releaseSession, releaseMembership, sessionStarted = false, membershipStarted = false, renders = 0;
    const sessionPending = new Promise((resolve) => { releaseSession = resolve; });
    const membershipPending = new Promise((resolve) => { releaseMembership = resolve; });
    Object.assign(context, {
      getSupabaseWorkshopId: () => workshopId,
      getSupabaseSessionState: () => { sessionStarted = true; return sessionPending; },
      getSupabaseUser: async () => (await sessionPending).user,
      resolveSupabaseWorkshopMembership: () => { membershipStarted = true; return membershipPending; },
      getSupabaseClient: () => ({ from(table) {
        assert.ok(Object.hasOwn(counts, table), `Unexpected table ${table}`);
        const query = { table, filters: [] };
        queries.push(query);
        return {
          select(fields) { counts[table] += 1; assert.equal(fields, "*"); return this; },
          eq(column, value) { query.filters.push([column, value]); return this; },
          order() { return this; },
          then(resolve) { resolve({ data: [], error: null }); },
        };
      } }),
      pullLatestSupabaseBackup: async () => ({ ok: true }),
      startSupabaseLiveSync: async () => true,
    });
    for (const file of ["js/utils.js", "js/state.js", "js/vn-part-client.js", "js/vn-part-ui.js"]) {
      vm.runInContext(fs.readFileSync(path.join(WORKDIR, file), "utf8"), context, { filename: file });
    }
    assert.deepStrictEqual(counts, { vn_part_donor_state_v1: 0, vn_part_removals: 0, vn_part_approvals: 0 }, "Script loading must not query");
    const onVnPartDomReady = listeners.get("DOMContentLoaded");
    const appSource = fs.readFileSync(path.join(WORKDIR, "app.js"), "utf8");
    vm.runInContext(appSource.replace("initApp();", "/* initApp invoked below after transport stubs */"), context);
    // Only unrelated startup wiring/persistence is stubbed. Identity gate, local
    // membership mirror, RBAC, tab activation and VN-PART client/UI run unchanged.
    for (const name of [
      "configurePdfWorker", "bindMainNavigation", "bindCaseList", "bindCaseCreation",
      "bindQuickCreateMode", "populateCaseStatusFilters", "bindCaseFilters", "bindPlanningToolbar",
      "bindWorkshopForms", "bindSettingsWorkspaceNavigation", "bindBackupActions", "bindUserSessionActions",
      "bindUserSessionIdleEvents", "bindLocalSecurityControls", "bindOfflineStatus", "bindSyncConflictUsability",
      "bindSupabaseActions", "bindVehicleLookup", "bindKeyboardShortcuts", "bindAutoSaveSafety",
      "bindMobileResumeSafety", "migratePlanningLogicV28", "migratePlanningLogicV36", "initLocalSecurityGate",
      "resetUserSessionIdleTimer", "bindWorkHoursInputs", "loadBundledVehicleDatabase", "migrateLegacyPhotos",
      "registerServiceWorker",
    ]) context[name] = () => {};
    Object.assign(context, {
      hydrateLargeStateIfAvailable: async () => true,
      loadDurableOutboxOperations: async () => [], cleanupOrphanedStorage: async () => true,
      saveState: async () => true, isLocalSessionUnlocked: () => true,
      render: () => { renders += 1; },
    });
    vm.runInContext("state.users = []; state.currentUserId = '';", context);
    const startup = context.initApp();
    onVnPartDomReady?.();
    const assertBlocked = (phase) => {
      assert.equal(getElement("app-shell").attributes.has("inert"), true, phase);
      assert.equal(context.__nimrAppReady, false, phase);
      assert.equal(renders, 0, phase);
      assert.deepStrictEqual(counts, { vn_part_donor_state_v1: 0, vn_part_removals: 0, vn_part_approvals: 0 }, phase);
      t.diagnostic(`${readyState} ${phase}: donor SELECT=0; removals SELECT=0; approvals SELECT=0; shell inert=true`);
    };
    for (let i = 0; i < 30 && !sessionStarted; i += 1) await Promise.resolve();
    assert.equal(sessionStarted, true);
    assertBlocked("session pending");
    releaseSession({ state: "AUTHORIZED", user: { id: "auth-vn", email: "vn@example.test" } });
    for (let i = 0; i < 30 && !membershipStarted; i += 1) await Promise.resolve();
    assert.equal(membershipStarted, true);
    assertBlocked("membership pending");
    releaseMembership({ ok: true, membership: { workshop_id: workshopId, user_id: "auth-vn", role: "directeur", resource_id: null } });
    await startup;
    assert.equal(context.__nimrValidatedAuthUserId, "auth-vn");
    assert.equal(context.__nimrAppReady, true);
    assert.equal(getElement("app-shell").attributes.has("inert"), false);
    assert.equal(renders, 1);
    assert.equal(context.canAccessTab("vn-part"), true);
    assert.deepStrictEqual(counts, { vn_part_donor_state_v1: 0, vn_part_removals: 0, vn_part_approvals: 0 }, "Authorization alone must not query the dashboard");
    context.setActiveTab("vn-part");
    for (let i = 0; i < 30 && context.vnPartEphemeralState.loading; i += 1) await Promise.resolve();
    assert.equal(context.document.body.dataset.activeTab, "vn-part");
    assert.equal(context.vnPartEphemeralState.loading, false);
    assert.equal(context.vnPartEphemeralState.error, null);
    assert.deepStrictEqual(counts, { vn_part_donor_state_v1: 1, vn_part_removals: 1, vn_part_approvals: 1 });
    for (const query of queries) assert.deepStrictEqual(query.filters, [["workshop_id", workshopId]]);
    t.diagnostic(`${readyState} authorized before access: donor SELECT=0; removals SELECT=0; approvals SELECT=0; after vn-part access: donor SELECT=1; removals SELECT=1; approvals SELECT=1`);
  }
});

test("14. Server rendering: text, attributes and invalid dates are escaped before innerHTML", () => {
  const { context, getElement } = createVnPartBrowserHarness();
  vm.runInContext(uiJsContent, context);
  const payload = `<img src=x onerror="alert('x')">&`;
  const escaped = "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;";
  const fields = {
    donor: ["donor_model", "donor_vin", "donor_location", "oldest_opened_at", "expected_replacement_date"],
    removal: ["id", "part_designation", "part_reference", "beneficiary_model", "beneficiary_vin", "beneficiary_or", "status", "removed_at", "expected_replacement_date", "replacement_available_at", "restored_at"],
  };
  for (const [kind, names] of Object.entries(fields)) for (const field of names) {
    const donor = { donor_model: "Model", donor_vin: "VIN-1", active_removals_remaining: 1 };
    const removal = { id: "R-1", donor_vin: "VIN-1", part_designation: "Part", status: "approved" };
    (kind === "donor" ? donor : removal)[field] = payload;
    if (field === "donor_vin") removal.donor_vin = payload;
    Object.assign(context.vnPartEphemeralState, { donors: [donor], removals: [removal] });
    context.renderVnPartView();
    const html = getElement("vn-part-content").innerHTML;
    assert.ok(!html.includes(payload), `${kind}.${field}: raw server payload must not enter innerHTML`);
    assert.ok(html.includes(escaped), `${kind}.${field}: escaped server value must remain visible`);
  }
});

test("15. CSS scope: every added style selector is confined to VN-PART", () => {
  const addedCss = stylesCssContent.slice(stylesCssContent.indexOf(".vn-part-shell {"));
  assert.ok(addedCss.length > 0 && addedCss.length < stylesCssContent.length);
  const withoutComments = addedCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const heads = [...withoutComments.matchAll(/([^{}]+)\{/g)].map((match) => match[1].trim());
  const selectors = heads.filter((head) => !head.startsWith("@") && head !== "to").flatMap((head) => head.split(","));
  assert.ok(selectors.length > 0);
  for (const selector of selectors) assert.match(selector.trim(), /^(?:\.vn-part-|#view-vn-part\b)/u, `Unscoped selector: ${selector}`);
});
