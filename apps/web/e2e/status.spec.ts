import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';

// The status page reads the StatusPage port; in e2e that's the fake provider, whose incidents
// staff post from the admin console (apps/admin/e2e/incidents.spec.ts) and this suite posts
// through the dev-only route. Incidents are platform-wide: one project posts, and resolves its
// incident before it finishes, so the banner never lingers for other suites.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const APEX = `http://yayatoh.localhost:${PORT}`;

async function incident(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post('/api/dev/status-incident', { data: body });
  expect(res.status()).toBe(200);
  return (await res.json()) as { id?: string; updated?: boolean };
}

test.describe('status page (M3.11b)', () => {
  test('components and history, keyboard reachable from every page footer, Arabic RTL', async ({ page }) => {
    await page.goto(`${APEX}/help`);
    const footer = page.getByRole('contentinfo');
    await footer.getByRole('link', { name: 'System status' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/status$/);
    await expect(page.getByRole('heading', { level: 1, name: 'System status' })).toBeVisible();
    await expect(page.locator('[data-component]')).toHaveCount(7);
    await expect(page.getByRole('heading', { level: 2, name: 'Services' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Past 14 days' })).toBeVisible();
    await expectAccessible(page);

    await page.goto(`${APEX}/ar/status`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('[data-component="checkout"]')).toBeVisible();
    await expectAccessible(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('an incident shows on the status page and as a banner in the marketplace and the console until resolved', async ({
    page,
  }) => {
    test.skip(
      test.info().project.name !== 'desktop-1280',
      'platform-wide state: one project posts incidents',
    );
    test.setTimeout(120_000);
    const title = `Scanner sync delayed ${Date.now()}`;
    const { id } = await incident(page, {
      title,
      impact: 'critical',
      components: ['checkin', 'checkout'],
      body: 'Scans are queuing on some devices.',
    });
    try {
      await page.goto(`${APEX}/status`);
      await expect(
        page.locator('section[aria-labelledby="status-open"]').getByRole('heading', { name: title }),
      ).toBeVisible();
      await expect(page.locator('[data-component="checkin"]')).toContainText('Major outage');
      await expect(page.locator('section[data-overall]')).toHaveAttribute('data-overall', 'major_outage');
      await expect(
        page
          .getByRole('list', { name: `Updates on ${title}` })
          .getByText('Scans are queuing on some devices.'),
      ).toBeVisible();
      await expectAccessible(page);

      // The marketplace banner: the incident's title and a link to the status page.
      await page.goto(`${APEX}/events`);
      const banner = page.getByRole('region', { name: 'Service status' });
      await expect(banner).toContainText(`We're having an issue: ${title}`);
      await expect(banner.getByRole('link', { name: 'See the status page' })).toHaveAttribute(
        'href',
        `${APEX}/status`,
      );
      await expectAccessible(page);
      await page.goto(`${APEX}/ar/events`);
      await expect(page.getByRole('region', { name: 'حالة الخدمة' })).toBeVisible();
      await expectAccessible(page);
      // Back to English (the language choice is remembered per host).
      await page.goto(`${APEX}/lang/en`);

      // The console banner.
      await signIn(page);
      await page.goto('/o/lakeside-events');
      const consoleBanner = page.getByRole('region', { name: 'Service status' });
      await expect(consoleBanner).toContainText(title);
      await expectAccessible(page);

      // An update moves it along; resolving it clears the banners.
      await incident(page, { id, status: 'identified', body: 'A sync job is stuck; restarting it.' });
      await page.goto(`${APEX}/status`);
      await expect(
        page
          .getByRole('list', { name: `Updates on ${title}` })
          .getByText('A sync job is stuck; restarting it.'),
      ).toBeVisible();
    } finally {
      await incident(page, { id, status: 'resolved', body: 'Scans are syncing normally again.' });
    }
    await page.goto('/o/lakeside-events');
    await expect(page.getByRole('region', { name: 'Service status' })).toHaveCount(0);
    await page.goto(`${APEX}/status`);
    await expect(
      page.locator('section[aria-labelledby="status-past"]').getByRole('heading', { name: title }),
    ).toBeVisible();
  });

  test('the dev route is validated', async ({ page }) => {
    const bad = await page.request.post('/api/dev/status-incident', {
      data: { title: '', impact: 'minor', body: 'x' },
    });
    expect(bad.status()).toBe(400);
  });
});
