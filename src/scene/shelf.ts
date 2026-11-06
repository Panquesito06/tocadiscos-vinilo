/**
 * Estantería de vinilos (y cajas en el suelo cuando se llena).
 *
 * CONTRATO (lo implementa el módulo de escena de la habitación):
 *  - Escala propia de la estantería, independiente del tocadiscos:
 *    `SHELF_PX_PER_MM = 0.75` para la ALTURA del lomo
 *    (`jacketSizeMm(format) × 0.75` → 12" ≈ 236 px, 10" ≈ 195 px,
 *    7" ≈ 135 px CSS) y anchura de lomo `max(16, round(spineWidthMm × 3))`
 *    px CSS para que sea legible y clicable. La balda tiene la altura del
 *    12" más margen; los lomos se apoyan en el fondo (align-items: end).
 *    Capacidad = floor(anchoÚtilPx / anchoLomoPx), medida con
 *    ResizeObserver. Al llenarse una balda aparece la siguiente debajo;
 *    cuando no caben más baldas en la altura disponible (mínimo 1), los
 *    siguientes vinilos van a cajas de madera en el suelo (25 por caja),
 *    vistas de frente (se ve la portada del primero y los cantos del resto).
 *  - El lomo se dibuja copiando con `blit()` el canvas de
 *    `renderers.spine(vinyl, w·dpr, h·dpr)` en un canvas propio; el vinilo
 *    cargado en el plato deja un hueco vacío en la estantería; el que está
 *    en la mano, otro hueco.
 *  - Cada lomo es `button[data-test="lomo"][data-vinyl-id]` con `title` y
 *    `aria-label` = texto del lomo. Al pasar el puntero, el lomo se
 *    adelanta (salvo con `prefers-reduced-motion`) y muestra una miniatura
 *    de la portada; clic → `pickVinyl`. Botón "Añadir vinilo" al final de
 *    la última balda → `addVinyl`.
 *  - Orden: por `shelfIndex` y, en empate, por `createdAt`. Arrastrar un
 *    lomo a otra posición → `reorder(id, newIndex)` con `newIndex` = posición
 *    destino en la lista ordenada.
 *  - Teclado: los lomos son focusables; Enter = sacar; E = editar.
 *
 * IMPLEMENTACIÓN:
 *  - El reparto en baldas y cajas es puro y vive en `shelf-layout.ts`
 *    (las constantes de escala también; aquí se reexportan).
 *  - `update()` sale enseguida si no cambian los vinilos, el plato, la mano,
 *    el vinilo en edición, los renderers ni la densidad de píxeles. Si
 *    cambian, recalcula el reparto (O(n)) y solo mueve nodos del DOM cuando
 *    cambia la estructura (qué va en cada balda, tamaños, huecos, cajas);
 *    los lienzos se vuelven a copiar solo cuando cambia la referencia que
 *    devuelve la fachada de render.
 *  - Eventos delegados en la raíz (un solo juego de oyentes para todos los
 *    lomos). Arrastre con pointer events y umbral de `DRAG_THRESHOLD_PX`;
 *    el destino se calcula con los rectángulos de los elementos de cada
 *    fila. Teclado extra: ←/→ mueven el foco entre lomos y Alt+←/→
 *    reordenan (alternativa accesible al arrastre).
 *  - El botón de añadir de la estantería lleva `data-test="estanteria-anadir"`
 *    para no duplicar el `anadir-vinilo` de la barra de la habitación.
 */
import { findVinyl, spineTextFor } from '../core/defaults';
import type { AppState, Vinyl } from '../core/types';
import { blit, type Renderers } from '../render';
import { spineWidthMm } from '../render/jacket';
import {
  ADD_SLOT_WIDTH_PX,
  CRATE_ZONE_PX,
  DRAG_THRESHOLD_PX,
  SHELF_BOARD_PX,
  SHELF_FRAME_PX,
  SHELF_HEADROOM_PX,
  SHELF_INNER_PADDING_PX,
  SHELF_ROW_HEIGHT_PX,
  insertionSlot,
  planShelf,
  reorderTarget,
  sortForShelf,
  spineHeightPx,
  spineWidthPx,
  type ShelfPlan,
  type SlotItem,
} from './shelf-layout';
import './shelf.css';

