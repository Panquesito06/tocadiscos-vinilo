/**
 * Valores por defecto y presets de vinilo.
 *
 * Tres presets corresponden a los tres tipos pedidos: vinilo normal, con aro
 * central decorado y enteramente decorado.
 */
import { newId } from './ids';
import { defaultThicknessMm } from './geometry';
import type {
  AppState,
  Condition,
  Disc,
  Fill,
  InnerSleeve,
  Jacket,
  LabelSpec,
  OuterSleeve,
  RimSpec,
  RingSpec,
  Settings,
  Side,
  SideId,
  Spine,
  TextStyle,
  Track,
  TurntableState,
  UiState,
  Vinyl,
  VinylMeta,
} from './types';

export function solid(color: string): Fill {
  return { kind: 'solid', color };
}

export function gradient(from: string, to: string, angleDeg = 90, radial = false): Fill {
  return { kind: 'gradient', from, to, angleDeg, radial };
}

export function textStyle(overrides: Partial<TextStyle> = {}): TextStyle {
  return {
    color: '#1c1b19',
    weight: 600,
    width: 'condensed',
    align: 'left',
    uppercase: true,
    ...overrides,
  };
}

export function defaultCondition(): Condition {
  return { dust: 0.05, wear: 0, warp: 0.05, scratches: 0, plays: 0, lastCleanedAt: null };
}

export function defaultRing(overrides: Partial<RingSpec> = {}): RingSpec {
  return { pattern: 'stripes', color1: '#d1302a', color2: '#f1e6cf', widthMm: 8, image: null, ...overrides };
}

export function defaultRim(overrides: Partial<RimSpec> = {}): RimSpec {
  return { enabled: false, color: '#5a5a52', rivets: true, widthMm: 6, ...overrides };
}

export function defaultLabel(meta: VinylMeta, overrides: Partial<LabelSpec> = {}): LabelSpec {
  return {
    background: solid('#f1e6cf'),
    text: textStyle(),
    brandText: textStyle({ weight: 900, width: 'expanded', color: '#d1302a', align: 'center' }),
    fields: {
      artist: meta.artist,
      title: meta.title,
      brand: meta.labelName,
      catalogNumber: meta.catalogNumber,
      year: meta.year,
      sideMarker: true,
      showRpm: true,
      showTracklist: true,
      showCopyright: true,
      copyright:
        'Reservados todos los derechos del productor fonográfico y de los autores de las obras grabadas en este disco.',
      extraLines: [],
    },
    image: null,
    imageScale: 0.5,
    holeRingColor: null,
    ...overrides,
  };
}

export function track(title: string, durationSec: number, audio: Track['audio'] = null): Track {
  return { id: newId('trk'), title, durationSec, audio };
}

export function defaultSide(id: SideId, meta: VinylMeta, tracks: Track[] = [], overrides: Partial<Side> = {}): Side {
  return {
    id,
    decorative: false,
    decoration: 'normal',
    tracks,
    label: defaultLabel(meta),
    ring: defaultRing(),
    artwork: null,
    rim: defaultRim(),
    groovesOverArt: true,
    runoutEtching: '',
    ...overrides,
  };
}

export function defaultDisc(meta: VinylMeta, overrides: Partial<Disc> = {}): Disc {
  const weight = overrides.weightGrams ?? 140;
  return {
    format: '12',
    nativeRpm: 33,
    hole: 'small',
    material: 'black',
    color: '#8c2f2f',
    color2: '#f1e6cf',
    weightGrams: weight,
    thicknessMm: defaultThicknessMm(weight),
    grooveDepth: 0.6,
    pressingQuality: 0.7,
    trackGapSec: 2,
    sides: [defaultSide('A', meta), defaultSide('B', meta)],
    condition: defaultCondition(),
    ...overrides,
  };
}

