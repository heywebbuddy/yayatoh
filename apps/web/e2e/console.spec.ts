import { expect, test } from '@playwright/test';
import { EVENT, signIn, WEDDING, WEDDING_OWNER } from './helpers.ts';

test.describe('console', () => {
  test('a member sees their event dashboard with the active nav pill', async ({ page }) => {
    await signIn(page);
    await page.goto(EVENT);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pani');
    const nav = page.getByRole('navigation', { name: 'Main navigation' }).first();
    if (await nav.isVisible())
      await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  test('a non-member gets a 404 for another org', async ({ page }) => {
    await signIn(page);
    const res = await page.goto(WEDDING);
    expect(res?.status()).toBe(404);
    const org = await page.goto('/o/rosewood-weddings');
    expect(org?.status()).toBe(404);
  });

  test('signed-out users are sent to sign in', async ({ page }) => {
    await page.goto(EVENT);
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test('the wedding profile swaps navigation and vocabulary', async ({ page }) => {
    await signIn(page, WEDDING_OWNER);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(WEDDING);
    const nav = page.getByRole('navigation', { name: 'Main navigation' }).first();
    await expect(nav.getByRole('link', { name: 'Guests' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'RSVP' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Tickets & Orders' })).toHaveCount(0);
  });

  test('unknown sections are 404', async ({ page }) => {
    await signIn(page);
    const res = await page.goto(`${EVENT}/not-a-section`);
    expect(res?.status()).toBe(404);
  });

  test('attendee search filters the list', async ({ page }) => {
    await signIn(page);
    await page.goto(`${EVENT}/attendees?q=okafor`);
    await expect(page.getByRole('table')).toContainText('Amara Okafor');
    await expect(page.getByRole('table')).not.toContainText('Daniel Kim');
  });
});
