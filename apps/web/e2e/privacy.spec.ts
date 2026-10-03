import { readFileSync } from 'node:fs';
import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  continueToPayment,
  expectAccessible,
  lastEmailedCode,
  OPEN_HOUSE,
  pickOption,
  signIn,
  WEDDING_OWNER,
} from './helpers.ts';

/**
 * M1.14c / M6.1c privacy: data-subject requests in the organizer console (find, open a request,
 * fulfil it with a signed archive or an erasure with its signed receipt, withdraw), the person's
 * own request (email code), and the public privacy notice. Each test uses its own email.
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
  await pickOption(guest.getByLabel(`Quantity — ${pass}`), '1');
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

/** Find the person and open a request of this kind; lands on the request page. */
async function openRequest(page: Page, email: string, kind: 'access' | 'erasure') {
  await page.goto(PRIVACY);
  await findPerson(page, email);
  await page
    .getByRole('radio', {
      name: kind === 'access' ? 'A copy of their data (access)' : 'Erase their data (erasure)',
    })
    .check();
  await page.getByRole('button', { name: 'Open the request' }).click();
  await expect(page).toHaveURL(/\/privacy\/requests\/[0-9a-f-]{36}\?opened=1$/);
  await expect(page.getByText(/^Request opened\. It is due by /)).toBeVisible();
  return page.url().replace(/\?.*$/, '');
}

