import type { TenantTx } from '@yayatoh/db';
import {
  actorId,
  type CommandPorts,
  createCtx,
  DomainError,
  executeCommand,
  requireOrg,
} from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { BALANCE_TRANSACTION_KINDS, type BalanceTransaction, type PaymentProvider } from './port.ts';
import {
  RECONCILIATION_ITEM_KINDS,
  RECONCILIATION_ITEM_STATUSES,
  reconciliationItems,
  reconciliationRuns,
} from './schema.ts';

/** One amount on one side, under the reference both sides share. */
export interface ReconEntry {
  readonly reference: string;
  readonly currency: string;
  readonly amountMinor: number;
  readonly occurredAt: Date;
}

export interface ReconDifference {
  readonly kind: (typeof RECONCILIATION_ITEM_KINDS)[number];
  readonly reference: string;
  readonly currency: string;
  readonly ledgerMinor: number;
  readonly providerMinor: number;
}

const DAY_MS = 86_400_000;
/** `YYYY-MM-DD` → the UTC day's bounds. */
export function dayBounds(day: string): { start: Date; end: Date } {
  const start = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== day)
    throw new DomainError('validation_failed', 'Not a day', { field: 'day' });
  return { start, end: new Date(start.getTime() + DAY_MS) };
}
/**
 * Money that moves around midnight (a webhook after 00:00, a transfer booked the next morning) is
 * still matched: each side is read from the day before to the day after, and only references
 * with something *on* the day are compared.
 */
export const reconWindow = (day: string) => {
  const { start, end } = dayBounds(day);
  return { from: new Date(start.getTime() - DAY_MS), to: new Date(end.getTime() + DAY_MS) };
};

/**
 * Compare the ledger with the provider for one day (pure). For every reference (and currency)
 * with an entry on the day on either side, the totals over the whole window must agree.
 */
export function reconcileEntries(
  day: string,
  ledger: readonly ReconEntry[],
  provider: readonly ReconEntry[],
): ReconDifference[] {
  const { start, end } = dayBounds(day);
  const k = (e: ReconEntry) => `${e.reference}\u0000${e.currency}`;
  const onDay = new Set(
    [...ledger, ...provider].filter((e) => e.occurredAt >= start && e.occurredAt < end).map(k),
  );
  const sum = (entries: readonly ReconEntry[]) => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(k(e), (m.get(k(e)) ?? 0) + e.amountMinor);
    return m;
  };
  const l = sum(ledger);
  const p = sum(provider);
  const out: ReconDifference[] = [];
  for (const key of [...onDay].sort()) {
    const [reference = '', currency = ''] = key.split('\u0000');
    const ledgerMinor = l.get(key) ?? 0;
    const providerMinor = p.get(key) ?? 0;
    if (ledgerMinor === providerMinor) continue;
    const kind = !p.has(key) ? 'missing_at_provider' : !l.has(key) ? 'missing_in_ledger' : 'amount_mismatch';
    out.push({ kind, reference, currency, ledgerMinor, providerMinor });
  }
  return out;
}

