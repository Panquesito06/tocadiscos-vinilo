/**
 * Cabecera del formulario: datos generales del vinilo, presets de
 * decoración y "Eliminar vinilo".
 *
 * Cada cambio de un dato general guarda el meta anterior y llama a
 * `syncDerivedTexts(v, anterior)`, que propaga el cambio a la galleta de
 * ambas caras y al lomo solo donde el usuario no personalizó el texto.
 */
import { applyPresetDecoration, syncDerivedTexts, type PresetKind } from '../core/defaults';
import type { Vinyl, VinylMeta } from '../core/types';
import { button, fieldset, grid, note, row, type Child } from './controls';
import type { EditorContext, Getter, Setter } from './context';

/** Cambia un dato general y propaga a los textos derivados que no se personalizaron. */
export function setMeta(v: Vinyl, key: keyof VinylMeta, value: string): void {
  if (v.meta[key] === value) return;
  const prev = { ...v.meta };
  v.meta[key] = value;
  syncDerivedTexts(v, prev);
}

export const PRESETS: readonly { kind: PresetKind; label: string }[] = [
  { kind: 'normal', label: 'Normal' },
  { kind: 'ring', label: 'Con aro' },
  { kind: 'full', label: 'Decorado completo' },
];

const metaGet =
  (key: keyof VinylMeta): Getter<string> =>
  (v) =>
    v.meta[key];

const metaSet =
  (key: keyof VinylMeta): Setter<string> =>
  (v, x) =>
    setMeta(v, key, x);

export function buildGeneral(ctx: EditorContext, onDelete: () => void): Child[] {
  const presets = PRESETS.map((p) =>
    button(p.label, () => ctx.edit((v) => applyPresetDecoration(v, p.kind)), { dataTest: `editor-preset-${p.kind}` }),
  );
  return [
    fieldset(
      'Datos generales',
      [
        grid([
          ctx.text('Artista', metaGet('artist'), metaSet('artist'), { dataTest: 'editor-artista' }),
          ctx.text('Título', metaGet('title'), metaSet('title'), { dataTest: 'editor-titulo' }),
          ctx.text('Año', metaGet('year'), metaSet('year'), { inputMode: 'numeric', maxLength: 10, dataTest: 'editor-anio' }),
          ctx.text('Sello', metaGet('labelName'), metaSet('labelName'), { dataTest: 'editor-sello' }),
          ctx.text('Número de catálogo', metaGet('catalogNumber'), metaSet('catalogNumber'), {
            spellcheck: false,
            dataTest: 'editor-catalogo',
          }),
          ctx.text('Género', metaGet('genre'), metaSet('genre'), { dataTest: 'editor-genero' }),
        ]),
        ctx.textarea('Notas', metaGet('notes'), metaSet('notes'), { rows: 2, dataTest: 'editor-notas' }),
      ],
      'ed-general',
    ),
    fieldset('Aplicar preset', [
      note('Cambia la decoración de las dos caras: material, galleta, aro, obra y borde. Conserva canciones, textos, carpeta y fundas.'),
      row(presets),
    ]),
    row([button('Eliminar vinilo', onDelete, { className: 'ed-btn ed-btn--peligro', dataTest: 'editor-eliminar' })]),
  ];
}
