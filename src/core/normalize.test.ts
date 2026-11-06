import { describe, expect, it } from 'vitest';
import {
  applyPresetDecoration,
  createVinyl,
  defaultMeta,
  normalizeVinyl,
  presetNormal,
  presetRing,
  spineTextFor,
  syncDerivedTexts,
  touch,
  track,
} from './defaults';
import { collectBlobKeys, orphanBlobKeys } from './blobs';

describe('normalizeVinyl', () => {
  it('rellena campos ausentes de un documento antiguo sin perder los presentes', () => {
    const old = {
      id: 'vin_old',
      createdAt: 1000,
      meta: { artist: 'Alguien', title: 'Algo' },
      disc: {
        format: '7',
        sides: [{ id: 'A', tracks: [{ id: 't1', title: 'Uno', durationSec: 30, audio: null }] }],
      },
      jacket: { front: { kind: 'gradient', from: '#000', to: '#fff', angleDeg: 45, radial: true } },
    };
    const v = normalizeVinyl(old);
    expect(v.id).toBe('vin_old');
    expect(v.createdAt).toBe(1000);
    expect(v.meta.artist).toBe('Alguien');
    expect(v.meta.year).toBe('');
    expect(v.disc.format).toBe('7');
    expect(v.disc.nativeRpm).toBe(33);
    expect(v.disc.condition.dust).toBeGreaterThanOrEqual(0);
    expect(v.disc.sides[0].tracks[0]!.title).toBe('Uno');
    expect(v.disc.sides[0].label.fields.artist).toBe('Alguien');
    expect(v.disc.sides[1].id).toBe('B');
    expect(v.jacket.front).toEqual(old.jacket.front);
    expect(v.jacket.back.kind).toBe('solid');
    expect(v.spine.text).toBe('Alguien — Algo');
    expect(v.outerSleeve.kind).toBe('pvc-clear');
  });

  it('conserva los campos anulables con valor (por defecto null): franja, anillo y última limpieza', () => {
    const v = presetRing({ artist: 'A', title: 'B' });
    v.spine.accentColor = '#d1302a';
    v.disc.sides[0].label.holeRingColor = '#123456';
    v.disc.condition.lastCleanedAt = 1793976051928;
    const n = normalizeVinyl(JSON.parse(JSON.stringify(v)));
    expect(n.spine.accentColor).toBe('#d1302a');
    expect(n.disc.sides[0].label.holeRingColor).toBe('#123456');
    expect(n.disc.condition.lastCleanedAt).toBe(1793976051928);
    expect(n).toEqual(v);
  });

  it('conserva null donde el usuario lo dejó', () => {
    const v = createVinyl();
    v.jacket.sticker = { text: 'Oferta', color: '#f00' };
    const n = normalizeVinyl({ ...v, jacket: { ...v.jacket, sticker: null } });
    expect(n.jacket.sticker).toBeNull();
  });

  it('un vinilo completo pasa intacto', () => {
    const v = presetNormal({ artist: 'A', title: 'B' }, [track('x', 10)]);
    expect(normalizeVinyl(JSON.parse(JSON.stringify(v)))).toEqual(v);
  });
});

describe('touch y sincronización de textos', () => {
  it('updatedAt es estrictamente creciente', () => {
    const v = createVinyl({ now: 500 });
    touch(v, 500);
    expect(v.updatedAt).toBe(501);
    touch(v, 900);
    expect(v.updatedAt).toBe(900);
  });

  it('propaga el título solo a los campos no personalizados', () => {
    const v = createVinyl({ meta: { artist: 'Dúo', title: 'Primero' } });
    const prev = { ...v.meta };
    v.disc.sides[1].label.fields.title = 'Personalizado';
    v.meta.title = 'Segundo';
    syncDerivedTexts(v, prev);
    expect(v.disc.sides[0].label.fields.title).toBe('Segundo');
    expect(v.disc.sides[1].label.fields.title).toBe('Personalizado');
    expect(v.spine.text).toBe(spineTextFor(v.meta));
  });
});

describe('applyPresetDecoration', () => {
  it('cambia la decoración y conserva pistas y metadatos', () => {
    const v = presetNormal({ artist: 'A', title: 'B' }, [track('a', 10)], [track('b', 10)]);
    applyPresetDecoration(v, 'ring');
    expect(v.disc.sides.every((s) => s.decoration === 'ring')).toBe(true);
    expect(v.disc.sides[1].tracks).toHaveLength(1);
    expect(v.meta.title).toBe('B');
    applyPresetDecoration(v, 'full');
    expect(v.disc.sides[0].decoration).toBe('full');
    expect(v.disc.sides[1].decorative).toBe(false);
    expect(v.disc.sides[1].tracks).toHaveLength(1);
    v.disc.sides[1].tracks = [];
    applyPresetDecoration(v, 'full');
    expect(v.disc.sides[1].decorative).toBe(true);
    applyPresetDecoration(v, 'normal');
    expect(v.disc.sides[1].decorative).toBe(false);
    expect(v.disc.material).toBe('black');
  });
});

describe('claves de blobs', () => {
  it('recoge imágenes y audio sin repetir y detecta huérfanos', () => {
    const a = createVinyl();
    a.jacket.front = { kind: 'image', image: { blobKey: 'img1' }, fit: 'cover', backdrop: '#000' };
    a.disc.sides[0].tracks = [track('x', 10, { blobKey: 'aud1', mimeType: 'audio/wav', fileName: 'x.wav' })];
    a.disc.sides[0].label.image = { blobKey: 'img1' };
    const b = createVinyl();
    b.jacket.back = { kind: 'image', image: { blobKey: 'img1' }, fit: 'contain', backdrop: '#fff' };
    expect(collectBlobKeys(a).sort()).toEqual(['aud1', 'img1']);
    expect(orphanBlobKeys(a, [a, b])).toEqual(['aud1']);
    expect(defaultMeta().artist).toBe('');
  });
});
