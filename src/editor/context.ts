/**
 * Contexto de edición que comparten la cabecera y las pestañas del editor.
 *
 *  - `editVinyl()` es la ÚNICA vía de escritura: busca el vinilo en el
 *    borrador del store, aplica la mutación, llama a `touch()` y, si la
 *    edición dejó de usar algún blob (imagen o audio sustituido o quitado),
 *    lo borra del almacén cuando ningún vinilo lo usa (`isBlobKeyInUse`) y
 *    lo olvida en la caché de imágenes.
 *  - Los controles se enlazan con un `get` (lee del vinilo) y un `set`
 *    (escribe en el borrador). Cada enlace registra una función de
 *    sincronización en un `SyncScope`; el editor las ejecuta en cada
 *    `update(state)` y los controles no pisan el campo que tiene el foco.
 *  - `dynamic()` crea zonas que se reconstruyen solo cuando cambia su
 *    estructura (número de líneas extra, orden de las canciones, cara
 *    elegida), nunca mientras se escribe en ellas.
 */
import { collectBlobKeys, isBlobKeyInUse } from '../core/blobs';
import { sideOf, touch } from '../core/defaults';
import type { Store } from '../core/store';
import type { Fill, ImageRef, Side, SideId, TextStyle, Track, Vinyl } from '../core/types';
import type { Renderers } from '../render';
import {
  checkboxField,
  colorField,
  fillEditor,
  imageField,
  numberField,
  radioGroup,
  rangeField,
  selectField,
  textAreaField,
  textField,
  textStyleEditor,
  toggleGroup,
  type Child,
  type Control,
  type NumberOptions,
  type Option,
  type RangeOptions,
  type TextOptions,
  appendChildren,
  h,
  setText,
  uniqueId,
} from './controls';

export interface ImportOutcome {
  tracks: Track[];
  rejected: { fileName: string; reason: string }[];
}

/** Lo que el editor necesita de la aplicación (subconjunto estructural de `EditorDeps`). */
export interface EditorServices {
  store: Store;
  renderers: Renderers;
  importAudio(files: File[]): Promise<ImportOutcome>;
}

export interface ImportStatus {
  busy: boolean;
  message: string;
  rejected: { fileName: string; reason: string }[];
}

export type JacketView = 'front' | 'back' | 'inside';

/** Estado de la vista del editor (no se guarda en el store). Se reinicia al cambiar de vinilo. */
export interface EditorLocal {
  /** Cara elegida en galleta, canciones y vista previa del disco. */
  side: SideId;
  jacketView: JacketView;
  sleeveFace: 'front' | 'back';
  /** El usuario cambió el grosor a mano en esta sesión: el peso ya no lo recalcula. */
  thicknessTouched: boolean;
  importStatus: ImportStatus | null;
}

export function createLocal(): EditorLocal {
  return { side: 'A', jacketView: 'front', sleeveFace: 'front', thicknessTouched: false, importStatus: null };
}

export type Getter<T> = (v: Vinyl) => T;
export type Setter<T> = (v: Vinyl, value: T) => void;
export type SyncFn = (v: Vinyl) => void;

/** Lista de funciones de sincronización de una zona del formulario. */
export class SyncScope {
  private fns: SyncFn[] = [];

  add(fn: SyncFn): void {
    this.fns.push(fn);
  }

  run(vinyl: Vinyl): void {
    for (const fn of this.fns) fn(vinyl);
  }

  clear(): void {
    this.fns = [];
  }

  get size(): number {
    return this.fns.length;
  }
}

// ---------------------------------------------------------------------------
// Escritura y blobs
// ---------------------------------------------------------------------------

type BlobServices = Pick<EditorServices, 'store' | 'renderers'>;

/**
 * Borra del almacén las claves que ya no usa ningún vinilo y las olvida en
 * la caché de imágenes. Las que siguen en uso se dejan tal cual.
 *
 * El borrado espera a que se haya guardado el documento que deja de apuntar
 * a esas claves (`store.flush()`) y vuelve a comprobar que siguen sin uso.
 * Al revés, cerrar la pestaña en ese hueco dejaba lo guardado apuntando a un
 * archivo ya borrado. Si el guardado falla, no se borra nada.
 */
