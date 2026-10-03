import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { createEventCommand, setEventDetailsCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { catchUpListings, moderateListingCommand } from '@yayatoh/marketplace';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { ports } from '@yayatoh/testing';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { createVenueCommand } from '@yayatoh/venues';
import { expectAccessibleBothModes, pickOption } from './helpers.ts';

/**
 * M6.14a marketplace search v2: text search with facets (category, price band, date, city), geo
 * search (near a city or the visitor's location, within a radius), recommendations (similar,
 * nearby, popular) and the public read model as the only source (weddings and private events
 * never appear; a hidden listing leaves on the next event). Each project makes its own enrolled
 * org and events (unique names), so projects and reruns never share data.
 *
 * No worker runs under e2e: the test applies the org's outbox to the listings projector and then
 * asks the web app's dev drain to run the search indexer on its in-memory Meilisearch fake.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
const MARKET = `http://yayatoh.localhost:${PORT}`;

interface Scenario {
  tag: string;
  orgSlug: string;
  orgId: string;
  jazz: { slug: string; name: string };
  gala: { slug: string; name: string };
  lyon: { slug: string; name: string };
  vows: { slug: string; name: string };
  secret: { slug: string; name: string };
}

const scenarios = new Map<string, Scenario>();

async function feed(request: APIRequestContext, s: Pick<Scenario, 'orgId' | 'orgSlug'>) {
  await catchUpListings(s.orgId);
  const res = await request.post(`${MARKET}/api/dev/search/run`, { form: { org: s.orgSlug } });
  expect(res.status()).toBe(200);
}

/** One enrolled org with three public events in Paris, Versailles and Lyon, a wedding and a private event. */
async function scenario(request: APIRequestContext, project: string): Promise<Scenario> {
  const known = scenarios.get(project);
  if (known) return known;
  const res = await request.post('/api/dev/user', { form: { org: 'new', event: 'published', signIn: '0' } });
  expect(res.ok()).toBe(true);
  const { orgSlug } = (await res.json()) as { orgSlug: string };
  const org = await resolveOrgSlug(orgSlug);
  if (!org) throw new Error('no org');
  const ctx = createCtx({ orgId: org.orgId, actor: { type: 'system', name: 'e2e.search' } });
  // Letters only, so the whole tag is one search word.
  const tag = `sq${Date.now()
    .toString(36)
    .replace(/\d/g, (d) => 'abcdefghij'[Number(d)] ?? 'a')}${project.slice(0, 1)}`;
  const starts = new Date(Date.now() + 60 * 86_400_000);
  const made: Record<string, { slug: string; name: string }> = {};
  const venues = {
    paris: { name: 'Salle Pleyel', city: 'Paris', latitude: 48.8771, longitude: 2.301 },
    versailles: { name: 'Opéra Royal', city: 'Versailles', latitude: 48.8049, longitude: 2.1204 },
    lyon: { name: 'Halle Tony Garnier', city: 'Lyon', latitude: 45.7317, longitude: 4.8233 },
  };
  const plan = [
    { key: 'jazz', name: `Pleyel Jazz ${tag}`, venue: 'paris', category: 'music', price: 1500 },
    { key: 'gala', name: `Royal Gala ${tag}`, venue: 'versailles', category: 'charity', price: 15_000 },
    { key: 'lyon', name: `Lyon Strings ${tag}`, venue: 'lyon', category: 'music', price: 0 },
    {
      key: 'vows',
      name: `Harper Vows ${tag}`,
      venue: 'paris',
      category: 'social_gatherings',
      price: 0,
      profile: 'wedding',
    },
    {
      key: 'secret',
      name: `Secret Supper ${tag}`,
      venue: 'paris',
      category: 'food_drink',
      price: 0,
      visibility: 'private',
    },
  ] as const;
  const venueIds: Record<string, string> = {};
  for (const [k, v] of Object.entries(venues)) {
    const created = await executeCommand(
      createVenueCommand,
      { ...v, name: `${v.name} ${tag}`, country: 'FR', timezone: 'Europe/Paris' },
      ctx,
      ports,
    );
    venueIds[k] = created.id;
  }
  for (const p of plan) {
    const e = await executeCommand(
      createEventCommand,
      {
        name: p.name,
        timezone: 'Europe/Paris',
        startsAt: starts.toISOString(),
        endsAt: new Date(starts.getTime() + 3 * 3_600_000).toISOString(),
        city: venues[p.venue].city,
        country: 'FR',
        currency: 'EUR',
        ...('profile' in p ? { profile: p.profile } : {}),
        ...('visibility' in p ? { visibility: p.visibility } : {}),
      },
      ctx,
      ports,
    );
    await executeCommand(
      setEventDetailsCommand,
      { eventId: e.id, venueId: venueIds[p.venue], category: p.category },
      ctx,
      ports,
    );
    await executeCommand(
      createTicketTypeCommand,
      { eventId: e.id, name: 'Entry', priceMinor: p.price, quantityTotal: 100 },
      ctx,
      ports,
    );
    await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, ctx, ports);
    made[p.key] = { slug: e.slug, name: e.name };
  }
  const s = { tag, orgSlug, orgId: org.orgId, ...made } as Scenario;
  await feed(request, s);
  scenarios.set(project, s);
  return s;
}

