import { type Browser, expect, type Page, test } from '@playwright/test';
import { continueToPayment, expectAccessible, signIn } from './helpers.ts';

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
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Time zone').selectOption('America/Chicago');
  await page.getByLabel('Starts', { exact: true }).fill(chicago(-1));
  await page.getByLabel('Ends', { exact: true }).fill(chicago(3));
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
  const email = `guest+${Date.now()}@example.test`;
  await guest.getByLabel('Email for your tickets').fill(email);
  await continueToPayment(guest, email);
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

test.describe('velocity fraud signals', () => {
  test('rapid scans raise a velocity signal on the door screen and the fraud list; managers acknowledge and dismiss', async ({
    page,
    browser,
  }, info) => {
    // A long journey (an event with tickets, a burst of scans, triage from two roles).
    test.setTimeout(90_000);
    const stamp = `${Date.now()}-${info.project.name}`;
    await signIn(page);
    const { base, codes } = await eventWithTickets(page, browser, `Fast ${stamp}`, 1);

    // A viewer with no role at this event can't open the fraud list.
    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/onsite/signals`);
    await expect(
      viewer.getByText('Only people who scan at this event can see its fraud signals.'),
    ).toBeVisible();
    await expect(viewer.getByRole('button', { name: /Acknowledge|Dismiss|Save rules/ })).toHaveCount(0);
    await expectAccessible(viewer);
    await viewer.context().close();

    // Empty list, then tighten the rules (with validation) so a few quick scans trip them.
    await page.goto(`${base}/onsite/signals`);
    await expect(page.getByText('No signals')).toBeVisible();
    await expectAccessible(page);
    const rules = page.getByRole('region', { name: 'Detection rules' });
    const rate = rules.getByLabel('Most scans a person can do in a minute');
    const speed = rules.getByLabel('Fastest walking speed between checkpoints (km/h)');
    await expect(rate).toHaveValue('40');
    await rate.fill('1');
    await rules.getByRole('button', { name: 'Save rules' }).click();
    await expect(rules.getByText('Enter a whole number from 2 to 600.')).toBeVisible();
    await expectAccessible(page);
    await rate.fill('3');
    await speed.fill('fast');
    await rules.getByRole('button', { name: 'Save rules' }).click();
    await expect(rules.getByText('Enter a whole number from 1 to 200.')).toBeVisible();
    await speed.fill('12');
    await rules.getByRole('button', { name: 'Save rules' }).click();
    await expect(rules.getByRole('status')).toHaveText('Rules saved.');
    await page.reload();
    await expect(rate).toHaveValue('3');

    // Four scans in a few seconds from one scanner: more than 3 a minute.
    await page.goto(`${base}/onsite`);
    const field = page.getByLabel('Ticket code');
    const result = page.getByRole('status').filter({ has: page.locator('[data-result]') });
    const recent = page.getByRole('region', { name: 'Recent scans' }).getByRole('listitem');
    // Each scan lands in "Recent scans" before the next (the field is cleared after every result).
    for (let i = 0; i < 4; i++) {
      await field.fill(codes[0] as string);
      await field.press('Enter');
      await expect(recent).toHaveCount(i + 1);
      await expect(result).toContainText(i === 0 ? 'Welcome in' : 'Already checked in');
    }
    const panel = page.getByRole('region', { name: '1 thing to check' });
    await expect(panel).toContainText('Scanning faster than a person can');
    await expect(panel).toContainText('Medium');
    await expect(panel).toContainText('4 scans in a minute (limit 3)');
    await expectAccessible(page);
    await expectNoHorizontalScroll(page);

    // Five bad codes: an invalid burst, and with the three duplicates that's eight refusals in a
    // row (a refused burst). The rate signal isn't raised twice in the same minute.
    for (let i = 0; i < 5; i++) {
      await field.fill(`BOGUS-${i}`);
      await field.press('Enter');
      await expect(recent).toHaveCount(5 + i);
      await expect(result).toContainText('Not a valid ticket');
    }
    const three = page.getByRole('region', { name: '3 things to check' });
    await expect(three).toContainText('Several invalid codes in a row');
    await expect(three).toContainText('Many refused scans in a row');
    await expect(three).toContainText('Low');
    await expect(three.getByText('Scanning faster than a person can')).toHaveCount(1);

    // The fraud list: all open; acknowledge one by keyboard, dismiss the others.
    await page.getByRole('link', { name: 'See all fraud signals' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Fraud signals' })).toBeVisible();
    await expect(page.getByText('3 open signals')).toBeVisible();
    const velocity = page.locator('[data-signal="device_velocity"]');
    const burst = page.locator('[data-signal="invalid_burst"]');
    const refused = page.locator('[data-signal="rejected_burst"]');
    await expect(refused).toContainText('8 refused in 120 s');
    await expect(velocity).toContainText('Open');
    await expect(velocity).toContainText('4 scans in a minute (limit 3)');
    await expectAccessible(page);
    await velocity.getByRole('button', { name: /^Acknowledge: Scanning faster/ }).focus();
    await page.keyboard.press('Enter');
    await expect(velocity.getByRole('status')).toHaveText('Acknowledged: the team can see someone is on it.');
    await expect(velocity).toContainText('Acknowledged');
    await expect(velocity.getByRole('button')).toHaveCount(0);
    await burst.getByRole('button', { name: /^Dismiss: Several invalid codes/ }).click();
    await expect(burst.getByRole('status')).toHaveText('Dismissed.');
    await refused.getByRole('button', { name: /^Dismiss: Many refused scans/ }).click();
    await expect(refused.getByRole('status')).toHaveText('Dismissed.');
    await expect(page.getByText('Nothing open')).toBeVisible();
    await expectAccessible(page);
    await page.reload();
    await expect(velocity).toContainText('Acknowledged');
    await expect(burst).toContainText('Dismissed');
    await expect(refused).toContainText('Dismissed');

    // Checkpoint locations feed the impossible-travel rule: both or neither, in range.
    await page.goto(`${base}/onsite`);
    const setup = page.getByRole('region', { name: 'Entrances and zones' });
    await setup.getByLabel('Name', { exact: true }).fill('East gate');
    await setup.getByLabel('Latitude').fill('41.8623');
    await setup.getByRole('button', { name: 'Add', exact: true }).click();
    const locationError =
      'Enter both latitude (−90 to 90) and longitude (−180 to 180) as numbers, or leave both empty.';
    await expect(setup.getByText(locationError).first()).toBeVisible();
    await expectAccessible(page);
    await setup.getByLabel('Name', { exact: true }).fill('East gate');
    await setup.getByLabel('Latitude').fill('41.8623');
    await setup.getByLabel('Longitude').fill('-87.6167');
    await setup.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(setup.getByRole('listitem').filter({ hasText: 'East gate' })).toContainText(
      'Entrance · at 41.86230, -87.61670',
    );

    // The door screen only shows open signals.
    await expect(page.getByRole('region', { name: /things? to check/ })).toHaveCount(0);

    // Arabic, right to left.
    await page.goto(`/ar${base}/onsite/signals`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'إشارات الاحتيال' })).toBeVisible();
    await expectAccessible(page);
  });
});
