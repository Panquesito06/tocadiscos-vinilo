# Tocadiscos — documento de diseño

Reproductor de música en forma de tocadiscos 2.5D, dentro de una habitación
en la que la colección de vinilos crece. Cada vinilo es un objeto físico con
todas sus partes editables: disco (dos caras, surcos, agujero central,
galleta), funda interior, carpeta, lomo y funda exterior.

Decisiones ya tomadas con el usuario:

| Pregunta | Decisión |
| --- | --- |
| Plataforma | App web en el navegador (Vite + TypeScript, sin framework de UI) |
| Música | Archivos locales (MP3, FLAC, WAV, OGG…), guardados en IndexedDB |
| Render | Escena 2.5D ilustrada con DOM, SVG, CSS y Canvas 2D (sin motor 3D) |
| Física | Simulada desde la v1: polvo → crepitar, limpieza con cepillo, disco fino → bamboleo, 45 rpm → cambio de tono |

## 1. Idioma y convenciones

- Toda la interfaz, los comentarios y la documentación están en **español**.
  Los identificadores de código están en inglés.
- Sin frameworks de UI. DOM directo, `pointer events`, `requestAnimationFrame`.
- Sin llamadas de red en tiempo de ejecución: la app funciona sin conexión.
  La tipografía (Archivo variable) va empaquetada con `@fontsource-variable/archivo`.
- Accesibilidad básica: botones reales, `aria-pressed`, foco visible, atajos
  de teclado, `prefers-reduced-motion` (los tokens ponen las duraciones a 0).
- Estilos: tokens en `src/styles/tokens.css`. Cada módulo de escena tiene su
  propio CSS importado desde su `.ts`.
- Texto de interfaz: frases cortas, verbo activo, sin mayúsculas sostenidas en
  etiquetas (salvo donde el objeto real las lleva: una galleta sí va en
  mayúsculas). Los errores dicen qué pasó y qué hacer.

## 2. Dirección visual

Tema: una sala de escucha de los años 70-80. Los colores salen de los
materiales reales (ver `tokens.css`): nogal del aparador y la estantería,
aluminio cepillado del plato, fieltro del tapete, kraft de las fundas, el rojo
EMI de la galleta de referencia, empapelado verde oscuro, tarima de madera.
La interfaz "de aplicación" (editor, ajustes) es carbón con texto kraft.

Una sola familia tipográfica, **Archivo variable**, usada con contraste de
anchura: condensada en galletas, lomos y listas de canciones; normal en la
interfaz; ancha y negra en los títulos. Nada de etiquetas en mayúsculas
tracked, ni puntos medios, ni flechas en los botones.

El objeto memorable es el tocadiscos: es lo único que recibe detalle máximo
(sombras, reflejos, marcas estroboscópicas, tornillería). Todo lo demás es
quieto y disciplinado. Movimiento solo como respuesta a una acción (sacar un
disco, abrir la tapa, bajar la aguja) o físico (el plato gira, el brazo se
mueve con la música).

Luz: cálida, desde arriba a la izquierda. Sombras hacia abajo-derecha
(`--sombra-objeto`). El brillo sobre el disco es fijo mientras el disco gira.

Referencias visuales del usuario (en el scratchpad de la sesión, no se
incluyen en el repo por derechos):

- `galleta-emi-queen.jpg`: galleta clásica de papel crema con el logotipo
  rojo de EMI a la izquierda, lista de canciones con duraciones y créditos,
  texto legal pequeño, número de catálogo grande abajo. Es el modelo del
  preset "normal" y de la pestaña Galleta.
- `disco-decorado-pintado.jpg`: disco pintado a mano a cara completa, con
  texto curvo arriba y abajo, dos figuras y un borde metálico remachado.
  Es el modelo del preset "enteramente decorado" (`decoration: 'full'` con
  `rim.rivets`).

Layout de escritorio (ancho ≥ 900 px):

