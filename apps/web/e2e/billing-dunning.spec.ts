import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, expectAccessibleBothModes, newUser } from './helpers.ts';

/*
 * M6.6b: in-app plan changes with the proration preview, dunning to read-only (and back by
 * paying), and the usage page. The e2e server runs with BILLING_ENABLED=1 and the fake provider;
 * every test works on an org of its own (billing applies only to orgs with a billing customer),
 * so no seeded org and no other spec ever sees a read-only state.
 */

const moduleChip = (page: Page, key: string) =>
  page.getByTestId('module-list').locator(`li[data-module="${key}"]`);

/** Keyboard only: focus the control, then press the key. */
async function press(page: Page, name: string | RegExp, key = 'Enter', role: 'button' | 'link' = 'button') {
  const control = page.getByRole(role, { name });
  await control.focus();
  await expect(control).toBeFocused();
  await page.keyboard.press(key);
}

/** On the plan page, pick a plan in "Change plan" with the keyboard and open its preview. */
async function previewPlan(page: Page, plan: string) {
  const radio = page
    .getByTestId('change-plan')
    .getByRole('radio', { name: new RegExp(`^${plan}: .* a month`) });
  await radio.focus();
  await page.keyboard.press('Space');
  await expect(radio).toBeChecked();
  await press(page, 'Preview change');
  await expect(page.getByTestId('change-preview')).toBeVisible();
}

/** Tick "I understand these modules turn off" with the keyboard, when the change turns some off. */
async function acknowledge(page: Page, name: RegExp = /^I understand/) {
  if ((await page.getByTestId('removed-modules').count()) === 0) return;
  const ack = page.getByRole('checkbox', { name });
  await ack.focus();
  await page.keyboard.press('Space');
  await expect(ack).toBeChecked();
}

/**
 * Start a Pro subscription in-app (the fake provider's webhook makes it live). From the legacy
 * plan (every module) Pro turns some modules off, so the change asks for the acknowledgement.
 */
async function startPro(page: Page, slug: string) {
  await page.goto(`/o/${slug}/plan`);
  await previewPlan(page, 'Pro');
  await acknowledge(page);
  await press(page, 'Confirm change');
  await expect(page).toHaveURL(new RegExp(`/o/${slug}/plan\\?billing=changed$`));
  await expect(page.getByTestId('plan-name')).toHaveText('Pro');
}

/** In the test billing portal (dev only), send a renewal outcome. */
async function renewal(
  page: Page,
  slug: string,
  button: 'Fail the renewal payment' | 'Stop retrying the payment',
) {
  await page.goto(`/o/${slug}/plan`);
  await press(page, 'Open the test billing portal');
  await expect(page).toHaveURL(/\/billing\/fake\?/);
  await press(page, button);
  await expect(page).toHaveURL(new RegExp(`/o/${slug}/plan\\?billing=renewal$`));
}

