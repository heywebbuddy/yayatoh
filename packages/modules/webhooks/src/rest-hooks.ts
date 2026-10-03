import { DomainError, requireOrg, uuidv7 } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { asc, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { catalogEntry, exampleEnvelope, SUBSCRIBABLE_EVENT_TYPES, type WebhookEnvelope } from './catalog.ts';
import { hostOf, MAX_ENDPOINTS, provider, publisher, spec, syncEventTypes } from './commands.ts';
import { webhooksRuntime } from './config.ts';
import { endpoints } from './schema.ts';
import { assertEndpointUrl, MAX_URL_LENGTH } from './url.ts';

/**
 * REST hooks (M6.4c): what automation tools such as Zapier use instead of a hand-made endpoint.
 * The tool subscribes a target URL to one event type with the org's API key (scope
 * `webhooks:subscribe`), receives the same signed, thin deliveries as any endpoint, and
 * unsubscribes when the user turns the automation off. A REST hook is an endpoint with
 * `source = 'rest_hook'`: it shows in Settings → Webhooks (the organizer can remove it there), and
 * the tool can only remove the hooks it made, never the organizer's own endpoints.
 */

export const HookDto = z.object({
  id: z.uuid(),
  event: z.string(),
  createdAt: z.date(),
});
export type HookDto = z.infer<typeof HookDto>;

/** A REST hook as the console lists it (the receiver's host only: a hook URL carries its token). */
export const RestHookDto = z.object({
  id: z.uuid(),
  event: z.string(),
  host: z.string(),
  apiKeyId: z.uuid().nullable(),
  status: z.enum(['active', 'disabled']),
  createdAt: z.date(),
});
export type RestHookDto = z.infer<typeof RestHookDto>;

const HookEvent = z
  .string()
  .refine((t) => SUBSCRIBABLE_EVENT_TYPES.includes(t), { message: 'unknown_event_type' });

/** Subscribe a target URL to one event type (Zapier's `performSubscribe`). */
export const subscribeHookCommand = tenantCommand({
  name: 'webhooks.subscribeHook',
  input: z.object({ url: z.string().trim().min(1).max(MAX_URL_LENGTH), event: HookEvent }),
  output: HookDto,
  entitlement: 'api_access',
  permission: 'webhooks:subscribe',
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
      description: `REST hook: ${input.event}`,
      eventTypes: [input.event],
      status: 'active' as const,
    };
    await provider(() => p.ensureApplication(orgId, orgId));
    await provider(() => syncEventTypes(p));
    const { providerEndpointId } = await provider(() => p.createEndpoint(orgId, id, spec(s)));
    const [row] = await tx
      .insert(endpoints)
      .values({
        id,
        orgId,
        providerEndpointId,
        ...s,
        source: 'rest_hook',
        apiKeyId: ctx.actor.type === 'api_key' ? ctx.actor.keyId : null,
        createdBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return { id: row.id, event: input.event, createdAt: row.createdAt };
  },
  audit: (input, r) => ({
    action: 'webhooks.hook.subscribe',
    targetType: 'webhook_endpoint',
    targetId: r.id,
    data: { host: hostOf(input.url), event: input.event },
  }),
});

/** Remove a REST hook (Zapier's `performUnsubscribe`). Idempotent: a hook already gone is fine. */
export const unsubscribeHookCommand = tenantCommand({
  name: 'webhooks.unsubscribeHook',
  input: z.object({ hookId: z.uuid() }),
  output: z.object({ deleted: z.boolean() }),
  entitlement: 'api_access',
  permission: 'webhooks:subscribe',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx.select().from(endpoints).where(eq(endpoints.id, input.hookId));
    if (!row) return { deleted: false };
    // Only hooks made through /v1: the organizer's own endpoints are theirs to remove.
    if (row.source !== 'rest_hook') throw new DomainError('not_found');
    const p = publisher();
    await provider(() => p.deleteEndpoint(requireOrg(ctx), row.providerEndpointId));
    await tx.delete(endpoints).where(eq(endpoints.id, row.id));
    return { deleted: true };
  },
  audit: (input, r) => ({
    action: 'webhooks.hook.unsubscribe',
    targetType: 'webhook_endpoint',
    targetId: input.hookId,
    data: { deleted: r.deleted },
  }),
});

/** A sample delivery for one event type (Zapier's `performList`: test data before a real event). */
export const hookSampleQuery = tenantQuery({
  name: 'webhooks.hookSample',
  // Any short string: the scope is checked first, then an unknown type is not found.
  input: z.object({ event: z.string().min(1).max(100) }),
  output: z.custom<WebhookEnvelope<Record<string, unknown>>>(),
  entitlement: 'api_access',
  permission: 'webhooks:subscribe',
  handler: async ({ input }) => {
    const e = SUBSCRIBABLE_EVENT_TYPES.includes(input.event) ? catalogEntry(input.event) : null;
    if (!e) throw new DomainError('not_found', 'Unknown event type');
    return exampleEnvelope(e);
  },
});

/** The org's REST hooks (the console's Zapier page). */
export const listRestHooksQuery = tenantQuery({
  name: 'webhooks.listRestHooks',
  input: z.object({}),
  output: z.array(RestHookDto),
  entitlement: 'api_access',
  permission: 'integrations:read',
  handler: async ({ tx }) => {
    const rows = await tx
      .select()
      .from(endpoints)
      .where(eq(endpoints.source, 'rest_hook'))
      .orderBy(asc(endpoints.createdAt), asc(endpoints.id));
    return rows.map((r) => ({
      id: r.id,
      event: r.eventTypes[0] ?? '',
      host: hostOf(r.url) ?? '',
      apiKeyId: r.apiKeyId,
      status: r.status as RestHookDto['status'],
      createdAt: r.createdAt,
    }));
  },
});
