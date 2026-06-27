import { describe, it, expect, beforeEach } from 'vitest';
import { savCaseStore } from '../src/state/sav-case-store';
import { SavCase } from '../src/domain/sav-case';

describe('Estimate-Claim Store Integration Tests', () => {
  const caseId = 'case-test-estimate';
  const claimId = 'claim-test-estimate';

  const baseCase: SavCase = {
    id: caseId,
    immatriculation: '456 TU 7890',
    vin: 'VINTESTESTIMATE123',
    clientName: 'Client Test Estimate',
    telephone: '555-5555',
    status: 'received',
    receptionDate: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    claims: [
      {
        id: claimId,
        label: 'Sinistre A',
        claimType: 'insurance',
        payerType: 'assurance',
        status: 'draft',
        description: 'Test claim',
        expertApproved: false,
        clientApproved: false,
        requiredApprovals: ['expert', 'client'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    ]
  };

  beforeEach(() => {
    savCaseStore.clearAll();
    savCaseStore.addCase({ ...baseCase });
  });

  it('imports estimate on claim with correct permissions and keeps approvals missing', () => {
    const actor = { id: 'rep-1', role: 'reception' as const };
    const devisContent = `
D/P ENJOLIVEUR 1.00 33.000 33.000
PARE-CHOC AV 1.00 450.000 450.000
TOTAL HT: 483.000
TOTAL TTC: 574.770
    `;

    savCaseStore.importEstimateForClaim(caseId, claimId, { fileName: 'devis.txt', content: devisContent }, actor);

    const c = savCaseStore.getCases().find(x => x.id === caseId);
    expect(c).toBeDefined();
    const claim = c!.claims![0];
    expect(claim.estimate).toBeDefined();
    expect(claim.estimate?.sourceFileName).toBe('devis.txt');
    expect(claim.estimatedAmount).toBe(574.77);

    // Estimate import does NOT validate expert/client approvals!
    expect(claim.expertApproved).toBe(false);
    expect(claim.clientApproved).toBe(false);
    expect(claim.status).toBe('expert_pending');
  });

  it('rejects estimate modification for read-only roles', () => {
    const roActor = { id: 'ro-1', role: 'lecture-seule' as const };
    const dirActor = { id: 'dir-1', role: 'directeur-sav' as const };
    const devisContent = 'REPARATION CAPOT 1.00 33.000 33.000';

    expect(() => {
      savCaseStore.importEstimateForClaim(caseId, claimId, { fileName: 'devis.txt', content: devisContent }, roActor);
    }).toThrow(/is not permitted to import estimates/);

    expect(() => {
      savCaseStore.importEstimateForClaim(caseId, claimId, { fileName: 'devis.txt', content: devisContent }, dirActor);
    }).toThrow(/is not permitted to import estimates/);
  });

  it('removes estimate from claim and log events', () => {
    const actor = { id: 'rep-1', role: 'reception' as const };
    const devisContent = 'REPARATION CAPOT 1.00 33.000 33.000';

    savCaseStore.importEstimateForClaim(caseId, claimId, { fileName: 'devis.txt', content: devisContent }, actor);
    let c = savCaseStore.getCases().find(x => x.id === caseId);
    expect(c!.claims![0].estimate).toBeDefined();

    savCaseStore.removeEstimateFromClaim(caseId, claimId, actor);
    c = savCaseStore.getCases().find(x => x.id === caseId);
    expect(c!.claims![0].estimate).toBeUndefined();
  });
});
