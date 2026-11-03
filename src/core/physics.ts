/**
 * Física simulada del vinilo.
 *
 * Funciones puras que traducen el estado físico del disco y del tocadiscos a
 * parámetros de sonido y que hacen evolucionar la condición del disco con el
 * uso. Reglas (todas son simplificaciones declaradas, no medidas reales):
 *
 *  - Velocidad: tocar un disco de 33 a 45 lo acelera y sube el tono en la
 *    misma proporción (45 / 33⅓ = 1,35). El ajuste de pitch suma ±8 %.
 *  - Polvo → crepitar. Se acumula mientras el disco está fuera de su funda
 *    (más deprisa con la tapa abierta) y un poco con cada reproducción. El
 *    cepillo lo quita.
 *  - Desgaste → siseo de superficie. Sube con cada reproducción; los discos
 *    más pesados y gruesos se desgastan algo menos. No se puede limpiar.
 *  - Alabeo → bamboleo (wow) a la frecuencia de giro. Los discos finos se
 *    alabean más; los gruesos lo amortiguan.
 *  - Agujero grande sin centrador → disco descentrado → wow fuerte.
 *  - Calidad del prensado y profundidad del surco → ruido de fondo.
 *  - Rayas → clics esporádicos.
 */
import type { Condition, Disc, Rpm, TurntableState } from './types';

export const RPM_VALUES: Record<Rpm, number> = { 33: 100 / 3, 45: 45, 78: 78 };

export function rpmValue(rpm: Rpm): number {
  return RPM_VALUES[rpm];
}

/** Multiplicador de velocidad nominal para el selector y el ajuste de pitch. */
export function rateFromSpeed(speed: Rpm, nativeRpm: Rpm, pitchPercent: number): number {
  return (rpmValue(speed) / rpmValue(nativeRpm)) * (1 + pitchPercent / 100);
}

/** Parámetros de efectos que entiende el motor de audio. Ganancias lineales 0..1. */
export interface EngineEffects {
  /** Crepitaciones por segundo (polvo). */
  crackleRate: number;
  crackleGain: number;
  /** Siseo de superficie (desgaste, prensado). */
  hissGain: number;
  /** Zumbido grave del motor (constante, muy bajo). */
  rumbleGain: number;
  /** Profundidad del bamboleo de velocidad (0..0.1) y su frecuencia en Hz. */
  wobbleDepth: number;
  wobbleHz: number;
  /** Clics por segundo por rayas y su ganancia. */
  clickRate: number;
  clickGain: number;
}

export const SILENT_EFFECTS: EngineEffects = {
  crackleRate: 0,
  crackleGain: 0,
  hissGain: 0,
  rumbleGain: 0,
  wobbleDepth: 0,
  wobbleHz: 0,
  clickRate: 0,
  clickGain: 0,
};

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Factor 0..1 de "robustez" del disco: 0 = fino y ligero, 1 = grueso y pesado. */
export function sturdiness(disc: Disc): number {
  const w = (disc.weightGrams - 120) / 80; // 120 g → 0, 200 g → 1
  const t = (disc.thicknessMm - 1.0) / 1.4; // 1,0 mm → 0, 2,4 mm → 1
  return clamp01(0.5 * clamp01(w) + 0.5 * clamp01(t));
}

/** Bamboleo relativo (0..1) que produce el disco por alabeo y centrado. */
export function wobbleAmount(disc: Disc, turntable: TurntableState): number {
  const warpWobble = disc.condition.warp * (1 - 0.8 * sturdiness(disc));
  const offCenter = disc.hole === 'large' && !turntable.adapter45 ? 0.6 : 0;
  return clamp01(warpWobble + offCenter);
}

/**
 * Efectos de sonido para un disco en el plato girando a `actualRpm`.
 * Si la aguja no está en el surco el motor de audio debe ignorarlos.
 */
export function effectsFor(disc: Disc, turntable: TurntableState, actualRpm: number): EngineEffects {
  const c = disc.condition;
  const quality = clamp01(disc.pressingQuality * 0.7 + disc.grooveDepth * 0.3);
  const speedFactor = Math.max(0, actualRpm) / rpmValue(disc.nativeRpm);
  const wobble = wobbleAmount(disc, turntable);
  return {
    crackleRate: (2 + 60 * c.dust) * speedFactor,
    crackleGain: clamp01(0.08 + 0.9 * c.dust),
    hissGain: clamp01(0.03 + 0.35 * (1 - quality) + 0.5 * c.wear),
    rumbleGain: turntable.motor ? 0.25 : 0,
    wobbleDepth: 0.08 * wobble,
    wobbleHz: Math.max(0, actualRpm) / 60,
    clickRate: 8 * c.scratches * speedFactor,
    clickGain: clamp01(0.2 + 0.8 * c.scratches),
  };
}

export type Exposure = 'sleeved' | 'lid-closed' | 'open';

/** Polvo por segundo de exposición según dónde esté el disco. */
export const DUST_PER_SEC: Record<Exposure, number> = {
  sleeved: 0,
  'lid-closed': 0.00004,
  open: 0.0003,
};

/** Acumula polvo durante `dtSec` segundos de exposición. `dustSpeed` acelera la simulación. */
export function accumulateDust(cond: Condition, dtSec: number, exposure: Exposure, dustSpeed = 1): Condition {
  const inc = DUST_PER_SEC[exposure] * dtSec * dustSpeed;
  if (inc === 0) return cond;
  return { ...cond, dust: clamp01(cond.dust + inc) };
}

/** Una pasada del cepillo. `strength` 0..1 (la velocidad y longitud del gesto). */
export function cleanStroke(cond: Condition, strength: number, now: number): Condition {
  const removed = 0.06 + 0.14 * clamp01(strength);
  return { ...cond, dust: clamp01(cond.dust - removed), lastCleanedAt: now };
}

/** Registra una reproducción completa (o parcial, con `fraction` 0..1). */
export function registerPlay(disc: Disc, fraction = 1): Condition {
  const c = disc.condition;
  const f = clamp01(fraction);
  const wearInc = 0.006 * f * (1 - 0.5 * sturdiness(disc));
  const dustInc = 0.01 * f;
  return {
    ...c,
    wear: clamp01(c.wear + wearInc),
    dust: clamp01(c.dust + dustInc),
    plays: c.plays + (f >= 0.5 ? 1 : 0),
  };
}

/** Descripción breve del estado para la interfaz. */
export function describeCondition(cond: Condition): string {
  if (cond.dust > 0.6) return 'Muy sucio';
  if (cond.dust > 0.3) return 'Con polvo';
  if (cond.wear > 0.6) return 'Muy usado';
  if (cond.wear > 0.3) return 'Usado';
  if (cond.scratches > 0.4) return 'Rayado';
  return 'Buen estado';
}
