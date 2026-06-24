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
 * Checks if the case is eligible for delivery preparation (must have validated QC and be in 'quality_approved' status).
 */
export function canPrepareDelivery(caseObj: SavCase): boolean {
  return caseObj.status === 'quality_approved' && isQCValidated(caseObj);
}

/**
 * Checks if the delivery proof data (recipient name and proof reference) is complete and not just whitespace.
 */
export function isDeliveryProofComplete(caseObj: SavCase): boolean {
  const name = caseObj.deliveryRecipientName;
  const ref = caseObj.deliveryProofReference;
  return !!(name && name.trim() !== '' && ref && ref.trim() !== '');
}

/**
 * Checks if the case is eligible for delivery (must have validated QC, be in 'ready_delivery' status, and have complete delivery proof).
 */
export function canDeliverCase(caseObj: SavCase): boolean {
  return (
    caseObj.status === 'ready_delivery' &&
    isQCValidated(caseObj) &&
    isDeliveryProofComplete(caseObj)
  );
}
