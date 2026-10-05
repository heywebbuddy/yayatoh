import { expect, test } from '@playwright/test';
import { expectAccessible } from './helpers.ts';

test.describe('developer docs (M6.3b)', () => {
  test('the home page searches as you type and links to guides, reference and events', async ({ page }) => {
    await page.goto('/developers');
    await expect(page.getByRole('heading', { name: 'Developers', level: 1 })).toBeVisible();
    await expectAccessible(page);
    const search = page.getByRole('searchbox', { name: 'Search the docs' });
    await search.fill('signature');
    const results = page.getByRole('list', { name: 'Search results' });
    await expect(results.getByRole('link', { name: /Webhooks and signature verification/ })).toBeVisible();
    await expect(page.getByText(/\d+ results?/)).toBeAttached();
    await expectAccessible(page);
    await search.fill('order.paid');
    await expect(results.getByRole('link', { name: /order\.paid/ }).first()).toBeVisible();
    await search.fill('zzzzqqq');
    await expect(page.getByText('Nothing matches.')).toBeVisible();
    await search.press('Escape');
    await expect(search).toHaveValue('');
  });

  test('search works without JavaScript (the form submits to the server)', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/developers');
    await page.getByRole('searchbox', { name: 'Search the docs' }).fill('idempotency');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/\/developers\?q=idempotency/);
    const results = page.getByRole('region', { name: 'Results for “idempotency”' });
    await expect(results).toBeVisible();
    await expect(results.getByRole('link', { name: /Idempotency and retries/ })).toBeVisible();
    await context.close();
  });

  test('keyboard only: skip link, search, and open a result', async ({ page }) => {
    await page.goto('/developers');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await page.getByRole('searchbox', { name: 'Search the docs' }).focus();
    await page.keyboard.type('pagination');
    const link = page
      .getByRole('list', { name: 'Search results' })
      .getByRole('link', { name: /^Guide.*Pagination/ });
    await expect(link).toBeVisible();
    // Tab past the Search button to the first result, and open it.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/developers\/guides\/pagination$/);
    await expect(page.getByRole('heading', { name: 'Pagination', level: 1 })).toBeVisible();
  });

  test('every guide renders, the webhooks guide shows the tested verification code', async ({ page }) => {
    await page.goto('/developers/guides');
    for (const title of [
      'Authentication with API keys',
      'Pagination',
      'Idempotency and retries',
      'Webhooks and signature verification',
      'Sandbox orgs and test data',
    ])
      await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible();
    await page.getByRole('link', { name: /Webhooks and signature verification/ }).click();
    await expect(
      page.getByRole('heading', { name: 'Webhooks and signature verification', level: 1 }),
    ).toBeVisible();
    const code = page.getByRole('region', { name: 'verify.js (Node 18+, no dependencies)' });
    await expect(code).toContainText('export function verifyYayatohWebhook');
    await expect(code).toContainText("createHmac('sha256', key)");
    await expectAccessible(page);
    expect((await page.goto('/developers/guides/no-such-guide'))?.status()).toBe(404);
  });

  test('the API reference is generated from OpenAPI', async ({ page }) => {
    await page.goto('/developers/reference');
    await expect(page.getByRole('heading', { name: 'API reference', level: 1 })).toBeVisible();
    const list = page.locator('article').filter({ hasText: '/v1/orgs/{org}/events' }).first();
    await expect(list).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /GET\s*\/v1\/orgs\/\{org\}\/events$/ }).first(),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Try it in the interactive reference' })).toHaveAttribute(
      'href',
      '/api/v1/docs',
    );
    await expectAccessible(page);
  });

  test('the event catalog lists every event with its schema and an example', async ({ page }) => {
    await page.goto('/developers/events');
    await expect(page.getByRole('heading', { name: 'Webhook events', level: 1 })).toBeVisible();
    const paid = page.locator('#order-paid-v1');
    await expect(paid.getByRole('heading', { name: /order\.paid/ })).toBeVisible();
    await expect(paid.getByRole('cell', { name: 'totalMinor' })).toBeVisible();
    await expect(paid.getByRole('region', { name: 'Example order.paid message' })).toContainText(
      '"type": "order.paid"',
    );
    for (const type of ['event.cancelled', 'ticket.admitted', 'form.registration_submitted', 'webhook.test'])
      await expect(page.getByRole('heading', { name: new RegExp(type.replace('.', '\\.')) })).toBeVisible();
    await expectAccessible(page);
  });

  test('Arabic: the shell is translated and right to left; the reference stays English', async ({ page }) => {
    await page.goto('/ar/developers');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'المطورون', level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'وثائق المطورين' })).toBeVisible();
    await page.getByRole('searchbox', { name: 'ابحث في الوثائق' }).fill('webhook');
    await expect(page.getByRole('list', { name: 'نتائج البحث' }).getByRole('link').first()).toBeVisible();
    await expectAccessible(page);
    await page.goto('/ar/developers/events');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('#order-paid-v1 [lang="en"]').first()).toBeVisible();
    await expectAccessible(page);
    await page.goto('/ar/developers/guides/webhooks');
    await expect(page.locator('article[lang="en"][dir="ltr"]')).toBeVisible();
    await expectAccessible(page);
  });
});
