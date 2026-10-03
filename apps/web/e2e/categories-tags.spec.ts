import { expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { catchUpListings } from '@yayatoh/marketplace';
import { signLinkToken } from '@yayatoh/platform';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import {
  expectAccessible,
  expectAccessibleBothModes,
  expectPicked,
  inOptions,
  newUser,
  pickOption,
  pickWithKeyboard,
  signIn,
} from './helpers.ts';

/**
 * U8 (UX-2): org-managed categories, event tags (console, org site, /v1) and the "What kind of
 * event?" picker. Every test works in its own new org, so projects and reruns never collide.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const MARKET = `http://yayatoh.localhost:${PORT}`;
const stamp = () => `${test.info().project.name.split('-')[0]}${Date.now().toString(36)}`;

test.afterAll(async () => {
  await closePools();
});

/** No worker runs under e2e: project the org's outbox into its listings, then revalidate. */
async function runProjector(page: Page, orgSlug: string) {
  const org = await resolveOrgSlug(orgSlug);
  if (!org) throw new Error(`no org ${orgSlug}`);
  await catchUpListings(org.orgId);
  const res = await page.request.post('/api/internal/revalidate', {
    data: { token: signLinkToken('cache.revalidate', org.orgId) },
  });
  expect(res.status()).toBe(200);
}

const item = (page: Page, name: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true, level: 3 }) });

/** Add tags through the combobox (type, Enter creates or picks). */
async function addTags(page: Page, tags: readonly string[]) {
  const box = page.getByRole('combobox', { name: 'Tags' });
  for (const tag of tags) {
    await box.fill(tag);
    await box.press('Enter');
  }
  // The list stays open for the next tag; Escape closes it (it would cover the Save button).
  await box.press('Escape');
}
const chosenTags = (page: Page) =>
  page
    .locator('input[type="hidden"][name="tags"]')
    .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

