import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVinyl, presetFull, presetNormal, presetRing, textStyle, track } from '../core/defaults';
import { discGeometry } from '../core/geometry';
import type { Vinyl } from '../core/types';
import { discCacheKey, layoutLabelText, renderDiscFace, type DiscRenderOptions, type LabelLayoutInput } from './disc';
import {
  chordHalfWidth,
  createRng,
  fitRect,
  formatDuration,
  hashString,
  mulberry32,
  shrinkToFit,
  smoothNoise,
  wrapText,
  wrapTextDetailed,
} from './draw-utils';
import { ImageCache } from './images';

/** Caché de imágenes sin almacén detrás: ninguna imagen está cargada. */
function emptyImages(): ImageCache {
  return new ImageCache({ url: async () => null } as never);
}

function opts(overrides: Partial<DiscRenderOptions> = {}): DiscRenderOptions {
  return { sizePx: 240, side: 'A', showDust: true, adapter45: false, spindle: false, quality: 'high', ...overrides };
}

/** Medidor falso: cada carácter mide la mitad del tamaño de letra (como una condensada). */
const fakeMeasure = (text: string, _style: unknown, sizePx: number): number => text.length * sizePx * 0.5;

/**
 * Contexto 2D falso: todos los métodos son no-ops y las medidas de texto
 * son proporcionales al tamaño de letra. Sirve para ejecutar todas las
 * rutas de dibujo en happy-dom (que no dibuja) y detectar excepciones.
 */
function fakeContext(log?: string[]): CanvasRenderingContext2D {
  const state: Record<string, unknown> = { font: '10px sans-serif', fontStretch: 'normal' };
  const gradient = { addColorStop: () => undefined };
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'measureText') {
        return (text: string) => {
          const size = parseFloat(String(state.font).match(/(\d+(?:\.\d+)?)px/)?.[1] ?? '10');
          return { width: text.length * size * 0.55 };
        };
      }
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      if (prop in state) return state[prop as string];
      return (...args: unknown[]) => {
        log?.push(`${String(prop)}(${args.map((a) => (typeof a === 'number' ? a.toFixed(3) : String(a))).join(',')})`);
      };
    },
    set(_target, prop, value) {
      state[prop as string] = value;
      log?.push(`${String(prop)}=${String(value)}`);
      return true;
    },
  };
  return new Proxy({}, handler) as CanvasRenderingContext2D;
}

/** Dibuja con un contexto falso que registra todas las llamadas y devuelve el registro. */
function recordRender(vinyl: Vinyl, o: DiscRenderOptions): string[] {
  const log: string[] = [];
  const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext(log) as never);
  try {
    renderDiscFace(vinyl, o, emptyImages());
  } finally {
    spy.mockRestore();
  }
  return log;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('discCacheKey', () => {
  it('cambia con el polvo redondeado y no con cambios imperceptibles', () => {
    const v = presetNormal({ artist: 'A', title: 'T' });
    v.disc.condition.dust = 0.5;
    const base = discCacheKey(v, opts());
    v.disc.condition.dust = 0.503;
    expect(discCacheKey(v, opts())).toBe(base);
    v.disc.condition.dust = 0.55;
    expect(discCacheKey(v, opts())).not.toBe(base);
  });

  it('su prefijo id|updatedAt|sizePx|side| es estable entre niveles de polvo', () => {
    const v = presetNormal();
    const prefix = `${v.id}|${v.updatedAt}|240|A|`;
    for (const dust of [0, 0.2, 0.5, 1]) {
      v.disc.condition.dust = dust;
      expect(discCacheKey(v, opts())).toMatch(new RegExp(`^${prefix.replace(/[|.]/g, '\\$&')}`));
    }
    v.disc.condition.scratches = 0.3;
    expect(discCacheKey(v, opts()).startsWith(prefix)).toBe(true);
  });

  it('sin polvo visible ignora el estado físico', () => {
    const v = presetNormal();
    v.disc.condition.dust = 0.9;
    const a = discCacheKey(v, opts({ showDust: false }));
    v.disc.condition.dust = 0.1;
    expect(discCacheKey(v, opts({ showDust: false }))).toBe(a);
    expect(a).toContain('|-1|-1|');
  });

  it('distingue cara, tamaño, eje, centrador y calidad', () => {
    const v = presetNormal();
    const keys = new Set([
      discCacheKey(v, opts()),
      discCacheKey(v, opts({ side: 'B' })),
      discCacheKey(v, opts({ sizePx: 480 })),
      discCacheKey(v, opts({ spindle: true })),
      discCacheKey(v, opts({ adapter45: true })),
      discCacheKey(v, opts({ quality: 'low' })),
    ]);
    expect(keys.size).toBe(6);
  });
});

