import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  continueToPayment,
  expectAccessible,
  expectAccessibleBothModes,
  newUser,
  pickOption,
  signIn,
  type TestUser,
} from './helpers.ts';

/**
 * M6.8a Agency v2 money (flag `agency_v2`, on in the e2e server): an agency offers to pay a client's
 * plan, the client accepts, a ticket sale earns the agency its commission, and a refund takes it
 * back; both sides read their commission statement. Every test makes its own agency and client.
 * Transfers at release and explicit transfer reversals are covered by
 * `packages/testing/tests/agency-money.int.test.ts` (the agency here has no payout account yet).
 */

const VIEWER = 'jordan@lakeside.test';
const tag = (what: string) => `${what} ${test.info().project.name} ${Date.now()}`;

async function newAgency(page: Page, name: string): Promise<TestUser & { orgSlug: string }> {
  const form = new URLSearchParams({ org: 'agency', orgName: name, twoFactor: '1' });
  const res = await page.request.post('/api/dev/user', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  });
  expect(res.status()).toBe(200);
  const user = (await res.json()) as TestUser;
  if (!user.orgSlug) throw new Error('no agency org');
  return { ...user, orgSlug: user.orgSlug };
}

async function twoBrowsers(browser: Browser) {
  const agencyPage = await (await browser.newContext()).newPage();
  const clientPage = await (await browser.newContext()).newPage();
  return { agencyPage, clientPage };
}

/** Press a button with the keyboard only (focus, then Enter). */
async function pressButton(page: Page, name: string | RegExp, scope = page.locator('body')) {
  const button = scope.getByRole('button', { name, exact: typeof name === 'string' });
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
}

async function grantFromClient(page: Page, clientSlug: string, agencySlug: string) {
  await page.goto(`/o/${clientSlug}/agencies`);
  await page.getByLabel('Agency address').fill(agencySlug);
  await page.getByRole('radio', { name: 'Manage events' }).check();
  await page.getByRole('button', { name: 'Give access' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'can now work in this organization.' }),
  ).toBeVisible();
}

const drain = async (page: Page, org: string) => {
  const res = await page.request.post('/api/dev/outbox/drain', { form: { org } });
  expect(res.status()).toBe(200);
};

