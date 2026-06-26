import { SavCase, WorkshopTask, QcChecklistItem, Claim } from '../domain/sav-case';
import { AuditLogEntry, createAuditLog } from '../domain/audit-log';
import { DEMO_CASES } from '../domain/case-fixtures';
import { LS_PREFIX, APP_VERSION, RESERVED_CACHE_NAME } from '../constants/version';
import { getRoleGovernanceMatrix } from '../domain/role-governance';
import { DEMO_QC_CHECKLIST } from '../constants/qc-checklist';
import { Role } from '../types';
import { CaseStatus } from '../domain/case-status';
import { hasPermission } from '../domain/action-permissions';
import { transitionCase } from '../domain/workflow-engine';
import { DEMO_TECHNICIANS } from '../constants/demo-technicians';
import { getBlockingClaimsReasons, normalizeClaim, approveClaimExpert, approveClaimClient, rejectClaim, cancelClaim } from '../domain/claims';
import {
  calculateDirectorDashboard,
  calculateBlockingAlerts,
  calculateTechnicianLoad,
} from '../domain/director-kpis';

const CASES_KEY = `${LS_PREFIX}cases`;
const LOGS_KEY = `${LS_PREFIX}audit_logs`;

let cases: SavCase[] = loadInitialCases();
let logs: AuditLogEntry[] = loadInitialLogs();

const listeners = new Set<() => void>();

