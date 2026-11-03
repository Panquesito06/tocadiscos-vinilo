/** Identificadores únicos cortos. Usa crypto.randomUUID cuando existe. */
export function newId(prefix = ''): string {
  const c = globalThis.crypto;
  let raw: string;
  if (c && typeof c.randomUUID === 'function') {
    raw = c.randomUUID().replace(/-/g, '').slice(0, 16);
  } else {
    raw = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  }
  return prefix ? `${prefix}_${raw}` : raw;
}
