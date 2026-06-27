import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';
import { APP_VERSION } from '../src/constants/version';
import { summarizePwaDiagnostics } from '../src/domain/pwa-diagnostics';
import { summarizeSecurityHardening } from '../src/domain/security-hardening';
import { summarizeStatusHardening } from '../src/domain/status-hardening';
import { buildFieldSecurityReport } from '../src/domain/field-security';
import { buildGanttRows } from '../src/domain/gantt-planning';
import { detectBookingCollision } from '../src/domain/collision-engine';
import { getDefaultWorkshopResources } from '../src/domain/resource-manager';
import { createDefaultClaim, getBlockingClaimsReasons } from '../src/domain/claims';
import { parseEstimateText } from '../src/domain/estimate-parser';
import { calculateLaborSummaryByPole } from '../src/domain/labor-allocator';
import { buildReceptionSheet } from '../src/domain/print-documents';
import { buildCompleteCaseBundle } from '../src/domain/export-bundle';
import { normalizePhotoAttachment } from '../src/domain/photo-export';
import { buildLocalSnapshot, validateLocalSnapshot } from '../src/domain/local-cache';
import { createOfflineAction, validateOfflineAction } from '../src/domain/offline-queue';
import { SavCase } from '../src/domain/sav-case';

const srcRoot = resolve(__dirname, '../src');
const testsRoot = resolve(__dirname, '../tests');
const vehiclesPath = resolve(__dirname, '../../../data/vehicles.json');

function collectTextFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = resolve(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...collectTextFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

const caseFixture: SavCase = {
  id: 'alpha20-recette-case',
  immatriculation: 'CC-789-CC',
  vin: 'VF1ABCDEF12345678',
  clientName: 'Client Integration',
  telephone: '+21622333444',
  status: 'draft',
  receptionDate: '2026-06-28T08:00:00.000Z',
  createdAt: '2026-06-28T08:00:00.000Z',
  updatedAt: '2026-06-28T08:00:00.000Z',
};

describe('Alpha.20 recette readiness integration', () => {
  it('confirms alpha.20 version and isolated PWA recipe diagnostics', () => {
    const pwa = summarizePwaDiagnostics();
    expect(APP_VERSION).toBe('v24.0.0-alpha.20');
    expect(pwa.recipe.basePath).toBe('/NIMR-SAV-V24-RECETTE/');
    expect(pwa.recipe.cacheName).toBe('nimr-sav-v24-alpha20-recette');
    expect(pwa.csp.status).toBe('ok');
    expect(pwa.scope.status).toBe('ok');
    expect(pwa.serviceWorkerIsolation.status).toBe('ok');
    expect(pwa.notice).toContain('non production');
  });

  it('keeps data/vehicles.json empty and avoids forbidden cloud connector text', () => {
    const forbiddenCloud = ['supa', 'base'].join('');
    const content = [...collectTextFiles(srcRoot), ...collectTextFiles(testsRoot)]
      .map((file) => readFileSync(file, 'utf-8'))
      .join('\n');

    expect(readFileSync(vehiclesPath, 'utf-8').trim()).toBe('[]');
    expect(content).not.toContain(forbiddenCloud);
  });

  it('preserves alpha.14 planning, Gantt, collisions and capacity foundations', () => {
    const resource = getDefaultWorkshopResources()[0];
    const rows = buildGanttRows([resource], [
      {
        id: 'booking-a',
        caseId: 'case-a',
        resourceId: resource.id,
        start: new Date('2026-06-28T08:00:00.000Z'),
        end: new Date('2026-06-28T10:00:00.000Z'),
      },
    ], new Date('2026-06-28T00:00:00.000Z'));
    expect(rows.length).toBeGreaterThan(0);
    expect(detectBookingCollision(
      { id: 'a', caseId: 'case-a', resourceId: resource.id, start: new Date('2026-06-28T08:00:00.000Z'), end: new Date('2026-06-28T10:00:00.000Z') },
      { id: 'b', caseId: 'case-b', resourceId: resource.id, start: new Date('2026-06-28T09:00:00.000Z'), end: new Date('2026-06-28T11:00:00.000Z') }
    )).toBe(true);
  });

  it('preserves alpha.15 claims and alpha.16 estimate/labor foundations', () => {
    const claim = createDefaultClaim();
    const estimate = parseEstimateText('D/P AILE AVANT 1.50 33.000 49.500\nTOTAL TTC: 49.500', 'devis.txt', 'tester');
    expect(getBlockingClaimsReasons([claim]).length).toBeGreaterThan(0);
    expect(estimate.lines.length).toBeGreaterThan(0);
    expect(calculateLaborSummaryByPole(estimate.lines)).toBeDefined();
  });

  it('preserves alpha.17 print/export/photos and alpha.18 offline/cache/queue', () => {
    expect(buildReceptionSheet(caseFixture)).toContain('Fiche de Réception');
    expect(buildCompleteCaseBundle(caseFixture, 'reception', 'reception').files.length).toBeGreaterThan(0);
    expect(normalizePhotoAttachment('photo.jpg', 'image/jpeg', 1200, 'before').type).toBe('image/jpeg');

    const snapshot = buildLocalSnapshot([caseFixture], [], [], APP_VERSION);
    expect(validateLocalSnapshot(snapshot, APP_VERSION).valid).toBe(true);
    expect(validateOfflineAction(createOfflineAction('receive_case', { caseId: caseFixture.id }, { id: 'rep', role: 'reception' })).valid).toBe(true);
  });

  it('preserves alpha.19 security and readiness hardening', () => {
    expect(summarizeSecurityHardening().blockers).toHaveLength(0);
    expect(summarizeStatusHardening().blockers).toHaveLength(0);
    expect(buildFieldSecurityReport().blockers).toHaveLength(0);
  });
});
