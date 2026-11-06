/**
 * Pruebas del controlador con dependencias falsas mínimas: un store en
 * memoria, un motor cuya posición avanza con `rate` cuando la prueba hace
 * pasar el tiempo, una biblioteca que no decodifica nada y una fachada de
 * render que devuelve canvases vacíos.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AudioEngine, SideAudioSource } from '../audio/engine';
import type { ImportResult } from '../audio/import';
import { orphanBlobKeys } from '../core/blobs';
import { createVinyl, findVinyl, initialAppState, presetNormal, sideOf, track } from '../core/defaults';
import { discGeometry, LEAD_IN_SEC, programSpanMm, timeForRadiusExt } from '../core/geometry';
import { newId } from '../core/ids';
import type { EngineEffects } from '../core/physics';
import { nextShelfIndex, type BlobStore, type Store, type StoreListener } from '../core/store';
import type { AppState, SideId, Track, Vinyl } from '../core/types';
import type { DiscRenderOptions } from '../render/disc';
import type { TurntableFrame } from '../scene/turntable';
import { REST_RADIUS_MM } from '../scene/turntable-geometry';
import {
  COMMIT_INTERVAL_SEC,
  createController,
  NEW_VINYL_TITLE,
  placementWarning,
  rejectedMessage,
  reorderedIds,
  splitTracks,
  TOAST_DECORATIVE,
  TOAST_LARGE_HOLE,
  TOAST_POWER_OFF,
  type Controller,
} from './controller';

// ---------------------------------------------------------------------------
// Dependencias falsas
// ---------------------------------------------------------------------------

interface FakeStore extends Store {
  readonly updates: number;
}

function createFakeStore(): FakeStore {
  let state: AppState = initialAppState();
  let updates = 0;
  const listeners = new Set<StoreListener>();
  const blobMap = new Map<string, Blob>();

  function update(mutate: (draft: AppState) => void): void {
    const draft = structuredClone(state);
    mutate(draft);
    const prev = state;
    state = draft;
    updates++;
    for (const listener of Array.from(listeners)) listener(state, prev);
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
    get updates() {
      return updates;
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update,
    addVinyl(vinyl) {
      const stored = structuredClone(vinyl);
      stored.shelfIndex = nextShelfIndex(state.vinyls);
      update((draft) => {
        draft.vinyls.push(stored);
      });
      return structuredClone(stored);
    },
    async removeVinyl(id) {
      const victim = findVinyl(state, id);
      if (!victim) return [];
      const orphans = orphanBlobKeys(victim, state.vinyls);
      update((draft) => {
        draft.vinyls = draft.vinyls.filter((v) => v.id !== id);
        draft.vinyls.forEach((v, i) => {
          v.shelfIndex = i;
        });
        if (draft.turntable.loaded?.vinylId === id) draft.turntable.loaded = null;
        if (draft.ui.handVinylId === id) draft.ui.handVinylId = null;
        if (draft.ui.editorVinylId === id) draft.ui.editorVinylId = null;
        if (draft.ui.view !== 'room') draft.ui.view = 'room';
      });
      return orphans;
    },
    flush: async () => undefined,
  };
}

/** Motor falso: la posición solo avanza cuando la prueba llama a `advance(dt)`, a la velocidad `rate`. */
class FakeEngine implements AudioEngine {
  ready = true;
  rate = 0;
  position = 0;
  stylus = false;
  volume = 1;
  side: SideAudioSource | null = null;
  unloads = 0;
  readonly seeks: number[] = [];
  readonly effects: EngineEffects[] = [];
  initImpl: () => Promise<void> = async () => undefined;
  private readonly endListeners = new Set<() => void>();

  init(): Promise<void> {
    return this.initImpl();
  }
  async loadSide(source: SideAudioSource): Promise<void> {
    this.side = source;
  }
  unload(): void {
    this.side = null;
    this.unloads++;
  }
  setRate(rate: number): void {
    this.rate = rate;
  }
  setStylus(inGroove: boolean): void {
    this.stylus = inGroove;
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
  setEffects(fx: EngineEffects): void {
    this.effects.push(fx);
  }
  setVolume(v: number): void {
    this.volume = v;
  }
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
  emitEnd(): void {
    for (const cb of Array.from(this.endListeners)) cb();
  }
}

function fakeLibrary() {
  return {
    sideSource: vi.fn(async (vinyl: Vinyl, side: SideId): Promise<SideAudioSource> => {
      const s = sideOf(vinyl, side);
      return {
        gapSec: vinyl.disc.trackGapSec,
        tracks: s.decorative ? [] : s.tracks.map((t) => ({ durationSec: t.durationSec, load: async () => null })),
      };
    }),
    evict: vi.fn<(key: string) => void>(),
  };
}

function fakeRenderers() {
  const canvases = new Map<string, HTMLCanvasElement>();
  return {
    disc: vi.fn((vinyl: Vinyl, opts: DiscRenderOptions) => {
      const key = `${vinyl.id}|${opts.side}|${opts.sizePx}`;
      let canvas = canvases.get(key);
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.width = opts.sizePx;
        canvas.height = opts.sizePx;
        canvases.set(key, canvas);
      }
      return canvas;
    }),
    invalidate: vi.fn<(id?: string) => void>(),
    images: { forget: vi.fn<(key: string) => void>() },
  };
}

