import { normalizeEmail } from '@yayatoh/crm';
import { type TenantTx, withoutTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { signLinkToken, tenantCommand, tenantQuery, verifyLinkToken } from '@yayatoh/platform';
import { and, asc, count, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { reissueTicketTx } from './issue.ts';
import {
  holderLinks,
  ticketBarcodes,
  ticketClaims,
  tickets,
  ticketTransfers,
  ticketTypes,
} from './schema.ts';
import {
  cancelPendingTransfersTx,
  completeTransferTx,
  holderTransferOptionsTx,
  transferForClaimTx,
} from './transfers.ts';
import { rotateWalletPassTx } from './wallet.ts';

export const CLAIM_PURPOSE = 'ticket-claim';
export const HOLDER_PURPOSE = 'ticket-holder';
const HOLDER_LINK_TTL_MS = 7 * 24 * 3_600_000;
/** Magic links per email per event per hour (the rest are silently dropped). */
const HOLDER_LINKS_PER_HOUR = 3;
const Email = z.email().max(254);
const PersonName = z.string().trim().min(1).max(120);

const actorName = (ctx: Ctx) =>
  ctx.actor.type === 'user'
    ? `user:${ctx.actor.userId}`
    : ctx.actor.type === 'system'
      ? ctx.actor.name
      : 'holder';

/** Resolve a signed link token to a context for its org (before any tenant is known). */
async function linkContext(purpose: string, fn: 'claim_org' | 'holder_link_org', token: string) {
  const id = verifyLinkToken(purpose, token);
  if (!id) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string }>(sql`select org_id from ${sql.raw(`ticketing.${fn}`)}(${id}::uuid)`),
  );
  const orgId = rows[0]?.org_id;
  return orgId ? { id, ctx: createCtx({ orgId }) } : null;
}

export const claimContext = (token: string) => linkContext(CLAIM_PURPOSE, 'claim_org', token);
export const holderContext = (token: string) => linkContext(HOLDER_PURPOSE, 'holder_link_org', token);

type Tx = Parameters<Parameters<typeof withoutTenant>[0]>[0];

/** Open a claim link for each ticket (replacing any open one). Emits the mail event when addressed. */
async function openClaimsTx(
  tx: Tx,
  ctx: Ctx,
  ticketIds: readonly string[],
  opts: { recipientEmail: string | null; expiresInDays: number },
  emit: (e: {
    type: string;
    version: number;
    aggregateType: string;
    aggregateId: string;
    payload: unknown;
  }) => void,
) {
  const orgId = requireOrg(ctx);
  // M3.10c: a new claim link replaces a pending transfer of the ticket too.
  await cancelPendingTransfersTx(tx, ctx, ticketIds);
  await tx
    .update(ticketClaims)
    .set({ revokedAt: ctx.now, updatedAt: ctx.now })
    .where(
      and(
        inArray(ticketClaims.ticketId, [...ticketIds]),
        isNull(ticketClaims.claimedAt),
        isNull(ticketClaims.revokedAt),
      ),
    );
  const rows = await tx
    .insert(ticketClaims)
    .values(
      ticketIds.map((ticketId) => ({
        orgId,
        ticketId,
        recipientEmail: opts.recipientEmail,
        expiresAt: new Date(ctx.now.getTime() + opts.expiresInDays * 86_400_000),
        createdBy: actorName(ctx),
      })),
    )
    .returning({ id: ticketClaims.id, ticketId: ticketClaims.ticketId });
  for (const r of rows)
    if (opts.recipientEmail)
      emit({
        type: 'ticket.claim_link_created',
        version: 1,
        aggregateType: 'ticket',
        aggregateId: r.ticketId,
        payload: { orgId, claimId: r.id, ticketId: r.ticketId, email: opts.recipientEmail },
      });
  return rows.map((r) => ({
    ticketId: r.ticketId,
    claimId: r.id,
    token: signLinkToken(CLAIM_PURPOSE, r.id),
  }));
}

const ClaimLinkDto = z.object({ ticketId: z.uuid(), claimId: z.uuid(), token: z.string() });

