import { defineSerializer } from '@yayatoh/contracts';
import type { TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { linkRegistrantTx } from '@yayatoh/registration';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CONNECT_STATE_TTL_MS, cancelActiveRunsTx, initialInterval, seedMappingsTx } from './connections.ts';
import { googleCalendarPersonalConnector } from './connectors/google-calendar.ts';
import { LIVE_STATUSES, RUN_STATUSES } from './domain/sync.ts';
import { newState, sha256 } from './hash.ts';
import { connections, recordLinks, syncRuns } from './schema.ts';

/**
 * Personal calendar push (M6.5c): a registrant opts into keeping their schedule in their own
 * Google Calendar from "My schedule" (the order's manage link; no account). The manage link is
 * the credential: every command re-checks that the registrant belongs to its order, and the
 * connection is theirs alone (`registrant_id`), never listed in the org's console. Like the org's
 * connections, the `IntegrationAuth` port holds the tokens; we keep the provider-side id only, and
 * no account label (it would be the person's Google account name).
 */

const CONNECTOR = googleCalendarPersonalConnector;

const LinkInput = z.object({ token: z.string().min(40).max(60), registrantId: z.uuid() });

export const PERSONAL_CALENDAR_STATES = ['off', 'pending', 'active', 'paused', 'revoked'] as const;

export const PersonalCalendarDto = z.object({
  state: z.enum(PERSONAL_CALENDAR_STATES),
  connectedAt: z.date().nullable(),
  lastSyncAt: z.date().nullable(),
  lastSyncStatus: z.enum(RUN_STATUSES).nullable(),
  /** Sessions on their calendar now (entries we created and keep). */
  entries: z.int(),
  /** Whether a sync is queued or running. */
  syncing: z.boolean(),
});
export type PersonalCalendarDto = z.infer<typeof PersonalCalendarDto>;
export const personalCalendarSerializer = defineSerializer(
  'integrations.personalCalendar',
  PersonalCalendarDto,
);

type Row = typeof connections.$inferSelect;

/** The registrant's newest personal calendar connection (live first). */
async function currentTx(tx: TenantTx, registrantId: string, lock = false): Promise<Row | null> {
  const q = tx
    .select()
    .from(connections)
    .where(and(eq(connections.connector, CONNECTOR.key), eq(connections.registrantId, registrantId)))
    .orderBy(desc(sql`${connections.status} in ('pending', 'active', 'paused')`), desc(connections.createdAt))
    .limit(1);
  const [row] = lock ? await q.for('update') : await q;
  return row ?? null;
}

/** Where a registrant's calendar push stands (the schedule page's panel). */
export const personalCalendarQuery = tenantQuery({
  name: 'integrations.personalCalendar',
  input: LinkInput,
  output: PersonalCalendarDto,
  entitlement: 'integrations',
  permission: 'public:calendar',
  handler: async ({ input, ctx, tx }) => {
    await linkRegistrantTx(tx, input.token, input.registrantId);
    const c = await currentTx(tx, input.registrantId);
    const live = c && c.status !== 'failed' ? c : null;
    const [entries] = live
      ? await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(recordLinks)
          .where(eq(recordLinks.connectionId, live.id))
      : [];
    const [busy] = live
      ? await tx
          .select({ id: syncRuns.id })
          .from(syncRuns)
          .where(and(eq(syncRuns.connectionId, live.id), inArray(syncRuns.status, ['queued', 'running'])))
      : [];
    const pendingLive = live?.status === 'pending' && live.stateExpiresAt && live.stateExpiresAt > ctx.now;
    const state: PersonalCalendarDto['state'] = !live
      ? 'off'
      : live.status === 'pending'
        ? pendingLive
          ? 'pending'
          : 'off'
        : (live.status as 'active' | 'paused' | 'revoked');
    return personalCalendarSerializer.serialize({
      state,
      connectedAt: state === 'off' ? null : (live?.connectedAt ?? null),
      lastSyncAt: state === 'off' ? null : (live?.lastSyncAt ?? null),
      lastSyncStatus:
        state === 'off' ? null : ((live?.lastSyncStatus as PersonalCalendarDto['lastSyncStatus']) ?? null),
      entries: state === 'active' || state === 'paused' ? (entries?.n ?? 0) : 0,
      syncing: Boolean(busy),
    });
  },
});

/**
 * Opt in: a pending personal connection with a fresh single-use state (only its hash is kept);
 * the transport then asks the port for the consent URL. Restarting replaces the state; an active
 * one is a conflict (stop it first).
 */
