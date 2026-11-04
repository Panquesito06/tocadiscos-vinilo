import { describe, expect, it } from 'vitest';
import {
  DEMO_SAMPLE_RATE,
  DEMO_TAIL_SEC,
  composeDemoScore,
  createDemoRng,
  degreeToHz,
  encodeWav,
  encodeWavBytes,
  generateDemoTrack,
  type DemoTrackSpec,
} from './demo';

function ascii(view: DataView, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

describe('encodeWav', () => {
  const left = Float32Array.of(0, 1, -1, 0.5);
  const right = Float32Array.of(0.25, -0.25, 2, -2);
  const fakeBuffer = {
    numberOfChannels: 2,
    length: 4,
    sampleRate: 32000,
    getChannelData: (c: number) => (c === 0 ? left : right),
  };

  it('escribe una cabecera RIFF correcta para PCM de 16 bits', () => {
    const bytes = encodeWavBytes(fakeBuffer);
    const view = new DataView(bytes);
    expect(bytes.byteLength).toBe(44 + 4 * 2 * 2);
    expect(ascii(view, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + 16);
    expect(ascii(view, 8, 4)).toBe('WAVE');
    expect(ascii(view, 12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(32000);
    expect(view.getUint32(28, true)).toBe(32000 * 4);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(view, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(16);
  });

  it('intercala los canales con saturación', () => {
    const view = new DataView(encodeWavBytes(fakeBuffer));
    const samples: number[] = [];
    for (let i = 0; i < 8; i++) samples.push(view.getInt16(44 + i * 2, true));
    expect(samples).toEqual([0, 8192, 32767, -8192, -32768, 32767, 16384, -32768]);
  });

  it('devuelve un Blob audio/wav con tantos canales como el buffer', async () => {
    const mono = { numberOfChannels: 1, length: 3, sampleRate: DEMO_SAMPLE_RATE, getChannelData: () => Float32Array.of(0, 0, 0) };
    const blob = encodeWav(mono);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + 6);
    const view = new DataView(await blob.arrayBuffer());
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(DEMO_SAMPLE_RATE);
  });
});

describe('composeDemoScore', () => {
  const spec: DemoTrackSpec = { seed: 7, durationSec: 30, bpm: 110, scale: [0, 2, 4, 7, 9], rootHz: 220, voice: 'piano' };

  it('es determinista: la misma semilla produce la misma partitura', () => {
    const a = composeDemoScore(spec);
    const b = composeDemoScore({ ...spec });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(20);
  });

  it('semillas distintas producen partituras distintas', () => {
    const a = composeDemoScore(spec);
    const b = composeDemoScore({ ...spec, seed: 8 });
    expect(a).not.toEqual(b);
  });

  it('las notas caben en la duración, están en la escala y tienen las tres partes', () => {
    const notes = composeDemoScore(spec);
    const parts = new Set(notes.map((n) => n.part));
    expect(parts).toEqual(new Set(['melody', 'chord', 'bass']));
    const allowed = new Set([0, 2, 4, 7, 9]);
    for (const note of notes) {
      expect(note.timeSec).toBeGreaterThanOrEqual(0);
      expect(note.timeSec + note.durationSec).toBeLessThanOrEqual(spec.durationSec - DEMO_TAIL_SEC + 0.01);
      expect(note.durationSec).toBeGreaterThan(0);
      expect(note.velocity).toBeGreaterThan(0);
      expect(note.velocity).toBeLessThanOrEqual(1);
      const semitones = 12 * Math.log2(note.hz / 220);
      const cls = ((Math.round(semitones) % 12) + 12) % 12;
      expect(Math.abs(semitones - Math.round(semitones))).toBeLessThan(1e-6);
      expect(allowed.has(cls)).toBe(true);
    }
    const melody = notes.filter((n) => n.part === 'melody');
    expect(melody[melody.length - 1]!.hz).toBeCloseTo(220 * 2 ** 2, 6); // resuelve en la tónica
  });

  it('acepta escalas vacías o desordenadas y bpm fuera de rango', () => {
    const notes = composeDemoScore({ ...spec, scale: [], bpm: 9999 });
    expect(notes.length).toBeGreaterThan(0);
    const notes2 = composeDemoScore({ ...spec, scale: [9, 2, 14, 2], durationSec: 2 });
    expect(notes2.length).toBeGreaterThan(0);
  });
});

describe('createDemoRng y degreeToHz', () => {
  it('el generador es determinista y da valores en [0, 1)', () => {
    const a = createDemoRng(42);
    const b = createDemoRng(42);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('los grados fuera de la escala cambian de octava', () => {
    const scale = [0, 2, 4, 7, 9];
    expect(degreeToHz(220, scale, 0)).toBeCloseTo(220, 6);
    expect(degreeToHz(220, scale, 5)).toBeCloseTo(440, 6);
    expect(degreeToHz(220, scale, -5)).toBeCloseTo(110, 6);
    expect(degreeToHz(220, scale, 1)).toBeCloseTo(220 * 2 ** (2 / 12), 6);
  });
});

describe('generateDemoTrack', () => {
  it('sin OfflineAudioContext rechaza con un error claro', async () => {
    expect(typeof (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext).toBe('undefined');
    await expect(
      generateDemoTrack({ seed: 1, durationSec: 20, bpm: 100, scale: [0, 2, 4, 7, 9], rootHz: 220, voice: 'bell' }),
    ).rejects.toThrow('No hay OfflineAudioContext');
  });
});
