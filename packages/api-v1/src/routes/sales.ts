import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  ATTENDEE_STATUSES,
  getAttendeeQuery,
  listAttendeesQuery,
  searchAttendeesQuery,
} from '@yayatoh/attendees';
import { scanTicketCommand } from '@yayatoh/checkin';
import { DomainError, executeCommand, executeQuery } from '@yayatoh/kernel';
import { listOrdersQuery, orderDetailQuery, refundOrder, startRefundCommand } from '@yayatoh/orders';
import type { Principal, V1Deps, V1Env } from '../context.ts';
import { decodeCursor, pageOf } from '../cursor.ts';
import { RATE_LIMITS, type RateLimiter } from '../rate-limit.ts';
import {
  Attendee,
  AttendeeHit,
  listSchema,
  Order,
  OrderDetail,
  pageSchema,
  Refund,
  RefundRequest,
  ScanVerdict,
  toWire,
} from '../resources.ts';
import {
  body,
  EventParams,
  IdempotencyHeader,
  idempotent,
  json,
  OrgParam,
  orgSecurity,
  PageQuery,
  problems,
  writeProblems,
} from './common.ts';

const OrderPage = pageSchema(Order, 'OrderPage');
const AttendeePage = pageSchema(Attendee, 'AttendeePage');
const AttendeeHitList = listSchema(AttendeeHit, 'AttendeeHitList');
const OrderParams = OrgParam.extend({ orderId: z.uuid() });

export const ScanRequest = z
  .object({
    code: z
      .string()
      .min(1)
      .max(400)
      .openapi({ description: 'The QR payload (`yy1…`) or the printed short code.' }),
    checkpointId: z.uuid().optional(),
  })
  .openapi('ScanRequest');

const routes = {
  listOrders: createRoute({
    method: 'get',
    path: '/orgs/{org}/events/{eventId}/orders',
    tags: ['orders'],
    summary: 'The event’s orders, newest first (scope `orders:read`)',
    security: orgSecurity,
    request: { params: EventParams, query: PageQuery },
    responses: { 200: json(OrderPage, 'A page of orders'), ...problems },
  }),
  getOrder: createRoute({
    method: 'get',
    path: '/orgs/{org}/orders/{orderId}',
    tags: ['orders'],
    summary: 'One order with its tickets (scope `orders:read`)',
    security: orgSecurity,
    request: { params: OrderParams },
    responses: { 200: json(OrderDetail, 'The order'), ...problems },
  }),
  refund: createRoute({
    method: 'post',
    path: '/orgs/{org}/orders/{orderId}/refunds',
    tags: ['orders'],
    summary: 'Refund tickets or an amount under the refund policy (scope `orders:refund`)',
    security: orgSecurity,
    request: { params: OrderParams, headers: IdempotencyHeader, ...body(RefundRequest) },
    responses: { 201: json(Refund, 'The refund and its outcome'), ...writeProblems },
  }),
  listAttendees: createRoute({
    method: 'get',
    path: '/orgs/{org}/events/{eventId}/attendees',
    tags: ['attendees'],
    summary: 'The event’s attendees, newest first (scope `attendees:read`)',
    security: orgSecurity,
    request: {
      params: EventParams,
      query: PageQuery.extend({
        search: z.string().max(200).optional().openapi({ description: 'Name or email contains' }),
        status: z.enum(ATTENDEE_STATUSES).optional(),
      }),
    },
    responses: { 200: json(AttendeePage, 'A page of attendees'), ...problems },
  }),
  getAttendee: createRoute({
    method: 'get',
    path: '/orgs/{org}/events/{eventId}/attendees/{attendeeId}',
    tags: ['attendees'],
    summary: 'One attendee (scope `attendees:read`)',
    security: orgSecurity,
    request: { params: EventParams.extend({ attendeeId: z.uuid() }) },
    responses: { 200: json(Attendee, 'The attendee'), ...problems },
  }),
  searchAttendees: createRoute({
    method: 'get',
    path: '/orgs/{org}/attendees/search',
    tags: ['attendees'],
    summary: 'Search attendees across events by name or email (scope `attendees:read`; 60/min)',
    security: orgSecurity,
    request: {
      params: OrgParam,
      query: z.object({
        q: z.string().min(2).max(200),
        limit: z.coerce.number().int().min(1).max(50).default(10),
      }),
    },
    responses: { 200: json(AttendeeHitList, 'Matches, newest first'), ...problems },
  }),
  checkin: createRoute({
    method: 'post',
    path: '/orgs/{org}/events/{eventId}/checkins',
    tags: ['check-in'],
    summary: 'Scan a ticket online and get the door verdict (scope `checkin:scan`)',
    description:
      'The same engine as the Scan PWA. Retrying with the same Idempotency-Key returns the first verdict instead of a duplicate.',
    security: orgSecurity,
    request: { params: EventParams, headers: IdempotencyHeader, ...body(ScanRequest) },
    responses: { 200: json(ScanVerdict, 'The verdict'), ...writeProblems },
  }),
};

