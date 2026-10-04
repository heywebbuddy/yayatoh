import { expect, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { localKeyVault, setKeyVault } from '@yayatoh/platform';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { audienceScenario, mergeScenario } from '@yayatoh/testing';
import {
  ageSession,
  codeForKey,
  confirmStepUp,
  expectAccessibleBothModes,
  newUser,
  pickWithKeyboard,
} from './helpers.ts';

/**
 * Phase 6 journeys, part A (M6.x hardening). One end-to-end journey per track, each chaining the
 * track's real UI flows (reusing the per-feature specs' selectors), with a keyboard-only segment,
 * axe in light and dark on the key screens, and an Arabic RTL render of the main screen.
 *
 * - CRM: a fresh org with the audience scenario. Audiences (empty state) -> build a segment with
 *   the keyboard (live count and preview) -> save -> reload -> export CSV -> People search ->
 *   the M6.1 duplicate queue -> review and merge with the keyboard -> merged timeline -> Arabic.
 * - API: an owner creates a live key (shown once), uses it on /api/v1 -> creates a test key with
 *   the keyboard alone -> runs it into the rate limit (429) -> revokes it with step-up -> the very
 *   next request is 401 (problem+json) -> the key list shows it revoked -> Arabic.
 * - Integrations: connect the Demo CRM through the fake consent -> sync -> the synced contacts show
 *   in People (CRM) -> the errors inbox shows the bad record -> fix at the provider, retry, sync ->
 *   the fixed contact appears in People -> keyboard Sync now / pause / resume -> disconnect ->
 *   Arabic.
 */

// Tickets are signed with the org's keys: seal them under the web server's key vault.
const kms = process.env.LOCAL_KMS_KEY;
if (kms) setKeyVault(localKeyVault(kms));

test.afterAll(async () => {
  await closePools();
});

const stamp = () => `${test.info().project.name} ${Date.now()}`;

test.describe('Phase 6 journeys A', () => {
  test.describe.configure({ timeout: 480_000 });

  test('CRM: segment, export, people, duplicates and merge', async ({ page }) => {
    const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
    const slug = owner.orgSlug as string;
    const org = await resolveOrgSlug(slug);
    if (!org) throw new Error(`no org ${slug}`);
    await audienceScenario(org.orgId);

    const count = page.getByTestId('audience-count');
    const previewNames = async () =>
      (await page.getByRole('table').locator('tbody tr td:first-child').allInnerTexts()).sort();

    // Audiences: the empty state, then a segment built with the keyboard.
    await page.goto(`/o/${slug}/audiences`);
    await expect(page.getByRole('heading', { level: 1, name: 'Audiences' })).toBeVisible();
    await expect(page.getByText('No saved audiences yet')).toBeVisible();
    await expectAccessibleBothModes(page);
    await page.getByRole('link', { name: 'New audience' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'New audience' })).toBeVisible();
    await expect(count).toHaveText('9 people match');

    // Keyboard only: Tab to "Add condition", Enter, then choose "Checked in: no" with the keys.
    const add = page.getByRole('button', { name: 'Add condition' }).first();
    await page.getByLabel('New condition').first().focus();
    await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    await page.keyboard.press('Enter');
    const condition = page.getByRole('group', { name: 'Condition 1: Took part in an event' });
    await expect(condition).toBeVisible();
    await expect(count).toHaveText('5 people match');
    await pickWithKeyboard(condition.getByLabel('Checked in'), 'no');
    await expect(count).toHaveText('4 people match');
    await expect.poll(previewNames).toEqual(['Ava', 'Cy', 'Fin', 'Ivy']);
    await expectAccessibleBothModes(page);

    const audienceName = `No-shows ${stamp()}`;
    await page.getByLabel('Audience name').fill(audienceName);
    await page.getByRole('button', { name: 'Save audience' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Audience saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: audienceName })).toBeVisible();
    await expect(count).toHaveText('4 people match');

    // Export: the saved audience as a CSV with the consent column and one row per person.
    await page.getByRole('button', { name: 'Export CSV' }).click();
    await expect(page.getByText('Export ready: 4 people')).toBeVisible();
    const href = await page.getByRole('link', { name: 'Download CSV' }).getAttribute('href');
    const csv = await (await page.request.get(href ?? '')).text();
    expect(csv).toContain('Email marketing consent');
    expect(csv.trim().split('\n')).toHaveLength(5);

    await page.goto(`/o/${slug}/audiences`);
    await expect(page.getByRole('row', { name: new RegExp(audienceName) })).toContainText('4');
    await expectAccessibleBothModes(page);

    // People, then the merge scenario's duplicate pair.
    const m = await mergeScenario(org.orgId);
    await page.goto(`/o/${slug}/audiences/people`);
    await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible();
    const search = page.getByLabel('Search by name, email or company');
    await search.fill('Lakeside Partners');
    await search.press('Enter');
    await expect(page.getByRole('link', { name: 'Taylor Reed' })).toHaveCount(1);
    await expectAccessibleBothModes(page);

    await page.goto(`/o/${slug}/audiences/duplicates`);
    await page.getByRole('button', { name: 'Look for duplicates' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Found 1 possible duplicate.')).toBeVisible();
    await expectAccessibleBothModes(page);

    // Review and merge with the keyboard; the merged person keeps every record's history.
    await page.goto(`/o/${slug}/audiences/duplicates`);
    const review = page.getByRole('link', { name: 'Review Taylor Reed and Taylor Reed' });
    await review.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Review possible duplicate' })).toBeVisible();
    await expect(page.getByTestId('merged-consent')).toContainText('Marketing email: Opted out');
    await expectAccessibleBothModes(page);
    await page.getByRole('button', { name: 'Merge records' }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByText('Records merged. You can undo this for 30 days from this page.'),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Taylor Reed' })).toBeVisible();
    const entries = page.getByTestId('timeline-entry');
    await expect(entries.filter({ hasText: 'Order paid' })).toHaveCount(3);
    await expect(page.getByText(`Merged Taylor Reed (${m.dup.email})`)).toBeVisible();
    // The timeline rows used `bg-white` and failed dark-mode contrast (fixed in M6.x).
    await expectAccessibleBothModes(page);
    await page.goto(`/o/${slug}/audiences/people?q=${m.tag}`);
    await expect(page.getByRole('link', { name: 'Taylor Reed' })).toHaveCount(1);

    // Arabic RTL (last: the language sticks): the queue and the merged person's timeline.
    await page.goto(`/ar/o/${slug}/audiences/duplicates`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'تكرارات محتملة' })).toBeVisible();
    await expectAccessibleBothModes(page);
    await page.goto(`/ar/o/${slug}/audiences/people/${m.keep.contactId}`);
    await expect(page.getByRole('heading', { name: 'الخط الزمني' })).toBeVisible();
    await expectAccessibleBothModes(page);
  });

  test('API: key with step-up revoke, /api/v1 use, rate limit, 401 after', async ({ page }) => {
    const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
    const slug = owner.orgSlug as string;
    const keys = `/o/${slug}/api-keys`;
    const auth = (key: string) => ({ authorization: `Bearer ${key}` });
    const live = `Journey live ${stamp()}`;
    const sandbox = `Journey test ${stamp()}`;

    await page.goto(keys);
    await expect(page.getByRole('heading', { name: 'API keys', level: 1 })).toBeVisible();
    await expect(page.getByText('No API keys yet.')).toBeVisible();
    await expectAccessibleBothModes(page);

    // A live key by mouse: shown once, listed by prefix, gone after a reload.
    await page.getByLabel('Name', { exact: true }).fill(live);
    await page.getByRole('checkbox', { name: 'Read the organization' }).check();
    await page.getByRole('checkbox', { name: 'Read events and ticket types' }).check();
    await page.getByRole('button', { name: 'Create key' }).click();
    await expect(page.getByText(`Key “${live}” created.`)).toBeVisible();
    const liveKey = (await page.getByTestId('new-api-key').textContent()) ?? '';
    expect(liveKey).toMatch(/^yy_live_[A-Za-z0-9_-]{43}$/);
    await expect(page.getByText('it will not be shown again')).toBeVisible();
    await expectAccessibleBothModes(page);
    await page.reload();
    await expect(page.getByTestId('new-api-key')).toHaveCount(0);
    await expect(page.getByRole('row').filter({ hasText: live })).toContainText('Active');

    // It works on /v1 for its own org, within its scopes only.
    const ok = await page.request.get(`/api/v1/orgs/${slug}/events?limit=1`, { headers: auth(liveKey) });
    expect(ok.status()).toBe(200);
    const denied = await page.request.post(`/api/v1/orgs/${slug}/events`, {
      headers: { ...auth(liveKey), 'idempotency-key': `e2e-${Date.now()}-deny` },
      data: {
        name: 'Nope',
        timezone: 'UTC',
        startsAt: '2030-01-01T10:00:00Z',
        endsAt: '2030-01-01T11:00:00Z',
      },
    });
    expect(denied.status()).toBe(403);

    // A test key, keyboard only (arrow keys pick the key type).
    await page.getByLabel('Name', { exact: true }).focus();
    await page.keyboard.type(sandbox);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect(page.getByRole('checkbox', { name: 'Read the organization' })).toBeChecked();
    await page.getByRole('radio', { name: 'Live key' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio', { name: 'Test key' })).toBeChecked();
    await page.getByRole('button', { name: 'Create key' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(`Key “${sandbox}” created.`)).toBeVisible();
    const testKey = (await page.getByTestId('new-api-key').textContent()) ?? '';
    expect(testKey).toMatch(/^yy_test_[A-Za-z0-9_-]{43}$/);
    await expect(
      page.getByRole('row').filter({ hasText: sandbox }).getByTestId('test-key-badge'),
    ).toBeVisible();

    // The test key's smaller budget (120 a minute): run into it, then it answers 429 with a reason.
    const first = await page.request.get(`/api/v1/orgs/${slug}`, { headers: auth(testKey) });
    expect(first.status()).toBe(200);
    expect(first.headers()['ratelimit-limit']).toBe('120');
    let limited = 0;
    for (let i = 0; i < 130 && !limited; i++) {
      const r = await page.request.get(`/api/v1/orgs/${slug}`, { headers: auth(testKey) });
      if (r.status() === 429) limited = i + 1;
      else expect(r.status()).toBe(200);
    }
    expect(limited).toBeGreaterThan(0);
    const again = await page.request.get(`/api/v1/orgs/${slug}`, { headers: auth(testKey) });
    expect(again.status()).toBe(429);
    expect(again.headers()['retry-after']).toBeTruthy();
    // Another key of the same org is not affected by it.
    expect((await page.request.get(`/api/v1/orgs/${slug}`, { headers: auth(liveKey) })).status()).toBe(200);

    // Revoke needs a fresh sign-in: the step-up dialog, then the key is refused at once.
    await page.reload();
    await ageSession(page);
    const revoke = page.getByRole('button', { name: `Revoke key ${sandbox}` });
    await revoke.focus();
    await page.keyboard.press('Enter');
    await confirmStepUp(page, codeForKey(owner.setupKey as string));
    await expect(page.getByRole('row').filter({ hasText: sandbox })).toContainText('Revoked');
    const refused = await page.request.get(`/api/v1/orgs/${slug}`, { headers: auth(testKey) });
    expect(refused.status()).toBe(401);
    expect(refused.headers()['content-type']).toBe('application/problem+json');
    expect((await refused.json()).code).toBe('unauthenticated');
    await page.reload();
    await expect(page.getByRole('row').filter({ hasText: sandbox })).toContainText('Revoked');
    await expect(page.getByRole('row').filter({ hasText: live })).toContainText('Active');
    await expectAccessibleBothModes(page);

    // Arabic RTL of the key screen.
    await page.goto(`/ar${keys}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'مفاتيح API', level: 1 })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: sandbox }).getByTestId('test-key-badge')).toHaveText(
      'اختبار',
    );
    await expectAccessibleBothModes(page);
  });

  test('Integrations: connect, sync into the CRM, fix an error, disconnect', async ({ page }) => {
    const owner = await newUser(page, { org: true, twoFactor: true });
    const org = owner.orgSlug as string;
    const runSyncs = async () => {
      const res = await page.request.post('/api/dev/integrations/run', { form: { org } });
      expect(res.ok()).toBe(true);
    };
    const searchPeople = async (q: string) => {
      await page.goto(`/o/${org}/audiences/people?q=${encodeURIComponent(q)}`);
    };

    await page.goto(`/o/${org}/integrations`);
    await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toBeVisible();
    await expectAccessibleBothModes(page);
    // The CRM has none of the provider's people yet.
    await searchPeople('demo-remote.test');
    await expect(page.getByText('No one matches')).toBeVisible();

    // Connect through the fake consent screen, by keyboard.
    await page.goto(`/o/${org}/integrations`);
    const connect = page.getByRole('button', { name: 'Connect Demo CRM' });
    await connect.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Connect Demo CRM to Yayatoh?' })).toBeVisible();
    await expectAccessibleBothModes(page);
    const allow = page.getByRole('button', { name: 'Allow' });
    await allow.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Demo CRM is connected. The first sync starts shortly.')).toBeVisible();
    const connection = /\/integrations\/([0-9a-f-]{36})/.exec(page.url())?.[1] as string;
    expect(connection).toBeTruthy();

    // Sync: three good records, one with errors.
    await runSyncs();
    await page.reload();
    const runs = page.getByRole('table', { name: 'Recent syncs of this integration' });
    await expect(runs.getByRole('row').nth(1)).toContainText('Synced with errors');
    await expectAccessibleBothModes(page);

    // The synced people are in the CRM; the broken record is not.
    await searchPeople('demo-remote.test');
    for (const name of ['Ada Lovelace', 'Grace Hopper', 'Katherine Johnson'])
      await expect(page.getByRole('link', { name })).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Broken Record' })).toHaveCount(0);
    await expectAccessibleBothModes(page);

    // Errors inbox: grouped, with what went wrong; fix at the source, retry, sync again.
    await page.goto(`/o/${org}/integrations/${connection}`);
    await page.getByRole('link', { name: /^Errors/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Integration errors' })).toBeVisible();
    const group = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: /Demo CRM: Mapping · 1 record/ }) });
    await expect(group).toContainText('Field: email');
    await expectAccessibleBothModes(page);
    const fix = await page.request.post('/api/dev/integrations/fake', {
      form: { connection, action: 'fix' },
    });
    expect(fix.ok()).toBe(true);
    await group.getByRole('button', { name: 'Retry dc_4' }).click();
    await expect(page.getByText('1 record will be retried on the next sync.')).toBeVisible();
    await runSyncs();
    await page.goto(`/o/${org}/integrations/errors`);
    await expect(page.getByText('No open errors', { exact: true })).toBeVisible();
    await searchPeople('Broken Record');
    await expect(page.getByRole('link', { name: 'Broken Record' })).toHaveCount(1);

    // Keyboard only: Sync now, pause, resume.
    await page.goto(`/o/${org}/integrations/${connection}`);
    const sync = page.getByRole('button', { name: 'Sync now' });
    await sync.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Sync started. Refresh in a moment to see the result.')).toBeVisible();
    const pause = page.getByRole('button', { name: 'Pause syncing' });
    await pause.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Syncing is paused.')).toBeVisible();
    const resume = page.getByRole('button', { name: 'Resume syncing' });
    await resume.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Syncing is back on.')).toBeVisible();

    // Disconnect: confirm first; the connection is then shown as disconnected.
    await page.goto(`/o/${org}/integrations/${connection}`);
    await page.getByRole('link', { name: 'Disconnect' }).click();
    await expect(page.getByText('Disconnect Demo CRM?')).toBeVisible();
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(
      page.getByText('Disconnected. Nothing syncs any more and access was revoked at the provider.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sync now' })).toHaveCount(0);
    // The people it brought in stay in the CRM.
    await searchPeople('Ada Lovelace');
    await expect(page.getByRole('link', { name: 'Ada Lovelace' })).toHaveCount(1);

    // Arabic RTL of the connection list.
    await page.goto(`/ar/o/${org}/integrations`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'التكاملات' })).toBeVisible();
    await expectAccessibleBothModes(page);
  });
});
