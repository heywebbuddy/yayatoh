import { type TenantTx, withTenant } from '@yayatoh/db';
import {
  type CommandPorts,
  type Ctx,
  createCtx,
  DomainError,
  executeCommand,
  isDomainError,
  requireOrg,
} from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { and, eq, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthRef, IntegrationAuth } from './auth/port.ts';
import { isProviderError } from './auth/port.ts';
import { parseRules } from './connections.ts';
import { connectorByKey } from './connectors/index.ts';
import { applyMapping, type MappingRule } from './domain/mapping.ts';
import {
  ACTIVE_RUN_STATUSES,
  decidePull,
  decidePush,
  type ErrorStep,
  nextSyncAt,
  originStamp,
  RUN_LEASE_MS,
  RUN_STATUSES,
  recordRetryAt,
} from './domain/sync.ts';
import { fieldsHash, pushKey } from './hash.ts';
import { connections, fieldMappings, recordLinks, syncCursors, syncErrors, syncRuns } from './schema.ts';
import type {
  ConnectorDefinition,
  LocalRecord,
  ObjectDefinition,
  RemoteRecord,
  SyncIO,
} from './sdk/connector.ts';

/**
 * The sync engine (M6.4a). One run per connection at a time; each step is a command run by the
 * system actor `integrations.sync` (`platform:integrations.sync`), so every write goes through the
 * pipeline (outbox, audit). The worker's pg-boss job `integrations.sync` (exclusive per
 * connection) calls `runSync`; the dev drain calls `runDueSyncs`.
 *
 * - **Claim** (`claimRun`): the queued run, or a scheduled one when the connection is due; a run
 *   holds a lease, and a second runner gets `busy`.
 * - **Auth check** through the port: a revoked connection is marked revoked and the run stops.
 * - Per object: **pull** (due retries, then pages from the stored cursor) and **push** (due
 *   retries, then Yayatoh records changed since the push cursor), page by page. Each page is one
 *   command; each record commits with its link in a savepoint, so a bad record never rolls back
 *   the others and lands in the errors inbox instead.
 * - **Loop guards and idempotency:** the record link (unique per connection, object and provider
 *   id) remembers the remote version and our hash at the last crossing; `decidePull` /
 *   `decidePush` skip what we already applied or wrote ourselves (and provider records stamped
 *   with our origin), so a replayed page writes nothing and our writes never echo back. A push
 *   sends an `Idempotency-Key` per record and content.
 * - A provider refusal (401/403) at any point marks the connection revoked within the run; a page
 *   command refuses to continue once the connection was paused or disconnected.
 * - **Finish:** the run's status and counts, the connection's next sync (interval, or backoff
 *   after failures), `integrations.sync_completed@1`.
 */

export interface SyncDeps {
  readonly auth: IntegrationAuth;
}

export const SYNC_ACTOR = { type: 'system', name: 'integrations.sync' } as const;
export const SYNC_PERMISSION = 'platform:integrations.sync';
/** Pages per object and direction in one run (the next run continues from the cursor). */
export const MAX_PAGES = 20;
export const PUSH_PAGE = 100;
/** Records retried per object and direction in one run. */
export const RETRY_BATCH = 100;

export const SYNC_COMPLETED_EVENT = 'integrations.sync_completed';
export const SyncCompletedPayload = z.object({
  orgId: z.uuid(),
  connectionId: z.uuid(),
  connector: z.string(),
  runId: z.uuid(),
  status: z.enum(RUN_STATUSES),
  pulled: z.int(),
  pushed: z.int(),
  skipped: z.int(),
  failed: z.int(),
});
export const CONNECTION_REVOKED_EVENT = 'integrations.connection_revoked';

const code = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 60) || 'error';

const pullKey = (objectType: string, externalId: string) => `${objectType}:remote:${externalId}`;
const localKey = (objectType: string, localId: string) => `${objectType}:local:${localId}`;
/** Connection-level errors (a whole run's failure) use this record key. */
const CONNECTION_KEY = '-';

const runEnded = () => new DomainError('invalid_state', 'The run has ended', { reason: 'run_ended' });

async function runningTx(tx: TenantTx, runId: string) {
  const [run] = await tx.select().from(syncRuns).where(eq(syncRuns.id, runId)).for('update');
  if (run?.status !== 'running') throw runEnded();
  const [c] = await tx.select().from(connections).where(eq(connections.id, run.connectionId));
  // Paused or disconnected while running: stop at this page.
  if (c?.status !== 'active') throw runEnded();
  return { run, connection: c };
}

