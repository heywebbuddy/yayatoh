import { normalizeEmail } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, type DomainEvent, DomainError, requireOrg } from '@yayatoh/kernel';
import { signLinkToken, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { decideTransfer, type TransferRefusal, transferDeadline } from './domain/transfer-rules.ts';
import { holderLinks, ticketClaims, tickets, ticketTransfers, ticketTypes } from './schema.ts';

export const TRANSFER_CLAIM_PURPOSE = 'ticket-claim';
/** How long a transfer's claim link stays open (pending owner): a week, never past the event's end. */
export const TRANSFER_CLAIM_DAYS = 7;

const Email = z.email().max(254);
const PersonName = z.string().trim().min(1).max(120);
type Emit = (e: DomainEvent) => void;

const actorName = (ctx: Ctx) =>
  ctx.actor.type === 'user'
    ? `user:${ctx.actor.userId}`
    : ctx.actor.type === 'system'
      ? ctx.actor.name
      : 'holder';

export const TRANSFER_STATES = ['pending', 'claimed', 'cancelled', 'expired'] as const;

export const TransferDto = z.object({
  id: z.uuid(),
  ticketId: z.uuid(),
  ticketSerial: z.int(),
  state: z.enum(TRANSFER_STATES),
  initiatedBy: z.enum(['organizer', 'holder']),
  fromName: z.string(),
  fromEmail: z.string(),
  toName: z.string(),
  toEmail: z.string(),
  feeMinor: z.int(),
  currency: z.string(),
  createdAt: z.date(),
  expiresAt: z.date(),
  claimedAt: z.date().nullable(),
  cancelledAt: z.date().nullable(),
});
export type TransferDto = z.infer<typeof TransferDto>;

export const StartedTransferDto = z.object({
  transferId: z.uuid(),
  claimId: z.uuid(),
  /** The claim link token: shown once to whoever started the transfer (and emailed to the recipient). */
  token: z.string(),
  feeMinor: z.int(),
});

function refuse(reason: TransferRefusal, deadline?: Date): never {
  const messages: Record<TransferRefusal, string> = {
    ticket_void: 'This ticket is no longer valid',
    event_ended: 'The event has ended',
    not_allowed: 'This ticket cannot be transferred',
    deadline_passed: 'Transfers for this ticket have closed',
  };
  throw new DomainError('invalid_state', messages[reason], {
    reason,
    ...(deadline ? { deadline: deadline.toISOString() } : {}),
  });
}

async function ticketForTransferTx(tx: TenantTx, ticketId: string) {
  const [t] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).for('update');
  if (!t) return null;
  const [rules] = await tx
    .select({
      transfersAllowed: ticketTypes.transfersAllowed,
      transferCutoffHours: ticketTypes.transferCutoffHours,
      transferFeeMinor: ticketTypes.transferFeeMinor,
      currency: ticketTypes.currency,
    })
    .from(ticketTypes)
    .where(eq(ticketTypes.id, t.ticketTypeId));
  return rules ? { t, ...rules } : null;
}

/**
 * Start a transfer (M3.10c): check the ticket type's rules, open a claim link for the recipient
 * (replacing any open one, and cancelling a pending transfer of the same ticket) and record the
 * transfer. The ticket stays with its holder until the recipient claims it. Used by the organizer
 * command, the holder command and support macros.
 */
