import { randomBytes } from 'node:crypto';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  addOccurrencesCommand,
  addSectionCommand,
  cancelOccurrenceCommand,
  createAnnouncementCommand,
  createEventCommand,
  setEventDetailsCommand,
  setPrivateInfoCommand,
  transitionEventCommand,
  updateSectionCommand,
} from '@yayatoh/events';
import { executeCommand } from '@yayatoh/kernel';
import { uploadMedia } from '@yayatoh/media';
import { testPng } from '@yayatoh/media/testing';
import { fakePaymentProvider } from '@yayatoh/payments';
import {
  createExhibitorCommand,
  createRoomCommand,
  createSessionCommand,
  createSpeakerCommand,
  createSponsorCommand,
  createSponsorTierCommand,
  createTrackCommand,
} from '@yayatoh/program';
import { createApiKeyCommand, listApiKeysQuery } from '@yayatoh/tenancy';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '@yayatoh/testing';
import { createVenueCommand, setVenueArchivedCommand } from '@yayatoh/venues';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createV1, deprecations, memoryRateLimiter, type V1Deps } from '../src/index.ts';

const secret = randomBytes(32).toString('hex');
const payments = fakePaymentProvider({ secret, appOrigin: 'http://localhost:3000' });
const deps: V1Deps = { ports, payments: () => payments, telemetry: false };
const suffix = randomBytes(4).toString('hex');
const PRIVATE_INFO = `PRIVATE-CANARY-${suffix}`;
const JOIN_URL = `https://join.example.test/${suffix}`;

function mount(overrides: Partial<V1Deps> = {}) {
  const app = new Hono();
  const v1 = createV1({ ...deps, rateLimiter: memoryRateLimiter(), ...overrides });
  app.route('/v1', v1);
  return { app, v1 };
}
let app = mount().app;

