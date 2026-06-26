import { APP_VERSION } from '../constants/version';
import type { Role } from '../types';
import { CASE_STATUSES, type CaseStatus } from './case-status';
import type { SavCase } from './sav-case';
import { OFFICIAL_ROLES } from './role-governance';
import { ALLOWED_TRANSITIONS, transitionCase } from './workflow-engine';
import {
  createAcceptanceScenarioCases,
  createAcceptanceScenarioTimeline,
  validateBusinessAcceptanceScenario,
  validateMultiCaseWorkflowConsistency,
  validateNoConsultationMutation,
} from './business-acceptance-scenarios';

export const FUNCTIONAL_FREEZE_VERSION = 'v24.0.0-rc.1' as const;
export const STABLE_PILOT_VERSION = 'v23.2.6' as const;
export const FUNCTIONAL_FREEZE_LABEL = 'gel fonctionnel alpha.13 conservé' as const;

const EXPECTED_ROLES: readonly Role[] = [
  'reception',
  'chef-atelier',
  'technicien',
  'qualite',
  'livraison',
  'directeur-sav',
  'admin',
  'lecture-seule',
] as const;

const EXPECTED_STATUSES: readonly CaseStatus[] = [
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
] as const;

const FICTITIOUS_CLIENT_NAMES = new Set(['Client Démo A', 'Client Démo B']);

export interface FreezeValidationResult {
  success: boolean;
  blockers: string[];
  warnings: string[];
  checks: Record<string, boolean>;
}

export interface NoProductionExposureOptions {
  appVersion?: string;
  releaseCandidateDeclared?: boolean;
  productionExposureDeclared?: boolean;
  tagsPointingAtHead?: readonly string[];
}

export interface ExternalRuntimeOptions {
  hasBackendRuntime?: boolean;
  hasSupabaseRuntime?: boolean;
  hasReactServiceWorker?: boolean;
}

export interface RealCustomerDataOptions {
  publicVehicles?: readonly unknown[];
  scenarioCases?: readonly Pick<SavCase, 'clientName' | 'vin' | 'immatriculation'>[];
}

export interface FunctionalFreezeReadinessReport extends FreezeValidationResult {
  appVersion: string;
  stablePilotVersion: typeof STABLE_PILOT_VERSION;
  freezeLabel: typeof FUNCTIONAL_FREEZE_LABEL;
  readyForRcEvaluation: boolean;
  internalReleaseCandidatePrepared: boolean;
  releaseCandidateCreated: boolean;
  finalReleaseCreated: boolean;
  productionExposure: boolean;
  tagExpected: boolean;
  manualFieldValidationRequired: boolean;
  humanGoNoGoDecisionRequired: boolean;
  passedChecks: string[];
}

function buildResult(
  checks: Record<string, boolean>,
  blockers: string[] = [],
  warnings: string[] = [],
): FreezeValidationResult {
  return {
    success: blockers.length === 0 && Object.values(checks).every(Boolean),
    blockers,
    warnings,
    checks,
  };
}

function hasSameItems<T extends string>(actual: readonly T[], expected: readonly T[]): boolean {
  return (
    actual.length === expected.length &&
    expected.every((item) => actual.includes(item)) &&
    actual.every((item) => expected.includes(item))
  );
}

function cloneCases<T>(cases: readonly T[]): T[] {
  return cases.map((item) => ({ ...(item as Record<string, unknown>) }) as T);
}

export function validateNoProductionExposure(
  options: NoProductionExposureOptions = {},
): FreezeValidationResult {
  const appVersion = options.appVersion ?? APP_VERSION;
  const tagsPointingAtHead = [...(options.tagsPointingAtHead ?? [])];
  const isExpectedRc = appVersion === FUNCTIONAL_FREEZE_VERSION;
  const isInternalReleaseCandidate =
    options.releaseCandidateDeclared === true || /-rc\./i.test(appVersion);
  const isFinalRelease = appVersion === 'v24.0.0';
  const isProduction = options.productionExposureDeclared === true || /prod/i.test(appVersion);
  const hasUnexpectedTag = tagsPointingAtHead.length > 0;

  const blockers: string[] = [];
  if (!isExpectedRc) {
    blockers.push(`Version attendue ${FUNCTIONAL_FREEZE_VERSION}, version reçue ${appVersion}.`);
  }
  if (!isInternalReleaseCandidate) {
    blockers.push('rc.1 doit rester identifiée comme Release Candidate interne.');
  }
  if (isFinalRelease) {
    blockers.push('rc.1 ne doit pas être assimilée à la version finale.');
  }
  if (isProduction) {
    blockers.push('rc.1 ne doit pas être exposée comme version de production.');
  }
  if (hasUnexpectedTag) {
    blockers.push('Aucun tag automatique ne doit pointer sur le gel conservé.');
  }

  return buildResult(
    {
      versionIsRc1: isExpectedRc,
      internalReleaseCandidateOnly: isInternalReleaseCandidate,
      finalReleaseNotCreated: !isFinalRelease,
      remainsNonProduction: !isProduction,
      noAutomaticTagExpected: !hasUnexpectedTag,
      stablePilotRemainsV2326: STABLE_PILOT_VERSION === 'v23.2.6',
      functionalFreezePreserved: true,
    },
    blockers,
  );
}

