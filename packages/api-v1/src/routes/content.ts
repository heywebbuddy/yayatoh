import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  announcementsQuery,
  type EventTarget,
  eventSectionsQuery,
  getEventQuery,
  listOccurrencesQuery,
  pageTarget,
  publicEventBySlug,
  publicEventContent,
  publicEventsAtVenue,
  publicOccurrences,
} from '@yayatoh/events';
import { type Ctx, DomainError, executeQuery } from '@yayatoh/kernel';
import { listOwnersMediaQuery, type PublicMediaDto, publicMedia, publicProgramMedia } from '@yayatoh/media';
import { groupByDay, type PublicProgramDto, programQuery, publicProgram } from '@yayatoh/program';
import { getVenueQuery, listVenuesQuery, publicVenue, quoteTarget, venueDirectory } from '@yayatoh/venues';
import type { Context } from 'hono';
import { cachedJson, PRIVATE_CACHE, PUBLIC_CACHE } from '../caching.ts';
import type { V1Deps, V1Env } from '../context.ts';
import { nameKey, newestFirst, pageByKey } from '../cursor.ts';
import {
  Agenda,
  AgendaSession,
  Announcement,
  DirectoryVenue,
  EventDate,
  EventSection,
  Exhibitor,
  Image,
  listSchema,
  PublicAgenda,
  PublicAnnouncement,
  PublicEventDate,
  PublicEventSection,
  PublicSponsorTier,
  PublicVenue,
  pageSchema,
  Speaker,
  SpeakerDetail,
  SponsorTier,
  toWire,
  Venue,
} from '../resources.ts';
import {
  EventParams,
  json,
  KeyPageQuery,
  notModified,
  OrgParam,
  orgSecurity,
  problems,
  publicProblems,
  SlugParam,
} from './common.ts';

/*
 * M1.13d: the mobile-ready content reads (roadmap M1.15). Public routes answer only for events
 * with a public page (published/postponed/cancelled/completed, public or unlisted, active org)
 * through the same SECURITY DEFINER targets and allowlist serializers as the web's event page;
 * private events, drafts, hidden sections, holders-only announcements, capacities and private
 * info never appear. Org routes (`events:read`) show the organizer's full view of their own org.
 */

const SpeakerParams = z.object({
  slug: SlugParam.shape.slug,
  speakerId: z.uuid().openapi({ param: { name: 'speakerId', in: 'path' }, description: 'The speaker id' }),
});
const OrgSpeakerParams = EventParams.extend({
  speakerId: z.uuid().openapi({ param: { name: 'speakerId', in: 'path' }, description: 'The speaker id' }),
});
const VenueSlugParam = z.object({
  slug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/)
    .openapi({
      param: { name: 'slug', in: 'path' },
      description: 'The venue’s directory slug',
      example: 'lakeside-pavilion',
    }),
});
const AgendaQuery = z.object({
  dateId: z
    .uuid()
    .optional()
    .openapi({ description: 'Only this date’s sessions (and those on no date), for multi-date events.' }),
});

const PublicEventSectionList = listSchema(PublicEventSection, 'PublicEventSectionList');
const EventSectionList = listSchema(EventSection, 'EventSectionList');
const PublicAnnouncementPage = pageSchema(PublicAnnouncement, 'PublicAnnouncementPage');
const AnnouncementPage = pageSchema(Announcement, 'AnnouncementPage');
const PublicEventDatePage = pageSchema(PublicEventDate, 'PublicEventDatePage');
const EventDatePage = pageSchema(EventDate, 'EventDatePage');
const SpeakerPage = pageSchema(Speaker, 'SpeakerPage');
const ExhibitorPage = pageSchema(Exhibitor, 'ExhibitorPage');
const PublicSponsorTierList = listSchema(PublicSponsorTier, 'PublicSponsorTierList');
const SponsorTierList = listSchema(SponsorTier, 'SponsorTierList');
const ImageList = listSchema(Image, 'ImageList');
const DirectoryVenuePage = pageSchema(DirectoryVenue, 'DirectoryVenuePage');
const VenuePage = pageSchema(Venue, 'VenuePage');

