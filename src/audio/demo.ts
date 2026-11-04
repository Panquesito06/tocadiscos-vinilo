/**
 * Audio de demostración sintetizado.
 *
 * La aplicación no trae música real (derechos). Para que el tocadiscos suene
 * nada más abrirlo, se sintetizan pistas cortas con Web Audio
 * (OfflineAudioContext) y se guardan como WAV en el almacén de blobs. Son
 * melodías sencillas y deterministas a partir de una semilla.
 *
 * CONTRATO: el WAV es MONO a 32 000 Hz, PCM 16 bit (64 kB/s), para que la
 * colección de demostración completa quepa en ~25 MB; la biblioteca lo
 * remuestrea al decodificar. `encodeWav` escribe tantos canales como tenga
 * el buffer. Si `OfflineAudioContext` no existe (tests), `generateDemoTrack`
 * rechaza con un Error claro y el llamador crea la pista sin audio.
 *
 * Composición: un generador congruencial lineal (LCG) a partir de la semilla
 * elige una progresión de acordes sobre la escala, una melodía por paseo
 * aleatorio (que cae en nota del acorde al empezar cada compás y resuelve en
 * la tónica al final), acordes simples y un bajo. Cuatro timbres: piano
 * (triangular con envolvente percusiva), organ (senos sumados sostenidos),
 * bass-lead (diente de sierra filtrada) y bell (FM simple). Reverb corta por
 * convolución con ruido decreciente y limitador suave al final.
 */
export interface DemoTrackSpec {
  seed: number;
  /** Entre 20 y 40 s en la demo. */
  durationSec: number;
  bpm: number;
  /** Escala en semitonos desde la tónica, p. ej. [0,2,4,7,9] (pentatónica mayor). */
  scale: number[];
  rootHz: number;
  /** Timbre general. */
  voice: 'piano' | 'organ' | 'bass-lead' | 'bell';
}

export const DEMO_SAMPLE_RATE = 32000;

export type DemoPart = 'melody' | 'chord' | 'bass';

/** Una nota de la partitura generada. */
export interface DemoNote {
  timeSec: number;
  durationSec: number;
  hz: number;
  /** 0..1 */
  velocity: number;
  part: DemoPart;
}

/** Silencio final reservado a la cola de la reverb. */
export const DEMO_TAIL_SEC = 1.5;

const PROGRESSIONS: readonly (readonly number[])[] = [
  [0, 5, 3, 4],
  [0, 3, 4, 3],
  [0, 4, 5, 3],
  [5, 3, 0, 4],
  [0, 2, 3, 4],
];

const DEFAULT_SCALE = [0, 2, 4, 5, 7, 9, 11];

interface OfflineContextCtor {
  new (channels: number, length: number, sampleRate: number): OfflineAudioContext;
}

