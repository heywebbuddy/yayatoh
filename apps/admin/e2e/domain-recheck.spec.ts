import { expect, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { fakePaymentProvider } from '@yayatoh/payments';
import { memoryRateLimitStore } from '@yayatoh/platform/security';
import { fakeDomainProvider, resolveOrgSlug } from '@yayatoh/tenancy';
import { recheckPendingDomains } from '@yayatoh/worker';
import { expectAccessible, openTenant, signInStaff, WEB, webPage, webUser } from './helpers.ts';

test.afterAll(async () => {
  await closePools();
});

/**
 * "A domain goes from pending to active" (roadmap M1.3) without anyone pressing "Check now"
 * (M1.3f): the organizer adds a domain on the web app, the worker's re-check job runs (here its
 * tick is run by the test, as the leader would every minute), and the domain is live.
 */
test('a pending custom domain goes active through the worker re-check job, with wallets and primary', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const secret = process.env.FAKE_PAYMENTS_SECRET;
  test.skip(!secret, 'needs FAKE_PAYMENTS_SECRET for the fake domain and payment providers');
  const owner = await webPage(browser);
  const org = await webUser(owner, { org: true });
  const slug = org.orgSlug ?? '';
  const host = `live-${Date.now()}.verified.test`;

  await owner.goto(`/o/${slug}/domains`);
  const add = owner.getByRole('region', { name: 'Add a domain you own' });
  await add.getByLabel('Domain', { exact: true }).fill(host);
  await add.getByRole('button', { name: 'Add domain' }).click();
  const list = owner.getByRole('list', { name: 'Your domains' });
  const mine = list.getByRole('listitem').filter({ hasText: host });
  await expect(mine.getByText('Waiting for DNS')).toBeVisible();
  await expect(
    mine.getByText('We also check again on our own every few minutes, so this page updates without you.'),
  ).toBeVisible();
  await expectAccessible(owner);
  // Arabic: the new line reads right to left.
  await owner.goto(`/ar/o/${slug}/domains`);
  await expect(owner.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(owner.getByText('نتحقق أيضًا من تلقاء أنفسنا كل بضع دقائق')).toBeVisible();
  await expectAccessible(owner);
  await owner.goto(`${WEB}/lang/en`);

  // The worker's tick, two minutes on (the domain was checked once when added).
  const found = await resolveOrgSlug(slug);
  setPlatformAuditSink(async () => {});
  const run = await recheckPendingDomains({
    provider: fakeDomainProvider({ secret: secret ?? '' }),
    payments: fakePaymentProvider({ secret: secret ?? '', appOrigin: WEB }),
    store: memoryRateLimitStore(),
    orgIds: [found?.orgId ?? ''],
    now: new Date(Date.now() + 2 * 60_000),
  });
  expect(run).toMatchObject({ due: 1, checked: 1, activated: 1, failed: 0 });

  // Nobody pressed "Check now": the page shows it live, primary, with wallets.
  await owner.goto(`/o/${slug}/domains`);
  await expect(mine.getByText('Active', { exact: true })).toBeVisible();
  await expect(mine.getByText('Primary', { exact: true })).toBeVisible();
  await expect(mine.getByText('Apple Pay and Google Pay are ready here.')).toBeVisible();
  await expect(mine.getByText(/We also check again on our own/)).toHaveCount(0);
  await expectAccessible(owner);

  // Staff see it active on the tenant page.
  await signInStaff(page);
  await openTenant(page, slug, `Test Org ${slug.replace(/^e2e-/, '')}`);
  await expect(page.getByRole('region', { name: 'Domains' }).getByText(host)).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Domains' }).getByRole('listitem').filter({ hasText: host }),
  ).toContainText('active · primary · wallets ready');
  await owner.close();
});
