import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationUrl = new URL(
  '../supabase/migrations/20261001082452_kha76_p0c2a_same_workshop_fks.sql',
  import.meta.url,
);

const sql = () => fs.readFileSync(migrationUrl, 'utf8');
const executableSql = () => sql().replace(/^\s*--.*$/gmu, '');

test('P0c.2a stays additive and does not cut over authority', () => {
  const source = executableSql();
  assert.match(source, /set local lock_timeout/i);
  assert.match(source, /set local statement_timeout/i);
  assert.doesNotMatch(source, /\b(update|delete|insert)\s+(into\s+|from\s+)?public\./i);
  assert.doesNotMatch(source, /\b(grant|revoke)\b/i);
  assert.doesNotMatch(source, /\b(create|drop)\s+policy\b/i);
  assert.doesNotMatch(source, /warranty_|oem_status|payment_status/i);
});

test('P0c.2a declares six composite parent identities', () => {
  const source = sql();
  for (const name of [
    'clients_workshop_id_id_uidx',
    'vehicles_workshop_id_id_uidx',
    'repair_orders_workshop_id_id_uidx',
    'repair_claims_workshop_id_id_uidx',
    'repair_supplements_workshop_id_id_uidx',
    'repair_steps_workshop_id_id_uidx',
  ]) {
    assert.ok(source.includes(name), `missing ${name}`);
  }
});

test('P0c.2a scopes all core relations by workshop', () => {
  const source = sql();
  for (const name of [
    'vehicles_workshop_client_fkey',
    'repair_orders_workshop_vehicle_fkey',
    'repair_orders_workshop_client_fkey',
    'repair_steps_workshop_order_fkey',
    'repair_steps_workshop_technician_fkey',
    'repair_steps_workshop_zone_fkey',
    'repair_steps_workshop_subcontractor_fkey',
    'repair_claims_workshop_order_fkey',
    'repair_claim_labor_lines_workshop_claim_fkey',
    'repair_supplements_workshop_order_fkey',
    'repair_supplements_workshop_claim_fkey',
    'repair_supplement_lines_workshop_supplement_fkey',
  ]) {
    assert.ok(source.includes(name), `missing ${name}`);
  }
});

test('P0c.2a scopes all MEDIA relations by workshop', () => {
  const source = sql();
  for (const name of [
    'photos_workshop_order_fkey',
    'photos_workshop_vehicle_fkey',
    'photos_workshop_claim_fkey',
    'photos_workshop_step_fkey',
  ]) {
    assert.ok(source.includes(name), `missing ${name}`);
  }
});

test('P0c.2a preserves legacy delete semantics', () => {
  const source = sql();
  assert.match(source, /vehicles_workshop_client_fkey[\s\S]*on delete set null \(client_id\)/i);
  assert.match(source, /repair_orders_workshop_vehicle_fkey[\s\S]*on delete set null \(vehicle_id\)/i);
  assert.match(source, /repair_orders_workshop_client_fkey[\s\S]*on delete set null \(client_id\)/i);
  assert.match(source, /repair_claims_workshop_order_fkey[\s\S]*on delete cascade/i);
  assert.match(source, /repair_claim_labor_lines_workshop_claim_fkey[\s\S]*on delete cascade/i);
  assert.match(source, /repair_supplements_workshop_claim_fkey[\s\S]*on delete set null \(claim_id\)/i);
  assert.match(source, /photos_workshop_order_fkey[\s\S]*on delete cascade/i);
  assert.match(source, /photos_workshop_vehicle_fkey[\s\S]*on delete set null \(vehicle_id\)/i);
  assert.match(source, /photos_workshop_claim_fkey[\s\S]*on delete set null \(claim_id\)/i);
  assert.match(source, /photos_workshop_step_fkey[\s\S]*on delete set null \(repair_step_id\)/i);
});

test('P0c.2a marks then validates every new FK', () => {
  const source = sql();
  const names = [...source.matchAll(/add constraint\s+([a-z0-9_]+)\s+foreign key/gi)]
    .map((match) => match[1]);
  assert.equal(names.length, 16);
  for (const name of names) {
    assert.match(source, new RegExp(`validate constraint\\s+${name}\\s*;`, 'i'));
  }
});
