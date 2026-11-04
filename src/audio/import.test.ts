import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlobStore } from '../core/store';
import {
  IMPORT_TIMEOUT_MS,
  REASON_NOT_SAVED,
  REASON_UNPLAYABLE,
  REASON_UNREADABLE,
  importAudioFiles,
  mimeTypeFor,
  probeAudioDuration,
  titleFromFileName,
} from './import';

describe('titleFromFileName', () => {
  it('quita la extensión y los prefijos numéricos', () => {
    expect(titleFromFileName('03 - Bohemian Dream.mp3')).toBe('Bohemian Dream');
    expect(titleFromFileName('03. Bohemian Dream.flac')).toBe('Bohemian Dream');
    expect(titleFromFileName('03.Bohemian Dream.flac')).toBe('Bohemian Dream');
    expect(titleFromFileName('03_Bohemian_Dream.ogg')).toBe('Bohemian Dream');
    expect(titleFromFileName('03 Bohemian Dream.wav')).toBe('Bohemian Dream');
    expect(titleFromFileName('1-03 Bohemian Dream.m4a')).toBe('Bohemian Dream');
    expect(titleFromFileName('03) Bohemian Dream.m4a')).toBe('Bohemian Dream');
  });

  it('convierte guiones bajos en espacios y recorta', () => {
    expect(titleFromFileName('  Noche__de_verano .mp3')).toBe('Noche de verano');
    expect(titleFromFileName('Canción_con_ñ.MP3')).toBe('Canción con ñ');
  });

  it('respeta títulos numéricos y nombres sin extensión', () => {
    expect(titleFromFileName('1999.mp3')).toBe('1999');
    expect(titleFromFileName('99.mp3')).toBe('99');
    expect(titleFromFileName('2024 Live.mp3')).toBe('2024 Live');
    expect(titleFromFileName('Sin extensión')).toBe('Sin extensión');
    expect(titleFromFileName('C:\\Música\\07 - Lluvia.mp3')).toBe('Lluvia');
    expect(titleFromFileName('/home/yo/07 - Lluvia.mp3')).toBe('Lluvia');
  });

  it('nunca devuelve una cadena vacía', () => {
    expect(titleFromFileName('03.mp3')).toBe('03');
    expect(titleFromFileName('03 - .mp3')).toBe('03 -');
    expect(titleFromFileName('___.mp3')).toBe('.mp3');
    expect(titleFromFileName('')).toBe('Sin título');
    expect(titleFromFileName('.mp3')).toBe('.mp3');
  });
});

describe('mimeTypeFor', () => {
  it('prefiere el tipo declarado por el archivo', () => {
    expect(mimeTypeFor({ name: 'a.mp3', type: 'audio/mpeg' })).toBe('audio/mpeg');
    expect(mimeTypeFor({ name: 'a.xyz', type: ' Audio/FLAC ' })).toBe('audio/flac');
  });

  it('deduce el tipo por la extensión cuando está vacío', () => {
    expect(mimeTypeFor({ name: 'a.mp3', type: '' })).toBe('audio/mpeg');
    expect(mimeTypeFor({ name: 'a.FLAC', type: '' })).toBe('audio/flac');
    expect(mimeTypeFor({ name: 'a.wav', type: '' })).toBe('audio/wav');
    expect(mimeTypeFor({ name: 'a.ogg', type: '' })).toBe('audio/ogg');
    expect(mimeTypeFor({ name: 'a.oga', type: '' })).toBe('audio/ogg');
    expect(mimeTypeFor({ name: 'a.opus', type: '' })).toBe('audio/ogg');
    expect(mimeTypeFor({ name: 'a.m4a', type: '' })).toBe('audio/mp4');
    expect(mimeTypeFor({ name: 'a.aac', type: '' })).toBe('audio/aac');
    expect(mimeTypeFor({ name: 'a.webm', type: '' })).toBe('audio/webm');
    expect(mimeTypeFor({ name: 'carpeta.v2/a.mp3', type: '' })).toBe('audio/mpeg');
  });

  it('desconocida → application/octet-stream', () => {
    expect(mimeTypeFor({ name: 'a.xyz', type: '' })).toBe('application/octet-stream');
    expect(mimeTypeFor({ name: 'sinextension', type: '' })).toBe('application/octet-stream');
  });
});

// ---------------------------------------------------------------------------
// importAudioFiles con un <audio> simulado
// ---------------------------------------------------------------------------

interface FakeAudio {
  preload: string;
  muted: boolean;
  src: string;
  currentTime: number;
  duration: number;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
  removeAttribute(name: string): void;
  load(): void;
  fire(type: string): void;
}

/** Comportamiento del <audio> simulado según el nombre del archivo que se carga. */
type Behaviour = (audio: FakeAudio) => void;

function createFakeAudio(behaviour: Behaviour): FakeAudio {
  const listeners = new Map<string, Set<() => void>>();
  let src = '';
  const audio: FakeAudio = {
    preload: '',
    muted: false,
    currentTime: 0,
    duration: Number.NaN,
    get src() {
      return src;
    },
    set src(value: string) {
      src = value;
      queueMicrotask(() => behaviour(audio));
    },
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
    removeAttribute: () => {
      src = '';
    },
    load: () => undefined,
    fire: (type) => {
      for (const fn of Array.from(listeners.get(type) ?? [])) fn();
    },
  };
  return audio;
}

