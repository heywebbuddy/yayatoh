import { defineSerializer } from '@yayatoh/contracts';
import { requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { MAPPING_DIRECTIONS } from './domain/mapping.ts';
import { ACTIVE_RUN_STATUSES, ERROR_STATUSES, ERROR_STEPS } from './domain/sync.ts';
import { connections, syncErrors, syncRuns } from './schema.ts';

/**
 * The integration errors inbox (M6.4a): failed records grouped by connection, step and code, each
 * with its record, attempts and next automatic retry; Retry (now) and Dismiss per record or per
 * group. Rows carry codes and field names only — never a token, never a record's values.
 */

export const ErrorDto = z.object({
  id: z.uuid(),
  recordKey: z.string(),
  objectType: z.string().nullable(),
  direction: z.enum(MAPPING_DIRECTIONS).nullable(),
  externalId: z.string().nullable(),
  localId: z.uuid().nullable(),
  status: z.enum(ERROR_STATUSES),
  attempts: z.int(),
  occurrences: z.int(),
  nextRetryAt: z.date().nullable(),
  firstSeenAt: z.date(),
  lastSeenAt: z.date(),
  resolvedAt: z.date().nullable(),
});
export type ErrorDto = z.infer<typeof ErrorDto>;

export const ErrorGroupDto = z.object({
  connectionId: z.uuid(),
  connector: z.string(),
  step: z.enum(ERROR_STEPS),
  code: z.string(),
  field: z.string().nullable(),
  count: z.int(),
  lastSeenAt: z.date(),
  errors: z.array(ErrorDto),
});
export type ErrorGroupDto = z.infer<typeof ErrorGroupDto>;
export const errorGroupsSerializer = defineSerializer('integrations.errorGroups', z.array(ErrorGroupDto));

/** Rows per group on the page; the group's count says how many there are. */
export const GROUP_ROWS = 25;
const MAX_ROWS = 2000;

export const listErrorGroupsQuery = tenantQuery({
  name: 'integrations.listErrorGroups',
  input: z.object({
    status: z.enum(ERROR_STATUSES).default('open'),
    connectionId: z.uuid().optional(),
  }),
  output: z.array(ErrorGroupDto),
  entitlement: 'integrations',
  permission: 'integrations:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select({ e: syncErrors, connector: connections.connector })
      .from(syncErrors)
      .innerJoin(
        connections,
        and(eq(connections.orgId, syncErrors.orgId), eq(connections.id, syncErrors.connectionId)),
      )
      .where(
        and(
          eq(syncErrors.status, input.status),
          input.connectionId ? eq(syncErrors.connectionId, input.connectionId) : undefined,
        ),
      )
      .orderBy(desc(syncErrors.lastSeenAt), desc(syncErrors.id))
      .limit(MAX_ROWS);
    const groups = new Map<string, ErrorGroupDto>();
    for (const { e, connector } of rows) {
      const key = `${e.connectionId}|${e.step}|${e.code}|${e.field ?? ''}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          connectionId: e.connectionId,
          connector,
          step: e.step as ErrorGroupDto['step'],
          code: e.code,
          field: e.field,
          count: 0,
          lastSeenAt: e.lastSeenAt,
          errors: [],
        };
        groups.set(key, g);
      }
      g.count += 1;
      if (g.errors.length < GROUP_ROWS)
        g.errors.push({
          id: e.id,
          recordKey: e.recordKey,
          objectType: e.objectType,
          direction: e.direction as ErrorDto['direction'],
          externalId: e.externalId,
          localId: e.localId,
          status: e.status as ErrorDto['status'],
          attempts: e.attempts,
          occurrences: e.occurrences,
          nextRetryAt: e.status === 'open' ? e.nextRetryAt : null,
          firstSeenAt: e.firstSeenAt,
          lastSeenAt: e.lastSeenAt,
          resolvedAt: e.resolvedAt,
        });
    }
    return [...groups.values()];
  },
});

export const openErrorCountQuery = tenantQuery({
  name: 'integrations.openErrorCount',
  input: z.object({}),
  output: z.object({ open: z.int() }),
  entitlement: 'integrations',
  permission: 'integrations:read',
  handler: async ({ tx }) => {
    const rows = await tx.select({ id: syncErrors.id }).from(syncErrors).where(eq(syncErrors.status, 'open'));
    return { open: rows.length };
  },
});

const ErrorIds = z.array(z.uuid()).min(1).max(500);

/**
 * Retry now: the records are tried again on a run queued for their connection (an active one;
 * paused and revoked connections keep theirs until they are resumed or reconnected).
 */
export const retryErrorsCommand = tenantCommand({
  name: 'integrations.retryErrors',
  input: z.object({ errorIds: ErrorIds }),
  output: z.object({ retried: z.int(), queuedRuns: z.int(), skipped: z.int() }),
  entitlement: 'integrations',
  permission: 'integrations:manage',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const rows = await tx
      .select({ id: syncErrors.id, connectionId: syncErrors.connectionId, status: connections.status })
      .from(syncErrors)
      .innerJoin(
        connections,
        and(eq(connections.orgId, syncErrors.orgId), eq(connections.id, syncErrors.connectionId)),
      )
      .where(and(inArray(syncErrors.id, input.errorIds), eq(syncErrors.status, 'open')))
      .for('update');
    const live = rows.filter((r) => r.status === 'active');
    if (live.length)
      await tx
        .update(syncErrors)
        .set({ nextRetryAt: ctx.now, updatedAt: ctx.now })
        .where(
          inArray(
            syncErrors.id,
            live.map((r) => r.id),
          ),
        );
    let queuedRuns = 0;
    for (const connectionId of new Set(live.map((r) => r.connectionId))) {
      const [busy] = await tx
        .select({ id: syncRuns.id })
        .from(syncRuns)
        .where(
          and(eq(syncRuns.connectionId, connectionId), inArray(syncRuns.status, [...ACTIVE_RUN_STATUSES])),
        );
      if (busy) continue;
      await tx.insert(syncRuns).values({
        orgId,
        connectionId,
        trigger: 'retry',
        status: 'queued',
        requestedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      });
      queuedRuns += 1;
    }
    return { retried: live.length, queuedRuns, skipped: input.errorIds.length - live.length };
  },
  audit: (input, r) => ({
    action: 'integrations.errors.retry',
    targetType: 'none',
    targetId: null,
    data: { errors: input.errorIds.length, retried: r.retried, queuedRuns: r.queuedRuns },
  }),
});

/** Dismiss: the records stay as they are and leave the inbox (a later failure opens them again). */
export const dismissErrorsCommand = tenantCommand({
  name: 'integrations.dismissErrors',
  input: z.object({ errorIds: ErrorIds }),
  output: z.object({ dismissed: z.int() }),
  entitlement: 'integrations',
  permission: 'integrations:manage',
  handler: async ({ input, ctx, tx }) => {
    const rows = await tx
      .update(syncErrors)
      .set({
        status: 'dismissed',
        nextRetryAt: null,
        resolvedAt: ctx.now,
        resolvedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
        updatedAt: ctx.now,
      })
      .where(and(inArray(syncErrors.id, input.errorIds), eq(syncErrors.status, 'open')))
      .returning({ id: syncErrors.id });
    return { dismissed: rows.length };
  },
  audit: (input, r) => ({
    action: 'integrations.errors.dismiss',
    targetType: 'none',
    targetId: null,
    data: { errors: input.errorIds.length, dismissed: r.dismissed },
  }),
});
