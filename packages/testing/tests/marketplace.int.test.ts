import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, type EventDto, transitionEventCommand } from '@yayatoh/events';
import { executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  addLegacyRedirectCommand,
  catchUpListings,
  listingBySlug,
  listingCities,
  listingsProjector,
  matchLegacyRedirect,
  orgListings,
  PAGE_SIZE,
  parseSearchParams,
  publicOrganizer,
  publicSiteSettings,
  searchListings,
  sitemapListings,
  siteSettingsQuery,
  updateSiteSettingsCommand,
} from '@yayatoh/marketplace';
import { consumeEvent } from '@yayatoh/platform';
import {
  addDomainCommand,
  managedHostname,
  recordDomainCheckCommand,
  removeDomainCommand,
  updateOrganizationCommand,
} from '@yayatoh/tenancy';
import {
  archiveTicketTypeCommand,
  createTicketTypeCommand,
  updateTicketTypeCommand,
} from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
const tag = uuidv7().slice(-8);
const search = (raw: Record<string, string>, orgSlug?: string) =>
  searchListings({ ...parseSearchParams(raw), ...(orgSlug ? { orgSlug } : {}) });

async function event(o: OrgFixture, name: string, extra: Record<string, unknown> = {}): Promise<EventDto> {
  return executeCommand(
    createEventCommand,
    {
      name: `${name} ${tag}`,
      timezone: 'America/Chicago',
      startsAt: '2031-05-01T18:00:00Z',
      endsAt: '2031-05-01T22:00:00Z',
      city: 'Chicago',
      country: 'US',
      ...extra,
    },
    o.ctx(),
    ports,
  );
}
const transition = (o: OrgFixture, eventId: string, t: string) =>
  executeCommand(transitionEventCommand, { eventId, transition: t as 'publish' }, o.ctx(), ports);
const project = (o: OrgFixture) => catchUpListings(o.org.id);
const rowsOf = async (o: OrgFixture) =>
  withTenant(systemCtx(o.org.id), (tx) =>
    tx.execute<{ slug: string; org_id: string }>(sql`select slug, org_id from marketplace.public_listings`),
  );

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  // Org B is not enrolled on the marketplace (the default for new orgs, D13).
  await executeCommand(updateSiteSettingsCommand, { listOnMarketplace: false }, b.ctx(), ports);
});
afterAll(closePools);

