import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { EMAIL_KINDS } from '@yayatoh/notifications';
import { expectAccessible, signIn } from './helpers.ts';

/**
 * Owner-reported bug: the Emails page threw next-intl MISSING_MESSAGE for kinds added after the
 * labels (tickets resent/cancelled, the waitlist emails). Every kind in the picker must show its
 * own label, in English and in Arabic (RTL), with nothing missing in the console.
 */
type Tree = { [k: string]: string | Tree };
const labels = (locale: string): string[] => {
  const messages: Tree = JSON.parse(
    readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'),
  );
  const kinds = (messages.notifications as Tree).kinds as Tree;
  return EMAIL_KINDS.map((k) => {
    const [group, name] = k.split('.') as [string, string];
    return (kinds[group] as Tree)[name] as string;
  });
};

for (const locale of ['en', 'ar'] as const) {
  test(`the Emails page labels every email kind in /${locale}`, async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (m) => {
      if (/MISSING_MESSAGE|notifications\.kinds\./.test(m.text())) problems.push(m.text());
    });
    page.on('pageerror', (e) => problems.push(e.message));
    await signIn(page);
    const res = await page.goto(`/${locale}/o/lakeside-events/emails`);
    expect(res?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

    const picker = page.locator('select#template-kind');
    await expect(picker).toBeVisible();
    const values = await picker
      .locator('option')
      .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(values).toEqual([...EMAIL_KINDS]);
    const texts = (await picker.locator('option').allTextContents()).map((t) => t.trim());
    const expected = labels(locale);
    expect(expected.every((l) => typeof l === 'string' && l.trim() !== '')).toBe(true);
    expect(texts).toEqual(expected);
    // No raw key fallback anywhere on the page.
    await expect(page.locator('body')).not.toContainText('notifications.kinds');

    // Each previously missing kind opens with its label in the editing heading.
    for (const kind of ['ticketing.ticket-cancelled', 'orders.waitlist-offer'] as const) {
      await picker.selectOption(kind);
      // Keyboard: Enter on the form's Open button.
      await page.locator('form[method="get"] button[type="submit"]').focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`kind=${kind.replace('.', '\\.')}`));
      const label = expected[EMAIL_KINDS.indexOf(kind)] as string;
      await expect(page.getByRole('heading', { level: 2 }).filter({ hasText: label })).toBeVisible();
    }
    await expectAccessible(page);
    expect(problems).toEqual([]);
  });
}
