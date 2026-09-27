import type { TenantTx } from '@yayatoh/db';
import { actorId, type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { balanceTx, type Posting, postJournalTx } from './ledger.ts';
import type { FundsFlow } from './port.ts';
import { DISPUTE_STATUSES, disputes } from './schema.ts';

type Row = typeof disputes.$inferSelect;

/**
 * A dispute opened (roadmap §5.3). platform_mor: the provider takes the disputed amount from the
 * platform balance at once, so the organizer's share is held back: the event's held funds first,
 * then the event's reserve, then a receivable. organizer_mor: the dispute is on the organizer's own
 * account; the platform books nothing. Idempotent per provider dispute.
 */
export async function openDisputeTx(
  tx: TenantTx,
  ctx: Ctx,
  d: {
    orderId: string;
    eventId: string;
    fundsFlow: FundsFlow;
    provider: 'fake' | 'stripe';
    providerDisputeId: string;
    amountMinor: number;
    currency: string;
    reason: string;
    evidenceDueBy: Date | null;
  },
): Promise<{ row: Row; created: boolean }> {
  const [row] = await tx
    .insert(disputes)
    .values({ orgId: requireOrg(ctx), ...d, reason: d.reason.slice(0, 100) })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    const [existing] = await tx
      .select()
      .from(disputes)
      .where(and(eq(disputes.provider, d.provider), eq(disputes.providerDisputeId, d.providerDisputeId)));
    if (!existing) throw new DomainError('internal');
    return { row: existing, created: false };
  }
  if (d.fundsFlow === 'platform_mor') {
    const c = d.currency;
    const held = Math.max(0, -(await balanceTx(tx, 'org:payable_held', c, d.eventId)));
    const fromHeld = Math.min(d.amountMinor, held);
    const reserve = Math.max(0, -(await balanceTx(tx, 'org:reserve', c, d.eventId)));
    const fromReserve = Math.min(d.amountMinor - fromHeld, reserve);
    const receivable = d.amountMinor - fromHeld - fromReserve;
    await postJournalTx(tx, ctx, {
      key: `dispute:${row.id}`,
      kind: 'dispute',
      refType: 'order',
      refId: d.orderId,
      eventId: d.eventId,
      memo: { disputeId: row.id, providerDisputeId: d.providerDisputeId },
      postings: [
        { account: 'platform:stripe_cash', amountMinor: -d.amountMinor, currency: c },
        { account: 'org:payable_held', amountMinor: fromHeld, currency: c },
        { account: 'org:reserve', amountMinor: fromReserve, currency: c },
        { account: 'org:receivable', amountMinor: receivable, currency: c },
      ],
    });
  }
  return { row, created: true };
}

/**
 * A dispute closed. Won: the provider returns the money, and the hold is undone exactly (the
 * dispute journal reversed). Lost: the money stays with the buyer. Idempotent.
 */
export async function closeDisputeTx(
  tx: TenantTx,
  ctx: Ctx,
  d: { provider: 'fake' | 'stripe'; providerDisputeId: string; outcome: 'won' | 'lost' },
): Promise<{ row: Row; changed: boolean }> {
  const [row] = await tx
    .select()
    .from(disputes)
    .where(and(eq(disputes.provider, d.provider), eq(disputes.providerDisputeId, d.providerDisputeId)))
    .for('update');
  if (!row) throw new DomainError('not_found', 'Dispute not found');
  if (row.status === 'won' || row.status === 'lost') return { row, changed: false };
  const [updated] = await tx
    .update(disputes)
    .set({ status: d.outcome, closedAt: ctx.now, updatedAt: ctx.now })
    .where(eq(disputes.id, row.id))
    .returning();
  if (!updated) throw new DomainError('internal');
  if (d.outcome === 'won' && row.fundsFlow === 'platform_mor') {
    const lines = await tx.execute<{ account: string; amount_minor: string; currency: string }>(sql`
      select p.account, p.amount_minor::text, p.currency from payments.postings p
      join payments.journal_entries j on j.id = p.journal_id
      where j.idempotency_key = ${`dispute:${row.id}`}`);
    await postJournalTx(tx, ctx, {
      key: `dispute_won:${row.id}`,
      kind: 'dispute_won',
      refType: 'order',
      refId: row.orderId,
      eventId: row.eventId,
      memo: { disputeId: row.id },
      postings: lines.map(
        (l) =>
          ({ account: l.account, amountMinor: -Number(l.amount_minor), currency: l.currency }) as Posting,
      ),
    });
  }
  return { row: updated, changed: true };
}

export const DisputeDto = z.object({
  id: z.uuid(),
  /** The provider's dispute id (staff submit evidence against it). */
  providerDisputeId: z.string(),
  orderId: z.uuid(),
  eventId: z.uuid(),
  fundsFlow: z.enum(['organizer_mor', 'platform_mor']),
  status: z.enum(DISPUTE_STATUSES),
  reason: z.string(),
  amountMinor: z.int(),
  currency: z.string(),
  evidenceDueBy: z.date().nullable(),
  evidenceSubmittedAt: z.date().nullable(),
  createdAt: z.date(),
  closedAt: z.date().nullable(),
});
const present = (r: Row) => DisputeDto.parse({ ...r, fundsFlow: r.fundsFlow as FundsFlow, status: r.status });

/** Disputes of the org, or of one order (finance and staff). */
export const disputesQuery = tenantQuery({
  name: 'payments.disputes',
  input: z.object({ orderId: z.uuid().optional() }),
  output: z.array(DisputeDto),
  entitlement: null,
  permission: 'finance:read',
  handler: async ({ input, tx }) =>
    (
      await tx
        .select()
        .from(disputes)
        .where(input.orderId ? eq(disputes.orderId, input.orderId) : undefined)
        .orderBy(desc(disputes.createdAt))
        .limit(200)
    ).map(present),
});

/** Look up one dispute for evidence (the reports module builds the packet). */
export async function disputeTx(tx: TenantTx, id: string): Promise<z.infer<typeof DisputeDto> | null> {
  const [r] = await tx.select().from(disputes).where(eq(disputes.id, id));
  return r ? present(r) : null;
}

/**
 * Staff reviewed the evidence packet and the provider accepted it (platform_mor: Yayatoh is the
 * merchant, so staff submit; a human always reviews first).
 */
export const markEvidenceSubmittedCommand = tenantCommand({
  name: 'payments.markEvidenceSubmitted',
  input: z.object({ disputeId: z.uuid() }),
  output: DisputeDto,
  entitlement: null,
  permission: 'platform:disputes.submit',
  handler: async ({ input, ctx, tx }) => {
    const [r] = await tx.select().from(disputes).where(eq(disputes.id, input.disputeId)).for('update');
    if (!r) throw new DomainError('not_found', 'Dispute not found');
    if (r.status !== 'open') throw new DomainError('invalid_state', 'This dispute is not open');
    const [u] = await tx
      .update(disputes)
      .set({
        status: 'evidence_submitted',
        evidenceSubmittedAt: ctx.now,
        evidenceSubmittedBy: actorId(ctx.actor),
        updatedAt: ctx.now,
      })
      .where(eq(disputes.id, r.id))
      .returning();
    if (!u) throw new DomainError('internal');
    return present(u);
  },
  audit: (input) => ({
    action: 'dispute.evidence_submitted',
    targetType: 'dispute',
    targetId: input.disputeId,
  }),
});
