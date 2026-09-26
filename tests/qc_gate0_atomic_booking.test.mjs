import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const dir = new URL('../supabase/migrations/', import.meta.url);
const sources = fs.readdirSync(dir).filter(n => n.endsWith('.sql')).sort().map(n => fs.readFileSync(new URL(n, dir), 'utf8'));
function latest(name) {
  const re = new RegExp(`create or replace function ${name.replaceAll('.', '\\.')}\\([\\s\\S]*?as\\s+(\\$[a-z_]*\\$)([\\s\\S]*?)\\1`, 'gi');
  return sources.flatMap(s => [...s.matchAll(re)].map(m => m[2])).at(-1);
}
test('QC verdict atomically completes its locked booking before the case decision', () => {
  const s = latest('nimr_internal.nimr_apply_quality_review_v3');
  assert.match(s, /limit 1\s+for update;/i);
  assert.match(s, /quality booking already completed/);
  const bookingUpdate = s.indexOf("'{status}', to_jsonb('completed'::text)");
  assert.ok(bookingUpdate > 0, 'booking must complete inside QC RPC');
  assert.ok(s.indexOf('set local "nimr.quality_review_v3"') < bookingUpdate);
  assert.ok(bookingUpdate < s.lastIndexOf('set payload = current_payload'));
  assert.match(s, /entity_id = quality_booking.entity_id/);
  assert.match(s, /'quality_booking_canonical',to_jsonb\(quality_booking\)/);
});
test('RPC booking closure preserves assignment and authority and does not authorize ordinary QC edits', () => {
  const s = latest('public.nimr_guard_quality_booking_authority');
  assert.match(s, /current_setting\('nimr.quality_review_v3', true\)/);
  assert.match(s, /new_payload->>'completedBy' = caller_id::text/);
  assert.match(s, /new_payload - array\['status','completedAt','completedBy','updatedAt'\]/);
  assert.match(s, /old_payload - array\['status','completedAt','completedBy','updatedAt'\]/);
  assert.match(s, /quality booking assignment access denied/);
});
test('recovery migration reinstalls cutover and retains unfinished-work delivery guard', () => {
  const repair = sources.find(s => s.includes('-- QC-PRO-001 Gate 0: atomic inspection completion'));
  assert.match(repair, /create trigger nimr_04_quality_domain_authority/);
  assert.match(repair, /quality domain changes must use nimr_apply_quality_review_v3/);
  assert.doesNotMatch(repair, /create or replace function public\.nimr_guard_client_commitment/);
});
test('existing-case UPSERT reaches UPDATE QC authority while new cases stay neutral', () => {
  const guard = latest('public.nimr_guard_quality_domain_authority');
  assert.match(guard, /if tg_op='INSERT' then[\s\S]*?if exists \([\s\S]*?existing\.entity_id = new\.entity_id[\s\S]*?existing\.deleted_at is null[\s\S]*?return new;/i);
  assert.match(guard, /new case cannot contain completed quality decision state/);
  assert.match(guard, /qc_changed and coalesce\(current_setting\('nimr.quality_review_v3',true\),'\'\) <> 'on'/i);
});