async function eventIdOf(orgId: string, slug: string): Promise<string> {
  const { withTenant } = await import('@yayatoh/db');
  const { sql } = await import('drizzle-orm');
  const rows = await withTenant(createCtx({ orgId, actor: { type: 'system', name: 'e2e.search' } }), (tx) =>
    tx.execute<{ id: string }>(sql`select id from events.events where slug = ${slug}`),
  );
  return rows[0]?.id ?? '';
}

const results = (page: Page) => page.getByRole('list', { name: 'Search results' });

test.afterAll(async () => {
  await closePools();
});

test.describe('marketplace search v2 (M6.14a)', () => {
  test('search with facets: counts on every option, category and price narrow the results', async ({
    page,
    request,
  }) => {
    const s = await scenario(request, test.info().project.name);
    await page.goto(`${MARKET}/search?q=${s.tag}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Search events' })).toBeVisible();
    await expect(page.getByText('3 events', { exact: true })).toBeVisible();
    for (const e of [s.jazz, s.gala, s.lyon])
      await expect(results(page).getByRole('link', { name: e.name })).toBeVisible();
    // Weddings and private events never appear (D13), not even by their own name.
    await expect(page.getByRole('link', { name: s.vows.name })).toHaveCount(0);
    await expect(page.getByRole('link', { name: s.secret.name })).toHaveCount(0);
    // Facet counts sit on the options.
    await pickOption(page.getByLabel('Category'), 'Music (2)');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/category=music/);
    await expect(page.getByText('2 events', { exact: true })).toBeVisible();
    await expect(results(page).getByRole('link', { name: s.gala.name })).toHaveCount(0);
    // The category facet still offers the other category with its count (disjunctive facets).
    await page.getByLabel('Category').click();
    await expect(page.getByRole('option', { name: 'Charity (1)' })).toBeVisible();
    await page.keyboard.press('Escape');
    await pickOption(page.getByLabel('Price'), 'Free (1)');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByText('1 event', { exact: true })).toBeVisible();
    await expect(results(page).getByRole('link', { name: s.lyon.name })).toBeVisible();
    // The filters persist in the URL: a reload shows the same.
    await page.reload();
    await expect(page.getByText('1 event', { exact: true })).toBeVisible();
    await expectAccessibleBothModes(page);
  });

  test('geo search near a city, nearest first with distances; and near the visitor', async ({
    page,
    request,
    context,
  }) => {
    const s = await scenario(request, test.info().project.name);
    await page.goto(`${MARKET}/search?q=${s.tag}`);
    await pickOption(page.getByLabel('Near'), 'Paris');
    await pickOption(page.getByLabel('Within'), '50 km');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Within 50 km of Paris' })).toBeVisible();
    const items = results(page).getByRole('listitem');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0).getByRole('link', { name: s.jazz.name })).toBeVisible();
    await expect(items.nth(1).getByRole('link', { name: s.gala.name })).toBeVisible();
    await expect(items.nth(1).getByText(/km away$/)).toBeVisible();
    await expect(results(page).getByRole('link', { name: s.lyon.name })).toHaveCount(0);
    await expectAccessibleBothModes(page);
    // The browser's location (Lyon): the button submits near=me with the coordinates.
    await context.grantPermissions(['geolocation'], { origin: MARKET });
    await context.setGeolocation({ latitude: 45.76, longitude: 4.83 });
    await page.goto(`${MARKET}/search?q=${s.tag}`);
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page).toHaveURL(/near=me/);
    await expect(page.getByRole('heading', { level: 2, name: 'Within 25 km of you' })).toBeVisible();
    await expect(results(page).getByRole('listitem')).toHaveCount(1);
    await expect(results(page).getByRole('link', { name: s.lyon.name })).toBeVisible();
  });

  test('without location permission the visitor is told to pick a city', async ({ page, request }) => {
    const s = await scenario(request, test.info().project.name);
    await page.goto(`${MARKET}/search?q=${s.tag}`);
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(
      page.getByText("We couldn't get your location. Pick a city under Near instead."),
    ).toBeVisible();
    // near=me without coordinates explains itself and searches everywhere.
    await page.goto(`${MARKET}/search?q=${s.tag}&near=me`);
    await expect(
      page.getByText('Use my location again to search near you, or pick a city under Near.'),
    ).toBeVisible();
    await expect(page.getByText('3 events', { exact: true })).toBeVisible();
  });

  test('open a recommendation: similar and nearby events from the event page, and popular events', async ({
    page,
    request,
  }) => {
    const s = await scenario(request, test.info().project.name);
    await page.goto(`${MARKET}/events/${s.jazz.slug}`);
    await page.getByRole('link', { name: 'Find similar events' }).click();
    await expect(page).toHaveURL(new RegExp(`like=${s.jazz.slug}`));
    await expect(page.getByRole('heading', { level: 2, name: `More like ${s.jazz.name}` })).toBeVisible();
    const similar = page.getByRole('list', { name: 'Similar events' });
    await expect(similar.getByRole('link', { name: s.lyon.name })).toBeVisible();
    await expect(similar.getByRole('link', { name: s.jazz.name })).toHaveCount(0);
    const nearby = page.getByRole('list', { name: 'Nearby' });
    await expect(nearby.getByRole('link', { name: s.gala.name })).toBeVisible();
    await expect(nearby.getByRole('link', { name: s.lyon.name })).toHaveCount(0);
    await expectAccessibleBothModes(page);
    await similar.getByRole('link', { name: s.lyon.name }).click();
    await expect(page).toHaveURL(new RegExp(`/events/${s.lyon.slug}$`));
    await expect(page.getByRole('heading', { level: 1, name: s.lyon.name })).toBeVisible();
    // Without filters the page leads with popular events.
    await page.goto(`${MARKET}/search`);
    await expect(page.getByRole('heading', { level: 2, name: 'Popular events' })).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Popular events' }).getByRole('listitem').first(),
    ).toBeVisible();
    // A listing that is not public says so.
    await page.goto(`${MARKET}/search?like=${s.vows.slug}`);
    await expect(page.getByText("That event isn't listed any more.")).toBeVisible();
  });

  test('keyboard only: search, choose a facet and open a result', async ({ page, request }) => {
    const s = await scenario(request, test.info().project.name);
    await page.goto(`${MARKET}/search`);
    await page.getByRole('searchbox', { name: 'Search by name, place or organizer' }).focus();
    await page.keyboard.type(`gala ${s.tag}`);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`q=gala\\+${s.tag}`));
    await expect(page.getByText('1 event', { exact: true })).toBeVisible();
    // Open the price select with the keyboard and pick "Over 100".
    await page.getByRole('searchbox', { name: 'Search by name, place or organizer' }).focus();
    await page.keyboard.press('Tab'); // Category
    await page.keyboard.press('Tab'); // Price
    await expect(page.getByLabel('Price')).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Price')).toHaveText(/Over 100 \(1\)/);
    await page.getByRole('button', { name: 'Search', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/price=over_100/);
    const link = results(page).getByRole('link', { name: s.gala.name });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: s.gala.name })).toBeVisible();
  });

  test('empty results say what to do; bad parameters are ignored', async ({ page, request }) => {
    const s = await scenario(request, test.info().project.name);
    const res = await page.goto(`${MARKET}/search?q=${s.tag}&category=gala&price=bogus&radius=7&page=x`);
    expect(res?.status()).toBe(200);
    await expect(page.getByText('3 events', { exact: true })).toBeVisible();
    await page.goto(`${MARKET}/search?q=${s.tag}nothing`);
    await expect(page.getByText('No events match these filters')).toBeVisible();
    await expect(
      page.getByText('Try another date, place or price, widen the distance, or clear the filters.'),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Clear filters' }).last().click();
    await expect(page).toHaveURL(/\/search$/);
    await expectAccessibleBothModes(page);
  });

  test('a hidden listing leaves search on the next event; showing it brings it back', async ({
    page,
    request,
  }) => {
    const s = await scenario(request, test.info().project.name);
    const eventId = await eventIdOf(s.orgId, s.gala.slug);
    const staff = createCtx({ orgId: s.orgId, actor: { type: 'system', name: 'staff:e2e' } });
    await executeCommand(moderateListingCommand, { eventId, hidden: true, reason: 'e2e hide' }, staff, ports);
    try {
      await feed(request, s);
      await page.goto(`${MARKET}/search?q=${s.tag}`);
      await expect(page.getByText('2 events', { exact: true })).toBeVisible();
      await expect(results(page).getByRole('link', { name: s.gala.name })).toHaveCount(0);
      await page.goto(`${MARKET}/search?like=${s.jazz.slug}`);
      await expect(
        page.getByRole('list', { name: 'Nearby' }).getByRole('link', { name: s.gala.name }),
      ).toHaveCount(0);
    } finally {
      await executeCommand(
        moderateListingCommand,
        { eventId, hidden: false, reason: 'e2e show' },
        staff,
        ports,
      );
      await feed(request, s);
    }
    await page.goto(`${MARKET}/search?q=${s.tag}`);
    await expect(results(page).getByRole('link', { name: s.gala.name })).toBeVisible();
  });

  test('Arabic renders right to left; /events links to search; tenant sites have no search', async ({
    page,
    request,
  }) => {
    const s = await scenario(request, test.info().project.name);
    await page.goto(`${MARKET}/ar/search?q=${s.tag}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'ابحث عن الفعاليات' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'نتائج البحث' }).getByRole('listitem')).toHaveCount(3);
    await expectAccessibleBothModes(page);
    await page.goto(`${MARKET}/events`);
    await page.getByRole('link', { name: 'Search by place, category and price' }).click();
    await expect(page).toHaveURL(/\/search$/);
    const tenant = await page.goto(`http://${s.orgSlug}.yayatoh.events:${PORT}/search`);
    expect(tenant?.status()).toBe(404);
  });
});
