import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError, requireOrg, uuidv7 } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { balanceTx, postJournalTx, postTransferReversalTx } from './ledger.ts';
import { paymentAccounts, SETTLEMENT_KINDS, SETTLEMENT_STATUSES, settlements } from './schema.ts';

/**
 * Release policy, Standard tier (roadmap §5.3). **Defaults pending owner decision D3**: release
 * 5 business days after the event ends, keep a 5% reserve until 90 days after release.
 */
export const RELEASE_POLICY = { businessDaysAfterEnd: 5, reserveBps: 500, reserveDays: 90 } as const;

/** Add business days (Monday–Friday, in UTC; bank holidays are not modelled yet). */
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

export const releaseDate = (eventEndsAt: Date) =>
  addBusinessDays(eventEndsAt, RELEASE_POLICY.businessDaysAfterEnd);

const ReadyDto = z.object({
  settlementId: z.uuid(),
  amountMinor: z.int(),
  currency: z.string(),
  destinationAccountId: z.string(),
  transferGroup: z.string(),
});

/** Move what the organizer owes us out of a release before it is transferred. */
async function netReceivableTx(tx: TenantTx, ctx: Ctx, key: string, currency: string, available: number) {
  const owed = Math.max(0, await balanceTx(tx, 'org:receivable', currency));
  const netted = Math.min(owed, available);
  if (netted > 0)
    await postJournalTx(tx, ctx, {
      key: `net:${key}`,
      kind: 'receivable_netting',
      refType: 'settlement',
      refId: key,
      postings: [
        { account: 'org:payable_releasable', amountMinor: netted, currency },
        { account: 'org:receivable', amountMinor: -netted, currency },
      ],
    });
  return netted;
}

/**
 * The release job for one org (worker, platform actor). Serialized per org. For each event with
 * held funds whose release date has passed: post the release (held → releasable + reserve), net
 * any receivable, and record a settlement. Also releases reserves whose window has passed, and
 * re-offers settlements that failed or waited for a payout account. Nothing moves while staff
 * hold the org's payouts. Returns the settlements to transfer now.
 */