export function salesRoutes(
  deps: V1Deps,
  limiter: RateLimiter,
  credentialKey: (p: Principal | null) => string,
) {
  const { ports } = deps;
  return new OpenAPIHono<V1Env>()
    .openapi(routes.listOrders, async (c) => {
      const { limit, cursor } = c.req.valid('query');
      const rows = await executeQuery(
        listOrdersQuery,
        { eventId: c.req.valid('param').eventId, limit: limit + 1, after: decodeCursor(cursor) },
        c.get('ctx'),
        ports,
      );
      return c.json(
        toWire(
          OrderPage,
          pageOf(rows, limit, (o) => ({ at: o.createdAt, id: o.id })),
        ),
        200,
      );
    })
    .openapi(routes.getOrder, async (c) => {
      const o = await executeQuery(
        orderDetailQuery,
        { orderId: c.req.valid('param').orderId },
        c.get('ctx'),
        ports,
      );
      return c.json(toWire(OrderDetail, o), 200);
    })
    .openapi(routes.refund, async (c) => {
      const r = await refundOrder(
        { ...c.req.valid('json'), orderId: c.req.valid('param').orderId },
        c.get('ctx'),
        ports,
        deps.payments(),
        idempotent(startRefundCommand),
      );
      return c.json(toWire(Refund, r), 201);
    })
    .openapi(routes.listAttendees, async (c) => {
      const { limit, cursor, search, status } = c.req.valid('query');
      const r = await executeQuery(
        listAttendeesQuery,
        {
          eventId: c.req.valid('param').eventId,
          limit: limit + 1,
          after: decodeCursor(cursor),
          ...(search ? { search } : {}),
          ...(status ? { status } : {}),
        },
        c.get('ctx'),
        ports,
      );
      return c.json(
        toWire(
          AttendeePage,
          pageOf(r.items, limit, (a) => ({ at: a.createdAt, id: a.id })),
        ),
        200,
      );
    })
    .openapi(routes.getAttendee, async (c) => {
      const a = await executeQuery(getAttendeeQuery, c.req.valid('param'), c.get('ctx'), ports);
      return c.json(toWire(Attendee, a), 200);
    })
    .openapi(routes.searchAttendees, async (c) => {
      const d = limiter.take(
        `search:${credentialKey(c.get('principal'))}`,
        RATE_LIMITS.search.limit,
        RATE_LIMITS.search.window,
      );
      if (!d.allowed)
        throw new DomainError('rate_limited', 'Too many searches', { retryAfter: d.resetSeconds });
      const hits = await executeQuery(searchAttendeesQuery, c.req.valid('query'), c.get('ctx'), ports);
      return c.json(toWire(AttendeeHitList, { data: hits }), 200);
    })
    .openapi(routes.checkin, async (c) => {
      const key = c.req.valid('header')['idempotency-key'];
      if (key.length > 80)
        throw new DomainError('validation_failed', 'Idempotency-Key is at most 80 characters for scans');
      const v = await executeCommand(
        scanTicketCommand,
        { ...c.req.valid('json'), eventId: c.req.valid('param').eventId, clientScanId: key },
        c.get('ctx'),
        ports,
      );
      return c.json(toWire(ScanVerdict, v), 200);
    });
}
