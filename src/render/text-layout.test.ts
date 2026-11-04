import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { textStyle } from '../core/defaults';
import { createFakeContext } from './fake-context';
import {
  addEllipsis,
  applyTextStyle,
  drawVerticalText,
  fitColumns,
  fitSingleLine,
  fitTextBlock,
  fontString,
  formatDuration,
  layoutBounds,
  layoutColumns,
  measureFor,
  resetStretchProbe,
  shrinkToFit,
  textCase,
  wrapText,
  type ColumnBox,
  type Measure,
  type MeasureAt,
} from './text-layout';

/** Medidor falso: 10 px por carácter. */
const tenPerChar: Measure = (t) => t.length * 10;
/** Fábrica falsa: medio em por carácter. */
const halfEm: MeasureAt = (size) => (t) => t.length * size * 0.5;

describe('fuente y mayúsculas', () => {
  it('fontString acota el peso y usa Archivo', () => {
    expect(fontString(1200, 20)).toBe("900 20px 'Archivo Variable', 'Archivo', system-ui, sans-serif");
    expect(fontString(50, 0)).toMatch(/^100 1px /);
  });

  it('textCase respeta la ñ y las tildes', () => {
    expect(textCase('cariño añejo', { uppercase: true })).toBe('CARIÑO AÑEJO');
    expect(textCase('Cariño', { uppercase: false })).toBe('Cariño');
  });

  it('formatDuration da m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(161)).toBe('2:41');
    expect(formatDuration(59.6)).toBe('1:00');
    expect(formatDuration(3605)).toBe('60:05');
    expect(formatDuration(Number.NaN)).toBe('0:00');
    expect(formatDuration(-5)).toBe('0:00');
  });
});

describe('ajuste en líneas', () => {
  it('parte por palabras sin pasarse de la anchura', () => {
    expect(wrapText('Hola mundo cruel', tenPerChar, 100).lines).toEqual(['Hola mundo', 'cruel']);
  });

  it('respeta los saltos de línea e ignora las líneas en blanco', () => {
    expect(wrapText('Uno\n\n\nDos tres', tenPerChar, 100).lines).toEqual(['Uno', 'Dos tres']);
    expect(wrapText('Uno\r\nDos', tenPerChar, 100).lines).toEqual(['Uno', 'Dos']);
  });

  it('rompe las palabras que no caben solas y lo señala', () => {
    const r = wrapText('abcdefghijklmnop', tenPerChar, 50);
    expect(r.lines).toEqual(['abcde', 'fghij', 'klmno', 'p']);
    expect(r.broken).toBe(true);
    expect(wrapText('abc def', tenPerChar, 50).broken).toBe(false);
  });

  it('una columna más estrecha que un carácter avanza igualmente', () => {
    const r = wrapText('abc', tenPerChar, 5);
    expect(r.lines).toEqual(['a', 'b', 'c']);
  });

  it('corta con puntos suspensivos al superar maxLines', () => {
    const r = wrapText('Hola mundo cruel', tenPerChar, 100, 1);
    expect(r.truncated).toBe(true);
    expect(r.lines).toEqual(['Hola mund…']);
  });

  it('addEllipsis siempre deja algo', () => {
    const lines = ['abc'];
    addEllipsis(lines, tenPerChar, 10);
    expect(lines).toEqual(['…']);
  });

  it('texto vacío no produce líneas', () => {
    expect(wrapText('   ', tenPerChar, 100).lines).toEqual([]);
  });
});

describe('encogido', () => {
  it('shrinkToFit devuelve el inicio si cabe y baja hasta el mínimo si no', () => {
    expect(shrinkToFit(40, 10, () => true)).toBe(40);
    expect(shrinkToFit(40, 10, () => false)).toBe(10);
    const size = shrinkToFit(40, 10, (s) => s <= 20);
    expect(size).toBeLessThanOrEqual(20);
    expect(size).toBeGreaterThan(18);
  });

  it('fitSingleLine encuentra el tamaño al que cabe una línea', () => {
    const size = fitSingleLine('0123456789', halfEm, 100, 40, 5);
    expect(size * 0.5 * 10).toBeLessThanOrEqual(100);
    expect(size).toBeGreaterThan(18);
  });

  it('fitTextBlock encoge hasta que caben las líneas en altura y anchura', () => {
    const block = fitTextBlock('aaaa bbbb cccc dddd', halfEm, 100, 40, { startPx: 40, minPx: 4, lineHeight: 1 });
    expect(block.truncated).toBe(false);
    expect(block.lines.length * block.lineHeight).toBeLessThanOrEqual(40);
    for (const line of block.lines) expect(line.length * block.sizePx * 0.5).toBeLessThanOrEqual(100);
  });

  it('fitTextBlock prefiere encoger antes que partir una palabra', () => {
    const block = fitTextBlock('Oferta 5 €', halfEm, 30, 100, { startPx: 20, minPx: 4, lineHeight: 1 });
    expect(block.lines).toEqual(['Oferta', '5 €']);
    expect(block.sizePx).toBeLessThanOrEqual(10);
  });

  it('fitTextBlock recorta en el mínimo si aun así no cabe', () => {
    const block = fitTextBlock('palabra '.repeat(200), halfEm, 100, 20, { startPx: 20, minPx: 10, lineHeight: 1 });
    expect(block.sizePx).toBe(10);
    expect(block.truncated).toBe(true);
    expect(block.lines[block.lines.length - 1]).toMatch(/…$/);
    expect(block.lines.length).toBe(2);
  });
});

