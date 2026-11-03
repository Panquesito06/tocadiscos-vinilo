/**
 * Audio de demostración sintetizado.
 *
 * La aplicación no trae música real (derechos). Para que el tocadiscos suene
 * nada más abrirlo, se sintetizan pistas cortas con Web Audio (OfflineAudioContext)
 * y se guardan como WAV en el almacén de blobs. Son melodías sencillas y
 * deterministas a partir de una semilla.
 */
export interface DemoTrackSpec {
  seed: number;
  durationSec: number;
  bpm: number;
  /** Escala en semitonos desde la tónica, p. ej. [0,2,4,7,9] (pentatónica mayor). */
  scale: number[];
  rootHz: number;
  /** Timbre general. */
  voice: 'piano' | 'organ' | 'bass-lead' | 'bell';
}

/** Genera un WAV (PCM 16 bit, 44,1 kHz, estéreo) con la pista descrita. */
export async function generateDemoTrack(_spec: DemoTrackSpec): Promise<Blob> {
  throw new Error('generateDemoTrack: no implementado todavía');
}

/** Codifica un AudioBuffer como WAV PCM 16 bit. */
export function encodeWav(_buffer: AudioBuffer): Blob {
  throw new Error('encodeWav: no implementado todavía');
}
