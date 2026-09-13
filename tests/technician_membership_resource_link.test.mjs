import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { createNimrVmContext } from './helpers/nimr_vm_context.mjs';

const WORKSHOP = '00000000-0000-0000-0000-000000000001';
const RESOURCE = '028a316b-a392-44b6-99c7-e5ef875c09b8';
const AUTH = { id: '11111111-1111-4111-8111-111111111111', email: 'technician@example.test' };
const resourceRow = { id: RESOURCE, workshop_id: WORKSHOP, local_id: 'tolier-2', type: 'tolier', active: true, deleted_at: null };
const memberRow = { user_id: AUTH.id, workshop_id: WORKSHOP, role: 'technicien', resource_id: RESOURCE };

function harness({ member = memberRow, resource = resourceRow, resourceError = null } = {}) {
  const h = createNimrVmContext();
  vm.runInContext(fs.readFileSync(new URL('../js/supabase-client.js', import.meta.url), 'utf8'), h.context);
  const queries = [];
  h.context.getSupabaseClient = () => ({
    from(table) {
      const query = { table, filters: [] };
      queries.push(query);
      return {
        select(columns) { query.columns = columns; return this; },
        eq(column, value) { query.filters.push([column, value]); return this; },
        async maybeSingle() {
          assert.ok(['workshop_members', 'planning_resources'].includes(table));
          return table === 'workshop_members' ? { data: member, error: null } : { data: resource, error: resourceError };
        },
      };
    },
  });
  h.run(`state.resources = [
    { id: 'tolier-1', name: 'Tôlier 1', role: 'tolier', active: true },
    { id: 'tolier-2', name: 'Tôlier 2', role: 'tolier', active: true }
  ]; state.users = []; state.currentUserId = '';`);
  return { ...h, queries };
}

test('server UUID resolves to planning local_id, survives normalization and authorizes only assigned bookings', async () => {
  const h = harness();
  const resolved = await h.context.resolveSupabaseWorkshopMembership(AUTH);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.membership.resource_id, RESOURCE);
  assert.equal(resolved.membership.resource_local_id, 'tolier-2');
  const resourceQuery = h.queries.find(q => q.table === 'planning_resources');
  assert.ok(resourceQuery, 'read the authoritative resource row');
  assert.ok(resourceQuery.filters.some(([k, v]) => k === 'id' && v === RESOURCE));
  assert.ok(resourceQuery.filters.some(([k, v]) => k === 'workshop_id' && v === WORKSHOP));

  const synced = h.context.syncLocalUserFromSupabaseMembership(AUTH, resolved.membership);
  assert.equal(synced.ok, true);
  assert.equal(synced.user.resourceId, 'tolier-2');
  h.context.setAccountAccessRuntimeContext(AUTH, resolved.membership);
  h.run('state.users = normalizeUsers(JSON.parse(JSON.stringify(state.users)), state.resources);');
  const current = h.context.getCurrentUser();
  assert.equal(current.resourceId, 'tolier-2');
  assert.equal(h.context.canActOnTechnicianTask(current, { resourceIds: ['tolier-2'] }), true);
  assert.equal(h.context.canActOnTechnicianTask(current, { resourceIds: ['tolier-1'] }), false);
  const access = h.context.getAccountAccessSnapshot();
  assert.equal(access.resource.id, 'tolier-2');
  assert.equal(access.resourceParity, 'pass');
  assert.equal(access.technicianResourceStatus, 'valid');
  assert.equal(access.overallStatus, 'active');
});

test('reconnecting replaces a stale cached resource using the server mapping', async () => {
  const h = harness();
  h.context.seedUser = { id: 'cached-tech', authUserId: AUTH.id, name: 'Technicien', role: 'technicien', resourceId: 'tolier-1', active: true };
  h.run('state.users = [seedUser]; state.currentUserId = seedUser.id;');
  const resolved = await h.context.resolveSupabaseWorkshopMembership(AUTH);
  const synced = h.context.syncLocalUserFromSupabaseMembership(AUTH, resolved.membership);
  assert.equal(synced.user.id, 'cached-tech');
  assert.equal(synced.user.resourceId, 'tolier-2');
  assert.equal(h.context.canActOnTechnicianTask(synced.user, { resourceIds: ['tolier-1'] }), false);
});

for (const [name, row] of [
  ['missing row', null],
  ['other workshop', { ...resourceRow, workshop_id: 'another-workshop' }],
  ['other server resource', { ...resourceRow, id: 'another-resource' }],
  ['inactive person', { ...resourceRow, active: false }],
  ['deleted person', { ...resourceRow, deleted_at: '2026-09-01T00:00:00Z' }],
  ['equipment', { ...resourceRow, type: 'cabine' }],
  ['missing local mapping', { ...resourceRow, local_id: null }],
]) {
  test(`${name} never falls back to a cached technician or an identically named person`, async () => {
    const h = harness({ resource: row });
    const resolved = await h.context.resolveSupabaseWorkshopMembership(AUTH);
    assert.equal(resolved.ok, true, 'an authorized member can still see an explanatory empty workspace');
    assert.equal(resolved.membership.resource_local_id, '');
    const synced = h.context.syncLocalUserFromSupabaseMembership(AUTH, resolved.membership);
    assert.equal(synced.user.resourceId, '');
    assert.equal(h.context.canActOnTechnicianTask(synced.user, { resourceIds: ['tolier-2'] }), false);
    h.context.setAccountAccessRuntimeContext(AUTH, resolved.membership);
    assert.notEqual(h.context.getAccountAccessSnapshot().technicianResourceStatus, 'valid');
  });
}

test('a resource read error cannot grant access using the old profile', async () => {
  const h = harness({ resource: null, resourceError: { message: 'read denied' } });
  const result = await h.context.resolveSupabaseWorkshopMembership(AUTH);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'RESOURCE_LOOKUP_FAILED');
});

test('a technician without a server link stays unlinked and does not query resources', async () => {
  const h = harness({ member: { ...memberRow, resource_id: null } });
  const result = await h.context.resolveSupabaseWorkshopMembership(AUTH);
  assert.equal(result.ok, true);
  assert.equal(result.membership.resource_local_id, '');
  assert.equal(h.queries.length, 1);
  const synced = h.context.syncLocalUserFromSupabaseMembership(AUTH, result.membership);
  assert.equal(synced.user.resourceId, '');
});

test('all ten other canonical roles retain access without requiring a technician link', async () => {
  for (const role of ['admin_technique', 'directeur', 'chef_atelier', 'reception', 'controle_qualite', 'lecture_seule', 'directeur_pieces', 'responsable_magasin', 'responsable_garantie_support', 'responsable_qualite_parc_vn']) {
    const h = harness({ member: { ...memberRow, role, resource_id: null } });
    const result = await h.context.resolveSupabaseWorkshopMembership(AUTH);
    assert.equal(result.ok, true, role);
    const synced = h.context.syncLocalUserFromSupabaseMembership(AUTH, result.membership);
    assert.equal(synced.user.role, role);
    assert.equal(synced.user.resourceId, '');
    assert.equal(h.queries.length, 1, `${role}: no unnecessary resource query`);
  }
});

test('mapping never bypasses membership identity and workshop validation', async () => {
  for (const member of [{ ...memberRow, user_id: 'other-user' }, { ...memberRow, workshop_id: 'other-workshop' }]) {
    const h = harness({ member });
    const result = await h.context.resolveSupabaseWorkshopMembership(AUTH);
    assert.equal(result.ok, false);
    assert.equal(h.run('state.users.length'), 0);
  }
});
