import { test } from '@playwright/test';
import { EVENT, signIn } from './helpers.ts';

// Temporary capture for the batch 3v merge README (not committed).
const ORG = '/o/lakeside-events';
const PAGES: [string, string][] = [
  ['domains', `${ORG}/domains`],
  ['templates', `${ORG}/templates`],
  ['coupons', `${ORG}/coupons`],
  ['events-new', `${ORG}/events/new`],
  ['event-header-details', `${EVENT}/details`],
  ['command-center-overview', `${ORG}/command-center`],
  ['series', `${ORG}/series`],
];
for (const theme of ['light', 'dark'] as const)
  test(`merge-3v shots ${theme}`, async ({ page }, info) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ colorScheme: theme });
    await signIn(page);
    const w = page.viewportSize()?.width ?? 0;
    for (const [name, url] of PAGES) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      await page.screenshot({
        path: `../../docs/ux/screenshots/merge-3v/${name}-${w}-${theme}.png`,
        fullPage: true,
      });
    }
    void info;
  });
