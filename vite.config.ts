import { defineConfig } from 'vitest/config';

// `base: './'` hace que la build funcione servida desde cualquier carpeta
// (GitHub Pages, un servidor estático local, etc.).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'happy-dom',
    setupFiles: ['src/test/setup.ts'],
  },
});
