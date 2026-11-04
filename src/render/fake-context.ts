/**
 * Contexto 2D falso para los tests del embalaje. happy-dom no rasteriza
 * (`getContext('2d')` devuelve null), así que esta imitación registra las
 * llamadas y devuelve medidas plausibles para recorrer todo el código de
 * dibujo sin un canvas real: `measureText` mide 0,55 em por carácter y, con
 * `nativeStretch`, responde a `fontStretch` como una fuente con eje de
 * anchura. Solo lo usan los tests; no forma parte de la aplicación.
 */

export interface FakeCall {
  name: string;
  args: unknown[];
}

export interface FakeContext extends CanvasRenderingContext2D {
  /** Llamadas a métodos y asignaciones de propiedades (`set:fillStyle`), en orden. */
  calls: FakeCall[];
  /** Textos pasados a `fillText` / `strokeText`, en orden. */
  texts: string[];
}

export interface FakeContextOptions {
  /** La fuente simulada responde a `fontStretch` (anchura nativa). */
  nativeStretch?: boolean;
}

export function createFakeContext(canvas: HTMLCanvasElement, options: FakeContextOptions = {}): FakeContext {
  const state: Record<string | symbol, unknown> = {
    font: '10px sans-serif',
    fontStretch: 'normal',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    lineWidth: 1,
    lineJoin: 'miter',
    lineCap: 'butt',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    shadowColor: 'rgba(0, 0, 0, 0)',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
  };
  const calls: FakeCall[] = [];
  const texts: string[] = [];
  const fontSize = (): number => {
    const m = /(\d+(?:\.\d+)?)px/.exec(String(state.font));
    return m ? Number(m[1]) : 10;
  };
  const stretchFactor = (): number => {
    if (!options.nativeStretch) return 1;
    return state.fontStretch === 'condensed' ? 0.8 : state.fontStretch === 'expanded' ? 1.2 : 1;
  };
  const gradient = (): unknown => ({ addColorStop: () => undefined });
  const imageData = (w: number, h: number): unknown => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
  const special: Record<string, (...args: unknown[]) => unknown> = {
    measureText: (text) => ({ width: String(text).length * fontSize() * 0.55 * stretchFactor() }),
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    createConicGradient: gradient,
    createPattern: () => ({ setTransform: () => undefined }),
    createImageData: (w, h) => imageData(Number(w), Number(h)),
    getImageData: (_x, _y, w, h) => imageData(Number(w), Number(h)),
    fillText: (text) => {
      texts.push(String(text));
    },
    strokeText: (text) => {
      texts.push(String(text));
    },
    isPointInPath: () => false,
    isPointInStroke: () => false,
    getLineDash: () => [],
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  };
  const proxy = new Proxy({} as Record<string | symbol, unknown>, {
    get(_target, prop) {
      if (prop === 'calls') return calls;
      if (prop === 'texts') return texts;
      if (prop === 'canvas') return canvas;
      if (prop in state) return state[prop];
      if (typeof prop !== 'string') return undefined;
      const fn = special[prop];
      return (...args: unknown[]) => {
        calls.push({ name: prop, args });
        return fn ? fn(...args) : undefined;
      };
    },
    set(_target, prop, value) {
      state[prop] = value;
      calls.push({ name: `set:${String(prop)}`, args: [value] });
      return true;
    },
    has(_target, prop) {
      return prop in state || typeof prop === 'string';
    },
  });
  return proxy as unknown as FakeContext;
}

export interface FakeContextInstall {
  /** Contextos creados desde la instalación, en orden. */
  contexts: FakeContext[];
  restore(): void;
}

/** Hace que `getContext('2d')` devuelva un contexto falso hasta llamar a `restore()`. */
export function installFakeContext(options: FakeContextOptions = {}): FakeContextInstall {
  const contexts: FakeContext[] = [];
  const proto = HTMLCanvasElement.prototype;
  const original = proto.getContext;
  const fake = function (this: HTMLCanvasElement, id: string): unknown {
    if (id !== '2d') return null;
    const ctx = createFakeContext(this, options);
    contexts.push(ctx);
    return ctx;
  };
  proto.getContext = fake as unknown as typeof original;
  return {
    contexts,
    restore: () => {
      proto.getContext = original;
    },
  };
}
