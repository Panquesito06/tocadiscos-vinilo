/**
 * Utilidades de dibujo del módulo de render del disco.
 *
 *  - PRNG con semilla (mulberry32) y ruido suave, para que splatter, mármol,
 *    polvo y surcos sean deterministas entre redibujados.
 *  - Rellenos (`Fill` de `core/types`) sobre un rectángulo de canvas:
 *    color plano, degradado lineal (ángulo con la convención de CSS) o
 *    radial, e imagen `cover` / `contain` con color de fondo.
 *  - Texto con `TextStyle`: una sola familia (Archivo variable) con
 *    contraste de anchura. Si el contexto admite `fontStretch` y la fuente
 *    cargada tiene eje de anchura, se usa la anchura nativa; si no, se emula
 *    con una escala horizontal. Texto recto y texto sobre un arco.
 *  - Ajuste de texto en líneas de anchura variable (las cuerdas de un
 *    círculo), reducción de tamaño hasta que quepa y tokens CSS.
 */
import type { Fill, FontWidth, TextStyle } from '../core/types';
import type { ImageCache } from './images';

// ---------------------------------------------------------------------------
// Azar determinista
// ---------------------------------------------------------------------------

/** Generador de números pseudoaleatorios en [0, 1). */
export type Rng = () => number;

/** Hash FNV-1a de 32 bits (sin signo) de una cadena. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** PRNG mulberry32: rápido, pequeño y suficiente para texturas. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** PRNG sembrado con el hash de un texto (p. ej. `id + '|' + cara`). */
export function createRng(seedText: string): Rng {
  return mulberry32(hashString(seedText));
}

export function randBetween(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

/** Entero en [0, n). */
export function randInt(rng: Rng, n: number): number {
  return Math.min(n - 1, Math.floor(rng() * n));
}

/**
 * Ruido de valor unidimensional en [0, 1]: puntos de control aleatorios
 * cada `period` muestras interpolados con coseno. Sirve para que una
 * propiedad (el brillo de cada surco) varíe suavemente sin saltos.
 */
export function smoothNoise(rng: Rng, length: number, period: number): Float32Array {
  const out = new Float32Array(Math.max(0, length));
  const p = Math.max(1, period);
  const controls = new Float32Array(Math.ceil(length / p) + 2);
  for (let i = 0; i < controls.length; i++) controls[i] = rng();
  for (let i = 0; i < out.length; i++) {
    const pos = i / p;
    const k = Math.floor(pos);
    const t = pos - k;
    const smooth = (1 - Math.cos(t * Math.PI)) / 2;
    const a = controls[k] ?? 0;
    const b = controls[k + 1] ?? a;
    out[i] = a + (b - a) * smooth;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Geometría auxiliar
// ---------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Semianchura de la cuerda de un círculo de radio `radius` a la altura `y` (0 fuera del círculo). */
export function chordHalfWidth(radius: number, y: number): number {
  const d = radius * radius - y * y;
  return d > 0 ? Math.sqrt(d) : 0;
}

/** Rectángulo en el que encaja una imagen de `srcW × srcH` dentro de `box` con `cover` o `contain`. */
export function fitRect(srcW: number, srcH: number, box: Rect, fit: 'cover' | 'contain'): Rect {
  if (srcW <= 0 || srcH <= 0) return { ...box };
  const scaleX = box.w / srcW;
  const scaleY = box.h / srcH;
  const scale = fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

export function circlePath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0, r), 0, Math.PI * 2);
}

/** Camino de una corona circular (anillo) entre `rInner` y `rOuter`, listo para `fill` o `clip`. */
export function annulusPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, rInner: number, rOuter: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0, rOuter), 0, Math.PI * 2, false);
  ctx.arc(cx, cy, Math.max(0, rInner), 0, Math.PI * 2, true);
}

/** Sector de corona circular entre dos radios y dos ángulos (radianes). */
export function annularSectorPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  a0: number,
  a1: number,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0, rOuter), a0, a1, false);
  ctx.arc(cx, cy, Math.max(0, rInner), a1, a0, true);
  ctx.closePath();
}

/** Estrella de `points` puntas centrada en (cx, cy). */
export function starPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  rotation = -Math.PI / 2,
  points = 5,
): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = rotation + (i * Math.PI) / points;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Mancha irregular (gota de salpicadura) de radio medio `r`, suavizada con curvas. */
export function blobPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rng: Rng): void {
  const n = 7 + randInt(rng, 4);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * randBetween(rng, 0.6, 1.35);
    pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
  }
  ctx.beginPath();
  const last = pts[n - 1]!;
  const first = pts[0]!;
  ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % n]!;
    ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
  }
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Tokens CSS
// ---------------------------------------------------------------------------

