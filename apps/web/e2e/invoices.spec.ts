import { type Browser, expect, type Page, test } from '@playwright/test';
import { expectAccessible, expectAccessibleBothModes, lastEmailedCode, signIn } from './helpers.ts';

/**
 * M5.1d invoices, PO and pay later: the organizer turns on pay later with a required PO number for
 * a type (by keyboard); a buyer registers with pay later and a PO, gets the invoice by email (dev
 * mailbox) and its PDF, pays half by the pay link; the door refuses the ticket for the balance and
 * staff admit it with an audited reason; finance records the rest as a wire and the invoice is
 * paid; another invoice is voided; the viewer reads but can't record payments; the invoice
 * reminder journey comes from its template; Arabic renders right-to-left.
 */

const VIEWER = 'jordan@lakeside.test';
const ORG = 'lakeside-events';
const TZ = 'America/Chicago';
const stamp = () => `${Date.now().toString(36)}${test.info().project.name.replace(/\D/g, '')}`;

test.describe.configure({ mode: 'serial' });

let base = '';
let slug = '';
let s = '';
let invoicePath = '';
let orderPath = '';
let buyerEmail = '';

/** `YYYY-MM-DDTHH:mm` in Chicago, `offsetH` hours from now (datetime-local). */
function chicago(offsetH: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
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

async function guest(browser: Browser) {
  return (await browser.newContext()).newPage();
}

async function drain(page: Page) {
  await page.request.post('/api/dev/outbox/drain', { form: { org: ORG } });
}

const payLaterCard = (page: Page, name: string) =>
  page
    .getByRole('region', { name: 'Pay later by invoice' })
    .getByRole('listitem')
    .filter({ has: page.getByText(name, { exact: true }) });

/** The public registration page up to the options. */
async function options(page: Page, email: string) {
  await page.goto(`/events/${slug}/register`);
  await page.getByLabel('Your email').fill(email);
  await page.getByRole('button', { name: 'Show my options' }).click();
  await expect(page.getByRole('heading', { name: 'Choose your registration' })).toBeVisible();
  return page.getByRole('form', { name: 'Registration' });
}

async function verify(page: Page, email: string) {
  const field = page.getByLabel('Verification code', { exact: true });
  await expect(field).toBeVisible();
  await field.fill(await lastEmailedCode(page, email));
  await page.getByRole('button', { name: /^Verify and continue/ }).click();
}

/** Register for Member, paying later by invoice with a PO number; lands on the invoice page. */
async function registerOnInvoice(page: Page, email: string, name: string, po: string) {
  const form = await options(page, email);
  await form.getByRole('radio', { name: /^Member/ }).check();
  await form.getByRole('radio', { name: 'Pay later by invoice' }).check();
  await form.getByLabel('Full name').fill(name);
  await form.getByLabel('PO number', { exact: true }).fill(po);
  await form.getByLabel('Company to invoice (optional)').fill('Acme Corp');
  await form.getByRole('button', { name: 'Register and get an invoice' }).click();
  await verify(page, email);
  await expect(page).toHaveURL(/\/invoice\/[0-9a-f-]{36}~/);
}

const dd = (page: Page, term: string) =>
  page
    .locator('dl > div')
    .filter({ has: page.getByText(term, { exact: true }) })
    .locator('dd');

test('the organizer turns on pay later with a required PO number, by keyboard', async ({ page }) => {
  test.setTimeout(240_000);
  s = stamp();
  await signIn(page);
  // A conference starting in two hours: the door is open and the invoice is due today.
  await page.goto(`/o/${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(`Invoices ${s}`);
  await page.getByLabel('Event type').selectOption('conference');
  await page.getByLabel('Time zone').selectOption(TZ);
  await page.getByLabel('Starts', { exact: true }).fill(chicago(2));
  await page.getByLabel('Ends', { exact: true }).fill(chicago(10));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  base = new URL(page.url()).pathname;
  slug = base.split('/').pop() as string;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();

  await page.goto(`${base}/registration`);
  await page.getByRole('button', { name: 'Add standard types and items' }).click();
  const field = page.getByLabel('Price for Member · Full pass (USD)');
  await field.fill('1200');
  await field.press('Enter');
  await expect(page.getByRole('button', { name: 'Save price — Member · Full pass' })).toBeVisible();

  const card = payLaterCard(page, 'Member');
  await expect(card).toContainText('Paid at checkout only.');
  // Keyboard only: open the editor, choose On and a required PO number, save.
  const summary = card.getByText('Change pay later for Member');
  await summary.focus();
  await page.keyboard.press('Enter');
  await card.getByLabel('Pay later by invoice').selectOption('on');
  await card.getByLabel('PO number').selectOption('required');
  await card.getByLabel('PO number').press('Tab');
  await expect(card.getByRole('button', { name: 'Save' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(card.getByText('Saved.')).toBeVisible();
  await page.reload();
  await expect(payLaterCard(page, 'Member')).toContainText('Pay later is on · PO number: required');
  await expectAccessibleBothModes(page);

  // No invoices yet: the list says what to do.
  await page.getByRole('link', { name: 'Open the invoices' }).click();
  await expect(page.getByRole('heading', { name: 'Invoices', level: 1 })).toBeVisible();
  await expect(page.getByText('No invoices yet')).toBeVisible();
  await expectAccessibleBothModes(page);
});

test('register with pay later and a PO, get the invoice and its PDF by email, pay half by link', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const page = await guest(browser);
  buyerEmail = `ap-${s}@corp.test`;
  const form = await options(page, buyerEmail);
  await form.getByRole('radio', { name: /^Member/ }).check();
  await expect(form.getByRole('radio', { name: 'Pay now by card' })).toBeChecked();
  await form.getByRole('radio', { name: 'Pay later by invoice' }).check();
  await expect(form.getByText(/due in 30 days or 7 days before the event/)).toBeVisible();
  await form.getByLabel('Full name').fill('Ada Payable');
  // The PO number is required for this type.
  await form.getByRole('button', { name: 'Register and get an invoice' }).click();
  await verify(page, buyerEmail);
  await expect(form.getByText('Enter your PO number.')).toBeVisible();
  await expect(form.getByLabel('PO number', { exact: true })).toBeFocused();
  await form.getByLabel('PO number', { exact: true }).fill(`PO-${s}`);
  await form.getByLabel('Company to invoice (optional)').fill('Acme Corp');
  await form.getByRole('button', { name: 'Register and get an invoice' }).click();
  await expect(page).toHaveURL(/\/invoice\/[0-9a-f-]{36}~/);
  invoicePath = new URL(page.url()).pathname;

  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toHaveText(/^Invoice INV-\d{5}$/);
  const label = ((await h1.textContent()) ?? '').replace('Invoice ', '');
  await expect(page.getByText(/you're registered\. This invoice is due on/)).toBeVisible();
  await expect(page.getByText('Open', { exact: true })).toBeVisible();
  await expect(dd(page, 'PO number')).toHaveText(`PO-${s}`);
  await expect(dd(page, 'Company')).toHaveText('Acme Corp');
  await expect(dd(page, 'Total')).toHaveText('$1,200.00');
  await expect(dd(page, 'Balance due')).toHaveText('$1,200.00');
  await expectAccessibleBothModes(page);

  // The invoice email (dev mailbox): its number, amount and the link to this page.
  let link = '';
  await expect
    .poll(
      async () => {
        await drain(page);
        const res = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(buyerEmail)}`);
        const mail = ((await res.json()) as { subject: string; html: string }[]).find(
          (m) => m.subject === `Invoice ${label} for Invoices ${s}`,
        );
        link = /href="(https?:\/\/[^"]+\/invoice\/[^"]+)"/.exec(mail?.html ?? '')?.[1] ?? '';
        return link;
      },
      { timeout: 30_000 },
    )
    .toContain('/invoice/');
  expect(new URL(link.replace(/&amp;/g, '&')).pathname).toBe(invoicePath);
  // The PDF.
  const pdf = await page.request.get(`${invoicePath}/pdf?locale=en`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toMatch(/application\/pdf|text\/html/);
  if (pdf.headers()['content-type']?.startsWith('application/pdf'))
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');

  // Pay half by the link, keyboard only: the amount, then the payment page.
  const amount = page.getByLabel('Amount to pay (USD)');
  await expect(amount).toHaveValue('1200.00');
  await amount.fill('5000');
  await amount.press('Enter');
  await expect(page.getByText('That is more than the balance due.')).toBeVisible();
  await amount.fill('600');
  await amount.press('Tab');
  await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/checkout\/fake/);
  await expect(page.getByText(`${label} · Invoices ${s}`)).toBeVisible();
  await page.getByRole('button', { name: 'Pay now (test)' }).click();
  await expect(page).toHaveURL(/\/invoice\/[0-9a-f-]{36}~[^?]+\?paid=1/);
  await expect(page.getByText('Thank you for your payment')).toBeVisible();
  await expect(page.getByText('$600.00 is still due.')).toBeVisible();
  await expect(dd(page, 'Paid')).toHaveText('$600.00');
  await expect(page.getByText(/Card \(pay link\)/)).toBeVisible();
  await expectAccessibleBothModes(page);
  await page.close();
});

