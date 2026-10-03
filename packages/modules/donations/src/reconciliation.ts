import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import {
  actorId,
  type CommandPorts,
  type Ctx,
  DomainError,
  executeCommand,
  executeQuery,
  requireOrg,
  uuidv7,
} from '@yayatoh/kernel';
import {
  CONNECTED_TRANSACTION_KINDS,
  fundsFlowTx,
  memoEntriesTx,
  PAYOUT_STATUSES,
  type PaymentProvider,
} from '@yayatoh/payments';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  eventMovements,
  nextItemStatus,
  payoutShares,
  RECON_PROVIDERS,
  type ReconItemStatus,
  reconcileDonations,
  reconTotals,
} from './domain/reconcile.ts';
import {
  DonationReconciliationDto,
  type ReconItemDto,
  type ReconPayoutDto,
  ReconTotals,
} from './report-dto.ts';
import { gifts } from './schema.ts';
import { giftRefunds } from './schema-matches.ts';
import { reconItems, reconPayouts, reconRuns } from './schema-reconciliation.ts';

const DAY_MS = 86_400_000;
/** One run never compares more than this many movements (a gala has far fewer). */
export const RECON_MOVEMENTS_MAX = 10_000;

async function eventOrThrowTx(tx: TenantTx, eventId: string) {
  const event = await findEventTx(tx, eventId);
  if (!event) throw new DomainError('not_found', 'Event not found');
  return event;
}

/** The references the provider uses for the event's gift money: charges and refunds. */
async function eventReferencesTx(tx: TenantTx, eventId: string): Promise<Set<string>> {
  const [orders, refunds] = await Promise.all([
    tx.select({ orderId: gifts.orderId }).from(gifts).where(eq(gifts.eventId, eventId)),
    tx
      .select({ refundId: giftRefunds.refundId })
      .from(giftRefunds)
      .innerJoin(gifts, eq(gifts.id, giftRefunds.giftId))
      .where(eq(gifts.eventId, eventId)),
  ]);
  return new Set([...orders.map((o) => `order:${o.orderId}`), ...refunds.map((r) => `refund:${r.refundId}`)]);
}

/**
 * What to ask the provider for (M4.8g): the connected accounts the event's gifts were charged on
 * (and the org's current one), and the window from a day before its first gift to a day ahead.
 */
export const donationReconTargetQuery = tenantQuery({
  name: 'donations.reconTarget',
  input: z.object({ eventId: z.uuid() }),
  output: z.object({ accountIds: z.array(z.string()), from: z.date(), to: z.date() }),
  entitlement: 'donations',
  permission: 'finance:reconcile',
  handler: async ({ input, ctx, tx }) => {
    await eventOrThrowTx(tx, input.eventId);
    const [memos, flow, [first]] = await Promise.all([
      memoEntriesTx(tx, input.eventId),
      fundsFlowTx(tx),
      tx
        .select({ at: sql<Date>`min(${gifts.createdAt})` })
        .from(gifts)
        .where(eq(gifts.eventId, input.eventId)),
    ]);
    const accounts = new Set(memos.flatMap((m) => (m.connectedAccountId ? [m.connectedAccountId] : [])));
    if (flow.fundsFlow === 'organizer_mor' && flow.accountId) accounts.add(flow.accountId);
    const start = first?.at ? new Date(first.at) : ctx.now;
    return {
      accountIds: [...accounts].sort(),
      from: new Date(start.getTime() - DAY_MS),
      to: new Date(ctx.now.getTime() + DAY_MS),
    };
  },
});

const Movement = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(CONNECTED_TRANSACTION_KINDS),
  amountMinor: z.int(),
  feeMinor: z.int(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  occurredAt: z.coerce.date(),
  reference: z.string().max(200).nullable(),
  payoutId: z.string().max(200).nullable(),
});

