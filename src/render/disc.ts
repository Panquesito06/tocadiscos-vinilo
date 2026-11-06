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
import { sideOf } from '../core/defaults';
import {
  ADAPTER_DIAMETER_MM,
  discGeometry,
  grooveDensity,
  holeDiameterMm,
  maxRingWidthMm,
  programSpanMm,
  trackBands,
  type DiscGeometry,
} from '../core/geometry';
import type { Disc, LabelSpec, Rpm, Side, SideId, TextStyle, Track, Vinyl } from '../core/types';
import {
  annularSectorPath,
  annulusPath,
  blobPath,
  chordHalfWidth,
  circlePath,
  clamp,
  createRng,
  cssToken,
  drawText,
  drawTextOnArc,
  fitRect,
  formatDuration,
  measureTextWidth,
  paintFill,
  randBetween,
  randInt,
  shrinkToFit,
  smoothNoise,
  starPath,
  textCase,
  wrapTextDetailed,
  type Rect,
  type Rng,
} from './draw-utils';
import type { ImageCache } from './images';

export interface DiscRenderOptions {
  sizePx: number;
  side: SideId;
  showDust: boolean;
  adapter45: boolean;
  spindle: boolean;
  quality: 'low' | 'high';
}

/** Diámetro del eje del plato (algo menor que el agujero pequeño de 7,24 mm). */
export const SPINDLE_DIAMETER_MM = 7;

/** Tamaño mínimo de letra en píxeles de dispositivo: por debajo no se lee nada. */
export const MIN_FONT_PX = 5;

/** Todo lo que las funciones de dibujo necesitan de una cara. */
interface Scene {
  ctx: CanvasRenderingContext2D;
  size: number;
  /** Centro del canvas (px). */
  c: number;
  /** Píxeles por mm. */
  px: number;
  geo: DiscGeometry;
  disc: Disc;
  side: Side;
  opts: DiscRenderOptions;
  images: ImageCache;
  rng: Rng;
  full: boolean;
  decorative: boolean;
  /** Material oscuro: surcos, polvo y rayas se ven más claros que el fondo. */
  dark: boolean;
  low: boolean;
}

