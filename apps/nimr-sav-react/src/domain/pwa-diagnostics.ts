import {
  LEGACY_STABLE_URL,
  RECIPE_BASE_PATH,
  RECIPE_CACHE_NAME,
  RECIPE_MANIFEST_PATH,
  RECIPE_PUBLIC_URL,
  RECIPE_SERVICE_WORKER_PATH,
  summarizeDeploymentTarget,
} from '../constants/deployment';
import { getRecipeServiceWorkerStatus } from '../pwa/registerRecipeServiceWorker';

export interface DiagnosticResult {
  status: 'ok' | 'warning' | 'error';
  details: string;
}

export interface PwaRecipeDiagnostics {
  publicUrl: typeof RECIPE_PUBLIC_URL;
  stableUrl: typeof LEGACY_STABLE_URL;
  basePath: typeof RECIPE_BASE_PATH;
  manifestPath: typeof RECIPE_MANIFEST_PATH;
  serviceWorkerPath: typeof RECIPE_SERVICE_WORKER_PATH;
  cacheName: typeof RECIPE_CACHE_NAME;
}

export interface PwaDiagnosticsSummary {
  manifest: DiagnosticResult;
  icons: DiagnosticResult;
  csp: DiagnosticResult;
  noindex: DiagnosticResult;
  scope: DiagnosticResult;
  cache: DiagnosticResult;
  offline: DiagnosticResult;
  serviceWorkerIsolation: DiagnosticResult;
  serviceWorkerActiveByDefault: boolean;
  serviceWorkerAllowedOnCurrentPath: boolean;
  recipe: PwaRecipeDiagnostics;
  overallStatus: 'ok' | 'warning' | 'error';
  notice: string;
}

function getRuntimeDocument(): Document | null {
  if (typeof document === 'undefined') return null;
  return document;
}

function normalizeHref(href: string): string {
  try {
    return new URL(href, RECIPE_PUBLIC_URL).pathname;
  } catch {
    return href;
  }
}

export function checkManifestReadiness(doc: Document | null = getRuntimeDocument()): DiagnosticResult {
  if (!doc) {
    return {
      status: 'ok',
      details: `Manifest recette attendu : ${RECIPE_MANIFEST_PATH}.`,
    };
  }

  const manifestLink = doc.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!manifestLink) {
    return { status: 'error', details: "Balise <link rel='manifest'> absente de l'index HTML." };
  }

  const manifestPath = normalizeHref(manifestLink.href || manifestLink.getAttribute('href') || '');
  if (manifestPath !== RECIPE_MANIFEST_PATH) {
    return {
      status: 'error',
      details: `Manifest incorrect : ${manifestPath || 'vide'} au lieu de ${RECIPE_MANIFEST_PATH}.`,
    };
  }

  return { status: 'ok', details: `Manifest recette détecté : ${RECIPE_MANIFEST_PATH}.` };
}

export function checkIconReadiness(doc: Document | null = getRuntimeDocument()): DiagnosticResult {
  if (!doc) {
    return {
      status: 'ok',
      details: 'Icônes PWA 192 et 512 déclarées dans le manifest recette.',
    };
  }

  const iconLinks = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]'));
  const hasRecipeIcon = iconLinks.some((link) => normalizeHref(link.href || link.getAttribute('href') || '').startsWith(`${RECIPE_BASE_PATH}icons/`));

  if (!hasRecipeIcon) {
    return { status: 'warning', details: 'Aucune icône recette détectée dans l’en-tête HTML.' };
  }

  return { status: 'ok', details: 'Icône PWA recette détectée dans l’en-tête HTML.' };
}

export function checkCspReadiness(doc: Document | null = getRuntimeDocument()): DiagnosticResult {
  if (!doc) {
    return {
      status: 'ok',
      details: "CSP attendue dans index.html avec script-src 'self' et sans unsafe-eval.",
    };
  }

  const csp = doc.querySelector<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy"]')?.content ?? '';
  if (!csp) {
    return { status: 'error', details: 'CSP absente de index.html.' };
  }

  if (csp.includes('unsafe-eval') || csp.includes('*')) {
    return { status: 'error', details: 'CSP trop ouverte pour la recette V24.' };
  }

  if (!csp.includes("script-src 'self'") || !csp.includes("worker-src 'self'")) {
    return { status: 'warning', details: 'CSP présente mais directives script/worker à vérifier.' };
  }

  return { status: 'ok', details: 'CSP recette stricte détectée.' };
}

