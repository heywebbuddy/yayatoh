import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { DomainError } from '@yayatoh/kernel';
import { describe, expect, it } from 'vitest';
import { cachedJson, etagOf } from '../src/caching.ts';
import { nameKey, newestFirst, pageByKey } from '../src/cursor.ts';
import { deprecated, deprecationHeaders, deprecationMiddleware, deprecations } from '../src/deprecation.ts';
import {
  Agenda,
  Announcement,
  DirectoryVenue,
  EventDate,
  EventSection,
  Image,
  PublicAgenda,
  PublicAnnouncement,
  PublicEventDate,
  PublicEventSection,
  PublicSponsorTier,
  PublicVenue,
  Speaker,
  toWire,
  Venue,
} from '../src/resources.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2029-10-10T15:00:00.000Z';

describe('pageByKey (keyset pages over short lists)', () => {
  const rows = ['delta', 'Alpha', 'charlie', 'bravo', 'echo'].map((name, i) => ({ id: id(i + 1), name }));
  const key = (r: { id: string; name: string }) => [nameKey(r.name), r.id] as const;

  it('orders by key then id and walks every row once, in order', () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const p = pageByKey(rows, 2, cursor, key);
      seen.push(...p.data.map((r) => r.name));
      if (!p.nextCursor) break;
      cursor = p.nextCursor;
    }
    expect(seen).toEqual(['Alpha', 'bravo', 'charlie', 'delta', 'echo']);
  });

  it('is stable when a row is removed or added between pages', () => {
    const p1 = pageByKey(rows, 2, undefined, key);
    const next = rows.filter((r) => r.name !== 'bravo').concat({ id: id(9), name: 'aardvark' });
    const p2 = pageByKey(next, 10, p1.nextCursor ?? undefined, key);
    expect(p2.data.map((r) => r.name)).toEqual(['charlie', 'delta', 'echo']);
    expect(p2.nextCursor).toBeNull();
  });

  it('breaks ties by id and ends with a null cursor', () => {
    const same = [
      { id: id(3), name: 'Same' },
      { id: id(1), name: 'same' },
    ];
    const p = pageByKey(same, 1, undefined, key);
    expect(p.data[0]?.id).toBe(id(1));
    expect(pageByKey(same, 1, p.nextCursor ?? undefined, key).data[0]?.id).toBe(id(3));
    expect(pageByKey(same, 5, undefined, key).nextCursor).toBeNull();
  });

  it('refuses a cursor it did not make (400 validation_failed)', () => {
    for (const bad of [
      'nope',
      Buffer.from('[1,2]').toString('base64url'),
      Buffer.from('["a","../x"]').toString('base64url'),
    ])
      expect(() => pageByKey(rows, 2, bad, key)).toThrow(DomainError);
  });

  it('newestFirst sorts newer instants first as ascending strings', () => {
    const older = newestFirst(new Date('2020-01-01T00:00:00Z'));
    const newer = newestFirst(new Date('2029-01-01T00:00:00Z'));
    expect(newer < older).toBe(true);
    expect(nameKey('É'.repeat(100))).toHaveLength(60);
  });
});

describe('cachedJson (ETag, Cache-Control, 304)', () => {
  const app = new OpenAPIHono().get('/x', (c) => cachedJson(c, { hello: 'world' }, 'public, max-age=60'));

  it('sends a strong ETag over the body and answers If-None-Match with a bodiless 304', async () => {
    const r = await app.request('/x');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('application/json');
    expect(r.headers.get('cache-control')).toBe('public, max-age=60');
    const etag = r.headers.get('etag') as string;
    expect(etag).toBe(etagOf(JSON.stringify({ hello: 'world' })));
    for (const inm of [etag, `W/${etag}`, `"zzz", ${etag}`, '*']) {
      const again = await app.request('/x', { headers: { 'if-none-match': inm } });
      expect(again.status, inm).toBe(304);
      expect(await again.text()).toBe('');
      expect(again.headers.get('etag')).toBe(etag);
    }
    expect((await app.request('/x', { headers: { 'if-none-match': '"zzz"' } })).status).toBe(200);
  });

  it('changes the ETag when the body changes', () => {
    expect(etagOf('{"a":1}')).not.toBe(etagOf('{"a":2}'));
  });
});

