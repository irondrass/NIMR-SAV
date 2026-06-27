import { RESERVED_CACHE_NAME } from './version';

export const RECIPE_REPO_NAME = 'NIMR-SAV-V24-RECETTE' as const;
export const RECIPE_BASE_PATH = '/NIMR-SAV-V24-RECETTE/' as const;
export const RECIPE_PUBLIC_URL = 'https://irondrass.github.io/NIMR-SAV-V24-RECETTE/' as const;
export const LEGACY_STABLE_URL = 'https://irondrass.github.io/NIMR-SAV/' as const;
export const RECIPE_MANIFEST_PATH = `${RECIPE_BASE_PATH}manifest.webmanifest` as const;
export const RECIPE_SERVICE_WORKER_PATH = `${RECIPE_BASE_PATH}sw-v24-recette.js` as const;
export const RECIPE_CACHE_NAME = RESERVED_CACHE_NAME;

export interface DeploymentLocationLike {
  pathname: string;
  hostname?: string;
  protocol?: string;
}

export interface DeploymentTargetSummary {
  recipeRepoName: typeof RECIPE_REPO_NAME;
  recipeBasePath: typeof RECIPE_BASE_PATH;
  recipePublicUrl: typeof RECIPE_PUBLIC_URL;
  legacyStableUrl: typeof LEGACY_STABLE_URL;
  expectedBasePath: typeof RECIPE_BASE_PATH;
  isRecipe: boolean;
  cacheName: typeof RECIPE_CACHE_NAME;
}

function getRuntimeLocation(): DeploymentLocationLike | null {
  if (typeof window === 'undefined') return null;
  return window.location;
}

export function isRecipeDeployment(locationLike: DeploymentLocationLike | null = getRuntimeLocation()): boolean {
  return Boolean(locationLike?.pathname.startsWith(RECIPE_BASE_PATH));
}

export function getExpectedBasePath(): typeof RECIPE_BASE_PATH {
  return RECIPE_BASE_PATH;
}

export function summarizeDeploymentTarget(
  locationLike: DeploymentLocationLike | null = getRuntimeLocation()
): DeploymentTargetSummary {
  return {
    recipeRepoName: RECIPE_REPO_NAME,
    recipeBasePath: RECIPE_BASE_PATH,
    recipePublicUrl: RECIPE_PUBLIC_URL,
    legacyStableUrl: LEGACY_STABLE_URL,
    expectedBasePath: getExpectedBasePath(),
    isRecipe: isRecipeDeployment(locationLike),
    cacheName: RECIPE_CACHE_NAME,
  };
}