function loadInitialCases(): SavCase[] {
  if (typeof window === 'undefined') {
    return [...DEMO_CASES];
  }
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
  if (typeof window === 'undefined') {
    return [];
  }
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
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(CASES_KEY, JSON.stringify(cases));
      } catch (e) {
        console.error('[NIMR v24] Failed to save cases to localStorage:', e);
      }
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
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(LOGS_KEY, JSON.stringify(logs));
      } catch (e) {
        console.error('[NIMR v24] Failed to save logs to localStorage:', e);
      }
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
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(CASES_KEY, JSON.stringify(cases));
        window.localStorage.setItem(LOGS_KEY, JSON.stringify(logs));
      } catch (e) {
        console.error('[NIMR v24] Failed to reset localStorage:', e);
      }
    }
    notify();
  },

  clearAll() {
    cases = [];
    logs = [];
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(CASES_KEY);
        window.localStorage.removeItem(LOGS_KEY);
      } catch (e) {
        console.error('[NIMR v24] Failed to clear localStorage:', e);
      }
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

    const blockingReasons = getBlockingClaimsReasons(caseObj.claims || [], caseObj.claimsOverridden);
    if (blockingReasons.length > 0 && actor.role !== 'admin') {
      throw new Error('Planification bloquée : accord expert/client manquant');
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

  getCasesForTechnician(technicianId: string): SavCase[] {
    return cases.filter((c) => c.assignedTechnicianId === technicianId);
  },

  startTechnicianWork(caseId: string, actor: { id: string; role: Role }) {
    const caseObj = cases.find((c) => c.id === caseId);
    if (!caseObj) throw new Error(`Case ${caseId} not found.`);

    if (actor.role !== 'technicien') {
      throw new Error('Only technicians can perform this action.');
    }

    if (caseObj.assignedTechnicianId !== actor.id) {
      throw new Error('This dossier is not assigned to you.');
    }

    if (caseObj.status === 'closed' || caseObj.status === 'cancelled') {
      throw new Error(`Cases in ${caseObj.status} status cannot be modified.`);
    }

    if (!hasPermission(actor.role, 'start_repair')) {
      throw new Error('You do not have permission to start repair.');
    }

    if (caseObj.status === 'repair') {
      const infoLog = createAuditLog(
        caseId,
        actor.id,
        actor.role,
        'technician_start_work',
        'repair',
        'repair',
        `Intervention déjà en cours de réparation (déjà au statut repair).`
      );
      this.addLog(infoLog);
      return;
    }

    const result = transitionCase(caseObj, 'repair', actor);
    if (!result.success || !result.updatedCase || !result.auditLog) {
      throw new Error(result.error || 'Failed to start technician work.');
    }

    this.addCase(result.updatedCase);
    this.addLog(result.auditLog);

    const startLog = createAuditLog(
      caseId,
      actor.id,
      actor.role,
      'technician_start_work',
      caseObj.status,
      'repair',
      `Intervention démarrée par le technicien ${actor.id}.`
    );
    this.addLog(startLog);
  },

  updateWorkshopTaskStatus(
    caseId: string,
    taskId: string,
    nextStatus: 'pending' | 'in_progress' | 'done',
    actor: { id: string; role: Role }
  ) {
    const caseObj = cases.find((c) => c.id === caseId);
    if (!caseObj) throw new Error(`Case ${caseId} not found.`);

    if (actor.role !== 'technicien') {
      throw new Error('Only technicians can perform this action.');
    }

    if (caseObj.assignedTechnicianId !== actor.id) {
      throw new Error('This dossier is not assigned to you.');
    }

    if (caseObj.status === 'closed' || caseObj.status === 'cancelled') {
      throw new Error(`Cases in ${caseObj.status} status cannot be modified.`);
    }

    if (!hasPermission(actor.role, 'update_task_status')) {
      throw new Error('You do not have permission to update task status.');
    }

    const tasks = caseObj.workshopTasks || [];
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found.`);

    const currentStatus = task.status;
    const isValidTransition =
      (currentStatus === 'pending' && nextStatus === 'in_progress') ||
      (currentStatus === 'in_progress' && nextStatus === 'done');

    if (!isValidTransition) {
      throw new Error(`Invalid task transition from ${currentStatus} to ${nextStatus}.`);
    }

    const updatedTasks = tasks.map((t) =>
      t.id === taskId ? { ...t, status: nextStatus } : t
    );

    const updatedCase: SavCase = {
      ...caseObj,
      workshopTasks: updatedTasks,
      updatedAt: new Date().toISOString(),
    };

    this.addCase(updatedCase);

    const log = createAuditLog(
      caseId,
      actor.id,
      actor.role,
      'technician_update_task',
      caseObj.status,
      caseObj.status,
      `Tâche "${task.label}" passée de ${currentStatus} à ${nextStatus}.`
    );
    this.addLog(log);
  },

  completeTechnicianWork(caseId: string, actor: { id: string; role: Role }) {
    const caseObj = cases.find((c) => c.id === caseId);
    if (!caseObj) throw new Error(`Case ${caseId} not found.`);

    if (actor.role !== 'technicien') {
      throw new Error('Only technicians can perform this action.');
    }

    if (caseObj.assignedTechnicianId !== actor.id) {
      throw new Error('This dossier is not assigned to you.');
    }

    if (caseObj.status === 'closed' || caseObj.status === 'cancelled') {
      throw new Error(`Cases in ${caseObj.status} status cannot be modified.`);
    }

    if (!hasPermission(actor.role, 'complete_work')) {
      throw new Error('You do not have permission to complete work.');
    }

    if (caseObj.status !== 'repair') {
      throw new Error(`Cannot complete work: current status must be repair, got ${caseObj.status}.`);
    }

    const tasks = caseObj.workshopTasks || [];
    if (tasks.length === 0) {
      throw new Error('Cannot complete work: no workshop tasks exist.');
    }

    const hasUnfinished = tasks.some((t) => t.status !== 'done');
    if (hasUnfinished) {
      throw new Error('Cannot complete work: some workshop tasks are not completed.');
    }

    const result = transitionCase(caseObj, 'work_completed', actor);
    if (!result.success || !result.updatedCase || !result.auditLog) {
      throw new Error(result.error || 'Failed to complete work.');
    }

    this.addCase(result.updatedCase);
    this.addLog(result.auditLog);

    const completeLog = createAuditLog(
      caseId,
      actor.id,
      actor.role,
      'technician_complete_work',
      caseObj.status,
      'work_completed',
      `Intervention terminée par le technicien ${actor.id}.`
    );
    this.addLog(completeLog);
  },

  getQualityCases(): SavCase[] {
    return cases.filter((c) =>
      c.status === 'work_completed' ||
      c.status === 'quality_pending' ||
      c.status === 'quality_rejected' ||
      c.status === 'quality_rework'
    );
  },

  startQualityCheck(caseId: string, actor: { id: string; role: Role }) {
    const caseObj = cases.find((c) => c.id === caseId);
    if (!caseObj) throw new Error(`Case ${caseId} not found.`);

    if (actor.role !== 'qualite') {
      throw new Error('Only QC role can perform this action.');
    }

    if (caseObj.status === 'closed' || caseObj.status === 'cancelled') {
      throw new Error(`Cases in ${caseObj.status} status cannot be modified.`);
    }

    if (!hasPermission(actor.role, 'start_quality_check')) {
      throw new Error(`Role ${actor.role} is not permitted to start quality check.`);
    }

    const result = transitionCase(caseObj, 'quality_pending', actor);
    if (!result.success || !result.updatedCase || !result.auditLog) {
      throw new Error(result.error || 'Failed to start quality check.');
    }

    let checklist = result.updatedCase.qcChecklist;
    if (!checklist || (Array.isArray(checklist) && checklist.length === 0)) {
      checklist = JSON.parse(JSON.stringify(DEMO_QC_CHECKLIST));
    }

    const updatedCase: SavCase = {
      ...result.updatedCase,
      qcStatus: 'in_progress',
      qcChecklist: checklist,
      updatedAt: new Date().toISOString(),
    };

    this.addCase(updatedCase);
    this.addLog(result.auditLog);

    const log = createAuditLog(
      caseId,
      actor.id,
      actor.role,
      'qc_start_check',
      caseObj.status,
      'quality_pending',
      `Contrôle qualité démarré par ${actor.id}.`
    );
    this.addLog(log);
  },

  updateQualityChecklist(caseId: string, checklist: QcChecklistItem[], actor: { id: string; role: Role }) {
    const caseObj = cases.find((c) => c.id === caseId);
    if (!caseObj) throw new Error(`Case ${caseId} not found.`);

    if (actor.role !== 'qualite') {
      throw new Error('Only QC role can perform this action.');
    }

    if (caseObj.status === 'closed' || caseObj.status === 'cancelled') {
      throw new Error(`Cases in ${caseObj.status} status cannot be modified.`);
    }

    if (!hasPermission(actor.role, 'validate_qc')) {
      throw new Error(`Role ${actor.role} is not permitted to update checklist.`);
    }

    const updatedCase: SavCase = {
      ...caseObj,
      qcChecklist: checklist,
      qcStatus: 'in_progress',
      updatedAt: new Date().toISOString(),
    };

    this.addCase(updatedCase);

    const log = createAuditLog(
      caseId,
      actor.id,
      actor.role,
      'qc_update_checklist',
      caseObj.status,
      caseObj.status,
      `Checklist QC mise à jour par ${actor.id}.`
    );
    this.addLog(log);
  },

  approveQualityCheck(caseId: string, actor: { id: string; role: Role }) {
    const caseObj = cases.find((c) => c.id === caseId);
    if (!caseObj) throw new Error(`Case ${caseId} not found.`);

    if (actor.role !== 'qualite') {
      throw new Error('Only QC role can perform this action.');
    }

    if (caseObj.status === 'closed' || caseObj.status === 'cancelled') {
      throw new Error(`Cases in ${caseObj.status} status cannot be modified.`);
    }

    if (!hasPermission(actor.role, 'validate_qc')) {
      throw new Error(`Role ${actor.role} is not permitted to validate QC.`);
    }

    const items = Array.isArray(caseObj.qcChecklist) ? caseObj.qcChecklist : (caseObj.qcChecklist?.items || []);
    const hasUnfinishedRequired = items.some((item) => item.required && !item.checked);
    if (hasUnfinishedRequired) {
      throw new Error('Cannot approve Quality Control: not all required checklist items are checked.');
    }

    const result = transitionCase(caseObj, 'quality_approved', actor);
    if (!result.success || !result.updatedCase || !result.auditLog) {
      throw new Error(result.error || 'Failed to approve quality check.');
    }

    const nowStr = new Date().toISOString();
    let updatedChecklist = result.updatedCase.qcChecklist;
    if (updatedChecklist && !Array.isArray(updatedChecklist)) {
      updatedChecklist = {
        ...updatedChecklist,
        validatedBy: actor.id,
        validatedAt: nowStr,
      };
    }

    const updatedCase: SavCase = {
      ...result.updatedCase,
      qcStatus: 'approved',
      qcCheckedAt: nowStr,
      qcCheckedBy: actor.id,
      qcChecklist: updatedChecklist,
      updatedAt: nowStr,
    };

    this.addCase(updatedCase);
    this.addLog(result.auditLog);

    const log = createAuditLog(
      caseId,
      actor.id,
      actor.role,
      'qc_approve',
      caseObj.status,
      'quality_approved',
      `Contrôle qualité validé par ${actor.id}.`
    );
    this.addLog(log);
  },

  rejectQualityCheck(caseId: string, reason: string, actor: { id: string; role: Role }) {
    const caseObj = cases.find((c) => c.id === caseId);
    if (!caseObj) throw new Error(`Case ${caseId} not found.`);

    if (actor.role !== 'qualite') {
      throw new Error('Only QC role can perform this action.');
    }

    if (caseObj.status === 'closed' || caseObj.status === 'cancelled') {
      throw new Error(`Cases in ${caseObj.status} status cannot be modified.`);
    }

    if (!hasPermission(actor.role, 'reject_qc')) {
      throw new Error(`Role ${actor.role} is not permitted to reject QC.`);
    }

    if (!reason || reason.trim() === '') {
      throw new Error('Rejection reason is required.');
    }

    const caseWithReason: SavCase = {
      ...caseObj,
      qcRejectionReason: reason,
    };

    const result = transitionCase(caseWithReason, 'quality_rejected', actor);
    if (!result.success || !result.updatedCase || !result.auditLog) {
      throw new Error(result.error || 'Failed to reject quality check.');
    }

    const nowStr = new Date().toISOString();
    let updatedChecklist = result.updatedCase.qcChecklist;
    if (updatedChecklist && !Array.isArray(updatedChecklist)) {
      updatedChecklist = {
        ...updatedChecklist,
        rejectionReason: reason,
      };
    }

    const updatedCase: SavCase = {
      ...result.updatedCase,
      qcStatus: 'rejected',
      qcRejectionReason: reason,
      qcCheckedAt: nowStr,
      qcCheckedBy: actor.id,
      qcChecklist: updatedChecklist,
      updatedAt: nowStr,
    };

    this.addCase(updatedCase);
    this.addLog(result.auditLog);

    const log = createAuditLog(
      caseId,
      actor.id,
      actor.role,
      'qc_reject',
      caseObj.status,
      'quality_rejected',
      `Contrôle qualité rejeté par ${actor.id}. Motif: ${reason}`
    );
    this.addLog(log);
  },

  sendQualityCaseToRework(caseId: string, reason: string, actor: { id: string; role: Role }) {
    const caseObj = cases.find((c) => c.id === caseId);
    if (!caseObj) throw new Error(`Case ${caseId} not found.`);

    if (actor.role !== 'qualite') {
      throw new Error('Only QC role can perform this action.');
    }

    if (caseObj.status === 'closed' || caseObj.status === 'cancelled') {
      throw new Error(`Cases in ${caseObj.status} status cannot be modified.`);
    }

    if (!hasPermission(actor.role, 'send_to_rework')) {
      throw new Error(`Role ${actor.role} is not permitted to send case to rework.`);
    }

    if (!reason || reason.trim() === '') {
      throw new Error('Rework reason is required.');
    }

    const caseWithReason: SavCase = {
      ...caseObj,
      qcReworkReason: reason,
    };

    const result = transitionCase(caseWithReason, 'quality_rework', actor);
    if (!result.success || !result.updatedCase || !result.auditLog) {
      throw new Error(result.error || 'Failed to send case to rework.');
    }

    const nowStr = new Date().toISOString();
    const updatedCase: SavCase = {
      ...result.updatedCase,
      qcReworkReason: reason,
      qcStatus: 'in_progress',
      updatedAt: nowStr,
    };

    this.addCase(updatedCase);
    this.addLog(result.auditLog);

    const log = createAuditLog(
      caseId,
      actor.id,
      actor.role,
      'qc_send_rework',
      caseObj.status,
      'quality_rework',
      `Dossier envoyé en reprise atelier par ${actor.id}. Motif: ${reason}`
    );
    this.addLog(log);
  },

  getDeliveryCases(): SavCase[] {
    return cases.filter(
      (c) =>
        c.status === 'quality_approved' ||
        c.status === 'ready_delivery' ||
        c.status === 'delivered'
    );
  },

  prepareDelivery(caseId: string, actor: { id: string; role: Role }) {
    const caseObj = cases.find((c) => c.id === caseId);
    if (!caseObj) throw new Error(`Case ${caseId} not found.`);

    if (actor.role !== 'livraison') {
      throw new Error('Only Livraison role can perform this action.');
    }

    if (caseObj.status === 'closed' || caseObj.status === 'cancelled') {
      throw new Error(`Cases in ${caseObj.status} status cannot be modified.`);
    }

    if (!hasPermission(actor.role, 'prepare_delivery')) {
      throw new Error(`Role ${actor.role} is not permitted to prepare delivery.`);
    }

    const result = transitionCase(caseObj, 'ready_delivery', actor);
    if (!result.success || !result.updatedCase || !result.auditLog) {
      throw new Error(result.error || 'Failed to prepare delivery.');
    }

    const nowStr = new Date().toISOString();
    const updatedCase: SavCase = {
      ...result.updatedCase,
      deliveryPreparedAt: nowStr,
      deliveryPreparedBy: actor.id,
      updatedAt: nowStr,
    };

    this.addCase(updatedCase);
    this.addLog(result.auditLog);

    const transitionStatusLog = createAuditLog(
      caseId,
      actor.id,
      actor.role,
      'transition_status',
      caseObj.status,
      'ready_delivery',
      `Statut mis à jour: ${caseObj.status} -> ready_delivery`
    );
    this.addLog(transitionStatusLog);

    const log = createAuditLog(
      caseId,
      actor.id,
      actor.role,
      'delivery_prepare',
      caseObj.status,
      'ready_delivery',
      `Préparation de la livraison par ${actor.id}.`
    );
    this.addLog(log);
  },

  deliverCase(
    caseId: string,
    deliveryPayload: { recipientName: string; proofReference: string; notes?: string },
    actor: { id: string; role: Role }
  ) {
    const caseObj = cases.find((c) => c.id === caseId);
    if (!caseObj) throw new Error(`Case ${caseId} not found.`);

    if (actor.role !== 'livraison') {
      throw new Error('Only Livraison role can perform this action.');
    }

    if (caseObj.status === 'closed' || caseObj.status === 'cancelled') {
      throw new Error(`Cases in ${caseObj.status} status cannot be modified.`);
    }

    if (!hasPermission(actor.role, 'deliver_case')) {
      throw new Error(`Role ${actor.role} is not permitted to deliver case.`);
    }

    const { recipientName, proofReference, notes } = deliveryPayload;
    if (!recipientName || recipientName.trim() === '') {
      throw new Error('Recipient name is required.');
    }
    if (!proofReference || proofReference.trim() === '') {
      throw new Error('Proof reference is required.');
    }

    const caseWithPayload: SavCase = {
      ...caseObj,
      deliveryRecipientName: recipientName,
      deliveryProofReference: proofReference,
      deliveryNotes: notes,
    };

    const result = transitionCase(caseWithPayload, 'delivered', actor);
    if (!result.success || !result.updatedCase || !result.auditLog) {
      throw new Error(result.error || 'Failed to deliver case.');
    }

    const nowStr = new Date().toISOString();
    const updatedCase: SavCase = {
      ...result.updatedCase,
      deliveredAt: nowStr,
      deliveredBy: actor.id,
      deliveryDate: nowStr,
      updatedAt: nowStr,
    };

    this.addCase(updatedCase);
    this.addLog(result.auditLog);

    const transitionStatusLog = createAuditLog(
      caseId,
      actor.id,
      actor.role,
      'transition_status',
      caseObj.status,
      'delivered',
      `Statut mis à jour: ${caseObj.status} -> delivered`,
      recipientName,
      proofReference
    );
    this.addLog(transitionStatusLog);

    const proofLog = createAuditLog(
      caseId,
      actor.id,
      actor.role,
      'delivery_proof_added',
      caseObj.status,
      caseObj.status,
      `Preuve de livraison ajoutée par ${actor.id}. Réf: ${proofReference}, Récipiendaire: ${recipientName}.`,
      recipientName,
      proofReference
    );
    this.addLog(proofLog);

    const completeLog = createAuditLog(
      caseId,
      actor.id,
      actor.role,
      'delivery_complete',
      caseObj.status,
      'delivered',
      `Livraison effectuée avec succès par ${actor.id}.`,
      recipientName,
      proofReference
    );
    this.addLog(completeLog);
  },

  getDirectorDashboard(now?: Date) {
    return calculateDirectorDashboard(cases, logs, now);
  },

  getDirectorCases() {
    return cases.map((c) => ({ ...c }));
  },

  getDirectorAlerts(now?: Date) {
    return calculateBlockingAlerts(cases, now);
  },

  getDirectorTechnicianLoad() {
    return calculateTechnicianLoad(cases);
  },

  getAdminGovernanceSummary() {
    return {
      matrix: getRoleGovernanceMatrix(),
      totalCases: cases.length,
      totalLogs: logs.length,
    };
  },

  getReadOnlyCases() {
    return cases.map((c) => ({ ...c }));
  },

  getReadOnlyLogs() {
    return logs.map((l) => ({ ...l }));
  },

  getSystemInvariants() {
    return {
      localStoragePrefix: LS_PREFIX,
      appVersion: APP_VERSION,
      reservedCacheName: RESERVED_CACHE_NAME,
      v23Status: 'v23.2.6 reste stable / pilote',
      vehiclesJsonConstraint: 'data/vehicles.json doit rester []',
      serviceWorkerStatus: 'aucun service worker React actif',
    };
  },

  addClaim(caseId: string, claim: Partial<Claim>, actor: { id: string; role: Role }) {
    const caseObj = cases.find((c) => c.id === caseId);
    if (!caseObj) throw new Error(`Case ${caseId} not found.`);
    if (!hasPermission(actor.role, 'manage_claims')) {
      throw new Error(`Role ${actor.role} is not permitted to manage claims.`);
    }
    const normalized = normalizeClaim(claim);
    const existingClaims = caseObj.claims || [];
    const updatedCase: SavCase = {
      ...caseObj,
      claims: [...existingClaims, normalized],
      updatedAt: new Date().toISOString(),
    };
    this.addCase(updatedCase);

    const log = createAuditLog(
      caseId,
      actor.id,
      actor.role,
      'add_claim',
      caseObj.status,
      caseObj.status,
      `Sinistre "${normalized.label}" ajouté (Type: ${normalized.claimType}, Payeur: ${normalized.payerType}).`
    );
    this.addLog(log);
  },

  updateClaim(caseId: string, claimId: string, updatedFields: Partial<Claim>, actor: { id: string; role: Role }) {
    const caseObj = cases.find((c) => c.id === caseId);
    if (!caseObj) throw new Error(`Case ${caseId} not found.`);
    if (!hasPermission(actor.role, 'manage_claims')) {
      throw new Error(`Role ${actor.role} is not permitted to manage claims.`);
    }
    const existingClaims = caseObj.claims || [];
    const updatedClaims = existingClaims.map((claim) => {
      if (claim.id === claimId) {
        return normalizeClaim({ ...claim, ...updatedFields, updatedAt: new Date().toISOString() });
      }
      return claim;
    });
    const updatedCase: SavCase = {
      ...caseObj,
      claims: updatedClaims,
      updatedAt: new Date().toISOString(),
    };
    this.addCase(updatedCase);

    const log = createAuditLog(
      caseId,
      actor.id,
      actor.role,
      'update_claim',
      caseObj.status,
      caseObj.status,
      `Sinistre "${claimId}" mis à jour.`
    );
    this.addLog(log);
  },

  approveClaimExpert(caseId: string, claimId: string, expertName: string, actor: { id: string; role: Role }) {
    const caseObj = cases.find((c) => c.id === caseId);
    if (!caseObj) throw new Error(`Case ${caseId} not found.`);
    if (!hasPermission(actor.role, 'approve_claim_expert')) {
      throw new Error(`Role ${actor.role} is not permitted to approve claims as expert.`);
    }
    const existingClaims = caseObj.claims || [];
    const updatedClaims = existingClaims.map((claim) => {
      if (claim.id === claimId) {
        return approveClaimExpert(claim, expertName);
      }
      return claim;
    });
    const updatedCase: SavCase = {
      ...caseObj,
      claims: updatedClaims,
      updatedAt: new Date().toISOString(),
    };
    this.addCase(updatedCase);

    const log = createAuditLog(
      caseId,
      actor.id,
      actor.role,
      'approve_claim_expert',
      caseObj.status,
      caseObj.status,
      `Accord expert validé par ${expertName} pour le sinistre "${claimId}".`
    );
    this.addLog(log);
  },

  approveClaimClient(caseId: string, claimId: string, reference: string, actor: { id: string; role: Role }) {
    const caseObj = cases.find((c) => c.id === caseId);
    if (!caseObj) throw new Error(`Case ${caseId} not found.`);
    if (!hasPermission(actor.role, 'approve_claim_client')) {
      throw new Error(`Role ${actor.role} is not permitted to approve claims as client.`);
    }
    const existingClaims = caseObj.claims || [];
    const updatedClaims = existingClaims.map((claim) => {
      if (claim.id === claimId) {
        return approveClaimClient(claim, reference);
      }
      return claim;
    });
    const updatedCase: SavCase = {
      ...caseObj,
      claims: updatedClaims,
      updatedAt: new Date().toISOString(),
    };
    this.addCase(updatedCase);

    const log = createAuditLog(
      caseId,
      actor.id,
      actor.role,
      'approve_claim_client',
      caseObj.status,
      caseObj.status,
      `Accord client validé (Réf: ${reference}) pour le sinistre "${claimId}".`
    );
    this.addLog(log);
  },

  rejectClaim(caseId: string, claimId: string, reason: string, actor: { id: string; role: Role }) {
    const caseObj = cases.find((c) => c.id === caseId);
    if (!caseObj) throw new Error(`Case ${caseId} not found.`);
    if (!hasPermission(actor.role, 'manage_claims')) {
      throw new Error(`Role ${actor.role} is not permitted to reject claims.`);
    }
    const existingClaims = caseObj.claims || [];
    const updatedClaims = existingClaims.map((claim) => {
      if (claim.id === claimId) {
        return rejectClaim(claim, reason);
      }
      return claim;
    });
    const updatedCase: SavCase = {
      ...caseObj,
      claims: updatedClaims,
      updatedAt: new Date().toISOString(),
    };
    this.addCase(updatedCase);

    const log = createAuditLog(
      caseId,
      actor.id,
      actor.role,
      'reject_claim',
      caseObj.status,
      caseObj.status,
      `Sinistre "${claimId}" rejeté pour la raison : ${reason}.`
    );
    this.addLog(log);
  },

  cancelClaim(caseId: string, claimId: string, actor: { id: string; role: Role }) {
    const caseObj = cases.find((c) => c.id === caseId);
    if (!caseObj) throw new Error(`Case ${caseId} not found.`);
    if (!hasPermission(actor.role, 'manage_claims')) {
      throw new Error(`Role ${actor.role} is not permitted to cancel claims.`);
    }
    const existingClaims = caseObj.claims || [];
    const updatedClaims = existingClaims.map((claim) => {
      if (claim.id === claimId) {
        return cancelClaim(claim);
      }
      return claim;
    });
    const updatedCase: SavCase = {
      ...caseObj,
      claims: updatedClaims,
      updatedAt: new Date().toISOString(),
    };
    this.addCase(updatedCase);

    const log = createAuditLog(
      caseId,
      actor.id,
      actor.role,
      'cancel_claim',
      caseObj.status,
      caseObj.status,
      `Sinistre "${claimId}" annulé.`
    );
    this.addLog(log);
  },

  overrideClaims(caseId: string, reason: string, actor: { id: string; role: Role }) {
    const caseObj = cases.find((c) => c.id === caseId);
    if (!caseObj) throw new Error(`Case ${caseId} not found.`);
    if (!hasPermission(actor.role, 'override_claims')) {
      throw new Error(`Role ${actor.role} is not permitted to override claims.`);
    }
    if (!reason || reason.trim() === '') {
      throw new Error('Un motif est obligatoire pour effectuer un override.');
    }
    const updatedCase: SavCase = {
      ...caseObj,
      claimsOverridden: true,
      claimsOverrideReason: reason,
      claimsOverrideAt: new Date().toISOString(),
      claimsOverrideBy: actor.id,
      updatedAt: new Date().toISOString(),
    };
    this.addCase(updatedCase);

    const log = createAuditLog(
      caseId,
      actor.id,
      actor.role,
      'override_claims',
      caseObj.status,
      caseObj.status,
      `Override exceptionnel des accords effectué. Motif : ${reason}.`
    );
    this.addLog(log);
  },
};
