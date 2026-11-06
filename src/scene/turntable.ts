/**
 * Vista del tocadiscos (2.5D con DOM, SVG y CSS).
 *
 * CONTRATO (lo implementa el módulo de escena del tocadiscos):
 *  - `createTurntableView()` construye el elemento una vez; `update(frame)`
 *    se llama en cada frame de animación (~60 Hz) y debe ser barato: solo
 *    toca lo que cambia (transformaciones, clases, textos).
 *  - Partes visibles: base (plinto) de nogal con panel frontal, plato de
 *    aluminio con tapete de fieltro y marcas estroboscópicas en el canto,
 *    el disco cargado (copia con `blit()` de `discCanvas` en un canvas
 *    propio, dentro de un contenedor que gira con `platterAngleDeg`),
 *    eje central y centrador de 45 rpm como elementos DOM FIJOS encima del
 *    disco (`pointer-events: none`; el canvas se pide sin eje ni centrador),
 *    brillo de luz fijo sobre el disco recortado al radio de `discFormat`
 *    (`clip-path: circle()`, `pointer-events: none`, oculto si `!fancy`),
 *    brazo con contrapeso, pivote, cabezal y aguja, soporte del brazo,
 *    palanca de elevación (cue), botón start/stop, selector 33/45/78,
 *    deslizador de pitch (−8…+8) con lectura, control de volumen, botón de
 *    encendido, tapa de metacrilato con bisagra (abierta/cerrada) y una
 *    pequeña pantalla de texto (`aria-live="polite"`) con la canción que
 *    suena y el tiempo.
 *  - Bamboleo: si `discHole === 'large'` y no está el centrador, el disco
 *    orbita (traslación circular de radio (38,1 − 7,24)/2 mm con fase
 *    `platterAngleDeg`); si no, solo `scaleY` 1 ± 0,01·wobble y un
 *    desplazamiento de la sombra. Con `prefers-reduced-motion` la amplitud
 *    es 0 (el plato sigue girando: es contenido, no decoración).
 *  - Escala: el plato se dibuja a 12" (radio 151 mm); la vista mide su
 *    anchura real con ResizeObserver y guarda `pxPerMm` (píxeles CSS por
 *    mm). `discSizePx(format)` devuelve
 *    `2 * discGeometry(format).radiusMm * pxPerMm * devicePixelRatio`
 *    (píxeles de dispositivo) y la vista fija `style.width/height` del
 *    canvas del disco a su tamaño CSS. `onResize(cb)` avisa cuando cambia.
 *  - Interacción (pointer events con `setPointerCapture`; plato, disco y
 *    brazo llevan `touch-action: none`; funciona con ratón y táctil):
 *      · arrastrar el cabezal del brazo (zona de agarre invisible de
 *        ≥ 44 × 44 px CSS con prioridad sobre el disco) →
 *        `moveTonearm(radioMm, true)` en cada movimiento; al soltar,
 *        `moveTonearm(radioFinal, false)`, o `moveTonearm('rest', false)` si
 *        se suelta fuera del disco (radio > 160) o sobre el soporte;
 *      · clic en la palanca → `setCue(!lifted)`;
 *      · arrastrar el disco (no el brazo) con `tool === 'none'` →
 *        `handPlatter(°/s)` mientras se mueve y `handPlatter(null)` al
 *        soltar;
 *      · con `tool === 'brush'`, arrastrar sobre el disco → `brushStroke()`
 *        cada ~40 px de recorrido, sin mover el plato;
 *      · botones → `toggleMotor`, `setSpeed`, `setPitch`, `setVolume`,
 *        `toggleLid`, `toggleAdapter`, `powerToggle`, `removeDisc`,
 *        `flipDisc`, `setTool`.
 *  - Correspondencia puntero → radio: el brazo pivota en la esquina
 *    trasera derecha y describe un arco sobre el disco (ver
 *    turntable-geometry.ts); el ángulo del puntero respecto al pivote se
 *    convierte en radio bajo la aguja y se acota.
 *  - Accesibilidad: los botones son <button> reales con `aria-pressed`; el
 *    brazo es focusable con `role="slider"`, `aria-valuenow` = radio y
 *    `aria-valuetext` ("Cara A, canción 2, 3:10"); las flechas ←/→ (2 mm)
 *    y ↑/↓ (levantar/bajar la aguja) solo actúan con el brazo enfocado; la
 *    barra espaciadora = start/stop solo cuando el foco no está en un
 *    button/input/select/textarea. Atributos `data-test` de DESIGN.md §6.
 *  - Estética: tokens de `styles/tokens.css`. Nada de bordes genéricos ni
 *    tarjetas: es un objeto, con sombra proyectada hacia abajo-derecha.
 *
 * IMPLEMENTACIÓN:
 *  - Todo el aparato se dibuja en una "caja de diseño" de 450 × 394 mm
 *    (`STAGE_MM`) y se escala con la variable CSS `--tt-escala` (px CSS por
 *    mm), medida con ResizeObserver sobre el elemento raíz (sin
 *    ResizeObserver, con el evento `resize` de la ventana). Las posiciones
 *    derivadas de la geometría (eje, pivote, soporte, palanca) se pasan al
 *    CSS como variables en mm; el resto del trazado vive en turntable.css.
 *  - Vista cenital: el plinto se ve desde arriba con su cara frontal debajo
 *    (2.5D); todo lo que hay encima es cenital puro, así las circunferencias
 *    son círculos y el mapeo puntero → mm es directo.
 *  - El plato tiene tres capas: el canto con dos filas de marcas
 *    estroboscópicas (gira), la cara de aluminio torneado con su reflejo
 *    cónico en forma de pajarita (fija: el torneado es concéntrico y su
 *    reflejo no gira con el plato) y el tapete de fieltro (gira).
 *  - La tapa cerrada bloquea los punteros sobre el plato y el brazo con un
 *    elemento invisible (`.tt-tapa-bloqueo`) y `pointer-events: none` en
 *    las zonas de arrastre; la lámina de la tapa nunca recibe punteros, de
 *    modo que los controles frontales siguen operativos. El teclado no se
 *    bloquea: el brazo sigue siendo accesible con la tapa cerrada.
 *  - Si la mano se queda quieta sobre el disco sin soltarlo, deja de haber
 *    eventos `pointermove`; `update()` lo detecta y manda `handPlatter(0)`
 *    para que el plato no siga girando a la última velocidad de la mano.
 */
import { discGeometry } from '../core/geometry';
import type { Format, HoleSize, Rpm, TurntableState } from '../core/types';
import { blit } from '../render';
import {
  KEY_STEP_MM,
  MAX_RADIUS_MM,
  MIN_RADIUS_MM,
  ORBIT_RADIUS_MM,
  PIVOT_MM,
  PLATTER_RADIUS_MM,
  REST_RADIUS_MM,
  REST_THRESHOLD_MM,
  armAngleForRadius,
  armScreenAngleDeg,
  clampRadius,
  pointerArmAngle,
  pointerToRadius,
  type PointMm,
} from './turntable-geometry';
import './turntable.css';

