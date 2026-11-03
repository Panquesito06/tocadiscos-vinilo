/**
 * Importación de archivos de audio locales (MP3, FLAC, WAV, OGG, M4A…).
 *
 * CONTRATO: cada archivo se guarda en el almacén de blobs y se decodifica una
 * vez para conocer su duración. El título se deduce del nombre del archivo
 * (sin extensión, quitando prefijos numéricos tipo "03 - "). Los archivos que
 * el navegador no puede decodificar se devuelven en `rejected` con el motivo.
 */
import type { BlobStore } from '../core/store';
import type { Track } from '../core/types';

export interface ImportResult {
  tracks: Track[];
  rejected: { fileName: string; reason: string }[];
}

export function titleFromFileName(_fileName: string): string {
  throw new Error('titleFromFileName: no implementado todavía');
}

export async function importAudioFiles(_files: File[], _blobs: BlobStore): Promise<ImportResult> {
  throw new Error('importAudioFiles: no implementado todavía');
}