export function defaultInnerSleeve(overrides: Partial<InnerSleeve> = {}): InnerSleeve {
  return {
    kind: 'paper-kraft',
    color: '#c9a66b',
    cutout: true,
    printFront: null,
    printBack: null,
    text: '',
    textStyle: textStyle({ uppercase: false, weight: 500, width: 'normal' }),
    ...overrides,
  };
}

export function defaultJacket(overrides: Partial<Jacket> = {}): Jacket {
  return {
    front: gradient('#3e5c58', '#1c1b19', 160),
    back: solid('#f1e6cf'),
    gatefold: false,
    insideLeft: null,
    insideRight: null,
    finish: 'matte',
    showTitleOnFront: true,
    titleStyle: textStyle({ color: '#f1e6cf', weight: 800, width: 'expanded', align: 'left', uppercase: true }),
    showTracklistOnBack: true,
    backNotes: '',
    backStyle: textStyle({ uppercase: false, weight: 500, width: 'normal' }),
    cutCorner: false,
    sticker: null,
    ...overrides,
  };
}

export function spineTextFor(meta: VinylMeta): string {
  const artist = meta.artist.trim();
  const title = meta.title.trim();
  if (artist && title) return `${artist} — ${title}`;
  return artist || title || 'Sin título';
}

export function defaultSpine(meta: VinylMeta, overrides: Partial<Spine> = {}): Spine {
  return {
    text: spineTextFor(meta),
    background: '#1c1b19',
    textStyle: textStyle({ color: '#f1e6cf', weight: 700, width: 'condensed', align: 'left' }),
    accentColor: null,
    showCatalogNumber: true,
    ...overrides,
  };
}

export function defaultOuterSleeve(overrides: Partial<OuterSleeve> = {}): OuterSleeve {
  return { kind: 'pvc-clear', tint: '#ffffff', opacity: 0.12, print: null, gloss: 0.6, ...overrides };
}

export function defaultMeta(overrides: Partial<VinylMeta> = {}): VinylMeta {
  return {
    artist: '',
    title: '',
    year: '',
    labelName: '',
    catalogNumber: '',
    genre: '',
    notes: '',
    ...overrides,
  };
}

export interface CreateVinylOptions {
  meta?: Partial<VinylMeta>;
  disc?: Partial<Disc>;
  innerSleeve?: Partial<InnerSleeve>;
  jacket?: Partial<Jacket>;
  spine?: Partial<Spine>;
  outerSleeve?: Partial<OuterSleeve>;
  shelfIndex?: number;
  now?: number;
}

export function createVinyl(options: CreateVinylOptions = {}): Vinyl {
  const meta = defaultMeta(options.meta);
  const now = options.now ?? Date.now();
  return {
    id: newId('vin'),
    createdAt: now,
    updatedAt: now,
    meta,
    disc: defaultDisc(meta, options.disc),
    innerSleeve: defaultInnerSleeve(options.innerSleeve),
    jacket: defaultJacket(options.jacket),
    spine: defaultSpine(meta, options.spine),
    outerSleeve: defaultOuterSleeve(options.outerSleeve),
    shelfIndex: options.shelfIndex ?? 0,
  };
}

/** Preset: vinilo normal de 12", negro, con galleta clásica. */
export function presetNormal(meta: Partial<VinylMeta> = {}, tracksA: Track[] = [], tracksB: Track[] = []): Vinyl {
  const v = createVinyl({ meta });
  v.disc.sides[0].tracks = tracksA;
  v.disc.sides[1].tracks = tracksB;
  return v;
}

/** Preset: vinilo de color con aro central decorado en ambas caras. */
export function presetRing(meta: Partial<VinylMeta> = {}, tracksA: Track[] = [], tracksB: Track[] = []): Vinyl {
  const v = createVinyl({
    meta,
    disc: { material: 'color', color: '#1f3a5f', weightGrams: 180 },
    jacket: defaultJacket({ front: gradient('#1f3a5f', '#d1302a', 35) }),
    spine: defaultSpine(defaultMeta(meta), { background: '#1f3a5f', accentColor: '#d1302a' }),
  });
  v.disc.thicknessMm = defaultThicknessMm(180);
  for (const side of v.disc.sides) {
    side.decoration = 'ring';
    side.ring = defaultRing({ pattern: 'rivets', color1: '#2d2d2a', color2: '#b8bcc0', widthMm: 10 });
    side.label.background = solid('#f1e6cf');
  }
  v.disc.sides[0].tracks = tracksA;
  v.disc.sides[1].tracks = tracksB;
  return v;
}

