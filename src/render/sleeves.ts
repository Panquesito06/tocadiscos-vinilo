/**
 * Dibujo de la funda interior y de la funda exterior.
 *
 * CONTRATO (lo implementa el módulo de render de embalaje):
 *  - Tamaños en píxeles DE DISPOSITIVO.
 *  - Funda interior: cuadrado de `sizePx` con la MISMA escala que el disco
 *    del mismo vinilo, `sizePx / (2 * discGeometry(format).radiusMm)` px/mm
 *    (la funda es apenas mayor que el disco; se dibuja al mismo tamaño para
 *    que el troquel coincida con la galleta cuando la vista superpone ambos
 *    canvases centrados). Según `kind`: papel blanco, kraft o negro (con
 *    grano y una ligera sombra en los bordes), poly-lined (blanco con
 *    reflejo satinado), impresa (`printFront` / `printBack`). Si `cutout`,
 *    el centro es transparente: círculo de radio `labelRadiusMm + 2` mm,
 *    para que se vea la galleta del disco que está dentro. `text` se maqueta
 *    en columnas con `textStyle` (letras, créditos) en la cara pedida,
 *    respetando el troquel. `kind === 'none'` devuelve un canvas transparente.
 *  - Funda exterior: capa cuadrada de `sizePx` (misma escala que la carpeta,
 *    `jacketSizeMm(format)`) que se superpone a la carpeta. PVC
 *    transparente: reflejo blanco diagonal con `gloss`, bordes ligeramente
 *    visibles y solapa superior; tintada: lo mismo con `tint` a `opacity`;
 *    impresa: `print` encima con `opacity`; resellable: solapa con tira
 *    adhesiva. `kind === 'none'` devuelve null.
 *  - Si `getContext('2d')` devuelve null (tests), devuelve el canvas del
 *    tamaño pedido sin lanzar.
 *
 * Detalles de la implementación:
 *  - Papel: el color es `innerSleeve.color` (si el canvas no lo entiende,
 *    el del tipo: blanco, kraft o negro); grano fino determinista, sombra
 *    suave en los bordes y pliegue de la boca en el borde superior.
 *  - Troquel: círculo transparente con un borde troquelado leve (sombra
 *    interior tenue y filo claro del papel).
 *  - Texto: dos columnas, a los lados del troquel si quedan anchas (≥ 20 %
 *    del lado) y, si no, una banda encima y otra debajo; sin troquel, dos
 *    columnas normales. Se dibuja en ambas caras. Si el color del texto se
 *    confunde con el papel, una banda translúcida detrás.
 *  - Funda exterior: la solapa ocupa el 6 % de la altura (12 % si es
 *    resellable, con tira adhesiva).
 */
import { discGeometry } from '../core/geometry';
import type { Fill, InnerSleeve, OuterSleeveKind, Vinyl } from '../core/types';
import {
  clamp,
  createCanvas,
  cssToken,
  fillBaseColor,
  paintBackingBand,
  paintEdgeShadow,
  paintFill,
  paintGrain,
  paintSheen,
  rect,
  setFillColor,
  textNeedsBacking,
  type Rect,
} from './fill';
import type { ImageCache } from './images';
import { drawColumnLayout, fitColumns, layoutBounds, measureAtFor, textCase, type ColumnBox } from './text-layout';

/** Margen de la funda interior como fracción del lado. */
const MARGIN = 0.07;
/** Milímetros que el troquel sobrepasa el radio de la galleta. */
const CUTOUT_EXTRA_MM = 2;
/** Altura de la solapa de la funda exterior como fracción del lado. */
const FLAP = 0.06;
const FLAP_RESEALABLE = 0.12;

const OFF_WHITE = '#f3f1ec';

// ---------------------------------------------------------------------------
// Funda interior
// ---------------------------------------------------------------------------

export function renderInnerSleeve(
  vinyl: Vinyl,
  sizePx: number,
  face: 'front' | 'back',
  images: ImageCache,
): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(sizePx, sizePx);
  if (!ctx) return canvas;
  const sleeve = vinyl.innerSleeve;
  if (sleeve.kind === 'none') return canvas;
  const S = canvas.width;
  const box = rect(0, 0, S, S);
  const geo = discGeometry(vinyl.disc.format);
  const pxPerMm = S / (2 * geo.radiusMm);
  const seed = `${vinyl.id}|inner-sleeve|${face}`;
  const base = paintSleeveBase(ctx, sleeve, face, box, images, seed);
  const holeR = sleeve.cutout ? (geo.labelRadiusMm + CUTOUT_EXTRA_MM) * pxPerMm : 0;
  if (sleeve.text.trim()) drawSleeveText(ctx, sleeve, S, holeR, base);
  paintEdgeShadow(ctx, box, S * 0.02, 0.18);
  paintTopFold(ctx, S);
  if (sleeve.cutout) cutHole(ctx, S / 2, S / 2, holeR, S);
  return canvas;
}

