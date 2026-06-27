import {
  LEGACY_STABLE_URL,
  RECIPE_BASE_PATH,
  RECIPE_CACHE_NAME,
  RECIPE_SERVICE_WORKER_PATH,
  type DeploymentLocationLike,
} from '@/constants/deployment';

export interface RecipeServiceWorkerStatus {
  supported: boolean;
  allowed: boolean;
  scriptUrl: typeof RECIPE_SERVICE_WORKER_PATH;
  scope: typeof RECIPE_BASE_PATH;
  cacheName: typeof RECIPE_CACHE_NAME;
  reason: string;
}

export interface RecipeServiceWorkerOptions {
  allowLocalhost?: boolean;
  logger?: Pick<Console, 'log' | 'warn'>;
}

type ServiceWorkerNavigator = Navigator & {
  serviceWorker?: ServiceWorkerContainer;
};

function getRuntimeWindow(): Window | null {
  if (typeof window === 'undefined') return null;
  return window;
}

function getRuntimeNavigator(): ServiceWorkerNavigator | null {
  if (typeof navigator === 'undefined') return null;
  return navigator as ServiceWorkerNavigator;
}

function isLocalHost(hostname: string | undefined): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function isServiceWorkerAllowedForRecipe(
  locationLike: DeploymentLocationLike | null = getRuntimeWindow()?.location ?? null,
  options: Pick<RecipeServiceWorkerOptions, 'allowLocalhost'> = {}
): boolean {
  if (!locationLike?.pathname.startsWith(RECIPE_BASE_PATH)) return false;
  if (locationLike.pathname.startsWith(new URL(LEGACY_STABLE_URL).pathname)) return false;
  if (!options.allowLocalhost && isLocalHost(locationLike.hostname)) return false;
  return true;
}

export function getRecipeServiceWorkerStatus(
  locationLike: DeploymentLocationLike | null = getRuntimeWindow()?.location ?? null,
  options: Pick<RecipeServiceWorkerOptions, 'allowLocalhost'> = {}
): RecipeServiceWorkerStatus {
  const nav = getRuntimeNavigator();
  const supported = Boolean(nav?.serviceWorker);
  const allowed = supported && isServiceWorkerAllowedForRecipe(locationLike, options);

  return {
    supported,
    allowed,
    scriptUrl: RECIPE_SERVICE_WORKER_PATH,
    scope: RECIPE_BASE_PATH,
    cacheName: RECIPE_CACHE_NAME,
    reason: allowed
      ? 'recipe path allowed'
      : supported
        ? 'not recipe path'
        : 'service worker unsupported',
  };
}

export async function registerRecipeServiceWorker(
  options: RecipeServiceWorkerOptions = {}
): Promise<RecipeServiceWorkerStatus> {
  const status = getRecipeServiceWorkerStatus(undefined, options);
  const logger = options.logger ?? console;

  if (!status.allowed) {
    logger.log('[NIMR V24 Recette] Service worker skipped: not recipe path');
    return status;
  }

  const nav = getRuntimeNavigator();
  try {
    await nav?.serviceWorker?.register(RECIPE_SERVICE_WORKER_PATH, { scope: RECIPE_BASE_PATH });
    logger.log('[NIMR V24 Recette] Service worker registered');
  } catch (error) {
    logger.warn('[NIMR V24 Recette] Service worker skipped: registration failed', error);
  }

  return status;
}

export async function unregisterRecipeServiceWorker(
  options: RecipeServiceWorkerOptions = {}
): Promise<boolean> {
  const status = getRecipeServiceWorkerStatus(undefined, options);
  if (!status.allowed) return false;

  const nav = getRuntimeNavigator();
  const registration = await nav?.serviceWorker?.getRegistration(RECIPE_BASE_PATH);
  return registration ? registration.unregister() : false;
}
