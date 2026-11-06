/**
 * Dobles mínimos para los tests del editor: un store síncrono en memoria
 * (con almacén de blobs) y una fachada de render que devuelve canvases
 * vacíos del tamaño pedido y anota las llamadas. Solo lo usan los tests.
 */
import { orphanBlobKeys } from '../core/blobs';
import { initialAppState } from '../core/defaults';
import type { BlobStore, Store, StoreListener } from '../core/store';
import type { AppState, UiState, Vinyl } from '../core/types';
import type { Renderers } from '../render';
import type { ImageCache } from '../render/images';
import type { EditorDeps } from './editor';

export interface FakeStore extends Store {
  /** Número de llamadas a `update`. */
  updates: number;
  readonly blobData: Map<string, Blob>;
  readonly deletedBlobs: string[];
}

export function createFakeStore(initial: AppState): FakeStore {
  let state = initial;
  let counter = 0;
  const listeners = new Set<StoreListener>();
  const blobData = new Map<string, Blob>();
  const deletedBlobs: string[] = [];

  const blobs: BlobStore = {
    async put(blob, key) {
      counter += 1;
      const k = key ?? `blob_${counter}`;
      blobData.set(k, blob);
      return k;
    },
    async get(key) {
      return blobData.get(key) ?? null;
    },
    async delete(key) {
      deletedBlobs.push(key);
      blobData.delete(key);
    },
    async url(key) {
      return blobData.has(key) ? `blob:${key}` : null;
    },
    cachedUrl: () => null,
  };

  const store: FakeStore = {
    updates: 0,
    blobData,
    deletedBlobs,
    ready: Promise.resolve(),
    blobs,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(mutate) {
      store.updates += 1;
      const draft = structuredClone(state);
      mutate(draft);
      const prev = state;
      state = draft;
      for (const l of Array.from(listeners)) l(state, prev);
    },
    addVinyl(vinyl) {
      store.update((d) => {
        d.vinyls.push(structuredClone(vinyl));
      });
      return structuredClone(vinyl);
    },
    async removeVinyl(id) {
      const victim = state.vinyls.find((v) => v.id === id);
      if (!victim) return [];
      const orphans = orphanBlobKeys(victim, state.vinyls);
      store.update((d) => {
        d.vinyls = d.vinyls.filter((v) => v.id !== id);
        if (d.ui.editorVinylId === id) {
          d.ui.editorVinylId = null;
          d.ui.view = 'room';
        }
      });
      for (const k of orphans) await blobs.delete(k);
      return orphans;
    },
    flush: async () => undefined,
  };
  return store;
}

export interface RenderCall {
  kind: string;
  args: unknown[];
  result: HTMLCanvasElement | null;
}

export interface FakeRenderers extends Renderers {
  readonly calls: RenderCall[];
  readonly forgotten: string[];
  readonly invalidated: (string | undefined)[];
  /** Simula que una imagen termina de cargar. */
  fireImageLoad(): void;
}

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Fachada falsa con la misma regla de caché que la real: misma referencia mientras no cambie el vinilo. */
export function createFakeRenderers(): FakeRenderers {
  const calls: RenderCall[] = [];
  const forgotten: string[] = [];
  const invalidated: (string | undefined)[] = [];
  const loadListeners = new Set<() => void>();
  const cache = new Map<string, HTMLCanvasElement | null>();

  const remember = (kind: string, vinyl: Vinyl, args: unknown[], make: () => HTMLCanvasElement | null): HTMLCanvasElement | null => {
    const key = `${kind}|${vinyl.id}|${vinyl.updatedAt}|${JSON.stringify(args)}`;
    let result = cache.get(key);
    if (result === undefined) {
      result = make();
      cache.set(key, result);
    }
    calls.push({ kind, args, result });
    return result;
  };

  const images = {
    get: () => null,
    has: () => false,
    ensure: async () => undefined,
    onLoad(cb: () => void) {
      loadListeners.add(cb);
      return () => loadListeners.delete(cb);
    },
    forget(key: string) {
      forgotten.push(key);
    },
  } as unknown as ImageCache;

  return {
    calls,
    forgotten,
    invalidated,
    images,
    fireImageLoad() {
      cache.clear();
      for (const l of Array.from(loadListeners)) l();
    },
    disc: (v, opts) => remember('disc', v, [opts], () => canvasOf(opts.sizePx, opts.sizePx)) as HTMLCanvasElement,
    jacketFront: (v, s) => remember('jacketFront', v, [s], () => canvasOf(s, s)) as HTMLCanvasElement,
    jacketBack: (v, s) => remember('jacketBack', v, [s], () => canvasOf(s, s)) as HTMLCanvasElement,
    gatefold: (v, s) => remember('gatefold', v, [s], () => canvasOf(2 * s, s)) as HTMLCanvasElement,
    spine: (v, w, h) => remember('spine', v, [w, h], () => canvasOf(w, h)) as HTMLCanvasElement,
    innerSleeve: (v, s, face) => remember('innerSleeve', v, [s, face], () => canvasOf(s, s)) as HTMLCanvasElement,
    outerSleeve: (v, s) => remember('outerSleeve', v, [s], () => (v.outerSleeve.kind === 'none' ? null : canvasOf(s, s))),
    invalidate(id) {
      invalidated.push(id);
    },
  };
}

export function stateWith(vinyls: Vinyl[], ui: Partial<UiState> = {}): AppState {
  const state = initialAppState();
  state.vinyls = vinyls;
  state.ui = { ...state.ui, ...ui };
  return state;
}

export function createDeps(store: FakeStore, renderers: FakeRenderers, importAudio?: EditorDeps['importAudio']): EditorDeps & { closed: number } {
  const deps = {
    store,
    renderers,
    closed: 0,
    importAudio: importAudio ?? (async () => ({ tracks: [], rejected: [] })),
    close() {
      deps.closed += 1;
    },
  };
  return deps;
}

/** Escribe en un campo y lanza `input` (y `change` si se pide). */
export function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string, change = false): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  if (change) el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Elige una opción de un <select> y lanza `change`. */
export function choose(el: HTMLSelectElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Marca o desmarca una casilla y lanza `change`. */
export function setChecked(el: HTMLInputElement, checked: boolean): void {
  el.checked = checked;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Simula elegir archivos en un <input type=file>. */
export function pickFiles(el: HTMLInputElement, files: File[]): void {
  Object.defineProperty(el, 'files', { value: files, configurable: true });
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Deja correr promesas y temporizadores a cero. */
export async function settle(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}

/** Busca un elemento por `data-test` o falla con un mensaje claro. */
export function byTest<E extends HTMLElement = HTMLElement>(root: ParentNode, test: string): E {
  const el = root.querySelector<E>(`[data-test="${test}"]`);
  if (!el) throw new Error(`No hay ningún elemento con data-test="${test}"`);
  return el;
}

/** El control (input, select o textarea) asociado a la etiqueta visible `text`. */
export function byLabel<E extends HTMLElement = HTMLInputElement>(root: ParentNode, text: string): E {
  for (const label of Array.from(root.querySelectorAll('label'))) {
    if (label.textContent?.trim() !== text) continue;
    const target = label.htmlFor ? root.querySelector<E>(`#${label.htmlFor}`) : label.querySelector<E>('input, select, textarea');
    if (target) return target;
  }
  throw new Error(`No hay ningún campo con la etiqueta «${text}»`);
}
