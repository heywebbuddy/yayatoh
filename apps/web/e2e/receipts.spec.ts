import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { expectAccessible, expectAccessibleBothModes, expectHtmlAccessible, newUser } from './helpers.ts';

// Batch 3h merge: axe runs in light and dark on every screen now (twice the checks), so these long
// journeys get more than the default 30 s.
test.describe.configure({ timeout: 120_000 });

/**
 * M4.8b charity profile and receipts (P4-11, P4-13): the owner's charity profile with every
 * validation message, fair-market values on ticket types, the quid-pro-quo notice on the ticket page
 * of a verified charity, receipts by email (dev mailbox) and PDF for gifts and charity tickets
 * ($350 deductible on a $500 ticket with a $150 value; "No goods or services were provided" for a
 * gift; "not tax-deductible" for an unverified org), viewers, the keyboard and Arabic RTL. Staff
 * verification has its own admin e2e; here `/api/dev/charity` verifies against the recorded IRS
 * fixture. Each test runs in an org of its own (projects run in parallel on one database).
 */

const stamp = () => `${Date.now().toString(36)}${test.info().project.name.split('-')[0]}`;

interface Gala {
  readonly org: string;
  readonly slug: string;
  readonly base: string;
}

interface Captured {
  readonly id: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** A new owner with a published gala event and an active payout account (direct charges). */
async function gala(page: Page, connected = true): Promise<Gala> {
  const user = await newUser(page, {
    org: true,
    twoFactor: true,
    event: 'published',
    profile: 'gala',
    ...(connected ? { payouts: 'active' as const } : {}),
  });
  const org = user.orgSlug ?? '';
  const slug = user.eventSlug ?? '';
  return { org, slug, base: `/o/${org}/e/${slug}` };
}

async function saveProfile(page: Page, org: string, legalName = 'Harbor Arts Alliance', ein = '23-4567891') {
  await page.goto(`/o/${org}/charity`);
  await page.getByLabel('Legal name', { exact: true }).fill(legalName);
  await page.getByLabel('EIN', { exact: true }).fill(ein);
  await page.getByRole('button', { name: /Send for verification|Save and send for review/ }).click();
  await expect(page.getByText('Saved. Yayatoh will review it.')).toBeVisible();
}

/** Staff verify the profile against the recorded IRS fixture (dev route; the admin e2e covers the screens). */
async function verify(page: Page, org: string) {
  const res = await page.request.post('/api/dev/charity', { form: { org } });
  expect(res.status()).toBe(200);
}

async function addTicketType(page: Page, g: Gala, name: string, price: string) {
  await page.goto(`${g.base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Price (USD)').fill(price);
  await page.getByLabel('Quantity available').fill('20');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
}

async function setValue(page: Page, g: Gala, ticket: string, value: string, goods = '') {
  await page.goto(`${g.base}/donations/receipts`);
  await page.getByText(`Set the fair-market value of ${ticket}`).click();
  const card = page.getByRole('listitem').filter({ hasText: `Set the fair-market value of ${ticket}` });
  await card.getByLabel('Fair-market value (USD)').fill(value);
  if (goods) await card.getByLabel('What buyers receive (optional)').fill(goods);
  await card.getByRole('button', { name: 'Save value' }).click();
  await expect(card.getByText('Saved.')).toBeVisible();
}

async function addCampaign(page: Page, g: Gala, name: string) {
  await page.goto(`${g.base}/donations`);
  const form = page.getByRole('region', { name: 'Add campaign' });
  await form.getByLabel('Campaign name').fill(name);
  await form.getByLabel('Goal (USD)').fill('25000');
  await form.getByRole('button', { name: 'Add campaign' }).click();
  await expect(form.getByText('Campaign added.')).toBeVisible();
}

/** A donor gives an own amount on the giving page and pays on the fake provider's page. */
async function give(context: BrowserContext, g: Gala, amount: string, email: string) {
  const guest = await context.newPage();
  await guest.goto(`/events/${g.slug}/give`);
  await guest.getByLabel('Amount (USD)').fill(amount);
  await guest.getByRole('textbox', { name: 'Full name' }).fill('Grace Hopper');
  await guest.getByLabel('Email').fill(email);
  await guest.getByRole('radio', { name: 'Show my full name' }).check();
  await guest.getByRole('button', { name: /^Give/ }).click();
  await expect(guest).toHaveURL(/\/checkout\/fake\?/);
  await guest.getByRole('button', { name: /^Pay/ }).click();
  await expect(guest.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
  return guest;
}

/** Deliver the org's pending messages (the worker's job in production) and read the donor's mail. */
async function receiptMail(page: Page, org: string, to: string): Promise<Captured> {
  let mail: Captured | undefined;
  await expect
    .poll(async () => {
      const drained = await page.request.post('/api/dev/outbox/drain', { form: { org } });
      expect(drained.ok()).toBe(true);
      const list = (await (
        await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(to)}`)
      ).json()) as Captured[];
      mail = list.find((m) => /receipt from/.test(m.subject));
      return Boolean(mail);
    })
    .toBe(true);
  return mail as Captured;
}

