import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  ageSession,
  codeForKey,
  confirmStepUp,
  devPassword,
  expectAccessible,
  lastEmailedCode,
  newUser,
  personaCode,
  signIn,
  stepUpDialog,
  type TestUser,
  wrongCode,
} from './helpers.ts';

/**
 * Step-up (M1.2c): sensitive actions need a sign-in or a confirmation in the last 10 minutes.
 * `ageSession` moves this session's last re-authentication 11 minutes into the past (dev only),
 * so each test sees the "Confirm it's you" dialog without waiting. Wrong codes are only ever
 * typed for throwaway accounts (the confirmation is rate limited per person).
 */

const stamp = () => `${test.info().project.name.split('-')[0]}-${Date.now()}`;
const appCode = (user: TestUser) => codeForKey(user.setupKey ?? '');
const wrongFor = (user: TestUser) => wrongCode(() => appCode(user));

/** A throwaway owner of a new organization, with two-step verification on, signed in. */
const owner = (page: Page) => newUser(page, { org: true, twoFactor: true });

async function invite(page: Page, email: string, role: string) {
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Role').selectOption(role);
  await page.getByRole('button', { name: 'Send invitation' }).click();
}

test.describe('step-up: "Confirm it\'s you"', () => {
  test('after the fresh window an invitation asks first; a wrong code is refused; once confirmed it goes out, and nothing asks again for 10 minutes', async ({
    page,
  }) => {
    const user = await owner(page);
    await page.goto(`/o/${user.orgSlug}/team`);
    await ageSession(page);
    const email = `step-${stamp()}@example.test`;
    await invite(page, email, 'manager');

    const dialog = stepUpDialog(page);
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(
        "Sensitive changes need a recent sign-in. Once you confirm, we won't ask again for 10 minutes.",
      ),
    ).toBeVisible();
    const code = dialog.getByLabel('Code');
    await expect(code).toBeFocused();
    await expectAccessible(page);

    await code.fill(wrongFor(user));
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(
      dialog.getByRole('alert').filter({ hasText: "That code didn't work. Try again." }),
    ).toBeVisible();
    await expect(code).toHaveAttribute('aria-invalid', 'true');
    await expect(code).toBeFocused();
    await expectAccessible(page);
    // Nothing was sent yet.
    await expect(page.getByRole('listitem').filter({ hasText: email })).toHaveCount(0);

    await confirmStepUp(page, appCode(user));
    await expect(page.getByText('Invitation sent.')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: email })).toContainText('Manager');

    // Fresh again: the next sensitive action goes straight through.
    const second = `step2-${stamp()}@example.test`;
    await invite(page, second, 'scanner');
    await expect(page.getByRole('listitem').filter({ hasText: second })).toContainText('Scanner');
    await expect(stepUpDialog(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('listitem').filter({ hasText: email })).toBeVisible();
  });

  test('cancelling (Escape) keeps what was typed and says why; submitting again asks again', async ({
    page,
  }) => {
    const user = await owner(page);
    await page.goto(`/o/${user.orgSlug}/team`);
    await ageSession(page);
    const email = `keep-${stamp()}@example.test`;
    await invite(page, email, 'finance');
    await expect(stepUpDialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(stepUpDialog(page)).toHaveCount(0);
    await expect(
      page.getByRole('alert').filter({ hasText: "Please confirm it's you to continue." }),
    ).toBeVisible();
    await expect(page.getByLabel('Email address')).toHaveValue(email);
    await expect(page.getByLabel('Role')).toHaveValue('finance');
    await expect(page.getByRole('listitem').filter({ hasText: email })).toHaveCount(0);

    // The Cancel button does the same; then confirm with the keyboard alone.
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await stepUpDialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByLabel('Email address')).toHaveValue(email);
    await page.getByRole('button', { name: 'Send invitation' }).focus();
    await page.keyboard.press('Enter');
    await expect(stepUpDialog(page).getByLabel('Code')).toBeFocused();
    await page.keyboard.type(appCode(user));
    await page.keyboard.press('Enter');
    await expect(stepUpDialog(page)).toHaveCount(0);
    await expect(page.getByRole('listitem').filter({ hasText: email })).toContainText('Finance');
  });

  test('people without an authenticator confirm with their password (keyboard only)', async ({ page }) => {
    await newUser(page);
    await page.goto('/account/security');
    await ageSession(page);
    // Starting set-up is itself sensitive.
    await page.getByRole('button', { name: 'Set up authenticator app' }).focus();
    await page.keyboard.press('Enter');
    const dialog = stepUpDialog(page);
    await expect(dialog.getByText('Enter your password.')).toBeVisible();
    const password = dialog.getByLabel('Password');
    await expect(password).toBeFocused();
    await expectAccessible(page);
    await page.keyboard.type('not-my-password');
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('alert').filter({ hasText: "That password isn't right." })).toBeVisible();
    await expect(password).toBeFocused();
    await expectAccessible(page);
    await page.keyboard.type(devPassword());
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('img', { name: /^QR code for your authenticator app/ })).toBeVisible();
  });

  test('people without a password get an emailed code; a new code replaces the old one', async ({ page }) => {
    const user = await newUser(page, { password: false });
    await page.goto('/account/security');
    const signInCode = await lastEmailedCode(page, user.email);
    await ageSession(page);
    await page.getByRole('button', { name: 'Set up authenticator app' }).click();
    const dialog = stepUpDialog(page);
    await expect(dialog.getByText('We emailed you a 6-digit code. It expires in 10 minutes.')).toBeVisible();
    await expect.poll(() => lastEmailedCode(page, user.email)).not.toBe(signInCode);
    const first = await lastEmailedCode(page, user.email);
    await expectAccessible(page);

    await dialog.getByRole('button', { name: 'Email me a new code' }).click();
    await expect(dialog.getByRole('status').filter({ hasText: 'We sent a new code.' })).toBeVisible();
    await expect.poll(() => lastEmailedCode(page, user.email)).not.toBe(first);
    const second = await lastEmailedCode(page, user.email);
    await dialog.getByLabel('Code').fill(first);
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(
      dialog.getByRole('alert').filter({ hasText: "That code didn't work. Try again." }),
    ).toBeVisible();
    await confirmStepUp(page, second);
    await expect(page.getByRole('img', { name: /^QR code for your authenticator app/ })).toBeVisible();
  });

  test('domains: adding and removing a custom domain ask first', async ({ page }) => {
    const user = await owner(page);
    const host = `step-${stamp()}.verified.test`;
    await page.goto(`/o/${user.orgSlug}/domains`);
    await ageSession(page);
    const add = page.getByRole('region', { name: 'Add a domain you own' });
    await add.getByLabel('Domain').fill(host);
    await add.getByRole('button', { name: 'Add domain' }).click();
    await confirmStepUp(page, appCode(user));
    const list = page.getByRole('list', { name: 'Your domains' });
    const mine = list.getByRole('listitem').filter({ hasText: host });
    await expect(mine.getByText('Waiting for DNS')).toBeVisible();

    await ageSession(page);
    await page.reload();
    await mine.getByRole('button', { name: `Remove ${host}` }).click();
    await expect(stepUpDialog(page)).toBeVisible();
    await expectAccessible(page);
    await confirmStepUp(page, appCode(user));
    await expect(list.getByRole('listitem').filter({ hasText: host })).toHaveCount(0);
  });

  test('API keys: creating keeps the typed name and scopes on cancel; revoking asks too', async ({
    page,
  }) => {
    const user = await owner(page);
    await page.goto(`/o/${user.orgSlug}/api-keys`);
    await ageSession(page);
    const name = `Step-up ${stamp()}`;
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByRole('checkbox', { name: 'Read the organization' }).check();
    await page.getByRole('button', { name: 'Create key' }).click();
    await stepUpDialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(name);
    await expect(page.getByRole('checkbox', { name: 'Read the organization' })).toBeChecked();
    await expect(page.getByTestId('new-api-key')).toHaveCount(0);

    await page.getByRole('button', { name: 'Create key' }).click();
    await confirmStepUp(page, appCode(user));
    await expect(page.getByText(`Key “${name}” created.`)).toBeVisible();
    await expect(page.getByTestId('new-api-key')).toHaveText(/^yy_live_/);

    await ageSession(page);
    await page.reload();
    const row = page.getByRole('row').filter({ hasText: name });
    await row.getByRole('button', { name: `Revoke key ${name}` }).click();
    await confirmStepUp(page, appCode(user));
    await expect(row).toContainText('Revoked');
  });

  test('payouts: set-up asks first; the new account waits 24 hours and the owner is told', async ({
    page,
  }) => {
    const user = await owner(page);
    await page.goto(`/o/${user.orgSlug}/payouts`);
    await ageSession(page);
    await page.getByRole('button', { name: 'Set up payouts' }).click();
    await confirmStepUp(page, appCode(user));
    await expect(page).toHaveURL(/\/connect\/fake\?/);
    await page.getByRole('button', { name: 'Finish setup' }).click();
    await expect(page).toHaveURL(/\/payouts\?onboarding=returned$/);
    await expect(
      page.getByRole('status').filter({ hasText: 'New payout account: for your security' }),
    ).toContainText('transfers to it start after');
    await expectAccessible(page);

    // The owners hear about it at once: in the console and by email.
    const drained = await page.request.post('/api/dev/outbox/drain', { form: { org: user.orgSlug ?? '' } });
    expect(drained.ok()).toBe(true);
    const mail = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(user.email)}`);
    const [notice] = (await mail.json()) as { subject: string; text: string }[];
    expect(notice?.subject).toMatch(/^A new payout account for Test Org /);
    expect(notice?.text).toContain('no money is sent to it before');
    expect(notice?.text).toContain(`/o/${user.orgSlug}/payouts`);
    await page.goto(`/o/${user.orgSlug}/notifications`);
    await expect(
      page.getByRole('main').getByRole('link', { name: /^New payout account: transfers to it start after / }),
    ).toBeVisible();
  });

  test('widget: letting a new website embed checkout asks first; removing one does not', async ({ page }) => {
    const user = await owner(page);
    const origin = `https://shop-${stamp()}.example.test`;
    await page.goto(`/o/${user.orgSlug}/site`);
    await ageSession(page);
    const widget = page.getByRole('region', { name: 'Ticket widget' });
    await widget.getByLabel('Websites allowed to show the widget').fill(origin);
    await widget.getByRole('button', { name: 'Save' }).click();
    await confirmStepUp(page, appCode(user));
    await expect(widget.getByText('Saved.')).toBeVisible();
    await page.reload();
    await expect(widget.getByLabel('Websites allowed to show the widget')).toHaveValue(origin);

    await ageSession(page);
    await page.reload();
    await widget.getByLabel('Websites allowed to show the widget').fill('');
    await widget.getByRole('button', { name: 'Save' }).click();
    await expect(widget.getByText('Saved.')).toBeVisible();
    await expect(stepUpDialog(page)).toHaveCount(0);
  });

  test('Arabic: the dialog renders right to left', async ({ page }) => {
    const user = await owner(page);
    await page.goto(`/ar/o/${user.orgSlug}/team`);
    await ageSession(page);
    await page.getByLabel('البريد الإلكتروني').fill(`ar-${stamp()}@example.test`);
    await page.getByRole('button', { name: 'إرسال الدعوة' }).click();
    const dialog = page.getByRole('dialog', { name: 'أكّد أنك أنت' });
    await expect(dialog).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(page);
    await dialog.getByLabel('الرمز').fill(appCode(user));
    await dialog.getByRole('button', { name: 'تأكيد' }).click();
    await expect(dialog).toHaveCount(0);
  });
});

