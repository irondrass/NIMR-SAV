/**
 * Validates that all fields have reasonable values.
 * Returns an error string if validation fails, or null if valid.
 */
export function validateFictiveFields(fields: {
  immatriculation: string;
  vin?: string;
  clientName: string;
  telephone?: string;
}): string | null {
  const { immatriculation, vin, clientName, telephone } = fields;

  if (!clientName || !clientName.trim()) {
    return "Le nom du client est requis.";
  }
  if (!immatriculation || !immatriculation.trim()) {
    return "L'immatriculation est requise.";
  }

  // Telephone is optional, format check if present
  if (telephone && telephone.trim() !== '') {
    const cleanedPhone = telephone.trim();
    if (!/^[0-9+\s\-()]{4,20}$/.test(cleanedPhone)) {
      return "Le numéro de téléphone n'est pas valide.";
    }
  }

  // VIN is optional, check format if present
  if (vin && vin.trim() !== '') {
    const cleanedVin = vin.trim();
    if (!/^[A-HJ-NPR-Z0-9]{5,30}$/i.test(cleanedVin)) {
      return "Le VIN doit être composé de caractères alphanumériques valides.";
    }
  }

  return null;
}
