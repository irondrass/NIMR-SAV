import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const migrations = fs.readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, source: fs.readFileSync(new URL(name, migrationsDir), 'utf8') }));

function latestFunction(name) {
  const escaped = name.replaceAll('.', '\\.');
  const pattern = new RegExp(
    `create or replace function ${escaped}\\(\\)[\\s\\S]*?as\\s+(\\$[a-z_]*\\$)([\\s\\S]*?)\\1`,
    'giu'
  );
  return migrations.flatMap(({ name: migration, source }) =>
    [...source.matchAll(pattern)].map((match) => ({ migration, body: match[2] }))
  ).at(-1);
}


function functionFromMigration(migration, name) {
  const escaped = name.replaceAll('.', '\\.');
  const pattern = new RegExp(
    `create or replace function ${escaped}\\(\\)[\\s\\S]*?as\\s+(\\$[a-z_]*\\$)([\\s\\S]*?)\\1`,
    'iu'
  );
  const match = migration.source.match(pattern);
  assert.ok(match, `${name} missing from ${migration.name}`);
  return { migration: migration.name, body: match[2] };
}

function secAuditMigration() {
  const matches = migrations.filter(({ name }) => name.includes('_sec_audit_001_null_auth_guard_hardening.sql'));
  assert.equal(matches.length, 1, 'SEC-AUDIT-001 must add exactly one forward-only migration');
  return matches[0];
}

test('SEC-AUDIT-001 redefines only the three effective guard functions', () => {
  const migration = secAuditMigration();
  const definitions = [...migration.source.matchAll(/create or replace function\s+([\w.]+)\s*\(/giu)]
    .map((match) => match[1]);

  assert.deepEqual(definitions, [
    'public.nimr_guard_quality_domain_authority',
    'public.nimr_guard_client_commitment',
    'public.nimr_guard_operational_finalization'
  ]);
  assert.doesNotMatch(migration.source, /create\s+(?:or replace\s+)?trigger/iu);
});

test('QC guard fails closed for NULL auth only when the QC domain changes', () => {
  const migration = secAuditMigration();
  const guard = latestFunction('public.nimr_guard_quality_domain_authority');

  assert.equal(guard.migration, migration.name);
  assert.match(guard.body, /if new\.entity_type <> 'case' then\s+return new;/iu);
  assert.doesNotMatch(guard.body, /auth\.uid\(\) is null\s+or\s+new\.entity_type/iu);
  assert.match(
    guard.body,
    /if qc_changed and \(\s*auth\.uid\(\) is null\s+or\s+coalesce\(current_setting\('nimr\.quality_review_v3',\s*true\),\s*''\) <> 'on'\s*\) then[\s\S]*?errcode='42501'/iu
  );
  assert.match(guard.body, /new case cannot contain completed quality decision state[\s\S]*?errcode='42501'/iu);
});

test('client commitment guard denies NULL auth for protected reception changes and deletion only', () => {
  const migration = secAuditMigration();
  const guard = functionFromMigration(
    migration,
    'public.nimr_guard_client_commitment'
  );

  assert.equal(guard.migration, migration.name);
  assert.match(guard.body, /if new\.entity_type <> 'case' then return new; end if;/iu);
  assert.match(
    guard.body,
    /if new\.deleted_at is not null then[\s\S]*?if auth\.uid\(\) is null or not public\.nimr_has_workshop_role[\s\S]*?case deletion access denied[\s\S]*?errcode='42501'/iu
  );
  assert.match(
    guard.body,
    /if changed and \(auth\.uid\(\) is null or not public\.nimr_has_workshop_role[\s\S]*?client commitment or reception access denied[\s\S]*?errcode='42501'/iu
  );
  assert.match(guard.body, /array\['promisedAt','nextContactAt','lastContactAt','note'\]/u);
  assert.match(guard.body, /array\['ownerId','dueAt','note'\]/u);
  assert.match(guard.body, /\{flags,received\}/u);
});

test('operational guard denies NULL auth for quality and delivery authority while retaining invariants', () => {
  const migration = secAuditMigration();
  const guard = latestFunction('public.nimr_guard_operational_finalization');

  assert.equal(guard.migration, migration.name);
  assert.match(
    guard.body,
    /if auth\.uid\(\) is null or not public\.nimr_has_workshop_role\(new\.workshop_id,[\s\S]*?quality review access denied[\s\S]*?errcode = '42501'/iu
  );
  assert.match(
    guard.body,
    /if delivery_started and \(auth\.uid\(\) is null or not public\.nimr_has_workshop_role\(new\.workshop_id,[\s\S]*?delivery access denied[\s\S]*?errcode = '42501'/iu
  );
  assert.match(guard.body, /public\.nimr_finalization_issue\(new\.payload, coalesce\(delivery_started, false\)\)/iu);
  assert.match(guard.body, /Confirmer la remise physique avant la clôture ou l''archivage\./u);
});

test('operational guard fails closed for NULL auth finalization transitions only', () => {
  const migration = secAuditMigration();
  const guard = latestFunction('public.nimr_guard_operational_finalization');

  assert.equal(guard.migration, migration.name);
  assert.match(guard.body, /finalization_started boolean;/iu);
  assert.match(
    guard.body,
    /finalization_started :=\s*\(nullif\(new\.payload->>'archivedAt', ''\) is not null\s+and nullif\(previous->>'archivedAt', ''\) is null\)\s+or \(nullif\(new\.payload->>'closedAt', ''\) is not null\s+and nullif\(previous->>'closedAt', ''\) is null\)\s+or \(new\.payload #>> '\{flags,invoiced\}' = 'true'\s+and previous #>> '\{flags,invoiced\}' is distinct from 'true'\);/iu
  );
  assert.match(
    guard.body,
    /if finalization_started and auth\.uid\(\) is null then\s+raise exception 'finalization access denied'\s+using errcode='42501';\s+end if;/iu
  );
  assert.match(
    guard.body,
    /if finalization_started\s+and new\.payload #>> '\{flags,delivered\}' is distinct from 'true' then\s+raise exception 'Confirmer la remise physique avant la clôture ou l''archivage\.' using errcode = '23514';/iu
  );
});

test('authenticated RPC and role contracts are not redefined by SEC-AUDIT-001', () => {
  const { source } = secAuditMigration();

  assert.doesNotMatch(source, /create or replace function\s+(?:public|nimr_internal)\.nimr_apply_/iu);
  assert.doesNotMatch(source, /create or replace function\s+public\.nimr_has_workshop_role/iu);
  assert.doesNotMatch(source, /\bgrant\b|\brevoke\b/iu);
});
