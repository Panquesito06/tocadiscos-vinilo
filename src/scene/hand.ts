/**
 * Vinilo en la mano: inspección del objeto completo.
 *
 * CONTRATO (lo implementa el módulo de escena de la habitación):
 *  - Capa centrada sobre la habitación (la habitación se oscurece detrás).
 *    El lado del objeto en px CSS es `S = min(70vh, 560px)` para un 12" y
 *    proporcional a `jacketSizeMm(format)` para 10" y 7". Los canvases se
 *    piden en píxeles de dispositivo (× devicePixelRatio) y se copian con
 *    `blit()` en canvases propios. Muestra el vinilo según `ui.handStage`:
 *      · `jacket-front`: carpeta de frente con su funda exterior encima;
 *      · `jacket-back`: contraportada con la funda exterior;
 *      · `gatefold`: interior desplegado (solo si `jacket.gatefold`);
 *      · `inner-out`: la funda interior asomando por la derecha de la
 *        carpeta, con el disco debajo (mismo `sizePx` que la funda y
 *        centrados, para que el troquel deje ver la galleta);
 *      · `disc-out`: el disco fuera de la funda, cara `ui.handSide` hacia
 *        arriba (se puede voltear), con brillo fijo.
 *    Las transiciones entre etapas son deslizamientos cortos (`--dur-media`).
 *  - Controles (botones con texto): Girar, Abrir (si desplegable), Sacar
 *    funda, Sacar disco, Dar la vuelta, Limpiar (cepillo: arrastrar sobre
 *    el disco → `clean(fuerza)`), Poner en el plato (cara A / cara B),
 *    Editar, Guardar en la estantería. Esc = guardar. Atributos
 *    `data-test` de DESIGN.md §6.
 *  - Bajo el disco se muestra su estado (`describeCondition`) y datos:
 *    formato, peso, grosor, velocidad, reproducciones.
 */
import type { AppState, HandStage, SideId } from '../core/types';
import type { Renderers } from '../render';

export interface HandActions {
  setStage(stage: HandStage): void;
  flipDisc(): void;
  putOnTurntable(side: SideId): void;
  backToShelf(): void;
  edit(): void;
  clean(strength: number): void;
}

export interface HandView {
  readonly el: HTMLElement;
  update(state: AppState, renderers: Renderers): void;
}

export function createHandView(_actions: HandActions): HandView {
  throw new Error('createHandView: no implementado todavía');
}
