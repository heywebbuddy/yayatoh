import { expect, type Locator, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { hostGalleryQuery, moderateGalleryCommand, runGalleryCommand } from '@yayatoh/gallery';
import { fakeHeic } from '@yayatoh/gallery/testing';
import { createCtx, executeQuery } from '@yayatoh/kernel';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import {
  enableGallery,
  GUEST_SITE_PASSWORD,
  type GuestSiteScenario,
  guestGalleryPhoto,
  guestSiteAccess,
  guestSiteScenario,
  ports,
} from '@yayatoh/testing';
import sharp from 'sharp';
import { expectAccessibleBothModes, signIn } from './helpers.ts';

/**
 * M4.5b: the event gallery. Acceptance: the per-event storage cap is enforced (the host's and the
 * guests' uploads are refused with a message once it is reached, and a full gallery says so). Plus
 * the host's settings (validation, persistence), uploads straight to storage (HEIC too), video
 * links, the moderation queue, the guest page behind the site password (name, quota, their own
 * photos, take back), the live slideshow over SSE, viewers, keyboard only, axe in light and dark,
 * and Arabic RTL.
 */

const VIEWER = 'jordan@lakeside.test';
const ORG = '/o/lakeside-events';

test.afterAll(async () => {
  await closePools();
});

let orgId: string | null = null;
async function lakeside(): Promise<string> {
  orgId ??= (await resolveOrgSlug('lakeside-events'))?.orgId ?? null;
  if (!orgId) throw new Error('no lakeside-events org (seed?)');
  return orgId;
}
const system = async () => createCtx({ orgId: await lakeside(), actor: { type: 'system', name: 'e2e' } });

type G = GuestSiteScenario & { access: string };
/** A wedding with a published guest site and (unless asked) the gallery on. */
async function withGallery(
  opts: Parameters<typeof enableGallery>[2] & { enabled?: boolean } = {},
): Promise<G> {
  const org = await lakeside();
  const s = await guestSiteScenario(org);
  if (opts.enabled !== false) await enableGallery(await system(), s.eventId, opts);
  return { ...s, access: await guestSiteAccess(org, s.eventId, GUEST_SITE_PASSWORD) };
}

const jpeg = async (w = 640, h = 480, r = 180) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r, g: 90, b: 60 } } })
    .jpeg()
    .toBuffer();
const file = async (name = `photo-${Date.now()}.jpg`, w = 640, h = 480) => ({
  name,
  mimeType: 'image/jpeg',
  buffer: await jpeg(w, h),
});

/** A guest's photo through the real slot/PUT/complete path (pending unless auto-publish). */
async function guestPhoto(g: G, name: string, caption: string, approve = false) {
  const org = await lakeside();
  const r = await guestGalleryPhoto(
    org,
    { eventId: g.eventId, access: g.access, name },
    new Uint8Array(await jpeg(400, 300)),
    caption,
  );
  if (approve)
    await runGalleryCommand(
      moderateGalleryCommand,
      { eventId: g.eventId, itemIds: [r.itemId], decision: 'approve' },
      await system(),
      ports,
    );
  return r;
}

const console_ = (g: { eventSlug: string }) => `${ORG}/e/${g.eventSlug}/gallery`;

async function submit(page: Page, button: Locator) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), button.click()]);
}

/** Open the guest gallery past the password gate (the gate brings the guest back here). */
async function unlockGallery(page: Page, g: G, path = 'gallery', locale = '') {
  await page.goto(`${locale}/w/${g.code}/${path}`);
  await page.locator('main input[name="password"]').fill(g.password);
  await page.locator('main form button[type="submit"]').click();
  await expect(page).toHaveURL(new RegExp(`/w/${g.code}/${path}$`));
}

