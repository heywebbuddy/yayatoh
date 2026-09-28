import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, signIn, WEDDING_OWNER } from './helpers.ts';

const PAGE = '/o/lakeside-events/api-keys';
const VIEWER = 'jordan@lakeside.test';

/** A key name unique per project and run, so parallel projects and reruns never collide. */
const keyName = (what: string) => `${what} ${test.info().project.name} ${Date.now()}`;

async function createKey(page: Page, name: string, scopes: string[]) {
  await page.getByLabel('Name', { exact: true }).fill(name);
  for (const s of scopes) await page.getByRole('checkbox', { name: s }).check();
  await page.getByRole('button', { name: 'Create key' }).click();
  await expect(page.getByText(`Key “${name}” created.`)).toBeVisible();
  const key = (await page.getByTestId('new-api-key').textContent()) ?? '';
  expect(key).toMatch(/^yy_live_[A-Za-z0-9_-]{43}$/);
  return key;
}

test.describe('org API keys (M1.13)', () => {
  test('an owner creates a key shown once, copies it, uses it, then revokes it (401 after)', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await signIn(page);
    await page.goto(PAGE);
    await expect(page.getByRole('heading', { name: 'API keys', level: 1 })).toBeVisible();
    const name = keyName('Sync');
    const key = await createKey(page, name, ['Read the organization', 'Read events and ticket types']);
    await expect(page.getByText('it will not be shown again')).toBeVisible();

    await page.getByRole('button', { name: 'Copy key' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Copied to the clipboard.' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);
    await expectAccessible(page);

    // Listed with its prefix and scopes; after a reload the secret is gone for good.
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toContainText(`${key.slice(0, 12)}…`);
    await expect(row).toContainText('Read the organization, Read events and ticket types');
    await expect(row).toContainText('Active');
    await page.reload();
    await expect(page.getByRole('row').filter({ hasText: name })).toContainText('Never');
    await expect(page.getByTestId('new-api-key')).toHaveCount(0);
    expect(await page.content()).not.toContain(key);

    // The key works against /v1 for its own org, within its scopes.
    const ok = await page.request.get('/api/v1/orgs/lakeside-events/events?limit=1', {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(ok.status()).toBe(200);
    const denied = await page.request.post('/api/v1/orgs/lakeside-events/events', {
      headers: { authorization: `Bearer ${key}`, 'idempotency-key': `e2e-${Date.now()}-deny` },
      data: {
        name: 'Nope',
        timezone: 'UTC',
        startsAt: '2030-01-01T10:00:00Z',
        endsAt: '2030-01-01T11:00:00Z',
      },
    });
    expect(denied.status()).toBe(403);
    await page.reload();
    await expect(page.getByRole('row').filter({ hasText: name })).not.toContainText('Never');

    await page.getByRole('button', { name: `Revoke key ${name}` }).click();
    await expect(page.getByRole('row').filter({ hasText: name })).toContainText('Revoked');
    await expect(page.getByRole('button', { name: `Revoke key ${name}` })).toHaveCount(0);
    const refused = await page.request.get('/api/v1/orgs/lakeside-events', {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(refused.status()).toBe(401);
    expect(refused.headers()['content-type']).toBe('application/problem+json');
    expect((await refused.json()).code).toBe('unauthenticated');
    await page.reload();
    await expect(page.getByRole('row').filter({ hasText: name })).toContainText('Revoked');
  });

  test('validates the name and the scopes, with messages on the fields', async ({ page }) => {
    await signIn(page);
    await page.goto(PAGE);
    await page.getByRole('button', { name: 'Create key' }).click();
    await expect(page.getByText('Give the key a name.')).toBeVisible();
    await expect(page.getByText('Choose at least one scope.')).toBeVisible();
    await expect(page.getByLabel('Name', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page);

    await page.getByLabel('Name', { exact: true }).fill(keyName('Scopeless'));
    await page.getByRole('button', { name: 'Create key' }).click();
    await expect(page.getByText('Choose at least one scope.')).toBeVisible();
    await expect(page.getByText('Give the key a name.')).toHaveCount(0);
    await expect(page.getByTestId('new-api-key')).toHaveCount(0);
  });

  test('works with the keyboard alone', async ({ page }) => {
    await signIn(page);
    await page.goto(PAGE);
    const name = keyName('Keyboard');
    await page.getByLabel('Name', { exact: true }).focus();
    await page.keyboard.type(name);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('checkbox', { name: 'Read the organization' })).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByRole('checkbox', { name: 'Read the organization' })).toBeChecked();
    await page.getByRole('button', { name: 'Create key' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(`Key “${name}” created.`)).toBeVisible();
    const revoke = page.getByRole('button', { name: `Revoke key ${name}` });
    await revoke.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('row').filter({ hasText: name })).toContainText('Revoked');
  });

  test('the nav reaches the page', async ({ page }) => {
    await signIn(page);
    await page.goto('/o/lakeside-events');
    const nav = page.getByRole('link', { name: 'API keys' });
    if (!(await nav.isVisible())) await page.locator('summary').filter({ hasText: 'Open menu' }).click();
    await page.getByRole('link', { name: 'API keys' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/api-keys$/);
    await expect(page.getByRole('link', { name: 'API reference' })).toHaveAttribute('href', '/api/v1/docs');
  });

  test('shows an empty state for an org without keys', async ({ page }) => {
    await signIn(page, WEDDING_OWNER);
    await page.goto('/o/rosewood-weddings/api-keys');
    await expect(page.getByText('No API keys yet.')).toBeVisible();
    await expectAccessible(page);
  });

  test('a viewer cannot manage keys: no form, and the page says why', async ({ page }) => {
    await signIn(page, VIEWER);
    await page.goto(PAGE);
    await expect(page.getByText('Only owners and admins manage API keys')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create key' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Revoke key/ })).toHaveCount(0);
    await expectAccessible(page);
  });

  test('renders right-to-left in Arabic', async ({ page }) => {
    await signIn(page);
    await page.goto(`/ar${PAGE}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'مفاتيح API', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'إنشاء المفتاح' })).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe('test keys (M1.13d)', () => {
  async function createTestKey(page: Page, name: string, scopes: string[]) {
    await page.getByLabel('Name', { exact: true }).fill(name);
    for (const sc of scopes) await page.getByRole('checkbox', { name: sc }).check();
    await page.getByRole('radio', { name: 'Test key' }).check();
    await page.getByRole('button', { name: 'Create key' }).click();
    await expect(page.getByText(`Key “${name}” created.`)).toBeVisible();
    const key = (await page.getByTestId('new-api-key').textContent()) ?? '';
    expect(key).toMatch(/^yy_test_[A-Za-z0-9_-]{43}$/);
    return key;
  }

  test('an owner creates a test key: badged in the list, read-only, no personal data', async ({ page }) => {
    await signIn(page);
    await page.goto(PAGE);
    // Live is the default; each type explains itself.
    await expect(page.getByRole('radio', { name: 'Live key' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Test key' })).toHaveAccessibleDescription(
      /Read-only, with no personal data/,
    );
    const name = keyName('Sandbox');
    const key = await createTestKey(page, name, ['Read the organization', 'Read events and ticket types']);
    await expect(page.getByText('This is a test key: read-only, without personal data.')).toBeVisible();
    await expectAccessible(page);
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row.getByTestId('test-key-badge')).toHaveText('Test');
    await expect(row).toContainText(`${key.slice(0, 12)}…`);
    // A live key has no badge.
    const live = keyName('Live');
    await createKey(page, live, ['Read the organization']);
    await expect(page.getByRole('row').filter({ hasText: live }).getByTestId('test-key-badge')).toHaveCount(
      0,
    );
    await page.reload();
    await expect(page.getByRole('row').filter({ hasText: name }).getByTestId('test-key-badge')).toBeVisible();

    // Against /v1: reads events with a smaller budget; never orders, attendees or writes.
    const auth = { authorization: `Bearer ${key}` };
    const events = await page.request.get('/api/v1/orgs/lakeside-events/events?limit=1', { headers: auth });
    expect(events.status()).toBe(200);
    expect(events.headers()['ratelimit-limit']).toBe('120');
    const eventId = (await events.json()).data[0].id as string;
    for (const path of [`/events/${eventId}/orders`, `/events/${eventId}/attendees`]) {
      const denied = await page.request.get(`/api/v1/orgs/lakeside-events${path}`, { headers: auth });
      expect(denied.status(), path).toBe(403);
    }
    const write = await page.request.post('/api/v1/orgs/lakeside-events/events', {
      headers: { ...auth, 'idempotency-key': `e2e-${Date.now()}-test-key` },
      data: {
        name: 'Nope',
        timezone: 'UTC',
        startsAt: '2030-01-01T10:00:00Z',
        endsAt: '2030-01-01T11:00:00Z',
      },
    });
    expect(write.status()).toBe(403);
  });

  test('a test key with write or personal-data scopes is refused, with the reason on the scopes', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(PAGE);
    await page.getByLabel('Name', { exact: true }).fill(keyName('Too much'));
    await page.getByRole('checkbox', { name: 'Read attendees' }).check();
    await page.getByRole('radio', { name: 'Test key' }).check();
    await page.getByRole('button', { name: 'Create key' }).click();
    const message = page.getByText('A test key can only read the organization and events.');
    await expect(message).toBeVisible();
    await expect(page.getByRole('group', { name: 'Scopes' })).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('new-api-key')).toHaveCount(0);
    await expectAccessible(page);
  });

  test('works with the keyboard alone: arrow keys pick the key type', async ({ page }) => {
    await signIn(page);
    await page.goto(PAGE);
    const name = keyName('Keyboard test');
    await page.getByLabel('Name', { exact: true }).focus();
    await page.keyboard.type(name);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect(page.getByRole('checkbox', { name: 'Read the organization' })).toBeChecked();
    await page.getByRole('radio', { name: 'Live key' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio', { name: 'Test key' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Test key' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Create key' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText(`Key “${name}” created.`)).toBeVisible();
    expect(await page.getByTestId('new-api-key').textContent()).toMatch(/^yy_test_/);
    await expect(page.getByRole('row').filter({ hasText: name }).getByTestId('test-key-badge')).toBeVisible();
  });

  test('renders the key type and the badge right-to-left in Arabic', async ({ page }) => {
    await signIn(page);
    await page.goto(PAGE);
    const name = keyName('Arabic test');
    await createTestKey(page, name, ['Read events and ticket types']);
    await page.goto(`/ar${PAGE}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('group', { name: 'نوع المفتاح' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'مفتاح اختبار' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: name }).getByTestId('test-key-badge')).toHaveText(
      'اختبار',
    );
    await expectAccessible(page);
  });
});

test.describe('API reference (Scalar)', () => {
  test('loads from our own origin and lists the endpoints', async ({ page }) => {
    // Nothing third-party loads: Scalar's hosted fonts are stopped by the page's CSP.
    const foreign: string[] = [];
    page.on('response', (r) => {
      const u = new URL(r.url());
      if (u.protocol.startsWith('http') && u.hostname !== 'localhost') foreign.push(u.hostname);
    });
    await page.goto('/api/v1/docs');
    await expect(page).toHaveTitle(/Yayatoh API/);
    await expect(page.getByText('Yayatoh API', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    for (const group of ['auth', 'events', 'orders', 'attendees', 'check-in', 'public'])
      await expect(page.getByText(group, { exact: true }).first()).toBeAttached();
    // Opening a group in the sidebar lists its endpoints (behind "Open Menu" on small screens).
    const group = page.locator('a[href$="#tag/events"]').filter({ visible: true }).first();
    if ((page.viewportSize()?.width ?? 1280) < 1000) {
      const menu = page.getByRole('button', { name: 'Open Menu' }).filter({ visible: true }).first();
      await expect(async () => {
        if (!(await group.isVisible())) await menu.click();
        await expect(group).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
    }
    await group.click();
    await expect(
      page
        .getByText(/Create a draft event/)
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    const doc = await page.request.get('/api/v1/openapi.json');
    const body = await doc.json();
    expect(body.servers[0].url).toMatch(/\/api$/);
    expect(Object.keys(body.paths)).toContain('/v1/orgs/{org}/events');
    expect(foreign).toEqual([]);
  });

  test('lists the mobile-ready content endpoints (M1.13d) and passes axe', async ({ page }) => {
    await page.goto('/api/v1/docs');
    await expect(page.getByText('Yayatoh API', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    for (const group of ['public content', 'event content', 'venues'])
      await expect(page.getByText(group, { exact: true }).first()).toBeAttached();
    for (const summary of ['A public event’s agenda', 'A public event’s speakers', 'The venue directory'])
      await expect(page.getByText(summary, { exact: true }).first()).toBeAttached();
    const body = await (await page.request.get('/api/v1/openapi.json')).json();
    for (const path of [
      '/v1/public/events/{slug}/agenda',
      '/v1/public/events/{slug}/speakers/{speakerId}',
      '/v1/public/events/{slug}/images',
      '/v1/public/venues/{slug}',
      '/v1/orgs/{org}/events/{eventId}/agenda',
      '/v1/orgs/{org}/venues',
    ])
      expect(Object.keys(body.paths)).toContain(path);
    expect(body.paths['/v1/public/events/{slug}/agenda'].get.operationId).toBe('getPublicEventAgenda');
    await expectAccessible(page);
  });
});
