import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { expectAccessible, expectAccessibleBothModes, signIn } from './helpers.ts';

/**
 * M5.6a session check-in. The organizer adds a session door (validation, keyboard, persistence),
 * turns on its self check-in flyer and prints it; door staff scan people in and out at session
 * doors: the three gates refuse (`not enrolled`, admission level, a full room) and a full room
 * lets someone in by an audited override with a reason; attendees check themselves in from the
 * flyer (phone-first, attendance only); the Scan PWA scans in and out at a session door and
 * overrides online; a viewer is refused; the screens render right-to-left in Arabic.
 *
 * Setup (a conference under way with registration, three sessions and four registrants) comes
 * from the dev-only `/api/dev/session-checkin`; everything tested goes through the real pages.
 */

const ORG = 'lakeside-events';
const VIEWER = 'jordan@lakeside.test';
const stamp = () => `${Date.now().toString(36)}${test.info().project.name.replace(/\D/g, '')}`;

interface Fixture {
  slug: string;
  path: string;
  people: { name: string; code: string }[];
  flyerToken: string | null;
}

async function fixture(page: Page, name: string, doors = false): Promise<Fixture> {
  const res = await page.request.post('/api/dev/session-checkin', {
    form: { org: ORG, name, doors: doors ? '1' : '0' },
  });
  expect(res.ok()).toBe(true);
  return res.json();
}

const codeOf = (f: Fixture, who: string) => f.people.find((p) => p.name === who)?.code ?? '';

/** Press a control by keyboard (focus, then Enter). */
async function press(control: Locator) {
  await control.focus();
  await control.press('Enter');
}

/** The session picker's "Small room talk" option (its label carries the time and room). */
async function talkOption(page: Page): Promise<string> {
  return (await page.locator('option', { hasText: 'Small room talk' }).first().getAttribute('value')) ?? '';
}

async function guest(browser: Browser) {
  return (await browser.newContext()).newPage();
}

