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

describe('SAV Delivery Integration (v24.0.0-alpha.19)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    savCaseStore.clearAll();
  });

  afterEach(() => {
    window.localStorage.clear();
    savCaseStore.clearAll();
  });

  // 1. Version Check
  it('has package.json and constants aligned to v24.0.0-alpha.19', () => {
    expect(APP_VERSION).toBe('v24.0.0-alpha.19');

    const pkgPath = resolve(__dirname, '../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.version).toBe('24.0.0-alpha.19');

    const lockPath = resolve(__dirname, '../package-lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
    expect(lock.version).toBe('24.0.0-alpha.19');
  });

  // 2. Case Filtering
  it('filters cases: Livraison only sees quality_approved, ready_delivery, delivered', () => {
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

    savCaseStore.addCase({ ...baseCase, id: 'c1', status: 'received' });
    savCaseStore.addCase({ ...baseCase, id: 'c2', status: 'diagnosis' });
    savCaseStore.addCase({ ...baseCase, id: 'c3', status: 'repair' });
    savCaseStore.addCase({ ...baseCase, id: 'c4', status: 'work_completed' });
    savCaseStore.addCase({ ...baseCase, id: 'c5', status: 'quality_pending' });
    savCaseStore.addCase({ ...baseCase, id: 'c6', status: 'quality_rejected' });
    savCaseStore.addCase({ ...baseCase, id: 'c7', status: 'quality_rework' });
    savCaseStore.addCase({ ...baseCase, id: 'c8', status: 'quality_approved' });
    savCaseStore.addCase({ ...baseCase, id: 'c9', status: 'ready_delivery' });
    savCaseStore.addCase({ ...baseCase, id: 'c10', status: 'delivered' });
    savCaseStore.addCase({ ...baseCase, id: 'c11', status: 'closed' });
    savCaseStore.addCase({ ...baseCase, id: 'c12', status: 'cancelled' });

    const visibleCases = savCaseStore.getDeliveryCases();
    expect(visibleCases).toHaveLength(3);
    const visibleIds = visibleCases.map(c => c.id);
    expect(visibleIds).toContain('c8');
    expect(visibleIds).toContain('c9');
    expect(visibleIds).toContain('c10');

    expect(visibleIds).not.toContain('c1');
    expect(visibleIds).not.toContain('c4');
    expect(visibleIds).not.toContain('c5');
    expect(visibleIds).not.toContain('c11');
    expect(visibleIds).not.toContain('c12');
  });

  // 3. Authorized Permissions for Livraison role
  it('allows actions for Livraison role', () => {
    const role = 'livraison' as const;
    expect(hasPermission(role, 'view_delivery_cases')).toBe(true);
    expect(hasPermission(role, 'prepare_delivery')).toBe(true);
    expect(hasPermission(role, 'deliver_case')).toBe(true);
    expect(hasPermission(role, 'add_delivery_proof')).toBe(true);
    expect(hasPermission(role, 'view_delivery_history')).toBe(true);
  });

  // 4. Forbidden Permissions for Livraison role
  it('blocks forbidden actions for Livraison role', () => {
    const role = 'livraison' as const;
    expect(hasPermission(role, 'create_case')).toBe(false);
    expect(hasPermission(role, 'assign_technician')).toBe(false);
    expect(hasPermission(role, 'schedule_case')).toBe(false);
    expect(hasPermission(role, 'change_workshop_status')).toBe(false);
    expect(hasPermission(role, 'start_repair')).toBe(false);
    expect(hasPermission(role, 'complete_repair')).toBe(false);
    expect(hasPermission(role, 'complete_work')).toBe(false);
    expect(hasPermission(role, 'start_quality_check')).toBe(false);
    expect(hasPermission(role, 'validate_qc')).toBe(false);
    expect(hasPermission(role, 'reject_qc')).toBe(false);
    expect(hasPermission(role, 'send_to_rework')).toBe(false);
    expect(hasPermission(role, 'close_case')).toBe(false);
    expect(hasPermission(role, 'admin_action')).toBe(false);
    expect(canViewDirectionNotes(role)).toBe(false);
  });

  // 5. Workflow Transitions and Rules
  it('enforces Livraison status transitions and validation rules', () => {
    const actor = { id: 'liv-user', role: 'livraison' as const };
    const caseId = 'case-liv-test';
    const baseCase: SavCase = {
      id: caseId,
      immatriculation: 'DEMO-001',
      vin: 'VIN-DEMO-0001',
      clientName: 'Client A',
      telephone: '00000000',
      status: 'quality_approved',
      receptionDate: new Date().toISOString(),
      qcChecklist: {
        items: [{ id: 'qc-1', label: 'Item 1', checked: true, required: true }],
        validatedBy: 'qc-inspector',
        validatedAt: new Date().toISOString(),
      },
      qcStatus: 'approved',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    savCaseStore.addCase(baseCase);

    // 5.1 quality_approved -> ready_delivery (authorized)
    savCaseStore.prepareDelivery(caseId, actor);
    let updatedCase = savCaseStore.getCases().find(c => c.id === caseId)!;
    expect(updatedCase.status).toBe('ready_delivery');
    expect(updatedCase.deliveryPreparedBy).toBe(actor.id);
    expect(updatedCase.deliveryPreparedAt).toBeDefined();

    // 5.2 ready_delivery -> delivered (refused without proof payload)
    expect(() => savCaseStore.deliverCase(caseId, { recipientName: '', proofReference: '' }, actor)).toThrow('Recipient name is required');
    expect(() => savCaseStore.deliverCase(caseId, { recipientName: '  ', proofReference: 'OR-001' }, actor)).toThrow('Recipient name is required');
    expect(() => savCaseStore.deliverCase(caseId, { recipientName: 'Dupont', proofReference: '   ' }, actor)).toThrow('Proof reference is required');

    // 5.3 ready_delivery -> delivered (authorized with complete payload)
    const payload = { recipientName: 'M. Dupont', proofReference: 'OR-PROOF-999', notes: 'Client très satisfait' };
    savCaseStore.deliverCase(caseId, payload, actor);
    updatedCase = savCaseStore.getCases().find(c => c.id === caseId)!;
    expect(updatedCase.status).toBe('delivered');
    expect(updatedCase.deliveryRecipientName).toBe(payload.recipientName);
    expect(updatedCase.deliveryProofReference).toBe(payload.proofReference);
    expect(updatedCase.deliveryNotes).toBe(payload.notes);
    expect(updatedCase.deliveredBy).toBe(actor.id);
    expect(updatedCase.deliveredAt).toBeDefined();
    expect(updatedCase.deliveryDate).toBeDefined();

    // 5.4 Blocked transitions for Livraison role
    const deliveredCase = { ...baseCase, status: 'delivered' as const };
    const resClose = transitionCase(deliveredCase, 'closed', actor);
    expect(resClose.success).toBe(false); // Livraison cannot close case
    expect(resClose.error).toContain('Livraison role cannot close cases');
  });

  // 6. Block delivery if QC is not approved
  it('blocks delivery transitions if QC is not approved/validated', () => {
    const actor = { id: 'liv-user', role: 'livraison' as const };
    const caseId = 'case-no-qc';
    const caseWithoutQC: SavCase = {
      id: caseId,
      immatriculation: 'DEMO-001',
      vin: 'VIN-DEMO-0001',
      clientName: 'Client',
      telephone: '00000000',
      status: 'quality_approved',
      receptionDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Case is in quality_approved status but lacks validation logs/validator in qcChecklist
    savCaseStore.addCase(caseWithoutQC);

    expect(() => savCaseStore.prepareDelivery(caseId, actor)).toThrow('Cannot prepare delivery: QC is not approved/validated');

    // Reset status to ready_delivery to check deliverCase blocking
    savCaseStore.addCase({ ...caseWithoutQC, status: 'ready_delivery' });
    expect(() =>
      savCaseStore.deliverCase(caseId, { recipientName: 'Test', proofReference: 'REF' }, actor)
    ).toThrow('Cannot deliver case: QC checklist must be validated and status must be ready_delivery');
  });

  // 7. Audit Logging
  it('generates correct audit logs for Livraison actions', () => {
    const actor = { id: 'liv-logger', role: 'livraison' as const };
    const caseId = 'case-logger-test';
    const testCase: SavCase = {
      id: caseId,
      immatriculation: 'DEMO-001',
      vin: 'VIN-DEMO-0001',
      clientName: 'Client',
      telephone: '00000000',
      status: 'quality_approved',
      receptionDate: new Date().toISOString(),
      qcChecklist: {
        items: [{ id: 'qc-1', label: 'Item 1', checked: true, required: true }],
        validatedBy: 'qc-inspector',
        validatedAt: new Date().toISOString(),
      },
      qcStatus: 'approved',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    savCaseStore.addCase(testCase);

    savCaseStore.prepareDelivery(caseId, actor);
    savCaseStore.deliverCase(caseId, { recipientName: 'Dupont', proofReference: 'OR-123' }, actor);

    // Verify logs
    const dbLogs = savCaseStore.getLogs();
    const prepareLog = dbLogs.find(l => l.action === 'delivery_prepare');
    const proofLog = dbLogs.find(l => l.action === 'delivery_proof_added');
    const completeLog = dbLogs.find(l => l.action === 'delivery_complete');
    const transitionLogs = dbLogs.filter(l => l.action === 'transition_status');

    expect(prepareLog).toBeDefined();
    expect(prepareLog?.caseId).toBe(caseId);
    expect(prepareLog?.userId).toBe(actor.id);
    expect(prepareLog?.userRole).toBe(actor.role);

    expect(proofLog).toBeDefined();
    expect(proofLog?.recipientName).toBe('Dupont');
    expect(proofLog?.proofReference).toBe('OR-123');

    expect(completeLog).toBeDefined();
    expect(completeLog?.recipientName).toBe('Dupont');
    expect(completeLog?.proofReference).toBe('OR-123');

    expect(transitionLogs).toHaveLength(2);
    const toReadyLog = transitionLogs.find(l => l.toStatus === 'ready_delivery');
    const toDeliveredLog = transitionLogs.find(l => l.toStatus === 'delivered');
    expect(toReadyLog).toBeDefined();
    expect(toReadyLog?.fromStatus).toBe('quality_approved');
    expect(toDeliveredLog).toBeDefined();
    expect(toDeliveredLog?.fromStatus).toBe('ready_delivery');
  });

  // 8. Strict write checking
  it('restricts prepareDelivery and deliverCase write methods strictly to role livraison', () => {
    const caseId = 'case-strict-test';
    const testCase: SavCase = {
      id: caseId,
      immatriculation: 'DEMO-001',
      vin: 'VIN-DEMO-0001',
      clientName: 'Client',
      telephone: '00000000',
      status: 'quality_approved',
      receptionDate: new Date().toISOString(),
      qcChecklist: {
        items: [{ id: 'qc-1', label: 'Item 1', checked: true, required: true }],
        validatedBy: 'qc-inspector',
        validatedAt: new Date().toISOString(),
      },
      qcStatus: 'approved',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    savCaseStore.addCase(testCase);

    const adminActor = { id: 'admin-id', role: 'admin' as const };
    const directorActor = { id: 'dir-id', role: 'directeur-sav' as const };

    // Should throw since roles are not 'livraison'
    expect(() => savCaseStore.prepareDelivery(caseId, adminActor)).toThrow('Only Livraison role can perform this action');
    expect(() => savCaseStore.prepareDelivery(caseId, directorActor)).toThrow('Only Livraison role can perform this action');

    // Set to ready_delivery manually via admin bypass/direct log to test deliverCase strict role checks
    savCaseStore.addCase({ ...testCase, status: 'ready_delivery' });
    expect(() =>
      savCaseStore.deliverCase(caseId, { recipientName: 'Dupont', proofReference: 'OR-123' }, adminActor)
    ).toThrow('Only Livraison role can perform this action');
    expect(() =>
      savCaseStore.deliverCase(caseId, { recipientName: 'Dupont', proofReference: 'OR-123' }, directorActor)
    ).toThrow('Only Livraison role can perform this action');
  });

  // 9. Isolation Rules
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
