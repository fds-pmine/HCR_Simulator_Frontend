import { expect, test, type Page } from '@playwright/test';

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
        next: {
          block: {
            type: 'hcr_wait',
            id: 'e2e-cutter-grid-wait',
            fields: { DURATION: 100 },
          },
        },
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
    // The app opens on the mode menu. Offline, Solo Practice walks the lessons
    // in teaching order and then the authored challenge, so it opens on the
    // first lesson item — a fixed, reproducible starting point either way.
    await page.getByRole('button', { name: /Solo Practice/ }).click();
    await expect(
      page.getByRole('heading', { name: '1 · First Cut' }),
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
    await expect(page.locator('.servo-angle-cell')).toHaveCount(5);
    await expect(page.locator('.servo-angle-cell strong')).toHaveText([
      'X',
      'Y',
      'Z',
      'B',
      'E',
    ]);
    await expect(page.locator('.joint-row')).toHaveCount(1);
    await expect(page.locator('.joint-row strong')).toHaveText([
      'Shoulder Roll',
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
  /**
   * Seed an explicit Servo program.
   *
   * Practice opens the first lesson item now, whose shipped starter is a
   * single block, so these tests state the program they need instead of
   * editing fields on a starter whose shape is a product decision.
   */
  async function seedServoProgram(
    page: Page,
    blocks: readonly { id: string; jointId: string; angleDeg: number }[],
  ): Promise<void> {
    const state = {
      blocks: {
        languageVersion: 0,
        blocks: [blocks.reduceRight<Record<string, unknown> | undefined>(
          (next, block, index) => ({
            type: 'hcr_set_joint_angle',
            id: block.id,
            ...(index === 0 ? { x: 40, y: 40 } : {}),
            fields: { JOINT_ID: block.jointId, ANGLE: block.angleDeg },
            ...(next ? { next: { block: next } } : {}),
          }),
          undefined,
        )],
      },
    };
    await page.evaluate((serialized) => {
      const seed = (
        window as unknown as {
          __hcrSeedWorkspace?: (state: Record<string, unknown>) => void;
        }
      ).__hcrSeedWorkspace;
      if (!seed) {
        throw new Error(
          '__hcrSeedWorkspace is missing — the editor must be mounted and the app served by `npm run dev`.',
        );
      }
      seed(serialized);
    }, state);
    await expect(
      page.locator('.blocklyBlockCanvas .blocklyDraggable'),
    ).toHaveCount(blocks.length);
  }

  /**
   * Long enough to catch mid-flight.
   *
   * The lesson's own solution is a single 30° sweep that finishes in half a
   * second, which is too fast to pause, step or stop against.
   */
  const LONG_PROGRAM = [
    { id: 'long-base-out', jointId: 'baseYaw', angleDeg: 30 },
    { id: 'long-base-back', jointId: 'baseYaw', angleDeg: 150 },
    { id: 'long-shoulder', jointId: 'shoulder', angleDeg: 150 },
    { id: 'long-elbow', jointId: 'elbow', angleDeg: 17.5 },
  ];

  /** Rolling the shoulder to its limit drives the End Effector into the head. */
  const COLLIDING_PROGRAM = [
    { id: 'reckless-roll', jointId: 'shoulderRoll', angleDeg: -45 },
  ];

  test('blocks a head collision at the last safe pose without scoring', async ({
    page,
  }) => {
    await seedServoProgram(page, COLLIDING_PROGRAM);

    await page.getByTestId('run-button').click();

    await expect(page.getByTestId('simulation-status')).toHaveText(
      'Error',
      { timeout: 15_000 },
    );
    await expect(page.getByRole('alert')).toContainText('shoulderRoll');
    await expect(page.getByRole('alert')).toContainText('contact the head');
    // The offending block is highlighted rather than named: its Blockly id is
    // an internal string a learner cannot act on.
    await expect(page.locator('.blocklyHighlighted')).toHaveCount(1);
    await expect(page.getByTestId('executed-command-count')).toHaveText(
      '0',
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
    await seedServoProgram(page, LONG_PROGRAM);
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
    await expect(page.getByTestId('executed-command-count')).toHaveText(
      '4',
    );
    await expect(page.getByTestId('final-score')).toBeVisible();
    await expect(page.getByTestId('simulator-canvas')).toHaveAttribute(
      'data-render-state',
      'ready',
    );

    // This program sweeps well past the lesson's target, so it is scored, not
    // correct — what matters here is that a finished run produces a score.
    const completion = Number(
      await page.getByTestId('completion-score').textContent(),
    );
    expect(Number.isFinite(completion)).toBe(true);

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
    await seedServoProgram(page, LONG_PROGRAM);
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
    await seedServoProgram(page, LONG_PROGRAM);
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

  test('keeps Cutter Grid isolated, local-only and stepwise', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await expect(page.getByText('Servo Angles Program')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cutter Grid', exact: true })).toHaveCount(0);
    await openFirstCutterGridLesson(page);
    await expect(page.getByText('Cutter Grid Program')).toBeVisible();
    await expect(page.getByTestId('submit-button')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /Grid and planned path/ }),
    ).toHaveAttribute('aria-pressed', 'true');

    await seedWorkspace(page, cutterGridRightWorkspaceState, 2);
    await expect(page.locator('.blocklyBlockCanvas .blocklyDraggable')).toHaveCount(2);

    await page.getByTestId('step-button').click();
    await expect(page.getByTestId('simulation-status')).toHaveText('Planning');
    await expect(page.getByTestId('blockly-editor')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(page.getByText(/Editing is locked during positioning/)).toBeVisible();
    await expect(page.getByTestId('simulation-status')).toHaveText('Paused', {
      timeout: 120_000,
    });
    await expect(page.getByTestId('executed-command-count')).toHaveText('2');
    const cutterGridSummary = page.locator('.cutter-grid-inspector > .cutter-grid-summary');
    await expect(cutterGridSummary).toContainText('1/2');
    await expect(cutterGridSummary).toContainText('(2, 0, 0)');
    await expect(cutterGridSummary).toContainText('Connected for this program');
    await expect(cutterGridSummary).toContainText('Branch');
    await expect(cutterGridSummary).toContainText('Motion');
    await expect(cutterGridSummary).toContainText('synchronized PTP');
    await expect(cutterGridSummary).toContainText('Expected cuts');
    await expect(cutterGridSummary).toContainText('Speed');
    await expect(page.getByTestId('final-score')).toHaveCount(0);

    const trajectoryBeforeReset = await page
      .locator('.cutter-grid-inspector > .cutter-grid-summary')
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
    await expect(page.locator('.cutter-grid-inspector > .cutter-grid-summary').locator('dd').last()).toHaveText(
      trajectoryBeforeReset ?? '',
    );
  });

  test('fails an unreachable Cutter Grid command before execution and highlights it', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openFirstCutterGridLesson(page);
    await seedWorkspace(page, cutterGridBlockedWorkspaceState, 1);
    await page.getByTestId('run-button').click();

    await expect(page.getByRole('alert')).toContainText('(4, 0, 0)', {
      timeout: 120_000,
    });
    await expect(page.getByRole('alert')).toContainText(/exhausted|candidate|entry/i);
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
    // The overlay reports the run as paused and offers to rebuild the scene.
    const overlay = page.locator('.scene-status-overlay');
    await expect(overlay).toHaveAttribute('role', 'alert');
    await expect(overlay).toContainText('PROGRAM ERROR');
    await overlay.getByRole('button', { name: 'Reset' }).click();
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

async function openFirstCutterGridLesson(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Back to Menu' }).click();
  await page.getByRole('button', { name: /Lessons/ }).click();
  await page.getByRole('button', { name: /Fixed World Axes/ }).click();
  await expect(page.getByText('Cutter Grid Program')).toBeVisible();
  await expect(page.getByTestId('simulation-status')).toHaveText('Idle', {
    timeout: 20_000,
  });
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
