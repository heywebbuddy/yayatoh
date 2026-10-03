import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { catchUpListings } from '@yayatoh/marketplace';
import { signLinkToken } from '@yayatoh/platform';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { expectAccessible, pickOption, signIn } from './helpers.ts';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const MARKET = `http://yayatoh.localhost:${PORT}`;
const HARBOR_SITE = `http://harbor-arts.yayatoh.events:${PORT}`;
const ORG = '/o/lakeside-events';
const VIEWER = 'jordan@lakeside.test';
const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'packages', 'modules', 'media', 'fixtures');
const fixture = (name: string) => readFileSync(join(FIXTURES, name));

const file = (name: string, mimeType: string, buffer: Buffer) => ({ name, mimeType, buffer });
const BANNER = () => file('stage.png', 'image/png', fixture('banner.png'));
const PHOTO = () => file('photo.jpg', 'image/jpeg', fixture('photo-exif.jpg'));
const SMALL = () => file('small.webp', 'image/webp', fixture('small.webp'));

const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;

test.afterAll(async () => {
  await closePools();
});

/** No worker runs under e2e: apply the org's outbox to the listings projector, as the worker would. */
async function runProjector(page: Page, orgSlug: string) {
  const org = await resolveOrgSlug(orgSlug);
  if (!org) throw new Error(`no org ${orgSlug}`);
  await catchUpListings(org.orgId);
  const res = await page.request.post('/api/internal/revalidate', {
    data: { token: signLinkToken('cache.revalidate', org.orgId) },
  });
  expect(res.status()).toBe(200);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Create a draft event through the UI; returns its console path and slug. */
async function createEvent(page: Page, name: string, org = ORG) {
  await page.goto(`${org}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await pickOption(page.getByLabel('Time zone'), 'America/Chicago');
  await page.getByLabel('Starts', { exact: true }).fill('2029-06-12T18:00');
  await page.getByLabel('Ends', { exact: true }).fill('2029-06-12T22:00');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByText('Draft ·')).toBeVisible();
  const base = new URL(page.url()).pathname.replace(/^\/[a-z]{2}(-[A-Z]{2})?(?=\/o\/)/, '');
  return { base, slug: base.split('/').pop() ?? '' };
}

async function publish(page: Page, base: string) {
  await page.goto(base);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
}

const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

/** Upload through the uploader in `where` (file input, alt text, submit) and wait for success. */
async function upload(
  where: Locator,
  f: { name: string; mimeType: string; buffer: Buffer },
  alt: string | null,
) {
  // The upload form (each image's own alt-text form is inside the list above it).
  const form = where.getByRole('form');
  await form.getByLabel('Image file').setInputFiles(f);
  if (alt === null) await form.getByLabel('Decorative image (no description needed)').check();
  else await form.getByLabel('Alt text').fill(alt);
  await form.getByRole('button', { name: /^(Upload image|Replace image)$/ }).click();
  await expect(where.getByRole('status').filter({ hasText: 'Image uploaded.' })).toBeVisible({
    timeout: 30_000,
  });
}

/** Fetch an image URL the page shows, with the page's cookies (or none). */
async function fetchImage(page: Page, img: Locator) {
  const src = await img.evaluate((el: HTMLImageElement) => el.currentSrc || el.src);
  expect(src).toMatch(/\/media\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/\d+-[0-9a-f]{32}\.(avif|webp|jpg|png|svg)$/);
  return { src, res: await page.request.get(src) };
}

async function anonymous(browser: Browser) {
  return (await browser.newContext()).newPage();
}

test.describe('event cover (M1.4e)', () => {
  test('validation errors: no file, wrong type (by name and by bytes), too big, missing alt', async ({
    page,
  }) => {
    await signIn(page);
    const { base } = await createEvent(page, `Cover checks ${stamp()}`);
    await page.goto(`${base}/media`);
    await expect(page.getByRole('heading', { name: 'Images', level: 1 })).toBeVisible();
    await expectAccessible(page);
    await noHorizontalScroll(page);
    const cover = region(page, 'Cover image');
    await expect(cover.getByText('No cover image yet.')).toBeVisible();
    const input = cover.getByLabel('Image file');
    const submit = cover.getByRole('button', { name: 'Upload image' });

    await submit.click();
    await expect(cover.getByText('Choose an image file.')).toBeVisible();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toBeFocused();
    await expectAccessible(page);

    // A text file: refused before upload.
    await input.setInputFiles(file('notes.txt', 'text/plain', Buffer.from('not an image')));
    await cover.getByLabel('Alt text').fill('Notes');
    await submit.click();
    await expect(
      cover.getByText("This file isn't a supported image. Use JPEG, PNG, GIF, WebP, AVIF or SVG."),
    ).toBeVisible();

    // A text file named and typed as PNG: the server sniffs the bytes and refuses it.
    await input.setInputFiles(file('photo.png', 'image/png', fixture('text.png')));
    await submit.click();
    await expect(
      cover.getByText("This file isn't a supported image. Use JPEG, PNG, GIF, WebP, AVIF or SVG."),
    ).toBeVisible({ timeout: 15_000 });

    // Over the size limit.
    const big = Buffer.alloc(4 * 1024 * 1024 + 10, 0);
    fixture('banner.png').copy(big);
    await input.setInputFiles(file('huge.png', 'image/png', big));
    await submit.click();
    await expect(cover.getByText('This file is too big. The limit is 4 MB.')).toBeVisible();

    // A good image without alt text.
    await input.setInputFiles(BANNER());
    await cover.getByLabel('Alt text').fill('');
    await submit.click();
    await expect(cover.getByText('Describe the image, or mark it as decorative.')).toBeVisible();
    await expect(cover.getByLabel('Alt text')).toHaveAttribute('aria-invalid', 'true');
    await expect(cover.getByLabel('Alt text')).toBeFocused();
    await expectAccessible(page);
    // Nothing was stored.
    await page.reload();
    await expect(region(page, 'Cover image').getByText('No cover image yet.')).toBeVisible();
  });

  test('keyboard only: pick a file, describe it and upload; it persists', async ({ page }) => {
    await signIn(page);
    const { base } = await createEvent(page, `Cover keys ${stamp()}`);
    await page.goto(`${base}/media`);
    const cover = region(page, 'Cover image');
    const input = cover.getByLabel('Image file');
    await input.focus();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Space')]);
    await chooser.setFiles(BANNER());
    await expect(cover.getByText('Selected: stage.png')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(cover.getByLabel('Alt text')).toBeFocused();
    await page.keyboard.type('The main stage under blue lights');
    await page.keyboard.press('Tab');
    await expect(cover.getByLabel('Decorative image (no description needed)')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cover.getByRole('button', { name: 'Upload image' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(cover.getByRole('status').filter({ hasText: 'Image uploaded.' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(cover.getByRole('img', { name: 'The main stage under blue lights' })).toBeVisible();
    await expectAccessible(page);
    await page.reload();
    await expect(
      region(page, 'Cover image').getByRole('img', { name: 'The main stage under blue lights' }),
    ).toBeVisible();
    await expect(region(page, 'Cover image').getByRole('button', { name: 'Replace image' })).toBeVisible();
  });

  test('the cover shows on the public event page, its link preview and the listing card', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const name = `Cover public ${stamp()}`;
    await signIn(page);
    const { base, slug } = await createEvent(page, name);
    await page.goto(`${base}/media`);
    await upload(region(page, 'Cover image'), BANNER(), 'Harbor stage at dusk');

    // A draft's image is for members only.
    const preview = region(page, 'Cover image').getByRole('img', { name: 'Harbor stage at dusk' });
    const { src } = await fetchImage(page, preview);
    const guest = await anonymous(browser);
    expect((await guest.request.get(src)).status()).toBe(404);

    await publish(page, base);
    const res = await guest.goto(`/events/${slug}`);
    expect(res?.status()).toBe(200);
    const hero = guest.getByTestId('event-cover').getByRole('img', { name: 'Harbor stage at dusk' });
    await expect(hero).toBeVisible();
    const served = await fetchImage(guest, hero);
    expect(served.res.status()).toBe(200);
    expect(served.res.headers()['content-type']).toMatch(/^image\/(avif|webp|jpeg)$/);
    expect(served.res.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(served.res.headers()['x-content-type-options']).toBe('nosniff');
    // The image is on this origin, so the strict CSP (img-src 'self') allows it.
    expect(new URL(served.src).origin).toBe(new URL(guest.url()).origin);
    const og = await guest.locator('meta[property="og:image"]').getAttribute('content');
    expect(og).toMatch(/^http:\/\/localhost:\d+\/media\/.+\.jpg$/);
    expect((await guest.request.get(og ?? '')).headers()['content-type']).toBe('image/jpeg');
    await expectAccessible(guest);
    await noHorizontalScroll(guest);

    await runProjector(page, 'lakeside-events');
    await guest.goto(`/events?q=${encodeURIComponent(name)}`);
    const card = guest.getByRole('article').filter({ has: guest.getByRole('link', { name }) });
    const thumb = card.getByTestId('listing-cover').getByRole('img', { name: 'Harbor stage at dusk' });
    await expect(thumb).toBeVisible();
    expect((await fetchImage(guest, thumb)).res.status()).toBe(200);
    await expectAccessible(guest);

    // Arabic public page: right to left, same image.
    const arabic = await anonymous(browser);
    await arabic.goto(`/ar/events/${slug}`);
    await expect(arabic.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(arabic.getByTestId('event-cover').getByRole('img')).toBeVisible();
    await expectAccessible(arabic);
    await Promise.all([arabic.close(), guest.close()]);

    // Unpublish again so the marketplace keeps only its own fixtures.
    await page.goto(base);
    await page.getByRole('button', { name: 'Unpublish' }).click();
    await expect(page.getByText('Draft ·')).toBeVisible();
    await runProjector(page, 'lakeside-events');
  });

  test('replace and remove: the old files stop being served', async ({ page, browser }) => {
    test.setTimeout(90_000);
    await signIn(page);
    const { base, slug } = await createEvent(page, `Cover swap ${stamp()}`);
    await publish(page, base);
    await page.goto(`${base}/media`);
    const cover = region(page, 'Cover image');
    await upload(cover, BANNER(), 'First cover');
    const first = await fetchImage(page, cover.getByRole('img', { name: 'First cover' }));
    expect(first.res.status()).toBe(200);

    // A single-image slot: uploading again replaces it.
    await expect(cover.getByText('Replace the image')).toBeVisible();
    await upload(cover, PHOTO(), 'Second cover');
    await expect(cover.getByRole('img', { name: 'Second cover' })).toBeVisible();
    await expect(cover.getByRole('img', { name: 'First cover' })).toHaveCount(0);
    expect((await page.request.get(first.src)).status()).toBe(404);
    const guest = await anonymous(browser);
    await guest.goto(`/events/${slug}`);
    await expect(guest.getByTestId('event-cover').getByRole('img', { name: 'Second cover' })).toBeVisible();

    // Edit the alt text.
    await cover.getByText('Edit alt text').click();
    await cover.getByRole('textbox', { name: 'Alt text' }).first().fill('Crowd at the second show');
    await cover.getByRole('button', { name: 'Save' }).click();
    await expect(cover.getByRole('img', { name: 'Crowd at the second show' })).toBeVisible();
    await page.reload();
    await expect(
      region(page, 'Cover image').getByRole('img', { name: 'Crowd at the second show' }),
    ).toBeVisible();

    // Remove it.
    const second = await fetchImage(page, region(page, 'Cover image').getByRole('img').first());
    await region(page, 'Cover image')
      .getByRole('button', { name: 'Remove: Crowd at the second show' })
      .click();
    await expect(region(page, 'Cover image').getByText('No cover image yet.')).toBeVisible();
    expect((await page.request.get(second.src)).status()).toBe(404);
    await guest.goto(`/events/${slug}`);
    await expect(guest.getByTestId('event-cover')).toHaveCount(0);
    await guest.close();
    await page.goto(base);
    await page.getByRole('button', { name: 'Unpublish' }).click();
    await expect(page.getByText('Draft ·')).toBeVisible();
  });
});

test.describe('event gallery (M1.4e)', () => {
  test('several images, decorative ones, replace one in place; the public gallery follows', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    await signIn(page);
    const { base, slug } = await createEvent(page, `Gallery ${stamp()}`);
    await publish(page, base);
    await page.goto(`${base}/media`);
    const gallery = region(page, 'Gallery');
    await expect(gallery.getByText('No gallery photos yet.')).toBeVisible();
    await upload(gallery, PHOTO(), 'Dancers on stage');
    await upload(gallery, SMALL(), null);
    await expect(gallery.getByText('2 images of 20')).toBeVisible();
    await expect(gallery.getByText('Decorative', { exact: true })).toBeVisible();
    await expectAccessible(page);

    await gallery.getByRole('button', { name: 'Replace: Dancers on stage' }).click();
    await expect(gallery.getByText('Replacing: Dancers on stage')).toBeVisible();
    await expect(gallery.getByLabel('Image file')).toBeFocused();
    await upload(gallery, BANNER(), 'Band on the main stage');
    await expect(gallery.getByRole('img', { name: 'Band on the main stage' })).toBeVisible();
    await expect(gallery.getByRole('img', { name: 'Dancers on stage' })).toHaveCount(0);
    await expect(gallery.getByText('2 images of 20')).toBeVisible();

    const guest = await anonymous(browser);
    await guest.goto(`/events/${slug}`);
    const section = guest.getByRole('region', { name: 'Gallery' });
    await expect(section.getByRole('img', { name: 'Band on the main stage' })).toBeVisible();
    // The decorative image is hidden from assistive technology (alt="").
    await expect(section.locator('img[alt=""]')).toHaveCount(1);
    await expectAccessible(guest);
    await guest.close();
    await page.goto(base);
    await page.getByRole('button', { name: 'Unpublish' }).click();
    await expect(page.getByText('Draft ·')).toBeVisible();
  });

  test('a malicious SVG uploaded through the UI is served inert', async ({ page }) => {
    await signIn(page);
    const { base } = await createEvent(page, `SVG ${stamp()}`);
    await page.goto(`${base}/media`);
    const gallery = region(page, 'Gallery');
    for (const [name, alt] of [
      ['script.svg', 'Scripted logo'],
      ['onload.svg', 'Handler logo'],
      ['xlink-javascript.svg', 'Link logo'],
      ['foreign-object.svg', 'Foreign logo'],
    ] as const)
      await upload(gallery, file(name, 'image/svg+xml', fixture(`malicious/${name}`)), alt);
    for (const alt of ['Scripted logo', 'Handler logo', 'Link logo', 'Foreign logo']) {
      const { src, res } = await fetchImage(page, gallery.getByRole('img', { name: alt }));
      expect(src).toMatch(/\.svg$/);
      expect(res.status()).toBe(200);
      const headers = res.headers();
      expect(headers['content-type']).toBe('image/svg+xml');
      expect(headers['content-security-policy']).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      );
      expect(headers['x-content-type-options']).toBe('nosniff');
      const body = (await res.text()).toLowerCase();
      expect(body).toContain('<svg');
      expect(body).not.toContain('<script');
      expect(body).not.toMatch(/\son\w+=/);
      expect(body).not.toContain('javascript:');
      expect(body).not.toContain('foreignobject');
      expect(body).not.toContain('document.cookie');
    }
    // Opened directly, the document runs nothing: no dialog appears.
    const { src } = await fetchImage(page, gallery.getByRole('img', { name: 'Handler logo' }));
    let dialogs = 0;
    page.on('dialog', async (d) => {
      dialogs += 1;
      await d.dismiss();
    });
    await page.goto(src);
    await page.waitForTimeout(500);
    expect(dialogs).toBe(0);
  });

  test('Arabic: the images page is right to left and accessible', async ({ page }) => {
    await signIn(page);
    const { base } = await createEvent(page, `Arabic images ${stamp()}`);
    await page.goto(`/ar${base}/media`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'الصور', level: 1 })).toBeVisible();
    const cover = page.getByRole('region', { name: 'صورة الغلاف' });
    await cover.getByRole('button', { name: 'رفع الصورة' }).click();
    await expect(cover.getByText('اختر ملف صورة.')).toBeVisible();
    await expectAccessible(page);
    await noHorizontalScroll(page);
    await upload2Arabic(cover);
    await expectAccessible(page);
  });
});

async function upload2Arabic(cover: Locator) {
  const form = cover.getByRole('form');
  await form.getByLabel('ملف الصورة').setInputFiles(BANNER());
  await form.getByLabel('النص البديل').fill('منصة المسرح');
  await form.getByRole('button', { name: 'رفع الصورة' }).click();
  await expect(cover.getByRole('status').filter({ hasText: 'تم رفع الصورة.' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(cover.getByRole('img', { name: 'منصة المسرح' })).toBeVisible();
}

test.describe('permissions (M1.4e)', () => {
  test('a viewer sees the images but no upload control, and the upload endpoint refuses them', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const { base } = await createEvent(page, `Viewer images ${stamp()}`);
    await page.goto(`${base}/media`);
    await upload(region(page, 'Cover image'), SMALL(), 'Owner cover');

    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/media`);
    const cover = region(viewer, 'Cover image');
    await expect(cover.getByRole('img', { name: 'Owner cover' })).toBeVisible();
    await expect(viewer.getByLabel('Image file')).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /Upload image|Replace image|Remove/ })).toHaveCount(0);
    await expect(
      viewer.getByText('Only owners, admins and managers can change these images.').first(),
    ).toBeVisible();
    await expectAccessible(viewer);
    // Members of the org may see a draft's image.
    const { src } = await fetchImage(viewer, cover.getByRole('img', { name: 'Owner cover' }));
    expect((await viewer.request.get(src)).status()).toBe(200);

    // A direct upload: a forged ticket is refused, and so is no session at all.
    const multipart = {
      ticket: 'eyJvcmdJZCI6ImZvcmdlZCJ9.forged',
      file: SMALL(),
      alt: 'Sneaky',
    };
    const refused = await viewer.request.post('/api/media/upload', { multipart });
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toMatchObject({ ok: false, code: 'forbidden' });
    const guest = await anonymous(browser);
    expect((await guest.request.post('/api/media/upload', { multipart })).status()).toBe(401);
    // Another org's owner can't see this org's private image.
    const other = await (await browser.newContext()).newPage();
    await signIn(other, 'maya@rosewood.test');
    expect((await other.request.get(src)).status()).toBe(404);
    expect((await guest.request.get(src)).status()).toBe(404);
    await Promise.all([viewer.close(), guest.close(), other.close()]);
  });

  test('a viewer has no logo control (settings are for owners and admins)', async ({ page }) => {
    await signIn(page, VIEWER);
    await page.goto(`${ORG}/settings`);
    await expect(page.getByRole('region', { name: 'Logo' })).toHaveCount(0);
    await expect(page.getByLabel('Image file')).toHaveCount(0);
  });
});

