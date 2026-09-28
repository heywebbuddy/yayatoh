import type { TenantTx } from '@yayatoh/db';
import {
  type CommandPorts,
  type Ctx,
  createCtx,
  DomainError,
  type DomainEvent,
  executeCommand,
  requireOrg,
} from '@yayatoh/kernel';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { tenantCommand, tenantQuery } from './commands/define.ts';
import type { ModuleKey } from './modules.ts';
import {
  BULK_STATUSES,
  type BulkStatus,
  bulkOperationItems,
  bulkOperations,
  fileParts,
  files,
} from './schema.ts';

/** The most items one operation may cover (the selection is snapshotted into the row). */
export const MAX_BULK_ITEMS = 50_000;
const FILE_TTL_MS = 7 * 24 * 3_600_000;

export interface BulkItemResult {
  readonly id: string;
  readonly ok: boolean;
  /** A stable error code for a failed item (shown to the organizer, never raw SQL). */
  readonly code?: string;
  /** What undo needs to restore this item (undoable actions only). */
  readonly undo?: unknown;
  /**
   * A stable code for an item that succeeded with a caveat the organizer should see (a guest
   * placed in an accessible seat that is kept back, M1.8f).
   */
  readonly warning?: string;
}

export interface BulkSelection {
  readonly eventId: string | null;
  readonly ids?: readonly string[];
  readonly filter?: unknown;
}

/**
 * A bulk action a module offers (ids or filter → chunks). Registered in each app's composition
 * root; the generic runner looks actions up by `key`.
 */
export interface BulkAction<P = unknown, F = unknown> {
  /** `module.actionName` (camelCase), owned by the module: `attendees.label`. */
  readonly key: string;
  readonly entitlement: ModuleKey;
  readonly permission: string;
  readonly params: z.ZodType<P>;
  /** The filter shape for "everything matching" selections. */
  readonly filter: z.ZodType<F>;
  readonly chunkSize: number;
  /** Undoable actions keep per-item undo data this long after they finish. */
  readonly undoWindowMs?: number;
  /** Exports: the file each operation writes (appended per chunk). */
  readonly file?: { readonly contentType: string; name(params: P, now: Date): string };
  /**
   * Starting it needs a recent step-up (roadmap §10: bulk export). Defaults to true for exports
   * (actions with a `file`): data leaving the platform in bulk.
   */
  readonly stepUp?: boolean;
  /**
   * Destructive actions that must never run while platform staff impersonate a member (M1.2e
   * blocks money, export and delete). Declared here so the impersonation guard can refuse them.
   */
  readonly blockedWhileImpersonating?: boolean;
  /** What of the params the `bulk.start` audit row records (never message bodies or tokens). */
  auditParams?(params: P): Record<string, unknown>;
  /** Resolve a selection to the ids this action may touch (validates scope; caller caps size). */
  resolve(
    tx: TenantTx,
    sel: { eventId: string | null; ids?: readonly string[]; filter?: F },
  ): Promise<string[]>;
  /** Process one chunk. `append` is written to the operation's file (exports). */
  run(
    tx: TenantTx,
    ctx: Ctx,
    ids: readonly string[],
    params: P,
    meta: {
      first: boolean;
      eventId: string | null;
      operationId: string;
      /** Outbox events for side effects (email, webhooks), committed with the chunk. */
      emit: (event: DomainEvent) => void;
    },
  ): Promise<{ results: readonly BulkItemResult[]; append?: string }>;
  undo?(tx: TenantTx, ctx: Ctx, items: readonly { id: string; undo: unknown }[], params: P): Promise<void>;
}

/** Any registered action: params differ per action, and the runner re-parses them with its schema. */
// biome-ignore lint/suspicious/noExplicitAny: a heterogeneous registry; each action validates its own params.
export type AnyBulkAction = BulkAction<any, any>;

export function defineBulkAction<P, F>(a: BulkAction<P, F>): BulkAction<P, F> {
  if (!/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/.test(a.key)) throw new Error(`Bulk action key: ${a.key}`);
  if (a.chunkSize < 1 || a.chunkSize > 5_000) throw new Error(`Bulk chunk size: ${a.chunkSize}`);
  return a;
}

