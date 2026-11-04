/**
 * Procesador de AudioWorklet 'vinyl-player': reproduce la línea de tiempo de
 * una cara (pistas con huecos de silencio) a velocidad variable.
 *
 * JavaScript plano sin imports: las formas de los mensajes y las constantes
 * están definidas en `src/audio/protocol.ts` y se repiten aquí a mano.
 *
 * Mensajes que recibe por el puerto:
 *  - 'timeline'     {tracks: [{startSec, durationSec}], gapSec, totalSec, leadInSec, leadOutSec}
 *  - 'track'        {index, sampleRate, channels: Int16Array[], length}  (length 0 = pista sin audio)
 *  - 'unload-track' {index}
 *  - 'seek'         {sec, seq}
 *  - 'stylus'       {down}
 *  - 'effects'      {wobbleDepth, wobbleHz}
 *  - 'reset'
 * Mensajes que envía:
 *  - 'position' {sec, contextTime, seq} cada ~50 ms (y justo después de cada seek)
 *  - 'end'      una vez cada vez que la posición cruza totalSec hacia delante
 *  - 'need'     {index} cuando entra en una pista que no tiene o está a menos de 20 s de otra
 *
 * Parámetro 'rate' (a-rate, −8…8): multiplicador de velocidad respecto a la
 * nominal. El avance por muestra de salida, en muestras de la pista, es
 * rate × (pista.sampleRate / sampleRate) × (1 + wobbleDepth·sin(2π·wobbleHz·t)).
 * Aquí la posición se lleva en segundos, que es lo mismo expresado de otra
 * forma; la lectura es con interpolación lineal.
 */

const POSITION_REPORT_SEC = 0.05;
const PRELOAD_AHEAD_SEC = 20;
const SEEK_FADE_SEC = 0.005;
/** Si una pista pedida no llega, se vuelve a pedir pasado este tiempo. */
const NEED_RETRY_SEC = 3;
const INT16_SCALE = 1 / 32768;
const TWO_PI = Math.PI * 2;

const EMPTY_TIMELINE = { tracks: [], totalSec: 0, minSec: 0, maxSec: 0 };

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/**
 * Una "voz" es un cabezal de lectura: posición más la caché del segmento
 * (pista o hueco) en el que está, para no buscar en cada muestra. La voz
 * principal suena siempre; la voz de cola solo durante el fundido de un seek.
 */
class Voice {
  constructor() {
    this.pos = 0;
    this.track = -1;
    this.trackStart = 0;
    this.segStart = Infinity;
    this.segEnd = -Infinity;
    this.gain = 1;
    this.active = false;
  }

  copyFrom(other) {
    this.pos = other.pos;
    this.track = other.track;
    this.trackStart = other.trackStart;
    this.segStart = other.segStart;
    this.segEnd = other.segEnd;
  }

  invalidate() {
    this.track = -1;
    this.segStart = Infinity;
    this.segEnd = -Infinity;
  }
}

class VinylPlayerProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'rate', defaultValue: 0, minValue: -8, maxValue: 8, automationRate: 'a-rate' }];
  }

  constructor(options) {
    super(options);
    this.timeline = EMPTY_TIMELINE;
    /** index → {sampleRate, channels, length} */
    this.tracks = new Map();
    /** index → currentTime en que se pidió la pista. */
    this.needSentAt = new Map();
    this.main = new Voice();
    this.main.active = true;
    this.tail = new Voice();
    this.fadeStep = 1 / Math.max(1, Math.round(SEEK_FADE_SEC * sampleRate));
    this.fadeGain = 1;
    this.stylusDown = false;
    this.wobbleDepth = 0;
    this.wobbleInc = 0;
    this.wobblePhase = 0;
    this.seq = 0;
    this.endFired = false;
    this.reportEvery = Math.max(1, Math.round(POSITION_REPORT_SEC * sampleRate));
    this.sinceReport = 0;
    this.frame = [0, 0];
    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  // -------------------------------------------------------------------------
  // Mensajes
  // -------------------------------------------------------------------------

  handleMessage(message) {
    if (!message || typeof message.type !== 'string') return;
    switch (message.type) {
      case 'timeline':
        this.setTimeline(message);
        break;
      case 'track':
        this.storeTrack(message);
        break;
      case 'unload-track':
        if (Number.isInteger(message.index)) {
          this.tracks.delete(message.index);
          this.needSentAt.delete(message.index);
        }
        break;
      case 'seek':
        this.seek(message.sec, message.seq);
        break;
      case 'stylus':
        this.stylusDown = !!message.down;
        if (!this.stylusDown) this.tail.active = false;
        break;
      case 'effects':
        this.setEffects(message);
        break;
      case 'reset':
        this.reset();
        break;
      default:
        break;
    }
  }

  /** Guarda el audio de una pista; la longitud nunca supera la de sus canales. */
  storeTrack(message) {
    if (!Number.isInteger(message.index)) return;
    const channels = Array.isArray(message.channels) ? message.channels.filter((c) => c instanceof Int16Array) : [];
    let length = 0;
    if (channels.length > 0 && message.length > 0) {
      length = Math.floor(message.length);
      for (const channel of channels) length = Math.min(length, channel.length);
    }
    this.tracks.set(message.index, {
      sampleRate: message.sampleRate > 0 ? message.sampleRate : sampleRate,
      channels,
      length,
    });
    this.needSentAt.delete(message.index);
  }

  setTimeline(message) {
    const tracks = [];
    for (const t of message.tracks) {
      const startSec = Number.isFinite(t.startSec) ? t.startSec : 0;
      const durationSec = Number.isFinite(t.durationSec) ? Math.max(0, t.durationSec) : 0;
      tracks.push({ startSec, durationSec, endSec: startSec + durationSec });
    }
    const totalSec = Number.isFinite(message.totalSec) ? Math.max(0, message.totalSec) : 0;
    const leadInSec = Number.isFinite(message.leadInSec) ? Math.max(0, message.leadInSec) : 0;
    const leadOutSec = Number.isFinite(message.leadOutSec) ? Math.max(0, message.leadOutSec) : 0;
    this.timeline = { tracks, totalSec, minSec: -leadInSec, maxSec: totalSec + leadOutSec };
    this.tracks.clear();
    this.needSentAt.clear();
    this.placeHead(0);
  }

  setEffects(message) {
    const depth = Number.isFinite(message.wobbleDepth) ? clamp(message.wobbleDepth, 0, 0.5) : 0;
    const hz = Number.isFinite(message.wobbleHz) ? Math.max(0, message.wobbleHz) : 0;
    this.wobbleDepth = depth;
    this.wobbleInc = (TWO_PI * hz) / sampleRate;
    if (depth === 0) this.wobblePhase = 0;
  }

  reset() {
    this.timeline = EMPTY_TIMELINE;
    this.tracks.clear();
    this.needSentAt.clear();
    this.tail.active = false;
    this.main.pos = 0;
    this.main.invalidate();
    this.fadeGain = 1;
    this.endFired = false;
    this.wobblePhase = 0;
  }

  /** Coloca el cabezal sin fundido (nueva línea de tiempo). */
  placeHead(sec) {
    this.tail.active = false;
    this.main.pos = clamp(sec, this.timeline.minSec, this.timeline.maxSec);
    this.main.invalidate();
    this.fadeGain = 1;
    this.endFired = this.main.pos >= this.timeline.totalSec;
  }

  seek(sec, seq) {
    const target = clamp(Number.isFinite(sec) ? sec : 0, this.timeline.minSec, this.timeline.maxSec);
    if (this.stylusDown) {
      // Lo que sonaba sigue 5 ms desvaneciéndose mientras entra la nueva posición.
      this.tail.copyFrom(this.main);
      this.tail.gain = this.fadeGain;
      this.tail.active = true;
      this.fadeGain = 0;
    } else {
      this.tail.active = false;
      this.fadeGain = 1;
    }
    this.main.pos = target;
    this.main.invalidate();
    if (Number.isFinite(seq)) this.seq = seq;
    this.endFired = target >= this.timeline.totalSec;
    this.sinceReport = 0;
    this.report(currentTime);
  }

  report(atTime) {
    this.port.postMessage({ type: 'position', sec: this.main.pos, contextTime: atTime, seq: this.seq });
  }

  // -------------------------------------------------------------------------
  // Lectura
  // -------------------------------------------------------------------------

  /** Localiza el segmento (pista o hueco) que contiene la posición de la voz. */
  resolveSegment(voice) {
    const tracks = this.timeline.tracks;
    const n = tracks.length;
    const pos = voice.pos;
    let i = 0;
    while (i < n && tracks[i].endSec <= pos) i++;
    if (i >= n) {
      voice.track = -1;
      voice.segStart = n > 0 ? tracks[n - 1].endSec : -Infinity;
      voice.segEnd = Infinity;
      return;
    }
    const track = tracks[i];
    if (pos >= track.startSec) {
      voice.track = i;
      voice.trackStart = track.startSec;
      voice.segStart = track.startSec;
      voice.segEnd = track.endSec;
    } else {
      voice.track = -1;
      voice.segStart = i > 0 ? tracks[i - 1].endSec : -Infinity;
      voice.segEnd = track.startSec;
    }
  }

  /** Lee un fotograma estéreo de la voz con interpolación lineal (0 fuera del audio cargado). */
  readFrame(voice, out) {
    out[0] = 0;
    out[1] = 0;
    const pos = voice.pos;
    if (pos < voice.segStart || pos >= voice.segEnd) this.resolveSegment(voice);
    if (voice.track < 0) return;
    const data = this.tracks.get(voice.track);
    if (!data || data.length === 0) return;
    const index = (pos - voice.trackStart) * data.sampleRate;
    const i0 = Math.floor(index);
    if (i0 < 0 || i0 >= data.length) return;
    const i1 = i0 + 1 < data.length ? i0 + 1 : i0;
    const frac = index - i0;
    const channels = data.channels;
    const left = channels[0];
    const right = channels.length > 1 ? channels[1] : left;
    out[0] = (left[i0] + (left[i1] - left[i0]) * frac) * INT16_SCALE;
    out[1] = (right[i0] + (right[i1] - right[i0]) * frac) * INT16_SCALE;
  }

  // -------------------------------------------------------------------------
  // Peticiones de pistas
  // -------------------------------------------------------------------------

  requestTrack(index) {
    if (this.tracks.has(index)) return;
    const sentAt = this.needSentAt.get(index);
    if (sentAt !== undefined && currentTime - sentAt < NEED_RETRY_SEC) return;
    this.needSentAt.set(index, currentTime);
    this.port.postMessage({ type: 'need', index });
  }

  /** Pide la pista bajo el cabezal y las que están a menos de 20 s en cualquier sentido. */
  checkNeeds() {
    const tracks = this.timeline.tracks;
    const n = tracks.length;
    if (n === 0) return;
    const pos = this.main.pos;
    let i = 0;
    while (i < n && tracks[i].endSec <= pos) i++;
    if (i < n) {
      const track = tracks[i];
      if (pos >= track.startSec) {
        this.requestTrack(i);
        if (i + 1 < n && tracks[i + 1].startSec - pos < PRELOAD_AHEAD_SEC) this.requestTrack(i + 1);
      } else if (track.startSec - pos < PRELOAD_AHEAD_SEC) {
        this.requestTrack(i);
      }
    }
    if (i > 0 && pos - tracks[i - 1].endSec < PRELOAD_AHEAD_SEC) this.requestTrack(i - 1);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const left = output[0];
    const right = output.length > 1 ? output[1] : null;
    const n = left.length;
    const rate = parameters.rate;
    const rateIsArray = rate.length > 1;
    const timeline = this.timeline;
    const invSampleRate = 1 / sampleRate;
    const main = this.main;
    const tail = this.tail;
    const frame = this.frame;
    const stylusDown = this.stylusDown;
    const wobbleDepth = this.wobbleDepth;

    for (let i = 0; i < n; i++) {
      let step = (rateIsArray ? rate[i] : rate[0]) * invSampleRate;
      if (wobbleDepth > 0) {
        step *= 1 + wobbleDepth * Math.sin(this.wobblePhase);
        this.wobblePhase += this.wobbleInc;
        if (this.wobblePhase >= TWO_PI) this.wobblePhase -= TWO_PI;
      }

      const prev = main.pos;
      const pos = clamp(prev + step, timeline.minSec, timeline.maxSec);
      main.pos = pos;
      if (pos >= timeline.totalSec) {
        if (!this.endFired && prev < timeline.totalSec && timeline.totalSec > 0) {
          this.endFired = true;
          this.port.postMessage({ type: 'end' });
        }
      } else {
        this.endFired = false;
      }

      let l = 0;
      let r = 0;
      if (stylusDown) {
        if (pos >= 0 && pos < timeline.totalSec) {
          this.readFrame(main, frame);
          l = frame[0];
          r = frame[1];
        }
        if (this.fadeGain < 1) {
          this.fadeGain = Math.min(1, this.fadeGain + this.fadeStep);
          l *= this.fadeGain;
          r *= this.fadeGain;
        }
        if (tail.active) {
          // Las dos ganancias suman 1 en cada muestra: una señal continua no cambia de nivel.
          tail.gain -= this.fadeStep;
          if (tail.gain <= 0) {
            tail.active = false;
          } else {
            tail.pos = clamp(tail.pos + step, timeline.minSec, timeline.maxSec);
            if (tail.pos >= 0 && tail.pos < timeline.totalSec) {
              this.readFrame(tail, frame);
              l += frame[0] * tail.gain;
              r += frame[1] * tail.gain;
            }
          }
        }
      }
      left[i] = l;
      if (right) right[i] = r;
    }

    this.sinceReport += n;
    if (this.sinceReport >= this.reportEvery) {
      this.sinceReport = 0;
      this.report(currentTime + n * invSampleRate);
    }
    this.checkNeeds();
    return true;
  }
}

registerProcessor('vinyl-player', VinylPlayerProcessor);
