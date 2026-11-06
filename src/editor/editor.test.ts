import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVinyl, gradient, presetNormal, sideOf, spineTextFor, track } from '../core/defaults';
import { maxRingWidthMm } from '../core/geometry';
import type { EditorTab, Fill, Vinyl } from '../core/types';
import { createEditorView, type EditorDeps, type EditorView } from './editor';
import { DISC_PREVIEW_PX, SPINE_PREVIEW } from './preview';
import {
  byLabel,
  byTest,
  choose,
  createDeps,
  createFakeRenderers,
  createFakeStore,
  pickFiles,
  setChecked,
  settle,
  stateWith,
  typeInto,
  type FakeRenderers,
  type FakeStore,
} from './test-fakes';

function sampleVinyl(): Vinyl {
  return presetNormal(
    { artist: 'Queen', title: 'A Night at the Opera', labelName: 'EMI', catalogNumber: 'EMTC 103', year: '1975' },
    [track('Death on Two Legs', 223), track("Lazing on a Sunday Afternoon", 68)],
    [track('Bohemian Rhapsody', 355)],
  );
}

interface Setup {
  store: FakeStore;
  renderers: FakeRenderers;
  deps: EditorDeps & { closed: number };
  view: EditorView;
  vinyl: Vinyl;
  current(): Vinyl;
  refresh(): void;
  tab(id: EditorTab): void;
}

function setup(tab: EditorTab = 'disco', extra: Vinyl[] = [], importAudio?: EditorDeps['importAudio']): Setup {
  const vinyl = sampleVinyl();
  const store = createFakeStore(stateWith([vinyl, ...extra], { view: 'editor', editorVinylId: vinyl.id, editorTab: tab }));
  const renderers = createFakeRenderers();
  const deps = createDeps(store, renderers, importAudio);
  const view = createEditorView(deps);
  document.body.append(view.el);
  // Como hace la aplicación: cada cambio del store llega a la vista.
  store.subscribe((state) => view.update(state));
  view.update(store.getState());
  const current = (): Vinyl => {
    const v = store.getState().vinyls.find((x) => x.id === vinyl.id);
    if (!v) throw new Error('El vinilo ya no está');
    return v;
  };
  return {
    store,
    renderers,
    deps,
    view,
    vinyl,
    current,
    refresh: () => view.update(store.getState()),
    tab: (id) => byTest(view.el, `editor-tab-${id}`).click(),
  };
}

const panelOf = (view: EditorView): HTMLElement => view.el.querySelector<HTMLElement>('[role="tabpanel"]') as HTMLElement;

