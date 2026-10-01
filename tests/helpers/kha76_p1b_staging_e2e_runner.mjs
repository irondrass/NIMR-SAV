// KHA-76 P1B real STAGING E2E: Auth + PostgREST + RLS + RPC + cleanup.
// Run: node tests/helpers/kha76_p1b_staging_e2e_runner.mjs --staging
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

if (!process.argv.includes('--staging')) throw new Error('Explicit --staging required');
const ref = 'ijgstcdptyxjzgqlvooc';
const prodRef = 'mkecnwolvzgxltrasbmr';
if (ref === prodRef) throw new Error('PROD project is forbidden');
const base = `https://${ref}.supabase.co`;
const prefix = `KHA76-P1B-${randomUUID().slice(0, 8)}`;
const wid = randomUUID();
const agencyA = `${prefix.toLowerCase()}-a`;
const agencyB = `${prefix.toLowerCase()}-b`;
const ids = { orA: randomUUID(), orB: randomUUID(), orNone: randomUUID(), hiddenClaim: randomUUID() };
const user = { id: null, token: null };
const evidence = { task: 'KHA-76 P1B STAGING E2E', ref, prefix, workshop: wid, at: new Date().toISOString(), checks: [] };
let secret = null, pub = null, password = null;

const redact = (value = '') => String(value)
  .replace(/(?:sb_(?:secret|publishable)_|eyJ)[A-Za-z0-9_.-]+/g, '[REDACTED]')
  .slice(0, 220);
const record = (name, pass, detail = {}) => {
  const item = { name, pass, ...detail };
  evidence.checks.push(item);
  console.log(JSON.stringify(item));
};
async function request(path, { method = 'GET', body, token = null, admin = false, extraHeaders = {} } = {}) {
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'nimr-kha76-p1b-staging/1.0' };
  headers.apikey = admin ? secret : pub;
  if (token) headers.Authorization = `Bearer ${token}`;
  Object.assign(headers, extraHeaders);
  const response = await fetch(base + path, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch {}
  return { ok: response.ok, status: response.status, data };
}
function must(response, label) {
  if (!response.ok) {
    throw new Error(`${label}: HTTP ${response.status}, code ${response.data?.code || 'unknown'}, message ${redact(response.data?.message)}`);
  }
  return response.data;
}
async function admin(path, method = 'GET', body, extraHeaders = {}) {
  return must(await request(path, { admin: true, method, body, extraHeaders }), `fixture ${method} ${path.split('?')[0]}`);
}
function expectDenied(name, response, code, messagePart = '') {
  const pass = !response.ok
    && String(response.data?.code || '') === String(code)
    && (!messagePart || String(response.data?.message || '').includes(messagePart));
  record(name, pass, { http: response.status, code: response.data?.code || null, message: redact(response.data?.message) });
  return pass;
}
const diagnostic = (suffix = '') => ({
  complaintVerbatim: `Bruit avant intermittent${suffix}`,
  findings: `Jeu constatÃ© sur organe avant${suffix}`,
  suspectedCause: `Usure prÃ©maturÃ©e${suffix}`,
  causalPartReference: 'E2E-PART-A',
  dtc: ['C1234'],
  mileageAtDiagnosis: suffix ? 12346 : 12345,
});

