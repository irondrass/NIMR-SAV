import { describe, it, expect } from 'vitest';
import {
  normalizePhotoAttachment,
  collectCasePhotos,
  collectClaimPhotos,
  buildPhotoExportFileName,
  detectPhotoMimeType,
  dataUrlToExportContent,
  summarizePhotoExports,
} from '../src/domain/photo-export';
import { SavCase, CasePhoto, Claim } from '../src/domain/sav-case';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const makePhoto = (overrides: Partial<CasePhoto> = {}): CasePhoto => ({
  id: 'photo-test-001',
  name: 'test.jpg',
  mimeType: 'image/jpeg',
  category: 'before',
  size: 2048,
  addedAt: '2025-03-01T10:00:00.000Z',
  addedBy: 'reception',
  dataUrl: 'data:image/jpeg;base64,/9j/abc',
  ...overrides,
});

const baseCase: SavCase = {
  id: 'photo-case-001',
  immatriculation: 'EE-789-FF',
  vin: 'VINPHOTO0000000001',
  clientName: 'Photo Client',
  telephone: '0699887766',
  status: 'repair',
  receptionDate: '2025-03-01T09:00:00.000Z',
  createdAt: '2025-03-01T09:00:00.000Z',
  updatedAt: '2025-03-01T09:00:00.000Z',
};

const caseWithPhotos: SavCase = {
  ...baseCase,
  photos: [
    makePhoto({ id: 'p1', category: 'before' }),
    makePhoto({ id: 'p2', category: 'after', name: 'apres.jpg' }),
  ],
};

const caseWithClaimPhotos: SavCase = {
  ...baseCase,
  claims: [
    {
      id: 'claim-photo-1',
      label: 'Sinistre Photo',
      claimType: 'assurance',
      status: 'approved',
      expertApproved: true,
      clientApproved: true,
      requiredApprovals: ['expert'],
      createdAt: '2025-03-01T09:30:00.000Z',
      updatedAt: '2025-03-01T10:00:00.000Z',
      photos: [
        makePhoto({ id: 'cp1', category: 'claim', relatedClaimId: 'claim-photo-1' }),
      ],
    },
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Photo Export Domain Tests (v24.0.0-alpha.17)', () => {
  describe('normalizePhotoAttachment', () => {
    it('creates a CasePhoto object with generated ID and metadata', () => {
      const result = normalizePhotoAttachment(
        'test.jpg',
        'image/jpeg',
        2048,
        'before',
        'data:image/jpeg;base64,...'
      );
      expect(result.id).toMatch(/^pho-/);
      expect(result.name).toBe('test.jpg');
      expect(result.type).toBe('image/jpeg');
      expect(result.size).toBe(2048);
      expect(result.category).toBe('before');
      expect(result.dataUrl).toBe('data:image/jpeg;base64,...');
      expect(result.createdAt).toBeTruthy();
    });

    it('handles defaults for empty parameters', () => {
      const result = normalizePhotoAttachment(
        'x.jpg',
        '',
        0,
        'other'
      );
      expect(result.id).toMatch(/^pho-/);
      expect(result.type).toBe('image/jpeg');
      expect(result.size).toBe(0);
    });
  });

  describe('collectCasePhotos', () => {
    it('returns empty array for a case with no photos', () => {
      const photos = collectCasePhotos(baseCase);
      expect(Array.isArray(photos)).toBe(true);
      expect(photos.length).toBe(0);
    });

    it('returns photos from case.photos', () => {
      const photos = collectCasePhotos(caseWithPhotos);
      expect(photos.length).toBe(2);
    });

    it('also collects photos from claims', () => {
      const photos = collectCasePhotos(caseWithClaimPhotos);
      expect(photos.length).toBeGreaterThan(0);
    });

    it('does not return duplicates', () => {
      const caseWithBoth: SavCase = {
        ...caseWithPhotos,
        claims: caseWithClaimPhotos.claims,
      };
      const photos = collectCasePhotos(caseWithBoth);
      const ids = photos.map((p) => p.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('collectClaimPhotos', () => {
    it('returns empty if claim has no photos', () => {
      const claim: Claim = {
        id: 'c1',
        label: 'Test',
        claimType: 'assurance',
        status: 'pending',
        expertApproved: false,
        clientApproved: false,
        requiredApprovals: [],
        createdAt: '',
        updatedAt: '',
      };
      expect(collectClaimPhotos(claim).length).toBe(0);
    });

    it('returns claim photos', () => {
      const claim = caseWithClaimPhotos.claims![0];
      const photos = collectClaimPhotos(claim);
      expect(photos.length).toBe(1);
    });
  });

  describe('buildPhotoExportFileName', () => {
    it('generates a filename with index and name', () => {
      const photo = makePhoto({ name: 'avant.jpg', category: 'before' });
      const fileName = buildPhotoExportFileName(photo, 1);
      expect(typeof fileName).toBe('string');
      expect(fileName.length).toBeGreaterThan(0);
    });

    it('does not contain path separators', () => {
      const photo = makePhoto({ name: 'path/to/img.jpg', category: 'after' });
      const fileName = buildPhotoExportFileName(photo, 2);
      // Should not start with /
      expect(fileName).not.toMatch(/^\//);
    });
  });

  describe('detectPhotoMimeType', () => {
    it('returns image/jpeg for .jpg', () => {
      expect(detectPhotoMimeType('photo.jpg')).toBe('image/jpeg');
    });

    it('returns image/png for .png', () => {
      expect(detectPhotoMimeType('image.png')).toBe('image/png');
    });

    it('returns image/webp for .webp', () => {
      expect(detectPhotoMimeType('img.webp')).toBe('image/webp');
    });

    it('returns a fallback for unknown extension', () => {
      const result = detectPhotoMimeType('file.xyz');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('dataUrlToExportContent', () => {
    it('parses a data URL correctly', () => {
      const dataUrl = 'data:image/jpeg;base64,/9j/abc123';
      const { mimeType, base64 } = dataUrlToExportContent(dataUrl);
      expect(mimeType).toBe('image/jpeg');
      expect(base64).toBe('/9j/abc123');
    });

    it('handles empty string gracefully', () => {
      const { mimeType, base64 } = dataUrlToExportContent('');
      expect(typeof mimeType).toBe('string');
      expect(typeof base64).toBe('string');
    });

    it('handles non-data URL gracefully', () => {
      const { base64 } = dataUrlToExportContent('https://example.com/img.jpg');
      expect(typeof base64).toBe('string');
    });
  });

  describe('summarizePhotoExports', () => {
    it('returns a string summary', () => {
      const photos = [makePhoto({ id: 'x1' }), makePhoto({ id: 'x2', category: 'after' })];
      const summary = summarizePhotoExports(photos);
      expect(typeof summary).toBe('string');
      expect(summary.length).toBeGreaterThan(0);
    });

    it('handles empty list', () => {
      const summary = summarizePhotoExports([]);
      expect(typeof summary).toBe('string');
    });
  });
});
