import { SavCase, Claim, CasePhoto, QcChecklistItem } from './sav-case';

export type OfflineActionType =
  | 'create_case'
  | 'receive_case'
  | 'update_case'
  | 'add_claim'
  | 'update_claim'
  | 'add_photo'
  | 'remove_photo'
  | 'print_document'
  | 'export_case'
  | 'qc_update'
  | 'delivery_update';

export type OfflineActionStatus = 'queued' | 'replayed' | 'failed' | 'cancelled' | 'skipped';

export interface OfflineAction {
  id: string;
  type: OfflineActionType;
  payload: unknown;
  timestamp: string;
  status: OfflineActionStatus;
  actor: { id: string; role: string };
  error?: string;
}

export interface OfflineQueueState {
  actions: OfflineAction[];
}

export interface OfflineReplayResult {
  succeeded: string[];
  failed: string[];
}

export function createOfflineAction(
  type: OfflineActionType,
  payload: unknown,
  actor: { id: string; role: string }
): OfflineAction {
  return {
    id: `act-${Math.random().toString(36).substring(2, 9)}`,
    type,
    payload,
    timestamp: new Date().toISOString(),
    status: 'queued',
    actor,
  };
}

export function enqueueOfflineAction(actions: OfflineAction[], action: OfflineAction): OfflineAction[] {
  // Prevent duplicate actions
  if (actions.some((a) => a.id === action.id)) {
    return actions;
  }
  return [...actions, action];
}

export function cancelOfflineAction(actions: OfflineAction[], actionId: string): OfflineAction[] {
  return actions.map((a) => (a.id === actionId ? { ...a, status: 'cancelled' as const } : a));
}

export function validateOfflineAction(action: OfflineAction): { valid: boolean; reason?: string } {
  if (!action.id || !action.type || !action.payload || !action.actor) {
    return { valid: false, reason: "Structure d'action incomplète." };
  }
  if (action.actor.role === 'lecture-seule') {
    return { valid: false, reason: "Le rôle 'lecture-seule' n'est pas autorisé à effectuer des modifications." };
  }
  if (action.type === 'export_case' && action.actor.role === 'technicien') {
    return { valid: false, reason: "Le rôle 'technicien' n'est pas autorisé à exporter un dossier complet." };
  }
  return { valid: true };
}

export function getOfflineActionLabel(type: OfflineActionType): string {
  switch (type) {
    case 'create_case':
      return 'Création de dossier';
    case 'receive_case':
      return 'Réception de véhicule';
    case 'update_case':
      return 'Mise à jour dossier';
    case 'add_claim':
      return 'Ajout de sinistre (claim)';
    case 'update_claim':
      return 'Modification de sinistre';
    case 'add_photo':
      return 'Ajout de photo';
    case 'remove_photo':
      return 'Suppression de photo';
    case 'print_document':
      return 'Impression document';
    case 'export_case':
      return 'Exportation dossier ZIP';
    case 'qc_update':
      return 'Mise à jour contrôle qualité';
    case 'delivery_update':
      return 'Mise à jour livraison';
    default:
      return 'Action inconnue';
  }
}

export function getOfflineQueueWarnings(actions: OfflineAction[]): string[] {
  const warnings: string[] = [];
  const queuedActions = actions.filter((a) => a.status === 'queued');
  if (queuedActions.length > 0) {
    warnings.push(`Il y a ${queuedActions.length} action(s) locale(s) en attente de synchronisation simulée.`);
  }
  return warnings;
}

export function summarizeOfflineQueue(actions: OfflineAction[]): string {
  const queued = actions.filter((a) => a.status === 'queued').length;
  const replayed = actions.filter((a) => a.status === 'replayed').length;
  const failed = actions.filter((a) => a.status === 'failed').length;
  return `File d'attente : ${queued} en attente, ${replayed} rejouée(s), ${failed} échec(s).`;
}

export interface OfflineReplayStore {
  addCase(c: SavCase): void;
  transitionWorkshopCase(caseId: string, nextStatus: string, actor: { id: string; role: string }): void;
  assignTechnician(caseId: string, technicianId: string, actor: { id: string; role: string }): void;
  setWorkshopPriority(caseId: string, priority: string, actor: { id: string; role: string }): void;
  getCases(): SavCase[];
  setCases(cases: SavCase[]): void;
  addClaim(caseId: string, claim: Partial<Claim>, actor: { id: string; role: string }): void;
  updateClaim(caseId: string, claimId: string, updatedFields: Partial<Claim>, actor: { id: string; role: string }): void;
  addPhotoToCase(caseId: string, photo: Omit<CasePhoto, 'id' | 'createdAt'>, actor: { id: string; role: string }): void;
  removePhotoFromCase(caseId: string, photoId: string, actor: { id: string; role: string }): void;
  recordPrintAction(caseId: string, documentType: string, actor: { id: string; role: string }): void;
  recordExportAction(caseId: string, actor: { id: string; role: string }): void;
  updateQualityChecklist(caseId: string, checklist: QcChecklistItem[], actor: { id: string; role: string }): void;
  startQualityCheck(caseId: string, actor: { id: string; role: string }): void;
  approveQualityCheck(caseId: string, actor: { id: string; role: string }): void;
  rejectQualityCheck(caseId: string, reason: string, actor: { id: string; role: string }): void;
  sendQualityCaseToRework(caseId: string, reason: string, actor: { id: string; role: string }): void;
  prepareDelivery(caseId: string, actor: { id: string; role: string }): void;
  deliverCase(caseId: string, payload: { recipientName: string; proofReference: string; notes?: string }, actor: { id: string; role: string }): void;
}

