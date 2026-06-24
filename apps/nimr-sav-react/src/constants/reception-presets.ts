export const RECEPTION_PRESETS = [
  'Entretien périodique',
  'Contrôle 2500 km',
  'Bruit freinage',
  'Bruit train avant',
  'Bruit train arrière',
  'Fuite huile',
  'Fuite liquide refroidissement',
  'Diagnostic voyant tableau',
  'Problème climatisation',
  'Demande devis carrosserie',
] as const;
export type ReceptionPreset = typeof RECEPTION_PRESETS[number];
