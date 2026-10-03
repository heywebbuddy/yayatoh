import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  ageSession,
  codeForKey,
  confirmStepUp,
  expectAccessibleBothModes,
  newUser,
  pickOption,
  stepUpDialog,
} from './helpers.ts';

// Long journeys (two browsers, provider pages, axe in light and dark).
test.describe.configure({ timeout: 180_000 });

/**
 * M4.8f matching gifts: a sponsor's challenge match (window, ratio, cap) on the gala's Matching
 * gifts page, computed from confirmed gifts and shown on the Donations tab and the public giving
 * page; a refund brings it down; closing records the sponsor's pledge; the employer matching list
 * export; validation, empty states, viewers, the keyboard and Arabic RTL. Each test makes its own
 * org (projects run in parallel on one database).
 */

const stamp = () => `${Date.now().toString(36)}${test.info().project.name.split('-')[0]}`;

interface Gala {
  readonly org: string;
  readonly slug: string;
  readonly donations: string;
  readonly matches: string;
  readonly setupKey: string;
}

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
  const donations = `/o/${org}/e/${slug}/donations`;
  return { org, slug, donations, matches: `${donations}/matches`, setupKey: user.setupKey ?? '' };
}

/** A campaign whose own amounts go up to $25,000 (so one gift can meet the cap). */
async function addCampaign(page: Page, g: Gala, name: string) {
  await page.goto(g.donations);
  const form = page.getByRole('region', { name: 'Add campaign' });
  await form.getByLabel('Campaign name').fill(name);
  await form.getByLabel('Goal (USD)').fill('100000');
  await form.getByLabel('Smallest own amount (USD)').fill('10');
  await form.getByLabel('Largest own amount (USD)').fill('25000');
  await form.getByRole('button', { name: 'Add campaign' }).click();
  await expect(form.getByText('Campaign added.')).toBeVisible();
}

async function addMatch(page: Page, sponsor: string, cap = '25000', shownAs = sponsor) {
  const form = page.getByRole('region', { name: 'Add a match' });
  await form.getByLabel('Sponsor', { exact: true }).fill(sponsor);
  await form.getByLabel('Sponsor’s email').fill('giving@harbor.test');
  await form.getByLabel('Name on screens').fill(shownAs);
  await form.getByLabel('Cap (USD)').fill(cap);
  await form.getByRole('button', { name: 'Add match' }).click();
  await expect(form.getByText('Match added')).toBeVisible();
}

