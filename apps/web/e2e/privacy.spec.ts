import { readFileSync } from 'node:fs';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { continueToPayment, expectAccessible, OPEN_HOUSE, signIn } from './helpers.ts';

/**
 * M1.14c privacy: data-subject requests (find, export, erase) in the organizer console, and the
 * public privacy notice and sub-processor pages. Each test uses its own buyer email.
 */
const VIEWER = 'jordan@lakeside.test';
const PRIVACY = '/o/lakeside-events/privacy';

const stampOf = () => `${test.info().project.name}-${Date.now()}`;

/** A guest buys one free ticket for the open house with this email. */
async function buyFreeTicket(page: Page, browser: Browser, email: string, stamp: string) {
  await page.goto(`${OPEN_HOUSE}/tickets-orders`);
  const pass = `Privacy pass ${stamp}`;
  await page.getByLabel('Name', { exact: true }).fill(pass);
  await page.getByLabel('Price (USD)').fill('0');
  await page.getByLabel('Quantity available').fill('5');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: pass })).toBeVisible();
  const guest = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await guest.goto('/events/lakeside-open-house');
  await guest.getByLabel(`Quantity — ${pass}`).selectOption('1');
  await guest.getByLabel('Full name').fill(`Ada Private ${stamp}`);
  await guest.getByLabel('Email for your tickets').fill(email);
  await continueToPayment(guest, email);
  await expect(guest).toHaveURL(/\/orders\/[A-Za-z0-9_-]{43}$/);
  await guest.close();
}

async function findPerson(page: Page, email: string) {
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Find', exact: true }).click();
}

