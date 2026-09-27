import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { publicEventBySlug } from '@yayatoh/events';
import { DomainError } from '@yayatoh/kernel';
import { publicTicketTypes } from '@yayatoh/ticketing';
import type { V1Env } from '../context.ts';
import { listSchema, PublicEvent, PublicTicketType, toWire } from '../resources.ts';
import { json, publicProblems } from './common.ts';

const SlugParam = z.object({
  slug: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9-]+$/)
    .openapi({ param: { name: 'slug', in: 'path' }, example: 'lakeside-jazz-night' }),
});
const PublicTicketTypeList = listSchema(PublicTicketType, 'PublicTicketTypeList');

const event = createRoute({
  method: 'get',
  path: '/public/events/{slug}',
  tags: ['public'],
  summary: 'A published event’s public page data (no credential)',
  request: { params: SlugParam },
  responses: { 200: json(PublicEvent, 'The public event'), ...publicProblems },
});
const ticketTypes = createRoute({
  method: 'get',
  path: '/public/events/{slug}/ticket-types',
  tags: ['public'],
  summary: 'A published event’s passes with all-in prices and availability (no credential)',
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
