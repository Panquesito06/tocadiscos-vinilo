/**
 * Línea de tiempo de una cara: funciones puras que comparten el motor de
 * audio y sus pruebas.
 *
 * La cara es: pista, silencio de `gapSec`, pista… La longitud de cada hueco
 * es exactamente `durationSec` (como en `core/geometry.trackBands`), y la
 * duración total coincide con `sideDurationSec(side, gap)`. La posición del
 * cabezal se extiende con el surco de entrada (`−LEAD_IN_SEC`) y el de salida
 * (`totalSec + LEAD_OUT_SEC`).
 */
import { LEAD_IN_SEC, LEAD_OUT_SEC } from '../core/geometry';
import type { TimelineTrack } from './protocol';

export interface Timeline {
  tracks: TimelineTrack[];
  gapSec: number;
  totalSec: number;
  leadInSec: number;
  leadOutSec: number;
  /** Posición mínima del cabezal (`−leadInSec`). */
  minSec: number;
  /** Posición máxima del cabezal (`totalSec + leadOutSec`). */
  maxSec: number;
}

export interface TimelineSource {
  tracks: { durationSec: number }[];
  gapSec: number;
}

/** Línea de tiempo vacía (sin cara cargada): la posición queda clavada en 0. */
export const EMPTY_TIMELINE: Timeline = {
  tracks: [],
  gapSec: 0,
  totalSec: 0,
  leadInSec: 0,
  leadOutSec: 0,
  minSec: 0,
  maxSec: 0,
};

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Construye la línea de tiempo de una cara a partir de las duraciones de sus pistas. */
export function buildTimeline(source: TimelineSource): Timeline {
  const gapSec = finiteOr(source.gapSec, 0);
  const tracks: TimelineTrack[] = [];
  let t = 0;
  source.tracks.forEach((track, i) => {
    const durationSec = Math.max(0, finiteOr(track.durationSec, 0));
    if (i > 0) t += gapSec;
    tracks.push({ startSec: t, durationSec });
    t += durationSec;
  });
  const totalSec = tracks.length === 0 ? 0 : t;
  return {
    tracks,
    gapSec,
    totalSec,
    leadInSec: LEAD_IN_SEC,
    leadOutSec: LEAD_OUT_SEC,
    minSec: -LEAD_IN_SEC,
    maxSec: totalSec + LEAD_OUT_SEC,
  };
}

/** Acota una posición a los límites de la línea de tiempo (sin línea, la deja igual). */
export function clampToTimeline(timeline: Timeline | null, sec: number): number {
  const value = finiteOr(sec, 0);
  if (!timeline) return value;
  return Math.min(timeline.maxSec, Math.max(timeline.minSec, value));
}

/**
 * Pista "actual" en el instante `sec`: la que suena, o la siguiente si el
 * cabezal está en un hueco o en el surco de entrada; en el surco de salida,
 * la última. Devuelve −1 si la cara no tiene pistas.
 */
export function trackIndexAt(timeline: Timeline, sec: number): number {
  const n = timeline.tracks.length;
  if (n === 0) return -1;
  for (let i = 0; i < n; i++) {
    const track = timeline.tracks[i]!;
    if (sec < track.startSec + track.durationSec) return i;
  }
  return n - 1;
}

/** Índices de pista que deben estar cargados con el cabezal en `sec`: la actual y sus vecinas (ventana ±1). */
export function tracksToKeep(timeline: Timeline, sec: number): number[] {
  const center = trackIndexAt(timeline, sec);
  if (center < 0) return [];
  const keep: number[] = [];
  for (let i = center - 1; i <= center + 1; i++) {
    if (i >= 0 && i < timeline.tracks.length) keep.push(i);
  }
  return keep;
}