export async function startTransferTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  input: {
    ticketId: string;
    toName: string;
    toEmail: string;
    by: 'organizer' | 'holder';
    /** Holder transfers: the holder agreed to the fee shown to them. */
    acceptFee?: boolean;
    /** Organizer transfers from an order page: the ticket must belong to it. */
    orderId?: string;
  },
): Promise<z.infer<typeof StartedTransferDto>> {
  const orgId = requireOrg(ctx);
  const row = await ticketForTransferTx(tx, input.ticketId);
  if (!row || (input.orderId && row.t.orderId !== input.orderId))
    throw new DomainError('not_found', 'Ticket not found');
  const ev = await findEventTx(tx, row.t.eventId);
  if (!ev) throw new DomainError('not_found', 'Event not found');
  const decision = decideTransfer(row, {
    now: ctx.now,
    startsAt: ev.startsAt,
    endsAt: ev.endsAt,
    ticketActive: row.t.status === 'active',
    by: input.by,
  });
  if (!decision.ok) refuse(decision.reason, decision.deadline);
  const toEmail = normalizeEmail(input.toEmail);
  if (toEmail === normalizeEmail(row.t.holderEmail))
    throw new DomainError('validation_failed', 'This person already holds the ticket', {
      reason: 'same_holder',
      field: 'toEmail',
    });
  if (decision.feeMinor > 0 && !input.acceptFee)
    throw new DomainError('validation_failed', 'Agree to the transfer fee', {
      reason: 'fee_not_accepted',
      field: 'acceptFee',
    });
  await cancelPendingTransfersTx(tx, ctx, [row.t.id]);
  await tx
    .update(ticketClaims)
    .set({ revokedAt: ctx.now, updatedAt: ctx.now })
    .where(
      and(eq(ticketClaims.ticketId, row.t.id), isNull(ticketClaims.claimedAt), isNull(ticketClaims.revokedAt)),
    );
  const expiresAt = new Date(Math.min(ctx.now.getTime() + TRANSFER_CLAIM_DAYS * 86_400_000, ev.endsAt.getTime()));
  const [claim] = await tx
    .insert(ticketClaims)
    .values({ orgId, ticketId: row.t.id, recipientEmail: toEmail, expiresAt, createdBy: actorName(ctx) })
    .returning({ id: ticketClaims.id });
  if (!claim) throw new DomainError('internal');
  const [transfer] = await tx
    .insert(ticketTransfers)
    .values({
      orgId,
      ticketId: row.t.id,
      eventId: row.t.eventId,
      orderId: row.t.orderId,
      claimId: claim.id,
      initiatedBy: input.by,
      fromName: row.t.holderName,
      fromEmail: row.t.holderEmail,
      toName: input.toName.trim(),
      toEmail,
      feeMinor: decision.feeMinor,
      currency: row.currency,
      createdBy: actorName(ctx),
      fromRev: row.t.rev,
    })
    .returning({ id: ticketTransfers.id });
  if (!transfer) throw new DomainError('internal');
  emit({
    type: 'ticket.transfer_offered',
    version: 1,
    aggregateType: 'ticket',
    aggregateId: row.t.id,
    payload: { orgId, transferId: transfer.id, ticketId: row.t.id, eventId: row.t.eventId },
  });
  return {
    transferId: transfer.id,
    claimId: claim.id,
    token: signLinkToken(TRANSFER_CLAIM_PURPOSE, claim.id),
    feeMinor: decision.feeMinor,
  };
}

/** Cancel the pending transfers of some tickets (a new claim link or transfer replaces them). */
export async function cancelPendingTransfersTx(tx: TenantTx, ctx: Ctx, ticketIds: readonly string[]) {
  if (ticketIds.length === 0) return;
  await tx
    .update(ticketTransfers)
    .set({ status: 'cancelled', cancelledAt: ctx.now, updatedAt: ctx.now })
    .where(and(inArray(ticketTransfers.ticketId, [...ticketIds]), eq(ticketTransfers.status, 'pending')));
}

/** The pending transfer behind a claim link, locked (null for a plain claim link). */
export async function transferForClaimTx(tx: TenantTx, claimId: string) {
  const [row] = await tx
    .select()
    .from(ticketTransfers)
    .where(eq(ticketTransfers.claimId, claimId))
    .for('update');
  return row ?? null;
}

/**
 * The recipient claimed (inside `ticketing.claimTicket`, after the ticket was reissued to them):
 * the transfer is done, exactly once.
 */
export async function completeTransferTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  transferId: string,
  toRev: number,
): Promise<void> {
  const [u] = await tx
    .update(ticketTransfers)
    .set({ status: 'claimed', claimedAt: ctx.now, toRev, updatedAt: ctx.now })
    .where(and(eq(ticketTransfers.id, transferId), eq(ticketTransfers.status, 'pending')))
    .returning();
  if (!u) throw new DomainError('invalid_state', 'This transfer is no longer open', { state: 'revoked' });
  emit({
    type: 'ticket.transferred',
    version: 1,
    aggregateType: 'ticket',
    aggregateId: u.ticketId,
    payload: { orgId: u.orgId, transferId: u.id, ticketId: u.ticketId, eventId: u.eventId, rev: toRev },
  });
}

