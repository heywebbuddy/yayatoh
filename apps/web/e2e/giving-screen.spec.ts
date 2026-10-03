import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { continueToPayment, expectAccessible, expectAccessibleBothModes, newUser } from './helpers.ts';

// Each journey opens a projector and phones of its own, and axe runs in light and dark.
test.describe.configure({ timeout: 180_000 });

/**
 * M4.8d live giving screen: the host sets the screen up (every validation, the signed link, table
 * cards), the projector opens the link without signing in, gifts made on phones through the
 * screen's QR code move the thermometer within 3 s, names appear only for donors who asked (P4-13),
 * the level being called and spotters' paddles climb the screen, a dropped connection catches up,
 * high contrast and reduced motion by keyboard and from the link, a replaced link stops, viewers
 * watch without the link, lower roles are refused, an unconnected org gets no QR code, and Arabic
 * RTL. Each test runs in an org of its own.
 */

const stamp = () => `${Date.now().toString(36)}${test.info().project.name.split('-')[0]}`;

interface Gala {
  readonly org: string;
  readonly slug: string;
  readonly base: string;
  readonly donations: string;
  readonly campaign: string;
}

/** A new owner with a published gala (an active payout account unless `connected` is false). */
async function gala(page: Page, connected = true): Promise<Gala> {
  const user = await newUser(page, {
    org: true,
    twoFactor: true,
    event: 'published',
    profile: 'gala',
    ...(connected ? { payouts: 'active' as const } : {}),
  });
  const org = user.orgSlug ?? '';
  const slug = user.eventSlug ?? '';
  const base = `/o/${org}/e/${slug}`;
  const campaign = `Fund-a-need ${stamp()}`;
  await page.goto(`${base}/donations`);
  const form = page.getByRole('region', { name: 'Add campaign' });
  await form.getByLabel('Campaign name').fill(campaign);
  await form.getByLabel('Goal (USD)').fill('10000');
  await form.getByLabel('Smallest own amount (USD)').fill('10');
  await form.getByLabel('Largest own amount (USD)').fill('5000');
  await form.getByRole('button', { name: 'Add campaign' }).click();
  await expect(form.getByText('Campaign added.')).toBeVisible();
  await page.getByText(`Add a level to ${campaign}`).click();
  const card = page.getByRole('listitem').filter({ hasText: `Add a level to ${campaign}` });
  await card.getByLabel('Level name').fill('Fund a classroom');
  await card.getByLabel('Amount (USD)', { exact: true }).fill('1000');
  await card.getByRole('button', { name: 'Add level' }).click();
  await expect(card.getByText('$1,000.00 · Fund a classroom')).toBeVisible();
  return { org, slug, base, donations: `${base}/donations`, campaign };
}

/** The screen page: choose the campaign and set the screen up; returns the projector's link path. */
async function setUpScreen(page: Page, g: Gala): Promise<string> {
  await page.goto(`${g.donations}/screen`);
  await page.getByLabel('Campaign').selectOption({ label: g.campaign });
  await page.getByRole('button', { name: 'Set up the screen' }).click();
  await expect(page.getByText('Screen saved. Open screens update at once.')).toBeVisible();
  return linkPath(page);
}

async function linkPath(page: Page): Promise<string> {
  const url = await page.getByLabel('Screen link').inputValue();
  const path = new URL(url).pathname;
  expect(path).toMatch(/^\/giving-screen\/[0-9a-f-]{36}~[0-9a-f-]{36}~\d+~[\w-]+$/);
  return path;
}

/** The projector: a fresh browser, no sign-in, live once its stream is open. */
async function projector(browser: Browser, path: string): Promise<{ context: BrowserContext; screen: Page }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const screen = await context.newPage();
  await screen.goto(path);
  await expect(screen.locator('[data-stream-state="live"]')).toBeVisible({ timeout: 15_000 });
  return { context, screen };
}

/** The giving page's address inside the screen's QR code (as a phone would open it). */
async function qrPath(screen: Page): Promise<string> {
  const label =
    (await screen.getByRole('img', { name: /QR code to the giving page/ }).getAttribute('aria-label')) ?? '';
  const url = new URL(label.replace(/^.*?: /, ''));
  return `${url.pathname}${url.search}`;
}