export interface TurntableFrame {
  state: TurntableState;
  platterAngleDeg: number;
  actualRpm: number;
  /** Canvas compartido de la cara hacia arriba (sin eje ni centrador), o null si no hay disco. */
  discCanvas: HTMLCanvasElement | null;
  discFormat: Format | null;
  discHole: HoleSize | null;
  /** 0..1 */
  wobble: number;
  stylusInGroove: boolean;
  positionSec: number;
  sideDurationSec: number;
  nowPlaying: { title: string; artist: string; trackIndex: number } | null;
  tool: 'none' | 'brush';
  /** Nombre de la cara cargada ("Cara A") o null. */
  sideName: string | null;
  /** Ajuste "brillos y polvo". */
  fancy: boolean;
}

export interface TurntableActions {
  toggleMotor(): void;
  setSpeed(speed: Rpm): void;
  setPitch(percent: number): void;
  setVolume(v: number): void;
  toggleLid(): void;
  toggleAdapter(): void;
  setCue(lifted: boolean): void;
  /** `dragging` es true mientras el usuario arrastra el cabezal; false al soltar o por teclado. */
  moveTonearm(target: number | 'rest', dragging: boolean): void;
  handPlatter(degPerSec: number | null): void;
  brushStroke(strength: number): void;
  removeDisc(): void;
  flipDisc(): void;
  setTool(tool: 'none' | 'brush'): void;
  powerToggle(): void;
}

export interface TurntableView {
  readonly el: HTMLElement;
  update(frame: TurntableFrame): void;
  /** Tamaño en píxeles de dispositivo con el que pedir el canvas del disco de ese formato. */
  discSizePx(format: Format): number;
  /** Avisa cuando cambia la escala (y por tanto `discSizePx`). */
  onResize(cb: () => void): () => void;
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Trazado del aparato (mm, origen en la esquina superior izquierda del plinto)
// ---------------------------------------------------------------------------

/** Caja de diseño del aparato: plinto (366 mm) + cara frontal (24 mm) + patas. */
export const STAGE_MM = Object.freeze({ width: 450, height: 394 });

/** Centro del plato dentro de la caja de diseño. */
export const SPINDLE_MM: Readonly<PointMm> = Object.freeze({ x: 175, y: 162 });

/** Caja de referencia en px CSS en la que cabe el aparato antes de medirlo. */
export const REFERENCE_BOX_PX = Object.freeze({ width: 560, height: 420 });

/** Escala inicial (px CSS por mm) hasta que se mide el elemento: cabe en la caja de referencia. */
export const DEFAULT_PX_PER_MM = Math.min(
  REFERENCE_BOX_PX.width / STAGE_MM.width,
  REFERENCE_BOX_PX.height / STAGE_MM.height,
);

/** Pivote del brazo dentro de la caja de diseño. */
const PIVOT_STAGE_MM: Readonly<PointMm> = Object.freeze({
  x: SPINDLE_MM.x + PIVOT_MM.x,
  y: SPINDLE_MM.y + PIVOT_MM.y,
});

/**
 * Punto del dibujo del brazo (mm, sistema del brazo: pivote en el origen y
 * aguja en (229, 0)) que descansa sobre el poste del soporte: bajo la curva
 * del tubo, justo detrás del cabezal y fuera del canto del plato.
 */
const REST_POST_LOCAL_MM: Readonly<PointMm> = Object.freeze({ x: 194, y: -11.5 });

/** Posición de la palanca de elevación respecto al pivote (delante, fuera del barrido). */
const CUE_OFFSET_MM: Readonly<PointMm> = Object.freeze({ x: -12, y: 40 });

/** Paso de Re Pág / Av Pág en el brazo. */
const PAGE_STEP_MM = 10;

/** Separación entre pasadas del cepillo, en px CSS de recorrido del puntero. */
const BRUSH_STEP_PX = 40;
/** Velocidad media del gesto que cuenta como pasada de fuerza 1. */
const BRUSH_FULL_SPEED_PX_PER_SEC = 900;
/** Pasadas como máximo por evento (un salto grande del puntero no vale por diez). */
const BRUSH_MAX_STROKES_PER_EVENT = 3;
/** Muestras de la media móvil de la velocidad angular de la mano. */
const SCRATCH_SAMPLES = 3;
/** Sin movimiento durante este tiempo, la mano quieta sujeta el plato. */
const HAND_IDLE_MS = 80;

/** Desplazamiento base de la sombra del disco (luz desde arriba a la izquierda), en mm. */
const DISC_SHADOW_MM: Readonly<PointMm> = Object.freeze({ x: 1.2, y: 2.2 });
/** Vaivén de la sombra con el alabeo, en mm por unidad de wobble. */
const SHADOW_WOBBLE_MM = 2;

const RPMS: readonly Rpm[] = [33, 45, 78];
const DEG_TO_RAD = Math.PI / 180;
const PITCH_STEP = 0.1;
const VOLUME_STEP = 0.01;

let instanceCounter = 0;

// ---------------------------------------------------------------------------
// Utilidades de DOM
// ---------------------------------------------------------------------------

type Attrs = Record<string, string | number | boolean | undefined>;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  attrs: Attrs = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    el.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) el.append(child);
  return el;
}

function button(className: string, test: string, label: string, text?: string, pressed?: boolean): HTMLButtonElement {
  const attrs: Attrs = { type: 'button', 'data-test': test, 'aria-label': label };
  if (pressed !== undefined) attrs['aria-pressed'] = String(pressed);
  return h('button', className, attrs, text ? [text] : []);
}

function setAttr(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function setPressed(el: Element, on: boolean): void {
  setAttr(el, 'aria-pressed', on ? 'true' : 'false');
}

function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function setDisabled(el: HTMLButtonElement | HTMLInputElement, disabled: boolean): void {
  if (el.disabled !== disabled) el.disabled = disabled;
}

/** Sincroniza un deslizador con el estado sin pelear con el usuario por redondeos. */
function setRangeValue(input: HTMLInputElement, value: number, step: number): void {
  if (!Number.isFinite(value)) return;
  if (Math.abs(Number(input.value) - value) < step / 2) return;
  input.value = String(value);
}

function capturePointer(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Algunos entornos (tests, punteros ya liberados) no admiten la captura: el arrastre sigue funcionando.
  }
}

function releasePointer(el: Element, pointerId: number): void {
  try {
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
  } catch {
    // Igual que arriba.
  }
}

function isPrimaryButton(ev: PointerEvent): boolean {
  return ev.pointerType !== 'mouse' || ev.button === 0;
}

function isFormControl(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'SUMMARY') return true;
  return (el as HTMLElement).isContentEditable === true;
}

function hasDiscIn(frame: TurntableFrame | null): boolean {
  return frame !== null && frame.discCanvas !== null && frame.discFormat !== null;
}

// ---------------------------------------------------------------------------
// Formato de textos
// ---------------------------------------------------------------------------

