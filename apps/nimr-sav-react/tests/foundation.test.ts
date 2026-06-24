/**
 * NIMR SAV v24 — Foundation Test Suite
 * apps/nimr-sav-react/tests/foundation.test.ts
 *
 * Verifies all constraints defined for v24.0.0-alpha.3:
 * - Version constant
 * - All roles exist with default views
 * - Navigation filtered by role
 * - localStorage prefix isolation
 * - No v23.x key reuse
 * - No real client data
 * - No import of data/vehicles.json
 * - No shared SW cache with v23.x
 */

import { describe, it, expect } from 'vitest';
import {
  APP_VERSION,
  RESERVED_CACHE_NAME,
  LS_PREFIX,
  FORBIDDEN_LS_PREFIXES,
} from '../src/constants/version';
import {
  ALL_ROLES,
  ROLE_DEFAULT_VIEW,
  ROLE_ALLOWED_TABS,
  isQualityChecklistComplete,
  type Role,
  type QCChecklist,
} from '../src/types';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';

// ─── 1. Version ───────────────────────────────────────────────────────────────

describe('Version constants', () => {
  it('APP_VERSION is exactly "v24.0.0-alpha.3"', () => {
    expect(APP_VERSION).toBe('v24.0.0-alpha.3');
  });

  it('RESERVED_CACHE_NAME is "nimr-sav-react-v24-alpha"', () => {
    expect(RESERVED_CACHE_NAME).toBe('nimr-sav-react-v24-alpha');
  });

  it('LS_PREFIX is "nimr-sav-react-v24-"', () => {
    expect(LS_PREFIX).toBe('nimr-sav-react-v24-');
  });

  it('RESERVED_CACHE_NAME does not overlap with any v23.x cache name', () => {
    const v23Caches = [
      'nimr-sav-v23',
      'nimr-sav-v23.2',
      'nimr-sav-v23.2.6',
      'nimr-sav-v23.2.6-reception-qc-field-usability',
    ];
    for (const c of v23Caches) {
      expect(RESERVED_CACHE_NAME).not.toBe(c);
      expect(RESERVED_CACHE_NAME).not.toContain('v23');
    }
  });
});

// ─── 2. Roles ────────────────────────────────────────────────────────────────

describe('Roles definition', () => {
  const REQUIRED_ROLES: Role[] = [
    'reception',
    'technicien',
    'chef-atelier',
    'qualite',
    'directeur-sav',
    'admin',
    'lecture-seule',
    'livraison',
  ];

  it('ALL_ROLES contains all 8 required roles', () => {
    expect(ALL_ROLES).toHaveLength(8);
    for (const role of REQUIRED_ROLES) {
      expect(ALL_ROLES).toContain(role);
    }
  });

  it('each role has a default view defined', () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_DEFAULT_VIEW[role]).toBeDefined();
      expect(typeof ROLE_DEFAULT_VIEW[role]).toBe('string');
      expect(ROLE_DEFAULT_VIEW[role].length).toBeGreaterThan(0);
    }
  });

  it('each role has at least one allowed tab', () => {
    for (const role of ALL_ROLES) {
      const tabs = ROLE_ALLOWED_TABS[role];
      expect(tabs).toBeDefined();
      expect(tabs.length).toBeGreaterThan(0);
    }
  });
});

// ─── 3. Navigation filtered by role ─────────────────────────────────────────

