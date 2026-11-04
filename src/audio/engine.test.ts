/**
 * Pruebas del motor con un Web Audio simulado (happy-dom no tiene AudioContext).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEAD_IN_SEC, LEAD_OUT_SEC } from '../core/geometry';
import { SILENT_EFFECTS } from '../core/physics';
import { AUDIO_SAMPLE_RATE, INSECURE_CONTEXT_MESSAGE, createAudioEngine, type DecodedTrack, type SideAudioSource } from './engine';
import type { PlayerInMessage, PlayerOutMessage, SurfaceInMessage } from './protocol';

// ---------------------------------------------------------------------------
// Web Audio simulado
// ---------------------------------------------------------------------------

class FakeParam {
  value = 0;
  readonly targets: { value: number; time: number; tc: number }[] = [];
  setTargetAtTime(value: number, time: number, tc: number): this {
    this.targets.push({ value, time, tc });
    return this;
  }
}

class FakeNode {
  readonly connections: FakeNode[] = [];
  readonly gain = new FakeParam();
  readonly threshold = new FakeParam();
  readonly ratio = new FakeParam();
  readonly knee = new FakeParam();
  readonly attack = new FakeParam();
  readonly release = new FakeParam();
  disconnected = false;
  connect(node: FakeNode): FakeNode {
    this.connections.push(node);
    return node;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

class FakePort {
  readonly posted: { message: PlayerInMessage | SurfaceInMessage; transfer: ArrayBuffer[] | undefined }[] = [];
  onmessage: ((event: { data: PlayerOutMessage }) => void) | null = null;
  closed = false;
  postMessage(message: PlayerInMessage | SurfaceInMessage, transfer?: ArrayBuffer[]): void {
    this.posted.push({ message, transfer });
  }
  close(): void {
    this.closed = true;
  }
}

const workletNodes: FakeWorkletNode[] = [];

class FakeWorkletNode extends FakeNode {
  readonly port = new FakePort();
  readonly parameters = new Map<string, FakeParam>([['rate', new FakeParam()]]);
  onprocessorerror: (() => void) | null = null;
  constructor(
    readonly context: FakeAudioContext,
    readonly name: string,
    readonly options: unknown,
  ) {
    super();
    workletNodes.push(this);
  }
}

const contexts: FakeAudioContext[] = [];
let addModuleFails = false;
let withWorklet = true;

class FakeAudioContext {
  state = 'suspended';
  currentTime = 0;
  readonly destination = new FakeNode();
  readonly options: unknown;
  readonly resumeCalls: number[] = [];
  readonly modules: string[] = [];
  closed = false;
  readonly listeners = new Map<string, Set<() => void>>();
  audioWorklet: { addModule: (url: string) => Promise<void> } | undefined;
  constructor(options?: unknown) {
    this.options = options;
    contexts.push(this);
    this.audioWorklet = withWorklet
      ? {
          addModule: async (url: string) => {
            if (addModuleFails) throw new Error('404');
            this.modules.push(url);
          },
        }
      : undefined;
  }
  get sampleRate(): number {
    return AUDIO_SAMPLE_RATE;
  }
  resume(): Promise<void> {
    this.resumeCalls.push(this.resumeCalls.length);
    this.state = 'running';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closed = true;
    this.state = 'closed';
    return Promise.resolve();
  }
  createGain(): FakeNode {
    return new FakeNode();
  }
  createDynamicsCompressor(): FakeNode {
    return new FakeNode();
  }
  addEventListener(type: string, fn: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  fire(type: string): void {
    for (const fn of Array.from(this.listeners.get(type) ?? [])) fn();
  }
}

interface AudioGlobals {
  AudioContext?: unknown;
  AudioWorkletNode?: unknown;
}

const globals = globalThis as AudioGlobals;

function installFakes(): void {
  globals.AudioContext = FakeAudioContext;
  globals.AudioWorkletNode = FakeWorkletNode;
}

function removeFakes(): void {
  delete globals.AudioContext;
  delete globals.AudioWorkletNode;
}

function player(): FakeWorkletNode {
  const node = workletNodes.find((n) => n.name === 'vinyl-player');
  if (!node) throw new Error('sin nodo de reproducción');
  return node;
}

function surface(): FakeWorkletNode {
  const node = workletNodes.find((n) => n.name === 'vinyl-surface');
  if (!node) throw new Error('sin nodo de superficie');
  return node;
}

function playerMessages(): PlayerInMessage[] {
  return player().port.posted.map((p) => p.message as PlayerInMessage);
}

function ofType<T extends PlayerInMessage['type']>(type: T): Extract<PlayerInMessage, { type: T }>[] {
  return playerMessages().filter((m): m is Extract<PlayerInMessage, { type: T }> => m.type === type);
}

function fromWorklet(message: PlayerOutMessage): void {
  player().port.onmessage?.({ data: message });
}

function decodedTrack(seconds: number, value = 1000): DecodedTrack {
  const channel = new Int16Array(Math.round(seconds * AUDIO_SAMPLE_RATE)).fill(value);
  return { sampleRate: AUDIO_SAMPLE_RATE, durationSec: seconds, channels: [channel, channel.slice()] };
}

/** Cara de pruebas: cada `load` cuenta llamadas y puede bloquearse. */
function makeSource(durations: number[], gapSec = 2) {
  const loads: number[] = [];
  const pending = new Map<number, (track: DecodedTrack | null) => void>();
  let block = false;
  const source: SideAudioSource = {
    gapSec,
    tracks: durations.map((durationSec, index) => ({
      durationSec,
      load: () => {
        loads.push(index);
        if (!block) return Promise.resolve(index === 1 ? null : decodedTrack(0.01));
        return new Promise((resolve) => pending.set(index, resolve));
      },
    })),
  };
  return {
    source,
    loads,
    setBlocking: (value: boolean) => {
      block = value;
    },
    release: (index: number, track: DecodedTrack | null) => {
      pending.get(index)?.(track);
      pending.delete(index);
    },
  };
}