interface OfflineGlobals {
  OfflineAudioContext?: OfflineContextCtor;
  webkitOfflineAudioContext?: OfflineContextCtor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Generador congruencial lineal (Numerical Recipes): determinista a partir de la semilla. */
export function createDemoRng(seed: number): () => number {
  let state = (Math.floor(finiteOr(seed, 0)) >>> 0) || 0x1234567;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function normalizeScale(scale: number[]): number[] {
  const semitones = scale.filter((s) => Number.isFinite(s)).map((s) => ((Math.round(s) % 12) + 12) % 12);
  const unique = Array.from(new Set(semitones)).sort((a, b) => a - b);
  return unique.length > 0 ? unique : DEFAULT_SCALE;
}

/** Frecuencia del grado `degree` de la escala (los grados fuera de 0..n−1 cambian de octava). */
export function degreeToHz(rootHz: number, scale: number[], degree: number): number {
  const n = scale.length;
  const octave = Math.floor(degree / n);
  const semitone = scale[degree - octave * n] ?? 0;
  return rootHz * Math.pow(2, (semitone + 12 * octave) / 12);
}

/** Grado más cercano a `degree`, dentro de [low, high), cuya clase (mod n) está en `classes`. */
function nearestChordDegree(degree: number, classes: number[], n: number, low: number, high: number): number {
  let best = degree;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let d = low; d < high; d++) {
    if (!classes.includes(((d % n) + n) % n)) continue;
    const distance = Math.abs(d - degree);
    if (distance < bestDistance) {
      best = d;
      bestDistance = distance;
    }
  }
  return best;
}

function reflectInto(degree: number, low: number, high: number): number {
  let d = degree;
  while (d < low || d >= high) {
    if (d < low) d = 2 * low - d;
    if (d >= high) d = 2 * (high - 1) - d;
  }
  return d;
}

interface MelodyWalk {
  degree: number;
  low: number;
  high: number;
}

function nextMelodyDegree(walk: MelodyWalk, chordClasses: number[], n: number, rng: () => number): number {
  const r = rng();
  let step: number;
  if (r < 0.15) step = 0;
  else if (r < 0.5) step = rng() < 0.5 ? -1 : 1;
  else if (r < 0.7) step = rng() < 0.5 ? -2 : 2;
  else if (r < 0.8) step = (rng() < 0.5 ? -1 : 1) * (3 + Math.floor(rng() * 2));
  else {
    const target = nearestChordDegree(walk.degree + (rng() < 0.5 ? -1 : 1), chordClasses, n, walk.low, walk.high);
    step = target - walk.degree;
  }
  walk.degree = reflectInto(walk.degree + step, walk.low, walk.high);
  return walk.degree;
}

/** Patrón rítmico de un tiempo: duraciones en tiempos (suman 1); vacío = silencio. */
function pickBeatPattern(rng: () => number): number[] {
  const r = rng();
  if (r < 0.12) return [];
  if (r < 0.5) return [1];
  if (r < 0.85) return [0.5, 0.5];
  return [0.75, 0.25];
}

/** Partitura determinista: misma `spec` → mismas notas. */
export function composeDemoScore(spec: DemoTrackSpec): DemoNote[] {
  const rng = createDemoRng(spec.seed);
  const scale = normalizeScale(spec.scale);
  const n = scale.length;
  const rootHz = clamp(finiteOr(spec.rootHz, 220), 40, 2000);
  const beatSec = 60 / clamp(finiteOr(spec.bpm, 100), 40, 220);
  const barSec = 4 * beatSec;
  const durationSec = Math.max(2, finiteOr(spec.durationSec, 30));
  const bars = Math.max(1, Math.floor((durationSec - DEMO_TAIL_SEC) / barSec));
  const progression = PROGRESSIONS[Math.floor(rng() * PROGRESSIONS.length)] ?? PROGRESSIONS[0]!;
  const sustainedChords = spec.voice === 'organ' || spec.voice === 'bell';
  const notes: DemoNote[] = [];
  const walk: MelodyWalk = { degree: n + Math.floor(n / 2), low: n, high: 3 * n };

  const push = (part: DemoPart, timeSec: number, durationNote: number, degree: number, velocity: number): void => {
    notes.push({ part, timeSec, durationSec: durationNote, hz: degreeToHz(rootHz, scale, degree), velocity: clamp(velocity, 0, 1) });
  };

  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * barSec;
    const chordDegree = (progression[bar % progression.length] ?? 0) % n;
    const chordTones = [chordDegree, chordDegree + 2, chordDegree + 4];
    const chordClasses = chordTones.map((d) => d % n);

    // Acordes: sostenidos un compás entero o en dos golpes (tiempos 1 y 3).
    if (sustainedChords) {
      for (const tone of chordTones) push('chord', barStart, barSec * 0.95, tone + n, 0.5 + 0.1 * rng());
    } else {
      for (const beat of [0, 2]) {
        for (const tone of chordTones) push('chord', barStart + beat * beatSec, beatSec * 1.8, tone + n, 0.45 + 0.15 * rng());
      }
    }

    // Bajo: fundamental en los tiempos 1 y 3, a veces la quinta como anacrusa.
    push('bass', barStart, beatSec * 1.6, chordDegree - n, 0.85);
    push('bass', barStart + 2 * beatSec, beatSec * 1.6, chordDegree - n, 0.75);
    if (rng() < 0.35) push('bass', barStart + 3.5 * beatSec, beatSec * 0.45, chordDegree + 4 - n, 0.6);

    // Melodía.
    const lastBar = bar === bars - 1;
    if (lastBar) {
      const tonic = nearestChordDegree(walk.degree, [0], n, walk.low, walk.high);
      push('melody', barStart, barSec * 0.9, tonic, 0.8);
      continue;
    }
    let beat = 0;
    while (beat < 4) {
      const pattern = pickBeatPattern(rng);
      let offset = 0;
      for (const length of pattern) {
        const onBar = beat === 0 && offset === 0;
        let degree = nextMelodyDegree(walk, chordClasses, n, rng);
        if (onBar) {
          degree = nearestChordDegree(degree, chordClasses, n, walk.low, walk.high);
          walk.degree = degree;
        }
        const velocity = (0.55 + 0.4 * rng()) * (onBar ? 1.15 : 1);
        const legato = spec.voice === 'organ' ? 0.95 : 0.9;
        push('melody', barStart + (beat + offset) * beatSec, length * beatSec * legato, degree, velocity);
        offset += length;
      }
      beat += 1;
    }
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Síntesis
// ---------------------------------------------------------------------------

type Timbre = (context: BaseAudioContext, out: AudioNode, note: DemoNote, gain: number) => void;

/** Oscilador conectado y programado entre `start` y `stop`. */
function oscillator(
  context: BaseAudioContext,
  type: OscillatorType,
  hz: number,
  out: AudioNode,
  start: number,
  stop: number,
): OscillatorNode {
  const osc = context.createOscillator();
  osc.type = type;
  osc.frequency.value = hz;
  osc.connect(out);
  osc.start(start);
  osc.stop(stop);
  return osc;
}

/** Envolvente percusiva: ataque lineal y caída exponencial hasta `end`. */
function percussiveEnvelope(context: BaseAudioContext, start: number, peak: number, attack: number, end: number): GainNode {
  const env = context.createGain();
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(Math.max(0.0001, peak), start + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, Math.max(start + attack + 0.01, end));
  return env;
}

/** Envolvente sostenida: ataque, meseta y caída lineal al final de la nota. */
function sustainedEnvelope(context: BaseAudioContext, start: number, peak: number, attack: number, end: number, release: number): GainNode {
  const env = context.createGain();
  const attackEnd = Math.min(start + attack, start + (end - start) / 2);
  const releaseStart = Math.max(attackEnd, end - release);
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(peak, attackEnd);
  env.gain.setValueAtTime(peak, releaseStart);
  env.gain.linearRampToValueAtTime(0, end);
  return env;
}

const piano: Timbre = (context, out, note, gain) => {
  const start = note.timeSec;
  const end = start + Math.max(0.35, note.durationSec * 1.4);
  const env = percussiveEnvelope(context, start, note.velocity * gain, 0.005, end);
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.7;
  filter.frequency.setValueAtTime(Math.min(12000, note.hz * 6 + 1500), start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(200, note.hz * 1.5 + 300), start + 0.6);
  filter.connect(env);
  env.connect(out);
  oscillator(context, 'triangle', note.hz, filter, start, end + 0.05);
  const octave = context.createGain();
  octave.gain.value = 0.3;
  octave.connect(filter);
  oscillator(context, 'sine', note.hz * 2, octave, start, end + 0.05);
};

const organ: Timbre = (context, out, note, gain) => {
  const start = note.timeSec;
  const end = start + note.durationSec;
  const env = sustainedEnvelope(context, start, note.velocity * gain * 0.6, 0.02, end, 0.08);
  env.connect(out);
  const vibrato = context.createOscillator();
  vibrato.frequency.value = 5.5;
  const vibratoDepth = context.createGain();
  vibratoDepth.gain.value = 4; // cents
  vibrato.connect(vibratoDepth);
  vibrato.start(start);
  vibrato.stop(end + 0.05);
  const partials = [1, 0.5, 0.3, 0.2];
  partials.forEach((level, i) => {
    const partialGain = context.createGain();
    partialGain.gain.value = level;
    partialGain.connect(env);
    const osc = oscillator(context, 'sine', note.hz * (i + 1), partialGain, start, end + 0.05);
    vibratoDepth.connect(osc.detune);
  });
};

const bassLead: Timbre = (context, out, note, gain) => {
  const start = note.timeSec;
  const end = start + Math.max(0.15, note.durationSec);
  const peak = note.velocity * gain * 0.7;
  const env = context.createGain();
  const decayAt = Math.min(start + 0.3, start + (end - start) * 0.5);
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(peak, start + 0.008);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.45), decayAt);
  env.gain.setValueAtTime(Math.max(0.0001, peak * 0.45), Math.max(decayAt, end - 0.06));
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  env.connect(out);
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 6;
  filter.frequency.setValueAtTime(Math.min(12000, note.hz * 8 + 2000), start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(150, note.hz * 1.5 + 200), start + 0.25);
  filter.connect(env);
  oscillator(context, 'sawtooth', note.hz, filter, start, end + 0.02);
};