/** "m:ss" con los segundos redondeados hacia abajo. */
export function formatClock(sec: number): string {
  const total = Number.isFinite(sec) ? Math.max(0, Math.floor(sec)) : 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** Lectura del pitch al estilo "+0,0 %". */
export function formatPitch(percent: number): string {
  const v = Number.isFinite(percent) ? percent : 0;
  const abs = Math.abs(v).toFixed(1).replace('.', ',');
  const sign = v < -0.05 ? '−' : '+';
  return `${sign}${abs} %`;
}

/** Texto del tiempo en la pantalla: entrada, salida o "posición / duración". */
export function formatPosition(positionSec: number, durationSec: number): string {
  if (positionSec < 0) return 'entrada';
  if (positionSec > durationSec) return 'salida';
  return `${formatClock(positionSec)} / ${formatClock(durationSec)}`;
}

/** Valor textual del brazo para lectores de pantalla ("Cara A, canción 2, 3:10"). */
export function describeTonearm(frame: TurntableFrame): string {
  const t = frame.state.tonearm;
  if (t.onRest) return 'En el soporte';
  if (!hasDiscIn(frame)) return t.lifted ? 'Sobre el plato, aguja levantada' : 'Sobre el plato';
  const parts: string[] = [frame.sideName ?? 'Disco'];
  if (frame.nowPlaying) parts.push(`canción ${frame.nowPlaying.trackIndex + 1}`);
  const pos = frame.positionSec;
  if (pos < 0) parts.push('entrada');
  else if (pos > frame.sideDurationSec) parts.push('salida');
  else parts.push(formatClock(pos));
  if (t.lifted) parts.push('aguja levantada');
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Construcción del DOM
// ---------------------------------------------------------------------------

interface Dom {
  root: HTMLElement;
  stage: HTMLElement;
  platter: HTMLElement;
  mat: HTMLElement;
  disc: HTMLElement;
  discCanvas: HTMLCanvasElement;
  discShadow: HTMLElement;
  shine: HTMLElement;
  adapter: HTMLElement;
  platterTouch: HTMLElement;
  arm: HTMLElement;
  headshell: HTMLElement;
  cue: HTMLButtonElement;
  power: HTMLButtonElement;
  start: HTMLButtonElement;
  speed: Record<Rpm, HTMLButtonElement>;
  pitch: HTMLInputElement;
  pitchReadout: HTMLElement;
  volume: HTMLInputElement;
  display: HTMLElement;
  displayTitle: HTMLElement;
  displaySide: HTMLElement;
  displayTime: HTMLElement;
  remove: HTMLButtonElement;
  flip: HTMLButtonElement;
  adapterToggle: HTMLButtonElement;
  lidToggle: HTMLButtonElement;
  brushToggle: HTMLButtonElement;
  lidBlocker: HTMLElement;
  brushSprite: HTMLElement;
}

/** Atributo `style` para un color de relleno o de parada tomado de los tokens. */
function paint(prop: 'fill' | 'stop-color' | 'stroke', value: string): string {
  return `style="${prop}: ${value}"`;
}

/** Marcado SVG del brazo, en mm, con el pivote en (0, 0) y la aguja en (229, 0). */
function tonearmSvg(id: string): string {
  const tube = `${id}-tubo`;
  const weight = `${id}-peso`;
  const shell = `${id}-cabezal`;
  const gimbal = `${id}-gimbal`;
  const deep = 'color-mix(in srgb, var(--aluminio-oscuro), var(--carbon) 30%)';
  return `
<svg class="tt-brazo-svg" viewBox="-72 -26 316 52" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="${tube}" x1="0" y1="-3" x2="0" y2="3" gradientUnits="userSpaceOnUse">
      <stop offset="0" ${paint('stop-color', 'var(--aluminio-claro)')}/>
      <stop offset="0.45" ${paint('stop-color', 'var(--aluminio)')}/>
      <stop offset="1" ${paint('stop-color', deep)}/>
    </linearGradient>
    <linearGradient id="${weight}" x1="0" y1="-9" x2="0" y2="9" gradientUnits="userSpaceOnUse">
      <stop offset="0" ${paint('stop-color', 'color-mix(in srgb, var(--aluminio-oscuro), var(--carbon) 55%)')}/>
      <stop offset="0.35" ${paint('stop-color', 'var(--carbon-claro)')}/>
      <stop offset="1" ${paint('stop-color', 'var(--carbon)')}/>
    </linearGradient>
    <linearGradient id="${shell}" x1="0" y1="-8" x2="0" y2="4" gradientUnits="userSpaceOnUse">
      <stop offset="0" ${paint('stop-color', 'color-mix(in srgb, var(--aluminio-oscuro), var(--carbon) 60%)')}/>
      <stop offset="0.5" ${paint('stop-color', 'var(--carbon-claro)')}/>
      <stop offset="1" ${paint('stop-color', 'var(--carbon)')}/>
    </linearGradient>
    <radialGradient id="${gimbal}" cx="0.35" cy="0.3" r="0.8">
      <stop offset="0" ${paint('stop-color', 'var(--aluminio-claro)')}/>
      <stop offset="0.5" ${paint('stop-color', 'var(--aluminio)')}/>
      <stop offset="1" ${paint('stop-color', deep)}/>
    </radialGradient>
  </defs>
  <g class="tt-contrapeso">
    <rect x="-60" y="-9" width="24" height="18" rx="3" fill="url(#${weight})"/>
    <rect x="-60" y="-9" width="24" height="18" rx="3" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="0.6"/>
    <rect x="-53" y="-9" width="1.2" height="18" fill="rgba(255,255,255,0.14)"/>
    <rect x="-46" y="-9" width="1.2" height="18" fill="rgba(255,255,255,0.14)"/>
    <rect x="-39" y="-9" width="1.2" height="18" fill="rgba(255,255,255,0.1)"/>
  </g>
  <rect x="-38" y="-2.6" width="42" height="5.2" rx="2.2" fill="url(#${tube})"/>
  <circle cx="0" cy="0" r="10" fill="url(#${gimbal})"/>
  <circle cx="0" cy="0" r="4" ${paint('fill', 'var(--carbon-claro)')}/>
  <circle cx="0" cy="0" r="1.4" ${paint('fill', 'var(--aluminio-claro)')}/>
  <path d="M 8 0 C 95 0 135 -2 165 -8 S 198 -11.5 208 -9.5" fill="none" stroke="url(#${tube})" stroke-width="4.8" stroke-linecap="round"/>
  <path d="M 8 -1.2 C 95 -1.2 135 -3.2 165 -9.2 S 198 -12.7 208 -10.7" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="0.9" stroke-linecap="round"/>
  <g class="tt-cabezal-dibujo" transform="rotate(22 229 0)">
    <path d="M 205 -8 L 231 -8 L 233 -2 L 233 4 L 205 4 Z" fill="url(#${shell})"/>
    <path d="M 205 -8 L 231 -8" stroke="rgba(255,255,255,0.35)" stroke-width="0.7"/>
    <path d="M 207 -8 C 203.5 -12 199.5 -14.5 195 -13.5" fill="none" ${paint('stroke', 'var(--aluminio-claro)')} stroke-width="1.6" stroke-linecap="round"/>
    <rect x="212" y="-5" width="16" height="8" rx="1" ${paint('fill', 'var(--carbon)')}/>
    <rect x="214" y="-3.6" width="12" height="1.8" ${paint('fill', 'var(--rojo-emi)')}/>
    <circle cx="214.5" cy="1.4" r="0.7" ${paint('fill', 'var(--aluminio)')}/>
    <circle cx="225.5" cy="1.4" r="0.7" ${paint('fill', 'var(--aluminio)')}/>
    <line x1="223" y1="3" x2="229" y2="0.4" ${paint('stroke', 'var(--aluminio-claro)')} stroke-width="0.8"/>
    <circle cx="229" cy="0" r="1" ${paint('fill', 'var(--aluminio-claro)')}/>
  </g>
</svg>`;
}

function buildPlinth(): HTMLElement[] {
  return [
    h('div', 'tt-plinto', { 'aria-hidden': 'true' }),
    h('div', 'tt-pata tt-pata-izq', { 'aria-hidden': 'true' }),
    h('div', 'tt-pata tt-pata-der', { 'aria-hidden': 'true' }),
  ];
}

type PlatterParts = Pick<Dom, 'platter' | 'mat' | 'disc' | 'discCanvas' | 'discShadow' | 'shine' | 'adapter' | 'platterTouch'>;

function buildPlatter(): PlatterParts & { nodes: HTMLElement[] } {
  const hidden = { 'aria-hidden': 'true' } as const;
  const well = h('div', 'tt-circulo tt-plato-pozo', hidden);
  const platter = h('div', 'tt-circulo tt-plato', hidden, [h('div', 'tt-estrobo')]);
  const face = h('div', 'tt-circulo tt-plato-cara', hidden);
  const mat = h('div', 'tt-circulo tt-tapete', hidden, [h('span', 'tt-tapete-marca', {}, ['Tocadiscos'])]);
  const lamp = h('div', 'tt-circulo tt-estrobo-luz', hidden);
  const discShadow = h('div', 'tt-disco-sombra', { ...hidden, hidden: true });
  const discCanvas = h('canvas', 'tt-disco-canvas', hidden);
  const disc = h('div', 'tt-circulo tt-disco', { 'data-test': 'tt-disco', ...hidden, hidden: true }, [discCanvas]);
  const spindle = h('div', 'tt-eje', hidden);
  const adapter = h('div', 'tt-adaptador', { ...hidden, hidden: true });
  const shine = h('div', 'tt-circulo tt-brillo', { ...hidden, hidden: true });
  const platterTouch = h('div', 'tt-circulo tt-plato-toque', hidden);
  return {
    platter,
    mat,
    disc,
    discCanvas,
    discShadow,
    shine,
    adapter,
    platterTouch,
    nodes: [well, platter, face, mat, lamp, discShadow, disc, spindle, adapter, shine, platterTouch],
  };
}

function buildTonearm(id: string): Pick<Dom, 'arm' | 'headshell' | 'cue'> & { nodes: HTMLElement[] } {
  const pivot = h('div', 'tt-pivote', { 'aria-hidden': 'true' });
  const rest = h('div', 'tt-soporte', { 'aria-hidden': 'true' }, [h('div', 'tt-soporte-pinza')]);
  const arm = h('div', 'tt-brazo', {
    'data-test': 'tt-brazo',
    role: 'slider',
    tabindex: '0',
    'aria-label': 'Brazo del tocadiscos',
    'aria-orientation': 'horizontal',
    'aria-valuemin': String(MIN_RADIUS_MM),
    'aria-valuemax': String(MAX_RADIUS_MM),
    'aria-valuenow': String(REST_RADIUS_MM),
    'aria-valuetext': 'En el soporte',
  });
  arm.innerHTML = tonearmSvg(id);
  const headshell = h('div', 'tt-cabezal', { 'data-test': 'tt-cabezal', 'aria-hidden': 'true' });
  arm.append(headshell);
  const cue = button('tt-cue', 'tt-cue', 'Palanca de elevación del brazo', undefined, true);
  cue.append(h('span', 'tt-cue-base'), h('span', 'tt-cue-palanca'));
  return { arm, headshell, cue, nodes: [rest, pivot, arm, cue] };
}

type ControlParts = Pick<
  Dom,
  'power' | 'start' | 'speed' | 'pitch' | 'pitchReadout' | 'volume' | 'display' | 'displayTitle' | 'displaySide' | 'displayTime'
>;

function buildSpeedSelector(): { group: HTMLElement; speed: Record<Rpm, HTMLButtonElement> } {
  const row = h('div', 'tt-velocidad-botones');
  const speed = {} as Record<Rpm, HTMLButtonElement>;
  for (const rpm of RPMS) {
    const b = button('tt-boton tt-rpm', `tt-${rpm}`, `${rpm} rpm`, String(rpm), rpm === 33);
    b.prepend(h('span', 'tt-led'));
    speed[rpm] = b;
    row.append(b);
  }
  const group = h('div', 'tt-velocidad', { role: 'group', 'aria-label': 'Velocidad del plato' }, [
    row,
    h('span', 'tt-velocidad-etiqueta', { 'aria-hidden': 'true' }, ['rpm']),
  ]);
  return { group, speed };
}

function buildPitch(): { box: HTMLElement; pitch: HTMLInputElement; pitchReadout: HTMLElement } {
  const pitchReadout = h('output', 'tt-pitch-lectura', { 'aria-hidden': 'true' }, ['+0,0 %']);
  const pitch = h('input', 'tt-pitch', {
    type: 'range',
    min: '-8',
    max: '8',
    step: String(PITCH_STEP),
    value: '0',
    'data-test': 'tt-pitch',
    'aria-label': 'Ajuste fino de velocidad',
    'aria-valuetext': '+0,0 %',
  });
  const box = h('div', 'tt-pitch-caja', {}, [
    pitchReadout,
    h('span', 'tt-pitch-mas', { 'aria-hidden': 'true' }, ['+']),
    h('div', 'tt-pitch-escala', { 'aria-hidden': 'true' }),
    h('span', 'tt-pitch-menos', { 'aria-hidden': 'true' }, ['−']),
    h('div', 'tt-pitch-ranura', { 'aria-hidden': 'true' }),
    pitch,
  ]);
  return { box, pitch, pitchReadout };
}

function buildVolume(): { box: HTMLElement; volume: HTMLInputElement } {
  const volume = h('input', 'tt-volumen', {
    type: 'range',
    min: '0',
    max: '1',
    step: String(VOLUME_STEP),
    value: '0.85',
    'data-test': 'tt-volumen',
    'aria-label': 'Volumen',
  });
  const box = h('div', 'tt-volumen-caja', {}, [
    h('span', 'tt-volumen-etiqueta', { 'aria-hidden': 'true' }, ['Volumen']),
    h('div', 'tt-volumen-ranura', { 'aria-hidden': 'true' }),
    volume,
  ]);
  return { box, volume };
}

function buildControls(): ControlParts & { nodes: HTMLElement[] } {
  const power = button('tt-boton tt-encendido', 'tt-encendido', 'Encendido', undefined, true);
  power.append(h('span', 'tt-led'), h('span', 'tt-icono-encendido'));

  const start = button('tt-start', 'tt-start', 'Marcha y paro del plato', undefined, false);
  const startLabel = h('span', 'tt-start-etiqueta', { 'aria-hidden': 'true' }, ['Marcha']);
  const { group: speedGroup, speed } = buildSpeedSelector();
  const { box: pitchBox, pitch, pitchReadout } = buildPitch();
  const { box: volumeBox, volume } = buildVolume();

  const displayTitle = h('div', 'tt-pantalla-titulo', {}, ['Sin disco']);
  const displaySide = h('span', 'tt-pantalla-cara');
  const displayTime = h('span', 'tt-pantalla-tiempo');
  // Solo se anuncia el título: la línea del tiempo cambia cada segundo y no debe hablar.
  const display = h('div', 'tt-pantalla', { 'data-test': 'tt-pantalla', 'aria-live': 'polite', 'aria-atomic': 'false' }, [
    displayTitle,
    h('div', 'tt-pantalla-linea', { 'aria-live': 'off' }, [displaySide, displayTime]),
  ]);

  return {
    power,
    start,
    speed,
    pitch,
    pitchReadout,
    volume,
    display,
    displayTitle,
    displaySide,
    displayTime,
    nodes: [power, start, startLabel, speedGroup, display, volumeBox, pitchBox],
  };
}

function buildFront(): Pick<Dom, 'remove' | 'flip' | 'adapterToggle' | 'lidToggle' | 'brushToggle'> & { nodes: HTMLElement[] } {
  const remove = button('tt-boton tt-boton-frente', 'tt-quitar', 'Quitar disco del plato', 'Quitar disco');
  const flip = button('tt-boton tt-boton-frente', 'tt-voltear', 'Dar la vuelta al disco', 'Dar la vuelta');
  const adapterToggle = button('tt-boton tt-boton-frente', 'tt-centrador', 'Centrador de 45 rpm', 'Centrador', false);
  const lidToggle = button('tt-boton tt-boton-frente', 'tt-tapa', 'Tapa cerrada', 'Tapa', false);
  const brushToggle = button('tt-boton tt-boton-frente', 'tt-cepillo', 'Cepillo antipolvo', 'Cepillo', false);
  const front = h('div', 'tt-frente', {}, [
    h('span', 'tt-placa', { 'aria-hidden': 'true' }, ['Tocadiscos']),
    h('div', 'tt-frente-botones', {}, [remove, flip, adapterToggle, lidToggle, brushToggle]),
  ]);
  return { remove, flip, adapterToggle, lidToggle, brushToggle, nodes: [front] };
}

function buildLid(): Pick<Dom, 'lidBlocker' | 'brushSprite'> & { nodes: HTMLElement[] } {
  const lidBlocker = h('div', 'tt-tapa-bloqueo', { 'aria-hidden': 'true', hidden: true });
  const lidScene = h('div', 'tt-tapa-escena', { 'aria-hidden': 'true' }, [
    h('div', 'tt-bisagra tt-bisagra-izq'),
    h('div', 'tt-bisagra tt-bisagra-der'),
    h('div', 'tt-tapa-lamina', {}, [h('div', 'tt-tapa-reflejo'), h('div', 'tt-tapa-asa')]),
  ]);
  const brushSprite = h('div', 'tt-cepillo-sprite', { 'aria-hidden': 'true', hidden: true });
  return { lidBlocker, brushSprite, nodes: [lidBlocker, lidScene, brushSprite] };
}

/** Un punto del dibujo del brazo llevado a la caja de diseño con el brazo girado `angleDeg`. */
function armPointToStage(local: PointMm, angleDeg: number): PointMm {
  const a = angleDeg * DEG_TO_RAD;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: PIVOT_STAGE_MM.x + local.x * c - local.y * s, y: PIVOT_STAGE_MM.y + local.x * s + local.y * c };
}

/** Variables CSS (en mm) con las posiciones que dependen de la geometría del brazo. */
function applyLayoutVars(root: HTMLElement): void {
  const restAngle = armScreenAngleDeg(REST_RADIUS_MM);
  const restPost = armPointToStage(REST_POST_LOCAL_MM, restAngle);
  const vars: Record<string, number> = {
    '--tt-escala': DEFAULT_PX_PER_MM,
    '--tt-eje-x': SPINDLE_MM.x,
    '--tt-eje-y': SPINDLE_MM.y,
    '--tt-pivote-x': PIVOT_STAGE_MM.x,
    '--tt-pivote-y': PIVOT_STAGE_MM.y,
    '--tt-soporte-x': restPost.x,
    '--tt-soporte-y': restPost.y,
    '--tt-soporte-ang': restAngle,
    '--tt-cue-x': PIVOT_STAGE_MM.x + CUE_OFFSET_MM.x,
    '--tt-cue-y': PIVOT_STAGE_MM.y + CUE_OFFSET_MM.y,
    '--tt-disco-mm': 2 * PLATTER_RADIUS_MM,
  };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value.toFixed(4));
}

