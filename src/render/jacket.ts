/**
 * Dibujo de la carpeta (portada, contraportada, interior desplegable) y del lomo.
 *
 * CONTRATO (lo implementa el módulo de render de embalaje):
 *  - Todos los tamaños son píxeles DE DISPOSITIVO. El canvas de la carpeta
 *    es cuadrado de `sizePx` y representa `jacketSizeMm(format)` mm de lado
 *    (315 / 260 / 180): la escala es `sizePx / jacketSizeMm(format)` px/mm.
 *  - Portada: `front` (color, degradado o imagen) más, si
 *    `showTitleOnFront`, artista y título con `titleStyle`. Acabado:
 *    `gloss` añade un reflejo diagonal suave; `textured` un grano fino.
 *    `cutCorner` recorta una esquina; `sticker` dibuja una pegatina redonda
 *    con su texto y color.
 *  - Contraportada: `back` más lista de canciones por caras (con duraciones
 *    m:ss) si `showTracklistOnBack`, `backNotes` con `backStyle`, sello,
 *    número de catálogo y año en pequeño.
 *  - Interior desplegable: canvas de doble anchura con `insideLeft` e
 *    `insideRight` (si son null, el color de la contraportada).
 *  - Lomo: canvas vertical `widthPx × heightPx` con el texto girado 90°
 *    (de abajo arriba, como en una estantería), fondo `background`, franja
 *    `accentColor` en un extremo y número de catálogo en el otro si procede.
 *  - Si `getContext('2d')` devuelve null (tests), devuelve el canvas del
 *    tamaño pedido sin lanzar.
 *
 * Detalles de la implementación:
 *  - Portada: márgenes del 7 %; artista arriba y título debajo, más grande,
 *    encogidos hasta que quepan. Sobre una imagen se oscurece (o aclara, si
 *    el texto es oscuro) ligeramente la zona del texto. Desgaste de
 *    esquinas muy leve y canto de cartón en los bordes. La esquina cortada
 *    es la inferior derecha; vista por detrás, la inferior izquierda.
 *  - Contraportada: "Cara A" / "Cara B" con canciones numeradas y duración
 *    a la derecha, en dos columnas si hay sitio; notas en párrafos (una o
 *    dos columnas); sello, catálogo y año abajo a la izquierda y un código
 *    de barras determinista abajo a la derecha. Si el color del texto se
 *    parece al fondo, una banda translúcida detrás del bloque.
 *  - Interior: con `insideRight` null y texto en la funda interior, ese
 *    texto se maqueta en el panel derecho. Pliegue central sutil.
 *  - Lomo: franja de color (~6 % de la altura) arriba, número de catálogo
 *    pequeño abajo, texto principal entre ambos y sombra lateral leve.
 */
import { spineTextFor } from '../core/defaults';
import { jacketSizeMm } from '../core/geometry';
import type { Fill, Jacket, JacketFinish, TextStyle, Vinyl } from '../core/types';
import {
  clamp,
  createCanvas,
  createRng,
  cssToken,
  fillBaseColor,
  isDarkColor,
  paintBackingBand,
  paintCornerWear,
  paintEdgeShadow,
  paintFill,
  paintGrain,
  paintSheen,
  randInt,
  rect,
  setFillColor,
  textNeedsBacking,
  type Rect,
} from './fill';
import type { ImageCache } from './images';
import {
  drawColumnLayout,
  drawLine,
  drawTextBlock,
  drawVerticalText,
  fitColumns,
  fitSingleLine,
  fitTextBlock,
  formatDuration,
  layoutBounds,
  measureAtFor,
  measureFor,
  textCase,
  wrapText,
  type ColumnBox,
  type Measure,
} from './text-layout';

/** Margen de la carpeta como fracción del lado. */
const MARGIN = 0.07;
/** Lado del triángulo de la esquina cortada como fracción del lado. */
const CUT_CORNER = 0.08;
/** Altura de la franja de color del lomo como fracción de la altura. */
const SPINE_ACCENT = 0.06;

const cream = (): string => cssToken('--crema-galleta', '#f1e6cf');
const carbon = (): string => cssToken('--carbon', '#1c1b19');
const kraft = (): string => cssToken('--kraft', '#c9a66b');