type Json = Record<string, unknown>;
type Res = { status: number; body: Json; headers: Headers; text: string };
async function get(path: string, token?: string, headers: Record<string, string> = {}): Promise<Res> {
  const res = await app.request(`http://api.test/v1${path}`, {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Json, headers: res.headers, text };
}
const data = (r: Res) => r.body.data as Json[];

let a: OrgFixture;
let b: OrgFixture;
let slug: string;
let eventId: string;
let privateSlug: string;
let privateEventId: string;
let draftSlug: string;
let unlistedSlug: string;
let venueSlug: string;
let hiddenVenueSlug: string;
let venueId: string;
let archivedVenueId: string;
let dates: { id: string }[];
const speakerIds: Record<string, string> = {};

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const ctx = a.ctx();
  const venue = await executeCommand(
    createVenueCommand,
    { name: `Aaa API Hall ${suffix}`, country: 'US', timezone: 'America/Chicago', directoryListed: true },
    ctx,
    ports,
  );
  venueSlug = venue.slug;
  venueId = venue.id;
  const hidden = await executeCommand(
    createVenueCommand,
    { name: `Hidden Hall ${suffix}`, country: 'US', timezone: 'America/Chicago', directoryListed: false },
    ctx,
    ports,
  );
  hiddenVenueSlug = hidden.slug;
  const archived = await executeCommand(
    createVenueCommand,
    { name: `Old Barn ${suffix}`, country: 'US', timezone: 'America/Chicago', directoryListed: true },
    ctx,
    ports,
  );
  archivedVenueId = archived.id;
  await executeCommand(setVenueArchivedCommand, { venueId: archived.id, archived: true }, ctx, ports);

  // A published conference over three dates (one cancelled), in Chicago (UTC−5 in October).
  const e = await executeCommand(
    createEventCommand,
    {
      name: `Content Summit ${suffix}`,
      profile: 'conference',
      timezone: 'America/Chicago',
      startsAt: '2029-10-10T14:00:00Z',
      endsAt: '2029-10-13T04:00:00Z',
    },
    ctx,
    ports,
  );
  eventId = e.id;
  slug = e.slug;
  await executeCommand(setEventDetailsCommand, { eventId, venueId, category: 'technology' }, ctx, ports);
  dates = await executeCommand(
    addOccurrencesCommand,
    {
      eventId,
      dates: [
        { startsAt: '2029-10-10T14:00:00Z', endsAt: '2029-10-11T04:30:00Z', capacity: 150 },
        { startsAt: '2029-10-11T14:00:00Z', endsAt: '2029-10-12T04:00:00Z' },
        { startsAt: '2029-10-12T14:00:00Z', endsAt: '2029-10-13T04:00:00Z' },
      ],
    },
    ctx,
    ports,
  );
  await executeCommand(cancelOccurrenceCommand, { occurrenceId: dates[2]?.id as string }, ctx, ports);
  for (const [title, kind, content] of [
    ['About', 'text', { markdown: 'Two days of *talks*.' }],
    ['Questions', 'faq', { items: [{ question: 'Parking?', answer: 'Yes, free.' }] }],
    ['Hidden links', 'links', { items: [{ label: 'Draft', url: 'https://draft.example.test' }] }],
  ] as const) {
    const s = await executeCommand(addSectionCommand, { eventId, title, kind, content } as never, ctx, ports);
    if (title === 'Hidden links')
      await executeCommand(updateSectionCommand, { eventId, sectionId: s.id, visible: false }, ctx, ports);
  }
  for (const x of [
    { title: 'Doors open at nine', audience: 'public', pinned: false, publish: true },
    { title: 'Parking update', audience: 'public', pinned: true, publish: true },
    { title: 'Holders only secret', audience: 'holders', pinned: false, publish: true },
    { title: 'Draft notice', audience: 'public', pinned: false, publish: false },
  ] as const)
    await executeCommand(createAnnouncementCommand, { eventId, body: 'Details inside.', ...x }, ctx, ports);
  await executeCommand(setPrivateInfoCommand, { eventId, body: PRIVATE_INFO, joinUrl: JOIN_URL }, ctx, ports);

  const track = await executeCommand(createTrackCommand, { eventId, name: 'Main track' }, ctx, ports);
  const room = await executeCommand(
    createRoomCommand,
    { eventId, name: 'Hall A', capacity: 321 },
    ctx,
    ports,
  );
  for (const name of ['Zed Zulu', 'amy Adams', 'Bob Brown']) {
    const s = await executeCommand(
      createSpeakerCommand,
      { eventId, name, bio: `About ${name}.` },
      ctx,
      ports,
    );
    speakerIds[name] = s.id;
  }
  const session = (title: string, startsAt: string, endsAt: string, extra: Json = {}) =>
    executeCommand(createSessionCommand, { eventId, title, startsAt, endsAt, ...extra } as never, ctx, ports);
  await session('Opening', '2029-10-10T15:00:00Z', '2029-10-10T16:00:00Z', {
    occurrenceId: dates[0]?.id,
    roomId: room.id,
    trackId: track.id,
    capacity: 99,
    speakerIds: [speakerIds['Zed Zulu'], speakerIds['amy Adams']],
  });
  // 22:30 in Chicago on the 10th is 03:30 UTC on the 11th: it belongs to the 10th.
  await session('Late jam', '2029-10-11T03:30:00Z', '2029-10-11T04:00:00Z', { occurrenceId: dates[0]?.id });
  await session('Day two keynote', '2029-10-11T15:00:00Z', '2029-10-11T16:00:00Z', {
    occurrenceId: dates[1]?.id,
    speakerIds: [speakerIds['amy Adams']],
  });
  await session('Anytime lounge', '2029-10-11T18:00:00Z', '2029-10-11T19:00:00Z');
  for (const name of ['Widgets Inc', 'acme Tools', 'Mango Labs'])
    await executeCommand(createExhibitorCommand, { eventId, name, boothLabel: name.slice(0, 2) }, ctx, ports);
  const gold = await executeCommand(
    createSponsorTierCommand,
    { eventId, name: 'Gold', position: 1 },
    ctx,
    ports,
  );
  await executeCommand(createSponsorTierCommand, { eventId, name: 'Silver', position: 2 }, ctx, ports);
  await executeCommand(createSponsorCommand, { eventId, tierId: gold.id, name: 'Big Sponsor' }, ctx, ports);
  const file = await testPng(64, 48);
  await uploadMedia(
    ctx,
    { ownerType: 'event', ownerId: eventId, slot: 'cover', alt: 'Main stage', file },
    ports,
  );
  await uploadMedia(
    ctx,
    { ownerType: 'event', ownerId: eventId, slot: 'gallery', decorative: true, file: await testPng(40, 40) },
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, ctx, ports);

  // A private (published) event, a draft and an unlisted one.
  const priv = await executeCommand(
    createEventCommand,
    {
      name: `Secret retreat ${suffix}`,
      visibility: 'private',
      timezone: 'UTC',
      startsAt: '2029-11-01T10:00:00Z',
      endsAt: '2029-11-01T18:00:00Z',
    },
    ctx,
    ports,
  );
  privateSlug = priv.slug;
  privateEventId = priv.id;
  await executeCommand(
    addSectionCommand,
    { eventId: priv.id, title: 'Secret plans', kind: 'text', content: { markdown: 'Shh.' } },
    ctx,
    ports,
  );
  await executeCommand(createSpeakerCommand, { eventId: priv.id, name: 'Secret Speaker' }, ctx, ports);
  await uploadMedia(
    ctx,
    { ownerType: 'event', ownerId: priv.id, slot: 'cover', alt: 'Secret cover', file: await testPng(32, 32) },
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: priv.id, transition: 'publish' }, ctx, ports);
  const draft = await executeCommand(
    createEventCommand,
    {
      name: `Draft gala ${suffix}`,
      timezone: 'UTC',
      startsAt: '2029-12-01T10:00:00Z',
      endsAt: '2029-12-01T18:00:00Z',
    },
    ctx,
    ports,
  );
  draftSlug = draft.slug;
  await executeCommand(
    addSectionCommand,
    { eventId: draft.id, title: 'Draft plans', kind: 'text', content: { markdown: 'Soon.' } },
    ctx,
    ports,
  );
  const unlisted = await executeCommand(
    createEventCommand,
    {
      name: `Unlisted meetup ${suffix}`,
      visibility: 'unlisted',
      timezone: 'UTC',
      startsAt: '2029-12-02T10:00:00Z',
      endsAt: '2029-12-02T18:00:00Z',
    },
    ctx,
    ports,
  );
  unlistedSlug = unlisted.slug;
  await executeCommand(
    addSectionCommand,
    { eventId: unlisted.id, title: 'Unlisted plans', kind: 'text', content: { markdown: 'Welcome.' } },
    ctx,
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: unlisted.id, transition: 'publish' }, ctx, ports);
});
afterAll(closePools);

