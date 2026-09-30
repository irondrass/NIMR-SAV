import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizeClaim,
  isClaimApprovedForPlanning,
  getBlockingClaimsReasons,
  areAllClaimsApprovedForPlanning,
} from '../src/domain/claims';
import { transitionCase } from '../src/domain/workflow-engine';
import { savCaseStore } from '../src/state/sav-case-store';
import { SavCase } from '../src/domain/sav-case';

// KHA-76 P0a — a "mixed" claim must follow the existing semantics of
// isClaimApprovedForPlanning (status !== 'approved' => not plannable)
// in getBlockingClaimsReasons too. No redefinition of "mixed" business rules.
describe('KHA-76 P0a — mixed claim planning blocker', () => {
  const chef = { id: 'chef-1', role: 'chef-atelier' as const };
  const reception = { id: 'rep-1', role: 'reception' as const };
  const caseId = 'case-p0a-mixed';
  const baseCase: SavCase = {
    id: caseId,
    immatriculation: 'MX-001-P0',
    vin: 'VINMIXED000000001',
    clientName: 'Client Mixte',
    telephone: '0600000001',
    status: 'received',
    receptionDate: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    savCaseStore.clearAll();
    savCaseStore.addCase({ ...baseCase });
  });

  it('1. mixed + draft: isClaimApprovedForPlanning === false', () => {
    const claim = normalizeClaim({ label: 'Sinistre mixte', claimType: 'mixed' });
    expect(claim.status).toBe('draft');
    expect(isClaimApprovedForPlanning(claim)).toBe(false);
  });

  it('2. mixed + draft: getBlockingClaimsReasons returns a blocker', () => {
    const claim = normalizeClaim({ label: 'Sinistre mixte', claimType: 'mixed' });
    const reasons = getBlockingClaimsReasons([claim]);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toBe('Validation interne manquante pour "Sinistre mixte".');
  });

  it('3. mixed + draft: areAllClaimsApprovedForPlanning === false', () => {
    const claim = normalizeClaim({ label: 'Sinistre mixte', claimType: 'mixed' });
    expect(areAllClaimsApprovedForPlanning([claim])).toBe(false);
  });

  it('4. dossier with a non-approved mixed claim: workshop planning refused', () => {
    savCaseStore.addClaim(caseId, { label: 'Sinistre mixte', claimType: 'mixed' }, reception);
    expect(() => {
      savCaseStore.planWorkshopTask(caseId, {
        bay: 'Baie 1',
        duration: 120,
        startAt: new Date().toISOString(),
      }, chef);
    }).toThrow('Planification bloquée : accord expert/client manquant');
    const c = savCaseStore.getCases().find((x) => x.id === caseId);
    expect(c?.workshopBay).toBeUndefined();
  });

  it('5. engaging workshop transition with a non-approved mixed claim: refused', () => {
    const claim = normalizeClaim({ label: 'Sinistre mixte', claimType: 'mixed' });
    const caseWithClaims: SavCase = { ...baseCase, claims: [claim] };
    for (const target of ['diagnosis', 'waiting_parts', 'repair'] as const) {
      const res = transitionCase(caseWithClaims, target, chef);
      expect(res.success).toBe(false);
      expect(res.error).toBe('Planification bloquée : accord expert/client manquant');
    }
  });

  it('6. mixed + approved: planning allowed when no other blocker', () => {
    const claim = normalizeClaim({ label: 'Sinistre mixte', claimType: 'mixed', status: 'approved' });
    expect(isClaimApprovedForPlanning(claim)).toBe(true);
    expect(getBlockingClaimsReasons([claim])).toEqual([]);
    expect(areAllClaimsApprovedForPlanning([claim])).toBe(true);

    const res = transitionCase({ ...baseCase, claims: [claim] }, 'diagnosis', chef);
    expect(res.success).toBe(true);
    expect(res.updatedCase?.status).toBe('diagnosis');

    savCaseStore.addClaim(caseId, { label: 'Sinistre mixte', claimType: 'mixed', status: 'approved' }, reception);
    expect(() => {
      savCaseStore.planWorkshopTask(caseId, {
        bay: 'Baie 1',
        duration: 120,
        startAt: new Date().toISOString(),
      }, chef);
    }).not.toThrow();
    const c = savCaseStore.getCases().find((x) => x.id === caseId);
    expect(c?.workshopBay).toBe('Baie 1');
  });

  it('mixed non-approved is still bypassed by the existing admin override', () => {
    const claim = normalizeClaim({ label: 'Sinistre mixte', claimType: 'mixed' });
    expect(getBlockingClaimsReasons([claim], true)).toEqual([]);
  });
});
