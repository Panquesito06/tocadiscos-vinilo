/**
 * Pestaña Galleta (por cara, con selector A/B): decoración, cara
 * decorativa, fondo, textos y sus estilos, imagen, anillo del agujero, aro
 * decorado, obra a cara completa con su borde, y "Copiar a la otra cara".
 *
 * Con decoración completa la galleta no se dibuja: se ocultan sus campos y
 * queda visible solo el anillo del agujero (además de la obra y el borde).
 */
import { sideOf } from '../../core/defaults';
import { maxRingWidthMm } from '../../core/geometry';
import type { Decoration, LabelFields, LabelSpec, RingPattern, Side, SideId, Vinyl } from '../../core/types';
import { button, fieldset, grid, h, note, row, type Child, type Option } from '../controls';
import type { EditorContext } from '../context';
import { formatMm, formatPercent } from '../format';

export const DECORATION_OPTIONS: readonly Option<Decoration>[] = [
  { value: 'normal', label: 'Galleta normal' },
  { value: 'ring', label: 'Galleta con aro decorado' },
  { value: 'full', label: 'Cara completa decorada' },
];

export const RING_PATTERN_OPTIONS: readonly Option<RingPattern>[] = [
  { value: 'plain', label: 'Liso' },
  { value: 'stripes', label: 'Rayas' },
  { value: 'dots', label: 'Puntos' },
  { value: 'rivets', label: 'Remaches' },
  { value: 'stars', label: 'Estrellas' },
  { value: 'checker', label: 'Damero' },
  { value: 'image', label: 'Imagen' },
];

export const MAX_EXTRA_LINES = 6;
export const RING_MIN_MM = 4;
export const RIM_MIN_MM = 3;
export const RIM_MAX_MM = 12;
export const DEFAULT_HOLE_RING_COLOR = '#d1302a';

export function otherSide(id: SideId): SideId {
  return id === 'A' ? 'B' : 'A';
}

/** Anchura del aro acotada a 4 mm … `maxRingWidthMm(format)`. */
export function clampRingWidth(v: Vinyl, widthMm: number): number {
  return Math.min(maxRingWidthMm(v.disc.format), Math.max(RING_MIN_MM, widthMm));
}

/**
 * Copia la galleta y la decoración (aro, obra, borde, surcos encima) de una
 * cara a la otra. No copia canciones, dead wax ni la marca de decorativa.
 */
export function copySideDecoration(v: Vinyl, from: SideId): void {
  const src = sideOf(v, from);
  const dst = sideOf(v, otherSide(from));
  dst.decoration = src.decoration;
  dst.label = structuredClone(src.label);
  dst.ring = structuredClone(src.ring);
  dst.artwork = src.artwork ? structuredClone(src.artwork) : null;
  dst.rim = { ...src.rim };
  dst.groovesOverArt = src.groovesOverArt;
}

/** Cambia la decoración; al pasar a completa sin obra, la obra parte del fondo de la galleta. */
export function setDecoration(side: Side, decoration: Decoration): void {
  side.decoration = decoration;
  if (decoration === 'full' && !side.artwork) side.artwork = structuredClone(side.label.background);
}

export function buildGalletaTab(ctx: EditorContext): Child[] {
  const full = (v: Vinyl): boolean => ctx.side(v).decoration === 'full';
  const notFull = (v: Vinyl): boolean => !full(v);
  const label = (v: Vinyl): LabelSpec => ctx.side(v).label;
  return [
    sideBar(ctx),
    decorationSet(ctx),
    ctx.showIf(
      note('Con la cara completa decorada la galleta no se dibuja: cuentan la obra, el borde y el anillo del agujero.'),
      full,
    ),
    ctx.showIf(
      ctx.fill('Fondo de la galleta', (v) => label(v).background, (v, f) => {
        label(v).background = f;
      }, { dataTest: 'editor-galleta-fondo' }),
      notFull,
    ),
    ctx.showIf(textsSet(ctx), notFull),
    ctx.showIf(
      ctx.textStyle('Estilo del texto', (v) => label(v).text, (v, s) => {
        label(v).text = s;
      }),
      notFull,
    ),
    ctx.showIf(
      ctx.textStyle('Estilo del sello en grande', (v) => label(v).brandText, (v, s) => {
        label(v).brandText = s;
      }),
      notFull,
    ),
    ctx.showIf(imageSet(ctx), notFull),
    holeRingSet(ctx),
    ctx.showIf(ringSet(ctx), (v) => ctx.side(v).decoration === 'ring'),
    ctx.showIf(
      ctx.optionalFill('Obra a cara completa', (v) => ctx.side(v).artwork, (v, f) => {
        ctx.side(v).artwork = f;
      }, { noneLabel: 'Sin obra (se ve el vinilo)', defaultColor: '#d8d2c2', dataTest: 'editor-obra' }),
      full,
    ),
    ctx.showIf(rimSet(ctx), full),
  ];
}

