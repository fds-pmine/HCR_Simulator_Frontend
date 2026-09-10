import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: resolve(import.meta.dirname),
  test: {
    include: ['tools/generate-lesson-grid-profiles.ts'],
    environment: 'node',
    globals: true,
    // Certification runs a static IK sweep per challenge; eight of them is
    // minutes, not seconds.
    testTimeout: 1_800_000,
  },
});
