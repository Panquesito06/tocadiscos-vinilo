/**
 * Modelo de datos de la aplicación.
 *
 * Todo lo que describe un vinilo vive aquí. Las partes siguen la anatomía
 * física real: disco (con sus dos caras, surcos, agujero central y galleta),
 * funda interior, carpeta, lomo y funda exterior. Cada parte es editable.
 *
 * Las medidas se expresan en milímetros y los tiempos en segundos.
 */

/**
 * Versión del documento persistido. Se incrementa cuando cambia la forma de
 * `Vinyl`, `TurntableState` o `Settings`; el store aplica migraciones y
 * normaliza con los valores por defecto al cargar.
 */
export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Primitivas
// ---------------------------------------------------------------------------

/** Diámetro nominal del disco en pulgadas. */
export type Format = '7' | '10' | '12';

/** Velocidad nominal de reproducción. `33` significa 33⅓ rpm. */
export type Rpm = 33 | 45 | 78;

/** Diámetro del agujero central: pequeño (7,24 mm) o grande (38,1 mm, singles de jukebox). */
export type HoleSize = 'small' | 'large';

/** Peso del disco en gramos. Determina el grosor por defecto y la resistencia al alabeo. */
export type WeightGrams = 120 | 140 | 160 | 180 | 200;

export type SideId = 'A' | 'B';

/** Referencia a una imagen guardada en el almacén de blobs (IndexedDB). */
export interface ImageRef {
  blobKey: string;
  width?: number;
  height?: number;
  name?: string;
}

/** Referencia a un archivo de audio guardado en el almacén de blobs. */
export interface AudioRef {
  blobKey: string;
  mimeType: string;
  fileName: string;
}

/** Relleno de una superficie: color plano, degradado o imagen. */
export type Fill =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; from: string; to: string; angleDeg: number; radial: boolean }
  | { kind: 'image'; image: ImageRef; fit: 'cover' | 'contain'; backdrop: string };

/** Anchura de la familia Archivo variable: se usa como contraste tipográfico. */
export type FontWidth = 'condensed' | 'normal' | 'expanded';

export interface TextStyle {
  color: string;
  weight: number; // 100..900
  width: FontWidth;
  align: 'left' | 'center' | 'right';
  uppercase: boolean;
}

// ---------------------------------------------------------------------------
// Disco
// ---------------------------------------------------------------------------

/** Material / aspecto del vinilo fuera de la galleta y de la obra a cara completa. */
export type DiscMaterial = 'black' | 'color' | 'clear' | 'splatter' | 'marble';

/**
 * Nivel de decoración de cada cara:
 *  - `normal`: vinilo con galleta de papel.
 *  - `ring`:   galleta más un aro central decorado alrededor.
 *  - `full`:   cara enteramente decorada (obra a cara completa, como un
 *              picture disc o un disco pintado a mano) con un borde opcional.
 */
export type Decoration = 'normal' | 'ring' | 'full';

export type RingPattern = 'plain' | 'stripes' | 'dots' | 'rivets' | 'stars' | 'checker' | 'image';

/** Aro central decorado. Se dibuja pegado al borde exterior de la galleta. */
export interface RingSpec {
  pattern: RingPattern;
  color1: string;
  color2: string;
  widthMm: number; // 4..20
  image?: ImageRef | null;
}

/** Borde pintado/metálico de una cara enteramente decorada (como el remache de la foto de referencia). */
export interface RimSpec {
  enabled: boolean;
  color: string;
  rivets: boolean;
  widthMm: number; // 3..12
}

export interface LabelFields {
  artist: string;
  title: string;
  brand: string; // nombre de la discográfica, en grande (p. ej. "EMI")
  catalogNumber: string;
  year: string;
  sideMarker: boolean; // mostrar "Cara A" / "Cara B"
  showRpm: boolean;
  showTracklist: boolean;
  showCopyright: boolean;
  copyright: string; // texto legal pequeño
  extraLines: string[]; // líneas libres
}

