import { Role } from '../types';
import { CaseStatus } from './case-status';

export function getRoleFieldGuidance(role: Role): string {
  switch (role) {
    case 'reception':
      return "Saisir les informations d'identification du client, les détails du véhicule et les motifs de prise en charge pour qualifier le dossier atelier.";
    case 'chef-atelier':
      return "Planifier les interventions, gérer les priorités, affecter les techniciens et superviser l'ensemble des tâches de l'atelier.";
    case 'technicien':
      return "Consulter les dossiers affectés, suivre et mettre à jour la progression des tâches allouées sur la tablette d'atelier.";
    case 'qualite':
      return "Valider ou rejeter la conformité des travaux effectués en complétant la checklist de contrôle qualité.";
    case 'livraison':
      return "Préparer la livraison, consigner la signature de réception client et confirmer la remise finale du véhicule.";
    case 'directeur-sav':
      return "Consulter en temps réel les indicateurs de performance globale, les alertes de blocage opérationnelles et la charge de l'atelier.";
    case 'admin':
      return "Superviser la gouvernance des rôles, la conformité technique des invariants de version et consulter les journaux d'audit.";
    case 'lecture-seule':
      return "Consulter l'historique complet et les détails des dossiers SAV en mode passif sans possibilité de modification.";
    default:
      return "";
  }
}

export function getStatusDisplay(status: CaseStatus): string {
  switch (status) {
    case 'draft':
      return "Brouillon";
    case 'received':
      return "Réceptionné";
    case 'diagnosis':
      return "En diagnostic";
    case 'waiting_parts':
      return "Attente pièces";
    case 'repair':
      return "En réparation";
    case 'work_completed':
      return "Travaux terminés";
    case 'quality_pending':
      return "Contrôle qualité en attente";
    case 'quality_rejected':
      return "Contrôle qualité refusé";
    case 'quality_rework':
      return "Reprise atelier";
    case 'quality_approved':
      return "Contrôle qualité approuvé";
    case 'ready_delivery':
      return "Prêt pour livraison";
    case 'delivered':
      return "Livré";
    case 'closed':
      return "Clôturé";
    case 'cancelled':
      return "Annulé";
    default:
      return status;
  }
}

export function getPriorityDisplay(priority: 'basse' | 'normale' | 'haute' | 'low' | 'normal' | 'high' | 'urgent' | string): string {
  switch (priority) {
    case 'basse':
    case 'low':
      return "Basse";
    case 'normale':
    case 'normal':
      return "Normale";
    case 'haute':
    case 'high':
      return "Haute";
    case 'urgent':
      return "Urgente";
    default:
      return priority;
  }
}

export function getEmptyStateForRole(role: Role): string {
  switch (role) {
    case 'reception':
      return "Aucun dossier SAV enregistré. Utilisez le formulaire pour créer une nouvelle prise en charge.";
    case 'chef-atelier':
      return "Aucun dossier en attente de planification ou d'affectation dans l'atelier.";
    case 'technicien':
      return "Aucun dossier ne vous est affecté actuellement. Bon travail !";
    case 'qualite':
      return "Aucun contrôle qualité en attente de validation.";
    case 'livraison':
      return "Aucun véhicule n'est prêt pour la livraison client à ce stade.";
    case 'directeur-sav':
      return "Aucune statistique ou dossier à analyser pour le moment.";
    case 'admin':
      return "Aucun journal d'activité d'audit n'est actuellement enregistré.";
    case 'lecture-seule':
      return "Aucun dossier SAV disponible pour la consultation passive.";
    default:
      return "Aucune donnée disponible.";
  }
}

export function getBlockedStateMessage(status: CaseStatus, role: Role): string {
  if (role === 'livraison' && status !== 'ready_delivery' && status !== 'delivered') {
    return "La livraison client est bloquée car le dossier n'a pas encore de contrôle qualité approuvé.";
  }
  if (role === 'technicien' && status === 'repair') {
    return "Toutes les tâches de l'atelier doivent être finalisées sur votre tablette avant de déclarer les travaux terminés.";
  }
  return `Action indisponible (statut : ${getStatusDisplay(status)}, rôle : ${role}).`;
}

export function getActionVisibilitySummary(role: Role): string[] {
  switch (role) {
    case 'reception':
      return ["Saisie dossier", "Validation réception", "Annulation de dossier"];
    case 'chef-atelier':
      return ["Planifier intervention", "Affecter technicien", "Ajuster priorité", "Reprise atelier"];
    case 'technicien':
      return ["Consulter mes tâches", "Démarrer tâche atelier", "Terminer tâche atelier", "Finaliser travaux"];
    case 'qualite':
      return ["Vérifier checklist", "Approuver travaux", "Rejeter travaux"];
    case 'livraison':
      return ["Valider preuve de livraison", "Saisir nom destinataire", "Remettre le véhicule"];
    case 'directeur-sav':
      return ["Visualiser indicateurs", "Piloter alertes", "Vérifier charge atelier (lecture seule)"];
    case 'admin':
      return ["Suivre conformité technique", "Analyser journaux d'audit", "Gouvernance des rôles"];
    case 'lecture-seule':
      return ["Recherche multicritère", "Consulter dossier", "Consulter historique"];
    default:
      return [];
  }
}

export function getResponsiveGuidelines(): string {
  return "Mise en page fluide optimisée pour tablettes tactiles d'atelier, smartphones de consultation rapide et moniteurs de supervision.";
}

export function validateUiFieldConsistency(_config?: unknown): { success: boolean; errors: string[] } {
  const errors: string[] = [];
  const roles: Role[] = ['reception', 'chef-atelier', 'technicien', 'qualite', 'livraison', 'directeur-sav', 'admin', 'lecture-seule'];
  const statuses: CaseStatus[] = ['draft', 'received', 'diagnosis', 'waiting_parts', 'repair', 'work_completed', 'quality_pending', 'quality_rejected', 'quality_rework', 'quality_approved', 'ready_delivery', 'delivered', 'closed', 'cancelled'];

  for (const r of roles) {
    if (!getRoleFieldGuidance(r)) errors.push(`Missing field guidance for role: ${r}`);
    if (!getEmptyStateForRole(r)) errors.push(`Missing empty state message for role: ${r}`);
  }
  for (const s of statuses) {
    if (getStatusDisplay(s) === s) errors.push(`Display label matches technical status: ${s}`);
  }

  return {
    success: errors.length === 0,
    errors
  };
}
