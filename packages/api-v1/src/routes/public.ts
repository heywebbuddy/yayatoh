import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { publicEventBySlug } from '@yayatoh/events';
import { DomainError } from '@yayatoh/kernel';
import {
  PUBLIC_EVENTS_DEFAULT_RADIUS_KM,
  PUBLIC_EVENTS_MAX_RADIUS_KM,
  type PublicEventHit,
  type PublicEventsAfter,
  searchPublicEvents,
} from '@yayatoh/marketplace';
import { publicTicketTypes } from '@yayatoh/ticketing';
import { appCheckout, WEB_REASONS } from '../app-checkout.ts';
import type { Principal, V1Deps, V1Env } from '../context.ts';
import { RATE_LIMITS, type RateLimiter } from '../rate-limit.ts';
import {
  EventCategory,
  EventProfile,
  EventStatus,
  listSchema,
  PublicEvent,
  PublicTicketType,
  pageSchema,
  toWire,
} from '../resources.ts';
import { resolveMobile } from '../versions.ts';
import {
  body,
  IdempotencyHeader,
  json,
  KeyPageQuery,
  publicProblems,
  SlugParam,
  userSecurity,
  writeProblems,
} from './common.ts';

const PublicTicketTypeList = listSchema(PublicTicketType, 'PublicTicketTypeList');
const iso = z.iso.datetime({ offset: true });

const event = createRoute({
  method: 'get',
  path: '/public/events/{slug}',
  operationId: 'getPublicEvent',
  tags: ['public'],
  summary: 'A published event’s public page data (no credential)',
  description:
    'The allowlisted public data of an event with a public page (public or unlisted). Private events and drafts are a 404. No credential.',
  request: { params: SlugParam },
  responses: { 200: json(PublicEvent, 'The public event'), ...publicProblems },
});
const ticketTypes = createRoute({
  method: 'get',
  path: '/public/events/{slug}/ticket-types',
  operationId: 'listPublicTicketTypes',
  tags: ['public'],
  summary: 'A published event’s passes with all-in prices and availability (no credential)',
  description:
    'The event’s on-sale passes with all-in prices (fees included when passed on) and availability. Hidden passes never appear. No credential.',
  request: { params: SlugParam },
  responses: { 200: json(PublicTicketTypeList, 'Public passes'), ...publicProblems },
});

/* ----------------------------------------------------------------------------- search ---- */

const When = z.union([z.iso.date(), iso]);

const SearchQuery = KeyPageQuery.extend({
  q: z.string().trim().max(100).optional().openapi({
    description: 'Words in the name, tagline, venue, city or organizer.',
    example: 'jazz',
  }),
  category: EventCategory.optional().openapi({ description: 'A platform category key.' }),
  organizer: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9-]+$/)
    .optional()
    .openapi({ description: 'The organizer’s slug (`organizer.slug` of a result).' }),
  from: When.optional().openapi({
    description:
      'Events still on at or after this moment. A date (`2027-05-01`) means the start of that UTC day.',
  }),
  to: When.optional().openapi({
    description:
      'Events starting before this moment. A date (`2027-05-31`) means the end of that UTC day (the next midnight, exclusive).',
  }),
  lat: z.coerce.number().min(-90).max(90).optional().openapi({
    description: 'With `lng`: only events with a located venue within `radiusKm`, nearest first.',
  }),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce
    .number()
    .min(1)
    .max(PUBLIC_EVENTS_MAX_RADIUS_KM)
    .default(PUBLIC_EVENTS_DEFAULT_RADIUS_KM)
    .openapi({ description: `Kilometres around the point (1–${PUBLIC_EVENTS_MAX_RADIUS_KM}).` }),
});

