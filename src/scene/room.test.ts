import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVinyl, initialAppState, presetFull } from '../core/defaults';
import type { AppState, HandStage, SideId, Vinyl } from '../core/types';
import { createRenderers, type Renderers } from '../render';
import { ImageCache } from '../render/images';
import { brushStrength, createHandView, handSizes, type HandActions, type HandView } from './hand';
import {
  AUDIO_EXTENSIONS,
  TOAST_MS,
  createRoomView,
  formatDustSpeed,
  isAudioFile,
  toastRemainingMs,
  type RoomActions,
  type RoomView,
} from './room';
import { createShelfView, type ShelfActions, type ShelfView } from './shelf';
import { spineHeightPx } from './shelf-layout';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function renderers(): Renderers {
  return createRenderers(new ImageCache({ url: async () => null } as never));
}

function stateWith(vinyls: Vinyl[], ui: Partial<AppState['ui']> = {}): AppState {
  const base = initialAppState();
  return { ...base, vinyls, ui: { ...base.ui, ...ui } };
}

function fakeView(className: string): ShelfView & HandView & { update: ReturnType<typeof vi.fn> } {
  const el = document.createElement('div');
  el.className = className;
  return { el, update: vi.fn() };
}

function roomActions(): RoomActions & Record<keyof RoomActions, ReturnType<typeof vi.fn>> {
  return {
    addVinyl: vi.fn(),
    openSettings: vi.fn(),
    closeOverlays: vi.fn(),
    setDustSpeed: vi.fn(),
    setFancyRendering: vi.fn(),
    dropAudioFiles: vi.fn(),
  };
}

function shelfActions(): ShelfActions & Record<keyof ShelfActions, ReturnType<typeof vi.fn>> {
  return { pickVinyl: vi.fn(), addVinyl: vi.fn(), openEditor: vi.fn(), reorder: vi.fn() };
}

function handActions(): HandActions & Record<keyof HandActions, ReturnType<typeof vi.fn>> {
  return {
    setStage: vi.fn(),
    flipDisc: vi.fn(),
    putOnTurntable: vi.fn(),
    backToShelf: vi.fn(),
    edit: vi.fn(),
    clean: vi.fn(),
  };
}

const mounted: HTMLElement[] = [];

function mount<T extends { el: HTMLElement }>(view: T): T {
  document.body.append(view.el);
  mounted.push(view.el);
  return view;
}

afterEach(() => {
  for (const el of mounted.splice(0)) el.remove();
  vi.useRealTimers();
});

function q<T extends Element = HTMLElement>(root: ParentNode, test: string): T {
  const el = root.querySelector<T & Element>(`[data-test="${test}"]`);
  if (!el) throw new Error(`No existe [data-test="${test}"]`);
  return el;
}

function vinyls(n: number): Vinyl[] {
  return Array.from({ length: n }, (_, i) =>
    createVinyl({ meta: { artist: `Artista ${i}`, title: `Disco ${i}` }, shelfIndex: i, now: 1000 + i }),
  );
}

// ---------------------------------------------------------------------------
// Habitación con vistas falsas
// ---------------------------------------------------------------------------

