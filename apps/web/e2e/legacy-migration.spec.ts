import { existsSync, readFileSync } from 'node:fs';
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { expectAccessible } from './helpers.ts';

/**
 * M2.2b legacy migration: a synthetic legacy dataset is migrated into the e2e database by the
 * global setup (`migrate:legacy:demo`), exactly as the owner's migration of a masked dump would.
 * These tests check the result through the real UI: a migrated organizer signs in with their
 * legacy (bcrypt) password and finds their events, orders, attendees and check-ins; a migrated
 * buyer's order page shows their tickets with QR codes; a migrated ticket's legacy QR scans at the
 * door; and a migrated scanner sub-account is kept out of what it may not see.
 */
interface Handles {
  owner: { email: string; password: string; name: string };
  staff: { email: string; role: string }[];
  org: { slug: string; name: string };
  weekly: { slug: string; name: string };
  gala: { slug: string; name: string };
  buyer: { name: string; email: string; orderId: string; manageToken: string };
  scans: Record<string, { name: string; legacyCode: string; shortCode: string }>;
}

const FILE = new URL('./.generated/legacy-demo.json', import.meta.url);
let cached: Handles | null = null;
/** Read lazily: the global setup writes the file after the test files are collected. */
function handles(): Handles {
  if (cached) return cached;
  if (!existsSync(FILE))
    throw new Error(
      'e2e/.generated/legacy-demo.json is missing: run `pnpm migrate:legacy:demo` (the global setup does)',
    );
  cached = JSON.parse(readFileSync(FILE, 'utf8')) as Handles;
  return cached;
}

/** Sign in through the real form, keyboard only, with the migrated account's legacy password. */
async function signInWithLegacyPassword(page: Page, email: string, password: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Email').press('Tab');
  await expect(page.getByLabel('Password')).toBeFocused();
  await page.keyboard.type(password);
  await page.keyboard.press('Enter');
}

