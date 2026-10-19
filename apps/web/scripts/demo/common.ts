import { createCheckpointCommand, scanTicketCommand } from '@yayatoh/checkin';
import {
  addSectionCommand,
  createAccessCodeCommand,
  createAnnouncementCommand,
  createEventCommand,
  createSeriesCommand,
  getEventBySlugQuery,
  listSeriesQuery,
  setEventDetailsCommand,
  setEventSeriesCommand,
  setPrivateInfoCommand,
  setVanityShortLinkCommand,
  transitionEventCommand,
} from '@yayatoh/events';
import { uploadMedia } from '@yayatoh/media';
import { recordBoxOfficeSaleCommand } from '@yayatoh/orders';
import { createPromoCodeCommand, createTicketTypeCommand } from '@yayatoh/ticketing';
import { createVenueCommand, listVenuesQuery } from '@yayatoh/venues';
import {
  addDays,
  addMinutes,
  ask,
  at,
  type Demo,
  demoImage,
  log,
  owner,
  PALETTES,
  type Person,
  quietPorts,
  run,
  step,
  ticketsOf,
} from './kit.ts';

export type Profile = 'wedding' | 'gala' | 'concert' | 'conference' | 'community' | 'agency' | 'other';

/* -------------------------------------------------------------------------------- venues ---- */

export const VENUES = {
  palace: {
    name: 'Lakeview Palace Gardens',
    addressLine1: 'Lake Pichola Road',
    city: 'Udaipur',
    region: 'Rajasthan',
    postalCode: '313001',
    latitude: 24.5764,
    longitude: 73.6802,
    capacity: 400,
    accessibilityNotes: 'Step-free paths through the gardens; ramps to the lawn and the terrace.',
    palette: PALETTES.wedding,
  },
  ballroom: {
    name: 'Marine Drive Grand Ballroom',
    addressLine1: '22 Marine Drive',
    city: 'Mumbai',
    region: 'Maharashtra',
    postalCode: '400020',
    latitude: 18.9432,
    longitude: 72.8232,
    capacity: 600,
    accessibilityNotes: 'Lift to the ballroom level; accessible restrooms beside the foyer.',
    palette: PALETTES.gala,
  },
  arena: {
    name: 'Riverside Amphitheatre',
    addressLine1: '5 Cubbon Park Road',
    city: 'Bengaluru',
    region: 'Karnataka',
    postalCode: '560001',
    latitude: 12.9763,
    longitude: 77.5929,
    capacity: 1200,
    accessibilityNotes: 'Wheelchair spaces in rows A and B; step-free entrance at Gate 2.',
    palette: PALETTES.concert,
  },
  convention: {
    name: 'Tech Park Convention Centre',
    addressLine1: 'Plot 12, HITEC City',
    city: 'Hyderabad',
    region: 'Telangana',
    postalCode: '500081',
    latitude: 17.4435,
    longitude: 78.3772,
    capacity: 2000,
    accessibilityNotes: 'All halls step-free; hearing loop in the main auditorium.',
    palette: PALETTES.conference,
  },
  hall: {
    name: 'Panjim Community Hall',
    addressLine1: '18 Rua de Ourém',
    city: 'Panaji',
    region: 'Goa',
    postalCode: '403001',
    latitude: 15.4989,
    longitude: 73.8278,
    capacity: 250,
    accessibilityNotes: 'Ground-floor hall with a ramp at the side entrance.',
    palette: PALETTES.community,
  },
  studio: {
    name: 'Skyline Studio',
    addressLine1: '3rd floor, Connaught Place Block A',
    city: 'New Delhi',
    region: 'Delhi',
    postalCode: '110001',
    latitude: 28.6315,
    longitude: 77.2167,
    capacity: 120,
    accessibilityNotes: 'Lift access; accessible restroom on the same floor.',
    palette: PALETTES.agency,
  },
} as const;
export type VenueKey = keyof typeof VENUES;

