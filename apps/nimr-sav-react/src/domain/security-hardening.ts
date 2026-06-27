import { Role, ALL_ROLES } from '../types';
import { Action, hasPermission } from './action-permissions';
import {
  ALL_ACTIONS,
  OFFICIAL_ROLES,
  WRITE_ACTIONS,
  getRoleGovernanceMatrix,
  isOfficialRole,
} from './role-governance';

export type SecurityHardeningStatus = 'pass' | 'warning' | 'fail';

export interface SecurityHardeningCheck {
  id: string;
  label: string;
  status: SecurityHardeningStatus;
  details: string;
}

export interface SecurityBoundaryResult {
  allowed: boolean;
  status: SecurityHardeningStatus;
  reason: string;
}

export interface ForbiddenMutationDetection {
  forbidden: boolean;
  role: string;
  action: string;
  reason: string;
}

export interface SecurityHardeningSummary {
  score: number;
  status: SecurityHardeningStatus;
  checks: SecurityHardeningCheck[];
  warnings: string[];
  blockers: string[];
  officialRoles: readonly Role[];
}

const FIELD_OPERATION_ACTIONS: readonly Action[] = [
  'create_case',
  'receive_case',
  'assign_technician',
  'schedule_case',
  'change_workshop_status',
  'start_repair',
  'complete_repair',
  'update_task_status',
  'complete_work',
  'validate_qc',
  'reject_qc',
  'request_rework',
  'start_quality_check',
  'send_to_rework',
  'prepare_delivery',
  'deliver_case',
  'add_delivery_proof',
  'manage_claims',
  'approve_claim_expert',
  'approve_claim_client',
  'override_claims',
  'manage_case_photos',
];

const DIRECTOR_VALIDATED_MUTATIONS: readonly Action[] = [
  'close_case',
  'edit_direction_notes',
];

function isKnownAction(action: unknown): action is Action {
  return ALL_ACTIONS.includes(action as Action);
}

function makeCheck(
  id: string,
  label: string,
  ok: boolean,
  details: string,
  warning = false
): SecurityHardeningCheck {
  return {
    id,
    label,
    status: ok ? (warning ? 'warning' : 'pass') : 'fail',
    details,
  };
}

export function validateRoleActionBoundary(
  role: unknown,
  action: unknown,
  options: { mutationIntent?: boolean } = {}
): SecurityBoundaryResult {
  if (!isOfficialRole(role)) {
    return {
      allowed: false,
      status: 'fail',
      reason: `Rôle non officiel refusé : ${String(role)}.`,
    };
  }

  if (!isKnownAction(action)) {
    return {
      allowed: false,
      status: 'fail',
      reason: `Action non officielle refusée : ${String(action)}.`,
    };
  }

  if (options.mutationIntent && role === 'lecture-seule') {
    return {
      allowed: false,
      status: 'fail',
      reason: 'Le rôle lecture-seule ne déclenche aucune mutation.',
    };
  }

  if (role === 'technicien' && action === 'export_complete_case') {
    return {
      allowed: false,
      status: 'fail',
      reason: 'Le rôle technicien ne peut pas exporter un dossier complet.',
    };
  }

  if (
    role === 'directeur-sav' &&
    FIELD_OPERATION_ACTIONS.includes(action) &&
    !DIRECTOR_VALIDATED_MUTATIONS.includes(action)
  ) {
    return {
      allowed: false,
      status: 'fail',
      reason: 'Direction SAV reste en lecture/pilotage pour les opérations terrain.',
    };
  }

  const allowed = hasPermission(role, action);
  return {
    allowed,
    status: allowed ? 'pass' : 'fail',
    reason: allowed ? 'Frontière rôle/action validée.' : `Action ${action} interdite pour ${role}.`,
  };
}

export function detectForbiddenRoleMutation(role: unknown, action: unknown): ForbiddenMutationDetection {
  const roleLabel = String(role);
  const actionLabel = String(action);
  const boundary = validateRoleActionBoundary(role, action, { mutationIntent: true });

  if (!isKnownAction(action)) {
    return {
      forbidden: true,
      role: roleLabel,
      action: actionLabel,
      reason: boundary.reason,
    };
  }

  const isMutation = WRITE_ACTIONS.includes(action) || FIELD_OPERATION_ACTIONS.includes(action);
  const forbidden = isMutation && !boundary.allowed;
  return {
    forbidden,
    role: roleLabel,
    action: actionLabel,
    reason: forbidden ? boundary.reason : 'Aucune mutation interdite détectée.',
  };
}

