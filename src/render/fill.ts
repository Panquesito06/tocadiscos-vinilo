/**
 * Rellenos, colores y superficies para el dibujo del embalaje (carpeta,
 * lomo y fundas).
 *
 *  - `paintFill` pinta un `Fill` de `core/types` sobre un rectángulo: color
 *    plano, degradado lineal (ángulo con la convención de CSS: 0° arriba,
 *    90° derecha) o radial, e imagen `cover` / `contain` sobre su
 *    `backdrop`. Una imagen aún no cargada deja solo el fondo: la caché de
 *    render se vacía cuando la imagen llega y se vuelve a dibujar.
 *  - Colores: análisis de cadenas CSS, luminancia relativa y contraste, para
 *    decidir si un texto necesita una banda translúcida detrás.
 *  - Azar determinista (mulberry32 sembrado con un texto) y texturas
 *    baratas: grano de papel por patrón repetido, reflejo diagonal, sombra
 *    interior en los bordes y desgaste de esquinas.
 *
 * El módulo del disco tiene sus propias utilidades (`draw-utils.ts`); este
 * archivo no las importa para que ambos módulos evolucionen por separado.
 */
import type { Fill } from '../core/types';
import type { ImageCache } from './images';

// ---------------------------------------------------------------------------
// Geometría y canvas
// ---------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h };
}

