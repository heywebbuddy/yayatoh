import { type Browser, expect, type Page, test } from '@playwright/test';
import { expectAccessible, OPEN_HOUSE, signIn, WEDDING, WEDDING_OWNER } from './helpers.ts';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const LAKESIDE = `http://lakeside-events.yayatoh.events:${PORT}`;
const HARBOR = `http://harbor-arts.yayatoh.events:${PORT}`;
const LINKS = `${OPEN_HOUSE}/tracked-links`;
const VIEWER = 'jordan@lakeside.test';

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

/** A pass on the open house for this test only (so each run's revenue is its own). */
async function addPass(page: Page, name: string, price: string) {
  await page.goto(`${OPEN_HOUSE}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Price (USD)').fill(price);
  await page.getByLabel('Quantity available').fill('20');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
}

/** Create a tracked link through the form (mouse); returns its code. */
async function createLink(
  page: Page,
  v: { label: string; source: string; medium: string; campaign: string },
) {
  await page.goto(LINKS);
  const form = page.getByRole('region', { name: 'Create a tracked link' });
  await form.getByLabel('Source', { exact: true }).fill(v.source);
  await form.getByLabel('Medium', { exact: true }).fill(v.medium);
  await form.getByLabel('Campaign', { exact: true }).fill(v.campaign);
  await form.getByLabel('Name (optional)', { exact: true }).fill(v.label);
  await form.getByRole('button', { name: 'Create link' }).click();
  await expect(form.getByText('Tracked link created.')).toBeVisible();
  return codeOf(page, v.label);
}

/** A link's row; the section and its scrollable table share the name, the table is the inner one. */
const linkRow = (page: Page, label: string, region = 'Links and results') =>
  page.getByRole('region', { name: region }).last().getByRole('row').filter({ hasText: label });

async function codeOf(page: Page, label: string): Promise<string> {
  const url = (await linkRow(page, label).getByTestId('tracked-link-url').textContent()) ?? '';
  const m = /\/r\/([a-z0-9]{8})$/.exec(url.trim());
  expect(m, url).not.toBeNull();
  return m?.[1] ?? '';
}

/** A guest buys one pass on the page it is on (paying on the test payment page if it costs). */
async function buy(guest: Page, pass: string, name: string, paid: boolean) {
  await guest.getByLabel(`Quantity — ${pass}`).selectOption('1');
  await guest.getByLabel('Full name').fill(name);
  await guest
    .getByLabel('Email for your tickets')
    .fill(`${name.replace(/\W+/g, '.').toLowerCase()}@example.test`);
  await guest.getByRole('button', { name: 'Continue to payment' }).click();
  if (paid) {
    await expect(guest.getByRole('heading', { name: 'Pay for your order' })).toBeVisible();
    await guest.getByRole('button', { name: 'Pay now (test)' }).click();
  }
  await expect(guest).toHaveURL(/\/orders\//);
  await expect(guest.getByText('Paid', { exact: true })).toBeVisible();
}

const guestPage = async (browser: Browser) => (await browser.newContext()).newPage();

test.describe('tracked links', () => {
  test('an organizer creates a link by keyboard; a guest clicks it on the org site and buys; the report credits the order and revenue', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const s = stamp();
    const pass = `Link pass ${s}`;
    const label = `Newsletter ${s}`;
    await signIn(page);
    await addPass(page, pass, '25');

    // Keyboard only: fill the form with Tab and submit with Enter.
    await page.goto(LINKS);
    await expect(page.getByRole('heading', { name: 'Tracked links', level: 1 })).toBeVisible();
    const form = page.getByRole('region', { name: 'Create a tracked link' });
    await form.getByLabel('Source', { exact: true }).focus();
    await page.keyboard.type('newsletter');
    await page.keyboard.press('Tab');
    await page.keyboard.type('email');
    await page.keyboard.press('Tab');
    await page.keyboard.type(`launch-${s}`);
    await page.keyboard.press('Tab');
    await page.keyboard.type(label);
    await page.keyboard.press('Enter');
    await expect(form.getByText('Tracked link created.')).toBeVisible();
    const row = linkRow(page, label);
    await expect(row).toContainText(`newsletter / email / launch-${s}`);
    await expect(row.getByRole('cell').nth(4)).toHaveText('0%');
    const code = await codeOf(page, label);
    await expectAccessible(page);
    // Persists after a reload; the copy button works from the keyboard.
    await page.reload();
    await linkRow(page, label)
      .getByRole('button', { name: `Copy link ${label}` })
      .focus();
    await page.keyboard.press('Enter');
    await expect(linkRow(page, label).getByText('Copied')).toBeVisible();

    // A guest follows the link on the org's own site: redirected to the event page with UTM + click id.
    const guest = await guestPage(browser);
    await guest.goto(`${LAKESIDE}/r/${code}`);
    const landed = new URL(guest.url());
    expect(landed.origin).toBe(LAKESIDE);
    expect(landed.pathname).toBe('/events/lakeside-open-house');
    expect(landed.searchParams.get('utm_source')).toBe('newsletter');
    expect(landed.searchParams.get('utm_medium')).toBe('email');
    expect(landed.searchParams.get('utm_campaign')).toBe(`launch-${s}`);
    expect(landed.searchParams.get('yyc')).toMatch(/^[0-9a-f-]{36}~[A-Za-z0-9_-]{32}$/);
    const cookies = await guest.context().cookies(LAKESIDE);
    expect(cookies.find((c) => c.name === 'yy_click')?.httpOnly).toBe(true);
    await buy(guest, pass, `Ada Link ${s}`, true);

    // The report: one click, one paid order, $25.00, 100 % conversion.
    await page.goto(LINKS);
    const done = linkRow(page, label);
    await expect(done.getByRole('cell').nth(1)).toHaveText('1');
    await expect(done.getByRole('cell').nth(2)).toHaveText('1');
    await expect(done.getByRole('cell').nth(3)).toHaveText('$25.00');
    await expect(done.getByRole('cell').nth(4)).toHaveText('100%');

    // The link's own page: URL, QR, figures and the attributed order.
    await done.getByRole('link', { name: label }).click();
    await expect(page.getByRole('heading', { name: label, level: 1 })).toBeVisible();
    await expect(page.getByTestId('tracked-link-url')).toHaveText(new RegExp(`/r/${code}$`));
    await expect(page.getByRole('img', { name: /^QR code for http.*\/r\/[a-z0-9]{8}$/ })).toBeVisible();
    await expect(page.getByTestId('figure-clicks')).toHaveText('1');
    await expect(page.getByTestId('figure-orders')).toHaveText('1');
    await expect(page.getByTestId('figure-first-touch')).toHaveText('1');
    await expect(page.getByTestId('figure-revenue')).toHaveText('$25.00');
    const orders = page.getByRole('region', { name: 'Orders from this link' }).last();
    await expect(orders.getByRole('row')).toHaveCount(2);
    await expect(orders.getByRole('row').nth(1)).toContainText('First and last click');
    await expect(orders.getByRole('row').nth(1)).toContainText('Paid');
    await expect(orders.getByRole('row').nth(1)).toContainText('$25.00');
    await expectAccessible(page);

    // The order carries its attribution record.
    await orders.getByRole('row').nth(1).getByRole('link').click();
    const attribution = page.getByRole('region', { name: 'Where this order came from' });
    await expect(attribution.getByTestId('attribution-lastTouch')).toContainText(
      `newsletter / email / launch-${s}`,
    );
    await expect(attribution.getByTestId('attribution-lastTouch')).toContainText(`/r/${code}`);
    await expect(attribution.getByTestId('attribution-firstTouch')).toContainText('Tracked link click');
  });

  test('validation: blank and unsafe values are refused with messages; the form keeps what was typed', async ({
    page,
  }) => {
    const s = stamp();
    await signIn(page);
    await page.goto(LINKS);
    const form = page.getByRole('region', { name: 'Create a tracked link' });
    await form.getByLabel('Source', { exact: true }).fill('   ');
    await form.getByLabel('Medium', { exact: true }).fill('email');
    await form.getByLabel('Campaign', { exact: true }).fill(`bad-${s}`);
    await form.getByRole('button', { name: 'Create link' }).click();
    await expect(form.getByText('Enter a value.')).toBeVisible();
    await expect(form.getByLabel('Source', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(form.getByText('Check the highlighted fields.')).toBeVisible();
    await expect(form.getByLabel('Campaign', { exact: true })).toHaveValue(`bad-${s}`);

    await form.getByLabel('Source', { exact: true }).fill('newsletter');
    for (const [path, message] of [
      ['https://evil.example/phish', 'Enter a path on your site that starts with /, not a web address.'],
      ['//evil.example', 'Enter a path on your site that starts with /, not a web address.'],
      ['/%2F%2Fevil.example', "This path has characters that aren't allowed."],
    ] as const) {
      await form.getByLabel('Page (optional)', { exact: true }).fill(path);
      await form.getByRole('button', { name: 'Create link' }).click();
      await expect(form.getByText(message)).toBeVisible();
      await expect(form.getByLabel('Page (optional)', { exact: true })).toHaveAttribute(
        'aria-invalid',
        'true',
      );
    }
    await expectAccessible(page);
    await expect(linkRow(page, `bad-${s}`)).toHaveCount(0);

    // A same-site page is accepted and the redirect goes there.
    await form.getByLabel('Page (optional)', { exact: true }).fill('/events/lakeside-open-house/seat-finder');
    await form.getByRole('button', { name: 'Create link' }).click();
    await expect(form.getByText('Tracked link created.')).toBeVisible();
    const code = await codeOf(page, `bad-${s}`);
    const res = await page.request.get(`/r/${code}`, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers().location).toMatch(
      /^\/events\/lakeside-open-house\/seat-finder\?utm_source=newsletter&/,
    );
  });

  test('the redirector: 302 no-store; bots are redirected but not counted; unknown and other-org codes are 404', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    await signIn(page);
    const label = `Redirector ${s}`;
    const code = await createLink(page, { label, source: 'poster', medium: 'print', campaign: `r-${s}` });

    const bot = await browser.newContext({
      userAgent: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    });
    const preview = await bot.request.get(`/r/${code}?utm_term=gala`, { maxRedirects: 0 });
    expect(preview.status()).toBe(302);
    expect(preview.headers()['cache-control']).toContain('no-store');
    expect(preview.headers().location).toContain('utm_term=gala');
    expect(preview.headers().location).not.toContain('yyc=');
    expect(preview.headers()['set-cookie'] ?? '').not.toContain('yy_click');

    const human = await (await browser.newContext()).request.get(`/r/${code.toUpperCase()}`, {
      maxRedirects: 0,
    });
    expect(human.status()).toBe(302);
    expect(human.headers()['cache-control']).toContain('no-store');
    expect(human.headers().location).toMatch(
      /^\/events\/lakeside-open-house\?utm_source=poster&utm_medium=print&utm_campaign=r-\d+&yyc=/,
    );

    // Only the human click counts.
    await page.goto(LINKS);
    await expect(linkRow(page, label).getByRole('cell').nth(1)).toHaveText('1');

    expect((await page.request.get('/r/zzzzzzzz', { maxRedirects: 0 })).status()).toBe(404);
    // Lakeside's link on Harbor's site is not Harbor's link.
    // (Navigated: only the browser maps the tenant hosts to this server.)
    expect((await page.goto(`${HARBOR}/r/${code}`))?.status()).toBe(404);
    // The internal tenant route is never reachable directly.
    expect(
      (
        await page.request.get(`/t/00000000-0000-0000-0000-000000000000/r/${code}`, { maxRedirects: 0 })
      ).status(),
    ).toBe(404);
  });

  test('a tampered click id is ignored: the purchase is not credited to the link', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const s = stamp();
    const pass = `Tamper pass ${s}`;
    const label = `Tamper ${s}`;
    await signIn(page);
    await addPass(page, pass, '0');
    const code = await createLink(page, { label, source: 'flyer', medium: 'print', campaign: `t-${s}` });
    // A real click (another visitor) yields a real token; the buyer alters one character of it.
    const res = await (await browser.newContext()).request.get(`/r/${code}`, { maxRedirects: 0 });
    const real = new URL(res.headers().location ?? '', 'http://x').searchParams.get('yyc') ?? '';
    expect(real).toMatch(/~/);
    const tampered = `${real.slice(0, -1)}${real.endsWith('A') ? 'B' : 'A'}`;

    // Control: the untouched token in a shared URL is accepted as the visitor's click.
    const shared = await guestPage(browser);
    await shared.goto(`/events/lakeside-open-house?yyc=${encodeURIComponent(real)}`);
    expect((await shared.context().cookies()).find((c) => c.name === 'yy_click')?.value).toBe(real);

    const guest = await guestPage(browser);
    await guest.goto(`/events/lakeside-open-house?yyc=${encodeURIComponent(tampered)}`);
    expect((await guest.context().cookies()).some((c) => c.name === 'yy_click')).toBe(false);
    await buy(guest, pass, `Mallory ${s}`, false);

    await page.goto(LINKS);
    const row = linkRow(page, label);
    await expect(row.getByRole('cell').nth(1)).toHaveText('1');
    await expect(row.getByRole('cell').nth(2)).toHaveText('0');
    await expect(row.getByRole('cell').nth(3)).toHaveText('—');
  });

  test('UTM-only: a guest who lands with UTM tags and buys is listed without a tracked link', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const s = stamp();
    const pass = `UTM pass ${s}`;
    await signIn(page);
    await addPass(page, pass, '0');
    const guest = await guestPage(browser);
    await guest.goto(
      `/events/lakeside-open-house?utm_source=partner-${s}&utm_medium=referral&utm_campaign=spring`,
    );
    await buy(guest, pass, `Una Tagged ${s}`, false);
    await page.goto(LINKS);
    const table = page.getByRole('region', { name: 'Orders from UTM tags without a tracked link' }).last();
    const row = table.getByRole('row').filter({ hasText: `partner-${s}` });
    await expect(row).toContainText('referral');
    await expect(row).toContainText('spring');
    await expect(row.getByRole('cell').nth(3)).toHaveText('1');
  });

  test('empty states, and the attribution window is saved and kept after a reload', async ({ page }) => {
    await signIn(page, WEDDING_OWNER);
    await page.goto(`${WEDDING}/tracked-links`);
    await expect(page.getByText('No tracked links yet.')).toBeVisible();
    await expect(page.getByText('No orders from UTM tags alone yet.')).toBeVisible();
    const windowField = page.getByLabel('Attribution window (days)', { exact: true });
    await windowField.fill('14');
    await page.getByRole('button', { name: 'Save window' }).click();
    await expect(page.getByText('Attribution window saved.')).toBeVisible();
    await page.reload();
    await expect(windowField).toHaveValue('14');
    await expect(page.getByText(/within 14 days before an order/)).toBeVisible();
    await expectAccessible(page);
    await windowField.fill('30');
    await page.getByRole('button', { name: 'Save window' }).click();
    await expect(page.getByText('Attribution window saved.')).toBeVisible();
  });

  test('a viewer reads links and results but cannot create them; a stale form is refused', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    await signIn(page);
    const label = `Viewer ${s}`;
    await createLink(page, { label, source: 'radio', medium: 'audio', campaign: `v-${s}` });

    const viewer = await guestPage(browser);
    await signIn(viewer, VIEWER);
    await viewer.goto(OPEN_HOUSE);
    // In the event's navigation (a sidebar on desktop, a menu on small screens).
    await expect(viewer.locator(`a[href$="${LINKS}"]`, { hasText: 'Tracked links' }).first()).toBeAttached();
    await viewer.goto(LINKS);
    await expect(viewer.getByRole('heading', { name: 'Tracked links', level: 1 })).toBeVisible();
    await expect(
      viewer.getByText(
        'You can view tracked links and their results. Only organizers with marketing rights can create links.',
      ),
    ).toBeVisible();
    await expect(linkRow(viewer, label)).toBeVisible();
    await expect(viewer.getByRole('region', { name: 'Create a tracked link' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Create link' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Save window' })).toHaveCount(0);
    await expectAccessible(viewer);

    // The owner's open form, submitted after the session became the viewer's: refused by the server.
    await page.goto(LINKS);
    const form = page.getByRole('region', { name: 'Create a tracked link' });
    await form.getByLabel('Source', { exact: true }).fill('sneaky');
    await form.getByLabel('Medium', { exact: true }).fill('email');
    await form.getByLabel('Campaign', { exact: true }).fill(`sneaky-${s}`);
    await signIn(page, VIEWER);
    await form.getByRole('button', { name: 'Create link' }).click();
    await expect(form.getByRole('alert').filter({ hasText: "You don't have access to this." })).toBeVisible();
  });

  test('Arabic: the links page and report render right-to-left and the redirect keeps the locale', async ({
    page,
  }) => {
    const s = stamp();
    await signIn(page);
    const label = `RTL ${s}`;
    const code = await createLink(page, { label, source: 'sms', medium: 'text', campaign: `ar-${s}` });
    await page.goto(`/ar${LINKS}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'الروابط المتتبَّعة', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'إنشاء الرابط' })).toBeVisible();
    await expectAccessible(page);
    await linkRow(page, label, 'الروابط والنتائج').getByRole('link', { name: label }).click();
    await expect(page.getByRole('heading', { name: 'النتائج', exact: true })).toBeVisible();
    await expect(page.getByTestId('tracked-link-url')).toHaveAttribute('dir', 'ltr');
    await expectAccessible(page);
    const res = await page.request.get(`/ar/r/${code}`, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers().location).toMatch(/^\/ar\/events\/lakeside-open-house\?/);
  });
});
