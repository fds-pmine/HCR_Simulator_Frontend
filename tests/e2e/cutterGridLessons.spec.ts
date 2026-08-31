import { expect, test } from '@playwright/test';
import { LESSONS } from '../../src/data/challenges/lessons';
import { CUTTER_GRID_LESSONS } from '../../src/features/tutorial/cutterGridLessons';

/** The certified route the Grid tutorial teaches, as the Profile defines it. */
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
      id: 'bridge-servo-wrist',
      x: 40,
      y: 40,
      fields: { JOINT_ID: 'wrist', ANGLE: 105 },
    }],
  },
};

/** Every Grid lesson id, in course order — the Servo course's prerequisite. */
const CUTTER_GRID_LESSON_IDS = [
  'cutter-grid-fixed-axes',
  'cutter-grid-distance',
  'cutter-grid-repeat',
  'cutter-grid-overcut',
  'cutter-grid-blocked',
  'cutter-grid-opposites',
  'cutter-grid-wait',
  'cutter-grid-route-order',
  'cutter-grid-compress',
  'cutter-grid-certified-cut',
];

const FIRST_ANGLE_SOLUTION = {
  blocks: {
    languageVersion: 0,
    blocks: [{
      type: 'hcr_set_joint_angle',
      id: 'angle-lesson-base',
      x: 40,
      y: 40,
      fields: { JOINT_ID: 'baseYaw', ANGLE: 120 },
    }],
  },
};

test('opens a dedicated Cutter Grid lesson without exposing Servo mode', async ({
  page,
}) => {
  test.setTimeout(180_000);
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
  await expect(page.getByText('Lesson 1 / 10 · Section 1')).toBeVisible();
  await expect(page.getByTestId('next-grid-section')).toHaveText('Next section');
  await expect(page.getByTestId('previous-grid-section')).toHaveCount(0);

  // Build and observe sections no longer hand out a skip: the workspace has to
  // hold a program and Test has to have run before they release Next.
  await seedWorkspace(page, CERTIFIED_ROUTE);
  await page.getByTestId('test-button').click();
  await expect(page.getByTestId('simulation-status')).toHaveText('Completed', {
    timeout: 60_000,
  });

  for (let section = 1; section < 20; section += 1) {
    // Section 19 is the quiz, and it holds Next until it is answered.
    if (section === 19) {
      await answerQuiz(page, CUTTER_GRID_LESSONS[0].assessments.multipleChoice);
    }
    const next = page.getByTestId('next-grid-section');
    // Every observe and challenge section asks for work of its own. The Test
    // pressed above satisfies the section it was pressed on and no other:
    // a lesson-wide "has tested once" flag marked all seven of them done at
    // the first press. "Use Step" asks for the button it names.
    if (!(await next.isEnabled())) {
      await pressTheControlThisSectionTeaches(page);
      await expect(next).toBeEnabled({ timeout: 60_000 });
    }
    await next.click();
  }
  await expect(page.getByText('Lesson 1 / 10 · Section 20')).toBeVisible();
  await expect(page.getByTestId('previous-grid-section')).toBeVisible();

  // The quiz clears the workspace on purpose, so the checkpoint is answered
  // from an empty canvas — and the lesson only opens the next one once that
  // practical actually passes.
  await expect(page.getByTestId('next-grid-lesson')).toHaveCount(0);
  await seedWorkspace(page, CERTIFIED_ROUTE);
  await page.getByTestId('test-button').click();
  await expect(page.getByTestId('simulation-status')).toHaveText('Completed', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('next-grid-lesson')).toHaveText('Next lesson');

  // The next lesson starts from nothing. It used to inherit this lesson's
  // finished program and completed run, and several practicals ask for little
  // more than "a program that moves on two axes" — so finishing one lesson
  // used to hand every following one its practical for free.
  await page.getByTestId('next-grid-lesson').click();
  await expect(page.getByText('Lesson 2 / 10 · Section 1')).toBeVisible();
  await expect(page.locator('.blocklyBlockCanvas .blocklyDraggable')).toHaveCount(0);
  await expect(page.getByTestId('simulation-status')).toHaveText('Idle', {
    timeout: 20_000,
  });

  for (let section = 1; section < 20; section += 1) {
    const next = page.getByTestId('next-grid-section');
    if (!(await next.isEnabled())) break;
    await next.click();
  }
  await expect(page.getByRole('heading', { name: 'Build the example' })).toBeVisible();
  await expect(page.getByTestId('next-grid-lesson')).toHaveCount(0);
});

/*
 * The three course walkthroughs below need a budget, not the 30s default.
 *
 * Each boots the app, drives a WebGL canvas, and plays a scored run to
 * completion; on the one-worker CI runner with a software rasteriser they
 * measured 19–23s, which is under 1.5× of the default. A runner ~30% slower
 * than usual — an ordinary occurrence, and one that inflated every spec in
 * this suite by that much on 2026-08-31 — pushed the section walkthrough to
 * 31.2s and failed it three times over, retries included. Nothing about the
 * app changed; the budget was never sized for the work.
 */
