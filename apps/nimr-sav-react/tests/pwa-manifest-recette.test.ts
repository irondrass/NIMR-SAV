import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const publicRoot = resolve(__dirname, '../public');
const manifestPath = resolve(publicRoot, 'manifest.webmanifest');

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface RecipeManifest {
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
}

function readManifest(): RecipeManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf-8')) as RecipeManifest;
}

describe('PWA manifest recette alpha.20', () => {
  it('ships a manifest with recipe scope and start URL', () => {
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = readManifest();
    expect(manifest.name).toBe('NIMR SAV V24 Recette');
    expect(manifest.short_name).toBe('NIMR V24');
    expect(manifest.description).toBe('NIMR SAV v24 alpha recette');
    expect(manifest.start_url).toBe('/NIMR-SAV-V24-RECETTE/');
    expect(manifest.scope).toBe('/NIMR-SAV-V24-RECETTE/');
    expect(manifest.display).toBe('standalone');
  });

  it('declares PNG icons in 192 and 512 sizes', () => {
    const manifest = readManifest();
    const icon192 = manifest.icons.find((icon) => icon.sizes === '192x192');
    const icon512 = manifest.icons.find((icon) => icon.sizes === '512x512');

    expect(icon192?.src).toBe('/NIMR-SAV-V24-RECETTE/icons/icon-192.png');
    expect(icon512?.src).toBe('/NIMR-SAV-V24-RECETTE/icons/icon-512.png');
    expect(icon192?.type).toBe('image/png');
    expect(icon512?.type).toBe('image/png');
    expect(existsSync(resolve(publicRoot, 'icons/icon-192.png'))).toBe(true);
    expect(existsSync(resolve(publicRoot, 'icons/icon-512.png'))).toBe(true);
  });

  it('uses valid PNG signatures for generated icons', () => {
    const pngSignature = '89504e470d0a1a0a';
    for (const fileName of ['icon-192.png', 'icon-512.png']) {
      const bytes = readFileSync(resolve(publicRoot, 'icons', fileName)).subarray(0, 8);
      expect(bytes.toString('hex')).toBe(pngSignature);
    }
  });
});
