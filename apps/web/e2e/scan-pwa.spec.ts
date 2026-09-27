import { expect, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';

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

test.describe('Scan PWA', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a device set up from its link scans online, keeps scanning offline, and syncs on reconnect', async ({
    page,
    browser,
  }) => {
    const stamp = Date.now();
    await signIn(page);
    await page.goto('/o/lakeside-events/events/new');
    await page.getByLabel('Event name').fill(`Scan ${stamp}`);
    await page.getByLabel('Time zone').selectOption('America/Chicago');
    await page.getByLabel('Starts').fill(chicago(-1));
    await page.getByLabel('Ends').fill(chicago(3));
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/scan-\d+$/);
    const base = new URL(page.url()).pathname;
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();
    await page.goto(`${base}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill('Gate pass');
    await page.getByLabel('Price (USD)').fill('0');
    await page.getByLabel('Quantity available').fill('5');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Gate pass' })).toBeVisible();

    const guest = await (await browser.newContext()).newPage();
    await guest.goto(`/events/${base.split('/').pop()}`);
    await guest.getByLabel('Quantity — Gate pass').selectOption('2');
    await guest.getByLabel('Full name').fill(`Ida ${stamp}`);
    await guest.getByLabel('Email for your tickets').fill(`ida+${stamp}@example.test`);
    await guest.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(guest).toHaveURL(/\/orders\//);
    const codes = (await guest.locator('.tracking-\\[0\\.2em\\]').allTextContents()).map((c) => c.trim());
    expect(codes).toHaveLength(2);

    await page.goto(`${base}/onsite`);
    await page.getByLabel('Device name').fill(`Phone ${stamp}`);
    await page.getByRole('button', { name: 'Add device' }).click();
    const link = await page.getByTestId('scan-link').getAttribute('href');
    expect(link).toMatch(/\/scan#e=[0-9a-f-]{36}&k=yyd_/);

    // The device: its own browser context, no session.
    const deviceContext = await browser.newContext();
    const device = await deviceContext.newPage();
    await device.goto(link ?? '');
    await expect(device.getByRole('heading', { name: `Scan ${stamp}` })).toBeVisible();
    await expect(device.getByText('2 tickets on this device')).toBeVisible();
    // The key left the address bar once it was stored.
    expect(device.url()).not.toContain('yyd_');
    await expectAccessible(device);

    const field = device.getByLabel('Ticket code');
    const result = device.getByRole('status').filter({ has: device.locator('[data-result]') });
    await field.fill(codes[0] as string);
    await field.press('Enter');
    await expect(result).toContainText('Welcome in');
    await expect(result).toContainText('Confirmed by the server');

    // Wi-Fi drops: scanning continues from the downloaded list, the scan waits in the queue.
    await deviceContext.setOffline(true);
    await field.fill(codes[1] as string);
    await field.press('Enter');
    await expect(result).toContainText('Welcome in');
    await expect(result).toContainText('will be confirmed when synced');
    await expect(device.getByTestId('scan-queue')).toHaveText('1 scan waiting to sync');
    // Same ticket again on this device: a local duplicate, no network needed.
    await field.fill(codes[1] as string);
    await field.press('Enter');
    await expect(result).toContainText('Already checked in');

    await deviceContext.setOffline(false);
    await expect(device.getByTestId('scan-queue')).toHaveText('All scans synced', { timeout: 15_000 });

    await page.reload();
    await expect(page.getByText('2 of 2 tickets checked in today')).toBeVisible();
  });
});
