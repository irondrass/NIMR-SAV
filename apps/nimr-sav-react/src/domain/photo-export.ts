import { SavCase, Claim, Estimate, CasePhoto } from './sav-case';
import { sanitizeFileName, validatePhotoAttachmentInput } from './field-security';

export function normalizePhotoAttachment(
  name: string,
  type: string,
  size: number,
  category: 'before' | 'during' | 'after' | 'claim' | 'estimate' | 'quality' | 'delivery' | 'other',
  dataUrl?: string,
  relatedClaimId?: string,
  relatedEstimateId?: string
): CasePhoto {
  const validated = validatePhotoAttachmentInput({ name, type: type || 'image/jpeg', size });
  if (!validated.valid) {
    throw new Error(validated.errors.join(' '));
  }
  const safePhoto = validated.value;

  return {
    id: `pho-${Math.random().toString(36).substr(2, 9)}`,
    name: safePhoto?.name || sanitizeFileName(name || 'photo.jpg'),
    type: safePhoto?.type || 'image/jpeg',
    size: safePhoto?.size || 0,
    category,
    dataUrl,
    createdAt: new Date().toISOString(),
    relatedClaimId,
    relatedEstimateId,
  };
}

export function collectCasePhotos(c: SavCase): CasePhoto[] {
  const list: CasePhoto[] = [];

  // 1. Photos from Case directly
  if (c.photos) {
    list.push(...c.photos);
  }

  // 2. Photos from Claims
  (c.claims || []).forEach(cl => {
    if (cl.photos) {
      list.push(...cl.photos);
    }
    if (cl.estimate && cl.estimate.photos) {
      list.push(...cl.estimate.photos);
    }
  });

  return list;
}

export function collectClaimPhotos(cl: Claim): CasePhoto[] {
  return cl.photos || [];
}

export function collectEstimatePhotos(est: Estimate): CasePhoto[] {
  return est.photos || [];
}

export function buildPhotoExportFileName(photo: CasePhoto, index: number): string {
  const cat = photo.category || 'other';
  const prefix = cat.charAt(0).toUpperCase() + cat.slice(1);
  const paddedIndex = String(index).padStart(2, '0');

  const cleanName = sanitizeFileName(photo.name || 'photo.jpg');

  return `${prefix}_${paddedIndex}_${cleanName}`;
}

export function detectPhotoMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png': return 'image/png';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'bmp': return 'image/bmp';
    case 'jpg':
    case 'jpeg':
    default:
      return 'image/jpeg';
  }
}

export function dataUrlToExportContent(dataUrl: string): { mimeType: string; base64: string } {
  if (!dataUrl.startsWith('data:')) {
    return { mimeType: 'image/jpeg', base64: dataUrl };
  }
  const parts = dataUrl.split(';base64,');
  const mimeType = parts[0].replace('data:', '');
  const base64 = parts[1] || '';
  return { mimeType, base64 };
}

export function summarizePhotoExports(photos: CasePhoto[]): string {
  if (photos.length === 0) return 'Aucune photo rattachée.';
  return photos.map((p, i) => `${i + 1}. ${p.name} (${p.category}) - ${(p.size / 1024).toFixed(1)} KB`).join('\n');
}