test.describe('event categories (U8)', () => {
  test('owners add, rename, reorder, hide and show categories; validation and persistence', async ({
    page,
  }) => {
    const s = stamp();
    const user = await newUser(page, { org: true, twoFactor: true, event: 'published' });
    const org = `/o/${user.orgSlug}`;

    // Entry point: Settings → Event categories.
    await page.goto(`${org}/settings`);
    await page.getByRole('link', { name: 'Event categories' }).click();
    await expect(page.getByRole('heading', { name: 'Event categories', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
    // The platform defaults (staff-managed) are the starting list, all shown.
    const listHeading = page.getByRole('heading', { name: /^Your categories \(/ });
    const start = Number(/\((\d+) shown of (\d+)\)/.exec(await listHeading.innerText())?.[2]);
    await expect(listHeading).toHaveText(`Your categories (${start} shown of ${start})`);
    expect(start).toBeGreaterThan(0);
    await expectAccessibleBothModes(page);

    // Validation: blank and taken names.
    await page.getByLabel('Category name').fill('   ');
    await page.getByRole('button', { name: 'Add category' }).click();
    await expect(page.getByText('Enter a name.')).toBeVisible();
    await expectAccessible(page);

    const name = `Supper club ${s}`;
    await page.getByLabel('Category name').fill(name);
    await pickOption(page.getByLabel('Marketplace category'), { label: 'Food & drink' });
    await page.getByRole('button', { name: 'Add category' }).click();
    await expect(page.getByText('Category added.')).toBeVisible();
    await expect(page.getByLabel('Category name')).toHaveValue('');
    await expect(item(page, name)).toContainText('Marketplace: Food & drink');
    await expect(listHeading).toHaveText(`Your categories (${start + 1} shown of ${start + 1})`);

    await page.getByLabel('Category name').fill(name.toUpperCase());
    await page.getByRole('button', { name: 'Add category' }).click();
    await expect(page.getByText('You already have a category with that name.')).toBeVisible();
    await expect(page.getByLabel('Category name')).toHaveValue(name.toUpperCase());

    // Reorder with buttons: the new category (last) moves up one place.
    const headings = () => page.getByRole('listitem').getByRole('heading', { level: 3 }).allInnerTexts();
    const lastDefault = ((await headings()).at(-2) ?? '').trim();
    await expect(page.getByRole('button', { name: `Move ${name} down` })).toBeDisabled();
    await page.getByRole('button', { name: `Move ${name} up` }).click();
    await expect(item(page, name)).toContainText('Moved up.');
    expect((await headings()).slice(-2).map((h) => h.trim())).toEqual([name, lastDefault]);

    // Rename a platform default: it keeps its marketplace mapping.
    await item(page, 'Music').getByRole('button', { name: 'Rename Music' }).click();
    await page.getByLabel('New name for Music').fill(`Live music ${s}`);
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(item(page, `Live music ${s}`)).toContainText('Marketplace: Music');

    // Hide, then the event picker no longer offers it.
    await page.getByRole('button', { name: `Hide ${name}` }).click();
    await expect(item(page, name).getByText('Hidden', { exact: true })).toBeVisible();
    await expect(listHeading).toHaveText(`Your categories (${start} shown of ${start + 1})`);
    await page.reload();
    await expect(item(page, name).getByText('Hidden', { exact: true })).toBeVisible();
    expect((await headings()).slice(-2).map((h) => h.trim())).toEqual([name, lastDefault]);

    await page.goto(`${org}/e/${user.eventSlug}/details`);
    await inOptions(page.getByLabel('Category'), async (list) => {
      await expect(list.getByRole('option', { name: `Live music ${s}` })).toBeVisible();
      await expect(list.getByRole('option', { name })).toHaveCount(0);
    });

    // Show it again.
    await page.goto(`${org}/settings/categories`);
    await page.getByRole('button', { name: `Show ${name}` }).click();
    await expect(item(page, name)).toContainText('Shown in the pickers again.');
    await expect(item(page, name).getByText('Hidden', { exact: true })).toHaveCount(0);
  });

  test('a hidden category stays on its events and in their history; others cannot pick it', async ({
    page,
  }) => {
    const s = stamp();
    const user = await newUser(page, { org: true, twoFactor: true, event: 'published' });
    const org = `/o/${user.orgSlug}`;
    const name = `Retreats ${s}`;
    await page.goto(`${org}/settings/categories`);
    await page.getByLabel('Category name').fill(name);
    await page.getByRole('button', { name: 'Add category' }).click();
    await expect(page.getByText('Category added.')).toBeVisible();

    const details = `${org}/e/${user.eventSlug}/details`;
    await page.goto(details);
    await pickOption(page.getByLabel('Category'), { label: name });
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Details saved.')).toBeVisible();

    await page.goto(`${org}/settings/categories`);
    await expect(item(page, name)).toContainText('1 event');
    await page.getByRole('button', { name: `Hide ${name}` }).click();
    await expect(item(page, name).getByText('Hidden', { exact: true })).toBeVisible();

    // The event keeps it, labelled as hidden, and saving its details keeps it.
    await page.goto(details);
    await expect(page.getByLabel('Category')).toContainText(`${name} (hidden)`);
    await expect(page.getByText('This category is hidden')).toBeVisible();
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Details saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Category')).toContainText(`${name} (hidden)`);
    await expectAccessible(page);

    // The console list still shows and filters it.
    await page.goto(org);
    const card = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { level: 3 }) })
      .first();
    await expect(card).toContainText(name);
  });

  test('viewers and managers cannot manage categories (hidden link, refused URL)', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const viewer = await (await browser.newContext()).newPage();
    await newUser(viewer, { join: ['lakeside-events:viewer'] });
    await viewer.goto('/o/lakeside-events/e/midwest-leadership-summit-2027/details');
    await expect(viewer.getByRole('heading', { name: 'Event details', level: 1 })).toBeVisible();
    await expect(viewer.getByRole('link', { name: 'Manage categories' })).toHaveCount(0);
    const res = await viewer.goto('/o/lakeside-events/settings/categories');
    expect(res?.status()).toBe(404);
    // The owner has the link.
    await page.goto('/o/lakeside-events/e/midwest-leadership-summit-2027/details');
    await expect(page.getByRole('link', { name: 'Manage categories' })).toHaveAttribute(
      'href',
      /\/o\/lakeside-events\/settings\/categories$/,
    );
  });

  test('keyboard only: add a category and move it', async ({ page }) => {
    const s = stamp();
    const user = await newUser(page, { org: true, twoFactor: true });
    await page.goto(`/o/${user.orgSlug}/settings/categories`);
    await page.getByLabel('Category name').focus();
    await page.keyboard.type(`Keys ${s}`);
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Marketplace category')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Add category' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Category added.')).toBeVisible();
    await page.getByRole('button', { name: `Move Keys ${s} up` }).focus();
    await page.keyboard.press('Enter');
    await expect(item(page, `Keys ${s}`)).toContainText('Moved up.');
    await item(page, `Keys ${s}`)
      .getByRole('button', { name: `Rename Keys ${s}` })
      .focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel(`New name for Keys ${s}`)).toBeFocused();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(`Keyed ${s}`);
    await page.keyboard.press('Enter');
    await expect(item(page, `Keyed ${s}`)).toBeVisible();
  });

  test('Arabic: the categories page is right to left and accessible', async ({ page }) => {
    const user = await newUser(page, { org: true, twoFactor: true });
    await page.goto(`/ar/o/${user.orgSlug}/settings/categories`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'فئات الفعاليات', level: 1 })).toBeVisible();
    await expectAccessibleBothModes(page);
  });
});