export function replayOfflineQueue(
  actions: OfflineAction[],
  store: OfflineReplayStore
): { updatedActions: OfflineAction[]; result: OfflineReplayResult } {
  const succeeded: string[] = [];
  const failed: string[] = [];

  const updatedActions = actions.map((action) => {
    if (action.status !== 'queued') {
      return action;
    }

    // 1. Validation de sécurité et de rôle
    const val = validateOfflineAction(action);
    if (!val.valid) {
      failed.push(action.id);
      return { ...action, status: 'failed' as const, error: val.reason };
    }

    try {
      const { type, payload, actor } = action;
      switch (type) {
        case 'create_case':
          store.addCase(payload as SavCase);
          break;
        case 'receive_case': {
          const p = payload as { caseId: string };
          store.transitionWorkshopCase(p.caseId, 'received', actor);
          break;
        }
        case 'update_case': {
          const p = payload as { caseId: string; technicianId?: string; priority?: string; bay?: string };
          if (p.technicianId !== undefined) {
            store.assignTechnician(p.caseId, p.technicianId, actor);
          }
          if (p.priority !== undefined) {
            store.setWorkshopPriority(p.caseId, p.priority, actor);
          }
          if (p.bay !== undefined) {
            const currentCases = store.getCases();
            const updated = currentCases.map((c) => c.id === p.caseId ? { ...c, workshopBay: p.bay } : c);
            store.setCases(updated);
          }
          break;
        }
        case 'add_claim': {
          const p = payload as { caseId: string; claim: Partial<Claim> };
          store.addClaim(p.caseId, p.claim, actor);
          break;
        }
        case 'update_claim': {
          const p = payload as { caseId: string; claimId: string; updatedFields: Partial<Claim> };
          store.updateClaim(p.caseId, p.claimId, p.updatedFields, actor);
          break;
        }
        case 'add_photo': {
          const p = payload as { caseId: string; photoInput: Omit<CasePhoto, 'id' | 'createdAt'> };
          store.addPhotoToCase(p.caseId, p.photoInput, actor);
          break;
        }
        case 'remove_photo': {
          const p = payload as { caseId: string; photoId: string };
          store.removePhotoFromCase(p.caseId, p.photoId, actor);
          break;
        }
        case 'print_document': {
          const p = payload as { caseId: string; documentType: string };
          store.recordPrintAction(p.caseId, p.documentType, actor);
          break;
        }
        case 'export_case': {
          const p = payload as { caseId: string };
          store.recordExportAction(p.caseId, actor);
          break;
        }
        case 'qc_update': {
          const p = payload as { caseId: string; checklist?: QcChecklistItem[]; status?: string; reason?: string };
          if (p.checklist) {
            store.updateQualityChecklist(p.caseId, p.checklist, actor);
          }
          if (p.status === 'in_progress') {
            store.startQualityCheck(p.caseId, actor);
          } else if (p.status === 'approved') {
            store.approveQualityCheck(p.caseId, actor);
          } else if (p.status === 'rejected') {
            store.rejectQualityCheck(p.caseId, p.reason || 'Rejet offline', actor);
          } else if (p.status === 'rework') {
            store.sendQualityCaseToRework(p.caseId, p.reason || 'Rework offline', actor);
          }
          break;
        }
        case 'delivery_update': {
          const p = payload as { caseId: string; status?: string; recipientName?: string; proofReference?: string; notes?: string };
          if (p.status === 'ready_delivery') {
            store.prepareDelivery(p.caseId, actor);
          } else if (p.status === 'delivered') {
            store.deliverCase(p.caseId, {
              recipientName: p.recipientName || '',
              proofReference: p.proofReference || '',
              notes: p.notes,
            }, actor);
          }
          break;
        }
        default:
          throw new Error(`Type d'action non supporté : ${type}`);
      }

      succeeded.push(action.id);
      return { ...action, status: 'replayed' as const };
    } catch (e) {
      const err = e as Error;
      console.error(`[NIMR v24] Échec du replay pour l'action ${action.id} :`, err);
      failed.push(action.id);
      return { ...action, status: 'failed' as const, error: err.message || 'Erreur inconnue' };
    }
  });

  return {
    updatedActions,
    result: { succeeded, failed },
  };
}
