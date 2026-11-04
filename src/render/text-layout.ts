/**
 * Maquetación de texto con `TextStyle` sobre canvas para el embalaje.
 *
 *  - Fuente: una sola familia (Archivo variable) con contraste de anchura.
 *    Si el contexto admite `fontStretch` y la fuente cargada responde al
 *    eje de anchura, se usa la anchura nativa; si no, se emula escalando el
 *    texto horizontalmente alrededor de su punto de anclaje.
 *  - Medición y dibujo de una línea, recta o girada −90° (se lee de abajo
 *    arriba, como un lomo en la estantería).
 *  - Ajuste de párrafos en líneas, encogido del tamaño hasta que quepa y
 *    reparto en columnas de distinta forma (a los lados o encima y debajo
 *    de un troquel). Las funciones de maquetación son puras: reciben un
 *    medidor (`Measure`) y no tocan el canvas, así se prueban sin él. El
 *    texto que reciben ya lleva aplicado `textCase` (dibujarlo vuelve a
 *    aplicarlo, lo que no cambia nada).
 */
import type { FontWidth, TextStyle } from '../core/types';

export const FONT_FAMILY = "'Archivo Variable', 'Archivo', system-ui, sans-serif";

/** Escala horizontal que emula cada anchura cuando no hay eje `wdth`. */
export const WIDTH_SCALE: Record<FontWidth, number> = { condensed: 0.82, normal: 1, expanded: 1.18 };

const STRETCH_KEYWORD: Record<FontWidth, CanvasFontStretch> = { condensed: 'condensed', normal: 'normal', expanded: 'expanded' };

/** Medidor de anchura (px) de una cadena ya transformada. */
export type Measure = (text: string) => number;

/** Fábrica de medidores por tamaño, para encoger hasta que quepa. */
export type MeasureAt = (sizePx: number) => Measure;

export function fontString(weight: number, sizePx: number): string {
  const w = Math.round(Math.min(900, Math.max(100, weight)));
  return `${w} ${Math.max(1, sizePx)}px ${FONT_FAMILY}`;
}

/** Aplica la transformación de mayúsculas del estilo (idempotente). */
export function textCase(text: string, style: Pick<TextStyle, 'uppercase'>): string {
  return style.uppercase ? text.toLocaleUpperCase('es') : text;
}

/** Navegadores antiguos no tienen `fontStretch`; se comprueba en tiempo de ejecución. */
type StretchContext = CanvasRenderingContext2D & { fontStretch?: CanvasFontStretch };

const PROBE_TEXT = 'HHHHHHHHHH';
const stretchProbe = new Map<string, boolean>();

/** Olvida el resultado de la sonda de anchura nativa (tests, o si cambia la fuente cargada). */
export function resetStretchProbe(): void {
  stretchProbe.clear();
}

function fontsStatus(): string {
  try {
    return typeof document !== 'undefined' && document.fonts ? document.fonts.status : '';
  } catch {
    return '';
  }
}

/**
 * Intenta la anchura nativa. Devuelve true solo si el contexto admite
 * `fontStretch` Y la fuente responde (una fuente sin eje `wdth` mide igual).
 * El resultado se recuerda por anchura y estado de carga de las fuentes.
 */
function applyNativeStretch(ctx: StretchContext, width: FontWidth): boolean {
  if (typeof ctx.fontStretch !== 'string') return false;
  if (width === 'normal') {
    ctx.fontStretch = 'normal';
    return true;
  }
  const key = `${width}|${fontsStatus()}`;
  let works = stretchProbe.get(key);
  if (works === undefined) {
    ctx.fontStretch = 'normal';
    const base = ctx.measureText(PROBE_TEXT).width;
    ctx.fontStretch = STRETCH_KEYWORD[width];
    const stretched = ctx.measureText(PROBE_TEXT).width;
    works = base > 0 && Math.abs(stretched - base) > base * 0.01;
    stretchProbe.set(key, works);
  }
  ctx.fontStretch = works ? STRETCH_KEYWORD[width] : 'normal';
  return works;
}

/**
 * Configura fuente, anchura y color del contexto para un `TextStyle` y
 * devuelve la escala horizontal que hay que aplicar al dibujar (1 cuando
 * la anchura es nativa).
 */
export function applyTextStyle(ctx: CanvasRenderingContext2D, style: TextStyle, sizePx: number): number {
  ctx.font = fontString(style.weight, sizePx);
  ctx.fillStyle = style.color;
  return applyNativeStretch(ctx as StretchContext, style.width) ? 1 : WIDTH_SCALE[style.width];
}

