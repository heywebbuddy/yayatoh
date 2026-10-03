import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, pickOption, signIn } from './helpers.ts';

// The help center is the platform CMS of the marketplace content org (Harbor Arts in e2e, see
// playwright.config.ts), seeded with the starter articles (apps/web/src/content/platform-starter.ts).
const PORT = Number(process.env.E2E_PORT ?? 3100);
const APEX = `http://yayatoh.localhost:${PORT}`;
const CONTENT_OWNER = 'lee@harbor.test';
const CONSOLE = '/o/harbor-arts/help-center';

const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('help center (M3.11b)', () => {
  test('browse: audiences, categories, an article with breadcrumbs, related articles and JSON-LD', async ({
    page,
  }) => {
    await page.goto(`${APEX}/help`);
    await expect(page.getByRole('heading', { level: 1, name: 'Help center' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'For organizers' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'For ticket buyers' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Help', exact: true })).toBeVisible();
    await noHorizontalScroll(page);
    await expectAccessible(page);

    await page.getByRole('link', { name: 'Refunds and payouts', exact: true }).click();
    await expect(page).toHaveURL(/\/help\/refunds-and-payouts$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Refunds and payouts' })).toBeVisible();
    await expectAccessible(page);

    await page.getByRole('link', { name: 'Refund an order' }).click();
    await expect(page).toHaveURL(/\/help\/refunds-and-payouts\/refund-an-order$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Refund an order' })).toBeVisible();
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumbs' });
    await expect(crumbs.getByRole('link', { name: 'Help center' })).toHaveAttribute('href', '/help');
    await expect(crumbs.getByRole('link', { name: 'Refunds and payouts' })).toBeVisible();
    // Related: the same category first.
    const related = page.getByRole('list', { name: 'Related articles' });
    await expect(related.getByRole('link').first()).toHaveText('Get paid: payouts');
    const ld = JSON.parse(
      (await page.locator('script[type="application/ld+json"]').first().textContent()) ?? '{}',
    );
    expect(ld['@type']).toBe('BreadcrumbList');
    expect(ld.itemListElement).toHaveLength(3);
    // SEO: canonical on the apex, 13 hreflang alternates + x-default.
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${APEX}/help/refunds-and-payouts/refund-an-order`,
    );
    await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(14);
    await noHorizontalScroll(page);
    await expectAccessible(page);

    // An article under the wrong category forwards to its real address.
    await page.goto(`${APEX}/help/check-in/sell-tickets`);
    await expect(page).toHaveURL(/\/help\/selling-tickets\/sell-tickets$/);
  });

  test('search with the keyboard: ranked results, counts, nothing found', async ({ page }) => {
    await page.goto(`${APEX}/help`);
    const field = page.getByRole('searchbox', { name: 'Search help articles' });
    await field.focus();
    await page.keyboard.type('refund');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/help\/search\?q=refund$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Results for “refund”' })).toBeVisible();
    const results = page.getByRole('list', { name: 'Search results' }).getByRole('link');
    // Title matches first.
    const top = await results.evaluateAll((els) => els.slice(0, 2).map((e) => e.textContent));
    expect(top.sort()).toEqual(['Ask for a refund', 'Refund an order']);
    await expect(page.getByRole('status').filter({ hasText: /articles found/ })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expectAccessible(page);

    await page.getByRole('searchbox', { name: 'Search help articles' }).fill('zzqqxx nothing');
    await page.getByRole('searchbox', { name: 'Search help articles' }).press('Enter');
    await expect(page.getByText('Nothing matches your search')).toBeVisible();
    await expect(page.getByText('No articles found')).toBeVisible();
    await expectAccessible(page);
  });

  test('"was this helpful?": no with a reason, announced; yes replaces it', async ({ page }) => {
    await page.goto(`${APEX}/help/check-in/check-in-with-the-scan-app`);
    const box = page.getByRole('region', { name: 'Was this article helpful?' });
    await box.getByRole('button', { name: 'No', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(box.getByRole('status')).toHaveText(
      "Thanks. We'll use your answer to improve this article.",
    );
    await box.getByRole('radio', { name: 'Something was missing' }).check();
    await box.getByRole('button', { name: 'Send' }).click();
    await expect(box.getByRole('radio')).toHaveCount(0);
    await expect(box.getByRole('status')).toHaveText(
      "Thanks. We'll use your answer to improve this article.",
    );
    await expectAccessible(page);
    await page.reload();
    await page
      .getByRole('region', { name: 'Was this article helpful?' })
      .getByRole('button', { name: 'Yes' })
      .click();
    await expect(
      page.getByRole('region', { name: 'Was this article helpful?' }).getByRole('status'),
    ).toHaveText('Thanks for letting us know.');
  });

  test('unpublished articles are hidden: 404, not listed, not found by search', async ({ page }) => {
    const res = await page.goto(`${APEX}/help/your-tickets/wallet-passes`);
    expect(res?.status()).toBe(404);
    await page.goto(`${APEX}/help/your-tickets`);
    await expect(page.getByRole('link', { name: 'Find your tickets' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add tickets to your phone wallet' })).toHaveCount(0);
    await page.goto(`${APEX}/help/search?q=wallet`);
    await expect(page.getByRole('link', { name: 'Add tickets to your phone wallet' })).toHaveCount(0);
    // The sitemap doesn't list it either.
    const sitemap = (await (await page.goto(`${APEX}/sitemaps/en.xml`))?.text()) ?? '';
    expect(sitemap).toContain('/help/your-tickets/find-your-tickets');
    expect(sitemap).not.toContain('wallet-passes');
    // Tenant sites have no help center.
    expect((await page.goto(`http://harbor-arts.yayatoh.events:${PORT}/help`))?.status()).toBe(404);
  });

  test('Arabic: right to left, translated categories and article, English fallback marked', async ({
    page,
  }) => {
    await page.goto(`${APEX}/ar/help`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'مركز المساعدة' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'بيع التذاكر', exact: true })).toBeVisible();
    await noHorizontalScroll(page);
    await expectAccessible(page);

    await page.goto(`${APEX}/ar/help/refunds-and-changes/ask-for-a-refund`);
    await expect(page.getByRole('heading', { level: 1, name: 'طلب استرداد المبلغ' })).toBeVisible();
    await expect(page.locator('article')).not.toHaveAttribute('lang', /./);
    await expectAccessible(page);

    // Not translated: shown in English, marked as English, with a note in Arabic.
    await page.goto(`${APEX}/ar/help/selling-tickets/sell-tickets`);
    await expect(page.locator('article')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('note')).toHaveAttribute('lang', 'ar');
    await page.getByRole('searchbox').fill('استرداد');
    await page.getByRole('searchbox').press('Enter');
    await expect(page).toHaveURL(/\/ar\/help\/search\?q=/);
    await expect(page.getByRole('link', { name: 'طلب استرداد المبلغ' })).toBeVisible();
    await expectAccessible(page);
  });

  test('console: the content org writes an article; drafts stay private until published; other orgs have no help center', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const s = stamp();
    const title = `Door lists ${s}`;
    await signIn(page, CONTENT_OWNER);
    await page.goto(CONSOLE);
    // The content org's navigation links it (the collapsed mobile menu hides it from view).
    if (test.info().project.name === 'desktop-1280')
      await expect(page.getByRole('link', { name: 'Help center' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Help center' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Helpful' })).toBeVisible();
    await expectAccessible(page);

    await page.getByRole('link', { name: 'New article' }).click();
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page.getByText('Enter a title.')).toBeVisible();
    await pickOption(page.getByRole('combobox', { name: 'Category' }), { label: 'Check-in · Organizers' });
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
    await page.getByRole('textbox', { name: 'Summary' }).fill('Print a door list as a backup.');
    await page.getByRole('textbox', { name: 'Text', exact: true }).fill(`Print **${s}** from the event.`);
    await page.getByRole('textbox', { name: 'Search keywords' }).fill(`doorlist${s}`);
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    const slug = (await page.getByRole('textbox', { name: 'Address', exact: true }).inputValue()).trim();
    await expectAccessible(page);

    const pub = await page.context().newPage();
    expect((await pub.goto(`${APEX}/help/check-in/${slug}`))?.status()).toBe(404);
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('Published', { exact: true })).toBeVisible();
    await expect(async () => {
      await pub.goto(`${APEX}/help/search?q=doorlist${s}`);
      await expect(pub.getByRole('link', { name: title })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await pub.getByRole('link', { name: title }).click();
    await expect(pub.getByRole('heading', { level: 1, name: title })).toBeVisible();

    // Delete behind a confirmation (keyboard: the confirm button takes focus).
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('button', { name: 'Yes, delete' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${CONSOLE}\\?deleted=1$`));
    expect((await pub.goto(`${APEX}/help/check-in/${slug}`))?.status()).toBe(404);
    await pub.close();

    // Another org's console has no help center.
    await signIn(page);
    await page.goto('/o/lakeside-events');
    await expect(page.getByRole('link', { name: 'Help center' })).toHaveCount(0);
    expect((await page.goto('/o/lakeside-events/help-center'))?.status()).toBe(404);
  });
});
