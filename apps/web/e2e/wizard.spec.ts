import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, expectPicked, pickOption, signIn } from './helpers.ts';

const VIEWER = 'jordan@lakeside.test';
const ORG = '/o/lakeside-events';
const WIZARD = `${ORG}/events/new/guided`;
const TZ = 'America/Chicago';

const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;
const chicagoDate = (days: number) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000));
const at = (days: number, hhmm: string) => `${chicagoDate(days)}T${hhmm}`;

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

const stepHeading = (page: Page, name: string) => page.getByRole('heading', { name, level: 2 });

test.describe('event creation wizard and readiness (M1.4f)', () => {
  test('every step validates, back and next keep values, and finishing creates the draft', async ({
    page,
  }) => {
    const s = stamp();
    await signIn(page);
    // The org home's primary action opens the wizard.
    await page.goto(ORG);
    await page.getByRole('link', { name: 'Create event' }).first().click();
    await expect(page).toHaveURL(new RegExp(`${WIZARD}$`));
    await expect(page.getByRole('heading', { name: 'Create an event', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Step 1 of 3: Basics' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    await expect(page.getByRole('button', { name: 'Step 2 of 3: When and where' })).toBeDisabled();
    await expectAccessible(page);
    await noHorizontalScroll(page);

    // Step 1: the name is required.
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Please fix the highlighted fields.')).toBeVisible();
    await expect(page.getByText('Enter a name of 2 to 160 characters.')).toBeVisible();
    await expect(page.getByLabel('Event name', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page);
    await page.getByLabel('Event name', { exact: true }).fill(`Wizard Summit ${s}`);
    await page.getByLabel('Tagline (optional)').fill('Two days of ideas.');
    await pickOption(page.getByLabel('Event type'), 'conference');
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 2: focus moves to its heading; both times required; the end after the start.
    await expect(stepHeading(page, 'When and where')).toBeFocused();
    await expect(page.getByRole('button', { name: 'Step 2 of 3: When and where' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Enter when the event starts.')).toBeVisible();
    await expect(page.getByText('Enter when the event ends.')).toBeVisible();
    await pickOption(page.getByLabel('Time zone'), TZ);
    await page.getByLabel('Starts', { exact: true }).fill(at(30, '09:00'));
    await page.getByLabel('Ends', { exact: true }).fill(at(30, '08:00'));
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('The end must be after the start.')).toBeVisible();
    await expectAccessible(page);
    await page.getByLabel('Ends', { exact: true }).fill(at(31, '17:00'));
    await page.getByRole('radio', { name: 'Online event' }).check();

    // Back keeps step 2's values and shows step 1's.
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(stepHeading(page, 'Basics')).toBeFocused();
    await expect(page.getByLabel('Event name', { exact: true })).toHaveValue(`Wizard Summit ${s}`);
    await expect(page.getByLabel('Tagline (optional)')).toHaveValue('Two days of ideas.');
    await expectPicked(page.getByLabel('Event type'), 'conference');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByLabel('Starts', { exact: true })).toHaveAttribute('data-value', at(30, '09:00'));
    await expect(page.getByLabel('Ends', { exact: true })).toHaveAttribute('data-value', at(31, '17:00'));
    await expect(page.getByRole('radio', { name: 'Online event' })).toBeChecked();
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 3: the first pass is all-or-nothing; the checklist reflects what was entered.
    await expect(stepHeading(page, 'Tickets and publishing')).toBeFocused();
    await page.getByLabel('Quantity').fill('0');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page.getByText('Give the pass a name.')).toBeVisible();
    await expect(page.getByText('Enter how many are for sale (at least 1).')).toBeVisible();
    await page.getByLabel('Pass name').fill('General');
    await page.getByLabel('Price (USD)').fill('12.345');
    await page.getByLabel('Quantity').fill('100');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page.getByText('Enter a price like 25 or 25.00.')).toBeVisible();
    await page.getByLabel('Price (USD)').fill('25');
    const summary = page.getByRole('region', { name: 'Summary' });
    await expect(summary.getByText(`Wizard Summit ${s}`)).toBeVisible();
    await expect(summary.getByText('Online event')).toBeVisible();
    const checklist = page.getByRole('region', { name: 'Before you publish' });
    await expect(checklist.getByText('Tickets created')).toBeVisible();
    await expect(checklist.getByText('Event published')).toBeVisible();
    await expectAccessible(page);
    // The stepper can jump back to a step already reached.
    await page.getByRole('button', { name: 'Step 1 of 3: Basics' }).click();
    await expect(page.getByLabel('Event name', { exact: true })).toHaveValue(`Wizard Summit ${s}`);
    await page.getByRole('button', { name: 'Step 3 of 3: Tickets and publishing' }).click();
    await expect(page.getByLabel('Pass name')).toHaveValue('General');
    await page.getByRole('button', { name: 'Create draft' }).click();

    // The draft exists, with its tagline, mode and pass, and the setup guide opens.
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/wizard-summit-[a-z0-9-]+\/setup-guide$/);
    await expect(page.getByRole('heading', { name: 'Setup guide', level: 1 })).toBeVisible();
    const guide = page.getByRole('list', { name: 'Readiness checklist' });
    const rule = (key: string) => guide.locator(`li[data-rule="${key}"]`);
    await expect(rule('taglineWritten').getByText('Done')).toBeVisible();
    await expect(rule('venueSet').getByText('Done')).toBeVisible();
    await expect(rule('ticketsCreated').getByText('Done')).toBeVisible();
    await expect(
      rule('descriptionAdded').getByRole('link', { name: 'Go to: Description added' }),
    ).toBeVisible();
    await expect(rule('agendaAdded').getByRole('link', { name: 'Go to: Agenda added' })).toBeVisible();
    await expectAccessible(page);
    const base = new URL(page.url()).pathname.replace(/\/setup-guide$/, '');
    await page.goto(`${base}/tickets-orders`);
    await expect(page.getByRole('row').filter({ hasText: 'General' })).toBeVisible();
    await page.goto(`${base}/details`);
    await expect(page.getByRole('radio', { name: 'Online', exact: true })).toBeChecked();
  });

  test('keyboard only: Enter moves forward, and the draft is created', async ({ page }) => {
    const s = stamp();
    await signIn(page);
    await page.goto(WIZARD);
    await page.getByLabel('Event name', { exact: true }).focus();
    await page.keyboard.type(`Keys Only ${s}`);
    await page.keyboard.press('Enter');
    await expect(stepHeading(page, 'When and where')).toBeFocused();
    await page.getByLabel('Starts', { exact: true }).fill(at(20, '18:00'));
    await page.getByLabel('Ends', { exact: true }).fill(at(20, '22:00'));
    await page.getByLabel('Ends', { exact: true }).press('Enter');
    await expect(stepHeading(page, 'Tickets and publishing')).toBeFocused();
    // Tab from the heading reaches the controls; Enter on Create draft submits.
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();
    await page.getByRole('button', { name: 'Create draft' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/setup-guide$/);
    await expect(page.getByRole('heading', { name: 'Setup guide', level: 1 })).toBeVisible();
  });

  test('a server-side error takes you back to its step (name already taken)', async ({ page }) => {
    const s = stamp();
    await signIn(page);
    const name = `Twin Event ${s}`;
    for (const attempt of [1, 2]) {
      await page.goto(WIZARD);
      await page.getByLabel('Event name', { exact: true }).fill(name);
      await page.getByRole('button', { name: 'Next' }).click();
      await page.getByLabel('Starts', { exact: true }).fill(at(25, '18:00'));
      await page.getByLabel('Ends', { exact: true }).fill(at(25, '21:00'));
      await page.getByRole('button', { name: 'Next' }).click();
      await page.getByRole('button', { name: 'Create draft' }).click();
      if (attempt === 1) await expect(page).toHaveURL(/\/setup-guide$/);
    }
    await expect(page.getByRole('button', { name: 'Step 1 of 3: Basics' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    await expect(
      page.getByText('An event with this name already exists. Try a slightly different name.'),
    ).toBeVisible();
    await expect(page.getByLabel('Event name', { exact: true })).toHaveValue(name);
    await expectAccessible(page);
  });

  test('the setup guide and the dashboard checklist link to the pages that fix each rule', async ({
    page,
  }) => {
    const s = stamp();
    await signIn(page);
    await page.goto(WIZARD);
    await page.getByLabel('Event name', { exact: true }).fill(`Guide Links ${s}`);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Starts', { exact: true }).fill(at(25, '18:00'));
    await page.getByLabel('Ends', { exact: true }).fill(at(25, '21:00'));
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/setup-guide$/);
    const base = new URL(page.url()).pathname.replace(/\/setup-guide$/, '');
    await expect(page.getByText(/steps left/)).toBeVisible();
    for (const [link, path] of [
      ['Go to: Venue added', '/details'],
      ['Go to: Short description written', '/content'],
      ['Go to: Tickets created', '/tickets-orders'],
    ] as const) {
      await page.goto(`${base}/setup-guide`);
      const target = page.getByRole('link', { name: link });
      await target.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`${base}${path}$`));
    }
    // The dashboard's checklist links the open rules too, and the setup guide.
    await page.goto(base);
    await page.getByRole('link', { name: 'Venue added' }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/details$`));
    await page.goto(base);
    await page.getByRole('link', { name: 'Open the setup guide' }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/setup-guide$`));
    // Picking a venue marks the rule done.
    await page.goto(`${base}/details`);
    await page.getByRole('radio', { name: 'Online', exact: true }).check();
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Details saved.')).toBeVisible();
    await page.goto(`${base}/setup-guide`);
    await expect(page.locator('li[data-rule="venueSet"]').getByText('Done')).toBeVisible();
  });

  test('a viewer cannot open the wizard; the one-page form still works', async ({ page, browser }) => {
    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    const res = await viewer.goto(WIZARD);
    expect(res?.status()).toBe(404);
    await signIn(page);
    await page.goto(`${ORG}/events/new`);
    await expect(page.getByRole('link', { name: 'Guided setup (3 steps)' })).toBeVisible();
    await page.getByRole('link', { name: 'Guided setup (3 steps)' }).click();
    await expect(page).toHaveURL(new RegExp(`${WIZARD}$`));
    await page.getByRole('link', { name: 'One-page form' }).click();
    await expect(page.getByRole('button', { name: 'Create draft' })).toBeVisible();
  });

  test('Arabic: the wizard renders right-to-left on every step', async ({ page }) => {
    await signIn(page);
    await page.goto(`/ar${WIZARD}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(page);
    await noHorizontalScroll(page);
    await page.locator('#wizard-name').fill('حفل');
    await page.locator('form button[type="submit"]').click();
    await page.locator('#wizard-starts').fill(at(25, '18:00'));
    await page.locator('#wizard-ends').fill(at(25, '21:00'));
    await expectAccessible(page);
    await noHorizontalScroll(page);
    await page.locator('form button[type="submit"]').click();
    await expect(page.locator('#wizard-ticket-name')).toBeVisible();
    await expectAccessible(page);
    await noHorizontalScroll(page);
  });
});
