import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { expectAccessible, expectAccessibleBothModes, newUser, signIn } from './helpers.ts';

/**
 * U10 media library (`/o/{org}/media`) and storage (`/o/{org}/storage`): upload once into the
 * library, reuse the image in two places from each uploader's "Choose from the media library"
 * (nothing is stored again: the storage page's file count stays), "Used in" links, delete only
 * when unused (with a confirm step), keyboard-only picking, viewers read-only, axe in both
 * themes and Arabic RTL. Each test owns a fresh org (`newUser`), so projects never collide.
 */
const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'packages', 'modules', 'media', 'fixtures');
const fixture = (name: string) => readFileSync(join(FIXTURES, name));
const BANNER = () => ({ name: 'stage.png', mimeType: 'image/png', buffer: fixture('banner.png') });
const SMALL = () => ({ name: 'small.webp', mimeType: 'image/webp', buffer: fixture('small.webp') });

const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

async function uploadToLibrary(page: Page, org: string, alt: string, file = BANNER()) {
  await page.goto(`/o/${org}/media`);
  const where = region(page, 'Upload to the library');
  const form = where.getByRole('form');
  await form.getByLabel('Image file').setInputFiles(file);
  await form.getByLabel('Alt text').fill(alt);
  await form.getByRole('button', { name: 'Upload image' }).click();
  await expect(where.getByRole('status').filter({ hasText: 'Image uploaded.' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole('list', { name: 'Library images' }).getByText(alt, { exact: true }),
  ).toBeVisible();
}

/** The library card of an image (by its alt text). */
const card = (page: Page, alt: string) =>
  page.getByRole('list', { name: 'Library images' }).getByRole('listitem').filter({ hasText: alt }).first();

/** Open "Choose from the media library" in an uploader and place the image named `alt`. */
async function placeFromLibrary(where: Locator, alt: string, placeAlt?: string) {
  await where.getByText('Choose from the media library').click();
  // The card is the radio's label (the radio itself is visually hidden).
  await where.getByRole('group', { name: 'Pick an image' }).getByText(alt, { exact: true }).click();
  await expect(where.getByRole('radio', { name: alt })).toBeChecked();
  const field = where.getByLabel('Alt text for this place');
  await expect(field).toHaveValue(alt);
  if (placeAlt !== undefined) await field.fill(placeAlt);
  await where.getByRole('button', { name: 'Use this image' }).click();
  await expect(where.getByRole('status').filter({ hasText: 'Image added.' })).toBeVisible();
}

/** "Stored files: N" on the storage page. */
async function storedFiles(page: Page, org: string): Promise<number> {
  await page.goto(`/o/${org}/storage`);
  const text = await page.getByText(/^Stored files: \d+/).innerText();
  return Number(/Stored files: (\d+)/.exec(text)?.[1] ?? 'NaN');
}

test.describe('U10 media library', () => {
  test('upload once, reuse in two places; nothing is stored again; used-in links; delete only when unused', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
    const org = owner.orgSlug ?? '';
    const event = owner.eventSlug ?? '';

    // Empty state with a primary action, reachable from the nav.
    await page.goto(`/o/${org}`);
    await expect(page.locator(`a[href="/o/${org}/media"]`).first()).toBeAttached();
    await page.goto(`/o/${org}/media`);
    await expect(page.getByRole('heading', { name: 'Media library', level: 1 })).toBeVisible();
    await expect(page.getByText('No images yet', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Upload images' }).first()).toBeVisible();
    await expectAccessibleBothModes(page);

    const alt = `Crowd at the main stage ${Date.now()}`;
    await uploadToLibrary(page, org, alt);
    await expect(card(page, alt).getByText('Not used', { exact: true })).toBeVisible();
    const before = await storedFiles(page, org);
    expect(before).toBeGreaterThan(0);

    // Reuse it as the event's cover and in its gallery, without uploading again.
    await page.goto(`/o/${org}/e/${event}/media`);
    const cover = region(page, 'Cover image');
    await placeFromLibrary(cover, alt, 'The stage at night');
    await expect(cover.getByRole('img', { name: 'The stage at night' })).toBeVisible();
    const gallery = region(page, 'Gallery');
    await placeFromLibrary(gallery, alt);
    await expect(gallery.getByRole('img', { name: alt })).toBeVisible();
    // The same image twice in one place is refused, with the reason.
    await gallery.getByRole('group', { name: 'Pick an image' }).getByText(alt, { exact: true }).click();
    await gallery.getByRole('button', { name: 'Use this image' }).click();
    await expect(gallery.getByRole('alert').filter({ hasText: 'This image is already here.' })).toBeVisible();

    // Nothing new was stored: the file count is unchanged and the reuses are counted.
    expect(await storedFiles(page, org)).toBe(before);
    await expect(page.getByText(/Reuses: 2$/)).toBeVisible();
    await expectAccessibleBothModes(page);

    // The library lists both places, linked; an image in use can't be deleted.
    await page.goto(`/o/${org}/media`);
    const used = card(page, alt).getByRole('list', { name: `Where ${alt} is used` });
    await expect(used.getByRole('link')).toHaveCount(2);
    await expect(card(page, alt).getByRole('button', { name: `Delete ${alt}` })).toHaveCount(0);
    await expect(
      card(page, alt).getByText('In use: remove it where it is used before deleting it.'),
    ).toBeVisible();
    await used.getByRole('link').first().click();
    await expect(page).toHaveURL(new RegExp(`/o/${org}/e/${event}/media$`));

    // The public event page serves the reused cover from the original's file.
    await page.goto(`/events/${event}`);
    const img = page.getByRole('img', { name: 'The stage at night' }).first();
    await expect(img).toBeVisible();
    const src = await img.evaluate((el: HTMLImageElement) => el.currentSrc || el.src);
    const res = await page.request.get(src);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/^image\//);

    // An unused image: listed under "Not used anywhere", deleted after a confirm step.
    const spare = `Spare logo ${Date.now()}`;
    await uploadToLibrary(page, org, spare, SMALL());
    await page.getByRole('link', { name: 'Not used anywhere' }).click();
    await expect(card(page, spare)).toBeVisible();
    await expect(card(page, alt)).toHaveCount(0);
    await card(page, spare)
      .getByRole('button', { name: `Delete ${spare}` })
      .click();
    const confirm = card(page, spare).getByRole('button', { name: 'Delete for good' });
    await expect(confirm).toBeFocused();
    await expectAccessible(page);
    await confirm.click();
    await expect(page.getByRole('list', { name: 'Library images' }).getByText(spare)).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('Every image is in use', { exact: true })).toBeVisible();
  });

  test('keyboard only: pick a library image, the alt text is required, then place it', async ({ page }) => {
    test.setTimeout(180_000);
    const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
    const org = owner.orgSlug ?? '';
    const alt = `Lanterns over the river ${Date.now()}`;
    await uploadToLibrary(page, org, alt);
    await page.goto(`/o/${org}/e/${owner.eventSlug}/media`);
    const cover = region(page, 'Cover image');
    const summary = cover.getByText('Choose from the media library');
    await summary.focus();
    await page.keyboard.press('Enter');
    const radio = cover.getByRole('radio', { name: alt });
    await expect(radio).toBeVisible();
    await radio.focus();
    await page.keyboard.press('Space');
    await expect(radio).toBeChecked();
    const field = cover.getByLabel('Alt text for this place');
    await field.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Delete');
    await cover.getByRole('button', { name: 'Use this image' }).focus();
    await page.keyboard.press('Enter');
    await expect(cover.getByText('Describe the image, or mark it decorative.')).toBeVisible();
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page);
    await page.keyboard.type('Paper lanterns over the river');
    await cover.getByRole('button', { name: 'Use this image' }).focus();
    await page.keyboard.press('Enter');
    await expect(cover.getByRole('img', { name: 'Paper lanterns over the river' })).toBeVisible();
    // Persists after a reload.
    await page.reload();
    await expect(
      region(page, 'Cover image').getByRole('img', { name: 'Paper lanterns over the river' }),
    ).toBeVisible();
  });

  test('storage: numbers first, usage by kind and the largest images; axe in both themes', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const owner = await newUser(page, { org: true, twoFactor: true });
    const org = owner.orgSlug ?? '';
    await page.goto(`/o/${org}/storage`);
    await expect(page.getByRole('heading', { name: 'Storage', level: 1 })).toBeVisible();
    await expect(page.getByText('No images yet', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Upload images' })).toBeVisible();
    await expectAccessibleBothModes(page);
    const alt = `Hall facade ${Date.now()}`;
    await uploadToLibrary(page, org, alt);
    await page.goto(`/o/${org}/storage`);
    await expect(page.getByTestId('storage-used')).toContainText('of 1 GB included');
    const kinds = page.getByRole('table', { name: 'What uses it' });
    await expect(kinds.getByRole('row').filter({ hasText: 'Library only' })).toContainText('1');
    const largest = page.getByRole('table', { name: 'Largest images' });
    await expect(largest.getByRole('row').filter({ hasText: alt })).toContainText('Not used');
    await expectAccessibleBothModes(page);
  });

  test('viewers see the library and storage but cannot upload, place or delete', async ({ page }) => {
    await signIn(page, 'jordan@lakeside.test');
    await page.goto('/o/lakeside-events/media');
    await expect(page.getByRole('heading', { name: 'Media library', level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Upload to the library' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Delete/ })).toHaveCount(0);
    await expectAccessible(page);
    await page.goto('/o/lakeside-events/storage');
    await expect(page.getByRole('heading', { name: 'Storage', level: 1 })).toBeVisible();
    // Event media pages offer no picker without an upload ticket.
    await page.goto('/o/lakeside-events/e/midwest-leadership-summit-2027/media');
    await expect(page.getByText('Choose from the media library')).toHaveCount(0);
  });

  test('Arabic: the library and storage render right to left and pass axe', async ({ page }) => {
    const owner = await newUser(page, { org: true, twoFactor: true });
    const org = owner.orgSlug ?? '';
    await page.goto(`/ar/o/${org}/media`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'مكتبة الوسائط', level: 1 })).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar/o/${org}/storage`);
    await expect(page.getByRole('heading', { name: 'التخزين', level: 1 })).toBeVisible();
    await expectAccessible(page);
  });
});
