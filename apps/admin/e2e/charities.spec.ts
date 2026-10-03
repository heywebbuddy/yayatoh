import { expect, type Page, test } from '@playwright/test';
import {
  expectAccessible,
  makeStaff,
  replayForm,
  serverForm,
  signInStaff,
  WEB,
  webPage,
  webUser,
} from './helpers.ts';

/**
 * M4.8b staff verification of charity profiles against the IRS exempt-organization list (the
 * recorded fixture in dev and CI): the waiting list, the review page beside the IRS record, verify
 * with a note, reject or withdraw with a note the org sees, ineligible records, keyboard only, and
 * finance staff refused. Each test makes its own org on the web app.
 */

const nameOf = (slug: string) => `Test Org ${slug.replace(/^e2e-/, '')}`;

/** A fresh org whose owner saves a charity profile on the web app. */
async function orgWithProfile(
  browser: import('@playwright/test').Browser,
  profile: { legalName: string; ein: string },
): Promise<{ slug: string; owner: Page }> {
  const owner = await webPage(browser);
  const user = await webUser(owner, { org: true });
  const slug = user.orgSlug ?? '';
  await owner.goto(`${WEB}/o/${slug}/charity`);
  await owner.getByLabel('Legal name', { exact: true }).fill(profile.legalName);
  await owner.getByLabel('EIN', { exact: true }).fill(profile.ein);
  await owner.getByRole('button', { name: 'Send for verification' }).click();
  await expect(owner.getByText('Saved. Yayatoh will review it.')).toBeVisible();
  return { slug, owner };
}

