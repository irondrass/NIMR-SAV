import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "..");
const sqlPath = path.join(
  repositoryRoot,
  "supabase_v23_4_0_sync_v2_foundation.sql",
);

assert.equal(
  fs.existsSync(sqlPath),
  true,
  "La migration Sync V2 B1 doit exister.",
);

const sql = fs.readFileSync(sqlPath, "utf8");
const compact = sql.replace(/\s+/g, " ").trim();

const legacySyncPath = path.join(
  repositoryRoot,
  "js",
  "supabase-sync.js",
);
assert.equal(
  fs.existsSync(legacySyncPath),
  true,
  "Le moteur V23.3.0 doit être disponible pour vérifier le contrat des statuts.",
);
const legacySyncSource = fs.readFileSync(legacySyncPath, "utf8");
const buildRepairStatusMatch = legacySyncSource.match(
  /function\s+buildRepairStatus\s*\(item\)\s*\{([\s\S]*?)\n\}/u,
);
assert.ok(
  buildRepairStatusMatch,
  "La fonction buildRepairStatus() du moteur existant est introuvable.",
);
const legacyPersistedStatuses = [
  ...buildRepairStatusMatch[1].matchAll(/return\s+"([^"]+)"/gu),
].map((match) => match[1]);

function expect(pattern, message) {
  assert.match(sql, pattern, message);
}

expect(/^-- NIMR SAV Sync V2 - Phase B1/mu, "En-tête B1 manquant.");
expect(/\bbegin\s*;/iu, "La migration doit être transactionnelle.");
expect(/\bcommit\s*;/iu, "La migration doit se terminer par commit.");

for (const column of [
  "header_version",
  "estimate_version",
  "status_version",
  "execution_version",
  "header_updated_at",
  "header_updated_by",
  "status_updated_at",
  "status_updated_by",
]) {
  expect(
    new RegExp(
      `alter\\s+table\\s+public\\.repair_orders[\\s\\S]*?add\\s+column\\s+if\\s+not\\s+exists\\s+${column}\\b`,
      "iu",
    ),
    `Colonne repair_orders manquante : ${column}`,
  );
}

for (const column of [
  "header_updated_at",
  "estimate_updated_at",
  "status_updated_at",
  "execution_updated_at",
]) {
  expect(
    new RegExp(
      `add\\s+column\\s+if\\s+not\\s+exists\\s+${column}\\s+timestamptz\\s+not\\s+null\\s+default\\s+clock_timestamp\\(\\)`,
      "iu",
    ),
    `Initialisation DDL sûre manquante : ${column}`,
  );
}

const rpcStart = compact.indexOf(
  "create or replace function public.nimr_apply_repair_order_patch_v2",
);
assert.ok(rpcStart > 0, "Début du RPC Sync V2 introuvable.");
const migrationPrelude = compact.slice(0, rpcStart);
assert.doesNotMatch(
  migrationPrelude,
  /update\s+public\.repair_orders/iu,
  "La fondation ne doit pas déclencher un UPDATE de masse des dossiers existants.",
);

for (const column of [
  "schema_version",
  "device_id",
  "domain",
  "entity_key",
  "server_version",
  "conflict_code",
  "server_acknowledged_at",
]) {
  expect(
    new RegExp(
      `alter\\s+table\\s+public\\.sync_operations[\\s\\S]*?add\\s+column\\s+if\\s+not\\s+exists\\s+${column}\\b`,
      "iu",
    ),
    `Colonne sync_operations manquante : ${column}`,
  );
}

for (const column of [
  "idempotency_key",
  "device_id",
  "domain",
  "entity_key",
  "server_updated_at",
  "server_updated_by",
  "client_created_at",
]) {
  expect(
    new RegExp(
      `alter\\s+table\\s+public\\.sync_conflicts[\\s\\S]*?add\\s+column\\s+if\\s+not\\s+exists\\s+${column}\\b`,
      "iu",
    ),
    `Colonne sync_conflicts manquante : ${column}`,
  );
}

