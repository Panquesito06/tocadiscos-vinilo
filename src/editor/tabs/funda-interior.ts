/**
 * Pestaña Funda interior: tipo, color del papel, troquel, impresión
 * delantera y trasera (solo en la funda impresa) y texto impreso con su
 * estilo.
 */
import type { InnerSleeve, InnerSleeveKind, Vinyl } from '../../core/types';
import { fieldset, type Child, type Option } from '../controls';
import type { EditorContext } from '../context';

export const INNER_KIND_OPTIONS: readonly Option<InnerSleeveKind>[] = [
  { value: 'none', label: 'Sin funda interior' },
  { value: 'paper-white', label: 'Papel blanco' },
  { value: 'paper-kraft', label: 'Papel kraft' },
  { value: 'paper-black', label: 'Papel negro' },
  { value: 'poly-lined', label: 'Papel forrado de plástico' },
  { value: 'printed', label: 'Impresa' },
];

/** Color de partida de cada tipo de papel (al cambiar de tipo se pone este; luego se puede ajustar). */
export const INNER_KIND_COLORS: Partial<Record<InnerSleeveKind, string>> = {
  'paper-white': '#f3f1ec',
  'paper-kraft': '#c9a66b',
  'paper-black': '#1c1b19',
  'poly-lined': '#f3f1ec',
};

export function setInnerKind(sleeve: InnerSleeve, kind: InnerSleeveKind): void {
  sleeve.kind = kind;
  const color = INNER_KIND_COLORS[kind];
  if (color) sleeve.color = color;
}

export function buildFundaInteriorTab(ctx: EditorContext): Child[] {
  const kind = (v: Vinyl): InnerSleeveKind => v.innerSleeve.kind;
  const exists = (v: Vinyl): boolean => kind(v) !== 'none';
  const printed = (v: Vinyl): boolean => kind(v) === 'printed';
  return [
    fieldset('Funda interior', [
      ctx.select('Tipo', INNER_KIND_OPTIONS, kind, (v, k) => setInnerKind(v.innerSleeve, k), {
        dataTest: 'editor-funda-tipo',
      }),
      ctx.showIf(
        ctx.color('Color del papel', (v) => v.innerSleeve.color, (v, c) => {
          v.innerSleeve.color = c;
        }),
        (v) => exists(v) && !printed(v),
      ),
      ctx.showIf(
        ctx.checkbox('Troquel central (deja ver la galleta)', (v) => v.innerSleeve.cutout, (v, x) => {
          v.innerSleeve.cutout = x;
        }),
        exists,
      ),
    ]),
    ctx.showIf(
      ctx.optionalFill('Impresión delantera', (v) => v.innerSleeve.printFront, (v, f) => {
        v.innerSleeve.printFront = f;
      }, { noneLabel: 'Sin impresión (papel liso)' }),
      printed,
    ),
    ctx.showIf(
      ctx.optionalFill('Impresión trasera', (v) => v.innerSleeve.printBack, (v, f) => {
        v.innerSleeve.printBack = f;
      }, { noneLabel: 'Sin impresión (papel liso)' }),
      printed,
    ),
    ctx.showIf(
      fieldset('Texto impreso', [
        ctx.textarea('Letras, créditos o historia del álbum', (v) => v.innerSleeve.text, (v, x) => {
          v.innerSleeve.text = x;
        }, { rows: 5, dataTest: 'editor-funda-texto' }),
      ]),
      exists,
    ),
    ctx.showIf(
      ctx.textStyle('Estilo del texto impreso', (v) => v.innerSleeve.textStyle, (v, s) => {
        v.innerSleeve.textStyle = s;
      }),
      exists,
    ),
  ];
}
