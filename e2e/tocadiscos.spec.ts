/**
 * Recorrido completo de la aplicación en Chromium (Playwright).
 *
 * Solo se usan los ganchos `data-test` de DESIGN.md §6 y `window.__tocadiscos`
 * (src/app/global.d.ts). Cada prueba abre un contexto nuevo, con IndexedDB
 * vacío, así que la aplicación siembra la colección de demostración.
 */
import { expect, test, type Page } from '@playwright/test';

/** La siembra sintetiza 11 pistas con OfflineAudioContext: puede tardar. */
const SEED_TIMEOUT_MS = 30_000;
/** Radio del disco de 12" en mm (core/geometry). */
const DISC_12_RADIUS_MM = 151;
/** Radio objetivo de la aguja: 0,7 del radio, dentro de la zona de programa (63–143,5 mm). */
const TARGET_RADIUS_MM = 0.7 * DISC_12_RADIUS_MM;
const DRAG_STEPS = 80;

const lomos = (page: Page) => page.locator('button[data-test="lomo"]');
const byTest = (page: Page, name: string) => page.locator(`[data-test="${name}"]`);

/** Registra los errores de la página y de la consola para comprobar al final que no hubo ninguno. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  return errors;
}

/** Espera dos fotogramas de animación (la vista del tocadiscos se actualiza en cada uno). */
async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

async function positionSec(page: Page): Promise<number> {
  return page.evaluate(() => window.__tocadiscos?.positionSec() ?? Number.NaN);
}

/**
 * Arrastra el cabezal con el ratón hacia un punto sobre el disco (centro +
 * 0,7·radio hacia la izquierda, calculado desde la caja de `tt-disco`). El
 * brazo pivota y su radio depende solo del ángulo del puntero respecto al
 * pivote, así que el radio decrece de forma monótona a lo largo del
 * recorrido: se avanza en pasos y se suelta en cuanto `aria-valuenow` del
 * brazo (el radio en mm bajo la aguja) llega a 0,7·radio, en plena zona de
 * programa.
 */
async function dragArmOntoProgram(page: Page): Promise<number> {
  const disc = byTest(page, 'tt-disco');
  const discBox = await disc.boundingBox();
  const headBox = await byTest(page, 'tt-cabezal').boundingBox();
  if (!discBox || !headBox) throw new Error('No se ven el disco o el cabezal del brazo');
  // El contenedor gira: su caja crece con la rotación, pero el centro no cambia y el ancho de maqueta tampoco.
  const radiusPx = await disc.evaluate((el) => (el as HTMLElement).offsetWidth / 2);
  const center = { x: discBox.x + discBox.width / 2, y: discBox.y + discBox.height / 2 };
  const target = { x: center.x - 0.7 * radiusPx, y: center.y };
  const start = { x: headBox.x + headBox.width / 2, y: headBox.y + headBox.height / 2 };

  const arm = byTest(page, 'tt-brazo');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  let radius = Number.POSITIVE_INFINITY;
  for (let i = 1; i <= DRAG_STEPS && radius > TARGET_RADIUS_MM; i++) {
    const f = i / DRAG_STEPS;
    await page.mouse.move(start.x + (target.x - start.x) * f, start.y + (target.y - start.y) * f);
    await nextFrames(page);
    radius = Number(await arm.getAttribute('aria-valuenow'));
  }
  await page.mouse.up();
  return radius;
}

test('recorrido completo: sacar un disco, hacerlo sonar, editarlo y recargar', async ({ page }) => {
  // Siembra, audio, edición y recarga: más que el tiempo por defecto de una prueba.
  test.setTimeout(90_000);
  const errors = collectErrors(page);

  await page.goto('/');
  await expect(lomos(page)).toHaveCount(3, { timeout: SEED_TIMEOUT_MS });

  // Sacar el primer vinilo (12" a 33 rpm) y ponerlo en el plato por la cara A.
  await lomos(page).first().click();
  await expect(byTest(page, 'mano')).toBeVisible();
  await byTest(page, 'mano-sacar-disco').click();
  await byTest(page, 'mano-poner-a').click();
  await expect(byTest(page, 'mano')).toBeHidden();
  const disc = byTest(page, 'tt-disco');
  await expect(disc).toBeVisible();

  // Arrancar el motor: el disco gira.
  await byTest(page, 'tt-start').click();
  const transformOf = () => disc.evaluate((el) => getComputedStyle(el).transform);
  const before = await transformOf();
  await page.waitForTimeout(300);
  expect(await transformOf()).not.toBe(before);

  // Llevar el brazo a la zona de programa y bajar la aguja con la palanca.
  const radius = await dragArmOntoProgram(page);
  expect(radius).toBeLessThanOrEqual(TARGET_RADIUS_MM);
  expect(radius).toBeGreaterThan(63);
  await byTest(page, 'tt-cue').click();

  // El AudioContext está en marcha y la posición avanza.
  await expect(page.locator('html')).toHaveAttribute('data-audio', 'running', { timeout: 15_000 });
  const startSec = await positionSec(page);
  await page.waitForTimeout(2000);
  expect(await positionSec(page)).toBeGreaterThan(startSec + 1);

  // Quitar el disco: vuelve a la mano. Editar el título general.
  await byTest(page, 'tt-quitar').click();
  await expect(byTest(page, 'mano')).toBeVisible();
  await byTest(page, 'mano-editar').click();
  await expect(byTest(page, 'editor')).toBeVisible();
  await byTest(page, 'editor-titulo').fill('Título de prueba');
  await byTest(page, 'editor-cerrar').click();
  await page.evaluate(() => window.__tocadiscos?.flush());

  // Tras recargar, el lomo muestra el título nuevo.
  await page.reload();
  await expect(lomos(page)).toHaveCount(3, { timeout: SEED_TIMEOUT_MS });
  await expect(page.locator('button[data-test="lomo"][title*="Título de prueba"]')).toHaveCount(1);

  expect(errors).toEqual([]);
});

test('soltar un archivo de audio crea un vinilo nuevo y abre el editor', async ({ page }) => {
  const errors = collectErrors(page);

  await page.goto('/');
  await expect(lomos(page)).toHaveCount(3, { timeout: SEED_TIMEOUT_MS });

  await page.evaluate(() => {
    // WAV PCM de 16 bits, mono, 8 kHz y 1 s: un la de 440 Hz con la cabecera RIFF escrita a mano.
    const sampleRate = 8000;
    const frames = sampleRate;
    const bytes = new ArrayBuffer(44 + frames * 2);
    const view = new DataView(bytes);
    const ascii = (offset: number, text: string): void => {
      for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };
    ascii(0, 'RIFF');
    view.setUint32(4, 36 + frames * 2, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, 'data');
    view.setUint32(40, frames * 2, true);
    for (let i = 0; i < frames; i++) {
      view.setInt16(44 + i * 2, Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)), true);
    }

    const file = new File([bytes], 'prueba-de-sonido.wav', { type: 'audio/wav' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const room = document.querySelector('[data-test="habitacion"]');
    if (!room) throw new Error('No está la habitación');
    room.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    room.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  });

  await expect(lomos(page)).toHaveCount(4, { timeout: 15_000 });
  await expect(byTest(page, 'editor')).toBeVisible();

  expect(errors).toEqual([]);
});
