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
 *
 * IMPLEMENTACIÓN:
 *  - El DOM se construye una vez; `update()` delega en la estantería y la
 *    mano y solo cambia clases, atributos y el aviso cuando cambian.
 *  - Ajustes: popover propio (se abre con "Ajustes", se cierra con el mismo
 *    botón, con Esc o pulsando fuera); al abrirlo se avisa con
 *    `openSettings()`. La ayuda breve vive dentro del popover.
 *  - Esc: si el popover está abierto lo cierra; si no, `closeOverlays()`.
 *    Se respetan las teclas que otra vista ya atendió (`defaultPrevented`).
 *  - Aviso: se muestra al llegar un `ui.toast` nuevo (texto o `at`
 *    distintos) y se oculta `TOAST_MS` después de `toast.at` (milisegundos
 *    de `Date.now()`; también se acepta `performance.now()`). Un aviso
 *    que ya caducó al llegar no se muestra.
 *  - Con la mano abierta, el resto de la habitación queda `inert` (diálogo
 *    modal); el cajón del editor cerrado también.
 *  - Arrastrar archivos: solo cuando el arrastre lleva archivos y ninguna
 *    vista interior (p. ej. el editor) lo ha atendido ya. Si ninguno es de
 *    audio, se avisa en la propia zona de aviso.
 */
import type { AppState, Settings, UiState } from '../core/types';
import type { Renderers } from '../render';
import type { HandView } from './hand';
import type { ShelfView } from './shelf';
import './room.css';

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

/** Tiempo que permanece visible un aviso, contado desde `toast.at`. */
export const TOAST_MS = 2500;
/** Límites del deslizador de velocidad del polvo. */
export const DUST_SPEED_MIN = 0;
export const DUST_SPEED_MAX = 20;
/** Sin `dragover` durante este tiempo, el arrastre ha salido de la ventana. */
const DRAG_IDLE_MS = 180;

/** Extensiones de audio que se aceptan aunque el navegador no dé tipo MIME. */
export const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp3',
  'flac',
  'wav',
  'wave',
  'ogg',
  'oga',
  'opus',
  'm4a',
  'mp4',
  'aac',
  'webm',
  'weba',
  'aif',
  'aiff',
]);

/** Un archivo es de audio si su tipo es `audio/*` o su extensión es conocida. */
export function isAudioFile(file: { name: string; type: string }): boolean {
  if (file.type.toLowerCase().startsWith('audio/')) return true;
  const dot = file.name.lastIndexOf('.');
  return dot > 0 && AUDIO_EXTENSIONS.has(file.name.slice(dot + 1).toLowerCase());
}

/** Lectura del deslizador: "×1", "×2,5". */
export function formatDustSpeed(v: number): string {
  return `×${String(Number(v.toFixed(2))).replace('.', ',')}`;
}

/** Milisegundos que le quedan a un aviso emitido en `at` (0 si ya caducó). */
export function toastRemainingMs(at: number, nowMs = at > 1e11 ? Date.now() : performance.now()): number {
  const remaining = TOAST_MS - (nowMs - at);
  return Math.max(0, Math.min(TOAST_MS, remaining));
}

const HELP_LINES = [
  'Pulsa un lomo para sacar el vinilo; con la tecla E lo editas.',
  'Ponlo en el plato, arranca el motor y baja la aguja con la palanca o arrastrando el brazo.',
  'Arrastra los lomos para ordenarlos; suelta archivos de audio en la habitación para crear un vinilo.',
  'El polvo hace crepitar el disco: pásale el cepillo.',
];

const NOT_AUDIO_TEXT = 'Esos archivos no son de audio. Suelta MP3, FLAC, WAV, OGG o M4A.';

// ---------------------------------------------------------------------------
// Utilidades de DOM
// ---------------------------------------------------------------------------

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  attrs: Record<string, string> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  for (const child of children) el.append(child);
  return el;
}

function setAttr(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}

function setInert(el: HTMLElement, inert: boolean): void {
  if (el.hasAttribute('inert') !== inert) el.toggleAttribute('inert', inert);
}

function hasFiles(ev: DragEvent): boolean {
  const types = ev.dataTransfer?.types;
  return !!types && Array.from(types).includes('Files');
}

let instanceCounter = 0;

// ---------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------

