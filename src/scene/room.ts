/**
 * La habitación: compone pared, suelo, aparador con el tocadiscos,
 * estantería, cajas, la capa "en la mano", el cajón del editor y los avisos.
 *
 * CONTRATO (lo implementa el módulo de escena de la habitación):
 *  - Layout de escritorio: aparador con el tocadiscos a la izquierda
 *    (≈60 % de anchura), estantería a la derecha; en pantallas estrechas
 *    (<900 px) se apilan: tocadiscos arriba, estantería debajo con scroll.
 *  - Pared con empapelado (`--tapiz`, patrón sutil en CSS), rodapié, suelo
 *    de tarima con tablas, luz cálida desde arriba a la izquierda
 *    (sombras coherentes con `--luz-x/--luz-y`).
 *  - Barra superior mínima: nombre de la habitación, botón "Añadir vinilo",
 *    botón de ajustes (velocidad de polvo, brillos) y ayuda breve.
 *  - `ui.toast` se muestra 2,5 s en la parte inferior.
 *  - El editor (`editorEl`) es un cajón que entra por la derecha sobre la
 *    estantería cuando `ui.view === 'editor'`.
 *  - Soltar archivos de audio sobre la habitación → `dropAudioFiles(files)`
 *    (crea un vinilo nuevo con ellos).
 */
import type { AppState } from '../core/types';
import type { Renderers } from '../render';
import type { HandView } from './hand';
import type { ShelfView } from './shelf';

export interface RoomActions {
  addVinyl(): void;
  openSettings(): void;
  closeOverlays(): void;
  setDustSpeed(v: number): void;
  setFancyRendering(v: boolean): void;
  dropAudioFiles(files: File[]): void;
}

export interface RoomParts {
  turntableEl: HTMLElement;
  shelf: ShelfView;
  hand: HandView;
  editorEl: HTMLElement;
  actions: RoomActions;
}

export interface RoomView {
  readonly el: HTMLElement;
  update(state: AppState, renderers: Renderers): void;
}

export function createRoomView(_parts: RoomParts): RoomView {
  throw new Error('createRoomView: no implementado todavía');
}