const tokenCache = new Map<string, string>();

/**
 * Valor de un token CSS (`--aluminio`) leído de `:root`, con valor
 * alternativo si no está definido (tests o canvas sin documento).
 */
export function cssToken(name: string, fallback: string): string {
  const cached = tokenCache.get(name);
  if (cached !== undefined) return cached;
  let value = '';
  try {
    if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
      value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }
  } catch {
    value = '';
  }
  const result = value || fallback;
  tokenCache.set(name, result);
  return result;
}

// ---------------------------------------------------------------------------
// Rellenos
// ---------------------------------------------------------------------------

/** Degradado de un `Fill` de tipo `gradient` sobre `box`, con la convención de ángulos de CSS (0° arriba, 90° derecha). */
export function gradientFor(
  ctx: CanvasRenderingContext2D,
  fill: Extract<Fill, { kind: 'gradient' }>,
  box: Rect,
): CanvasGradient {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  let g: CanvasGradient;
  if (fill.radial) {
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(box.w, box.h) / 2);
  } else {
    const a = (fill.angleDeg * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const len = Math.abs(box.w * dx) + Math.abs(box.h * dy);
    g = ctx.createLinearGradient(cx - (dx * len) / 2, cy - (dy * len) / 2, cx + (dx * len) / 2, cy + (dy * len) / 2);
  }
  g.addColorStop(0, fill.from);
  g.addColorStop(1, fill.to);
  return g;
}

/**
 * Pinta un `Fill` sobre `box`. El llamador recorta antes (círculo, anillo…).
 * Una imagen aún no cargada deja solo su color de fondo: la caché de render
 * se vacía cuando la imagen llega y se vuelve a dibujar.
 */
