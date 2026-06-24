import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
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

import { APP_VERSION, LS_PREFIX, FORBIDDEN_LS_PREFIXES } from '../src/constants/version';
import { DEMO_TECHNICIANS } from '../src/constants/demo-technicians';
import { savCaseStore } from '../src/state/sav-case-store';
import { SavCase } from '../src/domain/sav-case';
import { hasPermission, canViewDirectionNotes } from '../src/domain/action-permissions';

describe('SAV Technician Workflow Integration (v24.0.0-alpha.5)', () => {

  beforeEach(() => {
    window.localStorage.clear();
    savCaseStore.clearAll();
  });

  afterEach(() => {
    window.localStorage.clear();
    savCaseStore.clearAll();
  });

  // 1. Version Check
  it('has package.json and constants aligned to v24.0.0-alpha.5', () => {
    expect(APP_VERSION).toBe('v24.0.0-alpha.5');

    const pkgPath = resolve(__dirname, '../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.version).toBe('24.0.0-alpha.5');
  });

  // 2. Demo Technicians check
  it('has exactly 3 unique fictive demo technicians without real identity', () => {
    expect(DEMO_TECHNICIANS).toHaveLength(3);
    const ids = DEMO_TECHNICIANS.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(3);

    for (const t of DEMO_TECHNICIANS) {
      expect(t.id.startsWith('TECH-DEMO-')).toBe(true);
      expect(t.name).toContain('Technicien Démo');
    }
  });

  // 3. Case Filtering
  it('filters cases: technician only sees assigned cases', () => {
    const case1: SavCase = {
      id: 'case-1',
      immatriculation: 'DEMO-101',
      vin: 'VIN-DEMO-101',
      clientName: 'Client X',
      telephone: '00000000',
      status: 'received',
      assignedTechnicianId: 'TECH-DEMO-001',
      assignedTechnicianName: 'Technicien Démo A',
      receptionDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const case2: SavCase = {
      id: 'case-2',
      immatriculation: 'DEMO-102',
      vin: 'VIN-DEMO-102',
      clientName: 'Client Y',
      telephone: '00000000',
      status: 'received',
      assignedTechnicianId: 'TECH-DEMO-002',
      assignedTechnicianName: 'Technicien Démo B',
      receptionDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    savCaseStore.addCase(case1);
    savCaseStore.addCase(case2);

    const tech1Cases = savCaseStore.getCasesForTechnician('TECH-DEMO-001');
    expect(tech1Cases).toHaveLength(1);
    expect(tech1Cases[0].id).toBe('case-1');

    const tech2Cases = savCaseStore.getCasesForTechnician('TECH-DEMO-002');
    expect(tech2Cases).toHaveLength(1);
    expect(tech2Cases[0].id).toBe('case-2');

    const tech3Cases = savCaseStore.getCasesForTechnician('TECH-DEMO-003');
    expect(tech3Cases).toHaveLength(0);
  });

  // 4. Start Intervention & Transitions
  it('allows start work (diagnosis -> repair / waiting_parts -> repair) and blocks other transitions', () => {
    const actor = { id: 'TECH-DEMO-001', role: 'technicien' as const };
    const caseId = 'case-test';

    // Test case starting at diagnosis
    const diagCase: SavCase = {
      id: caseId,
      immatriculation: 'DEMO-001',
      vin: 'VIN-DEMO-001',
      clientName: 'Client A',
      telephone: '00000000',
      status: 'diagnosis',
      assignedTechnicianId: 'TECH-DEMO-001',
      assignedTechnicianName: 'Technicien Démo A',
      receptionDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    savCaseStore.addCase(diagCase);

    // Start work -> transitions diagnosis to repair
    savCaseStore.startTechnicianWork(caseId, actor);
    expect(savCaseStore.getCases()[0].status).toBe('repair');

    // Audit logs checked
    const logsAfterStart = savCaseStore.getLogs();
    expect(logsAfterStart.some(l => l.action === 'technician_start_work')).toBe(true);
    const transitionLog = logsAfterStart.find(l => l.action === 'STATUS_TRANSITION');
    expect(transitionLog).toBeDefined();
    expect(transitionLog?.fromStatus).toBe('diagnosis');
    expect(transitionLog?.toStatus).toBe('repair');

    // Test case starting at waiting_parts
    savCaseStore.clearAll();
    const partsCase = { ...diagCase, status: 'waiting_parts' as const };
    savCaseStore.addCase(partsCase);

    savCaseStore.startTechnicianWork(caseId, actor);
    expect(savCaseStore.getCases()[0].status).toBe('repair');

    // Test "already repair" logic
    savCaseStore.startTechnicianWork(caseId, actor); // Should handle cleanly (not transition again)
    expect(savCaseStore.getCases()[0].status).toBe('repair');

    // Unauthorized transitions for technician
    const recCase = { ...diagCase, status: 'received' as const };
    savCaseStore.addCase(recCase);
    expect(() => savCaseStore.startTechnicianWork(caseId, actor)).toThrow(); // received -> diagnosis/repair not authorized for technician
  });

  // 5. Task status tracking & restrictions
  it('allows task updates (pending -> in_progress -> done) and prevents invalid transitions', () => {
    const actor = { id: 'TECH-DEMO-001', role: 'technicien' as const };
    const caseId = 'case-test';
    const initialCase: SavCase = {
      id: caseId,
      immatriculation: 'DEMO-001',
      vin: 'VIN-DEMO-001',
      clientName: 'Client A',
      telephone: '00000000',
      status: 'repair',
      assignedTechnicianId: 'TECH-DEMO-001',
      assignedTechnicianName: 'Technicien Démo A',
      workshopTasks: [
        { id: 'task-1', label: 'Vidange', status: 'pending', createdAt: new Date().toISOString() }
      ],
      receptionDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    savCaseStore.addCase(initialCase);

    // 1. pending -> in_progress
    savCaseStore.updateWorkshopTaskStatus(caseId, 'task-1', 'in_progress', actor);
    let updatedTask = savCaseStore.getCases()[0].workshopTasks?.[0];
    expect(updatedTask?.status).toBe('in_progress');

    // 2. in_progress -> done
    savCaseStore.updateWorkshopTaskStatus(caseId, 'task-1', 'done', actor);
    updatedTask = savCaseStore.getCases()[0].workshopTasks?.[0];
    expect(updatedTask?.status).toBe('done');

    // 3. invalid: done -> in_progress (throw)
    expect(() => savCaseStore.updateWorkshopTaskStatus(caseId, 'task-1', 'in_progress', actor)).toThrow();

    // 4. invalid: done -> pending (throw)
    expect(() => savCaseStore.updateWorkshopTaskStatus(caseId, 'task-1', 'pending', actor)).toThrow();

    // 5. invalid: pending -> done directly (reset case to test)
    const pendingCase = {
      ...initialCase,
      workshopTasks: [{ id: 'task-2', label: 'Filtre', status: 'pending' as const, createdAt: new Date().toISOString() }]
    };
    savCaseStore.addCase(pendingCase);
    expect(() => savCaseStore.updateWorkshopTaskStatus(caseId, 'task-2', 'done', actor)).toThrow();

    // Verify update audit log generated
    const logs = savCaseStore.getLogs();
    expect(logs.some(l => l.action === 'technician_update_task')).toBe(true);
  });

  // 6. Complete Work & Intervention Validation
  it('enforces complete work checks and status transition to work_completed', () => {
    const actor = { id: 'TECH-DEMO-001', role: 'technicien' as const };
    const caseId = 'case-test';
    const initialCase: SavCase = {
      id: caseId,
      immatriculation: 'DEMO-001',
      vin: 'VIN-DEMO-001',
      clientName: 'Client A',
      telephone: '00000000',
      status: 'repair',
      assignedTechnicianId: 'TECH-DEMO-001',
      assignedTechnicianName: 'Technicien Démo A',
      workshopTasks: [
        { id: 'task-1', label: 'Tâche 1', status: 'in_progress', createdAt: new Date().toISOString() },
        { id: 'task-2', label: 'Tâche 2', status: 'done', createdAt: new Date().toISOString() },
      ],
      receptionDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    savCaseStore.addCase(initialCase);

    // Cannot complete work if there is an in_progress task
    expect(() => savCaseStore.completeTechnicianWork(caseId, actor)).toThrow();

    // Complete task-1
    savCaseStore.updateWorkshopTaskStatus(caseId, 'task-1', 'done', actor);

    // Can now complete work
    savCaseStore.completeTechnicianWork(caseId, actor);
    expect(savCaseStore.getCases()[0].status).toBe('work_completed');

    // Audit log technician_complete_work and STATUS_TRANSITION checked
    const logs = savCaseStore.getLogs();
    expect(logs.some(l => l.action === 'technician_complete_work')).toBe(true);
    const trans = logs.find(l => l.action === 'STATUS_TRANSITION');
    expect(trans).toBeDefined();
    expect(trans?.fromStatus).toBe('repair');
    expect(trans?.toStatus).toBe('work_completed');
  });

  // 7. Protections and RBAC restrictions
  it('enforces detailed action constraints for technician role', () => {
    const actor = { id: 'TECH-DEMO-001', role: 'technicien' as const };
    const caseId = 'case-test';
    const initialCase: SavCase = {
      id: caseId,
      immatriculation: 'DEMO-001',
      vin: 'VIN-DEMO-001',
      clientName: 'Client A',
      telephone: '00000000',
      status: 'diagnosis',
      assignedTechnicianId: 'TECH-DEMO-001',
      assignedTechnicianName: 'Technicien Démo A',
      receptionDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    savCaseStore.addCase(initialCase);

    // 1. Prohibited permissions
    expect(hasPermission('technicien', 'assign_technician')).toBe(false);
    expect(hasPermission('technicien', 'change_workshop_status')).toBe(false);
    expect(hasPermission('technicien', 'schedule_case')).toBe(false);
    expect(hasPermission('technicien', 'validate_qc')).toBe(false);
    expect(hasPermission('technicien', 'reject_qc')).toBe(false);
    expect(hasPermission('technicien', 'deliver_case')).toBe(false);
    expect(hasPermission('technicien', 'close_case')).toBe(false);
    expect(hasPermission('technicien', 'admin_action')).toBe(false);
    expect(canViewDirectionNotes('technicien')).toBe(false);

    // 2. Cannot modify closed/cancelled dossiers
    savCaseStore.clearAll();
    const closedCase = { ...initialCase, status: 'closed' as const };
    savCaseStore.addCase(closedCase);
    expect(() => savCaseStore.startTechnicianWork(caseId, actor)).toThrow();

    // 3. Cannot modify non-assigned dossiers
    savCaseStore.clearAll();
    const otherCase = { ...initialCase, assignedTechnicianId: 'TECH-DEMO-002' };
    savCaseStore.addCase(otherCase);
    expect(() => savCaseStore.startTechnicianWork(caseId, actor)).toThrow();
  });

  // 8. Namespace and SW Invariants
  it('respects global namespace invariants', () => {
    savCaseStore.reset();
    const allStorageKeys = Object.keys(window.localStorage);
    for (const key of allStorageKeys) {
      expect(key.startsWith(LS_PREFIX)).toBe(true);
      for (const forbidden of FORBIDDEN_LS_PREFIXES) {
        if (key.startsWith(forbidden)) {
          expect(key).toContain('react-v24');
        }
      }
    }
  });

  it('ensures no service worker active in v24', () => {
    const htmlPath = resolve(__dirname, '../index.html');
    const content = readFileSync(htmlPath, 'utf-8');
    expect(content).not.toContain("serviceWorker.register");
  });

  it('ensures data/vehicles.json remains empty', () => {
    const vehiclesPath = resolve(__dirname, '../../../data/vehicles.json');
    if (existsSync(vehiclesPath)) {
      const content = readFileSync(vehiclesPath, 'utf-8').trim();
      expect(content).toBe('[]');
    }
  });
});
