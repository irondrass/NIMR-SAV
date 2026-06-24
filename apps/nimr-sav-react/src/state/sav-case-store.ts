import { SavCase } from '../domain/sav-case';
import { AuditLogEntry } from '../domain/audit-log';
import { DEMO_CASES } from '../domain/case-fixtures';
import { LS_PREFIX } from '../constants/version';

const CASES_KEY = `${LS_PREFIX}cases`;
const LOGS_KEY = `${LS_PREFIX}audit_logs`;

let cases: SavCase[] = loadInitialCases();
let logs: AuditLogEntry[] = loadInitialLogs();

const listeners = new Set<() => void>();

function loadInitialCases(): SavCase[] {
  try {
    const item = window.localStorage.getItem(CASES_KEY);
    if (item) {
      const parsed = JSON.parse(item) as SavCase[];
      // Filter out duplicate IDs just in case
      const unique: SavCase[] = [];
      const ids = new Set<string>();
      for (const c of parsed) {
        if (!ids.has(c.id)) {
          ids.add(c.id);
          unique.push(c);
        }
      }
      return unique;
    }
    return [...DEMO_CASES];
  } catch {
    return [...DEMO_CASES];
  }
}

function loadInitialLogs(): AuditLogEntry[] {
  try {
    const item = window.localStorage.getItem(LOGS_KEY);
    return item ? (JSON.parse(item) as AuditLogEntry[]) : [];
  } catch {
    return [];
  }
}

function notify() {
  listeners.forEach((l) => l());
}

export const savCaseStore = {
  getCases(): SavCase[] {
    return cases;
  },

  getLogs(): AuditLogEntry[] {
    return logs;
  },

  setCases(newCases: SavCase[]) {
    // Avoid duplicate IDs
    const unique: SavCase[] = [];
    const ids = new Set<string>();
    for (const c of newCases) {
      if (!ids.has(c.id)) {
        ids.add(c.id);
        unique.push(c);
      }
    }
    cases = unique;
    try {
      window.localStorage.setItem(CASES_KEY, JSON.stringify(cases));
    } catch (e) {
      console.error('[NIMR v24] Failed to save cases to localStorage:', e);
    }
    notify();
  },

  addCase(newCase: SavCase) {
    if (cases.some((c) => c.id === newCase.id)) {
      // Overwrite/update existing
      this.setCases(cases.map((c) => (c.id === newCase.id ? newCase : c)));
    } else {
      this.setCases([...cases, newCase]);
    }
  },

  addLog(log: AuditLogEntry) {
    logs = [log, ...logs];
    try {
      window.localStorage.setItem(LOGS_KEY, JSON.stringify(logs));
    } catch (e) {
      console.error('[NIMR v24] Failed to save logs to localStorage:', e);
    }
    notify();
  },

  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  reset() {
    cases = [...DEMO_CASES];
    logs = [];
    try {
      window.localStorage.setItem(CASES_KEY, JSON.stringify(cases));
      window.localStorage.setItem(LOGS_KEY, JSON.stringify(logs));
    } catch (e) {
      console.error('[NIMR v24] Failed to reset localStorage:', e);
    }
    notify();
  },

  clearAll() {
    cases = [];
    logs = [];
    try {
      window.localStorage.removeItem(CASES_KEY);
      window.localStorage.removeItem(LOGS_KEY);
    } catch (e) {
      console.error('[NIMR v24] Failed to clear localStorage:', e);
    }
    notify();
  },
};
