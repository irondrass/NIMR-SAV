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

describe('SAV Chef Atelier Workflow Integration (v24.0.0-alpha.10)', () => {

  beforeEach(() => {
    window.localStorage.clear();
    savCaseStore.clearAll();
  });

  afterEach(() => {
    window.localStorage.clear();
    savCaseStore.clearAll();
  });

  // 1. Version Check
  it('has package.json and constants aligned to v24.0.0-alpha.10', () => {
    expect(APP_VERSION).toBe('v24.0.0-alpha.10');

    const pkgPath = resolve(__dirname, '../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.version).toBe('24.0.0-alpha.10');
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

  // 3. Technician Assignment
  it('allows Chef Atelier to assign technician, recording both ID and Name, with audit log', () => {
    const actor = { id: 'chef-1', role: 'chef-atelier' as const };
    const caseId = 'case-test-999';
    const initialCase: SavCase = {
      id: caseId,
      immatriculation: 'DEMO-999',
      vin: 'VIN-DEMO-999',
      clientName: 'Client Démo X',
      telephone: '00000000',
      status: 'received',
      receptionDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    savCaseStore.addCase(initialCase);

    // Perform Assignment
    savCaseStore.assignTechnician(caseId, 'TECH-DEMO-002', actor);

    const updated = savCaseStore.getCases()[0];
    expect(updated.assignedTechnicianId).toBe('TECH-DEMO-002');
    expect(updated.assignedTechnicianName).toBe('Technicien Démo B');

    // Verify Audit Log
    const logs = savCaseStore.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('assign_technician');
    expect(logs[0].userRole).toBe('chef-atelier');
    expect(logs[0].caseId).toBe(caseId);
    expect(logs[0].details).toContain('Technicien Technicien Démo B');
  });

  // 4. Set Workshop Priority
  it('allows Chef Atelier to define priority with audit log', () => {
    const actor = { id: 'chef-1', role: 'chef-atelier' as const };
    const caseId = 'case-test-999';
    const initialCase: SavCase = {
      id: caseId,
      immatriculation: 'DEMO-999',
      vin: 'VIN-DEMO-999',
      clientName: 'Client Démo X',
      telephone: '00000000',
      status: 'received',
      receptionDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    savCaseStore.addCase(initialCase);

    savCaseStore.setWorkshopPriority(caseId, 'haute', actor);

    const updated = savCaseStore.getCases()[0];
    expect(updated.workshopPriority).toBe('haute');

    const logs = savCaseStore.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('set_workshop_priority');
  });

  // 5. Plan Workshop Task
  it('allows Chef Atelier to plan tasks with audit log', () => {
    const actor = { id: 'chef-1', role: 'chef-atelier' as const };
    const caseId = 'case-test-999';
    const initialCase: SavCase = {
      id: caseId,
      immatriculation: 'DEMO-999',
      vin: 'VIN-DEMO-999',
      clientName: 'Client Démo X',
      telephone: '00000000',
      status: 'received',
      receptionDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    savCaseStore.addCase(initialCase);

    const payload = {
      bay: 'Baie C',
      duration: 120,
      tasks: [
        { id: 't-1', label: 'Remplacement Suspension', status: 'pending' as const, createdAt: new Date().toISOString() }
      ],
      startAt: new Date().toISOString(),
      endAt: new Date().toISOString()
    };

    savCaseStore.planWorkshopTask(caseId, payload, actor);

    const updated = savCaseStore.getCases()[0];
    expect(updated.workshopBay).toBe('Baie C');
    expect(updated.estimatedDurationMinutes).toBe(120);
    expect(updated.workshopTasks).toHaveLength(1);
    expect(updated.workshopTasks![0].label).toBe('Remplacement Suspension');

    const logs = savCaseStore.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('plan_workshop_task');
  });

  // 6. Workflow Transitions
  it('allows Chef Atelier authorized workshop status transitions with mandatory audit logging', () => {
    const actor = { id: 'chef-1', role: 'chef-atelier' as const };
    const caseId = 'case-test-999';
    const testCase: SavCase = {
      id: caseId,
      immatriculation: 'DEMO-999',
      vin: 'VIN-DEMO-999',
      clientName: 'Client Démo X',
      telephone: '00000000',
      status: 'received',
      receptionDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    savCaseStore.addCase(testCase);

    // 1. received -> diagnosis
    savCaseStore.transitionWorkshopCase(caseId, 'diagnosis', actor);
    expect(savCaseStore.getCases()[0].status).toBe('diagnosis');

    // 2. diagnosis -> waiting_parts
    savCaseStore.transitionWorkshopCase(caseId, 'waiting_parts', actor);
    expect(savCaseStore.getCases()[0].status).toBe('waiting_parts');

    // 3. waiting_parts -> repair
    savCaseStore.transitionWorkshopCase(caseId, 'repair', actor);
    expect(savCaseStore.getCases()[0].status).toBe('repair');

    // 4. repair -> work_completed
    savCaseStore.transitionWorkshopCase(caseId, 'work_completed', actor);
    expect(savCaseStore.getCases()[0].status).toBe('work_completed');

    // Verify all transition logs recorded
    const logs = savCaseStore.getLogs();
    expect(logs).toHaveLength(4);
    for (const l of logs) {
      expect(l.action).toBe('STATUS_TRANSITION');
      expect(l.userRole).toBe('chef-atelier');
    }
  });

  it('allows Chef Atelier transition: quality_rejected -> quality_rework', () => {
    const actor = { id: 'chef-1', role: 'chef-atelier' as const };
    const caseId = 'case-test-999';
    const testCase: SavCase = {
      id: caseId,
      immatriculation: 'DEMO-999',
      vin: 'VIN-DEMO-999',
      clientName: 'Client Démo X',
      telephone: '00000000',
      status: 'quality_rejected',
      receptionDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    savCaseStore.addCase(testCase);

    savCaseStore.transitionWorkshopCase(caseId, 'quality_rework', actor);
    expect(savCaseStore.getCases()[0].status).toBe('quality_rework');
  });

  // 7. Prohibitions & Protections
  it('enforces Chef Atelier RBAC boundaries and status protection policies', () => {
    const actor = { id: 'chef-1', role: 'chef-atelier' as const };
    const caseId = 'case-test-999';
    const testCase: SavCase = {
      id: caseId,
      immatriculation: 'DEMO-999',
      vin: 'VIN-DEMO-999',
      clientName: 'Client Démo X',
      telephone: '00000000',
      status: 'repair',
      receptionDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    savCaseStore.addCase(testCase);

    // Prohibit validation QC
    expect(hasPermission('chef-atelier', 'validate_qc')).toBe(false);
    expect(() => savCaseStore.transitionWorkshopCase(caseId, 'quality_approved', actor)).toThrow();

    // Prohibit delivery
    expect(hasPermission('chef-atelier', 'deliver_case')).toBe(false);
    const readyCase = { ...testCase, status: 'ready_delivery' as const };
    savCaseStore.addCase(readyCase);
    expect(() => savCaseStore.transitionWorkshopCase(caseId, 'delivered', actor)).toThrow();

    // Prohibit close
    expect(hasPermission('chef-atelier', 'close_case')).toBe(false); // Forbids closed administrativement
    expect(() => savCaseStore.transitionWorkshopCase(caseId, 'closed', actor)).toThrow();

    // Notes Direction invisible
    expect(canViewDirectionNotes('chef-atelier')).toBe(false);

    // closed/cancelled protection
    const closedCase = { ...testCase, status: 'closed' as const };
    savCaseStore.addCase(closedCase);
    expect(() => savCaseStore.assignTechnician(caseId, 'TECH-DEMO-001', actor)).toThrow();
    expect(() => savCaseStore.transitionWorkshopCase(caseId, 'repair', actor)).toThrow();
  });

  // 8. Core Invariants
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