function sideBar(ctx: EditorContext): HTMLElement {
  const copy = button('Copiar a la otra cara', () => ctx.edit((v) => copySideDecoration(v, ctx.local.side)), {
    dataTest: 'editor-copiar-cara',
  });
  ctx.onSync(() => {
    const from = ctx.local.side;
    const title = `Sustituye la galleta y la decoración de la cara ${otherSide(from)} por las de la cara ${from}`;
    if (copy.title !== title) copy.title = title;
  });
  return row([ctx.sideSwitch(), copy]);
}

function decorationSet(ctx: EditorContext): HTMLElement {
  return fieldset('Decoración', [
    ctx.select('Decoración de la cara', DECORATION_OPTIONS, (v) => ctx.side(v).decoration, (v, d) => {
      setDecoration(ctx.side(v), d);
    }, { dataTest: 'editor-decoracion' }),
    ctx.checkbox('Cara decorativa (sin surcos ni audio)', (v) => ctx.side(v).decorative, (v, x) => {
      ctx.side(v).decorative = x;
    }, { dataTest: 'editor-decorativa', hint: 'Grabada, pintada o picture: la aguja no suena en ella.' }),
  ]);
}

function textsSet(ctx: EditorContext): HTMLElement {
  const f = (v: Vinyl): LabelFields => ctx.side(v).label.fields;
  return fieldset('Textos de la galleta', [
    grid([
      ctx.text('Artista', (v) => f(v).artist, (v, x) => {
        f(v).artist = x;
      }),
      ctx.text('Título', (v) => f(v).title, (v, x) => {
        f(v).title = x;
      }),
      ctx.text('Sello (en grande)', (v) => f(v).brand, (v, x) => {
        f(v).brand = x;
      }),
      ctx.text('Número de catálogo', (v) => f(v).catalogNumber, (v, x) => {
        f(v).catalogNumber = x;
      }, { spellcheck: false }),
      ctx.text('Año', (v) => f(v).year, (v, x) => {
        f(v).year = x;
      }, { inputMode: 'numeric', maxLength: 10 }),
    ]),
    note('Siguen a los datos generales mientras no los cambies aquí.'),
    ctx.checkbox('Indicar la cara (Cara A, Cara B)', (v) => f(v).sideMarker, (v, x) => {
      f(v).sideMarker = x;
    }),
    ctx.checkbox('Indicar la velocidad', (v) => f(v).showRpm, (v, x) => {
      f(v).showRpm = x;
    }),
    ctx.checkbox('Lista de canciones', (v) => f(v).showTracklist, (v, x) => {
      f(v).showTracklist = x;
    }),
    ctx.checkbox('Texto legal (copyright)', (v) => f(v).showCopyright, (v, x) => {
      f(v).showCopyright = x;
    }, { dataTest: 'editor-copyright-mostrar' }),
    ctx.showIf(
      ctx.textarea('Texto legal', (v) => f(v).copyright, (v, x) => {
        f(v).copyright = x;
      }, { rows: 2, dataTest: 'editor-copyright' }),
      (v) => f(v).showCopyright,
    ),
    extraLines(ctx, f),
  ]);
}

function extraLines(ctx: EditorContext, f: (v: Vinyl) => LabelFields): HTMLElement {
  const list = ctx.dynamic(
    (v) => `${ctx.local.side}|${f(v).extraLines.length}`,
    (c, v) => f(v).extraLines.map((_, i) => lineRow(c, f, i)),
    'ed-lines',
  );
  const add = button(
    'Añadir línea',
    () =>
      ctx.edit((v) => {
        const fields = f(v);
        if (fields.extraLines.length < MAX_EXTRA_LINES) fields.extraLines.push('');
      }),
    { dataTest: 'editor-linea-anadir' },
  );
  ctx.onSync((v) => {
    const full = f(v).extraLines.length >= MAX_EXTRA_LINES;
    if (add.disabled !== full) add.disabled = full;
  });
  const title = h('p', 'ed-sublegend', ['Líneas extra']);
  return h('div', 'ed-subgroup', [title, list, row([add])]);
}

function lineRow(ctx: EditorContext, f: (v: Vinyl) => LabelFields, i: number): HTMLElement {
  const field = ctx.text(`Línea ${i + 1}`, (v) => f(v).extraLines[i] ?? '', (v, x) => {
    const lines = f(v).extraLines;
    if (i < lines.length) lines[i] = x;
  }, { dataTest: `editor-linea-${i}` });
  const remove = button('Quitar', () => ctx.edit((v) => void f(v).extraLines.splice(i, 1)), {
    focusKey: `lineas:${i}`,
    ariaLabel: `Quitar la línea ${i + 1}`,
    dataTest: `editor-linea-quitar-${i}`,
  });
  return h('div', 'ed-line', [field, remove]);
}

