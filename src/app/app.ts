/**
 * Arranque y controlador de la aplicación.
 *
 * CONTRATO (lo implementa el módulo de aplicación):
 *  - Crea el store, el motor de audio, la biblioteca, las cachés de render
 *    y las vistas; monta la habitación en `root`.
 *  - Si la colección está vacía, siembra la colección de demostración.
 *  - Bucle de animación (requestAnimationFrame):
 *      1. `stepPlatter()` con el motor, la velocidad objetivo
 *         (`rpmValue(selector) × (1 + pitch/100)`), la mano (scratch) y la
 *         aguja;
 *      2. `engine.setRate(rpm / rpmValue(disc.nativeRpm))`;
 *      3. aguja: está en el surco si hay disco, la cara no es decorativa,
 *         el brazo no está en el soporte, la palanca está abajo y el radio
 *         cae en lead-in/program/lead-out;
 *      4. quién manda sobre el radio del brazo (en este orden):
 *           a) mientras el usuario arrastra el cabezal (`dragging`), manda
 *              el brazo: cada `moveTonearm` hace `engine.seekSec(timeForRadiusExt(...))`;
 *           b) con la aguja levantada o fuera del disco, manda el brazo
 *              (igual, con seek);
 *           c) con el plato parado (|rpm| < 0,5), manda el brazo;
 *           d) solo con la aguja en el surco y el plato girando, el radio
 *              sigue la posición del motor: `radiusForTimeExt(geo, dur, pos)`
 *              (la posición negativa es el lead-in y la mayor que la
 *              duración el lead-out; ambos silencio con crepitar).
 *         El radio en vivo se guarda en una variable local del bucle y se
 *         pasa a la vista en `frame.state`; el store se escribe solo en las
 *         acciones (moveTonearm, setCue, 'rest') y, como mucho, cada 2 s
 *         junto con el polvo;
 *      5. `engine.setEffects(effectsFor(...))` solo cuando cambian de forma
 *         apreciable;
 *      6. polvo: `accumulateDust` según exposición (en la mano en etapa
 *         disc-out/inner-out o en el plato con tapa abierta = `open`; en el
 *         plato con tapa cerrada = `lid-closed`; en la estantería =
 *         `sleeved`), acumulado localmente y volcado al estado cada ~2 s.
 *         Los cambios en `disc.condition` producidos por la física
 *         (`accumulateDust`, `cleanStroke`, `registerPlay`) NO modifican
 *         `updatedAt`;
 *      7. `turntableView.update(frame)`; el canvas del disco se pide con
 *         `sizePx = turntableView.discSizePx(format)`, `spindle: false`,
 *         `adapter45: false`.
 *  - Fin de cara (`onEnd`): `registerPlay(disc, 1)` como mucho una vez por
 *    cara cargada (bandera que se limpia en cada `loadSide`); al quitar el
 *    disco habiendo sonado más de la mitad sin llegar al final,
 *    `registerPlay(disc, fracción)`.
 *  - Audio: `engine.init()` se llama en el primer `pointerup` o `keydown`
 *    (no `pointerdown`: con puntero táctil no otorga activación de usuario)
 *    y se vuelve a llamar en cada `pointerup` mientras el contexto no esté
 *    `running`. Si falla, el mensaje se muestra como aviso. Al quedar
 *    listo, si hay un disco cargado, se carga su cara y se hace seek al
 *    radio actual del brazo.
 *  - Avisos: agujero grande sin centrador ("Este single tiene el agujero
 *    grande: pon el centrador"), cara decorativa ("Esta cara es decorativa:
 *    no suena"), archivo no soportado, sonido no disponible.
 *  - Borrado: tras `store.removeVinyl(id)` (que devuelve las claves de blob
 *    borradas), `renderers.images.forget(k)` y `library.evict(k)` por cada
 *    clave, `renderers.invalidate(id)` y `engine.unload()` si estaba en el
 *    plato. Al reordenar (`reorder(id, newIndex)`), `newIndex` es la
 *    posición destino en la lista ordenada por `shelfIndex` y se renumeran
 *    todos 0..n−1. Los cambios de condición física y de orden no tocan
 *    `updatedAt`; las ediciones sí (`touch`).
 *  - Persistencia: `store.flush()` en `pagehide` y en `visibilitychange`
 *    cuando pasa a `hidden`.
 *  - Para pruebas (tipado en `src/app/global.d.ts`), expone
 *    `window.__tocadiscos = { audioState(), positionSec(), state(), flush() }`
 *    y refleja el estado del audio en
 *    `document.documentElement.dataset.audio` ('none' | 'suspended' | 'running' | 'closed' | 'interrupted').
 *
 * IMPLEMENTACIÓN: la lógica del bucle y de las acciones vive en
 * `controller.ts`; aquí solo se crean las piezas, se montan las vistas y se
 * conectan los eventos del navegador. `room.update()` actualiza también la
 * estantería y la mano (las recibe como vistas); el editor se actualiza
 * aparte porque la habitación solo recibe su elemento.
 */
