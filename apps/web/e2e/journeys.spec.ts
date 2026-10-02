import { type Browser, expect, type Page, test } from '@playwright/test';
import { continueToPayment, expectAccessible, newUser } from './helpers.ts';

/**
 * M3.7a journeys: create the vision journey from the template, switch it on, buy a ticket, see the
 * confirmation in the mailbox and the scheduled steps in the run history (per journey and per
 * person); build and reorder steps with the keyboard; validation; viewers read only; Arabic RTL.
 */

const stamp = () => `${Date.now().toString(36)}${test.info().project.name.replace(/\D/g, '')}`;

interface Mail {
  subject: string;
  text: string;
}

async function drain(page: Page, org: string) {
  const res = await page.request.post('/api/dev/outbox/drain', { form: { org } });
  expect(res.ok()).toBe(true);
}

async function mailbox(page: Page, to: string): Promise<Mail[]> {
  const res = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(to)}`);
  expect(res.ok()).toBe(true);
  return res.json();
}

/** A fresh org whose owner is signed in on `page`. */
async function ownOrg(page: Page): Promise<string> {
  const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
  return owner.orgSlug as string;
}

/** A published event 30 days out (19:00–23:00 Chicago) with a free pass; its console path and slug. */
async function eventWithPass(page: Page, org: string, name: string) {
  await page.goto(`/o/${org}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Time zone').selectOption('America/Chicago');
  const d = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel('Starts', { exact: true }).fill(`${d}T19:00`);
  await page.getByLabel('Ends', { exact: true }).fill(`${d}T23:00`);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${org}/e/[a-z0-9-]+$`));
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill('Pass');
  await page.getByLabel('Price (USD)').fill('0');
  await page.getByLabel('Quantity available').fill('50');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Pass' })).toBeVisible();
  return { base, slug: base.split('/').pop() as string };
}

/** A guest takes one free pass (paid at once). */
async function buy(browser: Browser, slug: string, name: string, email: string) {
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/events/${slug}`);
  await guest.getByLabel('Quantity — Pass').selectOption('1');
  await guest.getByLabel('Full name').fill(name);
  await guest.getByLabel('Email for your tickets').fill(email);
  await continueToPayment(guest, email);
  await expect(guest).toHaveURL(/\/orders\//);
  await guest.close();
}

