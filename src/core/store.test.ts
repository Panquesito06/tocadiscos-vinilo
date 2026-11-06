/**
 * Tests del store con fake-indexeddb (lo carga src/test/setup.ts).
 *
 * Cada test usa una base de datos con nombre propio. Los blobs se crean con
 * el `Blob` de Node: el de happy-dom no sobrevive a `structuredClone` (que
 * es lo que usa IndexedDB para guardar), mientras que el de Node sí y además
 * lo acepta `URL.createObjectURL`.
 */
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildState,
  createStore,
  MAX_WRITE_WAIT_MS,
  nextShelfIndex,
  sortedByShelf,
  type Store,
  type StoreListener,
} from './store';
import { createObjectUrl, migrateDocument, MIGRATIONS, openTocadiscosDb, revokeObjectUrl, type RawDocument } from './db';
import { createVinyl, defaultUiState, track } from './defaults';
import { newId } from './ids';
import { SCHEMA_VERSION, type AppState, type Fill } from './types';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function uniqueDbName(): string {
  return `test-${newId()}`;
}

function textBlob(text: string): Blob {
  return new NodeBlob([text], { type: 'text/plain' }) as unknown as Blob;
}

function imageFill(blobKey: string): Fill {
  return { kind: 'image', image: { blobKey }, fit: 'cover', backdrop: '#000000' };
}

interface RawDb {
  vinyls: unknown[];
  turntable: unknown;
  settings: unknown;
  schemaVersion: unknown;
  ui: unknown;
  blobKeys: string[];
}

/** Lee la base de datos tal cual, con una conexión propia. */
async function readRaw(dbName: string): Promise<RawDb> {
  const db = await openTocadiscosDb(dbName);
  try {
    const tx = db.transaction(['vinyls', 'kv', 'blobs']);
    const kv = tx.objectStore('kv');
    // `ui` no es una clave válida del almacén `kv`: se lee sin tipar para comprobar que no existe.
    const untypedKv = kv as unknown as { get(key: string): Promise<unknown> };
    const [vinyls, turntable, settings, schemaVersion, ui, blobKeys] = await Promise.all([
      tx.objectStore('vinyls').getAll(),
      kv.get('turntable'),
      kv.get('settings'),
      kv.get('schemaVersion'),
      untypedKv.get('ui'),
      tx.objectStore('blobs').getAllKeys(),
      tx.done,
    ]);
    return { vinyls, turntable, settings, schemaVersion, ui, blobKeys };
  } finally {
    db.close();
  }
}

/** Espera (en ticks reales de setImmediate, que no se falsean) a que la condición se cumpla. */
async function waitFor(condition: () => Promise<boolean>, attempts = 200): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (await condition()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('La condición no se cumplió a tiempo');
}

async function readyStore(dbName: string, debounceMs = 0): Promise<Store> {
  const store = createStore({ dbName, debounceMs });
  await store.ready;
  return store;
}