```
┌────────────────────────────────────────────────────────────────┐
│ pared (tapiz)      Habitación        [Añadir vinilo] [Ajustes] │
│                                                                │
│   ┌───────────────────────────┐     ┌──┬──┬──┬──┬──┬──┬──┬──┐  │
│   │ tapa (abierta hacia atrás)│     │  │  │  │  │  │  │  │+ │  │
│   │  ┌─────────┐   brazo      │     ├──┴──┴──┴──┴──┴──┴──┴──┤  │
│   │  │  plato  │  ╱  cue      │     │ balda 2 (aparece al    │  │
│   │  │  disco  │ ╱   33 45 78 │     │ llenarse la 1)         │  │
│   │  └─────────┘  pitch ▮     │     └────────────────────────┘  │
│   │  ◉ start/stop   pantalla  │        cajas en el suelo        │
│   └───────────────────────────┘                                │
│  aparador de nogal                                             │
│ suelo (tarima)                                      [aviso]    │
└────────────────────────────────────────────────────────────────┘
```

En pantallas estrechas se apila: tocadiscos arriba, estantería debajo.
La vista "en la mano" se superpone centrada con la habitación oscurecida.
El editor es un cajón que entra por la derecha.

## 3. Arquitectura

```
src/
  core/        modelo de datos, geometría, física, inercia del plato, defaults, store (contrato)
  audio/       motor Web Audio + worklets, biblioteca de decodificación, importación, demo
  render/      dibujo en canvas: disco, carpeta, fundas, lomo; caché de imágenes y fachada
  scene/       tocadiscos, estantería, mano, habitación (DOM + CSS)
  editor/      cajón de edición con una pestaña por parte
  app/         arranque, bucle de animación, cableado de acciones, semilla de demo
public/worklets/  procesadores de AudioWorklet en JavaScript plano
```

Flujo de datos: un único `Store` (estado inmutable por copia + IndexedDB).
Las vistas reciben `AppState` en `update(state)` y emiten acciones por
callbacks; solo `app/` toca el store y el motor de audio. El bucle de
animación vive en `app/`.

Los contratos de cada módulo están escritos como comentarios en la cabecera
de cada archivo stub (`createStore`, `createAudioEngine`, `renderDiscFace`,
`createTurntableView`, …). **El contrato es la verdad**: los agentes de
implementación no cambian firmas exportadas; si una firma no basta, se añade
una exportación nueva sin romper las existentes.

### Propiedad de archivos (implementación en paralelo)

| Módulo | Archivos que posee | Importa de |
| --- | --- | --- |
| persistencia | `src/core/store.ts`, `src/core/store.test.ts`, `src/core/db.ts` | `core/types`, `core/defaults`, `idb` |
| audio | `src/audio/*`, `public/worklets/*`, `src/audio/*.test.ts` | `core/types`, `core/physics`, `core/geometry`, `core/store` (tipo `BlobStore`) |
| render-disco | `src/render/disc.ts`, `src/render/disc.test.ts`, `src/render/draw-utils.ts` | `core/*`, `render/images` |
| render-embalaje | `src/render/jacket.ts`, `src/render/sleeves.ts`, `src/render/text-layout.ts`, tests | `core/*`, `render/images` |
| escena-tocadiscos | `src/scene/turntable.ts`, `src/scene/turntable.css` | `core/types`, `core/geometry` |
| escena-habitación | `src/scene/room.ts`, `shelf.ts`, `hand.ts`, `room.css`, `shelf.css`, `hand.css` | `core/*`, `render/index` (tipo) |
| editor | `src/editor/*` | `core/*`, `render/index` (tipo) |
| app | `src/app/*`, `e2e/*` | todo |

`src/core/types.ts`, `geometry.ts`, `physics.ts`, `platter.ts`,
`defaults.ts`, `events.ts`, `ids.ts`, `render/images.ts` y `render/index.ts`
son compartidos y ya están implementados: se leen, no se editan (salvo
corrección de un error demostrable, que se comunica).

## 4. Modelo físico (resumen de `core/physics.ts` y `core/platter.ts`)

- Velocidad real = rpm del selector × (1 + pitch/100). Multiplicador de
  audio = rpm real / rpm nominal del disco. Tocar un 33 a 45 sube el tono
  ×1,35; un 45 a 33 lo baja. El worklet lee el buffer a esa velocidad con
  interpolación lineal (negativa = hacia atrás, scratch).
