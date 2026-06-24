import { CaseStatus } from './case-status';

export interface QCChecklistItem {
  id: string;
  label: string;
  checked: boolean;
  required: boolean;
}

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
  closedDate?: string; // ISO DateTime
  qcChecklist?: QCChecklist;
  directionNotes?: string;
  createdAt: string; // ISO DateTime
  updatedAt: string; // ISO DateTime
}
