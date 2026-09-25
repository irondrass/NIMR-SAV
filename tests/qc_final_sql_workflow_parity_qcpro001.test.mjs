import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createNimrVmContext } from './helpers/nimr_vm_context.mjs';

// Static SQL contracts, NOT a PostgreSQL emulator or a database execution claim.
// Always resolve replacements chronologically; a later migration cannot silently
// leave this regression suite testing an obsolete implementation.
const migrations = new URL('../supabase/migrations/', import.meta.url);
function definitions(name) {
  const escaped = name.replaceAll('.', '\\.');
  const pattern = new RegExp(`create\\s+or\\s+replace\\s+function\\s+${escaped}\\s*\\([\\s\\S]*?as\\s+(\\$[a-z_]*\\$)([\\s\\S]*?)\\1\\s*;`, 'gi');
  return fs.readdirSync(migrations).filter(n => n.endsWith('.sql')).sort().flatMap(file =>
    [...fs.readFileSync(new URL(file, migrations), 'utf8').matchAll(pattern)]
      .map(match => ({ file, source: match[0], body: match[2].replace(/--[^\n]*/g, '') })));
}
const chain = definitions('nimr_internal.nimr_apply_quality_review_v3');
const final = chain.at(-1);
const sql = final.body;
const { run } = createNimrVmContext({ filename: 'qc-final-sql-parity.js' });
const definition = item => JSON.parse(run(`JSON.stringify(getProfessionalQualityChecklistDefinition(${JSON.stringify(item)}))`));
const ids = item => definition(item).flatMap(s => s.points.map(p => p.id)).sort();
const fullCase = {
  durations: { oilService: 1, mechanical: 1, electrical: 1, body: 1 },
  qualityControl: { highVoltage: true, criticalSafety: true, roadTestRequired: true },
};
const literals = source => [...source.matchAll(/'([^']+)'/g)].map(m => m[1]);
const whitelist = literals(sql.match(/all_known_keys\s*:=\s*array\[([^\]]+)\]/i)?.[1] || '');
const derivation = sql.slice(sql.indexOf('expected_keys :='), sql.indexOf("checklist := '{}'"));
const requiredGroups = [...derivation.matchAll(/expected_keys\s*:=\s*(?:array_cat\(expected_keys,\s*|expected_keys\s*\|\|\s*)?array\[([^\]]+)\]/gi)];

