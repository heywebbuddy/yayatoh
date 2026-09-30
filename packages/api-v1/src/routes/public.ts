import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { publicEventBySlug } from '@yayatoh/events';
import { DomainError } from '@yayatoh/kernel';
import { publicTicketTypes } from '@yayatoh/ticketing';
import type { V1Env } from '../context.ts';
import { listSchema, PublicEvent, PublicTicketType, toWire } from '../resources.ts';
import { json, publicProblems, SlugParam } from './common.ts';

const PublicTicketTypeList = listSchema(PublicTicketType, 'PublicTicketTypeList');

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

/** Anonymous reads: drafts and private events are never visible (SECURITY DEFINER + allowlist). */
export function publicRoutes() {
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
    });
}
