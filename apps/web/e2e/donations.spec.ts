import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import {
  ageSession,
  codeForKey,
  confirmStepUp,
  expectAccessibleBothModes,
  newUser,
  pickOption,
  stepUpDialog,
} from './helpers.ts';

// Batch 3h merge: axe runs in light and dark on every screen now (twice the checks), so these long
// journeys get more than the default 30 s.
test.describe.configure({ timeout: 120_000 });

/**
 * M4.8a donations: the gala Donations tab (campaigns, levels, gifts, CSV), the public giving page
 * (levels or an own amount, fee cover, tribute, how the name appears, employer), the payment as a
 * direct charge on the connected account with application fee 0 (the fake provider's page shows
 * the charge in its URL), donor privacy, an unconnected org, viewers, the keyboard and Arabic RTL.
 * Each test runs in an org of its own (projects run in parallel on one database).
 */

const stamp = () => `${Date.now().toString(36)}${test.info().project.name.split('-')[0]}`;

interface Gala {
  readonly org: string;
  readonly slug: string;
  readonly base: string;
  readonly setupKey: string;
}

/** A new owner (two-step on) with a published gala event; `connected` adds an active payout account. */
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
  return { org, slug, base: `/o/${org}/e/${slug}/donations`, setupKey: user.setupKey ?? '' };
}

async function addCampaign(
  page: Page,
  name: string,
  goal = '25000',
  limits: [string, string] = ['10', '5000'],
) {
  const form = page.getByRole('region', { name: 'Add campaign' });
  await form.getByLabel('Campaign name').fill(name);
  await form.getByLabel('Goal (USD)').fill(goal);
  await form.getByLabel('Smallest own amount (USD)').fill(limits[0]);
  await form.getByLabel('Largest own amount (USD)').fill(limits[1]);
  await form.getByRole('button', { name: 'Add campaign' }).click();
  await expect(form.getByText('Campaign added.')).toBeVisible();
}

async function addLevel(page: Page, campaign: string, name: string, amount: string, description = '') {
  await page.getByText(`Add a level to ${campaign}`).click();
  const card = page.getByRole('listitem').filter({ hasText: `Add a level to ${campaign}` });
  await card.getByLabel('Level name').fill(name);
  await card.getByLabel('Amount (USD)', { exact: true }).fill(amount);
  if (description) await card.getByLabel('What it does').fill(description);
  await card.getByRole('button', { name: 'Add level' }).click();
  await expect(card.getByText(`$${Number(amount).toLocaleString('en-US')}.00 · ${name}`)).toBeVisible();
}

/** A donor's browser (no session). */
async function donor(context: BrowserContext): Promise<Page> {
  return context.newPage();
}

