import { describe, expect, it } from 'vitest';
import { createVinyl, track } from './defaults';
import {
  LEAD_IN_SEC,
  LEAD_OUT_SEC,
  discGeometry,
  grooveDensity,
  holeDiameterMm,
  jacketSizeMm,
  radiusForTime,
  radiusForTimeExt,
  sideDurationSec,
  timeForRadius,
  timeForRadiusExt,
  trackBands,
  trackIndexAtTime,
  zoneForRadius,
} from './geometry';

describe('geometría del disco', () => {
  it('los tres formatos tienen radios coherentes', () => {
    for (const f of ['7', '10', '12'] as const) {
      const g = discGeometry(f);
      expect(g.radiusMm).toBeGreaterThan(g.outerGrooveMm);
      expect(g.outerGrooveMm).toBeGreaterThan(g.innerGrooveMm);
      expect(g.innerGrooveMm).toBeGreaterThan(g.labelRadiusMm);
    }
  });

  it('el agujero grande es el de los singles de jukebox', () => {
    expect(holeDiameterMm('large')).toBeCloseTo(38.1);
    expect(holeDiameterMm('small')).toBeCloseTo(7.24);
  });

  it('radio ↔ tiempo son inversos y el radio decrece con el tiempo', () => {
    const g = discGeometry('12');
    const dur = 1200;
    const r0 = radiusForTime(g, dur, 0);
    const rMid = radiusForTime(g, dur, 600);
    const rEnd = radiusForTime(g, dur, 1200);
    expect(r0).toBeGreaterThan(rMid);
    expect(rMid).toBeGreaterThan(rEnd);
    expect(timeForRadius(g, dur, rMid)).toBeCloseTo(600, 6);
    expect(timeForRadius(g, dur, r0 + 50)).toBe(0);
    expect(timeForRadius(g, dur, 0)).toBe(dur);
  });

  it('la línea de tiempo extendida recorre lead-in y lead-out', () => {
    const g = discGeometry('12');
    const dur = 600;
    const outerProgram = radiusForTime(g, dur, 0);
    const innerProgram = radiusForTime(g, dur, dur);
    expect(radiusForTimeExt(g, dur, -LEAD_IN_SEC)).toBeCloseTo(g.outerGrooveMm, 6);
    expect(radiusForTimeExt(g, dur, -LEAD_IN_SEC / 2)).toBeCloseTo(outerProgram + g.leadInMm / 2, 6);
    expect(radiusForTimeExt(g, dur, dur + LEAD_OUT_SEC)).toBeCloseTo(g.innerGrooveMm, 6);
    expect(radiusForTimeExt(g, dur, dur + 99)).toBeCloseTo(g.innerGrooveMm, 6);
    expect(timeForRadiusExt(g, dur, g.outerGrooveMm)).toBeCloseTo(-LEAD_IN_SEC, 6);
    expect(timeForRadiusExt(g, dur, g.innerGrooveMm)).toBeCloseTo(dur + LEAD_OUT_SEC, 6);
    expect(timeForRadiusExt(g, dur, (outerProgram + innerProgram) / 2)).toBeCloseTo(dur / 2, 6);
    expect(timeForRadiusExt(g, dur, radiusForTimeExt(g, dur, -0.7))).toBeCloseTo(-0.7, 6);
    expect(jacketSizeMm('7')).toBe(180);
  });

  it('clasifica las zonas de fuera adentro', () => {
    const g = discGeometry('12');
    expect(zoneForRadius(g, 160)).toBe('off');
    expect(zoneForRadius(g, 145)).toBe('lead-in');
    expect(zoneForRadius(g, 100)).toBe('program');
    expect(zoneForRadius(g, 61)).toBe('lead-out');
    expect(zoneForRadius(g, 55)).toBe('dead-wax');
    expect(zoneForRadius(g, 20)).toBe('label');
  });

  it('las bandas de canciones son contiguas salvo por el hueco', () => {
    const v = createVinyl();
    v.disc.trackGapSec = 2;
    v.disc.sides[0].tracks = [track('Uno', 180), track('Dos', 240), track('Tres', 200)];
    const side = v.disc.sides[0];
    expect(sideDurationSec(side, 2)).toBe(624);
    const bands = trackBands(v.disc, side);
    expect(bands).toHaveLength(3);
    expect(bands[0]!.startSec).toBe(0);
    expect(bands[1]!.startSec).toBe(182);
    expect(bands[2]!.endSec).toBe(624);
    expect(bands[0]!.innerMm).toBeGreaterThan(bands[1]!.outerMm);
    expect(trackIndexAtTime(v.disc, side, 10)).toBe(0);
    expect(trackIndexAtTime(v.disc, side, 181)).toBe(-1);
    expect(trackIndexAtTime(v.disc, side, 300)).toBe(1);
    expect(grooveDensity(v.disc, side)).toBeGreaterThan(0);
  });

  it('una cara decorativa no tiene duración', () => {
    const v = createVinyl();
    v.disc.sides[1].decorative = true;
    v.disc.sides[1].tracks = [track('X', 100)];
    expect(sideDurationSec(v.disc.sides[1], 2)).toBe(0);
  });
});