export const beginPersonalCalendarCommand = tenantCommand({
  name: 'integrations.beginPersonalCalendar',
  input: LinkInput,
  output: z.object({ connectionId: z.uuid(), state: z.string() }),
  entitlement: 'integrations',
  permission: 'public:calendar',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const r = await linkRegistrantTx(tx, input.token, input.registrantId);
    const state = newState();
    const pending = {
      stateHash: sha256(state),
      stateExpiresAt: new Date(ctx.now.getTime() + CONNECT_STATE_TTL_MS),
      updatedAt: ctx.now,
    };
    const [live] = await tx
      .select()
      .from(connections)
      .where(
        and(
          eq(connections.connector, CONNECTOR.key),
          eq(connections.registrantId, r.registrantId),
          inArray(connections.status, [...LIVE_STATUSES]),
        ),
      )
      .for('update');
    if (live && live.status !== 'pending')
      throw new DomainError('conflict', 'Already connected', { reason: 'already_connected' });
    if (live) {
      await tx.update(connections).set(pending).where(eq(connections.id, live.id));
      return { connectionId: live.id, state };
    }
    const [row] = await tx
      .insert(connections)
      .values({
        orgId,
        connector: CONNECTOR.key,
        status: 'pending',
        registrantId: r.registrantId,
        eventId: r.eventId,
        syncIntervalMinutes: initialInterval(CONNECTOR),
        ...pending,
      })
      .returning({ id: connections.id });
    if (!row) throw new DomainError('internal');
    return { connectionId: row.id, state };
  },
  audit: (_input, r) => ({
    action: 'integrations.personal_calendar.begin',
    targetType: 'integration_connection',
    targetId: r.connectionId,
  }),
});

/** The registrant's pending connection a callback's state belongs to (expired → not_found). */
export const pendingPersonalCalendarQuery = tenantQuery({
  name: 'integrations.pendingPersonalCalendar',
  input: LinkInput.extend({ state: z.string().min(16).max(200) }),
  output: z.object({ connectionId: z.uuid() }),
  entitlement: 'integrations',
  permission: 'public:calendar',
  handler: async ({ input, ctx, tx }) => {
    await linkRegistrantTx(tx, input.token, input.registrantId);
    const [row] = await tx
      .select({ connectionId: connections.id })
      .from(connections)
      .where(
        and(
          eq(connections.connector, CONNECTOR.key),
          eq(connections.registrantId, input.registrantId),
          eq(connections.stateHash, sha256(input.state)),
          eq(connections.status, 'pending'),
          gt(connections.stateExpiresAt, ctx.now),
        ),
      );
    if (!row) throw new DomainError('not_found', 'This connect link has expired');
    return row;
  },
});

/** After consent: active, default mappings, the first sync queued now. */
export const completePersonalCalendarCommand = tenantCommand({
  name: 'integrations.completePersonalCalendar',
  input: LinkInput.extend({
    connectionId: z.uuid(),
    state: z.string().min(16).max(200),
    authConnectionId: z.string().regex(/^[A-Za-z0-9._:-]{1,255}$/),
  }),
  output: z.object({ connectionId: z.uuid() }),
  entitlement: 'integrations',
  permission: 'public:calendar',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    await linkRegistrantTx(tx, input.token, input.registrantId);
    const [c] = await tx
      .select()
      .from(connections)
      .where(and(eq(connections.id, input.connectionId), eq(connections.registrantId, input.registrantId)))
      .for('update');
    if (!c || c.connector !== CONNECTOR.key) throw new DomainError('not_found', 'Connection not found');
    if (c.status !== 'pending') throw new DomainError('invalid_state', 'Not waiting for a connect');
    if (c.stateHash !== sha256(input.state) || !c.stateExpiresAt || c.stateExpiresAt <= ctx.now)
      throw new DomainError('not_found', 'This connect link has expired');
    await tx
      .update(connections)
      .set({
        status: 'active',
        authConnectionId: input.authConnectionId,
        accountLabel: null,
        stateHash: null,
        stateExpiresAt: null,
        connectedBy: null,
        connectedAt: ctx.now,
        nextSyncAt: ctx.now,
        consecutiveFailures: 0,
        updatedAt: ctx.now,
      })
      .where(eq(connections.id, c.id));
    await seedMappingsTx(tx, ctx, c.id, CONNECTOR);
    await tx.insert(syncRuns).values({ orgId, connectionId: c.id, trigger: 'schedule', status: 'queued' });
    emit({
      type: 'integrations.connection_connected',
      version: 1,
      aggregateType: 'integration_connection',
      aggregateId: c.id,
      payload: { orgId, connectionId: c.id, connector: c.connector },
    });
    return { connectionId: c.id };
  },
  audit: (_input, r) => ({
    action: 'integrations.personal_calendar.connect',
    targetType: 'integration_connection',
    targetId: r.connectionId,
  }),
});

