import { Role } from '../types';
import { OFFICIAL_ROLES, ROLE_GOVERNANCE_LABELS } from './role-governance';

export type AcceptanceScenarioStatus = 'pass' | 'warning' | 'fail' | 'manual';
export type AcceptanceReadinessDecision = 'GO interne' | 'GO avec réserves' | 'NO-GO';

export interface RoleAcceptanceStep {
  id: string;
  label: string;
  expectedStatus: AcceptanceScenarioStatus;
}

export interface RoleAcceptanceScenario {
  role: Role;
  label: string;
  objective: string;
  steps: RoleAcceptanceStep[];
  goCriteria: string[];
  noGoCriteria: string[];
  reserves: string[];
}

export interface AcceptanceEvaluation {
  decision: AcceptanceReadinessDecision;
  passed: number;
  warnings: number;
  failed: number;
  manual: number;
  reserves: string[];
}

const SCENARIOS: Record<Role, Omit<RoleAcceptanceScenario, 'role' | 'label'>> = {
  reception: {
    objective: 'Créer le dossier terrain sans donnée réelle et produire les éléments de réception.',
    steps: [
      { id: 'draft', label: 'Créer un brouillon de dossier avec VIN, immatriculation et téléphone valides.', expectedStatus: 'pass' },
      { id: 'receive', label: 'Passer le dossier en réception directe selon le workflow.', expectedStatus: 'pass' },
      { id: 'photos', label: 'Ajouter des photos image contrôlées.', expectedStatus: 'pass' },
      { id: 'estimate', label: 'Importer un devis texte ou HTML neutralisé.', expectedStatus: 'manual' },
      { id: 'print', label: 'Exporter la fiche réception sans HTML dangereux.', expectedStatus: 'pass' },
    ],
    goCriteria: ['Aucune mutation hors rôle réception.', 'Aucune donnée client réelle.', 'Fiche réception imprimable.'],
    noGoCriteria: ['Dossier perdu.', 'Champ obligatoire accepté vide.', 'Export non échappé.'],
    reserves: ['Validation manuelle du devis importé requise avec un jeu fictif.'],
  },
  'chef-atelier': {
    objective: 'Planifier et sécuriser la charge atelier sans contourner les accords sinistres.',
    steps: [
      { id: 'planning', label: 'Planifier une intervention dans le planning atelier.', expectedStatus: 'pass' },
      { id: 'gantt', label: 'Contrôler Gantt, collisions et capacité.', expectedStatus: 'manual' },
      { id: 'assign', label: 'Affecter un technicien officiel.', expectedStatus: 'pass' },
      { id: 'claim_block', label: 'Vérifier le blocage si accord Expert ou Client manque.', expectedStatus: 'pass' },
    ],
    goCriteria: ['Collision détectée.', 'Capacité visible.', 'Accords sinistres respectés.'],
    noGoCriteria: ['Planification malgré accord bloquant.', 'Statut atelier non officiel.'],
    reserves: ['Recette tablette Gantt à valider terrain.'],
  },
  technicien: {
    objective: 'Exécuter uniquement les tâches affectées, sans export complet.',
    steps: [
      { id: 'view_task', label: 'Consulter les tâches affectées.', expectedStatus: 'pass' },
      { id: 'progress', label: 'Démarrer et progresser sur les tâches autorisées.', expectedStatus: 'pass' },
      { id: 'no_export', label: 'Confirmer le refus d’export complet dossier.', expectedStatus: 'pass' },
    ],
    goCriteria: ['Progression limitée au technicien affecté.', 'Export complet refusé.'],
    noGoCriteria: ['Technicien non affecté pouvant muter.', 'Export complet accessible.'],
    reserves: [],
  },
  qualite: {
    objective: 'Valider ou rejeter la conformité sans action livraison.',
    steps: [
      { id: 'checklist', label: 'Remplir la checklist qualité.', expectedStatus: 'pass' },
      { id: 'reject', label: 'Rejeter avec motif obligatoire.', expectedStatus: 'pass' },
      { id: 'rework', label: 'Envoyer en reprise puis revoir.', expectedStatus: 'manual' },
      { id: 'approve', label: 'Valider qualité seulement si tous les requis sont conformes.', expectedStatus: 'pass' },
    ],
    goCriteria: ['Motifs obligatoires.', 'Validation bloquée si checklist incomplète.'],
    noGoCriteria: ['Validation qualité sans requis.', 'Action livraison exposée.'],
    reserves: ['Reprise atelier à observer avec un dossier long.'],
  },
  livraison: {
    objective: 'Livrer uniquement après contrôle qualité validé.',
    steps: [
      { id: 'block_without_qc', label: 'Vérifier le blocage livraison sans qualité approuvée.', expectedStatus: 'pass' },
      { id: 'receipt', label: 'Générer le PV de restitution.', expectedStatus: 'pass' },
      { id: 'deliver', label: 'Livrer avec destinataire et référence preuve.', expectedStatus: 'pass' },
    ],
    goCriteria: ['Livraison impossible avant qualité OK.', 'PV imprimable avec dossier local.'],
    noGoCriteria: ['Livraison sans qualité approuvée.', 'Preuve absente acceptée.'],
    reserves: [],
  },
  'directeur-sav': {
    objective: 'Consulter les KPIs, les exports autorisés et la synthèse sans mutation terrain.',
    steps: [
      { id: 'kpis', label: 'Consulter les KPIs et alertes.', expectedStatus: 'pass' },
      { id: 'export', label: 'Exporter une synthèse autorisée.', expectedStatus: 'manual' },
      { id: 'readonly_ops', label: 'Confirmer l’absence de mutation terrain non autorisée.', expectedStatus: 'pass' },
    ],
    goCriteria: ['Pilotage lisible.', 'Aucune mutation terrain non validée.'],
    noGoCriteria: ['Action opérationnelle exposée hors périmètre.', 'Indicateurs incohérents.'],
    reserves: ['Export Direction à valider avec un dossier de démonstration.'],
  },
  admin: {
    objective: 'Diagnostiquer sécurité, offline/cache/queue et PWA sans activer de service worker React.',
    steps: [
      { id: 'security', label: 'Lire les audits permissions, statuts et champs.', expectedStatus: 'pass' },
      { id: 'cache', label: 'Vider le cache local explicitement.', expectedStatus: 'manual' },
      { id: 'queue', label: 'Rejouer une queue locale simulée.', expectedStatus: 'manual' },
      { id: 'pwa', label: 'Confirmer le diagnostic PWA isolé sans enregistrement SW.', expectedStatus: 'pass' },
    ],
    goCriteria: ['Diagnostics disponibles.', 'Aucune restauration automatique.', 'Aucun SW React actif.'],
    noGoCriteria: ['Cache v23 touché.', 'Sync serveur suggérée.', 'SW React enregistré.'],
    reserves: ['Les actions cache/queue restent à exécuter par un humain sur clone frais.'],
  },
  'lecture-seule': {
    objective: 'Consulter sans mutation, impression ou export complet déclenchant un changement métier.',
    steps: [
      { id: 'browse', label: 'Consulter les dossiers.', expectedStatus: 'pass' },
      { id: 'no_mutation', label: 'Vérifier qu’aucune mutation n’est disponible.', expectedStatus: 'pass' },
      { id: 'audit', label: 'Consulter la synthèse sans modification.', expectedStatus: 'pass' },
    ],
    goCriteria: ['Aucune mutation.', 'Aucun accès admin.', 'Aucun export complet.'],
    noGoCriteria: ['Écriture possible.', 'Droit admin exposé.', 'Export complet disponible.'],
    reserves: [],
  },
};

