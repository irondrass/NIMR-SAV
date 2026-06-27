import { describe, it, expect } from 'vitest';
import {
  sanitizeExportFileName,
  buildSafeExportFileName,
  buildCaseJsonExport,
  buildCaseTextSummary,
  buildCaseExportManifest,
  getExportWarnings,
  calculateExportBundleSize,
  buildCompleteCaseBundle,
  ExportBundleFile,
} from '../src/domain/export-bundle';
import { SavCase } from '../src/domain/sav-case';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const baseCase: SavCase = {
  id: 'export-test-001',
  immatriculation: 'CC-456-DD',
  vin: 'VINEXPORT0123456789',
  clientName: 'Marie Curie',
  telephone: '0698765432',
  status: 'received',
  receptionDate: '2025-02-10T09:00:00.000Z',
  createdAt: '2025-02-10T09:00:00.000Z',
  updatedAt: '2025-02-10T09:00:00.000Z',
};

const caseWithPhotos: SavCase = {
  ...baseCase,
  photos: [
    {
      id: 'photo-1',
      name: 'avant.jpg',
      mimeType: 'image/jpeg',
      category: 'before',
      size: 5120,
      addedAt: '2025-02-10T10:00:00.000Z',
      addedBy: 'reception',
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgAB',
    },
  ],
};

const caseWithClaims: SavCase = {
  ...baseCase,
  claims: [
    {
      id: 'claim-1',
      label: 'Sinistre Grêle',
      claimType: 'assurance',
      status: 'approved',
      expertApproved: true,
      clientApproved: true,
      requiredApprovals: ['expert', 'client'],
      expertName: 'Expert Test',
      createdAt: '2025-02-10T09:30:00.000Z',
      updatedAt: '2025-02-10T11:00:00.000Z',
    },
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Export Bundle Domain Tests (v24.0.0-alpha.20)', () => {
  describe('sanitizeExportFileName', () => {
    it('replaces accents with ASCII equivalents', () => {
      const result = sanitizeExportFileName('éàçü');
      expect(result).toBe('eacu');
    });

    it('replaces special chars with underscore', () => {
      const result = sanitizeExportFileName('Dossier/Test:2025');
      expect(result).not.toContain('/');
      expect(result).not.toContain(':');
    });

    it('preserves alphanumeric, dots, dashes, underscores', () => {
      const result = sanitizeExportFileName('file_name-2025.txt');
      expect(result).toBe('file_name-2025.txt');
    });
  });

  describe('buildSafeExportFileName', () => {
    it('builds a safe filename from case data', () => {
      const name = buildSafeExportFileName(baseCase);
      expect(name).toContain('Curie');
      expect(name).not.toContain('/');
      expect(name).not.toContain(' ');
    });
  });

  describe('buildCaseJsonExport', () => {
    it('returns valid JSON string', () => {
      const json = buildCaseJsonExport(baseCase);
      const parsed = JSON.parse(json);
      expect(parsed.id).toBe(baseCase.id);
      expect(parsed.immatriculation).toBe(baseCase.immatriculation);
    });

    it('includes client name in JSON export', () => {
      const json = buildCaseJsonExport(baseCase);
      expect(json).toContain('Marie Curie');
    });
  });

  describe('buildCaseTextSummary', () => {
    it('returns a non-empty string', () => {
      const text = buildCaseTextSummary(baseCase);
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
    });

    it('contains immatriculation and client name', () => {
      const text = buildCaseTextSummary(baseCase);
      expect(text).toContain('CC-456-DD');
      expect(text).toContain('Marie Curie');
    });

    it('handles case with no claims', () => {
      const text = buildCaseTextSummary(baseCase);
      expect(text).toContain('Aucun sinistre');
    });
  });

  describe('buildCaseExportManifest', () => {
    it('produces valid JSON manifest', () => {
      const files: ExportBundleFile[] = [
        {
          id: 'f1',
          fileName: 'dossier.json',
          fileType: 'json',
          mimeType: 'application/json',
          content: '{}',
          size: 2,
          source: 'test',
        },
      ];
      const manifest = buildCaseExportManifest(baseCase, files);
      const parsed = JSON.parse(manifest);
      expect(parsed.caseId).toBe(baseCase.id);
      expect(parsed.filesCount).toBe(1);
      expect(Array.isArray(parsed.files)).toBe(true);
    });
  });

  describe('getExportWarnings', () => {
    it('warns if no photos', () => {
      const warnings = getExportWarnings(baseCase);
      expect(warnings.some((w) => w.toLowerCase().includes('photo'))).toBe(true);
    });

    it('warns if no claims', () => {
      const warnings = getExportWarnings(baseCase);
      expect(warnings.some((w) => w.toLowerCase().includes('sinistre'))).toBe(true);
    });

    it('warns about claim with no estimate', () => {
      const warnings = getExportWarnings(caseWithClaims);
      // caseWithClaims has a claim but no estimate on it
      expect(Array.isArray(warnings)).toBe(true);
    });

    it('no photo warning if photos exist', () => {
      const warnings = getExportWarnings(caseWithPhotos);
      const photoWarn = warnings.find((w) => w.toLowerCase().includes('photo'));
      expect(photoWarn).toBeUndefined();
    });
  });

  describe('calculateExportBundleSize', () => {
    it('sums file sizes correctly', () => {
      const files: ExportBundleFile[] = [
        { id: 'a', fileName: 'a.json', fileType: 'json', mimeType: 'application/json', content: '', size: 100, source: 'x' },
        { id: 'b', fileName: 'b.txt', fileType: 'text', mimeType: 'text/plain', content: '', size: 200, source: 'y' },
      ];
      expect(calculateExportBundleSize(files)).toBe(300);
    });

    it('returns 0 for empty list', () => {
      expect(calculateExportBundleSize([])).toBe(0);
    });
  });

  describe('buildCompleteCaseBundle', () => {
    it('returns an ExportBundle with required fields', () => {
      const bundle = buildCompleteCaseBundle(baseCase, 'TestActor');
      expect(bundle.caseId).toBe(baseCase.id);
      expect(bundle.generatedBy).toBe('TestActor');
      expect(typeof bundle.generatedAt).toBe('string');
      expect(Array.isArray(bundle.files)).toBe(true);
      expect(bundle.files.length).toBeGreaterThan(0);
      expect(typeof bundle.manifest).toBe('string');
      expect(Array.isArray(bundle.warnings)).toBe(true);
    });

    it('always includes a JSON export file', () => {
      const bundle = buildCompleteCaseBundle(baseCase, 'Actor');
      const jsonFile = bundle.files.find((f) => f.fileType === 'json');
      expect(jsonFile).toBeDefined();
    });

    it('always includes HTML print files', () => {
      const bundle = buildCompleteCaseBundle(baseCase, 'Actor');
      const htmlFiles = bundle.files.filter((f) => f.fileType === 'html');
      expect(htmlFiles.length).toBeGreaterThan(0);
    });

    it('includes photo files when case has photos', () => {
      const bundle = buildCompleteCaseBundle(caseWithPhotos, 'Actor');
      const photoFiles = bundle.files.filter((f) => f.fileType === 'photo');
      expect(photoFiles.length).toBeGreaterThan(0);
    });
  });
});
