import { expect, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';

test.describe('guest list', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('an organizer adds guests by hand, emails them, sees their history, and removes one', async ({
    page,
  }) => {
    const stamp = Date.now();
    await signIn(page);
    await page.goto('/o/lakeside-events/events/new');
    await page.getByLabel('Event name', { exact: true }).fill(`Dinner ${stamp}`);
    await page.getByLabel('Starts', { exact: true }).fill('2027-11-01T18:00');
    await page.getByLabel('Ends', { exact: true }).fill('2027-11-01T22:00');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/dinner-\d+$/);
    const base = new URL(page.url()).pathname;
    await page.goto(`${base}/attendees`);

    await page
      .getByText(/^Add (attendee|guest)/i)
      .first()
      .click();
    for (const who of ['Uma', 'Vic']) {
      await page.getByLabel('Full name').fill(`${who} ${stamp}`);
      await page.getByLabel('Email', { exact: true }).fill(`${who.toLowerCase()}.${stamp}@example.test`);
      await page.getByLabel('Label (optional)').fill('Family');
      await page.getByRole('button', { name: 'Add to the list' }).click();
      await expect(page.getByRole('row').filter({ hasText: `${who} ${stamp}` })).toBeVisible();
    }
    // The same email twice is refused.
    await page.getByLabel('Full name').fill('Duplicate');
    await page.getByLabel('Email', { exact: true }).fill(`uma.${stamp}@example.test`);
    await page.getByRole('button', { name: 'Add to the list' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /./ }).last()).toBeVisible();
    await expectAccessible(page);

    // Email everyone on the list.
    await page.reload();
    const bulk = page.getByRole('form', { name: 'Bulk actions' });
    await bulk.getByLabel('All 2 matching').check();
    await bulk.getByLabel('Action').selectOption({ label: 'Send email' });
    await bulk.getByLabel('Subject').fill('Seating plan');
    await bulk.getByLabel('Message').fill('Dinner starts at 7. See you there!');
    await expectAccessible(page);
    await bulk.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('region', { name: 'Email to guests' })).toContainText('Sent to 2 people.');

    // History, then removal.
    await page
      .getByRole('row')
      .filter({ hasText: `Uma ${stamp}` })
      .getByRole('link')
      .click();
    const profile = page.getByRole('complementary', { name: 'Profile' });
    await expect(profile.getByRole('region', { name: /History/ })).toContainText('Added to the guest list');
    await profile.getByRole('button', { name: 'Remove from the list' }).click();
    // The Server Action has finished once the guest is no longer active (the button goes away);
    // navigating earlier can cancel it.
    await expect(profile.getByRole('button', { name: 'Remove from the list' })).toHaveCount(0);
    await page.goto(`${base}/attendees?status=cancelled`);
    await expect(page.getByRole('row').filter({ hasText: `Uma ${stamp}` })).toBeVisible();
  });
});
