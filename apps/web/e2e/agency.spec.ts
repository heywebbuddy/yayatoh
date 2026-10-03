import { type Browser, expect, type Page, test } from '@playwright/test';
import { expectAccessible, expectAccessibleBothModes, newUser, signIn, type TestUser } from './helpers.ts';

/**
 * M6.7a Agency v1: a client gives an agency access (and takes it back), the agency switches
 * between its clients with the "via Agency" badge, and its Clients | Events | Marketing | Reports
 * pages render from snapshots. Every test makes its own agency and client (per project, rerunnable).
 */

const VIEWER = 'jordan@lakeside.test';
const tag = (what: string) => `${what} ${test.info().project.name} ${Date.now()}`;

/** A throwaway agency org (dev only: `/api/dev/user` `org=agency`), its owner signed in on `page`. */
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

/** Opens the org switcher in the visible sidebar (the drawer below 1024 px). */
async function openSwitcher(page: Page) {
  const menu = page.locator('summary').filter({ hasText: 'Open menu' });
  if (await menu.isVisible()) await menu.click();
  const nav = page.locator('nav[aria-label="Main navigation"]:visible');
  await nav.locator('summary').filter({ hasText: 'Switch organization or event' }).click();
  return nav;
}

async function twoBrowsers(browser: Browser) {
  const agencyPage = await (await browser.newContext()).newPage();
  const clientPage = await (await browser.newContext()).newPage();
  return { agencyPage, clientPage };
}

/** The client (a fresh org with a published event) gives the agency access from its Agencies page. */
async function grantFromClient(
  page: Page,
  clientSlug: string,
  agencySlug: string,
  opts: { role?: 'Manage events' | 'Marketing' | 'View only'; finance?: boolean } = {},
) {
  await page.goto(`/o/${clientSlug}/agencies`);
  await page.getByLabel('Agency address').fill(agencySlug);
  await page.getByRole('radio', { name: opts.role ?? 'Manage events' }).check();
  if (opts.finance) await page.getByRole('checkbox', { name: 'Also let the agency read our money' }).check();
  await page.getByRole('button', { name: 'Give access' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'can now work in this organization.' }),
  ).toBeVisible();
}

