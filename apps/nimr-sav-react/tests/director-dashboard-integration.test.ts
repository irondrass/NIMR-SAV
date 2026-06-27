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
import { SavCase } from '../src/domain/sav-case';
import { calculateDirectorDashboard, calculateBlockingAlerts } from '../src/domain/director-kpis';

describe('SAV Director Dashboard Integration (v24.0.0-alpha.20)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    savCaseStore.clearAll();
  });

  afterEach(() => {
    window.localStorage.clear();
    savCaseStore.clearAll();
  });

  // 1. Version checks
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

  // 2. Pure KPI Calculations
  describe('Pure KPI Calculations', () => {
    const now = new Date('2026-06-25T12:00:00.000Z');

    const testCases: SavCase[] = [
      {
        id: 'case-1',
        immatriculation: 'IM-111-AA',
        vin: 'VIN11111111111111',
        clientName: 'Client A',
        telephone: '0600000001',
        status: 'waiting_parts',
        receptionDate: new Date(now.getTime() - 80 * 60 * 60 * 1000).toISOString(), // 80h ago (> 72h -> critical alert)
        createdAt: new Date(now.getTime() - 80 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(now.getTime() - 80 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: 'case-2',
        immatriculation: 'IM-222-BB',
        vin: 'VIN22222222222222',
        clientName: 'Client B',
        telephone: '0600000002',
        status: 'quality_rejected',
        qcRejectionReason: 'Peinture imparfaite',
        receptionDate: new Date(now.getTime() - 10 * 60 * 60 * 1000).toISOString(), // 10h ago (quality_rejected -> critical alert)
        createdAt: new Date(now.getTime() - 10 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(now.getTime() - 10 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: 'case-3',
        immatriculation: 'IM-333-CC',
        vin: 'VIN33333333333333',
        clientName: 'Client C',
        telephone: '0600000003',
        status: 'delivered',
        receptionDate: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: 'case-4',
        immatriculation: 'IM-444-DD',
        vin: 'VIN44444444444444',
        clientName: 'Client D',
        telephone: '0600000004',
        status: 'quality_approved',
        receptionDate: new Date(now.getTime() - 30 * 60 * 60 * 1000).toISOString(), // 30h ago (quality_approved > 24h -> retard delivery)
        createdAt: new Date(now.getTime() - 30 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(now.getTime() - 30 * 60 * 60 * 1000).toISOString(),
      },
    ];

    it('calculates total, open, closed, cancelled, delivered case counts correctly', () => {
      const dashboard = calculateDirectorDashboard(testCases, [], now);
      expect(dashboard.totalDossiers).toBe(4);
      expect(dashboard.dossiersOuverts).toBe(3); // case-1, case-2, case-4 (not delivered)
      expect(dashboard.livres).toBe(1); // case-3
      expect(dashboard.dossiersClotures).toBe(0);
      expect(dashboard.dossiersAnnules).toBe(0);
    });

    it('calculates status counts correctly', () => {
      const dashboard = calculateDirectorDashboard(testCases, [], now);
      expect(dashboard.attentePieces).toBe(1); // case-1
      expect(dashboard.qcRejetes).toBe(1); // case-2
      expect(dashboard.livres).toBe(1); // case-3
      expect(dashboard.pretsLivraison).toBe(0);
    });

    it('calculates rates with division-by-zero protection', () => {
      // With cases
      const dashboard = calculateDirectorDashboard(testCases, [], now);
      // passed QC = quality_rejected (case-2), quality_approved (case-4), delivered (case-3) -> 3 cases
      // rejected = case-2 -> 1 case. Rate = 1/3 * 100 = 33.33%
      expect(dashboard.tauxQCRejet).toBeCloseTo(33.33, 1);

      // eligible delivery = delivered (case-3), quality_approved (case-4) -> 2 cases
      // delivered = case-3 -> 1 case. Rate = 1/2 * 100 = 50%
      expect(dashboard.tauxLivraison).toBe(50);

      // Protect division by zero (empty case list)
      const emptyDashboard = calculateDirectorDashboard([], [], now);
      expect(emptyDashboard.tauxQCRejet).toBe(0);
      expect(emptyDashboard.tauxLivraison).toBe(0);
    });

    it('calculates critical blocking alerts and aging correctly', () => {
      const dashboard = calculateDirectorDashboard(testCases, [], now);
      // case-1 (waiting_parts > 72h), case-2 (quality_rejected), case-1 (open_old > 72h)
      // wait, alerts list:
      // case-1 matches waiting_parts_old. case-2 matches quality_rejected.
      // So alerts should find case-1 and case-2
      const alerts = calculateBlockingAlerts(testCases, now);
      expect(alerts).toHaveLength(2);
      expect(alerts.map((a) => a.caseId)).toContain('case-1');
      expect(alerts.map((a) => a.caseId)).toContain('case-2');

      // Aging breakdown
      // case-1: 80h (> 72h)
      // case-2: 10h (<= 24h)
      // case-3: delivered (ignored in aging)
      // case-4: 30h (24h - 48h)
      expect(dashboard.aging.lessThan24h).toBe(1); // case-2
      expect(dashboard.aging.between24hAnd48h).toBe(1); // case-4
      expect(dashboard.aging.moreThan72h).toBe(1); // case-1
    });

    it('calculates technician load', () => {
      const casesWithTech: SavCase[] = [
        {
          ...testCases[0],
          assignedTechnicianId: 'TECH-DEMO-001',
          assignedTechnicianName: 'Technicien Démo 1',
        },
        {
          ...testCases[1],
          assignedTechnicianId: 'TECH-DEMO-001',
          assignedTechnicianName: 'Technicien Démo 1',
        },
      ];
      const dashboard = calculateDirectorDashboard(casesWithTech, [], now);
      const tech1 = dashboard.chargeTechniciens.find((t) => t.technicianId === 'TECH-DEMO-001');
      expect(tech1).toBeDefined();
      expect(tech1?.activeCasesCount).toBe(2);
    });
  });

  // 3. Permissions Check
  describe('Permissions Check', () => {
    it('allows directeur-sav and admin to view dashboard and KPIs', () => {
      expect(hasPermission('directeur-sav', 'view_director_dashboard')).toBe(true);
      expect(hasPermission('directeur-sav', 'view_all_cases')).toBe(true);
      expect(hasPermission('directeur-sav', 'view_operational_kpis')).toBe(true);
      expect(hasPermission('directeur-sav', 'view_blocking_alerts')).toBe(true);
      expect(hasPermission('directeur-sav', 'view_technician_load')).toBe(true);
      expect(hasPermission('directeur-sav', 'view_direction_notes')).toBe(true);

      expect(hasPermission('admin', 'view_director_dashboard')).toBe(true);
    });

    it('denies other roles from viewing director dashboard', () => {
      expect(hasPermission('technicien', 'view_director_dashboard')).toBe(false);
      expect(hasPermission('reception', 'view_director_dashboard')).toBe(false);
      expect(hasPermission('qualite', 'view_director_dashboard')).toBe(false);
      expect(hasPermission('livraison', 'view_director_dashboard')).toBe(false);
    });

    it('denies directeur-sav from executing workshop/QC/delivery actions in hasPermission terrain cases', () => {
      expect(hasPermission('directeur-sav', 'create_case')).toBe(false);
      expect(hasPermission('directeur-sav', 'assign_technician')).toBe(false);
      expect(hasPermission('directeur-sav', 'start_task')).toBe(false);
      expect(hasPermission('directeur-sav', 'complete_task')).toBe(false);
      expect(hasPermission('directeur-sav', 'update_task_status')).toBe(false);
      expect(hasPermission('directeur-sav', 'start_quality_check')).toBe(false);
      expect(hasPermission('directeur-sav', 'validate_qc')).toBe(false);
      expect(hasPermission('directeur-sav', 'reject_qc')).toBe(false);
      expect(hasPermission('directeur-sav', 'send_to_rework')).toBe(false);
      expect(hasPermission('directeur-sav', 'prepare_delivery')).toBe(false);
      expect(hasPermission('directeur-sav', 'deliver_case')).toBe(false);
      expect(hasPermission('directeur-sav', 'add_delivery_proof')).toBe(false);
    });
  });

  // 4. Store Read-Only Nature
  describe('Store read-only nature', () => {
    it('getDirectorDashboard does not modify state, write localStorage, or create audit logs', () => {
      const caseObj: SavCase = {
        id: 'c-test',
        immatriculation: 'IM-999-ZZ',
        vin: 'VIN99999999999999',
        clientName: 'Client Z',
        telephone: '0600000099',
        status: 'repair',
        receptionDate: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      savCaseStore.setCases([caseObj]);
      const initialCasesLength = savCaseStore.getCases().length;
      const initialLogsLength = savCaseStore.getLogs().length;

      const setItemSpy = vi.spyOn(window.localStorage, 'setItem');

      const dashboard = savCaseStore.getDirectorDashboard();
      expect(dashboard.totalDossiers).toBe(1);

      // Verify no state modification
      expect(savCaseStore.getCases().length).toBe(initialCasesLength);
      expect(savCaseStore.getLogs().length).toBe(initialLogsLength);
      expect(setItemSpy).not.toHaveBeenCalled();

      setItemSpy.mockRestore();
    });
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
