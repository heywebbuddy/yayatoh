import type { TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg, uuidv7 } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { asc, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { catalogEntry, EVENT_CATALOG, envelope, SUBSCRIBABLE_EVENT_TYPES } from './catalog.ts';
import { webhooksRuntime } from './config.ts';
import { type EndpointSpec, WebhookProviderError, type WebhookPublisher } from './port.ts';
import { ENDPOINT_STATUSES, endpoints } from './schema.ts';
import { assertEndpointUrl, MAX_URL_LENGTH } from './url.ts';

/** Endpoints per org (Svix has no limit; this keeps a misbehaving integration in check). */
export const MAX_ENDPOINTS = 10;
/** How far back "recover failed messages" can reach (Svix keeps 30 days on Basic). */
export const RECOVER_MAX_DAYS = 14;

export const EndpointDto = z.object({
  id: z.uuid(),
  url: z.string(),
  description: z.string(),
  eventTypes: z.array(z.string()),
  status: z.enum(ENDPOINT_STATUSES),
  createdAt: z.date(),
});
export type EndpointDto = z.infer<typeof EndpointDto>;

export const DeliveryAttemptDto = z.object({
  attemptId: z.string(),
  messageId: z.string(),
  eventType: z.string(),
  status: z.enum(['succeeded', 'failed', 'pending']),
  responseStatus: z.number().int(),
  attemptedAt: z.date(),
  trigger: z.enum(['scheduled', 'manual']),
  nextAttemptAt: z.date().nullable(),
});
export type DeliveryAttemptDto = z.infer<typeof DeliveryAttemptDto>;

type Row = typeof endpoints.$inferSelect;
const toDto = (r: Row): EndpointDto =>
  EndpointDto.parse({
    id: r.id,
    url: r.url,
    description: r.description,
    eventTypes: r.eventTypes,
    status: r.status,
    createdAt: r.createdAt,
  });

const EventTypes = z
  .array(z.string().refine((t) => SUBSCRIBABLE_EVENT_TYPES.includes(t), { message: 'unknown_event_type' }))
  .max(SUBSCRIBABLE_EVENT_TYPES.length)
  .transform((ts) => [...new Set(ts)].sort());
const Url = z.string().trim().min(1).max(MAX_URL_LENGTH);
const Description = z.string().trim().max(200);
const MessageId = z.string().regex(/^msg_[A-Za-z0-9]{1,64}$/);

function publisher(): WebhookPublisher {
  const p = webhooksRuntime().publisher;
  if (!p)
    throw new DomainError('invalid_state', 'Webhooks are not available on this deployment yet', {
      reason: 'webhooks_unavailable',
    });
  return p;
}

/** A provider failure as a domain error (never the provider's own message to the caller). */
async function provider<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof WebhookProviderError)) throw err;
    if (err.kind === 'not_found') throw new DomainError('not_found');
    if (err.kind === 'invalid')
      throw new DomainError('validation_failed', 'The webhook provider refused this', {
        reason: 'provider_refused',
      });
    throw new DomainError('invalid_state', 'The webhook provider is unavailable; try again', {
      reason: 'provider_unavailable',
    });
  }
}

let eventTypesSynced: Promise<void> | null = null;
/** Register the catalog's event types with the provider once per process (idempotent there). */
async function syncEventTypes(p: WebhookPublisher): Promise<void> {
  eventTypesSynced ??= p
    .syncEventTypes(
      (EVENT_CATALOG as readonly (typeof EVENT_CATALOG)[number][]).map((e) => ({
        name: e.type,
        description: e.summary,
        schemaVersion: e.version,
        schema: z.toJSONSchema(e.schema, { io: 'output' }) as Record<string, unknown>,
        example: e.example as Record<string, unknown>,
      })),
    )
    .catch((err: unknown) => {
      eventTypesSynced = null;
      throw err;
    });
  return eventTypesSynced;
}

async function findEndpoint(tx: TenantTx, id: string): Promise<Row> {
  const [row] = await tx.select().from(endpoints).where(eq(endpoints.id, id));
  if (!row) throw new DomainError('not_found');
  return row;
}

