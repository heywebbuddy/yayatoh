import { expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { localKeyVault, setKeyVault } from '@yayatoh/platform';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type AlertScenario, alertScenario } from '@yayatoh/testing';
import { expectAccessible, expectPicked, newUser, pickOption, pickWithKeyboard } from './helpers.ts';

// Tickets are signed with the org's keys: seal them under the web server's key vault.
const kms = process.env.LOCAL_KMS_KEY;
if (kms) setKeyVault(localKeyVault(kms));

test.afterAll(async () => {
  await closePools();
});

const FOUR = [
  '37 attendees do not have seats',
  '120 purchased tickets have not been distributed',
  '14 payments failed',
  'Three check-in devices are offline',
];

/** A fresh org (its owner signed in on `page`) holding the M3.2b alert fixture. */
async function orgWithAlerts(page: Page): Promise<{ slug: string; s: AlertScenario }> {
  // Terms accepted (publishing needs them); its own test event raises nothing.
  const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
  const slug = owner.orgSlug as string;
  const org = await resolveOrgSlug(slug);
  if (!org) throw new Error(`no org ${slug}`);
  return { slug, s: await alertScenario(org.orgId) };
}

const alertTitles = (page: Page) => page.getByRole('main').getByRole('heading', { level: 2 });
const card = (page: Page, title: string) =>
  page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { level: 2, name: title, exact: true }) });

/** What the worker does every few seconds: the outbox through the subscribers, then the sweep. */
async function drain(page: Page, slug: string) {
  const res = await page.request.post('/api/dev/outbox/drain', { form: { org: slug, sweep: '1' } });
  expect(res.status()).toBe(200);
}