const PayoutInput = z.object({
  id: z.string().min(1).max(200),
  amountMinor: z.int(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  status: z.enum(PAYOUT_STATUSES),
  createdAt: z.coerce.date(),
  arrivalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const RecordDonationReconciliationInput = z.object({
  eventId: z.uuid(),
  provider: z.enum(RECON_PROVIDERS),
  movements: z.array(Movement).max(RECON_MOVEMENTS_MAX),
  payouts: z.array(PayoutInput).max(RECON_MOVEMENTS_MAX),
});

export const DonationReconRunDto = z.object({
  runId: z.uuid(),
  ledgerCount: z.int(),
  providerCount: z.int(),
  itemCount: z.int(),
  opened: z.int(),
  cleared: z.int(),
});
export type DonationReconRunDto = z.infer<typeof DonationReconRunDto>;

/**
 * Record one reconciliation of the event's donations (M4.8g, like M1.6e for the platform): the
 * memo entries against the connected account's movements for the event's gift orders and their
 * refunds. Differences are kept per reference (opened, updated, or cleared when both sides agree
 * again; a resolved one stays resolved while its amounts don't change), with the payouts that
 * carried the event's gifts. Finance roles (`finance:reconcile`); the provider's data is fetched
 * by `reconcileEventDonations`, never sent by a browser.
 */
export const recordDonationReconciliationCommand = tenantCommand({
  name: 'donations.reconcile',
  input: RecordDonationReconciliationInput,
  output: DonationReconRunDto,
  entitlement: 'donations',
  permission: 'finance:reconcile',
  handler: async ({ input, ctx, tx }): Promise<DonationReconRunDto> => {
    const orgId = requireOrg(ctx);
    const event = await eventOrThrowTx(tx, input.eventId);
    // One run per event at a time.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`donations.reconcile:${event.id}`}))`);
    const [memos, references] = await Promise.all([
      memoEntriesTx(tx, event.id),
      eventReferencesTx(tx, event.id),
    ]);
    for (const m of memos) references.add(m.reference);
    const ours = eventMovements(input.movements, references);
    const diffs = reconcileDonations(memos, ours);
    const totals = reconTotals(memos, ours);
    const runId = uuidv7(ctx.now.getTime());
    await tx.insert(reconRuns).values({
      id: runId,
      orgId,
      eventId: event.id,
      provider: input.provider,
      ledgerCount: memos.length,
      providerCount: ours.length,
      itemCount: diffs.length,
      totals: ReconTotals.parse(totals),
      ranBy: actorId(ctx.actor),
    });
    const existing = await tx.select().from(reconItems).where(eq(reconItems.eventId, event.id)).for('update');
    const prevByKey = new Map(existing.map((i) => [`${i.reference}\u0000${i.currency}`, i]));
    let opened = 0;
    let cleared = 0;
    for (const d of diffs) {
      const prev = prevByKey.get(`${d.reference}\u0000${d.currency}`) ?? null;
      const status = nextItemStatus(
        prev
          ? {
              status: prev.status as ReconItemStatus,
              ledgerMinor: prev.ledgerMinor,
              providerMinor: prev.providerMinor,
            }
          : null,
        d,
      ) as ReconItemStatus;
      if (!prev) {
        opened++;
        await tx.insert(reconItems).values({
          orgId,
          eventId: event.id,
          runId,
          kind: d.kind,
          reference: d.reference,
          currency: d.currency,
          ledgerMinor: d.ledgerMinor,
          providerMinor: d.providerMinor,
          status: 'open',
        });
        continue;
      }
      if (status === 'open' && prev.status !== 'open') opened++;
      const reopen = status === 'open';
      await tx
        .update(reconItems)
        .set({
          runId,
          kind: d.kind,
          ledgerMinor: d.ledgerMinor,
          providerMinor: d.providerMinor,
          status,
          ...(reopen ? { resolutionNote: null, resolvedBy: null, resolvedAt: null } : {}),
          updatedAt: ctx.now,
        })
        .where(eq(reconItems.id, prev.id));
    }
    const found = new Set(diffs.map((d) => `${d.reference}\u0000${d.currency}`));
    const gone = existing.filter(
      (i) => i.status === 'open' && !found.has(`${i.reference}\u0000${i.currency}`),
    );
    if (gone.length) {
      cleared = gone.length;
      await tx
        .update(reconItems)
        .set({ status: 'cleared', runId, updatedAt: ctx.now })
        .where(
          inArray(
            reconItems.id,
            gone.map((i) => i.id),
          ),
        );
    }
    const shares = payoutShares(ours);
    const payouts = input.payouts.filter((p) => shares.has(p.id));
    if (payouts.length)
      await tx.insert(reconPayouts).values(
        payouts.map((p) => {
          const s = shares.get(p.id) as { grossMinor: number; feeMinor: number; count: number };
          return {
            orgId,
            eventId: event.id,
            runId,
            payoutId: p.id,
            status: p.status,
            amountMinor: p.amountMinor,
            currency: p.currency,
            arrivalDate: p.arrivalDate,
            payoutCreatedAt: p.createdAt,
            donationGrossMinor: s.grossMinor,
            donationFeeMinor: s.feeMinor,
            donationCount: s.count,
          };
        }),
      );
    return {
      runId,
      ledgerCount: memos.length,
      providerCount: ours.length,
      itemCount: diffs.length,
      opened,
      cleared,
    };
  },
  audit: (input, r) => ({
    action: 'donations.reconcile',
    targetType: 'event',
    targetId: input.eventId,
    data: { runId: r?.runId, itemCount: r?.itemCount, opened: r?.opened, cleared: r?.cleared },
  }),
});

/** Close an open difference with a note (finance roles): what was found and done about it. */
export const resolveDonationReconItemCommand = tenantCommand({
  name: 'donations.resolveReconItem',
  input: z.object({ eventId: z.uuid(), itemId: z.uuid(), note: z.string().trim().min(3).max(500) }),
  output: z.object({ id: z.uuid() }),
  entitlement: 'donations',
  permission: 'finance:reconcile',
  handler: async ({ input, ctx, tx }) => {
    const [item] = await tx
      .select()
      .from(reconItems)
      .where(and(eq(reconItems.id, input.itemId), eq(reconItems.eventId, input.eventId)))
      .for('update');
    if (!item) throw new DomainError('not_found', 'Difference not found');
    if (item.status !== 'open') throw new DomainError('invalid_state', 'This difference is not open');
    await tx
      .update(reconItems)
      .set({
        status: 'resolved',
        resolutionNote: input.note,
        resolvedBy: actorId(ctx.actor),
        resolvedAt: ctx.now,
        updatedAt: ctx.now,
      })
      .where(eq(reconItems.id, item.id));
    return { id: item.id };
  },
  audit: (input) => ({
    action: 'donations.reconcile_resolve',
    targetType: 'donation_recon_item',
    targetId: input.itemId,
    data: { eventId: input.eventId, note: input.note },
  }),
});

/** The latest reconciliation of the event: its totals, differences (open first) and payouts. */
export const donationReconciliationQuery = tenantQuery({
  name: 'donations.reconciliation',
  input: z.object({ eventId: z.uuid() }),
  output: DonationReconciliationDto,
  entitlement: 'donations',
  permission: 'finance:read',
  handler: async ({ input, tx }): Promise<DonationReconciliationDto> => {
    await eventOrThrowTx(tx, input.eventId);
    const flow = await fundsFlowTx(tx);
    const [run] = await tx
      .select()
      .from(reconRuns)
      .where(eq(reconRuns.eventId, input.eventId))
      .orderBy(desc(reconRuns.createdAt), desc(reconRuns.id))
      .limit(1);
    const [items, payouts] = await Promise.all([
      tx
        .select()
        .from(reconItems)
        .where(eq(reconItems.eventId, input.eventId))
        .orderBy(
          sql`case ${reconItems.status} when 'open' then 0 when 'resolved' then 1 else 2 end`,
          asc(reconItems.reference),
        ),
      run
        ? tx
            .select()
            .from(reconPayouts)
            .where(eq(reconPayouts.runId, run.id))
            .orderBy(asc(reconPayouts.payoutCreatedAt), asc(reconPayouts.payoutId))
        : Promise.resolve([]),
    ]);
    return {
      connected: (flow.fundsFlow === 'organizer_mor' && flow.accountId !== null) || run !== undefined,
      lastRun: run
        ? {
            id: run.id,
            ranAt: run.createdAt,
            ledgerCount: run.ledgerCount,
            providerCount: run.providerCount,
            itemCount: run.itemCount,
            totals: ReconTotals.parse(run.totals),
          }
        : null,
      items: items.map(
        (i): ReconItemDto => ({
          id: i.id,
          kind: i.kind as ReconItemDto['kind'],
          reference: i.reference,
          currency: i.currency,
          ledgerMinor: i.ledgerMinor,
          providerMinor: i.providerMinor,
          differenceMinor: i.providerMinor - i.ledgerMinor,
          status: i.status as ReconItemDto['status'],
          resolutionNote: i.resolutionNote,
          resolvedAt: i.resolvedAt,
        }),
      ),
      payouts: payouts.map(
        (p): ReconPayoutDto => ({
          payoutId: p.payoutId,
          status: p.status as ReconPayoutDto['status'],
          amountMinor: p.amountMinor,
          currency: p.currency,
          arrivalDate: p.arrivalDate,
          donationGrossMinor: p.donationGrossMinor,
          donationFeeMinor: p.donationFeeMinor,
          donationNetMinor: p.donationGrossMinor - p.donationFeeMinor,
          donationCount: p.donationCount,
        }),
      ),
    };
  },
});

/**
 * Reconcile the event's donations now (M4.8g): ask the provider for the connected accounts'
 * movements and payouts in the event's window, then record the run as the caller. `null` when the
 * provider cannot list them (the fake provider without a store) or the org has no account.
 */
export async function reconcileEventDonations(
  provider: PaymentProvider,
  eventId: string,
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
): Promise<DonationReconRunDto | null> {
  const target = await executeQuery(donationReconTargetQuery, { eventId }, ctx, ports);
  if (target.accountIds.length === 0) return null;
  const movements = [];
  const payouts = [];
  for (const connectedAccountId of target.accountIds) {
    const window = { connectedAccountId, from: target.from, to: target.to };
    const [m, p] = await Promise.all([
      provider.listConnectedBalanceTransactions(window),
      provider.listPayouts({ ...window, to: new Date(target.to.getTime() + 7 * DAY_MS) }),
    ]);
    if (!m || !p) return null;
    movements.push(...m);
    payouts.push(...p);
  }
  return executeCommand(
    recordDonationReconciliationCommand,
    {
      eventId,
      provider: provider.name as 'fake' | 'stripe',
      movements: movements.slice(0, RECON_MOVEMENTS_MAX).map((t) => ({
        id: t.id,
        kind: t.kind,
        amountMinor: t.amountMinor,
        feeMinor: t.feeMinor,
        currency: t.currency,
        occurredAt: t.occurredAt,
        reference: t.reference,
        payoutId: t.payoutId,
      })),
      payouts: payouts.slice(0, RECON_MOVEMENTS_MAX),
    },
    ctx,
    ports,
  );
}
