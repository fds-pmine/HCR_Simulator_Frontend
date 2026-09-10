/*
 * Screenshot rig for COMP2S01_Lesson_Solutions.tex, kept OUT of tests/e2e so
 * `npm run test:e2e` never writes into the deck's static/ directory.
 *
 * Run it from the frontend package root; the output path is relative to it.
 *
 * Re-shoot (from HCR_Simulator_Frontend/):
 *   npx playwright test --config playwright.shots.config.ts
 *
 * Run it again after any retheme — the slide is a picture of the live UI, so a
 * changed palette silently makes the deck disagree with what students see.
 */
import { expect, test } from '@playwright/test';

// Shot at 2x so the inspector's fine print survives being scaled down onto a
// slide and printed. Same layout, four times the pixels.
test.use({ deviceScaleFactor: 2, viewport: { width: 1280, height: 720 } });

/**
 * Not a test — a screenshot rig for the solutions deck. Drives Grid 9 to its
 * checkpoint with a *passing* practical so the slide shows what "Blockly
 * practical passed" actually looks like next to the Grid inspector readout.
 */

const GRID_LESSON_IDS = [
  'cutter-grid-fixed-axes', 'cutter-grid-distance', 'cutter-grid-repeat',
  'cutter-grid-overcut', 'cutter-grid-blocked', 'cutter-grid-opposites',
  'cutter-grid-wait', 'cutter-grid-route-order', 'cutter-grid-compress',
  'cutter-grid-certified-cut',
];

/** Up 5 → Left 2: three cells fewer than the deck's example, equally correct. */
const COMPRESS_ANSWER = {
  blocks: {
    languageVersion: 0,
    blocks: [{
      type: 'hcr_cutter_grid_move_up',
      id: 'shot-up',
      x: 40,
      y: 40,
      fields: { DISTANCE: 5 },
      next: {
        block: {
          type: 'hcr_cutter_grid_move_left',
          id: 'shot-left',
          fields: { DISTANCE: 2 },
        },
      },
    }],
  },
};

test('shoots the Grid 9 checkpoint with a passed practical', async ({ page }) => {
  test.setTimeout(180_000);

  await page.addInitScript((ids: string[]) => {
    const lessons: Record<string, { sectionIndex: number; quizPassed: boolean }> = {};
    for (const id of ids) lessons[id] = { sectionIndex: 0, quizPassed: false };
    // Land straight on the checkpoint of the lesson being photographed.
    lessons['cutter-grid-compress'] = { sectionIndex: 19, quizPassed: true };
    localStorage.setItem(
      'hcr.lesson-progress.v1',
      JSON.stringify({ completed: ids, lessons }),
    );
  }, GRID_LESSON_IDS);

  await page.goto('/');
  await page.getByRole('button', { name: /Lessons/ }).click();
  await page.getByRole('button', { name: /Compact Programs/ }).click();

  await expect(page.getByText('Lesson 9 / 10 · Section 20')).toBeVisible();
  await expect(page.getByTestId('simulation-status')).toHaveText('Idle', {
    timeout: 30_000,
  });

  await page.evaluate((serialized) => {
    const seed = (
      window as unknown as {
        __hcrSeedWorkspace?: (workspace: Record<string, unknown>) => void;
      }
    ).__hcrSeedWorkspace;
    if (!seed) throw new Error('__hcrSeedWorkspace is not available.');
    seed(serialized);
  }, COMPRESS_ANSWER);

  await page.getByTestId('test-button').click();
  await expect(page.getByTestId('simulation-status')).toHaveText('Completed', {
    timeout: 90_000,
  });
  await expect(page.getByText('Blockly practical passed')).toBeVisible();

  await page.screenshot({
    path: '../azusa-latex/static/l3-grid-checkpoint.png',
    fullPage: false,
  });
});
