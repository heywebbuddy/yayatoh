import { expect, test } from '@playwright/test';
import { OWNER, ownClientIp, personaCode } from './helpers.ts';

test.describe('sign-in', () => {
  test.beforeEach(async ({ context }) => ownClientIp(context));

  test('a user signs in with email and password and lands in their org', async ({ page }) => {
    test.skip(!process.env.DEV_PERSONA_PASSWORD, 'needs the seeded persona password');
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(OWNER);
    await page.getByLabel('Password').fill(process.env.DEV_PERSONA_PASSWORD as string);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    // Owners use two-step verification (M1.2c): the authenticator code comes next.
    await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
    await page.getByLabel('6-digit code').fill(personaCode(OWNER));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
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

  test('the email and password fields keep their labels and show example placeholders', async ({ page }) => {
    for (const path of ['/sign-in', '/o/sign-in']) {
      await page.goto(path);
      await expect(page.getByLabel('Email')).toHaveAttribute('placeholder', 'name@example.com');
      await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
        'placeholder',
        'Enter your password',
      );
    }
  });

  test('the eye button shows the typed password and hides it again', async ({ page }) => {
    for (const path of ['/sign-in', '/o/sign-in']) {
      await page.goto(path);
      const password = page.getByLabel('Password', { exact: true });
      await password.fill('not-a-real-password');
      await expect(password).toHaveAttribute('type', 'password');
      await page.getByRole('button', { name: 'Show password' }).click();
      await expect(password).toHaveAttribute('type', 'text');
      await page.getByRole('button', { name: 'Hide password' }).click();
      await expect(password).toHaveAttribute('type', 'password');
    }
  });

  test('sign-in page passes axe', async ({ page }) => {
    const { expectAccessible } = await import('./helpers.ts');
    await page.goto('/sign-in');
    await expectAccessible(page);
  });
});
