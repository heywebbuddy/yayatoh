import { effectiveModulesTx } from '@yayatoh/billing';
import { defineSerializer } from '@yayatoh/contracts';
import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { connectorByKey } from './connectors/index.ts';
import { MAPPING_DIRECTIONS, MappingRule } from './domain/mapping.ts';
import {
  ACTIVE_RUN_STATUSES,
  CONNECTION_STATUSES,
  DEFAULT_SYNC_INTERVAL_MINUTES,
  LIVE_STATUSES,
  REVOKE_REASONS,
  RUN_STATUSES,
  RUN_TRIGGERS,
  SYNC_INTERVALS,
} from './domain/sync.ts';
import { newState, sha256 } from './hash.ts';
import { connections, fieldMappings, syncCursors, syncErrors, syncRuns } from './schema.ts';
import type { ConnectorDefinition } from './sdk/connector.ts';

/**
 * Connections (M6.4a): connect through the `IntegrationAuth` port (begin → the provider's consent
 * screen → complete), pause and resume, disconnect, change the sync interval, sync now. Reads need
 * `integrations:read`; writes `integrations:manage` (owners and admins). Every command needs the
 * `integrations` module and the connector's own key (P6-13). The port's network calls happen in
 * the transport between commands (never inside a transaction): these commands only keep state.
 */

/** A pending connect is valid this long. */
export const CONNECT_STATE_TTL_MS = 15 * 60_000;
/** Background syncs retry provider outages; a run started by a person runs once. */
export const RECENT_RUNS = 10;

export const ConnectionDto = z.object({
  id: z.uuid(),
  connector: z.string(),
  status: z.enum(CONNECTION_STATUSES),
  accountLabel: z.string().nullable(),
  connectedAt: z.date().nullable(),
  pausedAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
  revokeReason: z.enum(REVOKE_REASONS).nullable(),
  syncIntervalMinutes: z.int(),
  nextSyncAt: z.date().nullable(),
  lastSyncAt: z.date().nullable(),
  lastSyncStatus: z.enum(RUN_STATUSES).nullable(),
  openErrors: z.int(),
  createdAt: z.date(),
});
export type ConnectionDto = z.infer<typeof ConnectionDto>;
export const connectionSerializer = defineSerializer('integrations.connection', ConnectionDto);

export const RunDto = z.object({
  id: z.uuid(),
  trigger: z.enum(RUN_TRIGGERS),
  status: z.enum(RUN_STATUSES),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
  pulled: z.int(),
  pushed: z.int(),
  skipped: z.int(),
  failed: z.int(),
  errorCode: z.string().nullable(),
  createdAt: z.date(),
});
export type RunDto = z.infer<typeof RunDto>;

export const MappingDto = z.object({
  objectType: z.string(),
  direction: z.enum(MAPPING_DIRECTIONS),
  version: z.int(),
  rules: z.array(MappingRule),
  createdAt: z.date(),
});
export type MappingDto = z.infer<typeof MappingDto>;

export const ConnectionDetailDto = z.object({
  connection: ConnectionDto,
  mappings: z.array(MappingDto),
  runs: z.array(RunDto),
  /** Whether a run is queued or running now (the "Sync now" button waits). */
  syncing: z.boolean(),
});
export type ConnectionDetailDto = z.infer<typeof ConnectionDetailDto>;
export const connectionDetailSerializer = defineSerializer(
  'integrations.connectionDetail',
  ConnectionDetailDto,
);

type ConnectionRow = typeof connections.$inferSelect;

/** Stored rules, keeping only well-formed ones (a hand-edited row never breaks a page or a run). */
export function parseRules(raw: unknown): MappingRule[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const p = MappingRule.safeParse(r);
    return p.success ? [p.data] : [];
  });
}

async function openErrorCountsTx(tx: TenantTx, ids: readonly string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: syncErrors.connectionId, n: sql<number>`count(*)::int` })
    .from(syncErrors)
    .where(and(inArray(syncErrors.connectionId, [...ids]), eq(syncErrors.status, 'open')))
    .groupBy(syncErrors.connectionId);
  return new Map(rows.map((r) => [r.id, r.n]));
}

