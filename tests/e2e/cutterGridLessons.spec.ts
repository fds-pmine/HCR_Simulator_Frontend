import { expect, test } from '@playwright/test';

test('opens a dedicated Cutter Grid lesson without exposing Servo mode', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Lessons/ }).click();

  await expect(
    page.getByRole('heading', { name: 'Control the cutter in 3D space' }),
  ).toBeVisible();
  await expect(page.locator('.lesson-row--cutter-grid')).toHaveCount(5);
  await page
    .getByRole('button', { name: /Fixed World Axes/ })
    .click();

  await expect(
    page.getByRole('heading', { name: 'Grid 1 · Fixed World Axes' }),
  ).toBeVisible();
  await expect(page.getByText('Cutter Grid Program')).toBeVisible();
  await expect(page.getByTestId('blockly-editor')).toBeVisible();
  await expect(page.getByTestId('simulation-status')).toHaveText('Idle', {
    timeout: 20_000,
  });
  await expect(
    page.getByRole('button', { name: 'Servo Angles', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByTestId('submit-button')).toHaveCount(0);
});
