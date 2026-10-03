import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { expectAccessible, pickOption, signIn } from './helpers.ts';

/**
 * M1.4h: speaker photos, exhibitor and sponsor logos — console uploaders and thumbnails, the
 * public speakers section, speaker page and agenda avatars, sponsor logos by tier, exhibitors.
 */
const ORG = '/o/lakeside-events';
const VIEWER = 'jordan@lakeside.test';
const TZ = 'America/Chicago';
const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'packages', 'modules', 'media', 'fixtures');
const fixture = (name: string) => readFileSync(join(FIXTURES, name));
const file = (name: string, mimeType: string, buffer: Buffer) => ({ name, mimeType, buffer });
const PHOTO = () => file('ada.jpg', 'image/jpeg', fixture('photo-exif.jpg'));
const BANNER = () => file('stage.png', 'image/png', fixture('banner.png'));
const ALPHA = () => file('acme.png', 'image/png', fixture('alpha.png'));
const EVIL_SVG = () => file('globex.svg', 'image/svg+xml', fixture('malicious/script.svg'));

const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;

test.afterAll(async () => {
  await closePools();
});

function chicagoDate(days: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000));
}
const at = (days: number, hhmm: string) => `${chicagoDate(days)}T${hhmm}`;

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** A conference from day 40 to day 42 in Chicago; returns its console path and slug. */
async function createEvent(page: Page, name: string, opts: { publish?: boolean } = {}) {
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await pickOption(page.getByLabel('Event type'), 'conference');
  await pickOption(page.getByLabel('Time zone'), TZ);
  await page.getByLabel('Starts', { exact: true }).fill(at(40, '09:00'));
  await page.getByLabel('Ends', { exact: true }).fill(at(42, '18:00'));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  if (opts.publish) await publish(page, base);
  return { base, slug: base.split('/').pop() ?? '' };
}

async function publish(page: Page, base: string) {
  await page.goto(base);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
}

async function addSpeaker(page: Page, base: string, name: string) {
  await page.goto(`${base}/speakers`);
  const add = page.getByRole('region', { name: 'Add speaker' });
  await expect(add.getByText('You can add a photo after saving the speaker.')).toBeVisible();
  await add.getByLabel('Speaker name').fill(name);
  await add.getByRole('button', { name: 'Add speaker' }).click();
  await expect(add.getByText('Speaker added.')).toBeVisible();
}

async function addSession(page: Page, base: string, title: string, speaker: string) {
  await page.goto(`${base}/sessions`);
  const add = page.getByRole('region', { name: 'Add session' });
  await add.getByLabel('Session title').fill(title);
  await add.getByLabel('Session starts').fill(at(40, '10:00'));
  await add.getByLabel('Session ends').fill(at(40, '11:00'));
  await add.getByRole('checkbox', { name: speaker }).check();
  await add.getByRole('button', { name: 'Add session' }).click();
  await expect(add.getByText('Session added.')).toBeVisible();
}

/** Open a row's edit disclosure and return its image uploader ("Photo: …" / "Logo: …"). */
async function uploaderOf(page: Page, row: string, heading: string): Promise<Locator> {
  await page.getByText(`Edit ${row}`, { exact: true }).click();
  const region = page.getByRole('region', { name: heading, exact: true });
  await expect(region).toBeVisible();
  return region;
}

/** Upload through an uploader: file, alt text (null keeps the suggestion), submit. */
async function upload(where: Locator, f: ReturnType<typeof file>, alt: string | null = null) {
  const form = where.getByRole('form');
  await form.getByLabel('Image file', { exact: true }).setInputFiles(f);
  if (alt !== null) await form.getByLabel('Alt text', { exact: true }).fill(alt);
  await form.getByRole('button', { name: /^(Upload image|Replace image)$/ }).click();
  await expect(where.getByRole('status').filter({ hasText: 'Image uploaded.' })).toBeVisible({
    timeout: 30_000,
  });
}

async function srcOf(img: Locator): Promise<string> {
  const src = await img.evaluate((el: HTMLImageElement) => el.currentSrc || el.src);
  expect(src).toMatch(/\/media\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/\d+-[0-9a-f]{32}\.(avif|webp|jpg|png|svg)$/);
  return src;
}

async function guestPage(browser: Browser) {
  return (await browser.newContext()).newPage();
}

