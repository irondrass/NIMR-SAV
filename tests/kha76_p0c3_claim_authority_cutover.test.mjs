import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const syncPath = path.join(root, 'js', 'supabase-sync.js');

function migrationPath() {
  const matches = fs.readdirSync(migrationsDir)
    .filter((name) => name.endsWith('_kha76_p0c3_claim_authority_cutover.sql'));
  assert.equal(matches.length, 1, 'exactly one P0c.3 migration is required');
  return path.join(migrationsDir, matches[0]);
}

function sql() {
  return fs.readFileSync(migrationPath(), 'utf8');
}

test('P0c.3 cuts legacy claim writes over to one authenticated RPC', () => {
  const source = sql();
  assert.match(source, /create or replace function public\.nimr_upsert_legacy_repair_claims/i);
  assert.match(source, /security definer/i);
  assert.match(source, /auth\.uid\(\) is null/i);
  assert.match(source, /nimr_has_workshop_role/i);
  assert.match(source, /admin_technique/i);
  assert.match(source, /directeur/i);
  assert.match(source, /chef_atelier/i);
  assert.match(source, /reception/i);
  assert.match(source, /grant execute on function public\.nimr_upsert_legacy_repair_claims/i);
  assert.match(source, /revoke all on function public\.nimr_upsert_legacy_repair_claims/i);
});

test('P0c.3 rejects unknown claim payload keys and bounds the batch', () => {
  const source = sql();
  assert.match(source, /jsonb_object_keys/i);
  assert.match(source, /P0C3_UNKNOWN_CLAIM_FIELD/i);
  assert.match(source, /jsonb_array_length\(p_rows\)\s*>\s*200/i);
  assert.match(source, /P0C3_BATCH_TOO_LARGE/i);
});

test('P0c.3 whitelists the exact legacy claim vocabulary', () => {
  const source = sql();
  for (const value of [
    'assurance', 'client', 'vidange', 'mechanical_client',
    'electrical_client', 'diagnostic', 'garantie',
    'draft', 'expert_pending', 'client_pending', 'approved',
    'refused', 'planned', 'done',
  ]) {
    assert.ok(source.includes(`'${value}'`), `missing legacy value ${value}`);
  }
  assert.match(source, /P0C3_INVALID_CLAIM_TYPE/i);
  assert.match(source, /P0C3_INVALID_CLAIM_STATUS/i);
});

test('P0c.3 freezes claim order/type identity after first projection', () => {
  const source = sql();
  assert.match(source, /P0C3_CLAIM_ORDER_IMMUTABLE/i);
  assert.match(source, /P0C3_CLAIM_TYPE_IMMUTABLE/i);
  assert.match(source, /for update/i);
});

test('P0c.3 never owns future OEM/payment/network fields', () => {
  const source = sql();
  assert.doesNotMatch(source, /oem_status|payment_status|network_status|warranty_claim_network/i);
});

test('P0c.3 removes direct authenticated claim DML but keeps SELECT', () => {
  const source = sql();
  assert.match(source, /revoke insert\s*,\s*update\s*,\s*delete on table public\.repair_claims from authenticated/i);
  assert.match(source, /grant select on table public\.repair_claims to authenticated/i);
  assert.doesNotMatch(source, /revoke select on table public\.repair_claims from authenticated/i);
});

test('P0c.3 v23 sync uses RPC, never generic repair_claims upsert', () => {
  const source = fs.readFileSync(syncPath, 'utf8');
  assert.match(source, /nimr_upsert_legacy_repair_claims/);
  assert.match(source, /upsertLegacyRepairClaims/);
  assert.doesNotMatch(
    source,
    /upsertAndMap\(client,\s*["']repair_claims["'],\s*claimRows\)/,
  );
});

test('P0c.3 stays claim-only and does not alter MEDIA/RLS/network tables', () => {
  const source = sql();
  assert.doesNotMatch(source, /alter table public\.photos/i);
  assert.doesNotMatch(source, /create\s+policy|drop\s+policy/i);
  assert.doesNotMatch(source, /create\s+table/i);
});


test('P0c.3 legacy RPC refuses protected status/approval changes on existing claims', () => {
  const source = sql();
  assert.match(source, /P0C3_STATUS_CHANGE_FORBIDDEN/);
  assert.match(source, /P0C3_EXPERT_APPROVAL_CHANGE_FORBIDDEN/);
  assert.match(source, /P0C3_CLIENT_APPROVAL_CHANGE_FORBIDDEN/);
  assert.match(source, /existing_row\.status\s+is\s+distinct\s+from\s+status_value/i);
  assert.match(source, /existing_row\.expert_approved\s+is\s+distinct\s+from\s+expert_value/i);
  assert.match(source, /existing_row\.client_approved\s+is\s+distinct\s+from\s+client_value/i);
});

test('P0c.3 update projection cannot write protected authority columns', () => {
  const source = sql();
  const updateBlock = source.match(
    /update\s+public\.repair_claims\s+set([\s\S]*?)where\s+id\s*=\s*existing_row\.id/i,
  )?.[1] || '';
  assert.ok(updateBlock, 'repair_claims update block not found');
  assert.doesNotMatch(updateBlock, /\bstatus\s*=/i);
  assert.doesNotMatch(updateBlock, /\bexpert_approved\s*=/i);
  assert.doesNotMatch(updateBlock, /\bclient_approved\s*=/i);
});

test('P0c.3 new legacy claims cannot forge an approved authority state', () => {
  const source = sql();
  assert.match(source, /P0C3_NEW_CLAIM_AUTHORITY_FORBIDDEN/);
  assert.match(source, /status_value\s*<>\s*'draft'/i);
  assert.match(source, /expert_value/i);
  assert.match(source, /client_value/i);
});


test('P0c.3 uses valid PostgreSQL syntax for COALESCE and NULLIF', () => {
  const source = sql();
  assert.doesNotMatch(source, /pg_catalog\.(?:coalesce|nullif)\s*\(/i);
});
