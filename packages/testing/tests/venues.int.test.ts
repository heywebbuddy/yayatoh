import { closePools } from '@yayatoh/db/testing';
import {
  createEventCommand,
  eventDetailsQuery,
  orgTagsQuery,
  publicEventBySlug,
  publicEventsAtVenue,
  searchEventsQuery,
  setEventDetailsCommand,
  transitionEventCommand,
  updateEventCommand,
} from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  createVenueCommand,
  listQuoteRequestsQuery,
  listVenuesQuery,
  publicVenue,
  QUOTES_PER_HOUR,
  quoteTarget,
  setQuoteRequestStatusCommand,
  setVenueArchivedCommand,
  submitQuoteRequestCommand,
  updateVenueCommand,
  type VenueDto,
  venueDirectory,
} from '@yayatoh/venues';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let hall: VenueDto;

const venue = (input: Record<string, unknown>, ctx = a.ctx()) =>
  executeCommand(createVenueCommand, { country: 'us', timezone: 'America/Chicago', ...input }, ctx, ports);
const quote = (venueId: string, over: Record<string, unknown> = {}, orgId = a.org.id) =>
  executeCommand(
    submitQuoteRequestCommand,
    {
      venueId,
      name: 'Riley Planner',
      email: `riley-${Date.now()}@example.test`,
      message: 'We are planning a gala for 150 guests.',
      clientKey: `client-${Date.now()}-${Math.random()}`,
      ...over,
    },
    createCtx({ orgId }),
    ports,
  );

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  hall = await venue({
    name: `Lakeview Hall ${a.org.slug}`,
    addressLine1: '1 Shore Rd',
    city: 'Madison',
    capacity: 400,
    latitude: 43.07,
    longitude: -89.4,
    mapUrl: 'https://maps.example.com/lakeview',
    accessibilityNotes: 'Step-free entrance on the east side.',
    directoryListed: true,
  });
});
afterAll(closePools);

