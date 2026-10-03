import { segmentDefinitionTx } from '@yayatoh/audiences';
import { defineSerializer } from '@yayatoh/contracts';
import { contactsByIdsTx } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { type Ctx, DomainError, isDomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { IntegrationAuth } from '../auth/port.ts';
import { connectionTx, requireConnector, resetCursorsTx } from '../connections.ts';
import { klaviyoApi } from '../connectors/klaviyo/index.ts';
import { mailchimpApi } from '../connectors/mailchimp/index.ts';
import { ACTIVE_RUN_STATUSES, originStamp } from '../domain/sync.ts';
import { audienceSyncs, consentChanges, recordLinks, syncRuns } from '../schema.ts';
import { INBOUND_CHANGES } from './consent.ts';
import { type ListApi, MEMBERS, type ProviderList } from './list-connector.ts';

/**
 * Audience settings and history for marketing connectors (M6.4d): which audience a Mailchimp or
 * Klaviyo connection pushes and to which provider list (`saveAudienceSyncCommand`), the lists
 * the provider offers (`providerLists`, a call through the port), and the consent changes the
 * pulls applied (`consentChangesQuery`). Reads need `integrations:read`, writes
 * `integrations:manage`.
 */

const LIST_APIS: Readonly<Record<string, ListApi>> = { mailchimp: mailchimpApi, klaviyo: klaviyoApi };
export const LIST_CONNECTORS = ['mailchimp', 'klaviyo'] as const;
export const isListConnector = (key: string) => (LIST_CONNECTORS as readonly string[]).includes(key);
/** Connectors whose pulls report consent changes (the history on the connection page). */
export const MARKETING_CONNECTORS = ['mailchimp', 'klaviyo', 'hubspot'] as const;
export const isMarketingConnector = (key: string) =>
  (MARKETING_CONNECTORS as readonly string[]).includes(key);

const ListId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);

export const AudienceSyncDto = z.object({
  segmentId: z.uuid().nullable(),
  /** The chosen segment was deleted: no new subscribers are pushed until another is chosen. */
  segmentMissing: z.boolean(),
  listId: z.string(),
  listName: z.string(),
  updatedAt: z.date(),
});
export type AudienceSyncDto = z.infer<typeof AudienceSyncDto>;
export const audienceSyncSerializer = defineSerializer(
  'integrations.audienceSync',
  AudienceSyncDto.nullable(),
);

export const ConsentChangeDto = z.object({
  id: z.uuid(),
  change: z.enum(INBOUND_CHANGES),
  email: z.string(),
  name: z.string().nullable(),
  consentWithdrawn: z.boolean(),
  suppressed: z.boolean(),
  createdAt: z.date(),
});
export type ConsentChangeDto = z.infer<typeof ConsentChangeDto>;
export const consentChangesSerializer = defineSerializer(
  'integrations.consentChanges',
  z.array(ConsentChangeDto),
);
/** Consent changes shown per connection (newest first). */
export const CONSENT_CHANGES_SHOWN = 20;

/** The connection's audience settings (null until chosen). */
export const audienceSyncQuery = tenantQuery({
  name: 'integrations.audienceSync',
  input: z.object({ connectionId: z.uuid() }),
  output: AudienceSyncDto.nullable(),
  entitlement: 'integrations',
  permission: 'integrations:read',
  handler: async ({ input, tx }) => {
    const [row] = await tx
      .select()
      .from(audienceSyncs)
      .where(eq(audienceSyncs.connectionId, input.connectionId));
    if (!row) return null;
    let segmentMissing = false;
    if (row.segmentId)
      try {
        await segmentDefinitionTx(tx, row.segmentId);
      } catch (err) {
        if (!isDomainError(err) || err.code !== 'not_found') throw err;
        segmentMissing = true;
      }
    return {
      segmentId: row.segmentId,
      segmentMissing,
      listId: row.listId,
      listName: row.listName,
      updatedAt: row.updatedAt,
    };
  },
});