/** Color por defecto del papel según el tipo (cuando `color` no se entiende). */
function paperDefault(kind: InnerSleeve['kind']): string {
  if (kind === 'paper-kraft') return cssToken('--kraft', '#c9a66b');
  if (kind === 'paper-black') return cssToken('--carbon', '#1c1b19');
  return OFF_WHITE;
}

/** Pinta el material de la funda y devuelve su color representativo (para el contraste del texto). */
function paintSleeveBase(
  ctx: CanvasRenderingContext2D,
  sleeve: InnerSleeve,
  face: 'front' | 'back',
  box: Rect,
  images: ImageCache,
  seed: string,
): string {
  const fallback = paperDefault(sleeve.kind);
  if (sleeve.kind === 'printed') {
    const print = face === 'front' ? sleeve.printFront : sleeve.printBack;
    if (print) {
      paintFill(ctx, print, box, images);
      return fillBaseColor(print, OFF_WHITE);
    }
    setFillColor(ctx, OFF_WHITE);
    ctx.fillRect(box.x, box.y, box.w, box.h);
    paintGrain(ctx, box, seed, 0.12);
    return OFF_WHITE;
  }
  setFillColor(ctx, sleeve.color, fallback);
  ctx.fillRect(box.x, box.y, box.w, box.h);
  if (sleeve.kind === 'poly-lined') {
    paintGrain(ctx, box, seed, 0.04);
    paintSheen(ctx, box, 0.16, 0.38, 0.22);
    paintSheen(ctx, box, 0.08, 0.74, 0.12);
  } else {
    paintGrain(ctx, box, seed, sleeve.kind === 'paper-black' ? 0.1 : 0.14);
  }
  return sleeve.color;
}

/** Pliegue de la boca de la funda en el borde superior: banda apenas más oscura, línea del doblez y filo claro. */
function paintTopFold(ctx: CanvasRenderingContext2D, S: number): void {
  const h = S * 0.03;
  const line = Math.max(1, S * 0.0015);
  ctx.save();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(0, 0, 0, 0.1)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0.02)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, h);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
  ctx.fillRect(0, h - line, S, line);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.fillRect(0, h, S, line);
  ctx.restore();
}

