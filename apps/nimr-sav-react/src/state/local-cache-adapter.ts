import { LocalSnapshot, getLocalCacheKey } from '../domain/local-cache';

export function saveSnapshotToLocalStorage(snapshot: LocalSnapshot): { success: boolean; error?: string } {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return { success: false, error: 'localStorage non disponible (SSR/Node)' };
  }
  try {
    const key = getLocalCacheKey();
    const serialized = JSON.stringify(snapshot);
    localStorage.setItem(key, serialized);
    return { success: true };
  } catch (e) {
    const err = e as Error;
    console.error('[NIMR v24] Erreur lors de la sauvegarde locale :', err);
    if (err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      return { success: false, error: 'Espace de stockage local saturé (Quota Exceeded)' };
    }
    return { success: false, error: err.message || 'Erreur de stockage local' };
  }
}

export function loadSnapshotFromLocalStorage(): LocalSnapshot | null {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return null;
  }
  try {
    const key = getLocalCacheKey();
    const serialized = localStorage.getItem(key);
    if (!serialized) return null;
    return JSON.parse(serialized) as LocalSnapshot;
  } catch (e) {
    console.error('[NIMR v24] Erreur lors de la lecture locale :', e);
    return null;
  }
}

export function clearLocalSnapshot(): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return;
  }
  try {
    const key = getLocalCacheKey();
    localStorage.removeItem(key);
  } catch (e) {
    console.error('[NIMR v24] Erreur lors de la suppression locale :', e);
  }
}

export function hasLocalSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return false;
  }
  try {
    const key = getLocalCacheKey();
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

export interface SnapshotMetadata {
  createdAt: string | null;
  appVersion: string | null;
  casesCount: number;
  pendingCount: number;
}

export function getLocalSnapshotMetadata(): SnapshotMetadata | null {
  const snapshot = loadSnapshotFromLocalStorage();
  if (!snapshot) return null;
  return {
    createdAt: snapshot.createdAt || null,
    appVersion: snapshot.appVersion || null,
    casesCount: Array.isArray(snapshot.cases) ? snapshot.cases.length : 0,
    pendingCount: Array.isArray(snapshot.pendingActions) ? snapshot.pendingActions.length : 0,
  };
}