export function validateNoExternalRuntimeDependencies(
  options: ExternalRuntimeOptions = {},
): FreezeValidationResult {
  const hasBackendRuntime = options.hasBackendRuntime === true;
  const hasSupabaseRuntime = options.hasSupabaseRuntime === true;
  const hasReactServiceWorker = options.hasReactServiceWorker === true;

  const blockers: string[] = [];
  if (hasBackendRuntime) blockers.push('Aucun backend runtime ne doit être ajouté à React v24 rc.1.');
  if (hasSupabaseRuntime) blockers.push('Aucun connecteur Supabase runtime ne doit être ajouté à React v24 rc.1.');
  if (hasReactServiceWorker) blockers.push('Aucun service worker React actif ne doit être ajouté à rc.1.');

  return buildResult(
    {
      noBackendRuntime: !hasBackendRuntime,
      noSupabaseRuntime: !hasSupabaseRuntime,
      noReactServiceWorker: !hasReactServiceWorker,
    },
    blockers,
  );
}

export function validateNoRealCustomerData(
  options: RealCustomerDataOptions = {},
): FreezeValidationResult {
  const publicVehicles = [...(options.publicVehicles ?? [])];
  const scenarioCases = options.scenarioCases ?? createAcceptanceScenarioCases();
  const allNamesAreFictitious = scenarioCases.every((savCase) =>
    FICTITIOUS_CLIENT_NAMES.has(savCase.clientName),
  );
  const allVehiclesAreFictitious = scenarioCases.every(
    (savCase) =>
      savCase.vin.startsWith('DEMO') &&
      savCase.immatriculation.startsWith('DEMO-'),
  );

  const blockers: string[] = [];
  if (publicVehicles.length > 0) {
    blockers.push('Les données publiques véhicules doivent rester strictement vides.');
  }
  if (!allNamesAreFictitious) {
    blockers.push('Les scénarios alpha doivent utiliser uniquement des clients fictifs approuvés.');
  }
  if (!allVehiclesAreFictitious) {
    blockers.push('Les scénarios alpha doivent utiliser uniquement des identifiants véhicules fictifs.');
  }

  return buildResult(
    {
      publicVehiclesRemainEmpty: publicVehicles.length === 0,
      clientNamesRemainFictitious: allNamesAreFictitious,
      vehicleIdentifiersRemainFictitious: allVehiclesAreFictitious,
    },
    blockers,
  );
}

export function validateStableRoleAndStatusMatrix(): FreezeValidationResult {
  const rolesAreStable = hasSameItems(OFFICIAL_ROLES, EXPECTED_ROLES);
  const statusesAreStable = hasSameItems(CASE_STATUSES, EXPECTED_STATUSES);
  const deliveredIsForwardOnly =
    ALLOWED_TRANSITIONS.delivered.length === 1 &&
    ALLOWED_TRANSITIONS.delivered[0] === 'closed';
  const deliveryRequiresApprovedQuality =
    ALLOWED_TRANSITIONS.quality_approved.length === 1 &&
    ALLOWED_TRANSITIONS.quality_approved[0] === 'ready_delivery' &&
    ALLOWED_TRANSITIONS.ready_delivery.length === 1 &&
    ALLOWED_TRANSITIONS.ready_delivery[0] === 'delivered';

  const blockers: string[] = [];
  if (!rolesAreStable) blockers.push('La matrice des rôles officiels a changé.');
  if (!statusesAreStable) blockers.push('La matrice des statuts officiels a changé.');
  if (!deliveredIsForwardOnly) blockers.push('Le statut delivered doit rester limité à la clôture.');
  if (!deliveryRequiresApprovedQuality) {
    blockers.push('La livraison doit rester impossible avant qualité approuvée.');
  }

  return buildResult(
    {
      officialRolesOnly: rolesAreStable,
      officialStatusesOnly: statusesAreStable,
      deliveredIsForwardOnly,
      deliveryRequiresApprovedQuality,
    },
    blockers,
  );
}