describe('marketplace projection (M1.11a)', () => {
  it('a published public event gets a listing with allowlisted fields and its all-in price range', async () => {
    const e = await event(a, 'Harbor Gala', { venueName: 'Harbor Hall', profile: 'gala' });
    await executeCommand(
      createTicketTypeCommand,
      { eventId: e.id, name: 'Seat', priceMinor: 4000, quantityTotal: 10 },
      a.ctx(),
      ports,
    );
    await transition(a, e.id, 'publish');
    expect(await listingBySlug(e.slug)).toBeNull(); // projection is fed by the outbox
    expect(await project(a)).toBeGreaterThan(0);
    const l = await listingBySlug(e.slug);
    expect(l).toMatchObject({
      slug: e.slug,
      name: e.name,
      status: 'published',
      venueName: 'Harbor Hall',
      city: 'Chicago',
      country: 'US',
      orgSlug: a.org.slug,
      orgName: a.org.name,
      canonicalHost: null,
      orgId: a.org.id,
    });
    expect(l?.minPriceMinor).toBeGreaterThanOrEqual(4000);
    expect(l?.maxPriceMinor).toBe(l?.minPriceMinor);
    // No org internals or ids in the DTO beyond the server-side orgId.
    expect(Object.keys(l ?? {})).not.toContain('eventId');
    expect(Object.keys(l ?? {})).not.toContain('id');
  });

  it('catching up twice changes nothing (idempotent, exactly-once per event)', async () => {
    expect(await project(a)).toBe(0);
  });

  it('drafts, unlisted and private events are never listed', async () => {
    const draft = await event(a, 'Draft Night');
    const unlisted = await event(a, 'Unlisted Night', { visibility: 'unlisted' });
    const priv = await event(a, 'Private Night', { visibility: 'private' });
    await transition(a, unlisted.id, 'publish');
    await transition(a, priv.id, 'publish');
    await project(a);
    for (const e of [draft, unlisted, priv]) expect(await listingBySlug(e.slug)).toBeNull();
  });

  it('unpublish and cancel remove the listing; postpone keeps it as postponed', async () => {
    const e = await event(a, 'Lifecycle Fair');
    await transition(a, e.id, 'publish');
    await project(a);
    expect(await listingBySlug(e.slug)).not.toBeNull();
    await transition(a, e.id, 'unpublish');
    await project(a);
    expect(await listingBySlug(e.slug)).toBeNull();
    await transition(a, e.id, 'publish');
    await transition(a, e.id, 'postpone');
    await project(a);
    expect((await listingBySlug(e.slug))?.status).toBe('postponed');
    await transition(a, e.id, 'cancel');
    await project(a);
    expect(await listingBySlug(e.slug)).toBeNull();
  });

  it('ticket type changes move the price range; archiving the last one clears it', async () => {
    const e = await event(a, 'Price Walk');
    const t = await executeCommand(
      createTicketTypeCommand,
      { eventId: e.id, name: 'GA', priceMinor: 0, quantityTotal: 10 },
      a.ctx(),
      ports,
    );
    await transition(a, e.id, 'publish');
    await project(a);
    expect(await listingBySlug(e.slug)).toMatchObject({ minPriceMinor: 0, maxPriceMinor: 0 });
    expect((await search({ q: `Price Walk ${tag}`, price: 'free' })).total).toBe(1);
    expect((await search({ q: `Price Walk ${tag}`, price: 'paid' })).total).toBe(0);
    await executeCommand(updateTicketTypeCommand, { ticketTypeId: t.id, priceMinor: 1500 }, a.ctx(), ports);
    await project(a);
    expect((await listingBySlug(e.slug))?.minPriceMinor).toBeGreaterThanOrEqual(1500);
    expect((await search({ q: `Price Walk ${tag}`, price: 'paid' })).total).toBe(1);
    await executeCommand(archiveTicketTypeCommand, { ticketTypeId: t.id }, a.ctx(), ports);
    await project(a);
    expect(await listingBySlug(e.slug)).toMatchObject({ minPriceMinor: null, maxPriceMinor: null });
    // No tickets: neither free nor paid.
    expect((await search({ q: `Price Walk ${tag}`, price: 'free' })).total).toBe(0);
  });

  it('weddings appear on the tenant site but never on the marketplace', async () => {
    const e = await event(a, 'Garden Wedding', { profile: 'wedding' });
    await transition(a, e.id, 'publish');
    await project(a);
    expect(await listingBySlug(e.slug)).not.toBeNull();
    expect((await search({ q: `Garden Wedding ${tag}` })).total).toBe(0);
    expect((await orgListings(a.org.id)).items.map((i) => i.slug)).toContain(e.slug);
  });

  it('an org renamed renames its listings', async () => {
    await executeCommand(updateOrganizationCommand, { name: `Alpha Renamed ${tag}` }, a.ctx(), ports);
    await project(a);
    const [first] = (await orgListings(a.org.id)).items;
    expect(first?.orgName).toBe(`Alpha Renamed ${tag}`);
  });
});

