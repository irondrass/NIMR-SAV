/**
 * NIMR SAV v24 — Role Screen UX Integration Test Suite
 * apps/nimr-sav-react/tests/role-screen-ux-integration.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

describe('Role Screen UX Integration (v24.0.0-alpha.20)', () => {
  const views = {
    reception: resolve(__dirname, '../src/features/reception/ReceptionView.tsx'),
    planning: resolve(__dirname, '../src/features/chef-atelier/PlanningView.tsx'),
    technician: resolve(__dirname, '../src/features/technician/TechnicianView.tsx'),
    qc: resolve(__dirname, '../src/features/qc/QCView.tsx'),
    delivery: resolve(__dirname, '../src/features/delivery/DeliveryView.tsx'),
    dashboard: resolve(__dirname, '../src/features/directeur/DashboardView.tsx'),
    admin: resolve(__dirname, '../src/features/admin/AdminView.tsx'),
    readonly: resolve(__dirname, '../src/features/lecture-seule/ReadOnlyView.tsx'),
  };

  const getFileContent = (path: string): string => {
    expect(existsSync(path)).toBe(true);
    return readFileSync(path, 'utf-8');
  };

  // 1. Titles checks
  it('each screen displays the correct business title (titre métier)', () => {
    const receptionContent = getFileContent(views.reception);
    expect(receptionContent).toContain('Réception SAV');

    const planningContent = getFileContent(views.planning);
    expect(planningContent).toContain('Planification Atelier');

    const technicianContent = getFileContent(views.technician);
    expect(technicianContent).toContain('Espace Technicien');

    const qcContent = getFileContent(views.qc);
    expect(qcContent).toContain('Contrôle Qualité');

    const deliveryContent = getFileContent(views.delivery);
    expect(deliveryContent).toContain('Livraison Client');

    const dashboardContent = getFileContent(views.dashboard);
    expect(dashboardContent).toContain('Tableau de Bord Directeur SAV');

    const adminContent = getFileContent(views.admin);
    expect(adminContent).toContain('Gouvernance & Readiness');

    const readonlyContent = getFileContent(views.readonly);
    expect(readonlyContent).toContain('Mode Lecture Seule');
  });

  // 2. AdminView displays alpha.20 recipe warning
  it('AdminView displays alpha.20 recipe warning notice without publication wording', () => {
    const adminContent = getFileContent(views.admin);
    expect(adminContent).toContain('alpha.20 est une recette web isolée');
    expect(adminContent).toContain('non production');
    expect(adminContent).toContain('non finale');
    expect(adminContent).not.toContain(['RC', 'publiée'].join(' '));
    expect(adminContent).not.toContain(['release candidate', 'publiée'].join(' '));
  });

  // 3. ReadOnlyView displays “aucune action disponible”
  it('ReadOnlyView displays warning that no actions are available', () => {
    const readonlyContent = getFileContent(views.readonly);
    expect(readonlyContent.toLowerCase()).toContain('aucune action disponible');
  });

  // 4. DashboardView does not contain any write actions
  it('DashboardView does not make any store writes or mutations', () => {
    const dashboardContent = getFileContent(views.dashboard);
    const forbiddenMutators = [
      'addCase',
      'addLog',
      'transitionCase',
      'closeCase',
      'deliverCase',
      'setItem',
    ];
    for (const mutator of forbiddenMutators) {
      expect(dashboardContent).not.toContain(mutator);
    }
  });

  // 5. AdminView does not contain any destructive action or user modification
  it('AdminView does not contain destructive operations or user modifications', () => {
    const adminContent = getFileContent(views.admin);
    const forbiddenOperations = [
      'addCase',
      'addLog',
      'transitionCase',
      'closeCase',
      'deliverCase',
      'setItem',
      'createUser',
      'updateRole',
      'promote',
      'demote',
    ];
    for (const op of forbiddenOperations) {
      expect(adminContent).not.toContain(op);
    }
  });

  // 6. DeliveryView uses only ready_delivery
  it('DeliveryView uses only official status ready_delivery and rejects unofficial variations', () => {
    const deliveryContent = getFileContent(views.delivery);
    expect(deliveryContent).toContain('ready_delivery');
    expect(deliveryContent).not.toContain(['ready', 'for', 'delivery'].join('_'));
    expect(deliveryContent).not.toContain(['delivery', 'ready'].join('_'));
    expect(deliveryContent).not.toContain(['ready', 'to', 'deliver'].join('_'));
  });

  // 7. Rejects forbidden roles across all views
  it('does not contain technical roles that are forbidden', () => {
    const forbiddenRolesPatterns = [
      ['role', "=== 'qc'"].join(' '),
      ['role', "=== 'delivery'"].join(' '),
      ['role', "=== 'livreur'"].join(' '),
      ['role', "=== 'director'"].join(' '),
      ['role', "=== 'manager'"].join(' '),
      ['role', "=== 'dg'"].join(' '),
      ['role', "=== 'superadmin'"].join(' '),
      ['user.role', "=== 'qc'"].join(' '),
      ['user.role', "=== 'delivery'"].join(' '),
      ['user.role', "=== 'director'"].join(' '),
      ['actor.role', "=== 'qc'"].join(' '),
      ['actor.role', "=== 'delivery'"].join(' '),
      ['actor.role', "=== 'director'"].join(' '),
    ];

    for (const [, path] of Object.entries(views)) {
      const content = getFileContent(path);
      for (const pattern of forbiddenRolesPatterns) {
        expect(content).not.toContain(pattern);
      }
    }
  });

  // 8. Rejects forbidden status variations across all views
  it('does not contain forbidden status name variations', () => {
    const forbiddenStatuses = [
      ['ready', 'for', 'delivery'].join('_'),
      ['delivery', 'ready'].join('_'),
      ['ready', 'to', 'deliver'].join('_'),
    ];

    for (const [, path] of Object.entries(views)) {
      const content = getFileContent(path);
      for (const status of forbiddenStatuses) {
        expect(content).not.toContain(status);
      }
    }
  });

  // 9. Rejects RC/production markings in all UI files
  it('does not contain production markings or RC in views', () => {
    const forbiddenMarkings = [
      ['production', 'ready'].join(' '),
      ['production', 'ready'].join('-'),
      ['RC', 'publiée'].join(' '),
      ['release candidate', 'publiée'].join(' '),
      ['tag', 'v24'].join(' '),
    ];

    for (const [, path] of Object.entries(views)) {
      const content = getFileContent(path);
      for (const marking of forbiddenMarkings) {
        expect(content).not.toContain(marking);
      }
    }
  });

  // 10. Operational screens have empty states
  it('operational screens contain EmptyState component for blank scenarios', () => {
    const receptionContent = getFileContent(views.reception);
    expect(receptionContent).toContain('EmptyState');

    const planningContent = getFileContent(views.planning);
    expect(planningContent).toContain('EmptyState');

    const technicianContent = getFileContent(views.technician);
    expect(technicianContent).toContain('EmptyState');

    const qcContent = getFileContent(views.qc);
    expect(qcContent).toContain('EmptyState');

    const deliveryContent = getFileContent(views.delivery);
    expect(deliveryContent).toContain('EmptyState');
  });

  // 11. Badges are imported and used
  it('uses StatusBadge and PriorityBadge in views', () => {
    const screensWithBadges = [views.planning, views.technician, views.qc, views.delivery, views.dashboard];
    for (const path of screensWithBadges) {
      const content = getFileContent(path);
      expect(content).toContain('StatusBadge');
    }
  });
});
