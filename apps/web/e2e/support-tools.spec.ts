import { type Browser, expect, type Page, test } from '@playwright/test';
import { signFakeDisputeWebhook } from '@yayatoh/payments';
import { continueToPayment, expectAccessible, signIn } from './helpers.ts';

/**
 * M3.10c support tools in the browser: an organizer transfers a ticket and the recipient claims it
 * (the old QR is refused at the door, the new one admits; a transfer cancelled before its claim;
 * the new holder passes it on by name); finance issues a credit note, downloads its PDF and the
 * buyer spends the store credit; the dispute queue with its deadline and the evidence submitted;
 * support macros created and run from an order; viewers refused everywhere. Every test makes its
 * own event so the three viewports never share state.
 */
const VIEWER = 'jordan@lakeside.test';
const FINANCE = 'fran@lakeside.test';
const ORG = 'lakeside-events';

function chicago(offsetH: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
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

const stampOf = () => `${Date.now()}${test.info().project.name.slice(0, 1)}`;

/** A published event (starting `startH` hours from now) with one pass; its console path and slug. */
async function eventWithPass(page: Page, name: string, pass: string, price: string, startH: number) {
  await page.goto(`/o/${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Time zone').selectOption('America/Chicago');
  await page.getByLabel('Starts', { exact: true }).fill(chicago(startH));
  await page.getByLabel('Ends', { exact: true }).fill(chicago(startH + 4));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill(pass);
  await page.getByLabel('Price (USD)').fill(price);
  await page.getByLabel('Quantity available').fill('20');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: pass })).toBeVisible();
  return { base, slug: base.split('/').pop() ?? '' };
}

async function buy(
  browser: Browser,
  slug: string,
  pass: string,
  buyer: string,
  email: string,
  opts: { quantity?: number; paid?: boolean; code?: string } = {},
) {
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/events/${slug}`);
  await guest.getByLabel(`Quantity — ${pass}`).selectOption(String(opts.quantity ?? 1));
  await guest.getByLabel('Full name').fill(buyer);
  await guest.getByLabel('Email for your tickets').fill(email);
  if (opts.code) await guest.getByLabel('Promo code').fill(opts.code);
  await continueToPayment(guest, email);
  if (opts.paid) await guest.getByRole('button', { name: /^Pay/ }).click();
  await expect(guest).toHaveURL(/\/orders\/[A-Za-z0-9_-]{43}$/);
  return guest;
}

async function openOrder(page: Page, base: string, buyer: string) {
  await page.goto(`${base}/tickets-orders`);
  await page.getByRole('link', { name: buyer }).click();
  await expect(page.getByRole('heading', { name: `Order from ${buyer}` })).toBeVisible();
  return page.url();
}

const codesOn = async (p: Page) =>
  (await p.locator('.tracking-\\[0\\.2em\\]').allTextContents()).map((c) => c.trim());

test.describe('support tools (M3.10c)', () => {
  test('transfer a ticket, the recipient claims it; the old QR is refused; cancel before claim; pass it on by name', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const stamp = stampOf();
    const pass = `Transfer pass ${stamp}`;
    const buyer = `Tess Transfer ${stamp}`;
    const recipient = `Noor Recipient ${stamp}`;
    const recipientEmail = `noor+${stamp}@example.test`;
    await signIn(page);
    // Started an hour ago: the door scans now, and your team can still transfer.
    const { base, slug } = await eventWithPass(page, `Transfers ${stamp}`, pass, '0', -1);
    const guest = await buy(browser, slug, pass, buyer, `tess+${stamp}@example.test`, { quantity: 2 });
    const before = await codesOn(guest);
    expect(before).toHaveLength(2);

    const orderUrl = await openOrder(page, base, buyer);
    const transfers = page.getByRole('region', { name: 'Transfers' });
    await expect(transfers.getByText('No tickets of this order have been transferred.')).toBeVisible();
    // Validation from the server (the form does not rely on the browser's own checks).
    await transfers.getByRole('button', { name: 'Transfer ticket' }).click();
    await expect(transfers.getByText("Enter the new holder's name.")).toBeVisible();
    await transfers.getByLabel("New holder's name").fill(recipient);
    await transfers.getByLabel("New holder's email").fill('not-an-email');
    await transfers.getByRole('button', { name: 'Transfer ticket' }).click();
    await expect(transfers.getByText('Enter a valid email address.')).toBeVisible();
    // Keyboard only (the form clears after each answer): the first ticket to Noor.
    await transfers.getByLabel("New holder's name").focus();
    await page.keyboard.type(recipient);
    await transfers.getByLabel("New holder's email").focus();
    await page.keyboard.type(recipientEmail);
    await transfers.getByRole('button', { name: 'Transfer ticket' }).focus();
    await page.keyboard.press('Enter');
    await expect(
      transfers.getByText(`Transfer started. ${recipient} was emailed a link to claim the ticket.`),
    ).toBeVisible();
    const link = await transfers.getByLabel('Claim link (shown once)').inputValue();
    expect(link).toMatch(/\/claim\/[0-9a-f-]{36}~/);
    await expect(transfers.getByRole('row').filter({ hasText: recipient })).toContainText(
      'Waiting to be claimed',
    );
    await expectAccessible(page);

    // The recipient: the transfer names both sides; the name is filled in; only their address works.
    const claimer = await (await browser.newContext()).newPage();
    await claimer.goto(new URL(link).pathname);
    await expect(
      claimer.getByText(`${buyer} is transferring this ticket to ${recipient}.`, { exact: false }),
    ).toBeVisible();
    await expect(claimer.getByLabel('Full name')).toHaveValue(recipient);
    await expectAccessible(claimer);
    await claimer.getByLabel('Email', { exact: true }).fill(`someone.else+${stamp}@example.test`);
    await claimer.getByRole('button', { name: 'Claim ticket' }).click();
    await expect(claimer.getByText('Use the email address this ticket was sent to.')).toBeVisible();
    await claimer.getByLabel('Email', { exact: true }).fill(recipientEmail);
    await claimer.getByRole('button', { name: 'Claim ticket' }).click();
    await expect(claimer).toHaveURL(/\/my-tickets\//);
    await expect(claimer.getByText(recipient)).toBeVisible();
    const newCode = (await codesOn(claimer))[0] ?? '';
    // The link works once.
    const again = await (await browser.newContext()).newPage();
    await again.goto(new URL(link).pathname);
    await expect(again.getByText('This ticket has already been claimed')).toBeVisible();

    // At the door: the buyer's old code for that ticket is refused, the recipient's admits.
    const kept = await codesOn(await (async () => (await guest.reload(), guest))());
    const oldCode = before.find((c) => !kept.includes(c)) ?? '';
    expect(oldCode).not.toBe('');
    expect(newCode).not.toBe(oldCode);
    await page.goto(`${base}/onsite`);
    const field = page.getByLabel('Ticket code');
    const result = page.getByRole('status').filter({ has: page.locator('[data-result]') });
    await field.fill(oldCode);
    await field.press('Enter');
    await expect(result).toContainText('Not a valid ticket');
    await field.fill(newCode);
    await field.press('Enter');
    await expect(result).toContainText('Welcome in');

    // The order shows the claimed transfer, the new holder, the wallet pass and the timeline.
    await page.goto(orderUrl);
    await expect(transfers.getByRole('row').filter({ hasText: recipient })).toContainText('Claimed');
    await expect(page.getByRole('table', { name: 'Tickets' }).getByText(recipientEmail)).toBeVisible();
    await expect(page.getByRole('table', { name: 'Tickets' }).getByText(/^(Updating|Updated)$/)).toHaveCount(
      1,
    );
    const timeline = page.getByRole('region', { name: 'Timeline' });
    await expect(timeline.getByText(/^Ticket #\d+ claimed$/)).toBeVisible();

    // A second transfer, cancelled before it is claimed: its link stops working.
    await transfers.getByLabel("New holder's name").fill(`Late Friend ${stamp}`);
    await transfers.getByLabel("New holder's email").fill(`late+${stamp}@example.test`);
    await transfers.getByRole('button', { name: 'Transfer ticket' }).click();
    const lateLink = await transfers.getByLabel('Claim link (shown once)').inputValue();
    const lateRow = transfers.getByRole('row').filter({ hasText: `Late Friend ${stamp}` });
    await lateRow.getByRole('button', { name: 'Cancel transfer' }).click();
    await expect(lateRow).toContainText('Cancelled');
    await page.reload();
    await expect(lateRow).toContainText('Cancelled');
    await expect(lateRow.getByRole('button', { name: 'Cancel transfer' })).toHaveCount(0);
    const late = await (await browser.newContext()).newPage();
    await late.goto(new URL(lateLink).pathname);
    await expect(late.getByRole('button', { name: 'Claim ticket' })).toHaveCount(0);

    // The event has started: holder transfers closed at the start (the default rule).
    await claimer.reload();
    await expect(
      claimer
        .getByRole('region', { name: 'Transfer this ticket' })
        .getByText('Transfers for this ticket have closed.'),
    ).toBeVisible();
    await expectAccessible(claimer);

    // Arabic, right to left.
    await page.goto(orderUrl.replace('/o/', '/ar/o/'));
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'عمليات النقل' })).toBeVisible();
    await expectAccessible(page);
  });

  test('transfer rules per ticket type: holders refused when off, a fee to agree to', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const stamp = stampOf();
    const pass = `Rules pass ${stamp}`;
    const buyer = `Rhea Rules ${stamp}`;
    await signIn(page);
    const { base, slug } = await eventWithPass(page, `Rules ${stamp}`, pass, '0', 72);
    const rules = page.getByRole('form', { name: `Transfer rules for ${pass}` });
    await expect(page.getByRole('row').filter({ hasText: pass })).toContainText('Allowed');
    await rules.getByLabel('Fee (USD)').fill('abc');
    await rules.getByRole('button', { name: 'Save rules' }).click();
    await expect(rules.getByText('Enter an amount, or leave it empty.')).toBeVisible();
    await rules.getByLabel('Holders may transfer').uncheck();
    await rules.getByLabel('Fee (USD)').fill('');
    await rules.getByRole('button', { name: 'Save rules' }).click();
    await expect(rules.getByText('Rules saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('row').filter({ hasText: pass })).toContainText('Not allowed');
    await expectAccessible(page);

    // The holder's page says so (their link comes from the order page's "email me my tickets").
    const guest = await buy(browser, slug, pass, buyer, `rhea+${stamp}@example.test`);
    await openOrder(page, base, buyer);
    await page
      .getByRole('region', { name: 'Transfers' })
      .getByLabel("New holder's name")
      .fill(`Kit ${stamp}`);
    await page
      .getByRole('region', { name: 'Transfers' })
      .getByLabel("New holder's email")
      .fill(`kit+${stamp}@example.test`);
    await page
      .getByRole('region', { name: 'Transfers' })
      .getByRole('button', { name: 'Transfer ticket' })
      .click();
    // Your team is not bound by the holder rules.
    await expect(
      page.getByText(`Transfer started. Kit ${stamp} was emailed a link to claim the ticket.`),
    ).toBeVisible();
    const link = await page.getByLabel('Claim link (shown once)').inputValue();
    const kit = await (await browser.newContext()).newPage();
    await kit.goto(new URL(link).pathname);
    await kit.getByLabel('Email', { exact: true }).fill(`kit+${stamp}@example.test`);
    await kit.getByRole('button', { name: 'Claim ticket' }).click();
    await expect(kit).toHaveURL(/\/my-tickets\//);
    await expect(kit.getByText("This ticket can't be transferred.")).toBeVisible();
    // Allowed again with a fee: the holder must agree to it.
    await page.goto(`${base}/tickets-orders`);
    await rules.getByLabel('Holders may transfer').check();
    await rules.getByLabel('Fee (USD)').fill('3.50');
    await rules.getByRole('button', { name: 'Save rules' }).click();
    await expect(rules.getByText('Rules saved.')).toBeVisible();
    await kit.reload();
    const own = kit.getByRole('region', { name: 'Transfer this ticket' });
    await expect(own.getByText(/transfer fee \$3\.50/)).toBeVisible();
    await own.getByLabel('Their name').fill(`Lee ${stamp}`);
    await own.getByLabel('Their email').fill(`lee+${stamp}@example.test`);
    await own.getByRole('button', { name: 'Send transfer' }).click();
    await expect(own.getByText('Tick the box to agree to the transfer fee.')).toBeVisible();
    await own.getByLabel('Their name').fill(`Lee ${stamp}`);
    await own.getByLabel('Their email').fill(`lee+${stamp}@example.test`);
    await own.getByLabel('I agree to pay the $3.50 transfer fee.').check();
    await own.getByRole('button', { name: 'Send transfer' }).click();
    // Sent: the page now shows it waiting for Lee (and after a reload).
    await expect(own.getByText(`Waiting for Lee ${stamp} to claim it.`)).toBeVisible();
    await kit.reload();
    await expect(own.getByText(`Waiting for Lee ${stamp} to claim it.`)).toBeVisible();
    await expectAccessible(kit);
    // The holder changes their mind before the claim: the form is back.
    await own.getByRole('button', { name: 'Cancel transfer' }).click();
    await expect(own.getByLabel('Their name')).toBeVisible();
    await kit.reload();
    await expect(own.getByLabel('Their name')).toBeVisible();
    await guest.close();
  });

  test('issue a credit note, download its PDF; the buyer spends the store credit', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const stamp = stampOf();
    const pass = `Credit pass ${stamp}`;
    const buyer = `Cora Credit ${stamp}`;
    const email = `cora+${stamp}@example.test`;
    await signIn(page);
    const { base, slug } = await eventWithPass(page, `Credits ${stamp}`, pass, '20', 240);
    const guest = await buy(browser, slug, pass, buyer, email, { paid: true });
    await signIn(page, FINANCE);
    const orderUrl = await openOrder(page, base, buyer);
    const credit = page.getByRole('region', { name: 'Credit notes' });
    await expect(credit.getByText('No credit notes on this order.')).toBeVisible();
    // Server validation: an amount and a reason.
    await credit.getByRole('button', { name: 'Issue credit note' }).click();
    await expect(credit.getByText('Enter an amount of at least 0.01.')).toBeVisible();
    await credit.getByLabel('Amount (USD)').fill('5');
    await credit.getByLabel('Reason').fill('no');
    await credit.getByRole('button', { name: 'Issue credit note' }).click();
    await expect(credit.getByText('Write a reason of 3 to 500 characters.')).toBeVisible();
    await credit.getByLabel('Amount (USD)').fill('500');
    await credit.getByLabel('Reason').fill('Seats moved to the balcony.');
    await credit.getByRole('button', { name: 'Issue credit note' }).click();
    await expect(
      credit.getByText("That's more than what can still be credited on this order."),
    ).toBeVisible();
    // Keyboard (the form clears after each answer): five dollars as store credit.
    await credit.getByLabel('Amount (USD)').focus();
    await page.keyboard.type('5');
    await credit.getByLabel('Reason').focus();
    await page.keyboard.type('Seats moved to the balcony.');
    await credit.getByRole('button', { name: 'Issue credit note' }).focus();
    await page.keyboard.press('Enter');
    await expect(
      credit.getByText(/^Credit note CN-\d{5,} issued\. The buyer was emailed it\.$/),
    ).toBeVisible();
    const code = await credit
      .getByLabel('Store credit code (shown once; the buyer was emailed it)')
      .inputValue();
    expect(code).toMatch(/^CR-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    await page.reload();
    const row = credit.getByRole('row').filter({ hasText: 'Seats moved to the balcony.' });
    await expect(row).toContainText('Store credit');
    await expect(row).toContainText(`Code ending ${code.slice(-4)}`);
    await expect(row).toContainText('$5.00');
    await expectAccessible(page);
    // The PDF, rendered by Gotenberg.
    const href = await row.getByRole('link', { name: /\(PDF\)$/ }).getAttribute('href');
    const pdf = await page.request.get(href ?? '');
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toMatch(/application\/pdf|text\/html/);
    // The timeline and the finance report.
    await expect(
      page.getByRole('region', { name: 'Timeline' }).getByText('Credit note issued'),
    ).toBeVisible();
    await page.goto(`/o/${ORG}/finance`);
    const finance = page.getByRole('region', { name: 'Credit notes' });
    await expect(finance.getByRole('table', { name: 'Latest credit notes' }).getByText(buyer)).toBeVisible();
    await expectAccessible(page);

    // The buyer sees it with the code, and spends it on a second ticket.
    await guest.reload();
    const theirs = guest.getByRole('region', { name: 'Credit notes' });
    await expect(theirs.getByText(code)).toBeVisible();
    await expectAccessible(guest);
    const second = await buy(browser, slug, pass, buyer, email, { paid: true, code });
    await expect(second.getByText(/^Includes .+ off with CN-\d{5,}$/)).toBeVisible();
    await page.goto(orderUrl);
    await expect(row).toContainText('$0.00');
    // Spent: it no longer works.
    const third = await (await browser.newContext()).newPage();
    await third.goto(`/events/${slug}`);
    await third.getByLabel(`Quantity — ${pass}`).selectOption('1');
    await third.getByLabel('Full name').fill(buyer);
    await third.getByLabel('Email for your tickets').fill(email);
    await third.getByLabel('Promo code').fill(code);
    await continueToPayment(third, email).catch(() => undefined);
    await expect(third.getByText("That store credit code isn't valid or has been spent.")).toBeVisible();

    // Arabic, right to left.
    await page.goto(orderUrl.replace('/o/', '/ar/o/'));
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'الإشعارات الدائنة' })).toBeVisible();
    await expectAccessible(page);
  });

  test('work a dispute from the queue and submit its evidence; deadline alerts', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const secret = process.env.FAKE_PAYMENTS_SECRET;
    test.skip(!secret, 'needs FAKE_PAYMENTS_SECRET to sign provider webhooks');
    const stamp = stampOf();
    const pass = `Dispute pass ${stamp}`;
    const buyer = `Dara Dispute ${stamp}`;
    await signIn(page);
    const { slug } = await eventWithPass(page, `Disputes ${stamp}`, pass, '25', 240);
    const guest = await (await browser.newContext()).newPage();
    await guest.goto(`/events/${slug}`);
    await guest.getByLabel(`Quantity — ${pass}`).selectOption('1');
    await guest.getByLabel('Full name').fill(buyer);
    await guest.getByLabel('Email for your tickets').fill(`dara+${stamp}@example.test`);
    await continueToPayment(guest, `dara+${stamp}@example.test`);
    await expect(guest).toHaveURL(/\/checkout\/fake\?/);
    const fake = new URL(guest.url());
    const pi = fake.searchParams.get('pi') ?? '';
    const amount = Number(fake.searchParams.get('amount'));
    const orgId = fake.searchParams.get('org') ?? '';
    await guest.getByRole('button', { name: /^Pay/ }).click();
    await expect(guest).toHaveURL(/\/orders\/[A-Za-z0-9_-]{43}$/);
    const { body, signature } = signFakeDisputeWebhook(secret ?? '', {
      type: 'dispute.created',
      orgId,
      providerPaymentId: pi,
      providerDisputeId: `fakedp_st_${stamp}`,
      amountMinor: amount,
      currency: 'USD',
      reason: 'product_not_received',
      evidenceDueBy: new Date(Date.now() + 30 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    });
    const res = await page.request.post('/api/webhooks/fake', {
      data: body,
      headers: { 'content-type': 'application/json', 'x-fake-signature': signature },
    });
    expect(res.status(), await res.text()).toBe(200);
    // The deadline alert (the worker's hourly job) is raised once.
    const alerts = await page.request.post('/api/dev/disputes/alerts', { form: { org: ORG } });
    expect(((await alerts.json()) as { alerted: number }).alerted).toBeGreaterThanOrEqual(1);

    // The queue: open, amount, deadline with the time left (due within 3 days).
    await page.goto(`/o/${ORG}/disputes`);
    await expect(page.getByRole('heading', { name: 'Disputes', level: 1 })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: buyer });
    await expect(row).toContainText('$');
    await expect(row.getByText(/^(29|30) hours left$/)).toBeVisible();
    await expect(row).toContainText('product_not_received');
    await expectAccessible(page);
    await row.getByRole('link', { name: 'Build and submit evidence' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Respond to a dispute', level: 1 })).toBeVisible();
    const preview = page.getByRole('article', { name: 'Evidence packet' });
    for (const heading of ['Order', 'Access log (door scans)', 'Refund terms at purchase'])
      await expect(preview.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    const form = page.getByRole('region', { name: 'Your response' });
    await form
      .getByLabel('Your statement')
      .fill(`The buyer ${buyer} received the ticket by email and the event has not happened yet.`);
    await form.getByLabel('I read the evidence packet below and it is accurate.').check();
    await form.getByRole('button', { name: 'Submit evidence' }).click();
    await expect(page.getByText(/^Evidence submitted on /)).toBeVisible();
    await page.goto(`/o/${ORG}/disputes`);
    await expect(page.getByRole('row').filter({ hasText: buyer })).toContainText('Evidence submitted');

    // Finance sees the queue too; Arabic, right to left.
    await signIn(page, FINANCE);
    await page.goto(`/ar/o/${ORG}/disputes`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'النزاعات', level: 1 })).toBeVisible();
    await expectAccessible(page);
  });

  test('create support macros and run one from an order', async ({ page, browser }) => {
    test.setTimeout(240_000);
    const stamp = stampOf();
    const pass = `Macro pass ${stamp}`;
    const buyer = `Milo Macro ${stamp}`;
    const name = `Resend and note ${stamp}`;
    await signIn(page);
    const { base, slug } = await eventWithPass(page, `Macros ${stamp}`, pass, '0', 240);
    await buy(browser, slug, pass, buyer, `milo+${stamp}@example.test`, { quantity: 2 });

    await page.goto(`/o/${ORG}/macros`);
    await expect(page.getByRole('heading', { name: 'Support macros', level: 1 })).toBeVisible();
    const editor = page.getByRole('region', { name: 'New macro' });
    await editor.getByLabel('Name', { exact: true }).fill(name);
    await editor.getByLabel('Email subject').fill('Your tickets for {{event_name}}');
    await editor.getByLabel('Reply').fill('Hi {{first_name}}');
    await editor.getByRole('button', { name: 'Create macro' }).click();
    await expect(
      editor.getByText("The reply uses a merge field that doesn't exist. Use only the fields listed."),
    ).toBeVisible();
    // The form clears after each answer: fill it again, with no action this time.
    const fill = async () => {
      await editor.getByLabel('Name', { exact: true }).fill(name);
      await editor.getByLabel('Email subject').fill('Your tickets for {{event_name}}');
      await editor
        .getByLabel('Reply')
        .fill('Hi {{buyer_name}}, we sent your {{ticket_count}} tickets again.');
    };
    await fill();
    await editor.getByLabel('Email the buyer').uncheck();
    await editor.getByRole('button', { name: 'Create macro' }).click();
    await expect(editor.getByText('Choose at least one action.')).toBeVisible();
    // Keyboard: tick the actions and save.
    await fill();
    for (const action of ['Email the buyer', 'Add a team note', 'Resend the tickets']) {
      await editor.getByLabel(action).focus();
      if (!(await editor.getByLabel(action).isChecked())) await page.keyboard.press('Space');
    }
    await editor.getByRole('button', { name: 'Create macro' }).focus();
    await page.keyboard.press('Enter');
    await expect(editor.getByText('Macro saved.')).toBeVisible();
    await page.reload();
    await expect(page.locator('summary').filter({ hasText: name })).toBeVisible();
    await expectAccessible(page);

    // Run it on the order: the preview shows the filled reply.
    await openOrder(page, base, buyer);
    const run = page.getByRole('region', { name: 'Run a macro' });
    await run.getByLabel('Macro', { exact: true }).selectOption({ label: name });
    await expect(run.getByText(`Hi ${buyer}, we sent your 2 tickets again.`)).toBeVisible();
    await expect(run.getByText('Does: Email the buyer · Add a team note · Resend the tickets')).toBeVisible();
    await run.getByRole('button', { name: 'Run macro' }).focus();
    await page.keyboard.press('Enter');
    await expect(run.getByText(`Macro “${name}” ran.`)).toBeVisible();
    await page.reload();
    const timeline = page.getByRole('region', { name: 'Timeline' });
    await expect(timeline.getByText('Support macro run')).toBeVisible();
    await expect(timeline.getByText(`${name}: Hi ${buyer}, we sent your 2 tickets again.`)).toBeVisible();
    // The reply goes out (dev: the outbox drained now) and shows in the message log.
    const drained = await page.request.post('/api/dev/outbox/drain', { form: { org: ORG } });
    expect(drained.status()).toBe(200);
    await page.reload();
    const log = page.getByRole('region', { name: 'Messages', exact: true });
    await expect(log.getByText('Support reply').first()).toBeVisible();
    await expect(log.getByText('Tickets resent').first()).toBeVisible();
    await expectAccessible(page);

    // Arabic, right to left.
    await page.goto(`/ar/o/${ORG}/macros`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'ماكرو الدعم', level: 1 })).toBeVisible();
    await expectAccessible(page);
  });

  test('viewers are refused every support action', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const stamp = stampOf();
    const pass = `Viewer pass ${stamp}`;
    const buyer = `Vic Viewer ${stamp}`;
    await signIn(page);
    const { base, slug } = await eventWithPass(page, `Viewers ${stamp}`, pass, '0', 240);
    await buy(browser, slug, pass, buyer, `vic+${stamp}@example.test`);
    const orderUrl = await openOrder(page, base, buyer);
    await signIn(page, VIEWER);
    await page.goto(orderUrl);
    await expect(page.getByRole('heading', { name: `Order from ${buyer}` })).toBeVisible();
    // They read transfers and credit notes, but have no controls.
    await expect(page.getByRole('region', { name: 'Transfers' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Transfer ticket' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Issue credit note' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Run a macro' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Run macro' })).toHaveCount(0);
    // No nav items, and the pages answer 404.
    await expect(page.getByRole('link', { name: 'Disputes' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Support macros' })).toHaveCount(0);
    for (const path of [`/o/${ORG}/disputes`, `/o/${ORG}/macros`]) {
      const res = await page.goto(path);
      expect(res?.status()).toBe(404);
    }
    await page.goto(`${base}/tickets-orders`);
    await expect(page.getByRole('region', { name: 'Transfer rules' })).toHaveCount(0);
    await expectAccessible(page);
  });
});