/** Preset: cara A enteramente decorada (obra a cara completa con borde remachado), cara B decorativa sin surcos. */
export function presetFull(meta: Partial<VinylMeta> = {}, tracksA: Track[] = []): Vinyl {
  const v = createVinyl({
    meta,
    disc: { material: 'color', color: '#d8d2c2', weightGrams: 160 },
    innerSleeve: defaultInnerSleeve({ kind: 'poly-lined', color: '#f3f1ec' }),
    jacket: defaultJacket({ front: gradient('#8a1f1f', '#d8d2c2', 120, true), gatefold: true }),
    spine: defaultSpine(defaultMeta(meta), { background: '#8a1f1f', accentColor: '#d8d2c2' }),
  });
  v.disc.thicknessMm = defaultThicknessMm(160);
  const [a, b] = v.disc.sides;
  a.decoration = 'full';
  a.artwork = gradient('#d8d2c2', '#7d9bb0', 20, true);
  a.rim = defaultRim({ enabled: true, color: '#4f4a40', rivets: true, widthMm: 7 });
  a.groovesOverArt = true;
  a.tracks = tracksA;
  b.decorative = true;
  b.decoration = 'full';
  b.artwork = gradient('#2b2a2e', '#8a1f1f', 200, true);
  b.rim = defaultRim({ enabled: true, color: '#4f4a40', rivets: true, widthMm: 7 });
  b.groovesOverArt = false;
  b.tracks = [];
  return v;
}

/**
 * Marca un vinilo como modificado con un `updatedAt` estrictamente creciente
 * (dos ediciones en el mismo milisegundo no deben compartir clave de caché).
 */
export function touch(vinyl: Vinyl, now = Date.now()): void {
  vinyl.updatedAt = Math.max(now, vinyl.updatedAt + 1);
}

/**
 * Propaga un cambio de datos generales a la galleta de ambas caras, al lomo
 * y al título de portada, SOLO en los campos que todavía coincidían con el
 * valor derivado del meta anterior (es decir, que el usuario no personalizó).
 */
export function syncDerivedTexts(vinyl: Vinyl, prevMeta: VinylMeta): void {
  const meta = vinyl.meta;
  for (const side of vinyl.disc.sides) {
    const f = side.label.fields;
    if (f.artist === prevMeta.artist) f.artist = meta.artist;
    if (f.title === prevMeta.title) f.title = meta.title;
    if (f.brand === prevMeta.labelName) f.brand = meta.labelName;
    if (f.catalogNumber === prevMeta.catalogNumber) f.catalogNumber = meta.catalogNumber;
    if (f.year === prevMeta.year) f.year = meta.year;
  }
  if (vinyl.spine.text === spineTextFor(prevMeta)) vinyl.spine.text = spineTextFor(meta);
}

export type PresetKind = 'normal' | 'ring' | 'full';

/**
 * Aplica solo la DECORACIÓN de un preset a un vinilo existente: material y
 * colores del disco y, por cara, `decoration`, `ring`, `artwork`, `rim`,
 * `groovesOverArt` y el fondo de la galleta. Conserva pistas, campos de la
 * galleta, metadatos, carpeta, fundas y lomo. En `full`, la cara B pasa a
 * decorativa solo si no tiene pistas.
 */
