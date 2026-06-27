import { describe, it, expect } from 'vitest';
import {
  buildCompleteCaseBundle,
  createZipBlobFromBundle,
  base64ToUint8Array,
  getExportWarnings,
} from '../src/domain/export-bundle';
import {
  buildReceptionSheet,
  buildWorkshopSheet,
  buildQualityCheckSheet,
  buildDeliveryReceipt,
  buildCompleteCasePrint,
} from '../src/domain/print-documents';
import { collectCasePhotos } from '../src/domain/photo-export';
import { SavCase } from '../src/domain/sav-case';
import { APP_VERSION } from '../src/constants/version';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const baseCase: SavCase = {
  id: 'integration-test-001',
  immatriculation: 'GG-999-HH',
  vin: 'VININTEGR000000001',
  clientName: 'Test Integration Client',
  telephone: '0611223344',
  status: 'delivered',
  receptionDate: '2025-04-01T08:00:00.000Z',
  createdAt: '2025-04-01T08:00:00.000Z',
  updatedAt: '2025-04-02T14:00:00.000Z',
  assignedTechnicianName: 'Technicien Test',
  deliveredAt: '2025-04-02T14:00:00.000Z',
  deliveredBy: 'Livreur Integration',
  deliveryRecipientName: 'Test Integration Client',
  deliveryProofReference: 'INT-PROOF-001',
  qcCheckedAt: '2025-04-02T13:00:00.000Z',
  qcChecklist: [
    { id: 'qc-i1', label: 'Inspection finale', checked: true, required: true },
    { id: 'qc-i2', label: 'Nettoyage', checked: true, required: false },
  ],
  workshopTasks: [
    {
      id: 'task-i1',
      label: 'Tôlerie carrosserie',
      pole: 'tolerie',
      estimatedDurationMinutes: 240,
      status: 'done',
      createdAt: '2025-04-01T09:00:00.000Z',
      updatedAt: '2025-04-02T10:00:00.000Z',
    },
  ],
  photos: [
    {
      id: 'int-photo-1',
      name: 'avant_integration.jpg',
      mimeType: 'image/jpeg',
      category: 'before',
      size: 4096,
      addedAt: '2025-04-01T09:30:00.000Z',
      addedBy: 'reception',
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgAB',
    },
  ],
  claims: [
    {
      id: 'claim-int-1',
      label: 'Sinistre Grêle Intégration',
      claimType: 'assurance',
      status: 'approved',
      expertApproved: true,
      clientApproved: true,
      requiredApprovals: ['expert', 'client'],
      expertName: 'Expert Intégration',
      createdAt: '2025-04-01T09:00:00.000Z',
      updatedAt: '2025-04-01T11:00:00.000Z',
    },
  ],
};

// ─── Integration Tests ────────────────────────────────────────────────────────

describe('Print & Export Integration Tests (v24.0.0-alpha.18)', () => {
  describe('Version', () => {
    it('APP_VERSION matches v24.0.0-alpha.18', () => {
      expect(APP_VERSION).toBe('v24.0.0-alpha.18');
    });
  });

  describe('Print pipeline end-to-end', () => {
    it('buildReceptionSheet produces non-empty HTML for integration fixture', () => {
      const html = buildReceptionSheet(baseCase);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('GG-999-HH');
    });

    it('buildWorkshopSheet includes task data', () => {
      const html = buildWorkshopSheet(baseCase);
      expect(html).toContain('Tôlerie');
    });

    it('buildQualityCheckSheet includes checklist', () => {
      const html = buildQualityCheckSheet(baseCase);
      expect(html).toContain('Inspection finale');
    });

    it('buildDeliveryReceipt includes proof reference', () => {
      const html = buildDeliveryReceipt(baseCase);
      expect(html).toContain('INT-PROOF-001');
    });

    it('buildCompleteCasePrint includes all major sections', () => {
      const html = buildCompleteCasePrint(baseCase);
      expect(html).toContain('Réception');
      expect(html).toContain('Restitution');
      expect(html).toContain('Qualité');
    });
  });

  describe('Photo collection pipeline', () => {
    it('collects photos from case fixture', () => {
      const photos = collectCasePhotos(baseCase);
      expect(photos.length).toBeGreaterThan(0);
    });

    it('photo has expected fields', () => {
      const photos = collectCasePhotos(baseCase);
      const photo = photos[0];
      expect(photo.id).toBeDefined();
      expect(photo.category).toBeDefined();
      expect(photo.name).toBeDefined();
    });
  });

  describe('Export bundle pipeline', () => {
    it('bundle is built successfully from integration fixture', () => {
      const bundle = buildCompleteCaseBundle(baseCase, 'IntegrationActor');
      expect(bundle.caseId).toBe(baseCase.id);
      expect(bundle.files.length).toBeGreaterThan(0);
    });

    it('bundle contains JSON, HTML, text, and photo files', () => {
      const bundle = buildCompleteCaseBundle(baseCase, 'Actor');
      const types = new Set(bundle.files.map((f) => f.fileType));
      expect(types.has('json')).toBe(true);
      expect(types.has('html')).toBe(true);
      expect(types.has('text')).toBe(true);
      expect(types.has('photo')).toBe(true);
    });

    it('manifest JSON is parseable and contains correct caseId', () => {
      const bundle = buildCompleteCaseBundle(baseCase, 'Actor');
      const manifest = JSON.parse(bundle.manifest);
      expect(manifest.caseId).toBe(baseCase.id);
    });

    it('warnings array does not warn about photos when photos exist', () => {
      const warnings = getExportWarnings(baseCase);
      const photoWarn = warnings.find((w) => w.toLowerCase().includes('photo'));
      expect(photoWarn).toBeUndefined();
    });
  });

  describe('ZIP bundle binary correctness', () => {
    it('createZipBlobFromBundle returns a Blob', () => {
      const bundle = buildCompleteCaseBundle(baseCase, 'Actor');
      const blob = createZipBlobFromBundle(bundle);
      expect(blob).toBeDefined();
      expect(blob.type).toBe('application/zip');
      expect(blob.size).toBeGreaterThan(0);
    });

    it('ZIP blob contains expected magic bytes (PK header)', async () => {
      const bundle = buildCompleteCaseBundle(baseCase, 'Actor');
      const blob = createZipBlobFromBundle(bundle);
      const buffer = await blob.arrayBuffer();
      const view = new DataView(buffer);
      // PK header: 0x50, 0x4B, 0x03, 0x04
      expect(view.getUint8(0)).toBe(0x50);
      expect(view.getUint8(1)).toBe(0x4B);
      expect(view.getUint8(2)).toBe(0x03);
      expect(view.getUint8(3)).toBe(0x04);
    });

    it('ZIP blob size is proportional to content', () => {
      const bundle1 = buildCompleteCaseBundle(baseCase, 'Actor');
      const bundle2 = buildCompleteCaseBundle({ ...baseCase, photos: [] }, 'Actor');
      const blob1 = createZipBlobFromBundle(bundle1);
      const blob2 = createZipBlobFromBundle(bundle2);
      // Case with photos should produce a larger ZIP
      expect(blob1.size).toBeGreaterThan(blob2.size);
    });
  });

  describe('base64ToUint8Array', () => {
    it('decodes a simple base64 string correctly', () => {
      // "Hello" in base64 is "SGVsbG8="
      const bytes = base64ToUint8Array('SGVsbG8=');
      const decoder = new TextDecoder();
      expect(decoder.decode(bytes)).toBe('Hello');
    });

    it('handles empty string', () => {
      const bytes = base64ToUint8Array('');
      expect(bytes.length).toBe(0);
    });
  });
});
