import { expect, type Page, test } from '@playwright/test';
import { continueToPayment, expectAccessible, signIn } from './helpers.ts';

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

async function buy(guest: Page, slug: string, type: string, name: string): Promise<string> {
  await guest.goto(`/events/${slug}`);
  await guest.getByLabel(`Quantity — ${type}`).selectOption('1');
  await guest.getByLabel('Full name').fill(name);
  await guest.getByLabel('Email for your tickets').fill(`${name.replace(/\s/g, '.')}@example.test`);
  await continueToPayment(guest, `${name.replace(/\s/g, '.')}@example.test`);
  await expect(guest).toHaveURL(/\/orders\//);
  return (await guest.locator('.tracking-\\[0\\.2em\\]').first().textContent())?.trim() ?? '';
}

test.describe('entrances and zones', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('a manager sets up gates and a VIP zone; scanners pick where they stand', async ({
    page,
    browser,
  }) => {
    const stamp = Date.now();
    await signIn(page);
    await page.goto('/o/lakeside-events/events/new');
    await page.getByLabel('Event name', { exact: true }).fill(`Gates ${stamp}`);
    await page.getByLabel('Time zone').selectOption('America/Chicago');
    await page.getByLabel('Starts', { exact: true }).fill(chicago(-1));
    await page.getByLabel('Ends', { exact: true }).fill(chicago(3));
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/gates-\d+$/);
    const base = new URL(page.url()).pathname;
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();
    await page.goto(`${base}/tickets-orders`);
    for (const name of ['General', 'VIP']) {
      await page.getByLabel('Name', { exact: true }).fill(name);
      await page.getByLabel('Price (USD)').fill('0');
      await page.getByLabel('Quantity available').fill('5');
      await page.getByRole('button', { name: 'Add ticket type' }).click();
      await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
    }

    const guest = await (await browser.newContext()).newPage();
    const slug = base.split('/').pop() ?? '';
    const general = await buy(guest, slug, 'General', `Gil ${stamp}`);
    const vip = await buy(guest, slug, 'VIP', `Vic ${stamp}`);

    await page.goto(`${base}/onsite`);
    const setup = page.getByRole('region', { name: 'Entrances and zones' });
    const add = async (name: string, kind: 'Entrance' | 'Zone', types: string[] = []) => {
      await setup.getByLabel('Name', { exact: true }).fill(name);
      await setup.getByLabel('Type').selectOption({ label: kind });
      for (const t of types) await setup.getByLabel(t, { exact: true }).check();
      await setup.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(setup.getByRole('listitem').filter({ hasText: name })).toBeVisible();
    };
    await add('North gate', 'Entrance');
    await add('South gate', 'Entrance');
    await add('VIP lounge', 'Zone', ['VIP']);
    await expect(setup.getByRole('listitem').filter({ hasText: 'VIP lounge' })).toContainText('Zone · VIP');
    await expectAccessible(page);

    const where = page.getByLabel('Scanning at');
    const field = page.getByLabel('Ticket code');
    const result = page.getByRole('status').filter({ has: page.locator('[data-result]') });
    const scan = async (code: string) => {
      await field.fill(code);
      await field.press('Enter');
    };

    await where.selectOption({ label: 'VIP lounge' });
    await scan(general);
    await expect(result).toContainText("This pass doesn't include this area");
    await scan(vip);
    await expect(result).toContainText('Access granted');
    // The zone admits nobody to the event.
    await expect(page.getByText('0 of 2 tickets checked in today')).toBeVisible();

    await where.selectOption({ label: 'North gate' });
    await scan(general);
    await expect(result).toContainText('Welcome in');
    await expect(page.getByRole('list', { name: 'Checked in today by entrance' })).toContainText(
      'North gate · 1',
    );
    // The same pass at another gate a moment later: refused, and flagged for the team.
    await where.selectOption({ label: 'South gate' });
    await expect(where).toHaveValue(/.+/);
    await scan(general);
    await expect(result).toContainText('Already checked in');
    const signals = page.getByRole('region', { name: '1 thing to check' });
    await expect(signals).toContainText(`Ticket shown at a second entrance · Gil ${stamp} · South gate`);
    await expectAccessible(page);

    await setup.getByRole('button', { name: 'Archive South gate' }).click();
    await expect(setup.getByRole('listitem').filter({ hasText: 'South gate' })).toContainText('Archived');
    await expect(where.locator('option')).toHaveText(['Whole event', 'North gate', 'VIP lounge']);
  });
});
