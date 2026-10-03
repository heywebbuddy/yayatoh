import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { createEndpointCommand, deleteEndpointCommand, listEndpointsQuery } from '@yayatoh/webhooks';
import { SUBSCRIBABLE_EVENT_TYPES } from '@yayatoh/webhooks/catalog';
import type { V1Deps, V1Env } from '../context.ts';
import { listSchema, toWire } from '../resources.ts';
import {
  body,
  IdempotencyHeader,
  idempotent,
  json,
  OrgParam,
  orgSecurity,
  problems,
  writeProblems,
} from './common.ts';

/**
 * Webhook subscriptions over /v1 (M6.5c): what Make and n8n instant triggers call when a scenario
 * or workflow is turned on (subscribe) and off (unsubscribe), the REST-hook pattern. The same
 * commands as Settings → Webhooks (`webhooks:manage`, the `api_access` module, the URL checks and
 * the per-org endpoint limit); an API key needs the `webhooks:manage` scope. Messages are the
 * catalog's thin, signed payloads; signing secrets, test sends and replays stay in the console.
 */

export const SubscribableEventType = z
  .enum(SUBSCRIBABLE_EVENT_TYPES as [string, ...string[]])
  .openapi('SubscribableEventType', { description: 'A webhook event type (see `webhooks`).' });

export const WebhookEndpoint = z
  .object({
    id: z.uuid(),
    url: z.string().openapi({ description: 'Where messages are sent (https).' }),
    description: z.string(),
    eventTypes: z.array(SubscribableEventType).openapi({ description: 'Empty: every subscribable type.' }),
    status: z.enum(['active', 'disabled']).openapi('WebhookEndpointStatus'),
    createdAt: z.iso.datetime(),
  })
  .openapi('WebhookEndpoint');

const CreateWebhookEndpointBody = z
  .object({
    url: z.string().min(1).max(2048).openapi({
      description: 'An https URL on the public internet (Make’s or n8n’s webhook URL).',
      example: 'https://hook.eu1.make.com/abc123',
    }),
    description: z.string().max(200).default('').openapi({ example: 'Make: order paid' }),
    eventTypes: z.array(SubscribableEventType).min(1).max(SUBSCRIBABLE_EVENT_TYPES.length),
  })
  .openapi('CreateWebhookEndpointRequest');

const EndpointParams = OrgParam.extend({
  endpointId: z.uuid().openapi({ param: { name: 'endpointId', in: 'path' }, description: 'The endpoint id' }),
});

const WebhookEndpointList = listSchema(WebhookEndpoint, 'WebhookEndpointList');
const Deleted = z.object({ deleted: z.literal(true) }).openapi('WebhookEndpointDeleted');

const routes = {
  list: createRoute({
    method: 'get',
    path: '/orgs/{org}/webhook-endpoints',
    operationId: 'listWebhookEndpoints',
    tags: ['webhooks'],
    summary: 'The org’s webhook endpoints (scope `webhooks:manage`)',
    description:
      'Every webhook endpoint of the organization, oldest first: where it sends and which event types. Never the signing secret.\n\nScope `webhooks:manage`.',
    security: orgSecurity,
    request: { params: OrgParam },
    responses: { 200: json(WebhookEndpointList, 'The endpoints'), ...problems },
  }),
  create: createRoute({
    method: 'post',
    path: '/orgs/{org}/webhook-endpoints',
    operationId: 'createWebhookEndpoint',
    tags: ['webhooks'],
    summary: 'Subscribe a URL to event types (scope `webhooks:manage`)',
    description:
      'Adds a webhook endpoint (REST hooks: Make and n8n instant triggers call this when turned on). The URL must be https on the public internet; an org has at most 20 endpoints. Needs an `Idempotency-Key`.\n\nScope `webhooks:manage`.',
    security: orgSecurity,
    request: { params: OrgParam, headers: IdempotencyHeader, ...body(CreateWebhookEndpointBody) },
    responses: { 201: json(WebhookEndpoint, 'The new endpoint'), ...writeProblems },
  }),
  remove: createRoute({
    method: 'delete',
    path: '/orgs/{org}/webhook-endpoints/{endpointId}',
    operationId: 'deleteWebhookEndpoint',
    tags: ['webhooks'],
    summary: 'Unsubscribe: delete a webhook endpoint (scope `webhooks:manage`)',
    description:
      'Deletes the endpoint; no message is sent to it afterwards (Make and n8n call this when a trigger is turned off). Needs an `Idempotency-Key`.\n\nScope `webhooks:manage`.',
    security: orgSecurity,
    request: { params: EndpointParams, headers: IdempotencyHeader },
    responses: { 200: json(Deleted, 'Deleted'), ...writeProblems },
  }),
};

export function hookRoutes(deps: V1Deps) {
  const { ports } = deps;
  return new OpenAPIHono<V1Env>()
    .openapi(routes.list, async (c) => {
      const rows = await executeQuery(listEndpointsQuery, {}, c.get('ctx'), ports);
      return c.json(toWire(WebhookEndpointList, { data: rows }), 200);
    })
    .openapi(routes.create, async (c) => {
      const e = await executeCommand(
        idempotent(createEndpointCommand),
        c.req.valid('json'),
        c.get('ctx'),
        ports,
      );
      return c.json(toWire(WebhookEndpoint, e), 201);
    })
    .openapi(routes.remove, async (c) => {
      const r = await executeCommand(
        idempotent(deleteEndpointCommand),
        { endpointId: c.req.valid('param').endpointId },
        c.get('ctx'),
        ports,
      );
      return c.json(toWire(Deleted, r), 200);
    });
}
