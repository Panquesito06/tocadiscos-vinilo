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
 *    mm), medida con ResizeObserver sobre el elemento raíz. Las posiciones
 *    derivadas de la geometría (eje, pivote, soporte, palanca) se pasan al
 *    CSS como variables en mm; el resto del trazado vive en turntable.css.
 *  - Vista cenital: el plinto se ve desde arriba con su cara frontal debajo
 *    (2.5D); todo lo que hay encima es cenital puro, así las circunferencias
 *    son círculos y el mapeo puntero → mm es directo.
 *  - La tapa cerrada bloquea los punteros sobre el plato y el brazo con un
 *    elemento invisible (`.tt-tapa-bloqueo`); la lámina de la tapa nunca
 *    recibe punteros, de modo que los controles siguen operativos.
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
  stylusPointForRadius,
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

/** Fracción del brazo en reposo (pivote → aguja) donde está el poste del soporte. */
const REST_POST_FRACTION = 0.92;

/** Posición de la palanca de elevación respecto al pivote (delante, fuera del barrido). */
const CUE_OFFSET_MM: Readonly<PointMm> = Object.freeze({ x: -12, y: 40 });

/** Escala provisional hasta que se mide el elemento (≈ 495 px de ancho). */
const DEFAULT_PX_PER_MM = 1.1;

/** Separación entre pasadas del cepillo, en px CSS de recorrido del puntero. */
const BRUSH_STEP_PX = 40;
/** Velocidad del gesto que cuenta como pasada de fuerza 1. */
const BRUSH_FULL_SPEED_PX_PER_SEC = 1000;
/** Muestras de la media móvil de la velocidad angular de la mano. */
const SCRATCH_SAMPLES = 3;

/** Desplazamiento base de la sombra del disco (luz desde arriba a la izquierda), en mm. */
const DISC_SHADOW_MM: Readonly<PointMm> = Object.freeze({ x: 1.2, y: 2.2 });
/** Vaivén de la sombra con el alabeo, en mm por unidad de wobble. */
const SHADOW_WOBBLE_MM = 2;

const RPMS: readonly Rpm[] = [33, 45, 78];
const DEG_TO_RAD = Math.PI / 180;

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

function setRangeValue(input: HTMLInputElement, value: string): void {
  if (input.value !== value) input.value = value;
}

function capturePointer(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Algunos entornos (tests) no implementan la captura: el arrastre sigue funcionando.
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
  if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
  return (el as HTMLElement).isContentEditable === true;
}

// ---------------------------------------------------------------------------
// Formato de textos
// ---------------------------------------------------------------------------