const toDto = (c: ConnectionRow, openErrors: number): ConnectionDto => ({
  id: c.id,
  connector: c.connector,
  status: c.status as ConnectionDto['status'],
  accountLabel: c.accountLabel,
  connectedAt: c.connectedAt,
  pausedAt: c.pausedAt,
  revokedAt: c.revokedAt,
  revokeReason: c.revokeReason as ConnectionDto['revokeReason'],
  syncIntervalMinutes: c.syncIntervalMinutes,
  nextSyncAt: c.status === 'active' ? c.nextSyncAt : null,
  lastSyncAt: c.lastSyncAt,
  lastSyncStatus: c.lastSyncStatus as ConnectionDto['lastSyncStatus'],
  openErrors,
  createdAt: c.createdAt,
});

/** The connector or `not_found`. */
export function requireConnector(key: string): ConnectorDefinition {
  const c = connectorByKey(key);
  if (!c) throw new DomainError('not_found', 'Unknown connector');
  return c;
}

/** An org connector (M6.5c: registrants make their personal ones from their schedule page). */
function requireOrgConnector(key: string): ConnectorDefinition {
  const c = requireConnector(key);
  if (c.audience === 'registrant') throw new DomainError('not_found', 'Unknown connector');
  return c;
}

/** The first sync interval of a new connection (the connector's, else the default). */
export const initialInterval = (c: ConnectorDefinition) =>
  c.defaultSyncIntervalMinutes && (SYNC_INTERVALS as readonly number[]).includes(c.defaultSyncIntervalMinutes)
    ? c.defaultSyncIntervalMinutes
    : DEFAULT_SYNC_INTERVAL_MINUTES;

/** The org must hold the connector's own module key too (P6-13). */
async function requireConnectorEntitlementTx(tx: TenantTx, c: ConnectorDefinition): Promise<void> {
  if (c.entitlement === 'integrations') return;
  if (!(await effectiveModulesTx(tx)).has(c.entitlement))
    throw new DomainError('module_not_enabled', 'Not in your plan', { module: c.entitlement });
}

export async function connectionTx(tx: TenantTx, connectionId: string, lock = false): Promise<ConnectionRow> {
  const q = tx.select().from(connections).where(eq(connections.id, connectionId));
  const [row] = lock ? await q.for('update') : await q;
  if (!row) throw new DomainError('not_found', 'Connection not found');
  return row;
}

/** Each connector's current connection (the live one, else the latest ended one). */
export const listConnectionsQuery = tenantQuery({
  name: 'integrations.listConnections',
  input: z.object({}),
  output: z.array(ConnectionDto),
  entitlement: 'integrations',
  permission: 'integrations:read',
  handler: async ({ tx }) => {
    const rows = await tx
      .selectDistinctOn([connections.connector])
      .from(connections)
      // Registrants' personal connections (M6.5c) are theirs, not the org's integrations.
      .where(isNull(connections.registrantId))
      .orderBy(
        connections.connector,
        desc(sql`${connections.status} in ('pending', 'active', 'paused')`),
        desc(connections.createdAt),
      );
    const counts = await openErrorCountsTx(
      tx,
      rows.map((r) => r.id),
    );
    return rows.map((r) => toDto(r, counts.get(r.id) ?? 0));
  },
});

/** The newest mapping version per object and direction. */
export async function currentMappingsTx(tx: TenantTx, connectionId: string): Promise<MappingDto[]> {
  const rows = await tx
    .selectDistinctOn([fieldMappings.objectType, fieldMappings.direction])
    .from(fieldMappings)
    .where(eq(fieldMappings.connectionId, connectionId))
    .orderBy(fieldMappings.objectType, fieldMappings.direction, desc(fieldMappings.version));
  return rows.map((m) => ({
    objectType: m.objectType,
    direction: m.direction as MappingDto['direction'],
    version: m.version,
    rules: parseRules(m.rules),
    createdAt: m.createdAt,
  }));
}

export const connectionDetailQuery = tenantQuery({
  name: 'integrations.connectionDetail',
  input: z.object({ connectionId: z.uuid() }),
  output: ConnectionDetailDto,
  entitlement: 'integrations',
  permission: 'integrations:read',
  handler: async ({ input, tx }) => {
    const c = await connectionTx(tx, input.connectionId);
    if (c.registrantId) throw new DomainError('not_found', 'Connection not found');
    const [counts, mappings, runs] = await Promise.all([
      openErrorCountsTx(tx, [c.id]),
      currentMappingsTx(tx, c.id),
      tx
        .select()
        .from(syncRuns)
        .where(eq(syncRuns.connectionId, c.id))
        .orderBy(desc(syncRuns.createdAt))
        .limit(RECENT_RUNS),
    ]);
    return {
      connection: toDto(c, counts.get(c.id) ?? 0),
      mappings,
      runs: runs.map((r) => ({
        id: r.id,
        trigger: r.trigger as RunDto['trigger'],
        status: r.status as RunDto['status'],
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        pulled: r.pulled,
        pushed: r.pushed,
        skipped: r.skipped,
        failed: r.failed,
        errorCode: r.errorCode,
        createdAt: r.createdAt,
      })),
      syncing: runs.some((r) => (ACTIVE_RUN_STATUSES as readonly string[]).includes(r.status)),
    };
  },
});