export function releaseBlobs(services: BlobServices, keys: readonly string[]): string[] {
  const { store } = services;
  const released: string[] = [];
  for (const key of new Set(keys)) {
    if (isBlobKeyInUse(key, store.getState().vinyls)) continue;
    released.push(key);
    services.renderers.images.forget(key);
  }
  if (released.length === 0) return released;
  store.flush().then(
    async () => {
      for (const key of released) {
        if (isBlobKeyInUse(key, store.getState().vinyls)) continue;
        await store.blobs.delete(key).catch((err: unknown) => {
          console.error('Tocadiscos: no se pudo borrar un archivo que ya no se usa.', err);
        });
      }
    },
    (err: unknown) => {
      console.error('Tocadiscos: no se borran los archivos sustituidos porque no se pudo guardar la colección.', err);
    },
  );
  return released;
}

/**
 * Aplica una edición al vinilo `vinylId` (con `touch`) y libera los blobs
 * que la edición dejó de usar. Devuelve false si el vinilo ya no existe.
 */
export function editVinyl(services: BlobServices, vinylId: string, mutate: (v: Vinyl) => void): boolean {
  const { store } = services;
  if (!store.getState().vinyls.some((v) => v.id === vinylId)) return false;
  let dropped: string[] = [];
  let applied = false as boolean;
  store.update((draft) => {
    const v = draft.vinyls.find((x) => x.id === vinylId);
    if (!v) return;
    const before = collectBlobKeys(v);
    mutate(v);
    touch(v);
    const after = new Set(collectBlobKeys(v));
    dropped = before.filter((k) => !after.has(k));
    applied = true;
  });
  if (dropped.length) releaseBlobs(services, dropped);
  return applied;
}

/** Ancho y alto de una imagen, o null si el navegador no puede leerla. */
export async function readImageSize(file: Blob, timeoutMs = 4000): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      if (size.width > 0 && size.height > 0) return size;
    } catch {
      // Algunos formatos solo los decodifica <img>: se intenta a continuación.
    }
  }
  return readSizeWithImage(file, timeoutMs);
}

function readSizeWithImage(file: Blob, timeoutMs: number): Promise<{ width: number; height: number } | null> {
  if (typeof URL.createObjectURL !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = (size: { width: number; height: number } | null): void => {
      if (timer !== null) clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      URL.revokeObjectURL(url);
      resolve(size);
    };
    timer = setTimeout(() => done(null), timeoutMs);
    img.onload = () => done(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => done(null);
    img.src = url;
  });
}

/** Guarda una imagen en el almacén de blobs y devuelve su referencia (con medidas si se pueden leer). */
export async function storeImage(services: BlobServices, file: File): Promise<ImageRef> {
  const size = await readImageSize(file);
  const blobKey = await services.store.blobs.put(file);
  const ref: ImageRef = { blobKey, name: file.name };
  if (size) {
    ref.width = size.width;
    ref.height = size.height;
  }
  return ref;
}

function keysOfFill(fill: Fill | null): string[] {
  return fill?.kind === 'image' ? [fill.image.blobKey] : [];
}

// ---------------------------------------------------------------------------
// Contexto de una zona del formulario
// ---------------------------------------------------------------------------

/** Lo que comparte todo el formulario de un vinilo. */
export interface EditorSession {
  readonly services: EditorServices;
  readonly vinylId: string;
  readonly local: EditorLocal;
  /** Vuelve a sincronizar controles y vista previa (tras cambiar un estado local, p. ej. la cara). */
  resync(): void;
}

export interface FillExtra {
  noneLabel?: string;
  defaultColor?: string;
  dataTest?: string;
}

export interface RangeExtra extends Omit<RangeOptions, 'label' | 'onChange'> {
  /** Máximo que depende del vinilo (se actualiza en cada sincronización). */
  maxOf?: Getter<number>;
}

export class EditorContext {
  constructor(
    readonly session: EditorSession,
    private readonly scope: SyncScope,
  ) {}

  get local(): EditorLocal {
    return this.session.local;
  }

  /** La cara elegida (galleta, canciones, vista previa). */
  side(v: Vinyl): Side {
    return sideOf(v, this.session.local.side);
  }

  edit(mutate: (v: Vinyl) => void): boolean {
    return editVinyl(this.session.services, this.session.vinylId, mutate);
  }

  releaseBlobs(keys: readonly string[]): void {
    releaseBlobs(this.session.services, keys);
  }

