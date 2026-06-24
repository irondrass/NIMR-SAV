import { CaseStatus } from './case-status';
import { SavCase } from './sav-case';
import { AuditLogEntry, createAuditLog } from './audit-log';
import { canDeliverCase } from './delivery-rules';
import { Role } from '../types';

export interface TransitionResult {
  success: boolean;
  error?: string;
  updatedCase?: SavCase;
  auditLog?: AuditLogEntry;
}

/**
 * Standard allowed transitions for SAV workflow
 */
export const ALLOWED_TRANSITIONS: Record<CaseStatus, readonly CaseStatus[]> = {
  draft: ['received', 'cancelled'],
  received: ['diagnosis', 'cancelled'],
  diagnosis: ['waiting_parts', 'repair', 'cancelled'],
  waiting_parts: ['repair', 'cancelled'],
  repair: ['work_completed'],
  work_completed: ['quality_pending'],
  quality_pending: ['quality_approved', 'quality_rejected'],
  quality_rejected: ['quality_rework'],
  quality_rework: ['quality_pending'],
  quality_approved: ['ready_delivery'],
  ready_delivery: ['delivered'],
  delivered: ['closed'],
  closed: [],
  cancelled: [],
};

/**
 * Transitions a case to a new status while enforcing all domain constraints and permissions.
 */
export function transitionCase(
  caseObj: SavCase,
  targetStatus: CaseStatus,
  user: { id: string; role: Role }
): TransitionResult {
  // 1. Read-only users can never modify cases
  if (user.role === 'lecture-seule') {
    return { success: false, error: 'Read-only users cannot perform modifications.' };
  }

  // 2. Role-workflow specific boundaries
  // - Technicians cannot validate or reject QC
  if ((targetStatus === 'quality_approved' || targetStatus === 'quality_rejected') && user.role === 'technicien') {
    return { success: false, error: 'Technicians cannot validate or reject QC.' };
  }
  // - Livraison cannot validate or reject QC
  if ((targetStatus === 'quality_approved' || targetStatus === 'quality_rejected') && user.role === 'livraison') {
    return { success: false, error: 'Livraison role cannot validate or reject QC.' };
  }
  // - Reception cannot close cases
  if (targetStatus === 'closed' && user.role === 'reception') {
    return { success: false, error: 'Reception role cannot close cases.' };
  }
  // - Livraison cannot close cases
  if (targetStatus === 'closed' && user.role === 'livraison') {
    return { success: false, error: 'Livraison role cannot close cases.' };
  }

  let isExceptionalAdminAction = false;

  // 3. Protection of 'closed' and 'cancelled' states
  if (caseObj.status === 'closed' || caseObj.status === 'cancelled') {
    if (user.role === 'admin') {
      isExceptionalAdminAction = true;
    } else {
      return { success: false, error: `Cases in ${caseObj.status} status cannot be modified except by Admin.` };
    }
  }

  // 4. Late cancellation restrictions (repair and beyond)
  const isLateCancel = targetStatus === 'cancelled' &&
    !['draft', 'received', 'diagnosis', 'waiting_parts'].includes(caseObj.status);
  
  if (isLateCancel) {
    if (user.role === 'admin') {
      isExceptionalAdminAction = true;
    } else {
      return { success: false, error: `Cancellation from ${caseObj.status} status is forbidden except for Admin.` };
    }
  }

  // 5. Standard transition check
  if (!isExceptionalAdminAction) {
    const allowed = ALLOWED_TRANSITIONS[caseObj.status] || [];
    if (!allowed.includes(targetStatus)) {
      return { success: false, error: `Invalid transition from ${caseObj.status} to ${targetStatus}.` };
    }
  }

  // 6. Delivery checks
  if (targetStatus === 'delivered' && !isExceptionalAdminAction) {
    if (!canDeliverCase(caseObj)) {
      return { success: false, error: 'Cannot deliver case: QC checklist must be validated and status must be ready_delivery.' };
    }
  }

  // 7. Apply the transition
  const updatedCase: SavCase = {
    ...caseObj,
    status: targetStatus,
    updatedAt: new Date().toISOString(),
  };

  // Set timestamps for final states if not exceptional admin action bypass
  if (targetStatus === 'delivered') {
    updatedCase.deliveryDate = new Date().toISOString();
  } else if (targetStatus === 'closed') {
    updatedCase.closedDate = new Date().toISOString();
  }

  // 8. Generate Audit Log
  const actionType = isExceptionalAdminAction ? 'EXCEPTIONAL_ADMIN_ACTION' : 'STATUS_TRANSITION';
  const details = isExceptionalAdminAction
    ? `Exceptional Admin action: transitioned from ${caseObj.status} to ${targetStatus}`
    : `Status transitioned from ${caseObj.status} to ${targetStatus}`;

  const auditLog = createAuditLog(
    caseObj.id,
    user.id,
    user.role,
    actionType,
    caseObj.status,
    targetStatus,
    details
  );

  return {
    success: true,
    updatedCase,
    auditLog,
  };
}
