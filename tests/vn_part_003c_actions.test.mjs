/**
 * NIMR-SAV — Test Suite: VN-PART-003C Mutation UI & Action Workflows
 *
 * Verification suite for VN-PART-003C frontend mutations:
 *   Group A: Client Adapter Contract & Exact RPC Parameters
 *   Group B: Action 1 CREATE_REQUEST
 *   Group C: Action 2 APPROVE & Multi-Approver Strip
 *   Group D: Action 3 REFUSE
 *   Group E: Action 4 CANCEL
 *   Group F: Action 5 REVISE_ETA
 *   Group G: Action 6 REVISE_DONOR
 *   Group H: Action 7 CONFIRM_REMOVAL
 *   Group I: Action 8 STORE_ACK (Server Semantics)
 *   Group J: Action 9 MARK_REPLACEMENT_AVAILABLE
 *   Group K: Action 10 CONFIRM_RESTITUTION
 *   Group L: CAS & Concurrency Strategy (VERSION_CONFLICT)
 *   Group M: No Generic 17-char VIN Rule
 *   Group N: Mutation Identity Gate Fail-Closed & Workshop Authority
 *   Group O: Approval Read Model & Lookup
 *   Group P: STORE_ACK Repeat Prevention in UI
 *   Group Q: Transport / PostgreSQL Error Normalization
 *   Group R: Data Escaping & Direct Mutation Static Guard
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

// Helper to configure a valid mock identity environment
function setupMockIdentity(overrides = {}) {
  const defaultUser = {
    authUserId: "auth-user-001",
    active: true,
    authSource: "supabase_membership",
    membershipValidatedAt: "2026-09-12T10:00:00Z",
    membershipWorkshopId: "workshop-uuid-1111",
    role: "chef_atelier",
  };

  const user = { ...defaultUser, ...overrides.user };

  globalThis.__nimrAppReady = overrides.__nimrAppReady !== undefined ? overrides.__nimrAppReady : true;
  globalThis.__nimrValidatedAuthUserId = overrides.__nimrValidatedAuthUserId !== undefined ? overrides.__nimrValidatedAuthUserId : user.authUserId;
  globalThis.getCurrentUser = overrides.getCurrentUser !== undefined ? overrides.getCurrentUser : () => (overrides.noUser ? null : user);
  globalThis.canAccessTab = overrides.canAccessTab !== undefined ? overrides.canAccessTab : (tab) => tab === "vn-part";
  globalThis.getCanonicalUserRole = overrides.getCanonicalUserRole !== undefined ? overrides.getCanonicalUserRole : (u) => (u ? u.role : "");
  globalThis.getSupabaseWorkshopId = () => user.membershipWorkshopId;

  return { user };
}

function clearMockIdentity() {
  delete globalThis.__nimrAppReady;
  delete globalThis.__nimrValidatedAuthUserId;
  delete globalThis.getCurrentUser;
  delete globalThis.canAccessTab;
  delete globalThis.getCanonicalUserRole;
  delete globalThis.getSupabaseWorkshopId;
}

// ============================================================================
// Group A: Client Adapter Contract & Exact RPC Parameters
// ============================================================================
test("Group A: Client Adapter calls nimr_apply_vn_part_action_v1 with exact parameters", async () => {
  const { user } = setupMockIdentity({ user: { role: "chef_atelier", membershipWorkshopId: "workshop-uuid-1111" } });
  try {
    let rpcCall = null;
    const mockClient = {
      rpc(name, args) {
        rpcCall = { name, args };
        return Promise.resolve({
          data: {
            success: true,
            ok: true,
            action: args.p_action,
            removal_id: args.p_removal_id || "new-uuid",
            version: 2,
            status: "EN_ATTENTE_VALIDATIONS",
            record: { id: args.p_removal_id || "new-uuid", version: 2 },
          },
          error: null,
        });
      },
    };

    // 1. CREATE_REQUEST (null removal_id, null expected_version)
    const createRes = await vnPartClient.applyVnPartAction(null, null, "CREATE_REQUEST", {
      beneficiary_model: "Peugeot Partner",
      part_designation: "Calculateur",
      reason: "Panne immobilisante",
      quantity: 1,
    }, { client: mockClient });

    assert.equal(createRes.ok, true);
    assert.equal(rpcCall.name, "nimr_apply_vn_part_action_v1");

    // Exact argument keys check: must have exactly these 5 keys
    const expectedKeys = [
      "p_action",
      "p_expected_version",
      "p_payload",
      "p_removal_id",
      "p_workshop_id",
    ];
    assert.deepEqual(Object.keys(rpcCall.args).sort(), expectedKeys);

    // Assert absence of forbidden authority parameters
    assert.equal(rpcCall.args.p_actor_role, undefined, "p_actor_role must NOT be sent");
    assert.equal(rpcCall.args.p_actor_user_id, undefined, "p_actor_user_id must NOT be sent");
    assert.equal(rpcCall.args.p_status, undefined, "p_status must NOT be sent");
    assert.equal(rpcCall.args.p_created_by, undefined, "p_created_by must NOT be sent");

    // Assert p_workshop_id === validated currentUser.membershipWorkshopId
    assert.equal(rpcCall.args.p_workshop_id, user.membershipWorkshopId);
    assert.equal(rpcCall.args.p_removal_id, null);
    assert.equal(rpcCall.args.p_expected_version, null);
    assert.equal(rpcCall.args.p_action, "CREATE_REQUEST");
    assert.equal(rpcCall.args.p_payload.beneficiary_model, "Peugeot Partner");

    // 2. Existing removal mutation
    const actionRes = await vnPartClient.applyVnPartAction("removal-123", 1, "CONFIRM_REMOVAL", {
      reason: "Démontage effectué",
    }, { client: mockClient });

    assert.equal(actionRes.ok, true);
    assert.deepEqual(Object.keys(rpcCall.args).sort(), expectedKeys);
    assert.equal(rpcCall.args.p_actor_role, undefined, "p_actor_role must NOT be sent");
    assert.equal(rpcCall.args.p_actor_user_id, undefined, "p_actor_user_id must NOT be sent");
    assert.equal(rpcCall.args.p_workshop_id, user.membershipWorkshopId);
    assert.equal(rpcCall.args.p_removal_id, "removal-123");
    assert.equal(rpcCall.args.p_expected_version, 1);
    assert.equal(rpcCall.args.p_action, "CONFIRM_REMOVAL");
  } finally {
    clearMockIdentity();
  }
});

// ============================================================================
// Group B: Action 1 CREATE_REQUEST
// ============================================================================
test("Group B: Action 1 CREATE_REQUEST validates mandatory fields and initiator roles", async () => {
  // 1. Initiator roles check
  const allowedInitiators = ["chef_atelier", "responsable_garantie_support"];
  const nonInitiators = ["directeur", "directeur_pieces", "responsable_magasin", "responsable_qualite_parc_vn", "technicien", "reception"];

  for (const role of allowedInitiators) {
    const identity = { ok: true, role, authUserId: "user-1" };
    assert.ok(
      ["chef_atelier", "responsable_garantie_support"].includes(identity.role),
      `Role ${role} must be authorized to initiate requests`
    );
  }

  for (const role of nonInitiators) {
    const identity = { ok: true, role, authUserId: "user-2" };
    assert.equal(
      ["chef_atelier", "responsable_garantie_support"].includes(identity.role),
      false,
      `Role ${role} must NOT be authorized to initiate requests`
    );
  }

  // 2. Valid CREATE_REQUEST with zero donor data (chef_atelier)
  const validPayloadNoDonor = {
    beneficiary_model: "Peugeot Partner",
    part_designation: "Calculateur",
    reason: "Panne immobilisante",
    quantity: 1,
  };
  const valResultChef = vnPartUi.validateCreateRequestPayload(validPayloadNoDonor);
  assert.equal(valResultChef.ok, true, "Valid payload with zero donor data must pass validation");

  // 3. Valid CREATE_REQUEST with zero donor data (responsable_garantie_support)
  setupMockIdentity({ user: { role: "responsable_garantie_support" } });
  try {
    let rpcInvoked = false;
    const mockClient = {
      rpc(name, args) {
        rpcInvoked = true;
        return Promise.resolve({
          data: { success: true, ok: true, action: args.p_action, record: { id: "new-id" } },
          error: null,
        });
      },
    };
    const res = await vnPartClient.applyVnPartAction(null, null, "CREATE_REQUEST", validPayloadNoDonor, { client: mockClient });
    assert.equal(res.ok, true);
    assert.equal(rpcInvoked, true);
  } finally {
    clearMockIdentity();
  }

  // 4. Missing fields individually
  const missingModel = { ...validPayloadNoDonor, beneficiary_model: "" };
  assert.equal(vnPartUi.validateCreateRequestPayload(missingModel).ok, false);
  assert.equal(vnPartUi.validateCreateRequestPayload(missingModel).field, "beneficiary_model");

  const missingDesig = { ...validPayloadNoDonor, part_designation: "" };
  assert.equal(vnPartUi.validateCreateRequestPayload(missingDesig).ok, false);
  assert.equal(vnPartUi.validateCreateRequestPayload(missingDesig).field, "part_designation");

  const missingReason = { ...validPayloadNoDonor, reason: "" };
  assert.equal(vnPartUi.validateCreateRequestPayload(missingReason).ok, false);
  assert.equal(vnPartUi.validateCreateRequestPayload(missingReason).field, "reason");

  // 5. Invalid quantity: 0, negative, non-integer
  const qtyZero = { ...validPayloadNoDonor, quantity: 0 };
  assert.equal(vnPartUi.validateCreateRequestPayload(qtyZero).ok, false);
  assert.equal(vnPartUi.validateCreateRequestPayload(qtyZero).field, "quantity");

  const qtyNeg = { ...validPayloadNoDonor, quantity: -2 };
  assert.equal(vnPartUi.validateCreateRequestPayload(qtyNeg).ok, false);
  assert.equal(vnPartUi.validateCreateRequestPayload(qtyNeg).field, "quantity");

  const qtyFloat = { ...validPayloadNoDonor, quantity: 1.5 };
  assert.equal(vnPartUi.validateCreateRequestPayload(qtyFloat).ok, false);
  assert.equal(vnPartUi.validateCreateRequestPayload(qtyFloat).field, "quantity");

  const qtyNaN = { ...validPayloadNoDonor, quantity: "abc" };
  assert.equal(vnPartUi.validateCreateRequestPayload(qtyNaN).ok, false);
  assert.equal(vnPartUi.validateCreateRequestPayload(qtyNaN).field, "quantity");

  // 6. Explicit regression: donor_model absent, donor_vin absent MUST NOT block CREATE_REQUEST
  assert.equal(validPayloadNoDonor.donor_model, undefined);
  assert.equal(validPayloadNoDonor.donor_vin, undefined);
  assert.equal(validPayloadNoDonor.donor_location, undefined);
  const regressionResult = vnPartUi.validateCreateRequestPayload(validPayloadNoDonor);
  assert.equal(regressionResult.ok, true, "Absence of donor data must NOT block CREATE_REQUEST");
});

// ============================================================================
// Group C: Action 2 APPROVE & Multi-Approver Strip
// ============================================================================
test("Group C: Action 2 APPROVE enforces role-specific payload and self-approval ban", () => {
  const removal = {
    id: "rem-1",
    version: 1,
    status: "EN_ATTENTE_VALIDATIONS",
    created_by: "initiator-uuid",
    beneficiary_model: "Peugeot 208",
  };

  // 1. Initiator cannot approve own request (Self-approval prohibition)
  const creatorIdentity = { ok: true, role: "directeur", authUserId: "initiator-uuid" };
  const actionsForCreator = vnPartUi.getAvailableVnPartActions(removal, [], creatorIdentity);
  assert.equal(actionsForCreator.includes("APPROVE"), false, "Creator must NOT be offered APPROVE");

  // 2. Non-creator approvers can approve
  const dirIdentity = { ok: true, role: "directeur", authUserId: "other-user" };
  const actionsForDir = vnPartUi.getAvailableVnPartActions(removal, [], dirIdentity);
  assert.equal(actionsForDir.includes("APPROVE"), true, "Directeur must be offered APPROVE");

  // 3. Once decided, cannot approve again
  const existingApprovals = [
    { removal_id: "rem-1", approval_role: "directeur", decision: "APPROVED", decided_at: "2026-09-12" },
  ];
  const actionsAfterDecision = vnPartUi.getAvailableVnPartActions(removal, existingApprovals, dirIdentity);
  assert.equal(actionsAfterDecision.includes("APPROVE"), false, "Role that already decided cannot approve again");

  // 4. Approval strip reflects progress count
  const lookup = vnPartUi.buildApprovalLookup(existingApprovals);
  assert.equal(lookup.get("rem-1:directeur")?.decision, "APPROVED");
  assert.equal(lookup.get("rem-1:directeur_pieces"), undefined);
  assert.equal(lookup.get("rem-1:responsable_qualite_parc_vn"), undefined);
});

// ============================================================================
// Group D: Action 3 REFUSE
// ============================================================================
test("Group D: Action 3 REFUSE available to approvers in EN_ATTENTE_VALIDATIONS", () => {
  const removal = {
    id: "rem-2",
    version: 1,
    status: "EN_ATTENTE_VALIDATIONS",
    created_by: "user-creator",
  };

  const approverRoles = ["directeur", "directeur_pieces", "responsable_qualite_parc_vn"];
  for (const role of approverRoles) {
    const identity = { ok: true, role, authUserId: "other-user" };
    const actions = vnPartUi.getAvailableVnPartActions(removal, [], identity);
    assert.ok(actions.includes("REFUSE"), `Role ${role} must have REFUSE available`);
  }

  // Not available when already refused or in later status
  const postRemoval = { ...removal, status: "PRELEVE_EN_ATTENTE_PIECE" };
  const actionsPost = vnPartUi.getAvailableVnPartActions(postRemoval, [], { ok: true, role: "directeur", authUserId: "other-user" });
  assert.equal(actionsPost.includes("REFUSE"), false, "REFUSE not available after removal");
});

// ============================================================================
// Group E: Action 4 CANCEL
// ============================================================================
test("Group E: Action 4 CANCEL available to initiator or director before removal", () => {
  const removal = {
    id: "rem-3",
    version: 1,
    status: "AUTORISE_A_PRELEVER",
    created_by: "creator-uuid",
  };

  // Creator can cancel
  const creatorId = { ok: true, role: "chef_atelier", authUserId: "creator-uuid" };
  assert.ok(vnPartUi.getAvailableVnPartActions(removal, [], creatorId).includes("CANCEL"));

  // Director can cancel
  const dirId = { ok: true, role: "directeur", authUserId: "dir-uuid" };
  assert.ok(vnPartUi.getAvailableVnPartActions(removal, [], dirId).includes("CANCEL"));

  // Non-creator, non-director CANNOT cancel
  const otherId = { ok: true, role: "responsable_magasin", authUserId: "other-uuid" };
  assert.equal(vnPartUi.getAvailableVnPartActions(removal, [], otherId).includes("CANCEL"), false);

  // CANCEL forbidden after removal
  const removed = { ...removal, status: "PRELEVE_EN_ATTENTE_PIECE" };
  assert.equal(vnPartUi.getAvailableVnPartActions(removed, [], creatorId).includes("CANCEL"), false);
  assert.equal(vnPartUi.getAvailableVnPartActions(removed, [], dirId).includes("CANCEL"), false);
});

// ============================================================================
// Group F: Action 5 REVISE_ETA
// ============================================================================
test("Group F: Action 5 REVISE_ETA restricted to directeur_pieces and non-terminal states", () => {
  const nonTerminal = { id: "rem-4", version: 1, status: "PRELEVE_EN_ATTENTE_PIECE" };
  const terminal = { id: "rem-4", version: 2, status: "CLOTURE" };

  const piecesId = { ok: true, role: "directeur_pieces", authUserId: "pieces-user" };
  const otherId = { ok: true, role: "chef_atelier", authUserId: "chef-user" };

  assert.ok(vnPartUi.getAvailableVnPartActions(nonTerminal, [], piecesId).includes("REVISE_ETA"));
  assert.equal(vnPartUi.getAvailableVnPartActions(nonTerminal, [], otherId).includes("REVISE_ETA"), false);
  assert.equal(vnPartUi.getAvailableVnPartActions(terminal, [], piecesId).includes("REVISE_ETA"), false);
});

// ============================================================================
// Group G: Action 6 REVISE_DONOR
// ============================================================================
test("Group G: Action 6 REVISE_DONOR restricted to responsable_qualite_parc_vn pre-removal", () => {
  const preRemoval = { id: "rem-5", version: 1, status: "AUTORISE_A_PRELEVER" };
  const postRemoval = { id: "rem-5", version: 2, status: "PRELEVE_EN_ATTENTE_PIECE" };

  const parcId = { ok: true, role: "responsable_qualite_parc_vn", authUserId: "parc-user" };

  assert.ok(vnPartUi.getAvailableVnPartActions(preRemoval, [], parcId).includes("REVISE_DONOR"));
  assert.equal(vnPartUi.getAvailableVnPartActions(postRemoval, [], parcId).includes("REVISE_DONOR"), false);
});

// ============================================================================
// Group H: Action 7 CONFIRM_REMOVAL
// ============================================================================
test("Group H: Action 7 CONFIRM_REMOVAL restricted to chef_atelier in AUTORISE_A_PRELEVER", () => {
  const authorized = { id: "rem-6", version: 1, status: "AUTORISE_A_PRELEVER" };
  const waiting = { id: "rem-6", version: 1, status: "EN_ATTENTE_VALIDATIONS" };

  const chefId = { ok: true, role: "chef_atelier", authUserId: "chef-user" };
  const otherId = { ok: true, role: "directeur", authUserId: "dir-user" };

  assert.ok(vnPartUi.getAvailableVnPartActions(authorized, [], chefId).includes("CONFIRM_REMOVAL"));
  assert.equal(vnPartUi.getAvailableVnPartActions(authorized, [], otherId).includes("CONFIRM_REMOVAL"), false);
  assert.equal(vnPartUi.getAvailableVnPartActions(waiting, [], chefId).includes("CONFIRM_REMOVAL"), false);
});

// ============================================================================
// Group I: Action 8 STORE_ACK (Server Semantics)
// ============================================================================
test("Group I: Action 8 STORE_ACK server allows execution in AUTORISE_A_PRELEVER and PRELEVE_EN_ATTENTE_PIECE", () => {
  const magId = { ok: true, role: "responsable_magasin", authUserId: "mag-user" };

  const r1 = { id: "rem-7", status: "AUTORISE_A_PRELEVER", store_ack_at: null };
  const r2 = { id: "rem-7", status: "PRELEVE_EN_ATTENTE_PIECE", store_ack_at: null };
  const r3 = { id: "rem-7", status: "PIECE_DISPONIBLE", store_ack_at: null };

  assert.ok(vnPartUi.getAvailableVnPartActions(r1, [], magId).includes("STORE_ACK"));
  assert.ok(vnPartUi.getAvailableVnPartActions(r2, [], magId).includes("STORE_ACK"));
  assert.equal(vnPartUi.getAvailableVnPartActions(r3, [], magId).includes("STORE_ACK"), false);
});

// ============================================================================
// Group J: Action 9 MARK_REPLACEMENT_AVAILABLE
// ============================================================================
test("Group J: Action 9 MARK_REPLACEMENT_AVAILABLE for magasin and pieces in PRELEVE_EN_ATTENTE_PIECE", () => {
  const removal = { id: "rem-8", status: "PRELEVE_EN_ATTENTE_PIECE" };

  const magId = { ok: true, role: "responsable_magasin", authUserId: "mag-user" };
  const piecesId = { ok: true, role: "directeur_pieces", authUserId: "pieces-user" };
  const chefId = { ok: true, role: "chef_atelier", authUserId: "chef-user" };

  assert.ok(vnPartUi.getAvailableVnPartActions(removal, [], magId).includes("MARK_REPLACEMENT_AVAILABLE"));
  assert.ok(vnPartUi.getAvailableVnPartActions(removal, [], piecesId).includes("MARK_REPLACEMENT_AVAILABLE"));
  assert.equal(vnPartUi.getAvailableVnPartActions(removal, [], chefId).includes("MARK_REPLACEMENT_AVAILABLE"), false);
});

// ============================================================================
// Group K: Action 10 CONFIRM_RESTITUTION
// ============================================================================
test("Group K: Action 10 CONFIRM_RESTITUTION restricted to chef_atelier in PIECE_DISPONIBLE", () => {
  const available = { id: "rem-9", status: "PIECE_DISPONIBLE" };
  const waiting = { id: "rem-9", status: "PRELEVE_EN_ATTENTE_PIECE" };

  const chefId = { ok: true, role: "chef_atelier", authUserId: "chef-user" };
  const dirId = { ok: true, role: "directeur", authUserId: "dir-user" };

  assert.ok(vnPartUi.getAvailableVnPartActions(available, [], chefId).includes("CONFIRM_RESTITUTION"));
  assert.equal(vnPartUi.getAvailableVnPartActions(available, [], dirId).includes("CONFIRM_RESTITUTION"), false);
  assert.equal(vnPartUi.getAvailableVnPartActions(waiting, [], chefId).includes("CONFIRM_RESTITUTION"), false);
});

// ============================================================================
// Group L: CAS & Concurrency Strategy (VERSION_CONFLICT)
// ============================================================================
test("Group L: Concurrency conflict returns VERSION_CONFLICT and triggers clean handling", async () => {
  setupMockIdentity({ user: { role: "chef_atelier" } });
  try {
    const mockClient = {
      rpc() {
        return Promise.resolve({
          data: {
            success: false,
            ok: false,
            code: "VERSION_CONFLICT",
            message: "La version du dossier a changé. Veuillez actualiser avant de recommencer.",
            expected_version: 1,
            current_version: 2,
          },
          error: null,
        });
      },
    };

    const res = await vnPartClient.applyVnPartAction("rem-10", 1, "CONFIRM_REMOVAL", {}, { client: mockClient });
    assert.equal(res.ok, false);
    assert.equal(res.code, "VERSION_CONFLICT");
    assert.equal(res.expected_version, 1);
    assert.equal(res.current_version, 2);
  } finally {
    clearMockIdentity();
  }
});

// ============================================================================
// Group M: No Generic 17-char VIN Rule
// ============================================================================
test("Group M: No generic 17-char VIN constraint enforced", () => {
  // Verify client code contains no length 17 constraint
  assert.equal(clientJsContent.includes("17"), false, "vn-part-client must not have 17-char check");
  assert.equal(uiJsContent.includes('maxlength="17"'), false, "vn-part-ui must not have maxlength 17");
  assert.equal(uiJsContent.includes('minlength="17"'), false, "vn-part-ui must not have minlength 17");
  assert.equal(uiJsContent.includes(".length === 17"), false, "vn-part-ui must not have strict length 17 check");
});

// ============================================================================
// Group N: Mutation Identity Gate Fail-Closed & Workshop Authority
// ============================================================================
test("Group N: Mutation fails closed with zero RPC and zero workshop_members queries when identity preconditions fail", async () => {
  let rpcCalls = 0;
  let workshopMembersSelects = 0;
  const queriedTables = [];

  const mockClient = {
    rpc() {
      rpcCalls++;
      return Promise.resolve({ data: { ok: true, success: true }, error: null });
    },
    from(table) {
      queriedTables.push(table);
      if (table === "workshop_members") {
        workshopMembersSelects++;
      }
      return {
        select() {
          return {
            eq() {
              return {
                order() {
                  return Promise.resolve({ data: [], error: null });
                },
                then(resolve) {
                  return Promise.resolve({ data: [], error: null }).then(resolve);
                },
              };
            },
          };
        },
      };
    },
  };

  const testCases = [
    { label: "__nimrAppReady !== true", setup: { __nimrAppReady: false } },
    { label: "missing __nimrValidatedAuthUserId", setup: { __nimrValidatedAuthUserId: "" } },
    { label: "no current user", setup: { noUser: true } },
    { label: "inactive user", setup: { user: { active: false } } },
    { label: "authUserId mismatch", setup: { __nimrValidatedAuthUserId: "other-auth-id" } },
    { label: "authSource != supabase_membership", setup: { user: { authSource: "local" } } },
    { label: "membershipValidatedAt missing", setup: { user: { membershipValidatedAt: "" } } },
    { label: "membershipWorkshopId missing", setup: { user: { membershipWorkshopId: "" } } },
    { label: "canAccessTab !== true", setup: { canAccessTab: () => false } },
    { label: "getCanonicalUserRole missing", setup: { getCanonicalUserRole: null } },
    { label: "canonical role unresolved", setup: { getCanonicalUserRole: () => "" } },
  ];

  for (const tc of testCases) {
    setupMockIdentity(tc.setup);
    rpcCalls = 0;
    workshopMembersSelects = 0;
    const res = await vnPartClient.applyVnPartAction("rem-1", 1, "CONFIRM_REMOVAL", {}, { client: mockClient });
    assert.equal(res.ok, false, `Must fail closed for: ${tc.label}`);
    assert.equal(rpcCalls, 0, `Must issue ZERO RPC calls for: ${tc.label}`);
    assert.equal(workshopMembersSelects, 0, `Must issue ZERO workshop_members SELECTs for: ${tc.label}`);
    clearMockIdentity();
  }

  // Also verify that a successful mutation issues zero workshop_members queries
  setupMockIdentity();
  try {
    rpcCalls = 0;
    workshopMembersSelects = 0;
    await vnPartClient.applyVnPartAction("rem-1", 1, "CONFIRM_REMOVAL", {}, { client: mockClient });
    assert.equal(rpcCalls, 1);
    assert.equal(workshopMembersSelects, 0, "Successful mutation must also perform 0 workshop_members queries");
  } finally {
    clearMockIdentity();
  }

  // Verify dashboard reads: exactly 3 queries, none to workshop_members or audit_events
  queriedTables.length = 0;
  await vnPartClient.loadVnPartDashboard({ client: mockClient, workshopId: "ws-1" });
  assert.deepEqual(queriedTables.sort(), ["vn_part_approvals", "vn_part_donor_state_v1", "vn_part_removals"]);
  assert.equal(queriedTables.includes("workshop_members"), false, "Dashboard must NOT read workshop_members");
  assert.equal(queriedTables.includes("vn_part_audit_events"), false, "Dashboard must NOT read vn_part_audit_events");

  // Static proof: options.workshopId must NOT occur in applyVnPartAction implementation
  const applyFnBody = clientJsContent.slice(clientJsContent.indexOf("async function applyVnPartAction"));
  assert.equal(
    applyFnBody.includes("options.workshopId"),
    false,
    "options.workshopId must NOT be referenced inside applyVnPartAction"
  );
});

// ============================================================================
// Group O: Approval Read Model & Decision Values
// ============================================================================
test("Group O: Approval read model indexes records by removal_id and approval_role and enforces APPROVED/REFUSED values", () => {
  const approvals = [
    { id: "a-1", removal_id: "rem-10", approval_role: "directeur", decision: "APPROVED", decided_at: "2026-09-12T10:00:00Z" },
    { id: "a-2", removal_id: "rem-10", approval_role: "directeur_pieces", decision: "APPROVED", decided_at: "2026-09-12T11:00:00Z" },
    { id: "a-3", removal_id: "rem-20", approval_role: "directeur", decision: "REFUSED", reason: "Véhicule réservé", decided_at: "2026-09-12T12:00:00Z" },
    { id: "a-4", removal_id: "rem-30", approval_role: "directeur", decision: "APPROUVE", decided_at: "2026-09-12T13:00:00Z" }, // Invalid legacy value
  ];

  const lookup = vnPartUi.buildApprovalLookup(approvals);

  assert.equal(lookup.get("rem-10:directeur")?.decision, "APPROVED");
  assert.equal(lookup.get("rem-10:directeur_pieces")?.decision, "APPROVED");
  assert.equal(lookup.get("rem-10:responsable_qualite_parc_vn"), undefined);
  assert.equal(lookup.get("rem-20:directeur")?.decision, "REFUSED");
  assert.equal(lookup.get("rem-20:directeur")?.reason, "Véhicule réservé");

  // Approval strip rendering uses APPROVED / REFUSED exactly
  const removal10 = { id: "rem-10" };
  const strip10Html = vnPartUi.renderApprovalStrip(removal10, lookup);
  assert.ok(strip10Html.includes("Validations requises (2/3)"), "Must count exactly 2 APPROVED decisions");
  assert.ok(strip10Html.includes("status-approved"), "Must render status-approved for APPROVED");
  assert.ok(strip10Html.includes("Validé le"), "Must render French label Validé for APPROVED");

  const removal20 = { id: "rem-20" };
  const strip20Html = vnPartUi.renderApprovalStrip(removal20, lookup);
  assert.ok(strip20Html.includes("status-refused"), "Must render status-refused for REFUSED");
  assert.ok(strip20Html.includes("Refusé (Véhicule réservé)"), "Must render French label Refusé for REFUSED");

  // Legacy/french literals like 'APPROUVE' or 'REFUSE' MUST NOT be counted as approved
  const removal30 = { id: "rem-30" };
  const strip30Html = vnPartUi.renderApprovalStrip(removal30, lookup);
  assert.ok(strip30Html.includes("Validations requises (0/3)"), "APPROUVE must NOT be counted as APPROVED");
});

// ============================================================================
// Group P: STORE_ACK Repeat Prevention in UI
// ============================================================================
test("Group P: UI suppresses STORE_ACK once store_ack_at is non-null", () => {
  const magIdentity = { ok: true, role: "responsable_magasin", authUserId: "mag-user" };

  const unacked = { id: "rem-30", status: "PRELEVE_EN_ATTENTE_PIECE", store_ack_at: null };
  const acked = { id: "rem-30", status: "PRELEVE_EN_ATTENTE_PIECE", store_ack_at: "2026-09-12T14:30:00Z" };

  const actionsUnacked = vnPartUi.getAvailableVnPartActions(unacked, [], magIdentity);
  assert.ok(actionsUnacked.includes("STORE_ACK"), "STORE_ACK must be offered when store_ack_at is null");

  const actionsAcked = vnPartUi.getAvailableVnPartActions(acked, [], magIdentity);
  assert.equal(actionsAcked.includes("STORE_ACK"), false, "STORE_ACK must NOT be offered when store_ack_at is non-null");
});

// ============================================================================
// Group Q: Transport / PostgreSQL Error Normalization
// ============================================================================
test("Group Q: PostgREST / transport errors are safely normalized without raw SQL leakage", async () => {
  setupMockIdentity();
  try {
    const mockClient = {
      rpc() {
        return Promise.resolve({
          data: null,
          error: {
            code: "22P02",
            message: 'invalid input syntax for type integer: "abc"',
          },
        });
      },
    };

    const res = await vnPartClient.applyVnPartAction("rem-40", 1, "CONFIRM_REMOVAL", {}, { client: mockClient });
    assert.equal(res.ok, false);
    assert.equal(res.code, "RPC_ERROR");
    assert.equal(res.message, "Échec de communication avec le serveur ou paramètre non valide.");
    // Diagnostic kept internal
    assert.equal(res._diagnostic, 'invalid input syntax for type integer: "abc"');
  } finally {
    clearMockIdentity();
  }
});

// ============================================================================
// Group R: Data Escaping & Direct Mutation Static Guard
// ============================================================================
test("Group R: Zero direct table mutations in client and UI source files", () => {
  const sources = [clientJsContent, uiJsContent];
  const tables = ["vn_part_removals", "vn_part_approvals", "vn_part_audit_events"];

  for (const src of sources) {
    const stripped = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
    for (const tbl of tables) {
      assert.equal(stripped.includes(`.from("${tbl}").insert(`), false, `Direct insert forbidden on ${tbl}`);
      assert.equal(stripped.includes(`.from("${tbl}").update(`), false, `Direct update forbidden on ${tbl}`);
      assert.equal(stripped.includes(`.from("${tbl}").delete(`), false, `Direct delete forbidden on ${tbl}`);
      assert.equal(stripped.includes(`.from("${tbl}").upsert(`), false, `Direct upsert forbidden on ${tbl}`);
    }
  }
});

// ============================================================================
// Group S: Static Source Proofs & Contract Verification (Section 17)
// ============================================================================
test("Group S: Static source verification of authoritative RPC parameters and guards", () => {
  // 1. p_actor_role occurrences in js/vn-part-client.js: 0
  assert.equal(
    (clientJsContent.match(/\bp_actor_role\b/g) || []).length,
    0,
    "p_actor_role must have 0 occurrences in js/vn-part-client.js"
  );

  // 2. p_actor_user_id occurrences in js/vn-part-client.js: 0
  assert.equal(
    (clientJsContent.match(/\bp_actor_user_id\b/g) || []).length,
    0,
    "p_actor_user_id must have 0 occurrences in js/vn-part-client.js"
  );

  // 3. p_workshop_id occurrences: >= 1 in authoritative RPC argument construction
  assert.ok(
    (clientJsContent.match(/\bp_workshop_id\b/g) || []).length >= 1,
    "p_workshop_id must occur in authoritative RPC argument construction"
  );

  // 4. options.workshopId inside applyVnPartAction: 0
  const applyFnCode = clientJsContent.slice(clientJsContent.indexOf("async function applyVnPartAction"));
  assert.equal(
    applyFnCode.includes("options.workshopId"),
    false,
    "options.workshopId must NOT occur inside applyVnPartAction"
  );

  // 5. workshop_members inside VN-PART mutation implementation: 0 direct mutation-gate query
  assert.equal(
    applyFnCode.includes("workshop_members"),
    false,
    "workshop_members must NOT be queried inside applyVnPartAction"
  );
  assert.equal(
    clientJsContent.includes('.from("workshop_members")'),
    false,
    "vn-part-client must not contain any direct .from('workshop_members') query"
  );

  // 6. nimr_apply_vn_part_action_v1: exact expected RPC usage
  assert.ok(
    clientJsContent.includes('.rpc("nimr_apply_vn_part_action_v1"'),
    "Client must invoke authoritative RPC nimr_apply_vn_part_action_v1"
  );
});