export const BulkOperationDto = z.object({
  id: z.uuid(),
  action: z.string(),
  eventId: z.uuid().nullable(),
  status: z.enum(BULK_STATUSES),
  total: z.int(),
  processed: z.int(),
  succeeded: z.int(),
  failed: z.int(),
  undone: z.int(),
  createdAt: z.date(),
  finishedAt: z.date().nullable(),
  /** Set while undo is still possible. */
  undoUntil: z.date().nullable(),
  hasFile: z.boolean(),
  /** First failures, for the organizer to act on. */
  failures: z.array(z.object({ itemId: z.uuid(), code: z.string() })),
  /** First items that succeeded with a caveat (`BulkItemResult.warning`). */
  warnings: z.array(z.object({ itemId: z.uuid(), code: z.string() })),
});
export type BulkOperationDto = z.infer<typeof BulkOperationDto>;

type OpRow = typeof bulkOperations.$inferSelect;

const baseDto = (op: OpRow, now: Date): Omit<BulkOperationDto, 'failures' | 'warnings'> => ({
  id: op.id,
  action: op.action,
  eventId: op.eventId,
  status: op.status as BulkStatus,
  total: op.total,
  processed: op.processed,
  succeeded: op.succeeded,
  failed: op.failed,
  undone: op.undone,
  createdAt: op.createdAt,
  finishedAt: op.finishedAt,
  undoUntil: op.status === 'done' && op.undoUntil && op.undoUntil > now ? op.undoUntil : null,
  hasFile: op.fileId !== null,
});

async function toDto(tx: TenantTx, op: OpRow, now: Date): Promise<BulkOperationDto> {
  const failures = op.failed
    ? await tx
        .select({ itemId: bulkOperationItems.itemId, code: bulkOperationItems.errorCode })
        .from(bulkOperationItems)
        .where(and(eq(bulkOperationItems.operationId, op.id), eq(bulkOperationItems.ok, false)))
        .orderBy(asc(bulkOperationItems.id))
        .limit(50)
    : [];
  // Warnings are stored as the code of an item that succeeded.
  const warnings = await tx
    .select({ itemId: bulkOperationItems.itemId, code: bulkOperationItems.errorCode })
    .from(bulkOperationItems)
    .where(
      and(
        eq(bulkOperationItems.operationId, op.id),
        eq(bulkOperationItems.ok, true),
        isNotNull(bulkOperationItems.errorCode),
      ),
    )
    .orderBy(asc(bulkOperationItems.id))
    .limit(50);
  return {
    ...baseDto(op, now),
    failures: failures.map((f) => ({ itemId: f.itemId, code: f.code ?? 'failed' })),
    warnings: warnings.map((w) => ({ itemId: w.itemId, code: w.code ?? 'warning' })),
  };
}

const Selection = <F>(filter: z.ZodType<F>) =>
  z.union([z.object({ ids: z.array(z.uuid()).min(1).max(MAX_BULK_ITEMS) }), z.object({ filter })]);

/**
 * The organizer-facing commands and queries for one action: start (resolve + snapshot), undo,
 * status and file. Each carries the action's own permission and entitlement.
 */
