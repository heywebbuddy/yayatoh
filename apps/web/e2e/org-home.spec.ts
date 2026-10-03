import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, newUser } from './helpers.ts';

/**
 * Design v2: the org home's events list stays light with many events. It shows 24 cards a page
 * (on now and next first, then past events), says which ones it shows, pages with previous and
 * next links that keep the filters, and searches by name. Keyboard only; Arabic right to left.
 */

/** Event slugs are global (public URLs): names carry a per-run, per-project stamp. */
const stamp = () => `${Date.now().toString(36)}${test.info().project.name.replace(/\D/g, '')}`;

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function draft(page: Page, org: string, name: string, offset: number) {
  await page.goto(`/o/${org}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Starts', { exact: true }).fill(`${day(offset)}T18:00`);
  await page.getByLabel('Ends', { exact: true }).fill(`${day(offset)}T21:00`);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${org}/e/[a-z0-9-]+$`));
}

test.describe('org home events list (design v2)', () => {
  test('24 a page, upcoming first, paged by keyboard with the filters kept; search by name; RTL', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    // A fresh org (with its one published event, 30 days out), so the list holds only this test's events.
    const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
    const org = owner.orgSlug as string;
    const s = stamp();
    // 25 upcoming drafts (1..25 days out) and one past event: 27 in all.
    for (let i = 1; i <= 25; i++) await draft(page, org, `Week ${String(i).padStart(2, '0')} social ${s}`, i);
    await draft(page, org, `Last year gala ${s}`, -300);

    await page.goto(`/o/${org}`);
    const list = page.locator('section[aria-labelledby="events-heading"]');
    await expect(page.getByTestId('org-events-count')).toHaveText('1–24 of 27 events');
    const headings = list.getByRole('heading', { level: 3 });
    await expect(headings).toHaveCount(24);
    // On now and next first: the soonest upcoming event leads; the past one is not on page 1.
    await expect(headings.first()).toHaveText(`Week 01 social ${s}`);
    await expect(list.getByRole('heading', { name: `Last year gala ${s}` })).toHaveCount(0);
    await expectAccessible(page);

    // Keyboard: the next page holds the rest, the past event last.
    const pages = page.getByRole('navigation', { name: 'Pages' });
    await expect(pages).toContainText('Page 1 of 2');
    await pages.getByRole('link', { name: 'Next page' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/o/${org}\\?page=2$`));
    await expect(page.getByTestId('org-events-count')).toHaveText('25–27 of 27 events');
    await expect(headings).toHaveCount(3);
    await expect(headings.last()).toHaveText(`Last year gala ${s}`);
    await expect(pages.getByRole('link', { name: 'Next page' })).toHaveCount(0);
    await pages.getByRole('link', { name: 'Previous page' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('org-events-count')).toHaveText('1–24 of 27 events');

    // Search by name (case-insensitive), from the keyboard; the filters stay in the page links.
    await page.getByLabel('Search by name').fill('WEEK 1');
    await page.getByLabel('Search by name').press('Enter');
    await expect(page).toHaveURL(/[?&]q=WEEK\+1/);
    await expect(page.getByTestId('org-events-count')).toHaveText('1–10 of 10 events');
    await expect(headings).toHaveCount(10);
    await expect(pages).toHaveCount(0);
    await expect(page.getByLabel('Search by name')).toHaveValue('WEEK 1');
    // Nothing matches: the empty state says what to do.
    await page.getByLabel('Search by name').fill('no such event');
    await page.getByRole('button', { name: 'Filter', exact: true }).click();
    await expect(page.getByText('No events match these filters')).toBeVisible();
    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(page.getByTestId('org-events-count')).toHaveText('1–24 of 27 events');

    // Arabic, right to left.
    await page.goto(`/ar/o/${org}?page=2`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(headings).toHaveCount(3);
    await expectAccessible(page);
  });
});
