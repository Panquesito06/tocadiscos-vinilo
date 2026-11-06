import { describe, expect, it } from 'vitest';
import { discGeometry } from '../core/geometry';
import {
  ARM_LENGTH_MM,
  MAX_RADIUS_MM,
  MIN_RADIUS_MM,
  ORBIT_RADIUS_MM,
  PIVOT_DISTANCE_MM,
  PIVOT_MM,
  PIVOT_OFFSET_MM,
  PLATTER_RADIUS_MM,
  REST_RADIUS_MM,
  armAngleForRadius,
  armScreenAngleDeg,
  clampArmAngle,
  clampRadius,
  pointerArmAngle,
  pointerToRadius,
  radiusForArmAngle,
  stylusPointForRadius,
} from './turntable-geometry';

const DEG = 180 / Math.PI;

describe('constantes del brazo', () => {
  it('el pivote está en (D, −0,15·D) y a la distancia real que usa el coseno', () => {
    expect(PIVOT_MM.x).toBe(213);
    expect(PIVOT_MM.y).toBeCloseTo(-31.95);
    expect(PIVOT_OFFSET_MM).toBe(213);
    expect(PIVOT_DISTANCE_MM).toBeCloseTo(Math.hypot(213, 31.95), 6);
    expect(ARM_LENGTH_MM).toBe(229);
  });

  it('los límites del radio salen del surco interior del 12" y del soporte', () => {
    expect(MIN_RADIUS_MM).toBe(discGeometry('12').innerGrooveMm - 4);
    expect(MAX_RADIUS_MM).toBe(REST_RADIUS_MM);
    expect(ORBIT_RADIUS_MM).toBeCloseTo((38.1 - 7.24) / 2);
  });

  it('en el soporte, el brazo entero queda fuera del plato y de su canto estroboscópico', () => {
    // Canto del plato con las marcas estroboscópicas: 7 mm por fuera del radio del plato.
    const cantoMm = PLATTER_RADIUS_MM + 7;
    const a = PIVOT_MM;
    const b = stylusPointForRadius(REST_RADIUS_MM);
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const t = Math.max(0, Math.min(1, -(a.x * vx + a.y * vy) / (vx * vx + vy * vy)));
    const closest = Math.hypot(a.x + t * vx, a.y + t * vy);
    expect(closest).toBeGreaterThan(cantoMm);
    // Y el soporte no se aleja tanto que la aguja salga por delante del plinto (394 − 162 mm).
    expect(b.y).toBeLessThan(394 - 162 - 50);
  });
});

describe('armAngleForRadius', () => {
  it('coincide con el teorema del coseno', () => {
    const r = 120;
    const d = PIVOT_DISTANCE_MM;
    const expected = Math.acos((d * d + ARM_LENGTH_MM ** 2 - r * r) / (2 * d * ARM_LENGTH_MM));
    expect(armAngleForRadius(r)).toBeCloseTo(expected, 10);
  });

  it('en reposo el ángulo es moderado y en el surco interior (60) es mucho menor', () => {
    const rest = armAngleForRadius(REST_RADIUS_MM) * DEG;
    const inner = armAngleForRadius(60) * DEG;
    expect(rest).toBeGreaterThan(45);
    expect(rest).toBeLessThan(52);
    expect(inner).toBeGreaterThan(10);
    expect(inner).toBeLessThan(20);
    // Cuanto mayor es el radio, más se abre el brazo respecto a la recta pivote→eje.
    expect(rest).toBeGreaterThan(inner);
  });

  it('crece de forma monótona con el radio', () => {
    let prev = armAngleForRadius(MIN_RADIUS_MM);
    for (let r = MIN_RADIUS_MM + 1; r <= MAX_RADIUS_MM; r += 1) {
      const a = armAngleForRadius(r);
      expect(a).toBeGreaterThan(prev);
      prev = a;
    }
  });

  it('acota radios fuera del recorrido', () => {
    expect(armAngleForRadius(10)).toBeCloseTo(armAngleForRadius(MIN_RADIUS_MM), 12);
    expect(armAngleForRadius(400)).toBeCloseTo(armAngleForRadius(MAX_RADIUS_MM), 12);
  });
});

describe('radiusForArmAngle', () => {
  it('es el inverso de armAngleForRadius (ida y vuelta)', () => {
    for (const r of [MIN_RADIUS_MM, 60, 75.5, 100, 123.4, 146, 160, REST_RADIUS_MM]) {
      expect(radiusForArmAngle(armAngleForRadius(r))).toBeCloseTo(r, 9);
    }
  });

  it('un ángulo 0 deja la aguja a |d − Le| del eje', () => {
    expect(radiusForArmAngle(0)).toBeCloseTo(Math.abs(PIVOT_DISTANCE_MM - ARM_LENGTH_MM), 9);
  });
});

