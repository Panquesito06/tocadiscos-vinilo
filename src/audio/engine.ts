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
 *
 * Implementación: el motor mantiene en el worklet solo la pista actual y
 * sus vecinas (ventana ±1, `tracksToKeep`). Un único bucle de carga
 * decodifica de una en una, por prioridad (actual, siguiente, anterior), y
 * espera ~100 ms tras cargar una cara o mover la aguja de pista para no
 * decodificar pistas por las que el brazo solo pasa de largo. Sin contexto
 * (antes de `init()`) todas las llamadas son inofensivas y
 * `getPositionSec()` devuelve la última posición pedida con `seekSec()`.
 */
import { Emitter } from '../core/events';
import { SILENT_EFFECTS, type EngineEffects } from '../core/physics';
import {
  PLAYER_PROCESSOR,
  SURFACE_PROCESSOR,
  type PlayerInMessage,
  type PlayerOutMessage,
  type SurfaceInMessage,
  type TrackMessage,
} from './protocol';
import { buildTimeline, clampToTimeline, trackIndexAt, tracksToKeep, type Timeline } from './timeline';
import { workletUrl } from './worklet-url';

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

/** Mensaje de error cuando no hay AudioWorklet (contexto no seguro). */
export const INSECURE_CONTEXT_MESSAGE =
  'El sonido necesita https o localhost: el navegador no permite AudioWorklet en esta dirección.';

/** Límite del multiplicador de velocidad (coincide con el AudioParam del worklet). */
export const MAX_RATE = 8;
/** Constante de tiempo del suavizado de `rate` y del volumen. */
const SMOOTHING_SEC = 0.02;
/** Espera antes de decodificar tras cargar una cara o cambiar de pista con un seek. */
const LOAD_SETTLE_MS = 100;
/** Paso de cuantización de la velocidad que se envía al ruido de superficie. */
const SPEED_STEP = 0.05;

interface AudioGlobals {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
  AudioWorkletNode?: typeof AudioWorkletNode;
}

interface LastPosition {
  sec: number;
  contextTime: number;
  seq: number;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeEffects(fx: EngineEffects): EngineEffects {
  return {
    crackleRate: Math.max(0, finiteOr(fx.crackleRate, 0)),
    crackleGain: clamp(finiteOr(fx.crackleGain, 0), 0, 1),
    hissGain: clamp(finiteOr(fx.hissGain, 0), 0, 1),
    rumbleGain: clamp(finiteOr(fx.rumbleGain, 0), 0, 1),
    wobbleDepth: clamp(finiteOr(fx.wobbleDepth, 0), 0, 0.5),
    wobbleHz: Math.max(0, finiteOr(fx.wobbleHz, 0)),
    clickRate: Math.max(0, finiteOr(fx.clickRate, 0)),
    clickGain: clamp(finiteOr(fx.clickGain, 0), 0, 1),
  };
}

class TurntableAudioEngine implements AudioEngine {
  private context: AudioContext | null = null;
  private initPromise: Promise<void> | null = null;
  private permanentError: Error | null = null;
  /** Cambia en cada init/destroy: una inicialización antigua no toca el estado nuevo. */
  private epoch = 0;
  private workletsLoaded = false;
  private player: AudioWorkletNode | null = null;
  private surface: AudioWorkletNode | null = null;
  private rateParam: AudioParam | null = null;
  private master: GainNode | null = null;
  private graph: AudioNode[] = [];

  private source: SideAudioSource | null = null;
  private timeline: Timeline | null = null;
  /** Cambia en cada loadSide/unload: una decodificación en curso de otra cara se descarta. */
  private generation = 0;
  private wanted = new Set<number>();
  private loaded = new Set<number>();
  private loaderRunning = false;
  private settleUntil = 0;
  private windowCenter = -1;

  private seq = 0;
  private requestedSec = 0;
  private lastPos: LastPosition = { sec: 0, contextTime: 0, seq: 0 };
  private rate = 0;
  private speedSent = -1;
  private stylusDown = false;
  private effects: EngineEffects = { ...SILENT_EFFECTS };
  private volume = 1;
  private readonly events = new Emitter<{ position: number; end: undefined }>();

  get ready(): boolean {
    return this.workletsLoaded && this.context !== null && this.context.state === 'running';
  }

  // -------------------------------------------------------------------------
  // Inicialización
  // -------------------------------------------------------------------------

  init(): Promise<void> {
    if (this.initPromise) {
      this.resumeIfNeeded();
      return this.initPromise;
    }
    const promise = this.start();
    this.initPromise = promise;
    promise.catch(() => {
      // Un fallo transitorio (p. ej. no se pudo descargar un worklet) permite reintentar.
      if (this.initPromise === promise && !this.permanentError) this.initPromise = null;
    });
    return promise;
  }