describe('marketplace search (M1.11a)', () => {
  let bEvent: EventDto;
  beforeAll(async () => {
    for (const [i, city] of ['Lagos', 'Lagos', 'Paris'].entries()) {
      const e = await event(a, `Search Fest ${i}`, {
        city,
        profile: i === 2 ? 'concert' : 'conference',
        startsAt: `2031-0${i + 6}-01T18:00:00Z`,
        endsAt: `2031-0${i + 6}-01T22:00:00Z`,
      });
      await transition(a, e.id, 'publish');
    }
    bEvent = await event(b, 'Search Fest B', { city: 'Lagos' });
    await transition(b, bEvent.id, 'publish');
    await project(a);
    await project(b);
  });

  it('finds by text, city, category and date range, in date order', async () => {
    const all = await search({ q: `Search Fest` });
    const mine = all.items.filter((i) => i.name.endsWith(tag));
    expect(mine.map((i) => i.name)).toEqual([0, 1, 2].map((i) => `Search Fest ${i} ${tag}`));
    expect((await search({ q: `fest 1 ${tag}` })).total).toBe(1); // case-insensitive
    expect((await search({ q: tag, city: 'lagos' })).items.every((i) => i.city === 'Lagos')).toBe(true);
    expect((await search({ q: tag, category: 'concert' })).items.map((i) => i.city)).toEqual(['Paris']);
    const july = await search({ q: tag, from: '2031-07-01', to: '2031-07-01' });
    expect(july.items.map((i) => i.name)).toEqual([`Search Fest 1 ${tag}`]);
    expect((await search({ q: `100%_${tag}` })).total).toBe(0); // wildcards are literal
    expect(await listingCities()).toEqual(expect.arrayContaining(['Lagos', 'Paris']));
  });

  it('never shows an org that is not enrolled, but its own page and tenant site do', async () => {
    expect((await search({ q: 'Search Fest B' })).items.map((i) => i.orgSlug)).not.toContain(b.org.slug);
    const page = await search({}, b.org.slug);
    expect(page.items.map((i) => i.slug)).toContain(bEvent.slug);
    expect(page.items.every((i) => i.orgSlug === b.org.slug)).toBe(true);
    expect((await orgListings(b.org.id)).items.map((i) => i.slug)).toContain(bEvent.slug);
  });

  it('enrolling lists the org at once; leaving unlists it', async () => {
    await executeCommand(updateSiteSettingsCommand, { listOnMarketplace: true }, b.ctx(), ports);
    expect((await search({ q: `Search Fest B ${tag}` })).total).toBe(1);
    await executeCommand(updateSiteSettingsCommand, { listOnMarketplace: false }, b.ctx(), ports);
    expect((await search({ q: `Search Fest B ${tag}` })).total).toBe(0);
  });

  it('paginates with a stable total', async () => {
    for (let i = 0; i < PAGE_SIZE + 2; i += 1) {
      const e = await event(a, `Paged ${i}`, {
        startsAt: '2031-09-01T18:00:00Z',
        endsAt: '2031-09-01T20:00:00Z',
      });
      await transition(a, e.id, 'publish');
    }
    await project(a);
    const p1 = await search({ q: `Paged` });
    const p2 = await search({ q: `Paged`, page: '2' });
    expect(p1.items).toHaveLength(PAGE_SIZE);
    expect(p1.total).toBeGreaterThan(PAGE_SIZE);
    expect(p2.total).toBe(p1.total);
    expect(p1.pageCount).toBeGreaterThanOrEqual(2);
    expect(new Set([...p1.items, ...p2.items].map((i) => i.slug)).size).toBe(
      p1.items.length + p2.items.length,
    );
  });
});

