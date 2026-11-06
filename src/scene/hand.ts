/**
 * Vinilo en la mano: inspección del objeto completo.
 *
 * CONTRATO (lo implementa el módulo de escena de la habitación):
 *  - Capa centrada sobre la habitación (la habitación se oscurece detrás).
 *    El lado del objeto en px CSS es `S = min(56vh, 560px)` para un 12" y
 *    proporcional a `jacketSizeMm(format)` para 10" y 7" (56 % y no más
 *    para que, en una ventana de 800 px de alto, las dos filas de botones y
 *    la ficha del disco quepan sin desplazarse). Los canvases se
 *    piden en píxeles de dispositivo (× devicePixelRatio) y se copian con
 *    `blit()` en canvases propios. Muestra el vinilo según `ui.handStage`:
 *      · `jacket-front`: carpeta de frente con su funda exterior encima;
 *      · `jacket-back`: contraportada con la funda exterior;
 *      · `gatefold`: interior desplegado (solo si `jacket.gatefold`);
 *      · `inner-out`: la funda interior asomando por la derecha de la
 *        carpeta, con el disco debajo (mismo `sizePx` que la funda y
 *        centrados, para que el troquel deje ver la galleta);
 *      · `disc-out`: el disco fuera de la funda, cara `ui.handSide` hacia
 *        arriba (se puede voltear), con brillo fijo.
 *    Las transiciones entre etapas son deslizamientos cortos (`--dur-media`).
 *  - Controles (botones con texto): Girar, Abrir (si desplegable), Sacar
 *    funda, Sacar disco, Dar la vuelta, Limpiar (cepillo: arrastrar sobre
 *    el disco → `clean(fuerza)`), Poner en el plato (cara A / cara B),
 *    Editar, Guardar en la estantería. Esc = guardar. Atributos
 *    `data-test` de DESIGN.md §6.
 *  - Bajo el disco se muestra su estado (`describeCondition`) y datos:
 *    formato, peso, grosor, velocidad, reproducciones.
 *
 * IMPLEMENTACIÓN:
 *  - El DOM se construye una vez. Cada etapa es un valor de
 *    `data-etapa` en `.mano-objeto` y el CSS desliza y funde las capas
 *    (carpeta con dos caras que gira con rotateY, interior desplegable,
 *    funda con el disco debajo, disco suelto con dos caras y brillo fijo).
 *  - Solo se piden a la fachada de render los lienzos de la etapa visible,
 *    y cada lienzo propio se vuelve a copiar solo cuando cambia la
 *    referencia devuelta. El disco y la funda interior comparten `sizePx`
 *    (el diámetro del disco a la escala de la carpeta), así una sola
 *    versión del disco sirve para `inner-out` y `disc-out`.
 *  - En pantallas estrechas S también se limita al ancho disponible
 *    (`(ancho − 32) / 1,6`, lo que ocupa la funda asomando) y el interior
 *    desplegable se escala para caber; en escritorio rige S del contrato.
 *  - Los botones que alternan cambian su texto ("Sacar funda" ↔ "Meter
 *    funda", "Sacar disco" ↔ "Meter disco", "Abrir" ↔ "Cerrar");
 *    "Limpiar" es un interruptor con `aria-pressed`. Los que no tienen
 *    sentido en la etapa actual quedan desactivados.
 *  - Mientras se cepilla, el lienzo del disco (que cambia con el polvo) se
 *    vuelve a pedir como mucho cada `DISC_REFRESH_WHILE_BRUSHING_MS`.
 *  - Al cerrar la mano se liberan los lienzos propios (memoria).
 */
import { findVinyl, sideOf } from '../core/defaults';
import { discGeometry, jacketSizeMm } from '../core/geometry';
import { describeCondition } from '../core/physics';
import type { AppState, Format, HandStage, Rpm, SideId, Vinyl } from '../core/types';
import { blit, type Renderers } from '../render';
import './hand.css';

export interface HandActions {
  setStage(stage: HandStage): void;
  flipDisc(): void;
  putOnTurntable(side: SideId): void;
  backToShelf(): void;
  edit(): void;
  clean(strength: number): void;
}

export interface HandView {
  readonly el: HTMLElement;
  update(state: AppState, renderers: Renderers): void;
}