const PublicEventSummary = z
  .object({
    slug: z.string(),
    name: z.string(),
    tagline: z.string().nullable(),
    profile: EventProfile,
    category: EventCategory.nullable(),
    status: EventStatus,
    timezone: z.string(),
    startsAt: iso,
    endsAt: iso,
    venueName: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string().nullable(),
    currency: z.string(),
    minPriceMinor: z.int().nullable().openapi({ description: 'The cheapest pass, all-in, in minor units.' }),
    maxPriceMinor: z.int().nullable(),
    organizer: z.object({ slug: z.string(), name: z.string() }),
    distanceKm: z.number().nullable().openapi({
      description: 'Kilometres from the search point, to one decimal; null without a point.',
    }),
    url: z.string().openapi({ description: 'The event’s page on the web.' }),
  })
  .openapi('PublicEventSummary');
const PublicEventPage = pageSchema(PublicEventSummary, 'PublicEventPage');

const search = createRoute({
  method: 'get',
  path: '/public/events',
  operationId: 'searchPublicEvents',
  tags: ['public'],
  summary: 'Search the marketplace’s upcoming events (no credential)',
  description:
    'Upcoming and ongoing events listed on the marketplace, by text, platform category, organizer, date range and distance from a point. Soonest first, or nearest first when a point is given. Keyset paging: pass `nextCursor` back as `cursor` (a new event never shifts a page). Private and unlisted events, weddings, drafts and organizers that did not opt in to the marketplace never appear. No credential.',
  request: { query: SearchQuery },
  responses: { 200: json(PublicEventPage, 'A page of events'), ...publicProblems },
});

/** The keyset cursor: where the last page ended, in the sort order of this query. */
function encodePublicCursor(hit: PublicEventHit, byDistance: boolean): string {
  return Buffer.from(
    JSON.stringify(
      byDistance ? ['d', hit.distanceKm, hit.slug] : ['t', hit.startsAt.toISOString(), hit.slug],
    ),
  ).toString('base64url');
}

function decodePublicCursor(cursor: string | undefined, byDistance: boolean): PublicEventsAfter | undefined {
  if (cursor === undefined || cursor === '') return undefined;
  const bad = () => new DomainError('validation_failed', 'Invalid cursor', { field: 'cursor' });
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(v) || v.length !== 3) throw bad();
    const [kind, key, slug] = v as [unknown, unknown, unknown];
    if (typeof slug !== 'string' || !/^[a-z0-9-]{2,63}$/.test(slug)) throw bad();
    // A cursor from a time-ordered search does not continue a distance-ordered one, and back.
    if (kind === 'd' && byDistance && typeof key === 'number' && Number.isFinite(key))
      return { slug, distanceKm: key };
    if (kind === 't' && !byDistance && typeof key === 'string') {
      const at = new Date(key);
      if (!Number.isNaN(at.getTime())) return { slug, startsAt: at };
    }
  } catch (e) {
    if (e instanceof DomainError) throw e;
  }
  throw bad();
}

