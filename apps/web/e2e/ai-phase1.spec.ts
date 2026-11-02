import { expect, type Page, test } from '@playwright/test';
import { expectAccessibleBothModes, OWNER, signIn } from './helpers.ts';

/**
 * AI1: the review summary, support help that fills a box and sends nothing, and a help center
 * answer. The AI provider is the deterministic fake (dev/CI).
 */
const ORG = 'lakeside-events';

async function grantFeatures(page: Page) {
  const res = await page.request.post('/api/dev/ai-features', { form: { org: ORG } });
  expect(res.status()).toBe(200);
  const credits = await page.request.post('/api/dev/ai-credits', { form: { org: ORG, balance: '50' } });
  expect(credits.status()).toBe(200);
}

test.describe('AI phase 1', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('the reviews page offers a summary only with something to read', async ({ page }) => {
    await grantFeatures(page);
    await signIn(page, OWNER);
    await page.goto(`/o/${ORG}/e/lakeside-jazz-night/reviews`);
    await expect(page.getByRole('heading', { name: /review/i }).first()).toBeVisible();
    // The seeded event has no written reviews yet: no panel, and nothing to spend on.
    await expect(page.getByRole('button', { name: 'Summarize answers' })).toHaveCount(0);
    await expectAccessibleBothModes(page);
  });

  test('a help search never spends by itself, and an answer is asked for', async ({ page }) => {
    await page.goto('/help/search?q=refund');
    const ask = page.getByRole('button', { name: 'Get an AI answer' });
    if ((await ask.count()) === 0) test.skip(true, 'No help content on this host');
    await expect(page.getByTestId('help-answer-text')).toHaveCount(0);
    await ask.click();
    await expect(page.getByTestId('help-answer')).toContainText(/Based on|don't answer|aren't available/);
    await expectAccessibleBothModes(page);
  });
});
