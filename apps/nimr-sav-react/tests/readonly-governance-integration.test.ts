import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
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

import { LS_PREFIX } from '../src/constants/version';
import { hasPermission, canViewDirectionNotes } from '../src/domain/action-permissions';
import { savCaseStore } from '../src/state/sav-case-store';

describe('SAV ReadOnly Governance Integration (v24.0.0-alpha.18)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    savCaseStore.clearAll();
  });

  afterEach(() => {
    window.localStorage.clear();
    savCaseStore.clearAll();
  });

  // 1. Consultation permissions
  it('allows lecture-seule to view cases, tasks, audit log summary, and readonly console', () => {
    expect(hasPermission('lecture-seule', 'view_cases')).toBe(true);
    expect(hasPermission('lecture-seule', 'view_tasks')).toBe(true);
    expect(hasPermission('lecture-seule', 'view_readonly_console')).toBe(true);
    expect(hasPermission('lecture-seule', 'view_audit_summary')).toBe(true);
  });

  // 2. Denied write permissions
  it('denies lecture-seule from executing any workflow write action', () => {
    const writeActions = [
      'create_case',
      'assign_technician',
      'plan_workshop_task',
      'start_task',
      'complete_task',
      'validate_qc',
      'reject_qc',
      'prepare_delivery',
      'deliver_case',
      'close_case',
      'admin_action',
    ] as const;

    for (const action of writeActions) {
      expect(hasPermission('lecture-seule', action)).toBe(false);
    }
  });

  // 3. Direction notes protection
  it('denies lecture-seule from viewing direction notes', () => {
    expect(canViewDirectionNotes('lecture-seule')).toBe(false);
    expect(hasPermission('lecture-seule', 'view_direction_notes')).toBe(false);
  });

  // 4. Store read-only helper functions
  it('getReadOnlyCases does not modify cases list', () => {
    const initialCasesLength = savCaseStore.getCases().length;
    const cases = savCaseStore.getReadOnlyCases();
    expect(cases).toHaveLength(initialCasesLength);
  });

  it('getReadOnlyLogs does not modify audit logs list', () => {
    const initialLogsLength = savCaseStore.getLogs().length;
    const logs = savCaseStore.getReadOnlyLogs();
    expect(logs).toHaveLength(initialLogsLength);
  });

  // 5. Isolation Checks
  describe('Isolation and Security constraints', () => {
    it('uses correct localStorage prefix nimr-sav-react-v24-', () => {
      expect(LS_PREFIX).toBe('nimr-sav-react-v24-');
    });

    it('does not import data/vehicles.json', () => {
      const searchPath = resolve(__dirname, '../src');
      const hasVehiclesImport = (dir: string): boolean => {
        const files = readdirSync(dir);
        for (const file of files) {
          const fullPath = resolve(dir, file);
          if (statSync(fullPath).isDirectory()) {
            if (hasVehiclesImport(fullPath)) return true;
          } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
            const content = readFileSync(fullPath, 'utf8');
            const hasImport =
              /import[^'"]+['"].*vehicles\.json['"]/m.test(content) ||
              /require\(['"].*vehicles\.json['"]\)/m.test(content) ||
              /from ['"].*data\/vehicles/m.test(content);
            if (hasImport) return true;
          }
        }
        return false;
      };
      expect(hasVehiclesImport(searchPath)).toBe(false);
    });
  });
});