// A deliberately small, fail-closed evaluator for the actual applicability
// expressions in the SQL contract. Unknown syntax fails; no handwritten second
// domain-to-key catalog and no pretend transaction/authorization engine.
function applies(condition, item) {
  const contextFields = [...sql.match(/context_text\s*:=\s*lower\(concat_ws\(([\s\S]*?)\)\);/i)[1]
    .matchAll(/current_payload->>'([^']+)'/g)].map(m => m[1]);
  const context = contextFields.map(k => item[k] || '').join(' ').toLowerCase();
  return condition.trim().split(/\s+or\s+/i).map(atom => {
    let m = atom.match(/^coalesce\((?:nullif\(|\()?durations->>'([^']+)'(?:,'')?\)?::numeric,\s*0\)\s*>\s*0$/i);
    if (m) return Number(item.durations?.[m[1]] || 0) > 0;
    m = atom.match(/^quality_control->'([^']+)'\s*=\s*'true'::jsonb$/i);
    if (m) return item.qualityControl?.[m[1]] === true;
    m = atom.match(/^position\('([^']+)' in context_text\)\s*>\s*0$/i);
    if (m) return context.includes(m[1]);
    m = atom.match(/^context_text ~ '([^']+)'$/i);
    if (m) return new RegExp(m[1].replaceAll('\\m', '\\b')).test(context);
    m = atom.match(/^coalesce\(\(quality_control->>'([^']+)'\)::boolean,false\) = true$/i);
    if (m) return [true, 'true'].includes(item.qualityControl?.[m[1]]);
    assert.fail(`Unreviewed SQL applicability expression: ${atom}`);
  }).some(Boolean);
}
function required(item) {
  return requiredGroups.flatMap(group => {
    const before = derivation.slice(0, group.index);
    const end = before.lastIndexOf('end if;');
    const open = before.lastIndexOf('\n  if ');
    if (open > end) {
      const condition = before.slice(open).match(/^\s*if\s+([\s\S]*?)\s+then\s*$/i);
      assert.ok(condition, 'every conditional key group has a reviewed condition');
      if (!applies(condition[1], item)) return [];
    }
    return literals(group[1]);
  }).sort();
}

test('R1 effective SQL — final internal RPC and public wrapper replace the earlier definitions', () => {
  assert.deepEqual(chain.map(d => d.file), [
    '20260922210000_lot20b_qc_v3_server.sql',
    '20260923064000_qc_pro_dynamic_checklist_server.sql',
    '20260923213000_qc_pro_booking_authority_hardening.sql',
  ]);
  const wrapper = definitions('public.nimr_apply_quality_review_v3').at(-1);
  assert.equal(wrapper.file, final.file);
  assert.match(wrapper.body, /select nimr_internal\.nimr_apply_quality_review_v3\(/);
});

test('R1 parity — every UI key is accepted and every server key can be produced by the UI', () => {
  assert.equal(ids(fullCase).length, 51);
  assert.deepEqual([...whitelist].sort(), ids(fullCase));
  assert.equal(new Set(whitelist).size, whitelist.length);
  assert.deepEqual(required(fullCase), ids(fullCase));
});

test('R1 parity — required domains match real UI applicability including negative context cases', () => {
  const cases = [{}, fullCase];
  for (const key of ['oilService', 'mechanical', 'electrical', 'body', 'prep', 'paint', 'reassembly', 'finish']) {
    for (const value of [0, -1, '', 1, '0.5']) cases.push({ durations: { [key]: value } });
  }
  for (const key of ['highVoltage', 'criticalSafety', 'roadTestRequired']) {
    for (const value of [true, false, 'true', 'false', null]) cases.push({ qualityControl: { [key]: value } });
  }
  for (const key of ['orderType', 'type', 'visitReason', 'arrivalNotes', 'damageNotes', 'description', 'claimSummary']) {
    for (const value of ['DIAGNOSTIC', 'électrique', 'electrique', 'vidange freinage carrosserie HEV essai routier']) {
      cases.push({ [key]: value });
    }
  }
  for (const item of cases) assert.deepEqual(required(item), ids(item), JSON.stringify(item));
});

test('R1 parity — unknown injection still raises 22023 and critical NOK cannot validate', () => {
  assert.ok(!whitelist.includes('safety.artificial_bypass'));
  assert.match(sql, /if not \(input_key = any\(all_known_keys\)\) then\s+raise exception 'unknown quality checklist key:[^;]+errcode='22023';\s+end if;/);
  assert.match(sql, /foreach input_key in array expected_keys[\s\S]*?normalized_value not in \('ok','na'\)[\s\S]*?errcode='23514'/);
  assert.match(sql, /if input_value = 'nok' then\s+raise exception[^;]+errcode='23514'/);
  for (const section of definition(fullCase).filter(s => ['ev_hev', 'critical_safety', 'road_test'].includes(s.id))) {
    for (const point of section.points) assert.ok(whitelist.includes(point.id));
  }
  assert.ok(definition(fullCase).flatMap(s => s.points).filter(p => p.critical).length > 20);
});

test('R1 NOK — successful finalization is reachable only for validated, never after rejected workCompleted=false', () => {
  const helper = definitions('public.nimr_finalization_issue').at(-1).body;
  assert.match(helper, /if p_payload #>> '\{flags,workCompleted\}' is distinct from 'true' then\s+return/);
  const tail = sql.slice(sql.lastIndexOf("current_payload := jsonb_set(current_payload, '{flags}'"));
  assert.match(tail, /if clean_status = 'validated' then\s+finalization_issue := public\.nimr_finalization_issue\(current_payload, false\);\s+if finalization_issue is not null then\s+raise exception '%', finalization_issue using errcode='23514';\s+end if;\s+end if;/);
  assert.equal((sql.match(/public\.nimr_finalization_issue\(/g) || []).length, 1);
  assert.doesNotMatch(sql, /\bexception\s+when\b/i, 'do not swallow the failure');
  assert.match(sql, /flags := jsonb_set\(flags, '\{workCompleted\}', 'false'::jsonb, true\)/);
  assert.match(tail, /update public\.sync_entities\s+set payload = current_payload/);
  assert.match(tail, /insert into public\.sync_entity_operation_receipts/);
});

test('R1 NOK — append-only decision snapshots retain reason, tri-state, actor, authority and evidence references', () => {
  assert.match(sql, /then reception_workflow->'qualityReviewHistory'/);
  const history = sql.slice(sql.indexOf('history := history ||'), sql.indexOf("if clean_status = 'validated' then", sql.indexOf('history := history ||')));
  for (const expression of ["'status', clean_status", "'reason', clean_reason", "'checklist', checklist", "'operationId', trim(p_operation_id)", "'executorId', auth.uid()::text", "'authority', booking_authority", "'qualityBookingId', quality_booking.entity_id", "'photos', coalesce(current_payload->'photos', '[]'::jsonb)"]) {
    assert.ok(history.includes(expression), `missing durable snapshot: ${expression}`);
  }
  assert.match(sql, /normalized_value := 'ok'/);
  assert.match(sql, /normalized_value := 'na'/);
  assert.match(sql, /normalized_value := 'nok'/);
  assert.doesNotMatch(sql, /delete\s+from/i);
  // Existing historical checklist objects are never canonicalized in place.
  assert.doesNotMatch(sql, /jsonb_array_elements\([^;]*qualityReviewHistory|\{qualityReviewHistory,/);
  assert.match(sql, /'\{qualityReviewHistory\}', history, true/);
});

test('R1 NOK — distinct rework persists and revalidation requires its completed booking', () => {
  assert.match(sql, /rework_id := 'booking:rework:' \|\| p_case_id \|\| ':' \|\| rework_cycle::text/);
  assert.match(sql, /p_workshop_id, 'booking', rework_id,[\s\S]*?'key', clean_step/);
  assert.match(sql, /'\{qualityReworkBookingId\}', to_jsonb\(rework_id\)/);
  assert.match(sql, /'status', 'rework',[\s\S]*?'reworkBookingId', rework_id/);
  const validation = sql.slice(sql.indexOf("if clean_status = 'validated' then", sql.indexOf('history := history ||')), sql.indexOf('rework_cycle := coalesce'));
  assert.match(validation, /entity_id=rework_booking_id[\s\S]*?deleted_at is null/);
  assert.match(validation, /rework_row\.entity_id is null[\s\S]*?not in \('completed','done'\)[\s\S]*?errcode='23514'/);
  assert.match(validation, /'\{qualityRevalidatedAt\}'/);
  assert.match(validation, /'\{qualityReworkCompletedAt\}'/);
});

test('R1 security — final RPC retains server authority, concurrency and restricted execute grants', () => {
  assert.match(final.source, /security definer\s+set search_path to 'pg_catalog','public'/);
  for (const guard of ['auth.uid() is null', "actor_role not in ('controle_qualite','chef_atelier')", 'current_resource_id is null', 'quality resource assignment mismatch', 'quality booking lacks verified server authority', 'chief fallback requires administrative authorization', 'pg_advisory_xact_lock', 'for update', 'p_base_version', 'accepted_receipt', 'set local "nimr.quality_review_v3"']) assert.ok(sql.includes(guard), guard);
  const migration = fs.readFileSync(new URL(final.file, migrations), 'utf8');

  const legacySig = 'uuid,text,text,text,jsonb,text,text,bigint';
  const newSig = 'uuid,text,text,text,text,jsonb,text,bigint';

  // 1 & 2. Both internal and public legacy signatures must be fully revoked from public, anon, authenticated
  assert.match(migration, new RegExp(`revoke all on function nimr_internal\\.nimr_apply_quality_review_v3\\(\\s*${legacySig}\\s*\\)\\s*from public, anon, authenticated;`, 'i'));
  assert.match(migration, new RegExp(`revoke all on function public\\.nimr_apply_quality_review_v3\\(\\s*${legacySig}\\s*\\)\\s*from public, anon, authenticated;`, 'i'));

  // 3. New QC-PRO internal signature revoked from all
  assert.match(migration, new RegExp(`revoke all on function nimr_internal\\.nimr_apply_quality_review_v3\\(\\s*${newSig}\\s*\\)\\s*from public, anon, authenticated;`, 'i'));

  // 4. New QC-PRO public signature revoked from public, anon, and granted to authenticated
  assert.match(migration, new RegExp(`revoke all on function public\\.nimr_apply_quality_review_v3\\(\\s*${newSig}\\s*\\)\\s*from public, anon;`, 'i'));
  assert.match(migration, new RegExp(`grant execute on function public\\.nimr_apply_quality_review_v3\\(\\s*${newSig}\\s*\\)\\s*to authenticated;`, 'i'));

  // Guarantee that authenticated is NEVER granted on the legacy signature
  assert.doesNotMatch(migration, new RegExp(`grant\\s+execute[\\s\\S]*?public\\.nimr_apply_quality_review_v3\\(\\s*${legacySig}\\s*\\)[\\s\\S]*?to authenticated`, 'i'));

  assert.doesNotMatch(final.source, /service_role|auth\.admin|user_metadata/i);
});

test('R1 client & bypass security — client uses exclusively new signature and legacy bypass is closed', () => {
  const clientSrc = fs.readFileSync(new URL('../js/supabase-client.js', import.meta.url), 'utf8');
  const rpcCallMatch = clientSrc.match(/client\.rpc\(\s*["']nimr_apply_quality_review_v3["']\s*,\s*\{([\s\S]*?)\}\s*\)/);
  assert.ok(rpcCallMatch, 'client.rpc for nimr_apply_quality_review_v3 must be present');
  const rpcParams = rpcCallMatch[1];

  // Phase 4: Client uses only modern parameters
  for (const requiredParam of ['p_workshop_id', 'p_case_id', 'p_quality_status', 'p_reason', 'p_operation_id', 'p_checklist', 'p_rework_step_key', 'p_base_version']) {
    assert.ok(rpcParams.includes(requiredParam), `client rpc must include ${requiredParam}`);
  }
  assert.doesNotMatch(rpcParams, /\bp_decision\b/, 'client rpc must NOT pass p_decision');
  assert.doesNotMatch(rpcParams, /\bp_rework_key\b/, 'client rpc must NOT pass p_rework_key');

  // Phase 5: Static bypass simulation
  const migration = fs.readFileSync(new URL(final.file, migrations), 'utf8');
  function simulateAclDispatch(role, callArgs) {
    const isLegacyCall = Object.prototype.hasOwnProperty.call(callArgs, 'p_decision') || Object.prototype.hasOwnProperty.call(callArgs, 'p_rework_key');
    if (isLegacyCall) {
      // Legacy wrapper: all privileges revoked from public, anon, authenticated
      const legacyGranted = /grant\s+execute\s+on\s+function\s+public\.nimr_apply_quality_review_v3\(\s*uuid,text,text,text,jsonb,text,text,bigint\s*\)\s*to\s+authenticated/i.test(migration);
      return legacyGranted ? 'EXECUTE_GRANTED' : 'PERMISSION_DENIED';
    } else {
      // New QC-PRO wrapper: granted to authenticated
      const newGranted = /grant\s+execute\s+on\s+function\s+public\.nimr_apply_quality_review_v3\(\s*uuid,text,text,text,text,jsonb,text,bigint\s*\)\s*to\s+authenticated/i.test(migration);
      return (role === 'authenticated' && newGranted) ? 'EXECUTE_GRANTED' : 'PERMISSION_DENIED';
    }
  }

  // A. New API called by authenticated => EXECUTE_GRANTED
  assert.equal(simulateAclDispatch('authenticated', { p_quality_status: 'validated', p_operation_id: 'op-1', p_checklist: {} }), 'EXECUTE_GRANTED');
  // B. Legacy API called by authenticated => PERMISSION_DENIED (bypass prevented)
  assert.equal(simulateAclDispatch('authenticated', { p_decision: 'validated', p_rework_key: 'step-1' }), 'PERMISSION_DENIED');
  // C. Anon calling either => PERMISSION_DENIED
  assert.equal(simulateAclDispatch('anon', { p_quality_status: 'validated' }), 'PERMISSION_DENIED');
  assert.equal(simulateAclDispatch('anon', { p_decision: 'validated' }), 'PERMISSION_DENIED');
});

if (process.env.NIMR_QC_PARITY_REPORT === '1') {
  for (const section of definition(fullCase)) {
    for (const point of section.points) console.log(JSON.stringify({ domain: section.id, ...point, serverAccepted: whitelist.includes(point.id) }));
  }
}