/** "m:ss" con los segundos redondeados hacia abajo. */
export function formatClock(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
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

function describeArm(frame: TurntableFrame): string {
  const t = frame.state.tonearm;
  if (t.onRest) return 'En el soporte';
  const parts: string[] = [frame.sideName ?? 'Sin disco'];
  if (frame.nowPlaying) parts.push(`canción ${frame.nowPlaying.trackIndex + 1}`);
  if (frame.discFormat) parts.push(formatPosition(frame.positionSec, frame.sideDurationSec));
  if (t.lifted) parts.push('aguja levantada');
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Construcción del DOM
// ---------------------------------------------------------------------------

interface Dom {
  root: HTMLElement;
  platter: HTMLElement;
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

/** Marcado SVG del brazo, en mm, con el pivote en (0, 0) y la aguja en (229, 0). */
function tonearmSvg(id: string): string {
  const tube = `${id}-tubo`;
  const weight = `${id}-peso`;
  const shell = `${id}-cabezal`;
  const gimbal = `${id}-gimbal`;
  return `
<svg class="tt-brazo-svg" viewBox="-72 -26 316 52" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="${tube}" x1="0" y1="-3" x2="0" y2="3" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f7f8f9"/><stop offset="0.45" stop-color="#b8bcc0"/><stop offset="1" stop-color="#5f6468"/>
    </linearGradient>
    <linearGradient id="${weight}" x1="0" y1="-10" x2="0" y2="10" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#4a4e52"/><stop offset="0.35" stop-color="#1f2224"/><stop offset="1" stop-color="#0c0d0e"/>
    </linearGradient>
    <linearGradient id="${shell}" x1="0" y1="-8" x2="0" y2="4" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#3a3d40"/><stop offset="0.5" stop-color="#17191b"/><stop offset="1" stop-color="#050506"/>
    </linearGradient>
    <radialGradient id="${gimbal}" cx="0.35" cy="0.3" r="0.8">
      <stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#b8bcc0"/><stop offset="1" stop-color="#5f6468"/>
    </radialGradient>
  </defs>
  <g class="tt-contrapeso">
    <rect x="-66" y="-10" width="30" height="20" rx="3" fill="url(#${weight})"/>
    <rect x="-66" y="-10" width="30" height="20" rx="3" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="0.6"/>
    <rect x="-58" y="-10" width="1.2" height="20" fill="rgba(255,255,255,0.14)"/>
    <rect x="-50" y="-10" width="1.2" height="20" fill="rgba(255,255,255,0.14)"/>
    <rect x="-42" y="-10" width="1.2" height="20" fill="rgba(255,255,255,0.14)"/>
  </g>
  <rect x="-38" y="-2.6" width="42" height="5.2" rx="2.2" fill="url(#${tube})"/>
  <circle cx="0" cy="0" r="10" fill="url(#${gimbal})"/>
  <circle cx="0" cy="0" r="4" fill="#2a2d30"/>
  <circle cx="0" cy="0" r="1.4" fill="#d9dcdf"/>
  <path d="M 8 0 C 95 0 135 -2 165 -8 S 198 -11.5 208 -9.5" fill="none" stroke="url(#${tube})" stroke-width="4.8" stroke-linecap="round"/>
  <path d="M 8 -1.2 C 95 -1.2 135 -3.2 165 -9.2 S 198 -12.7 208 -10.7" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="0.9" stroke-linecap="round"/>
  <g class="tt-cabezal-dibujo" transform="rotate(22 229 0)">
    <path d="M 205 -8 L 231 -8 L 233 -2 L 233 4 L 205 4 Z" fill="url(#${shell})"/>
    <path d="M 205 -8 L 231 -8" stroke="rgba(255,255,255,0.35)" stroke-width="0.7"/>
    <path d="M 207 -8 C 203.5 -12 199.5 -14.5 195 -13.5" fill="none" stroke="#d8dbde" stroke-width="1.6" stroke-linecap="round"/>
    <rect x="212" y="-5" width="16" height="8" rx="1" fill="#1b1d1f"/>
    <rect x="214" y="-3.6" width="12" height="1.8" fill="#d1302a"/>
    <line x1="223" y1="3" x2="229" y2="0.4" stroke="#e6e9eb" stroke-width="0.8"/>
    <circle cx="229" cy="0" r="1" fill="#ffffff"/>
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

function buildPlatter(): Pick<Dom, 'platter' | 'disc' | 'discCanvas' | 'discShadow' | 'shine' | 'adapter' | 'platterTouch'> & {
  nodes: HTMLElement[];
} {
  const well = h('div', 'tt-plato-pozo', { 'aria-hidden': 'true' });
  const platter = h('div', 'tt-plato', { 'aria-hidden': 'true' }, [h('div', 'tt-estrobo'), h('div', 'tt-tapete')]);
  const discShadow = h('div', 'tt-disco-sombra', { 'aria-hidden': 'true', hidden: true });
  const discCanvas = h('canvas', 'tt-disco-canvas', { 'aria-hidden': 'true' });
  const disc = h('div', 'tt-disco', { 'data-test': 'tt-disco', 'aria-hidden': 'true', hidden: true }, [discCanvas]);
  const spindle = h('div', 'tt-eje', { 'aria-hidden': 'true' });
  const adapter = h('div', 'tt-adaptador', { 'aria-hidden': 'true', hidden: true });
  const shine = h('div', 'tt-brillo', { 'aria-hidden': 'true', hidden: true });
  const platterTouch = h('div', 'tt-plato-toque', { 'aria-hidden': 'true' });
  return {
    platter,
    disc,
    discCanvas,
    discShadow,
    shine,
    adapter,
    platterTouch,
    nodes: [well, platter, discShadow, disc, spindle, adapter, shine, platterTouch],
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

function buildControls(): Pick<
  Dom,
  'power' | 'start' | 'speed' | 'pitch' | 'pitchReadout' | 'volume' | 'display' | 'displayTitle' | 'displaySide' | 'displayTime'
> & { nodes: HTMLElement[] } {
  const power = button('tt-boton tt-encendido', 'tt-encendido', 'Encendido', undefined, true);
  power.append(h('span', 'tt-led'), h('span', 'tt-icono-encendido'));

  const start = button('tt-start', 'tt-start', 'Marcha y paro del plato', undefined, false);
  const startLabel = h('span', 'tt-start-etiqueta', { 'aria-hidden': 'true' }, ['Marcha']);

  const speedGroup = h('div', 'tt-velocidad', { role: 'group', 'aria-label': 'Velocidad del plato' });
  const speed = {} as Record<Rpm, HTMLButtonElement>;
  for (const rpm of RPMS) {
    const b = button('tt-boton tt-rpm', `tt-${rpm}`, `${rpm} rpm`, String(rpm), rpm === 33);
    b.prepend(h('span', 'tt-led'));
    speed[rpm] = b;
    speedGroup.append(b);
  }
  speedGroup.append(h('span', 'tt-velocidad-etiqueta', { 'aria-hidden': 'true' }, ['rpm']));

  const pitchReadout = h('output', 'tt-pitch-lectura', { 'aria-hidden': 'true' }, ['+0,0 %']);
  const pitch = h('input', 'tt-pitch', {
    type: 'range',
    min: '-8',
    max: '8',
    step: '0.1',
    value: '0',
    'data-test': 'tt-pitch',
    'aria-label': 'Ajuste fino de velocidad',
    'aria-valuetext': '+0,0 %',
  });
  const pitchBox = h('div', 'tt-pitch-caja', {}, [
    pitchReadout,
    h('div', 'tt-pitch-escala', { 'aria-hidden': 'true' }, [h('span', 'tt-pitch-mas', {}, ['+']), h('span', 'tt-pitch-menos', {}, ['−'])]),
    h('div', 'tt-pitch-ranura', { 'aria-hidden': 'true' }),
    pitch,
  ]);

  const volume = h('input', 'tt-volumen', {
    type: 'range',
    min: '0',
    max: '1',
    step: '0.01',
    value: '0.85',
    'data-test': 'tt-volumen',
    'aria-label': 'Volumen',
  });
  const volumeBox = h('div', 'tt-volumen-caja', {}, [
    h('span', 'tt-volumen-etiqueta', { 'aria-hidden': 'true' }, ['Volumen']),
    h('div', 'tt-volumen-ranura', { 'aria-hidden': 'true' }),
    volume,
  ]);

  const displayTitle = h('div', 'tt-pantalla-titulo', {}, ['Sin disco']);
  const displaySide = h('span', 'tt-pantalla-cara');
  const displayTime = h('span', 'tt-pantalla-tiempo');
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
  const remove = button('tt-boton tt-boton-frente', 'tt-quitar', 'Quitar el disco del plato', 'Quitar disco');
  const flip = button('tt-boton tt-boton-frente', 'tt-voltear', 'Dar la vuelta al disco', 'Dar la vuelta');
  const adapterToggle = button('tt-boton tt-boton-frente', 'tt-centrador', 'Centrador de 45 rpm', 'Centrador', false);
  const lidToggle = button('tt-boton tt-boton-frente', 'tt-tapa', 'Cerrar o abrir la tapa', 'Tapa', false);
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

/** Variables CSS (en mm) con las posiciones que dependen de la geometría del brazo. */
function applyLayoutVars(root: HTMLElement): void {
  const pivot = { x: SPINDLE_MM.x + PIVOT_MM.x, y: SPINDLE_MM.y + PIVOT_MM.y };
  const stylusRest = stylusPointForRadius(REST_RADIUS_MM);
  const restPost = {
    x: pivot.x + REST_POST_FRACTION * (SPINDLE_MM.x + stylusRest.x - pivot.x),
    y: pivot.y + REST_POST_FRACTION * (SPINDLE_MM.y + stylusRest.y - pivot.y),
  };
  const vars: Record<string, number> = {
    '--tt-eje-x': SPINDLE_MM.x,
    '--tt-eje-y': SPINDLE_MM.y,
    '--tt-pivote-x': pivot.x,
    '--tt-pivote-y': pivot.y,
    '--tt-soporte-x': restPost.x,
    '--tt-soporte-y': restPost.y,
    '--tt-soporte-ang': armScreenAngleDeg(REST_RADIUS_MM),
    '--tt-cue-x': pivot.x + CUE_OFFSET_MM.x,
    '--tt-cue-y': pivot.y + CUE_OFFSET_MM.y,
    '--tt-disco-mm': 2 * PLATTER_RADIUS_MM,
  };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value.toFixed(3));
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
  const root = h('section', 'tt es-encendido es-tapa-abierta es-sin-disco es-en-soporte es-levantado', {
    'data-test': 'tt',
    'aria-label': 'Tocadiscos',
  });
  root.append(stage);
  applyLayoutVars(root);

  return {
    root,
    platter: platter.platter,
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
// La vista
// ---------------------------------------------------------------------------

/** Referencia para convertir coordenadas de puntero (px de cliente) a mm respecto al eje. */
interface SpindleRef {
  cx: number;
  cy: number;
  pxPerMm: number;
}

export function createTurntableView(actions: TurntableActions): TurntableView {
  instanceCounter += 1;
  const dom = buildDom(`tt${instanceCounter}`);
  const { root } = dom;

  // ----- escala -----------------------------------------------------------
  let pxPerMm = DEFAULT_PX_PER_MM;
  let dpr = window.devicePixelRatio || 1;
  let measured = false;
  let currentFormat: Format | null = null;
  const resizeListeners = new Set<() => void>();
  const transforms = new Map<HTMLElement, string>();
  let lastCanvas: HTMLCanvasElement | null = null;
  let lastFrame: TurntableFrame | null = null;
  let reducedMotion = false;

  function setTransform(el: HTMLElement, value: string): void {
    if (transforms.get(el) === value) return;
    transforms.set(el, value);
    el.style.transform = value;
  }

  function notifyResize(): void {
    for (const cb of Array.from(resizeListeners)) cb();
  }

  function applyDiscSize(): void {
    const radius = currentFormat ? discGeometry(currentFormat).radiusMm : PLATTER_RADIUS_MM;
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
    root.classList.toggle('es-movimiento-reducido', reducedMotion);
  };
  motionQuery?.addEventListener('change', onMotionChange);
  onMotionChange();

  // ----- punteros → mm ------------------------------------------------------
  function spindleRef(): SpindleRef {
    const rect = dom.platter.getBoundingClientRect();
    const scale = rect.width > 0 ? rect.width / (2 * PLATTER_RADIUS_MM) : pxPerMm;
    return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, pxPerMm: scale };
  }

  function toMm(ref: SpindleRef, ev: PointerEvent): PointMm {
    return { x: (ev.clientX - ref.cx) / ref.pxPerMm, y: (ev.clientY - ref.cy) / ref.pxPerMm };
  }

  function currentRadius(): number {
    const t = lastFrame?.state.tonearm;
    if (!t || t.onRest) return REST_RADIUS_MM;
    return clampRadius(t.radiusMm);
  }

  function hasDisc(): boolean {
    return lastFrame?.discCanvas != null && lastFrame.discFormat != null;
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
      releasePointer(headshell, pointerId);
      pointerId = null;
      ref = null;
      root.classList.remove('es-arrastrando');
      actions.moveTonearm(radius > REST_THRESHOLD_MM ? 'rest' : radius, false);
    }

    headshell.addEventListener('pointerdown', (ev) => {
      if (!isPrimaryButton(ev) || pointerId !== null) return;
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
      root.classList.add('es-arrastrando');
      actions.moveTonearm(start, true);
    });
    headshell.addEventListener('pointermove', (ev) => {
      if (ev.pointerId !== pointerId) return;
      ev.preventDefault();
      actions.moveTonearm(radiusAt(ev), true);
    });
    headshell.addEventListener('pointerup', (ev) => {
      if (ev.pointerId !== pointerId) return;
      finish(radiusAt(ev));
    });
    headshell.addEventListener('pointercancel', (ev) => {
      if (ev.pointerId !== pointerId) return;
      finish(lastRadius);
    });
    headshell.addEventListener('lostpointercapture', (ev) => {
      if (ev.pointerId !== pointerId) return;
      finish(lastRadius);
    });
  }

  // ----- mano sobre el plato (scratch) y cepillo ----------------------------
  function wirePlatterDrag(): void {
    const { platterTouch, brushSprite } = dom;
    let pointerId: number | null = null;
    let mode: 'scratch' | 'brush' = 'scratch';
    let ref: SpindleRef | null = null;
    let lastAngle = 0;
    let lastTime = 0;
    let lastX = 0;
    let lastY = 0;
    let travel = 0;
    const samples: number[] = [];

    function angleOf(ev: PointerEvent): number {
      if (!ref) return 0;
      return Math.atan2(ev.clientY - ref.cy, ev.clientX - ref.cx) / DEG_TO_RAD;
    }

    function moveSprite(ev: PointerEvent): void {
      const rect = root.getBoundingClientRect();
      setTransform(brushSprite, `translate(${(ev.clientX - rect.left).toFixed(1)}px, ${(ev.clientY - rect.top).toFixed(1)}px)`);
    }

    function scratchMove(ev: PointerEvent): void {
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      const angle = angleOf(ev);
      if (dt <= 0) return;
      let delta = angle - lastAngle;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      samples.push(delta / dt);
      if (samples.length > SCRATCH_SAMPLES) samples.shift();
      const avg = samples.reduce((acc, v) => acc + v, 0) / samples.length;
      lastAngle = angle;
      lastTime = now;
      actions.handPlatter(avg);
    }

    function brushMove(ev: PointerEvent): void {
      const now = performance.now();
      const dt = Math.max(1e-3, (now - lastTime) / 1000);
      const seg = Math.hypot(ev.clientX - lastX, ev.clientY - lastY);
      lastX = ev.clientX;
      lastY = ev.clientY;
      lastTime = now;
      moveSprite(ev);
      if (!hasDisc()) return;
      travel += seg;
      if (travel < BRUSH_STEP_PX) return;
      travel -= BRUSH_STEP_PX;
      const strength = Math.min(1, Math.max(0, seg / dt / BRUSH_FULL_SPEED_PX_PER_SEC));
      actions.brushStroke(strength);
    }

    function finish(): void {
      if (pointerId === null) return;
      releasePointer(platterTouch, pointerId);
      pointerId = null;
      ref = null;
      if (mode === 'scratch') actions.handPlatter(null);
      root.classList.remove('es-frotando');
    }

    platterTouch.addEventListener('pointerdown', (ev) => {
      if (!isPrimaryButton(ev) || pointerId !== null) return;
      ev.preventDefault();
      pointerId = ev.pointerId;
      mode = lastFrame?.tool === 'brush' ? 'brush' : 'scratch';
      ref = spindleRef();
      capturePointer(platterTouch, ev.pointerId);
      lastTime = performance.now();
      lastAngle = angleOf(ev);
      lastX = ev.clientX;
      lastY = ev.clientY;
      travel = 0;
      samples.length = 0;
      root.classList.add('es-frotando');
      if (mode === 'brush') moveSprite(ev);
      else actions.handPlatter(0);
    });
    platterTouch.addEventListener('pointermove', (ev) => {
      if (ev.pointerId === pointerId) {
        ev.preventDefault();
        if (mode === 'brush') brushMove(ev);
        else scratchMove(ev);
        return;
      }
      if (lastFrame?.tool === 'brush' && ev.pointerType === 'mouse') moveSprite(ev);
    });
    platterTouch.addEventListener('pointerenter', () => {
      if (lastFrame?.tool === 'brush') root.classList.add('es-sobre-plato');
    });
    platterTouch.addEventListener('pointerleave', () => root.classList.remove('es-sobre-plato'));
    platterTouch.addEventListener('pointerup', (ev) => {
      if (ev.pointerId === pointerId) finish();
    });
    platterTouch.addEventListener('pointercancel', (ev) => {
      if (ev.pointerId === pointerId) finish();
    });
    platterTouch.addEventListener('lostpointercapture', (ev) => {
      if (ev.pointerId === pointerId) finish();
    });
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
  function onArmKey(ev: KeyboardEvent): void {
    const r = currentRadius();
    switch (ev.key) {
      case 'ArrowRight': {
        const next = r + KEY_STEP_MM;
        actions.moveTonearm(next > REST_THRESHOLD_MM ? 'rest' : next, false);
        break;
      }
      case 'ArrowLeft':
        actions.moveTonearm(Math.max(MIN_RADIUS_MM, r - KEY_STEP_MM), false);
        break;
      case 'ArrowUp':
        actions.setCue(true);
        break;
      case 'ArrowDown':
        actions.setCue(false);
        break;
      case 'Home':
        actions.moveTonearm('rest', false);
        break;
      case 'End':
        actions.moveTonearm(MIN_RADIUS_MM, false);
        break;
      default:
        return;
    }
    ev.preventDefault();
  }

  const onDocumentKey = (ev: KeyboardEvent): void => {
    if (ev.key !== ' ' || ev.repeat || ev.defaultPrevented) return;
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (isFormControl(document.activeElement) || isFormControl(ev.target as Element | null)) return;
    ev.preventDefault();
    actions.toggleMotor();
  };

  dom.arm.addEventListener('keydown', onArmKey);
  document.addEventListener('keydown', onDocumentKey);
  wireTonearmDrag();
  wirePlatterDrag();
  wireControls();

  // ----- update ---------------------------------------------------------------
  function updateDisc(frame: TurntableFrame): void {
    const present = frame.discCanvas !== null && frame.discFormat !== null;
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
    root.classList.toggle('es-sin-disco', !present);
  }

  function updatePlatter(frame: TurntableFrame): void {
    const deg = frame.platterAngleDeg;
    const rad = deg * DEG_TO_RAD;
    const rot = `rotate(${deg.toFixed(2)}deg)`;
    setTransform(dom.platter, rot);
    if (frame.discCanvas === null || frame.discFormat === null) return;

    const amp = reducedMotion ? 0 : 1;
    const orbit = frame.discHole === 'large' && !frame.state.adapter45;
    let tx = 0;
    let ty = 0;
    let sy = 1;
    if (orbit) {
      const r = ORBIT_RADIUS_MM * pxPerMm * amp;
      tx = r * Math.cos(rad);
      ty = r * Math.sin(rad);
    } else {
      sy = 1 + 0.01 * frame.wobble * amp * Math.sin(rad);
    }
    setTransform(dom.disc, `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scaleY(${sy.toFixed(4)}) ${rot}`);

    const sway = orbit ? 0 : SHADOW_WOBBLE_MM * frame.wobble * amp * pxPerMm;
    const sx = DISC_SHADOW_MM.x * pxPerMm + tx + sway * Math.cos(rad);
    const syPx = DISC_SHADOW_MM.y * pxPerMm + ty + sway * Math.sin(rad);
    setTransform(dom.discShadow, `translate(${sx.toFixed(2)}px, ${syPx.toFixed(2)}px)`);
  }

  function updateTonearm(frame: TurntableFrame): void {
    const t = frame.state.tonearm;
    const radius = t.onRest ? REST_RADIUS_MM : clampRadius(t.radiusMm);
    setTransform(dom.arm, `rotate(${armScreenAngleDeg(radius).toFixed(3)}deg)`);
    root.classList.toggle('es-levantado', t.lifted);
    root.classList.toggle('es-en-soporte', t.onRest);
    root.classList.toggle('es-en-surco', frame.stylusInGroove);
    setAttr(dom.arm, 'aria-valuenow', String(Math.round(radius)));
    setAttr(dom.arm, 'aria-valuetext', describeArm(frame));
    setPressed(dom.cue, t.lifted);
  }

  function updateControls(frame: TurntableFrame): void {
    const s = frame.state;
    const present = frame.discCanvas !== null && frame.discFormat !== null;
    setPressed(dom.start, s.motor);
    setPressed(dom.power, s.power);
    for (const rpm of RPMS) setPressed(dom.speed[rpm], s.speed === rpm);
    const pitchText = formatPitch(s.pitchPercent);
    setRangeValue(dom.pitch, String(s.pitchPercent));
    setAttr(dom.pitch, 'aria-valuetext', pitchText);
    setText(dom.pitchReadout, pitchText);
    setRangeValue(dom.volume, s.volume.toFixed(2));
    setPressed(dom.adapterToggle, s.adapter45);
    setPressed(dom.lidToggle, !s.lidOpen);
    setPressed(dom.brushToggle, frame.tool === 'brush');
    setDisabled(dom.remove, !present);
    setDisabled(dom.flip, !present);
    setHidden(dom.lidBlocker, s.lidOpen);
    setHidden(dom.brushSprite, frame.tool !== 'brush');
    root.classList.toggle('es-encendido', s.power);
    root.classList.toggle('es-motor', s.motor);
    root.classList.toggle('es-tapa-abierta', s.lidOpen);
    root.classList.toggle('es-cepillo', frame.tool === 'brush');
    root.classList.toggle('es-brillo', frame.fancy);
    root.classList.toggle('es-girando', Math.abs(frame.actualRpm) > 0.5);
  }

  function updateDisplay(frame: TurntableFrame): void {
    const present = frame.discCanvas !== null && frame.discFormat !== null;
    if (!frame.state.power) {
      setText(dom.displayTitle, '');
      setText(dom.displaySide, '');
      setText(dom.displayTime, '');
      return;
    }
    const np = frame.nowPlaying;
    setText(dom.displayTitle, np ? `${np.artist} – ${np.title}` : present ? 'Sin canción' : 'Sin disco');
    setText(dom.displaySide, present ? (frame.sideName ?? '') : '');
    setText(dom.displayTime, present ? formatPosition(frame.positionSec, frame.sideDurationSec) : '');
  }

  function update(frame: TurntableFrame): void {
    if (!measured) measure();
    lastFrame = frame;
    updateDisc(frame);
    updatePlatter(frame);
    updateTonearm(frame);
    updateControls(frame);
    updateDisplay(frame);
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
