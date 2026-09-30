import { expect, test } from '@playwright/test';
import { continueToPayment, expectAccessible, signIn } from './helpers.ts';

// A fresh event per run: its checkout questions must not leak into other specs' purchases.
test.describe('checkout questions', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('an organizer adds questions; a guest answers them; the organizer reads the answers', async ({
    page,
    browser,
  }) => {
    const stamp = Date.now();
    const name = `Questions ${stamp}`;
    await signIn(page);
    await page.goto('/o/lakeside-events/events/new');
    await page.getByLabel('Event name', { exact: true }).fill(name);
    await page.getByLabel('Starts', { exact: true }).fill('2027-09-01T18:00');
    await page.getByLabel('Ends', { exact: true }).fill('2027-09-01T22:00');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/questions-\d+$/);
    const base = new URL(page.url()).pathname;
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();

    await page.goto(`${base}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill('Entry');
    await page.getByLabel('Price (USD)').fill('0');
    await page.getByLabel('Quantity available').fill('10');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Entry' })).toBeVisible();

    await page.getByRole('button', { name: 'Add guest counts (kids, seated, standing)' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Standing guests' })).toBeVisible();
    await page.getByLabel('Question', { exact: true }).fill('Meal choice');
    await page.getByLabel('Answer type').selectOption('select');
    await page.getByLabel('Choices').fill('Vegetarian\nChicken');
    await page.getByLabel('Answer required').check();
    await page.getByRole('button', { name: 'Add question' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Meal choice' })).toContainText('Required');
    await page.getByRole('button', { name: 'Move Meal choice up' }).click();
    await expectAccessible(page);

    const slug = base.split('/').pop();
    const guest = await (await browser.newContext()).newPage();
    await guest.goto(`/events/${slug}`);
    await guest.getByLabel('Quantity — Entry').selectOption('2');
    await expect(guest.getByRole('group', { name: 'A few questions from the organizer' })).toBeVisible();
    await guest.getByLabel('Kids (optional)').fill('2');
    await guest.getByLabel('Meal choice').selectOption({ label: 'Vegetarian' });
    await guest.getByLabel('Full name').fill(`Grace ${stamp}`);
    await guest.getByLabel('Email for your tickets').fill(`grace+${stamp}@example.test`);
    await expectAccessible(guest);
    await continueToPayment(guest, `grace+${stamp}@example.test`);
    await expect(guest).toHaveURL(/\/orders\//);

    await page.goto(`${base}/tickets-orders`);
    await expect(page.getByRole('row').filter({ hasText: `Grace ${stamp}` })).toContainText(
      'Kids: 2 · Meal choice: Vegetarian',
    );
  });
});