import { createAudioEngine, type AudioEngine } from '../audio/engine';
import { createAudioLibrary } from '../audio/library';
import { collectImageRefs } from '../core/blobs';
import { createStore, type Store } from '../core/store';
import type { AppState, Format, ImageRef } from '../core/types';
import { createEditorView, type EditorView } from '../editor/editor';
import { createRenderers, type Renderers } from '../render';
import { ImageCache } from '../render/images';
import { createHandView } from '../scene/hand';
import { createRoomView, type RoomView } from '../scene/room';
import { createShelfView } from '../scene/shelf';
import { createTurntableView, type TurntableView } from '../scene/turntable';
import { createController, type Controller } from './controller';
import { seedDemoCollection } from './seed';

/** Paso máximo de la simulación por frame (tras una pausa larga no se "salta" de golpe). */
export const MAX_FRAME_SEC = 0.1;
/** Cada cuánto se renueva el aviso mientras se prepara la demo (la habitación lo muestra 2,5 s). */
const SEED_TOAST_REFRESH_MS = 2000;

export const SEED_TOAST = 'Preparando la colección de demostración…';
export const SEED_DONE_TOAST = 'Colección de demostración lista: saca un disco de la estantería';

interface Views {
  turntable: TurntableView;
  room: RoomView;
  editor: EditorView;
}

export async function startApp(root: HTMLElement): Promise<void> {
  const store = createStore();
  await store.ready;
  const engine = createAudioEngine();
  const library = createAudioLibrary(store.blobs);
  const images = new ImageCache(store.blobs);
  const renderers = createRenderers(images);

  // La vista del tocadiscos necesita las acciones y el controlador necesita su
  // escala: se rompe el ciclo con una referencia que se rellena justo después.
  let turntable: TurntableView | null = null;
  const controller = createController({
    store,
    engine,
    library,
    renderers,
    turntableView: { discSizePx: (format: Format) => requireView(turntable).discSizePx(format) },
    now: () => Date.now(),
  });
  turntable = createTurntableView(controller.actions);
  const views = createViews(store, renderers, controller, turntable);
  root.replaceChildren(views.room.el);

  renderViews(views, store.getState(), renderers);
  wireStore(store, views, renderers, images);
  void ensureImages(images, store.getState().vinyls.flatMap((v) => collectImageRefs(v)));
  wireAudioGestures(engine, controller);
  wirePersistence(store, controller);
  exposeTestHooks(store, engine, controller);
  startLoop(controller, views.turntable, engine);

  if (store.getState().vinyls.length === 0) await seedWithNotice(store, controller);
}

function requireView(view: TurntableView | null): TurntableView {
  if (!view) throw new Error('La vista del tocadiscos aún no existe.');
  return view;
}

function createViews(store: Store, renderers: Renderers, controller: Controller, turntable: TurntableView): Views {
  const { actions } = controller;
  const shelf = createShelfView(actions);
  const hand = createHandView(actions);
  const editor = createEditorView({ store, renderers, importAudio: actions.importAudio, close: actions.close });
  const room = createRoomView({ turntableEl: turntable.el, shelf, hand, editorEl: editor.el, actions });
  return { turntable, room, editor };
}

// ---------------------------------------------------------------------------
// Store → vistas
// ---------------------------------------------------------------------------

function renderViews(views: Views, state: AppState, renderers: Renderers): void {
  views.room.update(state, renderers);
  views.editor.update(state);
}

