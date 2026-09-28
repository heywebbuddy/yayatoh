import { type Browser, expect, type Page, test } from '@playwright/test';
import { expectAccessible, OPEN_HOUSE, signIn } from './helpers.ts';

/**
 * M3.10b refund operations in the browser: buyers ask for refunds from their order page and the
 * organizer answers from the queue (decline with a reason, approve through the refund flow); the
 * unified order timeline with notes; a policy tightened after sales reaches only later orders;
 * the cancel wizard's money preview and a small mass refund paused and resumed; postponing;
 * viewers kept out. Every test makes its own event (seeded events are never cancelled).
 */
const VIEWER = 'jordan@lakeside.test';

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

/** A published event ten days out with one paid pass and a refund policy; its console path and slug. */
async function eventWithPass(
  page: Page,
  name: string,
  pass: string,
  policy: 'Always' | 'No refunds' = 'Always',
) {
  await page.goto('/o/lakeside-events/events/new');
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Time zone').selectOption('America/Chicago');
  await page.getByLabel('Starts', { exact: true }).fill(chicago(240));
  await page.getByLabel('Ends', { exact: true }).fill(chicago(243));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill(pass);
  await page.getByLabel('Price (USD)').fill('20');
  await page.getByLabel('Quantity available').fill('20');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: pass })).toBeVisible();
  await setPolicy(page, policy);
  return { base, slug: base.split('/').pop() ?? '' };
}

async function setPolicy(page: Page, policy: 'Always' | 'No refunds') {
  const section = page.getByRole('region', { name: 'Refund policy' });
  await section.getByLabel(policy, { exact: true }).check();
  await section.getByRole('button', { name: 'Save refund policy' }).click();
  return section;
}

