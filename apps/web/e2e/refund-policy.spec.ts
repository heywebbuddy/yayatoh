import { type Browser, expect, type Page, test } from '@playwright/test';
import { continueToPayment, expectAccessible, signIn } from './helpers.ts';

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

/** A published event three days out, with one paid pass; returns its console path and slug. */
async function eventWithPass(page: Page, name: string, pass: string) {
  await page.goto('/o/lakeside-events/events/new');
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Time zone').selectOption('America/Chicago');
  await page.getByLabel('Starts', { exact: true }).fill(chicago(72));
  await page.getByLabel('Ends', { exact: true }).fill(chicago(75));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill(pass);
  await page.getByLabel('Price (USD)').fill('20');
  await page.getByLabel('Quantity available').fill('10');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: pass })).toBeVisible();
  return { base, slug: base.split('/').pop() ?? '' };
}

async function buy(browser: Browser, slug: string, pass: string, buyer: string, email: string) {
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/events/${slug}`);
  await guest.getByLabel(`Quantity — ${pass}`).selectOption('2');
  await guest.getByLabel('Full name').fill(buyer);
  await guest.getByLabel('Email for your tickets').fill(email);
  await continueToPayment(guest, email);
  await guest.getByRole('button', { name: /^Pay/ }).click();
  await expect(guest).toHaveURL(/\/orders\/[A-Za-z0-9_-]{43}$/);
  return guest;
}

test.describe('refund policy (M1.6e)', () => {
  test('an organizer sets a policy; buyers see it on the event and order pages; a refund outside it is refused, then overridden', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const stamp = `${Date.now()}${test.info().project.name.slice(0, 1)}`;
    const pass = `Policy pass ${stamp}`;
    const buyer = `Pat Policy ${stamp}`;
    await signIn(page);
    const { base, slug } = await eventWithPass(page, `Policy ${stamp}`, pass);

    // Not set yet: refunds are at the organizer's discretion and buyers see nothing.
    const section = page.getByRole('region', { name: 'Refund policy' });
    await expect(section.getByText(/No refund policy is set/)).toBeVisible();
    await expect(section.getByLabel('No policy (at your discretion)')).toBeChecked();

    // Server validation: an impossible number of days (the browser's own check is bypassed).
    await section.getByLabel('Until a number of days before the event').check();
    await section.getByLabel('Days before the event', { exact: true }).fill('400');
    await section.locator('form').evaluate((f: HTMLFormElement) => {
      f.noValidate = true;
    });
    await section.getByRole('button', { name: 'Save refund policy' }).click();
    await expect(section.getByText('Enter a number of days from 0 to 365.')).toBeVisible();

    // Keyboard only: choose "until", 7 days, 2.00 kept per ticket, save.
    await section.getByLabel('Until a number of days before the event').focus();
    await page.keyboard.press('Space');
    await section.getByLabel('Days before the event', { exact: true }).focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('7');
    await page.keyboard.press('Tab');
    await expect(section.getByLabel('Kept per refunded ticket (USD, optional)')).toBeFocused();
    await page.keyboard.type('2');
    await section.getByRole('button', { name: 'Save refund policy' }).focus();
    await page.keyboard.press('Enter');
    await expect(section.getByText('Refund policy saved.')).toBeVisible();
    await expect(section.getByText(/^Refunds are available on request until /)).toBeVisible();
    await expect(section.getByText('$2.00 per ticket is kept by the organizer.')).toBeVisible();
    await expectAccessible(page);

    // It persists.
    await page.reload();
    await expect(section.getByLabel('Until a number of days before the event')).toBeChecked();
    await expect(section.getByLabel('Days before the event', { exact: true })).toHaveValue('7');

    // The buyer reads it before buying and on their order page.
    const guest = await buy(browser, slug, pass, buyer, `pat+${stamp}@example.test`);
    const onOrder = guest.getByRole('region', { name: 'Refund policy' });
    await expect(onOrder.getByText(/^Refunds are available on request until /)).toBeVisible();
    await expect(onOrder.getByText(/you get a full refund including fees/)).toBeVisible();
    await expectAccessible(guest);
    await guest.goto(`/events/${slug}`);
    const onEvent = guest.getByRole('region', { name: 'Refund policy' });
    await expect(onEvent.getByText('$2.00 per ticket is kept by the organizer.')).toBeVisible();
    await expectAccessible(guest);

    // The event is 3 days away: "until 7 days before" has closed. A buyer's request is refused.
    await page.goto(`${base}/tickets-orders`);
    await page.getByRole('link', { name: buyer }).click();
    const form = page.getByRole('region', { name: 'Refund', exact: true });
    await expect(form.getByText(/^Refunds are available on request until /)).toBeVisible();
    await form.getByLabel('Reason').selectOption('requested_by_customer');
    await form
      .getByRole('checkbox', { name: new RegExp(`#\\d+ · ${pass}`) })
      .first()
      .check();
    await form.getByRole('button', { name: 'Refund' }).click();
    await expect(
      form.getByText(/^The event’s refund policy closed on .+\. Refunds on request are no longer allowed\.$/),
    ).toBeVisible();
    await expectAccessible(page);

    // The owner overrides it; the note is required. (The form was reset after the refusal.)
    await form
      .getByRole('checkbox', { name: new RegExp(`#\\d+ · ${pass}`) })
      .first()
      .check();
    await form.getByLabel('Refund outside the refund policy').check();
    await expect(form.getByLabel('Why is the policy overridden? (required)')).toBeVisible();
    await form
      .getByLabel('Why is the policy overridden? (required)')
      .fill('Family emergency, approved by Pani');
    await form.getByRole('button', { name: 'Refund' }).click();
    await expect(form.getByText(/^Refunded\./)).toBeVisible();
    const refunds = page.getByRole('table', { name: 'Refunds' });
    await expect(refunds.getByText('Outside policy')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('table', { name: 'Refunds' }).getByText('Outside policy')).toBeVisible();

    // The platform minimum still refunds in full, without an override.
    const again = page.getByRole('region', { name: 'Refund', exact: true });
    await again.getByLabel('Reason').selectOption('event_cancelled');
    await again
      .getByRole('checkbox', { name: new RegExp(`#\\d+ · ${pass}`) })
      .first()
      .check();
    await again.getByRole('button', { name: 'Refund' }).click();
    // Fully refunded now: both tickets void, the form is gone.
    await expect(page.getByRole('table', { name: 'Tickets' }).getByText('Void')).toHaveCount(2);
    await expect(page.getByRole('table', { name: 'Refunds' }).getByText('Event cancelled')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Refund', exact: true })).toHaveCount(0);

    // Arabic, right to left.
    await page.goto(`/ar${base}/tickets-orders`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'سياسة الاسترداد' })).toBeVisible();
    await expectAccessible(page);
  });

  test('finance refunds but cannot override or edit the policy; viewers see the policy only', async ({
    page,
  }) => {
    await signIn(page, 'fran@lakeside.test');
    await page.goto('/o/lakeside-events/e/lakeside-open-house/tickets-orders');
    const section = page.getByRole('region', { name: 'Refund policy' });
    await expect(section).toBeVisible();
    await expect(section.getByRole('button', { name: 'Save refund policy' })).toHaveCount(0);
    const first = page.getByRole('table', { name: 'Orders' }).getByRole('link').first();
    if ((await first.count()) > 0) {
      await first.click();
      await expect(page.getByLabel('Refund outside the refund policy')).toHaveCount(0);
    }
    await signIn(page, 'jordan@lakeside.test');
    await page.goto('/o/lakeside-events/e/lakeside-open-house/tickets-orders');
    await expect(page.getByRole('region', { name: 'Refund policy' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save refund policy' })).toHaveCount(0);
  });
});
