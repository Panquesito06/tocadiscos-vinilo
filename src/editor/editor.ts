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
 *    la carpeta con la funda exterior. Usa `renderers` y copia con `blit()`
 *    en canvases propios (los canvases de la fachada son compartidos).
 *  - Dos controles compartidos cubren todos los rellenos y estilos:
 *    `FillEditor` (sólido: color; degradado: from, to, angleDeg, radial;
 *    imagen: archivo, fit, backdrop; quitar imagen) y `TextStyleEditor`
 *    (color, peso 100–900, anchura condensed/normal/expanded, alineación,
 *    mayúsculas).
 *  - Pestañas (`EditorTab`), que juntas cubren TODAS las propiedades de
 *    core/types.ts:
 *      · disco: formato 7/10/12, velocidad nominal 33/45/78, material,
 *        color y color2, peso (y grosor derivado, editable), profundidad de
 *        surco, calidad de prensado, estado (polvo, desgaste, alabeo, rayas)
 *        con texto descriptivo y botón "Limpiar a fondo"; reproducciones;
 *      · surcos: profundidad, separación entre canciones, texto del dead
 *        wax por cara, lectura de densidad (vueltas/mm) y duración por cara;
 *      · agujero: pequeño/grande, aviso de que el grande necesita centrador;
 *      · galleta (por cara, selector A/B): decoración normal/aro/completa,
 *        cara decorativa, fondo (FillEditor), estilo del texto y estilo del
 *        sello en grande (`brandText`, TextStyleEditor), campos (artista,
 *        título, sello, catálogo, año, cara, rpm, lista, interruptor y texto
 *        de copyright, líneas extra), imagen y escala, anillo del agujero;
 *        aro decorado (patrón, colores, anchura, imagen); obra a cara
 *        completa (FillEditor), borde (activo, color, anchura, remaches),
 *        surcos encima; "Copiar a la otra cara";
 *      · funda-interior: tipo, color, troquel, impresión frontal/trasera
 *        (FillEditor), texto (letras) y su estilo;
 *      · carpeta: portada y contraportada (FillEditor), desplegable con
 *        interiores, acabado, título en portada y su estilo, lista en
 *        contraportada, notas y su estilo (`backStyle`), esquina cortada,
 *        pegatina (texto y color, quitar);
 *      · lomo: texto, fondo, estilo, franja de color, número de catálogo;
 *      · funda-exterior: tipo, tinte, opacidad, impresión (FillEditor),
 *        brillo;
 *      · canciones (por cara): lista ordenable con título, duración y
 *        archivo de audio (importar con `importAudio`, arrastrar y soltar,
 *        quitar), duración editable si no hay audio.
 *    Además: datos generales (artista, título, año, sello, catálogo,
 *    género, notas) en la cabecera; botón "Aplicar preset" (normal / aro /
 *    completo) que reescribe la decoración de ambas caras; "Eliminar vinilo"
 *    con confirmación; "Cerrar".
 *  - Sincronización: al cambiar un dato general se llama a
 *    `syncDerivedTexts(vinyl, metaAnterior)` (core/defaults.ts): propaga a
 *    `label.fields` de ambas caras y a `spine.text` solo los campos que el
 *    usuario no personalizó. "Aplicar preset" usa `applyPresetDecoration`
 *    (conserva pistas y metadatos). Cada mutación termina con `touch(v)`
 *    (updatedAt estrictamente creciente). Con decoración "completa" se
 *    ocultan los campos de la galleta salvo el anillo del agujero. La
 *    anchura del aro se limita a `maxRingWidthMm(format)`.
 *  - Blobs: al sustituir o quitar una imagen o un archivo de audio, se borra
 *    el blob anterior con `store.blobs.delete(clave)` si ningún otro vinilo
 *    lo usa (`isBlobKeyInUse` de core/blobs.ts) y se avisa con
 *    `renderers.images.forget(clave)`.
 *  - Los controles son nativos (<input type=color|range|text>, <select>,
 *    <textarea>) con etiquetas visibles. Las imágenes se suben con
 *    <input type=file accept=image/*> y se guardan en `store.blobs`.
 *    Atributos `data-test` de DESIGN.md §6.
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
