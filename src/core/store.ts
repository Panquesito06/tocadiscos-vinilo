/**
 * Almacén de estado con persistencia en IndexedDB.
 *
 * CONTRATO (lo implementa el módulo de persistencia):
 *  - `getState()` devuelve siempre el mismo objeto hasta la siguiente
 *    mutación; cada `update()` produce un objeto nuevo (inmutabilidad por
 *    copia: `structuredClone` del estado, mutación del borrador, sustitución).
 *  - `update()` notifica a los suscriptores de forma síncrona y persiste con
 *    retardo (debounce ~300 ms) `vinyls`, `turntable` y `settings`. `ui` no se
 *    persiste.
 *  - `ready` se resuelve cuando el estado inicial se ha leído de IndexedDB.
 *  - `blobs` guarda imágenes y audio como `Blob` bajo una clave; `url()`
 *    devuelve una URL de objeto cacheada (una por clave) para usar en <img>.
 *  - `removeVinyl()` borra el vinilo y todos los blobs que solo él usa.
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
  /** Añade un vinilo al final de la estantería y lo devuelve. */
  addVinyl(vinyl: Vinyl): Vinyl;
  removeVinyl(id: string): Promise<void>;
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
