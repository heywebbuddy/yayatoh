import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  continueToPayment,
  expectAccessibleBothModes,
  expectPicked,
  OPEN_HOUSE,
  pickOption,
  pickWithKeyboard,
  signIn,
} from './helpers.ts';

/**
 * U9 (UX-5, UX-6): org-wide coupons on one Coupons list (with every event's promo codes), redeemed
 * at checkout within their events and limits; the per-event currency, chosen at creation and
 * locked once the event has an order; the org's default currency through the CurrencyPicker.
 */
const ORG = '/o/lakeside-events';
const VIEWER = 'jordan@lakeside.test';

const tag = () => `${Date.now().toString(36).toUpperCase()}${test.info().project.name.replace(/\D/g, '')}`;

async function addPass(page: Page, name: string, price: string) {
  await page.goto(`${OPEN_HOUSE}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Price (USD)').fill(price);
  await page.getByLabel('Quantity available').fill('10');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
}

async function buyWithCode(browser: Browser, pass: string, email: string, code: string, guest?: Page) {
  const page = guest ?? (await (await browser.newContext()).newPage());
  await page.goto('/events/lakeside-open-house');
  await pickOption(page.getByLabel(`Quantity — ${pass}`), '1');
  await page.getByLabel('Full name').fill(`Coupon Buyer ${code}`);
  await page.getByLabel('Email for your tickets').fill(email);
  await page.getByLabel('Promo code').fill(code.toLowerCase());
  // A browser that already proved the address gets no second code (M1.5f).
  await continueToPayment(page, email, { verify: !guest });
  return page;
}

test.describe('org-wide coupons', () => {
  test('an org coupon is made on the Coupons page, redeemed at checkout and counted; one use per buyer', async ({
    page,
    browser,
  }) => {
    const id = tag();
    const pass = `Coupon pass ${id}`;
    const code = `ORG${id}`;
    const email = `coupon+${id.toLowerCase()}@example.test`;
    await signIn(page);
    await addPass(page, pass, '40');
    // The event's promo section points to the one list.
    await page.getByRole('link', { name: 'See every code' }).click();
    await expect(page).toHaveURL(new RegExp(`${ORG}/coupons$`));
    await expect(page.getByRole('heading', { name: 'Coupons', level: 1 })).toBeVisible();
    await expectAccessibleBothModes(page);

    await page.getByLabel('Code', { exact: true }).fill(code.toLowerCase());
    await pickOption(page.getByLabel('Discount type'), 'percent');
    await page.getByLabel('Percentage', { exact: true }).fill('25');
    await pickOption(page.getByLabel('Applies to', { exact: true }), 'events');
    const events = page.getByRole('combobox', { name: 'Events' });
    await events.fill('Lakeside Open');
    await page.getByRole('option', { name: /Lakeside Open House/ }).click();
    await expect(page.getByRole('button', { name: /Remove Lakeside Open House/ })).toBeVisible();
    await page.getByLabel('Total uses (optional)').fill('5');
    await page.getByLabel('Uses per buyer (optional)').fill('1');
    await page.getByRole('button', { name: 'Add coupon' }).click();
    await expect(page.getByText('Coupon added.')).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: code });
    await expect(row).toContainText('Org coupon');
    await expect(row).toContainText('Lakeside Open House');
    await expect(row).toContainText('25% off');
    await expect(row).toContainText('0 / 5');
    await expect(row).toContainText('Active');
    await expectAccessibleBothModes(page);

    // A guest redeems it: 25% off the $40 pass.
    const guest = await buyWithCode(browser, pass, email, code);
    await expect(guest.getByRole('heading', { name: 'Pay for your order' })).toBeVisible();
    await expect(guest.getByText('$30.00')).toBeVisible();
    await guest.getByRole('button', { name: 'Pay now (test)' }).click();
    await expect(guest.getByText('Paid', { exact: true })).toBeVisible();
    await expect(guest.getByText(`Includes $10.00 off with ${code}`)).toBeVisible();

    // The same buyer again: their one use is spent.
    await buyWithCode(browser, pass, email, code, guest);
    await expect(guest.getByRole('region', { name: 'Choose your pass' }).getByRole('alert')).toContainText(
      "You've already used this code as many times as it allows.",
    );

    // Counted on the list, and still counted after a reload.
    await page.reload();
    await expect(page.getByRole('row').filter({ hasText: code })).toContainText('1 / 5');

    // Paused, it is just "not valid" at checkout.
    await page.getByRole('button', { name: `Pause ${code}` }).click();
    await expect(page.getByRole('row').filter({ hasText: code })).toContainText('Paused');
    const other = await buyWithCode(browser, pass, `other+${id.toLowerCase()}@example.test`, code);
    await expect(other.getByRole('region', { name: 'Choose your pass' }).getByRole('alert')).toContainText(
      "That promo code isn't valid for these tickets.",
    );
    await page.getByRole('button', { name: `Resume ${code}` }).click();
    await expect(page.getByRole('row').filter({ hasText: code })).toContainText('Active');

    // The event has an order now: its currency is locked.
    await page.goto(`${OPEN_HOUSE}/details`);
    await expect(
      page.getByText("Locked: this event already has orders, so its currency can't change."),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save currency' })).toHaveCount(0);
  });

  test('event promo codes sit on the same list; errors explain themselves', async ({ page }) => {
    const id = tag();
    const eventCode = `EVT${id}`;
    await signIn(page);
    await page.goto(`${OPEN_HOUSE}/tickets-orders`);
    await page.getByLabel('Code', { exact: true }).fill(eventCode);
    await page.getByLabel('Discount', { exact: true }).fill('10');
    await page.getByRole('button', { name: 'Add code' }).click();
    await expect(page.getByRole('row').filter({ hasText: eventCode })).toBeVisible();

    await page.goto(`${ORG}/coupons`);
    const row = page.getByRole('row').filter({ hasText: eventCode });
    await expect(row).toContainText('Event code');
    await expect(row).toContainText('Lakeside Open House');
    await expect(row).toContainText('10% off');

    // The event's code is taken org-wide.
    await page.getByLabel('Code', { exact: true }).fill(eventCode.toLowerCase());
    await page.getByLabel('Percentage', { exact: true }).fill('5');
    await page.getByRole('button', { name: 'Add coupon' }).click();
    await expect(
      page.getByText("That code is already used by a coupon or an event's promo code."),
    ).toBeVisible();

    // Chosen events without any event.
    await page.getByLabel('Code', { exact: true }).fill(`NONE${id}`);
    await page.getByLabel('Percentage', { exact: true }).fill('5');
    await pickOption(page.getByLabel('Applies to', { exact: true }), 'events');
    await page.getByRole('button', { name: 'Add coupon' }).click();
    await expect(page.getByText('Choose at least one event.')).toBeVisible();

    // A fixed amount needs its currency; the org default is chosen for you.
    await pickOption(page.getByLabel('Applies to', { exact: true }), 'all');
    await pickOption(page.getByLabel('Discount type'), 'amount');
    await expectPicked(page.getByLabel('Currency of the amount'), 'USD');
    await page.getByLabel('Amount off each ticket').fill('5');
    await page.getByLabel('Code', { exact: true }).fill(`FIVE${id}`);
    await page.getByLabel('Expires').fill('2020-01-01T10:00');
    await page.getByLabel('Starts').fill('2020-02-01T10:00');
    await page.getByRole('button', { name: 'Add coupon' }).click();
    await expect(page.getByText('The expiry must be after the start.')).toBeVisible();
    await expectAccessibleBothModes(page);
  });

  test('keyboard only: a coupon is added without the mouse', async ({ page }) => {
    const id = tag();
    const code = `KEY${id}`;
    await signIn(page);
    await page.goto(`${ORG}/coupons`);
    await page.getByLabel('Code', { exact: true }).focus();
    await page.keyboard.type(code);
    await pickWithKeyboard(page.getByLabel('Discount type'), { label: 'Fixed amount off' });
    await page.getByLabel('Amount off each ticket').focus();
    await page.keyboard.type('2.50');
    await pickWithKeyboard(page.getByLabel('Currency of the amount'), 'EUR');
    await page.getByLabel('Uses per buyer (optional)').focus();
    await page.keyboard.type('2');
    await page.getByRole('button', { name: 'Add coupon' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Coupon added.')).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: code });
    await expect(row).toContainText('€2.50 off each ticket');
    await expect(row).toContainText('All events');
    // Pause from the keyboard too.
    await page.getByRole('button', { name: `Pause ${code}` }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('row').filter({ hasText: code })).toContainText('Paused');
  });

  test('a viewer sees the list but cannot add or pause; Arabic renders right to left', async ({ page }) => {
    await signIn(page, VIEWER);
    await page.goto(`${ORG}/coupons`);
    await expect(page.getByRole('heading', { name: 'Coupons', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add a coupon' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Pause / })).toHaveCount(0);

    await signIn(page);
    await page.goto(`/ar${ORG}/coupons`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'القسائم', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'إضافة قسيمة' })).toBeVisible();
    await expectAccessibleBothModes(page);
  });
});

test.describe('event currency', () => {
  test('an event is created in another currency, prices in it, and changes until its first order', async ({
    page,
  }) => {
    const id = tag();
    const name = `Euro evening ${id}`;
    await signIn(page);
    await page.goto(`${ORG}/events/new`);
    await page.getByLabel('Event name').fill(name);
    await expectPicked(page.getByLabel('Currency'), 'USD');
    await pickOption(page.getByLabel('Currency'), 'EUR');
    await page.getByLabel('Starts').fill('2027-06-05T19:00');
    await page.getByLabel('Ends').fill('2027-06-05T23:00');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(new RegExp(`${ORG}/e/[a-z0-9-]+$`));
    const event = new URL(page.url()).pathname.replace(/^\/en/, '');

    await page.goto(`${event}/tickets-orders`);
    await expect(page.getByLabel('Price (EUR)')).toBeVisible();

    await page.goto(`${event}/details`);
    await expectPicked(page.getByLabel('Event currency'), 'EUR');
    await expectAccessibleBothModes(page);
    // No orders yet: it can still change (keyboard only).
    await pickWithKeyboard(page.getByLabel('Event currency'), 'GBP');
    await page.getByRole('button', { name: 'Save currency' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Currency saved.')).toBeVisible();
    await page.reload();
    await expectPicked(page.getByLabel('Event currency'), 'GBP');
    await page.goto(`${event}/tickets-orders`);
    await expect(page.getByLabel('Price (GBP)')).toBeVisible();

    // Arabic, right to left.
    await page.goto(`/ar${event}/details`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'العملة' })).toBeVisible();
    await expectAccessibleBothModes(page);
  });

  test('the guided wizard takes a currency for the first pass', async ({ page }) => {
    const id = tag();
    await signIn(page);
    await page.goto(`${ORG}/events/new/guided`);
    await page.getByLabel('Event name').fill(`Wizard yen ${id}`);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Starts').fill('2027-07-01T18:00');
    await page.getByLabel('Ends').fill('2027-07-01T21:00');
    await page.getByRole('button', { name: 'Next' }).click();
    await expectPicked(page.getByLabel('Currency', { exact: true }), 'USD');
    await pickOption(page.getByLabel('Currency', { exact: true }), 'JPY');
    await expect(page.getByLabel('Price (JPY)')).toBeVisible();
    await expectAccessibleBothModes(page);
  });

  test("the org's default currency is a CurrencyPicker; a viewer cannot change an event's currency", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(`${ORG}/settings`);
    const picker = page.getByLabel('Default currency');
    await expectPicked(picker, 'USD');
    await pickOption(picker, { label: /^EUR/ });
    await expectPicked(picker, 'EUR');
    await expectAccessibleBothModes(page);

    await signIn(page, VIEWER);
    await page.goto(`${OPEN_HOUSE}/details`);
    await expect(page.getByRole('button', { name: 'Save currency' })).toHaveCount(0);
  });
});