export function applyPresetDecoration(vinyl: Vinyl, kind: PresetKind): void {
  const sample = kind === 'normal' ? presetNormal() : kind === 'ring' ? presetRing() : presetFull();
  vinyl.disc.material = sample.disc.material;
  vinyl.disc.color = sample.disc.color;
  vinyl.disc.color2 = sample.disc.color2;
  vinyl.disc.sides.forEach((side, i) => {
    const src = sample.disc.sides[i === 0 ? 0 : 1];
    side.decoration = src.decoration;
    side.ring = { ...src.ring };
    side.artwork = src.artwork ? { ...src.artwork } : null;
    side.rim = { ...src.rim };
    side.groovesOverArt = src.groovesOverArt;
    side.label.background = { ...src.label.background };
    if (kind === 'full' && i === 1) side.decorative = side.tracks.length === 0;
    else if (kind !== 'full') side.decorative = false;
  });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Mezcla un valor guardado sobre su valor por defecto: rellena los campos
 * que falten (versiones anteriores del esquema) sin tocar los presentes.
 * Los objetos con `kind` (rellenos) y los arrays se toman tal cual.
 */
export function mergeWithDefaults<T>(def: T, val: unknown): T {
  if (val === undefined) return def;
  if (val === null) return null as T;
  if (Array.isArray(def)) return (Array.isArray(val) ? val : def) as T;
  if (isPlainObject(def)) {
    if (!isPlainObject(val)) return def;
    if ('kind' in val) return val as T;
    const out: Record<string, unknown> = { ...def };
    for (const key of Object.keys(def)) out[key] = mergeWithDefaults(def[key], val[key]);
    return out as T;
  }
  return (typeof val === typeof def ? val : def) as T;
}

/** Normaliza un vinilo leído del almacén: rellena con valores por defecto lo que falte. */
export function normalizeVinyl(raw: unknown): Vinyl {
  const r = isPlainObject(raw) ? raw : {};
  const rawMeta = isPlainObject(r.meta) ? r.meta : {};
  const meta = mergeWithDefaults(defaultMeta(), rawMeta);
  const base = createVinyl({ meta, now: typeof r.createdAt === 'number' ? r.createdAt : Date.now() });
  const merged = mergeWithDefaults(base, { ...r, disc: undefined, meta });
  const rawDisc = isPlainObject(r.disc) ? r.disc : {};
  const rawSides = Array.isArray(rawDisc.sides) ? rawDisc.sides : [];
  const disc = mergeWithDefaults(defaultDisc(meta), { ...rawDisc, sides: undefined });
  disc.sides = [
    mergeWithDefaults(defaultSide('A', meta), rawSides[0]),
    mergeWithDefaults(defaultSide('B', meta), rawSides[1]),
  ];
  for (const side of disc.sides) {
    side.tracks = side.tracks.map((t) => mergeWithDefaults(track('', 0), t));
  }
  merged.disc = disc;
  if (typeof r.id === 'string' && r.id) merged.id = r.id;
  return merged;
}

export function defaultTurntableState(): TurntableState {
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
  };
}

export function defaultUiState(): UiState {
  return {
    view: 'room',
    handVinylId: null,
    handStage: 'jacket-front',
    handSide: 'A',
    editorVinylId: null,
    editorTab: 'disco',
    tool: 'none',
    toast: null,
  };
}

export function defaultSettings(): Settings {
  return { dustSpeed: 1, fancyRendering: true };
}

export function initialAppState(): AppState {
  return {
    vinyls: [],
    turntable: defaultTurntableState(),
    ui: defaultUiState(),
    settings: defaultSettings(),
  };
}

/** Busca un vinilo por id. */
export function findVinyl(state: AppState, id: string | null | undefined): Vinyl | null {
  if (!id) return null;
  return state.vinyls.find((v) => v.id === id) ?? null;
}

/** Vinilo cargado en el plato, si hay. */
export function loadedVinyl(state: AppState): Vinyl | null {
  return findVinyl(state, state.turntable.loaded?.vinylId);
}

export function sideOf(vinyl: Vinyl, id: SideId): Side {
  return id === 'A' ? vinyl.disc.sides[0] : vinyl.disc.sides[1];
}
