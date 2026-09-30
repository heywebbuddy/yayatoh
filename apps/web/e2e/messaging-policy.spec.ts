import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, newUser, signIn } from './helpers.ts';

/**
 * M3.5a messaging rules: the recipient's preference center, a text blocked for want of consent
 * (with its reason, in the sent log and on Messaging limits), the quota-reached state, frequency
 * caps, and lifting a bounce suppression. Every journey: keyboard, axe, Arabic RTL.
 */
interface Captured {
  subject: string;
  text: string;
  html: string;
}

const stampOf = () => `${Date.now()}${test.info().project.name.slice(0, 1)}`;

async function drain(page: Page, org: string) {
  const res = await page.request.post('/api/dev/outbox/drain', { form: { org } });
  expect(res.ok()).toBe(true);
}

async function mailbox(page: Page, to: string): Promise<Captured[]> {
  return (await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(to)}`)).json();
}

/** A draft event with the given guests; returns its console path. */
async function eventWithGuests(
  page: Page,
  org: string,
  stamp: string,
  guests: Array<{ name: string; email: string }>,
) {
  await page.goto(`/o/${org}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(`Rules ${stamp}`);
  await page.getByLabel('Starts', { exact: true }).fill('2027-11-01T18:00');
  await page.getByLabel('Ends', { exact: true }).fill('2027-11-01T22:00');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${org}/e/rules-\\d+`));
  const base = new URL(page.url()).pathname;
  for (const g of guests) {
    await page.goto(`${base}/attendees`);
    await page
      .getByText(/^Add (attendee|guest)/i)
      .first()
      .click();
    await page.getByLabel('Full name').fill(g.name);
    await page.getByLabel('Email', { exact: true }).fill(g.email);
    await page.getByRole('button', { name: 'Add to the list' }).click();
    await expect(page.getByRole('row').filter({ hasText: g.name })).toBeVisible();
  }
  return base;
}

/** Compose → preview → send an announcement from the event's Marketing page. */
async function announce(
  page: Page,
  base: string,
  subject: string,
  channels: { email: boolean; sms: boolean },
) {
  await page.goto(`${base}/marketing`);
  const composer = page.getByRole('form', { name: 'New announcement' });
  await composer.getByLabel('Subject').fill(subject);
  await composer.getByLabel('Message').fill('Doors open at 7. Use lot C.');
  await composer.getByRole('checkbox', { name: 'Email' }).setChecked(channels.email);
  await composer.getByRole('checkbox', { name: 'SMS', exact: true }).setChecked(channels.sms);
  await composer.getByRole('button', { name: 'Preview' }).click();
  const preview = page.getByRole('form', { name: 'Announcement preview' });
  await expect(preview).toBeVisible();
  return preview;
}

test.describe('messaging rules: preference center and a text blocked for want of consent', () => {
  test('the guest manages preferences; a text without consent is blocked with its reason; after opting in it is sent', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const stamp = stampOf();
    const email = `pref.${stamp}@example.test`;
    const phone = `+1212555${String(Date.now() % 10_000).padStart(4, '0')}`;
    await signIn(page);
    const base = await eventWithGuests(page, 'lakeside-events', stamp, [{ name: `Pia ${stamp}`, email }]);
    const first = await announce(page, base, `Welcome ${stamp}`, { email: true, sms: false });
    await first.getByRole('button', { name: 'Send to 1 person' }).click();
    await expect(page.getByText('Sent to 1 person. Delivery continues in the background.')).toBeVisible();
    await drain(page, 'lakeside-events');
    const [mail] = await mailbox(page, email);
    const unsubscribe = /Unsubscribe: (\S+)/.exec(mail?.text ?? '')?.[1] ?? '';
    expect(unsubscribe).toMatch(/\/unsubscribe\//);

    // The guest (no account): the unsubscribe page links to the preference center.
    const guest = await (await browser.newContext()).newPage();
    await guest.goto(new URL(unsubscribe).pathname);
    await guest.getByRole('link', { name: 'Manage all your preferences for Lakeside Events' }).click();
    await expect(
      guest.getByRole('heading', { name: 'Messages from Lakeside Events', level: 1 }),
    ).toBeVisible();
    const prefsPath = new URL(guest.url()).pathname;
    await expectAccessible(guest);
    const form = guest.getByRole('form', { name: 'Your message preferences' });
    await expect(
      form.getByRole('checkbox', { name: "Updates about events you're attending", exact: true }),
    ).toBeChecked();
    await expect(form.getByRole('checkbox', { name: 'News and offers' }).first()).not.toBeChecked();
    // Validation: texts need a number; the number needs its country code.
    const sms = form.getByRole('group', { name: 'Text messages (SMS)' });
    await sms.getByRole('checkbox', { name: "Reminders and updates about events you're attending" }).check();
    await form.getByRole('button', { name: 'Save my preferences' }).click();
    await expect(form.getByText('Add a mobile number to get text or WhatsApp messages.')).toBeVisible();
    await expect(form.getByLabel('Mobile number', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await form.getByLabel('Mobile number', { exact: true }).fill('555-0100');
    await form.getByRole('button', { name: 'Save my preferences' }).click();
    await expect(
      form.getByText('Enter the number with its country code, for example +1 212 555 0100.'),
    ).toBeVisible();
    await expectAccessible(guest);
    // A number, but no texts yet (keyboard: Enter in the number field saves).
    await sms
      .getByRole('checkbox', { name: "Reminders and updates about events you're attending" })
      .uncheck();
    await form.getByLabel('Mobile number', { exact: true }).fill(phone);
    await form.getByLabel('Mobile number', { exact: true }).press('Enter');
    await expect(form.getByText('Your preferences are saved.')).toBeVisible();
    await guest.reload();
    await expect(
      guest.getByText(`Currently ${phone.slice(0, 2)}••••••${phone.slice(-4)}. Leave blank to keep it.`),
    ).toBeVisible();
    await expect(
      guest
        .getByRole('group', { name: 'Text messages (SMS)' })
        .getByRole('checkbox', { name: "Reminders and updates about events you're attending" }),
    ).not.toBeChecked();

    // The organizer texts everyone: the preview counts segments; the guest never agreed to texts.
    const second = await announce(page, base, `Parking ${stamp}`, { email: false, sms: true });
    await expect(second.getByRole('heading', { name: 'Text message' })).toBeVisible();
    await expect(second.getByText(/characters · 1 segment \(GSM-7\)/)).toBeVisible();
    await expect(second.getByText('1 attendee has a mobile number.')).toBeVisible();
    await expectAccessible(page);
    await second.getByRole('button', { name: 'Send to 1 person' }).click();
    await expect(page.getByText('Sent to 1 person. Delivery continues in the background.')).toBeVisible();
    await drain(page, 'lakeside-events');
    await page.reload();
    const row = page
      .getByRole('table', { name: 'Sent announcements' })
      .getByRole('row')
      .filter({ hasText: `Parking ${stamp}` });
    await expect(row).toContainText('0 sent · 0 pending · 1 not sent');
    await expect(row).toContainText('SMS: Blocked: no consent to receive this (1)');
    expect(await mailbox(page, phone)).toHaveLength(0);
    // Messaging limits lists it with its reason (the number never shows).
    await page.goto('/o/lakeside-events/messaging');
    await expect(page.getByRole('heading', { name: 'Messaging limits', level: 1 })).toBeVisible();
    const log = page.getByRole('table', { name: 'Messages held or blocked by the messaging rules' });
    await expect(
      log.getByRole('row').filter({ hasText: 'Blocked: no consent to receive this' }).first(),
    ).toContainText('SMS');
    await expect(page.getByText(phone)).toHaveCount(0);
    await expectAccessible(page);

    // The guest opts in to informational texts: the next text goes out.
    await guest
      .getByRole('group', { name: 'Text messages (SMS)' })
      .getByRole('checkbox', {
        name: "Reminders and updates about events you're attending",
      })
      .check();
    await guest.getByRole('button', { name: 'Save my preferences' }).click();
    await expect(guest.getByText('Your preferences are saved.')).toBeVisible();
    const third = await announce(page, base, `Gates ${stamp}`, { email: false, sms: true });
    await third.getByRole('button', { name: 'Send to 1 person' }).click();
    await expect(page.getByText('Sent to 1 person. Delivery continues in the background.')).toBeVisible();
    await drain(page, 'lakeside-events');
    const texts = await mailbox(page, phone);
    expect(texts[0]?.text).toContain(`Lakeside Events: Gates ${stamp}`);
    expect(texts[0]?.text).toContain('Reply STOP to opt out.');

    // Arabic, right to left, in their own contexts.
    const ar = await (await browser.newContext()).newPage();
    await ar.goto(`/ar${prefsPath}`);
    await expect(ar.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(ar.getByRole('heading', { name: 'رسائل من Lakeside Events', level: 1 })).toBeVisible();
    await expectAccessible(ar);
    await page.goto('/ar/o/lakeside-events/messaging');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'حدود المراسلة', level: 1 })).toBeVisible();
    await expectAccessible(page);
  });

  test('a forged preference link is a 404', async ({ page }) => {
    const res = await page.goto(
      '/preferences/01a0e470-0a78-757d-bd9f-6935ffeb0aa9/01a0e470-0a78-757d-bd9f-6935ffeb0aa9~forged',
    );
    expect(res?.status()).toBe(404);
  });
});

test.describe('messaging rules: quotas, caps and suppressions (a new organization)', () => {
  test('quota reached: the organizer sees it on Messaging limits and in the composer; nothing is dropped', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const stamp = stampOf();
    const owner = await newUser(page, { org: true, twoFactor: true });
    const org = owner.orgSlug ?? '';
    await page.goto(`/o/${org}/messaging`);
    await expect(page.getByRole('heading', { name: 'Messaging limits', level: 1 })).toBeVisible();
    const usage = page.getByRole('table', { name: 'Usage and quotas this month' });
    await expect(usage.getByRole('row').filter({ hasText: 'Email' })).toContainText('Within quota');
    await expect(page.getByText(/quota is used up/)).toHaveCount(0);
    const quota = await page.request.post('/api/dev/messaging', {
      form: { org, action: 'quota', channel: 'email', limit: '0' },
    });
    expect(quota.ok()).toBe(true);
    await page.reload();
    await expect(page.getByText('A quota is used up: Email.')).toBeVisible();
    await expect(page.getByText(/Optional messages wait \(none are dropped\)/)).toBeVisible();
    await expect(usage.getByRole('row').filter({ hasText: 'Email' })).toContainText('Quota reached');
    await expectAccessible(page);
    // The composer warns before sending.
    const base = await eventWithGuests(page, org, stamp, [
      { name: `Quinn ${stamp}`, email: `quota.${stamp}@example.test` },
    ]);
    const preview = await announce(page, base, `Held ${stamp}`, { email: true, sms: false });
    await expect(
      preview.getByText(
        "This month's quota for Email is used up: those messages will wait until it resets or Yayatoh raises your limit.",
      ),
    ).toBeVisible();
    await preview.getByRole('button', { name: 'Send to 1 person' }).click();
    await expect(page.getByText('Sent to 1 person. Delivery continues in the background.')).toBeVisible();
    await drain(page, org);
    await page.reload();
    await expect(
      page
        .getByRole('table', { name: 'Sent announcements' })
        .getByRole('row')
        .filter({ hasText: `Held ${stamp}` }),
    ).toContainText("Email: Waiting: this month's quota is used up (1)");
    await page.goto(`/o/${org}/messaging`);
    await expect(usage.getByRole('row').filter({ hasText: 'Email' })).toContainText('Quota reached');
    await expect(usage.getByRole('row').filter({ hasText: 'Email' }).getByRole('cell').last()).toHaveText(
      '1',
    );
    await page.goto(`/ar/o/${org}/messaging`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText('بلغت الحصة').first()).toBeVisible();
    await expectAccessible(page);
  });

  test('frequency caps: validation, save from the keyboard, persistence', async ({ page }) => {
    const owner = await newUser(page, { org: true, twoFactor: true });
    await page.goto(`/o/${owner.orgSlug}/messaging`);
    const caps = page.getByRole('form', { name: 'Frequency caps' });
    const max = caps.getByLabel('News and offers: most messages', { exact: true });
    await expect(max).toHaveValue('2');
    await max.fill('0');
    await caps.getByLabel('Event updates: per how many hours', { exact: true }).fill('9999');
    await caps.getByRole('button', { name: 'Save caps' }).click();
    await expect(caps.getByText('Enter a whole number from 1 to 20.')).toBeVisible();
    await expect(caps.getByText('Enter a whole number of hours from 1 to 720.')).toBeVisible();
    await expect(max).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page);
    await max.fill('1');
    await caps.getByLabel('Event updates: per how many hours', { exact: true }).fill('12');
    await max.press('Enter');
    await expect(caps.getByText('Caps saved.')).toBeVisible();
    await page.reload();
    await expect(caps.getByLabel('News and offers: most messages', { exact: true })).toHaveValue('1');
    await expect(caps.getByLabel('Event updates: per how many hours', { exact: true })).toHaveValue('12');
  });

  test('the organizer lifts a bounce with a note; a complaint is support-only', async ({ page }) => {
    test.setTimeout(120_000);
    const stamp = stampOf();
    const owner = await newUser(page, { org: true, twoFactor: true });
    const org = owner.orgSlug ?? '';
    await page.goto(`/o/${org}/messaging`);
    await expect(page.getByRole('table', { name: 'Addresses messages are not sent to' })).toContainText(
      'No suppressed addresses.',
    );
    const base = await eventWithGuests(page, org, stamp, [
      { name: `Bo ${stamp}`, email: `bounce+${stamp}@example.test` },
      { name: `Cy ${stamp}`, email: `complaint+${stamp}@example.test` },
    ]);
    const preview = await announce(page, base, `Hello ${stamp}`, { email: true, sms: false });
    await preview.getByRole('button', { name: 'Send to 2 people' }).click();
    await expect(page.getByText('Sent to 2 people. Delivery continues in the background.')).toBeVisible();
    await drain(page, org);
    await drain(page, org);
    await page.goto(`/o/${org}/messaging`);
    const table = page.getByRole('table', { name: 'Addresses messages are not sent to' });
    await expect(table.getByRole('row').filter({ hasText: "Bounced (address doesn't exist)" })).toBeVisible();
    const complaint = table.getByRole('row').filter({ hasText: 'Marked as spam' });
    await expect(complaint).toContainText('Only Yayatoh support can lift this.');
    await expect(complaint.getByRole('button')).toHaveCount(0);
    await expectAccessible(page);
    // A note is required.
    const lift = page.getByRole('button', { name: /^Lift the suppression for b/ });
    await lift.click();
    await expect(page.getByText('Add a note of at least 3 characters.')).toBeVisible();
    await page.getByLabel(/^Why lift it for b/).fill('The guest fixed their mailbox');
    await page.getByLabel(/^Why lift it for b/).press('Enter');
    await expect(
      page.getByText('The suppression was lifted. Messages to that address go out again.'),
    ).toBeVisible();
    await expect(table.getByRole('row').filter({ hasText: "Bounced (address doesn't exist)" })).toHaveCount(
      0,
    );
    await page.reload();
    await expect(table.getByRole('row').filter({ hasText: 'Marked as spam' })).toBeVisible();
    await page.goto(`/ar/o/${org}/messaging`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(page);
  });
});

test.describe('messaging rules: permissions', () => {
  test('marketing sees Messaging limits read-only; a viewer has no link and gets a 404', async ({ page }) => {
    await newUser(page, { join: ['lakeside-events:marketing'] });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/o/lakeside-events');
    const nav = page.getByRole('navigation', { name: 'Main navigation' }).first();
    await nav.getByRole('link', { name: 'Messaging limits' }).click();
    await expect(page.getByRole('heading', { name: 'Messaging limits', level: 1 })).toBeVisible();
    await expect(page.getByRole('form', { name: 'Frequency caps' })).toHaveCount(0);
    await expect(page.getByRole('table', { name: 'Frequency caps per person' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Lift the suppression/ })).toHaveCount(0);
    await expectAccessible(page);

    await signIn(page, 'jordan@lakeside.test');
    await page.goto('/o/lakeside-events');
    await expect(nav.getByRole('link', { name: 'Messaging limits' })).toHaveCount(0);
    expect((await page.goto('/o/lakeside-events/messaging'))?.status()).toBe(404);
  });
});
