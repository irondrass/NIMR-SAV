import assert from 'node:assert/strict';
import { runMobileCdpTest, technicianFixtureExpression, SIMULATED_DEVICE_PROFILES } from './helpers/mobile_browser_harness.mjs';

const { result, errors } = await runMobileCdpTest({
  name: 'technician-membership-resource-link',
  cdpPort: Number(process.env.NIMR_TECHNICIAN_LINK_CDP_PORT || 9347),
  run: async ({ navigate, evaluate, applyProfile }) => {
    await applyProfile(SIMULATED_DEVICE_PROFILES.find(p => p.name.includes('Android 360')));
    await navigate('?technician-resource-link-test=1');
    await evaluate(technicianFixtureExpression({ role: 'technicien', started: true }));
    const linked = await evaluate(`(async () => {
      const serverId = '028a316b-a392-44b6-99c7-e5ef875c09b8';
      const workshopId = getSupabaseWorkshopId();
      const auth = { id: 'auth-mobile-tech', email: 'technician@example.test' };
      const member = { user_id: auth.id, workshop_id: workshopId, role: 'technicien', resource_id: serverId };
      getSupabaseClient = () => ({ from(table) { return {
        select() { return this; }, eq() { return this; },
        async maybeSingle() { return { error: null, data: table === 'workshop_members' ? member : {
          id: serverId, workshop_id: workshopId, local_id: 'tech-mobile', type: 'mecanicien', active: true, deleted_at: null
        } }; }
      }; } });
      getCurrentUser().resourceId = serverId;
      renderTechnicianDashboard();
      const before = document.querySelector('#technician-field-focus').textContent.includes('Compte technicien à rattacher');
      const resolved = await resolveSupabaseWorkshopMembership(auth);
      if (!resolved.ok) throw new Error(resolved.message);
      const synced = syncLocalUserFromSupabaseMembership(auth, resolved.membership);
      if (!synced.ok) throw new Error(synced.message);
      setAccountAccessRuntimeContext(auth, resolved.membership);
      state.users = normalizeUsers(state.users, state.resources);
      renderTechnicianDashboard();
      return {
        before,
        resourceId: getCurrentUser().resourceId,
        options: [...document.querySelector('#technician-select').options].map(o => o.value),
        currentTask: document.querySelector('[data-technician-current-task]')?.dataset.currentBookingId,
        missingLink: document.querySelector('#technician-field-focus').textContent.includes('Compte technicien à rattacher'),
        access: getAccountAccessSnapshot().technicianResourceStatus,
        ownTaskAllowed: canActOnTechnicianTask(getCurrentUser(), state.bookings[0]),
        otherTaskAllowed: canActOnTechnicianTask(getCurrentUser(), { resourceIds: ['another-technician'] }),
      };
    })()`);
    assert.equal(linked.before, true, 'the browser reproduces the original UUID/local-ID mismatch');
    assert.equal(linked.resourceId, 'tech-mobile');
    assert.deepEqual(linked.options, ['tech-mobile']);
    assert.equal(linked.currentTask, 'booking-mobile-current');
    assert.equal(linked.missingLink, false);
    assert.equal(linked.access, 'valid');
    assert.equal(linked.ownTaskAllowed, true);
    assert.equal(linked.otherTaskAllowed, false);
    return linked;
  },
});
assert.deepEqual(errors, []);
console.log('TECHNICIAN RESOURCE LINK BROWSER PASS (isolated fixture, no live data)', JSON.stringify(result));
