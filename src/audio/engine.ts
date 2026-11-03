/**
 * Motor de audio del tocadiscos (Web Audio + AudioWorklet).
 *
 * CONTRATO (lo implementa el módulo de audio):
 *  - `init()` crea el AudioContext y carga los worklets de
 *    `public/worklets/`. Debe llamarse tras un gesto del usuario; si el
 *    contexto queda suspendido, `init()` lo reanuda.
 *  - `loadSide()` recibe la descripción de una cara: cada pista trae su
 *    duración y una función `load()` que decodifica bajo demanda (las pistas
 *    se cargan en el worklet solo cuando la aguja se acerca, como ventana
 *    actual ± 1, para no tener en memoria una cara entera descodificada).
 *    El motor construye una línea de tiempo continua: pista, silencio de
 *    `gapSec`, pista… Las pistas cuya `load()` devuelve null suenan como
 *    silencio (solo ruido de superficie).
 *  - `setRate()` fija el multiplicador de velocidad respecto a la nominal:
 *    1 = velocidad nominal, 0 = parado, negativo = hacia atrás (scratch).
 *    El worklet lee las muestras con interpolación lineal a esa velocidad,
 *    de modo que el tono cambia con la velocidad, como en un tocadiscos real.
 *    El motor NO aplica el pitch ni el selector por su cuenta: la aplicación
 *    ya le pasa rpmReal / rpmNominalDelDisco.
 *  - `setStylus(true)` apoya la aguja: suena el programa más los efectos
 *    (crepitar, siseo, clics, bamboleo). Al apoyar/levantar se oye un golpe
 *    sordo breve. Con la aguja levantada no suena nada salvo el zumbido del
 *    motor si está en marcha (muy bajo). La posición sigue avanzando con la
 *    aguja levantada (el disco gira igualmente).
 *  - `onPosition()` recibe la posición (s) ~20 veces por segundo.
 *  - `onEnd()` se dispara una vez por carga cuando la posición alcanza la
 *    duración total.
 */
import type { EngineEffects } from '../core/physics';

/** Pista decodificada: PCM entero de 16 bits por canal (ahorra la mitad de memoria frente a Float32). */
export interface DecodedTrack {
  sampleRate: number;
  durationSec: number;
  channels: Int16Array[];
}

export interface SideTrackSource {
  durationSec: number;
  /** Decodifica la pista bajo demanda; null si no tiene audio o no se puede decodificar. */
  load: () => Promise<DecodedTrack | null>;
}

export interface SideAudioSource {
  tracks: SideTrackSource[];
  gapSec: number;
}

export interface AudioEngine {
  readonly ready: boolean;
  init(): Promise<void>;
  loadSide(source: SideAudioSource): Promise<void>;
  unload(): void;
  setRate(rate: number): void;
  setStylus(inGroove: boolean): void;
  seekSec(t: number): void;
  getPositionSec(): number;
  /** Duración total de la cara cargada (0 si no hay). */
  getDurationSec(): number;
  setEffects(fx: EngineEffects): void;
  setVolume(v: number): void;
  onPosition(cb: (sec: number) => void): () => void;
  onEnd(cb: () => void): () => void;
  /** Para pruebas y depuración. */
  getContext(): AudioContext | null;
  destroy(): void;
}

export function createAudioEngine(): AudioEngine {
  throw new Error('createAudioEngine: no implementado todavía');
}
