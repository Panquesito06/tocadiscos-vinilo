/**
 * Controles con etiqueta del editor: texto, área de texto, número, rango con
 * lectura, color, selector, grupo de opciones, casilla, conmutador, imagen
 * (subir / quitar) y los dos editores compuestos que cubren todos los
 * rellenos (`fillEditor`) y estilos de texto (`textStyleEditor`).
 *
 * Los controles no conocen el modelo: reciben `onChange` y exponen
 * `set(valor)`, que refleja el valor del modelo SIN tocar el campo si tiene
 * el foco (así nunca se pisa lo que el usuario está escribiendo o
 * arrastrando). Todos son elementos nativos con su <label> asociada.
 */
import type { Fill, FontWidth, ImageRef, TextStyle } from '../core/types';
import { errorMessage, formatDuration, parseDuration, toHexColor } from './format';

export interface Control<T> {
  readonly el: HTMLElement;
  /** Refleja un valor del modelo (no toca el campo si el usuario lo está usando). */
  set(value: T): void;
}

export interface RangeControl extends Control<number> {
  /** Cambia el máximo del rango (p. ej. la anchura del aro según el formato). */
  setMax(max: number): void;
}

export interface Option<T> {
  value: T;
  label: string;
}

// ---------------------------------------------------------------------------
// Utilidades de DOM
// ---------------------------------------------------------------------------

export type Child = Node | string | null | undefined | false;

let idCounter = 0;

/** Identificador único para asociar etiquetas y campos. */
export function uniqueId(prefix = 'ed'): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** Crea un elemento con clase e hijos (se ignoran los hijos nulos o `false`). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  appendChildren(el, children);
  return el;
}

export function appendChildren(parent: Node & ParentNode, children: readonly Child[]): void {
  for (const c of children) if (c !== null && c !== undefined && c !== false) parent.append(c);
}

export interface ButtonOptions {
  className?: string;
  dataTest?: string;
  /** Clave estable para devolver el foco al botón si su lista se reconstruye. */
  focusKey?: string;
  title?: string;
  /** Nombre accesible más preciso que el texto visible ("Quitar la línea 2"). */
  ariaLabel?: string;
}

export function button(text: string, onClick: () => void, opts: ButtonOptions = {}): HTMLButtonElement {
  const b = h('button', opts.className ?? 'ed-btn', [text]);
  b.type = 'button';
  if (opts.dataTest) b.dataset.test = opts.dataTest;
  if (opts.focusKey) b.dataset.focusKey = opts.focusKey;
  if (opts.title) b.title = opts.title;
  if (opts.ariaLabel) b.setAttribute('aria-label', opts.ariaLabel);
  b.addEventListener('click', onClick);
  return b;
}

export function fieldset(legend: string, children: readonly Child[], className = ''): HTMLFieldSetElement {
  const fs = h('fieldset', className ? `ed-set ${className}` : 'ed-set', [h('legend', 'ed-legend', [legend])]);
  appendChildren(fs, children);
  return fs;
}

/** Rejilla de campos (dos columnas cuando hay sitio). */
export function grid(children: readonly Child[]): HTMLDivElement {
  return h('div', 'ed-grid', children);
}

/** Fila de botones o acciones. */
export function row(children: readonly Child[]): HTMLDivElement {
  return h('div', 'ed-row', children);
}

/** Párrafo de ayuda (`info`) o de aviso (`aviso`). */
export function note(text: string, kind: 'info' | 'aviso' = 'info'): HTMLParagraphElement {
  return h('p', kind === 'aviso' ? 'ed-note ed-note--aviso' : 'ed-note', [text]);
}

function isFocused(el: Element): boolean {
  return el.ownerDocument.activeElement === el;
}

