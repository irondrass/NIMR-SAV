/**
 * Validates that all fields are strictly fictive demo data.
 * Returns an error string if validation fails, or null if valid.
 */
export function validateFictiveFields(fields: {
  immatriculation: string;
  vin: string;
  clientName: string;
  telephone: string;
}): string | null {
  const { immatriculation, vin, clientName, telephone } = fields;

  if (!immatriculation.startsWith('DEMO-')) {
    return "L'immatriculation doit être fictive et commencer par 'DEMO-'.";
  }
  if (!vin.startsWith('VIN-DEMO-')) {
    return "Le VIN doit être fictif et commencer par 'VIN-DEMO-'.";
  }
  if (!clientName.startsWith('Client Démo')) {
    return "Le nom du client doit être fictif et commencer par 'Client Démo'.";
  }
  // Enforces phone starting with 0000 followed by digits
  if (!/^0000\d*$/.test(telephone)) {
    return "Le numéro de téléphone doit être fictif, composé de chiffres et commencer par '0000' (ex: 00000000).";
  }

  return null;
}