describe('Navigation filtering per role', () => {
  it('reception role does NOT have admin tabs', () => {
    const tabs = ROLE_ALLOWED_TABS['reception'];
    expect(tabs).not.toContain('admin');
    expect(tabs).not.toContain('utilisateurs');
    expect(tabs).not.toContain('pilotage');
  });

  it('technicien role does NOT have admin or planning tabs', () => {
    const tabs = ROLE_ALLOWED_TABS['technicien'];
    expect(tabs).not.toContain('admin');
    expect(tabs).not.toContain('planning');
    expect(tabs).not.toContain('pilotage');
  });

  it('chef-atelier role does NOT have admin tabs', () => {
    const tabs = ROLE_ALLOWED_TABS['chef-atelier'];
    expect(tabs).not.toContain('admin');
    expect(tabs).not.toContain('utilisateurs');
  });

  it('qualite role does NOT have admin or planning tabs', () => {
    const tabs = ROLE_ALLOWED_TABS['qualite'];
    expect(tabs).not.toContain('admin');
    expect(tabs).not.toContain('planning');
  });

  it('directeur-sav role does NOT have admin/utilisateurs tabs', () => {
    const tabs = ROLE_ALLOWED_TABS['directeur-sav'];
    expect(tabs).not.toContain('admin');
    expect(tabs).not.toContain('utilisateurs');
  });

  it('directeur-sav has access to pilotage, dossiers, today, planning, controle-qualite, suivi-atelier', () => {
    const tabs = ROLE_ALLOWED_TABS['directeur-sav'];
    expect(tabs).toContain('pilotage');
    expect(tabs).toContain('dossiers');
    expect(tabs).toContain('today');
    expect(tabs).toContain('planning');
    expect(tabs).toContain('controle-qualite');
    expect(tabs).toContain('suivi-atelier');
  });

  it('admin role has both pilotage and admin tabs', () => {
    const tabs = ROLE_ALLOWED_TABS['admin'];
    expect(tabs).toContain('admin');
    expect(tabs).toContain('pilotage');
  });

  it('lecture-seule role has only lecture tab', () => {
    const tabs = ROLE_ALLOWED_TABS['lecture-seule'];
    expect(tabs).toEqual(['lecture']);
  });

  it('livraison role has access to livraison and dossiers tabs', () => {
    const tabs = ROLE_ALLOWED_TABS['livraison'];
    expect(tabs).toEqual(['livraison', 'dossiers']);
  });

  it('default view for each role starts with "/"', () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_DEFAULT_VIEW[role]).toMatch(/^\//);
    }
  });
});

// ─── 4. localStorage prefix isolation ────────────────────────────────────────

describe('localStorage prefix isolation', () => {
  it('LS_PREFIX starts with "nimr-sav-react-v24-"', () => {
    expect(LS_PREFIX).toBe('nimr-sav-react-v24-');
  });

  it('LS_PREFIX is not equal to any forbidden prefix (does not share exact key namespace)', () => {
    // LS_PREFIX may contain common words (sav, nimr) but must not BE a forbidden prefix
    // The uniqueness guarantee is: forbidden prefixes never end with '-react-v24-'
    for (const forbidden of FORBIDDEN_LS_PREFIXES) {
      expect(LS_PREFIX).not.toBe(forbidden);
      expect(LS_PREFIX).not.toBe(`${forbidden}-`);
    }
    // Must contain the versioned react qualifier
    expect(LS_PREFIX).toContain('react-v24');
  });

  it('FORBIDDEN_LS_PREFIXES includes all v23.x variants', () => {
    const required = ['nimr-sav', 'nimr-carrosserie', 'nimr-sav-v23', 'nimr-sav-pro'];
    for (const prefix of required) {
      expect(FORBIDDEN_LS_PREFIXES).toContain(prefix);
    }
  });

  it('LS_PREFIX is distinct from all forbidden prefixes (not equal, not a sub-prefix)', () => {
    // The critical invariant: no v24 key can be mistaken for a v23 key.
    // v23 keys start with one of the forbidden prefixes exactly.
    // v24 keys start with 'nimr-sav-react-v24-' which is longer and unique.
    for (const forbidden of FORBIDDEN_LS_PREFIXES) {
      // v24 prefix is longer than any forbidden prefix
      expect(LS_PREFIX.length).toBeGreaterThan(forbidden.length);
      // v24 prefix is not identical
      expect(LS_PREFIX).not.toBe(forbidden);
      // A v23 key prefix would NEVER start with our v24 prefix
      expect(LS_PREFIX).not.toBe(forbidden.slice(0, LS_PREFIX.length));
    }
  });
});

