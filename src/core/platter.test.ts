import { describe, expect, it } from 'vitest';
import { INITIAL_PLATTER, stepPlatter, type PlatterInput, type PlatterState } from './platter';

const base: PlatterInput = { motorOn: true, targetRpm: 100 / 3, handDegPerSec: null, stylusDown: false };

function run(state: PlatterState, input: PlatterInput, seconds: number, dt = 1 / 60): PlatterState {
  let s = state;
  for (let t = 0; t < seconds; t += dt) s = stepPlatter(s, input, dt);
  return s;
}

describe('inercia del plato', () => {
  it('arranca hasta la velocidad objetivo en aproximadamente un segundo', () => {
    const half = run(INITIAL_PLATTER, base, 0.5);
    expect(half.rpm).toBeGreaterThan(10);
    expect(half.rpm).toBeLessThan(100 / 3);
    const later = run(INITIAL_PLATTER, base, 1.5);
    expect(later.rpm).toBeCloseTo(100 / 3, 6);
  });

  it('se frena por rozamiento al apagar el motor, más rápido con la aguja apoyada', () => {
    const spinning: PlatterState = { angleDeg: 0, rpm: 100 / 3 };
    const free = run(spinning, { ...base, motorOn: false }, 1);
    const braked = run(spinning, { ...base, motorOn: false, stylusDown: true }, 1);
    expect(free.rpm).toBeLessThan(100 / 3);
    expect(braked.rpm).toBeLessThan(free.rpm);
    expect(run(spinning, { ...base, motorOn: false }, 5).rpm).toBe(0);
  });

  it('la mano manda: puede llevarlo hacia atrás', () => {
    const spinning: PlatterState = { angleDeg: 0, rpm: 100 / 3 };
    const dragged = run(spinning, { ...base, handDegPerSec: -120 }, 0.5);
    expect(dragged.rpm).toBeLessThan(0);
    expect(dragged.rpm).toBeCloseTo(-20, 0);
  });

  it('el ángulo avanza con la velocidad y queda en [0, 360)', () => {
    const s = run({ angleDeg: 350, rpm: 100 / 3 }, base, 0.5);
    expect(s.angleDeg).toBeGreaterThanOrEqual(0);
    expect(s.angleDeg).toBeLessThan(360);
    const back = stepPlatter({ angleDeg: 1, rpm: -60 }, { ...base, motorOn: false }, 0.05);
    expect(back.angleDeg).toBeGreaterThan(300);
  });
});
