import { type Browser, expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type GuestCheckinScenario, guestCheckinScenario } from '@yayatoh/testing';
import { expectAccessible, expectAccessibleBothModes, pickOption, signIn } from './helpers.ts';

// axe in light and dark, several devices and an offline drill: these journeys take time.
test.describe.configure({ timeout: 180_000 });

/**
 * M4.4b kiosk, TV board and check-in. The host's day-of view (arrivals, unseated guests, meal
 * counts, check in and undo); guest check-in by name or party with labels in the Scan PWA,
 * offline too; the guest kiosk and the A–Z table board started from the day-of page, both
 * working after the network is cut (the acceptance's offline drill), PIN to leave; viewers read
 * but can't act; keyboard only; axe in light and dark; Arabic RTL.
 */

const VIEWER = 'jordan@lakeside.test';

test.afterAll(async () => {
  await closePools();
});

let orgId: string | null = null;
async function scenario(): Promise<GuestCheckinScenario> {
  orgId ??= (await resolveOrgSlug('lakeside-events'))?.orgId ?? null;
  if (!orgId) throw new Error('no lakeside-events org (seed?)');
  return guestCheckinScenario(orgId);
}

const dayOf = (s: GuestCheckinScenario, locale = '') => `${locale}/o/lakeside-events/e/${s.eventSlug}/day-of`;
const stamp = () => `${test.info().project.name.split('-')[0]}${Date.now()}`;

/** Add a device on the day-of page; returns its setup link. */
async function addDevice(page: Page, s: GuestCheckinScenario, label: string): Promise<string> {
  await page.goto(dayOf(s));
  const kiosks = page.locator('#kiosks');
  await kiosks.getByLabel('Device name').fill(label);
  await kiosks.getByRole('button', { name: 'Add device' }).click();
  const link = await page.getByTestId('scan-link').getAttribute('href');
  expect(link).toMatch(/\/scan#e=[0-9a-f-]{36}&k=yyd_/);
  return link ?? '';
}

/** A device in its own browser context (no session), set up from its link. */
async function openDevice(browser: Browser, link: string, s: GuestCheckinScenario) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link);
  await expect(page.getByRole('heading', { name: s.eventName })).toBeVisible();
  return { context, page };
}