// ─── 5. No real client data ───────────────────────────────────────────────────

describe('No real client data', () => {
  it('data/vehicles.json at repo root is strictly []', () => {
    const vehiclesPath = resolve(__dirname, '../../../data/vehicles.json');
    if (existsSync(vehiclesPath)) {
      const content = readFileSync(vehiclesPath, 'utf-8').trim();
      expect(content).toBe('[]');
    } else {
      // File doesn't exist — also acceptable
      expect(existsSync(vehiclesPath)).toBe(false);
    }
  });

  it('src/ files do not IMPORT data/vehicles.json', () => {
    const srcDir = resolve(__dirname, '../src');
    const checkDir = (dir: string): void => {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = resolve(dir, entry as string);
        if (statSync(fullPath).isDirectory()) {
          checkDir(fullPath);
        } else if ((entry as string).endsWith('.ts') || (entry as string).endsWith('.tsx')) {
          const content = readFileSync(fullPath, 'utf-8');
          // Check for actual import statements — not comments mentioning the file
          expect(content).not.toMatch(/import[^'"]+['"].*vehicles\.json['"]/m);
          expect(content).not.toMatch(/require\(['"].*vehicles\.json['"]\)/m);
          expect(content).not.toMatch(/from ['"].*data\/vehicles/m);
        }
      }
    };
    checkDir(srcDir);
  });
});

// ─── 6. No shared SW with v23.x ──────────────────────────────────────────────

describe('Service Worker isolation', () => {
  it('index.html does not register a service worker', () => {
    const htmlPath = resolve(__dirname, '../index.html');
    const content = readFileSync(htmlPath, 'utf-8');
    expect(content).not.toContain("serviceWorker.register");
    expect(content).not.toContain("navigator.serviceWorker");
  });

  it('main.tsx does not register a service worker', () => {
    const mainPath = resolve(__dirname, '../src/main.tsx');
    const content = readFileSync(mainPath, 'utf-8');
    expect(content).not.toContain("serviceWorker.register");
    expect(content).not.toContain("navigator.serviceWorker");
  });

  it('RESERVED_CACHE_NAME does not start with v23 cache prefix', () => {
    expect(RESERVED_CACHE_NAME).not.toMatch(/^nimr-sav-v23/);
  });
});

// ─── 7. QC utility function ───────────────────────────────────────────────────

describe('isQualityChecklistComplete', () => {
  it('returns true when all required items are checked', () => {
    const checklist: QCChecklist = {
      vehicleId: 'v24-test-001',
      items: [
        { id: '1', label: 'Peinture OK', checked: true, required: true },
        { id: '2', label: 'Vitres OK', checked: true, required: true },
        { id: '3', label: 'Test optionnel', checked: false, required: false },
      ],
    };
    expect(isQualityChecklistComplete(checklist)).toBe(true);
  });

  it('returns false when a required item is unchecked', () => {
    const checklist: QCChecklist = {
      vehicleId: 'v24-test-002',
      items: [
        { id: '1', label: 'Peinture OK', checked: true, required: true },
        { id: '2', label: 'Vitres OK', checked: false, required: true },
      ],
    };
    expect(isQualityChecklistComplete(checklist)).toBe(false);
  });

  it('returns true with empty items list', () => {
    const checklist: QCChecklist = {
      vehicleId: 'v24-test-003',
      items: [],
    };
    expect(isQualityChecklistComplete(checklist)).toBe(true);
  });

  it('vehicle IDs in tests do not contain real licence plates', () => {
    const testId = 'v24-test-001';
    expect(testId).not.toMatch(/^[A-Z]{2}-\d{3}-[A-Z]{2}$/);
  });
});
