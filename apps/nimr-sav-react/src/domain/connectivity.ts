export type ConnectivityStatus = 'online' | 'offline' | 'degraded' | 'unknown';

export type OfflineCapability = 'full' | 'degraded' | 'none';

export function getInitialConnectivityStatus(): ConnectivityStatus {
  // Pure domain function fallback to avoid Node/Vitest crash
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return 'online';
  }
  return navigator.onLine ? 'online' : 'offline';
}

export function deriveConnectivityMessage(status: ConnectivityStatus): string {
  switch (status) {
    case 'online':
      return 'Connecté au réseau';
    case 'offline':
      return 'Mode hors ligne';
    case 'degraded':
      return 'Connexion dégradée';
    case 'unknown':
    default:
      return 'État de connexion inconnu';
  }
}

export function deriveConnectivitySeverity(status: ConnectivityStatus): 'info' | 'warning' | 'error' | 'success' {
  switch (status) {
    case 'online':
      return 'success';
    case 'offline':
      return 'error';
    case 'degraded':
      return 'warning';
    case 'unknown':
    default:
      return 'info';
  }
}

export function canRunOfflineAction(actionType: string): boolean {
  // Most actions can be run/queued offline locally in this préparatoire version
  const offlineActions = [
    'create_case',
    'receive_case',
    'update_case',
    'add_claim',
    'update_claim',
    'add_photo',
    'remove_photo',
    'print_document',
    'export_case',
    'qc_update',
    'delivery_update'
  ];
  return offlineActions.includes(actionType);
}

export function shouldQueueAction(actionType: string, isOnline: boolean): boolean {
  if (isOnline) return false;
  return canRunOfflineAction(actionType);
}

export function summarizeOfflineState(status: ConnectivityStatus, pendingCount: number): string {
  if (status === 'online') {
    return 'Mode connecté. Aucune action en attente.';
  }
  if (pendingCount === 0) {
    return 'Mode hors ligne. Aucune action locale en attente.';
  }
  return `Mode hors ligne. ${pendingCount} action(s) locale(s) en attente de synchronisation simulée.`;
}
