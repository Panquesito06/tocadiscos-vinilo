/**
 * Motor de audio del tocadiscos (Web Audio + AudioWorklet).
 *
 * CONTRATO (lo implementa el módulo de audio):
 *  - `init()` crea el AudioContext y carga los worklets de
 *    `public/worklets/`. Debe llamarse tras un gesto del usuario; si el
 *    contexto queda suspendido, `init()` lo reanuda.
 *  - `loadSide()` recibe las canciones decodificadas de una cara. El motor
 *    construye una línea de tiempo continua: canción, silencio de `gapSec`,
 *    canción… Las canciones sin buffer suenan como silencio (solo ruido de
 *    superficie).
 *  - `setRate()` fija el multiplicador de velocidad respecto a la nominal:
 *    1 = velocidad nominal, 0 = parado, negativo = hacia atrás (scratch).
 *    El worklet lee el buffer con interpolación lineal a esa velocidad, de
 *    modo que el tono cambia con la velocidad, como en un tocadiscos real.
 *  - `setStylus(true)` apoya la aguja: suena el programa más los efectos
 *    (crepitar, siseo, clics, bamboleo). Al apoyar/levantar se oye un golpe
 *    sordo breve. Con la aguja levantada no suena nada salvo el zumbido del
 *    motor si está en marcha (muy bajo).
 *  - `onPosition()` recibe la posición (s) ~20 veces por segundo.
 *  - `onEnd()` se dispara cuando la posición supera la duración total.
 */
import type { EngineEffects } from '../core/physics';

export interface SideTrackSource {
  durationSec: number;
  buffer: AudioBuffer | null;
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
