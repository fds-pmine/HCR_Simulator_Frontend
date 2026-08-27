import { expect, test, type Page } from '@playwright/test';

const SAMPLE_COUNT = 5;

const RIGHT_TWO_WORKSPACE = {
  blocks: {
    languageVersion: 0,
    blocks: [{
      type: 'hcr_cutter_grid_move_right',
      id: 'performance-right-two',
      x: 40,
      y: 40,
      fields: { DISTANCE: 2 },
    }],
  },
};

const GLOBAL_REGRESSION_WORKSPACE = {
  blocks: {
    languageVersion: 0,
    blocks: [{
      type: 'hcr_cutter_grid_move_up',
      id: 'performance-up-six',
      x: 40,
      y: 40,
      fields: { DISTANCE: 6 },
      next: {
        block: {
          type: 'hcr_cutter_grid_move_left',
          id: 'performance-left-two',
          fields: { DISTANCE: 2 },
          next: {
            block: {
              type: 'hcr_cutter_grid_move_forward',
              id: 'performance-forward-three',
              fields: { DISTANCE: 3 },
            },
          },
        },
      },
    }],
  },
};

test.describe('Cutter Grid V4 compact PTP Worker performance', () => {
  test('keeps cold Worker Right 2 planning P95 at or below 3 seconds', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const samples = await collectPlanningSamples(page, RIGHT_TWO_WORKSPACE);
    const p95 = percentile95(samples);

    await testInfo.attach('right-2-planning-ms.json', {
      body: JSON.stringify({ samples, p95 }),
      contentType: 'application/json',
    });
    console.info(`[V4 performance] Right 2 cold-Worker P95 ${p95.toFixed(1)}ms; samples ${samples.map((sample) => sample.toFixed(1)).join(', ')}ms`);
    expect(p95, `Right 2 cold-Worker samples: ${samples.join(', ')}ms`).toBeLessThanOrEqual(3_000);
  });

  test('keeps cold Worker global-regression planning P95 at or below 10 seconds', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const samples = await collectPlanningSamples(page, GLOBAL_REGRESSION_WORKSPACE);
    const p95 = percentile95(samples);

    await testInfo.attach('global-regression-planning-ms.json', {
      body: JSON.stringify({ samples, p95 }),
      contentType: 'application/json',
    });
    console.info(`[V4 performance] Global regression cold-Worker P95 ${p95.toFixed(1)}ms; samples ${samples.map((sample) => sample.toFixed(1)).join(', ')}ms`);
    expect(p95, `Global-regression cold-Worker samples: ${samples.join(', ')}ms`).toBeLessThanOrEqual(10_000);
  });
});

async function collectPlanningSamples(
  page: Page,
  workspace: Record<string, unknown>,
): Promise<number[]> {
  const samples: number[] = [];
  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    await openFirstCutterGridLesson(page);
    await seedWorkspace(page, workspace);
    const planningFinished = page.waitForFunction(
      () => {
        const status = document.querySelector('[data-testid="simulation-status"]')?.textContent;
        return status && status !== 'Idle' && status !== 'Planning' ? status : false;
      },
      undefined,
      { polling: 'raf', timeout: 15_000 },
    );
    const startedAt = await page.evaluate(() => performance.now());
    await page.getByTestId('step-button').click();
    const plannedStatus = await (await planningFinished).jsonValue();
    expect(plannedStatus).not.toBe('Error');
    expect(['Positioning', 'Running', 'Paused', 'Completed']).toContain(plannedStatus);
    samples.push(await page.evaluate((started) => performance.now() - started, startedAt));
  }
  return samples;
}

function percentile95(samples: readonly number[]): number {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1];
}

async function openFirstCutterGridLesson(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /Lessons/ }).click();
  await page.getByRole('button', { name: /Fixed World Axes/ }).click();
  await expect(page.getByTestId('blockly-editor')).toBeVisible();
  await expect(page.getByTestId('simulation-status')).toHaveText('Idle', { timeout: 20_000 });
}

async function seedWorkspace(page: Page, state: Record<string, unknown>): Promise<void> {
  await page.evaluate((serialized) => {
    const seed = (
      window as unknown as {
        __hcrSeedWorkspace?: (workspace: Record<string, unknown>) => void;
      }
    ).__hcrSeedWorkspace;
    if (!seed) throw new Error('__hcrSeedWorkspace is not available.');
    seed(serialized);
  }, state);
}