/** The demo venues (created once, with a photo each); returns their ids by key. */
export async function ensureVenues(d: Demo): Promise<Record<VenueKey, string>> {
  const ctx = owner(d);
  const existing = await ask<unknown, { id: string; name: string }[]>(
    listVenuesQuery,
    { includeArchived: true },
    ctx,
  );
  const ids = {} as Record<VenueKey, string>;
  for (const [key, v] of Object.entries(VENUES) as [VenueKey, (typeof VENUES)[VenueKey]][]) {
    const found = existing.find((e) => e.name === v.name);
    if (found) {
      ids[key] = found.id;
      continue;
    }
    const { palette, ...fields } = v;
    const venue = await run<unknown, { id: string }>(
      createVenueCommand,
      {
        ...fields,
        country: 'IN',
        timezone: d.timezone,
        mapUrl: `https://www.openstreetmap.org/?mlat=${v.latitude}&mlon=${v.longitude}`,
        directoryListed: true,
      },
      ctx,
    );
    ids[key] = venue.id;
    await step(`venue photo ${v.name}`, async () =>
      uploadMedia(
        owner(d),
        {
          file: await demoImage(`venue-${key}`, palette),
          ownerType: 'venue',
          ownerId: venue.id,
          slot: 'photo',
          alt: `${v.name}, ${v.city}`,
        } as never,
        quietPorts,
      ),
    );
    log(`venue ${v.name}`);
  }
  return ids;
}

/** A series by name (created once). */
export async function ensureSeries(d: Demo, name: string, description: string): Promise<string> {
  const ctx = owner(d);
  const list = await ask<unknown, { id: string; name: string }[] | { items: { id: string; name: string }[] }>(
    listSeriesQuery,
    {},
    ctx,
  );
  const rows = Array.isArray(list) ? list : list.items;
  const found = rows.find((s) => s.name === name);
  if (found) return found.id;
  const s = await run<unknown, { id: string }>(createSeriesCommand, { name, description }, ctx);
  log(`series ${name}`);
  return s.id;
}

/* --------------------------------------------------------------------------------- event ---- */

export interface EventSpec {
  readonly slug: string;
  readonly name: string;
  readonly tagline: string;
  readonly profile: Profile;
  readonly category: string;
  readonly visibility?: 'public' | 'unlisted' | 'private';
  readonly attendanceMode?: 'in_person' | 'online' | 'hybrid';
  readonly venue: VenueKey;
  /** Local date and times in the org's timezone. */
  readonly date: string;
  readonly start: string;
  readonly endDate?: string;
  readonly end: string;
  readonly brandColor: string;
  readonly tags: readonly string[];
  readonly about: string;
  readonly faq: readonly { question: string; answer: string }[];
  readonly schedule: readonly { time: string; title: string; detail?: string }[];
  readonly links?: readonly { label: string; url: string }[];
  readonly announcement: { title: string; body: string };
  readonly privateInfo?: string;
  readonly seriesId?: string;
  readonly vanity?: string;
}

export interface Built {
  readonly id: string;
  readonly slug: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** The event is in the past: sales are recorded before it, check-ins during it. */
  readonly past: boolean;
}

/** Whether a demo event with this slug exists already (the seed never touches it again). */
export async function existing(d: Demo, slug: string): Promise<boolean> {
  const e = await ask(getEventBySlugQuery, { slug }, owner(d)).catch(() => null);
  return Boolean(e);
}