const ConnectorKey = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);

/**
 * Start connecting a connector: a pending connection with a fresh single-use state (its hash is
 * stored). The transport then asks the port for the consent URL. Restarting a pending connect
 * replaces its state; a connector that is already connected (or paused) is a conflict.
 */
export const beginConnectCommand = tenantCommand({
  name: 'integrations.beginConnect',
  input: z.object({ connector: ConnectorKey }),
  output: z.object({ connectionId: z.uuid(), state: z.string() }),
  entitlement: 'integrations',
  permission: 'integrations:manage',
  // Connecting lets org data leave for a third party: never while staff act as a member.
  category: 'export',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const c = requireOrgConnector(input.connector);
    await requireConnectorEntitlementTx(tx, c);
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
          eq(connections.connector, c.key),
          isNull(connections.registrantId),
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
        connector: c.key,
        status: 'pending',
        syncIntervalMinutes: initialInterval(c),
        ...pending,
      })
      .returning({ id: connections.id });
    if (!row) throw new DomainError('internal');
    return { connectionId: row.id, state };
  },
  audit: (input, r) => ({
    action: 'integrations.connect.begin',
    targetType: 'integration_connection',
    targetId: r.connectionId,
    data: { connector: input.connector },
  }),
});

/** The pending connection a callback's state belongs to (expired or unknown → not_found). */
export const pendingConnectionQuery = tenantQuery({
  name: 'integrations.pendingConnection',
  input: z.object({ state: z.string().min(16).max(200) }),
  output: z.object({ connectionId: z.uuid(), connector: z.string() }),
  entitlement: 'integrations',
  permission: 'integrations:manage',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .select({ connectionId: connections.id, connector: connections.connector })
      .from(connections)
      .where(
        and(
          eq(connections.stateHash, sha256(input.state)),
          eq(connections.status, 'pending'),
          isNull(connections.registrantId),
          gt(connections.stateExpiresAt, ctx.now),
        ),
      );
    if (!row) throw new DomainError('not_found', 'This connect link has expired');
    return row;
  },
});

export async function seedMappingsTx(tx: TenantTx, ctx: Ctx, connectionId: string, c: ConnectorDefinition) {
  const orgId = requireOrg(ctx);
  const existing = await currentMappingsTx(tx, connectionId);
  const have = new Set(existing.map((m) => `${m.objectType}:${m.direction}`));
  const rows = c.objects.flatMap((o) =>
    (['pull', 'push'] as const).flatMap((direction) => {
      const side = o[direction];
      if (!side || have.has(`${o.key}:${direction}`)) return [];
      return [
        {
          orgId,
          connectionId,
          objectType: o.key,
          direction,
          version: 1,
          rules: side.defaultMapping.map((r) => MappingRule.parse(r)),
          createdBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
        },
      ];
    }),
  );
  if (rows.length) await tx.insert(fieldMappings).values(rows);
}

/**
 * Finish a connect once the port found the provider-side connection: active, with the default
 * mappings (version 1) and a first sync queued. With a `state`, it must be the pending one's and
 * unexpired (the OAuth callback); without, the provider's own record of our connection id proves
 * it (Nango's hosted connect: "Check connection").
 */
