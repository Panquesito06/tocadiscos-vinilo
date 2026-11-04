/**
 * Geometría del brazo del tocadiscos y correspondencia puntero → radio.
 *
 * Todo se mide en milímetros, en el sistema de coordenadas de la pantalla
 * con el origen en el eje del plato: x crece hacia la derecha e y hacia
 * abajo (hacia el frente del aparato). El pivote del brazo está en la
 * esquina trasera derecha, en (D, −0,15·D) respecto al eje, con D = 213 mm
 * (la separación lateral pivote–eje de un brazo de 9").
 *
 * Para un radio r bajo la aguja, el teorema del coseno en el triángulo
 * pivote–eje–aguja da el ángulo del brazo respecto a la recta pivote→eje:
 *
 *     θ = acos((d² + Le² − r²) / (2·d·Le))
 *
 * donde d es la distancia real pivote–eje (|(D, −0,15·D)| ≈ 215,4 mm) y
 * Le = 229 mm la longitud efectiva del brazo. Se usa la distancia real, y
 * no la separación lateral D, para que `stylusPointForRadius(r)` quede
 * exactamente a r mm del eje.
 *
 * El brazo gira desde la recta pivote→eje hacia el frente (y positiva):
 * la dirección pivote→aguja es la dirección pivote→eje rotada −θ en el
 * sentido de la pantalla. Así, en reposo (r = 165) el cabezal queda en la
 * parte delantera derecha del plato y, al entrar en el surco, barre hacia
 * la izquierda.
 *
 * Funciones puras, sin DOM: se prueban en turntable-geometry.test.ts.
 */
import { discGeometry, holeDiameterMm } from '../core/geometry';

export interface PointMm {
  x: number;
  y: number;
}

/** Radio del plato (el disco de 12" lo cubre entero). */
export const PLATTER_RADIUS_MM = 151;

/** Separación lateral pivote–eje de un brazo de 9". */
export const PIVOT_OFFSET_MM = 213;

/** Posición del pivote del brazo respecto al eje del plato. */
export const PIVOT_MM: Readonly<PointMm> = Object.freeze({
  x: PIVOT_OFFSET_MM,
  y: -PIVOT_OFFSET_MM * 0.15,
});

/** Distancia real pivote–eje (la que usa el teorema del coseno). */
export const PIVOT_DISTANCE_MM = Math.hypot(PIVOT_MM.x, PIVOT_MM.y);

/** Longitud efectiva del brazo: del pivote a la punta de la aguja. */
export const ARM_LENGTH_MM = 229;

/** Radio bajo la aguja con el brazo en su soporte. */
export const REST_RADIUS_MM = 165;

/** Radio mínimo alcanzable: un poco más adentro del surco interior de un 12". */
export const MIN_RADIUS_MM = discGeometry('12').innerGrooveMm - 4;

/** Radio máximo alcanzable: el soporte. */
export const MAX_RADIUS_MM = REST_RADIUS_MM;

/** Soltar el cabezal más allá de este radio lo devuelve al soporte. */
export const REST_THRESHOLD_MM = 160;

/** Paso de las flechas del teclado. */
export const KEY_STEP_MM = 2;

/** Radio de la órbita de un disco de agujero grande sin centrador. */
export const ORBIT_RADIUS_MM = (holeDiameterMm('large') - holeDiameterMm('small')) / 2;

const DEG_PER_RAD = 180 / Math.PI;

function distanceOf(pivot: PointMm): number {
  return Math.hypot(pivot.x, pivot.y);
}

/** Vector unitario del pivote hacia el eje. */
function towardSpindle(pivot: PointMm): PointMm {
  const d = distanceOf(pivot);
  return { x: -pivot.x / d, y: -pivot.y / d };
}