/** Organizer: claim links for tickets of one event (shown once; optionally emailed). */
export const createClaimLinksCommand = tenantCommand({
  name: 'ticketing.createClaimLinks',
  input: z.object({
    eventId: z.uuid(),
    ticketIds: z.array(z.uuid()).min(1).max(100),
    recipientEmail: Email.optional(),
    expiresInDays: z.int().min(1).max(90).default(30),
  }),
  output: z.array(ClaimLinkDto),
  entitlement: 'ticketing',
  permission: 'attendees:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const ids = [...new Set(input.ticketIds)];
    const found = await tx
      .select({ id: tickets.id })
      .from(tickets)
      .where(and(eq(tickets.eventId, input.eventId), inArray(tickets.id, ids), eq(tickets.status, 'active')));
    if (found.length !== ids.length) throw new DomainError('not_found', 'Ticket not found');
    return openClaimsTx(
      tx,
      ctx,
      ids,
      { recipientEmail: input.recipientEmail ?? null, expiresInDays: input.expiresInDays },
      emit,
    );
  },
  audit: (input) => ({
    action: 'ticket.claim_links',
    targetType: 'event',
    targetId: input.eventId,
    data: { tickets: input.ticketIds.length, emailed: Boolean(input.recipientEmail) },
  }),
});

export const revokeClaimLinkCommand = tenantCommand({
  name: 'ticketing.revokeClaimLink',
  input: z.object({ eventId: z.uuid(), claimId: z.uuid() }),
  output: z.object({ ok: z.boolean() }),
  entitlement: 'ticketing',
  permission: 'attendees:write',
  handler: async ({ input, ctx, tx }) => {
    const rows = await tx
      .update(ticketClaims)
      .set({ revokedAt: ctx.now, updatedAt: ctx.now })
      .where(
        and(
          eq(ticketClaims.id, input.claimId),
          isNull(ticketClaims.claimedAt),
          isNull(ticketClaims.revokedAt),
          sql`${ticketClaims.ticketId} in (select id from ticketing.tickets where event_id = ${input.eventId})`,
        ),
      )
      .returning({ id: ticketClaims.id, ticketId: ticketClaims.ticketId });
    if (rows.length === 0) throw new DomainError('not_found', 'No open claim link');
    // M3.10c: withdrawing a transfer's link cancels the transfer.
    const transfer = await transferForClaimTx(tx, input.claimId);
    if (transfer?.status === 'pending') await cancelPendingTransfersTx(tx, ctx, [transfer.ticketId]);
    return { ok: true };
  },
  audit: (input) => ({ action: 'ticket.claim_revoke', targetType: 'ticket_claim', targetId: input.claimId }),
});

const claimState = (c: { claimedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now: Date) =>
  c.claimedAt ? 'claimed' : c.revokedAt ? 'revoked' : c.expiresAt <= now ? 'expired' : 'open';

export const TicketClaimDto = z.object({
  id: z.uuid(),
  ticketId: z.uuid(),
  state: z.enum(['open', 'claimed', 'revoked', 'expired']),
  recipientEmail: z.string().nullable(),
  claimedByEmail: z.string().nullable(),
  createdAt: z.date(),
  expiresAt: z.date(),
});

/** Organizer: the claim links of some tickets (the attendee profile shows its ticket's). */
export const listClaimLinksQuery = tenantQuery({
  name: 'ticketing.listClaimLinks',
  input: z.object({ eventId: z.uuid(), ticketIds: z.array(z.uuid()).min(1).max(500) }),
  output: z.array(TicketClaimDto),
  entitlement: 'ticketing',
  permission: 'attendees:read',
  handler: async ({ input, ctx, tx }) => {
    const rows = await tx
      .select({ c: ticketClaims })
      .from(ticketClaims)
      .innerJoin(tickets, eq(tickets.id, ticketClaims.ticketId))
      .where(and(eq(tickets.eventId, input.eventId), inArray(ticketClaims.ticketId, input.ticketIds)))
      .orderBy(desc(ticketClaims.createdAt))
      .limit(200);
    return rows.map(({ c }) => ({
      id: c.id,
      ticketId: c.ticketId,
      state: claimState(c, ctx.now),
      recipientEmail: c.recipientEmail,
      claimedByEmail: c.claimedByEmail,
      createdAt: c.createdAt,
      expiresAt: c.expiresAt,
    }));
  },
});

export const PublicClaimDto = z.object({
  state: z.enum(['open', 'claimed', 'revoked', 'expired']),
  event: z.object({ name: z.string(), startsAt: z.date(), endsAt: z.date(), timezone: z.string() }),
  ticketTypeName: z.string(),
  /**
   * M3.10c: a transfer's link names who sent it and who it is for (the recipient confirms with the
   * email address it was sent to). Null for a plain claim link.
   */
  transfer: z.object({ fromName: z.string(), toName: z.string() }).nullable().default(null),
});

/** Public: what a claim link offers (no holder details, no codes). */
export const claimDetailsQuery = tenantQuery({
  name: 'ticketing.claimDetails',
  input: z.object({ claimId: z.uuid() }),
  output: PublicClaimDto,
  entitlement: 'ticketing',
  permission: 'public:claim',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .select({
        c: ticketClaims,
        eventId: tickets.eventId,
        typeName: ticketTypes.name,
        status: tickets.status,
      })
      .from(ticketClaims)
      .innerJoin(tickets, eq(tickets.id, ticketClaims.ticketId))
      .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
      .where(eq(ticketClaims.id, input.claimId));
    if (!row) throw new DomainError('not_found');
    const ev = await findEventTx(tx, row.eventId);
    if (!ev) throw new DomainError('not_found');
    const state = row.status === 'active' ? claimState(row.c, ctx.now) : 'revoked';
    const [transfer] = await tx
      .select({ fromName: ticketTransfers.fromName, toName: ticketTransfers.toName })
      .from(ticketTransfers)
      .where(eq(ticketTransfers.claimId, row.c.id));
    return {
      state,
      event: { name: ev.name, startsAt: ev.startsAt, endsAt: ev.endsAt, timezone: ev.timezone },
      ticketTypeName: row.typeName,
      transfer: transfer ?? null,
    };
  },
});

