import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, newUser, signIn } from './helpers.ts';

/*
 * M6.6a billing foundation (dormant). The e2e server runs with BILLING_ENABLED=1 and the fake
 * provider (playwright.config.ts): billing applies only to an org with a billing customer, which
 * only the test billing portal creates, so every seeded org (and every other spec) is unchanged.
 */

const moduleList = (page: Page) => page.getByTestId('module-list');
const modulesHeading = (page: Page) => page.locator('#modules-heading');
const moduleChip = (page: Page, key: string) => moduleList(page).locator(`li[data-module="${key}"]`);

/** Keyboard only: focus the control, then press the key. */
async function press(page: Page, name: string | RegExp, key = 'Enter') {
  const control = page.getByRole('button', { name });
  await control.focus();
  await expect(control).toBeFocused();
  await page.keyboard.press(key);
}

/** In the test billing portal, pick a plan with the keyboard and submit. */
async function switchTo(page: Page, plan: string) {
  await expect(page.getByRole('heading', { level: 1, name: 'Choose a plan' })).toBeVisible();
  const radio = page.getByRole('radio', { name: new RegExp(`^${plan}`) });
  await radio.focus();
  await page.keyboard.press('Space');
  await expect(radio).toBeChecked();
  await press(page, 'Switch plan');
}

