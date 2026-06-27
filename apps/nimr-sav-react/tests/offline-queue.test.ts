import { describe, it, expect } from 'vitest';
import {
  createOfflineAction,
  validateOfflineAction,
  enqueueOfflineAction,
  cancelOfflineAction,
  summarizeOfflineQueue
} from '../src/domain/offline-queue';

describe('Offline Queue Actions & Validation', () => {
  const offlineCase = {
    id: 'case-offline-valid',
    immatriculation: 'AA-123-AA',
    vin: 'VF1ABCDEF12345678',
    clientName: 'Offline Client',
    telephone: '+21622333444',
    status: 'draft' as const,
    receptionDate: '2026-06-27T08:00:00.000Z',
    createdAt: '2026-06-27T08:00:00.000Z',
    updatedAt: '2026-06-27T08:00:00.000Z',
  };

  it('creates a queued action with unique ID and timestamp', () => {
    const action = createOfflineAction(
      'receive_case',
      { caseId: 'case-123' },
      { id: 'usr-1', role: 'chef-atelier' }
    );

    expect(action.id).toBeDefined();
    expect(action.id.startsWith('act-')).toBe(true);
    expect(action.status).toBe('queued');
    expect(action.type).toBe('receive_case');
    expect(action.payload).toEqual({ caseId: 'case-123' });
    expect(action.actor).toEqual({ id: 'usr-1', role: 'chef-atelier' });
    expect(action.timestamp).toBeDefined();
  });

  it('validates role permissions for queued actions correctly', () => {
    // Reception can perform modifications
    const act1 = createOfflineAction('create_case', offlineCase, { id: 'usr-reception', role: 'reception' });
    expect(validateOfflineAction(act1).valid).toBe(true);

    // Lecture-seule cannot perform modifications
    const act2 = createOfflineAction('create_case', offlineCase, { id: 'usr-ro', role: 'lecture-seule' });
    expect(validateOfflineAction(act2).valid).toBe(false);

    // Chef-atelier can assign technician
    const act3 = createOfflineAction('update_case', { caseId: 'c1', technicianId: 'tech-1' }, { id: 'usr-chef', role: 'chef-atelier' });
    expect(validateOfflineAction(act3).valid).toBe(true);

    // Technician cannot perform full exports
    const act4 = createOfflineAction('export_case', { caseId: 'c1' }, { id: 'usr-tech', role: 'technicien' });
    expect(validateOfflineAction(act4).valid).toBe(false);
  });

  it('correctly enqueues actions into state', () => {
    const queue = [
      createOfflineAction('receive_case', { caseId: 'c1' }, { id: 'u1', role: 'reception' })
    ];
    const newAction = createOfflineAction('update_case', { caseId: 'c2' }, { id: 'u2', role: 'chef-atelier' });
    const updated = enqueueOfflineAction(queue, newAction);

    expect(updated.length).toBe(2);
    expect(updated[1]).toEqual(newAction);
  });

  it('correctly cancels pending actions', () => {
    const act1 = createOfflineAction('receive_case', { caseId: 'c1' }, { id: 'u1', role: 'reception' });
    const act2 = createOfflineAction('update_case', { caseId: 'c2' }, { id: 'u2', role: 'chef-atelier' });
    const queue = [act1, act2];

    const updated = cancelOfflineAction(queue, act1.id);
    expect(updated.length).toBe(2);
    expect(updated.find(a => a.id === act1.id)?.status).toBe('cancelled');
  });

  it('provides a detailed summary string', () => {
    const act1 = createOfflineAction('receive_case', { caseId: 'c1' }, { id: 'u1', role: 'reception' });
    const act2 = createOfflineAction('update_case', { caseId: 'c2' }, { id: 'u2', role: 'chef-atelier' });

    // Simulate one replayed and one queued
    act1.status = 'replayed';
    const queue = [act1, act2];

    const summary = summarizeOfflineQueue(queue);
    expect(summary).toContain('1 en attente');
    expect(summary).toContain('1 rejouée(s)');
  });
});
