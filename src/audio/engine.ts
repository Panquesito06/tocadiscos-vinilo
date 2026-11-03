/**
 * Motor de audio del tocadiscos (Web Audio + AudioWorklet).
 *
 * CONTRATO (lo implementa el módulo de audio):
 *  - `init()` es idempotente (llamadas repetidas comparten la misma
 *    promesa o reanudan el contexto si quedó suspendido). Debe invocarse
 *    dentro de un gesto del usuario (pointerup / keydown): crea el
 *    AudioContext con `{ sampleRate: AUDIO_SAMPLE_RATE }` y llama a
 *    `resume()` DE FORMA SÍNCRONA en la misma pila del gesto, y solo
 *    después hace `await` de `audioWorklet.addModule(workletUrl(nombre))`,
 *    donde `workletUrl(n) = new URL(`${BASE_URL}worklets/${n}.js`, document.baseURI).href`
 *    (BASE_URL = `import.meta.env.BASE_URL`, con '/' final garantizada;
 *    nunca una ruta absoluta `/worklets/...`, porque la build usa
 *    `base: './'`). Escucha
 *    `statechange` y vuelve a reanudar cuando el contexto se interrumpe.
 *    `ready` es true cuando el contexto está `running` y los worklets
 *    cargados. Si `context.audioWorklet` no existe (contexto no seguro:
 *    http en la red local), rechaza con un Error en español que diga qué
 *    pasó y qué hacer ("El sonido necesita https o localhost").
 *  - `loadSide()` recibe la descripción de una cara: cada pista trae su
 *    duración y una función `load()` que decodifica bajo demanda (las pistas
 *    se cargan en el worklet solo cuando la aguja se acerca, como ventana
 *    actual ± 1, para no tener en memoria una cara entera descodificada).
 *    La línea de tiempo es: pista, silencio de `gapSec`, pista…; la longitud
 *    de cada hueco de pista es EXACTAMENTE `durationSec` (la misma que usa
 *    core/geometry): si el audio decodificado es más largo se trunca, si es
 *    más corto el resto es silencio. `getDurationSec()` coincide con
 *    `sideDurationSec(side, gap)`. Las pistas cuya `load()` devuelve null
 *    suenan como silencio (solo ruido de superficie).
 *  - La posición se acota a [−LEAD_IN_SEC, duración + LEAD_OUT_SEC]
 *    (constantes de core/geometry): la parte negativa es el surco de
 *    entrada y la final el surco de salida, ambos silencio con efectos.
 *    Hacia atrás se detiene en el mínimo y hacia delante en el máximo (el
 *    disco sigue girando, el programa no avanza). `onEnd()` se emite una
 *    vez cada vez que la posición cruza la duración hacia delante; volver
 *    por debajo de la duración vuelve a armarlo.
 *  - `setRate()` fija el multiplicador de velocidad respecto a la nominal:
 *    1 = nominal, 0 = parado, negativo = hacia atrás (scratch). Es un
 *    AudioParam a-rate del worklet; `setRate(v)` usa
 *    `setTargetAtTime(v, currentTime, 0.02)` para evitar escalones de tono.
 *    El worklet lee con interpolación lineal y avanza por muestra
 *    `rate × (pista.sampleRate / context.sampleRate) × (1 + wobbleDepth·sin(2π·wobbleHz·t))`.
 *    El motor NO aplica el pitch ni el selector por su cuenta: la aplicación
 *    ya le pasa rpmReal / rpmNominalDelDisco.
 *  - Posición: el worklet envía `{sec, contextTime, seq}` ~20 veces por
 *    segundo; `seekSec()` incrementa `seq` y los mensajes con `seq` anterior
 *    se ignoran; `getPositionSec()` devuelve la última posición extrapolada
 *    con el rate actual y acotada.
 *  - `setStylus(true)` apoya la aguja: suena el programa más los efectos
 *    (crepitar, siseo, clics, bamboleo). Al apoyar/levantar se oye un golpe
 *    sordo breve. Con la aguja levantada no suena nada salvo el zumbido del
 *    motor si está en marcha (muy bajo). La posición sigue avanzando con la
 *    aguja levantada (el disco gira igualmente).
 */
import type { EngineEffects } from '../core/physics';

/** Frecuencia de muestreo del contexto y de toda la decodificación. */
export const AUDIO_SAMPLE_RATE = 48000;

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