expect(
  /create\s+or\s+replace\s+function\s+public\.nimr_apply_repair_order_patch_v2\s*\(\s*p_workshop_id\s+uuid\s*,\s*p_operation\s+jsonb\s*\)/iu,
  "RPC Sync V2 repair_order absent.",
);
expect(/\blanguage\s+plpgsql\b/iu, "Le RPC doit être PL/pgSQL.");
expect(/\bsecurity\s+definer\b/iu, "Le RPC doit être security definer.");
expect(
  /set\s+search_path\s*=\s*pg_catalog\s*,\s*public/iu,
  "Le search_path du RPC doit être fixé.",
);
expect(
  /auth\.uid\(\)\s+is\s+null/iu,
  "Le RPC doit refuser une session anonyme.",
);
expect(
  /public\.nimr_has_workshop_role\s*\([\s\S]*?'admin_technique'[\s\S]*?'directeur'[\s\S]*?'chef_atelier'[\s\S]*?'reception'/iu,
  "Le contrôle de rôle atelier est incomplet.",
);
expect(
  /entity_type_value\s*:=\s*trim\s*\([\s\S]*?p_operation\s*->>\s*'entityType'/iu,
  "entityType doit être lu depuis l'enveloppe.",
);
expect(
  /entity_type_value\s*<>\s*'repair_order'/iu,
  "Le RPC doit refuser tout entityType autre que repair_order.",
);
expect(
  /operation_workshop_id_value\s*:=\s*public\.nimr_try_uuid\s*\([\s\S]*?p_operation\s*->>\s*'workshopId'/iu,
  "workshopId doit être lu depuis l'enveloppe.",
);
expect(
  /operation_workshop_id_value\s+is\s+null[\s\S]*?operation_workshop_id_value\s*<>\s*p_workshop_id/iu,
  "Le RPC doit refuser un workshopId absent ou différent du paramètre serveur.",
);
expect(
  /'workshopId'\s*,\s*operation_workshop_id_value/iu,
  "Le hash idempotent doit inclure workshopId.",
);
expect(
  /domain_value\s+not\s+in\s*\(\s*'header'\s*,\s*'status'\s*\)/iu,
  "B1 doit limiter le RPC aux domaines header/status.",
);
expect(
  /action_value\s*<>\s*'patch'/iu,
  "B1 doit limiter le RPC à action=patch.",
);
expect(
  /candidate\.id\s*=\s*public\.nimr_try_uuid\(entity_key_value\)[\s\S]*?candidate\.local_id\s*=\s*entity_key_value/iu,
  "entityId doit résoudre uniquement l'UUID serveur ou le local_id stable.",
);
assert.doesNotMatch(
  sql,
  /candidate\.order_number\s*=\s*entity_key_value/iu,
  "Le numéro OR ne doit pas servir d'identifiant technique ambigu.",
);
assert.doesNotMatch(
  sql,
  /changes_value\s*\?\s*'notes'|'notes'\s*,\s*repair_order_row\.notes/iu,
  "Les notes partagées doivent rester hors du RPC header et devenir append-only.",
);
assert.doesNotMatch(
  sql,
  /changes_value\s*\?\s*'order_number'|'order_number'\s*,\s*repair_order_row\.order_number/iu,
  "order_number doit rester en lecture seule tant que le moteur legacy dérive local_id du numéro OR.",
);
expect(
  /where\s+field_name\s+not\s+in\s*\(\s*'estimate_number'\s*,\s*'next_action'\s*\)/iu,
  "Le domaine header B1 doit autoriser uniquement estimate_number et next_action.",
);
expect(
  /expected_version_value\s+is\s+null[\s\S]*?expectedVersion/iu,
  "expectedVersion doit être obligatoire.",
);
expect(
  /operation_schema_version\s+is\s+null[\s\S]*?operation_schema_version\s*<>\s*1/iu,
  "Une schemaVersion invalide ne doit pas être convertie silencieusement en version 1.",
);
expect(
  /payload_value\s*\?\s*'state'[\s\S]*?payload\.state est interdit/iu,
  "Le RPC doit refuser explicitement payload.state.",
);

const statusValidationMatch = sql.match(
  /if\s+domain_value\s*=\s*'status'\s+then[\s\S]*?if\s+requested_status\s+not\s+in\s*\(([\s\S]*?)\)\s+then/iu,
);
assert.ok(
  statusValidationMatch,
  "La liste serveur des statuts autorisés est introuvable.",
);
const sqlAllowedStatuses = [
  ...statusValidationMatch[1].matchAll(/'([^']+)'/gu),
].map((match) => match[1]);
const expectedStatusContract = [
  ...new Set([
    ...legacyPersistedStatuses,
    "chief_validation_pending",
  ]),
].sort();
assert.deepEqual(
  [...new Set(sqlAllowedStatuses)].sort(),
  expectedStatusContract,
  "Le RPC status doit utiliser exactement les statuts persistés par V23.3.0, plus le défaut historique du schéma.",
);

expect(
  /pg_advisory_xact_lock[\s\S]*?idempotency_key_value/iu,
  "Les retries concurrents doivent être sérialisés.",
);

const replayIndex = compact.indexOf(
  "select * into existing_operation from public.sync_operations",
);
const versionIndex = compact.indexOf(
  "if current_version_value is distinct from expected_version_value",
);
assert.ok(replayIndex >= 0, "Lecture idempotente existante absente.");
assert.ok(versionIndex >= 0, "Contrôle de version absent.");
assert.ok(
  replayIndex < versionIndex,
  "Le rejeu idempotent doit précéder le contrôle optimiste.",
);

expect(
  /idempotency_payload_mismatch/iu,
  "Le mismatch de payload idempotent doit être explicite.",
);
expect(
  /optimistic_version_conflict/iu,
  "Le conflit de version doit être explicite.",
);
expect(
  /insert\s+into\s+public\.sync_conflicts/iu,
  "Les vrais conflits doivent être persistés.",
);
expect(
  /server_updated_at[\s\S]*?server_updated_by/iu,
  "Le conflit doit fournir date et auteur serveur.",
);
expect(
  /header_version\s*=\s*header_version\s*\+\s*1/iu,
  "Le serveur doit incrémenter header_version.",
);
expect(
  /status_version\s*=\s*status_version\s*\+\s*1/iu,
  "Le serveur doit incrémenter status_version.",
);
expect(
  /insert\s+into\s+public\.audit_logs[\s\S]*?sync_v2\.repair_order\./iu,
  "Chaque patch appliqué doit produire un audit append-only.",
);
expect(
  /on\s+conflict\s*\(\s*workshop_id\s*,\s*local_id\s*\)\s+do\s+nothing/iu,
  "L'audit doit être idempotent sans UPDATE.",
);
expect(
  /revoke\s+all\s+on\s+function\s+public\.nimr_apply_repair_order_patch_v2\(uuid,\s*jsonb\)[\s\S]*?from\s+public\s*,\s*anon\s*,\s*authenticated/iu,
  "Les privilèges par défaut du RPC doivent être retirés.",
);
expect(
  /grant\s+execute\s+on\s+function\s+public\.nimr_apply_repair_order_patch_v2\(uuid,\s*jsonb\)[\s\S]*?to\s+authenticated/iu,
  "Seul authenticated doit recevoir EXECUTE.",
);
expect(
  /23\.4\.0-sync-v2-b1/iu,
  "La migration doit être journalisée.",
);

assert.doesNotMatch(
  sql,
  /\bdrop\s+table\b|\btruncate\b/iu,
  "La migration B1 doit rester additive.",
);
assert.doesNotMatch(
  sql,
  /\bdelete\s+from\s+public\.(?:repair_orders|sync_operations|sync_conflicts|audit_logs)\b/iu,
  "La migration ne doit supprimer aucune donnée métier.",
);
assert.doesNotMatch(
  sql,
  /\bupdate\s+public\.audit_logs\b/iu,
  "audit_logs doit rester append-only.",
);
assert.doesNotMatch(
  sql,
  /entity_type\s*=\s*'workshop_state'|action\s*=\s*'upsert_snapshot'/iu,
  "Le RPC Sync V2 ne doit pas réintroduire le snapshot global.",
);
assert.doesNotMatch(
  sql,
  /alter\s+table\s+public\.cloud_backups|update\s+public\.cloud_backups|delete\s+from\s+public\.cloud_backups/iu,
  "La fondation B1 ne doit pas modifier cloud_backups.",
);

console.log("SYNC V2 SQL FOUNDATION V23.4.0 B1 OK");
