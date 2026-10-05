import { expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { localKeyVault, setKeyVault } from '@yayatoh/platform';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type AudienceScenario, audienceScenario } from '@yayatoh/testing';
import { expectAccessible, expectPicked, newUser, pickOption, pickWithKeyboard } from './helpers.ts';

// Tickets are signed with the org's keys: seal them under the web server's key vault.
const kms = process.env.LOCAL_KMS_KEY;
if (kms) setKeyVault(localKeyVault(kms));

test.afterAll(async () => {
  await closePools();
});

/** A fresh org (its owner signed in on `page`) holding the M3.6 audience scenario. */
async function orgWithScenario(page: Page): Promise<{ slug: string; s: AudienceScenario }> {
  const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
  const slug = owner.orgSlug as string;
  const org = await resolveOrgSlug(slug);
  if (!org) throw new Error(`no org ${slug}`);
  return { slug, s: await audienceScenario(org.orgId) };
}

const count = (page: Page) => page.getByTestId('audience-count');
const previewNames = async (page: Page) =>
  (await page.getByRole('table').locator('tbody tr td:first-child').allInnerTexts()).sort();

test.describe('audiences (M3.6a)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('build an audience with the keyboard: live count and preview, save, reload', async ({ page }) => {
    const { slug } = await orgWithScenario(page);
    await page.goto(`/o/${slug}`);
    // The nav lists Audiences (in the drawer on small screens).
    await expect(page.locator(`nav a[href$="/${slug}/audiences"]`).first()).toBeAttached();
    await page.goto(`/o/${slug}/audiences`);
    await expect(page.getByRole('heading', { level: 1, name: 'Audiences' })).toBeVisible();
    await expect(page.getByText('No saved audiences yet')).toBeVisible();
    await expectAccessible(page);

    await page.getByRole('link', { name: 'New audience' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'New audience' })).toBeVisible();
    // No conditions: everyone (the scenario's nine people; the org's own test show sold nothing).
    await expect(count(page)).toHaveText('9 people match');

    // Keyboard only: reach "Add condition" with Tab and press Enter.
    const add = page.getByRole('button', { name: 'Add condition' }).first();
    await page.getByLabel('New condition').first().focus();
    await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    await page.keyboard.press('Enter');
    const condition = page.getByRole('group', { name: 'Condition 1: Took part in an event' });
    await expect(condition).toBeVisible();
    // The newest event (this year's edition) is picked: its five people on the list.
    await expect(count(page)).toHaveText('5 people match');
    // Not checked in yet: choose with the keyboard on the select.
    const checkedIn = condition.getByLabel('Checked in');
    await pickWithKeyboard(checkedIn, 'no');
    await expect(count(page)).toHaveText('4 people match');
    await expect.poll(() => previewNames(page)).toEqual(['Ava', 'Cy', 'Fin', 'Ivy']);
    await expectAccessible(page);

    // A nested OR group narrows it again (press label, or has a seat).
    await page.getByRole('button', { name: 'Add group' }).first().click();
    const group = page.getByRole('group', { name: 'Group 2' });
    await pickOption(group.getByLabel('New condition'), 'label');
    await group.getByRole('button', { name: 'Add condition' }).click();
    await group.getByLabel('Label', { exact: true }).fill('press');
    await expect(count(page)).toHaveText('1 person matches');
    await expect.poll(() => previewNames(page)).toEqual(['Fin']);
    await page.getByRole('button', { name: 'Remove group 2' }).click();
    await expect(count(page)).toHaveText('4 people match');

    await page.getByLabel('Audience name').fill('No-shows 2028');
    await page.getByRole('button', { name: 'Save audience' }).click();
    await expect(page.getByText('Audience saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'No-shows 2028' })).toBeVisible();
    await expect(count(page)).toHaveText('4 people match');
    await expect(page.getByLabel('Audience name')).toHaveValue('No-shows 2028');
    await page.goto(`/o/${slug}/audiences`);
    const row = page.getByRole('row', { name: /No-shows 2028/ });
    await expect(row).toContainText('4');
    await expectAccessible(page);
  });

  test('the three vision templates give their exact audiences', async ({ page }) => {
    const { slug, s } = await orgWithScenario(page);
    const use = async (key: string, name: string) => {
      await page.goto(`/o/${slug}/audiences/new?template=${key}`);
      const templates = page.getByRole('region', { name: 'Start from a template' });
      await expect(templates.getByRole('radio', { name: new RegExp(name) })).toBeChecked();
      await pickOption(templates.getByRole('combobox'), { label: `${s.thisYearName} (Jun 3, 2028)` });
      return templates;
    };

    let t = await use('vipsWithoutSeats', 'VIPs without seats');
    await t.getByRole('checkbox', { name: 'VIP' }).check();
    await t.getByRole('button', { name: 'Use template' }).click();
    await expect(t.getByText('Template applied: VIPs without seats')).toBeVisible();
    await expect(count(page)).toHaveText('1 person matches');
    await expect.poll(() => previewNames(page)).toEqual([...s.expected.vipsWithoutSeats]);
    await expectAccessible(page);

    t = await use('lastYearNotThisYear', 'Last year, not this year');
    await t.getByRole('button', { name: 'Use template' }).click();
    await expect(count(page)).toHaveText('1 person matches');
    await expect.poll(() => previewNames(page)).toEqual([...s.expected.lastYearNotThisYear]);
    // The builder shows what the template means (series-relative).
    await expectPicked(
      page.getByRole('group', { name: /Condition 1:/ }).getByLabel('Events'),
      'previousEdition',
    );

    t = await use('registeredNotCheckedIn', 'Registered, not checked in');
    await t.getByRole('button', { name: 'Use template' }).click();
    await expect(count(page)).toHaveText('4 people match');
    await expect.poll(() => previewNames(page)).toEqual([...s.expected.registeredNotCheckedIn]);

    // A saved template audience exports through the bulk-export path.
    await page.getByLabel('Audience name').fill('Registered, not in');
    await page.getByRole('button', { name: 'Save audience' }).click();
    await expect(page.getByText('Audience saved.')).toBeVisible();
    await page.getByRole('button', { name: 'Export CSV' }).click();
    await expect(page.getByText('Export ready: 4 people')).toBeVisible();
    const href = await page.getByRole('link', { name: 'Download CSV' }).getAttribute('href');
    const csv = await (await page.request.get(href ?? '')).text();
    expect(csv).toContain('Email marketing consent');
    expect(csv.trim().split('\n')).toHaveLength(5);
  });

  test('renders right-to-left in Arabic', async ({ page }) => {
    const { slug } = await orgWithScenario(page);
    await page.goto(`/ar/o/${slug}/audiences/new?template=registeredNotCheckedIn`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'جمهور جديد' })).toBeVisible();
    await page.getByRole('button', { name: 'استخدام القالب' }).click();
    await expect(count(page)).toHaveText(/[4٤]/);
    await expectAccessible(page);
  });

  test('a viewer is denied: no nav entry, and the pages are not found', async ({ page, browser }) => {
    const { slug } = await orgWithScenario(page);
    const ctx = await browser.newContext();
    const viewer = await ctx.newPage();
    await newUser(viewer, { join: [`${slug}:viewer`] });
    await viewer.goto(`/o/${slug}`);
    await expect(viewer.getByRole('navigation').getByRole('link', { name: 'Audiences' })).toHaveCount(0);
    for (const path of ['audiences', 'audiences/new']) {
      const res = await viewer.goto(`/o/${slug}/${path}`);
      expect(res?.status()).toBe(404);
    }
    await ctx.close();
  });
});
