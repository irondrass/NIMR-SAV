// Explicitly opt-in staging integration harness. Never persists credentials or sessions.
// Run: node tests/qc_gate0_staging.mjs --staging
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

if (!process.argv.includes('--staging')) throw new Error('Explicit --staging required');
const ref = 'ijgstcdptyxjzgqlvooc';
const base = `https://${ref}.supabase.co`;
const cleanupOnly = process.argv.includes('--cleanup-last');
const prior = cleanupOnly ? JSON.parse(readFileSync('.nimr-ai/staging-gate0-runtime.json', 'utf8')) : null;
if (prior && (prior.ref !== ref || !/^QC-GATE0-[a-f0-9]{8}$/.test(prior.prefix) || !/^[a-f0-9-]{36}$/.test(prior.workshop))) throw new Error('Invalid cleanup target');
const wid = prior?.workshop || randomUUID();
const prefix = prior?.prefix || `QC-GATE0-${randomUUID().slice(0, 8)}`;
const users = {};
if (cleanupOnly) {
  if (!Array.isArray(prior.authUsers)) throw new Error('Missing Auth fixture IDs; verify Auth cleanup administratively');
  for (const u of prior.authUsers) {
    if (!/^[a-zA-Z]+$/.test(u.actor) || !/^[a-f0-9-]{36}$/.test(u.id)) throw new Error('Invalid Auth cleanup target');
    users[u.actor] = { id: u.id };
  }
}
const resources = {};
const evidence = { ref, workshop: wid, prefix, at: new Date().toISOString(), checks: [] };
let secret, pub;
const stamp = () => new Date().toISOString();
const record = (name, pass, detail = {}) => {
  const item = { name, pass, ...detail };
  evidence.checks.push(item);
  console.log(JSON.stringify(item));
};
async function request(path, { method = 'GET', body, actor, admin = false, noKey = false, extraHeaders = {} } = {}) {
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'nimr-gate0-staging/1.0' };
  if (!noKey) headers.apikey = admin ? secret : pub;
  if (actor) headers.Authorization = `Bearer ${users[actor].token}`;
  Object.assign(headers, extraHeaders);
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const raw = await r.text();
  let data; try { data = JSON.parse(raw); } catch { data = null; }
  // Never log raw responses/headers: Auth endpoints contain credentials.
  return { ok: r.ok, status: r.status, data };
}
function must(r, label) {
  if (!r.ok || r.data?.accepted === false) {
    const code = /^[A-Z0-9]{5,12}$/.test(r.data?.code || '') ? r.data.code : 'unknown';
    const message = String(r.data?.message || '').replace(/(?:sb_(?:secret|publishable)_|eyJ)[A-Za-z0-9_.-]+/g, '[REDACTED]').slice(0, 160);
    throw new Error(`${label}: HTTP ${r.status}, code ${code}, message ${message}`);
  }
  return r.data;
}
async function admin(path, method, body) { return must(await request(path, { admin: true, method, body }), `fixture ${method} ${path.split('?')[0]}`); }
async function row(type, id) { return (await admin(`/rest/v1/sync_entities?workshop_id=eq.${wid}&entity_type=eq.${type}&entity_id=eq.${encodeURIComponent(id)}&select=*`, 'GET'))[0]; }
async function sync(actor, type, id, payload, version = null, deleted = false) {
  return request('/rest/v1/rpc/nimr_apply_sync_entity_v2', { actor, method: 'POST', body: {
    p_workshop_id: wid, p_entity_type: type, p_entity_id: id, p_payload: payload,
    p_base_version: version, p_operation_id: `${prefix}-${randomUUID()}`, p_deleted: deleted,
  } });
}
const checklist = Object.fromEntries([
  'documentary.work_order_complete', 'documentary.authorizations_present', 'documentary.operations_recorded', 'documentary.technician_notes_complete',
  'general.no_warning_lights', 'general.no_leak', 'general.reassembly_secure', 'general.repaired_functions_verified', 'general.no_tools_left',
  'mechanical.repair_function', 'mechanical.fasteners', 'mechanical.no_leak', 'mechanical.noise_vibration', 'mechanical.temperature_pressure',
  'delivery.clean_vehicle', 'delivery.no_new_damage', 'delivery.protections_removed', 'delivery.client_items_present', 'delivery.documents_ready',
].map(k => [k, 'ok']));
async function review(actor, id, status = 'validated', options = {}) {
  const current = await row('case', id);
  return request('/rest/v1/rpc/nimr_apply_quality_review_v3', { actor, method: 'POST', ...options, body: {
    p_workshop_id: wid, p_case_id: id, p_quality_status: status,
    p_reason: status === 'rejected' ? 'QC-GATE0 test: noise requires rework' : '',
    p_operation_id: `${prefix}-${randomUUID()}`, p_checklist: status === 'rejected' ? { ...checklist, 'mechanical.noise_vibration': 'nok' } : checklist,
    p_rework_step_key: status === 'rejected' ? 'mechanical' : null, p_base_version: current.entity_version,
  } });
}
async function seedCase(suffix) {
  const id = `${prefix}-${suffix}`;
  const payload = { id, local_id: id, clientName: prefix, vehicle: 'QC test', plate: prefix, vin: 'QCIGATE0000000001', mileage: '1000', orNavNumber: id,
    createdAt: stamp(), updatedAt: stamp(), durations: { mechanical: 1 },
    flags: { expertApproved: true, clientApproved: true, received: true, workStarted: true, workCompleted: true, qualityApproved: false, delivered: false, invoiced: false },
    claims: [{ id: `${id}-claim`, number: id, title: 'QC test', type: 'mechanical_client', status: 'approved', includeInPlanning: true, clientApproved: true, expertApproved: true,
      estimate: { reference: id, lines: [{ id: `${id}-labor`, operation: 'Mechanical test', phase: 'mechanical', laborHours: 1, status: 'validated' }] } }],
    qualityControl: { roadTestRequired: false, criticalSafety: false, highVoltage: false, adas: false, comeback: false, repeatRepair: false },
    qualityChecklist: {}, receptionWorkflow: { qualityStatus: 'not_started', qualityReviewHistory: [] }, customerClaims: [], photos: [], history: [], partsStatus: 'available', blockerReason: '', blockerDetails: '',
  };
  await admin('/rest/v1/sync_entities', 'POST', { workshop_id: wid, entity_type: 'case', entity_id: id, payload, entity_version: 1, last_operation_id: `${id}-seed` });
  return id;
}
async function booking(id, who = 'qc', mode = 'quality_controller', actor = 'director') {
  const bid = `${id}-qc-${randomUUID().slice(0, 6)}`;
  const start = new Date(Date.now() + 3600000).toISOString(), end = new Date(Date.now() + 5400000).toISOString();
  const payload = { id: bid, caseId: id, key: 'quality', taskId: 'quality-control', title: 'QC-GATE0', start, end, segments: [{ start, end }],
    resourceIds: [resources[who].local_id], primaryResourceId: resources[who].local_id, equipmentResourceIds: [], status: 'planned', type: 'task', temporary: false, vehicleExclusive: true, serviceMode: 'internal', qualityAssignmentMode: mode };
  return { bid, result: await sync(actor, 'booking', bid, payload) };
}
async function denial(name, r, expected) {
  record(name, !r.ok && expected.includes(r.data?.code), { http: r.status, code: r.data?.code || null, message: r.data?.message || null });
}