describe('clampRadius y clampArmAngle', () => {
  it('acotan al recorrido y tratan los valores no finitos como reposo', () => {
    expect(clampRadius(0)).toBe(MIN_RADIUS_MM);
    expect(clampRadius(1000)).toBe(MAX_RADIUS_MM);
    expect(clampRadius(100)).toBe(100);
    expect(clampRadius(Number.NaN)).toBe(REST_RADIUS_MM);
    expect(clampArmAngle(-1)).toBeCloseTo(armAngleForRadius(MIN_RADIUS_MM), 12);
    expect(clampArmAngle(3)).toBeCloseTo(armAngleForRadius(MAX_RADIUS_MM), 12);
    expect(clampArmAngle(Number.NaN)).toBeCloseTo(armAngleForRadius(MAX_RADIUS_MM), 12);
  });
});

describe('stylusPointForRadius', () => {
  it('queda exactamente a r mm del eje y a Le del pivote', () => {
    for (const r of [MIN_RADIUS_MM, 70, 100, 146, REST_RADIUS_MM]) {
      const p = stylusPointForRadius(r);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(r, 9);
      expect(Math.hypot(p.x - PIVOT_MM.x, p.y - PIVOT_MM.y)).toBeCloseTo(ARM_LENGTH_MM, 9);
    }
  });

  it('en reposo el cabezal está en la parte delantera derecha del plato', () => {
    const p = stylusPointForRadius(REST_RADIUS_MM);
    expect(p.x).toBeGreaterThan(0);
    expect(p.y).toBeGreaterThan(0);
  });

  it('al entrar en el surco el cabezal se desplaza hacia la izquierda', () => {
    expect(stylusPointForRadius(60).x).toBeLessThan(stylusPointForRadius(146).x);
  });

  it('admite otro pivote', () => {
    const pivot = { x: 200, y: 0 };
    const p = stylusPointForRadius(100, pivot);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(100, 9);
    expect(Math.hypot(p.x - pivot.x, p.y - pivot.y)).toBeCloseTo(ARM_LENGTH_MM, 9);
  });
});

describe('armScreenAngleDeg', () => {
  it('apunta abajo-izquierda y barre unos 30° entre el soporte y el surco interior', () => {
    const rest = armScreenAngleDeg(REST_RADIUS_MM);
    const inner = armScreenAngleDeg(MIN_RADIUS_MM);
    expect(rest).toBeGreaterThan(90);
    expect(rest).toBeLessThan(180);
    expect(inner).toBeGreaterThan(rest);
    expect(inner - rest).toBeGreaterThan(20);
    expect(inner - rest).toBeLessThan(40);
  });

  it('es coherente con stylusPointForRadius', () => {
    const r = 110;
    const p = stylusPointForRadius(r);
    const expected = Math.atan2(p.y - PIVOT_MM.y, p.x - PIVOT_MM.x) * DEG;
    expect(armScreenAngleDeg(r)).toBeCloseTo(expected, 9);
  });
});

describe('pointerArmAngle y pointerToRadius', () => {
  it('un puntero sobre la aguja devuelve el mismo radio', () => {
    for (const r of [MIN_RADIUS_MM, 80, 120, 150, REST_RADIUS_MM]) {
      const p = stylusPointForRadius(r);
      expect(pointerToRadius(p.x, p.y)).toBeCloseTo(r, 9);
      expect(pointerArmAngle(p.x, p.y)).toBeCloseTo(armAngleForRadius(r), 9);
    }
  });

  it('el radio solo depende del ángulo respecto al pivote, no de la distancia', () => {
    const p = stylusPointForRadius(100);
    const vx = p.x - PIVOT_MM.x;
    const vy = p.y - PIVOT_MM.y;
    expect(pointerToRadius(PIVOT_MM.x + vx * 0.4, PIVOT_MM.y + vy * 0.4)).toBeCloseTo(100, 9);
    expect(pointerToRadius(PIVOT_MM.x + vx * 1.7, PIVOT_MM.y + vy * 1.7)).toBeCloseTo(100, 9);
  });

  it('acota: lejos hacia el frente → soporte; al otro lado del eje → surco interior', () => {
    expect(pointerToRadius(PIVOT_MM.x - 20, PIVOT_MM.y + 400)).toBe(MAX_RADIUS_MM);
    expect(pointerToRadius(-200, -200)).toBe(MIN_RADIUS_MM);
    expect(pointerArmAngle(-200, -200)).toBeLessThan(0);
  });

  it('el puntero sobre el pivote va al reposo', () => {
    expect(pointerToRadius(PIVOT_MM.x, PIVOT_MM.y)).toBe(REST_RADIUS_MM);
  });

  it('el desfase de agarre se resta del ángulo del puntero', () => {
    const r = 120;
    const p = stylusPointForRadius(r);
    const offset = pointerArmAngle(p.x, p.y) - armAngleForRadius(90);
    expect(pointerToRadius(p.x, p.y, PIVOT_MM, offset)).toBeCloseTo(90, 9);
  });
});
