import { expect, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';

test.describe('team and invitations', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('an owner invites a teammate, sees it pending, and revokes it', async ({ page }) => {
    await signIn(page);
    await page.goto('/o/lakeside-events/team');
    const email = `invitee-${Date.now()}@example.test`;
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Role').selectOption('scanner');
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText('Invitation sent.')).toBeVisible();
    const row = page.getByRole('listitem').filter({ hasText: email });
    await expect(row).toContainText('Scanner');
    await expectAccessible(page);
    await row.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: email })).toHaveCount(0);
  });

  test('a viewer sees the team but no invite form', async ({ page }) => {
    await signIn(page, 'jordan@lakeside.test');
    await page.goto('/o/lakeside-events/team');
    await expect(page.getByRole('table')).toContainText('Pani Digital');
    await expect(page.getByRole('button', { name: 'Send invitation' })).toHaveCount(0);
  });

  test('a forged invitation link is rejected', async ({ page }) => {
    const res = await page.goto('/invite/0190f5f6-0000-7000-8000-000000000999~forged');
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('alert').filter({ hasText: "isn't valid" })).toBeVisible();
  });
});