test.describe('program media (M1.4h)', () => {
  test('speaker photo: every validation error, keyboard upload, then public section, speaker page and agenda', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const s = stamp();
    const name = `Ada ${s}`;
    await signIn(page);
    const { base, slug } = await createEvent(page, `Photo Summit ${s}`);
    await addSpeaker(page, base, name);
    await addSession(page, base, 'Analytical engines', name);
    await page.goto(`${base}/speakers`);
    const photo = await uploaderOf(page, name, `Photo: ${name}`);
    await expect(photo.getByText('No photo yet.')).toBeVisible();
    // No decorative option: a speaker photo is always described.
    await expect(photo.getByLabel('Decorative image (no description needed)')).toHaveCount(0);
    const form = photo.getByRole('form');
    const input = form.getByLabel('Image file', { exact: true });
    const alt = form.getByLabel('Alt text', { exact: true });
    const submit = form.getByRole('button', { name: 'Upload image' });
    // The suggested alt text, editable.
    await expect(alt).toHaveValue(`Photo of ${name}`);
    await expectAccessible(page);
    await noHorizontalScroll(page);

    await submit.click();
    await expect(photo.getByText('Choose an image file.')).toBeVisible();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toBeFocused();
    await expectAccessible(page);

    // Wrong type: by name (refused in the browser) and by bytes (refused by the server).
    await input.setInputFiles(file('notes.txt', 'text/plain', Buffer.from('not an image')));
    await submit.click();
    const wrongType = "This file isn't a supported image. Use JPEG, PNG, GIF, WebP, AVIF or SVG.";
    await expect(photo.getByText(wrongType)).toBeVisible();
    await input.setInputFiles(file('photo.png', 'image/png', fixture('text.png')));
    await submit.click();
    await expect(photo.getByText(wrongType)).toBeVisible({ timeout: 15_000 });

    // Too big.
    const big = Buffer.alloc(4 * 1024 * 1024 + 10, 0);
    fixture('banner.png').copy(big);
    await input.setInputFiles(file('huge.png', 'image/png', big));
    await submit.click();
    await expect(photo.getByText('This file is too big. The limit is 4 MB.')).toBeVisible();

    // Missing alt text.
    await input.setInputFiles(PHOTO());
    await alt.fill('');
    await submit.click();
    await expect(photo.getByText('Enter alt text that describes the image.')).toBeVisible();
    await expect(alt).toHaveAttribute('aria-invalid', 'true');
    await expect(alt).toBeFocused();
    await expectAccessible(page);

    // Keyboard only: type the alt text and press Enter.
    await alt.pressSequentially(`Photo of ${name}`);
    await alt.press('Enter');
    await expect(photo.getByRole('status').filter({ hasText: 'Image uploaded.' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(photo.getByRole('img', { name: `Photo of ${name}` })).toBeVisible();
    await expectAccessible(page);

    // Persisted: the list shows a thumbnail after a reload.
    await page.reload();
    const thumb = page
      .getByRole('listitem')
      .filter({ hasText: `Edit ${name}` })
      .getByRole('img')
      .first();
    await expect(thumb).toHaveAttribute('alt', `Photo of ${name}`);
    await expect(thumb).toHaveAttribute('width', /\d+/);
    const consoleSrc = await srcOf(thumb);

    // A draft's program images are not public.
    const guest = await guestPage(browser);
    expect((await guest.request.get(consoleSrc)).status()).toBe(404);
    expect((await page.request.get(consoleSrc)).status()).toBe(200);

    await publish(page, base);
    expect((await guest.request.get(consoleSrc)).status()).toBe(200);

    // Public speakers section: srcset from the variants, width/height, alt.
    await guest.goto(`/events/${slug}`);
    const section = guest.getByRole('region', { name: 'Speakers' });
    const pic = section.getByRole('img', { name: `Photo of ${name}` });
    await expect(pic).toBeVisible();
    await expect(pic).toHaveAttribute('width', /\d+/);
    await expect(pic).toHaveAttribute('height', /\d+/);
    await expect(section.locator('source[type="image/webp"]').first()).toHaveAttribute('srcset', /\s\d+w/);
    await expect(section.locator('source[type="image/avif"]').first()).toHaveAttribute('srcset', /\s\d+w/);
    const res = await guest.request.get(await srcOf(pic));
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toContain('public');

    // The agenda: a small avatar next to the speaker's name (alt="" — the name follows).
    const agendaLink = guest.getByRole('region', { name: 'Agenda' }).getByRole('link', { name });
    await expect(agendaLink.locator('img')).toHaveAttribute('alt', '');
    await expect(agendaLink.locator('img')).toHaveAttribute('width', /\d+/);
    const box = await agendaLink.locator('img').boundingBox();
    expect(Math.round(box?.width ?? 0)).toBe(24);

    // JSON-LD: the speaker as a performer with an absolute photo URL; OG image unchanged.
    const ld = JSON.parse((await guest.locator('script[type="application/ld+json"]').textContent()) ?? '{}');
    expect(ld.performer).toEqual([
      { '@type': 'Person', name, image: expect.stringMatching(/^https?:\/\/.+\/media\/.+\.jpg$/) },
    ]);
    await expect(guest.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/api\/og\/event\//);
    await expectAccessible(guest);
    await noHorizontalScroll(guest);

    // The speaker page.
    await section.getByRole('link', { name }).click();
    await expect(guest.getByRole('heading', { name, level: 1 })).toBeVisible();
    const big160 = guest.getByRole('img', { name: `Photo of ${name}` });
    await expect(big160).toBeVisible();
    expect(Math.round((await big160.boundingBox())?.width ?? 0)).toBe(160);
    await expectAccessible(guest);
    await noHorizontalScroll(guest);
  });

  test('replace, edit alt text and remove a speaker photo; deleting the speaker removes it', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const s = stamp();
    const name = `Grace ${s}`;
    await signIn(page);
    const { base, slug } = await createEvent(page, `Replace Summit ${s}`, { publish: true });
    await addSpeaker(page, base, name);
    await page.goto(`${base}/speakers`);
    let photo = await uploaderOf(page, name, `Photo: ${name}`);
    await upload(photo, PHOTO());
    const guest = await guestPage(browser);
    await guest.goto(`/events/${slug}`);
    const oldSrc = await srcOf(
      guest.getByRole('region', { name: 'Speakers' }).getByRole('img', { name: `Photo of ${name}` }),
    );

    // Replace: one photo per speaker, so the form replaces the current one.
    await expect(photo.getByText('Replace the image')).toBeVisible();
    await upload(photo, BANNER(), `${name} on stage`);
    await expect(photo.getByRole('img', { name: `${name} on stage` })).toBeVisible();
    await expect(photo.getByRole('listitem')).toHaveCount(1);
    await guest.goto(`/events/${slug}`);
    const section = guest.getByRole('region', { name: 'Speakers' });
    await expect(section.getByRole('img', { name: `${name} on stage` })).toBeVisible();
    expect((await guest.request.get(oldSrc)).status()).toBe(404);

    // Edit the alt text.
    await photo.getByText('Edit alt text').click();
    const card = photo.getByRole('listitem');
    await card.getByLabel('Alt text', { exact: true }).fill('');
    await card.getByRole('button', { name: 'Save' }).click();
    await expect(card.getByText('Enter alt text that describes the image.')).toBeVisible();
    await card.getByLabel('Alt text', { exact: true }).fill(`${name} at the podium`);
    await card.getByRole('button', { name: 'Save' }).click();
    await expect(photo.getByText('Alt text saved.')).toBeVisible();
    await page.reload();
    photo = await uploaderOf(page, name, `Photo: ${name}`);
    await expect(photo.getByRole('img', { name: `${name} at the podium` })).toBeVisible();
    const replacedSrc = await srcOf(photo.getByRole('img', { name: `${name} at the podium` }));

    // Remove.
    await photo.getByRole('button', { name: `Remove: ${name} at the podium` }).click();
    await expect(photo.getByText('No photo yet.')).toBeVisible();
    await expectAccessible(page);
    await guest.goto(`/events/${slug}`);
    await expect(guest.getByRole('region', { name: 'Speakers' }).getByRole('img')).toHaveCount(0);
    expect((await guest.request.get(replacedSrc)).status()).toBe(404);

    // Upload again, then delete the speaker: the photo goes with them (rows, variants, files).
    await upload(photo, PHOTO());
    await page.reload();
    const thumb = page
      .getByRole('listitem')
      .filter({ hasText: `Edit ${name}` })
      .getByRole('img')
      .first();
    const lastSrc = await srcOf(thumb);
    expect((await page.request.get(lastSrc)).status()).toBe(200);
    await page.getByText(`Edit ${name}`, { exact: true }).click();
    await page.getByRole('button', { name: `Delete ${name}` }).click();
    await expect(page.getByText('No speakers yet')).toBeVisible();
    expect((await page.request.get(lastSrc)).status()).toBe(404);
    expect((await guest.request.get(lastSrc)).status()).toBe(404);
  });

  test('sponsor SVG logo is served inert and sized by tier; exhibitor logo; console thumbnails', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const s = stamp();
    await signIn(page);
    const { base, slug } = await createEvent(page, `Logo Expo ${s}`, { publish: true });

    // Exhibitor logo (the suggested alt text is the company name).
    await page.goto(`${base}/exhibitors`);
    const ex = page.getByRole('region', { name: 'Add exhibitor' });
    await expect(ex.getByText('You can add a logo after saving.')).toBeVisible();
    await ex.getByLabel('Exhibitor name').fill(`Acme ${s}`);
    await ex.getByRole('button', { name: 'Add exhibitor' }).click();
    await expect(ex.getByText('Exhibitor added.')).toBeVisible();
    const exLogo = await uploaderOf(page, `Acme ${s}`, `Logo: Acme ${s}`);
    await expect(exLogo.getByRole('form').getByLabel('Alt text', { exact: true })).toHaveValue(`Acme ${s}`);
    await expectAccessible(page);
    await upload(exLogo, ALPHA());
    await page.reload();
    await expect(
      page
        .getByRole('listitem')
        .filter({ hasText: `Edit Acme ${s}` })
        .getByRole('img')
        .first(),
    ).toHaveAttribute('alt', `Acme ${s}`);

    // Sponsors in two tiers.
    await page.goto(`${base}/sponsors`);
    const tier = page.getByRole('region', { name: 'Add tier' });
    for (const [t, order] of [
      ['Gold', '1'],
      ['Silver', '2'],
    ] as const) {
      await tier.getByLabel('Tier name').fill(t);
      await tier.getByLabel('Order').fill(order);
      await tier.getByRole('button', { name: 'Add tier' }).click();
      await expect(tier.getByText('Tier added.')).toBeVisible();
    }
    const sp = page.getByRole('region', { name: 'Add sponsor' });
    await expect(sp.getByText('You can add a logo after saving.')).toBeVisible();
    for (const [t, n] of [
      ['Gold', `Globex ${s}`],
      ['Silver', `Initech ${s}`],
    ] as const) {
      await pickOption(sp.getByLabel('Tier'), { label: t });
      await sp.getByLabel('Sponsor name').fill(n);
      await sp.getByRole('button', { name: 'Add sponsor' }).click();
      await expect(sp.getByText('Sponsor added.')).toBeVisible();
    }
    await upload(await uploaderOf(page, `Globex ${s}`, `Logo: Globex ${s}`), EVIL_SVG());
    await page.reload();
    await upload(await uploaderOf(page, `Initech ${s}`, `Logo: Initech ${s}`), BANNER());
    await page.reload();
    const tiers = page.getByRole('region', { name: 'Sponsor tiers' });
    await expect(tiers.getByRole('img', { name: `Globex ${s}` }).first()).toBeVisible();
    await expect(tiers.getByRole('img', { name: `Initech ${s}` }).first()).toBeVisible();
    await expectAccessible(page);
    await noHorizontalScroll(page);

    // Public: logos by tier (Gold larger than Silver), exhibitor logo.
    const guest = await guestPage(browser);
    const dialogs: string[] = [];
    guest.on('dialog', async (d) => {
      dialogs.push(d.message());
      await d.dismiss();
    });
    await guest.goto(`/events/${slug}`);
    const sponsors = guest.getByRole('region', { name: 'Sponsors' });
    const gold = sponsors.getByRole('region', { name: 'Gold' }).getByRole('img', { name: `Globex ${s}` });
    const silver = sponsors
      .getByRole('region', { name: 'Silver' })
      .getByRole('img', { name: `Initech ${s}` });
    await expect(gold).toBeVisible();
    await expect(silver).toBeVisible();
    expect(Math.round((await gold.boundingBox())?.height ?? 0)).toBe(80);
    expect(Math.round((await silver.boundingBox())?.height ?? 0)).toBe(56);
    await expect(
      guest.getByRole('region', { name: 'Exhibitors' }).getByRole('img', { name: `Acme ${s}` }),
    ).toBeVisible();
    await expectAccessible(guest);
    await noHorizontalScroll(guest);

    // The SVG: sanitized, and served with the sandboxing CSP and nosniff.
    const svgSrc = await srcOf(gold);
    expect(svgSrc).toMatch(/\.svg$/);
    const res = await guest.request.get(svgSrc);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/svg+xml');
    expect(res.headers()['content-security-policy']).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    const body = (await res.text()).toLowerCase();
    expect(body).toContain('<svg');
    expect(body).not.toContain('<script');
    expect(body).not.toContain('alert');
    // Opened directly, it runs nothing.
    await guest.goto(svgSrc);
    await guest.waitForTimeout(500);
    expect(dialogs).toEqual([]);
  });

  test('a viewer sees program images but has no upload control, and stale actions are refused', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const s = stamp();
    const name = `Hedy ${s}`;
    await signIn(page);
    const { base } = await createEvent(page, `Viewer Photos ${s}`);
    await addSpeaker(page, base, name);
    await page.goto(`${base}/speakers`);
    const photo = await uploaderOf(page, name, `Photo: ${name}`);
    await upload(photo, PHOTO());

    const viewer = await guestPage(browser);
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/speakers`);
    const card = viewer.getByRole('listitem').filter({ hasText: name });
    await expect(card.getByRole('img', { name: `Photo of ${name}` })).toBeVisible();
    await expect(viewer.getByLabel('Image file', { exact: true })).toHaveCount(0);
    await expect(viewer.getByText(`Edit ${name}`)).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /Upload image|Replace image|Remove/ })).toHaveCount(0);
    // Members may see a draft's images.
    expect((await viewer.request.get(await srcOf(card.getByRole('img').first()))).status()).toBe(200);
    await expectAccessible(viewer);

    // The owner's open uploader, used after signing in as the viewer: refused.
    await photo.getByRole('form').getByLabel('Image file', { exact: true }).setInputFiles(BANNER());
    await signIn(page, VIEWER);
    await photo.getByRole('form').getByRole('button', { name: 'Replace image' }).click();
    await expect(photo.getByText("You can't change these images.")).toBeVisible({ timeout: 15_000 });
    await photo.getByRole('button', { name: `Remove: Photo of ${name}` }).click();
    await expect(
      photo.getByRole('alert').filter({ hasText: "You don't have access to this." }),
    ).toBeVisible();
    // Nothing changed.
    await signIn(page);
    await page.goto(`${base}/speakers`);
    await expect(
      page
        .getByRole('listitem')
        .filter({ hasText: `Edit ${name}` })
        .getByRole('img', { name: `Photo of ${name}` }),
    ).toBeVisible();
  });

  test('Arabic: the photo uploader, public speakers and the speaker page render right-to-left', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const s = stamp();
    const name = `Layla ${s}`;
    await signIn(page);
    const { base, slug } = await createEvent(page, `RTL Photos ${s}`, { publish: true });
    await addSpeaker(page, base, name);
    await addSession(page, base, 'Keynote', name);
    await page.goto(`${base}/speakers`);
    await upload(await uploaderOf(page, name, `Photo: ${name}`), PHOTO());

    await page.goto(`/ar${base}/speakers`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByText(`تعديل ${name}`, { exact: true }).click();
    const ar = page.getByRole('region', { name: `الصورة: ${name}`, exact: true });
    await expect(ar).toBeVisible();
    await expect(ar.getByRole('form').getByLabel('النص البديل', { exact: true })).toHaveValue(`صورة ${name}`);
    await expectAccessible(page);
    await noHorizontalScroll(page);

    await page.goto(`/ar/events/${slug}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('img', { name: `Photo of ${name}` }).first()).toBeVisible();
    await expectAccessible(page);
    await noHorizontalScroll(page);
    await page.locator('#speakers').getByRole('link', { name }).click();
    await expect(page).toHaveURL(/\/ar\/events\/.+\/speakers\//);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('img', { name: `Photo of ${name}` })).toBeVisible();
    await expectAccessible(page);
  });
});