const spec = (r: Pick<Row, 'url' | 'description' | 'eventTypes' | 'status'>): EndpointSpec => ({
  url: r.url,
  description: r.description,
  eventTypes: r.eventTypes,
  disabled: r.status !== 'active',
});

/** Where an endpoint points, for audit (the path and query can hold the receiver's token). */
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

export const listEndpointsQuery = tenantQuery({
  name: 'webhooks.listEndpoints',
  input: z.object({}),
  output: z.array(EndpointDto),
  entitlement: 'api_access',
  permission: 'webhooks:manage',
  handler: async ({ tx }) => {
    const rows = await tx.select().from(endpoints).orderBy(asc(endpoints.createdAt), asc(endpoints.id));
    return rows.map(toDto);
  },
});

export const getEndpointQuery = tenantQuery({
  name: 'webhooks.getEndpoint',
  input: z.object({ endpointId: z.uuid() }),
  output: EndpointDto,
  entitlement: 'api_access',
  permission: 'webhooks:manage',
  handler: async ({ input, tx }) => toDto(await findEndpoint(tx, input.endpointId)),
});

/** The endpoint's recent delivery attempts, newest first, from the provider. */
export const endpointAttemptsQuery = tenantQuery({
  name: 'webhooks.endpointAttempts',
  input: z.object({ endpointId: z.uuid(), limit: z.number().int().min(1).max(100).default(50) }),
  output: z.array(DeliveryAttemptDto),
  entitlement: 'api_access',
  permission: 'webhooks:manage',
  handler: async ({ input, ctx, tx }) => {
    const row = await findEndpoint(tx, input.endpointId);
    const p = publisher();
    const attempts = await provider(() =>
      p.listAttempts(requireOrg(ctx), row.providerEndpointId, input.limit),
    );
    return attempts.map((a) => DeliveryAttemptDto.parse(a));
  },
});

/** A short-lived link to the provider's customer portal for this org (embedded in the console). */
export const webhookPortalQuery = tenantQuery({
  name: 'webhooks.portal',
  input: z.object({}),
  output: z.object({ url: z.url(), origin: z.url() }),
  entitlement: 'api_access',
  permission: 'webhooks:manage',
  handler: async ({ ctx }) => {
    const p = publisher();
    const orgId = requireOrg(ctx);
    await provider(() => p.ensureApplication(orgId, orgId));
    return provider(() => p.portalAccess(orgId));
  },
});