export function buildSecurityReadinessChecklist(): SecurityHardeningCheck[] {
  const matrix = getRoleGovernanceMatrix();
  const configuredRoles = new Set(matrix.map((entry) => entry.role));
  const configuredRoleNames = ALL_ROLES.map((role) => role);

  const unofficialConfiguredRoles = configuredRoleNames.filter((role) => !OFFICIAL_ROLES.includes(role));
  const missingRoles = OFFICIAL_ROLES.filter((role) => !configuredRoles.has(role));
  const readonlyWrites = matrix
    .find((entry) => entry.role === 'lecture-seule')
    ?.allowedActions.filter((action) => WRITE_ACTIONS.includes(action)) ?? [];

  const technicianCanExport = hasPermission('technicien', 'export_complete_case');
  const directorFieldMutations = FIELD_OPERATION_ACTIONS.filter((action) =>
    hasPermission('directeur-sav', action) && !DIRECTOR_VALIDATED_MUTATIONS.includes(action)
  );
  const qcDeliveryLeak = [
    hasPermission('qualite', 'deliver_case'),
    hasPermission('qualite', 'prepare_delivery'),
    hasPermission('livraison', 'validate_qc'),
    hasPermission('livraison', 'reject_qc'),
  ].some(Boolean);

  return [
    makeCheck(
      'official_roles_only',
      'Rôles officiels uniquement',
      unofficialConfiguredRoles.length === 0 && missingRoles.length === 0,
      missingRoles.length > 0
        ? `Rôles manquants : ${missingRoles.join(', ')}.`
        : 'Les huit rôles officiels sont configurés, sans rôle additionnel.'
    ),
    makeCheck(
      'readonly_no_write',
      'Lecture seule sans mutation',
      readonlyWrites.length === 0,
      readonlyWrites.length > 0
        ? `Actions mutantes exposées en lecture seule : ${readonlyWrites.join(', ')}.`
        : 'Lecture seule ne possède aucun droit de mutation.'
    ),
    makeCheck(
      'technician_no_full_export',
      'Technicien sans export complet',
      !technicianCanExport,
      technicianCanExport
        ? 'Le rôle technicien peut exporter un dossier complet.'
        : 'Export complet refusé au rôle technicien.'
    ),
    makeCheck(
      'director_field_readonly',
      'Direction SAV sans mutation terrain non validée',
      directorFieldMutations.length === 0,
      directorFieldMutations.length > 0
        ? `Mutations terrain exposées à Direction SAV : ${directorFieldMutations.join(', ')}.`
        : 'Direction SAV reste limitée au pilotage, aux exports et aux droits existants validés.'
    ),
    makeCheck(
      'quality_delivery_separation',
      'Qualité et livraison séparées',
      !qcDeliveryLeak,
      qcDeliveryLeak
        ? 'Une action qualité/livraison traverse la frontière de rôle.'
        : 'Qualité ne livre pas et Livraison ne valide pas le contrôle qualité.'
    ),
    makeCheck(
      'admin_not_business_bypass',
      'Admin réservé aux diagnostics et exceptions tracées',
      true,
      'Admin conserve ses droits techniques ; les statuts métier restent contrôlés par le moteur de workflow.',
      true
    ),
  ];
}

export function auditRolePermissionMatrix(): SecurityHardeningSummary {
  const checks = buildSecurityReadinessChecklist();
  const blockers = checks.filter((check) => check.status === 'fail').map((check) => check.details);
  const warnings = checks.filter((check) => check.status === 'warning').map((check) => check.details);
  const passed = checks.filter((check) => check.status !== 'fail').length;
  const score = Math.round((passed / checks.length) * 100);

  return {
    score,
    status: blockers.length > 0 ? 'fail' : warnings.length > 0 ? 'warning' : 'pass',
    checks,
    warnings,
    blockers,
    officialRoles: OFFICIAL_ROLES,
  };
}

export function getSecurityHardeningWarnings(): string[] {
  return auditRolePermissionMatrix().warnings;
}

export function summarizeSecurityHardening(): SecurityHardeningSummary {
  return auditRolePermissionMatrix();
}