async function createHolderLinkTx(
  tx: Tx,
  ctx: Ctx,
  eventId: string,
  email: string,
): Promise<{ id: string; token: string } | null> {
  const emailNorm = normalizeEmail(email);
  const [recent] = await tx
    .select({ n: count() })
    .from(holderLinks)
    .where(
      and(
        eq(holderLinks.eventId, eventId),
        eq(holderLinks.emailNorm, emailNorm),
        gte(holderLinks.createdAt, new Date(ctx.now.getTime() - 3_600_000)),
      ),
    );
  if ((recent?.n ?? 0) >= HOLDER_LINKS_PER_HOUR) return null;
  return issueHolderLinkTx(tx, ctx, eventId, email);
}

/**
 * A holder link the organizer sends (resend tickets, M1.8f): the public request limit does not
 * apply, since the organizer, not an anonymous visitor, asked for it.
 */
export async function issueHolderLinkTx(
  tx: Tx,
  ctx: Ctx,
  eventId: string,
  email: string,
): Promise<{ id: string; token: string }> {
  const [link] = await tx
    .insert(holderLinks)
    .values({
      orgId: requireOrg(ctx),
      eventId,
      emailNorm: normalizeEmail(email),
      expiresAt: new Date(ctx.now.getTime() + HOLDER_LINK_TTL_MS),
    })
    .returning({ id: holderLinks.id });
  if (!link) throw new DomainError('internal');
  return { id: link.id, token: signLinkToken(HOLDER_PURPOSE, link.id) };
}

/**
 * Public: claim a ticket with a name and email. The ticket is reissued to the claimant (the old
 * QR stops scanning) and they get a holder link straight away, so they see their new ticket.
 */
export const claimTicketCommand = tenantCommand({
  name: 'ticketing.claimTicket',
  input: z.object({ claimId: z.uuid(), name: PersonName, email: Email }),
  output: z.object({ holderToken: z.string().nullable() }),
  entitlement: 'ticketing',
  permission: 'public:claim',
  handler: async ({ input, ctx, tx, emit }) => {
    const [c] = await tx.select().from(ticketClaims).where(eq(ticketClaims.id, input.claimId)).for('update');
    if (!c) throw new DomainError('not_found');
    const state = claimState(c, ctx.now);
    if (state !== 'open') throw new DomainError('invalid_state', `This link is ${state}`, { state });
    // M3.10c: a transfer is claimed by the person it was sent to, with that email address.
    const transfer = await transferForClaimTx(tx, c.id);
    if (transfer && transfer.status !== 'pending')
      throw new DomainError('invalid_state', 'This link is revoked', { state: 'revoked' });
    if (transfer && normalizeEmail(input.email) !== transfer.toEmail)
      throw new DomainError('validation_failed', 'Use the email address this ticket was sent to', {
        reason: 'email_mismatch',
        field: 'email',
      });
    const t = await reissueTicketTx(tx, ctx, c.ticketId, { name: input.name, email: input.email });
    await tx
      .update(ticketClaims)
      .set({ claimedAt: ctx.now, claimedByEmail: input.email, updatedAt: ctx.now })
      .where(eq(ticketClaims.id, c.id));
    if (transfer) {
      await completeTransferTx(tx, ctx, emit, transfer.id, t.rev);
      await rotateWalletPassTx(tx, ctx, { id: t.id, rev: t.rev, holderName: input.name });
    }
    const [ticket] = await tx.select({ eventId: tickets.eventId }).from(tickets).where(eq(tickets.id, t.id));
    const orgId = requireOrg(ctx);
    emit({
      type: 'ticket.claimed',
      version: 1,
      aggregateType: 'ticket',
      aggregateId: t.id,
      payload: { orgId, ticketId: t.id, claimId: c.id, rev: t.rev, eventId: ticket?.eventId ?? null },
    });
    const link = ticket ? await createHolderLinkTx(tx, ctx, ticket.eventId, input.email) : null;
    return { holderToken: link?.token ?? null };
  },
  audit: (input) => ({ action: 'ticket.claim', targetType: 'ticket_claim', targetId: input.claimId }),
});