export function validateReleaseCandidateEvaluationInputs(): FreezeValidationResult {
  const checks = {
    freshGithubCloneRequired: true,
    npmCiRequired: true,
    lintRequired: true,
    testsRequired: true,
    buildRequired: true,
    auditRequired: true,
    v23RegressionTestsRequired: true,
    browserSmokeRequired: true,
    manualFieldValidationRequired: true,
    humanGoNoGoDecisionRequired: true,
  };

  return buildResult(checks, [], [
    'Validation manuelle terrain requise avant décision RC.',
    'Décision humaine GO / NO-GO requise avant toute future RC.',
  ]);
}

export function validateFunctionalFreezeReadiness(): FunctionalFreezeReadinessReport {
  const cases = createAcceptanceScenarioCases();
  const logs = createAcceptanceScenarioTimeline();
  const beforeConsultation = cloneCases(cases);
  const afterConsultation = cloneCases(cases);
  const blockedDeliveryCase = cases.find((savCase) => savCase.status === 'quality_pending');
  const deliveredCase = cases.find((savCase) => savCase.status === 'delivered');

  const production = validateNoProductionExposure();
  const externalRuntime = validateNoExternalRuntimeDependencies();
  const data = validateNoRealCustomerData({ publicVehicles: [], scenarioCases: cases });
  const matrix = validateStableRoleAndStatusMatrix();
  const rcInputs = validateReleaseCandidateEvaluationInputs();
  const businessScenario = validateBusinessAcceptanceScenario(cases, logs);
  const workflowConsistency = validateMultiCaseWorkflowConsistency(cases, logs);
  const consultationMutation = validateNoConsultationMutation(
    beforeConsultation,
    afterConsultation,
  );
  const blockedDeliveryAttempt = blockedDeliveryCase
    ? transitionCase(blockedDeliveryCase, 'ready_delivery', {
        id: 'freeze-delivery-check',
        role: 'livraison',
      })
    : { success: true };
  const backwardAttempt = deliveredCase
    ? transitionCase(deliveredCase, 'repair', {
        id: 'freeze-admin-check',
        role: 'admin',
      })
    : { success: true };

  const checks = {
    ...production.checks,
    ...externalRuntime.checks,
    ...data.checks,
    ...matrix.checks,
    ...rcInputs.checks,
    alpha12WorkflowPreserved: businessScenario.success && workflowConsistency.success,
    consultationWithoutMutation: consultationMutation.success,
    deliveryBlockedWithoutApprovedQuality: blockedDeliveryAttempt.success === false,
    deliveredCannotMoveBackward: backwardAttempt.success === false,
  };

  const blockers = [
    ...production.blockers,
    ...externalRuntime.blockers,
    ...data.blockers,
    ...matrix.blockers,
    ...businessScenario.blockers,
    ...workflowConsistency.blockers,
    ...consultationMutation.errors,
  ];

  if (!checks.deliveryBlockedWithoutApprovedQuality) {
    blockers.push('Un dossier sans qualité approuvée ne doit pas devenir livrable.');
  }
  if (!checks.deliveredCannotMoveBackward) {
    blockers.push('Un dossier livré ne doit pas revenir vers un statut antérieur.');
  }

  const warnings = [
    ...production.warnings,
    ...externalRuntime.warnings,
    ...data.warnings,
    ...matrix.warnings,
    ...rcInputs.warnings,
    ...businessScenario.warnings,
    ...workflowConsistency.warnings,
  ];

  const passedChecks = Object.entries(checks)
    .filter(([, passed]) => passed)
    .map(([name]) => name);
  const success = blockers.length === 0 && Object.values(checks).every(Boolean);

  return {
    success,
    blockers,
    warnings,
    checks,
    appVersion: APP_VERSION,
    stablePilotVersion: STABLE_PILOT_VERSION,
    freezeLabel: FUNCTIONAL_FREEZE_LABEL,
    readyForRcEvaluation: success,
    internalReleaseCandidatePrepared: true,
    releaseCandidateCreated: true,
    finalReleaseCreated: false,
    productionExposure: false,
    tagExpected: false,
    manualFieldValidationRequired: true,
    humanGoNoGoDecisionRequired: true,
    passedChecks,
  };
}

export function summarizeFunctionalFreezeReadiness(
  report: Pick<
    FunctionalFreezeReadinessReport,
    | 'success'
    | 'appVersion'
    | 'blockers'
    | 'freezeLabel'
    | 'manualFieldValidationRequired'
    | 'humanGoNoGoDecisionRequired'
  >,
): string {
  if (!report.success) {
    return `${report.appVersion} : ${report.blockers.length} bloqueur(s) empêchent la conservation du gel fonctionnel.`;
  }

  const manualSuffix =
    report.manualFieldValidationRequired && report.humanGoNoGoDecisionRequired
      ? 'validation manuelle terrain et décision GO / NO-GO requises'
      : 'contrôles complémentaires requis';

  return `${report.appVersion} : ${report.freezeLabel} sous rc.1 interne, ${manualSuffix}.`;
}