describe('createRoomView', () => {
  function setup(): { room: RoomView; actions: ReturnType<typeof roomActions>; shelf: ReturnType<typeof fakeView>; hand: ReturnType<typeof fakeView>; editorEl: HTMLElement; turntableEl: HTMLElement } {
    const actions = roomActions();
    const shelf = fakeView('estanteria-falsa');
    const hand = fakeView('mano-falsa');
    const editorEl = document.createElement('div');
    const turntableEl = document.createElement('div');
    const room = mount(createRoomView({ turntableEl, shelf, hand, editorEl, actions }));
    return { room, actions, shelf, hand, editorEl, turntableEl };
  }

  it('monta sin lanzar con vistas falsas mínimas y expone los ganchos de prueba', () => {
    const { room, shelf, hand, editorEl, turntableEl } = setup();
    expect(room.el.dataset.test).toBe('habitacion');
    expect(room.el.contains(turntableEl)).toBe(true);
    expect(room.el.contains(shelf.el)).toBe(true);
    expect(room.el.contains(hand.el)).toBe(true);
    expect(room.el.contains(editorEl)).toBe(true);
    expect(q(room.el, 'anadir-vinilo').textContent).toBe('Añadir vinilo');
    expect(q(room.el, 'ajustes').textContent).toBe('Ajustes');
    expect(q(room.el, 'aviso').getAttribute('aria-live')).toBe('polite');
    expect(room.el.querySelector('h1')?.textContent).toBe('Habitación de escucha');
  });

  it('update delega en la estantería y en la mano', () => {
    const { room, shelf, hand } = setup();
    const state = initialAppState();
    const r = renderers();
    room.update(state, r);
    expect(shelf.update).toHaveBeenCalledWith(state, r);
    expect(hand.update).toHaveBeenCalledWith(state, r);
  });

  it('el aviso aparece con ui.toast y se oculta 2,5 s después de toast.at', () => {
    vi.useFakeTimers();
    const { room } = setup();
    const aviso = q(room.el, 'aviso');
    room.update(stateWith([]), renderers());
    expect(aviso.classList.contains('es-visible')).toBe(false);

    const state = stateWith([], { toast: { text: 'Pon el centrador', at: Date.now() } });
    room.update(state, renderers());
    expect(aviso.textContent).toBe('Pon el centrador');
    expect(aviso.classList.contains('es-visible')).toBe(true);

    // El mismo aviso no reinicia la cuenta.
    vi.advanceTimersByTime(1500);
    room.update({ ...state }, renderers());
    vi.advanceTimersByTime(TOAST_MS - 1500 - 1);
    expect(aviso.classList.contains('es-visible')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(aviso.classList.contains('es-visible')).toBe(false);
  });

  it('un aviso que ya caducó al llegar no se muestra', () => {
    vi.useFakeTimers();
    const { room } = setup();
    room.update(stateWith([], { toast: { text: 'Viejo', at: Date.now() - TOAST_MS - 10 } }), renderers());
    expect(q(room.el, 'aviso').classList.contains('es-visible')).toBe(false);
  });

  it('la clase del cajón sigue a ui.view', () => {
    const { room } = setup();
    const r = renderers();
    const drawer = room.el.querySelector<HTMLElement>('.hab-cajon')!;
    room.update(stateWith([], { view: 'editor' }), r);
    expect(room.el.classList.contains('hab-cajon-abierto')).toBe(true);
    expect(drawer.hasAttribute('inert')).toBe(false);
    room.update(stateWith([], { view: 'room' }), r);
    expect(room.el.classList.contains('hab-cajon-abierto')).toBe(false);
    expect(drawer.hasAttribute('inert')).toBe(true);
  });

  it('la mano se muestra con view "hand" y el resto de la habitación queda inerte', () => {
    const { room, hand } = setup();
    const r = renderers();
    const layer = hand.el.parentElement!;
    expect(layer.hidden).toBe(true);
    room.update(stateWith([], { view: 'hand' }), r);
    expect(layer.hidden).toBe(false);
    expect(room.el.classList.contains('hab-mano-abierta')).toBe(true);
    expect(room.el.querySelector('.hab-escena')!.hasAttribute('inert')).toBe(true);
    room.update(stateWith([], { view: 'room' }), r);
    expect(layer.hidden).toBe(true);
    expect(room.el.querySelector('.hab-escena')!.hasAttribute('inert')).toBe(false);
  });

  it('pulsar el velo oscuro cierra la capa', () => {
    const { room, actions } = setup();
    room.update(stateWith([], { view: 'hand' }), renderers());
    room.el.querySelector<HTMLElement>('.hab-velo')!.click();
    expect(actions.closeOverlays).toHaveBeenCalledTimes(1);
  });

  it('Añadir vinilo y Esc llaman a sus acciones', () => {
    const { room, actions } = setup();
    q(room.el, 'anadir-vinilo').click();
    expect(actions.addVinyl).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(actions.closeOverlays).toHaveBeenCalledTimes(1);
  });

  it('el panel de ajustes refleja y cambia la velocidad del polvo y los brillos', () => {
    const { room, actions } = setup();
    const base = initialAppState();
    room.update({ ...base, settings: { dustSpeed: 3, fancyRendering: false } }, renderers());
    const button = q<HTMLButtonElement>(room.el, 'ajustes');
    const popover = room.el.querySelector<HTMLElement>('.hab-ajustes')!;
    expect(popover.hidden).toBe(true);

    button.click();
    expect(popover.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(actions.openSettings).toHaveBeenCalledTimes(1);

    const range = q<HTMLInputElement>(room.el, 'ajustes-polvo');
    const checkbox = q<HTMLInputElement>(room.el, 'ajustes-brillos');
    expect(range.min).toBe('0');
    expect(range.max).toBe('20');
    expect(popover.querySelector('output')!.textContent).toBe('×3');
    expect(checkbox.checked).toBe(false);

    range.value = '7';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    expect(actions.setDustSpeed).toHaveBeenCalledWith(7);
    expect(popover.querySelector('output')!.textContent).toBe('×7');

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(actions.setFancyRendering).toHaveBeenCalledWith(true);

    // Esc con el panel abierto lo cierra sin cerrar otras capas.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(popover.hidden).toBe(true);
    expect(actions.closeOverlays).not.toHaveBeenCalled();
    expect(popover.querySelectorAll('.hab-ayuda li').length).toBeGreaterThanOrEqual(3);
  });

  it('soltar archivos llama a dropAudioFiles solo con los de audio', () => {
    const { room, actions } = setup();
    const mp3 = new File(['a'], '01 - Cancion.mp3', { type: '' });
    const flac = new File(['b'], 'otra.bin', { type: 'audio/flac' });
    const txt = new File(['c'], 'notas.txt', { type: 'text/plain' });
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [mp3, txt, flac] } });
    room.el.dispatchEvent(drop);
    expect(actions.dropAudioFiles).toHaveBeenCalledWith([mp3, flac]);
    expect(drop.defaultPrevented).toBe(true);
  });

  it('si ninguno de los archivos soltados es de audio, avisa y no crea nada', () => {
    const { room, actions } = setup();
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: { types: ['Files'], files: [new File(['c'], 'foto.jpg', { type: 'image/jpeg' })] },
    });
    room.el.dispatchEvent(drop);
    expect(actions.dropAudioFiles).not.toHaveBeenCalled();
    expect(q(room.el, 'aviso').textContent).toContain('no son de audio');
  });

  it('un soltar que ya atendió otra vista (el editor) se ignora', () => {
    const { room, actions, editorEl } = setup();
    editorEl.addEventListener('drop', (ev) => ev.preventDefault());
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [new File(['a'], 'a.mp3')] } });
    editorEl.dispatchEvent(drop);
    expect(actions.dropAudioFiles).not.toHaveBeenCalled();
  });
});

