import { expect, test, type Page } from '@playwright/test';
import { scalpReferenceWorkspaceState } from '../../src/data/challenges/scalpReferenceWorkspace';
import { starterWorkspaceState } from '../../src/data/challenges/starterWorkspace';

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

const invalidPathWorkspaceState: Record<string, unknown> = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        id: 'invalid-turn',
        type: 'hcr_scalp_turn',
        fields: { DIRECTION: 'left' },
        next: {
          block: {
            id: 'invalid-forward',
            type: 'hcr_scalp_move_forward',
            fields: { STEPS: 3 },
          },
        },
      },
    ],
  },
};

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
    await expect(page.getByTestId('programming-mode-servo')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByText('Servo', { exact: true })).toHaveCount(1);
    await expect(page.getByText('Path', { exact: true })).toHaveCount(0);
    await switchToScalpPath(page);
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
  async function seedReferencePath(page: Page): Promise<void> {
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
      scalpReferenceWorkspaceState,
    );
    await expect(
      page.locator('.blocklyBlockCanvas .blocklyDraggable'),
    ).toHaveCount(6);
  }

  test('keeps the legacy Servo language and workspace when Scalp Path is selected', async ({
    page,
  }) => {
    await page.getByTestId('programming-mode-servo').click();
    await expect(page.getByTestId('blockly-editor')).toHaveAttribute(
      'data-programming-mode',
      'servo',
    );
    await expect(page.getByText('Servo', { exact: true })).toHaveCount(1);

    await seedWorkspace(page, starterWorkspaceState);
    await expect(page.locator('.blocklyBlockCanvas .blocklyDraggable')).toHaveCount(5);

    await switchToScalpPath(page);
    await expect(page.locator('.blocklyBlockCanvas .blocklyDraggable')).toHaveCount(0);
    await expect(page.getByText('Servo', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Path', { exact: true })).toHaveCount(1);

    await page.getByTestId('programming-mode-servo').click();
    await expect(page.getByTestId('blockly-editor')).toHaveAttribute(
      'data-programming-mode',
      'servo',
    );
    await expect(page.locator('.blocklyBlockCanvas .blocklyDraggable')).toHaveCount(5);
  });

  test('authors a turtle path by dragging from the Path toolbox', async ({
    page,
  }) => {
    await page
      .locator('.blocklyToolboxCategory')
      .filter({ hasText: 'Path' })
      .click();
    const source = page.locator('.blocklyFlyout .blocklyDraggable').first();
    await expect(source).toBeVisible();
    const sourceBox = await source.boundingBox();
    const targetBox = await page
      .locator('.blockly-editor__surface')
      .boundingBox();
    if (!sourceBox || !targetBox) {
      throw new Error('Blockly drag geometry is unavailable.');
    }
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(targetBox.x + 220, targetBox.y + 150, {
      steps: 12,
    });
    await page.mouse.up();

    await expect.poll(async () =>
      page.locator('.blocklyDraggable').evaluateAll(
        (blocks) =>
          blocks.filter((block) => !block.closest('.blocklyFlyout')).length,
      ),
    ).toBe(1);
  });

  test('locates a path instruction that leaves the calibrated grid', async ({
    page,
  }) => {
    await page.evaluate((state) => {
      const seed = (
        window as unknown as {
          __hcrSeedWorkspace?: (value: Record<string, unknown>) => void;
        }
      ).__hcrSeedWorkspace;
      if (!seed) {
        throw new Error('The Blockly seed hook is missing.');
      }
      seed(state);
    }, invalidPathWorkspaceState);

    await page.getByTestId('run-button').click();

    await expect(page.getByTestId('simulation-status')).toHaveText('Idle');
    await expect(page.getByRole('alert')).toContainText('calibrated reachable grid');
    await expect(page.locator('.blocklyHighlighted')).toHaveCount(1);
    await expect(page.getByTestId('executed-command-count')).toHaveText('0');
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
    test.setTimeout(60_000);
    await seedReferencePath(page);
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));
    const blockCountBefore = await page
      .locator('.blocklyBlockCanvas .blocklyDraggable')
      .count();
    await page.getByTestId('run-button').click();

    await expect(page.getByTestId('simulation-status')).toHaveText(
      'Running',
    );
    await expect(page.getByTestId('programming-mode-servo')).toBeDisabled();
    await expect(page.getByTestId('programming-mode-scalp-path')).toBeDisabled();
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
      page.getByText('Editing is locked while the program is running'),
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
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('current-voxel-count')).toHaveText(
      '229',
    );
    await expect(page.getByTestId('executed-command-count')).toHaveText(
      '15',
    );
    await expect(page.getByTestId('final-score')).toBeVisible();
    await expect(page.getByTestId('simulator-canvas')).toHaveAttribute(
      'data-render-state',
      'ready',
    );

    const completion = Number(
      await page.getByTestId('completion-score').textContent(),
    );
    expect(completion).toBeGreaterThanOrEqual(90);

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
    test.setTimeout(60_000);
    await seedReferencePath(page);
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
      { timeout: 12_000 },
    );
    const countAfterStep = Number(
      await page.getByTestId('executed-command-count').textContent(),
    );
    expect(countAfterStep).toBeGreaterThan(countBeforeStep);

    await page.getByTestId('resume-button').click();
    await expect(page.getByTestId('simulation-status')).toHaveText(
      'Completed',
      { timeout: 30_000 },
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
    await seedReferencePath(page);
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

async function switchToScalpPath(page: Page): Promise<void> {
  await page.getByTestId('programming-mode-scalp-path').click();
  await expect(page.getByTestId('blockly-editor')).toHaveAttribute(
    'data-programming-mode',
    'scalp-path',
  );
  await expect(page.getByTestId('programming-mode-scalp-path')).toHaveAttribute(
    'aria-checked',
    'true',
  );
}

async function seedWorkspace(
  page: Page,
  state: Record<string, unknown>,
): Promise<void> {
  await page.evaluate((nextState) => {
    const seed = (
      window as unknown as {
        __hcrSeedWorkspace?: (value: Record<string, unknown>) => void;
      }
    ).__hcrSeedWorkspace;
    if (!seed) {
      throw new Error('The Blockly seed hook is missing.');
    }
    seed(nextState);
  }, state);
}

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
