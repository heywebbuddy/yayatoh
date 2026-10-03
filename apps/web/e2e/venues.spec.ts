import { type Browser, expect, type Page, test } from '@playwright/test';
import { expectAccessible, expectPicked, passHumanCheck, pickOption, signIn } from './helpers.ts';

const VIEWER = 'jordan@lakeside.test';
const ORG = '/o/lakeside-events';

/** A wall-clock time in Chicago, `offsetH` hours from now (datetime-local format). */
function chicago(offsetH: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + offsetH * 3_600_000));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function createVenue(page: Page, name: string, opts: { listed?: boolean; city?: string } = {}) {
  await page.goto(`${ORG}/venues`);
  await page.getByLabel('Venue name').fill(name);
  await page.getByLabel('Country code').fill('us');
  await page.getByLabel('City', { exact: true }).fill(opts.city ?? 'Madison');
  await page.getByLabel('Capacity', { exact: true }).fill('250');
  if (opts.listed) await page.getByLabel(/List this venue in the Yayatoh venue directory/).check();
  await page.getByRole('button', { name: 'Add venue' }).click();
  await expect(page.getByText('Venue added.')).toBeVisible();
  return new URL(page.url()).pathname.replace(/^\/[a-z]{2}(-[A-Z]{2})?(?=\/o\/)/, '');
}

/** Create and publish a public event through the UI; returns its console path and slug. */
async function createEvent(page: Page, name: string) {
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await pickOption(page.getByLabel('Time zone'), 'America/Chicago');
  await page.getByLabel('Starts', { exact: true }).fill(chicago(24 * 30));
  await page.getByLabel('Ends', { exact: true }).fill(chicago(24 * 30 + 3));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  return { base, slug: base.split('/').pop() ?? '' };
}

async function viewerPage(browser: Browser) {
  const viewer = await (await browser.newContext()).newPage();
  await signIn(viewer, VIEWER);
  return viewer;
}

