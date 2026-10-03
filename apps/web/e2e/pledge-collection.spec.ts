import { type Browser, expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { checkoutTarget } from '@yayatoh/events';
import { type PledgeScenario, pledgeScenario } from '@yayatoh/testing';
import {
  continueToPayment,
  expectAccessible,
  expectAccessibleBothModes,
  newUser,
  pickOption,
} from './helpers.ts';

// axe runs in light and dark on most screens, and each journey sets up its own gala.
test.describe.configure({ timeout: 240_000 });

/**
 * M4.8e cards on file and pledge collection (P4-12, P4-14). A guest saves a card on their own
 * phone from the party's QR code (every validation message, keyboard only, the consent box
 * required); the host closes the night (summaries); the morning run charges the saved card once,
 * exactly the pledge, and a replay charges nothing; a pledge without a card is never charged and
 * is paid by its link; offline payments and write-offs with their validation; viewers read only;
 * one-tap giving with the saved card and removing it; the checkout box and the check-in QR code;
 * Arabic RTL. Each test runs on a gala of its own (a fresh org with a connected account).
 */

interface Gala {
  readonly org: string;
  readonly slug: string;
  readonly base: string;
  readonly s: PledgeScenario;
}

test.afterAll(async () => {
  await closePools();
});

async function gala(page: Page): Promise<Gala> {
  const user = await newUser(page, {
    org: true,
    twoFactor: true,
    event: 'published',
    profile: 'gala',
    payouts: 'active',
  });
  const org = user.orgSlug ?? '';
  const slug = user.eventSlug ?? '';
  const target = await checkoutTarget(slug);
  if (!target) throw new Error('no published gala');
  const s = await pledgeScenario(target.orgId, target.eventId);
  return { org, slug, base: `/o/${org}/e/${slug}/donations`, s };
}

/** The guest's own phone (no session). */
async function phone(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

/** The fake provider's card step: pick a test card and save it. */
async function fakeCardStep(page: Page, card: '4242' | '0002' | '9995' = '4242') {
  await expect(page).toHaveURL(/\/checkout\/fake\/setup\?/);
  await pickOption(page.getByLabel('Test card'), card);
  await page.getByRole('button', { name: 'Save card (test)' }).click();
}

/** Run the collection as the worker would the next morning (the dev route, a few days ahead). */
async function morningRun(page: Page, org: string) {
  const res = await page.request.post('/api/dev/donations/collect', {
    form: { org, now: new Date(Date.now() + 3 * 86_400_000).toISOString() },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()) as { charged: number; declined: number; invoiced: number };
}

const row = (page: Page, paddle: number) =>
  page.getByRole('row').filter({ has: page.getByRole('cell', { name: String(paddle), exact: true }) });

test.describe('cards on file and pledge collection (M4.8e)', () => {
  test('a guest saves a card from the table QR; the night is closed; the card is charged once the next morning', async ({
    page,
    browser,
  }) => {
    const g = await gala(page);
    // The guest's phone: the party's own card page (its QR code on the table), keyboard only.
    const guest = await phone(browser);
    await guest.page.goto(`/rsvp/${encodeURIComponent(g.s.rivera.token)}/card`);
    await expect(
      guest.page.getByRole('heading', { name: "Save a card for tonight's giving", level: 1 }),
    ).toBeVisible();
    await expect(guest.page.getByText(`For ${g.s.rivera.name}:`)).toBeVisible();
    await expectAccessibleBothModes(guest.page);
    const save = guest.page.getByRole('button', { name: 'Save my card' });
    await save.click();
    await expect(guest.page.getByText('Enter your full name.')).toBeVisible();
    await expect(guest.page.getByLabel('Full name')).toBeFocused();
    await guest.page.keyboard.type('Sofia Rivera');
    await guest.page.keyboard.press('Tab');
    await guest.page.keyboard.type('not-an-email');
    await guest.page.keyboard.press('Enter');
    await expect(guest.page.getByText('Enter a valid email address.')).toBeVisible();
    await expect(guest.page.getByLabel('Email')).toHaveValue('not-an-email');
    await guest.page.getByLabel('Email').fill(`sofia+${test.info().project.name}@example.test`);
    await guest.page.keyboard.press('Enter');
    // The authorization is never pre-ticked: without it nothing is saved.
    await expect(guest.page.getByText('Tick the box to authorize saving your card.')).toBeVisible();
    const consent = guest.page.getByLabel('I authorize saving this card for tonight');
    await expect(consent).not.toBeChecked();
    await expect(consent).toBeFocused();
    await guest.page.keyboard.press('Space');
    await expect(consent).toBeChecked();
    await expectAccessible(guest.page);
    await save.focus();
    await guest.page.keyboard.press('Enter');
    await fakeCardStep(guest.page, '4242');
    await expect(guest.page.getByText('Your card is saved for tonight')).toBeVisible();
    await expect(
      guest.page.getByText('visa ending 4242 is ready for one-tap giving at this event.'),
    ).toBeVisible();
    await guest.page.reload();
    await expect(guest.page.getByText('Your card is saved for tonight')).toBeVisible();
    await expectAccessibleBothModes(guest.page);

    // The host's pledges: three, none sent yet; closing the night is the one primary action.
    await page.goto(`${g.base}/pledges`);
    await expect(page.getByRole('heading', { name: 'Pledges', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: '3 pledges to send' })).toBeVisible();
    await expect(row(page, g.s.rivera.paddle)).toContainText('Not sent');
    await expect(page.getByTestId('card-qr-table')).toBeVisible();
    await expectAccessibleBothModes(page);
    await page.getByRole('button', { name: 'Close the night and send summaries' }).click();
    await expect(page.getByTestId('raise-answer')).toHaveText(
      'Summaries sent: 1 pledge will be charged to a saved card and 2 pledges got pay links.',
    );
    await expect(row(page, g.s.rivera.paddle)).toContainText('Card charge scheduled');
    await expect(row(page, g.s.rivera.paddle)).toContainText('visa ·4242');
    await expect(row(page, g.s.nakamura.paddle)).toContainText('Pay link sent');
    await expect(row(page, g.s.nakamura.paddle)).toContainText('No email on file');
    await expect(page.getByRole('heading', { name: /to send/ })).toHaveCount(0);

    // The morning run charges the saved card once; a replay charges nothing.
    expect((await morningRun(page, g.org)).charged).toBe(1);
    expect((await morningRun(page, g.org)).charged).toBe(0);
    await page.reload();
    await expect(row(page, g.s.rivera.paddle)).toContainText('Paid');
    await expect(row(page, g.s.rivera.paddle)).toContainText('Charged to visa ·4242');
    // The pledge without a card was never charged: still waiting for its pay link.
    await expect(row(page, g.s.nakamura.paddle)).toContainText('Pay link sent');
    await expect(page.getByTestId('pledge-totals')).toContainText('$1,000.00');
    await guest.context.close();
  });

  test('a pledge without a card is paid by its link; finance records a check and writes a pledge off; viewers read only', async ({
    page,
    browser,
  }) => {
    const g = await gala(page);
    await page.goto(`${g.base}/pledges`);
    await page.getByRole('button', { name: 'Close the night and send summaries' }).click();
    await expect(page.getByTestId('raise-answer')).toContainText('Summaries sent');

    // The donor's pay link (shared by the host: no email on file).
    const link = await row(page, g.s.nakamura.paddle)
      .getByRole('link', { name: `Pay link for paddle ${g.s.nakamura.paddle}` })
      .getAttribute('href');
    const donor = await phone(browser);
    await donor.page.goto(link ?? '');
    await expect(
      donor.page.getByRole('heading', { name: 'Your pledge of $1,000.00', level: 1 }),
    ).toBeVisible();
    await expect(donor.page.getByText('Waiting for payment')).toBeVisible();
    await expect(donor.page.getByText(/Please pay by/)).toBeVisible();
    await expectAccessibleBothModes(donor.page);
    // No email on file: the page asks for one (the receipt goes there).
    const pay = donor.page.getByRole('button', { name: 'Pay $1,000.00 now' });
    await donor.page.getByLabel('Email for your receipt').fill('not-an-email');
    await pay.click();
    await expect(donor.page.getByText('Enter a valid email address.')).toBeVisible();
    await donor.page
      .getByLabel('Email for your receipt')
      .fill(`ken+${test.info().project.name}@example.test`);
    await pay.click();
    await expect(donor.page).toHaveURL(/\/checkout\/fake\?/);
    expect(new URL(donor.page.url()).searchParams.get('amount')).toBe('100000');
    await donor.page.getByRole('button', { name: 'Pay now (test)' }).click();
    await expect(
      donor.page.getByText('Paid in full. Thank you! Your receipt is on its way by email.'),
    ).toBeVisible();
    await expect(donor.page.getByRole('button', { name: /Pay/ })).toHaveCount(0);
    await expectAccessible(donor.page);
    await page.reload();
    await expect(row(page, g.s.nakamura.paddle)).toContainText('Paid by link');

    // Okafor: a check, with every validation message.
    const okafor = row(page, g.s.okafor.paddle);
    await okafor.getByText('Record a payment', { exact: true }).click();
    const record = okafor.getByRole('button', { name: `Record payment for paddle ${g.s.okafor.paddle}` });
    await record.click();
    await expect(okafor.getByText('Choose how it was paid.')).toBeVisible();
    await pickOption(okafor.getByLabel('How it was paid'), 'check');
    await okafor.getByLabel('Received on').fill('2099-01-01');
    await record.click();
    await expect(okafor.getByText("The date can't be in the future.")).toBeVisible();
    await okafor.getByLabel('Received on').fill('2026-01-02');
    await okafor.getByLabel('Reference (optional)').fill('#1042');
    await record.click();
    await expect(okafor).toContainText('Paid offline');
    await expect(okafor).toContainText('Check');
    await expect(page.getByTestId('pledge-totals')).toContainText('$1,250.00');

    // Rivera (no card either): written off, with a note required.
    const rivera = row(page, g.s.rivera.paddle);
    await rivera.getByText('Write off', { exact: true }).click();
    const writeOff = rivera.getByRole('button', { name: `Write off paddle ${g.s.rivera.paddle}'s pledge` });
    await writeOff.click();
    await expect(rivera.getByText('Write why the pledge is written off.')).toBeVisible();
    await rivera.getByLabel("Why it's written off").fill('Pledge withdrawn by the donor');
    await writeOff.click();
    await expect(rivera).toContainText('Written off');
    await expect(rivera).toContainText('Pledge withdrawn by the donor');
    await expectAccessibleBothModes(page);

    // A viewer of the org reads the page: no close, record or write-off controls.
    const viewer = await phone(browser);
    await newUser(viewer.page, { join: [`${g.org}:viewer`] });
    await viewer.page.goto(`${g.base}/pledges`);
    await expect(viewer.page.getByText(/Finance roles close the night/)).toBeVisible();
    await expect(viewer.page.getByText('Record a payment')).toHaveCount(0);
    await expect(viewer.page.getByText('Write off', { exact: true })).toHaveCount(0);
    await donor.context.close();
    await viewer.context.close();
  });

  test('one-tap giving with the card saved at check-in, and removing it', async ({ page, browser }) => {
    const g = await gala(page);
    // The desk shows the check-in QR code; it opens the event's card page.
    await page.goto(`/o/${g.org}/e/${g.slug}/onsite`);
    const qr = page.getByTestId('card-qr-checkin');
    await expect(qr.getByRole('img', { name: "QR code to save a card for tonight's giving" })).toBeVisible();
    const href = await qr.getByRole('link').getAttribute('href');
    expect(href).toContain(`/events/${g.slug}/card?src=checkin`);

    const guest = await phone(browser);
    await guest.page.goto(new URL(href ?? '').pathname + new URL(href ?? '').search);
    await guest.page.getByLabel('Full name').fill('Tap Giver');
    await guest.page.getByLabel('Email').fill(`tap+${test.info().project.name}@example.test`);
    await guest.page.getByLabel('I authorize saving this card for tonight').check();
    await guest.page.getByRole('button', { name: 'Save my card' }).click();
    await fakeCardStep(guest.page, '4242');
    await guest.page.getByRole('link', { name: 'Give now' }).click();
    const oneTap = guest.page.getByRole('region', { name: 'Give with your saved card' });
    await expect(oneTap).toContainText('visa ending 4242');
    await expectAccessibleBothModes(guest.page);
    await oneTap.getByRole('button', { name: 'Give $250.00 · A school day' }).click();
    await expect(guest.page.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
    await expect(guest.page.getByText('Your gift of $250.00 to Fund-a-need was received.')).toBeVisible();

    // Remove the card: the giving page no longer offers one tap.
    await guest.page.goto(`/events/${g.slug}/card`);
    await guest.page.getByRole('button', { name: 'Remove my card' }).click();
    await expect(guest.page.getByText("Your card was removed. It won't be charged.")).toBeVisible();
    await expect(guest.page.getByRole('button', { name: 'Save my card' })).toBeVisible();
    await guest.page.goto(`/events/${g.slug}/give`);
    await expect(guest.page.getByRole('region', { name: 'Give with your saved card' })).toHaveCount(0);
    await guest.context.close();
  });

  test('guest check-in in the Scan PWA (M4.4b) offers the card-saving code right after a guest arrives', async ({
    page,
    browser,
  }) => {
    const g = await gala(page);
    await page.goto(`/o/${g.org}/e/${g.slug}/onsite`);
    await page.getByLabel('Device name').fill(`Desk ${test.info().project.name}`);
    await page.getByRole('button', { name: 'Add device' }).click();
    const link = await page.getByTestId('scan-link').getAttribute('href');
    expect(link).toMatch(/\/scan#e=[0-9a-f-]{36}&k=yyd_/);

    // The door device: guest check-in by name, then the code for the guest's own phone.
    const device = await phone(browser);
    await device.page.goto(link ?? '');
    const guests = device.page
      .getByRole('navigation', { name: 'Scanner mode' })
      .getByRole('button', { name: 'Guests' });
    await guests.focus();
    await device.page.keyboard.press('Enter');
    await expect(device.page.getByTestId('checkin-card-qr')).toHaveCount(0);
    await device.page.getByLabel('Guest or party name').fill('sofia');
    await device.page.getByRole('button', { name: 'Check in Sofia Rivera' }).click();
    await expect(device.page.getByTestId('guest-message')).toContainText('Sofia Rivera is checked in.');
    const entry = device.page.getByTestId('checkin-card-qr');
    await expect(
      entry.getByRole('img', { name: "QR code to save a card for tonight's giving" }),
    ).toBeVisible();
    await expect(entry).toContainText("Saving a card for tonight's giving?");
    const url = new URL((await entry.getAttribute('data-url')) ?? '');
    expect(`${url.pathname}${url.search}`).toBe(`/events/${g.slug}/card?src=checkin`);
    await expectAccessibleBothModes(device.page);
    await device.context.close();

    // The guest's own phone: the card page, with its consent step (nothing saved yet).
    const guest = await phone(browser);
    await guest.page.goto(`${url.pathname}${url.search}`);
    await expect(guest.page.getByLabel('I authorize saving this card for tonight')).not.toBeChecked();
    await expect(guest.page.getByRole('button', { name: 'Save my card' })).toBeVisible();
    await guest.context.close();
  });

  test('the checkout box sends the buyer to save a card after paying', async ({ page, browser }) => {
    const g = await gala(page);
    const buyer = await phone(browser);
    const email = `buyer+${test.info().project.name}@example.test`;
    await buyer.page.goto(`/events/${g.slug}`);
    const box = buyer.page.getByLabel(/Save my card for tonight's giving/);
    await expect(box).not.toBeChecked();
    await pickOption(buyer.page.getByLabel('Quantity — Supporter'), '1');
    await buyer.page.getByLabel('Full name').fill('Box Buyer');
    await buyer.page.getByLabel('Email for your tickets').fill(email);
    await box.check();
    await continueToPayment(buyer.page, email);
    await buyer.page.getByRole('button', { name: 'Pay now (test)' }).click();
    await expect(buyer.page).toHaveURL(new RegExp(`/events/${g.slug}/card\\?src=checkout`));
    await expect(buyer.page.getByText('Thanks, your order is complete.')).toBeVisible();
    await expect(buyer.page.getByRole('button', { name: 'Save my card' })).toBeVisible();
    await expectAccessible(buyer.page);
    await buyer.context.close();
  });

  test('Arabic (RTL): the card page and the pledges page', async ({ page, browser }) => {
    const g = await gala(page);
    await page.goto(`/ar${g.base}/pledges`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'التعهّدات', level: 1 })).toBeVisible();
    await expectAccessibleBothModes(page);
    const guest = await phone(browser);
    await guest.page.goto(`/ar/rsvp/${encodeURIComponent(g.s.okafor.token)}/card`);
    await expect(guest.page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(
      guest.page.getByRole('heading', { name: 'احفظ بطاقة لتبرعات هذه الليلة', level: 1 }),
    ).toBeVisible();
    await guest.page.getByRole('button', { name: 'احفظ بطاقتي' }).click();
    await expect(guest.page.getByText('أدخل اسمك الكامل.')).toBeVisible();
    await expectAccessibleBothModes(guest.page);
    await guest.context.close();
  });
});