const bell: Timbre = (context, out, note, gain) => {
  const start = note.timeSec;
  const end = start + Math.max(1.2, note.durationSec * 1.5);
  const env = percussiveEnvelope(context, start, note.velocity * gain * 0.8, 0.003, end);
  env.connect(out);
  const carrier = oscillator(context, 'sine', note.hz, env, start, end + 0.02);
  const modulationDepth = context.createGain();
  modulationDepth.gain.setValueAtTime(note.hz * 2.2, start);
  modulationDepth.gain.exponentialRampToValueAtTime(Math.max(1, note.hz * 0.05), start + 1);
  modulationDepth.connect(carrier.frequency);
  oscillator(context, 'sine', note.hz * 1.4, modulationDepth, start, end + 0.02);
};

/** Colchón suave para los acordes cuando la melodía es la diente de sierra. */
const pad: Timbre = (context, out, note, gain) => {
  const start = note.timeSec;
  const end = start + note.durationSec;
  const env = sustainedEnvelope(context, start, note.velocity * gain * 0.5, 0.05, end, 0.1);
  env.connect(out);
  oscillator(context, 'sine', note.hz, env, start, end + 0.05);
  const octave = context.createGain();
  octave.gain.value = 0.3;
  octave.connect(env);
  oscillator(context, 'sine', note.hz * 2, octave, start, end + 0.05);
};

