/**
 * Pruebas de la colección de demostración con el store real sobre
 * fake-indexeddb. happy-dom no tiene OfflineAudioContext, así que
 * `seedDemoCollection` crea las pistas sin audio; con un sintetizador falso
 * (Blob de Node, que sí sobrevive a structuredClone) se prueba el camino con
 * audio.
 */
import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { DEMO_SAMPLE_RATE, type DemoTrackSpec } from '../audio/demo';
import { maxRingWidthMm } from '../core/geometry';
import { newId } from '../core/ids';
import { createStore, sortedByShelf, type Store } from '../core/store';
import type { Vinyl } from '../core/types';
import { DEMO_ALBUMS, DEMO_LABEL_NAME, DEMO_TRACK_COUNT, seedDemoCollection, seedDemoCollectionWith } from './seed';

async function freshStore(): Promise<Store> {
  const store = createStore({ dbName: `test-seed-${newId()}`, debounceMs: 0 });
  await store.ready;
  return store;
}

function allTracks(vinyls: Vinyl[]) {
  return vinyls.flatMap((v) => v.disc.sides.flatMap((s) => s.tracks));
}

function wavBlob(): Blob {
  return new NodeBlob([new Uint8Array(64)], { type: 'audio/wav' }) as unknown as Blob;
}

describe('seedDemoCollection', () => {
  it('sin OfflineAudioContext crea 3 vinilos con 11 pistas sin audio', async () => {
    expect(typeof (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext).toBe('undefined');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = await freshStore();
    const added = await seedDemoCollection(store);

    const vinyls = sortedByShelf(store.getState().vinyls);
    expect(added).toHaveLength(3);
    expect(vinyls.map((v) => v.id)).toEqual(added.map((v) => v.id));
    expect(vinyls.map((v) => v.shelfIndex)).toEqual([0, 1, 2]);
    const tracks = allTracks(vinyls);
    expect(tracks).toHaveLength(11);
    expect(DEMO_TRACK_COUNT).toBe(11);
    for (const t of tracks) {
      expect(t.audio).toBeNull();
      expect(t.durationSec).toBeGreaterThanOrEqual(20);
      expect(t.durationSec).toBeLessThanOrEqual(40);
    }
    // Sin OfflineAudioContext las pistas mudas son lo esperado: no se avisa.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('cubre los tres tipos de vinilo pedidos con datos ficticios de demostración', async () => {
    const store = await freshStore();
    const [normal, ring, full] = await seedDemoCollection(store);

    expect(normal?.disc).toMatchObject({ format: '12', nativeRpm: 33 });
    expect(normal?.disc.sides.map((s) => [s.decoration, s.tracks.length])).toEqual([
      ['normal', 3],
      ['normal', 2],
    ]);

    expect(ring?.disc).toMatchObject({ format: '7', nativeRpm: 45, hole: 'large' });
    expect(ring?.disc.sides.map((s) => [s.decoration, s.tracks.length])).toEqual([
      ['ring', 2],
      ['ring', 2],
    ]);
    for (const side of ring?.disc.sides ?? []) expect(side.ring.widthMm).toBeLessThanOrEqual(maxRingWidthMm('7'));

    expect(full?.disc).toMatchObject({ format: '12', nativeRpm: 33, weightGrams: 160 });
    expect(full?.disc.sides[0]).toMatchObject({ decoration: 'full', decorative: false });
    expect(full?.disc.sides[0].tracks).toHaveLength(2);
    expect(full?.disc.sides[1]).toMatchObject({ decoration: 'full', decorative: true, tracks: [] });

    const catalog = [normal, ring, full].map((v) => v?.meta.catalogNumber);
    expect(catalog).toEqual(['DT-1001', 'DT-1002', 'DT-1003']);
    for (const v of [normal, ring, full]) {
      expect(v?.meta.labelName).toBe(DEMO_LABEL_NAME);
      expect(v?.meta.notes).toContain('demostración');
      expect(v?.disc.sides[0].label.fields.brand).toBe(DEMO_LABEL_NAME);
      expect(v?.spine.text).toBe(`${v?.meta.artist} — ${v?.meta.title}`);
    }
  });

  it('el plan cabe en ~25 MB de WAV mono a 32 kHz y respeta 3 pistas por cara', () => {
    let seconds = 0;
    for (const album of DEMO_ALBUMS) {
      expect(album.sideA.length).toBeLessThanOrEqual(3);
      expect(album.sideB.length).toBeLessThanOrEqual(3);
      for (const t of [...album.sideA, ...album.sideB]) seconds += t.durationSec;
    }
    expect(seconds * DEMO_SAMPLE_RATE * 2).toBeLessThanOrEqual(25 * 1024 * 1024);
  });
});

describe('seedDemoCollectionWith', () => {
  it('guarda cada pista sintetizada en el almacén de blobs como audio/wav', async () => {
    const store = await freshStore();
    const specs: DemoTrackSpec[] = [];
    const vinyls = await seedDemoCollectionWith(store, async (spec) => {
      specs.push(spec);
      return wavBlob();
    });
    const tracks = allTracks(vinyls);
    expect(specs).toHaveLength(11);
    expect(new Set(specs.map((s) => s.seed)).size).toBe(11);
    for (const t of tracks) {
      expect(t.audio).toMatchObject({ mimeType: 'audio/wav' });
      expect(t.audio?.fileName).toMatch(/^dt-100\d-[ab]\d\.wav$/);
      expect(await store.blobs.get(t.audio!.blobKey)).not.toBeNull();
    }
    for (const spec of specs) {
      const planned = DEMO_ALBUMS.flatMap((a) => [...a.sideA, ...a.sideB]).find((p) => p.seed === spec.seed);
      expect(spec.durationSec).toBe(planned?.durationSec);
    }
  });

  it('no sintetiza más pistas a la vez que la concurrencia pedida', async () => {
    const store = await freshStore();
    let active = 0;
    let peak = 0;
    await seedDemoCollectionWith(
      store,
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active--;
        return wavBlob();
      },
      2,
    );
    expect(peak).toBe(2);
  });

  it('una pista que no se puede sintetizar queda muda con su duración prevista', async () => {
    const store = await freshStore();
    let calls = 0;
    const vinyls = await seedDemoCollectionWith(store, async () => {
      calls++;
      if (calls === 1) throw new Error('fallo de síntesis');
      return wavBlob();
    });
    const tracks = allTracks(vinyls);
    expect(tracks.filter((t) => t.audio === null)).toHaveLength(1);
    expect(tracks.every((t) => t.durationSec >= 20)).toBe(true);
  });
});
