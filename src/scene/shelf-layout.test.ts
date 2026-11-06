import { describe, expect, it } from 'vitest';
import { createVinyl } from '../core/defaults';
import { sortedByShelf } from '../core/store';
import {
  CRATE_CAPACITY,
  CRATE_ZONE_PX,
  SHELF_FRAME_PX,
  SHELF_ROW_HEIGHT_PX,
  SPINE_MIN_WIDTH_PX,
  chunk,
  insertionSlot,
  layoutShelf,
  maxShelvesFor,
  planShelf,
  reorderTarget,
  sortForShelf,
  spineHeightPx,
  spineWidthPx,
} from './shelf-layout';

function ids(n: number, prefix = 'v'): { id: string }[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));
}

function flat(rows: string[][]): string[] {
  return rows.flat();
}

describe('escala de los lomos', () => {
  it('la altura sale de jacketSizeMm × 0,75', () => {
    expect(spineHeightPx('12')).toBe(236);
    expect(spineHeightPx('10')).toBe(195);
    expect(spineHeightPx('7')).toBe(135);
  });

  it('la anchura es max(16, round(mm × 3))', () => {
    expect(spineWidthPx(3.5)).toBe(SPINE_MIN_WIDTH_PX);
    expect(spineWidthPx(9.32)).toBe(28);
    expect(spineWidthPx(Number.NaN)).toBe(SPINE_MIN_WIDTH_PX);
  });

  it('una balda tiene la altura del 12" más margen', () => {
    expect(SHELF_ROW_HEIGHT_PX).toBeGreaterThan(spineHeightPx('12'));
  });
});

describe('sortForShelf', () => {
  it('ordena por shelfIndex y, en empate, por createdAt, igual que el almacén', () => {
    const a = createVinyl({ shelfIndex: 2, now: 10 });
    const b = createVinyl({ shelfIndex: 0, now: 30 });
    const c = createVinyl({ shelfIndex: 0, now: 20 });
    const d = createVinyl({ shelfIndex: 1, now: 5 });
    const list = [a, b, c, d];
    expect(sortForShelf(list).map((v) => v.id)).toEqual([c.id, b.id, d.id, a.id]);
    expect(sortForShelf(list).map((v) => v.id)).toEqual(sortedByShelf(list).map((v) => v.id));
    expect(list[0]).toBe(a);
  });
});

describe('layoutShelf', () => {
  it('llena las baldas en orden', () => {
    const vinyls = ids(7);
    const layout = layoutShelf(vinyls, 35, vinyls.map(() => 10), 5);
    expect(layout.shelves).toEqual([
      ['v0', 'v1', 'v2'],
      ['v3', 'v4', 'v5'],
      ['v6'],
    ]);
    expect(layout.crates).toEqual([]);
  });

  it('respeta la anchura de cada lomo', () => {
    const vinyls = ids(4);
    const layout = layoutShelf(vinyls, 50, [30, 15, 10, 40], 5);
    expect(layout.shelves).toEqual([['v0', 'v1'], ['v2', 'v3']]);
  });

  it('agotadas las baldas, el resto va a cajas de CRATE_CAPACITY', () => {
    const vinyls = ids(2 * 10 + 60);
    const layout = layoutShelf(vinyls, 100, vinyls.map(() => 10), 2);
    expect(layout.shelves).toHaveLength(2);
    expect(flat(layout.shelves)).toHaveLength(20);
    expect(layout.crates.map((c) => c.length)).toEqual([CRATE_CAPACITY, CRATE_CAPACITY, 10]);
    expect([...flat(layout.shelves), ...flat(layout.crates)]).toEqual(vinyls.map((v) => v.id));
  });

  it('maxBaldas tiene un mínimo de 1', () => {
    const vinyls = ids(5);
    for (const max of [0, -3, Number.NaN]) {
      const layout = layoutShelf(vinyls, 20, vinyls.map(() => 10), max);
      expect(layout.shelves).toEqual([['v0', 'v1']]);
      expect(layout.crates).toEqual([['v2', 'v3', 'v4']]);
    }
  });

  it('una balda vacía acepta siempre un lomo aunque sea más ancho', () => {
    const vinyls = ids(2);
    const layout = layoutShelf(vinyls, 10, [40, 40], 3);
    expect(layout.shelves).toEqual([['v0'], ['v1']]);
  });

  it('sin vinilos queda una balda vacía (para el botón de añadir)', () => {
    expect(layoutShelf([], 300, [], 3, 44)).toEqual({ shelves: [[]], crates: [] });
  });

  it('si el botón de añadir no cabe al final, añade una balda vacía para él', () => {
    const vinyls = ids(3);
    const layout = layoutShelf(vinyls, 100, [30, 30, 30], 3, 44);
    expect(layout.shelves).toEqual([['v0', 'v1', 'v2'], []]);
  });

  it('la última balda posible se llena dejando sitio al botón de añadir', () => {
    const vinyls = ids(10);
    const layout = layoutShelf(vinyls, 100, vinyls.map(() => 20), 1, 44);
    expect(layout.shelves).toEqual([['v0', 'v1']]);
    expect(layout.crates).toEqual([['v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9']]);
  });
});

