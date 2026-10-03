import { type Browser, expect, type Page, test } from '@playwright/test';
import { expectAccessible, expectAccessibleBothModes, newUser, passHumanCheck, signIn } from './helpers.ts';

/**
 * U10 org contact page and "Email sending" (From name, Reply-To). An owner turns the contact page
 * on (Site content › Contact page) and sets the From name and Reply-To; a visitor writes through
 * the form on the organizer's page; the owner gets exactly one email, sent with that From name
 * and Reply-To; the page never shows any of the org's addresses. Validation, the off state (404),
 * keyboard-only use, axe in both themes, Arabic RTL and the phone layout. Each test owns a fresh
 * org (`newUser`), so projects never collide.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const MARKET = `http://yayatoh.localhost:${PORT}`;
const HARBOR_SITE = `http://harbor-arts.yayatoh.events:${PORT}`;

/** The form waits for a person's fill time (a signed stamp; under 2 s is a bot). */
const PERSON_PAUSE_MS = 2_100;

async function drain(page: Page, org: string) {
  const res = await page.request.post('/api/dev/outbox/drain', { form: { org } });
  expect(res.ok()).toBe(true);
}

interface Mail {
  readonly subject: string;
  readonly text: string;
  readonly from: { readonly name: string; readonly address: string };
  readonly replyTo?: string;
}

