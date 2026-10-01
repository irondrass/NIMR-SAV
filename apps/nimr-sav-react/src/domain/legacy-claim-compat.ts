import type { Claim } from './sav-case';

export type LegacyClaimType =
  | 'assurance'
  | 'client'
  | 'vidange'
  | 'mechanical_client'
  | 'electrical_client'
  | 'diagnostic'
  | 'garantie';

export type LegacyClaimStatus =
  | 'draft'
  | 'expert_pending'
  | 'client_pending'
  | 'approved'
  | 'refused'
  | 'planned'
  | 'done';

type CompatOk<T extends string> = { ok: true; value: T };
type CompatError = {
  ok: false;
  code: 'unsupported_type' | 'unsupported_status' | 'legacy_only_status';
  source: string;
  reason: string;
};
export type ClaimCompatResult<T extends string> = CompatOk<T> | CompatError;

const CUSTOMER_LEGACY_TYPES = new Set<LegacyClaimType>([
  'client',
  'vidange',
  'mechanical_client',
  'electrical_client',
  'diagnostic',
]);

export function mapLegacyClaimTypeToV24(source: string): ClaimCompatResult<Claim['claimType']> {
  if (source === 'assurance') return { ok: true, value: 'insurance' };
  if (source === 'garantie') return { ok: true, value: 'warranty' };
  if (CUSTOMER_LEGACY_TYPES.has(source as LegacyClaimType)) return { ok: true, value: 'customer' };
  return {
    ok: false,
    code: 'unsupported_type',
    source,
    reason: `Type legacy "${source}" non pris en charge par React v24.`,
  };
}

export function mapV24ClaimTypeToLegacy(
  source: Claim['claimType'],
  preferredLegacyType?: string,
): ClaimCompatResult<LegacyClaimType> {
  if (source === 'insurance') return { ok: true, value: 'assurance' };
  if (source === 'warranty') return { ok: true, value: 'garantie' };
  if (source === 'customer') {
    if (preferredLegacyType && CUSTOMER_LEGACY_TYPES.has(preferredLegacyType as LegacyClaimType)) {
      return { ok: true, value: preferredLegacyType as LegacyClaimType };
    }
    return { ok: true, value: 'client' };
  }
  return {
    ok: false,
    code: 'unsupported_type',
    source,
    reason: `Type v24 "${source}" sans équivalent legacy sûr.`,
  };
}

export function mapLegacyClaimStatusToV24(source: string): ClaimCompatResult<Claim['status']> {
  if (source === 'refused') return { ok: true, value: 'rejected' };
  if (['draft', 'expert_pending', 'client_pending', 'approved'].includes(source)) {
    return { ok: true, value: source as Claim['status'] };
  }
  if (source === 'planned' || source === 'done') {
    return {
      ok: false,
      code: 'legacy_only_status',
      source,
      reason: `Statut legacy "${source}" sans état v24 équivalent : conversion refusée.`,
    };
  }
  return {
    ok: false,
    code: 'unsupported_status',
    source,
    reason: `Statut legacy "${source}" inconnu de React v24.`,
  };
}

export function mapV24ClaimStatusToLegacy(source: Claim['status']): ClaimCompatResult<LegacyClaimStatus> {
  if (source === 'rejected') return { ok: true, value: 'refused' };
  if (['draft', 'expert_pending', 'client_pending', 'approved'].includes(source)) {
    return { ok: true, value: source as LegacyClaimStatus };
  }
  return {
    ok: false,
    code: 'unsupported_status',
    source,
    reason: `Statut v24 "${source}" sans équivalent legacy sûr.`,
  };
}