const PUBLIC_EVENT_PATHS = [
  '',
  '/sections',
  '/announcements',
  '/dates',
  '/agenda',
  '/speakers',
  '/exhibitors',
  '/sponsors',
  '/images',
  '/ticket-types',
];

describe('/v1 public content (no credential)', () => {
  it('serves visible sections in page order through the allowlist, with ETag and a 304', async () => {
    const r = await get(`/public/events/${slug}/sections`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('public, max-age=60');
    expect(data(r).map((s) => s.title)).toEqual(['About', 'Questions']);
    expect(data(r)[0]).toEqual({
      id: expect.any(String),
      title: 'About',
      kind: 'text',
      content: { markdown: 'Two days of *talks*.' },
    });
    expect(data(r)[1]?.content).toEqual({ items: [{ question: 'Parking?', answer: 'Yes, free.' }] });
    const etag = r.headers.get('etag') as string;
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{32}"$/);
    const again = await get(`/public/events/${slug}/sections`, undefined, { 'if-none-match': etag });
    expect(again.status).toBe(304);
    expect(again.text).toBe('');
    expect(again.headers.get('etag')).toBe(etag);
    expect(
      (await get(`/public/events/${slug}/sections`, undefined, { 'if-none-match': `W/${etag}` })).status,
    ).toBe(304);
    expect(
      (await get(`/public/events/${slug}/sections`, undefined, { 'if-none-match': '"other"' })).status,
    ).toBe(200);
  });

  it('lists public, published announcements only: pinned first, then newest; pages by cursor', async () => {
    const all = await get(`/public/events/${slug}/announcements`);
    expect(data(all).map((x) => x.title)).toEqual(['Parking update', 'Doors open at nine']);
    expect(Object.keys(data(all)[0] ?? {}).sort()).toEqual(['body', 'id', 'pinned', 'publishedAt', 'title']);
    const p1 = await get(`/public/events/${slug}/announcements?limit=1`);
    expect(data(p1).map((x) => x.title)).toEqual(['Parking update']);
    const p2 = await get(`/public/events/${slug}/announcements?limit=1&cursor=${p1.body.nextCursor}`);
    expect(data(p2).map((x) => x.title)).toEqual(['Doors open at nine']);
    expect(p2.body.nextCursor).toBeNull();
    expect((await get(`/public/events/${slug}/announcements?cursor=nonsense`)).status).toBe(400);
    expect((await get(`/public/events/${slug}/announcements?limit=101`)).status).toBe(400);
  });

  it('lists dates in order with status and soldOut, never capacity', async () => {
    const r = await get(`/public/events/${slug}/dates`);
    expect(data(r).map((d) => d.status)).toEqual(['scheduled', 'scheduled', 'cancelled']);
    expect(Object.keys(data(r)[0] ?? {}).sort()).toEqual(['endsAt', 'id', 'soldOut', 'startsAt', 'status']);
    expect(r.text).not.toContain('capacity');
    const pages: Json[] = [];
    let cursor: unknown = null;
    do {
      const p = await get(`/public/events/${slug}/dates?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      pages.push(...data(p));
      cursor = p.body.nextCursor;
    } while (cursor);
    expect(pages.map((d) => d.id)).toEqual(data(r).map((d) => d.id));
  });

  it('groups the agenda by day in the event timezone, with track, room and speakers', async () => {
    const r = await get(`/public/events/${slug}/agenda`);
    expect(r.status).toBe(200);
    expect(r.body.timezone).toBe('America/Chicago');
    const days = r.body.days as { date: string; sessions: Json[] }[];
    expect(days.map((d) => [d.date, d.sessions.map((s) => s.title)])).toEqual([
      ['2029-10-10', ['Opening', 'Late jam']],
      ['2029-10-11', ['Day two keynote', 'Anytime lounge']],
    ]);
    const opening = days[0]?.sessions[0] as Json;
    expect(opening).toMatchObject({ track: 'Main track', room: 'Hall A', dateId: dates[0]?.id });
    expect((opening.speakers as Json[]).map((s) => s.name).sort()).toEqual(['Zed Zulu', 'amy Adams']);
    expect(r.text).not.toContain('capacity');
    expect(r.text).not.toContain('"321"');
    // A chosen date keeps its own sessions and the ones on no date.
    const d1 = await get(`/public/events/${slug}/agenda?dateId=${dates[0]?.id}`);
    expect((d1.body.days as { sessions: Json[] }[]).flatMap((d) => d.sessions.map((s) => s.title))).toEqual([
      'Opening',
      'Late jam',
      'Anytime lounge',
    ]);
    expect((await get(`/public/events/${slug}/agenda?dateId=nope`)).status).toBe(400);
  });

  it('pages speakers by name (case-insensitive) and serves one speaker with their sessions', async () => {
    const all = await get(`/public/events/${slug}/speakers`);
    expect(data(all).map((s) => s.name)).toEqual(['amy Adams', 'Bob Brown', 'Zed Zulu']);
    const p1 = await get(`/public/events/${slug}/speakers?limit=2`);
    const p2 = await get(`/public/events/${slug}/speakers?limit=2&cursor=${p1.body.nextCursor}`);
    expect([...data(p1), ...data(p2)].map((s) => s.name)).toEqual(['amy Adams', 'Bob Brown', 'Zed Zulu']);
    const one = await get(`/public/events/${slug}/speakers/${speakerIds['amy Adams']}`);
    expect((one.body.speaker as Json).name).toBe('amy Adams');
    expect((one.body.sessions as Json[]).map((s) => s.title)).toEqual(['Opening', 'Day two keynote']);
    expect((await get(`/public/events/${slug}/speakers/${a.ownerId}`)).status).toBe(404);
    // Another event's speaker is not this event's.
    const other = await get(`/public/events/${a.event.slug}/speakers`);
    const foreign = data(other)[0]?.id as string;
    expect((await get(`/public/events/${slug}/speakers/${foreign}`)).status).toBe(404);
  });

  it('lists exhibitors by name and sponsors by tier (empty tiers left out)', async () => {
    const ex = await get(`/public/events/${slug}/exhibitors`);
    expect(data(ex).map((x) => x.name)).toEqual(['acme Tools', 'Mango Labs', 'Widgets Inc']);
    const sp = await get(`/public/events/${slug}/sponsors`);
    expect(data(sp)).toEqual([
      {
        name: 'Gold',
        sponsors: [
          { id: expect.any(String), name: 'Big Sponsor', description: '', websiteUrl: null, image: null },
        ],
      },
    ]);
  });

  it('serves images with absolute, content-hashed URLs: cover, gallery and the organizer logo', async () => {
    const r = await get(`/public/events/${slug}/images`);
    const slots = data(r).map((i) => i.slot);
    expect(slots).toEqual(expect.arrayContaining(['cover', 'gallery', 'logo']));
    const cover = data(r).find((i) => i.slot === 'cover') as Json;
    expect(cover.alt).toBe('Main stage');
    expect(data(r).find((i) => i.slot === 'gallery')).toMatchObject({ decorative: true, alt: '' });
    for (const v of cover.variants as Json[])
      expect(v.url).toMatch(
        new RegExp(
          `^http://api\\.test/media/${a.org.id}/[0-9a-f-]{36}/\\d+-[0-9a-f]{32}\\.(avif|webp|jpg|png)$`,
        ),
      );
    expect(r.text).not.toMatch(/"bytes"|"sourceType"|"uploadedBy"|"ownerId"/);
    // apps/api hands out the web origin, which serves /media.
    app = mount({ publicOrigin: 'https://app.example.test/' }).app;
    const abs = await get(`/public/events/${slug}/images`);
    const firstUrl = String(((data(abs)[0]?.variants ?? []) as Json[])[0]?.url);
    expect(firstUrl.startsWith('https://app.example.test/media/')).toBe(true);
    app = mount().app;
  });

  it('serves the venue directory and a listed venue with photos and upcoming public events', async () => {
    const dir = await get('/public/venues?limit=100');
    const names = data(dir).map((v) => v.name);
    expect(names).toContain(`Aaa API Hall ${suffix}`);
    expect(names).not.toContain(`Hidden Hall ${suffix}`);
    expect(names).not.toContain(`Old Barn ${suffix}`);
    expect(Object.keys(data(dir)[0] ?? {}).sort()).toEqual([
      'capacity',
      'city',
      'country',
      'name',
      'region',
      'slug',
    ]);
    const v = await get(`/public/venues/${venueSlug}`);
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ slug: venueSlug, country: 'US', photos: [] });
    expect((v.body.upcomingEvents as Json[]).map((e) => e.slug)).toContain(slug);
    expect(v.body).not.toHaveProperty('id');
    expect(v.body).not.toHaveProperty('directoryListed');
    expect((await get(`/public/venues/${hiddenVenueSlug}`)).status).toBe(404);
    expect((await get('/public/venues/no-such-venue')).status).toBe(404);
    // The public event names its directory venue.
    expect((await get(`/public/events/${slug}`)).body).toMatchObject({
      venueSlug,
      category: 'technology',
      attendanceMode: 'in_person',
    });
  });

  it('serves unlisted events (link holders) like public ones', async () => {
    const r = await get(`/public/events/${unlistedSlug}/sections`);
    expect(data(r).map((s) => s.title)).toEqual(['Unlisted plans']);
  });

  it('canary: private events and drafts are 404 everywhere; private data never leaves', async () => {
    for (const s of [privateSlug, draftSlug, 'no-such-event'])
      for (const p of PUBLIC_EVENT_PATHS) {
        const r = await get(`/public/events/${s}${p}`);
        expect(r.status, `${s}${p}`).toBe(404);
        expect(r.headers.get('content-type')).toContain('application/problem+json');
      }
    expect((await get(`/public/events/${privateSlug}/speakers/${speakerIds['amy Adams']}`)).status).toBe(404);
    const everything = (
      await Promise.all([
        ...PUBLIC_EVENT_PATHS.map((p) => get(`/public/events/${slug}${p}`)),
        get(`/public/venues/${venueSlug}`),
        get('/public/venues?limit=100'),
        get(`/public/events/${slug}/speakers/${speakerIds['amy Adams']}`),
      ])
    )
      .map((r) => r.text)
      .join('\n');
    for (const secret of [
      PRIVATE_INFO,
      JOIN_URL,
      'Holders only secret',
      'Draft notice',
      'Hidden links',
      'draft.example.test',
      'Secret retreat',
      'Secret plans',
      'Secret Speaker',
      'Secret cover',
      'Draft plans',
      privateEventId,
      'Old Barn',
      'Hidden Hall',
      'Quote',
      'quantitySold',
    ])
      expect(everything, secret).not.toContain(secret);
  });
});

