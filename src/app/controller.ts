/**
 * Controlador de la aplicación: el bucle físico del tocadiscos y todas las
 * acciones que emiten las vistas. Es lo único (junto con `app.ts`) que toca
 * el store y el motor de audio; está separado del montaje para poder
 * probarlo con dependencias falsas.
 *
 * Reglas del bucle (`frame(dt)`), en este orden:
 *  1. Plato: `stepPlatter()` con motor = encendido && marcha, velocidad
 *     objetivo `rpmValue(selector) × (1 + pitch/100)`, la mano (scratch) y
 *     el rozamiento de la aguja.
 *  2. `engine.setRate(rpm / rpmValue(disco.nativeRpm))`, o 0 sin disco.
 *  3. Radio del brazo ("radio vivo", variable local, fuera del store):
 *       a) mientras se arrastra el cabezal, b) con la aguja levantada o fuera
 *       del surco, c) con el plato parado (|rpm| < 0,5) o d) con una cara sin
 *       pistas, manda el brazo (cada `moveTonearm` hace `seekSec`); si no,
 *       el radio sigue la posición del motor con `radiusForTimeExt`. Cuando
 *       el brazo cede el mando al motor se hace `seekSec` al radio actual.
 *     Sin contexto de audio listo o sin la cara instalada en el motor, la
 *     posición avanza con un reloj simulado (`seekSec(pos + rate·dt)`), así
 *     el brazo se mueve aunque no suene.
 *  4. Aguja en el surco: hay disco, cara no decorativa, brazo fuera del
 *     soporte, palanca abajo y radio en lead-in/program/lead-out. Al cambiar,
 *     `engine.setStylus`.
 *  5. `engine.setEffects(effectsFor(...))` solo si cambian al redondear a
 *     3 decimales.
 *  6. Polvo: exposición acumulada localmente (mano con el disco fuera o
 *     plato con la tapa abierta = `open`; plato con la tapa cerrada =
 *     `lid-closed`) y volcada al store cada 2 s junto con el radio del brazo,
 *     sin tocar `updatedAt`.
 *
 * Fin de cara: `registerPlay(disco, 1)` como mucho una vez por carga de la
 * cara; al quitar el disco o darle la vuelta con más de la mitad sonada y
 * sin haber llegado al final, `registerPlay(disco, fracción)`.
 */
import type { AudioEngine } from '../audio/engine';
import { importAudioFiles, type ImportResult } from '../audio/import';
import type { AudioLibrary } from '../audio/library';
import { collectBlobKeys, isBlobKeyInUse } from '../core/blobs';
import { createVinyl, findVinyl, sideOf, syncDerivedTexts } from '../core/defaults';
import {
  discGeometry,
  LEAD_IN_SEC,
  LEAD_OUT_SEC,
  radiusForTimeExt,
  sideDurationSec,
  timeForRadiusExt,
  trackIndexAtTime,
  zoneForRadius,
  type DiscGeometry,
  type GrooveZone,
} from '../core/geometry';
import {
  accumulateDust,
  cleanStroke,
  effectsFor,
  registerPlay,
  rpmValue,
  SILENT_EFFECTS,
  wobbleAmount,
  type EngineEffects,
  type Exposure,
} from '../core/physics';
import { INITIAL_PLATTER, stepPlatter, type PlatterState } from '../core/platter';
import { sortedByShelf, type Store } from '../core/store';
import type {
  AppState,
  EditorTab,
  HandStage,
  Rpm,
  Side,
  SideId,
  TonearmState,
  Track,
  TurntableState,
  Vinyl,
} from '../core/types';
import type { EditorDeps } from '../editor/editor';
import type { Renderers } from '../render';
import type { ImageCache } from '../render/images';
import type { HandActions } from '../scene/hand';
import type { RoomActions } from '../scene/room';
import type { ShelfActions } from '../scene/shelf';
import type { TurntableActions, TurntableFrame, TurntableView } from '../scene/turntable';
import { REST_RADIUS_MM } from '../scene/turntable-geometry';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

/** Todas las acciones que emiten las vistas, más las que el editor recibe. */
export type AppActions = TurntableActions &
  ShelfActions &
  HandActions &
  RoomActions &
  Pick<EditorDeps, 'close' | 'importAudio'> & {
    /** Elimina un vinilo y vacía sus cachés (imágenes, audio, render, motor). */
    removeVinyl(id: string): Promise<void>;
  };

export interface ControllerDeps {
  store: Store;
  engine: AudioEngine;
  library: Pick<AudioLibrary, 'sideSource' | 'evict'>;
  renderers: Pick<Renderers, 'disc' | 'invalidate'> & { readonly images: Pick<ImageCache, 'forget'> };
  turntableView: Pick<TurntableView, 'discSizePx'>;
  /** Reloj en ms (Date.now por defecto). */
  now?: () => number;
  /** Importación de audio (por defecto `importAudioFiles` sobre `store.blobs`). */
  importAudio?: (files: File[]) => Promise<ImportResult>;
}

