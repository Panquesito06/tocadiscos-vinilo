/**
 * Pestaña Disco: formato, velocidad nominal, material y colores, peso y
 * grosor, prensado y estado físico (polvo, desgaste, alabeo, rayas).
 */
import { defaultThicknessMm, maxRingWidthMm } from '../../core/geometry';
import { describeCondition } from '../../core/physics';
import type { DiscMaterial, Format, Rpm, Vinyl, WeightGrams } from '../../core/types';
import { button, fieldset, grid, note, row, type Child, type Option } from '../controls';
import type { EditorContext, EditorLocal } from '../context';
import { formatPercent, formatTimestamp } from '../format';

export const FORMAT_OPTIONS: readonly Option<Format>[] = [
  { value: '12', label: '12 pulgadas (LP)' },
  { value: '10', label: '10 pulgadas' },
  { value: '7', label: '7 pulgadas (single)' },
];

export const RPM_OPTIONS: readonly Option<Rpm>[] = [
  { value: 33, label: '33⅓ rpm' },
  { value: 45, label: '45 rpm' },
  { value: 78, label: '78 rpm' },
];

export const MATERIAL_OPTIONS: readonly Option<DiscMaterial>[] = [
  { value: 'black', label: 'Negro' },
  { value: 'color', label: 'De color' },
  { value: 'clear', label: 'Transparente' },
  { value: 'splatter', label: 'Salpicado' },
  { value: 'marble', label: 'Marmolado' },
];

export const WEIGHT_OPTIONS: readonly Option<WeightGrams>[] = [
  { value: 120, label: '120 g' },
  { value: 140, label: '140 g' },
  { value: 160, label: '160 g' },
  { value: 180, label: '180 g' },
  { value: 200, label: '200 g' },
];

export const THICKNESS_MIN_MM = 1;
export const THICKNESS_MAX_MM = 2.4;

/** Cambia el formato y acota la anchura del aro de ambas caras al nuevo máximo. */
export function setFormat(v: Vinyl, format: Format): void {
  v.disc.format = format;
  const max = maxRingWidthMm(format);
  for (const side of v.disc.sides) side.ring.widthMm = Math.min(side.ring.widthMm, max);
}

/** Cambia el peso; el grosor sigue al peso salvo que se haya editado a mano en esta sesión. */
export function setWeight(v: Vinyl, weight: WeightGrams, local: Pick<EditorLocal, 'thicknessTouched'>): void {
  v.disc.weightGrams = weight;
  if (!local.thicknessTouched) v.disc.thicknessMm = defaultThicknessMm(weight);
}

const usesColor = (m: DiscMaterial): boolean => m !== 'black';
const usesColor2 = (m: DiscMaterial): boolean => m === 'splatter' || m === 'marble';

export function buildDiscoTab(ctx: EditorContext): Child[] {
  return [formatSet(ctx), materialSet(ctx), weightSet(ctx), pressingSet(ctx), conditionSet(ctx)];
}

function formatSet(ctx: EditorContext): HTMLElement {
  return fieldset('Formato y velocidad', [
    grid([
      ctx.select('Formato', FORMAT_OPTIONS, (v) => v.disc.format, setFormat, { dataTest: 'editor-formato' }),
      ctx.select('Velocidad nominal', RPM_OPTIONS, (v) => v.disc.nativeRpm, (v, rpm) => {
        v.disc.nativeRpm = rpm;
      }),
    ]),
  ]);
}

function materialSet(ctx: EditorContext): HTMLElement {
  return fieldset('Material', [
    ctx.select('Material', MATERIAL_OPTIONS, (v) => v.disc.material, (v, m) => {
      v.disc.material = m;
    }),
    grid([
      ctx.showIf(
        ctx.color('Color del vinilo', (v) => v.disc.color, (v, c) => {
          v.disc.color = c;
        }),
        (v) => usesColor(v.disc.material),
      ),
      ctx.showIf(
        ctx.color('Segundo color', (v) => v.disc.color2, (v, c) => {
          v.disc.color2 = c;
        }),
        (v) => usesColor2(v.disc.material),
      ),
    ]),
    ctx.showIf(note('En un vinilo transparente el color es el tinte.'), (v) => v.disc.material === 'clear'),
  ]);
}

function weightSet(ctx: EditorContext): HTMLElement {
  const resetThickness = button('Grosor según el peso', () => {
    ctx.local.thicknessTouched = false;
    ctx.edit((v) => {
      v.disc.thicknessMm = defaultThicknessMm(v.disc.weightGrams);
    });
  });
  return fieldset('Peso y grosor', [
    grid([
      ctx.select('Peso', WEIGHT_OPTIONS, (v) => v.disc.weightGrams, (v, w) => setWeight(v, w, ctx.local), {
        dataTest: 'editor-peso',
      }),
      ctx.number(
        'Grosor (mm)',
        (v) => v.disc.thicknessMm,
        (v, t) => {
          ctx.local.thicknessTouched = true;
          v.disc.thicknessMm = t;
        },
        {
          min: THICKNESS_MIN_MM,
          max: THICKNESS_MAX_MM,
          step: 0.05,
          decimals: 2,
          dataTest: 'editor-grosor',
          hint: 'Entre 1,0 y 2,4 mm. Un disco grueso se alabea y se desgasta menos.',
        },
      ),
    ]),
    row([resetThickness]),
  ]);
}

function pressingSet(ctx: EditorContext): HTMLElement {
  return fieldset('Prensado', [
    ctx.range('Profundidad del surco', (v) => v.disc.grooveDepth, (v, x) => {
      v.disc.grooveDepth = x;
    }, { min: 0, max: 1, step: 0.01, format: formatPercent, hint: 'Surcos más marcados y algo más de fidelidad.' }),
    ctx.range('Calidad del prensado', (v) => v.disc.pressingQuality, (v, x) => {
      v.disc.pressingQuality = x;
    }, { min: 0, max: 1, step: 0.01, format: formatPercent, hint: 'Un prensado pobre suena con más ruido de fondo.' }),
  ]);
}

function conditionSet(ctx: EditorContext): HTMLElement {
  const percent = { min: 0, max: 1, step: 0.01, format: formatPercent };
  const clean = button(
    'Limpiar a fondo',
    () =>
      ctx.edit((v) => {
        v.disc.condition.dust = 0;
        v.disc.condition.lastCleanedAt = Date.now();
      }),
    { dataTest: 'editor-limpiar' },
  );
  return fieldset('Estado', [
    ctx.readout('Cómo está', (v) => describeCondition(v.disc.condition)),
    ctx.range('Polvo', (v) => v.disc.condition.dust, (v, x) => {
      v.disc.condition.dust = x;
    }, { ...percent, hint: 'Produce crepitar. Se quita con el cepillo.' }),
    ctx.range('Desgaste', (v) => v.disc.condition.wear, (v, x) => {
      v.disc.condition.wear = x;
    }, { ...percent, hint: 'Produce siseo. Sube con cada reproducción.' }),
    ctx.range('Alabeo', (v) => v.disc.condition.warp, (v, x) => {
      v.disc.condition.warp = x;
    }, { ...percent, hint: 'Produce bamboleo de la velocidad.' }),
    ctx.range('Rayas', (v) => v.disc.condition.scratches, (v, x) => {
      v.disc.condition.scratches = x;
    }, { ...percent, hint: 'Producen clics sueltos.' }),
    row([clean]),
    grid([
      ctx.readout('Reproducciones', (v) => String(v.disc.condition.plays)),
      ctx.readout('Última limpieza', (v) => formatTimestamp(v.disc.condition.lastCleanedAt)),
    ]),
  ]);
}
