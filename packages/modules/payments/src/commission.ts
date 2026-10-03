import { agencyBillingActiveTx } from '@yayatoh/billing';
import { type TenantTx, withTenant } from '@yayatoh/db';
import { type Ctx, createCtx, DomainError, requireOrg, uuidv7 } from '@yayatoh/kernel';
import { defineSubscriber, emitEvents, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  COMMISSION_ENTRY_KINDS,
  type CommissionEntryKind,
  commissionFor,
  mirrorPostings,
  reversalForRefund,
} from './commission-math.ts';
import { postJournalTx } from './ledger.ts';
import type { LedgerAccount } from './schema.ts';
import { settlements } from './schema.ts';

/**
 * Agency v2 money, part 2 (M6.8a, roadmap §5.3 "agency commission is a second transfer in the same
 * group"). Only `platform_mor` (separate charges & transfers) earns commission; `organizer_mor`
 * direct charges never do (later).
 *
 * In the **client's** ledger: a sale moves the commission out of the organizer's held funds into
 * `agency:commission_held`; at release it becomes a `commission` settlement transferred to the
 * agency's connected account with the event's `transfer_group`. A refund takes the commission
 * back in proportion to the refunded amount: from what is not transferred yet, else by an
 * **explicit transfer reversal** of the commission transfer (never `reverse_transfer`, which does
 * not apply to separate charges & transfers); until it succeeds the agency owes it
 * (`agency:commission_receivable`), netted from its next commission.
 *
 * Every movement emits `payments.agency_commission@1`; the `payments.agency-commission` subscriber
 * posts a **mirror journal in the agency's own ledger** (never platform cash), so the agency's
 * statement reads its own rows only and never a client money table.
 */

interface Movement {
  readonly agencyOrgId: string;
  readonly kind: CommissionEntryKind;
  readonly amountMinor: number;
  readonly currency: string;
  readonly eventId: string | null;
  readonly orderId?: string | null;
  readonly refundId?: string | null;
  readonly settlementId?: string | null;
  /** The client journal it comes from (with the kind: one journal can carry two movements). */
  readonly ref: string;
}

async function emitMovementTx(tx: TenantTx, ctx: Ctx, m: Movement) {
  if (m.amountMinor <= 0) return;
  const orgId = requireOrg(ctx);
  await emitEvents(tx, ctx, [
    {
      type: 'payments.agency_commission',
      version: 1,
      aggregateType: 'organization',
      aggregateId: m.agencyOrgId,
      payload: {
        orgId,
        agencyOrgId: m.agencyOrgId,
        kind: m.kind,
        amountMinor: m.amountMinor,
        currency: m.currency,
        eventId: m.eventId,
        orderId: m.orderId ?? null,
        refundId: m.refundId ?? null,
        settlementId: m.settlementId ?? null,
        ref: `${m.ref}#${m.kind}`,
      },
    },
  ]);
}

async function num(tx: TenantTx, q: ReturnType<typeof sql>): Promise<number> {
  const [r] = await tx.execute<{ n: string | null }>(q);
  return Number(r?.n ?? 0);
}

/** An agency's account balance in this org's ledger (debit positive), optionally for one event. */
export async function commissionBalanceTx(
  tx: TenantTx,
  account: 'agency:commission_held' | 'agency:commission_receivable',
  agencyOrgId: string,
  currency: string,
  eventId?: string,
): Promise<number> {
  return num(
    tx,
    sql`select sum(p.amount_minor)::text as n from payments.postings p
      join payments.journal_entries j on j.id = p.journal_id
      where p.account = ${account} and p.currency = ${currency}
        and j.memo->>'agencyOrgId' = ${agencyOrgId}
        ${eventId ? sql`and j.event_id = ${eventId}` : sql``}`,
  );
}

/**
 * A paid `platform_mor` order while agency billing is in force: the agency's commission on the
 * organizer's share moves from `payable_held` to `agency:commission_held` (same event). Idempotent
 * per order. Returns the commission (0 when none).
 */