export function buildRoleAcceptanceScenario(role: Role): RoleAcceptanceScenario {
  const scenario = SCENARIOS[role];
  return {
    role,
    label: ROLE_GOVERNANCE_LABELS[role],
    ...scenario,
  };
}

export function buildFullFieldAcceptancePlan(): RoleAcceptanceScenario[] {
  return OFFICIAL_ROLES.map((role) => buildRoleAcceptanceScenario(role));
}

export function getRoleAcceptanceChecklist(role: Role): RoleAcceptanceStep[] {
  return buildRoleAcceptanceScenario(role).steps;
}

export function evaluateAcceptanceResult(
  statuses: readonly AcceptanceScenarioStatus[]
): AcceptanceEvaluation {
  const failed = statuses.filter((status) => status === 'fail').length;
  const warnings = statuses.filter((status) => status === 'warning').length;
  const manual = statuses.filter((status) => status === 'manual').length;
  const passed = statuses.filter((status) => status === 'pass').length;
  const reserves: string[] = [];

  if (warnings > 0) reserves.push(`${warnings} point(s) en avertissement.`);
  if (manual > 0) reserves.push(`${manual} point(s) exigent une validation humaine terrain.`);

  return {
    decision: failed > 0 ? 'NO-GO' : reserves.length > 0 ? 'GO avec réserves' : 'GO interne',
    passed,
    warnings,
    failed,
    manual,
    reserves,
  };
}

export function summarizeAcceptanceReadiness(): AcceptanceEvaluation {
  const plan = buildFullFieldAcceptancePlan();
  const statuses = plan.flatMap((scenario) => scenario.steps.map((step) => step.expectedStatus));
  const evaluation = evaluateAcceptanceResult(statuses);
  return {
    ...evaluation,
    reserves: [
      ...evaluation.reserves,
      ...plan.flatMap((scenario) => scenario.reserves),
      'alpha.20 reste une recette web isolée : aucune RC ni mise en production automatique.',
    ],
  };
}
