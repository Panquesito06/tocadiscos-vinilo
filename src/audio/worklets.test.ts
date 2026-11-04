/**
 * Pruebas de los procesadores de AudioWorklet (JavaScript plano) ejecutados
 * en Node con un `AudioWorkletProcessor` y un `registerProcessor` simulados.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LEAD_IN_SEC, LEAD_OUT_SEC } from '../core/geometry';
import {
  PLAYER_PROCESSOR,
  SURFACE_PROCESSOR,
  type PlayerInMessage,
  type PlayerOutMessage,
  type SurfaceInMessage,
  type TrackMessage,
} from './protocol';

const SAMPLE_RATE = 48000;
const BLOCK = 128;

interface FakePort {
  posted: PlayerOutMessage[];
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: PlayerOutMessage): void;
}

interface Processor {
  port: FakePort;
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

type ProcessorCtor = new (options?: unknown) => Processor;

interface WorkletGlobals {
  sampleRate?: number;
  currentTime?: number;
  AudioWorkletProcessor?: unknown;
  registerProcessor?: (name: string, ctor: ProcessorCtor) => void;
}

const globals = globalThis as WorkletGlobals;
const registry = new Map<string, ProcessorCtor>();

function readWorklet(name: string): string {
  return readFileSync(resolve(process.cwd(), 'public', 'worklets', `${name}.js`), 'utf8');
}

function loadWorklets(): void {
  globals.sampleRate = SAMPLE_RATE;
  globals.currentTime = 0;
  globals.AudioWorkletProcessor = class {
    port: FakePort = {
      posted: [],
      onmessage: null,
      postMessage(message) {
        this.posted.push(message);
      },
    };
  };
  globals.registerProcessor = (name, ctor) => registry.set(name, ctor);
  new Function(readWorklet('player-processor'))();
  new Function(readWorklet('surface-processor'))();
}

function unloadWorklets(): void {
  delete globals.sampleRate;
  delete globals.currentTime;
  delete globals.AudioWorkletProcessor;
  delete globals.registerProcessor;
  registry.clear();
}

function create(name: string): Processor {
  const Ctor = registry.get(name);
  if (!Ctor) throw new Error(`no registrado: ${name}`);
  return new Ctor({});
}

function send(p: Processor, message: PlayerInMessage | SurfaceInMessage): void {
  p.port.onmessage?.({ data: message });
}

/** Procesa `blocks` bloques de 128 muestras y devuelve la salida concatenada (canal izquierdo y derecho). */
function run(p: Processor, blocks: number, rate = 1): { left: Float32Array; right: Float32Array } {
  const left = new Float32Array(blocks * BLOCK);
  const right = new Float32Array(blocks * BLOCK);
  for (let b = 0; b < blocks; b++) {
    const l = new Float32Array(BLOCK);
    const r = new Float32Array(BLOCK);
    expect(p.process([], [[l, r]], { rate: Float32Array.of(rate) })).toBe(true);
    left.set(l, b * BLOCK);
    right.set(r, b * BLOCK);
    globals.currentTime = (globals.currentTime ?? 0) + BLOCK / SAMPLE_RATE;
  }
  return { left, right };
}

function seconds(sec: number): number {
  return Math.round((sec * SAMPLE_RATE) / BLOCK);
}

/** El reproductor avisa de su posición cada 19 bloques (2432 muestras ≥ 50 ms). */
const REPORT_BLOCKS = Math.ceil((0.05 * SAMPLE_RATE) / BLOCK);

/** Bloques para cubrir `sec` segundos redondeados a un aviso de posición completo. */
function reported(sec: number): number {
  return Math.ceil(seconds(sec) / REPORT_BLOCKS) * REPORT_BLOCKS;
}

function blockSeconds(blocks: number): number {
  return (blocks * BLOCK) / SAMPLE_RATE;
}

function constantTrack(value: number, lengthSamples: number, sampleRate = SAMPLE_RATE, channels = 1): TrackMessage {
  const data: Int16Array[] = [];
  for (let c = 0; c < channels; c++) data.push(new Int16Array(lengthSamples).fill(value));
  return { type: 'track', index: 0, sampleRate, channels: data, length: lengthSamples };
}

function positions(p: Processor): PlayerOutMessage[] {
  return p.port.posted.filter((m) => m.type === 'position');
}

function lastPosition(p: Processor): { sec: number; contextTime: number; seq: number } {
  const last = positions(p).at(-1);
  if (!last || last.type !== 'position') throw new Error('sin posición');
  return last;
}