/** Open the org's review from the waiting list. */
async function openReview(page: Page, slug: string) {
  await page.goto('/charities');
  await expect(page.getByRole('heading', { name: 'Charity profiles', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: `${nameOf(slug)} (${slug})` }).click();
  await expect(
    page.getByRole('heading', { name: `Charity profile of ${nameOf(slug)}`, level: 1 }),
  ).toBeVisible();
}

test.describe('charity profiles (M4.8b)', () => {
  test('staff verify an eligible profile against the IRS list; the org sees it verified', async ({
    page,
    browser,
  }) => {
    const { slug, owner } = await orgWithProfile(browser, {
      legalName: 'Harbor Arts Alliance',
      ein: '234567891',
    });
    await signInStaff(page);
    await page
      .getByRole('navigation', { name: 'Staff console' })
      .getByRole('link', { name: 'Charities' })
      .click();
    const row = page.getByRole('row').filter({ hasText: `${nameOf(slug)} (${slug})` });
    await expect(row).toContainText('Harbor Arts Alliance');
    await expect(row).toContainText('23-4567891');
    await expect(row).toContainText('Waiting for review');
    await expectAccessible(page);

    await openReview(page, slug);
    const irs = page.getByRole('region', { name: 'IRS exempt-organization list: EIN 23-4567891' });
    await expect(irs.getByText('Source: the recorded test list (dev and CI only).')).toBeVisible();
    await expect(irs.getByText('HARBOR ARTS ALLIANCE')).toBeVisible();
    await expect(irs.getByText('(matches)')).toBeVisible();
    await expect(irs.getByText('Eligible: a 501(c)(3) to which contributions are deductible')).toBeVisible();
    await expectAccessible(page);

    const verify = page.getByRole('form', { name: 'Verify the charity profile' });
    await verify.getByLabel('Note (optional)').fill('EO BMF match, name and EIN');
    await verify.getByRole('button', { name: 'Verify' }).click();
    await expect(
      page.getByText('Verified. The org’s receipts are tax-deductible from now on.'),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'What the org entered' }).getByText('Verified'),
    ).toBeVisible();
    await expect(page.getByRole('form', { name: 'Verify the charity profile' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Withdraw verification' })).toBeVisible();
    await expectAccessible(page);

    // Listed as reviewed, no longer waiting.
    await page.goto('/charities');
    await expect(page.getByRole('row').filter({ hasText: slug })).toHaveCount(0);
    await page.getByRole('link', { name: 'Reviewed' }).click();
    await expect(page.getByRole('row').filter({ hasText: slug })).toContainText('Verified');

    await owner.reload();
    await expect(owner.getByText('Verified 501(c)(3)')).toBeVisible();
  });

  test('an ineligible EIN cannot be verified; staff reject with a note the org sees', async ({
    page,
    browser,
  }) => {
    // 45-6789123 is a 501(c)(4) in the recorded list.
    const { slug, owner } = await orgWithProfile(browser, {
      legalName: 'Neighbors Civic League',
      ein: '456789123',
    });
    await signInStaff(page);
    await openReview(page, slug);
    await expect(page.getByText('Not a 501(c)(3) organization')).toBeVisible();
    await expect(page.getByRole('form', { name: 'Verify the charity profile' })).toHaveCount(0);
    await expect(
      page.getByText(
        'This profile can’t be verified: the IRS list doesn’t show an eligible organization for its EIN.',
      ),
    ).toBeVisible();
    // A blank note gets past the browser's length check but not the server.
    const reject = page.getByRole('form', { name: 'Reject the charity profile' });
    await reject.getByLabel('Note to the org (required)').fill('     ');
    await reject.getByRole('button', { name: 'Reject' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Write a note of at least 3 characters for the org.' }),
    ).toBeVisible();
    await page
      .getByRole('form', { name: 'Reject the charity profile' })
      .getByLabel('Note to the org (required)')
      .fill('This EIN is a 501(c)(4) on the IRS list, not a 501(c)(3).');
    await page
      .getByRole('form', { name: 'Reject the charity profile' })
      .getByRole('button', { name: 'Reject' })
      .click();
    await expect(
      page.getByText('Rejected. The org sees your note; its receipts are not tax-deductible.'),
    ).toBeVisible();
    await expectAccessible(page);

    await owner.reload();
    await expect(owner.getByText('Not verified')).toBeVisible();
    await expect(owner.getByText('This EIN is a 501(c)(4) on the IRS list, not a 501(c)(3).')).toBeVisible();
  });

  test('a profile changed during the review is refused as stale; staff review the new version', async ({
    page,
    browser,
  }) => {
    const { slug, owner } = await orgWithProfile(browser, {
      legalName: 'Harbor Arts Alliance',
      ein: '234567891',
    });
    await signInStaff(page);
    await openReview(page, slug);
    const form = await serverForm(page, 'Verify the charity profile');
    // The org edits its profile meanwhile (a new version goes to review).
    await owner.getByLabel('Legal name', { exact: true }).fill('Harbor Arts Alliance Inc');
    await owner.getByRole('button', { name: 'Save and send for review' }).click();
    await expect(owner.getByText('Saved. Yayatoh will review it.')).toBeVisible();
    await replayForm(page, form);
    await expect(
      page.getByRole('alert').filter({ hasText: 'The org changed its profile while you reviewed it.' }),
    ).toBeVisible();
    await expect(page.getByText('(differs from the profile: check before verifying)')).toBeVisible();
  });

  test('keyboard only: staff verify without a pointer', async ({ page, browser }) => {
    const { slug } = await orgWithProfile(browser, { legalName: 'Harbor Arts Alliance', ein: '234567891' });
    await signInStaff(page);
    await openReview(page, slug);
    await page.getByLabel('Note (optional)').focus();
    await page.keyboard.type('Checked by keyboard');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Verify', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      page.getByText('Verified. The org’s receipts are tax-deductible from now on.'),
    ).toBeVisible();
  });

  test('finance staff neither see nor open charity reviews', async ({ page, browser }) => {
    const { slug } = await orgWithProfile(browser, { legalName: 'Harbor Arts Alliance', ein: '234567891' });
    const finance = await webPage(browser);
    const user = await webUser(finance, { signIn: false });
    makeStaff(user.email, 'finance');
    await signInStaff(page, user.email);
    await expect(page.getByRole('link', { name: 'Charities' })).toHaveCount(0);
    await page.goto('/charities');
    await expect(page).toHaveURL(/\/not-staff$/);
    const org = await page.request.get(`/charities?status=pending`);
    expect(org.url()).toMatch(/\/not-staff$/);
    expect(slug).toBeTruthy();
  });
});
