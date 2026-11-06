/** Pestaña Agujero: pequeño o grande (single de jukebox) y aviso del centrador. */
import type { HoleSize } from '../../core/types';
import { note, type Child, type Option } from '../controls';
import type { EditorContext } from '../context';

export const HOLE_OPTIONS: readonly Option<HoleSize>[] = [
  { value: 'small', label: 'Pequeño (7,24 mm)' },
  { value: 'large', label: 'Grande (38,1 mm, de jukebox)' },
];

export const LARGE_HOLE_WARNING = 'El agujero grande necesita el centrador en el plato.';

export function buildAgujeroTab(ctx: EditorContext): Child[] {
  const warning = note(LARGE_HOLE_WARNING, 'aviso');
  warning.dataset.test = 'editor-aviso-agujero';
  return [
    ctx.radios('Agujero central', HOLE_OPTIONS, (v) => v.disc.hole, (v, hole) => {
      v.disc.hole = hole;
    }, { dataTest: 'editor-agujero' }),
    ctx.showIf(warning, (v) => v.disc.hole === 'large'),
  ];
}
