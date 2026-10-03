import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  ageSession,
  codeForKey,
  confirmStepUp,
  expectAccessible,
  expectAccessibleBothModes,
  newUser,
  signIn,
  stepUpDialog,
  type TestUser,
} from './helpers.ts';

/**
 * U3 (UX review 1, findings 2, 3 and 6): the blog's "View on your site" link on every host
 * class, the domain step-up that ended in an error, the domain connect wizard, and a venue
 * created with its photo in one flow.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
const DEV = `http://localhost:${PORT}`;
const APEX = `http://yayatoh.localhost:${PORT}`;
const APP = `http://app.yayatoh.com:${PORT}`;
const ORG = '/o/lakeside-events';
const VIEWER = 'jordan@lakeside.test';
const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'packages', 'modules', 'media', 'fixtures');
const PHOTO = () => ({
  name: 'hall.jpg',
  mimeType: 'image/jpeg',
  buffer: readFileSync(join(FIXTURES, 'photo-exif.jpg')),
});

const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;
const appCode = (user: TestUser) => codeForKey(user.setupKey ?? '');

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Create and publish a post or page through the console (on `origin`); returns its slug. */
async function publishEntry(page: Page, origin: string, org: string, kind: 'post' | 'page', title: string) {
  await page.goto(`${origin}${org}/content/new?kind=${kind}`);
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Text', { exact: true }).fill('Hello **world**.');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByText("Draft created. Publish it when it's ready.")).toBeVisible();
  const slug = (await page.getByLabel('Address', { exact: true }).inputValue()).trim();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();
  return slug;
}

const viewOnSite = (page: Page) => page.getByRole('link', { name: 'View on your site' });

/** Open the link the console shows and check the public entry renders there. */
async function opensPublicly(browser: Browser, href: string, title: string) {
  const guest = await (await browser.newContext()).newPage();
  const res = await guest.goto(href);
  expect(res?.status()).toBe(200);
  await expect(guest.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await guest.close();
}

async function freeAddress(page: Page, org: string) {
  await page.goto(`${org}/domains`);
  const setUp = page.getByRole('button', { name: 'Set up my free address' });
  if (await setUp.isVisible()) await setUp.click();
}

async function addDomain(page: Page, host: string) {
  const add = page.getByRole('region', { name: 'Add a domain you own' });
  await add.getByLabel('Domain').fill(host);
  await add.getByRole('button', { name: 'Add domain' }).click();
}

const domainCard = (page: Page, host: string) =>
  page.getByRole('list', { name: 'Your domains' }).getByRole('listitem').filter({ hasText: host });
const wizard = (page: Page, host: string) => page.getByRole('region', { name: `Connect ${host}` });
const currentStep = (page: Page, host: string) =>
  page.getByRole('navigation', { name: `Steps to connect ${host}` }).locator('[aria-current="step"]');

test.describe('U3: blog and page links resolve on every host class', () => {
  test('dev host: "View on your site" opens /organizers/{org}/…, never the console', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    // A fresh org: the seeded ones get custom domains from other specs running in parallel.
    const user = await newUser(page, { org: true, twoFactor: true });
    const org = `/o/${user.orgSlug}`;
    const base = `${DEV}/organizers/${user.orgSlug}`;
    const title = `Dev post ${s}`;
    const slug = await publishEntry(page, DEV, org, 'post', title);
    await expect(viewOnSite(page)).toHaveAttribute('href', `${base}/blogs/${slug}`);
    await opensPublicly(browser, `${base}/blogs/${slug}`, title);
    // Following the link from the console lands on the public post.
    await viewOnSite(page).click();
    await expect(page).toHaveURL(`${base}/blogs/${slug}`);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expectAccessible(page);

    const pageTitle = `Dev page ${s}`;
    const pageSlug = await publishEntry(page, DEV, org, 'page', pageTitle);
    await expect(viewOnSite(page)).toHaveAttribute('href', `${base}/pages/${pageSlug}`);
    await opensPublicly(browser, `${base}/pages/${pageSlug}`, pageTitle);
  });

  test('apex marketplace: from the dashboard host the link is the apex organizer page /o/{org}/…', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    // A fresh org whose owner is signed in on the dashboard host (the dev tool, posted from a
    // page there so the session cookie belongs to that host).
    await page.goto(`${APP}/dev/login`);
    const orgSlug = await page.evaluate(async () => {
      const body = new URLSearchParams({ org: 'new', twoFactor: '1' });
      const r = await fetch('/api/dev/user', { method: 'POST', body });
      return ((await r.json()) as { orgSlug: string }).orgSlug;
    });
    expect(orgSlug).toBeTruthy();
    const title = `Apex post ${s}`;
    const slug = await publishEntry(page, APP, `/o/${orgSlug}`, 'post', title);
    // The configured apex (yayatoh.com) with this request's port; the same path on a marketplace
    // host (yayatoh.localhost locally) is the public post.
    const href = await viewOnSite(page).getAttribute('href');
    expect(href).toBe(`http://yayatoh.com:${PORT}/o/${orgSlug}/blogs/${slug}`);
    await opensPublicly(browser, `${APEX}/o/${orgSlug}/blogs/${slug}`, title);
  });

  test('managed subdomain and custom domain: the tenant site at root paths', async ({ page, browser }) => {
    test.setTimeout(120_000);
    const s = stamp();
    const user = await newUser(page, { org: true, twoFactor: true });
    const org = `/o/${user.orgSlug}`;
    await freeAddress(page, org);
    await page.goto(`${org}/site`);
    await page.getByLabel(/Use my own site at/).check();
    const listing = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Listing' }) });
    await listing.getByRole('button', { name: 'Save' }).click();
    await expect(listing.getByText('Saved.')).toBeVisible();

    const managed = `http://${user.orgSlug}.yayatoh.events:${PORT}`;
    const title = `Subdomain post ${s}`;
    const slug = await publishEntry(page, DEV, org, 'post', title);
    await expect(viewOnSite(page)).toHaveAttribute('href', `${managed}/blogs/${slug}`);
    await opensPublicly(browser, `${managed}/blogs/${slug}`, title);

    // A custom domain connected through the wizard becomes the primary host: links follow it.
    const host = `site-${s}.verified.test`;
    await page.goto(`${org}/domains`);
    await addDomain(page, host);
    await domainCard(page, host)
      .getByRole('button', { name: `Check now ${host}` })
      .click();
    await expect(domainCard(page, host).getByText('Primary', { exact: true })).toBeVisible();
    const custom = `http://${host}:${PORT}`;
    const customTitle = `Custom post ${s}`;
    const customSlug = await publishEntry(page, DEV, org, 'post', customTitle);
    await expect(viewOnSite(page)).toHaveAttribute('href', `${custom}/blogs/${customSlug}`);
    await opensPublicly(browser, `${custom}/blogs/${customSlug}`, customTitle);
  });
});

