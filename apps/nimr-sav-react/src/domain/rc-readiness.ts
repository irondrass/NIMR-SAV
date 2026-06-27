import { APP_VERSION } from '../constants/version';
import type { Role } from '../types';
import { CASE_STATUSES, type CaseStatus } from './case-status';
import { OFFICIAL_ROLES } from './role-governance';
import { transitionCase } from './workflow-engine';
import {
  createAcceptanceScenarioCases,
  createAcceptanceScenarioTimeline,
  validateBusinessAcceptanceScenario,
  validateMultiCaseWorkflowConsistency,
  validateNoConsultationMutation,
} from './business-acceptance-scenarios';
import {
  STABLE_PILOT_VERSION,
  validateFunctionalFreezeReadiness,
  validateNoExternalRuntimeDependencies,
  validateNoRealCustomerData,
  validateStableRoleAndStatusMatrix,
} from './functional-freeze-readiness';

// alpha.19 prépare une décision humaine avant une nouvelle RC éventuelle.
// Ce module conserve les contrôles de readiness sans promouvoir alpha.19 en RC.
export const RC_READINESS_VERSION = 'v24.0.0-alpha.19' as const;

const OFFICIAL_RC_ROLES: readonly Role[] = [
  'reception',
  'chef-atelier',
  'technicien',
  'qualite',
  'livraison',
  'directeur-sav',
  'admin',
  'lecture-seule',
] as const;