/** The event with everything every profile shows: details, content, media, access, links. */
export async function buildEvent(d: Demo, venues: Record<VenueKey, string>, s: EventSpec): Promise<Built> {
  const startsAt = at(s.date, s.start, d.timezone);
  const endsAt = at(s.endDate ?? s.date, s.end, d.timezone);
  const ctx = owner(d);
  const v = VENUES[s.venue];
  const e = await run<unknown, { id: string }>(
    createEventCommand,
    {
      name: s.name,
      slug: s.slug,
      tagline: s.tagline,
      profile: s.profile,
      visibility: s.visibility ?? 'public',
      timezone: d.timezone,
      startsAt,
      endsAt,
      venueName: v.name,
      city: v.city,
      country: 'IN',
      currency: d.currency,
    },
    ctx,
  );
  const id = e.id;
  log(`event ${s.slug}`);
  await step(`${s.slug} details`, () =>
    run(
      setEventDetailsCommand,
      {
        eventId: id,
        venueId: venues[s.venue],
        category: s.category,
        attendanceMode: s.attendanceMode ?? 'in_person',
        tags: [...s.tags],
        brandColor: s.brandColor,
      },
      owner(d),
    ),
  );
  if (s.seriesId)
    await step(`${s.slug} series`, () =>
      run(setEventSeriesCommand, { eventId: id, seriesId: s.seriesId }, owner(d)),
    );
  const sections: [string, string, unknown][] = [
    ['About', 'text', { markdown: s.about }],
    [
      'Schedule',
      'schedule',
      { items: s.schedule.map((x) => ({ time: x.time, title: x.title, detail: x.detail ?? null })) },
    ],
    ['FAQ', 'faq', { items: s.faq }],
    [
      'Getting there',
      'location',
      {
        address: `${v.name}, ${v.addressLine1}, ${v.city} ${v.postalCode}`,
        directions: v.accessibilityNotes,
        mapUrl: `https://www.openstreetmap.org/?mlat=${v.latitude}&mlon=${v.longitude}`,
      },
    ],
  ];
  if (s.links?.length) sections.push(['Useful links', 'links', { items: s.links }]);
  for (const [title, kind, content] of sections)
    await step(`${s.slug} section ${title}`, () =>
      run(addSectionCommand, { eventId: id, title, kind, content }, owner(d)),
    );
  await step(`${s.slug} announcement`, () =>
    run(
      createAnnouncementCommand,
      {
        eventId: id,
        title: s.announcement.title,
        body: s.announcement.body,
        audience: 'public',
        pinned: true,
        publish: true,
      },
      owner(d),
    ),
  );
  const palette = PALETTES[s.profile];
  await step(`${s.slug} cover`, async () =>
    uploadMedia(
      owner(d),
      {
        file: await demoImage(`${s.slug}-cover`, palette),
        ownerType: 'event',
        ownerId: id,
        slot: 'cover',
        alt: `${s.name} at ${v.name}`,
      } as never,
      quietPorts,
    ),
  );
  for (let i = 1; i <= 5; i += 1)
    await step(`${s.slug} gallery ${i}`, async () =>
      uploadMedia(
        owner(d),
        {
          file: await demoImage(`${s.slug}-gallery-${i}`, palette, 1200, 900),
          ownerType: 'event',
          ownerId: id,
          slot: 'gallery',
          alt: `${s.name}: photo ${i}`,
        } as never,
        quietPorts,
      ),
    );
  if (s.privateInfo)
    await step(`${s.slug} private info`, () =>
      run(
        setPrivateInfoCommand,
        { eventId: id, body: s.privateInfo, joinUrl: null, joinOpensMinutes: 30 },
        owner(d),
      ),
    );
  if (s.vanity)
    await step(`${s.slug} short link`, () =>
      run(setVanityShortLinkCommand, { eventId: id, code: s.vanity }, owner(d)),
    );
  return { id, slug: s.slug, startsAt, endsAt, past: endsAt.getTime() < Date.now() };
}

export const publish = (d: Demo, b: Built) =>
  step(`${b.slug} publish`, () =>
    run(transitionEventCommand, { eventId: b.id, transition: 'publish' }, owner(d)),
  );
/** Past demo events end as `completed`, after their sales and check-ins are in. */
export const complete = (d: Demo, b: Built) =>
  b.past
    ? step(`${b.slug} complete`, () =>
        run(transitionEventCommand, { eventId: b.id, transition: 'complete' }, owner(d)),
      )
    : null;