/** The rules in force: the newest version, else the connector's default. */
async function rulesTx(
  tx: TenantTx,
  connectionId: string,
  object: ObjectDefinition,
  direction: 'pull' | 'push',
): Promise<readonly MappingRule[]> {
  const [m] = await tx
    .select({ rules: fieldMappings.rules })
    .from(fieldMappings)
    .where(
      and(
        eq(fieldMappings.connectionId, connectionId),
        eq(fieldMappings.objectType, object.key),
        eq(fieldMappings.direction, direction),
      ),
    )
    .orderBy(sql`${fieldMappings.version} desc`)
    .limit(1);
  return m ? parseRules(m.rules) : (object[direction]?.defaultMapping ?? []);
}

interface ErrorInput {
  readonly connectionId: string;
  readonly runId: string;
  readonly step: ErrorStep;
  readonly objectType: string | null;
  readonly direction: 'pull' | 'push' | null;
  readonly externalId: string | null;
  readonly localId: string | null;
  readonly recordKey: string;
  readonly code: string;
  readonly field: string | null;
}

/** Open (or count again) the inbox row for one record and step; schedule its automatic retry. */
async function recordErrorTx(tx: TenantTx, ctx: Ctx, e: ErrorInput): Promise<void> {
  const orgId = requireOrg(ctx);
  const [open] = await tx
    .select()
    .from(syncErrors)
    .where(
      and(
        eq(syncErrors.connectionId, e.connectionId),
        eq(syncErrors.step, e.step),
        eq(syncErrors.recordKey, e.recordKey),
        eq(syncErrors.status, 'open'),
      ),
    )
    .for('update');
  const retryable = e.recordKey !== CONNECTION_KEY && e.step !== 'auth';
  if (open) {
    const attempts = open.attempts + 1;
    await tx
      .update(syncErrors)
      .set({
        runId: e.runId,
        code: code(e.code),
        field: e.field,
        attempts,
        occurrences: open.occurrences + 1,
        nextRetryAt: retryable ? recordRetryAt(attempts, ctx.now) : null,
        lastSeenAt: ctx.now,
        updatedAt: ctx.now,
      })
      .where(eq(syncErrors.id, open.id));
    return;
  }
  await tx.insert(syncErrors).values({
    orgId,
    connectionId: e.connectionId,
    runId: e.runId,
    step: e.step,
    objectType: e.objectType,
    direction: e.direction,
    externalId: e.externalId,
    localId: e.localId,
    recordKey: e.recordKey,
    code: code(e.code),
    field: e.field,
    attempts: 1,
    nextRetryAt: retryable ? recordRetryAt(1, ctx.now) : null,
    firstSeenAt: ctx.now,
    lastSeenAt: ctx.now,
  });
}

async function resolveErrorsTx(tx: TenantTx, ctx: Ctx, connectionId: string, recordKeys: readonly string[]) {
  if (recordKeys.length === 0) return;
  await tx
    .update(syncErrors)
    .set({ status: 'resolved', nextRetryAt: null, resolvedAt: ctx.now, updatedAt: ctx.now })
    .where(
      and(
        eq(syncErrors.connectionId, connectionId),
        eq(syncErrors.status, 'open'),
        inArray(syncErrors.recordKey, [...recordKeys]),
      ),
    );
}

async function setCursorTx(
  tx: TenantTx,
  ctx: Ctx,
  connectionId: string,
  objectType: string,
  direction: 'pull' | 'push',
  cursor: string,
) {
  await tx
    .insert(syncCursors)
    .values({ orgId: requireOrg(ctx), connectionId, objectType, direction, cursor })
    .onConflictDoUpdate({
      target: [syncCursors.orgId, syncCursors.connectionId, syncCursors.objectType, syncCursors.direction],
      set: { cursor, updatedAt: ctx.now },
    });
}

async function bumpRunTx(
  tx: TenantTx,
  ctx: Ctx,
  runId: string,
  d: { pulled?: number; pushed?: number; skipped?: number; failed?: number },
) {
  await tx
    .update(syncRuns)
    .set({
      pulled: sql`${syncRuns.pulled} + ${d.pulled ?? 0}`,
      pushed: sql`${syncRuns.pushed} + ${d.pushed ?? 0}`,
      skipped: sql`${syncRuns.skipped} + ${d.skipped ?? 0}`,
      failed: sql`${syncRuns.failed} + ${d.failed ?? 0}`,
      leaseUntil: new Date(ctx.now.getTime() + RUN_LEASE_MS),
      updatedAt: ctx.now,
    })
    .where(eq(syncRuns.id, runId));
}

const isUniqueViolation = (err: unknown) => {
  for (let e: unknown = err, i = 0; e && i < 4; e = (e as { cause?: unknown }).cause, i++)
    if ((e as { code?: unknown }).code === '23505') return true;
  return false;
};