/** La galleta: etiqueta de papel pegada al centro de cada cara. */
export interface LabelSpec {
  background: Fill;
  text: TextStyle;
  brandText: TextStyle;
  fields: LabelFields;
  /** Imagen opcional superpuesta (logotipo o arte) centrada en la galleta. */
  image?: ImageRef | null;
  imageScale: number; // 0.2..1 relativo al diámetro de la galleta
  /** Anillo fino de color alrededor del agujero (detalle de imprenta). */
  holeRingColor: string | null;
}

export interface Track {
  id: string;
  title: string;
  /** Duración en segundos. Si no hay audio, el surco ocupa este tiempo en silencio. */
  durationSec: number;
  audio: AudioRef | null;
}

export interface Side {
  id: SideId;
  /** Cara puramente decorativa: sin surcos ni audio (grabado, picture, pintada). */
  decorative: boolean;
  decoration: Decoration;
  tracks: Track[];
  label: LabelSpec;
  ring: RingSpec;
  /** Obra a cara completa. Solo se dibuja con `decoration === 'full'`. */
  artwork: Fill | null;
  rim: RimSpec;
  /** Con obra a cara completa, dibujar los surcos tenues encima (picture disc). */
  groovesOverArt: boolean;
  /** Texto grabado a mano en el dead wax (número de matriz, mensaje). */
  runoutEtching: string;
}

/** Estado físico mutable del disco. Cambia con el uso. Todos los valores van de 0 a 1. */
export interface Condition {
  /** Polvo acumulado. Produce crepitar. Se limpia con el cepillo. */
  dust: number;
  /** Desgaste por reproducciones. Produce siseo de superficie. Irreversible. */
  wear: number;
  /** Alabeo. Produce bamboleo (wow) a la frecuencia de giro. */
  warp: number;
  /** Rayas. Producen clics y pequeños saltos. Editable, no se genera sola. */
  scratches: number;
  plays: number;
  lastCleanedAt: number | null;
}

export interface Disc {
  format: Format;
  nativeRpm: Rpm;
  hole: HoleSize;
  material: DiscMaterial;
  color: string; // color principal del vinilo (material `color`, `splatter`, `marble`, `clear` tinte)
  color2: string; // segundo color para `splatter` y `marble`
  weightGrams: WeightGrams;
  /** Grosor en mm (1,0 – 2,4). Por defecto se deriva del peso, pero es editable. */
  thicknessMm: number;
  /** Profundidad/marcado visual de los surcos (0..1). También mejora levemente la fidelidad. */
  grooveDepth: number;
  /** Calidad del prensado (0..1). Baja calidad = más ruido de fondo. */
  pressingQuality: number;
  /** Silencio entre canciones, visible como banda más ancha entre surcos. */
  trackGapSec: number;
  sides: [Side, Side];
  condition: Condition;
}

// ---------------------------------------------------------------------------
// Fundas, carpeta y lomo
// ---------------------------------------------------------------------------

export type InnerSleeveKind = 'none' | 'paper-white' | 'paper-kraft' | 'paper-black' | 'poly-lined' | 'printed';

/** Funda interior: protege el disco dentro de la carpeta. */
export interface InnerSleeve {
  kind: InnerSleeveKind;
  color: string;
  /** Agujero troquelado en el centro que deja ver la galleta. */
  cutout: boolean;
  printFront: Fill | null;
  printBack: Fill | null;
  /** Letras, créditos o historia del álbum impresos en la funda. */
  text: string;
  textStyle: TextStyle;
}

export type JacketFinish = 'matte' | 'gloss' | 'textured';

/** La carpeta: portada, contraportada y, si es desplegable, su interior. */
export interface Jacket {
  front: Fill;
  back: Fill;
  gatefold: boolean;
  insideLeft: Fill | null;
  insideRight: Fill | null;
  finish: JacketFinish;
  /** Título/artista impresos sobre la portada (si la imagen ya los lleva, se desactivan). */
  showTitleOnFront: boolean;
  titleStyle: TextStyle;
  /** Texto de la contraportada: lista de canciones generada + notas libres. */
  showTracklistOnBack: boolean;
  backNotes: string;
  backStyle: TextStyle;
  /** Esquina cortada (corte de saldo) o pegatina de precio: detalles de coleccionista. */
  cutCorner: boolean;
  sticker: { text: string; color: string } | null;
}

