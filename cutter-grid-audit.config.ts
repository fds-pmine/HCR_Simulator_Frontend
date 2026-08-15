import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: resolve(import.meta.dirname),
  test: {
    include: ['tools/generate-cutter-grid-audit.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 120_000,
  },
});