/** Claim the connection for one run (system actor only). */
export const claimRunCommand = tenantCommand({
  name: 'integrations.claimRun',
  input: z.object({ connectionId: z.uuid(), force: z.boolean().default(false) }),
  output: z.object({
    status: z.enum(['claimed', 'busy', 'idle', 'inactive']),
    runId: z.uuid().nullable(),
    connector: z.string(),
    authConnectionId: z.string().nullable(),
  }),
  entitlement: 'integrations',
  permission: SYNC_PERMISSION,
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const [c] = await tx
      .select()
      .from(connections)
      .where(eq(connections.id, input.connectionId))
      .for('update');
    if (!c) throw new DomainError('not_found', 'Connection not found');
    const out = (status: 'claimed' | 'busy' | 'idle' | 'inactive', runId: string | null = null) => ({
      status,
      runId,
      connector: c.connector,
      authConnectionId: c.authConnectionId,
    });
    const active = await tx
      .select()
      .from(syncRuns)
      .where(and(eq(syncRuns.connectionId, c.id), inArray(syncRuns.status, [...ACTIVE_RUN_STATUSES])))
      .for('update');
    if (c.status !== 'active') {
      if (active.length)
        await tx
          .update(syncRuns)
          .set({ status: 'cancelled', errorCode: code(c.status), finishedAt: ctx.now, leaseUntil: null })
          .where(
            inArray(
              syncRuns.id,
              active.map((r) => r.id),
            ),
          );
      return out('inactive');
    }
    let current = active[0] ?? null;
    if (current?.status === 'running') {
      if (current.leaseUntil && current.leaseUntil > ctx.now) return out('busy', current.id);
      // A runner that died mid-run: its lease ran out, so the connection is free again.
      await tx
        .update(syncRuns)
        .set({ status: 'failed', errorCode: 'lease_expired', finishedAt: ctx.now, leaseUntil: null })
        .where(eq(syncRuns.id, current.id));
      current = null;
    }
    const lease = {
      startedAt: ctx.now,
      leaseUntil: new Date(ctx.now.getTime() + RUN_LEASE_MS),
      updatedAt: ctx.now,
    };
    if (current) {
      await tx
        .update(syncRuns)
        .set({ status: 'running', ...lease })
        .where(eq(syncRuns.id, current.id));
      return out('claimed', current.id);
    }
    const scheduled = c.nextSyncAt !== null && c.nextSyncAt <= ctx.now;
    const [retry] = scheduled
      ? []
      : await tx
          .select({ id: syncErrors.id })
          .from(syncErrors)
          .where(
            and(
              eq(syncErrors.connectionId, c.id),
              eq(syncErrors.status, 'open'),
              isNotNull(syncErrors.nextRetryAt),
              lte(syncErrors.nextRetryAt, ctx.now),
            ),
          )
          .limit(1);
    if (!scheduled && !retry && !input.force) return out('idle');
    const [run] = await tx
      .insert(syncRuns)
      .values({
        orgId,
        connectionId: c.id,
        trigger: scheduled || input.force ? 'schedule' : 'retry',
        status: 'running',
        ...lease,
      })
      .returning({ id: syncRuns.id });
    return out('claimed', run?.id ?? null);
  },
  audit: (input, r) => ({
    action: 'integrations.sync.claim',
    targetType: 'integration_connection',
    targetId: input.connectionId,
    data: { status: r.status, runId: r.runId },
  }),
});

const RemoteRecordInput = z.object({
  id: z.string().min(1).max(255),
  version: z.string().min(1).max(255),
  updatedAt: z.date().nullable(),
  origin: z.string().max(200).nullable(),
  fields: z.record(z.string(), z.unknown()),
});

