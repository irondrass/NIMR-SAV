import { useState, useEffect } from 'react';
import { savCaseStore } from './sav-case-store';
import { SavCase, WorkshopTask, QcChecklistItem, Claim, EstimateLine } from '../domain/sav-case';
import { AuditLogEntry } from '../domain/audit-log';
import { Role } from '../types';
import { CaseStatus } from '../domain/case-status';

export function useSavCases() {
  const [cases, setCases] = useState<SavCase[]>(savCaseStore.getCases());
  const [logs, setLogs] = useState<AuditLogEntry[]>(savCaseStore.getLogs());

  useEffect(() => {
    const unsubscribe = savCaseStore.subscribe(() => {
      setCases(savCaseStore.getCases());
      setLogs(savCaseStore.getLogs());
    });
    return unsubscribe;
  }, []);

  return {
    cases,
    logs,
    updateCases: (newCases: SavCase[]) => savCaseStore.setCases(newCases),
    addCase: (newCase: SavCase) => savCaseStore.addCase(newCase),
    addLog: (log: AuditLogEntry) => savCaseStore.addLog(log),
    resetStore: () => savCaseStore.reset(),
    clearStore: () => savCaseStore.clearAll(),
    assignTechnician: (caseId: string, technicianId: string, actor: { id: string; role: Role }) =>
      savCaseStore.assignTechnician(caseId, technicianId, actor),
    setWorkshopPriority: (caseId: string, priority: 'basse' | 'normale' | 'haute', actor: { id: string; role: Role }) =>
      savCaseStore.setWorkshopPriority(caseId, priority, actor),
    planWorkshopTask: (caseId: string, payload: { bay?: string; duration?: number; tasks?: WorkshopTask[]; startAt?: string; endAt?: string }, actor: { id: string; role: Role }) =>
      savCaseStore.planWorkshopTask(caseId, payload, actor),
    transitionWorkshopCase: (caseId: string, nextStatus: CaseStatus, actor: { id: string; role: Role }) =>
      savCaseStore.transitionWorkshopCase(caseId, nextStatus, actor),
    getCasesForTechnician: (technicianId: string) =>
      savCaseStore.getCasesForTechnician(technicianId),
    startTechnicianWork: (caseId: string, actor: { id: string; role: Role }) =>
      savCaseStore.startTechnicianWork(caseId, actor),
    updateWorkshopTaskStatus: (caseId: string, taskId: string, nextStatus: 'pending' | 'in_progress' | 'done', actor: { id: string; role: Role }) =>
      savCaseStore.updateWorkshopTaskStatus(caseId, taskId, nextStatus, actor),
    completeTechnicianWork: (caseId: string, actor: { id: string; role: Role }) =>
      savCaseStore.completeTechnicianWork(caseId, actor),
    getQualityCases: () =>
      savCaseStore.getQualityCases(),
    startQualityCheck: (caseId: string, actor: { id: string; role: Role }) =>
      savCaseStore.startQualityCheck(caseId, actor),
    updateQualityChecklist: (caseId: string, checklist: QcChecklistItem[], actor: { id: string; role: Role }) =>
      savCaseStore.updateQualityChecklist(caseId, checklist, actor),
    approveQualityCheck: (caseId: string, actor: { id: string; role: Role }) =>
      savCaseStore.approveQualityCheck(caseId, actor),
    rejectQualityCheck: (caseId: string, reason: string, actor: { id: string; role: Role }) =>
      savCaseStore.rejectQualityCheck(caseId, reason, actor),
    sendQualityCaseToRework: (caseId: string, reason: string, actor: { id: string; role: Role }) =>
      savCaseStore.sendQualityCaseToRework(caseId, reason, actor),
    getDeliveryCases: () =>
      savCaseStore.getDeliveryCases(),
    prepareDelivery: (caseId: string, actor: { id: string; role: Role }) =>
      savCaseStore.prepareDelivery(caseId, actor),
    deliverCase: (caseId: string, deliveryPayload: { recipientName: string; proofReference: string; notes?: string }, actor: { id: string; role: Role }) =>
      savCaseStore.deliverCase(caseId, deliveryPayload, actor),
    getDirectorDashboard: (now?: Date) =>
      savCaseStore.getDirectorDashboard(now),
    getDirectorCases: () =>
      savCaseStore.getDirectorCases(),
    getDirectorAlerts: (now?: Date) =>
      savCaseStore.getDirectorAlerts(now),
    getDirectorTechnicianLoad: () =>
      savCaseStore.getDirectorTechnicianLoad(),
    getAdminGovernanceSummary: () =>
      savCaseStore.getAdminGovernanceSummary(),
    getReadOnlyCases: () =>
      savCaseStore.getReadOnlyCases(),
    getReadOnlyLogs: () =>
      savCaseStore.getReadOnlyLogs(),
    getSystemInvariants: () =>
      savCaseStore.getSystemInvariants(),
    addClaim: (caseId: string, claim: Partial<Claim>, actor: { id: string; role: Role }) =>
      savCaseStore.addClaim(caseId, claim, actor),
    updateClaim: (caseId: string, claimId: string, updatedFields: Partial<Claim>, actor: { id: string; role: Role }) =>
      savCaseStore.updateClaim(caseId, claimId, updatedFields, actor),
    approveClaimExpert: (caseId: string, claimId: string, expertName: string, actor: { id: string; role: Role }) =>
      savCaseStore.approveClaimExpert(caseId, claimId, expertName, actor),
    approveClaimClient: (caseId: string, claimId: string, reference: string, actor: { id: string; role: Role }) =>
      savCaseStore.approveClaimClient(caseId, claimId, reference, actor),
    rejectClaim: (caseId: string, claimId: string, reason: string, actor: { id: string; role: Role }) =>
      savCaseStore.rejectClaim(caseId, claimId, reason, actor),
    cancelClaim: (caseId: string, claimId: string, actor: { id: string; role: Role }) =>
      savCaseStore.cancelClaim(caseId, claimId, actor),
    overrideClaims: (caseId: string, reason: string, actor: { id: string; role: Role }) =>
      savCaseStore.overrideClaims(caseId, reason, actor),
    importEstimateForClaim: (caseId: string, claimId: string, estimateInput: { fileName: string; content: string }, actor: { id: string; role: Role }) =>
      savCaseStore.importEstimateForClaim(caseId, claimId, estimateInput, actor),
    updateClaimEstimateLine: (caseId: string, claimId: string, lineId: string, updates: Partial<EstimateLine>, actor: { id: string; role: Role }) =>
      savCaseStore.updateClaimEstimateLine(caseId, claimId, lineId, updates, actor),
    removeEstimateFromClaim: (caseId: string, claimId: string, actor: { id: string; role: Role }) =>
      savCaseStore.removeEstimateFromClaim(caseId, claimId, actor),
    regenerateWorkshopTasksFromClaimEstimate: (caseId: string, claimId: string, actor: { id: string; role: Role }) =>
      savCaseStore.regenerateWorkshopTasksFromClaimEstimate(caseId, claimId, actor),
  };
}
