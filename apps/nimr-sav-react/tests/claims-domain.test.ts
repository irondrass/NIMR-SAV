import { describe, it, expect } from 'vitest';
import { APP_VERSION } from '../src/constants/version';
import {
  createDefaultClaim,
  normalizeClaim,
  normalizeClaims,
  isClaimExpertApprovalRequired,
  isClaimClientApprovalRequired,
  isClaimApprovedForPlanning,
  areAllClaimsApprovedForPlanning,
  summarizeClaims,
  getBlockingClaimsReasons,
  approveClaimExpert,
  approveClaimClient,
  rejectClaim,
  cancelClaim,
} from '../src/domain/claims';

describe('Claims Domain and Helpers', () => {
  it('checks version', () => {
    expect(APP_VERSION).toBe('v24.0.0-alpha.18');
  });

  it('creates default claim', () => {
    const claim = createDefaultClaim();
    expect(claim).toBeDefined();
    expect(claim.id).toContain('claim-');
    expect(claim.claimType).toBe('insurance');
    expect(claim.payerType).toBe('assurance');
    expect(claim.expertApproved).toBe(false);
    expect(claim.clientApproved).toBe(false);
    expect(claim.requiredApprovals).toContain('expert');
    expect(claim.requiredApprovals).toContain('client');
  });

  it('normalizes partial claim', () => {
    const claim = normalizeClaim({ label: 'Test customer claim', claimType: 'customer' });
    expect(claim.payerType).toBe('client');
    expect(claim.requiredApprovals).toContain('client');
    expect(claim.requiredApprovals).not.toContain('expert');
  });

  it('normalizes dossier without claim', () => {
    const claims = normalizeClaims(undefined);
    expect(claims).toEqual([]);
    expect(areAllClaimsApprovedForPlanning(claims)).toBe(true);
    expect(getBlockingClaimsReasons(claims)).toEqual([]);
  });

  it('verifies required approvals per type', () => {
    const insuranceClaim = normalizeClaim({ claimType: 'insurance' });
    expect(isClaimExpertApprovalRequired(insuranceClaim)).toBe(true);
    expect(isClaimClientApprovalRequired(insuranceClaim)).toBe(true);

    const customerClaim = normalizeClaim({ claimType: 'customer' });
    expect(isClaimExpertApprovalRequired(customerClaim)).toBe(false);
    expect(isClaimClientApprovalRequired(customerClaim)).toBe(true);
  });

  it('checks approved planning conditions for insurance claim', () => {
    let claim = normalizeClaim({ claimType: 'insurance' });
    expect(isClaimApprovedForPlanning(claim)).toBe(false);

    // Expert approved only -> not ready
    claim = approveClaimExpert(claim, 'Jean Expert');
    expect(claim.expertApproved).toBe(true);
    expect(claim.expertName).toBe('Jean Expert');
    expect(isClaimApprovedForPlanning(claim)).toBe(false);

    // Client approved only -> not ready
    let claim2 = normalizeClaim({ claimType: 'insurance' });
    claim2 = approveClaimClient(claim2, 'REF-123');
    expect(claim2.clientApproved).toBe(true);
    expect(claim2.clientApprovalReference).toBe('REF-123');
    expect(isClaimApprovedForPlanning(claim2)).toBe(false);

    // Both approved -> ready
    claim = approveClaimClient(claim, 'REF-123');
    expect(claim.clientApproved).toBe(true);
    expect(isClaimApprovedForPlanning(claim)).toBe(true);
  });

  it('checks approved planning conditions for customer claim', () => {
    let claim = normalizeClaim({ claimType: 'customer' });
    expect(isClaimApprovedForPlanning(claim)).toBe(false);

    claim = approveClaimClient(claim, 'REF-999');
    expect(isClaimApprovedForPlanning(claim)).toBe(true);
  });

  it('validates blocking claims reasons', () => {
    const claim1 = normalizeClaim({ label: 'Sinistre A', claimType: 'insurance' });
    const claim2 = normalizeClaim({ label: 'Sinistre B', claimType: 'customer' });

    const reasons = getBlockingClaimsReasons([claim1, claim2]);
    expect(reasons).toContain('Accord expert manquant pour "Sinistre A".');
    expect(reasons).toContain('Accord client manquant pour "Sinistre A".');
    expect(reasons).toContain('Accord client manquant pour "Sinistre B".');

    // Approve claim B
    const approvedB = approveClaimClient(claim2, 'REF-B');
    const reasons2 = getBlockingClaimsReasons([claim1, approvedB]);
    expect(reasons2).not.toContain('Accord client manquant pour "Sinistre B".');
    expect(reasons2).toContain('Accord expert manquant pour "Sinistre A".');
  });

  it('checks rejection and cancellation', () => {
    let claim = normalizeClaim({ label: 'Sinistre C', claimType: 'insurance' });
    claim = rejectClaim(claim, 'Refus de prise en charge');
    expect(claim.status).toBe('rejected');
    expect(isClaimApprovedForPlanning(claim)).toBe(false);

    let claim2 = normalizeClaim({ label: 'Sinistre D', claimType: 'insurance' });
    claim2 = cancelClaim(claim2);
    expect(claim2.status).toBe('cancelled');
    // Cancelled claims do not block planning
    expect(isClaimApprovedForPlanning(claim2)).toBe(true);
  });

  it('summarizes claims correctly', () => {
    const claim1 = normalizeClaim({ label: 'S1', claimType: 'insurance', status: 'expert_pending' });
    const claim2 = normalizeClaim({ label: 'S2', claimType: 'customer', status: 'approved', clientApproved: true });
    const claim3 = normalizeClaim({ label: 'S3', claimType: 'insurance', status: 'cancelled' });

    const summary = summarizeClaims([claim1, claim2, claim3]);
    expect(summary).toContain('2 sinistre(s)');
    expect(summary).toContain('1 approuvé(s)');
    expect(summary).toContain('1 en attente');
  });
});
