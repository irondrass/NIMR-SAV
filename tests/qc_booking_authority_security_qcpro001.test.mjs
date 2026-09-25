import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const hardeningMigrationUrl = new URL(
  "../supabase/migrations/20260923213000_qc_pro_booking_authority_hardening.sql",
  import.meta.url
);

const hardeningSource = fs.readFileSync(hardeningMigrationUrl, "utf8");

// ============================================================================
// SIMULATION HARNESS FOR SERVER PL/PGSQL FUNCTIONS
// ============================================================================

function createDbHarness() {
  const workshopId = "ws-0001";

  const members = [
    { userId: "usr-admin", role: "admin_technique", resourceId: null },
    { userId: "usr-dir", role: "directeur", resourceId: null },
    { userId: "usr-chief-a", role: "chef_atelier", resourceId: "res-chief-a" },
    { userId: "usr-chief-b", role: "chef_atelier", resourceId: "res-chief-b" },
    { userId: "usr-qc", role: "controle_qualite", resourceId: "res-qc" },
    { userId: "usr-tech", role: "technicien", resourceId: "res-tech" },
    { userId: "usr-rec", role: "reception", resourceId: null },
  ];

  const resources = [
    { id: "res-chief-a", localId: "ctrl-chief-a", type: "controle", active: true },
    { id: "res-chief-b", localId: "ctrl-chief-b", type: "controle", active: true },
    { id: "res-qc", localId: "ctrl-qc", type: "controle", active: true },
    { id: "res-tech", localId: "meca-tech", type: "mecanicien", active: true },
  ];

  let syncEntities = [
    {
      workshop_id: workshopId,
      entity_type: "case",
      entity_id: "case-001",
      deleted_at: null,
      entity_version: 1,
      payload: {
        id: "case-001",
        flags: { received: true, workCompleted: true, delivered: false },
        durations: { mechanical: 1 },
      },
    },
  ];

  function getMember(userId) {
    return members.find((m) => m.userId === userId);
  }

  function getResourceByLocalId(localId) {
    return resources.find((r) => r.localId === localId && r.active);
  }

  // Simulation of public.nimr_guard_quality_booking_authority()
  function triggerGuardQualityBookingAuthority(caller, tgOp, oldRow, newRow) {
    if (newRow.entity_type !== "booking") return newRow;

    const oldPayload = oldRow?.payload || {};
    const newPayload = newRow.payload || {};
    const oldKey = String(oldPayload.key || "").trim();
    const newKey = String(newPayload.key || "").trim();

    if (newKey !== "quality" && (tgOp !== "UPDATE" || oldKey !== "quality")) {
      return newRow;
    }

    if (newRow.deleted_at) {
      if (!["admin_technique", "directeur", "chef_atelier"].includes(caller.role)) {
        const err = new Error("quality booking deletion access denied");
        err.code = "42501";
        throw err;
      }
      return newRow;
    }

    if (tgOp === "UPDATE" && oldKey === "quality" && newKey !== "quality") {
      if (!["admin_technique", "directeur"].includes(caller.role)) {
        const err = new Error("cannot convert quality booking to non-quality task");
        err.code = "42501";
        throw err;
      }
      return newRow;
    }

    if (!["admin_technique", "directeur", "chef_atelier"].includes(caller.role)) {
      const err = new Error("quality booking assignment access denied");
      err.code = "42501";
      throw err;
    }

    const targetMode = String(newPayload.qualityAssignmentMode || "").trim();
    const targetResourceLocal = String(newPayload.primaryResourceId || "").trim();

    if (!["quality_controller", "chief_fallback"].includes(targetMode)) {
      const err = new Error(`invalid quality assignment mode: ${targetMode}`);
      err.code = "22023";
      throw err;
    }

    if (!targetResourceLocal) {
      const err = new Error("quality primary resource required");
      err.code = "22023";
      throw err;
    }

    const res = getResourceByLocalId(targetResourceLocal);
    const member = res ? members.find((m) => m.resourceId === res.id) : null;

    if (!res || res.type !== "controle" || !member) {
      const err = new Error("target quality resource is not an active control resource linked to a member");
      err.code = "23514";
      throw err;
    }

    if (targetMode === "quality_controller") {
      if (member.role !== "controle_qualite") {
        const err = new Error("quality_controller mode requires a member with role controle_qualite");
        err.code = "23514";
        throw err;
      }
    } else if (targetMode === "chief_fallback") {
      if (member.role !== "chef_atelier") {
        const err = new Error("chief_fallback mode requires a member with role chef_atelier");
        err.code = "23514";
        throw err;
      }

      if (caller.role === "chef_atelier") {
        if (caller.resourceId === res.id) {
          const err = new Error("chef atelier cannot self-assign quality fallback");
          err.code = "42501";
          throw err;
        }
        const err = new Error("chief fallback requires administrative authorization");
        err.code = "42501";
        throw err;
      }

      if (!["admin_technique", "directeur"].includes(caller.role)) {
        const err = new Error("chief fallback requires administrative authorization");
        err.code = "42501";
        throw err;
      }
    }

    newRow.payload = {
      ...newPayload,
      serverAuthority: {
        mode: targetMode,
        authorizedBy: caller.userId,
        authorizedRole: caller.role,
        authorizedAt: new Date().toISOString(),
        targetResourceId: targetResourceLocal,
        workshopId: newRow.workshop_id,
        caseId: newPayload.caseId,
      },
    };

    return newRow;
  }

  // Simulation of nimr_apply_sync_entity_v2
  function applySyncEntity(caller, entityType, entityId, payload, deleted = false) {
    if (!["admin_technique", "directeur", "chef_atelier", "reception", "technicien"].includes(caller.role)) {
      const err = new Error("workshop access denied");
      err.code = "42501";
      throw err;
    }

    const existingIndex = syncEntities.findIndex(
      (e) => e.entity_type === entityType && e.entity_id === entityId
    );
    const existing = existingIndex >= 0 ? syncEntities[existingIndex] : null;
    const tgOp = existing ? "UPDATE" : "INSERT";

    const candidate = {
      workshop_id: workshopId,
      entity_type: entityType,
      entity_id: entityId,
      payload: { ...payload },
      deleted_at: deleted ? new Date().toISOString() : null,
      entity_version: (existing?.entity_version || 0) + 1,
    };

    const finalRow = triggerGuardQualityBookingAuthority(caller, tgOp, existing, candidate);

    if (existingIndex >= 0) {
      syncEntities[existingIndex] = finalRow;
    } else {
      syncEntities.push(finalRow);
    }

    return finalRow;
  }

  // Simulation of nimr_apply_quality_review_v3
  function applyQualityReview(caller, caseId, status, checklist) {
    if (!["controle_qualite", "chef_atelier"].includes(caller.role)) {
      const err = new Error("quality review access denied");
      err.code = "42501";
      throw err;
    }

    const callerRes = resources.find((r) => r.id === caller.resourceId && r.active);
    if (!callerRes || callerRes.type !== "controle") {
      const err = new Error("quality execution resource required");
      err.code = "42501";
      throw err;
    }
    const currentResourceLocalId = callerRes.localId;

    const qualityBooking = syncEntities
      .filter(
        (e) =>
          e.entity_type === "booking" &&
          !e.deleted_at &&
          e.payload.caseId === caseId &&
          e.payload.key === "quality"
      )
      .sort((a, b) => b.entity_version - a.entity_version)[0];

    if (!qualityBooking) {
      const err = new Error("quality booking required");
      err.code = "23514";
      throw err;
    }

    if (String(qualityBooking.payload.primaryResourceId || "").trim() !== currentResourceLocalId) {
      const err = new Error("quality resource assignment mismatch");
      err.code = "42501";
      throw err;
    }

    if (caller.role === "controle_qualite" && qualityBooking.payload.qualityAssignmentMode !== "quality_controller") {
      const err = new Error("quality assignment denied");
      err.code = "42501";
      throw err;
    }

    if (caller.role === "chef_atelier" && qualityBooking.payload.qualityAssignmentMode !== "chief_fallback") {
      const err = new Error("quality fallback denied");
      err.code = "42501";
      throw err;
    }

    // DEFENSE IN DEPTH: Check serverAuthority
    const authority = qualityBooking.payload.serverAuthority;
    if (
      !authority ||
      !authority.mode ||
      authority.mode !== qualityBooking.payload.qualityAssignmentMode ||
      authority.targetResourceId !== currentResourceLocalId ||
      authority.caseId !== caseId ||
      !authority.authorizedBy
    ) {
      const err = new Error("quality booking lacks verified server authority");
      err.code = "42501";
      throw err;
    }

    if (caller.role === "chef_atelier") {
      if (authority.authorizedBy === caller.userId) {
        const err = new Error("chef atelier cannot self-assign quality fallback");
        err.code = "42501";
        throw err;
      }
      if (!["admin_technique", "directeur"].includes(authority.authorizedRole)) {
        const err = new Error("chief fallback requires administrative authorization");
        err.code = "42501";
        throw err;
      }
    }

    return { ok: true, status: "accepted" };
  }

  return {
    members,
    resources,
    getMember,
    applySyncEntity,
    applyQualityReview,
    getEntities: () => syncEntities,
  };
}

