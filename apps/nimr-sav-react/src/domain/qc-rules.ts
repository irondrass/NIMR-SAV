import { SavCase, QcChecklistItem, QCChecklist } from './sav-case';

/**
 * Normalizes checklist into a flat array of items.
 */
export function normalizeQcChecklist(checklist: QcChecklistItem[] | QCChecklist | undefined): QcChecklistItem[] {
  if (!checklist) return [];
  if (Array.isArray(checklist)) return checklist;
  return checklist.items || [];
}

/**
 * Checks if all required QC checklist items are checked.
 */
export function areRequiredQcItemsChecked(checklist: QcChecklistItem[] | QCChecklist | undefined): boolean {
  const items = normalizeQcChecklist(checklist);
  return items.filter((item) => item.required).every((item) => item.checked);
}

/**
 * Checks if all required items in the QC checklist are checked.
 */
export function isQCComplete(caseObj: SavCase): boolean {
  return areRequiredQcItemsChecked(caseObj.qcChecklist);
}

/**
 * Verifies if the user role is authorized to perform QC operations.
 */
export function canPerformQCOperations(role: string): boolean {
  return role === 'qualite' || role === 'admin';
}

/**
 * A delivered or closed case is excluded from active QC operations.
 */
export function isCaseExcludedFromActiveQC(caseObj: SavCase): boolean {
  return caseObj.status === 'delivered' || caseObj.status === 'closed';
}
