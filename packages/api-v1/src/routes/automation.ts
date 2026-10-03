import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { addGuestCommand } from '@yayatoh/attendees';
import { addContactCommand } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { DomainError, executeCommand, executeQuery } from '@yayatoh/kernel';
import { hookSampleQuery, subscribeHookCommand, unsubscribeHookCommand } from '@yayatoh/webhooks';
import { SUBSCRIBABLE_EVENT_TYPES, WebhookEnvelopeBase } from '@yayatoh/webhooks/catalog';
import type { V1Deps, V1Env } from '../context.ts';
import { Attendee, listSchema, toWire } from '../resources.ts';
import {
  body,
  EventParams,
  IdempotencyHeader,
  idempotent,
  json,
  OrgParam,
  orgSecurity,
  problems,
  writeProblems,
} from './common.ts';

/**
 * Automation (M6.4c): what Zapier (and tools like it) need on top of the read API. REST hooks
 * (subscribe a target URL to one event type, unsubscribe, a sample delivery for setup), adding a
 * contact and registering someone for an event. Writes take an Idempotency-Key like every write.
 */

export const HookEventType = z
  .enum(SUBSCRIBABLE_EVENT_TYPES as [string, ...string[]])
  .openapi('HookEventType', { description: 'A public event type (see the `webhooks` section).' });

export const HookSubscribeRequest = z
  .object({
    url: z.url().max(2048).openapi({
      description: 'Where to deliver: https on port 443, a public host.',
      example: 'https://hooks.zapier.com/hooks/standard/123/abc',
    }),
    event: HookEventType,
  })
  .openapi('HookSubscribeRequest');

export const Hook = z
  .object({
    id: z.uuid().openapi({ description: 'Keep it to unsubscribe.' }),
    event: HookEventType,
    createdAt: z.iso.datetime(),
  })
  .openapi('Hook');

export const HookSample = WebhookEnvelopeBase.extend({
  data: z.record(z.string(), z.unknown()).openapi({ description: 'The event’s thin payload.' }),
}).openapi('HookSample');
const HookSampleList = listSchema(HookSample, 'HookSampleList');

export const AddContactRequest = z
  .object({
    email: z.email().max(254),
    name: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .openapi('AddContactRequest');

export const ContactRef = z
  .object({
    id: z.uuid(),
    created: z
      .boolean()
      .openapi({ description: 'False when the org already had this email (nothing was duplicated).' }),
  })
  .openapi('ContactRef');

export const CreateRegistrationRequest = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.email().max(254),
    labels: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  })
  .openapi('CreateRegistrationRequest');

const HookParams = OrgParam.extend({
  hookId: z.uuid().openapi({ param: { name: 'hookId', in: 'path' }, description: 'The hook id' }),
});

const routes = {
  subscribe: createRoute({
    method: 'post',
    path: '/orgs/{org}/hooks',
    operationId: 'subscribeHook',
    tags: ['hooks'],
    summary: 'Subscribe a URL to one event type (scope `webhooks:subscribe`)',
    description:
      'A REST hook (Zapier-style): deliveries are the same signed, thin messages as Settings → Webhooks endpoints. It appears there too, where the organizer can remove it.',
    security: orgSecurity,
    request: { params: OrgParam, headers: IdempotencyHeader, ...body(HookSubscribeRequest) },
    responses: { 201: json(Hook, 'Subscribed'), ...writeProblems },
  }),
  unsubscribe: createRoute({
    method: 'delete',
    path: '/orgs/{org}/hooks/{hookId}',
    operationId: 'unsubscribeHook',
    tags: ['hooks'],
    summary: 'Unsubscribe a REST hook (scope `webhooks:subscribe`)',
    description:
      'Removes a hook made through this API (never an endpoint the organizer made). A hook that is already gone answers 204 too.',
    security: orgSecurity,
    request: { params: HookParams },
    responses: { 204: { description: 'Unsubscribed' }, ...writeProblems },
  }),
  sample: createRoute({
    method: 'get',
    path: '/orgs/{org}/hooks/samples',
    operationId: 'listHookSamples',
    tags: ['hooks'],
    summary: 'A sample delivery for an event type (scope `webhooks:subscribe`)',
    description:
      'Example data with the delivery’s exact shape, for setting up an automation before a real event happens.',
    security: orgSecurity,
    request: { params: OrgParam, query: z.object({ event: HookEventType }) },
    responses: { 200: json(HookSampleList, 'One sample message'), ...problems },
  }),
  addContact: createRoute({
    method: 'post',
    path: '/orgs/{org}/contacts',
    operationId: 'addContact',
    tags: ['contacts'],
    summary: 'Add a contact (scope `contacts:write`)',
    description:
      'Finds or creates the org’s contact for the email; an existing contact keeps its name unless it had none. Records no marketing consent.',
    security: orgSecurity,
    request: { params: OrgParam, headers: IdempotencyHeader, ...body(AddContactRequest) },
    responses: { 200: json(ContactRef, 'The contact'), ...writeProblems },
  }),
  register: createRoute({
    method: 'post',
    path: '/orgs/{org}/events/{eventId}/registrations',
    operationId: 'createRegistration',
    tags: ['attendees'],
    summary: 'Register someone for an event (scope `attendees:write`)',
    description:
      'Adds a person to the event’s guest list (no ticket, no payment). One active registration per email per event: a second one is a 409.',
    security: orgSecurity,
    request: { params: EventParams, headers: IdempotencyHeader, ...body(CreateRegistrationRequest) },
    responses: { 201: json(Attendee, 'Registered'), ...writeProblems },
  }),
};

export function automationRoutes(deps: V1Deps) {
  const { ports } = deps;
  return new OpenAPIHono<V1Env>()
    .openapi(routes.subscribe, async (c) => {
      const h = await executeCommand(
        idempotent(subscribeHookCommand),
        c.req.valid('json'),
        c.get('ctx'),
        ports,
      );
      return c.json(toWire(Hook, h), 201);
    })
    .openapi(routes.unsubscribe, async (c) => {
      await executeCommand(
        unsubscribeHookCommand,
        { hookId: c.req.valid('param').hookId },
        c.get('ctx'),
        ports,
      );
      return c.body(null, 204);
    })
    .openapi(routes.sample, async (c) => {
      const sample = await executeQuery(hookSampleQuery, c.req.valid('query'), c.get('ctx'), ports);
      return c.json(toWire(HookSampleList, { data: [sample] }), 200);
    })
    .openapi(routes.addContact, async (c) => {
      const { email, name } = c.req.valid('json');
      const r = await executeCommand(
        idempotent(addContactCommand),
        { email, name: name ?? null },
        c.get('ctx'),
        ports,
      );
      return c.json(toWire(ContactRef, r), 200);
    })
    .openapi(routes.register, async (c) => {
      // The guest-list command trusts its caller's event id (the console's own pages): from outside,
      // the event must be one of this org's (RLS shows no other org's events).
      const { eventId } = c.req.valid('param');
      if (!(await withTenant(c.get('ctx'), (tx) => findEventTx(tx, eventId))))
        throw new DomainError('not_found', 'Event not found');
      const a = await executeCommand(
        idempotent(addGuestCommand),
        { ...c.req.valid('json'), eventId: c.req.valid('param').eventId },
        c.get('ctx'),
        ports,
      );
      return c.json(toWire(Attendee, a), 201);
    });
}