test.describe('legacy migration — the migrated organizer', () => {
  test.describe.configure({ mode: 'serial' });
  let context: BrowserContext;
  let page: Page;
  let h: Handles;
  let EVENT: string;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    h = handles();
    EVENT = `/o/${h.org.slug}/e/${h.weekly.slug}`;
    context = await browser.newContext();
    page = await context.newPage();
  });
  test.afterAll(async () => {
    await context.close();
  });

  test('signs in with their legacy password and lands in their migrated org', async () => {
    await signInWithLegacyPassword(page, h.owner.email, h.owner.password);
    await expect(page).toHaveURL(new RegExp(`/o/${h.org.slug}$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(h.owner.name.split(' ')[0] as string);
    await expect(page.getByText(h.weekly.name)).toBeVisible();
    await expect(page.getByText(h.gala.name)).toBeVisible();
    await expectAccessible(page);
    // The session persists across a reload.
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/o/${h.org.slug}$`));
  });

  test('sees the migrated event with its sales and check-ins', async () => {
    await page.goto(EVENT);
    const main = page.getByRole('main');
    // Venue-local: the event renders in its venue's timezone (Chicago).
    await expect(
      main.getByText(`${h.weekly.name} · Jan 6, 2026 – Dec 31, 2030 · Cedar Theater, Chicago`),
    ).toBeVisible();
    // Imported check-ins count on the event overview.
    await expect(main.getByText('Checked in', { exact: true })).toBeVisible();
    await expectAccessible(page);
  });

  test('sees the migrated orders, and opens one with its tickets', async () => {
    await page.goto(`${EVENT}/tickets-orders`);
    const orders = page.getByRole('table', { name: 'Recent orders' });
    const row = orders.getByRole('row').filter({ hasText: h.buyer.email });
    await expect(row).toContainText('2 × Season Pass');
    await expect(row).toContainText('$90.00');
    await expect(row).toContainText('Paid');
    await expectAccessible(page);
    await row.getByRole('link', { name: h.buyer.name }).click();
    await expect(page).toHaveURL(new RegExp(`/orders/${h.buyer.orderId}$`));
    await expect(page.getByRole('heading', { name: `Order from ${h.buyer.name}` })).toBeVisible();
    const tickets = page.getByRole('table', { name: 'Tickets' });
    await expect(tickets.getByRole('row').filter({ hasText: 'Season Pass' })).toHaveCount(2);
    await expectAccessible(page);
  });

  test('sees the migrated attendees with their ticket codes', async () => {
    await page.goto(`${EVENT}/attendees`);
    const table = page.getByRole('table', { name: 'Attendees' });
    await expect(table.getByRole('row').filter({ hasText: h.buyer.email })).toHaveCount(2);
    const door = h.scans['desktop-1280'];
    if (!door) throw new Error('no door handle');
    await expect(table.getByRole('row').filter({ hasText: door.name })).toContainText(door.shortCode);
    // Search narrows to one migrated attendee.
    await page.getByLabel(/Search Attendees/i).fill(door.name);
    await page.getByLabel(/Search Attendees/i).press('Enter');
    await expect(table.getByRole('row').filter({ hasText: door.name })).toBeVisible();
    await expect(table.getByRole('row').filter({ hasText: h.buyer.email })).toHaveCount(0);
    await expectAccessible(page);
  });

  test('scans a migrated ticket at the door with its legacy QR, keyboard only', async () => {
    const mine = h.scans[test.info().project.name] ?? h.scans['desktop-1280'];
    if (!mine) throw new Error('no scan handle');
    await page.goto(`${EVENT}/onsite`);
    // Imported check-ins appear as recent scans.
    await expect(page.getByRole('heading', { name: 'Recent scans' })).toBeVisible();
    const field = page.getByLabel('Ticket code');
    await expect(field).toBeFocused();
    const result = page.getByRole('status').filter({ has: page.locator('[data-result]') });
    await field.fill(mine.legacyCode);
    await field.press('Enter');
    await expect(result).toContainText(/Welcome in|Already checked in/);
    if ((await result.textContent())?.includes('Already checked in')) {
      // A rerun on the same day: undo the earlier admission, then scan again.
      await page
        .getByRole('button', { name: `Undo check-in for ${mine.name}` })
        .first()
        .click();
      await field.fill(mine.legacyCode);
      await field.press('Enter');
    }
    await expect(result).toContainText('Welcome in');
    await expect(result).toContainText(`${mine.name} · Season Pass`);
    // The same ticket again, now by its printed short code: already in.
    await field.fill(mine.shortCode);
    await field.press('Enter');
    await expect(result).toContainText('Already checked in');
    // A legacy-looking code that was never issued.
    await field.fill('999999999999999');
    await field.press('Enter');
    await expect(result).toContainText('Not a valid ticket');
    await expectAccessible(page);
  });

  test('the migrated event renders right-to-left in Arabic', async () => {
    await page.goto(`/ar${EVENT}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('main').getByText(h.weekly.name).first()).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar${EVENT}/tickets-orders`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText(h.buyer.email)).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe('legacy migration — the migrated buyer', () => {
  let h: Handles;
  test.beforeAll(() => {
    h = handles();
  });

  test('opens their order link and sees each ticket with its QR code', async ({ page }) => {
    await page.goto(`/orders/${h.buyer.manageToken}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      `You're going, ${h.buyer.name.split(' ')[0]}!`,
    );
    await expect(page.getByText(`Confirmation sent to ${h.buyer.email}`)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your 2 tickets' })).toBeVisible();
    await expect(page.getByRole('img', { name: /QR code for ticket number/ })).toHaveCount(2);
    await expectAccessible(page);
  });

  test('the order page renders right-to-left in Arabic', async ({ page }) => {
    await page.goto(`/ar/orders/${h.buyer.manageToken}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('img')).toHaveCount(2);
    await expectAccessible(page);
  });

  test('a wrong order link finds nothing', async ({ page }) => {
    const res = await page.goto(`/orders/${'x'.repeat(43)}`);
    expect(res?.status()).toBe(404);
    await expect(page.getByText('Page not found', { exact: true })).toBeVisible();
  });
});

test.describe('legacy migration — a migrated scanner sub-account', () => {
  let h: Handles;
  test.beforeAll(() => {
    h = handles();
  });

  test('signs in, but is refused the orders and attendees of its organizer’s events', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-1280', 'one sign-in is enough (sign-in is rate limited)');
    const scanner = h.staff.find((s) => s.role === 'scanner');
    if (!scanner) throw new Error('no migrated scanner');
    await signInWithLegacyPassword(page, scanner.email, h.owner.password);
    await expect(page).toHaveURL(new RegExp(`/o/${h.org.slug}$`));
    // No sales for a scanner on the org home.
    await expect(page.getByRole('heading', { name: 'Sales', level: 2 })).toHaveCount(0);
    for (const path of ['tickets-orders', 'attendees', `orders/${h.buyer.orderId}`]) {
      await page.goto(`/o/${h.org.slug}/e/${h.weekly.slug}/${path}`);
      await expect(page.getByText('Page not found', { exact: true })).toBeVisible();
      await expect(page.getByText(h.buyer.email)).toHaveCount(0);
    }
    await expectAccessible(page);
  });
});
