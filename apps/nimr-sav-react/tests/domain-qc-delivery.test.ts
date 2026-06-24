import { describe, it, expect } from 'vitest';
import { canDeliverCase } from '../src/domain/delivery-rules';
import { isCaseExcludedFromActiveQC, isQCComplete } from '../src/domain/qc-rules';
import { transitionCase } from '../src/domain/workflow-engine';
import { SavCase } from '../src/domain/sav-case';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';

describe('SAV QC & Delivery Rules', () => {
  const baseCase: SavCase = {
    id: 'test-case-id',
    immatriculation: 'DEMO-001',
    vin: 'VIN-DEMO-0000000001',
    clientName: 'Client Démo A',
    telephone: '00000000',
    status: 'ready_delivery',
    receptionDate: '2026-06-24T12:00:00Z',
    createdAt: '2026-06-24T12:00:00Z',
    updatedAt: '2026-06-24T12:00:00Z',
  };

  it('blocks delivery when checklist is missing', () => {
    const caseWithoutQC = { ...baseCase };
    expect(canDeliverCase(caseWithoutQC)).toBe(false);
  });

  it('blocks delivery when required items in checklist are unchecked', () => {
    const caseWithUncheckedQC: SavCase = {
      ...baseCase,
      qcChecklist: {
        items: [
          { id: 'qc-1', label: 'Freins', checked: false, required: true },
          { id: 'qc-2', label: 'Lumières', checked: true, required: false },
        ],
        validatedBy: 'qualite-1',
      },
    };
    expect(canDeliverCase(caseWithUncheckedQC)).toBe(false);
  });

  it('blocks delivery when QC was not signed/validated by anyone', () => {
    const caseUnvalidatedQC: SavCase = {
      ...baseCase,
      qcChecklist: {
        items: [
          { id: 'qc-1', label: 'Freins', checked: true, required: true },
        ],
      },
    };
    expect(canDeliverCase(caseUnvalidatedQC)).toBe(false);
  });

  it('authorizes delivery when QC checklist is complete and validated', () => {
    const caseValidatedQC: SavCase = {
      ...baseCase,
      qcChecklist: {
        items: [
          { id: 'qc-1', label: 'Freins', checked: true, required: true },
          { id: 'qc-2', label: 'Lumières', checked: false, required: false },
        ],
        validatedBy: 'qualite-1',
        validatedAt: '2026-06-24T13:00:00Z',
      },
    };
    expect(canDeliverCase(caseValidatedQC)).toBe(true);

    const user = { id: 'livraison-1', role: 'livraison' as const };
    const res = transitionCase(caseValidatedQC, 'delivered', user);
    expect(res.success).toBe(true);
    expect(res.updatedCase?.status).toBe('delivered');
  });

  it('prevents transition to delivered if QC is invalid', () => {
    const caseUnvalidatedQC: SavCase = {
      ...baseCase,
      qcChecklist: {
        items: [
          { id: 'qc-1', label: 'Freins', checked: false, required: true },
        ],
      },
    };
    const user = { id: 'livraison-1', role: 'livraison' as const };
    const res = transitionCase(caseUnvalidatedQC, 'delivered', user);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Cannot deliver case');
  });

  it('excludes delivered and closed cases from active QC checks', () => {
    const deliveredCase: SavCase = { ...baseCase, status: 'delivered' };
    const closedCase: SavCase = { ...baseCase, status: 'closed' };
    const readyCase: SavCase = { ...baseCase, status: 'ready_delivery' };

    expect(isCaseExcludedFromActiveQC(deliveredCase)).toBe(true);
    expect(isCaseExcludedFromActiveQC(closedCase)).toBe(true);
    expect(isCaseExcludedFromActiveQC(readyCase)).toBe(false);
  });

  it('isQCComplete returns true if all required items are checked', () => {
    const caseObj: SavCase = {
      ...baseCase,
      qcChecklist: {
        items: [
          { id: 'qc-1', label: 'Req1', checked: true, required: true },
          { id: 'qc-2', label: 'Opt1', checked: false, required: false },
        ],
      },
    };
    expect(isQCComplete(caseObj)).toBe(true);
  });

  // Strict constraints validation inside test suite
  it('ensures data/vehicles.json remains empty', () => {
    const vehiclesPath = resolve(__dirname, '../../../data/vehicles.json');
    if (existsSync(vehiclesPath)) {
      const content = readFileSync(vehiclesPath, 'utf-8').trim();
      expect(content).toBe('[]');
    }
  });

  it('ensures no files import from data/vehicles.json', () => {
    const srcDir = resolve(__dirname, '../src');
    const checkDir = (dir: string): void => {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = resolve(dir, entry as string);
        if (statSync(fullPath).isDirectory()) {
          checkDir(fullPath);
        } else if ((entry as string).endsWith('.ts') || (entry as string).endsWith('.tsx')) {
          const content = readFileSync(fullPath, 'utf-8');
          expect(content).not.toMatch(/import[^'"]+['"].*vehicles\.json['"]/m);
          expect(content).not.toMatch(/require\(['"].*vehicles\.json['"]\)/m);
        }
      }
    };
    checkDir(srcDir);
  });

  it('ensures index.html does not register service worker', () => {
    const htmlPath = resolve(__dirname, '../index.html');
    const content = readFileSync(htmlPath, 'utf-8');
    expect(content).not.toContain("serviceWorker.register");
    expect(content).not.toContain("navigator.serviceWorker");
  });
});
