import { describe, it, expect } from 'vitest';
import { transitionCase } from '../src/domain/workflow-engine';
import { SavCase } from '../src/domain/sav-case';
import { normalizeClaim } from '../src/domain/claims';
import { savCaseStore } from '../src/state/sav-case-store';

describe('Multi-claims and Workflow Validation', () => {
  const baseCase: SavCase = {
    id: 'case-test-1',
    immatriculation: '123-AA-45',
    vin: 'VIN12345678901234',
    clientName: 'Client Test',
    telephone: '0600000000',
    status: 'received',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('allows workflow transition if dossier has no claims', () => {
    const res = transitionCase(baseCase, 'diagnosis', { id: 'user-atelier', role: 'chef-atelier' });
    expect(res.success).toBe(true);
    expect(res.updatedCase?.status).toBe('diagnosis');
  });

  it('blocks workflow transition if dossier has unapproved claims', () => {
    const claim1 = normalizeClaim({ label: 'Sinistre assurance', claimType: 'insurance' });
    const caseWithClaims: SavCase = {
      ...baseCase,
      claims: [claim1],
    };

    const res = transitionCase(caseWithClaims, 'diagnosis', { id: 'user-atelier', role: 'chef-atelier' });
    expect(res.success).toBe(false);
    expect(res.error).toBe('Planification bloquée : accord expert/client manquant');
  });

  it('blocks workshop transition if even one claim is unapproved', () => {
    const claim1 = normalizeClaim({ label: 'Sinistre A', claimType: 'insurance', expertApproved: true, clientApproved: true });
    const claim2 = normalizeClaim({ label: 'Sinistre B', claimType: 'customer', clientApproved: false });
    const caseWithClaims: SavCase = {
      ...baseCase,
      claims: [claim1, claim2],
    };

    const res = transitionCase(caseWithClaims, 'diagnosis', { id: 'user-atelier', role: 'chef-atelier' });
    expect(res.success).toBe(false);
    expect(res.error).toBe('Planification bloquée : accord expert/client manquant');
  });

  it('allows transition if all claims are approved', () => {
    const claim1 = normalizeClaim({ label: 'Sinistre A', claimType: 'insurance', expertApproved: true, clientApproved: true, status: 'approved' });
    const claim2 = normalizeClaim({ label: 'Sinistre B', claimType: 'customer', clientApproved: true, status: 'approved' });
    const caseWithClaims: SavCase = {
      ...baseCase,
      claims: [claim1, claim2],
    };

    const res = transitionCase(caseWithClaims, 'diagnosis', { id: 'user-atelier', role: 'chef-atelier' });
    expect(res.success).toBe(true);
    expect(res.updatedCase?.status).toBe('diagnosis');
  });

  it('allows transition if claims are overridden by admin', () => {
    const claim1 = normalizeClaim({ label: 'Sinistre A', claimType: 'insurance' });
    const caseWithClaims: SavCase = {
      ...baseCase,
      claims: [claim1],
      claimsOverridden: true,
      claimsOverrideReason: 'Dérogation exceptionnelle terrain',
    };

    const res = transitionCase(caseWithClaims, 'diagnosis', { id: 'user-atelier', role: 'chef-atelier' });
    expect(res.success).toBe(true);
    expect(res.updatedCase?.status).toBe('diagnosis');
  });

  it('requires reason and admin role for override in store', () => {
    savCaseStore.clearAll();
    savCaseStore.addCase({ ...baseCase, id: 'case-override' });

    // Non-admin role cannot override
    expect(() => {
      savCaseStore.overrideClaims('case-override', 'Raisons opérationnelles', { id: 'chef', role: 'chef-atelier' });
    }).toThrow(/is not permitted to override claims/);

    // Empty reason is forbidden
    expect(() => {
      savCaseStore.overrideClaims('case-override', '', { id: 'admin-1', role: 'admin' });
    }).toThrow(/motif est obligatoire/);

    // Valid override works
    savCaseStore.overrideClaims('case-override', 'Dérogation validée par la direction', { id: 'admin-1', role: 'admin' });
    const updated = savCaseStore.getCases().find(c => c.id === 'case-override');
    expect(updated?.claimsOverridden).toBe(true);
    expect(updated?.claimsOverrideReason).toBe('Dérogation validée par la direction');
    expect(updated?.claimsOverrideBy).toBe('admin-1');

    // Override does not mark claims as approved internally
    const log = savCaseStore.getLogs().find(l => l.caseId === 'case-override' && l.action === 'override_claims');
    expect(log).toBeDefined();
    expect(log?.details).toContain('Motif : Dérogation validée par la direction');
  });
});