export function bulkCommands<P, F>(action: BulkAction<P, F>) {
  // `attendees.label` → attendees.startLabel, attendees.undoLabel, attendees.labelStatus, …
  const [mod, name = ''] = action.key.split('.');
  const Name = `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  const load = async (tx: TenantTx, operationId: string) => {
    const [op] = await tx
      .select()
      .from(bulkOperations)
      .where(and(eq(bulkOperations.id, operationId), eq(bulkOperations.action, action.key)));
    if (!op) throw new DomainError('not_found', 'Operation not found');
    return op;
  };

  const start = tenantCommand({
    name: `${mod}.start${Name}`,
    input: z.object({
      eventId: z.uuid().nullable().default(null),
      selection: Selection(action.filter),
      params: action.params,
    }),
    output: z.object({ operationId: z.uuid(), total: z.int() }),
    entitlement: action.entitlement,
    permission: action.permission,
    stepUp: action.stepUp ?? action.file !== undefined,
    handler: async ({ input, ctx, tx, emit }) => {
      const sel = input.selection as { ids?: string[]; filter?: F };
      const ids = [...new Set(await action.resolve(tx, { eventId: input.eventId, ...sel }))];
      if (sel.ids && ids.length !== new Set(sel.ids).size)
        throw new DomainError('not_found', 'Some selected items were not found');
      if (ids.length === 0) throw new DomainError('validation_failed', 'Nothing selected');
      if (ids.length > MAX_BULK_ITEMS)
        throw new DomainError('validation_failed', `At most ${MAX_BULK_ITEMS} items per operation`);
      const orgId = requireOrg(ctx);
      let fileId: string | null = null;
      if (action.file) {
        const [f] = await tx
          .insert(files)
          .values({
            orgId,
            name: action.file.name(input.params as P, ctx.now),
            contentType: action.file.contentType,
            expiresAt: new Date(ctx.now.getTime() + FILE_TTL_MS),
          })
          .returning({ id: files.id });
        fileId = f?.id ?? null;
      }
      const [op] = await tx
        .insert(bulkOperations)
        .values({
          orgId,
          action: action.key,
          eventId: input.eventId,
          params: input.params as Record<string, unknown>,
          itemIds: ids,
          total: ids.length,
          requestedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
          fileId,
        })
        .returning({ id: bulkOperations.id });
      if (!op) throw new DomainError('internal');
      emit({
        type: 'bulk.requested',
        version: 1,
        aggregateType: 'bulk_operation',
        aggregateId: op.id,
        payload: { orgId, operationId: op.id, action: action.key, total: ids.length },
      });
      return { operationId: op.id, total: ids.length };
    },
    audit: (input, r) => ({
      action: 'bulk.start',
      targetType: 'bulk_operation',
      targetId: r?.operationId ?? null,
      data: {
        action: action.key,
        eventId: input.eventId,
        total: r?.total ?? 0,
        ...(action.auditParams?.(input.params as P) ?? {}),
      },
    }),
  });

  const undo = tenantCommand({
    name: `${mod}.undo${Name}`,
    input: z.object({ operationId: z.uuid() }),
    output: z.object({ ok: z.boolean() }),
    entitlement: action.entitlement,
    permission: action.permission,
    handler: async ({ input, ctx, tx }) => {
      if (!action.undo) throw new DomainError('invalid_state', 'This action cannot be undone');
      const op = await load(tx, input.operationId);
      if (op.status !== 'done' || !op.undoUntil || op.undoUntil <= ctx.now)
        throw new DomainError('invalid_state', 'The undo window has closed');
      await tx
        .update(bulkOperations)
        .set({ status: 'undoing', updatedAt: ctx.now })
        .where(eq(bulkOperations.id, op.id));
      return { ok: true };
    },
    audit: (input) => ({
      action: 'bulk.undo',
      targetType: 'bulk_operation',
      targetId: input.operationId,
      data: { action: action.key },
    }),
  });

  const status = tenantQuery({
    name: `${mod}.${name}Status`,
    input: z.object({ operationId: z.uuid() }),
    output: BulkOperationDto,
    entitlement: action.entitlement,
    permission: action.permission,
    handler: async ({ input, ctx, tx }) => toDto(tx, await load(tx, input.operationId), ctx.now),
  });

  const file = tenantQuery({
    name: `${mod}.${name}File`,
    input: z.object({ operationId: z.uuid() }),
    output: z.object({ name: z.string(), contentType: z.string(), content: z.string() }),
    entitlement: action.entitlement,
    permission: action.permission,
    handler: async ({ input, ctx, tx }) => {
      const op = await load(tx, input.operationId);
      if (!op.fileId) throw new DomainError('not_found', 'No file');
      const [f] = await tx.select().from(files).where(eq(files.id, op.fileId));
      if (!f || f.expiresAt <= ctx.now) throw new DomainError('not_found', 'File expired');
      if (!f.complete) throw new DomainError('invalid_state', 'Still being prepared');
      const parts = await tx
        .select({ data: fileParts.data })
        .from(fileParts)
        .where(eq(fileParts.fileId, f.id))
        .orderBy(asc(fileParts.seq));
      return { name: f.name, contentType: f.contentType, content: parts.map((p) => p.data).join('') };
    },
  });

  return { action, start, undo, status, file };
}

type EmitFn = (event: DomainEvent) => void;

/**
 * One step of one operation (a chunk forward, or a chunk of undo), in one tenant transaction.
 * The row lock (SKIP LOCKED) keeps two runners from working the same operation at once.
 */
export function bulkStepCommand(actions: readonly AnyBulkAction[]) {
  const byKey = new Map<string, BulkAction>(actions.map((a) => [a.key, a]));
  return tenantCommand({
    name: 'platform.bulkStep',
    input: z.object({ operationId: z.uuid() }),
    output: z.object({
      status: z.enum(BULK_STATUSES),
      processed: z.int(),
      total: z.int(),
      busy: z.boolean(),
    }),
    entitlement: 'core',
    permission: 'platform:bulk.run',
    handler: async ({ input, ctx, tx, emit }) => {
      const [op] = await tx
        .select()
        .from(bulkOperations)
        .where(eq(bulkOperations.id, input.operationId))
        .for('update', { skipLocked: true });
      if (!op) {
        const [seen] = await tx
          .select({ id: bulkOperations.id })
          .from(bulkOperations)
          .where(eq(bulkOperations.id, input.operationId));
        if (!seen) throw new DomainError('not_found', 'Operation not found');
        return { status: 'running' as const, processed: 0, total: 0, busy: true };
      }
      const action = byKey.get(op.action);
      const done = (status: BulkStatus) => ({
        status,
        processed: op.processed,
        total: op.total,
        busy: false,
      });
      if (!action) throw new DomainError('internal', `Unknown bulk action ${op.action}`);
      if (op.status === 'undoing') return undoStep(tx, ctx, op, action, emit);
      if (op.status !== 'queued' && op.status !== 'running') return done(op.status as BulkStatus);

      const ids = op.itemIds.slice(op.processed, op.processed + action.chunkSize);
      const params = action.params.parse(op.params);
      const { results, append } = await action.run(tx, ctx, ids, params, {
        first: op.processed === 0,
        eventId: op.eventId,
        operationId: op.id,
        emit,
      });
      const keep = results.filter(
        (r) => !r.ok || r.warning !== undefined || (action.undo && r.undo !== undefined),
      );
      if (keep.length)
        await tx.insert(bulkOperationItems).values(
          keep.map((r) => ({
            orgId: op.orgId,
            operationId: op.id,
            itemId: r.id,
            ok: r.ok,
            errorCode: r.ok ? (r.warning ?? null) : (r.code ?? 'failed'),
            undo: r.ok ? (r.undo ?? null) : null,
          })),
        );
      if (append && op.fileId) {
        await tx.insert(fileParts).values({
          orgId: op.orgId,
          fileId: op.fileId,
          seq: op.processed,
          data: append,
        });
        await tx
          .update(files)
          .set({ bytes: sql`${files.bytes} + ${Buffer.byteLength(append)}`, updatedAt: ctx.now })
          .where(eq(files.id, op.fileId));
      }
      const processed = op.processed + ids.length;
      const ok = results.filter((r) => r.ok).length;
      const finished = processed >= op.total;
      await tx
        .update(bulkOperations)
        .set({
          status: finished ? 'done' : 'running',
          processed,
          succeeded: op.succeeded + ok,
          failed: op.failed + (ids.length - ok),
          finishedAt: finished ? ctx.now : null,
          undoUntil:
            finished && action.undo && action.undoWindowMs
              ? new Date(ctx.now.getTime() + action.undoWindowMs)
              : null,
          updatedAt: ctx.now,
        })
        .where(eq(bulkOperations.id, op.id));
      if (finished) {
        if (op.fileId)
          await tx.update(files).set({ complete: true, updatedAt: ctx.now }).where(eq(files.id, op.fileId));
        emit({
          type: 'bulk.completed',
          version: 1,
          aggregateType: 'bulk_operation',
          aggregateId: op.id,
          payload: {
            orgId: op.orgId,
            operationId: op.id,
            action: op.action,
            succeeded: op.succeeded + ok,
            failed: op.failed + (ids.length - ok),
          },
        });
      }
      return {
        status: finished ? ('done' as const) : ('running' as const),
        processed,
        total: op.total,
        busy: false,
      };
    },
  });
}

async function undoStep(tx: TenantTx, ctx: Ctx, op: OpRow, action: BulkAction, emit: EmitFn) {
  const items = await tx
    .select({ id: bulkOperationItems.id, itemId: bulkOperationItems.itemId, undo: bulkOperationItems.undo })
    .from(bulkOperationItems)
    .where(
      and(
        eq(bulkOperationItems.operationId, op.id),
        eq(bulkOperationItems.ok, true),
        isNotNull(bulkOperationItems.undo),
        isNull(bulkOperationItems.undoneAt),
      ),
    )
    .orderBy(asc(bulkOperationItems.id))
    .limit(action.chunkSize);
  if (items.length && action.undo) {
    await action.undo(
      tx,
      ctx,
      items.map((i) => ({ id: i.itemId, undo: i.undo })),
      action.params.parse(op.params),
    );
    await tx
      .update(bulkOperationItems)
      .set({ undoneAt: ctx.now, updatedAt: ctx.now })
      .where(
        sql`${bulkOperationItems.id} in (${sql.join(
          items.map((i) => sql`${i.id}`),
          sql`, `,
        )})`,
      );
  }
  const finished = items.length < action.chunkSize;
  const undone = op.undone + items.length;
  await tx
    .update(bulkOperations)
    .set({ status: finished ? 'undone' : 'undoing', undone, undoUntil: null, updatedAt: ctx.now })
    .where(eq(bulkOperations.id, op.id));
  if (finished)
    emit({
      type: 'bulk.undone',
      version: 1,
      aggregateType: 'bulk_operation',
      aggregateId: op.id,
      payload: { orgId: op.orgId, operationId: op.id, action: op.action, undone },
    });
  return {
    status: finished ? ('undone' as const) : ('undoing' as const),
    processed: op.processed,
    total: op.total,
    busy: false,
  };
}

/**
 * Drive an operation until it settles or the time budget runs out (the worker picks up the
 * rest). Runs as a system actor of the operation's org; a crash in a chunk marks the operation
 * failed rather than retrying it forever.
 */
export async function runBulkOperation(
  step: ReturnType<typeof bulkStepCommand>,
  ports: CommandPorts<TenantTx>,
  orgId: string,
  operationId: string,
  budgetMs = 5_000,
): Promise<BulkStatus> {
  const deadline = Date.now() + budgetMs;
  const ctx = () => createCtx({ orgId, actor: { type: 'system', name: 'platform.bulk-runner' } });
  for (;;) {
    let r: { status: BulkStatus; busy: boolean };
    try {
      r = await executeCommand(step, { operationId }, ctx(), ports);
    } catch (err) {
      await executeCommand(markBulkFailedCommand, { operationId, code: codeOf(err) }, ctx(), ports);
      return 'failed';
    }
    if (r.busy) return 'running';
    if (!['queued', 'running', 'undoing'].includes(r.status) || Date.now() >= deadline) return r.status;
  }
}

const codeOf = (err: unknown) => (err instanceof DomainError ? err.code : 'internal');

export const markBulkFailedCommand = tenantCommand({
  name: 'platform.bulkFailed',
  input: z.object({ operationId: z.uuid(), code: z.string().max(60) }),
  output: z.object({ ok: z.boolean() }),
  entitlement: 'core',
  permission: 'platform:bulk.run',
  handler: async ({ input, ctx, tx }) => {
    await tx
      .update(bulkOperations)
      .set({ status: 'failed', lastError: input.code, finishedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(bulkOperations.id, input.operationId));
    return { ok: true };
  },
});

/** The params an operation was started with (for subscribers acting on its events). */
export async function bulkOperationParamsTx(tx: TenantTx, operationId: string): Promise<unknown> {
  const [op] = await tx
    .select({ params: bulkOperations.params })
    .from(bulkOperations)
    .where(eq(bulkOperations.id, operationId));
  return op?.params ?? null;
}

/** Who started an operation (runners act as a system actor). */
export async function bulkOperationRequesterTx(tx: TenantTx, operationId: string): Promise<string | null> {
  const [op] = await tx
    .select({ by: bulkOperations.requestedBy })
    .from(bulkOperations)
    .where(eq(bulkOperations.id, operationId));
  return op?.by ?? null;
}

/** Recent operations for one event (the console's "recent bulk actions"); no file content. */
export const listBulkOperationsQuery = tenantQuery({
  name: 'platform.listBulkOperations',
  input: z.object({ eventId: z.uuid(), limit: z.int().min(1).max(50).default(10) }),
  output: z.array(BulkOperationDto.omit({ failures: true, warnings: true })),
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => {
    const rows = await tx
      .select()
      .from(bulkOperations)
      .where(eq(bulkOperations.eventId, input.eventId))
      .orderBy(sql`${bulkOperations.createdAt} desc`)
      .limit(input.limit);
    return rows.map((r) => baseDto(r, ctx.now));
  },
});
