import { expect, test } from '@playwright/test';
import { OWNER } from './helpers.ts';

test.describe('sign-in', () => {
  test('a user signs in with email and password and lands in their org', async ({ page }) => {
    test.skip(!process.env.DEV_PERSONA_PASSWORD, 'needs the seeded persona password');
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(OWNER);
    await page.getByLabel('Password').fill(process.env.DEV_PERSONA_PASSWORD as string);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pani');
  });

  test('a wrong password shows a localized error and no session', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(OWNER);
    await page.getByLabel('Password').fill('definitely-wrong');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: "don't match" })).toBeVisible();
    const res = await page.goto('/o/lakeside-events');
    await expect(page).toHaveURL(/\/sign-in$/);
    expect(res?.status()).toBe(200);
  });

  test('sign-in page passes axe', async ({ page }) => {
    const { expectAccessible } = await import('./helpers.ts');
    await page.goto('/sign-in');
    await expectAccessible(page);
  });
});