/** Cambia el texto solo si es distinto (evita mutaciones del DOM en cada sincronización). */
export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** Envuelve un campo con su etiqueta visible (y una ayuda opcional enlazada con aria-describedby). */
function labelled(text: string, control: HTMLElement, hint?: string, extra?: Child): HTMLDivElement {
  const id = uniqueId();
  control.id = id;
  const label = h('label', 'ed-label', [text]);
  label.htmlFor = id;
  const head = extra ? h('div', 'ed-field__head', [label, extra]) : label;
  const wrap = h('div', 'ed-field', [head, control]);
  if (hint) {
    const p = h('p', 'ed-hint', [hint]);
    p.id = `${id}-ayuda`;
    control.setAttribute('aria-describedby', p.id);
    wrap.append(p);
  }
  return wrap;
}

function setTest(el: HTMLElement, dataTest: string | undefined): void {
  if (dataTest) el.dataset.test = dataTest;
}

// ---------------------------------------------------------------------------
// Controles simples
// ---------------------------------------------------------------------------

interface BaseOptions<T> {
  label: string;
  onChange(value: T): void;
  dataTest?: string;
  hint?: string;
}

export interface TextOptions extends BaseOptions<string> {
  placeholder?: string;
  maxLength?: number;
  inputMode?: 'text' | 'numeric' | 'decimal';
  /** Corrector ortográfico (desactivado en códigos como el catálogo). */
  spellcheck?: boolean;
}

function applyTextOptions(input: HTMLInputElement | HTMLTextAreaElement, o: TextOptions): void {
  if (o.placeholder) input.placeholder = o.placeholder;
  if (o.maxLength) input.maxLength = o.maxLength;
  if (o.inputMode) input.inputMode = o.inputMode;
  if (o.spellcheck === false) input.spellcheck = false;
  setTest(input, o.dataTest);
  // En vivo: cada pulsación se guarda (y se ve en la vista previa).
  input.addEventListener('input', () => o.onChange(input.value));
}

function textSetter(input: HTMLInputElement | HTMLTextAreaElement): (value: string) => void {
  return (value) => {
    if (!isFocused(input) && input.value !== value) input.value = value;
  };
}

export function textField(o: TextOptions): Control<string> {
  const input = h('input', 'ed-input');
  input.type = 'text';
  applyTextOptions(input, o);
  return { el: labelled(o.label, input, o.hint), set: textSetter(input) };
}

export function textAreaField(o: TextOptions & { rows?: number }): Control<string> {
  const area = h('textarea', 'ed-input ed-textarea');
  area.rows = o.rows ?? 3;
  applyTextOptions(area, o);
  return { el: labelled(o.label, area, o.hint), set: textSetter(area) };
}

export interface NumberOptions extends BaseOptions<number> {
  min: number;
  max: number;
  step: number;
  /** Decimales con los que se guarda y se muestra el valor. */
  decimals: number;
}

function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Campo numérico. Mientras se escribe solo se guardan valores válidos dentro
 * del rango; al confirmar (`change`) se acota al rango y se reescribe.
 */
export function numberField(o: NumberOptions): Control<number> {
  const input = h('input', 'ed-input ed-input--number');
  input.type = 'number';
  input.min = String(o.min);
  input.max = String(o.max);
  input.step = String(o.step);
  input.inputMode = 'decimal';
  setTest(input, o.dataTest);
  const read = (): number => Number.parseFloat(input.value.replace(',', '.'));
  input.addEventListener('input', () => {
    const n = read();
    const ok = Number.isFinite(n) && n >= o.min && n <= o.max;
    input.setAttribute('aria-invalid', String(!ok));
    if (ok) o.onChange(roundTo(n, o.decimals));
  });
  input.addEventListener('change', () => {
    const n = read();
    if (!Number.isFinite(n)) return;
    const v = roundTo(clampNumber(n, o.min, o.max), o.decimals);
    input.value = v.toFixed(o.decimals);
    input.setAttribute('aria-invalid', 'false');
    o.onChange(v);
  });
  return {
    el: labelled(o.label, input, o.hint),
    set(value) {
      if (isFocused(input)) return;
      const text = value.toFixed(o.decimals);
      if (input.value !== text) input.value = text;
      input.setAttribute('aria-invalid', 'false');
    },
  };
}

/**
 * Duración "m:ss". Se guarda en vivo cuando lo escrito es válido; al salir
 * del campo, lo inválido vuelve al último valor bueno. `readOnly` cuando la
 * duración la marca el archivo de audio.
 */
