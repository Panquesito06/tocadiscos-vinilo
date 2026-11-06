/**
 * Pestaña Surcos: profundidad, separación entre canciones y, por cara, el
 * texto grabado en el dead wax con lecturas de duración y densidad.
 */
import { sideOf } from '../../core/defaults';
import { grooveDensity, sideDurationSec } from '../../core/geometry';
import type { SideId, Vinyl } from '../../core/types';
import { fieldset, grid, note, type Child } from '../controls';
import type { EditorContext } from '../context';
import { formatDecimal, formatDuration, formatPercent, formatSeconds } from '../format';

/** Separación máxima entre canciones, en segundos. */
export const MAX_TRACK_GAP_SEC = 6;

/** Densidad a partir de la cual la cara se considera demasiado larga para sonar bien. */
export const DENSE_GROOVES_PER_MM = 12;

/** "18:32 (6 canciones)", "Sin surcos" en una cara decorativa o vacía. */
export function describeSideDuration(v: Vinyl, id: SideId): string {
  const side = sideOf(v, id);
  if (side.decorative) return 'Sin surcos (cara decorativa)';
  const total = sideDurationSec(side, v.disc.trackGapSec);
  if (total <= 0) return 'Sin canciones';
  const n = side.tracks.length;
  return `${formatDuration(total)} (${n} ${n === 1 ? 'canción' : 'canciones'})`;
}

/** "8,3 vueltas por mm" o "Sin surcos". */
export function describeDensity(v: Vinyl, id: SideId): string {
  const side = sideOf(v, id);
  const d = side.decorative ? 0 : grooveDensity(v.disc, side);
  return d > 0 ? `${formatDecimal(d, 1)} vueltas por mm` : 'Sin surcos';
}

export function buildSurcosTab(ctx: EditorContext): Child[] {
  return [
    fieldset('Surcos', [
      ctx.range('Profundidad del surco', (v) => v.disc.grooveDepth, (v, x) => {
        v.disc.grooveDepth = x;
      }, { min: 0, max: 1, step: 0.01, format: formatPercent }),
      ctx.range('Separación entre canciones', (v) => v.disc.trackGapSec, (v, x) => {
        v.disc.trackGapSec = x;
      }, {
        min: 0,
        max: MAX_TRACK_GAP_SEC,
        step: 0.5,
        format: formatSeconds,
        hint: 'Silencio entre canciones; se ve como una banda lisa más ancha.',
        dataTest: 'editor-separacion',
      }),
    ]),
    sideSet(ctx, 'A'),
    sideSet(ctx, 'B'),
  ];
}

function sideSet(ctx: EditorContext, id: SideId): HTMLElement {
  const dense = (v: Vinyl): boolean => {
    const side = sideOf(v, id);
    return !side.decorative && grooveDensity(v.disc, side) > DENSE_GROOVES_PER_MM;
  };
  return fieldset(`Cara ${id}`, [
    ctx.text('Texto grabado en el dead wax', (v) => sideOf(v, id).runoutEtching, (v, x) => {
      sideOf(v, id).runoutEtching = x;
    }, {
      maxLength: 80,
      spellcheck: false,
      hint: 'Número de matriz o un mensaje escrito a mano entre el último surco y la galleta.',
      dataTest: `editor-deadwax-${id}`,
    }),
    grid([
      ctx.readout('Duración de la cara', (v) => describeSideDuration(v, id)),
      ctx.readout('Densidad de surcos', (v) => describeDensity(v, id)),
    ]),
    ctx.showIf(note('Cara muy larga: los surcos van muy juntos y en un disco real perdería volumen y graves.', 'aviso'), dense),
  ]);
}
