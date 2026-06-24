import { describe, it, expect } from 'vitest';
import { hasPermission, canViewDirectionNotes } from '../src/domain/action-permissions';
import { transitionCase } from '../src/domain/workflow-engine';
import { SavCase } from '../src/domain/sav-case';

describe('SAV Role Permissions & Protections', () => {
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

  it('prohibits lecture-seule from making any transition modifications', () => {
    const user = { id: 'reader-1', role: 'lecture-seule' as const };
    const res = transitionCase(baseCase, 'received', user);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Read-only users cannot perform modifications');
  });

  it('prevents technicians from validating or rejecting QC', () => {
    const qcCase: SavCase = { ...baseCase, status: 'quality_pending' };
    const tech = { id: 'tech-1', role: 'technicien' as const };
    const resApproved = transitionCase(qcCase, 'quality_approved', tech);
    const resRejected = transitionCase(qcCase, 'quality_rejected', tech);
    expect(resApproved.success).toBe(false);
    expect(resApproved.error).toContain('Technicians cannot validate or reject QC');
    expect(resRejected.success).toBe(false);
    expect(resRejected.error).toContain('Technicians cannot validate or reject QC');
  });

  it('prevents livraison role from validating or rejecting QC', () => {
    const qcCase: SavCase = { ...baseCase, status: 'quality_pending' };
    const liv = { id: 'liv-1', role: 'livraison' as const };
    const resApproved = transitionCase(qcCase, 'quality_approved', liv);
    const resRejected = transitionCase(qcCase, 'quality_rejected', liv);
    expect(resApproved.success).toBe(false);
    expect(resApproved.error).toContain('Livraison role cannot validate or reject QC');
    expect(resRejected.success).toBe(false);
    expect(resRejected.error).toContain('Livraison role cannot validate or reject QC');
  });

  it('prevents reception from closing a case', () => {
    const deliveredCase: SavCase = { ...baseCase, status: 'delivered' };
    const reception = { id: 'reception-1', role: 'reception' as const };
    const res = transitionCase(deliveredCase, 'closed', reception);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Reception role cannot close cases');
  });

  it('prevents livraison from closing a case', () => {
    const deliveredCase: SavCase = { ...baseCase, status: 'delivered' };
    const liv = { id: 'liv-1', role: 'livraison' as const };
    const res = transitionCase(deliveredCase, 'closed', liv);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Livraison role cannot close cases');
  });

  it('restricts direction notes visibility strictly to SAV Director and Admin', () => {
    expect(canViewDirectionNotes('directeur-sav')).toBe(true);
    expect(canViewDirectionNotes('admin')).toBe(true);
    
    expect(canViewDirectionNotes('reception')).toBe(false);
    expect(canViewDirectionNotes('technicien')).toBe(false);
    expect(canViewDirectionNotes('chef-atelier')).toBe(false);
    expect(canViewDirectionNotes('qualite')).toBe(false);
    expect(canViewDirectionNotes('lecture-seule')).toBe(false);
    expect(canViewDirectionNotes('livraison')).toBe(false);
  });

  it('checks detailed action matrix for role reception', () => {
    expect(hasPermission('reception', 'create_case')).toBe(true);
    expect(hasPermission('reception', 'receive_case')).toBe(true);
    expect(hasPermission('reception', 'close_case')).toBe(false);
    expect(hasPermission('reception', 'validate_qc')).toBe(false);
  });

  it('checks detailed action matrix for role technicien', () => {
    expect(hasPermission('technicien', 'start_repair')).toBe(true);
    expect(hasPermission('technicien', 'complete_repair')).toBe(true);
    expect(hasPermission('technicien', 'validate_qc')).toBe(false);
    expect(hasPermission('technicien', 'create_case')).toBe(false);
  });

  it('checks detailed action matrix for role chef-atelier', () => {
    expect(hasPermission('chef-atelier', 'assign_technician')).toBe(true);
    expect(hasPermission('chef-atelier', 'rework_repair')).toBe(true);
    expect(hasPermission('chef-atelier', 'admin_action')).toBe(false);
  });

  it('checks detailed action matrix for role qualite', () => {
    expect(hasPermission('qualite', 'validate_qc')).toBe(true);
    expect(hasPermission('qualite', 'reject_qc')).toBe(true);
    expect(hasPermission('qualite', 'create_case')).toBe(false);
  });

  it('checks detailed action matrix for role livraison', () => {
    expect(hasPermission('livraison', 'deliver_case')).toBe(true);
    expect(hasPermission('livraison', 'validate_qc')).toBe(false);
    expect(hasPermission('livraison', 'close_case')).toBe(false);
  });
});