export const createEndpointCommand = tenantCommand({
  name: 'webhooks.createEndpoint',
  input: z.object({ url: Url, description: Description.default(''), eventTypes: EventTypes.default([]) }),
  output: EndpointDto,
  entitlement: 'api_access',
  permission: 'webhooks:manage',
  handler: async ({ input, ctx, tx }) => {
    const p = publisher();
    const orgId = requireOrg(ctx);
    const [n] = await tx.select({ n: count() }).from(endpoints);
    if ((n?.n ?? 0) >= MAX_ENDPOINTS)
      throw new DomainError('invalid_state', `An organization can have ${MAX_ENDPOINTS} endpoints`, {
        reason: 'endpoint_limit',
      });
    await assertEndpointUrl(input.url, webhooksRuntime().resolver);
    const id = uuidv7(ctx.now.getTime());
    const s = {
      url: input.url,
      description: input.description,
      eventTypes: input.eventTypes,
      status: 'active' as const,
    };
    await provider(() => p.ensureApplication(orgId, orgId));
    await provider(() => syncEventTypes(p));
    // The endpoint's uid is our row id: a retry after a failed commit finds the same endpoint.
    const { providerEndpointId } = await provider(() => p.createEndpoint(orgId, id, spec(s)));
    const [row] = await tx
      .insert(endpoints)
      .values({
        id,
        orgId,
        providerEndpointId,
        ...s,
        createdBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return toDto(row);
  },
  audit: (input, r) => ({
    action: 'webhooks.endpoint.create',
    targetType: 'webhook_endpoint',
    targetId: r.id,
    data: { host: hostOf(input.url), eventTypes: r.eventTypes },
  }),
});

export const updateEndpointCommand = tenantCommand({
  name: 'webhooks.updateEndpoint',
  input: z.object({
    endpointId: z.uuid(),
    url: Url.optional(),
    description: Description.optional(),
    eventTypes: EventTypes.optional(),
    enabled: z.boolean().optional(),
  }),
  output: EndpointDto,
  entitlement: 'api_access',
  permission: 'webhooks:manage',
  handler: async ({ input, ctx, tx }) => {
    const p = publisher();
    const row = await findEndpoint(tx, input.endpointId);
    if (input.url !== undefined && input.url !== row.url)
      await assertEndpointUrl(input.url, webhooksRuntime().resolver);
    const next = {
      url: input.url ?? row.url,
      description: input.description ?? row.description,
      eventTypes: input.eventTypes ?? row.eventTypes,
      status: input.enabled === undefined ? row.status : input.enabled ? 'active' : 'disabled',
    };
    await provider(() => p.updateEndpoint(requireOrg(ctx), row.providerEndpointId, spec(next)));
    const [updated] = await tx
      .update(endpoints)
      .set({ ...next, updatedAt: ctx.now })
      .where(eq(endpoints.id, row.id))
      .returning();
    if (!updated) throw new DomainError('internal');
    return toDto(updated);
  },
  audit: (input, r) => ({
    action: 'webhooks.endpoint.update',
    targetType: 'webhook_endpoint',
    targetId: r.id,
    data: {
      fields: Object.keys(input).filter((k) => k !== 'endpointId'),
      host: hostOf(r.url),
      status: r.status,
    },
  }),
});

export const deleteEndpointCommand = tenantCommand({
  name: 'webhooks.deleteEndpoint',
  category: 'delete',
  input: z.object({ endpointId: z.uuid() }),
  output: z.object({ deleted: z.literal(true) }),
  entitlement: 'api_access',
  permission: 'webhooks:manage',
  handler: async ({ input, ctx, tx }) => {
    const p = publisher();
    const row = await findEndpoint(tx, input.endpointId);
    await provider(() => p.deleteEndpoint(requireOrg(ctx), row.providerEndpointId));
    await tx.delete(endpoints).where(eq(endpoints.id, row.id));
    return { deleted: true as const };
  },
  audit: (input) => ({
    action: 'webhooks.endpoint.delete',
    targetType: 'webhook_endpoint',
    targetId: input.endpointId,
  }),
});

/** Show the endpoint's signing secret (audited: who saw it, when). */
export const revealEndpointSecretCommand = tenantCommand({
  name: 'webhooks.revealSecret',
  input: z.object({ endpointId: z.uuid() }),
  output: z.object({ secret: z.string().regex(/^whsec_[A-Za-z0-9+/=]+$/) }),
  entitlement: 'api_access',
  permission: 'webhooks:manage',
  handler: async ({ input, ctx, tx }) => {
    const p = publisher();
    const row = await findEndpoint(tx, input.endpointId);
    return { secret: await provider(() => p.endpointSecret(requireOrg(ctx), row.providerEndpointId)) };
  },
  // The secret itself never reaches the audit log.
  audit: (input) => ({
    action: 'webhooks.secret.reveal',
    targetType: 'webhook_endpoint',
    targetId: input.endpointId,
  }),
});

/** A new signing secret (step-up); the old one keeps signing alongside it for 24 hours. */
export const rotateEndpointSecretCommand = tenantCommand({
  name: 'webhooks.rotateSecret',
  input: z.object({ endpointId: z.uuid() }),
  output: z.object({ rotated: z.literal(true) }),
  entitlement: 'api_access',
  permission: 'webhooks:manage',
  stepUp: true,
  handler: async ({ input, ctx, tx }) => {
    const p = publisher();
    const row = await findEndpoint(tx, input.endpointId);
    await provider(() => p.rotateSecret(requireOrg(ctx), row.providerEndpointId));
    await tx.update(endpoints).set({ updatedAt: ctx.now }).where(eq(endpoints.id, row.id));
    return { rotated: true as const };
  },
  audit: (input) => ({
    action: 'webhooks.secret.rotate',
    targetType: 'webhook_endpoint',
    targetId: input.endpointId,
  }),
});

/**
 * Send a test message to one endpoint: `webhook.test` by default, or any catalog type with its
 * documented example data (marked as a test only by the `webhook.test` type itself).
 */
export const sendTestCommand = tenantCommand({
  name: 'webhooks.sendTest',
  input: z.object({
    endpointId: z.uuid(),
    eventType: z
      .string()
      .refine((t) => catalogEntry(t) !== null, { message: 'unknown_event_type' })
      .default('webhook.test'),
  }),
  output: z.object({ messageId: z.string() }),
  entitlement: 'api_access',
  permission: 'webhooks:manage',
  handler: async ({ input, ctx, tx }) => {
    const p = publisher();
    const orgId = requireOrg(ctx);
    const row = await findEndpoint(tx, input.endpointId);
    const e = catalogEntry(input.eventType);
    if (!e) throw new DomainError('validation_failed');
    const data =
      e.type === 'webhook.test' ? { endpointId: row.id, test: true } : (e.example as Record<string, unknown>);
    const id = uuidv7(ctx.now.getTime());
    const payload = envelope(
      e,
      { id, orgId, occurredAt: ctx.now.toISOString() },
      e.schema.parse(data) as Record<string, unknown>,
    );
    await provider(() => p.ensureApplication(orgId, orgId));
    await provider(() => syncEventTypes(p));
    return provider(() =>
      p.sendTest(orgId, row.providerEndpointId, { eventType: e.type, eventId: id, payload: { ...payload } }),
    );
  },
  audit: (input, r) => ({
    action: 'webhooks.test.send',
    targetType: 'webhook_endpoint',
    targetId: input.endpointId,
    data: { eventType: input.eventType, messageId: r.messageId },
  }),
});

/** Send one message to the endpoint again now (replay). */
export const resendMessageCommand = tenantCommand({
  name: 'webhooks.resend',
  input: z.object({ endpointId: z.uuid(), messageId: MessageId }),
  output: z.object({ resent: z.literal(true) }),
  entitlement: 'api_access',
  permission: 'webhooks:manage',
  handler: async ({ input, ctx, tx }) => {
    const p = publisher();
    const row = await findEndpoint(tx, input.endpointId);
    await provider(() => p.resendMessage(requireOrg(ctx), row.providerEndpointId, input.messageId));
    return { resent: true as const };
  },
  audit: (input) => ({
    action: 'webhooks.message.resend',
    targetType: 'webhook_endpoint',
    targetId: input.endpointId,
    data: { messageId: input.messageId },
  }),
});

/** Resend every message that failed for this endpoint since a time (after an outage). */
export const recoverFailedCommand = tenantCommand({
  name: 'webhooks.recover',
  input: z.object({ endpointId: z.uuid(), since: z.coerce.date() }),
  output: z.object({ recovering: z.literal(true) }),
  entitlement: 'api_access',
  permission: 'webhooks:manage',
  handler: async ({ input, ctx, tx }) => {
    const p = publisher();
    const oldest = new Date(ctx.now.getTime() - RECOVER_MAX_DAYS * 86_400_000);
    if (input.since < oldest || input.since > ctx.now)
      throw new DomainError('validation_failed', `Recovery reaches back ${RECOVER_MAX_DAYS} days at most`, {
        issues: [{ path: 'since', code: 'out_of_range' }],
      });
    const row = await findEndpoint(tx, input.endpointId);
    await provider(() => p.recoverFailed(requireOrg(ctx), row.providerEndpointId, input.since));
    return { recovering: true as const };
  },
  audit: (input) => ({
    action: 'webhooks.message.recover',
    targetType: 'webhook_endpoint',
    targetId: input.endpointId,
    data: { since: input.since.toISOString() },
  }),
});