/** Apply one page of provider records (pull). Built per connector (its `write`). */
export function pullPageCommand(connector: ConnectorDefinition) {
  return tenantCommand({
    name: 'integrations.pullPage',
    input: z.object({
      runId: z.uuid(),
      objectType: z.string(),
      records: z.array(RemoteRecordInput).max(500),
      /** Provider ids whose records are gone (a retried record that no longer exists). */
      gone: z.array(z.string().min(1).max(255)).max(500).default([]),
      /** The page's cursor; null leaves the stored one. */
      cursor: z.string().max(1000).nullable(),
    }),
    output: z.object({ pulled: z.int(), skipped: z.int(), failed: z.int() }),
    entitlement: 'integrations',
    permission: SYNC_PERMISSION,
    handler: async ({ input, ctx, tx, emit }) => {
      const { run, connection } = await runningTx(tx, input.runId);
      const object = connector.objects.find((o) => o.key === input.objectType);
      if (!object?.pull || connection.connector !== connector.key)
        throw new DomainError('not_found', 'Unknown object');
      const pull = object.pull;
      const rules = await rulesTx(tx, connection.id, object, 'pull');
      const origin = originStamp(connection.id);
      const counts = { pulled: 0, skipped: 0, failed: 0 };
      const base = {
        connectionId: connection.id,
        runId: run.id,
        objectType: object.key,
        direction: 'pull' as const,
        localId: null,
      };
      for (const record of input.records as RemoteRecord[]) {
        const key = pullKey(object.key, record.id);
        const [link] = await tx
          .select()
          .from(recordLinks)
          .where(
            and(
              eq(recordLinks.connectionId, connection.id),
              eq(recordLinks.objectType, object.key),
              eq(recordLinks.externalId, record.id),
            ),
          );
        const local = link && object.push ? await object.push.read(tx, link.localId) : null;
        const decision = decidePull(
          record,
          link ?? null,
          origin,
          local ? { hash: fieldsHash(local.fields), updatedAt: local.updatedAt } : null,
        );
        if (decision.action === 'skip') {
          counts.skipped += 1;
          continue;
        }
        const mapped = applyMapping(record.fields, rules, object.localFields);
        if (!mapped.ok) {
          await recordErrorTx(tx, ctx, {
            ...base,
            step: 'map',
            externalId: record.id,
            recordKey: key,
            code: mapped.code,
            field: mapped.field,
          });
          counts.failed += 1;
          continue;
        }
        try {
          // A savepoint: a failed write leaves nothing behind and the page goes on.
          await tx.transaction(async (sp) => {
            const { localId } = await pull.write(sp, ctx, mapped.values, link?.localId ?? null, {
              connectionId: connection.id,
              record,
              emit,
            });
            const after = object.push ? await object.push.read(sp, localId) : null;
            const values = {
              localId,
              remoteVersion: record.version,
              localHash: after ? fieldsHash(after.fields) : null,
              lastDirection: 'pull',
              lastSyncedAt: ctx.now,
              updatedAt: ctx.now,
            };
            await sp
              .insert(recordLinks)
              .values({
                orgId: requireOrg(ctx),
                connectionId: connection.id,
                objectType: object.key,
                externalId: record.id,
                ...values,
              })
              .onConflictDoUpdate({
                target: [
                  recordLinks.orgId,
                  recordLinks.connectionId,
                  recordLinks.objectType,
                  recordLinks.externalId,
                ],
                set: values,
              });
          });
          await resolveErrorsTx(tx, ctx, connection.id, [key]);
          counts.pulled += 1;
        } catch (err) {
          await recordErrorTx(tx, ctx, {
            ...base,
            step: 'write',
            externalId: record.id,
            recordKey: key,
            // Two provider records for one Yayatoh record (the same email twice).
            code: isUniqueViolation(err)
              ? 'duplicate_record'
              : isDomainError(err)
                ? err.code
                : 'write_failed',
            field: null,
          });
          counts.failed += 1;
        }
      }
      // Records the provider no longer has: nothing left to retry.
      await resolveErrorsTx(
        tx,
        ctx,
        connection.id,
        input.gone.map((id) => pullKey(object.key, id)),
      );
      if (input.cursor !== null) await setCursorTx(tx, ctx, connection.id, object.key, 'pull', input.cursor);
      await bumpRunTx(tx, ctx, run.id, counts);
      return { ...counts, connectionId: connection.id };
    },
    present: (r) => ({ pulled: r.pulled, skipped: r.skipped, failed: r.failed }),
    audit: (input, r) => ({
      action: 'integrations.sync.pull_page',
      targetType: 'integration_connection',
      targetId: r.connectionId,
      data: {
        runId: input.runId,
        objectType: input.objectType,
        pulled: r.pulled,
        skipped: r.skipped,
        failed: r.failed,
      },
    }),
  });
}

const PushResult = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('sent'),
    localId: z.uuid(),
    externalId: z.string().min(1).max(255),
    version: z.string().min(1).max(255),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  z.object({ outcome: z.literal('skipped'), localId: z.uuid() }),
  z.object({
    outcome: z.literal('failed'),
    localId: z.uuid(),
    externalId: z.string().max(255).nullable(),
    step: z.enum(['map', 'push']),
    code: z.string().max(100),
    field: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,62}$/)
      .nullable(),
  }),
  z.object({ outcome: z.literal('gone'), localId: z.uuid() }),
]);
type PushResult = z.infer<typeof PushResult>;