test.describe('plan changes, dunning and usage (M6.6b)', () => {
  test.describe.configure({ timeout: 150_000 });

  test('upgrade and downgrade with the proration preview, keyboard only', async ({ page }) => {
    const owner = await newUser(page, { org: true, twoFactor: true });
    const slug = owner.orgSlug as string;
    await page.goto(`/o/${slug}/plan`);
    const picker = page.getByTestId('change-plan');
    await expect(picker.getByRole('heading', { name: 'Change plan' })).toBeVisible();
    // Monthly and yearly prices of the four priced tiers; quoted plans are not offered in-app.
    await expect(picker.getByRole('radio')).toHaveCount(7);
    await expect(picker.getByRole('radio', { name: /^Enterprise/ })).toHaveCount(0);
    await expect(picker.getByRole('radio', { name: /^Pro: \$99\.00 a month/ })).toBeVisible();
    await expectAccessibleBothModes(page);

    // Inline validation: previewing without a plan says what to do.
    await press(page, 'Preview change');
    await expect(page.getByText('Choose a plan to preview.')).toBeVisible();

    // Start on Pro: a whole month now, with the provider's tax.
    await previewPlan(page, 'Pro');
    const preview = page.getByTestId('change-preview');
    await expect(preview.getByRole('heading', { name: 'Change to Pro' })).toBeVisible();
    await expect(preview.getByText('Your subscription starts today.')).toBeVisible();
    await expect(preview.locator('[data-row="tax"]')).toContainText('$7.92');
    await expect(page.getByTestId('amount-due')).toHaveText('$106.92');
    await expect(page.getByTestId('next-renewal')).toContainText('Then $106.92 on');
    // From the legacy plan (every module), Pro turns some off: they are listed first.
    await expect(page.getByTestId('removed-modules').locator('li[data-module="virtual"]')).toHaveText(
      'Virtual events',
    );
    await expectAccessibleBothModes(page);
    await acknowledge(page);
    await press(page, 'Confirm change');
    await expect(page.getByText('Plan change sent')).toBeVisible();
    await expect(page.getByTestId('plan-name')).toHaveText('Pro');
    await expect(page.getByTestId('current-plan').getByText('Active')).toBeVisible();
    await expect(moduleChip(page, 'sessions')).toHaveCount(1);

    // Downgrade to Free: the preview shows the credit and the modules that turn off first.
    await previewPlan(page, 'Free');
    await expect(
      page.getByText("You're downgrading. Unused time on your current plan is credited."),
    ).toBeVisible();
    await expect(page.getByTestId('amount-due')).toHaveText('$0.00');
    await expect(page.getByText(/of credit is kept for your next invoices/)).toBeVisible();
    const removed = page.getByTestId('removed-modules');
    await expect(removed.locator('li[data-module="sessions"]')).toHaveText('Sessions');
    await expect(removed.getByText(/Their data is kept/)).toBeVisible();
    // Confirming without the acknowledgement is stopped in place (nothing changes).
    await press(page, 'Confirm change');
    await expect(page.getByTestId('change-preview')).toBeVisible();
    const ack = page.getByRole('checkbox', { name: /I understand these modules turn off/ });
    expect(await ack.evaluate((el) => (el as HTMLInputElement).validity.valueMissing)).toBe(true);
    await ack.focus();
    await page.keyboard.press('Space');
    await expect(ack).toBeChecked();
    await press(page, 'Confirm change');
    await expect(page.getByText('Plan change sent')).toBeVisible();
    await expect(page.getByTestId('plan-name')).toHaveText('Free');
    await expect(moduleChip(page, 'sessions')).toHaveCount(0);

    // "Keep my plan" leaves it alone; it persists after a reload.
    await previewPlan(page, 'Pro');
    await press(page, 'Keep my plan', 'Enter', 'link');
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/plan$`));
    await page.reload();
    await expect(page.getByTestId('plan-name')).toHaveText('Free');
    // Upgrade back: the module returns, with no code change anywhere.
    await previewPlan(page, 'Pro');
    await expect(page.getByText(/You're upgrading/)).toBeVisible();
    await expect(page.getByTestId('removed-modules')).toHaveCount(0);
    await press(page, 'Confirm change');
    await expect(page.getByTestId('plan-name')).toHaveText('Pro');
    await expect(moduleChip(page, 'sessions')).toHaveText('Sessions');
  });

  test('a failed renewal: grace, then read-only with a clear refusal, nothing deleted; paying restores writes', async ({
    page,
  }) => {
    const owner = await newUser(page, { org: true, twoFactor: true });
    const slug = owner.orgSlug as string;
    await startPro(page, slug);
    const name = `Read-only test ${Date.now()}`;
    const general = page.getByRole('region', { name: 'General' });

    // The renewal fails: grace. The plan page and every console page say until when.
    await renewal(page, slug, 'Fail the renewal payment');
    await expect(page.getByTestId('billing-standing')).toHaveAttribute('data-standing', 'grace');
    await expect(page.getByText("Your subscription payment didn't go through").first()).toBeVisible();
    await page.goto(`/o/${slug}/settings`);
    await expect(page.getByTestId('billing-banner')).toHaveAttribute('data-standing', 'grace');
    // Writes still work during grace.
    await general.getByLabel('Organization name').fill(name);
    await general.getByRole('button', { name: 'Save' }).click();
    await expect(general.getByText('Saved.')).toBeVisible();

    // The provider stops retrying: read-only.
    await renewal(page, slug, 'Stop retrying the payment');
    await expect(page.getByTestId('billing-standing')).toHaveAttribute('data-standing', 'read_only');
    await expect(page.getByRole('heading', { name: 'Plan and modules', level: 1 })).toBeVisible();
    await expectAccessibleBothModes(page);
    await page.goto(`/o/${slug}/settings`);
    const banner = page.getByTestId('billing-banner');
    await expect(banner).toHaveAttribute('data-standing', 'read_only');
    await expect(banner).toContainText('This organization is read-only');
    await expect(banner).toContainText('Nothing has been deleted');
    await expectAccessible(page);
    // Reads work (the saved name is still there); a write is refused with a clear message.
    await expect(general.getByLabel('Organization name')).toHaveValue(name);
    await general.getByLabel('Organization name').fill(`${name} (changed)`);
    await general.getByRole('button', { name: 'Save' }).click();
    await expect(
      general.getByText(
        'This organization is read-only until its subscription is paid. Nothing was saved or deleted.',
      ),
    ).toBeVisible();
    await page.reload();
    await expect(general.getByLabel('Organization name')).toHaveValue(name);

    // Pay now (keyboard only, from the banner's link): writes come back at once.
    await press(page, 'Plan and billing', 'Enter', 'link');
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/plan$`));
    await press(page, 'Pay now');
    await expect(page.getByText('Payment received')).toBeVisible();
    await expect(page.getByTestId('billing-standing')).toHaveCount(0);
    await page.goto(`/o/${slug}/settings`);
    await expect(page.getByTestId('billing-banner')).toHaveCount(0);
    await general.getByLabel('Organization name').fill(`${name} (paid)`);
    await general.getByRole('button', { name: 'Save' }).click();
    await expect(general.getByText('Saved.')).toBeVisible();
  });

  test('usage page: current month by meter, filters, empty state, keyboard only', async ({ page }) => {
    const owner = await newUser(page, { org: true, twoFactor: true });
    const slug = owner.orgSlug as string;
    await page.goto(`/o/${slug}/plan`);
    await press(page, 'Usage', 'Enter', 'link');
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/plan/usage$`));
    await expect(page.getByRole('heading', { name: 'Usage', level: 1 })).toBeVisible();
    await expect(page.getByTestId('usage-period')).toContainText('This month:');
    await expect(page.getByText('No usage yet')).toBeVisible();
    await expect(page.getByText('Usage is counted, nothing is charged')).toBeVisible();
    await expectAccessibleBothModes(page);

    // Two scan devices enrolled (through the real command), metered from the outbox.
    const res = await page.request.post('/api/dev/billing', { form: { org: slug, devices: '2' } });
    expect(res.ok()).toBe(true);
    await page.reload();
    await expect(page.getByTestId('usage-devices')).toContainText('2');
    await expect(page.getByTestId('usage-devices')).toContainText('2 devices enrolled');
    await expect(page.getByTestId('usage-sms')).toContainText('0');
    await expect(page.getByText('No usage in earlier months.')).toBeVisible();
    // Metering again counts nothing twice.
    await page.request.post('/api/dev/billing', { form: { org: slug, devices: '0' } });
    await page.reload();
    await expect(page.getByTestId('usage-devices')).toContainText('2 devices enrolled');

    // Filter by meter with the keyboard.
    await press(page, 'Scan devices', 'Enter', 'link');
    await expect(page).toHaveURL(/meter=devices$/);
    await expect(page.getByRole('link', { name: 'Scan devices' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('usage-current').locator('[data-testid^="usage-"]')).toHaveCount(1);
    await press(page, 'All meters', 'Enter', 'link');
    await expect(page.getByTestId('usage-current').locator('[data-testid^="usage-"]')).toHaveCount(5);

    // With a subscription, usage goes to the billing provider.
    await startPro(page, slug);
    await page.goto(`/o/${slug}/plan/usage`);
    await expect(page.getByText('Usage is sent to your billing provider')).toBeVisible();
  });

  test('a viewer sees neither plan changes nor usage; a finance member cannot change the plan', async ({
    page,
  }) => {
    await newUser(page, { join: ['lakeside-events:viewer'] });
    await page.goto('/o/lakeside-events/plan/usage');
    await expect(page.getByText('Only owners, admins and finance can see the plan')).toBeVisible();
    await expect(page.getByTestId('usage-current')).toHaveCount(0);
    await expectAccessible(page);
    await page.goto('/o/lakeside-events/plan');
    await expect(page.getByTestId('change-plan')).toHaveCount(0);
    // A direct preview URL shows nothing either.
    await page.goto('/o/lakeside-events/plan?change=tier_free_month_usd');
    await expect(page.getByTestId('change-preview')).toHaveCount(0);

    await newUser(page, { join: ['lakeside-events:finance'], twoFactor: true });
    await page.goto('/o/lakeside-events/plan');
    await expect(page.getByTestId('plan-name')).toBeVisible();
    await expect(page.getByTestId('change-plan')).toHaveCount(0);
    await page.goto('/o/lakeside-events/plan?change=tier_free_month_usd');
    await expect(page.getByTestId('change-preview')).toHaveCount(0);
    await page.goto('/o/lakeside-events/plan/usage');
    await expect(page.getByRole('heading', { name: 'Usage', level: 1 })).toBeVisible();
  });

  test('Arabic: the preview, the read-only banner and the usage page render right to left', async ({
    page,
  }) => {
    const owner = await newUser(page, { org: true, twoFactor: true });
    const slug = owner.orgSlug as string;
    await page.goto(`/ar/o/${slug}/plan`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'غيّر الخطة' })).toBeVisible();
    const radio = page.getByTestId('change-plan').getByRole('radio', { name: /^الاحترافية: .*شهريًا/ });
    await radio.focus();
    await page.keyboard.press('Space');
    await press(page, 'عاين التغيير');
    await expect(page.getByTestId('change-preview')).toBeVisible();
    await expect(page.getByText('يبدأ اشتراكك اليوم.')).toBeVisible();
    await expectAccessible(page);
    await acknowledge(page, /^أفهم/);
    await press(page, 'أكّد التغيير');
    await expect(page.getByTestId('plan-name')).toHaveText('الاحترافية');
    await press(page, 'افتح بوابة الفوترة التجريبية');
    await press(page, 'أوقف إعادة محاولة الدفع');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('billing-banner')).toContainText('هذه المؤسسة للقراءة فقط');
    await expect(page.getByRole('button', { name: 'ادفع الآن' })).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar/o/${slug}/plan/usage`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'الاستخدام', level: 1 })).toBeVisible();
    await expectAccessible(page);
  });
});