beforeEach(() => {
  vi.stubGlobal('createImageBitmap', async () => ({ width: 640, height: 480, close: () => undefined }));
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createEditorView', () => {
  it('se construye sin lanzar y muestra un aviso si no hay vinilo que editar', () => {
    const store = createFakeStore(stateWith([]));
    const view = createEditorView(createDeps(store, createFakeRenderers()));
    expect(view.el.dataset.test).toBe('editor');
    expect(() => view.update(store.getState())).not.toThrow();
    expect(view.el.querySelector('.ed-empty')?.hasAttribute('hidden')).toBe(false);
    expect(view.el.querySelector('.ed-form')?.hasAttribute('hidden')).toBe(true);
  });

  it('tiene las pestañas con role=tab, aria-selected y su panel', () => {
    const { view } = setup('lomo');
    const tabs = Array.from(view.el.querySelectorAll('[role="tab"]'));
    expect(tabs).toHaveLength(9);
    const selected = byTest(view.el, 'editor-tab-lomo');
    expect(selected.getAttribute('aria-selected')).toBe('true');
    expect(byTest(view.el, 'editor-tab-disco').getAttribute('aria-selected')).toBe('false');
    expect(panelOf(view).getAttribute('aria-labelledby')).toBe(selected.id);
  });

  it('en la pestaña lomo, escribir en el texto llama a store.update y sube updatedAt', () => {
    const { view, store, current, vinyl } = setup('lomo');
    const before = current().updatedAt;
    const updates = store.updates;
    const input = byTest<HTMLInputElement>(view.el, 'editor-lomo-texto');
    expect(input.value).toBe('Queen — A Night at the Opera');
    typeInto(input, 'QUEEN — Ópera');
    expect(store.updates).toBe(updates + 1);
    expect(current().spine.text).toBe('QUEEN — Ópera');
    expect(current().updatedAt).toBeGreaterThan(before);
    expect(current().id).toBe(vinyl.id);
  });

  it('cambiar el título general propaga al lomo y a la galleta de ambas caras', () => {
    const { view, current } = setup('lomo');
    typeInto(byTest<HTMLInputElement>(view.el, 'editor-titulo'), 'Sheer Heart Attack');
    expect(current().meta.title).toBe('Sheer Heart Attack');
    expect(current().spine.text).toBe('Queen — Sheer Heart Attack');
    expect(current().disc.sides.map((s) => s.label.fields.title)).toEqual(['Sheer Heart Attack', 'Sheer Heart Attack']);
    // El campo del lomo (sin foco) se sincroniza con el nuevo valor.
    expect(byTest<HTMLInputElement>(view.el, 'editor-lomo-texto').value).toBe('Queen — Sheer Heart Attack');
  });

  it('no propaga el título a un lomo personalizado', () => {
    const { view, current } = setup('lomo');
    typeInto(byTest<HTMLInputElement>(view.el, 'editor-lomo-texto'), 'Mi lomo');
    typeInto(byTest<HTMLInputElement>(view.el, 'editor-artista'), 'Freddie');
    expect(current().spine.text).toBe('Mi lomo');
    expect(current().disc.sides[0].label.fields.artist).toBe('Freddie');
  });

  it('cambiar de pestaña reconstruye el panel', () => {
    const { view, store } = setup('lomo');
    const lomoInput = byTest(view.el, 'editor-lomo-texto');
    byTest(view.el, 'editor-tab-disco').click();
    expect(store.getState().ui.editorTab).toBe('disco');
    expect(lomoInput.isConnected).toBe(false);
    expect(panelOf(view).querySelector('[data-test="editor-formato"]')).not.toBeNull();
    expect(byTest(view.el, 'editor-tab-disco').getAttribute('aria-selected')).toBe('true');
  });

  it('no reconstruye ni pisa el campo con foco mientras se escribe', () => {
    const { view, store, vinyl } = setup('lomo');
    const title = byTest<HTMLInputElement>(view.el, 'editor-titulo');
    title.focus();
    typeInto(title, 'Escribiendo');
    // Un cambio externo (p. ej. la física) llega mientras se escribe.
    store.update((d) => {
      const v = d.vinyls.find((x) => x.id === vinyl.id);
      if (v) v.disc.condition.dust = 0.5;
    });
    title.value = 'Escribiendo más';
    store.update((d) => {
      const v = d.vinyls.find((x) => x.id === vinyl.id);
      if (v) v.meta.title = 'Otro';
    });
    expect(byTest(view.el, 'editor-titulo')).toBe(title);
    expect(title.value).toBe('Escribiendo más');
  });

  it('"Aplicar preset aro" pone decoración ring en ambas caras y conserva las pistas', () => {
    const { view, current, vinyl } = setup('disco');
    const tracksBefore = vinyl.disc.sides.map((s) => s.tracks.map((t) => t.id));
    byTest(view.el, 'editor-preset-ring').click();
    expect(current().disc.sides.map((s) => s.decoration)).toEqual(['ring', 'ring']);
    expect(current().disc.sides.map((s) => s.tracks.map((t) => t.id))).toEqual(tracksBefore);
    expect(current().meta.title).toBe('A Night at the Opera');
  });

  it('Cerrar llama a close; Eliminar pide confirmación y quita el vinilo', async () => {
    const { view, deps, store, renderers, vinyl } = setup('disco');
    byTest(view.el, 'editor-cerrar').click();
    expect(deps.closed).toBe(1);

    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    byTest(view.el, 'editor-eliminar').click();
    expect(confirm).toHaveBeenCalledOnce();
    expect(store.getState().vinyls).toHaveLength(1);

    confirm.mockReturnValue(true);
    byTest(view.el, 'editor-eliminar').click();
    await settle();
    expect(store.getState().vinyls).toHaveLength(0);
    expect(deps.closed).toBe(2);
    expect(renderers.invalidated).toContain(vinyl.id);
    // La sesión ha terminado: el formulario congelado ya no escribe.
    const updates = store.updates;
    typeInto(byTest<HTMLInputElement>(view.el, 'editor-titulo'), 'Nada');
    expect(store.updates).toBe(updates);
  });

  it('al cerrar conserva el contenido mientras se desliza; abierto sin vinilo muestra el aviso', () => {
    const { view, store, vinyl } = setup('lomo');
    const form = view.el.querySelector('.ed-form') as HTMLElement;
    store.update((d) => {
      d.ui.view = 'room';
      d.ui.editorVinylId = null;
    });
    expect(form.hidden).toBe(false);
    expect(byTest(view.el, 'editor-lomo-texto').isConnected).toBe(true);
    store.update((d) => {
      d.ui.view = 'editor';
    });
    expect(form.hidden).toBe(true);
    expect((view.el.querySelector('.ed-empty') as HTMLElement).hidden).toBe(false);
    store.update((d) => {
      d.ui.editorVinylId = vinyl.id;
    });
    expect(form.hidden).toBe(false);
    expect(byTest<HTMLInputElement>(view.el, 'editor-lomo-texto').value).toBe('Queen — A Night at the Opera');
  });

  it('volver a abrir el cajón empieza una sesión nueva (el grosor vuelve a seguir al peso)', () => {
    const { view, store, current, vinyl } = setup('disco');
    typeInto(byTest<HTMLInputElement>(view.el, 'editor-grosor'), '1.3', true);
    store.update((d) => {
      d.ui.view = 'room';
    });
    store.update((d) => {
      d.ui.view = 'editor';
      d.ui.editorVinylId = vinyl.id;
    });
    choose(byTest<HTMLSelectElement>(view.el, 'editor-peso'), '180');
    expect(current().disc.thicknessMm).toBeCloseTo(1.9);
  });

  it('Escape cierra el cajón', () => {
    const { view, deps } = setup('disco');
    byTest(view.el, 'editor-titulo').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(deps.closed).toBe(1);
  });

  it('las flechas recorren las pestañas', () => {
    const { view, store } = setup('disco');
    const disco = byTest(view.el, 'editor-tab-disco');
    disco.focus();
    disco.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(store.getState().ui.editorTab).toBe('surcos');
    byTest(view.el, 'editor-tab-surcos').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(store.getState().ui.editorTab).toBe('canciones');
  });

  it('reinicia la sesión al editar otro vinilo', () => {
    const other = createVinyl({ meta: { artist: 'Otro', title: 'Disco' } });
    const { view, store } = setup('lomo', [other]);
    store.update((d) => {
      d.ui.editorVinylId = other.id;
    });
    expect(byTest<HTMLInputElement>(view.el, 'editor-artista').value).toBe('Otro');
    expect(byTest<HTMLInputElement>(view.el, 'editor-lomo-texto').value).toBe('Otro — Disco');
  });
});

