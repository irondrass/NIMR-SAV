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

export interface SavCase {
  id: string;
  immatriculation: string;
  vin: string;
  clientName: string;
  telephone: string;
  status: CaseStatus;
  assignedTechnicianId?: string;
  receptionDate: string; // ISO DateTime
  estimatedReadyDate?: string; // ISO DateTime
  deliveryDate?: string; // ISO DateTime
  closedDate?: string; // ISO DateTime
  qcChecklist?: QCChecklist;
  directionNotes?: string;
  createdAt: string; // ISO DateTime
  updatedAt: string; // ISO DateTime
}
