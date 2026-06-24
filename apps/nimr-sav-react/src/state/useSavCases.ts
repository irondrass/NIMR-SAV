import { useState, useEffect } from 'react';
import { savCaseStore } from './sav-case-store';
import { SavCase } from '../domain/sav-case';
import { AuditLogEntry } from '../domain/audit-log';

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
  };
}
