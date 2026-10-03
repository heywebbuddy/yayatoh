import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { continueToPayment, expectAccessible, newUser, pickOption, signIn } from './helpers.ts';

/**
 * U4 Command Center v2: the hero strip (countdown, mode, the one next action), the KPI row by
 * role, the packed grid (no empty cell at 390, 1024 and 1440 px for the owner, ops and door
 * views), readiness as a checklist that deep-links to the exact field, the alerts tile, and the
 * org overview with money and readiness per event.
 */

const VIEWER = 'jordan@lakeside.test';
const WIDTHS = [390, 1024, 1440] as const;

/** `YYYY-MM-DDTHH:mm` wall-clock time in Chicago, `offsetH` hours from now. */
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

const stamp = () => `${Date.now()}${test.info().project.name.split('-')[0]}`;

/** A native select (until U1's sweep reaches it) or a U1 Select. */
async function choose(field: Locator, value: string | { label: string }) {
  if ((await field.evaluate((e) => e.tagName)) === 'SELECT') await field.selectOption(value);
  else await pickOption(field, value);
}

/** A published Chicago event with a $25 pass (120 places) and `n` sold. */
async function newEvent(page: Page, browser: Browser, name: string, startH: number, endH: number, n = 0) {
  await page.goto('/o/lakeside-events/events/new');
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await choose(page.getByLabel('Time zone'), 'America/Chicago');
  await page.getByLabel('Starts', { exact: true }).fill(chicago(startH));
  await page.getByLabel('Ends', { exact: true }).fill(chicago(endH));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill('Door pass');
  await page.getByLabel('Price (USD)').fill('25');
  await page.getByLabel('Quantity available').fill('120');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Door pass' })).toBeVisible();
  if (n > 0) {
    const ctx = await browser.newContext();
    const guest = await ctx.newPage();
    const email = `ccv2+${stamp()}@example.test`;
    await guest.goto(`/events/${base.split('/').pop()}`);
    await choose(guest.getByLabel('Quantity — Door pass'), String(n));
    await guest.getByLabel('Full name').fill(`Guest ${name}`);
    await guest.getByLabel('Email for your tickets').fill(email);
    await continueToPayment(guest, email);
    await guest.getByRole('button', { name: 'Pay now (test)' }).click();
    await expect(guest).toHaveURL(/\/orders\//);
    await ctx.close();
  }
  return { base, slug: base.split('/').pop() as string };
}

/**
 * No empty cell: in every row of the grid, the widgets reach from the grid's start edge to its
 * end edge (a gap anywhere would leave one of the edges or the row short).
 */
async function expectPacked(grid: Locator) {
  const g = await grid.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const rows = new Map<number, DOMRect[]>();
    for (const c of el.children) {
      const r = c.getBoundingClientRect();
      const k = Math.round(r.top);
      rows.set(k, [...(rows.get(k) ?? []), r]);
    }
    const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0;
    return {
      left: box.left,
      right: box.right,
      gap,
      rows: [...rows.values()].map((row) => ({
        left: Math.min(...row.map((r) => r.left)),
        right: Math.max(...row.map((r) => r.right)),
        width: row.reduce((s, r) => s + r.width, 0) + gap * (row.length - 1),
      })),
    };
  });
  expect(g.rows.length).toBeGreaterThan(0);
  for (const row of g.rows) {
    expect(Math.abs(row.left - g.left)).toBeLessThan(2);
    expect(Math.abs(row.right - g.right)).toBeLessThan(2);
    expect(Math.abs(row.width - (g.right - g.left))).toBeLessThan(2);
  }
}

