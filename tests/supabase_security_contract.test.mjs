import assert from "node:assert/strict";
import fs from "node:fs";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { context, run } = createNimrVmContext({ filename: "supabase-security-base.js" });
const clientSource = fs.readFileSync(new URL("../js/supabase-client.js", import.meta.url), "utf8");
const syncSource = fs.readFileSync(new URL("../js/supabase-sync.js", import.meta.url), "utf8");
const schema = fs.readFileSync(new URL("../supabase-schema.sql", import.meta.url), "utf8");
run(clientSource);
run(syncSource);

assert.equal(context.looksLikeSupabaseServiceRoleKey("sb_secret_example"), true, "les nouvelles clés secrètes Supabase doivent être refusées");
run(`window.NIMR_SUPABASE_CONFIG = {
  enabled: true,
  url: "https://example.supabase.co",
  anonKey: "sb_secret_example"
}`);
assert.equal(context.isSupabaseConfigured(), false, "une configuration secrète ne doit jamais activer le client navigateur");

const schemaErrorClient = {
  from() {
    return {
      async upsert() { return { error: { message: "column workshop_id does not exist" } }; },
    };
  },
};
await assert.rejects(
  context.upsertCloudBackupRow(schemaErrorClient, "cloud_backups", { backup_key: "main" }),
  /isolation atelier indisponible/u,
  "une base sans workshop_id doit échouer fermée",
);
assert.doesNotMatch(syncSource, /upsert\(legacyRow/u, "aucun fallback non cloisonné ne doit retirer workshop_id");
assert.doesNotMatch(syncSource, /upsert\(cleanRows,\s*\{\s*onConflict:\s*["']local_id/u, "les tables métier doivent rester cloisonnées par atelier");
assert.match(syncSource, /guardSensitiveAction\("supabase\.access"\)/u, "connexion, test et déconnexion doivent être gardés");

[
  "workshops",
  "workshop_members",
  "cloud_backups",
  "app_settings",
  "clients",
  "vehicles",
  "repair_orders",
  "repair_steps",
  "planning_resources",
  "planning_slots",
  "photos",
  "repair_claims",
  "repair_claim_labor_lines",
  "repair_supplements",
  "repair_supplement_lines",
  "audit_logs",
].forEach((table) => {
  assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`, "i"), `RLS requis pour ${table}`);
});
assert.match(schema, /public\.is_workshop_member\(workshop_id\)/u);
assert.match(schema, /resource_ids uuid\[\]/u, "les affectations multi-ressources doivent être persistées");
assert.match(schema, /actual_worked_minutes/u, "les temps réels doivent être persistés");

console.log("SUPABASE SECURITY CONTRACT OK");
