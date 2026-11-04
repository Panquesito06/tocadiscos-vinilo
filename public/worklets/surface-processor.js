/**
 * Procesador de AudioWorklet 'vinyl-surface': ruido de superficie del disco.
 *
 * JavaScript plano sin imports: las formas de los mensajes están definidas en
 * `src/audio/protocol.ts` y se repiten aquí a mano.
 *
 * Mensajes que recibe por el puerto:
 *  - 'effects' {crackleRate, crackleGain, hissGain, rumbleGain, wobbleDepth, wobbleHz, clickRate, clickGain}
 *  - 'stylus'  {down}
 *  - 'thump'   golpe sordo breve (impulso filtrado a ~60 Hz, ~80 ms)
 *  - 'speed'   {factor} velocidad relativa (atenúa el siseo con el plato lento o parado)
 *
 * Componentes:
 *  - Crepitar: ráfagas de ruido con envolvente exponencial (2–6 ms), densidad
 *    crackleRate por segundo, ganancia crackleGain·0,25.
 *  - Siseo: ruido blanco con paso bajo de un polo (~4 kHz) y realce leve a
 *    1–2 kHz, ganancia hissGain·0,05.
 *  - Clics: ráfagas más cortas y fuertes (clickRate, clickGain·0,3).
 *  - Zumbido del motor: seno a 30 Hz más armónico a 60 Hz, ganancia
 *    rumbleGain·0,02; suena siempre que rumbleGain > 0, con la aguja
 *    levantada también. El resto solo con la aguja apoyada.
 *  - Todas las ganancias con slew (~20 ms) para no hacer clics al cambiar.
 */

