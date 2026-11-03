/**
 * Arranque y controlador de la aplicación.
 *
 * CONTRATO (lo implementa el módulo de aplicación):
 *  - Crea el store, el motor de audio, la biblioteca, las cachés de render
 *    y las vistas; monta la habitación en `root`.
 *  - Si la colección está vacía, siembra la colección de demostración.
 *  - Bucle de animación (requestAnimationFrame):
 *      1. `stepPlatter()` con el motor, la velocidad objetivo
 *         (`rpmValue(selector) × (1 + pitch/100)`), la mano (scratch) y la
 *         aguja;
 *      2. `engine.setRate(rpm / rpmValue(disc.nativeRpm))`;
 *      3. aguja: está en el surco si hay disco, la cara no es decorativa,
 *         el brazo no está en el soporte, la palanca está abajo y el radio
 *         cae en lead-in/program/lead-out;
 *      4. quién manda sobre el radio del brazo (en este orden):
 *           a) mientras el usuario arrastra el cabezal (`dragging`), manda
 *              el brazo: cada `moveTonearm` hace `engine.seekSec(timeForRadiusExt(...))`;
 *           b) con la aguja levantada o fuera del disco, manda el brazo
 *              (igual, con seek);
 *           c) con el plato parado (|rpm| < 0,5), manda el brazo;
 *           d) solo con la aguja en el surco y el plato girando, el radio
 *              sigue la posición del motor: `radiusForTimeExt(geo, dur, pos)`
 *              (la posición negativa es el lead-in y la mayor que la
 *              duración el lead-out; ambos silencio con crepitar).
 *         El radio en vivo se guarda en una variable local del bucle y se
 *         pasa a la vista en `frame.state`; el store se escribe solo en las
 *         acciones (moveTonearm, setCue, 'rest') y, como mucho, cada 2 s
 *         junto con el polvo;
 *      5. `engine.setEffects(effectsFor(...))` solo cuando cambian de forma
 *         apreciable;
 *      6. polvo: `accumulateDust` según exposición (en la mano en etapa
 *         disc-out/inner-out o en el plato con tapa abierta = `open`; en el
 *         plato con tapa cerrada = `lid-closed`; en la estantería =
 *         `sleeved`), acumulado localmente y volcado al estado cada ~2 s.
 *         Los cambios en `disc.condition` producidos por la física
 *         (`accumulateDust`, `cleanStroke`, `registerPlay`) NO modifican
 *         `updatedAt`;
 *      7. `turntableView.update(frame)`; el canvas del disco se pide con
 *         `sizePx = turntableView.discSizePx(format)`, `spindle: false`,
 *         `adapter45: false`.
 *  - Fin de cara (`onEnd`): `registerPlay(disc, 1)` como mucho una vez por
 *    cara cargada (bandera que se limpia en cada `loadSide`); al quitar el
 *    disco habiendo sonado más de la mitad sin llegar al final,
 *    `registerPlay(disc, fracción)`.
 *  - Audio: `engine.init()` se llama en el primer `pointerup` o `keydown`
 *    (no `pointerdown`: con puntero táctil no otorga activación de usuario)
 *    y se vuelve a llamar en cada `pointerup` mientras el contexto no esté
 *    `running`. Si falla, el mensaje se muestra como aviso. Al quedar
 *    listo, si hay un disco cargado, se carga su cara y se hace seek al
 *    radio actual del brazo.
 *  - Avisos: agujero grande sin centrador ("Este single tiene el agujero
 *    grande: pon el centrador"), cara decorativa ("Esta cara es decorativa:
 *    no suena"), archivo no soportado, sonido no disponible.
 *  - Borrado: tras `store.removeVinyl(id)` (que devuelve las claves de blob
 *    borradas), `renderers.images.forget(k)` y `library.evict(k)` por cada
 *    clave, `renderers.invalidate(id)` y `engine.unload()` si estaba en el
 *    plato. Al reordenar (`reorder(id, newIndex)`), `newIndex` es la
 *    posición destino en la lista ordenada por `shelfIndex` y se renumeran
 *    todos 0..n−1. Los cambios de condición física y de orden no tocan
 *    `updatedAt`; las ediciones sí (`touch`).
 *  - Persistencia: `store.flush()` en `pagehide` y en `visibilitychange`
 *    cuando pasa a `hidden`.
 *  - Para pruebas (tipado en `src/app/global.d.ts`), expone
 *    `window.__tocadiscos = { audioState(), positionSec(), state(), flush() }`
 *    y refleja el estado del audio en
 *    `document.documentElement.dataset.audio` ('none' | 'suspended' | 'running' | 'closed' | 'interrupted').
 */
export async function startApp(_root: HTMLElement): Promise<void> {
  throw new Error('startApp: no implementado todavía');
}