export async function accrueCommissionTx(
  tx: TenantTx,
  ctx: Ctx,
  o: { orderId: string; eventId: string; totalMinor: number; feeMinor: number; currency: string },
): Promise<number> {
  const billing = await agencyBillingActiveTx(tx);
  if (!billing) return 0;
  const base = o.totalMinor - o.feeMinor;
  const commission = commissionFor(base, billing.commissionBps);
  if (commission <= 0) return 0;
  const key = `commission:${o.orderId}`;
  const { created } = await postJournalTx(tx, ctx, {
    key,
    kind: 'agency_commission',
    refType: 'order',
    refId: o.orderId,
    eventId: o.eventId,
    memo: {
      agencyOrgId: billing.agencyOrgId,
      grantId: billing.grantId,
      commissionBps: billing.commissionBps,
      baseMinor: base,
      grossMinor: o.totalMinor,
      amountMinor: commission,
    },
    postings: [
      { account: 'org:payable_held', amountMinor: commission, currency: o.currency },
      { account: 'agency:commission_held', amountMinor: -commission, currency: o.currency },
    ],
  });
  if (created)
    await emitMovementTx(tx, ctx, {
      agencyOrgId: billing.agencyOrgId,
      kind: 'accrued',
      amountMinor: commission,
      currency: o.currency,
      eventId: o.eventId,
      orderId: o.orderId,
      ref: key,
    });
  return commission;
}

/** The latest commission transfer that paid this agency for this event. */
async function commissionTransferTx(
  tx: TenantTx,
  eventId: string,
  agencyOrgId: string,
): Promise<string | null> {
  const [s] = await tx
    .select({ transferId: settlements.transferId })
    .from(settlements)
    .where(
      and(
        eq(settlements.kind, 'commission'),
        eq(settlements.eventId, eventId),
        eq(settlements.agencyOrgId, agencyOrgId),
        eq(settlements.status, 'transferred'),
        sql`${settlements.transferId} is not null`,
      ),
    )
    .orderBy(desc(settlements.transferredAt))
    .limit(1);
  return s?.transferId ?? null;
}

export interface CommissionReversal {
  readonly agencyOrgId: string;
  /** Taken back before any transfer (ledger only). */
  readonly fromHeldMinor: number;
  /** Already transferred: reverse this much of `transferId` explicitly. */
  readonly afterTransferMinor: number;
  readonly transferId: string | null;
  readonly currency: string;
}

/**
 * A succeeded `platform_mor` refund of an order that earned commission (called by `postRefundTx`
 * before its own journal): reverse the commission proportionally to the refunded amount of the
 * organizer's share (the refund less the platform fee it gives back; cumulative, to the cent). What is not transferred yet goes back to the organizer's held funds
 * (and a commission settlement still waiting shrinks); what was transferred becomes owed by the
 * agency and is returned for an explicit transfer reversal. Either way the organizer's held funds
 * get the commission back, so the refund then draws on them as before. Idempotent per refund (a
 * replay returns null: the first call's caller reverses).
 */
