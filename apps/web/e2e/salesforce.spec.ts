import { expect, type Page, test } from '@playwright/test';
import {
  expectAccessible,
  expectAccessibleBothModes,
  expectPicked,
  newUser,
  pickOption,
  pickWithKeyboard,
  signIn,
} from './helpers.ts';

/**
 * M6.5b Salesforce through the real console against the fake Salesforce org (the fake
 * IntegrationAuth port): connect with the fake OAuth consent, run a sync and see its results (runs,
 * records linked per object: people, the event's campaign), map fields (a refused save, a saved
 * version that survives a reload), find the Salesforce contact without an email in the errors
 * inbox, fix it at the source and retry it; keyboard only; axe in both themes; Arabic RTL; viewers
 * are refused.
 */

/** The fake org's seeded contact without an email (`SALESFORCE_BAD_RECORD`). */
const BAD_RECORD = '003FAKE00000000003';

/** A fresh org with one published event, whose owner is signed in on `page`. */
async function ownOrg(page: Page): Promise<string> {
  const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
  return owner.orgSlug as string;
}

/** Run the org's due syncs now (what the worker does). */
async function runSyncs(page: Page, org: string) {
  const res = await page.request.post('/api/dev/integrations/run', { form: { org } });
  expect(res.ok()).toBe(true);
}

/** Act in the fake Salesforce org: `fix` gives the contact without an email one. */
async function inSalesforce(page: Page, connection: string, action: 'fix' | 'revoke') {
  const res = await page.request.post('/api/dev/integrations/fake', { form: { connection, action } });
  expect(res.ok()).toBe(true);
}

async function connectSalesforce(page: Page, org: string): Promise<string> {
  await page.goto(`/o/${org}/integrations`);
  await page.getByRole('button', { name: 'Connect Salesforce' }).click();
  await expect(page.getByRole('heading', { name: 'Connect Salesforce to Yayatoh?' })).toBeVisible();
  await page.getByRole('button', { name: 'Allow' }).click();
  await expect(page.getByText('Salesforce is connected. The first sync starts shortly.')).toBeVisible();
  const id = /\/integrations\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  expect(id).toBeTruthy();
  return id as string;
}

const form = (page: Page, name: string) => page.getByRole('form', { name });
const linkedRow = (page: Page, object: string) =>
  page.getByRole('table', { name: 'Linked records by kind' }).getByRole('row').filter({ hasText: object });

