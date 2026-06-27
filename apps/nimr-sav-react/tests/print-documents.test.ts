import { describe, it, expect } from 'vitest';
import {
  sanitizePrintableText,
  formatPrintDate,
  formatPrintMoney,
  formatPrintDuration,
  getPrintDocumentTitle,
  buildPrintableHtml,
  buildReceptionSheet,
  buildWorkshopSheet,
  buildQualityCheckSheet,
  buildDeliveryReceipt,
  buildCompleteCasePrint,
  buildCompleteCaseSummary,
  PrintableDocumentType,
} from '../src/domain/print-documents';
import { SavCase } from '../src/domain/sav-case';
import { APP_VERSION } from '../src/constants/version';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const baseCase: SavCase = {
  id: 'print-test-001',
  immatriculation: 'AA-123-BB',
  vin: 'VIN1234567890ABCDE',
  clientName: 'Jean Dupont',
  telephone: '0612345678',
  status: 'received',
  receptionDate: '2025-01-15T10:00:00.000Z',
  createdAt: '2025-01-15T10:00:00.000Z',
  updatedAt: '2025-01-15T10:00:00.000Z',
};

const fullCase: SavCase = {
  ...baseCase,
  status: 'delivered',
  assignedTechnicianName: 'Mehdi Technicien',
  qcCheckedAt: '2025-01-16T14:00:00.000Z',
  deliveredAt: '2025-01-17T12:00:00.000Z',
  deliveredBy: 'Livreur Demo',
  deliveryRecipientName: 'Jean Dupont',
  deliveryProofReference: 'PROOF-001',
  deliveryDate: '2025-01-17T12:00:00.000Z',
  qcChecklist: [
    { id: 'qc-1', label: 'Carrosserie vérifiée', checked: true, required: true },
    { id: 'qc-2', label: 'Peinture vérifiée', checked: true, required: true },
    { id: 'qc-3', label: 'Nettoyage intérieur', checked: false, required: false },
  ],
  workshopTasks: [
    {
      id: 'task-1',
      label: 'Débosselage aile avant gauche',
      pole: 'tolerie',
      estimatedDurationMinutes: 180,
      status: 'done',
      createdAt: '2025-01-15T12:00:00.000Z',
      updatedAt: '2025-01-16T10:00:00.000Z',
    },
  ],
};

// ─── sanitizePrintableText ────────────────────────────────────────────────────

