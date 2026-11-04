/**
 * Importación de archivos de audio locales (MP3, FLAC, WAV, OGG, M4A…).
 *
 * CONTRATO: cada archivo se guarda en el almacén de blobs y su duración se
 * lee de los metadatos con un elemento <audio> (evento `loadedmetadata`),
 * NUNCA decodificando el archivo entero (un álbum son cientos de MB de PCM).
 * Los archivos se procesan de uno en uno. `durationSec` se guarda sin
 * redondear. Si el navegador no puede reproducir el archivo (evento `error`
 * o duración no finita), se devuelve en `rejected` con el motivo en español
 * y no se guarda el blob. El título se deduce del nombre del archivo (sin
 * extensión, quitando prefijos numéricos tipo "03 - ", "03." o "03_", con
 * guiones bajos convertidos en espacios). `mimeType` es `file.type` o, si
 * está vacío, se deduce de la extensión.
 */
import { newId } from '../core/ids';
import type { BlobStore } from '../core/store';
import type { Track } from '../core/types';

export interface ImportResult {
  tracks: Track[];
  rejected: { fileName: string; reason: string }[];
}

/** Tiempo máximo esperando los metadatos de un archivo. */
export const IMPORT_TIMEOUT_MS = 15_000;

export const REASON_UNPLAYABLE = 'El navegador no puede reproducir este formato';
export const REASON_UNREADABLE = 'No se pudo leer el archivo';
export const REASON_NOT_SAVED = 'No se pudo guardar el archivo en el navegador';

const MIME_BY_EXTENSION: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  wave: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  webm: 'audio/webm',
  weba: 'audio/webm',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
};

/** Prefijo de número de pista: "03 - ", "03.", "03_", "03 ", "03) " y también "1-03 " (disco-pista). */
const TRACK_NUMBER_PREFIX = /^(?:\d{1,2}[-.])?\d{1,3}\s*(?:[-–—._)]\s*|\s+)/;

function baseName(fileName: string): string {
  return fileName.split(/[\\/]/).pop() ?? '';
}

function extensionOf(fileName: string): string {
  const base = baseName(fileName);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function tidy(text: string): string {
  return text.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

export function titleFromFileName(fileName: string): string {
  const base = baseName(fileName);
  const stem = extensionOf(base) ? base.slice(0, base.lastIndexOf('.')) : base;
  const stripped = tidy(stem.replace(TRACK_NUMBER_PREFIX, ''));
  return stripped || tidy(stem) || tidy(base) || 'Sin título';
}

export function mimeTypeFor(file: { name: string; type: string }): string {
  const declared = file.type.trim().toLowerCase();
  if (declared) return declared;
  return MIME_BY_EXTENSION[extensionOf(file.name)] ?? 'application/octet-stream';
}

/**
 * Lee la duración de un archivo con un <audio preload="metadata"> y una URL de
 * objeto (sin decodificarlo entero). Rechaza con un motivo en español.
 */
export function probeAudioDuration(file: Blob, timeoutMs = IMPORT_TIMEOUT_MS): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.muted = true;
    let settled = false;
    let seekingForDuration = false;

    const cleanup = (): void => {
      clearTimeout(timer);
      audio.removeEventListener('loadedmetadata', onMetadata);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('error', onError);
      audio.removeAttribute('src');
      if (typeof audio.load === 'function') audio.load();
      URL.revokeObjectURL(url);
    };
    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      settle();
    };
    const tryResolve = (): boolean => {
      const duration = audio.duration;
      if (Number.isFinite(duration) && duration > 0) {
        finish(() => resolve(duration));
        return true;
      }
      return false;
    };
    const onMetadata = (): void => {
      if (tryResolve()) return;
      if (audio.duration === Number.POSITIVE_INFINITY && !seekingForDuration) {
        // Algunos OGG/WebM no declaran la duración: al saltar al final el navegador la calcula.
        seekingForDuration = true;
        audio.currentTime = 1e101;
        return;
      }
      finish(() => reject(new Error(REASON_UNPLAYABLE)));
    };
    const onDurationChange = (): void => {
      if (!seekingForDuration || tryResolve()) return;
      if (Number.isFinite(audio.duration)) finish(() => reject(new Error(REASON_UNPLAYABLE)));
    };
    const onError = (): void => finish(() => reject(new Error(REASON_UNPLAYABLE)));
    const timer = setTimeout(() => finish(() => reject(new Error(REASON_UNREADABLE))), timeoutMs);

    audio.addEventListener('loadedmetadata', onMetadata);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('error', onError);
    audio.src = url;
  });
}

async function importOne(file: File, blobs: BlobStore): Promise<Track> {
  const durationSec = await probeAudioDuration(file);
  let blobKey: string;
  try {
    blobKey = await blobs.put(file);
  } catch (error) {
    console.warn(`No se pudo guardar «${file.name}»:`, error);
    throw new Error(REASON_NOT_SAVED);
  }
  return {
    id: newId('trk'),
    title: titleFromFileName(file.name),
    durationSec,
    audio: { blobKey, mimeType: mimeTypeFor(file), fileName: file.name },
  };
}

function reasonOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return REASON_UNREADABLE;
}

export async function importAudioFiles(files: File[], blobs: BlobStore): Promise<ImportResult> {
  const result: ImportResult = { tracks: [], rejected: [] };
  for (const file of files) {
    try {
      result.tracks.push(await importOne(file, blobs));
    } catch (error) {
      result.rejected.push({ fileName: file.name, reason: reasonOf(error) });
    }
  }
  return result;
}