/** A new event of the seeded owner with a $30 pass and one paid order of two tickets. */
async function paidOrder(page: Page, browser: Browser) {
  const s = stamp();
  await page.goto('/o/lakeside-events/events/new');
  await page.getByLabel('Event name', { exact: true }).fill(`Step-up ${s}`);
  await page.getByLabel('Starts', { exact: true }).fill('2028-03-01T18:00');
  await page.getByLabel('Ends', { exact: true }).fill('2028-03-01T22:00');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/step-up-/);
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill('Pass');
  await page.getByLabel('Price (USD)').fill('30');
  await page.getByLabel('Quantity available').fill('10');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Pass' })).toBeVisible();
  const buyer = `Sasha Stepup ${s}`;
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/events/${base.split('/').pop()}`);
  await guest.getByLabel('Quantity — Pass').selectOption('2');
  await guest.getByLabel('Full name').fill(buyer);
  await guest.getByLabel('Email for your tickets').fill(`sasha+${s}@example.test`);
  await guest.getByRole('button', { name: 'Continue to payment' }).click();
  await guest.getByRole('button', { name: /^Pay/ }).click();
  await expect(guest).toHaveURL(/\/orders\/[A-Za-z0-9_-]{43}$/);
  await guest.context().close();
  return { base, buyer };
}

test.describe('step-up: money and data leaving', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('refunding a whole order asks first; the typed choices are kept on cancel', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const { base, buyer } = await paidOrder(page, browser);
    await page.goto(`${base}/tickets-orders`);
    await page.getByRole('link', { name: buyer }).click();
    await ageSession(page);
    const form = page.getByRole('region', { name: 'Refund', exact: true });
    await form.getByLabel('Reason').selectOption('duplicate');
    // Every ticket, not the owner's "refund outside the policy" box (M1.6e), which renames the note.
    const tickets = form.getByRole('group', { name: 'Tickets to refund' }).getByRole('checkbox');
    for (const box of await tickets.all()) await box.check();
    await form.getByLabel('Note (optional, for your team)').fill('Bought twice');
    await form.getByRole('button', { name: 'Refund' }).click();
    await expect(stepUpDialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(form.getByLabel('Reason')).toHaveValue('duplicate');
    await expect(form.getByLabel('Note (optional, for your team)')).toHaveValue('Bought twice');
    for (const box of await tickets.all()) await expect(box).toBeChecked();
    await expect(page.getByRole('table', { name: 'Refunds' })).toHaveCount(0);

    await form.getByRole('button', { name: 'Refund' }).click();
    await confirmStepUp(page, personaCode());
    // Refunded in full: the refund is listed and there is nothing left to refund.
    await expect(
      page.getByRole('table', { name: 'Refunds' }).getByRole('row').filter({ hasText: 'Duplicate order' }),
    ).toContainText('$60.00');
    await expect(form).toHaveCount(0);
  });

  test('exporting attendees and bookings asks first', async ({ page, browser }) => {
    await signIn(page);
    const { base } = await paidOrder(page, browser);
    await page.goto(`${base}/attendees`);
    await ageSession(page);
    const bulk = page.getByRole('form', { name: 'Bulk actions' });
    await bulk.getByLabel('All 2 matching').check();
    await bulk.getByLabel('Action').selectOption({ label: 'Export as CSV' });
    await bulk.getByRole('button', { name: 'Apply' }).click();
    await expect(stepUpDialog(page)).toBeVisible();
    await expectAccessible(page);
    await confirmStepUp(page, personaCode());
    await expect(page.getByRole('region', { name: 'Attendee export' })).toContainText(
      'Ready: 2 rows exported.',
    );

    await ageSession(page);
    await page.goto(`${base}/analysis/bookings`);
    await page.getByRole('button', { name: 'Export as CSV' }).click();
    await confirmStepUp(page, personaCode());
    await expect(
      page.getByRole('region', { name: 'Bookings export' }).getByText(/^Ready: 1 row/),
    ).toBeVisible({
      timeout: 20_000,
    });
  });
});