function imageSet(ctx: EditorContext): HTMLElement {
  return fieldset('Imagen de la galleta', [
    ctx.image('Logotipo o arte', (v) => ctx.side(v).label.image ?? null, (v, ref) => {
      ctx.side(v).label.image = ref;
    }, 'editor-galleta-imagen'),
    ctx.range('Escala de la imagen', (v) => ctx.side(v).label.imageScale, (v, x) => {
      ctx.side(v).label.imageScale = x;
    }, { min: 0.2, max: 1, step: 0.05, format: formatPercent, hint: 'Relativa al diámetro de la galleta.' }),
  ]);
}

function holeRingSet(ctx: EditorContext): HTMLElement {
  // Color que se recupera al volver a activar el anillo en esta sesión.
  let remembered = DEFAULT_HOLE_RING_COLOR;
  const has = (v: Vinyl): boolean => ctx.side(v).label.holeRingColor !== null;
  return fieldset('Anillo del agujero', [
    ctx.checkbox('Anillo de color alrededor del agujero', has, (v, on) => {
      const l = ctx.side(v).label;
      if (l.holeRingColor) remembered = l.holeRingColor;
      l.holeRingColor = on ? (l.holeRingColor ?? remembered) : null;
    }, { dataTest: 'editor-anillo' }),
    ctx.showIf(
      ctx.color('Color del anillo', (v) => ctx.side(v).label.holeRingColor ?? remembered, (v, c) => {
        ctx.side(v).label.holeRingColor = c;
      }),
      has,
    ),
  ]);
}

function ringSet(ctx: EditorContext): HTMLElement {
  const ring = (v: Vinyl): Side['ring'] => ctx.side(v).ring;
  return fieldset('Aro decorado', [
    ctx.select('Patrón', RING_PATTERN_OPTIONS, (v) => ring(v).pattern, (v, p) => {
      ring(v).pattern = p;
    }, { dataTest: 'editor-aro-patron' }),
    grid([
      ctx.color('Color 1', (v) => ring(v).color1, (v, c) => {
        ring(v).color1 = c;
      }),
      ctx.color('Color 2', (v) => ring(v).color2, (v, c) => {
        ring(v).color2 = c;
      }),
    ]),
    ctx.range('Anchura del aro', (v) => ring(v).widthMm, (v, x) => {
      ring(v).widthMm = clampRingWidth(v, x);
    }, {
      min: RING_MIN_MM,
      max: maxRingWidthMm('12'),
      maxOf: (v) => maxRingWidthMm(v.disc.format),
      step: 0.5,
      format: formatMm,
      hint: 'Como mucho, el hueco entre la galleta y el último surco.',
      dataTest: 'editor-aro-anchura',
    }),
    ctx.showIf(
      ctx.image('Imagen del aro', (v) => ring(v).image ?? null, (v, ref) => {
        ring(v).image = ref;
      }),
      (v) => ring(v).pattern === 'image',
    ),
  ]);
}

function rimSet(ctx: EditorContext): HTMLElement {
  const rim = (v: Vinyl): Side['rim'] => ctx.side(v).rim;
  const on = (v: Vinyl): boolean => rim(v).enabled;
  return fieldset('Surcos y borde', [
    ctx.checkbox('Surcos tenues encima de la obra', (v) => ctx.side(v).groovesOverArt, (v, x) => {
      ctx.side(v).groovesOverArt = x;
    }, { hint: 'Como en un picture disc. En una cara decorativa no hay surcos.' }),
    ctx.checkbox('Borde pintado o metálico', on, (v, x) => {
      rim(v).enabled = x;
    }, { dataTest: 'editor-borde' }),
    ctx.showIf(
      grid([
        ctx.color('Color del borde', (v) => rim(v).color, (v, c) => {
          rim(v).color = c;
        }),
        ctx.checkbox('Remaches', (v) => rim(v).rivets, (v, x) => {
          rim(v).rivets = x;
        }),
      ]),
      on,
    ),
    ctx.showIf(
      ctx.range('Anchura del borde', (v) => rim(v).widthMm, (v, x) => {
        rim(v).widthMm = Math.min(RIM_MAX_MM, Math.max(RIM_MIN_MM, x));
      }, { min: RIM_MIN_MM, max: RIM_MAX_MM, step: 0.5, format: formatMm }),
      on,
    ),
  ]);
}
