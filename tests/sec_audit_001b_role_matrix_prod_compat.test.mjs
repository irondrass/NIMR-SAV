import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migrationsDir = new URL("../supabase/migrations/", import.meta.url);

const migrations = fs.readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({
    name,
    source: fs.readFileSync(new URL(name, migrationsDir), "utf8"),
  }));

function migration001B() {
  const found = migrations.filter(({ name }) =>
    name.includes("_sec_audit_001b_role_matrix_prod_preflight.sql")
  );

  assert.equal(
    found.length,
    1,
    "SEC-AUDIT-001B migration missing or duplicated"
  );

  return found[0];
}

function functionBody(migration, name) {
  const escaped = name.replaceAll(".", "\\.");
  const pattern = new RegExp(
    `create or replace function ${escaped}\\(\\)[\\s\\S]*?as\\s+(\\$[a-z_]*\\$)([\\s\\S]*?)\\1`,
    "iu"
  );

  const match = migration.source.match(pattern);
  assert.ok(match, `${name} definition missing`);
  return match[2];
}

test("001B is forward-only and changes only client commitment guard", () => {
  const migration = migration001B();

  const functions = [
    ...migration.source.matchAll(
      /create or replace function\s+([\w.]+)\s*\(/giu
    ),
  ].map((match) => match[1]);

  assert.deepEqual(functions, [
    "public.nimr_guard_client_commitment",
  ]);

  assert.doesNotMatch(
    migration.source,
    /\b(?:create|drop|alter)\s+trigger\b/iu
  );

  assert.doesNotMatch(
    migration.source,
    /\bgrant\b|\brevoke\b/iu
  );
});

test("001B refuses deployment when SEC/QC prerequisites are absent", () => {
  const { source } = migration001B();

  assert.match(
    source,
    /to_regprocedure\('public\.nimr_guard_quality_domain_authority\(\)'\)/iu
  );

  assert.match(
    source,
    /to_regprocedure\('public\.nimr_guard_operational_finalization\(\)'\)/iu
  );

  assert.match(source, /nimr_04_quality_domain_authority/u);
  assert.match(source, /nimr_operational_finalization_guard/u);
  assert.match(source, /nimr_client_commitment_guard/u);
  assert.match(source, /'public\.sync_entities'::regclass/u);

  assert.match(
    source,
    /position\('auth\.uid\(\) is null' in qc_definition\)\s*=\s*0/iu
  );

  assert.match(
    source,
    /position\(\s*'finalization_started'\s+in\s+finalization_definition\s*\)\s*=\s*0/iu
  );

  assert.match(
    source,
    /position\(\s*'finalization access denied'\s+in\s+finalization_definition\s*\)\s*=\s*0/iu
  );

  assert.match(source, /errcode\s*=\s*'55000'/iu);
});

test("case deletion is NULL-auth fail-closed and admin_technique-only", () => {
  const migration = migration001B();
  const body = functionBody(
    migration,
    "public.nimr_guard_client_commitment"
  );

  const deletion = body.match(
    /if new\.deleted_at is not null then([\s\S]*?)return new;\s*end if;/iu
  );

  assert.ok(deletion, "case deletion block missing");

  assert.match(
    deletion[1],
    /auth\.uid\(\) is null[\s\S]*?array\['admin_technique'\]/iu
  );

  assert.doesNotMatch(
    deletion[1],
    /\b(?:directeur|chef_atelier|reception)\b/iu
  );

  assert.match(
    deletion[1],
    /case deletion access denied[\s\S]*?42501/iu
  );
});

test("client commitment role matrix remains unchanged", () => {
  const migration = migration001B();
  const body = functionBody(
    migration,
    "public.nimr_guard_client_commitment"
  );

  assert.match(
    body,
    /array\['admin_technique','directeur','chef_atelier','reception'\]/iu
  );

  assert.match(
    body,
    /client commitment or reception access denied[\s\S]*?42501/iu
  );
});