export function createRoomView(parts: RoomParts): RoomView {
  const { turntableEl, shelf, hand, editorEl, actions } = parts;
  const uid = `hab-${++instanceCounter}`;

  // ----- barra superior y ajustes ---------------------------------------------
  const addButton = h('button', 'hab-boton hab-boton-anadir', { type: 'button', 'data-test': 'anadir-vinilo' }, ['Añadir vinilo']);
  const settingsButton = h(
    'button',
    'hab-boton',
    { type: 'button', 'data-test': 'ajustes', 'aria-expanded': 'false', 'aria-controls': `${uid}-ajustes` },
    ['Ajustes'],
  );

  const dustInput = h('input', 'hab-rango', {
    type: 'range',
    id: `${uid}-polvo`,
    min: String(DUST_SPEED_MIN),
    max: String(DUST_SPEED_MAX),
    step: '1',
    'data-test': 'ajustes-polvo',
  });
  const dustOutput = h('output', 'hab-lectura', { for: dustInput.id }, [formatDustSpeed(1)]);
  const fancyInput = h('input', 'hab-casilla', { type: 'checkbox', id: `${uid}-brillos`, 'data-test': 'ajustes-brillos' });
  const popover = h(
    'div',
    'hab-ajustes',
    { id: `${uid}-ajustes`, role: 'dialog', 'aria-labelledby': `${uid}-ajustes-titulo` },
    [
      h('h2', 'hab-ajustes-titulo', { id: `${uid}-ajustes-titulo` }, ['Ajustes']),
      h('div', 'hab-campo', {}, [
        h('div', 'hab-campo-cabecera', {}, [h('label', 'hab-etiqueta', { for: dustInput.id }, ['Velocidad del polvo']), dustOutput]),
        dustInput,
      ]),
      h('div', 'hab-campo hab-campo-casilla', {}, [fancyInput, h('label', 'hab-etiqueta', { for: fancyInput.id }, ['Brillos y polvo'])]),
      h('div', 'hab-ayuda', {}, [
        h('h3', 'hab-ayuda-titulo', {}, ['Cómo se usa']),
        h('ul', 'hab-ayuda-lista', {}, HELP_LINES.map((line) => h('li', '', {}, [line]))),
      ]),
    ],
  );
  popover.hidden = true;

  const bar = h('header', 'hab-barra', {}, [
    h('h1', 'hab-titulo', {}, ['Habitación de escucha']),
    h('div', 'hab-acciones', {}, [addButton, settingsButton]),
    popover,
  ]);

  // ----- escena ---------------------------------------------------------------
  const door = (): HTMLElement => h('div', 'hab-puerta', {}, [h('span', 'hab-tirador')]);
  const sideboard = h('div', 'hab-aparador', { 'aria-hidden': 'true' }, [
    h('div', 'hab-aparador-tapa'),
    h('div', 'hab-aparador-frente', {}, [door(), door()]),
    h('div', 'hab-aparador-patas', {}, [h('span', 'hab-pata'), h('span', 'hab-pata')]),
  ]);
  const turntableSlot = h('div', 'hab-tocadiscos', {}, [turntableEl]);
  const scene = h('main', 'hab-escena', {}, [
    h('div', 'hab-zona hab-zona-tocadiscos', {}, [turntableSlot, sideboard]),
    h('div', 'hab-zona hab-zona-estanteria', {}, [shelf.el]),
  ]);

  // ----- capas ----------------------------------------------------------------
  const drawer = h('aside', 'hab-cajon', { 'aria-label': 'Editor del vinilo' }, [editorEl]);
  const veil = h('div', 'hab-velo', { 'aria-hidden': 'true' });
  const handLayer = h('div', 'hab-capa-mano', {}, [veil, hand.el]);
  handLayer.hidden = true;
  const toastEl = h('div', 'hab-aviso', { 'data-test': 'aviso', role: 'status', 'aria-live': 'polite' });
  const dropTarget = h('div', 'hab-destino', { 'aria-hidden': 'true' }, [
    h('p', 'hab-destino-texto', {}, ['Suelta los archivos de audio para crear un vinilo nuevo']),
  ]);

  const root = h('div', 'hab', { 'data-test': 'habitacion' }, [
    h('div', 'hab-suelo', { 'aria-hidden': 'true' }),
    h('div', 'hab-rodapie', { 'aria-hidden': 'true' }),
    bar,
    scene,
    drawer,
    handLayer,
    toastEl,
    dropTarget,
  ]);

  // ----- estado de la vista -----------------------------------------------------
  let view: UiState['view'] | null = null;
  let toastKey: string | null = null;
  let toastFromState = false;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let dragTimer: ReturnType<typeof setTimeout> | null = null;

  // ----- vistas: mano y cajón ---------------------------------------------------

  function applyView(next: UiState['view']): void {
    if (next === view) return;
    view = next;
    const handOpen = next === 'hand';
    const editorOpen = next === 'editor';
    root.classList.toggle('hab-mano-abierta', handOpen);
    root.classList.toggle('hab-cajon-abierto', editorOpen);
    setHidden(handLayer, !handOpen);
    setInert(bar, handOpen);
    setInert(scene, handOpen);
    setInert(drawer, !editorOpen);
    setAttr(drawer, 'aria-hidden', editorOpen ? 'false' : 'true');
    if (handOpen) closeSettings(false);
  }

  // ----- ajustes ------------------------------------------------------------------

  function openSettings(): void {
    if (!popover.hidden) return;
    popover.hidden = false;
    setAttr(settingsButton, 'aria-expanded', 'true');
    actions.openSettings();
    dustInput.focus({ preventScroll: true });
  }

  function closeSettings(returnFocus: boolean): void {
    if (popover.hidden) return;
    const hadFocus = popover.contains(document.activeElement);
    popover.hidden = true;
    setAttr(settingsButton, 'aria-expanded', 'false');
    if (returnFocus && hadFocus) settingsButton.focus({ preventScroll: true });
  }

  function applySettings(settings: Settings): void {
    const speed = String(settings.dustSpeed);
    if (document.activeElement !== dustInput && dustInput.value !== speed) dustInput.value = speed;
    setText(dustOutput, formatDustSpeed(settings.dustSpeed));
    if (fancyInput.checked !== settings.fancyRendering) fancyInput.checked = settings.fancyRendering;
  }

  addButton.addEventListener('click', () => actions.addVinyl());
  settingsButton.addEventListener('click', () => (popover.hidden ? openSettings() : closeSettings(true)));
  dustInput.addEventListener('input', () => {
    const value = Number(dustInput.value);
    if (!Number.isFinite(value)) return;
    setText(dustOutput, formatDustSpeed(value));
    actions.setDustSpeed(value);
  });
  fancyInput.addEventListener('change', () => actions.setFancyRendering(fancyInput.checked));

  // ----- aviso ------------------------------------------------------------------

  function hideToast(): void {
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = null;
    toastEl.classList.remove('es-visible');
  }

  function showToast(text: string, durationMs: number, fromState: boolean): void {
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastFromState = fromState;
    setText(toastEl, text);
    toastEl.classList.add('es-visible');
    toastTimer = setTimeout(hideToast, durationMs);
  }

  function applyToast(toast: UiState['toast']): void {
    if (!toast) {
      // El aviso del estado se ha retirado: se oculta (los avisos propios siguen su curso).
      if (toastKey !== null && toastFromState) hideToast();
      toastKey = null;
      return;
    }
    const key = `${toast.at}|${toast.text}`;
    if (key === toastKey) return;
    toastKey = key;
    const remaining = toastRemainingMs(toast.at);
    if (remaining > 0) showToast(toast.text, remaining, true);
  }

  // ----- archivos arrastrados -----------------------------------------------------

  function setDropActive(active: boolean): void {
    root.classList.toggle('hab-soltando', active);
    if (dragTimer !== null) clearTimeout(dragTimer);
    dragTimer = active ? setTimeout(() => setDropActive(false), DRAG_IDLE_MS) : null;
  }

  root.addEventListener('dragover', (ev) => {
    if (!hasFiles(ev)) return;
    if (ev.defaultPrevented) {
      // Otra vista (el editor) atiende este arrastre.
      setDropActive(false);
      return;
    }
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    setDropActive(true);
  });
  root.addEventListener('dragleave', (ev) => {
    if (!(ev.relatedTarget instanceof Node) || !root.contains(ev.relatedTarget)) setDropActive(false);
  });
  root.addEventListener('drop', (ev) => {
    setDropActive(false);
    if (!hasFiles(ev) || ev.defaultPrevented) return;
    ev.preventDefault();
    const files = Array.from(ev.dataTransfer?.files ?? []);
    const audio = files.filter(isAudioFile);
    if (audio.length > 0) actions.dropAudioFiles(audio);
    else if (files.length > 0) showToast(NOT_AUDIO_TEXT, TOAST_MS, false);
  });

  // ----- teclado y clics fuera ------------------------------------------------------

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || ev.defaultPrevented || !root.isConnected) return;
    if (!popover.hidden) {
      ev.preventDefault();
      closeSettings(true);
      return;
    }
    actions.closeOverlays();
  });
  document.addEventListener('pointerdown', (ev) => {
    if (popover.hidden || !(ev.target instanceof Node)) return;
    if (popover.contains(ev.target) || settingsButton.contains(ev.target)) return;
    closeSettings(false);
  });
  veil.addEventListener('click', () => actions.closeOverlays());

  // ----- update -------------------------------------------------------------------

  function update(state: AppState, renderers: Renderers): void {
    applyView(state.ui.view);
    shelf.update(state, renderers);
    hand.update(state, renderers);
    applySettings(state.settings);
    applyToast(state.ui.toast);
  }

  // Estado inicial coherente antes del primer update (sin mano ni cajón).
  applyView('room');

  return { el: root, update };
}