export function paintFill(ctx: CanvasRenderingContext2D, fill: Fill, box: Rect, images: ImageCache): void {
  if (fill.kind === 'solid') {
    ctx.fillStyle = fill.color;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    return;
  }
  if (fill.kind === 'gradient') {
    ctx.fillStyle = gradientFor(ctx, fill, box);
    ctx.fillRect(box.x, box.y, box.w, box.h);
    return;
  }
  ctx.fillStyle = fill.backdrop;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  const img = images.get(fill.image);
  if (!img) return;
  const r = fitRect(img.naturalWidth, img.naturalHeight, box, fill.fit);
  ctx.drawImage(img, r.x, r.y, r.w, r.h);
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

export const FONT_FAMILY = "'Archivo Variable', 'Archivo', system-ui, sans-serif";

/** Palabra clave de `font-stretch` por anchura. */
const STRETCH_KEYWORD: Record<FontWidth, CanvasFontStretch> = {
  condensed: 'condensed',
  normal: 'normal',
  expanded: 'expanded',
};

/** Escala horizontal que emula cada anchura cuando la fuente no tiene eje de anchura. */
export const WIDTH_SCALE: Record<FontWidth, number> = { condensed: 0.8, normal: 1, expanded: 1.2 };

const PROBE_TEXT = 'MMMMMMMMMM';

/** `fontStretch` está tipado en lib.dom pero no existe en todos los navegadores: se comprueba en tiempo de ejecución. */
type StretchContext = CanvasRenderingContext2D & { fontStretch?: CanvasFontStretch };

/** Resultado del sondeo de anchura nativa por contexto (la fuente no cambia durante un dibujo). */
const stretchProbeCache = new WeakMap<CanvasRenderingContext2D, Map<FontWidth, boolean>>();

export function fontString(weight: number, sizePx: number): string {
  const w = Math.round(clamp(weight, 100, 900));
  return `${w} ${Math.max(1, sizePx)}px ${FONT_FAMILY}`;
}

/** Aplica la transformación de mayúsculas del estilo. */
export function textCase(text: string, style: Pick<TextStyle, 'uppercase'>): string {
  return style.uppercase ? text.toLocaleUpperCase('es') : text;
}

/** ¿Responde la fuente actual a `fontStretch`? (Una fuente sin eje `wdth` mide igual con cualquier anchura.) */
function fontRespondsToStretch(ctx: StretchContext, width: FontWidth): boolean {
  let perWidth = stretchProbeCache.get(ctx);
  if (!perWidth) {
    perWidth = new Map();
    stretchProbeCache.set(ctx, perWidth);
  }
  const known = perWidth.get(width);
  if (known !== undefined) return known;
  ctx.fontStretch = 'normal';
  const base = ctx.measureText(PROBE_TEXT).width;
  ctx.fontStretch = STRETCH_KEYWORD[width];
  const stretched = ctx.measureText(PROBE_TEXT).width;
  const responds = Math.abs(stretched - base) > base * 0.01;
  perWidth.set(width, responds);
  return responds;
}

/**
 * Intenta la anchura nativa. Devuelve true solo si el contexto admite
 * `fontStretch` Y la fuente responde; si no, deja la anchura normal para
 * que el llamador la emule con una escala horizontal.
 */
function applyNativeStretch(ctx: StretchContext, width: FontWidth): boolean {
  if (typeof ctx.fontStretch !== 'string') return false;
  if (width === 'normal' || !fontRespondsToStretch(ctx, width)) {
    ctx.fontStretch = 'normal';
    return width === 'normal';
  }
  ctx.fontStretch = STRETCH_KEYWORD[width];
  return true;
}

/**
 * Configura fuente, anchura y color del contexto para un `TextStyle` y
 * devuelve la escala horizontal que el llamador debe aplicar al dibujar
 * (1 cuando la anchura es nativa).
 */
export function applyTextStyle(ctx: CanvasRenderingContext2D, style: TextStyle, sizePx: number): number {
  ctx.font = fontString(style.weight, sizePx);
  ctx.fillStyle = style.color;
  return applyNativeStretch(ctx as StretchContext, style.width) ? 1 : WIDTH_SCALE[style.width];
}

/** Anchura en píxeles de `text` (ya transformado) con el estilo y tamaño dados. */
export function measureTextWidth(ctx: CanvasRenderingContext2D, text: string, style: TextStyle, sizePx: number): number {
  const sx = applyTextStyle(ctx, style, sizePx);
  return ctx.measureText(text).width * sx;
}

export interface DrawTextOptions {
  /** Alineación; por defecto la del estilo. */
  align?: TextStyle['align'];
  baseline?: CanvasTextBaseline;
  /** Si se indica, el texto se traza (grosor en px) en vez de rellenarse. */
  strokeWidth?: number;
  /** Rotación en radianes alrededor de (x, y). */
  rotation?: number;
}

/**
 * Dibuja una línea de texto en (x, y) con el estilo (aplica `uppercase`).
 * La anchura emulada se consigue escalando horizontalmente alrededor del
 * punto de anclaje, así la alineación sigue siendo correcta.
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  style: TextStyle,
  sizePx: number,
  opts: DrawTextOptions = {},
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
  if (opts.strokeWidth !== undefined) {
    ctx.strokeStyle = style.color;
    ctx.lineWidth = opts.strokeWidth / sx;
    ctx.lineJoin = 'round';
    ctx.strokeText(t, 0, 0);
  } else {
    ctx.fillText(t, 0, 0);
  }
  ctx.restore();
}

export interface ArcTextOptions {
  /** Desplazamiento por glifo (radio en px, ángulo en radianes) para un trazo irregular. */
  jitter?: (index: number) => { dr: number; da: number };
  /** Texto leído por dentro del arco (parte baja del círculo), derecho para el lector. */
  inside?: boolean;
  strokeWidth?: number;
}

/**
 * Dibuja `text` glifo a glifo sobre un arco de radio `radius` centrado en
 * `centerAngle` (radianes; −π/2 es arriba). Devuelve el ángulo total ocupado.
 */
export function drawTextOnArc(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  radius: number,
  centerAngle: number,
  style: TextStyle,
  sizePx: number,
  opts: ArcTextOptions = {},
): number {
  const t = textCase(text, style);
  if (!t || radius <= 0) return 0;
  const glyphs = Array.from(t);
  const sx = applyTextStyle(ctx, style, sizePx);
  const widths = glyphs.map((g) => ctx.measureText(g).width * sx);
  const total = widths.reduce((a, b) => a + b, 0) / radius;
  const dir = opts.inside ? -1 : 1;
  let consumed = 0;
  glyphs.forEach((g, i) => {
    const w = widths[i] ?? 0;
    const j = opts.jitter ? opts.jitter(i) : { dr: 0, da: 0 };
    const a = centerAngle + dir * (consumed + w / 2 - (total * radius) / 2) / radius + j.da;
    const r = radius + j.dr;
    const rotation = a + (opts.inside ? -Math.PI / 2 : Math.PI / 2);
    drawText(ctx, g, cx + Math.cos(a) * r, cy + Math.sin(a) * r, style, sizePx, {
      align: 'center',
      baseline: 'middle',
      rotation,
      strokeWidth: opts.strokeWidth,
    });
    consumed += w;
  });
  return total;
}

