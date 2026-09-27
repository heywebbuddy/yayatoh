import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const OWNER = '0190f5f6-0000-7000-8000-00000000a001';
export const WEDDING_OWNER = '0190f5f6-0000-7000-8000-00000000b001';
export const EVENT = '/o/lakeside-events/e/midwest-leadership-summit-2027';
export const WEDDING = '/o/rosewood-weddings/e/harper-and-theo';

export async function signIn(page: Page, userId = OWNER) {
  const res = await page.request.post('/api/dev/login', { form: { userId, locale: 'en' }, maxRedirects: 0 });
  expect(res.status()).toBe(303);
}

/** axe: zero serious or critical violations (WCAG 2.2 AA tags). */
export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    bad.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    })),
  ).toEqual([]);
}