function buildDom(id: string): Dom {
  const plinth = buildPlinth();
  const platter = buildPlatter();
  const tonearm = buildTonearm(id);
  const controls = buildControls();
  const front = buildFront();
  const lid = buildLid();

  const stage = h('div', 'tt-escenario', {}, [
    ...plinth,
    ...front.nodes,
    ...platter.nodes,
    ...tonearm.nodes,
    ...controls.nodes,
    ...lid.nodes,
  ]);
  const root = h('section', 'tt tt-es-encendido tt-es-tapa-abierta tt-es-sin-disco tt-es-en-soporte tt-es-levantado', {
    'data-test': 'tt',
    'aria-label': 'Tocadiscos',
  });
  root.append(stage);
  applyLayoutVars(root);

  return {
    root,
    stage,
    platter: platter.platter,
    mat: platter.mat,
    disc: platter.disc,
    discCanvas: platter.discCanvas,
    discShadow: platter.discShadow,
    shine: platter.shine,
    adapter: platter.adapter,
    platterTouch: platter.platterTouch,
    arm: tonearm.arm,
    headshell: tonearm.headshell,
    cue: tonearm.cue,
    power: controls.power,
    start: controls.start,
    speed: controls.speed,
    pitch: controls.pitch,
    pitchReadout: controls.pitchReadout,
    volume: controls.volume,
    display: controls.display,
    displayTitle: controls.displayTitle,
    displaySide: controls.displaySide,
    displayTime: controls.displayTime,
    remove: front.remove,
    flip: front.flip,
    adapterToggle: front.adapterToggle,
    lidToggle: front.lidToggle,
    brushToggle: front.brushToggle,
    lidBlocker: lid.lidBlocker,
    brushSprite: lid.brushSprite,
  };
}

