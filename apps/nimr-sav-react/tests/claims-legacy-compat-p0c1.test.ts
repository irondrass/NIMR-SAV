import { describe, expect, it } from 'vitest';
import {
  mapLegacyClaimStatusToV24,
  mapLegacyClaimTypeToV24,
  mapV24ClaimStatusToLegacy,
  mapV24ClaimTypeToLegacy,
} from '../src/domain/legacy-claim-compat';

describe('KHA-76 P0c.1 — v23/v24 claim compatibility', () => {
  it('maps canonical legacy types explicitly', () => {
    expect(mapLegacyClaimTypeToV24('assurance')).toMatchObject({ ok: true, value: 'insurance' });
    expect(mapLegacyClaimTypeToV24('garantie')).toMatchObject({ ok: true, value: 'warranty' });
    for (const type of ['client', 'vidange', 'mechanical_client', 'electrical_client', 'diagnostic']) {
      expect(mapLegacyClaimTypeToV24(type)).toMatchObject({ ok: true, value: 'customer' });
    }
  });

  it('never invents a legacy type for v24 internal/mixed', () => {
    expect(mapV24ClaimTypeToLegacy('internal')).toMatchObject({ ok: false, code: 'unsupported_type' });
    expect(mapV24ClaimTypeToLegacy('mixed')).toMatchObject({ ok: false, code: 'unsupported_type' });
  });

  it('preserves a compatible customer legacy subtype when supplied', () => {
    expect(mapV24ClaimTypeToLegacy('customer', 'mechanical_client')).toMatchObject({
      ok: true,
      value: 'mechanical_client',
    });
    expect(mapV24ClaimTypeToLegacy('customer')).toMatchObject({ ok: true, value: 'client' });
  });

  it('maps refused/rejected in both directions', () => {
    expect(mapLegacyClaimStatusToV24('refused')).toMatchObject({ ok: true, value: 'rejected' });
    expect(mapV24ClaimStatusToLegacy('rejected')).toMatchObject({ ok: true, value: 'refused' });
  });

  it('keeps shared workflow statuses exact', () => {
    for (const status of ['draft', 'expert_pending', 'client_pending', 'approved'] as const) {
      expect(mapLegacyClaimStatusToV24(status)).toMatchObject({ ok: true, value: status });
      expect(mapV24ClaimStatusToLegacy(status)).toMatchObject({ ok: true, value: status });
    }
  });

  it('fails explicitly for planned/done instead of coercing them to draft', () => {
    for (const status of ['planned', 'done'] as const) {
      expect(mapLegacyClaimStatusToV24(status)).toMatchObject({
        ok: false,
        code: 'legacy_only_status',
        source: status,
      });
    }
  });

  it('fails explicitly for v24-only statuses with no legacy equivalent', () => {
    for (const status of ['estimate_pending', 'cancelled'] as const) {
      expect(mapV24ClaimStatusToLegacy(status)).toMatchObject({
        ok: false,
        code: 'unsupported_status',
        source: status,
      });
    }
  });

  it('rejects unknown runtime values instead of defaulting', () => {
    expect(mapLegacyClaimStatusToV24('future_status')).toMatchObject({ ok: false });
    expect(mapLegacyClaimTypeToV24('future_type')).toMatchObject({ ok: false });
  });
});