describe('PRNG y ruido', () => {
  it('mulberry32 es determinista y devuelve valores en [0, 1)', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 200; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('semillas distintas dan secuencias distintas y el hash es estable', () => {
    expect(hashString('vin_1|A')).toBe(hashString('vin_1|A'));
    expect(hashString('vin_1|A')).not.toBe(hashString('vin_1|B'));
    const a = createRng('vin_1|A');
    const b = createRng('vin_1|B');
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).not.toEqual(seqB);
    const again = createRng('vin_1|A');
    expect(Array.from({ length: 8 }, () => again())).toEqual(seqA);
  });

  it('el ruido suave tiene la longitud pedida, está en [0, 1] y varía poco entre vecinos', () => {
    const n = smoothNoise(createRng('ruido'), 100, 8);
    expect(n.length).toBe(100);
    for (let i = 0; i < n.length; i++) {
      expect(n[i]).toBeGreaterThanOrEqual(0);
      expect(n[i]).toBeLessThanOrEqual(1);
      if (i > 0) expect(Math.abs(n[i]! - n[i - 1]!)).toBeLessThan(0.3);
    }
    expect(smoothNoise(createRng('x'), 0, 4).length).toBe(0);
  });
});

describe('utilidades geométricas', () => {
  it('chordHalfWidth sigue el teorema de Pitágoras y vale 0 fuera del círculo', () => {
    expect(chordHalfWidth(5, 3)).toBeCloseTo(4);
    expect(chordHalfWidth(5, 0)).toBe(5);
    expect(chordHalfWidth(5, 5)).toBe(0);
    expect(chordHalfWidth(5, 9)).toBe(0);
  });

  it('fitRect encaja con cover y contain centrando la imagen', () => {
    const box = { x: 0, y: 0, w: 100, h: 100 };
    const contain = fitRect(200, 100, box, 'contain');
    expect(contain).toEqual({ x: 0, y: 25, w: 100, h: 50 });
    const cover = fitRect(200, 100, box, 'cover');
    expect(cover).toEqual({ x: -50, y: 0, w: 200, h: 100 });
    expect(fitRect(0, 0, box, 'cover')).toEqual(box);
  });

  it('formatDuration escribe m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3599.6)).toBe('60:00');
    expect(formatDuration(-4)).toBe('0:00');
  });

  it('shrinkToFit reduce hasta caber y nunca baja del mínimo', () => {
    expect(shrinkToFit(20, 5, (s) => s <= 10)).toBeLessThanOrEqual(10);
    expect(shrinkToFit(20, 5, (s) => s <= 10)).toBeGreaterThan(5);
    expect(shrinkToFit(20, 5, () => false)).toBe(5);
    expect(shrinkToFit(20, 5, () => true)).toBe(20);
  });
});

describe('wrapText', () => {
  const measure = (s: string): number => s.length * 6;

  it('devuelve líneas que caben en anchuras que cambian por línea', () => {
    const widths = [60, 90, 120, 48];
    const text = 'uno dos tres cuatro cinco seis siete ocho nueve diez once doce';
    const lines = wrapText(text, measure, (i) => widths[i] ?? 48);
    expect(lines.length).toBeGreaterThan(1);
    lines.forEach((line, i) => expect(measure(line)).toBeLessThanOrEqual(widths[i] ?? 48));
    expect(lines.join(' ')).toBe(text);
  });

  it('parte las palabras que no caben solas', () => {
    const lines = wrapText('supercalifragilístico', measure, () => 30);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(30);
    expect(lines.join('')).toBe('supercalifragilístico');
  });

  it('respeta los saltos de línea y marca el truncado por maxLines', () => {
    expect(wrapText('a b\nc d', measure, () => 1000)).toEqual(['a b', 'c d']);
    const r = wrapTextDetailed('uno dos tres cuatro cinco', measure, () => 48, 2);
    expect(r.truncated).toBe(true);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[1]!.endsWith('…')).toBe(true);
    for (const l of r.lines) expect(measure(l)).toBeLessThanOrEqual(48);
  });

  it('una anchura nula termina el ajuste', () => {
    const r = wrapTextDetailed('uno dos tres cuatro', measure, (i) => (i === 0 ? 48 : 0));
    expect(r.lines).toHaveLength(1);
    expect(r.truncated).toBe(true);
    expect(wrapTextDetailed('', measure, () => 100)).toEqual({ lines: [], truncated: false });
  });
});