describe('/v1 org content (API key, events:read)', () => {
  it('shows the organizer everything: hidden sections, drafts and holders-only, capacities', async () => {
    const s = await get(`/orgs/${a.org.slug}/events/${eventId}/sections`, a.apiKey);
    expect(s.status).toBe(200);
    expect(s.headers.get('cache-control')).toBe('private, no-cache');
    expect(data(s).map((x) => [x.title, x.visible, x.position])).toEqual([
      ['About', true, 0],
      ['Questions', true, 1],
      ['Hidden links', false, 2],
    ]);
    const an = await get(`/orgs/${a.org.slug}/events/${eventId}/announcements`, a.apiKey);
    expect(data(an).map((x) => x.title)).toEqual([
      'Draft notice',
      'Holders only secret',
      'Parking update',
      'Doors open at nine',
    ]);
    expect(data(an)[0]).toMatchObject({ publishedAt: null, audience: 'public', eventId });
    const p1 = await get(`/orgs/${a.org.slug}/events/${eventId}/announcements?limit=3`, a.apiKey);
    const p2 = await get(
      `/orgs/${a.org.slug}/events/${eventId}/announcements?limit=3&cursor=${p1.body.nextCursor}`,
      a.apiKey,
    );
    expect([...data(p1), ...data(p2)].map((x) => x.id)).toEqual(data(an).map((x) => x.id));
    const d = await get(`/orgs/${a.org.slug}/events/${eventId}/dates`, a.apiKey);
    expect(data(d).map((x) => [x.capacity, x.status])).toEqual([
      [150, 'scheduled'],
      [null, 'scheduled'],
      [null, 'cancelled'],
    ]);
    const ag = await get(`/orgs/${a.org.slug}/events/${eventId}/agenda`, a.apiKey);
    expect(ag.body.rooms).toEqual([{ id: expect.any(String), name: 'Hall A', capacity: 321 }]);
    expect(ag.body.tracks).toEqual([{ id: expect.any(String), name: 'Main track' }]);
    const first = (ag.body.days as { date: string; sessions: Json[] }[])[0];
    expect(first?.date).toBe('2029-10-10');
    expect(first?.sessions[0]).toMatchObject({ title: 'Opening', capacity: 99, dateId: dates[0]?.id });
    expect(first?.sessions[0]?.speakerIds).toHaveLength(2);
    const sp = await get(`/orgs/${a.org.slug}/events/${eventId}/sponsors`, a.apiKey);
    expect(data(sp).map((t) => [t.name, t.position, (t.sponsors as Json[]).length])).toEqual([
      ['Gold', 1, 1],
      ['Silver', 2, 0],
    ]);
    const one = await get(
      `/orgs/${a.org.slug}/events/${eventId}/speakers/${speakerIds['Zed Zulu']}`,
      a.apiKey,
    );
    expect((one.body.sessions as Json[]).map((x) => [x.title, x.room, x.track])).toEqual([
      ['Opening', 'Hall A', 'Main track'],
    ]);
    expect(data(await get(`/orgs/${a.org.slug}/events/${eventId}/speakers`, a.apiKey)).length).toBe(3);
    expect(data(await get(`/orgs/${a.org.slug}/events/${eventId}/exhibitors`, a.apiKey)).length).toBe(3);
    // Private events are the organizer's own data.
    const priv = await get(`/orgs/${a.org.slug}/events/${privateEventId}/sections`, a.apiKey);
    expect(data(priv).map((x) => x.title)).toEqual(['Secret plans']);
    // Private info is not part of any /v1 read.
    expect(JSON.stringify([s.body, an.body, ag.body])).not.toContain(PRIVATE_INFO);
  });

  it('lists the org’s venues (archived included) and reads one', async () => {
    const all: Json[] = [];
    let cursor: unknown = null;
    do {
      const p = await get(`/orgs/${a.org.slug}/venues?limit=2${cursor ? `&cursor=${cursor}` : ''}`, a.apiKey);
      all.push(...data(p));
      cursor = p.body.nextCursor;
    } while (cursor);
    expect(new Set(all.map((v) => v.id)).size).toBe(all.length);
    expect(all.find((v) => v.id === archivedVenueId)?.archivedAt).toEqual(expect.any(String));
    expect(all.find((v) => v.slug === hiddenVenueSlug)?.directoryListed).toBe(false);
    const one = await get(`/orgs/${a.org.slug}/venues/${venueId}`, a.apiKey);
    expect(one.body).toMatchObject({ id: venueId, slug: venueSlug, directoryListed: true });
  });

  it('isolation: another org’s key, event or venue is a 404; no credential is a 401', async () => {
    const paths = ['sections', 'announcements', 'dates', 'agenda', 'speakers', 'exhibitors', 'sponsors'];
    for (const p of paths) {
      expect((await get(`/orgs/${a.org.slug}/events/${eventId}/${p}`, b.apiKey)).status, p).toBe(404);
      expect((await get(`/orgs/${b.org.slug}/events/${eventId}/${p}`, b.apiKey)).status, p).toBe(404);
      expect((await get(`/orgs/${a.org.slug}/events/${b.event.id}/${p}`, a.apiKey)).status, p).toBe(404);
      expect((await get(`/orgs/${a.org.slug}/events/${eventId}/${p}`)).status, p).toBe(401);
    }
    expect((await get(`/orgs/${a.org.slug}/venues/${venueId}`, b.apiKey)).status).toBe(404);
    const bVenues = data(await get(`/orgs/${b.org.slug}/venues?limit=100`, b.apiKey));
    expect(bVenues.map((v) => v.id)).not.toContain(venueId);
    const bVenue = bVenues[0]?.id as string;
    expect((await get(`/orgs/${a.org.slug}/venues/${bVenue}`, a.apiKey)).status).toBe(404);
  });

  it('needs events:read: an org:read-only key gets 403', async () => {
    const { key } = await executeCommand(
      createApiKeyCommand,
      { name: 'Org only', scopes: ['org:read'] },
      a.ctx(),
      ports,
    );
    expect((await get(`/orgs/${a.org.slug}`, key)).status).toBe(200);
    for (const p of [`/events/${eventId}/agenda`, `/events/${eventId}/sections`, '/venues'])
      expect((await get(`/orgs/${a.org.slug}${p}`, key)).status, p).toBe(403);
  });
});