describe('vista previa', () => {
  it('pide el disco a 260 px × dpr con eje y centrador según el agujero, y lo copia en un canvas propio', () => {
    const { view, renderers, store, vinyl } = setup('galleta');
    const last = renderers.calls.filter((c) => c.kind === 'disc').at(-1);
    expect(last?.args[0]).toMatchObject({ sizePx: DISC_PREVIEW_PX * (window.devicePixelRatio || 1), side: 'A', spindle: true, adapter45: false });
    const own = view.el.querySelector<HTMLCanvasElement>('.ed-preview__disc');
    expect(own).not.toBeNull();
    expect(own).not.toBe(last?.result);
    expect(own?.style.width).toBe(`${DISC_PREVIEW_PX}px`);
    // happy-dom no da contexto 2D: blit() no dibuja, pero el canvas propio toma el tamaño pedido.
    expect(own?.width).toBe(last?.result?.width);
    expect(own?.height).toBe(last?.result?.height);

    store.update((d) => {
      const v = d.vinyls.find((x) => x.id === vinyl.id);
      if (v) v.disc.hole = 'large';
    });
    expect(renderers.calls.filter((c) => c.kind === 'disc').at(-1)?.args[0]).toMatchObject({ adapter45: true });
  });

  it('el conmutador A/B de la vista previa cambia la cara dibujada y la de la pestaña', () => {
    const { view, renderers } = setup('galleta');
    byTest(view.el, 'editor-vista-cara-B').click();
    expect(renderers.calls.filter((c) => c.kind === 'disc').at(-1)?.args[0]).toMatchObject({ side: 'B' });
    expect(byTest(view.el, 'editor-cara-B').getAttribute('aria-pressed')).toBe('true');
  });

  it('en el lomo pide 16 × 180 px × dpr y lo pone entre dos lomos de muestra', () => {
    const { view, renderers } = setup('lomo');
    const dpr = window.devicePixelRatio || 1;
    expect(renderers.calls.filter((c) => c.kind === 'spine').at(-1)?.args).toEqual([SPINE_PREVIEW.width * dpr, SPINE_PREVIEW.height * dpr]);
    const group = view.el.querySelector('.ed-spines');
    expect(group?.querySelectorAll('.ed-spine-sample')).toHaveLength(2);
    expect(group?.children[1]?.classList.contains('ed-preview__spine')).toBe(true);
  });

  it('no vuelve a copiar si la referencia del canvas no cambia y sí tras cargar una imagen', () => {
    const { view, renderers, refresh } = setup('carpeta');
    const count = (): number => renderers.calls.filter((c) => c.kind === 'jacketFront').length;
    const n = count();
    refresh();
    expect(count()).toBe(n);
    renderers.fireImageLoad();
    expect(count()).toBe(n + 1);
    expect(view.el.querySelector('.ed-preview__jacket')).not.toBeNull();
  });

  it('la funda exterior se dibuja sobre la portada', () => {
    const { renderers } = setup('funda-exterior');
    const kinds = renderers.calls.map((c) => c.kind);
    expect(kinds).toContain('jacketFront');
    expect(kinds).toContain('outerSleeve');
  });
});