/** Record one page of pushes (the provider calls happened before; links, errors, the cursor). */
export const pushPageCommand = tenantCommand({
  name: 'integrations.pushPage',
  input: z.object({
    runId: z.uuid(),
    objectType: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
    results: z.array(PushResult).max(500),
    cursor: z.string().max(1000).nullable(),
  }),
  output: z.object({ pushed: z.int(), skipped: z.int(), failed: z.int() }),
  entitlement: 'integrations',
  permission: SYNC_PERMISSION,
  handler: async ({ input, ctx, tx }) => {
    const { run, connection } = await runningTx(tx, input.runId);
    const orgId = requireOrg(ctx);
    const counts = { pushed: 0, skipped: 0, failed: 0 };
    const resolved: string[] = [];
    for (const r of input.results) {
      const key = localKey(input.objectType, r.localId);
      if (r.outcome === 'skipped') counts.skipped += 1;
      else if (r.outcome === 'gone') resolved.push(key);
      else if (r.outcome === 'failed') {
        await recordErrorTx(tx, ctx, {
          connectionId: connection.id,
          runId: run.id,
          step: r.step,
          objectType: input.objectType,
          direction: 'push',
          externalId: r.externalId,
          localId: r.localId,
          recordKey: key,
          code: r.code,
          field: r.field,
        });
        counts.failed += 1;
      } else {
        // One provider record per Yayatoh record: a link to another provider id is replaced.
        await tx
          .delete(recordLinks)
          .where(
            and(
              eq(recordLinks.connectionId, connection.id),
              eq(recordLinks.objectType, input.objectType),
              eq(recordLinks.localId, r.localId),
              sql`${recordLinks.externalId} <> ${r.externalId}`,
            ),
          );
        const values = {
          localId: r.localId,
          remoteVersion: r.version,
          localHash: r.hash,
          lastDirection: 'push',
          lastSyncedAt: ctx.now,
          updatedAt: ctx.now,
        };
        await tx
          .insert(recordLinks)
          .values({
            orgId,
            connectionId: connection.id,
            objectType: input.objectType,
            externalId: r.externalId,
            ...values,
          })
          .onConflictDoUpdate({
            target: [
              recordLinks.orgId,
              recordLinks.connectionId,
              recordLinks.objectType,
              recordLinks.externalId,
            ],
            set: values,
          });
        resolved.push(key);
        counts.pushed += 1;
      }
    }
    await resolveErrorsTx(tx, ctx, connection.id, resolved);
    if (input.cursor !== null)
      await setCursorTx(tx, ctx, connection.id, input.objectType, 'push', input.cursor);
    await bumpRunTx(tx, ctx, run.id, counts);
    return { ...counts, connectionId: connection.id };
  },
  present: (r) => ({ pushed: r.pushed, skipped: r.skipped, failed: r.failed }),
  audit: (input, r) => ({
    action: 'integrations.sync.push_page',
    targetType: 'integration_connection',
    targetId: r.connectionId,
    data: {
      runId: input.runId,
      objectType: input.objectType,
      pushed: r.pushed,
      skipped: r.skipped,
      failed: r.failed,
    },
  }),
});

