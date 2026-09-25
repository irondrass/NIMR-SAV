import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const legacyMigrationUrl = new URL(
  "../supabase/migrations/20260922210000_lot20b_qc_v3_server.sql",
  import.meta.url
);

const professionalMigrationUrl = new URL(
  "../supabase/migrations/20260923064000_qc_pro_dynamic_checklist_server.sql",
  import.meta.url
);

const legacySource = fs.readFileSync(legacyMigrationUrl, "utf8");

const professionalExists = fs.existsSync(professionalMigrationUrl);

const professionalSource = professionalExists
  ? fs.readFileSync(professionalMigrationUrl, "utf8")
  : "";

test("QC-PRO D2.1 — le défaut LOT20B historique est caractérisé", () => {
  assert.match(
    legacySource,
    /'Alignement carrosserie'/u,
    "la baseline LOT20B doit bien exposer l'ancienne checklist carrosserie"
  );

  assert.match(
    legacySource,
    /'Essai final et validation client'/u,
    "la baseline LOT20B doit bien être caractérisée avant cutover QC-PRO"
  );
});

test("QC-PRO D2.2 — une migration serveur QC-PRO dédiée existe", () => {
  assert.equal(
    professionalExists,
    true,
    "la migration QC-PRO d'autorité serveur doit être créée"
  );
});

test("QC-PRO D2.3 — l'API publique v3 est conservée par CREATE OR REPLACE", () => {
  assert.match(
    professionalSource,
    /create\s+or\s+replace\s+function\s+nimr_internal\.nimr_apply_quality_review_v3/iu
  );

  assert.match(
    professionalSource,
    /create\s+or\s+replace\s+function\s+public\.nimr_apply_quality_review_v3/iu
  );

  assert.doesNotMatch(
    professionalSource,
    /nimr_apply_quality_review_v4/iu,
    "QC-PRO ne doit pas imposer une rupture d'API au client existant"
  );
});

test("QC-PRO D2.4 — le serveur dérive la fiche depuis le dossier canonique", () => {
  assert.match(
    professionalSource,
    /current_payload\s*->\s*'durations'/u,
    "les opérations réellement présentes doivent piloter la fiche serveur"
  );

  assert.match(
    professionalSource,
    /current_payload\s*->\s*'qualityControl'/u,
    "les exigences road-test / HV / sécurité doivent provenir du dossier canonique"
  );

  assert.match(
    professionalSource,
    /expected_keys/iu,
    "le serveur doit construire la liste des points QC applicables"
  );
});

test("QC-PRO D2.5 — le socle professionnel permanent est autoritaire", () => {
  const permanentIds = [
    "documentary.work_order_complete",
    "documentary.authorizations_present",
    "documentary.operations_recorded",
    "documentary.technician_notes_complete",

    "general.no_warning_lights",
    "general.no_leak",
    "general.reassembly_secure",
    "general.repaired_functions_verified",
    "general.no_tools_left",

    "delivery.clean_vehicle",
    "delivery.no_new_damage",
    "delivery.protections_removed",
    "delivery.client_items_present",
    "delivery.documents_ready",
  ];

  for (const id of permanentIds) {
    assert.match(
      professionalSource,
      new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"),
      `point QC serveur absent : ${id}`
    );
  }
});

test("QC-PRO D2.6 — les sections dynamiques sont représentées côté serveur", () => {
  const dynamicIds = [
    "service.oil_level",
    "service.no_leak",
    "service.maintenance_reset",

    "mechanical.repair_function",
    "mechanical.fasteners",
    "mechanical.no_leak",

    "electrical.final_scan",
    "electrical.no_relevant_dtc",
    "electrical.repaired_function",

    "body.panel_alignment",
    "body.paint_finish",
    "body.reassembly",
    "body.final_photo",

    "hv.no_relevant_fault",
    "hv.protection_connectors",
    "hv.function_verified",

    "road.complaint_resolved",
    "road.no_abnormal_noise_vibration",
    "road.mileage_recorded",
  ];

  for (const id of dynamicIds) {
    assert.match(
      professionalSource,
      new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"),
      `point QC dynamique serveur absent : ${id}`
    );
  }
});

test("QC-PRO D2.7 — seules les valeurs OK / N-A / NOK sont normalisées", () => {
  assert.match(
    professionalSource,
    /when\s+'ok'\s+then\s+'ok'/iu
  );

  assert.match(
    professionalSource,
    /when\s+'na'\s+then\s+'na'/iu
  );

  assert.match(
    professionalSource,
    /when\s+'nok'\s+then\s+'nok'/iu
  );

  assert.match(
    professionalSource,
    /invalid quality checklist value/iu,
    "une valeur hors contrat doit être rejetée côté serveur"
  );
});

test("QC-PRO D2.8 — une clé QC inconnue est refusée", () => {
  assert.match(
    professionalSource,
    /unknown quality checklist key/iu,
    "le serveur doit refuser les clés injectées ou non prévues"
  );

  assert.match(
    professionalSource,
    /jsonb_object_keys\s*\(\s*coalesce\s*\(\s*p_checklist/iu,
    "la whitelist doit contrôler les clés réellement envoyées par le client"
  );
});

test("QC-PRO D2.9 — validation Conforme exige tous les points applicables", () => {
  assert.match(
    professionalSource,
    /unnest\s*\(\s*expected_keys\s*\)/iu
  );

  assert.match(
    professionalSource,
    /not\s+in\s*\(\s*'ok'\s*,\s*'na'\s*\)/iu
  );

  assert.match(
    professionalSource,
    /Chaque point du contrôle qualité professionnel doit être marqué OK ou N\/A/iu
  );
});

test("QC-PRO D2.10 — Non conforme exige au moins un NOK et conserve la retouche", () => {
  assert.match(
    professionalSource,
    /jsonb_each_text\s*\(\s*checklist\s*\)/iu
  );

  assert.match(
    professionalSource,
    /c\.value\s*=\s*'nok'/iu
  );

  assert.match(
    professionalSource,
    /qualityReworkBookingId/u
  );

  assert.match(
    professionalSource,
    /qualityReworkCycle/u
  );

  assert.match(
    professionalSource,
    /rework_canonical/u
  );
});

test("QC-PRO D2.11 — concurrence optimiste et idempotence LOT20B restent présentes", () => {
  assert.match(
    professionalSource,
    /p_base_version/iu
  );

  assert.match(
    professionalSource,
    /entity_version\s+is\s+distinct\s+from\s+p_base_version/iu
  );

  assert.match(
    professionalSource,
    /sync_entity_operation_receipts/iu
  );

  assert.match(
    professionalSource,
    /quality-review-v3:/u
  );

  assert.match(
    professionalSource,
    /pg_advisory_xact_lock/iu
  );
});

test("QC-PRO D2.12 — le nouveau serveur n'utilise plus les 5 libellés historiques comme autorité", () => {
  const obsoleteAuthorityKeys = [
    "Alignement carrosserie",
    "Teinte et vernis",
    "Remontage accessoires",
    "Nettoyage intérieur/extérieur",
    "Essai final et validation client",
  ];

  for (const key of obsoleteAuthorityKeys) {
    assert.doesNotMatch(
      professionalSource,
      new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"),
      `ancienne clé QC encore autoritaire : ${key}`
    );
  }
});

console.log(
  "QC-PRO-001 D2 SERVER AUTHORITY CONTRACT COMPLETE"
);