export async function reverseCommissionTx(
  tx: TenantTx,
  ctx: Ctx,
  r: {
    refundId: string;
    orderId: string;
    eventId: string;
    amountMinor: number;
    feeRefundedMinor: number;
    currency: string;
  },
): Promise<CommissionReversal | null> {
  const [accrual] = await tx.execute<{
    memo: { agencyOrgId: string; baseMinor: number; amountMinor: number };
  }>(sql`select memo from payments.journal_entries where idempotency_key = ${`commission:${r.orderId}`}`);
  if (!accrual) return null;
  const { agencyOrgId, baseMinor, amountMinor: commission } = accrual.memo;
  const key = `commission_reversal:${r.refundId}`;
  const refundedBefore = await num(
    tx,
    sql`select sum((memo->>'amountMinor')::bigint - coalesce((memo->>'feeRefundedMinor')::bigint, 0))::text as n
      from payments.journal_entries
      where kind = 'refund' and ref_id = ${r.orderId} and idempotency_key <> ${`refund:${r.refundId}`}`,
  );
  const reversedBefore = await num(
    tx,
    sql`select sum((memo->>'amountMinor')::bigint)::text as n from payments.journal_entries
      where kind = 'agency_commission_reversal' and ref_id = ${r.orderId} and idempotency_key <> ${key}`,
  );
  const reversal = reversalForRefund({
    commissionMinor: Number(commission),
    baseMinor: Number(baseMinor),
    refundedBeforeMinor: refundedBefore,
    refundMinor: r.amountMinor - r.feeRefundedMinor,
    reversedBeforeMinor: reversedBefore,
  });
  if (reversal <= 0) return null;
  const c = r.currency;
  // Not transferred yet: held, less what commission settlements still waiting already claim.
  const held = Math.max(
    0,
    -(await commissionBalanceTx(tx, 'agency:commission_held', agencyOrgId, c, r.eventId)),
  );
  const waiting = await tx
    .select()
    .from(settlements)
    .where(
      and(
        eq(settlements.kind, 'commission'),
        eq(settlements.eventId, r.eventId),
        eq(settlements.agencyOrgId, agencyOrgId),
        eq(settlements.currency, c),
        inArray(settlements.status, ['ready', 'waiting_account', 'failed']),
      ),
    )
    .for('update');
  const claimed = waiting.reduce((n, s) => n + s.amountMinor, 0);
  let fromHeld = Math.min(reversal, Math.max(0, held - claimed));
  // Then shrink a settlement that has not been transferred: that commission is still held too.
  for (const s of waiting) {
    const take = Math.min(reversal - fromHeld, s.amountMinor);
    if (take <= 0) break;
    const amount = s.amountMinor - take;
    await tx
      .update(settlements)
      .set({
        releasedMinor: s.releasedMinor - take,
        amountMinor: amount,
        ...(amount === 0
          ? { status: 'transferred', transferredAt: ctx.now, destinationAccountId: null }
          : {}),
        updatedAt: ctx.now,
      })
      .where(eq(settlements.id, s.id));
    fromHeld += take;
  }
  const afterTransfer = reversal - fromHeld;
  const { created } = await postJournalTx(tx, ctx, {
    key,
    kind: 'agency_commission_reversal',
    refType: 'order',
    refId: r.orderId,
    eventId: r.eventId,
    memo: {
      agencyOrgId,
      refundId: r.refundId,
      amountMinor: reversal,
      fromHeldMinor: fromHeld,
      afterTransferMinor: afterTransfer,
    },
    postings: [
      { account: 'agency:commission_held', amountMinor: fromHeld, currency: c },
      { account: 'agency:commission_receivable', amountMinor: afterTransfer, currency: c },
      { account: 'org:payable_held', amountMinor: -reversal, currency: c },
    ],
  });
  if (!created) return null;
  const base = {
    agencyOrgId,
    currency: c,
    eventId: r.eventId,
    orderId: r.orderId,
    refundId: r.refundId,
    ref: key,
  };
  await emitMovementTx(tx, ctx, { ...base, kind: 'reversed', amountMinor: fromHeld });
  await emitMovementTx(tx, ctx, { ...base, kind: 'clawback', amountMinor: afterTransfer });
  return {
    agencyOrgId,
    fromHeldMinor: fromHeld,
    afterTransferMinor: afterTransfer,
    transferId: afterTransfer > 0 ? await commissionTransferTx(tx, r.eventId, agencyOrgId) : null,
    currency: c,
  };
}

/** The agency's payout account for a commission transfer, unless it is in its 24 h new-destination hold. */
async function agencyDestinationTx(tx: TenantTx, agencyOrgId: string, now: Date): Promise<string | null> {
  const [d] = await tx.execute<{ account_id: string; destination_hold_until: Date | null }>(
    sql`select account_id, destination_hold_until from payments.agency_payout_destination(${agencyOrgId})`,
  );
  if (!d) return null;
  if (d.destination_hold_until && new Date(d.destination_hold_until) > now) return null;
  return d.account_id;
}

/**
 * The release job's commission step (inside `payments.releaseDueSettlements`): for each event whose
 * release date has passed (`isDue`), the agency's held commission not yet claimed by a settlement
 * becomes a `commission` settlement, after netting what the agency owes back. Settlements that
 * waited for the agency's payout account are offered again.
 */