export interface Controller {
  readonly actions: AppActions;
  /** Avanza la simulación `dtSec` segundos y devuelve lo que dibuja el tocadiscos. */
  frame(dtSec: number): TurntableFrame;
  /** Arranca el audio (llamar dentro de un gesto del usuario). */
  initAudio(): Promise<void>;
  /** Vuelca al store el polvo acumulado y el radio del brazo (antes de guardar). */
  commit(): void;
  /** Posición actual de la cara cargada en la línea de tiempo extendida (s). */
  positionSec(): number;
  /** Muestra un aviso breve en pantalla. */
  notify(text: string): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Constantes y textos
// ---------------------------------------------------------------------------

/** Por debajo de esta velocidad el plato se considera parado y manda el brazo. */
export const STOPPED_RPM = 0.5;
/** Cada cuánto se vuelcan al store el polvo y el radio del brazo. */
export const COMMIT_INTERVAL_SEC = 2;
/** Límite del ajuste fino de velocidad, en %. */
export const PITCH_LIMIT = 8;
/** Velocidad máxima de la simulación de polvo (minutos simulados por minuto real). */
export const MAX_DUST_SPEED = 1000;

export const TOAST_LARGE_HOLE = 'Este single tiene el agujero grande: pon el centrador';
export const TOAST_DECORATIVE = 'Esta cara es decorativa: no suena';
export const TOAST_POWER_OFF = 'El tocadiscos está apagado: pulsa el botón de encendido';
export const NEW_VINYL_TITLE = 'Vinilo nuevo';

const IN_GROOVE_ZONES: ReadonlySet<GrooveZone> = new Set<GrooveZone>(['lead-in', 'program', 'lead-out']);
const RPMS: readonly Rpm[] = [33, 45, 78];
const HAND_STAGES: readonly HandStage[] = ['jacket-front', 'jacket-back', 'gatefold', 'inner-out', 'disc-out'];
const EFFECT_KEYS: readonly (keyof EngineEffects)[] = [
  'crackleRate',
  'crackleGain',
  'hissGain',
  'rumbleGain',
  'wobbleDepth',
  'wobbleHz',
  'clickRate',
  'clickGain',
];
/** Diferencia mínima de radio (mm) que merece una escritura en el store. */
const RADIUS_EPSILON_MM = 0.01;

// ---------------------------------------------------------------------------
// Utilidades puras (exportadas para las pruebas)
// ---------------------------------------------------------------------------

/** Reparte pistas entre las dos caras: primera mitad (redondeando hacia arriba) a la A, el resto a la B. */
export function splitTracks<T>(tracks: readonly T[]): [T[], T[]] {
  if (tracks.length <= 1) return [[...tracks], []];
  const half = Math.ceil(tracks.length / 2);
  return [tracks.slice(0, half), tracks.slice(half)];
}

/** Orden de la estantería tras mover `id` a la posición `newIndex` (acotada). */
export function reorderedIds(vinyls: readonly Vinyl[], id: string, newIndex: number): string[] | null {
  const order = sortedByShelf(vinyls).map((v) => v.id);
  const from = order.indexOf(id);
  if (from < 0) return null;
  order.splice(from, 1);
  const target = Number.isFinite(newIndex) ? Math.round(newIndex) : from;
  order.splice(clamp(target, 0, order.length), 0, id);
  return order;
}

/** Aviso al poner una cara en el plato, o null si no hace falta. */
export function placementWarning(vinyl: Vinyl, side: SideId, adapter45: boolean): string | null {
  if (sideOf(vinyl, side).decorative) return TOAST_DECORATIVE;
  if (vinyl.disc.hole === 'large' && !adapter45) return TOAST_LARGE_HOLE;
  return null;
}

/** Texto del aviso para los archivos que no se pudieron importar. */
export function rejectedMessage(rejected: readonly { fileName: string; reason: string }[]): string {
  const hint = 'Prueba con MP3, WAV, OGG o FLAC.';
  const [first] = rejected;
  if (!first) return '';
  if (rejected.length === 1) return `No se pudo importar «${first.fileName}»: ${first.reason}. ${hint}`;
  const names = rejected.slice(0, 3).map((r) => `«${r.fileName}»`);
  const more = rejected.length > 3 ? ` y ${rejected.length - 3} más` : '';
  return `No se pudieron importar ${rejected.length} archivos (${names.join(', ')}${more}): ${first.reason}. ${hint}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function otherSide(side: SideId): SideId {
  return side === 'A' ? 'B' : 'A';
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function restTonearm(): TonearmState {
  return { onRest: true, lifted: true, radiusMm: REST_RADIUS_MM };
}

function initialRadius(tonearm: TonearmState): number {
  return tonearm.onRest || !Number.isFinite(tonearm.radiusMm) ? REST_RADIUS_MM : tonearm.radiusMm;
}

// ---------------------------------------------------------------------------
// Disco cargado
// ---------------------------------------------------------------------------

interface LoadedDisc {
  vinyl: Vinyl;
  sideId: SideId;
  side: Side;
  geo: DiscGeometry;
  durationSec: number;
}

function loadedDiscOf(state: AppState): LoadedDisc | null {
  const loaded = state.turntable.loaded;
  if (!loaded) return null;
  const vinyl = findVinyl(state, loaded.vinylId);
  if (!vinyl) return null;
  const side = sideOf(vinyl, loaded.side);
  return {
    vinyl,
    sideId: loaded.side,
    side,
    geo: discGeometry(vinyl.disc.format),
    durationSec: sideDurationSec(side, vinyl.disc.trackGapSec),
  };
}

function timeAt(disc: LoadedDisc, radiusMm: number): number {
  return timeForRadiusExt(disc.geo, disc.durationSec, radiusMm);
}

function isStylusInGroove(disc: LoadedDisc | null, tonearm: TonearmState, radiusMm: number): boolean {
  if (!disc || disc.side.decorative || tonearm.onRest || tonearm.lifted) return false;
  return IN_GROOVE_ZONES.has(zoneForRadius(disc.geo, radiusMm));
}

/** Firma de lo que el motor necesita de una cara: si cambia, hay que recargarla. */
function sideSignature(disc: LoadedDisc): string {
  const tracks = disc.side.tracks.map((t) => `${t.id}:${t.durationSec}:${t.audio?.blobKey ?? ''}`).join(',');
  return `${disc.vinyl.id}|${disc.sideId}|${disc.side.decorative ? 'd' : 's'}|${disc.vinyl.disc.trackGapSec}|${tracks}`;
}

function findDraftVinyl(draft: AppState, id: string): Vinyl | undefined {
  return draft.vinyls.find((v) => v.id === id);
}

// ---------------------------------------------------------------------------
// Controlador
// ---------------------------------------------------------------------------

type DustExposure = Exclude<Exposure, 'sleeved'>;

export function createController(deps: ControllerDeps): Controller {
  const { store, engine, library, renderers, turntableView } = deps;
  const now = deps.now ?? (() => Date.now());
  const importAudio = deps.importAudio ?? ((files: File[]) => importAudioFiles(files, store.blobs));

  // --- Estado local del bucle (nunca en el store a 60 Hz) -----------------
  let platter: PlatterState = INITIAL_PLATTER;
  let handDegPerSec: number | null = null;
  let dragging = false;
  let liveRadius = initialRadius(store.getState().turntable.tonearm);
  let stylusDown = false;
  /** El brazo mandaba en el frame anterior (a, b, c): al ceder, se hace seek. */
  let armDrives = true;
  let lastEnginePos = 0;
  let lastPositionSec = 0;
  let lastEffects: EngineEffects | null = null;

  // --- Cara instalada en el motor ----------------------------------------
  let engineKey: string | null = null;
  let pendingKey: string | null = null;
  let failedKey: string | null = null;
  let loadToken = 0;
  let signatureMemo: { input: string; signature: string } | null = null;

  // --- Reproducción de la cara cargada -------------------------------------
  let sideRef: string | null = null;
  let endRegistered = false;
  let playedSec = 0;

  // --- Física diferida -----------------------------------------------------
  const pendingDust = new Map<string, Record<DustExposure, number>>();
  let sinceCommit = 0;
  let lastAudioError: string | null = null;

  engine.setVolume(store.getState().turntable.volume);

  // -------------------------------------------------------------------------
  // Utilidades de estado
  // -------------------------------------------------------------------------

  function notify(text: string): void {
    store.update((draft) => {
      draft.ui.toast = { text, at: now() };
    });
  }

  function resetSideFlags(): void {
    endRegistered = false;
    playedSec = 0;
  }

  /** Reinicia las banderas de reproducción si la cara cargada ha cambiado. */
  function noteSide(disc: LoadedDisc | null): void {
    const ref = disc ? `${disc.vinyl.id}|${disc.sideId}` : null;
    if (ref === sideRef) return;
    sideRef = ref;
    resetSideFlags();
  }

  /** Fracción sonada que merece registrarse al retirar la cara (más de la mitad y sin llegar al final). */
  function partialPlayFraction(disc: LoadedDisc): number | null {
    if (endRegistered || disc.durationSec <= 0) return null;
    const fraction = playedSec / disc.durationSec;
    return fraction > 0.5 ? Math.min(1, fraction) : null;
  }

  function applyPlay(draft: AppState, vinylId: string, fraction: number): void {
    const v = findDraftVinyl(draft, vinylId);
    if (v) v.disc.condition = registerPlay(v.disc, fraction);
  }

  function setStylus(down: boolean): void {
    if (down === stylusDown) return;
    stylusDown = down;
    engine.setStylus(down);
  }

  function placeArmOnRest(): void {
    dragging = false;
    liveRadius = REST_RADIUS_MM;
  }

  // -------------------------------------------------------------------------
  // Motor de audio: cara instalada
  // -------------------------------------------------------------------------

  function engineSideKey(disc: LoadedDisc | null): string | null {
    if (!disc) return null;
    const input = `${disc.vinyl.id}|${disc.sideId}|${disc.vinyl.updatedAt}`;
    if (signatureMemo?.input !== input) signatureMemo = { input, signature: sideSignature(disc) };
    return signatureMemo.signature;
  }

  function unloadEngine(): void {
    loadToken++;
    pendingKey = null;
    engineKey = null;
    engine.unload();
  }

  /** Deja el motor con la cara que hay en el plato (la carga solo con el audio listo). */
  function syncEngineSide(disc: LoadedDisc | null): void {
    const want = engineSideKey(disc);
    if (pendingKey !== null && pendingKey !== want) {
      loadToken++;
      pendingKey = null;
    }
    if (engineKey !== null && engineKey !== want) unloadEngine();
    if (!disc || want === null || want === engineKey || want === pendingKey || want === failedKey) return;
    if (!engine.ready) return;
    void loadIntoEngine(disc, want);
  }

  async function loadIntoEngine(disc: LoadedDisc, key: string): Promise<void> {
    const token = ++loadToken;
    pendingKey = key;
    try {
      const source = await library.sideSource(disc.vinyl, disc.sideId);
      if (token !== loadToken) return;
      pendingKey = null;
      engineKey = key;
      await engine.loadSide(source);
      if (token !== loadToken) return;
      const current = loadedDiscOf(store.getState());
      if (current) engine.seekSec(timeAt(current, liveRadius));
    } catch (error) {
      if (token !== loadToken) return;
      if (engineKey === key) engine.unload();
      pendingKey = null;
      engineKey = null;
      failedKey = key;
      console.warn('Tocadiscos: no se pudo preparar el sonido de la cara.', error);
      notify(`No se pudo preparar el sonido de esta cara: ${messageOf(error)}`);
    }
  }

  function engineHasSide(disc: LoadedDisc): boolean {
    return engine.ready && engineKey !== null && engineKey === engineSideKey(disc);
  }

  // -------------------------------------------------------------------------
  // Fin de cara
  // -------------------------------------------------------------------------

  function registerEnd(disc: LoadedDisc): void {
    if (endRegistered) return;
    endRegistered = true;
    const id = disc.vinyl.id;
    store.update((draft) => applyPlay(draft, id, 1));
  }

  const offEnd = engine.onEnd(() => {
    if (!stylusDown || armDrives) return;
    const disc = loadedDiscOf(store.getState());
    if (disc) registerEnd(disc);
  });

  // -------------------------------------------------------------------------
  // Bucle
  // -------------------------------------------------------------------------

  /** Posición del programa con la aguja mandada por el motor (o por el reloj simulado). */
  function programPosition(disc: LoadedDisc, rate: number, dt: number): number {
    if (engineHasSide(disc)) return engine.getPositionSec();
    const next = clamp(engine.getPositionSec() + rate * dt, -LEAD_IN_SEC, disc.durationSec + LEAD_OUT_SEC);
    engine.seekSec(next);
    return next;
  }

  /** Suma lo que ha sonado del programa y detecta el paso por el final de la cara. */
  function trackProgress(disc: LoadedDisc, from: number, to: number): void {
    if (!(to > from)) return;
    const lo = Math.max(0, from);
    const hi = Math.min(disc.durationSec, to);
    if (hi > lo) playedSec += hi - lo;
    if (from < disc.durationSec && to >= disc.durationSec) registerEnd(disc);
  }

  /** Decide quién manda sobre el radio, lo actualiza y fija la aguja. Devuelve la posición (s). */
  function updateArm(disc: LoadedDisc | null, tonearm: TonearmState, rate: number, dt: number): number {
    if (tonearm.onRest && !dragging) liveRadius = REST_RADIUS_MM;
    if (!disc) {
      armDrives = true;
      setStylus(false);
      return 0;
    }
    const engineDrives =
      !dragging &&
      disc.durationSec > 0 &&
      Math.abs(platter.rpm) >= STOPPED_RPM &&
      isStylusInGroove(disc, tonearm, liveRadius);
    let position: number;
    if (engineDrives) {
      if (armDrives) {
        lastEnginePos = timeAt(disc, liveRadius);
        engine.seekSec(lastEnginePos);
      }
      position = programPosition(disc, rate, dt);
      trackProgress(disc, lastEnginePos, position);
      lastEnginePos = position;
      liveRadius = radiusForTimeExt(disc.geo, disc.durationSec, position);
    } else {
      position = timeAt(disc, liveRadius);
    }
    armDrives = !engineDrives;
    setStylus(isStylusInGroove(disc, tonearm, liveRadius));
    return position;
  }

  function updateEffects(disc: LoadedDisc | null, turntable: TurntableState): void {
    const raw: EngineEffects = disc
      ? effectsFor(disc.vinyl.disc, turntable, platter.rpm)
      : { ...SILENT_EFFECTS, rumbleGain: turntable.power && turntable.motor ? 0.25 : 0 };
    const fx = { ...raw };
    for (const key of EFFECT_KEYS) fx[key] = Math.round(raw[key] * 1000) / 1000;
    if (lastEffects && EFFECT_KEYS.every((key) => lastEffects?.[key] === fx[key])) return;
    lastEffects = fx;
    engine.setEffects(fx);
  }

  function addExposure(vinylId: string, exposure: DustExposure, seconds: number): void {
    let entry = pendingDust.get(vinylId);
    if (!entry) {
      entry = { open: 0, 'lid-closed': 0 };
      pendingDust.set(vinylId, entry);
    }
    entry[exposure] += seconds;
  }

  function accumulateExposure(state: AppState, dt: number): void {
    const seconds = dt * Math.max(0, state.settings.dustSpeed);
    if (seconds > 0) {
      const loadedId = state.turntable.loaded?.vinylId ?? null;
      if (loadedId) addExposure(loadedId, state.turntable.lidOpen ? 'open' : 'lid-closed', seconds);
      const { handVinylId, handStage } = state.ui;
      const discOut = handStage === 'disc-out' || handStage === 'inner-out';
      if (handVinylId && handVinylId !== loadedId && discOut) addExposure(handVinylId, 'open', seconds);
    }
    sinceCommit += dt;
    if (sinceCommit >= COMMIT_INTERVAL_SEC) commit();
  }

  function applyPendingDust(draft: AppState): void {
    for (const [id, entry] of pendingDust) {
      const v = findDraftVinyl(draft, id);
      if (!v) continue;
      let condition = v.disc.condition;
      condition = accumulateDust(condition, entry.open, 'open');
      condition = accumulateDust(condition, entry['lid-closed'], 'lid-closed');
      v.disc.condition = condition;
    }
    pendingDust.clear();
  }

  /** True si algún polvo pendiente cambiaría algo (los discos ya saturados no cuentan). */
  function dustPendingMatters(state: AppState): boolean {
    for (const [id, entry] of pendingDust) {
      const v = findVinyl(state, id);
      if (v && v.disc.condition.dust < 1 && entry.open + entry['lid-closed'] > 0) return true;
    }
    return false;
  }

  function commit(): void {
    sinceCommit = 0;
    const state = store.getState();
    const tonearm = state.turntable.tonearm;
    const writeRadius = !dragging && !tonearm.onRest && Math.abs(tonearm.radiusMm - liveRadius) > RADIUS_EPSILON_MM;
    if (!writeRadius && !dustPendingMatters(state)) {
      pendingDust.clear();
      return;
    }
    const radius = liveRadius;
    store.update((draft) => {
      applyPendingDust(draft);
      if (writeRadius) draft.turntable.tonearm.radiusMm = radius;
    });
  }

  function nowPlayingAt(disc: LoadedDisc, tonearm: TonearmState, position: number): TurntableFrame['nowPlaying'] {
    if (tonearm.onRest || disc.side.decorative) return null;
    const index = trackIndexAtTime(disc.vinyl.disc, disc.side, position);
    const track = index >= 0 ? disc.side.tracks[index] : undefined;
    if (!track) return null;
    return { title: track.title || 'Sin título', artist: disc.vinyl.meta.artist, trackIndex: index };
  }

  function buildFrame(state: AppState, disc: LoadedDisc | null, position: number): TurntableFrame {
    const turntable = state.turntable;
    const frameState: TurntableState = { ...turntable, tonearm: { ...turntable.tonearm, radiusMm: liveRadius } };
    const common = {
      state: frameState,
      platterAngleDeg: platter.angleDeg,
      actualRpm: platter.rpm,
      stylusInGroove: stylusDown,
      tool: state.ui.tool,
      fancy: state.settings.fancyRendering,
    };
    if (!disc) {
      return {
        ...common,
        discCanvas: null,
        discFormat: null,
        discHole: null,
        wobble: 0,
        positionSec: 0,
        sideDurationSec: 0,
        nowPlaying: null,
        sideName: null,
      };
    }
    const vinylDisc = disc.vinyl.disc;
    const discCanvas = renderers.disc(disc.vinyl, {
      sizePx: turntableView.discSizePx(vinylDisc.format),
      side: disc.sideId,
      showDust: state.settings.fancyRendering,
      adapter45: false,
      spindle: false,
      quality: 'high',
    });
    return {
      ...common,
      discCanvas,
      discFormat: vinylDisc.format,
      discHole: vinylDisc.hole,
      wobble: wobbleAmount(vinylDisc, turntable),
      positionSec: position,
      sideDurationSec: disc.durationSec,
      nowPlaying: nowPlayingAt(disc, turntable.tonearm, position),
      sideName: `Cara ${disc.sideId}`,
    };
  }

  function frame(dtSec: number): TurntableFrame {
    const dt = Number.isFinite(dtSec) ? clamp(dtSec, 0, 0.1) : 0;
    const state = store.getState();
    const turntable = state.turntable;
    const disc = loadedDiscOf(state);
    noteSide(disc);
    syncEngineSide(disc);

    platter = stepPlatter(
      platter,
      {
        motorOn: turntable.power && turntable.motor,
        targetRpm: rpmValue(turntable.speed) * (1 + turntable.pitchPercent / 100),
        handDegPerSec,
        stylusDown,
      },
      dt,
    );
    const rate = disc ? platter.rpm / rpmValue(disc.vinyl.disc.nativeRpm) : 0;
    engine.setRate(rate);

    const position = updateArm(disc, turntable.tonearm, rate, dt);
    lastPositionSec = position;
    updateEffects(disc, turntable);
    accumulateExposure(state, dt);
    // El volcado periódico (o el fin de cara) puede haber escrito en el store durante este frame.
    const after = store.getState();
    return buildFrame(after, after === state ? disc : loadedDiscOf(after), position);
  }

  // -------------------------------------------------------------------------
  // Audio
  // -------------------------------------------------------------------------

  function reportAudioError(error: unknown): void {
    const message = messageOf(error);
    if (message === lastAudioError) return;
    lastAudioError = message;
    notify(message);
  }

  async function initAudio(): Promise<void> {
    let starting: Promise<void>;
    try {
      // Síncrono dentro del gesto: el motor crea y reanuda el contexto antes de cualquier await.
      starting = engine.init();
    } catch (error) {
      reportAudioError(error);
      return;
    }
    try {
      await starting;
    } catch (error) {
      reportAudioError(error);
      return;
    }
    lastAudioError = null;
    failedKey = null;
    syncEngineSide(loadedDiscOf(store.getState()));
  }

  // -------------------------------------------------------------------------
  // Acciones del tocadiscos
  // -------------------------------------------------------------------------

  function toggleMotor(): void {
    const turntable = store.getState().turntable;
    if (!turntable.power) {
      notify(TOAST_POWER_OFF);
      return;
    }
    store.update((draft) => {
      draft.turntable.motor = !draft.turntable.motor;
    });
  }

  function setSpeed(speed: Rpm): void {
    if (!RPMS.includes(speed) || store.getState().turntable.speed === speed) return;
    store.update((draft) => {
      draft.turntable.speed = speed;
    });
  }

  function setPitch(percent: number): void {
    if (!Number.isFinite(percent)) return;
    const value = clamp(percent, -PITCH_LIMIT, PITCH_LIMIT);
    if (store.getState().turntable.pitchPercent === value) return;
    store.update((draft) => {
      draft.turntable.pitchPercent = value;
    });
  }

  function setVolume(v: number): void {
    if (!Number.isFinite(v)) return;
    const value = clamp(v, 0, 1);
    engine.setVolume(value);
    if (store.getState().turntable.volume === value) return;
    store.update((draft) => {
      draft.turntable.volume = value;
    });
  }

  function toggleLid(): void {
    store.update((draft) => {
      draft.turntable.lidOpen = !draft.turntable.lidOpen;
    });
  }

  function toggleAdapter(): void {
    store.update((draft) => {
      draft.turntable.adapter45 = !draft.turntable.adapter45;
    });
  }

  function setCue(lifted: boolean): void {
    const tonearm = store.getState().turntable.tonearm;
    if (tonearm.lifted === lifted) return;
    const radius = liveRadius;
    store.update((draft) => {
      const arm = draft.turntable.tonearm;
      arm.lifted = lifted;
      if (!arm.onRest) arm.radiusMm = radius;
    });
  }

  function moveTonearm(target: number | 'rest', isDragging: boolean): void {
    const tonearm = store.getState().turntable.tonearm;
    if (target === 'rest') {
      placeArmOnRest();
      if (tonearm.onRest && tonearm.lifted && tonearm.radiusMm === REST_RADIUS_MM) return;
      store.update((draft) => {
        draft.turntable.tonearm = restTonearm();
      });
      return;
    }
    if (!Number.isFinite(target)) return;
    const radius = clamp(target, 0, REST_RADIUS_MM);
    dragging = isDragging;
    liveRadius = radius;
    const disc = loadedDiscOf(store.getState());
    if (disc) engine.seekSec(timeAt(disc, radius));
    // Durante el arrastre solo se escribe al salir del soporte; al soltar, el radio final.
    if (isDragging && !tonearm.onRest) return;
    store.update((draft) => {
      draft.turntable.tonearm.onRest = false;
      draft.turntable.tonearm.radiusMm = radius;
    });
  }

  function handPlatter(degPerSec: number | null): void {
    handDegPerSec = degPerSec === null ? null : Number.isFinite(degPerSec) ? degPerSec : 0;
  }

  function cleanVinyl(id: string | null, strength: number): void {
    if (!id || !findVinyl(store.getState(), id)) return;
    const s = Number.isFinite(strength) ? strength : 0;
    const at = now();
    store.update((draft) => {
      applyPendingDust(draft);
      const v = findDraftVinyl(draft, id);
      if (v) v.disc.condition = cleanStroke(v.disc.condition, s, at);
    });
  }

  function brushStroke(strength: number): void {
    const state = store.getState();
    const id = state.ui.view === 'hand' ? state.ui.handVinylId : (state.turntable.loaded?.vinylId ?? null);
    cleanVinyl(id, strength);
  }

  function removeDisc(): void {
    const disc = loadedDiscOf(store.getState());
    if (!disc) return;
    const play = partialPlayFraction(disc);
    placeArmOnRest();
    store.update((draft) => {
      if (play !== null) applyPlay(draft, disc.vinyl.id, play);
      draft.turntable.loaded = null;
      draft.turntable.tonearm = restTonearm();
      draft.ui.view = 'hand';
      draft.ui.handVinylId = disc.vinyl.id;
      draft.ui.handStage = 'disc-out';
      draft.ui.handSide = disc.sideId;
    });
    resetSideFlags();
    unloadEngine();
  }

  function flipOnTurntable(disc: LoadedDisc): void {
    const play = partialPlayFraction(disc);
    const next = otherSide(disc.sideId);
    const warning = sideOf(disc.vinyl, next).decorative ? TOAST_DECORATIVE : null;
    placeArmOnRest();
    store.update((draft) => {
      if (play !== null) applyPlay(draft, disc.vinyl.id, play);
      if (draft.turntable.loaded) draft.turntable.loaded.side = next;
      draft.turntable.tonearm = restTonearm();
      if (warning) draft.ui.toast = { text: warning, at: now() };
    });
    resetSideFlags();
    engine.seekSec(-LEAD_IN_SEC);
    syncEngineSide(loadedDiscOf(store.getState()));
  }

  function flipDisc(): void {
    const state = store.getState();
    if (state.ui.view === 'hand' && state.ui.handVinylId) {
      store.update((draft) => {
        draft.ui.handSide = otherSide(draft.ui.handSide);
      });
      return;
    }
    const disc = loadedDiscOf(state);
    if (disc) flipOnTurntable(disc);
  }

  function setTool(tool: 'none' | 'brush'): void {
    if ((tool !== 'none' && tool !== 'brush') || store.getState().ui.tool === tool) return;
    store.update((draft) => {
      draft.ui.tool = tool;
    });
  }

  function powerToggle(): void {
    store.update((draft) => {
      const on = !draft.turntable.power;
      draft.turntable.power = on;
      if (!on) draft.turntable.motor = false;
    });
  }

  // -------------------------------------------------------------------------
  // Estantería y mano
  // -------------------------------------------------------------------------

  function pickVinyl(id: string): void {
    const state = store.getState();
    if (!findVinyl(state, id) || state.turntable.loaded?.vinylId === id) return;
    store.update((draft) => {
      draft.ui.view = 'hand';
      draft.ui.handVinylId = id;
      draft.ui.handStage = 'jacket-front';
      draft.ui.handSide = 'A';
    });
  }

  function backToShelf(): void {
    store.update((draft) => {
      draft.ui.view = 'room';
      draft.ui.handVinylId = null;
      draft.ui.handStage = 'jacket-front';
      draft.ui.handSide = 'A';
    });
  }

  function setStage(stage: HandStage): void {
    const state = store.getState();
    const vinyl = findVinyl(state, state.ui.handVinylId);
    if (!vinyl || !HAND_STAGES.includes(stage)) return;
    if (stage === 'gatefold' && !vinyl.jacket.gatefold) return;
    store.update((draft) => {
      draft.ui.handStage = stage;
    });
  }

  function putOnTurntable(side: SideId): void {
    const state = store.getState();
    const vinyl = findVinyl(state, state.ui.handVinylId);
    if (!vinyl || (side !== 'A' && side !== 'B')) return;
    const previous = loadedDiscOf(state);
    const play = previous ? partialPlayFraction(previous) : null;
    const warning = placementWarning(vinyl, side, state.turntable.adapter45);
    placeArmOnRest();
    store.update((draft) => {
      if (previous && play !== null) applyPlay(draft, previous.vinyl.id, play);
      // El disco que hubiera en el plato vuelve a la estantería: basta con dejar de tenerlo cargado.
      draft.turntable.loaded = { vinylId: vinyl.id, side };
      draft.turntable.tonearm = restTonearm();
      draft.ui.view = 'room';
      draft.ui.handVinylId = null;
      draft.ui.handStage = 'jacket-front';
      draft.ui.handSide = 'A';
      if (warning) draft.ui.toast = { text: warning, at: now() };
    });
    resetSideFlags();
    engine.seekSec(-LEAD_IN_SEC);
    syncEngineSide(loadedDiscOf(store.getState()));
  }

  function clean(strength: number): void {
    const state = store.getState();
    cleanVinyl(state.ui.handVinylId ?? state.turntable.loaded?.vinylId ?? null, strength);
  }

  // -------------------------------------------------------------------------
  // Editor y superposiciones
  // -------------------------------------------------------------------------

  function openEditorFor(id: string, tab?: EditorTab): void {
    store.update((draft) => {
      draft.ui.view = 'editor';
      draft.ui.editorVinylId = id;
      if (tab) draft.ui.editorTab = tab;
    });
  }

  function openEditor(id: string): void {
    if (findVinyl(store.getState(), id)) openEditorFor(id);
  }

  function edit(): void {
    const id = store.getState().ui.handVinylId;
    if (id) openEditor(id);
  }

  /** Cierra el editor: vuelve a la mano si se abrió desde ella (el vinilo sigue en la mano). */
  function closeEditor(): void {
    store.update((draft) => {
      const fromHand = findVinyl(draft, draft.ui.handVinylId) !== null;
      draft.ui.view = fromHand ? 'hand' : 'room';
      if (!fromHand) draft.ui.handVinylId = null;
      draft.ui.editorVinylId = null;
    });
  }

  function closeOverlays(): void {
    const view = store.getState().ui.view;
    if (view === 'editor') closeEditor();
    else if (view === 'hand') backToShelf();
  }

  function openSettings(): void {
    // Los ajustes son un panel de la habitación: solo se apartan la mano y el editor para que no lo tapen.
    const ui = store.getState().ui;
    if (ui.view === 'room' && ui.handVinylId === null && ui.editorVinylId === null) return;
    store.update((draft) => {
      draft.ui.view = 'room';
      draft.ui.handVinylId = null;
      draft.ui.handStage = 'jacket-front';
      draft.ui.editorVinylId = null;
    });
  }

  function addVinyl(): void {
    const stored = store.addVinyl(createVinyl({ meta: { title: NEW_VINYL_TITLE }, now: now() }));
    openEditorFor(stored.id, 'disco');
  }

  function setDustSpeed(v: number): void {
    if (!Number.isFinite(v)) return;
    const value = clamp(v, 0, MAX_DUST_SPEED);
    if (store.getState().settings.dustSpeed === value) return;
    store.update((draft) => {
      draft.settings.dustSpeed = value;
    });
  }

  function setFancyRendering(v: boolean): void {
    if (store.getState().settings.fancyRendering === v) return;
    store.update((draft) => {
      draft.settings.fancyRendering = v;
    });
  }

  function reorder(id: string, newIndex: number): void {
    const state = store.getState();
    const order = reorderedIds(state.vinyls, id, newIndex);
    if (!order) return;
    const position = new Map(order.map((vid, i) => [vid, i]));
    if (state.vinyls.every((v) => v.shelfIndex === position.get(v.id))) return;
    // El orden no es una edición: no se toca `updatedAt`.
    store.update((draft) => {
      for (const v of draft.vinyls) v.shelfIndex = position.get(v.id) ?? v.shelfIndex;
      draft.vinyls.sort((a, b) => a.shelfIndex - b.shelfIndex);
    });
  }

  function createVinylFromTracks(tracks: Track[]): void {
    const [first] = tracks;
    if (!first) return;
    const vinyl = createVinyl({ now: now() });
    const prevMeta = { ...vinyl.meta };
    vinyl.meta.title = first.title;
    syncDerivedTexts(vinyl, prevMeta);
    const [sideA, sideB] = splitTracks(tracks);
    vinyl.disc.sides[0].tracks = sideA;
    vinyl.disc.sides[1].tracks = sideB;
    const stored = store.addVinyl(vinyl);
    openEditorFor(stored.id, 'canciones');
  }

  async function importDroppedAudio(files: File[]): Promise<void> {
    if (files.length === 0) return;
    notify(files.length === 1 ? 'Importando 1 archivo…' : `Importando ${files.length} archivos…`);
    let result: ImportResult;
    try {
      result = await importAudio(files);
    } catch (error) {
      notify(`No se pudieron importar los archivos: ${messageOf(error)}`);
      return;
    }
    createVinylFromTracks(result.tracks);
    if (result.rejected.length > 0) notify(rejectedMessage(result.rejected));
  }

  function dropAudioFiles(files: File[]): void {
    void importDroppedAudio(Array.from(files));
  }

  // -------------------------------------------------------------------------
  // Borrado de vinilos
  // -------------------------------------------------------------------------

  /** Olvida todo lo cacheado de un vinilo que ya no está (sea cual sea el camino del borrado). */
  function forgetVinyl(vinyl: Vinyl, remaining: Vinyl[]): void {
    pendingDust.delete(vinyl.id);
    renderers.invalidate(vinyl.id);
    for (const key of collectBlobKeys(vinyl)) {
      if (isBlobKeyInUse(key, remaining)) continue;
      renderers.images.forget(key);
      library.evict(key);
    }
  }

  const offStore = store.subscribe((next, prev) => {
    if (next.vinyls === prev.vinyls || next.vinyls.length >= prev.vinyls.length) return;
    const ids = new Set(next.vinyls.map((v) => v.id));
    const removed = prev.vinyls.filter((v) => !ids.has(v.id));
    for (const vinyl of removed) forgetVinyl(vinyl, next.vinyls);
    if (removed.length > 0) syncEngineSide(loadedDiscOf(store.getState()));
  });

  async function removeVinyl(id: string): Promise<void> {
    const wasLoaded = store.getState().turntable.loaded?.vinylId === id;
    const keys = await store.removeVinyl(id);
    for (const key of keys) {
      renderers.images.forget(key);
      library.evict(key);
    }
    renderers.invalidate(id);
    if (wasLoaded) unloadEngine();
  }

  // -------------------------------------------------------------------------

  const actions: AppActions = {
    // Tocadiscos
    toggleMotor,
    setSpeed,
    setPitch,
    setVolume,
    toggleLid,
    toggleAdapter,
    setCue,
    moveTonearm,
    handPlatter,
    brushStroke,
    removeDisc,
    flipDisc,
    setTool,
    powerToggle,
    // Estantería
    pickVinyl,
    addVinyl,
    openEditor,
    reorder,
    // Mano
    setStage,
    putOnTurntable,
    backToShelf,
    edit,
    clean,
    // Habitación
    openSettings,
    closeOverlays,
    setDustSpeed,
    setFancyRendering,
    dropAudioFiles,
    // Editor
    close: closeEditor,
    importAudio,
    removeVinyl,
  };

  return {
    actions,
    frame,
    initAudio,
    commit,
    positionSec: () => lastPositionSec,
    notify,
    dispose() {
      offEnd();
      offStore();
      loadToken++;
    },
  };
}
