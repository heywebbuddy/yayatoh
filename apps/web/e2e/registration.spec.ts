import { type Browser, expect, type Page, test } from '@playwright/test';
import { expectAccessible, lastEmailedCode, signIn } from './helpers.ts';

/**
 * M5.1a registration types and admission items: the organizer seeds the standard types and items,
 * adds a code-only and a domain-only type, sets capacity and prices in the type × item matrix (by
 * keyboard); buyers see only the types open to them, register, and a full type offers its
 * waitlist; the viewer reads the page and every write is refused; Arabic renders right-to-left.
 */

const VIEWER = 'jordan@lakeside.test';
const ORG = '/o/lakeside-events';
const TZ = 'America/Chicago';
const stamp = () => `${Date.now().toString(36)}${test.info().project.name.replace(/\D/g, '')}`;

function chicagoDate(days: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000));
}

/** A published conference 40 days out; its console path and slug. */
async function conference(page: Page, name: string) {
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Event type').selectOption('conference');
  await page.getByLabel('Time zone').selectOption(TZ);
  await page.getByLabel('Starts', { exact: true }).fill(`${chicagoDate(40)}T09:00`);
  await page.getByLabel('Ends', { exact: true }).fill(`${chicagoDate(42)}T18:00`);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  return { base, slug: base.split('/').pop() as string };
}

const typeCard = (page: Page, name: string) =>
  page
    .getByRole('region', { name: 'Registration types' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });

/** Seed the standard types and items by keyboard. */
async function seed(page: Page, base: string) {
  await page.goto(`${base}/registration`);
  await expect(page.getByRole('heading', { name: 'Registration', level: 1 })).toBeVisible();
  await expect(page.getByText('No registration types yet', { exact: true })).toBeVisible();
  const button = page.getByRole('button', { name: 'Add standard types and items' });
  await button.focus();
  await page.keyboard.press('Enter');
  for (const name of ['Member', 'Non-member', 'Student', 'Exhibitor', 'Speaker', 'VIP'])
    await expect(typeCard(page, name)).toBeVisible();
}

/** Set a matrix cell's price by keyboard (type the price, press Enter). */
async function price(page: Page, cell: string, amount: string) {
  const field = page.getByLabel(`Price for ${cell} (USD)`);
  await field.fill(amount);
  await field.press('Enter');
  await expect(page.getByRole('button', { name: `Save price — ${cell}` })).toBeVisible();
}

/** Set a type's capacity through its edit form. */
async function capacity(page: Page, type: string, value: string) {
  const card = typeCard(page, type);
  await card.getByText(`Edit ${type}`).click();
  await card.getByLabel('Capacity').fill(value);
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByText('Saved.')).toBeVisible();
}

/** The public registration page: email (and code) → the types this buyer may pick. */
async function options(page: Page, slug: string, email: string, code = '') {
  await page.goto(`/events/${slug}/register`);
  await page.getByLabel('Your email').fill(email);
  await page.getByLabel('Registration code (optional)').fill(code);
  await page.getByRole('button', { name: 'Show my options' }).click();
  await expect(page.getByRole('heading', { name: 'Choose your registration' })).toBeVisible();
  return page.getByRole('form', { name: 'Registration' });
}

async function verify(page: Page, email: string) {
  const field = page.getByLabel('Verification code', { exact: true });
  await expect(field).toBeVisible();
  await field.fill(await lastEmailedCode(page, email));
  await page.getByRole('button', { name: 'Verify and continue' }).click();
}

async function guest(browser: Browser) {
  return (await browser.newContext()).newPage();
}

