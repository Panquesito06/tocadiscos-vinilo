import { describe, expect, it } from 'vitest';
import { createVinyl } from '../core/defaults';
import type { Fill, Vinyl } from '../core/types';
import { button, h } from './controls';
import { createLocal, EditorContext, editVinyl, releaseBlobs, SyncScope, type EditorSession } from './context';
import { createFakeRenderers, createFakeStore, stateWith } from './test-fakes';

const imageFill = (key: string): Fill => ({ kind: 'image', image: { blobKey: key }, fit: 'cover', backdrop: '#000000' });

function services(vinyls: Vinyl[]) {
  return { store: createFakeStore(stateWith(vinyls)), renderers: createFakeRenderers() };
}

describe('editVinyl', () => {
  it('aplica la mutación con touch y devuelve true', () => {
    const v = createVinyl({ now: 1000 });
    const s = services([v]);
    expect(editVinyl(s, v.id, (x) => (x.meta.genre = 'Rock'))).toBe(true);
    const after = s.store.getState().vinyls[0];
    expect(after?.meta.genre).toBe('Rock');
    expect(after?.updatedAt).toBeGreaterThan(1000);
  });

  it('no toca el store si el vinilo ya no existe', () => {
    const s = services([]);
    expect(editVinyl(s, 'vin_inexistente', () => undefined)).toBe(false);
    expect(s.store.updates).toBe(0);
  });

  it('borra y olvida los blobs que la edición deja sin usar, salvo los que usa otro vinilo', () => {
    const a = createVinyl({ jacket: { front: imageFill('propia'), back: imageFill('compartida') } });
    const b = createVinyl({ jacket: { front: imageFill('compartida') } });
    const s = services([a, b]);
    editVinyl(s, a.id, (x) => {
      x.jacket.front = { kind: 'solid', color: '#000000' };
      x.jacket.back = { kind: 'solid', color: '#ffffff' };
    });
    expect(s.store.deletedBlobs).toEqual(['propia']);
    expect(s.renderers.forgotten).toEqual(['propia']);
  });

  it('no borra una imagen que la misma edición sigue usando en otra parte', () => {
    const a = createVinyl({ jacket: { front: imageFill('k') } });
    const s = services([a]);
    editVinyl(s, a.id, (x) => {
      x.jacket.back = imageFill('k');
      x.jacket.front = { kind: 'solid', color: '#000000' };
    });
    expect(s.store.deletedBlobs).toEqual([]);
  });

  it('releaseBlobs solo libera las claves que nadie usa', () => {
    const a = createVinyl({ jacket: { front: imageFill('usada') } });
    const s = services([a]);
    expect(releaseBlobs(s, ['usada', 'libre', 'libre'])).toEqual(['libre']);
  });
});

describe('EditorContext.dynamic', () => {
  it('reconstruye solo cuando cambia la clave y devuelve el foco al elemento equivalente', () => {
    const v = createVinyl();
    const s = services([v]);
    const scope = new SyncScope();
    const session: EditorSession = { services: { ...s, importAudio: async () => ({ tracks: [], rejected: [] }) }, vinylId: v.id, local: createLocal(), resync: () => undefined };
    const ctx = new EditorContext(session, scope);
    let builds = 0;
    let key = 'a';
    const box = ctx.dynamic(
      () => key,
      () => {
        builds += 1;
        return [button('Subir', () => undefined, { focusKey: 'pista:subir' }), h('span', '', [String(builds)])];
      },
    );
    document.body.append(box);
    scope.run(v);
    scope.run(v);
    expect(builds).toBe(1);
    (box.querySelector('button') as HTMLButtonElement).focus();
    key = 'b';
    scope.run(v);
    expect(builds).toBe(2);
    expect(document.activeElement).toBe(box.querySelector('button'));
    document.body.replaceChildren();
  });
});
