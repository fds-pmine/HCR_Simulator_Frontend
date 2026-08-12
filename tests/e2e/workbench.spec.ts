import { expect, test, type Page } from '@playwright/test';
import { starterWorkspaceState } from '../../src/data/challenges/starterWorkspace';

const cutterGridRightWorkspaceState: Record<string, unknown> = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'hcr_cutter_grid_move_right',
        id: 'e2e-cutter-grid-right',
        x: 40,
        y: 40,
        fields: { DISTANCE: 2 },
      },
    ],
  },
};

const cutterGridBlockedWorkspaceState: Record<string, unknown> = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'hcr_cutter_grid_move_right',
        id: 'e2e-cutter-grid-blocked',
        x: 40,
        y: 40,
        fields: { DISTANCE: 4 },
      },
    ],
  },
};

/** `#rrggbb` as the `rgb(r, g, b)` string `toHaveCSS` compares against. */
function rgb(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${value >> 16}, ${(value >> 8) & 0xff}, ${value & 0xff})`;
}

/**
 * The clear colour `SimulatorCanvas` sets on the renderer.
 *
 * Duplicated from the component rather than imported: this spec briefly did
 * import it, and when the scene was retuned to a light palette and back the
 * export went away with it, which broke module resolution and took the whole
 * file down — zero tests ran, not one failure. A stale literal here fails one
 * assertion with a readable diff instead.
 */
const SCENE_BACKGROUND = '#0a141d';

test.describe('HCR Simulator workbench', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'HCR Simulator' }),
    ).toBeVisible();
    // The app opens on the mode menu. Solo Practice runs a session that always
    // opens on the authored challenge: with no responses there is nothing to
    // adapt to, so everybody starts on the same fixed item and its score seeds
    // the estimate.
    await page.getByRole('button', { name: /Solo Practice/ }).click();
    await expect(
      page.getByRole('heading', { name: 'Neat Short Haircut' }),
    ).toBeVisible();
    await expect(page.getByTestId('blockly-editor')).toBeVisible();
    await expect(page.getByTestId('simulator-canvas')).toBeVisible();
    await expect(page.getByTestId('simulator-canvas')).toHaveAttribute(
      'data-render-state',
      'ready',
    );
    await expect(page.getByTestId('current-voxel-count')).toHaveText(
      '241',
    );
    await expect(page.locator('.joint-row')).toHaveCount(5);
    await expect(page.locator('.joint-row strong')).toHaveText([
      'Base Yaw',
      'Shoulder Roll',
      'Shoulder',
      'Elbow',
      'Wrist',
    ]);
    // Every mode now opens blank — a prefilled workspace is a partial answer.
    // So each test builds the program it needs, the same way a learner does.
    await expect(page.locator('.blocklyBlockCanvas .blocklyDraggable')).toHaveCount(0);
  });

  /*
   * The four tests below drive a running program.
   *
   * No mode ships a starter workspace any more (`withBlankCanvas`), so they
   * seed one through the dev-only `__hcrSeedWorkspace` hook rather than
   * dragging blocks out of the flyout. What each asserts — the head-collision
   * stop, a reproducible score, pause/step/resume, stop-and-reset — is about
   * what happens *when a program runs*; how the blocks got onto the canvas is
   * incidental to all four.
   *
   * Authoring from the toolbox is therefore still uncovered, and it is now the
   * only way a learner builds anything. That gap is real and separate; seeding
   * here does not close it and is not meant to.
   */
  async function seedStarterProgram(page: Page): Promise<void> {
    await page.evaluate(
      (state) => {
        const seed = (
          window as unknown as {
            __hcrSeedWorkspace?: (s: Record<string, unknown>) => void;
          }
        ).__hcrSeedWorkspace;
        if (!seed) {
          throw new Error(
            '__hcrSeedWorkspace is missing — the editor must be mounted and the app served by `npm run dev`.',
          );
        }
        seed(state);
      },
      starterWorkspaceState,
    );
    await expect(
      page.locator('.blocklyBlockCanvas .blocklyDraggable'),
    ).toHaveCount(5);
  }

  test('blocks a head collision at the last safe pose without scoring', async ({
    page,
  }) => {
    await seedStarterProgram(page);
    // Servo degrees, as every angle in the UI now is. The geometric pose this
    // drives into the head is shoulder 50°, elbow −15°, wrist −30°,
    // baseYaw −24° — the same pose `createUnsafeHeadCollisionProgram` uses in
    // the unit suite. `shoulderRoll` has no servo, so its angle is unchanged.
    await setBlocklyNumberField(page, 'starter-shoulder-roll', 0);
    await setBlocklyNumberField(page, 'starter-shoulder', 100);
    await setBlocklyNumberField(page, 'starter-elbow', 137.5);
    await setBlocklyNumberField(page, 'starter-wrist', 60);
    await setBlocklyNumberField(page, 'starter-base-sweep', 66);

    await page.getByTestId('run-button').click();

    await expect(page.getByTestId('simulation-status')).toHaveText(
      'Error',
      { timeout: 15_000 },
    );
    await expect(page.getByRole('alert')).toContainText('baseYaw');
    await expect(page.getByRole('alert')).toContainText('contact the head');
    // The offending block is highlighted rather than named: its Blockly id is
    // an internal string a learner cannot act on.
    await expect(page.locator('.blocklyHighlighted')).toHaveCount(1);
    await expect(page.getByTestId('executed-command-count')).toHaveText(
      '4',
    );
    await expect(page.getByTestId('final-score')).toHaveCount(0);
    await expect(page.locator('.blocklyHighlighted')).toHaveCount(1);
    await expect(page.getByTestId('run-button')).toBeEnabled();

    await page.getByTestId('reset-button').click();
    await expect(page.getByTestId('simulation-status')).toHaveText('Idle');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('runs the starter program to a reproducible scored result', async ({
    page,
  }) => {
    await seedStarterProgram(page);
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));
    const blockCountBefore = await page
      .locator('.blocklyBlockCanvas .blocklyDraggable')
      .count();
    await page.getByTestId('run-button').click();

    await expect(page.getByTestId('simulation-status')).toHaveText(
      'Running',
    );
    await expect(page.getByTestId('simulator-canvas')).toHaveAttribute(
      'data-render-state',
      'ready',
    );
    await expect(
      page
        .getByTestId('simulator-canvas')
        .locator('canvas'),
    ).toHaveCSS('background-color', rgb(SCENE_BACKGROUND));
    await expect(
      page.getByText(
        'Editing is locked during positioning, planning, or execution',
      ),
    ).toBeVisible();
    // `toBeVisible` reports the notice as visible even when Blockly's toolbox
    // (z-index 70) paints over its first 24px, which rendered it as "ing is
    // locked while the program is running". Probe what is actually on top at
    // each end of the line, and check the overlay does not overflow its panel.
    const lockPaint = await page
      .locator('.blockly-editor__lock')
      .evaluate((element) => {
        const line = [...element.childNodes].find(
          (node) => node.nodeType === Node.TEXT_NODE,
        )!;
        const range = document.createRange();
        range.selectNode(line);
        const box = range.getBoundingClientRect();
        const midY = box.y + box.height / 2;
        const topAt = (x: number) =>
          element.contains(document.elementFromPoint(x, midY));
        return {
          coversStart: topAt(box.x + 2),
          coversEnd: topAt(box.right - 2),
          overflows: element.scrollWidth > element.clientWidth,
        };
      });
    expect(lockPaint.coversStart).toBe(true);
    expect(lockPaint.coversEnd).toBe(true);
    expect(lockPaint.overflows).toBe(false);
    await expect(page.locator('.blocklyHighlighted')).toHaveCount(1);
    await expect(page.getByTestId('simulation-status')).toHaveText(
      'Completed',
      { timeout: 15_000 },
    );
    await expect(page.getByTestId('current-voxel-count')).toHaveText(
      '230',
    );
    await expect(page.getByTestId('executed-command-count')).toHaveText(
      '5',
    );
    await expect(page.getByTestId('final-score')).toBeVisible();
    await expect(page.getByTestId('simulator-canvas')).toHaveAttribute(
      'data-render-state',
      'ready',
    );

    const completion = Number(
      await page.getByTestId('completion-score').textContent(),
    );
    expect(completion).toBeGreaterThanOrEqual(80);

    await page.getByTestId('reset-button').click();
    await expect(page.getByTestId('simulation-status')).toHaveText('Idle');
    await expect(page.getByTestId('current-voxel-count')).toHaveText(
      '241',
    );
    await expect(page.getByTestId('final-score')).toHaveCount(0);
    await expect(
      page.locator('.blocklyBlockCanvas .blocklyDraggable'),
    ).toHaveCount(blockCountBefore);
    expect(pageErrors).toEqual([]);
  });

  test('pauses, advances one command, resumes and records events', async ({
    page,
  }) => {
    await seedStarterProgram(page);
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('simulation-status')).toHaveText(
      'Running',
    );
    await page.getByTestId('pause-button').click();
    await expect(page.getByTestId('simulation-status')).toHaveText(
      'Paused',
    );

    const countBeforeStep = Number(
      await page.getByTestId('executed-command-count').textContent(),
    );
    await page.waitForTimeout(350);
    await expect(page.getByTestId('executed-command-count')).toHaveText(
      String(countBeforeStep),
    );

    await page.getByTestId('step-button').click();
    await expect(page.getByTestId('simulation-status')).toHaveText(
      'Paused',
      { timeout: 5_000 },
    );
    const countAfterStep = Number(
      await page.getByTestId('executed-command-count').textContent(),
    );
    expect(countAfterStep).toBe(countBeforeStep + 1);

    await page.getByTestId('resume-button').click();
    await expect(page.getByTestId('simulation-status')).toHaveText(
      'Completed',
      { timeout: 15_000 },
    );

    await page.getByTestId('log-toggle').click();
    await expect(page.getByTestId('event-log')).toContainText(
      'Score calculated',
    );
    await expect(page.getByTestId('event-log')).toContainText(
      'Program paused',
    );
    await expect(page.getByTestId('event-log')).toContainText('Removed');
  });

  test('stops without a formal score and preserves reset behavior', async ({
    page,
  }) => {
    await seedStarterProgram(page);
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('simulation-status')).toHaveText(
      'Running',
    );
    await page.getByTestId('stop-button').click();

    await expect(page.getByTestId('simulation-status')).toHaveText(
      'Stopped',
    );
    await expect(page.getByText(/no official score/)).toBeVisible();
    await expect(page.getByTestId('final-score')).toHaveCount(0);

    await page.getByTestId('reset-button').click();
    await expect(page.getByTestId('simulation-status')).toHaveText('Idle');
    await expect(page.getByTestId('current-voxel-count')).toHaveText(
      '241',
    );
  });

  test('toggles the target preview', async ({ page }) => {
    const toggle = page.getByRole('button', {
      name: /Target Hairstyle Preview/,
    });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  test('keeps Cutter Grid optional, isolated, local-only and stepwise', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const servoMode = page.getByRole('button', {
      name: 'Servo Angles',
      exact: true,
    });
    const cutterMode = page.getByRole('button', {
      name: 'Cutter Grid',
      exact: true,
    });
    await expect(servoMode).toHaveAttribute('aria-pressed', 'true');
    await expect(cutterMode).toBeVisible();

    await cutterMode.click();
    await expect(cutterMode).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Cutter Grid Program')).toBeVisible();
    await expect(page.getByTestId('simulation-status')).toHaveText('Idle', {
      timeout: 20_000,
    });
    const submit = page.getByTestId('submit-button');
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveAttribute(
      'title',
      'Backend replay not yet supported',
    );
    await expect(
      page.getByText(/Backend replay not yet supported\. Scoring stays/),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Grid and planned path/ }),
    ).toHaveAttribute('aria-pressed', 'true');

    await seedWorkspace(page, cutterGridRightWorkspaceState, 1);
    await servoMode.click();
    await expect(page.locator('.blocklyBlockCanvas .blocklyDraggable')).toHaveCount(0);
    await cutterMode.click();
    await expect(page.getByTestId('simulation-status')).toHaveText('Idle', {
      timeout: 20_000,
    });
    await expect(page.locator('.blocklyBlockCanvas .blocklyDraggable')).toHaveCount(1);

    await page.getByTestId('step-button').click();
    await expect(page.getByTestId('simulation-status')).toHaveText('Planning');
    await expect(page.getByTestId('blockly-editor')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(page.getByText(/Editing is locked during positioning/)).toBeVisible();
    await expect(servoMode).toBeDisabled();
    await expect(cutterMode).toBeDisabled();
    await expect(page.getByTestId('simulation-status')).toHaveText('Paused', {
      timeout: 120_000,
    });
    await expect(page.getByTestId('executed-command-count')).toHaveText('1');
    await expect(page.locator('.cutter-grid-summary')).toContainText('1/2');
    await expect(page.locator('.cutter-grid-summary')).toContainText('(1, 0, 0)');
    await expect(page.getByTestId('final-score')).toHaveCount(0);

    const trajectoryBeforeReset = await page
      .locator('.cutter-grid-summary')
      .locator('dd')
      .last()
      .textContent();
    await page.getByTestId('reset-button').click();
    await expect(page.getByTestId('simulation-status')).toHaveText('Idle', {
      timeout: 20_000,
    });
    await page.getByTestId('step-button').click();
    await expect(page.getByTestId('simulation-status')).toHaveText('Paused', {
      timeout: 20_000,
    });
    await expect(page.locator('.cutter-grid-summary').locator('dd').last()).toHaveText(
      trajectoryBeforeReset ?? '',
    );
  });

  test('fails an unreachable Cutter Grid command before execution and highlights it', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page
      .getByRole('button', { name: 'Cutter Grid', exact: true })
      .click();
    await expect(page.getByTestId('simulation-status')).toHaveText('Idle', {
      timeout: 20_000,
    });
    await seedWorkspace(page, cutterGridBlockedWorkspaceState, 1);
    await page.getByTestId('run-button').click();

    await expect(page.getByRole('alert')).toContainText('(4, 0, 0)', {
      timeout: 120_000,
    });
    await expect(page.getByRole('alert')).toContainText('blocked');
    await expect(page.locator('.blocklyHighlighted')).toHaveCount(1);
    await expect(page.getByTestId('executed-command-count')).toHaveText('0');
    await expect(page.getByTestId('final-score')).toHaveCount(0);
  });

  test('shows a local recovery state when WebGL context is lost', async ({
    page,
  }) => {
    const canLoseContext = await page
      .getByTestId('simulator-canvas')
      .locator('canvas')
      .evaluate((canvas: HTMLCanvasElement) => {
        const gl =
          canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        const extension = gl?.getExtension('WEBGL_lose_context');
        extension?.loseContext();
        return Boolean(extension);
      });

    test.skip(!canLoseContext, 'WEBGL_lose_context is unavailable');
    await expect(page.getByRole('alert')).toContainText(
      '3D Rendering Interrupted',
    );
    await page
      .getByRole('button', { name: 'Reinitialize 3D' })
      .click();
    await expect(page.getByTestId('simulator-canvas')).toHaveAttribute(
      'data-render-state',
      'ready',
    );
  });

  test('keeps the primary workspace controls visible at desktop sizes', async ({
    page,
  }) => {
    await expect(page.getByTestId('run-button')).toBeInViewport();
    await expect(page.getByTestId('reset-button')).toBeInViewport();
    await expect(page.getByTestId('blockly-editor')).toBeInViewport();
    await expect(page.locator('.side-panel--right')).toBeInViewport();
    await expectReadableFontSizes(page);

    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(page.getByTestId('run-button')).toBeInViewport();
    await expect(page.getByTestId('reset-button')).toBeInViewport();
    await expect(page.getByTestId('blockly-editor')).toBeInViewport();
    await expect(page.getByTestId('simulator-canvas')).toBeInViewport();
    await expect(page.locator('.side-panel--right')).toBeInViewport();
    await expectReadableFontSizes(page);
  });
});

async function expectReadableFontSizes(
  page: import('@playwright/test').Page,
): Promise<void> {
  const selectors = [
    '.panel-header span',
    '.panel-header strong',
    '.joint-row strong',
    '.metric-card span',
    '.control-button',
    '.blocklyToolboxCategoryLabel',
  ];

  for (const selector of selectors) {
    const fontSize = await page.locator(selector).first().evaluate(
      (element) =>
        Number.parseFloat(getComputedStyle(element).fontSize),
    );
    expect(fontSize, `${selector} font size`).toBeGreaterThanOrEqual(11);
  }
}

async function setBlocklyNumberField(
  page: import('@playwright/test').Page,
  blockId: string,
  value: number,
): Promise<void> {
  const field = page
    .locator(
      `.blocklyDraggable[data-id="${blockId}"] > .blocklyNumberField`,
    )
    .last();
  await field.click({ force: true });
  const input = page.locator('.blocklyHtmlInput');
  await expect(input).toBeVisible();
  await input.fill(String(value));
  await input.press('Enter');
}

async function seedWorkspace(
  page: Page,
  state: Record<string, unknown>,
  expectedBlockCount: number,
): Promise<void> {
  await page.evaluate((serialized) => {
    const seed = (
      window as unknown as {
        __hcrSeedWorkspace?: (s: Record<string, unknown>) => void;
      }
    ).__hcrSeedWorkspace;
    if (!seed) throw new Error('__hcrSeedWorkspace is not available.');
    seed(serialized);
  }, state);
  await expect(page.locator('.blocklyBlockCanvas .blocklyDraggable')).toHaveCount(
    expectedBlockCount,
  );
}