// ============================================================================
// STATIC CODE REVIEW TESTS
// ============================================================================

test("QC-PRO D3.22 — Migration file exists and has correct trigger and authority", () => {
  assert.match(
    hardeningSource,
    /create\s+or\s+replace\s+function\s+public\.nimr_guard_quality_booking_authority/iu,
    "la fonction trigger nimr_guard_quality_booking_authority doit exister"
  );

  assert.match(
    hardeningSource,
    /trigger\s+nimr_05_quality_booking_authority/iu,
    "le trigger nimr_05_quality_booking_authority doit être déclaré"
  );

  assert.match(
    hardeningSource,
    /before\s+insert\s+or\s+update\s+on\s+public\.sync_entities/iu,
    "le trigger doit s'exécuter BEFORE INSERT OR UPDATE sur sync_entities"
  );

  assert.match(
    hardeningSource,
    /serverAuthority/iu,
    "la provenance d'autorité serveur serverAuthority doit être estampillée"
  );

  assert.match(
    hardeningSource,
    /chef\s+atelier\s+cannot\s+self-assign\s+quality\s+fallback/iu,
    "l'auto-attribution du Chef doit être explicitement rejetée"
  );

  // Separation of powers & legacy bypass protection
  const legacySig = "uuid,text,text,text,jsonb,text,text,bigint";
  const newSig = "uuid,text,text,text,text,jsonb,text,bigint";

  assert.match(
    hardeningSource,
    new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.nimr_apply_quality_review_v3\\(\\s*${legacySig}\\s*\\)\\s*from\\s+public,\\s*anon,\\s*authenticated;`, "iu"),
    "l'ancienne surcharge public doit être révoquée pour tous les rôles"
  );

  assert.match(
    hardeningSource,
    new RegExp(`revoke\\s+all\\s+on\\s+function\\s+nimr_internal\\.nimr_apply_quality_review_v3\\(\\s*${legacySig}\\s*\\)\\s*from\\s+public,\\s*anon,\\s*authenticated;`, "iu"),
    "l'ancienne surcharge internal doit être révoquée pour tous les rôles"
  );

  assert.match(
    hardeningSource,
    new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.nimr_apply_quality_review_v3\\(\\s*${newSig}\\s*\\)\\s*to\\s+authenticated;`, "iu"),
    "seule la nouvelle surcharge QC-PRO doit être accordée à authenticated"
  );
});

