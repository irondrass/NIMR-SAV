import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const indexHtml = readFileSync(resolve(__dirname, '../index.html'), 'utf-8');

function extractCsp(): string {
  const match = indexHtml.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  return match?.[1] ?? '';
}

describe('index.html CSP and fallback alpha.20', () => {
  it('links the recipe manifest and declares noindex metadata', () => {
    expect(indexHtml).toContain('rel="manifest" href="/NIMR-SAV-V24-RECETTE/manifest.webmanifest"');
    expect(indexHtml).toContain('name="robots" content="noindex,nofollow"');
    expect(indexHtml).toContain('name="application-name" content="NIMR SAV V24 Recette"');
  });

  it('declares a strict CSP compatible with the static React build', () => {
    const csp = extractCsp();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("manifest-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('*');
  });

  it('keeps noscript and lightweight root fallback text', () => {
    expect(indexHtml).toContain('JavaScript est nécessaire pour lancer NIMR SAV V24 Recette.');
    expect(indexHtml).toContain('<div id="root">Chargement de NIMR SAV V24 Recette...</div>');
  });
});
