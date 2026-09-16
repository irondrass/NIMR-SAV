import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// Load vn-part-ui module
const vnPartUiModule = await import("../js/vn-part-ui.js");
const vnPartUi = vnPartUiModule.default || vnPartUiModule;

test("VN-PART-006 Director Individual Delete Comprehensive Test Suite", async (t) => {
  const samplePhysicalRemoval = {
    id: "rem-del-001",
    workshop_id: "11111111-1111-1111-1111-111111111111",
    donor_vin: "VF3XXXXXXXXXXXX01",
    donor_model: "Peugeot 208",
    beneficiary_vin: "VF3BBBBBBBBBBBB01",
    beneficiary_model: "Peugeot 208 GT",
    beneficiary_or: "OR-2026-DEL",
    part_reference: "REF-DEL-99",
    part_designation: "Optique LED Droit",
    status: "PRELEVE_EN_ATTENTE_PIECE",
    removed_at: "2026-09-01T10:00:00.000Z",
    version: 3,
  };

  const samplePlannedRemoval = {
    id: "rem-plan-002",
    workshop_id: "11111111-1111-1111-1111-111111111111",
    donor_vin: "VF3XXXXXXXXXXXX01",
    donor_model: "Peugeot 208",
    beneficiary_vin: "VF3BBBBBBBBBBBB02",
    beneficiary_model: "Peugeot 208 GT",
    beneficiary_or: "OR-2026-PLAN",
    part_reference: "REF-PLAN-10",
    part_designation: "Calculateur Moteur",
    status: "AUTORISE_A_PRELEVER",
    removed_at: null, // NOT physically removed
    version: 1,
  };

  await t.test("1. directeur positive: canonical role 'directeur' receives DELETE_REMOVAL", () => {
    const directorIdentity = {
      ok: true,
      role: "directeur",
      authUserId: "user-dir",
      workshopId: "11111111-1111-1111-1111-111111111111",
    };
    const actions = vnPartUi.getAvailableVnPartActions(samplePhysicalRemoval, [], directorIdentity);
    assert.ok(actions.includes("DELETE_REMOVAL"));
  });

  await t.test("2. chef_atelier negative: chef_atelier does NOT receive DELETE_REMOVAL", () => {
    const identity = {
      ok: true,
      role: "chef_atelier",
      authUserId: "user-chef",
      workshopId: "11111111-1111-1111-1111-111111111111",
    };
    const actions = vnPartUi.getAvailableVnPartActions(samplePhysicalRemoval, [], identity);
    assert.equal(actions.includes("DELETE_REMOVAL"), false);
  });

  await t.test("3. directeur_pieces negative: directeur_pieces does NOT receive DELETE_REMOVAL", () => {
    const identity = {
      ok: true,
      role: "directeur_pieces",
      authUserId: "user-dp",
      workshopId: "11111111-1111-1111-1111-111111111111",
    };
    const actions = vnPartUi.getAvailableVnPartActions(samplePhysicalRemoval, [], identity);
    assert.equal(actions.includes("DELETE_REMOVAL"), false);
  });

  await t.test("4. responsable_magasin negative: responsable_magasin does NOT receive DELETE_REMOVAL", () => {
    const identity = {
      ok: true,
      role: "responsable_magasin",
      authUserId: "user-mag",
      workshopId: "11111111-1111-1111-1111-111111111111",
    };
    const actions = vnPartUi.getAvailableVnPartActions(samplePhysicalRemoval, [], identity);
    assert.equal(actions.includes("DELETE_REMOVAL"), false);
  });

  await t.test("5. lecture_seule negative: lecture_seule does NOT receive DELETE_REMOVAL", () => {
    const identity = {
      ok: true,
      role: "lecture_seule",
      authUserId: "user-ro",
      workshopId: "11111111-1111-1111-1111-111111111111",
    };
    const actions = vnPartUi.getAvailableVnPartActions(samplePhysicalRemoval, [], identity);
    assert.equal(actions.includes("DELETE_REMOVAL"), false);
  });

  await t.test("6. button physical rows only: planned removals (removed_at == null) never expose DELETE_REMOVAL even for directeur", () => {
    const directorIdentity = {
      ok: true,
      role: "directeur",
      authUserId: "user-dir",
      workshopId: "11111111-1111-1111-1111-111111111111",
    };
    const actions = vnPartUi.getAvailableVnPartActions(samplePlannedRemoval, [], directorIdentity);
    assert.equal(actions.includes("DELETE_REMOVAL"), false);
  });

  await t.test("7. confirmation modal renders exact target details and danger warning", () => {
    const modalHtml = vnPartUi.renderDeleteModalContent(samplePhysicalRemoval);
    // Danger warning
    assert.match(modalHtml, /vn-part-modal-warning/);
    assert.match(modalHtml, /Cette opération supprimera définitivement le dossier de prélèvement physique/);
    // Exact target details
    assert.match(modalHtml, new RegExp(samplePhysicalRemoval.donor_vin));
    assert.match(modalHtml, new RegExp(samplePhysicalRemoval.beneficiary_vin));
    assert.match(modalHtml, new RegExp(samplePhysicalRemoval.beneficiary_or));
    assert.match(modalHtml, new RegExp(samplePhysicalRemoval.part_reference));
    assert.match(modalHtml, new RegExp(samplePhysicalRemoval.part_designation));
  });

  await t.test("8. exact typed SUPPRIMER and mandatory reason inputs exist in modal", () => {
    const modalHtml = vnPartUi.renderDeleteModalContent(samplePhysicalRemoval);
    assert.match(modalHtml, /id="vn-delete-confirmation-input"/);
    assert.match(modalHtml, /placeholder="SUPPRIMER"/);
    assert.match(modalHtml, /name="reason"/);
  });

  await t.test("9. production validation helper: validateDeleteRemovalPayload enforces exact SUPPRIMER and non-empty reason", () => {
    // Wrong token rejected
    const resWrongToken = vnPartUi.validateDeleteRemovalPayload({ token: "supprimer", reason: "Erreur" });
    assert.equal(resWrongToken.ok, false);
    assert.equal(resWrongToken.field, "token");

    const resEmptyToken = vnPartUi.validateDeleteRemovalPayload({ token: "", reason: "Erreur" });
    assert.equal(resEmptyToken.ok, false);
    assert.equal(resEmptyToken.field, "token");

    // Empty reason rejected
    const resEmptyReason = vnPartUi.validateDeleteRemovalPayload({ token: "SUPPRIMER", reason: "   " });
    assert.equal(resEmptyReason.ok, false);
    assert.equal(resEmptyReason.field, "reason");

    // Valid token and reason
    const resValid = vnPartUi.validateDeleteRemovalPayload({ token: " SUPPRIMER ", reason: " Saisie erronée " });
    assert.equal(resValid.ok, true);
    assert.equal(resValid.payload.reason, "Saisie erronée");
  });

  await t.test("10. production action submit: wrong confirmation token blocks RPC request", async () => {
    let rpcCalled = false;
    globalThis.applyVnPartAction = async () => {
      rpcCalled = true;
      return { ok: true };
    };

    const errorEl = { innerHTML: "", style: {}, textContent: "" };
    globalThis.document = {
      getElementById: (id) => (id === "vn-part-action-error" ? errorEl : null),
      querySelector: () => null,
    };

    vnPartUi.vnPartEphemeralState.removals = [{ ...samplePhysicalRemoval }];

    const mockForm = {
      dataset: {
        removalId: samplePhysicalRemoval.id,
        version: String(samplePhysicalRemoval.version),
        action: "DELETE_REMOVAL",
      },
      reason: { value: "Suppression justifiée" },
      querySelector: (sel) => (sel === "#vn-delete-confirmation-input" ? { value: "FAUX_TOKEN" } : null),
    };

    const res = await vnPartUi.handleActionSubmit(mockForm);
    assert.equal(res.ok, false, "Wrong token must fail validation");
    assert.equal(rpcCalled, false, "RPC must NOT be called when confirmation token is invalid");
  });

  await t.test("11. production action submit: exact SUPPRIMER passes target removalId, expectedVersion, and reason payload to applyVnPartAction", async () => {
    let capturedArgs = null;
    globalThis.applyVnPartAction = async (removalId, expectedVersion, action, payload) => {
      capturedArgs = { removalId, expectedVersion, action, payload };
      return { ok: true };
    };

    const errorEl = { innerHTML: "", style: {}, textContent: "" };
    globalThis.document = {
      getElementById: (id) => (id === "vn-part-action-error" ? errorEl : null),
      querySelector: () => null,
    };

    vnPartUi.vnPartEphemeralState.removals = [{ ...samplePhysicalRemoval }];

    const mockForm = {
      dataset: {
        removalId: samplePhysicalRemoval.id,
        version: String(samplePhysicalRemoval.version),
        action: "DELETE_REMOVAL",
      },
      reason: { value: "Suppression Directeur confirmée" },
      querySelector: (sel) => (sel === "#vn-delete-confirmation-input" ? { value: "SUPPRIMER" } : null),
    };

    const res = await vnPartUi.handleActionSubmit(mockForm);
    assert.equal(res.ok, true, "Valid submission must succeed");
    assert.ok(capturedArgs, "applyVnPartAction must have been called");
    assert.equal(capturedArgs.removalId, "rem-del-001", "Must pass target removal ID");
    assert.equal(capturedArgs.expectedVersion, 3, "Must pass expected version for CAS concurrency");
    assert.equal(capturedArgs.action, "DELETE_REMOVAL", "Action must be DELETE_REMOVAL");
    assert.deepEqual(capturedArgs.payload, { reason: "Suppression Directeur confirmée" }, "Must pass reason in payload");
  });

  await t.test("12. authoritative RPC only: action mutation targets nimr_apply_vn_part_action_v1", () => {
    const clientSrc = fs.readFileSync(path.join(rootDir, "js/vn-part-client.js"), "utf8");
    assert.match(clientSrc, /client\.rpc\(["']nimr_apply_vn_part_action_v1["']/);
  });

  await t.test("13. zero direct table mutations: client and UI never invoke direct table mutations", () => {
    const uiSource = fs.readFileSync(path.join(rootDir, "js/vn-part-ui.js"), "utf8");
    const clientSource = fs.readFileSync(path.join(rootDir, "js/vn-part-client.js"), "utf8");

    assert.doesNotMatch(uiSource, /\.from\(["']vn_part_removals["']\)\s*\.\s*(?:delete|update|insert|upsert)\(/u);
    assert.doesNotMatch(clientSource, /\.from\(["']vn_part_removals["']\)\s*\.\s*(?:delete|update|insert|upsert)\(/u);
  });

  const migrationsDir = path.join(rootDir, "supabase/migrations");
  const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.includes("vn_part_006"));
  const migrationContent = fs.readFileSync(path.join(migrationsDir, migrationFiles[0]), "utf8");

  await t.test("14. non-directeur rejected server-side: migration enforces caller role == 'directeur'", () => {
    assert.match(migrationContent, /v_caller_role\s*(?:<>|!=)\s*'directeur'/);
    assert.match(migrationContent, /FORBIDDEN_DIRECTOR_ROLE/);
  });

  await t.test("15. cross-workshop rejected: migration validates workshop_id match", () => {
    assert.match(migrationContent, /where\s+id\s*=\s*p_removal_id\s+and\s+workshop_id\s*=\s*p_workshop_id/i);
    assert.match(migrationContent, /REMOVAL_NOT_FOUND/);
  });

  await t.test("16. stale version rejected: migration verifies CAS version match", () => {
    assert.match(migrationContent, /v_row\.version\s*<>\s*p_expected_version/);
    assert.match(migrationContent, /VERSION_CONFLICT/);
  });

  await t.test("17. exact approvals removed: migration deletes dependent approvals for target removal", () => {
    assert.match(migrationContent, /delete\s+from\s+public\.vn_part_approvals\s+where\s+removal_id\s*=\s*v_row\.id/i);
  });

  await t.test("18. unrelated approvals preserved: deletion is strictly scoped to v_row.id", () => {
    assert.match(migrationContent, /where\s+removal_id\s*=\s*v_row\.id/i);
  });

  await t.test("19. exact removal deleted: migration deletes removal from vn_part_removals", () => {
    assert.match(migrationContent, /delete\s+from\s+public\.vn_part_removals\s+where\s+id\s*=\s*v_row\.id/i);
  });

  await t.test("20. unrelated removal preserved: deletion is strictly scoped by primary key", () => {
    assert.match(migrationContent, /where\s+id\s*=\s*v_row\.id/i);
  });

  await t.test("21. DELETE_REMOVAL audit inserted: audit event inserted with action 'DELETE_REMOVAL'", () => {
    assert.match(migrationContent, /insert\s+into\s+public\.vn_part_audit_events/i);
    assert.match(migrationContent, /'DELETE_REMOVAL'/);
  });

  await t.test("22. before_state retained: audit event captures full jsonb snapshot before deletion", () => {
    assert.match(migrationContent, /to_jsonb\(v_row\)/);
  });

  await t.test("23. audit survives source row deletion: restrictive foreign key dropped", () => {
    assert.match(migrationContent, /drop\s+constraint\s+(?:if\s+exists\s+)?vn_part_audit_events_removal_id_fkey/i);
  });

  await t.test("24. audit immutability remains enforced: immutability trigger preserved", () => {
    // Migration does NOT drop trg_vn_part_audit_immutable
    assert.doesNotMatch(migrationContent, /drop\s+trigger\s+.*trg_vn_part_audit_immutable/i);
  });

  await t.test("25. RPC failure => no local optimistic deletion: failure leaves local state intact", async () => {
    // Setup state with target removal
    vnPartUi.vnPartEphemeralState.removals = [{ ...samplePhysicalRemoval }];

    // Mock failing RPC
    globalThis.applyVnPartAction = async () => ({
      ok: false,
      code: "NETWORK_FAILURE",
      message: "Connexion perdue avec le serveur.",
    });

    const errorEl = { innerHTML: "", style: {}, textContent: "" };
    globalThis.document = {
      getElementById: (id) => (id === "vn-part-action-error" ? errorEl : null),
      querySelector: () => null,
    };

    const mockForm = {
      dataset: {
        removalId: samplePhysicalRemoval.id,
        version: String(samplePhysicalRemoval.version),
        action: "DELETE_REMOVAL",
      },
      reason: { value: "Suppression justifiée" },
      querySelector: (sel) => (sel === "#vn-delete-confirmation-input" ? { value: "SUPPRIMER" } : null),
    };

    const res = await vnPartUi.handleActionSubmit(mockForm);
    assert.equal(res.ok, false, "Failed RPC must return ok = false");
    assert.match(errorEl.textContent, /Connexion perdue/, "Error message must be shown to user");
    assert.equal(vnPartUi.vnPartEphemeralState.removals.length, 1, "Local state must NOT be optimistically deleted on failure");
    assert.equal(vnPartUi.vnPartEphemeralState.removals[0].id, "rem-del-001", "Target removal must remain in local state");
  });

  await t.test("26. success => dashboard reload: successful action execution invokes dashboard refresh", async () => {
    vnPartUi.vnPartEphemeralState.removals = [{ ...samplePhysicalRemoval }];

    globalThis.vnPartUi = vnPartUi;
    globalThis.applyVnPartAction = async () => ({
      ok: true,
      action: "DELETE_REMOVAL",
      deleted: true,
    });

    let dashboardRefreshed = false;
    const originalRefresh = vnPartUi.refreshVnPartDashboard;
    vnPartUi.refreshVnPartDashboard = async () => {
      dashboardRefreshed = true;
    };

    const errorEl = { innerHTML: "", style: {}, textContent: "" };
    const hostEl = { innerHTML: "modals" };
    globalThis.document = {
      getElementById: (id) => {
        if (id === "vn-part-action-error") return errorEl;
        if (id === "vn-part-modals-host") return hostEl;
        return null;
      },
      querySelector: () => null,
    };

    const mockForm = {
      dataset: {
        removalId: samplePhysicalRemoval.id,
        version: String(samplePhysicalRemoval.version),
        action: "DELETE_REMOVAL",
      },
      reason: { value: "Suppression Directeur confirmée" },
      querySelector: (sel) => (sel === "#vn-delete-confirmation-input" ? { value: "SUPPRIMER" } : null),
    };

    try {
      const res = await vnPartUi.handleActionSubmit(mockForm);
      assert.equal(res.ok, true, "Action submission must succeed");
      assert.equal(dashboardRefreshed, true, "Successful deletion must trigger refreshVnPartDashboard");
      assert.equal(hostEl.innerHTML, "", "Modals must be closed on successful action");
    } finally {
      vnPartUi.refreshVnPartDashboard = originalRefresh;
      delete globalThis.vnPartUi;
      delete globalThis.applyVnPartAction;
    }
  });
});
/* VN-PART-006 B4.1 SQL DELETE_REMOVAL reason contract */
test("B4.1 SQL DELETE_REMOVAL requires explicit non-empty reason before destructive side effects", async () => {
  const fsB41 = await import("node:fs");
  const assertB41 = (await import("node:assert/strict")).default;

  const migrationUrl = new URL(
    "../supabase/migrations/20260916100000_vn_part_006_director_delete.sql",
    import.meta.url
  );

  const sqlB41 = fsB41.readFileSync(migrationUrl, "utf8");

  const startB41 = sqlB41.indexOf("elsif v_action = 'DELETE_REMOVAL' then");
  assertB41.notEqual(
    startB41,
    -1,
    "DELETE_REMOVAL action branch must exist"
  );

  const rpcEndB41 = sqlB41.indexOf("$rpc$;", startB41);
  assertB41.notEqual(
    rpcEndB41,
    -1,
    "RPC end marker must exist after DELETE_REMOVAL"
  );

  const deleteBranchB41 = sqlB41.slice(startB41, rpcEndB41);

  assertB41.match(
    deleteBranchB41,
    /v_reason\s*:=\s*trim\s*\(\s*coalesce\s*\(\s*p_payload->>'reason'\s*,\s*''\s*\)\s*\)\s*;/,
    "DELETE_REMOVAL must derive reason with empty-string fallback"
  );

  assertB41.match(
    deleteBranchB41,
    /REASON_REQUIRED/,
    "DELETE_REMOVAL must explicitly reject a missing/empty reason"
  );

  assertB41.doesNotMatch(
    deleteBranchB41,
    /Suppression autorisée par le Directeur/,
    "DELETE_REMOVAL must not silently invent a default reason"
  );

  const reasonCheckB41 = deleteBranchB41.indexOf("REASON_REQUIRED");
  const auditInsertB41 = deleteBranchB41.indexOf(
    "insert into public.vn_part_audit_events"
  );
  const approvalDeleteB41 = deleteBranchB41.indexOf(
    "delete from public.vn_part_approvals"
  );
  const removalDeleteB41 = deleteBranchB41.indexOf(
    "delete from public.vn_part_removals"
  );

  assertB41.ok(reasonCheckB41 >= 0, "reason validation must exist");
  assertB41.ok(auditInsertB41 > reasonCheckB41, "reason validation must precede audit INSERT");
  assertB41.ok(approvalDeleteB41 > reasonCheckB41, "reason validation must precede approval DELETE");
  assertB41.ok(removalDeleteB41 > reasonCheckB41, "reason validation must precede removal DELETE");
});

/* VN-PART-006 B4.2 SQL DELETE_REMOVAL physical-only contract */
test("B4.2 SQL DELETE_REMOVAL requires authoritative physical-removal guard (removed_at IS NOT NULL)", async () => {
  const fsB42 = await import("node:fs");
  const assertB42 = (await import("node:assert/strict")).default;

  const migrationUrl = new URL(
    "../supabase/migrations/20260916100000_vn_part_006_director_delete.sql",
    import.meta.url
  );

  const sqlB42 = fsB42.readFileSync(migrationUrl, "utf8");

  const startB42 = sqlB42.indexOf("elsif v_action = 'DELETE_REMOVAL' then");
  assertB42.notEqual(startB42, -1, "DELETE_REMOVAL action branch must exist");

  const rpcEndB42 = sqlB42.indexOf("$rpc$;", startB42);
  assertB42.notEqual(rpcEndB42, -1, "RPC end marker must exist after DELETE_REMOVAL");

  const deleteBranchB42 = sqlB42.slice(startB42, rpcEndB42);

  // DELETE_REMOVAL branch contains v_row.removed_at IS NULL guard
  assertB42.match(
    deleteBranchB42,
    /if\s+v_row\.removed_at\s+is\s+null\s+then/i,
    "DELETE_REMOVAL must enforce v_row.removed_at is null guard"
  );

  // failure code is REMOVAL_NOT_PHYSICAL
  assertB42.match(
    deleteBranchB42,
    /'code',\s*'REMOVAL_NOT_PHYSICAL'/,
    "DELETE_REMOVAL must return error code REMOVAL_NOT_PHYSICAL when removed_at is null"
  );

  const physicalGuardIdx = deleteBranchB42.indexOf("REMOVAL_NOT_PHYSICAL");
  const auditInsertIdx = deleteBranchB42.indexOf(
    "insert into public.vn_part_audit_events"
  );
  const approvalDeleteIdx = deleteBranchB42.indexOf(
    "delete from public.vn_part_approvals"
  );
  const removalDeleteIdx = deleteBranchB42.indexOf(
    "delete from public.vn_part_removals"
  );

  assertB42.ok(physicalGuardIdx >= 0, "physical removal guard must exist");
  assertB42.ok(auditInsertIdx > physicalGuardIdx, "physical guard must precede audit INSERT");
  assertB42.ok(approvalDeleteIdx > physicalGuardIdx, "physical guard must precede approval DELETE");
  assertB42.ok(removalDeleteIdx > physicalGuardIdx, "physical guard must precede removal DELETE");
});

