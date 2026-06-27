import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
  getRecipeServiceWorkerStatus,
  isServiceWorkerAllowedForRecipe,
  registerRecipeServiceWorker,
} from '../src/pwa/registerRecipeServiceWorker';

const serviceWorkerPath = resolve(__dirname, '../public/sw-v24-recette.js');

describe('Service worker recette alpha.20', () => {
  it('ships an isolated recipe service worker file', () => {
    expect(existsSync(serviceWorkerPath)).toBe(true);
    const content = readFileSync(serviceWorkerPath, 'utf-8');
    expect(content).toContain("const CACHE_NAME = 'nimr-sav-v24-alpha20-recette'");
    expect(content).toContain("const RECIPE_SCOPE = '/NIMR-SAV-V24-RECETTE/'");
    expect(content).toContain('CACHE_PREFIX');
  });

  it('does not reference legacy cache names in the worker', () => {
    const content = readFileSync(serviceWorkerPath, 'utf-8');
    const legacyCache = ['nimr', 'sav', 'v23'].join('-');
    const legacyWorkshop = ['nimr', 'carrosserie'].join('-');
    expect(content).not.toContain(legacyCache);
    expect(content).not.toContain(legacyWorkshop);
  });

  it('allows only the recipe path and refuses the stable path', () => {
    expect(isServiceWorkerAllowedForRecipe({
      pathname: '/NIMR-SAV-V24-RECETTE/',
      hostname: 'irondrass.github.io',
      protocol: 'https:',
    })).toBe(true);
    expect(isServiceWorkerAllowedForRecipe({
      pathname: '/NIMR-SAV/',
      hostname: 'irondrass.github.io',
      protocol: 'https:',
    })).toBe(false);
  });

  it('refuses localhost unless explicitly allowed', () => {
    const localRecipe = {
      pathname: '/NIMR-SAV-V24-RECETTE/',
      hostname: 'localhost',
      protocol: 'http:',
    };
    expect(isServiceWorkerAllowedForRecipe(localRecipe)).toBe(false);
    expect(isServiceWorkerAllowedForRecipe(localRecipe, { allowLocalhost: true })).toBe(true);
  });

  it('does not crash in the Vitest Node environment', async () => {
    const logger = { log: () => undefined, warn: () => undefined };
    const status = getRecipeServiceWorkerStatus();
    expect(status.supported).toBe(false);
    await expect(registerRecipeServiceWorker({ logger })).resolves.toMatchObject({
      supported: false,
      allowed: false,
      scope: '/NIMR-SAV-V24-RECETTE/',
    });
  });
});