test.describe('Salesforce (M6.5b)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('connect, sync and see the results, map fields, fix an error from the inbox', async ({ page }) => {
    const org = await ownOrg(page);
    await page.goto(`/o/${org}/integrations`);
    const card = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'Salesforce' }) });
    await expect(card).toContainText('Only people who agreed to marketing are sent.');
    await expect(card).toContainText('Not connected');
    // A real provider: no sandbox badge.
    await expect(card.getByText('Sandbox')).toHaveCount(0);
    await expectAccessibleBothModes(page);

    const connection = await connectSalesforce(page, org);
    await expect(page.getByRole('heading', { level: 1, name: 'Salesforce' })).toBeVisible();
    await expect(page.getByText('Salesforce (sandbox org)')).toBeVisible();
    // Nothing is linked before the first sync: the empty state says what happens next.
    await expect(page.getByText('Nothing linked yet. Records are linked as they sync.')).toBeVisible();
    await expectAccessibleBothModes(page);

    // The first sync: Salesforce's people come in, the event goes out as a campaign.
    await runSyncs(page, org);
    await page.reload();
    const runs = page.getByRole('table', { name: 'Recent syncs of this integration' });
    await expect(runs.getByRole('row').nth(1)).toContainText('Synced with errors');
    await expect(linkedRow(page, 'Contacts')).toContainText('2');
    await expect(linkedRow(page, 'Leads')).toContainText('2');
    await expect(linkedRow(page, 'Campaigns')).toContainText('1');
    await expect(page.getByRole('link', { name: '1 record needs a look' })).toBeVisible();

    // One mapping form per object and direction, named after the object.
    await expect(page.getByRole('heading', { name: 'Contacts: Into Yayatoh' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Sponsor opportunities: Out to the provider' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Campaigns: Into Yayatoh/ })).toHaveCount(0);

    // A required Salesforce field left unmapped is refused inline…
    const leadsOut = form(page, 'Leads: Out to the provider');
    await pickOption(leadsOut.getByRole('group', { name: /^Company/ }).getByLabel('Comes from'), '');
    await leadsOut.getByRole('button', { name: 'Save export mapping' }).click();
    await expect(leadsOut.getByText("Choose where Company comes from: it's required.")).toBeVisible();
    await expect(
      page.getByText("This mapping can't be saved yet. Check the fields marked below."),
    ).toBeVisible();
    await expectAccessible(page);
    // …and a valid one is saved as the next version and survives a reload.
    await pickOption(leadsOut.getByRole('group', { name: /^Company/ }).getByLabel('Comes from'), 'company');
    await leadsOut
      .getByRole('group', { name: /^Company/ })
      .getByLabel('If empty, use')
      .fill('Guest of the event');
    await leadsOut.getByRole('button', { name: 'Save export mapping' }).click();
    await expect(page.getByText('Mapping saved as version 2. The next sync uses it.')).toBeVisible();
    await page.reload();
    const contactsIn = form(page, 'Contacts: Into Yayatoh');
    const name = contactsIn.getByRole('group', { name: 'Name', exact: true });
    await pickOption(name.getByLabel('Comes from'), 'title');
    await pickOption(name.getByLabel('Change'), 'uppercase');
    await contactsIn.getByRole('button', { name: 'Save import mapping' }).click();
    await expect(page.getByText('Mapping saved as version 2. The next sync uses it.')).toBeVisible();
    await page.reload();
    await expectPicked(
      form(page, 'Contacts: Into Yayatoh')
        .getByRole('group', { name: 'Name', exact: true })
        .getByLabel('Comes from'),
      'title',
    );
    await expect(
      form(page, 'Leads: Out to the provider')
        .getByRole('group', { name: /^Company/ })
        .getByLabel('If empty, use'),
    ).toHaveValue('Guest of the event');

    // The errors inbox: the Salesforce contact without an email.
    await page.getByRole('link', { name: /^Errors/ }).click();
    const group = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: /Salesforce: Mapping · 1 record/ }) });
    await expect(group).toContainText('A required field is empty');
    await expect(group).toContainText('Field: email');
    await expect(group.getByText(BAD_RECORD, { exact: true }).first()).toBeVisible();
    await expectAccessibleBothModes(page);
    // Fixed in Salesforce, then retried: the next sync links it.
    await inSalesforce(page, connection, 'fix');
    await group.getByRole('button', { name: `Retry ${BAD_RECORD}` }).click();
    await expect(page.getByText('1 record will be retried on the next sync.')).toBeVisible();
    await runSyncs(page, org);
    await page.goto(`/o/${org}/integrations/errors`);
    await expect(page.getByText('No open errors', { exact: true })).toBeVisible();
    await page.goto(`/o/${org}/integrations/${connection}`);
    await expect(linkedRow(page, 'Contacts')).toContainText('3');
  });

  test('revoked in Salesforce: the next sync stops and says so', async ({ page }) => {
    const org = await ownOrg(page);
    const connection = await connectSalesforce(page, org);
    await inSalesforce(page, connection, 'revoke');
    await runSyncs(page, org);
    await page.reload();
    await expect(
      page.getByText(/The provider stopped accepting this connection on .+, so syncing stopped\./),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reconnect' })).toBeVisible();
    // Nothing was linked: the run stopped before reading anything.
    await expect(page.getByText('Nothing linked yet. Records are linked as they sync.')).toBeVisible();
  });

  test('keyboard only: connect, sync now and save a mapping', async ({ page }) => {
    const org = await ownOrg(page);
    await page.goto(`/o/${org}/integrations`);
    await page.getByRole('button', { name: 'Connect Salesforce' }).focus();
    await page.keyboard.press('Enter');
    const allow = page.getByRole('button', { name: 'Allow' });
    await expect(allow).toBeVisible();
    await allow.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Salesforce is connected. The first sync starts shortly.')).toBeVisible();
    await runSyncs(page, org);
    await page.reload();
    await page.getByRole('button', { name: 'Sync now' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Sync started. Refresh in a moment to see the result.')).toBeVisible();
    // The campaigns export mapping: leave Status unmapped, by keyboard.
    const campaigns = form(page, 'Campaigns: Out to the provider');
    const status = campaigns.getByRole('group', { name: 'Status', exact: true }).getByLabel('Comes from');
    await pickWithKeyboard(status, { label: /Not mapped/ });
    await expectPicked(status, '');
    await campaigns.getByRole('button', { name: 'Save export mapping' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Mapping saved as version 2. The next sync uses it.')).toBeVisible();
  });

  test('renders right-to-left in Arabic', async ({ page }) => {
    const org = await ownOrg(page);
    const connection = await connectSalesforce(page, org);
    await runSyncs(page, org);
    await page.goto(`/ar/o/${org}/integrations/${connection}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'Salesforce' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'السجلات المرتبطة' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^العملاء المحتملون: / }).first()).toBeVisible();
    await expectAccessible(page);
  });

  test('a viewer cannot open integrations or connect Salesforce', async ({ page }) => {
    await signIn(page, 'jordan@lakeside.test');
    const res = await page.goto('/o/lakeside-events/integrations');
    expect(res?.status()).toBe(404);
    expect(await page.getByRole('button', { name: 'Connect Salesforce' }).count()).toBe(0);
  });
});
