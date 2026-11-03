/**
 * Biblioteca de audio: decodifica los archivos guardados en el almacén de
 * blobs y cachea los AudioBuffer resultantes.
 *
 * CONTRATO: la decodificación usa un OfflineAudioContext (no necesita gesto
 * de usuario). `sideSource()` devuelve la cara lista para `AudioEngine.loadSide`.
 */
import type { BlobStore } from '../core/store';
import type { AudioRef, SideId, Vinyl } from '../core/types';
import type { SideAudioSource } from './engine';

export interface AudioLibrary {
  getBuffer(ref: AudioRef): Promise<AudioBuffer>;
  sideSource(vinyl: Vinyl, side: SideId): Promise<SideAudioSource>;
  evict(blobKey: string): void;
  clear(): void;
}

export function createAudioLibrary(_blobs: BlobStore): AudioLibrary {
  throw new Error('createAudioLibrary: no implementado todavía');
}
