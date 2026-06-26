import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock localStorage for Node environment
const storage: Record<string, string> = {};
const localStorageMock = new Proxy({
  getItem: (key: string) => storage[key] || null,
  setItem: (key: string, value: string) => { storage[key] = value; },
  removeItem: (key: string) => { delete storage[key]; },
  clear: () => {
    for (const k in storage) {
      delete storage[k];
    }
  },
  key: (index: number) => Object.keys(storage)[index] || null,
  get length() { return Object.keys(storage).length; }
}, {
  get(target, prop, receiver) {
    if (prop in target) {
      return Reflect.get(target, prop, receiver);
    }
    return storage[prop as string];
  },
  set(target, prop, value) {
    storage[prop as string] = value as string;
    return true;
  },
  ownKeys() {
    return Object.keys(storage);
  },
  getOwnPropertyDescriptor(target, prop) {
    return {
      enumerable: true,
      configurable: true,
      writable: true,
      value: storage[prop as string]
    };
  }
});

if (typeof global.window === 'undefined') {
  global.window = {
    localStorage: localStorageMock,
  } as unknown as Window & typeof globalThis;
}

import { savCaseStore } from '../src/state/sav-case-store';
import { SavCase } from '../src/domain/sav-case';
import { transitionCase } from '../src/domain/workflow-engine';
import { hasPermission } from '../src/domain/action-permissions';
import { AuditLogEntry } from '../src/domain/audit-log';

