import assert from "node:assert/strict";
import fs from "node:fs";

const fullAudit = fs.readFileSync(
  new URL(
    "../supabase_nimr_sav_v23_2_8_full_audit.sql",
    import.meta.url,
  ),
  "utf8",
);

const migration = fs.readFileSync(
  new URL(
    "../supabase_v23_3_0_planning_dependencies.sql",
    import.meta.url,
  ),
  "utf8",
);

for (const [label, source] of [
  ["full audit", fullAudit],
  ["migration", migration],
]) {
  assert.match(
    source,
    /dependencies_value\s+text\[\]/,
    `${label}: dependencies_value absent`,
  );
  assert.match(
    source,
    /jsonb_typeof\(slot_payload\s*->\s*'dependencies'\)\s*=\s*'array'/,
    `${label}: lecture JSON dependencies absente`,
  );
  assert.match(
    source,
    /dependencies\s*=\s*dependencies_value,/,
    `${label}: UPDATE dependencies absent`,
  );
  assert.match(
    source,
    /title,\s*dependencies,\s*start_at/,
    `${label}: colonne dependencies absente de INSERT`,
  );
  assert.match(
    source,
    /slot_payload\s*->>\s*'title',\s*dependencies_value,/,
    `${label}: valeur dependencies absente de INSERT`,
  );
  assert.match(
    source,
    /planning_dependency_order_conflict/,
    `${label}: contrôle ordre dépendance absent`,
  );
  assert.match(
    source,
    /planning_dependency_not_found/,
    `${label}: contrôle dépendance introuvable absent`,
  );
  assert.match(
    source,
    /'dependencies',\s*to_jsonb\(dependencies_value\)/,
    `${label}: dépendances absentes de la réponse RPC`,
  );

  const declarations = source.match(
    /create\s+or\s+replace\s+function\s+public\s*\.\s*nimr_reserve_planning_slots\s*\(/gi,
  ) || [];
  assert.equal(
    declarations.length,
    1,
    `${label}: la fonction doit être définie une seule fois`,
  );
}

assert.match(
  migration,
  /revoke\s+all\s+on\s+function\s+public\.nimr_reserve_planning_slots[\s\S]*from\s+public,\s*anon,\s*authenticated;/i,
);
assert.match(
  migration,
  /grant\s+execute\s+on\s+function\s+public\.nimr_reserve_planning_slots[\s\S]*to\s+authenticated;/i,
);

assert.doesNotMatch(
  migration,
  /case-or:|or-srv-|00000000-0000-0000-0000-000000000001/i,
  "la migration ne doit contenir aucune donnée ALABIDI/atelier TEST",
);

console.log(
  "PLANNING DEPENDENCIES SQL V23.3.0 OK",
);
