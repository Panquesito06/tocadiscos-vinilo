/**
 * Almacén de estado con persistencia en IndexedDB.
 *
 * CONTRATO (lo implementa el módulo de persistencia):
 *  - `getState()` devuelve siempre el mismo objeto hasta la siguiente
 *    mutación; cada `update()` produce un objeto nuevo (inmutabilidad por
 *    copia: `structuredClone` del estado, mutación del borrador, sustitución).
 *  - `update()` notifica a los suscriptores de forma síncrona (una
 *    excepción en un listener no impide notificar al resto) y persiste con
 *    retardo (debounce ~300 ms, con un tope de espera de 2 s: si hay updates
 *    continuos se escribe igualmente cada 2 s) `vinyls`, `turntable` y
 *    `settings`. `ui` no se persiste.
 *  - Documento persistido con versión: `kv.schemaVersion = SCHEMA_VERSION`.
 *    Al leer, si la versión guardada es menor se aplican las migraciones
 *    (lista vacía en la v1) y SIEMPRE se normaliza: cada vinilo pasa por
 *    `normalizeVinyl`, `turntable` se mezcla sobre `defaultTurntableState()`
 *    y `settings` sobre `defaultSettings()` (`mergeWithDefaults`). Si
 *    `turntable.loaded` apunta a un vinilo inexistente, se pone a null.
 *  - `ready` se resuelve cuando el estado inicial se ha leído de IndexedDB.
 *  - `addVinyl()` ignora el `shelfIndex` recibido, asigna el siguiente
 *    (máximo + 1, o 0) y devuelve la copia almacenada. `removeVinyl()` quita
 *    el vinilo, lo quita del plato y de la mano/editor en `ui`, renumera
 *    `shelfIndex` 0..n−1 por orden actual, borra los blobs que ningún otro
 *    vinilo usa (`orphanBlobKeys` de core/blobs.ts) y devuelve las claves
 *    borradas (para que la app vacíe las cachés).
 *  - `blobs` guarda imágenes y audio como `Blob` bajo una clave; `url()`
 *    devuelve una URL de objeto creada una sola vez por clave (cacheada);
 *    `delete()` la revoca.
 *
 * Detalles de la implementación:
 *  - Las notificaciones se entregan en orden: si un suscriptor llama a
 *    `update()` durante una notificación, el estado cambia al instante pero
 *    la transición se notifica cuando termina la que está en curso, así
 *    todos los suscriptores ven todas las transiciones y en el mismo orden.
 *  - Las escrituras van en cadena: nunca hay dos transacciones de escritura
 *    solapadas; un `flush()` durante una escritura se ejecuta a continuación.
 *  - `ready` se rechaza si IndexedDB no se puede abrir (el error dice qué
 *    pasó); `update()` antes de `ready` se sobreescribe con lo cargado.
 */
import { collectBlobKeys, orphanBlobKeys } from './blobs';
import {
  defaultSettings,
  defaultTurntableState,
  defaultUiState,
  findVinyl,
  initialAppState,
  mergeWithDefaults,
  normalizeVinyl,
} from './defaults';
import {
  createObjectUrl,
  DbConnection,
  DEFAULT_DB_NAME,
  deleteBlobs,
  getBlob,
  listBlobKeys,
  migrateDocument,
  putBlob,
  readDocument,
  revokeObjectUrl,
  writeDocument,
  writeSchemaVersion,
  type DocumentSnapshot,
  type RawDocument,
} from './db';
import { newId } from './ids';
import { SCHEMA_VERSION, type AppState, type Rpm, type TurntableState, type Vinyl } from './types';

export interface BlobStore {
  put(blob: Blob, key?: string): Promise<string>;
  get(key: string): Promise<Blob | null>;
  delete(key: string): Promise<void>;
  url(key: string): Promise<string | null>;
  /** URL de objeto ya cargada en memoria (sin esperar), o null si aún no se pidió. */
  cachedUrl(key: string): string | null;
}

export type StoreListener = (state: AppState, prev: AppState) => void;

