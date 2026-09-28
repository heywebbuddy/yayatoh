import { type Browser, expect, type Page, test } from '@playwright/test';
import { fakeDeliverySecret, signFakeDeliveryEvents } from '@yayatoh/notifications';
import { expectAccessible, signIn } from './helpers.ts';

/**
 * M1.10d: CSP-safe email previews, the template editor, reminders that follow a reschedule,
 * delivery reports with bounce suppression, and the member email language.
 */

const VIEWER = 'jordan@lakeside.test';
const ORG_TZ = 'America/New_York';
const TZ = 'America/Chicago';
const tagOf = () => `${test.info().project.name.replace(/[^a-z0-9]/g, '')}${Date.now()}`;

interface Captured {
  id: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

async function drain(page: Page, org = 'lakeside-events', scheduled = false) {
  const res = await page.request.post('/api/dev/outbox/drain', {
    form: { org, ...(scheduled ? { scheduled: '1' } : {}) },
  });
  expect(res.ok()).toBe(true);
}

async function mailbox(page: Page, to: string): Promise<Captured[]> {
  const res = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(to)}`);
  expect(res.ok()).toBe(true);
  return res.json();
}

/** A Chicago wall-clock `YYYY-MM-DDTHH:mm` as an instant (test dates avoid DST changes). */
const chicago = (local: string) => {
  const guess = new Date(`${local}:00Z`);
  const off = (d: Date) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
        .formatToParts(d)
        .map((x) => [x.type, x.value]),
    );
    const n = (k: string) => Number(p[k]);
    return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute')) - d.getTime();
  };
  return new Date(guess.getTime() - off(new Date(guess.getTime() - off(guess))));
};
/** The console's date label (Dates page, public date picker). */
const dateLabel = (start: string, end: string) =>
  new Intl.DateTimeFormat('en', {
    timeZone: TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).formatRange(chicago(start), chicago(end));
/** The order page's message log time (org timezone). */
const logTime = (d: Date) =>
  new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: ORG_TZ }).format(d);

async function createEvent(page: Page, name: string) {
  await page.goto('/o/lakeside-events/events/new');
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Time zone').selectOption(TZ);
  await page.getByLabel('Starts', { exact: true }).fill('2027-05-05T19:00');
  await page.getByLabel('Ends', { exact: true }).fill('2027-05-05T22:00');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  return new URL(page.url()).pathname;
}

async function addPassAndPublish(page: Page, base: string, pass: string) {
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill(pass);
  await page.getByLabel('Price (USD)').fill('0');
  await page.getByLabel('Quantity available').fill('50');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: pass })).toBeVisible();
  await page.goto(base);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
}

async function buy(browser: Browser, slug: string, pass: string, who: string, email: string, date?: string) {
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/events/${slug}`);
  if (date) {
    await guest.getByRole('link', { name: date }).click();
    await expect(guest).toHaveURL(/\?date=/);
  }
  await guest.getByLabel(`Quantity — ${pass}`).selectOption('1');
  await guest.getByLabel('Full name').fill(who);
  await guest.getByLabel('Email for your tickets').fill(email);
  await guest.getByRole('button', { name: 'Continue to payment' }).click();
  await expect(guest).toHaveURL(/\/orders\//);
  return guest;
}

/** The organizer's order page for a buyer (from the event's orders list). */
async function openOrder(page: Page, base: string, buyer: string) {
  await page.goto(`${base}/tickets-orders`);
  await page.getByRole('link', { name: buyer }).click();
  await expect(page.getByRole('table', { name: 'Messages' })).toBeVisible();
  return new URL(page.url()).pathname;
}

/** The email heading's styles as the preview frame renders them (inline styles applied). */
async function headingStyle(page: Page, frameTitle: RegExp | string) {
  const frame = page.frameLocator(
    `iframe[title${typeof frameTitle === 'string' ? `="${frameTitle}"` : '^="Email preview"'}]`,
  );
  const h1 = frame.locator('h1');
  await expect(h1).toBeVisible();
  return h1.evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, fontSize: s.fontSize, fontWeight: s.fontWeight };
  });
}
/** The template's heading: ink (#111) at 22 px, regular weight; unstyled it would be black 32 px bold. */
const STYLED = { color: 'rgb(17, 17, 17)', fontSize: '22px', fontWeight: '400' };

