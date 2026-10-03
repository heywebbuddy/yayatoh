import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, signIn, WEDDING_OWNER } from './helpers.ts';

/**
 * M6.3a: key lifetimes, rotation and creators, the API usage page, per-plan rate limits over
 * /api/v1, and sandbox orgs (seeded, SANDBOX banner, deletable).
 */
const KEYS = '/o/lakeside-events/api-keys';
const USAGE = '/o/lakeside-events/api-keys/usage';
const SANDBOXES = '/o/lakeside-events/sandboxes';
const VIEWER = 'jordan@lakeside.test';
const unique = (what: string) => `${what} ${test.info().project.name} ${Date.now()}`;
const auth = (key: string) => ({ authorization: `Bearer ${key}` });

async function createKey(page: Page, name: string, scopes: string[], expiry?: string) {
  await page.getByLabel('Name', { exact: true }).fill(name);
  for (const s of scopes) await page.getByRole('checkbox', { name: s }).check();
  if (expiry) await page.getByLabel('Expires').selectOption({ label: expiry });
  await page.getByRole('button', { name: 'Create key' }).click();
  await expect(page.getByText(`Key “${name}” created.`)).toBeVisible();
  return (await page.getByTestId('new-api-key').textContent()) ?? '';
}

const keyRow = (page: Page, key: string) => page.getByRole('row').filter({ hasText: `${key.slice(0, 12)}…` });

test.describe('API key lifetimes and rotation (M6.3a)', () => {
  test('an owner creates an expiring key, sees who made it, uses it, rotates it twice and revokes it', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(KEYS);
    // 90 days unless chosen otherwise; the plan's rate limits are explained.
    await expect(page.getByLabel('Expires')).toHaveValue('90');
    await expect(page.getByTestId('rate-limit-note')).toHaveText(
      'Each key can make 600 requests a minute, and all keys together 1,200.',
    );
    const name = unique('Rotation');
    const first = await createKey(
      page,
      name,
      ['Read the organization', 'Read events and ticket types'],
      'In 30 days',
    );
    const row = keyRow(page, first);
    await expect(row).toContainText('Pani Digital');
    await expect(row).toContainText('Active');
    // Expires (the sixth column) is a date, not "Never".
    await expect(row.getByRole('cell').nth(5)).not.toHaveText('Never');

    // Over /api/v1: the plan's per-key budget in the headers, and the key describes itself.
    const ok = await page.request.get('/api/v1/orgs/lakeside-events', { headers: auth(first) });
    expect(ok.status()).toBe(200);
    expect(ok.headers()['ratelimit-limit']).toBe('600');
    expect(ok.headers()['ratelimit-policy']).toBe('600;w=60');
    expect(Number(ok.headers()['ratelimit-remaining'])).toBeLessThan(600);
    const self = await (
      await page.request.get('/api/v1/orgs/lakeside-events/api-key', { headers: auth(first) })
    ).json();
    expect(self).toMatchObject({
      name,
      scopes: ['org:read', 'events:read'],
      rotated: false,
      sandboxOrg: false,
    });
    expect(Date.parse(self.expiresAt) - Date.now()).toBeGreaterThan(29 * 86_400_000);

    // Rotate with no overlap: the old key stops at once, the new one works.
    await row.getByText('Rotate', { exact: true }).click();
    await row.getByLabel('The old key keeps working').selectOption({ label: 'Not at all: stop it now' });
    await row.getByRole('button', { name: `Rotate key ${name} now` }).click();
    await expect(page.getByText(`Key “${name}” rotated. The old key has stopped working.`)).toBeVisible();
    const second = (await page.getByTestId('rotated-api-key').textContent()) ?? '';
    expect(second).toMatch(/^yy_live_[A-Za-z0-9_-]{43}$/);
    await expectAccessible(page);
    expect((await page.request.get('/api/v1/orgs/lakeside-events', { headers: auth(first) })).status()).toBe(
      401,
    );
    expect((await page.request.get('/api/v1/orgs/lakeside-events', { headers: auth(second) })).status()).toBe(
      200,
    );

    // Rotate the new key with a one-hour overlap: both work until then.
    await page.reload();
    // Stopped at once: the old key reads as expired.
    await expect(keyRow(page, first)).toContainText('Expired');
    await expect(page.getByTestId('rotated-api-key')).toHaveCount(0);
    const secondRow = keyRow(page, second);
    await secondRow.getByText('Rotate', { exact: true }).click();
    await secondRow.getByLabel('The old key keeps working').selectOption({ label: 'For 1 hour' });
    await secondRow.getByRole('button', { name: `Rotate key ${name} now` }).click();
    await expect(
      page.getByText(new RegExp(`Key “${name}” rotated\\. The old key works until .+\\.`)),
    ).toBeVisible();
    const third = (await page.getByTestId('rotated-api-key').textContent()) ?? '';
    for (const k of [second, third])
      expect((await page.request.get('/api/v1/orgs/lakeside-events', { headers: auth(k) })).status()).toBe(
        200,
      );
    const old = await (
      await page.request.get('/api/v1/orgs/lakeside-events/api-key', { headers: auth(second) })
    ).json();
    expect(old.rotated).toBe(true);

    // Revoked: the very next request fails. The overlapping key reads as rotated meanwhile.
    await page.reload();
    await expect(keyRow(page, second)).toContainText('Rotated');
    await keyRow(page, third)
      .getByRole('button', { name: `Revoke key ${name}` })
      .click();
    await expect(keyRow(page, third)).toContainText('Revoked');
    const refused = await page.request.get('/api/v1/orgs/lakeside-events', { headers: auth(third) });
    expect(refused.status()).toBe(401);
    expect((await refused.json()).code).toBe('unauthenticated');
  });

  test('rotates with the keyboard alone', async ({ page }) => {
    await signIn(page);
    await page.goto(KEYS);
    const name = unique('Keyboard rotation');
    const key = await createKey(page, name, ['Read the organization']);
    const row = keyRow(page, key);
    const summary = row.locator('summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    const overlap = row.getByLabel('The old key keeps working');
    await overlap.focus();
    await page.keyboard.press('Tab');
    await expect(row.getByRole('button', { name: `Rotate key ${name} now` })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText(new RegExp(`Key “${name}” rotated\\.`))).toBeVisible();
    await expect(page.getByTestId('rotated-api-key')).toHaveText(/^yy_live_/);
  });
});

