import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { presetFull, presetNormal, presetRing, solid, track } from '../core/defaults';
import type { Vinyl, VinylMeta } from '../core/types';
import { installFakeContext, type FakeContextInstall } from './fake-context';
import { ImageCache } from './images';
import { renderGatefoldInside, renderJacketBack, renderJacketFront, renderSpine, spineWidthMm } from './jacket';

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

function tracks() {
  return [track('Cosita loca llamada amor', 161), track('Alguien a quien amar', 295), track('Ahora estoy aquí', 255)];
}

function presets(): Vinyl[] {
  return [presetNormal(META, tracks(), tracks()), presetRing(META, tracks(), tracks()), presetFull(META, tracks())];
}

const images = fakeImages();

describe('sin contexto 2D (happy-dom)', () => {
  it('cada función devuelve un canvas del tamaño pedido para los tres presets', () => {
    for (const v of presets()) {
      expect(renderJacketFront(v, 256, images)).toMatchObject({ width: 256, height: 256 });
      expect(renderJacketBack(v, 256, images)).toMatchObject({ width: 256, height: 256 });
      expect(renderGatefoldInside(v, 256, images)).toMatchObject({ width: 512, height: 256 });
      expect(renderSpine(v, 24, 300, images)).toMatchObject({ width: 24, height: 300 });
    }
  });

  it('redondea tamaños fraccionarios y nunca da cero', () => {
    const v = presetNormal(META);
    expect(renderJacketFront(v, 299.6, images).width).toBe(300);
    expect(renderSpine(v, 0, 0, images)).toMatchObject({ width: 1, height: 1 });
  });

  it('spineWidthMm: el desplegable es más ancho y crece con el grosor', () => {
    const single = presetNormal(META);
    const gatefold = presetFull(META);
    expect(spineWidthMm(gatefold)).toBeGreaterThan(spineWidthMm(single));
    const thick = presetNormal(META);
    thick.disc.thicknessMm = 2.4;
    expect(spineWidthMm(thick)).toBeGreaterThan(spineWidthMm(single));
    expect(spineWidthMm(single)).toBeGreaterThanOrEqual(3);
    expect(spineWidthMm(single)).toBeLessThanOrEqual(6);
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

  it('la portada escribe artista y título con el estilo (mayúsculas)', () => {
    renderJacketFront(presetNormal(META, tracks(), tracks()), 400, images);
    expect(first().texts).toContain('QUEEN');
    expect(first().texts.some((t) => t.includes('GRANDES'))).toBe(true);
  });

  it('sin título en portada no escribe nada', () => {
    const v = presetNormal(META);
    v.jacket.showTitleOnFront = false;
    renderJacketFront(v, 400, images);
    expect(first().texts).toEqual([]);
  });

  it('un título larguísimo se encoge y se parte en varias líneas sin lanzar', () => {
    const v = presetNormal({ ...META, title: 'Una colección de canciones interminable para la posteridad' });
    renderJacketFront(v, 300, images);
    expect(first().texts.length).toBeGreaterThan(2);
  });

  it('pegatina y esquina cortada', () => {
    const v = presetNormal(META);
    v.jacket.sticker = { text: 'Oferta 5 €', color: '#ffd166' };
    v.jacket.cutCorner = true;
    renderJacketFront(v, 400, images);
    const joined = first().texts.join(' ');
    expect(joined).toContain('Oferta');
    expect(joined).toContain('5 €');
    expect(has('arc')).toBe(true);
    expect(has('set:globalCompositeOperation', 'destination-out')).toBe(true);
    expect(has('set:shadowColor')).toBe(true);
  });

  it('acabado textured usa un patrón de grano; matte no', () => {
    const textured = presetNormal(META);
    textured.jacket.finish = 'textured';
    renderJacketFront(textured, 200, images);
    expect(has('createPattern')).toBe(true);
    install.contexts.length = 0;
    const matte = presetNormal(META);
    matte.jacket.finish = 'matte';
    renderJacketFront(matte, 200, images);
    expect(has('createPattern')).toBe(false);
  });

  it('una portada de imagen aún no cargada pinta el fondo y no dibuja la imagen', () => {
    const v = presetNormal(META);
    v.jacket.front = { kind: 'image', image: { blobKey: 'nada' }, fit: 'cover', backdrop: '#123456' };
    renderJacketFront(v, 300, images);
    expect(has('set:fillStyle', '#123456')).toBe(true);
    expect(has('drawImage')).toBe(false);
  });

  it('la contraportada lista las caras con numeración y duraciones m:ss, y el pie', () => {
    renderJacketBack(presetNormal(META, tracks(), tracks()), 500, images);
    const texts = first().texts;
    expect(texts).toContain('Cara A');
    expect(texts).toContain('Cara B');
    expect(texts).toContain('1.');
    expect(texts).toContain('2:41');
    expect(texts).toContain('4:55');
    expect(texts).toContain('EMI');
    expect(texts).toContain('8023 · 1981');
    expect(texts.some((t) => /^\d{13}$/.test(t))).toBe(true);
  });

  it('con una sola cara con canciones solo aparece esa cara', () => {
    renderJacketBack(presetFull(META, tracks()), 500, images);
    expect(first().texts).toContain('Cara A');
    expect(first().texts).not.toContain('Cara B');
  });

  it('sin lista ni notas, solo el pie', () => {
    const v = presetNormal(META, tracks(), tracks());
    v.jacket.showTracklistOnBack = false;
    renderJacketBack(v, 500, images);
    expect(first().texts).not.toContain('Cara A');
    expect(first().texts).toContain('EMI');
  });

  it('las notas se maquetan en párrafos y, si no caben, se recortan con puntos suspensivos', () => {
    const v = presetNormal(META, tracks(), tracks());
    v.jacket.backNotes = 'Grabado en los estudios de la calle Mayor.\n\n' + 'palabra '.repeat(900);
    renderJacketBack(v, 300, images);
    const texts = first().texts;
    expect(texts.some((t) => t.includes('Grabado'))).toBe(true);
    expect(texts.some((t) => t.endsWith('…'))).toBe(true);
  });

  it('pone una banda translúcida cuando el texto se confunde con el fondo, sin cambiar el color', () => {
    const v = presetNormal(META, tracks(), tracks());
    v.jacket.back = solid('#1c1b19');
    v.jacket.backStyle = { ...v.jacket.backStyle, color: '#1c1b19' };
    renderJacketBack(v, 400, images);
    expect(has('set:fillStyle', 'rgba(255, 255, 255, 0.62)')).toBe(true);
    expect(has('set:fillStyle', '#1c1b19')).toBe(true);
    install.contexts.length = 0;
    const ok = presetNormal(META, tracks(), tracks());
    renderJacketBack(ok, 400, images);
    expect(has('set:fillStyle', 'rgba(255, 255, 255, 0.62)')).toBe(false);
  });

  it('el interior desplegable maqueta el texto de la funda interior en el panel derecho si no hay relleno', () => {
    const v = presetFull(META, tracks());
    v.innerSleeve.text = 'Letra de la primera canción\n\nLetra de la segunda canción';
    renderGatefoldInside(v, 300, images);
    expect(first().texts.some((t) => t.includes('Letra'))).toBe(true);
    install.contexts.length = 0;
    v.jacket.insideRight = solid('#ffffff');
    renderGatefoldInside(v, 300, images);
    expect(first().texts).toEqual([]);
  });

  it('el lomo gira el texto −90° y escribe franja, título y catálogo', () => {
    const v = presetRing(META, tracks(), tracks());
    renderSpine(v, 30, 400, images);
    const ctx = first();
    expect(ctx.texts).toContain('QUEEN — GRANDES ÉXITOS');
    expect(ctx.texts).toContain('8023');
    expect(ctx.calls.find((c) => c.name === 'rotate')?.args[0]).toBeCloseTo(-Math.PI / 2);
    expect(has('set:fillStyle', '#d1302a')).toBe(true);
  });

  it('el lomo sin catálogo ni franja solo escribe el texto', () => {
    const v = presetNormal(META, tracks(), tracks());
    v.spine.showCatalogNumber = false;
    renderSpine(v, 30, 400, images);
    expect(first().texts).toEqual(['QUEEN — GRANDES ÉXITOS']);
  });

  it('un texto de lomo larguísimo se recorta con puntos suspensivos', () => {
    const v = presetNormal(META);
    v.spine.text = 'Palabra '.repeat(80);
    renderSpine(v, 30, 200, images);
    const main = first().texts.find((t) => t.startsWith('PALABRA'));
    expect(main?.endsWith('…')).toBe(true);
  });

  it('un lomo con texto en blanco usa el texto derivado de los datos', () => {
    const v = presetNormal(META);
    v.spine.text = '   ';
    renderSpine(v, 30, 300, images);
    expect(first().texts).toContain('QUEEN — GRANDES ÉXITOS');
  });

  it('tamaños mínimos no lanzan', () => {
    const v = presetFull(META, tracks());
    v.jacket.sticker = { text: 'x', color: '#fff' };
    v.jacket.cutCorner = true;
    v.jacket.backNotes = 'notas';
    v.innerSleeve.text = 'letra';
    expect(() => renderJacketFront(v, 2, images)).not.toThrow();
    expect(() => renderJacketBack(v, 2, images)).not.toThrow();
    expect(() => renderGatefoldInside(v, 2, images)).not.toThrow();
    expect(() => renderSpine(v, 1, 1, images)).not.toThrow();
  });
});