describe('deprecation marker and middleware (RFC 9745 Deprecation, RFC 8594 Sunset)', () => {
  const since = new Date('2027-01-01T00:00:00Z');
  const sunset = new Date('2027-07-01T00:00:00Z');
  const old = deprecated(
    createRoute({
      method: 'get',
      path: '/things/{id}',
      operationId: 'getThing',
      summary: 'Old',
      request: { params: z.object({ id: z.string() }) },
      responses: { 200: { description: 'ok' } },
    }),
    { since, sunset, link: 'https://docs.example.test/migrate' },
  );
  const current = createRoute({
    method: 'get',
    path: '/fresh',
    operationId: 'getFresh',
    summary: 'New',
    responses: { 200: { description: 'ok' } },
  });
  function build(basePath = '/v1') {
    const inner = new OpenAPIHono();
    inner.use('*', deprecationMiddleware(inner, basePath));
    inner.use('/things/:id', async (c, next) => {
      if (c.req.param('id') === 'locked') return c.json({ code: 'unauthenticated' }, 401);
      await next();
    });
    inner.openapi(old, (c) => c.json({ ok: true }, 200));
    inner.openapi(current, (c) => c.json({ ok: true }, 200));
    const app = new OpenAPIHono();
    app.route(basePath, inner);
    return { app, inner };
  }

  it('reads the marked routes from the registry', () => {
    const { inner } = build();
    expect([...deprecations(inner).keys()]).toEqual(['GET /things/:id']);
  });

  it('adds Deprecation, Sunset and Link to a marked route, errors included; none elsewhere', async () => {
    const { app } = build();
    const r = await app.request('/v1/things/42');
    expect(r.status).toBe(200);
    expect(r.headers.get('deprecation')).toBe(`@${since.getTime() / 1000}`);
    expect(r.headers.get('sunset')).toBe('Thu, 01 Jul 2027 00:00:00 GMT');
    expect(r.headers.get('link')).toBe(
      '<https://docs.example.test/migrate>; rel="deprecation"; type="text/html", <https://docs.example.test/migrate>; rel="sunset"; type="text/html"',
    );
    const denied = await app.request('/v1/things/locked');
    expect(denied.status).toBe(401);
    expect(denied.headers.get('deprecation')).toBe(`@${since.getTime() / 1000}`);
    const fresh = await app.request('/v1/fresh');
    expect(fresh.headers.get('deprecation')).toBeNull();
    expect(fresh.headers.get('sunset')).toBeNull();
    // Another method on the same path is not the deprecated operation.
    expect((await app.request('/v1/things/42', { method: 'POST' })).headers.get('deprecation')).toBeNull();
  });

  it('works on another mount point (the web app’s /api/v1)', async () => {
    const { app } = build('/api/v1');
    expect((await app.request('/api/v1/things/7')).headers.get('deprecation')).toBe(
      `@${since.getTime() / 1000}`,
    );
  });

  it('marks the operation deprecated in the OpenAPI document', () => {
    const { app } = build();
    const doc = app.getOpenAPI31Document({ openapi: '3.1.0', info: { title: 't', version: '1' } });
    expect(doc.paths?.['/v1/things/{id}']?.get?.deprecated).toBe(true);
    expect(doc.paths?.['/v1/fresh']?.get?.deprecated).toBeUndefined();
  });

  it('headers without a sunset or link are just Deprecation; a sunset must follow the deprecation', () => {
    expect(deprecationHeaders({ since })).toEqual({ deprecation: `@${since.getTime() / 1000}` });
    expect(() => deprecated(current, { since: sunset, sunset: since })).toThrow(/sunset/);
  });
});

