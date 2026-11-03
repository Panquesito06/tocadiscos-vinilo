/**
 * Estantería de vinilos (y cajas en el suelo cuando se llena).
 *
 * CONTRATO (lo implementa el módulo de escena de la habitación):
 *  - Escala propia de la estantería, independiente del tocadiscos:
 *    `SHELF_PX_PER_MM = 0.75` para la ALTURA del lomo
 *    (`jacketSizeMm(format) × 0.75` → 12" ≈ 236 px, 10" ≈ 195 px,
 *    7" ≈ 135 px CSS) y anchura de lomo `max(16, round(spineWidthMm × 3))`
 *    px CSS para que sea legible y clicable. La balda tiene la altura del
 *    12" más margen; los lomos se apoyan en el fondo (align-items: end).
 *    Capacidad = floor(anchoÚtilPx / anchoLomoPx), medida con
 *    ResizeObserver. Al llenarse una balda aparece la siguiente debajo;
 *    cuando no caben más baldas en la altura disponible (mínimo 1), los
 *    siguientes vinilos van a cajas de madera en el suelo (25 por caja),
 *    vistas de frente (se ve la portada del primero y los cantos del resto).
 *  - El lomo se dibuja copiando con `blit()` el canvas de
 *    `renderers.spine(vinyl, w·dpr, h·dpr)` en un canvas propio; el vinilo
 *    cargado en el plato deja un hueco vacío en la estantería; el que está
 *    en la mano, otro hueco.
 *  - Cada lomo es `button[data-test="lomo"][data-vinyl-id]` con `title` y
 *    `aria-label` = texto del lomo. Al pasar el puntero, el lomo se
 *    adelanta (salvo con `prefers-reduced-motion`) y muestra una miniatura
 *    de la portada; clic → `pickVinyl`. Botón "Añadir vinilo" al final de
 *    la última balda → `addVinyl`.
 *  - Orden: por `shelfIndex` y, en empate, por `createdAt`. Arrastrar un
 *    lomo a otra posición → `reorder(id, newIndex)` con `newIndex` = posición
 *    destino en la lista ordenada.
 *  - Teclado: los lomos son focusables; Enter = sacar; E = editar.
 */
import type { AppState } from '../core/types';
import type { Renderers } from '../render';

export const SHELF_PX_PER_MM = 0.75;
export const SPINE_MIN_WIDTH_PX = 16;
export const SPINE_WIDTH_SCALE = 3;
export const CRATE_CAPACITY = 25;

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
