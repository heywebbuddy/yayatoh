import { expect, type Page, test } from '@playwright/test';
import { newUser, signIn } from './helpers.ts';

// Temporary: before/after screenshots for the U3 report (not committed).
const OUT = process.env.U3_SHOTS_DIR ?? '/tmp/u3-shots';
const PHASE = process.env.U3_PHASE ?? 'after';
const SIZES = [
  { name: '1280', width: 1280, height: 900 },
  { name: '390', width: 390, height: 844 },
] as const;

async function shoot(page: Page, screen: string) {
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const mode of ['light', 'dark'] as const) {
      await page.evaluate((m) => {
        document.documentElement.dataset.theme = m;
      }, mode);
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${OUT}/${PHASE}-${screen}-${size.name}-${mode}.png`, fullPage: true });
    }
  }
}

test('u3 shots', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await newUser(page, { org: true, twoFactor: true });
  const org = `/o/${user.orgSlug}`;
  await page.goto(`${org}/domains`);
  const setUp = page.getByRole('button', { name: 'Set up my free address' });
  if (await setUp.isVisible()) await setUp.click();
  const add = page.getByRole('region', { name: 'Add a domain you own' });
  await add.getByLabel('Domain').fill(`tickets-${Date.now()}.example.org`);
  await add.getByRole('button', { name: 'Add domain' }).click();
  await expect(page.getByText('Waiting for DNS').first()).toBeVisible();
  await shoot(page, 'domains');

  await signIn(page);
  await page.goto('/o/lakeside-events/venues');
  await shoot(page, 'venues');
  await page.getByLabel('Venue name').fill(`Shot Hall ${Date.now()}`);
  await page.getByLabel('Country code').fill('us');
  await page.getByRole('button', { name: 'Add venue' }).click();
  await expect(page.getByText('Venue added.')).toBeVisible();
  await shoot(page, 'venue-new');
});