const bass: Timbre = (context, out, note, gain) => {
  const start = note.timeSec;
  const end = start + Math.max(0.12, note.durationSec);
  const peak = note.velocity * gain;
  const env = context.createGain();
  const decayAt = Math.min(start + 0.15, start + (end - start) * 0.5);
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(peak, start + 0.008);
  env.gain.linearRampToValueAtTime(peak * 0.5, decayAt);
  env.gain.setValueAtTime(peak * 0.5, Math.max(decayAt, end - 0.05));
  env.gain.linearRampToValueAtTime(0, end);
  env.connect(out);
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 500;
  filter.connect(env);
  oscillator(context, 'sine', note.hz, filter, start, end + 0.02);
  const triangle = context.createGain();
  triangle.gain.value = 0.35;
  triangle.connect(filter);
  oscillator(context, 'triangle', note.hz, triangle, start, end + 0.02);
};

const TIMBRES: Record<DemoTrackSpec['voice'], Timbre> = { piano, organ, 'bass-lead': bassLead, bell };

function chordTimbre(voice: DemoTrackSpec['voice']): Timbre {
  return voice === 'bass-lead' ? pad : TIMBRES[voice];
}

/** Curva de saturación suave (tanh normalizada) para el limitador. */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(1025 * 4));
  const drive = 1.5;
  const norm = Math.tanh(drive);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / norm;
  }
  return curve;
}

