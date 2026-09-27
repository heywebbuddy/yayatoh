import { expect, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';

test.describe('events', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('an owner creates a draft, publishes it, and it appears publicly', async ({ page }) => {
    await signIn(page);
    await page.goto('/o/lakeside-events/events/new');
    await expectAccessible(page);
    const name = `Autumn Mixer ${Date.now()}`;
    await page.getByLabel('Event name').fill(name);
    await page.getByLabel('Event type').selectOption('concert');
    await page.getByLabel('Time zone').selectOption('America/Chicago');
    await page.getByLabel('Starts').fill('2027-11-05T19:00');
    await page.getByLabel('Ends').fill('2027-11-05T23:00');
    await page.getByLabel('Venue').fill('Riverside Hall');
    await page.getByRole('button', { name: 'Create draft' }).click();

    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/autumn-mixer-\d+$/);
    await expect(page.getByText('Draft ·')).toBeVisible();
    await expect(page.getByText('No sales yet')).toBeVisible();
    const slug = page.url().split('/').pop() as string;

    // Not public while a draft.
    const hidden = await page.request.get(`/events/${slug}`);
    expect(hidden.status()).toBe(404);

    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();
    await expectAccessible(page);

    await page.goto(`/events/${slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
    await expect(page.getByText('Nov 5, 2027')).toBeVisible();
    await expect(page.getByText("Tickets aren't on sale yet")).toBeVisible();
    await expectAccessible(page);
  });

  test('a private event never has a public page', async ({ page }) => {
    const res = await page.goto('/events/harper-and-theo');
    expect(res?.status()).toBe(404);
  });

  test('a viewer cannot create events', async ({ page }) => {
    await signIn(page, 'jordan@lakeside.test');
    await page.goto('/o/lakeside-events');
    await expect(page.getByRole('link', { name: 'Create event' })).toHaveCount(0);
    const res = await page.goto('/o/lakeside-events/events/new');
    expect(res?.status()).toBe(404);
  });
});
