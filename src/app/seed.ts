/**
 * Colección de demostración: tres vinilos (normal, con aro decorado y
 * enteramente decorado) con pistas sintetizadas, para que la habitación no
 * esté vacía la primera vez.
 *
 * CONTRATO (lo implementa el módulo de aplicación): genera las pistas con
 * `generateDemoTrack` (cada una entre 20 y 40 s, como mucho 3 por cara, en
 * total ~25 MB de WAV mono a 32 kHz), las guarda en `store.blobs` y añade
 * los vinilos con `store.addVinyl`. Los títulos y artistas son ficticios y
 * se presentan como demostración (no se inventan discos reales). Si no hay
 * `OfflineAudioContext` (tests), las pistas se crean sin audio con las
 * duraciones previstas.
 */
import type { Store } from '../core/store';
import type { Vinyl } from '../core/types';

export async function seedDemoCollection(_store: Store): Promise<Vinyl[]> {
  throw new Error('seedDemoCollection: no implementado todavía');
}
