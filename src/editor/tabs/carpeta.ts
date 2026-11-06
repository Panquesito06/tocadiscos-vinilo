/**
 * Pestaña Carpeta: portada y contraportada (FillEditor), título en portada
 * y su estilo, lista de canciones y notas de la contraportada con su
 * estilo, carpeta desplegable con interiores, acabado, esquina cortada y
 * pegatina.
 */
import type { JacketFinish, Vinyl } from '../../core/types';
import { button, fieldset, h, note, row, type Child, type Option } from '../controls';
import type { EditorContext } from '../context';

export const FINISH_OPTIONS: readonly Option<JacketFinish>[] = [
  { value: 'matte', label: 'Mate' },
  { value: 'gloss', label: 'Brillo' },
  { value: 'textured', label: 'Texturizado' },
];

export const DEFAULT_STICKER = { text: 'Oferta', color: '#f2c14e' } as const;

export function buildCarpetaTab(ctx: EditorContext): Child[] {
  const gatefold = (v: Vinyl): boolean => v.jacket.gatefold;
  return [
    ctx.fill('Portada', (v) => v.jacket.front, (v, f) => {
      v.jacket.front = f;
    }, { dataTest: 'editor-portada' }),
    fieldset('Título en la portada', [
      ctx.checkbox('Imprimir artista y título en la portada', (v) => v.jacket.showTitleOnFront, (v, x) => {
        v.jacket.showTitleOnFront = x;
      }, { hint: 'Desactívalo si la imagen de portada ya los lleva.' }),
    ]),
    ctx.showIf(
      ctx.textStyle('Estilo del título', (v) => v.jacket.titleStyle, (v, s) => {
        v.jacket.titleStyle = s;
      }),
      (v) => v.jacket.showTitleOnFront,
    ),
    ctx.fill('Contraportada', (v) => v.jacket.back, (v, f) => {
      v.jacket.back = f;
    }, { dataTest: 'editor-contraportada' }),
    fieldset('Texto de la contraportada', [
      ctx.checkbox('Lista de canciones por caras', (v) => v.jacket.showTracklistOnBack, (v, x) => {
        v.jacket.showTracklistOnBack = x;
      }),
      ctx.textarea('Notas', (v) => v.jacket.backNotes, (v, x) => {
        v.jacket.backNotes = x;
      }, { rows: 4, dataTest: 'editor-notas-contraportada' }),
    ]),
    ctx.textStyle('Estilo de las notas', (v) => v.jacket.backStyle, (v, s) => {
      v.jacket.backStyle = s;
    }),
    fieldset('Desplegable', [
      ctx.checkbox('Carpeta desplegable (gatefold)', gatefold, (v, x) => {
        v.jacket.gatefold = x;
      }, { dataTest: 'editor-desplegable' }),
      ctx.showIf(note('Sin relleno propio, los interiores toman el color de la contraportada.'), gatefold),
    ]),
    ctx.showIf(
      ctx.optionalFill('Interior izquierdo', (v) => v.jacket.insideLeft, (v, f) => {
        v.jacket.insideLeft = f;
      }, { noneLabel: 'Como la contraportada' }),
      gatefold,
    ),
    ctx.showIf(
      ctx.optionalFill('Interior derecho', (v) => v.jacket.insideRight, (v, f) => {
        v.jacket.insideRight = f;
      }, { noneLabel: 'Como la contraportada' }),
      gatefold,
    ),
    detailsSet(ctx),
  ];
}

function detailsSet(ctx: EditorContext): HTMLElement {
  const hasSticker = (v: Vinyl): boolean => v.jacket.sticker !== null;
  const add = button('Añadir pegatina', () =>
    ctx.edit((v) => {
      v.jacket.sticker ??= { ...DEFAULT_STICKER };
    }),
    { dataTest: 'editor-pegatina-anadir' },
  );
  const remove = button('Quitar pegatina', () =>
    ctx.edit((v) => {
      v.jacket.sticker = null;
    }),
    { dataTest: 'editor-pegatina-quitar' },
  );
  const sticker = h('div', 'ed-subgroup', [
    ctx.text('Texto de la pegatina', (v) => v.jacket.sticker?.text ?? '', (v, x) => {
      if (v.jacket.sticker) v.jacket.sticker.text = x;
    }, { maxLength: 30, dataTest: 'editor-pegatina-texto' }),
    ctx.color('Color de la pegatina', (v) => v.jacket.sticker?.color ?? DEFAULT_STICKER.color, (v, c) => {
      if (v.jacket.sticker) v.jacket.sticker.color = c;
    }),
    row([remove]),
  ]);
  return fieldset('Acabado y detalles', [
    ctx.select('Acabado', FINISH_OPTIONS, (v) => v.jacket.finish, (v, f) => {
      v.jacket.finish = f;
    }),
    ctx.checkbox('Esquina cortada (de saldo)', (v) => v.jacket.cutCorner, (v, x) => {
      v.jacket.cutCorner = x;
    }),
    h('p', 'ed-sublegend', ['Pegatina']),
    ctx.showIf(row([add]), (v) => !hasSticker(v)),
    ctx.showIf(sticker, hasSticker),
  ]);
}
