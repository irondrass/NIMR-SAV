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
  | 'admin_action';

/**
 * Checks if a specific role is allowed to perform a given action.
 */
export function hasPermission(role: Role, action: Action): boolean {
  if (role === 'admin') {
    return true;
  }

  // Lecture seule cannot modify anything (only view actions)
  if (role === 'lecture-seule') {
    return action === 'view_cases' || action === 'view_tasks';
  }

  switch (action) {
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
      return role === 'technicien';

    case 'assign_technician':
    case 'schedule_case':
    case 'change_workshop_status':
    case 'rework_repair':
      return role === 'chef-atelier';

    case 'validate_qc':
    case 'reject_qc':
    case 'request_rework':
      return role === 'qualite';

    case 'deliver_case':
      return role === 'livraison' || role === 'chef-atelier';

    case 'close_case':
      // Réception and Livraison cannot close cases
      return role === 'chef-atelier' || role === 'directeur-sav';

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