const SLEW_SEC = 0.02;
const CRACKLE_LEVEL = 0.25;
const HISS_LEVEL = 0.05;
const CLICK_LEVEL = 0.3;
const RUMBLE_LEVEL = 0.02;
const THUMP_LEVEL = 0.45;
const HISS_LOWPASS_HZ = 4000;
const HISS_PRESENCE_HZ = 1500;
const HISS_PRESENCE_Q = 0.9;
const HISS_PRESENCE_MIX = 0.6;
const THUMP_HZ = 60;
const THUMP_DECAY_SEC = 0.025;
const MAX_BURSTS = 24;
const TWO_PI = Math.PI * 2;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function finiteOrZero(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Generador xorshift32: más barato y predecible que Math.random en el hilo de audio. */
class Noise {
  constructor(seed) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** Número en [0, 1). */
  next() {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 4294967296;
  }

  /** Ruido blanco en [−1, 1). */
  white() {
    return this.next() * 2 - 1;
  }
}

/** Filtro paso banda biquad (RBJ) con ganancia 0 dB en el pico. */
class BandPass {
  constructor(hz, q) {
    const w0 = (TWO_PI * hz) / sampleRate;
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * Math.cos(w0)) / a0;
    this.a2 = (1 - alpha) / a0;
    this.z1 = 0;
    this.z2 = 0;
  }

  step(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = -this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** Un canal de siseo: paso bajo de un polo más realce de presencia. */
class HissChannel {
  constructor() {
    this.lpCoef = 1 - Math.exp((-TWO_PI * HISS_LOWPASS_HZ) / sampleRate);
    this.lp = 0;
    this.presence = new BandPass(HISS_PRESENCE_HZ, HISS_PRESENCE_Q);
  }

  step(white) {
    this.lp += this.lpCoef * (white - this.lp);
    return this.lp + HISS_PRESENCE_MIX * this.presence.step(white);
  }
}

class VinylSurfaceProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this.noise = new Noise(0x2545f491);
    this.fx = {
      crackleRate: 0,
      crackleGain: 0,
      hissGain: 0,
      rumbleGain: 0,
      clickRate: 0,
      clickGain: 0,
    };
    this.stylusDown = false;
    this.speed = 1;
    this.slewCoef = 1 - Math.exp(-1 / (SLEW_SEC * sampleRate));
    // Ganancias suavizadas (slew de ~20 ms).
    this.gStylus = 0;
    this.gCrackle = 0;
    this.gHiss = 0;
    this.gClick = 0;
    this.gRumble = 0;
    this.hissL = new HissChannel();
    this.hissR = new HissChannel();
    /** Ráfagas activas: {env, decay, click, polarity}. */
    this.bursts = [];
    this.rumblePhase30 = 0;
    this.rumblePhase60 = 0;
    this.rumbleInc30 = (TWO_PI * 30) / sampleRate;
    this.rumbleInc60 = (TWO_PI * 60) / sampleRate;
    this.thumpEnv = 0;
    this.thumpPhase = 0;
    this.thumpInc = (TWO_PI * THUMP_HZ) / sampleRate;
    this.thumpDecay = Math.exp(-1 / (THUMP_DECAY_SEC * sampleRate));
    this.thumpTick = 0;
    this.thumpTickDecay = Math.exp(-1 / (0.0015 * sampleRate));
    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  handleMessage(message) {
    if (!message || typeof message.type !== 'string') return;
    switch (message.type) {
      case 'effects':
        this.fx.crackleRate = finiteOrZero(message.crackleRate);
        this.fx.crackleGain = clamp(finiteOrZero(message.crackleGain), 0, 1);
        this.fx.hissGain = clamp(finiteOrZero(message.hissGain), 0, 1);
        this.fx.rumbleGain = clamp(finiteOrZero(message.rumbleGain), 0, 1);
        this.fx.clickRate = finiteOrZero(message.clickRate);
        this.fx.clickGain = clamp(finiteOrZero(message.clickGain), 0, 1);
        break;
      case 'stylus':
        this.stylusDown = !!message.down;
        break;
      case 'thump':
        this.thumpEnv = THUMP_LEVEL;
        this.thumpPhase = 0;
        this.thumpTick = 0.3;
        break;
      case 'speed':
        this.speed = clamp(Number.isFinite(message.factor) ? Math.abs(message.factor) : 1, 0, 1);
        break;
      default:
        break;
    }
  }

  spawnBurst(click) {
    if (this.bursts.length >= MAX_BURSTS) return;
    const noise = this.noise;
    // Crepitar: 2–6 ms; clic: 0,3–0,8 ms, más fuerte.
    const tauSec = click ? 0.0003 + 0.0005 * noise.next() : 0.002 + 0.004 * noise.next();
    const amp = click ? 0.6 + 0.4 * noise.next() : 0.3 + 0.7 * noise.next();
    this.bursts.push({
      env: amp,
      decay: Math.exp(-1 / (tauSec * sampleRate)),
      click,
      polarity: noise.next() < 0.5 ? -1 : 1,
    });
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const left = output[0];
    const right = output.length > 1 ? output[1] : null;
    const n = left.length;
    const noise = this.noise;
    const fx = this.fx;
    const slew = this.slewCoef;
    const invSampleRate = 1 / sampleRate;
    const crackleProb = fx.crackleRate * invSampleRate;
    const clickProb = fx.clickRate * invSampleRate;
    const speedGain = Math.sqrt(this.speed);
    const targetStylus = this.stylusDown ? 1 : 0;
    const targetCrackle = fx.crackleGain * CRACKLE_LEVEL;
    const targetHiss = fx.hissGain * HISS_LEVEL * speedGain;
    const targetClick = fx.clickGain * CLICK_LEVEL;
    const targetRumble = fx.rumbleGain * RUMBLE_LEVEL;
    const bursts = this.bursts;

    for (let i = 0; i < n; i++) {
      this.gStylus += (targetStylus - this.gStylus) * slew;
      this.gCrackle += (targetCrackle - this.gCrackle) * slew;
      this.gHiss += (targetHiss - this.gHiss) * slew;
      this.gClick += (targetClick - this.gClick) * slew;
      this.gRumble += (targetRumble - this.gRumble) * slew;

      const whiteL = noise.white();
      const whiteR = noise.white();
      let surfaceL = 0;
      let surfaceR = 0;

      if (this.gStylus > 1e-4) {
        if (crackleProb > 0 && noise.next() < crackleProb) this.spawnBurst(false);
        if (clickProb > 0 && noise.next() < clickProb) this.spawnBurst(true);
        let crackle = 0;
        let click = 0;
        for (let b = bursts.length - 1; b >= 0; b--) {
          const burst = bursts[b];
          burst.env *= burst.decay;
          if (burst.env < 1e-4) {
            bursts[b] = bursts[bursts.length - 1];
            bursts.pop();
            continue;
          }
          if (burst.click) click += burst.env * (0.7 * whiteL + 0.5 * burst.polarity);
          else crackle += burst.env;
        }
        const pops = crackle * whiteL * this.gCrackle + click * this.gClick;
        surfaceL = (pops + this.hissL.step(whiteL) * this.gHiss) * this.gStylus;
        surfaceR = (pops + this.hissR.step(whiteR) * this.gHiss) * this.gStylus;
      } else if (bursts.length > 0) {
        bursts.length = 0;
      }

      let common = 0;
      if (this.gRumble > 1e-6) {
        common += (Math.sin(this.rumblePhase30) + 0.5 * Math.sin(this.rumblePhase60)) * this.gRumble;
        this.rumblePhase30 += this.rumbleInc30;
        if (this.rumblePhase30 >= TWO_PI) this.rumblePhase30 -= TWO_PI;
        this.rumblePhase60 += this.rumbleInc60;
        if (this.rumblePhase60 >= TWO_PI) this.rumblePhase60 -= TWO_PI;
      }
      if (this.thumpEnv > 1e-5) {
        common += this.thumpEnv * Math.sin(this.thumpPhase) + this.thumpTick * whiteL;
        this.thumpPhase += this.thumpInc;
        this.thumpEnv *= this.thumpDecay;
        this.thumpTick *= this.thumpTickDecay;
      }

      left[i] = surfaceL + common;
      if (right) right[i] = surfaceR + common;
    }
    return true;
  }
}

registerProcessor('vinyl-surface', VinylSurfaceProcessor);
