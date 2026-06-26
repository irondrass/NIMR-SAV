import { describe, it, expect, beforeEach } from 'vitest';
import { hasPermission } from '../src/domain/action-permissions';
import { savCaseStore } from '../src/state/sav-case-store';
import { SavCase } from '../src/domain/sav-case';

describe('Claims Reception and Governance Integration', () => {
  const caseId = 'case-reception-test';
  const baseCase: SavCase = {
    id: caseId,
    immatriculation: 'ZZ-999-ZZ',
    vin: 'VIN99999999999999',
    clientName: 'Jean Dupont',
    telephone: '0700000000',
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    savCaseStore.clearAll();
    savCaseStore.addCase({ ...baseCase });
  });

  it('checks claims permission matrix', () => {
    // Reception can manage and approve claims
    expect(hasPermission('reception', 'manage_claims')).toBe(true);
    expect(hasPermission('reception', 'approve_claim_expert')).toBe(true);
    expect(hasPermission('reception', 'approve_claim_client')).toBe(true);

    // Chef atelier can manage claims but not approve them
    expect(hasPermission('chef-atelier', 'manage_claims')).toBe(true);
    expect(hasPermission('chef-atelier', 'approve_claim_expert')).toBe(false);
    expect(hasPermission('chef-atelier', 'approve_claim_client')).toBe(false);

    // Read-only cannot manage or approve
    expect(hasPermission('lecture-seule', 'manage_claims')).toBe(false);
    expect(hasPermission('lecture-seule', 'approve_claim_expert')).toBe(false);
    expect(hasPermission('lecture-seule', 'approve_claim_client')).toBe(false);

    // Director cannot manage or approve
    expect(hasPermission('directeur-sav', 'manage_claims')).toBe(false);
    expect(hasPermission('directeur-sav', 'approve_claim_expert')).toBe(false);
    expect(hasPermission('directeur-sav', 'approve_claim_client')).toBe(false);
  });

  it('creates and updates claim in the store', () => {
    const actor = { id: 'rep-1', role: 'reception' as const };
    const claimPayload = {
      label: 'Sinistre pare-brise',
      claimType: 'insurance',
      payerType: 'assurance',
      estimatedAmount: 850,
      description: 'Impact gravier sur autoroute',
    };

    // Add claim
    savCaseStore.addClaim(caseId, claimPayload, actor);

    let c = savCaseStore.getCases().find(x => x.id === caseId);
    expect(c?.claims).toHaveLength(1);
    const claim = c!.claims![0];
    expect(claim.label).toBe('Sinistre pare-brise');
    expect(claim.estimatedAmount).toBe(850);
    expect(claim.expertApproved).toBe(false);
    expect(claim.clientApproved).toBe(false);

    // Update claim
    savCaseStore.updateClaim(caseId, claim.id, { estimatedAmount: 900 }, actor);
    c = savCaseStore.getCases().find(x => x.id === caseId);
    expect(c!.claims![0].estimatedAmount).toBe(900);
  });

  it('performs expert and client approvals through store actions', () => {
    const actor = { id: 'rep-1', role: 'reception' as const };
    savCaseStore.addClaim(caseId, { label: 'Sinistre A', claimType: 'insurance' }, actor);

    let c = savCaseStore.getCases().find(x => x.id === caseId);
    const claimId = c!.claims![0].id;

    // Expert approval
    savCaseStore.approveClaimExpert(caseId, claimId, 'Expert Auto A', actor);
    c = savCaseStore.getCases().find(x => x.id === caseId);
    let updatedClaim = c!.claims![0];
    expect(updatedClaim.expertApproved).toBe(true);
    expect(updatedClaim.expertName).toBe('Expert Auto A');
    expect(updatedClaim.expertApprovalAt).toBeDefined();

    // Client approval
    savCaseStore.approveClaimClient(caseId, claimId, 'ACCORD-CLIENT-555', actor);
    c = savCaseStore.getCases().find(x => x.id === caseId);
    updatedClaim = c!.claims![0];
    expect(updatedClaim.clientApproved).toBe(true);
    expect(updatedClaim.clientApprovalReference).toBe('ACCORD-CLIENT-555');
    expect(updatedClaim.clientApprovalAt).toBeDefined();

    // Status must be approved now
    expect(updatedClaim.status).toBe('approved');
  });

  it('rejects and cancels claim', () => {
    const actor = { id: 'rep-1', role: 'reception' as const };
    savCaseStore.addClaim(caseId, { label: 'Sinistre B', claimType: 'insurance' }, actor);

    let c = savCaseStore.getCases().find(x => x.id === caseId);
    const claimId = c!.claims![0].id;

    // Reject claim
    savCaseStore.rejectClaim(caseId, claimId, 'Sinistre non couvert par assurance', actor);
    c = savCaseStore.getCases().find(x => x.id === caseId);
    let updatedClaim = c!.claims![0];
    expect(updatedClaim.status).toBe('rejected');
    expect(updatedClaim.notes).toContain('Sinistre non couvert');

    // Cancel claim
    savCaseStore.cancelClaim(caseId, claimId, actor);
    c = savCaseStore.getCases().find(x => x.id === caseId);
    updatedClaim = c!.claims![0];
    expect(updatedClaim.status).toBe('cancelled');
  });

  it('strictly enforces claim validation permissions for other roles', () => {
    // 1. Chef Atelier cannot approve expert or client
    const chefActor = { id: 'chef-1', role: 'chef-atelier' as const };
    savCaseStore.addClaim(caseId, { label: 'Sinistre X', claimType: 'insurance' }, { id: 'rep-1', role: 'reception' });
    const c = savCaseStore.getCases().find(x => x.id === caseId);
    const claimId = c!.claims![0].id;

    expect(() => {
      savCaseStore.approveClaimExpert(caseId, claimId, 'Expert X', chefActor);
    }).toThrow(/is not permitted to approve claims as expert/);

    expect(() => {
      savCaseStore.approveClaimClient(caseId, claimId, 'REF-X', chefActor);
    }).toThrow(/is not permitted to approve claims as client/);

    // 2. Directeur SAV cannot modify/manage claims or approve them
    const directorActor = { id: 'dir-1', role: 'directeur-sav' as const };
    expect(() => {
      savCaseStore.addClaim(caseId, { label: 'Sinistre Y', claimType: 'insurance' }, directorActor);
    }).toThrow(/is not permitted to manage claims/);

    expect(() => {
      savCaseStore.approveClaimExpert(caseId, claimId, 'Expert Y', directorActor);
    }).toThrow(/is not permitted to approve claims as expert/);

    // 3. Lecture-seule cannot modify/manage claims or approve them
    const readonlyActor = { id: 'ro-1', role: 'lecture-seule' as const };
    expect(() => {
      savCaseStore.addClaim(caseId, { label: 'Sinistre Z', claimType: 'insurance' }, readonlyActor);
    }).toThrow(/is not permitted to manage claims/);

    expect(() => {
      savCaseStore.approveClaimExpert(caseId, claimId, 'Expert Z', readonlyActor);
    }).toThrow(/is not permitted to approve claims as expert/);
  });
});
