import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: false,
    viewport: { width: 1280, height: 720 },
    video: 'retain-on-failure',
  },
  webServer: {
    // Build once, then serve a static preview for stability in E2E
    command: 'pnpm build && pnpm preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      VITE_E2E_TEST: 'true',
    },
  },
  reporter: [['list']],
});