const pub = { tags: ['public content'] };
const org = { tags: ['event content'], security: orgSecurity };
const scope = '\n\nScope `events:read`.';
const cached = 'Responses carry an `ETag`; send it back as `If-None-Match` to get a 304.';
const publicNote = `No credential. Only events with a public page (public or unlisted) answer; private events and drafts are a 404. ${cached}`;

const routes = {
  publicSections: createRoute({
    method: 'get',
    path: '/public/events/{slug}/sections',
    operationId: 'listPublicEventSections',
    ...pub,
    summary: 'A public event’s content sections',
    description: `The visible content blocks of the event page, in page order (hidden ones never appear). ${publicNote}`,
    request: { params: SlugParam },
    responses: { 200: json(PublicEventSectionList, 'Visible sections'), ...notModified, ...publicProblems },
  }),
  publicAnnouncements: createRoute({
    method: 'get',
    path: '/public/events/{slug}/announcements',
    operationId: 'listPublicEventAnnouncements',
    ...pub,
    summary: 'A public event’s announcements',
    description: `Published announcements for everyone, pinned first, then newest first. Announcements for ticket holders only are never listed here. ${publicNote}`,
    request: { params: SlugParam, query: KeyPageQuery },
    responses: {
      200: json(PublicAnnouncementPage, 'A page of announcements'),
      ...notModified,
      ...publicProblems,
    },
  }),
  publicDates: createRoute({
    method: 'get',
    path: '/public/events/{slug}/dates',
    operationId: 'listPublicEventDates',
    ...pub,
    summary: 'A public event’s dates',
    description: `The dates of a multi-date event in start order, cancelled ones included (marked). An event with no dates is a single-date event: use its own start and end. No capacity numbers, only \`soldOut\`. ${publicNote}`,
    request: { params: SlugParam, query: KeyPageQuery },
    responses: { 200: json(PublicEventDatePage, 'A page of dates'), ...notModified, ...publicProblems },
  }),
  publicAgenda: createRoute({
    method: 'get',
    path: '/public/events/{slug}/agenda',
    operationId: 'getPublicEventAgenda',
    ...pub,
    summary: 'A public event’s agenda',
    description: `Sessions grouped by day in the event’s timezone, with track, room and speakers. The whole agenda in one response (at most 500 sessions per event). ${publicNote}`,
    request: { params: SlugParam, query: AgendaQuery },
    responses: { 200: json(PublicAgenda, 'The agenda'), ...notModified, ...publicProblems },
  }),
  publicSpeakers: createRoute({
    method: 'get',
    path: '/public/events/{slug}/speakers',
    operationId: 'listPublicEventSpeakers',
    ...pub,
    summary: 'A public event’s speakers',
    description: `Speakers by name. ${publicNote}`,
    request: { params: SlugParam, query: KeyPageQuery },
    responses: { 200: json(SpeakerPage, 'A page of speakers'), ...notModified, ...publicProblems },
  }),
  publicSpeaker: createRoute({
    method: 'get',
    path: '/public/events/{slug}/speakers/{speakerId}',
    operationId: 'getPublicEventSpeaker',
    ...pub,
    summary: 'One speaker of a public event',
    description: `A speaker’s profile and the sessions they speak in. ${publicNote}`,
    request: { params: SpeakerParams },
    responses: { 200: json(SpeakerDetail, 'The speaker'), ...notModified, ...publicProblems },
  }),
  publicExhibitors: createRoute({
    method: 'get',
    path: '/public/events/{slug}/exhibitors',
    operationId: 'listPublicEventExhibitors',
    ...pub,
    summary: 'A public event’s exhibitors',
    description: `Exhibitors by name, with booth labels. ${publicNote}`,
    request: { params: SlugParam, query: KeyPageQuery },
    responses: { 200: json(ExhibitorPage, 'A page of exhibitors'), ...notModified, ...publicProblems },
  }),
  publicSponsors: createRoute({
    method: 'get',
    path: '/public/events/{slug}/sponsors',
    operationId: 'listPublicEventSponsors',
    ...pub,
    summary: 'A public event’s sponsors by tier',
    description: `Sponsor tiers in display order, each with its sponsors; empty tiers are left out. ${publicNote}`,
    request: { params: SlugParam },
    responses: { 200: json(PublicSponsorTierList, 'Sponsor tiers'), ...notModified, ...publicProblems },
  }),
  publicImages: createRoute({
    method: 'get',
    path: '/public/events/{slug}/images',
    operationId: 'listPublicEventImages',
    ...pub,
    summary: 'A public event’s images',
    description: `The cover, the gallery and the organizer’s logo (\`slot\`), each with AVIF/WebP/fallback variants at absolute, content-hashed URLs that never change (cache them forever). ${publicNote}`,
    request: { params: SlugParam },
    responses: { 200: json(ImageList, 'Images'), ...notModified, ...publicProblems },
  }),
  directory: createRoute({
    method: 'get',
    path: '/public/venues',
    operationId: 'listDirectoryVenues',
    ...pub,
    summary: 'The venue directory',
    description: `Venues listed in the public directory, by name. No credential. ${cached}`,
    request: { query: KeyPageQuery },
    responses: { 200: json(DirectoryVenuePage, 'A page of venues'), ...notModified, ...publicProblems },
  }),
  publicVenue: createRoute({
    method: 'get',
    path: '/public/venues/{slug}',
    operationId: 'getPublicVenue',
    ...pub,
    summary: 'A directory venue',
    description: `A listed venue’s public details, photos and upcoming public events. Unlisted or archived venues are a 404. No credential. ${cached}`,
    request: { params: VenueSlugParam },
    responses: { 200: json(PublicVenue, 'The venue'), ...notModified, ...publicProblems },
  }),
  sections: createRoute({
    method: 'get',
    path: '/orgs/{org}/events/{eventId}/sections',
    operationId: 'listEventSections',
    ...org,
    summary: 'An event’s content sections',
    description: `Every content section in page order, hidden ones included (\`visible\`).${scope}`,
    request: { params: EventParams },
    responses: { 200: json(EventSectionList, 'Sections'), ...notModified, ...problems },
  }),
  announcements: createRoute({
    method: 'get',
    path: '/orgs/{org}/events/{eventId}/announcements',
    operationId: 'listEventAnnouncements',
    ...org,
    summary: 'An event’s announcements',
    description: `Every announcement, newest first: drafts (\`publishedAt\` null) and both audiences.${scope}`,
    request: { params: EventParams, query: KeyPageQuery },
    responses: { 200: json(AnnouncementPage, 'A page of announcements'), ...notModified, ...problems },
  }),
  dates: createRoute({
    method: 'get',
    path: '/orgs/{org}/events/{eventId}/dates',
    operationId: 'listEventDates',
    ...org,
    summary: 'An event’s dates',
    description: `The dates of a multi-date event in start order, with capacities.${scope}`,
    request: { params: EventParams, query: KeyPageQuery },
    responses: { 200: json(EventDatePage, 'A page of dates'), ...notModified, ...problems },
  }),
  agenda: createRoute({
    method: 'get',
    path: '/orgs/{org}/events/{eventId}/agenda',
    operationId: 'getEventAgenda',
    ...org,
    summary: 'An event’s agenda',
    description: `Tracks, rooms and sessions grouped by day in the event’s timezone, with ids and capacities.${scope}`,
    request: { params: EventParams, query: AgendaQuery },
    responses: { 200: json(Agenda, 'The agenda'), ...notModified, ...problems },
  }),
  speakers: createRoute({
    method: 'get',
    path: '/orgs/{org}/events/{eventId}/speakers',
    operationId: 'listEventSpeakers',
    ...org,
    summary: 'An event’s speakers',
    description: `Speakers by name.${scope}`,
    request: { params: EventParams, query: KeyPageQuery },
    responses: { 200: json(SpeakerPage, 'A page of speakers'), ...notModified, ...problems },
  }),
  speaker: createRoute({
    method: 'get',
    path: '/orgs/{org}/events/{eventId}/speakers/{speakerId}',
    operationId: 'getEventSpeaker',
    ...org,
    summary: 'One speaker',
    description: `A speaker and the sessions they speak in.${scope}`,
    request: { params: OrgSpeakerParams },
    responses: { 200: json(SpeakerDetail, 'The speaker'), ...notModified, ...problems },
  }),
  exhibitors: createRoute({
    method: 'get',
    path: '/orgs/{org}/events/{eventId}/exhibitors',
    operationId: 'listEventExhibitors',
    ...org,
    summary: 'An event’s exhibitors',
    description: `Exhibitors by name.${scope}`,
    request: { params: EventParams, query: KeyPageQuery },
    responses: { 200: json(ExhibitorPage, 'A page of exhibitors'), ...notModified, ...problems },
  }),
  sponsors: createRoute({
    method: 'get',
    path: '/orgs/{org}/events/{eventId}/sponsors',
    operationId: 'listEventSponsors',
    ...org,
    summary: 'An event’s sponsor tiers',
    description: `Every sponsor tier in display order (empty ones included) with its sponsors.${scope}`,
    request: { params: EventParams },
    responses: { 200: json(SponsorTierList, 'Sponsor tiers'), ...notModified, ...problems },
  }),
  venues: createRoute({
    method: 'get',
    path: '/orgs/{org}/venues',
    operationId: 'listVenues',
    ...org,
    tags: ['venues'],
    summary: 'The organization’s venues',
    description: `Saved venues by name, archived ones included (\`archivedAt\`).${scope}`,
    request: { params: OrgParam, query: KeyPageQuery },
    responses: { 200: json(VenuePage, 'A page of venues'), ...notModified, ...problems },
  }),
  venue: createRoute({
    method: 'get',
    path: '/orgs/{org}/venues/{venueId}',
    operationId: 'getVenue',
    ...org,
    tags: ['venues'],
    summary: 'One venue',
    description: `A saved venue.${scope}`,
    request: {
      params: OrgParam.extend({
        venueId: z.uuid().openapi({ param: { name: 'venueId', in: 'path' }, description: 'The venue id' }),
      }),
    },
    responses: { 200: json(Venue, 'The venue'), ...notModified, ...problems },
  }),
};