const ProviderTxn = z.object({
  id: z.string().min(1).max(255),
  kind: z.enum(BALANCE_TRANSACTION_KINDS),
  amountMinor: z.int(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  occurredAt: z.coerce.date(),
  reference: z.string().max(300).nullable(),
});

export const ReconciliationRunDto = z.object({
  runId: z.uuid(),
  day: z.string(),
  created: z.boolean(),
  ledgerCount: z.int(),
  providerCount: z.int(),
  itemCount: z.int(),
});

/**
 * Record one org's reconciliation for a UTC day (worker, platform actor). The caller lists the
 * provider's balance transactions for `reconWindow(day)` and passes this org's; the ledger's
 * platform-cash movements are read here under the org's RLS. Differences become items for finance.
 * Idempotent per org and day: a second run returns the first one.
 */
export const recordReconciliationCommand = tenantCommand({
  name: 'payments.recordReconciliation',
  input: z.object({
    day: z.iso.date(),
    provider: z.enum(['fake', 'stripe']),
    transactions: z.array(ProviderTxn).max(10_000),
  }),
  output: ReconciliationRunDto,
  entitlement: null,
  permission: 'platform:payments.reconcile',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`payments.reconcile:${orgId}:${input.day}`}))`,
    );
    const [existing] = await tx
      .select()
      .from(reconciliationRuns)
      .where(eq(reconciliationRuns.day, input.day));
    if (existing)
      return {
        runId: existing.id,
        day: existing.day,
        created: false,
        ledgerCount: existing.ledgerCount,
        providerCount: existing.providerCount,
        itemCount: existing.itemCount,
      };
    const { from, to } = reconWindow(input.day);
    // The ledger's platform cash, under the reference the provider tags on the same money.
    const rows = await tx.execute<{
      reference: string;
      currency: string;
      amount: string;
      occurred_at: Date;
    }>(sql`
      select case j.kind
          when 'sale' then 'order:' || j.ref_id
          when 'refund' then 'refund:' || (j.memo->>'refundId')
          when 'transfer' then 'settlement:' || j.ref_id
          when 'transfer_reversal' then 'reversal:' || (j.memo->>'refundId')
          when 'agency_commission_reversal_paid' then 'commission_reversal:' || (j.memo->>'refundId')
          when 'dispute' then 'dispute:' || (j.memo->>'providerDisputeId')
          when 'dispute_won' then 'dispute:' || coalesce(
            (select d.provider_dispute_id from payments.disputes d where d.id = (j.memo->>'disputeId')::uuid),
            j.memo->>'disputeId')
          else 'journal:' || j.idempotency_key end as reference,
        p.currency, sum(p.amount_minor)::text as amount, j.occurred_at
      from payments.postings p join payments.journal_entries j on j.id = p.journal_id
      where p.account = 'platform:stripe_cash' and j.occurred_at >= ${from.toISOString()}::timestamptz
        and j.occurred_at < ${to.toISOString()}::timestamptz
      group by 1, p.currency, j.occurred_at`);
    const ledger: ReconEntry[] = rows.map((r) => ({
      reference: r.reference,
      currency: r.currency,
      amountMinor: Number(r.amount),
      occurredAt: new Date(r.occurred_at),
    }));
    const provider: ReconEntry[] = input.transactions
      .filter((t) => t.kind !== 'other' && t.occurredAt >= from && t.occurredAt < to)
      .map((t) => ({
        reference: t.reference ?? `provider:${t.id}`,
        currency: t.currency,
        amountMinor: t.amountMinor,
        occurredAt: t.occurredAt,
      }));
    const diffs = reconcileEntries(input.day, ledger, provider);
    const [run] = await tx
      .insert(reconciliationRuns)
      .values({
        orgId,
        day: input.day,
        provider: input.provider,
        ledgerCount: ledger.length,
        providerCount: provider.length,
        itemCount: diffs.length,
      })
      .returning({ id: reconciliationRuns.id });
    if (!run) throw new DomainError('internal');
    if (diffs.length) {
      await tx
        .insert(reconciliationItems)
        .values(diffs.map((d) => ({ orgId, runId: run.id, day: input.day, ...d })));
      // Drift raises an alert (roadmap §5.3): finance and staff are told through the outbox.
      emit({
        type: 'payments.reconciliation_drift',
        version: 1,
        aggregateType: 'reconciliation_run',
        aggregateId: run.id,
        payload: { orgId, runId: run.id, day: input.day, items: diffs.length },
      });
    }
    return {
      runId: run.id,
      day: input.day,
      created: true,
      ledgerCount: ledger.length,
      providerCount: provider.length,
      itemCount: diffs.length,
    };
  },
  audit: (input, r) => ({
    action: 'payments.reconcile',
    targetType: 'reconciliation_run',
    targetId: r?.runId ?? null,
    data: { day: input.day, created: r?.created, items: r?.itemCount },
  }),
});

export const ReconciliationItemDto = z.object({
  id: z.uuid(),
  day: z.string(),
  kind: z.enum(RECONCILIATION_ITEM_KINDS),
  reference: z.string(),
  currency: z.string(),
  ledgerMinor: z.int(),
  providerMinor: z.int(),
  /** provider − ledger */
  differenceMinor: z.int(),
  status: z.enum(RECONCILIATION_ITEM_STATUSES),
  resolutionNote: z.string().nullable(),
  resolvedAt: z.date().nullable(),
});
export type ReconciliationItemDto = z.infer<typeof ReconciliationItemDto>;

/** Reconciliation differences, open first (finance and staff). */
export const reconciliationItemsQuery = tenantQuery({
  name: 'payments.reconciliationItems',
  input: z.object({
    status: z.enum(RECONCILIATION_ITEM_STATUSES).optional(),
    limit: z.int().min(1).max(500).default(100),
  }),
  output: z.array(ReconciliationItemDto),
  entitlement: null,
  permission: 'finance:read',
  handler: async ({ input, tx }) =>
    (
      await tx
        .select()
        .from(reconciliationItems)
        .where(input.status ? eq(reconciliationItems.status, input.status) : undefined)
        .orderBy(
          sql`case when ${reconciliationItems.status} = 'open' then 0 else 1 end`,
          desc(reconciliationItems.day),
          reconciliationItems.reference,
        )
        .limit(input.limit)
    ).map((r) => ({
      id: r.id,
      day: r.day,
      kind: r.kind as ReconciliationItemDto['kind'],
      reference: r.reference,
      currency: r.currency,
      ledgerMinor: r.ledgerMinor,
      providerMinor: r.providerMinor,
      differenceMinor: r.providerMinor - r.ledgerMinor,
      status: r.status as ReconciliationItemDto['status'],
      resolutionNote: r.resolutionNote,
      resolvedAt: r.resolvedAt,
    })),
});

/** The latest runs (finance and staff): when the books were last checked. */
export const reconciliationRunsQuery = tenantQuery({
  name: 'payments.reconciliationRuns',
  input: z.object({ limit: z.int().min(1).max(60).default(7) }),
  output: z.array(ReconciliationRunDto.omit({ created: true })),
  entitlement: null,
  permission: 'finance:read',
  handler: async ({ input, tx }) =>
    (await tx.select().from(reconciliationRuns).orderBy(desc(reconciliationRuns.day)).limit(input.limit)).map(
      (r) => ({
        runId: r.id,
        day: r.day,
        ledgerCount: r.ledgerCount,
        providerCount: r.providerCount,
        itemCount: r.itemCount,
      }),
    ),
});

/** Close a difference with a note saying why (finance or staff; audited with the note). */
export const resolveReconciliationItemCommand = tenantCommand({
  name: 'payments.resolveReconciliationItem',
  input: z.object({ itemId: z.uuid(), note: z.string().trim().min(3).max(500) }),
  output: ReconciliationItemDto.pick({ id: true, status: true }),
  entitlement: null,
  permission: 'finance:reconcile',
  handler: async ({ input, ctx, tx }) => {
    const [item] = await tx
      .select()
      .from(reconciliationItems)
      .where(eq(reconciliationItems.id, input.itemId))
      .for('update');
    if (!item) throw new DomainError('not_found', 'Reconciliation item not found');
    if (item.status === 'resolved')
      throw new DomainError('invalid_state', 'Already resolved', { reason: 'already_resolved' });
    await tx
      .update(reconciliationItems)
      .set({
        status: 'resolved',
        resolutionNote: input.note,
        resolvedBy: actorId(ctx.actor),
        resolvedAt: ctx.now,
        updatedAt: ctx.now,
      })
      .where(and(eq(reconciliationItems.id, item.id), eq(reconciliationItems.status, 'open')));
    return { id: item.id, status: 'resolved' as const };
  },
  audit: (input) => ({
    action: 'payments.reconciliation_resolve',
    targetType: 'reconciliation_item',
    targetId: input.itemId,
    data: { note: input.note },
  }),
});

/**
 * Reconcile one org's day with the provider (the worker job, and dev tools for one org). Pass
 * `transactions` when the caller already listed the window for every org. Returns null when the
 * provider cannot list balance transactions (the fake provider without a store).
 */
export async function reconcileOrgDay(
  provider: PaymentProvider,
  orgId: string,
  day: string,
  ports: CommandPorts<TenantTx>,
  opts: { transactions?: readonly BalanceTransaction[]; now?: Date } = {},
): Promise<z.infer<typeof ReconciliationRunDto> | null> {
  const listed = opts.transactions ?? (await provider.listBalanceTransactions(reconWindow(day)));
  if (!listed) return null;
  return executeCommand(
    recordReconciliationCommand,
    {
      day,
      provider: provider.name,
      transactions: listed
        .filter((t) => t.orgId === orgId)
        .map((t) => ({
          id: t.id,
          kind: t.kind,
          amountMinor: t.amountMinor,
          currency: t.currency,
          occurredAt: t.occurredAt,
          reference: t.reference,
        })),
    },
    createCtx({
      orgId,
      actor: { type: 'system', name: 'payments.reconciliation' },
      ...(opts.now ? { now: opts.now } : {}),
    }),
    ports,
  );
}