async function cancelTransferTx(tx: TenantTx, ctx: Ctx, emit: Emit, transferId: string, holderEmail?: string) {
  const [t] = await tx.select().from(ticketTransfers).where(eq(ticketTransfers.id, transferId)).for('update');
  if (!t || (holderEmail && normalizeEmail(t.fromEmail) !== holderEmail))
    throw new DomainError('not_found', 'Transfer not found');
  if (t.status !== 'pending')
    throw new DomainError('invalid_state', 'This transfer is no longer pending', { reason: t.status });
  await tx
    .update(ticketTransfers)
    .set({ status: 'cancelled', cancelledAt: ctx.now, updatedAt: ctx.now })
    .where(eq(ticketTransfers.id, t.id));
  await tx
    .update(ticketClaims)
    .set({ revokedAt: ctx.now, updatedAt: ctx.now })
    .where(and(eq(ticketClaims.id, t.claimId), isNull(ticketClaims.claimedAt), isNull(ticketClaims.revokedAt)));
  emit({
    type: 'ticket.transfer_cancelled',
    version: 1,
    aggregateType: 'ticket',
    aggregateId: t.ticketId,
    payload: { orgId: t.orgId, transferId: t.id, ticketId: t.ticketId, eventId: t.eventId },
  });
  return t;
}

const TransferInput = z.object({ toName: PersonName, toEmail: Email });

/** Organizer (order page): transfer one of the order's tickets to someone else. */
export const startTransferCommand = tenantCommand({
  name: 'ticketing.startTransfer',
  input: TransferInput.extend({ orderId: z.uuid(), ticketId: z.uuid() }),
  output: StartedTransferDto,
  entitlement: 'ticketing',
  permission: 'orders:support',
  handler: ({ input, ctx, tx, emit }) =>
    startTransferTx(tx, ctx, emit, {
      ticketId: input.ticketId,
      orderId: input.orderId,
      toName: input.toName,
      toEmail: input.toEmail,
      by: 'organizer',
    }),
  audit: (input, r) => ({
    action: 'ticket.transfer_start',
    targetType: 'ticket',
    targetId: input.ticketId,
    data: { transferId: r.transferId, by: 'organizer' },
  }),
});

/** Organizer: cancel a pending transfer (the claim link stops working). */
export const cancelTransferCommand = tenantCommand({
  name: 'ticketing.cancelTransfer',
  input: z.object({ transferId: z.uuid() }),
  output: z.object({ ok: z.boolean() }),
  entitlement: 'ticketing',
  permission: 'orders:support',
  handler: async ({ input, ctx, tx, emit }) => {
    await cancelTransferTx(tx, ctx, emit, input.transferId);
    return { ok: true };
  },
  audit: (input) => ({ action: 'ticket.transfer_cancel', targetType: 'ticket_transfer', targetId: input.transferId }),
});

async function liveHolderLinkTx(tx: TenantTx, ctx: Ctx, linkId: string) {
  const [l] = await tx.select().from(holderLinks).where(eq(holderLinks.id, linkId));
  if (!l || l.expiresAt <= ctx.now) throw new DomainError('not_found', 'This link has expired');
  return l;
}

/** Holder (their tickets page): transfer one of their tickets by name and email. */
export const startHolderTransferCommand = tenantCommand({
  name: 'ticketing.startHolderTransfer',
  input: TransferInput.extend({ linkId: z.uuid(), ticketId: z.uuid(), acceptFee: z.boolean().default(false) }),
  output: StartedTransferDto,
  entitlement: 'ticketing',
  permission: 'public:holder',
  handler: async ({ input, ctx, tx, emit }) => {
    const l = await liveHolderLinkTx(tx, ctx, input.linkId);
    const [t] = await tx
      .select({ id: tickets.id })
      .from(tickets)
      .where(
        and(
          eq(tickets.id, input.ticketId),
          eq(tickets.eventId, l.eventId),
          eq(sql`lower(${tickets.holderEmail})`, l.emailNorm),
        ),
      );
    if (!t) throw new DomainError('not_found', 'Ticket not found');
    return startTransferTx(tx, ctx, emit, {
      ticketId: t.id,
      toName: input.toName,
      toEmail: input.toEmail,
      acceptFee: input.acceptFee,
      by: 'holder',
    });
  },
  audit: (input, r) => ({
    action: 'ticket.transfer_start',
    targetType: 'ticket',
    targetId: input.ticketId,
    data: { transferId: r.transferId, by: 'holder', feeMinor: r.feeMinor },
  }),
});

/** Holder: cancel their pending transfer before it is claimed. */
export const cancelHolderTransferCommand = tenantCommand({
  name: 'ticketing.cancelHolderTransfer',
  input: z.object({ linkId: z.uuid(), transferId: z.uuid() }),
  output: z.object({ ok: z.boolean() }),
  entitlement: 'ticketing',
  permission: 'public:holder',
  handler: async ({ input, ctx, tx, emit }) => {
    const l = await liveHolderLinkTx(tx, ctx, input.linkId);
    await cancelTransferTx(tx, ctx, emit, input.transferId, l.emailNorm);
    return { ok: true };
  },
  audit: (input) => ({ action: 'ticket.transfer_cancel', targetType: 'ticket_transfer', targetId: input.transferId }),
});

