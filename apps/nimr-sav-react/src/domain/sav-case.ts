import { CaseStatus } from './case-status';

export interface QcChecklistItem {
  id: string;
  label: string;
  checked: boolean;
  required: boolean;
}

export type QCChecklistItem = QcChecklistItem;

export interface QCChecklist {
  items: QCChecklistItem[];
  validatedBy?: string;
  validatedAt?: string; // ISO DateTime
  rejectionReason?: string;
}

export type WorkshopTaskStatus = 'pending' | 'in_progress' | 'done';

export interface WorkshopTask {
  id: string;
  label: string;
  status: WorkshopTaskStatus;
  estimatedDurationMinutes?: number;
  createdAt: string; // ISO DateTime
}

export interface SavCase {
  id: string;
  immatriculation: string;
  vin: string;
  clientName: string;
  telephone: string;
  status: CaseStatus;
  assignedTechnicianId?: string;
  assignedTechnicianName?: string;
  workshopPriority?: 'basse' | 'normale' | 'haute';
  workshopBay?: string;
  estimatedDurationMinutes?: number;
  workshopTasks?: WorkshopTask[];
  plannedStartAt?: string; // ISO DateTime
  plannedEndAt?: string; // ISO DateTime
  receptionDate: string; // ISO DateTime
  estimatedReadyDate?: string; // ISO DateTime
  deliveryDate?: string; // ISO DateTime
  deliveryPreparedAt?: string; // ISO DateTime
  deliveryPreparedBy?: string;
  deliveredAt?: string; // ISO DateTime
  deliveredBy?: string;
  deliveryRecipientName?: string;
  deliveryProofReference?: string;
  deliveryNotes?: string;
  closedDate?: string; // ISO DateTime
  qcChecklist?: QcChecklistItem[] | QCChecklist;
  qcStatus?: 'pending' | 'in_progress' | 'approved' | 'rejected';
  qcRejectionReason?: string;
  qcCheckedAt?: string; // ISO DateTime
  qcCheckedBy?: string;
  qcReworkReason?: string;
  directionNotes?: string;
  claims?: Claim[];
  claimsOverridden?: boolean;
  claimsOverrideReason?: string;
  claimsOverrideAt?: string; // ISO DateTime
  claimsOverrideBy?: string;
  createdAt: string; // ISO DateTime
  updatedAt: string; // ISO DateTime
}

export interface Claim {
  id: string;
  label: string;
  claimType: 'insurance' | 'customer' | 'warranty' | 'internal' | 'mixed';
  payerType: 'assurance' | 'client' | 'garantie' | 'interne';
  status: 'draft' | 'estimate_pending' | 'expert_pending' | 'client_pending' | 'approved' | 'rejected' | 'cancelled';
  description: string;
  estimatedAmount?: number;
  expertApproved: boolean;
  clientApproved: boolean;
  expertApprovalAt?: string; // ISO DateTime
  clientApprovalAt?: string; // ISO DateTime
  expertName?: string;
  clientApprovalReference?: string;
  requiredApprovals: string[];
  notes?: string;
  createdAt: string; // ISO DateTime
  updatedAt: string; // ISO DateTime
}
