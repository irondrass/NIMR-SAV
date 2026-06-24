export type CaseStatus =
  | 'draft'
  | 'received'
  | 'diagnosis'
  | 'waiting_parts'
  | 'repair'
  | 'work_completed'
  | 'quality_pending'
  | 'quality_rejected'
  | 'quality_rework'
  | 'quality_approved'
  | 'ready_delivery'
  | 'delivered'
  | 'closed'
  | 'cancelled';

export const CASE_STATUSES: readonly CaseStatus[] = [
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
] as const;
