import { type Browser, expect, type Page, test } from '@playwright/test';
import { continueToPayment, expectAccessible, lastEmailedCode, signIn, wrongCode } from './helpers.ts';
import { addTicketType, createGala, publishEvent, unique } from './seating-helpers.ts';

/**
 * M1.5f: guest checkout with an emailed code, attendee sign-in ("My tickets") on the org's site
 * and the marketplace, order links (resend, organizer reissue) and the organizer's name poster.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const LAKESIDE = `http://lakeside-events.yayatoh.events:${PORT}`;
const MARKET = `http://yayatoh.localhost:${PORT}`;
const VIEWER = 'jordan@lakeside.test';

const emailFor = (tag: string) =>
  `${tag}.${Date.now()}.${test.info().project.name.split('-')[0]}@example.test`.toLowerCase();

async function guestPage(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

/** A published event with one free pass, as the Lakeside owner; its console path and slug. */
async function freeEvent(page: Page, what: string) {
  await signIn(page);
  const base = await createGala(page, unique(what));
  await addTicketType(page, base, 'Free pass', '0', 100);
  await publishEvent(page, base);
  return { base, slug: base.split('/').pop() as string };
}

/** Fill the checkout form for one free pass (no submit). */
async function fillCheckout(guest: Page, name: string, email: string) {
  await guest.getByLabel('Quantity — Free pass').selectOption('1');
  await guest.getByLabel('Full name').fill(name);
  await guest.getByLabel('Email for your tickets').fill(email);
}

const codeField = (p: Page) => p.getByLabel('Verification code', { exact: true });

async function drain(page: Page) {
  const res = await page.request.post('/api/dev/outbox/drain', { form: { org: 'lakeside-events' } });
  expect(res.status()).toBe(200);
}

/**
 * The newest dev-mailbox message to an address whose subject matches. Queued messages (order
 * links) need the dev drain: `drainFirst` runs it on each try, so a busy database only waits.
 */
