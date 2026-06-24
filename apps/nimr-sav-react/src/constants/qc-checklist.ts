import { QcChecklistItem } from '../domain/sav-case';

export const DEMO_QC_CHECKLIST: QcChecklistItem[] = [
  { id: 'qc-road-test', label: 'Essai routier effectué', checked: false, required: true },
  { id: 'qc-no-warnings', label: 'Absence de voyant défaut', checked: false, required: true },
  { id: 'qc-fluids', label: 'Niveau fluides contrôlé', checked: false, required: true },
  { id: 'qc-safety', label: 'Serrage / sécurité contrôlé', checked: false, required: true },
  { id: 'qc-cleaning', label: 'Nettoyage véhicule contrôlé', checked: false, required: false },
  { id: 'qc-docs', label: 'Documents OR contrôlés', checked: false, required: true },
];
