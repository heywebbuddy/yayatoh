import { expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { catchUpListings } from '@yayatoh/marketplace';
import { signLinkToken } from '@yayatoh/platform';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { expectAccessible, signIn } from './helpers.ts';

const PORT = Number(process.env.E2E_PORT ?? 3100);
/** The marketplace host (yayatoh.com in production; `*.localhost` resolves to this server). */
export const MARKET = `http://yayatoh.localhost:${PORT}`;
/** Tenant sites: the managed `{slug}.yayatoh.events` hosts (mapped to this server in the config). */
export const HARBOR = `http://harbor-arts.yayatoh.events:${PORT}`;
export const LAKESIDE = `http://lakeside-events.yayatoh.events:${PORT}`;

/**
 * No worker runs under e2e: apply the org's outbox to the listings projector the way the worker
 * would, then make the signed cache revalidation call it makes.
 */
async function runProjector(page: Page, orgSlug: string) {
  const org = await resolveOrgSlug(orgSlug);
  if (!org) throw new Error(`no org ${orgSlug}`);
  await catchUpListings(org.orgId);
  const res = await page.request.post('/api/internal/revalidate', {
    data: { token: signLinkToken('cache.revalidate', org.orgId) },
  });
  expect(res.status()).toBe(200);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.afterAll(async () => {
  await closePools();
});

/** Seeded Harbor Arts events (no other test creates events for that org). */
const HARBOR_EVENTS = ['Harbor Spring Concert', 'Harbor Film Night', 'Harbor Autumn Gala'];

test.describe('marketplace home and search (M1.11a)', () => {
  test('the home page lists upcoming public events, never drafts, cancelled or weddings', async ({
    page,
  }) => {
    const res = await page.goto('/');
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Find your next event.');
    // The home shows the six soonest public events. Other tests publish events happening today in
    // parallel, so which six is not fixed: check the rules, then find the seeded ones by search.
    const list = page.getByRole('list', { name: 'Upcoming events' });
    const shown = await list.getByRole('listitem').count();
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThanOrEqual(6);
    await expect(page.getByRole('link', { name: 'Harbor Winter Show' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Harper/ })).toHaveCount(0);
    for (const name of ['Harbor Spring Concert', 'Lakeside Open House']) {
      await page.goto(`/events?q=${encodeURIComponent(name)}`);
      await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
    }
    // Drafts, cancelled events and weddings are never found, not even by name.
    await page.goto('/events?q=Harbor+Winter+Show');
    await expect(page.getByRole('link', { name: 'Harbor Winter Show' })).toHaveCount(0);
    await page.goto('/');
    // The postponed gala is still listed, marked postponed.
    await page.goto('/events?q=Autumn+Gala');
    const gala = page.getByRole('listitem').filter({ hasText: 'Harbor Autumn Gala' });
    await expect(gala.getByText('Postponed')).toBeVisible();
    await expect(page.getByRole('link', { name: 'See all events' })).toHaveCount(0);
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'See all events' })).toBeVisible();
    await noHorizontalScroll(page);
    await expectAccessible(page);
  });

  test('a card opens the event page; the organizer link opens the organizer page', async ({ page }) => {
    await page.goto('/events?q=Harbor+Film+Night');
    const card = page.getByRole('listitem').filter({ hasText: 'Harbor Film Night' });
    await expect(card.getByText('Cinéma du Port · Paris')).toBeVisible();
    await expect(card.getByText('From €12')).toBeVisible();
    await card.getByRole('link', { name: 'By Harbor Arts Collective' }).click();
    await expect(page).toHaveURL(/\/organizers\/harbor-arts$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Harbor Arts Collective');
    await page.goBack();
    await page.getByRole('link', { name: 'Harbor Film Night' }).click();
    await expect(page).toHaveURL(/\/events\/harbor-film-night$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Harbor Film Night');
  });

  test('search and every filter narrow the results; the URL keeps them', async ({ page }) => {
    await page.goto('/events');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('All events');
    const search = page.getByRole('search', { name: 'Search events' });
    await search.getByLabel('Search by name, place or organizer').fill('harbor film');
    await search.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/q=harbor\+film/);
    const results = page.getByRole('list', { name: 'Search results' });
    await expect(results.getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('status')).toHaveText('1 event');
    // Filters persist in the form after the round trip.
    await expect(search.getByLabel('Search by name, place or organizer')).toHaveValue('harbor film');

    await page.goto('/events');
    await search.getByLabel('City').selectOption('Paris');
    await search.getByRole('button', { name: 'Search' }).click();
    await expect(results.getByRole('link', { name: 'Harbor Film Night' })).toBeVisible();
    await expect(results.getByText('New York')).toHaveCount(0);

    await page.goto('/events');
    await search.getByLabel('Category').selectOption('concert');
    await search.getByLabel('Price', { exact: true }).selectOption('free');
    await search.getByRole('button', { name: 'Search' }).click();
    await expect(results.getByRole('link', { name: 'Harbor Spring Concert' })).toBeVisible();
    await expect(results.getByRole('link', { name: 'Lakeside Jazz Night' })).toHaveCount(0);

    await page.goto('/events');
    await search.getByLabel('From date').fill('2027-08-01');
    await search.getByLabel('To date').fill('2027-08-31');
    await search.getByRole('button', { name: 'Search' }).click();
    await expect(results.getByRole('link', { name: 'Harbor Film Night' })).toBeVisible();
    await expect(results.getByRole('link', { name: 'Harbor Spring Concert' })).toHaveCount(0);
    await expectAccessible(page);

    await page.getByRole('link', { name: 'Clear filters' }).first().click();
    await expect(page).toHaveURL(/\/events$/);
    await expect(page.getByRole('list', { name: 'Upcoming events' })).toBeVisible();
  });

  test('no match shows the empty state with a way back', async ({ page }) => {
    await page.goto(`/events?q=no-such-event-${Date.now()}`);
    await expect(page.getByText('No events match these filters')).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('No events');
    await expectAccessible(page);
    await page.getByRole('main').getByRole('link', { name: 'Clear filters' }).last().click();
    await expect(page).toHaveURL(/\/events$/);
  });

  test('invalid filter values in a shared link are ignored, not an error', async ({ page }) => {
    const res = await page.goto('/events?price=cheap&from=2027-99-99&page=-4&category=rave');
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('list', { name: 'Upcoming events' })).toBeVisible();
  });

  test('search works with the keyboard only', async ({ page }) => {
    await page.goto('/events');
    await page.getByLabel('Search by name, place or organizer').focus();
    await page.keyboard.type('Jazz');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/q=Jazz/);
    await expect(page.getByRole('link', { name: 'Lakeside Jazz Night' })).toBeVisible();
    await page.getByRole('link', { name: 'Lakeside Jazz Night' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/events\/lakeside-jazz-night$/);
  });

  test('results page through with previous and next, keeping the filters', async ({ page }) => {
    await page.goto('/events?q=Harbor');
    const pages = page.getByRole('navigation', { name: 'Pages' });
    await expect(pages.getByText(/Page 1 of \d+/)).toBeVisible();
    await expect(pages.getByRole('link', { name: 'Previous page' })).toHaveCount(0);
    const first = await page
      .getByRole('list', { name: 'Search results' })
      .getByRole('heading')
      .allTextContents();
    await pages.getByRole('link', { name: 'Next page' }).click();
    await expect(page).toHaveURL(/q=Harbor&page=2/);
    await expect(pages.getByText(/Page 2 of \d+/)).toBeVisible();
    const second = await page
      .getByRole('list', { name: 'Search results' })
      .getByRole('heading')
      .allTextContents();
    expect(second.some((n) => first.includes(n))).toBe(false);
    await expectAccessible(page);
    await pages.getByRole('link', { name: 'Previous page' }).click();
    await expect(page).toHaveURL(/q=Harbor$/);
  });

  test('Arabic renders right to left with translated filters', async ({ page }) => {
    await page.goto('/ar/events');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('كل الفعاليات');
    await expect(page.getByRole('search', { name: 'البحث عن الفعاليات' })).toBeVisible();
    await noHorizontalScroll(page);
    await expectAccessible(page);
    await page.goto('/ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(page);
  });
});