/** `2027-05-01` is a UTC day (its start, or with `end` the next midnight); an instant is itself. */
function whenOf(v: string | undefined, end: boolean): Date | undefined {
  if (!v) return undefined;
  const at = new Date(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && end ? new Date(at.getTime() + 86_400_000) : at;
}

const knownIp = (ip: string) => (ip === 'unknown' ? null : ip);

/* ---------------------------------------------------------------------------- checkout ---- */

const CheckoutRequest = z
  .object({
    items: z
      .array(
        z.object({
          ticketTypeId: z.uuid().openapi({ description: 'A pass from `listPublicTicketTypes`.' }),
          quantity: z.int().min(1).max(100),
        }),
      )
      .min(1)
      .max(20),
    occurrenceId: z.uuid().optional().openapi({
      description: 'The chosen date of a multi-date event; required when the event has dates.',
    }),
    name: z.string().trim().min(1).max(120).optional().openapi({
      description: 'The name on the order (default: the account’s name). The email is always the account’s.',
    }),
    promoCode: z
      .string()
      .trim()
      .max(64)
      .optional()
      .openapi({ description: 'A promo code of the event, an organization coupon, or a store credit code.' }),
    marketingOptIn: z
      .boolean()
      .optional()
      .openapi({ description: 'Only an explicit yes: buying is never consent to marketing.' }),
  })
  .openapi('AppCheckoutRequest');

const CheckoutResponse = z
  .object({
    action: z.enum(['pay', 'paid', 'web']).openapi({
      description:
        '`pay`: open `paymentUrl` in a secure in-app browser session. `paid`: nothing to pay (a free cart); the tickets are issued. `web`: the app cannot finish this cart; open `webUrl` instead (nothing is held).',
    }),
    orderId: z.uuid().nullable(),
    paymentUrl: z.string().nullable().openapi({
      description:
        'The provider’s hosted payment page. It returns to the app through a universal link on completion or cancellation.',
    }),
    expiresAt: iso
      .nullable()
      .openapi({ description: 'When the held tickets are released if the order is still unpaid.' }),
    webUrl: z.string().nullable().openapi({
      description: 'The event page where the web checkout runs (open it in the same browser session).',
    }),
    webReason: z.enum(WEB_REASONS).nullable().openapi({
      description:
        'Why this cart finishes on the web: the event asks checkout questions, sells by seat or through registration types, a pass has a transfer fee, or a pass lets the buyer choose the amount.',
    }),
  })
  .openapi('AppCheckoutResult');

const checkout = createRoute({
  method: 'post',
  path: '/public/events/{slug}/checkout',
  operationId: 'startAppCheckout',
  tags: ['public'],
  summary: 'Start a checkout from the app (signed-in person with a verified email)',
  description: [
    'The same steps as the web checkout: the cart is priced all-in from the live passes and held for 10 minutes, then the provider payment is created and attached. The buyer is the signed-in person (their verified email); the response carries the hosted payment page to open in a secure in-app browser session, which returns to the app through a universal link (`…/events/{slug}?checkout=return|cancelled&order={orderId}`).',
    '',
    'Needs an `Idempotency-Key`: a retry returns the same order and payment link while the hold lasts. A free cart is paid at once (`action: paid`).',
    '',
    'A cart the app cannot finish natively (the event asks checkout questions, sells by seat or through registration types, a pass has a transfer fee, or lets the buyer choose the amount) answers `action: web` with the event page to open instead. Passes that give access to a stream are refused: `409`, `details.reason: buy_on_web`, with `details.webUrl`.',
    '',
    'Same rules and rate limits as the web: promo and coupon codes, pass limits, sales windows, the pre-checkout risk rules, and the budget for starting checkouts (`429` with `Retry-After`).',
  ].join('\n'),
  security: userSecurity,
  request: { params: SlugParam, headers: IdempotencyHeader, ...body(CheckoutRequest) },
  responses: {
    200: json(CheckoutResponse, 'The cart finishes on the web (`action: web`)'),
    201: json(CheckoutResponse, 'The order was placed (`action: pay` or `paid`)'),
    ...writeProblems,
  },
});

/* ------------------------------------------------------------------------------ routes ---- */

/**
 * Public reads and the apps' checkout. The reads need no credential: drafts, private events and
 * weddings are never visible (SECURITY DEFINER + allowlist). The checkout is a `/me`-style route
 * (a user bearer session with a verified email; `createV1` mounts `meScope` on it).
 */
export function publicRoutes(
  deps: V1Deps,
  limiter: RateLimiter,
  clientIp: (h: Headers) => string,
  credentialKey: (p: Principal | null) => string,
) {
  const webBase = resolveMobile(deps.mobile).baseUrls.web.replace(/\/+$/, '');
  return new OpenAPIHono<V1Env>()
    .openapi(event, async (c) => {
      const e = await publicEventBySlug(c.req.valid('param').slug);
      if (!e) throw new DomainError('not_found', 'Event not found');
      c.header('cache-control', 'public, max-age=60');
      return c.json(toWire(PublicEvent, e), 200);
    })
    .openapi(ticketTypes, async (c) => {
      const slug = c.req.valid('param').slug;
      if (!(await publicEventBySlug(slug))) throw new DomainError('not_found', 'Event not found');
      c.header('cache-control', 'public, max-age=30');
      return c.json(toWire(PublicTicketTypeList, { data: await publicTicketTypes(slug) }), 200);
    })
    .openapi(search, async (c) => {
      const q = c.req.valid('query');
      // Free-text search over the whole read model costs more than a page read: its own budget,
      // per credential, else per client IP.
      const who = credentialKey(c.get('principal'));
      const d = limiter.take(
        `public-search:${who === 'anon' ? clientIp(c.req.raw.headers) : who}`,
        RATE_LIMITS.search.limit,
        RATE_LIMITS.search.window,
      );
      if (!d.allowed)
        throw new DomainError('rate_limited', 'Too many searches', { retryAfter: d.resetSeconds });
      if ((q.lat === undefined) !== (q.lng === undefined))
        throw new DomainError('validation_failed', 'Give both lat and lng, or neither', { field: 'lat' });
      const from = whenOf(q.from, false);
      const to = whenOf(q.to, true);
      if (from && to && to <= from)
        throw new DomainError('validation_failed', '`to` must be after `from`', { field: 'to' });
      const near =
        q.lat !== undefined && q.lng !== undefined
          ? { lat: q.lat, lng: q.lng, radiusKm: q.radiusKm }
          : undefined;
      const byDistance = near !== undefined;
      const after = decodePublicCursor(q.cursor, byDistance);
      const hits = await searchPublicEvents({
        ...(q.q ? { q: q.q } : {}),
        ...(q.category ? { category: q.category } : {}),
        ...(q.organizer ? { orgSlug: q.organizer } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(near ? { near } : {}),
        ...(after ? { after } : {}),
        limit: q.limit,
      });
      const page = hits.slice(0, q.limit);
      const last = page[page.length - 1];
      c.header('cache-control', 'public, max-age=30');
      return c.json(
        toWire(PublicEventPage, {
          data: page.map((h) => ({
            slug: h.slug,
            name: h.name,
            tagline: h.tagline,
            profile: h.profile,
            category: h.category,
            status: h.status,
            timezone: h.timezone,
            startsAt: h.startsAt,
            endsAt: h.endsAt,
            venueName: h.venueName,
            city: h.city,
            country: h.country,
            currency: h.currency,
            minPriceMinor: h.minPriceMinor,
            maxPriceMinor: h.maxPriceMinor,
            organizer: { slug: h.orgSlug, name: h.orgName },
            distanceKm: h.distanceKm === null ? null : Math.round(h.distanceKm * 10) / 10,
            url: `${h.canonicalHost ? `https://${h.canonicalHost}` : webBase}/events/${h.slug}`,
          })),
          nextCursor: hits.length > q.limit && last ? encodePublicCursor(last, byDistance) : null,
        }),
        200,
      );
    })
    .openapi(checkout, async (c) => {
      const outcome = await appCheckout(deps, {
        me: c.get('me'),
        slug: c.req.valid('param').slug,
        body: c.req.valid('json'),
        requestId: c.get('requestId'),
        idempotencyKey: c.req.valid('header')['idempotency-key'],
        // The limiter counts a shared-IP ceiling only for an address it can trust.
        ip: knownIp(clientIp(c.req.raw.headers)),
      });
      c.header('cache-control', 'no-store');
      if (outcome.action === 'web')
        return c.json(
          toWire(CheckoutResponse, {
            action: 'web',
            orderId: null,
            paymentUrl: null,
            expiresAt: null,
            webUrl: outcome.webUrl,
            webReason: outcome.reason,
          }),
          200,
        );
      return c.json(
        toWire(CheckoutResponse, {
          action: outcome.action,
          orderId: outcome.orderId,
          paymentUrl: outcome.action === 'pay' ? outcome.paymentUrl : null,
          expiresAt: outcome.action === 'pay' ? outcome.expiresAt : null,
          webUrl: null,
          webReason: null,
        }),
        201,
      );
    });
}
