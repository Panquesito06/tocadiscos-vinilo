/**
 * Dibujo de la carpeta (portada, contraportada, interior desplegable) y del lomo.
 *
 * CONTRATO (lo implementa el módulo de render de embalaje):
 *  - Portada: `front` (color, degradado o imagen) más, si
 *    `showTitleOnFront`, artista y título con `titleStyle`. Acabado:
 *    `gloss` añade un reflejo diagonal suave; `textured` un grano fino.
 *    `cutCorner` recorta una esquina; `sticker` dibuja una pegatina redonda.
 *  - Contraportada: `back` más lista de canciones por caras (con duraciones
 *    m:ss) si `showTracklistOnBack`, `backNotes`, sello, número de catálogo
 *    y año en pequeño.
 *  - Interior desplegable: canvas de doble anchura con `insideLeft` e
 *    `insideRight` (si son null, el color de la contraportada).
 *  - Lomo: canvas vertical `widthPx × heightPx` con el texto girado 90°
 *    (de abajo arriba, como en una estantería), fondo `background`, franja
 *    `accentColor` en un extremo y número de catálogo en el otro si procede.
 *  - El canvas de la carpeta es cuadrado de `sizePx` (la carpeta mide
 *    ~2 mm más que el disco por lado, pero se dibuja al mismo tamaño).
 */
import type { Vinyl } from '../core/types';
import type { ImageCache } from './images';

export function renderJacketFront(_vinyl: Vinyl, _sizePx: number, _images: ImageCache): HTMLCanvasElement {
  throw new Error('renderJacketFront: no implementado todavía');
}

export function renderJacketBack(_vinyl: Vinyl, _sizePx: number, _images: ImageCache): HTMLCanvasElement {
  throw new Error('renderJacketBack: no implementado todavía');
}

export function renderGatefoldInside(_vinyl: Vinyl, _sizePx: number, _images: ImageCache): HTMLCanvasElement {
  throw new Error('renderGatefoldInside: no implementado todavía');
}

export function renderSpine(_vinyl: Vinyl, _widthPx: number, _heightPx: number, _images: ImageCache): HTMLCanvasElement {
  throw new Error('renderSpine: no implementado todavía');
}

/** Anchura del lomo en mm: carpeta sencilla 3–5 mm, desplegable 8–10 mm, según grosor del disco. */
export function spineWidthMm(vinyl: Vinyl): number {
  const base = vinyl.jacket.gatefold ? 8 : 3.5;
  return base + vinyl.disc.thicknessMm * 0.8;
}
