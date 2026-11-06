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
 *
 * Detalles de la implementación:
 *  - El formulario de un vinilo (cabecera y panel) se construye una vez
 *    por vinilo; el panel se reconstruye al cambiar de pestaña. Entre
 *    tanto, `update(state)` solo sincroniza los valores (sin pisar el campo
 *    con el foco), así se puede escribir en vivo sin perder el cursor.
 *  - La cara elegida (A/B), la vista de la carpeta y de la funda, y si el
 *    grosor se editó a mano son estado local de la sesión de edición: se
 *    reinician al editar otro vinilo o al volver a abrir el cajón.
 *  - Toda escritura pasa por `editVinyl` (context.ts): `touch()` y borrado
 *    de los blobs que la edición dejó sin usar.
 *  - Soltar archivos sobre el cajón no llega a la habitación (que crearía
 *    un vinilo nuevo): solo la zona de la pestaña Canciones los acepta.
 */
import './editor.css';
import { collectImageRefs } from '../core/blobs';
import { findVinyl, spineTextFor } from '../core/defaults';
import type { Store } from '../core/store';
import type { AppState, EditorTab, Track, Vinyl } from '../core/types';
import type { Renderers } from '../render';
import { appendChildren, button, h, setText, uniqueId } from './controls';
import { createLocal, EditorContext, SyncScope, type EditorSession } from './context';
import { buildGeneral } from './header';
import { createPreview } from './preview';
import { TABS, tabDefinition } from './tabs';

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

/** Sesión de edición de un vinilo: dura mientras el cajón muestra ese vinilo. */
interface Session extends EditorSession {
  tab: EditorTab | null;
  /** Último vinilo recibido en `update` (el que reflejan los controles). */
  vinyl: Vinyl;
  readonly general: SyncScope;
  readonly panel: SyncScope;
  /** `updatedAt` para el que ya se pidió cargar las imágenes. */
  imagesStamp: number;
}

interface Shell {
  root: HTMLElement;
  subtitle: HTMLElement;
  form: HTMLElement;
  empty: HTMLElement;
  previewHost: HTMLElement;
  scroll: HTMLElement;
  general: HTMLElement;
  tablist: HTMLElement;
  panel: HTMLElement;
  tabs: Map<EditorTab, HTMLButtonElement>;
}

export function createEditorView(deps: EditorDeps): EditorView {
  let session: Session | null = null;
  let wasOpen = false;
  const shell = buildShell(selectTab, () => deps.close());
  const preview = createPreview(
    deps.renderers,
    () => session?.local ?? null,
    () => session?.resync(),
  );
  shell.previewHost.append(preview.el);
  // Cuando llega una imagen la fachada vacía su caché: hay que volver a pedir los canvases.
  deps.renderers.images.onLoad(() => preview.invalidate());

  function selectTab(tab: EditorTab): void {
    if (session?.tab === tab) return;
    deps.store.update((draft) => {
      draft.ui.editorTab = tab;
    });
  }

  function startSession(vinyl: Vinyl): Session {
    const s: Session = {
      services: deps,
      vinylId: vinyl.id,
      local: createLocal(),
      tab: null,
      vinyl,
      general: new SyncScope(),
      panel: new SyncScope(),
      imagesStamp: Number.NaN,
      resync: () => {
        if (session !== s) return;
        syncAll(s);
        if (s.tab) preview.update(s.vinyl, s.tab);
      },
    };
    session = s;
    shell.general.replaceChildren();
    appendChildren(shell.general, buildGeneral(new EditorContext(s, s.general), () => void deleteVinyl(s)));
    shell.form.hidden = false;
    shell.empty.hidden = true;
    shell.scroll.scrollTop = 0;
    return s;
  }

  /**
   * Termina la sesión. Con el cajón cerrándose se deja el contenido tal
   * cual (congelado, ya no se sincroniza) para que no se vacíe mientras se
   * desliza; con el cajón abierto y sin vinilo se muestra el aviso.
   */
  function endSession(open: boolean): void {
    session = null;
    if (!open) return;
    if (shell.form.hidden) return;
    shell.general.replaceChildren();
    shell.panel.replaceChildren();
    shell.form.hidden = true;
    shell.empty.hidden = false;
    setText(shell.subtitle, '');
    preview.clear();
  }

  function buildPanel(s: Session, tab: EditorTab): void {
    s.tab = tab;
    s.panel.clear();
    shell.panel.replaceChildren();
    appendChildren(shell.panel, tabDefinition(tab).build(new EditorContext(s, s.panel)));
    for (const [id, b] of shell.tabs) {
      const selected = id === tab;
      b.setAttribute('aria-selected', String(selected));
      b.tabIndex = selected ? 0 : -1;
      if (selected) shell.panel.setAttribute('aria-labelledby', b.id);
    }
    // Si se había bajado por el panel anterior, se vuelve a las pestañas.
    if (shell.scroll.scrollTop > shell.tablist.offsetTop) shell.scroll.scrollTop = shell.tablist.offsetTop;
  }

  function syncAll(s: Session): void {
    setText(shell.subtitle, spineTextFor(s.vinyl.meta));
    s.general.run(s.vinyl);
    s.panel.run(s.vinyl);
  }

  function ensureImages(s: Session): void {
    if (s.imagesStamp === s.vinyl.updatedAt) return;
    s.imagesStamp = s.vinyl.updatedAt;
    deps.renderers.images.ensure(collectImageRefs(s.vinyl)).catch((err: unknown) => {
      console.error('Tocadiscos: no se pudieron cargar las imágenes del vinilo.', err);
    });
  }

  async function deleteVinyl(s: Session): Promise<void> {
    const v = s.vinyl;
    const question = `¿Eliminar «${spineTextFor(v.meta)}» de la colección? También se borrarán sus imágenes y su audio. No se puede deshacer.`;
    if (!window.confirm(question)) return;
    const removal = deps.store.removeVinyl(v.id);
    deps.close();
    try {
      const keys = await removal;
      for (const key of keys) deps.renderers.images.forget(key);
      deps.renderers.invalidate(v.id);
    } catch (err) {
      console.error('Tocadiscos: el vinilo se quitó, pero no se pudieron borrar todos sus archivos.', err);
    }
  }

  function update(state: AppState): void {
    const open = state.ui.view === 'editor';
    const reopened = open && !wasOpen;
    wasOpen = open;
    const vinyl = findVinyl(state, state.ui.editorVinylId);
    if (!vinyl) {
      endSession(open);
      return;
    }
    const tab = tabDefinition(state.ui.editorTab).id;
    let s = session;
    const fresh = !s || s.vinylId !== vinyl.id || reopened;
    if (!s || fresh) s = startSession(vinyl);
    const tabChanged = s.tab !== tab;
    if (tabChanged) buildPanel(s, tab);
    if (fresh || tabChanged || vinyl !== s.vinyl) {
      s.vinyl = vinyl;
      syncAll(s);
    }
    ensureImages(s);
    preview.update(vinyl, tab);
  }

  return { el: shell.root, update };
}

