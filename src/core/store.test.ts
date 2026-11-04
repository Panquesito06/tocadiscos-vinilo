import { describe, expect, it } from 'vitest';
import { openDB } from 'idb';

describe('exploración del entorno', () => {
  it('blobs en fake-indexeddb', async () => {
    const blob = new Blob(['hola'], { type: 'text/plain' });
    console.log('Blob ctor global ===', Blob.name, blob.constructor.name, blob instanceof Blob);
    console.log('URL.createObjectURL type', typeof URL.createObjectURL, URL.name);
    let cloned: unknown;
    try {
      cloned = structuredClone(blob);
      console.log('structuredClone ok', cloned, (cloned as object)?.constructor?.name, cloned instanceof Blob);
    } catch (e) {
      console.log('structuredClone threw', String(e));
    }
    const db = await openDB('explora', 1, {
      upgrade(d) {
        d.createObjectStore('blobs');
      },
    });
    try {
      await db.put('blobs', blob, 'k1');
      const back = await db.get('blobs', 'k1');
      console.log('back', back, back?.constructor?.name, back instanceof Blob, typeof back?.text);
      if (back && typeof back.text === 'function') console.log('text', await back.text());
      try {
        const u = URL.createObjectURL(back);
        console.log('createObjectURL ok', u);
      } catch (e) {
        console.log('createObjectURL threw', String(e));
      }
    } catch (e) {
      console.log('put threw', String(e));
    }
    try {
      const u = URL.createObjectURL(blob);
      console.log('createObjectURL(original) ok', u);
      URL.revokeObjectURL(u);
    } catch (e) {
      console.log('createObjectURL(original) threw', String(e));
    }
    console.log('setTimeout/clearTimeout types', typeof setTimeout, typeof queueMicrotask);
    expect(true).toBe(true);
  });
});
