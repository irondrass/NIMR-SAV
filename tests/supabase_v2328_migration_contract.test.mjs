import assert from "node:assert/strict";
import fs from "node:fs";

const migrationUrl = new URL("../supabase_nimr_sav_v23_2_8_full_audit.sql", import.meta.url);
assert.equal(fs.existsSync(migrationUrl), true, "la migration Supabase v23.2.8 doit exister");

const sql = fs.readFileSync(migrationUrl, "utf8");
const compact = sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ");

assert.match(sql, /^begin;/m, "la migration doit être transactionnelle");
assert.match(sql, /^commit;/m, "la migration doit se terminer par COMMIT");
assert.doesNotMatch(compact, /\bdelete\s+from\b/i, "la migration ne doit supprimer aucune ligne métier");
assert.doesNotMatch(compact, /\btruncate\b/i, "la migration ne doit vider aucune table");
assert.doesNotMatch(compact, /\bdrop\s+table\b/i, "la migration ne doit supprimer aucune table");
assert.doesNotMatch(compact, /disable\s+row\s+level\s+security/i, "RLS ne doit jamais être désactivé");
assert.doesNotMatch(compact, /service_role/i, "aucune service_role ne doit apparaître dans la migration navigateur");

const requiredTables = [
  "workshops",
  "workshop_members",
  "clients",
  "vehicles",
  "repair_orders",
  "repair_steps",
  "planning_resources",
  "planning_slots",
  "repair_claims",
  "repair_claim_labor_lines",
  "audit_logs",
  "app_settings",
  "cloud_backups",
  "sync_operations",
  "sync_conflicts",
  "planning_slot_allocations",
];

for (const table of requiredTables) {
  assert.match(
    sql,
    new RegExp(`create table if not exists public\\.${table}\\b`, "i"),
    `${table} doit être créé de manière idempotente`,
  );
  assert.match(
    sql,
    new RegExp(`alter table public\\.${table} enable row level security`, "i"),
    `RLS doit être activé sur ${table}`,
  );
}

for (const field of [
  "version bigint",
  "updated_at timestamptz",
  "created_by uuid",
  "updated_by uuid",
  "deleted_at timestamptz",
  "sync_source text",
]) {
  assert.match(sql, new RegExp(field.replace(/\s+/g, "\\s+"), "i"), `métadonnée requise : ${field}`);
}

for (const field of [
  "operation_id",
  "idempotency_key",
  "entity_type",
  "entity_id",
  "payload",
  "workshop_id",
  "user_id",
  "expected_version",
  "retry_count",
  "last_error",
  "status",
]) {
  assert.match(sql, new RegExp(`\\b${field}\\b`, "i"), `champ outbox serveur manquant : ${field}`);
}

assert.match(sql, /unique\s*\(workshop_id,\s*idempotency_key\)/i, "l'idempotence doit être garantie par la base");
assert.match(sql, /create or replace function public\.nimr_set_versioned_metadata/i, "le trigger de version serveur est requis");
assert.match(sql, /new\.version\s*:=\s*coalesce\(old\.version,\s*0\)\s*\+\s*1/i, "la version doit être incrémentée côté serveur");
assert.match(sql, /new\.updated_at\s*:=\s*clock_timestamp\(\)/i, "updated_at doit venir du serveur");
assert.match(sql, /workshop_id is immutable/i, "un UPDATE ne doit pas déplacer une ligne vers un autre atelier");

for (const role of [
  "admin_technique",
  "directeur",
  "chef_atelier",
  "reception",
  "technicien",
  "lecture_seule",
]) {
  assert.match(sql, new RegExp(`['\"]${role}['\"]`), `rôle canonique absent : ${role}`);
}
assert.match(sql, /create or replace function public\.nimr_current_workshop_role/i, "le rôle serveur par atelier est requis");
assert.match(sql, /create or replace function public\.nimr_has_workshop_role/i, "les policies doivent vérifier le rôle serveur");
assert.match(sql, /security definer\s+set search_path = pg_catalog, public/i, "les fonctions SECURITY DEFINER doivent fixer search_path");
assert.doesNotMatch(compact, /create policy [^;]+ for all to authenticated/i, "aucune policy CRUD globale ne doit subsister");
assert.doesNotMatch(sql, /create policy nimr_planning_slots_(insert|update|delete)/i, "les écritures planning directes doivent être interdites");

assert.match(sql, /create or replace function public\.nimr_reserve_planning_slots/i, "le RPC de réservation atomique est requis");
assert.match(
  sql,
  /create or replace function public\.nimr_reserve_planning_atomic\s*\(\s*p_workshop_id uuid,\s*p_case_id text,\s*p_expected_version bigint,\s*p_idempotency_key text,\s*p_bookings jsonb\s*\)/i,
  "la signature RPC appelée par supabase-js doit rester exacte",
);
assert.match(sql, /pg_advisory_xact_lock/i, "les réservations concurrentes doivent être sérialisées par transaction");
assert.match(sql, /exclude using gist/i, "une contrainte d'exclusion doit protéger les ressources exclusives");
assert.match(sql, /slot_range with &&/i, "l'exclusion doit porter sur le chevauchement temporel");
assert.match(sql, /resource_capacity_conflict/i, "la capacité ressource doit être contrôlée côté serveur");
assert.match(sql, /vehicle_double_booking/i, "le véhicule doit être protégé côté serveur");
assert.match(sql, /optimistic_version_conflict/i, "la réservation doit refuser une version obsolète");
assert.match(sql, /idempotentReplay/i, "un retry doit retourner le résultat de l'opération initiale");
assert.match(sql, /revoke all on function public\.nimr_reserve_planning_slots/i, "le RPC sensible doit révoquer PUBLIC/anon");
assert.match(sql, /grant execute on function public\.nimr_reserve_planning_slots[^;]+to authenticated/is, "le RPC doit être accordé explicitement à authenticated");
assert.match(sql, /grant execute on function public\.nimr_reserve_planning_atomic\(uuid, text, bigint, text, jsonb\)[^;]+to authenticated/is, "le wrapper frontend doit être accordé explicitement à authenticated");

for (const compatibilityColumn of [
  "repair_orders add column if not exists reception_planned_at",
  "repair_orders add column if not exists delivery_done_at",
  "repair_steps add column if not exists started_at",
  "repair_claims add column if not exists vehicle_area",
  "repair_claims add column if not exists expert_approved",
  "repair_supplements add column if not exists client_approved",
]) {
  assert.match(sql, new RegExp(compatibilityColumn.replace(/\s+/g, "\\s+"), "i"), `colonne utilisée par le client absente : ${compatibilityColumn}`);
}

assert.match(sql, /alter publication supabase_realtime add table/i, "les tables métier doivent être publiées dans Realtime");
assert.match(sql, /replica identity full/i, "les événements Realtime doivent contenir l'identité complète");
assert.match(sql, /workshop_id=eq\.<uuid>/i, "la migration doit documenter le filtre Realtime obligatoire par atelier");
assert.match(sql, /nimr_schema_migrations/i, "la version de schéma doit être interrogeable");
assert.match(sql, /23\.2\.8-full-audit/i, "la migration doit déclarer sa version exacte");

const dollarTags = [...sql.matchAll(/\$nimr\$/g)].length;
assert.equal(dollarTags % 2, 0, "les blocs SQL dollar-quoted doivent être équilibrés");

console.log("SUPABASE V23.2.8 MIGRATION CONTRACT OK");
