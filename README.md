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

- El disco se comporta como un objeto físico: fuera de su funda coge polvo
  (más con la tapa abierta) y crepita; cada reproducción lo desgasta un
  poco; un disco fino y alabeado bambolea; un single de agujero grande sin
  centrador gira descentrado; y a otra velocidad cambia el tono. En
  "Ajustes" puedes acelerar la acumulación de polvo para notarlo antes.

Atajos de teclado:

- Espacio arranca y para el motor (cuando el foco no está en un control).
- Con el brazo enfocado (tecla Tab hasta él): ← y → lo mueven 2 mm, Av Pág
  y Re Pág 10 mm, ↑ y ↓ levantan y bajan la aguja. Desde el soporte, ←
  lleva el cabezal al principio del disco.
- En la estantería: Enter saca el vinilo, E abre el editor, ← y → cambian
  de lomo y Alt + ← / → lo reordenan.
- Esc cierra lo que esté abierto.

Notas:

- El sonido necesita `https` o `localhost` (el navegador no permite el
  motor de audio en otras direcciones `http`).
- La colección vive en este navegador. Si borras los datos del sitio, se
  pierde: todavía no hay exportación a archivo.

## Desarrollo

```bash
npm run typecheck   # tipos
npm test            # tests unitarios (Vitest)
npm run test:e2e    # recorrido completo en Chromium (Playwright)
```

El diseño, la arquitectura, el modelo físico y los contratos entre módulos
están descritos en `DESIGN.md`.
