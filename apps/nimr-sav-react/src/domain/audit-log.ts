import { CaseStatus } from './case-status';

export interface AuditLogEntry {
  id: string;
  caseId: string;
  userId: string;
  userRole: string;
  action: string;
  fromStatus?: CaseStatus;
  toStatus?: CaseStatus;
  timestamp: string; // ISO DateTime
  details?: string;
}

export function createAuditLog(
  caseId: string,
  userId: string,
  userRole: string,
  action: string,
  fromStatus?: CaseStatus,
  toStatus?: CaseStatus,
  details?: string
): AuditLogEntry {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    caseId,
    userId,
    userRole,
    action,
    fromStatus,
    toStatus,
    timestamp: new Date().toISOString(),
    details,
  };
}
