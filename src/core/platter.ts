/**
 * Modelo de inercia del plato.
 *
 * El plato es una masa giratoria: el motor lo lleva hacia la velocidad
 * objetivo con una aceleración limitada (arranque de ~1 s, frenada por
 * rozamiento de ~2 s cuando se apaga) y la mano puede arrastrarlo (scratch)
 * imponiendo su propia velocidad angular. Es una función pura: la aplicación
 * la llama en cada frame y usa la velocidad resultante para el motor de audio
 * y el ángulo para el dibujo.
 */
export interface PlatterState {
  angleDeg: number;
  /** Velocidad angular actual en rpm (negativa si va hacia atrás). */
  rpm: number;
}

export interface PlatterInput {
  motorOn: boolean;
  /** Velocidad objetivo del motor en rpm (ya con el pitch aplicado). */
  targetRpm: number;
  /** Mano sobre el disco: velocidad angular impuesta en grados por segundo (null si no se toca). */
  handDegPerSec: number | null;
  /** Freno de la aguja apoyada: añade rozamiento leve (true/false). */
  stylusDown: boolean;
}

/** Aceleración del motor en rpm/s (arranque de ~33 rpm en ~1 s). */
export const MOTOR_ACCEL_RPM_PER_SEC = 35;
/** Deceleración por rozamiento con el motor apagado, rpm/s. */
export const FRICTION_RPM_PER_SEC = 14;
/** Rozamiento extra de la aguja, rpm/s. */
export const STYLUS_FRICTION_RPM_PER_SEC = 4;
/** Cuánto sigue el plato a la mano por segundo (1 = instantáneo). */
export const HAND_FOLLOW_PER_SEC = 30;

export const INITIAL_PLATTER: PlatterState = { angleDeg: 0, rpm: 0 };

export function stepPlatter(state: PlatterState, input: PlatterInput, dtSec: number): PlatterState {
  const dt = Math.max(0, Math.min(0.1, dtSec));
  let rpm = state.rpm;

  if (input.handDegPerSec !== null) {
    // La mano manda: el plato converge rápidamente a la velocidad de la mano.
    const handRpm = input.handDegPerSec / 6; // 360°/min = 6°/s por rpm
    const k = Math.min(1, HAND_FOLLOW_PER_SEC * dt);
    rpm = rpm + (handRpm - rpm) * k;
  } else if (input.motorOn) {
    const diff = input.targetRpm - rpm;
    const maxStep = MOTOR_ACCEL_RPM_PER_SEC * dt;
    rpm = Math.abs(diff) <= maxStep ? input.targetRpm : rpm + Math.sign(diff) * maxStep;
  } else {
    const friction = (FRICTION_RPM_PER_SEC + (input.stylusDown ? STYLUS_FRICTION_RPM_PER_SEC : 0)) * dt;
    if (Math.abs(rpm) <= friction) rpm = 0;
    else rpm -= Math.sign(rpm) * friction;
  }

  const angleDeg = (((state.angleDeg + rpm * 6 * dt) % 360) + 360) % 360;
  return { angleDeg, rpm };
}
