import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Format, TurntableState } from '../core/types';
import {
  DEFAULT_PX_PER_MM,
  STAGE_MM,
  createTurntableView,
  describeTonearm,
  formatClock,
  formatPitch,
  formatPosition,
  type TurntableActions,
  type TurntableFrame,
  type TurntableView,
} from './turntable';
import { ORBIT_RADIUS_MM, REST_RADIUS_MM, stylusPointForRadius } from './turntable-geometry';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function makeActions(): { [K in keyof TurntableActions]: ReturnType<typeof vi.fn> } & TurntableActions {
  return {
    toggleMotor: vi.fn(),
    setSpeed: vi.fn(),
    setPitch: vi.fn(),
    setVolume: vi.fn(),
    toggleLid: vi.fn(),
    toggleAdapter: vi.fn(),
    setCue: vi.fn(),
    moveTonearm: vi.fn(),
    handPlatter: vi.fn(),
    brushStroke: vi.fn(),
    removeDisc: vi.fn(),
    flipDisc: vi.fn(),
    setTool: vi.fn(),
    powerToggle: vi.fn(),
  };
}

function makeState(over: Partial<TurntableState> = {}): TurntableState {
  return {
    power: true,
    motor: false,
    speed: 33,
    pitchPercent: 0,
    lidOpen: true,
    adapter45: false,
    loaded: null,
    tonearm: { onRest: true, lifted: true, radiusMm: 160 },
    volume: 0.85,
    ...over,
  };
}

function makeFrame(over: Partial<TurntableFrame> = {}): TurntableFrame {
  return {
    state: makeState(),
    platterAngleDeg: 0,
    actualRpm: 0,
    discCanvas: null,
    discFormat: null,
    discHole: null,
    wobble: 0,
    stylusInGroove: false,
    positionSec: 0,
    sideDurationSec: 0,
    nowPlaying: null,
    tool: 'none',
    sideName: null,
    fancy: true,
    ...over,
  };
}

function fakeDisc(size = 64): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function withDisc(format: Format = '12', over: Partial<TurntableFrame> = {}): TurntableFrame {
  return makeFrame({
    discCanvas: fakeDisc(),
    discFormat: format,
    discHole: 'small',
    sideName: 'Cara A',
    positionSec: 190,
    sideDurationSec: 1250,
    nowPlaying: { title: 'Bohemian Rhapsody', artist: 'Queen', trackIndex: 1 },
    ...over,
  });
}

function q<T extends Element = HTMLElement>(view: TurntableView, test: string): T {
  const el = view.el.querySelector<T & Element>(`[data-test="${test}"]`);
  if (!el) throw new Error(`falta [data-test="${test}"]`);
  return el as T;
}

function pointer(type: string, x: number, y: number, id = 1): PointerEvent {
  return new PointerEvent(type, { clientX: x, clientY: y, pointerId: id, pointerType: 'mouse', button: 0, bubbles: true, cancelable: true });
}

function key(target: EventTarget, k: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

/** En happy-dom las cajas miden 0: el eje queda en (0, 0) de cliente y la escala es la inicial. */
function mmToClient(p: { x: number; y: number }): { x: number; y: number } {
  return { x: p.x * DEFAULT_PX_PER_MM, y: p.y * DEFAULT_PX_PER_MM };
}

const views: TurntableView[] = [];

function mount(actions: TurntableActions = makeActions()): TurntableView {
  const view = createTurntableView(actions);
  document.body.append(view.el);
  views.push(view);
  return view;
}

afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Formato de textos
// ---------------------------------------------------------------------------

describe('formato de textos', () => {
  it('formatClock da m:ss redondeando hacia abajo', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(190.9)).toBe('3:10');
    expect(formatClock(1250)).toBe('20:50');
    expect(formatClock(-3)).toBe('0:00');
    expect(formatClock(Number.NaN)).toBe('0:00');
  });

  it('formatPitch usa coma decimal, signo y espacio antes del %', () => {
    expect(formatPitch(0)).toBe('+0,0 %');
    expect(formatPitch(1.5)).toBe('+1,5 %');
    expect(formatPitch(-8)).toBe('−8,0 %');
    expect(formatPitch(-0.01)).toBe('+0,0 %');
    expect(formatPitch(Number.NaN)).toBe('+0,0 %');
  });

  it('formatPosition marca la entrada y la salida', () => {
    expect(formatPosition(-2, 100)).toBe('entrada');
    expect(formatPosition(101, 100)).toBe('salida');
    expect(formatPosition(190, 1250)).toBe('3:10 / 20:50');
  });

  it('describeTonearm sigue el formato "Cara A, canción 2, 3:10"', () => {
    const playing = withDisc('12', { state: makeState({ tonearm: { onRest: false, lifted: false, radiusMm: 120 } }) });
    expect(describeTonearm(playing)).toBe('Cara A, canción 2, 3:10');
    expect(describeTonearm(makeFrame())).toBe('En el soporte');
    const lifted = withDisc('12', {
      positionSec: -1,
      nowPlaying: null,
      state: makeState({ tonearm: { onRest: false, lifted: true, radiusMm: 148 } }),
    });
    expect(describeTonearm(lifted)).toBe('Cara A, entrada, aguja levantada');
  });
});

