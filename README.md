# Tocadiscos

Un reproductor de música en forma de tocadiscos, dentro de una habitación de
escucha en la que la colección de vinilos va creciendo. Cada vinilo es un
objeto completo y editable: disco (dos caras, surcos, agujero central y
galleta), funda interior, carpeta, lomo y funda exterior. La música sale de
tus propios archivos de audio y el disco se comporta como uno de verdad:
coge polvo y crepita, se limpia con el cepillo, bambolea si es fino y cambia
de tono si lo pones a otra velocidad.

Funciona en el navegador, sin conexión y sin enviar nada a ningún servidor:
la colección se guarda en el propio navegador (IndexedDB).

## Cómo arrancarlo

Necesitas Node.js 20 o superior.

```bash
npm install
npm run dev
```

Abre la dirección que imprime Vite (normalmente `http://localhost:5173`).

Para generar una versión estática lista para servir desde cualquier carpeta:

```bash
npm run build
npm run preview
```

## Cómo se usa

- La primera vez, la estantería trae tres vinilos de demostración con música
  sintetizada (sin derechos): uno normal, uno con el aro central decorado y
  uno enteramente decorado.
- Haz clic en un lomo para sacar el disco de la estantería. Puedes girar la
  carpeta, abrirla si es desplegable, sacar la funda interior, sacar el
  disco, darle la vuelta, limpiarlo y ponerlo en el plato por la cara A o B.
- En el tocadiscos: arrastra el cabezal del brazo hasta el surco que quieras,
  baja la palanca para apoyar la aguja y pulsa el botón de arranque. Puedes
  cambiar la velocidad (33, 45, 78), afinar con el deslizador de pitch,
  cerrar la tapa, poner el centrador para singles de agujero grande, frenar
  o arrastrar el disco con la mano (scratch) y pasarle el cepillo.
- Arrastra archivos de audio sobre la habitación para crear un vinilo nuevo
  con ellos, o pulsa "Añadir vinilo" y edítalo desde cero.
- En el editor hay una pestaña por cada parte del vinilo. Todo lo que cambies
  se ve al instante en la vista previa.

Atajos: espacio arranca y para el motor; ← y → mueven el brazo; ↑ y ↓
levantan y bajan la aguja; Esc cierra lo que esté abierto.

## Desarrollo

```bash
npm run typecheck   # tipos
npm test            # tests unitarios (Vitest)
npm run test:e2e    # recorrido completo en Chromium (Playwright)
```

El diseño, la arquitectura, el modelo físico y los contratos entre módulos
están descritos en `DESIGN.md`.
