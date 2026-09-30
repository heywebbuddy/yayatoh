import { type Browser, expect, type Page, test } from '@playwright/test';
import { continueToPayment, expectAccessible, OPEN_HOUSE, signIn } from './helpers.ts';

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

const usd = (minor: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);
const cents = (text: string) => Math.round(Number(text.replace(/[^0-9.]/g, '')) * 100);

/** A fresh published event happening now (check-in open), with its console path. */
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
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toBeVisible();
  return row;
}

/**
 * A guest checks out on the public page. Returns the order page and what was charged (the test
 * payment page carries the exact amount in minor units).
 */
async function guestBuys(
  browser: Browser,
  slug: string,
  opts: {
    pass: string;
    qty: string;
    name: string;
    email: string;
    promo?: string;
    outcome: 'pay' | 'decline' | 'free';
  },
) {
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/events/${slug}`);
  await guest.getByLabel(`Quantity — ${opts.pass}`).selectOption(opts.qty);
  await guest.getByLabel('Full name').fill(opts.name);
  await guest.getByLabel('Email for your tickets').fill(opts.email);
  if (opts.promo) await guest.getByLabel('Promo code').fill(opts.promo);
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

const kpi = (page: Page, region: string, label: string) =>
  page.getByRole('region', { name: region, exact: true }).getByText(label, { exact: true }).locator('..');

test.describe('reports and dashboard (M1.12)', () => {
  test('every number on the dashboard and report matches the orders made through the UI', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const stamp = `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;
    const name = `Report ${stamp}`;
    await signIn(page);
    const base = await newEvent(page, name);
    const slug = base.split('/').pop() as string;

    // Empty states before any sale.
    await expect(page.getByText('No sales yet', { exact: true })).toBeVisible();
    await page.goto(`${base}/analysis`);
    await expect(page.getByRole('heading', { name: 'Analysis', level: 1 })).toBeVisible();
    await expect(page.getByText('No sales yet', { exact: true })).toBeVisible();
    await expectAccessible(page);

    const general = await addPass(page, base, 'General', '20', '10');
    const allIn = cents((await general.getByRole('cell').nth(2).innerText()).split('\n')[0] ?? '');
    expect(allIn).toBeGreaterThanOrEqual(2000);
    await addPass(page, base, 'Guest pass', '0', '5');
    const code = `RPT${stamp}`;
    await page.getByLabel('Code', { exact: true }).fill(code);
    await page.getByLabel('Discount type').selectOption('percent');
    await page.getByLabel('Discount', { exact: true }).fill('25');
    await page.getByRole('button', { name: 'Add code' }).click();
    await expect(page.getByRole('row').filter({ hasText: code })).toBeVisible();

    // Paid (2 tickets), paid with a code, complimentary, declined.
    const a = await guestBuys(browser, slug, {
      pass: 'General',
      qty: '2',
      name: `Ada Paid ${stamp}`,
      email: `ada+${stamp}@example.test`,
      outcome: 'pay',
    });
    const b = await guestBuys(browser, slug, {
      pass: 'General',
      qty: '1',
      name: `Bo Promo ${stamp}`,
      email: `bo+${stamp}@example.test`,
      promo: code.toLowerCase(),
      outcome: 'pay',
    });
    const c = await guestBuys(browser, slug, {
      pass: 'Guest pass',
      qty: '1',
      name: `Cy Comp ${stamp}`,
      email: `cy+${stamp}@example.test`,
      outcome: 'free',
    });
    await guestBuys(browser, slug, {
      pass: 'General',
      qty: '1',
      name: `Di Declined ${stamp}`,
      email: `di+${stamp}@example.test`,
      outcome: 'decline',
    });
    const compCode = (await c.guest.locator('.tracking-\\[0\\.2em\\]').first().textContent())?.trim() ?? '';
    expect(compCode).toMatch(/^[2-9A-Z]{8}$/);

    // A box-office cash sale.
    await page.goto(`${base}/tickets-orders`);
    const box = page.getByRole('region', { name: 'Box office' });
    await box.getByLabel("Buyer's name").fill(`Ed Door ${stamp}`);
    await box.getByLabel(/Buyer's email/).fill(`ed+${stamp}@example.test`);
    await box.getByLabel(/^General/).fill('1');
    await box.getByLabel('Paid by').selectOption('cash');
    await box.getByRole('button', { name: 'Record sale' }).click();
    await expect(box.getByText('Sale recorded. The tickets are on their way.')).toBeVisible();

    // Refund one of Ada's tickets, reached through booking search.
    await page.goto(`${base}/analysis/bookings`);
    await page.getByLabel('Search bookings').fill(`ada+${stamp}`);
    await page.getByLabel('Search bookings').press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'booking' })).toHaveText('1 booking');
    await page.getByRole('link', { name: `Ada Paid ${stamp}` }).click();
    const form = page.getByRole('region', { name: 'Refund' });
    await form.getByLabel('Reason').selectOption('requested_by_customer');
    await form.getByRole('checkbox').first().check();
    await form.getByRole('button', { name: 'Refund' }).click();
    await expect(form.getByText(/^Refunded\./)).toBeVisible();

    // Check the complimentary guest in.
    await page.goto(`${base}/onsite`);
    await page.getByLabel('Ticket code').fill(compCode);
    await page.getByLabel('Ticket code').press('Enter');
    await expect(page.getByRole('status').filter({ has: page.locator('[data-result]') })).toContainText(
      'Welcome in',
    );

    // Expected figures.
    const gross = a.amount + b.amount + allIn;
    const refunded = 2000; // the face value of one ticket; a buyer's request keeps the pass-on fee
    const fees = a.amount - 2 * 2000 + (b.amount - 1500) + (allIn - 2000);
    const net = gross - refunded - fees;
    expect(b.amount).toBeLessThan(allIn);

    // Event home: live key numbers (no demo overlay for a real event).
    await page.goto(base);
    await expect(kpi(page, 'Key numbers', 'Gross sales')).toContainText(usd(gross));
    await expect(kpi(page, 'Key numbers', 'Gross sales')).toContainText(`${usd(refunded)} refunded`);
    await expect(kpi(page, 'Key numbers', 'Net revenue')).toContainText(usd(net));
    await expect(kpi(page, 'Key numbers', 'Tickets sold')).toContainText('3');
    await expect(kpi(page, 'Key numbers', 'Tickets sold')).toContainText('of 15 places · 1 complimentary');
    await expect(kpi(page, 'Key numbers', 'Checked in')).toContainText('25% of 4 valid tickets');
    await expect(page.getByText('Updated now')).toBeVisible();
    await expectAccessible(page);

    // The full report.
    await page.getByRole('link', { name: 'See the full report' }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/analysis$`));
    await expect(kpi(page, 'Key numbers', 'Orders')).toContainText('4');
    await expect(kpi(page, 'Key numbers', 'Orders')).toContainText('1 complimentary order');
    await expect(page.getByRole('term').filter({ hasText: 'Failed payments' }).locator('..')).toContainText(
      '1',
    );
    await expect(page.getByRole('term').filter({ hasText: 'Promo discounts' }).locator('..')).toContainText(
      usd(500),
    );
    const types = page.getByRole('table', { name: 'Sales by ticket type' });
    await expect(types.getByRole('row').filter({ hasText: 'General' })).toContainText(
      `General3010${usd(a.amount + b.amount + allIn)}`,
    );
    await expect(types.getByRole('row').filter({ hasText: 'Guest pass' })).toContainText(
      `Guest pass015${usd(0)}`,
    );
    const channels = page.getByRole('table', { name: 'Sales by channel' });
    await expect(channels.getByRole('row').filter({ hasText: 'Online checkout' })).toContainText(
      usd(a.amount + b.amount),
    );
    await expect(channels.getByRole('row').filter({ hasText: 'Collected by you' })).toContainText(usd(allIn));
    const statuses = page.getByRole('table', { name: 'Orders by status' });
    await expect(statuses.getByRole('row').filter({ hasText: 'Payment failed' })).toContainText('1');
    await expect(statuses.getByRole('row').filter({ hasText: 'Partially refunded' })).toContainText('1');
    const promo = page.getByRole('table', { name: 'Promo codes' });
    await expect(promo.getByRole('row').filter({ hasText: code })).toContainText(
      `${code}11${usd(500)}${usd(b.amount)}`,
    );

    // The chart's data table, opened from the keyboard.
    const toggle = page.getByText('Show the data');
    await toggle.focus();
    await page.keyboard.press('Enter');
    const byDay = page.getByRole('table', { name: 'Sales by day' });
    await expect(byDay).toBeVisible();
    await expect(byDay.getByRole('row')).toHaveCount(2);
    await expect(byDay.getByRole('row').nth(1)).toContainText(`45${usd(gross)}`);
    await expect(page.getByRole('img', { name: 'Gross sales by day, USD' })).toBeVisible();
    await expectAccessible(page);

    // Finance: gross to net.
    await page.getByRole('link', { name: 'Finance' }).click();
    const waterfall = page.getByRole('table', { name: 'Gross sales to net revenue' });
    await expect(waterfall.getByRole('row').filter({ hasText: 'Gross sales' })).toContainText(usd(gross));
    await expect(waterfall.getByRole('row').filter({ hasText: 'Refunds' })).toContainText(usd(refunded));
    await expect(waterfall.getByRole('row').filter({ hasText: 'Platform fees' })).toContainText(usd(fees));
    await expect(waterfall.getByRole('row').filter({ hasText: 'Net revenue' })).toContainText(usd(net));
    await expectAccessible(page);

    // Booking search: filters and codes.
    await page.getByRole('link', { name: 'Bookings' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'booking' })).toHaveText('5 bookings');
    const results = page.getByRole('table', { name: 'Bookings' });
    await page.getByLabel('Show', { exact: true }).selectOption('comp');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'booking' })).toHaveText('1 booking');
    await expect(results.getByRole('row').nth(1)).toContainText(`Cy Comp ${stamp}`);
    await expect(results.getByRole('row').nth(1)).toContainText('Complimentary');
    await page.getByLabel('Show', { exact: true }).selectOption('failed');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(results.getByRole('row').nth(1)).toContainText(`Di Declined ${stamp}`);
    await expect(results.getByRole('row').nth(1)).toContainText('Payment failed');
    await page.getByLabel('Show', { exact: true }).selectOption('box_office');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(results.getByRole('row').nth(1)).toContainText(`Ed Door ${stamp}`);
    await page.getByLabel('Show', { exact: true }).selectOption('all');
    await page.getByLabel('Search bookings').fill(compCode.toLowerCase());
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'booking' })).toHaveText('1 booking');
    await expect(results).toContainText(`Cy Comp ${stamp}`);
    await page.getByLabel('Search bookings').fill(code);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(results).toContainText(`Bo Promo ${stamp}`);
    await expectAccessible(page);
    await page.getByLabel('Search bookings').fill(`nobody-${stamp}`);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText('No bookings match', { exact: true })).toBeVisible();
    // The search survives a reload (it lives in the URL).
    await page.reload();
    await expect(page.getByLabel('Search bookings')).toHaveValue(`nobody-${stamp}`);
    await expectAccessible(page);
    // Nothing matches: nothing to export.
    await expect(page.getByRole('button', { name: 'Export as CSV' })).toHaveCount(0);

    // Export the paid bookings as CSV (bulk framework), then download the file.
    await page.getByLabel('Search bookings').fill('');
    await page.getByLabel('Show', { exact: true }).selectOption('paid');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'booking' })).toHaveText('3 bookings');
    await page.getByRole('button', { name: 'Export as CSV' }).click();
    const exportPanel = page.getByRole('region', { name: 'Bookings export' });
    await expect(exportPanel.getByText('Ready: 3 rows exported.')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel('Show', { exact: true })).toHaveValue('paid');
    const href = (await exportPanel.getByRole('link', { name: 'Download CSV' }).getAttribute('href')) ?? '';
    const csv = await page.request.get(href);
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    const lines = (await csv.text())
      .replace(/^\uFEFF/, '')
      .trimEnd()
      .split('\r\n');
    expect(lines[0]).toBe(
      'Order reference,Buyer name,Buyer email,Status,Tickets,Total,Currency,Promo code,Channel,Booked at,Paid at',
    );
    expect(lines).toHaveLength(4);
    const ada = lines.find((l) => l.includes(`ada+${stamp}@example.test`)) ?? '';
    expect(ada).toContain(`,Partially refunded,2,${(a.amount / 100).toFixed(2)},USD,,Online checkout,`);
    expect(lines.find((l) => l.includes(`ed+${stamp}@`))).toContain(',Collected by you,');
    expect(lines.find((l) => l.includes(`bo+${stamp}@`))).toContain(`,${code},`);
    await expectAccessible(page);
    // A viewer can neither see the export button nor fetch the file.
    const viewer = await browser.newContext();
    const vp = await viewer.newPage();
    await signIn(vp, 'jordan@lakeside.test');
    expect((await vp.request.get(href)).status()).toBe(404);
    await vp.goto(`${base}/analysis/bookings`);
    await expect(vp.getByRole('status').filter({ hasText: 'booking' })).toBeVisible();
    await expect(vp.getByRole('button', { name: 'Export as CSV' })).toHaveCount(0);
    await viewer.close();

    // Arabic, right to left.
    await page.goto(`/ar${base}/analysis`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'التحليلات', level: 1 })).toBeVisible();
    await expect(page.getByRole('table', { name: 'المبيعات حسب نوع التذكرة' })).toBeVisible();
    await expectAccessible(page);
  });

  test('a viewer sees sales but not finance: no net revenue, no tab, and the URL is refused', async ({
    page,
  }) => {
    await signIn(page, 'jordan@lakeside.test');
    await page.goto(`${OPEN_HOUSE}/analysis`);
    await expect(page.getByRole('heading', { name: 'Analysis', level: 1 })).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'Report sections' });
    await expect(tabs.getByRole('link', { name: 'Bookings' })).toBeVisible();
    await expect(tabs.getByRole('link', { name: 'Finance' })).toHaveCount(0);
    await expect(page.getByText('Net revenue')).toHaveCount(0);
    await expectAccessible(page);
    await page.goto(`${OPEN_HOUSE}/analysis/finance`);
    await expect(page.getByText('Finance is for finance roles', { exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Gross sales to net revenue' })).toHaveCount(0);
    await expectAccessible(page);
    await page.goto(OPEN_HOUSE);
    await expect(page.getByText('Net revenue')).toHaveCount(0);
    await page.goto('/o/lakeside-events');
    await expect(page.getByRole('heading', { name: 'Sales', level: 2 })).toBeVisible();
    await expect(page.getByText('Net revenue')).toHaveCount(0);
  });

  test('the org home totals sales for a chosen period', async ({ page }) => {
    test.setTimeout(120_000);
    const stamp = `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;
    const name = `Period ${stamp}`;
    await signIn(page);
    const base = await newEvent(page, name);
    const row = await addPass(page, base, 'Door', '12', '5');
    const allIn = cents((await row.getByRole('cell').nth(2).innerText()).split('\n')[0] ?? '');
    const box = page.getByRole('region', { name: 'Box office' });
    await box.getByLabel("Buyer's name").fill(`Pat Period ${stamp}`);
    await box.getByLabel(/Buyer's email/).fill(`pat+${stamp}@example.test`);
    await box.getByLabel(/^Door/).fill('1');
    await box.getByRole('button', { name: 'Record sale' }).click();
    await expect(box.getByText('Sale recorded. The tickets are on their way.')).toBeVisible();

    await page.goto('/o/lakeside-events');
    const sales = page.getByRole('region', { name: 'Sales', exact: true });
    await expect(page.getByLabel('Period', { exact: true })).toHaveValue('30d');
    await expect(
      page.getByRole('region', { name: 'Sales key numbers' }).getByText('Net revenue'),
    ).toBeVisible();
    const byEvent = page.getByRole('table', { name: 'Sales by event' });
    await expect(byEvent.getByRole('row').filter({ hasText: name })).toContainText(`${name}110${usd(allIn)}`);
    await expect(page.getByText(/^Updated /)).toBeVisible();
    await expectAccessible(page);

    // Keyboard: choose "Last 7 days" and apply.
    await page.getByLabel('Period', { exact: true }).focus();
    await page.getByLabel('Period', { exact: true }).selectOption('7d');
    await page.getByRole('button', { name: 'Apply' }).press('Enter');
    await expect(page).toHaveURL(/period=7d/);
    await expect(byEvent.getByRole('row').filter({ hasText: name })).toBeVisible();

    // A backwards custom range is refused with a message; the default period is shown.
    await page.getByLabel('Period', { exact: true }).selectOption('custom');
    await page.getByLabel('From', { exact: true }).fill('2027-02-10');
    await page.getByLabel('To', { exact: true }).fill('2027-02-01');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(sales.getByText('The end date is before the start date.')).toBeVisible();
    await expect(page.getByLabel('To', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page);

    // A past period with no sales.
    await page.getByLabel('Period', { exact: true }).selectOption('custom');
    await page.getByLabel('From', { exact: true }).fill('2020-01-01');
    await page.getByLabel('To', { exact: true }).fill('2020-01-31');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('No sales in this period', { exact: true })).toBeVisible();
    await expect(sales).toContainText('Jan 1, 2020 – Jan 31, 2020');

    await page.getByLabel('Period', { exact: true }).selectOption('all');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(sales).toContainText('All time');
    await expect(byEvent.getByRole('row').filter({ hasText: name })).toBeVisible();

    // Arabic, right to left.
    await page.goto('/ar/o/lakeside-events?period=all');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'المبيعات', level: 2 })).toBeVisible();
    await expectAccessible(page);
  });
});
