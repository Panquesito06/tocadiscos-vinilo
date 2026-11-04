import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { presetFull, presetNormal, presetRing, solid, track } from '../core/defaults';
import { discGeometry } from '../core/geometry';
import type { Vinyl, VinylMeta } from '../core/types';
import { installFakeContext, type FakeContextInstall } from './fake-context';
import { ImageCache } from './images';
import { renderInnerSleeve, renderOuterSleeve, sleeveTextColumns } from './sleeves';

function fakeImages(): ImageCache {
  const blobs = {
    put: async () => 'k',
    get: async () => null,
    delete: async () => undefined,
    url: async () => null,
    cachedUrl: () => null,
  };
  return new ImageCache(blobs as unknown as ConstructorParameters<typeof ImageCache>[0]);
}

const META: Partial<VinylMeta> = { artist: 'Queen', title: 'Grandes éxitos', year: '1981', labelName: 'EMI', catalogNumber: '8023' };
const images = fakeImages();

function presets(): Vinyl[] {
  const t = [track('Uno', 100), track('Dos', 200)];
  return [presetNormal(META, t, t), presetRing(META, t, t), presetFull(META, t)];
}

describe('sin contexto 2D (happy-dom)', () => {
  it('la funda interior devuelve un canvas del tamaño pedido en ambas caras para los tres presets', () => {
    for (const v of presets()) {
      expect(renderInnerSleeve(v, 240, 'front', images)).toMatchObject({ width: 240, height: 240 });
      expect(renderInnerSleeve(v, 240, 'back', images)).toMatchObject({ width: 240, height: 240 });
    }
  });

  it('la funda exterior devuelve null con none y un canvas con el resto de tipos', () => {
    const v = presetNormal(META);
    v.outerSleeve.kind = 'none';
    expect(renderOuterSleeve(v, 240, images)).toBeNull();
    for (const kind of ['pvc-clear', 'pvc-tinted', 'printed', 'resealable'] as const) {
      v.outerSleeve.kind = kind;
      expect(renderOuterSleeve(v, 240, images)).toMatchObject({ width: 240, height: 240 });
    }
  });

  it('la funda interior none devuelve un canvas vacío del tamaño pedido', () => {
    const v = presetNormal(META);
    v.innerSleeve.kind = 'none';
    expect(renderInnerSleeve(v, 100, 'front', images)).toMatchObject({ width: 100, height: 100 });
  });
});

describe('columnas de texto de la funda interior', () => {
  it('sin troquel: dos columnas iguales', () => {
    const cols = sleeveTextColumns(1000, 0);
    expect(cols).toHaveLength(2);
    expect(cols[0]!.w).toBeCloseTo(cols[1]!.w);
    expect(cols[0]!.y).toBe(cols[1]!.y);
    expect(cols[1]!.x).toBeGreaterThan(cols[0]!.x + cols[0]!.w);
  });

  it('con troquel pequeño (12"): columnas a los lados del círculo', () => {
    const geo = discGeometry('12');
    const r = ((geo.labelRadiusMm + 2) / (2 * geo.radiusMm)) * 1000;
    const cols = sleeveTextColumns(1000, r);
    expect(cols[0]!.x + cols[0]!.w).toBeLessThan(500 - r);
    expect(cols[1]!.x).toBeGreaterThan(500 + r);
    expect(cols[0]!.y).toBe(cols[1]!.y);
  });

  it('con troquel grande (7"): una banda encima y otra debajo', () => {
    const geo = discGeometry('7');
    const r = ((geo.labelRadiusMm + 2) / (2 * geo.radiusMm)) * 1000;
    const cols = sleeveTextColumns(1000, r);
    expect(cols[0]!.w).toBeCloseTo(cols[1]!.w);
    expect(cols[0]!.y + cols[0]!.h).toBeLessThanOrEqual(500 - r);
    expect(cols[1]!.y).toBeGreaterThanOrEqual(500 + r);
  });
});

