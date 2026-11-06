/**
 * Reparto de los lomos en baldas y cajas: funciones puras, sin DOM.
 *
 * La estantería tiene su propia escala (independiente del tocadiscos):
 * la altura del lomo es `jacketSizeMm(format) × SHELF_PX_PER_MM` y su
 * anchura `max(SPINE_MIN_WIDTH_PX, round(spineWidthMm × SPINE_WIDTH_SCALE))`
 * píxeles CSS. Las baldas se llenan en orden; cuando ya no caben más baldas
 * en la altura disponible (mínimo una), el resto de vinilos va a cajas de
 * `CRATE_CAPACITY` en el suelo.
 *
 * Las constantes de escala viven aquí (y `shelf.ts` las reexporta) para que
 * este módulo no dependa de la vista y no haya dependencias circulares.
 */
import { jacketSizeMm } from '../core/geometry';
import type { Format, Vinyl } from '../core/types';

export type VinylId = string;

/** Píxeles CSS por mm para la ALTURA del lomo en la estantería. */
export const SHELF_PX_PER_MM = 0.75;
/** Anchura mínima de un lomo, para que sea legible y clicable. */
export const SPINE_MIN_WIDTH_PX = 16;
/** Píxeles CSS por mm para la ANCHURA del lomo (exagerada respecto a la altura). */
export const SPINE_WIDTH_SCALE = 3;
/** Vinilos por caja de madera. */
export const CRATE_CAPACITY = 25;

/** Hueco libre sobre el lomo más alto (12") para que al adelantarse no choque con la balda de arriba. */
export const SHELF_HEADROOM_PX = 22;
/** Grosor visible de la tabla de cada balda. */
export const SHELF_BOARD_PX = 18;
/** Tablero superior del mueble. */
export const SHELF_FRAME_PX = 14;
/** Relleno interior de cada balda a cada lado (entre el costado del mueble y los lomos). */
export const SHELF_INNER_PADDING_PX = 10;
/** Altura que ocupan las cajas en el suelo cuando hacen falta. */
export const CRATE_ZONE_PX = 176;
/** Anchura del botón "Añadir vinilo" con forma de lomo vacío (incluido su margen). */
export const ADD_SLOT_WIDTH_PX = 44;
/** Recorrido mínimo del puntero para que una pulsación sobre un lomo sea un arrastre y no un clic. */
export const DRAG_THRESHOLD_PX = 6;

/** Altura del lomo en px CSS: 12" ≈ 236, 10" = 195, 7" = 135. */
export function spineHeightPx(format: Format): number {
  return Math.round(jacketSizeMm(format) * SHELF_PX_PER_MM);
}

/** Anchura del lomo en px CSS a partir de su anchura real en mm. */
export function spineWidthPx(widthMm: number): number {
  const scaled = Number.isFinite(widthMm) ? Math.round(widthMm * SPINE_WIDTH_SCALE) : 0;
  return Math.max(SPINE_MIN_WIDTH_PX, scaled);
}

/** Altura de una balda: el lomo de 12", el hueco de arriba y la tabla. */
export const SHELF_ROW_HEIGHT_PX = spineHeightPx('12') + SHELF_HEADROOM_PX + SHELF_BOARD_PX;

type ShelfOrdered = Pick<Vinyl, 'shelfIndex' | 'createdAt'>;

/**
 * Orden de la estantería: por `shelfIndex` y, a igualdad, por `createdAt`.
 * Es el mismo criterio (y la misma ordenación estable) que usa el almacén,
 * así la posición que ve el usuario coincide con la que espera `reorder`.
 */
export function sortForShelf<T extends ShelfOrdered>(vinyls: readonly T[]): T[] {
  return [...vinyls].sort((a, b) => a.shelfIndex - b.shelfIndex || a.createdAt - b.createdAt);
}

/** Parte una lista en trozos de `size` elementos (el último puede ser menor). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}

export interface ShelfLayout {
  /** Ids por balda, de arriba abajo. La última puede estar vacía (solo el botón de añadir). */
  shelves: VinylId[][];
  /** Ids por caja, en orden. */
  crates: VinylId[][];
}

/** Número de baldas que caben en `heightPx` (mínimo 1). */
export function maxShelvesFor(heightPx: number, rowHeightPx = SHELF_ROW_HEIGHT_PX): number {
  if (!(heightPx > 0) || !(rowHeightPx > 0)) return 1;
  return Math.max(1, Math.floor(heightPx / rowHeightPx));
}

