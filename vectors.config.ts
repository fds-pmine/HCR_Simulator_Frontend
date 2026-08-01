import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Standalone config for the conformance vector generator.
 *
 * Separate from the app's config so the generator never joins `npm test`: it
 * writes a file, which is not something a test run should do.
 *
 * It lives here rather than beside the generator because a Vite config resolves
 * its own imports from its own directory, and `hcr-backend/tools` has no
 * `node_modules`.
 *
 *   npm run vectors
 */
export default defineConfig({
  root: resolve(import.meta.dirname, '..'),
  test: {
    include: ['hcr-backend/tools/generate-vectors.ts'],
    environment: 'node',
    globals: true,
    // No setupFiles: the app's setup pulls in jest-dom, which needs jsdom.
    testTimeout: 120_000,
  },
});
