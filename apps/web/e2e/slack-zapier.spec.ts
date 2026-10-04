import { expect, type Page, test } from '@playwright/test';
import {
  expectAccessible,
  expectAccessibleBothModes,
  expectPicked,
  inOptions,
  newUser,
  pickOption,
  pickWithKeyboard,
  signIn,
} from './helpers.ts';

/**
 * M6.4c Slack and Zapier through the real UI, against the fake IntegrationAuth port and the fake
 * Slack API: connect Slack (fake OAuth), pick a channel (validation, persistence), preview and
 * send a test alert (it reaches the fake channel), the daily digest time, a revoke at Slack that
 * stops sending, the Zapier page with the API key scopes, key coverage and active triggers (a
 * REST hook subscribed over /api/v1), permissions, keyboard only, axe in both themes, Arabic RTL.
 */

const unique = (what: string) => `${what} ${test.info().project.name} ${Date.now()}`;

async function ownOrg(page: Page): Promise<string> {
  const owner = await newUser(page, { org: true, twoFactor: true });
  return owner.orgSlug as string;
}

async function connectSlack(page: Page, org: string): Promise<string> {
  await page.goto(`/o/${org}/integrations`);
  await expect(page.getByRole('heading', { name: 'Slack', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Connect Slack' }).click();
  await expect(page.getByRole('heading', { name: 'Connect Slack to Yayatoh?' })).toBeVisible();
  await page.getByRole('button', { name: 'Allow' }).click();
  await expect(page.getByText(/^Slack is connected\./)).toBeVisible();
  const id = /\/integrations\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  expect(id).toBeTruthy();
  return id as string;
}

/** What the fake Slack channel received (channel and text). */
async function slackMessages(page: Page, connection: string): Promise<{ channel: string; text: string }[]> {
  const res = await page.request.post('/api/dev/integrations/fake', {
    form: { connection, action: 'slack-messages' },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { messages: { channel: string; text: string }[] }).messages;
}

const settingsForm = (page: Page) => page.getByRole('form', { name: 'Channel and messages' });

test.describe('Slack (M6.4c)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('connect, pick a channel, set the digest, preview and send a test alert', async ({ page }) => {
    const org = await ownOrg(page);
    await page.goto(`/o/${org}/integrations`);
    await expect(page.getByText(/Alerts and a daily digest in a Slack channel you pick/)).toBeVisible();
    const connection = await connectSlack(page, org);
    await expect(page.getByRole('heading', { level: 1, name: 'Slack' })).toBeVisible();
    await expect(page.getByText('Fake Workspace (sandbox)')).toBeVisible();
    // A notifications connector: no Sync now, mapping or runs; its own panel instead.
    await expect(page.getByRole('button', { name: /Sync/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Field mapping' })).toHaveCount(0);
    await expect(page.getByText('Nothing sent yet.')).toBeVisible();
    await expectAccessibleBothModes(page);

    // Validation: no channel yet.
    const form = settingsForm(page);
    await form.getByRole('button', { name: 'Save Slack settings' }).click();
    await expect(page.getByText('Some details need fixing.')).toBeVisible();
    await expect(form.getByText('Choose a channel.')).toBeVisible();
    await expectAccessible(page);

    // The picker lists the workspace's live channels; one the app is not in cannot be picked.
    const channel = form.getByLabel('Channel', { exact: true });
    const options = await inOptions(channel, async (list) =>
      list
        .getByRole('option')
        .evaluateAll((els) =>
          els.map((e) => `${e.textContent?.trim()}|${e.getAttribute('aria-disabled') ?? ''}`),
        ),
    );
    expect(options).toEqual([
      '#door-team · app not in channel|true',
      '#event-ops|',
      '#finance · private|',
      '#general|',
    ]);
    await pickOption(channel, 'C01GENERAL');
    // The digest needs a time.
    await form.getByLabel('Send a daily digest').check();
    await form.getByLabel('Digest time').fill('');
    await form.getByLabel('Digest time').blur();
    await form.getByRole('button', { name: 'Save Slack settings' }).click();
    await expect(form.getByText('Choose a time for the digest.')).toBeVisible();
    await form.getByLabel('Digest time').fill('07:30');
    await form.getByLabel('Digest time').blur();
    await pickOption(form.getByLabel('Alerts to send'), 'critical');
    // Amounts are offered to the person who connected Slack (an owner has finance access).
    await expect(form.getByLabel('Include amounts in the digest')).not.toBeChecked();
    await form.getByRole('button', { name: 'Save Slack settings' }).click();
    await expect(page.getByText('Slack settings saved.')).toBeVisible();

    // Saved, after a reload.
    await page.reload();
    await expectPicked(settingsForm(page).getByLabel('Channel', { exact: true }), 'C01GENERAL');
    await expectPicked(settingsForm(page).getByLabel('Alerts to send'), 'critical');
    await expect(settingsForm(page).getByLabel('Digest time')).toHaveAttribute('data-value', '07:30');
    await expect(page.getByTestId('slack-next-digest')).toContainText(/Next digest: .*7:30/);

    // The preview is what the channel will see; sending it reaches the fake channel once.
    const preview = page.getByTestId('slack-preview');
    await expect(preview).toContainText(/Test alert from /);
    await expect(preview).toContainText(
      'Slack is connected. Alerts and the daily digest from Yayatoh will arrive in this channel.',
    );
    await expectAccessibleBothModes(page);
    await page.getByRole('button', { name: 'Send test alert' }).click();
    await expect(page.getByText('Test alert sent to #general.')).toBeVisible();
    const row = page.getByRole('table', { name: 'Recent Slack messages' }).getByRole('row').nth(1);
    await expect(row).toContainText('Test alert');
    await expect(row).toContainText('Sent');
    const received = await slackMessages(page, connection);
    expect(received).toHaveLength(1);
    expect(received[0]?.channel).toBe('C01GENERAL');
    expect(received[0]?.text).toMatch(/^Test alert from /);
    // No personal data: no email address and no phone number in what Slack got.
    expect(received[0]?.text).not.toMatch(/@|\+\d{6,}/);
    await expectAccessible(page);
  });

  test('keyboard only: connect, pick a channel, save and send a test alert', async ({ page }) => {
    const org = await ownOrg(page);
    await page.goto(`/o/${org}/integrations`);
    const connect = page.getByRole('button', { name: 'Connect Slack' });
    await connect.focus();
    await page.keyboard.press('Enter');
    const allow = page.getByRole('button', { name: 'Allow' });
    await expect(allow).toBeVisible();
    await allow.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/^Slack is connected\./)).toBeVisible();
    const form = settingsForm(page);
    await pickWithKeyboard(form.getByLabel('Channel', { exact: true }), { label: '#event-ops' });
    const alerts = form.getByLabel('Send alerts');
    await alerts.focus();
    await page.keyboard.press('Space');
    await expect(alerts).not.toBeChecked();
    await page.keyboard.press('Space');
    await expect(alerts).toBeChecked();
    await form.getByRole('button', { name: 'Save Slack settings' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Slack settings saved.')).toBeVisible();
    await page.reload();
    const send = page.getByRole('button', { name: 'Send test alert' });
    await send.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Test alert sent to #event-ops.')).toBeVisible();
  });

  test('revoked at Slack: nothing more is sent and the connection shows it', async ({ page }) => {
    const org = await ownOrg(page);
    const connection = await connectSlack(page, org);
    await pickOption(settingsForm(page).getByLabel('Channel', { exact: true }), 'C02EVENTOPS');
    await settingsForm(page).getByRole('button', { name: 'Save Slack settings' }).click();
    await expect(page.getByText('Slack settings saved.')).toBeVisible();
    await page.reload();
    const res = await page.request.post('/api/dev/integrations/fake', {
      form: { connection, action: 'revoke' },
    });
    expect(res.ok()).toBe(true);
    await page.getByRole('button', { name: 'Send test alert' }).click();
    const revoked = 'Slack no longer accepts this connection. Reconnect Slack.';
    await expect(page.getByRole('paragraph').filter({ hasText: revoked })).toBeVisible();
    await expect(page.getByText('Disconnected', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send test alert' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reconnect' })).toBeVisible();
    expect(await slackMessages(page, connection)).toHaveLength(0);
    const row = page.getByRole('table', { name: 'Recent Slack messages' }).getByRole('row').nth(1);
    await expect(row).toContainText('Not sent');
    await expect(row).toContainText(revoked);
    await expectAccessible(page);
  });

  test('renders right-to-left in Arabic', async ({ page }) => {
    const org = await ownOrg(page);
    const connection = await connectSlack(page, org);
    await page.goto(`/ar/o/${org}/integrations/${connection}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'القناة والرسائل' })).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe('Zapier (M6.4c)', () => {
  test.describe.configure({ timeout: 180_000 });
  const ORG = '/o/lakeside-events';

  test('the Zapier page shows the API key scope, key coverage and active triggers', async ({ page }) => {
    await signIn(page);
    await page.goto(`${ORG}/integrations`);
    await page.getByRole('link', { name: 'Set up Zapier' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Zapier' })).toBeVisible();
    await expect(page.getByTestId('zapier-scopes')).toHaveText(
      'A key with these scopes covers everything: webhooks:subscribe, attendees:write, contacts:write, checkin:scan, events:read',
    );
    const parts = page.getByRole('table', { name: 'Triggers and actions with the scope each one needs' });
    for (const [part, scope] of [
      ['Order paid', 'webhooks:subscribe'],
      ['Create registration', 'attendees:write'],
      ['Add contact', 'contacts:write'],
      ['Check in ticket', 'checkin:scan'],
      ['Event picker', 'events:read'],
    ] as const)
      await expect(parts.getByRole('row').filter({ hasText: part })).toContainText(scope);
    await expectAccessibleBothModes(page);

    // A key with every Zapier scope: "Ready for Zapier"; one with fewer says what is missing.
    await page.getByRole('link', { name: 'Create an API key' }).first().click();
    await expect(page).toHaveURL(/\/api-keys$/);
    const name = unique('Zapier');
    await page.getByLabel('Name', { exact: true }).fill(name);
    for (const s of [
      'Subscribe automation hooks (Zapier triggers)',
      'Change attendees and resend tickets',
      'Add contacts',
      'Scan tickets',
      'Read events and ticket types',
    ])
      await page.getByRole('checkbox', { name: s }).check();
    await page.getByRole('button', { name: 'Create key' }).click();
    await expect(page.getByText(`Key “${name}” created.`)).toBeVisible();
    const key = ((await page.getByTestId('new-api-key').textContent()) ?? '').trim();
    expect(key).toMatch(/^yy_live_/);
    const partial = unique('Partial');
    await page.getByLabel('Name', { exact: true }).fill(partial);
    await page.getByRole('checkbox', { name: 'Add contacts' }).check();
    await page.getByRole('button', { name: 'Create key' }).click();
    await expect(page.getByText(`Key “${partial}” created.`)).toBeVisible();

    // Zapier turns a trigger on: a REST hook over /api/v1 with that key.
    const hook = await page.request.post('/api/v1/orgs/lakeside-events/hooks', {
      headers: { authorization: `Bearer ${key}`, 'idempotency-key': `e2e-${Date.now()}-${Math.random()}` },
      data: { url: `https://hooks.example.com/zapier/${Date.now()}`, event: 'order.paid' },
    });
    expect(hook.status()).toBe(201);
    const hookId = ((await hook.json()) as { id: string }).id;

    await page.goto(`${ORG}/integrations/zapier`);
    const keys = page.getByRole('table', { name: 'Live API keys and their Zapier coverage' });
    await expect(keys.getByRole('row').filter({ hasText: name })).toContainText('Ready for Zapier');
    await expect(keys.getByRole('row').filter({ hasText: partial })).toContainText('Missing 4 scopes');
    const hooks = page.getByRole('table', { name: 'Triggers Zapier has subscribed' });
    await expect(hooks.getByRole('row').filter({ hasText: name })).toContainText('order.paid');
    await expect(hooks.getByRole('row').filter({ hasText: name })).toContainText('hooks.example.com');
    await expectAccessible(page);

    // Turning the Zap off unsubscribes; the trigger is gone from the page.
    const off = await page.request.delete(`/api/v1/orgs/lakeside-events/hooks/${hookId}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(off.status()).toBe(204);
    await page.reload();
    await expect(
      page
        .getByRole('table', { name: 'Triggers Zapier has subscribed' })
        .getByRole('row')
        .filter({ hasText: name }),
    ).toHaveCount(0);
  });

  test('keyboard only: from the integrations page to the Zapier page', async ({ page }) => {
    await signIn(page);
    await page.goto(`${ORG}/integrations`);
    const setUp = page.getByRole('link', { name: 'Set up Zapier' });
    await setUp.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Zapier' })).toBeVisible();
    const create = page.getByRole('link', { name: 'Create an API key' }).first();
    await create.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/api-keys$/);
  });

  test('a viewer cannot open the Zapier page', async ({ page }) => {
    await signIn(page, 'jordan@lakeside.test');
    const res = await page.goto(`${ORG}/integrations/zapier`);
    expect(res?.status()).toBe(404);
  });

  test('renders right-to-left in Arabic', async ({ page }) => {
    await signIn(page);
    await page.goto(`/ar${ORG}/integrations/zapier`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'Zapier' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'صلاحيات مفتاح API' })).toBeVisible();
    await expectAccessible(page);
  });
});