test.describe('U3: domains — step-up that completes, and the connect wizard', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('a demo persona (signed in with one click, no authenticator) confirms without a code after the window expires', async ({
    page,
  }) => {
    const host = `persona-${stamp()}.example.org`;
    await signIn(page);
    await page.goto(`${ORG}/domains`);
    await ageSession(page);
    await addDomain(page, host);
    const dialog = stepUpDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Demo account: it signed in without an authenticator/)).toBeVisible();
    await expectAccessible(page);

    // Escape first: the error now offers the way forward instead of a dead end.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    const add = page.getByRole('region', { name: 'Add a domain you own' });
    await expect(
      add.getByRole('alert').filter({ hasText: "Please confirm it's you to continue." }),
    ).toBeVisible();
    await expect(add.getByLabel('Domain')).toHaveValue(host);
    await expectAccessible(page);
    // Keyboard only: "Confirm it's you" reopens the dialog with the same submission.
    await add.getByRole('button', { name: "Confirm it's you" }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Continue without a code (demo account)' }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(wizard(page, host)).toBeVisible();
    await expect(currentStep(page, host)).toHaveText(/DNS records/);
    await expect(add.getByText('Domain added. Now publish the DNS records shown above.')).toBeVisible();

    // Clean up (still fresh: no second dialog).
    await domainCard(page, host)
      .getByRole('button', { name: `Remove ${host}` })
      .click();
    await expect(domainCard(page, host)).toHaveCount(0);
    await expect(stepUpDialog(page)).toHaveCount(0);
  });

  test('an owner with an authenticator: expired window → dialog → code → the domain is added', async ({
    page,
  }) => {
    const user = await newUser(page, { org: true, twoFactor: true });
    const host = `code-${stamp()}.example.org`;
    await page.goto(`/o/${user.orgSlug}/domains`);
    await ageSession(page);
    await addDomain(page, host);
    // Real accounts never see the demo shortcut.
    await expect(stepUpDialog(page).getByLabel('Code')).toBeFocused();
    await expect(stepUpDialog(page).getByRole('button', { name: /demo account/ })).toHaveCount(0);
    await confirmStepUp(page, appCode(user));
    await expect(wizard(page, host)).toBeVisible();
    await page.reload();
    await expect(domainCard(page, host).getByText('Waiting for DNS', { exact: true })).toBeVisible();
  });

  test('the wizard: how it works, copy the records, live check, certificate, primary; failures say how to fix', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const s = stamp();
    const user = await newUser(page, { org: true, twoFactor: true });
    const org = `/o/${user.orgSlug}`;
    await freeAddress(page, org);
    await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
    await expect(page.getByText(/Copy the DNS records we show/)).toBeVisible();
    await expectAccessibleBothModes(page);

    // 1 → 2: added; the DNS step shows the records with copy buttons and plain instructions.
    const host = `shop-${s}.verified.test`;
    await addDomain(page, host);
    const w = wizard(page, host);
    await expect(w).toBeVisible();
    await expect(currentStep(page, host)).toHaveText(/DNS records/);
    await expect(w.getByText(/Sign in where you manage your domain's DNS/)).toBeVisible();
    await expect(w.getByRole('table', { name: `DNS records for ${host}` })).toBeVisible();
    await w.getByRole('button', { name: 'Copy value of the TXT record' }).click();
    await expect(w.getByText('Copied').first()).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(new RegExp(`^vc-domain-verify=${host.replace(/\./g, '\\.')},[0-9a-f]{16}$`));
    await w.getByRole('button', { name: 'Copy name of the CNAME record' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(host);
    await expectAccessibleBothModes(page);
    await noHorizontalScroll(page);

    // Live check, by keyboard: DNS and the certificate are ready, and the first custom domain
    // becomes primary on its own, so the wizard is done.
    await w.getByRole('button', { name: `Check now ${host}` }).focus();
    await page.keyboard.press('Enter');
    const card = domainCard(page, host);
    await expect(card.getByText('Active', { exact: true })).toBeVisible();
    await expect(card.getByText('Primary', { exact: true })).toBeVisible();
    await expect(wizard(page, host)).toHaveCount(0);
    await expect(card.getByText('Apple Pay and Google Pay are ready here.')).toBeVisible();

    // A second live domain stops at the last step: make it primary (with step-up).
    const second = `www-${s}.verified.test`;
    await addDomain(page, second);
    await domainCard(page, second)
      .getByRole('button', { name: `Check now ${second}` })
      .click();
    await expect(currentStep(page, second)).toHaveText(/Primary/);
    await expect(wizard(page, second).getByText(`${second} is live.`, { exact: false })).toBeVisible();
    await expect(wizard(page, second).getByText(/^Last checked /)).toBeVisible();
    await expectAccessible(page);
    await ageSession(page);
    await wizard(page, second)
      .getByRole('button', { name: `Make primary ${second}` })
      .click();
    await confirmStepUp(page, appCode(user));
    await expect(domainCard(page, second).getByText('Primary', { exact: true })).toBeVisible();
    // The first one is no longer primary: its wizard is back at the last step, offering it again.
    await expect(wizard(page, host)).toBeVisible();
    await expect(wizard(page, host).getByRole('button', { name: `Make primary ${host}` })).toBeVisible();
    await expect(currentStep(page, host)).toHaveText(/Primary/);

    // A domain pointing elsewhere: the check says what is wrong and how to fix it.
    const broken = `bad-${s}.fail.test`;
    await addDomain(page, broken);
    await domainCard(page, broken)
      .getByRole('button', { name: `Check now ${broken}` })
      .click();
    await expect(domainCard(page, broken).getByText('Not working')).toBeVisible();
    await expect(
      wizard(page, broken).getByRole('alert').filter({ hasText: 'This domain points somewhere else.' }),
    ).toBeVisible();
    await expect(currentStep(page, broken)).toHaveText(/DNS records/);
    await expectAccessible(page);

    // Persisted after a reload.
    await page.reload();
    await expect(domainCard(page, second).getByText('Primary', { exact: true })).toBeVisible();
    await expect(currentStep(page, broken)).toHaveText(/DNS records/);

    // Arabic: right-to-left, accessible.
    await page.goto(`/ar${org}/domains`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'كيف يعمل' })).toBeVisible();
    await expect(page.getByRole('region', { name: `ربط ${broken}` })).toBeVisible();
    await expectAccessibleBothModes(page);
    await noHorizontalScroll(page);
  });

  test('a viewer sees domains read-only: no add form, no checks, no wizard actions', async ({ page }) => {
    await signIn(page, VIEWER);
    await page.goto(`${ORG}/domains`);
    await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
    await expect(page.getByText('Only owners and admins can change domains.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Add a domain you own' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Check now/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Make primary/ })).toHaveCount(0);
    await expectAccessible(page);
  });
});