/** End a run: its status, the connection's next sync, the outbox event; a provider refusal revokes. */
export const finishRunCommand = tenantCommand({
  name: 'integrations.finishRun',
  input: z.object({
    runId: z.uuid(),
    outcome: z.enum(['done', 'failed', 'cancelled']),
    errorCode: z.string().max(100).nullable().default(null),
    /** The step a whole-run failure happened at (shown in the errors inbox). */
    step: z.enum(['pull', 'push']).nullable().default(null),
    revoked: z.boolean().default(false),
  }),
  output: z.object({ status: z.enum(RUN_STATUSES), connectionStatus: z.string() }),
  entitlement: null,
  permission: SYNC_PERMISSION,
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const [run] = await tx.select().from(syncRuns).where(eq(syncRuns.id, input.runId)).for('update');
    if (!run) throw new DomainError('not_found', 'Run not found');
    const [c] = await tx.select().from(connections).where(eq(connections.id, run.connectionId)).for('update');
    if (!c) throw new DomainError('not_found', 'Connection not found');
    // Already ended (cancelled by a pause or a disconnect while it ran): nothing more to do.
    if (run.status !== 'running')
      return {
        status: run.status as z.infer<typeof SyncCompletedPayload>['status'],
        connectionStatus: c.status,
        runId: run.id,
      };
    const status =
      input.outcome === 'failed'
        ? 'failed'
        : input.outcome === 'cancelled'
          ? 'cancelled'
          : run.failed > 0
            ? 'partial'
            : 'succeeded';
    await tx
      .update(syncRuns)
      .set({
        status,
        errorCode: input.errorCode ? code(input.errorCode) : null,
        finishedAt: ctx.now,
        leaseUntil: null,
        updatedAt: ctx.now,
      })
      .where(eq(syncRuns.id, run.id));
    let connectionStatus = c.status;
    if (input.revoked && c.status === 'active') {
      connectionStatus = 'revoked';
      await tx
        .update(connections)
        .set({
          status: 'revoked',
          revokedAt: ctx.now,
          revokeReason: 'provider',
          nextSyncAt: null,
          lastSyncAt: ctx.now,
          lastSyncStatus: status,
          updatedAt: ctx.now,
        })
        .where(eq(connections.id, c.id));
      await recordErrorTx(tx, ctx, {
        connectionId: c.id,
        runId: run.id,
        step: 'auth',
        objectType: null,
        direction: null,
        externalId: null,
        localId: null,
        recordKey: CONNECTION_KEY,
        code: 'auth_revoked',
        field: null,
      });
      emit({
        type: CONNECTION_REVOKED_EVENT,
        version: 1,
        aggregateType: 'integration_connection',
        aggregateId: c.id,
        payload: { orgId, connectionId: c.id, connector: c.connector, reason: 'provider' },
      });
    } else if (c.status === 'active') {
      const failures = status === 'failed' ? c.consecutiveFailures + 1 : 0;
      await tx
        .update(connections)
        .set({
          lastSyncAt: ctx.now,
          lastSyncStatus: status,
          consecutiveFailures: failures,
          nextSyncAt: nextSyncAt(ctx.now, c.syncIntervalMinutes, failures),
          updatedAt: ctx.now,
        })
        .where(eq(connections.id, c.id));
      if (status === 'failed' && input.errorCode)
        await recordErrorTx(tx, ctx, {
          connectionId: c.id,
          runId: run.id,
          step: input.step ?? 'pull',
          objectType: null,
          direction: null,
          externalId: null,
          localId: null,
          recordKey: CONNECTION_KEY,
          code: input.errorCode,
          field: null,
        });
      else if (status !== 'failed' && status !== 'cancelled')
        // The provider answers again: the run-level failures are over.
        await tx
          .update(syncErrors)
          .set({ status: 'resolved', resolvedAt: ctx.now, nextRetryAt: null, updatedAt: ctx.now })
          .where(
            and(
              eq(syncErrors.connectionId, c.id),
              eq(syncErrors.status, 'open'),
              eq(syncErrors.recordKey, CONNECTION_KEY),
              inArray(syncErrors.step, ['pull', 'push']),
            ),
          );
    }
    emit({
      type: SYNC_COMPLETED_EVENT,
      version: 1,
      aggregateType: 'integration_connection',
      aggregateId: c.id,
      payload: SyncCompletedPayload.parse({
        orgId,
        connectionId: c.id,
        connector: c.connector,
        runId: run.id,
        status,
        pulled: run.pulled,
        pushed: run.pushed,
        skipped: run.skipped,
        failed: run.failed,
      }),
    });
    return { status, connectionStatus, runId: run.id };
  },
  present: (r) => ({ status: r.status, connectionStatus: r.connectionStatus }),
  audit: (input, r) => ({
    action: 'integrations.sync.finish',
    targetType: 'integration_run',
    targetId: r.runId,
    data: { status: r.status, errorCode: input.errorCode, revoked: input.revoked },
  }),
});

export interface SyncResult {
  readonly status: 'claimed' | 'busy' | 'idle' | 'inactive';
  readonly runId: string | null;
  /** The run's final status (claimed runs only). */
  readonly runStatus: (typeof RUN_STATUSES)[number] | null;
  readonly connectionStatus: string | null;
}

/** Due retries for one object and direction (provider ids for pull, our ids for push). */
async function dueRetries(ctx: Ctx, connectionId: string, objectType: string, direction: 'pull' | 'push') {
  return withTenant(ctx, (tx) =>
    tx
      .select({ externalId: syncErrors.externalId, localId: syncErrors.localId })
      .from(syncErrors)
      .where(
        and(
          eq(syncErrors.connectionId, connectionId),
          eq(syncErrors.status, 'open'),
          eq(syncErrors.objectType, objectType),
          eq(syncErrors.direction, direction),
          isNotNull(syncErrors.nextRetryAt),
          lte(syncErrors.nextRetryAt, ctx.now),
        ),
      )
      .limit(RETRY_BATCH),
  );
}

async function cursorOf(ctx: Ctx, connectionId: string, objectType: string, direction: 'pull' | 'push') {
  const [row] = await withTenant(ctx, (tx) =>
    tx
      .select({ cursor: syncCursors.cursor })
      .from(syncCursors)
      .where(
        and(
          eq(syncCursors.connectionId, connectionId),
          eq(syncCursors.objectType, objectType),
          eq(syncCursors.direction, direction),
        ),
      ),
  );
  return row?.cursor ?? null;
}

/** Thrown to stop a run where it is: the step it failed at and the code. */
class RunStop extends Error {
  readonly step: 'pull' | 'push';
  readonly reason: unknown;
  constructor(step: 'pull' | 'push', reason: unknown) {
    super('run stopped');
    this.step = step;
    this.reason = reason;
  }
}