async function mailTo(page: Page, to: string): Promise<Mail[]> {
  return (await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(to)}`)).json();
}

async function visitor(browser: Browser) {
  const context = await browser.newContext({ baseURL: MARKET });
  return { context, page: await context.newPage() };
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Turn the contact page on from the console (keyboard), with a line of text. */
async function turnOn(page: Page, org: string, intro: string) {
  await page.goto(`/o/${org}/content/contact`);
  const toggle = page.getByRole('switch', { name: 'Show the contact page on your site' });
  await toggle.focus();
  // Idempotent: a page already on (a rerun on the seeded tenant site) stays on.
  if (!(await toggle.isChecked())) await page.keyboard.press('Space');
  await expect(toggle).toBeChecked();
  await page.getByLabel('Text above the form').fill(intro);
  await page.getByRole('button', { name: 'Save' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved. Your contact page is live.' }),
  ).toBeVisible();
}

/** Fill and send the public form from the keyboard. */
async function sendMessage(page: Page, v: { name: string; email: string; message: string }) {
  await page.getByLabel('Your name', { exact: true }).fill(v.name);
  await page.getByLabel('Your email', { exact: true }).fill(v.email);
  await page.getByLabel('Message', { exact: true }).fill(v.message);
  const consent = page.getByRole('checkbox', { name: /may use my name and email to answer/ });
  await consent.focus();
  await page.keyboard.press('Space');
  await passHumanCheck(page);
  await page.waitForTimeout(PERSON_PAUSE_MS);
  await page.getByRole('button', { name: 'Send message' }).focus();
  await page.keyboard.press('Enter');
}

test.describe('U10 org contact page and email sending', () => {
  test('owner sets From name and Reply-To and turns the page on; a visitor writes; one email arrives, with them', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
    const org = owner.orgSlug ?? '';
    const replyTo = `box-office-${Date.now()}@example.org`;

    // Email sending: validation first (a domain-like name, a Yayatoh Reply-To), then save.
    await page.goto(`/o/${org}/sending`);
    const fromName = page.getByLabel('From name', { exact: true });
    await fromName.fill('service@paypal.com');
    await page.getByLabel('Reply-To address', { exact: true }).fill('help@yayatoh.com');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByText('A name can\'t contain an email address or the characters @ < > ".'),
    ).toBeVisible();
    await expect(page.getByText('Use your own address, not a Yayatoh one.')).toBeVisible();
    await expect(fromName).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page);
    await fromName.fill('Lakeview Box Office');
    await page.getByLabel('Reply-To address', { exact: true }).fill(replyTo.toUpperCase());
    // The inbox preview follows the typing.
    await expect(page.getByText('Lakeview Box Office', { exact: true })).toBeVisible();
    await expect(page.getByText(`Replies go to ${replyTo}`)).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Saved. Every new email uses these settings.' }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('From name', { exact: true })).toHaveValue('Lakeview Box Office');
    await expect(page.getByLabel('Reply-To address', { exact: true })).toHaveValue(replyTo);
    await expectAccessibleBothModes(page);

    // Contact page: on, with its line; the public link is shown.
    await turnOn(page, org, 'We answer within two days.');
    // Its canonical address: the org's own site (this org runs one) or its organizer page.
    await expect(page.getByRole('link', { name: /^https?:\/\/\S+\/contact$/ }).first()).toBeVisible();
    await expect(page.getByText('No messages yet', { exact: true })).toBeVisible();
    await expectAccessibleBothModes(page);

    // A visitor writes through the organizer's page.
    const v = await visitor(browser);
    await v.page.goto(`/o/${org}`);
    await v.page.getByRole('link', { name: 'Contact', exact: true }).click();
    await expect(v.page).toHaveURL(new RegExp(`/o/${org}/contact$`));
    await expect(v.page.getByRole('heading', { level: 1, name: /^Contact / })).toBeVisible();
    await expect(v.page.getByText('We answer within two days.')).toBeVisible();
    // The org's addresses are never on the page (owner's login, Reply-To).
    const html = await v.page.content();
    expect(html).not.toContain(owner.email);
    expect(html).not.toContain(replyTo);
    await expectAccessibleBothModes(v.page);
    // Validation: every field says what to fix.
    await v.page.waitForTimeout(PERSON_PAUSE_MS);
    await v.page.getByRole('button', { name: 'Send message' }).click();
    await expect(v.page.getByText('Enter your name.')).toBeVisible();
    await expect(v.page.getByText('Enter an email address like name@example.com.')).toBeVisible();
    await expect(v.page.getByText('Write at least 10 characters.')).toBeVisible();
    await expect(v.page.getByText('Tick the box so they may answer you.')).toBeVisible();
    await expectAccessible(v.page);
    const sender = `visitor-${Date.now()}@example.test`;
    await sendMessage(v.page, {
      name: 'Noor Haddad',
      email: sender,
      message: 'Is there a family ticket for Sunday?',
    });
    const done = v.page.getByRole('status').filter({ hasText: 'Message sent' });
    await expect(done).toBeVisible();
    await expect(done).toBeFocused();
    await expect(v.page.getByText(/will reply to your email/)).toBeVisible();
    await v.context.close();

    // Exactly one email to the owner, with the org's From name and Reply-To; draining again
    // (a replayed delivery) sends nothing more.
    await drain(page, org);
    await drain(page, org);
    const mails = (await mailTo(page, owner.email)).filter((m) =>
      m.subject.includes('through your contact page'),
    );
    expect(mails).toHaveLength(1);
    expect(mails[0]?.subject).toBe('New message from Noor Haddad through your contact page');
    expect(mails[0]?.from.name).toBe('Lakeview Box Office');
    expect(mails[0]?.replyTo).toBe(replyTo);
    expect(mails[0]?.text).toContain(sender);
    expect(mails[0]?.text).toContain('Is there a family ticket for Sunday?');

    // The console lists it; "Mark handled" from the keyboard.
    await page.goto(`/o/${org}/content/contact`);
    const row = page.getByRole('row').filter({ hasText: 'Noor Haddad' });
    await expect(row).toContainText(sender);
    await expect(page.getByText('New: 1')).toBeVisible();
    await row.getByRole('button', { name: 'Mark the message from Noor Haddad handled' }).focus();
    await page.keyboard.press('Enter');
    await expect(row.getByText('Handled', { exact: true })).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('row').filter({ hasText: 'Noor Haddad' }).getByText('Handled', { exact: true }),
    ).toBeVisible();
  });

  test('off by default: the page is a 404 and no Contact link shows; turning it off hides it again', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
    const org = owner.orgSlug ?? '';
    const v = await visitor(browser);
    expect((await v.page.goto(`/o/${org}/contact`))?.status()).toBe(404);
    await v.page.goto(`/o/${org}`);
    await expect(v.page.getByRole('link', { name: 'Contact', exact: true })).toHaveCount(0);

    await turnOn(page, org, 'Write to us.');
    expect((await v.page.goto(`/o/${org}/contact`))?.status()).toBe(200);
    await page.getByRole('switch', { name: 'Show the contact page on your site' }).uncheck();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Saved. Your contact page is off.' }),
    ).toBeVisible();
    await expect(page.getByText('Turn on the contact page to receive messages.')).toBeVisible();
    expect((await v.page.goto(`/o/${org}/contact`))?.status()).toBe(404);
    await v.context.close();
  });

  test('phone layout and Arabic RTL of the public page; the tenant site carries it at /contact', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
    const org = owner.orgSlug ?? '';
    await turnOn(page, org, 'Questions about tickets?');
    const v = await visitor(browser);
    await v.page.goto(`/ar/o/${org}/contact`);
    await expect(v.page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(v.page.getByRole('button', { name: 'إرسال الرسالة' })).toBeVisible();
    await noHorizontalScroll(v.page);
    await expectAccessible(v.page);
    // Send buttons are touch-sized.
    const box = await v.page.getByRole('button', { name: 'إرسال الرسالة' }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await v.context.close();

    // The seeded tenant site (Harbor Arts): its owner turns the page on; the site's menu links it.
    await signIn(page, 'lee@harbor.test');
    await turnOn(page, 'harbor-arts', 'Ask Harbor Arts anything.');
    const t = await browser.newContext();
    const tp = await t.newPage();
    await tp.goto(`${HARBOR_SITE}/`);
    await tp
      .getByRole('navigation', { name: /Harbor Arts/ })
      .getByRole('link', { name: 'Contact' })
      .click();
    await expect(tp).toHaveURL(`${HARBOR_SITE}/contact`);
    await expect(tp.getByRole('heading', { level: 1, name: 'Contact Harbor Arts' })).toBeVisible();
    await expect(tp.getByText('Ask Harbor Arts anything.')).toBeVisible();
    expect(await tp.content()).not.toContain('lee@harbor.test');
    await expectAccessible(tp);
    await t.close();
  });

  test('viewers see the email settings and the contact page read-only, without visitors’ messages', async ({
    page,
  }) => {
    await signIn(page, 'jordan@lakeside.test');
    await page.goto('/o/lakeside-events/content/contact');
    await expect(page.getByRole('heading', { name: 'Contact page', level: 1 })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Show the contact page on your site' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await expect(
      page.getByText("Messages hold visitors' details: people who edit the site can read them."),
    ).toBeVisible();
    await expectAccessible(page);
  });
});
