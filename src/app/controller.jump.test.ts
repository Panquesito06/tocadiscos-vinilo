import { describe, expect, it } from 'vitest';
/**
 * Pruebas de regresión: saltos del brazo mientras suena. Reutilizan la misma
 * idea de dependencias falsas que src/app/controller.test.ts.
 */
import type { AudioEngine, SideAudioSource } from '../audio/engine';
import { findVinyl, initialAppState, presetNormal, sideOf, track } from '../core/defaults';
import { discGeometry, programSpanMm, timeForRadiusExt } from '../core/geometry';
import { newId } from '../core/ids';
import type { EngineEffects } from '../core/physics';
import { nextShelfIndex, type BlobStore, type Store, type StoreListener } from '../core/store';
import type { AppState, SideId, Track, Vinyl } from '../core/types';
import { createController, type Controller } from './controller';

function createFakeStore(): Store {
  let state: AppState = initialAppState();
  const listeners = new Set<StoreListener>();
  const blobMap = new Map<string, Blob>();
  function update(mutate: (draft: AppState) => void): void {
    const draft = structuredClone(state);
    mutate(draft);
    const prev = state;
    state = draft;
    for (const l of Array.from(listeners)) l(state, prev);
  }
  const blobs: BlobStore = {
    async put(blob, key = newId('blob')) {
      blobMap.set(key, blob);
      return key;
    },
    async get(key) {
      return blobMap.get(key) ?? null;
    },
    async delete(key) {
      blobMap.delete(key);
    },
    async url() {
      return null;
    },
    cachedUrl() {
      return null;
    },
  };
  return {
    ready: Promise.resolve(),
    blobs,
    getState: () => state,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    update,
    addVinyl(vinyl) {
      const stored = structuredClone(vinyl);
      stored.shelfIndex = nextShelfIndex(state.vinyls);
      update((d) => {
        d.vinyls.push(stored);
      });
      return structuredClone(stored);
    },
    async removeVinyl() {
      return [];
    },
    flush: async () => undefined,
  };
}

class FakeEngine implements AudioEngine {
  ready = true;
  rate = 0;
  position = 0;
  stylus = false;
  side: SideAudioSource | null = null;
  readonly seeks: number[] = [];
  private readonly endListeners = new Set<() => void>();
  init(): Promise<void> {
    return Promise.resolve();
  }
  async loadSide(source: SideAudioSource): Promise<void> {
    this.side = source;
  }
  unload(): void {
    this.side = null;
  }
  setRate(rate: number): void {
    this.rate = rate;
  }
  setStylus(v: boolean): void {
    this.stylus = v;
  }
  seekSec(t: number): void {
    this.position = t;
    this.seeks.push(t);
  }
  getPositionSec(): number {
    return this.position;
  }
  getDurationSec(): number {
    return 0;
  }
  setEffects(_fx: EngineEffects): void {}
  setVolume(): void {}
  onPosition(): () => void {
    return () => undefined;
  }
  onEnd(cb: () => void): () => void {
    this.endListeners.add(cb);
    return () => this.endListeners.delete(cb);
  }
  getContext(): AudioContext | null {
    return null;
  }
  destroy(): void {}
  advance(dt: number): void {
    this.position += this.rate * dt;
  }
}

const DT = 1 / 60;

function setup(vinyl: Vinyl) {
  const store = createFakeStore();
  const stored = store.addVinyl(vinyl);
  const engine = new FakeEngine();
  const ctrl = createController({
    store,
    engine,
    library: {
      sideSource: async (v: Vinyl, side: SideId) => {
        const s = sideOf(v, side);
        return { gapSec: v.disc.trackGapSec, tracks: s.tracks.map((t) => ({ durationSec: t.durationSec, load: async () => null })) };
      },
      evict: () => undefined,
    },
    renderers: {
      disc: () => document.createElement('canvas'),
      invalidate: () => undefined,
      images: { forget: () => undefined },
    },
    turntableView: { discSizePx: () => 600 },
    now: () => 1_000_000,
  });
  return { store, engine, ctrl, id: stored.id };
}

function run(ctrl: Controller, engine: FakeEngine, seconds: number): void {
  ctrl.frame(0);
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    engine.advance(DT);
    ctrl.frame(DT);
  }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function condition(store: Store, id: string) {
  return findVinyl(store.getState(), id)!.disc.condition;
}

async function playing(tracks: Track[]) {
  const ctx = setup(presetNormal({ title: 'X' }, tracks, []));
  ctx.ctrl.actions.setDustSpeed(0);
  ctx.ctrl.actions.pickVinyl(ctx.id);
  ctx.ctrl.actions.putOnTurntable('A');
  await flush();
  ctx.ctrl.actions.toggleMotor();
  run(ctx.ctrl, ctx.engine, 1.5); // el plato llega a 33⅓
  const geo = discGeometry('12');
  ctx.ctrl.actions.moveTonearm(programSpanMm(geo).outer, false);
  ctx.ctrl.actions.setCue(false);
  run(ctx.ctrl, ctx.engine, 2); // suenan ~2 s
  return { ...ctx, geo };
}

describe('saltos del brazo con el teclado mientras suena', () => {
  it('saltar hacia dentro con el teclado y quitar el disco no cuenta lo saltado como sonado', async () => {
    const ctx = await playing([track('a1', 30), track('a2', 30)]); // 62 s con el hueco
    // Cinco pulsaciones de AvPág (10 mm cada una, como stepTonearm de la vista).
    let r = ctx.store.getState().turntable.tonearm.radiusMm;
    const live = () => timeForRadiusExt(ctx.geo, 62, r);
    for (let i = 0; i < 5; i++) {
      r = Math.max(56, (ctx.ctrl.frame(DT).state.tonearm.radiusMm) - 10);
      ctx.ctrl.actions.moveTonearm(r, false);
      ctx.engine.advance(DT);
      ctx.ctrl.frame(DT);
    }
    expect(live()).toBeGreaterThan(31); // ha saltado más de la mitad de la cara
    // Sonado de verdad: ~2 s + 5 frames. Lo que se ha saltado no se ha oído.
    ctx.ctrl.actions.removeDisc();
    const c = condition(ctx.store, ctx.id);
    expect(c.plays).toBe(0);
    expect(c.wear).toBe(0);
  });

  it('saltar con el teclado al surco de salida no cuenta como cara completa', async () => {
    const ctx = await playing([track('a1', 30), track('a2', 30)]);
    ctx.ctrl.actions.moveTonearm(61, false); // lead-out del 12" (60..63 mm)
    ctx.engine.advance(DT);
    ctx.ctrl.frame(DT);
    const c = condition(ctx.store, ctx.id);
    expect(c.plays).toBe(0);
  });

  it('el mismo salto arrastrando el cabezal tampoco cuenta', async () => {
    const ctx = await playing([track('a1', 30), track('a2', 30)]);
    ctx.ctrl.actions.moveTonearm(61, true);
    ctx.ctrl.frame(DT);
    ctx.ctrl.actions.moveTonearm(61, false);
    ctx.engine.advance(DT);
    ctx.ctrl.frame(DT);
    expect(condition(ctx.store, ctx.id).plays).toBe(0);
  });
});
