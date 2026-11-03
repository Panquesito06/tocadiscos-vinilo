import { describe, expect, it } from 'vitest';
import { createVinyl, defaultTurntableState } from './defaults';
import {
  accumulateDust,
  cleanStroke,
  effectsFor,
  rateFromSpeed,
  registerPlay,
  sturdiness,
  wobbleAmount,
} from './physics';

describe('física simulada', () => {
  it('tocar un 33 a 45 acelera 1,35 veces y el pitch suma porcentaje', () => {
    expect(rateFromSpeed(45, 33, 0)).toBeCloseTo(1.35, 4);
    expect(rateFromSpeed(33, 33, 0)).toBeCloseTo(1, 6);
    expect(rateFromSpeed(33, 33, 8)).toBeCloseTo(1.08, 6);
    expect(rateFromSpeed(78, 45, 0)).toBeCloseTo(78 / 45, 6);
  });

  it('más polvo → más crepitar', () => {
    const v = createVinyl();
    const tt = defaultTurntableState();
    const clean = effectsFor({ ...v.disc, condition: { ...v.disc.condition, dust: 0 } }, tt, 33.3);
    const dirty = effectsFor({ ...v.disc, condition: { ...v.disc.condition, dust: 0.8 } }, tt, 33.3);
    expect(dirty.crackleRate).toBeGreaterThan(clean.crackleRate);
    expect(dirty.crackleGain).toBeGreaterThan(clean.crackleGain);
  });

  it('con el plato parado no hay crepitar ni clics', () => {
    const v = createVinyl();
    const fx = effectsFor(v.disc, defaultTurntableState(), 0);
    expect(fx.crackleRate).toBe(0);
    expect(fx.clickRate).toBe(0);
    expect(fx.wobbleHz).toBe(0);
  });

  it('el disco fino bambolea más que el grueso', () => {
    const thin = createVinyl({ disc: { weightGrams: 120, thicknessMm: 1.0 } });
    const thick = createVinyl({ disc: { weightGrams: 200, thicknessMm: 2.3 } });
    thin.disc.condition.warp = 0.5;
    thick.disc.condition.warp = 0.5;
    const tt = defaultTurntableState();
    expect(sturdiness(thin.disc)).toBeLessThan(sturdiness(thick.disc));
    expect(wobbleAmount(thin.disc, tt)).toBeGreaterThan(wobbleAmount(thick.disc, tt));
  });

  it('un agujero grande sin centrador descentra el disco', () => {
    const v = createVinyl({ disc: { hole: 'large', format: '7', nativeRpm: 45 } });
    const without = wobbleAmount(v.disc, { ...defaultTurntableState(), adapter45: false });
    const withAdapter = wobbleAmount(v.disc, { ...defaultTurntableState(), adapter45: true });
    expect(without).toBeGreaterThan(withAdapter + 0.3);
  });

  it('el polvo se acumula al aire, no en la funda, y el cepillo lo quita', () => {
    const v = createVinyl();
    const c0 = { ...v.disc.condition, dust: 0 };
    expect(accumulateDust(c0, 600, 'sleeved').dust).toBe(0);
    const open = accumulateDust(c0, 600, 'open');
    const closed = accumulateDust(c0, 600, 'lid-closed');
    expect(open.dust).toBeGreaterThan(closed.dust);
    expect(closed.dust).toBeGreaterThan(0);
    const cleaned = cleanStroke(open, 1, 123);
    expect(cleaned.dust).toBeLessThan(open.dust);
    expect(cleaned.lastCleanedAt).toBe(123);
    expect(cleanStroke({ ...c0, dust: 0.01 }, 1, 1).dust).toBe(0);
  });

  it('cada reproducción desgasta, y menos a los discos robustos', () => {
    const light = createVinyl({ disc: { weightGrams: 120, thicknessMm: 1.0 } });
    const heavy = createVinyl({ disc: { weightGrams: 200, thicknessMm: 2.3 } });
    const a = registerPlay(light.disc);
    const b = registerPlay(heavy.disc);
    expect(a.plays).toBe(1);
    expect(a.wear).toBeGreaterThan(b.wear);
    expect(registerPlay(light.disc, 0.2).plays).toBe(0);
  });
});
