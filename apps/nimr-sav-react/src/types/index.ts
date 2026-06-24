/**
 * NIMR SAV v24 — Core TypeScript Types
 *
 * No real client data — foundation types only.
 * Not imported from data/vehicles.json (v23.x production data).
 */

// ─── Roles ───────────────────────────────────────────────────────────────────

export type Role =
  | 'reception'
  | 'technicien'
  | 'chef-atelier'
  | 'qualite'
  | 'directeur-sav'
  | 'admin'
  | 'lecture-seule';

export const ALL_ROLES: readonly Role[] = [
  'reception',
  'technicien',
  'chef-atelier',
  'qualite',
  'directeur-sav',
  'admin',
  'lecture-seule',
] as const;

/** Default view route for each role */
export const ROLE_DEFAULT_VIEW: Record<Role, string> = {
  reception: '/reception',
  technicien: '/mes-taches',
  'chef-atelier': '/planning',
  qualite: '/controle-qualite',
  'directeur-sav': '/pilotage',
  admin: '/admin',
  'lecture-seule': '/lecture',
} as const;

/** Tabs visible per role */
export const ROLE_ALLOWED_TABS: Record<Role, readonly string[]> = {
  reception: ['reception', 'dossiers'],
  technicien: ['mes-taches', 'dossiers'],
  'chef-atelier': ['planning', 'suivi-atelier', 'dossiers'],
  qualite: ['controle-qualite', 'dossiers'],
  'directeur-sav': ['pilotage', 'dossiers', 'today', 'planning', 'controle-qualite', 'suivi-atelier'],
  admin: ['pilotage', 'dossiers', 'planning', 'controle-qualite', 'suivi-atelier', 'admin', 'utilisateurs'],
  'lecture-seule': ['lecture'],
} as const;

// ─── Auth / User ──────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  role: Role;
  /** Admin users can switch accounts; non-admin must log out */
  canSwitchAccount: boolean;
}

// ─── Vehicle / Dossier ────────────────────────────────────────────────────────

export type VehicleStatus =
  | 'attente-reception'
  | 'en-diagnostic'
  | 'en-reparation'
  | 'attente-pieces'
  | 'controle-qualite'
  | 'pret'
  | 'livre';

export interface Vehicle {
  id: string;
  immatriculation: string;
  marque: string;
  modele: string;
  status: VehicleStatus;
  assignedTechnicien?: string;
  receptionDate: string;   // ISO 8601
  estimatedReady?: string; // ISO 8601
}

// ─── QC Checklist ─────────────────────────────────────────────────────────────

export interface QCChecklistItem {
  id: string;
  label: string;
  checked: boolean;
  required: boolean;
}

export interface QCChecklist {
  vehicleId: string;
  items: QCChecklistItem[];
  completedAt?: string; // ISO 8601
  validatedBy?: string;
}

export function isQualityChecklistComplete(checklist: QCChecklist): boolean {
  return checklist.items
    .filter((item) => item.required)
    .every((item) => item.checked);
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

export type SyncStatus = 'idle' | 'syncing' | 'conflict' | 'error' | 'offline';

export interface SyncState {
  status: SyncStatus;
  openConflicts: number;
  lastSyncAt?: string; // ISO 8601
}

// ─── App State ────────────────────────────────────────────────────────────────

export interface AppState {
  version: string;
  currentUser: User | null;
  syncState: SyncState;
}