/** Collect CSP violations reported on the page (and its frames). */
function cspViolations(page: Page) {
  const seen: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) seen.push(m.text());
  });
  return seen;
}

test.describe('email previews under the strict CSP', () => {
  test('the announcement preview renders the email’s styles; the page CSP stays strict; the draft never travels in the URL', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const tag = tagOf();
    const violations = cspViolations(page);
    await signIn(page);
    const base = await createEvent(page, `Preview ${tag}`);
    await page.goto(`${base}/attendees`);
    await page
      .getByText(/^Add (attendee|guest)/i)
      .first()
      .click();
    await page.getByLabel('Full name').fill(`Pia ${tag}`);
    await page.getByLabel('Email', { exact: true }).fill(`pia.${tag}@example.test`);
    await page.getByRole('button', { name: 'Add to the list' }).click();
    await expect(page.getByRole('row').filter({ hasText: `Pia ${tag}` })).toBeVisible();

    const res = await page.goto(`${base}/marketing`);
    const csp = res?.headers()['content-security-policy'] ?? '';
    // The console policy is unchanged where it matters: no inline styles anywhere on the page, styles
    // by nonce only; the one addition is framing same-origin previews.
    expect(csp).toContain("style-src-attr 'none'");
    expect(csp).toMatch(/style-src 'self' 'nonce-[^']+';/);
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).toContain("frame-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");

    const composer = page.getByRole('form', { name: 'New announcement' });
    const subject = `Styled ${tag}`;
    await composer.getByLabel('Subject').fill(subject);
    await composer.getByLabel('Message').fill('The doors open at seven.');
    // Keyboard: Enter in the subject submits the preview.
    await composer.getByLabel('Subject').press('Enter');
    const preview = page.getByRole('form', { name: 'Announcement preview' });
    const frame = preview.locator('iframe');
    await expect(frame).toHaveAttribute('title', `Email preview: ${subject}`);
    await expect(frame).toHaveAttribute('sandbox', '');
    const src = (await frame.getAttribute('src')) ?? '';
    expect(src).toMatch(/^\/api\/email-preview\/lakeside-events\/[0-9a-f-]{36}$/);
    expect(src).not.toContain(tag);
    expect(await headingStyle(page, `Email preview: ${subject}`)).toEqual(STYLED);
    await expect(page.frameLocator(`iframe[title="Email preview: ${subject}"]`).locator('h1')).toHaveText(
      subject,
    );

    // The preview's own response: its own policy, sandboxed, framable only by us, not sniffable.
    const own = await page.request.get(src);
    expect(own.status()).toBe(200);
    expect(own.headers()['content-security-policy']).toBe(
      "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; sandbox",
    );
    expect(own.headers()['x-content-type-options']).toBe('nosniff');
    expect(own.headers()['cache-control']).toContain('no-store');
    await expectAccessible(page);

    // Only its creator can open it: the viewer and a signed-out visitor get a 404.
    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    expect((await viewer.request.get(src)).status()).toBe(404);
    const anon = await browser.newContext();
    expect((await anon.request.get(src)).status()).toBe(404);
    expect(violations).toEqual([]);

    // Arabic, right to left: the same styled preview.
    await page.goto(`/ar${base}/marketing`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const ar = page.locator('form').filter({ has: page.locator('#announcement-subject') });
    await ar.locator('#announcement-subject').fill(`عنوان ${tag}`);
    await ar.locator('#announcement-body').fill('تُفتح الأبواب في السابعة.');
    await ar.locator('#announcement-subject').press('Enter');
    const arFrame = page.locator('iframe[sandbox=""]');
    await expect(arFrame).toBeVisible();
    const arHeading = page.frameLocator('iframe[sandbox=""]').locator('h1');
    await expect(arHeading).toHaveText(`عنوان ${tag}`);
    expect(await arHeading.evaluate((el) => getComputedStyle(el).fontSize)).toBe('22px');
    await expectAccessible(page);
  });

  test('the dev mailbox shows captured emails styled, from their own URL', async ({ page, browser }) => {
    const tag = tagOf();
    const violations = cspViolations(page);
    await signIn(page);
    const base = await createEvent(page, `Mailbox ${tag}`);
    await addPassAndPublish(page, base, 'Mail pass');
    const email = `mbx+${tag}@example.test`;
    await buy(browser, base.split('/').pop() as string, 'Mail pass', `Mo ${tag}`, email);
    await drain(page);
    const [mail] = await mailbox(page, email);
    expect(mail?.subject).toBe(`Your tickets for Mailbox ${tag}`);
    await page.goto(`/dev/mailbox?to=${encodeURIComponent(email)}`);
    // Keyboard: open the message with Enter on its summary.
    await page.getByText('Show message').first().focus();
    await page.keyboard.press('Enter');
    const title = `Email preview: Your tickets for Mailbox ${tag}`;
    await expect(page.locator(`iframe[title="${title}"]`)).toHaveAttribute(
      'src',
      `/api/dev/mailbox/${mail?.id}`,
    );
    expect(await headingStyle(page, title)).toEqual(STYLED);
    await expectAccessible(page);
    expect(violations).toEqual([]);
  });
});

