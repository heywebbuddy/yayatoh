import { withTenant } from '@yayatoh/db';
import { setPlatformAuditSink, withPlatformReader } from '@yayatoh/db/platform';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import {
  createEventCommand,
  type EventDto,
  setEventDetailsCommand,
  transitionEventCommand,
  updateEventCommand,
} from '@yayatoh/events';
import { executeCommand, isDomainError, uuidv7 } from '@yayatoh/kernel';
import {
  catchUpListings,
  catchUpSearchIndex,
  docIdFor,
  type FakeMeilisearch,
  fakeMeilisearch,
  INDEXED_FIELDS,
  listingsBySlugs,
  meilisearchIndex,
  moderateListingCommand,
  moderationQueueTx,
  parseSearchV2Params,
  popularListings,
  privateColumns,
  reindexAll,
  type SearchIndex,
  searchMarketplace,
  similarListings,
  syncListingTx,
  updateSiteSettingsCommand,
} from '@yayatoh/marketplace';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { createVenueCommand } from '@yayatoh/venues';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { formatLeaks, leaksIn } from '../src/canary/index.ts';
import { canaryOrg, type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M6.14a marketplace search: the index is fed only from the public read model through the outbox
 * (projector → `marketplace.listing_changed@1` → `marketplace.search-index`), returns public
 * listings only, never weddings (D13, even mis-flagged later), and staff moderation hides a
 * listing everywhere on the marketplace. The Meilisearch fake stands in for Meilisearch.
 */

let a: OrgFixture;
let b: OrgFixture;
let admin: AdminSql;
let fake: FakeMeilisearch;
let index: SearchIndex;
const tag = uuidv7().slice(-8);
const now = new Date();

async function event(o: OrgFixture, name: string, extra: Record<string, unknown> = {}): Promise<EventDto> {
  return executeCommand(
    createEventCommand,
    {
      name: `${name} ${tag}`,
      timezone: 'Europe/Paris',
      startsAt: '2031-05-01T18:00:00Z',
      endsAt: '2031-05-01T22:00:00Z',
      city: 'Paris',
      country: 'FR',
      currency: 'EUR',
      ...extra,
    },
    o.ctx(),
    ports,
  );
}
const publish = (o: OrgFixture, eventId: string) =>
  executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, o.ctx(), ports);
/** What the worker does: the projector, then the indexer on what the projector emitted. */
async function feed(...orgs: OrgFixture[]) {
  for (const o of orgs) {
    await catchUpListings(o.org.id);
    await catchUpSearchIndex(o.org.id, { index: () => index });
  }
}
const indexedSlugs = () => [...fake.documents.values()].map((d) => String(d.slug));
const search = (raw: Record<string, string>) => searchMarketplace(index, parseSearchV2Params(raw), now);
async function venue(o: OrgFixture, name: string, city: string, lat: number, lng: number) {
  return executeCommand(
    createVenueCommand,
    { name: `${name} ${tag}`, city, country: 'FR', latitude: lat, longitude: lng, timezone: 'Europe/Paris' },
    o.ctx(),
    ports,
  );
}

const audited: string[] = [];

beforeAll(async () => {
  setPlatformAuditSink(async ({ reason }) => void audited.push(reason));
  admin = adminClient();
  ({ a, b } = await twoOrgs());
  await executeCommand(updateSiteSettingsCommand, { listOnMarketplace: true }, b.ctx(), ports);
  fake = fakeMeilisearch();
  index = meilisearchIndex({ ...fake.config, fetch: fake.fetch, inMemory: true });
  await index.setup();
}, 240_000);
afterAll(async () => {
  await closePools();
  await admin.end();
});