export const completeConnectCommand = tenantCommand({
  name: 'integrations.completeConnect',
  input: z.object({
    connectionId: z.uuid(),
    state: z.string().min(16).max(200).nullable(),
    authConnectionId: z.string().regex(/^[A-Za-z0-9._:-]{1,255}$/),
    accountLabel: z.string().trim().max(120).nullable(),
  }),
  output: z.object({ connectionId: z.uuid() }),
  entitlement: 'integrations',
  permission: 'integrations:manage',
  category: 'export',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const c = await connectionTx(tx, input.connectionId, true);
    if (c.registrantId) throw new DomainError('not_found', 'Connection not found');
    const connector = requireConnector(c.connector);
    await requireConnectorEntitlementTx(tx, connector);
    if (c.status !== 'pending') throw new DomainError('invalid_state', 'Not waiting for a connect');
    if (
      input.state !== null &&
      (c.stateHash !== sha256(input.state) || !c.stateExpiresAt || c.stateExpiresAt <= ctx.now)
    )
      throw new DomainError('not_found', 'This connect link has expired');
    await tx
      .update(connections)
      .set({
        status: 'active',
        authConnectionId: input.authConnectionId,
        accountLabel: input.accountLabel || null,
        stateHash: null,
        stateExpiresAt: null,
        connectedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
        connectedAt: ctx.now,
        nextSyncAt: ctx.now,
        consecutiveFailures: 0,
        updatedAt: ctx.now,
      })
      .where(eq(connections.id, c.id));
    await seedMappingsTx(tx, ctx, c.id, connector);
    // The first sync, as soon as the scheduler sees it.
    await tx.insert(syncRuns).values({ orgId, connectionId: c.id, trigger: 'schedule', status: 'queued' });
    emit({
      type: 'integrations.connection_connected',
      version: 1,
      aggregateType: 'integration_connection',
      aggregateId: c.id,
      payload: { orgId, connectionId: c.id, connector: c.connector },
    });
    return { connectionId: c.id, connector: c.connector };
  },
  present: (r) => ({ connectionId: r.connectionId }),
  audit: (_input, r) => ({
    action: 'integrations.connect.complete',
    targetType: 'integration_connection',
    targetId: r.connectionId,
    data: { connector: r.connector },
  }),
});

/** The consent was refused or abandoned: the pending connection ends as `failed`. */
export const failConnectCommand = tenantCommand({
  name: 'integrations.failConnect',
  input: z.object({ connectionId: z.uuid(), reason: z.enum(['denied', 'cancelled', 'not_found']) }),
  output: z.object({ connectionId: z.uuid() }),
  entitlement: 'integrations',
  permission: 'integrations:manage',
  handler: async ({ input, ctx, tx }) => {
    const c = await connectionTx(tx, input.connectionId, true);
    if (c.status !== 'pending') throw new DomainError('invalid_state', 'Not waiting for a connect');
    await tx
      .update(connections)
      .set({ status: 'failed', stateHash: null, stateExpiresAt: null, updatedAt: ctx.now })
      .where(eq(connections.id, c.id));
    return { connectionId: c.id };
  },
  audit: (input) => ({
    action: 'integrations.connect.fail',
    targetType: 'integration_connection',
    targetId: input.connectionId,
    data: { reason: input.reason },
  }),
});

export async function cancelActiveRunsTx(tx: TenantTx, ctx: Ctx, connectionId: string, code: string) {
  await tx
    .update(syncRuns)
    .set({ status: 'cancelled', errorCode: code, finishedAt: ctx.now, leaseUntil: null, updatedAt: ctx.now })
    .where(and(eq(syncRuns.connectionId, connectionId), inArray(syncRuns.status, [...ACTIVE_RUN_STATUSES])));
}

/** Pause (no syncs; a queued one is cancelled, a running one stops at its next page) or resume. */
export const setConnectionPausedCommand = tenantCommand({
  name: 'integrations.setConnectionPaused',
  input: z.object({ connectionId: z.uuid(), paused: z.boolean() }),
  output: ConnectionDto,
  entitlement: 'integrations',
  permission: 'integrations:manage',
  handler: async ({ input, ctx, tx }) => {
    const c = await connectionTx(tx, input.connectionId, true);
    const want = input.paused ? 'paused' : 'active';
    if (c.status === want) return toDto(c, 0);
    if (c.status !== 'active' && c.status !== 'paused')
      throw new DomainError('invalid_state', 'Only a connected integration can be paused');
    if (!input.paused) await requireConnectorEntitlementTx(tx, requireConnector(c.connector));
    const [row] = await tx
      .update(connections)
      .set(
        input.paused
          ? { status: 'paused', pausedAt: ctx.now, nextSyncAt: null, updatedAt: ctx.now }
          : { status: 'active', pausedAt: null, nextSyncAt: ctx.now, updatedAt: ctx.now },
      )
      .where(eq(connections.id, c.id))
      .returning();
    if (input.paused) await cancelActiveRunsTx(tx, ctx, c.id, 'paused');
    const counts = await openErrorCountsTx(tx, [c.id]);
    return toDto(row as ConnectionRow, counts.get(c.id) ?? 0);
  },
  audit: (input) => ({
    action: input.paused ? 'integrations.connection.pause' : 'integrations.connection.resume',
    targetType: 'integration_connection',
    targetId: input.connectionId,
  }),
});