test.describe('API usage page (M6.3a)', () => {
  test('shows requests, errors and 429-free totals per day and per key; ranges; persists after reload', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(KEYS);
    const name = unique('Usage');
    const key = await createKey(page, name, ['Read the organization']);
    for (const path of ['', '', '/events'])
      await page.request.get(`/api/v1/orgs/lakeside-events${path}`, { headers: auth(key) });
    await page.getByRole('link', { name: 'Usage' }).click();
    await expect(page).toHaveURL(/\/api-keys\/usage$/);
    await expect(page.getByRole('heading', { name: 'API usage', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Last 30 days' })).toHaveAttribute('aria-current', 'page');
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toContainText(`${key.slice(0, 12)}…`);
    // Three requests, one refused for its scope (an error).
    await expect(row.getByRole('cell').nth(2)).toHaveText('3');
    await expect(row.getByRole('cell').nth(3)).toHaveText('1');
    expect(
      Number((await page.getByTestId('usage-total-requests').textContent())?.replace(/\D/g, '')),
    ).toBeGreaterThanOrEqual(3);
    await expectAccessible(page);
    // The per-day numbers are available as a table.
    await page.getByText('Show the data').click();
    await expect(page.getByRole('table', { name: 'Requests per day' })).toBeVisible();
    await page.getByRole('link', { name: 'Last 7 days' }).click();
    await expect(page).toHaveURL(/days=7$/);
    await expect(page.getByRole('link', { name: 'Last 7 days' })).toHaveAttribute('aria-current', 'page');
    await page.reload();
    await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
  });

  test('says what to do when there were no requests', async ({ page }) => {
    await signIn(page, WEDDING_OWNER);
    await page.goto('/o/rosewood-weddings/api-keys/usage');
    await expect(page.getByText('No API requests in this period')).toBeVisible();
    await expect(
      page.getByRole('main').getByRole('link', { name: 'API keys', exact: true }).first(),
    ).toBeVisible();
    await expectAccessible(page);
  });

  test('a viewer sees neither usage nor sandboxes', async ({ page }) => {
    await signIn(page, VIEWER);
    await page.goto(USAGE);
    await expect(page.getByText('Only owners and admins manage API keys')).toBeVisible();
    await expect(page.getByTestId('usage-total-requests')).toHaveCount(0);
    await expectAccessible(page);
    await page.goto(SANDBOXES);
    await expect(page.getByText('Only owners and admins manage sandboxes')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create sandbox' })).toHaveCount(0);
    await expectAccessible(page);
    await page.goto(KEYS);
    await expect(page.getByRole('button', { name: 'Create key' })).toHaveCount(0);
  });

  test('renders right-to-left in Arabic', async ({ page }) => {
    await signIn(page);
    await page.goto(`/ar${USAGE}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'استخدام API', level: 1 })).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar${KEYS}`);
    await expect(page.getByText('تنتهي صلاحيته', { exact: true })).toBeVisible();
  });
});

test.describe('sandbox orgs (M6.3a)', () => {
  test('an owner creates a seeded sandbox, works in it under the SANDBOX banner, then deletes it', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(KEYS);
    await page.locator('#main').getByRole('link', { name: 'Sandboxes' }).click();
    await expect(page).toHaveURL(/\/sandboxes$/);
    await expect(page.getByRole('heading', { name: 'Sandboxes', level: 1 })).toBeVisible();
    await expect(page.getByText('Payments are always fake')).toBeVisible();
    await expectAccessible(page);

    // Validation first: a name is required.
    await page.getByRole('button', { name: 'Create sandbox' }).click();
    await expect(page.getByText('Give the sandbox a name.')).toBeVisible();
    await expect(page.getByLabel('Name', { exact: true })).toHaveAttribute('aria-invalid', 'true');

    const name = unique('E2E sandbox');
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Create sandbox' }).click();
    await expect(page.getByText(`Sandbox “${name}” created with a sample event.`)).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toContainText('lakeside-events-sandbox-');
    const slug = ((await row.getByRole('cell').nth(1).textContent()) ?? '').trim();
    expect(slug).toMatch(/^lakeside-events-sandbox-[0-9a-f]{6}$/);
    await page.reload();
    await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();

    // Inside the sandbox: the banner on every page, the seeded event, its own keys.
    await page.getByRole('link', { name: `Open sandbox ${name}` }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}$`));
    const banner = page.getByTestId('sandbox-banner');
    await expect(banner).toContainText('SANDBOX');
    await expect(banner).toContainText('Payments are fake');
    await expect(page.getByText('Sample conference').first()).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/o/${slug}/api-keys`);
    await expect(page.getByTestId('sandbox-banner')).toBeVisible();
    const key = await createKey(page, unique('Sandbox key'), [
      'Read the organization',
      'Read events and ticket types',
    ]);
    const r = await page.request.get(`/api/v1/orgs/${slug}/events`, { headers: auth(key) });
    expect(r.status()).toBe(200);
    expect(r.headers()['ratelimit-limit']).toBe('300');
    const events = (await r.json()).data as { name: string; status: string }[];
    expect(events.map((e) => [e.name, e.status])).toEqual([['Sample conference', 'published']]);
    const self = await (
      await page.request.get(`/api/v1/orgs/${slug}/api-key`, { headers: auth(key) })
    ).json();
    expect(self.sandboxOrg).toBe(true);
    // The sandbox's key never reaches the parent org.
    expect((await page.request.get('/api/v1/orgs/lakeside-events', { headers: auth(key) })).status()).toBe(
      404,
    );
    // A sandbox can't have sandboxes.
    await page.goto(`/o/${slug}/sandboxes`);
    await expect(page.getByText('A sandbox can’t have sandboxes of its own')).toBeVisible();

    // Delete it from the parent: gone from the list, closed, its key refused.
    await page.goto(SANDBOXES);
    const live = page.getByRole('row').filter({ hasText: name });
    await live.getByText('Delete', { exact: true }).click();
    await expect(live.getByText('It closes for good')).toBeVisible();
    await live.getByRole('button', { name: `Delete sandbox ${name} for good` }).click();
    await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0);
    expect((await page.request.get(`/api/v1/orgs/${slug}/events`, { headers: auth(key) })).status()).toBe(
      401,
    );
    const gone = await page.goto(`/o/${slug}`);
    expect(gone?.status()).toBe(404);
  });

  test('creates and deletes a sandbox with the keyboard alone', async ({ page }) => {
    await signIn(page);
    await page.goto(SANDBOXES);
    const name = unique('Keyboard sandbox');
    await page.getByLabel('Name', { exact: true }).focus();
    await page.keyboard.type(name);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Create sandbox' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText(`Sandbox “${name}” created with a sample event.`)).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: name });
    await row.locator('summary').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await expect(row.getByRole('button', { name: `Delete sandbox ${name} for good` })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0);
  });

  test('shows an empty state for an org without sandboxes', async ({ page }) => {
    await signIn(page, WEDDING_OWNER);
    await page.goto('/o/rosewood-weddings/sandboxes');
    await expect(page.getByText('No sandboxes yet')).toBeVisible();
    await expect(page.getByText('Create one to try the API')).toBeVisible();
    await expectAccessible(page);
  });

  test('renders right-to-left in Arabic, banner included', async ({ page }) => {
    await signIn(page);
    await page.goto(SANDBOXES);
    const name = unique('Arabic sandbox');
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Create sandbox' }).click();
    await expect(page.getByText(`Sandbox “${name}” created with a sample event.`)).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: name });
    const slug = ((await row.getByRole('cell').nth(1).textContent()) ?? '').trim();
    await page.goto(`/ar${SANDBOXES}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'بيئات الاختبار', level: 1 })).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar/o/${slug}`);
    await expect(page.getByTestId('sandbox-banner')).toContainText('هذه مؤسسة اختبار');
    await expectAccessible(page);
    // Clean up (in Arabic too: the locale sticks to the session).
    await page.goto(`/ar${SANDBOXES}`);
    const live = page.getByRole('row').filter({ hasText: name });
    await live.locator('summary').click();
    await live.getByRole('button', { name: `حذف بيئة الاختبار ${name} نهائيًا` }).click();
    await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0);
  });
});