export interface Store {
  readonly ready: Promise<void>;
  readonly blobs: BlobStore;
  getState(): AppState;
  subscribe(listener: StoreListener): () => void;
  update(mutate: (draft: AppState) => void): void;
  /** Añade un vinilo al final de la estantería y devuelve la copia almacenada. */
  addVinyl(vinyl: Vinyl): Vinyl;
  /** Elimina el vinilo y sus blobs huérfanos; devuelve las claves de blob borradas. */
  removeVinyl(id: string): Promise<string[]>;
  /** Fuerza la escritura pendiente (p. ej. antes de cerrar). */
  flush(): Promise<void>;
}

export interface StoreOptions {
  dbName?: string;
  /** Retardo de persistencia en ms (0 en tests). */
  debounceMs?: number;
}

/** Retardo por defecto entre el último `update()` y la escritura. */
export const DEFAULT_DEBOUNCE_MS = 300;

/** Tope de espera: con updates continuos se escribe igualmente cada 2 s. */
export const MAX_WRITE_WAIT_MS = 2000;

const RPM_VALUES: readonly Rpm[] = [33, 45, 78];

export function createStore(options: StoreOptions = {}): Store {
  const debounceMs = Math.max(0, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  const connection = new DbConnection(options.dbName ?? DEFAULT_DB_NAME);
  const listeners = new Set<StoreListener>();
  let state: AppState = initialAppState();

  // --- Estado y notificaciones -------------------------------------------

  const transitions: Array<[next: AppState, prev: AppState]> = [];
  let notifying = false;

  function setState(next: AppState): void {
    const prev = state;
    state = next;
    transitions.push([next, prev]);
    if (notifying) return;
    notifying = true;
    try {
      for (let t = transitions.shift(); t; t = transitions.shift()) notify(t[0], t[1]);
    } finally {
      notifying = false;
    }
  }

  function notify(next: AppState, prev: AppState): void {
    for (const listener of Array.from(listeners)) {
      try {
        listener(next, prev);
      } catch (err) {
        console.error('Tocadiscos: un suscriptor del estado ha fallado.', err);
      }
    }
  }

  function update(mutate: (draft: AppState) => void): void {
    const draft = structuredClone(state);
    mutate(draft);
    setState(draft);
    schedulePersist();
  }

  // --- Persistencia con debounce y tope de espera -----------------------

  let dirty = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  /** Cadena de escrituras: cada una empieza cuando termina la anterior. */
  let chain: Promise<void> = Promise.resolve();

  function schedulePersist(): void {
    dirty = true;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(persistFromTimer, debounceMs);
    if (maxWaitTimer === null) maxWaitTimer = setTimeout(persistFromTimer, MAX_WRITE_WAIT_MS);
  }

  function clearTimers(): void {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    if (maxWaitTimer !== null) clearTimeout(maxWaitTimer);
    debounceTimer = null;
    maxWaitTimer = null;
  }

  function persistFromTimer(): void {
    // El error ya se ha registrado en consola; aquí no hay nadie que lo espere.
    void persistNow().catch(() => undefined);
  }

  /** Escribe el estado actual en cuanto termine la escritura en curso, si la hay. */
  function persistNow(): Promise<void> {
    clearTimers();
    const run = chain.then(async () => {
      if (!dirty) return;
      dirty = false;
      const snapshot = snapshotOf(state);
      try {
        await writeDocument(await connection.get(), snapshot);
      } catch (err) {
        dirty = true;
        console.error('Tocadiscos: no se pudo guardar la colección en el navegador.', err);
        throw err;
      }
    });
    chain = run.catch(() => undefined);
    return run;
  }

  // --- Carga inicial ----------------------------------------------------

  async function load(): Promise<void> {
    let raw: RawDocument;
    try {
      raw = await readDocument(await connection.get());
    } catch (err) {
      throw new Error(
        'No se pudo abrir el almacén local (IndexedDB). Comprueba que el navegador permite guardar datos de este sitio.',
        { cause: err },
      );
    }
    const storedVersion = raw.schemaVersion ?? 0;
    if (storedVersion > SCHEMA_VERSION) {
      console.warn(
        `Tocadiscos: la colección se guardó con una versión más nueva (${storedVersion} > ${SCHEMA_VERSION}); se cargará lo que se entienda.`,
      );
    }
    const doc = storedVersion < SCHEMA_VERSION ? migrateDocument(raw, storedVersion) : raw;
    const loaded = buildState(doc);
    setState(loaded);
    // El estado ya está leído: un fallo al escribir la versión no impide arrancar.
    try {
      const db = await connection.get();
      if (storedVersion === SCHEMA_VERSION) await writeSchemaVersion(db, SCHEMA_VERSION);
      else await writeDocument(db, snapshotOf(loaded), SCHEMA_VERSION);
    } catch (err) {
      console.error('Tocadiscos: no se pudo actualizar la versión de la colección guardada.', err);
    }
    await pruneOrphanBlobs(loaded);
  }

  /**
   * Borra los blobs que ningún vinilo usa. Aparecen si se cierra la pestaña a
   * mitad de una siembra o de una importación (los archivos se guardan antes
   * que el vinilo que los usa). Solo se hace al cargar, cuando todavía no hay
   * ninguna importación en curso. Un fallo aquí no impide arrancar.
   */
  async function pruneOrphanBlobs(loaded: AppState): Promise<void> {
    try {
      const db = await connection.get();
      const used = new Set(loaded.vinyls.flatMap((v) => collectBlobKeys(v)));
      const orphans = (await listBlobKeys(db)).filter((k) => !used.has(k));
      if (orphans.length > 0) await deleteBlobs(db, orphans);
    } catch (err) {
      console.error('Tocadiscos: no se pudieron limpiar los archivos que ya no usa ningún vinilo.', err);
    }
  }

  const ready = load();
  // Ninguna escritura empieza antes de haber cargado (si la carga falla, se intenta igualmente).
  chain = ready.catch(() => undefined);

  // --- Vinilos ----------------------------------------------------------

  function addVinyl(vinyl: Vinyl): Vinyl {
    if (findVinyl(state, vinyl.id)) throw new Error(`Ya hay un vinilo con el id ${vinyl.id}.`);
    const stored = structuredClone(vinyl);
    stored.shelfIndex = nextShelfIndex(state.vinyls);
    update((draft) => {
      draft.vinyls.push(stored);
    });
    return structuredClone(stored);
  }

  async function removeVinyl(id: string): Promise<string[]> {
    const victim = findVinyl(state, id);
    if (!victim) return [];
    const orphans = orphanBlobKeys(victim, state.vinyls);
    update((draft) => {
      draft.vinyls = renumbered(draft.vinyls.filter((v) => v.id !== id));
      if (draft.turntable.loaded?.vinylId === id) draft.turntable.loaded = null;
      if (draft.ui.handVinylId === id) {
        draft.ui.handVinylId = null;
        if (draft.ui.view === 'hand') draft.ui.view = 'room';
      }
      if (draft.ui.editorVinylId === id) {
        draft.ui.editorVinylId = null;
        if (draft.ui.view === 'editor') draft.ui.view = 'room';
      }
    });
    // Primero el estado y después los blobs: si algo falla a medias, como
    // mucho queda un blob huérfano, nunca un vinilo sin sus imágenes.
    await persistNow();
    for (const key of orphans) dropUrl(key);
    await deleteBlobs(await connection.get(), orphans);
    return orphans;
  }

  // --- Blobs y URL de objeto -------------------------------------------

  const urls = new Map<string, string>();
  const pendingUrls = new Map<string, Promise<string | null>>();
  /** Sube cada vez que una clave se borra o se sustituye: invalida las lecturas en curso. */
  const urlEpochs = new Map<string, number>();

  const epochOf = (key: string): number => urlEpochs.get(key) ?? 0;

  /** Olvida (y revoca) la URL cacheada de una clave y descarta su creación en curso. */
  function dropUrl(key: string): void {
    const url = urls.get(key);
    if (url !== undefined) {
      urls.delete(key);
      revokeObjectUrl(url);
    }
    pendingUrls.delete(key);
    urlEpochs.set(key, epochOf(key) + 1);
  }

  function urlFor(key: string): Promise<string | null> {
    const cached = urls.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    let pending = pendingUrls.get(key);
    if (!pending) {
      pending = createUrl(key);
      pendingUrls.set(key, pending);
    }
    return pending;
  }

  /** Lee el blob y crea su URL de objeto, salvo que la clave se borre o sustituya mientras tanto. */
  async function createUrl(key: string): Promise<string | null> {
    const epoch = epochOf(key);
    try {
      const blob = await getBlob(await connection.get(), key);
      if (!blob || epochOf(key) !== epoch) return null;
      const url = createObjectUrl(blob, key);
      urls.set(key, url);
      return url;
    } finally {
      if (epochOf(key) === epoch) pendingUrls.delete(key);
    }
  }

  const blobs: BlobStore = {
    async put(blob, key = newId('blob')) {
      await putBlob(await connection.get(), key, blob);
      // Si sustituye un blob existente, la URL anterior apuntaba a los datos viejos.
      dropUrl(key);
      return key;
    },
    async get(key) {
      return getBlob(await connection.get(), key);
    },
    async delete(key) {
      dropUrl(key);
      await deleteBlobs(await connection.get(), [key]);
    },
    url: urlFor,
    cachedUrl(key) {
      return urls.get(key) ?? null;
    },
  };

  return {
    ready,
    blobs,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update,
    addVinyl,
    removeVinyl,
    flush: () => persistNow(),
  };
}

// ---------------------------------------------------------------------------
// Utilidades puras
// ---------------------------------------------------------------------------

function snapshotOf(state: AppState): DocumentSnapshot {
  return { vinyls: state.vinyls, turntable: state.turntable, settings: state.settings };
}

/** Siguiente posición libre en la estantería: máximo actual + 1, o 0 si está vacía. */
export function nextShelfIndex(vinyls: readonly Vinyl[]): number {
  let max = -1;
  for (const v of vinyls) if (v.shelfIndex > max) max = v.shelfIndex;
  return max + 1;
}

/** Orden de la estantería: por `shelfIndex` y, a igualdad, por fecha de creación. */
export function sortedByShelf(vinyls: readonly Vinyl[]): Vinyl[] {
  return [...vinyls].sort((a, b) => a.shelfIndex - b.shelfIndex || a.createdAt - b.createdAt);
}

/** Los vinilos en orden de estantería con `shelfIndex` renumerado 0..n−1. */
function renumbered(vinyls: readonly Vinyl[]): Vinyl[] {
  const sorted = sortedByShelf(vinyls);
  sorted.forEach((v, i) => {
    v.shelfIndex = i;
  });
  return sorted;
}

/**
 * Construye el estado de la aplicación a partir del documento guardado:
 * normaliza cada parte con sus valores por defecto, ordena la estantería,
 * descarta un disco cargado que ya no existe y parte de una `ui` limpia.
 */
export function buildState(doc: RawDocument): AppState {
  const vinyls = renumbered(doc.vinyls.map((raw) => normalizeVinyl(raw)));
  const turntable = sanitizeTurntable(mergeWithDefaults(defaultTurntableState(), doc.turntable ?? undefined), vinyls);
  const settings = mergeWithDefaults(defaultSettings(), doc.settings ?? undefined);
  return { vinyls, turntable, ui: defaultUiState(), settings };
}

/** Deja el estado del tocadiscos dentro de sus rangos y sin referencias a vinilos inexistentes. */
function sanitizeTurntable(turntable: TurntableState, vinyls: readonly Vinyl[]): TurntableState {
  const loaded = turntable.loaded;
  const loadedOk =
    loaded !== null &&
    typeof loaded === 'object' &&
    typeof loaded.vinylId === 'string' &&
    (loaded.side === 'A' || loaded.side === 'B') &&
    vinyls.some((v) => v.id === loaded.vinylId);
  turntable.loaded = loadedOk ? { vinylId: loaded.vinylId, side: loaded.side } : null;
  if (!RPM_VALUES.includes(turntable.speed)) turntable.speed = 33;
  turntable.pitchPercent = clamp(turntable.pitchPercent, -8, 8, 0);
  turntable.volume = clamp(turntable.volume, 0, 1, 0.85);
  return turntable;
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