describe('Print Documents Domain Tests', () => {
  describe('sanitizePrintableText', () => {
    it('returns empty string for null/undefined', () => {
      expect(sanitizePrintableText(null)).toBe('');
      expect(sanitizePrintableText(undefined)).toBe('');
    });

    it('escapes HTML special chars', () => {
      const result = sanitizePrintableText('<script>alert("xss") & escape</script>');
      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;script&gt;');
      expect(result).toContain('&amp;');
      expect(result).toContain('&quot;');
    });

    it('preserves normal text', () => {
      expect(sanitizePrintableText('Jean Dupont')).toBe('Jean Dupont');
    });
  });

  // ─── formatPrintDate ────────────────────────────────────────────────────────

  describe('formatPrintDate', () => {
    it('returns N/A for null/undefined', () => {
      expect(formatPrintDate(null)).toBe('N/A');
      expect(formatPrintDate(undefined)).toBe('N/A');
    });

    it('returns N/A for invalid date string', () => {
      expect(formatPrintDate('not-a-date')).toBe('N/A');
    });

    it('formats a valid ISO date', () => {
      const result = formatPrintDate('2025-01-15T10:00:00.000Z');
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
      expect(result).not.toBe('N/A');
    });
  });

  // ─── formatPrintMoney ────────────────────────────────────────────────────────

  describe('formatPrintMoney', () => {
    it('returns 0,00 for null/undefined', () => {
      expect(formatPrintMoney(null)).toContain('0');
      expect(formatPrintMoney(undefined)).toContain('0');
    });

    it('formats a positive amount', () => {
      const result = formatPrintMoney(1234.5);
      expect(typeof result).toBe('string');
      expect(result).toBeTruthy();
    });
  });

  // ─── formatPrintDuration ────────────────────────────────────────────────────

  describe('formatPrintDuration', () => {
    it('returns 0h00 for null/undefined', () => {
      expect(formatPrintDuration(null)).toBe('0h00');
      expect(formatPrintDuration(undefined)).toBe('0h00');
    });

    it('formats minutes into readable string', () => {
      const result = formatPrintDuration(90);
      expect(typeof result).toBe('string');
      expect(result).toBeTruthy();
    });
  });

  // ─── getPrintDocumentTitle ────────────────────────────────────────────────────

  describe('getPrintDocumentTitle', () => {
    const types: PrintableDocumentType[] = [
      'reception_sheet',
      'workshop_sheet',
      'quality_check_sheet',
      'delivery_receipt',
      'claim_summary',
      'estimate_summary',
      'complete_case',
    ];
    types.forEach((t) => {
      it(`returns a non-empty title for "${t}"`, () => {
        const title = getPrintDocumentTitle(t);
        expect(typeof title).toBe('string');
        expect(title.length).toBeGreaterThan(0);
      });
    });
  });

  // ─── buildPrintableHtml ────────────────────────────────────────────────────

  describe('buildPrintableHtml', () => {
    it('returns valid HTML string containing the title', () => {
      const html = buildPrintableHtml('Test Title', '<p>content</p>');
      expect(html).toContain('Test Title');
      expect(html).toContain('<p>content</p>');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain(APP_VERSION);
    });

    it('does not contain unescaped script injection', () => {
      const html = buildPrintableHtml('Safe', '<p>ok</p>');
      expect(html).not.toContain('<script src');
    });
  });

  // ─── buildReceptionSheet ────────────────────────────────────────────────────

  describe('buildReceptionSheet', () => {
    it('builds an HTML string for a valid case', () => {
      const html = buildReceptionSheet(baseCase);
      expect(typeof html).toBe('string');
      expect(html).toContain('AA-123-BB');
      expect(html).toContain('Jean Dupont');
      expect(html).toContain('<!DOCTYPE html>');
    });

    it('is safe from XSS in immatriculation', () => {
      const dangerousCase = { ...baseCase, immatriculation: '<script>alert(1)</script>' };
      const html = buildReceptionSheet(dangerousCase);
      expect(html).not.toContain('<script>alert(1)</script>');
    });
  });

  // ─── buildWorkshopSheet ────────────────────────────────────────────────────

  describe('buildWorkshopSheet', () => {
    it('builds HTML for a case with workshop tasks', () => {
      const html = buildWorkshopSheet(fullCase);
      expect(html).toContain('AA-123-BB');
      expect(html).toContain('<!DOCTYPE html>');
    });

    it('includes task labels in workshop sheet', () => {
      const html = buildWorkshopSheet(fullCase);
      expect(html).toContain('bossela');
    });

    it('handles a case with no tasks gracefully', () => {
      const noTasksCase = { ...baseCase };
      const html = buildWorkshopSheet(noTasksCase);
      expect(typeof html).toBe('string');
      expect(html).toContain('<!DOCTYPE html>');
    });
  });

  // ─── buildQualityCheckSheet ────────────────────────────────────────────────

  describe('buildQualityCheckSheet', () => {
    it('builds HTML for a case with QC checklist', () => {
      const html = buildQualityCheckSheet(fullCase);
      expect(html).toContain('AA-123-BB');
      expect(html).toContain('<!DOCTYPE html>');
    });

    it('includes checklist item labels', () => {
      const html = buildQualityCheckSheet(fullCase);
      expect(html).toContain('Carrosserie');
    });

    it('handles a case with no checklist gracefully', () => {
      const html = buildQualityCheckSheet(baseCase);
      expect(typeof html).toBe('string');
      expect(html).toContain('<!DOCTYPE html>');
    });
  });

  // ─── buildDeliveryReceipt ────────────────────────────────────────────────────

  describe('buildDeliveryReceipt', () => {
    it('builds HTML for a delivered case', () => {
      const html = buildDeliveryReceipt(fullCase);
      expect(html).toContain('AA-123-BB');
      expect(html).toContain('<!DOCTYPE html>');
    });

    it('includes proof reference in receipt', () => {
      const html = buildDeliveryReceipt(fullCase);
      expect(html).toContain('PROOF-001');
    });

    it('handles a case not yet delivered without crashing', () => {
      const html = buildDeliveryReceipt(baseCase);
      expect(typeof html).toBe('string');
    });
  });

  // ─── buildCompleteCasePrint ────────────────────────────────────────────────

  describe('buildCompleteCasePrint', () => {
    it('builds a complete summary HTML for a full case', () => {
      const html = buildCompleteCasePrint(fullCase);
      expect(html).toContain('AA-123-BB');
      expect(html).toContain('Jean Dupont');
      expect(html).toContain('<!DOCTYPE html>');
    });

    it('includes all major sections', () => {
      const html = buildCompleteCasePrint(fullCase);
      expect(html).toContain('Réception');
      expect(html).toContain('Restitution');
    });

    it('is XSS-safe for client names with HTML chars', () => {
      const xssCase = { ...baseCase, clientName: '<b>Hacker</b>' };
      const html = buildCompleteCasePrint(xssCase);
      expect(html).not.toContain('<b>Hacker</b>');
    });
  });

  // ─── buildCompleteCaseSummary (alias) ────────────────────────────────────────

  describe('buildCompleteCaseSummary', () => {
    it('is an alias for buildCompleteCasePrint and returns identical output', () => {
      const a = buildCompleteCasePrint(fullCase);
      const b = buildCompleteCaseSummary(fullCase);
      expect(a).toBe(b);
    });
  });

  // ─── Version check ─────────────────────────────────────────────────────────

  describe('Version', () => {
    it('APP_VERSION is v24.0.0-alpha.18', () => {
      expect(APP_VERSION).toBe('v24.0.0-alpha.18');
    });
  });
});
