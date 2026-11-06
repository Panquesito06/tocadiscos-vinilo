/** Pestaña Lomo: texto (con "Usar artista — título"), fondo, estilo, franja de color y catálogo. */
import { spineTextFor } from '../../core/defaults';
import type { Vinyl } from '../../core/types';
import { button, fieldset, grid, row, type Child } from '../controls';
import type { EditorContext } from '../context';

export const DEFAULT_ACCENT_COLOR = '#d1302a';

export function buildLomoTab(ctx: EditorContext): Child[] {
  // Color de la franja que se recupera al volver a activarla en esta sesión.
  let rememberedAccent = DEFAULT_ACCENT_COLOR;
  const hasAccent = (v: Vinyl): boolean => v.spine.accentColor !== null;
  const useMeta = button('Usar artista — título', () =>
    ctx.edit((v) => {
      v.spine.text = spineTextFor(v.meta);
    }),
    { dataTest: 'editor-lomo-usar-meta' },
  );
  return [
    fieldset('Texto del lomo', [
      ctx.text('Texto', (v) => v.spine.text, (v, x) => {
        v.spine.text = x;
      }, { dataTest: 'editor-lomo-texto', hint: 'Sigue a los datos generales mientras no lo cambies aquí.' }),
      row([useMeta]),
      ctx.checkbox('Número de catálogo en el lomo', (v) => v.spine.showCatalogNumber, (v, x) => {
        v.spine.showCatalogNumber = x;
      }),
    ]),
    fieldset('Colores', [
      ctx.color('Fondo', (v) => v.spine.background, (v, c) => {
        v.spine.background = c;
      }, 'editor-lomo-fondo'),
      ctx.checkbox('Franja de color en un extremo', hasAccent, (v, on) => {
        if (v.spine.accentColor) rememberedAccent = v.spine.accentColor;
        v.spine.accentColor = on ? (v.spine.accentColor ?? rememberedAccent) : null;
      }, { hint: 'Para reconocer una colección de un vistazo en la estantería.' }),
      ctx.showIf(
        grid([
          ctx.color('Color de la franja', (v) => v.spine.accentColor ?? rememberedAccent, (v, c) => {
            v.spine.accentColor = c;
          }),
        ]),
        hasAccent,
      ),
    ]),
    ctx.textStyle('Estilo del texto', (v) => v.spine.textStyle, (v, s) => {
      v.spine.textStyle = s;
    }),
  ];
}