/** The board, the KPI row and the hero are packed at phone, tablet and desktop widths. */
async function expectPackedAtAllWidths(page: Page, label: string) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByTestId('cc-grid')).toBeVisible();
    await expectPacked(page.getByTestId('cc-grid'));
    if (await page.getByTestId('cc-kpis').count()) await expectPacked(page.getByTestId('cc-kpis'));
    await expectPacked(page.getByTestId('cc-hero'));
    await test.info().attach(`${label}-${width}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  }
}

const shown = (page: Page) =>
  page
    .getByTestId('cc-grid')
    .locator('[data-testid^="cc-widget-"]')
    .evaluateAll((els) => els.map((e) => (e.getAttribute('data-testid') ?? '').replace('cc-widget-', '')));

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

test.describe('Command Center v2 (U4)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('owner planning view: hero, KPI row, readiness checklist with deep links, alerts tile, packed grid', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const { base, slug } = await newEvent(page, browser, `CCv2 Plan ${stamp()}`, 72, 76);
    await page.goto(`${base}/command-center`);
    await expect(page.getByTestId('command-center')).toHaveAttribute('data-mode', 'planning');

    // Hero: countdown in the reader's words, the mode, the one next action (the first blocking item).
    const hero = page.getByTestId('cc-hero');
    await expect(page.getByTestId('cc-countdown')).toHaveText(/^Starts in (2|3) days/);
    await expect(page.getByTestId('cc-mode')).toHaveText('Planning');
    const next = page.getByTestId('cc-next');
    await expect(next).toHaveAttribute('data-action', 'readiness');
    await expect(next).toContainText('Finish: Venue added');
    await expect(next).toContainText('Needed before you can sell');
    const fix = next.getByRole('link', { name: 'Fix it now' });
    await expect(fix).toHaveAttribute('href', `${base}/details#details-venue`);
    // One primary action on the screen: the hero's.
    await expect(page.getByTestId('command-center').locator('.bg-primary.elevation-primary')).toHaveCount(1);
    await expect(hero.getByLabel('Set the mode')).toBeVisible();

    // KPI row for the owner: sales, tickets, check-ins, alerts.
    await expect(page.getByTestId('cc-kpis').locator('li')).toHaveCount(4);
    await expect(page.getByTestId('cc-kpi-sales')).toContainText('$0.00');
    await expect(page.getByTestId('cc-kpi-tickets')).toContainText('0');
    await expect(page.getByTestId('cc-kpi-tickets')).toContainText('of 120');
    await expect(page.getByTestId('cc-kpi-checkins')).toContainText('of 0 valid tickets');
    await expect(page.getByTestId('cc-kpi-alerts')).toContainText('All clear');

    // Readiness as a checklist: done items ticked, open ones link to the exact field.
    const readiness = page.getByTestId('cc-widget-readiness');
    await expect(readiness.locator('li[data-done="true"]').first()).toBeVisible();
    await expect(readiness.getByText('Name and dates added')).toBeVisible();
    await expect(page.getByTestId('cc-readiness-count')).toHaveText(/^\d+ of \d+ done$/);
    await expect(page.getByTestId('cc-blocking').getByRole('link', { name: /Venue added/ })).toHaveAttribute(
      'href',
      `${base}/details#details-venue`,
    );
    await expect(page.getByTestId('cc-todo').getByRole('link', { name: /Short description written/ })).toHaveAttribute(
      'href',
      `${base}/content#tagline-heading`,
    );

    // The alerts tile is the real engine's: all clear, with the way to the alert list.
    const alerts = page.getByTestId('cc-widget-alerts');
    await expect(alerts.getByTestId('cc-alerts-clear')).toContainText('No open alerts.');
    await expect(alerts.getByRole('link', { name: 'See all alerts' })).toHaveAttribute(
      'href',
      /\/o\/lakeside-events\/alerts\?event=[0-9a-f-]{36}$/,
    );
    await expect(alerts).not.toContainText('switched on');

    await expectPackedAtAllWidths(page, 'owner-planning');
    await page.setViewportSize({ width: 1280, height: 900 });
    await expectAccessible(page);
    await setTheme(page, 'dark');
    await expectAccessible(page);
    await setTheme(page, 'light');

    // Keyboard only: the next action lands on the venue field.
    await fix.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${base}/details#details-venue$`));
    await expect(page.locator('#details-venue')).toBeInViewport();

    // The checklist's other link lands on its section too.
    await page.goto(`${base}/command-center`);
    await page.getByTestId('cc-todo').getByRole('link', { name: /Short description written/ }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/content#tagline-heading$`));
    await expect(page.locator('#tagline-heading')).toBeInViewport();

    // The public page is the next action once nothing blocks: not here (venue missing).
    expect(slug).toBeTruthy();

    // Arabic, right to left.
    await page.goto(`/ar${base}/command-center`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('cc-countdown')).toHaveText(/^يبدأ خلال /);
    await expect(page.getByTestId('cc-next')).toContainText('أكمل:');
    await expectPacked(page.getByTestId('cc-grid'));
    await expectAccessible(page);
  });

  test('owner live view: count-down to the end, scanner as the next action, packed; customize still works', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const { base } = await newEvent(page, browser, `CCv2 Live ${stamp()}`, -1, 3, 3);
    await page.goto(`${base}/command-center`);
    await expect(page.getByTestId('command-center')).toHaveAttribute('data-mode', 'live');
    await expect(page.getByTestId('cc-countdown')).toHaveText(/^Ends in (2|3) hours/);
    await expect(page.getByTestId('cc-next')).toHaveAttribute('data-action', 'scanner');
    await expect(page.getByTestId('cc-next').getByRole('link', { name: 'Start scanning' })).toHaveAttribute(
      'href',
      '/scan',
    );
    await expect(page.getByTestId('cc-kpi-sales')).toContainText('$75.00');
    await expect(page.getByTestId('cc-kpi-tickets')).toContainText('3');
    await expect(page.getByTestId('cc-kpi-checkins')).toContainText('of 3 valid tickets');
    await expectPackedAtAllWidths(page, 'owner-live');
    await page.setViewportSize({ width: 1280, height: 900 });
    await expectAccessible(page);
    await setTheme(page, 'dark');
    await expectAccessible(page);
    await setTheme(page, 'light');

    // Customize: hide the first widget and move another (keyboard), still packed, persisted.
    const before = await shown(page);
    const first = before[0] as string;
    await page.getByRole('button', { name: 'Customize layout' }).click();
    const firstTitle = (await page.getByTestId(`cc-widget-${first}`).locator('h3').textContent()) as string;
    await page.getByRole('button', { name: `Hide ${firstTitle}` }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Layout saved.' })).toHaveText(
      `${firstTitle} hidden. Layout saved.`,
    );
    expect(await shown(page)).toEqual(before.slice(1));
    // The KPI row keeps its figure while the widget is hidden.
    await expect(page.getByTestId('cc-kpi-checkins')).toBeVisible();
    await expectPackedAtAllWidths(page, 'owner-live-customized');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    expect(await shown(page)).toEqual(before.slice(1));
    await page.getByRole('button', { name: 'Customize layout' }).click();
    await page.getByRole('button', { name: 'Reset to default' }).click();
    await expect(page.getByText('Layout reset to default.')).toBeVisible();
    await page.reload();
    expect(await shown(page)).toEqual(before);

    // Arabic.
    await page.goto(`/ar${base}/command-center`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('cc-countdown')).toHaveText(/^ينتهي خلال /);
    await expectAccessible(page);
  });

  test('door and ops views: role KPIs, no revenue for the door, packed at every width', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    await signIn(page);
    const { base } = await newEvent(page, browser, `CCv2 Door ${s}`, -1, 3, 2);

    const doorContext = await browser.newContext();
    const door = await doorContext.newPage();
    const name = `Dana Door ${s}`;
    await newUser(door, { join: ['lakeside-events:viewer'], name });
    await page.goto(`${base}/onsite/staff`);
    const add = page.getByRole('region', { name: 'Add door staff' });
    await choose(add.getByLabel('Team member'), { label: name });
    await add.getByRole('button', { name: 'Add door staff' }).click();
    await expect(add.getByRole('status')).toHaveText('Saved.');

    await door.goto(`${base}/command-center`);
    const cc = door.getByTestId('command-center');
    await expect(cc).toHaveAttribute('data-role', 'door');
    // The door's KPI row: check-ins and its own alerts. Never sales, never a currency.
    await expect(door.getByTestId('cc-kpis').locator('li')).toHaveCount(2);
    await expect(door.getByTestId('cc-kpi-checkins')).toContainText('of 2 valid tickets');
    await expect(door.getByTestId('cc-kpi-alerts')).toBeVisible();
    await expect(door.getByTestId('cc-kpi-sales')).toHaveCount(0);
    await expect(door.getByTestId('cc-kpi-tickets')).toHaveCount(0);
    await expect(cc).not.toContainText('$');
    await expect(door.getByTestId('cc-next')).toHaveAttribute('data-action', 'scanner');
    await expect(door.getByLabel('Set the mode')).toHaveCount(0);
    await expectPackedAtAllWidths(door, 'door-live');
    await door.setViewportSize({ width: 1280, height: 900 });
    await expectAccessible(door);
    await setTheme(door, 'dark');
    await expectAccessible(door);
    await door.goto(`/ar${base}/command-center`);
    await expect(door.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(door.getByTestId('command-center')).not.toContainText('$');
    await expectAccessible(door);
    await doorContext.close();

    // Ops (a read-only viewer): the operations layout, money they may read, packed too.
    const ops = await (await browser.newContext()).newPage();
    await signIn(ops, VIEWER);
    await ops.goto(`${base}/command-center`);
    await expect(ops.getByTestId('command-center')).toHaveAttribute('data-role', 'ops');
    await expect(ops.getByTestId('cc-kpis').locator('li')).toHaveCount(4);
    await expectPackedAtAllWidths(ops, 'ops-live');
    await ops.setViewportSize({ width: 1280, height: 900 });
    await expectAccessible(ops);
  });

  test('org overview: events grouped by mode with money and readiness; keyboard, dark, RTL', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const name = `CCv2 Overview ${stamp()}`;
    const { base } = await newEvent(page, browser, name, 48, 52, 2);
    await page.goto('/o/lakeside-events/command-center');
    await expect(page.getByRole('heading', { level: 1, name: 'Command Center' })).toBeVisible();
    // Counts per mode on top, packed.
    for (const m of ['live', 'pre_show', 'planning', 'wrap'])
      await expect(page.getByTestId(`cc-overview-count-${m}`)).toBeVisible();
    await expectPacked(page.getByTestId('cc-overview-counts'));
    // The event in its mode's group, with its sales, tickets and readiness.
    const group = page.getByRole('region', { name: /^Being planned \(\d+\)$/ });
    const row = group.getByRole('row').filter({ hasText: name });
    await expect(row.getByTestId('cc-overview-mode')).toContainText('Planning');
    await expect(row.getByTestId('cc-overview-sales')).toHaveText('$50.00');
    await expect(row.getByTestId('cc-overview-tickets')).toHaveText('2 of 120');
    await expect(row.getByTestId('cc-overview-readiness').getByRole('progressbar')).toBeVisible();
    await expectAccessible(page);
    await setTheme(page, 'dark');
    await expectAccessible(page);
    await setTheme(page, 'light');
    // Keyboard: the event's link opens its Command Center.
    await row.getByRole('link', { name }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${base}/command-center$`));

    // Arabic.
    await page.goto('/ar/o/lakeside-events/command-center');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 2, name: /^قيد التخطيط/ })).toBeVisible();
    await expectAccessible(page);
  });
});
