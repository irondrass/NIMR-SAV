export interface DiagnosticResult {
  status: 'ok' | 'warning' | 'error';
  details: string;
}

export interface PwaDiagnosticsSummary {
  manifest: DiagnosticResult;
  icons: DiagnosticResult;
  offline: DiagnosticResult;
  serviceWorkerActiveByDefault: boolean;
  overallStatus: 'ok' | 'warning' | 'error';
  notice: string;
}

export function checkManifestReadiness(): DiagnosticResult {
  // Standalone check side
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { status: 'warning', details: "Manifest non vérifiable en environnement non-navigateur." };
  }

  const manifestLink = document.querySelector('link[rel="manifest"]');
  if (!manifestLink) {
    return { status: 'error', details: "Balise <link rel='manifest'> absente de l'index HTML." };
  }

  return { status: 'ok', details: "Balise manifest détectée dans le document HTML." };
}

export function checkIconReadiness(): DiagnosticResult {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { status: 'warning', details: "Icônes non vérifiables en environnement non-navigateur." };
  }

  const appleTouchIcon = document.querySelector('link[rel="apple-touch-icon"]');
  const favicons = document.querySelectorAll('link[rel="icon"]');

  if (!appleTouchIcon && favicons.length === 0) {
    return { status: 'warning', details: "Aucune icône PWA (apple-touch-icon ou icon) détectée." };
  }

  return { status: 'ok', details: "Icônes PWA basiques présentes dans l'en-tête HTML." };
}

export function checkOfflineReadiness(): DiagnosticResult {
  // Connectivity and SW check
  if (typeof window === 'undefined') {
    return { status: 'warning', details: "Support hors ligne non vérifiable en environnement non-navigateur." };
  }

  const hasServiceWorkerSupport = 'serviceWorker' in navigator;
  if (!hasServiceWorkerSupport) {
    return { status: 'error', details: "Le navigateur ne supporte pas les Service Workers." };
  }

  return {
    status: 'warning',
    details: "Le navigateur supporte les Service Workers, mais aucun Service Worker React n'est activé par défaut dans cette version préparatoire."
  };
}

export function summarizePwaDiagnostics(): PwaDiagnosticsSummary {
  const manifest = checkManifestReadiness();
  const icons = checkIconReadiness();
  const offline = checkOfflineReadiness();

  let overallStatus: 'ok' | 'warning' | 'error' = 'ok';
  if (manifest.status === 'error' || icons.status === 'error' || offline.status === 'error') {
    overallStatus = 'error';
  } else if (manifest.status === 'warning' || icons.status === 'warning' || offline.status === 'warning') {
    overallStatus = 'warning';
  }

  return {
    manifest,
    icons,
    offline,
    serviceWorkerActiveByDefault: false, // Explicitly false as requested
    overallStatus,
    notice: "alpha.18 offline préparatoire : service worker React désactivé par défaut pour éviter les interférences avec le pilote stable v23.2.6."
  };
}