/**
 * Public: email me a link to my tickets for this event. The answer never reveals whether the
 * email has tickets; links are rate-limited per email and event.
 */
export const requestHolderLinkCommand = tenantCommand({
  name: 'ticketing.requestHolderLink',
  input: z.object({ eventId: z.uuid(), email: Email }),
  output: z.object({ ok: z.boolean() }),
  entitlement: 'ticketing',
  permission: 'public:holder',
  handler: async ({ input, ctx, tx, emit }) => {
    const [has] = await tx
      .select({ n: count() })
      .from(tickets)
      .where(
        and(
          eq(tickets.eventId, input.eventId),
          eq(tickets.status, 'active'),
          eq(sql`lower(${tickets.holderEmail})`, normalizeEmail(input.email)),
        ),
      );
    if (!has?.n) return { ok: true };
    const link = await createHolderLinkTx(tx, ctx, input.eventId, input.email);
    if (link)
      emit({
        type: 'ticket.holder_link_created',
        version: 1,
        aggregateType: 'holder_link',
        aggregateId: link.id,
        payload: { orgId: requireOrg(ctx), linkId: link.id, eventId: input.eventId, email: input.email },
      });
    return { ok: true };
  },
});

export const HolderTicketsDto = z.object({
  event: z.object({
    id: z.uuid(),
    name: z.string(),
    startsAt: z.date(),
    endsAt: z.date(),
    timezone: z.string(),
  }),
  email: z.string(),
  tickets: z.array(
    z.object({
      id: z.uuid(),
      serial: z.int(),
      shortCode: z.string(),
      holderName: z.string(),
      typeName: z.string(),
      code: z.string(),
      /** An open claim link for this ticket is waiting to be claimed. */
      pendingTransfer: z.boolean(),
      /** M3.10c: whether and how this holder may transfer the ticket. */
      transfer: z
        .object({
          allowed: z.boolean(),
          reason: z.enum(['ticket_void', 'event_ended', 'not_allowed', 'deadline_passed']).nullable(),
          feeMinor: z.int(),
          currency: z.string(),
          deadline: z.date(),
          pendingTransferId: z.uuid().nullable(),
          pendingTransferTo: z.string().nullable(),
        })
        .nullable()
        .default(null),
    }),
  ),
});

async function liveHolderLink(tx: Tx, ctx: Ctx, linkId: string) {
  const [l] = await tx.select().from(holderLinks).where(eq(holderLinks.id, linkId));
  if (!l || l.expiresAt <= ctx.now) throw new DomainError('not_found', 'This link has expired');
  return l;
}

