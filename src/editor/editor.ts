/**
 * Editor de vinilo: cajón con una pestaña por parte.
 *
 * CONTRATO (lo implementa el módulo del editor):
 *  - Lee `ui.editorVinylId` y `ui.editorTab`; escribe con `store.update`.
 *    Cada cambio actualiza `vinyl.updatedAt` (así las cachés de render se
 *    invalidan) y se ve al instante en la vista previa.
 *  - Vista previa en la parte superior del cajón: según la pestaña, la cara
 *    del disco (A/B conmutable), la portada/contraportada, la funda
 *    interior, el lomo (a escala real junto a otros dos lomos de ejemplo) o
 *    la carpeta con la funda exterior. Usa `renderers`.
 *  - Pestañas (`EditorTab`):
 *      · disco: formato 7/10/12, velocidad nominal 33/45/78, material y
 *        colores, peso (y grosor derivado, editable), calidad de prensado,
 *        estado (polvo, desgaste, alabeo, rayas) con texto descriptivo;
 *      · surcos: profundidad, separación entre canciones, texto del dead
 *        wax por cara, lectura de densidad (vueltas/mm) y duración por cara;
 *      · agujero: pequeño/grande, aviso de que el grande necesita centrador;
 *      · galleta (por cara): decoración normal/aro/completa, fondo (color,
 *        degradado, imagen), tipografía (color, peso, anchura, alineación,
 *        mayúsculas), campos (artista, título, sello, catálogo, año, cara,
 *        rpm, lista, copyright, líneas extra), imagen y escala, anillo del
 *        agujero; aro decorado (patrón, colores, anchura, imagen); obra a
 *        cara completa (relleno/imagen), borde remachado, surcos encima;
 *        cara decorativa (sin surcos ni audio);
 *      · funda-interior: tipo, color, troquel, impresión frontal/trasera,
 *        texto (letras) y su estilo;
 *      · carpeta: portada, contraportada, desplegable con interiores,
 *        acabado, título en portada y estilo, lista en contraportada, notas,
 *        esquina cortada, pegatina;
 *      · lomo: texto, fondo, estilo, franja de color, número de catálogo;
 *      · funda-exterior: tipo, tinte, opacidad, impresión, brillo;
 *      · canciones (por cara): lista ordenable con título, duración y
 *        archivo de audio (importar con `importAudio`, arrastrar y soltar,
 *        quitar), duración editable si no hay audio.
 *    Además: datos generales (artista, título, año, sello, catálogo,
 *    género, notas) en la cabecera; botón "Aplicar preset" (normal / aro /
 *    completo) que reescribe la decoración de ambas caras; "Eliminar vinilo"
 *    con confirmación; "Cerrar".
 *  - Los controles son nativos (<input type=color|range|text>, <select>,
 *    <textarea>) con etiquetas visibles. Las imágenes se suben con
 *    <input type=file accept=image/*> y se guardan en `store.blobs`.
 */
import type { Store } from '../core/store';
import type { AppState, Track } from '../core/types';
import type { Renderers } from '../render';

export interface EditorDeps {
  store: Store;
  renderers: Renderers;
  importAudio(files: File[]): Promise<{ tracks: Track[]; rejected: { fileName: string; reason: string }[] }>;
  close(): void;
}

export interface EditorView {
  readonly el: HTMLElement;
  update(state: AppState): void;
}

export function createEditorView(_deps: EditorDeps): EditorView {
  throw new Error('createEditorView: no implementado todavía');
}
