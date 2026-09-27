import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';

/**
 * One member per viewport project, so the three projects never read or clear each other's inbox:
 * viewers get no sales alerts, and no spec delivers Rosewood's messages.
 */
function persona(): { email: string; org: string } {
  const project = test.info().project.name;
  if (project.startsWith('mobile')) return { email: 'jordan@lakeside.test', org: 'lakeside-events' };
  if (project.startsWith('tablet')) return { email: 'sam@rosewood.test', org: 'rosewood-weddings' };
  return { email: 'maya@rosewood.test', org: 'rosewood-weddings' };
}

async function setGrid(page: Page, on: Record<string, boolean>) {
  for (const [label, value] of Object.entries(on)) {
    const [group, channel] = label.split(':') as [string, string];
    const box = page.getByRole('group', { name: group }).getByRole('checkbox', { name: channel });
    await box.setChecked(value);
  }
}

test.describe('notifications: preferences', () => {
  test('a member saves channel toggles per category; they persist and only affect them', async ({ page }) => {
    const me = persona();
    await signIn(page, me.email);
    await page.goto(`/o/${me.org}/notifications/preferences`);
    await expect(page.getByRole('heading', { name: 'Notification settings' })).toBeVisible();
    // Marketing starts off (consent is never invented).
    const marketing = page.getByRole('group', { name: 'News from Yayatoh' });
    await expect(marketing.getByRole('checkbox', { name: 'Email' })).toBeVisible();
    await expectAccessible(page);

    await setGrid(page, { 'Sales:Email': true, 'Messages:Push': false, 'News from Yayatoh:Email': false });
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Your notification settings are saved.' }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('group', { name: 'Sales' }).getByRole('checkbox', { name: 'Email' }),
    ).toBeChecked();
    await expect(
      page.getByRole('group', { name: 'Messages' }).getByRole('checkbox', { name: 'Push' }),
    ).not.toBeChecked();

    // Keyboard only: Space toggles a checkbox, Enter on the button saves.
    const push = page.getByRole('group', { name: 'Messages' }).getByRole('checkbox', { name: 'Push' });
    await push.focus();
    await page.keyboard.press('Space');
    await expect(push).toBeChecked();
    await page.getByRole('button', { name: 'Save settings' }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('status').filter({ hasText: 'Your notification settings are saved.' }),
    ).toBeVisible();
    await page.reload();
    await expect(push).toBeChecked();

    // Back to the defaults for the next run.
    await setGrid(page, { 'Sales:Email': false });
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Your notification settings are saved.' }),
    ).toBeVisible();
  });

  test('the preferences page renders right to left in Arabic', async ({ page }) => {
    const me = persona();
    await signIn(page, me.email);
    await page.goto(`/ar/o/${me.org}/notifications/preferences`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'إعدادات الإشعارات' })).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe('notifications: the inbox bell', () => {
  test('unread count, mark one read, mark all read, from the bell and the inbox page', async ({ page }) => {
    const me = persona();
    await signIn(page, me.email);
    // Start from zero.
    await page.goto(`/o/${me.org}/notifications`);
    await expectAccessible(page);
    const markAll = page.getByRole('button', { name: 'Mark all as read' });
    if (await markAll.isEnabled()) await markAll.click();
    await expect(
      page.getByRole('status').filter({ hasText: 'All notifications are marked as read.' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Notifications, none unread' })).toBeVisible();

    // Two test notifications from the preferences page.
    await page.goto(`/o/${me.org}/notifications/preferences`);
    // Each send refreshes the shell: the bell's count follows.
    for (const n of [1, 2]) {
      await page.getByRole('button', { name: 'Send me a test notification' }).click();
      await expect(page.getByRole('button', { name: `Notifications, ${n} unread` })).toBeVisible();
    }
    await expect(
      page.getByRole('status').filter({ hasText: 'Test notification sent. Check the bell.' }),
    ).toBeVisible();
    await page.reload();
    const bell = page.getByRole('button', { name: 'Notifications, 2 unread' });
    await expect(bell).toBeVisible();
    await expect(page.getByTestId('inbox-badge')).toHaveText('2');

    // Open the bell from the keyboard.
    await bell.focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('dialog', { name: 'Notifications' });
    await expect(panel).toBeVisible();
    const markOne = panel.getByRole('button', {
      name: 'Mark “Test notification: notifications are working” as read',
    });
    await expect(markOne).toHaveCount(2);
    await expectAccessible(page);
    await markOne.first().click();
    await expect(page.getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'You have 1 unread notification' }),
    ).toBeAttached();
    await panel.getByRole('button', { name: 'Mark all as read' }).click();
    await expect(page.getByRole('button', { name: 'Notifications, none unread' })).toBeVisible();
    await expect(page.getByTestId('inbox-badge')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();

    // The inbox page: a new one is unread there; mark it read with its own button.
    await page.goto(`/o/${me.org}/notifications/preferences`);
    await page.getByRole('button', { name: 'Send me a test notification' }).click();
    await expect(page.getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();
    await page.goto(`/o/${me.org}/notifications`);
    await expect(
      page.getByRole('status').filter({ hasText: 'You have 1 unread notification' }),
    ).toBeVisible();
    await expectAccessible(page);
    await page
      .getByRole('button', { name: /^Mark as read ?: Test notification: notifications are working$/ })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: 'All notifications are marked as read.' }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Notifications, none unread' })).toBeVisible();
  });

  test('the inbox page renders right to left in Arabic, with its empty or read state', async ({ page }) => {
    const me = persona();
    await signIn(page, me.email);
    await page.goto(`/ar/o/${me.org}/notifications`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'الإشعارات', level: 1 })).toBeVisible();
    await expectAccessible(page);
  });

  test('another org’s inbox is not reachable', async ({ page }) => {
    await signIn(page, 'jordan@lakeside.test');
    const res = await page.goto('/o/rosewood-weddings/notifications');
    expect(res?.status()).toBe(404);
  });
});
