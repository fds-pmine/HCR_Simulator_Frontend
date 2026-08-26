import { expect, test } from '@playwright/test';

const CERTIFIED_ROUTE = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'hcr_cutter_grid_move_left',
        id: 'tutorial-left',
        x: 40,
        y: 40,
        fields: { DISTANCE: 3 },
        next: {
          block: {
            type: 'hcr_cutter_grid_move_up',
            id: 'tutorial-up-seven',
            fields: { DISTANCE: 7 },
            next: {
              block: {
                type: 'hcr_cutter_grid_move_forward',
                id: 'tutorial-forward-three',
                fields: { DISTANCE: 3 },
                next: {
                  block: {
                    type: 'hcr_cutter_grid_move_up',
                    id: 'tutorial-up-three',
                    fields: { DISTANCE: 3 },
                    next: {
                      block: {
                        type: 'hcr_cutter_grid_move_forward',
                        id: 'tutorial-forward-six',
                        fields: { DISTANCE: 6 },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    ],
  },
};

const ONE_GRID_MOVE = {
  blocks: {
    languageVersion: 0,
    blocks: [{
      type: 'hcr_cutter_grid_move_left',
      id: 'bridge-grid-left',
      x: 40,
      y: 40,
      fields: { DISTANCE: 1 },
    }],
  },
};

const ONE_SERVO_ANGLE = {
  blocks: {
    languageVersion: 0,
    blocks: [{
      type: 'hcr_set_joint_angle',
      id: 'bridge-servo-base',
      x: 40,
      y: 40,
      fields: { JOINT_ID: 'baseYaw', ANGLE: 90 },
    }],
  },
};

const FIRST_ANGLE_SOLUTION = {
  blocks: {
    languageVersion: 0,
    blocks: [{
      type: 'hcr_set_joint_angle',
      id: 'angle-lesson-base',
      x: 40,
      y: 40,
      fields: { JOINT_ID: 'baseYaw', ANGLE: 135 },
    }],
  },
};

test('opens a dedicated Cutter Grid lesson without exposing Servo mode', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Lessons/ }).click();

  await expect(
    page.getByRole('heading', { name: 'Control the cutter in 3D space' }),
  ).toBeVisible();
  await expect(page.locator('.lesson-row--cutter-grid')).toHaveCount(10);
  await page
    .getByRole('button', { name: /Fixed World Axes/ })
    .click();

  await expect(page.getByText('Grid 1 · Fixed World Axes')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Why this matters' })).toBeVisible();
  await expect(page.getByText('Cutter Grid Program')).toBeVisible();
  await expect(page.getByTestId('blockly-editor')).toBeVisible();
  await expect(page.getByTestId('simulation-status')).toHaveText('Idle', {
    timeout: 20_000,
  });
  await expect(
    page.getByRole('button', { name: 'Servo Angles', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByTestId('submit-button')).toHaveCount(0);
  await expect(page.getByText('Lesson 1 / 10 · Section 1 / 20')).toBeVisible();
  await expect(page.getByTestId('next-grid-section')).toHaveText('Next section');
  await expect(page.getByTestId('previous-grid-section')).toHaveCount(0);

  for (let section = 1; section < 20; section += 1) {
    await page.getByTestId('next-grid-section').click();
  }
  await expect(page.getByText('Lesson 1 / 10 · Section 20 / 20')).toBeVisible();
  await expect(page.getByTestId('previous-grid-section')).toBeVisible();
  await expect(page.getByTestId('next-grid-lesson')).toHaveText('Next lesson');
});

test('opens the guided Cutter Grid tutorial before Servo control', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Tutorial/ }).click();

  await expect(
    page.getByRole('heading', { name: 'Choose how to control the arm' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Cutter Grid tutorial/ }).click();

  await expect(
    page.getByRole('heading', { name: 'Move the cutter, not the servos' }),
  ).toBeVisible();
  await expect(page.getByText('Cutter Grid Program')).toBeVisible();
  await expect(
    page.getByLabel('Tutorial', { exact: true }).getByText('CUTTER GRID', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Servo Angles', exact: true })).toHaveCount(0);

  const tutorial = page.getByLabel('Tutorial', { exact: true });
  const next = page.getByTestId('tutorial-next');
  await next.click();
  await page.evaluate((state) => {
    const seed = (
      window as unknown as {
        __hcrSeedWorkspace?: (serialized: Record<string, unknown>) => void;
      }
    ).__hcrSeedWorkspace;
    if (!seed) throw new Error('__hcrSeedWorkspace is not available.');
    seed(state);
  }, CERTIFIED_ROUTE);

  for (const heading of [
    'Place the first move',
    'Climb on a second axis',
    'Add depth',
  ]) {
    await expect(tutorial.getByRole('heading', { name: heading })).toBeVisible();
    await expect(tutorial.getByText('Done', { exact: true })).toBeVisible();
    await next.click();
  }
  await expect(
    tutorial.getByRole('heading', { name: 'Read the grid before you run' }),
  ).toBeVisible();
  await next.click();
  await expect(
    tutorial.getByRole('heading', { name: 'Finish the certified route' }),
  ).toBeVisible();
  await expect(tutorial.getByText('Done', { exact: true })).toBeVisible();
  await next.click();

  await expect(
    tutorial.getByRole('heading', { name: 'Plan and test the whole path' }),
  ).toBeVisible();
  await page.getByTestId('test-button').click();
  await expect(tutorial.getByText('Done', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
});

test('demonstrates the live transition from Grid intent to Servo angles', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Tutorial/ }).click();
  await page.getByRole('button', { name: /Grid → Servo Angles/ }).click();

  const tutorial = page.getByLabel('Tutorial', { exact: true });
  const next = page.getByTestId('tutorial-next');
  await expect(
    tutorial.getByRole('heading', { name: 'One arm, two levels of control' }),
  ).toBeVisible();
  await next.click();
  await seedWorkspace(page, ONE_GRID_MOVE);
  await expect(tutorial.getByText('Done', { exact: true })).toBeVisible();
  await next.click();
  await next.click();

  await page.getByRole('button', { name: 'Servo Angles', exact: true }).click();
  await expect(tutorial.getByText('Done', { exact: true })).toBeVisible();
  await next.click();
  await seedWorkspace(page, ONE_SERVO_ANGLE);
  await expect(tutorial.getByText('Done', { exact: true })).toBeVisible();
  await next.click();

  await expect(
    tutorial.getByRole('heading', { name: 'Home 90° is not the Challenge pose' }),
  ).toBeVisible();
  await expect(tutorial).toContainText('45°, 0°, 95°, 72.5°, and 125°');
  await next.click();
  await next.click();

  await page.getByRole('button', { name: 'Cutter Grid', exact: true }).click();
  await expect(tutorial.getByText('Done', { exact: true })).toBeVisible();
  await expect(page.locator('.blocklyBlockCanvas .blocklyDraggable')).toHaveCount(1);
  await next.click();
  await expect(
    tutorial.getByRole('heading', { name: 'Choose the right level for the job' }),
  ).toBeVisible();
});

test('keeps a Servo Angles lesson in twenty sections before its scored gate', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Lessons/ }).click();
  await page.getByRole('button', { name: /First Cut/ }).click();

  await expect(page.getByText('Servo Angles Program')).toBeVisible();
  await expect(page.getByText('Lesson 1 / 8 · Section 1 / 20')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Why this matters' })).toBeVisible();
  for (let section = 1; section < 20; section += 1) {
    await page.getByTestId('next-angle-section').click();
  }

  await expect(page.getByText('Lesson 1 / 8 · Section 20 / 20')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Scored checkpoint' })).toBeVisible();
  await expect(page.getByTestId('next-lesson')).toHaveCount(0);
  await seedWorkspace(page, FIRST_ANGLE_SOLUTION);
  await page.getByTestId('test-button').click();
  await expect(page.getByRole('heading', { name: 'Solved' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('next-lesson')).toHaveText('Next lesson');
});

async function seedWorkspace(
  page: import('@playwright/test').Page,
  state: Record<string, unknown>,
) {
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
