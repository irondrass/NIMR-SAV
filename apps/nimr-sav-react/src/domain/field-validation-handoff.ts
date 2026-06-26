import type { Role } from '../types';
import type { CaseStatus } from './case-status';

export interface FieldValidationPlanStep {
  id: string;
  title: string;
  owner: Role;
  objective: string;
  evidence: string;
}

export interface RoleManualValidationStep {
  role: Role;
  title: string;
  steps: readonly string[];
  expectedEvidence: string;
}

export interface WorkshopDaySimulationItem {
  id: string;
  title: string;
  involvedRoles: readonly Role[];
  expectedStatuses: readonly CaseStatus[];
  evidence: string;
}

export interface BlockingIssueChecklistItem {
  id: string;
  label: string;
  severity: 'blocking';
  expectedAction: string;
}

export interface FinalRcDecisionTemplate {
  title: string;
  options: readonly {
    id: 'go_rc1_tag' | 'no_go_rc1' | 'go_with_reservations' | 'corrective_rc1_or_rc2';
    label: string;
    meaning: string;
    requiredEvidence: string;
  }[];
  mandatorySignoffs: readonly Role[];
  notes: readonly string[];
}

export function getFieldValidationPlan(): readonly FieldValidationPlanStep[] {
  return [
    {
      id: 'prepare_workshop_day',
      title: 'Préparer la journée atelier simulée',
      owner: 'chef-atelier',
      objective: 'Sélectionner plusieurs dossiers fictifs et répartir les rôles terrain.',
      evidence: 'Liste des dossiers fictifs, rôles affectés et scénario horaire validés.',
    },
    {
      id: 'run_end_to_end_flow',
      title: 'Rejouer le flux SAV complet',
      owner: 'reception',
      objective: 'Faire passer les dossiers de la réception à la livraison avec cas bloqués.',
      evidence: 'Transitions attendues observées et anomalies consignées.',
    },
    {
      id: 'observe_supervision',
      title: 'Observer la supervision passive',
      owner: 'directeur-sav',
      objective: 'Confirmer que Direction, Admin et Lecture seule consultent sans mutation métier.',
      evidence: 'Aucune modification de dossier ni log de workflow après consultation.',
    },
    {
      id: 'decide_go_no_go',
      title: 'Tenir la décision finale rc.1',
      owner: 'admin',
      objective: 'Acter GO / NO-GO humain sur la base des preuves locales et terrain.',
      evidence: 'Décision signée avec réserves éventuelles et suite corrective choisie.',
    },
  ];
}

export function getRoleBasedManualValidationSteps(): readonly RoleManualValidationStep[] {
  return [
    {
      role: 'reception',
      title: 'Réception SAV',
      steps: [
        'Créer plusieurs dossiers fictifs.',
        'Qualifier les informations véhicule fictives.',
        'Vérifier que les dossiers reçus apparaissent dans le flux atelier.',
      ],
      expectedEvidence: 'Dossiers reçus traçables sans donnée client réelle.',
    },
    {
      role: 'chef-atelier',
      title: 'Chef Atelier',
      steps: [
        'Affecter les dossiers aux techniciens.',
        'Planifier les priorités et gérer un dossier en attente pièces.',
        'Renvoyer un dossier en reprise atelier après rejet qualité.',
      ],
      expectedEvidence: 'Affectations et statuts atelier cohérents.',
    },
    {
      role: 'technicien',
      title: 'Technicien',
      steps: [
        'Démarrer une intervention affectée.',
        'Terminer les tâches atelier prévues.',
        'Confirmer qu’un technicien non affecté ne modifie pas le dossier.',
      ],
      expectedEvidence: 'Interventions terminées uniquement sur dossiers autorisés.',
    },
    {
      role: 'qualite',
      title: 'Qualité',
      steps: [
        'Contrôler un dossier terminé.',
        'Rejeter un dossier avec motif puis déclencher reprise.',
        'Approuver un dossier conforme avant livraison.',
      ],
      expectedEvidence: 'Rejet, reprise et approbation qualité traçables.',
    },
    {
      role: 'livraison',
      title: 'Livraison',
      steps: [
        'Vérifier qu’un dossier sans qualité approuvée reste bloqué.',
        'Préparer un dossier approuvé.',
        'Enregistrer preuve et remise client fictive.',
      ],
      expectedEvidence: 'Livraison possible uniquement après qualité approuvée.',
    },
    {
      role: 'directeur-sav',
      title: 'Directeur SAV',
      steps: [
        'Consulter KPIs, alertes et dossiers.',
        'Vérifier que les actions de livraison ne sont pas disponibles.',
        'Confirmer qu’aucune mutation métier n’est produite.',
      ],
      expectedEvidence: 'Consultation de pilotage passive.',
    },
    {
      role: 'admin',
      title: 'Admin',
      steps: [
        'Contrôler la matrice rôles/permissions.',
        'Lire la readiness et les invariants système.',
        'Vérifier que la décision GO / NO-GO reste humaine.',
      ],
      expectedEvidence: 'Gouvernance consultée sans publication automatique.',
    },
    {
      role: 'lecture-seule',
      title: 'Lecture seule',
      steps: [
        'Consulter les dossiers et l’historique.',
        'Tenter de trouver une action d’écriture disponible.',
        'Confirmer qu’aucune modification n’est possible.',
      ],
      expectedEvidence: 'Lecture strictement passive.',
    },
  ];
}

