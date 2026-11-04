/**
 * Protocolo de mensajes entre el hilo principal y los procesadores de
 * AudioWorklet (`public/worklets/player-processor.js` y
 * `public/worklets/surface-processor.js`).
 *
 * Los worklets son JavaScript plano sin imports, así que no pueden leer este
 * archivo: las formas y las constantes de aquí se repiten allí a mano y
 * deben mantenerse idénticas.
 */
import type { EngineEffects } from '../core/physics';

/** Nombre registrado del procesador que reproduce el programa musical. */
export const PLAYER_PROCESSOR = 'vinyl-player';
/** Nombre registrado del procesador del ruido de superficie. */
export const SURFACE_PROCESSOR = 'vinyl-surface';

/** Cada cuánto envía el reproductor su posición (segundos). */
export const POSITION_REPORT_SEC = 0.05;
/** Con menos de esto hasta la siguiente pista, el reproductor pide cargarla. */
export const PRELOAD_AHEAD_SEC = 20;
/** Duración del fundido que aplica un seek para no hacer clic. */
export const SEEK_FADE_SEC = 0.005;

// ---------------------------------------------------------------------------
// Reproductor ('vinyl-player')
// ---------------------------------------------------------------------------

/** Hueco de una pista en la línea de tiempo de la cara. */
export interface TimelineTrack {
  startSec: number;
  /** Longitud EXACTA del hueco (la misma que usa core/geometry). */
  durationSec: number;
}

/** Línea de tiempo completa de una cara. La posición se acota a [−leadInSec, totalSec + leadOutSec]. */
export interface TimelineMessage {
  type: 'timeline';
  tracks: TimelineTrack[];
  gapSec: number;
  totalSec: number;
  leadInSec: number;
  leadOutSec: number;
}

/** Audio de una pista. Los Int16Array se TRANSFIEREN (el emisor debe enviar copias). `length: 0` marca una pista sin audio. */
export interface TrackMessage {
  type: 'track';
  index: number;
  sampleRate: number;
  channels: Int16Array[];
  length: number;
}

export interface UnloadTrackMessage {
  type: 'unload-track';
  index: number;
}

export interface SeekMessage {
  type: 'seek';
  sec: number;
  /** Número de secuencia: las posiciones con `seq` anterior se descartan. */
  seq: number;
}

export interface StylusMessage {
  type: 'stylus';
  down: boolean;
}

export interface PlayerEffectsMessage {
  type: 'effects';
  wobbleDepth: number;
  wobbleHz: number;
}

export interface ResetMessage {
  type: 'reset';
}

export type PlayerInMessage =
  | TimelineMessage
  | TrackMessage
  | UnloadTrackMessage
  | SeekMessage
  | StylusMessage
  | PlayerEffectsMessage
  | ResetMessage;

/** Posición del cabezal en `contextTime` (segundos del AudioContext). */
export interface PositionMessage {
  type: 'position';
  sec: number;
  contextTime: number;
  seq: number;
}

/** La posición ha cruzado `totalSec` hacia delante (una vez por cruce). */
export interface EndMessage {
  type: 'end';
}

/** El cabezal necesita la pista `index` (está en ella o a punto de entrar). */
export interface NeedMessage {
  type: 'need';
  index: number;
}

export type PlayerOutMessage = PositionMessage | EndMessage | NeedMessage;

// ---------------------------------------------------------------------------
// Ruido de superficie ('vinyl-surface')
// ---------------------------------------------------------------------------

export interface SurfaceEffectsMessage extends EngineEffects {
  type: 'effects';
}

/** Golpe sordo breve al apoyar o levantar la aguja. */
export interface ThumpMessage {
  type: 'thump';
}

/** Velocidad relativa a la nominal (valor absoluto): atenúa el siseo cuando el plato va despacio o parado. */
export interface SpeedMessage {
  type: 'speed';
  factor: number;
}

export type SurfaceInMessage = SurfaceEffectsMessage | StylusMessage | ThumpMessage | SpeedMessage;