function wireStore(store: Store, views: Views, renderers: Renderers, images: ImageCache): void {
  // Suscriptores separados: si una vista falla, las demás se siguen actualizando (el store aísla cada uno).
  store.subscribe((state, prev) => void ensureImages(images, changedImageRefs(state, prev)));
  store.subscribe((state) => views.room.update(state, renderers));
  store.subscribe((state) => views.editor.update(state));

  // Cuando llega una imagen, la fachada vacía su caché: se vuelve a pintar en el siguiente frame.
  let queued = false;
  images.onLoad(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      renderViews(views, store.getState(), renderers);
    });
  });
}

/** Referencias de imagen de los vinilos nuevos o editados (cuyo `updatedAt` cambió). */
export function changedImageRefs(state: AppState, prev: AppState): ImageRef[] {
  if (state.vinyls === prev.vinyls) return [];
  const before = new Map(prev.vinyls.map((v) => [v.id, v.updatedAt]));
  return state.vinyls.filter((v) => before.get(v.id) !== v.updatedAt).flatMap((v) => collectImageRefs(v));
}

async function ensureImages(images: ImageCache, refs: ImageRef[]): Promise<void> {
  if (refs.length === 0) return;
  try {
    await images.ensure(refs);
  } catch (error) {
    console.warn('Tocadiscos: no se pudieron cargar algunas imágenes de la colección.', error);
  }
}

// ---------------------------------------------------------------------------
// Navegador
// ---------------------------------------------------------------------------

function audioStateOf(engine: AudioEngine): string {
  return engine.getContext()?.state ?? 'none';
}

/** El audio solo puede arrancar dentro de un gesto: pointerup o keydown (nunca pointerdown). */
function wireAudioGestures(engine: AudioEngine, controller: Controller): void {
  const onGesture = (): void => {
    if (engine.getContext()?.state === 'running') return;
    void controller.initAudio();
  };
  // En captura: ningún `stopPropagation` de una vista puede impedir el arranque.
  window.addEventListener('pointerup', onGesture, true);
  window.addEventListener('keydown', onGesture, true);
}

function wirePersistence(store: Store, controller: Controller): void {
  const save = (): void => {
    controller.commit();
    // Un fallo de escritura ya lo registra el store; aquí no hay nadie que lo espere.
    void store.flush().catch(() => undefined);
  };
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
  });
}

function exposeTestHooks(store: Store, engine: AudioEngine, controller: Controller): void {
  window.__tocadiscos = {
    audioState: () => engine.getContext()?.state ?? null,
    positionSec: () => controller.positionSec(),
    state: () => store.getState(),
    flush: async () => {
      controller.commit();
      await store.flush();
    },
  };
}

function startLoop(controller: Controller, turntable: TurntableView, engine: AudioEngine): void {
  const html = document.documentElement;
  let lastTime: number | null = null;
  let lastAudio = '';
  let reported = false;

  const syncAudioDataset = (): void => {
    const audio = audioStateOf(engine);
    if (audio === lastAudio) return;
    lastAudio = audio;
    html.dataset.audio = audio;
  };

  const tick = (time: number): void => {
    requestAnimationFrame(tick);
    const dt = lastTime === null ? 0 : Math.min(MAX_FRAME_SEC, Math.max(0, (time - lastTime) / 1000));
    lastTime = time;
    try {
      turntable.update(controller.frame(dt));
    } catch (error) {
      // Solo el primero: un fallo en cada frame inundaría la consola a 60 Hz.
      if (!reported) console.error('Tocadiscos: ha fallado un fotograma de la animación.', error);
      reported = true;
    }
    syncAudioDataset();
  };

  syncAudioDataset();
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Colección de demostración
// ---------------------------------------------------------------------------

async function seedWithNotice(store: Store, controller: Controller): Promise<void> {
  controller.notify(SEED_TOAST);
  const refresh = setInterval(() => controller.notify(SEED_TOAST), SEED_TOAST_REFRESH_MS);
  try {
    await seedDemoCollection(store);
    controller.notify(SEED_DONE_TOAST);
  } catch (error) {
    console.error('Tocadiscos: no se pudo preparar la colección de demostración.', error);
    const reason = error instanceof Error ? error.message : String(error);
    controller.notify(`No se pudo preparar la colección de demostración (${reason}). Añade tus propios discos con «Añadir vinilo».`);
  } finally {
    clearInterval(refresh);
  }
  await store.flush().catch(() => undefined);
}
