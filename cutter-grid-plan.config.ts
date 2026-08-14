import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Standalone config for the Cutter Grid trajectory fixture generator.
 *
 * Separate from the app's config so the generator never joins `npm test`: it
 * writes a file, which is not something a test run should do.
 *
 * It lives here rather than beside the generator because a Vite config resolves
 * its own imports from its own directory, and `hcr-backend/tools` has no
 * `node_modules`. Same arrangement as `vectors.config.ts`.
 *
 *   npm run cutter-grid:plan
 */
export default defineConfig({
  root: resolve(import.meta.dirname, '..'),
  test: {
    include: ['hcr-backend/tools/generate-cutter-grid-plan.ts'],
    environment: 'node',
    globals: true,
    // Planning searches a ladder of IK candidates; it is not a fast operation.
    testTimeout: 300_000,
  },
});
