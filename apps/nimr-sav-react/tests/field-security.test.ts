import { describe, expect, it } from 'vitest';
import {
  buildFieldSecurityReport,
  sanitizeFileName,
  sanitizeFreeText,
  validateAmountStrict,
  validateEstimateTextInput,
  validateImmatriculationStrict,
  validateMileageStrict,
  validatePhoneStrict,
  validatePhotoAttachmentInput,
  validateVinStrict,
} from '../src/domain/field-security';

describe('Field security alpha.19', () => {
  it('sanitizes dangerous free text and export file names', () => {
    const text = sanitizeFreeText('<script>alert("x")</script>');
    expect(text).not.toContain('<script>');
    expect(text).toContain('&lt;script&gt;');

    const fileName = sanitizeFileName('../=devis<script>.html');
    expect(fileName).not.toContain('/');
    expect(fileName).not.toContain('<');
    expect(fileName.startsWith('=')).toBe(false);
  });

  it('rejects invalid VIN and plate inputs cleanly', () => {
    expect(validateVinStrict('123').valid).toBe(false);
    expect(validateVinStrict('VF1ABCDEF12345678').valid).toBe(true);
    expect(validateImmatriculationStrict('').valid).toBe(false);
    expect(validateImmatriculationStrict('AA-123-AA-TOO-LONG-999').valid).toBe(false);
    expect(validateImmatriculationStrict('AA-123-AA').valid).toBe(true);
  });

  it('validates phone, mileage and amount boundaries', () => {
    expect(validatePhoneStrict('abc').valid).toBe(false);
    expect(validatePhoneStrict('+216 22 333 444').valid).toBe(true);
    expect(validateMileageStrict(-1).valid).toBe(false);
    expect(validateMileageStrict(12000).valid).toBe(true);
    expect(validateAmountStrict(-5).valid).toBe(false);
    expect(validateAmountStrict(120.5).valid).toBe(true);
  });

  it('validates estimate text and photo attachments', () => {
    const estimate = validateEstimateTextInput('<script>alert(1)</script>Total TTC 120');
    expect(estimate.valid).toBe(true);
    expect(estimate.warnings.length).toBeGreaterThan(0);

    expect(validatePhotoAttachmentInput({ name: 'bad.txt', type: 'text/plain', size: 100 }).valid).toBe(false);
    expect(validatePhotoAttachmentInput({ name: 'huge.jpg', type: 'image/jpeg', size: 20 * 1024 * 1024 }).valid).toBe(false);
    expect(validatePhotoAttachmentInput({ name: 'ok.jpg', type: 'image/jpeg', size: 1200 }).valid).toBe(true);
  });

  it('builds a field security report for Admin readiness', () => {
    const report = buildFieldSecurityReport();
    expect(report.score).toBeGreaterThanOrEqual(80);
    expect(report.blockers).toHaveLength(0);
  });
});
