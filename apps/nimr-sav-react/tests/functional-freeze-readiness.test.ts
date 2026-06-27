import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { APP_VERSION } from '../src/constants/version';
import { OFFICIAL_ROLES } from '../src/domain/role-governance';
import { CASE_STATUSES } from '../src/domain/case-status';
import {
  FUNCTIONAL_FREEZE_VERSION,
  STABLE_PILOT_VERSION,
  summarizeFunctionalFreezeReadiness,
  validateFunctionalFreezeReadiness,
  validateNoExternalRuntimeDependencies,
  validateNoProductionExposure,
  validateNoRealCustomerData,
  validateReleaseCandidateEvaluationInputs,
  validateStableRoleAndStatusMatrix,
} from '../src/domain/functional-freeze-readiness';

describe('Functional freeze readiness (v24.0.0-alpha.17)', () => {
  it('aligns APP_VERSION on v24.0.0-alpha.17', () => {
    expect(APP_VERSION).toBe('v24.0.0-alpha.17');
    expect(FUNCTIONAL_FREEZE_VERSION).toBe(APP_VERSION);
  });

  it('reports rc.1 internal readiness while preserving the alpha.13 freeze', () => {
    const readiness = validateFunctionalFreezeReadiness();

    expect(readiness.success).toBe(true);
    expect(readiness.readyForRcEvaluation).toBe(true);
    expect(readiness.internalReleaseCandidatePrepared).toBe(true);
    expect(readiness.releaseCandidateCreated).toBe(true);
    expect(readiness.finalReleaseCreated).toBe(false);
    expect(readiness.freezeLabel).toBe('gel fonctionnel alpha.13 conservé');
    expect(readiness.blockers).toHaveLength(0);
  });

  it('keeps v23.2.6 as the stable pilot reference', () => {
    const readiness = validateFunctionalFreezeReadiness();

    expect(STABLE_PILOT_VERSION).toBe('v23.2.6');
    expect(readiness.stablePilotVersion).toBe('v23.2.6');
    expect(readiness.checks.stablePilotRemainsV2326).toBe(true);
  });

  it('requires no automatic tag and no production exposure for rc.1', () => {
    const exposure = validateNoProductionExposure();

    expect(exposure.success).toBe(true);
    expect(exposure.checks.noAutomaticTagExpected).toBe(true);
    expect(exposure.checks.internalReleaseCandidateOnly).toBe(true);
    expect(exposure.checks.finalReleaseNotCreated).toBe(true);
    expect(exposure.checks.remainsNonProduction).toBe(true);
  });

  it('detects any accidental production exposure or tag presence as a blocker', () => {
    const exposure = validateNoProductionExposure({
      productionExposureDeclared: true,
      tagsPointingAtHead: ['unexpected-local-marker'],
    });

    expect(exposure.success).toBe(false);
    expect(exposure.blockers.length).toBeGreaterThanOrEqual(2);
  });

  it('has no external runtime dependencies for the React rc.1 preparation', () => {
    const externalRuntime = validateNoExternalRuntimeDependencies();

    expect(externalRuntime.success).toBe(true);
    expect(externalRuntime.checks.noBackendRuntime).toBe(true);
    expect(externalRuntime.checks.noSupabaseRuntime).toBe(true);
    expect(externalRuntime.checks.noReactServiceWorker).toBe(true);
  });

  it('keeps public vehicle data empty and scenario data fictitious', () => {
    const vehiclesPath = resolve(__dirname, '../../../data/vehicles.json');
    const publicVehicles = JSON.parse(readFileSync(vehiclesPath, 'utf-8')) as unknown[];
    const data = validateNoRealCustomerData({ publicVehicles });

    expect(readFileSync(vehiclesPath, 'utf-8').trim()).toBe('[]');
    expect(data.success).toBe(true);
    expect(data.checks.publicVehiclesRemainEmpty).toBe(true);
    expect(data.checks.clientNamesRemainFictitious).toBe(true);
    expect(data.checks.vehicleIdentifiersRemainFictitious).toBe(true);
  });

  it('allows official roles only', () => {
    const matrix = validateStableRoleAndStatusMatrix();

    expect(matrix.success).toBe(true);
    expect(matrix.checks.officialRolesOnly).toBe(true);
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
    const matrix = validateStableRoleAndStatusMatrix();

    expect(matrix.success).toBe(true);
    expect(matrix.checks.officialStatusesOnly).toBe(true);
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

  it('keeps the alpha.12 business workflow coherent', () => {
    const readiness = validateFunctionalFreezeReadiness();

    expect(readiness.checks.alpha12WorkflowPreserved).toBe(true);
    expect(readiness.checks.deliveryBlockedWithoutApprovedQuality).toBe(true);
    expect(readiness.checks.deliveredCannotMoveBackward).toBe(true);
  });

  it('keeps Direction/Admin/Read-only consultation free from mutation', () => {
    const readiness = validateFunctionalFreezeReadiness();

    expect(readiness.checks.consultationWithoutMutation).toBe(true);
  });

  it('requires manual field validation and human GO / NO-GO before tag decision', () => {
    const inputs = validateReleaseCandidateEvaluationInputs();
    const readiness = validateFunctionalFreezeReadiness();
    const summary = summarizeFunctionalFreezeReadiness(readiness);

    expect(inputs.success).toBe(true);
    expect(inputs.checks.manualFieldValidationRequired).toBe(true);
    expect(inputs.checks.humanGoNoGoDecisionRequired).toBe(true);
    expect(readiness.manualFieldValidationRequired).toBe(true);
    expect(readiness.humanGoNoGoDecisionRequired).toBe(true);
    expect(summary).toContain('gel fonctionnel alpha.13 conservé sous rc.1 interne');
    expect(summary).toContain('décision GO / NO-GO requises');
  });

  it('keeps the functional-freeze module pure from browser and storage APIs', () => {
    const source = readFileSync(
      resolve(__dirname, '../src/domain/functional-freeze-readiness.ts'),
      'utf-8',
    );

    for (const forbiddenApi of ['localStorage', 'window', 'document']) {
      expect(source).not.toContain(forbiddenApi);
    }
  });
});