/** The org and id of an event with a public page, or a 404 (the same answer for drafts and private events). */
async function publicTarget(slug: string): Promise<EventTarget> {
  const t = await pageTarget(slug);
  if (!t) throw new DomainError('not_found', 'Event not found');
  return t;
}

/** Media paths are app-origin relative; mobile clients need absolute URLs. */
const originOf = (deps: V1Deps, c: Context) =>
  (deps.publicOrigin ?? new URL(c.req.url).origin).replace(/\/$/, '');
const absolute = (origin: string, images: readonly PublicMediaDto[]) =>
  images.map((m) => ({ ...m, variants: m.variants.map((v) => ({ ...v, url: `${origin}${v.url}` })) }));

/** An image on the wire: absolute variant URLs, no owner or storage details. */
type WireImage = Omit<PublicMediaDto, 'ownerId'>;
type ProgramImages = ReadonlyMap<string, WireImage>;
const withImage =
  (images: ProgramImages) =>
  <T extends { id: string }>(x: T) => ({ ...x, image: images.get(x.id) ?? null });

/** Speaker photos, exhibitor and sponsor logos of a public event page (M1.4h), by owner id. */
async function publicProgramImages(origin: string, target: EventTarget): Promise<ProgramImages> {
  const byOwner = await publicProgramMedia(target.orgId, target.eventId);
  return new Map([...byOwner].map(([ownerId, m]) => [ownerId, absolute(origin, [m])[0] as WireImage]));
}