describe('utilidades de la habitación', () => {
  it('isAudioFile acepta audio/* y extensiones conocidas', () => {
    expect(isAudioFile({ name: 'a.FLAC', type: '' })).toBe(true);
    expect(isAudioFile({ name: 'sin-extension', type: 'audio/ogg' })).toBe(true);
    expect(isAudioFile({ name: 'video.mov', type: 'video/quicktime' })).toBe(false);
    expect(isAudioFile({ name: '.mp3', type: '' })).toBe(false);
    expect(AUDIO_EXTENSIONS.has('m4a')).toBe(true);
  });

  it('formatDustSpeed usa coma decimal', () => {
    expect(formatDustSpeed(1)).toBe('×1');
    expect(formatDustSpeed(2.5)).toBe('×2,5');
  });

  it('toastRemainingMs cuenta desde toast.at y se acota a 0..TOAST_MS', () => {
    expect(toastRemainingMs(1_000_000_000_000, 1_000_000_001_000)).toBe(TOAST_MS - 1000);
    expect(toastRemainingMs(1_000_000_000_000, 1_000_000_009_000)).toBe(0);
    expect(toastRemainingMs(1_000_000_005_000, 1_000_000_000_000)).toBe(TOAST_MS);
  });
});

// ---------------------------------------------------------------------------
// Estantería real (sin canvas: happy-dom no dibuja)
// ---------------------------------------------------------------------------

