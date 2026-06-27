import { describe, expect, it } from 'vitest';
import { buildLocalSnapshot, validateLocalSnapshot } from '../src/domain/local-cache';
import {
  createOfflineAction,
  enqueueOfflineAction,
  replayOfflineQueue,
  validateOfflineAction,
} from '../src/domain/offline-queue';
import { SavCase } from '../src/domain/sav-case';

const appVersion = 'v24.0.0-alpha.19';

const baseCase: SavCase = {
  id: 'offline-security-case',
  immatriculation: 'BB-456-BB',
  vin: 'VF1ABCDEF12345678',
  clientName: 'Client Offline',
  telephone: '+21622333444',
  status: 'draft',
  receptionDate: '2026-06-27T08:00:00.000Z',
  createdAt: '2026-06-27T08:00:00.000Z',
  updatedAt: '2026-06-27T08:00:00.000Z',
};

describe('Offline and local cache security hardening alpha.19', () => {
  it('refuses incompatible snapshots and unknown statuses', () => {
    const snapshot = buildLocalSnapshot([baseCase], [], [], appVersion);
    expect(validateLocalSnapshot(snapshot, appVersion).valid).toBe(true);
    expect(validateLocalSnapshot({ ...snapshot, appVersion: 'v24.0.0-alpha.17' }, appVersion).valid).toBe(false);
    expect(validateLocalSnapshot({ ...snapshot, cases: [{ ...baseCase, status: 'queued' }] }, appVersion).valid).toBe(false);
  });

  it('refuses snapshots containing unknown audit roles', () => {
    const snapshot = buildLocalSnapshot([baseCase], [
      {
        id: 'log-bad',
        caseId: baseCase.id,
        userId: 'user-bad',
        userRole: 'unknown',
        action: 'create_case',
        timestamp: '2026-06-27T08:00:00.000Z',
        details: 'bad',
      },
    ], [], appVersion);

    expect(validateLocalSnapshot(snapshot, appVersion).valid).toBe(false);
  });

  it('refuses offline actions with unknown roles and read-only mutations', () => {
    const unknownRole = createOfflineAction('receive_case', { caseId: baseCase.id }, { id: 'x', role: 'unknown' });
    const readOnly = createOfflineAction('receive_case', { caseId: baseCase.id }, { id: 'ro', role: 'lecture-seule' });

    expect(validateOfflineAction(unknownRole).valid).toBe(false);
    expect(validateOfflineAction(readOnly).valid).toBe(false);
  });

  it('deduplicates queued actions by fingerprint', () => {
    const actionA = createOfflineAction('receive_case', { caseId: baseCase.id }, { id: 'rep', role: 'reception' });
    const actionB = { ...actionA, id: 'act-other-id' };

    expect(enqueueOfflineAction([actionA], actionB)).toHaveLength(1);
  });

  it('keeps replay local and simulated', () => {
    const action = createOfflineAction('receive_case', { caseId: baseCase.id }, { id: 'rep', role: 'reception' });
    const store = {
      addCase: () => undefined,
      transitionWorkshopCase: () => undefined,
      assignTechnician: () => undefined,
      setWorkshopPriority: () => undefined,
      getCases: () => [baseCase],
      setCases: () => undefined,
      addClaim: () => undefined,
      updateClaim: () => undefined,
      addPhotoToCase: () => undefined,
      removePhotoFromCase: () => undefined,
      recordPrintAction: () => undefined,
      recordExportAction: () => undefined,
      updateQualityChecklist: () => undefined,
      startQualityCheck: () => undefined,
      approveQualityCheck: () => undefined,
      rejectQualityCheck: () => undefined,
      sendQualityCaseToRework: () => undefined,
      prepareDelivery: () => undefined,
      deliverCase: () => undefined,
    };

    const replay = replayOfflineQueue([action], store);
    expect(replay.result.succeeded).toEqual([action.id]);
    expect(replay.updatedActions[0].status).toBe('replayed');
  });
});
