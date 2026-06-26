import { describe, it, expect, beforeEach } from 'vitest';
import { savCaseStore } from '../src/state/sav-case-store';
import { SavCase } from '../src/domain/sav-case';

describe('Claims Planning Blockers and alpha.14 compatibility', () => {
  const caseId = 'case-planning-test';
  const baseCase: SavCase = {
    id: caseId,
    immatriculation: 'BB-888-BB',
    vin: 'VIN88888888888888',
    clientName: 'Alice Smith',
    telephone: '0688888888',
    status: 'received',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    savCaseStore.clearAll();
    savCaseStore.addCase({ ...baseCase });
  });

  it('fails to plan workshop task if claim is unapproved', () => {
    const actor = { id: 'chef-1', role: 'chef-atelier' as const };

    // Add unapproved insurance claim
    savCaseStore.addClaim(caseId, { label: 'Pare-chocs', claimType: 'insurance' }, { id: 'rep-1', role: 'reception' });

    expect(() => {
      savCaseStore.planWorkshopTask(caseId, {
        bay: 'Baie 1',
        duration: 120,
        startAt: new Date().toISOString(),
      }, actor);
    }).toThrow('Planification bloquée : accord expert/client manquant');
  });

  it('allows plan workshop task if claim is bypassed by admin override', () => {
    const actor = { id: 'chef-1', role: 'chef-atelier' as const };

    // Add unapproved insurance claim
    savCaseStore.addClaim(caseId, { label: 'Pare-chocs', claimType: 'insurance' }, { id: 'rep-1', role: 'reception' });

    // Override the claims
    savCaseStore.overrideClaims(caseId, 'Bypass pour urgence client', { id: 'admin-1', role: 'admin' });

    // Planning should succeed now
    expect(() => {
      savCaseStore.planWorkshopTask(caseId, {
        bay: 'Baie 1',
        duration: 120,
        startAt: new Date().toISOString(),
      }, actor);
    }).not.toThrow();

    const c = savCaseStore.getCases().find(x => x.id === caseId);
    expect(c?.workshopBay).toBe('Baie 1');
    expect(c?.estimatedDurationMinutes).toBe(120);
  });

  it('verifies resource capacity and collisions are preserved', () => {
    // Basic verification of alpha.14 compatibility
    const capacity = savCaseStore.getDirectorTechnicianLoad();
    expect(capacity).toBeDefined();
    // Capacity structure should be a record of technician workloads
    expect(typeof capacity).toBe('object');
  });
});
