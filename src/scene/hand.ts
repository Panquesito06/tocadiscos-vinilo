/**
 * Vinilo en la mano: inspección del objeto completo.
 *
 * CONTRATO (lo implementa el módulo de escena de la habitación):
 *  - Capa centrada sobre la habitación (la habitación se oscurece detrás).
 *    Muestra el vinilo según `ui.handStage`:
 *      · `jacket-front`: carpeta de frente dentro de su funda exterior;
 *      · `jacket-back`: contraportada;
 *      · `gatefold`: interior desplegado (solo si `jacket.gatefold`);
 *      · `inner-out`: la funda interior asomando por la derecha de la carpeta;
 *      · `disc-out`: el disco fuera de la funda, cara `ui.handSide` hacia
 *        arriba (se puede voltear), con brillo fijo.
 *    Las transiciones entre etapas son deslizamientos cortos (`--dur-media`).
 *  - Controles (botones con texto): Girar, Abrir (si desplegable), Sacar
 *    funda, Sacar disco, Voltear disco, Limpiar (cepillo: arrastrar sobre
 *    el disco → `clean(fuerza)`), Poner en el plato (cara A / cara B),
 *    Editar, Guardar en la estantería. Esc = guardar.
 *  - Bajo el disco se muestra su estado (`describeCondition`) y datos:
 *    formato, peso, velocidad, reproducciones.
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
