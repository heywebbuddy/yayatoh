import { type Browser, expect, type Page, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';

const VIEWER = 'jordan@lakeside.test';

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

/** A live event with a free pass and `count` tickets bought by a guest; returns its console path and codes. */
async function eventWithTickets(page: Page, browser: Browser, name: string, count: number) {
  await page.goto('/o/lakeside-events/events/new');
  await page.getByLabel('Event name').fill(name);
  await page.getByLabel('Time zone').selectOption('America/Chicago');
  await page.getByLabel('Starts').fill(chicago(-1));
  await page.getByLabel('Ends').fill(chicago(3));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill('Door pass');
  await page.getByLabel('Price (USD)').fill('0');
  await page.getByLabel('Quantity available').fill('10');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Door pass' })).toBeVisible();
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/events/${base.split('/').pop()}`);
  await guest.getByLabel('Quantity — Door pass').selectOption(String(count));
  await guest.getByLabel('Full name').fill(`Guest ${name}`);
  await guest.getByLabel('Email for your tickets').fill(`guest+${Date.now()}@example.test`);
  await guest.getByRole('button', { name: 'Continue to payment' }).click();
  await expect(guest).toHaveURL(/\/orders\//);
  const codes = (await guest.locator('.tracking-\\[0\\.2em\\]').allTextContents()).map((c) => c.trim());
  expect(codes).toHaveLength(count);
  await guest.context().close();
  return { base, codes };
}

/** No sideways scrolling at the current viewport (the 375 px layout of the scan screens). */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('checkpoint-scoped door staff', () => {
  test('a manager limits a door-staff member to one gate by keyboard; their door screen and Scan PWA only admit there', async ({
    page,
    browser,
  }, info) => {
    const stamp = `${Date.now()}-${info.project.name}`;
    await signIn(page);
    const { base, codes } = await eventWithTickets(page, browser, `Scoped ${stamp}`, 3);

    await page.goto(`${base}/onsite`);
    const setup = page.getByRole('region', { name: 'Entrances and zones' });
    for (const gate of ['North gate', 'South gate']) {
      await setup.getByLabel('Name', { exact: true }).fill(gate);
      await setup.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(setup.getByRole('listitem').filter({ hasText: gate })).toBeVisible();
    }

    // The staff screen: empty at first.
    await page.getByRole('link', { name: 'Manage door staff' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Door staff' })).toBeVisible();
    await expect(page.getByText('No door staff yet')).toBeVisible();
    await expectAccessible(page);

    // Validation: nobody chosen.
    const add = page.getByRole('region', { name: 'Add door staff' });
    await add.getByRole('button', { name: 'Add door staff' }).click();
    await expect(add.getByRole('alert')).toHaveText('Choose a team member.');
    await expectAccessible(page);

    // Keyboard only: pick Jordan, tick North gate, submit.
    const member = add.getByLabel('Team member');
    await member.focus();
    await page.keyboard.press('ArrowDown');
    await expect(member.locator('option:checked')).toHaveText('Jordan Lee');
    await add.getByRole('checkbox', { name: 'North gate' }).focus();
    await page.keyboard.press('Space');
    await expect(add.getByRole('checkbox', { name: 'North gate' })).toBeChecked();
    await add.getByRole('button', { name: 'Add door staff' }).focus();
    await page.keyboard.press('Enter');
    await expect(add.getByRole('status')).toHaveText('Saved.');
    const list = page.getByRole('region', { name: 'Who scans here' });
    const jordan = list.getByRole('listitem').filter({ hasText: 'Jordan Lee' });
    await expect(jordan.getByTestId('staff-scope')).toHaveText('Scans at: North gate');
    await expectAccessible(page);
    await page.reload();
    await expect(jordan.getByTestId('staff-scope')).toHaveText('Scans at: North gate');
    await expect(jordan.getByRole('checkbox', { name: 'North gate' })).toBeChecked();
    await expect(jordan.getByRole('checkbox', { name: 'South gate' })).not.toBeChecked();

    // The door screen lists staff per checkpoint; a device is handed to Jordan.
    await page.goto(`${base}/onsite`);
    const staffList = page.getByRole('region', { name: 'Door staff by checkpoint' });
    await expect(staffList.getByRole('listitem').filter({ hasText: 'North gate' })).toContainText(
      'Jordan Lee',
    );
    await expect(staffList.getByRole('listitem').filter({ hasText: 'South gate' })).toContainText(
      'Nobody assigned',
    );
    await page.getByLabel('Device name').fill(`Jordan phone ${stamp}`);
    await page.getByLabel('Handed to').selectOption({ label: 'Jordan Lee' });
    await page.getByRole('button', { name: 'Add device' }).click();
    const link = await page.getByTestId('scan-link').getAttribute('href');
    expect(link).toMatch(/\/scan#e=[0-9a-f-]{36}&k=yyd_/);
    await expect(page.getByText(`Jordan phone ${stamp} · for Jordan Lee`)).toBeVisible();
    await expectAccessible(page);

    // Jordan, signed in, at the door screen: only North gate, and nothing without choosing it.
    const jordanPage = await (await browser.newContext()).newPage();
    await signIn(jordanPage, VIEWER);
    await jordanPage.goto(`${base}/onsite`);
    const where = jordanPage.getByLabel('Scanning at');
    await expect(where.locator('option')).toHaveText(['Choose your checkpoint', 'North gate']);
    const field = jordanPage.getByLabel('Ticket code');
    const result = jordanPage.getByRole('status').filter({ has: jordanPage.locator('[data-result]') });
    await field.fill(codes[0] as string);
    await field.press('Enter');
    await expect(result).toContainText('Not your checkpoint');
    await expect(result).toContainText('You scan at North gate.');
    await expectAccessible(jordanPage);
    await expectNoHorizontalScroll(jordanPage);
    await where.selectOption({ label: 'North gate' });
    await field.fill(codes[0] as string);
    await field.press('Enter');
    await expect(result).toContainText('Welcome in');
    await expectAccessible(jordanPage);
    // Jordan sees the staff screen read-only.
    await jordanPage.goto(`${base}/onsite/staff`);
    await expect(jordanPage.getByTestId('staff-scope')).toHaveText('Scans at: North gate');
    await expect(jordanPage.getByText('Only owners and admins can change door staff.')).toBeVisible();
    await expect(jordanPage.getByRole('button', { name: /Add door staff|Save|Remove/ })).toHaveCount(0);
    await expectAccessible(jordanPage);

    // Jordan's phone (Scan PWA): the signed manifest only holds North gate.
    const deviceContext = await browser.newContext();
    const device = await deviceContext.newPage();
    await device.goto(link ?? '');
    await expect(device.getByRole('heading', { name: `Scoped ${stamp}` })).toBeVisible();
    const stand = device.getByLabel('Scanning at');
    await expect(stand.locator('option')).toHaveText(['Choose your checkpoint', 'North gate']);
    const code = device.getByLabel('Ticket code');
    const verdict = device.getByRole('status').filter({ has: device.locator('[data-result]') });
    await code.fill(codes[1] as string);
    await code.press('Enter');
    await expect(verdict).toContainText('Not your checkpoint');
    await expect(verdict).toContainText('You scan at North gate.');
    await expect(verdict).toContainText('Confirmed by the server');
    await expectAccessible(device);
    await expectNoHorizontalScroll(device);
    await stand.selectOption({ label: 'North gate' });
    await code.fill(codes[1] as string);
    await code.press('Enter');
    await expect(verdict).toContainText('Welcome in');
    await expect(verdict).toContainText('Confirmed by the server');
    await expectAccessible(device);
    await deviceContext.close();

    // The owner widens Jordan to the whole event (keyboard), then removes them.
    await page.goto(`${base}/onsite/staff`);
    const north = jordan.getByRole('checkbox', { name: 'North gate' });
    await north.focus();
    await page.keyboard.press('Space');
    await expect(north).not.toBeChecked();
    await jordan.getByRole('button', { name: 'Save Jordan Lee' }).focus();
    await page.keyboard.press('Enter');
    await expect(jordan.getByRole('status')).toHaveText('Saved.');
    await expect(jordan.getByTestId('staff-scope')).toHaveText('Scans at: Anywhere at the event');
    await page.goto(`${base}/onsite`);
    await expect(
      page.getByRole('region', { name: 'Door staff by checkpoint' }).getByRole('listitem').first(),
    ).toContainText('Anywhere at the event');
    await expect(
      page.getByRole('region', { name: 'Door staff by checkpoint' }).getByRole('listitem').first(),
    ).toContainText('Jordan Lee');
    await page.goto(`${base}/onsite/staff`);
    await page.getByRole('button', { name: 'Remove Jordan Lee' }).click();
    await expect(page.getByText('No door staff yet')).toBeVisible();
    // Jordan (a viewer) no longer scans here.
    await jordanPage.goto(`${base}/onsite`);
    await expect(jordanPage.getByRole('heading', { name: 'Check-in' })).toBeVisible();
    await expect(jordanPage.getByLabel('Ticket code')).toHaveCount(0);
    await jordanPage.context().close();
  });

  test('the staff screen renders right-to-left in Arabic', async ({ page, browser }, info) => {
    const stamp = `${Date.now()}-${info.project.name}`;
    await signIn(page);
    const { base } = await eventWithTickets(page, browser, `Rtl ${stamp}`, 1);
    await page.goto(`/ar${base}/onsite/staff`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'طاقم الأبواب' })).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar${base}/onsite`);
    await expect(page.getByRole('heading', { name: 'طاقم الأبواب حسب نقطة التفتيش' })).toBeVisible();
    await expectAccessible(page);
    await expectNoHorizontalScroll(page);
  });
});
