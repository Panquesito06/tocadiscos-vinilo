/**
 * Estantería de vinilos (y cajas en el suelo cuando se llena).
 *
 * CONTRATO (lo implementa el módulo de escena de la habitación):
 *  - Muestra los lomos de todos los vinilos ordenados por `shelfIndex`,
 *    de pie, apoyados unos en otros, en baldas de nogal. Cada balda admite
 *    un número fijo de lomos según su anchura en px y `spineWidthMm`; al
 *    llenarse una balda aparece la siguiente debajo; cuando no caben más
 *    baldas en la pared, los siguientes vinilos van a cajas de madera en el
 *    suelo, vistas de frente (se ve la portada del primero).
 *  - El lomo se dibuja con `renderers.spine(vinyl, w, h)`; el vinilo cargado
 *    en el plato deja un hueco vacío en la estantería; el que está en la
 *    mano, otro hueco.
 *  - Al pasar el puntero, el lomo se adelanta unos px; clic → `pickVinyl`.
 *    Botón "Añadir vinilo" al final de la última balda → `addVinyl`.
 *  - Arrastrar un lomo a otra posición → `reorder`.
 *  - Teclado: los lomos son focusables; Enter = sacar; E = editar.
 */
import type { AppState } from '../core/types';
import type { Renderers } from '../render';

export interface ShelfActions {
  pickVinyl(id: string): void;
  addVinyl(): void;
  openEditor(id: string): void;
  reorder(id: string, newIndex: number): void;
}

export interface ShelfView {
  readonly el: HTMLElement;
  update(state: AppState, renderers: Renderers): void;
}

export function createShelfView(_actions: ShelfActions): ShelfView {
  throw new Error('createShelfView: no implementado todavía');
}
