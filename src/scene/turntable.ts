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
 */
import type { Format, HoleSize, Rpm, TurntableState } from '../core/types';

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

export function createTurntableView(_actions: TurntableActions): TurntableView {
  throw new Error('createTurntableView: no implementado todavía');
}
