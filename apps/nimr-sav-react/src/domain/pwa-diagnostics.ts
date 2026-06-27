import { RESERVED_CACHE_NAME } from '../constants/version';

export interface DiagnosticResult {
  status: 'ok' | 'warning' | 'error';
  details: string;
}

export interface PwaDiagnosticsSummary {
  manifest: DiagnosticResult;
  icons: DiagnosticResult;
  cache: DiagnosticResult;
  offline: DiagnosticResult;
  serviceWorkerIsolation: DiagnosticResult;
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
  if (typeof window === 'undefined') {
    return { status: 'warning', details: "Support hors ligne non vérifiable en environnement non-navigateur." };
  }

  const hasServiceWorkerSupport = 'serviceWorker' in navigator;
  if (!hasServiceWorkerSupport) {
    return { status: 'error', details: "Le navigateur ne supporte pas les Service Workers." };
  }

  return {
    status: 'warning',
    details: "Le navigateur supporte les Service Workers, mais aucun SW React n'est activé par défaut dans cette version préparatoire."
  };
}

export function checkCacheReadiness(): DiagnosticResult {
  if (typeof window === 'undefined') {
    return { status: 'warning', details: "Cache API non vérifiable en environnement non-navigateur." };
  }

  if (!('caches' in window)) {
    return { status: 'warning', details: "Cache API indisponible : le mode offline reste limité au localStorage." };
  }

  return {
    status: 'ok',
    details: `Cache API disponible ; nom réservé non activé automatiquement : ${RESERVED_CACHE_NAME}.`,
  };
}

export function checkServiceWorkerIsolation(): DiagnosticResult {
  return {
    status: 'ok',
    details: "Aucun enregistrement SW React n'est effectué par le diagnostic alpha.19 ; v23.2.6 reste isolé.",
  };
}

export function summarizePwaDiagnostics(): PwaDiagnosticsSummary {
  const manifest = checkManifestReadiness();
  const icons = checkIconReadiness();
  const cache = checkCacheReadiness();
  const offline = checkOfflineReadiness();
  const serviceWorkerIsolation = checkServiceWorkerIsolation();

  let overallStatus: 'ok' | 'warning' | 'error' = 'ok';
  if ([manifest, icons, cache, offline, serviceWorkerIsolation].some((item) => item.status === 'error')) {
    overallStatus = 'error';
  } else if ([manifest, icons, cache, offline, serviceWorkerIsolation].some((item) => item.status === 'warning')) {
    overallStatus = 'warning';
  }

  return {
    manifest,
    icons,
    cache,
    offline,
    serviceWorkerIsolation,
    serviceWorkerActiveByDefault: false,
    overallStatus,
    notice: "alpha.19 sécurité/readiness : diagnostic PWA isolé, aucun SW React actif par défaut, aucune interférence avec le pilote stable v23.2.6."
  };
}