async function pullObject(
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
  connector: ConnectorDefinition,
  object: ObjectDefinition,
  io: SyncIO,
  runId: string,
  connectionId: string,
) {
  const pull = object.pull;
  if (!pull) return;
  const command = pullPageCommand(connector);
  try {
    // Retries first: each failed record is fetched again by its provider id.
    const due = await dueRetries(ctx, connectionId, object.key, 'pull');
    if (due.length) {
      const records: RemoteRecord[] = [];
      const gone: string[] = [];
      for (const { externalId } of due) {
        if (!externalId) continue;
        const r = await pull.get(io, externalId);
        if (r) records.push(r);
        else gone.push(externalId);
      }
      await executeCommand(
        command,
        { runId, objectType: object.key, records, gone, cursor: null },
        ctx,
        ports,
      );
    }
    let cursor = await cursorOf(ctx, connectionId, object.key, 'pull');
    for (let page = 0; page < MAX_PAGES; page++) {
      const p = await pull.list(io, cursor);
      await executeCommand(
        command,
        { runId, objectType: object.key, records: p.records, cursor: p.cursor },
        ctx,
        ports,
      );
      if (!p.hasMore || p.cursor === null) break;
      cursor = p.cursor;
    }
  } catch (err) {
    throw isProviderError(err) ? new RunStop('pull', err) : err;
  }
}

async function pushObject(
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
  object: ObjectDefinition,
  io: SyncIO,
  runId: string,
  connectionId: string,
) {
  const push = object.push;
  if (!push) return;
  const sendAll = async (locals: readonly LocalRecord[], gone: readonly string[], cursor: string | null) => {
    const { rules, links } = await withTenant(ctx, async (tx) => ({
      rules: await rulesTx(tx, connectionId, object, 'push'),
      links: locals.length
        ? await tx
            .select()
            .from(recordLinks)
            .where(
              and(
                eq(recordLinks.connectionId, connectionId),
                eq(recordLinks.objectType, object.key),
                inArray(
                  recordLinks.localId,
                  locals.map((l) => l.id),
                ),
              ),
            )
        : [],
    }));
    const byLocal = new Map(links.map((l) => [l.localId, l]));
    const results: PushResult[] = gone.map((localId) => ({ outcome: 'gone', localId }));
    for (const local of locals) {
      const link = byLocal.get(local.id) ?? null;
      const hash = fieldsHash(local.fields);
      if (decidePush(hash, link).action === 'skip') {
        results.push({ outcome: 'skipped', localId: local.id });
        continue;
      }
      const mapped = applyMapping(local.fields, rules, object.remoteFields);
      if (!mapped.ok) {
        results.push({
          outcome: 'failed',
          localId: local.id,
          externalId: link?.externalId ?? null,
          step: 'map',
          code: mapped.code,
          field: mapped.field,
        });
        continue;
      }
      try {
        const sent = await push.send(io, {
          externalId: link?.externalId ?? null,
          values: mapped.values,
          idempotencyKey: pushKey(connectionId, object.key, local.id, hash),
          local,
        });
        results.push({
          outcome: 'sent',
          localId: local.id,
          externalId: sent.externalId,
          version: sent.version,
          hash,
        });
      } catch (err) {
        // A refusal stops the run (the connection is revoked); other failures stay with the record.
        if (isProviderError(err) && err.auth) throw new RunStop('push', err);
        results.push({
          outcome: 'failed',
          localId: local.id,
          externalId: link?.externalId ?? null,
          step: 'push',
          code: isProviderError(err) ? err.code : 'push_failed',
          field: null,
        });
      }
    }
    await executeCommand(pushPageCommand, { runId, objectType: object.key, results, cursor }, ctx, ports);
  };
  const due = await dueRetries(ctx, connectionId, object.key, 'push');
  if (due.length) {
    const ids = due.flatMap((d) => (d.localId ? [d.localId] : []));
    const locals = await withTenant(ctx, async (tx) =>
      Promise.all(ids.map(async (id) => ({ id, record: await push.read(tx, id) }))),
    );
    await sendAll(
      locals.flatMap((l) => (l.record ? [l.record] : [])),
      locals.filter((l) => !l.record).map((l) => l.id),
      null,
    );
  }
  let cursor = await cursorOf(ctx, connectionId, object.key, 'push');
  for (let page = 0; page < MAX_PAGES; page++) {
    const p = await withTenant(ctx, (tx) =>
      push.changes(tx, cursor, PUSH_PAGE, { connectionId, scope: io.scope }),
    );
    if (p.records.length === 0) {
      // M6.5b: a page that filtered every record out (consent, links) still moves the cursor on.
      if (p.cursor !== null && p.cursor !== cursor)
        await executeCommand(
          pushPageCommand,
          { runId, objectType: object.key, results: [], cursor: p.cursor },
          ctx,
          ports,
        );
      break;
    }
    await sendAll(p.records, [], p.cursor);
    if (!p.hasMore || p.cursor === null) break;
    cursor = p.cursor;
  }
}

