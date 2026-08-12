import { expect, test } from '@playwright/test';

test('keeps Versus on the Servo-only programming contract', async ({ page }) => {
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
