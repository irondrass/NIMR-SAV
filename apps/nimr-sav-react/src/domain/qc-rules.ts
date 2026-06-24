import { SavCase } from './sav-case';

/**
 * Checks if all required items in the QC checklist are checked.
 */
export function isQCComplete(caseObj: SavCase): boolean {
  if (!caseObj.qcChecklist || caseObj.qcChecklist.items.length === 0) {
    return true; // No checklist or empty checklist means nothing required is unchecked
  }
  return caseObj.qcChecklist.items
    .filter((item) => item.required)
    .every((item) => item.checked);
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