function needs(p: Processor): number[] {
  return p.port.posted.flatMap((m) => (m.type === 'need' ? [m.index] : []));
}

function ends(p: Processor): number {
  return p.port.posted.filter((m) => m.type === 'end').length;
}

function mean(values: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += values[i]!;
  return sum / (to - from);
}

function maxAbs(values: Float32Array, from = 0, to = values.length): number {
  let max = 0;
  for (let i = from; i < to; i++) max = Math.max(max, Math.abs(values[i]!));
  return max;
}

function rms(values: Float32Array, from = 0, to = values.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += values[i]! * values[i]!;
  return Math.sqrt(sum / (to - from));
}

beforeEach(loadWorklets);
afterEach(unloadWorklets);

/** Dos pistas de 1 s con un hueco de 0,5 s: total 2,5 s. */
const TIMELINE: PlayerInMessage = {
  type: 'timeline',
  tracks: [
    { startSec: 0, durationSec: 1 },
    { startSec: 1.5, durationSec: 1 },
  ],
  gapSec: 0.5,
  totalSec: 2.5,
  leadInSec: LEAD_IN_SEC,
  leadOutSec: LEAD_OUT_SEC,
};

describe('vinyl-player', () => {
  it('se registra con el parámetro rate', () => {
    const Ctor = registry.get(PLAYER_PROCESSOR) as unknown as { parameterDescriptors: { name: string; automationRate: string }[] };
    expect(Ctor).toBeDefined();
    expect(Ctor.parameterDescriptors).toEqual([{ name: 'rate', defaultValue: 0, minValue: -8, maxValue: 8, automationRate: 'a-rate' }]);
  });

  it('pide la pista actual y la siguiente, y avisa de la posición cada ~50 ms', () => {
    const p = create(PLAYER_PROCESSOR);
    send(p, TIMELINE);
    send(p, { type: 'stylus', down: true });
    run(p, seconds(0.2));
    expect(needs(p)).toEqual([0, 1]);
    const pos = positions(p);
    expect(pos.length).toBeGreaterThanOrEqual(3);
    expect(pos.length).toBeLessThanOrEqual(5);
    const last = lastPosition(p);
    // La posición avisada corresponde a su contextTime y no tiene más de ~50 ms.
    expect(last.sec).toBeCloseTo(last.contextTime, 6);
    expect((globals.currentTime ?? 0) - last.contextTime).toBeLessThan(0.052);
    expect(last.contextTime).toBeCloseTo(blockSeconds(3 * REPORT_BLOCKS), 9);
  });

  it('reproduce cada pista en su hueco exacto, trunca lo que sobra y rellena con silencio', () => {
    const p = create(PLAYER_PROCESSOR);
    send(p, TIMELINE);
    send(p, { type: 'stylus', down: true });
    // Pista 0: 1,5 s de 0,5 (más larga que su hueco de 1 s). Pista 1: 0,5 s de 0,25 (más corta).
    send(p, constantTrack(16384, Math.round(1.5 * SAMPLE_RATE)));
    send(p, { ...constantTrack(8192, Math.round(0.5 * SAMPLE_RATE)), index: 1 });
    const { left, right } = run(p, seconds(2.6));
    const at = (sec: number) => Math.round(sec * SAMPLE_RATE);
    expect(mean(left, at(0.1), at(0.9))).toBeCloseTo(0.5, 3);
    expect(mean(right, at(0.1), at(0.9))).toBeCloseTo(0.5, 3);
    expect(maxAbs(left, at(1.01), at(1.49))).toBe(0); // hueco
    expect(mean(left, at(1.51), at(1.99))).toBeCloseTo(0.25, 3);
    expect(maxAbs(left, at(2.01), at(2.49))).toBe(0); // la pista era más corta que su hueco
    expect(maxAbs(left, at(2.51), at(2.6))).toBe(0); // fuera del programa
    expect(ends(p)).toBe(1);
  });

  it('con la aguja levantada la salida es 0 pero la posición avanza', () => {
    const p = create(PLAYER_PROCESSOR);
    send(p, TIMELINE);
    send(p, constantTrack(16384, SAMPLE_RATE));
    const blocks = reported(0.5);
    const { left } = run(p, blocks);
    expect(maxAbs(left)).toBe(0);
    expect(lastPosition(p).sec).toBeCloseTo(blockSeconds(blocks), 6);
  });

  it('acota la posición entre −lead-in y total + lead-out en ambos sentidos', () => {
    const p = create(PLAYER_PROCESSOR);
    send(p, TIMELINE);
    run(p, seconds(1), -4);
    expect(lastPosition(p).sec).toBe(-LEAD_IN_SEC);
    run(p, seconds(3), 4);
    expect(lastPosition(p).sec).toBe(2.5 + LEAD_OUT_SEC);
  });

  it('emite end una vez por cruce hacia delante y se rearma al volver atrás', () => {
    const p = create(PLAYER_PROCESSOR);
    send(p, TIMELINE);
    send(p, { type: 'seek', sec: 2.4, seq: 1 });
    run(p, seconds(0.5));
    expect(ends(p)).toBe(1);
    run(p, seconds(0.5));
    expect(ends(p)).toBe(1);
    run(p, seconds(1), -1); // vuelve por debajo de 2,5
    expect(ends(p)).toBe(1);
    run(p, seconds(1.5), 1);
    expect(ends(p)).toBe(2);
    // Un seek más allá del final no cuenta como cruce.
    send(p, { type: 'seek', sec: 1, seq: 2 });
    send(p, { type: 'seek', sec: 3, seq: 3 });
    run(p, seconds(0.1));
    expect(ends(p)).toBe(2);
  });

  it('no emite end con una línea de tiempo sin pistas', () => {
    const p = create(PLAYER_PROCESSOR);
    send(p, { ...TIMELINE, tracks: [], totalSec: 0 });
    const blocks = reported(1);
    run(p, blocks);
    expect(ends(p)).toBe(0);
    expect(needs(p)).toEqual([]);
    expect(lastPosition(p).sec).toBeCloseTo(blockSeconds(blocks), 6);
  });

  it('un seek lleva la secuencia, avisa al instante y funde 5 ms', () => {
    const p = create(PLAYER_PROCESSOR);
    send(p, TIMELINE);
    send(p, { type: 'stylus', down: true });
    send(p, constantTrack(16384, SAMPLE_RATE));
    run(p, seconds(0.1));
    send(p, { type: 'seek', sec: 0.5, seq: 7 });
    const immediate = lastPosition(p);
    expect(immediate.seq).toBe(7);
    expect(immediate.sec).toBeCloseTo(0.5, 9);
    // Fundido cruzado entre dos puntos de la misma señal constante: el nivel no cambia.
    const crossfade = run(p, 4);
    expect(crossfade.left[0]!).toBeCloseTo(0.5, 5);
    expect(crossfade.left[100]!).toBeCloseTo(0.5, 5);
    expect(crossfade.left[300]!).toBeCloseTo(0.5, 5);
    expect(lastPosition(p).seq).toBe(7);
    // Desde el hueco (silencio) la nueva posición entra con un fundido de 5 ms (240 muestras).
    send(p, { type: 'seek', sec: 1.2, seq: 8 });
    run(p, 4);
    send(p, { type: 'seek', sec: 0.5, seq: 9 });
    const { left } = run(p, 4);
    expect(left[0]!).toBeCloseTo(0.5 / 240, 6);
    expect(left[119]!).toBeCloseTo(0.25, 3);
    expect(left[239]!).toBeCloseTo(0.5, 5);
    expect(left[300]!).toBeCloseTo(0.5, 5);
  });

  it('un seek con la aguja levantada no deja cola sonando al apoyarla', () => {
    const p = create(PLAYER_PROCESSOR);
    send(p, TIMELINE);
    send(p, constantTrack(16384, SAMPLE_RATE));
    send(p, { type: 'seek', sec: 0.2, seq: 1 });
    send(p, { type: 'stylus', down: true });
    const { left } = run(p, 2);
    expect(left[10]!).toBeCloseTo(0.5, 5);
  });

  it('lee con interpolación lineal y respeta la frecuencia de muestreo de la pista', () => {
    const p = create(PLAYER_PROCESSOR);
    send(p, TIMELINE);
    send(p, { type: 'stylus', down: true });
    // Rampa a 24 kHz: la muestra k vale k. A 48 kHz de salida avanza media muestra por paso.
    const ramp = new Int16Array(24000);
    for (let i = 0; i < ramp.length; i++) ramp[i] = i;
    send(p, { type: 'track', index: 0, sampleRate: 24000, channels: [ramp], length: ramp.length });
    send(p, { type: 'seek', sec: 0, seq: 1 });
    const { left, right } = run(p, 4);
    const expected = (i: number) => ((i + 1) * 0.5) / 32768;
    expect(left[300]!).toBeCloseTo(expected(300), 7);
    expect(left[301]!).toBeCloseTo(expected(301), 7);
    expect(right[301]!).toBeCloseTo(expected(301), 7);
  });

  it('a mitad de velocidad avanza la mitad y hacia atrás retrocede', () => {
    const p = create(PLAYER_PROCESSOR);
    send(p, TIMELINE);
    const forward = reported(1);
    run(p, forward, 0.5);
    expect(lastPosition(p).sec).toBeCloseTo(0.5 * blockSeconds(forward), 6);
    const backward = reported(0.25);
    run(p, backward, -1);
    const expected = 0.5 * blockSeconds(forward) - blockSeconds(backward);
    expect(lastPosition(p).sec).toBeCloseTo(expected, 6);
    run(p, reported(1), 0);
    expect(lastPosition(p).sec).toBeCloseTo(expected, 6);
  });

  it('el bamboleo modula la velocidad sin cambiar el avance medio', () => {
    const p = create(PLAYER_PROCESSOR);
    send(p, TIMELINE);
    send(p, { type: 'effects', wobbleDepth: 0.08, wobbleHz: 2 });
    const blocks = reported(1);
    run(p, blocks);
    const withWobble = lastPosition(p).sec;
    expect(withWobble).toBeCloseTo(blockSeconds(blocks), 3);
    expect(withWobble).not.toBeCloseTo(blockSeconds(blocks), 7); // pero no es exactamente lineal
    send(p, { type: 'effects', wobbleDepth: 0, wobbleHz: 0 });
    run(p, REPORT_BLOCKS);
    expect(lastPosition(p).sec - withWobble).toBeCloseTo(blockSeconds(REPORT_BLOCKS), 9);
  });

  it('descargar una pista deja silencio y vuelve a pedirla; reset lo borra todo', () => {
    const p = create(PLAYER_PROCESSOR);
    send(p, TIMELINE);
    send(p, { type: 'stylus', down: true });
    send(p, constantTrack(16384, SAMPLE_RATE));
    send(p, { ...constantTrack(16384, SAMPLE_RATE), index: 1 });
    run(p, 2);
    expect(needs(p)).toEqual([]);
    send(p, { type: 'unload-track', index: 0 });
    const { left } = run(p, 2);
    expect(maxAbs(left)).toBe(0);
    expect(needs(p)).toEqual([0]);
    send(p, { type: 'reset' });
    run(p, seconds(0.5));
    expect(lastPosition(p).sec).toBe(0);
    expect(needs(p)).toEqual([0]);
  });

  it('vuelve a pedir una pista que no llega pasados 3 s', () => {
    const p = create(PLAYER_PROCESSOR);
    send(p, TIMELINE);
    run(p, seconds(0.1), 0);
    expect(needs(p)).toEqual([0, 1]);
    run(p, seconds(3.1), 0);
    expect(needs(p)).toEqual([0, 1, 0, 1]);
  });

  it('pide la pista siguiente cuando está a menos de 20 s', () => {
    const p = create(PLAYER_PROCESSOR);
    send(p, {
      ...TIMELINE,
      tracks: [
        { startSec: 0, durationSec: 60 },
        { startSec: 62, durationSec: 60 },
      ],
      gapSec: 2,
      totalSec: 122,
    });
    send(p, constantTrack(0, 10));
    run(p, 1, 0);
    expect(needs(p)).toEqual([]);
    send(p, { type: 'seek', sec: 41, seq: 1 });
    run(p, 1, 0);
    expect(needs(p)).toEqual([]);
    send(p, { type: 'seek', sec: 43, seq: 2 });
    run(p, 1, 0);
    expect(needs(p)).toEqual([1]);
  });

  it('una pista sin audio (length 0) cuenta como cargada y suena a silencio', () => {
    const p = create(PLAYER_PROCESSOR);
    send(p, TIMELINE);
    send(p, { type: 'stylus', down: true });
    send(p, { type: 'track', index: 0, sampleRate: SAMPLE_RATE, channels: [], length: 0 });
    send(p, { type: 'track', index: 1, sampleRate: SAMPLE_RATE, channels: [], length: 0 });
    const { left } = run(p, seconds(0.3));
    expect(maxAbs(left)).toBe(0);
    expect(needs(p)).toEqual([]);
  });

  it('una pista estéreo sale por los dos canales', () => {
    const p = create(PLAYER_PROCESSOR);
    send(p, TIMELINE);
    send(p, { type: 'stylus', down: true });
    send(p, constantTrack(16384, SAMPLE_RATE, SAMPLE_RATE, 2));
    const msg = constantTrack(16384, SAMPLE_RATE, SAMPLE_RATE, 2);
    msg.channels[1]!.fill(-16384);
    send(p, msg);
    const { left, right } = run(p, 4);
    expect(left[400]!).toBeCloseTo(0.5, 5);
    expect(right[400]!).toBeCloseTo(-0.5, 5);
  });
});

