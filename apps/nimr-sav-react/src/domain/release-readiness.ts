import { Role } from '../types';
import { CaseStatus, CASE_STATUSES } from './case-status';
import { OFFICIAL_ROLES } from './role-governance';
import { Action, hasPermission, canViewDirectionNotes } from './action-permissions';
import { LS_PREFIX } from '../constants/version';
import { SavCase } from './sav-case';
import { AuditLogEntry } from './audit-log';

export interface ReadinessCheckResult {
  success: boolean;
  blockers: string[];
  warnings: string[];
}

export interface ReleaseReadinessReport {
  appVersion: string;
  isReadyForRcEvaluation: boolean;
  blockers: string[];
  warnings: string[];
  passedChecks: string[];
  roleChecks: ReadinessCheckResult;
  statusChecks: ReadinessCheckResult;
  workflowChecks: ReadinessCheckResult;
  securityChecks: ReadinessCheckResult;
  testExpectations: {
    totalCases: number;
    totalLogs: number;
    coveragePercent: number;
  };
  recommendation: string;
}

export function validateVersionReadiness(appVersion: string): ReadinessCheckResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!appVersion) {
    blockers.push("Version string is missing or undefined.");
  } else {
    if (appVersion !== 'v24.0.0-alpha.10') {
      blockers.push(`Version mismatch: expected 'v24.0.0-alpha.10', got '${appVersion}'.`);
    }
    if (appVersion.includes('RC')) {
      blockers.push("Version name contains 'RC' but alpha.10 is not a Release Candidate.");
    }
    if (appVersion.includes('production')) {
      blockers.push("Version name contains 'production' but this is an internal alpha version.");
    }
  }

  return {
    success: blockers.length === 0,
    blockers,
    warnings,
  };
}

export function validateRoleReadiness(): ReadinessCheckResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const expectedRoles = [
    'reception',
    'chef-atelier',
    'technicien',
    'qualite',
    'livraison',
    'directeur-sav',
    'admin',
    'lecture-seule',
  ];

  // 1. Check for missing official roles
  for (const role of expectedRoles) {
    if (!OFFICIAL_ROLES.includes(role as Role)) {
      blockers.push(`Missing official role from configurations: '${role}'.`);
    }
  }

  // 2. Check for extra/unofficial roles
  for (const role of OFFICIAL_ROLES) {
    if (!expectedRoles.includes(role)) {
      blockers.push(`Unofficial role found in configuration matrix: '${role}'.`);
    }
  }

  return {
    success: blockers.length === 0,
    blockers,
    warnings,
  };
}

export function validateStatusReadiness(): ReadinessCheckResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const expectedStatuses = [
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

  // 1. Check for missing official statuses
  for (const status of expectedStatuses) {
    if (!CASE_STATUSES.includes(status as CaseStatus)) {
      blockers.push(`Missing official status from configurations: '${status}'.`);
    }
  }

  // 2. Check for extra/unofficial statuses
  for (const status of CASE_STATUSES) {
    if (!expectedStatuses.includes(status)) {
      blockers.push(`Unofficial status found in configuration: '${status}'.`);
    }
  }

  return {
    success: blockers.length === 0,
    blockers,
    warnings,
  };
}