test('the door refuses the ticket for the balance; staff admit it with a reason', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto(`${base}/registration/invoices?status=open`);
  await expect(page.getByRole('link', { name: 'Open', exact: true })).toHaveAttribute('aria-current', 'page');
  const row = page.getByRole('row').filter({ hasText: 'Acme Corp' });
  await expect(row).toContainText(`PO PO-${s}`);
  await expect(row).toContainText('$600.00');
  await expectAccessibleBothModes(page);
  await row.getByRole('link', { name: /^INV-\d{5}$/ }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  orderPath = new URL(page.url()).pathname;
  await expect(page.getByText('Awaiting invoice payment')).toBeVisible();
  const code =
    (
      await page
        .getByRole('row')
        .filter({ hasText: 'Ada Payable' })
        .locator('td')
        .filter({ hasText: /^[2-9A-HJKMNP-TV-Z]{8}$/ })
        .first()
        .textContent()
    )?.trim() ?? '';
  expect(code).toMatch(/^[2-9A-Z]{8}$/);

  await page.goto(`${base}/onsite`);
  const field = page.getByLabel('Ticket code');
  await field.fill(code);
  await field.press('Enter');
  const result = page.getByRole('status').filter({ has: page.locator('[data-result]') });
  await expect(result).toContainText('Balance due on the invoice');
  await expect(result).toContainText('Ada Payable');
  const override = page.getByRole('form', { name: 'Admit with a balance due' });
  await expect(override).toBeVisible();
  await expectAccessible(page);
  // Keyboard only: the reason, then "Admit anyway".
  const note = override.getByLabel('Reason for admitting');
  await note.focus();
  await page.keyboard.type('PO approved by Acme AP.');
  await page.keyboard.press('Enter');
  await expect(result).toContainText('Welcome in');
  await expect(page.getByRole('form', { name: 'Admit with a balance due' })).toHaveCount(0);
  // Scanning again is a duplicate, not another refusal.
  await field.fill(code);
  await field.press('Enter');
  await expect(result).toContainText('Already checked in');
});