/** How often the scheduler syncs a connection. */
export const setSyncIntervalCommand = tenantCommand({
  name: 'integrations.setSyncInterval',
  input: z.object({
    connectionId: z.uuid(),
    minutes: z.coerce
      .number()
      .int()
      .refine((m) => (SYNC_INTERVALS as readonly number[]).includes(m), 'unsupported interval'),
  }),
  output: z.object({ minutes: z.int() }),
  entitlement: 'integrations',
  permission: 'integrations:manage',
  handler: async ({ input, ctx, tx }) => {
    const c = await connectionTx(tx, input.connectionId, true);
    if (c.status === 'revoked' || c.status === 'failed')
      throw new DomainError('invalid_state', 'This connection has ended');
    const next = c.lastSyncAt ? new Date(c.lastSyncAt.getTime() + input.minutes * 60_000) : ctx.now;
    await tx
      .update(connections)
      .set({
        syncIntervalMinutes: input.minutes,
        ...(c.status === 'active' ? { nextSyncAt: next < ctx.now ? ctx.now : next } : {}),
        updatedAt: ctx.now,
      })
      .where(eq(connections.id, c.id));
    return { minutes: input.minutes };
  },
  audit: (input) => ({
    action: 'integrations.connection.interval',
    targetType: 'integration_connection',
    targetId: input.connectionId,
    data: { minutes: input.minutes },
  }),
});

/**
 * Disconnect: the connection is revoked here at once (no run starts or continues after this
 * commits), then the transport revokes it at the provider through the port. Returns what the
 * port needs (ids, never a token). History (runs, errors) stays.
 */
export const disconnectCommand = tenantCommand({
  name: 'integrations.disconnect',
  input: z.object({ connectionId: z.uuid() }),
  output: z.object({
    connectionId: z.uuid(),
    connector: z.string(),
    providerConfigKey: z.string(),
    authConnectionId: z.string().nullable(),
  }),
  entitlement: 'integrations',
  permission: 'integrations:manage',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const c = await connectionTx(tx, input.connectionId, true);
    const connector = requireConnector(c.connector);
    if (c.status === 'revoked' || c.status === 'failed')
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
      connector: c.connector,
      providerConfigKey: connector.providerConfigKey,
      authConnectionId: c.status === 'pending' ? null : c.authConnectionId,
    };
  },
  audit: (_input, r) => ({
    action: 'integrations.connection.disconnect',
    targetType: 'integration_connection',
    targetId: r.connectionId,
    data: { connector: r.connector },
  }),
});

/** Sync now: queue a run (or report the one already queued or running). */
export const requestSyncCommand = tenantCommand({
  name: 'integrations.requestSync',
  input: z.object({ connectionId: z.uuid() }),
  output: z.object({ runId: z.uuid(), already: z.boolean() }),
  entitlement: 'integrations',
  permission: 'integrations:manage',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const c = await connectionTx(tx, input.connectionId, true);
    if (c.status !== 'active') throw new DomainError('invalid_state', 'Only an active connection syncs');
    await requireConnectorEntitlementTx(tx, requireConnector(c.connector));
    const [busy] = await tx
      .select({ id: syncRuns.id })
      .from(syncRuns)
      .where(and(eq(syncRuns.connectionId, c.id), inArray(syncRuns.status, [...ACTIVE_RUN_STATUSES])));
    if (busy) return { runId: busy.id, already: true };
    const [run] = await tx
      .insert(syncRuns)
      .values({
        orgId,
        connectionId: c.id,
        trigger: 'manual',
        status: 'queued',
        requestedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      })
      .returning({ id: syncRuns.id });
    if (!run) throw new DomainError('internal');
    return { runId: run.id, already: false };
  },
  audit: (input, r) => ({
    action: 'integrations.sync.request',
    targetType: 'integration_connection',
    targetId: input.connectionId,
    data: { runId: r.runId, already: r.already },
  }),
});

/** Reset where a sync resumes (re-reads everything; links keep it from writing twice). Tests and support. */
export async function resetCursorsTx(tx: TenantTx, connectionId: string): Promise<void> {
  await tx.update(syncCursors).set({ cursor: null }).where(eq(syncCursors.connectionId, connectionId));
}