describe('con contexto falso', () => {
  let install: FakeContextInstall;
  beforeEach(() => {
    install = installFakeContext();
  });
  afterEach(() => install.restore());

  const first = () => install.contexts[0]!;
  const has = (name: string, value?: unknown) =>
    first().calls.some((c) => c.name === name && (value === undefined || c.args[0] === value));

  it('el troquel es un círculo transparente de radio labelRadiusMm + 2 mm a la escala del disco', () => {
    const v = presetNormal(META);
    const geo = discGeometry('12');
    const size = 2 * geo.radiusMm;
    renderInnerSleeve(v, size, 'front', images);
    expect(has('set:globalCompositeOperation', 'destination-out')).toBe(true);
    const arc = first().calls.find((c) => c.name === 'arc');
    expect(arc?.args[2]).toBeCloseTo(geo.labelRadiusMm + 2);
    install.contexts.length = 0;
    v.innerSleeve.cutout = false;
    renderInnerSleeve(v, size, 'front', images);
    expect(has('set:globalCompositeOperation', 'destination-out')).toBe(false);
  });

  it('el papel se pinta con innerSleeve.color y grano', () => {
    const v = presetNormal(META);
    v.innerSleeve.kind = 'paper-kraft';
    v.innerSleeve.color = '#c9a66b';
    renderInnerSleeve(v, 300, 'front', images);
    expect(has('set:fillStyle', '#c9a66b')).toBe(true);
    expect(has('createPattern')).toBe(true);
  });

  it('la funda impresa usa printFront o printBack según la cara, y papel blanco si falta', () => {
    const v = presetNormal(META);
    v.innerSleeve.kind = 'printed';
    v.innerSleeve.printFront = solid('#112233');
    v.innerSleeve.printBack = solid('#445566');
    renderInnerSleeve(v, 300, 'front', images);
    expect(has('set:fillStyle', '#112233')).toBe(true);
    expect(has('set:fillStyle', '#445566')).toBe(false);
    install.contexts.length = 0;
    renderInnerSleeve(v, 300, 'back', images);
    expect(has('set:fillStyle', '#445566')).toBe(true);
    install.contexts.length = 0;
    v.innerSleeve.printBack = null;
    renderInnerSleeve(v, 300, 'back', images);
    expect(has('set:fillStyle', '#f3f1ec')).toBe(true);
  });

  it('el texto se maqueta en ambas caras y recibe banda si se confunde con el papel', () => {
    const v = presetNormal(META);
    v.innerSleeve.text = 'Letra de la canción\n\nCréditos: grabado en directo';
    renderInnerSleeve(v, 400, 'front', images);
    expect(first().texts.some((t) => t.includes('Letra'))).toBe(true);
    expect(has('set:fillStyle', 'rgba(255, 255, 255, 0.62)')).toBe(false);
    install.contexts.length = 0;
    renderInnerSleeve(v, 400, 'back', images);
    expect(first().texts.some((t) => t.includes('Créditos:'))).toBe(true);
    install.contexts.length = 0;
    v.innerSleeve.kind = 'paper-black';
    v.innerSleeve.color = '#1c1b19';
    renderInnerSleeve(v, 400, 'front', images);
    expect(has('set:fillStyle', 'rgba(255, 255, 255, 0.62)')).toBe(true);
  });

  it('la funda none no dibuja nada', () => {
    const v = presetNormal(META);
    v.innerSleeve.kind = 'none';
    v.innerSleeve.text = 'algo';
    renderInnerSleeve(v, 300, 'front', images);
    expect(first().calls).toEqual([]);
  });

  it('la poly-lined añade reflejo satinado', () => {
    const v = presetFull(META);
    renderInnerSleeve(v, 300, 'front', images);
    expect(has('set:fillStyle', '#f3f1ec')).toBe(true);
    expect(first().calls.filter((c) => c.name === 'createLinearGradient').length).toBeGreaterThan(4);
  });

  it('la funda exterior tintada aplica el tinte con su opacidad', () => {
    const v = presetNormal(META);
    v.outerSleeve = { kind: 'pvc-tinted', tint: '#ff8800', opacity: 0.3, print: null, gloss: 0.5 };
    renderOuterSleeve(v, 300, images);
    expect(has('set:globalAlpha', 0.3)).toBe(true);
    expect(has('set:fillStyle', '#ff8800')).toBe(true);
  });

  it('la funda impresa dibuja el print con opacidad y la resellable, su tira adhesiva', () => {
    const v = presetNormal(META);
    v.outerSleeve = { kind: 'printed', tint: '#fff', opacity: 0.8, print: solid('#224466'), gloss: 0.2 };
    renderOuterSleeve(v, 300, images);
    expect(has('set:globalAlpha', 0.8)).toBe(true);
    expect(has('set:fillStyle', '#224466')).toBe(true);
    install.contexts.length = 0;
    v.outerSleeve = { kind: 'pvc-clear', tint: '#fff', opacity: 0.1, print: null, gloss: 0.6 };
    renderOuterSleeve(v, 300, images);
    const clearRects = first().calls.filter((c) => c.name === 'fillRect').length;
    install.contexts.length = 0;
    v.outerSleeve.kind = 'resealable';
    renderOuterSleeve(v, 300, images);
    expect(first().calls.filter((c) => c.name === 'fillRect').length).toBeGreaterThan(clearRects);
  });

  it('tamaños mínimos no lanzan', () => {
    const v = presetNormal(META);
    v.innerSleeve.text = 'letra';
    expect(() => renderInnerSleeve(v, 2, 'front', images)).not.toThrow();
    expect(() => renderOuterSleeve(v, 2, images)).not.toThrow();
  });
});