/** Medidor para un estilo y tamaño. Vuelve a aplicar el estilo si otro dibujo cambió la fuente. */
export function measureFor(ctx: CanvasRenderingContext2D, style: TextStyle, sizePx: number): Measure {
  let sx = applyTextStyle(ctx, style, sizePx);
  const font = ctx.font;
  const stretch = (ctx as StretchContext).fontStretch;
  return (text) => {
    if (ctx.font !== font || (ctx as StretchContext).fontStretch !== stretch) sx = applyTextStyle(ctx, style, sizePx);
    return ctx.measureText(text).width * sx;
  };
}

/** Fábrica de medidores por tamaño para un estilo. */
export function measureAtFor(ctx: CanvasRenderingContext2D, style: TextStyle): MeasureAt {
  return (sizePx) => measureFor(ctx, style, sizePx);
}

export interface DrawLineOptions {
  /** Alineación; por defecto la del estilo. */
  align?: TextStyle['align'];
  baseline?: CanvasTextBaseline;
  /** Rotación en radianes alrededor de (x, y). */
  rotation?: number;
  /** Anchura máxima: el canvas comprime el texto si la supera. */
  maxWidth?: number;
}

/**
 * Dibuja una línea de texto anclada en (x, y). La anchura emulada se
 * consigue escalando horizontalmente alrededor del anclaje, así la
 * alineación sigue siendo correcta.
 */
export function drawLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  style: TextStyle,
  sizePx: number,
  opts: DrawLineOptions = {},
): void {
  const t = textCase(text, style);
  if (!t) return;
  const sx = applyTextStyle(ctx, style, sizePx);
  ctx.save();
  ctx.translate(x, y);
  if (opts.rotation) ctx.rotate(opts.rotation);
  if (sx !== 1) ctx.scale(sx, 1);
  ctx.textAlign = opts.align ?? style.align;
  ctx.textBaseline = opts.baseline ?? 'middle';
  if (opts.maxWidth !== undefined) ctx.fillText(t, 0, 0, Math.max(1, opts.maxWidth / sx));
  else ctx.fillText(t, 0, 0);
  ctx.restore();
}

/**
 * Texto girado −90° (se lee de abajo arriba) centrado en la vertical `x`,
 * dentro de la banda [yTop, yBottom]: `left` arranca abajo, `right` termina
 * arriba y `center` queda centrado.
 */
export function drawVerticalText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  yTop: number,
  yBottom: number,
  style: TextStyle,
  sizePx: number,
  align: TextStyle['align'] = style.align,
): void {
  const anchorY = align === 'left' ? yBottom : align === 'right' ? yTop : (yTop + yBottom) / 2;
  drawLine(ctx, text, x, anchorY, style, sizePx, { align, rotation: -Math.PI / 2, baseline: 'middle' });
}

// ---------------------------------------------------------------------------
// Ajuste en líneas
// ---------------------------------------------------------------------------

function splitWords(paragraph: string): string[] {
  return paragraph.split(/\s+/).filter((w) => w.length > 0);
}

