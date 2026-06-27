import { describe, it, expect } from 'vitest';
import {
  checkManifestReadiness,
  checkIconReadiness,
  checkOfflineReadiness,
  summarizePwaDiagnostics
} from '../src/domain/pwa-diagnostics';

describe('PWA Diagnostics Verification', () => {
  it('verifies manifest readiness checking', () => {
    const res = checkManifestReadiness();
    expect(res.status).toBeDefined();
    expect(res.details).toBeDefined();
  });

  it('verifies icon readiness checking', () => {
    const res = checkIconReadiness();
    expect(res.status).toBeDefined();
    expect(res.details).toBeDefined();
  });

  it('verifies offline readiness checking', () => {
    const res = checkOfflineReadiness();
    expect(res.status).toBeDefined();
    expect(res.details).toBeDefined();
  });

  it('runs PWA diagnostics summary correctly', () => {
    const summary = summarizePwaDiagnostics();
    expect(summary.manifest).toBeDefined();
    expect(summary.icons).toBeDefined();
    expect(summary.offline).toBeDefined();
    expect(summary.notice).toContain('v23'); // Contains the non-production compliance notice
  });
});
