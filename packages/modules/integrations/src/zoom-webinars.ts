import { effectiveModulesTx } from '@yayatoh/billing';
import type { TenantTx } from '@yayatoh/db';
import {
  type CommandPorts,
  type Ctx,
  DomainError,
  executeCommand,
  executeQuery,
  requireOrg,
} from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { linkZoomWebinarTx, ZoomSyncDto, zoomWebinarPlanTx } from '@yayatoh/virtual';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { type IntegrationAuth, isProviderError } from './auth/port.ts';
import { zoomConnector } from './connectors/zoom.ts';
import { connections } from './schema.ts';

/**
 * M6.10a: create a session's Zoom webinar from Yayatoh, through the org's Zoom connection (the
 * `IntegrationAuth` port: Nango in production once the Marketplace app is approved, the fake in
 * dev and CI). Three steps, the network call between two transactions (never inside one):
 *
 * 1. `zoomWebinarPlanQuery`: the org's active Zoom connection and what the webinar needs (title,
 *    start, length, time zone), or the webinar already linked.
 * 2. `POST /users/me/webinars` with an `Idempotency-Key` per session, so a retry after a lost
 *    answer gets the same webinar.
 * 3. `recordCreatedZoomWebinarCommand`: links it (origin `created`, which the join/leave webhooks
 *    trust to find the org) and makes every holder with online access a registrant.
 *
 * Needs `events:write`, the `virtual` module and the `integrations` module.
 */

const Ids = z.object({ eventId: z.uuid(), sessionId: z.uuid() });

export const ZoomWebinarPlanDto = z.object({
  /** The org's active Zoom connection (ids only, no token), or null when Zoom is not connected. */
  connection: z.object({ connectionId: z.uuid(), authConnectionId: z.string() }).nullable(),
  linkedWebinarId: z.string().nullable(),
  topic: z.string(),
  startsAt: z.date(),
  durationMinutes: z.int(),
  timezone: z.string(),
});
export type ZoomWebinarPlanDto = z.infer<typeof ZoomWebinarPlanDto>;

async function requireVirtualTx(tx: TenantTx) {
  if (!(await effectiveModulesTx(tx)).has('virtual'))
    throw new DomainError('module_not_enabled', 'Not in your plan', { module: 'virtual' });
}

/** The org's active Zoom connection, or null. */
export async function activeZoomConnectionTx(tx: TenantTx) {
  const [row] = await tx
    .select({ id: connections.id, authConnectionId: connections.authConnectionId })
    .from(connections)
    .where(and(eq(connections.connector, zoomConnector.key), eq(connections.status, 'active')))
    .orderBy(desc(connections.createdAt))
    .limit(1);
  return row?.authConnectionId ? { connectionId: row.id, authConnectionId: row.authConnectionId } : null;
}

export const zoomWebinarPlanQuery = tenantQuery({
  name: 'integrations.zoomWebinarPlan',
  input: Ids,
  output: ZoomWebinarPlanDto,
  entitlement: 'integrations',
  permission: 'events:write',
  handler: async ({ input, tx }) => {
    await requireVirtualTx(tx);
    const plan = await zoomWebinarPlanTx(tx, input.eventId, input.sessionId);
    return { ...plan, connection: await activeZoomConnectionTx(tx) };
  },
});

/**
 * Whether the org has an active Zoom connection (the stream setup page offers "Create a Zoom
 * webinar" then, else a link to connect Zoom). Readable by anyone who reads the event.
 */
export const zoomConnectedQuery = tenantQuery({
  name: 'integrations.zoomConnected',
  input: z.object({}),
  output: z.object({ connected: z.boolean() }),
  entitlement: 'integrations',
  permission: 'events:read',
  handler: async ({ tx }) => ({ connected: (await activeZoomConnectionTx(tx)) !== null }),
});

/** Step 3: link the webinar Zoom just created (only `createZoomWebinar` calls it). */
export const recordCreatedZoomWebinarCommand = tenantCommand({
  name: 'integrations.recordCreatedZoomWebinar',
  input: Ids.extend({ webinarId: z.string().regex(/^[0-9]{9,12}$/) }),
  output: ZoomSyncDto,
  entitlement: 'integrations',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await requireVirtualTx(tx);
    if (!(await activeZoomConnectionTx(tx)))
      throw new DomainError('invalid_state', 'Zoom is not connected', { reason: 'zoom_not_connected' });
    return linkZoomWebinarTx(tx, ctx, { ...input, origin: 'created' });
  },
  audit: (input) => ({
    action: 'virtual.zoom.create_webinar',
    targetType: 'session',
    targetId: input.sessionId,
    data: { eventId: input.eventId, webinarId: input.webinarId },
  }),
});

/** Zoom's `start_time` (UTC, seconds). */
const zoomTime = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;

/**
 * Create the session's webinar at Zoom and link it. A session already linked keeps its webinar
 * (`created: false`). `invalid_state`: `integrations_off` without the port, `zoom_not_connected`
 * without an active Zoom connection, `zoom_failed` when Zoom refuses (the connection's own
 * failures, such as a revoked token, surface on the integrations page).
 */
export async function createZoomWebinar(
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
  auth: IntegrationAuth | null,
  input: { eventId: string; sessionId: string },
): Promise<ZoomSyncDto & { created: boolean }> {
  const plan = await executeQuery(zoomWebinarPlanQuery, input, ctx, ports);
  if (plan.linkedWebinarId) return { added: 0, updated: 0, webinarId: plan.linkedWebinarId, created: false };
  if (!auth) throw new DomainError('invalid_state', 'Integrations are off', { reason: 'integrations_off' });
  if (!plan.connection)
    throw new DomainError('invalid_state', 'Zoom is not connected', { reason: 'zoom_not_connected' });
  const client = auth.client({
    orgId: requireOrg(ctx),
    connectionId: plan.connection.connectionId,
    providerConfigKey: zoomConnector.providerConfigKey,
    authConnectionId: plan.connection.authConnectionId,
  });
  let webinarId: string;
  try {
    const res = await client.request({
      method: 'POST',
      path: '/users/me/webinars',
      body: {
        topic: plan.topic,
        type: 5, // a scheduled webinar
        start_time: zoomTime(plan.startsAt),
        duration: plan.durationMinutes,
        timezone: plan.timezone,
        // Registration required, approved automatically: the connector registers each holder.
        settings: { approval_type: 0, registration_type: 1 },
      },
      idempotencyKey: `yy-zoom-webinar-${input.sessionId}`,
    });
    const id = (res.body as { id?: unknown } | null)?.id;
    webinarId = typeof id === 'number' || typeof id === 'string' ? String(id) : '';
  } catch (err) {
    if (isProviderError(err))
      throw new DomainError('invalid_state', 'Zoom did not create the webinar', { reason: 'zoom_failed' });
    throw err;
  }
  if (!/^[0-9]{9,12}$/.test(webinarId))
    throw new DomainError('invalid_state', 'Zoom did not create the webinar', { reason: 'zoom_failed' });
  const linked = await executeCommand(recordCreatedZoomWebinarCommand, { ...input, webinarId }, ctx, ports);
  return { ...linked, created: true };
}