function fakeBlobs(): BlobStore & { stored: Map<string, Blob> } {
  const stored = new Map<string, Blob>();
  let n = 0;
  return {
    stored,
    put: async (blob) => {
      const key = `blob_${++n}`;
      stored.set(key, blob);
      return key;
    },
    get: async (key) => stored.get(key) ?? null,
    delete: async (key) => {
      stored.delete(key);
    },
    url: async () => null,
    cachedUrl: () => null,
  };
}

const behaviours = new Map<string, Behaviour>();
let currentFile: File | null = null;
let audiosCreated = 0;
let revoked: string[] = [];

beforeEach(() => {
  audiosCreated = 0;
  revoked = [];
  behaviours.clear();
  currentFile = null;
  const realCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
    if (tag !== 'audio') return realCreateElement(tag, options);
    audiosCreated++;
    const behaviour = behaviours.get(currentFile?.name ?? '') ?? (() => undefined);
    return createFakeAudio(behaviour) as unknown as HTMLElement;
  });
  vi.spyOn(URL, 'createObjectURL').mockImplementation((object: Blob | MediaSource) => {
    currentFile = object as File;
    return `blob:fake/${(object as File).name}`;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
    revoked.push(url);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function file(name: string, type = ''): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type });
}

function playable(durationSec: number): Behaviour {
  return (audio) => {
    audio.duration = durationSec;
    audio.fire('loadedmetadata');
  };
}

const broken: Behaviour = (audio) => audio.fire('error');

describe('probeAudioDuration', () => {
  it('resuelve la duración de los metadatos y revoca la URL', async () => {
    behaviours.set('ok.mp3', playable(123.456));
    await expect(probeAudioDuration(file('ok.mp3'))).resolves.toBe(123.456);
    expect(revoked).toEqual(['blob:fake/ok.mp3']);
  });

  it('rechaza los formatos que el navegador no reproduce', async () => {
    behaviours.set('malo.xyz', broken);
    await expect(probeAudioDuration(file('malo.xyz'))).rejects.toThrow(REASON_UNPLAYABLE);
    expect(revoked).toHaveLength(1);
  });

  it('con duración infinita salta al final y espera durationchange', async () => {
    behaviours.set('stream.ogg', (audio) => {
      audio.duration = Number.POSITIVE_INFINITY;
      audio.fire('loadedmetadata');
      expect(audio.currentTime).toBeGreaterThan(1e100);
      audio.duration = 42;
      audio.fire('durationchange');
    });
    await expect(probeAudioDuration(file('stream.ogg'))).resolves.toBe(42);
  });

  it('una duración 0 o NaN cuenta como formato no reproducible', async () => {
    behaviours.set('vacio.mp3', playable(0));
    await expect(probeAudioDuration(file('vacio.mp3'))).rejects.toThrow(REASON_UNPLAYABLE);
  });

  it('vence a los 15 s si no llegan metadatos', async () => {
    vi.useFakeTimers();
    behaviours.set('lento.mp3', () => undefined);
    const promise = probeAudioDuration(file('lento.mp3'));
    const settled = expect(promise).rejects.toThrow(REASON_UNREADABLE);
    await vi.advanceTimersByTimeAsync(IMPORT_TIMEOUT_MS + 1);
    await settled;
    expect(revoked).toHaveLength(1);
  });
});

describe('importAudioFiles', () => {
  it('guarda los reproducibles y rechaza los demás, de uno en uno', async () => {
    behaviours.set('01 - Amanecer.mp3', playable(200.25));
    behaviours.set('roto.flac', broken);
    behaviours.set('02_Tarde.ogg', playable(30));
    const blobs = fakeBlobs();
    const result = await importAudioFiles(
      [file('01 - Amanecer.mp3', 'audio/mpeg'), file('roto.flac'), file('02_Tarde.ogg')],
      blobs,
    );
    expect(result.rejected).toEqual([{ fileName: 'roto.flac', reason: REASON_UNPLAYABLE }]);
    expect(result.tracks).toHaveLength(2);
    const [first, second] = result.tracks;
    expect(first!.title).toBe('Amanecer');
    expect(first!.durationSec).toBe(200.25);
    expect(first!.id.startsWith('trk_')).toBe(true);
    expect(first!.audio).toEqual({ blobKey: 'blob_1', mimeType: 'audio/mpeg', fileName: '01 - Amanecer.mp3' });
    expect(second!.title).toBe('Tarde');
    expect(second!.audio?.mimeType).toBe('audio/ogg');
    expect(blobs.stored.size).toBe(2);
    expect(audiosCreated).toBe(3);
  });

  it('no guarda el blob de un archivo rechazado y avisa si no se puede guardar', async () => {
    behaviours.set('a.mp3', playable(10));
    behaviours.set('b.mp3', playable(10));
    const blobs = fakeBlobs();
    let calls = 0;
    const put = blobs.put;
    blobs.put = async (blob, key) => {
      calls++;
      if (calls === 2) throw new Error('QuotaExceededError');
      return put(blob, key);
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await importAudioFiles([file('a.mp3'), file('b.mp3')], blobs);
    expect(result.tracks).toHaveLength(1);
    expect(result.rejected).toEqual([{ fileName: 'b.mp3', reason: REASON_NOT_SAVED }]);
    expect(blobs.stored.size).toBe(1);
    expect(warn).toHaveBeenCalled();
  });

  it('con una lista vacía devuelve vacío', async () => {
    await expect(importAudioFiles([], fakeBlobs())).resolves.toEqual({ tracks: [], rejected: [] });
  });
});