export function getWorkshopDaySimulationChecklist(): readonly WorkshopDaySimulationItem[] {
  return [
    {
      id: 'multiple_receptions',
      title: 'Réception de plusieurs dossiers',
      involvedRoles: ['reception'],
      expectedStatuses: ['draft', 'received'],
      evidence: 'Dossiers fictifs créés et reçus.',
    },
    {
      id: 'workshop_assignment',
      title: 'Affectation atelier',
      involvedRoles: ['chef-atelier', 'technicien'],
      expectedStatuses: ['diagnosis', 'repair'],
      evidence: 'Techniciens affectés et priorités visibles.',
    },
    {
      id: 'technician_intervention',
      title: 'Intervention technicien',
      involvedRoles: ['technicien'],
      expectedStatuses: ['repair', 'work_completed'],
      evidence: 'Tâches terminées avant contrôle qualité.',
    },
    {
      id: 'waiting_parts_case',
      title: 'Attente pièces',
      involvedRoles: ['chef-atelier'],
      expectedStatuses: ['waiting_parts'],
      evidence: 'Dossier bloqué sans livraison possible.',
    },
    {
      id: 'quality_rejection_rework',
      title: 'Rejet qualité puis reprise atelier',
      involvedRoles: ['qualite', 'chef-atelier', 'technicien'],
      expectedStatuses: ['quality_pending', 'quality_rejected', 'quality_rework'],
      evidence: 'Motif de rejet et reprise documentés.',
    },
    {
      id: 'quality_approval',
      title: 'Approbation qualité',
      involvedRoles: ['qualite'],
      expectedStatuses: ['quality_approved'],
      evidence: 'Checklist requise validée.',
    },
    {
      id: 'customer_delivery',
      title: 'Livraison client',
      involvedRoles: ['livraison'],
      expectedStatuses: ['ready_delivery', 'delivered'],
      evidence: 'Preuve et destinataire fictifs renseignés.',
    },
    {
      id: 'passive_consultation',
      title: 'Consultation direction/admin/lecture seule',
      involvedRoles: ['directeur-sav', 'admin', 'lecture-seule'],
      expectedStatuses: ['received', 'repair', 'quality_pending', 'delivered'],
      evidence: 'Aucune mutation après consultation.',
    },
  ];
}

export function getBlockingIssuesChecklist(): readonly BlockingIssueChecklistItem[] {
  return [
    {
      id: 'case_loss',
      label: 'Perte de dossier pendant le parcours terrain',
      severity: 'blocking',
      expectedAction: 'Stopper la décision rc.1 et ouvrir une correction.',
    },
    {
      id: 'readonly_mutation',
      label: 'Mutation par lecture seule ou supervision passive',
      severity: 'blocking',
      expectedAction: 'Bloquer la décision et corriger la matrice permissions.',
    },
    {
      id: 'delivery_without_quality',
      label: 'Livraison sans qualité approuvée',
      severity: 'blocking',
      expectedAction: 'Bloquer la décision et corriger les garde-fous livraison.',
    },
    {
      id: 'inconsistent_status',
      label: 'Statut incohérent ou transition non officielle',
      severity: 'blocking',
      expectedAction: 'Analyser la timeline et corriger le workflow.',
    },
    {
      id: 'unauthorized_role',
      label: 'Rôle non autorisé capable de modifier un dossier',
      severity: 'blocking',
      expectedAction: 'Corriger les permissions avant nouveau passage terrain.',
    },
    {
      id: 'real_customer_data',
      label: 'Donnée client réelle détectée',
      severity: 'blocking',
      expectedAction: 'Supprimer la donnée et auditer les sources de test.',
    },
    {
      id: 'critical_console_error',
      label: 'Erreur console critique',
      severity: 'blocking',
      expectedAction: 'Corriger puis relancer le smoke navigateur.',
    },
    {
      id: 'test_build_audit_failure',
      label: 'Échec test, build ou audit',
      severity: 'blocking',
      expectedAction: 'Corriger puis relancer toute la validation locale.',
    },
  ];
}

export function getFinalRcDecisionTemplate(): FinalRcDecisionTemplate {
  return {
    title: 'Décision finale rc.1 après validation terrain',
    options: [
      {
        id: 'go_rc1_tag',
        label: 'GO pour tag rc.1',
        meaning: 'Les preuves locales, clone frais et terrain sont acceptées.',
        requiredEvidence: 'Validation complète signée et aucun bloqueur ouvert.',
      },
      {
        id: 'no_go_rc1',
        label: 'NO-GO rc.1',
        meaning: 'Un bloqueur empêche la décision.',
        requiredEvidence: 'Liste des bloqueurs et propriétaire de correction.',
      },
      {
        id: 'go_with_reservations',
        label: 'GO avec réserves',
        meaning: 'Aucun bloqueur critique, mais réserves suivies explicitement.',
        requiredEvidence: 'Réserves datées, acceptées et non bloquantes.',
      },
      {
        id: 'corrective_rc1_or_rc2',
        label: 'Retour corrective rc.1 ou rc.2 selon cas',
        meaning: 'Correction locale ou nouvelle candidate selon l’impact.',
        requiredEvidence: 'Analyse d’impact et décision de périmètre.',
      },
    ],
    mandatorySignoffs: [
      'reception',
      'chef-atelier',
      'technicien',
      'qualite',
      'livraison',
      'directeur-sav',
      'admin',
      'lecture-seule',
    ],
    notes: [
      'Le tag rc.1 éventuel reste une décision humaine séparée.',
      'Aucun déploiement production ne fait partie de ce handoff.',
      'La version finale v24.0.0 reste hors périmètre.',
    ],
  };
}