describe('SAV End-to-End Workflow Readiness (v24.0.0-alpha.13)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    savCaseStore.clearAll();
  });

  afterEach(() => {
    window.localStorage.clear();
    savCaseStore.clearAll();
  });

  it('runs a complete case workflow and blocks unauthorised transitions', () => {
    // ----------------------------------------------------
    // A. Réception
    // ----------------------------------------------------
    const actorReception = { id: 'recep-1', role: 'reception' as const };
    const actorReader = { id: 'reader-1', role: 'lecture-seule' as const };
    const actorDirector = { id: 'director-1', role: 'directeur-sav' as const };

    const initialCase: SavCase = {
      id: 'case-e2e',
      immatriculation: 'AA-999-ZZ',
      vin: 'VINE2E00000000001',
      clientName: 'Client E2E',
      telephone: '06123456',
      status: 'draft',
      createdAt: '2026-06-25T12:00:00Z',
      updatedAt: '2026-06-25T12:00:00Z',
      receptionDate: '2026-06-25T12:00:00Z',
      workshopTasks: [
        { id: 'task-1', label: 'Diagnostic Carrosserie', status: 'done', createdAt: '2026-06-25T12:00:00Z' }
      ],
      qcChecklist: [
        { id: 'qc-1', label: 'Conformité peinture', checked: true, required: true }
      ]
    };

    // Store starting case
    savCaseStore.addCase(initialCase);

    // Negative constraints: lecture-seule cannot create/transition
    const readerRes = transitionCase(initialCase, 'received', actorReader);
    expect(readerRes.success).toBe(false);

    // Negative constraints: directeur-sav does not write workflow transitions (dashboard remains view-only)
    const directorRes = transitionCase(initialCase, 'received', actorDirector);
    expect(directorRes.success).toBe(false);
    expect(hasPermission('directeur-sav', 'create_case')).toBe(false);
    expect(hasPermission('directeur-sav', 'receive_case')).toBe(false);

    // Valid reception transition: draft -> received
    const receptionRes = transitionCase(initialCase, 'received', actorReception);
    expect(receptionRes.success).toBe(true);
    let caseState = receptionRes.updatedCase!;
    expect(caseState.status).toBe('received');
    savCaseStore.addCase(caseState);
    savCaseStore.addLog(receptionRes.auditLog!);

    // ----------------------------------------------------
    // B. Chef d'Atelier
    // ----------------------------------------------------
    const actorChef = { id: 'chef-1', role: 'chef-atelier' as const };
    const actorTech = { id: 'tech-1', role: 'technicien' as const };
    const actorLivraison = { id: 'liv-1', role: 'livraison' as const };

    // Negative check: technician cannot plan or assign
    expect(hasPermission('technicien', 'assign_technician')).toBe(false);
    expect(hasPermission('livraison', 'schedule_case')).toBe(false);

    // Chef Atelier transitions: received -> diagnosis
    const chefRes = transitionCase(caseState, 'diagnosis', actorChef);
    expect(chefRes.success).toBe(true);
    caseState = chefRes.updatedCase!;
    // Chef Atelier assigns technician
    caseState.assignedTechnicianId = 'tech-1';
    caseState.assignedTechnicianName = 'Technicien Un';
    // Chef Atelier transitions: diagnosis -> repair
    const chefRepairRes = transitionCase(caseState, 'repair', actorChef);
    expect(chefRepairRes.success).toBe(true);
    caseState = chefRepairRes.updatedCase!;
    savCaseStore.addCase(caseState);

    // ----------------------------------------------------
    // C. Technicien
    // ----------------------------------------------------
    // Tech only sees their cases (we verify logic)
    const techCases = savCaseStore.getCases().filter(c => c.assignedTechnicianId === actorTech.id);
    expect(techCases).toHaveLength(1);

    // Tech transitions: repair -> work_completed
    const techRes = transitionCase(caseState, 'work_completed', actorTech);
    expect(techRes.success).toBe(true);
    caseState = techRes.updatedCase!;
    savCaseStore.addCase(caseState);

    // Negative checks: tech cannot QC or deliver
    expect(hasPermission('technicien', 'validate_qc')).toBe(false);
    expect(hasPermission('technicien', 'deliver_case')).toBe(false);

    // ----------------------------------------------------
    // D. Contrôle Qualité
    // ----------------------------------------------------
    const actorQc = { id: 'qc-1', role: 'qualite' as const };

    // Transition work_completed -> quality_pending
    const qcPendingRes = transitionCase(caseState, 'quality_pending', actorQc);
    expect(qcPendingRes.success).toBe(true);
    caseState = qcPendingRes.updatedCase!;

    // Negative QC validations: reception & livraison cannot validate QC
    expect(hasPermission('reception', 'validate_qc')).toBe(false);
    expect(hasPermission('livraison', 'validate_qc')).toBe(false);

    // Qualite does a rejection first (rework cycle)
    caseState.qcRejectionReason = 'Défaut peinture constaté';
    const qcRejectRes = transitionCase(caseState, 'quality_rejected', actorQc);
    expect(qcRejectRes.success).toBe(true);
    caseState = qcRejectRes.updatedCase!;
    expect(caseState.status).toBe('quality_rejected');

    // Transition to rework
    caseState.qcReworkReason = 'Reprendre la peinture sur l\'aile gauche';
    const qcReworkRes = transitionCase(caseState, 'quality_rework', actorQc);
    expect(qcReworkRes.success).toBe(true);
    caseState = qcReworkRes.updatedCase!;
    expect(caseState.status).toBe('quality_rework');

    // Repair complete again, transition back to quality_pending
    const techCompletesAgain = transitionCase(caseState, 'quality_pending', actorQc);
    expect(techCompletesAgain.success).toBe(true);
    caseState = techCompletesAgain.updatedCase!;

    // Qualite approves QC
    const qcApproveRes = transitionCase(caseState, 'quality_approved', actorQc);
    expect(qcApproveRes.success).toBe(true);
    caseState = qcApproveRes.updatedCase!;
    caseState.qcStatus = 'approved'; // Mark approved
    caseState.qcCheckedBy = 'qc-1'; // set validator name
    savCaseStore.addCase(caseState);

    // ----------------------------------------------------
    // E. Livraison
    // ----------------------------------------------------
    // Pre-delivery transition: quality_approved -> ready_delivery
    const readyDeliveryRes = transitionCase(caseState, 'ready_delivery', actorLivraison);
    expect(readyDeliveryRes.success).toBe(true);
    caseState = readyDeliveryRes.updatedCase!;

    // Confirms delivery: ready_delivery -> delivered
    caseState.deliveryRecipientName = 'M. Client';
    caseState.deliveryProofReference = 'PROOF-12345';
    const deliveryConfirmRes = transitionCase(caseState, 'delivered', actorLivraison);
    expect(deliveryConfirmRes.success).toBe(true);
    caseState = deliveryConfirmRes.updatedCase!;
    caseState.deliveredAt = new Date().toISOString();
    savCaseStore.addCase(caseState);

    // Negative check: reader cannot deliver
    const readerDeliverRes = transitionCase(caseState, 'delivered', actorReader);
    expect(readerDeliverRes.success).toBe(false);

    // ----------------------------------------------------
    // F. Non-Mutating Consultation Checks
    // ----------------------------------------------------
    const initialCasesLength = savCaseStore.getCases().length;
    const initialLogsLength = savCaseStore.getLogs().length;

    // Director query
    const directorCases = savCaseStore.getDirectorCases();
    expect(directorCases).toHaveLength(initialCasesLength);
    // Attempt mutation of the returned array and objects
    directorCases.push({} as SavCase);
    directorCases[0].clientName = 'MUTATED CLIENT';
    // Verify store remains untouched
    expect(savCaseStore.getCases()).toHaveLength(initialCasesLength);
    expect(savCaseStore.getCases()[0].clientName).not.toBe('MUTATED CLIENT');

    // Admin governance query
    const adminSummary = savCaseStore.getAdminGovernanceSummary();
    expect(adminSummary.totalCases).toBe(initialCasesLength);
    expect(adminSummary.totalLogs).toBe(initialLogsLength);

    // ReadOnly cases query
    const readonlyCases = savCaseStore.getReadOnlyCases();
    expect(readonlyCases).toHaveLength(initialCasesLength);
    readonlyCases.push({} as SavCase);
    readonlyCases[0].telephone = 'MUTATED PHONE';
    expect(savCaseStore.getCases()).toHaveLength(initialCasesLength);
    expect(savCaseStore.getCases()[0].telephone).not.toBe('MUTATED PHONE');

    // ReadOnly logs query
    const readonlyLogs = savCaseStore.getReadOnlyLogs();
    expect(readonlyLogs).toHaveLength(initialLogsLength);
    readonlyLogs.push({} as AuditLogEntry);
    readonlyLogs[0].action = 'MUTATED ACTION';
    expect(savCaseStore.getLogs()).toHaveLength(initialLogsLength);
    expect(savCaseStore.getLogs()[0].action).not.toBe('MUTATED ACTION');
  });
});