try {
  let raw;
  try {
    raw = execFileSync('cmd.exe', ['/d', '/s', '/c',
      `npx.cmd --yes supabase@2.118.0 projects api-keys --project-ref ${ref} --reveal --output json`],
      { windowsVerbatimArguments: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
  } catch {
    throw new Error('Staging credential retrieval failed (output suppressed)');
  }
  let parsed = JSON.parse(raw); raw = null;
  for (const item of (Array.isArray(parsed) ? parsed : parsed.keys)) {
    for (const key of ['api_key', 'apiKey', 'key', 'value']) {
      const value = item[key];
      if (value?.startsWith('sb_secret_')) secret = value;
      if (value?.startsWith('sb_publishable_')) pub = value;
    }
  }
  parsed = null;
  if (!secret || !pub) throw new Error('Existing STAGING keys missing');
  record('staging_keys_resolved_without_logging', true);

  await admin('/rest/v1/workshops', 'POST', {
    id: wid, name: prefix, schema_version: 'KHA76-P1B-E2E', sync_source: prefix,
  });

  password = `Nimr!${randomUUID()}Aa9#`;
  const email = `${prefix.toLowerCase()}@example.test`;
  const created = await admin('/auth/v1/admin/users', 'POST', {
    email, password, email_confirm: true,
    app_metadata: { synthetic_gate: 'KHA76-P1B', fixture: prefix },
  });
  user.id = created.id;
  const login = must(await request('/auth/v1/token?grant_type=password', {
    method: 'POST', body: { email, password },
  }), 'real agent_agence login');
  user.token = login.access_token;
  const identity = must(await request('/auth/v1/user', { token: user.token }), 'verify real identity');
  record('real_authenticated_agent_identity', identity.id === user.id, { userId: user.id });

  await admin('/rest/v1/warranty_agency_members', 'POST', {
    workshop_id: wid, agency_id: agencyA, user_id: user.id,
    capability: 'agent_agence', active: true, sync_source: prefix,
  });
  await admin('/rest/v1/repair_orders', 'POST', [
    { id: ids.orA, workshop_id: wid, local_id: `${prefix}-or-a`, order_number: `${prefix}-A`, status: 'chief_validation_pending', sync_source: prefix, agency_id: agencyA },
    { id: ids.orB, workshop_id: wid, local_id: `${prefix}-or-b`, order_number: `${prefix}-B`, status: 'chief_validation_pending', sync_source: prefix, agency_id: agencyB },
    { id: ids.orNone, workshop_id: wid, local_id: `${prefix}-or-none`, order_number: `${prefix}-NONE`, status: 'chief_validation_pending', sync_source: prefix, agency_id: null },
  ]);
  await admin('/rest/v1/repair_claims', 'POST', {
    id: ids.hiddenClaim, workshop_id: wid, local_id: `${prefix}-hidden-b`,
    repair_order_id: ids.orB, title: `${prefix} hidden agency B`,
    status: 'draft', include_in_planning: false, type: 'garantie',
    expert_approved: false, client_approved: false, amount: null,
    sync_source: prefix, agency_id: agencyB,
  });
  await admin('/rest/v1/warranty_agency_claim_events', 'POST', {
    workshop_id: wid, agency_id: agencyB, claim_id: ids.hiddenClaim,
    actor_user_id: null, action: 'agency_draft_created', claim_version: 1,
    details: { fixture: 'cross-agency-visibility' },
  });

  const membershipRead = must(await request(
    `/rest/v1/warranty_agency_members?workshop_id=eq.${wid}&select=agency_id,user_id,capability,active`,
    { token: user.token }), 'membership read');
  record('server_authoritative_membership_visible_to_self',
    membershipRead.length === 1 && membershipRead[0].agency_id === agencyA && membershipRead[0].user_id === user.id);

  const selfGrant = await request('/rest/v1/warranty_agency_members', {
    method: 'POST', token: user.token,
    body: { workshop_id: wid, agency_id: agencyB, user_id: user.id, capability: 'agent_agence', active: true },
  });
  expectDenied('membership_self_grant_denied', selfGrant, '42501');

  const idempotencyKey = `${prefix}-idem-001`;
  const createBody = {
    p_workshop_id: wid, p_repair_order_id: ids.orA,
    p_diagnostic: diagnostic(), p_idempotency_key: idempotencyKey,
  };
  const first = must(await request('/rest/v1/rpc/nimr_create_agency_warranty_draft', {
    method: 'POST', token: user.token, body: createBody,
  }), 'create agency draft');
  const claimId = first.id;
  record('same_agency_draft_created',
    first.status === 'draft' && first.version === 1 && first.agency_id === agencyA && first.repair_order_id === ids.orA,
    { claimId, version: first.version });

  const replay = must(await request('/rest/v1/rpc/nimr_create_agency_warranty_draft', {
    method: 'POST', token: user.token, body: createBody,
  }), 'idempotent replay');
  record('idempotent_replay_same_claim',
    replay.id === claimId && replay.idempotent === true && replay.version === 1);

  const updated = must(await request('/rest/v1/rpc/nimr_update_agency_warranty_draft', {
    method: 'POST', token: user.token,
    body: { p_claim_id: claimId, p_expected_version: 1, p_diagnostic: diagnostic(' UPDATED') },
  }), 'update agency diagnostic');
  record('optimistic_version_update_succeeds', updated.id === claimId && updated.version === 2 && updated.status === 'draft');

  const stale = await request('/rest/v1/rpc/nimr_update_agency_warranty_draft', {
    method: 'POST', token: user.token,
    body: { p_claim_id: claimId, p_expected_version: 1, p_diagnostic: diagnostic(' STALE') },
  });
  expectDenied('stale_version_denied', stale, 'PT412', 'P1B_VERSION_CONFLICT');

  const cross = await request('/rest/v1/rpc/nimr_create_agency_warranty_draft', {
    method: 'POST', token: user.token,
    body: { ...createBody, p_repair_order_id: ids.orB, p_idempotency_key: `${prefix}-cross` },
  });
  expectDenied('cross_agency_or_denied', cross, '42501', 'P1B_REPAIR_ORDER_SCOPE_FORBIDDEN');

  const unassigned = await request('/rest/v1/rpc/nimr_create_agency_warranty_draft', {
    method: 'POST', token: user.token,
    body: { ...createBody, p_repair_order_id: ids.orNone, p_idempotency_key: `${prefix}-none` },
  });
  expectDenied('unassigned_or_denied', unassigned, '42501', 'P1B_REPAIR_ORDER_SCOPE_FORBIDDEN');

  for (const [name, extra] of [
    ['status_forge_denied', { status: 'approved' }],
    ['agency_forge_denied', { agencyId: agencyB }],
    ['payment_forge_denied', { payment_status: 'paid' }],
  ]) {
    const forged = await request('/rest/v1/rpc/nimr_update_agency_warranty_draft', {
      method: 'POST', token: user.token,
      body: { p_claim_id: claimId, p_expected_version: 2, p_diagnostic: { ...diagnostic(' FORGE'), ...extra } },
    });
    expectDenied(name, forged, '22023', 'P1B_UNKNOWN_DIAGNOSTIC_FIELD');
  }

  const directInsert = await request('/rest/v1/repair_claims', {
    method: 'POST', token: user.token,
    body: { workshop_id: wid, local_id: `${prefix}-direct`, title: 'DIRECT', type: 'garantie', agency_id: agencyA },
  });
  expectDenied('direct_claim_insert_denied', directInsert, '42501');

  const directUpdate = await request(`/rest/v1/repair_claims?id=eq.${claimId}`, {
    method: 'PATCH', token: user.token, body: { status: 'approved' },
  });
  expectDenied('direct_claim_update_denied', directUpdate, '42501');

  const directDelete = await request(`/rest/v1/repair_claims?id=eq.${claimId}`, {
    method: 'DELETE', token: user.token,
  });
  expectDenied('direct_claim_delete_denied', directDelete, '42501');

  const auditRows = must(await request(
    `/rest/v1/warranty_agency_claim_events?workshop_id=eq.${wid}&select=claim_id,agency_id,action,claim_version&order=created_at.asc`,
    { token: user.token }), 'audit scoped read');
  record('audit_rls_hides_other_agency',
    auditRows.length === 2
      && auditRows.every(row => row.claim_id === claimId && row.agency_id === agencyA)
      && auditRows.map(row => row.action).join(',') === 'agency_draft_created,agency_diagnostic_updated');

  const auditInsert = await request('/rest/v1/warranty_agency_claim_events', {
    method: 'POST', token: user.token,
    body: { workshop_id: wid, agency_id: agencyA, claim_id: claimId, action: 'agency_diagnostic_updated', claim_version: 2 },
  });
  expectDenied('direct_audit_insert_denied', auditInsert, '42501');

  const auditPatch = await request(`/rest/v1/warranty_agency_claim_events?claim_id=eq.${claimId}`, {
    method: 'PATCH', token: user.token, body: { details: { tampered: true } },
  });
  expectDenied('direct_audit_update_denied', auditPatch, '42501');

  const auditDelete = await request(`/rest/v1/warranty_agency_claim_events?claim_id=eq.${claimId}`, {
    method: 'DELETE', token: user.token,
  });
  expectDenied('direct_audit_delete_denied', auditDelete, '42501');

  const hiddenClaim = must(await request(`/rest/v1/repair_claims?id=eq.${ids.hiddenClaim}&select=id`, {
    token: user.token,
  }), 'hidden claim read');
  record('claim_rls_hides_other_agency', Array.isArray(hiddenClaim) && hiddenClaim.length === 0);

  const finalClaimRows = must(await request(
    `/rest/v1/repair_claims?id=eq.${claimId}&select=id,status,type,include_in_planning,expert_approved,client_approved,amount,agency_id,agency_diagnostic_findings,agency_dtc,agency_mileage_at_diagnosis,version`,
    { token: user.token }), 'final claim read');
  const finalClaim = finalClaimRows[0];
  record('no_review_oem_payment_stock_authority_introduced',
    finalClaimRows.length === 1
      && finalClaim.status === 'draft'
      && finalClaim.type === 'garantie'
      && finalClaim.include_in_planning === false
      && finalClaim.expert_approved === false
      && finalClaim.client_approved === false
      && finalClaim.amount === null
      && finalClaim.agency_id === agencyA
      && finalClaim.version === 2);

  const directOrInsert = await request('/rest/v1/repair_orders', {
    method: 'POST', token: user.token,
    body: { workshop_id: wid, local_id: `${prefix}-direct-or`, order_number: `${prefix}-DIRECT`, agency_id: agencyA },
  });
  expectDenied('direct_or_creation_denied_by_rls', directOrInsert, '42501');

  const orTamper = await request(`/rest/v1/repair_orders?id=eq.${ids.orNone}`, {
    method: 'PATCH', token: user.token, body: { agency_id: agencyA },
    extraHeaders: { Prefer: 'return=representation' },
  });
  const orNoneAfter = (await admin(`/rest/v1/repair_orders?id=eq.${ids.orNone}&select=id,agency_id`))[0];
  record('direct_or_agency_reassignment_blocked',
    orNoneAfter.agency_id === null && (!orTamper.ok || !Array.isArray(orTamper.data) || orTamper.data.length === 0),
    { http: orTamper.status, code: orTamper.data?.code || null });

} catch (error) {
  record('harness_execution', false, { error: redact(error?.message || error) });
} finally {
  let clean = Boolean(secret);
  if (secret) {
    if (user.token) {
      const logout = await request('/auth/v1/logout?scope=global', { method: 'POST', token: user.token }).catch(() => ({ ok: false }));
      clean &&= logout.ok;
      record('cleanup_logout', logout.ok, { http: logout.status });
    }
    for (const table of ['warranty_agency_claim_events', 'repair_claims', 'repair_orders', 'warranty_agency_members']) {
      const response = await request(`/rest/v1/${table}?workshop_id=eq.${wid}`, { admin: true, method: 'DELETE' }).catch(() => ({ ok: false }));
      clean &&= response.ok;
      record(`cleanup_delete_${table}`, response.ok, { http: response.status || 0 });
    }
    const workshopDelete = await request(`/rest/v1/workshops?id=eq.${wid}`, { admin: true, method: 'DELETE' }).catch(() => ({ ok: false }));
    clean &&= workshopDelete.ok;
    record('cleanup_delete_workshop', workshopDelete.ok, { http: workshopDelete.status || 0 });

    if (user.id) {
      const userDelete = await request(`/auth/v1/admin/users/${user.id}`, { admin: true, method: 'DELETE' }).catch(() => ({ ok: false }));
      clean &&= userDelete.ok || userDelete.status === 404;
      const userCheck = await request(`/auth/v1/admin/users/${user.id}`, { admin: true }).catch(() => ({ status: 0 }));
      clean &&= userCheck.status === 404;
      record('cleanup_delete_auth_user', (userDelete.ok || userDelete.status === 404) && userCheck.status === 404);
    }

    for (const table of ['workshops', 'warranty_agency_claim_events', 'repair_claims', 'repair_orders', 'warranty_agency_members']) {
      const column = table === 'workshops' ? 'id' : 'workshop_id';
      const rows = await request(`/rest/v1/${table}?${column}=eq.${wid}&select=*`, { admin: true }).catch(() => ({ ok: false, data: null }));
      const zero = rows.ok && Array.isArray(rows.data) && rows.data.length === 0;
      clean &&= zero;
      record(`cleanup_zero_${table}`, zero);
    }
    record('cleanup_verified_zero_residue', clean);
  }
  user.token = null; password = null; secret = null; pub = null;
  evidence.authUserId = user.id;
  evidence.pass = evidence.checks.length > 0 && evidence.checks.every(check => check.pass);
  mkdirSync('.nimr-ai', { recursive: true });
  writeFileSync('.nimr-ai/kha76-p1b-staging-e2e.json', JSON.stringify(evidence, null, 2));
  process.exitCode = evidence.pass ? 0 : 1;
}