  uploadImage = (file: File): Promise<ImageRef> => storeImage(this.session.services, file);

  /** Aplica una edición que introduce blobs nuevos; si el vinilo ya no existe, los borra. */
  editWithBlobs(newKeys: readonly string[], mutate: (v: Vinyl) => void): boolean {
    const applied = this.edit(mutate);
    if (!applied && newKeys.length) this.releaseBlobs(newKeys);
    return applied;
  }

  onSync(fn: SyncFn): void {
    this.scope.add(fn);
  }

  /** Muestra u oculta `el` según el vinilo. Devuelve `el` para encadenar. */
  showIf<E extends HTMLElement>(el: E, visible: Getter<boolean>): E {
    this.onSync((v) => {
      const hidden = !visible(v);
      if (el.hidden !== hidden) el.hidden = hidden;
    });
    return el;
  }

  /** Lectura de solo lectura con etiqueta (duración, densidad, reproducciones…). */
  readout(label: string, value: Getter<string>): HTMLElement {
    const out = h('output', 'ed-readout__value');
    const name = h('span', 'ed-readout__label', [label]);
    name.id = uniqueId('ed-lectura');
    out.setAttribute('aria-labelledby', name.id);
    this.onSync((v) => setText(out, value(v)));
    return h('div', 'ed-readout', [name, out]);
  }

  /**
   * Zona que se reconstruye cuando cambia `keyOf(v)`. Sus controles se
   * sincronizan en cada pasada; si el foco estaba en un elemento con
   * `data-focus-key`, se devuelve al elemento equivalente reconstruido.
   */
  dynamic(keyOf: Getter<string>, build: (ctx: EditorContext, v: Vinyl) => readonly Child[], className = 'ed-dynamic'): HTMLElement {
    const box = h('div', className);
    const inner = new SyncScope();
    const child = new EditorContext(this.session, inner);
    let key: string | null = null;
    this.onSync((v) => {
      const next = keyOf(v);
      if (next !== key) {
        key = next;
        const focusKey = focusedKeyWithin(box);
        inner.clear();
        box.replaceChildren();
        appendChildren(box, build(child, v));
        inner.run(v);
        if (focusKey) restoreFocus(box, focusKey);
        return;
      }
      inner.run(v);
    });
    return box;
  }

  // --- Controles enlazados -------------------------------------------------

  /** Enlaza un control ya construido (su `onChange` escribe por su cuenta) para que refleje `get(v)`. */
  bind<T>(control: Control<T>, get: Getter<T>): HTMLElement {
    this.onSync((v) => control.set(get(v)));
    return control.el;
  }

  text(label: string, get: Getter<string>, set: Setter<string>, extra: Omit<TextOptions, 'label' | 'onChange'> = {}): HTMLElement {
    return this.bind(textField({ ...extra, label, onChange: (x) => this.edit((v) => set(v, x)) }), get);
  }

  textarea(
    label: string,
    get: Getter<string>,
    set: Setter<string>,
    extra: Omit<TextOptions, 'label' | 'onChange'> & { rows?: number } = {},
  ): HTMLElement {
    return this.bind(textAreaField({ ...extra, label, onChange: (x) => this.edit((v) => set(v, x)) }), get);
  }

  number(label: string, get: Getter<number>, set: Setter<number>, extra: Omit<NumberOptions, 'label' | 'onChange'>): HTMLElement {
    return this.bind(numberField({ ...extra, label, onChange: (x) => this.edit((v) => set(v, x)) }), get);
  }

  range(label: string, get: Getter<number>, set: Setter<number>, extra: RangeExtra): HTMLElement {
    const { maxOf, ...opts } = extra;
    const control = rangeField({ ...opts, label, onChange: (x) => this.edit((v) => set(v, x)) });
    if (maxOf) this.onSync((v) => control.setMax(maxOf(v)));
    return this.bind(control, get);
  }

  color(label: string, get: Getter<string>, set: Setter<string>, dataTest?: string): HTMLElement {
    return this.bind(colorField({ label, onChange: (x) => this.edit((v) => set(v, x)), ...(dataTest ? { dataTest } : {}) }), get);
  }