test.describe('gallery: the host (M4.5b)', () => {
  test('settings: off by default, every validation named, saved after a reload; empty states say what to do', async ({
    page,
  }) => {
    const g = await withGallery({ enabled: false });
    await signIn(page);
    await page.goto(console_(g));
    await expect(page.getByRole('heading', { name: 'Gallery', level: 1 })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Gallery' }).getByText('Off', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Nothing is waiting')).toBeVisible();
    await expect(page.getByText('No photos yet')).toBeVisible();
    await expect(
      page.getByText('Add your first photos above, or share the guest address so guests can add theirs.'),
    ).toBeVisible();
    await expect(page.getByTestId('gallery-usage')).toHaveText('0 MB of 5 GB used');
    await expectAccessibleBothModes(page);

    await page.getByLabel('Gallery for guests').selectOption('on');
    await page.getByLabel('Storage for this event (MB)').fill('0');
    await page.getByLabel('Photos and links per guest').fill('abc');
    await submit(page, page.getByRole('button', { name: 'Save gallery settings' }));
    await expect(page.getByText('Enter a whole number of at least 1.').first()).toBeVisible();
    await expect(page.getByLabel('Storage for this event (MB)')).toHaveAttribute('aria-invalid', 'true');
    await expectAccessibleBothModes(page);

    await page.getByLabel('Storage for this event (MB)').fill('200');
    await page.getByLabel('Photos and links per guest').fill('10');
    await page.getByLabel('Guest photos').selectOption('auto');
    await submit(page, page.getByRole('button', { name: 'Save gallery settings' }));
    await expect(page.getByText('Gallery settings saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Gallery for guests')).toHaveValue('on');
    await expect(page.getByLabel('Guest photos')).toHaveValue('auto');
    await expect(page.getByLabel('Storage for this event (MB)')).toHaveValue('200');
    await expect(page.getByTestId('gallery-usage')).toHaveText('0 MB of 200 MB used');
    await expect(page.getByText("Address for guests (behind the website's password)")).toBeVisible();
    await expect(page.getByText('Guest photos are published at once, so nothing waits here.')).toBeVisible();
  });

  test('uploads straight to storage (JPEG and HEIC) publish at once; a non-photo is refused with its reason; video links', async ({
    page,
  }) => {
    const g = await withGallery();
    await signIn(page);
    await page.goto(console_(g));
    const upload = page.getByRole('region', { name: 'Add your photos' });
    await upload.getByRole('button', { name: 'Share photos' }).click();
    await expect(upload.getByText('Choose at least one photo.')).toBeVisible();

    const heic = {
      name: 'phone.heic',
      mimeType: 'image/heic',
      buffer: Buffer.from(fakeHeic(new Uint8Array(await jpeg(800, 600, 40)))),
    };
    const junk = { name: 'notes.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not a photo at all') };
    await upload.getByLabel('Photos').setInputFiles([await file('first-dance.jpg'), heic, junk]);
    await upload.getByLabel('Caption (optional)').fill('First dance');
    await upload.getByRole('button', { name: 'Share photos' }).click();
    await expect(upload.getByText('2 photos shared, 1 could not be shared.')).toBeVisible({
      timeout: 30_000,
    });
    await expect(upload.locator('[data-upload-state="published"]')).toHaveCount(2);
    await expect(
      upload.getByText('This file is not a photo we can use (JPEG, PNG, WebP, AVIF or HEIC).'),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'In the gallery (2)', level: 2 })).toBeVisible();
    await expect(page.getByText('HEIC', { exact: false }).first()).toBeVisible();
    await expectAccessibleBothModes(page);

    // The photo is served through a signed URL; a tampered one is not found.
    const src = await page.locator('[data-item-id] img').first().getAttribute('src');
    expect(src).toMatch(/^\/api\/gallery\/file\/.+\?e=\d+&s=/);
    expect((await page.request.get(src ?? '')).status()).toBe(200);
    expect((await page.request.get(`${src?.slice(0, -3)}AAA`)).status()).toBe(404);

    const video = page.getByLabel('YouTube or Vimeo link');
    await video.fill('https://example.com/watch?v=dQw4w9WgXcQ');
    await submit(page, page.getByRole('button', { name: 'Add the video link' }));
    await expect(page.getByText('Paste a YouTube or Vimeo link.')).toBeVisible();
    await video.fill('https://youtu.be/dQw4w9WgXcQ');
    await submit(page, page.getByRole('button', { name: 'Add the video link' }));
    await expect(page.getByText('Video link added.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Watch on YouTube' })).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
    await page.reload();
    await expect(page.getByRole('heading', { name: 'In the gallery (3)', level: 2 })).toBeVisible();
  });

  test('the moderation queue: approve publishes, reject deletes; keyboard only', async ({ page }) => {
    const g = await withGallery();
    await guestPhoto(g, 'Marta', 'Cake time');
    await guestPhoto(g, 'Tom', 'Blurry one');
    await signIn(page);
    await page.goto(console_(g));
    await expect(page.getByRole('heading', { name: 'Waiting for approval (2)', level: 2 })).toBeVisible();
    await expect(page.getByText('by Marta').first()).toBeVisible();
    await expectAccessibleBothModes(page);

    // Keyboard only: focus the approve button and press Enter.
    const approve = page.getByRole('button', { name: 'Approve: Cake time' });
    await approve.focus();
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST'),
      page.keyboard.press('Enter'),
    ]);
    await expect(page.getByRole('heading', { name: 'Waiting for approval (1)', level: 2 })).toBeVisible();
    await submit(page, page.getByRole('button', { name: 'Reject: Blurry one' }));
    await expect(page.getByRole('heading', { name: 'Waiting for approval (0)', level: 2 })).toBeVisible();
    await expect(page.getByText('Nothing is waiting')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'In the gallery (1)', level: 2 })).toBeVisible();
    await expect(page.getByText('Blurry one')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Remove: Cake time' })).toBeVisible();
    await submit(page, page.getByRole('button', { name: 'Remove: Cake time' }));
    await expect(page.getByRole('heading', { name: 'In the gallery (0)', level: 2 })).toBeVisible();
  });

  test('viewers see the gallery but no controls; the direct-upload route refuses a forged slot', async ({
    page,
  }) => {
    const g = await withGallery();
    await guestPhoto(g, 'Ines', 'Garden', true);
    await signIn(page, VIEWER);
    await page.goto(console_(g));
    await expect(page.getByText('You can look at the gallery but not change it.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'In the gallery (1)', level: 2 })).toBeVisible();
    for (const name of ['Save gallery settings', 'Share photos', 'Add the video link', 'Remove: Garden'])
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    await expectAccessibleBothModes(page);
    const forged = await page.request.put('/api/gallery/direct/eyJvcmdJZCI6IngifQ.forged', { data: 'x' });
    expect(forged.status()).toBe(403);
  });
});

