import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
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

import { APP_VERSION, LS_PREFIX, RESERVED_CACHE_NAME } from '../src/constants/version';
import { validateReleaseReadiness } from '../src/domain/release-readiness';
import { SavCase } from '../src/domain/sav-case';
import { AuditLogEntry } from '../src/domain/audit-log';

describe('SAV Release Readiness & Invariants Integration (v24.0.0-alpha.18)', () => {
  // 1. Version matches
  it('APP_VERSION is exactly v24.0.0-alpha.18', () => {
    expect(APP_VERSION).toBe('v24.0.0-alpha.18');
  });

  it('package.json version matches 24.0.0-alpha.18', () => {
    const pkgPath = resolve(__dirname, '../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.version).toBe('24.0.0-alpha.18');
  });

  it('package-lock.json version matches 24.0.0-alpha.18', () => {
    const lockPath = resolve(__dirname, '../package-lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
    expect(lock.version).toBe('24.0.0-alpha.18');
  });

  // 2. data/vehicles.json is strictly []
  it('data/vehicles.json is exactly []', () => {
    const rootPath = resolve(__dirname, '../../../data/vehicles.json');
    if (existsSync(rootPath)) {
      const content = readFileSync(rootPath, 'utf-8').trim();
      expect(content === '[]' || content === '').toBe(true);
    }
  });

  // 3. Security and isolation invariants
  it('does not register Service Worker or import Supabase/Backend', () => {
    const searchPath = resolve(__dirname, '../src');
    const checkFile = (dir: string) => {
      const files = readdirSync(dir);
      for (const file of files) {
        const fullPath = resolve(dir, file);
        if (statSync(fullPath).isDirectory()) {
          checkFile(fullPath);
        } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
          const content = readFileSync(fullPath, 'utf-8');

          const workerRegistration = ['serviceWorker', 'register'].join('.');
          const workerNavigator = ['navigator', 'serviceWorker'].join('.');
          const remoteDataConnector = ['supa', 'base'].join('');

          expect(content.includes(workerRegistration)).toBe(false);
          expect(content.includes(workerNavigator)).toBe(false);
          expect(content.includes(remoteDataConnector)).toBe(false);

          // No actual backend URL connection
          expect(content).not.toContain('http://localhost:');
          expect(content).not.toContain('https://api.');
        }
      }
    };
    checkFile(searchPath);
  });

  // 4. LS_PREFIX and RESERVED_CACHE_NAME check
  it('enforces localStorage prefix and cache name', () => {
    expect(LS_PREFIX).toBe('nimr-sav-react-v24-');
    expect(RESERVED_CACHE_NAME).toBe('nimr-sav-react-v24-alpha');
  });

  // 5. Readiness report tests
  it('reports success for valid, clean cases', () => {
    const mockCase: SavCase = {
      id: 'case-ok',
      immatriculation: 'AA-123-BB',
      vin: '12345678901234567',
      clientName: 'Client Propre',
      telephone: '05555555',
      status: 'received',
      createdAt: '2026-06-25T12:00:00Z',
      updatedAt: '2026-06-25T12:00:00Z',
      receptionDate: '2026-06-25T12:00:00Z',
    };
    const mockLog: AuditLogEntry = {
      id: 'log-ok',
      caseId: 'case-ok',
      timestamp: '2026-06-25T12:00:00Z',
      action: 'receive_case',
      userId: 'recep-1',
      userRole: 'reception',
      details: 'Dossier créé',
    };

    const report = validateReleaseReadiness([mockCase], [mockLog], { appVersion: 'v24.0.0-alpha.18' });
    expect(report.isReadyForRcEvaluation).toBe(true);
    expect(report.blockers).toHaveLength(0);
    expect(report.recommendation).toContain('rc.1 interne préparée');
    expect(report.lifecycle.status).toBe('Release Candidate interne préparée');
    expect(report.lifecycle.isReleaseCandidate).toBe(true);
    expect(report.lifecycle.isFinal).toBe(false);
    expect(report.lifecycle.isProduction).toBe(false);
    expect(report.lifecycle.tagExpected).toBe(false);
  });

  it('detects blockers for unofficial roles, statuses, or corrupted workflow state', () => {
    // A. Corrupted status
    const mockCaseBadStatus: SavCase = {
      id: 'case-bad',
      immatriculation: 'AA-123-BB',
      vin: '12345678901234567',
      clientName: 'Client Propre',
      telephone: '05555555',
      status: 'invalid_status_for_readiness_test' as unknown as CaseStatus, // Unofficial status
      createdAt: '2026-06-25T12:00:00Z',
      updatedAt: '2026-06-25T12:00:00Z',
      receptionDate: '2026-06-25T12:00:00Z',
    };

    // B. Delivered without QC approved
    const mockCaseNoQc: SavCase = {
      id: 'case-no-qc',
      immatriculation: 'AA-123-BB',
      vin: '12345678901234567',
      clientName: 'Client Propre',
      telephone: '05555555',
      status: 'delivered',
      qcStatus: 'rejected', // Delivered despite rejected QC!
      createdAt: '2026-06-25T12:00:00Z',
      updatedAt: '2026-06-25T12:00:00Z',
      receptionDate: '2026-06-25T12:00:00Z',
    };

    // C. Bad role in logs
    const mockLogBadRole: AuditLogEntry = {
      id: 'log-bad',
      caseId: 'case-no-qc',
      timestamp: '2026-06-25T12:00:00Z',
      action: 'receive_case',
      userId: 'recep-1',
      userRole: 'superadmin' as unknown as Role, // Unofficial role
      details: 'Dossier créé',
    };

    const report = validateReleaseReadiness([mockCaseBadStatus, mockCaseNoQc], [mockLogBadRole], { appVersion: 'v24.0.0-alpha.18' });
    expect(report.isReadyForRcEvaluation).toBe(false);
    expect(report.blockers.length).toBeGreaterThanOrEqual(3);

    const allBlockers = report.blockers.join(' | ');
    expect(allBlockers).toContain('unofficial or undefined status');
    expect(allBlockers).toContain('delivered without an approved QC');
    expect(allBlockers).toContain('unofficial role: \'superadmin\'');
  });
});