/** The consent changes a connection's pulls applied, newest first. */
export const consentChangesQuery = tenantQuery({
  name: 'integrations.consentChanges',
  input: z.object({ connectionId: z.uuid() }),
  output: z.array(ConsentChangeDto),
  entitlement: 'integrations',
  permission: 'integrations:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select()
      .from(consentChanges)
      .where(eq(consentChanges.connectionId, input.connectionId))
      .orderBy(desc(consentChanges.createdAt), desc(consentChanges.id))
      .limit(CONSENT_CHANGES_SHOWN);
    const people = await contactsByIdsTx(
      tx,
      rows.map((r) => r.contactId),
    );
    return rows.flatMap((r) => {
      const p = people.get(r.contactId);
      return p
        ? [
            {
              id: r.id,
              change: r.change as (typeof INBOUND_CHANGES)[number],
              email: p.email,
              name: p.name,
              consentWithdrawn: r.consentWithdrawn,
              suppressed: r.suppressed,
              createdAt: r.createdAt,
            },
          ]
        : [];
    });
  },
});

/**
 * Choose the audience and the provider list (Mailchimp, Klaviyo). A new list starts the members
 * over (their links and cursors go: the old list keeps what it had); the next sync is queued.
 */
export const saveAudienceSyncCommand = tenantCommand({
  name: 'integrations.saveAudienceSync',
  input: z.object({
    connectionId: z.uuid(),
    segmentId: z.uuid().nullable(),
    listId: ListId,
    listName: z.string().trim().min(1).max(200),
  }),
  output: z.object({ listChanged: z.boolean() }),
  entitlement: 'integrations',
  permission: 'integrations:manage',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const c = await connectionTx(tx, input.connectionId, true);
    if (!isListConnector(c.connector))
      throw new DomainError('invalid_state', 'This connector has no audience', {
        reason: 'not_a_list_connector',
      });
    if (c.status !== 'active' && c.status !== 'paused')
      throw new DomainError('invalid_state', 'Only a live connection can be set up', { reason: 'not_live' });
    if (input.segmentId)
      try {
        await segmentDefinitionTx(tx, input.segmentId);
      } catch (err) {
        if (isDomainError(err) && err.code === 'not_found')
          throw new DomainError('validation_failed', 'Choose an audience', { field: 'segmentId' });
        throw err;
      }
    const [before] = await tx
      .select()
      .from(audienceSyncs)
      .where(eq(audienceSyncs.connectionId, c.id))
      .for('update');
    const listChanged = Boolean(before && before.listId !== input.listId);
    const values = {
      segmentId: input.segmentId,
      listId: input.listId,
      listName: input.listName,
      updatedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      updatedAt: ctx.now,
    };
    if (before) await tx.update(audienceSyncs).set(values).where(eq(audienceSyncs.id, before.id));
    else await tx.insert(audienceSyncs).values({ orgId, connectionId: c.id, ...values });
    if (listChanged) {
      await tx
        .delete(recordLinks)
        .where(and(eq(recordLinks.connectionId, c.id), eq(recordLinks.objectType, MEMBERS)));
      await resetCursorsTx(tx, c.id);
    } else if (before && before.segmentId !== input.segmentId) {
      // Another audience: walk the members from the start.
      await resetCursorsTx(tx, c.id);
    }
    if (c.status === 'active') {
      const [busy] = await tx
        .select({ id: syncRuns.id })
        .from(syncRuns)
        .where(and(eq(syncRuns.connectionId, c.id), inArray(syncRuns.status, [...ACTIVE_RUN_STATUSES])));
      if (!busy)
        await tx.insert(syncRuns).values({
          orgId,
          connectionId: c.id,
          trigger: 'manual',
          status: 'queued',
          requestedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
        });
    }
    return { listChanged, connectionId: c.id };
  },
  present: (r) => ({ listChanged: r.listChanged }),
  audit: (input, r) => ({
    action: 'integrations.audience.save',
    targetType: 'integration_connection',
    targetId: r.connectionId,
    data: { segmentId: input.segmentId, listId: input.listId, listChanged: r.listChanged },
  }),
});

/**
 * The lists the provider offers this connection (a call through the port, outside any
 * transaction). The caller checks `integrations:manage`. Ids and names only.
 */
export async function providerLists(
  ctx: Ctx,
  auth: IntegrationAuth,
  connectionId: string,
): Promise<ProviderList[]> {
  const c = await withTenant(ctx, (tx) => connectionTx(tx, connectionId));
  const api = LIST_APIS[c.connector];
  if (!api || c.status !== 'active' || !c.authConnectionId) return [];
  const client = auth.client({
    orgId: requireOrg(ctx),
    connectionId: c.id,
    providerConfigKey: requireConnector(c.connector).providerConfigKey,
    authConnectionId: c.authConnectionId,
  });
  const lists = await api.lists({ client, origin: originStamp(c.id), now: ctx.now, scope: {} });
  return lists.filter((l) => ListId.safeParse(l.id).success).slice(0, 200);
}
