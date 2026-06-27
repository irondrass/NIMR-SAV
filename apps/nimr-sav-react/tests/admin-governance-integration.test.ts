import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

import { APP_VERSION, LS_PREFIX } from '../src/constants/version';
import { hasPermission } from '../src/domain/action-permissions';
import { savCaseStore } from '../src/state/sav-case-store';
import { OFFICIAL_ROLES } from '../src/domain/role-governance';
import { ROLE_DEFAULT_VIEW, ROLE_ALLOWED_TABS } from '../src/types';

describe('SAV Admin Governance Integration (v24.0.0-alpha.20)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    savCaseStore.clearAll();
  });

  afterEach(() => {
    window.localStorage.clear();
    savCaseStore.clearAll();
  });

  // 1. Version Check
  it('APP_VERSION is exactly v24.0.0-alpha.20', () => {
    expect(APP_VERSION).toBe('v24.0.0-alpha.20');
  });

  it('package.json version matches 24.0.0-alpha.20', () => {
    const pkgPath = resolve(__dirname, '../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.version).toBe('24.0.0-alpha.20');
  });

  it('package-lock.json version matches 24.0.0-alpha.20', () => {
    const lockPath = resolve(__dirname, '../package-lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
    expect(lock.version).toBe('24.0.0-alpha.20');
  });

  // 2. Roles list
  it('OFFICIAL_ROLES contains exactly the 8 official roles', () => {
    const EXPECTED_ROLES = [
      'reception',
      'chef-atelier',
      'technicien',
      'qualite',
      'livraison',
      'directeur-sav',
      'admin',
      'lecture-seule',
    ];
    expect(OFFICIAL_ROLES).toHaveLength(8);
    for (const r of EXPECTED_ROLES) {
      expect(OFFICIAL_ROLES).toContain(r);
    }
  });

  it('no unofficial roles in config maps (ROLE_DEFAULT_VIEW, ROLE_ALLOWED_TABS)', () => {
    const defaultViewRoles = Object.keys(ROLE_DEFAULT_VIEW);
    expect(defaultViewRoles).toHaveLength(8);
    for (const r of defaultViewRoles) {
      expect(OFFICIAL_ROLES).toContain(r);
    }

    const allowedTabsRoles = Object.keys(ROLE_ALLOWED_TABS);
    expect(allowedTabsRoles).toHaveLength(8);
    for (const r of allowedTabsRoles) {
      expect(OFFICIAL_ROLES).toContain(r);
    }
  });

  // 3. Admin permissions
  it('allows admin to view console, role governance, permission matrix, system invariants', () => {
    expect(hasPermission('admin', 'view_admin_console')).toBe(true);
    expect(hasPermission('admin', 'view_role_governance')).toBe(true);
    expect(hasPermission('admin', 'view_permission_matrix')).toBe(true);
    expect(hasPermission('admin', 'view_system_invariants')).toBe(true);
  });

  it('does not expose destructive store writes on getAdminGovernanceSummary', () => {
    const initialCasesLength = savCaseStore.getCases().length;
    const initialLogsLength = savCaseStore.getLogs().length;

    const setItemSpy = vi.spyOn(window.localStorage, 'setItem');

    const summary = savCaseStore.getAdminGovernanceSummary();
    expect(summary.totalCases).toBe(initialCasesLength);
    expect(summary.totalLogs).toBe(initialLogsLength);
    expect(summary.matrix).toHaveLength(8);

    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  // 4. Invariants
  it('verifies getSystemInvariants fields and local prefix', () => {
    const invariants = savCaseStore.getSystemInvariants();
    expect(invariants.localStoragePrefix).toBe('nimr-sav-react-v24-');
    expect(invariants.appVersion).toBe('v24.0.0-alpha.20');
    expect(invariants.v23Status).toContain('v23.2.6');
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
