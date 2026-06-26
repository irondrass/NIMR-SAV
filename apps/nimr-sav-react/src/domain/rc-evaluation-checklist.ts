export type RcEvaluationCategory =
  | 'technical'
  | 'sav_business'
  | 'security_data'
  | 'field_ux'
  | 'roles_permissions'
  | 'automated_tests'
  | 'manual_acceptance';

export interface RcEvaluationChecklistItem {
  id: string;
  label: string;
  required: boolean;
  evidence: string;
}

export interface RcEvaluationChecklistSection {
  id: RcEvaluationCategory;
  title: string;
  items: readonly RcEvaluationChecklistItem[];
}

export interface GoNoGoCriteria {
  go: readonly string[];
  noGo: readonly string[];
}

export function getRcEvaluationChecklist(): readonly RcEvaluationChecklistSection[] {
  return [
    {
      id: 'technical',
      title: 'Checklist technique',
      items: [
        {
          id: 'fresh_github_clone',
          label: 'Clone frais GitHub vérifié avant toute décision de tag rc.1',
          required: true,
          evidence: 'git status propre, commit attendu présent, aucun tag local automatique',
        },
        {
          id: 'deterministic_install',
          label: 'Installation reproductible rc.1 avec npm ci',
          required: true,
          evidence: 'package-lock aligné sur 24.0.0-alpha.15',
        },
        {
          id: 'build_artifact',
          label: 'Build Vite/TypeScript sans erreur',
          required: true,
          evidence: 'npm run build terminé avec succès',
        },
      ],
    },
    {
      id: 'sav_business',
      title: 'Checklist métier SAV',
      items: [
        {
          id: 'alpha12_acceptance_flow',
          label: 'Recette métier alpha.12 conservée sous rc.1',
          required: true,
          evidence: 'Simulation multi-dossiers validée sans mutation de consultation',
        },
        {
          id: 'quality_before_delivery',
          label: 'Livraison bloquée tant que la qualité n’est pas approuvée',
          required: true,
          evidence: 'Transition vers livraison impossible avant qualité approuvée',
        },
        {
          id: 'delivered_forward_only',
          label: 'Dossier livré limité à la clôture comme étape suivante',
          required: true,
          evidence: 'Matrice de transitions delivered → closed uniquement',
        },
      ],
    },
    {
      id: 'security_data',
      title: 'Checklist sécurité / données',
      items: [
        {
          id: 'public_data_empty',
          label: 'Données véhicules publiques maintenues vides',
          required: true,
          evidence: 'data/vehicles.json reste strictement []',
        },
        {
          id: 'no_real_customer_data',
          label: 'Aucune donnée client réelle ajoutée aux scénarios',
          required: true,
          evidence: 'Clients Démo A/B et identifiants véhicules fictifs uniquement',
        },
        {
          id: 'no_external_runtime',
          label: 'Aucun runtime externe ajouté à React v24',
          required: true,
          evidence: 'Sans backend, sans Supabase, sans service worker React actif',
        },
      ],
    },
    {
      id: 'field_ux',
      title: 'Checklist UX terrain',
      items: [
        {
          id: 'role_screens_understandable',
          label: 'Écrans par rôle lisibles pour réception, atelier, qualité, livraison et supervision',
          required: true,
          evidence: 'Smoke navigateur et tests UX par rôle',
        },
        {
          id: 'blocked_states_visible',
          label: 'États bloqués visibles sans action ambiguë',
          required: true,
          evidence: 'waiting_parts, quality_rework et quality_pending couverts',
        },
        {
          id: 'manual_field_validation',
          label: 'Validation manuelle terrain requise avant décision de tag rc.1',
          required: true,
          evidence: 'Contrôle humain GO / NO-GO non automatisé',
        },
      ],
    },
    {
      id: 'roles_permissions',
      title: 'Checklist rôles et permissions',
      items: [
        {
          id: 'official_roles_only',
          label: 'Uniquement les huit rôles officiels',
          required: true,
          evidence: 'Matrice de gouvernance stable',
        },
        {
          id: 'consultation_roles_passive',
          label: 'Direction, Admin et Lecture seule consultent sans mutation métier',
          required: true,
          evidence: 'Aucun log de workflow généré par consultation',
        },
        {
          id: 'delivery_role_boundaries',
          label: 'Livraison réservée aux actions de remise client',
          required: true,
          evidence: 'Préparation, preuve et livraison isolées du pilotage',
        },
      ],
    },
    {
      id: 'automated_tests',
      title: 'Checklist tests automatisés',
      items: [
        {
          id: 'lint',
          label: 'Lint sans avertissement',
          required: true,
          evidence: 'npm run lint',
        },
        {
          id: 'unit_integration_tests',
          label: 'Tests unitaires et intégration v24 complets',
          required: true,
          evidence: 'npm test',
        },
        {
          id: 'security_audit',
          label: 'Audit dépendances sans correction forcée',
          required: true,
          evidence: 'npm audit avec registre npm',
        },
      ],
    },
    {
      id: 'manual_acceptance',
      title: 'Checklist validation manuelle',
      items: [
        {
          id: 'workshop_walkthrough',
          label: 'Parcours réception → atelier → qualité → livraison rejoué avec utilisateurs métier',
          required: true,
          evidence: 'Compte-rendu de validation terrain attendu',
        },
        {
          id: 'go_no_go_meeting',
          label: 'Décision GO / NO-GO humaine avant tag rc.1 éventuel',
          required: true,
          evidence: 'Arbitrage explicite hors automatisation',
        },
        {
          id: 'no_auto_publication',
          label: 'Aucun push ni tag automatique depuis la préparation rc.1',
          required: true,
          evidence: 'Publication volontaire séparée si décision humaine favorable',
        },
      ],
    },
  ];
}

