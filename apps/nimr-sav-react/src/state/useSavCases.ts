import { useState, useEffect } from 'react';
import { savCaseStore } from './sav-case-store';
import { SavCase, WorkshopTask } from '../domain/sav-case';
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
  };
}
