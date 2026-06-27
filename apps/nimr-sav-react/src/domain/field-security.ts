export type FieldSecuritySeverity = 'pass' | 'warning' | 'fail';

export interface FieldSecurityResult<T = string> {
  valid: boolean;
  value?: T;
  warnings: string[];
  errors: string[];
}

export interface FieldSecurityReport {
  score: number;
  status: FieldSecuritySeverity;
  checks: Array<{
    id: string;
    label: string;
    status: FieldSecuritySeverity;
    details: string;
  }>;
  warnings: string[];
  blockers: string[];
}

export interface PhotoAttachmentInput {
  name: string;
  type: string;
  size: number;
}

export const MAX_FREE_TEXT_LENGTH = 2000;
export const MAX_ESTIMATE_TEXT_LENGTH = 250_000;
export const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;
export const PHOTO_WARNING_SIZE_BYTES = 6 * 1024 * 1024;

const SPREADSHEET_FORMULA_PREFIX = /^[=+\-@]/;

function normalizeInput(value: unknown): string {
  return String(value ?? '');
}

function stripDangerousControlChars(value: string): string {
  return [...value]
    .map((char) => {
      const code = char.charCodeAt(0);
      const isAllowedWhitespace = code === 9 || code === 10 || code === 13;
      return (code < 32 && !isAllowedWhitespace) || code === 127 ? ' ' : char;
    })
    .join('');
}

export function escapeHtml(value: unknown): string {
  return normalizeInput(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

export function neutralizeSpreadsheetFormula(value: string): string {
  return SPREADSHEET_FORMULA_PREFIX.test(value.trimStart()) ? `'${value}` : value;
}

export function sanitizeFreeText(value: unknown, maxLength = MAX_FREE_TEXT_LENGTH): string {
  const normalized = stripDangerousControlChars(normalizeInput(value)).trim();
  const truncated = normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
  return neutralizeSpreadsheetFormula(escapeHtml(truncated));
}

export function sanitizeFileName(value: unknown, fallback = 'export'): string {
  const raw = normalizeInput(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split('')
    .map((char) => stripDangerousControlChars(char))
    .join('')
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\.\.+/g, '.')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);

  const safe = raw && raw !== '.' ? raw : fallback;
  return neutralizeSpreadsheetFormula(safe);
}

export function validateVinStrict(value: unknown): FieldSecurityResult {
  const vin = normalizeInput(value).trim().toUpperCase();
  const errors: string[] = [];

  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
    errors.push('VIN invalide : 17 caractères alphanumériques requis, sans I/O/Q.');
  }

  return {
    valid: errors.length === 0,
    value: vin,
    warnings: [],
    errors,
  };
}

export function validateImmatriculationStrict(value: unknown): FieldSecurityResult {
  const plate = normalizeInput(value).trim().toUpperCase();
  const errors: string[] = [];

  if (!plate) {
    errors.push('Immatriculation obligatoire.');
  }
  if (plate.length > 20) {
    errors.push('Immatriculation trop longue.');
  }
  if (plate && !/^[A-Z0-9 -]{2,20}$/.test(plate)) {
    errors.push('Immatriculation invalide : lettres, chiffres, espaces et tirets uniquement.');
  }

  return {
    valid: errors.length === 0,
    value: plate,
    warnings: [],
    errors,
  };
}

export function validatePhoneStrict(value: unknown): FieldSecurityResult {
  const phone = normalizeInput(value).trim();
  const digits = phone.replace(/\D/g, '');
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!/^[+0-9 ()-]{6,24}$/.test(phone) || digits.length < 8 || digits.length > 15) {
    errors.push('Téléphone invalide : format court, vide ou non téléphonique.');
  }
  if (phone && !phone.startsWith('+') && digits.length < 10) {
    warnings.push('Téléphone accepté mais à confirmer au format local terrain.');
  }

  return {
    valid: errors.length === 0,
    value: phone,
    warnings,
    errors,
  };
}

export function validateMileageStrict(value: unknown): FieldSecurityResult<number> {
  const mileage = Number(value);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Number.isFinite(mileage)) {
    errors.push('Kilométrage invalide : valeur numérique requise.');
  } else if (mileage < 0) {
    errors.push('Kilométrage invalide : valeur négative refusée.');
  } else if (mileage > 1_500_000) {
    warnings.push('Kilométrage très élevé : vérifier la saisie terrain.');
  }

  return {
    valid: errors.length === 0,
    value: Number.isFinite(mileage) ? mileage : undefined,
    warnings,
    errors,
  };
}

