import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, expectHtmlAccessible, OPEN_HOUSE, signIn } from './helpers.ts';

interface Captured {
  subject: string;
  text: string;
  html: string;
}

async function drain(page: Page) {
  const res = await page.request.post('/api/dev/outbox/drain', { form: { org: 'lakeside-events' } });
  expect(res.ok()).toBe(true);
}

async function mailbox(page: Page, to: string): Promise<Captured[]> {
  const res = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(to)}`);
  return res.json();
}

test.describe('messaging: announcements and conversations', () => {
  test('compose, validate, preview and send an announcement; the attendee replies; the organizer answers, reports and blocks', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const stamp = `${Date.now()}${test.info().project.name.slice(0, 1)}`;
    const guestName = `Gia ${stamp}`;
    const email = `gia.${stamp}@example.test`;
    await signIn(page);
    await page.goto('/o/lakeside-events/events/new');
    await page.getByLabel('Event name').fill(`Harbor ${stamp}`);
    await page.getByLabel('Starts').fill('2027-11-01T18:00');
    await page.getByLabel('Ends').fill('2027-11-01T22:00');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/harbor-\d+/);
    const base = new URL(page.url()).pathname;

    // The Marketing section: empty sent log, and every validation message.
    await page.goto(`${base}/marketing`);
    await expect(page.getByRole('heading', { name: 'Marketing', level: 1 })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Sent announcements' })).toContainText(
      'No announcements yet.',
    );
    await expectAccessible(page);
    const composer = page.getByRole('form', { name: 'New announcement' });
    await composer.getByRole('checkbox', { name: 'Email' }).uncheck();
    await composer.getByRole('button', { name: 'Preview' }).click();
    await expect(composer.getByText('Add a subject.')).toBeVisible();
    await expect(composer.getByText('Write a message.')).toBeVisible();
    await expect(composer.getByText('Choose at least one way to send it.')).toBeVisible();
    await expect(composer.getByLabel('Subject')).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page);

    // Nobody attends yet: refused with a reason.
    await composer.getByLabel('Subject').fill(`Parking ${stamp}`);
    await composer.getByLabel('Message').fill('Lot B is closed.\nPlease use lot C.');
    await composer.getByRole('checkbox', { name: 'Email' }).check();
    await composer.getByRole('button', { name: 'Preview' }).click();
    await expect(
      page.getByText('Nobody is attending this event yet, so there is no one to send to.'),
    ).toBeVisible();

    // Add one guest, then preview (from the keyboard: Enter in the subject field) and send.
    await page.goto(`${base}/attendees`);
    await page
      .getByText(/^Add (attendee|guest)/i)
      .first()
      .click();
    await page.getByLabel('Full name').fill(guestName);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Add to the list' }).click();
    await expect(page.getByRole('row').filter({ hasText: guestName })).toBeVisible();
    await page.goto(`${base}/marketing`);
    await composer.getByLabel('Subject').fill(`Parking ${stamp}`);
    await composer.getByLabel('Message').fill('Lot B is closed.\nPlease use lot C.');
    await composer.getByLabel('Subject').press('Enter');
    const preview = page.getByRole('form', { name: 'Announcement preview' });
    await expect(preview.getByText('This goes to 1 person.')).toBeVisible();
    await expect(preview.locator('iframe')).toHaveAttribute('title', `Email preview: Parking ${stamp}`);
    await expectAccessible(page);
    await preview.getByRole('button', { name: 'Edit' }).click();
    await expect(composer.getByLabel('Subject')).toHaveValue(`Parking ${stamp}`);
    await composer.getByRole('button', { name: 'Preview' }).click();
    await preview.getByRole('button', { name: 'Send to 1 person' }).click();
    await expect(page.getByText('Sent to 1 person. Delivery continues in the background.')).toBeVisible();
    const sentRow = page
      .getByRole('table', { name: 'Sent announcements' })
      .getByRole('row')
      .filter({
        hasText: `Parking ${stamp}`,
      });
    await expect(sentRow).toContainText('Email');
    await page.reload();
    await expect(sentRow).toBeVisible();

    // Delivered: the email has a reply link into the conversation.
    await drain(page);
    await page.reload();
    await expect(sentRow).toContainText('1 sent');
    const [mail] = await mailbox(page, email);
    expect(mail?.subject).toBe(`Parking ${stamp}`);
    // The email itself (what the preview frame shows) passes axe on its own.
    await expectHtmlAccessible(page, mail?.html ?? '');
    const replyLink = /href="(https?:\/\/[^"]+\/messages\/[^"]+)"/.exec(mail?.html ?? '')?.[1] ?? '';
    expect(replyLink).toMatch(/\/messages\/[0-9a-f-]{36}~/);

    // The attendee opens the link (no account), sees the announcement and replies.
    const guest = await (await browser.newContext()).newPage();
    await guest.goto(new URL(replyLink).pathname);
    await expect(
      guest.getByRole('heading', { name: 'Your conversation with Lakeside Events' }),
    ).toBeVisible();
    await expect(guest.getByRole('list', { name: 'Messages' })).toContainText(`Parking ${stamp}`);
    await expectAccessible(guest);
    await guest.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(guest.getByText('Write a message first.')).toBeVisible();
    await guest.getByLabel('Write to Lakeside Events').fill('Is lot C free?');
    await guest.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(guest.getByText('Message sent.')).toBeVisible();
    await expect(guest.getByRole('list', { name: 'Messages' })).toContainText('Is lot C free?');
    // Arabic in its own context (the locale cookie would otherwise stick).
    const arabic = await (await browser.newContext()).newPage();
    await arabic.goto(`/ar${new URL(replyLink).pathname}`);
    await expect(arabic.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(arabic.getByRole('heading', { name: 'محادثتك مع Lakeside Events' })).toBeVisible();
    await expectAccessible(arabic);

    // The organizer: unread in the inbox, opens it, replies.
    await drain(page);
    await page.goto('/o/lakeside-events/messages?filter=unread');
    await expectAccessible(page);
    await page.getByRole('link', { name: new RegExp(guestName) }).click();
    await expect(page.getByRole('heading', { name: `Conversation with ${guestName}` })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Messages' })).toContainText('Is lot C free?');
    await expectAccessible(page);
    const reply = page.getByRole('region', { name: 'Reply' });
    await reply.getByRole('button', { name: 'Send reply' }).click();
    await expect(reply.getByText('Write a message first.')).toBeVisible();
    await reply.getByLabel('Your reply (sent by email)').fill('Yes, lot C is free tonight.');
    await reply.getByRole('button', { name: 'Send reply' }).click();
    await expect(reply.getByText('Message sent.')).toBeVisible();
    await drain(page);
    const replies = (await mailbox(page, email)).filter(
      (m) => m.subject === 'New reply from Lakeside Events',
    );
    expect(replies[0]?.text).toContain('Yes, lot C is free tonight.');
    await page.goto('/o/lakeside-events/messages');
    await expect(page.getByRole('link', { name: new RegExp(guestName) })).toContainText(
      'You: Yes, lot C is free tonight.',
    );
    await page.getByRole('link', { name: new RegExp(guestName) }).click();

    // Report, then block: the attendee can no longer write.
    const safety = page.getByRole('region', { name: 'Block or report' });
    await safety.getByLabel('Reason').selectOption('spam');
    await safety.getByRole('button', { name: 'Report to Yayatoh' }).click();
    await expect(safety.getByText('Thanks. Yayatoh will review this conversation.')).toBeVisible();
    await safety.getByRole('button', { name: 'Block this person' }).click();
    await expect(safety.getByText('Blocked: their messages are refused.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Reply' })).toHaveCount(0);
    await guest.goto(new URL(replyLink).pathname);
    await expect(guest.getByText("Lakeside Events isn't accepting messages here.")).toBeVisible();
    await expect(guest.getByLabel('Write to Lakeside Events')).toHaveCount(0);
    await safety.getByRole('button', { name: 'Unblock' }).click();
    await expect(page.getByRole('region', { name: 'Reply' })).toBeVisible();

    // The attendee blocks the organizer (and reports), then unblocks.
    await guest.reload();
    const theirs = guest.getByRole('region', { name: 'Block or report' });
    await theirs.getByLabel('Reason').selectOption('other');
    await theirs.getByLabel('Details (optional)').fill('Too many emails');
    await theirs.getByRole('button', { name: 'Report to Yayatoh' }).click();
    await expect(theirs.getByText('Thanks. Yayatoh will review this conversation.')).toBeVisible();
    await theirs.getByRole('button', { name: 'Block Lakeside Events' }).click();
    await expect(theirs.getByText(/^You blocked Lakeside Events/)).toBeVisible();
    await page.reload();
    await expect(page.getByText('This person blocked messages from your organization.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Reply' })).toHaveCount(0);
    await theirs.getByRole('button', { name: 'Unblock Lakeside Events' }).click();
    await expect(guest.getByLabel('Write to Lakeside Events')).toBeVisible();
  });

  test('a forged conversation link is a 404', async ({ page }) => {
    const res = await page.goto('/messages/01a0e470-0a78-757d-bd9f-6935ffeb0aa9~forged');
    expect(res?.status()).toBe(404);
  });
});

test.describe('messaging: permissions', () => {
  test('a viewer sees no Messages or Marketing and is refused both pages', async ({ page }) => {
    await signIn(page, 'jordan@lakeside.test');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/o/lakeside-events');
    const nav = page.getByRole('navigation', { name: 'Main navigation' }).first();
    await expect(nav.getByRole('link', { name: 'Team' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Messages' })).toHaveCount(0);
    expect((await page.goto('/o/lakeside-events/messages'))?.status()).toBe(404);
    await page.goto(OPEN_HOUSE);
    await expect(nav.getByRole('link', { name: 'Tickets & Orders' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Marketing' })).toHaveCount(0);
    expect((await page.goto(`${OPEN_HOUSE}/marketing`))?.status()).toBe(404);
  });

  test('the owner sees Messages in the navigation and the empty filter state', async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/o/lakeside-events');
    const nav = page.getByRole('navigation', { name: 'Main navigation' }).first();
    await nav.getByRole('link', { name: 'Messages' }).click();
    await expect(page.getByRole('heading', { name: 'Messages', level: 1 })).toBeVisible();
    const filters = page.getByRole('navigation', { name: 'Show' });
    await filters.getByRole('link', { name: 'Blocked', exact: true }).click();
    await expect(filters.getByRole('link', { name: 'Blocked', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expectAccessible(page);
    await page.goto('/ar/o/lakeside-events/messages');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(page);
  });
});