// ============================================================================
// MANDATORY ATTACK SUITE (10 ATTACKS)
// ============================================================================

test("Attaque 1 — Chef Atelier essaie de créer quality + chief_fallback + ownResource => REFUS", () => {
  const db = createDbHarness();
  const chef = db.getMember("usr-chief-a");

  assert.throws(
    () => {
      db.applySyncEntity(chef, "booking", "booking-forged-1", {
        caseId: "case-001",
        key: "quality",
        primaryResourceId: "ctrl-chief-a",
        qualityAssignmentMode: "chief_fallback",
      });
    },
    (err) => err.message.includes("chef atelier cannot self-assign quality fallback") || err.code === "42501"
  );
});

test("Attaque 2 — Chef modifie un booking quality_controller existant vers chief_fallback => REFUS", () => {
  const db = createDbHarness();
  const admin = db.getMember("usr-admin");
  const chef = db.getMember("usr-chief-a");

  // Admin crée un booking légitime quality_controller
  db.applySyncEntity(admin, "booking", "booking-qc-1", {
    caseId: "case-001",
    key: "quality",
    primaryResourceId: "ctrl-qc",
    qualityAssignmentMode: "quality_controller",
  });

  // Chef essaie de modifier le mode vers chief_fallback
  assert.throws(
    () => {
      db.applySyncEntity(chef, "booking", "booking-qc-1", {
        caseId: "case-001",
        key: "quality",
        primaryResourceId: "ctrl-chief-a",
        qualityAssignmentMode: "chief_fallback",
      });
    },
    (err) => err.message.includes("chief fallback requires administrative authorization") || err.code === "42501"
  );
});