export const releaseDueSettlementsCommand = tenantCommand({
  name: 'payments.releaseDueSettlements',
  input: z.object({}),
  output: z.object({
    held: z.boolean(),
    ready: z.array(ReadyDto),
    /** Set while a new payout destination is in its 24 h hold (no transfers to it yet). */
    destinationHoldUntil: z.date().nullable(),
  }),
  entitlement: null,
  permission: 'platform:payouts.release',
  handler: async ({ ctx, tx }) => {
    const orgId = requireOrg(ctx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payments.release:${orgId}`}))`);
    const [account] = await tx.select().from(paymentAccounts).limit(1);
    if (account?.payoutsHeld) return { held: true, ready: [], destinationHoldUntil: null };
    // A new payout destination waits 24 h (roadmap §10): nothing is sent to it until then.
    const holdUntil =
      account?.destinationHoldUntil && account.destinationHoldUntil > ctx.now
        ? account.destinationHoldUntil
        : null;
    const destination = account?.payoutsEnabled && !holdUntil ? account.accountId : null;
    const statusFor = (amount: number) =>
      amount === 0
        ? ('transferred' as const)
        : destination
          ? ('ready' as const)
          : ('waiting_account' as const);

    // 1. Events with held funds.
    const heldRows = await tx.execute<{ event_id: string; currency: string; held: string }>(sql`
      select j.event_id, p.currency, (-sum(p.amount_minor))::text as held
      from payments.postings p join payments.journal_entries j on j.id = p.journal_id
      where p.account = 'org:payable_held' and j.event_id is not null
      group by j.event_id, p.currency having sum(p.amount_minor) < 0`);
    for (const h of heldRows) {
      const event = await findEventTx(tx, h.event_id);
      if (!event || ctx.now < releaseDate(event.endsAt)) continue;
      const released = Number(h.held);
      const reserve = Math.floor((released * RELEASE_POLICY.reserveBps) / 10_000);
      const id = uuidv7(ctx.now.getTime());
      await postJournalTx(tx, ctx, {
        key: `release:${id}`,
        kind: 'release',
        refType: 'settlement',
        refId: id,
        eventId: h.event_id,
        postings: [
          { account: 'org:payable_held', amountMinor: released, currency: h.currency },
          { account: 'org:reserve', amountMinor: -reserve, currency: h.currency },
          { account: 'org:payable_releasable', amountMinor: -(released - reserve), currency: h.currency },
        ],
      });
      const netted = await netReceivableTx(tx, ctx, id, h.currency, released - reserve);
      const amount = released - reserve - netted;
      await tx.insert(settlements).values({
        id,
        orgId,
        kind: 'event',
        eventId: h.event_id,
        currency: h.currency,
        status: statusFor(amount),
        releasedMinor: released,
        reserveMinor: reserve,
        nettedMinor: netted,
        amountMinor: amount,
        reserveReleaseAt:
          reserve > 0 ? new Date(ctx.now.getTime() + RELEASE_POLICY.reserveDays * 86_400_000) : null,
        destinationAccountId: amount > 0 ? destination : null,
        releasedAt: ctx.now,
        transferredAt: amount === 0 ? ctx.now : null,
      });
    }

    // 2. Reserves whose window has passed.
    const dueReserves = await tx
      .select()
      .from(settlements)
      .where(
        and(
          eq(settlements.kind, 'event'),
          isNull(settlements.reserveReleasedAt),
          isNotNull(settlements.reserveReleaseAt),
          lte(settlements.reserveReleaseAt, ctx.now),
        ),
      )
      .for('update');
    for (const s of dueReserves) {
      // What is left of this event's reserve after refunds drew on it.
      const left = Math.min(
        s.reserveMinor,
        Math.max(0, -(await balanceTx(tx, 'org:reserve', s.currency, s.eventId ?? undefined))),
      );
      const id = uuidv7(ctx.now.getTime());
      if (left > 0)
        await postJournalTx(tx, ctx, {
          key: `reserve:${s.id}`,
          kind: 'reserve_release',
          refType: 'settlement',
          refId: id,
          eventId: s.eventId,
          postings: [
            { account: 'org:reserve', amountMinor: left, currency: s.currency },
            { account: 'org:payable_releasable', amountMinor: -left, currency: s.currency },
          ],
        });
      const netted = left > 0 ? await netReceivableTx(tx, ctx, id, s.currency, left) : 0;
      const amount = left - netted;
      await tx.insert(settlements).values({
        id,
        orgId,
        kind: 'reserve',
        eventId: s.eventId,
        currency: s.currency,
        status: statusFor(amount),
        releasedMinor: left,
        nettedMinor: netted,
        amountMinor: amount,
        destinationAccountId: amount > 0 ? destination : null,
        releasedAt: ctx.now,
        transferredAt: amount === 0 ? ctx.now : null,
      });
      await tx.update(settlements).set({ reserveReleasedAt: ctx.now }).where(eq(settlements.id, s.id));
    }

    // 3. Settlements that waited for a payout account, now that there is one.
    if (destination)
      await tx
        .update(settlements)
        .set({ status: 'ready', destinationAccountId: destination, updatedAt: ctx.now })
        .where(eq(settlements.status, 'waiting_account'));

    const ready = await tx
      .select()
      .from(settlements)
      .where(inArray(settlements.status, ['ready', 'failed']));
    return {
      held: false,
      destinationHoldUntil: holdUntil,
      ready: ready
        .filter(
          (r) => r.destinationAccountId && !(holdUntil && r.destinationAccountId === account?.accountId),
        )
        .map((r) => ({
          settlementId: r.id,
          amountMinor: r.amountMinor,
          currency: r.currency,
          destinationAccountId: r.destinationAccountId ?? '',
          transferGroup: `event:${r.eventId ?? 'none'}`,
        })),
    };
  },
  audit: (_i, r) => ({
    action: 'payouts.release',
    targetType: 'organization',
    targetId: null,
    data: { held: r?.held, ready: r?.ready.length, destinationHold: r?.destinationHoldUntil !== null },
  }),
});

