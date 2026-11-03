/**
 * Biblioteca de audio: decodifica los archivos guardados en el almacén de
 * blobs y cachea el resultado como PCM de 16 bits (`DecodedTrack`).
 *
 * CONTRATO: la decodificación usa un OfflineAudioContext (no necesita gesto
 * de usuario) y descarta el AudioBuffer en cuanto se ha convertido a Int16.
 * La caché es LRU con presupuesto de memoria (~160 MB). `sideSource()`
 * devuelve la cara lista para `AudioEngine.loadSide`, con `load()` perezoso
 * por pista; una cara decorativa devuelve `tracks: []`.
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