export function validateAmountStrict(value: unknown): FieldSecurityResult<number> {
  const amount = Number(value);
  const errors: string[] = [];

  if (!Number.isFinite(amount)) {
    errors.push('Montant invalide : valeur numérique requise.');
  } else if (amount < 0) {
    errors.push('Montant invalide : valeur négative refusée.');
  }

  return {
    valid: errors.length === 0,
    value: Number.isFinite(amount) ? amount : undefined,
    warnings: [],
    errors,
  };
}

export function validateEstimateTextInput(value: unknown): FieldSecurityResult {
  const raw = normalizeInput(value);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!raw.trim()) {
    errors.push('Texte de devis vide.');
  }
  if (raw.length > MAX_ESTIMATE_TEXT_LENGTH) {
    errors.push('Texte de devis trop volumineux pour import local.');
  }
  if (/<script[\s>]/i.test(raw)) {
    warnings.push('Balise script détectée et neutralisée avant import.');
  }

  return {
    valid: errors.length === 0,
    value: sanitizeFreeText(raw, MAX_ESTIMATE_TEXT_LENGTH),
    warnings,
    errors,
  };
}

export function validatePhotoAttachmentInput(input: PhotoAttachmentInput): FieldSecurityResult<PhotoAttachmentInput> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const safeName = sanitizeFileName(input.name || 'photo.jpg');
  const type = normalizeInput(input.type || '').trim().toLowerCase();
  const size = Number(input.size);

  if (!type.startsWith('image/')) {
    errors.push('Photo refusée : type MIME non image.');
  }
  if (!Number.isFinite(size) || size < 0) {
    errors.push('Photo refusée : taille invalide.');
  } else if (size > MAX_PHOTO_SIZE_BYTES) {
    errors.push('Photo refusée : taille excessive pour export local.');
  } else if (size > PHOTO_WARNING_SIZE_BYTES) {
    warnings.push('Photo volumineuse : export possible mais à surveiller.');
  }

  return {
    valid: errors.length === 0,
    value: {
      name: safeName,
      type: type || 'image/jpeg',
      size: Number.isFinite(size) ? size : 0,
    },
    warnings,
    errors,
  };
}

export function buildFieldSecurityReport(): FieldSecurityReport {
  const checks = [
    {
      id: 'free_text_sanitized',
      label: 'Textes libres neutralisés',
      status: sanitizeFreeText('<script>alert(1)</script>').includes('&lt;script&gt;') ? 'pass' as const : 'fail' as const,
      details: 'Les caractères HTML dangereux sont échappés dans les textes libres.',
    },
    {
      id: 'file_names_sanitized',
      label: 'Noms de fichiers nettoyés',
      status: sanitizeFileName('../devis<script>.html') === 'devis_script_.html' ? 'pass' as const : 'warning' as const,
      details: 'Les séparateurs de chemin et caractères dangereux sont remplacés.',
    },
    {
      id: 'vin_strict',
      label: 'VIN strict',
      status: validateVinStrict('VF1ABCDEF12345678').valid ? 'pass' as const : 'fail' as const,
      details: 'Le VIN requiert 17 caractères valides.',
    },
    {
      id: 'negative_numbers_refused',
      label: 'Valeurs négatives refusées',
      status: !validateMileageStrict(-1).valid && !validateAmountStrict(-1).valid ? 'pass' as const : 'fail' as const,
      details: 'Kilométrage et montants négatifs sont bloqués.',
    },
    {
      id: 'photo_guard',
      label: 'Pièces jointes photo contrôlées',
      status: !validatePhotoAttachmentInput({ name: 'malware.txt', type: 'text/plain', size: 12 }).valid ? 'pass' as const : 'fail' as const,
      details: 'Les types non image sont refusés.',
    },
  ];

  const blockers = checks.filter((check) => check.status === 'fail').map((check) => check.details);
  const warnings = checks.filter((check) => check.status === 'warning').map((check) => check.details);
  const score = Math.round(((checks.length - blockers.length) / checks.length) * 100);

  return {
    score,
    status: blockers.length > 0 ? 'fail' : warnings.length > 0 ? 'warning' : 'pass',
    checks,
    warnings,
    blockers,
  };
}