// ---------------------------------------------------------------------------
// Utilidades de las pruebas
// ---------------------------------------------------------------------------

const DT = 1 / 60;

function makeVinyl(title = 'Uno', tracksA: Track[] = [track('a1', 30), track('a2', 30)], tracksB: Track[] = [track('b1', 20)]): Vinyl {
  return presetNormal({ artist: 'Prueba', title }, tracksA, tracksB);
}

function setup(vinyls: Vinyl[] = [makeVinyl()]) {
  const store = createFakeStore();
  const stored = vinyls.map((v) => store.addVinyl(v));
  const engine = new FakeEngine();
  const library = fakeLibrary();
  const renderers = fakeRenderers();
  const clock = { now: 1_000_000 };
  const importAudio = vi.fn(async (_files: File[]): Promise<ImportResult> => ({ tracks: [], rejected: [] }));
  const ctrl = createController({
    store,
    engine,
    library,
    renderers,
    turntableView: { discSizePx: (format) => (format === '12' ? 600 : 350) },
    now: () => clock.now,
    importAudio,
  });
  return { store, stored, engine, library, renderers, clock, importAudio, ctrl };
}

/** Hace pasar `seconds` segundos de simulación (el motor avanza antes de cada frame). */
function run(ctrl: Controller, engine: FakeEngine, seconds: number): TurntableFrame {
  let last = ctrl.frame(0);
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    engine.advance(DT);
    last = ctrl.frame(DT);
  }
  return last;
}

const flushPromises = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function loadOnTurntable(ctx: ReturnType<typeof setup>, id: string, side: SideId = 'A'): Promise<void> {
  ctx.ctrl.actions.pickVinyl(id);
  ctx.ctrl.actions.putOnTurntable(side);
  await flushPromises();
}

function vinylIn(store: Store, id: string): Vinyl {
  const v = findVinyl(store.getState(), id);
  if (!v) throw new Error(`No existe el vinilo ${id}`);
  return v;
}

// ---------------------------------------------------------------------------
// Utilidades puras
// ---------------------------------------------------------------------------

