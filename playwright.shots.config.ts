import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Screenshot rigs for the LaTeX decks. Deliberately a separate config: these
 * specs write PNGs into azusa-latex/static/, which `npm run test:e2e` must
 * never do. Run with:
 *
 *   npx playwright test --config playwright.shots.config.ts
 */
export default defineConfig({
  ...base,
  testDir: './tools/screenshots',
  testIgnore: undefined,
});