/** Rectángulo encogido `dx` por cada lado horizontal y `dy` por cada lado vertical. */
export function insetRect(box: Rect, dx: number, dy = dx): Rect {
  return { x: box.x + dx, y: box.y + dy, w: Math.max(0, box.w - 2 * dx), h: Math.max(0, box.h - 2 * dy) };
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export interface CanvasAndContext {
  canvas: HTMLCanvasElement;
  /** Null cuando el entorno no rasteriza (tests con happy-dom). */
  ctx: CanvasRenderingContext2D | null;
}

/** Canvas del tamaño pedido (redondeado a píxeles enteros, mínimo 1) y su contexto 2D si existe. */
export function createCanvas(width: number, height: number): CanvasAndContext {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  return { canvas, ctx };
}

/** Camino de un rectángulo con esquinas redondeadas (sin depender de `roundRect`). */
export function roundedRectPath(ctx: CanvasRenderingContext2D, box: Rect, radius: number): void {
  const r = Math.max(0, Math.min(radius, box.w / 2, box.h / 2));
  const { x, y, w, h } = box;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Colores
// ---------------------------------------------------------------------------

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  orange: '#ffa500',
  purple: '#800080',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  navy: '#000080',
  teal: '#008080',
  maroon: '#800000',
  olive: '#808000',
  lime: '#00ff00',
  aqua: '#00ffff',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  fuchsia: '#ff00ff',
  beige: '#f5f5dc',
  ivory: '#fffff0',
  gold: '#ffd700',
  tan: '#d2b48c',
  transparent: '#00000000',
};

function parseHex(hex: string): Rgba | null {
  const h = hex.slice(1);
  if (!/^[0-9a-f]+$/.test(h)) return null;
  const pair = (i: number): number => parseInt(h.slice(i, i + 2), 16);
  const single = (i: number): number => parseInt(h[i]! + h[i]!, 16);
  if (h.length === 3) return { r: single(0), g: single(1), b: single(2), a: 1 };
  if (h.length === 4) return { r: single(0), g: single(1), b: single(2), a: single(3) / 255 };
  if (h.length === 6) return { r: pair(0), g: pair(2), b: pair(4), a: 1 };
  if (h.length === 8) return { r: pair(0), g: pair(2), b: pair(4), a: pair(6) / 255 };
  return null;
}

function parseNumber(token: string, unit: string): number | null {
  const t = token.endsWith(unit) && unit ? token.slice(0, -unit.length) : token;
  if (t === 'none') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseAlpha(token: string | undefined): number | null {
  if (token === undefined) return 1;
  if (token.endsWith('%')) {
    const n = parseNumber(token, '%');
    return n === null ? null : clamp(n / 100, 0, 1);
  }
  const n = parseNumber(token, '');
  return n === null ? null : clamp(n, 0, 1);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 60;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (hue < 1) rgb = [c, x, 0];
  else if (hue < 2) rgb = [x, c, 0];
  else if (hue < 3) rgb = [0, c, x];
  else if (hue < 4) rgb = [0, x, c];
  else if (hue < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return [Math.round((rgb[0] + m) * 255), Math.round((rgb[1] + m) * 255), Math.round((rgb[2] + m) * 255)];
}

function parseFunctional(fn: string, body: string): Rgba | null {
  const parts = body
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter((p) => p.length > 0);
  if (parts.length < 3 || parts.length > 4) return null;
  const a = parseAlpha(parts[3]);
  if (a === null) return null;
  if (fn.startsWith('hsl')) {
    const h = parseNumber(parts[0]!.replace(/deg$/, ''), '');
    const s = parseNumber(parts[1]!, '%');
    const l = parseNumber(parts[2]!, '%');
    if (h === null || s === null || l === null) return null;
    const [r, g, b] = hslToRgb(h, clamp(s / 100, 0, 1), clamp(l / 100, 0, 1));
    return { r, g, b, a };
  }
  const channel = (token: string): number | null => {
    if (token.endsWith('%')) {
      const n = parseNumber(token, '%');
      return n === null ? null : clamp(Math.round(n * 2.55), 0, 255);
    }
    const n = parseNumber(token, '');
    return n === null ? null : clamp(Math.round(n), 0, 255);
  };
  const r = channel(parts[0]!);
  const g = channel(parts[1]!);
  const b = channel(parts[2]!);
  if (r === null || g === null || b === null) return null;
  return { r, g, b, a };
}

/**
 * Analiza un color CSS: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`,
 * `rgba()`, `hsl()`, `hsla()` y los nombres más comunes. Devuelve null si no
 * lo entiende (el canvas sí puede aceptarlo; el llamador decide qué hacer).
 */
export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const named = NAMED_COLORS[s];
  if (named) return parseHex(named);
  if (s.startsWith('#')) return parseHex(s);
  const m = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s);
  if (!m) return null;
  return parseFunctional(m[1]!, m[2]!);
}

/** Luminancia relativa (WCAG) de un color opaco, 0 = negro, 1 = blanco. */
export function relativeLuminance(c: Rgba): number {
  const lin = (v: number): number => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** Relación de contraste WCAG entre dos colores (1 … 21). */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Luminancia de un color CSS, o null si no se pudo analizar. */
export function luminanceOf(color: string): number | null {
  const c = parseColor(color);
  return c ? relativeLuminance(c) : null;
}

/** True si el color es oscuro (luminancia < 0,35). Si no se entiende, `fallback`. */
export function isDarkColor(color: string, fallback = false): boolean {
  const l = luminanceOf(color);
  return l === null ? fallback : l < 0.35;
}

/** El mismo color con otra opacidad. Si no se entiende, se devuelve tal cual. */
export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color);
  if (!c) return color;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${clamp(alpha, 0, 1)})`;
}

/** Mezcla lineal de dos colores (`t` = 0 → `a`, 1 → `b`). Si alguno no se entiende, devuelve `a`. */
export function mixColors(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return a;
  const k = clamp(t, 0, 1);
  const ch = (x: number, y: number): number => Math.round(x + (y - x) * k);
  return `rgba(${ch(ca.r, cb.r)}, ${ch(ca.g, cb.g)}, ${ch(ca.b, cb.b)}, ${ca.a + (cb.a - ca.a) * k})`;
}

/** Color representativo de un relleno: el color plano, la mezcla del degradado o el fondo de la imagen. */
export function fillBaseColor(fill: Fill | null | undefined, fallback: string): string {
  if (!fill) return fallback;
  if (fill.kind === 'solid') return fill.color;
  if (fill.kind === 'gradient') return mixColors(fill.from, fill.to, 0.5);
  return fill.backdrop;
}

/**
 * True si el texto se parece demasiado al fondo (contraste menor que
 * `minContrast`). Si alguno de los dos colores no se entiende, false.
 */
export function textNeedsBacking(textColor: string, background: string, minContrast = 2.5): boolean {
  const t = parseColor(textColor);
  const b = parseColor(background);
  if (!t || !b) return false;
  return contrastRatio(t, b) < minContrast;
}

/**
 * Asigna un color de relleno al contexto de forma segura: si el canvas no
 * entiende `color`, queda `fallback` (una asignación inválida no cambia
 * `fillStyle`, así que primero se pone el alternativo).
 */
export function setFillColor(ctx: CanvasRenderingContext2D, color: string, fallback = '#808080'): void {
  ctx.fillStyle = fallback;
  ctx.fillStyle = color;
}

export function setStrokeColor(ctx: CanvasRenderingContext2D, color: string, fallback = '#808080'): void {
  ctx.strokeStyle = fallback;
  ctx.strokeStyle = color;
}

/** `addColorStop` lanza con un color inválido; aquí se sustituye por un gris neutro. */
function safeColorStop(gradient: CanvasGradient, offset: number, color: string): void {
  try {
    gradient.addColorStop(offset, color);
  } catch {
    gradient.addColorStop(offset, '#808080');
  }
}

// ---------------------------------------------------------------------------
// Rellenos
// ---------------------------------------------------------------------------

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

/** Degradado lineal que cruza `box` con la convención de ángulos de CSS (0° arriba, 90° derecha). */
export function linearGradientAlong(ctx: CanvasRenderingContext2D, box: Rect, angleDeg: number): CanvasGradient {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const len = Math.abs(box.w * dx) + Math.abs(box.h * dy);
  return ctx.createLinearGradient(cx - (dx * len) / 2, cy - (dy * len) / 2, cx + (dx * len) / 2, cy + (dy * len) / 2);
}

/** Degradado de un `Fill` de tipo `gradient`: lineal por `angleDeg` o radial desde el centro hasta las esquinas. */
export function gradientFor(
  ctx: CanvasRenderingContext2D,
  fill: Extract<Fill, { kind: 'gradient' }>,
  box: Rect,
): CanvasGradient {
  let g: CanvasGradient;
  if (fill.radial) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(box.w, box.h) / 2);
  } else {
    g = linearGradientAlong(ctx, box, fill.angleDeg);
  }
  safeColorStop(g, 0, fill.from);
  safeColorStop(g, 1, fill.to);
  return g;
}

/**
 * Pinta un `Fill` sobre `box`. El dibujo de la imagen se recorta al
 * rectángulo (con `cover` sobresaldría). Una imagen aún no cargada deja solo
 * su color de fondo.
 */
export function paintFill(ctx: CanvasRenderingContext2D, fill: Fill, box: Rect, images: ImageCache): void {
  if (fill.kind === 'solid') {
    setFillColor(ctx, fill.color);
    ctx.fillRect(box.x, box.y, box.w, box.h);
    return;
  }
  if (fill.kind === 'gradient') {
    ctx.fillStyle = gradientFor(ctx, fill, box);
    ctx.fillRect(box.x, box.y, box.w, box.h);
    return;
  }
  setFillColor(ctx, fill.backdrop);
  ctx.fillRect(box.x, box.y, box.w, box.h);
  const img = images.get(fill.image);
  if (!img) return;
  const r = fitRect(img.naturalWidth, img.naturalHeight, box, fill.fit);
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, r.x, r.y, r.w, r.h);
  ctx.restore();
}

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

/** PRNG sembrado con el hash de un texto (p. ej. `id + '|' + parte`). */
export function createRng(seedText: string): Rng {
  return mulberry32(hashString(seedText));
}

/** Entero en [0, n). */
export function randInt(rng: Rng, n: number): number {
  return Math.min(n - 1, Math.floor(rng() * n));
}

export function randBetween(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

// ---------------------------------------------------------------------------
// Tokens CSS
// ---------------------------------------------------------------------------

const tokenCache = new Map<string, string>();

/**
 * Valor de un token CSS (`--kraft`) leído de `:root`, con valor alternativo
 * si no está definido (tests o canvas sin documento).
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
// Superficies
// ---------------------------------------------------------------------------

const GRAIN_TILE_PX = 96;
const grainTiles = new Map<string, HTMLCanvasElement | null>();

/**
 * Baldosa de grano: puntos claros y oscuros dispersos con alfa variable.
 * Se genera una vez por semilla y se repite como patrón, así el grano es
 * determinista y cuesta lo mismo en un canvas grande que en uno pequeño.
 */
function grainTile(seed: string): HTMLCanvasElement | null {
  const cached = grainTiles.get(seed);
  if (cached !== undefined) return cached;
  if (grainTiles.size > 24) grainTiles.clear();
  const { canvas, ctx } = createCanvas(GRAIN_TILE_PX, GRAIN_TILE_PX);
  if (!ctx) {
    grainTiles.set(seed, null);
    return null;
  }
  const rng = createRng(seed);
  const image = ctx.createImageData(GRAIN_TILE_PX, GRAIN_TILE_PX);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = rng();
    const light = n > 0.5;
    const strength = (Math.abs(n - 0.5) * 2) ** 2.2;
    data[i] = light ? 255 : 0;
    data[i + 1] = light ? 255 : 0;
    data[i + 2] = light ? 255 : 0;
    data[i + 3] = Math.round(strength * 255);
  }
  ctx.putImageData(image, 0, 0);
  grainTiles.set(seed, canvas);
  return canvas;
}

/** Grano fino determinista sobre `box`, con la opacidad global `alpha`. */
export function paintGrain(ctx: CanvasRenderingContext2D, box: Rect, seed: string, alpha: number): void {
  const tile = grainTile(seed);
  if (!tile) return;
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return;
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.fillStyle = pattern;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.restore();
}

/**
 * Reflejo diagonal blanco (de arriba-izquierda a abajo-derecha) centrado en
 * la fracción `center` del recorrido y de anchura `width` (fracciones del
 * recorrido). `alpha` es la opacidad máxima del centro.
 */
export function paintSheen(ctx: CanvasRenderingContext2D, box: Rect, alpha: number, center = 0.42, width = 0.26): void {
  const g = linearGradientAlong(ctx, box, 135);
  const a = clamp(alpha, 0, 1);
  const half = width / 2;
  const stop = (offset: number, k: number): void => safeColorStop(g, clamp(offset, 0, 1), `rgba(255, 255, 255, ${a * k})`);
  stop(0, 0);
  stop(center - half, 0);
  stop(center - half * 0.45, 0.55);
  stop(center, 1);
  stop(center + half * 0.4, 0.35);
  stop(center + half, 0);
  stop(1, 0);
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.restore();
}

/** Sombra interior suave en los cuatro bordes (canto de cartón o papel). */
export function paintEdgeShadow(ctx: CanvasRenderingContext2D, box: Rect, sizePx: number, alpha: number): void {
  const s = Math.max(1, sizePx);
  const a = clamp(alpha, 0, 1);
  const edges: [number, number, number, number][] = [
    [box.x, box.y, box.x, box.y + s],
    [box.x, box.y + box.h, box.x, box.y + box.h - s],
    [box.x, box.y, box.x + s, box.y],
    [box.x + box.w, box.y, box.x + box.w - s, box.y],
  ];
  ctx.save();
  for (const [x0, y0, x1, y1] of edges) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `rgba(0, 0, 0, ${a})`);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(box.x, box.y, box.w, box.h);
  }
  ctx.restore();
}

/** Desgaste muy leve de las esquinas: manchas claras y difusas, distintas en cada esquina. */
export function paintCornerWear(ctx: CanvasRenderingContext2D, box: Rect, seed: string, amount: number): void {
  const rng = createRng(seed);
  const base = Math.min(box.w, box.h);
  const corners = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x, box.y + box.h],
    [box.x + box.w, box.y + box.h],
  ];
  ctx.save();
  for (const [cx, cy] of corners) {
    const r = base * randBetween(rng, 0.035, 0.07);
    const a = clamp(amount * randBetween(rng, 0.5, 1.2), 0, 1);
    const g = ctx.createRadialGradient(cx!, cy!, 0, cx!, cy!, r);
    g.addColorStop(0, `rgba(255, 255, 255, ${a})`);
    g.addColorStop(0.55, `rgba(255, 255, 255, ${a * 0.35})`);
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx! - r, cy! - r, r * 2, r * 2);
  }
  ctx.restore();
}

/**
 * Banda translúcida detrás de un bloque de texto: clara si el texto es
 * oscuro, oscura si el texto es claro. No cambia el color del texto.
 */
export function paintBackingBand(ctx: CanvasRenderingContext2D, box: Rect, textColor: string, padding: number, radius: number): void {
  const dark = isDarkColor(textColor, true);
  ctx.save();
  ctx.fillStyle = dark ? 'rgba(255, 255, 255, 0.62)' : 'rgba(0, 0, 0, 0.5)';
  roundedRectPath(ctx, insetRect(box, -padding), radius);
  ctx.fill();
  ctx.restore();
}