test('finance records the rest as a wire: the invoice is paid and stays paid after reload', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto(orderPath);
  const panel = page.getByRole('region', { name: /^Invoice INV-\d{5}$/ });
  await expect(dd(page, 'Balance due')).toHaveText('$600.00');
  const form = page.getByRole('form', { name: 'Record a payment received' });
  await expect(form.getByLabel('Amount (USD)')).toHaveValue('600.00');
  await form.getByLabel('Amount (USD)').fill('900');
  await form.getByRole('button', { name: 'Record payment' }).click();
  await expect(form.getByText('That is more than the balance due.')).toBeVisible();
  await form.getByLabel('Amount (USD)').fill('600');
  await form.getByLabel('How it was paid').selectOption('wire');
  await form.getByLabel('Reference').fill(`WIRE-${s}`);
  await form.getByRole('button', { name: 'Record payment' }).click();
  // Paid in full: the panel says so at once (the record form leaves with the balance).
  await expect(dd(page, 'Balance due')).toHaveText('$0.00');
  await page.reload();
  await expect(panel.getByText('Paid', { exact: true }).first()).toBeVisible();
  await expect(dd(page, 'Balance due')).toHaveText('$0.00');
  await expect(panel).toContainText(`Wire transfer · WIRE-${s}`);
  await expect(page.getByRole('form', { name: 'Record a payment received' })).toHaveCount(0);
  await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible();
  await expectAccessible(page);
  // The buyer's page shows it paid.
  const buyer = await page.context().browser()?.newPage();
  if (buyer) {
    await buyer.goto(invoicePath);
    await expect(buyer.getByText(/this invoice is paid/)).toBeVisible();
    await expect(buyer.getByRole('form', { name: 'Pay this invoice' })).toHaveCount(0);
    await buyer.close();
  }
});