export function durationField(o: BaseOptions<number> & { readOnly?: boolean; readOnlyHint?: string }): Control<number> {
  const input = h('input', 'ed-input ed-input--duration');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.placeholder = 'm:ss';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.readOnly = !!o.readOnly;
  if (o.readOnly && o.readOnlyHint) input.title = o.readOnlyHint;
  setTest(input, o.dataTest);
  let last = 0;
  input.addEventListener('input', () => {
    const sec = parseDuration(input.value);
    input.setAttribute('aria-invalid', String(sec === null));
    if (sec !== null) {
      last = sec;
      o.onChange(sec);
    }
  });
  input.addEventListener('change', () => {
    const sec = parseDuration(input.value);
    input.value = formatDuration(sec ?? last);
    input.setAttribute('aria-invalid', 'false');
  });
  return {
    el: labelled(o.label, input, o.hint),
    set(sec) {
      last = sec;
      if (isFocused(input)) return;
      const text = formatDuration(sec);
      if (input.value !== text) input.value = text;
      input.setAttribute('aria-invalid', 'false');
    },
  };
}

export interface RangeOptions extends BaseOptions<number> {
  min: number;
  max: number;
  step: number;
  /** Texto de la lectura (también se usa como `aria-valuetext`). */
  format(value: number): string;
}

/** Deslizador con lectura del valor a la derecha de la etiqueta. */
export function rangeField(o: RangeOptions): RangeControl {
  const input = h('input', 'ed-range');
  input.type = 'range';
  input.min = String(o.min);
  input.max = String(o.max);
  input.step = String(o.step);
  setTest(input, o.dataTest);
  const out = h('output', 'ed-readout-inline');
  const show = (v: number): void => {
    const text = o.format(v);
    setText(out, text);
    if (input.getAttribute('aria-valuetext') !== text) input.setAttribute('aria-valuetext', text);
  };
  input.addEventListener('input', () => {
    const v = Number(input.value);
    show(v);
    o.onChange(v);
  });
  const el = labelled(o.label, input, o.hint, out);
  out.setAttribute('for', input.id);
  return {
    el,
    set(value) {
      if (isFocused(input)) return;
      if (Number(input.value) !== value) input.value = String(value);
      show(Number(input.value));
    },
    setMax(max) {
      if (input.max !== String(max)) input.max = String(max);
    },
  };
}

export function colorField(o: BaseOptions<string>): Control<string> {
  const input = h('input', 'ed-color');
  input.type = 'color';
  setTest(input, o.dataTest);
  input.addEventListener('input', () => o.onChange(input.value));
  return {
    el: labelled(o.label, input, o.hint),
    set(value) {
      if (isFocused(input)) return;
      const hex = toHexColor(value) ?? '#000000';
      if (input.value !== hex) input.value = hex;
    },
  };
}

export interface SelectOptions<T extends string | number> extends BaseOptions<T> {
  options: readonly Option<T>[];
}

export function selectField<T extends string | number>(o: SelectOptions<T>): Control<T> {
  const select = h('select', 'ed-input ed-select');
  setTest(select, o.dataTest);
  for (const opt of o.options) {
    const el = h('option', '', [opt.label]);
    el.value = String(opt.value);
    select.append(el);
  }
  select.addEventListener('change', () => {
    const found = o.options.find((opt) => String(opt.value) === select.value);
    if (found) o.onChange(found.value);
  });
  return {
    el: labelled(o.label, select, o.hint),
    set(value) {
      if (!isFocused(select) && select.value !== String(value)) select.value = String(value);
    },
  };
}