  private async start(): Promise<void> {
    const epoch = ++this.epoch;
    const context = this.createContext();
    this.context = context;
    // En la misma pila del gesto del usuario, antes de cualquier await.
    void context.resume().catch(() => undefined);
    if (!context.audioWorklet) {
      this.context = null;
      void context.close().catch(() => undefined);
      throw this.permanent(new Error(INSECURE_CONTEXT_MESSAGE));
    }
    context.addEventListener('statechange', this.onStateChange);
    try {
      await context.audioWorklet.addModule(workletUrl('player-processor'));
      await context.audioWorklet.addModule(workletUrl('surface-processor'));
    } catch (error) {
      if (epoch === this.epoch) this.discardContext();
      throw new Error(`No se pudieron cargar los procesadores de sonido (${describeError(error)}). Recarga la página.`);
    }
    if (epoch !== this.epoch) return; // destroy() durante la carga
    this.buildGraph(context);
    this.workletsLoaded = true;
    this.applyState();
  }

  private createContext(): AudioContext {
    const globals = globalThis as unknown as AudioGlobals;
    const Ctor = globals.AudioContext ?? globals.webkitAudioContext;
    if (!Ctor) throw this.permanent(new Error('Este navegador no tiene Web Audio: el tocadiscos no puede sonar.'));
    try {
      return new Ctor({ sampleRate: AUDIO_SAMPLE_RATE });
    } catch {
      // Algún navegador antiguo no admite elegir la frecuencia; el worklet remuestrea igualmente.
      return new Ctor();
    }
  }

  private permanent(error: Error): Error {
    this.permanentError = error;
    return error;
  }

  private buildGraph(context: AudioContext): void {
    const NodeCtor = (globalThis as unknown as AudioGlobals).AudioWorkletNode;
    if (!NodeCtor) throw this.permanent(new Error(INSECURE_CONTEXT_MESSAGE));
    const options: AudioWorkletNodeOptions = { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] };
    const player = new NodeCtor(context, PLAYER_PROCESSOR, options);
    const surface = new NodeCtor(context, SURFACE_PROCESSOR, options);
    const programGain = context.createGain();
    const effectsGain = context.createGain();
    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.ratio.value = 3;
    compressor.knee.value = 12;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.2;
    master.gain.value = this.volume;

    player.connect(programGain);
    surface.connect(effectsGain);
    programGain.connect(master);
    effectsGain.connect(master);
    master.connect(compressor);
    compressor.connect(context.destination);

    player.port.onmessage = (event: MessageEvent<PlayerOutMessage>) => this.onPlayerMessage(event.data);
    player.onprocessorerror = () => console.error('El procesador de reproducción del tocadiscos ha fallado.');
    surface.onprocessorerror = () => console.error('El procesador de ruido de superficie ha fallado.');

    this.player = player;
    this.surface = surface;
    this.rateParam = player.parameters.get('rate') ?? null;
    this.master = master;
    this.graph = [player, surface, programGain, effectsGain, master, compressor];
  }

  /** Vuelca en los worklets recién creados el estado que la app ya había pedido. */
  private applyState(): void {
    this.postPlayer({ type: 'stylus', down: this.stylusDown });
    this.postSurface({ type: 'stylus', down: this.stylusDown });
    this.postEffects();
    if (this.rateParam) this.rateParam.value = this.rate;
    this.speedSent = -1;
    this.sendSpeed();
    if (this.timeline) this.installTimeline();
  }

  private resumeIfNeeded(): void {
    const context = this.context;
    if (!context) return;
    const state = context.state as string;
    if (state === 'suspended' || state === 'interrupted') void context.resume().catch(() => undefined);
  }

  private readonly onStateChange = (): void => {
    this.resumeIfNeeded();
  };

  private discardContext(): void {
    const context = this.context;
    if (context) {
      context.removeEventListener('statechange', this.onStateChange);
      void context.close().catch(() => undefined);
    }
    this.context = null;
    this.workletsLoaded = false;
    this.player = null;
    this.surface = null;
    this.rateParam = null;
    this.master = null;
    this.graph = [];
  }

  // -------------------------------------------------------------------------
  // Mensajes con los worklets
  // -------------------------------------------------------------------------

  private postPlayer(message: PlayerInMessage): void {
    this.player?.port.postMessage(message);
  }

  private postSurface(message: SurfaceInMessage): void {
    this.surface?.port.postMessage(message);
  }

  private postEffects(): void {
    this.postPlayer({ type: 'effects', wobbleDepth: this.effects.wobbleDepth, wobbleHz: this.effects.wobbleHz });
    this.postSurface({ type: 'effects', ...this.effects });
  }

  private sendSpeed(): void {
    const factor = Math.round(Math.min(1, Math.abs(this.rate)) / SPEED_STEP) * SPEED_STEP;
    if (factor === this.speedSent) return;
    this.speedSent = factor;
    this.postSurface({ type: 'speed', factor });
  }

