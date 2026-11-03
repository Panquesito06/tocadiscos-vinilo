/**
 * Audio de demostración sintetizado.
 *
 * La aplicación no trae música real (derechos). Para que el tocadiscos suene
 * nada más abrirlo, se sintetizan pistas cortas con Web Audio
 * (OfflineAudioContext) y se guardan como WAV en el almacén de blobs. Son
 * melodías sencillas y deterministas a partir de una semilla.
 *
 * CONTRATO: el WAV es MONO a 32 000 Hz, PCM 16 bit (64 kB/s), para que la
 * colección de demostración completa quepa en ~25 MB; la biblioteca lo
 * remuestrea al decodificar. `encodeWav` escribe tantos canales como tenga
 * el buffer. Si `OfflineAudioContext` no existe (tests), `generateDemoTrack`
 * rechaza con un Error claro y el llamador crea la pista sin audio.
 */
export interface DemoTrackSpec {
  seed: number;
  /** Entre 20 y 40 s en la demo. */
  durationSec: number;
  bpm: number;
  /** Escala en semitonos desde la tónica, p. ej. [0,2,4,7,9] (pentatónica mayor). */
  scale: number[];
  rootHz: number;
  /** Timbre general. */
  voice: 'piano' | 'organ' | 'bass-lead' | 'bell';
}

export const DEMO_SAMPLE_RATE = 32000;

/** Genera un WAV mono (PCM 16 bit, 32 kHz) con la pista descrita. */
export async function generateDemoTrack(_spec: DemoTrackSpec): Promise<Blob> {
  throw new Error('generateDemoTrack: no implementado todavía');
}

/** Codifica un AudioBuffer (o un objeto equivalente) como WAV PCM 16 bit. */
export function encodeWav(_buffer: {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
}): Blob {
  throw new Error('encodeWav: no implementado todavía');
}