/** Rotación de un vector en el sentido de la pantalla (y hacia abajo). */
function rotate(v: PointMm, rad: number): PointMm {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Acota un radio al recorrido del brazo. Un valor no finito va al soporte. */
export function clampRadius(radiusMm: number): number {
  if (!Number.isFinite(radiusMm)) return REST_RADIUS_MM;
  return Math.min(MAX_RADIUS_MM, Math.max(MIN_RADIUS_MM, radiusMm));
}

/**
 * Ángulo del brazo (radianes, ≥ 0) respecto a la recta pivote→eje para un
 * radio bajo la aguja. El radio se acota antes al recorrido del brazo.
 */
export function armAngleForRadius(radiusMm: number, pivot: PointMm = PIVOT_MM): number {
  const d = distanceOf(pivot);
  const r = clampRadius(radiusMm);
  const cos = (d * d + ARM_LENGTH_MM * ARM_LENGTH_MM - r * r) / (2 * d * ARM_LENGTH_MM);
  return Math.acos(Math.min(1, Math.max(-1, cos)));
}

/** Inverso de `armAngleForRadius`: radio bajo la aguja para un ángulo del brazo. */
export function radiusForArmAngle(thetaRad: number, pivot: PointMm = PIVOT_MM): number {
  const d = distanceOf(pivot);
  const t = Math.min(Math.PI, Math.max(0, thetaRad));
  const r2 = d * d + ARM_LENGTH_MM * ARM_LENGTH_MM - 2 * d * ARM_LENGTH_MM * Math.cos(t);
  return Math.sqrt(Math.max(0, r2));
}

/** Acota un ángulo del brazo al recorrido entre el surco interior y el soporte. */
export function clampArmAngle(thetaRad: number, pivot: PointMm = PIVOT_MM): number {
  const inner = armAngleForRadius(MIN_RADIUS_MM, pivot);
  const rest = armAngleForRadius(MAX_RADIUS_MM, pivot);
  if (!Number.isFinite(thetaRad)) return rest;
  return Math.min(rest, Math.max(inner, thetaRad));
}

/** Vector unitario del pivote hacia la aguja para un radio dado. */
export function armDirectionForRadius(radiusMm: number, pivot: PointMm = PIVOT_MM): PointMm {
  return rotate(towardSpindle(pivot), -armAngleForRadius(radiusMm, pivot));
}

/** Posición de la aguja respecto al eje para un radio dado. */
export function stylusPointForRadius(radiusMm: number, pivot: PointMm = PIVOT_MM): PointMm {
  const dir = armDirectionForRadius(radiusMm, pivot);
  return { x: pivot.x + ARM_LENGTH_MM * dir.x, y: pivot.y + ARM_LENGTH_MM * dir.y };
}

/**
 * Ángulo absoluto del brazo en grados de pantalla (el de `rotate()` en CSS
 * para un brazo dibujado apuntando hacia +x desde su pivote).
 */
export function armScreenAngleDeg(radiusMm: number, pivot: PointMm = PIVOT_MM): number {
  const dir = armDirectionForRadius(radiusMm, pivot);
  return Math.atan2(dir.y, dir.x) * DEG_PER_RAD;
}

/**
 * Ángulo del brazo (radianes, con signo, sin acotar) que apuntaría del
 * pivote al puntero. Negativo si el puntero está al otro lado de la recta
 * pivote→eje (más adentro que el eje). Con el puntero sobre el pivote el
 * ángulo no está definido: se devuelve el de reposo.
 */
export function pointerArmAngle(px: number, py: number, pivot: PointMm = PIVOT_MM): number {
  const vx = px - pivot.x;
  const vy = py - pivot.y;
  if (Math.hypot(vx, vy) < 1e-9) return armAngleForRadius(REST_RADIUS_MM, pivot);
  const u = towardSpindle(pivot);
  const cross = u.x * vy - u.y * vx;
  const dot = u.x * vx + u.y * vy;
  return -Math.atan2(cross, dot);
}

/**
 * Radio bajo la aguja al que corresponde un puntero en (px, py) mm respecto
 * al eje: el puntero fija el ángulo del brazo respecto al pivote, se le
 * resta `offsetRad` (el desfase entre el punto de agarre y la aguja al
 * empezar a arrastrar) y el ángulo se acota y se convierte en radio.
 */
export function pointerToRadius(px: number, py: number, pivot: PointMm = PIVOT_MM, offsetRad = 0): number {
  const theta = clampArmAngle(pointerArmAngle(px, py, pivot) - offsetRad, pivot);
  return clampRadius(radiusForArmAngle(theta, pivot));
}