describe('site settings, canonical hosts and isolation (M1.11a/b)', () => {
  it('defaults for a new org: not enrolled, no tenant site, no embed origins', async () => {
    const fresh = await twoOrgs(`mk${tag}`);
    await executeCommand(updateSiteSettingsCommand, { listOnMarketplace: false }, fresh.a.ctx(), ports);
    expect(await executeQuery(siteSettingsQuery, {}, fresh.a.ctx(), ports)).toEqual({
      listOnMarketplace: false,
      tenantSite: false,
      embedOrigins: [],
      // M1.4g: the fixture links its published "About" page from the tenant site's navigation.
      navPageIds: [expect.any(String)],
    });
  });

  it('viewers and other orgs cannot change the settings; bad origins are refused', async () => {
    await expect(
      executeCommand(updateSiteSettingsCommand, { tenantSite: true }, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(updateSiteSettingsCommand, { tenantSite: true }, userCtx(b.ownerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(updateSiteSettingsCommand, { embedOrigins: ['http://evil.example'] }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const s = await executeCommand(
      updateSiteSettingsCommand,
      { embedOrigins: ['Shop.Example.com', 'https://shop.example.com/', ''] },
      a.ctx(),
      ports,
    );
    expect(s.embedOrigins).toEqual(['https://shop.example.com']);
    expect((await publicSiteSettings(a.org.id)).embedOrigins).toEqual(['https://shop.example.com']);
    expect((await publicSiteSettings(b.org.id)).embedOrigins).toEqual([]);
  });

  it('canonical host: apex by default, the tenant subdomain with a tenant site, a custom domain first', async () => {
    const [l] = (await orgListings(a.org.id)).items;
    if (!l) throw new Error('no listing');
    expect(l.canonicalHost).toBeNull();
    await executeCommand(updateSiteSettingsCommand, { tenantSite: true }, a.ctx(), ports);
    expect((await listingBySlug(l.slug))?.canonicalHost).toBe(managedHostname(a.org.slug));
    expect((await sitemapListings(managedHostname(a.org.slug))).map((s) => s.slug)).toContain(l.slug);
    expect((await sitemapListings(null)).map((s) => s.slug)).not.toContain(l.slug);

    const d = await executeCommand(
      addDomainCommand,
      { hostname: `tickets-${tag}.example.test` },
      a.ctx(),
      ports,
    );
    await executeCommand(
      recordDomainCheckCommand,
      { domainId: d.id, check: { status: 'active', records: [], sslStatus: 'issued', reason: null } },
      a.ctx(),
      ports,
    );
    await project(a);
    expect((await listingBySlug(l.slug))?.canonicalHost).toBe(`tickets-${tag}.example.test`);
    expect(await publicOrganizer(a.org.slug)).toMatchObject({
      orgId: a.org.id,
      primaryHost: `tickets-${tag}.example.test`,
      tenantSite: true,
    });
    await executeCommand(removeDomainCommand, { domainId: d.id }, a.ctx(), ports);
    await executeCommand(updateSiteSettingsCommand, { tenantSite: false }, a.ctx(), ports);
    await project(a);
    expect((await listingBySlug(l.slug))?.canonicalHost).toBeNull();
  });

  it('a tenant site reads only its own listings; the projector cannot be tricked across orgs', async () => {
    const own = await rowsOf(a);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((r) => r.org_id === a.org.id)).toBe(true);
    expect((await orgListings(a.org.id)).items.every((i) => i.orgSlug === a.org.slug)).toBe(true);
    // An event of org A delivered under org B's context: B's transaction cannot see it, so nothing
    // of A's leaks into B's projection.
    const [ev] = (await orgListings(a.org.id)).items;
    const foreign = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ event_id: string }>(sql`select event_id from marketplace.public_listings limit 1`),
    );
    await consumeEvent(listingsProjector(), {
      id: uuidv7(),
      orgId: b.org.id,
      type: 'event.published',
      version: 1,
      aggregateType: 'event',
      aggregateId: foreign[0]?.event_id ?? '',
      payload: { eventId: foreign[0]?.event_id },
      logSeq: 0,
    });
    expect((await rowsOf(b)).map((r) => r.slug)).not.toContain(ev?.slug);
    expect(await publicOrganizer('no-such-org-anywhere')).toBeNull();
  });
});

describe('legacy redirects (M1.11b)', () => {
  const add = (o: OrgFixture, input: Record<string, unknown>, ctx = systemCtx(o.org.id)) =>
    executeCommand(addLegacyRedirectCommand, input as never, ctx, ports);

  it('only migration tooling (platform permission) may add them; duplicates conflict', async () => {
    await expect(add(a, { host: '*', source: `/x-${tag}`, target: '/' }, a.ctx())).rejects.toMatchObject({
      code: 'forbidden',
    });
    await add(a, { host: 'YAYATOH.com', source: `/org-${tag}/`, target: `/o/${a.org.slug}` });
    await expect(
      add(b, { host: 'yayatoh.com', source: `/org-${tag}`, target: `/o/${b.org.slug}` }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(add(a, { host: '*', source: '/loop', target: '/loop' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(add(a, { host: '*', source: '/x', target: '//evil.example' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('matches exact before prefix, the host before *, carries the rest and the query, counts hits', async () => {
    await add(a, { host: '*', source: `/old-${tag}`, match: 'prefix', target: '/events', status: 301 });
    await add(a, { host: 'yayatoh.com', source: `/old-${tag}/special`, target: '/o/special' });
    expect(await matchLegacyRedirect('yayatoh.com', `/org-${tag}`)).toEqual({
      location: `/o/${a.org.slug}`,
      status: 308,
    });
    expect(await matchLegacyRedirect('yayatoh.com', `/old-${tag}/special`)).toEqual({
      location: '/o/special',
      status: 308,
    });
    expect(await matchLegacyRedirect('abc.yayatoh.com', `/old-${tag}/gala?ref=mail`)).toEqual({
      location: '/events/gala?ref=mail',
      status: 301,
    });
    expect(await matchLegacyRedirect('yayatoh.com', `/old-${tag}ish`)).toBeNull();
    expect(await matchLegacyRedirect('other.example', `/org-${tag}`)).toBeNull();
    const [row] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ hits: number }>(
        sql`select hits::int from marketplace.legacy_redirects where source = ${`/org-${tag}`}`,
      ),
    );
    expect(row?.hits).toBe(1);
  });
});
