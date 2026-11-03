/**
 * Dibujo de una cara del disco en un canvas 2D.
 *
 * CONTRATO (lo implementa el módulo de render del disco):
 *  - El canvas es cuadrado de `sizePx` y el disco ocupa todo el diámetro.
 *    Escala: `sizePx / (2 * discGeometry(format).radiusMm)` píxeles por mm.
 *    Un disco de 7" se dibuja en un canvas más pequeño que uno de 12" si el
 *    llamador pasa `sizePx` proporcional (el plato siempre es de 12").
 *  - Se dibuja, de fuera adentro: el material del vinilo (negro, color,
 *    transparente, splatter, mármol); el borde; los surcos como anillos finos
 *    con variación de tono, más densos cuanto más larga la cara, con bandas
 *    de separación entre canciones (`trackBands`) y zonas de lead-in,
 *    lead-out y dead wax lisas; el texto grabado del dead wax; el aro
 *    decorado (`decoration === 'ring'`); la galleta con todos sus campos;
 *    con `decoration === 'full'`, la obra a cara completa debajo de surcos
 *    tenues y el borde remachado si está activo; el polvo (puntos finos
 *    dispersos según `condition.dust`) y las rayas si `showDust`; el
 *    agujero central (transparente: el canvas es transparente ahí) con el
 *    centrador si `adapter45` y el eje si `spindle`.
 *  - El brillo de la luz NO se dibuja aquí (lo pone la escena por encima,
 *    fijo, mientras el disco gira).
 *  - Debe ser determinista: el "azar" de splatter, mármol y polvo sale de
 *    una semilla derivada de `vinyl.id` para que no parpadee al redibujar.
 *  - `quality: 'low'` reduce el número de anillos (miniaturas).
 */
import type { SideId, Vinyl } from '../core/types';
import type { ImageCache } from './images';

export interface DiscRenderOptions {
  sizePx: number;
  side: SideId;
  showDust: boolean;
  adapter45: boolean;
  spindle: boolean;
  quality: 'low' | 'high';
}

export function renderDiscFace(_vinyl: Vinyl, _opts: DiscRenderOptions, _images: ImageCache): HTMLCanvasElement {
  throw new Error('renderDiscFace: no implementado todavía');
}

/** Clave de caché: cambia cuando cambia algo que afecta al dibujo. */
export function discCacheKey(vinyl: Vinyl, opts: DiscRenderOptions): string {
  const c = vinyl.disc.condition;
  const dust = opts.showDust ? Math.round(c.dust * 40) : -1;
  const scratches = opts.showDust ? Math.round(c.scratches * 20) : -1;
  return [vinyl.id, vinyl.updatedAt, opts.sizePx, opts.side, dust, scratches, opts.adapter45, opts.spindle, opts.quality].join('|');
}