test("Attaque 3 — Chef modifie primaryResourceId vers sa propre ressource sur quality_controller => REFUS", () => {
  const db = createDbHarness();
  const admin = db.getMember("usr-admin");
  const chef = db.getMember("usr-chief-a");

  db.applySyncEntity(admin, "booking", "booking-qc-1", {
    caseId: "case-001",
    key: "quality",
    primaryResourceId: "ctrl-qc",
    qualityAssignmentMode: "quality_controller",
  });

  assert.throws(
    () => {
      db.applySyncEntity(chef, "booking", "booking-qc-1", {
        caseId: "case-001",
        key: "quality",
        primaryResourceId: "ctrl-chief-a", // Ressource de Chef liée à un Chef, pas un QC !
        qualityAssignmentMode: "quality_controller",
      });
    },
    (err) => err.message.includes("quality_controller mode requires a member with role controle_qualite") || err.code === "23514"
  );
});

test("Attaque 4 — Technicien forge un booking QC => REFUS d'écriture", () => {
  const db = createDbHarness();
  const tech = db.getMember("usr-tech");

  assert.throws(
    () => {
      db.applySyncEntity(tech, "booking", "booking-tech-qc", {
        caseId: "case-001",
        key: "quality",
        primaryResourceId: "ctrl-qc",
        qualityAssignmentMode: "quality_controller",
      });
    },
    (err) => err.message.includes("quality booking assignment access denied") || err.code === "42501"
  );
});

test("Attaque 5 — Réception forge/modifie une autorité QC => REFUS", () => {
  const db = createDbHarness();
  const rec = db.getMember("usr-rec");

  assert.throws(
    () => {
      db.applySyncEntity(rec, "booking", "booking-rec-qc", {
        caseId: "case-001",
        key: "quality",
        primaryResourceId: "ctrl-qc",
        qualityAssignmentMode: "quality_controller",
      });
    },
    (err) => err.message.includes("quality booking assignment access denied") || err.code === "42501"
  );
});

test("Attaque 6 — Contrôleur Qualité essaie de s'auto-affecter via synchronisation générique => REFUS", () => {
  const db = createDbHarness();
  const qc = db.getMember("usr-qc");

  assert.throws(
    () => {
      db.applySyncEntity(qc, "booking", "booking-qc-self", {
        caseId: "case-001",
        key: "quality",
        primaryResourceId: "ctrl-qc",
        qualityAssignmentMode: "quality_controller",
      });
    },
    (err) => err.code === "42501"
  );
});

test("Attaque 7 — Affectation QC légitime via le chemin autorisé => PASS", () => {
  const db = createDbHarness();
  const chef = db.getMember("usr-chief-a");
  const qc = db.getMember("usr-qc");

  // Chef d'atelier planifie une tâche pour le Contrôleur Qualité
  const booking = db.applySyncEntity(chef, "booking", "booking-legit-qc", {
    caseId: "case-001",
    key: "quality",
    primaryResourceId: "ctrl-qc",
    qualityAssignmentMode: "quality_controller",
  });

  assert.ok(booking.payload.serverAuthority, "Le booking doit recevoir l'autorité serveur");
  assert.equal(booking.payload.serverAuthority.mode, "quality_controller");

  // Le Contrôleur Qualité exécute la revue
  const review = db.applyQualityReview(qc, "case-001", "validated", {});
  assert.equal(review.ok, true, "L'exécution du Contrôleur Qualité doit réussir");
});

test("Attaque 8 — Fallback Chef légitime via l'autorité appropriée (directeur) => PASS", () => {
  const db = createDbHarness();
  const dir = db.getMember("usr-dir");
  const chef = db.getMember("usr-chief-a");

  // Directeur approuve et planifie le fallback Chef Atelier
  const booking = db.applySyncEntity(dir, "booking", "booking-fallback-qc", {
    caseId: "case-001",
    key: "quality",
    primaryResourceId: "ctrl-chief-a",
    qualityAssignmentMode: "chief_fallback",
  });

  assert.ok(booking.payload.serverAuthority);
  assert.equal(booking.payload.serverAuthority.mode, "chief_fallback");
  assert.equal(booking.payload.serverAuthority.authorizedRole, "directeur");

  // Le Chef Atelier exécute le fallback
  const review = db.applyQualityReview(chef, "case-001", "validated", {});
  assert.equal(review.ok, true, "L'exécution du Chef en fallback légitime doit réussir");
});