describe('the index follows the public read model through the outbox', () => {
  let concert: EventDto;
  let gala: EventDto;
  let lyon: EventDto;
  beforeAll(async () => {
    const paris = await venue(a, 'Salle Pleyel', 'Paris', 48.8771234, 2.3009876);
    const versailles = await venue(b, 'Opéra Royal', 'Versailles', 48.8049, 2.1204);
    const lyonHall = await venue(b, 'Halle Tony Garnier', 'Lyon', 45.7317, 4.8233);
    concert = await event(a, 'Pleyel Strings', { venueName: 'Salle Pleyel', tagline: 'Chamber music' });
    gala = await event(b, 'Royal Gala', { city: 'Versailles', profile: 'gala' });
    lyon = await event(b, 'Lyon Jazz Night', { city: 'Lyon' });
    for (const [o, e, v, category] of [
      [a, concert, paris, 'music'],
      [b, gala, versailles, 'charity'],
      [b, lyon, lyonHall, 'music'],
    ] as const) {
      await executeCommand(
        setEventDetailsCommand,
        { eventId: e.id, venueId: v.id, category },
        o.ctx(),
        ports,
      );
      await executeCommand(
        createTicketTypeCommand,
        { eventId: e.id, name: 'Seat', priceMinor: e === gala ? 15_000 : 1500, quantityTotal: 50 },
        o.ctx(),
        ports,
      );
      await publish(o, e.id);
    }
    await feed(a, b);
  }, 120_000);

  it('indexes published marketplace events with their category, rounded venue location and price band', () => {
    const doc = fake.documents.get(docIdFor(a.org.id, concert.id));
    expect(doc).toMatchObject({
      slug: concert.slug,
      category: 'music',
      city: 'Paris',
      priceBand: 'under_25',
      _geo: { lat: 48.877, lng: 2.301 },
    });
    expect(fake.documents.get(docIdFor(b.org.id, gala.id))).toMatchObject({ priceBand: 'over_100' });
  });

  it('a replay changes nothing (the indexer is idempotent and exactly-once)', async () => {
    const before = JSON.stringify([...fake.documents.entries()]);
    expect(await catchUpSearchIndex(a.org.id, { index: () => index })).toBe(0);
    await withTenant(systemCtx(a.org.id), (tx) => syncListingTx(tx, index, a.org.id, concert.id));
    expect(JSON.stringify([...fake.documents.entries()])).toBe(before);
  });

  it('searches by text, facets each filter without its own value, and pages', async () => {
    const r = await search({ q: `jazz ${tag}` });
    expect(r.items.map((i) => i.slug)).toEqual([lyon.slug]);
    const music = await search({ q: tag, category: 'music' });
    expect(music.items.map((i) => i.slug).sort()).toEqual([concert.slug, lyon.slug].sort());
    // The category facet still counts the other categories (disjunctive facets).
    expect(music.facets.category).toEqual(
      expect.arrayContaining([
        { value: 'music', count: 2 },
        { value: 'charity', count: 1 },
      ]),
    );
    expect(music.facets.price).toEqual([{ value: 'under_25', count: 2 }]);
    const pricey = await search({ q: tag, price: 'over_100' });
    expect(pricey.items.map((i) => i.slug)).toEqual([gala.slug]);
    const lyonOnly = await search({ q: tag, city: 'Lyon' });
    expect(lyonOnly.items.map((i) => i.slug)).toEqual([lyon.slug]);
    // Results are public listing DTOs (no ids, no org internals).
    expect(Object.keys(r.items[0] ?? {})).not.toContain('orgId');
    expect(Object.keys(r.items[0] ?? {})).not.toContain('eventId');
    // Date presets: everything is years away.
    expect(r.facets.when).toEqual([
      { value: 'today', count: 0 },
      { value: 'week', count: 0 },
      { value: 'month', count: 0 },
    ]);
  });

  it('geo search: within a radius of a city, nearest first, with distances', async () => {
    const near = await search({ q: tag, near: 'Paris', radius: '50' });
    expect(near.near).toEqual({ label: 'Paris', radiusKm: 50 });
    expect(near.items.map((i) => i.slug)).toEqual([concert.slug, gala.slug]);
    expect(near.items[1]?.distanceKm).toBeGreaterThan(10);
    const me = await search({ q: tag, near: 'me', lat: '45.76', lng: '4.83', radius: '10' });
    expect(me.items.map((i) => i.slug)).toEqual([lyon.slug]);
  });

  it('recommends similar, nearby and popular events from public data only', async () => {
    const sim = await similarListings(index, concert.slug, now);
    expect(sim?.anchor).toEqual({ slug: concert.slug, name: concert.name });
    expect(sim?.similar.map((i) => i.slug)).toContain(lyon.slug);
    expect(sim?.similar.map((i) => i.slug)).not.toContain(concert.slug);
    expect(sim?.nearby.map((i) => i.slug)).toContain(gala.slug);
    expect(sim?.nearby.map((i) => i.slug)).not.toContain(lyon.slug); // 390 km away
    expect(await similarListings(index, 'no-such-listing', now)).toBeNull();
    const popular = await popularListings(index, now, { limit: 100 });
    expect(popular.length).toBeGreaterThan(0);
  });

  it('a full reindex from the read model gives the same documents', async () => {
    const copy = fakeMeilisearch();
    const ix = meilisearchIndex({ ...copy.config, fetch: copy.fetch });
    expect(await reindexAll(ix, now)).toBeGreaterThan(0);
    for (const id of [docIdFor(a.org.id, concert.id), docIdFor(b.org.id, gala.id)])
      expect(copy.documents.get(id)).toEqual(fake.documents.get(id));
  });

  it('an org that leaves the marketplace leaves the index (D13 opt-in)', async () => {
    await executeCommand(updateSiteSettingsCommand, { listOnMarketplace: false }, b.ctx(), ports);
    await feed(b);
    expect(indexedSlugs()).not.toContain(gala.slug);
    expect(indexedSlugs()).not.toContain(lyon.slug);
    await executeCommand(updateSiteSettingsCommand, { listOnMarketplace: true }, b.ctx(), ports);
    await feed(b);
    expect(indexedSlugs()).toEqual(expect.arrayContaining([gala.slug, lyon.slug]));
  });
});

