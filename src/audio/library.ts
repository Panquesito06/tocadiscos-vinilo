/**
 * Biblioteca de audio: decodifica los archivos guardados en el almacén de
 * blobs y cachea el resultado como PCM de 16 bits (`DecodedTrack`).
 *
 * CONTRATO: la decodificación usa un OfflineAudioContext creado con
 * `sampleRate = AUDIO_SAMPLE_RATE` (así decodeAudioData remuestrea todo a la
 * frecuencia del contexto real) y descarta el AudioBuffer en cuanto se ha
 * convertido a Int16 (máximo 2 canales). La caché es LRU con presupuesto de
 * memoria (~160 MB, contando bytes de los Int16Array). Nunca se precarga la
 * colección entera. `sideSource()` devuelve la cara lista para
 * `AudioEngine.loadSide`, con `load()` perezoso por pista (null si la pista
 * no tiene audio o falla, con console.warn); una cara decorativa devuelve
 * `tracks: []`. Las decodificaciones se hacen de una en una (cola), nunca en
 * paralelo.
 */
import { sideOf } from '../core/defaults';
import type { BlobStore } from '../core/store';
import type { AudioRef, SideId, Track, Vinyl } from '../core/types';
import { AUDIO_SAMPLE_RATE, type DecodedTrack, type SideAudioSource } from './engine';

export interface AudioLibrary {
  getTrack(ref: AudioRef): Promise<DecodedTrack>;
  sideSource(vinyl: Vinyl, side: SideId): Promise<SideAudioSource>;
  evict(blobKey: string): void;
  clear(): void;
}

/** Presupuesto de la caché de pistas decodificadas, en bytes de Int16Array. */
export const AUDIO_CACHE_BUDGET_BYTES = 160 * 1024 * 1024;

/** Lo mínimo que necesitamos de un AudioBuffer para convertirlo. */
export interface PcmBufferLike {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  getChannelData(channel: number): Float32Array;
}

interface OfflineContextLike {
  decodeAudioData(
    data: ArrayBuffer,
    success?: (buffer: AudioBuffer) => void,
    failure?: (error: DOMException) => void,
  ): Promise<AudioBuffer> | void;
}

interface OfflineGlobals {
  OfflineAudioContext?: new (channels: number, length: number, sampleRate: number) => OfflineContextLike;
  webkitOfflineAudioContext?: new (channels: number, length: number, sampleRate: number) => OfflineContextLike;
}

interface CacheEntry {
  track: DecodedTrack;
  bytes: number;
}

/** Convierte muestras Float32 (−1..1) a PCM de 16 bits con saturación. */
export function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.round((samples[i] ?? 0) * 32768);
    out[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
  }
  return out;
}

/** Convierte un AudioBuffer (o equivalente) en `DecodedTrack` con dos canales como máximo. */
export function bufferToDecodedTrack(buffer: PcmBufferLike): DecodedTrack {
  const channelCount = Math.min(2, Math.max(1, buffer.numberOfChannels));
  const channels: Int16Array[] = [];
  for (let c = 0; c < channelCount; c++) channels.push(floatToInt16(buffer.getChannelData(c)));
  const durationSec = Number.isFinite(buffer.duration) ? buffer.duration : buffer.length / buffer.sampleRate;
  return { sampleRate: buffer.sampleRate, durationSec, channels };
}

function offlineContextCtor(): OfflineGlobals['OfflineAudioContext'] | undefined {
  const globals = globalThis as unknown as OfflineGlobals;
  return globals.OfflineAudioContext ?? globals.webkitOfflineAudioContext;
}

/** `decodeAudioData` con promesa, admitiendo también la forma antigua con callbacks. */
function decodeAudioData(context: OfflineContextLike, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    let result: Promise<AudioBuffer> | void;
    try {
      result = context.decodeAudioData(
        data,
        (buffer) => resolve(buffer),
        (error) => reject(error ?? new Error('decodeAudioData ha fallado')),
      );
    } catch (error) {
      reject(error);
      return;
    }
    if (result && typeof result.then === 'function') result.then(resolve, reject);
  });
}