test.describe('session check-in (M5.6a)', () => {
  test('organizer: add a session door by keyboard (with validation), turn on its flyer and print it', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const f = await fixture(page, `Session Doors ${stamp()}`);
    await signIn(page);
    await page.goto(`${f.path}/onsite`);
    await press(page.getByRole('link', { name: 'Session check-in' }));
    await expect(page).toHaveURL(new RegExp(`${f.path}/onsite/sessions$`));
    await expect(page.getByRole('heading', { name: 'Session check-in', level: 1 })).toBeVisible();
    await expect(page.getByText('No session doors yet')).toBeVisible();
    await expectAccessibleBothModes(page);

    // Every validation message, then a door added by keyboard only.
    const add = page.getByRole('button', { name: 'Add session door' });
    await press(add);
    await expect(page.getByText('Give the door a name.')).toBeVisible();
    await page.getByLabel('Door name').fill('Room S door');
    await press(add);
    await expect(page.getByText('Choose the session this door is for.')).toBeVisible();
    await page.getByLabel('Session', { exact: true }).focus();
    await page.getByLabel('Session', { exact: true }).selectOption(await talkOption(page));
    await page.getByLabel('People the room holds (optional)').fill('lots');
    await press(add);
    await expect(
      page.getByText('Enter a whole number from 1 to 1,000,000, or leave it empty.'),
    ).toBeVisible();
    await page.getByLabel('People the room holds (optional)').fill('');
    await page.getByLabel('Self check-in flyer').focus();
    await page.keyboard.press('Space');
    await expect(page.getByLabel('Self check-in flyer')).toBeChecked();
    await press(add);
    await expect(page.getByText('Session door added.')).toBeVisible();
    const door = page.getByTestId('session-door-Room S door');
    await expect(door).toContainText('Small room talk');
    await expect(door).toContainText('Room S');
    await expect(door.getByTestId('in-room')).toHaveText('0 of 1');
    await expect(door).toContainText('Self check-in flyer is on · checked in from the flyer: 0');
    await expectAccessibleBothModes(page);

    // The same name again is refused with its own message.
    await page.getByLabel('Door name').fill('Room S door');
    await page.getByLabel('Session', { exact: true }).selectOption(await talkOption(page));
    await press(add);
    await expect(page.getByText('A checkpoint with this name already exists.')).toBeVisible();

    // Persisted; the flyer prints with a QR to the public page.
    await page.reload();
    await expect(page.getByTestId('session-door-Room S door')).toBeVisible();
    await press(page.getByRole('link', { name: 'Print the self check-in flyer for Room S door' }));
    await expect(page.getByTestId('flyer')).toContainText('Small room talk');
    await expect(page.getByRole('img', { name: 'QR code to check in to Small room talk' })).toBeVisible();
    await expect(page.getByTestId('flyer-url')).toHaveText(/\/en\/session-checkin\/[A-Za-z0-9_-]{32}$/);
    await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
    await expectAccessible(page);

    // Turning the flyer off retires it.
    await page.goto(`${f.path}/onsite/sessions`);
    await press(page.getByRole('button', { name: 'Turn off the self check-in flyer for Room S door' }));
    await expect(page.getByTestId('session-door-Room S door')).toContainText('Self check-in flyer is off');
    await expect(
      page.getByRole('link', { name: 'Print the self check-in flyer for Room S door' }),
    ).toHaveCount(0);
  });

  test('door screen: gates refuse, a full room lets someone in by an audited override; scan in and out', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const f = await fixture(page, `Session Gates ${stamp()}`, true);
    await signIn(page);
    await page.goto(`${f.path}/onsite`);
    const field = page.getByLabel('Ticket code');
    const result = page.getByRole('status').filter({ has: page.locator('[data-result]') });
    const scan = async (code: string) => {
      await field.fill(code);
      await field.press('Enter');
    };
    await page.getByLabel('Scanning at').selectOption({ label: 'Talk door' });
    await expect(page.getByRole('group', { name: 'Scanning' })).toBeVisible();

    // The room holds one: Ana goes in, Ben meets a full room.
    await scan(codeOf(f, 'Ana'));
    await expect(result).toContainText('In — enjoy the session');
    await expect(result).toContainText('Ana');
    await scan(codeOf(f, 'Ben'));
    await expect(result).toContainText('The room is full');
    await expect(result).toContainText('The room holds no more people.');
    await expectAccessibleBothModes(page);

    // The override needs a reason; with one, Ben goes in (and it's counted as an override).
    const override = page.getByRole('form', { name: 'Let in anyway' });
    await press(override.getByRole('button', { name: 'Let in anyway' }));
    await expect(page.getByText('Give a reason (at least 3 characters) to let them in.')).toBeVisible();
    await expect(page.getByRole('form', { name: 'Let in anyway' })).toHaveCount(0);
    await scan(codeOf(f, 'Ben'));
    await expect(result).toContainText('The room is full');
    await override.getByLabel('Reason (kept in the audit log)').fill("Speaker's guest");
    await press(override.getByRole('button', { name: 'Let in anyway' }));
    await expect(result).toContainText('In — enjoy the session');
    await expect(result).toContainText('Ben');

    // A second scan in is a duplicate; scanning out (keyboard: arrow onto "Out") closes the visit.
    await scan(codeOf(f, 'Ana'));
    await expect(result).toContainText('Already checked in');
    await page.getByRole('radio', { name: 'In', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Out', exact: true })).toBeChecked();
    await scan(codeOf(f, 'Ana'));
    await expect(result).toContainText('Checked out of the session');
    await expect(result).toContainText(/In the room for \d+ min/);
    await scan(codeOf(f, 'Ana'));
    await expect(result).toContainText('Not checked into this session');

    // The other gates: not enrolled in the workshop; the day pass doesn't give the briefing.
    await page.getByRole('radio', { name: 'In', exact: true }).check();
    await page.getByLabel('Scanning at').selectOption({ label: 'Workshop door' });
    await scan(codeOf(f, 'Cleo'));
    await expect(result).toContainText('Not enrolled in this session');
    await expect(result).toContainText('They need to be registered and, for this session, enrolled.');
    await scan(codeOf(f, 'Ana'));
    await expect(result).toContainText('In — enjoy the session');
    await page.getByLabel('Scanning at').selectOption({ label: 'Briefing door' });
    await scan(codeOf(f, 'Dev'));
    await expect(result).toContainText("This pass doesn't include this session");
    await expectAccessible(page);

    // The session page counts it all.
    await page.goto(`${f.path}/onsite/sessions`);
    const talk = page.getByTestId('session-door-Talk door');
    await expect(talk.getByTestId('in-room')).toHaveText('1 of 1');
    await expect(talk.getByTestId('attended')).toHaveText('2');
    await expect(talk.getByTestId('overrides')).toHaveText('1');
    await expect(talk.getByText('Room full')).toBeVisible();
    await expect(page.getByTestId('session-door-Workshop door').getByText('Enrollment needed')).toBeVisible();
    await expectAccessibleBothModes(page);
  });

  test('attendee: checks in from the flyer on a phone (attendance only), once', async ({ page, browser }) => {
    test.setTimeout(90_000);
    const f = await fixture(page, `Session Flyer ${stamp()}`, true);
    const phone = await guest(browser);
    await phone.setViewportSize({ width: 375, height: 740 });
    await phone.goto(`/session-checkin/${f.flyerToken}`);
    await expect(phone.getByRole('heading', { name: 'Small room talk', level: 1 })).toBeVisible();
    await expect(phone.getByText('Room S')).toBeVisible();
    await expectAccessibleBothModes(phone);
    const code = phone.getByLabel('Ticket or badge code');
    const submit = phone.getByRole('button', { name: 'Check in' });
    const box = await submit.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await press(submit);
    await expect(phone.getByText('Type the code on your ticket or badge.')).toBeVisible();
    await code.fill('ZZZZZZZZ');
    await press(submit);
    await expect(phone.getByText("We couldn't find a ticket with this code for this event.")).toBeVisible();
    // Dev holds a day pass and Cleo isn't enrolled anywhere: the flyer doesn't gate.
    await code.fill(codeOf(f, 'Cleo').toLowerCase());
    await press(submit);
    await expect(phone.getByText("You're checked in")).toBeVisible();
    await expectAccessible(phone);
    await phone.reload();
    await phone.getByLabel('Ticket or badge code').fill(codeOf(f, 'Cleo'));
    await press(phone.getByRole('button', { name: 'Check in' }));
    await expect(phone.getByText("You're already checked in")).toBeVisible();
    // A token that doesn't exist says so.
    await phone.goto(`/session-checkin/${'x'.repeat(32)}`);
    await expect(phone.getByText('This flyer no longer works')).toBeVisible();

    // The organizer sees the flyer check-in, which holds no seat.
    await signIn(page);
    await page.goto(`${f.path}/onsite/sessions`);
    const flyer = page.getByTestId('session-door-Talk flyer');
    await expect(flyer).toContainText('checked in from the flyer: 1');
    await expect(flyer.getByTestId('in-room')).toHaveText('0 of 1');
  });

  test('Scan PWA: a session door scans in and out, and overrides a full room online', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    const f = await fixture(page, `Session PWA ${stamp()}`, true);
    await signIn(page);
    await page.goto(`${f.path}/onsite`);
    await page.getByLabel('Device name').fill(`Session phone ${stamp()}`);
    await page.getByRole('button', { name: 'Add device' }).click();
    const link = await page.getByTestId('scan-link').getAttribute('href');
    const deviceContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const device = await deviceContext.newPage();
    await device.goto(link ?? '');
    await expect(device.getByText('4 tickets on this device')).toBeVisible();
    await device.getByLabel('Scanning at').selectOption({ label: 'Talk door' });
    await expect(device.getByText('Small room talk')).toBeVisible();
    await expect(device.getByTestId('scan-room-count')).toHaveText('In the room: 0 of 1');
    const field = device.getByLabel('Ticket code');
    const result = device.getByRole('status').filter({ has: device.locator('[data-result]') });
    await field.fill(codeOf(f, 'Ana'));
    await field.press('Enter');
    await expect(result).toContainText('In — enjoy the session');
    await expect(result).toContainText('Confirmed by the server');
    await expect(device.getByTestId('scan-room-count')).toHaveText('In the room: 1 of 1');
    await field.fill(codeOf(f, 'Ben'));
    await field.press('Enter');
    await expect(result).toContainText('The room is full');
    await expectAccessibleBothModes(device);
    const override = device.getByRole('form', { name: 'Let in anyway' });
    await press(override.getByRole('button', { name: 'Let in anyway' }));
    await expect(override.getByText('Give a reason (at least 3 characters) to let them in.')).toBeVisible();
    await override.getByLabel('Reason (kept in the audit log)').fill('Session chair approved');
    await press(override.getByRole('button', { name: 'Let in anyway' }));
    await expect(result).toContainText('In — enjoy the session');

    // Offline: scanning out still works from the device's own list, then syncs.
    await deviceContext.setOffline(true);
    await device.getByRole('radio', { name: 'Out', exact: true }).check();
    await field.fill(codeOf(f, 'Ana'));
    await field.press('Enter');
    await expect(result).toContainText('Checked out of the session');
    await expect(device.getByTestId('scan-network')).toHaveText('Offline');
    await deviceContext.setOffline(false);
    await expect(result).toContainText('Confirmed by the server', { timeout: 45_000 });
    await expect(device.getByTestId('scan-queue')).toHaveText('All scans synced');

    await page.goto(`${f.path}/onsite/sessions`);
    const talk = page.getByTestId('session-door-Talk door');
    await expect(talk.getByTestId('attended')).toHaveText('2');
    await expect(talk.getByTestId('overrides')).toHaveText('1');
  });

  test('a viewer is refused session check-in; Arabic renders right-to-left', async ({ page }) => {
    test.setTimeout(90_000);
    const f = await fixture(page, `Session Roles ${stamp()}`, true);
    await signIn(page, VIEWER);
    await page.goto(`${f.path}/onsite/sessions`);
    await expect(page.getByText("Check-in isn't part of your role")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add session door' })).toHaveCount(0);
    await page.goto(`${f.path}/onsite/sessions/${'0'.repeat(8)}-0000-7000-8000-000000000000/flyer`);
    await expect(page.getByTestId('flyer')).toHaveCount(0);

    await signIn(page);
    await page.goto(`/ar${f.path}/onsite/sessions`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'تسجيل حضور الجلسات', level: 1 })).toBeVisible();
    await expect(page.getByTestId('session-door-Talk door')).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar/session-checkin/${f.flyerToken}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('button', { name: 'تسجيل الحضور' })).toBeVisible();
    await expectAccessible(page);
  });
});