/* ------------------------------------------------------------------------------- tickets ---- */

export interface TicketSpec {
  readonly name: string;
  readonly priceMinor: number;
  readonly quantityTotal: number;
  readonly description?: string;
  readonly visibility?: 'public' | 'hidden';
  readonly earlyPriceMinor?: number;
  readonly tableSize?: number;
  readonly maxPerOrder?: number;
}

export async function ticketTypes(
  d: Demo,
  b: Built,
  specs: readonly TicketSpec[],
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const t of specs) {
    const { earlyPriceMinor, ...rest } = t;
    const row = await step(`${b.slug} ticket ${t.name}`, () =>
      run<unknown, { id: string }>(
        createTicketTypeCommand,
        {
          eventId: b.id,
          ...rest,
          ...(earlyPriceMinor && !b.past ? { earlyPriceMinor, earlyEndsAt: addDays(b.startsAt, -21) } : {}),
        },
        owner(d),
      ),
    );
    if (row) ids[t.name] = row.id;
  }
  return ids;
}

export async function promoCodes(d: Demo, b: Built, prefix: string) {
  await step(`${b.slug} promo`, () =>
    run(
      createPromoCodeCommand,
      { eventId: b.id, code: `${prefix}10`, kind: 'percent', percentBps: 1000, maxRedemptions: 100 },
      owner(d),
    ),
  );
  await step(`${b.slug} access code`, () =>
    run(
      createAccessCodeCommand,
      { eventId: b.id, code: `${prefix}VIP`, label: 'VIP guests', unlocksEvent: true, maxUses: 50 },
      owner(d),
    ),
  );
}

/** When demo sales happen: shortly before a past event, now for an upcoming one. */
export const salesClock = (b: Built, i: number) =>
  b.past ? addMinutes(addDays(b.startsAt, -20 + (i % 15)), i * 37) : new Date();

const METHODS = ['card_terminal', 'cash', 'zelle', 'other'] as const;

/** Box-office orders (paid at the door or in advance): one order per buyer. */
export async function sell(
  d: Demo,
  b: Built,
  orders: readonly {
    buyer: Person;
    items?: { ticketTypeId: string; quantity: number }[];
    seats?: string[];
  }[],
) {
  let ok = 0;
  for (const [i, o] of orders.entries()) {
    const r = await step(`${b.slug} order ${o.buyer.email}`, () =>
      run(
        recordBoxOfficeSaleCommand,
        {
          eventId: b.id,
          items: o.items ?? [],
          seats: o.seats ?? [],
          buyer: { email: o.buyer.email, name: o.buyer.name },
          method: METHODS[i % METHODS.length],
          reference: `DEMO-${String(i + 1).padStart(3, '0')}`,
          locale: 'en',
        },
        owner(d, salesClock(b, i)),
      ),
    );
    if (r) ok += 1;
  }
  log(`${b.slug}: ${ok}/${orders.length} orders`);
}

/** Door check-in: an entrance checkpoint, and (for past events) most tickets scanned in. */
export async function checkIns(d: Demo, b: Built, share = 0.8) {
  const cp = await step(`${b.slug} checkpoint`, () =>
    run<unknown, { id: string }>(
      createCheckpointCommand,
      { eventId: b.id, name: 'Main entrance', kind: 'entrance' },
      owner(d),
    ),
  );
  if (!b.past || !cp) return;
  const tickets = await ticketsOf(d, b.id);
  const take = Math.floor(tickets.length * share);
  for (const [i, t] of tickets.slice(0, take).entries())
    await step(`${b.slug} scan ${t.short_code}`, () =>
      run(
        scanTicketCommand,
        {
          eventId: b.id,
          code: t.short_code,
          clientScanId: `demo-${t.ticket_id}`,
          checkpointId: cp.id,
          direction: 'in',
        },
        owner(d, addMinutes(b.startsAt, 5 + i * 2)),
      ),
    );
  log(`${b.slug}: ${take} check-ins`);
}