function stateOf(
  t: { status: string },
  claim: { expiresAt: Date; revokedAt: Date | null },
  ticketActive: boolean,
  now: Date,
): (typeof TRANSFER_STATES)[number] {
  if (t.status === 'claimed') return 'claimed';
  if (t.status === 'cancelled' || claim.revokedAt || !ticketActive) return 'cancelled';
  return claim.expiresAt <= now ? 'expired' : 'pending';
}

async function transfersWhereTx(tx: TenantTx, now: Date, where: ReturnType<typeof eq>): Promise<TransferDto[]> {
  const rows = await tx
    .select({
      t: ticketTransfers,
      serial: tickets.serial,
      ticketStatus: tickets.status,
      expiresAt: ticketClaims.expiresAt,
      revokedAt: ticketClaims.revokedAt,
    })
    .from(ticketTransfers)
    .innerJoin(tickets, eq(tickets.id, ticketTransfers.ticketId))
    .innerJoin(ticketClaims, eq(ticketClaims.id, ticketTransfers.claimId))
    .where(where)
    .orderBy(desc(ticketTransfers.createdAt))
    .limit(200);
  return rows.map(({ t, serial, ticketStatus, expiresAt, revokedAt }) => ({
    id: t.id,
    ticketId: t.ticketId,
    ticketSerial: serial,
    state: stateOf(t, { expiresAt, revokedAt }, ticketStatus === 'active', now),
    initiatedBy: t.initiatedBy as 'organizer' | 'holder',
    fromName: t.fromName,
    fromEmail: t.fromEmail,
    toName: t.toName,
    toEmail: t.toEmail,
    feeMinor: t.feeMinor,
    currency: t.currency,
    createdAt: t.createdAt,
    expiresAt,
    claimedAt: t.claimedAt,
    cancelledAt: t.cancelledAt ?? (t.status === 'pending' && revokedAt ? revokedAt : null),
  }));
}

/** The transfers of an order's tickets, newest first (order page and timeline). */
export const orderTransfersQuery = tenantQuery({
  name: 'ticketing.orderTransfers',
  input: z.object({ orderId: z.uuid() }),
  output: z.array(TransferDto),
  entitlement: 'ticketing',
  permission: 'orders:read',
  handler: ({ input, ctx, tx }) => transfersWhereTx(tx, ctx.now, eq(ticketTransfers.orderId, input.orderId)),
});

/** Transfers of an order for other modules (timeline, dispute evidence). */
export const transfersForOrderTx = (tx: TenantTx, orderId: string, now: Date) =>
  transfersWhereTx(tx, now, eq(ticketTransfers.orderId, orderId));

/** What a holder may do with a ticket (their tickets page): transfer, until when, for what fee. */
export async function holderTransferOptionsTx(
  tx: TenantTx,
  now: Date,
  ticketIds: readonly string[],
  event: { startsAt: Date; endsAt: Date },
) {
  if (ticketIds.length === 0) return new Map();
  const rows = await tx
    .select({
      id: tickets.id,
      status: tickets.status,
      transfersAllowed: ticketTypes.transfersAllowed,
      transferCutoffHours: ticketTypes.transferCutoffHours,
      transferFeeMinor: ticketTypes.transferFeeMinor,
      currency: ticketTypes.currency,
    })
    .from(tickets)
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
    .where(inArray(tickets.id, [...ticketIds]));
  const pending = await tx
    .select({ id: ticketTransfers.id, ticketId: ticketTransfers.ticketId, toName: ticketTransfers.toName })
    .from(ticketTransfers)
    .innerJoin(ticketClaims, eq(ticketClaims.id, ticketTransfers.claimId))
    .where(
      and(
        inArray(ticketTransfers.ticketId, [...ticketIds]),
        eq(ticketTransfers.status, 'pending'),
        isNull(ticketClaims.revokedAt),
        gt(ticketClaims.expiresAt, now),
      ),
    );
  const open = new Map(pending.map((p) => [p.ticketId, p]));
  return new Map(
    rows.map((r) => {
      const d = decideTransfer(r, {
        now,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        ticketActive: r.status === 'active',
        by: 'holder',
      });
      const p = open.get(r.id);
      return [
        r.id,
        {
          allowed: d.ok,
          reason: d.ok ? null : d.reason,
          feeMinor: r.transferFeeMinor,
          currency: r.currency,
          deadline: transferDeadline(r, event.startsAt),
          pendingTransferId: p?.id ?? null,
          pendingTransferTo: p?.toName ?? null,
        },
      ] as const;
    }),
  );
}
