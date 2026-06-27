import { describe, expect, it } from 'vitest';
import { ALL_ACTIONS, OFFICIAL_ROLES } from '../src/domain/role-governance';
import {
  auditRolePermissionMatrix,
  buildSecurityReadinessChecklist,
  detectForbiddenRoleMutation,
  validateRoleActionBoundary,
} from '../src/domain/security-hardening';

describe('Security hardening alpha.19', () => {
  it('keeps exactly the official role matrix', () => {
    expect(OFFICIAL_ROLES).toEqual([
      'reception',
      'chef-atelier',
      'technicien',
      'qualite',
      'livraison',
      'directeur-sav',
      'admin',
      'lecture-seule',
    ]);
    expect(ALL_ACTIONS).toContain('export_complete_case');
    expect(ALL_ACTIONS).toContain('manage_claims');
  });

  it('rejects non-official roles and actions at the boundary', () => {
    expect(validateRoleActionBoundary('reception', 'create_case').allowed).toBe(true);
    expect(validateRoleActionBoundary('unknown-role', 'create_case').allowed).toBe(false);
    expect(validateRoleActionBoundary('reception', 'unknown_action').allowed).toBe(false);
  });

  it('detects read-only mutation attempts', () => {
    const detection = detectForbiddenRoleMutation('lecture-seule', 'create_case');
    expect(detection.forbidden).toBe(true);
    expect(detection.reason).toContain('lecture-seule');
  });

  it('blocks technician complete-case export and non-authorized director field mutations', () => {
    expect(validateRoleActionBoundary('technicien', 'export_complete_case').allowed).toBe(false);
    expect(validateRoleActionBoundary('directeur-sav', 'deliver_case').allowed).toBe(false);
    expect(validateRoleActionBoundary('directeur-sav', 'view_operational_kpis').allowed).toBe(true);
  });

  it('builds a security readiness audit with no blockers', () => {
    const audit = auditRolePermissionMatrix();
    const checklist = buildSecurityReadinessChecklist();

    expect(audit.status).not.toBe('fail');
    expect(audit.blockers).toHaveLength(0);
    expect(audit.officialRoles).toHaveLength(8);
    expect(checklist.length).toBeGreaterThanOrEqual(5);
  });
});