export function getManualAcceptanceChecklist(): readonly RcEvaluationChecklistItem[] {
  const manualSection = getRcEvaluationChecklist().find(
    (section) => section.id === 'manual_acceptance',
  );

  return manualSection?.items ?? [];
}

export function getKnownLimitationsBeforeRc(): readonly string[] {
  return [
    'rc.1 est une Release Candidate interne et ne correspond pas à la version finale.',
    'Validation manuelle terrain requise avant tout arbitrage de tag rc.1.',
    'Le pilote stable reste v23.2.6 jusqu’à décision humaine explicite.',
    'Aucun backend, aucun Supabase et aucun service worker React actif dans cette étape.',
    'Les scénarios utilisent uniquement des données fictives et ne remplacent pas une recette utilisateur complète.',
    'Aucun déploiement production ne doit être lancé depuis cette préparation RC interne.',
  ];
}

export function getGoNoGoCriteriaForRcEvaluation(): GoNoGoCriteria {
  return {
    go: [
      'Tous les tests automatisés v24 passent sur clone frais.',
      'Les tests de non-régression v23.2.6 passent sans modification des fichiers critiques v23.x.',
      'Le smoke navigateur ne remonte aucune erreur console bloquante.',
      'La validation manuelle terrain confirme les parcours SAV principaux.',
      'La décision GO / NO-GO est actée par un humain responsable avant tag rc.1 éventuel.',
    ],
    noGo: [
      'Un rôle ou un statut non officiel apparaît dans la matrice.',
      'Une livraison devient possible sans qualité approuvée.',
      'Une consultation Direction, Admin ou Lecture seule modifie un dossier.',
      'Une dépendance runtime externe est ajoutée à React v24.',
      'Des données client réelles ou véhicules publiques non vides sont détectées.',
      'Un tag ou push automatique est demandé depuis cette préparation rc.1.',
      'Un déploiement production est demandé avant validation terrain finale.',
    ],
  };
}
