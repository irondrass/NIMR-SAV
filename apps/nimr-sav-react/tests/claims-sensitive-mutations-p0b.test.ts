import { beforeEach, describe, expect, it } from 'vitest';
import { savCaseStore } from '../src/state/sav-case-store';
import { createOfflineAction, validateOfflineAction } from '../src/domain/offline-queue';
import { SavCase } from '../src/domain/sav-case';

describe('KHA-76 P0b — protected claim mutations', () => {
  const caseId = 'case-p0b';
  const reception = { id: 'rep-p0b', role: 'reception' as const };
  const chef = { id: 'chef-p0b', role: 'chef-atelier' as const };
  const admin = { id: 'admin-p0b', role: 'admin' as const };

  const baseCase: SavCase = {
    id: caseId,
    immatriculation: 'P0B-001',
    vin: 'VINP0B00000000001',
    clientName: 'Client P0b',
    telephone: '20000000',
    status: 'received',
    receptionDate: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    savCaseStore.clearAll();
    savCaseStore.addCase({ ...baseCase });
  });

  function firstClaim() {
    const claim = savCaseStore.getCases().find((c) => c.id === caseId)?.claims?.[0];
    if (!claim) throw new Error('Expected a claim fixture.');
    return claim;
  }

  function addWarrantyClaim() {
    savCaseStore.addClaim(caseId, {
      label: 'Garantie P0b',
      claimType: 'warranty',
      description: 'Diagnostic',
    }, reception);
    return firstClaim();
  }

  it('T02 create: generic addClaim rejects a caller-supplied approved status', () => {
    expect(() => savCaseStore.addClaim(caseId, {
      label: 'Garantie forgée',
      claimType: 'warranty',
      status: 'approved',
    }, reception)).toThrow(/champ.*protégé|mutation.*protégée|status/i);

    expect(savCaseStore.getCases().find((c) => c.id === caseId)?.claims ?? []).toHaveLength(0);
  });

  it('T02 create: generic addClaim rejects caller-supplied approval flags', () => {
    expect(() => savCaseStore.addClaim(caseId, {
      label: 'Assurance forgée',
      claimType: 'insurance',
      expertApproved: true,
      clientApproved: true,
    }, reception)).toThrow(/champ.*protégé|mutation.*protégée|approb/i);

    expect(savCaseStore.getCases().find((c) => c.id === caseId)?.claims ?? []).toHaveLength(0);
  });

  it('T02 create: safe warranty creation starts unapproved', () => {
    const claim = addWarrantyClaim();
    expect(claim.status).toBe('draft');
    expect(claim.expertApproved).toBe(false);
    expect(claim.clientApproved).toBe(false);
  });

  it('T02 update: generic updateClaim rejects direct status changes for chef, reception and admin', () => {
    const claim = addWarrantyClaim();
    const beforeLogs = savCaseStore.getLogs().length;

    for (const actor of [chef, reception, admin]) {
      expect(() => savCaseStore.updateClaim(caseId, claim.id, { status: 'approved' }, actor))
        .toThrow(/champ.*protégé|mutation.*protégée|status/i);
    }

    const current = savCaseStore.getCases().find((c) => c.id === caseId)?.claims?.[0];
    expect(current?.status).toBe('draft');
    expect(savCaseStore.getLogs().length).toBe(beforeLogs);
  });

  it('T03 update: generic updateClaim rejects direct expert/client approval fields', () => {
    savCaseStore.addClaim(caseId, { label: 'Assurance', claimType: 'insurance' }, reception);
    const claim = firstClaim();

    expect(() => savCaseStore.updateClaim(caseId, claim.id, {
      expertApproved: true,
      expertName: 'Expert forgé',
      clientApproved: true,
      clientApprovalReference: 'FORGED',
    }, chef)).toThrow(/champ.*protégé|mutation.*protégée|approb/i);

    const current = savCaseStore.getCases().find((c) => c.id === caseId)?.claims?.[0];
    expect(current?.expertApproved).toBe(false);
    expect(current?.clientApproved).toBe(false);
  });

  it('T03 specialized: reception can still approve expert and client through dedicated commands', () => {
    savCaseStore.addClaim(caseId, { label: 'Assurance', claimType: 'insurance' }, reception);
    const claim = firstClaim();

    expect(() => savCaseStore.approveClaimExpert(caseId, claim.id, 'Expert A', chef)).toThrow();
    expect(() => savCaseStore.approveClaimClient(caseId, claim.id, 'REF-A', chef)).toThrow();

    savCaseStore.approveClaimExpert(caseId, claim.id, 'Expert A', reception);
    savCaseStore.approveClaimClient(caseId, claim.id, 'REF-A', reception);

    const current = savCaseStore.getCases().find((c) => c.id === caseId)?.claims?.[0];
    expect(current?.expertApproved).toBe(true);
    expect(current?.clientApproved).toBe(true);
    expect(current?.status).toBe('approved');
  });

  it('T02 specialized: internal approval uses a dedicated command, never generic updateClaim', () => {
    for (const claimType of ['warranty', 'internal', 'mixed'] as const) {
      savCaseStore.clearAll();
      savCaseStore.addCase({ ...baseCase });
      savCaseStore.addClaim(caseId, { label: claimType, claimType }, reception);
      const claim = firstClaim();

      expect(() => savCaseStore.approveClaimInternal(caseId, claim.id, chef)).toThrow();
      savCaseStore.approveClaimInternal(caseId, claim.id, reception);

      const current = savCaseStore.getCases().find((c) => c.id === caseId)?.claims?.[0];
      expect(current?.status).toBe('approved');
    }
  });

  it('T02 admin: generic sensitive mutation stays forbidden; admin must use a dedicated command', () => {
    const claim = addWarrantyClaim();
    expect(() => savCaseStore.updateClaim(caseId, claim.id, { status: 'approved' }, admin)).toThrow();
    savCaseStore.approveClaimInternal(caseId, claim.id, admin);
    expect(savCaseStore.getCases().find((c) => c.id === caseId)?.claims?.[0]?.status).toBe('approved');
  });

  it('T02 import/replay: offline add_claim rejects protected status/approval payloads', () => {
    const action = createOfflineAction('add_claim', {
      caseId,
      claim: {
        label: 'Garantie offline forgée',
        claimType: 'warranty',
        status: 'approved',
        expertApproved: true,
      },
    }, reception);

    const validation = validateOfflineAction(action);
    expect(validation.valid).toBe(false);
    expect(validation.reason).toMatch(/protégé|status|approb/i);
  });

  it('T02 import/replay: offline update_claim rejects protected fields but allows ordinary edits', () => {
    const protectedAction = createOfflineAction('update_claim', {
      caseId,
      claimId: 'claim-1',
      updatedFields: { clientApproved: true },
    }, reception);
    expect(validateOfflineAction(protectedAction).valid).toBe(false);

    const safeAction = createOfflineAction('update_claim', {
      caseId,
      claimId: 'claim-1',
      updatedFields: { estimatedAmount: 1234, description: 'Montant révisé' },
    }, reception);
    expect(validateOfflineAction(safeAction).valid).toBe(true);
  });
});
