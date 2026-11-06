/**
 * Colección de demostración: tres vinilos (normal, con aro decorado y
 * enteramente decorado) con pistas sintetizadas, para que la habitación no
 * esté vacía la primera vez.
 *
 * CONTRATO (lo implementa el módulo de aplicación): genera las pistas con
 * `generateDemoTrack` (cada una entre 20 y 40 s, como mucho 3 por cara, en
 * total ~25 MB de WAV mono a 32 kHz), las guarda en `store.blobs` y añade
 * los vinilos con `store.addVinyl`. Los títulos y artistas son ficticios y
 * se presentan como demostración (no se inventan discos reales). Si no hay
 * `OfflineAudioContext` (tests), las pistas se crean sin audio con las
 * duraciones previstas.
 *
 * Implementación: las 11 pistas (330 s, ≈ 21 MB de WAV) se sintetizan con
 * hasta `DEMO_CONCURRENCY` renderizados a la vez y cada vinilo se añade a la
 * estantería en cuanto sus pistas están listas, en orden.
 */
import { generateDemoTrack, type DemoTrackSpec } from '../audio/demo';
import { DEMO_ART_SIZE, paintDemoArtwork } from './demo-art';
import { presetFull, presetNormal, presetRing, track } from '../core/defaults';
import { defaultThicknessMm } from '../core/geometry';
import type { Store } from '../core/store';
import type { Condition, Track, Vinyl, VinylMeta } from '../core/types';

/** Sintetizador de pistas (inyectable en las pruebas). */
export type DemoTrackGenerator = (spec: DemoTrackSpec) => Promise<Blob>;

/** Renderizados de demostración simultáneos (cada uno usa su propio hilo de audio). */
export const DEMO_CONCURRENCY = 3;

export const DEMO_LABEL_NAME = 'Discos Tapiz';

const DEMO_NOTE =
  'Disco de demostración: artista, canciones y sello son ficticios y la música se sintetiza en el navegador la primera vez que se abre la aplicación.';

type DemoVoice = DemoTrackSpec['voice'];

interface DemoTrackPlan {
  title: string;
  durationSec: number;
  seed: number;
  bpm: number;
  voice: DemoVoice;
}

interface DemoAlbumPlan {
  preset: 'normal' | 'ring' | 'full';
  meta: Partial<VinylMeta>;
  /** Escala y tónica comunes a todo el disco (le dan un carácter propio). */
  scale: number[];
  rootHz: number;
  sideA: DemoTrackPlan[];
  sideB: DemoTrackPlan[];
  condition: Partial<Condition>;
  customize?: (vinyl: Vinyl) => void;
}

const MAJOR_PENTATONIC = [0, 2, 4, 7, 9];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];

/** Plan de la colección: 11 pistas de 20–40 s, como mucho 3 por cara. */
export const DEMO_ALBUMS: readonly DemoAlbumPlan[] = [
  {
    preset: 'normal',
    meta: {
      artist: 'Los Ecos del Aparador',
      title: 'Tardes de Persiana',
      year: '1978',
      labelName: DEMO_LABEL_NAME,
      catalogNumber: 'DT-1001',
      genre: 'Pop de cámara',
      notes: DEMO_NOTE,
    },
    scale: MAJOR_PENTATONIC,
    rootHz: 220,
    sideA: [
      { title: 'Café con tormenta', durationSec: 32, seed: 1101, bpm: 104, voice: 'piano' },
      { title: 'La siesta del ventilador', durationSec: 28, seed: 1102, bpm: 92, voice: 'organ' },
      { title: 'Postales sin sello', durationSec: 36, seed: 1103, bpm: 100, voice: 'piano' },
    ],
    sideB: [
      { title: 'Balcón interior', durationSec: 30, seed: 1104, bpm: 96, voice: 'piano' },
      { title: 'Hasta mañana, bombilla', durationSec: 34, seed: 1105, bpm: 84, voice: 'organ' },
    ],
    condition: { dust: 0.12, wear: 0.05, warp: 0.04, plays: 3 },
  },
  {
    preset: 'ring',
    meta: {
      artist: 'Marea Baja Trío',
      title: 'Faro apagado',
      year: '1981',
      labelName: DEMO_LABEL_NAME,
      catalogNumber: 'DT-1002',
      genre: 'Surf instrumental',
      notes: DEMO_NOTE,
    },
    scale: DORIAN,
    rootHz: 146.83,
    sideA: [
      { title: 'Faro apagado', durationSec: 26, seed: 2101, bpm: 138, voice: 'bass-lead' },
      { title: 'Redes al sol', durationSec: 22, seed: 2102, bpm: 126, voice: 'bass-lead' },
    ],
    sideB: [
      { title: 'Bajamar', durationSec: 24, seed: 2103, bpm: 120, voice: 'bell' },
      { title: 'Gaviota cansada', durationSec: 20, seed: 2104, bpm: 132, voice: 'bass-lead' },
    ],
    condition: { dust: 0.3, wear: 0.18, warp: 0.1, scratches: 0.08, plays: 21 },
    customize: (vinyl) => {
      // Single de 7" a 45 rpm con el agujero grande de las máquinas de discos.
      vinyl.disc.format = '7';
      vinyl.disc.nativeRpm = 45;
      vinyl.disc.hole = 'large';
      vinyl.disc.weightGrams = 120;
      vinyl.disc.thicknessMm = defaultThicknessMm(120);
      vinyl.disc.trackGapSec = 1.5;
    },
  },
  {
    preset: 'full',
    meta: {
      artist: 'Clara Vendaval',
      title: 'Cartografía del viento',
      year: '1984',
      labelName: DEMO_LABEL_NAME,
      catalogNumber: 'DT-1003',
      genre: 'Canción de autor',
      notes: DEMO_NOTE,
    },
    scale: LYDIAN,
    rootHz: 261.63,
    sideA: [
      { title: 'Rosa de los vientos', durationSec: 38, seed: 3101, bpm: 76, voice: 'bell' },
      { title: 'Mapa sin norte', durationSec: 40, seed: 3102, bpm: 72, voice: 'organ' },
    ],
    sideB: [],
    condition: { dust: 0.02, wear: 0, warp: 0.02, plays: 0 },
  },
];

