import { CASE_STATUSES, CaseStatus } from './case-status';
import { ALLOWED_TRANSITIONS } from './workflow-engine';

export type StatusHardeningState = 'pass' | 'warning' | 'fail';

export interface StatusValidationResult {
  valid: boolean;
  reason?: string;
}

export interface StatusTransitionAudit {
  from: CaseStatus;
  allowedTargets: readonly CaseStatus[];
  valid: boolean;
  issues: string[];
}

export interface StatusHardeningSummary {
  score: number;
  status: StatusHardeningState;
  allowedStatuses: readonly CaseStatus[];
  transitionAudits: StatusTransitionAudit[];
  warnings: string[];
  blockers: string[];
}

const FORBIDDEN_STATUS_MARKERS = [
  'queued',
  'replayed',
  'failed',
  'cancelled_offline',
  'cache_pending',
] as const;

export function validateAllowedCaseStatus(status: unknown): StatusValidationResult {
  if (!CASE_STATUSES.includes(status as CaseStatus)) {
    return {
      valid: false,
      reason: `Statut dossier non officiel refusé : ${String(status)}.`,
    };
  }

  return { valid: true };
}

export function validateCaseStatusTransition(from: unknown, to: unknown): StatusValidationResult {
  const fromStatus = validateAllowedCaseStatus(from);
  if (!fromStatus.valid) return fromStatus;

  const toStatus = validateAllowedCaseStatus(to);
  if (!toStatus.valid) return toStatus;

  const current = from as CaseStatus;
  const target = to as CaseStatus;
  const allowedTargets = ALLOWED_TRANSITIONS[current] ?? [];

  if (!allowedTargets.includes(target)) {
    return {
      valid: false,
      reason: `Transition dossier interdite : ${current} -> ${target}.`,
    };
  }

  return { valid: true };
}

export function auditStatusTransitions(): StatusTransitionAudit[] {
  return CASE_STATUSES.map((from) => {
    const issues: string[] = [];
    const allowedTargets = ALLOWED_TRANSITIONS[from] ?? [];

    allowedTargets.forEach((target) => {
      if (!CASE_STATUSES.includes(target)) {
        issues.push(`Transition vers statut inconnu : ${from} -> ${target}.`);
      }
    });

    return {
      from,
      allowedTargets,
      valid: issues.length === 0,
      issues,
    };
  });
}

export function summarizeStatusHardening(): StatusHardeningSummary {
  const transitionAudits = auditStatusTransitions();
  const transitionIssues = transitionAudits.flatMap((audit) => audit.issues);
  const missingTransitionKeys = CASE_STATUSES.filter((status) => !(status in ALLOWED_TRANSITIONS));
  const leakedOfflineStatuses = CASE_STATUSES.filter((status) =>
    FORBIDDEN_STATUS_MARKERS.includes(status as (typeof FORBIDDEN_STATUS_MARKERS)[number])
  );

  const blockers = [
    ...transitionIssues,
    ...missingTransitionKeys.map((status) => `Statut sans matrice de transition : ${status}.`),
    ...leakedOfflineStatuses.map((status) => `Statut offline/cache mélangé au statut métier : ${status}.`),
  ];
  const warnings: string[] = [];
  const totalChecks = CASE_STATUSES.length + 2;
  const failedChecks = transitionAudits.filter((audit) => !audit.valid).length + missingTransitionKeys.length + leakedOfflineStatuses.length;
  const score = Math.max(0, Math.round(((totalChecks - failedChecks) / totalChecks) * 100));

  return {
    score,
    status: blockers.length > 0 ? 'fail' : warnings.length > 0 ? 'warning' : 'pass',
    allowedStatuses: CASE_STATUSES,
    transitionAudits,
    warnings,
    blockers,
  };
}
