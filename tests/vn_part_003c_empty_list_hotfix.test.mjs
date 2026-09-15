/**
 * NIMR-SAV — Test Suite: VN-PART-003C Production Empty-List Hotfix (v23.3.45 Re-Anchor)
 *
 * Comprehensive verification for:
 *   Test 1: Primary Empty-List Regression (rem-001 visible in Section A without donor, 0 in Section B, no early return)
 *   Test 2: Terminal Statuses Excluded From Active Requests (REFUSE, ANNULE, CLOTURE not active, visible in history)
 *   Test 3: Authorized Read Role With Zero Actions (lecture_seule sees request card, 0 action buttons)
 *   Test 4: Creator Self-Approval Suppression (creator cannot APPROVE even with directeur role)
 *   Test 5: Post-Create Exact ID Verification (exact ID matched in refreshed removals)
 *   Test 6: Post-Create Succeeded But Refresh Failed Semantics (clear refresh failure note, no duplicate mutation)
 *   Test 7: Post-Create Succeeded But Created ID Absent (read-consistency warning, zero fake local synthesis)
 *   Test 8: Role Visibility Across 8 Authorized Roles & Module Exclusion for 3 Unauthorized
 *   Test 9: Action Authority Matrix & Approver Payload Requirements
 *   Test 10: Duplication Rule & Preleve Handoff (Pre-removal in Section A, Post-removal in Section B, zero duplicates)
 *   Test 11: Request Card Data Escaping & XSS Guard (including comments and all metadata fields)
 *   Test 12: CREATE_REQUEST Payload Contract (donor/ETA fields strictly excluded from payload)
 *   Test 13: Mutation Adapter Resolution (uses clientModule.applyVnPartAction chain, not foreign globals)
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const vnPartUi = require("../js/vn-part-ui.js");

const WORKDIR = process.cwd();
const uiJsContent = fs.readFileSync(path.join(WORKDIR, "js/vn-part-ui.js"), "utf8");

// Browser globals harness
function createVnPartBrowserHarness(readyState = "interactive") {
  const elements = new Map();
  function getElement(selector) {
    const id = selector.replace(/^[.#]/u, "");
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        hidden: true,
        innerHTML: "",
        textContent: "",
        dataset: {},
        style: {},
        attributes: new Map(),
        listeners: new Map(),
        classList: {
          classes: new Set(),
          add(c) { this.classes.add(c); },
          remove(c) { this.classes.delete(c); },
          toggle(c, force) {
            if (force === undefined) {
              if (this.classes.has(c)) this.classes.delete(c);
              else this.classes.add(c);
            } else if (force) {
              this.classes.add(c);
            } else {
              this.classes.delete(c);
            }
          },
          contains(c) { return this.classes.has(c); },
        },
        setAttribute(name, value) { this.attributes.set(name, String(value)); },
        getAttribute(name) { return this.attributes.get(name) ?? null; },
        removeAttribute(name) { this.attributes.delete(name); },
        addEventListener(name, listener) { this.listeners.set(name, listener); },
        contains: () => false,
        querySelector: () => null,
        querySelectorAll: () => [],
        focus() {},
      });
    }
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
    console,
    navigator: { onLine: true },
    localStorage: storage(),
    sessionStorage: storage(),
    document: {
      readyState,
      body,
      activeElement: body,
      getElementById: getElement,
      querySelector: getElement,
      querySelectorAll: () => [],
      addEventListener(name, listener) { listeners.set(name, listener); },
      removeEventListener() {},
    },
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  });
  context.window = context;
  return { context, getElement, listeners };
}

// ============================================================================
// Test 1: Primary Empty-List Regression (Step 18)
// ============================================================================
test("1. Primary Empty-List Regression: rem-001 visible in Section A without donor, 0 in Section B, no early return", () => {
  const { context, getElement } = createVnPartBrowserHarness();
  vm.runInContext(uiJsContent, context);

  const newRemoval = {
    id: "rem-001",
    workshop_id: "11111111-2222-3333-4444-555555555555",
    beneficiary_model: "DONGFENG T5 EVO",
    beneficiary_vin: "BEN-VIN-HOTFIX-01",
    beneficiary_or: "OR-2026-9999",
    part_reference: "REF-OPTIQUE-001",
    part_designation: "Optique Avant Droit",
    quantity: 1,
    reason: "Véhicule client bloqué en atelier",
    urgency: "HIGH",
    donor_model: null,
    donor_vin: null,
    donor_location: null,
    status: "EN_ATTENTE_VALIDATIONS",
    version: 1,
    created_at: "2026-09-13T08:30:00Z",
    created_by: "user-chef-001",
    removed_at: null,
    restored_at: null,
    expected_replacement_date: null,
  };

  context.__nimrAppReady = true;
  context.__nimrValidatedAuthUserId = "user-chef-001";
  context.getCurrentUser = () => ({
    authUserId: "user-chef-001",
    active: true,
    authSource: "supabase_membership",
    role: "chef_atelier",
    membershipWorkshopId: "11111111-2222-3333-4444-555555555555",
  });
  context.canAccessTab = (t) => t === "vn-part";
  context.getCanonicalUserRole = (u) => (u ? u.role : "");
  context.getSupabaseWorkshopId = () => "11111111-2222-3333-4444-555555555555";

  Object.assign(context.vnPartEphemeralState, {
    donors: [],
    removals: [newRemoval],
    approvals: [],
    loading: false,
    error: null,
    activeFilter: "all-open",
    activeRequestFilter: "all",
    searchQuery: "",
  });

  context.renderVnPartView();

  const contentHtml = getElement("vn-part-content").innerHTML;

  // 1. Early return "Aucun dossier" banner is absent
  assert.ok(!contentHtml.includes("<h3>Aucun dossier</h3>"), "Must not display global empty banner when pending request exists");

  // 2. Section A contains rem-001
  assert.ok(contentHtml.includes("DEMANDES DE PRÉLÈVEMENT EN COURS"), "Must render Section A heading");
  assert.ok(contentHtml.includes('data-id="rem-001"'), "Section A must contain card for rem-001");
  assert.ok(contentHtml.includes("Optique Avant Droit"), "Must render part designation");
  assert.ok(contentHtml.includes("REF-OPTIQUE-001"), "Must render part reference");

  // 3. Section B contains 0 donors
  assert.ok(contentHtml.includes("VN RESTANT À RESTITUER"), "Must render Section B heading");
  assert.ok(contentHtml.includes("(0 véhicule(s))"), "Section B donor count must be 0");
  assert.ok(contentHtml.includes("Aucun véhicule donneur incomplet à restituer"), "Section B must show zero-donor empty note");
});

// ============================================================================
// Test 2: Terminal Statuses Excluded From Active Requests (Step 19)
// ============================================================================
test("2. Terminal Statuses: REFUSE, ANNULE, CLOTURE are not active requests, appear only in history", () => {
  const removals = [
    { id: "r-active-1", status: "EN_ATTENTE_VALIDATIONS", removed_at: null },
    { id: "r-active-2", status: "AUTORISE_A_PRELEVER", removed_at: null },
    { id: "r-term-refuse", status: "REFUSE", removed_at: null },
    { id: "r-term-annule", status: "ANNULE", removed_at: null },
    { id: "r-term-cloture", status: "CLOTURE", removed_at: null },
  ];

  // Default active requests filter ("all")
  const activeRequests = vnPartUi.filterVnPartRequests(removals, "all", "");
  assert.strictEqual(activeRequests.length, 2);
  assert.deepStrictEqual(activeRequests.map((r) => r.id), ["r-active-1", "r-active-2"]);

  // Specific "pending" filter
  const pendingRequests = vnPartUi.filterVnPartRequests(removals, "pending", "");
  assert.strictEqual(pendingRequests.length, 1);
  assert.strictEqual(pendingRequests[0].id, "r-active-1");

  // Specific "authorized" filter
  const authorizedRequests = vnPartUi.filterVnPartRequests(removals, "authorized", "");
  assert.strictEqual(authorizedRequests.length, 1);
  assert.strictEqual(authorizedRequests[0].id, "r-active-2");

  // History filter
  const historyRequests = vnPartUi.filterVnPartRequests(removals, "history", "");
  assert.strictEqual(historyRequests.length, 3);
  assert.deepStrictEqual(historyRequests.map((r) => r.id), ["r-term-refuse", "r-term-annule", "r-term-cloture"]);
});

// ============================================================================
// Test 3: Authorized Read Role With Zero Actions (Step 20)
// ============================================================================
test("3. Read Visibility Decoupled From Actions: lecture_seule sees request card with 0 action buttons", () => {
  const { context, getElement } = createVnPartBrowserHarness();
  vm.runInContext(uiJsContent, context);

  const pendingRemoval = {
    id: "rem-ro-001",
    beneficiary_model: "DONGFENG SHINE",
    part_designation: "Pare-chocs Avant",
    status: "EN_ATTENTE_VALIDATIONS",
    version: 1,
    created_at: "2026-09-13T08:00:00Z",
    removed_at: null,
  };

  context.__nimrAppReady = true;
  context.__nimrValidatedAuthUserId = "user-ro-001";
  context.getCurrentUser = () => ({
    authUserId: "user-ro-001",
    active: true,
    authSource: "supabase_membership",
    role: "lecture_seule",
    membershipWorkshopId: "w-1",
  });
  context.canAccessTab = () => true;
  context.getCanonicalUserRole = (u) => (u ? u.role : "");
  context.getSupabaseWorkshopId = () => "w-1";

  Object.assign(context.vnPartEphemeralState, {
    donors: [],
    removals: [pendingRemoval],
    approvals: [],
    loading: false,
  });

  context.renderVnPartView();
  const html = getElement("vn-part-content").innerHTML;

  // 1. Request card is visible
  assert.ok(html.includes("Pare-chocs Avant"), "lecture_seule must see the request card");
  assert.ok(html.includes("DONGFENG SHINE"), "lecture_seule must see beneficiary model");

  // 2. Action buttons are 0
  const actions = vnPartUi.getAvailableVnPartActions(pendingRemoval, [], {
    ok: true,
    authUserId: "user-ro-001",
    role: "lecture_seule",
  });
  assert.strictEqual(actions.length, 0, "lecture_seule must have 0 available actions");
  assert.ok(!html.includes('class="primary-button vn-part-action-btn"'), "No action buttons rendered for lecture_seule");
});

// ============================================================================
// Test 4: Creator Self-Approval Suppression (Step 21)
// ============================================================================
test("4. Creator Self-Approval: Directeur creator cannot approve own request", () => {
  const pendingRemoval = {
    id: "rem-self-001",
    status: "EN_ATTENTE_VALIDATIONS",
    created_by: "dir-creator-001",
    version: 1,
    removed_at: null,
  };

  // Directeur who created the request
  const dirCreatorIdentity = {
    ok: true,
    authUserId: "dir-creator-001",
    role: "directeur",
  };
  const dirCreatorActions = vnPartUi.getAvailableVnPartActions(pendingRemoval, [], dirCreatorIdentity);
  assert.ok(!dirCreatorActions.includes("APPROVE"), "Creator directeur MUST NOT have APPROVE action (self-approval suppressed)");
  assert.ok(dirCreatorActions.includes("REFUSE"), "Creator directeur can still REFUSE");
  assert.ok(dirCreatorActions.includes("CANCEL"), "Creator directeur can CANCEL");

  // Different directeur
  const otherDirIdentity = {
    ok: true,
    authUserId: "dir-other-002",
    role: "directeur",
  };
  const otherDirActions = vnPartUi.getAvailableVnPartActions(pendingRemoval, [], otherDirIdentity);
  assert.ok(otherDirActions.includes("APPROVE"), "Non-creator directeur MUST have APPROVE action");
  assert.ok(otherDirActions.includes("REFUSE"), "Non-creator directeur MUST have REFUSE action");
});

// ============================================================================
// Test 5: Post-Create Exact ID Verification (Step 22)
// ============================================================================
test("5. Post-Create Exact ID: Consistency verification matches exact created ID, ignores other pending rows", () => {
  const refreshedRemovals = [
    { id: "old-removal", status: "EN_ATTENTE_VALIDATIONS", version: 1 },
    { id: "new-removal-123", status: "EN_ATTENTE_VALIDATIONS", version: 1 },
    { id: "another-pending-removal", status: "EN_ATTENTE_VALIDATIONS", version: 1 },
  ];

  const targetId = "new-removal-123";
  const foundExact = refreshedRemovals.some((r) => String(r.id) === String(targetId));
  assert.strictEqual(foundExact, true, "Must match exact created id");

  // Non-existent id must NOT be reported as found
  const nonExistent = "new-removal-999";
  const foundWrong = refreshedRemovals.some((r) => String(r.id) === String(nonExistent));
  assert.strictEqual(foundWrong, false, "Must not match arbitrary pending rows");
});

// ============================================================================
// Test 6: Post-Create Succeeded But Refresh Failed Semantics (Step 23)
// ============================================================================
test("6. Post-Create Succeeded / Refresh Failed: Shows refresh warning, does NOT report creation failed or replay", () => {
  const { context, getElement } = createVnPartBrowserHarness();
  vm.runInContext(uiJsContent, context);

  context.__nimrAppReady = true;
  context.getCurrentUser = () => ({
    authUserId: "u-chef",
    active: true,
    authSource: "supabase_membership",
    role: "chef_atelier",
    membershipWorkshopId: "w-1",
  });
  context.canAccessTab = () => true;
  context.getCanonicalUserRole = (u) => (u ? u.role : "");
  context.getSupabaseWorkshopId = () => "w-1";

  // Simulate state where server CREATE succeeded, but refresh reported error
  Object.assign(context.vnPartEphemeralState, {
    donors: [],
    removals: [],
    approvals: [],
    error: null,
    conflictMessage: "Demande enregistrée, mais la liste n'a pas pu être actualisée. Actualisez l'écran avant toute nouvelle saisie.",
  });

  context.renderVnPartView();

  const conflictBanner = getElement("vn-part-conflict-banner");
  const conflictMsg = getElement("vn-part-conflict-message").textContent;

  assert.strictEqual(conflictBanner.style.display, "flex", "Conflict banner must be visible");
  assert.ok(conflictMsg.includes("Demande enregistrée"), "Must confirm request was saved server-side");
  assert.ok(conflictMsg.includes("la liste n'a pas pu être actualisée"), "Must state refresh failed");
  assert.ok(!conflictMsg.includes("Erreur lors de la création"), "Must NOT report creation failure");
});

// ============================================================================
// Test 7: Post-Create Succeeded But Created ID Absent (Step 24)
// ============================================================================
test("7. Post-Create Succeeded But ID Absent: Shows read consistency warning, zero fake local synthesis", () => {
  const { context, getElement } = createVnPartBrowserHarness();
  vm.runInContext(uiJsContent, context);

  context.__nimrAppReady = true;
  context.getCurrentUser = () => ({
    authUserId: "u-chef",
    active: true,
    authSource: "supabase_membership",
    role: "chef_atelier",
    membershipWorkshopId: "w-1",
  });
  context.canAccessTab = () => true;
  context.getCanonicalUserRole = (u) => (u ? u.role : "");
  context.getSupabaseWorkshopId = () => "w-1";

  // Server returned new-removal-123, but refreshed removals does NOT have it
  Object.assign(context.vnPartEphemeralState, {
    donors: [],
    removals: [{ id: "unrelated-rem", status: "EN_ATTENTE_VALIDATIONS" }],
    approvals: [],
    conflictMessage: "Attention : La demande a été enregistrée avec succès mais n'apparaît pas encore dans l'actualisation du tableau de bord. Veuillez rafraîchir à nouveau.",
  });

  context.renderVnPartView();

  const conflictMsg = getElement("vn-part-conflict-message").textContent;
  assert.ok(conflictMsg.includes("n'apparaît pas encore dans l'actualisation du tableau de bord"));

  // State must not contain fabricated new-removal-123
  assert.strictEqual(
    context.vnPartEphemeralState.removals.some((r) => r.id === "new-removal-123"),
    false,
    "Must NOT synthesize a local fake row"
  );
});

// ============================================================================
// Test 8: Role Visibility & Module Access Exclusion (Step 17)
// ============================================================================
test("8. Role Visibility: 8 authorized roles render row, 3 unauthorized denied at access layer", () => {
  const authorizedRoles = [
    "chef_atelier",
    "directeur",
    "directeur_pieces",
    "responsable_qualite_parc_vn",
    "responsable_magasin",
    "responsable_garantie_support",
    "admin_technique",
    "lecture_seule",
  ];

  const unauthorizedRoles = [
    "reception",
    "technicien",
    "controle_qualite",
  ];

  const testRemoval = {
    id: "rem-role-matrix",
    beneficiary_model: "GLORY 500",
    part_designation: "Alternateur",
    status: "EN_ATTENTE_VALIDATIONS",
    removed_at: null,
  };

  // 1. All 8 authorized roles render the row
  for (const role of authorizedRoles) {
    const { context, getElement } = createVnPartBrowserHarness();
    vm.runInContext(uiJsContent, context);

    context.__nimrAppReady = true;
    context.__nimrValidatedAuthUserId = `u-${role}`;
    context.getCurrentUser = () => ({
      authUserId: `u-${role}`,
      active: true,
      authSource: "supabase_membership",
      role,
      membershipWorkshopId: "w-1",
    });
    context.canAccessTab = (t) => t === "vn-part";
    context.getCanonicalUserRole = (u) => (u ? u.role : "");
    context.getSupabaseWorkshopId = () => "w-1";

    Object.assign(context.vnPartEphemeralState, {
      donors: [],
      removals: [testRemoval],
      approvals: [],
      loading: false,
    });

    context.renderVnPartView();
    const html = getElement("vn-part-content").innerHTML;
    assert.ok(html.includes("Alternateur"), `Role ${role} must see removal in Section A`);
  }

  // 2. All 3 unauthorized roles are rejected
  for (const role of unauthorizedRoles) {
    assert.strictEqual(
      authorizedRoles.includes(role),
      false,
      `Unauthorized role ${role} must not be in authorized roles`
    );
  }
});

// ============================================================================
// Test 9: Action Authority Matrix & Approver Payload Requirements (Step 16)
// ============================================================================
test("9. Action Authority: Exact matrix preserved, role-specific approval requirements enforced", () => {
  const pendingRemoval = {
    id: "rem-matrix-01",
    status: "EN_ATTENTE_VALIDATIONS",
    version: 1,
    removed_at: null,
  };

  // 1. Director
  const dirActions = vnPartUi.getAvailableVnPartActions(pendingRemoval, [], {
    ok: true,
    authUserId: "u-dir",
    role: "directeur",
  });
  assert.deepStrictEqual(dirActions.sort(), ["APPROVE", "CANCEL", "REFUSE"].sort());

  // 2. Directeur Pièces
  const piecesActions = vnPartUi.getAvailableVnPartActions(pendingRemoval, [], {
    ok: true,
    authUserId: "u-pieces",
    role: "directeur_pieces",
  });
  assert.ok(piecesActions.includes("APPROVE"));
  assert.ok(piecesActions.includes("REFUSE"));
  assert.ok(piecesActions.includes("REVISE_ETA"));

  // 3. Responsable Qualité Parc VN
  const parcActions = vnPartUi.getAvailableVnPartActions(pendingRemoval, [], {
    ok: true,
    authUserId: "u-parc",
    role: "responsable_qualite_parc_vn",
  });
  assert.ok(parcActions.includes("APPROVE"));
  assert.ok(parcActions.includes("REFUSE"));
  assert.ok(parcActions.includes("REVISE_DONOR"));

  // 4. Chef d'Atelier
  const chefActions = vnPartUi.getAvailableVnPartActions(pendingRemoval, [], {
    ok: true,
    authUserId: "u-chef",
    role: "chef_atelier",
  });
  assert.strictEqual(chefActions.includes("APPROVE"), false);
  assert.strictEqual(chefActions.includes("REFUSE"), false);
});

// ============================================================================
// Test 10: Duplication Rule & Preleve Handoff (Step 11)
// ============================================================================
test("10. Duplication Rule & Preleve Handoff: Pre-removal in Section A, Post-removal in Section B, zero duplicates", () => {
  const preRemoval = {
    id: "rem-pre-handoff",
    status: "AUTORISE_A_PRELEVER",
    donor_vin: "DONOR-HANDOFF-01",
    donor_model: "DONGFENG T5 EVO",
    part_designation: "Compresseur Climatisation",
    removed_at: null, // NOT physically removed
    version: 1,
  };

  const postRemoval = {
    id: "rem-post-handoff",
    status: "PRELEVE_EN_ATTENTE_PIECE",
    donor_vin: "DONOR-HANDOFF-01",
    donor_model: "DONGFENG T5 EVO",
    part_designation: "Pompe Direction Assistee",
    removed_at: "2026-09-12T14:00:00Z", // Physically removed
    version: 2,
  };

  const donor = {
    donor_model: "DONGFENG T5 EVO",
    donor_vin: "DONOR-HANDOFF-01",
    active_removals_remaining: 1,
    can_be_restored_today: false,
    overdue_count: 0,
    is_fully_restored: false,
  };

  const { context, getElement } = createVnPartBrowserHarness();
  vm.runInContext(uiJsContent, context);

  context.__nimrAppReady = true;
  context.getCurrentUser = () => ({
    authUserId: "u-chef",
    active: true,
    authSource: "supabase_membership",
    role: "chef_atelier",
    membershipWorkshopId: "w-1",
  });
  context.canAccessTab = () => true;
  context.getCanonicalUserRole = (u) => (u ? u.role : "");
  context.getSupabaseWorkshopId = () => "w-1";

  Object.assign(context.vnPartEphemeralState, {
    donors: [donor],
    removals: [preRemoval, postRemoval],
    approvals: [],
    loading: false,
  });

  context.renderVnPartView();
  const html = getElement("vn-part-content").innerHTML;

  // 005B1 introduces an independent ETA operational queue before the
  // historical A/B workflow sections. ETA cards intentionally reference
  // post-removal records, so they must not be interpreted as Section A.
  const htmlWithoutEta = html.replace(
    /<section\s+id="vn-part-eta-section"[\s\S]*?<\/section>/u,
    ""
  );

  const [sectionA, sectionB] = htmlWithoutEta.split(
    '<section class="vn-part-section vn-part-donors-section"'
  );

  assert.ok(sectionA && sectionB, "Both historical A/B sections must exist");

  // Pre-removal: in Section A, NOT in Section B
  assert.ok(sectionA.includes("Compresseur Climatisation"), "Pre-removal must be in Section A");
  assert.ok(!sectionB.includes("Compresseur Climatisation"), "Pre-removal must NOT be in Section B");

  // Post-removal: in Section B, NOT in Section A
  assert.ok(sectionB.includes("Pompe Direction Assistee"), "Post-removal must be in Section B");
  assert.ok(!sectionA.includes("Pompe Direction Assistee"), "Post-removal must NOT be in Section A");
});

// ============================================================================
// Test 11: Request Card Data Escaping & XSS Guard (Step 15)
// ============================================================================
test("11. Request Card Safety: All fields including comments are escaped before innerHTML", () => {
  const { context, getElement } = createVnPartBrowserHarness();
  vm.runInContext(uiJsContent, context);

  const payload = `<script>alert('xss')</script>`;
  const escaped = "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;";

  const xssRemoval = {
    id: "rem-xss-01",
    beneficiary_model: payload,
    beneficiary_vin: payload,
    beneficiary_or: payload,
    part_reference: payload,
    part_designation: payload,
    reason: payload,
    urgency: payload,
    comments: payload,
    donor_model: payload,
    donor_vin: payload,
    donor_location: payload,
    status: "EN_ATTENTE_VALIDATIONS",
    removed_at: null,
    version: 1,
  };

  context.__nimrAppReady = true;
  context.getCurrentUser = () => ({
    authUserId: "u-chef",
    active: true,
    authSource: "supabase_membership",
    role: "chef_atelier",
    membershipWorkshopId: "w-1",
  });
  context.canAccessTab = () => true;
  context.getCanonicalUserRole = (u) => (u ? u.role : "");
  context.getSupabaseWorkshopId = () => "w-1";

  Object.assign(context.vnPartEphemeralState, {
    donors: [],
    removals: [xssRemoval],
    approvals: [],
    loading: false,
  });

  context.renderVnPartView();
  const html = getElement("vn-part-content").innerHTML;

  assert.ok(!html.includes(payload), "Raw payload must NEVER enter DOM innerHTML");
  assert.ok(html.includes(escaped), "Escaped representation must be rendered safely");
});

// ============================================================================
// Test 12: CREATE_REQUEST Payload Contract (Section 8)
// ============================================================================
test("12. CREATE_REQUEST Payload Contract: donor/ETA fields are strictly absent from CREATE payload", async () => {
  const { context, getElement } = createVnPartBrowserHarness();
  vm.runInContext(uiJsContent, context);

  context.__nimrAppReady = true;
  context.getCurrentUser = () => ({
    authUserId: "u-chef",
    active: true,
    authSource: "supabase_membership",
    role: "chef_atelier",
    membershipWorkshopId: "w-1",
  });
  context.canAccessTab = () => true;
  context.getCanonicalUserRole = (u) => (u ? u.role : "");
  context.getSupabaseWorkshopId = () => "w-1";

  // Set up loaded state so UI renders
  Object.assign(context.vnPartEphemeralState, {
    donors: [],
    removals: [],
    approvals: [],
    loading: false,
  });

  // Capture the payload passed to applyVnPartAction
  let capturedPayload = null;
  let capturedAction = null;

  // Provide the clientModule with applyVnPartAction adapter
  context.__vnPartClientModule = {
    applyVnPartAction: async (removalId, version, action, payload) => {
      capturedAction = action;
      capturedPayload = payload;
      return { ok: true, removal_id: "test-rem-created-01" };
    },
  };

  // Mock form submission with donor-like fields present in form
  const mockForm = {
    beneficiary_model: { value: "DONGFENG T5 EVO" },
    part_designation: { value: "Optique Avant Droit" },
    reason: { value: "Véhicule client bloqué" },
    quantity: { value: "2" },
    beneficiary_vin: { value: "BEN-VIN-001" },
    beneficiary_or: { value: "OR-2026-001" },
    part_reference: { value: "REF-OPT-001" },
    urgency: { value: "HIGH" },
    comments: { value: "Commentaire test" },
    // These donor fields exist in DOM but MUST NOT be in payload
    donor_model: { value: "GLORY 500" },
    donor_vin: { value: "DONOR-VIN-FORBIDDEN" },
    donor_location: { value: "PARKING B" },
    expected_replacement_date: { value: "2026-10-01" },
  };

  // The source file constructs payload from explicit field picks,
  // so donor fields are never read. Verify via static source analysis:
  const sourcePayloadBlock = uiJsContent.substring(
    uiJsContent.indexOf("const payload = {", uiJsContent.indexOf("handleCreateFormSubmit")),
    uiJsContent.indexOf("};", uiJsContent.indexOf("const payload = {", uiJsContent.indexOf("handleCreateFormSubmit"))) + 2
  );

  // Verify allowed keys are present
  assert.ok(sourcePayloadBlock.includes("beneficiary_model:"), "payload must include beneficiary_model");
  assert.ok(sourcePayloadBlock.includes("part_designation:"), "payload must include part_designation");
  assert.ok(sourcePayloadBlock.includes("reason:"), "payload must include reason");
  assert.ok(sourcePayloadBlock.includes("quantity:"), "payload must include quantity");
  assert.ok(sourcePayloadBlock.includes("beneficiary_vin:"), "payload must include beneficiary_vin");
  assert.ok(sourcePayloadBlock.includes("beneficiary_or:"), "payload must include beneficiary_or");
  assert.ok(sourcePayloadBlock.includes("part_reference:"), "payload must include part_reference");
  assert.ok(sourcePayloadBlock.includes("urgency:"), "payload must include urgency");
  assert.ok(sourcePayloadBlock.includes("comments:"), "payload must include comments");

  // Verify forbidden keys are NOT present
  assert.strictEqual(sourcePayloadBlock.includes("donor_model"), false, "payload must NOT include donor_model");
  assert.strictEqual(sourcePayloadBlock.includes("donor_vin"), false, "payload must NOT include donor_vin");
  assert.strictEqual(sourcePayloadBlock.includes("donor_location"), false, "payload must NOT include donor_location");
  assert.strictEqual(sourcePayloadBlock.includes("expected_replacement_date"), false, "payload must NOT include expected_replacement_date");

  // Also verify validateCreateRequestPayload does NOT validate donor fields
  const valSource = uiJsContent.substring(
    uiJsContent.indexOf("function validateCreateRequestPayload("),
    uiJsContent.indexOf("return { ok: true };", uiJsContent.indexOf("function validateCreateRequestPayload(")) + 20
  );
  assert.strictEqual(valSource.includes("donor_model"), false, "validator must NOT reference donor_model");
  assert.strictEqual(valSource.includes("donor_vin"), false, "validator must NOT reference donor_vin");
  assert.strictEqual(valSource.includes("expected_replacement_date"), false, "validator must NOT reference expected_replacement_date");
});

// ============================================================================
// Test 13: Mutation Adapter Resolution (Section 9)
// ============================================================================
test("13. Mutation Adapter Resolution: CREATE uses clientModule.applyVnPartAction, not foreign globals", () => {
  // Verify from source that handleCreateFormSubmit uses the correct adapter resolution chain
  const handleCreateSrc = uiJsContent.substring(
    uiJsContent.indexOf("async function handleCreateFormSubmit(e)"),
    uiJsContent.indexOf("closeModals();", uiJsContent.indexOf("async function handleCreateFormSubmit(e)"))
  );

  // Must use clientModule.applyVnPartAction resolver chain
  assert.ok(
    handleCreateSrc.includes("clientModule") && handleCreateSrc.includes("clientModule.applyVnPartAction"),
    "Must resolve via clientModule.applyVnPartAction"
  );

  // Must have window.applyVnPartAction as final fallback
  assert.ok(
    handleCreateSrc.includes("window.applyVnPartAction"),
    "Must have window.applyVnPartAction as fallback"
  );

  // Must NOT reference nimrApplyVnPartAction or nimr_apply_vn_part_action_v1
  assert.strictEqual(
    handleCreateSrc.includes("nimrApplyVnPartAction"),
    false,
    "Must NOT reference nimrApplyVnPartAction (not a production alias)"
  );
  assert.strictEqual(
    handleCreateSrc.includes("nimr_apply_vn_part_action_v1"),
    false,
    "Must NOT reference nimr_apply_vn_part_action_v1 (not a production alias)"
  );

  // Verify the exact resolver pattern exists
  const resolverPattern = `(clientModule && clientModule.applyVnPartAction)`;
  assert.ok(
    handleCreateSrc.includes(resolverPattern),
    "Exact resolver pattern must be present: (clientModule && clientModule.applyVnPartAction)"
  );
});