/** Número total de pistas de la colección de demostración. */
export const DEMO_TRACK_COUNT = DEMO_ALBUMS.reduce((n, a) => n + a.sideA.length + a.sideB.length, 0);

/** Siembra la colección de demostración en el store y devuelve los vinilos añadidos. */
export async function seedDemoCollection(store: Store): Promise<Vinyl[]> {
  return seedDemoCollectionWith(store, generateDemoTrack);
}

/** Como `seedDemoCollection`, con el sintetizador y la concurrencia explícitos (pruebas). */
export async function seedDemoCollectionWith(
  store: Store,
  generate: DemoTrackGenerator,
  concurrency = DEMO_CONCURRENCY,
): Promise<Vinyl[]> {
  const limit = createLimiter(Math.max(1, Math.floor(concurrency)));
  const reporter = createFailureReporter();
  const pending = DEMO_ALBUMS.map((album) => {
    const make = (side: 'a' | 'b') => (plan: DemoTrackPlan, i: number) =>
      limit(() => makeTrack(store, generate, album, plan, `${album.meta.catalogNumber}-${side}${i + 1}`, reporter));
    return {
      album,
      sideA: Promise.all(album.sideA.map(make('a'))),
      sideB: Promise.all(album.sideB.map(make('b'))),
    };
  });
  const added: Vinyl[] = [];
  for (const { album, sideA, sideB } of pending) {
    const vinyl = buildVinyl(album, await sideA, await sideB);
    if (album.preset === 'full') await attachPaintedArtwork(store, vinyl);
    added.push(store.addVinyl(vinyl));
  }
  return added;
}

/**
 * Cara A del vinilo «enteramente decorado»: obra pintada (texto en arco y una
 * rosa de los vientos) en lugar del degradado del preset. Sin canvas (tests)
 * o si falla, el disco conserva el degradado.
 */
async function attachPaintedArtwork(store: Store, vinyl: Vinyl): Promise<void> {
  try {
    const art = await paintDemoArtwork(vinyl.meta.artist, vinyl.meta.title);
    if (!art) return;
    const blobKey = await store.blobs.put(art);
    vinyl.disc.sides[0].artwork = {
      kind: 'image',
      image: { blobKey, width: DEMO_ART_SIZE, height: DEMO_ART_SIZE, name: 'cara-pintada.jpg' },
      fit: 'cover',
      backdrop: '#d8d2c2',
    };
  } catch (error) {
    console.warn('Tocadiscos: no se pudo pintar la cara decorada de la demostración; queda el degradado.', error);
  }
}

function buildVinyl(album: DemoAlbumPlan, tracksA: Track[], tracksB: Track[]): Vinyl {
  const vinyl =
    album.preset === 'normal'
      ? presetNormal(album.meta, tracksA, tracksB)
      : album.preset === 'ring'
        ? presetRing(album.meta, tracksA, tracksB)
        : presetFull(album.meta, tracksA);
  vinyl.disc.condition = { ...vinyl.disc.condition, ...album.condition };
  vinyl.jacket.backNotes = DEMO_NOTE;
  album.customize?.(vinyl);
  return vinyl;
}

async function makeTrack(
  store: Store,
  generate: DemoTrackGenerator,
  album: DemoAlbumPlan,
  plan: DemoTrackPlan,
  fileStem: string,
  reportFailure: (error: unknown) => void,
): Promise<Track> {
  const spec: DemoTrackSpec = {
    seed: plan.seed,
    durationSec: plan.durationSec,
    bpm: plan.bpm,
    scale: album.scale,
    rootHz: album.rootHz,
    voice: plan.voice,
  };
  try {
    const blob = await generate(spec);
    const blobKey = await store.blobs.put(blob);
    return track(plan.title, plan.durationSec, { blobKey, mimeType: 'audio/wav', fileName: `${fileStem.toLowerCase()}.wav` });
  } catch (error) {
    reportFailure(error);
    return track(plan.title, plan.durationSec, null);
  }
}

function hasOfflineAudioContext(): boolean {
  const g = globalThis as { OfflineAudioContext?: unknown; webkitOfflineAudioContext?: unknown };
  return typeof (g.OfflineAudioContext ?? g.webkitOfflineAudioContext) === 'function';
}

/**
 * Sin OfflineAudioContext las pistas sin audio son lo esperado y no se avisa;
 * con él, un fallo se avisa una sola vez por siembra.
 */
function createFailureReporter(): (error: unknown) => void {
  let reported = false;
  return (error) => {
    if (reported || !hasOfflineAudioContext()) return;
    reported = true;
    console.warn('Tocadiscos: no se pudo sintetizar parte del audio de demostración; esas pistas quedan en silencio.', error);
  };
}

/** Limita cuántas tareas asíncronas corren a la vez; el resto espera en cola, en orden. */
function createLimiter(max: number): <T>(job: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = (): void => {
    if (active >= max) return;
    const start = queue.shift();
    if (!start) return;
    active++;
    start();
  };
  return <T>(job: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        // `then(job)` convierte también una excepción síncrona en rechazo: el hueco siempre se libera.
        Promise.resolve()
          .then(job)
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
}
