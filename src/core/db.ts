/**
 * Capa de acceso a IndexedDB del tocadiscos (mediante la librería `idb`).
 *
 * Aquí vive todo lo que sabe CÓMO se guarda la colección; `store.ts` decide
 * CUÁNDO. Este módulo no conoce el estado de la aplicación ni la interfaz.
 *
 *  - Base de datos "tocadiscos" (el nombre es configurable), versión 1, con
 *    tres almacenes: `vinyls` (keyPath `id`), `kv` (clave → `turntable`,
 *    `settings`, `schemaVersion`) y `blobs` (clave → `Blob`).
 *  - `readDocument` y `writeDocument` leen y escriben el documento completo
 *    en una sola transacción. Al escribir se borran los vinilos que ya no
 *    están en el estado.
 *  - `MIGRATIONS` transforma un documento guardado con una versión de
 *    esquema anterior (vacía en la v1; cada entrada lleva el documento de
 *    `version − 1` a `version`). La normalización con valores por defecto
 *    la hace el store después, siempre.
 *  - Blobs: lectura, escritura y borrado, más la creación de URL de objeto
 *    con un respaldo para entornos sin `URL.createObjectURL`.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { SCHEMA_VERSION, type Settings, type TurntableState, type Vinyl } from './types';

export const DEFAULT_DB_NAME = 'tocadiscos';

/**
 * Versión de la BASE DE DATOS (estructura de almacenes e índices). No es la
 * versión del documento (`SCHEMA_VERSION`): cambiar la forma de un vinilo
 * no obliga a cambiar los almacenes.
 */
export const DB_VERSION = 1;

export type KvKey = 'turntable' | 'settings' | 'schemaVersion';

interface TocadiscosSchema extends DBSchema {
  /** Los vinilos se guardan tal cual; al leer son `unknown` hasta normalizarlos. */
  vinyls: { key: string; value: unknown };
  kv: { key: KvKey; value: unknown };
  blobs: { key: string; value: Blob };
}

export type TocadiscosDb = IDBPDatabase<TocadiscosSchema>;

/** Documento tal como está guardado, antes de migrar y normalizar. */
export interface RawDocument {
  vinyls: unknown[];
  turntable: unknown;
  settings: unknown;
  /** Versión del esquema con la que se escribió; null si nunca se escribió. */
  schemaVersion: number | null;
}

/** Lo que el store escribe: datos ya con la forma actual. */
export interface DocumentSnapshot {
  vinyls: Vinyl[];
  turntable: TurntableState;
  settings: Settings;
}

// ---------------------------------------------------------------------------
// Migraciones
// ---------------------------------------------------------------------------

export interface Migration {
  /** Versión que produce: recibe un documento de `version − 1`. */
  version: number;
  /** Descripción breve para los mensajes de consola. */
  description: string;
  migrate(doc: RawDocument): RawDocument;
}

/**
 * Migraciones del documento, en orden ascendente de versión. Vacía en la v1.
 * Cuando `SCHEMA_VERSION` suba a N, se añade aquí la entrada `version: N`.
 */
export const MIGRATIONS: readonly Migration[] = [];

