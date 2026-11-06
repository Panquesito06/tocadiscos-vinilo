/**
 * Vista previa en la parte superior del cajón del editor. Según la pestaña:
 *  - disco, surcos, agujero, galleta, canciones: la cara del disco (A/B
 *    conmutable) a 260 px CSS, con eje y, si el agujero es grande, centrador;
 *  - carpeta: portada, contraportada o interior desplegable (240 px);
 *  - funda interior: la funda (delante/detrás) con el disco dentro, que se
 *    ve por el troquel;
 *  - lomo: el lomo a 16 × 180 px CSS entre dos lomos de muestra grises;
 *  - funda exterior: la portada con la funda exterior encima.
 *
 * Los canvases de `renderers` son compartidos y de solo lectura: cada imagen
 * tiene aquí su canvas propio y se copia con `blit()` solo cuando cambia la
 * referencia devuelta. Los tamaños pedidos son píxeles de dispositivo.
 */
import type { EditorTab, SideId, Vinyl } from '../core/types';
import { blit, type Renderers } from '../render';
import { h, setText, toggleGroup } from './controls';
import type { EditorLocal, JacketView } from './context';

export type PreviewMode = 'disc' | 'jacket' | 'inner' | 'spine' | 'outer';

export const PREVIEW_MODE: Record<EditorTab, PreviewMode> = {
  disco: 'disc',
  surcos: 'disc',
  agujero: 'disc',
  galleta: 'disc',
  canciones: 'disc',
  'funda-interior': 'inner',
  carpeta: 'jacket',
  lomo: 'spine',
  'funda-exterior': 'outer',
};

/** Tamaños CSS de la vista previa. */
export const DISC_PREVIEW_PX = 260;
export const JACKET_PREVIEW_PX = 240;
export const GATEFOLD_PANEL_PX = 180;
export const SPINE_PREVIEW = { width: 16, height: 180 } as const;

const CAPTIONS: Record<PreviewMode, string> = {
  disc: '',
  jacket: '',
  inner: 'La funda interior con el disco dentro: el troquel deja ver la galleta.',
  spine: 'El lomo a escala, entre otros dos discos de la estantería.',
  outer: 'La carpeta dentro de su funda exterior.',
};

/** Canvas propio de la vista previa: copia el canvas compartido solo cuando cambia. */
export class CanvasSlot {
  readonly canvas: HTMLCanvasElement;
  private source: HTMLCanvasElement | null = null;

  constructor(className: string) {
    this.canvas = h('canvas', className);
    this.canvas.setAttribute('role', 'img');
  }

  show(source: HTMLCanvasElement | null, cssWidth: number, cssHeight: number, label: string): void {
    if (!source) {
      this.canvas.hidden = true;
      this.source = null;
      return;
    }
    this.canvas.hidden = false;
    const w = `${cssWidth}px`;
    const hgt = `${cssHeight}px`;
    if (this.canvas.style.width !== w) this.canvas.style.width = w;
    if (this.canvas.style.height !== hgt) this.canvas.style.height = hgt;
    if (this.canvas.getAttribute('aria-label') !== label) this.canvas.setAttribute('aria-label', label);
    if (source !== this.source) {
      blit(this.canvas, source);
      this.source = source;
    }
  }

  /** Olvida la copia actual (la próxima `show` vuelve a copiar). */
  reset(): void {
    this.source = null;
  }
}

export interface PreviewView {
  readonly el: HTMLElement;
  update(vinyl: Vinyl, tab: EditorTab): void;
  /** Fuerza a pedir de nuevo los canvases (p. ej. al terminar de cargar una imagen). */
  invalidate(): void;
  clear(): void;
}

interface Memo {
  vinyl: Vinyl;
  tab: EditorTab;
  side: SideId;
  jacketView: JacketView;
  sleeveFace: 'front' | 'back';
  dpr: number;
  epoch: number;
}

const devicePx = (css: number, dpr: number): number => Math.max(1, Math.round(css * dpr));

/**
 * `getLocal` da el estado local de la sesión de edición; `onLocalChange` se
 * llama cuando un conmutador de la vista previa lo cambia.
 */