async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  contexts.length = 0;
  workletNodes.length = 0;
  addModuleFails = false;
  withWorklet = true;
  installFakes();
});

afterEach(() => {
  removeFakes();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe('sin contexto (antes de init)', () => {
  it('todas las llamadas son inofensivas y la posición es la última pedida', async () => {
    removeFakes();
    const engine = createAudioEngine();
    expect(engine.ready).toBe(false);
    expect(engine.getContext()).toBeNull();
    expect(engine.getDurationSec()).toBe(0);
    engine.setRate(1);
    engine.setStylus(true);
    engine.setEffects(SILENT_EFFECTS);
    engine.setVolume(0.5);
    engine.seekSec(12.5);
    expect(engine.getPositionSec()).toBe(12.5);
    await engine.loadSide({ tracks: [{ durationSec: 10, load: async () => null }], gapSec: 2 });
    expect(engine.getDurationSec()).toBe(10);
    expect(engine.getPositionSec()).toBe(12.5); // acotada al lead-out (10 + 4 = 14)
    engine.seekSec(99);
    expect(engine.getPositionSec()).toBe(10 + LEAD_OUT_SEC);
    engine.seekSec(-99);
    expect(engine.getPositionSec()).toBe(-LEAD_IN_SEC);
    engine.unload();
    expect(engine.getDurationSec()).toBe(0);
    expect(engine.getPositionSec()).toBe(-99);
    const offPosition = engine.onPosition(() => undefined);
    const offEnd = engine.onEnd(() => undefined);
    offPosition();
    offEnd();
    engine.destroy();
  });

  it('sin Web Audio init rechaza en español y repite la misma promesa', async () => {
    removeFakes();
    const engine = createAudioEngine();
    const p1 = engine.init();
    await expect(p1).rejects.toThrow('Web Audio');
    expect(engine.init()).toBe(p1);
  });
});

describe('init', () => {
  it('crea el contexto a 48 kHz, reanuda de forma síncrona y carga los dos worklets', async () => {
    const engine = createAudioEngine();
    const promise = engine.init();
    expect(contexts).toHaveLength(1);
    const ctx = contexts[0]!;
    expect(ctx.options).toEqual({ sampleRate: AUDIO_SAMPLE_RATE });
    expect(ctx.resumeCalls).toHaveLength(1); // antes de cualquier await
    expect(engine.init()).toBe(promise);
    await promise;
    expect(ctx.modules).toHaveLength(2);
    expect(ctx.modules[0]!.endsWith('worklets/player-processor.js')).toBe(true);
    expect(ctx.modules[1]!.endsWith('worklets/surface-processor.js')).toBe(true);
    expect(ctx.modules[0]!.startsWith(document.baseURI)).toBe(true);
    expect(engine.ready).toBe(true);
    expect(engine.getContext()).toBe(ctx);
    expect(workletNodes.map((n) => n.name)).toEqual(['vinyl-player', 'vinyl-surface']);
    expect(workletNodes[0]!.options).toEqual({ numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    // Grafo: player → ganancia → maestra → compresor → destino; surface → ganancia → maestra.
    const programGain = player().connections[0]!;
    const master = programGain.connections[0]!;
    const compressor = master.connections[0]!;
    expect(compressor.connections[0]).toBe(ctx.destination);
    expect(surface().connections[0]!.connections[0]).toBe(master);
    expect(compressor.threshold.value).toBe(-12);
    expect(compressor.ratio.value).toBe(3);
  });

  it('sin AudioWorklet rechaza explicando que hace falta https o localhost', async () => {
    withWorklet = false;
    const engine = createAudioEngine();
    const promise = engine.init();
    await expect(promise).rejects.toThrow(INSECURE_CONTEXT_MESSAGE);
    expect(contexts[0]!.closed).toBe(true);
    expect(engine.init()).toBe(promise); // error permanente: misma promesa
    expect(contexts).toHaveLength(1);
  });

  it('si falla la carga de un worklet se puede reintentar', async () => {
    addModuleFails = true;
    const engine = createAudioEngine();
    await expect(engine.init()).rejects.toThrow('procesadores de sonido');
    expect(engine.getContext()).toBeNull();
    addModuleFails = false;
    await engine.init();
    expect(engine.ready).toBe(true);
    expect(contexts).toHaveLength(2);
  });

  it('vuelve a reanudar cuando el contexto se suspende y al repetir init', async () => {
    const engine = createAudioEngine();
    await engine.init();
    const ctx = contexts[0]!;
    ctx.state = 'suspended';
    ctx.fire('statechange');
    expect(ctx.resumeCalls).toHaveLength(2);
    expect(ctx.state).toBe('running');
    ctx.state = 'interrupted';
    await engine.init();
    expect(ctx.resumeCalls).toHaveLength(3);
  });

  it('destroy durante la inicialización no deja nodos ni contexto', async () => {
    const engine = createAudioEngine();
    const promise = engine.init();
    engine.destroy();
    await promise;
    expect(engine.ready).toBe(false);
    expect(engine.getContext()).toBeNull();
    expect(contexts[0]!.closed).toBe(true);
  });
});

describe('con el motor listo', () => {
  it('aplica el estado pedido antes de init', async () => {
    const engine = createAudioEngine();
    engine.setStylus(true);
    engine.setVolume(0.4);
    engine.setRate(1.35);
    engine.setEffects({ ...SILENT_EFFECTS, wobbleDepth: 0.05, wobbleHz: 0.55, hissGain: 0.2 });
    engine.seekSec(5);
    await engine.loadSide(makeSource([30, 30]).source);
    await engine.init();
    expect(ofType('stylus')).toEqual([{ type: 'stylus', down: true }]);
    expect(ofType('effects')).toEqual([{ type: 'effects', wobbleDepth: 0.05, wobbleHz: 0.55 }]);
    expect(player().parameters.get('rate')!.value).toBe(1.35);
    const programGain = player().connections[0]!;
    expect(programGain.connections[0]!.gain.value).toBe(0.4);
    const [timeline] = ofType('timeline');
    expect(timeline).toEqual({
      type: 'timeline',
      tracks: [
        { startSec: 0, durationSec: 30 },
        { startSec: 32, durationSec: 30 },
      ],
      gapSec: 2,
      totalSec: 62,
      leadInSec: LEAD_IN_SEC,
      leadOutSec: LEAD_OUT_SEC,
    });
    // seq 1 fue el seekSec previo; instalar la línea de tiempo incrementa la secuencia otra vez.
    expect(ofType('seek')).toEqual([{ type: 'seek', sec: 5, seq: 2 }]);
    const surfaceMessages = surface().port.posted.map((p) => p.message);
    expect(surfaceMessages).toContainEqual({ type: 'speed', factor: 1 });
    expect(surfaceMessages).toContainEqual({ type: 'effects', ...SILENT_EFFECTS, wobbleDepth: 0.05, wobbleHz: 0.55, hissGain: 0.2 });
  });

  it('carga la ventana ±1 con copias transferidas y marca sin audio las pistas nulas', async () => {
    const engine = createAudioEngine();
    await engine.init();
    const made = makeSource([30, 30, 30, 30]);
    await engine.loadSide(made.source);
    expect(made.loads).toEqual([]); // espera ~100 ms por si llega un seek
    await flush(150);
    expect(made.loads).toEqual([0, 1]);
    const tracks = ofType('track');
    expect(tracks.map((t) => t.index)).toEqual([0, 1]);
    expect(tracks[0]!.channels).toHaveLength(2);
    expect(tracks[0]!.length).toBe(Math.round(0.01 * AUDIO_SAMPLE_RATE));
    expect(tracks[1]).toEqual({ type: 'track', index: 1, sampleRate: AUDIO_SAMPLE_RATE, channels: [], length: 0 });
    const posted = player().port.posted.find((p) => (p.message as PlayerInMessage).type === 'track')!;
    expect(posted.transfer).toHaveLength(2);
    expect(posted.transfer![0]).toBe(tracks[0]!.channels[0]!.buffer);
  });

  it('responde a need cargando la pista pedida y sus vecinas y descargando el resto', async () => {
    const engine = createAudioEngine();
    await engine.init();
    const made = makeSource([30, 30, 30, 30, 30]);
    await engine.loadSide(made.source);
    await flush(150);
    expect(made.loads).toEqual([0, 1]);
    fromWorklet({ type: 'need', index: 3 });
    await flush(150);
    expect(made.loads).toEqual([0, 1, 3, 4, 2]);
    expect(ofType('unload-track').map((m) => m.index).sort()).toEqual([0, 1]);
    expect(ofType('track').map((m) => m.index)).toEqual([0, 1, 3, 4, 2]);
  });

  it('la ventana sigue a las posiciones del worklet', async () => {
    const engine = createAudioEngine();
    await engine.init();
    const made = makeSource([30, 30, 30, 30]);
    await engine.loadSide(made.source);
    await flush(150);
    fromWorklet({ type: 'position', sec: 70, contextTime: 0, seq: 1 });
    await flush(10);
    expect(made.loads).toEqual([0, 1, 2, 3]);
    expect(ofType('unload-track').map((m) => m.index)).toEqual([0]);
  });

  it('un seek a otra pista reagrupa la ventana, con prioridad para la pista actual', async () => {
    const engine = createAudioEngine();
    await engine.init();
    const made = makeSource([30, 30, 30, 30, 30, 30]);
    await engine.loadSide(made.source);
    engine.seekSec(130); // pista 4 (empieza en 128)
    await flush(150);
    expect(made.loads).toEqual([4, 5, 3]);
    expect(ofType('seek').at(-1)).toEqual({ type: 'seek', sec: 130, seq: 2 });
  });

  it('descarta lo decodificado si la cara cambió mientras tanto', async () => {
    const engine = createAudioEngine();
    await engine.init();
    const made = makeSource([30, 30]);
    made.setBlocking(true);
    await engine.loadSide(made.source);
    await flush(150);
    expect(made.loads).toEqual([0]);
    const other = makeSource([10]);
    await engine.loadSide(other.source);
    made.release(0, decodedTrack(0.01));
    await flush(150);
    expect(ofType('track').map((m) => m.index)).toEqual([0]);
    expect(other.loads).toEqual([0]);
    expect(ofType('timeline')).toHaveLength(2);
    expect(engine.getDurationSec()).toBe(10);
  });

  it('extrapola la posición con el rate y descarta posiciones anteriores a un seek', async () => {
    const engine = createAudioEngine();
    await engine.init();
    const ctx = contexts[0]!;
    await engine.loadSide(makeSource([100, 100]).source);
    engine.setRate(1);
    ctx.currentTime = 10;
    fromWorklet({ type: 'position', sec: 20, contextTime: 10, seq: 1 });
    ctx.currentTime = 10.5;
    expect(engine.getPositionSec()).toBeCloseTo(20.5, 9);
    engine.setRate(-1);
    ctx.currentTime = 11;
    expect(engine.getPositionSec()).toBeCloseTo(20, 9);
    expect(player().parameters.get('rate')!.targets.at(-1)).toEqual({ value: -1, time: 10.5, tc: 0.02 });
    engine.seekSec(50);
    expect(engine.getPositionSec()).toBe(50);
    fromWorklet({ type: 'position', sec: 20.9, contextTime: 11, seq: 1 }); // anterior al seek
    expect(engine.getPositionSec()).toBe(50);
    fromWorklet({ type: 'position', sec: 50.2, contextTime: 11.2, seq: 2 });
    ctx.currentTime = 11.2;
    expect(engine.getPositionSec()).toBeCloseTo(50.2, 9);
    // Acotada y sin extrapolar hacia atrás en el tiempo.
    ctx.currentTime = 500;
    expect(engine.getPositionSec()).toBe(-LEAD_IN_SEC);
    engine.setRate(9);
    ctx.currentTime = 1000;
    expect(engine.getPositionSec()).toBe(202 + LEAD_OUT_SEC);
  });

  it('emite onPosition y onEnd desde los mensajes del worklet', async () => {
    const engine = createAudioEngine();
    await engine.init();
    await engine.loadSide(makeSource([100]).source);
    const positions: number[] = [];
    let endCount = 0;
    const offPosition = engine.onPosition((sec) => positions.push(sec));
    engine.onEnd(() => endCount++);
    fromWorklet({ type: 'position', sec: 1, contextTime: 0, seq: 1 });
    fromWorklet({ type: 'position', sec: 2, contextTime: 0, seq: 0 });
    fromWorklet({ type: 'end' });
    offPosition();
    fromWorklet({ type: 'position', sec: 3, contextTime: 0, seq: 1 });
    expect(positions).toEqual([1]);
    expect(endCount).toBe(1);
  });

  it('la aguja manda stylus a los dos worklets y un golpe sordo al cambiar', async () => {
    const engine = createAudioEngine();
    await engine.init();
    engine.setStylus(true);
    engine.setStylus(true);
    engine.setStylus(false);
    expect(ofType('stylus')).toEqual([
      { type: 'stylus', down: false },
      { type: 'stylus', down: true },
      { type: 'stylus', down: false },
    ]);
    const thumps = surface().port.posted.filter((p) => p.message.type === 'thump');
    expect(thumps).toHaveLength(2);
  });

  it('setRate acota, suaviza y cuantiza la velocidad para la superficie', async () => {
    const engine = createAudioEngine();
    await engine.init();
    const ctx = contexts[0]!;
    ctx.currentTime = 3;
    engine.setRate(20);
    engine.setRate(Number.NaN);
    engine.setRate(0.51);
    engine.setRate(0.52);
    const rate = player().parameters.get('rate')!;
    expect(rate.targets.map((t) => t.value)).toEqual([8, 0, 0.51, 0.52]);
    expect(rate.targets[0]).toEqual({ value: 8, time: 3, tc: 0.02 });
    const speeds = surface().port.posted.filter((p) => p.message.type === 'speed').map((p) => (p.message as { factor: number }).factor);
    expect(speeds).toEqual([0, 1, 0, 0.5]);
  });

  it('setVolume suaviza la ganancia maestra y setEffects sanea los valores', async () => {
    const engine = createAudioEngine();
    await engine.init();
    engine.setVolume(2);
    const master = player().connections[0]!.connections[0]!;
    expect(master.gain.targets.at(-1)!.value).toBe(1);
    engine.setEffects({ ...SILENT_EFFECTS, crackleRate: -5, crackleGain: 4, wobbleDepth: 9, wobbleHz: Number.NaN });
    expect(ofType('effects').at(-1)).toEqual({ type: 'effects', wobbleDepth: 0.5, wobbleHz: 0 });
    const fx = surface().port.posted.at(-1)!.message;
    expect(fx).toEqual({ type: 'effects', ...SILENT_EFFECTS, crackleGain: 1, wobbleDepth: 0.5 });
  });

  it('unload reinicia el worklet y destroy libera todo', async () => {
    const engine = createAudioEngine();
    await engine.init();
    await engine.loadSide(makeSource([30]).source);
    engine.unload();
    expect(ofType('reset')).toHaveLength(1);
    expect(engine.getDurationSec()).toBe(0);
    fromWorklet({ type: 'position', sec: 5, contextTime: 0, seq: 1 }); // seq antiguo: ignorado
    expect(engine.getPositionSec()).toBe(0);
    const ctx = contexts[0]!;
    engine.destroy();
    expect(ctx.closed).toBe(true);
    expect(engine.getContext()).toBeNull();
    expect(engine.ready).toBe(false);
    expect(player().port.closed).toBe(true);
    expect(player().disconnected).toBe(true);
    // Se puede volver a inicializar.
    await engine.init();
    expect(contexts).toHaveLength(2);
    expect(engine.ready).toBe(true);
  });
});
