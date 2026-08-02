import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Standalone config for the reachability fixture generator.
 *
 * Separate from the app's config for the same reason as `vectors.config.ts`:
 * the generator writes a file, which is not something `npm test` should do, and
 * its sweep costs minutes rather than milliseconds.
 *
 *   npm run reachability
 */
export default defineConfig({
  root: resolve(import.meta.dirname),
  test: {
    include: ['tools/generate-reachability.ts'],
    environment: 'node',
    globals: true,
    // No setupFiles: the app's setup pulls in jest-dom, which needs jsdom.
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
  },
});