- El plato tiene inercia: arranque ≈ 1 s, frenada ≈ 2,5 s. La mano puede
  arrastrarlo (scratch) y el motor lo recupera al soltar.
- Polvo (0..1): se acumula con el disco fuera de su funda (más con la tapa
  abierta), y un poco en cada reproducción. Produce crepitar (impulsos
  aleatorios, 2 + 60·polvo por segundo a velocidad nominal). El cepillo
  quita entre 0,06 y 0,2 por pasada.
- Desgaste (0..1): sube ~0,006 por reproducción, la mitad en discos
  gruesos y pesados. Produce siseo. Irreversible.
- Alabeo (0..1): produce bamboleo de velocidad a la frecuencia de giro
  (33 rpm ≈ 0,55 Hz), amortiguado por el grosor y el peso. Visualmente el
  disco oscila unos píxeles.
- Agujero grande sin centrador: descentrado → bamboleo fuerte y aviso.
- Rayas (0..1): editables, no se generan solas. Clics esporádicos.
- Cara decorativa: sin surcos ni audio; la aguja no suena.

## 5. Geometría (resumen de `core/geometry.ts`)

Valores aproximados en mm: 12" radio 151, galleta 50, surco de 146 a 60;
10" radio 125, surco de 120 a 60; 7" radio 87,5, galleta 44, surco de 84 a
54. Agujero pequeño 7,24 mm, grande 38,1 mm. Paso de surco constante por
cara: el radio decrece linealmente con el tiempo. Entre canciones hay un
hueco de `trackGapSec` visible como banda más ancha.

## 6. Pruebas

- `npm run typecheck`, `npm test` (Vitest + happy-dom + fake-indexeddb),
  `npm run build`.
- Ganchos estables para pruebas (`data-test`), obligatorios en las vistas:
  - Habitación: `data-test="habitacion"`, `anadir-vinilo`, `ajustes`, `aviso`.
  - Estantería: cada lomo es `button[data-test="lomo"][data-vinyl-id]`;
    hueco: `data-test="hueco"`; caja: `data-test="caja"`.
  - Mano: `data-test="mano"`, botones `mano-girar`, `mano-abrir`,
    `mano-sacar-funda`, `mano-sacar-disco`, `mano-voltear`, `mano-limpiar`,
    `mano-poner-a`, `mano-poner-b`, `mano-editar`, `mano-guardar`; el disco
    visible: `mano-disco`.
  - Tocadiscos: `data-test="tt"`, `tt-disco` (contenedor que gira),
    `tt-cabezal` (asa de arrastre del brazo), `tt-brazo`, `tt-cue`, `tt-start`,
    `tt-33`, `tt-45`, `tt-78`, `tt-pitch`, `tt-volumen`, `tt-encendido`,
    `tt-tapa`, `tt-centrador`, `tt-quitar`, `tt-voltear`, `tt-cepillo`,
    `tt-pantalla`.
  - Editor: `data-test="editor"`, `editor-cerrar`, `editor-eliminar`,
    `editor-preset-normal|ring|full`, pestañas `editor-tab-<EditorTab>`,
    campos de cabecera `editor-artista`, `editor-titulo`; en Canciones,
    `editor-importar` (input file).
- Para e2e, `app.ts` expone `window.__tocadiscos` con
  `{ audioState(): string | null; positionSec(): number; state(): AppState }`.
- `npm run test:e2e` (Playwright con el Chromium preinstalado) recorre el
  flujo completo: arranca, siembra la demo, saca un disco, lo pone en el
  plato, baja la aguja, arranca el motor, comprueba que el AudioContext
  está `running` y que no hay errores de consola; abre el editor y cambia
  el título; recarga y comprueba que persiste.

## 7. Fuera de la v1 (dicho explícitamente)

- Spotify / YouTube / URL remotas.
- Exportar o importar la colección como archivo.
- Lectura de metadatos ID3 (se usa el nombre del archivo).
