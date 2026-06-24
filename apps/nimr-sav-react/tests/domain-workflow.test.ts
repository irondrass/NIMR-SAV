import { describe, it, expect } from 'vitest';
import { transitionCase } from '../src/domain/workflow-engine';
import { SavCase } from '../src/domain/sav-case';

describe('SAV Workflow Engine Transitions', () => {
  const baseCase: SavCase = {
    id: 'test-case-id',
    immatriculation: 'DEMO-001',
    vin: 'VIN-DEMO-0000000001',
    clientName: 'Client Démo A',
    telephone: '00000000',
    status: 'draft',
    receptionDate: '2026-06-24T12:00:00Z',
    createdAt: '2026-06-24T12:00:00Z',
    updatedAt: '2026-06-24T12:00:00Z',
  };

  it('allows draft -> received transition and generates audit log', () => {
    const user = { id: 'reception-1', role: 'reception' as const };
    const res = transitionCase(baseCase, 'received', user);
    expect(res.success).toBe(true);
    expect(res.updatedCase?.status).toBe('received');
    expect(res.auditLog).toBeDefined();
    expect(res.auditLog?.fromStatus).toBe('draft');
    expect(res.auditLog?.toStatus).toBe('received');
    expect(res.auditLog?.action).toBe('STATUS_TRANSITION');
  });

  it('rejects invalid draft -> repair transition', () => {
    const user = { id: 'chef-1', role: 'chef-atelier' as const };
    const res = transitionCase(baseCase, 'repair', user);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Invalid transition');
  });

  it('allows draft -> cancelled', () => {
    const user = { id: 'reception-1', role: 'reception' as const };
    const res = transitionCase(baseCase, 'cancelled', user);
    expect(res.success).toBe(true);
    expect(res.updatedCase?.status).toBe('cancelled');
  });

  it('prevents standard cancellation from repair status', () => {
    const repairCase = { ...baseCase, status: 'repair' as const };
    const user = { id: 'chef-1', role: 'chef-atelier' as const };
    const res = transitionCase(repairCase, 'cancelled', user);
    expect(res.success).toBe(false);
    expect(res.error).toContain('forbidden except for Admin');
  });

  it('allows late cancellation for Admin and generates an exceptional audit log', () => {
    const repairCase = { ...baseCase, status: 'repair' as const };
    const adminUser = { id: 'admin-1', role: 'admin' as const };
    const res = transitionCase(repairCase, 'cancelled', adminUser);
    expect(res.success).toBe(true);
    expect(res.updatedCase?.status).toBe('cancelled');
    expect(res.auditLog?.action).toBe('EXCEPTIONAL_ADMIN_ACTION');
    expect(res.auditLog?.details).toContain('Exceptional Admin action');
  });

  it('prevents editing closed cases for normal roles', () => {
    const closedCase = { ...baseCase, status: 'closed' as const };
    const user = { id: 'chef-1', role: 'chef-atelier' as const };
    const res = transitionCase(closedCase, 'draft', user);
    expect(res.success).toBe(false);
    expect(res.error).toContain('cannot be modified except by Admin');
  });

  it('allows editing closed cases for Admin', () => {
    const closedCase = { ...baseCase, status: 'closed' as const };
    const adminUser = { id: 'admin-1', role: 'admin' as const };
    const res = transitionCase(closedCase, 'draft', adminUser);
    expect(res.success).toBe(true);
    expect(res.updatedCase?.status).toBe('draft');
    expect(res.auditLog?.action).toBe('EXCEPTIONAL_ADMIN_ACTION');
  });

  it('prevents editing cancelled cases for normal roles', () => {
    const cancelledCase = { ...baseCase, status: 'cancelled' as const };
    const user = { id: 'reception-1', role: 'reception' as const };
    const res = transitionCase(cancelledCase, 'draft', user);
    expect(res.success).toBe(false);
    expect(res.error).toContain('cannot be modified except by Admin');
  });

  it('allows editing cancelled cases for Admin', () => {
    const cancelledCase = { ...baseCase, status: 'cancelled' as const };
    const adminUser = { id: 'admin-1', role: 'admin' as const };
    const res = transitionCase(cancelledCase, 'draft', adminUser);
    expect(res.success).toBe(true);
    expect(res.updatedCase?.status).toBe('draft');
    expect(res.auditLog?.action).toBe('EXCEPTIONAL_ADMIN_ACTION');
  });
});
