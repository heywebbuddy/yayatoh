import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, type EventDto, transitionEventCommand } from '@yayatoh/events';
import { buildRow, type FloorplanDoc } from '@yayatoh/floorplan';
import { type Ctx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  catchUpListings,
  catchUpSearchIndex,
  endPromotionCommand,
  fakeMeilisearch,
  meilisearchIndex,
  parseSearchV2Params,
  promotedPlacements,
  promotedPlacementsEnabled,
  promotedSlugs,
  promoteListingCommand,
  promotionsQuery,
  type SearchIndex,
  updateSiteSettingsCommand,
} from '@yayatoh/marketplace';
import {
  eventSeatingQuery,
  saveLayoutCommand,
  setEventLayoutCommand,
  sharedLayoutsQuery,
  shareLayoutCommand,
  unshareLayoutCommand,
  useSharedLayoutCommand,
  venuePortalQuery,
} from '@yayatoh/seating';
import {
  addVenuePartnerCommand,
  createOrganization,
  removeVenuePartnerCommand,
  venuePartnersQuery,
} from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M6.14b venues (a tenancy change): a venue (org a) shares plans with partner organizers (org b)
 * through `venue_partner`; a partner copies one into its event (copy-on-use); the venue sees only
 * its own plans and the events that use them, with allowlisted columns; an org without a grant
 * (org c) sees nothing; revokes apply on the next request. Plus promoted placements in search.
 */

const RUN = uuidv7().slice(-8);
let a: OrgFixture;
let b: OrgFixture;
let c: { id: string; slug: string; ctx: () => Ctx };

const plan = (seats: number, underlay = false): FloorplanDoc => ({
  version: 1,
  width: 2000,
  height: 1000,
  underlay: underlay
    ? {
        url: `/media/${a.org.id}/${uuidv7()}/hall.png`,
        imageWidth: 100,
        imageHeight: 50,
        x: 0,
        y: 0,
        width: 2000,
        height: 1000,
        opacity: 0.5,
        locked: true,
        showOnMap: false,
      }
    : null,
  sections: [],
  items: [buildRow({ label: 'V', count: seats, x: 100, y: 100 })],
});

async function event(o: { ctx: () => Ctx }, name: string): Promise<EventDto> {
  return executeCommand(
    createEventCommand,
    {
      name: `${name} ${RUN}`,
      timezone: 'America/Chicago',
      startsAt: '2031-03-01T19:00:00Z',
      endsAt: '2031-03-01T23:00:00Z',
      city: 'Chicago',
      country: 'US',
    },
    o.ctx(),
    ports,
  );
}

const portal = (ctx: Ctx) => executeQuery(venuePortalQuery, {}, ctx, ports);
const sharedWith = (ctx: Ctx) => executeQuery(sharedLayoutsQuery, {}, ctx, ports);
const share = (layoutId: string, partnerOrgId: string, ctx = a.ctx()) =>
  executeCommand(shareLayoutCommand, { layoutId, partnerOrgId }, ctx, ports);
const use = (eventId: string, layoutId: string, ctx = b.ctx()) =>
  executeCommand(useSharedLayoutCommand, { eventId, layoutId }, ctx, ports);

let hall: { id: string };
let secret: { id: string };

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const owner = uuidv7();
  const org = await createOrganization(
    userCtx(owner),
    { slug: `outsider-${RUN}`, name: 'Outsider Org' },
    ports,
  );
  c = { id: org.id, slug: `outsider-${RUN}`, ctx: () => userCtx(owner, org.id) };
  hall = await executeCommand(
    saveLayoutCommand,
    { name: `Grand hall ${RUN}`, doc: plan(6, true) },
    a.ctx(),
    ports,
  );
  secret = await executeCommand(
    saveLayoutCommand,
    { name: `Private room ${RUN}`, doc: plan(3) },
    a.ctx(),
    ports,
  );
}, 300_000);
afterAll(async () => {
  await closePools();
});

