import './styles/base.css';
import { startApp } from './app/app';

const root = document.getElementById('app');
if (!root) throw new Error('No existe el contenedor #app');

startApp(root).catch((err: unknown) => {
  console.error(err);
  root.innerHTML = `<p style="padding:24px">No se pudo arrancar la aplicación: ${String(err)}</p>`;
});
