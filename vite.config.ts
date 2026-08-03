import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: true,
    // Setting `exclude` replaces vitest's defaults rather than adding to them,
    // so these have to be recursive. They were not: `node_modules/**` matches
    // only the top-level one, and the moment a nested checkout appeared — a git
    // worktree under `.claude/worktrees/` — the run swept its dependencies too
    // and went from 18 files to 223, most of them other people's tests.
    exclude: [
      'tests/e2e/**',
      '**/node_modules/**',
      '**/dist/**',
      '.claude/**',
    ],
  },
});
