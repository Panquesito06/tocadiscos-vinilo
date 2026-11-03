/**
 * Fachada de render con caché. Las vistas piden canvases por aquí y nunca
 * llaman a los módulos de dibujo directamente, así un vinilo solo se vuelve
 * a dibujar cuando cambia (`updatedAt`) o cambia el tamaño pedido.
 *
 * REGLAS PARA LAS VISTAS:
 *  - Los canvases devueltos son COMPARTIDOS y de solo lectura: ninguna vista
 *    los inserta en el DOM ni dibuja sobre ellos. Cada vista tiene su propio
 *    canvas y, cuando cambia la referencia devuelta, copia con `blit()`.
 *  - `sizePx` (y `widthPx`/`heightPx`) son píxeles de dispositivo: la vista
 *    fija `canvas.style.width/height` a `sizePx / devicePixelRatio`.
 *  - La caché es LRU con presupuesto de píxeles. Para el disco, al pedir una
 *    nueva versión (otro nivel de polvo) se descartan las versiones
 *    anteriores de la misma cara y tamaño.
 */
import type { SideId, Vinyl } from '../core/types';
import { discCacheKey, renderDiscFace, type DiscRenderOptions } from './disc';
import { ImageCache } from './images';
import { renderGatefoldInside, renderJacketBack, renderJacketFront, renderSpine } from './jacket';
import { renderInnerSleeve, renderOuterSleeve } from './sleeves';

export interface Renderers {
  readonly images: ImageCache;
  disc(vinyl: Vinyl, opts: DiscRenderOptions): HTMLCanvasElement;
  jacketFront(vinyl: Vinyl, sizePx: number): HTMLCanvasElement;
  jacketBack(vinyl: Vinyl, sizePx: number): HTMLCanvasElement;
  gatefold(vinyl: Vinyl, sizePx: number): HTMLCanvasElement;
  spine(vinyl: Vinyl, widthPx: number, heightPx: number): HTMLCanvasElement;
  innerSleeve(vinyl: Vinyl, sizePx: number, face: 'front' | 'back'): HTMLCanvasElement;
  outerSleeve(vinyl: Vinyl, sizePx: number): HTMLCanvasElement | null;
  /** Vacía la caché de un vinilo (o de todos). */
  invalidate(vinylId?: string): void;
}

/** Presupuesto de la caché en píxeles (≈ 48 MP ≈ 190 MB de RGBA). */
export const CACHE_PIXEL_BUDGET = 48_000_000;

/**
 * Copia un canvas compartido en el canvas propio de una vista, ajustando el
 * tamaño del destino si hace falta. Devuelve false si no hay contexto 2D.
 */
export function blit(target: HTMLCanvasElement, source: HTMLCanvasElement): boolean {
  if (target.width !== source.width) target.width = source.width;
  if (target.height !== source.height) target.height = source.height;
  const ctx = target.getContext('2d');
  if (!ctx) return false;
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(source, 0, 0);
  return true;
}

export function createRenderers(images: ImageCache): Renderers {
  // Map conserva el orden de inserción: re-insertar en cada acierto lo convierte en LRU.
  const cache = new Map<string, HTMLCanvasElement | null>();
  let pixels = 0;

  function pixelsOf(c: HTMLCanvasElement | null): number {
    return c ? c.width * c.height : 0;
  }

  function drop(key: string): void {
    const value = cache.get(key);
    if (value === undefined) return;
    cache.delete(key);
    pixels -= pixelsOf(value);
  }

  function remember<T extends HTMLCanvasElement | null>(key: string, make: () => T): T {
    const hit = cache.get(key);
    if (hit !== undefined) {
      cache.delete(key);
      cache.set(key, hit);
      return hit as T;
    }
    const value = make();
    cache.set(key, value);
    pixels += pixelsOf(value);
    while (pixels > CACHE_PIXEL_BUDGET && cache.size > 1) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined || oldest === key) break;
      drop(oldest);
    }
    return value;
  }

  function clearAll(): void {
    cache.clear();
    pixels = 0;
  }

  // Cuando llega una imagen nueva, todo lo que dependa de imágenes se redibuja.
  images.onLoad(clearAll);

  return {
    images,
    disc: (vinyl, opts) => {
      const key = `disc|${discCacheKey(vinyl, opts)}`;
      if (!cache.has(key)) {
        // Descarta versiones anteriores (otro nivel de polvo) de la misma cara y tamaño.
        const prefix = `disc|${vinyl.id}|${vinyl.updatedAt}|${opts.sizePx}|${opts.side}|`;
        for (const k of Array.from(cache.keys())) if (k.startsWith(prefix)) drop(k);
      }
      return remember(key, () => renderDiscFace(vinyl, opts, images));
    },
    jacketFront: (vinyl, size) =>
      remember(`jf|${vinyl.id}|${vinyl.updatedAt}|${size}`, () => renderJacketFront(vinyl, size, images)),
    jacketBack: (vinyl, size) =>
      remember(`jb|${vinyl.id}|${vinyl.updatedAt}|${size}`, () => renderJacketBack(vinyl, size, images)),
    gatefold: (vinyl, size) =>
      remember(`gf|${vinyl.id}|${vinyl.updatedAt}|${size}`, () => renderGatefoldInside(vinyl, size, images)),
    spine: (vinyl, w, h) =>
      remember(`sp|${vinyl.id}|${vinyl.updatedAt}|${w}|${h}`, () => renderSpine(vinyl, w, h, images)),
    innerSleeve: (vinyl, size, face) =>
      remember(`is|${vinyl.id}|${vinyl.updatedAt}|${size}|${face}`, () => renderInnerSleeve(vinyl, size, face, images)),
    outerSleeve: (vinyl, size) =>
      remember(`os|${vinyl.id}|${vinyl.updatedAt}|${size}`, () => renderOuterSleeve(vinyl, size, images)),
    invalidate: (vinylId) => {
      if (!vinylId) {
        clearAll();
        return;
      }
      for (const key of Array.from(cache.keys())) if (key.includes(`|${vinylId}|`)) drop(key);
    },
  };
}

export type { DiscRenderOptions, SideId };