/** Aplica, en orden, las migraciones posteriores a `fromVersion` hasta `SCHEMA_VERSION`. */
export function migrateDocument(doc: RawDocument, fromVersion: number): RawDocument {
  const pending = MIGRATIONS.filter((m) => m.version > fromVersion && m.version <= SCHEMA_VERSION).sort(
    (a, b) => a.version - b.version,
  );
  let out = doc;
  for (const migration of pending) {
    console.info(`Tocadiscos: migrando la colección a la versión ${migration.version} (${migration.description}).`);
    out = migration.migrate(out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Apertura y conexión
// ---------------------------------------------------------------------------

export interface OpenCallbacks {
  /** El navegador cerró la conexión por su cuenta (p. ej. al borrar los datos del sitio). */
  terminated?(): void;
  /** Otra pestaña quiere abrir una versión más nueva: hay que cerrar esta conexión. */
  blocking?(): void;
}

/** Abre (y crea, si hace falta) la base de datos con sus tres almacenes. */
export function openTocadiscosDb(name = DEFAULT_DB_NAME, callbacks: OpenCallbacks = {}): Promise<TocadiscosDb> {
  return openDB<TocadiscosSchema>(name, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('vinyls')) db.createObjectStore('vinyls', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    },
    blocked() {
      console.warn('Tocadiscos: otra pestaña mantiene abierta una versión antigua del almacén; ciérrala para continuar.');
    },
    blocking: callbacks.blocking,
    terminated: callbacks.terminated,
  });
}

/**
 * Conexión perezosa: se abre en el primer uso y se vuelve a abrir si el
 * navegador la cierra o si hay que cederla a una pestaña con una versión
 * más nueva. Un fallo al abrir no queda cacheado: la siguiente operación
 * lo vuelve a intentar.
 */
export class DbConnection {
  private opening: Promise<TocadiscosDb> | null = null;

  constructor(readonly name: string = DEFAULT_DB_NAME) {}

  get(): Promise<TocadiscosDb> {
    if (!this.opening) this.opening = this.open();
    return this.opening;
  }

  private open(): Promise<TocadiscosDb> {
    const opening = openTocadiscosDb(this.name, {
      terminated: () => this.forget(opening),
      blocking: () => {
        this.forget(opening);
        void opening.then((db) => db.close());
      },
    });
    opening.catch(() => this.forget(opening));
    return opening;
  }

  private forget(opening: Promise<TocadiscosDb>): void {
    if (this.opening === opening) this.opening = null;
  }
}

// ---------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------

/** Lee vinilos, tocadiscos, ajustes y versión del esquema en una transacción. */
export async function readDocument(db: TocadiscosDb): Promise<RawDocument> {
  const tx = db.transaction(['vinyls', 'kv'], 'readonly');
  const kv = tx.objectStore('kv');
  const [vinyls, turntable, settings, schemaVersion] = await Promise.all([
    tx.objectStore('vinyls').getAll(),
    kv.get('turntable'),
    kv.get('settings'),
    kv.get('schemaVersion'),
    tx.done,
  ]);
  return {
    vinyls,
    turntable,
    settings,
    schemaVersion: typeof schemaVersion === 'number' && Number.isFinite(schemaVersion) ? schemaVersion : null,
  };
}

/**
 * Escribe el documento completo en una transacción: pone todos los vinilos,
 * borra los que ya no están, y guarda tocadiscos y ajustes en `kv`. Con
 * `schemaVersion` también actualiza la versión guardada.
 */
export async function writeDocument(db: TocadiscosDb, snapshot: DocumentSnapshot, schemaVersion?: number): Promise<void> {
  const tx = db.transaction(['vinyls', 'kv'], 'readwrite');
  const vinyls = tx.objectStore('vinyls');
  const kv = tx.objectStore('kv');
  const keep = new Set(snapshot.vinyls.map((v) => v.id));
  const stored = await vinyls.getAllKeys();
  const ops: Promise<unknown>[] = [];
  for (const key of stored) if (!keep.has(key)) ops.push(vinyls.delete(key));
  for (const vinyl of snapshot.vinyls) ops.push(vinyls.put(vinyl));
  ops.push(kv.put(snapshot.turntable, 'turntable'), kv.put(snapshot.settings, 'settings'));
  if (schemaVersion !== undefined) ops.push(kv.put(schemaVersion, 'schemaVersion'));
  await Promise.all([...ops, tx.done]);
}

/** Guarda solo la versión del esquema. */
export async function writeSchemaVersion(db: TocadiscosDb, schemaVersion: number): Promise<void> {
  await db.put('kv', schemaVersion, 'schemaVersion');
}

// ---------------------------------------------------------------------------
// Blobs
// ---------------------------------------------------------------------------

export async function getBlob(db: TocadiscosDb, key: string): Promise<Blob | null> {
  return (await db.get('blobs', key)) ?? null;
}

export async function putBlob(db: TocadiscosDb, key: string, blob: Blob): Promise<void> {
  await db.put('blobs', blob, key);
}

/** Todas las claves del almacén de blobs. */
export async function listBlobKeys(db: TocadiscosDb): Promise<string[]> {
  return (await db.getAllKeys('blobs')).map(String);
}

/** Borra varias claves en una sola transacción (las inexistentes se ignoran). */
export async function deleteBlobs(db: TocadiscosDb, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  const tx = db.transaction('blobs', 'readwrite');
  await Promise.all([...keys.map((key) => tx.store.delete(key)), tx.done]);
}

/**
 * URL de objeto para un blob. Si el entorno no tiene `URL.createObjectURL`
 * (puede pasar en happy-dom), devuelve una URL simbólica `blob:` + clave
 * para que la caché del store se comporte igual.
 */
export function createObjectUrl(blob: Blob, key: string): string {
  if (typeof URL.createObjectURL === 'function') return URL.createObjectURL(blob);
  return `blob:${key}`;
}

/** Revoca una URL de objeto creada con `createObjectUrl` (sin fallar donde no exista la función). */
export function revokeObjectUrl(url: string): void {
  if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
}
