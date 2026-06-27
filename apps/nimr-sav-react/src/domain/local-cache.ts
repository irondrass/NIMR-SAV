import { SavCase } from './sav-case';
import { AuditLogEntry } from './audit-log';
import { OfflineAction } from './offline-queue';
import { LS_PREFIX } from '../constants/version';

export interface LocalSnapshot {
  appVersion: string;
  createdAt: string;
  schemaVersion: number;
  cases: SavCase[];
  logs: AuditLogEntry[];
  pendingActions: OfflineAction[];
  warnings: string[];
}

export function getLocalCacheKey(): string {
  return `${LS_PREFIX}local_cache_snapshot`;
}

export function buildLocalSnapshot(
  cases: SavCase[],
  logs: AuditLogEntry[],
  pendingActions: OfflineAction[],
  appVersion: string
): LocalSnapshot {
  const warnings: string[] = [];
  if (cases.length === 0) {
    warnings.push("Le snapshot ne contient aucun dossier SAV.");
  }
  const pendingCount = pendingActions.length;
  if (pendingCount > 0) {
    warnings.push(`Le snapshot contient ${pendingCount} action(s) en attente non synchronisée(s).`);
  }

  return {
    appVersion,
    createdAt: new Date().toISOString(),
    schemaVersion: 24, // schemaVersion for v24
    cases,
    logs,
    pendingActions,
    warnings,
  };
}

export function validateLocalSnapshot(snapshot: unknown, currentAppVersion: string): { valid: boolean; reason?: string } {
  if (!snapshot) {
    return { valid: false, reason: "Snapshot vide ou indéfini." };
  }
  if (typeof snapshot !== 'object') {
    return { valid: false, reason: "Le snapshot doit être un objet." };
  }
  const snap = snapshot as Record<string, unknown>;
  if (snap.schemaVersion !== 24) {
    return { valid: false, reason: `Version de schéma incompatible : reçu ${snap.schemaVersion}, attendu 24.` };
  }
  if (snap.appVersion !== currentAppVersion) {
    return { valid: false, reason: `Version d'application incompatible : reçu ${snap.appVersion}, attendu ${currentAppVersion}.` };
  }
  if (!Array.isArray(snap.cases)) {
    return { valid: false, reason: "Format invalide : la liste des dossiers ('cases') est manquante ou invalide." };
  }
  if (!Array.isArray(snap.logs)) {
    return { valid: false, reason: "Format invalide : la liste des logs ('logs') est manquante ou invalide." };
  }
  return { valid: true };
}

export function restoreLocalSnapshot(snapshot: LocalSnapshot): { cases: SavCase[]; logs: AuditLogEntry[]; pendingActions: OfflineAction[] } {
  return {
    cases: snapshot.cases || [],
    logs: snapshot.logs || [],
    pendingActions: snapshot.pendingActions || [],
  };
}

export function getSnapshotWarnings(snapshot: LocalSnapshot): string[] {
  return snapshot.warnings || [];
}

export function estimateSnapshotSize(snapshot: LocalSnapshot): number {
  try {
    const str = JSON.stringify(snapshot);
    return str.length * 2; // rough estimate in bytes (UTF-16 characters are 2 bytes)
  } catch {
    return 0;
  }
}

export function sanitizeSnapshotForStorage(snapshot: LocalSnapshot): LocalSnapshot {
  // Deep copy / sanitize
  return JSON.parse(JSON.stringify(snapshot)) as LocalSnapshot;
}
