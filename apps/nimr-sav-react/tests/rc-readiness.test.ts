import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { APP_VERSION } from '../src/constants/version';
import { OFFICIAL_ROLES } from '../src/domain/role-governance';
import { CASE_STATUSES } from '../src/domain/case-status';
import {
  RC_READINESS_VERSION,
  summarizeRcReadiness,
  validateRcBusinessEvidence,
  validateRcGoNoGoInputs,
  validateRcReadiness,
  validateRcRiskRegister,
  validateRcScopeFreeze,
  validateRcTechnicalEvidence,
} from '../src/domain/rc-readiness';

describe('RC readiness (v24.0.0-alpha.14)', () => {
  it('aligns APP_VERSION on v24.0.0-alpha.14', () => {
    expect(APP_VERSION).toBe('v24.0.0-alpha.14');
    expect(RC_READINESS_VERSION).toBe('v24.0.0-alpha.14');
  });

  it('marks rc.1 as internal only', () => {
    const readiness = validateRcReadiness();

    expect(readiness.success).toBe(true);
    expect(readiness.internalReleaseCandidate).toBe(true);
    expect(readiness.checks.internalReleaseCandidate).toBe(true);
  });

  it('confirms rc.1 is not final and not production', () => {
    const readiness = validateRcReadiness();

    expect(readiness.finalRelease).toBe(false);
    expect(readiness.productionExposure).toBe(false);
    expect(readiness.checks.finalReleaseNotCreated).toBe(true);
    expect(readiness.checks.productionExposureAbsent).toBe(true);
  });

  it('requires no automatic tag for rc.1', () => {
    const scope = validateRcScopeFreeze();
    const readiness = validateRcReadiness();

    expect(scope.success).toBe(true);
    expect(scope.checks.noAutomaticTagExpected).toBe(true);
    expect(readiness.automaticTagExpected).toBe(false);
  });

  it('keeps v23.2.6 as stable pilot', () => {
    const readiness = validateRcReadiness();

    expect(readiness.stablePilotVersion).toBe('v23.2.6');
    expect(readiness.checks.stablePilotRemainsV2326).toBe(true);
  });

  it('keeps public data empty', () => {
    const vehiclesPath = resolve(__dirname, '../../../data/vehicles.json');
    const publicVehicles = JSON.parse(readFileSync(vehiclesPath, 'utf-8')) as unknown[];
    const technical = validateRcTechnicalEvidence({ publicVehicles });

    expect(readFileSync(vehiclesPath, 'utf-8').trim()).toBe('[]');
    expect(technical.success).toBe(true);
    expect(technical.checks.publicVehiclesRemainEmpty).toBe(true);
  });

  it('has no external runtime dependencies', () => {
    const technical = validateRcTechnicalEvidence();

    expect(technical.success).toBe(true);
    expect(technical.checks.noBackendRuntime).toBe(true);
    expect(technical.checks.noSupabaseRuntime).toBe(true);
    expect(technical.checks.noReactServiceWorker).toBe(true);
  });

  it('allows official roles only', () => {
    const business = validateRcBusinessEvidence();

    expect(business.success).toBe(true);
    expect(business.checks.officialRolesOnly).toBe(true);
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
  });

  it('allows official statuses only', () => {
    const business = validateRcBusinessEvidence();

    expect(business.success).toBe(true);
    expect(business.checks.officialStatusesOnly).toBe(true);
    expect(CASE_STATUSES).toEqual([
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
    ]);
  });

  it('preserves the business workflow and the alpha.13 functional freeze', () => {
    const business = validateRcBusinessEvidence();

    expect(business.success, business.blockers.join(' | ')).toBe(true);
    expect(business.checks.alpha12WorkflowPreserved).toBe(true);
    expect(business.checks.alpha13FunctionalFreezePreserved).toBe(true);
  });

  it('keeps Direction/Admin/Read-only consultation without mutation', () => {
    const business = validateRcBusinessEvidence();

    expect(business.checks.consultationWithoutMutation).toBe(true);
  });

  it('blocks delivery without approved quality and prevents delivered rollback', () => {
    const business = validateRcBusinessEvidence();

    expect(business.checks.deliveryBlockedWithoutApprovedQuality).toBe(true);
    expect(business.checks.deliveredCannotMoveBackward).toBe(true);
  });

  it('keeps the RC risk register explicit', () => {
    const riskRegister = validateRcRiskRegister();

    expect(riskRegister.success).toBe(true);
    expect(riskRegister.risks.length).toBeGreaterThanOrEqual(6);
    expect(riskRegister.checks.riskRegisterPresent).toBe(true);
    expect(riskRegister.checks.manualValidationRiskOpen).toBe(true);
  });

  it('requires human decision before any tag', () => {
    const goNoGo = validateRcGoNoGoInputs();
    const readiness = validateRcReadiness();
    const summary = summarizeRcReadiness(readiness);

    expect(goNoGo.success).toBe(true);
    expect(goNoGo.checks.manualFieldValidationRequired).toBe(true);
    expect(goNoGo.checks.humanGoNoGoDecisionRequired).toBe(true);
    expect(readiness.manualFieldValidationRequired).toBe(true);
    expect(readiness.humanGoNoGoDecisionRequired).toBe(true);
    expect(summary).toContain('RC interne');
    expect(summary).toContain('décision GO / NO-GO humaine obligatoires');
  });

  it('keeps the rc-readiness module pure from browser and storage APIs', () => {
    const source = readFileSync(resolve(__dirname, '../src/domain/rc-readiness.ts'), 'utf-8');

    for (const forbiddenApi of ['localStorage', 'window', 'document']) {
      expect(source).not.toContain(forbiddenApi);
    }
  });
});