/** A donor gives an own amount on the giving page and pays on the fake provider's page. */
async function give(browser: Browser, g: Gala, amount: string, name: string, employer = '') {
  const ctx = await browser.newContext();
  const guest = await ctx.newPage();
  await guest.goto(`/events/${g.slug}/give`);
  await guest.getByLabel('Amount (USD)').fill(amount);
  await guest.getByRole('textbox', { name: 'Full name' }).fill(name);
  await guest.getByLabel('Email').fill(`${name.split(' ')[0]?.toLowerCase()}+${stamp()}@example.test`);
  if (employer) await guest.getByLabel('Employer (optional)').fill(employer);
  await guest.getByRole('radio', { name: 'Show my full name' }).check();
  await guest.getByRole('button', { name: /^Give \$/ }).click();
  await expect(guest).toHaveURL(/\/checkout\/fake\?/);
  await guest.getByRole('button', { name: /^Pay/ }).click();
  await expect(guest.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
  await ctx.close();
}

const matchCard = (page: Page, sponsor: string) =>
  page.getByTestId('matches').getByRole('listitem').filter({ hasText: sponsor });

test.describe('matching gifts (M4.8f)', () => {
  test('a 1:1 match capped at $25,000 stops at the cap; a refund reduces it; closing records the pledge', async ({
    page,
    browser,
  }) => {
    const g = await gala(page);
    const sponsor = `Harbor Bank ${stamp()}`;
    // Empty states first: no campaign, then no match.
    await page.goto(g.matches);
    await expect(page.getByRole('heading', { name: 'Matching gifts', level: 1 })).toBeVisible();
    await expect(page.getByText('Add a campaign first')).toBeVisible();
    await expect(page.getByText('No employers named yet')).toBeVisible();
    await expectAccessibleBothModes(page);
    await page.getByRole('link', { name: 'Go to Donations' }).click();
    await expect(page.getByRole('heading', { name: 'Donations', level: 1 })).toBeVisible();
    await addCampaign(page, g, 'Gala Fund');
    await page.getByRole('link', { name: 'Open matching gifts' }).click();
    await expect(page).toHaveURL(new RegExp(`${g.matches}$`));
    await expect(page.getByText('No matches yet')).toBeVisible();
    await addMatch(page, sponsor);
    const card = matchCard(page, sponsor);
    await expect(card.getByText('Every gift doubled up to $25,000.00')).toBeVisible();
    await expect(card.getByText('Live')).toBeVisible();
    await expect(card.getByText('$0.00 matched of $25,000.00')).toBeVisible();
    await expect(card.getByText(`On screens as ${sponsor} · giving@harbor.test`)).toBeVisible();
    await expect(card.getByText('$25,000.00 more in gifts unlocks the full match')).toBeVisible();
    await expectAccessibleBothModes(page);

    // The giving page announces it (the public name only, never the sponsor's email).
    const ctx = await browser.newContext();
    const guest = await ctx.newPage();
    await guest.goto(`/events/${g.slug}/give`);
    await expect(guest.getByText('Every gift doubled up to $25,000.00')).toBeVisible();
    await expect(guest.getByTestId('match-banner')).toHaveText(`Thanks to ${sponsor}. $0.00 matched so far.`);
    expect(await guest.content()).not.toContain('giving@harbor.test');
    await expectAccessibleBothModes(guest);
    await ctx.close();

    // $25,000 of gifts meets the cap exactly; one more gift changes nothing.
    await give(browser, g, '25000', 'Maya Major', 'Acme Corp');
    await page.reload();
    await expect(card.getByText('$25,000.00 matched of $25,000.00')).toBeVisible();
    await expect(card.getByText('The full match is reached.')).toBeVisible();
    await expect(card.getByText('1 confirmed gift · $25,000.00 given in the window')).toBeVisible();
    await give(browser, g, '100', 'Theo Small');
    await page.reload();
    await expect(card.getByText('$25,000.00 matched of $25,000.00')).toBeVisible();
    await expect(card.getByText('2 confirmed gifts · $25,100.00 given in the window')).toBeVisible();
    // The Donations tab shows it too.
    await page.goto(g.donations);
    await expect(page.getByTestId('matches-card')).toContainText(
      'Every gift doubled up to $25,000.00 $25,000.00 matched of $25,000.00',
    );

    // The host refunds $1,000 of the big gift: the match comes down to $24,100.
    await page.goto(`/o/${g.org}/e/${g.slug}/tickets-orders`);
    await page.getByRole('link', { name: 'Maya Major' }).click();
    const refund = page.getByRole('region', { name: 'Refund' });
    await pickOption(refund.getByLabel('Reason'), 'requested_by_customer');
    await refund.getByLabel('An amount (tickets stay valid)').check();
    await refund.getByLabel('Amount (USD)').fill('1000');
    await refund.getByRole('button', { name: 'Refund' }).click();
    const dialog = stepUpDialog(page);
    if (await dialog.isVisible().catch(() => false)) await confirmStepUp(page, codeForKey(g.setupKey));
    await expect(refund.getByText(/^Refunded\./)).toBeVisible();
    await page.goto(g.matches);
    await expect(card.getByText('$24,100.00 matched of $25,000.00')).toBeVisible();
    await expect(card.getByText('$900.00 more in gifts unlocks the full match')).toBeVisible();

    // Closing records the sponsor's pledge for what the match came to.
    await card.getByRole('button', { name: `Close ${sponsor}’s match and record the pledge` }).click();
    await expect(card.getByText('Closed')).toBeVisible();
    await expect(card.getByTestId('match-pledge')).toHaveText('Sponsor’s pledge: $24,100.00');
    await expect(card.getByRole('button', { name: /Cancel/ })).toHaveCount(0);
    await page.reload();
    await expect(card.getByTestId('match-pledge')).toHaveText('Sponsor’s pledge: $24,100.00');
    await expectAccessibleBothModes(page);
    // A closed match leaves the giving page.
    const after = await (await browser.newContext()).newPage();
    await after.goto(`/events/${g.slug}/give`);
    await expect(after.getByTestId('match-banner')).toHaveCount(0);

    // The employer matching list: a fresh step-up, then the CSV with the donor's employer.
    await expect(page.getByTestId('employer-count')).toContainText('1 paid gift names an employer.');
    await ageSession(page);
    await page.goto(g.matches);
    await page.getByRole('button', { name: 'Export employer list' }).click();
    await expect(stepUpDialog(page)).toBeVisible();
    await confirmStepUp(page, codeForKey(g.setupKey));
    const download = page.getByRole('link', { name: 'Download' });
    await expect(download).toBeVisible();
    const res = await page.request.get((await download.getAttribute('href')) ?? '');
    expect(res.status()).toBe(200);
    const csv = (await res.text()).replace(/^﻿/, '');
    expect(csv.split(/\r?\n/)[0]).toBe('Employer,Donor,Email,Date,Campaign,Amount');
    // Net of the $1,000 refund; donors without an employer are not listed.
    expect(csv).toMatch(/Acme Corp,Maya Major,maya\+[^,]+,\d{4}-\d{2}-\d{2},Gala Fund,"?\$24,000\.00"?/);
    expect(csv).not.toContain('Theo Small');
  });

  test('every validation message; scheduled and cancelled matches', async ({ page }) => {
    const g = await gala(page);
    await addCampaign(page, g, 'Checks Fund');
    await page.goto(g.matches);
    const form = page.getByRole('region', { name: 'Add a match' });
    const add = form.getByRole('button', { name: 'Add match' });
    await form.getByLabel('Cap (USD)').fill('25000');
    await add.click();
    await expect(form.getByText('Enter the sponsor’s name (up to 120 characters).')).toBeVisible();
    await expect(form.getByLabel('Sponsor', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await form.getByLabel('Sponsor', { exact: true }).fill('Checks Co');
    await form.getByLabel('Sponsor’s email').fill('not-an-email');
    await add.click();
    await expect(form.getByText('Enter a valid email address.')).toBeVisible();
    await form.getByLabel('Sponsor’s email').fill('');
    await form.getByLabel('Cap (USD)').fill('lots');
    await add.click();
    await expect(form.getByText('Enter a cap from 1.00 to 10,000,000.00.')).toBeVisible();
    await form.getByLabel('Cap (USD)').fill('25000');
    await form.getByLabel('Starts').fill('');
    await add.click();
    await expect(form.getByText('Enter a start date and time.')).toBeVisible();
    await form.getByLabel('Starts').fill('2031-05-01T20:00');
    await form.getByLabel('Ends').fill('2031-05-01T19:00');
    await add.click();
    await expect(form.getByText('The match must end after it starts.')).toBeVisible();
    await expectAccessibleBothModes(page);
    // A future window: scheduled, no Close until it starts; a 2:1 ratio; no public name.
    await form.getByLabel('Ends').fill('2031-05-01T23:00');
    await pickOption(form.getByLabel('Ratio'), '200');
    await add.click();
    await expect(form.getByText('Match added')).toBeVisible();
    const card = matchCard(page, 'Checks Co');
    await expect(card.getByText('Scheduled')).toBeVisible();
    await expect(card.getByText('Every gift tripled up to $25,000.00')).toBeVisible();
    await expect(card.getByText('On screens as a generous sponsor')).toBeVisible();
    await expect(card.getByRole('button', { name: /^Close/ })).toHaveCount(0);
    await card.getByRole('button', { name: 'Cancel Checks Co’s match' }).click();
    await expect(card.getByText('Cancelled')).toBeVisible();
    await page.reload();
    await expect(card.getByText('Cancelled')).toBeVisible();
    await expect(card.getByRole('button')).toHaveCount(0);
  });

  test('keyboard only: add a match and close it without a pointer', async ({ page }) => {
    const g = await gala(page);
    await addCampaign(page, g, 'Keys Fund');
    await page.goto(g.matches);
    const form = page.getByRole('region', { name: 'Add a match' });
    await form.getByLabel('Campaign').focus();
    await page.keyboard.press('Tab');
    await expect(form.getByLabel('Sponsor', { exact: true })).toBeFocused();
    await page.keyboard.type('Key Sponsor');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(form.getByLabel('Name on screens')).toBeFocused();
    await page.keyboard.type('The Keys');
    await page.keyboard.press('Tab');
    await expect(form.getByLabel('Ratio')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(form.getByLabel('Cap (USD)')).toBeFocused();
    await page.keyboard.type('500');
    await page.keyboard.press('Enter');
    await expect(form.getByText('Match added')).toBeVisible();
    // The paddle-raise console shows the running match with its public name.
    await page.goto(`${g.donations}/paddle-raise`);
    const onConsole = page.getByTestId('console-match');
    await expect(onConsole).toContainText('Every gift doubled up to $500.00');
    await expect(onConsole).toContainText('Thanks to The Keys. $0.00 matched of $500.00');
    await page.goto(g.matches);
    const card = matchCard(page, 'Key Sponsor');
    const close = card.getByRole('button', { name: 'Close Key Sponsor’s match and record the pledge' });
    await close.focus();
    await page.keyboard.press('Enter');
    await expect(card.getByTestId('match-pledge')).toHaveText(
      'It came to nothing, so no pledge was recorded.',
    );
  });

  test('a viewer sees matches but none of the actions, and cannot download the list', async ({
    page,
    browser,
  }) => {
    const g = await gala(page);
    await addCampaign(page, g, 'Viewer Fund');
    await page.goto(g.matches);
    await addMatch(page, 'Viewer Bank', '1000');
    const ctx = await browser.newContext();
    const viewer = await ctx.newPage();
    await newUser(viewer, { join: [`${g.org}:viewer`] });
    await viewer.goto(g.matches);
    await expect(viewer.getByRole('heading', { name: 'Matching gifts', level: 1 })).toBeVisible();
    await expect(
      viewer.getByText('You can see matches. Ask an organizer to add, close or cancel one.'),
    ).toBeVisible();
    await expect(
      matchCard(viewer, 'Viewer Bank').getByText('Every gift doubled up to $1,000.00'),
    ).toBeVisible();
    await expect(viewer.getByRole('region', { name: 'Add a match' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /Close|Cancel/ })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Export employer list' })).toHaveCount(0);
    await expectAccessibleBothModes(viewer);
    const res = await viewer.request.get(`${g.matches}/exports/01900000-0000-7000-8000-000000000000`);
    expect(res.status()).toBe(404);
    await ctx.close();
  });

  test('Arabic: the matching page and the giving page banner render right to left', async ({
    page,
    browser,
  }) => {
    const g = await gala(page);
    await addCampaign(page, g, 'RTL Fund');
    await page.goto(g.matches);
    await addMatch(page, 'RTL Bank', '5000', 'بنك الميناء');
    await page.goto(`/ar${g.matches}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'مضاعفة التبرعات', level: 1 })).toBeVisible();
    await expect(page.getByText('جارٍ')).toBeVisible();
    await expectAccessibleBothModes(page);
    const ctx = await browser.newContext();
    const guest = await ctx.newPage();
    await guest.goto(`/ar/events/${g.slug}/give`);
    await expect(guest.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(guest.getByTestId('match-banner')).toContainText('بفضل بنك الميناء.');
    await expectAccessibleBothModes(guest);
    await ctx.close();
  });
});
