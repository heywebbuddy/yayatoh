import { type Browser, expect, type Page, test } from '@playwright/test';
import { continueToPayment, expectAccessible, signIn } from './helpers.ts';

/**
 * M3.1a: the event home's key numbers now come from the metric projection (metric_snapshots,
 * fed by the outbox). They must stay exactly the numbers of the full report (which reads the
 * transactional tables live) through sales, a declined card, a check-in and its undo, after a
 * reload, for a viewer, from the keyboard and in Arabic.
 */

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

const usd = (minor: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);

async function newEvent(page: Page, name: string): Promise<string> {
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
  return base;
}

async function addPass(page: Page, base: string, name: string, price: string, quantity: string) {
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Price (USD)').fill(price);
  await page.getByLabel('Quantity available').fill(quantity);
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
}

async function guestBuys(
  browser: Browser,
  slug: string,
  opts: { pass: string; qty: string; name: string; email: string; outcome: 'pay' | 'decline' | 'free' },
) {
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/events/${slug}`);
  await guest.getByLabel(`Quantity — ${opts.pass}`).selectOption(opts.qty);
  await guest.getByLabel('Full name').fill(opts.name);
  await guest.getByLabel('Email for your tickets').fill(opts.email);
  await continueToPayment(guest, opts.email);
  if (opts.outcome === 'free') {
    await expect(guest).toHaveURL(/\/orders\//);
    return { guest, amount: 0 };
  }
  await expect(guest.getByRole('heading', { name: 'Pay for your order' })).toBeVisible();
  const amount = Number(new URL(guest.url()).searchParams.get('amount'));
  await guest
    .getByRole('button', { name: opts.outcome === 'pay' ? /^Pay/ : 'Simulate a declined card' })
    .click();
  await expect(guest).toHaveURL(/\/orders\/[A-Za-z0-9_-]{43}$/);
  return { guest, amount };
}

const tile = (page: Page, label: string) =>
  page
    .getByRole('region', { name: 'Key numbers', exact: true })
    .getByText(label, { exact: true })
    .locator('..');

/** The four tiles' text on the event home. */
async function tiles(page: Page, labels: string[]) {
  const out: Record<string, string> = {};
  for (const l of labels) out[l] = (await tile(page, l).innerText()).replace(/\s+/g, ' ').trim();
  return out;
}

/** Tab through the page until the named link has focus (keyboard-only). */
async function tabTo(page: Page, name: string, max = 80) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    if (focused === name) return;
  }
  throw new Error(`"${name}" never received focus`);
}

test.describe('metrics projection behind the dashboard (M3.1a)', () => {
  test('key numbers follow sales and check-ins and equal the full report', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const stamp = `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;
    await signIn(page);
    const base = await newEvent(page, `Metrics ${stamp}`);
    const slug = base.split('/').pop() as string;
    await addPass(page, base, 'General', '20', '10');
    await addPass(page, base, 'Guest pass', '0', '5');

    // Empty state until something sells (the projection exists, nothing sold).
    await page.goto(base);
    await expect(page.getByText('No sales yet', { exact: true })).toBeVisible();
    await expectAccessible(page);

    const paid = await guestBuys(browser, slug, {
      pass: 'General',
      qty: '2',
      name: `Mia Paid ${stamp}`,
      email: `mia+${stamp}@example.test`,
      outcome: 'pay',
    });
    const comp = await guestBuys(browser, slug, {
      pass: 'Guest pass',
      qty: '1',
      name: `Cal Comp ${stamp}`,
      email: `cal+${stamp}@example.test`,
      outcome: 'free',
    });
    await guestBuys(browser, slug, {
      pass: 'General',
      qty: '1',
      name: `Dee Declined ${stamp}`,
      email: `dee+${stamp}@example.test`,
      outcome: 'decline',
    });
    const compCode =
      (await comp.guest.locator('.tracking-\\[0\\.2em\\]').first().textContent())?.trim() ?? '';
    expect(compCode).toMatch(/^[2-9A-Z]{8}$/);

    // The home reflects the sales at once (read-your-writes), before any check-in.
    await page.goto(base);
    await expect(tile(page, 'Gross sales')).toContainText(usd(paid.amount));
    await expect(tile(page, 'Tickets sold')).toContainText('2');
    await expect(tile(page, 'Tickets sold')).toContainText('of 15 places · 1 complimentary');
    await expect(tile(page, 'Checked in')).toContainText('0% of 3 valid tickets');
    await expectAccessible(page);

    // Check the complimentary guest in: the sharded check-in counter moves.
    await page.goto(`${base}/onsite`);
    await page.getByLabel('Ticket code').fill(compCode);
    await page.getByLabel('Ticket code').press('Enter');
    await expect(page.getByRole('status').filter({ has: page.locator('[data-result]') })).toContainText(
      'Welcome in',
    );
    await page.goto(base);
    await expect(tile(page, 'Checked in')).toContainText('33.3% of 3 valid tickets');
    const home = await tiles(page, ['Gross sales', 'Net revenue', 'Tickets sold', 'Checked in']);
    expect(home['Checked in']).toMatch(/^Checked in 1 /i);

    // Persistence: a reload shows the same numbers.
    await page.reload();
    expect(await tiles(page, ['Gross sales', 'Net revenue', 'Tickets sold', 'Checked in'])).toEqual(home);

    // Keyboard only: reach the full report from the tiles.
    await page.locator('body').focus();
    await tabTo(page, 'See the full report');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${base}/analysis$`));
    // The report (live from the transactional tables) shows the same figures.
    const report = page.getByRole('region', { name: 'Key numbers', exact: true });
    await expect(report.getByText('Gross sales', { exact: true }).locator('..')).toContainText(
      usd(paid.amount),
    );
    await expect(report.getByText('Checked in', { exact: true }).locator('..')).toContainText('1');
    await expect(page.getByRole('term').filter({ hasText: 'Failed payments' }).locator('..')).toContainText(
      '1',
    );
    await expectAccessible(page);

    // Undo the check-in: the counter goes back.
    await page.goto(`${base}/onsite`);
    const undo = page.getByRole('button', { name: `Undo check-in for Cal Comp ${stamp}` });
    await undo.click();
    // The undo committed once the door screen drops it (navigating sooner can cancel the action).
    await expect(undo).toHaveCount(0);
    await page.goto(base);
    await expect(tile(page, 'Checked in')).toContainText('0% of 3 valid tickets');
    await expectAccessible(page);

    // A viewer sees orders (with the failed payment), never net revenue.
    const viewer = await browser.newContext();
    const vp = await viewer.newPage();
    await signIn(vp, 'jordan@lakeside.test');
    await vp.goto(base);
    await expect(tile(vp, 'Orders')).toContainText('2');
    await expect(tile(vp, 'Orders')).toContainText('1 failed payment');
    await expect(tile(vp, 'Gross sales')).toContainText(usd(paid.amount));
    await expect(vp.getByText('Net revenue', { exact: true })).toHaveCount(0);
    await expectAccessible(vp);
    await viewer.close();

    // Arabic, right to left: the same tiles, translated.
    await page.goto(`/ar${base}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const ar = page.getByRole('region', { name: 'الأرقام الرئيسية', exact: true });
    await expect(ar.getByText('إجمالي المبيعات', { exact: true })).toBeVisible();
    await expect(ar.getByText('صافي الإيرادات', { exact: true })).toBeVisible();
    await expect(ar.getByText('تم تسجيل دخولهم', { exact: true })).toBeVisible();
    await expectAccessible(page);
  });
});