function paragraphsOf(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/** Rompe una palabra demasiado larga en trozos que quepan en `width` (al menos un carácter por trozo). */
function breakWord(word: string, measure: Measure, width: number): string[] {
  const parts: string[] = [];
  let current = '';
  for (const ch of Array.from(word)) {
    if (current && measure(current + ch) > width) {
      parts.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

interface WrapFlags {
  /** Alguna palabra no cupo entera en su línea y hubo que partirla. */
  broken: boolean;
}

/**
 * Saca de `queue` las palabras que caben en una línea de `width` (al menos
 * una; si no cabe sola, se parte y el resto vuelve a la cola).
 */
function takeLine(queue: string[], measure: Measure, width: number, flags: WrapFlags): string {
  let line = queue.shift() ?? '';
  if (measure(line) > width) {
    flags.broken = true;
    const pieces = breakWord(line, measure, width);
    line = pieces[0] ?? line;
    queue.unshift(...pieces.slice(1));
  }
  while (queue.length > 0) {
    const candidate = `${line} ${queue[0]}`;
    if (measure(candidate) > width) break;
    line = candidate;
    queue.shift();
  }
  return line;
}

/** Añade puntos suspensivos a la última línea recortando lo que haga falta para que quepa en `width`. */
export function addEllipsis(lines: string[], measure: Measure, width: number): void {
  const i = lines.length - 1;
  if (i < 0) return;
  let last = lines[i]!;
  while (last.length > 0 && measure(`${last}…`) > width) last = last.slice(0, -1).trimEnd();
  lines[i] = last ? `${last}…` : '…';
}

export interface WrapResult {
  lines: string[];
  /** True si se quedó texto fuera por `maxLines` (la última línea lleva puntos suspensivos). */
  truncated: boolean;
  /** True si alguna palabra hubo que partirla porque no cabía entera en una línea. */
  broken: boolean;
}

/**
 * Ajusta `text` en líneas de anchura `width`. Respeta los saltos de línea
 * explícitos (las líneas en blanco se ignoran), parte las palabras que no
 * caben solas y, si se supera `maxLines`, corta y añade puntos suspensivos.
 */
export function wrapText(text: string, measure: Measure, width: number, maxLines = Number.POSITIVE_INFINITY): WrapResult {
  const lines: string[] = [];
  const flags: WrapFlags = { broken: false };
  for (const paragraph of paragraphsOf(text)) {
    const queue = splitWords(paragraph);
    while (queue.length > 0) {
      if (lines.length >= maxLines) {
        addEllipsis(lines, measure, width);
        return { lines, truncated: true, broken: flags.broken };
      }
      lines.push(takeLine(queue, measure, width, flags));
    }
  }
  return { lines, truncated: false, broken: flags.broken };
}

/**
 * Reduce un tamaño desde `startPx` multiplicando por `step` hasta que
 * `fits(size)` sea cierto o se alcance `minPx`. Devuelve el tamaño final
 * (como mínimo `minPx`, quepa o no).
 */
export function shrinkToFit(startPx: number, minPx: number, fits: (sizePx: number) => boolean, step = 0.92): number {
  let size = Math.max(minPx, startPx);
  while (size > minPx && !fits(size)) size = Math.max(minPx, size * step);
  return size;
}

/** Tamaño (entre `minPx` y `startPx`) al que `text` cabe en una sola línea de `maxWidth`. */
export function fitSingleLine(text: string, measureAt: MeasureAt, maxWidth: number, startPx: number, minPx: number): number {
  return shrinkToFit(startPx, minPx, (size) => measureAt(size)(text) <= maxWidth);
}

export interface BlockOptions {
  startPx: number;
  minPx: number;
  /** Interlineado como factor del tamaño (1,2 por defecto). */
  lineHeight?: number;
  maxLines?: number;
}

export interface FittedBlock {
  sizePx: number;
  lineHeight: number;
  lines: string[];
  truncated: boolean;
}

/**
 * Ajusta un bloque de texto corto (título, pegatina) en `width × height`:
 * encoge el tamaño desde `startPx` hasta que todas las líneas caben (en
 * anchura y en altura) sin partir palabras, o se llega a `minPx`, en cuyo
 * caso se parten las palabras y se corta con puntos suspensivos.
 */
export function fitTextBlock(text: string, measureAt: MeasureAt, width: number, height: number, opts: BlockOptions): FittedBlock {
  const factor = opts.lineHeight ?? 1.2;
  const maxLines = opts.maxLines ?? Number.POSITIVE_INFINITY;
  const attempt = (sizePx: number): FittedBlock & { broken: boolean } => {
    const lineHeight = sizePx * factor;
    const allowed = Math.max(1, Math.min(maxLines, Math.floor(height / lineHeight + 1e-6)));
    const wrapped = wrapText(text, measureAt(sizePx), width, allowed);
    return { sizePx, lineHeight, lines: wrapped.lines, truncated: wrapped.truncated, broken: wrapped.broken };
  };
  let size = Math.max(opts.minPx, opts.startPx);
  let result = attempt(size);
  while ((result.truncated || result.broken) && size > opts.minPx) {
    size = Math.max(opts.minPx, size * 0.92);
    result = attempt(size);
  }
  return { sizePx: result.sizePx, lineHeight: result.lineHeight, lines: result.lines, truncated: result.truncated };
}

/** Altura total de un bloque de líneas. */
export function blockHeight(block: Pick<FittedBlock, 'lines' | 'lineHeight'>): number {
  return block.lines.length * block.lineHeight;
}

/**
 * Dibuja líneas dentro de `box` con la alineación horizontal del estilo y
 * la vertical pedida. Devuelve la altura ocupada.
 */
export function drawTextBlock(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  box: { x: number; y: number; w: number; h: number },
  style: TextStyle,
  sizePx: number,
  lineHeight: number,
  valign: 'top' | 'middle' | 'bottom' = 'top',
): number {
  const total = lines.length * lineHeight;
  const startY = valign === 'top' ? box.y : valign === 'bottom' ? box.y + box.h - total : box.y + (box.h - total) / 2;
  const x = style.align === 'left' ? box.x : style.align === 'right' ? box.x + box.w : box.x + box.w / 2;
  lines.forEach((line, i) => drawLine(ctx, line, x, startY + lineHeight * (i + 0.5), style, sizePx));
  return total;
}

// ---------------------------------------------------------------------------
// Columnas
// ---------------------------------------------------------------------------

export interface ColumnBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedLine {
  text: string;
  /** Esquina superior izquierda de la caja de la línea. */
  x: number;
  y: number;
  /** Anchura de la columna (para alinear). */
  w: number;
  column: number;
}

export interface ColumnLayout {
  lines: PlacedLine[];
  /** True si se quedó texto fuera (la última línea lleva puntos suspensivos). */
  overflow: boolean;
  /** True si alguna palabra hubo que partirla (en texto largo no obliga a encoger). */
  broken: boolean;
}

function finishOverflow(lines: PlacedLine[], measure: Measure, flags: WrapFlags): ColumnLayout {
  const last = lines[lines.length - 1];
  if (last) {
    const arr = [last.text];
    addEllipsis(arr, measure, last.w);
    last.text = arr[0] ?? last.text;
  }
  return { lines, overflow: true, broken: flags.broken };
}

/**
 * Reparte párrafos por columnas en orden (cada columna de arriba abajo, con
 * su propia anchura y altura). Entre párrafos deja `paragraphGap`, salvo al
 * principio de una columna. Las líneas en blanco cuentan como un solo
 * cambio de párrafo.
 */
export function layoutColumns(
  text: string,
  measure: Measure,
  columns: ColumnBox[],
  lineHeight: number,
  paragraphGap = lineHeight * 0.6,
): ColumnLayout {
  const cols = columns.filter((c) => c.w > 0 && c.h >= lineHeight);
  const lines: PlacedLine[] = [];
  const flags: WrapFlags = { broken: false };
  let col = 0;
  let y = cols[0]?.y ?? 0;
  let gapPending = false;
  for (const paragraph of paragraphsOf(text)) {
    const queue = splitWords(paragraph);
    if (queue.length === 0) continue;
    while (queue.length > 0) {
      const c = cols[col];
      if (!c) return finishOverflow(lines, measure, flags);
      if (gapPending && y > c.y) y += paragraphGap;
      gapPending = false;
      if (y + lineHeight > c.y + c.h + 1e-6) {
        col++;
        y = cols[col]?.y ?? 0;
        continue;
      }
      lines.push({ text: takeLine(queue, measure, c.w, flags), x: c.x, y, w: c.w, column: col });
      y += lineHeight;
    }
    gapPending = true;
  }
  return { lines, overflow: false, broken: flags.broken };
}

export interface ColumnFitOptions {
  startPx: number;
  minPx: number;
  /** Interlineado como factor del tamaño (1,3 por defecto). */
  lineHeight?: number;
  /** Separación entre párrafos como factor del interlineado (0,6 por defecto). */
  paragraphGap?: number;
  step?: number;
}

export interface FittedColumns {
  sizePx: number;
  lineHeight: number;
  layout: ColumnLayout;
}

/** Encoge el tamaño hasta que el texto cabe en las columnas (o hasta `minPx`, con puntos suspensivos). */
export function fitColumns(text: string, measureAt: MeasureAt, columns: ColumnBox[], opts: ColumnFitOptions): FittedColumns {
  const factor = opts.lineHeight ?? 1.3;
  const gap = opts.paragraphGap ?? 0.6;
  const attempt = (sizePx: number): FittedColumns => {
    const lineHeight = sizePx * factor;
    return { sizePx, lineHeight, layout: layoutColumns(text, measureAt(sizePx), columns, lineHeight, lineHeight * gap) };
  };
  let size = Math.max(opts.minPx, opts.startPx);
  let result = attempt(size);
  while (result.layout.overflow && size > opts.minPx) {
    size = Math.max(opts.minPx, size * (opts.step ?? 0.92));
    result = attempt(size);
  }
  return result;
}

/** Rectángulo que envuelve todas las líneas colocadas, o null si no hay ninguna. */
export function layoutBounds(layout: ColumnLayout, lineHeight: number): ColumnBox | null {
  if (layout.lines.length === 0) return null;
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const line of layout.lines) {
    x0 = Math.min(x0, line.x);
    y0 = Math.min(y0, line.y);
    x1 = Math.max(x1, line.x + line.w);
    y1 = Math.max(y1, line.y + lineHeight);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Dibuja las líneas de un reparto en columnas con la alineación del estilo dentro de cada columna. */
export function drawColumnLayout(
  ctx: CanvasRenderingContext2D,
  layout: ColumnLayout,
  style: TextStyle,
  sizePx: number,
  lineHeight: number,
): void {
  for (const line of layout.lines) {
    const x = style.align === 'left' ? line.x : style.align === 'right' ? line.x + line.w : line.x + line.w / 2;
    drawLine(ctx, line.text, x, line.y + lineHeight / 2, style, sizePx);
  }
}

// ---------------------------------------------------------------------------
// Varios
// ---------------------------------------------------------------------------

/** Duración en segundos como m:ss (las horas se acumulan en los minutos). */
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(sec) ? sec : 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