/** Círculo transparente (troquel) con borde troquelado leve. */
function cutHole(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, S: number): void {
  if (r <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000'; // opaco: el borrado depende de la opacidad del relleno
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const d = Math.max(2, S * 0.012);
  const g = ctx.createRadialGradient(cx, cy, r, cx, cy, r + d);
  g.addColorStop(0, 'rgba(0, 0, 0, 0.16)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - r - d, cy - r - d, (r + d) * 2, (r + d) * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.lineWidth = Math.max(1, S * 0.002);
  ctx.beginPath();
  ctx.arc(cx, cy, r + ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Columnas de texto que respetan el troquel: a los lados si quedan anchas, si no encima y debajo. */
export function sleeveTextColumns(S: number, holeR: number): ColumnBox[] {
  const m = S * MARGIN;
  const gap = S * 0.03;
  const top = m + S * 0.03;
  const cx = S / 2;
  const full = S - 2 * m;
  if (holeR <= 0) {
    const w = (full - gap) / 2;
    return [
      { x: m, y: top, w, h: S - m - top },
      { x: m + w + gap, y: top, w, h: S - m - top },
    ];
  }
  const sideW = cx - holeR - gap - m;
  if (sideW >= S * 0.2) {
    return [
      { x: m, y: top, w: sideW, h: S - m - top },
      { x: cx + holeR + gap, y: top, w: sideW, h: S - m - top },
    ];
  }
  const below = cx + holeR + gap;
  return [
    { x: m, y: top, w: full, h: cx - holeR - gap - top },
    { x: m, y: below, w: full, h: S - m - below },
  ];
}

function drawSleeveText(ctx: CanvasRenderingContext2D, sleeve: InnerSleeve, S: number, holeR: number, paperColor: string): void {
  const style = sleeve.textStyle;
  const text = textCase(sleeve.text.trim(), style);
  const columns = sleeveTextColumns(S, holeR);
  const fitted = fitColumns(text, measureAtFor(ctx, style), columns, { startPx: S * 0.03, minPx: S * 0.014, lineHeight: 1.3 });
  const bounds = layoutBounds(fitted.layout, fitted.lineHeight);
  if (!bounds) return;
  if (textNeedsBacking(style.color, paperColor)) {
    paintBackingBand(ctx, rect(bounds.x, bounds.y, bounds.w, bounds.h), style.color, S * 0.015, S * 0.008);
  }
  drawColumnLayout(ctx, fitted.layout, style, fitted.sizePx, fitted.lineHeight);
}

// ---------------------------------------------------------------------------
// Funda exterior
// ---------------------------------------------------------------------------

export function renderOuterSleeve(vinyl: Vinyl, sizePx: number, images: ImageCache): HTMLCanvasElement | null {
  const sleeve = vinyl.outerSleeve;
  if (sleeve.kind === 'none') return null;
  const { canvas, ctx } = createCanvas(sizePx, sizePx);
  if (!ctx) return canvas;
  const S = canvas.width;
  const box = rect(0, 0, S, S);
  const opacity = clamp(sleeve.opacity, 0, 1);
  const gloss = clamp(sleeve.gloss, 0, 1);
  if (sleeve.kind === 'pvc-tinted') paintTint(ctx, box, sleeve.tint, opacity);
  paintPvcSheen(ctx, box, gloss);
  if (sleeve.kind === 'printed' && sleeve.print) paintPrint(ctx, box, sleeve.print, opacity, images);
  paintPvcEdges(ctx, box);
  paintFlap(ctx, S, sleeve.kind);
  return canvas;
}

function paintTint(ctx: CanvasRenderingContext2D, box: Rect, tint: string, opacity: number): void {
  ctx.save();
  ctx.globalAlpha = opacity;
  setFillColor(ctx, tint, '#ffffff');
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.restore();
}

function paintPrint(ctx: CanvasRenderingContext2D, box: Rect, print: Fill, opacity: number, images: ImageCache): void {
  ctx.save();
  ctx.globalAlpha = opacity;
  paintFill(ctx, print, box, images);
  ctx.restore();
}

/** Velo lechoso del plástico y reflejo diagonal proporcional a `gloss`. */
function paintPvcSheen(ctx: CanvasRenderingContext2D, box: Rect, gloss: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.restore();
  const alpha = 0.06 + 0.22 * gloss;
  paintSheen(ctx, box, alpha, 0.4, 0.26);
  paintSheen(ctx, box, alpha * 0.45, 0.72, 0.1);
}

/** Filo del plástico: línea clara en el borde y una sombra tenue justo dentro. */
function paintPvcEdges(ctx: CanvasRenderingContext2D, box: Rect): void {
  const lw = Math.max(1, box.w * 0.003);
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = lw;
  ctx.strokeRect(box.x + lw / 2, box.y + lw / 2, box.w - lw, box.h - lw);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
  ctx.strokeRect(box.x + lw * 1.5, box.y + lw * 1.5, box.w - lw * 3, box.h - lw * 3);
  ctx.restore();
}

/** Solapa superior algo más opaca; la resellable es más alta y lleva tira adhesiva. */
function paintFlap(ctx: CanvasRenderingContext2D, S: number, kind: OuterSleeveKind): void {
  const resealable = kind === 'resealable';
  const h = S * (resealable ? FLAP_RESEALABLE : FLAP);
  const line = Math.max(1, S * 0.0015);
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.fillRect(0, 0, S, h);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.fillRect(0, h - line, S, line);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
  ctx.fillRect(0, h, S, line);
  if (resealable) {
    const stripH = S * 0.018;
    const stripY = h - S * 0.03 - stripH;
    ctx.fillStyle = 'rgba(255, 246, 220, 0.45)';
    ctx.fillRect(S * 0.02, stripY, S * 0.96, stripH);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.fillRect(S * 0.02, stripY, S * 0.96, line);
    ctx.fillRect(S * 0.02, stripY + stripH - line, S * 0.96, line);
  }
  ctx.restore();
}