async function buy(browser: Browser, slug: string, pass: string, buyer: string, email: string, quantity = 1) {
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/events/${slug}`);
  await guest.getByLabel(`Quantity — ${pass}`).selectOption(String(quantity));
  await guest.getByLabel('Full name').fill(buyer);
  await guest.getByLabel('Email for your tickets').fill(email);
  await guest.getByRole('button', { name: 'Continue to payment' }).click();
  await guest.getByRole('button', { name: /^Pay/ }).click();
  await expect(guest).toHaveURL(/\/orders\/[A-Za-z0-9_-]{43}$/);
  return guest;
}

test.describe('refund operations (M3.10b)', () => {
  test('a buyer asks for a refund; the organizer declines, then approves; the timeline and notes tell the story', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const stamp = `${Date.now()}${test.info().project.name.slice(0, 1)}`;
    const pass = `Request pass ${stamp}`;
    const buyer = `Rory Request ${stamp}`;
    await signIn(page);
    const { base, slug } = await eventWithPass(page, `Requests ${stamp}`, pass);
    const guest = await buy(browser, slug, pass, buyer, `rory+${stamp}@example.test`, 2);

    // The buyer asks for one of their two tickets, by keyboard, with a message.
    const refund = guest.getByRole('region', { name: 'Refund', exact: true });
    await expect(refund.getByText(/^Can’t make it\? Ask the organizer for a refund/)).toBeVisible();
    const boxes = refund.getByRole('checkbox');
    await expect(boxes).toHaveCount(2);
    await boxes.nth(1).focus();
    await guest.keyboard.press('Space');
    await expect(boxes.nth(1)).not.toBeChecked();
    await refund.getByLabel('Message to the organizer (optional)').fill('My sister cannot come.');
    await refund.getByRole('button', { name: 'Ask for a refund' }).focus();
    await guest.keyboard.press('Enter');
    // The page shows where the request stands at once (and after a reload).
    const asked = /^You asked for a refund on .+\. The organizer answers within 5 business days\.$/;
    await expect(refund.getByText(asked)).toBeVisible();
    await guest.reload();
    await expect(
      refund.getByText(/^You asked for a refund on .+\. The organizer answers within 5 business days\.$/),
    ).toBeVisible();
    await expect(refund.getByRole('button', { name: 'Ask for a refund' })).toHaveCount(0);
    await expectAccessible(guest);

    // The queue: waiting, on time, one ticket; it opens the order.
    await page.goto('/o/lakeside-events/refund-requests');
    await expect(page.getByRole('heading', { name: 'Refund requests', level: 1 })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: buyer });
    await expect(row.getByText('1 ticket')).toBeVisible();
    await expect(row.getByText('On time')).toBeVisible();
    await expectAccessible(page);
    await row.getByRole('link', { name: buyer }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/orders/[0-9a-f-]{36}$`));
    const request = page.getByRole('region', { name: 'Refund request' });
    await expect(request.getByText('My sister cannot come.')).toBeVisible();

    // Declining needs a reason (the server says so when the browser's own check is bypassed).
    const decline = request
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Decline request' }) });
    await decline.evaluate((f: HTMLFormElement) => {
      f.noValidate = true;
    });
    await decline.getByLabel('Reason (sent to the buyer)').fill('no');
    await decline.getByRole('button', { name: 'Decline request' }).click();
    await expect(decline.getByText('Give a reason of 3 to 500 characters.')).toBeVisible();
    await decline
      .getByLabel('Reason (sent to the buyer)')
      .fill('Please pass the ticket on to a friend instead.');
    await decline.getByRole('button', { name: 'Decline request' }).click();
    // Answered: the request stays in view with its outcome.
    await expect(
      request.getByText(/^Declined .+: “Please pass the ticket on to a friend instead\.”$/),
    ).toBeVisible();
    await expectAccessible(page);

    // The buyer sees why, and asks again for both tickets.
    await guest.reload();
    await expect(refund.getByText(/^Your refund request was declined on /)).toBeVisible();
    await expect(
      refund.getByText('The organizer said: “Please pass the ticket on to a friend instead.”'),
    ).toBeVisible();
    await refund.getByRole('button', { name: 'Ask for a refund' }).click();
    await expect(refund.getByText(asked)).toBeVisible();

    // The organizer approves the tickets asked for: refunded, both tickets void.
    await page.reload();
    await expect(page.getByRole('region', { name: 'Refund request' }).getByText('2 tickets')).toBeVisible();
    await page
      .getByRole('region', { name: 'Refund request' })
      .getByRole('button', { name: 'Approve and refund' })
      .click();
    // Answered: the request shows its outcome, and no answer buttons are left.
    const answered = page.getByRole('region', { name: 'Refund request' });
    await expect(answered.getByText(/^Approved .+\.$/)).toBeVisible();
    await page.reload();
    await expect(answered.getByRole('button', { name: 'Approve and refund' })).toHaveCount(0);
    await expect(page.getByRole('table', { name: 'Tickets' }).getByText('Void')).toHaveCount(2);
    await expect(page.getByRole('table', { name: 'Refunds' }).getByText('The buyer asked')).toBeVisible();

    // The timeline, oldest first, in the event's time zone; a note added by keyboard joins it.
    const timeline = page.getByRole('region', { name: 'Timeline' });
    await expect(timeline.getByText('Times are in the event’s time zone (America/Chicago).')).toBeVisible();
    const items = timeline.getByRole('listitem');
    await expect(items.first()).toContainText('Order placed');
    for (const text of [
      'Payment received',
      'Ticket #',
      'The buyer asked for a refund',
      'Refund request declined',
      'Refund request approved',
      'Refund completed',
    ])
      await expect(timeline.getByText(text).first()).toBeVisible();
    await expect(timeline.getByText('“Please pass the ticket on to a friend instead.”')).toBeVisible();
    await timeline.getByLabel('Add a note for your team').focus();
    await page.keyboard.type('Called Rory to confirm the refund.');
    await timeline.getByRole('button', { name: 'Add note' }).focus();
    await page.keyboard.press('Enter');
    await expect(timeline.getByText('Note added.')).toBeVisible();
    await expect(items.last()).toContainText('Called Rory to confirm the refund.');
    await expectAccessible(page);

    // The buyer: approved.
    await guest.reload();
    await expect(refund.getByText(/^Your refund request was approved on /)).toBeVisible();

    // Answered requests list, and the queue in Arabic, right to left.
    await page.goto('/o/lakeside-events/refund-requests?status=approved');
    await expect(page.getByRole('row').filter({ hasText: buyer })).toBeVisible();
    await page.goto('/ar/o/lakeside-events/refund-requests');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'طلبات الاسترداد', level: 1 })).toBeVisible();
    await expectAccessible(page);
  });

  test('a stricter policy reaches only orders placed after it', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const stamp = `${Date.now()}${test.info().project.name.slice(0, 1)}`;
    const pass = `Tighten pass ${stamp}`;
    await signIn(page);
    const { slug } = await eventWithPass(page, `Tighten ${stamp}`, pass, 'Always');
    const early = await buy(browser, slug, pass, `Early ${stamp}`, `early+${stamp}@example.test`);

    // Tighten to "no refunds" after a sale: the organizer is told who keeps their terms.
    const section = await setPolicy(page, 'No refunds');
    await expect(
      section.getByText(
        'Stricter policy saved. It applies to orders placed from now on; 1 order already sold keeps the terms it was bought under.',
      ),
    ).toBeVisible();
    await expect(
      section.getByText(/^A stricter policy applies only to orders placed from now on/),
    ).toBeVisible();
    await expectAccessible(page);

    // The early buyer still has the policy they bought under, and may ask.
    await early.reload();
    await expect(
      early
        .getByRole('region', { name: 'Refund policy' })
        .getByText('Refunds are available on request at any time.'),
    ).toBeVisible();
    await expect(
      early
        .getByRole('region', { name: 'Refund', exact: true })
        .getByRole('button', { name: 'Ask for a refund' }),
    ).toBeVisible();

    // A later buyer bought under "no refunds": no request possible.
    const later = await buy(browser, slug, pass, `Later ${stamp}`, `later+${stamp}@example.test`);
    await expect(
      later
        .getByRole('region', { name: 'Refund policy' })
        .getByText('Tickets are not refundable on request.'),
    ).toBeVisible();
    const refund = later.getByRole('region', { name: 'Refund', exact: true });
    await expect(
      refund.getByText('This event’s refund policy does not allow refunds on request.'),
    ).toBeVisible();
    await expect(refund.getByRole('button', { name: 'Ask for a refund' })).toHaveCount(0);
    await expectAccessible(later);
  });

  test('cancel wizard: the money first, then a mass refund paused, resumed and reconciled', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const stamp = `${Date.now()}${test.info().project.name.slice(0, 1)}`;
    const pass = `Cancel pass ${stamp}`;
    await signIn(page);
    const { base, slug } = await eventWithPass(page, `Cancel ${stamp}`, pass);
    const guests: Page[] = [];
    for (const n of ['Ada', 'Ben', 'Cy'])
      guests.push(
        await buy(browser, slug, pass, `${n} ${stamp}`, `${n.toLowerCase()}+${stamp}@example.test`),
      );

    // From the event home, choose by keyboard.
    await page.goto(base);
    await page.getByRole('link', { name: 'Cancel or postpone' }).click();
    await expect(page.getByRole('heading', { name: 'Cancel or postpone', level: 1 })).toBeVisible();
    await page.getByLabel(/^Cancel it and refund every buyer/).focus();
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Continue' }).focus();
    await page.keyboard.press('Enter');

    // The preview: three paid orders, all refunded in full; nothing has changed yet.
    const preview = page.getByRole('region', { name: 'The money' });
    await expect(preview.getByText('Paid orders')).toBeVisible();
    const table = preview.getByRole('table', { name: 'Refunds by how the orders were charged' });
    await expect(table.getByRole('row').filter({ hasText: 'Total' })).toContainText('3');
    await expectAccessible(page);
    await page.goto(base);
    await expect(page.getByText('Published ·')).toBeVisible();

    // Confirm (required) and start.
    await page.goto(`${base}/cancel?step=cancel`);
    await page.getByLabel(/^I understand:/).check();
    await page.getByRole('button', { name: 'Cancel event and refund' }).click();
    await expect(page).toHaveURL(/\/cancel\?run=[0-9a-f-]{36}$/);
    const runId = new URL(page.url()).searchParams.get('run') ?? '';
    const run = page.getByRole('region', { name: 'Refunding buyers' });
    await expect(run.getByText('0 of 3 orders')).toBeVisible();
    await expect(run.getByText('Running')).toBeVisible();

    const work = async (limit?: number) => {
      const res = await page.request.post('/api/dev/mass-refunds/run', {
        form: { org: 'lakeside-events', run: runId, ...(limit ? { limit: String(limit) } : {}) },
      });
      expect(res.ok()).toBe(true);
    };

    // Paused: the batch job does nothing.
    await run.getByRole('button', { name: 'Pause' }).click();
    await expect(run.getByText('Paused', { exact: true })).toBeVisible();
    await work();
    await page.reload();
    await expect(run.getByText('0 of 3 orders')).toBeVisible();
    await expectAccessible(page);

    // Resumed: one order, then the rest.
    await run.getByRole('button', { name: 'Resume' }).click();
    await expect(run.getByText('Running')).toBeVisible();
    await work(1);
    await page.reload();
    await expect(run.getByText('1 of 3 orders')).toBeVisible();
    await work();
    await page.reload();
    await expect(run.getByText('3 of 3 orders')).toBeVisible();
    await expect(run.getByText('Finished')).toBeVisible();
    await expect(run.getByText(/^Reconciled: the books moved exactly what was refunded/)).toBeVisible();
    await expect(run.getByRole('button', { name: 'Pause' })).toHaveCount(0);
    await expectAccessible(page);

    // Buyers see their refunds.
    for (const g of guests) {
      await g.reload();
      await expect(g.getByText('Refunded', { exact: true }).first()).toBeVisible();
    }

    // Arabic, right to left.
    await page.goto(`/ar${base}/cancel`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'إلغاء أو تأجيل', level: 1 })).toBeVisible();
    await expectAccessible(page);
  });

  test('postponing keeps tickets valid and emails the buyer', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const stamp = `${Date.now()}${test.info().project.name.slice(0, 1)}`;
    const pass = `Postpone pass ${stamp}`;
    const email = `pia+${stamp}@example.test`;
    await signIn(page);
    const { base, slug } = await eventWithPass(page, `Postpone ${stamp}`, pass);
    const guest = await buy(browser, slug, pass, `Pia ${stamp}`, email);
    await page.goto(`${base}/cancel`);
    await page.getByLabel(/^Postpone it/).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(/^Tickets stay valid\. Every buyer who holds one is emailed/)).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Postpone event' }).click();
    await expect(page.getByText(/^This event is postponed\./)).toBeVisible();
    // The ticket still works.
    await guest.reload();
    await expect(guest.getByRole('img', { name: /QR/ }).first()).toBeVisible();
    // The email.
    const drained = await page.request.post('/api/dev/outbox/drain', { form: { org: 'lakeside-events' } });
    expect(drained.ok()).toBe(true);
    await expect
      .poll(async () => {
        const res = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`);
        return ((await res.json()) as { subject: string }[]).map((m) => m.subject);
      })
      .toContain(`Postpone ${stamp} is postponed`);
  });

  test('viewers see the queue but cannot answer, cancel or postpone', async ({ page }) => {
    await signIn(page, VIEWER);
    await page.goto('/o/lakeside-events/refund-requests');
    await expect(page.getByRole('heading', { name: 'Refund requests', level: 1 })).toBeVisible();
    await page.goto(OPEN_HOUSE);
    await expect(page.getByRole('link', { name: 'Cancel or postpone' })).toHaveCount(0);
    const res = await page.goto(`${OPEN_HOUSE}/cancel`);
    expect(res?.status()).toBe(404);
    const again = await page.goto(`${OPEN_HOUSE}/cancel?step=cancel`);
    expect(again?.status()).toBe(404);
  });
});
