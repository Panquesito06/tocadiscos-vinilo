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
import type { BlobStore } from '../core/store';
import type { AudioRef, SideId, Vinyl } from '../core/types';
import type { DecodedTrack, SideAudioSource } from './engine';

export interface AudioLibrary {
  getTrack(ref: AudioRef): Promise<DecodedTrack>;
  sideSource(vinyl: Vinyl, side: SideId): Promise<SideAudioSource>;
  evict(blobKey: string): void;
  clear(): void;
}

export function createAudioLibrary(_blobs: BlobStore): AudioLibrary {
  throw new Error('createAudioLibrary: no implementado todavía');
}
