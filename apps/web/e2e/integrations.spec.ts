import { expect, type Page, test } from '@playwright/test';
import {
  expectAccessible,
  expectAccessibleBothModes,
  expectPicked,
  newUser,
  pickOption,
  signIn,
  stepOption,
} from './helpers.ts';

/**
 * M6.4a integrations framework, through the real UI against the fake IntegrationAuth port:
 * connect the demo connector (fake OAuth consent), map fields (validation, versions, reload),
 * run a sync, see the broken record in the errors inbox, fix it at the source and retry it,
 * dismiss, disconnect; a provider-side revoke stops the connection and shows it; a refused
 * consent connects nothing; viewers are refused; keyboard only; axe in both themes; Arabic RTL.
 */

/** A fresh org whose owner is signed in on `page`. */
async function ownOrg(page: Page): Promise<string> {
  const owner = await newUser(page, { org: true, twoFactor: true });
  return owner.orgSlug as string;
}

/** Run the org's due syncs now (what the worker does). */
async function runSyncs(page: Page, org: string) {
  const res = await page.request.post('/api/dev/integrations/run', { form: { org } });
  expect(res.ok()).toBe(true);
}

/** Act at the fake provider (`revoke` our access, `fix` the broken record). */
async function atProvider(page: Page, connection: string, action: 'revoke' | 'fix') {
  const res = await page.request.post('/api/dev/integrations/fake', { form: { connection, action } });
  expect(res.ok()).toBe(true);
}

/** Connect the demo connector through the fake consent screen; returns the connection id. */
async function connectDemo(page: Page, org: string): Promise<string> {
  await page.goto(`/o/${org}/integrations`);
  await page.getByRole('button', { name: 'Connect Demo CRM' }).click();
  await expect(page.getByRole('heading', { name: 'Connect Demo CRM to Yayatoh?' })).toBeVisible();
  await page.getByRole('button', { name: 'Allow' }).click();
  await expect(page.getByText('Demo CRM is connected. The first sync starts shortly.')).toBeVisible();
  const id = /\/integrations\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  expect(id).toBeTruthy();
  return id as string;
}

const pullForm = (page: Page) => page.getByRole('form', { name: 'Into Yayatoh' });