describe('/v1 test keys (yy_test_)', () => {
  it('reads org and event content, but never personal data, and never writes', async () => {
    expect(a.testKey).toMatch(/^yy_test_[A-Za-z0-9_-]{43}$/);
    const org = await get(`/orgs/${a.org.slug}`, a.testKey);
    expect(org.status).toBe(200);
    expect(org.headers.get('ratelimit-limit')).toBe('120');
    expect((await get(`/orgs/${a.org.slug}/events/${eventId}/agenda`, a.testKey)).status).toBe(200);
    expect((await get(`/orgs/${a.org.slug}/events`, a.testKey)).status).toBe(200);
    for (const p of [
      `/events/${a.event.id}/orders`,
      `/events/${a.event.id}/attendees`,
      '/attendees/search?q=fix',
    ])
      expect((await get(`/orgs/${a.org.slug}${p}`, a.testKey)).status, p).toBe(403);
    const write = await app.request(`/v1/orgs/${a.org.slug}/events`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${a.testKey}`,
        'content-type': 'application/json',
        'idempotency-key': `test-${suffix}-write`,
      },
      body: JSON.stringify({
        name: 'Nope',
        timezone: 'UTC',
        startsAt: '2030-01-01T10:00:00Z',
        endsAt: '2030-01-01T11:00:00Z',
      }),
    });
    expect(write.status).toBe(403);
    // Another org's test key reaches nothing here.
    expect((await get(`/orgs/${a.org.slug}/events/${eventId}/agenda`, b.testKey)).status).toBe(404);
  });

  it('the prefix is part of the secret: a test key relabelled live (or back) is unknown', async () => {
    const live = a.testKey.replace(/^yy_test_/, 'yy_live_');
    expect((await get(`/orgs/${a.org.slug}`, live)).status).toBe(401);
    const test = a.apiKey.replace(/^yy_live_/, 'yy_test_');
    expect((await get(`/orgs/${a.org.slug}`, test)).status).toBe(401);
  });

  it('is created only with read-only, non-personal scopes and is listed as a test key', async () => {
    await expect(
      executeCommand(
        createApiKeyCommand,
        { name: 'Bad test', scopes: ['events:read', 'orders:read'], mode: 'test' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'test_key_scope', scopes: ['orders:read'], issues: [{ path: 'scopes' }] },
    });
    const k = await executeCommand(
      createApiKeyCommand,
      { name: 'Good test', scopes: ['events:read'], mode: 'test' },
      a.ctx(),
      ports,
    );
    expect(k.key.startsWith('yy_test_')).toBe(true);
    expect(k.prefix).toBe(k.key.slice(0, 12));
    expect(k.sandbox).toBe(true);
    const { executeQuery } = await import('@yayatoh/kernel');
    const listed = await executeQuery(listApiKeysQuery, {}, a.ctx(), ports);
    expect(listed.find((x) => x.id === k.id)?.sandbox).toBe(true);
    expect(listed.find((x) => x.name === `Fixture ${a.org.slug}`)?.sandbox).toBe(false);
  });

  it('the table refuses a test key with write or personal scopes, or a live key flagged sandbox', async () => {
    const insert = (prefix: string, sandbox: boolean, scopes: string) =>
      withTenant(systemCtx(a.org.id), (tx) =>
        tx.execute(sql`insert into tenancy.api_keys (org_id, name, prefix, key_hash, scopes, sandbox)
          values (${a.org.id}, 'raw', ${prefix}, ${randomBytes(32).toString('hex')}, ${scopes}::text[], ${sandbox})`),
      );
    await expect(insert('yy_test_AbC1', true, '{events:write}')).rejects.toThrow();
    await expect(insert('yy_test_AbC1', true, '{attendees:read}')).rejects.toThrow();
    await expect(insert('yy_live_AbC1', true, '{events:read}')).rejects.toThrow();
    await expect(insert('yy_test_AbC1', false, '{events:read}')).rejects.toThrow();
  });
});

describe('/v1 deprecations', () => {
  it('no /v1 route is deprecated yet, and no response carries the headers', async () => {
    const { v1 } = mount();
    expect(deprecations(v1 as never).size).toBe(0);
    const r = await get(`/public/events/${slug}/agenda`);
    expect(r.headers.get('deprecation')).toBeNull();
    expect(r.headers.get('sunset')).toBeNull();
  });
});