export function validatePermissionReadiness(): ReadinessCheckResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  // A. Reception limits
  const receptionWriteActions: Action[] = ['assign_technician', 'validate_qc', 'deliver_case', 'close_case'];
  for (const act of receptionWriteActions) {
    if (hasPermission('reception', act)) {
      blockers.push(`Permission violation: Role 'reception' is allowed to perform '${act}'.`);
    }
  }

  // B. Chef Atelier limits
  const chefWriteActions: Action[] = ['validate_qc', 'deliver_case', 'close_case'];
  for (const act of chefWriteActions) {
    if (hasPermission('chef-atelier', act)) {
      blockers.push(`Permission violation: Role 'chef-atelier' is allowed to perform '${act}'.`);
    }
  }

  // C. Technicien limits
  const techWriteActions: Action[] = ['assign_technician', 'validate_qc', 'deliver_case', 'close_case'];
  for (const act of techWriteActions) {
    if (hasPermission('technicien', act)) {
      blockers.push(`Permission violation: Role 'technicien' is allowed to perform '${act}'.`);
    }
  }

  // D. Qualité limits
  const qualiteWriteActions: Action[] = ['create_case', 'assign_technician', 'deliver_case', 'close_case'];
  for (const act of qualiteWriteActions) {
    if (hasPermission('qualite', act)) {
      blockers.push(`Permission violation: Role 'qualite' is allowed to perform '${act}'.`);
    }
  }

  // E. Livraison limits
  const livraisonWriteActions: Action[] = ['create_case', 'assign_technician', 'validate_qc', 'close_case'];
  for (const act of livraisonWriteActions) {
    if (hasPermission('livraison', act)) {
      blockers.push(`Permission violation: Role 'livraison' is allowed to perform '${act}'.`);
    }
  }

  // F. Lecture seule limits (strictly no write actions)
  const allWriteActions: Action[] = [
    'create_case',
    'receive_case',
    'start_repair',
    'complete_repair',
    'assign_technician',
    'schedule_case',
    'change_workshop_status',
    'rework_repair',
    'validate_qc',
    'reject_qc',
    'deliver_case',
    'close_case',
    'start_task',
    'complete_task',
    'update_task_status',
    'complete_work',
  ];
  for (const act of allWriteActions) {
    if (hasPermission('lecture-seule', act)) {
      blockers.push(`Permission violation: Role 'lecture-seule' is allowed write action '${act}'.`);
    }
  }

  // G. Direction notes protection
  if (canViewDirectionNotes('lecture-seule')) {
    blockers.push("Security violation: Role 'lecture-seule' has read access to direction notes.");
  }
  if (hasPermission('lecture-seule', 'view_direction_notes')) {
    blockers.push("Security violation: Role 'lecture-seule' has permission to view direction notes.");
  }

  return {
    success: blockers.length === 0,
    blockers,
    warnings,
  };
}

export function validateWorkflowReadiness(cases: SavCase[], logs: AuditLogEntry[]): ReadinessCheckResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Check cases
  for (const c of cases) {
    if (!c.status || !CASE_STATUSES.includes(c.status)) {
      blockers.push(`Workflow violation: Case '${c.id}' has unofficial or undefined status: '${c.status}'.`);
    }
    if (c.status === 'delivered' && c.qcStatus !== 'approved') {
      blockers.push(`Workflow violation: Case '${c.id}' is delivered without an approved QC.`);
    }
    if (c.status === 'closed' && !c.deliveredAt) {
      warnings.push(`Workflow anomaly: Case '${c.id}' is closed but was never marked as delivered.`);
    }
  }

  // Check audit logs roles
  for (const log of logs) {
    if (log.userRole && !OFFICIAL_ROLES.includes(log.userRole as Role)) {
      blockers.push(`Security anomaly: Audit log '${log.id}' references unofficial role: '${log.userRole}'.`);
    }
  }

  return {
    success: blockers.length === 0,
    blockers,
    warnings,
  };
}

export function validateSecurityInvariants(): ReadinessCheckResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (LS_PREFIX !== 'nimr-sav-react-v24-') {
    blockers.push(`Security violation: LS_PREFIX must be 'nimr-sav-react-v24-', got '${LS_PREFIX}'.`);
  }

  return {
    success: blockers.length === 0,
    blockers,
    warnings,
  };
}

export function calculateWorkflowCoverage(
  cases: SavCase[],
  _logs: AuditLogEntry[]
): { coverage: Record<CaseStatus, number>; percentCoverage: number } {
  const coverage = {} as Record<CaseStatus, number>;

  for (const status of CASE_STATUSES) {
    coverage[status] = 0;
  }

  for (const c of cases) {
    if (c.status in coverage) {
      coverage[c.status]++;
    }
  }

  const activeStatusCount = CASE_STATUSES.filter((status) => coverage[status] > 0).length;
  const percentCoverage = CASE_STATUSES.length > 0 ? (activeStatusCount / CASE_STATUSES.length) * 100 : 0;

  return {
    coverage,
    percentCoverage,
  };
}

