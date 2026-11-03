/**
 * Vista del tocadiscos (2.5D con DOM, SVG y CSS).
 *
 * CONTRATO (lo implementa el módulo de escena del tocadiscos):
 *  - `createTurntableView()` construye el elemento una vez; `update(frame)`
 *    se llama en cada frame de animación (~60 Hz) y debe ser barato: solo
 *    toca lo que cambia (transformaciones, clases, textos).
 *  - Partes visibles: base (plinto) de nogal con panel frontal, plato de
 *    aluminio con tapete de fieltro y marcas estroboscópicas en el canto,
 *    eje central, centrador de 45 rpm (si está puesto), el disco cargado
 *    (`discCanvas` dentro de un contenedor que gira con `platterAngleDeg`
 *    y oscila levemente con `wobble`), brillo de luz fijo sobre el disco,
 *    brazo con contrapeso, pivote, cabezal y aguja, soporte del brazo,
 *    palanca de elevación (cue), botón start/stop, selector 33/45/78,
 *    deslizador de pitch (−8…+8) con lectura, control de volumen, botón de
 *    encendido, tapa de metacrilato con bisagra (abierta/cerrada) y una
 *    pequeña pantalla de texto con la canción que suena y el tiempo.
 *  - Interacción (pointer events, también táctil):
 *      · arrastrar el cabezal del brazo → `moveTonearm(radioMm)`; soltarlo
 *        fuera del disco o sobre el soporte → `moveTonearm('rest')`;
 *      · clic en la palanca → `setCue(!lifted)`;
 *      · arrastrar el disco (no el brazo) → `handPlatter(°/s)` mientras se
 *        mueve y `handPlatter(null)` al soltar;
 *      · con `tool === 'brush'`, arrastrar sobre el disco → `brushStroke()`;
 *      · botones → `toggleMotor`, `setSpeed`, `setPitch`, `toggleLid`,
 *        `toggleAdapter`, `powerToggle`, `removeDisc`, `flipDisc`, `setTool`.
 *  - Correspondencia: el plato se dibuja a escala de 12" (radio 151 mm);
 *    la vista guarda su propio factor px/mm y lo usa para traducir la
 *    posición del puntero a radio bajo la aguja. La aguja está en la punta
 *    del cabezal; el brazo pivota en la esquina trasera derecha y describe
 *    un arco sobre el disco.
 *  - Accesibilidad: los botones son <button> reales con `aria-pressed`; el
 *    brazo y la palanca tienen atajos: barra espaciadora = start/stop,
 *    flechas ←/→ mueven el brazo 2 mm, ↑/↓ suben/bajan la aguja.
 *  - Estética: tokens de `styles/tokens.css`. Nada de bordes genéricos ni
 *    tarjetas: es un objeto, con sombra proyectada hacia abajo-derecha.
 */
import type { Format, HoleSize, Rpm, TurntableState } from '../core/types';

export interface TurntableFrame {
  state: TurntableState;
  platterAngleDeg: number;
  actualRpm: number;
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
}

export interface TurntableActions {
  toggleMotor(): void;
  setSpeed(speed: Rpm): void;
  setPitch(percent: number): void;
  setVolume(v: number): void;
  toggleLid(): void;
  toggleAdapter(): void;
  setCue(lifted: boolean): void;
  moveTonearm(target: number | 'rest'): void;
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
  destroy(): void;
}

export function createTurntableView(_actions: TurntableActions): TurntableView {
  throw new Error('createTurntableView: no implementado todavía');
}
