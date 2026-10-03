import { expect, test } from '@playwright/test';
import { continueToPayment, expectAccessible, pickOption, signIn } from './helpers.ts';

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

/**
 * Receivables on the settlement view (M1.6e): a refund after the organizer's funds were released
 * (platform_mor) takes the organizer's share from the event's reserve, and the rest is owed —
 * shown on Payouts until the next payout nets it.
 */
test.describe('receivables (M1.6e)', () => {
  test('a refund after release shows as a receivable on the settlement view', async ({ page, browser }) => {
    test.setTimeout(90_000);
    const stamp = `${Date.now()}${test.info().project.name.slice(0, 1)}`;
    const pass = `Released ${stamp}`;
    const buyer = `Rae Receivable ${stamp}`;
    await signIn(page);
    // An event of its own: a refund draws on the event's held funds first, so a parallel test's
    // purchase on a shared event after the release would cover it and no receivable would appear.
    const eventName = `Receivable Night ${stamp}`;
    await page.goto('/o/lakeside-events/events/new');
    await page.getByLabel('Event name', { exact: true }).fill(eventName);
    await pickOption(page.getByLabel('Time zone'), 'America/Chicago');
    await page.getByLabel('Starts', { exact: true }).fill(chicago(-1));
    await page.getByLabel('Ends', { exact: true }).fill(chicago(3));
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
    const base = new URL(page.url()).pathname;
    const slug = base.split('/').at(-1);
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();
    await page.goto(`${base}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill(pass);
    await page.getByLabel('Price (USD)').fill('40');
    await page.getByLabel('Quantity available').fill('5');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: pass })).toBeVisible();

    const guest = await (await browser.newContext()).newPage();
    await guest.goto(`/events/${slug}`);
    await pickOption(guest.getByLabel(`Quantity — ${pass}`), '2');
    await guest.getByLabel('Full name').fill(buyer);
    await guest.getByLabel('Email for your tickets').fill(`rae+${stamp}@example.test`);
    await continueToPayment(guest, `rae+${stamp}@example.test`);
    await guest.getByRole('button', { name: /^Pay/ }).click();
    await expect(guest).toHaveURL(/\/orders\/[A-Za-z0-9_-]{43}$/);

    // The release job runs after the event (dev route; the worker does it every 10 minutes).
    const res = await page.request.post('/api/dev/payments/settle', {
      form: { org: 'lakeside-events', now: '2035-01-01T00:00:00Z' },
    });
    expect(res.status()).toBe(200);

    // Refund one ticket after release.
    await page.reload();
    await page.getByRole('link', { name: buyer }).click();
    const form = page.getByRole('region', { name: 'Refund', exact: true });
    await pickOption(form.getByLabel('Reason'), 'duplicate');
    await form
      .getByRole('checkbox', { name: new RegExp(`#\\d+ · ${pass}`) })
      .first()
      .check();
    await form.getByRole('button', { name: 'Refund' }).click();
    await expect(form.getByText(/^Refunded\./)).toBeVisible();

    await page.goto('/o/lakeside-events/payouts');
    const receivables = page.getByRole('region', { name: 'Receivables' });
    const history = receivables.getByRole('table', { name: 'Receivable history' });
    await expect(history.getByText(`Refund after payout · ${eventName}`)).toBeVisible();
    // Still owed — or already taken from a later payout (another run's release may have netted it).
    await expect(
      receivables
        .getByText('Taken from your next payout')
        .or(history.getByText('Taken from a payout'))
        .first(),
    ).toBeVisible();
    // The release it came after is on the same page.
    await expect(page.getByRole('region', { name: 'Settlements' }).getByRole('table')).toBeVisible();
    await expectAccessible(page);

    await page.goto('/ar/o/lakeside-events/payouts');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'المستحقات' })).toBeVisible();
    await expectAccessible(page);
  });

  test('viewers see no receivables or settlements', async ({ page }) => {
    await signIn(page, 'jordan@lakeside.test');
    await page.goto('/o/lakeside-events/payouts');
    await expect(page.getByRole('heading', { name: 'Payouts', level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Receivables' })).toHaveCount(0);
  });
});
