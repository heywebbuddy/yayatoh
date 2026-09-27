import { expect, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';

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

test.describe('check-in', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('door staff admit a ticket once, see the duplicate, undo, and reject a bad code', async ({
    page,
    browser,
  }) => {
    const stamp = Date.now();
    await signIn(page);
    // An event happening now, so check-in is open.
    await page.goto('/o/lakeside-events/events/new');
    await page.getByLabel('Event name').fill(`Doors ${stamp}`);
    await page.getByLabel('Time zone').selectOption('America/Chicago');
    await page.getByLabel('Starts').fill(chicago(-1));
    await page.getByLabel('Ends').fill(chicago(3));
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/doors-\d+$/);
    const base = new URL(page.url()).pathname;
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();
    await page.goto(`${base}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill('Door pass');
    await page.getByLabel('Price (USD)').fill('0');
    await page.getByLabel('Quantity available').fill('5');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Door pass' })).toBeVisible();

    const guest = await (await browser.newContext()).newPage();
    await guest.goto(`/events/${base.split('/').pop()}`);
    await guest.getByLabel('Quantity — Door pass').selectOption('1');
    await guest.getByLabel('Full name').fill(`Hedy ${stamp}`);
    await guest.getByLabel('Email for your tickets').fill(`hedy+${stamp}@example.test`);
    await guest.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(guest).toHaveURL(/\/orders\//);
    const code = (await guest.locator('.tracking-\\[0\\.2em\\]').first().textContent())?.trim() ?? '';
    expect(code).toMatch(/^[2-9A-Z]{8}$/);

    await page.goto(`${base}/onsite`);
    await expect(page.getByText('0 of 1 tickets checked in today')).toBeVisible();
    const field = page.getByLabel('Ticket code');
    await expect(field).toBeFocused();
    // HID scanners type the code and press Enter.
    await field.fill(code.toLowerCase());
    await field.press('Enter');
    const result = page.getByRole('status').filter({ has: page.locator('[data-result]') });
    await expect(result).toContainText('Welcome in');
    await expect(result).toContainText(`Hedy ${stamp} · Door pass · No. 1`);
    await expect(field).toBeFocused();
    await expect(page.getByText('1 of 1 tickets checked in today')).toBeVisible();

    await field.fill(code);
    await field.press('Enter');
    await expect(result).toContainText('Already checked in');
    await expectAccessible(page);

    await page.getByRole('button', { name: `Undo check-in for Hedy ${stamp}` }).click();
    await expect(page.getByText('0 of 1 tickets checked in today')).toBeVisible();

    await field.fill('NOT-A-TICKET');
    await field.press('Enter');
    await expect(result).toContainText('Not a valid ticket');

    // Offline scanner devices: the key is shown once; a lost device can be revoked.
    await page.getByLabel('Device name').fill(`Gate ${stamp}`);
    await page.getByRole('button', { name: 'Add device' }).click();
    await expect(page.getByText(`Enter this key on Gate ${stamp}. It is shown only once.`)).toBeVisible();
    await expect(page.locator('code').filter({ hasText: /^yyd_/ })).toBeVisible();
    await page.getByRole('button', { name: `Revoke Gate ${stamp}` }).click();
    await expect(page.getByRole('listitem').filter({ hasText: `Gate ${stamp}` })).toContainText('Revoked');
    await expectAccessible(page);
  });
});
