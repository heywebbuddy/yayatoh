import { expect, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';

test.describe('attendees: labels, filters and org-wide search', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('an organizer labels a guest, filters by label, and finds people by name or ticket code', async ({
    page,
    browser,
  }) => {
    const stamp = Date.now();
    await signIn(page);
    await page.goto('/o/lakeside-events/events/new');
    await page.getByLabel('Event name').fill(`Guests ${stamp}`);
    await page.getByLabel('Starts').fill('2027-11-01T18:00');
    await page.getByLabel('Ends').fill('2027-11-01T22:00');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/guests-\d+$/);
    const base = new URL(page.url()).pathname;
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();
    await page.goto(`${base}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill('Guest pass');
    await page.getByLabel('Price (USD)').fill('0');
    await page.getByLabel('Quantity available').fill('10');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Guest pass' })).toBeVisible();

    const guest = await (await browser.newContext()).newPage();
    const codes: string[] = [];
    for (const who of [`Ada ${stamp}`, `Bob ${stamp}`]) {
      await guest.goto(`/events/${base.split('/').pop()}`);
      await guest.getByLabel('Quantity — Guest pass').selectOption('1');
      await guest.getByLabel('Full name').fill(who);
      await guest
        .getByLabel('Email for your tickets')
        .fill(`${who.replace(' ', '.').toLowerCase()}@example.test`);
      await guest.getByRole('button', { name: 'Continue to payment' }).click();
      await expect(guest).toHaveURL(/\/orders\//);
      codes.push((await guest.locator('.tracking-\\[0\\.2em\\]').first().textContent())?.trim() ?? '');
    }

    // Label Ada from her profile.
    await page.goto(`${base}/attendees`);
    await page
      .getByRole('row')
      .filter({ hasText: `Ada ${stamp}` })
      .getByRole('link')
      .click();
    const profile = page.getByRole('complementary', { name: 'Profile' });
    await expect(profile).toContainText(`Ada ${stamp}`);
    await profile.getByLabel('Add a label').fill('  VIP  ');
    await profile.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(profile.getByRole('listitem').filter({ hasText: 'VIP' })).toBeVisible();
    await expectAccessible(page);

    // Filter the list by the label: only Ada remains.
    const chips = page.getByRole('navigation', { name: 'Filter by label' });
    await chips.getByRole('link', { name: /VIP/ }).click();
    await expect(chips.getByRole('link', { name: /VIP/ })).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('row').filter({ hasText: `Ada ${stamp}` })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: `Bob ${stamp}` })).toHaveCount(0);
    await expect(page.getByText('1–1 of 1 · filtered')).toBeVisible();

    // Remove it again.
    await page
      .getByRole('row')
      .filter({ hasText: `Ada ${stamp}` })
      .getByRole('link')
      .click();
    await profile.getByRole('button', { name: 'Remove label VIP' }).click();
    await expect(profile.getByText('No labels yet.')).toBeVisible();

    // ⌘K / Ctrl+K focuses the console search; a name finds the person across events.
    await page.keyboard.press('Control+k');
    const search = page.getByRole('searchbox', { name: 'Search', exact: true });
    await expect(search).toBeFocused();
    await search.fill(`Bob ${stamp}`);
    await search.press('Enter');
    await expect(page).toHaveURL(/\/o\/lakeside-events\/search\?q=/);
    const people = page.getByRole('region', { name: 'People' });
    await expect(people).toContainText(`Guests ${stamp}`);
    await expectAccessible(page);
    await people.getByRole('link', { name: new RegExp(`Bob ${stamp}`) }).click();
    await expect(page.getByRole('complementary', { name: 'Profile' })).toContainText(`Bob ${stamp}`);

    // The 8-character code printed on Ada's ticket finds her too (any case).
    await page.goto(`/o/lakeside-events/search?q=${(codes[0] ?? '').toLowerCase()}`);
    await expect(page.getByRole('region', { name: 'People' })).toContainText(`Ada ${stamp}`);
    await expect(page.getByRole('region', { name: 'People' })).toContainText(`Ticket ${codes[0]}`);
    // Orders by buyer email.
    await page.goto(`/o/lakeside-events/search?q=bob.${stamp}@example`);
    await expect(page.getByRole('region', { name: 'Orders' })).toContainText(`Bob ${stamp}`);
  });
});

test.describe('attendees: bulk actions and export', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('an organizer labels selected guests, undoes it, and downloads a CSV of everyone', async ({
    page,
    browser,
  }) => {
    const stamp = Date.now();
    await signIn(page);
    await page.goto('/o/lakeside-events/events/new');
    await page.getByLabel('Event name').fill(`Bulk ${stamp}`);
    await page.getByLabel('Starts').fill('2027-11-01T18:00');
    await page.getByLabel('Ends').fill('2027-11-01T22:00');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/bulk-\d+$/);
    const base = new URL(page.url()).pathname;
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();
    await page.goto(`${base}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill('Pass');
    await page.getByLabel('Price (USD)').fill('0');
    await page.getByLabel('Quantity available').fill('10');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Pass' })).toBeVisible();
    const guest = await (await browser.newContext()).newPage();
    for (const who of ['Ann', 'Ben', 'Cy']) {
      await guest.goto(`/events/${base.split('/').pop()}`);
      await guest.getByLabel('Quantity — Pass').selectOption('1');
      await guest.getByLabel('Full name').fill(`${who} ${stamp}`);
      await guest.getByLabel('Email for your tickets').fill(`${who.toLowerCase()}.${stamp}@example.test`);
      await guest.getByRole('button', { name: 'Continue to payment' }).click();
      await expect(guest).toHaveURL(/\/orders\//);
    }

    await page.goto(`${base}/attendees`);
    await page.getByLabel(`Select Ann ${stamp}`).check();
    await page.getByLabel(`Select Ben ${stamp}`).check();
    const bulk = page.getByRole('form', { name: 'Bulk actions' });
    await bulk.getByLabel('Action').selectOption({ label: 'Add label' });
    await bulk.getByLabel('Label', { exact: true }).fill('Table 7');
    await bulk.getByRole('button', { name: 'Apply' }).click();
    const panel = page.getByRole('region', { name: 'Bulk labels' });
    await expect(panel).toContainText('Done: 2 of 2 updated, 0 failed.');
    await expect(page.getByRole('row').filter({ hasText: `Ann ${stamp}` })).toContainText('Table 7');
    await expect(page.getByRole('row').filter({ hasText: `Cy ${stamp}` })).not.toContainText('Table 7');
    await expectAccessible(page);

    await panel.getByRole('button', { name: 'Undo' }).click();
    await expect(panel).toContainText('Undone: 2 restored.');
    await expect(page.getByRole('row').filter({ hasText: `Ann ${stamp}` })).not.toContainText('Table 7');

    // Everyone matching the (empty) filter, as CSV.
    await bulk.getByLabel('All 3 matching').check();
    await bulk.getByLabel('Action').selectOption({ label: 'Export as CSV' });
    await bulk.getByRole('button', { name: 'Apply' }).click();
    const exportPanel = page.getByRole('region', { name: 'Attendee export' });
    await expect(exportPanel).toContainText('Ready: 3 rows exported.');
    const href = await exportPanel.getByRole('link', { name: 'Download CSV' }).getAttribute('href');
    const res = await page.request.get(href ?? '');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/csv');
    expect(res.headers()['content-disposition']).toContain('attachment');
    const csv = await res.text();
    expect(csv).toContain(
      'Name,Email,Ticket type,Ticket code,No.,Source,Status,Labels,Registered,Checked in',
    );
    for (const who of ['Ann', 'Ben', 'Cy'])
      expect(csv).toContain(`${who} ${stamp},${who.toLowerCase()}.${stamp}@example.test,Pass,`);
    // The link is not a capability: without a session there is no file.
    const anon = await (await browser.newContext()).request.get(new URL(href ?? '', page.url()).toString(), {
      maxRedirects: 0,
    });
    expect(anon.status()).not.toBe(200);
  });
});