/** Grupo de botones de opción dentro de un fieldset con su legend. */
export function radioGroup<T extends string | number>(o: SelectOptions<T>): Control<T> {
  const name = uniqueId('ed-radio');
  const inputs = o.options.map((opt) => {
    const input = h('input', 'ed-radio');
    input.type = 'radio';
    input.name = name;
    input.value = String(opt.value);
    input.addEventListener('change', () => {
      if (input.checked) o.onChange(opt.value);
    });
    return input;
  });
  const labels = inputs.map((input, i) => h('label', 'ed-check', [input, ` ${o.options[i]?.label ?? ''}`]));
  const fs = fieldset(o.label, [h('div', 'ed-radios', labels), o.hint ? note(o.hint) : null]);
  setTest(fs, o.dataTest);
  return {
    el: fs,
    set(value) {
      for (const input of inputs) {
        if (isFocused(input)) continue;
        const checked = input.value === String(value);
        if (input.checked !== checked) input.checked = checked;
      }
    },
  };
}

export function checkboxField(o: BaseOptions<boolean>): Control<boolean> {
  const input = h('input', 'ed-checkbox');
  input.type = 'checkbox';
  setTest(input, o.dataTest);
  input.addEventListener('change', () => o.onChange(input.checked));
  const label = h('label', 'ed-check', [input, ` ${o.label}`]);
  let el: HTMLElement = label;
  if (o.hint) {
    const hint = h('p', 'ed-hint', [o.hint]);
    hint.id = uniqueId('ed-ayuda');
    input.setAttribute('aria-describedby', hint.id);
    el = h('div', 'ed-field', [label, hint]);
  }
  return {
    el,
    set(value) {
      if (!isFocused(input) && input.checked !== value) input.checked = value;
    },
  };
}

/**
 * Conmutador de botones con `aria-pressed` (p. ej. "Cara A / Cara B"). No
 * edita el vinilo: cambia una elección de la vista.
 */
