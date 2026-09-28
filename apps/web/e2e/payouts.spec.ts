import { expect, test } from '@playwright/test';
import { continueToPayment, expectAccessible, newUser } from './helpers.ts';

/** `YYYY-MM-DDTHH:mm` wall-clock time in Chicago, `offsetH` hours from now (for datetime-local). */
function chicago(offsetH: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + offsetH * 3_600_000));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

test.describe('payouts', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('an owner connects a payout account; buyers then pay the organizer directly', async ({
    page,
    browser,
  }) => {
    // An org of its own: a connected account turns every later order of the org into a direct
    // charge, which would change what other tests on the seeded orgs see (receivables need
    // platform-collected orders).
    const user = await newUser(page, { org: true, twoFactor: true });
    const org = user.orgSlug ?? '';
    await page.goto(`/o/${org}/payouts`);
    await expect(page.getByRole('heading', { name: 'Payouts', level: 1 })).toBeVisible();
    await expectAccessible(page);

    await page.getByRole('button', { name: 'Set up payouts' }).click();
    await expect(page).toHaveURL(/\/connect\/fake\?/);
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Submit with details missing' }).click();
    await expect(page).toHaveURL(/\/payouts\?onboarding=returned$/);
    await expect(page.getByText('More information needed')).toBeVisible();
    await expect(page.getByText('external_account')).toBeVisible();
    await page.getByRole('button', { name: 'Continue setup' }).click();
    await page.getByRole('button', { name: 'Finish setup' }).click();
    await expect(page).toHaveURL(/\/payouts\?onboarding=returned$/);
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    await expect(page.getByText('New orders are paid straight into your account.')).toBeVisible();
    await expectAccessible(page);

    // Checkout now charges the organizer's connected account (the fake page shows it in its URL).
    const stamp = Date.now();
    // A new org accepts the platform terms before it can publish.
    await page.goto(`/o/${org}/settings`);
    const agreements = page.getByRole('region', { name: 'Yayatoh agreements' });
    await agreements.getByRole('checkbox', { name: /agree to the Terms of Service/ }).check();
    await agreements.getByRole('button', { name: 'Accept' }).first().click();
    await expect(agreements.getByText(/Accepted on/).first()).toBeVisible();
    await page.goto(`/o/${org}/events/new`);
    await page.getByLabel('Event name', { exact: true }).fill(`Direct Night ${stamp}`);
    await page.getByLabel('Time zone').selectOption('America/Chicago');
    await page.getByLabel('Starts', { exact: true }).fill(chicago(24));
    await page.getByLabel('Ends', { exact: true }).fill(chicago(27));
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${org}/e/[a-z0-9-]+$`));
    const base = new URL(page.url()).pathname;
    const slug = base.split('/').at(-1);
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();
    await page.goto(`${base}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill(`Direct pass ${stamp}`);
    await page.getByLabel('Price (USD)').fill('25');
    await page.getByLabel('Quantity available').fill('5');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: `Direct pass ${stamp}` })).toBeVisible();
    const guest = await (await browser.newContext()).newPage();
    await guest.goto(`/events/${slug}`);
    await guest.getByLabel(`Quantity — Direct pass ${stamp}`).selectOption('1');
    await guest.getByLabel('Full name').fill('Direct Buyer');
    await guest.getByLabel('Email for your tickets').fill(`direct+${stamp}@example.test`);
    await continueToPayment(guest, `direct+${stamp}@example.test`);
    await expect(guest).toHaveURL(/\/checkout\/fake\?.*acct=fakeacct_/);
    await guest.getByRole('button', { name: /^Pay/ }).click();
    await expect(guest).toHaveURL(/\/orders\/[A-Za-z0-9_-]{43}$/);
    await expect(guest.getByText('Paid', { exact: true })).toBeVisible();
    await expect(guest.getByText(/^Sold by (?!Pani)/)).toBeVisible();
  });
});
