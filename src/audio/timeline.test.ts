import { describe, expect, it } from 'vitest';
import { createVinyl, track } from '../core/defaults';
import { LEAD_IN_SEC, LEAD_OUT_SEC, sideDurationSec } from '../core/geometry';
import { EMPTY_TIMELINE, buildTimeline, clampToTimeline, trackIndexAt, tracksToKeep } from './timeline';

function source(durations: number[], gapSec: number) {
  return { tracks: durations.map((durationSec) => ({ durationSec })), gapSec };
}

describe('buildTimeline', () => {
  it('coloca cada pista tras la anterior más el hueco', () => {
    const tl = buildTimeline(source([180, 240, 200], 2));
    expect(tl.tracks.map((t) => t.startSec)).toEqual([0, 182, 424]);
    expect(tl.tracks.map((t) => t.durationSec)).toEqual([180, 240, 200]);
    expect(tl.gapSec).toBe(2);
    expect(tl.totalSec).toBe(624);
  });

  it('la duración total coincide con sideDurationSec', () => {
    const v = createVinyl();
    v.disc.trackGapSec = 3;
    v.disc.sides[0].tracks = [track('Uno', 100.5), track('Dos', 0), track('Tres', 33.3)];
    const side = v.disc.sides[0];
    const tl = buildTimeline({ tracks: side.tracks, gapSec: v.disc.trackGapSec });
    expect(tl.totalSec).toBeCloseTo(sideDurationSec(side, 3), 9);
  });

  it('extiende la línea con el surco de entrada y el de salida', () => {
    const tl = buildTimeline(source([60], 2));
    expect(tl.leadInSec).toBe(LEAD_IN_SEC);
    expect(tl.leadOutSec).toBe(LEAD_OUT_SEC);
    expect(tl.minSec).toBe(-LEAD_IN_SEC);
    expect(tl.maxSec).toBe(60 + LEAD_OUT_SEC);
  });

  it('sin pistas la duración es 0 y las negativas cuentan como 0', () => {
    expect(buildTimeline(source([], 2)).totalSec).toBe(0);
    const tl = buildTimeline(source([-5, 10], 1));
    expect(tl.tracks[0]!.durationSec).toBe(0);
    expect(tl.tracks[1]!.startSec).toBe(1);
    expect(tl.totalSec).toBe(11);
  });

  it('un hueco no finito se trata como 0', () => {
    const tl = buildTimeline(source([10, 10], Number.NaN));
    expect(tl.gapSec).toBe(0);
    expect(tl.totalSec).toBe(20);
  });
});

describe('clampToTimeline', () => {
  it('acota a [−lead-in, total + lead-out] y sin línea deja el valor', () => {
    const tl = buildTimeline(source([10], 0));
    expect(clampToTimeline(tl, -50)).toBe(-LEAD_IN_SEC);
    expect(clampToTimeline(tl, 50)).toBe(10 + LEAD_OUT_SEC);
    expect(clampToTimeline(tl, 5)).toBe(5);
    expect(clampToTimeline(null, 123)).toBe(123);
    expect(clampToTimeline(null, Number.NaN)).toBe(0);
  });
});

describe('trackIndexAt y tracksToKeep', () => {
  const tl = buildTimeline(source([100, 100, 100, 100], 2));

  it('la pista actual es la que suena, la siguiente en un hueco y la última en el surco de salida', () => {
    expect(trackIndexAt(tl, -1)).toBe(0);
    expect(trackIndexAt(tl, 0)).toBe(0);
    expect(trackIndexAt(tl, 99.9)).toBe(0);
    expect(trackIndexAt(tl, 101)).toBe(1); // hueco entre 0 y 1
    expect(trackIndexAt(tl, 102)).toBe(1);
    expect(trackIndexAt(tl, 250)).toBe(2);
    expect(trackIndexAt(tl, 400)).toBe(3);
    expect(trackIndexAt(tl, 406)).toBe(3); // surco de salida
    expect(trackIndexAt(EMPTY_TIMELINE, 0)).toBe(-1);
  });

  it('mantiene la ventana ±1 alrededor de la posición', () => {
    expect(tracksToKeep(tl, -2)).toEqual([0, 1]);
    expect(tracksToKeep(tl, 50)).toEqual([0, 1]);
    expect(tracksToKeep(tl, 150)).toEqual([0, 1, 2]);
    expect(tracksToKeep(tl, 101)).toEqual([0, 1, 2]);
    expect(tracksToKeep(tl, 250)).toEqual([1, 2, 3]);
    expect(tracksToKeep(tl, 350)).toEqual([2, 3]);
    expect(tracksToKeep(tl, 1000)).toEqual([2, 3]);
    expect(tracksToKeep(EMPTY_TIMELINE, 0)).toEqual([]);
  });

  it('con una sola pista la ventana es esa pista', () => {
    expect(tracksToKeep(buildTimeline(source([30], 2)), 10)).toEqual([0]);
  });
});
