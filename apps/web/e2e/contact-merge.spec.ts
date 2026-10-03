import { type Browser, expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { localKeyVault, setKeyVault } from '@yayatoh/platform';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { mergeScenario } from '@yayatoh/testing';
import { ageSession, codeForKey, confirmStepUp, expectAccessible, newUser, signIn } from './helpers.ts';

// Tickets are signed with the org's keys: seal them under the web server's key vault.
const kms = process.env.LOCAL_KMS_KEY;
if (kms) setKeyVault(localKeyVault(kms));

test.afterAll(async () => {
  await closePools();
});

/** A fresh org (its owner signed in on `page`) holding the M6.1a merge scenario. */
async function orgWithScenario(page: Page) {
  const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
  const slug = owner.orgSlug as string;
  const org = await resolveOrgSlug(slug);
  if (!org) throw new Error(`no org ${slug}`);
  return { slug, owner, s: await mergeScenario(org.orgId) };
}

const scanNow = async (page: Page, slug: string) => {
  await page.goto(`/o/${slug}/audiences/duplicates`);
  await page.getByRole('button', { name: 'Look for duplicates' }).click();
  await expect(page.getByText('Found 1 possible duplicate.')).toBeVisible();
};

const entries = (page: Page) => page.getByTestId('timeline-entry');

async function asMember(browser: Browser, slug: string, role: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await newUser(page, { join: [`${slug}:${role}`] });
  return { context, page };
}

test.describe('CRM merge and timeline (M6.1a)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('find duplicates, merge with field choices, see the merged timeline, undo — keyboard only', async ({
    page,
  }) => {
    const { slug, s } = await orgWithScenario(page);
    // Audiences links to People and Possible duplicates.
    await page.goto(`/o/${slug}/audiences`);
    const dupLink = page.getByRole('link', { name: 'Possible duplicates' });
    await dupLink.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Possible duplicates' })).toBeVisible();
    // Empty state that says what to do next, before the first check.
    await expect(page.getByText('No possible duplicates')).toBeVisible();
    await expect(page.getByTestId('last-scan')).toHaveText('Not checked yet.');
    await expectAccessible(page);

    // The one primary action, by keyboard.
    await page.getByRole('button', { name: 'Look for duplicates' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Found 1 possible duplicate.')).toBeVisible();
    await expect(page.getByTestId('last-scan')).toContainText('Last checked');
    const table = page.getByRole('region', { name: 'Possible duplicates to review' });
    await expect(table.getByText('Same email address')).toBeVisible();
    await expect(table.getByText('90%')).toBeVisible();
    await expect(table.getByText(s.other.email)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Open (1)' })).toHaveAttribute('aria-current', 'page');
    await expectAccessible(page);

    // Review the pair side by side.
    const review = page.getByRole('link', { name: 'Review Taylor Reed and Taylor Reed' });
    await review.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Review possible duplicate' })).toBeVisible();
    await expect(page.getByText('90% confidence: Same email address.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Record 1 (older)' })).toBeVisible();
    // Opt-out wins, before anything is merged.
    await expect(page.getByTestId('merged-consent')).toContainText('Marketing email: Opted out');
    // Defaults: the older record stays; each field the most recent non-empty value (the duplicate's).
    const keep = page.getByRole('group', { name: 'Which record stays' });
    await expect(keep.getByRole('radio', { name: `Record 1 (${s.keep.email})` })).toBeChecked();
    const email = page.getByRole('group', { name: 'Email' });
    await expect(email.getByRole('radio', { name: `Record 2: ${s.dup.email}` })).toBeChecked();
    await expectAccessible(page);
    // Field choice with the keyboard: keep the older address (arrow keys move within the group).
    await email.getByRole('radio', { name: `Record 2: ${s.dup.email}` }).focus();
    await page.keyboard.press('ArrowUp');
    await expect(email.getByRole('radio', { name: `Record 1: ${s.keep.email}` })).toBeChecked();
    await page.getByRole('button', { name: 'Merge records' }).focus();
    await page.keyboard.press('Enter');

    // The person who stays: the chosen fields, the merged timeline, the merge with its undo.
    await expect(
      page.getByText('Records merged. You can undo this for 30 days from this page.'),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Taylor Reed' })).toBeVisible();
    await expect(page.getByText(s.keep.email).first()).toBeVisible();
    await expect(page.getByText('Lakeside Partners')).toBeVisible();
    await expect(entries(page).filter({ hasText: 'Order paid' })).toHaveCount(3);
    await expect(entries(page).filter({ hasText: 'Checked in' })).toHaveCount(1);
    await expect(entries(page).filter({ hasText: 'Campaign sent' })).toHaveCount(1);
    await expect(entries(page).filter({ hasText: s.galaName })).toHaveCount(1);
    await expect(page.getByText(`Merged Taylor Reed (${s.dup.email})`)).toBeVisible();
    await expectAccessible(page);

    // Filters (kind, event), keyboard only; persistence across a reload.
    const kind = page.getByLabel('What');
    await kind.focus();
    await kind.selectOption({ label: 'Checked in' });
    await page.getByRole('button', { name: 'Filter' }).focus();
    await page.keyboard.press('Enter');
    await expect(entries(page)).toHaveCount(1);
    await expect(entries(page).first()).toContainText(s.summitName);
    await page.getByLabel('What').selectOption({ label: 'Everything' });
    await page.getByLabel('Event').selectOption({ label: s.galaName });
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(entries(page)).toHaveCount(1);
    await expect(entries(page).first()).toContainText('Order paid');
    await page.getByLabel('Event').selectOption({ label: s.summitName });
    await page.getByLabel('What').selectOption({ label: 'Refund' });
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page.getByText('Nothing matches these filters')).toBeVisible();
    await expectAccessible(page);
    await page.reload();
    await expect(page.getByText(`Merged Taylor Reed (${s.dup.email})`)).toBeVisible();
    // The duplicate's address opens the person who stays.
    await page.goto(`/o/${slug}/audiences/people/${s.dup.contactId}`);
    await expect(page.getByText('That record was merged into this one.')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/people/${s.keep.contactId}`));
    // People lists the person once.
    await page.goto(`/o/${slug}/audiences/people?q=${s.tag}`);
    await expect(page.getByRole('link', { name: 'Taylor Reed' })).toHaveCount(1);

    // Undo, by keyboard: both records come back.
    await page.goto(`/o/${slug}/audiences/people/${s.keep.contactId}`);
    const undo = page.getByRole('button', { name: `Undo the merge of Taylor Reed (${s.dup.email})` });
    await undo.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByText('Merge undone. Both records are separate again, exactly as before.'),
    ).toBeVisible();
    await expect(entries(page).filter({ hasText: 'Order paid' })).toHaveCount(1);
    await expect(entries(page).filter({ hasText: s.galaName })).toHaveCount(0);
    await expect(page.getByText('Undone on')).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('link', { name: 'Open the other record' }).click();
    await expect(page.getByText(s.dup.email).first()).toBeVisible();
    await expect(entries(page).filter({ hasText: s.galaName })).toHaveCount(1);
    // The pair is back in the queue.
    await page.goto(`/o/${slug}/audiences/duplicates`);
    await expect(page.getByRole('link', { name: 'Open (1)' })).toBeVisible();
  });

  test('not the same person; bulk merge validation, step-up and success', async ({ page }) => {
    const { slug, owner } = await orgWithScenario(page);
    await scanNow(page, slug);
    // Nothing selected: an inline error.
    await page.getByRole('button', { name: 'Merge selected' }).click();
    await expect(page.getByText('Select at least one pair to merge.')).toBeVisible();
    await expectAccessible(page);
    // Bulk merges need a fresh sign-in.
    await ageSession(page);
    await page.getByRole('checkbox', { name: 'Select Taylor Reed and Taylor Reed' }).check();
    await page.getByRole('button', { name: 'Merge selected' }).click();
    await confirmStepUp(page, codeForKey(owner.setupKey as string));
    await expect(page.getByText('Merged 1 pair. Each merge can be undone for 30 days.')).toBeVisible();
    await expect(page.getByText('No possible duplicates')).toBeVisible();
    await page.getByRole('link', { name: 'Merged' }).click();
    await expect(
      page.getByRole('region', { name: 'Merged pairs' }).getByText('Same email address'),
    ).toBeVisible();
    await expectAccessible(page);
  });

  test('a pair marked "not the same person" leaves the queue for good', async ({ page }) => {
    const { slug } = await orgWithScenario(page);
    await scanNow(page, slug);
    await page.getByRole('link', { name: 'Review Taylor Reed and Taylor Reed' }).click();
    await page.getByRole('button', { name: 'Not the same person' }).click();
    await expect(
      page.getByText("Marked as not the same person. This pair won't be suggested again."),
    ).toBeVisible();
    await expect(page.getByText('No possible duplicates')).toBeVisible();
    // Checking again doesn't bring it back.
    await page.getByRole('button', { name: 'Look for duplicates' }).click();
    await expect(page.getByText('Found 1 possible duplicate.')).toBeVisible();
    await expect(page.getByText('No possible duplicates')).toBeVisible();
    await page.getByRole('link', { name: 'Not duplicates' }).click();
    await expect(page.getByRole('region', { name: 'Pairs marked as not the same person' })).toBeVisible();
    await expectAccessible(page);
  });

  test('people search and empty states', async ({ page }) => {
    const { slug, s } = await orgWithScenario(page);
    await page.goto(`/o/${slug}/audiences/people`);
    await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible();
    await page.getByLabel('Search by name, email or company').fill('Lakeside Partners');
    await page.getByLabel('Search by name, email or company').press('Enter');
    await expect(page.getByRole('link', { name: 'Taylor Reed' })).toHaveCount(1);
    await page.getByLabel('Search by name, email or company').fill(`nobody-${s.tag}`);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText('No one matches')).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/o/${slug}/audiences/people/${s.other.contactId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Jordan Blake' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Merged records' })).toHaveCount(0);
    await expect(entries(page).filter({ hasText: 'Campaign sent' })).toHaveCount(1);
  });

  test('a viewer can not open people or duplicates; a marketing member reads but can not merge', async ({
    page,
    browser,
  }) => {
    const { slug, s } = await orgWithScenario(page);
    await scanNow(page, slug);
    const viewer = await asMember(browser, slug, 'viewer');
    for (const path of ['people', 'duplicates', `people/${s.keep.contactId}`]) {
      const res = await viewer.page.goto(`/o/${slug}/audiences/${path}`);
      expect(res?.status()).toBe(404);
    }
    await viewer.context.close();
    // Seeded viewer, seeded org: refused too.
    const seeded = await browser.newContext();
    const jordan = await seeded.newPage();
    await signIn(jordan, 'jordan@lakeside.test');
    expect((await jordan.goto('/o/lakeside-events/audiences/duplicates'))?.status()).toBe(404);
    await seeded.close();

    const m = await asMember(browser, slug, 'marketing');
    await m.page.goto(`/o/${slug}/audiences/duplicates`);
    await expect(m.page.getByRole('heading', { level: 1, name: 'Possible duplicates' })).toBeVisible();
    await expect(m.page.getByRole('button', { name: 'Look for duplicates' })).toHaveCount(0);
    await expect(m.page.getByRole('checkbox')).toHaveCount(0);
    await expect(m.page.getByRole('button', { name: 'Merge selected' })).toHaveCount(0);
    await m.page.getByRole('link', { name: 'Review Taylor Reed and Taylor Reed' }).click();
    await expect(m.page.getByTestId('merged-consent')).toBeVisible();
    await expect(m.page.getByRole('button', { name: 'Merge records' })).toHaveCount(0);
    await expect(m.page.getByRole('button', { name: 'Not the same person' })).toHaveCount(0);
    await m.page.goto(`/o/${slug}/audiences/people/${s.keep.contactId}`);
    await expect(entries(m.page).first()).toBeVisible();
    await expectAccessible(m.page);
    await m.context.close();
  });

  test('Arabic (RTL): duplicates, compare and the timeline', async ({ page }) => {
    const { slug, s } = await orgWithScenario(page);
    await scanNow(page, slug);
    await page.goto(`/ar/o/${slug}/audiences/duplicates`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'تكرارات محتملة' })).toBeVisible();
    await expect(page.getByText('البريد الإلكتروني نفسه')).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('link', { name: 'مراجعة' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'مراجعة تكرار محتمل' })).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar/o/${slug}/audiences/people/${s.keep.contactId}`);
    await expect(page.getByRole('heading', { name: 'الخط الزمني' })).toBeVisible();
    await expect(entries(page).filter({ hasText: 'طلب مدفوع' })).toHaveCount(1);
    await expectAccessible(page);
  });
});