/** A phone gives through the giving page and pays on the fake provider's page. */
async function giveFromPhone(
  browser: Browser,
  path: string,
  donor: {
    name: string;
    choice: 'level' | string;
    displayAs: 'Show my full name' | 'Show my first name only' | 'Give anonymously';
    onScreen: boolean;
  },
) {
  const context = await browser.newContext();
  const phone = await context.newPage();
  await phone.goto(path);
  if (donor.choice === 'level') await phone.getByRole('radio', { name: /Fund a classroom/ }).check();
  else await phone.getByLabel('Amount (USD)').fill(donor.choice);
  await phone.getByRole('textbox', { name: 'Full name' }).fill(donor.name);
  await phone.getByLabel('Email').fill(`${donor.name.split(' ')[0]?.toLowerCase()}+${stamp()}@example.test`);
  await phone.getByRole('radio', { name: donor.displayAs }).check();
  const box = phone.getByRole('checkbox', { name: 'Thank me by name on the screen in the room' });
  if (donor.displayAs === 'Give anonymously') await expect(box).toHaveCount(0);
  else {
    await expect(box).not.toBeChecked();
    if (donor.onScreen) await box.check();
  }
  await phone.getByRole('button', { name: /^Give/ }).click();
  await expect(phone).toHaveURL(/\/checkout\/fake\?/);
  await phone.getByRole('button', { name: /^Pay/ }).click();
  await expect(phone.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
  return { context, phone };
}

const total = (screen: Page) => screen.getByTestId('screen-total');
const thanks = (screen: Page) => screen.getByTestId('screen-thanks');

test.describe('live giving screen (M4.8d)', () => {
  test('a gift made on a phone moves the thermometer within 3 s; only opted-in names appear', async ({
    page,
    browser,
  }) => {
    const g = await gala(page);
    // The Donations tab links to the screen.
    await page.goto(g.donations);
    await page.getByTestId('paddle-raise-card').getByRole('link', { name: 'Live screen' }).click();
    await expect(page.getByRole('heading', { name: 'Live screen', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Set up the screen' })).toBeVisible();
    await expect(page.getByLabel('Screen link')).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Thank donors by name' })).toBeChecked();
    await expectAccessibleBothModes(page);
    // Validation: no campaign chosen; the field gets focus and its message.
    await page.getByRole('button', { name: 'Set up the screen' }).click();
    await expect(page.getByText('Choose a campaign of this event.')).toBeVisible();
    await expect(page.getByLabel('Campaign')).toBeFocused();
    await expect(page.getByLabel('Campaign')).toHaveAttribute('aria-invalid', 'true');

    const path = await setUpScreen(page, g);
    await expect(page.getByTestId('screen-giving')).toContainText(
      `The screen's QR code opens the giving page for ${g.campaign}.`,
    );
    await expect(page.getByTestId('screen-thermometer')).toContainText('$0.00');
    await expectAccessibleBothModes(page);
    // Persisted: the same link after a reload.
    await page.reload();
    expect(await linkPath(page)).toBe(path);
    await expect(page.getByRole('heading', { name: 'Screen settings' })).toBeVisible();

    // The projector: no sign-in, the goal, nothing raised yet, the QR code to the giving page.
    const { context, screen } = await projector(browser, path);
    await expect(screen.getByRole('heading', { name: g.campaign, level: 1 })).toBeVisible();
    await expect(total(screen)).toHaveText('$0.00');
    await expect(screen.getByText('0% of the $10,000.00 goal')).toBeVisible();
    await expect(screen.getByTestId('screen-gifts')).toHaveText('Be the first to give');
    await expect(thanks(screen)).toContainText('Every gift counts. Thank you!');
    const give = await qrPath(screen);
    expect(give).toMatch(new RegExp(`^/events/${g.slug}/give\\?c=[0-9a-f-]{36}&via=screen$`));
    await expectAccessible(screen);

    // A phone gives $1,000 and asks to be thanked by name: the screen moves within 3 s.
    const ada = await giveFromPhone(browser, give, {
      name: 'Ada Lovelace',
      choice: 'level',
      displayAs: 'Show my full name',
      onScreen: true,
    });
    await expect(total(screen)).toHaveText('$1,000.00', { timeout: 3_000 });
    await expect(thanks(screen).getByRole('listitem')).toHaveText(['Ada Lovelace']);
    await expect(screen.getByRole('progressbar', { name: 'Progress towards the goal' })).toHaveAttribute(
      'aria-valuenow',
      '100000',
    );
    await expect(screen.getByTestId('screen-fill')).toHaveAttribute('data-percent', '10');
    await expect(screen.getByTestId('screen-gifts')).toHaveText('1 gift');

    // Another gives $25 with their full name but doesn't opt in: the total moves, no name.
    const bo = await giveFromPhone(browser, give, {
      name: 'Bo Quiet',
      choice: '25',
      displayAs: 'Show my full name',
      onScreen: false,
    });
    await expect(total(screen)).toHaveText('$1,025.00', { timeout: 3_000 });
    // An anonymous donor can't opt in at all (the box is gone).
    const eve = await giveFromPhone(browser, give, {
      name: 'Eve Secret',
      choice: '50',
      displayAs: 'Give anonymously',
      onScreen: false,
    });
    await expect(total(screen)).toHaveText('$1,075.00', { timeout: 3_000 });
    await expect(screen.getByTestId('screen-gifts')).toHaveText('3 gifts');
    await expect(thanks(screen).getByRole('listitem')).toHaveText(['Ada Lovelace']);
    const html = await screen.content();
    for (const secret of ['Bo Quiet', 'Eve Secret', 'Secret', '@example.test'])
      expect(html).not.toContain(secret);
    await expectAccessible(screen);

    // The host turns names off: totals only, on the open screen at once.
    await page.getByRole('checkbox', { name: 'Thank donors by name' }).uncheck();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Screen saved. Open screens update at once.')).toBeVisible();
    await expect(thanks(screen).getByRole('listitem')).toHaveCount(0, { timeout: 3_000 });
    await expect(thanks(screen)).toContainText('Every gift counts. Thank you!');
    await Promise.all([context.close(), ada.context.close(), bo.context.close(), eve.context.close()]);
  });

  test('the level being called and spotters’ paddles climb the screen; it catches up after a drop; modes by keyboard; a replaced link stops', async ({
    page,
    browser,
  }) => {
    const g = await gala(page);
    // A purchased table whose party holds a paddle (the host spots it themselves).
    const ticket = 'Table of 2';
    const company = `Acme ${stamp()}`;
    await page.goto(`${g.base}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill(ticket);
    await page.getByLabel('Price (USD)').fill('400');
    await page.getByLabel('Quantity available').fill('10');
    await page.getByLabel('Seats per table').fill('2');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: ticket })).toContainText('Table of 2');
    const bctx = await browser.newContext();
    const buyer = await bctx.newPage();
    const buyerEmail = `chair+${stamp()}@example.test`;
    await buyer.goto(`/events/${g.slug}`);
    await buyer.getByLabel(`Quantity — ${ticket}`).selectOption('1');
    await buyer.getByLabel('Full name').fill('Chair Person');
    await buyer.getByLabel('Email for your tickets').fill(buyerEmail);
    await continueToPayment(buyer, buyerEmail);
    await buyer.getByRole('button', { name: 'Pay now (test)' }).click();
    await expect(buyer.getByText('Paid', { exact: true })).toBeVisible();
    await buyer
      .getByRole('region', { name: 'Your tables' })
      .getByRole('link', { name: `Name guests at ${ticket} #1` })
      .click();
    await buyer.getByLabel('Company or sponsor name').fill(company);
    await buyer.getByRole('button', { name: 'Save name' }).click();
    await expect(buyer.getByText('Name saved.')).toBeVisible();
    await bctx.close();
    await page.goto(`${g.donations}/paddles`);
    const bulk = page.getByRole('region', { name: 'Give paddles in bulk' });
    await bulk.getByLabel('One paddle for').selectOption('party');
    await bulk.getByRole('button', { name: 'Give paddles' }).click();
    await expect(bulk.getByText('Paddles given.')).toBeVisible();
    await expect(
      page.getByRole('table', { name: 'Paddles' }).getByRole('row').filter({ hasText: company }),
    ).toContainText('100');
    const path = await setUpScreen(page, g);

    // Opened in high contrast and reduced motion from the link (a projector without a keyboard).
    const { context, screen } = await projector(browser, `${path}?contrast=high&motion=reduced`);
    await expect(screen.locator('main[data-contrast="high"][data-motion="reduced"]')).toBeVisible();
    await expect(screen.getByRole('button', { name: 'High contrast' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expectAccessible(screen);
    // Keyboard only: both modes off again, then high contrast back on.
    const contrast = screen.getByRole('button', { name: 'High contrast' });
    await contrast.focus();
    await screen.keyboard.press('Enter');
    await expect(screen.locator('main[data-contrast="normal"]')).toBeVisible();
    const motion = screen.getByRole('button', { name: 'Reduced motion' });
    await motion.focus();
    await screen.keyboard.press('Space');
    await expect(screen.locator('main[data-motion="full"]')).toBeVisible();
    await screen.keyboard.press('Shift+Tab');
    await expect(contrast).toBeFocused();
    await screen.keyboard.press('Enter');
    await expect(contrast).toHaveAttribute('aria-pressed', 'true');
    await expectAccessible(screen);

    // The auctioneer calls $1,000: the screen shows it; the spotter's paddle climbs it.
    await page.goto(`${g.donations}/paddle-raise`);
    await page.getByRole('button', { name: 'Call $1,000.00 · Fund a classroom' }).click();
    await expect(page.getByTestId('raise-answer')).toContainText(/./);
    const calling = screen.getByTestId('screen-calling');
    await expect(calling).toContainText('Now calling', { timeout: 3_000 });
    await expect(calling).toContainText('$1,000.00 · Fund a classroom');
    await expect(calling).toContainText('Raise your paddle!');
    const spotter = await page.context().newPage();
    await spotter.goto(`${g.donations}/paddle-raise/spot`);
    await expect(spotter.getByText('$1,000.00 · Fund a classroom')).toBeVisible({ timeout: 10_000 });
    await spotter.getByLabel('Paddle number', { exact: true }).focus();
    await spotter.keyboard.type('100');
    await spotter.keyboard.press('Enter');
    await expect(calling).toContainText('1 paddle raised', { timeout: 5_000 });
    await expect(total(screen)).toHaveText('$1,000.00');
    await expect(screen.getByTestId('screen-gifts')).toHaveText('1 gift');
    // Paddle holders are never named on a screen.
    await expect(screen.getByText(company)).toHaveCount(0);

    // A dropped connection: the level closes meanwhile; back online, the snapshot catches up.
    await context.setOffline(true);
    expect((await page.request.post('/api/dev/seat-streams')).ok()).toBe(true);
    await expect(screen.locator('[data-stream-state="live"]')).toHaveCount(0, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Close Fund a classroom' }).click();
    await expect(page.getByTestId('raise-answer')).toContainText(/./);
    await context.setOffline(false);
    await expect(screen.locator('[data-stream-state="live"]')).toBeVisible({ timeout: 45_000 });
    await expect(screen.getByTestId('screen-calling')).toHaveCount(0, { timeout: 15_000 });
    await expect(total(screen)).toHaveText('$1,000.00');

    // Replacing the link: a second deliberate step; the open screen stops, the old link is a 404.
    await page.goto(`${g.donations}/screen`);
    await page.getByText('Replace the link', { exact: true }).click();
    await page.getByRole('button', { name: 'Replace it (screens on the old link stop)' }).click();
    await expect(
      page.getByText(
        'Link replaced. Screens on the old link have stopped; open the new link on the projector.',
      ),
    ).toBeVisible();
    await expect(screen.getByRole('heading', { name: 'This screen link was replaced' })).toBeVisible({
      timeout: 5_000,
    });
    await expect(screen.getByRole('alert').filter({ hasText: /./ })).toHaveText(
      'Ask the host for the new link.',
    );
    // The page shows the new link once the action's refresh lands.
    await expect.poll(() => linkPath(page)).not.toBe(path);
    const next = await linkPath(page);
    expect((await screen.goto(path))?.status()).toBe(404);
    expect((await screen.goto(next))?.status()).toBe(200);
    await expect(total(screen)).toHaveText('$1,000.00');
    await Promise.all([context.close(), spotter.close()]);
  });

  test('table cards, viewers without the link, lower roles refused, forged links, an unconnected org and Arabic RTL', async ({
    page,
    browser,
  }) => {
    const g = await gala(page);
    // Before the screen is set up, the cards say what to do next.
    await page.goto(`${g.donations}/screen/cards`);
    await expect(page.getByText('Set up the screen first')).toBeVisible();
    const path = await setUpScreen(page, g);
    await page.getByRole('link', { name: 'Print table cards' }).click();
    await expect(page.getByRole('heading', { name: 'Table cards', level: 1 })).toBeVisible();
    await expect(page.getByTestId('table-card')).toHaveCount(4);
    const qr = page
      .getByTestId('table-card')
      .first()
      .getByRole('img', { name: /QR code to the giving page/ });
    await expect(qr).toHaveAttribute(
      'aria-label',
      new RegExp(`/events/${g.slug}/give\\?c=[0-9a-f-]{36}&via=table`),
    );
    await expect(page.getByTestId('table-card').first()).toContainText(
      `Give to ${g.campaign} from your phone.`,
    );
    await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
    await expectAccessibleBothModes(page);
    // A table card's QR opens the giving page for the screen's campaign.
    const label = (await qr.getAttribute('aria-label')) ?? '';
    const card = new URL(label.replace(/^.*?: /, ''));
    const phoneCtx = await browser.newContext();
    const phone = await phoneCtx.newPage();
    await phone.goto(`${card.pathname}${card.search}`);
    await expect(phone.getByRole('heading', { name: g.campaign, level: 1 })).toBeVisible();
    await phoneCtx.close();

    // A viewer watches the preview but gets no settings and no link.
    const vctx = await browser.newContext();
    const viewer = await vctx.newPage();
    await newUser(viewer, { join: [`${g.org}:viewer`] });
    await viewer.goto(`${g.donations}/screen`);
    await expect(viewer.getByRole('heading', { name: 'Live screen', level: 1 })).toBeVisible();
    await expect(
      viewer.getByText(
        'You can watch the screen here. Ask someone who can edit the event to set it up or share its link.',
      ),
    ).toBeVisible();
    await expect(viewer.getByLabel('Screen link')).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await expect(viewer.getByTestId('screen-thermometer')).toContainText('$0.00');
    await expectAccessibleBothModes(viewer);
    await vctx.close();
    // A scanner (no orders) is refused the page.
    const sctx = await browser.newContext();
    const scanner = await sctx.newPage();
    await newUser(scanner, { join: [`${g.org}:scanner`] });
    expect((await scanner.goto(`${g.donations}/screen`))?.status()).toBe(404);
    await sctx.close();

    // Forged or edited links are 404s, for the page and its stream.
    const anon = await browser.newContext();
    const stranger = await anon.newPage();
    const forged = path.replace(/~[\w-]+$/, '~forged');
    expect((await stranger.goto(forged))?.status()).toBe(404);
    expect((await stranger.goto(path.replace(/~(\d+)~/, '~9~')))?.status()).toBe(404);
    expect(
      (
        await stranger.request.get(
          `/api/donations/screen/${encodeURIComponent(forged.split('/').pop() ?? '')}`,
        )
      ).status(),
    ).toBe(404);

    // Arabic RTL: the console page and the screen.
    await page.goto(`/ar${g.donations}/screen`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'الشاشة المباشرة', level: 1 })).toBeVisible();
    await expectAccessibleBothModes(page);
    await stranger.goto(`/ar${path}`);
    await expect(stranger.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(stranger.getByText('ما جُمع حتى الآن')).toBeVisible();
    await expect(stranger.getByRole('img', { name: /رمز QR لصفحة التبرع/ })).toBeVisible();
    await expectAccessible(stranger);
    await anon.close();
  });

  test('an org without a connected account: the screen runs, with no QR code', async ({ page, browser }) => {
    const g = await gala(page, false);
    const path = await setUpScreen(page, g);
    await expect(
      page.getByText(
        'No QR code yet: the giving page takes gifts once Stripe is connected, the event is published and the campaign is open.',
      ),
    ).toBeVisible();
    const { context, screen } = await projector(browser, path);
    await expect(total(screen)).toHaveText('$0.00');
    await expect(screen.getByText('Scan to give')).toHaveCount(0);
    await expectAccessible(screen);
    await context.close();
  });
});