const OFFICIAL_RC_STATUSES: readonly CaseStatus[] = [
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

export interface RcReadinessOptions {
  appVersion?: string;
  tagsPointingAtHead?: readonly string[];
  productionExposureDeclared?: boolean;
  finalReleaseDeclared?: boolean;
  hasBackendRuntime?: boolean;
  hasSupabaseRuntime?: boolean;
  hasReactServiceWorker?: boolean;
  publicVehicles?: readonly unknown[];
}

export interface RcValidationResult {
  success: boolean;
  blockers: string[];
  warnings: string[];
  checks: Record<string, boolean>;
}

export interface RcRiskRegisterItem {
  id: string;
  label: string;
  severity: 'blocking' | 'major' | 'monitoring';
  mitigated: boolean;
  evidence: string;
}

export interface RcRiskRegisterResult extends RcValidationResult {
  risks: readonly RcRiskRegisterItem[];
}

export interface RcReadinessReport extends RcValidationResult {
  appVersion: string;
  internalReleaseCandidate: boolean;
  finalRelease: boolean;
  productionExposure: boolean;
  automaticTagExpected: boolean;
  stablePilotVersion: typeof STABLE_PILOT_VERSION;
  manualFieldValidationRequired: boolean;
  humanGoNoGoDecisionRequired: boolean;
  technicalEvidence: RcValidationResult;
  businessEvidence: RcValidationResult;
  riskRegister: RcRiskRegisterResult;
  goNoGoInputs: RcValidationResult;
  passedChecks: string[];
}

function buildResult(
  checks: Record<string, boolean>,
  blockers: string[] = [],
  warnings: string[] = [],
): RcValidationResult {
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

export function validateRcScopeFreeze(options: RcReadinessOptions = {}): RcValidationResult {
  const appVersion = options.appVersion ?? APP_VERSION;
  const tagsPointingAtHead = [...(options.tagsPointingAtHead ?? [])];
  const versionIsRc1 = appVersion === RC_READINESS_VERSION;
  const internalReleaseCandidate = /-alpha\./i.test(appVersion);
  const finalRelease = options.finalReleaseDeclared === true || appVersion === 'v24.0.0';
  const productionExposure =
    options.productionExposureDeclared === true || /prod/i.test(appVersion);
  const automaticTagExpected = tagsPointingAtHead.length > 0;

  const blockers: string[] = [];
  if (!versionIsRc1) blockers.push(`Version attendue ${RC_READINESS_VERSION}, reçue ${appVersion}.`);
  if (!internalReleaseCandidate) blockers.push('alpha.19 doit rester une version interne.');
  if (finalRelease) blockers.push('alpha.19 ne doit pas être assimilée à la version finale.');
  if (productionExposure) blockers.push('alpha.19 ne doit pas être exposée comme déploiement production.');
  if (automaticTagExpected) blockers.push('Aucun tag automatique ne doit être attendu pour alpha.19.');

  return buildResult(
    {
      versionIsRc1,
      internalReleaseCandidate,
      finalReleaseNotCreated: !finalRelease,
      productionExposureAbsent: !productionExposure,
      noAutomaticTagExpected: !automaticTagExpected,
      stablePilotRemainsV2326: STABLE_PILOT_VERSION === 'v23.2.6',
    },
    blockers,
  );
}

export function validateRcTechnicalEvidence(
  options: RcReadinessOptions = {},
): RcValidationResult {
  const runtime = validateNoExternalRuntimeDependencies({
    hasBackendRuntime: options.hasBackendRuntime,
    hasSupabaseRuntime: options.hasSupabaseRuntime,
    hasReactServiceWorker: options.hasReactServiceWorker,
  });
  const data = validateNoRealCustomerData({
    publicVehicles: options.publicVehicles ?? [],
    scenarioCases: createAcceptanceScenarioCases(),
  });

  const checks = {
    publicVehiclesRemainEmpty: data.checks.publicVehiclesRemainEmpty,
    noBackendRuntime: runtime.checks.noBackendRuntime,
    noSupabaseRuntime: runtime.checks.noSupabaseRuntime,
    noReactServiceWorker: runtime.checks.noReactServiceWorker,
    npmCiEvidenceRequired: true,
    lintEvidenceRequired: true,
    testEvidenceRequired: true,
    buildEvidenceRequired: true,
    auditEvidenceRequired: true,
    freshCloneEvidenceRequired: true,
  };

  return buildResult(checks, [...runtime.blockers, ...data.blockers], [
    'Les preuves npm ci, lint, tests, build, audit et clone frais restent obligatoires avant nouvelle RC éventuelle.',
    ...runtime.warnings,
    ...data.warnings,
  ]);
}

export function validateRcBusinessEvidence(): RcValidationResult {
  const cases = createAcceptanceScenarioCases();
  const logs = createAcceptanceScenarioTimeline();
  const beforeConsultation = cloneCases(cases);
  const afterConsultation = cloneCases(cases);
  const blockedDeliveryCase = cases.find((savCase) => savCase.status === 'quality_pending');
  const deliveredCase = cases.find((savCase) => savCase.status === 'delivered');

  const matrix = validateStableRoleAndStatusMatrix();
  const business = validateBusinessAcceptanceScenario(cases, logs);
  const consistency = validateMultiCaseWorkflowConsistency(cases, logs);
  const freeze = validateFunctionalFreezeReadiness();
  const consultation = validateNoConsultationMutation(beforeConsultation, afterConsultation);
  const blockedDeliveryAttempt = blockedDeliveryCase
    ? transitionCase(blockedDeliveryCase, 'ready_delivery', {
        id: 'rc-delivery-check',
        role: 'livraison',
      })
    : { success: true };
  const backwardAttempt = deliveredCase
    ? transitionCase(deliveredCase, 'repair', {
        id: 'rc-admin-check',
        role: 'admin',
      })
    : { success: true };

  const rolesOfficial = hasSameItems(OFFICIAL_ROLES, OFFICIAL_RC_ROLES);
  const statusesOfficial = hasSameItems(CASE_STATUSES, OFFICIAL_RC_STATUSES);

  const checks = {
    officialRolesOnly: rolesOfficial && matrix.checks.officialRolesOnly,
    officialStatusesOnly: statusesOfficial && matrix.checks.officialStatusesOnly,
    alpha12WorkflowPreserved: business.success && consistency.success,
    alpha13FunctionalFreezePreserved: freeze.success && freeze.checks.functionalFreezePreserved,
    consultationWithoutMutation: consultation.success,
    deliveryBlockedWithoutApprovedQuality: blockedDeliveryAttempt.success === false,
    deliveredCannotMoveBackward: backwardAttempt.success === false,
  };

  const blockers = [
    ...matrix.blockers,
    ...business.blockers,
    ...consistency.blockers,
    ...freeze.blockers,
    ...consultation.errors,
  ];

  if (!rolesOfficial) blockers.push('La matrice des rôles officiels alpha.19 a changé.');
  if (!statusesOfficial) blockers.push('La matrice des statuts officiels alpha.19 a changé.');
  if (!checks.deliveryBlockedWithoutApprovedQuality) {
    blockers.push('La livraison doit rester bloquée sans qualité approuvée.');
  }
  if (!checks.deliveredCannotMoveBackward) {
    blockers.push('Un dossier delivered ne doit pas revenir en arrière.');
  }

  return buildResult(checks, blockers, [
    ...matrix.warnings,
    ...business.warnings,
    ...consistency.warnings,
    ...freeze.warnings,
  ]);
}

export function validateRcRiskRegister(): RcRiskRegisterResult {
  const risks: readonly RcRiskRegisterItem[] = [
    {
      id: 'real_customer_data',
      label: 'Donnée client réelle détectée dans la préparation alpha.19',
      severity: 'blocking',
      mitigated: true,
      evidence: 'Scénarios fictifs et données véhicules publiques vides',
    },
    {
      id: 'unauthorized_role',
      label: 'Rôle non autorisé dans une transition métier',
      severity: 'blocking',
      mitigated: true,
      evidence: 'Matrice limitée aux huit rôles officiels',
    },
    {
      id: 'delivery_without_quality',
      label: 'Livraison sans qualité approuvée',
      severity: 'blocking',
      mitigated: true,
      evidence: 'Transitions livraison gardées par contrôle qualité',
    },
    {
      id: 'readonly_mutation',
      label: 'Mutation depuis Direction, Admin ou Lecture seule',
      severity: 'blocking',
      mitigated: true,
      evidence: 'Consultations validées sans mutation de dossier',
    },
    {
      id: 'console_or_build_failure',
      label: 'Erreur console critique ou échec test/build/audit',
      severity: 'major',
      mitigated: true,
      evidence: 'Preuves automatisées requises avant décision humaine',
    },
    {
      id: 'manual_validation_gap',
      label: 'Validation terrain non réalisée',
      severity: 'blocking',
      mitigated: false,
      evidence: 'Validation manuelle obligatoire avant nouvelle RC éventuelle',
    },
  ];
  const openBlockingRisks = risks.filter(
    (risk) => risk.severity === 'blocking' && !risk.mitigated,
  );

  return {
    ...buildResult(
      {
        riskRegisterPresent: risks.length > 0,
        blockingRisksIdentified: openBlockingRisks.length > 0,
        manualValidationRiskOpen: true,
      },
      [],
      ['Le risque de validation terrain reste ouvert jusqu’à décision GO / NO-GO humaine.'],
    ),
    risks,
  };
}

export function validateRcGoNoGoInputs(): RcValidationResult {
  return buildResult(
    {
      localValidationRequired: true,
      freshGithubCloneRequired: true,
      manualFieldValidationRequired: true,
      humanGoNoGoDecisionRequired: true,
      noAutomaticTagExpected: true,
      noProductionDeploymentExpected: true,
      finalReleaseOutOfScope: true,
    },
    [],
    ['Aucun tag ne doit être créé depuis alpha.19 sans décision humaine explicite.'],
  );
}

export function validateRcReadiness(options: RcReadinessOptions = {}): RcReadinessReport {
  const scope = validateRcScopeFreeze(options);
  const technicalEvidence = validateRcTechnicalEvidence(options);
  const businessEvidence = validateRcBusinessEvidence();
  const riskRegister = validateRcRiskRegister();
  const goNoGoInputs = validateRcGoNoGoInputs();

  const checks = {
    ...scope.checks,
    ...technicalEvidence.checks,
    ...businessEvidence.checks,
    riskRegisterPresent: riskRegister.checks.riskRegisterPresent,
    manualFieldValidationRequired: goNoGoInputs.checks.manualFieldValidationRequired,
    humanGoNoGoDecisionRequired: goNoGoInputs.checks.humanGoNoGoDecisionRequired,
    noProductionDeploymentExpected: goNoGoInputs.checks.noProductionDeploymentExpected,
    finalReleaseOutOfScope: goNoGoInputs.checks.finalReleaseOutOfScope,
  };
  const blockers = [
    ...scope.blockers,
    ...technicalEvidence.blockers,
    ...businessEvidence.blockers,
    ...riskRegister.blockers,
    ...goNoGoInputs.blockers,
  ];
  const warnings = [
    ...scope.warnings,
    ...technicalEvidence.warnings,
    ...businessEvidence.warnings,
    ...riskRegister.warnings,
    ...goNoGoInputs.warnings,
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
    appVersion: options.appVersion ?? APP_VERSION,
    internalReleaseCandidate: false,
    finalRelease: false,
    productionExposure: false,
    automaticTagExpected: false,
    stablePilotVersion: STABLE_PILOT_VERSION,
    manualFieldValidationRequired: true,
    humanGoNoGoDecisionRequired: true,
    technicalEvidence,
    businessEvidence,
    riskRegister,
    goNoGoInputs,
    passedChecks,
  };
}

export function summarizeRcReadiness(
  report: Pick<
    RcReadinessReport,
    | 'success'
    | 'appVersion'
    | 'blockers'
    | 'internalReleaseCandidate'
    | 'finalRelease'
    | 'productionExposure'
    | 'automaticTagExpected'
    | 'manualFieldValidationRequired'
    | 'humanGoNoGoDecisionRequired'
  >,
): string {
  if (!report.success) {
    return `${report.appVersion} : ${report.blockers.length} bloqueur(s) à lever avant décision de nouvelle RC éventuelle.`;
  }

  const scope =
    !report.finalRelease &&
    !report.productionExposure &&
    !report.automaticTagExpected
      ? 'alpha.19 interne, non RC, non finale, non production, sans tag automatique'
      : 'périmètre alpha.19 à revalider';
  const decision =
    report.manualFieldValidationRequired && report.humanGoNoGoDecisionRequired
      ? 'validation terrain manuelle et décision GO / NO-GO humaine obligatoires'
      : 'arbitrage complémentaire requis';

  return `${report.appVersion} : ${scope}; ${decision}.`;
}