export { CRATE_CAPACITY, SHELF_PX_PER_MM, SPINE_MIN_WIDTH_PX, SPINE_WIDTH_SCALE } from './shelf-layout';

export interface ShelfActions {
  pickVinyl(id: string): void;
  addVinyl(): void;
  openEditor(id: string): void;
  reorder(id: string, newIndex: number): void;
}

export interface ShelfView {
  readonly el: HTMLElement;
  update(state: AppState, renderers: Renderers): void;
}

/** Lado de la miniatura de portada que flota sobre el lomo, en px CSS. */
export const SHELF_THUMB_PX = 160;
/** Lado de la portada visible en la parte delantera de una caja, en px CSS. */
export const CRATE_COVER_PX = 112;
/** Cantos de vinilo que asoman como mucho detrás de la portada de una caja. */
export const CRATE_MAX_EDGES = 10;
/** Medidas de respaldo cuando no se puede medir (sin maquetación, p. ej. en tests). */
export const SHELF_FALLBACK_WIDTH_PX = 480;
export const SHELF_FALLBACK_HEIGHT_PX = SHELF_FRAME_PX + 3 * SHELF_ROW_HEIGHT_PX + CRATE_ZONE_PX;

const EMPTY_TEXT = 'Todavía no hay vinilos. Añade uno o suelta archivos de audio aquí.';

type OutPlace = 'plato' | 'mano';

interface ShelfItem {
  vinyl: Vinyl;
  order: number;
  widthPx: number;
  heightPx: number;
  text: string;
  out: OutPlace | null;
}

interface SpineEntry {
  button: HTMLButtonElement;
  canvas: HTMLCanvasElement;
  source: HTMLCanvasElement | null;
}

interface CrateEntry {
  button: HTMLButtonElement;
  edges: HTMLSpanElement;
  edgesKey: string;
  cover: HTMLCanvasElement;
  coverSource: HTMLCanvasElement | null;
  count: HTMLSpanElement;
}

interface Row {
  el: HTMLDivElement;
  fila: HTMLDivElement;
}

interface Press {
  id: string;
  button: HTMLButtonElement;
  pointerId: number;
  x: number;
  y: number;
}

interface Drag extends Press {
  from: number;
}

// ---------------------------------------------------------------------------
// Utilidades de DOM
// ---------------------------------------------------------------------------

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  attrs: Record<string, string> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  for (const child of children) el.append(child);
  return el;
}