/** The consent was refused: the pending connection ends as `failed`. */
export const failPersonalCalendarCommand = tenantCommand({
  name: 'integrations.failPersonalCalendar',
  input: LinkInput.extend({ connectionId: z.uuid() }),
  output: z.object({ connectionId: z.uuid() }),
  entitlement: 'integrations',
  permission: 'public:calendar',
  handler: async ({ input, ctx, tx }) => {
    await linkRegistrantTx(tx, input.token, input.registrantId);
    const rows = await tx
      .update(connections)
      .set({ status: 'failed', stateHash: null, stateExpiresAt: null, updatedAt: ctx.now })
      .where(
        and(
          eq(connections.id, input.connectionId),
          eq(connections.registrantId, input.registrantId),
          eq(connections.status, 'pending'),
        ),
      )
      .returning({ id: connections.id });
    if (rows.length === 0) throw new DomainError('invalid_state', 'Not waiting for a connect');
    return { connectionId: input.connectionId };
  },
  audit: (input) => ({
    action: 'integrations.personal_calendar.fail',
    targetType: 'integration_connection',
    targetId: input.connectionId,
  }),
});

/**
 * Stop: the connection is revoked here at once (no run starts or continues after this commits),
 * then the transport revokes it at the provider through the port. Entries already on their
 * calendar stay there (theirs to keep or delete). Returns what the port needs (ids only).
 */
export const stopPersonalCalendarCommand = tenantCommand({
  name: 'integrations.stopPersonalCalendar',
  input: LinkInput,
  output: z.object({
    connectionId: z.uuid(),
    providerConfigKey: z.string(),
    authConnectionId: z.string().nullable(),
  }),
  entitlement: 'integrations',
  permission: 'public:calendar',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    await linkRegistrantTx(tx, input.token, input.registrantId);
    const c = await currentTx(tx, input.registrantId, true);
    if (!c || c.status === 'revoked' || c.status === 'failed')
      throw new DomainError('invalid_state', 'Already disconnected');
    if (c.status === 'pending') {
      await tx
        .update(connections)
        .set({ status: 'failed', stateHash: null, stateExpiresAt: null, updatedAt: ctx.now })
        .where(eq(connections.id, c.id));
    } else {
      await tx
        .update(connections)
        .set({
          status: 'revoked',
          revokedAt: ctx.now,
          revokeReason: 'user',
          pausedAt: null,
          nextSyncAt: null,
          updatedAt: ctx.now,
        })
        .where(eq(connections.id, c.id));
      await cancelActiveRunsTx(tx, ctx, c.id, 'disconnected');
      emit({
        type: 'integrations.connection_revoked',
        version: 1,
        aggregateType: 'integration_connection',
        aggregateId: c.id,
        payload: { orgId, connectionId: c.id, connector: c.connector, reason: 'user' },
      });
    }
    return {
      connectionId: c.id,
      providerConfigKey: CONNECTOR.providerConfigKey,
      authConnectionId: c.status === 'pending' ? null : c.authConnectionId,
    };
  },
  audit: (_input, r) => ({
    action: 'integrations.personal_calendar.stop',
    targetType: 'integration_connection',
    targetId: r.connectionId,
  }),
});

/** "Sync now" from the schedule page: queue a run unless one is queued or running. */
export const syncPersonalCalendarCommand = tenantCommand({
  name: 'integrations.syncPersonalCalendar',
  input: LinkInput,
  output: z.object({ runId: z.uuid(), already: z.boolean() }),
  entitlement: 'integrations',
  permission: 'public:calendar',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    await linkRegistrantTx(tx, input.token, input.registrantId);
    const c = await currentTx(tx, input.registrantId, true);
    if (c?.status !== 'active') throw new DomainError('invalid_state', 'Only an active connection syncs');
    const [busy] = await tx
      .select({ id: syncRuns.id })
      .from(syncRuns)
      .where(and(eq(syncRuns.connectionId, c.id), inArray(syncRuns.status, ['queued', 'running'])));
    if (busy) return { runId: busy.id, already: true };
    const [run] = await tx
      .insert(syncRuns)
      .values({ orgId, connectionId: c.id, trigger: 'manual', status: 'queued' })
      .returning({ id: syncRuns.id });
    if (!run) throw new DomainError('internal');
    return { runId: run.id, already: false };
  },
  audit: (_input, r) => ({
    action: 'integrations.personal_calendar.sync',
    targetType: 'integration_run',
    targetId: r.runId,
  }),
});