test.describe('email template editor', () => {
  test('owners write copy with live validation and preview, save, reload, and reset to the default', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const tag = tagOf();
    // One language per project so parallel runs never edit the same template.
    const lang =
      { 'mobile-375': 'nl', 'tablet-768': 'pt', 'desktop-1280': 'it' }[test.info().project.name] ?? 'nl';
    const langName = new Intl.DisplayNames([lang], { type: 'language' }).of(lang) ?? lang;
    await signIn(page);
    if (test.info().project.name === 'desktop-1280') {
      // The console navigation links to it (the narrow layouts fold it into the menu).
      await page.goto('/o/lakeside-events');
      await page
        .getByRole('navigation', { name: 'Main navigation' })
        .first()
        .getByRole('link', { name: 'Email templates' })
        .click();
    } else await page.goto('/o/lakeside-events/emails');
    await expect(page.getByRole('heading', { name: 'Email templates', level: 1 })).toBeVisible();
    await expectAccessible(page);

    // Keyboard: choose the kind and language, then Enter on the Open button.
    await page.getByLabel('Email', { exact: true }).selectOption('orders.refund');
    await page.getByLabel('Language', { exact: true }).selectOption(lang);
    await page.getByRole('button', { name: 'Open' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`kind=orders.refund&lang=${lang}`));
    await expect(page.getByRole('heading', { name: `Refund · ${langName}` })).toBeVisible();
    // The default copy is shown, and the preview renders it (styled) before anything is typed.
    await expect(page.getByText(/^Default: /).first()).toBeVisible();
    await expect(page.locator('iframe[title^="Email preview"]')).toBeVisible();
    expect(await headingStyle(page, /./)).toEqual(STYLED);

    const form = page.getByRole('form', { name: 'Email copy' });
    const subject = form.getByLabel('Subject', { exact: true });
    const intro = form.getByLabel('Opening paragraph');
    // Invalid ICU, live: the preview stops and the field says why.
    await subject.fill('Refund for {eventName');
    await expect(
      form.getByText('This isn’t valid: every opening brace needs a closing one around a placeholder name.'),
    ).toBeVisible();
    await expect(subject).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Fix the highlighted fields to see the preview.')).toBeVisible();
    await expect(page.locator('iframe[title^="Email preview"]')).toHaveCount(0);
    await expectAccessible(page);
    // A placeholder the email never has.
    await subject.fill('Refund {password}');
    await expect(form.getByText('Use only the placeholders listed below.')).toBeVisible();
    // Saving invalid copy is refused too.
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByText('Use only the placeholders listed below.')).toBeVisible();

    // Valid copy: the live preview shows it.
    await subject.fill(`Refund ${tag}: {eventName}`);
    await intro.fill(`Hello from ${tag}. {amount} is on its way.`);
    await expect(subject).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(`Subject: Refund ${tag}: Lakeside Jazz Night`)).toBeVisible();
    const frame = page.frameLocator('iframe[title^="Email preview"]');
    await expect(frame.locator('h1')).toHaveText(`Refund ${tag}: Lakeside Jazz Night`);
    await expect(frame.locator('p', { hasText: `Hello from ${tag}.` })).toBeVisible();
    // Keyboard: Enter in the subject field saves.
    await subject.press('Enter');
    await expect(page.getByText('Saved. New emails use this copy.')).toBeVisible();
    await page.reload();
    await expect(subject).toHaveValue(`Refund ${tag}: {eventName}`);
    await expect(intro).toHaveValue(`Hello from ${tag}. {amount} is on its way.`);
    await expect(
      page.getByRole('row').filter({ hasText: 'Refund' }).filter({ hasText: langName }),
    ).toBeVisible();
    await expectAccessible(page);

    // Reset to the default: the fields empty, the default copy again, gone from the list.
    await form.getByRole('button', { name: 'Reset to default' }).click();
    await expect(page.getByText('Reset. New emails use the default copy.')).toBeVisible();
    await expect(subject).toHaveValue('');
    await page.reload();
    await expect(subject).toHaveValue('');
    await expect(intro).toHaveValue('');
    await expect(
      page.getByRole('row').filter({ hasText: 'Refund' }).filter({ hasText: langName }),
    ).toHaveCount(0);

    // Arabic, right to left.
    await page.goto(`/ar/o/lakeside-events/emails?kind=orders.refund&lang=${lang}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'قوالب البريد الإلكتروني', level: 1 })).toBeVisible();
    await expect(page.locator('iframe[sandbox=""]')).toBeVisible();
    await expectAccessible(page);
  });

  test('a viewer reads the templates and previews them, but cannot edit', async ({ page }) => {
    await signIn(page, VIEWER);
    await page.goto('/o/lakeside-events/emails?kind=orders.tickets&lang=en');
    await expect(
      page.getByText('You can read these emails. Only owners and admins can change them.'),
    ).toBeVisible();
    const form = page.getByRole('form', { name: 'Email copy' });
    await expect(form.getByLabel('Subject', { exact: true })).toHaveAttribute('readonly', '');
    await expect(form.getByLabel('Opening paragraph')).toHaveAttribute('readonly', '');
    await expect(form.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await expect(form.getByRole('button', { name: 'Reset to default' })).toHaveCount(0);
    expect(await headingStyle(page, /./)).toEqual(STYLED);
    await expectAccessible(page);
  });
});

test.describe('reminders follow reschedules', () => {
  test('moving a date moves its reminder; the reminder email shows the new time', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    const tag = tagOf();
    await signIn(page);
    const base = await createEvent(page, `Moved ${tag}`);
    const slug = base.split('/').pop() as string;
    await page.goto(`${base}/dates`);
    const add = page.getByRole('region', { name: 'Add a date' });
    await add.getByLabel('Starts', { exact: true }).fill('2027-06-02T19:00');
    await add.getByLabel('Ends', { exact: true }).fill('2027-06-02T22:00');
    await add.getByRole('button', { name: 'Add date' }).click();
    await expect(add.getByText('1 date added')).toBeVisible();
    await addPassAndPublish(page, base, 'Night pass');

    const who = `Remi ${tag}`;
    const email = `remi+${tag}@example.test`;
    await buy(browser, slug, 'Night pass', who, email, dateLabel('2027-06-02T19:00', '2027-06-02T22:00'));
    await drain(page);
    const order = await openOrder(page, base, who);
    const log = page.getByRole('table', { name: 'Messages' });
    const reminder = log.getByRole('row').filter({ hasText: 'Event reminder' });
    await expect(reminder).toContainText('Scheduled');
    await expect(reminder).toContainText(logTime(chicago('2027-06-01T19:00')));

    // Move the date a week later (keyboard: Enter in the end field saves).
    await page.goto(`${base}/dates`);
    await page
      .getByRole('link', { name: `Edit ${dateLabel('2027-06-02T19:00', '2027-06-02T22:00')}` })
      .click();
    const edit = page.getByRole('region', { name: /^Edit / });
    await edit.getByLabel('Starts', { exact: true }).fill('2027-06-09T20:00');
    await edit.getByLabel('Ends', { exact: true }).fill('2027-06-09T23:00');
    await edit.getByLabel('Ends', { exact: true }).press('Enter');
    await expect(edit.getByText('1 date updated')).toBeVisible();

    // The outbox drains: the reminder follows (once, however often it drains).
    await drain(page);
    await drain(page);
    await page.goto(order);
    await expect(reminder).toContainText('Scheduled');
    await expect(reminder).toContainText(logTime(chicago('2027-06-08T20:00')));
    await expect(log.getByRole('row').filter({ hasText: 'Event reminder' })).toHaveCount(1);
    await expectAccessible(page);

    // Sent now (dev tooling), the email carries the new time in the event's timezone.
    await drain(page, 'lakeside-events', true);
    const mail = (await mailbox(page, email)).find((m) => m.subject === `Tomorrow: Moved ${tag}`);
    expect(mail?.text).toContain('Wednesday, June 9, 2027 at 8:00 PM');
    expect(mail?.text).not.toContain('June 2, 2027');
    await page.reload();
    await expect(reminder).toContainText('Sent');

    // Arabic, right to left.
    await page.goto(`/ar${order}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(page);
  });
});

