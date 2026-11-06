/** Pestaña Funda exterior: tipo, tinte, opacidad, impresión y brillo del plástico. */
import type { OuterSleeveKind, Vinyl } from '../../core/types';
import { fieldset, type Child, type Option } from '../controls';
import type { EditorContext } from '../context';
import { formatPercent } from '../format';

export const OUTER_KIND_OPTIONS: readonly Option<OuterSleeveKind>[] = [
  { value: 'none', label: 'Sin funda exterior' },
  { value: 'pvc-clear', label: 'PVC transparente' },
  { value: 'pvc-tinted', label: 'PVC tintado' },
  { value: 'printed', label: 'Impresa' },
  { value: 'resealable', label: 'Con cierre adhesivo' },
];

export function buildFundaExteriorTab(ctx: EditorContext): Child[] {
  const kind = (v: Vinyl): OuterSleeveKind => v.outerSleeve.kind;
  const exists = (v: Vinyl): boolean => kind(v) !== 'none';
  const tinted = (v: Vinyl): boolean => kind(v) === 'pvc-tinted';
  const printed = (v: Vinyl): boolean => kind(v) === 'printed';
  const percent = { min: 0, max: 1, step: 0.01, format: formatPercent };
  return [
    fieldset('Funda exterior', [
      ctx.select('Tipo', OUTER_KIND_OPTIONS, kind, (v, k) => {
        v.outerSleeve.kind = k;
      }, { dataTest: 'editor-exterior-tipo' }),
      ctx.showIf(
        ctx.color('Tinte', (v) => v.outerSleeve.tint, (v, c) => {
          v.outerSleeve.tint = c;
        }),
        tinted,
      ),
      ctx.showIf(
        ctx.range('Opacidad', (v) => v.outerSleeve.opacity, (v, x) => {
          v.outerSleeve.opacity = x;
        }, { ...percent, hint: 'Del tinte o de la impresión.' }),
        (v) => tinted(v) || printed(v),
      ),
      ctx.showIf(
        ctx.range('Brillo del plástico', (v) => v.outerSleeve.gloss, (v, x) => {
          v.outerSleeve.gloss = x;
        }, percent),
        exists,
      ),
    ]),
    ctx.showIf(
      ctx.optionalFill('Impresión', (v) => v.outerSleeve.print, (v, f) => {
        v.outerSleeve.print = f;
      }, { noneLabel: 'Sin impresión' }),
      printed,
    ),
  ];
}