describe('vinyl-surface', () => {
  it('se registra y en silencio total no produce nada', () => {
    expect(registry.has(SURFACE_PROCESSOR)).toBe(true);
    const p = create(SURFACE_PROCESSOR);
    const { left, right } = run(p, 10);
    expect(maxAbs(left)).toBe(0);
    expect(maxAbs(right)).toBe(0);
  });

  it('el zumbido del motor suena aunque la aguja esté levantada', () => {
    const p = create(SURFACE_PROCESSOR);
    send(p, { type: 'effects', crackleRate: 0, crackleGain: 0, hissGain: 0, rumbleGain: 1, wobbleDepth: 0, wobbleHz: 0, clickRate: 0, clickGain: 0 });
    const { left } = run(p, seconds(0.5));
    const tail = left.subarray(left.length - SAMPLE_RATE / 10);
    expect(maxAbs(tail)).toBeGreaterThan(0.015);
    expect(maxAbs(tail)).toBeLessThan(0.035);
    // Es periódico a 30 Hz: 1600 muestras.
    expect(tail[0]!).toBeCloseTo(tail[1600]!, 3);
  });

  it('el siseo y el crepitar solo suenan con la aguja apoyada y con slew', () => {
    const p = create(SURFACE_PROCESSOR);
    send(p, { type: 'effects', crackleRate: 200, crackleGain: 1, hissGain: 1, rumbleGain: 0, wobbleDepth: 0, wobbleHz: 0, clickRate: 50, clickGain: 1 });
    const up = run(p, seconds(0.2));
    expect(maxAbs(up.left)).toBe(0);
    send(p, { type: 'stylus', down: true });
    const down = run(p, seconds(0.5));
    const early = rms(down.left, 0, 200);
    const late = rms(down.left, SAMPLE_RATE / 4, down.left.length);
    expect(early).toBeLessThan(late); // sube con slew, sin escalón
    expect(late).toBeGreaterThan(0.005);
    expect(maxAbs(down.left)).toBeLessThan(1);
    expect(rms(down.right, SAMPLE_RATE / 4, down.right.length)).toBeGreaterThan(0.005);
    send(p, { type: 'stylus', down: false });
    const after = run(p, seconds(0.5));
    expect(maxAbs(after.left, after.left.length - 1000)).toBe(0);
  });

  it('la velocidad atenúa el siseo (plato parado: sin siseo)', () => {
    const p = create(SURFACE_PROCESSOR);
    send(p, { type: 'effects', crackleRate: 0, crackleGain: 0, hissGain: 1, rumbleGain: 0, wobbleDepth: 0, wobbleHz: 0, clickRate: 0, clickGain: 0 });
    send(p, { type: 'stylus', down: true });
    const full = run(p, seconds(0.5));
    const fullRms = rms(full.left, SAMPLE_RATE / 4, full.left.length);
    send(p, { type: 'speed', factor: 0.25 });
    const slow = run(p, seconds(0.5));
    expect(rms(slow.left, SAMPLE_RATE / 4, slow.left.length)).toBeCloseTo(fullRms * 0.5, 2);
    send(p, { type: 'speed', factor: 0 });
    const stopped = run(p, seconds(0.5));
    expect(rms(stopped.left, SAMPLE_RATE / 4, stopped.left.length)).toBeLessThan(fullRms * 0.01);
  });

  it('el golpe sordo es breve y grave', () => {
    const p = create(SURFACE_PROCESSOR);
    send(p, { type: 'thump' });
    const { left } = run(p, seconds(0.3));
    expect(maxAbs(left, 0, SAMPLE_RATE / 20)).toBeGreaterThan(0.1);
    expect(maxAbs(left, Math.round(0.2 * SAMPLE_RATE))).toBeLessThan(0.01);
    expect(maxAbs(left)).toBeLessThan(1);
  });

  it('ignora mensajes desconocidos o mal formados', () => {
    const p = create(SURFACE_PROCESSOR);
    p.port.onmessage?.({ data: null });
    p.port.onmessage?.({ data: { type: 'otro' } });
    send(p, { type: 'effects', crackleRate: Number.NaN, crackleGain: -1, hissGain: 5, rumbleGain: 0, wobbleDepth: 0, wobbleHz: 0, clickRate: 0, clickGain: 0 });
    send(p, { type: 'stylus', down: true });
    const { left } = run(p, 4);
    for (const v of left) expect(Number.isFinite(v)).toBe(true);
  });
});
