import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const clientSource = fs.readFileSync(
  new URL("../js/supabase-client.js", import.meta.url),
  "utf8"
);

const adminFunctionSource = fs.readFileSync(
  new URL(
    "../supabase/functions/workshop-user-admin/index.ts",
    import.meta.url
  ),
  "utf8"
);

const migrationSource = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260923064000_qc_pro_dynamic_checklist_server.sql",
    import.meta.url
  ),
  "utf8"
);

test("QC-PRO D3.1 — les rôles d'exécution QC résolvent une ressource serveur", () => {
  assert.match(
    clientSource,
    /RESOURCE_LINKED_WORKSHOP_ROLES/u,
    "le client doit déclarer explicitement les rôles liés à une ressource"
  );

  assert.match(
    clientSource,
    /["']technicien["']/u
  );

  assert.match(
    clientSource,
    /["']controle_qualite["']/u
  );

  assert.match(
    clientSource,
    /["']chef_atelier["']/u
  );

  assert.match(
    clientSource,
    /RESOURCE_LINKED_WORKSHOP_ROLES\.has\s*\(\s*rawRole\s*\)/u,
    "la résolution resource_id -> local_id ne doit plus être limitée au technicien"
  );
});

test("QC-PRO D3.2 — l'administration des comptes autorise le lien ressource QC / Chef", () => {
  assert.match(
    adminFunctionSource,
    /RESOURCE_LINKED_WORKSHOP_ROLES/u
  );

  assert.match(
    adminFunctionSource,
    /["']controle_qualite["']/u
  );

  assert.match(
    adminFunctionSource,
    /["']chef_atelier["']/u
  );

  assert.doesNotMatch(
    adminFunctionSource,
    /if\s*\(\s*role\s*!==\s*["']technicien["']\s*\)\s*return\s*\{\s*ok:\s*true,\s*resourceId:\s*null\s*\}/u,
    "QC et Chef ne doivent plus perdre automatiquement leur resource_id"
  );
});

test("QC-PRO D3.3 — la RPC récupère le rôle et la ressource de l'utilisateur authentifié", () => {
  assert.match(
    migrationSource,
    /public\.nimr_current_workshop_role\s*\(\s*p_workshop_id\s*\)/u
  );

  assert.match(
    migrationSource,
    /public\.nimr_current_resource_id\s*\(\s*p_workshop_id\s*\)/u
  );

  assert.match(
    migrationSource,
    /planning_resources/iu
  );

  assert.match(
    migrationSource,
    /local_id/iu,
    "le UUID membership doit être traduit vers le local_id utilisé par le booking"
  );
});

test("QC-PRO D3.4 — Directeur et Admin ne sont pas des exécutants QC ordinaires", () => {
  assert.doesNotMatch(
    migrationSource,
    /array\s*\[\s*['"]admin_technique['"]\s*,\s*['"]directeur['"]\s*,\s*['"]chef_atelier['"]\s*,\s*['"]controle_qualite['"]\s*\]/iu,
    "la RPC QC ne doit plus autoriser globalement admin/directeur à prendre la décision opérationnelle"
  );

  assert.match(
    migrationSource,
    /current_role\s+not\s+in\s*\(\s*'controle_qualite'\s*,\s*'chef_atelier'\s*\)/iu
  );
});

test("QC-PRO D3.5 — le serveur exige un booking QC réel pour ce dossier", () => {
  assert.match(
    migrationSource,
    /entity_type\s*=\s*'booking'/iu
  );

  assert.match(
    migrationSource,
    /payload\s*->>\s*'caseId'\s*=\s*p_case_id/u
  );

  assert.match(
    migrationSource,
    /payload\s*->>\s*'key'\s*=\s*'quality'/u
  );

  assert.match(
    migrationSource,
    /qualityAssignmentMode/u
  );

  assert.match(
    migrationSource,
    /primaryResourceId/u
  );
});

test("QC-PRO D3.6 — Contrôleur Qualité uniquement sur affectation quality_controller", () => {
  assert.match(
    migrationSource,
    /current_role\s*=\s*'controle_qualite'/iu
  );

  assert.match(
    migrationSource,
    /qualityAssignmentMode[^;]*quality_controller/isu
  );

  assert.match(
    migrationSource,
    /quality assignment denied/iu
  );
});

test("QC-PRO D3.7 — Chef Atelier uniquement sur fallback explicite", () => {
  assert.match(
    migrationSource,
    /current_role\s*=\s*'chef_atelier'/iu
  );

  assert.match(
    migrationSource,
    /qualityAssignmentMode[^;]*chief_fallback/isu
  );

  assert.match(
    migrationSource,
    /quality fallback denied/iu
  );
});

test("QC-PRO D3.8 — l'acteur doit correspondre à la ressource primaire planifiée", () => {
  assert.match(
    migrationSource,
    /primaryResourceId/iu
  );

  assert.match(
    migrationSource,
    /current_resource_local_id/iu
  );

  assert.match(
    migrationSource,
    /quality resource assignment mismatch/iu,
    "un autre contrôleur ne doit pas pouvoir valider le QC affecté à son collègue"
  );
});

test("QC-PRO D3.9 — aucune absence de ressource ne peut ouvrir l'accès", () => {
  assert.match(
    migrationSource,
    /quality execution resource required/iu
  );

  assert.match(
    migrationSource,
    /current_resource_id\s+is\s+null/iu
  );
});

test("QC-PRO D3.10 — l'autorité checklist D2 reste présente", () => {
  assert.match(
    migrationSource,
    /expected_keys/iu
  );

  assert.match(
    migrationSource,
    /unknown quality checklist key/iu
  );

  assert.match(
    migrationSource,
    /sync_entity_operation_receipts/iu
  );

  assert.match(
    migrationSource,
    /pg_advisory_xact_lock/iu
  );
});

console.log(
  "QC-PRO-001 D3 EXECUTION AUTHORITY CONTRACT COMPLETE"
);
