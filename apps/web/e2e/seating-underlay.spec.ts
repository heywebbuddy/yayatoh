import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';
import {
  addTicketType,
  createGala,
  priceAllAndPublish,
  publishEvent,
  quickPlan,
  unique,
} from './seating-helpers.ts';

const VIEWER = 'jordan@lakeside.test';
/** A 2000 × 500 synthetic PNG from the media pipeline's fixtures. */
const BANNER = fileURLToPath(new URL('../../../packages/modules/media/fixtures/banner.png', import.meta.url));

const panel = (page: Page) => page.getByRole('region', { name: 'Floor plan image' });
const saved = (page: Page) =>
  expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();

async function upload(page: Page) {
  const p = panel(page);
  await p.getByLabel('Floor plan image', { exact: true }).setInputFiles(BANNER);
  await p.getByRole('button', { name: 'Upload image' }).click();
  await expect(p.getByText('Image added under the plan.')).toBeVisible();
  await expect(p.getByText(/^Scale: 1 pixel = /)).toBeVisible();
  await saved(page);
}

test.describe('floor plan image under the plan (M1.7g)', () => {
  test.describe.configure({ timeout: 150_000 });

  test('upload, calibrate by keyboard (with every validation error), fade, lock, persist; buyers see it only when shown', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const base = await createGala(page, unique('Underlay Gala'));
    await addTicketType(page, base, 'Table seat', '0', 50);
    await quickPlan(page, base, { tables: 2, seatsPerTable: 4 });
    // Empty state: an upload control, no image yet.
    await expect(panel(page).getByRole('button', { name: 'Upload image' })).toBeVisible();
    await expect(panel(page).getByText(/^Scale:/)).toHaveCount(0);
    // Nothing chosen: refused with a reason on the field.
    await panel(page).getByRole('button', { name: 'Upload image' }).click();
    await expect(panel(page).getByText('Choose an image file.')).toBeVisible();
    await expect(panel(page).getByLabel('Floor plan image', { exact: true })).toBeFocused();
    await upload(page);
    await expectAccessible(page);

    // Calibrate by keyboard: every validation error first.
    const p = panel(page);
    const apply = p.getByRole('button', { name: 'Apply scale' });
    await apply.focus();
    await page.keyboard.press('Enter');
    await expect(p.getByRole('alert')).toHaveText('Enter every point as a number of pixels.');
    await expect(p.getByLabel('Point A: x (px)')).toHaveAttribute('aria-invalid', 'true');
    await p.getByLabel('Point A: x (px)').focus();
    await page.keyboard.type('100');
    await page.keyboard.press('Tab');
    await page.keyboard.type('200');
    await p.getByLabel('Point B: x (px)').focus();
    await page.keyboard.type('102');
    await page.keyboard.press('Tab');
    await page.keyboard.type('200');
    await p.getByLabel('Distance between A and B (m)').focus();
    await page.keyboard.type('10');
    await page.keyboard.press('Enter');
    await expect(p.getByRole('alert')).toHaveText(
      'Points A and B are too close together. Choose points further apart.',
    );
    await p.getByLabel('Point B: x (px)').fill('3000');
    await page.keyboard.press('Enter');
    await expect(p.getByRole('alert')).toHaveText('Both points must be inside the image.');
    await p.getByLabel('Point B: x (px)').fill('600');
    await p.getByLabel('Distance between A and B (m)').fill('0');
    await p.getByLabel('Distance between A and B (m)').press('Enter');
    await expect(p.getByRole('alert')).toHaveText('Enter a distance between 0.01 and 10,000 metres.');
    await expect(p.getByLabel('Distance between A and B (m)')).toHaveAttribute('aria-invalid', 'true');
    // 500 px = 10 m → 2 cm per pixel: the 2000 × 500 image covers 40 m × 10 m.
    await p.getByLabel('Distance between A and B (m)').fill('10');
    await p.getByLabel('Distance between A and B (m)').press('Enter');
    await expect(p.getByRole('alert')).toHaveCount(0);
    await expect(p.getByText('Scale set: 1 pixel = 2 cm.')).toBeVisible();
    await expect(p.getByText('Scale: 1 pixel = 2 cm. The image covers 40 m × 10 m.')).toBeVisible();
    await saved(page);

    // Marking a point on the plan fills its fields (the pointer path).
    await p.getByRole('button', { name: 'Mark A on the plan' }).click();
    await expect(p.getByText('Click the plan where point A is.')).toBeVisible();
    await page
      .getByRole('application', { name: 'Seating plan' })
      .locator('canvas')
      .first()
      .click({
        position: { x: 40, y: 60 },
      });
    await expect(p.getByText('Click the plan where point B is.')).toBeVisible();
    await expect(p.getByLabel('Point A: x (px)')).not.toHaveValue('100');

    // Opacity by keyboard, then lock it: its position and scale can't change.
    const opacity = p.getByRole('slider');
    await opacity.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(p.getByText('Opacity: 45 %')).toBeVisible();
    await saved(page);
    await p.getByLabel("Lock the image (it can't be moved or rescaled)").focus();
    await page.keyboard.press('Space');
    await expect(p.getByLabel('Image position x (cm)')).toBeDisabled();
    await expect(p.getByLabel('Point A: x (px)')).toBeDisabled();
    await expect(p.getByRole('button', { name: 'Remove the image' })).toBeDisabled();
    await saved(page);
    await expectAccessible(page);

    // Persisted.
    await page.reload();
    await expect(panel(page).getByText('Scale: 1 pixel = 2 cm. The image covers 40 m × 10 m.')).toBeVisible();
    await expect(panel(page).getByText('Opacity: 45 %')).toBeVisible();
    await expect(panel(page).getByLabel("Lock the image (it can't be moved or rescaled)")).toBeChecked();

    // On sale, but not shown to buyers yet: the public map has no image and the file is private.
    await priceAllAndPublish(page, base, 'Table seat');
    await publishEvent(page, base);
    const slug = base.split('/').pop() as string;
    const guest = await (await browser.newContext()).newPage();
    await guest.goto(`/events/${slug}`);
    await guest.getByRole('button', { name: 'Show seat map' }).click();
    await expect(guest.getByTestId('seat-map')).toBeVisible();
    await expect(guest.getByTestId('seat-map')).not.toHaveAttribute('data-underlay', /.+/);
    await page.goto(`${base}/seating`);
    const imageUrl = await panel(page).getAttribute('data-underlay');
    expect(imageUrl).toMatch(/^\/media\//);
    expect((await guest.request.get(imageUrl as string)).status()).toBe(404);
    // The organizer shows it faintly on the buyer's map.
    await panel(page).getByLabel("Show it faintly on the buyer's seat map").check();
    await saved(page);
    await guest.reload();
    await guest.getByRole('button', { name: 'Show seat map' }).click();
    await expect(guest.getByTestId('seat-map')).toHaveAttribute('data-underlay', imageUrl as string);
    const shown = await guest.request.get(imageUrl as string);
    expect(shown.status()).toBe(200);
    expect(shown.headers()['cache-control']).toBe('public, max-age=300');
    await expectAccessible(guest);

    // Arabic, right to left.
    await page.goto(`/ar${base}/seating`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('region', { name: 'صورة المخطط الأرضي' })).toBeVisible();
    await expectAccessible(page);
  });

  test('a viewer sees the image settings read-only, and a stale page’s upload is refused', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const base = await createGala(page, unique('Underlay Viewer'));
    await quickPlan(page, base, { tables: 1, seatsPerTable: 4 });
    await expect(panel(page).getByRole('button', { name: 'Upload image' })).toBeVisible();

    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/seating`);
    await expect(panel(viewer)).toContainText('No floor plan image.');
    await expect(panel(viewer).getByRole('button', { name: 'Upload image' })).toHaveCount(0);
    await expect(panel(viewer).getByLabel('Floor plan image', { exact: true })).toHaveCount(0);
    await expectAccessible(viewer);

    // The owner's page, now signed in as the viewer: the upload is refused.
    await signIn(page, VIEWER);
    await panel(page).getByLabel('Floor plan image', { exact: true }).setInputFiles(BANNER);
    await panel(page).getByRole('button', { name: 'Upload image' }).click();
    await expect(panel(page).getByText("You can't change this plan.")).toBeVisible();
  });
});
