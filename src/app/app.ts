/**
 * Arranque y controlador de la aplicación.
 *
 * CONTRATO (lo implementa el módulo de aplicación):
 *  - Crea el store, el motor de audio, la biblioteca, las cachés de render
 *    y las vistas; monta la habitación en `root`.
 *  - Si la colección está vacía, siembra la colección de demostración.
 *  - Bucle de animación (requestAnimationFrame):
 *      1. `stepPlatter()` con el motor, la velocidad objetivo
 *         (`rateFromSpeed` × rpm nominal del disco… o la del selector si no
 *         hay disco), la mano (scratch) y la aguja;
 *      2. `engine.setRate(rpm / rpmNominalDelDisco)`;
 *      3. aguja: está en el surco si el brazo no está en el soporte, la
 *         palanca está abajo y el radio cae en lead-in/program/lead-out; en
 *         cara decorativa nunca suena;
 *      4. con la aguja en el surco y el plato girando, el radio del brazo
 *         sigue la posición del motor (`radiusForTime`); con la aguja
 *         levantada, la posición del motor sigue al brazo (`timeForRadius`);
 *      5. `engine.setEffects(effectsFor(...))`;
 *      6. polvo: `accumulateDust` según exposición (en la mano o en el plato
 *         con tapa abierta = `open`; en el plato con tapa cerrada =
 *         `lid-closed`; en la estantería = `sleeved`), aplicado al estado
 *         cada ~2 s para no saturar el store;
 *      7. `turntableView.update(frame)`.
 *  - Al llegar al final de la cara (`onEnd`): la aguja sigue en el surco de
 *    salida; se registra la reproducción (`registerPlay`) una sola vez.
 *  - El audio se inicializa en el primer gesto del usuario (pointerdown /
 *    keydown) y, si hay un disco cargado, se carga su cara.
 *  - Avisos (toasts): agujero grande sin centrador ("Este single necesita el
 *    centrador"), cara decorativa, archivo no soportado.
 */
export async function startApp(_root: HTMLElement): Promise<void> {
  throw new Error('startApp: no implementado todavía');
}
