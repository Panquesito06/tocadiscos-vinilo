import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Fill, ImageRef, TextStyle } from '../core/types';
import {
  checkboxField,
  durationField,
  fillEditor,
  imageField,
  numberField,
  rangeField,
  selectField,
  textField,
  textStyleEditor,
  toggleGroup,
} from './controls';
import { byLabel, choose, pickFiles, settle, typeInto } from './test-fakes';

afterEach(() => {
  document.body.replaceChildren();
});

function mount<E extends HTMLElement>(el: E): E {
  document.body.append(el);
  return el;
}

const refFor = (name: string): ImageRef => ({ blobKey: `k_${name}`, name, width: 10, height: 20 });

describe('controles simples', () => {
  it('textField guarda en vivo y no pisa el valor mientras tiene el foco', () => {
    const onChange = vi.fn();
    const c = textField({ label: 'Artista', onChange });
    mount(c.el);
    const input = byLabel(c.el, 'Artista');
    c.set('Queen');
    expect(input.value).toBe('Queen');
    input.focus();
    typeInto(input, 'Que');
    expect(onChange).toHaveBeenLastCalledWith('Que');
    c.set('Otro');
    expect(input.value).toBe('Que');
    input.blur();
    c.set('Otro');
    expect(input.value).toBe('Otro');
  });

  it('numberField solo guarda valores dentro del rango y acota al confirmar', () => {
    const onChange = vi.fn();
    const c = numberField({ label: 'Grosor', min: 1, max: 2.4, step: 0.05, decimals: 2, onChange });
    const input = byLabel(mount(c.el), 'Grosor');
    typeInto(input, '3');
    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    typeInto(input, '3', true);
    expect(onChange).toHaveBeenLastCalledWith(2.4);
    expect(input.value).toBe('2.40');
    typeInto(input, '1.234');
    expect(onChange).toHaveBeenLastCalledWith(1.23);
  });

  it('durationField lee m:ss y, al salir con algo inválido, vuelve al último valor', () => {
    const onChange = vi.fn();
    const c = durationField({ label: 'Duración', onChange });
    const input = byLabel(mount(c.el), 'Duración');
    c.set(185);
    expect(input.value).toBe('3:05');
    typeInto(input, '4:1');
    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    typeInto(input, '4:10');
    expect(onChange).toHaveBeenLastCalledWith(250);
    typeInto(input, 'xx', true);
    expect(input.value).toBe('4:10');
  });

  it('rangeField muestra la lectura y su máximo se puede cambiar', () => {
    const onChange = vi.fn();
    const c = rangeField({ label: 'Anchura', min: 4, max: 10, step: 0.5, format: (v) => `${v} mm`, onChange });
    const input = byLabel(mount(c.el), 'Anchura');
    c.set(8);
    expect(c.el.querySelector('output')?.textContent).toBe('8 mm');
    expect(input.getAttribute('aria-valuetext')).toBe('8 mm');
    c.setMax(9);
    expect(input.max).toBe('9');
    input.value = '6.5';
    input.dispatchEvent(new Event('input'));
    expect(onChange).toHaveBeenLastCalledWith(6.5);
    expect(c.el.querySelector('output')?.textContent).toBe('6.5 mm');
  });

  it('selectField devuelve el valor con su tipo original', () => {
    const onChange = vi.fn();
    const c = selectField<33 | 45>({
      label: 'Velocidad',
      options: [
        { value: 33, label: '33⅓' },
        { value: 45, label: '45' },
      ],
      onChange,
    });
    const select = byLabel<HTMLSelectElement>(mount(c.el), 'Velocidad');
    choose(select, '45');
    expect(onChange).toHaveBeenLastCalledWith(45);
  });

  it('checkboxField y toggleGroup', () => {
    const onChange = vi.fn();
    const box = checkboxField({ label: 'Mayúsculas', onChange });
    const input = byLabel(mount(box.el), 'Mayúsculas');
    box.set(true);
    expect(input.checked).toBe(true);
    const onSelect = vi.fn();
    const toggle = toggleGroup({
      label: 'Cara',
      options: [
        { value: 'A', label: 'Cara A' },
        { value: 'B', label: 'Cara B' },
      ],
      onSelect,
    });
    toggle.set('B');
    const buttons = toggle.el.querySelectorAll('button');
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('false');
    expect(buttons[1]?.getAttribute('aria-pressed')).toBe('true');
    buttons[0]?.click();
    expect(onSelect).toHaveBeenCalledWith('A');
  });
});

