import { describe, it, expect, beforeEach } from 'vitest';
import { savCaseStore } from '../src/state/sav-case-store';
import { SavCase } from '../src/domain/sav-case';

describe('Estimate-Planning Store Integration Tests', () => {
  const caseId = 'case-test-planning';
  const claimId = 'claim-test-planning';

  const baseCase: SavCase = {
    id: caseId,
    immatriculation: '789 TU 0123',
    vin: 'VINTESTPLANNING456',
    clientName: 'Client Test Planning',
    telephone: '555-5555',
    status: 'received',
    receptionDate: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    claims: [
      {
        id: claimId,
        label: 'Sinistre Carrosserie',
        claimType: 'insurance',
        payerType: 'assurance',
        status: 'draft',
        description: 'Test claim for planning',
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

  it('blocks workshop task planning when claim is unapproved even with estimate', () => {
    const actor = { id: 'rep-1', role: 'reception' as const };
    const devisContent = 'REDRESSAGE CAPOT 2.00 33.000 66.000';

    // 1. Import estimate
    savCaseStore.importEstimateForClaim(caseId, claimId, { fileName: 'devis.txt', content: devisContent }, actor);

    // 2. Planning should be blocked
    const chefActor = { id: 'chef-1', role: 'chef-atelier' as const };
    expect(() => {
      savCaseStore.planWorkshopTask(caseId, {
        bay: 'Baie 1',
        duration: 120,
        startAt: new Date().toISOString(),
      }, chefActor);
    }).toThrow('Planification bloquée : accord expert/client manquant');
  });

  it('allows task regeneration and planning once claims are approved', () => {
    const actor = { id: 'rep-1', role: 'reception' as const };
    const devisContent = 'REDRESSAGE CAPOT 2.00 33.000 66.000';

    // 1. Import estimate
    savCaseStore.importEstimateForClaim(caseId, claimId, { fileName: 'devis.txt', content: devisContent }, actor);

    // 2. Approve agreements
    savCaseStore.approveClaimExpert(caseId, claimId, 'Expert Auto Z', actor);
    savCaseStore.approveClaimClient(caseId, claimId, 'ACCORD-CLIENT-123', actor);

    // 3. Regenerate tasks from estimate
    const chefActor = { id: 'chef-1', role: 'chef-atelier' as const };
    savCaseStore.regenerateWorkshopTasksFromClaimEstimate(caseId, claimId, chefActor);

    // Verify tasks generated
    let c = savCaseStore.getCases().find(x => x.id === caseId);
    expect(c!.workshopTasks).toBeDefined();
    expect(c!.workshopTasks).toHaveLength(1);
    expect(c!.workshopTasks![0].label).toContain('Tôlerie');
    expect(c!.workshopTasks![0].estimatedDurationMinutes).toBe(120);

    // 4. Plan the case
    savCaseStore.planWorkshopTask(caseId, {
      bay: 'Baie A',
      duration: c!.estimatedDurationMinutes,
      startAt: new Date().toISOString(),
    }, chefActor);

    c = savCaseStore.getCases().find(x => x.id === caseId);
    expect(c!.workshopBay).toBe('Baie A');
  });
});
