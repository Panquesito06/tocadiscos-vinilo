/**
 * Caché de imágenes: carga las imágenes referenciadas por los vinilos desde
 * el almacén de blobs y las mantiene como HTMLImageElement listas para
 * dibujar en canvas de forma síncrona.
 */
import type { BlobStore } from '../core/store';
import type { Fill, ImageRef, Vinyl } from '../core/types';

export class ImageCache {
  private images = new Map<string, HTMLImageElement>();
  private pending = new Map<string, Promise<void>>();
  private listeners = new Set<() => void>();

  constructor(private blobs: BlobStore) {}

  /** Imagen lista para dibujar, o null si aún no se cargó. */
  get(ref: ImageRef | null | undefined): HTMLImageElement | null {
    if (!ref) return null;
    const img = this.images.get(ref.blobKey);
    return img && img.complete && img.naturalWidth > 0 ? img : null;
  }

  has(ref: ImageRef | null | undefined): boolean {
    return this.get(ref) !== null;
  }

  /** Carga (si hace falta) todas las referencias. Resuelve cuando están listas o han fallado. */
  async ensure(refs: (ImageRef | null | undefined)[]): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const ref of refs) {
      if (!ref) continue;
      if (this.images.has(ref.blobKey)) continue;
      let p = this.pending.get(ref.blobKey);
      if (!p) {
        p = this.load(ref.blobKey);
        this.pending.set(ref.blobKey, p);
      }
      tasks.push(p);
    }
    await Promise.all(tasks);
  }

  /** Se llama cuando una imagen nueva queda lista (para volver a dibujar). */
  onLoad(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  forget(blobKey: string): void {
    this.images.delete(blobKey);
    this.pending.delete(blobKey);
  }

  private async load(blobKey: string): Promise<void> {
    try {
      const url = await this.blobs.url(blobKey);
      if (!url) return;
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          this.images.set(blobKey, img);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = url;
      });
      for (const l of Array.from(this.listeners)) l();
    } finally {
      this.pending.delete(blobKey);
    }
  }
}

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