/** Lado máximo de la carpeta de 12" en px CSS. */
export const HAND_MAX_SIDE_PX = 560;
/** Fracción de la altura de la ventana que puede ocupar la carpeta de 12". */
export const HAND_VIEWPORT_FRACTION = 0.56;
/** Lado mínimo, para que en ventanas diminutas el objeto siga siendo reconocible. */
export const HAND_MIN_SIDE_PX = 160;
/** Ancho de la composición con la funda asomando, en lados de carpeta. */
export const HAND_SPAN_SIDES = 1.6;
/** Margen horizontal total que se deja libre en pantallas estrechas. */
export const HAND_SIDE_MARGIN_PX = 32;
/** Recorrido del cepillo (px) por cada pasada que se envía a `clean()`. */
export const BRUSH_STEP_PX = 40;
/** Polvo a partir del cual se aconseja cepillar antes de poner el disco. */
export const DUST_WARNING_LEVEL = 0.3;
/** Intervalo mínimo entre redibujos del disco mientras se cepilla. */
export const DISC_REFRESH_WHILE_BRUSHING_MS = 120;

export interface HandSizes {
  /** Lado de la carpeta (y de la funda exterior) en px CSS. */
  jacketPx: number;
  /** Diámetro del disco (y lado de la funda interior) en px CSS. */
  discPx: number;
  /** Escala del interior desplegable (doble ancho) para que quepa en la ventana. */
  gatefoldScale: number;
}

/** Medidas del objeto en la mano para una ventana de `viewportW × viewportH` px CSS. */
export function handSizes(format: Format, viewportW: number, viewportH: number): HandSizes {
  const vw = Number.isFinite(viewportW) && viewportW > 0 ? viewportW : 1280;
  const vh = Number.isFinite(viewportH) && viewportH > 0 ? viewportH : 800;
  const room = Math.max(1, vw - HAND_SIDE_MARGIN_PX);
  const twelve = Math.max(HAND_MIN_SIDE_PX, Math.min(HAND_MAX_SIDE_PX, HAND_VIEWPORT_FRACTION * vh, room / HAND_SPAN_SIDES));
  const jacketMm = jacketSizeMm(format);
  const jacketPx = Math.round((twelve * jacketMm) / jacketSizeMm('12'));
  const discPx = Math.round((jacketPx * 2 * discGeometry(format).radiusMm) / jacketMm);
  const gatefoldScale = Math.min(1, room / (2 * jacketPx));
  return { jacketPx, discPx, gatefoldScale };
}

/**
 * Fuerza (0,2..1) de una pasada de cepillo de `distancePx` hecha en
 * `elapsedMs`: cuanto más rápido el gesto, más polvo quita.
 */
export function brushStrength(distancePx: number, elapsedMs: number): number {
  const speed = Math.max(0, distancePx) / Math.max(1, elapsedMs);
  return Math.min(1, Math.max(0.2, 0.25 + 0.5 * speed));
}

/** Etapa que se puede mostrar: el interior desplegable solo existe en carpetas desplegables. */
export function visibleStage(stage: HandStage, vinyl: Vinyl): HandStage {
  return stage === 'gatefold' && !vinyl.jacket.gatefold ? 'jacket-front' : stage;
}

const FORMAT_TEXT: Record<Format, string> = { '12': '12 pulgadas', '10': '10 pulgadas', '7': '7 pulgadas' };
const RPM_TEXT: Record<Rpm, string> = { 33: '33⅓ rpm', 45: '45 rpm', 78: '78 rpm' };

function decimal(value: number): string {
  return String(Number(value.toFixed(2))).replace('.', ',');
}

function putLabel(vinyl: Vinyl, side: SideId): string {
  const base = `Poner en el plato: cara ${side}`;
  return sideOf(vinyl, side).decorative ? `${base} (decorativa)` : base;
}

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

function setDisabled(el: HTMLButtonElement, disabled: boolean): void {
  if (el.disabled !== disabled) el.disabled = disabled;
}

function setVar(el: HTMLElement, name: string, value: string): void {
  if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
}