describe('pestañas', () => {
  it('disco: el grosor sigue al peso salvo que se edite a mano', () => {
    const { view, current } = setup('disco');
    choose(byTest<HTMLSelectElement>(view.el, 'editor-peso'), '180');
    expect(current().disc.weightGrams).toBe(180);
    expect(current().disc.thicknessMm).toBeCloseTo(1.9);
    typeInto(byTest<HTMLInputElement>(view.el, 'editor-grosor'), '1.3', true);
    expect(current().disc.thicknessMm).toBeCloseTo(1.3);
    choose(byTest<HTMLSelectElement>(view.el, 'editor-peso'), '200');
    expect(current().disc.thicknessMm).toBeCloseTo(1.3);
  });

  it('disco: "Limpiar a fondo" pone el polvo a 0; el segundo color solo con salpicado o mármol', () => {
    const { view, current } = setup('disco');
    byTest(view.el, 'editor-limpiar').click();
    expect(current().disc.condition.dust).toBe(0);
    expect(current().disc.condition.lastCleanedAt).not.toBeNull();
    const color2 = byLabel(view.el, 'Segundo color').closest('.ed-field') as HTMLElement;
    expect(color2.hidden).toBe(true);
    choose(byLabel<HTMLSelectElement>(view.el, 'Material'), 'marble');
    expect(color2.hidden).toBe(false);
  });

  it('agujero: el grande muestra el aviso del centrador', () => {
    const { view, current } = setup('agujero');
    const warning = byTest(view.el, 'editor-aviso-agujero');
    expect(warning.hidden).toBe(true);
    const large = view.el.querySelector<HTMLInputElement>('input[type="radio"][value="large"]') as HTMLInputElement;
    setChecked(large, true);
    expect(current().disc.hole).toBe('large');
    expect(warning.hidden).toBe(false);
    expect(warning.textContent).toContain('El agujero grande necesita el centrador en el plato');
  });

  it('galleta: con decoración completa se ocultan los campos salvo el anillo del agujero', () => {
    const { view, current } = setup('galleta');
    const background = byTest(view.el, 'editor-galleta-fondo');
    const copyright = byTest(view.el, 'editor-copyright-mostrar').closest('fieldset') as HTMLElement;
    const holeRing = byTest(view.el, 'editor-anillo').closest('fieldset') as HTMLElement;
    const artwork = byTest(view.el, 'editor-obra');
    expect(artwork.hidden).toBe(true);
    choose(byTest<HTMLSelectElement>(view.el, 'editor-decoracion'), 'full');
    expect(current().disc.sides[0].decoration).toBe('full');
    expect(current().disc.sides[0].artwork).not.toBeNull();
    expect(background.hidden).toBe(true);
    expect(copyright.hidden).toBe(true);
    expect(holeRing.hidden).toBe(false);
    expect(artwork.hidden).toBe(false);
  });

  it('galleta: el aro se limita a maxRingWidthMm y se edita la cara elegida', () => {
    const { view, current } = setup('galleta');
    byTest(view.el, 'editor-cara-B').click();
    choose(byTest<HTMLSelectElement>(view.el, 'editor-decoracion'), 'ring');
    expect(current().disc.sides[1].decoration).toBe('ring');
    expect(current().disc.sides[0].decoration).toBe('normal');
    const width = byTest<HTMLInputElement>(view.el, 'editor-aro-anchura');
    expect(Number(width.max)).toBe(maxRingWidthMm('12'));
    width.value = '9.5';
    width.dispatchEvent(new Event('input', { bubbles: true }));
    expect(current().disc.sides[1].ring.widthMm).toBe(9.5);
  });

  it('galleta: líneas extra, copyright y copiar a la otra cara', () => {
    const { view, current } = setup('galleta');
    byTest(view.el, 'editor-linea-anadir').click();
    byTest(view.el, 'editor-linea-anadir').click();
    typeInto(byTest<HTMLInputElement>(view.el, 'editor-linea-1'), 'Grabado en Londres');
    expect(current().disc.sides[0].label.fields.extraLines).toEqual(['', 'Grabado en Londres']);
    byTest(view.el, 'editor-linea-quitar-0').click();
    expect(current().disc.sides[0].label.fields.extraLines).toEqual(['Grabado en Londres']);
    setChecked(byTest<HTMLInputElement>(view.el, 'editor-copyright-mostrar'), false);
    expect(current().disc.sides[0].label.fields.showCopyright).toBe(false);
    expect(byTest(view.el, 'editor-copyright').closest('.ed-field')?.hasAttribute('hidden')).toBe(true);
    byTest(view.el, 'editor-copiar-cara').click();
    expect(current().disc.sides[1].label.fields.extraLines).toEqual(['Grabado en Londres']);
    expect(current().disc.sides[1].tracks.map((t) => t.title)).toEqual(['Bohemian Rhapsody']);
  });

  it('carpeta: añadir y quitar la pegatina', () => {
    const { view, current } = setup('carpeta');
    byTest(view.el, 'editor-pegatina-anadir').click();
    expect(current().jacket.sticker).not.toBeNull();
    typeInto(byTest<HTMLInputElement>(view.el, 'editor-pegatina-texto'), '250 pts');
    expect(current().jacket.sticker?.text).toBe('250 pts');
    byTest(view.el, 'editor-pegatina-quitar').click();
    expect(current().jacket.sticker).toBeNull();
  });

  it('lomo: "Usar artista — título" recupera el texto derivado', () => {
    const { view, current } = setup('lomo');
    typeInto(byTest<HTMLInputElement>(view.el, 'editor-lomo-texto'), 'Cualquier cosa');
    byTest(view.el, 'editor-lomo-usar-meta').click();
    expect(current().spine.text).toBe(spineTextFor(current().meta));
  });
});