describe('venues (M1.4c)', () => {
  it('creates an org venue with a global slug and normalized country', async () => {
    expect(hall).toMatchObject({ country: 'US', capacity: 400, directoryListed: true, archivedAt: null });
    expect(hall.slug).toMatch(/^lakeview-hall-/);
    // Same name in another org: a different slug, never a collision.
    const other = await venue({ name: `Lakeview Hall ${a.org.slug}` }, b.ctx());
    expect(other.slug).not.toBe(hall.slug);
  });

  it('validates input: country, coordinates in pairs, https map links, capacity', async () => {
    for (const bad of [
      { name: 'X Hall', country: 'USA' },
      { name: 'X Hall', latitude: 10 },
      { name: 'X Hall', latitude: 91, longitude: 0 },
      { name: 'X Hall', mapUrl: 'javascript:alert(1)' },
      { name: 'X Hall', mapUrl: 'http://maps.example.com' },
      { name: 'X Hall', capacity: 0 },
      { name: 'X Hall', timezone: 'Mars/Base' },
      { name: 'X' },
    ])
      await expect(venue(bad)).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(updateVenueCommand, { venueId: hall.id, latitude: null }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('viewers read venues but cannot write; other orgs see nothing', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    expect((await executeQuery(listVenuesQuery, {}, viewer, ports)).map((v) => v.id)).toContain(hall.id);
    await expect(venue({ name: 'Viewer Hall' }, viewer)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(updateVenueCommand, { venueId: hall.id, name: 'Hijack' }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect((await executeQuery(listVenuesQuery, {}, b.ctx(), ports)).map((v) => v.id)).not.toContain(hall.id);
    await expect(
      executeCommand(updateVenueCommand, { venueId: hall.id, name: 'Hijack' }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('the public directory and venue page are allowlisted and only list listed, live venues', async () => {
    const pub = await publicVenue(hall.slug);
    expect(pub).toMatchObject({ name: hall.name, city: 'Madison', organizerName: 'Alpha Events' });
    expect(Object.keys(pub ?? {})).not.toContain('id');
    expect(Object.keys(pub ?? {})).not.toContain('orgId');
    expect((await venueDirectory()).map((v) => v.slug)).toContain(hall.slug);
    const unlisted = await venue({ name: `Back Room ${a.org.slug}` });
    expect(await publicVenue(unlisted.slug)).toBeNull();
    expect(await quoteTarget(unlisted.slug)).toBeNull();
    expect((await venueDirectory()).map((v) => v.slug)).not.toContain(unlisted.slug);
  });

  it('picks a venue for an event, copying its name and city (free-text fields keep working)', async () => {
    const e = await executeCommand(
      createEventCommand,
      {
        name: `Venue Night ${a.org.slug}`,
        timezone: 'America/Chicago',
        startsAt: '2030-06-01T23:00:00Z',
        endsAt: '2030-06-02T03:00:00Z',
        venueName: 'Somewhere else',
      },
      a.ctx(),
      ports,
    );
    const d = await executeCommand(
      setEventDetailsCommand,
      { eventId: e.id, venueId: hall.id, category: 'music', tags: ['Jazz', 'jazz', ' Late  night '] },
      a.ctx(),
      ports,
    );
    expect(d).toMatchObject({
      venueId: hall.id,
      venueName: hall.name,
      city: 'Madison',
      country: 'US',
      category: 'music',
      tags: ['Jazz', 'Late night'],
    });
    // Editing the free text afterwards still works (expand step).
    await executeCommand(
      updateEventCommand,
      { eventId: e.id, venueName: 'Lakeview, Room 2' },
      a.ctx(),
      ports,
    );
    expect((await executeQuery(eventDetailsQuery, { eventId: e.id }, a.ctx(), ports)).venueName).toBe(
      'Lakeview, Room 2',
    );
    // Another org's venue is not found (RLS), and an org can't point at it.
    const foreign = await venue({ name: `Foreign Hall ${b.org.slug}` }, b.ctx());
    await expect(
      executeCommand(setEventDetailsCommand, { eventId: e.id, venueId: foreign.id }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    // Public page: the directory venue's slug and the category; the venue page lists the event.
    await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, a.ctx(), ports);
    expect(await publicEventBySlug(e.slug)).toMatchObject({ venueSlug: hall.slug, category: 'music' });
    expect((await publicEventsAtVenue(hall.slug)).map((x) => x.slug)).toContain(e.slug);
    // Unlisted events are not advertised on the venue page.
    await executeCommand(updateEventCommand, { eventId: e.id, visibility: 'unlisted' }, a.ctx(), ports);
    expect((await publicEventsAtVenue(hall.slug)).map((x) => x.slug)).not.toContain(e.slug);
  });

  it('archiving a venue unlists it and it can no longer be picked', async () => {
    const old = await venue({ name: `Old Barn ${a.org.slug}`, directoryListed: true });
    const archived = await executeCommand(
      setVenueArchivedCommand,
      { venueId: old.id, archived: true },
      a.ctx(),
      ports,
    );
    expect(archived).toMatchObject({ directoryListed: false });
    expect(await publicVenue(old.slug)).toBeNull();
    expect((await executeQuery(listVenuesQuery, {}, a.ctx(), ports)).map((v) => v.id)).not.toContain(old.id);
    await expect(
      executeCommand(setEventDetailsCommand, { eventId: a.event.id, venueId: old.id }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('tags filter the console list case-insensitively; categories filter too', async () => {
    const e = await executeCommand(
      createEventCommand,
      {
        name: `Tagged ${a.org.slug}`,
        timezone: 'UTC',
        startsAt: '2030-07-01T18:00:00Z',
        endsAt: '2030-07-01T20:00:00Z',
      },
      a.ctx(),
      ports,
    );
    await executeCommand(
      setEventDetailsCommand,
      { eventId: e.id, category: 'technology', tags: ['Workshop'] },
      a.ctx(),
      ports,
    );
    const byTag = await executeQuery(searchEventsQuery, { tag: 'WORKSHOP' }, a.ctx(), ports);
    expect(byTag.map((x) => x.id)).toEqual([e.id]);
    expect(byTag[0]?.tags).toEqual(['Workshop']);
    const byCat = await executeQuery(searchEventsQuery, { category: 'technology' }, a.ctx(), ports);
    expect(byCat.map((x) => x.id)).toEqual([e.id]);
    expect(
      await executeQuery(searchEventsQuery, { category: 'music', tag: 'workshop' }, a.ctx(), ports),
    ).toEqual([]);
    expect((await executeQuery(orgTagsQuery, {}, a.ctx(), ports)).map((t) => t.key)).toContain('workshop');
    // Design v2 org home: a case-insensitive name search; LIKE wildcards match literally.
    const byName = await executeQuery(searchEventsQuery, { q: 'tAGGED' }, a.ctx(), ports);
    expect(byName.map((x) => x.id)).toEqual([e.id]);
    expect(await executeQuery(searchEventsQuery, { q: 'Tag%ed' }, a.ctx(), ports)).toEqual([]);
    expect(await executeQuery(searchEventsQuery, { q: 'Tagge_' }, a.ctx(), ports)).toEqual([]);
    expect(await executeQuery(searchEventsQuery, { q: 'tagged' }, b.ctx(), ports)).toEqual([]);
    // Org B sees none of org A's tags or events.
    expect(await executeQuery(searchEventsQuery, { tag: 'workshop' }, b.ctx(), ports)).toEqual([]);
    await expect(
      executeCommand(setEventDetailsCommand, { eventId: e.id, tags: ['x'] }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(
        setEventDetailsCommand,
        { eventId: e.id, tags: ['x'] },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        setEventDetailsCommand,
        { eventId: e.id, tags: Array.from({ length: 11 }, (_, i) => `t${i}`) },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'too_many_tags' } });
  });
});

describe('quote requests (M1.4c)', () => {
  it('stores a request for the organizer; viewers and other orgs cannot read it', async () => {
    await quote(hall.id, { phone: '+1 555 0100', guests: 150, eventDate: '2030-09-12' });
    const inbox = await executeQuery(listQuoteRequestsQuery, { venueId: hall.id }, a.ctx(), ports);
    expect(inbox[0]).toMatchObject({ name: 'Riley Planner', guests: 150, status: 'new' });
    await expect(
      executeQuery(listQuoteRequestsQuery, {}, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(
      (await executeQuery(listQuoteRequestsQuery, {}, b.ctx(), ports)).map((q) => q.venueId),
    ).not.toContain(hall.id);
    const id = inbox[0]?.id ?? '';
    await executeCommand(
      setQuoteRequestStatusCommand,
      { quoteRequestId: id, status: 'handled' },
      a.ctx(),
      ports,
    );
    await expect(
      executeCommand(setQuoteRequestStatusCommand, { quoteRequestId: id, status: 'new' }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses unlisted venues, bad input, and a venue id sent to another org', async () => {
    const unlisted = await venue({ name: `Private Room ${a.org.slug}` });
    await expect(quote(unlisted.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(quote(hall.id, { email: 'not-an-email' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(quote(hall.id, { message: 'short' })).rejects.toMatchObject({ code: 'validation_failed' });
    // The org comes from the venue slug server-side; a forged pairing finds nothing.
    await expect(quote(hall.id, {}, b.org.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rate-limits per sender and per email', async () => {
    const clientKey = `flood-${Date.now()}-abcdefgh`;
    for (let i = 0; i < QUOTES_PER_HOUR; i++) await quote(hall.id, { clientKey });
    await expect(quote(hall.id, { clientKey })).rejects.toMatchObject({ code: 'rate_limited' });
    const email = `same-${Date.now()}@example.test`;
    for (let i = 0; i < QUOTES_PER_HOUR; i++) await quote(hall.id, { email });
    await expect(quote(hall.id, { email: email.toUpperCase() })).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });
});
