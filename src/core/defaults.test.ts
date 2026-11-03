import { describe, expect, it } from 'vitest';
import { createVinyl, presetFull, presetNormal, presetRing, spineTextFor, track } from './defaults';
import { defaultThicknessMm } from './geometry';

describe('presets de vinilo', () => {
  it('el preset normal es negro con galleta en ambas caras', () => {
    const v = presetNormal({ artist: 'Demo', title: 'Uno' }, [track('a', 100)], [track('b', 100)]);
    expect(v.disc.material).toBe('black');
    expect(v.disc.sides[0].decoration).toBe('normal');
    expect(v.disc.sides[1].decoration).toBe('normal');
    expect(v.disc.sides[0].tracks).toHaveLength(1);
    expect(v.spine.text).toBe('Demo — Uno');
  });

  it('el preset con aro lleva aro decorado en ambas caras', () => {
    const v = presetRing();
    expect(v.disc.sides.every((s) => s.decoration === 'ring')).toBe(true);
    expect(v.disc.weightGrams).toBe(180);
    expect(v.disc.thicknessMm).toBe(defaultThicknessMm(180));
  });

  it('el preset completo tiene obra a cara completa y cara B decorativa', () => {
    const v = presetFull();
    expect(v.disc.sides[0].decoration).toBe('full');
    expect(v.disc.sides[0].artwork).not.toBeNull();
    expect(v.disc.sides[0].rim.enabled).toBe(true);
    expect(v.disc.sides[1].decorative).toBe(true);
    expect(v.disc.sides[1].tracks).toHaveLength(0);
    expect(v.jacket.gatefold).toBe(true);
  });

  it('el grosor por defecto sigue al peso', () => {
    expect(createVinyl({ disc: { weightGrams: 180 } }).disc.thicknessMm).toBe(defaultThicknessMm(180));
    expect(createVinyl().disc.thicknessMm).toBe(defaultThicknessMm(140));
  });

  it('el texto del lomo nunca queda vacío', () => {
    expect(spineTextFor({ artist: '', title: '', year: '', labelName: '', catalogNumber: '', genre: '', notes: '' })).toBe(
      'Sin título',
    );
  });
});
