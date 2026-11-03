import { defineConfig } from '@playwright/test';

// Los tests e2e usan el Chromium preinstalado (PLAYWRIGHT_BROWSERS_PATH).
// Se permite audio sin gesto de usuario para poder probar el motor de sonido.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
