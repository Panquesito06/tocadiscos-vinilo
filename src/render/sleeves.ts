/**
 * Dibujo de la funda interior y de la funda exterior.
 *
 * CONTRATO (lo implementa el módulo de render de embalaje):
 *  - Funda interior: cuadrado de `sizePx`. Según `kind`: papel blanco, kraft
 *    o negro (con grano y una ligera sombra en los bordes), poly-lined
 *    (blanco con reflejo satinado), impresa (`printFront` / `printBack`).
 *    Si `cutout`, el centro es transparente (círculo del tamaño de la
 *    galleta) para que se vea la galleta del disco que está dentro. `text`
 *    se maqueta en columnas con `textStyle` (letras, créditos) en la cara
 *    pedida. `kind === 'none'` devuelve un canvas transparente.
 *  - Funda exterior: capa que se superpone a la carpeta. PVC transparente:
 *    reflejo blanco diagonal con `gloss`, bordes ligeramente visibles y
 *    solapa superior; tintada: lo mismo con `tint` a `opacity`; impresa:
 *    `print` encima con `opacity`; resellable: solapa con tira adhesiva.
 *    `kind === 'none'` devuelve null.
 */
import type { Vinyl } from '../core/types';
import type { ImageCache } from './images';

export function renderInnerSleeve(
  _vinyl: Vinyl,
  _sizePx: number,
  _face: 'front' | 'back',
  _images: ImageCache,
): HTMLCanvasElement {
  throw new Error('renderInnerSleeve: no implementado todavía');
}

export function renderOuterSleeve(_vinyl: Vinyl, _sizePx: number, _images: ImageCache): HTMLCanvasElement | null {
  throw new Error('renderOuterSleeve: no implementado todavía');
}