describe('imágenes y blobs', () => {
  it('subir una imagen de galleta guarda el blob con sus medidas; sustituirla borra la anterior', async () => {
    const { view, store, renderers, current } = setup('galleta');
    const input = byTest<HTMLInputElement>(view.el, 'editor-galleta-imagen');
    pickFiles(input, [new File(['a'], 'logo.png', { type: 'image/png' })]);
    await settle();
    const first = current().disc.sides[0].label.image;
    expect(first).toMatchObject({ name: 'logo.png', width: 640, height: 480 });
    expect(store.blobData.has(first?.blobKey ?? '')).toBe(true);

    pickFiles(byTest<HTMLInputElement>(view.el, 'editor-galleta-imagen'), [new File(['b'], 'otro.png', { type: 'image/png' })]);
    await settle();
    const second = current().disc.sides[0].label.image;
    expect(second?.name).toBe('otro.png');
    expect(store.deletedBlobs).toContain(first?.blobKey);
    expect(renderers.forgotten).toContain(first?.blobKey);
  });

  it('no borra una imagen que otro vinilo sigue usando', () => {
    const shared: Fill = { kind: 'image', image: { blobKey: 'compartida' }, fit: 'cover', backdrop: '#000000' };
    const other = createVinyl({ jacket: { front: shared } });
    const { view, store, current, vinyl } = setup('carpeta', [other]);
    store.update((d) => {
      const v = d.vinyls.find((x) => x.id === vinyl.id);
      if (v) v.jacket.front = structuredClone(shared);
    });
    const kind = byTest(view.el, 'editor-portada').querySelector('select') as HTMLSelectElement;
    choose(kind, 'solid');
    expect(current().jacket.front.kind).toBe('solid');
    expect(store.deletedBlobs).not.toContain('compartida');
  });

  it('rechaza un archivo que no es una imagen', async () => {
    const { view, current } = setup('galleta');
    pickFiles(byTest<HTMLInputElement>(view.el, 'editor-galleta-imagen'), [new File(['x'], 'nota.txt', { type: 'text/plain' })]);
    await settle();
    expect(current().disc.sides[0].label.image).toBeNull();
    expect(view.el.textContent).toContain('no es una imagen');
  });

  it('el FillEditor cambia de color liso a degradado conservando el color', () => {
    const { view, current } = setup('carpeta');
    const back = byTest(view.el, 'editor-contraportada');
    choose(back.querySelector('select') as HTMLSelectElement, 'gradient');
    const fill = current().jacket.back;
    expect(fill).toMatchObject({ kind: 'gradient', from: '#f1e6cf' });
  });
});

