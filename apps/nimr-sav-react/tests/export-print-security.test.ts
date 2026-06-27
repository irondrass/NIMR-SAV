import { describe, expect, it } from 'vitest';
import {
  buildCompleteCaseBundle,
  sanitizeExportFileName,
  validateCompleteCaseExportPermission,
} from '../src/domain/export-bundle';
import { buildDeliveryReceipt, buildReceptionSheet } from '../src/domain/print-documents';
import { SavCase } from '../src/domain/sav-case';

const baseCase: SavCase = {
  id: 'alpha19-export-case',
  immatriculation: 'AA-123-AA',
  vin: 'VF1ABCDEF12345678',
  clientName: 'Client Demo',
  telephone: '+21622333444',
  status: 'quality_approved',
  receptionDate: '2026-06-27T08:00:00.000Z',
  directionNotes: '<script>alert("x")</script>',
  deliveryRecipientName: 'Client Demo',
  deliveryProofReference: 'PV-001',
  deliveryNotes: '<script>alert("delivery")</script>',
  createdAt: '2026-06-27T08:00:00.000Z',
  updatedAt: '2026-06-27T08:30:00.000Z',
};

describe('Export and print security alpha.19', () => {
  it('escapes dangerous notes in printable HTML documents', () => {
    const html = buildReceptionSheet(baseCase);
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('sanitizes dangerous export file names', () => {
    const fileName = sanitizeExportFileName('../bad<name>=.zip');
    expect(fileName).not.toContain('/');
    expect(fileName).not.toContain('<');
    expect(fileName.length).toBeGreaterThan(0);
  });

  it('refuses complete case export for technicians', () => {
    expect(validateCompleteCaseExportPermission('technicien').allowed).toBe(false);
    expect(() => buildCompleteCaseBundle(baseCase, 'tech-1', 'technicien')).toThrow(/refusé/i);
  });

  it('allows authorized complete export and keeps non-blocking warnings without photos', () => {
    const bundle = buildCompleteCaseBundle(baseCase, 'reception-1', 'reception');
    expect(bundle.files.length).toBeGreaterThan(0);
    expect(bundle.warnings.join(' ')).toContain('Aucune photo');
  });

  it('keeps the delivery receipt printable from a local case', () => {
    const html = buildDeliveryReceipt(baseCase);
    expect(html).toContain('Procès-Verbal');
    expect(html).not.toContain('<script>alert("delivery")</script>');
  });
});