test.describe('journeys (M3.7a)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('vision template → switch on → a purchase sends the confirmation and plans the other steps', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    const org = await ownOrg(page);
    const eventName = `Journey Night ${s}`;
    const { slug } = await eventWithPass(page, org, eventName);

    // Empty list, reachable from the nav.
    await page.goto(`/o/${org}`);
    await expect(page.locator(`nav a[href$="/${org}/journeys"]`).first()).toBeAttached();
    await page.goto(`/o/${org}/journeys`);
    await expect(page.getByRole('heading', { level: 1, name: 'Journeys' })).toBeVisible();
    await expect(page.getByText('No journeys yet')).toBeVisible();
    await expectAccessible(page);

    // New journey, keyboard only: validation first (no event chosen).
    await page.getByRole('link', { name: 'New journey' }).first().focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'New journey' })).toBeVisible();
    await expect(page.getByLabel('Journey name')).toHaveValue('Vision journey');
    await expect(page.getByRole('radio', { name: /The vision journey/ })).toBeChecked();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Create journey' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Choose an event or series.')).toBeVisible();
    await page.getByLabel('Journey name').fill(' ');
    const scope = page.getByLabel('Event or series');
    const option = await scope.locator('option', { hasText: eventName }).getAttribute('value');
    await scope.selectOption(option as string);
    await page.getByRole('button', { name: 'Create journey' }).click();
    await expect(page.getByText('Enter a name (up to 120 characters).')).toBeVisible();
    await page.getByLabel('Journey name').fill(`Welcome ${s}`);
    await page.getByRole('button', { name: 'Create journey' }).click();
    await expect(page).toHaveURL(/\/journeys\/[0-9a-f-]{36}\?created=1$/);
    const path = new URL(page.url()).pathname;
    await expect(page.getByText('Journey created. Check the steps, then switch it on.')).toBeVisible();
    // The five vision steps, in order, with their timing in words.
    await expect(page.getByTestId('step-summary')).toHaveText([
      'Right away',
      '7 days before the event starts',
      '1 day before the event starts',
      'On the event day, at 9:00 AM',
      '1 day after the event ends, at 10:00 AM',
    ]);
    const actions = page.getByLabel('Do', { exact: true });
    for (const [i, v] of ['email', 'email', 'sms', 'push', 'survey'].entries())
      await expect(actions.nth(i)).toHaveValue(v);
    await expectAccessible(page);

    // Switch on (keyboard).
    await page.getByRole('button', { name: `Switch on Welcome ${s}` }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByText('Journey switched on. People who join from now on get its steps.'),
    ).toBeVisible();
    await expect(page.getByText('Switch the journey off to edit its steps.')).toBeVisible();
    await expect(page.getByRole('button', { name: `Switch off Welcome ${s}` })).toBeVisible();
    await expect(page.getByText('Nobody has joined yet.')).toBeVisible();

    // A guest buys: the confirmation arrives; the other steps wait for their days.
    const email = `jo.${s}@example.test`;
    await buy(browser, slug, `Jo ${s}`, email);
    await drain(page, org);
    await expect
      .poll(async () => (await mailbox(page, email)).map((m) => m.subject))
      .toContain(`You're in: ${eventName}`);
    const mail = (await mailbox(page, email)).find((m) => m.subject === `You're in: ${eventName}`);
    expect(mail?.text).toContain(`Hi Jo ${s}, thanks for your order. We'll see you at ${eventName} on`);

    // Run history per journey, then per person.
    await page.goto(path);
    const row = page.getByRole('row').filter({ hasText: email });
    await expect(row).toContainText('In progress');
    await expect(row).toContainText('1 of 5 done');
    await expectAccessible(page);
    await row.getByRole('link', { name: `Jo ${s}` }).click();
    await expect(page.getByRole('heading', { level: 1, name: `Jo ${s}` })).toBeVisible();
    const steps = page.getByRole('table', { name: 'Steps for this person' });
    await expect(steps.getByRole('row')).toHaveCount(6);
    await expect(steps.getByRole('row').nth(1)).toContainText('Message sent to the queue');
    for (const n of [2, 3, 4, 5]) await expect(steps.getByRole('row').nth(n)).toContainText('Waiting');
    await expectAccessible(page);

    // Search the history for the person; persistence after reload.
    await page.goto(path);
    await page.getByRole('searchbox', { name: 'Find a person by name or email' }).fill('nobody-here');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText('Nobody matches “nobody-here”.')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Find a person by name or email' }).fill(`jo.${s}`);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('row').filter({ hasText: email })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('row').filter({ hasText: email })).toBeVisible();

    // The list shows it on, with one person.
    await page.goto(`/o/${org}/journeys`);
    const listed = page.getByRole('row').filter({ hasText: `Welcome ${s}` });
    await expect(listed).toContainText('On');
    await expect(listed).toContainText('Buys a ticket');

    // Switching off cancels the waiting steps.
    await page.goto(path);
    await page.getByRole('button', { name: `Switch off Welcome ${s}` }).click();
    await expect(page.getByText('Journey switched off. 4 waiting steps were cancelled.')).toBeVisible();
  });

  test('build steps with the keyboard: add, validate, reorder, remove, save, reload', async ({ page }) => {
    const s = stamp();
    const org = await ownOrg(page);
    const eventName = `Builder Night ${s}`;
    await eventWithPass(page, org, eventName);
    await page.goto(`/o/${org}/journeys/new`);
    await page.getByLabel('Journey name').fill(`Blank ${s}`);
    const scope = page.getByLabel('Event or series');
    await scope.selectOption(
      (await scope.locator('option', { hasText: eventName }).getAttribute('value')) as string,
    );
    await page.getByRole('radio', { name: /A blank journey/ }).check();
    await page.getByLabel('People join when they…').selectOption('checked_in');
    await page.getByRole('button', { name: 'Create journey' }).click();
    await expect(page).toHaveURL(/\/journeys\/[0-9a-f-]{36}\?created=1$/);
    const path = new URL(page.url()).pathname;
    await expect(page.getByText('No steps yet. Add one below.')).toBeVisible();

    // Switching on without steps is refused with a message.
    await page.getByRole('button', { name: `Switch on Blank ${s}` }).click();
    await expect(page.getByText('Add at least one step before switching the journey on.')).toBeVisible();

    // Add a step with the keyboard: focus lands on its first field.
    await page.getByRole('button', { name: 'Add step' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Measured from').first()).toBeFocused();
    await expect(page.getByRole('group', { name: 'Step 1' })).toBeVisible();
    // Saving without a subject and body shows the field error.
    await page.getByRole('button', { name: 'Save journey' }).click();
    await expect(page.getByText('Fill this in.').first()).toBeVisible();
    await expect(page.getByText('Check step 1.')).toBeVisible();
    const step1 = page.getByRole('group', { name: 'Step 1' });
    await step1.getByLabel('Subject').fill('Welcome in, {name}');
    await step1.getByLabel('Message').fill('Enjoy {event}.');
    await step1.getByLabel('Minutes').fill('30');
    await expect(step1.getByTestId('step-summary')).toHaveText('30 minutes after they join');

    // A second step: a label, with a condition.
    await page.getByRole('button', { name: 'Add step' }).click();
    const step2 = page.getByRole('group', { name: 'Step 2' });
    await step2.getByLabel('Do', { exact: true }).selectOption('label');
    await step2.getByLabel('Label').fill('Came in');
    await step2.getByLabel('Only if').selectOption('checked_in');
    // Move it up with the keyboard; focus follows the moved step.
    await page.getByRole('button', { name: 'Move step 2 up' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('group', { name: 'Step 1' }).getByLabel('Do', { exact: true })).toHaveValue(
      'label',
    );
    await expect(page.getByRole('button', { name: 'Move step 1 down' })).toBeFocused();
    await expectAccessible(page);
    // A third step, then remove it.
    await page.getByRole('button', { name: 'Add step' }).click();
    await page.getByRole('button', { name: 'Remove step 3' }).click();
    await expect(page.getByRole('group', { name: 'Step 3' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Save journey' }).click();
    await expect(page.getByText('Journey saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('group', { name: 'Step 1' }).getByLabel('Do', { exact: true })).toHaveValue(
      'label',
    );
    await expect(page.getByRole('group', { name: 'Step 1' }).getByLabel('Label')).toHaveValue('Came in');
    await expect(page.getByRole('group', { name: 'Step 2' }).getByLabel('Subject')).toHaveValue(
      'Welcome in, {name}',
    );
    await expect(page.getByRole('group', { name: 'Step 2' }).getByTestId('step-summary')).toHaveText(
      '30 minutes after they join',
    );
    // A journey that never ran can be deleted.
    await page.goto(path);
    await page.getByRole('button', { name: `Delete Blank ${s}` }).click();
    await expect(page.getByText('Journey deleted.')).toBeVisible();
    await expect(page.getByText('No journeys yet')).toBeVisible();
  });

  test('a viewer reads journeys but cannot change them; the new page is not found', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    const org = await ownOrg(page);
    const eventName = `Viewer Night ${s}`;
    await eventWithPass(page, org, eventName);
    const path = await visionJourneyByValue(page, org, eventName, `Read only ${s}`);

    const ctx = await browser.newContext();
    const viewer = await ctx.newPage();
    await newUser(viewer, { join: [`${org}:viewer`] });
    await viewer.goto(`/o/${org}/journeys`);
    await expect(viewer.getByRole('heading', { level: 1, name: 'Journeys' })).toBeVisible();
    await expect(viewer.getByRole('link', { name: 'New journey' })).toHaveCount(0);
    await viewer.getByRole('link', { name: `Read only ${s}` }).click();
    await expect(viewer.getByRole('heading', { level: 1, name: `Read only ${s}` })).toBeVisible();
    await expect(viewer.getByRole('button', { name: /Switch on/ })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Save journey' })).toHaveCount(0);
    await expect(viewer.getByRole('list', { name: 'Steps' }).getByRole('listitem')).toHaveCount(5);
    await expectAccessible(viewer);
    const res = await viewer.goto(`/o/${org}/journeys/new`);
    expect(res?.status()).toBe(404);
    expect(path).toMatch(/\/journeys\//);
    await ctx.close();
  });

  test('renders right-to-left in Arabic', async ({ page }) => {
    const s = stamp();
    const org = await ownOrg(page);
    const eventName = `Arabic Night ${s}`;
    await eventWithPass(page, org, eventName);
    const path = await visionJourneyByValue(page, org, eventName, `Arabic ${s}`);
    await page.goto(`/ar/o/${org}/journeys`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'المسارات' })).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar${path}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('group', { name: 'الخطوة 1' })).toBeVisible();
    await expect(page.getByTestId('step-summary').first()).toHaveText('فورًا');
    await expectAccessible(page);
    await page.goto(`/ar/o/${org}/journeys/new`);
    await expect(page.getByRole('heading', { level: 1, name: 'مسار جديد' })).toBeVisible();
    await expectAccessible(page);
  });
});

/** New vision journey by picking the event's option (whatever its date label). */
async function visionJourneyByValue(page: Page, org: string, eventName: string, name: string) {
  await page.goto(`/o/${org}/journeys/new`);
  await page.getByLabel('Journey name').fill(name);
  const scope = page.getByLabel('Event or series');
  await scope.selectOption(
    (await scope.locator('option', { hasText: eventName }).getAttribute('value')) as string,
  );
  await page.getByRole('button', { name: 'Create journey' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${org}/journeys/[0-9a-f-]{36}\\?created=1$`));
  return new URL(page.url()).pathname;
}