describe('canciones', () => {
  it('importa a la cara elegida, toma el título si falta y lista los rechazados', async () => {
    const imported = [track('Primera', 120, { blobKey: 'aud1', mimeType: 'audio/mpeg', fileName: '01 Primera.mp3' })];
    const importAudio = vi.fn(async () => ({ tracks: imported, rejected: [{ fileName: 'roto.xyz', reason: 'El navegador no puede reproducir este formato' }] }));
    const { view, store, current, vinyl } = setup('canciones', [], importAudio);
    store.update((d) => {
      const v = d.vinyls.find((x) => x.id === vinyl.id);
      if (v) {
        v.meta.title = '';
        v.spine.text = spineTextFor(v.meta);
        for (const s of v.disc.sides) s.label.fields.title = '';
      }
    });
    byTest(view.el, 'editor-cara-B').click();
    const input = byTest<HTMLInputElement>(view.el, 'editor-importar');
    expect(input.type).toBe('file');
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe('audio/*');
    pickFiles(input, [new File(['x'], '01 Primera.mp3', { type: 'audio/mpeg' }), new File(['y'], 'roto.xyz')]);
    await settle();
    expect(importAudio).toHaveBeenCalledOnce();
    expect(sideOf(current(), 'B').tracks.map((t) => t.title)).toEqual(['Bohemian Rhapsody', 'Primera']);
    expect(current().meta.title).toBe('Primera');
    expect(current().spine.text).toBe('Queen — Primera');
    expect(view.el.textContent).toContain('Se añadió 1 canción a la cara B.');
    expect(view.el.textContent).toContain('roto.xyz');
    expect(view.el.textContent).toContain('El navegador no puede reproducir este formato');
  });

  it('ordena, edita la duración solo sin audio y quita audio y canciones', async () => {
    const { view, store, current, vinyl } = setup('canciones');
    store.update((d) => {
      const v = d.vinyls.find((x) => x.id === vinyl.id);
      const t = v?.disc.sides[0].tracks[1];
      if (t) t.audio = { blobKey: 'aud_lazing', mimeType: 'audio/mpeg', fileName: 'lazing.mp3' };
    });
    const titles = (): string[] => current().disc.sides[0].tracks.map((t) => t.title);
    expect(byTest<HTMLInputElement>(view.el, 'editor-cancion-duracion-0').readOnly).toBe(false);
    expect(byTest<HTMLInputElement>(view.el, 'editor-cancion-duracion-1').readOnly).toBe(true);
    expect(view.el.textContent).toContain('lazing.mp3');
    expect(view.el.textContent).toContain('Sin audio');

    typeInto(byTest<HTMLInputElement>(view.el, 'editor-cancion-duracion-0'), '3:50');
    expect(current().disc.sides[0].tracks[0]?.durationSec).toBe(230);

    const down = view.el.querySelector<HTMLButtonElement>('button[aria-label="Bajar la canción 1"]') as HTMLButtonElement;
    down.click();
    expect(titles()).toEqual(['Lazing on a Sunday Afternoon', 'Death on Two Legs']);

    (view.el.querySelector('button[aria-label="Quitar el audio de la canción 1"]') as HTMLButtonElement).click();
    expect(current().disc.sides[0].tracks[0]?.audio).toBeNull();
    // El archivo se borra después de guardar el documento que ya no lo usa.
    await new Promise((r) => setTimeout(r, 0));
    expect(store.deletedBlobs).toContain('aud_lazing');

    (view.el.querySelector('button[aria-label="Quitar la canción 2"]') as HTMLButtonElement).click();
    expect(titles()).toEqual(['Lazing on a Sunday Afternoon']);
  });

  it('cambiar el título de una canción no reconstruye la lista', () => {
    const { view, current } = setup('canciones');
    const input = byTest<HTMLInputElement>(view.el, 'editor-cancion-titulo-0');
    input.focus();
    typeInto(input, 'Death on Two Legs (Dedicated to…)');
    expect(current().disc.sides[0].tracks[0]?.title).toBe('Death on Two Legs (Dedicated to…)');
    expect(input.isConnected).toBe(true);
  });

  it('una cara decorativa avisa y se puede volver reproducible', () => {
    const { view, store, current, vinyl } = setup('canciones');
    store.update((d) => {
      const v = d.vinyls.find((x) => x.id === vinyl.id);
      if (v) v.disc.sides[0].decorative = true;
    });
    const button = Array.from(view.el.querySelectorAll('button')).find((b) => b.textContent === 'Hacerla reproducible');
    expect(button?.closest('.ed-note')?.hasAttribute('hidden')).toBe(false);
    button?.click();
    expect(current().disc.sides[0].decorative).toBe(false);
  });
});

describe('cambio de formato', () => {
  it('acota la anchura del aro al máximo del nuevo formato', () => {
    const { view, store, current, vinyl } = setup('disco');
    store.update((d) => {
      const v = d.vinyls.find((x) => x.id === vinyl.id);
      if (v) for (const s of v.disc.sides) s.ring.widthMm = 18;
    });
    choose(byTest<HTMLSelectElement>(view.el, 'editor-formato'), '7');
    expect(current().disc.format).toBe('7');
    expect(current().disc.sides.map((s) => s.ring.widthMm)).toEqual([maxRingWidthMm('7'), maxRingWidthMm('7')]);
  });

  it('los presets completo y normal reescriben la decoración de ambas caras', () => {
    const { view, current } = setup('disco');
    byTest(view.el, 'editor-preset-full').click();
    expect(current().disc.sides[0].decoration).toBe('full');
    expect(current().disc.sides[0].artwork).toEqual(gradient('#d8d2c2', '#7d9bb0', 20, true));
    byTest(view.el, 'editor-preset-normal').click();
    expect(current().disc.sides.map((s) => s.decoration)).toEqual(['normal', 'normal']);
  });
});
