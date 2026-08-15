import { expect, test, type Page } from '@playwright/test';

const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
] as const;

const MOVE_TWO_CELLS = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'hcr_cutter_grid_move_right',
        id: 'visual-cutter-grid-right',
        x: 40,
        y: 40,
        fields: { DISTANCE: 2 },
      },
    ],
  },
};

for (const viewport of VIEWPORTS) {
  test(`Cutter Grid remains readable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    await openCutterGridPractice(page);
    await page.evaluate((state) => {
      const seed = (
        window as unknown as {
          __hcrSeedWorkspace?: (serialized: Record<string, unknown>) => void;
        }
      ).__hcrSeedWorkspace;
      if (!seed) throw new Error('__hcrSeedWorkspace is not available.');
      seed(state);
    }, MOVE_TWO_CELLS);
    await page.getByTestId('step-button').click();
    await expect(page.getByTestId('simulation-status')).toHaveText('Paused', {
      timeout: 30_000,
    });

    await expect(page.getByTestId('simulator-canvas')).toBeInViewport();
    await expect(page.getByTestId('blockly-editor')).toBeInViewport();
    await expect(page.locator('.side-panel--right')).toBeInViewport();
    await expect(page.getByTestId('run-button')).toBeInViewport();
    await expect(page.getByTestId('reset-button')).toBeInViewport();
    await expect(page.locator('.cutter-grid-summary')).toBeVisible();
    await expect(page.locator('.cutter-grid-summary')).toContainText('(1, 0, 0)');
    await expect(page.locator('.cutter-grid-summary')).toContainText('1/2');
    await expect(page.locator('.cutter-grid-summary')).toContainText('Connected for this program');
    await expect(page.getByText(/Backend replay not yet supported/)).toBeVisible();

    const overflow = await page.evaluate(() => ({
      horizontal:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
      vertical:
        document.documentElement.scrollHeight > document.documentElement.clientHeight,
    }));
    expect(overflow).toEqual({ horizontal: false, vertical: false });

    const screenshot = await page.screenshot({
      path: testInfo.outputPath(
        `${testInfo.project.name}-${viewport.width}x${viewport.height}.png`,
      ),
      fullPage: true,
    });
    await testInfo.attach('visual-acceptance', {
      body: screenshot,
      contentType: 'image/png',
    });
  });
}

async function openCutterGridPractice(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /Solo Practice/ }).click();
  await expect(page.getByTestId('blockly-editor')).toBeVisible();
  await page
    .getByRole('button', { name: 'Cutter Grid', exact: true })
    .click();
  await expect(page.getByTestId('simulation-status')).toHaveText('Idle', {
    timeout: 20_000,
  });
}
