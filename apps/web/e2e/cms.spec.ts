import { type Browser, expect, type Page, test } from '@playwright/test';
import { BlogPostingJsonLdSchema } from '../src/lib/seo/jsonld.ts';
import { expectAccessible, newUser, signIn } from './helpers.ts';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const APEX = `http://yayatoh.localhost:${PORT}`;
const VIEWER = 'jordan@lakeside.test';
const ORG = '/o/lakeside-events';

const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Create a post or page through the console; returns its edit URL and slug. */
async function createEntry(
  page: Page,
  org: string,
  kind: 'post' | 'page',
  title: string,
  body = 'Hello **world**.',
): Promise<{ edit: string; slug: string }> {
  await page.goto(`${org}/content/new?kind=${kind}`);
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Text', { exact: true }).fill(body);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByText("Draft created. Publish it when it's ready.")).toBeVisible();
  const slug = (await page.getByLabel('Address', { exact: true }).inputValue()).trim();
  return { edit: new URL(page.url()).pathname, slug };
}

async function publish(page: Page) {
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();
}

async function viewerPage(browser: Browser) {
  const viewer = await (await browser.newContext()).newPage();
  await signIn(viewer, VIEWER);
  return viewer;
}

test.describe('tenant CMS: pages and blog (M1.4g)', () => {
  test('an owner writes a post: validation, preview, draft 404, publish, public page, JSON-LD, sitemap, unpublish', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const s = stamp();
    await signIn(page);
    await page.goto(`${ORG}/content`);
    await expect(page.getByRole('heading', { level: 1, name: 'Pages & blog' })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('link', { name: 'New post' }).click();
    await expect(page).toHaveURL(/\/content\/new\?kind=post$/);

    // Validation: no title, then a malformed address; each message sits next to its field.
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page.getByText('Give it a title (up to 160 characters).')).toBeVisible();
    await expect(page.getByLabel('Title', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await page.getByLabel('Title', { exact: true }).fill(`Summer notes ${s}`);
    await page.getByLabel('Address', { exact: true }).fill('Not A Slug!');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page.getByText('Use lowercase letters, digits and single hyphens.')).toBeVisible();
    await expectAccessible(page);
    await page.getByLabel('Address', { exact: true }).fill('');

    // The preview renders the Markdown exactly as the public page will; raw HTML stays text.
    await page
      .getByLabel('Text', { exact: true })
      .fill('## Line-up\n\n- Jazz trio\n- **Food trucks**\n\n<script>alert(1)</script>');
    const preview = page.getByRole('region', { name: 'Preview' });
    await expect(preview).toBeHidden();
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Hide preview' })).toHaveAttribute('aria-pressed', 'true');
    await expect(preview.getByRole('heading', { name: 'Line-up' })).toBeVisible();
    await expect(preview.getByText('<script>alert(1)</script>')).toBeVisible();
    await expectAccessible(page);
    await page.getByLabel('Summary', { exact: true }).fill('What is on this summer.');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page.getByText("Draft created. Publish it when it's ready.")).toBeVisible();
    const slug = await page.getByLabel('Address', { exact: true }).inputValue();
    expect(slug).toBe(`summer-notes-${s}`);
    const edit = new URL(page.url()).pathname;
    const publicUrl = `${APEX}/o/lakeside-events/blogs/${slug}`;

    // A draft is a 404 publicly.
    const guest = await (await page.context().browser()?.newContext())?.newPage();
    if (!guest) throw new Error('no browser');
    expect((await guest.goto(publicUrl))?.status()).toBe(404);

    // Publish: the address freezes, the public page renders sanitized Markdown with JSON-LD.
    await page.goto(edit);
    await publish(page);
    await expect(page.getByLabel('Address', { exact: true })).toHaveAttribute('readonly', '');
    await expect(page.getByText(`Published at /blogs/${slug}.`, { exact: false })).toBeVisible();
    await expectAccessible(page);

    expect((await guest.goto(publicUrl))?.status()).toBe(200);
    await expect(guest.getByRole('heading', { level: 1, name: `Summer notes ${s}` })).toBeVisible();
    await expect(guest.getByRole('heading', { name: 'Line-up' })).toBeVisible();
    await expect(guest.getByText('<script>alert(1)</script>')).toBeVisible();
    await expect(guest.locator('main script:not([type])')).toHaveCount(0);
    const ld = JSON.parse((await guest.locator('script[type="application/ld+json"]').textContent()) ?? '{}');
    const posting = BlogPostingJsonLdSchema.parse(ld);
    expect(posting.url).toMatch(new RegExp(`/o/lakeside-events/blogs/${slug}$`));
    expect(posting.headline).toBe(`Summer notes ${s}`);
    await expect(guest.locator('link[rel="canonical"]')).toHaveAttribute('href', posting.url);
    await expect(guest.locator('link[rel="alternate"][hreflang]')).toHaveCount(14);
    await expectAccessible(guest);
    await noHorizontalScroll(guest);

    // The blog index lists it; the organizer page links the blog.
    await guest.goto(`${APEX}/o/lakeside-events/blogs`);
    await expect(guest.getByRole('link', { name: `Summer notes ${s}` })).toBeVisible();
    await expectAccessible(guest);
    await guest.goto(`${APEX}/o/lakeside-events`);
    await guest.getByRole('link', { name: 'Blog', exact: true }).first().click();
    await expect(guest).toHaveURL(`${APEX}/o/lakeside-events/blogs`);

    // The marketplace sitemap lists it with hreflang alternates.
    const map = (await (await guest.goto(`${APEX}/sitemaps/en.xml`))?.text()) ?? '';
    expect(map).toContain(`/o/lakeside-events/blogs/${slug}</loc>`);

    // Unpublish: 404 again, and not in the sitemap.
    await page.getByRole('button', { name: 'Unpublish' }).click();
    await expect(page.getByText('Draft', { exact: true })).toBeVisible();
    expect((await guest.goto(publicUrl))?.status()).toBe(404);
    // A fresh URL: the sitemap is cacheable for 10 minutes.
    expect((await (await guest.goto(`${APEX}/sitemaps/en.xml?after=unpublish`))?.text()) ?? '').not.toContain(
      slug,
    );
    // Still frozen: it was published once.
    await page.reload();
    await expect(page.getByLabel('Address', { exact: true })).toHaveAttribute('readonly', '');
  });

  test('pages link from a tenant site’s navigation (fresh org with its own site)', async ({ page }) => {
    test.setTimeout(120_000);
    const s = stamp();
    const user = await newUser(page, { org: true, twoFactor: true });
    const org = `/o/${user.orgSlug}`;
    // Its free address, and the tenant site switched on.
    await page.goto(`${org}/domains`);
    const setUp = page.getByRole('button', { name: 'Set up my free address' });
    if (await setUp.isVisible()) await setUp.click();
    await expect(page.getByText(`${user.orgSlug}.yayatoh.events`).first()).toBeVisible();
    await page.goto(`${org}/site`);
    await page.getByLabel(/Use my own site at/).check();
    const listing = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Listing' }) });
    await listing.getByRole('button', { name: 'Save' }).click();
    await expect(listing.getByText('Saved.')).toBeVisible();

    // The Site navigation section says there are no pages yet.
    await expect(page.getByText('You have no pages yet. Create one under Pages & blog.')).toBeVisible();

    const { slug } = await createEntry(page, org, 'page', `About us ${s}`, '## Our story\n\nSince 2019.');
    await publish(page);
    const draft = await createEntry(page, org, 'page', `Draft FAQ ${s}`);
    await page.goto(`${org}/site`);
    const nav = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Site navigation' }) });
    await nav.getByLabel(`About us ${s}`, { exact: true }).check();
    await nav.getByLabel(new RegExp(`^Draft FAQ ${s}`)).check();
    await nav.getByRole('button', { name: 'Save' }).click();
    await expect(nav.getByText('Saved.')).toBeVisible();
    await expectAccessible(page);
    // Persisted after reload.
    await page.reload();
    await expect(nav.getByLabel(`About us ${s}`, { exact: true })).toBeChecked();

    const site = `http://${user.orgSlug}.yayatoh.events:${PORT}`;
    await page.goto(`${site}/`);
    const header = page.getByRole('navigation', { name: `Test Org ${user.orgSlug?.slice(4)} site` });
    await expect(header.getByRole('link', { name: `About us ${s}` })).toBeVisible();
    // The draft page is linked but only shows once published.
    await expect(header.getByRole('link', { name: `Draft FAQ ${s}` })).toHaveCount(0);
    await header.getByRole('link', { name: `About us ${s}` }).click();
    await expect(page).toHaveURL(`${site}/pages/${slug}`);
    await expect(page.getByRole('heading', { level: 1, name: `About us ${s}` })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Our story' })).toBeVisible();
    await expect(header.getByRole('link', { name: `About us ${s}` })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${site}/pages/${slug}`);
    await expectAccessible(page);
    expect((await page.goto(`${site}/pages/${draft.slug}`))?.status()).toBe(404);
    // The tenant sitemap lists the page; the empty blog shows its empty state.
    expect((await (await page.goto(`${site}/sitemaps/en.xml`))?.text()) ?? '').toContain(
      `/pages/${slug}</loc>`,
    );
    await page.goto(`${site}/blogs`);
    await expect(page.getByText('No posts yet')).toBeVisible();
    await expectAccessible(page);
  });

  test('delete asks for confirmation, all by keyboard; the page disappears publicly', async ({ page }) => {
    const s = stamp();
    await signIn(page);
    const { slug } = await createEntry(page, ORG, 'post', `Delete me ${s}`);
    await publish(page);
    const del = page.getByRole('button', { name: 'Delete', exact: true });
    await del.focus();
    await page.keyboard.press('Enter');
    const confirm = page.getByRole('button', { name: 'Yes, delete' });
    await expect(confirm).toBeFocused();
    await expect(page.getByRole('heading', { name: `Delete "Delete me ${s}"?` })).toBeVisible();
    await expectAccessible(page);
    // Cancel returns focus to Delete.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/content\?kind=post&deleted=1$/);
    await expect(page.getByText('Deleted.')).toBeVisible();
    await expect(page.getByRole('link', { name: `Delete me ${s}` })).toHaveCount(0);
    expect((await page.goto(`${APEX}/o/lakeside-events/blogs/${slug}`))?.status()).toBe(404);
  });

  test('a viewer reads only: no controls, refused on the new page and on a stale form', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    await signIn(page);
    const { edit } = await createEntry(page, ORG, 'post', `Viewer check ${s}`, '## Read me');

    const viewer = await viewerPage(browser);
    await viewer.goto(`${ORG}/content`);
    await expect(
      viewer.getByText("You can read your team's pages and posts but not change them."),
    ).toBeVisible();
    await expect(viewer.getByRole('link', { name: 'New post' })).toHaveCount(0);
    await expectAccessible(viewer);
    await viewer.goto(`${ORG}/content/new?kind=post`);
    await expect(
      viewer.getByRole('alert').filter({ hasText: "You don't have permission to write pages or posts." }),
    ).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Create draft' })).toHaveCount(0);
    await viewer.goto(edit);
    await expect(viewer.getByRole('heading', { name: 'Read me' })).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await expectAccessible(viewer);

    // The owner's open form, submitted after switching to the viewer: the server refuses.
    await page.goto(edit);
    await signIn(page, VIEWER);
    await page.getByLabel('Title', { exact: true }).fill('Hijacked');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('alert').filter({ hasText: "You don't have access to this." })).toBeVisible();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: "You don't have access to this." }).first(),
    ).toBeVisible();
  });

  test('the marketplace blog shows the content org’s posts at /blogs', async ({ page }) => {
    const s = stamp();
    await signIn(page, 'lee@harbor.test');
    const { slug } = await createEntry(page, '/o/harbor-arts', 'post', `Harbor news ${s}`, 'Opening night.');
    await publish(page);
    await page.goto(`${APEX}/blogs`);
    await expect(page.getByRole('heading', { level: 1, name: 'Harbor Arts Collective blog' })).toBeVisible();
    await page.getByRole('link', { name: `Harbor news ${s}` }).click();
    await expect(page).toHaveURL(`${APEX}/blogs/${slug}`);
    await expect(page.getByText('Opening night.')).toBeVisible();
    await expect(page.getByText('by Lee Harbor')).toBeVisible();
    await expectAccessible(page);
    expect((await page.goto(`${APEX}/pages/no-such-page-${s}`))?.status()).toBe(404);
  });

  test('Arabic: the console and a public post render right-to-left', async ({ page }) => {
    const s = stamp();
    await signIn(page);
    const { slug } = await createEntry(page, ORG, 'post', `RTL ${s}`, '## عنوان\n\nنص عربي.');
    await publish(page);
    await page.goto(`/ar${ORG}/content`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الصفحات والمدونة');
    await expectAccessible(page);
    await noHorizontalScroll(page);
    await page.goto(`/ar${ORG}/content/new?kind=page`);
    await expect(page.getByRole('button', { name: 'إنشاء مسودة' })).toBeVisible();
    await expectAccessible(page);
    await page.goto(`${APEX}/ar/o/lakeside-events/blogs/${slug}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('link', { name: 'كل التدوينات' })).toBeVisible();
    await expectAccessible(page);
    await noHorizontalScroll(page);
  });
});
