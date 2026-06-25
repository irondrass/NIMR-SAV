import { Role } from '../types';

export type Action =
  | 'create_case'
  | 'receive_case'
  | 'view_cases'
  | 'view_tasks'
  | 'start_repair'
  | 'complete_repair'
  | 'assign_technician'
  | 'schedule_case'
  | 'change_workshop_status'
  | 'rework_repair'
  | 'validate_qc'
  | 'reject_qc'
  | 'request_rework'
  | 'deliver_case'
  | 'close_case'
  | 'view_direction_notes'
  | 'edit_direction_notes'
  | 'admin_action'
  | 'view_assigned_cases'
  | 'start_task'
  | 'complete_task'
  | 'update_task_status'
  | 'complete_work'
  | 'view_quality_cases'
  | 'start_quality_check'
  | 'send_to_rework'
  | 'view_qc_history'
  | 'view_delivery_cases'
  | 'prepare_delivery'
  | 'add_delivery_proof'
  | 'view_delivery_history'
  | 'view_director_dashboard'
  | 'view_all_cases'
  | 'view_operational_kpis'
  | 'view_blocking_alerts'
  | 'view_technician_load';

/**
 * Checks if a specific role is allowed to perform a given action.
 */
export function hasPermission(role: Role, action: Action): boolean {
  if (role === 'admin') {
    return true;
  }

  // Lecture seule cannot modify anything (only view actions)
  if (role === 'lecture-seule') {
    return (
      action === 'view_cases' ||
      action === 'view_tasks' ||
      action === 'view_director_dashboard' ||
      action === 'view_all_cases' ||
      action === 'view_operational_kpis' ||
      action === 'view_blocking_alerts' ||
      action === 'view_technician_load'
    );
  }

  switch (action) {
    case 'view_director_dashboard':
    case 'view_all_cases':
    case 'view_operational_kpis':
    case 'view_blocking_alerts':
    case 'view_technician_load':
      return role === 'directeur-sav';
    case 'create_case':
    case 'receive_case':
      return role === 'reception';

    case 'view_cases':
      return true; // All roles can view cases

    case 'view_tasks':
      // Technicien, Chef d'Atelier, Qualité, Directeur SAV, and Livraison can view task lists
      return (
        role === 'technicien' ||
        role === 'chef-atelier' ||
        role === 'qualite' ||
        role === 'directeur-sav' ||
        role === 'livraison'
      );

    case 'start_repair':
    case 'complete_repair':
    case 'view_assigned_cases':
    case 'start_task':
    case 'complete_task':
    case 'update_task_status':
    case 'complete_work':
      return role === 'technicien';

    case 'assign_technician':
    case 'schedule_case':
    case 'change_workshop_status':
    case 'rework_repair':
      return role === 'chef-atelier';

    case 'validate_qc':
    case 'reject_qc':
    case 'request_rework':
    case 'view_quality_cases':
    case 'start_quality_check':
    case 'send_to_rework':
    case 'view_qc_history':
      return role === 'qualite';

    case 'view_delivery_cases':
    case 'prepare_delivery':
    case 'deliver_case':
    case 'add_delivery_proof':
    case 'view_delivery_history':
      return role === 'livraison' || role === 'directeur-sav';

    case 'close_case':
      // Only directeur-sav (and admin) can close cases
      return role === 'directeur-sav';

    case 'view_direction_notes':
      return role === 'directeur-sav';

    case 'edit_direction_notes':
      return role === 'directeur-sav';

    case 'admin_action':
      return false; // Only Admin (handled above)

    default:
      return false;
  }
}

/**
 * Checks if notes can be read.
 * "Notes Direction visibles uniquement Directeur SAV et Admin technique."
 */
export function canViewDirectionNotes(role: Role): boolean {
  return role === 'directeur-sav' || role === 'admin';
}