/**
 * Run one sync for one connection now (if it has work, or `force`). Safe to call concurrently:
 * the claim lets one runner in; the others get `busy`.
 */
export async function runSync(
  orgId: string,
  connectionId: string,
  deps: SyncDeps,
  ports: CommandPorts<TenantTx>,
  opts: { now?: Date; force?: boolean } = {},
): Promise<SyncResult> {
  const now = opts.now ?? new Date();
  const ctx = createCtx({ orgId, actor: SYNC_ACTOR, now });
  let claim: {
    status: SyncResult['status'];
    runId: string | null;
    connector: string;
    authConnectionId: string | null;
  };
  try {
    claim = await executeCommand(claimRunCommand, { connectionId, force: opts.force ?? false }, ctx, ports);
  } catch (err) {
    if (isDomainError(err) && err.code === 'module_not_enabled')
      return { status: 'inactive', runId: null, runStatus: null, connectionStatus: null };
    throw err;
  }
  if (claim.status !== 'claimed' || !claim.runId)
    return { status: claim.status, runId: claim.runId, runStatus: null, connectionStatus: null };
  const runId = claim.runId;
  const finish = async (
    outcome: 'done' | 'failed' | 'cancelled',
    extra: { errorCode?: string; step?: 'pull' | 'push'; revoked?: boolean } = {},
  ): Promise<SyncResult> => {
    const r = await executeCommand(
      finishRunCommand,
      {
        runId,
        outcome,
        errorCode: extra.errorCode ?? null,
        step: extra.step ?? null,
        revoked: extra.revoked ?? false,
      },
      ctx,
      ports,
    );
    return { status: 'claimed', runId, runStatus: r.status, connectionStatus: r.connectionStatus };
  };
  const connector = connectorByKey(claim.connector);
  if (!connector || !claim.authConnectionId) return finish('failed', { errorCode: 'unknown_connector' });
  const ref: AuthRef = {
    orgId,
    connectionId,
    providerConfigKey: connector.providerConfigKey,
    authConnectionId: claim.authConnectionId,
  };
  try {
    if ((await deps.auth.check(ref)) === 'revoked')
      return finish('failed', { errorCode: 'auth_revoked', revoked: true });
    const scope = connector.loadScope
      ? await withTenant(ctx, (tx) => connector.loadScope?.(tx, connectionId) ?? Promise.resolve({}))
      : {};
    const io: SyncIO = { client: deps.auth.client(ref), origin: originStamp(connectionId), now, scope };
    for (const object of connector.objects) {
      await pullObject(ctx, ports, connector, object, io, runId, connectionId);
      try {
        await pushObject(ctx, ports, object, io, runId, connectionId);
      } catch (err) {
        throw isProviderError(err) ? new RunStop('push', err) : err;
      }
    }
    return finish('done');
  } catch (err) {
    const cause = err instanceof RunStop ? err.reason : err;
    if (isProviderError(cause) && cause.auth)
      return finish('failed', { errorCode: 'auth_revoked', revoked: true });
    if (isDomainError(cause) && cause.details?.reason === 'run_ended') return finish('cancelled');
    return finish('failed', {
      errorCode: isProviderError(cause) ? cause.code : isDomainError(cause) ? cause.code : 'sync_failed',
      ...(err instanceof RunStop ? { step: err.step } : {}),
    });
  }
}

/** The org's connections with sync work now (queued runs, due schedules, due retries). */
export async function connectionsWithWorkTx(tx: TenantTx, now: Date): Promise<string[]> {
  const rows = await tx
    .select({ id: connections.id })
    .from(connections)
    .where(
      and(
        eq(connections.status, 'active'),
        or(
          lte(connections.nextSyncAt, now),
          sql`exists (select 1 from ${syncRuns} r where r.org_id = ${connections.orgId} and r.connection_id = ${connections.id} and r.status = 'queued')`,
          sql`exists (select 1 from ${syncErrors} e where e.org_id = ${connections.orgId} and e.connection_id = ${connections.id} and e.status = 'open' and e.next_retry_at <= ${now.toISOString()}::timestamptz)`,
        ),
      ),
    );
  return rows.map((r) => r.id);
}

/** One pass for one org (the dev drain): every connection with work, one after another. */
export async function runDueSyncs(
  orgId: string,
  deps: SyncDeps,
  ports: CommandPorts<TenantTx>,
  opts: { now?: Date } = {},
): Promise<SyncResult[]> {
  const now = opts.now ?? new Date();
  const ctx = createCtx({ orgId, actor: SYNC_ACTOR, now });
  const ids = await withTenant(ctx, (tx) => connectionsWithWorkTx(tx, now));
  const out: SyncResult[] = [];
  for (const id of ids) out.push(await runSync(orgId, id, deps, ports, { now }));
  return out;
}