test.describe('plan and modules (M6.6a)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('an org without billing sees its plan read-only and keeps every module (billing-off smoke)', async ({
    page,
  }) => {
    const owner = await newUser(page, { org: true, twoFactor: true });
    const slug = owner.orgSlug as string;
    // Reached from Settings.
    await page.goto(`/o/${slug}/settings`);
    await page.getByRole('link', { name: 'Plan and modules' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/plan$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Plan and modules' })).toBeVisible();
    await expect(page.getByText("Billing isn't active for this organization")).toBeVisible();
    await expect(page.getByTestId('plan-name')).toHaveText('Launch standard');
    await expect(page.getByTestId('current-plan').getByText('Included plan')).toBeVisible();
    await expect(page.getByTestId('fees')).toContainText('Per-ticket fees follow the Launch standard plan.');
    // Every module of the legacy plan, the Phase 6 keys included.
    await expect(modulesHeading(page)).toContainText('35 modules');
    for (const key of ['core', 'marketing', 'sessions', 'api_access', 'analytics_pro'])
      await expect(moduleChip(page, key)).toHaveCount(1);
    await expect(moduleChip(page, 'sessions')).toHaveText('Sessions');
    // The placeholder catalog, all switched off.
    const rows = page.getByRole('table', { name: 'Plans' }).locator('tbody tr');
    await expect(rows).toHaveCount(5);
    await expect(rows.first()).toContainText('Free');
    await expect(rows.first()).toContainText('$0.00 a month');
    await expect(rows.nth(2)).toContainText('$99.00 a month');
    await expect(rows.nth(4)).toContainText('Custom quote');
    await expect(page.getByRole('table', { name: 'Plans' }).getByText('Not on sale yet')).toHaveCount(5);
    // The console is unchanged: module-gated pages are still in the nav.
    await expect(page.locator(`nav a[href$="/${slug}/campaigns"]`).first()).toBeAttached();
    await expectAccessible(page);
  });

  test('a seeded org is untouched: no billing, every module', async ({ page }) => {
    await signIn(page);
    await page.goto('/o/lakeside-events/plan');
    await expect(page.getByText("Billing isn't active for this organization")).toBeVisible();
    await expect(page.getByTestId('plan-name')).toHaveText('Launch standard');
    await expect(page.getByTestId('fees')).toBeVisible();
    await expect(moduleChip(page, 'sessions')).toHaveCount(1);
  });

  test('a plan change through the fake webhook moves the modules, keyboard only', async ({ page }) => {
    const owner = await newUser(page, { org: true, twoFactor: true });
    const slug = owner.orgSlug as string;
    await page.goto(`/o/${slug}/plan`);
    await expect(page.getByTestId('test-billing')).toBeVisible();
    await press(page, 'Open the test billing portal');
    await expect(page).toHaveURL(/\/billing\/fake\?/);
    await expectAccessible(page);

    // Validation: submitting without a plan says what to do.
    await press(page, 'Switch plan');
    await expect(page.getByText('Choose a plan to switch to.')).toBeVisible();

    // Downgrade to Free: Sessions is not in it.
    await switchTo(page, 'Free');
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/plan\\?billing=updated$`));
    await expect(page.getByText('Plan change received')).toBeVisible();
    await expect(page.getByTestId('plan-name')).toHaveText('Free');
    await expect(page.getByTestId('current-plan').getByText('Subscription')).toBeVisible();
    await expect(page.getByTestId('current-plan').getByText('Active')).toBeVisible();
    await expect(page.getByTestId('current-plan')).toContainText('$0.00 a month');
    await expect(page.getByTestId('current-plan')).toContainText('Renews on');
    await expect(modulesHeading(page)).toContainText('20 modules');
    await expect(moduleChip(page, 'sessions')).toHaveCount(0);
    await expectAccessible(page);

    // Upgrade to Pro: the module appears, with no code change anywhere.
    await press(page, 'Open the test billing portal');
    await switchTo(page, 'Pro');
    await expect(page.getByTestId('plan-name')).toHaveText('Pro');
    await expect(page.getByTestId('current-plan')).toContainText('$99.00 a month');
    await expect(moduleChip(page, 'sessions')).toHaveText('Sessions');
    await expect(moduleChip(page, 'integrations')).toHaveCount(1);

    // It persists.
    await page.goto(`/o/${slug}/plan`);
    await expect(page.getByTestId('plan-name')).toHaveText('Pro');
    await expect(moduleChip(page, 'sessions')).toHaveCount(1);

    // Back without changes leaves it alone.
    await press(page, 'Open the test billing portal');
    const back = page.getByRole('link', { name: 'Back without changes' });
    await back.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/plan$`));
    await expect(page.getByTestId('plan-name')).toHaveText('Pro');

    // Cancel: the org returns to its included plan and every module.
    await press(page, 'Open the test billing portal');
    await press(page, 'Cancel subscription');
    await expect(page.getByTestId('plan-name')).toHaveText('Launch standard');
    await expect(page.getByTestId('current-plan').getByText('Canceled')).toBeVisible();
    await expect(modulesHeading(page)).toContainText('35 modules');
  });

  test('a viewer is refused the plan, and the portal only opens through a signed link', async ({ page }) => {
    await newUser(page, { join: ['lakeside-events:viewer'] });
    await page.goto('/o/lakeside-events/plan');
    await expect(page.getByText('Only owners, admins and finance can see the plan')).toBeVisible();
    await expect(page.getByTestId('module-list')).toHaveCount(0);
    await expect(page.getByTestId('test-billing')).toHaveCount(0);
    await expectAccessible(page);
    const forged = await page.goto(
      '/en/billing/fake?customer=fakecus_x&return=%2Fen%2Fo%2Flakeside-events%2Fplan&sig=0123456789abcdef0123456789abcdef',
    );
    expect(forged?.status()).toBe(404);
  });

  test('Arabic: the plan page and the portal render right to left', async ({ page }) => {
    const owner = await newUser(page, { org: true, twoFactor: true });
    const slug = owner.orgSlug as string;
    await page.goto(`/ar/o/${slug}/plan`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'الخطة والوحدات' })).toBeVisible();
    await expect(page.getByTestId('plan-name')).toHaveText('الإطلاق القياسية');
    await expectAccessible(page);
    await press(page, 'افتح بوابة الفوترة التجريبية');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'اختر خطة' })).toBeVisible();
    await expectAccessible(page);
    const radio = page.getByRole('radio', { name: /^الاحترافية/ });
    await radio.focus();
    await page.keyboard.press('Space');
    await press(page, 'غيّر الخطة');
    await expect(page).toHaveURL(new RegExp(`/ar/o/${slug}/plan\\?billing=updated$`));
    await expect(page.getByTestId('plan-name')).toHaveText('الاحترافية');
    await expect(moduleChip(page, 'sessions')).toHaveText('الجلسات');
  });
});