export async function releaseCommissionsTx(
  tx: TenantTx,
  ctx: Ctx,
  isDue: (eventId: string) => Promise<boolean>,
): Promise<void> {
  const orgId = requireOrg(ctx);
  const groups = await tx.execute<{ event_id: string; currency: string; agency: string; held: string }>(sql`
    select j.event_id, p.currency, j.memo->>'agencyOrgId' as agency, (-sum(p.amount_minor))::text as held
    from payments.postings p join payments.journal_entries j on j.id = p.journal_id
    where p.account = 'agency:commission_held' and j.event_id is not null
    group by 1, 2, 3 having sum(p.amount_minor) < 0`);
  for (const g of groups) {
    if (!(await isDue(g.event_id))) continue;
    const claimed = await num(
      tx,
      sql`select sum(amount_minor)::text as n from payments.settlements
        where kind = 'commission' and event_id = ${g.event_id} and agency_org_id = ${g.agency}
          and currency = ${g.currency} and status in ('ready', 'waiting_account', 'failed')`,
    );
    const available = Number(g.held) - claimed;
    if (available <= 0) continue;
    const id = uuidv7(ctx.now.getTime());
    const owed = Math.max(
      0,
      await commissionBalanceTx(tx, 'agency:commission_receivable', g.agency, g.currency),
    );
    const netted = Math.min(owed, available);
    if (netted > 0) {
      const key = `commission_net:${id}`;
      await postJournalTx(tx, ctx, {
        key,
        kind: 'agency_commission_netting',
        refType: 'settlement',
        refId: id,
        eventId: g.event_id,
        memo: { agencyOrgId: g.agency, amountMinor: netted },
        postings: [
          { account: 'agency:commission_held', amountMinor: netted, currency: g.currency },
          { account: 'agency:commission_receivable', amountMinor: -netted, currency: g.currency },
        ],
      });
      await emitMovementTx(tx, ctx, {
        agencyOrgId: g.agency,
        kind: 'netted',
        amountMinor: netted,
        currency: g.currency,
        eventId: g.event_id,
        settlementId: id,
        ref: key,
      });
    }
    const amount = available - netted;
    const destination = amount > 0 ? await agencyDestinationTx(tx, g.agency, ctx.now) : null;
    await tx.insert(settlements).values({
      id,
      orgId,
      kind: 'commission',
      eventId: g.event_id,
      agencyOrgId: g.agency,
      currency: g.currency,
      status: amount === 0 ? 'transferred' : destination ? 'ready' : 'waiting_account',
      releasedMinor: available,
      reserveMinor: 0,
      nettedMinor: netted,
      amountMinor: amount,
      destinationAccountId: destination,
      releasedAt: ctx.now,
      transferredAt: amount === 0 ? ctx.now : null,
    });
  }
  // Commission settlements that waited for the agency's payout account.
  const waiting = await tx
    .select()
    .from(settlements)
    .where(and(eq(settlements.kind, 'commission'), eq(settlements.status, 'waiting_account')))
    .for('update');
  for (const s of waiting) {
    const destination = s.agencyOrgId ? await agencyDestinationTx(tx, s.agencyOrgId, ctx.now) : null;
    if (destination)
      await tx
        .update(settlements)
        .set({ status: 'ready', destinationAccountId: destination, updatedAt: ctx.now })
        .where(eq(settlements.id, s.id));
  }
}

/** The ledger side of a succeeded commission transfer (inside `payments.recordTransfer`). */
export async function postCommissionTransferTx(
  tx: TenantTx,
  ctx: Ctx,
  s: typeof settlements.$inferSelect,
  transferId: string,
) {
  if (!s.agencyOrgId) throw new DomainError('internal', 'A commission settlement names its agency');
  const key = `transfer:${s.id}`;
  const { created } = await postJournalTx(tx, ctx, {
    key,
    kind: 'transfer',
    refType: 'settlement',
    refId: s.id,
    eventId: s.eventId,
    memo: { transferId, agencyOrgId: s.agencyOrgId, commission: true },
    postings: [
      { account: 'agency:commission_held', amountMinor: s.amountMinor, currency: s.currency },
      { account: 'platform:stripe_cash', amountMinor: -s.amountMinor, currency: s.currency },
    ],
  });
  if (created)
    await emitMovementTx(tx, ctx, {
      agencyOrgId: s.agencyOrgId,
      kind: 'transferred',
      amountMinor: s.amountMinor,
      currency: s.currency,
      eventId: s.eventId,
      settlementId: s.id,
      ref: key,
    });
}

