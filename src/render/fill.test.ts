import { afterEach, describe, expect, it } from 'vitest';
import type { Fill } from '../core/types';
import { createFakeContext, installFakeContext, type FakeContextInstall } from './fake-context';
import {
  contrastRatio,
  createCanvas,
  createRng,
  cssToken,
  fillBaseColor,
  fitRect,
  hashString,
  isDarkColor,
  mixColors,
  paintBackingBand,
  paintCornerWear,
  paintEdgeShadow,
  paintFill,
  paintGrain,
  paintSheen,
  parseColor,
  rect,
  relativeLuminance,
  roundedRectPath,
  textNeedsBacking,
  withAlpha,
} from './fill';
import type { ImageCache } from './images';

const noImages = { get: () => null } as unknown as ImageCache;

describe('colores', () => {
  it('analiza hexadecimales, rgb(), hsl() y nombres', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#1c1b19')).toEqual({ r: 28, g: 27, b: 25, a: 1 });
    expect(parseColor('#00000080')?.a).toBeCloseTo(0.5, 1);
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor('rgba(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor('rgb(100%, 0%, 50%)')).toEqual({ r: 255, g: 0, b: 128, a: 1 });
    expect(parseColor('hsl(0, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('hsl(120deg 100% 25%)')).toEqual({ r: 0, g: 128, b: 0, a: 1 });
    expect(parseColor('White')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('transparent')?.a).toBe(0);
    expect(parseColor('')).toBeNull();
    expect(parseColor('#12')).toBeNull();
    expect(parseColor('#zzzzzz')).toBeNull();
    expect(parseColor('color-mix(in srgb, red, blue)')).toBeNull();
  });

  it('calcula luminancia y contraste', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0, a: 1 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(1);
    expect(contrastRatio(parseColor('#000')!, parseColor('#fff')!)).toBeCloseTo(21);
    expect(isDarkColor('#1c1b19')).toBe(true);
    expect(isDarkColor('#f1e6cf')).toBe(false);
    expect(isDarkColor('nada', true)).toBe(true);
  });

  it('decide cuándo el texto necesita una banda detrás', () => {
    expect(textNeedsBacking('#1c1b19', '#1c1b19')).toBe(true);
    expect(textNeedsBacking('#f1e6cf', '#e6d3a8')).toBe(true);
    expect(textNeedsBacking('#1c1b19', '#f1e6cf')).toBe(false);
    expect(textNeedsBacking('desconocido', '#f1e6cf')).toBe(false);
  });

  it('withAlpha, mixColors y fillBaseColor', () => {
    expect(withAlpha('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
    expect(withAlpha('raro', 0.5)).toBe('raro');
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('rgba(128, 128, 128, 1)');
    expect(mixColors('raro', '#fff', 0.5)).toBe('raro');
    expect(fillBaseColor({ kind: 'solid', color: '#123' }, '#000')).toBe('#123');
    expect(fillBaseColor({ kind: 'gradient', from: '#000', to: '#fff', angleDeg: 0, radial: false }, '#000')).toBe(
      'rgba(128, 128, 128, 1)',
    );
    expect(fillBaseColor({ kind: 'image', image: { blobKey: 'k' }, fit: 'cover', backdrop: '#abc' }, '#000')).toBe('#abc');
    expect(fillBaseColor(null, '#000')).toBe('#000');
  });
});

describe('azar determinista', () => {
  it('la misma semilla da la misma secuencia y otra semilla, otra', () => {
    const a = createRng('vin_1|front');
    const b = createRng('vin_1|front');
    const c = createRng('vin_2|front');
    const sa = [a(), a(), a()];
    expect(sa).toEqual([b(), b(), b()]);
    expect(sa).not.toEqual([c(), c(), c()]);
    for (const v of sa) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});

describe('geometría', () => {
  it('fitRect cubre o contiene', () => {
    const box = rect(0, 0, 100, 100);
    expect(fitRect(200, 100, box, 'cover')).toEqual({ x: -50, y: 0, w: 200, h: 100 });
    expect(fitRect(200, 100, box, 'contain')).toEqual({ x: 0, y: 25, w: 100, h: 50 });
    expect(fitRect(0, 0, box, 'cover')).toEqual(box);
  });

  it('createCanvas redondea y devuelve el contexto si existe', () => {
    const { canvas, ctx } = createCanvas(99.6, 0);
    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(1);
    expect(ctx).toBeNull();
  });

  it('cssToken devuelve el valor alternativo sin tokens definidos', () => {
    expect(cssToken('--token-inexistente', '#123456')).toBe('#123456');
  });
});

describe('dibujo con contexto falso', () => {
  let install: FakeContextInstall;
  afterEach(() => install?.restore());

  it('paintFill con color plano pinta un rectángulo del color', () => {
    const ctx = createFakeContext(document.createElement('canvas'));
    paintFill(ctx, { kind: 'solid', color: '#abcdef' }, rect(1, 2, 3, 4), noImages);
    expect(ctx.fillStyle).toBe('#abcdef');
    expect(ctx.calls.find((c) => c.name === 'fillRect')?.args).toEqual([1, 2, 3, 4]);
  });

  it('paintFill con degradado crea el lineal o el radial', () => {
    const ctx = createFakeContext(document.createElement('canvas'));
    paintFill(ctx, { kind: 'gradient', from: '#000', to: '#fff', angleDeg: 90, radial: false }, rect(0, 0, 10, 10), noImages);
    expect(ctx.calls.some((c) => c.name === 'createLinearGradient')).toBe(true);
    paintFill(ctx, { kind: 'gradient', from: '#000', to: '#fff', angleDeg: 0, radial: true }, rect(0, 0, 10, 10), noImages);
    expect(ctx.calls.some((c) => c.name === 'createRadialGradient')).toBe(true);
  });

  it('paintFill con imagen no cargada pinta solo el fondo y no llama a drawImage', () => {
    const ctx = createFakeContext(document.createElement('canvas'));
    const fill: Fill = { kind: 'image', image: { blobKey: 'k' }, fit: 'cover', backdrop: '#123456' };
    paintFill(ctx, fill, rect(0, 0, 50, 50), noImages);
    expect(ctx.calls.some((c) => c.name === 'set:fillStyle' && c.args[0] === '#123456')).toBe(true);
    expect(ctx.calls.some((c) => c.name === 'drawImage')).toBe(false);
  });

  it('paintFill con imagen cargada la dibuja recortada al rectángulo', () => {
    const ctx = createFakeContext(document.createElement('canvas'));
    const img = { naturalWidth: 200, naturalHeight: 100 } as HTMLImageElement;
    const images = { get: () => img } as unknown as ImageCache;
    const fill: Fill = { kind: 'image', image: { blobKey: 'k' }, fit: 'cover', backdrop: '#123456' };
    paintFill(ctx, fill, rect(0, 0, 100, 100), images);
    const draw = ctx.calls.find((c) => c.name === 'drawImage');
    expect(draw?.args).toEqual([img, -50, 0, 200, 100]);
    expect(ctx.calls.some((c) => c.name === 'clip')).toBe(true);
  });

  it('las texturas no lanzan y el grano usa un patrón repetido', () => {
    install = installFakeContext();
    const { canvas, ctx } = createCanvas(64, 64);
    expect(ctx).not.toBeNull();
    const box = rect(0, 0, canvas.width, canvas.height);
    paintGrain(ctx!, box, 'semilla', 0.2);
    paintSheen(ctx!, box, 0.15);
    paintEdgeShadow(ctx!, box, 4, 0.2);
    paintCornerWear(ctx!, box, 'semilla', 0.1);
    paintBackingBand(ctx!, rect(10, 10, 20, 20), '#1c1b19', 2, 2);
    roundedRectPath(ctx!, rect(0, 0, 10, 10), 3);
    const calls = (ctx as unknown as { calls: { name: string; args: unknown[] }[] }).calls;
    expect(calls.some((c) => c.name === 'createPattern')).toBe(true);
    expect(calls.some((c) => c.name === 'set:fillStyle' && c.args[0] === 'rgba(255, 255, 255, 0.62)')).toBe(true);
    expect(calls.filter((c) => c.name === 'arcTo').length).toBeGreaterThanOrEqual(4);
  });
});
