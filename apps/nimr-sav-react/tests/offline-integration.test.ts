import { describe, it, expect, beforeEach } from 'vitest';
import { savCaseStore } from '../src/state/sav-case-store';
import { createOfflineAction } from '../src/domain/offline-queue';
import { SavCase } from '../src/domain/sav-case';
import { getLocalCacheKey } from '../src/domain/local-cache';

describe('Offline Store Integration & Simulation Replays', () => {
  const caseId = 'case-offline-integration';
  const baseCase: SavCase = {
    id: caseId,
    immatriculation: 'CC-777-CC',
    vin: 'VIN77777777777777',
    clientName: 'Charlie Brown',
    telephone: '0677777777',
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    // Stub global localStorage for Node testing environment
    const storageStore: Record<string, string> = {};
    const mockLocalStorage: Storage = {
      getItem: (key: string): string | null => storageStore[key] || null,
      setItem: (key: string, val: string): void => { storageStore[key] = String(val); },
      removeItem: (key: string): void => { delete storageStore[key]; },
      clear: (): void => { for (const k in storageStore) { delete storageStore[k]; } },
      get length(): number {
        return Object.keys(storageStore).length;
      },
      key: (index: number): string | null => Object.keys(storageStore)[index] || null,
    };

    // Stub global and window localStorage for Node/Browser environments consistently
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockLocalStorage,
      configurable: true,
      writable: true,
    });
    if (typeof window === 'undefined') {
      Object.defineProperty(globalThis, 'window', {
        value: { localStorage: mockLocalStorage },
        configurable: true,
      });
    } else {
      Object.defineProperty(window, 'localStorage', {
        value: mockLocalStorage,
        configurable: true,
      });
    }

    savCaseStore.clearAll();
    savCaseStore.clearLocalCache();
    // Start fresh
    savCaseStore.addCase({ ...baseCase });
  });

  it('queues and replays a receive_case offline action successfully', () => {
    const actor = { id: 'rep-123', role: 'reception' as const };

    // Create offline action for receiving the case
    const action = createOfflineAction(
      'receive_case',
      { caseId },
      actor
    );

    // Queue action
    savCaseStore.enqueueOfflineAction(action);
    expect(savCaseStore.getPendingActions().length).toBe(1);
    expect(savCaseStore.getPendingActions()[0].status).toBe('queued');

    // Case should still be draft before replay
    let c = savCaseStore.getCases().find(x => x.id === caseId);
    expect(c?.status).toBe('draft');

    // Replay
    const replayResult = savCaseStore.replayPendingActions();
    expect(replayResult.succeeded.length).toBe(1);
    expect(replayResult.failed.length).toBe(0);

    // Action status should update to replayed
    expect(savCaseStore.getPendingActions()[0].status).toBe('replayed');

    // Case should now be received
    c = savCaseStore.getCases().find(x => x.id === caseId);
    expect(c?.status).toBe('received');
  });

  it('fails to replay actions that violate security or domain invariants', () => {
    const maliciousActor = { id: 'ro-123', role: 'lecture-seule' as const };

    // A lecture-seule actor cannot receive a case
    const action = createOfflineAction(
      'receive_case',
      { caseId },
      maliciousActor
    );

    savCaseStore.enqueueOfflineAction(action);

    // Replay
    const replayResult = savCaseStore.replayPendingActions();
    expect(replayResult.failed.length).toBe(1);
    expect(replayResult.succeeded.length).toBe(0);

    // Action status should be failed
    const pending = savCaseStore.getPendingActions()[0];
    expect(pending.status).toBe('failed');
    expect(pending.error).toContain('autorisé');

    // Case should remain draft
    const c = savCaseStore.getCases().find(x => x.id === caseId);
    expect(c?.status).toBe('draft');
  });

  it('saves and restores store state from local storage snapshots', () => {
    const actor = { id: 'chef-123', role: 'chef-atelier' as const };

    // Simulate updating workshop priority offline
    savCaseStore.setWorkshopPriority(caseId, 'haute', actor);

    // Create and save snapshot
    const saveRes = savCaseStore.saveLocalSnapshot();
    expect(saveRes.success).toBe(true);

    // Clear memory cases
    savCaseStore.clearAll();
    expect(savCaseStore.getCases().length).toBe(0);

    // Retrieve saved snapshot from localStorage mock and restore
    const key = getLocalCacheKey();
    const savedSnapshotStr = window.localStorage.getItem(key);
    expect(savedSnapshotStr).toBeDefined();

    const snapshotObj = JSON.parse(savedSnapshotStr!);
    const restoreRes = savCaseStore.restoreLocalSnapshot(snapshotObj);
    expect(restoreRes.success, restoreRes.error).toBe(true);

    // State should be restored
    const restoredCases = savCaseStore.getCases();
    expect(restoredCases.length).toBe(1);
    expect(restoredCases[0].id).toBe(caseId);
    expect(restoredCases[0].workshopPriority).toBe('haute');
  });
});