describe('layoutLabelText', () => {
  function input(overrides: Partial<LabelLayoutInput> = {}): LabelLayoutInput {
    const v = createVinyl({ meta: { artist: 'Queen', title: 'Grandes éxitos', labelName: 'EMI', catalogNumber: '8023 B', year: '1981' } });
    return {
      radiusMm: 50,
      holeRadiusMm: 3.62,
      holeRing: false,
      pxPerMm: 4,
      label: v.disc.sides[0].label,
      tracks: [track('Cosita loca llamada amor', 161), track('Alguien a quien amar', 295), track('Ahora estoy aquí', 255)],
      sideId: 'A',
      rpm: 33,
      ...overrides,
    };
  }

  /** Comprueba que cada línea cabe en la cuerda a su altura y evita el agujero. */
  function expectInsideCircle(placed: ReturnType<typeof layoutLabelText>, inp: LabelLayoutInput): void {
    for (const p of placed) {
      const widthMm = fakeMeasure(p.text, p.style, p.sizePx) / inp.pxPerMm;
      const x0 = p.align === 'left' ? p.xMm : p.align === 'right' ? p.xMm - widthMm : p.xMm - widthMm / 2;
      const x1 = x0 + widthMm;
      const halfH = (p.sizePx / inp.pxPerMm) * 0.4;
      for (const y of [p.yMm - halfH, p.yMm + halfH]) {
        const chord = chordHalfWidth(inp.radiusMm, y);
        expect(x0).toBeGreaterThanOrEqual(-chord - 1e-6);
        expect(x1).toBeLessThanOrEqual(chord + 1e-6);
      }
      if (Math.abs(p.yMm) < inp.holeRadiusMm) {
        const kw = chordHalfWidth(inp.holeRadiusMm, p.yMm);
        expect(x1 <= -kw || x0 >= kw).toBe(true);
      }
      expect(p.sizePx).toBeGreaterThanOrEqual(5);
    }
  }

  it('coloca todos los campos dentro del círculo', () => {
    const inp = input();
    const placed = layoutLabelText(inp, fakeMeasure);
    const texts = placed.map((p) => p.text);
    expect(texts).toContain('Cara A');
    expect(texts).toContain('33⅓ r.p.m.');
    expect(texts).toContain('EMI');
    expect(texts).toContain('Queen');
    expect(texts).toContain('8023 B');
    expect(texts.some((t) => t.startsWith('1. Cosita loca') && t.endsWith('2:41'))).toBe(true);
    expect(texts.some((t) => t.startsWith('Reservados'))).toBe(true);
    expectInsideCircle(placed, inp);
  });

  it('respeta showTracklist, showCopyright, sideMarker y showRpm', () => {
    const inp = input();
    inp.label.fields.showTracklist = false;
    inp.label.fields.showCopyright = false;
    inp.label.fields.sideMarker = false;
    inp.label.fields.showRpm = false;
    const texts = layoutLabelText(inp, fakeMeasure).map((p) => p.text);
    expect(texts.some((t) => /^\d+\. /.test(t))).toBe(false);
    expect(texts.some((t) => t.startsWith('Reservados'))).toBe(false);
    expect(texts).not.toContain('Cara A');
    expect(texts).not.toContain('33⅓ r.p.m.');
  });

  it('con agujero grande el texto rodea el agujero y la velocidad es la de 45', () => {
    const inp = input({ holeRadiusMm: 19.05, holeRing: true, rpm: 45, radiusMm: 44 });
    const placed = layoutLabelText(inp, fakeMeasure);
    expect(placed.map((p) => p.text)).toContain('45 r.p.m.');
    expectInsideCircle(placed, inp);
  });

  it('con muchas canciones reduce el tamaño sin bajar de 5 px y sin salirse', () => {
    const many = Array.from({ length: 18 }, (_, i) => track(`Canción número ${i + 1} con un título bastante largo`, 200));
    const inp = input({ tracks: many, pxPerMm: 2 });
    const placed = layoutLabelText(inp, fakeMeasure);
    expectInsideCircle(placed, inp);
    const trackLines = placed.filter((p) => /^\d+\. /.test(p.text));
    expect(trackLines.length).toBeGreaterThan(0);
    const normal = layoutLabelText(input({ pxPerMm: 2 }), fakeMeasure);
    const sizeOf = (list: typeof placed, prefix: string) => list.find((p) => p.text.startsWith(prefix))?.sizePx ?? 0;
    expect(sizeOf(placed, '1. ')).toBeLessThanOrEqual(sizeOf(normal, '1. '));
  });

  it('sin número de catálogo, el año queda anclado abajo dentro del círculo', () => {
    const inp = input();
    inp.label.fields.catalogNumber = '';
    const placed = layoutLabelText(inp, fakeMeasure);
    const year = placed.find((p) => p.text.startsWith('1981'));
    expect(year).toBeDefined();
    expect(year!.yMm).toBeGreaterThan(inp.radiusMm * 0.6);
    expectInsideCircle(placed, inp);
  });

  it('la alineación de la galleta se respeta en las líneas', () => {
    const inp = input();
    inp.label.text = textStyle({ align: 'center' });
    const placed = layoutLabelText(inp, fakeMeasure);
    const title = placed.find((p) => p.text === 'Grandes éxitos');
    expect(title?.align).toBe('center');
    expect(title?.xMm).toBeCloseTo(0, 6);
  });
});

