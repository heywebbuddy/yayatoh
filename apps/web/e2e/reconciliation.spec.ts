import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';

/**
 * Daily reconciliation (M1.6e): the nightly run (here the dev route, on the fake provider's
 * balance) finds a provider movement the ledger never saw; finance sees it and resolves it with a
 * note. Each run uses its own past day and reference, so projects and reruns never collide.
 */
async function driftDay(page: Page, tag: string) {
  const offset = Number(BigInt(Date.now()) % 20_000n) + (test.info().project.name.charCodeAt(0) % 7) * 20_000;
  const day = new Date(Date.UTC(1990, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10);
  const res = await page.request.post('/api/dev/payments/reconcile', {
    form: { org: 'lakeside-events', day, drift: tag, amount: '1234' },
  });
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ itemCount: 1, created: true });
  return day;
}

test.describe('reconciliation (M1.6e)', () => {
  test('a difference is listed for finance and resolved with a note', async ({ page }) => {
    const tag = `${Date.now()}-${test.info().project.name}`.toLowerCase();
    await signIn(page, 'fran@lakeside.test');
    await driftDay(page, tag);

    // Finance finds it in the navigation (collapsed behind the menu on small screens).
    await page.goto('/o/lakeside-events');
    await expect(page.locator('a[href$="/o/lakeside-events/finance"]').first()).toBeAttached();
    await page.goto('/o/lakeside-events/finance');
    await expect(page.getByRole('heading', { name: 'Finance', level: 1 })).toBeVisible();
    const open = page.getByRole('region', { name: 'Differences to check' });
    const item = open.getByRole('listitem').filter({ hasText: `order:drift-${tag}` });
    await expect(item.getByText('Not in the ledger')).toBeVisible();
    await expect(item.getByText('$12.34').first()).toBeVisible();
    await expect(
      page.getByRole('table', { name: 'Daily checks' }).getByText('1 difference').first(),
    ).toBeVisible();
    await expectAccessible(page);

    // A note is required (server-side too).
    const note = item.getByLabel(`Why is order:drift-${tag} resolved?`);
    await note.fill('ok');
    await item.locator('form').evaluate((f: HTMLFormElement) => {
      f.noValidate = true;
    });
    await item.getByRole('button', { name: 'Resolve' }).click();
    await expect(item.getByText('Write a note of at least 3 characters.')).toBeVisible();

    // Keyboard only.
    await note.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Test charge made in the dashboard by Pani');
    await page.keyboard.press('Tab');
    await expect(item.getByRole('button', { name: 'Resolve' })).toBeFocused();
    await page.keyboard.press('Enter');
    const resolved = page.getByRole('table', { name: 'Resolved' });
    await expect(resolved.getByRole('row').filter({ hasText: `order:drift-${tag}` })).toContainText(
      'Test charge made in the dashboard by Pani',
    );
    await expect(open.getByText(`order:drift-${tag}`)).toHaveCount(0);
    await page.reload();
    await expect(
      page
        .getByRole('table', { name: 'Resolved' })
        .getByRole('row')
        .filter({ hasText: `order:drift-${tag}` }),
    ).toBeVisible();
    await expectAccessible(page);

    // Arabic, right to left.
    await page.goto('/ar/o/lakeside-events/finance');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'المالية', level: 1 })).toBeVisible();
    await expectAccessible(page);
  });

  test('viewers never see Finance; a reconciled org with no drift shows the empty state', async ({
    page,
  }) => {
    await signIn(page, 'jordan@lakeside.test');
    await page.goto('/o/lakeside-events');
    await expect(page.locator('a[href$="/o/lakeside-events/finance"]')).toHaveCount(0);
    const res = await page.goto('/o/lakeside-events/finance');
    expect(res?.status()).toBe(404);

    await signIn(page, 'maya@rosewood.test');
    await page.goto('/o/rosewood-weddings/finance');
    await expect(page.getByText('No differences', { exact: true })).toBeVisible();
    await expect(page.getByText('Your ledger matches the payment provider.')).toBeVisible();
    await expectAccessible(page);
  });
});
