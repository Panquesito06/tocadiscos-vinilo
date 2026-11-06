/**
 * Formato y lectura de valores para los controles del editor: duraciones
 * "m:ss", números con coma decimal, porcentajes y colores hexadecimales
 * (lo único que entiende `<input type="color">`).
 */

/** Duración máxima que se acepta al escribir a mano la de una canción (99:59). */
export const MAX_TRACK_SEC = 99 * 60 + 59;

/** "3:07" o, a partir de una hora, "1:02:07". Redondea al segundo. */
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(sec) ? sec : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * Lee una duración escrita a mano: "3:07", "03:07", "1:02:07" o segundos
 * sueltos ("187"). Devuelve null si no se entiende, si no es positiva o si
 * supera `MAX_TRACK_SEC`.
 */
export function parseDuration(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  let total: number;
  if (/^\d+$/.test(t)) {
    total = Number(t);
  } else {
    const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) return null;
    const hours = m[1] === undefined ? 0 : Number(m[1]);
    const minutes = Number(m[2]);
    const seconds = Number(m[3]);
    if (seconds >= 60 || (m[1] !== undefined && minutes >= 60)) return null;
    total = hours * 3600 + minutes * 60 + seconds;
  }
  return total > 0 && total <= MAX_TRACK_SEC ? total : null;
}

const decimalFormats = new Map<number, Intl.NumberFormat>();

/** Número con coma decimal y exactamente `digits` decimales ("1,45"). */
export function formatDecimal(value: number, digits = 1): string {
  let fmt = decimalFormats.get(digits);
  if (!fmt) {
    fmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    decimalFormats.set(digits, fmt);
  }
  return fmt.format(value);
}

/** Valor 0..1 como porcentaje entero ("35 %", con espacio fino de no separación). */
export function formatPercent(value: number): string {
  return `${Math.round(value * 100)} %`;
}

/** Milímetros con un decimal ("8,5 mm"). */
export function formatMm(value: number): string {
  return `${formatDecimal(value, 1)} mm`;
}

/** Segundos con un decimal ("2,5 s"). */
export function formatSeconds(value: number): string {
  return `${formatDecimal(value, 1)} s`;
}

function hex2(n: number): string {
  return Math.min(255, Math.max(0, Math.round(n)))
    .toString(16)
    .padStart(2, '0');
}

/**
 * Convierte un color CSS sencillo a "#rrggbb": acepta "#rgb", "#rrggbb",
 * "#rrggbbaa" (se descarta la transparencia) y "rgb()/rgba()". Devuelve null
 * si no lo entiende (nombres de color, hsl…).
 */
export function toHexColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const long = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(v);
  if (long) return `#${long[1]}`;
  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/.exec(v);
  if (rgb) return `#${hex2(Number(rgb[1]))}${hex2(Number(rgb[2]))}${hex2(Number(rgb[3]))}`;
  return null;
}

/** Fecha y hora cortas en español, o "Nunca" si no hay marca de tiempo. */
export function formatTimestamp(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return 'Nunca';
  return new Date(ms).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Mensaje legible de un error cualquiera. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}
