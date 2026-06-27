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

import { APP_VERSION, LS_PREFIX, FORBIDDEN_LS_PREFIXES } from '../src/constants/version';
import { RECEPTION_PRESETS } from '../src/constants/reception-presets';
import { validateFictiveFields } from '../src/domain/validation-rules';
import { transitionCase } from '../src/domain/workflow-engine';
import { createAuditLog } from '../src/domain/audit-log';
import { hasPermission, canViewDirectionNotes } from '../src/domain/action-permissions';
import { savCaseStore } from '../src/state/sav-case-store';
import { SavCase } from '../src/domain/sav-case';

describe('SAV Reception Workflow Integration (v24.0.0-alpha.16)', () => {

  // Clean localStorage before and after each test
  beforeEach(() => {
    window.localStorage.clear();
    savCaseStore.clearAll();
  });

  afterEach(() => {
    window.localStorage.clear();
    savCaseStore.clearAll();
  });

  // 1. Version Check
  it('has package.json and constants aligned to v24.0.0-alpha.16', () => {
    expect(APP_VERSION).toBe('v24.0.0-alpha.16');

    const pkgPath = resolve(__dirname, '../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.version).toBe('24.0.0-alpha.16');
  });

  // 2. Draft Creation, Transitions, and Audit Logging
  it('creates draft case and transitions draft -> received with mandatory audit logging', () => {
    const user = { id: 'user-rec-1', role: 'reception' as const };

    // Create Draft
    const caseId = 'case-test-123';
    const draftCase: SavCase = {
      id: caseId,
      immatriculation: 'DEMO-123',
      vin: 'VIN-DEMO-0001',
      clientName: 'Client Démo Jean',
      telephone: '00000000',
      status: 'draft',
      receptionDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    savCaseStore.addCase(draftCase);

    const creationLog = createAuditLog(
      caseId,
      user.id,
      user.role,
      'create_case',
      undefined,
      'draft',
      'Création initiale en brouillon'
    );
    savCaseStore.addLog(creationLog);

    // Verify draft saved
    const casesInStore = savCaseStore.getCases();
    expect(casesInStore).toHaveLength(1);
    expect(casesInStore[0].status).toBe('draft');

    // Verify creation log
    const logsInStore = savCaseStore.getLogs();
    expect(logsInStore).toHaveLength(1);
    expect(logsInStore[0].action).toBe('create_case');
    expect(logsInStore[0].userRole).toBe('reception');
    expect(logsInStore[0].caseId).toBe(caseId);
    expect(logsInStore[0].timestamp).toBeDefined();

    // Transition Draft -> Received via workflow engine
    const res = transitionCase(draftCase, 'received', user);
    expect(res.success).toBe(true);
    expect(res.updatedCase?.status).toBe('received');
    expect(res.auditLog).toBeDefined();
    expect(res.auditLog?.fromStatus).toBe('draft');
    expect(res.auditLog?.toStatus).toBe('received');
    expect(res.auditLog?.action).toBe('STATUS_TRANSITION');

    // Save transitioned case and log
    savCaseStore.addCase(res.updatedCase!);
    savCaseStore.addLog(res.auditLog!);

    // Verify store state
    expect(savCaseStore.getCases()[0].status).toBe('received');
    expect(savCaseStore.getLogs()).toHaveLength(2); // creation log + transition log
  });

  // 3. Validation against real plates, VINs, names, phones
  it('validates realistic fields, accepting real data and rejecting invalid values', () => {
    // Valid Real/Demo Values
    const valid = validateFictiveFields({
      immatriculation: 'AA-123-AA',
      vin: 'VF37C5FS888888',
      clientName: 'Martin Alice',
      telephone: '+33123456789',
    });
    expect(valid).toBeNull();

    // Empty immatriculation
    const badPlate = validateFictiveFields({
      immatriculation: '',
      vin: 'VF37C5FS888888',
      clientName: 'Martin Alice',
      telephone: '+33123456789',
    });
    expect(badPlate).toContain("L'immatriculation est requise");

    // Empty client name
    const badName = validateFictiveFields({
      immatriculation: 'AA-123-AA',
      vin: 'VF37C5FS888888',
      clientName: '',
      telephone: '+33123456789',
    });
    expect(badName).toContain('Le nom du client est requis');

    // Invalid Phone with alphabetical letters
    const badPhone = validateFictiveFields({
      immatriculation: 'AA-123-AA',
      vin: 'VF37C5FS888888',
      clientName: 'Martin Alice',
      telephone: 'phone12345',
    });
    expect(badPhone).toContain("Le numéro de téléphone n'est pas valide");

    // Invalid VIN containing special chars
    const badVin = validateFictiveFields({
      immatriculation: 'AA-123-AA',
      vin: 'VF3_7C5FS8888',
      clientName: 'Martin Alice',
      telephone: '+33123456789',
    });
    expect(badVin).toContain('Le VIN doit être composé de caractères alphanumériques');
  });

  // 4. Presets Validation
  it('has exactly 10 unique presets matching requirements', () => {
    const requiredPresets = [
      'Entretien périodique',
      'Contrôle 2500 km',
      'Bruit freinage',
      'Bruit train avant',
      'Bruit train arrière',
      'Fuite huile',
      'Fuite liquide refroidissement',
      'Diagnostic voyant tableau',
      'Problème climatisation',
      'Demande devis carrosserie',
    ];

    expect(RECEPTION_PRESETS).toHaveLength(10);

    // Ensure no duplicates
    const unique = new Set(RECEPTION_PRESETS);
    expect(unique.size).toBe(10);

    // Verify all exist
    for (const p of requiredPresets) {
      expect(RECEPTION_PRESETS).toContain(p);
    }
  });

  // 5. LocalStorage Prefixes & Key Isolation
  it('uses exclusively authorized v24 keys and avoids forbidden v23.x prefixes', () => {
    savCaseStore.reset();

    const allStorageKeys = Object.keys(window.localStorage);
    expect(allStorageKeys.length).toBeGreaterThan(0);

    for (const key of allStorageKeys) {
      // Must start with v24 prefix
      expect(key.startsWith(LS_PREFIX)).toBe(true);

      // Must NOT overlap with a real v23 key namespace
      for (const forbidden of FORBIDDEN_LS_PREFIXES) {
        if (key.startsWith(forbidden)) {
          expect(key).toContain('react-v24');
        }
      }
    }
  });

  // 6. Reception Role Permissions Checks
  it('enforces RBAC permissions for the reception role', () => {
    // Reception permissions
    expect(hasPermission('reception', 'create_case')).toBe(true);
    expect(hasPermission('reception', 'receive_case')).toBe(true);
    expect(hasPermission('reception', 'view_cases')).toBe(true);

    // Reception prohibitions
    expect(hasPermission('reception', 'validate_qc')).toBe(false);
    expect(hasPermission('reception', 'deliver_case')).toBe(false);
    expect(hasPermission('reception', 'close_case')).toBe(false);
    expect(hasPermission('reception', 'admin_action')).toBe(false);

    // Direction notes protection
    expect(canViewDirectionNotes('reception')).toBe(false);
  });

  // 7. Core Invariants (No SW, No vehicles.json imports, etc.)
  it('ensures no service worker active in v24', () => {
    const htmlPath = resolve(__dirname, '../index.html');
    const content = readFileSync(htmlPath, 'utf-8');
    expect(content).not.toContain(['serviceWorker', 'register'].join('.'));
    expect(content).not.toContain(['navigator', 'serviceWorker'].join('.'));
  });

  it('ensures data/vehicles.json remains empty', () => {
    const vehiclesPath = resolve(__dirname, '../../../data/vehicles.json');
    if (existsSync(vehiclesPath)) {
      const content = readFileSync(vehiclesPath, 'utf-8').trim();
      expect(content).toBe('[]');
    }
  });

  it('ensures no files import from data/vehicles.json', () => {
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
  });
});