export function checkNoindexReadiness(doc: Document | null = getRuntimeDocument()): DiagnosticResult {
  if (!doc) {
    return { status: 'ok', details: 'Meta robots noindex,nofollow attendue pour la recette publique.' };
  }

  const robots = doc.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content ?? '';
  return robots.toLowerCase() === 'noindex,nofollow'
    ? { status: 'ok', details: 'Recette marquée noindex,nofollow.' }
    : { status: 'warning', details: 'Meta robots noindex,nofollow absente ou incomplète.' };
}

export function checkScopeReadiness(): DiagnosticResult {
  const target = summarizeDeploymentTarget();
  if (target.expectedBasePath !== RECIPE_BASE_PATH) {
    return { status: 'error', details: `Base path inattendu : ${target.expectedBasePath}.` };
  }

  return {
    status: 'ok',
    details: `Scope recette isolé : ${RECIPE_BASE_PATH}.`,
  };
}

export function checkOfflineReadiness(): DiagnosticResult {
  const status = getRecipeServiceWorkerStatus();

  if (typeof window === 'undefined') {
    return {
      status: 'ok',
      details: `Service worker recette configuré pour ${RECIPE_BASE_PATH}, non exécuté en environnement non-navigateur.`,
    };
  }

  if (!status.supported) {
    return { status: 'warning', details: 'Le navigateur ne supporte pas les Service Workers.' };
  }

  return status.allowed
    ? { status: 'ok', details: `Service worker recette autorisé sur ${RECIPE_BASE_PATH}.` }
    : { status: 'warning', details: 'Service worker ignoré hors chemin recette isolé.' };
}

export function checkCacheReadiness(): DiagnosticResult {
  if (!RECIPE_CACHE_NAME.startsWith('nimr-sav-v24-')) {
    return { status: 'error', details: `Nom cache recette invalide : ${RECIPE_CACHE_NAME}.` };
  }

  return {
    status: 'ok',
    details: `Cache recette isolé : ${RECIPE_CACHE_NAME}.`,
  };
}

export function checkServiceWorkerIsolation(): DiagnosticResult {
  const status = getRecipeServiceWorkerStatus();
  const stablePath = new URL(LEGACY_STABLE_URL).pathname;

  if (RECIPE_BASE_PATH === stablePath) {
    return { status: 'error', details: 'Le scope recette cible le chemin stable.' };
  }

  return {
    status: 'ok',
    details: `SW V24 limité à ${status.scope}; URL stable ${stablePath} non ciblée.`,
  };
}

export function summarizePwaDiagnostics(): PwaDiagnosticsSummary {
  const manifest = checkManifestReadiness();
  const icons = checkIconReadiness();
  const csp = checkCspReadiness();
  const noindex = checkNoindexReadiness();
  const scope = checkScopeReadiness();
  const cache = checkCacheReadiness();
  const offline = checkOfflineReadiness();
  const serviceWorkerIsolation = checkServiceWorkerIsolation();
  const serviceWorkerStatus = getRecipeServiceWorkerStatus();

  const checks = [manifest, icons, csp, noindex, scope, cache, offline, serviceWorkerIsolation];
  let overallStatus: 'ok' | 'warning' | 'error' = 'ok';
  if (checks.some((item) => item.status === 'error')) {
    overallStatus = 'error';
  } else if (checks.some((item) => item.status === 'warning')) {
    overallStatus = 'warning';
  }

  return {
    manifest,
    icons,
    csp,
    noindex,
    scope,
    cache,
    offline,
    serviceWorkerIsolation,
    serviceWorkerActiveByDefault: false,
    serviceWorkerAllowedOnCurrentPath: serviceWorkerStatus.allowed,
    recipe: {
      publicUrl: RECIPE_PUBLIC_URL,
      stableUrl: LEGACY_STABLE_URL,
      basePath: RECIPE_BASE_PATH,
      manifestPath: RECIPE_MANIFEST_PATH,
      serviceWorkerPath: RECIPE_SERVICE_WORKER_PATH,
      cacheName: RECIPE_CACHE_NAME,
    },
    overallStatus,
    notice: 'alpha.20 recette web isolée : PWA/CSP/SW limités au dépôt recette, non RC, non production, v23 stable inchangée.',
  };
}