export function toggleGroup<T extends string>(o: {
  label: string;
  options: readonly Option<T>[];
  onSelect(value: T): void;
  dataTest?: string;
}): Control<T> {
  const buttons = o.options.map((opt) =>
    button(opt.label, () => o.onSelect(opt.value), {
      className: 'ed-toggle__btn',
      ...(o.dataTest ? { dataTest: `${o.dataTest}-${opt.value}` } : {}),
    }),
  );
  const el = h('div', 'ed-toggle', buttons);
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', o.label);
  return {
    el,
    set(value) {
      buttons.forEach((b, i) => {
        const pressed = String(o.options[i]?.value === value);
        if (b.getAttribute('aria-pressed') !== pressed) b.setAttribute('aria-pressed', pressed);
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Imágenes
// ---------------------------------------------------------------------------

export type UploadImage = (file: File) => Promise<ImageRef>;

/** Nombre y medidas de una imagen guardada ("logo.png, 600 × 600 px"). */
export function describeImage(ref: ImageRef | null | undefined): string {
  if (!ref) return 'Sin imagen';
  const name = ref.name?.trim() || 'Imagen sin nombre';
  return ref.width && ref.height ? `${name}, ${ref.width} × ${ref.height} px` : name;
}

/** Botón "Elegir…" que es una <label> con un <input type=file> dentro (accesible con teclado). */
export function filePicker(o: {
  text: string;
  accept: string;
  multiple?: boolean;
  dataTest?: string;
  onFiles(files: File[]): void;
}): { el: HTMLLabelElement; input: HTMLInputElement; setText(text: string): void } {
  const input = h('input', 'visualmente-oculto ed-file__input');
  input.type = 'file';
  input.accept = o.accept;
  input.multiple = !!o.multiple;
  setTest(input, o.dataTest);
  const text = h('span', '', [o.text]);
  const el = h('label', 'ed-btn ed-file', [text, input]);
  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    // Vaciar permite volver a elegir el mismo archivo.
    input.value = '';
    if (files.length) o.onFiles(files);
  });
  return {
    el,
    input,
    setText(t) {
      setText(text, t);
    },
  };
}

/**
 * Sube una imagen mostrando el estado en `status`. Rechaza archivos que no
 * son imágenes. Devuelve null si no se pudo.
 */
export async function uploadWithStatus(file: File, status: HTMLElement, upload: UploadImage): Promise<ImageRef | null> {
  if (file.type && !file.type.startsWith('image/')) {
    status.textContent = `«${file.name}» no es una imagen. Elige un archivo PNG, JPEG, WebP o GIF.`;
    return null;
  }
  status.textContent = 'Guardando la imagen…';
  try {
    const ref = await upload(file);
    status.textContent = '';
    return ref;
  } catch (err) {
    status.textContent = `No se pudo guardar la imagen (${errorMessage(err)}). Prueba otra vez o con otro archivo.`;
    return null;
  }
}

function statusLine(): HTMLParagraphElement {
  const p = h('p', 'ed-status');
  p.setAttribute('role', 'status');
  return p;
}

/** Imagen opcional con subir / cambiar / quitar (galleta, aro). */
export function imageField(o: {
  label: string;
  upload: UploadImage;
  onChange(ref: ImageRef | null): void;
  dataTest?: string;
}): Control<ImageRef | null> {
  const name = h('p', 'ed-image__name');
  const status = statusLine();
  const picker = filePicker({
    text: 'Elegir imagen…',
    accept: 'image/*',
    ...(o.dataTest ? { dataTest: o.dataTest } : {}),
    onFiles: (files) => {
      const file = files[0];
      if (!file) return;
      void uploadWithStatus(file, status, o.upload).then((ref) => {
        if (ref) o.onChange(ref);
      });
    },
  });
  const remove = button('Quitar imagen', () => o.onChange(null));
  const group = h('div', 'ed-image', [h('span', 'ed-label', [o.label]), name, row([picker.el, remove]), status]);
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', o.label);
  return {
    el: group,
    set(ref) {
      setText(name, describeImage(ref));
      picker.setText(ref ? 'Cambiar imagen…' : 'Elegir imagen…');
      remove.hidden = !ref;
    },
  };
}

// ---------------------------------------------------------------------------
// FillEditor: sólido, degradado o imagen (y "ninguno" si se permite)
// ---------------------------------------------------------------------------

type FillChoice = 'none' | Fill['kind'];
type Gradient = Extract<Fill, { kind: 'gradient' }>;
type ImageFill = Extract<Fill, { kind: 'image' }>;

export interface FillEditorOptions {
  legend: string;
  onChange(fill: Fill | null): void;
  upload: UploadImage;
  /** Permite elegir "ninguno" (relleno null). */
  nullable?: boolean;
  /** Texto de la opción "ninguno". */
  noneLabel?: string;
  /** Color de partida al pasar de "ninguno" a color o degradado. */
  defaultColor?: string;
  dataTest?: string;
}

/** Recuerda los últimos valores de cada tipo para que cambiar de tipo y volver no los pierda. */
interface FillMemory {
  color: string;
  to: string;
  angleDeg: number;
  radial: boolean;
  fit: ImageFill['fit'];
  backdrop: string | null;
}

/** Color "base" de un relleno: el que se conserva al cambiar de tipo. */
export function baseColorOf(fill: Fill | null, fallback: string): string {
  if (!fill) return fallback;
  if (fill.kind === 'solid') return fill.color;
  if (fill.kind === 'gradient') return fill.from;
  return fill.backdrop;
}

export function fillEditor(o: FillEditorOptions): Control<Fill | null> {
  let current: Fill | null = null;
  /** Se eligió "Imagen" pero aún no hay archivo: el modelo no cambia hasta subirlo. */
  let pendingImage = false;
  let builtKind: FillChoice | null = null;
  let syncBody: () => void = () => undefined;
  const memory: FillMemory = {
    color: o.defaultColor ?? '#f1e6cf',
    to: '#1c1b19',
    angleDeg: 90,
    radial: false,
    fit: 'cover',
    backdrop: null,
  };

  const kinds: Option<FillChoice>[] = [
    ...(o.nullable ? [{ value: 'none' as const, label: o.noneLabel ?? 'Ninguno' }] : []),
    { value: 'solid', label: 'Color liso' },
    { value: 'gradient', label: 'Degradado' },
    { value: 'image', label: 'Imagen' },
  ];
  const kindSelect = selectField<FillChoice>({ label: 'Tipo de relleno', options: kinds, onChange: chooseKind });
  const body = h('div', 'ed-fill__body');
  const root = fieldset(o.legend, [kindSelect.el, body], 'ed-fill');
  setTest(root, o.dataTest);

  function remember(fill: Fill | null): void {
    if (!fill) return;
    if (fill.kind === 'solid') memory.color = fill.color;
    else if (fill.kind === 'gradient') {
      memory.color = fill.from;
      memory.to = fill.to;
      memory.angleDeg = fill.angleDeg;
      memory.radial = fill.radial;
    } else {
      memory.fit = fill.fit;
      memory.backdrop = fill.backdrop;
    }
  }

  /** Emitir un relleno resuelve siempre una elección de imagen pendiente. */
  function emit(next: Fill | null): void {
    current = next;
    pendingImage = false;
    remember(next);
    render();
    o.onChange(next);
  }

  function chooseKind(kind: FillChoice): void {
    if (kind === kindOf(current)) {
      if (pendingImage) {
        pendingImage = false;
        render();
      }
      return;
    }
    const base = baseColorOf(current, memory.color);
    if (kind === 'none') emit(null);
    else if (kind === 'solid') emit({ kind: 'solid', color: base });
    else if (kind === 'gradient') {
      emit({ kind: 'gradient', from: base, to: memory.to, angleDeg: memory.angleDeg, radial: memory.radial });
    } else if (current?.kind !== 'image') {
      pendingImage = true;
      render();
    }
  }

  function shownKind(): FillChoice {
    return pendingImage ? 'image' : kindOf(current);
  }

  function render(): void {
    const kind = shownKind();
    kindSelect.set(kind);
    if (kind !== builtKind) {
      builtKind = kind;
      syncBody = buildBody(kind);
    }
    syncBody();
  }

  function buildBody(kind: FillChoice): () => void {
    body.replaceChildren();
    if (kind === 'solid') return buildSolid();
    if (kind === 'gradient') return buildGradient();
    if (kind === 'image') return buildImage();
    body.append(note('Sin relleno propio.'));
    return () => undefined;
  }

  function buildSolid(): () => void {
    const color = colorField({
      label: 'Color',
      onChange: (c) => emit({ kind: 'solid', color: c }),
    });
    body.append(color.el);
    return () => {
      if (current?.kind === 'solid') color.set(current.color);
    };
  }

  function buildGradient(): () => void {
    const patch = (p: Partial<Gradient>): void => {
      if (current?.kind === 'gradient') emit({ ...current, ...p });
    };
    const from = colorField({ label: 'Color inicial', onChange: (c) => patch({ from: c }) });
    const to = colorField({ label: 'Color final', onChange: (c) => patch({ to: c }) });
    const angle = rangeField({
      label: 'Ángulo',
      min: 0,
      max: 360,
      step: 5,
      format: (v) => `${v}°`,
      onChange: (v) => patch({ angleDeg: v }),
    });
    const radial = checkboxField({ label: 'Radial (del centro hacia fuera)', onChange: (r) => patch({ radial: r }) });
    body.append(grid([from.el, to.el]), angle.el, radial.el);
    return () => {
      if (current?.kind !== 'gradient') return;
      from.set(current.from);
      to.set(current.to);
      angle.set(current.angleDeg);
      radial.set(current.radial);
      angle.el.hidden = current.radial;
    };
  }

  function buildImage(): () => void {
    const name = h('p', 'ed-image__name');
    const status = statusLine();
    const picker = filePicker({
      text: 'Elegir imagen…',
      accept: 'image/*',
      onFiles: (files) => {
        const file = files[0];
        if (!file) return;
        void uploadWithStatus(file, status, o.upload).then((ref) => {
          if (!ref) return;
          const backdrop = current?.kind === 'image' ? current.backdrop : (memory.backdrop ?? baseColorOf(current, memory.color));
          const fit = current?.kind === 'image' ? current.fit : memory.fit;
          emit({ kind: 'image', image: ref, fit, backdrop });
        });
      },
    });
    const fit = selectField<ImageFill['fit']>({
      label: 'Encaje',
      options: [
        { value: 'cover', label: 'Cubrir (recorta los bordes)' },
        { value: 'contain', label: 'Contener (imagen entera)' },
      ],
      onChange: (f) => {
        memory.fit = f;
        if (current?.kind === 'image') emit({ ...current, fit: f });
      },
    });
    const backdrop = colorField({
      label: 'Color de fondo',
      onChange: (c) => {
        memory.backdrop = c;
        if (current?.kind === 'image') emit({ ...current, backdrop: c });
      },
    });
    const remove = button('Quitar imagen', () => {
      const color = current?.kind === 'image' ? current.backdrop : baseColorOf(current, memory.color);
      emit(o.nullable ? null : { kind: 'solid', color });
    });
    body.append(name, row([picker.el, remove]), status, grid([fit.el, backdrop.el]));
    return () => {
      const img = current?.kind === 'image' ? current : null;
      setText(name, img ? describeImage(img.image) : 'Elige una imagen para usarla como relleno.');
      picker.setText(img ? 'Cambiar imagen…' : 'Elegir imagen…');
      remove.hidden = !img;
      fit.set(img ? img.fit : memory.fit);
      backdrop.set(img ? img.backdrop : (memory.backdrop ?? baseColorOf(current, memory.color)));
    };
  }

  return {
    el: root,
    set(value) {
      // Un cambio de tipo que viene de fuera (p. ej. un preset) cancela la elección pendiente.
      if (value?.kind === 'image' || kindOf(value) !== kindOf(current)) pendingImage = false;
      current = value;
      remember(value);
      render();
    },
  };
}

function kindOf(fill: Fill | null): FillChoice {
  return fill ? fill.kind : 'none';
}

// ---------------------------------------------------------------------------
// TextStyleEditor
// ---------------------------------------------------------------------------

const WEIGHT_NAMES: Record<number, string> = {
  100: 'fina',
  200: 'extraligera',
  300: 'ligera',
  400: 'normal',
  500: 'media',
  600: 'seminegrita',
  700: 'negrita',
  800: 'extranegrita',
  900: 'negra',
};

export function describeWeight(weight: number): string {
  const name = WEIGHT_NAMES[weight];
  return name ? `${weight}, ${name}` : String(weight);
}

export const FONT_WIDTH_OPTIONS: readonly Option<FontWidth>[] = [
  { value: 'condensed', label: 'Estrecha' },
  { value: 'normal', label: 'Normal' },
  { value: 'expanded', label: 'Ancha' },
];

export const ALIGN_OPTIONS: readonly Option<TextStyle['align']>[] = [
  { value: 'left', label: 'A la izquierda' },
  { value: 'center', label: 'Centrado' },
  { value: 'right', label: 'A la derecha' },
];

export function textStyleEditor(o: { legend: string; onChange(style: TextStyle): void; dataTest?: string }): Control<TextStyle> {
  let current: TextStyle | null = null;
  const patch = (p: Partial<TextStyle>): void => {
    if (!current) return;
    current = { ...current, ...p };
    o.onChange(current);
  };
  const color = colorField({ label: 'Color', onChange: (c) => patch({ color: c }) });
  const weight = rangeField({
    label: 'Peso',
    min: 100,
    max: 900,
    step: 100,
    format: describeWeight,
    onChange: (w) => patch({ weight: w }),
  });
  const width = selectField<FontWidth>({ label: 'Anchura', options: FONT_WIDTH_OPTIONS, onChange: (w) => patch({ width: w }) });
  const align = selectField<TextStyle['align']>({
    label: 'Alineación',
    options: ALIGN_OPTIONS,
    onChange: (a) => patch({ align: a }),
  });
  const upper = checkboxField({ label: 'Mayúsculas', onChange: (u) => patch({ uppercase: u }) });
  const root = fieldset(o.legend, [grid([color.el, weight.el, width.el, align.el]), upper.el], 'ed-style');
  setTest(root, o.dataTest);
  return {
    el: root,
    set(style) {
      current = style;
      color.set(style.color);
      weight.set(style.weight);
      width.set(style.width);
      align.set(style.align);
      upper.set(style.uppercase);
    },
  };
}