/** Record the provider's answer for a settlement transfer (worker). */
export const recordTransferCommand = tenantCommand({
  name: 'payments.recordTransfer',
  input: z.object({
    settlementId: z.uuid(),
    outcome: z.enum(['succeeded', 'failed']),
    transferId: z.string().min(1).max(255),
    failure: z.string().max(200).optional(),
  }),
  output: z.object({ status: z.enum(SETTLEMENT_STATUSES), changed: z.boolean() }),
  entitlement: null,
  permission: 'platform:payouts.release',
  handler: async ({ input, ctx, tx, emit }) => {
    const [s] = await tx
      .select()
      .from(settlements)
      .where(eq(settlements.id, input.settlementId))
      .for('update');
    if (!s) throw new DomainError('not_found', 'Settlement not found');
    if (s.status === 'transferred') return { status: 'transferred' as const, changed: false };
    if (input.outcome === 'failed') {
      await tx
        .update(settlements)
        .set({
          status: 'failed',
          failure: input.failure ?? 'transfer_failed',
          transferId: input.transferId,
          updatedAt: ctx.now,
        })
        .where(eq(settlements.id, s.id));
      return { status: 'failed' as const, changed: true };
    }
    await postJournalTx(tx, ctx, {
      key: `transfer:${s.id}`,
      kind: 'transfer',
      refType: 'settlement',
      refId: s.id,
      eventId: s.eventId,
      memo: { transferId: input.transferId },
      postings: [
        { account: 'org:payable_releasable', amountMinor: s.amountMinor, currency: s.currency },
        { account: 'platform:stripe_cash', amountMinor: -s.amountMinor, currency: s.currency },
      ],
    });
    await tx
      .update(settlements)
      .set({
        status: 'transferred',
        transferId: input.transferId,
        failure: null,
        transferredAt: ctx.now,
        updatedAt: ctx.now,
      })
      .where(eq(settlements.id, s.id));
    emit({
      type: 'payouts.transferred',
      version: 1,
      aggregateType: 'settlement',
      aggregateId: s.id,
      payload: { orgId: s.orgId, settlementId: s.id, amountMinor: s.amountMinor, currency: s.currency },
    });
    return { status: 'transferred' as const, changed: true };
  },
  audit: (input) => ({
    action: 'payouts.transfer',
    targetType: 'settlement',
    targetId: input.settlementId,
    data: { outcome: input.outcome },
  }),
});

/** The latest transfer that paid out this event (a refund after release reverses against it). */
export async function eventTransferTx(tx: TenantTx, eventId: string): Promise<string | null> {
  const [s] = await tx
    .select({ transferId: settlements.transferId })
    .from(settlements)
    .where(
      and(
        eq(settlements.eventId, eventId),
        eq(settlements.status, 'transferred'),
        isNotNull(settlements.transferId),
      ),
    )
    .orderBy(desc(settlements.transferredAt))
    .limit(1);
  return s?.transferId ?? null;
}

/**
 * Record an explicit transfer reversal after a refund (roadmap §5.3). Succeeded: the receivable
 * is paid back. Failed: it stays a receivable, netted from the next release.
 */
export const recordTransferReversalCommand = tenantCommand({
  name: 'payments.recordTransferReversal',
  input: z.object({
    refundId: z.uuid(),
    orderId: z.uuid(),
    eventId: z.uuid(),
    outcome: z.enum(['succeeded', 'failed']),
    reversalId: z.string().min(1).max(255),
    amountMinor: z.int().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  output: z.object({ receivableMinor: z.int() }),
  entitlement: null,
  permission: 'orders:refund',
  handler: async ({ input, ctx, tx }) => {
    if (input.outcome === 'succeeded') await postTransferReversalTx(tx, ctx, input);
    return { receivableMinor: Math.max(0, await balanceTx(tx, 'org:receivable', input.currency)) };
  },
  audit: (input) => ({
    action: 'payouts.transfer_reversal',
    targetType: 'refund',
    targetId: input.refundId,
    data: { outcome: input.outcome, amountMinor: input.amountMinor },
  }),
});

export const SettlementDto = z.object({
  id: z.uuid(),
  kind: z.enum(SETTLEMENT_KINDS),
  eventId: z.uuid().nullable(),
  currency: z.string(),
  status: z.enum(SETTLEMENT_STATUSES),
  releasedMinor: z.int(),
  reserveMinor: z.int(),
  nettedMinor: z.int(),
  amountMinor: z.int(),
  releasedAt: z.date(),
  transferredAt: z.date().nullable(),
  reserveReleaseAt: z.date().nullable(),
});

/** The organizer's settlement view (replaces the legacy "Transferred" checkbox). */
export const settlementsQuery = tenantQuery({
  name: 'payments.settlements',
  input: z.object({ limit: z.int().min(1).max(200).default(50) }),
  output: z.array(SettlementDto),
  entitlement: null,
  permission: 'finance:read',
  handler: async ({ input, tx }) =>
    (await tx.select().from(settlements).orderBy(desc(settlements.releasedAt)).limit(input.limit)).map(
      (s) => ({
        id: s.id,
        kind: s.kind as (typeof SETTLEMENT_KINDS)[number],
        eventId: s.eventId,
        currency: s.currency,
        status: s.status as (typeof SETTLEMENT_STATUSES)[number],
        releasedMinor: s.releasedMinor,
        reserveMinor: s.reserveMinor,
        nettedMinor: s.nettedMinor,
        amountMinor: s.amountMinor,
        releasedAt: s.releasedAt,
        transferredAt: s.transferredAt,
        reserveReleaseAt: s.reserveReleaseAt,
      }),
    ),
});