export function createPreview(
  renderers: Renderers,
  getLocal: () => EditorLocal | null,
  onLocalChange: () => void,
): PreviewView {
  const slots = {
    disc: new CanvasSlot('ed-preview__disc'),
    innerDisc: new CanvasSlot('ed-preview__disc'),
    sleeve: new CanvasSlot('ed-preview__layer'),
    jacket: new CanvasSlot('ed-preview__jacket'),
    gatefold: new CanvasSlot('ed-preview__jacket'),
    outerJacket: new CanvasSlot('ed-preview__jacket'),
    outer: new CanvasSlot('ed-preview__layer'),
    spine: new CanvasSlot('ed-preview__spine'),
  };
  const groups: Record<PreviewMode, HTMLElement> = {
    disc: h('div', 'ed-preview__group', [slots.disc.canvas]),
    inner: h('div', 'ed-preview__group ed-stack', [slots.innerDisc.canvas, slots.sleeve.canvas]),
    jacket: h('div', 'ed-preview__group', [slots.jacket.canvas, slots.gatefold.canvas]),
    outer: h('div', 'ed-preview__group ed-stack', [slots.outerJacket.canvas, slots.outer.canvas]),
    spine: h('div', 'ed-preview__group ed-spines', [
      h('div', 'ed-spine-sample'),
      slots.spine.canvas,
      h('div', 'ed-spine-sample ed-spine-sample--baja'),
    ]),
  };

  const setLocal = (apply: (local: EditorLocal) => void): void => {
    const local = getLocal();
    if (!local) return;
    apply(local);
    onLocalChange();
  };
  const sideToggle = toggleGroup<SideId>({
    label: 'Cara que se ve',
    options: [
      { value: 'A', label: 'Cara A' },
      { value: 'B', label: 'Cara B' },
    ],
    dataTest: 'editor-vista-cara',
    onSelect: (side) => setLocal((l) => (l.side = side)),
  });
  const jacketToggle = toggleGroup<JacketView>({
    label: 'Parte de la carpeta',
    options: [
      { value: 'front', label: 'Portada' },
      { value: 'back', label: 'Contraportada' },
      { value: 'inside', label: 'Interior' },
    ],
    dataTest: 'editor-vista-carpeta',
    onSelect: (view) => setLocal((l) => (l.jacketView = view)),
  });
  const insideButton = jacketToggle.el.querySelector<HTMLElement>('[data-test="editor-vista-carpeta-inside"]');
  const sleeveToggle = toggleGroup<'front' | 'back'>({
    label: 'Cara de la funda',
    options: [
      { value: 'front', label: 'Delante' },
      { value: 'back', label: 'Detrás' },
    ],
    dataTest: 'editor-vista-funda',
    onSelect: (face) => setLocal((l) => (l.sleeveFace = face)),
  });
  /** Cada conmutador solo se ve en su modo. */
  const toggles: readonly [PreviewMode, HTMLElement][] = [
    ['disc', sideToggle.el],
    ['jacket', jacketToggle.el],
    ['inner', sleeveToggle.el],
  ];

  const stage = h('div', 'ed-preview__stage', Object.values(groups));
  const caption = h('p', 'ed-preview__caption');
  const controls = h('div', 'ed-preview__controls', [sideToggle.el, jacketToggle.el, sleeveToggle.el]);
  const summary = h('summary', 'ed-preview__summary', ['Vista previa']);
  const el = h('details', 'ed-preview', [summary, stage, controls, caption]);
  el.open = true;

  let memo: Memo | null = null;
  let epoch = 0;
  let last: { vinyl: Vinyl; tab: EditorTab } | null = null;

  function showMode(mode: PreviewMode): void {
    for (const [m, g] of Object.entries(groups) as [PreviewMode, HTMLElement][]) g.hidden = m !== mode;
    for (const [m, t] of toggles) t.hidden = m !== mode;
    stage.dataset.mode = mode;
    setText(caption, CAPTIONS[mode]);
    caption.hidden = !CAPTIONS[mode];
  }

  function drawDisc(v: Vinyl, local: EditorLocal, dpr: number): void {
    const source = renderers.disc(v, {
      sizePx: devicePx(DISC_PREVIEW_PX, dpr),
      side: local.side,
      showDust: true,
      adapter45: v.disc.hole === 'large',
      spindle: true,
      quality: 'high',
    });
    slots.disc.show(source, DISC_PREVIEW_PX, DISC_PREVIEW_PX, `Cara ${local.side} del disco`);
    sideToggle.set(local.side);
  }

  function drawInner(v: Vinyl, local: EditorLocal, dpr: number): void {
    const size = devicePx(JACKET_PREVIEW_PX, dpr);
    const side: SideId = local.sleeveFace === 'front' ? 'A' : 'B';
    const disc = renderers.disc(v, { sizePx: size, side, showDust: false, adapter45: false, spindle: false, quality: 'high' });
    slots.innerDisc.show(disc, JACKET_PREVIEW_PX, JACKET_PREVIEW_PX, `Cara ${side} del disco`);
    const face = local.sleeveFace === 'front' ? 'delante' : 'detrás';
    slots.sleeve.show(renderers.innerSleeve(v, size, local.sleeveFace), JACKET_PREVIEW_PX, JACKET_PREVIEW_PX, `Funda interior, ${face}`);
    sleeveToggle.set(local.sleeveFace);
  }

  function drawJacket(v: Vinyl, local: EditorLocal, dpr: number): void {
    const view: JacketView = local.jacketView === 'inside' && !v.jacket.gatefold ? 'front' : local.jacketView;
    if (insideButton) insideButton.hidden = !v.jacket.gatefold;
    jacketToggle.set(view);
    if (view === 'inside') {
      slots.jacket.show(null, 0, 0, '');
      const panel = devicePx(GATEFOLD_PANEL_PX, dpr);
      slots.gatefold.show(renderers.gatefold(v, panel), GATEFOLD_PANEL_PX * 2, GATEFOLD_PANEL_PX, 'Interior de la carpeta desplegable');
      return;
    }
    slots.gatefold.show(null, 0, 0, '');
    const size = devicePx(JACKET_PREVIEW_PX, dpr);
    const source = view === 'front' ? renderers.jacketFront(v, size) : renderers.jacketBack(v, size);
    slots.jacket.show(source, JACKET_PREVIEW_PX, JACKET_PREVIEW_PX, view === 'front' ? 'Portada' : 'Contraportada');
  }

  function drawOuter(v: Vinyl, dpr: number): void {
    const size = devicePx(JACKET_PREVIEW_PX, dpr);
    slots.outerJacket.show(renderers.jacketFront(v, size), JACKET_PREVIEW_PX, JACKET_PREVIEW_PX, 'Portada');
    slots.outer.show(renderers.outerSleeve(v, size), JACKET_PREVIEW_PX, JACKET_PREVIEW_PX, 'Funda exterior');
  }

  function drawSpine(v: Vinyl, dpr: number): void {
    const { width, height } = SPINE_PREVIEW;
    slots.spine.show(renderers.spine(v, devicePx(width, dpr), devicePx(height, dpr)), width, height, 'Lomo del vinilo');
  }

  function unchanged(next: Memo): boolean {
    const m = memo;
    return (
      m !== null &&
      m.vinyl === next.vinyl &&
      m.tab === next.tab &&
      m.side === next.side &&
      m.jacketView === next.jacketView &&
      m.sleeveFace === next.sleeveFace &&
      m.dpr === next.dpr &&
      m.epoch === next.epoch
    );
  }

  function update(vinyl: Vinyl, tab: EditorTab): void {
    last = { vinyl, tab };
    const local = getLocal();
    if (!local) return;
    const dpr = window.devicePixelRatio || 1;
    const next: Memo = { vinyl, tab, side: local.side, jacketView: local.jacketView, sleeveFace: local.sleeveFace, dpr, epoch };
    if (unchanged(next)) return;
    memo = next;
    const mode = PREVIEW_MODE[tab];
    showMode(mode);
    if (mode === 'disc') drawDisc(vinyl, local, dpr);
    else if (mode === 'inner') drawInner(vinyl, local, dpr);
    else if (mode === 'jacket') drawJacket(vinyl, local, dpr);
    else if (mode === 'outer') drawOuter(vinyl, dpr);
    else drawSpine(vinyl, dpr);
  }

  // Hasta el primer `update` no hay modo: ningún conmutador a la vista.
  for (const [, t] of toggles) t.hidden = true;

  return {
    el,
    update,
    invalidate() {
      epoch += 1;
      if (last) update(last.vinyl, last.tab);
    },
    clear() {
      memo = null;
      last = null;
      for (const slot of Object.values(slots)) {
        slot.reset();
        slot.canvas.hidden = true;
      }
    },
  };
}