test.describe('delivery reports and suppression', () => {
  test('a bounced address is suppressed and the log says so; forged reports are refused, replays deduplicated', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    const tag = tagOf();
    await signIn(page);
    const base = await createEvent(page, `Bounce ${tag}`);
    const slug = base.split('/').pop() as string;
    await addPassAndPublish(page, base, 'Bounce pass');
    // The fake provider hard-bounces `bounce@…` addresses (like SES's mailbox simulator).
    const email = `bounce+${tag}@example.test`;
    await buy(browser, slug, 'Bounce pass', `Bo ${tag}`, email);
    await drain(page);
    await openOrder(page, base, `Bo ${tag}`);
    const first = page
      .getByRole('table', { name: 'Messages' })
      .getByRole('row')
      .filter({ hasText: 'Tickets' });
    await expect(first).toContainText('Sent');
    await expect(first).toContainText('Bounced: the address does not exist');
    await expectAccessible(page);

    // The next order to that address: not sent, and the log says why.
    await buy(browser, slug, 'Bounce pass', `Bo Again ${tag}`, email);
    await drain(page);
    const second = await openOrder(page, base, `Bo Again ${tag}`);
    const row = page.getByRole('table', { name: 'Messages' }).getByRole('row').filter({ hasText: 'Tickets' });
    await expect(row).toContainText('Not sent');
    await expect(row).toContainText('Suppressed: this address bounced earlier');
    expect(
      (await mailbox(page, email)).filter((m) => m.subject === `Your tickets for Bounce ${tag}`),
    ).toHaveLength(1);
    await expectAccessible(page);
    // A normal address shows "Delivered".
    const ok = `ok+${tag}@example.test`;
    await buy(browser, slug, 'Bounce pass', `Okay ${tag}`, ok);
    await drain(page);
    await openOrder(page, base, `Okay ${tag}`);
    await expect(
      page.getByRole('table', { name: 'Messages' }).getByRole('row').filter({ hasText: 'Tickets' }),
    ).toContainText('Delivered');

    // The webhook endpoint: unsigned or forged deliveries are refused; a signed one is recorded
    // once however often the provider retries it.
    const [okMail] = await mailbox(page, ok);
    const messageId = okMail?.headers['X-Yayatoh-Message'] ?? '';
    const forged = await page.request.post('/api/webhooks/email/fake', {
      data: JSON.stringify({
        events: [{ id: 'x', type: 'bounced', bounceType: 'hard', messageId, occurredAt: new Date() }],
      }),
      headers: {
        'content-type': 'application/json',
        'x-fake-email-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`,
      },
    });
    expect(forged.status()).toBe(400);
    expect((await page.request.post('/api/webhooks/email/nope', { data: '{}' })).status()).toBe(404);
    const secret = fakeDeliverySecret(process.env);
    if (!secret) throw new Error('APP_TOKEN_SECRET is needed to sign fake delivery reports');
    const signed = signFakeDeliveryEvents(secret, [
      { id: `e2e-${tag}`, type: 'complained', messageId, providerMessageId: `dev-${okMail?.id}` },
    ]);
    const post = () =>
      page.request.post('/api/webhooks/email/fake', {
        data: signed.body,
        headers: { 'content-type': 'application/json', 'x-fake-email-signature': signed.signature },
      });
    expect(await (await post()).json()).toEqual({ recorded: 1, duplicate: 0, unknown: 0, suppressed: 1 });
    expect(await (await post()).json()).toEqual({ recorded: 0, duplicate: 1, unknown: 0, suppressed: 0 });
    await page.reload();
    await expect(
      page.getByRole('table', { name: 'Messages' }).getByRole('row').filter({ hasText: 'Tickets' }),
    ).toContainText('Marked as spam by the recipient');

    // Arabic, right to left (last: the language cookie sticks).
    await page.goto(`/ar${second}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(page);
  });
});

test.describe('member email language', () => {
  test('a member chooses Spanish; their order alerts arrive in Spanish', async ({ page, browser }) => {
    test.setTimeout(120_000);
    const tag = tagOf();
    // Lee (Harbor Arts' owner): every project sets the same language, so parallel runs agree.
    await signIn(page, 'lee@harbor.test');
    await page.goto('/o/harbor-arts/notifications/preferences');
    await expect(page.getByRole('heading', { name: 'Email language' })).toBeVisible();
    await expectAccessible(page);
    // Sales alerts by email are off by default: switch them on (saved with the grid).
    const sales = page.getByRole('group', { name: 'Sales' });
    await sales.getByRole('checkbox', { name: 'Email' }).check();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Your notification settings are saved.')).toBeVisible();
    // Keyboard: choose the language and save with Enter on the button.
    await page.getByLabel('Language for emails about your organizations').selectOption('es');
    await page.getByRole('button', { name: 'Save language' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Language saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Language for emails about your organizations')).toHaveValue('es');

    // A sale in Harbor Arts: Lee's alert email is in Spanish.
    await page.goto('/o/harbor-arts/events/new');
    await page.getByLabel('Event name', { exact: true }).fill(`Lengua ${tag}`);
    await page.getByLabel('Starts', { exact: true }).fill('2027-07-01T19:00');
    await page.getByLabel('Ends', { exact: true }).fill('2027-07-01T22:00');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/harbor-arts\/e\/[a-z0-9-]+$/);
    const base = new URL(page.url()).pathname;
    await addPassAndPublish(page, base, 'Pase');
    const buyer = `Lucia ${tag}`;
    await buy(browser, base.split('/').pop() as string, 'Pase', buyer, `lucia+${tag}@example.test`);
    await drain(page, 'harbor-arts');
    const alert = (await mailbox(page, 'lee@harbor.test')).find(
      (m) => m.subject === `Nuevo pedido: ${buyer}`,
    );
    expect(alert?.html).toContain('lang="es"');

    // Arabic, right to left.
    await page.goto('/ar/o/harbor-arts/notifications/preferences');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'لغة البريد الإلكتروني' })).toBeVisible();
    await expectAccessible(page);
  });
});