  private onPlayerMessage(message: PlayerOutMessage): void {
    switch (message.type) {
      case 'position':
        if (message.seq !== this.seq) return; // anterior a un seek: se ignora
        this.lastPos = { sec: message.sec, contextTime: message.contextTime, seq: message.seq };
        this.events.emit('position', message.sec);
        if (this.timeline && trackIndexAt(this.timeline, message.sec) !== this.windowCenter) this.reconcile();
        break;
      case 'end':
        this.events.emit('end', undefined);
        break;
      case 'need':
        this.reconcile(message.index);
        break;
      default:
        break;
    }
  }

  private now(): number {
    return this.context ? this.context.currentTime : 0;
  }

  // -------------------------------------------------------------------------
  // Cara cargada y ventana de pistas
  // -------------------------------------------------------------------------

  async loadSide(source: SideAudioSource): Promise<void> {
    this.generation++;
    this.source = source;
    this.timeline = buildTimeline(source);
    this.wanted.clear();
    this.loaded.clear();
    this.windowCenter = -1;
    if (this.player) this.installTimeline();
  }

  /** Envía la línea de tiempo y recoloca el cabezal en la última posición pedida. */
  private installTimeline(): void {
    const timeline = this.timeline;
    if (!timeline) return;
    this.postPlayer({
      type: 'timeline',
      tracks: timeline.tracks,
      gapSec: timeline.gapSec,
      totalSec: timeline.totalSec,
      leadInSec: timeline.leadInSec,
      leadOutSec: timeline.leadOutSec,
    });
    this.seq++;
    const sec = clampToTimeline(timeline, this.requestedSec);
    this.lastPos = { sec, contextTime: this.now(), seq: this.seq };
    this.postPlayer({ type: 'seek', sec, seq: this.seq });
    this.settleUntil = performance.now() + LOAD_SETTLE_MS;
    this.windowCenter = -1;
    this.reconcile();
  }

  unload(): void {
    this.generation++;
    this.source = null;
    this.timeline = null;
    this.wanted.clear();
    this.loaded.clear();
    this.windowCenter = -1;
    // Sin seek nuevo, las posiciones que siga enviando el worklet llevan un seq antiguo y se ignoran.
    this.seq++;
    this.lastPos = { sec: this.requestedSec, contextTime: this.now(), seq: this.seq };
    this.postPlayer({ type: 'reset' });
  }

  getDurationSec(): number {
    return this.timeline ? this.timeline.totalSec : 0;
  }

  /**
   * Recalcula la ventana de pistas (actual ± 1) alrededor de la posición,
   * descarga del worklet las que sobran y arranca la carga de las que faltan.
   * `needIndex` es la pista que el worklet ha pedido explícitamente.
   */
  private reconcile(needIndex?: number): void {
    const timeline = this.timeline;
    if (!timeline || !this.source || !this.player) return;
    const position = this.getPositionSec();
    let center = trackIndexAt(timeline, position);
    let keep = tracksToKeep(timeline, position);
    if (needIndex !== undefined) {
      const needed = timeline.tracks[needIndex];
      if (needed && !keep.includes(needIndex)) {
        center = needIndex;
        keep = tracksToKeep(timeline, needed.startSec);
      }
    }
    this.windowCenter = center;
    this.wanted = new Set(keep);
    for (const index of Array.from(this.loaded)) {
      if (this.wanted.has(index)) continue;
      this.loaded.delete(index);
      this.postPlayer({ type: 'unload-track', index });
    }
    void this.runLoader();
  }

  /** Siguiente pista que falta, por prioridad: la actual, luego las siguientes, luego las anteriores. */
  private pickNextToLoad(): number | null {
    if (!this.timeline || !this.source) return null;
    const center = this.windowCenter;
    const priority = (index: number): number => {
      if (index === center) return 0;
      return index > center ? index - center : 10 + (center - index);
    };
    let best: number | null = null;
    for (const index of this.wanted) {
      if (this.loaded.has(index)) continue;
      if (best === null || priority(index) < priority(best)) best = index;
    }
    return best;
  }

  private async runLoader(): Promise<void> {
    if (this.loaderRunning) return;
    this.loaderRunning = true;
    try {
      for (;;) {
        const wait = this.settleUntil - performance.now();
        if (wait > 0) {
          await sleep(wait);
          continue;
        }
        const index = this.pickNextToLoad();
        if (index === null) return;
        const generation = this.generation;
        const source = this.source;
        if (!source) return;
        const decoded = await this.loadTrack(source, index);
        if (generation !== this.generation) continue; // otra cara: se vuelve a evaluar
        if (!this.wanted.has(index)) continue; // el cabezal se fue mientras decodificaba
        this.postTrack(index, decoded);
        this.loaded.add(index);
      }
    } finally {
      this.loaderRunning = false;
    }
  }

