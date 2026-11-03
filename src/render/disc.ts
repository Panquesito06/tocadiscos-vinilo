/**
 * Dibujo de una cara del disco en un canvas 2D.
 *
 * CONTRATO (lo implementa el módulo de render del disco):
 *  - El canvas es cuadrado de `sizePx` píxeles DE DISPOSITIVO y el disco
 *    ocupa todo el diámetro. Escala: `sizePx / (2 * discGeometry(format).radiusMm)`
 *    píxeles por mm. Un disco de 7" se dibuja en un canvas más pequeño que
 *    uno de 12" porque el llamador pasa `sizePx` proporcional (la vista del
 *    tocadiscos lo calcula con `discSizePx(format)`).
 *  - Se dibuja, de fuera adentro: el material del vinilo (negro, color,
 *    transparente, splatter, mármol); el borde; los surcos como anillos finos
 *    con variación de tono, más densos cuanto más larga la cara, con bandas
 *    de separación entre canciones (`trackBands`) y zonas de lead-in,
 *    lead-out y dead wax lisas; el texto grabado del dead wax; el aro
 *    decorado (`decoration === 'ring'`); la galleta con todos sus campos;
 *    con `decoration === 'full'`, la obra a cara completa debajo de surcos
 *    tenues y el borde remachado si está activo; el polvo (puntos finos
 *    dispersos según `condition.dust`) y las rayas si `showDust`; el
 *    agujero central transparente (el canvas es transparente ahí).
 *  - Reglas de las caras especiales: con `decoration === 'full'` la obra
 *    (`artwork`) cubre toda la cara, incluida la zona de la galleta, y la
 *    galleta NO se dibuja (solo el agujero y su anillo `holeRingColor`);
 *    los surcos tenues encima de la obra solo si `groovesOverArt`. Si
 *    `side.decorative`, no se dibujan surcos, bandas ni texto del dead wax
 *    sea cual sea `decoration`; con decoración `normal` o `ring` una cara
 *    decorativa muestra el material liso y la galleta. `artwork` solo se
 *    dibuja con `decoration === 'full'`. La anchura efectiva del aro se
 *    limita a `maxRingWidthMm(format)`.
 *  - `adapter45` y `spindle` dibujan el centrador y el eje dentro del
 *    canvas; solo se usan en vistas previas estáticas (editor). En el
 *    tocadiscos ambos son elementos DOM fijos encima del disco y la vista
 *    pide el canvas con `adapter45: false, spindle: false`.
 *  - El brillo de la luz NO se dibuja aquí (lo pone la escena por encima,
 *    fijo, mientras el disco gira).
 *  - Debe ser determinista: el "azar" de splatter, mármol y polvo sale de
 *    una semilla derivada de `vinyl.id` + cara para que no parpadee al
 *    redibujar.
 *  - `quality: 'low'` reduce el número de anillos (miniaturas).
 *  - Si `getContext('2d')` devuelve null (tests), devuelve el canvas vacío
 *    del tamaño pedido sin lanzar.
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

/**
 * Clave de caché: cambia cuando cambia algo que afecta al dibujo. El polvo
 * y las rayas se redondean a 40 y 20 niveles para no redibujar en cada
 * tic de la simulación. El prefijo `id|updatedAt|sizePx|side|` es estable
 * entre niveles de polvo: la fachada lo usa para descartar versiones viejas.
 */
export function discCacheKey(vinyl: Vinyl, opts: DiscRenderOptions): string {
  const c = vinyl.disc.condition;
  const dust = opts.showDust ? Math.round(c.dust * 40) : -1;
  const scratches = opts.showDust ? Math.round(c.scratches * 20) : -1;
  return [vinyl.id, vinyl.updatedAt, opts.sizePx, opts.side, dust, scratches, opts.adapter45, opts.spindle, opts.quality].join('|');
}