// ---------------------------------------------------------------------------
// Construcción
// ---------------------------------------------------------------------------

describe('createTurntableView', () => {
  const hooks = [
    'tt',
    'tt-disco',
    'tt-cabezal',
    'tt-brazo',
    'tt-cue',
    'tt-start',
    'tt-33',
    'tt-45',
    'tt-78',
    'tt-pitch',
    'tt-volumen',
    'tt-encendido',
    'tt-tapa',
    'tt-centrador',
    'tt-quitar',
    'tt-voltear',
    'tt-cepillo',
    'tt-pantalla',
  ];

  it('construye sin lanzar aunque no exista ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const view = mount();
    expect(view.el.dataset.test).toBe('tt');
    expect(view.el.classList.contains('tt')).toBe(true);
  });

  it('tiene todos los ganchos data-test de DESIGN.md §6, una sola vez cada uno', () => {
    const view = mount();
    for (const hook of hooks) {
      const found = hook === 'tt' ? [view.el] : Array.from(view.el.querySelectorAll(`[data-test="${hook}"]`));
      expect(found, hook).toHaveLength(1);
    }
  });

  it('expone la accesibilidad del contrato', () => {
    const view = mount();
    const arm = q(view, 'tt-brazo');
    expect(arm.getAttribute('role')).toBe('slider');
    expect(arm.tabIndex).toBe(0);
    expect(arm.getAttribute('aria-valuenow')).toBe(String(REST_RADIUS_MM));
    expect(q(view, 'tt-pantalla').getAttribute('aria-live')).toBe('polite');
    for (const test of ['tt-start', 'tt-cue', 'tt-33', 'tt-45', 'tt-78', 'tt-centrador', 'tt-tapa', 'tt-cepillo', 'tt-encendido']) {
      const b = q<HTMLButtonElement>(view, test);
      expect(b.tagName, test).toBe('BUTTON');
      expect(b.hasAttribute('aria-pressed'), test).toBe(true);
    }
    const pitch = q<HTMLInputElement>(view, 'tt-pitch');
    expect([pitch.type, pitch.min, pitch.max, pitch.step]).toEqual(['range', '-8', '8', '0.1']);
    const volume = q<HTMLInputElement>(view, 'tt-volumen');
    expect([volume.type, volume.min, volume.max]).toEqual(['range', '0', '1']);
  });

  it('el eje, el centrador y el brillo son DOM fijo fuera del contenedor que gira', () => {
    const view = mount();
    const disc = q(view, 'tt-disco');
    for (const sel of ['.tt-eje', '.tt-adaptador', '.tt-brillo']) {
      const el = view.el.querySelector(sel);
      expect(el, sel).not.toBeNull();
      expect(disc.contains(el), sel).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('update', () => {
  it('con un frame sin disco no lanza y oculta el disco', () => {
    const view = mount();
    expect(() => view.update(makeFrame())).not.toThrow();
    expect(q(view, 'tt-disco').hidden).toBe(true);
    expect(view.el.querySelector<HTMLElement>('.tt-brillo')?.hidden).toBe(true);
    expect(q(view, 'tt-pantalla').textContent).toContain('Sin disco');
    expect(q<HTMLButtonElement>(view, 'tt-quitar').disabled).toBe(true);
    expect(q<HTMLButtonElement>(view, 'tt-voltear').disabled).toBe(true);
  });

  it('con un disco falso (canvas vacío, sin contexto 2D) no lanza y lo muestra a su tamaño', () => {
    const view = mount();
    expect(() => view.update(withDisc('12'))).not.toThrow();
    expect(q(view, 'tt-disco').hidden).toBe(false);
    const canvas = view.el.querySelector<HTMLCanvasElement>('.tt-disco-canvas');
    expect(canvas?.style.width).toBe(`${(302 * DEFAULT_PX_PER_MM).toFixed(3)}px`);
    expect(canvas?.style.height).toBe(canvas?.style.width);
    expect(q<HTMLButtonElement>(view, 'tt-quitar').disabled).toBe(false);

    view.update(withDisc('7'));
    expect(canvas?.style.width).toBe(`${(175 * DEFAULT_PX_PER_MM).toFixed(3)}px`);
  });

  it('copia el canvas compartido solo cuando cambia la referencia y nunca lo inserta en el DOM', () => {
    const view = mount();
    const shared = fakeDisc(64);
    view.update(withDisc('12', { discCanvas: shared }));
    const own = view.el.querySelector<HTMLCanvasElement>('.tt-disco-canvas');
    expect(own).not.toBe(shared);
    expect(view.el.contains(shared)).toBe(false);
    expect(own?.width).toBe(64);

    // Misma referencia: no se vuelve a copiar (blit ajustaría el tamaño).
    shared.width = 80;
    view.update(withDisc('12', { discCanvas: shared }));
    expect(own?.width).toBe(64);

    // Referencia nueva: se copia.
    view.update(withDisc('12', { discCanvas: fakeDisc(96) }));
    expect(own?.width).toBe(96);
  });

  it('el brillo se recorta al radio del formato y se oculta si !fancy', () => {
    const view = mount();
    view.update(withDisc('7'));
    const shine = view.el.querySelector<HTMLElement>('.tt-brillo');
    expect(shine?.hidden).toBe(false);
    expect(shine?.style.clipPath).toBe(`circle(${(87.5 * DEFAULT_PX_PER_MM).toFixed(3)}px at 50% 50%)`);
    view.update(withDisc('7', { fancy: false }));
    expect(shine?.hidden).toBe(true);
  });

  it('muestra el centrador solo con state.adapter45', () => {
    const view = mount();
    const adapter = view.el.querySelector<HTMLElement>('.tt-adaptador');
    view.update(makeFrame());
    expect(adapter?.hidden).toBe(true);
    view.update(makeFrame({ state: makeState({ adapter45: true }) }));
    expect(adapter?.hidden).toBe(false);
    expect(q(view, 'tt-centrador').getAttribute('aria-pressed')).toBe('true');
  });

  it('el disco gira con platterAngleDeg', () => {
    const view = mount();
    view.update(withDisc('12', { platterAngleDeg: 42 }));
    expect(q(view, 'tt-disco').style.transform).toContain('rotate(42.00deg)');
    expect(view.el.querySelector<HTMLElement>('.tt-plato')?.style.transform).toBe('rotate(42.00deg)');
  });

  it('agujero grande sin centrador: el disco orbita con radio (38,1 − 7,24)/2 mm', () => {
    const view = mount();
    view.update(withDisc('7', { discHole: 'large', platterAngleDeg: 0 }));
    const r = (ORBIT_RADIUS_MM * DEFAULT_PX_PER_MM).toFixed(2);
    expect(q(view, 'tt-disco').style.transform).toContain(`translate(${r}px, 0.00px)`);
    view.update(withDisc('7', { discHole: 'large', platterAngleDeg: 90 }));
    expect(q(view, 'tt-disco').style.transform).toContain(`translate(0.00px, ${r}px)`);
    // Con el centrador puesto ya no orbita.
    view.update(withDisc('7', { discHole: 'large', platterAngleDeg: 90, state: makeState({ adapter45: true }) }));
    expect(q(view, 'tt-disco').style.transform).toContain('translate(0.00px, 0.00px)');
  });

  it('alabeo: scaleY 1 ± 0,01·wobble', () => {
    const view = mount();
    view.update(withDisc('12', { wobble: 1, platterAngleDeg: 90 }));
    expect(q(view, 'tt-disco').style.transform).toContain('scaleY(1.0100)');
    view.update(withDisc('12', { wobble: 1, platterAngleDeg: 270 }));
    expect(q(view, 'tt-disco').style.transform).toContain('scaleY(0.9900)');
  });

  it('con prefers-reduced-motion la amplitud del bamboleo es 0', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('reduce'),
          media: query,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
    const view = mount();
    view.update(withDisc('7', { discHole: 'large', platterAngleDeg: 0, wobble: 1 }));
    expect(q(view, 'tt-disco').style.transform).toBe('translate(0.00px, 0.00px) scaleY(1.0000) rotate(0.00deg)');
  });

  it('refleja el estado en aria-pressed', () => {
    const view = mount();
    view.update(makeFrame({ state: makeState({ motor: true, speed: 45, lidOpen: false }), tool: 'brush' }));
    expect(q(view, 'tt-start').getAttribute('aria-pressed')).toBe('true');
    expect(q(view, 'tt-33').getAttribute('aria-pressed')).toBe('false');
    expect(q(view, 'tt-45').getAttribute('aria-pressed')).toBe('true');
    expect(q(view, 'tt-tapa').getAttribute('aria-pressed')).toBe('true');
    expect(q(view, 'tt-cepillo').getAttribute('aria-pressed')).toBe('true');
    expect(view.el.classList.contains('tt-es-tapa-abierta')).toBe(false);
    expect(view.el.querySelector<HTMLElement>('.tt-tapa-bloqueo')?.hidden).toBe(false);
  });

  it('mueve el brazo y actualiza aria-valuenow y aria-valuetext', () => {
    const view = mount();
    const arm = q(view, 'tt-brazo');
    view.update(withDisc('12', { state: makeState({ tonearm: { onRest: false, lifted: false, radiusMm: 120.4 } }) }));
    expect(arm.getAttribute('aria-valuenow')).toBe('120');
    expect(arm.getAttribute('aria-valuetext')).toBe('Cara A, canción 2, 3:10');
    const at120 = arm.style.transform;
    view.update(withDisc('12', { state: makeState({ tonearm: { onRest: false, lifted: false, radiusMm: 80 } }) }));
    expect(arm.style.transform).not.toBe(at120);
    expect(arm.style.transform).toMatch(/^rotate\(-?\d+\.\d+deg\)$/);
  });

  it('la pantalla muestra artista – título, cara y tiempo; entrada y salida; nada sin corriente', () => {
    const view = mount();
    const display = q(view, 'tt-pantalla');
    view.update(withDisc('12'));
    expect(display.textContent).toContain('Queen – Bohemian Rhapsody');
    expect(display.textContent).toContain('Cara A');
    expect(display.textContent).toContain('3:10 / 20:50');
    view.update(withDisc('12', { positionSec: -3 }));
    expect(display.textContent).toContain('entrada');
    view.update(withDisc('12', { positionSec: 1300 }));
    expect(display.textContent).toContain('salida');
    view.update(withDisc('12', { state: makeState({ power: false }) }));
    expect(display.textContent).toBe('');
  });

  it('sincroniza los deslizadores sin pelear por redondeos', () => {
    const view = mount();
    const pitch = q<HTMLInputElement>(view, 'tt-pitch');
    const volume = q<HTMLInputElement>(view, 'tt-volumen');
    view.update(makeFrame({ state: makeState({ pitchPercent: 1.5, volume: 1 }) }));
    expect(pitch.value).toBe('1.5');
    expect(volume.value).toBe('1');
    expect(view.el.querySelector('.tt-pitch-lectura')?.textContent).toBe('+1,5 %');
    expect(pitch.getAttribute('aria-valuetext')).toBe('+1,5 %');
    pitch.value = '0.3';
    view.update(makeFrame({ state: makeState({ pitchPercent: 0.1 + 0.2, volume: 1 }) }));
    expect(pitch.value).toBe('0.3');
  });

  it('solo toca el DOM cuando algo cambia', () => {
    const view = mount();
    const frame = withDisc('12', { platterAngleDeg: 10 });
    view.update(frame);
    const observer = new MutationObserver(() => undefined);
    observer.observe(view.el, { attributes: true, childList: true, subtree: true, characterData: true });
    view.update({ ...frame });
    expect(observer.takeRecords()).toHaveLength(0);
    // Control: un cambio real sí se ve.
    view.update({ ...frame, platterAngleDeg: 20 });
    expect(observer.takeRecords().length).toBeGreaterThan(0);
    observer.disconnect();
  });
});

// ---------------------------------------------------------------------------
// Botones y teclado
// ---------------------------------------------------------------------------

describe('botones', () => {
  it('cada botón llama a su acción', () => {
    const actions = makeActions();
    const view = mount(actions);
    view.update(withDisc('12'));
    q<HTMLButtonElement>(view, 'tt-start').click();
    expect(actions.toggleMotor).toHaveBeenCalledTimes(1);
    q<HTMLButtonElement>(view, 'tt-45').click();
    expect(actions.setSpeed).toHaveBeenLastCalledWith(45);
    q<HTMLButtonElement>(view, 'tt-33').click();
    expect(actions.setSpeed).toHaveBeenLastCalledWith(33);
    q<HTMLButtonElement>(view, 'tt-78').click();
    expect(actions.setSpeed).toHaveBeenLastCalledWith(78);
    q<HTMLButtonElement>(view, 'tt-encendido').click();
    expect(actions.powerToggle).toHaveBeenCalledTimes(1);
    q<HTMLButtonElement>(view, 'tt-tapa').click();
    expect(actions.toggleLid).toHaveBeenCalledTimes(1);
    q<HTMLButtonElement>(view, 'tt-centrador').click();
    expect(actions.toggleAdapter).toHaveBeenCalledTimes(1);
    q<HTMLButtonElement>(view, 'tt-quitar').click();
    expect(actions.removeDisc).toHaveBeenCalledTimes(1);
    q<HTMLButtonElement>(view, 'tt-voltear').click();
    expect(actions.flipDisc).toHaveBeenCalledTimes(1);
  });

  it('el cepillo alterna la herramienta y la palanca invierte la elevación', () => {
    const actions = makeActions();
    const view = mount(actions);
    view.update(makeFrame());
    q<HTMLButtonElement>(view, 'tt-cepillo').click();
    expect(actions.setTool).toHaveBeenLastCalledWith('brush');
    q<HTMLButtonElement>(view, 'tt-cue').click();
    expect(actions.setCue).toHaveBeenLastCalledWith(false);

    view.update(makeFrame({ tool: 'brush', state: makeState({ tonearm: { onRest: false, lifted: false, radiusMm: 100 } }) }));
    q<HTMLButtonElement>(view, 'tt-cepillo').click();
    expect(actions.setTool).toHaveBeenLastCalledWith('none');
    q<HTMLButtonElement>(view, 'tt-cue').click();
    expect(actions.setCue).toHaveBeenLastCalledWith(true);
  });

  it('los deslizadores llaman a setPitch y setVolume', () => {
    const actions = makeActions();
    const view = mount(actions);
    const pitch = q<HTMLInputElement>(view, 'tt-pitch');
    pitch.value = '-2.5';
    pitch.dispatchEvent(new Event('input', { bubbles: true }));
    expect(actions.setPitch).toHaveBeenLastCalledWith(-2.5);
    const volume = q<HTMLInputElement>(view, 'tt-volumen');
    volume.value = '0.4';
    volume.dispatchEvent(new Event('input', { bubbles: true }));
    expect(actions.setVolume).toHaveBeenLastCalledWith(0.4);
  });
});

describe('teclado', () => {
  it('las flechas mueven el brazo 2 mm y ↑/↓ suben y bajan la aguja, solo con el brazo enfocado', () => {
    const actions = makeActions();
    const view = mount(actions);
    view.update(makeFrame({ state: makeState({ tonearm: { onRest: false, lifted: false, radiusMm: 100 } }) }));
    const arm = q(view, 'tt-brazo');
    key(arm, 'ArrowLeft');
    expect(actions.moveTonearm).toHaveBeenLastCalledWith(98, false);
    key(arm, 'ArrowRight');
    expect(actions.moveTonearm).toHaveBeenLastCalledWith(102, false);
    key(arm, 'ArrowUp');
    expect(actions.setCue).toHaveBeenLastCalledWith(true);
    key(arm, 'ArrowDown');
    expect(actions.setCue).toHaveBeenLastCalledWith(false);

    actions.moveTonearm.mockClear();
    key(document.body, 'ArrowLeft');
    expect(actions.moveTonearm).not.toHaveBeenCalled();
  });

  it('más allá de 160 mm la flecha devuelve el brazo al soporte', () => {
    const actions = makeActions();
    const view = mount(actions);
    view.update(makeFrame({ state: makeState({ tonearm: { onRest: false, lifted: true, radiusMm: 159.5 } }) }));
    key(q(view, 'tt-brazo'), 'ArrowRight');
    expect(actions.moveTonearm).toHaveBeenLastCalledWith('rest', false);
  });

  it('la barra espaciadora arranca o para el motor salvo con el foco en un control', () => {
    const actions = makeActions();
    const view = mount(actions);
    view.update(makeFrame());
    key(document.body, ' ');
    expect(actions.toggleMotor).toHaveBeenCalledTimes(1);

    const b = q<HTMLButtonElement>(view, 'tt-45');
    b.focus();
    key(b, ' ');
    expect(actions.toggleMotor).toHaveBeenCalledTimes(1);

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    key(input, ' ');
    expect(actions.toggleMotor).toHaveBeenCalledTimes(1);
    input.remove();
  });
});

// ---------------------------------------------------------------------------
// Punteros
// ---------------------------------------------------------------------------

describe('arrastre del cabezal', () => {
  it('moveTonearm(r, true) durante el arrastre y moveTonearm(r, false) al soltar', () => {
    const actions = makeActions();
    const view = mount(actions);
    view.update(withDisc('12'));
    const head = q(view, 'tt-cabezal');
    const start = mmToClient(stylusPointForRadius(REST_RADIUS_MM));
    const target = mmToClient(stylusPointForRadius(100));

    head.dispatchEvent(pointer('pointerdown', start.x, start.y));
    expect(actions.moveTonearm).toHaveBeenLastCalledWith(REST_RADIUS_MM, true);
    head.dispatchEvent(pointer('pointermove', target.x, target.y));
    const [r, dragging] = actions.moveTonearm.mock.lastCall as [number, boolean];
    expect(r).toBeCloseTo(100, 6);
    expect(dragging).toBe(true);
    head.dispatchEvent(pointer('pointerup', target.x, target.y));
    const [rUp, draggingUp] = actions.moveTonearm.mock.lastCall as [number, boolean];
    expect(rUp).toBeCloseTo(100, 6);
    expect(draggingUp).toBe(false);
  });

  it('soltar fuera del disco (radio > 160) devuelve el brazo al soporte', () => {
    const actions = makeActions();
    const view = mount(actions);
    view.update(withDisc('12'));
    const head = q(view, 'tt-cabezal');
    const start = mmToClient(stylusPointForRadius(REST_RADIUS_MM));
    const off = mmToClient(stylusPointForRadius(163));
    head.dispatchEvent(pointer('pointerdown', start.x, start.y));
    head.dispatchEvent(pointer('pointermove', off.x, off.y));
    head.dispatchEvent(pointer('pointerup', off.x, off.y));
    expect(actions.moveTonearm).toHaveBeenLastCalledWith('rest', false);
  });

  it('con la tapa cerrada el cabezal no se arrastra', () => {
    const actions = makeActions();
    const view = mount(actions);
    view.update(withDisc('12', { state: makeState({ lidOpen: false }) }));
    const start = mmToClient(stylusPointForRadius(REST_RADIUS_MM));
    q(view, 'tt-cabezal').dispatchEvent(pointer('pointerdown', start.x, start.y));
    expect(actions.moveTonearm).not.toHaveBeenCalled();
  });
});

describe('mano y cepillo sobre el plato', () => {
  let now = 1000;
  beforeEach(() => {
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });

  function touchZone(view: TurntableView): HTMLElement {
    const el = view.el.querySelector<HTMLElement>('.tt-plato-toque');
    if (!el) throw new Error('falta la zona táctil del plato');
    return el;
  }

  it('arrastrar con tool none manda la velocidad angular y null al soltar', () => {
    const actions = makeActions();
    const view = mount(actions);
    view.update(withDisc('12'));
    const zone = touchZone(view);
    const R = 100;
    zone.dispatchEvent(pointer('pointerdown', R, 0));
    expect(actions.handPlatter).toHaveBeenLastCalledWith(0);

    // 10° cada 50 ms en sentido horario (y hacia abajo) = 200 °/s.
    for (let i = 1; i <= 4; i += 1) {
      now += 50;
      const a = (i * 10 * Math.PI) / 180;
      zone.dispatchEvent(pointer('pointermove', R * Math.cos(a), R * Math.sin(a)));
    }
    const speed = actions.handPlatter.mock.lastCall?.[0] as number;
    expect(speed).toBeCloseTo(200, 6);
    expect(actions.brushStroke).not.toHaveBeenCalled();

    zone.dispatchEvent(pointer('pointerup', 0, R));
    expect(actions.handPlatter).toHaveBeenLastCalledWith(null);
  });

  it('si la mano se queda quieta, el plato se sujeta (handPlatter(0))', () => {
    const actions = makeActions();
    const view = mount(actions);
    const frame = withDisc('12');
    view.update(frame);
    const zone = touchZone(view);
    zone.dispatchEvent(pointer('pointerdown', 100, 0));
    now += 20;
    zone.dispatchEvent(pointer('pointermove', 99, 14));
    expect(actions.handPlatter.mock.lastCall?.[0]).toBeGreaterThan(0);
    now += 200;
    view.update(frame);
    expect(actions.handPlatter).toHaveBeenLastCalledWith(0);
    zone.dispatchEvent(pointer('pointerup', 99, 14));
    expect(actions.handPlatter).toHaveBeenLastCalledWith(null);
  });

  it('con el cepillo, cada ~40 px sobre el disco es una pasada y el plato no se toca', () => {
    const actions = makeActions();
    const view = mount(actions);
    view.update(withDisc('12', { tool: 'brush' }));
    expect(view.el.classList.contains('tt-es-cepillo')).toBe(true);
    const zone = touchZone(view);
    zone.dispatchEvent(pointer('pointerdown', -80, 20));
    for (let x = -70; x <= 80; x += 10) {
      now += 10;
      zone.dispatchEvent(pointer('pointermove', x, 20));
    }
    zone.dispatchEvent(pointer('pointerup', 80, 20));
    expect(actions.brushStroke).toHaveBeenCalledTimes(4);
    for (const [strength] of actions.brushStroke.mock.calls as Array<[number]>) {
      expect(strength).toBeGreaterThanOrEqual(0);
      expect(strength).toBeLessThanOrEqual(1);
    }
    expect(actions.handPlatter).not.toHaveBeenCalled();
  });

  it('el cepillo no limpia nada sin disco', () => {
    const actions = makeActions();
    const view = mount(actions);
    view.update(makeFrame({ tool: 'brush' }));
    const zone = touchZone(view);
    zone.dispatchEvent(pointer('pointerdown', -80, 20));
    for (let x = -70; x <= 80; x += 10) {
      now += 10;
      zone.dispatchEvent(pointer('pointermove', x, 20));
    }
    zone.dispatchEvent(pointer('pointerup', 80, 20));
    expect(actions.brushStroke).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Escala
// ---------------------------------------------------------------------------

describe('escala', () => {
  it('discSizePx = 2 · radio · pxPerMm · devicePixelRatio', () => {
    const view = mount();
    const dpr = window.devicePixelRatio || 1;
    expect(view.discSizePx('12')).toBe(Math.round(302 * DEFAULT_PX_PER_MM * dpr));
    expect(view.discSizePx('7')).toBe(Math.round(175 * DEFAULT_PX_PER_MM * dpr));
  });

  it('la escala inicial cabe en 560 × 420 px', () => {
    expect(STAGE_MM.width * DEFAULT_PX_PER_MM).toBeLessThanOrEqual(560);
    expect(STAGE_MM.height * DEFAULT_PX_PER_MM).toBeLessThanOrEqual(420 + 1e-9);
  });

  it('onResize avisa cuando ResizeObserver mide otra anchura', () => {
    let measureCb: (() => void) | null = null;
    class FakeResizeObserver {
      constructor(cb: () => void) {
        measureCb = cb;
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const view = mount();
    const listener = vi.fn();
    const off = view.onResize(listener);
    Object.defineProperty(view.el, 'clientWidth', { configurable: true, value: 900 });
    Object.defineProperty(view.el, 'clientHeight', { configurable: true, value: 788 });
    measureCb?.();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(view.el.style.getPropertyValue('--tt-escala')).toBe((900 / STAGE_MM.width).toFixed(5));
    expect(view.discSizePx('12')).toBe(Math.round(302 * 2 * (window.devicePixelRatio || 1)));

    off();
    Object.defineProperty(view.el, 'clientWidth', { configurable: true, value: 450 });
    Object.defineProperty(view.el, 'clientHeight', { configurable: true, value: 394 });
    measureCb?.();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(view.discSizePx('12')).toBe(Math.round(302 * (window.devicePixelRatio || 1)));
  });
});

describe('destroy', () => {
  it('quita el elemento y deja de escuchar el teclado', () => {
    const actions = makeActions();
    const view = createTurntableView(actions);
    document.body.append(view.el);
    view.destroy();
    expect(view.el.isConnected).toBe(false);
    key(document.body, ' ');
    expect(actions.toggleMotor).not.toHaveBeenCalled();
  });
});
