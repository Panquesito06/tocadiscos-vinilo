/**
 * Pestaña Canciones (por cara, con selector A/B): lista ordenable con
 * título, duración (editable solo sin audio), archivo o "Sin audio",
 * "Quitar audio" y "Quitar canción"; "Importar archivos…" y zona de soltar
 * que llaman a `importAudio` y añaden a la cara elegida, con la lista de
 * archivos rechazados y su motivo.
 *
 * Al quitar un audio o una canción, `editVinyl` borra el blob si ningún
 * vinilo lo usa ya.
 */
import { sideOf, syncDerivedTexts, track } from '../../core/defaults';
import type { Side, SideId, Track, Vinyl } from '../../core/types';
import { button, durationField, filePicker, h, row, setText, type Child } from '../controls';
import type { EditorContext, ImportOutcome, ImportStatus } from '../context';
import { errorMessage } from '../format';
import { describeSideDuration } from './surcos';

/** Duración de una canción nueva sin audio (se puede cambiar). */
export const NEW_TRACK_SEC = 180;

export function findTrack(side: Side, id: string): Track | undefined {
  return side.tracks.find((t) => t.id === id);
}

/** Mueve una canción una posición arriba (−1) o abajo (+1) dentro de su cara. */
export function moveTrack(side: Side, id: string, delta: -1 | 1): void {
  const from = side.tracks.findIndex((t) => t.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= side.tracks.length) return;
  const [moved] = side.tracks.splice(from, 1);
  if (moved) side.tracks.splice(to, 0, moved);
}

export function removeTrack(side: Side, id: string): void {
  side.tracks = side.tracks.filter((t) => t.id !== id);
}

/** Quita el audio y deja la canción en silencio con su duración (que pasa a ser editable). */
export function removeAudio(side: Side, id: string): void {
  const t = findTrack(side, id);
  if (t) t.audio = null;
}

/** Añade canciones importadas a una cara; si el vinilo no tiene título, toma el de la primera. */
export function addImportedTracks(v: Vinyl, sideId: SideId, tracks: readonly Track[]): void {
  sideOf(v, sideId).tracks.push(...tracks);
  const first = tracks[0];
  if (first && !v.meta.title.trim()) {
    const prev = { ...v.meta };
    v.meta.title = first.title;
    syncDerivedTexts(v, prev);
  }
}

/** Resumen de una importación en una frase. */
export function importSummary(result: ImportOutcome, sideId: SideId, applied: boolean): string {
  const n = result.tracks.length;
  if (!applied) return 'El vinilo ya no existe: no se añadió ninguna canción.';
  if (n === 0) return result.rejected.length ? 'No se pudo importar ningún archivo.' : 'No había archivos que importar.';
  const added = n === 1 ? 'Se añadió 1 canción' : `Se añadieron ${n} canciones`;
  return `${added} a la cara ${sideId}.`;
}

export function buildCancionesTab(ctx: EditorContext): Child[] {
  const side = (v: Vinyl): Side => ctx.side(v);
  const decorativeNote = h('div', 'ed-note ed-note--aviso', [
    h('span', '', ['Esta cara es decorativa: sus canciones no suenan. ']),
    button('Hacerla reproducible', () =>
      ctx.edit((v) => {
        side(v).decorative = false;
      }),
    ),
  ]);
  return [
    row([ctx.sideSwitch()]),
    ctx.showIf(decorativeNote, (v) => side(v).decorative),
    trackList(ctx),
    ctx.readout('Duración de la cara', (v) => describeSideDuration(v, ctx.local.side)),
    importZone(ctx),
  ];
}

function trackKey(ctx: EditorContext, v: Vinyl): string {
  const tracks = ctx.side(v).tracks.map((t) => `${t.id}${t.audio ? '+' : ''}`);
  return `${ctx.local.side}|${tracks.join(',')}`;
}

function trackList(ctx: EditorContext): HTMLElement {
  return ctx.dynamic(
    (v) => trackKey(ctx, v),
    (c, v) => {
      const tracks = c.side(v).tracks;
      if (!tracks.length) {
        return [h('p', 'ed-note', ['Esta cara no tiene canciones. Importa archivos de audio o añade una canción sin audio.'])];
      }
      const list = h('ol', 'ed-tracks', tracks.map((t, i) => trackRow(c, t, i, tracks.length)));
      list.setAttribute('aria-label', 'Canciones de la cara');
      return [list];
    },
    'ed-tracks-box',
  );
}

