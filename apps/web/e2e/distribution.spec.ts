import { expect, test } from '@playwright/test';
import { continueToPayment, expectAccessible, pickOption, signIn } from './helpers.ts';

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

test.describe('ticket distribution', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('an organizer sends a ticket; the guest claims it; the old QR is rejected; the holder passes it on', async ({
    page,
    browser,
  }) => {
    const stamp = Date.now();
    await signIn(page);
    await page.goto('/o/lakeside-events/events/new');
    await page.getByLabel('Event name', { exact: true }).fill(`Gala ${stamp}`);
    await pickOption(page.getByLabel('Time zone'), 'America/Chicago');
    await page.getByLabel('Starts', { exact: true }).fill(chicago(-1));
    await page.getByLabel('Ends', { exact: true }).fill(chicago(3));
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/gala-\d+$/);
    const base = new URL(page.url()).pathname;
    const slug = base.split('/').pop() ?? '';
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();
    await page.goto(`${base}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill('Table seat');
    await page.getByLabel('Price (USD)').fill('0');
    await page.getByLabel('Quantity available').fill('10');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Table seat' })).toBeVisible();

    // A company books two seats.
    const buyer = await (await browser.newContext()).newPage();
    await buyer.goto(`/events/${slug}`);
    await pickOption(buyer.getByLabel('Quantity — Table seat'), '2');
    await buyer.getByLabel('Full name').fill(`Acme ${stamp}`);
    await buyer.getByLabel('Email for your tickets').fill(`acme.${stamp}@example.test`);
    await continueToPayment(buyer, `acme.${stamp}@example.test`);
    await expect(buyer).toHaveURL(/\/orders\//);
    const orderUrl = buyer.url();
    const before = (await buyer.locator('.tracking-\\[0\\.2em\\]').allTextContents()).map((c) => c.trim());

    // The organizer sends one seat to a guest from the attendee profile.
    await page.goto(`${base}/attendees`);
    await page
      .getByRole('row')
      .filter({ hasText: `Acme ${stamp}` })
      .first()
      .getByRole('link')
      .click();
    const profile = page.getByRole('complementary', { name: 'Profile' });
    await profile.getByRole('button', { name: 'Create link' }).click();
    const link = await profile.getByTestId('claim-link').inputValue();
    expect(link).toMatch(/\/claim\/[0-9a-f-]{36}~/);
    await expectAccessible(page);

    // The guest claims it and sees their own ticket.
    const guest = await (await browser.newContext()).newPage();
    await guest.goto(new URL(link).pathname);
    await expect(guest.getByRole('heading', { name: `Gala ${stamp}` })).toBeVisible();
    await expectAccessible(guest);
    await guest.getByLabel('Full name').fill(`Gwen ${stamp}`);
    await guest.getByLabel('Email', { exact: true }).fill(`gwen.${stamp}@example.test`);
    await guest.getByRole('button', { name: 'Claim ticket' }).click();
    await expect(guest).toHaveURL(/\/my-tickets\//);
    await expect(guest.getByText(`Tickets for gwen.${stamp}@example.test`)).toBeVisible();
    await expect(guest.getByRole('img', { name: /QR code for ticket number/ })).toHaveCount(1);
    await expect(guest.getByText(`Gwen ${stamp}`)).toBeVisible();
    await expectAccessible(guest);

    // The link can't be used twice.
    const again = await (await browser.newContext()).newPage();
    await again.goto(new URL(link).pathname);
    await expect(again.getByText('This ticket has already been claimed')).toBeVisible();

    // The buyer's page no longer shows that seat.
    await buyer.goto(orderUrl);
    await expect(buyer.getByText('1 ticket from this order was passed on to someone else.')).toBeVisible();
    await expect(buyer.getByRole('img', { name: /QR code for ticket number/ })).toHaveCount(1);

    // At the door the buyer's old code for that seat is refused (it was reissued).
    await page.goto(`${base}/onsite`);
    const field = page.getByLabel('Ticket code');
    const result = page.getByRole('status').filter({ has: page.locator('[data-result]') });
    const kept = (await buyer.locator('.tracking-\\[0\\.2em\\]').allTextContents()).map((c) => c.trim());
    const passedOn = before.find((c) => !kept.includes(c)) ?? '';
    const guestCode = (await guest.locator('.tracking-\\[0\\.2em\\]').first().textContent())?.trim() ?? '';
    // Claiming gave the seat a new short code: the one printed on the buyer's copy is refused.
    expect(guestCode).not.toBe(passedOn);
    await field.fill(passedOn);
    await field.press('Enter');
    await expect(result).toContainText('Not a valid ticket');
    await field.fill(guestCode);
    await field.press('Enter');
    await expect(result).toContainText('Welcome in');

    // The new holder passes it on again from their page.
    await guest.getByRole('button', { name: 'Create link' }).click();
    await expect(guest.getByTestId('claim-link')).toHaveValue(/\/claim\//);

    // "Already have tickets?" never says whether an email has tickets.
    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto(`/events/${slug}`);
    await visitor.getByLabel('Email', { exact: true }).fill(`nobody.${stamp}@example.test`);
    await visitor.getByRole('button', { name: 'Email me a link' }).click();
    await expect(
      visitor.getByText('If that email has tickets for this event, a link is on its way.'),
    ).toBeVisible();
  });
});