/** Respuesta al impulso de una sala pequeña: ruido con decaimiento exponencial y algo oscurecido. */
function reverbImpulse(context: BaseAudioContext, rng: () => number, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.round(seconds * context.sampleRate));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let lowpass = 0;
  for (let i = 0; i < length; i++) {
    const t = i / context.sampleRate;
    const white = rng() * 2 - 1;
    lowpass += 0.35 * (white - lowpass);
    data[i] = lowpass * Math.exp(-t / 0.22) * 0.5;
  }
  return buffer;
}

function renderScore(context: BaseAudioContext, score: DemoNote[], voice: DemoTrackSpec['voice'], rng: () => number): void {
  const bus = context.createGain();
  const master = context.createGain();
  master.gain.value = 0.9;
  const convolver = context.createConvolver();
  convolver.buffer = reverbImpulse(context, rng, 0.9);
  const wet = context.createGain();
  wet.gain.value = 0.22;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -10;
  compressor.knee.value = 8;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.12;
  const clipper = context.createWaveShaper();
  clipper.curve = softClipCurve();
  clipper.oversample = '2x';

  bus.connect(master);
  bus.connect(convolver);
  convolver.connect(wet);
  wet.connect(master);
  master.connect(compressor);
  compressor.connect(clipper);
  clipper.connect(context.destination);

  const melody = TIMBRES[voice];
  const chord = chordTimbre(voice);
  for (const note of score) {
    if (note.part === 'melody') melody(context, bus, note, 0.3);
    else if (note.part === 'chord') chord(context, bus, note, 0.12);
    else bass(context, bus, note, 0.28);
  }
}

function offlineContextCtor(): OfflineContextCtor | undefined {
  const globals = globalThis as unknown as OfflineGlobals;
  return globals.OfflineAudioContext ?? globals.webkitOfflineAudioContext;
}

/** Genera un WAV mono (PCM 16 bit, 32 kHz) con la pista descrita. */
export async function generateDemoTrack(spec: DemoTrackSpec): Promise<Blob> {
  const Ctor = offlineContextCtor();
  if (!Ctor) throw new Error('No hay OfflineAudioContext');
  const durationSec = clamp(finiteOr(spec.durationSec, 30), 2, 600);
  const length = Math.max(1, Math.round(durationSec * DEMO_SAMPLE_RATE));
  const context = new Ctor(1, length, DEMO_SAMPLE_RATE);
  const score = composeDemoScore({ ...spec, durationSec });
  renderScore(context, score, spec.voice, createDemoRng(Math.floor(finiteOr(spec.seed, 0)) ^ 0x5bd1e995));
  const buffer = await context.startRendering();
  return encodeWav(buffer);
}

// ---------------------------------------------------------------------------
// WAV
// ---------------------------------------------------------------------------

export interface WavSource {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** Bytes de un WAV PCM 16 bit (cabecera RIFF de 44 bytes más datos intercalados). */
export function encodeWavBytes(buffer: WavSource): ArrayBuffer {
  const channels = Math.max(1, buffer.numberOfChannels);
  const frames = Math.max(0, buffer.length);
  const blockAlign = channels * 2;
  const dataSize = frames * blockAlign;
  const bytes = new ArrayBuffer(44 + dataSize);
  const view = new DataView(bytes);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = clamp(data[c]?.[i] ?? 0, -1, 1);
      view.setInt16(offset, Math.round(sample < 0 ? sample * 32768 : sample * 32767), true);
      offset += 2;
    }
  }
  return bytes;
}

/** Codifica un AudioBuffer (o un objeto equivalente) como WAV PCM 16 bit. */
export function encodeWav(buffer: WavSource): Blob {
  return new Blob([encodeWavBytes(buffer)], { type: 'audio/wav' });
}