/**
 * Record the explicit reversal of a commission transfer after a refund. Succeeded: what the agency
 * owed is back in platform cash. Failed: it stays owed, netted from the agency's next commission.
 */
export const recordCommissionReversalCommand = tenantCommand({
  name: 'payments.recordCommissionReversal',
  // Records what the provider already did (like `payments.recordTransferReversal`).
  duringFreeze: 'allowed',
  category: 'money',
  input: z.object({
    refundId: z.uuid(),
    orderId: z.uuid(),
    eventId: z.uuid(),
    agencyOrgId: z.uuid(),
    outcome: z.enum(['succeeded', 'failed']),
    reversalId: z.string().min(1).max(255),
    amountMinor: z.int().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  output: z.object({ owedMinor: z.int() }),
  entitlement: null,
  permission: 'orders:refund',
  handler: async ({ input, ctx, tx }) => {
    if (input.outcome === 'succeeded') {
      const key = `commission_reversal_paid:${input.refundId}`;
      const { created } = await postJournalTx(tx, ctx, {
        key,
        kind: 'agency_commission_reversal_paid',
        refType: 'order',
        refId: input.orderId,
        eventId: input.eventId,
        memo: {
          agencyOrgId: input.agencyOrgId,
          refundId: input.refundId,
          reversalId: input.reversalId,
          amountMinor: input.amountMinor,
        },
        postings: [
          { account: 'platform:stripe_cash', amountMinor: input.amountMinor, currency: input.currency },
          {
            account: 'agency:commission_receivable',
            amountMinor: -input.amountMinor,
            currency: input.currency,
          },
        ],
      });
      if (created)
        await emitMovementTx(tx, ctx, {
          agencyOrgId: input.agencyOrgId,
          kind: 'clawback_paid',
          amountMinor: input.amountMinor,
          currency: input.currency,
          eventId: input.eventId,
          orderId: input.orderId,
          refundId: input.refundId,
          ref: key,
        });
    }
    return {
      owedMinor: Math.max(
        0,
        await commissionBalanceTx(tx, 'agency:commission_receivable', input.agencyOrgId, input.currency),
      ),
    };
  },
  audit: (input) => ({
    action: 'payouts.commission_reversal',
    targetType: 'refund',
    targetId: input.refundId,
    data: { status: input.outcome, amountMinor: input.amountMinor, currency: input.currency },
  }),
});

const MirrorPayload = z.object({
  orgId: z.uuid(),
  agencyOrgId: z.uuid(),
  kind: z.enum(COMMISSION_ENTRY_KINDS),
  amountMinor: z.int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  eventId: z.uuid().nullable(),
  orderId: z.uuid().nullable(),
  refundId: z.uuid().nullable(),
  settlementId: z.uuid().nullable(),
  ref: z.string().min(1).max(200),
});

/**
 * Mirror a client's commission movement into the agency's own ledger (a separate transaction under
 * the agency's tenant, as the system). Idempotent per movement (`mirror:<client>:<ref>`).
 */
export const agencyCommissionMirror = defineSubscriber({
  name: 'payments.agency-commission',
  events: ['payments.agency_commission@1'],
  handle: async (_tx, event) => {
    const p = MirrorPayload.safeParse(event.payload);
    if (!p.success || p.data.orgId !== event.orgId) return;
    const m = p.data;
    const ctx = createCtx({
      orgId: m.agencyOrgId,
      actor: { type: 'system', name: 'payments.agency-commission' },
      ...(event.occurredAt ? { now: new Date(event.occurredAt) } : {}),
    });
    await withTenant(ctx, (atx) =>
      postJournalTx(atx, ctx, {
        key: `mirror:${m.orgId}:${m.ref}`,
        kind: 'agency_commission_mirror',
        refType: 'organization',
        refId: m.orgId,
        memo: {
          clientOrgId: m.orgId,
          entry: m.kind,
          amountMinor: m.amountMinor,
          eventId: m.eventId,
          orderId: m.orderId,
          refundId: m.refundId,
          settlementId: m.settlementId,
        },
        postings: mirrorPostings(m.kind, m.amountMinor).map((x) => ({
          account: x.account as LedgerAccount,
          amountMinor: x.amountMinor,
          currency: m.currency,
        })),
      }),
    );
  },
});

// --- Statements, from ledger entries only --------------------------------------------------------

const CommissionTotalsDto = z.object({
  currency: z.string(),
  /** Commission earned, net of refunds. */
  earnedMinor: z.int(),
  /** Earned and not transferred yet. */
  pendingMinor: z.int(),
  /** Transferred to the agency, net of reversals. */
  paidMinor: z.int(),
  /** Owed back by the agency after refunds (until reversed or netted). */
  owedMinor: z.int(),
});

export const CommissionStatementDto = z.object({
  totals: z.array(CommissionTotalsDto),
  entries: z.array(
    z.object({
      journalId: z.uuid(),
      occurredAt: z.date(),
      kind: z.enum(COMMISSION_ENTRY_KINDS),
      /** The other side: the client (agency statement) or the agency (client statement). */
      counterpartyOrgId: z.uuid().nullable(),
      eventId: z.uuid().nullable(),
      /** Positive: earned or paid to the agency; negative: taken back. */
      amountMinor: z.int(),
      currency: z.string(),
    }),
  ),
});
export type CommissionStatementDto = z.infer<typeof CommissionStatementDto>;

const SIGN: Record<CommissionEntryKind, 1 | -1> = {
  accrued: 1,
  reversed: -1,
  clawback: -1,
  transferred: 1,
  netted: -1,
  clawback_paid: -1,
};

/** `-0` never reaches the wire (a balance of zero negated). */
const noNegativeZero = (t: z.infer<typeof CommissionTotalsDto>) => ({
  currency: t.currency,
  earnedMinor: t.earnedMinor || 0,
  pendingMinor: t.pendingMinor || 0,
  paidMinor: t.paidMinor || 0,
  owedMinor: t.owedMinor || 0,
});

const StatementInput = z.object({ limit: z.int().min(1).max(500).default(100) });

/**
 * The agency's commission statement: its own mirror journals only (it never reads a client's
 * ledger). Totals from its `agency:*` balances.
 */
export const agencyCommissionStatementQuery = tenantQuery({
  name: 'payments.agencyCommissionStatement',
  input: StatementInput,
  output: CommissionStatementDto,
  entitlement: null,
  permission: 'finance:read',
  handler: async ({ input, tx }) => {
    const rows = await tx.execute<{
      id: string;
      occurred_at: Date;
      entry: CommissionEntryKind;
      client: string | null;
      event_id: string | null;
      amount: string;
      currency: string;
    }>(sql`
      select j.id, j.occurred_at, j.memo->>'entry' as entry, j.memo->>'clientOrgId' as client,
        j.memo->>'eventId' as event_id, (j.memo->>'amountMinor') as amount,
        (select p.currency from payments.postings p where p.journal_id = j.id limit 1) as currency
      from payments.journal_entries j where j.kind = 'agency_commission_mirror'
      order by j.occurred_at desc, j.id desc limit ${input.limit}`);
    const bal = await tx.execute<{ account: string; currency: string; b: string }>(sql`
      select account, currency, sum(amount_minor)::text as b from payments.postings
      where account in ('agency:commission_due', 'agency:commission_earned', 'agency:commission_paid', 'agency:commission_clawback')
      group by 1, 2`);
    const totals = new Map<string, z.infer<typeof CommissionTotalsDto>>();
    for (const r of bal) {
      const t = totals.get(r.currency) ?? {
        currency: r.currency,
        earnedMinor: 0,
        pendingMinor: 0,
        paidMinor: 0,
        owedMinor: 0,
      };
      const b = Number(r.b);
      if (r.account === 'agency:commission_earned') t.earnedMinor = -b;
      if (r.account === 'agency:commission_due') t.pendingMinor = b;
      if (r.account === 'agency:commission_paid') t.paidMinor = b;
      if (r.account === 'agency:commission_clawback') t.owedMinor = -b;
      totals.set(r.currency, t);
    }
    return {
      totals: [...totals.values()].map(noNegativeZero).sort((a, b) => a.currency.localeCompare(b.currency)),
      entries: rows.map((r) => ({
        journalId: r.id,
        occurredAt: new Date(r.occurred_at),
        kind: r.entry,
        counterpartyOrgId: r.client,
        eventId: r.event_id,
        amountMinor: SIGN[r.entry] * Number(r.amount),
        currency: r.currency,
      })),
    };
  },
});

/** The client's commission statement: its own commission journals (finance roles of the client). */
export const clientCommissionStatementQuery = tenantQuery({
  name: 'payments.clientCommissionStatement',
  input: StatementInput,
  output: CommissionStatementDto,
  entitlement: null,
  permission: 'finance:read',
  handler: async ({ input, tx }) => {
    const rows = await tx.execute<{
      id: string;
      occurred_at: Date;
      kind: string;
      memo: Record<string, unknown>;
      event_id: string | null;
      held: string;
      receivable: string;
      currency: string;
    }>(sql`
      select j.id, j.occurred_at, j.kind, j.memo, j.event_id, p.currency,
        coalesce(sum(p.amount_minor) filter (where p.account = 'agency:commission_held'), 0)::text as held,
        coalesce(sum(p.amount_minor) filter (where p.account = 'agency:commission_receivable'), 0)::text as receivable
      from payments.journal_entries j join payments.postings p on p.journal_id = j.id
      where p.account in ('agency:commission_held', 'agency:commission_receivable')
      group by j.id, j.occurred_at, j.kind, j.memo, j.event_id, p.currency
      order by j.occurred_at desc, j.id desc`);
    const entries: CommissionStatementDto['entries'] = [];
    const totals = new Map<string, z.infer<typeof CommissionTotalsDto>>();
    const tot = (c: string) => {
      const t = totals.get(c) ?? { currency: c, earnedMinor: 0, pendingMinor: 0, paidMinor: 0, owedMinor: 0 };
      totals.set(c, t);
      return t;
    };
    const push = (r: (typeof rows)[number], kind: CommissionEntryKind, amount: number) => {
      if (amount === 0) return;
      entries.push({
        journalId: r.id,
        occurredAt: new Date(r.occurred_at),
        kind,
        counterpartyOrgId: typeof r.memo.agencyOrgId === 'string' ? r.memo.agencyOrgId : null,
        eventId: r.event_id,
        amountMinor: SIGN[kind] * amount,
        currency: r.currency,
      });
    };
    for (const r of rows) {
      const held = Number(r.held);
      const recv = Number(r.receivable);
      const t = tot(r.currency);
      t.pendingMinor -= held;
      t.owedMinor += recv;
      if (r.kind === 'agency_commission') {
        push(r, 'accrued', -held);
        t.earnedMinor += -held;
      } else if (r.kind === 'agency_commission_reversal') {
        push(r, 'reversed', held);
        push(r, 'clawback', recv);
        t.earnedMinor -= held + recv;
      } else if (r.kind === 'transfer') {
        push(r, 'transferred', held);
        t.paidMinor += held;
      } else if (r.kind === 'agency_commission_netting') push(r, 'netted', held);
      else if (r.kind === 'agency_commission_reversal_paid') {
        push(r, 'clawback_paid', -recv);
        t.paidMinor += recv;
      }
    }
    return {
      totals: [...totals.values()].map(noNegativeZero).sort((a, b) => a.currency.localeCompare(b.currency)),
      entries: entries.slice(0, input.limit),
    };
  },
});
