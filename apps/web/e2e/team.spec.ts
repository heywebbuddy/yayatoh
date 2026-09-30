import { expect, type Page, test } from '@playwright/test';
import { ageSession, codeForKey, confirmStepUp, expectAccessible, newUser, signIn } from './helpers.ts';

test.describe('team and invitations', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('an owner invites a teammate, sees it pending, and revokes it', async ({ page }) => {
    await signIn(page);
    await page.goto('/o/lakeside-events/team');
    const email = `invitee-${Date.now()}@example.test`;
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Role', { exact: true }).selectOption('scanner');
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

test.describe('team: change roles and remove members (M1.2c leftover)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  const stamp = () => `${test.info().project.name.split('-')[0]}${Date.now()}`;

  /** A throwaway owner (two-step verification on, signed in) and one teammate in their org. */
  async function ownerWithTeammate(page: Page, role = 'viewer') {
    const ownerName = `Olive Owner ${stamp()}`;
    const owner = await newUser(page, { org: true, twoFactor: true, name: ownerName });
    const name = `Mia Member ${stamp()}`;
    await newUser(page, { join: [`${owner.orgSlug}:${role}`], signIn: false, name });
    return { owner, ownerName, name };
  }
  /** The role column of a member's row (the row also holds the role picker's options). */
  const roleCell = (page: Page, name: string) =>
    page.getByRole('row').filter({ hasText: name }).getByRole('cell').nth(1);

  test('an owner changes a role and removes a member, each after "Confirm it\'s you"', async ({ page }) => {
    const { owner, name } = await ownerWithTeammate(page);
    await page.goto(`/o/${owner.orgSlug}/team`);
    await ageSession(page);
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(roleCell(page, name)).toHaveText('Viewer');
    await row.getByLabel(`Role for ${name}`, { exact: true }).selectOption('manager');
    await row.getByRole('button', { name: `Save role for ${name}` }).click();
    await confirmStepUp(page, codeForKey(owner.setupKey ?? ''));
    await expect(page.getByRole('status').filter({ hasText: `${name}'s role was changed.` })).toBeVisible();
    await expect(roleCell(page, name)).toHaveText('Manager');
    await expectAccessible(page);
    await page.reload();
    await expect(roleCell(page, name)).toHaveText('Manager');

    // Removing asks first; Cancel changes nothing; then it goes (still fresh: no second dialog).
    const remove = page.getByRole('button', { name: `Remove ${name}` });
    await remove.click();
    const confirm = page.getByRole('form', {
      name: `Remove ${name} from this organization? They lose access at once.`,
    });
    await expect(confirm.getByRole('button', { name: 'Yes, remove' })).toBeFocused();
    await expectAccessible(page);
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(remove).toBeFocused();
    await remove.click();
    await page.getByRole('button', { name: 'Yes, remove' }).click();
    await expect(page.getByRole('status').filter({ hasText: `${name} was removed.` })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0);
  });

  test('works with the keyboard alone; Escape cancels a removal', async ({ page }) => {
    const { owner, name } = await ownerWithTeammate(page);
    await page.goto(`/o/${owner.orgSlug}/team`);
    const row = page.getByRole('row').filter({ hasText: name });
    const select = row.getByLabel(`Role for ${name}`, { exact: true });
    await select.focus();
    await select.selectOption('scanner');
    await page.keyboard.press('Tab');
    await expect(row.getByRole('button', { name: `Save role for ${name}` })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: `${name}'s role was changed.` })).toBeVisible();
    await expect(roleCell(page, name)).toHaveText('Scanner');
    const remove = page.getByRole('button', { name: `Remove ${name}` });
    await remove.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Yes, remove' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Yes, remove' })).toHaveCount(0);
    await expect(remove).toBeFocused();
  });

  test('the last owner cannot step down; admins cannot touch owners', async ({ page, browser }) => {
    const { owner, ownerName: myName, name } = await ownerWithTeammate(page, 'admin');
    await page.goto(`/o/${owner.orgSlug}/team`);
    const me = page.getByRole('row').filter({ hasText: myName });
    await me.getByLabel(`Role for ${myName}`, { exact: true }).selectOption('admin');
    await me.getByRole('button', { name: `Save role for ${myName}` }).click();
    await expect(
      me.getByRole('alert').filter({ hasText: 'An organization needs at least one owner.' }),
    ).toBeVisible();
    await expectAccessible(page);

    // The admin sees no owner option and no controls on the owner's row.
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await newUser(adminPage, {
      join: [`${owner.orgSlug}:admin`],
      twoFactor: true,
      name: `Ada Admin ${stamp()}`,
    });
    await adminPage.goto(`/o/${owner.orgSlug}/team`);
    const ownerRow = adminPage.getByRole('row').filter({ hasText: myName });
    await expect(ownerRow.getByText('Only owners can change owners')).toBeVisible();
    await expect(ownerRow.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
    const teammate = adminPage.getByRole('row').filter({ hasText: name });
    await expect(
      teammate.getByLabel(`Role for ${name}`, { exact: true }).locator('option[value="owner"]'),
    ).toHaveCount(0);
    await adminContext.close();
  });

  test('a viewer sees no controls, and the server refuses the action when replayed', async ({
    page,
    browser,
  }) => {
    const { owner, name } = await ownerWithTeammate(page);
    await page.goto(`/o/${owner.orgSlug}/team`);
    const row = page.getByRole('row').filter({ hasText: name });
    await row.getByLabel(`Role for ${name}`, { exact: true }).selectOption('manager');
    const [request] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'POST' && Boolean(r.headers()['next-action'])),
      row.getByRole('button', { name: `Save role for ${name}` }).click(),
    ]);
    await expect(roleCell(page, name)).toHaveText('Manager');

    const viewerContext = await browser.newContext();
    const viewer = await viewerContext.newPage();
    await newUser(viewer, { join: [`${owner.orgSlug}:viewer`], name: `Vic Viewer ${stamp()}` });
    await viewer.goto(`/o/${owner.orgSlug}/team`);
    await expect(viewer.getByRole('table')).toContainText(name);
    await expect(viewer.getByRole('columnheader', { name: 'Manage' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /^Save role/ })).toHaveCount(0);
    // The owner's request, replayed by the viewer (asking for "viewer" back): refused.
    const res = await viewer.request.post(`/o/${owner.orgSlug}/team`, {
      headers: {
        'next-action': request.headers()['next-action'] ?? '',
        'content-type': request.headers()['content-type'] ?? '',
        accept: 'text/x-component',
      },
      data: (request.postData() ?? '').replace('manager', 'viewer'),
    });
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('"forbidden"');
    await page.reload();
    await expect(roleCell(page, name)).toHaveText('Manager');
    await viewerContext.close();
  });

  test('Arabic: the controls render right to left', async ({ page }) => {
    const { owner, name } = await ownerWithTeammate(page);
    await page.goto(`/ar/o/${owner.orgSlug}/team`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('columnheader', { name: 'إدارة' })).toBeVisible();
    await page.getByRole('button', { name: `إزالة ${name}` }).click();
    await expect(page.getByText(`هل تريد إزالة ${name} من هذه المؤسسة؟ سيفقد الوصول فورًا.`)).toBeVisible();
    await expectAccessible(page);
  });
});