test('an unpaid invoice is voided by the organizer with a reason', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const buyer = await guest(browser);
  await registerOnInvoice(buyer, `void-${s}@corp.test`, 'Vic Void', `PO-V-${s}`);
  await buyer.close();
  await signIn(page);
  await page.goto(`${base}/registration/invoices`);
  await page
    .getByRole('row')
    .filter({ hasText: `PO PO-V-${s}` })
    .getByRole('link', { name: /^INV-\d{5}$/ })
    .click();
  await page.getByText('Void this invoice').click();
  const form = page.getByRole('form', { name: 'Void the invoice' });
  await form.getByRole('button', { name: 'Void invoice' }).click();
  await expect(form.getByText('Give a reason (3 to 500 characters).')).toBeVisible();
  await form.getByLabel('Reason').fill('Registered twice by mistake.');
  await form.getByRole('button', { name: 'Void invoice' }).click();
  await expect(page.getByText('Voided: Registered twice by mistake.')).toBeVisible();
  await expect(page.getByText('Void', { exact: true }).first()).toBeVisible();
  await page.goto(`${base}/registration/invoices?status=void`);
  await expect(page.getByRole('row').filter({ hasText: `PO PO-V-${s}` })).toBeVisible();
});

test('the viewer reads invoices but cannot record payments or void', async ({ page }) => {
  await signIn(page, VIEWER);
  await page.goto(`${base}/registration/invoices`);
  await expect(page.getByRole('heading', { name: 'Invoices', level: 1 })).toBeVisible();
  await page.goto(orderPath);
  await expect(page.getByRole('region', { name: /^Invoice INV-\d{5}$/ })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Record a payment received' })).toHaveCount(0);
  await expect(page.getByText('Void this invoice')).toHaveCount(0);
  await page.goto(`${base}/registration`);
  await expect(payLaterCard(page, 'Member')).toContainText('Pay later is on');
  await expect(page.getByText('Change pay later for Member')).toHaveCount(0);
});

test('the invoice reminder journey comes from its template', async ({ page }) => {
  await signIn(page);
  await page.goto(`/o/${ORG}/journeys/new`);
  await page.getByLabel('Journey name').fill(`Reminders ${s}`);
  const scope = page.getByLabel('Event or series');
  const value = await scope.locator('option', { hasText: `Invoices ${s}` }).getAttribute('value');
  await scope.selectOption(value ?? '');
  await page.getByRole('radio', { name: /^Invoice reminders/ }).check();
  await page.getByRole('button', { name: 'Create journey' }).click();
  await expect(page).toHaveURL(/\/journeys\/[0-9a-f-]{36}\?created=1/);
  await expect(page.getByText('7 days before the due date, at 9:00 AM')).toBeVisible();
  await expect(page.getByText('On the due date, at 9:00 AM')).toBeVisible();
  await expect(page.getByText('7 days after the due date, at 9:00 AM')).toBeVisible();
  await expectAccessible(page);
});

test('Arabic renders the invoice right-to-left', async ({ page }) => {
  await page.goto(`/ar${invoicePath}`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^الفاتورة INV-\d{5}$/);
  await expectAccessibleBothModes(page);
  await signIn(page);
  await page.goto(`/ar${base}/registration/invoices`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'الفواتير', level: 1 })).toBeVisible();
  await expectAccessibleBothModes(page);
});