try {
  // Capture stdout in process memory; errors deliberately omit child-process output.
  let raw;
  try { raw = execFileSync('cmd.exe', ['/d', '/s', '/c', `npx.cmd --yes supabase@2.118.0 projects api-keys --project-ref ${ref} --reveal --output json`], { windowsVerbatimArguments: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }); }
  catch { throw new Error('Staging credential retrieval failed (output suppressed)'); }
  let parsed = JSON.parse(raw); raw = null;
  for (const item of (Array.isArray(parsed) ? parsed : parsed.keys)) for (const k of ['api_key', 'apiKey', 'key', 'value']) {
    const v = item[k]; if (v?.startsWith('sb_secret_')) secret = v; if (v?.startsWith('sb_publishable_')) pub = v;
  }
  parsed = null;
  if (!secret || !pub) throw new Error('Existing staging keys missing');
  if (!cleanupOnly) {
  await admin('/rest/v1/workshops', 'POST', { id: wid, name: prefix, schema_version: 'QC-GATE0', sync_source: prefix });
  for (const [who, role] of Object.entries({ director: 'directeur', qc: 'controle_qualite', otherQc: 'controle_qualite', chief: 'chef_atelier', tech: 'technicien', reception: 'reception' })) {
    const password = `Nimr!${randomUUID()}Aa9#`, email = `${prefix}-${who}@example.test`.toLowerCase();
    const created = await admin('/auth/v1/admin/users', 'POST', { email, password, email_confirm: true, app_metadata: { synthetic_gate: 'QC-GATE0', fixture: prefix } });
    users[who] = { id: created.id };
    const member = { workshop_id: wid, user_id: created.id, role, sync_source: prefix };
    if (['qc', 'otherQc', 'chief', 'tech'].includes(who)) {
      const type = who === 'tech' ? 'mecanicien' : 'controle';
      const resource = { id: randomUUID(), workshop_id: wid, local_id: `${prefix}-${who}`, name: `${prefix}-${who}`, type, category: type === 'controle' ? 'controle' : 'mecanique', kind: 'internal', site: 'internal', active: true, compatible_roles: [type], sync_source: prefix };
      await admin('/rest/v1/planning_resources', 'POST', resource); resources[who] = resource; member.resource_id = resource.id;
    }
    await admin('/rest/v1/workshop_members', 'POST', member);
    const login = must(await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } }), 'real login');
    users[who].token = login.access_token;
    const identity = must(await request('/auth/v1/user', { actor: who }), 'verify real identity');
    if (identity.id !== created.id) throw new Error('Identity mismatch');
  }
  record('real_authenticated_users', true, { count: Object.keys(users).length });
  const id = await seedCase('e2e');
  const first = await booking(id); must(first.result, 'director assignment');
  record('director_assignment_provenance', (await row('booking', first.bid)).payload.serverAuthority.authorizedBy === users.director.id);
  await denial('anonymous_v3', await review(null, id), ['42501']);
  const without = await review(null, id, 'validated', { noKey: true });
  record('without_api_key', !without.ok && without.status === 401, { http: without.status });
  for (const who of ['director', 'tech', 'reception', 'otherQc', 'chief']) await denial(`v3_denied_${who}`, await review(who, id), ['42501']);
  const wrongCase = await seedCase('wrong-booking');
  await denial('wrong_booking_case', await review('qc', wrongCase), ['23514']);
  const self = await booking(wrongCase, 'chief', 'chief_fallback', 'chief');
  await denial('chief_self_assignment', self.result, ['42501']);
  const fallbackId = await seedCase('fallback');
  must((await booking(fallbackId, 'chief', 'chief_fallback')).result, 'director fallback');
  const fallback = await review('chief', fallbackId, 'rejected');
  record('authorized_chief_fallback_nok', fallback.ok && fallback.data?.accepted === true, { http: fallback.status, code: fallback.data?.code });

  // Probe the public direct-table/legacy paths on separate fixtures, without service credentials.
  const bypassId = await seedCase('bypass');
  const bypassRow = await row('case', bypassId);
  const bypassPayload = structuredClone(bypassRow.payload);
  bypassPayload.flags.qualityApproved = true; bypassPayload.receptionWorkflow.qualityStatus = 'validated';
  const directPath = `/rest/v1/sync_entities?workshop_id=eq.${wid}&entity_type=eq.case&entity_id=eq.${bypassId}`;
  await denial('anonymous_direct_patch', await request(directPath, { method: 'PATCH', body: { payload: bypassPayload } }), ['42501']);
  const bypass = await request(directPath, { actor: 'director', method: 'PATCH', body: { payload: bypassPayload } });
  record('director_cannot_bypass_v3_direct_table', !bypass.ok, { http: bypass.status, code: bypass.data?.code || null, persistedApproved: (await row('case', bypassId)).payload.flags.qualityApproved });

  // Cutover-specific INSERT / UPSERT coverage with a real authenticated Director JWT.
  const prevalidatedId = `${prefix}-new-prevalidated`;
  const prevalidatedPayload = structuredClone(bypassPayload);
  prevalidatedPayload.id = prevalidatedId; prevalidatedPayload.local_id = prevalidatedId; prevalidatedPayload.orNavNumber = prevalidatedId;
  const prevalidatedCreate = await request('/rest/v1/sync_entities', { actor: 'director', method: 'POST', body: {
    workshop_id: wid, entity_type: 'case', entity_id: prevalidatedId, payload: prevalidatedPayload,
    entity_version: 1, last_operation_id: `${prefix}-prevalidated-create`,
  }, extraHeaders: { Prefer: 'return=representation' } });
  record('new_prevalidated_case_denied', !prevalidatedCreate.ok && prevalidatedCreate.data?.code === '42501' && !await row('case', prevalidatedId), {
    http: prevalidatedCreate.status, code: prevalidatedCreate.data?.code || null,
  });

  // Exercise the application's actual INSERT ... ON CONFLICT path.
  const neutralUpsert = await sync('director', 'case', bypassId, bypassRow.payload, bypassRow.entity_version);
  const neutralAfter = await row('case', bypassId);
  record('existing_case_neutral_upsert_allowed', neutralUpsert.ok && neutralAfter.payload.flags.qualityApproved === false, {
    http: neutralUpsert.status, code: neutralUpsert.data?.code || null,
  });

  const forgedUpsertPayload = structuredClone(neutralAfter.payload);
  forgedUpsertPayload.flags.qualityApproved = true; forgedUpsertPayload.receptionWorkflow.qualityStatus = 'validated';
  const forgedUpsert = await request('/rest/v1/sync_entities', { actor: 'director', method: 'POST', body: {
    workshop_id: wid, entity_type: 'case', entity_id: bypassId, payload: forgedUpsertPayload,
    entity_version: neutralAfter.entity_version + 1, last_operation_id: `${prefix}-forged-upsert`,
  }, extraHeaders: { Prefer: 'resolution=merge-duplicates,return=representation' } });
  record('existing_case_forged_qc_upsert_denied', !forgedUpsert.ok && forgedUpsert.data?.code === '42501' && (await row('case', bypassId)).payload.flags.qualityApproved === false, {
    http: forgedUpsert.status, code: forgedUpsert.data?.code || null,
  });

  const tombstoneId = await seedCase('tombstone');
  const tombstoneBefore = await row('case', tombstoneId);
  // Administrative fixture setup only: a business user must not manufacture tombstones.
  await admin(`/rest/v1/sync_entities?workshop_id=eq.${wid}&entity_type=eq.case&entity_id=eq.${tombstoneId}`, 'PATCH', { deleted_at: stamp() });
  const tombstonePayload = structuredClone(tombstoneBefore.payload);
  tombstonePayload.flags.qualityApproved = true; tombstonePayload.receptionWorkflow.qualityStatus = 'validated';
  const tombstoneUpsert = await request('/rest/v1/sync_entities', { actor: 'director', method: 'POST', body: {
    workshop_id: wid, entity_type: 'case', entity_id: tombstoneId, payload: tombstonePayload,
    entity_version: tombstoneBefore.entity_version + 2, last_operation_id: `${prefix}-tombstone-forged`, deleted_at: null,
  }, extraHeaders: { Prefer: 'resolution=merge-duplicates,return=representation' } });
  const tombstoneAfter = await row('case', tombstoneId);
  record('tombstoned_prevalidated_upsert_denied', !tombstoneUpsert.ok && tombstoneUpsert.data?.code === '42501' && !!tombstoneAfter.deleted_at, {
    http: tombstoneUpsert.status, code: tombstoneUpsert.data?.code || null,
  });

  const oldId = await seedCase('legacy');
  const legacy = await request('/rest/v1/rpc/nimr_apply_quality_review_v2', { actor: 'director', method: 'POST', body: { p_workshop_id: wid, p_case_id: oldId, p_quality_status: 'validated', p_reason: '', p_operation_id: `${prefix}-legacy`, p_base_version: 1 } });
  record('legacy_v2_cannot_bypass_v3', !legacy.ok, { http: legacy.status, code: legacy.data?.code || null, persistedApproved: (await row('case', oldId)).payload.flags.qualityApproved });

  const nok = await review('qc', id, 'rejected'); must(nok, 'QC NOK');
  let c = await row('case', id); const reworkId = c.payload.receptionWorkflow.qualityReworkBookingId;
  record('qc_nok_creates_rework', !!reworkId && c.payload.flags.qualityApproved === false);
  let rw = await row('booking', reworkId);
  const start = stamp(), end = new Date(Date.now() + 1800000).toISOString();
  let p = { ...rw.payload, status: 'planned', resourceIds: [resources.tech.local_id], primaryResourceId: resources.tech.local_id, needsScheduling: false, remainingEstimateRequired: false, plannedMinutes: 30, remainingMinutes: 30, start, end, segments: [{ start, end }], plannedSegments: [{ start, end }] };
  must(await sync('chief', 'booking', reworkId, p, rw.entity_version), 'plan rework');
  rw = await row('booking', reworkId);
  must(await sync('tech', 'booking', reworkId, { ...rw.payload, status: 'started', actualStart: stamp(), startedAt: stamp(), startedBy: resources.tech.local_id }, rw.entity_version), 'start rework');
  rw = await row('booking', reworkId);
  must(await sync('tech', 'booking', reworkId, { ...rw.payload, status: 'completed', actualEnd: stamp(), completedAt: stamp(), completedBy: resources.tech.local_id, remainingMinutes: 0 }, rw.entity_version), 'complete rework');
  c = await row('case', id); c.payload.flags.workCompleted = true; c.payload.flags.workStarted = true;
  must(await sync('tech', 'case', id, c.payload, c.entity_version), 'complete case work');
  record('assigned_technician_rework_completed', (await row('booking', reworkId)).payload.status === 'completed');
  const second = await booking(id); must(second.result, 'new QC booking');
  record('new_qc_booking', true, { first: first.bid, second: second.bid });
  const before = await row('case', id);
  const qc2 = await review('qc', id);
  const after = await row('case', id);
  record('qc2_validated', qc2.ok && qc2.data?.accepted === true, { http: qc2.status, code: qc2.data?.code || null, message: qc2.data?.message || null, rolledBack: before.entity_version === after.entity_version });
  if (qc2.ok && qc2.data?.accepted) {
    record('ready_for_delivery', after.payload.flags.qualityApproved === true && !!after.payload.receptionWorkflow.readyForDeliveryAt && after.payload.flags.delivered === false);
    after.payload.flags.delivered = true; after.payload.receptionWorkflow.deliveredAt = stamp();
    const handover = await sync('reception', 'case', id, after.payload, after.entity_version);
  record('physical_handover_delivered_true', handover.ok && (await row('case', id)).payload.flags.delivered === true, { http: handover.status, code: handover.data?.code || null });

    const concurrentId = await seedCase('concurrent');
    must((await booking(concurrentId)).result, 'concurrent QC booking');
    const [attemptA, attemptB] = await Promise.all([review('qc', concurrentId), review('qc', concurrentId)]);
    const concurrentFinal = await row('case', concurrentId);
    const acceptedCount = [attemptA, attemptB].filter(r => r.ok && r.data?.accepted === true).length;
    const history = concurrentFinal.payload.receptionWorkflow?.qualityReviewHistory || [];
    record('concurrent_quality_attempts_single_decision', acceptedCount === 1 && concurrentFinal.payload.flags.qualityApproved === true && history.length === 1, {
      acceptedCount, historyCount: history.length, http: [attemptA.status, attemptB.status], codes: [attemptA.data?.code || null, attemptB.data?.code || null],
    });
  } else {
    // Demonstrate the dependency using the authorized planner, never service_role.
    const bookings = await admin(`/rest/v1/sync_entities?workshop_id=eq.${wid}&entity_type=eq.booking&select=entity_id,payload,entity_version`, 'GET');
    evidence.openQcAtFailure = bookings.filter(b => b.payload.caseId === id && b.payload.key === 'quality').map(b => ({ id: b.entity_id, status: b.payload.status }));
    for (const b of bookings.filter(b => b.payload.caseId === id && b.payload.key === 'quality')) must(await sync('director', 'booking', b.entity_id, { ...b.payload, status: 'completed', completedAt: stamp() }, b.entity_version), 'diagnostic planner completion');
    const retry = await review('qc', id);
    record('diagnostic_qc2_after_planner_closes_qc', retry.ok && retry.data?.accepted === true, { http: retry.status, code: retry.data?.code || null, message: retry.data?.message || null });
  }
  }
} catch (error) {
  // Only our controlled labels escape; no Error objects with response/config fields.
  record('harness_execution', false, { error: error.message?.replace(/(?:sb_(?:secret|publishable)_|eyJ)[A-Za-z0-9_.-]+/g, '[REDACTED]').slice(0, 300) });
} finally {
  if (secret) {
    let clean = true;
    for (const [who, u] of Object.entries(users)) {
      if (u.token) { const r = await request('/auth/v1/logout?scope=global', { actor: who, method: 'POST' }).catch(() => ({ ok: false })); clean &&= r.ok; }
    }
    for (const table of ['sync_entity_operation_receipts', 'sync_entity_conflicts', 'sync_entities', 'workshop_members', 'planning_resources']) {
      const r = await request(`/rest/v1/${table}?workshop_id=eq.${wid}`, { admin: true, method: 'DELETE' }).catch(() => ({ ok: false }));
      clean &&= r.ok;
      record(`cleanup_delete_${table}`, r.ok, { http: r.status, code: r.data?.code || null });
    }
    const deletion = await request(`/rest/v1/workshops?id=eq.${wid}`, { admin: true, method: 'DELETE' }).catch(() => ({ ok: false })); clean &&= deletion.ok;
    for (const u of Object.values(users)) {
      const r = await request(`/auth/v1/admin/users/${u.id}`, { admin: true, method: 'DELETE' }).catch(() => ({ ok: false })); clean &&= r.ok || r.status === 404;
      const check = await request(`/auth/v1/admin/users/${u.id}`, { admin: true }).catch(() => ({ status: 0 })); clean &&= check.status === 404;
      u.token = null;
    }
    for (const table of ['workshops', 'sync_entities', 'workshop_members', 'planning_resources', 'sync_entity_operation_receipts']) {
      const r = await request(`/rest/v1/${table}?${table === 'workshops' ? 'id' : 'workshop_id'}=eq.${wid}&select=*`, { admin: true }).catch(() => ({ ok: false }));
      clean &&= r.ok && Array.isArray(r.data) && r.data.length === 0;
    }
    // Audit events intentionally have no cascading workshop FK or client DELETE API.
    // Administrative cleanup is limited to this run's UUID, never the global audit log.
    try {
      const query = `with deleted as (delete from public.security_audit_events where workshop_id='${wid}' returning 1) select count(*) as deleted_rows from deleted`;
      const out = execFileSync('cmd.exe', ['/d', '/s', '/c', `npx.cmd --yes supabase@2.118.0 db query --project-ref ${ref} --linked "${query}" --output json`], { windowsVerbatimArguments: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
      const result = JSON.parse(out);
      const count = result.rows?.[0]?.deleted_rows;
      clean &&= Number.isInteger(count);
      record('cleanup_test_audit_events', Number.isInteger(count), { deletedRows: count });
      const verifyQuery = `select count(*) as remaining from public.security_audit_events where workshop_id='${wid}'`;
      const verified = JSON.parse(execFileSync('cmd.exe', ['/d', '/s', '/c', `npx.cmd --yes supabase@2.118.0 db query --project-ref ${ref} --linked "${verifyQuery}" --output json`], { windowsVerbatimArguments: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }));
      clean &&= verified.rows?.[0]?.remaining === 0;
    } catch { clean = false; record('cleanup_test_audit_events', false); }
    record('cleanup_verified', clean);
  }
  secret = null; pub = null;
  evidence.authUsers = Object.entries(users).map(([actor, u]) => ({ actor, id: u.id }));
  evidence.pass = evidence.checks.length > 0 && evidence.checks.every(c => c.pass);
  writeFileSync(cleanupOnly ? '.nimr-ai/staging-gate0-cleanup.json' : '.nimr-ai/staging-gate0-runtime.json', JSON.stringify(evidence, null, 2));
  process.exitCode = evidence.pass ? 0 : 1;
}