const linkIn = (html: string, kind: 'receipts' | 'statements') => {
  const m = new RegExp(`href="https?://[^"/]+((?:/[a-z]{2}(?:-[A-Z]{2})?)?/${kind}/[^"]+)"`).exec(html);
  return m?.[1]?.replace(/&amp;/g, '&') ?? '';
};

test.describe('charity profile and receipts (M4.8b)', () => {
  test('the owner creates the charity profile, with every validation message; it waits for review', async ({
    page,
  }) => {
    const g = await gala(page);
    await page.goto(`/o/${g.org}/settings`);
    await page.getByRole('link', { name: 'Charity profile' }).click();
    await expect(page.getByRole('heading', { name: 'Charity profile', level: 1 })).toBeVisible();
    await expect(page.getByText('No charity profile yet')).toBeVisible();
    await expectAccessibleBothModes(page);

    const submit = page.getByRole('button', { name: 'Send for verification' });
    await submit.click();
    await expect(page.getByText('Enter the legal name (up to 200 characters).')).toBeVisible();
    await expect(page.getByLabel('Legal name', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await page.getByLabel('Legal name', { exact: true }).fill('Harbor Arts Alliance');
    await page.getByLabel('EIN', { exact: true }).fill('12345');
    await submit.click();
    await expect(page.getByText('Enter a valid 9-digit EIN, for example 12-3456789.')).toBeVisible();
    await page.getByLabel('EIN', { exact: true }).fill('234567891');
    await page.getByLabel('Tax-exempt status').selectOption('fiscal_sponsor');
    await submit.click();
    await expect(page.getByText('Enter the fiscal sponsor’s legal name.')).toBeVisible();
    await page.getByLabel('Fiscal sponsor’s legal name').fill('Good Cause Fiscal Sponsor Inc');
    await page.getByLabel('Fiscal sponsor’s EIN').fill('34-56');
    await submit.click();
    await expect(page.getByText('Enter the fiscal sponsor’s 9-digit EIN.')).toBeVisible();
    await page.getByLabel('Tax-exempt status').selectOption('501c3');
    await page.getByLabel('Fiscal sponsor’s legal name').fill('');
    await page.getByLabel('Fiscal sponsor’s EIN').fill('');
    await page.getByLabel('Mailing address (optional)').fill('1 Pier Way, Boston, MA 02110');
    await submit.click();
    await expect(page.getByText('Saved. Yayatoh will review it.')).toBeVisible();
    await expectAccessibleBothModes(page);

    // Persisted, normalized, waiting for staff.
    await page.reload();
    await expect(page.getByText('Waiting for Yayatoh to verify')).toBeVisible();
    await expect(page.getByLabel('EIN', { exact: true })).toHaveValue('23-4567891');
    await expect(page.getByLabel('Mailing address (optional)')).toHaveValue('1 Pier Way, Boston, MA 02110');
    await expect(page.getByRole('button', { name: 'Save and send for review' })).toBeVisible();

    // The event's receipts page says receipts are not deductible until it is verified.
    await page.goto(`${g.base}/donations`);
    await page.getByRole('link', { name: 'Open tax receipts' }).click();
    await expect(page.getByRole('heading', { name: 'Tax receipts', level: 1 })).toBeVisible();
    await expect(page.getByText('Waiting for verification')).toBeVisible();
    await expect(
      page.getByText(
        'Receipts say “This payment is not tax-deductible” until Yayatoh verifies your charity profile.',
      ),
    ).toBeVisible();
    await expect(page.getByText('No receipts yet.', { exact: false })).toBeVisible();
    await expectAccessibleBothModes(page);

    // Verified: the status says so.
    await verify(page, g.org);
    await page.goto(`/o/${g.org}/charity`);
    await expect(page.getByText('Verified 501(c)(3)')).toBeVisible();
  });

  test('set a fair-market value; the verified charity’s ticket page shows the quid-pro-quo notice', async ({
    page,
    browser,
  }) => {
    const g = await gala(page);
    await addTicketType(page, g, 'Gala dinner', '500');
    await page.goto(`${g.base}/donations/receipts`);
    await expect(page.getByText('No fair-market value: buyers get no receipt.').first()).toBeVisible();
    await page.getByText('Set the fair-market value of Gala dinner').click();
    const card = page.getByRole('listitem').filter({ hasText: 'Set the fair-market value of Gala dinner' });
    await card.getByLabel('Fair-market value (USD)').fill('lots');
    await card.getByRole('button', { name: 'Save value' }).click();
    await expect(card.getByText('Enter an amount, for example 150 or 150.50.')).toBeVisible();
    await expect(card.getByLabel('Fair-market value (USD)')).toHaveAttribute('aria-invalid', 'true');
    await card.getByLabel('Fair-market value (USD)').fill('150');
    await card.getByLabel('What buyers receive (optional)').fill('Dinner and entertainment');
    await card.getByRole('button', { name: 'Save value' }).click();
    await expect(card.getByText('Saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Fair-market value $150.00 · Dinner and entertainment')).toBeVisible();
    await expect(
      page.getByText(
        'Ticket page notice: Of your $500.00 payment, $350.00 is tax-deductible. The estimated fair-market value of the goods and services you receive is $150.00.',
      ),
    ).toBeVisible();
    await expectAccessibleBothModes(page);

    // Not verified yet: the public page shows no notice.
    const ctx = await browser.newContext();
    const guest = await ctx.newPage();
    await guest.goto(`/events/${g.slug}`);
    await expect(guest.getByLabel('Quantity — Gala dinner')).toBeVisible();
    await expect(guest.getByText(/is tax-deductible/)).toHaveCount(0);

    await saveProfile(page, g.org);
    await verify(page, g.org);
    await guest.goto(`/events/${g.slug}`);
    const notice = guest.getByRole('region', { name: 'Tax-deductible amount' });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(
      'Gala dinner: Of your $500.00 payment, $350.00 is tax-deductible. The estimated fair-market value of the goods and services you receive is $150.00.',
    );
    // $15 Supporter has no value; nothing about it.
    await expect(notice).not.toContainText('Supporter');
    await expectAccessible(guest);

    // Removing the value removes the notice.
    await page.goto(`${g.base}/donations/receipts`);
    await page.getByText('Set the fair-market value of Gala dinner').click();
    await page.getByRole('button', { name: 'Remove the value of Gala dinner' }).click();
    // The card shows the change at once: no value, no receipt.
    await expect(
      page
        .getByRole('listitem')
        .filter({ hasText: 'Gala dinner' })
        .getByText('No fair-market value: buyers get no receipt.'),
    ).toBeVisible();
    await guest.goto(`/events/${g.slug}`);
    await expect(guest.getByRole('region', { name: 'Tax-deductible amount' })).toHaveCount(0);
    await ctx.close();
  });

  test('a donor gives and receives the receipt in the dev mailbox, with the PDF; the host sees it', async ({
    page,
    browser,
  }) => {
    const g = await gala(page);
    await saveProfile(page, g.org);
    await verify(page, g.org);
    await addCampaign(page, g, `Receipts Fund ${stamp()}`);
    const email = `grace+${stamp()}@example.test`;
    const ctx = await browser.newContext();
    await give(ctx, g, '100', email);

    const mail = await receiptMail(page, g.org, email);
    expect(mail.subject).toMatch(/^Your donation receipt from Test Org /);
    expect(mail.text).toContain('Amount paid: $100.00');
    expect(mail.text).toContain('Tax-deductible amount: $100.00');
    expect(mail.text).toContain('No goods or services were provided in exchange for this contribution.');
    expect(mail.text).toContain(
      'Harbor Arts Alliance is exempt from federal income tax under Section 501(c)(3)',
    );
    await expectHtmlAccessible(page, mail.html);
    // The PDF link works for the donor (no session), in the receipt's own org only.
    const link = linkIn(mail.html, 'receipts');
    expect(link).toMatch(/^\/receipts\/[0-9a-f-]{36}\/[0-9a-f-]{36}~/);
    const guest = await ctx.newPage();
    const pdf = await guest.request.get(link);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toBe('application/pdf');
    expect(pdf.headers()['cache-control']).toContain('no-store');
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await guest.request.get(`${link.slice(0, -4)}xxxx`)).status()).toBe(404);
    // Only the donor got it.
    const all = (await (await page.request.get('/api/dev/mailbox')).json()) as (Captured & { to: string })[];
    expect(all.filter((m) => m.id === mail.id).map((m) => m.to)).toEqual([email]);

    // The host's receipts page lists it with the donor and its PDF.
    await page.goto(`${g.base}/donations/receipts`);
    const row = page.getByRole('row').filter({ hasText: 'R-00001' });
    await expect(row).toContainText('Grace Hopper');
    await expect(row).toContainText('Gift');
    await expect(row).toContainText('$100.00');
    const hostPdf = await row.getByRole('link', { name: 'Download R-00001' }).getAttribute('href');
    expect((await page.request.get(hostPdf ?? '')).status()).toBe(200);
    await expectAccessibleBothModes(page);
    await ctx.close();
  });

  test('a $500 ticket with a $150 fair-market value: the receipt says $350 is deductible', async ({
    page,
    browser,
  }) => {
    const g = await gala(page);
    await saveProfile(page, g.org);
    await verify(page, g.org);
    await addTicketType(page, g, 'Gala dinner', '500');
    await setValue(page, g, 'Gala dinner', '150', 'Dinner and entertainment');
    const email = `ada+${stamp()}@example.test`;
    const ctx = await browser.newContext();
    const guest = await ctx.newPage();
    await guest.goto(`/events/${g.slug}`);
    await guest.getByLabel('Quantity — Gala dinner').selectOption('1');
    await guest.getByLabel('Full name').fill('Ada Lovelace');
    await guest.getByLabel('Email for your tickets').fill(email);
    await guest.getByRole('button', { name: 'Continue to payment' }).click();
    const code = guest.getByLabel('Verification code', { exact: true });
    await expect(code).toBeVisible();
    let otp = '';
    await expect
      .poll(async () => {
        otp =
          (
            (await (
              await guest.request.get(`/api/dev/last-code?to=${encodeURIComponent(email)}`)
            ).json()) as {
              code: string | null;
            }
          ).code ?? '';
        return otp;
      })
      .toMatch(/^\d{6}$/);
    await code.fill(otp);
    await guest.getByRole('button', { name: 'Verify and continue' }).click();
    await guest.getByRole('button', { name: /^Pay/ }).click();
    await expect(guest).toHaveURL(/\/orders\//);

    const mail = await receiptMail(page, g.org, email);
    expect(mail.subject).toMatch(/^Your donation receipt from /);
    expect(mail.text).toContain('Amount paid: $500.00');
    expect(mail.text).toContain('Goods or services provided: 1 × Gala dinner (Dinner and entertainment)');
    expect(mail.text).toContain('Fair-market value of goods or services: $150.00');
    expect(mail.text).toContain('Tax-deductible amount: $350.00');
    expect(mail.text).toContain('is limited to $350.00');
    await page.goto(`${g.base}/donations/receipts`);
    const row = page.getByRole('row').filter({ hasText: 'Ada Lovelace' });
    await expect(row).toContainText('Tickets');
    await expect(row).toContainText('$350.00');
    await ctx.close();
  });

  test('an unverified org issues only “not tax-deductible” receipts', async ({ page, browser }) => {
    const g = await gala(page);
    await addCampaign(page, g, `Plain Fund ${stamp()}`);
    const email = `linus+${stamp()}@example.test`;
    const ctx = await browser.newContext();
    await give(ctx, g, '25', email);
    const mail = await receiptMail(page, g.org, email);
    expect(mail.subject).toMatch(/^Your payment receipt from /);
    expect(mail.text).toContain('This payment is not tax-deductible.');
    expect(mail.text).not.toContain('501(c)(3)');
    expect(mail.text).not.toContain('Tax-deductible amount');
    await page.goto(`${g.base}/donations/receipts`);
    await expect(page.getByRole('row').filter({ hasText: 'Grace Hopper' })).toContainText('Not deductible');
    await ctx.close();
  });

  test('a viewer reads the profile and receipts but changes nothing', async ({ page, browser }) => {
    const g = await gala(page);
    await saveProfile(page, g.org);
    await addTicketType(page, g, 'Gala dinner', '500');
    const ctx = await browser.newContext();
    const viewer = await ctx.newPage();
    await newUser(viewer, { join: [`${g.org}:viewer`] });
    await viewer.goto(`/o/${g.org}/charity`);
    await expect(viewer.getByText('Harbor Arts Alliance')).toBeVisible();
    await expect(viewer.getByText('Only owners and admins can change the charity profile.')).toBeVisible();
    await expect(viewer.getByRole('button', { name: /Send for verification|Save and send/ })).toHaveCount(0);
    await expectAccessibleBothModes(viewer);
    await viewer.goto(`${g.base}/donations/receipts`);
    await expect(viewer.getByRole('heading', { name: 'Tax receipts', level: 1 })).toBeVisible();
    await expect(viewer.getByText(/Set the fair-market value of/)).toHaveCount(0);
    await expect(
      viewer.getByText('You can view receipts. Ask an owner or admin to change fair-market values.'),
    ).toBeVisible();
    await expectAccessibleBothModes(viewer);
    // A receipt that does not exist (or another org's) is a 404.
    const res = await viewer.request.get(
      `${g.base}/donations/receipts/01900000-0000-7000-8000-000000000000/pdf`,
    );
    expect(res.status()).toBe(404);
    await ctx.close();
  });

  test('keyboard only: the owner saves the profile and a fair-market value without a pointer', async ({
    page,
  }) => {
    const g = await gala(page);
    await page.goto(`/o/${g.org}/charity`);
    await page.getByLabel('Legal name', { exact: true }).focus();
    await page.keyboard.type('Keyboard Charity');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('EIN', { exact: true })).toBeFocused();
    await page.keyboard.type('234567891');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Tax-exempt status')).toBeFocused();
    for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Send for verification' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Saved. Yayatoh will review it.')).toBeVisible();

    await addTicketType(page, g, 'Gala dinner', '500');
    await page.goto(`${g.base}/donations/receipts`);
    const summary = page.getByText('Set the fair-market value of Gala dinner');
    await summary.focus();
    await page.keyboard.press('Enter');
    const card = page.getByRole('listitem').filter({ hasText: 'Set the fair-market value of Gala dinner' });
    await page.keyboard.press('Tab');
    await expect(card.getByLabel('Fair-market value (USD)')).toBeFocused();
    await page.keyboard.type('150');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Dinner');
    await page.keyboard.press('Tab');
    await expect(card.getByRole('button', { name: 'Save value' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(card.getByText('Saved.')).toBeVisible();
  });

  test('Arabic: the profile, the receipts page and the ticket notice render right to left', async ({
    page,
    browser,
  }) => {
    const g = await gala(page);
    await saveProfile(page, g.org);
    await verify(page, g.org);
    await addTicketType(page, g, 'Gala dinner', '500');
    await setValue(page, g, 'Gala dinner', '150');
    await page.goto(`/ar/o/${g.org}/charity`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'الملف الخيري', level: 1 })).toBeVisible();
    await expect(page.getByText('501(c)(3) مُتحقَّق منه')).toBeVisible();
    await expectAccessibleBothModes(page);
    await page.goto(`/ar${g.base}/donations/receipts`);
    await expect(page.getByRole('heading', { name: 'الإيصالات الضريبية', level: 1 })).toBeVisible();
    await expectAccessibleBothModes(page);
    const ctx = await browser.newContext();
    const guest = await ctx.newPage();
    await guest.goto(`/ar/events/${g.slug}`);
    await expect(guest.locator('html')).toHaveAttribute('dir', 'rtl');
    const notice = guest.getByRole('region', { name: 'المبلغ القابل للخصم الضريبي' });
    await expect(notice).toContainText('من دفعتك البالغة');
    await expectAccessible(guest);
    await ctx.close();
  });
});