test.describe('agency v1 (M6.7a)', () => {
  test.setTimeout(240_000);

  test('a client grants and revokes; the agency switches to the client with the badge and loses it on revoke', async ({
    browser,
  }) => {
    const { agencyPage: a, clientPage: c } = await twoBrowsers(browser);
    const agencyName = tag('Bloom Agency');
    const agency = await newAgency(a, agencyName);
    const client = await newUser(c, { org: true, event: 'published', twoFactor: true });
    const clientSlug = client.orgSlug ?? '';

    // The agency starts with no clients: the empty state says what to do next.
    await a.goto(`/o/${agency.orgSlug}/agency`);
    await expect(a.getByRole('heading', { name: 'Clients', level: 1 })).toBeVisible();
    await expect(a.getByText('No clients yet')).toBeVisible();
    await expect(a.getByText(`give access to ${agency.orgSlug}`)).toBeVisible();
    await expectAccessibleBothModes(a);

    // The client's Agencies page: empty, then validation messages on the field.
    await c.goto(`/o/${clientSlug}/agencies`);
    await expect(c.getByRole('heading', { name: 'Agencies', level: 1 })).toBeVisible();
    await expect(c.getByText('No agency has access. Give one access above')).toBeVisible();
    await expectAccessibleBothModes(c);
    await c.getByRole('button', { name: 'Give access' }).click();
    await expect(c.getByText('Enter the agency’s address.')).toBeVisible();
    await expect(c.getByLabel('Agency address')).toHaveAttribute('aria-invalid', 'true');
    await c.getByLabel('Agency address').fill(`nobody-${Date.now()}`);
    await c.getByRole('button', { name: 'Give access' }).click();
    await expect(c.getByText('No agency has this address. Check it with the agency.')).toBeVisible();
    // An organizer that isn't an agency can't be granted either.
    await c.getByLabel('Agency address').fill('lakeside-events');
    await c.getByRole('button', { name: 'Give access' }).click();
    await expect(c.getByText('No agency has this address. Check it with the agency.')).toBeVisible();
    await expectAccessible(c);

    await grantFromClient(c, clientSlug, agency.orgSlug);
    const row = c.getByRole('row').filter({ hasText: agencyName });
    await expect(row).toContainText('Manage events');
    await expect(row).toContainText('No access');
    await c.reload();
    await expect(c.getByRole('row').filter({ hasText: agencyName })).toContainText('Manage events');
    // A second grant to the same agency is refused on the field.
    await c.getByLabel('Agency address').fill(agency.orgSlug);
    await c.getByRole('button', { name: 'Give access' }).click();
    await expect(c.getByText('This agency already has access.')).toBeVisible();

    // The agency refreshes its snapshots: the client appears with its next event.
    await a.reload();
    const clientRow = a.getByRole('row').filter({ hasText: 'Test Org' });
    await expect(clientRow).toContainText('Not refreshed yet');
    await a.getByRole('button', { name: 'Refresh numbers' }).click();
    await expect(a.getByRole('status').filter({ hasText: 'Numbers refreshed for 1 client.' })).toBeVisible();
    await expect(a.getByRole('row').filter({ hasText: 'Test Org' })).toContainText('Manage events');
    await expect(a.getByRole('row').filter({ hasText: 'Test Org' })).not.toContainText('Not refreshed yet');
    await expectAccessibleBothModes(a);

    // The switcher lists the client under Clients, "via" the agency.
    const switcher = await openSwitcher(a);
    await expect(switcher.locator('p').filter({ hasText: /^Clients$/ })).toBeVisible();
    const switchTo = switcher.getByRole('link').filter({ hasText: `via ${agencyName}` });
    await expect(switchTo).toBeVisible();
    await switchTo.click();
    await expect(a).toHaveURL(new RegExp(`/o/${clientSlug}$`));
    const badge = a.getByTestId('via-agency');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(`via ${agencyName}`);
    await expectAccessibleBothModes(a);
    // Every page under the client shows it, event pages too.
    await a.goto(`/o/${clientSlug}/e/${client.eventSlug}`);
    await expect(a.getByTestId('via-agency')).toContainText(`via ${agencyName}`);
    // The client's own settings are not the agency's: hidden from the nav and refused directly.
    await expect(a.getByRole('link', { name: 'Agencies', exact: true })).toHaveCount(0);
    await a.goto(`/o/${clientSlug}/agencies`);
    await expect(a.getByText('Only owners and admins manage agencies')).toBeVisible();
    await a.goto(`/o/${clientSlug}/api-keys`);
    await expect(a.getByText('Only owners and admins manage API keys')).toBeVisible();
    await expect(a.getByRole('button', { name: 'Create key' })).toHaveCount(0);
    // Back to the agency.
    await a.goto(`/o/${clientSlug}`);
    await a.getByRole('link', { name: `Back to ${agencyName}` }).click();
    await expect(a).toHaveURL(new RegExp(`/o/${agency.orgSlug}/agency$`));

    // The client revokes: the agency loses access on its next request.
    await c.goto(`/o/${clientSlug}/agencies`);
    await c.getByRole('button', { name: `Revoke access for ${agencyName}` }).click();
    await expect(c.getByText(`${agencyName} no longer has access.`)).toBeVisible();
    await expect(c.getByRole('table', { name: 'Agencies with access' })).not.toContainText(agencyName);
    await expect(c.getByRole('table', { name: 'Past access' })).toContainText(agencyName);
    await expectAccessible(c);

    const gone = await a.goto(`/o/${clientSlug}`);
    expect(gone?.status()).toBe(404);
    await a.goto(`/o/${agency.orgSlug}/agency`);
    await expect(a.getByText('No clients yet')).toBeVisible();
  });

  test('the agency’s Events, Marketing and Reports render from snapshots; money only with the client’s opt-in', async ({
    browser,
  }) => {
    const { agencyPage: a, clientPage: c } = await twoBrowsers(browser);
    const agencyName = tag('Fern Agency');
    const agency = await newAgency(a, agencyName);
    const client = await newUser(c, { org: true, event: 'published', twoFactor: true });
    const clientSlug = client.orgSlug ?? '';
    await grantFromClient(c, clientSlug, agency.orgSlug, { role: 'View only' });

    await a.goto(`/o/${agency.orgSlug}/agency`);
    await a.getByRole('button', { name: 'Refresh numbers' }).click();
    await expect(a.getByRole('status').filter({ hasText: 'Numbers refreshed for 1 client.' })).toBeVisible();

    const tabs = a.getByRole('navigation', { name: 'Agency sections' });
    await tabs.getByRole('link', { name: 'Events' }).click();
    await expect(a).toHaveURL(/\/agency\/events$/);
    await expect(tabs.getByRole('link', { name: 'Events' })).toHaveAttribute('aria-current', 'page');
    const eventLink = a.getByRole('link', { name: /^Open .* at Test Org/ }).first();
    await expect(eventLink).toBeVisible();
    await expect(a.getByRole('table').first()).toContainText('Not shared');
    await expect(
      a.getByText('Gross sales show only for clients who let you read their money.'),
    ).toBeVisible();
    await expectAccessibleBothModes(a);

    await tabs.getByRole('link', { name: 'Marketing' }).click();
    await expect(a.getByRole('heading', { name: 'Marketing, last 30 days' })).toBeVisible();
    await expect(a.getByRole('row').filter({ hasText: 'Test Org' })).toBeVisible();
    await expectAccessibleBothModes(a);

    await tabs.getByRole('link', { name: 'Reports' }).click();
    await expect(a.getByRole('heading', { name: 'Totals across clients' })).toBeVisible();
    await expect(a.getByTestId('agency-total-clients')).toContainText('1');
    await expect(a.getByTestId('agency-total-revenue')).toContainText(
      'No client shares their money with you.',
    );
    await expectAccessibleBothModes(a);

    // The client opts in to money: after a refresh, gross sales show.
    await c.goto(`/o/${clientSlug}/agencies`);
    await c.getByRole('button', { name: `Let ${agencyName} read our money` }).click();
    await expect(c.getByRole('row').filter({ hasText: agencyName })).toContainText('Can read');
    await a.reload();
    await a.getByRole('button', { name: 'Refresh numbers' }).click();
    await expect(a.getByRole('status').filter({ hasText: 'Numbers refreshed for 1 client.' })).toBeVisible();
    await expect(a.getByTestId('agency-total-revenue')).toContainText('1 client shares their money with you');
    // Withdrawn: hidden again at once, before any refresh.
    await c.getByRole('button', { name: `Stop ${agencyName} reading our money` }).click();
    await expect(c.getByRole('row').filter({ hasText: agencyName })).toContainText('No access');
    await a.reload();
    await expect(a.getByTestId('agency-total-revenue')).toContainText(
      'No client shares their money with you.',
    );

    // The event opens in the client's console through the grant (a viewer: read-only).
    await tabs.getByRole('link', { name: 'Events' }).click();
    await a
      .getByRole('link', { name: /^Open .* at Test Org/ })
      .first()
      .click();
    await expect(a).toHaveURL(new RegExp(`/o/${clientSlug}/e/`));
    await expect(a.getByTestId('via-agency')).toContainText(`via ${agencyName}`);
  });

  test('keyboard only: grant, switch and revoke', async ({ browser }) => {
    const { agencyPage: a, clientPage: c } = await twoBrowsers(browser);
    const agencyName = tag('Key Agency');
    const agency = await newAgency(a, agencyName);
    const client = await newUser(c, { org: true, twoFactor: true });
    const clientSlug = client.orgSlug ?? '';

    await c.goto(`/o/${clientSlug}/agencies`);
    await c.getByLabel('Agency address').focus();
    await c.keyboard.type(agency.orgSlug);
    await c.keyboard.press('Tab');
    await expect(c.getByRole('radio', { name: 'Manage events' })).toBeFocused();
    await c.keyboard.press('ArrowDown');
    await expect(c.getByRole('radio', { name: 'Marketing' })).toBeChecked();
    await c.keyboard.press('Tab');
    await expect(c.getByRole('checkbox', { name: 'Also let the agency read our money' })).toBeFocused();
    await c.keyboard.press('Tab');
    await expect(c.getByRole('button', { name: 'Give access' })).toBeFocused();
    await c.keyboard.press('Enter');
    await expect(
      c.getByRole('status').filter({ hasText: 'can now work in this organization.' }),
    ).toBeVisible();
    await expect(c.getByRole('row').filter({ hasText: agencyName })).toContainText('Marketing');

    // The agency opens the client from its Clients page with the keyboard.
    await a.goto(`/o/${agency.orgSlug}/agency`);
    const open = a.getByRole('link', { name: /^Open Test Org/ });
    await open.focus();
    await a.keyboard.press('Enter');
    await expect(a).toHaveURL(new RegExp(`/o/${clientSlug}$`));
    await expect(a.getByTestId('via-agency')).toBeVisible();
    await a.getByRole('link', { name: `Back to ${agencyName}` }).focus();
    await a.keyboard.press('Enter');
    await expect(a).toHaveURL(new RegExp(`/o/${agency.orgSlug}/agency$`));

    await c.getByRole('button', { name: `Revoke access for ${agencyName}` }).focus();
    await c.keyboard.press('Enter');
    await expect(c.getByText(`${agencyName} no longer has access.`)).toBeVisible();
  });

  test('a viewer sees the list read-only; other orgs have no agency pages', async ({ page }) => {
    await signIn(page, VIEWER);
    await page.goto('/o/lakeside-events/agencies');
    await expect(page.getByRole('heading', { name: 'Agencies', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Give access' })).toHaveCount(0);
    await expect(page.getByLabel('Agency address')).toHaveCount(0);
    await expectAccessible(page);
    // The agency pages exist only in an agency org.
    const res = await page.goto('/o/lakeside-events/agency');
    expect(res?.status()).toBe(404);
  });

  test('Arabic: the agency pages and the client’s Agencies page render right to left', async ({
    browser,
  }) => {
    const { agencyPage: a, clientPage: c } = await twoBrowsers(browser);
    const agencyName = tag('Cedar Agency');
    const agency = await newAgency(a, agencyName);
    const client = await newUser(c, { org: true, twoFactor: true });
    const clientSlug = client.orgSlug ?? '';
    await grantFromClient(c, clientSlug, agency.orgSlug);

    await c.goto(`/ar/o/${clientSlug}/agencies`);
    await expect(c.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(c.getByRole('heading', { name: 'الوكالات', level: 1 })).toBeVisible();
    await expectAccessible(c);

    await a.goto(`/ar/o/${agency.orgSlug}/agency/reports`);
    await expect(a.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(a.getByRole('heading', { name: 'العملاء', level: 1 })).toBeVisible();
    await expectAccessible(a);
    await a.goto(`/ar/o/${clientSlug}`);
    await expect(a.getByTestId('via-agency')).toContainText(`عبر ${agencyName}`);
    await expectAccessible(a);
  });
});