/** Public (holder link): my active tickets for the event, with their current codes. */
export const holderTicketsQuery = tenantQuery({
  name: 'ticketing.holderTickets',
  input: z.object({ linkId: z.uuid() }),
  output: HolderTicketsDto,
  entitlement: 'ticketing',
  permission: 'public:holder',
  handler: async ({ input, ctx, tx }) => {
    const l = await liveHolderLink(tx, ctx, input.linkId);
    const ev = await findEventTx(tx, l.eventId);
    if (!ev) throw new DomainError('not_found');
    const rows = await tx
      .select({
        id: tickets.id,
        serial: tickets.serial,
        shortCode: tickets.shortCode,
        holderName: tickets.holderName,
        typeName: ticketTypes.name,
        code: ticketBarcodes.payload,
      })
      .from(tickets)
      .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
      .innerJoin(
        ticketBarcodes,
        and(
          eq(ticketBarcodes.ticketId, tickets.id),
          // The signed yy1 code: a migrated ticket also keeps its legacy QR payload (scan-only).
          eq(ticketBarcodes.format, 'yy1'),
          eq(ticketBarcodes.active, true),
          eq(ticketBarcodes.rev, tickets.rev),
        ),
      )
      .where(
        and(
          eq(tickets.eventId, l.eventId),
          eq(tickets.status, 'active'),
          eq(sql`lower(${tickets.holderEmail})`, l.emailNorm),
        ),
      )
      .orderBy(asc(tickets.serial));
    const open = rows.length
      ? new Set(
          (
            await tx
              .select({ ticketId: ticketClaims.ticketId })
              .from(ticketClaims)
              .where(
                and(
                  inArray(
                    ticketClaims.ticketId,
                    rows.map((r) => r.id),
                  ),
                  isNull(ticketClaims.claimedAt),
                  isNull(ticketClaims.revokedAt),
                  gte(ticketClaims.expiresAt, ctx.now),
                ),
              )
          ).map((r) => r.ticketId),
        )
      : new Set<string>();
    const options = await holderTransferOptionsTx(
      tx,
      ctx.now,
      rows.map((r) => r.id),
      ev,
    );
    return {
      event: { id: ev.id, name: ev.name, startsAt: ev.startsAt, endsAt: ev.endsAt, timezone: ev.timezone },
      email: l.emailNorm,
      tickets: rows.map((r) => ({
        ...r,
        pendingTransfer: open.has(r.id),
        transfer: options.get(r.id) ?? null,
      })),
    };
  },
});

/**
 * Public (holder link): pass one of my tickets to someone else. Returns a claim link (and emails
 * it when an address is given); the ticket stays mine until it is claimed.
 */
export const giveTicketCommand = tenantCommand({
  name: 'ticketing.giveTicket',
  input: z.object({ linkId: z.uuid(), ticketId: z.uuid(), recipientEmail: Email.optional() }),
  output: ClaimLinkDto,
  entitlement: 'ticketing',
  permission: 'public:holder',
  handler: async ({ input, ctx, tx, emit }) => {
    const l = await liveHolderLink(tx, ctx, input.linkId);
    const [t] = await tx
      .select({ id: tickets.id })
      .from(tickets)
      .where(
        and(
          eq(tickets.id, input.ticketId),
          eq(tickets.eventId, l.eventId),
          eq(tickets.status, 'active'),
          eq(sql`lower(${tickets.holderEmail})`, l.emailNorm),
        ),
      );
    if (!t) throw new DomainError('not_found', 'Ticket not found');
    // M3.10c: the ticket type's transfer rules apply to open give-away links too; a ticket with a
    // transfer fee is passed on by name (startHolderTransfer), where the fee is agreed.
    const ev = await findEventTx(tx, l.eventId);
    if (!ev) throw new DomainError('not_found');
    const rule = (await holderTransferOptionsTx(tx, ctx.now, [t.id], ev)).get(t.id);
    if (rule && !rule.allowed)
      throw new DomainError('invalid_state', 'This ticket cannot be passed on now', { reason: rule.reason });
    if (rule && rule.feeMinor > 0)
      throw new DomainError('invalid_state', 'Transfer this ticket by name to agree to its fee', {
        reason: 'fee_required',
      });
    const [link] = await openClaimsTx(
      tx,
      ctx,
      [t.id],
      { recipientEmail: input.recipientEmail ?? null, expiresInDays: 14 },
      emit,
    );
    if (!link) throw new DomainError('internal');
    return link;
  },
  audit: (input) => ({ action: 'ticket.give', targetType: 'ticket', targetId: input.ticketId }),
});

/**
 * Claim links of some tickets with every moment they changed (M3.10b order timeline): offered,
 * claimed (by whom), revoked. Newest first, bounded.
 */
export async function claimsForTicketsTx(tx: TenantTx, ticketIds: readonly string[]) {
  if (ticketIds.length === 0) return [];
  return tx
    .select({
      id: ticketClaims.id,
      ticketId: ticketClaims.ticketId,
      recipientEmail: ticketClaims.recipientEmail,
      claimedByEmail: ticketClaims.claimedByEmail,
      createdAt: ticketClaims.createdAt,
      claimedAt: ticketClaims.claimedAt,
      revokedAt: ticketClaims.revokedAt,
    })
    .from(ticketClaims)
    .where(inArray(ticketClaims.ticketId, [...ticketIds]))
    .orderBy(desc(ticketClaims.createdAt))
    .limit(200);
}
