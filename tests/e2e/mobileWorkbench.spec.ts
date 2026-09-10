import { expect, test, type Page } from '@playwright/test';

/**
 * The workbench on a phone.
 *
 * The desktop stage is a canvas with panels flying over it, and at 393px every
 * one of those layers landed on every other: the dock on the Blockly canvas,
 * the lesson card on the dock, the program panel nine pixels off the right
 * edge. None of that is visible to a test that asserts elements exist — each
 * one did exist, on top of the last — so this asserts geometry instead: what
 * is on screen, and what is not on top of what.
 *
 * A viewport, not a device preset: `devices['iPhone 14 Pro']` carries
 * `defaultBrowserType: 'webkit'`, and this suite is a Chromium project.
 */
test.use({
  viewport: { width: 393, height: 660 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
});

type Rect = { x: number; y: number; width: number; height: number };

/** The rect of `selector`, or null when it is not being painted at all. */
async function shownRect(page: Page, selector: string): Promise<Rect | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return null;
    const { x, y, width, height } = el.getBoundingClientRect();
    if (width === 0 && height === 0) return null;
    return { x, y, width, height };
  }, selector);
}

/** A rect both selectors are painted into, if the two of them share one. */
function intersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  // A shared edge is a shared edge, not an overlap. Panels sit flush against
  // each other in the column and rounding puts them a fraction over.
  return width > 1 && height > 1 ? { x, y, width, height } : null;
}

async function expectLaidOutInAColumn(page: Page, what: string) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');

  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(scrollWidth, `${what}: the page scrolls sideways`).toBeLessThanOrEqual(
    viewport.width,
  );

  const named: [string, Rect][] = [];
  for (const selector of [
    '.tutorial',
    '.side-panel--left',
    '.side-panel--right',
    '.control-dock',
    '.error-banner',
  ]) {
    const rect = await shownRect(page, selector);
    if (rect) named.push([selector, rect]);
  }

  for (const [selector, rect] of named) {
    expect(
      Math.round(rect.x),
      `${what}: ${selector} starts off the left edge`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      Math.round(rect.x + rect.width),
      `${what}: ${selector} runs off the right edge`,
    ).toBeLessThanOrEqual(viewport.width);
    expect(
      Math.round(rect.y + rect.height),
      `${what}: ${selector} runs off the bottom`,
    ).toBeLessThanOrEqual(viewport.height);
  }

  for (let i = 0; i < named.length; i += 1) {
    for (let j = i + 1; j < named.length; j += 1) {
      const shared = intersection(named[i][1], named[j][1]);
      expect(
        shared,
        `${what}: ${named[i][0]} is painted on top of ${named[j][0]}`,
      ).toBeNull();
    }
  }
}

test.describe('the workbench on a phone', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Lessons/ }).click();
    await page
      .getByRole('button', { name: /Fixed World Axes/ })
      .first()
      .click();
    await expect(
      page.getByRole('heading', { name: 'Why this matters' }),
    ).toBeVisible();
  });

  test('keeps the topbar to one row', async ({ page }) => {
    // The wordmark wrapping to three lines is what pushed 32px of brand out of
    // a 58px bar and over the stage, so the bar is measured against its
    // contents rather than against a number this test would have to guess.
    const bar = await shownRect(page, '.topbar');
    const brand = await shownRect(page, '.brand-lockup');
    const actions = await shownRect(page, '.topbar-actions');
    expect(bar).not.toBeNull();
    expect(brand).not.toBeNull();
    expect(actions).not.toBeNull();

    expect(brand!.y + brand!.height).toBeLessThanOrEqual(
      bar!.y + bar!.height + 1,
    );
    expect(actions!.x + actions!.width).toBeLessThanOrEqual(
      bar!.x + bar!.width + 1,
    );
    expect(intersection(brand!, actions!)).toBeNull();
  });

  test('opens on the scene, with the dock reachable', async ({ page }) => {
    expect(await shownRect(page, '.side-panel--left')).toBeNull();
    expect(await shownRect(page, '.side-panel--right')).toBeNull();

    const dock = await shownRect(page, '.control-dock');
    expect(dock).not.toBeNull();
    await expect(page.getByTestId('test-button')).toBeVisible();
    await expectLaidOutInAColumn(page, 'scene');
  });

  test('stacks the lesson card, the editor and the dock without overlap', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Expand program panel' }).click();
    await expect(page.getByTestId('blockly-editor')).toBeVisible();
    await expectLaidOutInAColumn(page, 'program');

    // Blockly needs a canvas, not just a header — the panel used to survive
    // this far and then be squeezed to its title bar.
    const editor = await shownRect(page, '.blockly-editor');
    expect(editor).not.toBeNull();
    expect(editor!.height).toBeGreaterThan(120);
  });

  test('gives the work-surface row to one panel at a time', async ({ page }) => {
    await page.getByRole('button', { name: 'Expand program panel' }).click();
    await expect(page.getByTestId('blockly-editor')).toBeVisible();

    await page.getByRole('button', { name: 'Expand status panel' }).click();
    await expect(page.getByTestId('simulation-status')).toBeVisible();
    expect(await shownRect(page, '.side-panel--left')).toBeNull();
    await expectLaidOutInAColumn(page, 'inspector');
  });

  test('gets out of the way of a run', async ({ page }) => {
    await page.getByRole('button', { name: 'Expand program panel' }).click();
    await expect(page.getByTestId('blockly-editor')).toBeVisible();

    // Run exists to be watched, and the program panel is standing where the
    // robot is.
    await page.getByTestId('run-button').click();
    await expect(page.locator('.side-panel--left')).toBeHidden();
  });
});
