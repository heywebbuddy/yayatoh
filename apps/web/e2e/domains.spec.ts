import { expect, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';

test.describe('domains', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('an owner takes a custom domain from waiting for DNS to active and primary', async ({ page }) => {
    const stamp = Date.now();
    const host = `tickets-${stamp}.verified.test`;
    await signIn(page);
    await page.goto('/o/lakeside-events');
    await page.getByRole('link', { name: 'Domains' }).first().click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/domains$/);
    // Orgs created before domains existed (a long-lived local database) set up the free address.
    const setUp = page.getByRole('button', { name: 'Set up my free address' });
    if (await setUp.isVisible()) await setUp.click();
    const list = page.getByRole('list', { name: 'Your domains' });
    const managed = list.getByRole('listitem').filter({ hasText: 'lakeside-events.yayatoh.events' });
    await expect(managed.getByText('Active', { exact: true })).toBeVisible();
    await expectAccessible(page);

    const add = page.getByRole('region', { name: 'Add a domain you own' });
    await add.getByLabel('Domain').fill('shop.yayatoh.com');
    await add.getByRole('button', { name: 'Add domain' }).click();
    await expect(add.getByRole('alert')).toBeVisible();

    await add.getByLabel('Domain').fill(`https://${host.toUpperCase()}/`);
    await add.getByRole('button', { name: 'Add domain' }).click();
    const mine = list.getByRole('listitem').filter({ hasText: host });
    await expect(mine.getByText('Waiting for DNS')).toBeVisible();
    await expect(mine.getByRole('table', { name: `DNS records for ${host}` })).toBeVisible();
    await expect(mine.getByRole('cell', { name: `_vercel.${host}` })).toBeVisible();
    await expectAccessible(page);

    await mine.getByRole('button', { name: `Check now ${host}` }).click();
    await expect(mine.getByText('Active', { exact: true })).toBeVisible();
    await expect(mine.getByText('Primary', { exact: true })).toBeVisible();
    await expect(mine.getByText('Apple Pay and Google Pay are ready here.')).toBeVisible();
    await expect(managed.getByText('Primary', { exact: true })).toHaveCount(0);

    // Clean up: removing it hands primary back to the free address.
    await mine.getByRole('button', { name: `Remove ${host}` }).click();
    await expect(list.getByRole('listitem').filter({ hasText: host })).toHaveCount(0);
    await expect(managed.getByText('Primary', { exact: true })).toBeVisible();
  });
});