test.describe('the per-event storage cap is enforced (acceptance)', () => {
  test('a full gallery refuses the host’s and the guests’ uploads and says so', async ({ page }) => {
    const g = await withGallery({ moderation: 'auto' });
    await guestPhoto(g, 'First', 'The first photo');
    const used = (await executeQuery(hostGalleryQuery, { eventId: g.eventId }, await system(), ports)).usage
      .usedBytes;
    // Exactly full: nothing more fits.
    await enableGallery(await system(), g.eventId, { moderation: 'auto', capBytes: used });

    await signIn(page);
    await page.goto(console_(g));
    await expect(page.getByText('The gallery is full', { exact: true })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Storage used' })).toHaveAttribute(
      'aria-valuenow',
      String(used),
    );
    const upload = page.getByRole('region', { name: 'Add your photos' });
    await upload.getByLabel('Photos').setInputFiles([await file()]);
    await upload.getByRole('button', { name: 'Share photos' }).click();
    await expect(
      upload.getByText('The gallery is full: the event has used all of its photo storage.'),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'In the gallery (1)', level: 2 })).toBeVisible();
    await expectAccessibleBothModes(page);

    // The guest page shows the gallery as full, with no uploader.
    await page.context().clearCookies();
    await unlockGallery(page, g);
    await expect(page.getByText('The gallery is full', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Share photos' })).toHaveCount(0);
    await expectAccessibleBothModes(page);

    // Room for a tiny bit more than now, but not for a photo.
    await enableGallery(await system(), g.eventId, { moderation: 'auto', capBytes: used + 2_000 });
    await page.reload();
    await page.getByLabel('Your name').fill('Late Guest');
    await page.getByLabel('Photos').setInputFiles([await file('big.jpg', 1600, 1200)]);
    await page.getByRole('button', { name: 'Share photos' }).click();
    await expect(
      page.getByText('The gallery is full: the event has used all of its photo storage.'),
    ).toBeVisible();
  });
});

