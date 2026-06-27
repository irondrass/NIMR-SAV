import { describe, it, expect } from 'vitest';
import {
  deriveConnectivityMessage,
  deriveConnectivitySeverity,
  canRunOfflineAction,
  getInitialConnectivityStatus
} from '../src/domain/connectivity';

describe('Connectivity Domain Logic', () => {
  it('correctly returns initial connectivity status', () => {
    const status = getInitialConnectivityStatus();
    expect(['online', 'offline']).toContain(status);
  });

  it('correctly derives messages based on connectivity status', () => {
    expect(deriveConnectivityMessage('online')).toContain('Connecté');
    expect(deriveConnectivityMessage('offline')).toContain('hors ligne');
  });

  it('correctly derives severity levels', () => {
    expect(deriveConnectivitySeverity('online')).toBe('success');
    expect(deriveConnectivitySeverity('offline')).toBe('error');
  });

  it('correctly filters actions permitted offline', () => {
    // Operations allowed offline: receptions, assignments, plans, priorities, photo/QC updates
    expect(canRunOfflineAction('create_case')).toBe(true);
    expect(canRunOfflineAction('receive_case')).toBe(true);
    expect(canRunOfflineAction('update_case')).toBe(true);
    expect(canRunOfflineAction('add_claim')).toBe(true);
    expect(canRunOfflineAction('qc_update')).toBe(true);
    expect(canRunOfflineAction('delivery_update')).toBe(true);

    // Operations NOT allowed offline
    expect(canRunOfflineAction('estimate_import')).toBe(false);
    expect(canRunOfflineAction('force_cloud_sync')).toBe(false);
  });
});
