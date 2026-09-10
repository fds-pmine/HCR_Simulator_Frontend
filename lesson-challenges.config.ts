import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: resolve(import.meta.dirname),
  test: {
    include: ['tools/generate-lesson-challenges.ts'],
    environment: 'node',
    globals: true,
    // Each target is derived by running the lesson's solution through the
    // engine, which is fast, but eight of them still beat the default timeout.
    testTimeout: 300_000,
  },
});
