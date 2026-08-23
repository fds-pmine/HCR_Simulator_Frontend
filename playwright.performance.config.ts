import { defineConfig, devices } from '@playwright/test';

/**
 * Isolates V4 Worker P95 measurements from unrelated WebGL test contention.
 * Each sample reloads the application and creates a new planning Worker.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'cutterGridCompactPtpV4Performance.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