async function decodeBlob(blob: Blob): Promise<DecodedTrack> {
  const Ctor = offlineContextCtor();
  if (!Ctor) throw new Error('No hay OfflineAudioContext: este navegador no puede decodificar audio.');
  const data = await blob.arrayBuffer();
  const context = new Ctor(2, 1, AUDIO_SAMPLE_RATE);
  const buffer = await decodeAudioData(context, data);
  // El AudioBuffer (Float32) se descarta aquí: solo sobrevive el PCM de 16 bits.
  return bufferToDecodedTrack(buffer);
}

function bytesOf(track: DecodedTrack): number {
  return track.channels.reduce((sum, channel) => sum + channel.byteLength, 0);
}

export function createAudioLibrary(blobs: BlobStore): AudioLibrary {
  return createAudioLibraryWithBudget(blobs, AUDIO_CACHE_BUDGET_BYTES);
}

/** Como `createAudioLibrary`, con un presupuesto de caché explícito (pruebas). */
export function createAudioLibraryWithBudget(blobs: BlobStore, budgetBytes: number): AudioLibrary {
  // Map conserva el orden de inserción: re-insertar en cada acierto lo convierte en LRU.
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<DecodedTrack>>();
  let totalBytes = 0;
  let queue: Promise<unknown> = Promise.resolve();

  function remove(key: string): void {
    const entry = cache.get(key);
    if (!entry) return;
    cache.delete(key);
    totalBytes -= entry.bytes;
  }

  function insert(key: string, track: DecodedTrack): void {
    remove(key);
    const entry: CacheEntry = { track, bytes: bytesOf(track) };
    cache.set(key, entry);
    totalBytes += entry.bytes;
    while (totalBytes > budgetBytes && cache.size > 1) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined || oldest === key) break;
      remove(oldest);
    }
  }

  function hit(key: string): DecodedTrack | null {
    const entry = cache.get(key);
    if (!entry) return null;
    cache.delete(key);
    cache.set(key, entry);
    return entry.track;
  }

  /** Encola una decodificación: nunca hay dos a la vez. */
  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job, job);
    queue = run.catch(() => undefined);
    return run;
  }

  function getTrack(ref: AudioRef): Promise<DecodedTrack> {
    const key = ref.blobKey;
    const cached = hit(key);
    if (cached) return Promise.resolve(cached);
    const pending = inFlight.get(key);
    if (pending) return pending;
    const promise = enqueue(async () => {
      const again = hit(key);
      if (again) return again;
      const blob = await blobs.get(key);
      if (!blob) throw new Error(`No se encontró el audio «${ref.fileName}» en el almacén.`);
      const track = await decodeBlob(blob);
      insert(key, track);
      return track;
    });
    inFlight.set(key, promise);
    const forget = (): void => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    };
    promise.then(forget, forget);
    return promise;
  }

  async function loadTrackAudio(track: Track): Promise<DecodedTrack | null> {
    if (!track.audio) return null;
    try {
      return await getTrack(track.audio);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`No se pudo decodificar «${track.title}» (${track.audio.fileName}): ${reason}`);
      return null;
    }
  }

  async function sideSource(vinyl: Vinyl, side: SideId): Promise<SideAudioSource> {
    const gapSec = Number.isFinite(vinyl.disc.trackGapSec) ? vinyl.disc.trackGapSec : 0;
    const s = sideOf(vinyl, side);
    if (s.decorative) return { tracks: [], gapSec };
    return {
      gapSec,
      tracks: s.tracks.map((track) => ({
        durationSec: Math.max(0, Number.isFinite(track.durationSec) ? track.durationSec : 0),
        load: () => loadTrackAudio(track),
      })),
    };
  }

  return {
    getTrack,
    sideSource,
    evict: (blobKey) => remove(blobKey),
    clear: () => {
      cache.clear();
      totalBytes = 0;
    },
  };
}