function pixelRatio(): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Lienzo propio de la vista con la referencia del lienzo compartido que tiene copiado. */
interface CanvasSlot {
  canvas: HTMLCanvasElement;
  source: HTMLCanvasElement | null;
}

function slot(className: string): CanvasSlot {
  return { canvas: h('canvas', className, { 'aria-hidden': 'true' }), source: null };
}

/** Copia `source` si cambió la referencia, fija el tamaño CSS y oculta el lienzo si no hay fuente. */
function paintSlot(s: CanvasSlot, source: HTMLCanvasElement | null, widthPx: number, heightPx: number): void {
  if (source !== s.source) {
    if (source) blit(s.canvas, source);
    s.source = source;
  }
  setHidden(s.canvas, source === null);
  const w = `${widthPx}px`;
  const hgt = `${heightPx}px`;
  if (s.canvas.style.width !== w) s.canvas.style.width = w;
  if (s.canvas.style.height !== hgt) s.canvas.style.height = hgt;
}

/** Libera la memoria de un lienzo propio. */
function clearSlot(s: CanvasSlot): void {
  s.source = null;
  s.canvas.width = 0;
  s.canvas.height = 0;
}

let instanceCounter = 0;

// ---------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------

export function createHandView(actions: HandActions): HandView {
  const uid = `mano-${++instanceCounter}`;

  // ----- objeto ---------------------------------------------------------------
  const front = slot('mano-lienzo');
  const frontOuter = slot('mano-lienzo mano-funda-exterior');
  const back = slot('mano-lienzo');
  const backOuter = slot('mano-lienzo mano-funda-exterior mano-funda-exterior-dorso');
  const gatefold = slot('mano-lienzo');
  const sleeveDisc = slot('mano-lienzo mano-funda-disco');
  const sleevePaper = slot('mano-lienzo mano-funda-papel');
  const discA = slot('mano-lienzo');
  const discB = slot('mano-lienzo');
  const slots = [front, frontOuter, back, backOuter, gatefold, sleeveDisc, sleevePaper, discA, discB];

  const carpeta = h('div', 'mano-capa mano-carpeta', {}, [
    h('div', 'mano-carpeta-giro', {}, [
      h('div', 'mano-cara mano-frente', {}, [front.canvas, frontOuter.canvas]),
      h('div', 'mano-cara mano-dorso', {}, [back.canvas, backOuter.canvas]),
    ]),
  ]);
  const desplegable = h('div', 'mano-capa mano-desplegable', {}, [gatefold.canvas]);
  const funda = h('div', 'mano-capa mano-funda', {}, [sleeveDisc.canvas, sleevePaper.canvas]);
  const brillo = h('div', 'mano-brillo', { 'aria-hidden': 'true' });
  const disco = h('div', 'mano-capa mano-disco', { 'data-test': 'mano-disco', role: 'img' }, [
    h('div', 'mano-disco-giro', {}, [
      h('div', 'mano-disco-cara mano-disco-a', {}, [discA.canvas]),
      h('div', 'mano-disco-cara mano-disco-b', {}, [discB.canvas]),
    ]),
    brillo,
  ]);
  const objeto = h('div', 'mano-objeto', { 'data-etapa': 'jacket-front', 'data-cara': 'A' }, [funda, carpeta, desplegable, disco]);
  const escenario = h('div', 'mano-escenario', {}, [objeto]);

  // ----- controles --------------------------------------------------------------
  const button = (test: string, text: string, extra = ''): HTMLButtonElement =>
    h('button', `mano-boton ${extra}`.trim(), { type: 'button', 'data-test': test }, [text]);
  const b = {
    turn: button('mano-girar', 'Girar'),
    open: button('mano-abrir', 'Abrir'),
    sleeve: button('mano-sacar-funda', 'Sacar funda'),
    disc: button('mano-sacar-disco', 'Sacar disco'),
    flip: button('mano-voltear', 'Dar la vuelta'),
    clean: button('mano-limpiar', 'Limpiar'),
    putA: button('mano-poner-a', 'Poner en el plato: cara A', 'mano-boton-principal'),
    putB: button('mano-poner-b', 'Poner en el plato: cara B', 'mano-boton-principal'),
    edit: button('mano-editar', 'Editar'),
    save: button('mano-guardar', 'Guardar en la estantería', 'mano-boton-guardar'),
  };
  setAttr(b.clean, 'aria-pressed', 'false');
  const hint = h('p', 'mano-pista', {}, ['Arrastra sobre el disco para pasar el cepillo.']);
  hint.hidden = true;
  const controles = h('div', 'mano-controles', {}, [
    h('div', 'mano-grupo', { role: 'group', 'aria-label': 'Mirar el vinilo' }, [b.turn, b.open, b.sleeve, b.disc, b.flip, b.clean]),
    h('div', 'mano-grupo', { role: 'group', 'aria-label': 'Qué hacer con el vinilo' }, [b.putA, b.putB, b.edit, b.save]),
    hint,
  ]);

  // ----- datos ------------------------------------------------------------------
  const title = h('h2', 'mano-titulo', { id: `${uid}-titulo` });
  const artist = h('p', 'mano-artista');
  const fact = (): HTMLElement => h('dd', 'mano-dato');
  const facts = { format: fact(), weight: fact(), speed: fact(), plays: fact(), state: fact() };
  const pair = (label: string, value: HTMLElement): HTMLElement => h('div', 'mano-par', {}, [h('dt', 'mano-etiqueta', {}, [label]), value]);
  const dustWarning = h('p', 'mano-aviso-polvo', {}, ['Pasa el cepillo antes de ponerlo']);
  dustWarning.hidden = true;
  const datos = h('div', 'mano-datos', {}, [
    h('div', 'mano-nombre', {}, [title, artist]),
    h('dl', 'mano-ficha', {}, [
      pair('Formato', facts.format),
      pair('Peso y grosor', facts.weight),
      pair('Velocidad', facts.speed),
      pair('Reproducciones', facts.plays),
      pair('Estado', facts.state),
    ]),
    dustWarning,
  ]);

  const root = h(
    'div',
    'mano',
    { 'data-test': 'mano', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': title.id, tabindex: '-1' },
    [escenario, h('div', 'mano-panel', {}, [controles, datos])],
  );

  // ----- estado de la vista -----------------------------------------------------
  let activeId: string | null = null;
  let lastState: AppState | null = null;
  let lastRenderers: Renderers | null = null;
  let lastViewport = '';
  let dirty = true;
  let stage: HandStage = 'jacket-front';
  let brush = false;
  let stroke: { pointerId: number; x: number; y: number; dist: number; t: number } | null = null;
  let lastDiscPaint = 0;
  let trailingTimer: ReturnType<typeof setTimeout> | null = null;

  function rerun(): void {
    dirty = true;
    if (lastState && lastRenderers) update(lastState, lastRenderers);
  }

  function setBrush(on: boolean): void {
    if (brush === on) return;
    brush = on;
    if (!on) endStroke();
    root.classList.toggle('mano-con-cepillo', on);
    setAttr(b.clean, 'aria-pressed', on ? 'true' : 'false');
    setHidden(hint, !on);
  }

  function activate(vinyl: Vinyl): void {
    activeId = vinyl.id;
    for (const s of slots) clearSlot(s);
    setBrush(false);
    // Al abrir, el objeto aparece ya en su etapa, sin animar desde la anterior.
    root.classList.add('mano-sin-transicion');
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: FrameRequestCallback) => setTimeout(() => cb(now()), 16);
    raf(() =>
      raf(() => {
        root.classList.remove('mano-sin-transicion');
        if (activeId && root.isConnected && !root.contains(document.activeElement)) root.focus({ preventScroll: true });
      }),
    );
  }

  function deactivate(): void {
    if (activeId === null) return;
    activeId = null;
    setBrush(false);
    if (trailingTimer !== null) clearTimeout(trailingTimer);
    trailingTimer = null;
    for (const s of slots) clearSlot(s);
  }

  // ----- pintado ----------------------------------------------------------------

  function applyLayout(side: SideId, sizes: HandSizes, fancy: boolean): void {
    setAttr(objeto, 'data-etapa', stage);
    setAttr(objeto, 'data-cara', side);
    setVar(root, '--mano-lado', `${sizes.jacketPx}px`);
    setVar(root, '--mano-disco', `${sizes.discPx}px`);
    setVar(root, '--mano-escala-desplegable', sizes.gatefoldScale.toFixed(4));
    setHidden(brillo, !fancy);
  }

  function paintDisc(target: CanvasSlot, request: () => HTMLCanvasElement, sizePx: number): void {
    const t = now();
    if (stroke && target.source && t - lastDiscPaint < DISC_REFRESH_WHILE_BRUSHING_MS) {
      if (trailingTimer === null) {
        trailingTimer = setTimeout(() => {
          trailingTimer = null;
          rerun();
        }, DISC_REFRESH_WHILE_BRUSHING_MS);
      }
      return;
    }
    lastDiscPaint = t;
    paintSlot(target, request(), sizePx, sizePx);
  }

  function applyCanvases(vinyl: Vinyl, side: SideId, sizes: HandSizes, fancy: boolean, renderers: Renderers): void {
    const dpr = pixelRatio();
    const J = sizes.jacketPx;
    const D = sizes.discPx;
    const jacketDev = Math.round(J * dpr);
    const discDev = Math.round(D * dpr);
    const discCanvas = (): HTMLCanvasElement =>
      renderers.disc(vinyl, { sizePx: discDev, side, showDust: fancy, adapter45: false, spindle: false, quality: 'high' });

    if (stage === 'jacket-front' || stage === 'jacket-back' || stage === 'inner-out') {
      paintSlot(front, renderers.jacketFront(vinyl, jacketDev), J, J);
    }
    if (stage === 'jacket-front' || stage === 'jacket-back') {
      const outer = renderers.outerSleeve(vinyl, jacketDev);
      paintSlot(frontOuter, outer, J, J);
      paintSlot(backOuter, outer, J, J);
    }
    if (stage === 'jacket-back') paintSlot(back, renderers.jacketBack(vinyl, jacketDev), J, J);
    if (stage === 'gatefold') paintSlot(gatefold, renderers.gatefold(vinyl, jacketDev), 2 * J, J);
    if (stage === 'inner-out') {
      paintSlot(sleeveDisc, discCanvas(), D, D);
      paintSlot(sleevePaper, renderers.innerSleeve(vinyl, discDev, 'front'), D, D);
    }
    if (stage === 'disc-out') paintDisc(side === 'A' ? discA : discB, discCanvas, D);
  }

  function applyControls(vinyl: Vinyl): void {
    const jacketStage = stage === 'jacket-front' || stage === 'jacket-back';
    const sleeveOut = stage === 'inner-out' || stage === 'disc-out';
    setDisabled(b.turn, !jacketStage);
    setHidden(b.open, !vinyl.jacket.gatefold);
    setDisabled(b.open, sleeveOut);
    setText(b.open, stage === 'gatefold' ? 'Cerrar' : 'Abrir');
    setText(b.sleeve, sleeveOut ? 'Meter funda' : 'Sacar funda');
    setText(b.disc, stage === 'disc-out' ? 'Meter disco' : 'Sacar disco');
    setDisabled(b.flip, !sleeveOut);
    setDisabled(b.clean, stage !== 'disc-out');
    setText(b.putA, putLabel(vinyl, 'A'));
    setText(b.putB, putLabel(vinyl, 'B'));
  }

  function applyFacts(vinyl: Vinyl, side: SideId): void {
    const { disc, meta } = vinyl;
    const cond = disc.condition;
    setText(title, meta.title.trim() || 'Sin título');
    setText(artist, meta.artist.trim() || 'Artista desconocido');
    setText(facts.format, FORMAT_TEXT[disc.format]);
    setText(facts.weight, `${disc.weightGrams} g, ${decimal(disc.thicknessMm)} mm`);
    setText(facts.speed, RPM_TEXT[disc.nativeRpm]);
    setText(facts.plays, String(cond.plays));
    setText(facts.state, describeCondition(cond));
    setHidden(dustWarning, !(cond.dust > DUST_WARNING_LEVEL));
    setAttr(disco, 'aria-label', `Disco, cara ${side} hacia arriba`);
  }

  function update(state: AppState, renderers: Renderers): void {
    const viewport = typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}x${pixelRatio()}` : '';
    if (!dirty && state === lastState && renderers === lastRenderers && viewport === lastViewport) return;
    dirty = false;
    lastState = state;
    lastRenderers = renderers;
    lastViewport = viewport;

    const vinyl = state.ui.view === 'hand' ? findVinyl(state, state.ui.handVinylId) : null;
    if (!vinyl) {
      deactivate();
      return;
    }
    if (vinyl.id !== activeId) activate(vinyl);
    stage = visibleStage(state.ui.handStage, vinyl);
    if (brush && stage !== 'disc-out') setBrush(false);
    const side = state.ui.handSide;
    const fancy = state.settings.fancyRendering;
    const sizes = handSizes(vinyl.disc.format, window.innerWidth, window.innerHeight);
    applyLayout(side, sizes, fancy);
    applyCanvases(vinyl, side, sizes, fancy, renderers);
    applyControls(vinyl);
    applyFacts(vinyl, side);
  }

  // ----- cepillo ----------------------------------------------------------------

  function endStroke(): void {
    if (!stroke) return;
    const pointerId = stroke.pointerId;
    stroke = null;
    disco.classList.remove('es-cepillando');
    try {
      if (disco.hasPointerCapture(pointerId)) disco.releasePointerCapture(pointerId);
    } catch {
      // El puntero ya no existe: nada que liberar.
    }
    // El último redibujo pendiente del disco, ya sin limitar.
    if (trailingTimer !== null) {
      clearTimeout(trailingTimer);
      trailingTimer = null;
      rerun();
    }
  }

  disco.addEventListener('pointerdown', (ev) => {
    if (!brush || ev.button !== 0) return;
    ev.preventDefault();
    try {
      disco.setPointerCapture(ev.pointerId);
    } catch {
      // Sin captura el cepillo sigue funcionando mientras el puntero esté encima.
    }
    stroke = { pointerId: ev.pointerId, x: ev.clientX, y: ev.clientY, dist: 0, t: ev.timeStamp };
    disco.classList.add('es-cepillando');
  });
  disco.addEventListener('pointermove', (ev) => {
    if (!stroke || ev.pointerId !== stroke.pointerId) return;
    stroke.dist += Math.hypot(ev.clientX - stroke.x, ev.clientY - stroke.y);
    stroke.x = ev.clientX;
    stroke.y = ev.clientY;
    const passes = Math.floor(stroke.dist / BRUSH_STEP_PX);
    if (passes < 1) return;
    const strength = brushStrength(passes * BRUSH_STEP_PX, ev.timeStamp - stroke.t);
    stroke.dist -= passes * BRUSH_STEP_PX;
    stroke.t = ev.timeStamp;
    for (let i = 0; i < passes; i++) actions.clean(strength);
  });
  disco.addEventListener('pointerup', (ev) => {
    if (stroke && ev.pointerId === stroke.pointerId) endStroke();
  });
  disco.addEventListener('pointercancel', (ev) => {
    if (stroke && ev.pointerId === stroke.pointerId) endStroke();
  });

  // ----- botones y teclado --------------------------------------------------------

  b.turn.addEventListener('click', () => actions.setStage(stage === 'jacket-back' ? 'jacket-front' : 'jacket-back'));
  b.open.addEventListener('click', () => actions.setStage(stage === 'gatefold' ? 'jacket-front' : 'gatefold'));
  b.sleeve.addEventListener('click', () =>
    actions.setStage(stage === 'inner-out' || stage === 'disc-out' ? 'jacket-front' : 'inner-out'),
  );
  b.disc.addEventListener('click', () => actions.setStage(stage === 'disc-out' ? 'inner-out' : 'disc-out'));
  b.flip.addEventListener('click', () => actions.flipDisc());
  b.clean.addEventListener('click', () => setBrush(!brush));
  b.putA.addEventListener('click', () => actions.putOnTurntable('A'));
  b.putB.addEventListener('click', () => actions.putOnTurntable('B'));
  b.edit.addEventListener('click', () => actions.edit());
  b.save.addEventListener('click', () => actions.backToShelf());

  root.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || ev.defaultPrevented || activeId === null) return;
    ev.preventDefault();
    ev.stopPropagation();
    actions.backToShelf();
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => {
      if (activeId !== null) rerun();
    });
  }

  return { el: root, update };
}