  select<T extends string | number>(
    label: string,
    options: readonly Option<T>[],
    get: Getter<T>,
    set: Setter<T>,
    extra: { dataTest?: string; hint?: string } = {},
  ): HTMLElement {
    return this.bind(selectField<T>({ ...extra, label, options, onChange: (x) => this.edit((v) => set(v, x)) }), get);
  }

  radios<T extends string | number>(
    legend: string,
    options: readonly Option<T>[],
    get: Getter<T>,
    set: Setter<T>,
    extra: { dataTest?: string; hint?: string } = {},
  ): HTMLElement {
    return this.bind(radioGroup<T>({ ...extra, label: legend, options, onChange: (x) => this.edit((v) => set(v, x)) }), get);
  }

  checkbox(label: string, get: Getter<boolean>, set: Setter<boolean>, extra: { dataTest?: string; hint?: string } = {}): HTMLElement {
    return this.bind(checkboxField({ ...extra, label, onChange: (x) => this.edit((v) => set(v, x)) }), get);
  }

  /** Relleno obligatorio (fondo de galleta, portada, contraportada). */
  fill(legend: string, get: Getter<Fill>, set: Setter<Fill>, extra: FillExtra = {}): HTMLElement {
    const control = fillEditor({
      ...extra,
      legend,
      upload: this.uploadImage,
      onChange: (fill) => {
        if (fill) this.editWithBlobs(keysOfFill(fill), (v) => set(v, fill));
      },
    });
    return this.bind<Fill | null>(control, get);
  }

  /** Relleno opcional (impresiones, interiores, obra a cara completa): admite "ninguno". */
  optionalFill(legend: string, get: Getter<Fill | null>, set: Setter<Fill | null>, extra: FillExtra = {}): HTMLElement {
    const control = fillEditor({
      ...extra,
      legend,
      nullable: true,
      upload: this.uploadImage,
      onChange: (fill) => this.editWithBlobs(keysOfFill(fill), (v) => set(v, fill)),
    });
    return this.bind(control, get);
  }

  textStyle(legend: string, get: Getter<TextStyle>, set: Setter<TextStyle>, dataTest?: string): HTMLElement {
    const control = textStyleEditor({
      legend,
      onChange: (style) => this.edit((v) => set(v, { ...style })),
      ...(dataTest ? { dataTest } : {}),
    });
    return this.bind(control, get);
  }

  image(label: string, get: Getter<ImageRef | null>, set: Setter<ImageRef | null>, dataTest?: string): HTMLElement {
    const control = imageField({
      label,
      upload: this.uploadImage,
      onChange: (ref) => this.editWithBlobs(ref ? [ref.blobKey] : [], (v) => set(v, ref)),
      ...(dataTest ? { dataTest } : {}),
    });
    return this.bind(control, get);
  }

  /** Conmutador "Cara A / Cara B" ligado a la cara elegida (estado local, no del vinilo). */
  sideSwitch(label = 'Cara que editas', dataTest = 'editor-cara'): HTMLElement {
    const control = toggleGroup<SideId>({
      label,
      options: [
        { value: 'A', label: 'Cara A' },
        { value: 'B', label: 'Cara B' },
      ],
      dataTest,
      onSelect: (side) => {
        if (this.local.side === side) return;
        this.local.side = side;
        this.session.resync();
      },
    });
    this.onSync(() => control.set(this.local.side));
    return control.el;
  }
}

function focusedKeyWithin(box: HTMLElement): string | null {
  const active = box.ownerDocument.activeElement;
  if (!(active instanceof HTMLElement) || !box.contains(active)) return null;
  return active.dataset.focusKey ?? null;
}

/**
 * Devuelve el foco al elemento reconstruido con la misma clave. Las claves
 * son "grupo:acción"; si ese elemento está desactivado (p. ej. "Subir" en la
 * primera canción), se enfoca otro activo del mismo grupo.
 */
function restoreFocus(box: HTMLElement, key: string): void {
  const candidates = Array.from(box.querySelectorAll<HTMLElement>('[data-focus-key]')).filter(
    (el) => !(el instanceof HTMLButtonElement && el.disabled),
  );
  const group = key.includes(':') ? key.slice(0, key.indexOf(':') + 1) : null;
  const target =
    candidates.find((el) => el.dataset.focusKey === key) ??
    (group ? candidates.find((el) => el.dataset.focusKey?.startsWith(group)) : undefined);
  target?.focus();
}