test.describe('kiosk, TV board and check-in (M4.4b)', () => {
  test('the host’s day-of view: counts, unseated, meals; check in by search and undo by keyboard; axe; Arabic', async ({
    page,
  }) => {
    const s = await scenario();
    await signIn(page);
    await page.goto(dayOf(s));
    await expect(page.getByRole('heading', { name: 'Day-of', level: 1 })).toBeVisible();
    await expect(page.getByTestId('stat-arrived')).toContainText('0 of 5 expected');
    await expect(page.getByTestId('stat-unseated')).toContainText('1');
    await expect(page.getByTestId('stat-declined')).toContainText('1');
    // Empty arrivals say what will fill them.
    await expect(page.getByText('No one has arrived yet')).toBeVisible();
    // Unseated: Kofi only (the plus-one sits with Luis; Mei declined).
    await expect(page.getByTestId('unseated')).toContainText('Kofi Okafor');
    await expect(page.getByTestId('unseated')).not.toContainText('Mei Chen');
    await expect(page.getByRole('link', { name: 'Seat guests' })).toBeVisible();
    // Meals: guests who said yes, by choice.
    const meals = page.getByRole('region', { name: 'Meals' });
    await expect(meals.getByRole('row', { name: /Beef/ })).toContainText('1');
    await expect(meals.getByRole('row', { name: /Fish/ })).toContainText('1');
    await expectAccessibleBothModes(page);

    // No match.
    const search = page.getByLabel('Guest or party name');
    await search.fill('zzz');
    await search.press('Enter');
    await expect(page.getByText('No guests match')).toBeVisible();

    // Keyboard only: search, check in, see it in the arrivals.
    await search.fill('garcía');
    await search.press('Enter');
    const ana = page.locator('[data-match="Ana García"]');
    await expect(ana).toContainText('Garcia · Table 1');
    await ana.getByRole('button', { name: 'Check in Ana García' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('day-of-feedback')).toHaveText('Ana García is checked in.');
    await expect(page.locator('[data-arrival="Ana García"]')).toBeVisible();
    await expect(page.getByTestId('stat-arrived')).toContainText('1 of 5 expected');
    await expect(ana).toContainText('Arrived');
    await expectAccessibleBothModes(page);
    // Kept after a reload, with how it was recorded.
    await page.reload();
    const row = page.getByRole('row').filter({ has: page.locator('[data-arrival="Ana García"]') });
    await expect(row).toContainText('Host');
    await expect(row).toContainText('Table 1');
    // Undo by keyboard.
    await row.getByRole('button', { name: 'Undo check-in for Ana García' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('day-of-feedback')).toHaveText('Check-in undone.');
    await page.reload();
    await expect(page.locator('[data-arrival="Ana García"]')).toHaveCount(0);
    await expect(page.getByText('No one has arrived yet')).toBeVisible();

    // Arabic, right to left.
    await page.goto(dayOf(s, '/ar'));
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText('ضيوف بلا طاولة')).toBeVisible();
    await expectAccessible(page);
  });

  test('a viewer reads the day-of view but gets no check-in, undo or kiosk controls', async ({ page }) => {
    const s = await scenario();
    await signIn(page, VIEWER);
    await page.goto(`${dayOf(s)}?q=Ana`);
    await expect(page.getByRole('heading', { name: 'Arrivals' })).toBeVisible();
    await expect(page.getByLabel('Guest or party name')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Check in/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Undo/ })).toHaveCount(0);
    await expect(page.locator('#kiosks')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Set up a kiosk or board' })).toHaveCount(0);
    await expectAccessible(page);
  });

  test('Scan PWA: check guests in by name or party with labels, offline too, synced once', async ({
    page,
    browser,
  }) => {
    const s = await scenario();
    await signIn(page);
    const d = await openDevice(browser, await addDevice(page, s, `Door phone ${stamp()}`), s);
    const p = d.page;
    const guestsTab = p
      .getByRole('navigation', { name: 'Scanner mode' })
      .getByRole('button', { name: 'Guests' });
    await guestsTab.focus();
    await p.keyboard.press('Enter');
    await expect(p.getByRole('heading', { name: 'Guest check-in' })).toBeVisible();
    await expect(p.getByTestId('guest-totals')).toHaveText('0 of 5 arrived');
    await expect(
      p.getByText('Search for a guest or a party, or pick a label to list its guests.'),
    ).toBeVisible();
    await expectAccessibleBothModes(p);

    // Labels: Bride lists Garcia and Okafor; Groom only Chen.
    await p.getByRole('button', { name: 'Bride', exact: true }).click();
    await expect(p.locator('[data-party]')).toHaveCount(2);
    await expect(p.locator('[data-party="Garcia"]')).toContainText('Bride · Family');
    await expect(p.locator('[data-party="Okafor"]')).toBeVisible();
    await expect(p.getByRole('button', { name: 'Bride', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await p.getByRole('button', { name: 'Bride', exact: true }).click();
    // A name finds the guest; no match says what to do.
    const field = p.getByLabel('Guest or party name');
    await field.fill('nobody here');
    await expect(p.getByText('No guests match')).toBeVisible();
    await field.fill('luis');
    const luis = p.locator('[data-guest="Luis López"]');
    await expect(luis).toContainText('Table 1');
    await luis.getByRole('button', { name: 'Check in Luis López' }).focus();
    await p.keyboard.press('Enter');
    await expect(p.getByTestId('guest-message')).toHaveText('Luis López is checked in. Table 1.');
    await expect(luis).toContainText('Arrived');
    // This wedding takes no gifts online: no card-saving code after the check-in (M4.8e).
    await expect(p.getByTestId('checkin-card-qr')).toHaveCount(0);
    await expect(p.getByTestId('scan-queue')).toHaveText('All scans synced', { timeout: 15_000 });

    // Offline: the party's other guests by party name, from the device's own list.
    await d.context.setOffline(true);
    await field.fill('garcia');
    await expect(p.locator('[data-guest="Guest of Luis López"]')).toBeVisible();
    await p.getByRole('button', { name: 'Check in everyone in Garcia (2)' }).click();
    await expect(p.getByTestId('guest-message')).toHaveText('Guests checked in: 2.');
    await expect(p.getByTestId('scan-queue')).toHaveText('2 scans waiting to sync');
    // A declined guest is marked, and can still be let in by staff.
    await field.fill('mei');
    await expect(p.locator('[data-guest="Mei Chen"]')).toContainText('Declined');
    await expectAccessible(p);
    await d.context.setOffline(false);
    await p.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(p.getByTestId('scan-queue')).toHaveText('All scans synced', { timeout: 15_000 });

    // The host sees all three, once each, recorded by the scanner.
    await page.goto(dayOf(s));
    await expect(page.getByTestId('stat-arrived')).toContainText('3 of 5 expected');
    for (const who of ['Luis López', 'Ana García', 'Guest of Luis López'])
      await expect(page.locator(`[data-arrival="${who}"]`)).toHaveCount(1);
    await expect(
      page.getByRole('row').filter({ has: page.locator('[data-arrival="Ana García"]') }),
    ).toContainText('Scanner');

    // Arabic.
    await p.goto('/ar/scan');
    await expect(p.locator('html')).toHaveAttribute('dir', 'rtl');
    await p.getByRole('navigation').getByRole('button', { name: 'الضيوف' }).click();
    await expect(p.getByRole('heading', { name: 'تسجيل وصول الضيوف' })).toBeVisible();
    await expectAccessible(p);
    await d.context.close();
  });

  test('guest kiosk and A–Z board: started from the day-of page, keep working with the network cut, PIN to leave', async ({
    page,
    browser,
  }) => {
    const s = await scenario();
    await signIn(page);
    const kioskLabel = `Lobby tablet ${stamp()}`;
    const boardLabel = `Foyer TV ${stamp()}`;
    const kiosk = await openDevice(browser, await addDevice(page, s, kioskLabel), s);
    const board = await openDevice(browser, await addDevice(page, s, boardLabel), s);

    // Start them from the day-of page: the PIN is checked inline.
    await page.goto(dayOf(s));
    const kCard = page.locator(`[data-device="${kioskLabel}"]`);
    await kCard.getByLabel(`Staff PIN for ${kioskLabel}`).fill('12');
    await kCard.getByRole('button', { name: 'Start' }).click();
    await expect(kCard.getByText('Enter a PIN of 4 to 8 digits.')).toBeVisible();
    await expect(kCard.getByLabel(`Staff PIN for ${kioskLabel}`)).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page);
    await pickOption(kCard.getByLabel(`Screen for ${kioskLabel}`), { label: 'Guest kiosk' });
    await kCard.getByLabel(`Staff PIN for ${kioskLabel}`).fill('2468');
    await kCard.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByTestId('day-of-feedback')).toHaveText(
      `${kioskLabel} switches over within a few seconds.`,
    );
    const bCard = page.locator(`[data-device="${boardLabel}"]`);
    await pickOption(bCard.getByLabel(`Screen for ${boardLabel}`), { label: 'Table board (A–Z)' });
    await bCard.getByLabel(`Staff PIN for ${boardLabel}`).fill('1357');
    await bCard.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByTestId('day-of-feedback')).toHaveText(
      `${boardLabel} switches over within a few seconds.`,
    );
    await page.reload();
    await expect(page.locator(`[data-device="${kioskLabel}"]`)).toContainText('Guest kiosk');
    await expect(page.locator(`[data-device="${boardLabel}"]`)).toContainText('Table board (A–Z)');

    // Both devices switch over by themselves.
    const k = kiosk.page;
    const b = board.page;
    await expect(k.locator('[data-kiosk="guests"]')).toBeVisible({ timeout: 40_000 });
    await expect(b.locator('[data-kiosk="board"]')).toBeVisible({ timeout: 40_000 });
    await expect(k.getByRole('heading', { name: `Welcome to ${s.eventName}` })).toBeVisible();
    await expect(k.getByRole('navigation', { name: 'Scanner mode' })).toHaveCount(0);
    await expectAccessibleBothModes(k);
    await expectAccessibleBothModes(b);

    // The drill: the venue's network goes down.
    await kiosk.context.setOffline(true);
    await board.context.setOffline(true);

    // The board shows seated guests A–Z by last name with their tables; never the declined,
    // the unseated or an unnamed plus-one.
    await expect(b.locator('[data-board-letter]')).toHaveText(['G', 'L', 'O']);
    await expect(b.locator('[data-board-guest]')).toHaveText([
      /Ana García\s*Table 1/,
      /Luis López\s*Table 1/,
      /Ada Okafor\s*Table 2/,
    ]);
    await expect(b.getByRole('main')).not.toContainText('Mei Chen');
    await expect(b.getByRole('main')).not.toContainText('Kofi Okafor');
    await expect(b.getByRole('main')).not.toContainText('Guest of');
    await expect(b.getByTestId('board-page')).toHaveText('Page 1 of 1');

    // The guest kiosk: a guest types their full name, keyboard only.
    const name = k.getByLabel('Type your first and last name');
    await expect(name).toBeFocused();
    await name.fill('ada okafor');
    await k.keyboard.press('Enter');
    const result = k.locator('[data-kiosk-result]');
    await expect(result).toContainText('Welcome, Ada Okafor!');
    await expect(k.getByTestId('kiosk-place')).toHaveText('Your table: Table 2');
    await expect(result).toContainText("You're checked in. Enjoy!");
    await expectAccessible(k);
    // A partial name, a declined guest and a second visit.
    await name.fill('Ada');
    await k.keyboard.press('Enter');
    await expect(result).toHaveText(
      "We couldn't find that name. Please check the spelling or see a member of staff.",
    );
    await name.fill('Mei Chen');
    await k.keyboard.press('Enter');
    await expect(result).toHaveText('Please see a member of staff.');
    await expect(k.getByRole('main')).not.toContainText('Table 1');
    await name.fill('ADA OKAFOR');
    await k.keyboard.press('Enter');
    await expect(result).toContainText('Welcome back, Ada Okafor!');
    await expect(result).toContainText("You're already checked in.");
    // An unseated guest is told to see staff about their table, and is still checked in.
    await name.fill('Kofi Okafor');
    await k.keyboard.press('Enter');
    await expect(result).toContainText("Your table isn't set yet. Please see a member of staff.");

    // Staff leave the kiosk with the PIN, offline: a wrong PIN first.
    await k.getByRole('button', { name: 'Staff: exit kiosk' }).focus();
    await k.keyboard.press('Enter');
    const pin = k.getByLabel('Staff PIN');
    await expect(pin).toBeFocused();
    await pin.fill('1111');
    await k.keyboard.press('Enter');
    await expect(k.locator('#kiosk-pin-error')).toHaveText('Wrong PIN. 4 tries left.');
    await pin.fill('2468');
    await k.keyboard.press('Enter');
    await expect(k.getByRole('navigation', { name: 'Scanner mode' })).toBeVisible();
    await expect(k.getByTestId('scan-queue')).toHaveText('2 scans waiting to sync');

    // Back online: the kiosk's check-ins reach the host once.
    await kiosk.context.setOffline(false);
    await board.context.setOffline(false);
    await k.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(k.getByTestId('scan-queue')).toHaveText('All scans synced', { timeout: 15_000 });
    await page.goto(dayOf(s));
    const ada = page.getByRole('row').filter({ has: page.locator('[data-arrival="Ada Okafor"]') });
    await expect(ada).toHaveCount(1);
    await expect(ada).toContainText('Guest kiosk');
    await expect(page.locator('[data-arrival="Kofi Okafor"]')).toHaveCount(1);

    // Arabic board, then the host stops it.
    await b.goto('/ar/scan');
    await expect(b.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(b.getByRole('heading', { name: 'اعثر على طاولتك' })).toBeVisible();
    await expectAccessible(b);
    const stop = page.locator(`[data-device="${boardLabel}"]`).getByRole('button', {
      name: `Stop the kiosk on ${boardLabel}`,
    });
    await stop.click();
    await expect(page.getByTestId('day-of-feedback')).toHaveText(`${boardLabel} is back to scanning.`);
    await kiosk.context.close();
    await board.context.close();
  });
});