interface Mail {
  subject: string;
  text: string;
}
const mailbox = async (page: Page, to: string): Promise<Mail[]> =>
  (await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(to)}`)).json();

/** A ZIP's entry names (stored uncompressed in the central directory). */
const zipNames = (bytes: Buffer) => {
  const names: string[] = [];
  for (let p = bytes.indexOf('PK\u0001\u0002'); p >= 0; p = bytes.indexOf('PK\u0001\u0002', p + 4)) {
    const len = bytes.readUInt16LE(p + 28);
    names.push(bytes.subarray(p + 46, p + 46 + len).toString('utf8'));
  }
  return names;
};

test.describe('privacy requests (DSAR) in the console', () => {
  test('find: validation, nothing found, and the page passes axe', async ({ page }) => {
    await signIn(page);
    await page.goto('/o/lakeside-events/settings');
    await page.getByRole('link', { name: 'Privacy requests' }).first().click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy requests' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Open requests' })).toBeVisible();
    await expectAccessible(page);
    await findPerson(page, 'not-an-email');
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    await expect(page.getByLabel('Email address')).toHaveAttribute('aria-invalid', 'true');
    await findPerson(page, `nobody-${stampOf()}@example.test`);
    await expect(page.getByText('Nothing found for this email')).toBeVisible();
    // A request can still be opened (the person gets a formal answer); the kind is required.
    await page.getByRole('button', { name: 'Open the request' }).click();
    await expect(page.getByText('Choose what the person asks for.')).toBeVisible();
    // The email never goes into the URL.
    expect(page.url()).not.toContain('example.test');
    await expectAccessible(page);
  });

  test('access: open a request, create the signed archive, download it; it shows as done', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
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
    await expect(summary.getByText('Orders and waitlists')).toBeVisible();
    await expect(summary.getByText('Tickets', { exact: true })).toBeVisible();
    await expectAccessible(page);

    const url = await openRequest(page, email, 'access');
    await expect(page.getByRole('heading', { level: 1, name: 'Access request' })).toBeVisible();
    await expect(page.getByTestId('dsar-request')).toContainText('Staff, for the person');
    await expect(page.getByRole('heading', { name: 'What this organization holds' })).toBeVisible();
    await expectAccessible(page);
    // It is in the queue.
    await page.goto(PRIVACY);
    const queue = page.getByRole('table', { name: 'Open privacy requests, the soonest due first' });
    await expect(queue.getByRole('row').filter({ hasText: 'a•••@example.test' }).first()).toBeVisible();
    await page.goto(url);

    await page.getByRole('button', { name: 'Create the archive' }).click();
    await expect(page.getByText('The archive is ready.')).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Download the archive (ZIP)' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^personal-data-\d{4}-\d{2}-\d{2}\.zip$/);
    const bytes = readFileSync((await download.path()) as string);
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    expect(zipNames(bytes)).toEqual(
      expect.arrayContaining([
        'README.txt',
        'manifest.json',
        'manifest.sig',
        'signing-key.pem',
        'data/orders.json',
      ]),
    );
    await expectAccessible(page);

    // Persisted: done, with the archive still downloadable; listed as closed.
    await page.reload();
    await expect(page.getByText('Done', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/^Available until /)).toBeVisible();
    await page.goto(PRIVACY);
    const closed = page.getByRole('table', { name: 'Fulfilled and withdrawn requests, newest first' });
    await expect(closed.getByRole('row').filter({ hasText: 'a•••@example.test' }).first()).toContainText(
      'Done',
    );
    await expect(page.getByRole('main')).not.toContainText(email);
  });

  test('erasure: confirmation, the signed receipt with legal holds, the PDF, nothing left to find', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    await signIn(page);
    const stamp = stampOf();
    const email = `eve+${stamp}@example.test`;
    await buyFreeTicket(page, browser, email, stamp);
    const url = await openRequest(page, email, 'erasure');
    await expect(page.getByRole('heading', { level: 1, name: 'Erasure request' })).toBeVisible();

    // One open request per person: finding them again points at it.
    await page.goto(PRIVACY);
    await findPerson(page, email);
    await expect(page.getByText('A request is already open for this person.')).toBeVisible();
    await page.getByRole('link', { name: 'Review the open request' }).click();
    await expect(page).toHaveURL(url);

    const confirm = page.getByLabel(`Type ${email} to confirm`);
    await confirm.fill('someone-else@example.test');
    await page.getByRole('button', { name: 'Erase personal data' }).click();
    await expect(page.getByText('That doesn’t match. Type the same email address to confirm.')).toBeVisible();
    await expectAccessible(page);
    await confirm.fill(email);
    await page.getByRole('button', { name: 'Erase personal data' }).click();
    await expect(page.getByText('Erased. The signed receipt below lists what was erased')).toBeVisible();

    const erased = page.getByRole('table', { name: 'Erased', exact: true });
    await expect(erased.getByRole('row').filter({ hasText: 'crm.contacts' })).toBeVisible();
    const held = page.getByRole('table', { name: 'Kept under a legal hold' });
    await expect(held.getByRole('row').filter({ hasText: 'orders.orders' })).toContainText(
      'Tax and accounting records (7 years)',
    );
    await expect(page.getByText(/^Signed with Ed25519 key [0-9a-f]{16}\.$/)).toBeVisible();
    await expectAccessible(page);
    const pdf = await page.request.get(
      (await page.getByRole('link', { name: 'Download the receipt (PDF)' }).getAttribute('href')) as string,
    );
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toMatch(/application\/pdf|text\/html/);

    // Persisted, and nothing left to find; the organizer's orders no longer show the name.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Erasure receipt' })).toBeVisible();
    await page.goto(PRIVACY);
    await findPerson(page, email);
    await expect(page.getByText('Nothing found for this email')).toBeVisible();
    await page.goto(`${OPEN_HOUSE}/tickets-orders`);
    await expect(page.getByText(`Ada Private ${stamp}`)).toHaveCount(0);
    await page.goto('/o/lakeside-events/activity?action=privacy.erase');
    await expect(page.getByRole('main')).not.toContainText(email);
  });

  test('withdraw: a reason is required; the request closes as withdrawn', async ({ page }) => {
    await signIn(page);
    const email = `withdraw+${stampOf()}@example.test`;
    await openRequest(page, email, 'erasure');
    await page.getByRole('button', { name: 'Withdraw request' }).click();
    await expect(page.getByText('Give a reason of at least 3 characters.')).toBeVisible();
    await page.getByLabel('Reason').fill('The person withdrew it by phone');
    await page.getByRole('button', { name: 'Withdraw request' }).click();
    await expect(page.getByText('Request withdrawn.')).toBeVisible();
    await expect(page.getByText('The person withdrew it by phone')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Erase personal data' })).toHaveCount(0);
    await expectAccessible(page);
  });

  test('keyboard only: find, open and fulfil an access request', async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page);
    const email = `kb+${stampOf()}@example.test`;
    await page.goto(PRIVACY);
    await page.getByLabel('Email address').focus();
    await page.keyboard.type(email);
    await page.keyboard.press('Enter');
    await expect(page.getByText('Nothing found for this email')).toBeVisible();
    await page.getByRole('radio', { name: 'A copy of their data (access)' }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('radio', { name: 'A copy of their data (access)' })).toBeChecked();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Open the request' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/privacy\/requests\/[0-9a-f-]{36}\?opened=1$/);
    await page.getByRole('button', { name: 'Create the archive' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('link', { name: 'Download the archive (ZIP)' })).toBeVisible();
  });

  test('viewers get no nav item, a refusal on the list and on a request, and no archive', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const owner = await (await browser.newContext()).newPage();
    await signIn(owner);
    const url = await openRequest(owner, `viewer-check+${stampOf()}@example.test`, 'access');
    await owner.getByRole('button', { name: 'Create the archive' }).click();
    const href = (await owner
      .getByRole('link', { name: 'Download the archive (ZIP)' })
      .getAttribute('href')) as string;
    expect((await owner.request.get(href)).status()).toBe(200);
    const path = new URL(url).pathname;

    await signIn(page, VIEWER);
    await page.goto('/o/lakeside-events');
    await expect(page.locator('nav a[href$="/lakeside-events/privacy"]')).toHaveCount(0);
    await page.goto(PRIVACY);
    await expect(page.getByText('Only owners and admins can handle privacy requests')).toBeVisible();
    await expect(page.getByLabel('Email address')).toHaveCount(0);
    await expectAccessible(page);
    await page.goto(path);
    await expect(page.getByText('Only owners and admins can handle privacy requests')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create the archive' })).toHaveCount(0);
    expect((await page.request.get(href)).status()).toBe(404);
    expect((await page.request.get(`${path}/receipt`)).status()).toBe(404);
  });

  test('renders right-to-left in Arabic', async ({ page }) => {
    await signIn(page);
    // A request to look at in Arabic (opened in English first: the locale sticks once chosen).
    const url = await openRequest(page, `rtl+${stampOf()}@example.test`, 'erasure');
    await page.goto(`/ar${PRIVACY}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'طلبات الخصوصية' })).toBeVisible();
    await page.getByLabel('عنوان البريد الإلكتروني').fill('x');
    await page.getByRole('button', { name: 'بحث', exact: true }).click();
    await expect(page.getByText('أدخل عنوان بريد إلكتروني صالحًا.')).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar${new URL(url).pathname}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'طلب محو' })).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe('the person’s own request (public)', () => {
  const PUBLIC = '/privacy-request/lakeside-events';

  test('validation, a wrong code, then the request; staff fulfil it and the person downloads the archive', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const email = `self+${stampOf()}@example.test`;
    await page.goto(PUBLIC);
    await expect(page.getByRole('heading', { level: 1, name: 'Ask about your personal data' })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await expect(page.getByText('Choose a copy of your data or erasure.')).toBeVisible();
    await page.getByRole('radio', { name: 'A copy of my data' }).check();
    await page.getByLabel('Your email address').fill('not-an-email');
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    await page.getByRole('radio', { name: 'A copy of my data' }).check();
    await page.getByLabel('Your email address').fill(email);
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await expect(page.getByText(`We emailed a 6-digit code to ${email}.`)).toBeVisible();
    await expect(page.getByLabel('Confirmation code')).toBeFocused();
    const code = await lastEmailedCode(page, email);
    await page.getByLabel('Confirmation code').fill(code === '000000' ? '111111' : '000000');
    await page.getByRole('button', { name: 'Confirm my request' }).click();
    await expect(page.getByText(/That code isn’t right\./)).toBeVisible();
    await expectAccessible(page);
    await page.getByLabel('Confirmation code').fill(code);
    await page.getByRole('button', { name: 'Confirm my request' }).click();
    await expect(page.getByText('Request received')).toBeVisible();
    const done = page.getByText(/will answer by .+\. Your reference is [0-9A-F]{8}\./);
    await expect(done).toBeVisible();
    const reference = /reference is ([0-9A-F]{8})/.exec((await done.textContent()) ?? '')?.[1] ?? '';
    await expectAccessible(page);

    // Staff see it, from the person, and fulfil it; the person gets a link to the archive.
    const owner = await (await browser.newContext()).newPage();
    await signIn(owner);
    await owner.goto(PRIVACY);
    const row = owner
      .getByRole('table', { name: 'Open privacy requests, the soonest due first' })
      .getByRole('row')
      .filter({ has: owner.locator(`a[href$="${reference.toLowerCase()}"]`) });
    await expect(row).toContainText('s•••@example.test');
    await expect(row).toContainText('The person (email confirmed)');
    await row.getByRole('link', { name: /Review/ }).click();
    await expect(owner.getByTestId('dsar-request')).toContainText('Email confirmed');
    await owner.getByRole('button', { name: 'Create the archive' }).click();
    await expect(owner.getByText('We emailed the person a download link.')).toBeVisible();
    let link = '';
    await expect
      .poll(async () => {
        const m = (await mailbox(page, email)).find((x) => x.subject.includes('is ready'));
        link = /https?:\/\/\S+\/archive\/\S+/.exec(m?.text ?? '')?.[0] ?? '';
        return link;
      })
      .not.toBe('');
    const res = await page.request.get(new URL(link).pathname);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('application/zip');
    expect(zipNames(Buffer.from(await res.body()))).toContain('manifest.json');
    // A tampered link gets nothing.
    expect((await page.request.get(`${new URL(link).pathname}x`)).status()).toBe(404);
  });

  test('keyboard only, phone-first, and Arabic right-to-left', async ({ page }) => {
    const email = `selfkb+${stampOf()}@example.test`;
    await page.goto(PUBLIC);
    await page.getByRole('radio', { name: 'Erase my data' }).focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Your email address')).toBeFocused();
    await page.keyboard.type(email);
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Confirmation code')).toBeFocused();
    await page.keyboard.type(await lastEmailedCode(page, email));
    await page.keyboard.press('Enter');
    await expect(page.getByText('Request received')).toBeVisible();

    await page.goto(`/ar${PUBLIC}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'اسأل عن بياناتك الشخصية' })).toBeVisible();
    await page.getByRole('button', { name: 'أرسل لي رمزًا' }).click();
    await expect(page.getByText('اختر نسخة من بياناتك أو المحو.')).toBeVisible();
    await expectAccessible(page);
  });

  test('the org’s privacy notice links to it; an unknown org is not found', async ({ page }) => {
    // The wedding org, not the shared lakeside org: settings.spec expects lakeside's setup
    // checklist to still ask for a privacy notice (batch 3i merge).
    await signIn(page, WEDDING_OWNER);
    await page.goto('/o/rosewood-weddings/settings#legal-privacy');
    const legal = page.getByRole('region', { name: 'Your legal pages' });
    await legal.getByLabel('Privacy notice').fill('We use guest details only to run our events.');
    await legal.getByRole('button', { name: 'Save' }).nth(1).click();
    await expect(legal.getByText('Saved.')).toBeVisible();
    await page.goto('/legal/rosewood-weddings/privacy');
    await page.getByRole('link', { name: 'Ask for a copy of your data, or for it to be erased' }).click();
    await expect(page).toHaveURL(/\/privacy-request\/rosewood-weddings$/);
    expect((await page.request.get('/privacy-request/no-such-org-here')).status()).toBe(404);
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
