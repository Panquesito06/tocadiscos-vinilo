/**
 * Recolección de claves del almacén de blobs que usa un vinilo (imágenes y
 * audio). Lo usan el store (para borrar huérfanos), el editor (al sustituir
 * una imagen o un audio) y la aplicación (para vaciar cachés).
 */
import type { Fill, ImageRef, Vinyl } from './types';

function refOfFill(fill: Fill | null | undefined): ImageRef | null {
  return fill && fill.kind === 'image' ? fill.image : null;
}

/** Todas las referencias de imagen que usa un vinilo. */
export function collectImageRefs(vinyl: Vinyl): ImageRef[] {
  const refs: (ImageRef | null | undefined)[] = [];
  for (const side of vinyl.disc.sides) {
    refs.push(refOfFill(side.label.background), side.label.image, side.ring.image, refOfFill(side.artwork));
  }
  refs.push(refOfFill(vinyl.innerSleeve.printFront), refOfFill(vinyl.innerSleeve.printBack));
  refs.push(
    refOfFill(vinyl.jacket.front),
    refOfFill(vinyl.jacket.back),
    refOfFill(vinyl.jacket.insideLeft),
    refOfFill(vinyl.jacket.insideRight),
  );
  refs.push(refOfFill(vinyl.outerSleeve.print));
  return refs.filter((r): r is ImageRef => !!r);
}

/** Claves de audio de todas las pistas de ambas caras. */
export function collectAudioKeys(vinyl: Vinyl): string[] {
  const keys: string[] = [];
  for (const side of vinyl.disc.sides) for (const t of side.tracks) if (t.audio) keys.push(t.audio.blobKey);
  return keys;
}

/** Todas las claves de blob (imágenes y audio) de un vinilo, sin repetidos. */
export function collectBlobKeys(vinyl: Vinyl): string[] {
  const set = new Set<string>();
  for (const r of collectImageRefs(vinyl)) set.add(r.blobKey);
  for (const k of collectAudioKeys(vinyl)) set.add(k);
  return Array.from(set);
}

/** Claves que usa `vinyl` y ningún otro vinilo de `others`. */
export function orphanBlobKeys(vinyl: Vinyl, others: Vinyl[]): string[] {
  const used = new Set<string>();
  for (const o of others) if (o.id !== vinyl.id) for (const k of collectBlobKeys(o)) used.add(k);
  return collectBlobKeys(vinyl).filter((k) => !used.has(k));
}

/** True si alguna pista o imagen de algún vinilo de la lista usa la clave. */
export function isBlobKeyInUse(key: string, vinyls: Vinyl[]): boolean {
  return vinyls.some((v) => collectBlobKeys(v).includes(key));
}
