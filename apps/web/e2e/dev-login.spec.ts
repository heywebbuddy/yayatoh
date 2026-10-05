import { expect, test } from '@playwright/test';
import { expectAccessibleBothModes } from './helpers.ts';

/**
 * /dev/login (batch 3h, owner 2026-10-02): the newcomer and the staff persona are labelled by what
 * they are, not as owners of an empty org. The newcomer signs in here (no organization yet); staff
 * are sent to the admin console's sign-in instead.
 */
test.describe('dev sign-in personas', () => {
  test('org members show role and org; the newcomer and staff say what they are', async ({ page }) => {
    await page.goto('/dev/login');
    const pani = page.locator('[data-persona="pani@lakeside.test"]');
    await expect(pani).toContainText('Owner · lakeside-events');
    await expect(pani.getByRole('button', { name: 'Sign in' })).toBeVisible();

    const nia = page.locator('[data-persona="nia@newcomer.test"]');
    await expect(nia).toContainText('New account, no organization: sign-up and onboarding');
    await expect(nia).not.toContainText('Owner');
    await expect(nia.getByRole('button', { name: 'Sign in' })).toBeVisible();

    const omar = page.locator('[data-persona="omar@yayatoh.test"]');
    await expect(omar).toContainText('Yayatoh staff: use the admin console on :3001');
    await expect(omar).not.toContainText('Owner');
    // Staff never sign in to an org here: the card links to the admin console's sign-in.
    await expect(omar.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
    const admin = omar.getByRole('link', { name: 'Open the admin console' });
    await expect(admin).toHaveAttribute('href', /:3001\/sign-in$/);
    await expectAccessibleBothModes(page);
  });

  test('the newcomer signs in by keyboard (to the no-organization start on a fresh seed)', async ({
    page,
  }) => {
    await page.goto('/dev/login');
    const nia = page.locator('[data-persona="nia@newcomer.test"]');
    await nia.getByRole('button', { name: 'Sign in' }).focus();
    await page.keyboard.press('Enter');
    // Signed in: the org picker. On a fresh seed she has no organization yet; signup.spec onboards
    // her into one during the full suite, and then she lands in it instead.
    await expect(page).toHaveURL(/\/o(\/[^/]+)?$/);
    if (new URL(page.url()).pathname === '/o')
      await expect(page.getByText("You're not in an organization yet", { exact: true })).toBeVisible();
    else await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('the staff link is reachable by keyboard and the Arabic page labels both cards', async ({ page }) => {
    await page.goto('/ar/dev/login');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const omar = page.locator('[data-persona="omar@yayatoh.test"]');
    await expect(omar).toContainText('فريق Yayatoh');
    await expect(page.locator('[data-persona="nia@newcomer.test"]')).toContainText('حساب جديد بلا مؤسسة');
    const admin = omar.getByRole('link', { name: 'فتح وحدة تحكم الإدارة' });
    await admin.focus();
    await expect(admin).toBeFocused();
    await expectAccessibleBothModes(page);
  });
});