// ---------------------------------------------------------------------------
// Estructura fija del cajón
// ---------------------------------------------------------------------------

function buildShell(onTab: (tab: EditorTab) => void, onClose: () => void): Shell {
  const title = h('h2', 'ed-bar__title', ['Editar vinilo']);
  title.id = uniqueId('ed-titulo');
  const subtitle = h('p', 'ed-bar__subtitle');
  const close = button('Cerrar', onClose, { className: 'ed-btn ed-btn--cerrar', dataTest: 'editor-cerrar' });
  const bar = h('header', 'ed-bar', [h('div', 'ed-bar__titles', [title, subtitle]), close]);

  const panel = h('div', 'ed-panel');
  panel.id = uniqueId('ed-panel');
  panel.setAttribute('role', 'tabpanel');
  panel.tabIndex = 0;
  const { tablist, tabs } = buildTablist(panel.id, onTab);

  const previewHost = h('div', 'ed-preview-host');
  const general = h('div', 'ed-general-box');
  const scroll = h('div', 'ed-scroll', [general, tablist, panel]);
  const form = h('div', 'ed-form', [previewHost, scroll]);
  form.hidden = true;
  const empty = h('p', 'ed-empty', ['Elige un vinilo de la estantería para editarlo.']);

  // La habitación lo envuelve en su propio <aside>: aquí basta una región con nombre.
  const root = h('section', 'ed', [bar, form, empty]);
  root.dataset.test = 'editor';
  root.setAttribute('aria-labelledby', title.id);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      onClose();
    }
  });
  guardDrops(root);
  return { root, subtitle, form, empty, previewHost, scroll, general, tablist, panel, tabs };
}

/** Pestañas con el patrón ARIA: flechas, Inicio y Fin cambian de pestaña (activación automática). */
function buildTablist(panelId: string, onTab: (tab: EditorTab) => void): {
  tablist: HTMLElement;
  tabs: Map<EditorTab, HTMLButtonElement>;
} {
  const tabs = new Map<EditorTab, HTMLButtonElement>();
  const tablist = h('div', 'ed-tabs');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Partes del vinilo');
  for (const def of TABS) {
    const b = button(def.label, () => onTab(def.id), { className: 'ed-tab', dataTest: `editor-tab-${def.id}` });
    b.id = uniqueId(`ed-tab-${def.id}`);
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', 'false');
    b.setAttribute('aria-controls', panelId);
    b.tabIndex = -1;
    tabs.set(def.id, b);
    tablist.append(b);
  }
  tablist.addEventListener('keydown', (e) => {
    const ids = TABS.map((t) => t.id);
    const current = ids.findIndex((id) => tabs.get(id) === e.target);
    if (current < 0) return;
    let next = current;
    if (e.key === 'ArrowRight') next = (current + 1) % ids.length;
    else if (e.key === 'ArrowLeft') next = (current - 1 + ids.length) % ids.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ids.length - 1;
    else return;
    e.preventDefault();
    const id = ids[next];
    if (!id) return;
    tabs.get(id)?.focus();
    onTab(id);
  });
  return { tablist, tabs };
}

/**
 * Arrastrar archivos sobre el cajón fuera de la zona de Canciones no hace
 * nada (y no deja que el gesto llegue a la habitación).
 */
function guardDrops(root: HTMLElement): void {
  const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  root.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
  });
  root.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
  });
}