test("Attaque 9 — Fallback attribué à un autre Chef: Chef A ne peut pas exécuter l'affectation du Chef B => REFUS", () => {
  const db = createDbHarness();
  const dir = db.getMember("usr-dir");
  const chefA = db.getMember("usr-chief-a");

  // Directeur autorise Chef B
  db.applySyncEntity(dir, "booking", "booking-fallback-qc-b", {
    caseId: "case-001",
    key: "quality",
    primaryResourceId: "ctrl-chief-b",
    qualityAssignmentMode: "chief_fallback",
  });

  // Chef A tente d'exécuter
  assert.throws(
    () => {
      db.applyQualityReview(chefA, "case-001", "validated", {});
    },
    (err) => err.message.includes("quality resource assignment mismatch") || err.code === "42501"
  );
});

test("Attaque 10 — Tentative d'utiliser un vieux booking forgé ou non authentifié => REFUS (Defense in Depth)", () => {
  const db = createDbHarness();
  const chefA = db.getMember("usr-chief-a");

  // Injection directe dans la table d'un booking sans serverAuthority (ou forgé sans le trigger)
  db.getEntities().push({
    workshop_id: "ws-0001",
    entity_type: "booking",
    entity_id: "legacy-forged-booking",
    deleted_at: null,
    entity_version: 99,
    payload: {
      caseId: "case-001",
      key: "quality",
      primaryResourceId: "ctrl-chief-a",
      qualityAssignmentMode: "chief_fallback",
      // serverAuthority ABSENT ou NON CONFORME
    },
  });

  assert.throws(
    () => {
      db.applyQualityReview(chefA, "case-001", "validated", {});
    },
    (err) => err.message.includes("quality booking lacks verified server authority") || err.code === "42501"
  );
});

test("Attaque 11 — Tentative de contournement via l'ancienne surcharge RPC (p_decision) => REFUS", () => {
  const legacySig = "uuid,text,text,text,jsonb,text,text,bigint";

  // Verify that the hardening migration explicitly revokes legacy overloads
  const legacyPublicRevoked = new RegExp(
    `revoke\\s+all\\s+on\\s+function\\s+public\\.nimr_apply_quality_review_v3\\(\\s*${legacySig}\\s*\\)\\s*from\\s+public,\\s*anon,\\s*authenticated`,
    "i"
  ).test(hardeningSource);

  const legacyInternalRevoked = new RegExp(
    `revoke\\s+all\\s+on\\s+function\\s+nimr_internal\\.nimr_apply_quality_review_v3\\(\\s*${legacySig}\\s*\\)\\s*from\\s+public,\\s*anon,\\s*authenticated`,
    "i"
  ).test(hardeningSource);

  const legacyPublicGranted = new RegExp(
    `grant\\s+execute[\\s\\S]*?public\\.nimr_apply_quality_review_v3\\(\\s*${legacySig}\\s*\\)[\\s\\S]*?to\\s+authenticated`,
    "i"
  ).test(hardeningSource);

  assert.ok(
    legacyPublicRevoked,
    "L'ancienne surcharge publique doit être expressément révoquée de public, anon, authenticated"
  );
  assert.ok(
    legacyInternalRevoked,
    "L'ancienne surcharge interne doit être expressément révoquée de public, anon, authenticated"
  );
  assert.ok(
    !legacyPublicGranted,
    "L'ancienne surcharge publique ne doit jamais être accordée à authenticated"
  );

  // Simulation of client calling with legacy parameter names (p_decision, p_rework_key)
  const clientPayload = {
    p_workshop_id: "ws-0001",
    p_case_id: "case-001",
    p_decision: "validated",
    p_reason: "Bypass attempt",
    p_checklist: {},
    p_rework_key: null,
    p_operation_id: "op-bypass",
    p_base_version: 1,
  };

  const dispatch = (role, payload) => {
    if (Object.prototype.hasOwnProperty.call(payload, "p_decision") || Object.prototype.hasOwnProperty.call(payload, "p_rework_key")) {
      if (!legacyPublicGranted) {
        const err = new Error("permission denied for function nimr_apply_quality_review_v3");
        err.code = "42501";
        throw err;
      }
    }
    return { ok: true };
  };

  assert.throws(
    () => {
      dispatch("authenticated", clientPayload);
    },
    (err) => err.code === "42501" && err.message.includes("permission denied")
  );
});
