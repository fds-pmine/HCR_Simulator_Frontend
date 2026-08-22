import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/** Standalone generator config; fixture writes never run as part of npm test. */
export default defineConfig({
  root: resolve(import.meta.dirname),
  test: {
    include: ['tools/generate-cutter-grid-motion-v3-fixture.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 300_000,
  },
});