async function mailTo(page: Page, email: string, subject: RegExp, drainFirst = false) {
  let found: { subject: string; text: string } | undefined;
  await expect
    .poll(
      async () => {
        if (drainFirst) await drain(page);
        const res = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`);
        const list = (await res.json()) as { subject: string; text: string }[];
        found = list.find((m) => subject.test(m.subject));
        return Boolean(found);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return found as { subject: string; text: string };
}
const firstUrl = (text: string, path: RegExp) =>
  (text.match(/https?:\/\/[^\s]+/g) ?? []).find((u) => path.test(new URL(u).pathname)) ?? '';

test.describe('guest checkout with an emailed code', () => {
  test('wrong code, five tries lock it, resend after the cooldown, then the order; keyboard only; axe', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const { slug } = await freeEvent(page, 'OTP checkout');
    const guest = await guestPage(browser);
    const email = emailFor('otp');
    await guest.goto(`/events/${slug}`);
    await fillCheckout(guest, 'Otto Code', email);
    // Keyboard: Enter in the email field submits; the code step takes focus.
    await guest.getByLabel('Email for your tickets').press('Enter');
    await expect(guest.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
    await expect(guest.getByText(`We emailed a 6-digit code to ${email}.`)).toBeVisible();
    await expect(codeField(guest)).toBeFocused();
    // No order yet: the pass is not held and the Continue button is gone during the step.
    await expect(guest.getByRole('button', { name: 'Continue to payment' })).toHaveCount(0);
    const resend = guest.getByRole('button', { name: 'Send a new code' });
    await expect(resend).toBeDisabled();
    await expect(guest.getByText(/You can ask for a new code in \d+ seconds?\./)).toBeVisible();
    await expectAccessible(guest);

    const right = await lastEmailedCode(guest, email);
    const wrong = wrongCode(() => right);
    await guest.keyboard.type(wrong);
    await guest.keyboard.press('Enter');
    await expect(guest.getByText("That code isn't right. 4 tries left.")).toBeVisible();
    await expect(codeField(guest)).toBeFocused();
    await expect(codeField(guest)).toHaveValue('');
    await expectAccessible(guest);
    for (const left of ['3 tries left', '2 tries left', '1 try left']) {
      await codeField(guest).fill(wrong);
      await guest.getByRole('button', { name: 'Verify and continue' }).click();
      await expect(guest.getByText(`That code isn't right. ${left}.`)).toBeVisible();
    }
    await codeField(guest).fill(wrong);
    await guest.getByRole('button', { name: 'Verify and continue' }).click();
    await expect(guest.getByText('Too many wrong codes. Ask for a new code.')).toBeVisible();
    // Locked: even the right code is refused now.
    await codeField(guest).fill(right);
    await guest.getByRole('button', { name: 'Verify and continue' }).click();
    await expect(guest.getByText('Too many wrong codes. Ask for a new code.')).toBeVisible();
    await expect(guest).toHaveURL(new RegExp(`/events/${slug}$`));

    // The cooldown ends (30 s after the code), then a new code goes out.
    await expect(resend).toBeEnabled({ timeout: 35_000 });
    await resend.focus();
    await guest.keyboard.press('Enter');
    await expect(guest.getByText(/You can ask for a new code in \d+ seconds?\./)).toBeVisible();
    await expect.poll(() => lastEmailedCode(guest, email)).not.toBe(right);
    await codeField(guest).fill(await lastEmailedCode(guest, email));
    await guest.getByRole('button', { name: 'Verify and continue' }).click();
    await expect(guest).toHaveURL(/\/orders\/[A-Za-z0-9_-]{43}$/);
    await expect(guest.getByText('Paid', { exact: true })).toBeVisible();
    await expectAccessible(guest);
  });

  test('an expired code is refused; a verified address skips the code on the next checkout in this browser', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const { slug } = await freeEvent(page, 'OTP expiry');
    const guest = await guestPage(browser);
    const email = emailFor('expire');
    await guest.goto(`/events/${slug}`);
    await fillCheckout(guest, 'Eve Expired', email);
    await guest.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(codeField(guest)).toBeVisible();
    const code = await lastEmailedCode(guest, email);
    const res = await guest.request.post(`/api/dev/guest-code?to=${encodeURIComponent(email)}&expire=1`);
    expect(res.status()).toBe(200);
    await codeField(guest).fill(code);
    await guest.getByRole('button', { name: 'Verify and continue' }).click();
    await expect(
      guest.getByText('That code has expired or was already used. Ask for a new code.'),
    ).toBeVisible();
    await expectAccessible(guest);

    // A buyer who proves the address checks out; the next order with it needs no code.
    const buyer = await guestPage(browser);
    const proven = emailFor('proven');
    await buyer.goto(`/events/${slug}`);
    await fillCheckout(buyer, 'Val Verified', proven);
    await continueToPayment(buyer, proven);
    await expect(buyer).toHaveURL(/\/orders\//);
    await buyer.goto(`/events/${slug}`);
    await fillCheckout(buyer, 'Val Verified', proven);
    await continueToPayment(buyer, proven, { verify: false });
    await expect(buyer).toHaveURL(/\/orders\//);
    await expect(buyer.getByText('Paid', { exact: true })).toBeVisible();
    // Reloading keeps the order; another address in the same browser still needs its own code.
    await buyer.reload();
    await expect(buyer.getByText('Paid', { exact: true })).toBeVisible();
    await buyer.goto(`/events/${slug}`);
    await fillCheckout(buyer, 'Val Verified', emailFor('other'));
    await buyer.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(codeField(buyer)).toBeVisible();
  });

  test('the organizer can turn the email check off for an event; a viewer sees it read-only and cannot change it', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const { base, slug } = await freeEvent(page, 'OTP setting');
    await page.goto(`${base}/tickets-orders`);
    const box = page.getByLabel('Ask buyers to confirm their email with a code before ordering');
    await expect(box).toBeChecked();
    await expectAccessible(page);
    await box.uncheck();
    await page.getByRole('button', { name: 'Save email check' }).click();
    await expect(page.getByText('Email check saved.')).toBeVisible();
    await page.reload();
    await expect(box).not.toBeChecked();

    const guest = await guestPage(browser);
    await guest.goto(`/events/${slug}`);
    await fillCheckout(guest, 'Nora Nocode', emailFor('nocode'));
    await guest.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(guest).toHaveURL(/\/orders\//);

    // A viewer: the state in words, no control; a stale owner page's save is refused.
    const viewer = await guestPage(browser);
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/tickets-orders`);
    await expect(viewer.getByText('Buyers order without confirming their email.')).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Save email check' })).toHaveCount(0);
    await expectAccessible(viewer);
    await page.goto(`${base}/tickets-orders`);
    await signIn(page, VIEWER);
    await box.check();
    await page.getByRole('button', { name: 'Save email check' }).click();
    await expect(page.getByRole('alert').filter({ hasText: "You don't have access to this." })).toBeVisible();
    await viewer.reload();
    await expect(viewer.getByText('Buyers order without confirming their email.')).toBeVisible();
  });

  test('Arabic: the code step reads right to left', async ({ page, browser }) => {
    test.setTimeout(90_000);
    const { slug } = await freeEvent(page, 'OTP Arabic');
    const guest = await guestPage(browser);
    const email = emailFor('arabic');
    await guest.goto(`/ar/events/${slug}`);
    await expect(guest.locator('html')).toHaveAttribute('dir', 'rtl');
    await guest.locator('select[name^="qty:"]').first().selectOption('1');
    await guest.locator('#name').fill('ليلى');
    await guest.locator('#email').fill(email);
    await guest.locator('#email').press('Enter');
    await expect(guest.getByRole('heading', { name: 'أكّد بريدك الإلكتروني' })).toBeVisible();
    await expect(guest.getByLabel('رمز التحقق', { exact: true })).toBeFocused();
    await expectAccessible(guest);
    await guest.getByLabel('رمز التحقق', { exact: true }).fill(await lastEmailedCode(guest, email));
    await guest.getByRole('button', { name: 'تحقّق وتابِع' }).click();
    await expect(guest).toHaveURL(/\/ar\/orders\//);
  });
});

test.describe('My tickets', () => {
  test('on the org site: sign in with the code (wrong code first), see the order, open it, reload, sign out', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const { slug } = await freeEvent(page, 'My tickets code');
    const email = emailFor('mine');
    const buyer = await guestPage(browser);
    await buyer.goto(`/events/${slug}`);
    await fillCheckout(buyer, 'Mia Mine', email);
    await continueToPayment(buyer, email);
    await expect(buyer).toHaveURL(/\/orders\//);
    const orderPath = new URL(buyer.url()).pathname;

    const site = await guestPage(browser);
    await site.goto(`${LAKESIDE}/my-tickets`);
    await expect(site.getByRole('heading', { name: 'My tickets', level: 1 })).toBeVisible();
    await expectAccessible(site);
    // Keyboard only: type the address, Enter.
    await site.getByLabel('Your email', { exact: true }).fill(email);
    await site.getByLabel('Your email', { exact: true }).press('Enter');
    await expect(codeField(site)).toBeFocused();
    await expect(site.getByText(`We emailed a 6-digit code to ${email}.`)).toBeVisible();
    await expectAccessible(site);
    const right = await lastEmailedCode(site, email);
    await site.keyboard.type(wrongCode(() => right));
    await site.keyboard.press('Enter');
    await expect(site.getByText("That code isn't right. 4 tries left.")).toBeVisible();
    await site.keyboard.type(right);
    await site.keyboard.press('Enter');
    await expect(site.getByText(`Signed in as ${email}`)).toBeVisible();
    const orders = site.getByRole('list', { name: 'Your orders' });
    await expect(orders.getByRole('heading', { name: /^My tickets code/ })).toBeVisible();
    await expectAccessible(site);
    await site.reload();
    await expect(site.getByText(`Signed in as ${email}`)).toBeVisible();
    await orders.getByRole('link', { name: /^Open order for / }).click();
    await expect(site).toHaveURL(new RegExp(`${orderPath}$`));
    await expect(site.getByText('Paid', { exact: true })).toBeVisible();

    // The attendee session is separate from the organizer console and bound to this host.
    const other = await site.context().newPage();
    await other.goto(`${MARKET}/my-tickets`);
    await expect(other.getByLabel('Your email', { exact: true })).toBeVisible();
    await site.goto(`${LAKESIDE}/my-tickets`);
    await site.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(site.getByText("You're signed out.")).toBeVisible();
    await expect(site.getByLabel('Your email', { exact: true })).toBeVisible();
    await expectAccessible(site);
  });

  test('an address with no orders sees the empty state once proved; sign out on all devices', async ({
    browser,
  }) => {
    const email = emailFor('empty');
    const one = await guestPage(browser);
    await one.goto(`${LAKESIDE}/my-tickets`);
    await one.getByRole('button', { name: 'Email me a code' }).click();
    await expect(one.getByRole('alert').filter({ hasText: 'Enter a valid email address.' })).toHaveCount(0);
    await one.getByLabel('Your email', { exact: true }).fill(email);
    await one.getByRole('button', { name: 'Email me a code' }).click();
    await codeField(one).fill(await lastEmailedCode(one, email));
    await one.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(one.getByText('No orders for this address yet')).toBeVisible();
    await expectAccessible(one);
    await one.getByRole('button', { name: 'Sign out on all devices' }).click();
    await expect(one.getByText("You're signed out on every device.")).toBeVisible();
  });

  test('on the marketplace by magic link; the link opened in another browser asks for the code; used links stop working', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const { slug } = await freeEvent(page, 'My tickets link');
    const email = emailFor('link');
    const buyer = await guestPage(browser);
    await buyer.goto(`/events/${slug}`);
    await fillCheckout(buyer, 'Lin Link', email);
    await continueToPayment(buyer, email);
    await expect(buyer).toHaveURL(/\/orders\//);

    const me = await guestPage(browser);
    await me.goto(`${MARKET}/my-tickets`);
    await me.getByLabel('Your email', { exact: true }).fill(email);
    await me.getByRole('button', { name: 'Email me a code' }).click();
    await expect(codeField(me)).toBeVisible();
    const mail = await mailTo(me, email, /is your code for My tickets$/);
    const link = firstUrl(mail.text, /\/my-tickets\/verify\//);
    expect(new URL(link).host).toBe(`yayatoh.localhost:${PORT}`);
    await me.goto(link);
    await expect(me.getByText(`Continue to see the tickets for ${email}.`)).toBeVisible();
    await expectAccessible(me);
    await me.getByRole('button', { name: 'Continue to My tickets' }).click();
    await expect(me.getByText(`Signed in as ${email}`)).toBeVisible();
    const orders = me.getByRole('list', { name: 'Your orders' });
    // The marketplace names the organizer of each order.
    await expect(orders.getByText('Lakeside Events')).toBeVisible();
    await expect(orders.getByRole('heading', { name: /^My tickets link/ })).toBeVisible();
    // Used: the same link no longer signs anyone in (a signed-in browser just goes to My tickets).
    const late = await guestPage(browser);
    await late.goto(link);
    await expect(late.getByText('This sign-in link no longer works')).toBeVisible();
    await expect(late.getByLabel('Verification code', { exact: true })).toHaveCount(0);
    await expectAccessible(late);
    await me.goto(link);
    await expect(me).toHaveURL(`${MARKET}/my-tickets`);
    await expect(me.getByText(`Signed in as ${email}`)).toBeVisible();

    // A new link, opened in another browser (forwarded): the code from the same email is needed.
    await me.goto(`${MARKET}/my-tickets`);
    await me.getByRole('button', { name: 'Sign out', exact: true }).click();
    await me.getByLabel('Your email', { exact: true }).fill(email);
    await me.getByRole('button', { name: 'Email me a code' }).click();
    await expect(codeField(me)).toBeVisible();
    const second = firstUrl(
      (
        await (async () => {
          let text = '';
          await expect
            .poll(async () => {
              text = (await mailTo(me, email, /is your code for My tickets$/)).text;
              return firstUrl(text, /\/my-tickets\/verify\//);
            })
            .not.toBe(link);
          return { text };
        })()
      ).text,
      /\/my-tickets\/verify\//,
    );
    const elsewhere = await guestPage(browser);
    await elsewhere.goto(second);
    await expect(elsewhere.getByText(/opened in a different browser/)).toBeVisible();
    await expect(elsewhere.getByRole('button', { name: 'Continue to My tickets' })).toHaveCount(0);
    await expectAccessible(elsewhere);
    await elsewhere.getByLabel('Verification code', { exact: true }).fill('000000');
    await elsewhere.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(elsewhere.getByText(/That code isn't right|That code has expired/)).toBeVisible();
    await elsewhere
      .getByLabel('Verification code', { exact: true })
      .fill(await lastEmailedCode(elsewhere, email));
    await elsewhere.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(elsewhere.getByText(`Signed in as ${email}`)).toBeVisible();
  });

  test('Arabic: My tickets reads right to left', async ({ browser }) => {
    const p = await guestPage(browser);
    await p.goto(`${LAKESIDE}/ar/my-tickets`);
    await expect(p.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(p.getByRole('heading', { name: 'تذاكري', level: 1 })).toBeVisible();
    await expectAccessible(p);
  });
});

test.describe('order links', () => {
  test('"email me my order links" answers the same for any address; the buyer gets a link that opens the order', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const { slug } = await freeEvent(page, 'Resend links');
    const email = emailFor('resend');
    const buyer = await guestPage(browser);
    await buyer.goto(`/events/${slug}`);
    await fillCheckout(buyer, 'Rhea Resend', email);
    await continueToPayment(buyer, email);
    await expect(buyer).toHaveURL(/\/orders\//);
    const orderPath = new URL(buyer.url()).pathname;

    const site = await guestPage(browser);
    await site.goto(`${LAKESIDE}/my-tickets`);
    const form = site.getByRole('region', { name: 'Email me my order links' });
    await form.getByRole('button', { name: 'Email my order links' }).click();
    await expect(form.getByLabel('Email you ordered with')).toBeFocused();
    await form.getByLabel('Email you ordered with').fill(`nobody.${Date.now()}@example.test`);
    await form.getByRole('button', { name: 'Email my order links' }).click();
    const answer = "If there are orders for that address, we've emailed their links.";
    await expect(form.getByText(answer)).toBeVisible();
    await site.reload();
    await form.getByLabel('Email you ordered with').fill(email);
    await form.getByRole('button', { name: 'Email my order links' }).click();
    await expect(form.getByText(answer)).toBeVisible();
    await expectAccessible(site);
    const mail = await mailTo(page, email, /^Your link to your order for Resend links/, true);
    const link = firstUrl(mail.text, /\/orders\//);
    expect(new URL(link).pathname).toBe(orderPath);
    await site.goto(link);
    await expect(site.getByText('Paid', { exact: true })).toBeVisible();
  });

  test('the organizer revokes and reissues a link: the old one is a 404, the new one works; a viewer cannot', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const { base, slug } = await freeEvent(page, 'Reissue link');
    const email = emailFor('reissue');
    const buyer = await guestPage(browser);
    await buyer.goto(`/events/${slug}`);
    await fillCheckout(buyer, 'Rex Reissue', email);
    await continueToPayment(buyer, email);
    await expect(buyer).toHaveURL(/\/orders\//);
    const oldPath = new URL(buyer.url()).pathname;

    await page.goto(`${base}/tickets-orders`);
    await page.getByRole('row').filter({ hasText: 'Rex Reissue' }).getByRole('link').first().click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
    const orderUrl = page.url();
    await expect(page.getByRole('heading', { name: 'Order link' })).toBeVisible();
    await page.getByRole('button', { name: 'Revoke and reissue link' }).click();
    await expect(page.getByText(`a new one is emailed to ${email}`)).toBeVisible();
    await page.getByRole('button', { name: 'Keep the current link' }).click();
    await expect(page.getByRole('button', { name: 'Revoke and reissue link' })).toBeVisible();
    await page.getByRole('button', { name: 'Revoke and reissue link' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Revoke and send new link' }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByText(`A new link was emailed to ${email}. The old link no longer works.`),
    ).toBeVisible();
    await expectAccessible(page);

    expect((await buyer.request.get(oldPath)).status()).toBe(404);
    const mail = await mailTo(page, email, /^Your new link to your order for Reissue link/, true);
    const fresh = firstUrl(mail.text, /\/orders\//);
    expect(new URL(fresh).pathname).not.toBe(oldPath);
    await buyer.goto(fresh);
    await expect(buyer.getByText('Paid', { exact: true })).toBeVisible();

    // A viewer sees the order but no reissue control; a stale owner page's reissue is refused.
    const viewer = await guestPage(browser);
    await signIn(viewer, VIEWER);
    await viewer.goto(orderUrl);
    await expect(viewer.getByText('Rex Reissue').first()).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Revoke and reissue link' })).toHaveCount(0);
    await page.goto(orderUrl);
    await page.getByRole('button', { name: 'Revoke and reissue link' }).click();
    await signIn(page, VIEWER);
    await page.getByRole('button', { name: 'Revoke and send new link' }).click();
    await expect(page.getByRole('alert').filter({ hasText: "You don't have access to this." })).toBeVisible();
    await buyer.goto(fresh);
    await expect(buyer.getByText('Paid', { exact: true })).toBeVisible();
  });
});