describe('fillEditor', () => {
  function setupFill(nullable: boolean, initial: Fill | null) {
    const changes: (Fill | null)[] = [];
    const upload = vi.fn(async (file: File) => refFor(file.name));
    const c = fillEditor({ legend: 'Portada', nullable, upload, onChange: (f) => changes.push(f) });
    mount(c.el);
    c.set(initial);
    const kind = (): HTMLSelectElement => byLabel<HTMLSelectElement>(c.el, 'Tipo de relleno');
    return { c, changes, upload, kind };
  }

  it('pasa de color liso a degradado conservando el color y vuelve recordando el degradado', () => {
    const { c, changes, kind } = setupFill(false, { kind: 'solid', color: '#112233' });
    expect(kind().value).toBe('solid');
    choose(kind(), 'gradient');
    expect(changes.at(-1)).toEqual({ kind: 'gradient', from: '#112233', to: '#1c1b19', angleDeg: 90, radial: false });
    c.set(changes.at(-1) ?? null);
    const angle = byLabel(c.el, 'Ángulo');
    angle.value = '45';
    angle.dispatchEvent(new Event('input'));
    expect(changes.at(-1)).toMatchObject({ kind: 'gradient', angleDeg: 45 });
    choose(kind(), 'solid');
    expect(changes.at(-1)).toEqual({ kind: 'solid', color: '#112233' });
    choose(kind(), 'gradient');
    expect(changes.at(-1)).toMatchObject({ angleDeg: 45 });
  });

  it('elegir "Imagen" no cambia el modelo hasta subir un archivo', async () => {
    const { c, changes, kind, upload } = setupFill(false, { kind: 'solid', color: '#445566' });
    choose(kind(), 'image');
    expect(changes).toHaveLength(0);
    expect(kind().value).toBe('image');
    // Una sincronización con el mismo modelo no deshace la elección pendiente.
    c.set({ kind: 'solid', color: '#445566' });
    expect(kind().value).toBe('image');
    const file = c.el.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
    expect(file.accept).toBe('image/*');
    pickFiles(file, [new File(['x'], 'portada.jpg', { type: 'image/jpeg' })]);
    await settle();
    expect(upload).toHaveBeenCalledOnce();
    expect(changes.at(-1)).toEqual({ kind: 'image', image: refFor('portada.jpg'), fit: 'cover', backdrop: '#445566' });
  });

  it('volver al tipo del modelo cancela la imagen pendiente sin emitir', () => {
    const { changes, kind } = setupFill(false, { kind: 'solid', color: '#445566' });
    choose(kind(), 'image');
    choose(kind(), 'solid');
    expect(changes).toHaveLength(0);
    expect(kind().value).toBe('solid');
  });

  it('"Quitar imagen" deja el color de fondo o, si se permite, ningún relleno', () => {
    const image: Fill = { kind: 'image', image: refFor('a.png'), fit: 'contain', backdrop: '#abcdef' };
    const solid = setupFill(false, image);
    (Array.from(solid.c.el.querySelectorAll('button')).find((b) => b.textContent === 'Quitar imagen') as HTMLButtonElement).click();
    expect(solid.changes.at(-1)).toEqual({ kind: 'solid', color: '#abcdef' });
    document.body.replaceChildren();
    const optional = setupFill(true, image);
    (Array.from(optional.c.el.querySelectorAll('button')).find((b) => b.textContent === 'Quitar imagen') as HTMLButtonElement).click();
    expect(optional.changes.at(-1)).toBeNull();
  });

  it('con relleno opcional ofrece "ninguno"', () => {
    const { changes, kind } = setupFill(true, null);
    expect(kind().value).toBe('none');
    choose(kind(), 'solid');
    expect(changes.at(-1)).toEqual({ kind: 'solid', color: '#f1e6cf' });
    choose(kind(), 'none');
    expect(changes.at(-1)).toBeNull();
  });
});

describe('textStyleEditor e imageField', () => {
  it('textStyleEditor emite el estilo completo con el cambio aplicado', () => {
    const onChange = vi.fn();
    const c = textStyleEditor({ legend: 'Estilo', onChange });
    mount(c.el);
    const style: TextStyle = { color: '#1c1b19', weight: 600, width: 'condensed', align: 'left', uppercase: true };
    c.set(style);
    choose(byLabel<HTMLSelectElement>(c.el, 'Anchura'), 'expanded');
    expect(onChange).toHaveBeenLastCalledWith({ ...style, width: 'expanded' });
    const weight = byLabel(c.el, 'Peso');
    weight.value = '900';
    weight.dispatchEvent(new Event('input'));
    expect(onChange).toHaveBeenLastCalledWith({ ...style, width: 'expanded', weight: 900 });
    expect(c.el.querySelector('output')?.textContent).toBe('900, negra');
  });

  it('imageField muestra nombre y medidas y permite quitar', async () => {
    const onChange = vi.fn();
    const c = imageField({ label: 'Imagen', upload: async (f) => refFor(f.name), onChange });
    mount(c.el);
    c.set(null);
    expect(c.el.textContent).toContain('Sin imagen');
    pickFiles(c.el.querySelector('input[type="file"]') as HTMLInputElement, [new File(['x'], 'logo.png', { type: 'image/png' })]);
    await settle();
    expect(onChange).toHaveBeenLastCalledWith(refFor('logo.png'));
    c.set(refFor('logo.png'));
    expect(c.el.textContent).toContain('logo.png, 10 × 20 px');
    (Array.from(c.el.querySelectorAll('button')).find((b) => b.textContent === 'Quitar imagen') as HTMLButtonElement).click();
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('imageField avisa si la subida falla', async () => {
    const onChange = vi.fn();
    const c = imageField({
      label: 'Imagen',
      upload: async () => {
        throw new Error('sin espacio');
      },
      onChange,
    });
    mount(c.el);
    pickFiles(c.el.querySelector('input[type="file"]') as HTMLInputElement, [new File(['x'], 'logo.png', { type: 'image/png' })]);
    await settle();
    expect(onChange).not.toHaveBeenCalled();
    expect(c.el.querySelector('[role="status"]')?.textContent).toContain('sin espacio');
  });
});