test.describe('privacy requests (DSAR)', () => {
  test('find: validation, nothing found, and the page passes axe', async ({ page }) => {
    await signIn(page);
    await page.goto('/o/lakeside-events/settings');
    await page.getByRole('link', { name: 'Privacy requests' }).first().click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy requests' })).toBeVisible();
    await expectAccessible(page);
    await findPerson(page, 'not-an-email');
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    await expect(page.getByLabel('Email address')).toHaveAttribute('aria-invalid', 'true');
    await findPerson(page, `nobody-${stampOf()}@example.test`);
    await expect(page.getByText('Nothing found for this email')).toBeVisible();
    // The email never goes into the URL.
    expect(page.url()).not.toContain('example.test');
    await expectAccessible(page);
  });

  test('find, export as JSON, then erase with confirmation; the record keeps no address', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    await signIn(page);
    const stamp = stampOf();
    const email = `ada+${stamp}@example.test`;
    await buyFreeTicket(page, browser, email, stamp);

    await page.goto(PRIVACY);
    await findPerson(page, email.toUpperCase());
    await expect(
      page.getByRole('heading', { name: `What this organization holds about ${email}` }),
    ).toBeVisible();
    const summary = page.getByTestId('dsar-summary');
    const count = (label: string) => summary.locator('div').filter({ hasText: label }).locator('dd');
    await expect(count('Orders').first()).toHaveText('1');
    await expect(count('Paid orders (kept for accounting)')).toHaveText('1');
    await expect(count('Valid tickets')).toHaveText('1');
    await expect(count('Guest list entries')).toHaveText('1');
    await expectAccessible(page);

    // Export: a JSON file with their data.
    await page.getByRole('button', { name: 'Export data (JSON)' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Download the file' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^personal-data-\d{4}-\d{2}-\d{2}\.json$/);
    const doc = JSON.parse(readFileSync((await download.path()) as string, 'utf8'));
    expect(doc.format).toBe('yayatoh.dsar/1');
    expect(doc.subject.email).toBe(email);
    expect(doc.orders[0].buyerName).toBe(`Ada Private ${stamp}`);
    expect(Object.values(doc.events)).toContain('Lakeside Open House');
    expect(JSON.stringify(doc)).not.toMatch(/manageToken|providerPaymentId|privateKey/);

    // Erase: the confirmation must match.
    await page.getByLabel(`Type ${email} to confirm`).fill('someone-else@example.test');
    await page.getByRole('button', { name: 'Erase personal data' }).click();
    await expect(page.getByText('That doesn’t match. Type the same email address to confirm.')).toBeVisible();
    await page.getByLabel(`Type ${email} to confirm`).fill(email);
    await page.getByRole('button', { name: 'Erase personal data' }).click();
    await expect(page.getByTestId('dsar-erased')).toContainText(
      /Erased\. \d+ records were redacted or deleted; 1 paid order was kept without personal data\./,
    );
    await expectAccessible(page);

    // Nothing left to find; the history keeps a masked record.
    await page.reload();
    await findPerson(page, email);
    await expect(page.getByText('Nothing found for this email')).toBeVisible();
    const history = page.getByRole('table', { name: 'Privacy requests, newest first' });
    await expect(history.getByRole('row').filter({ hasText: 'Erasure' }).first()).toContainText(
      'a•••@example.test',
    );
    await expect(history).not.toContainText(email);
    // The organizer's order list shows the order without the name.
    await page.goto(`${OPEN_HOUSE}/tickets-orders`);
    await expect(page.getByText(`Ada Private ${stamp}`)).toHaveCount(0);
    // The erasure is in the Activity log without the address.
    await page.goto('/o/lakeside-events/activity?action=privacy.erase');
    await expect(
      page.getByRole('table', { name: 'Activity log, newest first' }).getByRole('row').nth(1),
    ).toContainText('privacy.erase');
    await expect(page.getByRole('main')).not.toContainText(email);
  });

  test('keyboard only: find and export', async ({ page, browser }) => {
    test.setTimeout(90_000);
    await signIn(page);
    const stamp = stampOf();
    const email = `kb+${stamp}@example.test`;
    await buyFreeTicket(page, browser, email, stamp);
    await page.goto(PRIVACY);
    await page.getByLabel('Email address').focus();
    await page.keyboard.type(email);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('dsar-summary')).toBeVisible();
    await page.getByRole('button', { name: 'Export data (JSON)' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('link', { name: 'Download the file' })).toBeVisible();
  });

  test('viewers get no nav item, a refusal on the URL, and no access to an owner’s export', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const owner = await (await browser.newContext()).newPage();
    await signIn(owner);
    const stamp = stampOf();
    const email = `viewer-check+${stamp}@example.test`;
    await buyFreeTicket(owner, browser, email, stamp);
    await owner.goto(PRIVACY);
    await findPerson(owner, email);
    await owner.getByRole('button', { name: 'Export data (JSON)' }).click();
    const href = (await owner
      .getByRole('link', { name: 'Download the file' })
      .getAttribute('href')) as string;
    expect((await owner.request.get(href)).status()).toBe(200);

    await signIn(page, VIEWER);
    await page.goto('/o/lakeside-events');
    await expect(page.locator('nav a[href$="/lakeside-events/privacy"]')).toHaveCount(0);
    await page.goto(PRIVACY);
    await expect(page.getByText('Only owners and admins can handle privacy requests')).toBeVisible();
    await expect(page.getByLabel('Email address')).toHaveCount(0);
    await expectAccessible(page);
    expect((await page.request.get(href)).status()).toBe(404);
  });

  test('renders right-to-left in Arabic', async ({ page }) => {
    await signIn(page);
    await page.goto(`/ar${PRIVACY}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'طلبات الخصوصية' })).toBeVisible();
    await page.getByLabel('عنوان البريد الإلكتروني').fill('x');
    await page.getByRole('button', { name: 'بحث', exact: true }).click();
    await expect(page.getByText('أدخل عنوان بريد إلكتروني صالحًا.')).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe('privacy notice and sub-processors (public)', () => {
  test('the notice and the list render, link to each other, and pass axe', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Privacy notice' }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy notice' })).toBeVisible();
    await expect(page.getByRole('note')).toContainText('DRAFT for legal review');
    for (const h of ['Who is responsible', 'What we collect', 'How long we keep it', 'Your rights'])
      await expect(page.getByRole('heading', { level: 2, name: h })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('link', { name: 'See the list of sub-processors' }).click();
    await expect(page).toHaveURL(/\/sub-processors$/);
    const table = page.getByRole('table', { name: 'Sub-processors' });
    await expect(table.getByRole('row').filter({ hasText: 'Stripe Inc.' })).toContainText(
      'Payments and payouts',
    );
    await expect(table.getByRole('row')).toHaveCount(12);
    await expectAccessible(page);
  });

  test('both pages render right-to-left in Arabic', async ({ page }) => {
    await page.goto('/ar/privacy');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'إشعار الخصوصية' })).toBeVisible();
    await expectAccessible(page);
    await page.goto('/ar/sub-processors');
    await expect(page.getByRole('heading', { level: 1, name: 'المعالجون الفرعيون' })).toBeVisible();
    await expectAccessible(page);
  });
});