test.describe('U3: a venue is created with its photo in one flow', () => {
  test('create (essentials only) → photos → details; the list shows a thumbnail; the public page shows it', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const name = `Photo Flow Hall ${stamp()}`;
    await signIn(page);
    await page.goto(`${ORG}/venues`);
    const create = page.getByRole('region', { name: 'Add a venue' });
    // Only what is needed to create it; the rest follows.
    await expect(create.getByLabel('Map link')).toHaveCount(0);
    await expect(create.getByText(/Photos and the other details/)).toBeVisible();
    await create.getByLabel('Venue name').fill(name);
    await create.getByLabel('Capacity', { exact: true }).fill('180');
    await create.getByLabel('City', { exact: true }).fill('Madison');
    await create.getByLabel('Country code').fill('us');
    await create.getByLabel(/List this venue in the Yayatoh venue directory/).check();
    await create.getByRole('button', { name: 'Add venue' }).click();

    // Step 2: photos, right away, above the details.
    await expect(page.getByText('Venue added.')).toBeVisible();
    await expect(page.getByText('Add photos now, then fill in the details below.')).toBeVisible();
    const steps = page.getByRole('navigation', { name: 'New venue' });
    await expect(steps.locator('[aria-current="step"]')).toHaveText(/Photos/);
    await expectAccessibleBothModes(page);
    const photos = page.getByRole('region', { name: 'Venue photos' });
    // Keyboard: choose the file, describe it, upload.
    await photos.getByLabel('Image file').focus();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Space')]);
    await chooser.setFiles(PHOTO());
    await photos.getByLabel('Alt text').fill('The main hall with a stage');
    await photos.getByRole('button', { name: 'Upload image' }).press('Enter');
    await expect(photos.getByRole('status').filter({ hasText: 'Image uploaded.' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(steps.locator('[aria-current="step"]')).toHaveText(/Details/);

    // Step 3: the details.
    const details = page.getByRole('region', { name: 'Details', exact: true });
    await details.getByLabel('Street address').fill('1 Lake Shore Road');
    await details.getByLabel('Accessibility notes').fill('Step-free entrance.');
    await details.getByRole('button', { name: 'Save venue' }).click();
    await expect(page.getByText('Venue saved.')).toBeVisible();
    await page.reload();
    await expect(details.getByLabel('Street address')).toHaveValue('1 Lake Shore Road');

    // The public venue page shows the photo; the list shows its thumbnail.
    const slug = (await page.getByRole('link', { name: 'View public page' }).getAttribute('href'))
      ?.split('/')
      .pop();
    const guest = await (await browser.newContext()).newPage();
    await guest.goto(`/venues/${slug}`);
    await expect(
      guest.getByRole('region', { name: 'Photos' }).getByRole('img', { name: 'The main hall with a stage' }),
    ).toBeVisible();
    await guest.close();
    await page.goto(`${ORG}/venues`);
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row.getByTestId('venue-thumb')).toBeVisible();
    await expectAccessibleBothModes(page);
    await noHorizontalScroll(page);
  });

  test('Arabic: the new-venue steps render right-to-left', async ({ page }) => {
    await signIn(page);
    await page.goto(`/ar${ORG}/venues`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const create = page.getByRole('region', { name: 'إضافة مكان' });
    await expect(create).toBeVisible();
    await create.getByLabel('اسم المكان').fill(`قاعة ${stamp()}`);
    await create.getByLabel('رمز البلد').fill('ae');
    await create.getByRole('button', { name: 'إضافة المكان' }).click();
    await expect(page.getByRole('navigation', { name: 'مكان جديد' })).toBeVisible();
    await expect(page).toHaveURL(/\/ar\/o\/lakeside-events\/venues\/[0-9a-f-]+\?saved=1$/);
    await expectAccessible(page);
    await noHorizontalScroll(page);
  });
});
