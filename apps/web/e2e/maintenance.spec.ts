import { expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { adminClient } from '@yayatoh/db/testing';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { devPassword, expectAccessible } from './helpers.ts';

/**
 * Read-only freeze (M2.5a, roadmap §7.8; runbook docs/runbooks/cutover.md). Staff switch it in the
 * console (apps/admin e2e); here it is set for this test's own org straight in the flag (as the
 * cutover tool does), added to and removed from the frozen list under a lock so the three viewport
 * projects never undo each other. The organizer sees the banner in their language, every save is
 * refused with the maintenance message (and nothing is saved), the public pages and the public API
 * keep answering, and everything works again once it ends.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const tenantSite = (slug: string) => `http://${slug}.yayatoh.events:${PORT}`;

async function freeze(orgId: string, on: boolean, expectedEndAt: string | null = null) {
  // A client per call: with fullyParallel a worker may run afterAll and then another test here.
  const admin = adminClient();
  try {
    await admin.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('e2e:read_only_freeze'))`;
      const [row] = await tx<{ ids: string[] | null; end: string | null }[]>`
      select array(select jsonb_array_elements_text(value->'orgIds')) as ids, value->>'expectedEndAt' as end
      from platform.ops_flags where key = 'read_only_freeze' and value->>'scope' = 'orgs'`;
      const ids = new Set(row?.ids ?? []);
      if (on) ids.add(orgId);
      else ids.delete(orgId);
      const value = ids.size
        ? JSON.stringify({
            scope: 'orgs',
            orgIds: [...ids],
            expectedEndAt: expectedEndAt ?? row?.end ?? null,
          })
        : null;
      await tx`select platform.set_ops_flag('read_only_freeze', ${value}::text::jsonb, 'e2e: maintenance spec', 'e2e')`;
    });
  } finally {
    await admin.end();
  }
}

async function newOrg(page: Page, opts: { twoFactor?: boolean } = {}) {
  const res = await page.request.post('/api/dev/user', {
    // Owners use two-step verification to open their console; the API test signs in by password.
    form: { org: 'new', event: 'published', ...(opts.twoFactor === false ? {} : { twoFactor: '1' }) },
  });
  expect(res.status()).toBe(200);
  const u = (await res.json()) as { email: string; orgSlug: string; eventSlug: string };
  const resolved = await resolveOrgSlug(u.orgSlug);
  if (!resolved) throw new Error('org not found');
  return { email: u.email, slug: u.orgSlug, event: u.eventSlug, orgId: resolved.orgId };
}

const banner = (page: Page, label = 'Maintenance') => page.getByRole('region', { name: label });

test.afterAll(async () => {
  await closePools();
});

test.describe('read-only freeze (M2.5a)', () => {
  test('a frozen org: banner, refused save by keyboard, public pages readable; then back to normal', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const org = await newOrg(page);
    const venue = `Freeze Hall ${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;
    try {
      // Not frozen: no banner.
      await page.goto(`/o/${org.slug}/venues`);
      await expect(page.getByRole('heading', { name: 'Venues', level: 1 })).toBeVisible();
      await expect(banner(page)).toHaveCount(0);

      await freeze(org.orgId, true, new Date(Date.now() + 40 * 60_000).toISOString());
      await page.reload();
      await expect(banner(page)).toContainText('Scheduled maintenance: changes are paused');
      await expect(banner(page)).toContainText('scan tickets at the door');
      await expect(banner(page)).toContainText('until about');
      await expectAccessible(page);

      // Keyboard only: fill the venue form and submit with Enter. Refused, nothing saved.
      await page.getByLabel('Venue name').focus();
      await page.keyboard.type(venue);
      await page.getByLabel('Country code').focus();
      await page.keyboard.type('us');
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('alert').filter({ hasText: 'Changes are paused during scheduled maintenance.' }),
      ).toBeVisible();
      await expectAccessible(page);
      await page.reload();
      await expect(page.getByText(venue)).toHaveCount(0);

      // Another org's console carries no banner (isolation).
      const guest = await (await browser.newContext()).newPage();
      const other = await newOrg(guest);
      await guest.goto(`/o/${other.slug}/venues`);
      await expect(guest.getByRole('heading', { name: 'Venues', level: 1 })).toBeVisible();
      await expect(banner(guest)).toHaveCount(0);

      // Public pages and public reads keep working for the frozen org.
      const visitor = await (await browser.newContext()).newPage();
      const site = await visitor.goto(`${tenantSite(org.slug)}/`);
      expect(site?.status()).toBe(200);
      const ev = await visitor.goto(`/events/${org.event}`);
      expect(ev?.status()).toBe(200);
      await expect(visitor.getByRole('heading', { level: 1 })).toBeVisible();
      const api = await visitor.request.get(`/api/v1/public/events/${org.event}`);
      expect(api.status()).toBe(200);
      await visitor.close();
      await guest.close();

      // Arabic, right to left.
      await page.goto(`/ar/o/${org.slug}/venues`);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(banner(page, 'الصيانة')).toContainText('صيانة مجدولة: التغييرات متوقفة مؤقتًا');
      await expectAccessible(page);
      await page.goto('/lang/en');
    } finally {
      await freeze(org.orgId, false);
    }

    // Ended: the banner is gone and the same save works (and persists after a reload).
    await page.goto(`/o/${org.slug}/venues`);
    await expect(banner(page)).toHaveCount(0);
    await page.getByLabel('Venue name').fill(venue);
    await page.getByLabel('Country code').fill('us');
    await page.getByRole('button', { name: 'Add venue' }).click();
    await expect(page.getByText('Venue added.')).toBeVisible();
    await page.goto(`/o/${org.slug}/venues`);
    await expect(page.getByText(venue).first()).toBeVisible();
  });

  test('a frozen org refuses writes made straight to the API with 503 and Retry-After; reads still answer', async ({
    page,
  }) => {
    const org = await newOrg(page, { twoFactor: false });
    const login = await page.request.post('/api/v1/auth/login', {
      data: { email: org.email, password: devPassword() },
    });
    expect(login.status(), await login.text()).toBe(200);
    const { token } = (await login.json()) as { token: string };
    const name = `Frozen API event ${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;
    const create = (key: string) =>
      page.request.post(`/api/v1/orgs/${org.slug}/events`, {
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
        data: {
          name,
          timezone: 'UTC',
          startsAt: '2031-03-01T18:00:00Z',
          endsAt: '2031-03-01T22:00:00Z',
        },
      });
    await freeze(org.orgId, true);
    try {
      const refused = await create(`freeze-${Date.now()}`);
      expect(refused.status()).toBe(503);
      expect(Number(refused.headers()['retry-after'])).toBeGreaterThan(0);
      expect(await refused.json()).toMatchObject({ code: 'read_only_freeze', status: 503 });
      const list = await page.request.get(`/api/v1/orgs/${org.slug}/events`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(list.status()).toBe(200);
      expect(((await list.json()) as { data: { name: string }[] }).data.map((e) => e.name)).not.toContain(
        name,
      );
    } finally {
      await freeze(org.orgId, false);
    }
    const thawed = await create(`thawed-${Date.now()}`);
    expect(thawed.status(), await thawed.text()).toBe(201);
  });
});