describe('weddings and private events never appear (D13)', () => {
  it('a wedding, a private and an unlisted event are never indexed nor found', async () => {
    const wedding = await event(a, 'Harper Wedding', { profile: 'wedding' });
    const priv = await event(a, 'Private Supper', { visibility: 'private' });
    const unlisted = await event(a, 'Unlisted Supper', { visibility: 'unlisted' });
    for (const e of [wedding, priv, unlisted]) await publish(a, e.id);
    await feed(a);
    for (const e of [wedding, priv, unlisted]) {
      expect(indexedSlugs()).not.toContain(e.slug);
      expect((await search({ q: e.name })).items).toEqual([]);
    }
  });

  it('a public event mis-flagged later as a wedding or private leaves the index on the next event', async () => {
    for (const change of [{ profile: 'wedding' }, { visibility: 'private' }] as const) {
      const e = await event(a, `Later ${Object.keys(change)[0]}`);
      await publish(a, e.id);
      await feed(a);
      expect(indexedSlugs()).toContain(e.slug);
      await executeCommand(updateEventCommand, { eventId: e.id, ...change }, a.ctx(), ports);
      await feed(a);
      expect(indexedSlugs()).not.toContain(e.slug);
      expect((await search({ q: e.name })).items).toEqual([]);
    }
  });

  it('even a corrupted projection row (a wedding flagged on the marketplace) is refused and never shown', async () => {
    const e = await event(a, 'Smuggled Vows');
    await publish(a, e.id);
    await feed(a);
    expect(indexedSlugs()).toContain(e.slug);
    // Corrupt the read model behind the projector's back.
    await admin.unsafe(
      `update marketplace.public_listings set profile = 'wedding', on_marketplace = true where org_id = $1 and event_id = $2`,
      [a.org.id, e.id],
    );
    // A stale index entry is still never shown: hydration reads the read model's rules.
    expect(await listingsBySlugs([e.slug], now)).toEqual([]);
    expect((await search({ q: e.name })).items).toEqual([]);
    // The next sync removes it (the indexer's own D13 check).
    await withTenant(systemCtx(a.org.id), (tx) => syncListingTx(tx, index, a.org.id, e.id));
    expect(indexedSlugs()).not.toContain(e.slug);
    // A full reindex never loads it either.
    const copy = fakeMeilisearch();
    await reindexAll(meilisearchIndex({ ...copy.config, fetch: copy.fetch }), now);
    expect([...copy.documents.values()].map((d) => d.slug)).not.toContain(e.slug);
    expect([...copy.documents.values()].some((d) => d.profile === 'wedding')).toBe(false);
  });
});