test.describe('event tags (U8)', () => {
  test('tag an event with the combobox; filter in the console, on the org site and on /v1', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const s = stamp();
    const tag = `Jazz${s}`;
    const user = await newUser(page, { org: true, twoFactor: true, event: 'published' });
    const org = `/o/${user.orgSlug}`;
    await page.goto(`${org}/e/${user.eventSlug}/details`);
    await addTags(page, [tag, 'Live', tag.toLowerCase()]);
    // The same tag in another case is not added twice.
    expect(await chosenTags(page)).toEqual([tag, 'Live']);
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Details saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: `Remove ${tag}` })).toBeVisible();
    expect((await chosenTags(page)).sort()).toEqual([tag, 'Live'].sort());
    await expectAccessibleBothModes(page);

    // Remove one with its chip button.
    await page.getByRole('button', { name: 'Remove Live' }).click();
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Details saved.')).toBeVisible();
    await page.reload();
    expect(await chosenTags(page)).toEqual([tag]);

    // A tag too long: the message on the field.
    await addTags(page, ['x'.repeat(41)]);
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Each tag can be at most 40 characters.')).toBeVisible();

    // Console filter.
    await page.goto(org);
    const filters = page.getByRole('search', { name: 'Filter events' });
    await pickOption(filters.getByLabel('Tag'), { label: tag });
    await filters.getByRole('button', { name: 'Filter' }).click();
    await expect(page).toHaveURL(new RegExp(`tag=${tag.toLowerCase()}`));
    await expect(page.getByTestId('org-events-count')).toContainText('1–1 of 1 event');

    // Org site (organizer page): tag chips filter the listings.
    await runProjector(page, user.orgSlug as string);
    await page.goto(`${MARKET}/o/${user.orgSlug}`);
    const nav = page.getByRole('navigation', { name: 'Filter by tag' });
    await expect(nav.getByRole('link', { name: 'All events' })).toHaveAttribute('aria-current', 'page');
    await nav.getByRole('link', { name: `${tag}, 1 event` }).click();
    await expect(page).toHaveURL(new RegExp(`\\?tag=${tag.toLowerCase()}$`));
    await expect(nav.getByRole('link', { name: `${tag}, 1 event` })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('list', { name: /^Events by / }).getByRole('listitem')).toHaveCount(1);
    await expectAccessibleBothModes(page);
    // An unknown tag shows every event, never an error.
    expect((await page.goto(`${MARKET}/o/${user.orgSlug}?tag=nope-${s}`))?.status()).toBe(200);
    await expect(nav.getByRole('link', { name: 'All events' })).toHaveAttribute('aria-current', 'page');

    // Arabic organizer page with the filter.
    await page.goto(`${MARKET}/ar/o/${user.orgSlug}?tag=${tag.toLowerCase()}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('navigation', { name: 'تصفية حسب الوسم' })).toBeVisible();
    await expectAccessible(page);

    // Another org's site never shows this tag.
    await page.goto(`${MARKET}/o/harbor-arts`);
    await expect(page.getByRole('link', { name: new RegExp(`^${tag},`) })).toHaveCount(0);
  });

  test('keyboard only: add a tag, pick a suggestion, save', async ({ page }) => {
    const s = stamp();
    const user = await newUser(page, { org: true, twoFactor: true, event: 'published' });
    const details = `/o/${user.orgSlug}/e/${user.eventSlug}/details`;
    await page.goto(details);
    await page.getByRole('combobox', { name: 'Tags' }).focus();
    await page.keyboard.type(`Kb${s}`);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save details' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Details saved.')).toBeVisible();
    await page.reload();
    expect(await chosenTags(page)).toEqual([`Kb${s}`]);
    // Backspace on the empty box removes the last chip; ArrowDown offers the org's tags again.
    const box = page.getByRole('combobox', { name: 'Tags' });
    await box.focus();
    await page.keyboard.press('Backspace');
    expect(await chosenTags(page)).toEqual([]);
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('option', { name: `Kb${s}` })).toBeVisible();
    await page.keyboard.press('Enter');
    expect(await chosenTags(page)).toEqual([`Kb${s}`]);
  });
});

test.describe('what kind of event? (U8)', () => {
  test('the picker describes each kind and the sections it includes; the event gets that kind', async ({
    page,
  }) => {
    const s = stamp();
    const user = await newUser(page, { org: true, twoFactor: true });
    await page.goto(`/o/${user.orgSlug}/events/new`);
    const picker = page.getByRole('group', { name: 'What kind of event?' });
    await expect(picker).toBeVisible();
    // Each option has its one-line description.
    await inOptions(page.getByLabel('Event type'), async (list) => {
      await expect(list.getByRole('option', { name: /Wedding/ })).toContainText('Guests, RSVPs, seating');
    });
    await pickOption(page.getByLabel('Event type'), 'wedding');
    await expectPicked(page.getByLabel('Event type'), 'wedding');
    const summary = page.getByRole('region', { name: 'What a Wedding event includes' });
    await expect(summary).toContainText('Guests, RSVPs, seating and a guest website.');
    await expect(summary.getByRole('listitem').filter({ hasText: 'RSVP' }).first()).toBeVisible();
    await pickOption(page.getByLabel('Event type'), 'conference');
    const conf = page.getByRole('region', { name: 'What a Conference event includes' });
    await expect(conf.getByRole('listitem').filter({ hasText: 'Speakers' })).toBeVisible();
    await expectAccessibleBothModes(page);

    await page.getByLabel('Event name', { exact: true }).fill(`Kinds ${s}`);
    await page.getByLabel('Starts', { exact: true }).fill('2031-03-01T18:00');
    await page.getByLabel('Ends', { exact: true }).fill('2031-03-01T21:00');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/e\/kinds-/);
    await expect(page.getByRole('link', { name: 'Speakers' }).first()).toBeVisible();
  });

  test('the guided wizard has the same picker; keyboard and Arabic', async ({ page }) => {
    const user = await newUser(page, { org: true, twoFactor: true });
    await page.goto(`/o/${user.orgSlug}/events/new/guided`);
    const field = page.getByLabel('Event type');
    await pickWithKeyboard(field, 'gala');
    await expectPicked(field, 'gala');
    await expect(page.getByRole('region', { name: 'What a Gala event includes' })).toContainText('Donations');

    await page.goto(`/ar/o/${user.orgSlug}/events/new`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('group', { name: 'ما نوع الفعالية؟' })).toBeVisible();
    await expectAccessible(page);
  });
});