describe('utilidades', () => {
  it('splitTracks reparte la primera mitad a la cara A (redondeando hacia arriba)', () => {
    expect(splitTracks([1, 2, 3, 4, 5])).toEqual([[1, 2, 3], [4, 5]]);
    expect(splitTracks([1, 2, 3, 4])).toEqual([[1, 2], [3, 4]]);
    expect(splitTracks([1])).toEqual([[1], []]);
    expect(splitTracks([])).toEqual([[], []]);
  });

  it('reorderedIds mueve un vinilo a la posición destino de la lista ordenada', () => {
    const vs = ['a', 'b', 'c', 'd'].map((id, i) => ({ ...createVinyl(), id, shelfIndex: i }));
    expect(reorderedIds(vs, 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(reorderedIds(vs, 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(reorderedIds(vs, 'b', 99)).toEqual(['a', 'c', 'd', 'b']);
    expect(reorderedIds(vs, 'zz', 0)).toBeNull();
  });

  it('placementWarning avisa de la cara decorativa antes que del centrador', () => {
    const single = makeVinyl();
    single.disc.hole = 'large';
    expect(placementWarning(single, 'A', false)).toBe(TOAST_LARGE_HOLE);
    expect(placementWarning(single, 'A', true)).toBeNull();
    single.disc.sides[1].decorative = true;
    expect(placementWarning(single, 'B', false)).toBe(TOAST_DECORATIVE);
  });

  it('rejectedMessage dice qué archivo falló y qué hacer', () => {
    const one = rejectedMessage([{ fileName: 'nota.txt', reason: 'El navegador no puede reproducir este formato' }]);
    expect(one).toContain('«nota.txt»');
    expect(one).toContain('MP3');
    const many = rejectedMessage([
      { fileName: 'a.txt', reason: 'x' },
      { fileName: 'b.txt', reason: 'x' },
    ]);
    expect(many).toContain('2 archivos');
  });
});

// ---------------------------------------------------------------------------
// Plato, brazo y motor de audio
// ---------------------------------------------------------------------------

describe('putOnTurntable', () => {
  it('carga el disco y devuelve el anterior a la estantería', async () => {
    const ctx = setup([makeVinyl('Uno'), makeVinyl('Dos')]);
    const [v1, v2] = ctx.stored as [Vinyl, Vinyl];

    ctx.ctrl.actions.pickVinyl(v1.id);
    expect(ctx.store.getState().ui).toMatchObject({ view: 'hand', handVinylId: v1.id, handStage: 'jacket-front', handSide: 'A' });
    ctx.ctrl.actions.putOnTurntable('A');
    let state = ctx.store.getState();
    expect(state.turntable.loaded).toEqual({ vinylId: v1.id, side: 'A' });
    expect(state.turntable.tonearm).toMatchObject({ onRest: true, lifted: true });
    expect(state.ui).toMatchObject({ view: 'room', handVinylId: null });
    await flushPromises();
    expect(ctx.library.sideSource).toHaveBeenLastCalledWith(expect.objectContaining({ id: v1.id }), 'A');
    expect(ctx.engine.side?.tracks).toHaveLength(2);
    expect(ctx.engine.position).toBe(-LEAD_IN_SEC);

    ctx.ctrl.actions.pickVinyl(v2.id);
    ctx.ctrl.actions.putOnTurntable('B');
    state = ctx.store.getState();
    expect(state.turntable.loaded).toEqual({ vinylId: v2.id, side: 'B' });
    // El primero ya no está ni en el plato ni en la mano: vuelve a su sitio de la estantería.
    expect(state.ui.handVinylId).toBeNull();
    expect(state.vinyls.map((v) => v.id)).toContain(v1.id);
    await flushPromises();
    expect(ctx.engine.unloads).toBeGreaterThanOrEqual(1);
    expect(ctx.library.sideSource).toHaveBeenLastCalledWith(expect.objectContaining({ id: v2.id }), 'B');
    expect(ctx.engine.side?.tracks).toHaveLength(1);
  });

  it('no carga la cara en el motor hasta que el audio está listo', async () => {
    const ctx = setup();
    ctx.engine.ready = false;
    await loadOnTurntable(ctx, ctx.stored[0]!.id);
    expect(ctx.library.sideSource).not.toHaveBeenCalled();

    ctx.engine.ready = true;
    await ctx.ctrl.initAudio();
    await flushPromises();
    expect(ctx.library.sideSource).toHaveBeenCalledTimes(1);
    expect(ctx.engine.side).not.toBeNull();
    expect(ctx.engine.position).toBe(-LEAD_IN_SEC);
  });

  it('avisa del agujero grande sin centrador y de la cara decorativa', async () => {
    const single = makeVinyl('Single');
    single.disc.hole = 'large';
    single.disc.sides[1].decorative = true;
    const ctx = setup([single]);
    const id = ctx.stored[0]!.id;
    await loadOnTurntable(ctx, id, 'A');
    expect(ctx.store.getState().ui.toast?.text).toBe(TOAST_LARGE_HOLE);
    ctx.ctrl.actions.flipDisc();
    expect(ctx.store.getState().turntable.loaded?.side).toBe('B');
    expect(ctx.store.getState().ui.toast?.text).toBe(TOAST_DECORATIVE);
  });
});

describe('aguja y radio del brazo', () => {
  it('con el brazo en el soporte la aguja no está en el surco', async () => {
    const ctx = setup();
    await loadOnTurntable(ctx, ctx.stored[0]!.id);
    ctx.ctrl.actions.toggleMotor();
    ctx.ctrl.actions.setCue(false);
    const frame = run(ctx.ctrl, ctx.engine, 1);
    expect(frame.state.tonearm.onRest).toBe(true);
    expect(frame.state.tonearm.radiusMm).toBe(REST_RADIUS_MM);
    expect(frame.stylusInGroove).toBe(false);
    expect(ctx.engine.stylus).toBe(false);
    expect(frame.actualRpm).toBeGreaterThan(20);
  });

  it('bajar la aguja en el lead-in con el motor en marcha hace avanzar el brazo hacia dentro', async () => {
    const ctx = setup();
    await loadOnTurntable(ctx, ctx.stored[0]!.id);
    const geo = discGeometry('12');
    const leadIn = programSpanMm(geo).outer + 1; // dentro del surco de entrada
    ctx.ctrl.actions.toggleMotor();
    ctx.ctrl.actions.moveTonearm(leadIn, false);
    ctx.ctrl.actions.setCue(false);

    const first = ctx.ctrl.frame(DT);
    expect(first.stylusInGroove).toBe(true);
    expect(ctx.engine.stylus).toBe(true);
    expect(first.positionSec).toBeLessThan(0);

    const frame = run(ctx.ctrl, ctx.engine, 2);
    expect(frame.state.tonearm.radiusMm).toBeLessThan(programSpanMm(geo).outer);
    expect(frame.positionSec).toBeGreaterThan(0);
    expect(frame.stylusInGroove).toBe(true);
    expect(frame.nowPlaying).toMatchObject({ trackIndex: 0, title: 'a1', artist: 'Prueba' });
    expect(frame.sideName).toBe('Cara A');
    expect(ctx.engine.rate).toBeCloseTo(1, 5);
  });

  it('durante el arrastre el radio sigue a moveTonearm aunque el motor gire', async () => {
    const ctx = setup();
    await loadOnTurntable(ctx, ctx.stored[0]!.id);
    ctx.ctrl.actions.toggleMotor();
    ctx.ctrl.actions.moveTonearm(120, false);
    ctx.ctrl.actions.setCue(false);
    const playing = run(ctx.ctrl, ctx.engine, 1.5);
    expect(playing.state.tonearm.radiusMm).toBeLessThan(120);

    ctx.ctrl.actions.moveTonearm(100, true);
    expect(ctx.engine.position).toBeCloseTo(timeForRadiusExt(discGeometry('12'), 62, 100), 6);
    let frame = run(ctx.ctrl, ctx.engine, 0.5);
    expect(frame.state.tonearm.radiusMm).toBe(100);
    expect(Math.abs(frame.actualRpm)).toBeGreaterThan(30);
    ctx.ctrl.actions.moveTonearm(95, true);
    frame = ctx.ctrl.frame(DT);
    expect(frame.state.tonearm.radiusMm).toBe(95);
    // Durante el arrastre el store no recibe cada movimiento.
    expect(ctx.store.getState().turntable.tonearm.radiusMm).not.toBe(95);

    ctx.ctrl.actions.moveTonearm(95, false);
    expect(ctx.store.getState().turntable.tonearm.radiusMm).toBe(95);
    frame = run(ctx.ctrl, ctx.engine, 0.5);
    expect(frame.state.tonearm.radiusMm).toBeLessThan(95);
  });

  it('con la aguja levantada manda el brazo y al bajarla el motor parte de su radio', async () => {
    const ctx = setup();
    await loadOnTurntable(ctx, ctx.stored[0]!.id);
    ctx.ctrl.actions.toggleMotor();
    ctx.ctrl.actions.moveTonearm(110, false);
    const lifted = run(ctx.ctrl, ctx.engine, 1);
    expect(lifted.state.tonearm.radiusMm).toBe(110);
    expect(lifted.stylusInGroove).toBe(false);

    ctx.ctrl.actions.setCue(false);
    ctx.ctrl.frame(DT);
    expect(ctx.engine.seeks.at(-1)).toBeCloseTo(timeForRadiusExt(discGeometry('12'), 62, 110), 6);
  });

  it('sin el audio listo la posición avanza con un reloj simulado', async () => {
    const ctx = setup();
    ctx.engine.ready = false;
    await loadOnTurntable(ctx, ctx.stored[0]!.id);
    ctx.ctrl.actions.toggleMotor();
    ctx.ctrl.actions.moveTonearm(140, false);
    ctx.ctrl.actions.setCue(false);
    const frame = run(ctx.ctrl, ctx.engine, 2);
    expect(ctx.engine.side).toBeNull();
    expect(frame.state.tonearm.radiusMm).toBeLessThan(140);
    expect(ctx.ctrl.positionSec()).toBeCloseTo(ctx.engine.position, 6);
  });

  it('el pitch se limita a ±8', () => {
    const ctx = setup();
    ctx.ctrl.actions.setPitch(12);
    expect(ctx.store.getState().turntable.pitchPercent).toBe(8);
    ctx.ctrl.actions.setPitch(-20);
    expect(ctx.store.getState().turntable.pitchPercent).toBe(-8);
    ctx.ctrl.actions.setPitch(3.5);
    expect(ctx.store.getState().turntable.pitchPercent).toBe(3.5);
    ctx.ctrl.actions.setPitch(Number.NaN);
    expect(ctx.store.getState().turntable.pitchPercent).toBe(3.5);
  });

  it('la velocidad del programa sigue al selector y al pitch respecto a la nominal del disco', async () => {
    const ctx = setup();
    await loadOnTurntable(ctx, ctx.stored[0]!.id);
    ctx.ctrl.actions.setSpeed(45);
    ctx.ctrl.actions.setPitch(4);
    ctx.ctrl.actions.toggleMotor();
    run(ctx.ctrl, ctx.engine, 3);
    expect(ctx.engine.rate).toBeCloseTo((45 / (100 / 3)) * 1.04, 5);
  });

  it('solo envía los efectos al motor cuando cambian', async () => {
    const ctx = setup();
    // Sin polvo nuevo: el volcado periódico cambiaría (con razón) el crepitar.
    ctx.ctrl.actions.setDustSpeed(0);
    await loadOnTurntable(ctx, ctx.stored[0]!.id);
    run(ctx.ctrl, ctx.engine, 0.5);
    expect(ctx.engine.effects).toHaveLength(1);
    ctx.ctrl.actions.toggleMotor();
    run(ctx.ctrl, ctx.engine, 3);
    const settled = ctx.engine.effects.length;
    expect(settled).toBeGreaterThan(1);
    run(ctx.ctrl, ctx.engine, 1);
    expect(ctx.engine.effects).toHaveLength(settled);
  });

  it('el volumen va al store y al motor', () => {
    const ctx = setup();
    ctx.ctrl.actions.setVolume(1.7);
    expect(ctx.store.getState().turntable.volume).toBe(1);
    expect(ctx.engine.volume).toBe(1);
    ctx.ctrl.actions.setVolume(0.3);
    expect(ctx.engine.volume).toBe(0.3);
  });

  it('apagado, el motor no arranca y se avisa', () => {
    const ctx = setup();
    ctx.ctrl.actions.toggleMotor();
    expect(ctx.store.getState().turntable.motor).toBe(true);
    ctx.ctrl.actions.powerToggle();
    expect(ctx.store.getState().turntable).toMatchObject({ power: false, motor: false });
    ctx.ctrl.actions.toggleMotor();
    expect(ctx.store.getState().turntable.motor).toBe(false);
    expect(ctx.store.getState().ui.toast?.text).toBe(TOAST_POWER_OFF);
  });
});

// ---------------------------------------------------------------------------
// Física: polvo, limpieza y reproducciones
// ---------------------------------------------------------------------------

describe('física del disco', () => {
  it('brushStroke reduce el polvo sin cambiar updatedAt', async () => {
    const dusty = makeVinyl();
    dusty.disc.condition.dust = 0.5;
    const ctx = setup([dusty]);
    const id = ctx.stored[0]!.id;
    await loadOnTurntable(ctx, id);
    const before = vinylIn(ctx.store, id);
    ctx.ctrl.actions.brushStroke(1);
    const after = vinylIn(ctx.store, id);
    expect(after.disc.condition.dust).toBeCloseTo(0.3, 6);
    expect(after.disc.condition.lastCleanedAt).toBe(ctx.clock.now);
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it('con la mano abierta el cepillo limpia el disco de la mano', async () => {
    const ctx = setup([makeVinyl('Uno'), makeVinyl('Dos')]);
    const [v1, v2] = ctx.stored as [Vinyl, Vinyl];
    await loadOnTurntable(ctx, v1.id);
    ctx.ctrl.actions.pickVinyl(v2.id);
    ctx.ctrl.actions.brushStroke(0);
    expect(vinylIn(ctx.store, v2.id).disc.condition.dust).toBe(0);
    expect(vinylIn(ctx.store, v1.id).disc.condition.dust).toBeCloseTo(0.05, 6);
  });

  it('el polvo se acumula localmente y se vuelca cada 2 s sin tocar updatedAt', async () => {
    const ctx = setup([makeVinyl('Uno'), makeVinyl('Dos')]);
    const [v1, v2] = ctx.stored as [Vinyl, Vinyl];
    ctx.ctrl.actions.setDustSpeed(100);
    await loadOnTurntable(ctx, v1.id);
    const start = vinylIn(ctx.store, v1.id);

    run(ctx.ctrl, ctx.engine, COMMIT_INTERVAL_SEC - 0.2);
    expect(vinylIn(ctx.store, v1.id).disc.condition.dust).toBe(start.disc.condition.dust);
    run(ctx.ctrl, ctx.engine, 0.4);
    const after = vinylIn(ctx.store, v1.id);
    // Tapa abierta: 0,0003/s × 100 × ~2 s.
    expect(after.disc.condition.dust - start.disc.condition.dust).toBeCloseTo(0.0003 * 100 * COMMIT_INTERVAL_SEC, 2);
    expect(after.updatedAt).toBe(start.updatedAt);
    // El que está en la estantería (en su funda) no coge polvo.
    expect(vinylIn(ctx.store, v2.id).disc.condition.dust).toBe(v2.disc.condition.dust);

    ctx.ctrl.actions.toggleLid();
    const closedStart = vinylIn(ctx.store, v1.id).disc.condition.dust;
    run(ctx.ctrl, ctx.engine, COMMIT_INTERVAL_SEC + 0.1);
    const closedGain = vinylIn(ctx.store, v1.id).disc.condition.dust - closedStart;
    expect(closedGain).toBeGreaterThan(0);
    expect(closedGain).toBeLessThan(0.0003 * 100 * COMMIT_INTERVAL_SEC / 2);
  });

  it('el final de la cara registra una reproducción una sola vez por carga', async () => {
    const ctx = setup([makeVinyl('Corto', [track('única', 10)], [])]);
    const id = ctx.stored[0]!.id;
    await loadOnTurntable(ctx, id);
    const geo = discGeometry('12');
    ctx.ctrl.actions.toggleMotor();
    run(ctx.ctrl, ctx.engine, 1.5);
    // A 6 s del principio: faltan 4 s para el final.
    ctx.ctrl.actions.moveTonearm(programSpanMm(geo).outer - (programSpanMm(geo).outer - programSpanMm(geo).inner) * 0.6, false);
    ctx.ctrl.actions.setCue(false);
    run(ctx.ctrl, ctx.engine, 5);
    const played = vinylIn(ctx.store, id).disc.condition;
    expect(played.plays).toBe(1);
    expect(played.wear).toBeGreaterThan(0);
    ctx.engine.emitEnd();
    expect(vinylIn(ctx.store, id).disc.condition.plays).toBe(1);
  });

  it('quitar el disco con más de la mitad sonada registra una reproducción parcial', async () => {
    const ctx = setup([makeVinyl('Corto', [track('única', 10)], [])]);
    const id = ctx.stored[0]!.id;
    await loadOnTurntable(ctx, id);
    ctx.ctrl.actions.toggleMotor();
    run(ctx.ctrl, ctx.engine, 1.5);
    ctx.ctrl.actions.moveTonearm(programSpanMm(discGeometry('12')).outer, false);
    ctx.ctrl.actions.setCue(false);
    run(ctx.ctrl, ctx.engine, 7);
    expect(vinylIn(ctx.store, id).disc.condition.plays).toBe(0);
    ctx.ctrl.actions.removeDisc();
    const condition = vinylIn(ctx.store, id).disc.condition;
    expect(condition.plays).toBe(1);
    expect(condition.wear).toBeGreaterThan(0);
    expect(condition.wear).toBeLessThan(0.006);
  });

  it('quitar el disco con menos de la mitad sonada no cuenta como reproducción', async () => {
    const ctx = setup([makeVinyl('Corto', [track('única', 10)], [])]);
    const id = ctx.stored[0]!.id;
    await loadOnTurntable(ctx, id);
    ctx.ctrl.actions.toggleMotor();
    run(ctx.ctrl, ctx.engine, 1.5);
    ctx.ctrl.actions.moveTonearm(programSpanMm(discGeometry('12')).outer, false);
    ctx.ctrl.actions.setCue(false);
    run(ctx.ctrl, ctx.engine, 3);
    ctx.ctrl.actions.removeDisc();
    expect(vinylIn(ctx.store, id).disc.condition).toMatchObject({ plays: 0, wear: 0 });
  });
});

// ---------------------------------------------------------------------------
// Mano, estantería, editor y habitación
// ---------------------------------------------------------------------------

describe('acciones de la colección', () => {
  it('removeDisc deja loaded null y el disco en la mano, fuera de la funda', async () => {
    const ctx = setup();
    const id = ctx.stored[0]!.id;
    await loadOnTurntable(ctx, id, 'B');
    ctx.ctrl.actions.removeDisc();
    const state = ctx.store.getState();
    expect(state.turntable.loaded).toBeNull();
    expect(state.turntable.tonearm.onRest).toBe(true);
    expect(state.ui).toMatchObject({ view: 'hand', handVinylId: id, handStage: 'disc-out', handSide: 'B' });
    expect(ctx.engine.unloads).toBeGreaterThan(0);
    expect(ctx.engine.side).toBeNull();
    const frame = ctx.ctrl.frame(DT);
    expect(frame.discCanvas).toBeNull();
    expect(frame.positionSec).toBe(0);
  });

  it('flipDisc en la mano cambia la cara visible y en el plato recarga la otra cara', async () => {
    const ctx = setup();
    const id = ctx.stored[0]!.id;
    ctx.ctrl.actions.pickVinyl(id);
    ctx.ctrl.actions.flipDisc();
    expect(ctx.store.getState().ui.handSide).toBe('B');
    ctx.ctrl.actions.putOnTurntable('A');
    await flushPromises();
    ctx.ctrl.actions.moveTonearm(120, false);
    ctx.ctrl.actions.flipDisc();
    const state = ctx.store.getState();
    expect(state.turntable.loaded?.side).toBe('B');
    expect(state.turntable.tonearm.onRest).toBe(true);
    await flushPromises();
    expect(ctx.library.sideSource).toHaveBeenLastCalledWith(expect.objectContaining({ id }), 'B');
  });

  it('dropAudioFiles reparte las pistas: primera mitad a la cara A y el resto a la B', async () => {
    const ctx = setup();
    const tracks = ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco'].map((t) => track(t, 30));
    ctx.importAudio.mockResolvedValueOnce({ tracks, rejected: [{ fileName: 'foto.png', reason: 'El navegador no puede reproducir este formato' }] });
    ctx.ctrl.actions.dropAudioFiles([new File(['x'], 'uno.mp3')]);
    await flushPromises();
    const state = ctx.store.getState();
    expect(state.vinyls).toHaveLength(2);
    const created = state.vinyls.find((v) => v.id !== ctx.stored[0]!.id)!;
    expect(created.disc.sides[0].tracks.map((t) => t.title)).toEqual(['Uno', 'Dos', 'Tres']);
    expect(created.disc.sides[1].tracks.map((t) => t.title)).toEqual(['Cuatro', 'Cinco']);
    expect(created.meta.title).toBe('Uno');
    expect(created.disc.sides[0].label.fields.title).toBe('Uno');
    expect(created.spine.text).toBe('Uno');
    expect(state.ui).toMatchObject({ view: 'editor', editorVinylId: created.id, editorTab: 'canciones' });
    expect(state.ui.toast?.text).toContain('«foto.png»');
  });

  it('dropAudioFiles con una sola pista la pone en la cara A', async () => {
    const ctx = setup();
    ctx.importAudio.mockResolvedValueOnce({ tracks: [track('Sola', 12)], rejected: [] });
    ctx.ctrl.actions.dropAudioFiles([new File(['x'], 'sola.wav')]);
    await flushPromises();
    const created = ctx.store.getState().vinyls.at(-1)!;
    expect(created.disc.sides[0].tracks).toHaveLength(1);
    expect(created.disc.sides[1].tracks).toHaveLength(0);
  });

  it('dropAudioFiles sin nada importable avisa y no crea vinilos', async () => {
    const ctx = setup();
    ctx.importAudio.mockResolvedValueOnce({ tracks: [], rejected: [{ fileName: 'a.doc', reason: 'No se pudo leer el archivo' }] });
    ctx.ctrl.actions.dropAudioFiles([new File(['x'], 'a.doc')]);
    await flushPromises();
    expect(ctx.store.getState().vinyls).toHaveLength(1);
    expect(ctx.store.getState().ui.toast?.text).toContain('«a.doc»');
  });

  it('addVinyl crea "Vinilo nuevo" y abre el editor en la pestaña disco', () => {
    const ctx = setup();
    ctx.ctrl.actions.addVinyl();
    const state = ctx.store.getState();
    const created = state.vinyls.at(-1)!;
    expect(created.meta.title).toBe(NEW_VINYL_TITLE);
    expect(created.shelfIndex).toBe(1);
    expect(state.ui).toMatchObject({ view: 'editor', editorVinylId: created.id, editorTab: 'disco' });
  });

  it('cerrar el editor vuelve a la mano si se abrió desde ella, y a la habitación si no', () => {
    const ctx = setup();
    const id = ctx.stored[0]!.id;
    ctx.ctrl.actions.pickVinyl(id);
    ctx.ctrl.actions.edit();
    expect(ctx.store.getState().ui).toMatchObject({ view: 'editor', editorVinylId: id });
    ctx.ctrl.actions.closeOverlays();
    expect(ctx.store.getState().ui).toMatchObject({ view: 'hand', handVinylId: id, editorVinylId: null });
    ctx.ctrl.actions.closeOverlays();
    expect(ctx.store.getState().ui).toMatchObject({ view: 'room', handVinylId: null });

    ctx.ctrl.actions.openEditor(id);
    ctx.ctrl.actions.close();
    expect(ctx.store.getState().ui).toMatchObject({ view: 'room', editorVinylId: null });
  });

  it('reorder renumera 0..n−1 sin tocar updatedAt', () => {
    const ctx = setup([makeVinyl('Uno'), makeVinyl('Dos'), makeVinyl('Tres')]);
    const [v1, v2, v3] = ctx.stored as [Vinyl, Vinyl, Vinyl];
    ctx.ctrl.actions.reorder(v3.id, 0);
    const state = ctx.store.getState();
    const index = (id: string) => vinylIn(ctx.store, id).shelfIndex;
    expect([index(v3.id), index(v1.id), index(v2.id)]).toEqual([0, 1, 2]);
    expect(state.vinyls.map((v) => v.updatedAt)).toEqual(expect.arrayContaining([v1.updatedAt, v2.updatedAt, v3.updatedAt]));
    const updates = ctx.store.updates;
    ctx.ctrl.actions.reorder(v3.id, 0);
    expect(ctx.store.updates).toBe(updates);
  });

  it('removeVinyl vacía las cachés y descarga el motor si estaba en el plato', async () => {
    const withAudio = makeVinyl('Con audio', [track('a', 20, { blobKey: 'blob_audio', mimeType: 'audio/wav', fileName: 'a.wav' })], []);
    withAudio.jacket.front = { kind: 'image', image: { blobKey: 'blob_portada' }, fit: 'cover', backdrop: '#000000' };
    const ctx = setup([withAudio]);
    const id = ctx.stored[0]!.id;
    await loadOnTurntable(ctx, id);
    await ctx.ctrl.actions.removeVinyl(id);
    expect(ctx.store.getState().vinyls).toHaveLength(0);
    expect(ctx.renderers.images.forget).toHaveBeenCalledWith('blob_audio');
    expect(ctx.renderers.images.forget).toHaveBeenCalledWith('blob_portada');
    expect(ctx.library.evict).toHaveBeenCalledWith('blob_audio');
    expect(ctx.renderers.invalidate).toHaveBeenCalledWith(id);
    expect(ctx.engine.side).toBeNull();
  });

  it('un borrado hecho directamente en el store también vacía las cachés', async () => {
    const withAudio = makeVinyl('Con audio', [track('a', 20, { blobKey: 'blob_audio', mimeType: 'audio/wav', fileName: 'a.wav' })], []);
    const ctx = setup([withAudio]);
    const id = ctx.stored[0]!.id;
    await loadOnTurntable(ctx, id);
    await ctx.store.removeVinyl(id);
    expect(ctx.library.evict).toHaveBeenCalledWith('blob_audio');
    expect(ctx.renderers.invalidate).toHaveBeenCalledWith(id);
    expect(ctx.engine.side).toBeNull();
  });

  it('initAudio muestra el error una vez y, al quedar listo, carga la cara del plato', async () => {
    const ctx = setup();
    ctx.engine.ready = false;
    ctx.engine.initImpl = () => Promise.reject(new Error('El sonido necesita https o localhost'));
    await loadOnTurntable(ctx, ctx.stored[0]!.id);
    await ctx.ctrl.initAudio();
    const toast = ctx.store.getState().ui.toast;
    expect(toast?.text).toBe('El sonido necesita https o localhost');
    await ctx.ctrl.initAudio();
    expect(ctx.store.getState().ui.toast).toBe(toast);

    ctx.engine.initImpl = async () => {
      ctx.engine.ready = true;
    };
    await ctx.ctrl.initAudio();
    await flushPromises();
    expect(ctx.engine.side).not.toBeNull();
  });

  it('el frame pide el canvas del disco al tamaño de la vista, sin eje ni centrador', async () => {
    const ctx = setup();
    await loadOnTurntable(ctx, ctx.stored[0]!.id);
    const frame = ctx.ctrl.frame(DT);
    expect(frame.discCanvas?.width).toBe(600);
    expect(frame.discFormat).toBe('12');
    expect(ctx.renderers.disc).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: ctx.stored[0]!.id }),
      expect.objectContaining({ sizePx: 600, side: 'A', adapter45: false, spindle: false, quality: 'high', showDust: true }),
    );
  });
});