function ids(state: AppState): string[] {
  return state.vinyls.map((v) => v.id);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Carga y persistencia
// ---------------------------------------------------------------------------

describe('carga y persistencia', () => {
  it('un vinilo hace ida y vuelta tras recrear el store con el mismo nombre de base de datos', async () => {
    const dbName = uniqueDbName();
    const first = await readyStore(dbName);
    const vinyl = createVinyl({ meta: { artist: 'Dúo Dinámico', title: 'Quince años tiene mi amor' } });
    vinyl.disc.sides[0].tracks = [track('Uno', 120)];
    const stored = first.addVinyl(vinyl);
    first.update((draft) => {
      draft.turntable.loaded = { vinylId: stored.id, side: 'B' };
      draft.turntable.speed = 45;
      draft.settings.dustSpeed = 3;
    });
    await first.flush();

    const second = await readyStore(dbName);
    const state = second.getState();
    expect(state.vinyls).toEqual([stored]);
    expect(state.turntable.loaded).toEqual({ vinylId: stored.id, side: 'B' });
    expect(state.turntable.speed).toBe(45);
    expect(state.settings.dustSpeed).toBe(3);
    expect((await readRaw(dbName)).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('un documento antiguo sin campos nuevos se normaliza al cargar y se guarda normalizado', async () => {
    const dbName = uniqueDbName();
    const db = await openTocadiscosDb(dbName);
    await db.put('vinyls', {
      id: 'vin_viejo',
      createdAt: 1000,
      shelfIndex: 7,
      meta: { artist: 'Alguien', title: 'Algo' },
      disc: { format: '7', sides: [{ id: 'A', tracks: [{ id: 't1', title: 'Uno', durationSec: 30, audio: null }] }] },
    });
    await db.put('vinyls', { id: 'vin_mas_viejo', createdAt: 500, shelfIndex: 2 });
    await db.put('kv', { speed: 45, loaded: { vinylId: 'vin_desaparecido', side: 'A' } }, 'turntable');
    await db.put('kv', { fancyRendering: false }, 'settings');
    db.close();

    const store = await readyStore(dbName);
    const state = store.getState();
    expect(ids(state)).toEqual(['vin_mas_viejo', 'vin_viejo']);
    expect(state.vinyls.map((v) => v.shelfIndex)).toEqual([0, 1]);
    const old = state.vinyls[1]!;
    expect(old.disc.format).toBe('7');
    expect(old.disc.nativeRpm).toBe(33);
    expect(old.disc.sides[0].tracks[0]!.title).toBe('Uno');
    expect(old.disc.sides[1].id).toBe('B');
    expect(old.spine.text).toBe('Alguien — Algo');
    expect(old.outerSleeve.kind).toBe('pvc-clear');
    expect(state.turntable.speed).toBe(45);
    expect(state.turntable.loaded).toBeNull();
    expect(state.turntable.tonearm).toEqual({ onRest: true, lifted: true, radiusMm: 160 });
    expect(state.settings).toEqual({ dustSpeed: 1, fancyRendering: false });
    expect(state.ui).toEqual(defaultUiState());

    const raw = await readRaw(dbName);
    expect(raw.schemaVersion).toBe(SCHEMA_VERSION);
    expect(sortedByShelf(raw.vinyls as AppState['vinyls'])).toEqual(state.vinyls);
    expect(raw.turntable).toEqual(state.turntable);
  });

  it('valores guardados fuera de rango o nulos vuelven a sus valores por defecto', () => {
    const doc: RawDocument = {
      vinyls: [],
      turntable: { speed: 50, pitchPercent: 99, volume: -1, loaded: { vinylId: 'x' } },
      settings: null,
      schemaVersion: null,
    };
    const state = buildState(doc);
    expect(state.turntable.speed).toBe(33);
    expect(state.turntable.pitchPercent).toBe(8);
    expect(state.turntable.volume).toBe(0);
    expect(state.turntable.loaded).toBeNull();
    expect(state.settings).toEqual({ dustSpeed: 1, fancyRendering: true });
    expect(buildState({ vinyls: [], turntable: null, settings: undefined, schemaVersion: null }).turntable.speed).toBe(33);
  });

  it('las migraciones están vacías en la v1 y dejan el documento intacto', () => {
    const doc: RawDocument = { vinyls: [{ id: 'a' }], turntable: { speed: 78 }, settings: {}, schemaVersion: 0 };
    expect(MIGRATIONS).toEqual([]);
    expect(migrateDocument(doc, 0)).toBe(doc);
  });

  it('la interfaz (ui) no se persiste', async () => {
    const dbName = uniqueDbName();
    const first = await readyStore(dbName);
    first.update((draft) => {
      draft.ui.view = 'hand';
      draft.ui.handVinylId = 'cualquiera';
      draft.ui.tool = 'brush';
    });
    await first.flush();
    expect((await readRaw(dbName)).ui).toBeUndefined();
    const second = await readyStore(dbName);
    expect(second.getState().ui).toEqual(defaultUiState());
  });

  it('flush() escribe lo pendiente ya, y varios flush seguidos se encadenan sin solaparse', async () => {
    const dbName = uniqueDbName();
    const store = await readyStore(dbName, 10_000);
    const stored = store.addVinyl(createVinyl({ meta: { title: 'Primero' } }));
    const firstFlush = store.flush();
    store.update((draft) => {
      draft.vinyls[0]!.meta.title = 'Segundo';
    });
    const secondFlush = store.flush();
    await Promise.all([firstFlush, secondFlush]);
    const raw = await readRaw(dbName);
    expect(raw.vinyls).toHaveLength(1);
    expect((raw.vinyls[0] as { id: string; meta: { title: string } }).id).toBe(stored.id);
    expect((raw.vinyls[0] as { meta: { title: string } }).meta.title).toBe('Segundo');
    // Sin nada pendiente, flush() resuelve sin más.
    await expect(store.flush()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Retardo y tope de espera
// ---------------------------------------------------------------------------

describe('debounce y tope de espera', () => {
  it('el debounce se reinicia con cada update y escribe al pasar el retardo', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const dbName = uniqueDbName();
    const store = await readyStore(dbName, 300);
    store.addVinyl(createVinyl());
    await vi.advanceTimersByTimeAsync(200);
    store.update((draft) => {
      draft.settings.dustSpeed = 2;
    });
    await vi.advanceTimersByTimeAsync(299);
    expect((await readRaw(dbName)).vinyls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await waitFor(async () => (await readRaw(dbName)).vinyls.length === 1);
    expect((await readRaw(dbName)).settings).toEqual({ dustSpeed: 2, fancyRendering: true });
  });

  it('con updates continuos escribe igualmente al cumplirse el tope de 2 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const dbName = uniqueDbName();
    const store = await readyStore(dbName, 300);
    let lastValue = 0;
    const storedDustSpeed = async (): Promise<number | undefined> =>
      ((await readRaw(dbName)).settings as { dustSpeed?: number } | undefined)?.dustSpeed;
    /** Un update cada 100 ms durante `ms` (el primero ya): el debounce de 300 ms nunca llega a cumplirse. */
    const hammer = async (ms: number): Promise<void> => {
      for (let t = 0; t < ms; t += 100) {
        lastValue += 1;
        const value = lastValue;
        store.update((draft) => {
          draft.settings.dustSpeed = value;
        });
        await vi.advanceTimersByTimeAsync(100);
      }
    };

    store.addVinyl(createVinyl({ meta: { title: 'Sin parar' } }));
    await hammer(MAX_WRITE_WAIT_MS - 100);
    expect((await readRaw(dbName)).vinyls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100);
    await waitFor(async () => (await readRaw(dbName)).vinyls.length === 1);
    expect(await storedDustSpeed()).toBe(lastValue);

    // Tras la escritura, el tope vuelve a contar desde el primer update sin guardar.
    const afterFirstWrite = lastValue;
    await hammer(MAX_WRITE_WAIT_MS - 100);
    expect(await storedDustSpeed()).toBe(afterFirstWrite);
    await vi.advanceTimersByTimeAsync(100);
    await waitFor(async () => (await storedDustSpeed()) === lastValue);
  });
});

// ---------------------------------------------------------------------------
// Estado y suscriptores
// ---------------------------------------------------------------------------

describe('update y suscriptores', () => {
  it('getState devuelve el mismo objeto hasta la siguiente mutación y update notifica síncronamente', async () => {
    const store = await readyStore(uniqueDbName());
    const before = store.getState();
    expect(store.getState()).toBe(before);

    const seen: Array<[AppState, AppState]> = [];
    const unsubscribe = store.subscribe((state, prev) => seen.push([state, prev]));
    store.update((draft) => {
      draft.ui.view = 'hand';
    });
    expect(seen).toHaveLength(1);
    const [next, prev] = seen[0]!;
    expect(prev).toBe(before);
    expect(next).toBe(store.getState());
    expect(next).not.toBe(before);
    expect(next.ui.view).toBe('hand');
    expect(before.ui.view).toBe('room');

    unsubscribe();
    store.update((draft) => {
      draft.ui.view = 'room';
    });
    expect(seen).toHaveLength(1);
  });

  it('una excepción en un suscriptor no impide notificar al resto', async () => {
    const store = await readyStore(uniqueDbName());
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = vi.fn<StoreListener>(() => {
      throw new Error('fallo a propósito');
    });
    const healthy = vi.fn<StoreListener>();
    store.subscribe(broken);
    store.subscribe(healthy);
    store.update((draft) => {
      draft.settings.fancyRendering = false;
    });
    expect(broken).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('si mutate lanza, el estado no cambia', async () => {
    const store = await readyStore(uniqueDbName());
    const before = store.getState();
    expect(() =>
      store.update(() => {
        throw new Error('no');
      }),
    ).toThrow('no');
    expect(store.getState()).toBe(before);
  });

  it('un update hecho desde un suscriptor se notifica después, en orden, a todos', async () => {
    const store = await readyStore(uniqueDbName());
    const seen: string[] = [];
    let nested = false;
    store.subscribe((state) => {
      seen.push(`A:${state.ui.view}`);
      if (!nested) {
        nested = true;
        store.update((draft) => {
          draft.ui.view = 'editor';
        });
        // El estado ya ha cambiado, aunque la notificación espere.
        expect(store.getState().ui.view).toBe('editor');
      }
    });
    store.subscribe((state, prev) => seen.push(`B:${prev.ui.view}>${state.ui.view}`));
    store.update((draft) => {
      draft.ui.view = 'hand';
    });
    expect(seen).toEqual(['A:hand', 'B:room>hand', 'A:editor', 'B:hand>editor']);
  });
});

// ---------------------------------------------------------------------------
// Vinilos
// ---------------------------------------------------------------------------

describe('addVinyl y removeVinyl', () => {
  it('addVinyl ignora el shelfIndex recibido, numera máximo + 1 y devuelve una copia', async () => {
    const store = await readyStore(uniqueDbName());
    const first = store.addVinyl(createVinyl({ shelfIndex: 42 }));
    expect(first.shelfIndex).toBe(0);
    const second = store.addVinyl(createVinyl({ shelfIndex: -7 }));
    expect(second.shelfIndex).toBe(1);
    store.update((draft) => {
      draft.vinyls[1]!.shelfIndex = 10;
    });
    const third = store.addVinyl(createVinyl());
    expect(third.shelfIndex).toBe(11);
    expect(ids(store.getState())).toEqual([first.id, second.id, third.id]);
    expect(store.getState().vinyls[2]).toEqual(third);
    expect(store.getState().vinyls[2]).not.toBe(third);
    expect(() => store.addVinyl(third)).toThrow(/id/);
    expect(nextShelfIndex([])).toBe(0);
  });

  it('removeVinyl renumera, limpia plato, mano y editor, borra los blobs huérfanos y devuelve sus claves', async () => {
    const dbName = uniqueDbName();
    const store = await readyStore(dbName);
    const shared = await store.blobs.put(textBlob('portada compartida'));
    const own = await store.blobs.put(textBlob('audio propio'));

    const a = createVinyl({ meta: { title: 'A' } });
    a.jacket.front = imageFill(shared);
    a.disc.sides[0].tracks = [track('Pista', 60, { blobKey: own, mimeType: 'audio/wav', fileName: 'pista.wav' })];
    const b = createVinyl({ meta: { title: 'B' } });
    b.jacket.back = imageFill(shared);
    const c = createVinyl({ meta: { title: 'C' } });
    const [sa, sb, sc] = [store.addVinyl(a), store.addVinyl(b), store.addVinyl(c)];
    store.update((draft) => {
      draft.turntable.loaded = { vinylId: sa.id, side: 'A' };
      draft.ui.view = 'editor';
      draft.ui.editorVinylId = sa.id;
      draft.ui.handVinylId = sa.id;
    });
    const ownUrl = await store.blobs.url(own);
    const revoke = vi.spyOn(URL, 'revokeObjectURL');

    const deleted = await store.removeVinyl(sa.id);
    expect(deleted).toEqual([own]);
    const state = store.getState();
    expect(state.vinyls.map((v) => [v.id, v.shelfIndex])).toEqual([
      [sb.id, 0],
      [sc.id, 1],
    ]);
    expect(state.turntable.loaded).toBeNull();
    expect(state.ui).toMatchObject({ view: 'room', editorVinylId: null, handVinylId: null });
    expect(await store.blobs.get(own)).toBeNull();
    expect(await store.blobs.get(shared)).not.toBeNull();
    expect(store.blobs.cachedUrl(own)).toBeNull();
    expect(revoke).toHaveBeenCalledWith(ownUrl);

    // Ya está en disco sin necesidad de flush (getAll devuelve por clave, no por orden de estantería).
    const raw = await readRaw(dbName);
    expect((raw.vinyls as { id: string }[]).map((v) => v.id).sort()).toEqual([sb.id, sc.id].sort());
    expect(raw.blobKeys).toEqual([shared]);

    expect(await store.removeVinyl('vin_inexistente')).toEqual([]);
  });

  it('removeVinyl no cierra la mano ni el editor si mostraban otro vinilo', async () => {
    const store = await readyStore(uniqueDbName());
    const kept = store.addVinyl(createVinyl());
    const gone = store.addVinyl(createVinyl());
    store.update((draft) => {
      draft.ui.view = 'hand';
      draft.ui.handVinylId = kept.id;
    });
    await store.removeVinyl(gone.id);
    expect(store.getState().ui).toMatchObject({ view: 'hand', handVinylId: kept.id });
  });

  it('sortedByShelf ordena por shelfIndex y, a igualdad, por fecha de creación', () => {
    const late = createVinyl({ shelfIndex: 1, now: 2000 });
    const early = createVinyl({ shelfIndex: 1, now: 1000 });
    const first = createVinyl({ shelfIndex: 0, now: 3000 });
    expect(sortedByShelf([late, early, first]).map((v) => v.id)).toEqual([first.id, early.id, late.id]);
  });
});

// ---------------------------------------------------------------------------
// Blobs
// ---------------------------------------------------------------------------

describe('blobs', () => {
  it('al cargar borra los blobs que ningún vinilo usa (siembra o importación interrumpida)', async () => {
    const dbName = uniqueDbName();
    const first = await readyStore(dbName);
    const used = await first.blobs.put(textBlob('portada'));
    const orphan = await first.blobs.put(textBlob('wav a medias'));
    first.addVinyl(createVinyl({ jacket: { front: imageFill(used) } }));
    await first.flush();

    const second = await readyStore(dbName);
    expect(await second.blobs.get(orphan)).toBeNull();
    expect(await (await second.blobs.get(used))!.text()).toBe('portada');
    expect((await readRaw(dbName)).blobKeys).toEqual([used]);
  });

  it('put/get/delete con claves generadas o propias', async () => {
    const store = await readyStore(uniqueDbName());
    const key = await store.blobs.put(textBlob('hola'));
    expect(key).toMatch(/^blob_/);
    const back = await store.blobs.get(key);
    expect(back).not.toBeNull();
    expect(await back!.text()).toBe('hola');
    expect(await store.blobs.put(textBlob('x'), 'img_propia')).toBe('img_propia');
    expect(await (await store.blobs.get('img_propia'))!.text()).toBe('x');
    expect(await store.blobs.get('no-existe')).toBeNull();
    await store.blobs.delete(key);
    expect(await store.blobs.get(key)).toBeNull();
    await expect(store.blobs.delete('no-existe')).resolves.toBeUndefined();
  });

  it('url devuelve la misma URL dos veces (creada una sola vez) y delete la revoca', async () => {
    const store = await readyStore(uniqueDbName());
    const key = await store.blobs.put(textBlob('imagen'));
    const create = vi.spyOn(URL, 'createObjectURL');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');

    expect(await store.blobs.url('no-existe')).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(store.blobs.cachedUrl(key)).toBeNull();

    const [first, second] = await Promise.all([store.blobs.url(key), store.blobs.url(key)]);
    const third = await store.blobs.url(key);
    expect(first).toMatch(/^blob:/);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
    expect(store.blobs.cachedUrl(key)).toBe(first);

    await store.blobs.delete(key);
    expect(revoke).toHaveBeenCalledWith(first);
    expect(store.blobs.cachedUrl(key)).toBeNull();
    expect(await store.blobs.url(key)).toBeNull();
  });

  it('sustituir un blob bajo la misma clave invalida su URL cacheada', async () => {
    const store = await readyStore(uniqueDbName());
    const key = await store.blobs.put(textBlob('uno'), 'clave');
    const before = await store.blobs.url(key);
    await store.blobs.put(textBlob('dos'), key);
    expect(store.blobs.cachedUrl(key)).toBeNull();
    const after = await store.blobs.url(key);
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it('createObjectUrl usa "blob:" + clave solo si no existe URL.createObjectURL', () => {
    const real = createObjectUrl(textBlob('x'), 'clave');
    expect(real).toMatch(/^blob:/);
    expect(real).not.toBe('blob:clave');
    revokeObjectUrl(real);

    const original = URL.createObjectURL;
    const urlStatics = URL as unknown as { createObjectURL?: typeof URL.createObjectURL };
    urlStatics.createObjectURL = undefined;
    try {
      expect(createObjectUrl(textBlob('x'), 'clave')).toBe('blob:clave');
    } finally {
      urlStatics.createObjectURL = original;
    }
  });
});