function setAttr(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function setSize(el: HTMLElement, widthPx: number, heightPx: number): void {
  const w = `${widthPx}px`;
  const hgt = `${heightPx}px`;
  if (el.style.width !== w) el.style.width = w;
  if (el.style.height !== hgt) el.style.height = hgt;
}

function pixelRatio(): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/** Copia `source` en `target` si la referencia cambió. Devuelve la nueva referencia. */
function paint(target: HTMLCanvasElement, previous: HTMLCanvasElement | null, source: HTMLCanvasElement): HTMLCanvasElement {
  if (source !== previous) blit(target, source);
  return source;
}

function spineLabel(vinyl: Vinyl): string {
  return vinyl.spine.text.trim() || spineTextFor(vinyl.meta);
}

function holeLabel(item: ShelfItem): string {
  return item.out === 'plato' ? `«${item.text}» está en el plato` : `«${item.text}» está en la mano`;
}

function lomoFrom(target: EventTarget | null): HTMLButtonElement | null {
  return target instanceof Element ? target.closest<HTMLButtonElement>('button[data-test="lomo"]') : null;
}

function matchesFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------

export function createShelfView(actions: ShelfActions): ShelfView {
  const root = h('section', 'est', { 'data-test': 'estanteria', 'aria-label': 'Estantería de vinilos' });
  root.style.setProperty('--est-fila-alto', `${SHELF_ROW_HEIGHT_PX}px`);
  root.style.setProperty('--est-hueco-alto', `${SHELF_HEADROOM_PX}px`);
  root.style.setProperty('--est-tabla', `${SHELF_BOARD_PX}px`);
  root.style.setProperty('--est-marco', `${SHELF_FRAME_PX}px`);
  root.style.setProperty('--est-relleno', `${SHELF_INNER_PADDING_PX}px`);
  root.style.setProperty('--est-suelo-alto', `${CRATE_ZONE_PX}px`);
  root.style.setProperty('--est-anadir-ancho', `${ADD_SLOT_WIDTH_PX}px`);
  root.style.setProperty('--est-lomo-alto-12', `${spineHeightPx('12')}px`);

  const baldas = h('div', 'est-baldas');
  const mueble = h('div', 'est-mueble', {}, [baldas]);
  const suelo = h('div', 'est-suelo', { role: 'group', 'aria-label': 'Cajas en el suelo' });
  suelo.hidden = true;

  const addButton = h('button', 'est-anadir', { type: 'button', 'data-test': 'estanteria-anadir', title: 'Añadir vinilo' }, [
    h('span', 'est-anadir-texto', {}, ['Añadir vinilo']),
  ]);
  const emptyNote = h('p', 'est-vacia', {}, [EMPTY_TEXT]);

  const listTitle = h('p', 'est-caja-lista-titulo');
  const listClose = h('button', 'est-caja-cerrar', { type: 'button', 'data-test': 'caja-cerrar' }, ['Cerrar']);
  const listRow = h('div', 'est-caja-fila', { 'data-fila': '', role: 'group', 'aria-label': 'Vinilos de la caja' });
  const list = h('div', 'est-caja-lista', { role: 'region', 'aria-label': 'Contenido de la caja' }, [
    h('div', 'est-caja-lista-cabecera', {}, [listTitle, listClose]),
    listRow,
  ]);
  list.hidden = true;

  const thumbCanvas = h('canvas', 'est-miniatura-lienzo');
  const thumb = h('div', 'est-miniatura', { 'aria-hidden': 'true' }, [thumbCanvas]);
  const marker = h('div', 'est-marcador', { 'aria-hidden': 'true' });

  root.append(mueble, suelo, list, thumb, marker);

  const rows: Row[] = [];
  const spines = new Map<string, SpineEntry>();
  const holes = new Map<string, HTMLDivElement>();
  const crates: CrateEntry[] = [];

  let lastState: AppState | null = null;
  let lastRenderers: Renderers | null = null;
  let lastOutKey = '';
  let lastDpr = 0;
  let lastKey = '';
  let dirty = true;
  let order: string[] = [];
  let openCrate: number | null = null;
  let pendingFocusId: string | null = null;
  let thumbSource: HTMLCanvasElement | null = null;
  let suppressClick = false;
  let press: Press | null = null;
  let drag: Drag | null = null;
  let dropSlot: number | null = null;
  const size = { width: SHELF_FALLBACK_WIDTH_PX, height: SHELF_FALLBACK_HEIGHT_PX, measured: false };

  // ----- medida ---------------------------------------------------------------

  /** Mide el ancho útil de las baldas y la altura disponible. Devuelve true si cambió. */
  function measure(): boolean {
    const outerWidth = baldas.clientWidth;
    const height = root.clientHeight;
    if (!(outerWidth > 0) || !(height > 0)) return false;
    const width = Math.max(0, outerWidth - 2 * SHELF_INNER_PADDING_PX);
    size.measured = true;
    if (width === size.width && height === size.height) return false;
    size.width = width;
    size.height = height;
    return true;
  }

  let frameRequest = 0;
  function scheduleMeasure(): void {
    if (frameRequest) return;
    const run = (): void => {
      frameRequest = 0;
      if (measure()) {
        dirty = true;
        if (lastState && lastRenderers) render();
      }
    };
    if (typeof requestAnimationFrame === 'function') frameRequest = requestAnimationFrame(run);
    else run();
  }

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => scheduleMeasure()).observe(root);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => scheduleMeasure());
  }

  // ----- modelo -----------------------------------------------------------------

  function buildItems(state: AppState): ShelfItem[] {
    const loaded = state.turntable.loaded?.vinylId ?? null;
    const inHand = state.ui.handVinylId;
    return sortForShelf(state.vinyls).map((vinyl, index) => ({
      vinyl,
      order: index,
      widthPx: spineWidthPx(spineWidthMm(vinyl)),
      heightPx: spineHeightPx(vinyl.disc.format),
      text: spineLabel(vinyl),
      out: vinyl.id === loaded ? 'plato' : vinyl.id === inHand ? 'mano' : null,
    }));
  }

  function itemKey(item: ShelfItem | undefined): string {
    if (!item) return '';
    return `${item.vinyl.id}:${item.out ?? ''}:${item.widthPx}x${item.heightPx}`;
  }

  function structureKey(plan: ShelfPlan, byId: Map<string, ShelfItem>): string {
    const shelves = plan.shelves.map((ids) => ids.map((id) => itemKey(byId.get(id))).join(',')).join('|');
    const crateIds = plan.crates.map((ids) => ids.join(',')).join('|');
    const list = openCrate === null ? '' : (plan.crates[openCrate] ?? []).map((id) => itemKey(byId.get(id))).join(',');
    return `${shelves}#${crateIds}#${openCrate ?? ''}#${list}`;
  }

  // ----- elementos --------------------------------------------------------------

  function spineFor(item: ShelfItem): SpineEntry {
    let entry = spines.get(item.vinyl.id);
    if (!entry) {
      const canvas = h('canvas', 'est-lomo-lienzo', { 'aria-hidden': 'true' });
      const button = h('button', 'est-lomo', { type: 'button', 'data-test': 'lomo', 'data-vinyl-id': item.vinyl.id }, [canvas]);
      entry = { button, canvas, source: null };
      spines.set(item.vinyl.id, entry);
    }
    setAttr(entry.button, 'data-orden', String(item.order));
    setSize(entry.button, item.widthPx, item.heightPx);
    return entry;
  }

  function holeFor(item: ShelfItem): HTMLDivElement {
    let el = holes.get(item.vinyl.id);
    if (!el) {
      el = h('div', 'est-hueco', { 'data-test': 'hueco', 'data-vinyl-id': item.vinyl.id, role: 'img' });
      holes.set(item.vinyl.id, el);
    }
    setAttr(el, 'data-orden', String(item.order));
    setAttr(el, 'data-lugar', item.out ?? '');
    setSize(el, item.widthPx, item.heightPx);
    return el;
  }

  function elementFor(item: ShelfItem, used: Set<string>): HTMLElement {
    used.add(item.vinyl.id);
    return item.out ? holeFor(item) : spineFor(item).button;
  }

  function rowAt(index: number): Row {
    let row = rows[index];
    if (!row) {
      const fila = h('div', 'est-fila', { 'data-fila': '', role: 'group' });
      const el = h('div', 'est-balda', {}, [fila, h('div', 'est-tabla', { 'aria-hidden': 'true' })]);
      row = { el, fila };
      rows[index] = row;
    }
    setAttr(row.fila, 'aria-label', `Balda ${index + 1}`);
    return row;
  }

  function crateAt(index: number): CrateEntry {
    let entry = crates[index];
    if (!entry) {
      const edges = h('span', 'est-caja-cantos', { 'aria-hidden': 'true' });
      const cover = h('canvas', 'est-caja-portada', { 'aria-hidden': 'true' });
      const count = h('span', 'est-caja-cuenta', { 'aria-hidden': 'true' });
      const front = h('span', 'est-caja-frente', { 'aria-hidden': 'true' }, [h('span', 'est-caja-asa'), count]);
      const button = h('button', 'est-caja', { type: 'button', 'data-test': 'caja', 'aria-expanded': 'false' }, [edges, cover, front]);
      entry = { button, edges, edgesKey: '', cover, coverSource: null, count };
      crates[index] = entry;
    }
    setAttr(entry.button, 'data-caja', String(index));
    return entry;
  }

  // ----- estructura -------------------------------------------------------------

  function restructure(plan: ShelfPlan, byId: Map<string, ShelfItem>, empty: boolean): void {
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && root.contains(active) ? active : null;
    hideThumb();
    const used = new Set<string>();

    let start = 0;
    plan.shelves.forEach((ids, index) => {
      const row = rowAt(index);
      const children: HTMLElement[] = [];
      for (const id of ids) {
        const item = byId.get(id);
        if (item) children.push(elementFor(item, used));
      }
      if (index === plan.shelves.length - 1) {
        if (empty) children.push(emptyNote);
        children.push(addButton);
      }
      row.fila.replaceChildren(...children);
      setAttr(row.fila, 'data-inicio', String(start));
      start += ids.length;
    });
    rows.length = Math.max(1, plan.shelves.length);
    baldas.replaceChildren(...rows.map((r) => r.el));

    suelo.replaceChildren(...plan.crates.map((_, i) => crateAt(i).button));
    crates.length = plan.crates.length;
    suelo.hidden = plan.crates.length === 0;
    root.classList.toggle('est-con-cajas', plan.crates.length > 0);

    const listIds = openCrate === null ? [] : (plan.crates[openCrate] ?? []);
    const listChildren: HTMLElement[] = [];
    for (const id of listIds) {
      const item = byId.get(id);
      if (item) listChildren.push(elementFor(item, used));
    }
    listRow.replaceChildren(...listChildren);
    setAttr(listRow, 'data-inicio', String(byId.get(listIds[0] ?? '')?.order ?? 0));
    list.hidden = openCrate === null;

    for (const id of Array.from(spines.keys())) if (!used.has(id) || byId.get(id)?.out) spines.delete(id);
    for (const id of Array.from(holes.keys())) if (!used.has(id) || !byId.get(id)?.out) holes.delete(id);

    if (focused && focused.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }

  // ----- contenido --------------------------------------------------------------

  function refreshSpines(byId: Map<string, ShelfItem>, renderers: Renderers, dpr: number, selectedId: string | null): void {
    for (const [id, entry] of spines) {
      const item = byId.get(id);
      if (!item) continue;
      setAttr(entry.button, 'title', item.text);
      setAttr(entry.button, 'aria-label', item.text);
      entry.button.classList.toggle('es-seleccionado', id === selectedId);
      const source = renderers.spine(item.vinyl, Math.round(item.widthPx * dpr), Math.round(item.heightPx * dpr));
      entry.source = paint(entry.canvas, entry.source, source);
      setSize(entry.canvas, item.widthPx, item.heightPx);
    }
    for (const [id, el] of holes) {
      const item = byId.get(id);
      if (!item) continue;
      const label = holeLabel(item);
      setAttr(el, 'title', label);
      setAttr(el, 'aria-label', label);
    }
  }

  function refreshCrates(plan: ShelfPlan, byId: Map<string, ShelfItem>, renderers: Renderers, dpr: number): void {
    plan.crates.forEach((ids, index) => {
      const entry = crateAt(index);
      const inside = ids.map((id) => byId.get(id)).filter((item): item is ShelfItem => !!item && !item.out);
      const first = inside[0];
      if (first) {
        const source = renderers.jacketFront(first.vinyl, Math.round(CRATE_COVER_PX * dpr));
        entry.coverSource = paint(entry.cover, entry.coverSource, source);
        setSize(entry.cover, CRATE_COVER_PX, CRATE_COVER_PX);
      }
      entry.cover.hidden = !first;
      // Cantos del resto, del más cercano a la portada al más lejano.
      const colors = inside.slice(1, 1 + CRATE_MAX_EDGES).map((item) => item.vinyl.spine.background);
      const edgesKey = colors.join('|');
      if (edgesKey !== entry.edgesKey) {
        entry.edgesKey = edgesKey;
        // El más lejano va primero en el DOM (debajo) y asoma más alto.
        const edges = colors.map((color, i) => {
          const edge = h('span', 'est-caja-canto');
          edge.style.background = color;
          edge.style.setProperty('--canto', String(i + 1));
          return edge;
        });
        entry.edges.replaceChildren(...edges.reverse());
      }
      const open = openCrate === index;
      setText(entry.count, String(ids.length));
      const label = `Caja ${index + 1} con ${ids.length} ${ids.length === 1 ? 'vinilo' : 'vinilos'}`;
      setAttr(entry.button, 'aria-label', open ? `${label}. Abierta` : label);
      setAttr(entry.button, 'title', label);
      setAttr(entry.button, 'aria-expanded', open ? 'true' : 'false');
      entry.button.classList.toggle('es-abierta', open);
    });
    if (openCrate !== null) {
      const n = plan.crates[openCrate]?.length ?? 0;
      setText(listTitle, `Caja ${openCrate + 1}: ${n} ${n === 1 ? 'vinilo' : 'vinilos'}`);
    }
  }

  // ----- render -----------------------------------------------------------------

  function render(): void {
    const state = lastState;
    const renderers = lastRenderers;
    if (!state || !renderers) return;
    dirty = false;
    const dpr = lastDpr;
    const items = buildItems(state);
    order = items.map((item) => item.vinyl.id);
    const byId = new Map(items.map((item) => [item.vinyl.id, item]));
    const plan = planShelf({
      vinyls: items.map((item) => item.vinyl),
      widthsPx: items.map((item) => item.widthPx),
      shelfWidthPx: size.width,
      heightPx: size.height,
      trailingPx: ADD_SLOT_WIDTH_PX,
    });
    if (openCrate !== null && openCrate >= plan.crates.length) openCrate = null;

    const empty = items.length === 0;
    const key = `${structureKey(plan, byId)}#${empty ? 'vacia' : ''}`;
    if (key !== lastKey) {
      restructure(plan, byId, empty);
      lastKey = key;
    }
    root.classList.toggle('est-vacia-estado', empty);
    const selectedId = state.ui.view === 'editor' ? state.ui.editorVinylId : null;
    refreshSpines(byId, renderers, dpr, selectedId);
    refreshCrates(plan, byId, renderers, dpr);
    applyPendingFocus();
  }

  function applyPendingFocus(): void {
    if (!pendingFocusId) return;
    const entry = spines.get(pendingFocusId);
    pendingFocusId = null;
    if (entry && entry.button.isConnected && document.activeElement !== entry.button) entry.button.focus({ preventScroll: true });
  }

  function update(state: AppState, renderers: Renderers): void {
    const dpr = pixelRatio();
    if (!size.measured && measure()) dirty = true;
    const outKey = [
      state.turntable.loaded?.vinylId ?? '',
      state.ui.handVinylId ?? '',
      state.ui.view === 'editor' ? (state.ui.editorVinylId ?? '') : '',
    ].join('|');
    const same =
      !dirty &&
      lastState !== null &&
      state.vinyls === lastState.vinyls &&
      outKey === lastOutKey &&
      renderers === lastRenderers &&
      dpr === lastDpr;
    lastState = state;
    lastRenderers = renderers;
    if (same) return;
    lastOutKey = outKey;
    lastDpr = dpr;
    render();
  }

  // ----- miniatura de portada ---------------------------------------------------

  function showThumb(spine: HTMLButtonElement): void {
    const id = spine.dataset.vinylId;
    const vinyl = lastState ? findVinyl(lastState, id) : null;
    if (!vinyl || !lastRenderers || drag) return;
    const dpr = pixelRatio();
    const source = lastRenderers.jacketFront(vinyl, Math.round(SHELF_THUMB_PX * dpr));
    thumbSource = paint(thumbCanvas, thumbSource, source);
    setSize(thumbCanvas, SHELF_THUMB_PX, SHELF_THUMB_PX);
    const rect = spine.getBoundingClientRect();
    const viewW = window.innerWidth || SHELF_FALLBACK_WIDTH_PX;
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - SHELF_THUMB_PX / 2), Math.max(8, viewW - SHELF_THUMB_PX - 8));
    let top = rect.top - SHELF_THUMB_PX - 18;
    if (top < 8) top = rect.bottom + 8;
    thumb.style.left = `${Math.round(left)}px`;
    thumb.style.top = `${Math.round(top)}px`;
    thumb.classList.add('es-visible');
  }

  function hideThumb(): void {
    thumb.classList.remove('es-visible');
  }

  // ----- arrastre ---------------------------------------------------------------

  function startDrag(p: Press): void {
    const from = order.indexOf(p.id);
    if (from < 0) {
      press = null;
      return;
    }
    drag = { ...p, from };
    try {
      p.button.setPointerCapture(p.pointerId);
    } catch {
      // Sin captura el arrastre sigue funcionando mientras el puntero esté encima.
    }
    p.button.classList.add('es-arrastrado');
    root.classList.add('est-arrastrando');
    hideThumb();
  }

  function endDrag(): void {
    const d = drag;
    drag = null;
    dropSlot = null;
    marker.classList.remove('es-visible');
    root.classList.remove('est-arrastrando');
    if (!d) return;
    d.button.classList.remove('es-arrastrado');
    d.button.style.transform = '';
    try {
      if (d.button.hasPointerCapture(d.pointerId)) d.button.releasePointerCapture(d.pointerId);
    } catch {
      // El puntero ya no existe: nada que liberar.
    }
  }

  function rowItems(row: HTMLElement): SlotItem[] {
    const items: SlotItem[] = [];
    for (const child of Array.from(row.children)) {
      if (!(child instanceof HTMLElement) || child === drag?.button) continue;
      const order = child.dataset.orden;
      if (order === undefined) continue;
      const r = child.getBoundingClientRect();
      items.push({ order: Number(order), left: r.left, width: r.width });
    }
    return items;
  }

  function updateDropSlot(x: number, y: number): void {
    for (const row of Array.from(root.querySelectorAll<HTMLElement>('[data-fila]'))) {
      if (row.closest('[hidden]')) continue;
      const r = row.getBoundingClientRect();
      if (y < r.top - 12 || y > r.bottom + SHELF_BOARD_PX || x < r.left - 24 || x > r.right + 24) continue;
      const items = rowItems(row);
      const slot = insertionSlot(items, x, Number(row.dataset.inicio ?? 0));
      const at = items.find((item) => item.order === slot);
      const last = items.reduce<SlotItem | null>((acc, item) => (!acc || item.left > acc.left ? item : acc), null);
      const markerX = at ? at.left : last ? last.left + last.width : r.left + SHELF_INNER_PADDING_PX;
      marker.style.left = `${Math.round(markerX - 1.5)}px`;
      marker.style.top = `${Math.round(r.top)}px`;
      marker.style.height = `${Math.round(r.height)}px`;
      marker.classList.add('es-visible');
      dropSlot = slot;
      return;
    }
    dropSlot = null;
    marker.classList.remove('es-visible');
  }

  function onPointerDown(ev: PointerEvent): void {
    if (ev.button !== 0 || !ev.isPrimary) return;
    const spine = lomoFrom(ev.target);
    const id = spine?.dataset.vinylId;
    if (!spine || !id) return;
    press = { id, button: spine, pointerId: ev.pointerId, x: ev.clientX, y: ev.clientY };
    suppressClick = false;
  }

  function onPointerMove(ev: PointerEvent): void {
    if (!press || ev.pointerId !== press.pointerId) return;
    const dx = ev.clientX - press.x;
    const dy = ev.clientY - press.y;
    if (!drag) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      startDrag(press);
    }
    if (!drag) return;
    ev.preventDefault();
    drag.button.style.transform = `translate(${dx}px, ${dy}px)`;
    updateDropSlot(ev.clientX, ev.clientY);
  }

  function onPointerUp(ev: PointerEvent): void {
    if (!press || ev.pointerId !== press.pointerId) return;
    press = null;
    const d = drag;
    if (!d) return;
    const slot = dropSlot;
    endDrag();
    // El clic que sigue a soltar no debe sacar el vinilo.
    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 0);
    if (slot === null) return;
    const target = reorderTarget(d.from, slot);
    if (target !== d.from) actions.reorder(d.id, target);
  }

  function onPointerCancel(ev: PointerEvent): void {
    if (!press || ev.pointerId !== press.pointerId) return;
    press = null;
    endDrag();
  }

  // ----- clic y teclado ---------------------------------------------------------

  function toggleCrate(index: number): void {
    openCrate = openCrate === index ? null : index;
    dirty = true;
    render();
  }

  function closeCrate(): void {
    if (openCrate === null) return;
    const index = openCrate;
    openCrate = null;
    dirty = true;
    render();
    crates[index]?.button.focus({ preventScroll: true });
  }

  function onClick(ev: MouseEvent): void {
    const target = ev.target instanceof Element ? ev.target : null;
    if (!target) return;
    const spine = lomoFrom(target);
    if (spine) {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const id = spine.dataset.vinylId;
      if (id) actions.pickVinyl(id);
      return;
    }
    if (target.closest('.est-anadir')) {
      actions.addVinyl();
      return;
    }
    const crate = target.closest<HTMLButtonElement>('button[data-test="caja"]');
    if (crate) {
      toggleCrate(Number(crate.dataset.caja ?? 0));
      return;
    }
    if (target.closest('.est-caja-cerrar')) closeCrate();
  }

  function focusSibling(spine: HTMLButtonElement, dir: number): void {
    const all = Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-test="lomo"]'));
    const next = all[all.indexOf(spine) + dir];
    next?.focus();
  }

  function moveByKeyboard(id: string, dir: number): void {
    const from = order.indexOf(id);
    if (from < 0) return;
    const to = Math.min(order.length - 1, Math.max(0, from + dir));
    if (to === from) return;
    pendingFocusId = id;
    actions.reorder(id, to);
  }

  function onKeyDown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape' && openCrate !== null) {
      ev.preventDefault();
      closeCrate();
      return;
    }
    const spine = lomoFrom(ev.target);
    const id = spine?.dataset.vinylId;
    if (!spine || !id || ev.ctrlKey || ev.metaKey) return;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      actions.pickVinyl(id);
    } else if ((ev.key === 'e' || ev.key === 'E') && !ev.altKey) {
      ev.preventDefault();
      actions.openEditor(id);
    } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
      ev.preventDefault();
      const dir = ev.key === 'ArrowLeft' ? -1 : 1;
      if (ev.altKey) moveByKeyboard(id, dir);
      else focusSibling(spine, dir);
    }
  }

  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerCancel);
  root.addEventListener('pointerover', (ev) => {
    if (ev.pointerType === 'touch') return;
    const spine = lomoFrom(ev.target);
    if (spine) showThumb(spine);
  });
  root.addEventListener('pointerout', (ev) => {
    const spine = lomoFrom(ev.target);
    if (spine && !(ev.relatedTarget instanceof Node && spine.contains(ev.relatedTarget))) hideThumb();
  });
  root.addEventListener('focusin', (ev) => {
    const spine = lomoFrom(ev.target);
    if (spine && matchesFocusVisible(spine)) showThumb(spine);
  });
  root.addEventListener('focusout', () => hideThumb());

  return { el: root, update };
}
