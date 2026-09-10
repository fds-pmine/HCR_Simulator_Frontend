import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'visualAcceptance.spec.ts',
  fullyParallel: false,
  preserveOutput: 'always',
  reporter: 'list',
  use: {
    // Borrowed from the base config rather than restated: `use` is one
    // object, and this file's own version of it carried no `storageState` —
    // so it carried no research preference either, and every test in the
    // suite timed out on a consent dialog it had no way past.
    ...base.use,
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'off',
  },
  projects: [
    {
      name: 'chrome',
      use: { channel: 'chrome' },
    },
    {
      name: 'edge',
      use: { channel: 'msedge' },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
