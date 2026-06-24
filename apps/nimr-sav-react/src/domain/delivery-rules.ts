import { SavCase } from './sav-case';
import { areRequiredQcItemsChecked } from './qc-rules';

/**
 * Checks if the case has a validated QC checklist.
 */
export function isQCValidated(caseObj: SavCase): boolean {
  if (!caseObj.qcChecklist) {
    return false;
  }
  let hasValidator = false;
  if (Array.isArray(caseObj.qcChecklist)) {
    hasValidator = !!caseObj.qcCheckedBy;
  } else {
    hasValidator = !!caseObj.qcChecklist.validatedBy;
  }
  return hasValidator && areRequiredQcItemsChecked(caseObj.qcChecklist);
}

/**
 * Checks if the case is eligible for delivery (must have validated QC and be in 'ready_delivery' status).
 */
export function canDeliverCase(caseObj: SavCase): boolean {
  return caseObj.status === 'ready_delivery' && isQCValidated(caseObj);
}