/** Each viewport works on its own org, so the single logo slot never races across projects. */
const LOGO_ORGS: Record<string, { slug: string; owner: string; name: string; page: boolean; site: boolean }> =
  {
    'mobile-375': {
      slug: 'rosewood-weddings',
      owner: 'maya@rosewood.test',
      name: 'Rosewood',
      page: false,
      site: false,
    },
    'tablet-768': {
      slug: 'lakeside-events',
      owner: 'pani@lakeside.test',
      name: 'Lakeside',
      page: true,
      site: false,
    },
    'desktop-1280': { slug: 'harbor-arts', owner: 'lee@harbor.test', name: 'Harbor', page: true, site: true },
  };

test.describe('organization logo (M1.4e)', () => {
  test('upload, see it in the console, on the org page and tenant site, then replace and remove', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const org =
      LOGO_ORGS[test.info().project.name] ?? (LOGO_ORGS['desktop-1280'] as (typeof LOGO_ORGS)[string]);
    await signIn(page, org.owner);
    await page.goto(`/o/${org.slug}/settings`);
    const logo = region(page, 'Logo');
    await expect(logo).toBeVisible();
    // A logo always names the organizer: no "decorative" option.
    await expect(logo.getByLabel('Decorative image (no description needed)')).toHaveCount(0);
    await logo.getByLabel('Image file').setInputFiles(file('logo.svg', 'image/svg+xml', fixture('logo.svg')));
    await logo.getByRole('button', { name: /Upload image|Replace image/ }).click();
    await expect(logo.getByText('Describe the image, or mark it as decorative.')).toBeVisible();
    await upload(logo, file('logo.svg', 'image/svg+xml', fixture('logo.svg')), `${org.name} logo`);
    await expect(logo.getByRole('img', { name: `${org.name} logo` })).toBeVisible();
    await expectAccessible(page);

    // Console header: the sidebar's org switcher (below lg it lives in the menu).
    await page.goto(`/o/${org.slug}`);
    const menu = page.locator('summary').filter({ hasText: 'Open menu' });
    if (await menu.isVisible()) await menu.click();
    await expect(
      page
        .getByTestId('console-logo')
        .getByRole('img', { name: `${org.name} logo` })
        .filter({ visible: true }),
    ).toHaveCount(1);

    const guest = await anonymous(browser);
    if (org.page) {
      await guest.goto(`${MARKET}/o/${org.slug}`);
      const shown = guest.getByTestId('org-logo').getByRole('img', { name: `${org.name} logo` });
      await expect(shown).toBeVisible();
      // Same server; the request context resolves only localhost.
      const res = await guest.request.get(
        new URL(await shown.evaluate((el: HTMLImageElement) => el.src)).pathname,
      );
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toBe('image/svg+xml');
      // Public logos may be embedded by email clients and other origins.
      expect(res.headers()['cross-origin-resource-policy']).toBe('cross-origin');
      await expectAccessible(guest);
      const arabic = await anonymous(browser);
      await arabic.goto(`${MARKET}/ar/o/${org.slug}`);
      await expect(arabic.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(arabic.getByTestId('org-logo').getByRole('img')).toBeVisible();
      await expectAccessible(arabic);
      await arabic.close();
    }
    if (org.site) {
      await guest.goto(`${HARBOR_SITE}/`);
      await expect(
        guest.getByTestId('org-logo').getByRole('img', { name: `${org.name} logo` }),
      ).toBeVisible();
      await expectAccessible(guest);
    }

    // Replace with a raster, then remove.
    await page.goto(`/o/${org.slug}/settings`);
    await upload(region(page, 'Logo'), SMALL(), `${org.name} wordmark`);
    await expect(region(page, 'Logo').getByRole('img', { name: `${org.name} wordmark` })).toBeVisible();
    await region(page, 'Logo')
      .getByRole('button', { name: `Remove: ${org.name} wordmark` })
      .click();
    await expect(region(page, 'Logo').getByText('No logo yet.')).toBeVisible();
    await page.goto(`/o/${org.slug}`);
    await expect(page.getByTestId('console-logo')).toHaveCount(0);
    if (org.page) {
      await guest.goto(`${MARKET}/o/${org.slug}`);
      await expect(guest.getByTestId('org-logo')).toHaveCount(0);
    }
    await guest.close();
  });

  test('Arabic settings: the logo uploader is right to left and accessible', async ({ page }) => {
    const org =
      LOGO_ORGS[test.info().project.name] ?? (LOGO_ORGS['desktop-1280'] as (typeof LOGO_ORGS)[string]);
    await signIn(page, org.owner);
    await page.goto(`/ar/o/${org.slug}/settings`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('region', { name: 'الشعار' })).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe('venue photos (M1.4e)', () => {
  test('photos of a listed venue show on its public page; removing one takes it off', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const name = `Photo Hall ${stamp()}`;
    await signIn(page);
    await page.goto(`${ORG}/venues`);
    await page.getByLabel('Venue name').fill(name);
    await page.getByLabel('Country code').fill('us');
    await page.getByLabel('City', { exact: true }).fill('Madison');
    await page.getByLabel(/List this venue in the Yayatoh venue directory/).check();
    await page.getByRole('button', { name: 'Add venue' }).click();
    await expect(page.getByText('Venue added.')).toBeVisible();

    const photos = region(page, 'Venue photos');
    await expect(photos.getByText('No venue photos yet.')).toBeVisible();
    await expectAccessible(page);
    // Keyboard: pick the file with the keyboard, then describe it.
    await photos.getByLabel('Image file').focus();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Space')]);
    await chooser.setFiles(PHOTO());
    await photos.getByLabel('Alt text').fill('The hall set for dinner');
    await photos.getByRole('button', { name: 'Upload image' }).press('Enter');
    await expect(photos.getByRole('status').filter({ hasText: 'Image uploaded.' })).toBeVisible({
      timeout: 30_000,
    });
    await upload(photos, SMALL(), 'The terrace');
    await expect(photos.getByText('2 images of 20')).toBeVisible();

    const guest = await anonymous(browser);
    const slug = await page
      .getByRole('link', { name: 'View public page' })
      .getAttribute('href')
      .then((h) => h?.split('/').pop() ?? '');
    await guest.goto(`/venues/${slug}`);
    const section = guest.getByRole('region', { name: 'Photos' });
    await expect(section.getByRole('img', { name: 'The hall set for dinner' })).toBeVisible();
    await expect(section.getByRole('img', { name: 'The terrace' })).toBeVisible();
    await expectAccessible(guest);
    const arabic = await anonymous(browser);
    await arabic.goto(`/ar/venues/${slug}`);
    await expect(arabic.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(arabic.getByRole('region', { name: 'الصور' }).getByRole('img')).toHaveCount(2);
    await expectAccessible(arabic);
    await arabic.close();

    await photos.getByRole('button', { name: 'Remove: The terrace' }).click();
    await expect(photos.getByRole('img', { name: 'The terrace' })).toHaveCount(0);
    await guest.goto(`/venues/${slug}`);
    await expect(guest.getByRole('region', { name: 'Photos' }).getByRole('img')).toHaveCount(1);

    // An unlisted venue's photos are not public.
    const src = await guest
      .getByRole('region', { name: 'Photos' })
      .getByRole('img')
      .evaluate((el: HTMLImageElement) => el.currentSrc || el.src);
    await page.getByLabel(/List this venue in the Yayatoh venue directory/).uncheck();
    await page.getByRole('button', { name: 'Save venue' }).click();
    await expect(page.getByText('Venue saved.')).toBeVisible();
    expect((await guest.request.get(src)).status()).toBe(404);
    expect((await page.request.get(src)).status()).toBe(200);
    await guest.close();
  });
});
