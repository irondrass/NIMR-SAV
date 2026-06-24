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
  createdAt: string; // ISO DateTime
  updatedAt: string; // ISO DateTime
}
