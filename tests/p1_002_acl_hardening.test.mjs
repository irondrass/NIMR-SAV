import assert from "node:assert/strict";
import fs from "node:fs";

const migrationUrl = new URL("../supabase_p1_002_acl_hardening.sql", import.meta.url);
assert.equal(fs.existsSync(migrationUrl), true, "la migration ACL P1-002 doit exister");

const sql = fs.readFileSync(migrationUrl, "utf8");
const planningMigration = fs.readFileSync(
  new URL("../supabase_p1_002_planning_acceptance_safety.sql", import.meta.url),
  "utf8",
);
const compactSql = sql.replace(/--[^\n]*/gu, " ").replace(/\s+/gu, " ").trim();
const expectedHelpers = [
  "public.nimr_current_resource_id(uuid)",
  "public.nimr_current_workshop_role(uuid)",
  "public.nimr_has_workshop_role(uuid,text[])",
  "public.nimr_is_workshop_member(uuid)",
];

function normalizeSignature(signature) {
  return signature.replace(/\s+/gu, "").toLowerCase();
}

const anonRevokeMatches = [...sql.matchAll(
  /revoke\s+execute\s+on\s+function\s+(public\.[a-z0-9_]+\s*\([^;]*?\))\s+from\s+anon\s*;/giu,
)];
const anonRevokes = anonRevokeMatches.map((match) => normalizeSignature(match[1]));

assert.deepEqual(
  anonRevokes,
  expectedHelpers.map(normalizeSignature),
  "la migration doit révoquer anon exactement sur les quatre helpers attendus, une fois et dans l'ordre",
);

for (const helper of expectedHelpers) {
  const normalized = normalizeSignature(helper);
  assert.equal(
    anonRevokes.filter((signature) => signature === normalized).length,
    1,
    `REVOKE anon unique requis pour ${normalized}`,
  );
}

assert.match(sql, /^begin\s*;/mu, "la migration doit être transactionnelle");
assert.match(sql, /^commit\s*;/mu, "la migration doit se terminer par COMMIT");
assert.match(sql, /notify\s+pgrst\s*,\s*'reload schema'\s*;/iu, "PostgREST doit recharger le schéma");

assert.doesNotMatch(sql, /nimr_reserve_planning_(?:atomic|slots)/iu, "la migration ACL ne doit modifier aucun RPC planning");
assert.doesNotMatch(compactSql, /\bgrant\b/iu, "aucun GRANT n'est autorisé dans cette migration de révocation");
assert.doesNotMatch(compactSql, /\bservice_role\b/iu, "service_role ne doit pas être mentionné");
assert.doesNotMatch(compactSql, /\b(?:drop\s+(?:table|function)|truncate|delete\s+from|alter\s+table\b[^;]*\bdrop\b)\b/iu);
assert.doesNotMatch(compactSql, /\b(?:insert|update|delete|merge|copy)\b/iu, "aucune donnée métier ne doit être écrite");
assert.doesNotMatch(compactSql, /\b(?:create|alter)\s+(?:table|function|policy|role)\b/iu, "aucun objet serveur ne doit être créé ou altéré");

assert.match(
  planningMigration,
  /grant\s+execute\s+on\s+function\s+public\.nimr_reserve_planning_atomic\(uuid, text, bigint, text, jsonb\)[^;]+to authenticated\s*;/isu,
  "le contrat P1-002 doit conserver l'outer RPC pour authenticated",
);
const lowerPrivilegeStatements = [...planningMigration.matchAll(
  /(?:revoke|grant)[\s\S]*?public\.nimr_reserve_planning_slots\s*\(\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*jsonb\s*\)[\s\S]*?;/giu,
)];
assert.ok(lowerPrivilegeStatements.length > 0, "le contrat final du lower RPC doit être présent");
assert.match(
  lowerPrivilegeStatements.at(-1)[0],
  /revoke\s+all[\s\S]*?from\s+public\s*,\s*anon\s*,\s*authenticated\s*;/iu,
  "le lower RPC doit rester interne et non exécutable par authenticated",
);
assert.doesNotMatch(
  planningMigration.slice(lowerPrivilegeStatements.at(-1).index + lowerPrivilegeStatements.at(-1)[0].length),
  /grant\s+execute\s+on\s+function\s+public\.nimr_reserve_planning_slots\s*\([^;]+\bto\s+(?:public|anon|authenticated)\b/iu,
  "aucun GRANT navigateur ne doit suivre le REVOKE final du lower RPC",
);

console.log("P1-002 ACL HARDENING CONTRACT OK");
