import { CaseStatus } from './case-status';

export interface CasePhoto {
  id: string;
  name: string;
  type: string;
  size: number;
  category: 'before' | 'during' | 'after' | 'claim' | 'estimate' | 'quality' | 'delivery' | 'other';
  dataUrl?: string;
  createdAt: string;
  relatedClaimId?: string;
  relatedEstimateId?: string;
}

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
  pole?: WorkshopPole;
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
  photos?: CasePhoto[];
  createdAt: string; // ISO DateTime
  updatedAt: string; // ISO DateTime
}

export type EstimateSourceType = 'html' | 'txt' | 'pasted_text' | 'unknown';
export type EstimateLineType = 'labor' | 'part' | 'paint_material' | 'fee' | 'discount' | 'unknown';
export type WorkshopPole = 'tolerie' | 'peinture' | 'preparation' | 'remontage' | 'finition' | 'mecanique' | 'controle_qualite' | 'autre';

export interface EstimateTotals {
  amountHT: number;
  amountTVA: number;
  amountTTC: number;
  currency: string;
}

export interface EstimateLine {
  id: string;
  lineType: EstimateLineType;
  code: string;
  label: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  laborHours: number;
  detectedPole: WorkshopPole;
  selectedPole: WorkshopPole;
  isPart: boolean;
  isLabor: boolean;
  isPaintMaterial: boolean;
  isNewPart: boolean;
  confidence: number;
  rawLine: string;
}

export interface EstimatePartsSummary {
  totalPartsCount: number;
  totalPartsAmountHT: number;
  newPartsCount: number;
}

export interface Estimate {
  id: string;
  sourceFileName: string;
  sourceType: EstimateSourceType;
  importedAt: string;
  importedBy: string;
  rawTextPreview: string;
  totals: EstimateTotals;
  lines: EstimateLine[];
  laborSummary: Record<WorkshopPole, number>;
  partsSummary: EstimatePartsSummary;
  warnings: string[];
  confidenceScore: number;
  photos?: CasePhoto[];
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
  estimate?: Estimate;
  photos?: CasePhoto[];
  createdAt: string; // ISO DateTime
  updatedAt: string; // ISO DateTime
}
