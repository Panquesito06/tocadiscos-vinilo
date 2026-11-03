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
 */
import type { AppState, Vinyl } from './types';

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

export function createStore(_options: StoreOptions = {}): Store {
  throw new Error('createStore: no implementado todavía');
}
