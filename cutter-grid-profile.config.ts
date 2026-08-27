import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: resolve(import.meta.dirname),
  test: {
    include: ['tools/generate-cutter-grid-profile.ts'],
    environment: 'node',
    globals: true,
    // Certifying V1, V2 and V4 in one pass now includes the reachability
    // filter's static IK sweep, which alone costs minutes.
    testTimeout: 1_800_000,
  },
});