// ---------------------------------------------------------------------------
// Punteros → mm
// ---------------------------------------------------------------------------

/** Referencia para convertir coordenadas de puntero (px de cliente) a mm respecto al eje. */
interface SpindleRef {
  cx: number;
  cy: number;
  pxPerMm: number;
}

function toMm(ref: SpindleRef, ev: PointerEvent): PointMm {
  return { x: (ev.clientX - ref.cx) / ref.pxPerMm, y: (ev.clientY - ref.cy) / ref.pxPerMm };
}

// ---------------------------------------------------------------------------
// La vista
// ---------------------------------------------------------------------------

export function createTurntableView(actions: TurntableActions): TurntableView {
  instanceCounter += 1;
  const dom = buildDom(`tt${instanceCounter}`);
  const { root } = dom;

  let pxPerMm = DEFAULT_PX_PER_MM;
  let dpr = window.devicePixelRatio || 1;
  let measured = false;
  let currentFormat: Format | null = null;
  let lastCanvas: HTMLCanvasElement | null = null;
  let lastFrame: TurntableFrame | null = null;
  let reducedMotion = false;
  const resizeListeners = new Set<() => void>();
  const transforms = new Map<HTMLElement, string>();
  const classes = new Map<string, boolean>();

  function setTransform(el: HTMLElement, value: string): void {
    if (transforms.get(el) === value) return;
    transforms.set(el, value);
    el.style.transform = value;
  }

  function setClass(name: string, on: boolean): void {
    if (classes.get(name) === on) return;
    classes.set(name, on);
    root.classList.toggle(name, on);
  }

  function lidOpen(): boolean {
    return lastFrame?.state.lidOpen ?? true;
  }

  // ----- escala -----------------------------------------------------------
  function notifyResize(): void {
    for (const cb of Array.from(resizeListeners)) cb();
  }

  function discRadiusMm(): number {
    return currentFormat ? discGeometry(currentFormat).radiusMm : PLATTER_RADIUS_MM;
  }

  function applyDiscSize(): void {
    const radius = discRadiusMm();
    const css = `${(2 * radius * pxPerMm).toFixed(3)}px`;
    dom.discCanvas.style.width = css;
    dom.discCanvas.style.height = css;
    dom.shine.style.clipPath = `circle(${(radius * pxPerMm).toFixed(3)}px at 50% 50%)`;
    root.style.setProperty('--tt-disco-mm', String(2 * radius));
  }

  function applyScale(scale: number): void {
    if (!(scale > 0) || Math.abs(scale - pxPerMm) < 1e-4) return;
    pxPerMm = scale;
    root.style.setProperty('--tt-escala', scale.toFixed(5));
    applyDiscSize();
    notifyResize();
  }

  function measure(): void {
    const w = root.clientWidth;
    const hgt = root.clientHeight;
    if (!(w > 0)) return;
    measured = true;
    const byWidth = w / STAGE_MM.width;
    applyScale(hgt > 0 ? Math.min(byWidth, hgt / STAGE_MM.height) : byWidth);
  }

  let observer: ResizeObserver | null = null;
  const onWindowResize = (): void => measure();
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => measure());
    observer.observe(root);
  } else {
    window.addEventListener('resize', onWindowResize);
  }

  // Cambios de densidad de píxeles (zoom del navegador, cambio de pantalla).
  let dprQuery: MediaQueryList | null = null;
  const onDprChange = (): void => {
    const next = window.devicePixelRatio || 1;
    if (next !== dpr) {
      dpr = next;
      notifyResize();
    }
    watchDpr();
  };
  function watchDpr(): void {
    dprQuery?.removeEventListener('change', onDprChange);
    dprQuery = typeof window.matchMedia === 'function' ? window.matchMedia(`(resolution: ${dpr}dppx)`) : null;
    dprQuery?.addEventListener('change', onDprChange);
  }
  watchDpr();

  // Movimiento reducido: el bamboleo se anula (el plato sigue girando).
  const motionQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const onMotionChange = (): void => {
    reducedMotion = motionQuery?.matches === true;
    setClass('tt-es-movimiento-reducido', reducedMotion);
  };
  motionQuery?.addEventListener('change', onMotionChange);
  onMotionChange();

  function spindleRef(): SpindleRef {
    // La zona táctil del plato no gira: su caja es exactamente el círculo de 12".
    const rect = dom.platterTouch.getBoundingClientRect();
    const scale = rect.width > 0 ? rect.width / (2 * PLATTER_RADIUS_MM) : pxPerMm;
    return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, pxPerMm: scale };
  }

  function currentRadius(): number {
    const t = lastFrame?.state.tonearm;
    if (!t || t.onRest) return REST_RADIUS_MM;
    return clampRadius(t.radiusMm);
  }

  // ----- arrastre del cabezal ----------------------------------------------
  function wireTonearmDrag(): void {
    const { headshell, arm } = dom;
    let pointerId: number | null = null;
    let ref: SpindleRef | null = null;
    let grabOffset = 0;
    let lastRadius = REST_RADIUS_MM;

    function radiusAt(ev: PointerEvent): number {
      if (!ref) return lastRadius;
      const p = toMm(ref, ev);
      lastRadius = pointerToRadius(p.x, p.y, PIVOT_MM, grabOffset);
      return lastRadius;
    }

    function finish(radius: number): void {
      if (pointerId === null) return;
      const id = pointerId;
      pointerId = null;
      ref = null;
      releasePointer(headshell, id);
      setClass('tt-es-arrastrando', false);
      actions.moveTonearm(radius > REST_THRESHOLD_MM ? 'rest' : radius, false);
    }

    headshell.addEventListener('pointerdown', (ev) => {
      if (!isPrimaryButton(ev) || pointerId !== null || !lidOpen()) return;
      ev.preventDefault();
      ev.stopPropagation();
      pointerId = ev.pointerId;
      ref = spindleRef();
      capturePointer(headshell, ev.pointerId);
      arm.focus({ preventScroll: true });
      const start = currentRadius();
      const p = toMm(ref, ev);
      // El punto de agarre no es la aguja: se conserva el desfase para que el brazo no salte.
      grabOffset = pointerArmAngle(p.x, p.y, PIVOT_MM) - armAngleForRadius(start);
      lastRadius = start;
      setClass('tt-es-arrastrando', true);
      actions.moveTonearm(start, true);
    });
    headshell.addEventListener('pointermove', (ev) => {
      if (ev.pointerId !== pointerId) return;
      ev.preventDefault();
      actions.moveTonearm(radiusAt(ev), true);
    });
    headshell.addEventListener('pointerup', (ev) => {
      if (ev.pointerId === pointerId) finish(radiusAt(ev));
    });
    headshell.addEventListener('pointercancel', (ev) => {
      if (ev.pointerId === pointerId) finish(lastRadius);
    });
    headshell.addEventListener('lostpointercapture', (ev) => {
      if (ev.pointerId === pointerId) finish(lastRadius);
    });
  }

  // ----- mano sobre el plato (scratch) y cepillo ----------------------------
  function wirePlatterDrag(): { tick(now: number): void } {
    const { platterTouch, brushSprite, stage } = dom;
    let pointerId: number | null = null;
    let mode: 'scratch' | 'brush' = 'scratch';
    let ref: SpindleRef | null = null;
    let lastAngle = 0;
    let lastTime = 0;
    let lastX = 0;
    let lastY = 0;
    let travel = 0;
    let strokeStart = 0;
    let handIdle = false;
    const samples: number[] = [];

    function angleOf(ev: PointerEvent): number {
      if (!ref) return 0;
      return Math.atan2(ev.clientY - ref.cy, ev.clientX - ref.cx) / DEG_TO_RAD;
    }

    function overDisc(ev: PointerEvent): boolean {
      if (!ref || !hasDiscIn(lastFrame)) return false;
      const p = toMm(ref, ev);
      return Math.hypot(p.x, p.y) <= discRadiusMm();
    }

    function moveSprite(ev: PointerEvent): void {
      // El sprite se posiciona dentro del escenario, que puede estar centrado con márgenes en la raíz.
      const rect = stage.getBoundingClientRect();
      setTransform(brushSprite, `translate(${(ev.clientX - rect.left).toFixed(1)}px, ${(ev.clientY - rect.top).toFixed(1)}px)`);
    }

    function scratchMove(ev: PointerEvent): void {
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      if (dt <= 0) return;
      const angle = angleOf(ev);
      let delta = angle - lastAngle;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      samples.push(delta / dt);
      if (samples.length > SCRATCH_SAMPLES) samples.shift();
      const avg = samples.reduce((acc, v) => acc + v, 0) / samples.length;
      lastAngle = angle;
      lastTime = now;
      handIdle = false;
      actions.handPlatter(avg);
    }

    function brushMove(ev: PointerEvent): void {
      const now = performance.now();
      const seg = Math.hypot(ev.clientX - lastX, ev.clientY - lastY);
      lastX = ev.clientX;
      lastY = ev.clientY;
      moveSprite(ev);
      // Solo cuenta el recorrido sobre el disco: frotar el tapete no limpia nada.
      if (!overDisc(ev)) return;
      travel += seg;
      if (travel < BRUSH_STEP_PX) return;
      const elapsed = Math.max(1, now - strokeStart) / 1000;
      const strength = Math.min(1, Math.max(0, travel / elapsed / BRUSH_FULL_SPEED_PX_PER_SEC));
      const strokes = Math.min(BRUSH_MAX_STROKES_PER_EVENT, Math.floor(travel / BRUSH_STEP_PX));
      travel %= BRUSH_STEP_PX;
      strokeStart = now;
      for (let i = 0; i < strokes; i += 1) actions.brushStroke(strength);
    }

    function finish(): void {
      if (pointerId === null) return;
      const id = pointerId;
      pointerId = null;
      ref = null;
      releasePointer(platterTouch, id);
      setClass('tt-es-frotando', false);
      if (mode === 'scratch') actions.handPlatter(null);
    }

    platterTouch.addEventListener('pointerdown', (ev) => {
      if (!isPrimaryButton(ev) || pointerId !== null || !lidOpen()) return;
      ev.preventDefault();
      pointerId = ev.pointerId;
      mode = lastFrame?.tool === 'brush' ? 'brush' : 'scratch';
      ref = spindleRef();
      capturePointer(platterTouch, ev.pointerId);
      lastTime = performance.now();
      strokeStart = lastTime;
      lastAngle = angleOf(ev);
      lastX = ev.clientX;
      lastY = ev.clientY;
      travel = 0;
      samples.length = 0;
      handIdle = true;
      setClass('tt-es-frotando', true);
      if (mode === 'brush') moveSprite(ev);
      // Posar la mano sujeta el plato: velocidad 0 hasta que se mueva.
      else actions.handPlatter(0);
    });
    platterTouch.addEventListener('pointermove', (ev) => {
      if (ev.pointerId === pointerId) {
        ev.preventDefault();
        if (mode === 'brush') brushMove(ev);
        else scratchMove(ev);
        return;
      }
      if (pointerId === null) moveSprite(ev);
    });
    platterTouch.addEventListener('pointerenter', (ev) => {
      setClass('tt-es-sobre-plato', true);
      moveSprite(ev);
    });
    platterTouch.addEventListener('pointerleave', () => setClass('tt-es-sobre-plato', false));
    platterTouch.addEventListener('pointerup', (ev) => {
      if (ev.pointerId === pointerId) finish();
    });
    platterTouch.addEventListener('pointercancel', (ev) => {
      if (ev.pointerId === pointerId) finish();
    });
    platterTouch.addEventListener('lostpointercapture', (ev) => {
      if (ev.pointerId === pointerId) finish();
    });

    return {
      tick(now: number): void {
        if (pointerId === null || mode !== 'scratch' || handIdle) return;
        if (now - lastTime < HAND_IDLE_MS) return;
        handIdle = true;
        samples.length = 0;
        actions.handPlatter(0);
      },
    };
  }

  // ----- botones y deslizadores ----------------------------------------------
  function wireControls(): void {
    dom.start.addEventListener('click', () => actions.toggleMotor());
    dom.power.addEventListener('click', () => actions.powerToggle());
    for (const rpm of RPMS) dom.speed[rpm].addEventListener('click', () => actions.setSpeed(rpm));
    dom.cue.addEventListener('click', () => actions.setCue(!(lastFrame?.state.tonearm.lifted ?? true)));
    dom.pitch.addEventListener('input', () => actions.setPitch(Number(dom.pitch.value)));
    dom.volume.addEventListener('input', () => actions.setVolume(Number(dom.volume.value)));
    dom.remove.addEventListener('click', () => actions.removeDisc());
    dom.flip.addEventListener('click', () => actions.flipDisc());
    dom.adapterToggle.addEventListener('click', () => actions.toggleAdapter());
    dom.lidToggle.addEventListener('click', () => actions.toggleLid());
    dom.brushToggle.addEventListener('click', () => actions.setTool(lastFrame?.tool === 'brush' ? 'none' : 'brush'));
  }

  // ----- teclado --------------------------------------------------------------
  function stepTonearm(deltaMm: number): void {
    if (deltaMm < 0 && (lastFrame?.state.tonearm.onRest ?? true)) {
      // Desde el soporte, la primera pulsación lleva el cabezal al borde del disco (surco de
      // entrada). Restar unos milímetros a los 182 del soporte se quedaba por encima del umbral
      // de vuelta al soporte y el brazo no se movía.
      actions.moveTonearm(discGeometry(lastFrame?.discFormat ?? '12').outerGrooveMm, false);
      return;
    }
    const next = currentRadius() + deltaMm;
    actions.moveTonearm(next > REST_THRESHOLD_MM ? 'rest' : Math.max(MIN_RADIUS_MM, next), false);
  }

  function onArmKey(ev: KeyboardEvent): void {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    switch (ev.key) {
      case 'ArrowRight':
        stepTonearm(KEY_STEP_MM);
        break;
      case 'ArrowLeft':
        stepTonearm(-KEY_STEP_MM);
        break;
      case 'PageUp':
        stepTonearm(PAGE_STEP_MM);
        break;
      case 'PageDown':
        stepTonearm(-PAGE_STEP_MM);
        break;
      case 'ArrowUp':
        actions.setCue(true);
        break;
      case 'ArrowDown':
        actions.setCue(false);
        break;
      case 'Home':
        // Como en cualquier slider: Inicio lleva al valor mínimo (el surco interior)…
        actions.moveTonearm(MIN_RADIUS_MM, false);
        break;
      case 'End':
        // …y Fin al máximo (el soporte).
        actions.moveTonearm('rest', false);
        break;
      default:
        return;
    }
    ev.preventDefault();
  }

  const onDocumentKey = (ev: KeyboardEvent): void => {
    if (ev.key !== ' ' || ev.repeat || ev.defaultPrevented || !root.isConnected) return;
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (isFormControl(document.activeElement) || isFormControl(ev.target as Element | null)) return;
    // Con una capa modal abierta (el vinilo en la mano deja la escena `inert`) o el foco en
    // otro panel (el editor), la barra espaciadora no es para el tocadiscos.
    if (root.closest('[inert]')) return;
    if (document.activeElement?.closest('[role="dialog"], [role="tabpanel"], [role="tablist"]')) return;
    ev.preventDefault();
    actions.toggleMotor();
  };

  dom.arm.addEventListener('keydown', onArmKey);
  document.addEventListener('keydown', onDocumentKey);
  wireTonearmDrag();
  const platterDrag = wirePlatterDrag();
  wireControls();

  // ----- update ---------------------------------------------------------------
  function updateDisc(frame: TurntableFrame): void {
    const present = hasDiscIn(frame);
    if (frame.discFormat !== currentFormat) {
      currentFormat = frame.discFormat;
      applyDiscSize();
    }
    if (frame.discCanvas !== lastCanvas) {
      lastCanvas = frame.discCanvas;
      if (frame.discCanvas) blit(dom.discCanvas, frame.discCanvas);
    }
    setHidden(dom.disc, !present);
    setHidden(dom.discShadow, !present);
    setHidden(dom.shine, !present || !frame.fancy);
    setHidden(dom.adapter, !frame.state.adapter45);
    setClass('tt-es-sin-disco', !present);
  }

  function updatePlatter(frame: TurntableFrame): void {
    const deg = frame.platterAngleDeg;
    const rad = deg * DEG_TO_RAD;
    const rot = `rotate(${deg.toFixed(2)}deg)`;
    setTransform(dom.platter, rot);
    setTransform(dom.mat, rot);
    if (!hasDiscIn(frame)) return;

    const amp = reducedMotion ? 0 : 1;
    const orbit = frame.discHole === 'large' && !frame.state.adapter45;
    const wobble = Math.min(1, Math.max(0, frame.wobble || 0));
    let tx = 0;
    let ty = 0;
    let sy = 1;
    if (orbit) {
      const r = ORBIT_RADIUS_MM * pxPerMm * amp;
      tx = r * Math.cos(rad);
      ty = r * Math.sin(rad);
    } else {
      sy = 1 + 0.01 * wobble * amp * Math.sin(rad);
    }
    const shift = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px)`;
    setTransform(dom.disc, `${shift} scaleY(${sy.toFixed(4)}) ${rot}`);
    // El brillo no gira, pero acompaña al disco descentrado para que el recorte coincida con él.
    setTransform(dom.shine, shift);

    const sway = orbit ? 0 : SHADOW_WOBBLE_MM * wobble * amp * pxPerMm;
    const sx = DISC_SHADOW_MM.x * pxPerMm + tx + sway * Math.cos(rad);
    const syPx = DISC_SHADOW_MM.y * pxPerMm + ty + sway * Math.sin(rad);
    setTransform(dom.discShadow, `translate(${sx.toFixed(2)}px, ${syPx.toFixed(2)}px)`);
  }

  function updateTonearm(frame: TurntableFrame): void {
    const t = frame.state.tonearm;
    const radius = t.onRest ? REST_RADIUS_MM : clampRadius(t.radiusMm);
    setTransform(dom.arm, `rotate(${armScreenAngleDeg(radius).toFixed(3)}deg)`);
    setClass('tt-es-levantado', t.lifted);
    setClass('tt-es-en-soporte', t.onRest);
    setClass('tt-es-en-surco', frame.stylusInGroove);
    setAttr(dom.arm, 'aria-valuenow', String(Math.round(radius)));
    setAttr(dom.arm, 'aria-valuetext', describeTonearm(frame));
    setPressed(dom.cue, t.lifted);
  }

  function updateControls(frame: TurntableFrame): void {
    const s = frame.state;
    const present = hasDiscIn(frame);
    setPressed(dom.start, s.motor);
    setPressed(dom.power, s.power);
    for (const rpm of RPMS) setPressed(dom.speed[rpm], s.speed === rpm);
    const pitchText = formatPitch(s.pitchPercent);
    setRangeValue(dom.pitch, s.pitchPercent, PITCH_STEP);
    setAttr(dom.pitch, 'aria-valuetext', pitchText);
    setText(dom.pitchReadout, pitchText);
    setRangeValue(dom.volume, s.volume, VOLUME_STEP);
    setPressed(dom.adapterToggle, s.adapter45);
    setPressed(dom.lidToggle, !s.lidOpen);
    setPressed(dom.brushToggle, frame.tool === 'brush');
    setDisabled(dom.remove, !present);
    setDisabled(dom.flip, !present);
    setHidden(dom.lidBlocker, s.lidOpen);
    setHidden(dom.brushSprite, frame.tool !== 'brush');
    setClass('tt-es-encendido', s.power);
    setClass('tt-es-motor', s.motor);
    setClass('tt-es-tapa-abierta', s.lidOpen);
    setClass('tt-es-cepillo', frame.tool === 'brush');
    setClass('tt-es-brillo', frame.fancy);
    setClass('tt-es-girando', Math.abs(frame.actualRpm) > 0.5);
  }

  function updateDisplay(frame: TurntableFrame): void {
    if (!frame.state.power) {
      setText(dom.displayTitle, '');
      setText(dom.displaySide, '');
      setText(dom.displayTime, '');
      return;
    }
    const present = hasDiscIn(frame);
    const np = frame.nowPlaying;
    setText(dom.displayTitle, np ? `${np.artist} – ${np.title}` : present ? 'Sin canción' : 'Sin disco');
    setText(dom.displaySide, present ? (frame.sideName ?? '') : '');
    // Con el brazo en el soporte no hay posición que mostrar (antes salía «entrada», como si la
    // aguja estuviera en el surco de entrada).
    const time = !present ? '' : frame.state.tonearm.onRest ? 'brazo en reposo' : formatPosition(frame.positionSec, frame.sideDurationSec);
    setText(dom.displayTime, time);
  }

  function update(frame: TurntableFrame): void {
    if (!measured) measure();
    lastFrame = frame;
    updateDisc(frame);
    updatePlatter(frame);
    updateTonearm(frame);
    updateControls(frame);
    updateDisplay(frame);
    platterDrag.tick(performance.now());
  }

  function discSizePx(format: Format): number {
    return Math.max(1, Math.round(2 * discGeometry(format).radiusMm * pxPerMm * dpr));
  }

  function onResize(cb: () => void): () => void {
    resizeListeners.add(cb);
    return () => {
      resizeListeners.delete(cb);
    };
  }

  function destroy(): void {
    observer?.disconnect();
    window.removeEventListener('resize', onWindowResize);
    dprQuery?.removeEventListener('change', onDprChange);
    motionQuery?.removeEventListener('change', onMotionChange);
    document.removeEventListener('keydown', onDocumentKey);
    resizeListeners.clear();
    root.remove();
  }

  applyDiscSize();
  return { el: root, update, discSizePx, onResize, destroy };
}