describe('createShelfView', () => {
  it('dibuja un lomo por vinilo, en orden, con title y aria-label = texto del lomo', () => {
    const actions = shelfActions();
    const shelf = mount(createShelfView(actions));
    const list = vinyls(3).reverse();
    list[0]!.spine.text = 'Lomo personalizado';
    shelf.update(stateWith(list), renderers());
    const spines = Array.from(shelf.el.querySelectorAll<HTMLButtonElement>('button[data-test="lomo"]'));
    expect(spines.map((b) => b.dataset.vinylId)).toEqual([...list].reverse().map((v) => v.id));
    const custom = spines.find((b) => b.dataset.vinylId === list[0]!.id)!;
    expect(custom.title).toBe('Lomo personalizado');
    expect(custom.getAttribute('aria-label')).toBe('Lomo personalizado');
    expect(spines[0]!.title).toBe('Artista 0 — Disco 0');
  });

  it('cada lomo tiene su propio canvas del tamaño de la escala de la estantería', () => {
    const shelf = mount(createShelfView(shelfActions()));
    const v = createVinyl({ disc: { format: '7' } });
    shelf.update(stateWith([v]), renderers());
    const button = q<HTMLButtonElement>(shelf.el, 'lomo');
    const canvas = button.querySelector('canvas')!;
    const dpr = window.devicePixelRatio || 1;
    expect(button.style.height).toBe(`${spineHeightPx('7')}px`);
    expect(button.style.width).toBe('16px');
    expect(canvas.height).toBe(Math.round(spineHeightPx('7') * dpr));
    expect(canvas.width).toBe(Math.round(16 * dpr));
  });

  it('el vinilo del plato y el de la mano dejan un hueco del ancho del lomo', () => {
    const shelf = mount(createShelfView(shelfActions()));
    const [a, b, c] = vinyls(3) as [Vinyl, Vinyl, Vinyl];
    const state = stateWith([a, b, c], { handVinylId: c.id, view: 'hand' });
    state.turntable = { ...state.turntable, loaded: { vinylId: a.id, side: 'A' } };
    shelf.update(state, renderers());
    const holes = Array.from(shelf.el.querySelectorAll<HTMLElement>('[data-test="hueco"]'));
    expect(holes.map((el) => el.dataset.vinylId)).toEqual([a.id, c.id]);
    expect(holes[0]!.style.width).toBe('16px');
    expect(holes[0]!.title).toContain('en el plato');
    expect(holes[1]!.title).toContain('en la mano');
    const spines = shelf.el.querySelectorAll<HTMLButtonElement>('button[data-test="lomo"]');
    expect(Array.from(spines).map((s) => s.dataset.vinylId)).toEqual([b.id]);
  });

  it('clic, Enter y E llaman a pickVinyl y openEditor; Alt+→ reordena', () => {
    const actions = shelfActions();
    const shelf = mount(createShelfView(actions));
    const list = vinyls(3);
    shelf.update(stateWith(list), renderers());
    const first = q<HTMLButtonElement>(shelf.el, 'lomo');
    first.click();
    expect(actions.pickVinyl).toHaveBeenLastCalledWith(list[0]!.id);
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(actions.pickVinyl).toHaveBeenCalledTimes(2);
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true, cancelable: true }));
    expect(actions.openEditor).toHaveBeenCalledWith(list[0]!.id);
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true }));
    expect(actions.reorder).toHaveBeenCalledWith(list[0]!.id, 1);
  });

  it('el botón de añadir va al final de la última balda y la estantería vacía lo explica', () => {
    const actions = shelfActions();
    const shelf = mount(createShelfView(actions));
    shelf.update(stateWith([]), renderers());
    expect(shelf.el.textContent).toContain('Todavía no hay vinilos. Añade uno o suelta archivos de audio aquí.');
    const add = q<HTMLButtonElement>(shelf.el, 'estanteria-anadir');
    expect(add.textContent).toBe('Añadir vinilo');
    add.click();
    expect(actions.addVinyl).toHaveBeenCalledTimes(1);

    shelf.update(stateWith(vinyls(2)), renderers());
    expect(shelf.el.textContent).not.toContain('Todavía no hay vinilos');
    const rows = shelf.el.querySelectorAll('.est-fila');
    expect(rows[rows.length - 1]!.lastElementChild).toBe(q(shelf.el, 'estanteria-anadir'));
  });

  it('no reconstruye los lomos si solo cambian datos', () => {
    const shelf = mount(createShelfView(shelfActions()));
    const list = vinyls(3);
    const r = renderers();
    shelf.update(stateWith(list), r);
    const before = Array.from(shelf.el.querySelectorAll('button[data-test="lomo"]'));
    const changed = list.map((v) => ({ ...v, disc: { ...v.disc, condition: { ...v.disc.condition, dust: 0.5 } } }));
    shelf.update(stateWith(changed), r);
    const after = Array.from(shelf.el.querySelectorAll('button[data-test="lomo"]'));
    expect(after).toEqual(before);
    expect(after.every((el, i) => el === before[i])).toBe(true);
  });

  it('cuando las baldas se llenan, el resto va a cajas que se despliegan al pulsarlas', () => {
    const actions = shelfActions();
    const shelf = mount(createShelfView(actions));
    const list = vinyls(120);
    shelf.update(stateWith(list), renderers());
    const crates = shelf.el.querySelectorAll<HTMLButtonElement>('[data-test="caja"]');
    expect(crates.length).toBeGreaterThan(0);
    const onShelves = shelf.el.querySelectorAll('.est-baldas [data-test="lomo"]').length;
    expect(onShelves).toBeLessThan(120);

    const crate = crates[0]!;
    expect(crate.getAttribute('aria-expanded')).toBe('false');
    crate.click();
    expect(crate.getAttribute('aria-expanded')).toBe('true');
    const inList = shelf.el.querySelectorAll<HTMLButtonElement>('.est-caja-lista [data-test="lomo"]');
    expect(inList.length).toBe(Math.min(25, 120 - onShelves));
    expect(inList[0]!.dataset.vinylId).toBe(list[onShelves]!.id);
    inList[0]!.click();
    expect(actions.pickVinyl).toHaveBeenCalledWith(list[onShelves]!.id);

    q<HTMLButtonElement>(shelf.el, 'caja-cerrar').click();
    expect(shelf.el.querySelectorAll('.est-caja-lista [data-test="lomo"]').length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Mano real
// ---------------------------------------------------------------------------

describe('createHandView', () => {
  function handState(vinyl: Vinyl, stage: HandStage = 'jacket-front', side: SideId = 'A'): AppState {
    return stateWith([vinyl], { view: 'hand', handVinylId: vinyl.id, handStage: stage, handSide: side });
  }

  it('muestra todos los controles y los datos del vinilo', () => {
    const hand = mount(createHandView(handActions()));
    const v = createVinyl({ meta: { artist: 'Queen', title: 'A Night at the Opera' }, disc: { weightGrams: 180 } });
    v.disc.thicknessMm = 1.9;
    v.disc.condition = { ...v.disc.condition, plays: 4, dust: 0.1 };
    hand.update(handState(v), renderers());
    expect(hand.el.dataset.test).toBe('mano');
    for (const test of [
      'mano-girar',
      'mano-sacar-funda',
      'mano-sacar-disco',
      'mano-voltear',
      'mano-limpiar',
      'mano-poner-a',
      'mano-poner-b',
      'mano-editar',
      'mano-guardar',
      'mano-disco',
    ]) {
      expect(() => q(hand.el, test)).not.toThrow();
    }
    expect(q(hand.el, 'mano-abrir').hidden).toBe(true);
    const text = hand.el.textContent ?? '';
    expect(text).toContain('A Night at the Opera');
    expect(text).toContain('Queen');
    expect(text).toContain('12 pulgadas');
    expect(text).toContain('180 g, 1,9 mm');
    expect(text).toContain('33⅓ rpm');
    expect(text).toContain('Buen estado');
    expect(hand.el.querySelector<HTMLElement>('.mano-aviso-polvo')!.hidden).toBe(true);
  });

  it('avisa del polvo y marca la cara B decorativa', () => {
    const hand = mount(createHandView(handActions()));
    const v = presetFull({ title: 'Pintado' });
    v.disc.condition = { ...v.disc.condition, dust: 0.45 };
    hand.update(handState(v), renderers());
    expect(hand.el.querySelector<HTMLElement>('.mano-aviso-polvo')!.hidden).toBe(false);
    expect(hand.el.textContent).toContain('Pasa el cepillo antes de ponerlo');
    expect(q(hand.el, 'mano-poner-b').textContent).toBe('Poner en el plato: cara B (decorativa)');
    expect(q<HTMLButtonElement>(hand.el, 'mano-poner-b').disabled).toBe(false);
    expect(q(hand.el, 'mano-abrir').hidden).toBe(false);
  });

  it('los botones piden la etapa siguiente según la actual', () => {
    const actions = handActions();
    const hand = mount(createHandView(actions));
    const v = presetFull();
    const r = renderers();
    hand.update(handState(v, 'jacket-front'), r);
    q(hand.el, 'mano-girar').click();
    expect(actions.setStage).toHaveBeenLastCalledWith('jacket-back');
    q(hand.el, 'mano-abrir').click();
    expect(actions.setStage).toHaveBeenLastCalledWith('gatefold');
    q(hand.el, 'mano-sacar-funda').click();
    expect(actions.setStage).toHaveBeenLastCalledWith('inner-out');
    q(hand.el, 'mano-sacar-disco').click();
    expect(actions.setStage).toHaveBeenLastCalledWith('disc-out');

    hand.update(handState(v, 'disc-out'), r);
    expect(q(hand.el, 'mano-sacar-disco').textContent).toBe('Meter disco');
    q(hand.el, 'mano-sacar-disco').click();
    expect(actions.setStage).toHaveBeenLastCalledWith('inner-out');
    expect(q<HTMLButtonElement>(hand.el, 'mano-girar').disabled).toBe(true);

    q(hand.el, 'mano-voltear').click();
    expect(actions.flipDisc).toHaveBeenCalledTimes(1);
    q(hand.el, 'mano-poner-a').click();
    q(hand.el, 'mano-poner-b').click();
    expect(actions.putOnTurntable.mock.calls).toEqual([['A'], ['B']]);
    q(hand.el, 'mano-editar').click();
    expect(actions.edit).toHaveBeenCalledTimes(1);
    q(hand.el, 'mano-guardar').click();
    expect(actions.backToShelf).toHaveBeenCalledTimes(1);
  });

  it('la etapa y la cara se reflejan en el DOM sin reconstruirlo', () => {
    const hand = mount(createHandView(handActions()));
    const v = createVinyl();
    const r = renderers();
    hand.update(handState(v, 'jacket-front'), r);
    const objeto = hand.el.querySelector<HTMLElement>('.mano-objeto')!;
    const disco = q(hand.el, 'mano-disco');
    const button = q(hand.el, 'mano-girar');
    expect(objeto.dataset.etapa).toBe('jacket-front');
    hand.update(handState(v, 'disc-out', 'B'), r);
    expect(objeto.dataset.etapa).toBe('disc-out');
    expect(objeto.dataset.cara).toBe('B');
    expect(q(hand.el, 'mano-disco')).toBe(disco);
    expect(q(hand.el, 'mano-girar')).toBe(button);
    // Sin carpeta desplegable, la etapa 'gatefold' se muestra como la portada.
    hand.update(handState(v, 'gatefold'), r);
    expect(objeto.dataset.etapa).toBe('jacket-front');
  });

  it('pide los lienzos en píxeles de dispositivo con el lado S de la mano', () => {
    const hand = mount(createHandView(handActions()));
    const v = createVinyl({ disc: { format: '7' } });
    const r = renderers();
    const front = vi.spyOn(r, 'jacketFront');
    const disc = vi.spyOn(r, 'disc');
    hand.update(handState(v, 'jacket-front'), r);
    const sizes = handSizes('7', window.innerWidth, window.innerHeight);
    const dpr = window.devicePixelRatio || 1;
    expect(front).toHaveBeenCalledWith(v, Math.round(sizes.jacketPx * dpr));
    expect(disc).not.toHaveBeenCalled();
    hand.update(handState(v, 'disc-out', 'B'), r);
    expect(disc).toHaveBeenCalledWith(v, {
      sizePx: Math.round(sizes.discPx * dpr),
      side: 'B',
      showDust: true,
      adapter45: false,
      spindle: false,
      quality: 'high',
    });
    const canvas = hand.el.querySelector<HTMLCanvasElement>('.mano-disco-b canvas')!;
    expect(canvas.width).toBe(Math.round(sizes.discPx * dpr));
    expect(canvas.style.width).toBe(`${sizes.discPx}px`);
  });

  it('el cepillo solo se activa con el disco fuera y Esc guarda', () => {
    const actions = handActions();
    const hand = mount(createHandView(actions));
    const v = createVinyl();
    const r = renderers();
    hand.update(handState(v, 'jacket-front'), r);
    const clean = q<HTMLButtonElement>(hand.el, 'mano-limpiar');
    expect(clean.disabled).toBe(true);
    hand.update(handState(v, 'disc-out'), r);
    expect(clean.disabled).toBe(false);
    clean.click();
    expect(clean.getAttribute('aria-pressed')).toBe('true');
    expect(hand.el.classList.contains('mano-con-cepillo')).toBe(true);
    hand.update(handState(v, 'inner-out'), r);
    expect(clean.getAttribute('aria-pressed')).toBe('false');

    hand.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(actions.backToShelf).toHaveBeenCalledTimes(1);
  });

  it('sin vinilo en la mano no pide nada a la fachada', () => {
    const hand = mount(createHandView(handActions()));
    const r = renderers();
    const front = vi.spyOn(r, 'jacketFront');
    hand.update(stateWith([createVinyl()]), r);
    expect(front).not.toHaveBeenCalled();
  });
});

describe('medidas de la mano', () => {
  it('S = min(70vh, 560px) para un 12" y proporcional para 10" y 7"', () => {
    expect(handSizes('12', 1440, 900).jacketPx).toBe(560);
    expect(handSizes('12', 1440, 700).jacketPx).toBe(490);
    expect(handSizes('10', 1440, 900).jacketPx).toBe(Math.round((560 * 260) / 315));
    expect(handSizes('7', 1440, 900).jacketPx).toBe(320);
  });

  it('el disco va a la escala de la carpeta y en pantallas estrechas S se limita al ancho', () => {
    const s = handSizes('12', 1440, 900);
    expect(s.discPx).toBe(Math.round((560 * 302) / 315));
    expect(s.gatefoldScale).toBe(1);
    const narrow = handSizes('12', 400, 900);
    expect(narrow.jacketPx).toBe(Math.round((400 - 32) / 1.6));
    expect(narrow.gatefoldScale).toBeLessThan(1);
  });

  it('la fuerza del cepillo crece con la velocidad del gesto y se acota', () => {
    expect(brushStrength(40, 400)).toBeCloseTo(0.3);
    expect(brushStrength(40, 40)).toBeCloseTo(0.75);
    expect(brushStrength(40, 1)).toBe(1);
    expect(brushStrength(0, 100)).toBe(0.25);
    expect(brushStrength(40, 100000)).toBe(0.25);
  });
});
