/**
 * NIMR SAV v24 — UI Field Consistency Test Suite
 * apps/nimr-sav-react/tests/ui-field-consistency.test.ts
 */

import { describe, it, expect } from 'vitest';
import { APP_VERSION } from '../src/constants/version';
import {
  getRoleFieldGuidance,
  getStatusDisplay,
  getPriorityDisplay,
  getEmptyStateForRole,
  validateUiFieldConsistency,
} from '../src/domain/ui-field-guidelines';
import { Role } from '../src/types';
import { CaseStatus } from '../src/domain/case-status';

describe('UI Field Consistency (v24.0.0-alpha.16)', () => {
  const officialRoles: Role[] = [
    'reception',
    'chef-atelier',
    'technicien',
    'qualite',
    'livraison',
    'directeur-sav',
    'admin',
    'lecture-seule',
  ];

  const officialStatuses: CaseStatus[] = [
    'draft',
    'received',
    'diagnosis',
    'waiting_parts',
    'repair',
    'work_completed',
    'quality_pending',
    'quality_rejected',
    'quality_rework',
    'quality_approved',
    'ready_delivery',
    'delivered',
    'closed',
    'cancelled',
  ];

  const officialPriorities = [
    'basse',
    'normale',
    'haute',
    'low',
    'normal',
    'high',
    'urgent',
  ];

  // 1. Version Check
  it('APP_VERSION is exactly v24.0.0-alpha.16', () => {
    expect(APP_VERSION).toBe('v24.0.0-alpha.16');
  });

  // 2. getRoleFieldGuidance covers all 8 official roles
  it('getRoleFieldGuidance covers all 8 official roles and returns French guidelines', () => {
    for (const role of officialRoles) {
      const guidance = getRoleFieldGuidance(role);
      expect(guidance).toBeDefined();
      expect(guidance.length).toBeGreaterThan(0);
      expect(typeof guidance).toBe('string');
    }
  });

  // 3. getStatusDisplay covers all 14 official statuses
  it('getStatusDisplay covers all 14 official statuses and returns French translations', () => {
    for (const status of officialStatuses) {
      const display = getStatusDisplay(status);
      expect(display).toBeDefined();
      expect(display.length).toBeGreaterThan(0);
      expect(display).not.toBe(status); // Display must be translated, not returned raw
    }
  });

  // 4. getPriorityDisplay covers all priorities
  it('getPriorityDisplay covers all existing priorities', () => {
    for (const priority of officialPriorities) {
      const display = getPriorityDisplay(priority);
      expect(display).toBeDefined();
      expect(display.length).toBeGreaterThan(0);
      expect(display).not.toBe(priority);
    }
  });

  // 5. getEmptyStateForRole covers operational roles
  it('getEmptyStateForRole covers all roles including operational roles', () => {
    for (const role of officialRoles) {
      const emptyState = getEmptyStateForRole(role);
      expect(emptyState).toBeDefined();
      expect(emptyState.length).toBeGreaterThan(0);
    }
  });

  // 6. validateUiFieldConsistency returns no blocker on official config
  it('validateUiFieldConsistency returns success: true and no errors on official config', () => {
    const validationResult = validateUiFieldConsistency();
    expect(validationResult.success).toBe(true);
    expect(validationResult.errors).toHaveLength(0);
  });

  // 7. No unofficial roles or statuses are translated or accepted
  it('does not return values for unofficial roles or statuses', () => {
    // Unofficial role
    const unofficialRole = 'invalid_role_for_ui_test' as unknown as Role;
    expect(getRoleFieldGuidance(unofficialRole)).toBe('');
    expect(getEmptyStateForRole(unofficialRole)).toBe('Aucune donnée disponible.');

    // Unofficial status
    const unofficialStatus = 'invalid_status_for_ui_test' as unknown as CaseStatus;
    expect(getStatusDisplay(unofficialStatus)).toBe('invalid_status_for_ui_test');
  });
});
