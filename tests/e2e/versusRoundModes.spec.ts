import { expect, test, type Page } from '@playwright/test';

/**
 * The certified route the Grid tutorial teaches, as the Profile defines it —
 * the same nine moves `cutterGridLessons.spec.ts` seeds, and a real answer to
 * the round's challenge rather than a program that merely compiles.
 */
const CERTIFIED_ROUTE = gridProgram([
  ['left', 3],
  ['up', 6],
  ['up', 2],
  ['forward', 1],
  ['up', 1],
  ['forward', 1],
  ['up', 1],
  ['forward', 6],
  ['forward', 1],
]);

function gridProgram(
  moves: ReadonlyArray<readonly [string, number]>,
): Record<string, unknown> {
  const block = (index: number): Record<string, unknown> => {
    const [direction, distance] = moves[index];
    return {
      type: `hcr_cutter_grid_move_${direction}`,
      id: `route-${index}`,
      ...(index === 0 ? { x: 40, y: 40 } : {}),
      fields: { DISTANCE: distance },
      ...(index + 1 < moves.length ? { next: { block: block(index + 1) } } : {}),
    };
  };
  return { blocks: { languageVersion: 0, blocks: [block(0)] } };
}

async function seedWorkspace(page: Page, state: Record<string, unknown>) {
  await page.evaluate((serialized) => {
    const seed = (
      window as typeof window & {
        __hcrSeedWorkspace?: (workspace: Record<string, unknown>) => void;
      }
    ).__hcrSeedWorkspace;
    if (!seed) throw new Error('__hcrSeedWorkspace is not available.');
    seed(serialized);
  }, state);
}

/**
 * A round is single-mode, and the round is what chooses.
 *
 * Not "Versus is Servo-only" any more — an offline room can be opened in Cutter
 * Grid. What has to hold is that the round the host opened is the round every
 * player is in: one editor, no switch, no way to enter the other one's answer.
 */
test('plays a Servo round in Servo Angles, with no way to switch', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Versus/ }).click();
  await page.getByRole('button', { name: /Open Room/ }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
  await page.getByTestId('start-round').click();

  await expect(page.getByTestId('blockly-editor')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText('Servo Angles Program')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Cutter Grid', exact: true }),
  ).toHaveCount(0);
});

test('plays a Cutter Grid round in Cutter Grid, with no way back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Versus/ }).click();
  await page.getByTestId('round-mode-cutter-grid').click();
  await page.getByRole('button', { name: /Open Room/ }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
  await page.getByTestId('start-round').click();

  await expect(page.getByTestId('blockly-editor')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText('Cutter Grid Program')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Servo Angles', exact: true }),
  ).toHaveCount(0);
});

test('leaves the start to the host, and counts the room in together', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Versus/ }).click();
  await page.getByRole('button', { name: /Open Room/ }).click();

  // The room was opened here, so this is the machine that drives it.
  await expect(page.getByTestId('start-round')).toBeVisible();
  await expect(page.getByTestId('waiting-for-host')).toHaveCount(0);

  await page.getByTestId('start-round').click();
  // The editor is held back until the count-in reaches the moment the server
  // named, so twenty screens do not each start on their own poll.
  await expect(page.getByText('ROUND STARTING')).toBeVisible();
  await expect(page.getByTestId('blockly-editor')).toBeVisible({
    timeout: 20_000,
  });
});

test('accepts a Cutter Grid entry into the round', async ({ page }) => {
  // The point of a Cutter Grid round: a route can actually be entered. The
  // entry is the program *and* the motion planned from it, so submitting runs
  // the planner and then scores the frozen plan in this browser.
  await page.goto('/');
  await page.getByRole('button', { name: /Versus/ }).click();
  await page.getByTestId('round-mode-cutter-grid').click();
  // Pinned, because this test is about the entry rather than about the draw:
  // an unpinned room now picks a challenge at random, and `CERTIFIED_ROUTE`
  // answers this one. Choosing it here says so out loud instead of relying on
  // whatever the picker happens to deal.
  await page
    .getByLabel('Challenge for this round')
    .selectOption('neat-short-cap');
  await page.getByRole('button', { name: /Open Room/ }).click();
  await page.getByTestId('start-round').click();
  await expect(page.getByTestId('blockly-editor')).toBeVisible({
    timeout: 20_000,
  });

  await seedWorkspace(page, CERTIFIED_ROUTE);
  await page.getByRole('button', { name: 'Submit' }).click();

  await expect(page.getByText('Attempt locked in.', { exact: false })).toBeVisible({
    timeout: 60_000,
  });
});
