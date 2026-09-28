import { type Browser, expect, type Page, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';

/**
 * M1.9e fraud signals: checkout risk and chat reports join the door's signals in one model (via
 * the outbox, drained here as the worker would), shown on the order timeline and the event's
 * Signals list, alerted to the team, triaged with a note, and flagged to the door when a scanned
 * ticket has open high-severity signals.
 */
const VIEWER = 'jordan@lakeside.test';

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

/** Run the org's outbox through the subscribers (signals, alerts), as the worker does. */
async function drain(page: Page) {
  const res = await page.request.post('/api/dev/outbox/drain', { form: { org: 'lakeside-events' } });
  expect(res.ok()).toBe(true);
}

/**
 * Open the notifications list until the alert shows: parallel projects drain the same org, so
 * another drain may be the one that turns the signal into the alert a moment later.
 */
async function findAlert(page: Page, name: string) {
  const alert = page.getByRole('link', { name });
  await expect(async () => {
    await drain(page);
    await page.goto('/o/lakeside-events/notifications');
    await expect(alert).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 45_000 });
  return alert;
}

/** A live event (doors open now) with a free pass; returns its console path and name. */
async function liveEvent(page: Page, name: string) {
  await page.goto('/o/lakeside-events/events/new');
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Time zone').selectOption('America/Chicago');
  await page.getByLabel('Starts', { exact: true }).fill(chicago(-1));
  await page.getByLabel('Ends', { exact: true }).fill(chicago(3));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill('Door pass');
  await page.getByLabel('Price (USD)').fill('0');
  await page.getByLabel('Quantity available').fill('20');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Door pass' })).toBeVisible();
  return base;
}

/**
 * One buyer orders five times within the hour: the fifth checkout trips the order-velocity
 * review rule (M1.6e), so it is sold and flagged. Returns the ticket codes of the first and the
 * flagged order.
 */
async function risky(browser: Browser, base: string, stamp: string) {
  const guest = await (await browser.newContext()).newPage();
  const email = `rapid.${stamp}@example.test`;
  const codes: string[] = [];
  for (let i = 0; i < 5; i++) {
    await guest.goto(`/events/${base.split('/').pop()}`);
    await guest.getByLabel('Quantity — Door pass').selectOption('1');
    await guest.getByLabel('Full name').fill(`Rapid ${stamp}`);
    await guest.getByLabel('Email for your tickets').fill(email);
    await guest.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(guest).toHaveURL(/\/orders\//);
    codes.push(((await guest.locator('.tracking-\\[0\\.2em\\]').first().textContent()) ?? '').trim());
  }
  await guest.context().close();
  return { first: codes[0] as string, flagged: codes[4] as string, buyer: `Rapid ${stamp}` };
}

test.describe('fraud signals: checkout risk on the order timeline', () => {
  test('a risky checkout shows on the order and alerts the team; triage with a note; the viewer only reads', async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(150_000);
    const stamp = `${Date.now()}-${info.project.name}`;
    const name = `Risky ${stamp}`;
    await signIn(page);
    const base = await liveEvent(page, name);
    const { buyer } = await risky(browser, base, stamp);
    await drain(page);

    // The alert: in the notifications list, linking to the flagged order.
    const alert = await findAlert(page, `Fraud alert: many orders from one buyer · ${name}`);
    await expectAccessible(page);
    await alert.click();
    await expect(page).toHaveURL(new RegExp(`${base}/orders/[0-9a-f-]{36}$`));
    const orderUrl = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { name: `Order from ${buyer}` })).toBeVisible();

    // The order timeline: one open, high-severity checkout signal.
    const timeline = page.getByRole('region', { name: 'Signals' });
    const signal = timeline.locator('[data-signal="purchase_velocity"]');
    await expect(signal).toContainText('Many orders from one buyer');
    await expect(signal).toContainText('Many orders from this email in an hour');
    await expect(signal).toContainText('High');
    await expect(signal).toContainText('At checkout');
    await expect(signal.locator('[data-signal-status]')).toHaveText('Open');
    await expectAccessible(page);

    // Dismissing needs a reason: refused without one (and the request is kept for the viewer).
    const [dismissRequest] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'POST' && Boolean(r.headers()['next-action'])),
      signal.getByRole('button', { name: /^Dismiss: Many orders from one buyer/ }).click(),
    ]);
    const note = signal.getByLabel('Note', { exact: true });
    await expect(signal.getByText("Say why you're dismissing it (at least 3 characters).")).toBeVisible();
    await expect(note).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page);

    // The viewer: sees the timeline read-only (no note, no buttons)…
    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(orderUrl);
    const theirs = viewer
      .getByRole('region', { name: 'Signals' })
      .locator('[data-signal="purchase_velocity"]');
    await expect(theirs).toContainText('Many orders from one buyer');
    await expect(theirs.getByRole('button')).toHaveCount(0);
    await expect(theirs.getByLabel('Note', { exact: true })).toHaveCount(0);
    await expectAccessible(viewer);
    // …and is refused when replaying the triage action with their own session.
    // Form fields carry React's reply prefix (`_1_note`).
    const body = (dismissRequest.postData() ?? '').replace(
      /(name="(?:_?\d+_)?note"\r\n\r\n)[^\r]*/,
      '$1Not mine',
    );
    expect(body).toContain('Not mine');
    const res = await viewer.request.post(orderUrl, {
      headers: {
        'next-action': dismissRequest.headers()['next-action'] ?? '',
        'content-type': dismissRequest.headers()['content-type'] ?? '',
        accept: 'text/x-component',
      },
      data: body,
    });
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('"forbidden"');
    await viewer.reload();
    await expect(theirs.locator('[data-signal-status]')).toHaveText('Open');
    await viewer.context().close();

    // Keyboard only: type the note, Enter acknowledges.
    await note.focus();
    await page.keyboard.type('Called the buyer: a company booking');
    await page.keyboard.press('Enter');
    await expect(signal.getByRole('status')).toHaveText('Acknowledged: the team can see someone is on it.');
    await expect(signal.locator('[data-signal-status]')).toHaveText('Acknowledged');
    await expect(signal).toContainText('Note: Called the buyer: a company booking');
    await expect(signal.getByRole('button')).toHaveCount(0);
    await page.reload();
    await expect(signal.locator('[data-signal-status]')).toHaveText('Acknowledged');
    await expect(signal).toContainText('Note: Called the buyer: a company booking');
    await expectAccessible(page);

    // Arabic, right to left.
    await page.goto(`/ar${orderUrl}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'الإشارات', level: 2 })).toBeVisible();
    await expect(page.locator('[data-signal="purchase_velocity"]')).toContainText('طلبات كثيرة من مشترٍ واحد');
    await expectAccessible(page);
  });

  test('an order with no signals says so', async ({ page, browser }, info) => {
    test.setTimeout(90_000);
    const stamp = `${Date.now()}-${info.project.name}`;
    await signIn(page);
    const base = await liveEvent(page, `Calm ${stamp}`);
    const guest = await (await browser.newContext()).newPage();
    await guest.goto(`/events/${base.split('/').pop()}`);
    await guest.getByLabel('Quantity — Door pass').selectOption('1');
    await guest.getByLabel('Full name').fill(`Calm ${stamp}`);
    await guest.getByLabel('Email for your tickets').fill(`calm.${stamp}@example.test`);
    await guest.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(guest).toHaveURL(/\/orders\//);
    await guest.context().close();
    await drain(page);
    await page.goto(`${base}/tickets-orders`);
    await page
      .getByRole('table', { name: 'Recent orders' })
      .getByRole('link', { name: `Calm ${stamp}` })
      .click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
    const timeline = page.getByRole('region', { name: 'Signals' });
    await expect(timeline).toContainText('No fraud signals about this order.');
    await expectAccessible(page);
  });
});

test.describe('fraud signals: at the door', () => {
  test('the door screen and the Scan PWA show a banner for a ticket with open high-severity signals', async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(150_000);
    const stamp = `${Date.now()}-${info.project.name}`;
    await signIn(page);
    const base = await liveEvent(page, `Door flag ${stamp}`);
    const { first, flagged } = await risky(browser, base, stamp);
    await drain(page);

    // The door screen: the flagged order's ticket gets the banner; an earlier order's doesn't.
    await page.goto(`${base}/onsite`);
    const field = page.getByLabel('Ticket code');
    const result = page.getByRole('status').filter({ has: page.locator('[data-result]') });
    await field.fill(flagged);
    await field.press('Enter');
    await expect(result).toContainText('Welcome in');
    await expect(result.getByTestId('signal-banner')).toContainText(
      '1 open high-severity signal on this ticket',
    );
    await expect(result.getByTestId('signal-banner')).toContainText(
      'Ask a supervisor before letting them in.',
    );
    await expectAccessible(page);
    await field.fill(first);
    await field.press('Enter');
    await expect(result).toContainText(`Rapid ${stamp}`);
    await expect(result).toContainText('Welcome in');
    await expect(result.getByTestId('signal-banner')).toHaveCount(0);

    // The Scan PWA (online): the server's answer carries the count.
    await page.getByLabel('Device name').fill(`Phone ${stamp}`);
    await page.getByRole('button', { name: 'Add device' }).click();
    const link = await page.getByTestId('scan-link').getAttribute('href');
    const device = await (await browser.newContext()).newPage();
    await device.goto(link ?? '');
    await expect(device.getByText(/tickets on this device/)).toBeVisible();
    const code = device.getByLabel('Ticket code');
    const shown = device.getByRole('status').filter({ has: device.locator('[data-result]') });
    await code.fill(flagged);
    await code.press('Enter');
    // Admitted at the door screen already: the server answers for the whole event.
    await expect(shown).toContainText('Checked in on another device first');
    await expect(shown).toContainText('Confirmed by the server');
    await expect(shown.getByTestId('signal-banner')).toContainText(
      '1 open high-severity signal on this ticket',
    );
    // Only the door's fields: the holder's name and pass, never the buyer's email.
    await expect(shown).not.toContainText('@example.test');
    await expectAccessible(device);

    // Arabic on the door screen, right to left.
    await page.goto(`/ar${base}/onsite`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByLabel('رمز التذكرة').fill(flagged);
    await page.getByLabel('رمز التذكرة').press('Enter');
    await expect(page.getByTestId('signal-banner')).toBeVisible();
    await expectAccessible(page);
    await device.context().close();
  });
});

test.describe('fraud signals: chat reports and the Signals list', () => {
  test('a chat abuse report raises a signal and an alert; the list filters by kind, severity and status by keyboard', async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(150_000);
    const stamp = `${Date.now()}${info.project.name.slice(0, 1)}`;
    const name = `Chat ${stamp}`;
    const guestName = `Cal ${stamp}`;
    await signIn(page);
    await page.goto('/o/lakeside-events/events/new');
    await page.getByLabel('Event name', { exact: true }).fill(name);
    await page.getByLabel('Starts', { exact: true }).fill('2027-11-01T18:00');
    await page.getByLabel('Ends', { exact: true }).fill('2027-11-01T22:00');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/chat-\d+/);
    const base = new URL(page.url()).pathname;

    // Empty Signals list first.
    await page.goto(`${base}/onsite/signals`);
    await expect(page.getByText('No signals', { exact: true })).toBeVisible();

    // A guest, an announcement, and the conversation it opens.
    await page.goto(`${base}/attendees`);
    await page
      .getByText(/^Add (attendee|guest)/i)
      .first()
      .click();
    await page.getByLabel('Full name').fill(guestName);
    await page.getByLabel('Email', { exact: true }).fill(`cal.${stamp}@example.test`);
    await page.getByRole('button', { name: 'Add to the list' }).click();
    await expect(page.getByRole('row').filter({ hasText: guestName })).toBeVisible();
    await page.goto(`${base}/marketing`);
    const composer = page.getByRole('form', { name: 'New announcement' });
    await composer.getByLabel('Subject').fill(`Doors ${stamp}`);
    await composer.getByLabel('Message').fill('Doors open at 7.');
    await composer.getByRole('button', { name: 'Preview' }).click();
    await page
      .getByRole('form', { name: 'Announcement preview' })
      .getByRole('button', { name: 'Send to 1 person' })
      .click();
    await expect(page.getByText('Sent to 1 person. Delivery continues in the background.')).toBeVisible();
    await drain(page);

    // The organizer reports the conversation as abusive.
    await page.goto('/o/lakeside-events/messages');
    await page.getByRole('link', { name: new RegExp(guestName) }).click();
    const safety = page.getByRole('region', { name: 'Block or report' });
    await safety.getByLabel('Reason').selectOption('abuse');
    await safety.getByRole('button', { name: 'Report to Yayatoh' }).click();
    await expect(safety.getByText('Thanks. Yayatoh will review this conversation.')).toBeVisible();
    await drain(page);

    // The alert, linking to the event's Signals list.
    const alert = await findAlert(page, `Fraud alert: a reported conversation · ${name}`);
    await alert.click();
    await expect(page).toHaveURL(new RegExp(`${base}/onsite/signals$`));
    const signal = page.locator('[data-signal="chat_abuse"]');
    await expect(signal).toContainText('Conversation reported · Reported as abusive');
    await expect(signal).toContainText('Chat report');
    await expect(signal).toContainText('High');
    await expect(signal.getByRole('link', { name: 'Open the conversation' })).toBeVisible();
    await expectAccessible(page);

    // Filter by keyboard: kind and severity match; a status with nothing shows the empty state.
    const filter = page.getByRole('form', { name: 'Filter signals' });
    await filter.getByLabel('Kind').focus();
    await filter.getByLabel('Kind').selectOption('chat_abuse');
    await filter.getByLabel('Severity').selectOption('high');
    await filter.getByRole('button', { name: 'Filter' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/kind=chat_abuse&severity=high/);
    await expect(page.getByText('1 signal matches the filter')).toBeVisible();
    await expect(page.locator('[data-signal]')).toHaveCount(1);
    await filter.getByLabel('Status').selectOption('dismissed');
    await filter.getByRole('button', { name: 'Filter' }).click();
    await expect(page.getByText('No signals match', { exact: true })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(page.locator('[data-signal="chat_abuse"]')).toBeVisible();

    // Dismiss with a reason; it moves to "Dismissed" and the filter finds it there.
    await signal.getByLabel('Note', { exact: true }).fill('Handled with the guest by phone');
    await signal.getByRole('button', { name: /^Dismiss: Conversation reported/ }).click();
    await expect(signal.getByRole('status')).toHaveText('Dismissed.');
    await page.goto(`${base}/onsite/signals?status=dismissed`);
    await expect(page.locator('[data-signal="chat_abuse"]')).toContainText(
      'Note: Handled with the guest by phone',
    );

    // Arabic, right to left, with the filter applied.
    await page.goto(`/ar${base}/onsite/signals?kind=chat_abuse`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('[data-signal="chat_abuse"]')).toContainText('تم الإبلاغ عن محادثة');
    await expectAccessible(page);
  });

  test('a viewer with no role at the event can’t open the Signals list', async ({ page }) => {
    await signIn(page, VIEWER);
    await page.goto('/o/lakeside-events/e/midwest-leadership-summit-2027/onsite/signals');
    await expect(
      page.getByText('Only people who scan at this event can see its fraud signals.'),
    ).toBeVisible();
    await expect(page.getByRole('form', { name: 'Filter signals' })).toHaveCount(0);
    await expectAccessible(page);
  });

  test('members choose how fraud alerts reach them', async ({ page }) => {
    await signIn(page);
    await page.goto('/o/lakeside-events/notifications/preferences');
    const group = page.getByRole('group', { name: 'Fraud and security alerts' });
    await expect(group).toBeVisible();
    await expect(group.getByRole('checkbox', { name: 'In the app' })).toBeChecked();
    await expect(group.getByRole('checkbox', { name: 'Email' })).toBeChecked();
    await expect(group.getByRole('checkbox', { name: 'SMS' })).not.toBeChecked();
    await expectAccessible(page);
  });
});