test.describe('organizer pages (M1.11a)', () => {
  test('/o/{slug} on the marketplace host lists the organizer’s events', async ({ page }) => {
    const res = await page.goto(`${MARKET}/o/harbor-arts`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Harbor Arts Collective');
    const list = page.getByRole('list', { name: 'Events by Harbor Arts Collective' });
    await expect(list.getByRole('link', { name: 'Harbor Spring Concert' })).toBeVisible();
    await expect(list.getByRole('link', { name: 'Lakeside Open House' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: "Visit the organizer's website" })).toHaveAttribute(
      'href',
      HARBOR,
    );
    await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Next page' }).click();
    await expect(page).toHaveURL(`${MARKET}/o/harbor-arts?page=2`);
    await noHorizontalScroll(page);
    await expectAccessible(page);
  });

  test('the long form redirects to /o/{slug}; unknown organizers are 404', async ({ page }) => {
    await page.goto(`${MARKET}/organizers/harbor-arts`);
    await expect(page).toHaveURL(`${MARKET}/o/harbor-arts`);
    const missing = await page.goto(`${MARKET}/o/no-such-organizer-${Date.now()}`);
    expect(missing?.status()).toBe(404);
  });

  test('Arabic organizer page is right to left', async ({ page }) => {
    await page.goto(`${MARKET}/ar/o/harbor-arts`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Harbor Arts Collective');
    await expectAccessible(page);
  });
});

test.describe('tenant sites (M1.11a)', () => {
  test('a tenant host serves that org’s site: its events only', async ({ page }) => {
    const res = await page.goto(`${HARBOR}/`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Harbor Arts Collective');
    const list = page.getByRole('list', { name: 'Upcoming events' });
    await expect(list.getByRole('link', { name: 'Harbor Film Night' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Lakeside Open House' })).toHaveCount(0);
    await expect(page.getByText('Powered by Yayatoh')).toBeVisible();
    await noHorizontalScroll(page);
    await expectAccessible(page);
    await list.getByRole('link', { name: 'Harbor Film Night' }).click();
    await expect(page).toHaveURL(`${HARBOR}/events/harbor-film-night`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Harbor Film Night');
  });

  test('cache guard: the same route on two tenant hosts never shows the other org', async ({ page }) => {
    for (let i = 0; i < 2; i += 1) {
      // Lakeside's list changes as other tests publish events in parallel; Harbor's never does.
      await page.goto(`${LAKESIDE}/`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lakeside Events');
      await expect(page.getByRole('main').getByRole('link').first()).toBeVisible();
      for (const name of HARBOR_EVENTS) await expect(page.getByRole('link', { name })).toHaveCount(0);
      await page.goto(`${HARBOR}/`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Harbor Arts Collective');
      await expect(page.getByRole('link', { name: 'Harbor Film Night' })).toBeVisible();
      await expect(page.getByRole('link', { name: /Lakeside/ })).toHaveCount(0);
    }
  });

  test('another org’s event is a 404 on a tenant host; unknown hosts and internal paths too', async ({
    page,
  }) => {
    expect((await page.goto(`${HARBOR}/events/lakeside-open-house`))?.status()).toBe(404);
    expect((await page.goto(`http://nobody-${Date.now()}.yayatoh.events:${PORT}/`))?.status()).toBe(404);
    const org = await resolveOrgSlug('harbor-arts');
    expect((await page.goto(`/t/${org?.orgId}`))?.status()).toBe(404);
    expect((await page.goto(`/en/t/${org?.orgId}/events/harbor-film-night`))?.status()).toBe(404);
  });

  test('Arabic tenant site is right to left', async ({ page }) => {
    await page.goto(`${HARBOR}/ar`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'الفعاليات القادمة' })).toBeVisible();
    await noHorizontalScroll(page);
    await expectAccessible(page);
  });

  test('a custom primary domain takes over: the managed subdomain 308s to it', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-1280', 'changes an org-wide primary domain');
    const host = `rosewood-${Date.now()}.verified.test`;
    await signIn(page, 'maya@rosewood.test');
    await page.goto('/o/rosewood-weddings/domains');
    const setUp = page.getByRole('button', { name: 'Set up my free address' });
    if (await setUp.isVisible()) await setUp.click();
    const add = page.getByRole('region', { name: 'Add a domain you own' });
    await add.getByLabel('Domain').fill(host);
    await add.getByRole('button', { name: 'Add domain' }).click();
    const mine = page
      .getByRole('list', { name: 'Your domains' })
      .getByRole('listitem')
      .filter({ hasText: host });
    await mine.getByRole('button', { name: `Check now ${host}` }).click();
    await expect(mine.getByText('Primary', { exact: true })).toBeVisible();
    try {
      await page.goto(`http://rosewood-weddings.yayatoh.events:${PORT}/?from=managed`);
      await expect(page).toHaveURL(`http://${host}:${PORT}/?from=managed`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rosewood Weddings');
    } finally {
      await page.goto('/o/rosewood-weddings/domains');
      await mine.getByRole('button', { name: `Remove ${host}` }).click();
      await expect(page.getByRole('list', { name: 'Your domains' }).getByText(host)).toHaveCount(0);
    }
  });
});

test.describe('projection (M1.11a)', () => {
  test('publishing lists an event on the marketplace and its site; unpublishing removes it', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const name = `Harbor Pop-up ${test.info().project.name} ${Date.now()}`;
    await signIn(page, 'lee@harbor.test');
    await page.goto('/o/harbor-arts/events/new');
    await page.getByLabel('Event name').fill(name);
    await page.getByLabel('Event type').selectOption('concert');
    await page.getByLabel('Time zone').selectOption('America/New_York');
    await page.getByLabel('Starts').fill('2029-03-05T19:00');
    await page.getByLabel('Ends').fill('2029-03-05T22:00');
    await page.getByLabel('City').fill('Boston');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page.getByText('Draft ·')).toBeVisible();
    const dashboard = page.url();
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();

    await runProjector(page, 'harbor-arts');
    await page.goto(`/events?q=${encodeURIComponent(name)}`);
    await expect(page.getByRole('link', { name })).toBeVisible();
    const slug = dashboard.split('/').pop() ?? '';
    await page.goto(`${HARBOR}/events/${slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);

    await page.goto(dashboard);
    await page.getByRole('button', { name: 'Unpublish' }).click();
    await expect(page.getByText('Draft ·')).toBeVisible();
    await runProjector(page, 'harbor-arts');
    await page.goto(`/events?q=${encodeURIComponent(name)}`);
    await expect(page.getByText('No events match these filters')).toBeVisible();
  });

  test('the revalidation endpoint refuses an unsigned call', async ({ page }) => {
    const res = await page.request.post('/api/internal/revalidate', {
      data: { token: '01900000-0000-7000-8000-000000000000~forged' },
    });
    expect(res.status()).toBe(403);
  });
});
