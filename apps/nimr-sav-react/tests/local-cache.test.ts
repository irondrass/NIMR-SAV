import { describe, it, expect } from 'vitest';
import {
  buildLocalSnapshot,
  validateLocalSnapshot,
  restoreLocalSnapshot
} from '../src/domain/local-cache';
import { SavCase } from '../src/domain/sav-case';
import { AuditLogEntry } from '../src/domain/audit-log';
import { OfflineAction } from '../src/domain/offline-queue';

describe('Local Cache Domain Snapshotting & Restore', () => {
  const mockCases: SavCase[] = [
    {
      id: 'case-test-1',
      immatriculation: 'AA-123-AA',
      vin: 'VIN12345678901234',
      clientName: 'Jean Dupont',
      telephone: '0612345678',
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  ];

  const mockLogs: AuditLogEntry[] = [
    {
      id: 'log-1',
      caseId: 'case-test-1',
      userId: 'user-admin',
      userRole: 'admin',
      action: 'create_case',
      timestamp: new Date().toISOString(),
      details: 'Dossier créé',
    }
  ];

  const mockPending: OfflineAction[] = [];

  it('builds a correct LocalSnapshot structure', () => {
    const appVersion = '24.0.0-alpha.18';
    const snap = buildLocalSnapshot(mockCases, mockLogs, mockPending, appVersion);

    expect(snap.appVersion).toBe(appVersion);
    expect(snap.schemaVersion).toBe(24);
    expect(snap.cases).toEqual(mockCases);
    expect(snap.logs).toEqual(mockLogs);
    expect(snap.pendingActions).toEqual(mockPending);
    expect(snap.warnings).toBeDefined();
  });

  it('validates a correct LocalSnapshot', () => {
    const appVersion = '24.0.0-alpha.18';
    const snap = buildLocalSnapshot(mockCases, mockLogs, mockPending, appVersion);
    const val = validateLocalSnapshot(snap, appVersion);

    expect(val.valid).toBe(true);
    expect(val.reason).toBeUndefined();
  });

  it('invalidates a snapshot with incompatible schema version', () => {
    const snap = {
      appVersion: '24.0.0-alpha.18',
      schemaVersion: 23,
      cases: mockCases,
      logs: mockLogs,
    };
    const val = validateLocalSnapshot(snap, '24.0.0-alpha.18');
    expect(val.valid).toBe(false);
    expect(val.reason).toContain('schéma');
  });

  it('invalidates a snapshot with different appVersion', () => {
    const snap = {
      appVersion: '24.0.0-alpha.18',
      schemaVersion: 24,
      cases: mockCases,
      logs: mockLogs,
    };
    const val = validateLocalSnapshot(snap, '24.0.0-alpha.18-different');
    expect(val.valid).toBe(false);
    expect(val.reason).toContain("Version d'application incompatible");
  });

  it('restores snapshot data correctly', () => {
    const appVersion = '24.0.0-alpha.18';
    const snap = buildLocalSnapshot(mockCases, mockLogs, mockPending, appVersion);
    const restored = restoreLocalSnapshot(snap);

    expect(restored.cases).toEqual(mockCases);
    expect(restored.logs).toEqual(mockLogs);
    expect(restored.pendingActions).toEqual(mockPending);
  });
});