test('opens the guided Cutter Grid tutorial before Servo control', async ({ page }) => {
  test.setTimeout(180_000);
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
    'Climb the rest in a second block',
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
  test.setTimeout(180_000);
  await page.goto('/');
  await page.getByRole('button', { name: /^Tutorial/ }).click();
  await page.getByRole('button', { name: /Grid → Servo Angles/ }).click();

  const tutorial = page.getByLabel('Tutorial', { exact: true });
  const next = page.getByTestId('tutorial-next');
  await expect(
    tutorial.getByRole('heading', { name: 'One arm, two levels of control' }),
  ).toBeVisible();
  await expect(page.getByLabel('SERVO ANGLES')).toContainText(
    'SERVO ANGLES',
  );
  for (const [axis, angle] of Object.entries({
    X: '90.0°',
    Y: '90.0°',
    Z: '90.0°',
    B: '90.0°',
    E: '90.0°',
  })) {
    await expect(page.getByTestId(`servo-angle-${axis}`)).toHaveText(angle);
  }
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
  await page.getByTestId('test-button').click();
  await expect(page.getByTestId('servo-angle-B')).toHaveText('105.0°', {
    timeout: 10_000,
  });
  await expect(page.getByTestId('simulation-status')).toHaveText('Completed');
  await page.getByTestId('reset-button').click();
  await expect(page.getByTestId('simulation-status')).toHaveText('Idle');
  await expect(page.getByTestId('servo-angle-B')).toHaveText('90.0°');
  await next.click();

  await expect(
    tutorial.getByRole('heading', { name: 'Home is 90°; telemetry is live' }),
  ).toBeVisible();
  await expect(tutorial).toContainText('initializes to the firmware Home value of 90°');
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
  test.setTimeout(180_000);
  // Servo lessons unlock behind the whole Grid course, so this seeds the
  // prerequisite rather than playing ten lessons to reach the one under test.
  await page.addInitScript((completed: string[]) => {
    window.localStorage.setItem(
      'hcr.lesson-progress.v1',
      JSON.stringify({ completed, lessons: {} }),
    );
  }, CUTTER_GRID_LESSON_IDS);
  await page.goto('/');
  await page.getByRole('button', { name: /Lessons/ }).click();
  await page.getByRole('button', { name: /First Cut/ }).click();

  await expect(page.getByText('Servo Angles Program')).toBeVisible();
  await expect(page.getByText('Lesson 1 / 8 · Section 1')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Why this matters' })).toBeVisible();

  // Same gate on the Servo side: a program in the workspace and a completed
  // Test before the build and observe sections release Next.
  await seedWorkspace(page, FIRST_ANGLE_SOLUTION);
  await page.getByTestId('test-button').click();
  await expect(page.getByTestId('simulation-status')).toHaveText('Completed', {
    timeout: 60_000,
  });

  for (let section = 1; section < 20; section += 1) {
    if (section === 19) {
      await answerQuiz(page, LESSONS[0].assessments.multipleChoice);
    }
    const next = page.getByTestId('next-angle-section');
    // As on the Grid side, each observe and challenge section wants its own
    // Test — or its own Step — rather than inheriting the first one.
    if (!(await next.isEnabled())) {
      await pressTheControlThisSectionTeaches(page);
      await expect(next).toBeEnabled({ timeout: 60_000 });
    }
    await next.click();
  }

  await expect(page.getByText('Lesson 1 / 8 · Section 20')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Scored checkpoint' })).toBeVisible();
  await expect(page.getByTestId('next-lesson')).toHaveCount(0);
  await seedWorkspace(page, FIRST_ANGLE_SOLUTION);
  await page.getByTestId('test-button').click();
  await expect(page.getByRole('heading', { name: 'Solved' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('next-lesson')).toHaveText('Next lesson');
});

/**
 * Satisfy the open section by pressing the control it teaches.
 *
 * "Use Step" says "press Step once" and is gated on Step; every other gated
 * section is gated on a completed Test.
 */
async function pressTheControlThisSectionTeaches(
  page: import('@playwright/test').Page,
): Promise<void> {
  // "Inspect the overlay" is satisfied by the overlay, which is on by default,
  // so a section still waiting here is one that asks for Step or Test.
  const stepSection = await page
    .getByRole('heading', { name: 'Use Step' })
    .isVisible();
  await page.getByTestId(stepSection ? 'step-button' : 'test-button').click();
}

/** Pass a lesson's multiple choice the way a learner does. */
async function answerQuiz(
  page: import('@playwright/test').Page,
  quiz: { options: readonly string[]; correctOptionIndex: number },
): Promise<void> {
  await page.getByRole('radio', { name: quiz.options[quiz.correctOptionIndex] }).click();
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.getByText('Quiz passed')).toBeVisible();
}

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
