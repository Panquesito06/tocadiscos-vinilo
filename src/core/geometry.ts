/**
 * Geometría del disco y de los surcos.
 *
 * Las medidas son aproximaciones de los estándares habituales de prensado
 * (no de una norma concreta): sirven para que el dibujo y la correspondencia
 * radio ↔ tiempo sean coherentes en toda la aplicación.
 *
 * Simplificación deliberada: el paso del surco se considera constante en cada
 * cara, así el radio decrece linealmente con el tiempo. En un disco real el
 * paso varía con la dinámica de la música.
 */
import type { Disc, Format, HoleSize, Side } from './types';

export interface DiscGeometry {
  format: Format;
  /** Radio exterior del disco. */
  radiusMm: number;
  /** Radio de la galleta. */
  labelRadiusMm: number;
  /** Radio donde empieza el surco de entrada (lead-in). */
  outerGrooveMm: number;
  /** Radio mínimo del surco modulado. Más adentro está el dead wax. */
  innerGrooveMm: number;
  /** Longitud del surco de entrada (en mm radiales) antes de la primera canción. */
  leadInMm: number;
  /** Longitud del surco de salida (lead-out) antes del surco de bloqueo. */
  leadOutMm: number;
}

const GEOMETRY: Record<Format, DiscGeometry> = {
  '12': {
    format: '12',
    radiusMm: 151,
    labelRadiusMm: 50,
    outerGrooveMm: 146,
    innerGrooveMm: 60,
    leadInMm: 2.5,
    leadOutMm: 3,
  },
  '10': {
    format: '10',
    radiusMm: 125,
    labelRadiusMm: 50,
    outerGrooveMm: 120,
    innerGrooveMm: 60,
    leadInMm: 2.5,
    leadOutMm: 3,
  },
  '7': {
    format: '7',
    radiusMm: 87.5,
    labelRadiusMm: 44,
    outerGrooveMm: 84,
    innerGrooveMm: 54,
    leadInMm: 2,
    leadOutMm: 2.5,
  },
};

export function discGeometry(format: Format): DiscGeometry {
  return GEOMETRY[format];
}

/** Diámetro del agujero central en mm. */
export function holeDiameterMm(hole: HoleSize): number {
  return hole === 'large' ? 38.1 : 7.24;
}

/** Diámetro exterior del centrador de 45 rpm (rellena el agujero grande). */
export const ADAPTER_DIAMETER_MM = 38.1;

/** Grosor por defecto según el peso (aproximación de prensados habituales). */
export function defaultThicknessMm(weightGrams: number): number {
  const table: Record<number, number> = { 120: 1.2, 140: 1.45, 160: 1.65, 180: 1.9, 200: 2.15 };
  return table[weightGrams] ?? 1.45;
}

/** Duración total de una cara, incluidas las separaciones entre canciones. */
export function sideDurationSec(side: Side, trackGapSec: number): number {
  if (side.decorative || side.tracks.length === 0) return 0;
  const music = side.tracks.reduce((acc, t) => acc + Math.max(0, t.durationSec), 0);
  return music + trackGapSec * Math.max(0, side.tracks.length - 1);
}

/** Zona de surco modulado (sin lead-in ni lead-out), en mm radiales. */
export function programSpanMm(geo: DiscGeometry): { outer: number; inner: number } {
  return { outer: geo.outerGrooveMm - geo.leadInMm, inner: geo.innerGrooveMm + geo.leadOutMm };
}

/**
 * Radio del surco (mm) en el instante `t` de una cara de duración `durationSec`.
 * `t <= 0` devuelve el inicio del programa, `t >= duration` el final.
 */
export function radiusForTime(geo: DiscGeometry, durationSec: number, t: number): number {
  const { outer, inner } = programSpanMm(geo);
  if (durationSec <= 0) return outer;
  const f = Math.min(1, Math.max(0, t / durationSec));
  return outer - (outer - inner) * f;
}

/** Inverso de `radiusForTime`. Devuelve el instante (s) para un radio bajo la aguja. */
export function timeForRadius(geo: DiscGeometry, durationSec: number, radiusMm: number): number {
  const { outer, inner } = programSpanMm(geo);
  if (durationSec <= 0 || outer === inner) return 0;
  const f = (outer - radiusMm) / (outer - inner);
  return Math.min(durationSec, Math.max(0, f * durationSec));
}

export type GrooveZone = 'off' | 'lead-in' | 'program' | 'lead-out' | 'dead-wax' | 'label';

/** En qué zona del disco está un radio dado. */
export function zoneForRadius(geo: DiscGeometry, radiusMm: number): GrooveZone {
  if (radiusMm > geo.outerGrooveMm) return 'off';
  const { outer, inner } = programSpanMm(geo);
  if (radiusMm > outer) return 'lead-in';
  if (radiusMm >= inner) return 'program';
  if (radiusMm >= geo.innerGrooveMm) return 'lead-out';
  if (radiusMm > geo.labelRadiusMm) return 'dead-wax';
  return 'label';
}

export interface TrackBand {
  trackIndex: number;
  startSec: number;
  endSec: number;
  outerMm: number;
  innerMm: number;
}

/** Bandas radiales que ocupa cada canción de una cara (para dibujar separaciones). */
export function trackBands(disc: Disc, side: Side): TrackBand[] {
  const geo = discGeometry(disc.format);
  const total = sideDurationSec(side, disc.trackGapSec);
  const bands: TrackBand[] = [];
  let t = 0;
  side.tracks.forEach((track, i) => {
    const start = t;
    const end = t + Math.max(0, track.durationSec);
    bands.push({
      trackIndex: i,
      startSec: start,
      endSec: end,
      outerMm: radiusForTime(geo, total, start),
      innerMm: radiusForTime(geo, total, end),
    });
    t = end + disc.trackGapSec;
  });
  return bands;
}

/** Índice de la canción que suena en el instante `t` (o −1 si está en un hueco o fuera). */
export function trackIndexAtTime(disc: Disc, side: Side, t: number): number {
  const bands = trackBands(disc, side);
  for (const b of bands) if (t >= b.startSec && t < b.endSec) return b.trackIndex;
  return -1;
}

/** Densidad aproximada de surcos: vueltas por mm radial en la zona de programa. */
export function grooveDensity(disc: Disc, side: Side): number {
  const geo = discGeometry(disc.format);
  const total = sideDurationSec(side, disc.trackGapSec);
  const { outer, inner } = programSpanMm(geo);
  if (total <= 0) return 0;
  const turns = (total / 60) * (disc.nativeRpm === 33 ? 100 / 3 : disc.nativeRpm);
  return turns / (outer - inner);
}