describe('M1.13d wire allowlists', () => {
  const extra = { orgId: id(99), keyHash: 'x', createdBy: id(98), bytes: 1234, uploadedBy: id(97) };

  it('public sections drop visibility, position and anything unknown; each kind keeps its content', () => {
    const s = toWire(PublicEventSection, {
      id: id(1),
      eventId: id(2),
      title: 'FAQ',
      kind: 'faq',
      content: { items: [{ question: 'Q', answer: 'A' }] },
      visible: false,
      position: 3,
      ...extra,
    });
    expect(s).toEqual({
      id: id(1),
      title: 'FAQ',
      kind: 'faq',
      content: { items: [{ question: 'Q', answer: 'A' }] },
    });
    const org = toWire(EventSection, {
      id: id(1),
      title: 'About',
      kind: 'text',
      content: { markdown: 'Hi' },
      visible: false,
      position: 3,
      ...extra,
    });
    expect(org).toEqual({
      id: id(1),
      title: 'About',
      kind: 'text',
      content: { markdown: 'Hi' },
      visible: false,
      position: 3,
    });
    expect(() =>
      toWire(PublicEventSection, { id: id(1), title: 'x', kind: 'text', content: { items: [] } }),
    ).toThrow();
  });

  it('public announcements carry no audience; org ones keep drafts', () => {
    const a = { id: id(1), eventId: id(2), title: 'T', body: 'B', audience: 'holders', pinned: true };
    expect(toWire(PublicAnnouncement, { ...a, publishedAt: new Date(at), ...extra })).toEqual({
      id: id(1),
      title: 'T',
      body: 'B',
      pinned: true,
      publishedAt: at,
    });
    expect(
      toWire(Announcement, { ...a, publishedAt: null, createdAt: new Date(at), ...extra }),
    ).toMatchObject({
      audience: 'holders',
      publishedAt: null,
    });
  });

  it('public dates never carry capacity', () => {
    const d = {
      id: id(1),
      eventId: id(2),
      startsAt: new Date(at),
      endsAt: new Date(at),
      status: 'scheduled',
    };
    expect(toWire(PublicEventDate, { ...d, capacity: 150, soldOut: false })).not.toHaveProperty('capacity');
    expect(toWire(EventDate, { ...d, capacity: 150 })).toMatchObject({ capacity: 150 });
  });

  it('venues: the public one has no id, listing flag, archive date or quote data', () => {
    const v = {
      id: id(1),
      slug: 'hall',
      name: 'Hall',
      addressLine1: null,
      addressLine2: null,
      city: 'Austin',
      region: null,
      postalCode: null,
      country: 'US',
      latitude: null,
      longitude: null,
      timezone: 'America/Chicago',
      capacity: 300,
      accessibilityNotes: null,
      mapUrl: null,
      directoryListed: true,
      archivedAt: null,
      organizerName: 'Org',
      quoteEmail: 'owner@example.test',
      ...extra,
    };
    const pub = toWire(PublicVenue, { ...v, photos: [], upcomingEvents: [] });
    for (const k of ['id', 'directoryListed', 'archivedAt', 'quoteEmail', 'orgId'])
      expect(pub).not.toHaveProperty(k);
    expect(toWire(Venue, v)).toMatchObject({ id: id(1), directoryListed: true });
    expect(Object.keys(toWire(DirectoryVenue, v)).sort()).toEqual([
      'capacity',
      'city',
      'country',
      'name',
      'region',
      'slug',
    ]);
  });

  it('images keep dimensions, alt and variants; never bytes, uploader or source type', () => {
    const img = toWire(Image, {
      id: id(1),
      ownerId: id(2),
      ownerType: 'event',
      slot: 'cover',
      position: 0,
      width: 64,
      height: 48,
      alt: 'Stage',
      decorative: false,
      sourceType: 'png',
      variants: [
        {
          format: 'webp',
          width: 64,
          height: 48,
          url: 'https://app.test/media/a/b/64-x.webp',
          fallback: false,
          sha256: 'x',
          bytes: 9,
        },
      ],
      ...extra,
    });
    expect(img).toEqual({
      id: id(1),
      slot: 'cover',
      position: 0,
      width: 64,
      height: 48,
      alt: 'Stage',
      decorative: false,
      variants: [
        {
          format: 'webp',
          width: 64,
          height: 48,
          url: 'https://app.test/media/a/b/64-x.webp',
          fallback: false,
        },
      ],
    });
    // A relative path is not a URL a mobile client can use.
    expect(() =>
      toWire(Image, { ...img, variants: [{ ...img.variants[0], url: '/media/a/b/64-x.webp' }] }),
    ).toThrow();
  });

  it('program: public agenda has names not ids or capacities; the org agenda has both', () => {
    const session = {
      id: id(1),
      title: 'Opening',
      description: '',
      startsAt: new Date(at),
      endsAt: new Date(at),
      dateId: null,
      track: 'Main',
      room: 'Hall A',
      trackId: id(5),
      roomId: id(6),
      capacity: 99,
      speakerIds: [id(7)],
      speakers: [{ id: id(7), name: 'Amy', email: 'amy@example.test' }],
    };
    const pub = toWire(PublicAgenda, {
      timezone: 'UTC',
      days: [{ date: '2029-10-10', sessions: [session] }],
    });
    const s = pub.days[0]?.sessions[0];
    for (const k of ['trackId', 'roomId', 'capacity', 'speakerIds']) expect(s).not.toHaveProperty(k);
    expect(s?.speakers).toEqual([{ id: id(7), name: 'Amy' }]);
    const org = toWire(Agenda, {
      timezone: 'UTC',
      tracks: [{ id: id(5), name: 'Main', eventId: id(2) }],
      rooms: [{ id: id(6), name: 'Hall A', capacity: 200, eventId: id(2) }],
      days: [{ date: '2029-10-10', sessions: [session] }],
    });
    expect(org.days[0]?.sessions[0]).toMatchObject({ capacity: 99, trackId: id(5), roomId: id(6) });
    expect(org.rooms[0]).not.toHaveProperty('eventId');
    expect(
      toWire(Speaker, {
        id: id(7),
        eventId: id(2),
        name: 'Amy',
        title: null,
        company: null,
        bio: '',
        links: [],
        email: 'x',
      }),
    ).not.toHaveProperty('email');
    expect(toWire(PublicSponsorTier, { id: id(3), name: 'Gold', position: 1, sponsors: [] })).toEqual({
      name: 'Gold',
      sponsors: [],
    });
  });
});
