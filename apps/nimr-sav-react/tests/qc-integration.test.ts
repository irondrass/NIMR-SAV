import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';

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

import { APP_VERSION, LS_PREFIX } from '../src/constants/version';
import { savCaseStore } from '../src/state/sav-case-store';
import { SavCase } from '../src/domain/sav-case';
import { hasPermission, canViewDirectionNotes } from '../src/domain/action-permissions';
import { transitionCase } from '../src/domain/workflow-engine';

describe('SAV Quality Control Integration (v24.0.0-alpha.17)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    savCaseStore.clearAll();
  });

  afterEach(() => {
    window.localStorage.clear();
    savCaseStore.clearAll();
  });

  // 1. Version Check
  it('has package.json and constants aligned to v24.0.0-alpha.17', () => {
    expect(APP_VERSION).toBe('v24.0.0-alpha.17');

    const pkgPath = resolve(__dirname, '../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.version).toBe('24.0.0-alpha.17');

    const lockPath = resolve(__dirname, '../package-lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
    expect(lock.version).toBe('24.0.0-alpha.17');
  });

  // 2. Case Filtering
  it('filters cases: QC only sees work_completed, quality_pending, quality_rejected, quality_rework', () => {
    const baseCase: SavCase = {
      id: 'case-base',
      immatriculation: 'DEMO-001',
      vin: 'VIN-DEMO-0001',
      clientName: 'Client',
      telephone: '00000000',
      status: 'received',
      receptionDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Add cases of various statuses
    savCaseStore.addCase({ ...baseCase, id: 'c1', status: 'received' });
    savCaseStore.addCase({ ...baseCase, id: 'c2', status: 'diagnosis' });
    savCaseStore.addCase({ ...baseCase, id: 'c3', status: 'repair' });
    savCaseStore.addCase({ ...baseCase, id: 'c4', status: 'work_completed' });
    savCaseStore.addCase({ ...baseCase, id: 'c5', status: 'quality_pending' });
    savCaseStore.addCase({ ...baseCase, id: 'c6', status: 'quality_rejected' });
    savCaseStore.addCase({ ...baseCase, id: 'c7', status: 'quality_rework' });
    savCaseStore.addCase({ ...baseCase, id: 'c8', status: 'delivered' });
    savCaseStore.addCase({ ...baseCase, id: 'c9', status: 'closed' });
    savCaseStore.addCase({ ...baseCase, id: 'c10', status: 'cancelled' });

    const visibleCases = savCaseStore.getQualityCases();
    expect(visibleCases).toHaveLength(4);
    const visibleIds = visibleCases.map(c => c.id);
    expect(visibleIds).toContain('c4');
    expect(visibleIds).toContain('c5');
    expect(visibleIds).toContain('c6');
    expect(visibleIds).toContain('c7');
    expect(visibleIds).not.toContain('c1');
    expect(visibleIds).not.toContain('c2');
    expect(visibleIds).not.toContain('c3');
    expect(visibleIds).not.toContain('c8');
    expect(visibleIds).not.toContain('c9');
    expect(visibleIds).not.toContain('c10');
  });

  // 3. Authorized Permissions for QC role
  it('allows actions for QC role: view_quality_cases, start_quality_check, validate_qc, reject_qc, send_to_rework, view_qc_history', () => {
    const role = 'qualite' as const;
    expect(hasPermission(role, 'view_quality_cases')).toBe(true);
    expect(hasPermission(role, 'start_quality_check')).toBe(true);
    expect(hasPermission(role, 'validate_qc')).toBe(true);
    expect(hasPermission(role, 'reject_qc')).toBe(true);
    expect(hasPermission(role, 'send_to_rework')).toBe(true);
    expect(hasPermission(role, 'view_qc_history')).toBe(true);
  });

  // 4. Forbidden Permissions for QC role
  it('blocks forbidden actions for QC role', () => {
    const role = 'qualite' as const;
    expect(hasPermission(role, 'create_case')).toBe(false);
    expect(hasPermission(role, 'assign_technician')).toBe(false);
    expect(hasPermission(role, 'schedule_case')).toBe(false); // plan task / priority
    expect(hasPermission(role, 'change_workshop_status')).toBe(false);
    expect(hasPermission(role, 'start_repair')).toBe(false);
    expect(hasPermission(role, 'complete_repair')).toBe(false);
    expect(hasPermission(role, 'complete_work')).toBe(false);
    expect(hasPermission(role, 'deliver_case')).toBe(false);
    expect(hasPermission(role, 'close_case')).toBe(false);
    expect(hasPermission(role, 'admin_action')).toBe(false);
    expect(canViewDirectionNotes(role)).toBe(false);
  });

  // 5. Workflow Transitions and Rules
  it('enforces QC status transition limits and validation rules', () => {
    const actor = { id: 'qc-user', role: 'qualite' as const };
    const caseId = 'case-qc-test';
    const baseCase: SavCase = {
      id: caseId,
      immatriculation: 'DEMO-001',
      vin: 'VIN-DEMO-0001',
      clientName: 'Client A',
      telephone: '00000000',
      status: 'work_completed',
      receptionDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    savCaseStore.addCase(baseCase);

    // 5.1 work_completed -> quality_pending (authorized)
    savCaseStore.startQualityCheck(caseId, actor);
    let updatedCase = savCaseStore.getCases().find(c => c.id === caseId)!;
    expect(updatedCase.status).toBe('quality_pending');
    expect(updatedCase.qcStatus).toBe('in_progress');
    expect(updatedCase.qcChecklist).toBeDefined();

    // 5.2 quality_pending -> quality_approved (refused if required items unchecked)
    expect(() => savCaseStore.approveQualityCheck(caseId, actor)).toThrow('Cannot approve Quality Control');

    // 5.3 Toggle checklist items
    const checklist = Array.isArray(updatedCase.qcChecklist) ? updatedCase.qcChecklist : [];
    // Check all required items
    const updatedChecklist = checklist.map(item =>
      item.required ? { ...item, checked: true } : item
    );
    savCaseStore.updateQualityChecklist(caseId, updatedChecklist, actor);

    // 5.4 quality_pending -> quality_approved (authorized now)
    savCaseStore.approveQualityCheck(caseId, actor);
    updatedCase = savCaseStore.getCases().find(c => c.id === caseId)!;
    expect(updatedCase.status).toBe('quality_approved');
    expect(updatedCase.qcStatus).toBe('approved');
    expect(updatedCase.qcCheckedBy).toBe(actor.id);
    expect(updatedCase.qcCheckedAt).toBeDefined();

    // Reset case back to quality_pending to test reject
    savCaseStore.addCase({ ...baseCase, status: 'quality_pending' });

    // 5.5 quality_pending -> quality_rejected (refused if empty reason)
    expect(() => savCaseStore.rejectQualityCheck(caseId, '', actor)).toThrow('Rejection reason is required');
    expect(() => savCaseStore.rejectQualityCheck(caseId, '   ', actor)).toThrow('Rejection reason is required');

    // 5.6 quality_pending -> quality_rejected (authorized with reason)
    savCaseStore.rejectQualityCheck(caseId, 'Essai routier ko', actor);
    updatedCase = savCaseStore.getCases().find(c => c.id === caseId)!;
    expect(updatedCase.status).toBe('quality_rejected');
    expect(updatedCase.qcStatus).toBe('rejected');
    expect(updatedCase.qcRejectionReason).toBe('Essai routier ko');

    // 5.7 quality_rejected -> quality_rework (refused if empty reason)
    expect(() => savCaseStore.sendQualityCaseToRework(caseId, '', actor)).toThrow('Rework reason is required');
    expect(() => savCaseStore.sendQualityCaseToRework(caseId, '   ', actor)).toThrow('Rework reason is required');

    // 5.8 quality_rejected -> quality_rework (authorized with reason)
    savCaseStore.sendQualityCaseToRework(caseId, 'Refaire serrage freins', actor);
    updatedCase = savCaseStore.getCases().find(c => c.id === caseId)!;
    expect(updatedCase.status).toBe('quality_rework');
    expect(updatedCase.qcReworkReason).toBe('Refaire serrage freins');

    // 5.9 Unauthorized transitions for QC role
    // Reset to repair
    const repairCase = { ...baseCase, status: 'repair' as const };
    const resRepair = transitionCase(repairCase, 'work_completed', actor);
    expect(resRepair.success).toBe(false); // QC cannot finish technician work
    expect(resRepair.error).toContain('Quality Control role is not authorized');

    const qcApprovedCase = { ...baseCase, status: 'quality_approved' as const };
    const resDelivery = transitionCase(qcApprovedCase, 'ready_delivery', actor);
    expect(resDelivery.success).toBe(false); // QC cannot send to ready_delivery
    expect(resDelivery.error).toContain('Quality Control role is not authorized');

    // 5.10 Protection of closed/cancelled cases
    const closedCase = { ...baseCase, id: 'closed-case-id', status: 'closed' as const };
    savCaseStore.addCase(closedCase);
    expect(() => savCaseStore.startQualityCheck(closedCase.id, actor)).toThrow('status cannot be modified');

    const cancelledCase = { ...baseCase, id: 'cancelled-case-id', status: 'cancelled' as const };
    savCaseStore.addCase(cancelledCase);
    expect(() => savCaseStore.startQualityCheck(cancelledCase.id, actor)).toThrow('status cannot be modified');
  });

  // 6. Audit Logging
  it('generates correct audit logs for QC actions', () => {
    const actor = { id: 'qc-logger', role: 'qualite' as const };
    const caseId = 'case-logger-test';
    const testCase: SavCase = {
      id: caseId,
      immatriculation: 'DEMO-001',
      vin: 'VIN-DEMO-0001',
      clientName: 'Client',
      telephone: '00000000',
      status: 'work_completed',
      receptionDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    savCaseStore.addCase(testCase);

    savCaseStore.startQualityCheck(caseId, actor);

    // Verify logs
    const dbLogs = savCaseStore.getLogs();
    const startLog = dbLogs.find(l => l.action === 'qc_start_check');
    const transitionLog = dbLogs.find(l => l.action === 'STATUS_TRANSITION');

    expect(startLog).toBeDefined();
    expect(startLog?.caseId).toBe(caseId);
    expect(startLog?.userId).toBe(actor.id);
    expect(startLog?.userRole).toBe(actor.role);
    expect(startLog?.timestamp).toBeDefined();

    expect(transitionLog).toBeDefined();
    expect(transitionLog?.caseId).toBe(caseId);
    expect(transitionLog?.userId).toBe(actor.id);
    expect(transitionLog?.userRole).toBe(actor.role);
    expect(transitionLog?.fromStatus).toBe('work_completed');
    expect(transitionLog?.toStatus).toBe('quality_pending');
    expect(transitionLog?.timestamp).toBeDefined();
  });

  // 7. Isolation Rules
  it('satisfies storage and isolation invariants', () => {
    // Prefix check
    expect(LS_PREFIX).toBe('nimr-sav-react-v24-');

    // Root data check
    const vehiclesPath = resolve(__dirname, '../../../data/vehicles.json');
    if (existsSync(vehiclesPath)) {
      const content = readFileSync(vehiclesPath, 'utf-8').trim();
      expect(content).toBe('[]');
    }

    // SW cache and file import checks
    const srcDir = resolve(__dirname, '../src');
    const checkDir = (dir: string): void => {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = resolve(dir, entry as string);
        if (statSync(fullPath).isDirectory()) {
          checkDir(fullPath);
        } else if ((entry as string).endsWith('.ts') || (entry as string).endsWith('.tsx')) {
          const content = readFileSync(fullPath, 'utf-8');
          expect(content).not.toMatch(/import[^'"]+['"].*vehicles\.json['"]/m);
          expect(content).not.toMatch(/require\(['"].*vehicles\.json['"]\)/m);
        }
      }
    };
    checkDir(srcDir);

    const htmlPath = resolve(__dirname, '../index.html');
    const content = readFileSync(htmlPath, 'utf-8');
    expect(content).not.toContain(['serviceWorker', 'register'].join('.'));
    expect(content).not.toContain(['navigator', 'serviceWorker'].join('.'));
  });
});
