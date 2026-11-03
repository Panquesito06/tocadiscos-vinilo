/**
 * Fachada de render con caché. Las vistas piden canvases por aquí y nunca
 * llaman a los módulos de dibujo directamente, así un vinilo solo se vuelve
 * a dibujar cuando cambia (`updatedAt`) o cambia el tamaño pedido.
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

const MAX_ENTRIES = 160;

export function createRenderers(images: ImageCache): Renderers {
  const cache = new Map<string, HTMLCanvasElement | null>();

  function remember<T extends HTMLCanvasElement | null>(key: string, make: () => T): T {
    const hit = cache.get(key);
    if (hit !== undefined) return hit as T;
    const value = make();
    if (cache.size >= MAX_ENTRIES) {
      const first = cache.keys().next().value;
      if (first !== undefined) cache.delete(first);
    }
    cache.set(key, value);
    return value;
  }

  // Cuando llega una imagen nueva, todo lo que dependa de imágenes se redibuja.
  images.onLoad(() => cache.clear());

  return {
    images,
    disc: (vinyl, opts) => remember(`disc|${discCacheKey(vinyl, opts)}`, () => renderDiscFace(vinyl, opts, images)),
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
        cache.clear();
        return;
      }
      for (const key of Array.from(cache.keys())) if (key.includes(`|${vinylId}|`)) cache.delete(key);
    },
  };
}

export type { DiscRenderOptions, SideId };
