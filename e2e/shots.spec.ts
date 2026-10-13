import { test, expect } from '@playwright/test';
test('smoke: setup page renders', async ({ page }) => {
  await page.goto('/setup');
  await expect(page.getByRole('heading', { name: 'Set up SCHEDuling' })).toBeVisible();
});
