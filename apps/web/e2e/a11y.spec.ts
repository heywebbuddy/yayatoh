import { expect, test } from '@playwright/test';
import { EVENT, expectAccessible, signIn } from './helpers.ts';

const PAGES = [
  { name: 'org home', path: '/o/lakeside-events', auth: true },
  { name: 'team', path: '/o/lakeside-events/team', auth: true },
  { name: 'event dashboard', path: EVENT, auth: true },
  { name: 'attendees + profile', path: `${EVENT}/attendees?a=a1`, auth: true },
  { name: 'section placeholder', path: `${EVENT}/seating`, auth: true },
  { name: 'new event', path: '/o/lakeside-events/events/new', auth: true },
  { name: 'public event page', path: '/events/midwest-leadership-summit-2027', auth: false },
  { name: 'attendee portal', path: '/portal/midwest-leadership-summit-2027', auth: false },
  { name: 'dev login', path: '/dev/login', auth: false },
];

for (const locale of ['en', 'ar'] as const) {
  for (const p of PAGES) {
    test(`${p.name} (${locale}) passes axe`, async ({ page }) => {
      if (p.auth) await signIn(page);
      const path = locale === 'en' ? p.path : `/${locale}${p.path}`;
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      // No horizontal page scroll at any breakpoint.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await expectAccessible(page);
      await page.screenshot({
        path: `test-results/screens/${test.info().project.name}-${locale}-${p.name.replace(/\W+/g, '-')}.png`,
        fullPage: true,
      });
    });
  }
}
