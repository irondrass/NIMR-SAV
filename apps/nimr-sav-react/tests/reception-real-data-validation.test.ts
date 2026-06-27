import { describe, expect, it } from 'vitest';
import { validateFictiveFields } from '../src/domain/validation-rules';
import { APP_VERSION } from '../src/constants/version';

describe('Reception Real Data Validation (v24.0.0-alpha.17)', () => {
  it('verifies APP_VERSION is exactly v24.0.0-alpha.17', () => {
    expect(APP_VERSION).toBe('v24.0.0-alpha.17');
  });

  it('accepts realistic workshop data without DEMO prefix', () => {
    const res = validateFictiveFields({
      immatriculation: '1234-AB-56',
      vin: 'KM4JN51BP7U8888',
      clientName: 'Société NIMR Transport',
      telephone: '+21671000000',
    });
    expect(res).toBeNull();
  });

  it('rejects critical empty fields', () => {
    const emptyClient = validateFictiveFields({
      immatriculation: '1234-AB-56',
      vin: 'KM4JN51BP7U8888',
      clientName: '',
      telephone: '+21671000000',
    });
    expect(emptyClient).toContain('Le nom du client est requis');

    const emptyPlate = validateFictiveFields({
      immatriculation: '',
      vin: 'KM4JN51BP7U8888',
      clientName: 'NIMR',
      telephone: '+21671000000',
    });
    expect(emptyPlate).toContain("L'immatriculation est requise");
  });
});
