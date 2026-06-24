import { SavCase, WorkshopTask } from '../domain/sav-case';
import { AuditLogEntry, createAuditLog } from '../domain/audit-log';
import { DEMO_CASES } from '../domain/case-fixtures';
import { LS_PREFIX } from '../constants/version';
import { Role } from '../types';
import { CaseStatus } from '../domain/case-status';
import { hasPermission } from '../domain/action-permissions';
import { transitionCase } from '../domain/workflow-engine';
import { DEMO_TECHNICIANS } from '../constants/demo-technicians';

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

  assignTechnician(caseId: string, technicianId: string, actor: { id: string; role: Role }) {
    const caseObj = cases.find((c) => c.id === caseId);
    if (!caseObj) throw new Error(`Case ${caseId} not found.`);

    if ((caseObj.status === 'closed' || caseObj.status === 'cancelled') && actor.role !== 'admin') {
      throw new Error(`Cases in ${caseObj.status} status cannot be modified except by Admin.`);
    }

    if (!hasPermission(actor.role, 'assign_technician')) {
      throw new Error(`Role ${actor.role} is not permitted to assign technicians.`);
    }

    const tech = DEMO_TECHNICIANS.find((t) => t.id === technicianId);
    if (!tech) throw new Error(`Technician ${technicianId} not found.`);

    const updatedCase: SavCase = {
      ...caseObj,
      assignedTechnicianId: tech.id,
      assignedTechnicianName: tech.name,
      updatedAt: new Date().toISOString(),
    };

    this.addCase(updatedCase);

    const log = createAuditLog(
      caseId,
      actor.id,
      actor.role,
      'assign_technician',
      caseObj.status,
      caseObj.status,
      `Technicien ${tech.name} (${tech.id}) affecté au dossier.`
    );
    this.addLog(log);
  },

  setWorkshopPriority(caseId: string, priority: 'basse' | 'normale' | 'haute', actor: { id: string; role: Role }) {
    const caseObj = cases.find((c) => c.id === caseId);
    if (!caseObj) throw new Error(`Case ${caseId} not found.`);

    if ((caseObj.status === 'closed' || caseObj.status === 'cancelled') && actor.role !== 'admin') {
      throw new Error(`Cases in ${caseObj.status} status cannot be modified except by Admin.`);
    }

    if (!hasPermission(actor.role, 'change_workshop_status')) {
      throw new Error(`Role ${actor.role} is not permitted to change workshop priority.`);
    }

    const updatedCase: SavCase = {
      ...caseObj,
      workshopPriority: priority,
      updatedAt: new Date().toISOString(),
    };

    this.addCase(updatedCase);

    const log = createAuditLog(
      caseId,
      actor.id,
      actor.role,
      'set_workshop_priority',
      caseObj.status,
      caseObj.status,
      `Priorité atelier définie à : ${priority}.`
    );
    this.addLog(log);
  },

  planWorkshopTask(
    caseId: string,
    payload: {
      bay?: string;
      duration?: number;
      tasks?: WorkshopTask[];
      startAt?: string;
      endAt?: string;
    },
    actor: { id: string; role: Role }
  ) {
    const caseObj = cases.find((c) => c.id === caseId);
    if (!caseObj) throw new Error(`Case ${caseId} not found.`);

    if ((caseObj.status === 'closed' || caseObj.status === 'cancelled') && actor.role !== 'admin') {
      throw new Error(`Cases in ${caseObj.status} status cannot be modified except by Admin.`);
    }

    if (!hasPermission(actor.role, 'schedule_case')) {
      throw new Error(`Role ${actor.role} is not permitted to plan workshop tasks.`);
    }

    const updatedCase: SavCase = {
      ...caseObj,
      workshopBay: payload.bay !== undefined ? payload.bay : caseObj.workshopBay,
      estimatedDurationMinutes: payload.duration !== undefined ? payload.duration : caseObj.estimatedDurationMinutes,
      workshopTasks: payload.tasks !== undefined ? payload.tasks : caseObj.workshopTasks,
      plannedStartAt: payload.startAt !== undefined ? payload.startAt : caseObj.plannedStartAt,
      plannedEndAt: payload.endAt !== undefined ? payload.endAt : caseObj.plannedEndAt,
      updatedAt: new Date().toISOString(),
    };

    this.addCase(updatedCase);

    const log = createAuditLog(
      caseId,
      actor.id,
      actor.role,
      'plan_workshop_task',
      caseObj.status,
      caseObj.status,
      `Planification atelier mise à jour. Baie: ${updatedCase.workshopBay}, Durée: ${updatedCase.estimatedDurationMinutes} min.`
    );
    this.addLog(log);
  },

  transitionWorkshopCase(caseId: string, nextStatus: CaseStatus, actor: { id: string; role: Role }) {
    const caseObj = cases.find((c) => c.id === caseId);
    if (!caseObj) throw new Error(`Case ${caseId} not found.`);

    if ((caseObj.status === 'closed' || caseObj.status === 'cancelled') && actor.role !== 'admin') {
      throw new Error(`Cases in ${caseObj.status} status cannot be modified except by Admin.`);
    }

    const result = transitionCase(caseObj, nextStatus, actor);
    if (!result.success || !result.updatedCase || !result.auditLog) {
      throw new Error(result.error || 'Failed to transition workshop case.');
    }

    this.addCase(result.updatedCase);
    this.addLog(result.auditLog);
  },
};
