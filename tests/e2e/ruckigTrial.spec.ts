import { expect, test, type Page } from '@playwright/test';

const localRuckigTrialEnabled = process.env.VITE_HCR_CUTTER_GRID_RUCKIG_TRIAL === '1';

const globalIkRegressionWorkspace: Record<string, unknown> = {
  blocks: {
    languageVersion: 0,
    blocks: [{
      type: 'hcr_cutter_grid_move_up',
      id: 'ruckig-regression-up',
      x: 40,
      y: 40,
      fields: { DISTANCE: 6 },
      next: {
        block: {
          type: 'hcr_cutter_grid_move_left',
          id: 'ruckig-regression-left',
          fields: { DISTANCE: 2 },
          next: {
            block: {
              type: 'hcr_cutter_grid_move_forward',
              id: 'ruckig-regression-forward',
              fields: { DISTANCE: 3 },
            },
          },
        },
      },
    }],
  },
};

test.describe('local Ruckig Cutter Grid trial', () => {
  test.skip(!localRuckigTrialEnabled, 'Set VITE_HCR_CUTTER_GRID_RUCKIG_TRIAL=1 to exercise the local WASM trial.');

  test('plans the global-IK regression program and reaches its first Step boundary', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto('/');
    await page.getByRole('button', { name: /Lessons/ }).click();
    await page.getByRole('button', { name: /Fixed World Axes/ }).click();
    await expect(page.getByTestId('blockly-editor')).toBeVisible();
    await expect(page.getByTestId('simulation-status')).toHaveText('Idle', { timeout: 20_000 });
    await seedWorkspace(page, globalIkRegressionWorkspace);

    await page.getByTestId('step-button').click();
    await expect(page.getByTestId('simulation-status')).toHaveText('Planning');
    await expect(page.getByTestId('simulation-status')).toHaveText('Paused', { timeout: 180_000 });
    await expect(page.getByTestId('executed-command-count')).toHaveText('1');
    await expect(page.locator('.cutter-grid-inspector > .cutter-grid-summary')).toContainText('(0, 1, 0)');
  });
});

async function seedWorkspace(page: Page, state: Record<string, unknown>): Promise<void> {
  await page.evaluate((serialized) => {
    const seed = (window as unknown as {
      __hcrSeedWorkspace?: (workspace: Record<string, unknown>) => void;
    }).__hcrSeedWorkspace;
    if (!seed) throw new Error('__hcrSeedWorkspace is not available.');
    seed(serialized);
  }, state);
  await expect(page.locator('.blocklyBlockCanvas .blocklyDraggable')).toHaveCount(3);
}
