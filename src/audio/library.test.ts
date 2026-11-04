import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVinyl, track } from '../core/defaults';
import type { BlobStore } from '../core/store';
import { AUDIO_SAMPLE_RATE } from './engine';
import { AUDIO_CACHE_BUDGET_BYTES, bufferToDecodedTrack, createAudioLibrary, createAudioLibraryWithBudget, floatToInt16 } from './library';

interface FakeOffline {
  channels: number;
  length: number;
  sampleRate: number;
}

/** Buffers que devolverá el OfflineAudioContext simulado, por tamaño del blob. */
const decoded = new Map<number, { channels: Float32Array[]; sampleRate: number }>();
const created: FakeOffline[] = [];
let decodeCalls = 0;
let releaseDecode: (() => void) | null = null;
let blockDecode = false;

class FakeAudioBuffer {
  constructor(
    private readonly channels: Float32Array[],
    readonly sampleRate: number,
  ) {}
  get numberOfChannels(): number {
    return this.channels.length;
  }
  get length(): number {
    return this.channels[0]?.length ?? 0;
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(c: number): Float32Array {
    return this.channels[c]!;
  }
}

class FakeOfflineAudioContext {
  constructor(channels: number, length: number, sampleRate: number) {
    created.push({ channels, length, sampleRate });
  }
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> {
    decodeCalls++;
    const entry = decoded.get(data.byteLength);
    const finish = (): AudioBuffer => {
      if (!entry) throw new DOMException('EncodingError', 'EncodingError');
      return new FakeAudioBuffer(entry.channels, entry.sampleRate) as unknown as AudioBuffer;
    };
    if (!blockDecode) return Promise.resolve().then(finish);
    return new Promise<AudioBuffer>((resolve, reject) => {
      releaseDecode = () => {
        try {
          resolve(finish());
        } catch (e) {
          reject(e);
        }
      };
    });
  }
}

function blobOfSize(size: number): Blob {
  return new Blob([new Uint8Array(size)]);
}

function fakeBlobs(entries: Record<string, Blob>): BlobStore {
  const map = new Map(Object.entries(entries));
  return {
    put: async () => 'x',
    get: async (key) => map.get(key) ?? null,
    delete: async () => undefined,
    url: async () => null,
    cachedUrl: () => null,
  };
}

beforeEach(() => {
  (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = FakeOfflineAudioContext;
  decoded.clear();
  created.length = 0;
  decodeCalls = 0;
  releaseDecode = null;
  blockDecode = false;
});

afterEach(() => {
  delete (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext;
  vi.restoreAllMocks();
});

describe('conversión a PCM de 16 bits', () => {
  it('floatToInt16 escala y satura', () => {
    expect(Array.from(floatToInt16(Float32Array.of(0, 0.5, 1, -1, 1.5, -1.5)))).toEqual([0, 16384, 32767, -32768, 32767, -32768]);
  });

  it('bufferToDecodedTrack conserva como mucho dos canales', () => {
    const buffer = new FakeAudioBuffer([Float32Array.of(0.5), Float32Array.of(-0.5), Float32Array.of(1)], 48000);
    const out = bufferToDecodedTrack(buffer);
    expect(out.channels).toHaveLength(2);
    expect(out.sampleRate).toBe(48000);
    expect(out.durationSec).toBeCloseTo(1 / 48000, 12);
    expect(out.channels[1]![0]).toBe(-16384);
  });
});

describe('createAudioLibrary', () => {
  it('decodifica con un OfflineAudioContext a AUDIO_SAMPLE_RATE y cachea', async () => {
    decoded.set(10, { channels: [Float32Array.of(0.25, 0.5), Float32Array.of(-0.25, -0.5)], sampleRate: 48000 });
    const lib = createAudioLibrary(fakeBlobs({ a: blobOfSize(10) }));
    const ref = { blobKey: 'a', mimeType: 'audio/wav', fileName: 'a.wav' };
    const t1 = await lib.getTrack(ref);
    expect(created).toEqual([{ channels: 2, length: 1, sampleRate: AUDIO_SAMPLE_RATE }]);
    expect(Array.from(t1.channels[0]!)).toEqual([8192, 16384]);
    expect(Array.from(t1.channels[1]!)).toEqual([-8192, -16384]);
    const t2 = await lib.getTrack(ref);
    expect(t2).toBe(t1);
    expect(decodeCalls).toBe(1);
    lib.evict('a');
    await lib.getTrack(ref);
    expect(decodeCalls).toBe(2);
    lib.clear();
    await lib.getTrack(ref);
    expect(decodeCalls).toBe(3);
  });

  it('falla si el blob no existe o no se puede decodificar', async () => {
    const lib = createAudioLibrary(fakeBlobs({ b: blobOfSize(3) }));
    await expect(lib.getTrack({ blobKey: 'nada', mimeType: '', fileName: 'nada.mp3' })).rejects.toThrow('No se encontró');
    await expect(lib.getTrack({ blobKey: 'b', mimeType: '', fileName: 'b.mp3' })).rejects.toThrow();
  });

  it('sin OfflineAudioContext rechaza con un error claro', async () => {
    delete (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext;
    const lib = createAudioLibrary(fakeBlobs({ a: blobOfSize(10) }));
    await expect(lib.getTrack({ blobKey: 'a', mimeType: '', fileName: 'a' })).rejects.toThrow('OfflineAudioContext');
  });

  it('decodifica de una en una y comparte la decodificación en curso de una misma clave', async () => {
    decoded.set(10, { channels: [Float32Array.of(0)], sampleRate: 48000 });
    decoded.set(20, { channels: [Float32Array.of(0)], sampleRate: 48000 });
    blockDecode = true;
    const lib = createAudioLibrary(fakeBlobs({ a: blobOfSize(10), b: blobOfSize(20) }));
    const pa1 = lib.getTrack({ blobKey: 'a', mimeType: '', fileName: 'a' });
    const pa2 = lib.getTrack({ blobKey: 'a', mimeType: '', fileName: 'a' });
    const pb = lib.getTrack({ blobKey: 'b', mimeType: '', fileName: 'b' });
    expect(pa2).toBe(pa1);
    await new Promise((r) => setTimeout(r, 0));
    expect(decodeCalls).toBe(1); // b espera a que termine a
    releaseDecode!();
    await pa1;
    await new Promise((r) => setTimeout(r, 0));
    expect(decodeCalls).toBe(2);
    releaseDecode!();
    await pb;
  });

  it('la caché es LRU por bytes', async () => {
    const big = new Float32Array(1000); // 2000 bytes en Int16
    decoded.set(1, { channels: [big], sampleRate: 48000 });
    decoded.set(2, { channels: [big], sampleRate: 48000 });
    decoded.set(3, { channels: [big], sampleRate: 48000 });
    const lib = createAudioLibraryWithBudget(fakeBlobs({ a: blobOfSize(1), b: blobOfSize(2), c: blobOfSize(3) }), 4500);
    const refA = { blobKey: 'a', mimeType: '', fileName: 'a' };
    const refB = { blobKey: 'b', mimeType: '', fileName: 'b' };
    const refC = { blobKey: 'c', mimeType: '', fileName: 'c' };
    await lib.getTrack(refA);
    await lib.getTrack(refB);
    await lib.getTrack(refA); // a pasa a ser la más reciente
    await lib.getTrack(refC); // expulsa b (4000 + 2000 > 4500)
    expect(decodeCalls).toBe(3);
    await lib.getTrack(refA);
    expect(decodeCalls).toBe(3);
    await lib.getTrack(refB);
    expect(decodeCalls).toBe(4);
    expect(AUDIO_CACHE_BUDGET_BYTES).toBe(160 * 1024 * 1024);
  });
});

describe('sideSource', () => {
  it('una cara decorativa no tiene pistas', async () => {
    const v = createVinyl();
    v.disc.sides[1].decorative = true;
    v.disc.sides[1].tracks = [track('X', 100)];
    const lib = createAudioLibrary(fakeBlobs({}));
    const src = await lib.sideSource(v, 'B');
    expect(src.tracks).toEqual([]);
    expect(src.gapSec).toBe(v.disc.trackGapSec);
  });

  it('devuelve las duraciones y carga perezosamente (null sin audio o si falla)', async () => {
    decoded.set(10, { channels: [Float32Array.of(0.5)], sampleRate: 48000 });
    const v = createVinyl();
    v.disc.trackGapSec = 2;
    v.disc.sides[0].tracks = [
      track('Con audio', 30, { blobKey: 'a', mimeType: 'audio/wav', fileName: 'a.wav' }),
      track('Sin audio', 40),
      track('Rota', -5, { blobKey: 'rota', mimeType: 'audio/wav', fileName: 'rota.wav' }),
    ];
    const lib = createAudioLibrary(fakeBlobs({ a: blobOfSize(10), rota: blobOfSize(4) }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const src = await lib.sideSource(v, 'A');
    expect(src.gapSec).toBe(2);
    expect(src.tracks.map((t) => t.durationSec)).toEqual([30, 40, 0]);
    expect(decodeCalls).toBe(0);
    const first = await src.tracks[0]!.load();
    expect(first?.channels[0]![0]).toBe(16384);
    expect(await src.tracks[1]!.load()).toBeNull();
    expect(await src.tracks[2]!.load()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('Rota');
  });
});