/** El lomo: la tira estrecha visible cuando el disco está en la estantería. */
export interface Spine {
  text: string; // por defecto "ARTISTA — Título"
  background: string;
  textStyle: TextStyle;
  /** Franja de color en un extremo para identificar la colección de un vistazo. */
  accentColor: string | null;
  showCatalogNumber: boolean;
}

export type OuterSleeveKind = 'none' | 'pvc-clear' | 'pvc-tinted' | 'printed' | 'resealable';

/** Funda exterior: protección transparente o impresa por fuera de la carpeta. */
export interface OuterSleeve {
  kind: OuterSleeveKind;
  tint: string;
  opacity: number; // 0..1 (solo tintada / impresa)
  print: Fill | null;
  gloss: number; // 0..1 reflejo del plástico
}

// ---------------------------------------------------------------------------
// Vinilo completo
// ---------------------------------------------------------------------------

export interface VinylMeta {
  artist: string;
  title: string;
  year: string;
  labelName: string;
  catalogNumber: string;
  genre: string;
  notes: string;
}

export interface Vinyl {
  id: string;
  createdAt: number;
  updatedAt: number;
  meta: VinylMeta;
  disc: Disc;
  innerSleeve: InnerSleeve;
  jacket: Jacket;
  spine: Spine;
  outerSleeve: OuterSleeve;
  /** Posición en la estantería (orden). */
  shelfIndex: number;
}

// ---------------------------------------------------------------------------
// Tocadiscos y estado de la aplicación
// ---------------------------------------------------------------------------

export interface TonearmState {
  /** Brazo en su soporte (fuera del disco). */
  onRest: boolean;
  /** Palanca de elevación arriba: la aguja no toca el disco. */
  lifted: boolean;
  /** Radio del surco bajo la aguja, en mm desde el centro del plato. */
  radiusMm: number;
}

export interface TurntableState {
  power: boolean;
  /** Motor en marcha (botón start/stop). */
  motor: boolean;
  speed: Rpm;
  /** Ajuste fino de velocidad, −8 … +8 %. */
  pitchPercent: number;
  lidOpen: boolean;
  /** Centrador de 45 rpm puesto en el eje (necesario para agujero grande). */
  adapter45: boolean;
  loaded: { vinylId: string; side: SideId } | null;
  tonearm: TonearmState;
  volume: number; // 0..1
}

export type HandStage = 'jacket-front' | 'jacket-back' | 'gatefold' | 'inner-out' | 'disc-out';

export type EditorTab =
  | 'disco'
  | 'surcos'
  | 'agujero'
  | 'galleta'
  | 'funda-interior'
  | 'carpeta'
  | 'lomo'
  | 'funda-exterior'
  | 'canciones';

export interface UiState {
  view: 'room' | 'hand' | 'editor';
  /** Vinilo sacado de la estantería y sostenido en la mano. */
  handVinylId: string | null;
  handStage: HandStage;
  handSide: SideId;
  editorVinylId: string | null;
  editorTab: EditorTab;
  /** Herramienta activa en el tocadiscos. */
  tool: 'none' | 'brush';
  /** Mensaje breve en pantalla (p. ej. "Necesitas el centrador"). */
  toast: { text: string; at: number } | null;
}

export interface Settings {
  /** Minutos simulados por minuto real para la acumulación de polvo. */
  dustSpeed: number;
  /** Mostrar brillos y polvo sobre el disco. */
  fancyRendering: boolean;
}

export interface AppState {
  vinyls: Vinyl[];
  turntable: TurntableState;
  ui: UiState;
  settings: Settings;
}