describe('renderDiscFace', () => {
  const presets: Array<[string, () => Vinyl]> = [
    ['normal', () => presetNormal({ artist: 'Queen', title: 'Grandes éxitos', labelName: 'EMI', catalogNumber: '8023 B', year: '1981' }, [track('Uno', 180), track('Dos', 240)], [track('Tres', 200)])],
    ['ring', () => presetRing({ artist: 'A', title: 'B' }, [track('Uno', 180)], [track('Dos', 100)])],
    ['full', () => presetFull({ artist: 'A', title: 'B' }, [track('Uno', 180)])],
  ];

  it.each(presets)('devuelve un canvas sizePx × sizePx para el preset %s, ambas caras, sin contexto 2D', (_name, make) => {
    const v = make();
    for (const side of ['A', 'B'] as const) {
      const canvas = renderDiscFace(v, opts({ side, sizePx: 300 }), emptyImages());
      expect(canvas).toBeInstanceOf(HTMLCanvasElement);
      expect(canvas.width).toBe(300);
      expect(canvas.height).toBe(300);
    }
  });

  it('con un tamaño no entero redondea y nunca baja de 1 px', () => {
    const v = presetNormal();
    expect(renderDiscFace(v, opts({ sizePx: 123.6 }), emptyImages()).width).toBe(124);
    expect(renderDiscFace(v, opts({ sizePx: 0 }), emptyImages()).width).toBe(1);
  });

  describe('con un contexto 2D falso ejecuta todas las rutas de dibujo sin lanzar', () => {
    function withFakeContext(): void {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext() as never);
    }

    it.each(presets)('preset %s, ambas caras, con polvo, rayas, eje y centrador', (_name, make) => {
      withFakeContext();
      const v = make();
      v.disc.condition.dust = 0.6;
      v.disc.condition.scratches = 0.4;
      v.disc.sides[0].runoutEtching = 'MATRIZ A-1 ✶ hola';
      v.disc.sides[0].label.holeRingColor = '#d1302a';
      for (const side of ['A', 'B'] as const) {
        for (const quality of ['low', 'high'] as const) {
          const c = renderDiscFace(v, opts({ side, quality, spindle: true, adapter45: true, sizePx: 600 }), emptyImages());
          expect(c.width).toBe(600);
        }
      }
    });

    it('todos los materiales, formatos, agujeros y patrones de aro', () => {
      withFakeContext();
      const images = emptyImages();
      for (const material of ['black', 'color', 'clear', 'splatter', 'marble'] as const) {
        for (const format of ['7', '10', '12'] as const) {
          const v = presetRing({}, [track('Uno', 100), track('Dos', 100), track('Tres', 100)]);
          v.disc.material = material;
          v.disc.format = format;
          v.disc.hole = format === '7' ? 'large' : 'small';
          v.disc.nativeRpm = format === '7' ? 45 : 33;
          const size = Math.round(2 * discGeometry(format).radiusMm * 1.5);
          expect(renderDiscFace(v, opts({ sizePx: size, adapter45: true, spindle: true }), images).width).toBe(size);
        }
      }
      for (const pattern of ['plain', 'stripes', 'dots', 'rivets', 'stars', 'checker', 'image'] as const) {
        const v = presetRing();
        v.disc.sides[0].ring.pattern = pattern;
        v.disc.sides[0].ring.widthMm = 40; // se limita a maxRingWidthMm
        v.disc.sides[0].ring.image = { blobKey: 'no-cargada' };
        expect(renderDiscFace(v, opts({ sizePx: 200 }), images).width).toBe(200);
      }
    });

    it('es determinista: dos dibujos de la misma cara hacen exactamente las mismas llamadas', () => {
      const v = presetNormal({ artist: 'A', title: 'B' }, [track('Uno', 200), track('Dos', 300)]);
      v.disc.material = 'splatter';
      v.disc.condition.dust = 0.5;
      v.disc.condition.scratches = 0.3;
      const first = recordRender(v, opts({ sizePx: 500 }));
      const second = recordRender(v, opts({ sizePx: 500 }));
      expect(first.length).toBeGreaterThan(100);
      expect(second).toEqual(first);
      const otherSide = recordRender(v, opts({ sizePx: 500, side: 'B' }));
      expect(otherSide).not.toEqual(first);
    });

    it('una cara de 25 minutos dibuja más anillos de surco que una de 8', () => {
      const long = presetNormal({}, [track('Larga', 25 * 60)]);
      const short = presetNormal({}, [track('Corta', 8 * 60)]);
      const rings = (v: Vinyl) => recordRender(v, opts({ sizePx: 600, showDust: false })).filter((l) => l.startsWith('arc(')).length;
      expect(rings(long)).toBeGreaterThan(rings(short) * 1.3);
      // Una cara decorativa no dibuja surcos: muchos menos arcos.
      const decorative = presetNormal({}, [track('Larga', 25 * 60)]);
      decorative.disc.sides[0].decorative = true;
      expect(rings(decorative)).toBeLessThan(rings(short) / 2);
    });

    it('con destination-out abre el agujero y, con centrador, el agujero pequeño de este', () => {
      const v = presetNormal();
      v.disc.hole = 'large';
      const log = recordRender(v, opts({ sizePx: 400, adapter45: true, showDust: false }));
      const cuts = log.filter((l) => l === 'globalCompositeOperation=destination-out').length;
      expect(cuts).toBe(2);
      expect(recordRender(v, opts({ sizePx: 400, adapter45: false, showDust: false })).filter((l) => l === 'globalCompositeOperation=destination-out')).toHaveLength(1);
    });

    it('caras decorativas y a cara completa con y sin surcos, borde y obra', () => {
      withFakeContext();
      const images = emptyImages();
      const v = presetFull({ artist: 'X', title: 'Y' }, [track('Uno', 600)]);
      const [a, b] = v.disc.sides;
      a.groovesOverArt = false;
      a.rim.enabled = false;
      b.artwork = null;
      b.rim.rivets = false;
      expect(renderDiscFace(v, opts({ side: 'A', sizePx: 400 }), images).width).toBe(400);
      expect(renderDiscFace(v, opts({ side: 'B', sizePx: 400 }), images).width).toBe(400);
      // Cara decorativa con decoración normal: material liso y galleta.
      const n = presetNormal();
      n.disc.sides[1].decorative = true;
      n.disc.sides[1].label.image = { blobKey: 'logo' };
      n.disc.sides[1].label.background = { kind: 'image', image: { blobKey: 'fondo' }, fit: 'cover', backdrop: '#fff' };
      n.disc.sides[1].label.fields.extraLines = ['Grabado en Madrid', ''];
      expect(renderDiscFace(n, opts({ side: 'B', sizePx: 400, showDust: false }), images).width).toBe(400);
    });
  });
});