describe('columnas', () => {
  const twoColumns: ColumnBox[] = [
    { x: 0, y: 0, w: 100, h: 30 },
    { x: 120, y: 0, w: 100, h: 30 },
  ];

  it('rellena la primera columna y sigue por la segunda', () => {
    const narrow: ColumnBox[] = [
      { x: 0, y: 0, w: 50, h: 30 },
      { x: 120, y: 0, w: 50, h: 30 },
    ];
    const layout = layoutColumns('aaaa bbbb cccc dddd eeee', tenPerChar, narrow, 10);
    expect(layout.overflow).toBe(false);
    expect(layout.lines.map((l) => l.text)).toEqual(['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee']);
    expect(layout.lines.map((l) => l.column)).toEqual([0, 0, 0, 1, 1]);
    expect(layout.lines[3]).toMatchObject({ x: 120, y: 0, w: 50 });
    expect(layout.lines[2]).toMatchObject({ x: 0, y: 20 });
  });

  it('junta en una línea las palabras que caben', () => {
    const layout = layoutColumns('aaaa bbbb cccc dddd eeee', tenPerChar, twoColumns, 10);
    expect(layout.lines.map((l) => l.text)).toEqual(['aaaa bbbb', 'cccc dddd', 'eeee']);
    expect(layout.lines.every((l) => l.column === 0)).toBe(true);
  });

  it('marca el desbordamiento y pone puntos suspensivos en la última línea', () => {
    const layout = layoutColumns('aaaa '.repeat(20), tenPerChar, twoColumns, 10);
    expect(layout.overflow).toBe(true);
    expect(layout.lines).toHaveLength(6);
    expect(layout.lines[5]!.text).toMatch(/…$/);
  });

  it('deja hueco entre párrafos, pero no al principio de una columna', () => {
    const layout = layoutColumns('aaaa\nbbbb\ncccc', tenPerChar, twoColumns, 10, 5);
    expect(layout.lines.map((l) => [l.column, l.y])).toEqual([
      [0, 0],
      [0, 15],
      [1, 0],
    ]);
  });

  it('admite columnas de distinta forma (encima y debajo de un troquel)', () => {
    const bands: ColumnBox[] = [
      { x: 10, y: 0, w: 200, h: 10 },
      { x: 10, y: 50, w: 200, h: 20 },
    ];
    const layout = layoutColumns('a b c d e f g h i j k l m n o p q r s t u v w x y z', tenPerChar, bands, 10);
    expect(layout.overflow).toBe(false);
    expect(layout.lines.map((l) => l.y)).toEqual([0, 50, 60]);
    expect(layoutBounds(layout, 10)).toEqual({ x: 10, y: 0, w: 200, h: 70 });
  });

  it('ignora columnas inútiles y no se cuelga', () => {
    const layout = layoutColumns('hola', tenPerChar, [{ x: 0, y: 0, w: 0, h: 100 }], 10);
    expect(layout.overflow).toBe(true);
    expect(layout.lines).toHaveLength(0);
    expect(layoutBounds(layout, 10)).toBeNull();
  });

  it('fitColumns encoge hasta que el texto cabe', () => {
    const fitted = fitColumns('palabra '.repeat(12), halfEm, twoColumns, { startPx: 20, minPx: 2, lineHeight: 1 });
    expect(fitted.layout.overflow).toBe(false);
    expect(fitted.sizePx).toBeLessThan(20);
    expect(fitted.sizePx).toBeGreaterThan(2);
  });
});

describe('estilo sobre un contexto falso', () => {
  beforeEach(() => resetStretchProbe());
  afterEach(() => resetStretchProbe());

  it('sin eje de anchura emula la anchura con una escala horizontal', () => {
    const ctx = createFakeContext(document.createElement('canvas'));
    const sx = applyTextStyle(ctx, textStyle({ width: 'condensed', weight: 700 }), 20);
    expect(sx).toBeCloseTo(0.82);
    expect(ctx.font).toMatch(/^700 20px/);
    expect(ctx.fontStretch).toBe('normal');
    const measure = measureFor(ctx, textStyle({ width: 'condensed' }), 20);
    expect(measure('HH')).toBeCloseTo(2 * 20 * 0.55 * 0.82);
  });

  it('con eje de anchura usa fontStretch nativo', () => {
    const ctx = createFakeContext(document.createElement('canvas'), { nativeStretch: true });
    expect(applyTextStyle(ctx, textStyle({ width: 'expanded' }), 20)).toBe(1);
    expect(ctx.fontStretch).toBe('expanded');
    expect(applyTextStyle(ctx, textStyle({ width: 'normal' }), 20)).toBe(1);
    expect(ctx.fontStretch).toBe('normal');
  });

  it('el texto vertical gira −90° y ancla abajo cuando se alinea a la izquierda', () => {
    const ctx = createFakeContext(document.createElement('canvas'));
    drawVerticalText(ctx, 'Lomo', 12, 20, 200, textStyle({ align: 'left', uppercase: true }), 14);
    expect(ctx.texts).toEqual(['LOMO']);
    const rotate = ctx.calls.find((c) => c.name === 'rotate');
    expect(rotate?.args[0]).toBeCloseTo(-Math.PI / 2);
    const translate = ctx.calls.find((c) => c.name === 'translate');
    expect(translate?.args).toEqual([12, 200]);
    expect(ctx.calls.some((c) => c.name === 'scale')).toBe(true);
  });
});