test.describe('donations (M4.8a)', () => {
  test('the host sets up a campaign and levels, with every validation message', async ({ page }) => {
    const g = await gala(page);
    await page.goto(g.base);
    await expect(page.getByRole('heading', { name: 'Donations', level: 1 })).toBeVisible();
    await expect(page.getByText('No campaigns yet')).toBeVisible();
    await expect(page.getByText('No gifts yet. Share the giving page to start.')).toBeVisible();
    await expect(page.getByText('Connect Stripe to accept gifts')).toHaveCount(0);
    await expectAccessibleBothModes(page);

    const form = page.getByRole('region', { name: 'Add campaign' });
    await form.getByRole('button', { name: 'Add campaign' }).click();
    await expect(form.getByText('Enter a name (up to 120 characters).')).toBeVisible();
    await expect(form.getByLabel('Campaign name')).toHaveAttribute('aria-invalid', 'true');
    await form.getByLabel('Campaign name').fill('Scholarship Fund');
    await form.getByLabel('Goal (USD)').fill('lots');
    await form.getByRole('button', { name: 'Add campaign' }).click();
    await expect(form.getByText('Enter an amount, for example 25 or 25.50.')).toBeVisible();
    await form.getByLabel('Goal (USD)').fill('25000');
    await form.getByLabel('Smallest own amount (USD)').fill('100');
    await form.getByLabel('Largest own amount (USD)').fill('10');
    await form.getByRole('button', { name: 'Add campaign' }).click();
    await expect(form.getByText('The largest own amount must be at least the smallest.')).toBeVisible();
    await form.getByLabel('Largest own amount (USD)').fill('5000');
    await form.getByRole('button', { name: 'Add campaign' }).click();
    await expect(form.getByText('Campaign added.')).toBeVisible();
    await expect(page.getByText('$0.00 raised of $25,000.00 · 0 gifts')).toBeVisible();
    await expect(page.getByText('Own amounts from $100.00 to $5,000.00')).toBeVisible();
    // The same name again is refused.
    await addCampaignExpectError(
      page,
      'Scholarship Fund',
      'This event already has a campaign with that name.',
    );

    await addLevel(page, 'Scholarship Fund', 'Classroom', '1000', 'Funds a classroom');
    // A second level with the same amount is refused.
    const card = page.getByRole('listitem').filter({ hasText: 'Add a level to Scholarship Fund' });
    await card.getByLabel('Level name').fill('Twin');
    await card.getByLabel('Amount (USD)', { exact: true }).fill('1000');
    await card.getByRole('button', { name: 'Add level' }).click();
    await expect(card.getByText('This campaign already has a level with that amount.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the giving page' })).toHaveAttribute(
      'href',
      `/events/${g.slug}/give`,
    );
    await expectAccessibleBothModes(page);

    // Persisted; a level can be removed again.
    await page.reload();
    await expect(page.getByText('$1,000.00 · Classroom')).toBeVisible();
    await addLevel(page, 'Scholarship Fund', 'Book', '20');
    await page.getByRole('button', { name: 'Remove Book' }).click();
    await expect(page.getByText('$20.00 · Book')).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('$20.00 · Book')).toHaveCount(0);

    // Closing the campaign takes it off the giving page.
    await page.getByText('Edit Scholarship Fund').click();
    const edit = page.getByRole('listitem').filter({ hasText: 'Edit Scholarship Fund' });
    await pickOption(edit.getByLabel('Status'), 'closed');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(edit.getByText('Saved.')).toBeVisible();
    await page.goto(`/events/${g.slug}/give`);
    await expect(page.getByText('No campaign is open right now')).toBeVisible();
  });

  test('a donor gives with a level, the fee cover and a tribute; the charge is exact, direct and fee-free', async ({
    page,
    browser,
  }) => {
    const g = await gala(page);
    const name = `Scholarship Fund ${stamp()}`;
    await page.goto(g.base);
    await addCampaign(page, name);
    await addLevel(page, name, 'Classroom', '1000', 'Funds a classroom');

    const ctx = await browser.newContext();
    const guest = await donor(ctx);
    await guest.goto(`/events/${g.slug}/give`);
    await expect(guest.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(guest.getByText('$0.00 raised of $25,000.00')).toBeVisible();
    await expect(guest.getByText('Be the first to give')).toBeVisible();
    await expectAccessibleBothModes(guest);

    // Every validation, in page order; the field to fix gets focus.
    const give = guest.getByRole('button', { name: /^Give/ });
    await give.click();
    await expect(guest.getByText('Choose a level or another amount.')).toBeVisible();
    await expect(guest.getByRole('radio', { name: /Classroom/ })).toBeFocused();
    await guest.getByRole('radio', { name: /Classroom/ }).check();
    await expect(guest.getByText('You give $1,000.00')).toBeVisible();
    await guest
      .getByRole('checkbox', {
        name: 'Add $30.18 to cover the processing fee, so all of my gift goes to the cause',
      })
      .check();
    await expect(guest.getByText('You give $1,030.18')).toBeVisible();
    await give.click();
    await expect(guest.getByText('Enter your name.')).toBeVisible();
    await guest.getByRole('textbox', { name: 'Full name' }).fill('Dana Q. Donor');
    await guest.getByLabel('Email').fill('not-an-email');
    await give.click();
    await expect(guest.getByText('Enter a valid email address.')).toBeVisible();
    await guest.getByLabel('Email').fill(`dana+${stamp()}@example.test`);
    await give.click();
    await expect(guest.getByText('Choose how your name appears.')).toBeVisible();
    await guest.getByRole('radio', { name: 'Give anonymously' }).check();
    await pickOption(guest.getByLabel('Dedication'), 'memory');
    await give.click();
    await expect(guest.getByText('Enter the name of the person you are honoring.')).toBeVisible();
    await guest.getByLabel('In memory of (name)').fill('Grandpa Joe');
    await guest.getByLabel('Let someone know (optional)').fill('The Joe family');
    await guest.getByLabel('Note to them (optional)').fill('With love.');
    await guest.getByLabel('Employer (optional)').fill('Acme Corp');
    await expectAccessibleBothModes(guest);
    await guest.getByRole('button', { name: 'Give $1,030.18' }).click();

    // The fake provider's page: exactly gift + cover, on the connected account, application fee 0.
    await expect(guest).toHaveURL(/\/checkout\/fake\?/);
    const charge = new URL(guest.url()).searchParams;
    expect(charge.get('amount')).toBe('103018');
    expect(charge.get('currency')).toBe('USD');
    expect(charge.get('acct')).toMatch(/^fakeacct_/);
    expect(charge.get('fee')).toBe('0');
    await guest.getByRole('button', { name: /^Pay/ }).click();
    await expect(guest).toHaveURL(new RegExp(`/events/${g.slug}/give/thanks\\?g=`));
    await expect(guest.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
    await expect(guest.getByText(`Your gift of $1,000.00 to ${name} was received.`)).toBeVisible();
    await expect(
      guest.getByText('You also covered $30.18 in processing fees.', { exact: false }),
    ).toBeVisible();
    await expectAccessibleBothModes(guest);

    // A second donor: an own amount, first name only, no cover; own-amount limits first.
    await guest.goto(`/events/${g.slug}/give`);
    await guest.getByLabel('Amount (USD)').fill('5');
    await guest.getByRole('textbox', { name: 'Full name' }).fill('Robin Giver');
    await guest.getByLabel('Email').fill(`robin+${stamp()}@example.test`);
    await guest.getByRole('radio', { name: 'Show my first name only' }).check();
    await guest.getByRole('button', { name: 'Give $5.00' }).click();
    await expect(guest.getByText('The smallest gift is $10.00.')).toBeVisible();
    await expect(guest.getByLabel('Amount (USD)')).toBeFocused();
    await guest.getByLabel('Amount (USD)').fill('6000');
    await guest.getByRole('button', { name: 'Give $6,000.00' }).click();
    await expect(guest.getByText('The largest gift online is $5,000.00.')).toBeVisible();
    await guest.getByLabel('Amount (USD)').fill('abc');
    await guest.getByRole('button', { name: 'Give' }).click();
    await expect(guest.getByText('Enter an amount, for example 25 or 25.50.').first()).toBeVisible();
    await guest.getByLabel('Amount (USD)').fill('25');
    await guest.getByRole('button', { name: 'Give $25.00' }).click();
    await expect(guest).toHaveURL(/\/checkout\/fake\?/);
    expect(new URL(guest.url()).searchParams.get('amount')).toBe('2500');
    expect(new URL(guest.url()).searchParams.get('fee')).toBe('0');
    await guest.getByRole('button', { name: /^Pay/ }).click();
    await expect(guest.getByRole('heading', { name: 'Thank you!' })).toBeVisible();

    // The public page: totals and counts only, never a donor, a tribute or an employer.
    await guest.goto(`/events/${g.slug}/give`);
    await expect(guest.getByText('$1,025.00 raised of $25,000.00')).toBeVisible();
    await expect(guest.getByText('2 gifts so far')).toBeVisible();
    const html = await guest.content();
    for (const secret of ['Dana', 'Robin', 'Grandpa Joe', 'Joe family', 'With love', 'Acme'])
      expect(html).not.toContain(secret);

    // The host: the anonymous gift as "Anonymous", the other by first name; totals and fee covers.
    await page.goto(g.base);
    await expect(page.getByText('$1,025.00 raised of $25,000.00 · 2 gifts')).toBeVisible();
    await expect(page.getByText('Donors also covered $30.18 in processing fees.')).toBeVisible();
    const gifts = page.getByRole('region', { name: 'Paid gifts' });
    const anon = gifts.getByRole('row').filter({ hasText: '$1,000.00' });
    await expect(anon).toContainText('Anonymous');
    await expect(anon).toContainText('In memory of Grandpa Joe');
    await expect(anon).toContainText('$30.18');
    await expect(anon).not.toContainText('Dana');
    await expect(gifts.getByRole('row').filter({ hasText: '$25.00' })).toContainText('Robin');
    await expect(gifts.getByRole('row').filter({ hasText: '$25.00' })).not.toContainText('Giver');
    await expectAccessibleBothModes(page);

    // The CSV export asks for a fresh step-up, then lists the donor as they are (the host's own list).
    await ageSession(page);
    await page.goto(g.base);
    await page.getByRole('button', { name: 'Export gifts (CSV)' }).click();
    await expect(stepUpDialog(page)).toBeVisible();
    await confirmStepUp(page, codeForKey(g.setupKey));
    const download = page.getByRole('link', { name: 'Download' });
    await expect(download).toBeVisible();
    const res = await page.request.get((await download.getAttribute('href')) ?? '');
    expect(res.status()).toBe(200);
    const csv = await res.text();
    expect(csv).toContain('Shown as');
    expect(csv).toContain('Dana Q. Donor');
    expect(csv).toContain('Anonymous,Acme Corp,In memory of,Grandpa Joe,The Joe family,With love.');
    expect(csv).toContain(',Robin,');
    await ctx.close();
  });

  test('keyboard only: a donor gives without a pointer', async ({ page, browser }) => {
    const g = await gala(page);
    const name = `Keyboard Fund ${stamp()}`;
    await page.goto(g.base);
    await addCampaign(page, name);
    await addLevel(page, name, 'Desk', '50');
    const ctx = await browser.newContext();
    const guest = await donor(ctx);
    await guest.goto(`/events/${g.slug}/give`);
    const level = guest.getByRole('radio', { name: /Desk/ });
    await level.focus();
    await guest.keyboard.press('Space');
    await expect(level).toBeChecked();
    await guest.keyboard.press('Tab');
    await expect(guest.getByLabel('Amount (USD)')).toBeFocused();
    await guest.keyboard.press('Tab');
    const cover = guest.getByRole('checkbox', { name: /cover the processing fee/ });
    await expect(cover).toBeFocused();
    await guest.keyboard.press('Space');
    await expect(cover).toBeChecked();
    await guest.keyboard.press('Tab');
    await expect(guest.getByRole('textbox', { name: 'Full name' })).toBeFocused();
    await guest.keyboard.type('Kay Board');
    await guest.keyboard.press('Tab');
    await guest.keyboard.type(`kay+${stamp()}@example.test`);
    await guest.keyboard.press('Tab');
    await expect(guest.getByLabel('Employer (optional)')).toBeFocused();
    await guest.keyboard.press('Tab');
    await expect(guest.getByRole('radio', { name: 'Show my full name' })).toBeFocused();
    await guest.keyboard.press('Space');
    await guest.keyboard.press('ArrowDown');
    await expect(guest.getByRole('radio', { name: 'Show my first name only' })).toBeChecked();
    // M4.8d: the screen opt-in follows (off by default), reachable and togglable by keyboard.
    await guest.keyboard.press('Tab');
    const onScreen = guest.getByRole('checkbox', { name: 'Thank me by name on the screen in the room' });
    await expect(onScreen).toBeFocused();
    await expect(onScreen).not.toBeChecked();
    await guest.keyboard.press('Space');
    await expect(onScreen).toBeChecked();
    await guest.keyboard.press('Tab');
    await expect(guest.getByLabel('Dedication')).toBeFocused();
    await guest.keyboard.press('Tab');
    await expect(guest.getByRole('button', { name: /^Give \$51\.81$/ })).toBeFocused();
    await guest.keyboard.press('Enter');
    await expect(guest).toHaveURL(/\/checkout\/fake\?/);
    expect(new URL(guest.url()).searchParams.get('amount')).toBe('5181');
    await guest.getByRole('button', { name: /^Pay/ }).focus();
    await guest.keyboard.press('Enter');
    await expect(guest.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
    await ctx.close();
  });

  test('an org without a connected account: the tab asks to connect Stripe; the page is closed', async ({
    page,
    browser,
  }) => {
    const g = await gala(page, false);
    await page.goto(g.base);
    await expect(page.getByText('Connect Stripe to accept gifts')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Set up payouts' })).toHaveAttribute(
      'href',
      `/o/${g.org}/payouts`,
    );
    // Campaigns can still be prepared; the giving page link stays hidden.
    await addCampaign(page, 'Waiting Fund');
    await expect(page.getByRole('link', { name: 'Open the giving page' })).toHaveCount(0);
    await expectAccessibleBothModes(page);
    const ctx = await browser.newContext();
    const guest = await donor(ctx);
    await guest.goto(`/events/${g.slug}/give`);
    await expect(guest.getByText('Online giving isn’t open for this event')).toBeVisible();
    await expect(guest.getByRole('button', { name: /^Give/ })).toHaveCount(0);
    await expect(guest.getByText('Waiting Fund')).toHaveCount(0);
    await expectAccessibleBothModes(guest);
    await ctx.close();
  });

  test('a viewer sees the tab but none of its write actions, and cannot download exports', async ({
    page,
    browser,
  }) => {
    const g = await gala(page);
    await page.goto(g.base);
    await addCampaign(page, 'Viewer Fund');
    await addLevel(page, 'Viewer Fund', 'Chair', '100');
    const ctx = await browser.newContext();
    const viewer = await ctx.newPage();
    await newUser(viewer, { join: [`${g.org}:viewer`] });
    await viewer.goto(g.base);
    await expect(viewer.getByRole('heading', { name: 'Donations', level: 1 })).toBeVisible();
    await expect(
      viewer.getByText('You can view donations. Ask an owner or admin to change campaigns.'),
    ).toBeVisible();
    await expect(viewer.getByText('$100.00 · Chair')).toBeVisible();
    await expect(viewer.getByRole('region', { name: 'Add campaign' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /Remove/ })).toHaveCount(0);
    await expect(viewer.getByText(/Add a level to/)).toHaveCount(0);
    await expect(viewer.getByText(/^Edit /)).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Export gifts (CSV)' })).toHaveCount(0);
    // Not the payouts link either (only those who manage payouts get it).
    await expectAccessibleBothModes(viewer);
    const res = await viewer.request.get(`${g.base}/exports/01900000-0000-7000-8000-000000000000`);
    expect(res.status()).toBe(404);
    await ctx.close();
  });

  test('Arabic: the giving page and the tab render right to left', async ({ page, browser }) => {
    const g = await gala(page);
    await page.goto(g.base);
    await addCampaign(page, 'RTL Fund');
    await page.goto(`/ar${g.base}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'التبرعات', level: 1 })).toBeVisible();
    await expectAccessibleBothModes(page);
    const ctx = await browser.newContext();
    const guest = await donor(ctx);
    await guest.goto(`/ar/events/${g.slug}/give`);
    await expect(guest.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(guest.getByRole('heading', { name: 'RTL Fund', level: 1 })).toBeVisible();
    await expect(guest.getByText('اختر مبلغًا', { exact: true })).toBeVisible();
    await guest.getByRole('button', { name: 'تبرّع' }).click();
    await expect(guest.getByText('اختر مستوى أو مبلغًا آخر.')).toBeVisible();
    await expectAccessibleBothModes(guest);
    await ctx.close();
  });
});

/** Submit the add-campaign form with `name` and expect `message`. */
async function addCampaignExpectError(page: Page, name: string, message: string) {
  const form = page.getByRole('region', { name: 'Add campaign' });
  await form.getByLabel('Campaign name').fill(name);
  await form.getByLabel('Goal (USD)').fill('1000');
  await form.getByRole('button', { name: 'Add campaign' }).click();
  await expect(form.getByText(message)).toBeVisible();
}
