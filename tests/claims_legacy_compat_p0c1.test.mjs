import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createNimrVmContext } from './helpers/nimr_vm_context.mjs';

function vmFixture() {
  return createNimrVmContext({ filename: 'p0c1-state.js' });
}

test('P0c.1 v23 maps v24 rejected to refused without losing the source status', () => {
  const vm = vmFixture();
  const result = vm.run("normalizeRepairClaim({id:'c1',type:'garantie',status:'rejected'})");
  assert.equal(result.status, 'refused');
  assert.equal(result.legacyCompatibility?.sourceStatus, 'rejected');
  assert.equal(result.legacyCompatibility?.blocked, false);
});

test('P0c.1 v23 preserves planned/done exactly as valid legacy statuses', () => {
  const vm = vmFixture();
  assert.equal(vm.run("normalizeRepairClaim({status:'planned'}).status"), 'planned');
  assert.equal(vm.run("normalizeRepairClaim({status:'done'}).status"), 'done');
});

test('P0c.1 v23 never silently turns unsupported modern statuses into a writable draft', () => {
  const vm = vmFixture();
  for (const status of ['cancelled', 'estimate_pending', 'future_oem_state']) {
    vm.context.testStatus = status;
    const result = vm.run("normalizeRepairClaim({id:'c2',type:'garantie',status:testStatus})");
    assert.equal(result.status, 'draft');
    assert.equal(result.legacyCompatibility?.blocked, true);
    assert.equal(result.legacyCompatibility?.sourceStatus, status);
    assert.match(result.legacyCompatibility?.reason || '', /incompatible|non pris en charge/i);
  }
});

test('P0c.1 compatibility block survives JSON normalization cycles', () => {
  const vm = vmFixture();
  const first = vm.run("normalizeRepairClaim({id:'c3',type:'garantie',status:'cancelled'})");
  vm.context.serializedClaim = JSON.stringify(first);
  const second = vm.run("normalizeRepairClaim(JSON.parse(serializedClaim))");
  assert.equal(second.legacyCompatibility?.blocked, true);
  assert.equal(second.legacyCompatibility?.sourceStatus, 'cancelled');
});

test('P0c.1 unsupported modern claim types are fail-closed for legacy sync', () => {
  const vm = vmFixture();
  for (const type of ['internal', 'mixed', 'future_type']) {
    vm.context.testType = type;
    const claim = vm.run("normalizeRepairClaim({id:'c4',type:testType,status:'draft'})");
    vm.context.testClaim = claim;
    assert.equal(claim.legacyCompatibility?.blocked, true);
    assert.equal(claim.legacyCompatibility?.sourceType, type);
    assert.throws(
      () => vm.run("assertLegacyClaimSyncCompatible(testClaim)"),
      /incompatible|non pris en charge/i,
    );
  }
});

test('P0c.1 mapped/legacy claims remain sync-compatible', () => {
  const vm = vmFixture();
  for (const candidate of [
    { type: 'assurance', status: 'approved' },
    { type: 'garantie', status: 'refused' },
    { type: 'client', status: 'planned' },
    { type: 'diagnostic', status: 'done' },
    { type: 'garantie', status: 'rejected' },
  ]) {
    vm.context.testCandidate = candidate;
    vm.context.testClaim = vm.run("normalizeRepairClaim(testCandidate)");
    assert.doesNotThrow(() => vm.run("assertLegacyClaimSyncCompatible(testClaim)"));
  }
});

test('P0c.1 incompatible legacy claims cannot authorize workshop work locally', () => {
  const vm = vmFixture();
  vm.context.testClaim = vm.run("normalizeRepairClaim({id:'c5',type:'garantie',status:'cancelled',clientApproved:true,authorizationReference:'REF'})");
  vm.context.testItem = { claims: [vm.context.testClaim] };
  assert.equal(vm.run("hasWorkAuthorizationEvidence(testClaim)"), false);
  const issues = vm.run("getWorkAuthorizationIssues(testItem)");
  assert.equal(issues.length, 1);
  assert.match(issues[0], /incompatible|non pris en charge/i);
});

test('P0c.1 supabase claim projection invokes the compatibility guard before row creation', () => {
  const source = fs.readFileSync(new URL('../js/supabase-sync.js', import.meta.url), 'utf8');
  const guardIndex = source.indexOf('assertLegacyClaimSyncCompatible(claim)');
  const rowIndex = source.indexOf('claimRows.push({', guardIndex);
  assert.ok(guardIndex >= 0, 'legacy compatibility guard must be wired into supabase sync');
  assert.ok(rowIndex > guardIndex, 'guard must execute before repair_claims row creation');
});

test('P0c.1 compatible mapping metadata is not sticky after a legitimate legacy edit', () => {
  const vm = vmFixture();
  const imported = vm.run("normalizeRepairClaim({id:'c6',type:'insurance',status:'rejected'})");
  assert.equal(imported.type, 'assurance');
  assert.equal(imported.status, 'refused');
  assert.equal(imported.legacyCompatibility?.blocked, false);

  imported.type = 'garantie';
  imported.status = 'approved';
  vm.context.editedClaim = imported;
  const edited = vm.run("normalizeRepairClaim(editedClaim)");

  assert.equal(edited.type, 'garantie');
  assert.equal(edited.status, 'approved');
  assert.equal(edited.legacyCompatibility, undefined);
});
