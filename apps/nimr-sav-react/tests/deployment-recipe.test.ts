import { describe, expect, it } from 'vitest';
import {
  LEGACY_STABLE_URL,
  RECIPE_BASE_PATH,
  RECIPE_CACHE_NAME,
  RECIPE_PUBLIC_URL,
  RECIPE_REPO_NAME,
  getExpectedBasePath,
  isRecipeDeployment,
  summarizeDeploymentTarget,
} from '../src/constants/deployment';

describe('Deployment recipe target alpha.20', () => {
  it('exports the isolated recipe target constants', () => {
    expect(RECIPE_REPO_NAME).toBe('NIMR-SAV-V24-RECETTE');
    expect(RECIPE_BASE_PATH).toBe('/NIMR-SAV-V24-RECETTE/');
    expect(RECIPE_PUBLIC_URL).toBe('https://irondrass.github.io/NIMR-SAV-V24-RECETTE/');
    expect(LEGACY_STABLE_URL).toBe('https://irondrass.github.io/NIMR-SAV/');
    expect(RECIPE_CACHE_NAME).toBe('nimr-sav-v24-alpha20-recette');
  });

  it('detects recipe path without targeting the stable URL', () => {
    expect(isRecipeDeployment({ pathname: '/NIMR-SAV-V24-RECETTE/' })).toBe(true);
    expect(isRecipeDeployment({ pathname: '/NIMR-SAV/' })).toBe(false);
  });

  it('summarizes the GitHub Pages base path expected by Vite', () => {
    const summary = summarizeDeploymentTarget({ pathname: '/NIMR-SAV-V24-RECETTE/' });
    expect(summary.expectedBasePath).toBe('/NIMR-SAV-V24-RECETTE/');
    expect(getExpectedBasePath()).toBe('/NIMR-SAV-V24-RECETTE/');
    expect(summary.isRecipe).toBe(true);
  });
});
