import { describe, expect, it } from 'vitest';
import { CASE_STATUSES } from '../src/domain/case-status';
import {
  auditStatusTransitions,
  summarizeStatusHardening,
  validateAllowedCaseStatus,
  validateCaseStatusTransition,
} from '../src/domain/status-hardening';

describe('Status hardening alpha.19', () => {
  it('accepts only the official global case statuses', () => {
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

    expect(validateAllowedCaseStatus('ready_delivery').valid).toBe(true);
    expect(validateAllowedCaseStatus('queued').valid).toBe(false);
  });

  it('validates known workflow transitions and rejects invalid jumps', () => {
    expect(validateCaseStatusTransition('draft', 'received').valid).toBe(true);
    expect(validateCaseStatusTransition('quality_approved', 'ready_delivery').valid).toBe(true);
    expect(validateCaseStatusTransition('draft', 'delivered').valid).toBe(false);
    expect(validateCaseStatusTransition('repair', 'queued').valid).toBe(false);
  });

  it('audits the transition matrix without mixing offline statuses', () => {
    const audits = auditStatusTransitions();
    const summary = summarizeStatusHardening();

    expect(audits).toHaveLength(CASE_STATUSES.length);
    expect(summary.blockers).toHaveLength(0);
    expect(summary.status).toBe('pass');
    expect(summary.score).toBe(100);
  });
});
