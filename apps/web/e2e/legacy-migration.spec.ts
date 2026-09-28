import { closeSync, existsSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { codeForKey, expectAccessible } from './helpers.ts';

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

/**
 * The migrated owner is one account shared by the three viewport projects (they run in parallel).
 * Owners must use two-step verification (M1.2c, D14): exactly one project sets it up at the
 * owner's first sign-in (an exclusive lock file for this run's migrated data) and saves the setup
 * key; the others wait for the key and answer the sign-in challenge with it.
 */
function runTag() {
  return String(Math.floor(statSync(FILE).mtimeMs));
}
const lockFile = () => new URL(`./.generated/legacy-owner-2fa-${runTag()}.lock`, import.meta.url);
const keyFile = () => new URL(`./.generated/legacy-owner-2fa-${runTag()}.key`, import.meta.url);
function claimSetUp(): boolean {
  try {
    closeSync(openSync(lockFile(), 'wx'));
    return true;
  } catch {
    return false;
  }
}
async function setUpKey(): Promise<string> {
  for (let i = 0; i < 120; i++) {
    if (existsSync(keyFile())) return readFileSync(keyFile(), 'utf8');
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('the migrated owner never finished setting up two-step verification');
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
    test.setTimeout(90_000);
    const first = claimSetUp();
    // The others sign in once the first project has turned two-step verification on.
    const known = first ? null : await setUpKey();
    await signInWithLegacyPassword(page, h.owner.email, h.owner.password);
    if (first) {
      // Owners must use two-step verification (M1.2c, D14): the migrated owner sets it up at
      // their first sign-in, then continues to their org.
      await expect(page).toHaveURL(/\/account\/security\?required=1$/);
      await expect(page.getByRole('heading', { name: 'Two-step verification is required' })).toBeVisible();
      await page
        .getByRole('region', { name: 'Authenticator app' })
        .getByRole('button', { name: 'Set up authenticator app' })
        .click();
      const key = (await page.getByTestId('setup-key').textContent()) ?? '';
      await page.getByLabel('6-digit code').fill(codeForKey(key));
      await page.getByRole('button', { name: 'Verify and turn on' }).click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Two-step verification is on.' }),
      ).toBeVisible();
      await page.getByRole('button', { name: "I've saved my codes" }).click();
      writeFileSync(keyFile(), key);
      await page.goto(`/o/${h.org.slug}`);
    } else {
      // Two-step verification is on: the legacy password, then a code from the app.
      await page.getByLabel('6-digit code').fill(codeForKey(known ?? ''));
      await page.getByRole('button', { name: 'Verify and sign in' }).click();
    }
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

  test('offline: two devices let the same migrated ticket in; the duplicate is flagged within 60 s of reconnect', async () => {
    // M1.9e: the manifest carries legacy QR payloads as salted hashes, so migrated tickets scan
    // offline; on reconnect the server's first-wins still flags the cross-device duplicate.
    test.setTimeout(150_000);
    const mine = h.scans[test.info().project.name] ?? h.scans['desktop-1280'];
    if (!mine) throw new Error('no scan handle');
    await page.goto(`${EVENT}/onsite`);
    // Start from "not in yet": undo today's admission (the online test, or an earlier run).
    const field = page.getByLabel('Ticket code');
    const result = page.getByRole('status').filter({ has: page.locator('[data-result]') });
    await field.fill(mine.shortCode);
    await field.press('Enter');
    await expect(result).toContainText(/Welcome in|Already checked in/);
    await page
      .getByRole('button', { name: `Undo check-in for ${mine.name}` })
      .first()
      .click();
    await expect(page.getByRole('button', { name: `Undo check-in for ${mine.name}` })).toHaveCount(0);

    const device = async (label: string) => {
      await page.getByLabel('Device name').fill(label);
      await page.getByRole('button', { name: 'Add device' }).click();
      const link = await page.getByTestId('scan-link').getAttribute('href');
      const context = await page.context().browser()?.newContext();
      if (!context) throw new Error('no browser');
      const p = await context.newPage();
      await p.goto(link ?? '');
      await expect(p.getByText(/tickets? on this device/)).toBeVisible({ timeout: 30_000 });
      return { context, page: p };
    };
    const stamp = `${Date.now()}-${test.info().project.name}`;
    const one = await device(`Legacy A ${stamp}`);
    const two = await device(`Legacy B ${stamp}`);
    await one.context.setOffline(true);
    await two.context.setOffline(true);
    const scanOn = async (d: typeof one) => {
      const code = d.page.getByLabel('Ticket code');
      await code.fill(mine.legacyCode);
      await code.press('Enter');
      const shown = d.page.getByRole('status').filter({ has: d.page.locator('[data-result]') });
      await expect(shown).toContainText('Welcome in');
      await expect(shown).toContainText(`${mine.name} · Season Pass`);
      await expect(shown).toContainText('will be confirmed when synced');
      return shown;
    };
    const time = (d: Date) =>
      new Intl.DateTimeFormat('en', {
        timeZone: 'America/Chicago',
        hour: 'numeric',
        minute: '2-digit',
      }).format(d);
    await scanOn(one);
    const before = new Date();
    const second = await scanOn(two);
    const after = new Date();
    await expect(two.page.getByTestId('scan-queue')).toHaveText('1 scan waiting to sync');

    // Reconnect: the first device's scan wins; the second is flagged within 60 s.
    const reconnect = Date.now();
    await one.context.setOffline(false);
    await expect(one.page.getByTestId('scan-queue')).toHaveText('All scans synced', { timeout: 15_000 });
    await two.context.setOffline(false);
    await expect(two.page.getByTestId('scan-queue')).toHaveText('All scans synced', { timeout: 15_000 });
    await expect(second).toContainText('Checked in on another device first');
    const alerts = page.getByRole('region', { name: /let in twice while offline/ });
    await expect(
      alerts
        .getByRole('listitem')
        .filter({ hasText: mine.name })
        .filter({
          hasText: new RegExp(`^(${time(before)}|${time(after)}) ·`),
        }),
    ).not.toHaveCount(0, { timeout: 60_000 - (Date.now() - reconnect) });
    expect(Date.now() - reconnect).toBeLessThan(60_000);
    await expectAccessible(page);
    await one.context.close();
    await two.context.close();
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