function trackRow(ctx: EditorContext, t: Track, index: number, count: number): HTMLLIElement {
  const id = t.id;
  const hasAudio = t.audio !== null;
  const get = (v: Vinyl): Track | undefined => findTrack(ctx.side(v), id);
  const title = ctx.text(`Canción ${index + 1}`, (v) => get(v)?.title ?? '', (v, x) => {
    const tr = get(v);
    if (tr) tr.title = x;
  }, { dataTest: `editor-cancion-titulo-${index}` });
  const duration = ctx.bind(
    durationField({
      label: 'Duración',
      readOnly: hasAudio,
      readOnlyHint: 'La duración la marca el archivo de audio.',
      dataTest: `editor-cancion-duracion-${index}`,
      onChange: (sec) =>
        ctx.edit((v) => {
          const tr = get(v);
          if (tr && !tr.audio) tr.durationSec = sec;
        }),
    }),
    (v) => get(v)?.durationSec ?? 0,
  );
  const file = h('p', 'ed-track__file');
  ctx.onSync((v) => setText(file, get(v)?.audio?.fileName ?? 'Sin audio'));
  // El número no cambia mientras exista esta fila (reordenar la reconstruye); el título sí.
  const name = `la canción ${index + 1}`;
  const actions = row([
    trackButton(ctx, 'Subir', `Subir ${name}`, `${id}:subir`, index === 0, (s) => moveTrack(s, id, -1)),
    trackButton(ctx, 'Bajar', `Bajar ${name}`, `${id}:bajar`, index === count - 1, (s) => moveTrack(s, id, 1)),
    hasAudio && trackButton(ctx, 'Quitar audio', `Quitar el audio de ${name}`, `${id}:audio`, false, (s) => removeAudio(s, id)),
    trackButton(ctx, 'Quitar canción', `Quitar ${name}`, `${id}:quitar`, false, (s) => removeTrack(s, id)),
  ]);
  const li = h('li', 'ed-track', [h('div', 'ed-track__fields', [title, duration]), file, actions]);
  li.dataset.trackId = id;
  return li;
}

function trackButton(
  ctx: EditorContext,
  text: string,
  ariaLabel: string,
  focusKey: string,
  disabled: boolean,
  mutate: (side: Side) => void,
): HTMLButtonElement {
  const b = button(text, () => ctx.edit((v) => mutate(ctx.side(v))), {
    className: 'ed-btn ed-btn--small',
    ariaLabel,
    focusKey,
  });
  b.disabled = disabled;
  return b;
}

function importZone(ctx: EditorContext): HTMLElement {
  const picker = filePicker({
    text: 'Importar archivos…',
    accept: 'audio/*',
    multiple: true,
    dataTest: 'editor-importar',
    onFiles: (files) => void runImport(ctx, files),
  });
  const addBlank = button('Añadir canción sin audio', () =>
    ctx.edit((v) => {
      const tracks = ctx.side(v).tracks;
      tracks.push(track(`Canción ${tracks.length + 1}`, NEW_TRACK_SEC));
    }),
    { dataTest: 'editor-cancion-anadir' },
  );
  const hint = h('p', 'ed-drop__hint', ['Suelta aquí archivos de audio (MP3, FLAC, WAV, OGG…) para añadirlos a la cara A.']);
  const status = h('div', 'ed-import__status');
  status.setAttribute('role', 'status');
  const zone = h('div', 'ed-drop', [hint, row([picker.el, addBlank]), status]);
  zone.dataset.test = 'editor-soltar';
  bindDrop(zone, (files) => void runImport(ctx, files));

  let shown: ImportStatus | null | undefined;
  ctx.onSync(() => {
    setText(hint, `Suelta aquí archivos de audio (MP3, FLAC, WAV, OGG…) para añadirlos a la cara ${ctx.local.side}.`);
    const s = ctx.local.importStatus;
    picker.input.disabled = !!s?.busy;
    if (s === shown) return;
    shown = s;
    renderStatus(status, s);
  });
  return zone;
}

/** Zona de soltar: acepta archivos y no deja que el gesto llegue a la habitación (que crearía otro vinilo). */
function bindDrop(zone: HTMLElement, onFiles: (files: File[]) => void): void {
  const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const over = (e: DragEvent): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    zone.classList.add('ed-drop--activa');
  };
  zone.addEventListener('dragenter', over);
  zone.addEventListener('dragover', over);
  zone.addEventListener('dragleave', (e) => {
    if (e.relatedTarget instanceof Node && zone.contains(e.relatedTarget)) return;
    zone.classList.remove('ed-drop--activa');
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove('ed-drop--activa');
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) onFiles(files);
  });
}

function renderStatus(box: HTMLElement, s: ImportStatus | null): void {
  box.replaceChildren();
  if (!s) return;
  box.append(h('p', s.busy ? 'ed-status ed-status--ocupado' : 'ed-status', [s.message]));
  if (!s.rejected.length) return;
  box.append(
    h('p', 'ed-status', ['Estos archivos no se importaron:']),
    h(
      'ul',
      'ed-rejected',
      s.rejected.map((r) => h('li', '', [h('strong', '', [r.fileName]), `: ${r.reason}`])),
    ),
  );
}

/** Importa archivos a la cara elegida en este momento y deja el resultado en `local.importStatus`. */
export async function runImport(ctx: EditorContext, files: File[]): Promise<void> {
  if (!files.length) return;
  const sideId = ctx.local.side;
  const setStatus = (s: ImportStatus): void => {
    ctx.local.importStatus = s;
    ctx.session.resync();
  };
  const first = files[0];
  setStatus({
    busy: true,
    message: files.length === 1 && first ? `Importando «${first.name}»…` : `Importando ${files.length} archivos…`,
    rejected: [],
  });
  try {
    const result = await ctx.session.services.importAudio(files);
    const keys = result.tracks.flatMap((t) => (t.audio ? [t.audio.blobKey] : []));
    const applied = result.tracks.length
      ? ctx.editWithBlobs(keys, (v) => addImportedTracks(v, sideId, result.tracks))
      : true;
    setStatus({ busy: false, message: importSummary(result, sideId, applied), rejected: result.rejected });
  } catch (err) {
    setStatus({
      busy: false,
      message: `No se pudieron importar los archivos (${errorMessage(err)}). Inténtalo de nuevo.`,
      rejected: [],
    });
  }
}
