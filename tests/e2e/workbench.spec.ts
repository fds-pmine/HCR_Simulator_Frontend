import { expect, test } from '@playwright/test';

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
   * These four drive a program, which no mode ships any more.
   *
   * Solo and Versus used to open on a starter workspace and these tests edited
   * its fields. Removing it (a prefilled workspace is a partial answer, and on
   * generated items it is literally the reference solution minus its cutting
   * moves) left them with an empty canvas and nothing to run.
   *
   * The replacement is to build each program from the toolbox the way a learner
   * now must — which is also the only coverage of that path. It is not written
   * yet: dragging out of the flyout works, but `.blocklyBlockCanvas` matches the
   * flyout's own canvas as well as the workspace's, so block counts and
   * connection checks need a selector that distinguishes them, and the compiler
   * accepts exactly one top-level stack so every block has to land connected.
   *
   * Marked rather than deleted: this is a real coverage gap, not a decision that
   * these behaviours stopped mattering.
   */
  test.fixme('blocks a head collision at the last safe pose without scoring', async ({
    page,
  }) => {
    await setBlocklyNumberField(page, 'starter-shoulder-roll', 0);
    await setBlocklyNumberField(page, 'starter-shoulder', 50);
    await setBlocklyNumberField(page, 'starter-elbow', -15);
    await setBlocklyNumberField(page, 'starter-wrist', -30);
    await setBlocklyNumberField(page, 'starter-base-sweep', -24);

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

    /*
   * These four drive a program, which no mode ships any more.
   *
   * Solo and Versus used to open on a starter workspace and these tests edited
   * its fields. Removing it (a prefilled workspace is a partial answer, and on
   * generated items it is literally the reference solution minus its cutting
   * moves) left them with an empty canvas and nothing to run.
   *
   * The replacement is to build each program from the toolbox the way a learner
   * now must — which is also the only coverage of that path. It is not written
   * yet: dragging out of the flyout works, but `.blocklyBlockCanvas` matches the
   * flyout's own canvas as well as the workspace's, so block counts and
   * connection checks need a selector that distinguishes them, and the compiler
   * accepts exactly one top-level stack so every block has to land connected.
   *
   * Marked rather than deleted: this is a real coverage gap, not a decision that
   * these behaviours stopped mattering.
   */
  test.fixme('runs the starter program to a reproducible scored result', async ({
    page,
  }) => {
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
    ).toHaveCSS('background-color', 'rgb(10, 20, 29)');
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

    /*
   * These four drive a program, which no mode ships any more.
   *
   * Solo and Versus used to open on a starter workspace and these tests edited
   * its fields. Removing it (a prefilled workspace is a partial answer, and on
   * generated items it is literally the reference solution minus its cutting
   * moves) left them with an empty canvas and nothing to run.
   *
   * The replacement is to build each program from the toolbox the way a learner
   * now must — which is also the only coverage of that path. It is not written
   * yet: dragging out of the flyout works, but `.blocklyBlockCanvas` matches the
   * flyout's own canvas as well as the workspace's, so block counts and
   * connection checks need a selector that distinguishes them, and the compiler
   * accepts exactly one top-level stack so every block has to land connected.
   *
   * Marked rather than deleted: this is a real coverage gap, not a decision that
   * these behaviours stopped mattering.
   */
  test.fixme('pauses, advances one command, resumes and records events', async ({
    page,
  }) => {
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

    /*
   * These four drive a program, which no mode ships any more.
   *
   * Solo and Versus used to open on a starter workspace and these tests edited
   * its fields. Removing it (a prefilled workspace is a partial answer, and on
   * generated items it is literally the reference solution minus its cutting
   * moves) left them with an empty canvas and nothing to run.
   *
   * The replacement is to build each program from the toolbox the way a learner
   * now must — which is also the only coverage of that path. It is not written
   * yet: dragging out of the flyout works, but `.blocklyBlockCanvas` matches the
   * flyout's own canvas as well as the workspace's, so block counts and
   * connection checks need a selector that distinguishes them, and the compiler
   * accepts exactly one top-level stack so every block has to land connected.
   *
   * Marked rather than deleted: this is a real coverage gap, not a decision that
   * these behaviours stopped mattering.
   */
  test.fixme('stops without a formal score and preserves reset behavior', async ({
    page,
  }) => {
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