test.describe('integrations (M6.4a)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('connect, map, sync, fix and retry an error, dismiss, disconnect', async ({ page }) => {
    const org = await ownOrg(page);
    await page.goto(`/o/${org}/integrations`);
    await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toBeVisible();
    // The nav lists it; the card says what to do next.
    // (On phones the nav sits in the menu drawer, so look for the link itself.)
    expect(await page.locator(`a[href="/o/${org}/integrations"]`).count()).toBeGreaterThan(0);
    await expect(page.getByRole('heading', { name: 'Demo CRM' })).toBeVisible();
    // M6.4b, M6.4c and M6.5c added more connectors: look inside the demo's own card.
    await expect(
      page
        .getByRole('listitem')
        .filter({ has: page.getByRole('heading', { name: 'Demo CRM' }) })
        .getByText('Not connected'),
    ).toBeVisible();
    await expectAccessibleBothModes(page);

    const connection = await connectDemo(page, org);
    await expect(page.getByRole('heading', { level: 1, name: 'Demo CRM' })).toBeVisible();
    await expect(page.getByText('Connected', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Demo CRM (sandbox)')).toBeVisible();
    // The first sync is queued: Sync now waits for it.
    await expect(page.getByRole('button', { name: 'Sync on its way' })).toBeDisabled();
    await expectAccessibleBothModes(page);

    await runSyncs(page, org);
    await page.reload();
    const runs = page.getByRole('table', { name: 'Recent syncs of this integration' });
    await expect(runs.getByRole('row').nth(1)).toContainText('Synced with errors');
    await expect(runs.getByRole('row').nth(1)).toContainText('3');
    await expect(page.getByRole('link', { name: '1 record needs a look' })).toBeVisible();

    // Mapping: a required target left unmapped is refused inline…
    const pull = pullForm(page);
    await expect(page.getByText('Version 1').first()).toBeVisible();
    await pickOption(pull.getByRole('group', { name: /Email/ }).getByLabel('Comes from'), '');
    await pull.getByRole('button', { name: 'Save import mapping' }).click();
    await expect(
      page.getByText("This mapping can't be saved yet. Check the fields marked below."),
    ).toBeVisible();
    await expect(pull.getByText("Choose where Email comes from: it's required.")).toBeVisible();
    await expectAccessible(page);
    // …and a valid one is saved as the next version and survives a reload.
    await pickOption(pull.getByRole('group', { name: /Email/ }).getByLabel('Comes from'), 'email_address');
    const name = pull.getByRole('group', { name: 'Name' });
    await pickOption(name.getByLabel('Comes from'), 'company');
    await pickOption(name.getByLabel('Change'), 'uppercase');
    await name.getByLabel('If empty, use').fill('NO COMPANY');
    await pull.getByRole('button', { name: 'Save import mapping' }).click();
    await expect(page.getByText('Mapping saved as version 2. The next sync uses it.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Version 2', { exact: true })).toBeVisible();
    await expectPicked(
      pullForm(page).getByRole('group', { name: 'Name' }).getByLabel('Comes from'),
      'company',
    );
    await expect(pullForm(page).getByRole('group', { name: 'Name' }).getByLabel('If empty, use')).toHaveValue(
      'NO COMPANY',
    );

    // The errors inbox: the demo's broken record, grouped, with what went wrong.
    await page.getByRole('link', { name: /^Errors/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Integration errors' })).toBeVisible();
    const group = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: /Demo CRM: Mapping · 1 record/ }) });
    await expect(group).toContainText("A value doesn't fit its field");
    await expect(group).toContainText('Field: email');
    await expect(group.getByText('dc_4', { exact: true }).first()).toBeVisible();
    await expectAccessibleBothModes(page);

    // Fix it where it came from, then Retry: the next sync resolves it.
    await atProvider(page, connection, 'fix');
    await group.getByRole('button', { name: 'Retry dc_4' }).click();
    await expect(page.getByText('1 record will be retried on the next sync.')).toBeVisible();
    await runSyncs(page, org);
    await page.goto(`/o/${org}/integrations/errors`);
    await expect(page.getByText('No open errors', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Resolved' }).click();
    await expect(page.getByText('dc_4', { exact: true }).first()).toBeVisible();

    // Disconnect: confirm first; then it is shown as disconnected and Reconnect is offered.
    await page.goto(`/o/${org}/integrations/${connection}`);
    await page.getByRole('link', { name: 'Disconnect' }).click();
    await expect(page.getByText('Disconnect Demo CRM?')).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(
      page.getByText('Disconnected. Nothing syncs any more and access was revoked at the provider.'),
    ).toBeVisible();
    await expect(page.getByText('Disconnected', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sync now' })).toHaveCount(0);
    await page.goto(`/o/${org}/integrations`);
    await expect(page.getByRole('button', { name: 'Reconnect Demo CRM' })).toBeVisible();
  });

  test('dismiss a group; a refused consent connects nothing', async ({ page }) => {
    const org = await ownOrg(page);
    await page.goto(`/o/${org}/integrations`);
    await page.getByRole('button', { name: 'Connect Demo CRM' }).click();
    await page.getByRole('button', { name: 'Deny' }).click();
    await expect(page.getByText("The connection wasn't approved, so nothing was connected.")).toBeVisible();
    await expect(page.getByText('Connection failed')).toBeVisible();
    await expectAccessible(page);

    await connectDemo(page, org);
    await runSyncs(page, org);
    await page.goto(`/o/${org}/integrations/errors`);
    await page.getByRole('button', { name: /^Dismiss all: Demo CRM: Mapping/ }).click();
    await expect(page.getByText('1 record dismissed.')).toBeVisible();
    await expect(page.getByText('No open errors', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Dismissed' }).click();
    await expect(page.getByText('dc_4', { exact: true }).first()).toBeVisible();
    // Closed records have no actions.
    await expect(page.getByRole('button', { name: /Retry/ })).toHaveCount(0);
  });

  test('revoked at the provider: the next sync stops and the connection shows it', async ({ page }) => {
    const org = await ownOrg(page);
    const connection = await connectDemo(page, org);
    await atProvider(page, connection, 'revoke');
    await runSyncs(page, org);
    await page.reload();
    await expect(
      page.getByText(/The provider stopped accepting this connection on .+, so syncing stopped\./),
    ).toBeVisible();
    await expect(page.getByText('Disconnected', { exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole('table', { name: 'Recent syncs of this integration' }).getByRole('row').nth(1),
    ).toContainText('The provider no longer accepts this connection');
    await expect(page.getByRole('button', { name: 'Reconnect' })).toBeVisible();
    await page.goto(`/o/${org}/integrations/errors`);
    await expect(page.getByRole('heading', { name: /Demo CRM: Connection · 1 record/ })).toBeVisible();
    await expect(page.getByText('The provider no longer accepts this connection')).toBeVisible();
    // A revoked connection's errors cannot be retried into a run.
    await page.getByRole('button', { name: 'Retry Whole connection' }).click();
    await expect(page.getByText("Nothing to retry: those connections aren't active.")).toBeVisible();
  });

  test('keyboard only: connect, sync now, pause and resume', async ({ page }) => {
    const org = await ownOrg(page);
    await page.goto(`/o/${org}/integrations`);
    const connect = page.getByRole('button', { name: 'Connect Demo CRM' });
    await connect.focus();
    await page.keyboard.press('Enter');
    const allow = page.getByRole('button', { name: 'Allow' });
    await expect(allow).toBeVisible();
    await allow.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Demo CRM is connected. The first sync starts shortly.')).toBeVisible();
    await runSyncs(page, org);
    await page.reload();
    const sync = page.getByRole('button', { name: 'Sync now' });
    await sync.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Sync started. Refresh in a moment to see the result.')).toBeVisible();
    const pause = page.getByRole('button', { name: 'Pause syncing' });
    await pause.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Syncing is paused.')).toBeVisible();
    await expect(page.getByText('Paused', { exact: true }).first()).toBeVisible();
    const resume = page.getByRole('button', { name: 'Resume syncing' });
    await resume.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Syncing is back on.')).toBeVisible();
    // The interval select and its save, by keyboard.
    const interval = page.getByLabel('Sync every');
    await stepOption(interval);
    await page.getByRole('button', { name: 'Save schedule' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Sync schedule saved.')).toBeVisible();
  });

  test('a viewer cannot see or open integrations', async ({ page }) => {
    await signIn(page, 'jordan@lakeside.test');
    await page.goto('/o/lakeside-events');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    expect(await page.locator('a[href="/o/lakeside-events/integrations"]').count()).toBe(0);
    for (const path of [
      'integrations',
      'integrations/errors',
      'integrations/01999999-0000-7000-8000-000000000001',
    ]) {
      const res = await page.goto(`/o/lakeside-events/${path}`);
      expect(res?.status()).toBe(404);
    }
    const cb = await page.request.get(
      '/o/lakeside-events/integrations/callback?state=abcdefghijklmnopqrstuvwxyz',
      {
        maxRedirects: 0,
      },
    );
    expect([303, 404]).toContain(cb.status());
    if (cb.status() === 303) expect(cb.headers().location).toContain('error=expired');
  });

  test('renders right-to-left in Arabic', async ({ page }) => {
    const org = await ownOrg(page);
    await connectDemo(page, org);
    await runSyncs(page, org);
    await page.goto(`/ar/o/${org}/integrations`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'التكاملات' })).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar/o/${org}/integrations/errors`);
    await expect(page.getByRole('heading', { level: 1, name: 'أخطاء التكاملات' })).toBeVisible();
    await expectAccessible(page);
  });
});