test.describe('alerts (M3.2b)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('the four fixture alerts, with their exact text; acknowledge and snooze with the keyboard; history; reload', async ({
    page,
  }) => {
    const { slug, s } = await orgWithAlerts(page);
    await page.goto(`/o/${slug}`);
    // The nav lists Alerts with the open count (in the drawer on small screens).
    const nav = page.locator(`nav a[href$="/${slug}/alerts"]`).first();
    await expect(nav).toBeAttached();
    await expect(nav).toContainText('4');
    await page.goto(`/o/${slug}/alerts`);
    await expect(page.getByRole('heading', { level: 1, name: 'Alerts' })).toBeVisible();
    await expect(alertTitles(page)).toHaveCount(4);
    expect((await alertTitles(page).allInnerTexts()).sort()).toEqual([...FOUR].sort());
    // Most severe first: offline devices are critical while the event is live.
    await expect(alertTitles(page).first()).toHaveText('Three check-in devices are offline');
    for (const title of FOUR) await expect(card(page, title)).toContainText(s.eventName);
    await expectAccessible(page);

    // Keyboard only: focus Acknowledge on the failed payments and press Enter.
    const payments = card(page, '14 payments failed');
    const ack = payments.getByRole('button', { name: 'Acknowledge “14 payments failed”' });
    await ack.focus();
    await expect(ack).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(payments.getByRole('status')).toHaveText(
      'Alert acknowledged. It stays on this page until the problem is fixed.',
    );
    await expect(payments.getByTestId('alert-state')).toHaveText('Acknowledged');
    await expectAccessible(page);

    // Snooze the offline devices for 4 hours: the select, then Tab to Snooze, Enter.
    const devices = card(page, 'Three check-in devices are offline');
    const pick = devices.getByLabel('Snooze for');
    await pick.focus();
    await pickOption(pick, '240');
    await page.keyboard.press('Tab');
    await expect(
      devices.getByRole('button', { name: 'Snooze “Three check-in devices are offline”' }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(devices.getByRole('status')).toContainText('Alert snoozed until');
    await expect(devices.getByTestId('alert-state')).toContainText('Snoozed until');

    // It persisted; the badge counts open alerts only.
    await page.reload();
    await expect(card(page, '14 payments failed').getByTestId('alert-state')).toHaveText('Acknowledged');
    await expect(card(page, 'Three check-in devices are offline').getByTestId('alert-state')).toContainText(
      'Snoozed until',
    );
    await expect(page.locator(`nav a[href$="/${slug}/alerts"]`).first()).toContainText('2');
    // An acknowledged alert can still be snoozed, not acknowledged again.
    await expect(card(page, '14 payments failed').getByRole('button', { name: /^Acknowledge/ })).toHaveCount(
      0,
    );

    // History, opened with the keyboard.
    const summary = card(page, '14 payments failed').getByText('History', { exact: true });
    await summary.focus();
    await page.keyboard.press('Enter');
    const history = card(page, '14 payments failed').getByRole('list');
    await expect(history).toContainText('Raised (14)');
    await expect(history).toContainText('Team notified');
    await expect(history).toContainText('Acknowledged by you');
    await expectAccessible(page);
  });

  test('seating the attendees resolves the alert live; "Seat them" opens the seating assignment', async ({
    page,
  }) => {
    const { slug } = await orgWithAlerts(page);
    await page.goto(`/o/${slug}/alerts`);
    await expect(page.getByTestId('alerts-live')).toHaveAttribute('data-live', 'live');
    await expect(card(page, '37 attendees do not have seats')).toBeVisible();

    // The deep link, in another tab: the assignment page with the 37 still to seat.
    const other = await page.context().newPage();
    await other.goto(page.url());
    await card(other, '37 attendees do not have seats').getByRole('link', { name: 'Seat them' }).click();
    await expect(other).toHaveURL(/\/seating\/assign$/);
    await expect(other.getByRole('heading', { name: 'Assign guests', level: 1 })).toBeVisible();
    const queue = other.getByRole('list', { name: 'People still to seat' });
    await expect(queue.getByRole('listitem')).toHaveCount(37);
    // Seat them all in row F (40 free), with the keyboard.
    const selectAll = other.getByRole('button', { name: 'Select all shown' });
    await selectAll.focus();
    await other.keyboard.press('Enter');
    await expect(other.getByText('37 selected')).toBeVisible();
    const item = other.getByLabel('Table or row');
    await pickWithKeyboard(item, { label: /40 of 40 free/ });
    await other.getByRole('button', { name: 'Seat them' }).focus();
    await other.keyboard.press('Enter');
    await expect(other.locator('[aria-live="polite"]').getByRole('status')).toContainText(
      'Seated 37 people at',
    );
    await expect(queue).toHaveCount(0);

    // The worker's next pass: the first tab drops the alert without a reload.
    await drain(page, slug);
    await expect(card(page, '37 attendees do not have seats')).toHaveCount(0, { timeout: 15_000 });
    await expect(alertTitles(page)).toHaveCount(3);
    await page.getByRole('link', { name: 'Resolved' }).click();
    await expect(card(page, '37 attendees do not have seats').getByTestId('alert-state')).toContainText(
      'Resolved',
    );
    await expectAccessible(page);
    await other.close();
  });

  test('each alert deep-links to the page that fixes it; the event home lists them', async ({ page }) => {
    const { slug, s } = await orgWithAlerts(page);
    await page.goto(`/o/${slug}/alerts`);
    await card(page, '120 purchased tickets have not been distributed')
      .getByRole('link', { name: 'Distribute tickets' })
      .click();
    await expect(page).toHaveURL(/\/attendees\?distribution=pending$/);
    await expectPicked(page.getByLabel('Distribution'), 'pending');
    await expect(page.getByText(/^1–50 of 120/)).toBeVisible();
    await expectAccessible(page);

    await page.goto(`/o/${slug}/alerts`);
    await card(page, '14 payments failed').getByRole('link', { name: 'Review failed payments' }).click();
    await expect(page).toHaveURL(/\/analysis\/bookings\?filter=failed$/);

    await page.goto(`/o/${slug}/alerts`);
    await card(page, 'Three check-in devices are offline')
      .getByRole('link', { name: 'Check the devices' })
      .click();
    await expect(page).toHaveURL(new RegExp(`/e/${s.eventSlug}/onsite$`));

    // The event home: the same alerts in a compact list, with the fixing links.
    await page.goto(`/o/${slug}/e/${s.eventSlug}`);
    const list = page.getByTestId('alerts-list');
    await expect(list.getByRole('heading', { name: 'Alerts' })).toBeVisible();
    for (const title of FOUR) await expect(list).toContainText(title);
    await expect(list.getByRole('link', { name: 'Seat them' })).toHaveAttribute(
      'href',
      `/o/${slug}/e/${s.eventSlug}/seating/assign`,
    );
    await expectAccessible(page);
  });

  test("the Command Center Alerts widget lists the event's alerts; the door layout only the door's", async ({
    page,
    browser,
  }) => {
    const { slug, s } = await orgWithAlerts(page);
    const base = `/o/${slug}/e/${s.eventSlug}`;
    await page.goto(`${base}/command-center`);
    const widget = page.getByTestId('cc-widget-alerts');
    for (const title of FOUR) await expect(widget).toContainText(title);
    await expect(widget.getByRole('link', { name: '37 attendees do not have seats' })).toHaveAttribute(
      'href',
      `${base}/seating/assign`,
    );

    // A viewer made door staff at this event: the door's alerts only (no payments, no sales).
    const doorContext = await browser.newContext();
    const door = await doorContext.newPage();
    const name = `Dora Alerts ${Date.now()}`;
    await newUser(door, { join: [`${slug}:viewer`], name });
    await page.goto(`${base}/onsite/staff`);
    const add = page.getByRole('region', { name: 'Add door staff' });
    await pickOption(add.getByLabel('Team member'), { label: name });
    await add.getByRole('button', { name: 'Add door staff' }).click();
    await expect(add.getByRole('status')).toHaveText('Saved.');
    await door.goto(`${base}/command-center`);
    await expect(door.getByTestId('command-center')).toHaveAttribute('data-role', 'door');
    const doorWidget = door.getByTestId('cc-widget-alerts');
    await expect(doorWidget).toContainText('Three check-in devices are offline');
    await expect(doorWidget).not.toContainText('payments failed');
    await expect(doorWidget).not.toContainText('attendees do not have seats');
    await expectAccessible(door);
    await doorContext.close();
  });

  test('a viewer sees the alerts but cannot acknowledge, snooze or change routing; a scanner is refused', async ({
    page,
    browser,
  }) => {
    const { slug } = await orgWithAlerts(page);
    const viewerContext = await browser.newContext();
    const viewer = await viewerContext.newPage();
    await newUser(viewer, { join: [`${slug}:viewer`] });
    await viewer.goto(`/o/${slug}/alerts`);
    await expect(alertTitles(viewer)).toHaveCount(4);
    await expect(viewer.getByRole('button', { name: /^Acknowledge/ })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /^Snooze/ })).toHaveCount(0);
    await expectAccessible(viewer);
    await viewer.goto(`/o/${slug}/alerts/settings`);
    await expect(viewer.getByText('Only owners and admins can change this.')).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Save routing' })).toHaveCount(0);
    await expect(
      viewer.getByRole('checkbox', { name: 'Email: Payments and payouts alerts for Owner' }),
    ).toBeDisabled();
    await viewerContext.close();

    const scannerContext = await browser.newContext();
    const scanner = await scannerContext.newPage();
    await newUser(scanner, { join: [`${slug}:scanner`] });
    const res = await scanner.goto(`/o/${slug}/alerts`);
    expect(res?.status()).toBe(404);
    await scannerContext.close();
  });

  test('empty states, with no alerts and nothing resolved', async ({ page }) => {
    const owner = await newUser(page, { org: true, twoFactor: true });
    await page.goto(`/o/${owner.orgSlug}/alerts`);
    await expect(page.getByText('No alerts right now')).toBeVisible();
    await page.getByRole('link', { name: 'Resolved' }).click();
    await expect(page.getByText('No resolved alerts yet')).toBeVisible();
    await expectAccessible(page);
  });

  test('settings: my alert number (validation), routing by role and a sales target, kept after reload', async ({
    page,
  }) => {
    const { slug, s } = await orgWithAlerts(page);
    await page.goto(`/o/${slug}/alerts`);
    await page.getByRole('link', { name: 'Alert settings' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Alert settings' })).toBeVisible();
    await expectAccessible(page);

    const phone = page.getByLabel('Mobile number for alert texts');
    await phone.fill('555-0100');
    await page.getByRole('button', { name: 'Save number' }).click();
    await expect(page.getByText('Use the international format, like +1 555 010 0199.')).toBeVisible();
    await expect(phone).toHaveAttribute('aria-invalid', 'true');
    await phone.fill('+1 555 010 0142');
    await phone.press('Enter');
    await expect(page.getByText('Your alert number is saved.')).toBeVisible();

    // Routing: give viewers door alerts in-app (keyboard: Space on the box), save.
    const box = page.getByRole('checkbox', { name: 'In-app: Door and devices alerts for Viewer' });
    await expect(box).not.toBeChecked();
    await box.focus();
    await page.keyboard.press('Space');
    await expect(box).toBeChecked();
    await page.getByRole('button', { name: 'Save routing' }).click();
    await expect(page.getByText('Routing saved.')).toBeVisible();

    // A sales target for the fixture event: a bad number, then a good one.
    const target = page.getByLabel(`Ticket target for ${s.eventName}`);
    await target.fill('lots');
    await page.getByRole('button', { name: `Save the target for ${s.eventName}` }).click();
    await expect(page.getByText('Enter a whole number of tickets, or leave it empty.')).toBeVisible();
    await target.fill('400');
    await page.getByRole('button', { name: `Save the target for ${s.eventName}` }).click();
    await expect(page.getByText('Sales target saved.')).toBeVisible();
    await expectAccessible(page);

    await page.reload();
    await expect(page.getByLabel('Mobile number for alert texts')).toHaveValue('+15550100142');
    await expect(
      page.getByRole('checkbox', { name: 'In-app: Door and devices alerts for Viewer' }),
    ).toBeChecked();
    await expect(page.getByLabel(`Ticket target for ${s.eventName}`)).toHaveValue('400');
  });

  test('Arabic, right to left: the alerts and their settings', async ({ page }) => {
    const { slug } = await orgWithAlerts(page);
    await page.goto(`/ar/o/${slug}/alerts`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'التنبيهات' })).toBeVisible();
    await expect(alertTitles(page)).toHaveCount(4);
    await expect(page.getByRole('heading', { level: 2, name: '37 حاضرًا ليس لديهم مقاعد' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'فشلت 14 دفعة' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: '3 أجهزة تسجيل دخول غير متصلة' })).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar/o/${slug}/alerts/settings`);
    await expect(page.getByRole('heading', { level: 1, name: 'إعدادات التنبيهات' })).toBeVisible();
    await expectAccessible(page);
  });
});