test.describe('registration types and admission items (M5.1a)', () => {
  test('organizer sets up types, items, eligibility, capacity and prices by keyboard; buyers register; a full type offers its waitlist', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    await signIn(page);
    const { base, slug } = await conference(page, `Summit ${s}`);
    // The conference nav leads to the page (no longer a placeholder).
    await page.goto(base);
    // (On phones the nav sits behind the menu button: the link is there either way.)
    await expect(page.locator(`a[href$="${base}/registration"]`).first()).toHaveText(/Registration/);
    await page.goto(`${base}/registration`);
    await expect(page.getByText('This area is being built')).toHaveCount(0);
    await expectAccessible(page);
    await seed(page, base);
    await expect(page.getByText(/Conference pack: free during the beta/)).toBeVisible();

    // A code-only type and a domain-only type, with their validation errors.
    const add = page.getByRole('region', { name: 'Add registration type' });
    await add.getByRole('button', { name: 'Add registration type' }).click();
    await expect(add.getByText('Enter a name (up to 80 characters).')).toBeVisible();
    await add.getByLabel('Type name').fill('Press');
    await add.getByLabel('Who may register').selectOption('access_code');
    await add.getByRole('button', { name: 'Add registration type' }).click();
    await expect(add.getByText('Enter an access code of 4 to 32 letters, digits, - or _.')).toBeVisible();
    await add.getByLabel('Access code').fill(`press-${s}`);
    await add.getByRole('button', { name: 'Add registration type' }).click();
    await expect(add.getByText('Registration type added.')).toBeVisible();
    await expect(typeCard(page, 'Press')).toContainText('Needs an access code');
    await add.getByLabel('Type name').fill('Staff');
    await add.getByLabel('Who may register').selectOption('email_domain');
    await add.getByRole('button', { name: 'Add registration type' }).click();
    await expect(add.getByText('Enter at least one valid domain, such as acme.org.')).toBeVisible();
    await add.getByLabel('Email domains').fill('acme.test');
    await add.getByRole('button', { name: 'Add registration type' }).click();
    await expect(add.getByText('Registration type added.')).toBeVisible();
    await expect(typeCard(page, 'Staff')).toContainText('Only for email addresses at acme.test');

    // Capacity: Member takes one registrant.
    await capacity(page, 'Member', '1');
    await expect(typeCard(page, 'Member')).toContainText('0 of 1 places taken');

    // The matrix: a bad price is refused; then Member, Press and Staff get a free full pass.
    const matrix = page.getByRole('region', { name: 'Price of each admission item by registration type' });
    await expect(matrix.getByRole('columnheader', { name: 'Full pass' })).toBeVisible();
    const field = page.getByLabel('Price for Member · Full pass (USD)');
    await field.fill('abc');
    await field.press('Enter');
    await expect(page.getByText('Enter a price such as 250 or 250.00.')).toBeVisible();
    await price(page, 'Member · Full pass', '0');
    await price(page, 'Press · Full pass', '0');
    await price(page, 'Staff · Full pass', '0');
    await price(page, 'Member · Dinner', '45');
    await expectAccessible(page);
    // The matrix scrolls inside its own region; the page never scrolls sideways.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
    // Persisted after a reload.
    await page.reload();
    await expect(page.getByLabel('Price for Member · Dinner (USD)')).toHaveValue('45.00');
    await expect(page.getByRole('button', { name: 'Stop offering — Member · Dinner' })).toBeVisible();

    // The public event page leads to registration.
    const buyer = await guest(browser);
    await buyer.goto(`/events/${slug}`);
    await buyer.getByRole('link', { name: 'Register', exact: true }).click();
    await expect(buyer).toHaveURL(new RegExp(`/events/${slug}/register$`));
    await expect(buyer.getByRole('heading', { name: 'Register', level: 1 })).toBeVisible();
    await expectAccessible(buyer);
    await buyer.getByRole('button', { name: 'Show my options' }).click();
    await expect(buyer.getByText('Enter a valid email address.')).toBeVisible();

    // An ineligible buyer never sees the code or domain types (nor a wrong code).
    const ann = `ann.${s}@example.test`;
    let form = await options(buyer, slug, ann, 'WRONG-CODE');
    await expect(form.getByRole('radio', { name: /^Member/ })).toBeVisible();
    await expect(form.getByRole('radio', { name: /^Press/ })).toHaveCount(0);
    await expect(form.getByRole('radio', { name: /^Staff/ })).toHaveCount(0);
    form = await options(buyer, slug, ann, `PRESS-${s}`);
    await expect(form.getByRole('radio', { name: /^Press/ })).toBeVisible();
    await expect(form.getByRole('radio', { name: /^Staff/ })).toHaveCount(0);
    const staff = await guest(browser);
    const staffForm = await options(staff, slug, `kim.${s}@acme.test`);
    await expect(staffForm.getByRole('radio', { name: /^Staff/ })).toBeVisible();
    await staff.close();

    // Register as Member by keyboard: the type, the pass (default) and an add-on, the name.
    const member = form.getByRole('radio', { name: /^Member/ });
    await member.focus();
    await buyer.keyboard.press('Space');
    await expect(form.getByRole('radio', { name: /^Full pass/ })).toBeChecked();
    await form.getByRole('checkbox', { name: /^Dinner/ }).check();
    await form.getByRole('button', { name: 'Register' }).click();
    await expect(form.getByText('Enter your name.')).toBeVisible();
    await form.getByLabel('Full name').fill('Ann Buyer');
    await form.getByRole('button', { name: 'Register' }).click();
    await verify(buyer, ann);
    // Dinner costs money: the payment page, then the order.
    await expect(buyer).toHaveURL(/\/checkout\/fake|\/orders\//);
    await buyer.close();

    // Member is now full: the next buyer is offered its waitlist.
    const bo = `bo.${s}@example.test`;
    const next = await guest(browser);
    const nextForm = await options(next, slug, bo);
    const full = nextForm.getByRole('radio', { name: /^Member.*Full$/ });
    await expect(full).toBeVisible();
    await full.check();
    await expect(nextForm.getByText('Member is full')).toBeVisible();
    await expectAccessible(next);
    await nextForm.getByLabel('Full name').fill('Bo Waiting');
    await nextForm.getByRole('button', { name: 'Join the waitlist' }).click();
    await verify(next, bo);
    await expect(next.getByText("You're on the waitlist: number 1 in line.")).toBeVisible();
    await next.close();

    // The organizer sees the counts.
    await page.reload();
    await expect(typeCard(page, 'Member')).toContainText('1 of 1 places taken');
    await expect(typeCard(page, 'Member')).toContainText('Waitlist: 1 waiting, 0 offered');
  });

  test('the viewer sees the page read-only and every write is refused', async ({ page, browser }) => {
    const s = stamp();
    await signIn(page);
    const { base } = await conference(page, `Viewer Summit ${s}`);
    await seed(page, base);
    await price(page, 'Member · Full pass', '10');
    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/registration`);
    await expect(
      viewer.getByText('You can view registration. Only organizers with edit rights can change it.'),
    ).toBeVisible();
    await expect(viewer.getByRole('button', { name: /^Add / })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /^(Offer|Save price|Stop offering) / })).toHaveCount(0);
    await expect(viewer.getByText(/^Edit /)).toHaveCount(0);
    await expect(viewer.getByRole('cell', { name: '10.00 USD' })).toBeVisible();
    await expectAccessible(viewer);
    await viewer.close();

    // The owner's open forms, submitted as the viewer: refused by the server.
    const add = page.getByRole('region', { name: 'Add registration type' });
    await add.getByLabel('Type name').fill('Sneaky');
    const cell = page.getByLabel('Price for Student · Day pass (USD)');
    await cell.fill('5');
    const member = typeCard(page, 'Member');
    await member.getByText('Edit Member').click();
    await signIn(page, VIEWER);
    await add.getByRole('button', { name: 'Add registration type' }).click();
    await expect(add.getByRole('alert').filter({ hasText: "You don't have access to this." })).toBeVisible();
    await cell.press('Enter');
    await expect(page.getByText("You don't have access to this.").nth(1)).toBeVisible();
    await member.getByRole('button', { name: 'Archive Member' }).click();
    await expect(
      member.getByRole('alert').filter({ hasText: "You don't have access to this." }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Stop offering — Member · Full pass' }).click();
    await expect(page.getByText("You don't have access to this.")).toHaveCount(4);
  });

  test('Arabic: the registration page and the public registration render right-to-left', async ({ page }) => {
    const s = stamp();
    await signIn(page);
    const { base, slug } = await conference(page, `RTL Summit ${s}`);
    await seed(page, base);
    await price(page, 'Member · Full pass', '0');
    await page.goto(`/ar${base}/registration`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar/events/${slug}/register`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.locator('input[name="email"]').fill(`rtl.${s}@example.test`);
    await page.locator('form').first().locator('button[type="submit"]').click();
    await expect(page.locator('input[name="type"]').first()).toBeVisible();
    await expectAccessible(page);
  });
});