/** Algo que ya está maquetado y solo falta dibujar. */
interface Drawable {
  bounds: Rect;
  draw(): void;
}

// ---------------------------------------------------------------------------
// Portada
// ---------------------------------------------------------------------------

export function renderJacketFront(vinyl: Vinyl, sizePx: number, images: ImageCache): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(sizePx, sizePx);
  if (!ctx) return canvas;
  const S = canvas.width;
  const box = rect(0, 0, S, S);
  const jacket = vinyl.jacket;
  const seed = `${vinyl.id}|jacket-front`;
  paintFill(ctx, jacket.front, box, images);
  if (jacket.showTitleOnFront) drawFrontTitles(ctx, vinyl, S);
  paintFinish(ctx, box, jacket.finish, seed);
  paintBoardEdges(ctx, box, seed);
  if (jacket.sticker) {
    // Con el título impreso arriba, la pegatina va abajo para no taparlo.
    const titled = jacket.showTitleOnFront && (vinyl.meta.artist.trim() !== '' || vinyl.meta.title.trim() !== '');
    drawSticker(ctx, jacket.sticker, S, S / jacketSizeMm(vinyl.disc.format), titled ? 'bottom' : 'top');
  }
  if (jacket.cutCorner) cutCorner(ctx, S, 'right');
  return canvas;
}

/** Artista arriba y título debajo, más grande, encogidos hasta que quepan en el ancho útil. */
function drawFrontTitles(ctx: CanvasRenderingContext2D, vinyl: Vinyl, S: number): void {
  const style = vinyl.jacket.titleStyle;
  const artist = textCase(vinyl.meta.artist.trim(), style);
  const title = textCase(vinyl.meta.title.trim(), style);
  if (!artist && !title) return;
  const m = S * MARGIN;
  const w = S - 2 * m;
  const measureAt = measureAtFor(ctx, style);
  const artistBlock = artist
    ? fitTextBlock(artist, measureAt, w, S * 0.18, { startPx: S * 0.05, minPx: S * 0.024, lineHeight: 1.15, maxLines: 2 })
    : null;
  const titleBlock = title
    ? fitTextBlock(title, measureAt, w, S * 0.42, { startPx: S * 0.095, minPx: S * 0.034, lineHeight: 1.08, maxLines: 4 })
    : null;
  const artistH = artistBlock ? artistBlock.lines.length * artistBlock.lineHeight : 0;
  const titleH = titleBlock ? titleBlock.lines.length * titleBlock.lineHeight : 0;
  const gap = artistBlock && titleBlock ? S * 0.015 : 0;
  if (vinyl.jacket.front.kind === 'image') shadeForLegibility(ctx, S, m + artistH + gap + titleH + S * 0.1, style.color);
  let y = m;
  if (artistBlock) {
    drawTextBlock(ctx, artistBlock.lines, rect(m, y, w, artistH), style, artistBlock.sizePx, artistBlock.lineHeight);
    y += artistH + gap;
  }
  if (titleBlock) drawTextBlock(ctx, titleBlock.lines, rect(m, y, w, titleH), style, titleBlock.sizePx, titleBlock.lineHeight);
}

/** Ligerísimo oscurecimiento (o aclarado, si el texto es oscuro) de la zona del texto sobre una imagen. */
function shadeForLegibility(ctx: CanvasRenderingContext2D, S: number, bottom: number, textColor: string): void {
  const dark = isDarkColor(textColor, false);
  const rgb = dark ? '255, 255, 255' : '0, 0, 0';
  const g = ctx.createLinearGradient(0, 0, 0, Math.min(S, bottom));
  g.addColorStop(0, `rgba(${rgb}, 0.3)`);
  g.addColorStop(0.6, `rgba(${rgb}, 0.18)`);
  g.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, Math.min(S, bottom));
  ctx.restore();
}

/** Acabado del cartón: reflejo diagonal (gloss), grano fino (textured) o nada (matte). */
function paintFinish(ctx: CanvasRenderingContext2D, box: Rect, finish: JacketFinish, seed: string): void {
  if (finish === 'gloss') paintSheen(ctx, box, 0.14, 0.42, 0.26);
  else if (finish === 'textured') paintGrain(ctx, box, seed, 0.15);
}