// ---------------------------------------------------------------------------
// Ajuste de texto
// ---------------------------------------------------------------------------

/** Medidor de anchura (px) de una cadena ya transformada. */
export type Measure = (text: string) => number;

/** Rompe una palabra demasiado larga en trozos que quepan en `width`. */
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

export interface WrappedText {
  lines: string[];
  /** True si se quedó texto fuera (por `maxLines` o por falta de anchura). */
  truncated: boolean;
}

/**
 * Ajusta `text` en líneas cuya anchura disponible puede cambiar en cada
 * línea (`widthForLine(i)`), como las cuerdas de un círculo. Respeta los
 * saltos de línea explícitos, parte las palabras que no caben solas y, si
 * se supera `maxLines`, corta y añade puntos suspensivos si caben.
 * Una anchura ≤ 0 termina el ajuste (no hay más sitio).
 */
export function wrapTextDetailed(
  text: string,
  measure: Measure,
  widthForLine: (lineIndex: number) => number,
  maxLines = Number.POSITIVE_INFINITY,
): WrappedText {
  const lines: string[] = [];
  const paragraphs = text.split(/\r?\n/).map((p) => p.split(/\s+/).filter((w) => w.length > 0));
  let truncated = false;

  /** Cierra la línea actual; devuelve la anchura de la siguiente o −1 si ya no hay sitio. */
  const commit = (line: string): number => {
    lines.push(line);
    if (lines.length >= maxLines) return -1;
    const next = widthForLine(lines.length);
    return next > 0 ? next : -1;
  };

  outer: for (let pi = 0; pi < paragraphs.length; pi++) {
    const words = paragraphs[pi]!;
    if (words.length === 0) continue;
    let width = lines.length >= maxLines ? -1 : widthForLine(lines.length);
    if (width <= 0) {
      truncated = true;
      break;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= width) {
        line = candidate;
        continue;
      }
      if (line) {
        width = commit(line);
        line = '';
        if (width < 0) {
          truncated = true;
          break outer;
        }
      }
      if (measure(word) <= width) {
        line = word;
        continue;
      }
      const pieces = breakWord(word, measure, width);
      for (let k = 0; k < pieces.length - 1; k++) {
        width = commit(pieces[k]!);
        if (width < 0) {
          truncated = true;
          break outer;
        }
      }
      line = pieces[pieces.length - 1] ?? '';
    }
    if (line) {
      const remaining = paragraphs.slice(pi + 1).some((p) => p.length > 0);
      width = commit(line);
      if (width < 0 && remaining) {
        truncated = true;
        break;
      }
    }
  }

  if (truncated && lines.length > 0) {
    const i = lines.length - 1;
    const width = widthForLine(i);
    const last = lines[i]!;
    if (measure(`${last}…`) <= width) lines[i] = `${last}…`;
    else if (last.length > 1 && measure(`${last.slice(0, -1)}…`) <= width) lines[i] = `${last.slice(0, -1)}…`;
  }
  return { lines, truncated };
}

/** Como `wrapTextDetailed`, devolviendo solo las líneas. */
export function wrapText(
  text: string,
  measure: Measure,
  widthForLine: (lineIndex: number) => number,
  maxLines = Number.POSITIVE_INFINITY,
): string[] {
  return wrapTextDetailed(text, measure, widthForLine, maxLines).lines;
}

/**
 * Reduce un tamaño desde `startPx` multiplicando por `step` hasta que
 * `fits(size)` sea cierto o se alcance `minPx`. Devuelve el tamaño final
 * (como mínimo `minPx`, quepa o no).
 */
export function shrinkToFit(startPx: number, minPx: number, fits: (sizePx: number) => boolean, step = 0.92): number {
  let size = Math.max(minPx, startPx);
  while (size > minPx && !fits(size)) {
    size = Math.max(minPx, size * step);
  }
  return size;
}

/** Duración en segundos como m:ss (las horas se acumulan en los minutos). */
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