/**
 * Reparte los vinilos (ya ordenados) en baldas de `shelfWidthPx` de ancho
 * útil. `widthsPx[i]` es la anchura del lomo del vinilo `i`. Se llenan las
 * baldas en orden; una balda vacía acepta siempre al menos un lomo (aunque
 * sea más ancho que ella). Agotadas `maxShelves` (mínimo 1), el resto va a
 * cajas de `CRATE_CAPACITY`.
 *
 * `trailingPx` reserva sitio al final de la última balda para el botón
 * "Añadir vinilo": la última balda posible se llena solo hasta
 * `shelfWidthPx − trailingPx` y, si al acabar el botón no cabe en la balda
 * en curso y quedan baldas libres, se añade una balda vacía para él.
 */
export function layoutShelf(
  vinyls: readonly { id: VinylId }[],
  shelfWidthPx: number,
  widthsPx: readonly number[],
  maxShelves: number,
  trailingPx = 0,
): ShelfLayout {
  const limit = Number.isFinite(maxShelves) ? Math.max(1, Math.floor(maxShelves)) : 1;
  const width = Math.max(0, shelfWidthPx);
  const trailing = Math.max(0, trailingPx);
  const capacity = (shelf: number): number => (shelf === limit - 1 ? width - trailing : width);

  const shelves: VinylId[][] = [[]];
  let used = 0;
  let next = 0;
  for (; next < vinyls.length; next++) {
    const w = Math.max(0, widthsPx[next] ?? 0);
    let row = shelves[shelves.length - 1] as VinylId[];
    if (row.length > 0 && used + w > capacity(shelves.length - 1)) {
      if (shelves.length >= limit) break;
      row = [];
      shelves.push(row);
      used = 0;
    }
    row.push((vinyls[next] as { id: VinylId }).id);
    used += w;
  }

  const allPlaced = next >= vinyls.length;
  if (allPlaced && trailing > 0 && used + trailing > width && shelves.length < limit) shelves.push([]);

  const rest = vinyls.slice(next).map((v) => v.id);
  return { shelves, crates: chunk(rest, CRATE_CAPACITY) };
}

export interface ShelfPlanInput {
  /** Vinilos en orden de estantería. */
  vinyls: readonly { id: VinylId }[];
  widthsPx: readonly number[];
  /** Ancho útil de una balda (sin el relleno interior). */
  shelfWidthPx: number;
  /** Altura disponible para todo el mueble y las cajas. */
  heightPx: number;
  trailingPx?: number;
}

export interface ShelfPlan extends ShelfLayout {
  /** Baldas máximas con las que se ha calculado el reparto. */
  maxShelves: number;
}

/**
 * Reparto completo según la altura disponible: primero con todas las baldas
 * que caben; si sobran vinilos para cajas, se reserva la zona de las cajas
 * en el suelo y se vuelve a repartir con las baldas que quedan (mínimo 1).
 */
export function planShelf(input: ShelfPlanInput): ShelfPlan {
  const { vinyls, widthsPx, shelfWidthPx, heightPx } = input;
  const trailing = input.trailingPx ?? 0;
  const usable = heightPx - SHELF_FRAME_PX;
  const all = maxShelvesFor(usable);
  const first = layoutShelf(vinyls, shelfWidthPx, widthsPx, all, trailing);
  if (first.crates.length === 0) return { ...first, maxShelves: all };
  const reduced = maxShelvesFor(usable - CRATE_ZONE_PX);
  if (reduced >= all) return { ...first, maxShelves: all };
  return { ...layoutShelf(vinyls, shelfWidthPx, widthsPx, reduced, trailing), maxShelves: reduced };
}

/** Un elemento de una fila tal como se ve en pantalla. */
export interface SlotItem {
  /** Posición en la lista ordenada de la estantería. */
  order: number;
  left: number;
  width: number;
}

/**
 * Hueco de inserción (0..n en la lista ordenada) para un puntero en `x`
 * dentro de una fila: delante del primer elemento cuyo centro queda a la
 * derecha del puntero o, si no hay ninguno, detrás del último. Con la fila
 * vacía devuelve `emptySlot`.
 */
export function insertionSlot(items: readonly SlotItem[], x: number, emptySlot: number): number {
  if (items.length === 0) return emptySlot;
  const sorted = [...items].sort((a, b) => a.left - b.left);
  for (const item of sorted) if (x < item.left + item.width / 2) return item.order;
  return (sorted[sorted.length - 1] as SlotItem).order + 1;
}

/**
 * Posición destino para `reorder(id, newIndex)` al soltar el elemento que
 * estaba en `fromIndex` en el hueco `slot` (0..n de la lista original):
 * `newIndex` es su posición en la lista ya reordenada.
 */
export function reorderTarget(fromIndex: number, slot: number): number {
  return slot > fromIndex ? slot - 1 : slot;
}