/** A guest buys one Supporter ticket ($15) on the client's published event. */
async function buySupporter(browser: Browser, eventSlug: string, buyer: string, email: string) {
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/events/${eventSlug}`);
  await pickOption(guest.getByLabel('Quantity — Supporter'), '1');
  await guest.getByLabel('Full name').fill(buyer);
  await guest.getByLabel('Email for your tickets').fill(email);
  await continueToPayment(guest, email);
  await guest.getByRole('button', { name: /^Pay/ }).click();
  await expect(guest).toHaveURL(/\/orders\/[A-Za-z0-9_-]{43}$/);
  await guest.close();
}

test.describe('agency v2 money (M6.8a)', () => {
  test.setTimeout(300_000);

  test('a client opts into agency billing, a sale pays commission, a refund reverses it; both statements', async ({
    browser,
  }) => {
    const { agencyPage: a, clientPage: c } = await twoBrowsers(browser);
    const agencyName = tag('Fern Agency');
    const agency = await newAgency(a, agencyName);
    const client = await newUser(c, { org: true, event: 'published', twoFactor: true });
    const clientSlug = client.orgSlug ?? '';
    const eventSlug = client.eventSlug ?? '';
    await grantFromClient(c, clientSlug, agency.orgSlug);

    // The client has no offer yet: the section says what happens next.
    await c.goto(`/o/${clientSlug}/agencies`);
    const billing = c.getByRole('region', { name: 'Agency billing' });
    await expect(billing.getByText('No agency offers to pay your plan.')).toBeVisible();
    await expect(billing.getByText('No commission yet.')).toBeVisible();

    // The agency's Billing tab: the client is listed, not offered; one primary action per row.
    await a.goto(`/o/${agency.orgSlug}/agency`);
    await a.getByRole('link', { name: 'Billing', exact: true }).focus();
    await a.keyboard.press('Enter');
    await expect(a).toHaveURL(new RegExp(`/o/${agency.orgSlug}/agency/billing$`));
    const clients = a.getByRole('table', { name: 'Clients' });
    // A fresh agency with one client: the table's one body row.
    const row = clients.getByRole('row').nth(1);
    await expect(row.getByText('Not offered')).toBeVisible();
    await expect(a.getByText('No commission yet. It appears after a client')).toBeVisible();
    await expectAccessibleBothModes(a);
    await pressButton(a, /^Offer to pay the plan of /, row);
    await expect(
      a.getByRole('alert').or(a.getByRole('status')).filter({ hasText: 'Offer sent to' }),
    ).toBeVisible();
    await expect(row.getByText('Offered')).toBeVisible();

    // The client accepts by keyboard (owners and admins; step-up is fresh after sign-in).
    await c.reload();
    const offer = billing.getByTestId('agency-billing-offer');
    await expect(offer.getByText(`${agencyName} offers to pay your plan`)).toBeVisible();
    await expect(offer.getByText('receive 10% of what each ticket sale pays you')).toBeVisible();
    await expectAccessibleBothModes(c);
    await pressButton(c, `Accept the offer from ${agencyName} to pay your plan`, offer);
    await expect(c.getByText('Agency billing is on: the agency now pays your plan.')).toBeVisible();
    const current = billing.getByTestId('agency-billing-current');
    await expect(current.getByText(`${agencyName} pays your plan`)).toBeVisible();
    await expect(current.getByText('In force')).toBeVisible();
    // Persists after reload.
    await c.reload();
    await expect(current.getByText('In force')).toBeVisible();

    // A guest buys a ticket: the agency earns its commission (10% of the organizer's share).
    const stamp = `${Date.now()}${test.info().project.name.slice(0, 1)}`;
    const buyer = `Cam Commission ${stamp}`;
    await buySupporter(browser, eventSlug, buyer, `cam+${stamp}@example.test`);
    await c.reload();
    const statement = c.getByRole('region', { name: 'Commission statement' });
    const entries = statement.getByRole('table', { name: 'Commission entries' });
    await expect(entries.getByRole('row').filter({ hasText: 'Commission on a sale' })).toBeVisible();
    await expect(statement.getByTestId('commission-earned-USD')).not.toContainText('$0.00');
    await expect(statement.getByTestId('commission-pending-USD')).not.toContainText('$0.00');

    // The client refunds the ticket: the whole commission comes back (in proportion to the refund).
    await c.goto(`/o/${clientSlug}/e/${eventSlug}/tickets-orders`);
    await c.getByRole('link', { name: buyer }).click();
    const form = c.getByRole('region', { name: 'Refund', exact: true });
    await pickOption(form.getByLabel('Reason'), 'duplicate');
    await form
      .getByRole('checkbox', { name: /#\d+ · Supporter/ })
      .first()
      .check();
    await form.getByRole('button', { name: 'Refund' }).click();
    // A full refund: the order's history shows it (the refund form goes once nothing is left).
    await expect(c.getByText('Refund completed').first()).toBeVisible();
    await c.goto(`/o/${clientSlug}/agencies`);
    await expect(entries.getByRole('row').filter({ hasText: 'Taken back after a refund' })).toBeVisible();
    await expect(statement.getByTestId('commission-earned-USD')).toContainText('$0.00');
    await expectAccessible(c);

    // The agency's statement (its own mirror journals) shows the same movements for its client.
    await drain(c, clientSlug);
    await a.reload();
    const aEntries = a.getByRole('table', { name: 'Commission entries' });
    await expect(aEntries.getByRole('row').filter({ hasText: 'Commission on a sale' })).toBeVisible();
    await expect(aEntries.getByRole('row').filter({ hasText: 'Taken back after a refund' })).toBeVisible();
    await expect(a.getByTestId('commission-earned-USD')).toContainText('$0.00');
    await expect(clients.getByRole('row').filter({ hasText: 'Paying · 10% commission' })).toBeVisible();
    await expectAccessibleBothModes(a);

    // The client stops agency billing (one click, no step-up): its own plan applies again.
    await c.goto(`/o/${clientSlug}/agencies`);
    await pressButton(c, 'Stop agency billing');
    await expect(c.getByText('Agency billing stopped. Your own plan applies again.')).toBeVisible();
    await expect(billing.getByTestId('agency-billing-current')).toHaveCount(0);
    // The agency withdraws its offer.
    await a.goto(`/o/${agency.orgSlug}/agency/billing`);
    await pressButton(a, /^Withdraw the offer to /);
    await expect(a.getByText(/Offer to .* withdrawn\./)).toBeVisible();
    await expect(clients.getByRole('row').filter({ hasText: 'Not offered' })).toBeVisible();
    // RTL renders of both screens (last: the locale sticks to the session).
    await a.goto(`/ar/o/${agency.orgSlug}/agency/billing`);
    await expect(a.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(a.getByRole('heading', { name: 'كشف العمولات' })).toBeVisible();
    await expectAccessible(a);
    await c.goto(`/ar/o/${clientSlug}/agencies`);
    await expect(c.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(c.getByRole('heading', { name: 'فوترة الوكالة' })).toBeVisible();
    await expectAccessible(c);
  });

  test('an agency user acting in the client never sees its billing or money; the agency pages stay its own', async ({
    browser,
  }) => {
    const { agencyPage: a, clientPage: c } = await twoBrowsers(browser);
    const agency = await newAgency(a, tag('Moss Agency'));
    const client = await newUser(c, { org: true, event: 'published', twoFactor: true });
    const clientSlug = client.orgSlug ?? '';
    await grantFromClient(c, clientSlug, agency.orgSlug);
    // Through its grant (no finance opt-in) the agency gets the no-access state on Agencies, and the
    // client's money pages refuse it.
    await a.goto(`/o/${clientSlug}/agencies`);
    await expect(a.getByText('Only owners and admins manage agencies')).toBeVisible();
    await expect(a.getByRole('region', { name: 'Agency billing' })).toHaveCount(0);
    await a.goto(`/o/${clientSlug}/payouts`);
    await expect(a.getByRole('region', { name: 'Settlements' })).toHaveCount(0);
    await expect(a.getByRole('region', { name: 'Commission statement' })).toHaveCount(0);
    // The Billing tab exists only in agency orgs: a client org (or any other) is a 404.
    const notAgency = await c.goto(`/o/${clientSlug}/agency/billing`);
    expect(notAgency?.status()).toBe(404);
  });

  test('a viewer sees agency billing read-only, with no statement and no actions', async ({ page }) => {
    await signIn(page, VIEWER);
    await page.goto('/o/lakeside-events/agencies');
    const billing = page.getByRole('region', { name: 'Agency billing' });
    await expect(billing.getByText('No agency offers to pay your plan.')).toBeVisible();
    await expect(billing.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Commission statement' })).toHaveCount(0);
    await expectAccessible(page);
  });
});