export function renderDiscFace(vinyl: Vinyl, opts: DiscRenderOptions, images: ImageCache): HTMLCanvasElement {
  const size = Math.max(1, Math.round(opts.sizePx));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const disc = vinyl.disc;
  const side = sideOf(vinyl, opts.side);
  const geo = discGeometry(disc.format);
  const s: Scene = {
    ctx,
    size,
    c: size / 2,
    px: size / (2 * geo.radiusMm),
    geo,
    disc,
    side,
    opts,
    images,
    rng: createRng(`${vinyl.id}|${opts.side}`),
    full: side.decoration === 'full',
    decorative: side.decorative,
    dark: disc.material === 'black',
    low: opts.quality === 'low',
  };

  drawMaterial(s);
  if (s.full) drawArtwork(s);
  if (!s.decorative && (!s.full || side.groovesOverArt)) {
    drawGrooves(s, s.full);
    if (s.full) drawRunoutEtching(s, geo.labelRadiusMm);
  }
  if (s.full) {
    if (side.rim.enabled) drawRim(s);
    if (side.label.holeRingColor) drawHoleRing(s, side.label.holeRingColor);
  } else {
    const freeFromMm = side.decoration === 'ring' ? drawRing(s) : geo.labelRadiusMm;
    if (!s.decorative) drawRunoutEtching(s, freeFromMm);
    drawLabel(s);
  }
  drawEdge(s);
  if (opts.showDust) drawDust(s);
  cutHole(s);
  if (opts.adapter45 && disc.hole === 'large') drawAdapter(s);
  if (opts.spindle) drawSpindle(s);
  return canvas;
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

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

function discBox(s: Scene): Rect {
  const R = s.geo.radiusMm * s.px;
  return { x: s.c - R, y: s.c - R, w: 2 * R, h: 2 * R };
}

function drawMaterial(s: Scene): void {
  const { ctx, c, disc, size } = s;
  const R = s.geo.radiusMm * s.px;
  ctx.save();
  circlePath(ctx, c, c, R);
  ctx.clip();
  if (disc.material === 'black') {
    const g = ctx.createRadialGradient(c, c, 0, c, c, R);
    g.addColorStop(0, cssToken('--vinilo', '#121212'));
    g.addColorStop(0.7, '#151515');
    g.addColorStop(1, '#272727');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  } else if (disc.material === 'clear') {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = disc.color;
    ctx.fillRect(0, 0, size, size);
    ctx.globalAlpha = 1;
    const sheen = ctx.createRadialGradient(c, c, R * 0.6, c, c, R);
    sheen.addColorStop(0, 'rgba(255,255,255,0)');
    sheen.addColorStop(1, 'rgba(255,255,255,0.14)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, size, size);
  } else {
    ctx.fillStyle = disc.color;
    ctx.fillRect(0, 0, size, size);
    if (disc.material === 'splatter') drawSplatter(s, R);
    if (disc.material === 'marble') drawMarble(s, R);
    const vignette = ctx.createRadialGradient(c, c, R * 0.8, c, c, R);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.restore();
}

/** Factor de cantidad según el área del formato (el 12" es la referencia) y la calidad. */
function amountFactor(s: Scene): number {
  const area = (s.geo.radiusMm / 151) ** 2;
  return area * (s.low ? 0.4 : 1);
}

function randomPointInDisc(s: Scene, R: number): { x: number; y: number } {
  const a = s.rng() * Math.PI * 2;
  const d = R * Math.sqrt(s.rng());
  return { x: s.c + Math.cos(a) * d, y: s.c + Math.sin(a) * d };
}

/** Salpicaduras de `color2`: manchas irregulares en tres escalas con gotas satélite. */
function drawSplatter(s: Scene, R: number): void {
  const { ctx, rng, disc, px } = s;
  const layers = [
    { count: 12, minMm: 3, maxMm: 7, alpha: 0.96 },
    { count: 55, minMm: 1, maxMm: 3, alpha: 0.92 },
    { count: 240, minMm: 0.25, maxMm: 1, alpha: 0.85 },
  ];
  const factor = amountFactor(s);
  ctx.fillStyle = disc.color2;
  for (const layer of layers) {
    const n = Math.round(layer.count * factor);
    for (let i = 0; i < n; i++) {
      const p = randomPointInDisc(s, R);
      const r = randBetween(rng, layer.minMm, layer.maxMm) * px;
      ctx.globalAlpha = layer.alpha * randBetween(rng, 0.8, 1);
      blobPath(ctx, p.x, p.y, r, rng);
      ctx.fill();
      if (layer.minMm < 3) continue;
      const satellites = 2 + randInt(rng, 3);
      for (let k = 0; k < satellites; k++) {
        const a = rng() * Math.PI * 2;
        const d = r * randBetween(rng, 1.3, 2.4);
        circlePath(ctx, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, r * randBetween(rng, 0.08, 0.22));
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Mármol: nubes blandas de `color2` y vetas onduladas (cadenas de curvas
 * cuadráticas con giros aleatorios) dibujadas en varias pasadas de anchura
 * decreciente y alpha creciente, para que se mezclen con el color base.
 */
function drawMarble(s: Scene, R: number): void {
  const { ctx, rng, disc, px } = s;
  ctx.strokeStyle = disc.color2;
  ctx.fillStyle = disc.color2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const clouds = Math.round((7 + randInt(rng, 4)) * Math.max(0.5, amountFactor(s)));
  for (let i = 0; i < clouds; i++) {
    const p = randomPointInDisc(s, R);
    const rx = randBetween(rng, 14, 45) * px;
    const ry = rx * randBetween(rng, 0.25, 0.7);
    ctx.globalAlpha = randBetween(rng, 0.1, 0.22);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rx, ry, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  const passes = [
    { width: 1, alpha: 0.12 },
    { width: 0.65, alpha: 0.18 },
    { width: 0.35, alpha: 0.3 },
    { width: 0.15, alpha: 0.45 },
  ];
  const veins = Math.round((14 + randInt(rng, 7)) * Math.max(0.5, amountFactor(s)));
  for (let i = 0; i < veins; i++) {
    const start = randomPointInDisc(s, R);
    const segments = 3 + randInt(rng, 3);
    let heading = rng() * Math.PI * 2;
    const points: { x: number; y: number }[] = [start];
    let x = start.x;
    let y = start.y;
    for (let k = 0; k < segments; k++) {
      heading += randBetween(rng, -1.1, 1.1);
      const len = randBetween(rng, 12, 34) * px;
      x += Math.cos(heading) * len;
      y += Math.sin(heading) * len;
      points.push({ x, y });
    }
    const widthPx = randBetween(rng, 2, 9) * px;
    for (const pass of passes) {
      ctx.globalAlpha = pass.alpha;
      ctx.lineWidth = Math.max(0.5, widthPx * pass.width);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      for (let k = 1; k + 1 < points.length; k++) {
        const p = points[k]!;
        const q = points[k + 1]!;
        ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
      }
      const last = points[points.length - 1]!;
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/** Obra a cara completa (`decoration === 'full'`), recortada al círculo del disco. */
function drawArtwork(s: Scene): void {
  const art = s.side.artwork;
  if (!art) return;
  const { ctx, c } = s;
  ctx.save();
  circlePath(ctx, c, c, s.geo.radiusMm * s.px);
  ctx.clip();
  paintFill(ctx, art, discBox(s), s.images);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Surcos
// ---------------------------------------------------------------------------

interface RadialBand {
  outerMm: number;
  innerMm: number;
}

/** Bandas lisas de separación entre canciones (al menos 1 mm de ancho, centradas en el hueco real). */
function separationBands(disc: Disc, side: Side): RadialBand[] {
  const bands = trackBands(disc, side);
  const out: RadialBand[] = [];
  for (let i = 0; i + 1 < bands.length; i++) {
    // El radio decrece con el tiempo: el final de una canción está más afuera que el inicio de la siguiente.
    const outer = bands[i]!.innerMm;
    const inner = bands[i + 1]!.outerMm;
    const center = (outer + inner) / 2;
    const half = Math.max((outer - inner) / 2, 0.5);
    out.push({ outerMm: center + half, innerMm: center - half });
  }
  return out;
}

function inBand(bands: RadialBand[], rMm: number): boolean {
  for (const b of bands) if (rMm <= b.outerMm && rMm >= b.innerMm) return true;
  return false;
}

/**
 * Anillos concéntricos desde `outerGrooveMm` hasta `innerGrooveMm`. El paso
 * y el contraste dependen de la densidad real de la cara (una cara de 25 min
 * se ve más tupida que una de 8 min). Lead-in y lead-out van más espaciados
 * y lisos; las separaciones entre canciones quedan sin surco y algo más
 * claras. Con `faint` (obra a cara completa) todo va con alpha baja.
 */
function drawGrooves(s: Scene, faint: boolean): void {
  const { ctx, c, geo, disc, side, px } = s;
  const dn = clamp(grooveDensity(disc, side) / 10, 0, 1);
  const step = (s.low ? 3 : 1.2) * (1.5 - 0.8 * dn);
  const depth = clamp(disc.grooveDepth, 0, 1);
  const contrast = (0.45 + 0.55 * dn) * (0.5 + 0.5 * depth) * (faint ? 0.5 : 1) * (s.low ? 1.6 : 1);
  const tint = s.dark ? '255,255,255' : '0,0,0';
  const { outer: progOuter, inner: progInner } = programSpanMm(geo);
  const bands = separationBands(disc, side);
  const rOuter = geo.outerGrooveMm * px;
  const rInner = geo.innerGrooveMm * px;
  const count = Math.ceil((rOuter - rInner) / step) + 2;
  const fine = smoothNoise(s.rng, count, 5);
  const broad = smoothNoise(s.rng, count, 40);

  ctx.save();
  circlePath(ctx, c, c, geo.radiusMm * px);
  ctx.clip();
  ctx.lineWidth = Math.max(0.5, step * 0.45);
  let r = rOuter;
  let i = 0;
  while (r > rInner) {
    const rMm = r / px;
    const program = rMm <= progOuter && rMm >= progInner;
    const alpha = program ? contrast * (0.05 + 0.09 * (fine[i] ?? 0.5) + 0.06 * (broad[i] ?? 0.5)) : contrast * 0.06;
    if (!inBand(bands, rMm)) {
      ctx.strokeStyle = `rgba(${tint},${alpha.toFixed(3)})`;
      circlePath(ctx, c, c, r);
      ctx.stroke();
    }
    r -= program ? step : step * 2.5;
    i++;
  }
  ctx.fillStyle = `rgba(255,255,255,${((s.dark ? 0.06 : 0.1) * (faint ? 0.5 : 1)).toFixed(3)})`;
  for (const b of bands) {
    annulusPath(ctx, c, c, b.innerMm * px, b.outerMm * px);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Texto grabado a mano en el dead wax: tipografía fina, ligeramente
 * irregular y de poco contraste, sobre un arco en la parte baja del disco.
 * Solo si queda dead wax libre entre `freeFromMm` (galleta o aro) y el surco interior.
 */
function drawRunoutEtching(s: Scene, freeFromMm: number): void {
  const text = s.side.runoutEtching.trim();
  if (!text) return;
  const free = s.geo.innerGrooveMm - freeFromMm;
  if (free < 2) return;
  const { ctx, c, px, rng } = s;
  const radius = (freeFromMm + free * 0.5) * px;
  const sizePx = Math.max(MIN_FONT_PX, Math.min(2.4, free * 0.55) * px);
  const style: TextStyle = {
    color: s.dark ? 'rgba(255,255,255,0.32)' : 'rgba(0,0,0,0.34)',
    weight: 300,
    width: 'normal',
    align: 'center',
    uppercase: true,
  };
  // El temblor se expresa en mm sobre el arco y se convierte a ángulo: así es igual de sutil a cualquier radio.
  drawTextOnArc(ctx, text, c, c, radius, Math.PI / 2, style, sizePx, {
    inside: true,
    strokeWidth: Math.max(0.5, sizePx * 0.07),
    jitter: () => ({
      dr: randBetween(rng, -0.12, 0.12) * px,
      da: (randBetween(rng, -0.12, 0.12) * px) / radius,
    }),
  });
}

// ---------------------------------------------------------------------------
// Aro decorado
// ---------------------------------------------------------------------------

/** Remache metálico: cuerpo del color dado, brillo arriba-izquierda y sombra abajo-derecha. */
function drawRivet(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  circlePath(ctx, x + r * 0.25, y + r * 0.3, r);
  ctx.fill();
  ctx.fillStyle = color;
  circlePath(ctx, x, y, r);
  ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, 'rgba(255,255,255,0.62)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g;
  circlePath(ctx, x, y, r);
  ctx.fill();
}

/** Bisel de una corona metálica: claro hacia el borde interior, oscuro hacia el exterior. */
function drawBevel(ctx: CanvasRenderingContext2D, c: number, r0: number, r1: number): void {
  const g = ctx.createRadialGradient(c, c, r0, c, c, r1);
  g.addColorStop(0, 'rgba(0,0,0,0.3)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.22)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.04)');
  g.addColorStop(0.88, 'rgba(0,0,0,0.08)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g;
  annulusPath(ctx, c, c, r0, r1);
  ctx.fill();
}

/** Número de elementos repartidos en una circunferencia con un paso aproximado. */
function countAround(radiusPx: number, stepPx: number, min: number): number {
  return Math.max(min, Math.round((2 * Math.PI * radiusPx) / Math.max(1, stepPx)));
}

/** Dibuja el aro pegado a la galleta. Devuelve el radio exterior del aro en mm. */
function drawRing(s: Scene): number {
  const { ctx, c, px, side, geo } = s;
  const ring = side.ring;
  const widthMm = clamp(ring.widthMm, 0, maxRingWidthMm(geo.format));
  if (widthMm <= 0) return geo.labelRadiusMm;
  const r0 = geo.labelRadiusMm * px;
  const r1 = (geo.labelRadiusMm + widthMm) * px;
  const rm = (r0 + r1) / 2;
  const w = r1 - r0;

  ctx.save();
  annulusPath(ctx, c, c, r0, r1);
  ctx.clip();
  ctx.fillStyle = ring.color1;
  ctx.fillRect(c - r1, c - r1, 2 * r1, 2 * r1);
  ctx.fillStyle = ring.color2;
  switch (ring.pattern) {
    case 'plain':
      break;
    case 'stripes': {
      const n = Math.max(16, Math.round(countAround(r1, w * 0.8, 16) / 2) * 2);
      for (let i = 0; i < n; i += 2) {
        annularSectorPath(ctx, c, c, r0, r1, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'dots': {
      const n = countAround(rm, w * 0.9, 8);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        circlePath(ctx, c + Math.cos(a) * rm, c + Math.sin(a) * rm, w * 0.18);
        ctx.fill();
      }
      break;
    }
    case 'rivets': {
      drawBevel(ctx, c, r0, r1);
      const n = countAround(rm, w * 1.05, 8);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        drawRivet(ctx, c + Math.cos(a) * rm, c + Math.sin(a) * rm, w * 0.2, ring.color2);
      }
      break;
    }
    case 'stars': {
      const n = countAround(rm, w * 1.1, 6);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        starPath(ctx, c + Math.cos(a) * rm, c + Math.sin(a) * rm, w * 0.27, w * 0.11, a);
        ctx.fill();
      }
      break;
    }
    case 'checker': {
      const n = countAround(rm, w / 2, 12);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < 2; j++) {
          if ((i + j) % 2 !== 0) continue;
          const a0 = (i / n) * Math.PI * 2;
          const a1 = ((i + 1) / n) * Math.PI * 2;
          annularSectorPath(ctx, c, c, r0 + (w / 2) * j, r0 + (w / 2) * (j + 1), a0, a1);
          ctx.fill();
        }
      }
      break;
    }
    case 'image': {
      const img = s.images.get(ring.image);
      if (img) {
        const r = fitRect(img.naturalWidth, img.naturalHeight, { x: c - r1, y: c - r1, w: 2 * r1, h: 2 * r1 }, 'cover');
        ctx.drawImage(img, r.x, r.y, r.w, r.h);
      }
      break;
    }
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = Math.max(1, 0.2 * px);
  circlePath(ctx, c, c, r1);
  ctx.stroke();
  return geo.labelRadiusMm + widthMm;
}

// ---------------------------------------------------------------------------
// Galleta
// ---------------------------------------------------------------------------

export interface LabelLayoutInput {
  /** Radio de la galleta en mm. */
  radiusMm: number;
  /** Radio del agujero central en mm (la zona que el texto debe evitar). */
  holeRadiusMm: number;
  /** Hay anillo de color alrededor del agujero (amplía un poco la zona evitada). */
  holeRing: boolean;
  pxPerMm: number;
  label: LabelSpec;
  tracks: Track[];
  sideId: SideId;
  rpm: Rpm;
}

/** Una línea de texto colocada en la galleta (coordenadas en mm desde el centro). */
export interface PlacedText {
  text: string;
  xMm: number;
  yMm: number;
  sizePx: number;
  style: TextStyle;
  align: TextStyle['align'];
}

/** Anchura en px de un texto (sin transformar) con un estilo y tamaño. */
export type MeasureFn = (text: string, style: TextStyle, sizePx: number) => number;

/** Tamaños base de letra en mm para una galleta de 50 mm de radio (se escalan con el radio). */
const LABEL_SIZE_MM = {
  header: 2.0,
  brandMaxRatio: 0.24,
  artist: 2.8,
  title: 2.6,
  track: 2.1,
  extra: 2.1,
  legal: 1.35,
  year: 1.8,
  catalog: 4.2,
};
const LINE_HEIGHT = 1.25;
const REFERENCE_LABEL_RADIUS_MM = 50;

interface Segment {
  x0: number;
  x1: number;
}

type Column = 'auto' | 'left' | 'right';

function rpmText(rpm: Rpm): string {
  return rpm === 33 ? '33⅓ r.p.m.' : `${rpm} r.p.m.`;
}

/** Maquetador de una pasada con un factor de reducción `f` dado. */
class LabelFlow {
  readonly placed: PlacedText[] = [];
  overflow = false;
  /** Radio útil (el radio menos el margen de papel). */
  readonly reff: number;
  /** Radio de la zona central que el texto evita. */
  readonly keepOut: number;
  private readonly gapMm: number;
  private readonly scale: number;
  /** Cursor vertical (borde superior de la siguiente línea), en mm. */
  y: number;
  /** Límite inferior del flujo (donde empieza el pie), en mm. */
  yLimit: number;
  /** Hasta qué altura (mm) hay ya texto en el tramo izquierdo de la banda del agujero. */
  private leftUsedUntil = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly input: LabelLayoutInput,
    private readonly measure: MeasureFn,
    readonly f: number,
  ) {
    this.reff = input.radiusMm * 0.93;
    this.keepOut = input.holeRadiusMm + 1.2 + (input.holeRing ? 0.8 : 0);
    this.gapMm = 1;
    this.scale = input.radiusMm / REFERENCE_LABEL_RADIUS_MM;
    this.y = -this.reff * 0.86;
    this.yLimit = this.reff;
  }

  sizePx(mm: number): number {
    return Math.max(MIN_FONT_PX, mm * this.scale * this.f * this.input.pxPerMm);
  }

  heightMm(sizePx: number): number {
    return (sizePx / this.input.pxPerMm) * LINE_HEIGHT;
  }

  /** ¿Todos los tamaños han llegado ya al mínimo? Reducir más no cambia nada. */
  atFloor(): boolean {
    return LABEL_SIZE_MM.catalog * this.scale * this.f * this.input.pxPerMm <= MIN_FONT_PX;
  }

  /** Tramos horizontales libres (mm) para una banda centrada en `y` de altura `h`. */
  segmentsAt(y: number, h: number): Segment[] {
    const top = y - h * 0.4;
    const bottom = y + h * 0.4;
    const hw = Math.min(chordHalfWidth(this.reff, top), chordHalfWidth(this.reff, bottom));
    if (hw <= 0) return [];
    const nearest = top <= 0 && bottom >= 0 ? 0 : Math.min(Math.abs(top), Math.abs(bottom));
    const kw = chordHalfWidth(this.keepOut, nearest);
    if (kw <= 0) return [{ x0: -hw, x1: hw }];
    const edge = kw + this.gapMm;
    if (hw <= edge) return [];
    return [
      { x0: -hw, x1: -edge },
      { x0: edge, x1: hw },
    ];
  }

  /**
   * Elige el tramo: con un solo tramo (anchura completa) vale para
   * cualquier columna; con la banda partida por el agujero, la columna
   * pedida o, en automático, la del lado de la alineación (el más ancho si
   * está centrado).
   */
  pick(segs: Segment[], align: TextStyle['align'], column: Column): Segment | null {
    if (segs.length === 0) return null;
    if (segs.length === 1) return segs[0]!;
    const [left, right] = [segs[0]!, segs[1]!];
    if (column === 'left' || (column === 'auto' && align === 'left')) return left;
    if (column === 'right' || (column === 'auto' && align === 'right')) return right;
    return right.x1 - right.x0 >= left.x1 - left.x0 ? right : left;
  }

  anchorX(seg: Segment, align: TextStyle['align']): number {
    return align === 'left' ? seg.x0 : align === 'right' ? seg.x1 : (seg.x0 + seg.x1) / 2;
  }

  /** Anchura en px del tramo elegido para la línea `i` a partir de `yTop`, o 0 si no hay sitio. */
  private widthForLine(yTop: number, h: number, i: number, align: TextStyle['align'], column: Column): number {
    const yc = yTop + i * h + h / 2;
    if (yc + h / 2 > this.yLimit) return 0;
    const seg = this.pick(this.segmentsAt(yc, h), align, column);
    return seg ? (seg.x1 - seg.x0) * this.input.pxPerMm : 0;
  }

  private put(text: string, yc: number, h: number, sizePx: number, style: TextStyle, column: Column): boolean {
    const seg = this.pick(this.segmentsAt(yc, h), style.align, column);
    if (!seg) return false;
    if (seg.x1 <= 0) this.leftUsedUntil = Math.max(this.leftUsedUntil, yc + h / 2);
    this.placed.push({ text, xMm: this.anchorX(seg, style.align), yMm: yc, sizePx, style, align: style.align });
    return true;
  }

  /**
   * Una sola línea que se reduce hasta caber en su tramo (marca, catálogo,
   * cabecera). Avanza el cursor.
   */
  placeShrinking(text: string, style: TextStyle, sizeMm: number, column: Column = 'auto'): void {
    if (!text.trim()) return;
    let size = this.sizePx(sizeMm);
    const h0 = this.heightMm(size);
    const width = this.widthForLine(this.y, h0, 0, style.align, column);
    if (width <= 0) {
      this.overflow = true;
      return;
    }
    size = shrinkToFit(size, MIN_FONT_PX, (sz) => this.measure(text, style, sz) <= width);
    const h = this.heightMm(size);
    if (!this.put(text, this.y + h / 2, h, size, style, column)) this.overflow = true;
    this.y += h;
  }

  /** Texto ajustado en líneas (hasta `maxLines`) que avanza el cursor. */
  placeWrapped(text: string, style: TextStyle, sizeMm: number, maxLines: number, column: Column = 'auto'): void {
    if (!text.trim()) return;
    const size = this.sizePx(sizeMm);
    const h = this.heightMm(size);
    const yTop = this.y;
    const wrapped = wrapTextDetailed(
      text,
      (t) => this.measure(t, style, size),
      (i) => this.widthForLine(yTop, h, i, style.align, column),
      maxLines,
    );
    if (wrapped.truncated) this.overflow = true;
    wrapped.lines.forEach((line, i) => {
      if (!this.put(line, yTop + i * h + h / 2, h, size, style, column)) this.overflow = true;
    });
    this.y = yTop + wrapped.lines.length * h;
  }

  /**
   * Intenta colocar un texto en la columna izquierda de la banda del
   * agujero (entre −keepOut y +keepOut), por debajo de lo que ya ocupe ese
   * lado. Devuelve false, sin colocar nada, si no cabe entero.
   */
  tryLeftColumn(text: string, style: TextStyle, sizeMm: number): boolean {
    const size = this.sizePx(sizeMm);
    const h = this.heightMm(size);
    const yTop = Math.max(-this.keepOut, this.leftUsedUntil) + h * 0.1;
    const limit = Math.min(this.keepOut, this.yLimit);
    const widthFor = (i: number): number => {
      const yc = yTop + i * h + h / 2;
      if (yc + h / 2 > limit) return 0;
      const seg = this.pick(this.segmentsAt(yc, h), style.align, 'left');
      return seg ? (seg.x1 - seg.x0) * this.input.pxPerMm : 0;
    };
    const wrapped = wrapTextDetailed(text, (t) => this.measure(t, style, size), widthFor);
    if (wrapped.truncated || wrapped.lines.length === 0) return false;
    const ok = wrapped.lines.every((line, i) => this.put(line, yTop + i * h + h / 2, h, size, style, 'left'));
    return ok;
  }

  /** Dos textos cortos en la misma línea: uno al extremo izquierdo y otro al derecho. */
  placePair(left: string, right: string, style: TextStyle, sizeMm: number): void {
    if (!left) return this.placeShrinking(right, style, sizeMm);
    if (!right) return this.placeShrinking(left, style, sizeMm);
    let size = this.sizePx(sizeMm);
    const h0 = this.heightMm(size);
    const seg = this.pick(this.segmentsAt(this.y + h0 / 2, h0), style.align, 'auto');
    if (!seg) {
      this.overflow = true;
      return;
    }
    const width = (seg.x1 - seg.x0) * this.input.pxPerMm;
    const gap = this.gapMm * 2 * this.input.pxPerMm;
    size = shrinkToFit(
      size,
      MIN_FONT_PX,
      (sz) => this.measure(left, style, sz) + this.measure(right, style, sz) + gap <= width,
    );
    const h = this.heightMm(size);
    const yc = this.y + h / 2;
    const segFinal = this.pick(this.segmentsAt(yc, h), style.align, 'auto') ?? seg;
    this.placed.push({ text: left, xMm: segFinal.x0, yMm: yc, sizePx: size, style, align: 'left' });
    this.placed.push({ text: right, xMm: segFinal.x1, yMm: yc, sizePx: size, style, align: 'right' });
    this.y += h;
  }

  /**
   * Pie anclado abajo: número de catálogo grande y, encima, año y sello en
   * pequeño. Fija `yLimit` para el flujo del cuerpo.
   */
  placeFooter(catalog: string, yearLine: string, textStyle: TextStyle): void {
    const hasCatalog = catalog.trim().length > 0;
    const hasYear = yearLine.trim().length > 0;
    // La pila del pie se ancla a algo más de media línea del borde, donde la cuerda ya es ancha.
    const anchorSizeMm = hasCatalog ? LABEL_SIZE_MM.catalog : LABEL_SIZE_MM.year;
    let bottom = this.reff - 0.6 * this.heightMm(this.sizePx(anchorSizeMm));
    if (hasCatalog) {
      const style: TextStyle = { ...textStyle, weight: Math.max(textStyle.weight, 800) };
      bottom = this.placeAbove(catalog, style, LABEL_SIZE_MM.catalog, bottom);
    }
    if (hasYear) bottom = this.placeAbove(yearLine, textStyle, LABEL_SIZE_MM.year, bottom);
    this.yLimit = bottom - 0.5;
  }

  /** Coloca una línea (reducida hasta caber) con su borde inferior en `bottom`; devuelve su borde superior. */
  private placeAbove(text: string, style: TextStyle, sizeMm: number, bottom: number): number {
    let size = this.sizePx(sizeMm);
    let h = this.heightMm(size);
    const seg = this.pick(this.segmentsAt(bottom - h / 2, h), style.align, 'auto');
    if (!seg) return bottom;
    const width = (seg.x1 - seg.x0) * this.input.pxPerMm;
    size = shrinkToFit(size, MIN_FONT_PX, (sz) => this.measure(text, style, sz) <= width);
    h = this.heightMm(size);
    const yc = bottom - h / 2;
    return this.put(text, yc, h, size, style, 'auto') ? yc - h / 2 : bottom;
  }
}

function layoutOnce(input: LabelLayoutInput, measure: MeasureFn, f: number, below = false): LabelFlow {
  const flow = new LabelFlow(input, measure, f);
  const { fields, text, brandText } = input.label;
  const sideText = fields.sideMarker ? `Cara ${input.sideId}` : '';
  const rpm = fields.showRpm ? rpmText(input.rpm) : '';
  const yearLine = [fields.year.trim(), fields.brand.trim()].filter(Boolean).join('   ');

  flow.placeFooter(fields.catalogNumber.trim(), yearLine, text);

  if (sideText || rpm) flow.placePair(sideText, rpm, text, LABEL_SIZE_MM.header);
  flow.placeShrinking(fields.brand.trim(), brandText, LABEL_SIZE_MM.brandMaxRatio * REFERENCE_LABEL_RADIUS_MM);
  // Variante «como la galleta clásica»: cabecera y marca arriba, texto legal junto al agujero
  // y artista, título y canciones debajo del agujero.
  if (below) flow.y = Math.max(flow.y, flow.keepOut + 1);
  const artistStyle: TextStyle = { ...text, weight: Math.min(900, text.weight + 200) };
  flow.placeWrapped(fields.artist.trim(), artistStyle, LABEL_SIZE_MM.artist, 2);
  flow.placeWrapped(fields.title.trim(), text, LABEL_SIZE_MM.title, 2);

  if (fields.showTracklist) {
    input.tracks.forEach((track, i) => {
      const title = track.title.trim() || `Canción ${i + 1}`;
      flow.placeWrapped(`${i + 1}. ${title} ${formatDuration(track.durationSec)}`, text, LABEL_SIZE_MM.track, 2, 'right');
    });
  }
  for (const line of fields.extraLines) flow.placeWrapped(line.trim(), text, LABEL_SIZE_MM.extra, 3, 'right');

  const legal = fields.showCopyright ? fields.copyright.trim() : '';
  if (legal) {
    const legalStyle: TextStyle = { ...text, uppercase: false, weight: Math.min(text.weight, 600) };
    if (!flow.tryLeftColumn(legal, legalStyle, LABEL_SIZE_MM.legal)) {
      flow.placeWrapped(legal, legalStyle, LABEL_SIZE_MM.legal, 6, 'right');
    }
  }
  return flow;
}

/** Factor máximo de crecimiento de la tipografía cuando la galleta tiene poco texto. */
export const LABEL_GROW_MAX = 1.45;
/** Factor mínimo de reducción cuando hay mucho texto. */
const LABEL_SHRINK_MIN = 0.3;

/**
 * Maqueta todo el texto de la galleta dentro del círculo, evitando el
 * agujero: cabecera (cara y velocidad), marca grande, artista y título,
 * lista de canciones con duraciones, líneas extra, texto legal en la
 * columna izquierda junto al agujero (o al final si no cabe) y, abajo,
 * año, sello y número de catálogo. A cada línea le corresponde la cuerda
 * del círculo a su altura menos los márgenes.
 *
 * Busca el MAYOR factor de escala con el que todo cabe: con poco texto la
 * tipografía crece hasta `LABEL_GROW_MAX` (una galleta real no deja medio
 * papel vacío) sin partir en dos ninguna línea que al tamaño base cabía
 * entera; con mucho texto se reduce proporcionalmente hasta el mínimo de
 * `MIN_FONT_PX`.
 */
export function layoutLabelText(input: LabelLayoutInput, measure: MeasureFn): PlacedText[] {
  const above = layoutVariant(input, measure, false);
  const below = layoutVariant(input, measure, true);
  // Gana la maquetación de letra más grande; a igualdad, la que reparte el texto bajo el agujero
  // (así una cara con pocas canciones no deja media galleta vacía).
  return (below.f >= above.f ? below : above).placed;
}

/** Una de las dos maquetaciones (todo arriba o repartido bajo el agujero) con su mejor factor. */
function layoutVariant(input: LabelLayoutInput, measure: MeasureFn, belowHole: boolean): LabelFlow {
  const once = (f: number): LabelFlow => layoutOnce(input, measure, f, belowHole);
  const base = once(1);
  if (!base.overflow) {
    // Crecer: vale cualquier factor que no desborde, no añada líneas (cada línea colocada es un
    // texto) y no deje ningún texto más pequeño que en la base. Lo último importa con los textos
    // que se encogen para caber (sello, cabecera, catálogo): al bajar el cursor pueden caer en la
    // franja partida por el agujero y quedar diminutos aunque "quepan".
    const fits = (flow: LabelFlow): boolean =>
      !flow.overflow &&
      flow.placed.length === base.placed.length &&
      flow.placed.every((p, i) => p.sizePx >= (base.placed[i]?.sizePx ?? 0) - 1e-6);
    return largestFitting(once, 1, LABEL_GROW_MAX, base, fits);
  }
  const smallest = once(LABEL_SHRINK_MIN);
  if (smallest.overflow) {
    // Ni al mínimo cabe todo: el primer factor que llega al suelo de tamaño es el más legible.
    let f = 0.9;
    for (;;) {
      const flow = once(f);
      if (!flow.overflow || flow.atFloor() || f <= LABEL_SHRINK_MIN) return flow;
      f *= 0.9;
    }
  }
  return largestFitting(once, LABEL_SHRINK_MIN, 1, smallest, (flow) => !flow.overflow);
}

/**
 * Búsqueda binaria del mayor factor en [lo, hi] que cumple `fits`, sabiendo
 * que `atLo` (la maquetación con `lo`) lo cumple.
 */
function largestFitting(
  once: (f: number) => LabelFlow,
  lo: number,
  hi: number,
  atLo: LabelFlow,
  fits: (flow: LabelFlow) => boolean,
): LabelFlow {
  const top = once(hi);
  if (fits(top)) return top;
  let best = atLo;
  let low = lo;
  let high = hi;
  for (let i = 0; i < 10 && high - low > 0.01; i++) {
    const mid = (low + high) / 2;
    const flow = once(mid);
    if (fits(flow)) {
      low = mid;
      best = flow;
    } else high = mid;
  }
  return best;
}

/** Anillo fino de color alrededor del agujero (detalle de imprenta). */
function drawHoleRing(s: Scene, color: string): void {
  const { ctx, c, px } = s;
  const holeR = (holeDiameterMm(s.disc.hole) / 2) * px;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, 0.7 * px);
  circlePath(ctx, c, c, holeR + 0.6 * px);
  ctx.stroke();
}

function drawLabel(s: Scene): void {
  const { ctx, c, px, side, geo } = s;
  const label = side.label;
  const R = geo.labelRadiusMm * px;
  const box: Rect = { x: c - R, y: c - R, w: 2 * R, h: 2 * R };

  ctx.save();
  circlePath(ctx, c, c, R);
  ctx.clip();
  paintFill(ctx, label.background, box, s.images);

  const img = s.images.get(label.image);
  if (img) {
    const d = 2 * R * clamp(label.imageScale, 0.2, 1);
    const r = fitRect(img.naturalWidth, img.naturalHeight, { x: c - d / 2, y: c - d / 2, w: d, h: d }, 'contain');
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
  }

  const measure: MeasureFn = (text, style, sizePx) => measureTextWidth(ctx, textCase(text, style), style, sizePx);
  const placed = layoutLabelText(
    {
      radiusMm: geo.labelRadiusMm,
      holeRadiusMm: holeDiameterMm(s.disc.hole) / 2,
      holeRing: !!label.holeRingColor,
      pxPerMm: px,
      label,
      tracks: side.tracks,
      sideId: side.id,
      rpm: s.disc.nativeRpm,
    },
    measure,
  );
  for (const p of placed) {
    drawText(ctx, p.text, c + p.xMm * px, c + p.yMm * px, p.style, p.sizePx, { align: p.align, baseline: 'middle' });
  }

  const shadow = ctx.createRadialGradient(c, c, R * 0.88, c, c, R);
  shadow.addColorStop(0, 'rgba(0,0,0,0)');
  shadow.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = shadow;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.restore();

  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, 0.25 * px);
  circlePath(ctx, c, c, R);
  ctx.stroke();

  if (label.holeRingColor) drawHoleRing(s, label.holeRingColor);
}

// ---------------------------------------------------------------------------
// Borde remachado, canto, polvo y agujero
// ---------------------------------------------------------------------------

/** Borde pintado/metálico de una cara enteramente decorada, con bisel y remaches. */
function drawRim(s: Scene): void {
  const { ctx, c, px, side, geo } = s;
  const rim = side.rim;
  const widthMm = clamp(rim.widthMm, 1, geo.radiusMm * 0.3);
  const r1 = geo.radiusMm * px;
  const r0 = (geo.radiusMm - widthMm) * px;
  const w = r1 - r0;

  ctx.save();
  circlePath(ctx, c, c, r1);
  ctx.clip();
  const inner = ctx.createRadialGradient(c, c, Math.max(0, r0 - 1.5 * px), c, c, r0);
  inner.addColorStop(0, 'rgba(0,0,0,0)');
  inner.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = inner;
  annulusPath(ctx, c, c, Math.max(0, r0 - 1.5 * px), r0);
  ctx.fill();

  ctx.fillStyle = rim.color;
  annulusPath(ctx, c, c, r0, r1);
  ctx.fill();
  drawBevel(ctx, c, r0, r1);
  if (rim.rivets) {
    const rm = (r0 + r1) / 2;
    const n = countAround(rm, w * 1.8, 12);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      drawRivet(ctx, c + Math.cos(a) * rm, c + Math.sin(a) * rm, w * 0.17, rim.color);
    }
  }
  ctx.restore();
}

/** Canto del disco: bisel de ~1 mm algo más claro y un filo exterior más oscuro. */
function drawEdge(s: Scene): void {
  const { ctx, c, px } = s;
  const R = s.geo.radiusMm * px;
  ctx.fillStyle = `rgba(255,255,255,${s.dark ? 0.07 : 0.12})`;
  annulusPath(ctx, c, c, R - 1 * px, R - 0.3 * px);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  annulusPath(ctx, c, c, R - 0.3 * px, R);
  ctx.fill();
}

/** Motas y fibras según `condition.dust` (más densas hacia el borde) y rayas en arco según `condition.scratches`. */
function drawDust(s: Scene): void {
  const { ctx, c, rng, px } = s;
  const cond = s.disc.condition;
  const R = s.geo.radiusMm * px;
  const holeR = (holeDiameterMm(s.disc.hole) / 2) * px;
  const dust = clamp(cond.dust, 0, 1);
  const factor = ((s.size / 1200) ** 2) * (s.low ? 0.3 : 1);

  ctx.save();
  circlePath(ctx, c, c, R);
  ctx.clip();
  if (dust > 0.004) {
    const motes = Math.round(dust * 1500 * factor);
    for (let i = 0; i < motes; i++) {
      const a = rng() * Math.PI * 2;
      const d = R * Math.pow(rng(), 0.4);
      if (d < holeR) continue;
      ctx.fillStyle = `rgba(238,235,228,${randBetween(rng, 0.25, 0.65).toFixed(2)})`;
      const r = randBetween(rng, 0.5, 1);
      circlePath(ctx, c + Math.cos(a) * d, c + Math.sin(a) * d, r);
      ctx.fill();
    }
    const fibers = Math.round(motes / 8);
    ctx.lineWidth = 1;
    for (let i = 0; i < fibers; i++) {
      const a = rng() * Math.PI * 2;
      const d = R * Math.pow(rng(), 0.4);
      const x = c + Math.cos(a) * d;
      const y = c + Math.sin(a) * d;
      const dir = rng() * Math.PI * 2;
      const len = randBetween(rng, 3, 8);
      ctx.strokeStyle = `rgba(238,235,228,${randBetween(rng, 0.2, 0.4).toFixed(2)})`;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(dir) * len, y + Math.sin(dir) * len);
      ctx.stroke();
    }
  }
  const scratches = clamp(cond.scratches, 0, 1);
  if (scratches > 0) {
    const innerLimit = s.full ? 0 : s.geo.labelRadiusMm * px;
    annulusPath(ctx, c, c, innerLimit, R);
    ctx.clip();
    const n = Math.round(scratches * 14) + 1;
    for (let i = 0; i < n; i++) {
      const offsetA = rng() * Math.PI * 2;
      const offsetD = R * randBetween(rng, 0, 0.5);
      const cx = c + Math.cos(offsetA) * offsetD;
      const cy = c + Math.sin(offsetA) * offsetD;
      const radius = R * randBetween(rng, 0.3, 1.3);
      const start = rng() * Math.PI * 2;
      const sweep = randBetween(rng, 0.15, 1.2);
      ctx.strokeStyle = `rgba(255,255,255,${randBetween(rng, 0.22, 0.5).toFixed(2)})`;
      ctx.lineWidth = randBetween(rng, 0.7, 1.2);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, start, start + sweep);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Agujero central: círculo transparente. */
function cutHole(s: Scene): void {
  const { ctx, c, px } = s;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  // `destination-out` borra en proporción a la opacidad del relleno: sin un color opaco
  // heredaría el semitransparente del canto y el agujero quedaría gris en vez de vacío.
  ctx.fillStyle = '#000';
  circlePath(ctx, c, c, (holeDiameterMm(s.disc.hole) / 2) * px);
  ctx.fill();
  ctx.restore();
}

/** Degradado de aluminio cepillado con la luz arriba a la izquierda (tokens `--aluminio*`). */
function metalGradient(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): CanvasGradient {
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.05, x, y, r * 1.15);
  g.addColorStop(0, cssToken('--aluminio-claro', '#e6e9eb'));
  g.addColorStop(0.45, cssToken('--aluminio', '#b8bcc0'));
  g.addColorStop(1, cssToken('--aluminio-oscuro', '#7e8387'));
  return g;
}

/** Centrador de 45 rpm: disco de aluminio con cepillado circular y su propio agujero pequeño. */
function drawAdapter(s: Scene): void {
  const { ctx, c, px, rng } = s;
  const r = (ADAPTER_DIAMETER_MM / 2) * px;
  ctx.save();
  ctx.fillStyle = metalGradient(ctx, c, c, r);
  circlePath(ctx, c, c, r);
  ctx.fill();
  circlePath(ctx, c, c, r);
  ctx.clip();
  const rings = s.low ? 10 : 28;
  ctx.lineWidth = 1;
  for (let i = 0; i < rings; i++) {
    const rr = r * (0.2 + (0.8 * i) / rings);
    const light = rng() > 0.5;
    ctx.strokeStyle = light ? `rgba(255,255,255,${randBetween(rng, 0.05, 0.2).toFixed(2)})` : `rgba(0,0,0,${randBetween(rng, 0.05, 0.18).toFixed(2)})`;
    circlePath(ctx, c, c, rr);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = Math.max(1, 0.3 * px);
  circlePath(ctx, c, c, r - ctx.lineWidth / 2);
  ctx.stroke();
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  circlePath(ctx, c, c, (holeDiameterMm('small') / 2) * px);
  ctx.fill();
  ctx.restore();
}

/** Eje metálico del plato dentro del agujero, con brillo. */
function drawSpindle(s: Scene): void {
  const { ctx, c, px } = s;
  const r = (SPINDLE_DIAMETER_MM / 2) * px;
  ctx.fillStyle = metalGradient(ctx, c, c, r);
  circlePath(ctx, c, c, r);
  ctx.fill();
  const tip = ctx.createRadialGradient(c - r * 0.3, c - r * 0.3, 0, c, c, r);
  tip.addColorStop(0, 'rgba(255,255,255,0.5)');
  tip.addColorStop(0.6, 'rgba(255,255,255,0)');
  tip.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = tip;
  circlePath(ctx, c, c, r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  circlePath(ctx, c, c, r - 0.5);
  ctx.stroke();
}