describe('listing moderation (staff)', () => {
  let e: EventDto;
  beforeEach(async () => {
    e = await event(a, `Moderated ${uuidv7().slice(-6)}`);
    await publish(a, e.id);
    await feed(a);
  });
  const moderate = (hidden: boolean, reason: string, ctx = systemCtx(a.org.id)) =>
    executeCommand(moderateListingCommand, { eventId: e.id, hidden, reason }, ctx, ports);
  const onMarketplace = async () =>
    (
      await admin.unsafe<{ m: boolean }[]>(
        `select on_marketplace as m from marketplace.public_listings where org_id = $1 and event_id = $2`,
        [a.org.id, e.id],
      )
    )[0]?.m;

  it('hiding takes it off the marketplace and the index, through rebuilds; unhiding brings it back', async () => {
    expect(await moderate(true, 'Misleading title')).toEqual({ hidden: true });
    expect(await onMarketplace()).toBe(false);
    await feed(a);
    expect(indexedSlugs()).not.toContain(e.slug);
    // A later edit rebuilds the row: it stays hidden.
    await executeCommand(updateEventCommand, { eventId: e.id, tagline: 'New tagline' }, a.ctx(), ports);
    await feed(a);
    expect(await onMarketplace()).toBe(false);
    expect(indexedSlugs()).not.toContain(e.slug);
    // The staff queue shows it under hidden, with the reason.
    const hidden = await withPlatformReader({ actor: 'test', reason: 'M6.14a test' }, (tx) =>
      moderationQueueTx(tx, { state: 'hidden', q: e.name }),
    );
    expect(hidden).toEqual([
      expect.objectContaining({ eventId: e.id, hidden: true, reason: 'Misleading title' }),
    ]);
    expect(await moderate(false, 'Organizer fixed the title')).toEqual({ hidden: false });
    await feed(a);
    expect(await onMarketplace()).toBe(true);
    expect(indexedSlugs()).toContain(e.slug);
    const listed = await withPlatformReader({ actor: 'test', reason: 'M6.14a test' }, (tx) =>
      moderationQueueTx(tx, { state: 'listed', q: e.name }),
    );
    expect(listed).toEqual([expect.objectContaining({ eventId: e.id, hidden: false, slug: e.slug })]);
    // Every platform_reader read was audited first.
    expect(audited.filter((r) => r === 'M6.14a test')).toHaveLength(2);
  });

  it('is audited in the org with the reason', async () => {
    await moderate(true, 'Spam listing');
    await moderate(false, 'Reviewed again');
    const rows = await admin.unsafe<{ action: string; data: { reason: string } }[]>(
      `select action, data from platform.audit_events where org_id = $1 and target_id = $2 order by seq`,
      [a.org.id, e.id],
    );
    expect(rows.filter((r) => r.action.startsWith('marketplace.listing.'))).toEqual([
      { action: 'marketplace.listing.hide', data: { reason: 'Spam listing' } },
      { action: 'marketplace.listing.unhide', data: { reason: 'Reviewed again' } },
    ]);
  });

  it('needs a reason, refuses repeats and unknown listings, and is staff only', async () => {
    const code = async (p: Promise<unknown>) => {
      try {
        await p;
        return 'ok';
      } catch (err) {
        return isDomainError(err) ? String(err.details?.reason ?? err.code) : 'thrown';
      }
    };
    expect(await code(moderate(true, '   '))).toBe('validation_failed');
    expect(await code(moderate(true, 'x'.repeat(501)))).toBe('validation_failed');
    expect(await code(moderate(false, 'Not hidden yet'))).toBe('not_hidden');
    await moderate(true, 'Spam');
    expect(await code(moderate(true, 'Again'))).toBe('already_hidden');
    expect(
      await code(
        executeCommand(
          moderateListingCommand,
          { eventId: uuidv7(), hidden: true, reason: 'x' },
          systemCtx(a.org.id),
          ports,
        ),
      ),
    ).toBe('not_found');
    // The org's own owner cannot hide or unhide (a platform permission).
    expect(await code(moderate(false, 'Mine', a.ctx()))).toBe('forbidden');
    // Another org's event is simply not found under that org.
    expect(
      await code(
        executeCommand(
          moderateListingCommand,
          { eventId: e.id, hidden: false, reason: 'x' },
          systemCtx(b.org.id),
          ports,
        ),
      ),
    ).toBe('not_hidden');
    expect(await code(moderate(false, 'Back', userCtx(a.viewerId, a.org.id)))).toBe('forbidden');
  });
});