/** The same for the org's own reads (members see them whatever the event's visibility). */
async function orgProgramImages(
  c: { get(k: 'ctx'): Ctx },
  deps: V1Deps,
  origin: string,
  owners: { speaker?: readonly string[]; exhibitor?: readonly string[]; sponsor?: readonly string[] },
): Promise<ProgramImages> {
  const out = new Map<string, WireImage>();
  for (const [ownerType, ids] of Object.entries(owners) as [keyof typeof owners, readonly string[]][]) {
    if (!ids?.length) continue;
    const rows = await executeQuery(
      listOwnersMediaQuery,
      { ownerType, ownerIds: [...ids] },
      c.get('ctx'),
      deps.ports,
    );
    for (const m of rows)
      if (!out.has(m.ownerId))
        out.set(m.ownerId, {
          id: m.id,
          slot: m.slot,
          position: m.position,
          width: m.width,
          height: m.height,
          alt: m.decorative ? '' : (m.alt ?? ''),
          decorative: m.decorative,
          variants: m.variants.map((v) => ({ ...v, url: `${origin}${v.url}` })),
        });
  }
  return out;
}

type PublicSession = PublicProgramDto['sessions'][number];
const agendaSession = (s: PublicSession) => ({ ...s, dateId: s.occurrenceId });
const onDate = (dateId: string | undefined) => (s: { occurrenceId: string | null }) =>
  !dateId || s.occurrenceId === null || s.occurrenceId === dateId;