describe('venue partners (venue_partner relationships)', () => {
  it('a venue adds a partner organizer by its address; self, unknown and lower roles are refused', async () => {
    await expect(
      executeCommand(addVenuePartnerCommand, { slug: a.org.slug }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(addVenuePartnerCommand, { slug: `nobody-${RUN}` }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(addVenuePartnerCommand, { slug: b.org.slug }, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const r = await executeCommand(
      addVenuePartnerCommand,
      { slug: b.org.slug.toUpperCase() },
      a.ctx(),
      ports,
    );
    expect(r.orgId).toBe(b.org.id);
    const partners = await executeQuery(venuePartnersQuery, {}, a.ctx(), ports);
    const p = partners.find((x) => x.orgId === b.org.id);
    expect(p && Object.keys(p).sort()).toEqual(['name', 'orgId', 'since', 'slug']);
    // The viewer reads the list (read-only portal).
    expect(
      (await executeQuery(venuePartnersQuery, {}, userCtx(a.viewerId, a.org.id), ports)).length,
    ).toBeGreaterThan(0);
  });
});

describe('shared layouts (copy-on-use)', () => {
  it('shares only with partners and only plans of its own library', async () => {
    await expect(share(hall.id, c.id)).rejects.toMatchObject({
      code: 'not_found',
      details: { reason: 'not_partner' },
    });
    // Another org's plan id is not in this org's library (RLS).
    await expect(share(uuidv7(), b.org.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(share(hall.id, b.org.id, userCtx(a.viewerId, a.org.id))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await share(hall.id, b.org.id);
    await share(hall.id, b.org.id); // idempotent
    const mine = await portal(a.ctx());
    expect(mine.layouts.find((l) => l.id === hall.id)?.sharedWith).toEqual([b.org.id]);
    expect(mine.layouts.find((l) => l.id === secret.id)?.sharedWith).toEqual([]);
  });

  it('a partner sees the shared plan (allowlisted); an org without a grant sees none of the private plans', async () => {
    const seen = await sharedWith(b.ctx());
    const h = seen.find((s) => s.layoutId === hall.id);
    expect(h).toMatchObject({
      name: `Grand hall ${RUN}`,
      seatCount: 6,
      venueOrgId: a.org.id,
      venueName: a.org.name,
    });
    expect(Object.keys(h ?? {}).sort()).toEqual(
      [
        'layoutId',
        'name',
        'seatCount',
        'sharedAt',
        'updatedAt',
        'venueName',
        'venueOrgId',
        'venueSlug',
      ].sort(),
    );
    expect(seen.some((s) => s.layoutId === secret.id)).toBe(false);
    expect((await sharedWith(c.ctx())).some((s) => s.venueOrgId === a.org.id)).toBe(false);
    // Direct reads of the venue's tables from another tenant return nothing (RLS).
    const rows = await withTenant(systemCtx(c.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select (select count(*) from seating.layout_shares)::int + (select count(*) from seating.layouts)::int as n`,
      ),
    );
    expect(rows[0]?.n).toBe(0);
    // An unshared plan's document can't be fetched by guessing its id.
    const docs = await withTenant(systemCtx(c.id), (tx) =>
      tx.execute(sql`select * from seating.partner_shared_layout_doc(${hall.id}::uuid)`),
    );
    expect(docs.length).toBe(0);
    const ev = await event(c, 'Outsider night');
    await expect(use(ev.id, hall.id, c.ctx())).rejects.toMatchObject({ code: 'not_found' });
  });

  let used: EventDto;
  it('the partner copies it into its event; the venue sees the use (allowlisted) and nothing else', async () => {
    used = await event(b, 'Partner gala');
    const other = await event(b, 'Partner other night');
    await expect(use(used.id, hall.id, userCtx(b.viewerId, b.org.id))).rejects.toMatchObject({
      code: 'forbidden',
    });
    const r = await use(used.id, hall.id);
    expect(r).toMatchObject({ seatCount: 6, status: 'draft', venueName: a.org.name });
    const seating = await executeQuery(eventSeatingQuery, { eventId: used.id }, b.ctx(), ports);
    expect(seating?.seats).toHaveLength(6);
    // The venue's image is never copied (another org's media).
    expect(seating?.doc.underlay ?? null).toBeNull();
    const view = await portal(a.ctx());
    const mine = view.uses.filter((u) => u.layoutId === hall.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      eventName: `Partner gala ${RUN}`,
      organizerName: b.org.name,
      status: 'draft',
    });
    expect(Object.keys(mine[0] ?? {}).sort()).toEqual(
      [
        'eventName',
        'layoutId',
        'layoutName',
        'organizerName',
        'startsAt',
        'status',
        'timezone',
        'usedAt',
      ].sort(),
    );
    expect(view.uses.some((u) => u.eventName === `Partner other night ${RUN}`)).toBe(false);
    expect(view.layouts.find((l) => l.id === hall.id)?.uses).toBe(1);
    // Org b's view as a venue never shows org a's events (only its own plans' uses).
    expect((await portal(b.ctx())).uses.some((u) => u.layoutId === hall.id)).toBe(false);
    void other;
  });

  it("the event keeps its own copy: the venue's later edits never reach it", async () => {
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(
        sql`update seating.layouts set doc = ${JSON.stringify(plan(2))}::jsonb, seat_count = 2 where id = ${hall.id}`,
      ),
    );
    const seating = await executeQuery(eventSeatingQuery, { eventId: used.id }, b.ctx(), ports);
    expect(seating?.seats).toHaveLength(6);
  });

  it('unsharing applies on the next request; the use already made stays visible', async () => {
    await executeCommand(unshareLayoutCommand, { layoutId: hall.id, partnerOrgId: b.org.id }, a.ctx(), ports);
    expect((await sharedWith(b.ctx())).some((s) => s.layoutId === hall.id)).toBe(false);
    const again = await event(b, 'Partner late night');
    await expect(use(again.id, hall.id)).rejects.toMatchObject({ code: 'not_found' });
    expect((await portal(a.ctx())).uses.some((u) => u.eventName === `Partner gala ${RUN}`)).toBe(true);
    await expect(
      executeCommand(unshareLayoutCommand, { layoutId: hall.id, partnerOrgId: b.org.id }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it("giving the event one of the organizer's own plans ends the use", async () => {
    await share(hall.id, b.org.id);
    const ev = await event(b, 'Partner switch');
    await use(ev.id, hall.id);
    expect((await portal(a.ctx())).uses.some((u) => u.eventName === `Partner switch ${RUN}`)).toBe(true);
    const own = await executeCommand(saveLayoutCommand, { name: `Own ${RUN}`, doc: plan(4) }, b.ctx(), ports);
    await executeCommand(setEventLayoutCommand, { eventId: ev.id, layoutId: own.id }, b.ctx(), ports);
    expect((await portal(a.ctx())).uses.some((u) => u.eventName === `Partner switch ${RUN}`)).toBe(false);
  });

  it('removing the partner withdraws every share and hides their events from the venue at once', async () => {
    await executeCommand(removeVenuePartnerCommand, { orgId: b.org.id }, a.ctx(), ports);
    expect((await sharedWith(b.ctx())).some((s) => s.venueOrgId === a.org.id)).toBe(false);
    const view = await portal(a.ctx());
    expect(view.uses.some((u) => u.organizerName === b.org.name)).toBe(false);
    expect(view.partners.some((p) => p.orgId === b.org.id)).toBe(false);
    expect(view.layouts.find((l) => l.id === hall.id)?.sharedWith).toEqual([]);
    await expect(share(hall.id, b.org.id)).rejects.toMatchObject({ code: 'not_found' });
    // Adding them again restores the relationship (the share rows were kept).
    await executeCommand(addVenuePartnerCommand, { slug: b.org.slug }, a.ctx(), ports);
    expect((await sharedWith(b.ctx())).some((s) => s.layoutId === hall.id)).toBe(true);
  });
});

describe('promoted placements', () => {
  let index: SearchIndex;
  let listed: EventDto;
  beforeAll(async () => {
    const fake = fakeMeilisearch();
    index = meilisearchIndex({ ...fake.config, fetch: fake.fetch, inMemory: true });
    await index.setup();
    await executeCommand(updateSiteSettingsCommand, { listOnMarketplace: true }, b.ctx(), ports);
    listed = await event(b, 'Promoted jazz');
    await executeCommand(
      transitionEventCommand,
      { eventId: listed.id, transition: 'publish' },
      b.ctx(),
      ports,
    );
    await catchUpListings(b.org.id);
    await catchUpSearchIndex(b.org.id, { index: () => index });
  }, 120_000);

  const placements = (raw: Record<string, string>, enabled = true) =>
    promotedPlacements(index, parseSearchV2Params(raw), new Date(), { enabled });

  it('is behind a flag: on in development and CI, off in production unless switched on', () => {
    expect(promotedPlacementsEnabled({ YAYATOH_DEV_AUTH: '1' })).toBe(true);
    expect(promotedPlacementsEnabled({})).toBe(false);
    expect(promotedPlacementsEnabled({ YAYATOH_DEV_AUTH: '1', VERCEL_ENV: 'production' })).toBe(false);
    expect(promotedPlacementsEnabled({ PROMOTED_PLACEMENTS: 'on' })).toBe(true);
    expect(promotedPlacementsEnabled({ YAYATOH_DEV_AUTH: '1', PROMOTED_PLACEMENTS: 'off' })).toBe(false);
  });

  it('only marketplace listings can be promoted, by roles that write marketing, for 1–30 days', async () => {
    const draft = await event(b, 'Draft night');
    await expect(
      executeCommand(promoteListingCommand, { eventId: draft.id, days: 7 }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'not_listed' } });
    await expect(
      executeCommand(promoteListingCommand, { eventId: listed.id, days: 31 }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(
        promoteListingCommand,
        { eventId: listed.id, days: 7 },
        userCtx(b.viewerId, b.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Another org's listing is not this org's (RLS): not listed.
    await expect(
      executeCommand(promoteListingCommand, { eventId: listed.id, days: 7 }, c.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('a promoted listing matching the search is placed (and labelled by the page); others are not', async () => {
    expect(await placements({ q: 'Promoted jazz' })).toEqual([]);
    await executeCommand(promoteListingCommand, { eventId: listed.id, days: 7 }, b.ctx(), ports);
    expect(await promotedSlugs()).toContain(listed.slug);
    const list = await executeQuery(promotionsQuery, {}, b.ctx(), ports);
    expect(list.find((l) => l.eventId === listed.id)).toMatchObject({ state: 'active', onMarketplace: true });
    expect((await placements({ q: `Promoted jazz ${RUN}` })).map((l) => l.slug)).toEqual([listed.slug]);
    // Not when the visitor's search doesn't match it, on later pages, or with the flag off.
    expect(await placements({ q: `nothing-like-it-${RUN}` })).toEqual([]);
    expect(await placements({ q: `Promoted jazz ${RUN}`, page: '2' })).toEqual([]);
    expect(await placements({ q: `Promoted jazz ${RUN}` }, false)).toEqual([]);
  });

  it('ending the promotion removes the placement on the next search', async () => {
    await executeCommand(endPromotionCommand, { eventId: listed.id }, b.ctx(), ports);
    expect(await promotedSlugs()).not.toContain(listed.slug);
    expect(await placements({ q: `Promoted jazz ${RUN}` })).toEqual([]);
    const list = await executeQuery(promotionsQuery, {}, b.ctx(), ports);
    expect(list.find((l) => l.eventId === listed.id)?.state).toBe('ended');
  });
});
