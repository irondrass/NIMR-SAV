import { Role, ROLE_ALLOWED_TABS } from '../types';
import { Action, hasPermission, canViewDirectionNotes } from './action-permissions';

export const OFFICIAL_ROLES: readonly Role[] = [
  'reception',
  'chef-atelier',
  'technicien',
  'qualite',
  'livraison',
  'directeur-sav',
  'admin',
  'lecture-seule',
] as const;

export const ROLE_GOVERNANCE_LABELS: Record<Role, string> = {
  reception: 'Réceptionnaire',
  'chef-atelier': "Chef d'Atelier",
  technicien: 'Technicien Atelier',
  qualite: 'Contrôleur Qualité',
  livraison: 'Agent de Livraison',
  'directeur-sav': 'Directeur SAV',
  admin: 'Administrateur Système',
  'lecture-seule': 'Consultant (Lecture seule)',
};

export const ROLE_SCOPE_DESCRIPTIONS: Record<Role, string> = {
  reception: 'Création et réception initiale des dossiers clients.',
  'chef-atelier': 'Affectation, priorités et planification des tâches atelier.',
  technicien: 'Intervention technique, démarrage et réalisation des tâches atelier.',
  qualite: 'Contrôles de conformité technique (QC) et validation / rework.',
  livraison: 'Préparation et confirmation de la livraison physique avec preuve.',
  'directeur-sav': 'Pilotage stratégique, supervision globale des KPIs en lecture seule.',
  admin: 'Configuration technique, supervision des invariants et journal de log.',
  'lecture-seule': 'Consultation passive des dossiers sans aucun droit de modification.',
};

export const ALL_ACTIONS: readonly Action[] = [
  'create_case',
  'receive_case',
  'view_cases',
  'view_tasks',
  'start_repair',
  'complete_repair',
  'assign_technician',
  'schedule_case',
  'change_workshop_status',
  'rework_repair',
  'validate_qc',
  'reject_qc',
  'request_rework',
  'deliver_case',
  'close_case',
  'view_direction_notes',
  'edit_direction_notes',
  'admin_action',
  'view_assigned_cases',
  'start_task',
  'complete_task',
  'update_task_status',
  'complete_work',
  'view_quality_cases',
  'start_quality_check',
  'send_to_rework',
  'view_qc_history',
  'view_delivery_cases',
  'prepare_delivery',
  'add_delivery_proof',
  'view_delivery_history',
  'view_director_dashboard',
  'view_all_cases',
  'view_operational_kpis',
  'view_blocking_alerts',
  'view_technician_load',
  'view_admin_console',
  'view_role_governance',
  'view_permission_matrix',
  'view_system_invariants',
  'view_audit_summary',
  'view_readonly_console',
] as const;

export const WRITE_ACTIONS: readonly Action[] = [
  'create_case',
  'receive_case',
  'start_repair',
  'complete_repair',
  'assign_technician',
  'schedule_case',
  'change_workshop_status',
  'rework_repair',
  'validate_qc',
  'reject_qc',
  'request_rework',
  'deliver_case',
  'close_case',
  'edit_direction_notes',
  'start_task',
  'complete_task',
  'update_task_status',
  'complete_work',
  'start_quality_check',
  'send_to_rework',
  'prepare_delivery',
  'add_delivery_proof',
] as const;

export function getOfficialRoles(): readonly Role[] {
  return OFFICIAL_ROLES;
}

export function isOfficialRole(role: unknown): role is Role {
  return OFFICIAL_ROLES.includes(role as Role);
}

export interface RoleGovernanceEntry {
  role: Role;
  label: string;
  scope: string;
  visibleTabs: readonly string[];
  allowedActions: Action[];
  forbiddenActions: Action[];
  canReadDirectionNotes: boolean;
  canWriteWorkflow: boolean;
  hasAdminAccess: boolean;
}

export function getRoleAllowedActions(role: Role): Action[] {
  return ALL_ACTIONS.filter((action) => hasPermission(role, action));
}

export function getRoleForbiddenActions(role: Role): Action[] {
  return ALL_ACTIONS.filter((action) => !hasPermission(role, action));
}

export function getRoleVisibleTabs(role: Role): readonly string[] {
  return ROLE_ALLOWED_TABS[role] || [];
}

export function getRoleGovernanceMatrix(): RoleGovernanceEntry[] {
  return OFFICIAL_ROLES.map((role) => {
    const allowed = getRoleAllowedActions(role);
    const forbidden = getRoleForbiddenActions(role);
    const visibleTabs = getRoleVisibleTabs(role);
    const canReadNotes = canViewDirectionNotes(role);
    const canWrite = WRITE_ACTIONS.some((action) => hasPermission(role, action));
    const isAdmin = role === 'admin';

    return {
      role,
      label: ROLE_GOVERNANCE_LABELS[role],
      scope: ROLE_SCOPE_DESCRIPTIONS[role],
      visibleTabs,
      allowedActions: allowed,
      forbiddenActions: forbidden,
      canReadDirectionNotes: canReadNotes,
      canWriteWorkflow: canWrite,
      hasAdminAccess: isAdmin,
    };
  });
}

export interface GovernanceValidationResult {
  success: boolean;
  errors: string[];
}

export function validateRoleGovernance(): GovernanceValidationResult {
  const errors: string[] = [];

  // Check if each official role has labels and descriptions
  for (const role of OFFICIAL_ROLES) {
    if (!ROLE_GOVERNANCE_LABELS[role]) {
      errors.push(`Rôle manquant de libellé : ${role}`);
    }
    if (!ROLE_SCOPE_DESCRIPTIONS[role]) {
      errors.push(`Rôle manquant de description de périmètre : ${role}`);
    }
    if (!ROLE_ALLOWED_TABS[role]) {
      errors.push(`Rôle manquant de configuration d'onglets : ${role}`);
    }
  }

  // Ensure lecture-seule cannot write anything
  const readonlyAllowed = getRoleAllowedActions('lecture-seule');
  const readonlyWriteViolations = readonlyAllowed.filter((action) => WRITE_ACTIONS.includes(action));
  if (readonlyWriteViolations.length > 0) {
    errors.push(
      `Violation de gouvernance : le rôle lecture-seule possède des droits d'écriture : ${readonlyWriteViolations.join(
        ', '
      )}`
    );
  }

  // Ensure lecture-seule cannot view direction notes
  if (canViewDirectionNotes('lecture-seule')) {
    errors.push('Violation de gouvernance : le rôle lecture-seule est autorisé à lire les notes direction.');
  }

  return {
    success: errors.length === 0,
    errors,
  };
}

export function detectUnauthorizedRolesInConfig(configuredRoles: string[]): string[] {
  return configuredRoles.filter((role) => !OFFICIAL_ROLES.includes(role as Role));
}

export function summarizeRoleAccess(role: Role): string {
  const label = ROLE_GOVERNANCE_LABELS[role];
  const scope = ROLE_SCOPE_DESCRIPTIONS[role];
  const tabs = getRoleVisibleTabs(role).join(', ');
  const canWrite = WRITE_ACTIONS.some((action) => hasPermission(role, action)) ? 'Oui' : 'Non';

  return `Rôle : ${label} (${role}) | Périmètre : ${scope} | Onglets : [${tabs}] | Droits d'écriture : ${canWrite}`;
}