/** Canto del cartón en los bordes y desgaste muy leve de las esquinas. */
function paintBoardEdges(ctx: CanvasRenderingContext2D, box: Rect, seed: string): void {
  const s = Math.min(box.w, box.h);
  paintEdgeShadow(ctx, box, s * 0.012, 0.16);
  paintCornerWear(ctx, box, `${seed}|wear`, 0.07);
}

/**
 * Centro y radio de la pegatina: a la derecha, arriba o abajo. Abajo deja
 * libre la esquina cortada (el triángulo ocupa el 8 % del lado).
 */
export function stickerPlacement(S: number, pxPerMm: number, corner: 'top' | 'bottom'): { cx: number; cy: number; r: number } {
  const r = clamp(22 * pxPerMm, S * 0.06, S * 0.13);
  const inset = S * 0.055;
  const cx = S - inset - r;
  const cy = corner === 'top' ? inset + r : S - inset - r - S * CUT_CORNER * 0.5;
  return { cx, cy, r };
}

/** Pegatina redonda a la derecha (arriba o abajo) con su texto encogido dentro y una sombra mínima. */
function drawSticker(
  ctx: CanvasRenderingContext2D,
  sticker: { text: string; color: string },
  S: number,
  pxPerMm: number,
  corner: 'top' | 'bottom',
): void {
  const { cx, cy, r } = stickerPlacement(S, pxPerMm, corner);
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
  ctx.shadowBlur = S * 0.008;
  ctx.shadowOffsetX = S * 0.003;
  ctx.shadowOffsetY = S * 0.005;
  setFillColor(ctx, sticker.color, '#ffd166');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = Math.max(1, S * 0.002);
  ctx.beginPath();
  ctx.arc(cx, cy, r - ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  const text = sticker.text.trim();
  if (!text) return;
  const style: TextStyle = {
    color: isDarkColor(sticker.color, false) ? cream() : carbon(),
    weight: 800,
    width: 'normal',
    align: 'center',
    uppercase: false,
  };
  const inner = r * 1.36;
  const block = fitTextBlock(text, measureAtFor(ctx, style), inner, inner, {
    startPx: r * 0.55,
    minPx: r * 0.16,
    lineHeight: 1.1,
    maxLines: 3,
  });
  drawTextBlock(ctx, block.lines, rect(cx - inner / 2, cy - inner / 2, inner, inner), style, block.sizePx, block.lineHeight, 'middle');
}

/** Triángulo transparente en una esquina inferior (corte de saldo) con el canto del cartón marcado. */
function cutCorner(ctx: CanvasRenderingContext2D, S: number, side: 'right' | 'left'): void {
  const leg = S * CUT_CORNER;
  const corner = side === 'right' ? S : 0;
  const inward = side === 'right' ? -leg : leg;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000'; // opaco: el borrado depende de la opacidad del relleno
  ctx.beginPath();
  ctx.moveTo(corner, S);
  ctx.lineTo(corner + inward, S);
  ctx.lineTo(corner, S - leg);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.lineWidth = Math.max(1, S * 0.003);
  ctx.beginPath();
  ctx.moveTo(corner + inward, S);
  ctx.lineTo(corner, S - leg);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Contraportada
// ---------------------------------------------------------------------------

export function renderJacketBack(vinyl: Vinyl, sizePx: number, images: ImageCache): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(sizePx, sizePx);
  if (!ctx) return canvas;
  const S = canvas.width;
  const box = rect(0, 0, S, S);
  const jacket = vinyl.jacket;
  const seed = `${vinyl.id}|jacket-back`;
  paintFill(ctx, jacket.back, box, images);
  drawBackContent(ctx, vinyl, S, S / jacketSizeMm(vinyl.disc.format));
  paintFinish(ctx, box, jacket.finish, seed);
  paintBoardEdges(ctx, box, seed);
  if (jacket.cutCorner) cutCorner(ctx, S, 'left');
  return canvas;
}

/** Caja que envuelve varias cajas. */
function unionRect(boxes: Rect[]): Rect {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return rect(x0, y0, x1 - x0, y1 - y0);
}

/** True si conviene una banda detrás del texto: poco contraste o fondo de imagen (no se puede saber). */
function needsBand(style: TextStyle, background: Fill): boolean {
  return background.kind === 'image' || textNeedsBacking(style.color, fillBaseColor(background, cream()));
}

/** Dibuja un grupo de bloques, con banda translúcida detrás si el texto se confunde con el fondo. */
function drawBacked(ctx: CanvasRenderingContext2D, items: Drawable[], style: TextStyle, background: Fill, S: number): void {
  if (items.length === 0) return;
  if (needsBand(style, background)) {
    paintBackingBand(ctx, unionRect(items.map((d) => d.bounds)), style.color, S * 0.02, S * 0.01);
  }
  for (const item of items) item.draw();
}

function drawBackContent(ctx: CanvasRenderingContext2D, vinyl: Vinyl, S: number, pxPerMm: number): void {
  const jacket = vinyl.jacket;
  const style = jacket.backStyle;
  const m = S * MARGIN;
  const footer = planFooter(ctx, vinyl, S, pxPerMm);
  const area = rect(m, m, S - 2 * m, S - 2 * m - footer.height - S * 0.025);
  const body: Drawable[] = [];
  let y = area.y;
  const notes = jacket.backNotes.trim();
  if (jacket.showTracklistOnBack) {
    const share = notes ? 0.62 : 1;
    const tracklist = planTracklist(ctx, vinyl, rect(area.x, y, area.w, area.h * share), S);
    if (tracklist) {
      body.push(tracklist);
      y = tracklist.bounds.y + tracklist.bounds.h + S * 0.035;
    }
  }
  if (notes && y < area.y + area.h) {
    const block = planNotes(ctx, textCase(notes, style), style, rect(area.x, y, area.w, area.y + area.h - y), S);
    if (block) body.push(block);
  }
  drawBacked(ctx, body, style, jacket.back, S);
  drawBacked(ctx, footer.text ? [footer.text] : [], style, jacket.back, S);
  if (footer.barcode) drawBarcode(ctx, footer.barcode, `${vinyl.id}|barcode|${vinyl.meta.catalogNumber}`);
}

// --- Lista de canciones ---

interface TrackRow {
  number: string;
  lines: string[];
  duration: string;
  height: number;
}

interface SideBlock {
  heading: string;
  rows: TrackRow[];
  height: number;
}

interface TracklistPlan {
  sizePx: number;
  lineHeight: number;
  header: string;
  headerSize: number;
  headerHeight: number;
  columns: 1 | 2;
  blocks: SideBlock[];
  numberWidth: number;
  durationWidth: number;
  height: number;
}

function sideHeading(sideId: string): string {
  return `Cara ${sideId}`;
}

/** Mide la lista completa a un tamaño dado. Las columnas y la separación salen de `area` y `S`. */
function measureTracklist(ctx: CanvasRenderingContext2D, vinyl: Vinyl, area: Rect, S: number, sizePx: number): TracklistPlan {
  const style = vinyl.jacket.backStyle;
  const heading = headingStyle(style);
  const lineHeight = sizePx * 1.3;
  const measure = measureFor(ctx, style, sizePx);
  const sides = vinyl.disc.sides.filter((s) => s.tracks.length > 0);
  const gutter = S * 0.05;
  const columns: 1 | 2 = sides.length === 2 && (area.w - gutter) / 2 >= sizePx * 11 ? 2 : 1;
  const colW = columns === 2 ? (area.w - gutter) / 2 : area.w;
  const header = textCase([vinyl.meta.artist.trim(), vinyl.meta.title.trim()].filter(Boolean).join(' — '), style);
  const headerSize = header ? fitSingleLine(header, measureAtFor(ctx, heading), area.w, sizePx * 1.25, sizePx * 0.9) : 0;
  const headerHeight = header ? headerSize * 1.4 + lineHeight * 0.4 : 0;
  const numbers = sides.flatMap((s) => s.tracks.map((_, i) => `${i + 1}.`));
  const numberWidth = Math.max(0, ...numbers.map((n) => measure(n))) + sizePx * 0.5;
  const durations = sides.flatMap((s) => s.tracks.map((t) => (t.durationSec > 0 ? formatDuration(t.durationSec) : '')));
  const durationWidth = Math.max(0, ...durations.map((d) => measure(d))) + sizePx * 0.6;
  const titleWidth = Math.max(sizePx * 2, colW - numberWidth - durationWidth);
  const blocks: SideBlock[] = sides.map((side) => {
    const rows = side.tracks.map((track, i): TrackRow => {
      const lines = wrapText(textCase(track.title.trim() || 'Sin título', style), measure, titleWidth, 2).lines;
      return {
        number: `${i + 1}.`,
        lines,
        duration: track.durationSec > 0 ? formatDuration(track.durationSec) : '',
        height: Math.max(1, lines.length) * lineHeight,
      };
    });
    const height = lineHeight * 1.15 + rows.reduce((acc, r) => acc + r.height, 0);
    return { heading: textCase(sideHeading(side.id), heading), rows, height };
  });
  const bodyHeight =
    columns === 2
      ? Math.max(...blocks.map((b) => b.height))
      : blocks.reduce((acc, b) => acc + b.height, 0) + Math.max(0, blocks.length - 1) * lineHeight * 0.8;
  return {
    sizePx,
    lineHeight,
    header,
    headerSize,
    headerHeight,
    columns,
    blocks,
    numberWidth,
    durationWidth,
    height: headerHeight + bodyHeight,
  };
}

function headingStyle(style: TextStyle): TextStyle {
  return { ...style, weight: clamp(style.weight + 200, 100, 900) };
}

function planTracklist(ctx: CanvasRenderingContext2D, vinyl: Vinyl, area: Rect, S: number): Drawable | null {
  if (!vinyl.disc.sides.some((s) => s.tracks.length > 0)) return null;
  let size = S * 0.03;
  const min = S * 0.015;
  let plan = measureTracklist(ctx, vinyl, area, S, size);
  while (plan.height > area.h && size > min) {
    size = Math.max(min, size * 0.92);
    plan = measureTracklist(ctx, vinyl, area, S, size);
  }
  const height = Math.min(plan.height, area.h);
  return {
    bounds: rect(area.x, area.y, area.w, height),
    draw: () => drawTracklist(ctx, plan, vinyl.jacket.backStyle, area, S),
  };
}

function drawTracklist(ctx: CanvasRenderingContext2D, plan: TracklistPlan, style: TextStyle, area: Rect, S: number): void {
  const heading = headingStyle(style);
  const bottom = area.y + area.h;
  let y = area.y;
  if (plan.header) {
    const x = style.align === 'left' ? area.x : style.align === 'right' ? area.x + area.w : area.x + area.w / 2;
    drawLine(ctx, plan.header, x, y + (plan.headerSize * 1.4) / 2, heading, plan.headerSize);
    y += plan.headerHeight;
  }
  const gutter = S * 0.05;
  const colW = plan.columns === 2 ? (area.w - gutter) / 2 : area.w;
  plan.blocks.forEach((block, i) => {
    const x = plan.columns === 2 ? area.x + i * (colW + gutter) : area.x;
    const used = drawSideBlock(ctx, plan, block, style, heading, x, y, colW, bottom);
    if (plan.columns === 1) y += used + plan.lineHeight * 0.8;
  });
}

/** Dibuja la cabecera y las filas de una cara; devuelve la altura usada. Las filas que no caben se sustituyen por "…". */
function drawSideBlock(
  ctx: CanvasRenderingContext2D,
  plan: TracklistPlan,
  block: SideBlock,
  style: TextStyle,
  heading: TextStyle,
  x: number,
  top: number,
  colW: number,
  bottom: number,
): number {
  const lh = plan.lineHeight;
  const left: TextStyle = { ...style, align: 'left' };
  const right: TextStyle = { ...style, align: 'right' };
  let y = top;
  if (y + lh * 1.15 > bottom + 1e-6) return 0;
  const hx = style.align === 'left' ? x : style.align === 'right' ? x + colW : x + colW / 2;
  drawLine(ctx, block.heading, hx, y + (lh * 1.15) / 2, heading, plan.sizePx);
  y += lh * 1.15;
  for (const row of block.rows) {
    if (y + row.height > bottom + 1e-6) {
      if (y + lh <= bottom + 1e-6) drawLine(ctx, '…', x + plan.numberWidth, y + lh / 2, left, plan.sizePx);
      y += Math.min(lh, Math.max(0, bottom - y));
      break;
    }
    drawLine(ctx, row.number, x, y + lh / 2, left, plan.sizePx);
    row.lines.forEach((line, i) => drawLine(ctx, line, x + plan.numberWidth, y + lh * (i + 0.5), left, plan.sizePx));
    if (row.duration) drawLine(ctx, row.duration, x + colW, y + lh / 2, right, plan.sizePx);
    y += row.height;
  }
  return y - top;
}

// --- Notas ---

/** Notas en párrafos: una columna si caben al tamaño base; si no, dos columnas encogiendo hasta que quepan. */
function planNotes(ctx: CanvasRenderingContext2D, text: string, style: TextStyle, area: Rect, S: number): Drawable | null {
  const measureAt = measureAtFor(ctx, style);
  const start = S * 0.026;
  const min = S * 0.015;
  const gutter = S * 0.05;
  const one: ColumnBox[] = [area];
  const half = (area.w - gutter) / 2;
  const two: ColumnBox[] = [
    { x: area.x, y: area.y, w: half, h: area.h },
    { x: area.x + half + gutter, y: area.y, w: half, h: area.h },
  ];
  let fitted = fitColumns(text, measureAt, one, { startPx: start, minPx: start, lineHeight: 1.35 });
  if (fitted.layout.overflow) fitted = fitColumns(text, measureAt, two, { startPx: start, minPx: min, lineHeight: 1.35 });
  const bounds = layoutBounds(fitted.layout, fitted.lineHeight);
  if (!bounds) return null;
  return {
    bounds: rect(bounds.x, bounds.y, bounds.w, bounds.h),
    draw: () => drawColumnLayout(ctx, fitted.layout, style, fitted.sizePx, fitted.lineHeight),
  };
}

// --- Pie: sello, catálogo, año y código de barras ---

interface FooterPlan {
  height: number;
  text: Drawable | null;
  barcode: Rect | null;
}

function planFooter(ctx: CanvasRenderingContext2D, vinyl: Vinyl, S: number, pxPerMm: number): FooterPlan {
  const style = vinyl.jacket.backStyle;
  const m = S * MARGIN;
  const size = S * 0.021;
  const lh = size * 1.3;
  const label = vinyl.meta.labelName.trim();
  const details = [vinyl.meta.catalogNumber.trim(), vinyl.meta.year.trim()].filter(Boolean).join(' · ');
  const lines: { text: string; style: TextStyle }[] = [];
  if (label) lines.push({ text: textCase(label, style), style: { ...headingStyle(style), align: 'left' } });
  if (details) lines.push({ text: textCase(details, style), style: { ...style, align: 'left' } });
  const barcodeW = clamp(38 * pxPerMm, S * 0.1, S * 0.22);
  const barcodeH = barcodeW * 0.55;
  const barcode = rect(S - m - barcodeW, S - m - barcodeH, barcodeW, barcodeH);
  const textW = Math.max(S * 0.1, barcode.x - S * 0.03 - m);
  const textH = lines.length * lh;
  const text: Drawable | null = lines.length
    ? {
        bounds: rect(m, S - m - textH, textW, textH),
        draw: () => {
          lines.forEach((line, i) => {
            const width = measureFor(ctx, line.style, size)(line.text);
            const maxWidth = width > textW ? textW : undefined;
            drawLine(ctx, line.text, m, S - m - textH + lh * (i + 0.5), line.style, size, { align: 'left', maxWidth });
          });
        },
      }
    : null;
  return { height: Math.max(textH, barcodeH), text, barcode };
}

/** Código de barras determinista (semilla → anchuras de barras y 13 dígitos) sobre un recuadro blanco. */
function drawBarcode(ctx: CanvasRenderingContext2D, box: Rect, seed: string): void {
  const rng = createRng(seed);
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.lineWidth = Math.max(1, box.w * 0.006);
  ctx.strokeRect(box.x + ctx.lineWidth / 2, box.y + ctx.lineWidth / 2, box.w - ctx.lineWidth, box.h - ctx.lineWidth);
  const pad = box.w * 0.06;
  const digitsH = box.h * 0.26;
  const barsH = box.h - pad * 2 - digitsH;
  const modules = 67;
  const moduleW = (box.w - 2 * pad) / modules;
  ctx.fillStyle = carbon();
  let i = 0;
  let bar = true;
  while (i < modules) {
    const run = Math.min(1 + randInt(rng, 3), modules - i);
    // Todas las barras terminan sobre la franja de los dígitos: las de guarda alargadas los tachaban,
    // porque aquí los dígitos van centrados en una sola línea y no repartidos entre las guardas.
    if (bar) ctx.fillRect(box.x + pad + i * moduleW, box.y + pad, run * moduleW, barsH);
    i += run;
    bar = !bar;
  }
  const digits = Array.from({ length: 13 }, () => String(randInt(rng, 10))).join('');
  const style: TextStyle = { color: carbon(), weight: 500, width: 'normal', align: 'center', uppercase: false };
  drawLine(ctx, digits, box.x + box.w / 2, box.y + box.h - pad - digitsH / 2, style, digitsH * 0.95, {
    align: 'center',
    maxWidth: box.w - 2 * pad,
  });
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Interior desplegable
// ---------------------------------------------------------------------------

export function renderGatefoldInside(vinyl: Vinyl, sizePx: number, images: ImageCache): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(sizePx * 2, sizePx);
  if (!ctx) return canvas;
  const S = canvas.height;
  const left = rect(0, 0, S, S);
  const right = rect(S, 0, canvas.width - S, S);
  const whole = rect(0, 0, canvas.width, S);
  const jacket = vinyl.jacket;
  const seed = `${vinyl.id}|gatefold`;
  const fallback = gatefoldFallback(jacket);
  paintFill(ctx, jacket.insideLeft ?? fallback, left, images);
  paintFill(ctx, jacket.insideRight ?? fallback, right, images);
  const text = vinyl.innerSleeve.text.trim();
  if (!jacket.insideRight && text) drawGatefoldText(ctx, vinyl, right, fallback);
  paintFinish(ctx, whole, jacket.finish, seed);
  paintFold(ctx, S, canvas.height);
  paintEdgeShadow(ctx, whole, S * 0.012, 0.16);
  paintCornerWear(ctx, whole, `${seed}|wear`, 0.06);
  return canvas;
}

/** Color de los paneles sin relleno propio: el de la contraportada si es sólido; si no, kraft. */
function gatefoldFallback(jacket: Jacket): Fill {
  return jacket.back.kind === 'solid' ? jacket.back : { kind: 'solid', color: kraft() };
}

/** El texto de la funda interior (letras, créditos) maquetado en columnas en el panel derecho. */
function drawGatefoldText(ctx: CanvasRenderingContext2D, vinyl: Vinyl, panel: Rect, background: Fill): void {
  const style = vinyl.innerSleeve.textStyle;
  const S = panel.h;
  const m = S * MARGIN;
  const gutter = S * 0.05;
  const half = (panel.w - 2 * m - gutter) / 2;
  const columns: ColumnBox[] = [
    { x: panel.x + m, y: panel.y + m, w: half, h: S - 2 * m },
    { x: panel.x + m + half + gutter, y: panel.y + m, w: half, h: S - 2 * m },
  ];
  const text = textCase(vinyl.innerSleeve.text.trim(), style);
  const fitted = fitColumns(text, measureAtFor(ctx, style), columns, { startPx: S * 0.028, minPx: S * 0.014, lineHeight: 1.35 });
  const bounds = layoutBounds(fitted.layout, fitted.lineHeight);
  if (!bounds) return;
  const item: Drawable = {
    bounds: rect(bounds.x, bounds.y, bounds.w, bounds.h),
    draw: () => drawColumnLayout(ctx, fitted.layout, style, fitted.sizePx, fitted.lineHeight),
  };
  drawBacked(ctx, [item], style, background, S);
}

/** Pliegue central: sombra hacia el lomo, un filo claro y la línea del doblez. */
function paintFold(ctx: CanvasRenderingContext2D, x: number, height: number): void {
  const w = Math.max(2, height * 0.035);
  ctx.save();
  let g = ctx.createLinearGradient(x - w, 0, x, 0);
  g.addColorStop(0, 'rgba(0, 0, 0, 0)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0.16)');
  ctx.fillStyle = g;
  ctx.fillRect(x - w, 0, w, height);
  g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, 'rgba(0, 0, 0, 0.12)');
  g.addColorStop(0.3, 'rgba(255, 255, 255, 0.06)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(x, 0, w, height);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.fillRect(x - 0.5, 0, 1, height);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Lomo
// ---------------------------------------------------------------------------

export function renderSpine(vinyl: Vinyl, widthPx: number, heightPx: number, _images: ImageCache): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(widthPx, heightPx);
  if (!ctx) return canvas;
  const W = canvas.width;
  const H = canvas.height;
  const spine = vinyl.spine;
  const style = spine.textStyle;
  setFillColor(ctx, spine.background, carbon());
  ctx.fillRect(0, 0, W, H);
  let top = H * 0.03;
  if (spine.accentColor) {
    setFillColor(ctx, spine.accentColor, cream());
    ctx.fillRect(0, 0, W, H * SPINE_ACCENT);
    top = H * SPINE_ACCENT + H * 0.025;
  }
  let bottom = H - H * 0.03;
  const catalog = spine.showCatalogNumber ? textCase(vinyl.meta.catalogNumber.trim(), style) : '';
  if (catalog) bottom -= drawSpineCatalog(ctx, catalog, style, W, H, bottom) + H * 0.03;
  const text = textCase(spine.text.trim() || spineTextFor(vinyl.meta), style);
  drawSpineText(ctx, text, style, W, top, bottom);
  paintSideShading(ctx, W, H);
  return canvas;
}

/** Número de catálogo pequeño en el extremo inferior; devuelve la longitud que ocupa. */
function drawSpineCatalog(ctx: CanvasRenderingContext2D, catalog: string, style: TextStyle, W: number, H: number, bottom: number): number {
  const small: TextStyle = { ...style, weight: clamp(style.weight, 400, 700), align: 'left' };
  const size = fitSingleLine(catalog, measureAtFor(ctx, small), H * 0.22, W * 0.36, W * 0.2);
  const measure = measureFor(ctx, small, size);
  const line = wrapText(catalog, measure, H * 0.22, 1).lines[0] ?? '';
  const length = measure(line);
  drawVerticalText(ctx, line, W / 2, bottom - length, bottom, small, size, 'left');
  return length;
}

/** Texto principal del lomo, girado −90°, encogido hasta que quepa entre `top` y `bottom`. */
function drawSpineText(ctx: CanvasRenderingContext2D, text: string, style: TextStyle, W: number, top: number, bottom: number): void {
  const available = bottom - top;
  if (!text || available <= 0) return;
  const size = fitSingleLine(text, measureAtFor(ctx, style), available, W * 0.62, W * 0.28);
  const measure: Measure = measureFor(ctx, style, size);
  const line = measure(text) > available ? (wrapText(text, measure, available, 1).lines[0] ?? '') : text;
  drawVerticalText(ctx, line, W / 2, top, bottom, style, size);
}

/** Sombra lateral leve: el lomo es un canto doblado, más oscuro hacia los bordes. */
function paintSideShading(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.save();
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(0, 0, 0, 0.22)');
  g.addColorStop(0.18, 'rgba(0, 0, 0, 0)');
  g.addColorStop(0.3, 'rgba(255, 255, 255, 0.05)');
  g.addColorStop(0.8, 'rgba(0, 0, 0, 0)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** Anchura del lomo en mm: carpeta sencilla 3–5 mm, desplegable 8–10 mm, según grosor del disco. */
export function spineWidthMm(vinyl: Vinyl): number {
  const base = vinyl.jacket.gatefold ? 8 : 3.5;
  return base + vinyl.disc.thicknessMm * 0.8;
}