test.describe('gallery: guests (M4.5b)', () => {
  test('locked until the password, then a guest shares a photo that waits for the hosts, sees it as theirs and takes it back', async ({
    page,
  }) => {
    const g = await withGallery();
    await guestPhoto(g, 'Host Friend', 'Already here', true);
    await page.goto(`/w/${g.code}/gallery`);
    await expect(page.getByRole('heading', { name: 'Photos', level: 1 })).toBeVisible();
    await expect(
      page.getByText('Enter the password from your invitation to see and share photos.'),
    ).toBeVisible();
    expect(await page.content()).not.toContain('Already here');
    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toContain('noindex');
    await expectAccessibleBothModes(page);

    await page.getByLabel('Password').fill(g.password);
    await page.getByRole('button', { name: 'Open the website' }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${g.code}/gallery$`));
    await expect(page.getByText('Already here')).toBeVisible();
    await expect(page.getByTestId('guest-quota')).toHaveText('You have shared 0 of 50 (0 of 250 MB).');
    await expectAccessibleBothModes(page);

    // A name is needed first.
    await page.getByLabel('Photos').setInputFiles([await file()]);
    await page.getByRole('button', { name: 'Share photos' }).click();
    await expect(page.getByText('Enter your name before sharing.')).toBeVisible();
    await expect(page.getByLabel('Your name')).toBeFocused();

    await page.getByLabel('Your name').fill('Lea');
    await page.getByLabel('Caption (optional)').fill('Sunset');
    await page.getByRole('button', { name: 'Share photos' }).click();
    await expect(page.getByText('waiting for the hosts to approve it')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('The hosts approve photos before everyone sees them.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your photos (1)', level: 2 })).toBeVisible();
    await expect(page.getByText('Waiting for approval')).toBeVisible();
    await expectAccessibleBothModes(page);

    await page.reload();
    await expect(page.getByLabel('Your name')).toHaveValue('Lea');
    await expect(page.getByRole('heading', { name: 'Your photos (1)', level: 2 })).toBeVisible();
    await submit(page, page.getByRole('button', { name: 'Take back: Sunset' }));
    await expect(page.getByRole('heading', { name: /Your photos/ })).toHaveCount(0);
  });

  test('closed while the hosts keep it off; the website links to the gallery once it is on', async ({
    page,
  }) => {
    const g = await withGallery({ enabled: false });
    await unlockGallery(page, g);
    await expect(page.getByText("The gallery isn't open")).toBeVisible();
    await page.goto(`/w/${g.code}`);
    await expect(page.getByRole('link', { name: 'See and share photos' })).toHaveCount(0);
    await enableGallery(await system(), g.eventId);
    await page.reload();
    await page.getByRole('link', { name: 'See and share photos' }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${g.code}/gallery$`));
    await expect(page.getByRole('heading', { name: 'Share your photos' })).toBeVisible();
  });

  test('the per-guest quota: once used, the page says so instead of offering the uploader', async ({
    page,
  }) => {
    const g = await withGallery({ guestQuotaItems: 1, moderation: 'auto' });
    await unlockGallery(page, g);
    await page.getByLabel('Your name').fill('Pia');
    await page.getByLabel('Photos').setInputFiles([await file(), await file('second.jpg')]);
    await page.getByRole('button', { name: 'Share photos' }).click();
    await expect(page.getByText('You have shared as many photos as one guest can.')).toBeVisible({
      timeout: 30_000,
    });
    await page.reload();
    await expect(page.getByText("You've shared all you can")).toBeVisible();
    await expect(page.getByTestId('guest-quota')).toContainText('1 of 1');
  });
});

test.describe('the live slideshow (SSE)', () => {
  test('the hosts’ slideshow shows a newly published photo without a reload; pause and arrows by keyboard', async ({
    page,
  }) => {
    const g = await withGallery({ moderation: 'auto' });
    await guestPhoto(g, 'Ana', 'One');
    await signIn(page);
    await page.goto(`${console_(g)}/slideshow`);
    await expect(page.getByRole('heading', { name: 'Live slideshow', level: 1 })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Live slideshow' }).getByText('Live', { exact: true }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('slide-count')).toHaveText('Photo 1 of 1');
    await expectAccessibleBothModes(page);

    await guestPhoto(g, 'Luis', 'Two');
    await expect(page.getByTestId('slide-count')).toHaveText(/of 2$/, { timeout: 15_000 });
    await expect(page.getByTestId('slideshow-announce')).toHaveText('1 new photo added');

    const pause = page.getByRole('button', { name: 'Pause' });
    await pause.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Play' })).toHaveAttribute('aria-pressed', 'true');
    const before = await page.getByTestId('slide').getAttribute('data-photo-id');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('slide')).not.toHaveAttribute('data-photo-id', before ?? '');
    await expect(page.getByTestId('slideshow-announce')).toHaveText(/^Photo \d of 2$/);
  });

  test('guests watch it past the password; the stream needs the password too', async ({ page, request }) => {
    const g = await withGallery({ moderation: 'auto' });
    const one = await guestPhoto(g, 'Ana', 'Kept');
    await unlockGallery(page, g, 'slideshow');
    await expect(
      page.getByRole('region', { name: 'Live slideshow' }).getByText('Live', { exact: true }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('slide')).toHaveAttribute('data-photo-id', one.itemId);
    await expectAccessibleBothModes(page);
    await guestPhoto(g, 'Luis', 'Arrives');
    await expect(page.getByTestId('slide-count')).toHaveText(/of 2$/, { timeout: 15_000 });
    // Without the password cookie the stream is not found.
    expect((await request.get(`/api/gallery/stream/${g.code}`)).status()).toBe(404);
  });
});

test.describe('Arabic RTL', () => {
  test('the host’s gallery and the guests’ page render right to left', async ({ page }) => {
    const g = await withGallery();
    await guestPhoto(g, 'Noor', 'Arabic test', true);
    await signIn(page);
    await page.goto(`/ar${console_(g)}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectAccessibleBothModes(page);
    await page.context().clearCookies();
    await unlockGallery(page, g, 'gallery', '/ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText('Arabic test')).toBeVisible();
    await expectAccessibleBothModes(page);
  });
});