describe('leak crawler: every indexed field is public (roadmap §9 canary)', () => {
  it('maps each document field to public or vocab projection columns', () => {
    const rules = privateColumns.tables.public_listings ?? {};
    const textual = new Set(Object.keys(rules));
    for (const [field, cols] of Object.entries(INDEXED_FIELDS))
      for (const col of cols) {
        if (!textual.has(col)) continue; // not text (numbers, dates, ids hashed into `id`)
        expect([field, rules[col]]).toEqual([field, expect.stringMatching(/^(public|vocab)$/)]);
      }
  });

  it('a canary org with every private column filled leaks nothing into the index or its answers', async () => {
    const canary = await canaryOrg({ admin });
    await catchUpListings(canary.orgId);
    const ix = fakeMeilisearch();
    const live = meilisearchIndex({ ...ix.config, fetch: ix.fetch });
    await live.setup();
    await catchUpSearchIndex(canary.orgId, { index: () => live });
    const [own] = await admin.unsafe<{ n: number }[]>(
      `select count(*)::int as n from marketplace.public_listings where org_id = $1 and on_marketplace`,
      [canary.orgId],
    );
    const docs = [...ix.documents.values()];
    // The check is live: the canary org's listings are in the index.
    expect(docs.length).toBe(own?.n ?? -1);
    expect(docs.length).toBeGreaterThan(0);
    const leaks = leaksIn('search-index', JSON.stringify(docs), { kind: 'public' });
    const slug = String(docs[0]?.slug);
    const answers = JSON.stringify([
      await searchMarketplace(live, parseSearchV2Params({ q: String(docs[0]?.name) }), now),
      await similarListings(live, slug, now),
      await popularListings(live, now),
    ]);
    expect(answers).toContain(slug);
    leaks.push(...leaksIn('search-answers', answers, { kind: 'public' }));
    // A full reindex reads the same public read model.
    const all = fakeMeilisearch();
    await reindexAll(meilisearchIndex({ ...all.config, fetch: all.fetch }), now);
    leaks.push(...leaksIn('search-reindex', JSON.stringify([...all.documents.values()]), { kind: 'public' }));
    expect(formatLeaks(leaks)).toBe('no canary leaks');
  }, 300_000);
});

describe('the tenant side sees only its own moderation rows', () => {
  it('RLS scopes listing_moderation', async () => {
    const own = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ org_id: string }>(sql`select org_id from marketplace.listing_moderation`),
    );
    expect(own.every((r) => r.org_id === b.org.id)).toBe(true);
  });
});