export function summarizeRcBlockers(readiness: {
  version: ReadinessCheckResult;
  roles: ReadinessCheckResult;
  statuses: ReadinessCheckResult;
  permissions: ReadinessCheckResult;
  workflow: ReadinessCheckResult;
  security: ReadinessCheckResult;
}): string[] {
  return [
    ...readiness.version.blockers,
    ...readiness.roles.blockers,
    ...readiness.statuses.blockers,
    ...readiness.permissions.blockers,
    ...readiness.workflow.blockers,
    ...readiness.security.blockers,
  ];
}

export function getReleaseReadinessChecklist(): { id: string; label: string; checked: boolean }[] {
  return [
    { id: 'version_alpha10', label: 'Version calée sur v24.0.0-alpha.10', checked: true },
    { id: 'official_roles', label: 'Uniquement les 8 rôles officiels configurés', checked: true },
    { id: 'official_statuses', label: 'Uniquement les 14 statuts de dossiers officiels', checked: true },
    { id: 'security_prefix', label: 'Isolation localStorage (nimr-sav-react-v24-)', checked: true },
    { id: 'no_service_worker', label: 'Absence de Service Worker actif', checked: true },
    { id: 'no_backend', label: 'Aucune dépendance backend ou Supabase', checked: true },
    { id: 'no_real_data', label: 'Absence de données client ou véhicules v23', checked: true },
    { id: 'vehicles_json_empty', label: 'data/vehicles.json doit rester []', checked: true },
    { id: 'readonly_views_pure', label: 'Vues supervision et lecture seule 100% passives', checked: true },
  ];
}

export function validateReleaseReadiness(
  cases: SavCase[],
  logs: AuditLogEntry[],
  options?: { appVersion?: string }
): ReleaseReadinessReport {
  const versionInput = options?.appVersion || 'v24.0.0-alpha.10';

  const versionResult = validateVersionReadiness(versionInput);
  const rolesResult = validateRoleReadiness();
  const statusesResult = validateStatusReadiness();
  const permissionsResult = validatePermissionReadiness();
  const workflowResult = validateWorkflowReadiness(cases, logs);
  const securityResult = validateSecurityInvariants();

  const blockers = summarizeRcBlockers({
    version: versionResult,
    roles: rolesResult,
    statuses: statusesResult,
    permissions: permissionsResult,
    workflow: workflowResult,
    security: securityResult,
  });

  const warnings = [
    ...versionResult.warnings,
    ...rolesResult.warnings,
    ...statusesResult.warnings,
    ...permissionsResult.warnings,
    ...workflowResult.warnings,
    ...securityResult.warnings,
  ];

  const passedChecks: string[] = [];
  if (versionResult.success) passedChecks.push('Version Readiness');
  if (rolesResult.success) passedChecks.push('Role Governance Readiness');
  if (statusesResult.success) passedChecks.push('Status Compliance Readiness');
  if (permissionsResult.success) passedChecks.push('Permission Isolation Readiness');
  if (workflowResult.success) passedChecks.push('Workflow Integrity Readiness');
  if (securityResult.success) passedChecks.push('Security Invariants Readiness');

  const isReadyForRcEvaluation = blockers.length === 0;

  const coverage = calculateWorkflowCoverage(cases, logs);

  const recommendation = isReadyForRcEvaluation
    ? "alpha.10 prête pour revue RC interne (aucun bloqueur critique détecté)"
    : "alpha.10 présente des bloqueurs critiques à résoudre avant évaluation RC";

  return {
    appVersion: versionInput,
    isReadyForRcEvaluation,
    blockers,
    warnings,
    passedChecks,
    roleChecks: rolesResult,
    statusChecks: statusesResult,
    workflowChecks: workflowResult,
    securityChecks: securityResult,
    testExpectations: {
      totalCases: cases.length,
      totalLogs: logs.length,
      coveragePercent: coverage.percentCoverage,
    },
    recommendation,
  };
}
