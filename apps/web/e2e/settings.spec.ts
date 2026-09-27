import { expect, test } from '@playwright/test';
import { expectAccessible, OPEN_HOUSE, signIn } from './helpers.ts';

test.describe('organization settings', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('an owner sees the setup checklist, sets a brand colour and a refund policy that guests can read', async ({
    page,
    browser,
  }) => {
    const stamp = Date.now();
    await signIn(page);
    await page.goto('/o/lakeside-events');
    const setup = page.getByRole('region', { name: /Get ready to sell/ });
    await expect(setup).toBeVisible();
    await expect(
      setup.getByRole('link', { name: 'Add your privacy notice and refund policy' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Settings' }).first().click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/settings$/);
    // The seeded owner has accepted the (draft) terms.
    await expect(page.getByText(/Accepted on/).first()).toBeVisible();
    await expectAccessible(page);

    const brand = page.getByRole('region', { name: 'Brand' });
    await brand.getByLabel('Brand colour', { exact: true }).fill('#fdf2c8');
    await expect(brand.getByText(/light against a white page/)).toBeVisible();
    await brand.getByLabel('Brand colour', { exact: true }).fill('#1a6b5c');
    await expect(brand.getByText(/light against a white page/)).toHaveCount(0);
    await brand.getByRole('button', { name: 'Save' }).click();
    await expect(brand.getByText('Saved.')).toBeVisible();

    const legal = page.getByRole('region', { name: 'Your legal pages' });
    await legal.getByLabel('Refund policy').fill(`Full refunds up to 7 days before the event. (${stamp})`);
    await legal.getByRole('button', { name: 'Save' }).nth(2).click();
    await expect(legal.getByText('Saved.')).toBeVisible();

    // Guests see the policy linked from the event page, and the branded checkout button.
    const guest = await (await browser.newContext()).newPage();
    await guest.goto('/events/lakeside-open-house');
    await guest
      .getByRole('navigation', { name: /policies/ })
      .getByRole('link', { name: 'Refund policy' })
      .click();
    await expect(guest.getByRole('heading', { name: 'Refund policy' })).toBeVisible();
    await expect(guest.getByText(`(${stamp})`)).toBeVisible();
    await expectAccessible(guest);
    await guest.goto('/legal/platform/platform_tos');
    await expect(guest.getByText(/DRAFT/).first()).toBeVisible();
    expect(OPEN_HOUSE).toContain('lakeside-open-house');
  });
});