  private async loadTrack(source: SideAudioSource, index: number): Promise<DecodedTrack | null> {
    const track = source.tracks[index];
    if (!track) return null;
    try {
      return await track.load();
    } catch (error) {
      console.warn(`No se pudo cargar la pista ${index + 1}: ${describeError(error)}`);
      return null;
    }
  }

  /** Envía la pista al worklet con COPIAS transferidas, para que la biblioteca conserve su caché. */
  private postTrack(index: number, decoded: DecodedTrack | null): void {
    const player = this.player;
    if (!player) return;
    const first = decoded?.channels[0];
    if (!decoded || !first || first.length === 0) {
      const silent: TrackMessage = { type: 'track', index, sampleRate: AUDIO_SAMPLE_RATE, channels: [], length: 0 };
      player.port.postMessage(silent);
      return;
    }
    const copies = decoded.channels.slice(0, 2).map((channel) => channel.slice());
    const length = copies.reduce((min, channel) => Math.min(min, channel.length), Number.POSITIVE_INFINITY);
    const message: TrackMessage = {
      type: 'track',
      index,
      sampleRate: decoded.sampleRate > 0 ? decoded.sampleRate : AUDIO_SAMPLE_RATE,
      channels: copies,
      length,
    };
    player.port.postMessage(
      message,
      copies.map((channel) => channel.buffer as ArrayBuffer),
    );
  }

  // -------------------------------------------------------------------------
  // Transporte
  // -------------------------------------------------------------------------

  setRate(rate: number): void {
    const next = clamp(finiteOr(rate, 0), -MAX_RATE, MAX_RATE);
    if (next === this.rate) return;
    const context = this.context;
    if (context && this.workletsLoaded && this.timeline) {
      // Consolida el avance con el rate anterior antes de cambiarlo.
      this.lastPos = { sec: this.getPositionSec(), contextTime: context.currentTime, seq: this.lastPos.seq };
    }
    this.rate = next;
    if (this.rateParam && context) this.rateParam.setTargetAtTime(next, context.currentTime, SMOOTHING_SEC);
    this.sendSpeed();
  }

  setStylus(inGroove: boolean): void {
    const down = !!inGroove;
    if (down === this.stylusDown) return;
    this.stylusDown = down;
    if (!this.player) return;
    this.postPlayer({ type: 'stylus', down });
    this.postSurface({ type: 'stylus', down });
    this.postSurface({ type: 'thump' });
  }

  seekSec(t: number): void {
    const sec = finiteOr(t, 0);
    this.requestedSec = sec;
    const clamped = clampToTimeline(this.timeline, sec);
    this.seq++;
    this.lastPos = { sec: clamped, contextTime: this.now(), seq: this.seq };
    if (!this.player || !this.timeline) return;
    this.postPlayer({ type: 'seek', sec: clamped, seq: this.seq });
    if (trackIndexAt(this.timeline, clamped) !== this.windowCenter) {
      this.settleUntil = performance.now() + LOAD_SETTLE_MS;
      this.reconcile();
    }
  }

  getPositionSec(): number {
    const context = this.context;
    if (!context || !this.workletsLoaded || !this.timeline) return clampToTimeline(this.timeline, this.requestedSec);
    const elapsed = Math.max(0, context.currentTime - this.lastPos.contextTime);
    return clampToTimeline(this.timeline, this.lastPos.sec + this.rate * elapsed);
  }

  setEffects(fx: EngineEffects): void {
    this.effects = sanitizeEffects(fx);
    if (this.player) this.postEffects();
  }

  setVolume(v: number): void {
    this.volume = clamp(finiteOr(v, 1), 0, 1);
    const context = this.context;
    if (this.master && context) this.master.gain.setTargetAtTime(this.volume, context.currentTime, SMOOTHING_SEC);
  }

  onPosition(cb: (sec: number) => void): () => void {
    return this.events.on('position', cb);
  }

  onEnd(cb: () => void): () => void {
    return this.events.on('end', () => cb());
  }

  getContext(): AudioContext | null {
    return this.context;
  }

  destroy(): void {
    this.epoch++;
    this.generation++;
    this.source = null;
    this.timeline = null;
    this.wanted.clear();
    this.loaded.clear();
    this.windowCenter = -1;
    if (this.player) {
      this.player.port.onmessage = null;
      this.player.port.close();
    }
    this.surface?.port.close();
    for (const node of this.graph) node.disconnect();
    this.discardContext();
    this.initPromise = null;
    this.permanentError = null;
    this.speedSent = -1;
    this.events.clear();
  }
}

export function createAudioEngine(): AudioEngine {
  return new TurntableAudioEngine();
}