test.describe('venues, categories and tags (M1.4c)', () => {
  test('an owner creates a venue: validation errors on the fields, then saved and editable', async ({
    page,
  }) => {
    const s = stamp();
    await signIn(page);
    await page.goto(`${ORG}/venues`);
    await expect(page.getByRole('heading', { name: 'Venues', level: 1 })).toBeVisible();
    await expectAccessible(page);
    await noHorizontalScroll(page);

    // U3: creating asks for the essentials only; the rest is validated on the details form next.
    // Invalid country first.
    await page.getByLabel('Venue name').fill(`Harbor Hall ${s}`);
    await page.getByLabel('Country code').fill('U');
    await page.getByRole('button', { name: 'Add venue' }).click();
    await expect(page.getByText('Some details need fixing. Check the highlighted fields.')).toBeVisible();
    await expect(page.getByText('Use a two-letter country code, for example US.')).toBeVisible();
    await expect(page.getByLabel('Country code')).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page);

    await page.getByLabel('Country code').fill('us');
    await page.getByLabel('Capacity', { exact: true }).fill('0');
    await page.getByRole('button', { name: 'Add venue' }).click();
    await expect(page.getByText('Capacity must be a whole number of at least 1.')).toBeVisible();
    await page.getByLabel('Capacity', { exact: true }).fill('300');
    await page.getByRole('button', { name: 'Add venue' }).click();
    await expect(page.getByText('Venue added.')).toBeVisible();
    await expect(page.getByRole('heading', { name: `Harbor Hall ${s}`, level: 1 })).toBeVisible();
    await expectAccessible(page);

    // The details: an http map link and a latitude without longitude.
    await page.getByLabel('Map link').fill('http://maps.example.com/harbor');
    await page.getByLabel('Latitude').fill('43.07');
    await page.getByRole('button', { name: 'Save venue' }).click();
    await expect(page.getByText('Some details need fixing. Check the highlighted fields.')).toBeVisible();
    await expect(page.getByText('Use a link that starts with https://.')).toBeVisible();
    await expect(
      page.getByText('Give latitude and longitude together; longitude must be between -180 and 180.'),
    ).toBeVisible();
    await expectAccessible(page);
    await page.getByLabel('Map link').fill('https://maps.example.com/harbor');
    await page.getByLabel('Longitude').fill('-89.4');
    await page.getByLabel('Accessibility notes').fill('Step-free entrance on Shore Road.');
    await page.getByRole('button', { name: 'Save venue' }).click();
    await expect(page.getByText('Venue saved.')).toBeVisible();

    // Edit and persist across a reload.
    await page.getByLabel('City', { exact: true }).fill('Madison');
    await page.getByRole('button', { name: 'Save venue' }).click();
    await expect(page.getByText('Venue saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('City', { exact: true })).toHaveValue('Madison');
    await expect(page.getByLabel('Country code')).toHaveValue('US');
    await expect(page.getByLabel('Capacity', { exact: true })).toHaveValue('300');
    await expect(page.getByLabel('Map link')).toHaveValue('https://maps.example.com/harbor');
    await expect(page.getByLabel('Accessibility notes')).toHaveValue('Step-free entrance on Shore Road.');
    // Unlisted venues have no quote inbox yet.
    await expect(page.getByText('List the venue in the directory to receive quote requests.')).toBeVisible();

    // The list shows it; archiving hides it until "Show archived".
    await page.getByRole('button', { name: 'Archive venue' }).click();
    await expect(page.getByText(/This venue is archived/)).toBeVisible();
    await page.goto(`${ORG}/venues`);
    await expect(page.getByRole('link', { name: `Harbor Hall ${s}` })).toHaveCount(0);
    await page.getByRole('link', { name: 'Show archived venues' }).click();
    await expect(page.getByRole('link', { name: `Harbor Hall ${s}` })).toBeVisible();
  });

  test('keyboard only: the venue form is operable without a mouse', async ({ page }) => {
    const s = stamp();
    await signIn(page);
    await page.goto(`${ORG}/venues`);
    await page.getByLabel('Venue name').focus();
    await page.keyboard.type(`Key Hall ${s}`);
    await page.keyboard.press('Tab'); // capacity
    await page.keyboard.type('80');
    await page.getByLabel('Country code').focus();
    await page.keyboard.type('ca');
    await page.getByRole('button', { name: 'Add venue' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Venue added.')).toBeVisible();
  });

  test('pick a venue, category and tags on an event; the console list filters by them', async ({ page }) => {
    // A long journey through several pages: more than the default 30 s with parallel workers.
    test.setTimeout(90_000);
    const s = stamp();
    await signIn(page);
    const venue = `Pier Loft ${s}`;
    await createVenue(page, venue, { listed: true, city: 'Chicago' });
    const tag = `Jazz${s}`;
    const { base, slug } = await createEvent(page, `Loft Night ${s}`);

    await page.goto(`${base}/details`);
    await expect(page.getByRole('heading', { name: 'Event details', level: 1 })).toBeVisible();
    await expectAccessible(page);
    await pickOption(page.getByLabel('Venue'), { label: `${venue} · Chicago` });
    await pickOption(page.getByLabel('Category'), { label: 'Music' });
    await page.getByLabel('Tags').fill(`${tag}, live, ${tag.toLowerCase()}`);
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Details saved.')).toBeVisible();
    await page.reload();
    await expectPicked(page.getByLabel('Category'), 'music');
    await expect(page.getByLabel('Tags')).toHaveValue(`${tag}, live`);

    // Too many tags: a specific message on the field.
    await page.getByLabel('Tags').fill(Array.from({ length: 11 }, (_, i) => `t${i}`).join(','));
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Use at most 10 tags.')).toBeVisible();
    await expectAccessible(page);

    // Console list: filter by tag, then by category, then clear.
    await page.goto(ORG);
    const filters = page.getByRole('search', { name: 'Filter events' });
    await pickOption(filters.getByLabel('Tag'), { label: tag });
    await filters.getByRole('button', { name: 'Filter' }).click();
    await expect(page).toHaveURL(new RegExp(`tag=${tag.toLowerCase()}`));
    await expect(page.getByRole('heading', { name: `Loft Night ${s}` })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Lakeside Open House' })).toHaveCount(0);
    await expectAccessible(page);
    await pickOption(filters.getByLabel('Tag'), '');
    await pickOption(filters.getByLabel('Category'), { label: 'Nightlife' });
    await filters.getByRole('button', { name: 'Filter' }).click();
    await expect(page.getByRole('heading', { name: `Loft Night ${s}` })).toHaveCount(0);
    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(page).toHaveURL(new RegExp(`${ORG}$`));
    await expectPicked(filters.getByLabel('Category'), '');
    // Design v2: the list is paged (24 a page); the unfiltered list finds it by name.
    await filters.getByLabel('Search by name').fill(`Loft Night ${s}`);
    await filters.getByRole('button', { name: 'Filter' }).click();
    await expect(page.getByRole('heading', { name: `Loft Night ${s}` })).toBeVisible();

    // Published: the public page links the directory venue and shows the category.
    await page.goto(base);
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();
    await page.goto(`/events/${slug}`);
    const facts = page.getByRole('list', { name: 'About this event' });
    await expect(facts.getByText('Music')).toBeVisible();
    await facts.getByRole('link', { name: venue }).click();
    await expect(page).toHaveURL(/\/venues\//);
    await expect(page.getByRole('heading', { name: venue, level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: `Loft Night ${s}` })).toBeVisible();
  });

  test('the public directory, venue page and quote request (validation, spam trap, inbox)', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    await signIn(page);
    const venue = `Garden Pavilion ${s}`;
    const consolePath = await createVenue(page, venue, { listed: true });

    const guest = await (await browser.newContext()).newPage();
    await guest.goto('/venues');
    await expect(guest.getByRole('heading', { name: 'Venue directory', level: 1 })).toBeVisible();
    await expectAccessible(guest);
    await noHorizontalScroll(guest);
    await guest.getByRole('link', { name: venue }).click();
    await expect(guest.getByRole('heading', { name: venue, level: 1 })).toBeVisible();
    await expect(guest.getByText('Managed by Lakeside Events')).toBeVisible();
    await expect(guest.getByText('No upcoming public events')).toBeVisible();
    await expectAccessible(guest);
    await noHorizontalScroll(guest);

    // Validation errors (past the human check, M1.2f).
    await passHumanCheck(guest);
    await guest.getByRole('button', { name: 'Send request' }).click();
    await expect(guest.getByText('Some details need fixing. Check the highlighted fields.')).toBeVisible();
    await expect(guest.getByText('Enter your name.')).toBeVisible();
    await expect(guest.getByText('Enter a valid email address.')).toBeVisible();
    await expect(guest.getByText('Tell the venue a little more (at least 10 characters).')).toBeVisible();
    await expectAccessible(guest);

    // A bot filling the hidden field gets a success but nothing is stored.
    await guest.getByLabel('Your name').fill(`Bot ${s}`);
    await guest.getByLabel('Email').fill(`bot.${s}@example.test`);
    await guest.getByLabel('About your event').fill('Cheap watches, click here now!');
    await guest.locator('input[name="website"]').fill('https://spam.example', { force: true });
    await guest.getByRole('button', { name: 'Send request' }).click();
    await expect(guest.getByText('Thanks! Your request was sent to the venue.')).toBeVisible();

    await guest.reload();
    await guest.getByLabel('Your name').fill(`Riley ${s}`);
    await guest.getByLabel('Email').fill(`riley.${s}@example.test`);
    await guest.getByLabel('Number of guests (optional)').fill('120');
    await guest.getByLabel('About your event').fill('A summer wedding reception with dinner and dancing.');
    await passHumanCheck(guest);
    await guest.getByRole('button', { name: 'Send request' }).click();
    await expect(guest.getByText('Thanks! Your request was sent to the venue.')).toBeVisible();
    await expect(guest.getByLabel('Your name')).toHaveValue('');

    // The organizer's inbox has the real request only, and can mark it handled.
    await page.goto(consolePath);
    const request = page.getByRole('listitem').filter({ hasText: `Riley ${s}` });
    await expect(request).toContainText('A summer wedding reception');
    await expect(request).toContainText('New');
    await expect(page.getByText(`Bot ${s}`)).toHaveCount(0);
    await request.getByRole('button', { name: 'Mark as handled' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: `Riley ${s}` })).toContainText('Handled');
    await expectAccessible(page);
  });

  test('a viewer sees venues read-only, no quote inbox, and is refused on a stale form', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    await signIn(page);
    const consolePath = await createVenue(page, `Viewer Check ${s}`, { listed: true });

    const viewer = await viewerPage(browser);
    await viewer.goto(`${ORG}/venues`);
    await expect(viewer.getByText("You can see your team's venues but not change them.")).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Add venue' })).toHaveCount(0);
    await expectAccessible(viewer);
    await viewer.goto(consolePath);
    await expect(viewer.getByLabel('Venue name')).toBeDisabled();
    await expect(viewer.getByRole('button', { name: 'Save venue' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Archive venue' })).toHaveCount(0);
    await expect(
      viewer.getByText(
        'Quote requests contain contact details, so only people who can edit events see them.',
      ),
    ).toBeVisible();
    await expectAccessible(viewer);

    // The owner's open form, submitted after switching to the viewer: the server refuses.
    await page.goto(consolePath);
    await signIn(page, VIEWER);
    await page.getByLabel('City', { exact: true }).fill('Hijacked');
    await page.getByRole('button', { name: 'Save venue' }).click();
    await expect(page.getByRole('alert').filter({ hasText: "You don't have access to this." })).toBeVisible();

    // Event details are read-only for the viewer too.
    await viewer.goto('/o/lakeside-events/e/lakeside-open-house/details');
    await expect(viewer.getByText('You can see these details but not change them.')).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Save details' })).toHaveCount(0);
    await expectAccessible(viewer);
  });

  test('Arabic: venues, details and the directory render right-to-left', async ({ page }) => {
    await signIn(page);
    await page.goto(`/ar${ORG}/venues`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الأماكن');
    await expectAccessible(page);
    await noHorizontalScroll(page);
    await page.goto('/ar/o/lakeside-events/e/lakeside-open-house/details');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(page);
    await noHorizontalScroll(page);
    await page.goto('/ar/venues');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expectAccessible(page);
    await noHorizontalScroll(page);
  });
});
