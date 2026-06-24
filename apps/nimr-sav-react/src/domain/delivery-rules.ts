import { SavCase } from './sav-case';

/**
 * Checks if the case has a validated QC checklist.
 */
export function isQCValidated(caseObj: SavCase): boolean {
  if (!caseObj.qcChecklist) {
    return false;
  }
  const hasValidator = !!caseObj.qcChecklist.validatedBy;
  const allRequiredChecked = caseObj.qcChecklist.items
    .filter((item) => item.required)
    .every((item) => item.checked);
  
  return hasValidator && allRequiredChecked;
}

/**
 * Checks if the case is eligible for delivery (must have validated QC and be in 'ready_delivery' status).
 */
export function canDeliverCase(caseObj: SavCase): boolean {
  return caseObj.status === 'ready_delivery' && isQCValidated(caseObj);
}
