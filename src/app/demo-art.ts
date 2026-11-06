/**
 * Obra pintada a mano para el vinilo «enteramente decorado» de la demostración.
 *
 * La foto de referencia del usuario es un disco pintado a cara completa: texto
 * curvo arriba y abajo, figuras en el centro y un borde metálico remachado. El
 * borde ya lo dibuja `render/disc.ts` (`rim.rivets`); aquí se pinta la obra: un
 * cielo claro, una rosa de los vientos, ráfagas de viento y el artista y el
 * título en arco, con el pulso irregular de un pincel (determinista).
 *
 * Se genera en el navegador la primera vez (no se incluye ninguna imagen con
 * derechos) y se guarda como JPEG en el almacén de blobs. Sin canvas 2D
 * (tests) devuelve null y el disco conserva su degradado.
 */
import { drawTextOnArc } from '../render/draw-utils';
import type { TextStyle } from '../core/types';

/** Lado del lienzo en px: suficiente para el disco en el plato con pantalla de densidad 2. */
export const DEMO_ART_SIZE = 1400;

const INK = '#8a1f1f';
const INK_DARK = '#5e1414';
const SKY_CENTER = '#efe6d2';
const SKY_EDGE = '#7d9bb0';
const WIND = '#3e5c58';

/** Generador determinista (mulberry32) para el pulso del pincel. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paintSky(ctx: CanvasRenderingContext2D, S: number): void {
  const g = ctx.createRadialGradient(S * 0.45, S * 0.42, S * 0.05, S / 2, S / 2, S * 0.72);
  g.addColorStop(0, SKY_CENTER);
  g.addColorStop(0.55, '#c9d3d2');
  g.addColorStop(1, SKY_EDGE);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
}

/** Ráfagas de viento: trazos curvos con grosor variable, como pinceladas. */
function paintWind(ctx: CanvasRenderingContext2D, S: number, rand: () => number): void {
  const c = S / 2;
  ctx.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    const r = S * (0.2 + 0.2 * rand());
    const a0 = rand() * Math.PI * 2;
    const sweep = 0.6 + rand() * 0.9;
    ctx.strokeStyle = i % 4 === 0 ? INK : WIND;
    ctx.globalAlpha = 0.35 + rand() * 0.35;
    ctx.lineWidth = S * (0.004 + rand() * 0.006);
    ctx.beginPath();
    const steps = 24;
    for (let k = 0; k <= steps; k++) {
      const a = a0 + (sweep * k) / steps;
      const rr = r + Math.sin(k / 3 + i) * S * 0.008;
      const x = c + Math.cos(a) * rr;
      const y = c + Math.sin(a) * rr;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // Remolino al final de la ráfaga.
    const ae = a0 + sweep;
    const ex = c + Math.cos(ae) * r;
    const ey = c + Math.sin(ae) * r;
    ctx.beginPath();
    ctx.arc(ex, ey, S * (0.01 + rand() * 0.012), ae, ae + Math.PI * 1.4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Rosa de los vientos de ocho puntas, rellenas a dos tonos como pintadas a mano. */
function paintCompassRose(ctx: CanvasRenderingContext2D, S: number): void {
  const c = S / 2;
  const long = S * 0.2;
  const short = S * 0.11;
  const waist = S * 0.028;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const len = i % 2 === 0 ? long : short;
    const tip = { x: c + Math.cos(a) * len, y: c + Math.sin(a) * len };
    const left = { x: c + Math.cos(a - Math.PI / 2) * waist, y: c + Math.sin(a - Math.PI / 2) * waist };
    const right = { x: c + Math.cos(a + Math.PI / 2) * waist, y: c + Math.sin(a + Math.PI / 2) * waist };
    // Mitad iluminada y mitad en sombra (luz arriba a la izquierda).
    ctx.fillStyle = i % 2 === 0 ? INK : '#c9a66b';
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(left.x, left.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = i % 2 === 0 ? INK_DARK : '#9c7a45';
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(right.x, right.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.closePath();
    ctx.fill();
  }
  // Anillos de la rosa.
  ctx.strokeStyle = INK_DARK;
  ctx.lineWidth = S * 0.004;
  for (const r of [0.13, 0.145]) {
    ctx.beginPath();
    ctx.arc(c, c, S * r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#f1e6cf';
  ctx.beginPath();
  ctx.arc(c, c, S * 0.03, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** Artista arriba y título abajo, en arco, con trazo de pincel (contorno oscuro y temblor). */
function paintArcTitles(ctx: CanvasRenderingContext2D, S: number, artist: string, title: string, rand: () => number): void {
  const c = S / 2;
  const style: TextStyle = { color: INK, weight: 800, width: 'expanded', align: 'center', uppercase: true };
  const radius = S * 0.39;
  const jitter = (): { dr: number; da: number } => ({ dr: (rand() - 0.5) * S * 0.006, da: (rand() - 0.5) * 0.012 });
  const fit = (text: string, maxAngle: number): number => {
    // Tamaño que ocupa como mucho `maxAngle` radianes del arco.
    let size = S * 0.075;
    ctx.save();
    for (let i = 0; i < 30; i++) {
      ctx.font = `800 ${size}px "Archivo Variable", "Archivo", sans-serif`;
      if (ctx.measureText(text.toUpperCase()).width * 1.15 <= maxAngle * radius) break;
      size *= 0.92;
    }
    ctx.restore();
    return size;
  };
  if (artist) drawTextOnArc(ctx, artist, c, c, radius, -Math.PI / 2, style, fit(artist, Math.PI * 0.8), { jitter, strokeWidth: S * 0.002 });
  if (title) {
    drawTextOnArc(ctx, title, c, c, radius, Math.PI / 2, style, fit(title, Math.PI * 0.85), {
      jitter,
      inside: true,
      strokeWidth: S * 0.002,
    });
  }
}

/** Pinta la obra y la devuelve como JPEG, o null si no hay canvas 2D (tests). */
export async function paintDemoArtwork(artist: string, title: string, seed = 3101): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = DEMO_ART_SIZE;
  canvas.height = DEMO_ART_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof canvas.toBlob !== 'function') return null;
  try {
    await document.fonts?.load(`800 40px "Archivo Variable"`);
  } catch {
    // Sin la fuente se pinta con la de respaldo.
  }
  const S = DEMO_ART_SIZE;
  const rand = rng(seed);
  paintSky(ctx, S);
  paintWind(ctx, S, rand);
  paintCompassRose(ctx, S);
  paintArcTitles(ctx, S, artist, title, rand);
  return new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9));
}
