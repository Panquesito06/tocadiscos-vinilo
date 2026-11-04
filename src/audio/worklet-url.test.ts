import { afterEach, describe, expect, it, vi } from 'vitest';
import { workletUrl } from './worklet-url';

describe('workletUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('con base "/" resuelve en la raíz del origen', () => {
    expect(workletUrl('player-processor', '/', 'http://localhost:5173/')).toBe(
      'http://localhost:5173/worklets/player-processor.js',
    );
  });

  it('con base "./" resuelve relativo a document.baseURI, no a /worklets', () => {
    const url = workletUrl('player-processor', './', 'https://example.com/apps/tocadiscos/index.html');
    expect(url).toBe('https://example.com/apps/tocadiscos/worklets/player-processor.js');
    expect(url.endsWith('worklets/player-processor.js')).toBe(true);
    expect(new URL(url).pathname.startsWith('/worklets')).toBe(false);
  });

  it('garantiza la barra final de la base', () => {
    expect(workletUrl('surface-processor', '/app', 'http://localhost/')).toBe('http://localhost/app/worklets/surface-processor.js');
    expect(workletUrl('surface-processor', '/app/', 'http://localhost/')).toBe('http://localhost/app/worklets/surface-processor.js');
  });

  it('usa import.meta.env.BASE_URL y document.baseURI por defecto', () => {
    vi.stubEnv('BASE_URL', './');
    const url = workletUrl('player-processor');
    expect(url.endsWith('worklets/player-processor.js')).toBe(true);
    expect(url).toBe(new URL('./worklets/player-processor.js', document.baseURI).href);
    expect(url.startsWith(document.baseURI.replace(/[^/]*$/, ''))).toBe(true);
  });

  it('sin una base válida devuelve la ruta relativa', () => {
    expect(workletUrl('player-processor', './', 'about:blank')).toBe('./worklets/player-processor.js');
  });
});