function days<T extends { startsAt: Date; endsAt: Date; title: string }, U>(
  sessions: readonly T[],
  timezone: string,
  map: (s: T) => U,
) {
  return groupByDay(sessions, timezone).map((d) => ({ date: d.day, sessions: d.items.map(map) }));
}

async function eventOf(c: { get(k: 'ctx'): Ctx }, deps: V1Deps, eventId: string) {
  return executeQuery(getEventQuery, { eventId }, c.get('ctx'), deps.ports);
}

export function contentRoutes(deps: V1Deps) {
  const { ports } = deps;
  return (
    new OpenAPIHono<V1Env>()
      /* ------------------------------------------------------------------ public ---- */
      .openapi(routes.publicSections, async (c) => {
        const content = await publicEventContent(await publicTarget(c.req.valid('param').slug));
        return cachedJson(c, toWire(PublicEventSectionList, { data: content.sections }), PUBLIC_CACHE);
      })
      .openapi(routes.publicAnnouncements, async (c) => {
        const { limit, cursor } = c.req.valid('query');
        const content = await publicEventContent(await publicTarget(c.req.valid('param').slug));
        // Public reads only ever hold published, `public`-audience announcements.
        const page = pageByKey(content.announcements, limit, cursor, (a) => [
          `${a.pinned ? 0 : 1}${newestFirst(a.publishedAt ?? new Date(0))}`,
          a.id,
        ]);
        return cachedJson(c, toWire(PublicAnnouncementPage, page), PUBLIC_CACHE);
      })
      .openapi(routes.publicDates, async (c) => {
        const { limit, cursor } = c.req.valid('query');
        const slug = c.req.valid('param').slug;
        await publicTarget(slug);
        const page = pageByKey(await publicOccurrences(slug), limit, cursor, (d) => [
          d.startsAt.toISOString(),
          d.id,
        ]);
        return cachedJson(c, toWire(PublicEventDatePage, page), PUBLIC_CACHE);
      })
      .openapi(routes.publicAgenda, async (c) => {
        const slug = c.req.valid('param').slug;
        const target = await publicTarget(slug);
        const event = await publicEventBySlug(slug);
        if (!event) throw new DomainError('not_found', 'Event not found');
        const program = await publicProgram(target);
        const sessions = program.sessions.filter(onDate(c.req.valid('query').dateId));
        return cachedJson(
          c,
          toWire(PublicAgenda, {
            timezone: event.timezone,
            days: days(sessions, event.timezone, agendaSession),
          }),
          PUBLIC_CACHE,
        );
      })
      .openapi(routes.publicSpeakers, async (c) => {
        const { limit, cursor } = c.req.valid('query');
        const target = await publicTarget(c.req.valid('param').slug);
        const program = await publicProgram(target);
        const images = await publicProgramImages(originOf(deps, c), target);
        const page = pageByKey(program.speakers.map(withImage(images)), limit, cursor, (s) => [
          nameKey(s.name),
          s.id,
        ]);
        return cachedJson(c, toWire(SpeakerPage, page), PUBLIC_CACHE);
      })
      .openapi(routes.publicSpeaker, async (c) => {
        const { slug, speakerId } = c.req.valid('param');
        const target = await publicTarget(slug);
        const program = await publicProgram(target);
        const found = program.speakers.find((s) => s.id === speakerId);
        if (!found) throw new DomainError('not_found', 'Speaker not found');
        const speaker = withImage(await publicProgramImages(originOf(deps, c), target))(found);
        const sessions = program.sessions.filter((s) => s.speakers.some((p) => p.id === speakerId));
        return cachedJson(
          c,
          toWire(SpeakerDetail, { speaker, sessions: sessions.map(agendaSession) }),
          PUBLIC_CACHE,
        );
      })
      .openapi(routes.publicExhibitors, async (c) => {
        const { limit, cursor } = c.req.valid('query');
        const target = await publicTarget(c.req.valid('param').slug);
        const program = await publicProgram(target);
        const images = await publicProgramImages(originOf(deps, c), target);
        const page = pageByKey(program.exhibitors.map(withImage(images)), limit, cursor, (x) => [
          nameKey(x.name),
          x.id,
        ]);
        return cachedJson(c, toWire(ExhibitorPage, page), PUBLIC_CACHE);
      })
      .openapi(routes.publicSponsors, async (c) => {
        const target = await publicTarget(c.req.valid('param').slug);
        const program = await publicProgram(target);
        const image = withImage(await publicProgramImages(originOf(deps, c), target));
        const data = program.sponsorTiers.map((t) => ({ ...t, sponsors: t.sponsors.map(image) }));
        return cachedJson(c, toWire(PublicSponsorTierList, { data }), PUBLIC_CACHE);
      })
      .openapi(routes.publicImages, async (c) => {
        const target = await publicTarget(c.req.valid('param').slug);
        const images = [
          ...(await publicMedia('event', target.eventId)),
          ...(await publicMedia('org', target.orgId)),
        ];
        return cachedJson(c, toWire(ImageList, { data: absolute(originOf(deps, c), images) }), PUBLIC_CACHE);
      })
      .openapi(routes.directory, async (c) => {
        const { limit, cursor } = c.req.valid('query');
        const page = pageByKey(await venueDirectory(), limit, cursor, (v) => [nameKey(v.name), v.slug]);
        return cachedJson(c, toWire(DirectoryVenuePage, page), PUBLIC_CACHE);
      })
      .openapi(routes.publicVenue, async (c) => {
        const slug = c.req.valid('param').slug;
        const venue = await publicVenue(slug);
        const target = venue ? await quoteTarget(slug) : null;
        if (!venue || !target) throw new DomainError('not_found', 'Venue not found');
        const photos = absolute(originOf(deps, c), await publicMedia('venue', target.venueId));
        const upcomingEvents = await publicEventsAtVenue(slug);
        return cachedJson(c, toWire(PublicVenue, { ...venue, photos, upcomingEvents }), PUBLIC_CACHE);
      })
      /* --------------------------------------------------------------------- org ---- */
      .openapi(routes.sections, async (c) => {
        const { eventId } = c.req.valid('param');
        await eventOf(c, deps, eventId);
        const rows = await executeQuery(eventSectionsQuery, { eventId }, c.get('ctx'), ports);
        return cachedJson(c, toWire(EventSectionList, { data: rows }), PRIVATE_CACHE);
      })
      .openapi(routes.announcements, async (c) => {
        const { limit, cursor } = c.req.valid('query');
        const { eventId } = c.req.valid('param');
        await eventOf(c, deps, eventId);
        const rows = await executeQuery(announcementsQuery, { eventId }, c.get('ctx'), ports);
        const page = pageByKey(rows, limit, cursor, (a) => [newestFirst(a.createdAt), a.id]);
        return cachedJson(c, toWire(AnnouncementPage, page), PRIVATE_CACHE);
      })
      .openapi(routes.dates, async (c) => {
        const { limit, cursor } = c.req.valid('query');
        const { eventId } = c.req.valid('param');
        await eventOf(c, deps, eventId);
        const rows = await executeQuery(listOccurrencesQuery, { eventId }, c.get('ctx'), ports);
        const page = pageByKey(rows, limit, cursor, (d) => [d.startsAt.toISOString(), d.id]);
        return cachedJson(c, toWire(EventDatePage, page), PRIVATE_CACHE);
      })
      .openapi(routes.agenda, async (c) => {
        const { eventId } = c.req.valid('param');
        const event = await eventOf(c, deps, eventId);
        const p = await executeQuery(programQuery, { eventId }, c.get('ctx'), ports);
        const sessions = p.sessions.filter(onDate(c.req.valid('query').dateId));
        const agenda = {
          timezone: event.timezone,
          tracks: p.tracks,
          rooms: p.rooms,
          days: days(sessions, event.timezone, (s) => ({ ...s, dateId: s.occurrenceId })),
        };
        return cachedJson(c, toWire(Agenda, agenda), PRIVATE_CACHE);
      })
      .openapi(routes.speakers, async (c) => {
        const { limit, cursor } = c.req.valid('query');
        const { eventId } = c.req.valid('param');
        await eventOf(c, deps, eventId);
        const p = await executeQuery(programQuery, { eventId }, c.get('ctx'), ports);
        const images = await orgProgramImages(c, deps, originOf(deps, c), {
          speaker: p.speakers.map((s) => s.id),
        });
        const page = pageByKey(p.speakers.map(withImage(images)), limit, cursor, (s) => [
          nameKey(s.name),
          s.id,
        ]);
        return cachedJson(c, toWire(SpeakerPage, page), PRIVATE_CACHE);
      })
      .openapi(routes.speaker, async (c) => {
        const { eventId, speakerId } = c.req.valid('param');
        await eventOf(c, deps, eventId);
        const p = await executeQuery(programQuery, { eventId }, c.get('ctx'), ports);
        const found = p.speakers.find((s) => s.id === speakerId);
        if (!found) throw new DomainError('not_found', 'Speaker not found');
        const speaker = withImage(
          await orgProgramImages(c, deps, originOf(deps, c), { speaker: [speakerId] }),
        )(found);
        const name = <T extends { id: string; name: string }>(list: readonly T[], id: string | null) =>
          list.find((x) => x.id === id)?.name ?? null;
        const sessions = p.sessions
          .filter((s) => s.speakerIds.includes(speakerId))
          .map((s) =>
            AgendaSession.parse({
              ...s,
              startsAt: s.startsAt.toISOString(),
              endsAt: s.endsAt.toISOString(),
              dateId: s.occurrenceId,
              track: name(p.tracks, s.trackId),
              room: name(p.rooms, s.roomId),
              speakers: s.speakerIds.flatMap((id) => {
                const x = p.speakers.find((y) => y.id === id);
                return x ? [{ id: x.id, name: x.name }] : [];
              }),
            }),
          );
        return cachedJson(c, toWire(SpeakerDetail, { speaker, sessions }), PRIVATE_CACHE);
      })
      .openapi(routes.exhibitors, async (c) => {
        const { limit, cursor } = c.req.valid('query');
        const { eventId } = c.req.valid('param');
        await eventOf(c, deps, eventId);
        const p = await executeQuery(programQuery, { eventId }, c.get('ctx'), ports);
        const images = await orgProgramImages(c, deps, originOf(deps, c), {
          exhibitor: p.exhibitors.map((x) => x.id),
        });
        const page = pageByKey(p.exhibitors.map(withImage(images)), limit, cursor, (x) => [
          nameKey(x.name),
          x.id,
        ]);
        return cachedJson(c, toWire(ExhibitorPage, page), PRIVATE_CACHE);
      })
      .openapi(routes.sponsors, async (c) => {
        const { eventId } = c.req.valid('param');
        await eventOf(c, deps, eventId);
        const p = await executeQuery(programQuery, { eventId }, c.get('ctx'), ports);
        const image = withImage(
          await orgProgramImages(c, deps, originOf(deps, c), { sponsor: p.sponsors.map((s) => s.id) }),
        );
        const data = p.sponsorTiers.map((t) => ({
          ...t,
          sponsors: p.sponsors.filter((s) => s.tierId === t.id).map(image),
        }));
        return cachedJson(c, toWire(SponsorTierList, { data }), PRIVATE_CACHE);
      })
      .openapi(routes.venues, async (c) => {
        const { limit, cursor } = c.req.valid('query');
        const rows = await executeQuery(listVenuesQuery, { includeArchived: true }, c.get('ctx'), ports);
        const page = pageByKey(rows, limit, cursor, (v) => [nameKey(v.name), v.id]);
        return cachedJson(c, toWire(VenuePage, page), PRIVATE_CACHE);
      })
      .openapi(routes.venue, async (c) => {
        const v = await executeQuery(
          getVenueQuery,
          { venueId: c.req.valid('param').venueId },
          c.get('ctx'),
          ports,
        );
        return cachedJson(c, toWire(Venue, v), PRIVATE_CACHE);
      })
  );
}
