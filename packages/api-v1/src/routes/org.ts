import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  createEventCommand,
  EVENT_PROFILES,
  EVENT_VISIBILITIES,
  getEventQuery,
  listEventsQuery,
  transitionEventCommand,
  updateEventCommand,
} from '@yayatoh/events';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { getOrganizationQuery } from '@yayatoh/tenancy';
import {
  createTicketTypeCommand,
  FEE_MODES,
  listTicketTypesQuery,
  TICKET_TYPE_VISIBILITIES,
  updateTicketTypeCommand,
} from '@yayatoh/ticketing';
import type { V1Deps, V1Env } from '../context.ts';
import { decodeCursor, pageOf } from '../cursor.ts';
import { Event, listSchema, Organization, pageSchema, TicketType, toWire } from '../resources.ts';
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

const DateTime = z.iso.datetime({ offset: true });

const EventFields = {
  name: z.string().min(2).max(160),
  tagline: z.string().max(280).nullable(),
  profile: z.enum(EVENT_PROFILES),
  visibility: z.enum(EVENT_VISIBILITIES),
  timezone: z.string().openapi({ example: 'America/Chicago' }),
  startsAt: DateTime,
  endsAt: DateTime,
  venueName: z.string().max(160).nullable(),
  city: z.string().max(120).nullable(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  slug: z.string().min(2).max(63),
};
const CreateEventBody = z
  .object(EventFields)
  .partial()
  .required({ name: true, timezone: true, startsAt: true, endsAt: true })
  .openapi('CreateEventRequest');
const UpdateEventBody = z.object(EventFields).partial().openapi('UpdateEventRequest');

const TicketTypeFields = {
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable(),
  priceMinor: z.int().min(0).max(100_000_000),
  feeMode: z.enum(FEE_MODES),
  quantityTotal: z.int().min(0).max(1_000_000),
  minPerOrder: z.int().min(1).max(100),
  maxPerOrder: z.int().min(1).max(100),
  salesStartAt: DateTime.nullable(),
  salesEndAt: DateTime.nullable(),
  visibility: z.enum(TICKET_TYPE_VISIBILITIES),
  sortOrder: z.int(),
  earlyPriceMinor: z.int().min(0).max(100_000_000).nullable(),
  earlyEndsAt: DateTime.nullable(),
  isDonation: z.boolean(),
};
const CreateTicketTypeBody = z
  .object(TicketTypeFields)
  .partial()
  .required({ name: true, priceMinor: true, quantityTotal: true })
  .openapi('CreateTicketTypeRequest');
const UpdateTicketTypeBody = z.object(TicketTypeFields).partial().openapi('UpdateTicketTypeRequest');

const EventPage = pageSchema(Event, 'EventPage');
const TicketTypeList = listSchema(TicketType, 'TicketTypeList');

const routes = {
  org: createRoute({
    method: 'get',
    path: '/orgs/{org}',
    tags: ['organizations'],
    summary: 'The organization',
    security: orgSecurity,
    request: { params: OrgParam },
    responses: { 200: json(Organization, 'The organization'), ...problems },
  }),
  listEvents: createRoute({
    method: 'get',
    path: '/orgs/{org}/events',
    tags: ['events'],
    summary: 'Events by start time (scope `events:read`)',
    security: orgSecurity,
    request: { params: OrgParam, query: PageQuery },
    responses: { 200: json(EventPage, 'A page of events'), ...problems },
  }),
  createEvent: createRoute({
    method: 'post',
    path: '/orgs/{org}/events',
    tags: ['events'],
    summary: 'Create a draft event (scope `events:write`)',
    security: orgSecurity,
    request: { params: OrgParam, headers: IdempotencyHeader, ...body(CreateEventBody) },
    responses: { 201: json(Event, 'The new draft event'), ...writeProblems },
  }),
  getEvent: createRoute({
    method: 'get',
    path: '/orgs/{org}/events/{eventId}',
    tags: ['events'],
    summary: 'One event (scope `events:read`)',
    security: orgSecurity,
    request: { params: EventParams },
    responses: { 200: json(Event, 'The event'), ...problems },
  }),
  updateEvent: createRoute({
    method: 'patch',
    path: '/orgs/{org}/events/{eventId}',
    tags: ['events'],
    summary: 'Change an event (scope `events:write`)',
    security: orgSecurity,
    request: { params: EventParams, headers: IdempotencyHeader, ...body(UpdateEventBody) },
    responses: { 200: json(Event, 'The event'), ...writeProblems },
  }),
  publishEvent: createRoute({
    method: 'post',
    path: '/orgs/{org}/events/{eventId}/publish',
    tags: ['events'],
    summary: 'Publish a draft event (scope `events:write`)',
    security: orgSecurity,
    request: { params: EventParams, headers: IdempotencyHeader },
    responses: { 200: json(Event, 'The published event'), ...writeProblems },
  }),
  listTicketTypes: createRoute({
    method: 'get',
    path: '/orgs/{org}/events/{eventId}/ticket-types',
    tags: ['ticket types'],
    summary: 'The event’s ticket types (scope `events:read`)',
    security: orgSecurity,
    request: { params: EventParams },
    responses: { 200: json(TicketTypeList, 'Ticket types in display order'), ...problems },
  }),
  createTicketType: createRoute({
    method: 'post',
    path: '/orgs/{org}/events/{eventId}/ticket-types',
    tags: ['ticket types'],
    summary: 'Add a ticket type (scope `events:write`)',
    security: orgSecurity,
    request: { params: EventParams, headers: IdempotencyHeader, ...body(CreateTicketTypeBody) },
    responses: { 201: json(TicketType, 'The new ticket type'), ...writeProblems },
  }),
  updateTicketType: createRoute({
    method: 'patch',
    path: '/orgs/{org}/ticket-types/{ticketTypeId}',
    tags: ['ticket types'],
    summary: 'Change a ticket type (scope `events:write`)',
    security: orgSecurity,
    request: {
      params: OrgParam.extend({ ticketTypeId: z.uuid() }),
      headers: IdempotencyHeader,
      ...body(UpdateTicketTypeBody),
    },
    responses: { 200: json(TicketType, 'The ticket type'), ...writeProblems },
  }),
};

export function orgRoutes(deps: V1Deps) {
  const { ports } = deps;
  return new OpenAPIHono<V1Env>()
    .openapi(routes.org, async (c) =>
      c.json(toWire(Organization, await executeQuery(getOrganizationQuery, {}, c.get('ctx'), ports)), 200),
    )
    .openapi(routes.listEvents, async (c) => {
      const { limit, cursor } = c.req.valid('query');
      const rows = await executeQuery(
        listEventsQuery,
        { limit: limit + 1, after: decodeCursor(cursor) },
        c.get('ctx'),
        ports,
      );
      return c.json(
        toWire(
          EventPage,
          pageOf(rows, limit, (e) => ({ at: e.startsAt, id: e.id })),
        ),
        200,
      );
    })
    .openapi(routes.createEvent, async (c) => {
      const e = await executeCommand(
        idempotent(createEventCommand),
        c.req.valid('json'),
        c.get('ctx'),
        ports,
      );
      return c.json(toWire(Event, e), 201);
    })
    .openapi(routes.getEvent, async (c) => {
      const e = await executeQuery(
        getEventQuery,
        { eventId: c.req.valid('param').eventId },
        c.get('ctx'),
        ports,
      );
      return c.json(toWire(Event, e), 200);
    })
    .openapi(routes.updateEvent, async (c) => {
      const e = await executeCommand(
        idempotent(updateEventCommand),
        { ...c.req.valid('json'), eventId: c.req.valid('param').eventId },
        c.get('ctx'),
        ports,
      );
      return c.json(toWire(Event, e), 200);
    })
    .openapi(routes.publishEvent, async (c) => {
      const e = await executeCommand(
        idempotent(transitionEventCommand),
        { eventId: c.req.valid('param').eventId, transition: 'publish' },
        c.get('ctx'),
        ports,
      );
      return c.json(toWire(Event, e), 200);
    })
    .openapi(routes.listTicketTypes, async (c) => {
      // A foreign or unknown event is a 404, not an empty list.
      await executeQuery(getEventQuery, { eventId: c.req.valid('param').eventId }, c.get('ctx'), ports);
      const rows = await executeQuery(
        listTicketTypesQuery,
        { eventId: c.req.valid('param').eventId },
        c.get('ctx'),
        ports,
      );
      return c.json(toWire(TicketTypeList, { data: rows }), 200);
    })
    .openapi(routes.createTicketType, async (c) => {
      const t = await executeCommand(
        idempotent(createTicketTypeCommand),
        { ...c.req.valid('json'), eventId: c.req.valid('param').eventId },
        c.get('ctx'),
        ports,
      );
      return c.json(toWire(TicketType, t), 201);
    })
    .openapi(routes.updateTicketType, async (c) => {
      const t = await executeCommand(
        idempotent(updateTicketTypeCommand),
        { ...c.req.valid('json'), ticketTypeId: c.req.valid('param').ticketTypeId },
        c.get('ctx'),
        ports,
      );
      return c.json(toWire(TicketType, t), 200);
    });
}