describe('maxShelvesFor y planShelf', () => {
  it('cuenta las baldas que caben en la altura, mínimo 1', () => {
    expect(maxShelvesFor(SHELF_ROW_HEIGHT_PX * 3 + 5)).toBe(3);
    expect(maxShelvesFor(10)).toBe(1);
    expect(maxShelvesFor(0)).toBe(1);
    expect(maxShelvesFor(Number.NaN)).toBe(1);
  });

  it('sin cajas usa toda la altura', () => {
    const vinyls = ids(4);
    const plan = planShelf({
      vinyls,
      widthsPx: vinyls.map(() => 20),
      shelfWidthPx: 400,
      heightPx: SHELF_FRAME_PX + 3 * SHELF_ROW_HEIGHT_PX,
      trailingPx: 44,
    });
    expect(plan.maxShelves).toBe(3);
    expect(plan.shelves).toEqual([['v0', 'v1', 'v2', 'v3']]);
    expect(plan.crates).toEqual([]);
  });

  it('con cajas reserva su zona en el suelo y reparte con menos baldas', () => {
    const vinyls = ids(200);
    const plan = planShelf({
      vinyls,
      widthsPx: vinyls.map(() => 20),
      shelfWidthPx: 200,
      heightPx: SHELF_FRAME_PX + 3 * SHELF_ROW_HEIGHT_PX + CRATE_ZONE_PX - 1,
      trailingPx: 44,
    });
    expect(plan.maxShelves).toBe(2);
    expect(plan.shelves).toHaveLength(2);
    expect(plan.crates.length).toBeGreaterThan(0);
    expect([...flat(plan.shelves), ...flat(plan.crates)]).toEqual(vinyls.map((v) => v.id));
  });

  it('nunca baja de una balda aunque no quepa ninguna', () => {
    const vinyls = ids(60);
    const plan = planShelf({ vinyls, widthsPx: vinyls.map(() => 20), shelfWidthPx: 100, heightPx: 50 });
    expect(plan.maxShelves).toBe(1);
    expect(plan.shelves).toHaveLength(1);
    expect(flat(plan.crates)).toHaveLength(60 - plan.shelves[0]!.length);
  });
});

describe('arrastrar para reordenar', () => {
  const row = [
    { order: 4, left: 0, width: 20 },
    { order: 5, left: 20, width: 20 },
    { order: 6, left: 40, width: 20 },
  ];

  it('el hueco de inserción va delante del primer elemento cuyo centro queda a la derecha', () => {
    expect(insertionSlot(row, 5, 99)).toBe(4);
    expect(insertionSlot(row, 25, 99)).toBe(5);
    expect(insertionSlot(row, 35, 99)).toBe(6);
    expect(insertionSlot(row, 80, 99)).toBe(7);
    expect(insertionSlot([...row].reverse(), 35, 99)).toBe(6);
  });

  it('en una fila vacía devuelve el hueco de la fila', () => {
    expect(insertionSlot([], 10, 12)).toBe(12);
  });

  it('la posición destino descuenta el propio elemento al moverlo hacia delante', () => {
    expect(reorderTarget(2, 5)).toBe(4);
    expect(reorderTarget(5, 2)).toBe(2);
    expect(reorderTarget(3, 3)).toBe(3);
    expect(reorderTarget(3, 4)).toBe(3);
  });

  it('chunk parte en trozos del tamaño pedido', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});
