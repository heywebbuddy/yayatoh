import { isUniqueViolation, type TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { paddleHolderNamesTx, paddleHoldersTx, paddleHolderTx } from '@yayatoh/guests';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  DEFAULT_PADDLE_START,
  MAX_PADDLES_PER_EVENT,
  nextPaddleNumbers,
  type PaddleHolderKind,
} from './domain/paddles.ts';
import { AssignPaddleInput, BulkAssignInput, PaddlesViewDto } from './paddle-dto.ts';
import { publishSpotterStateTx } from './paddle-live.ts';
import { paddleEntries, paddles } from './schema-paddles.ts';

/** The event, in this org, for a paddle write or read. */
export async function paddleEventTx(tx: TenantTx, eventId: string) {
  const event = await findEventTx(tx, eventId);
  if (!event) throw new DomainError('not_found', 'Event not found');
  return event;
}

/** Every paddle number of the event, smallest first. */
export async function paddleNumbersTx(tx: TenantTx, eventId: string): Promise<number[]> {
  const rows = await tx
    .select({ number: paddles.number })
    .from(paddles)
    .where(eq(paddles.eventId, eventId))
    .orderBy(asc(paddles.number));
  return rows.map((r) => r.number);
}

const numberTaken = (err: unknown) => {
  if (isUniqueViolation(err, 'paddles_org_event_number_key'))
    return new DomainError('conflict', 'That paddle number is taken', {
      field: 'number',
      reason: 'number_taken',
    });
  if (isUniqueViolation(err))
    return new DomainError('conflict', 'They already have a paddle', {
      field: 'holder',
      reason: 'has_paddle',
    });
  return err;
};

/** Serializes paddle writes of one event (numbers are unique per event; bulk takes many). */
const lockEventPaddles = (tx: TenantTx, eventId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`donations.paddles:${eventId}`}, 0))`);

/**
 * Give one guest or party a paddle: a chosen number or the next free one (at check-in, the desk
 * hands out the next paddle). A guest or party holds at most one.
 */
export const assignPaddleCommand = tenantCommand({
  name: 'donations.assignPaddle',
  input: AssignPaddleInput,
  output: z.object({ id: z.uuid(), number: z.int() }),
  entitlement: 'donations',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await paddleEventTx(tx, input.eventId);
    const holder = await paddleHolderTx(tx, event.id, { guestId: input.guestId, partyId: input.partyId });
    if (!holder) throw new DomainError('not_found', 'Guest or party not found', { field: 'holder' });
    await lockEventPaddles(tx, event.id);
    const taken = await paddleNumbersTx(tx, event.id);
    if (taken.length >= MAX_PADDLES_PER_EVENT)
      throw new DomainError('invalid_state', 'Too many paddles', { reason: 'too_many' });
    const number =
      input.number ?? nextPaddleNumbers(taken, 1, Math.max(DEFAULT_PADDLE_START, (taken.at(-1) ?? 0) + 1))[0];
    if (!number) throw new DomainError('invalid_state', 'No paddle numbers left', { reason: 'too_many' });
    try {
      const [row] = await tx
        .insert(paddles)
        .values({ orgId: requireOrg(ctx), eventId: event.id, number, ...holderCols(holder) })
        .returning({ id: paddles.id, number: paddles.number });
      if (!row) throw new DomainError('internal');
      await publishSpotterStateTx(tx, ctx, event.id);
      return row;
    } catch (err) {
      throw numberTaken(err);
    }
  },
  audit: (input, r) => ({
    action: 'donations.paddle.assign',
    targetType: 'donation_paddle',
    targetId: r.id,
    data: { eventId: input.eventId, number: r.number, holder: input.guestId ? 'guest' : 'party' },
  }),
});

const holderCols = (h: { guestId: string | null; partyId: string | null }) => ({
  guestId: h.guestId,
  partyId: h.partyId,
});

/**
 * Bulk assignment: every named guest (or every party) without a paddle, or only those of purchased
 * tables (M4.2b), numbered table by table from `startAt` (or after the highest number given).
 */
export const bulkAssignPaddlesCommand = tenantCommand({
  name: 'donations.bulkAssignPaddles',
  input: BulkAssignInput,
  output: z.object({ assigned: z.int(), first: z.int().nullable(), last: z.int().nullable() }),
  entitlement: 'donations',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await paddleEventTx(tx, input.eventId);
    await lockEventPaddles(tx, event.id);
    const holders = await paddleHoldersTx(tx, event.id);
    const existing = await tx
      .select({ number: paddles.number, guestId: paddles.guestId, partyId: paddles.partyId })
      .from(paddles)
      .where(eq(paddles.eventId, event.id));
    const has = new Set(existing.flatMap((p) => [p.guestId, p.partyId].filter((x): x is string => !!x)));
    const inScope = input.scope === 'tables' ? holders.parties.filter((p) => p.tableUnitId) : holders.parties;
    const order = new Map(inScope.map((p, i) => [p.id, i]));
    const wanted: { guestId: string | null; partyId: string | null }[] =
      input.per === 'party'
        ? inScope.filter((p) => !has.has(p.id)).map((p) => ({ guestId: null, partyId: p.id }))
        : holders.guests
            .filter((g) => order.has(g.partyId) && !has.has(g.id))
            .sort((a, b) => (order.get(a.partyId) ?? 0) - (order.get(b.partyId) ?? 0))
            .map((g) => ({ guestId: g.id, partyId: null }));
    if (wanted.length === 0) return { assigned: 0, first: null, last: null };
    if (existing.length + wanted.length > MAX_PADDLES_PER_EVENT)
      throw new DomainError('invalid_state', 'Too many paddles', { reason: 'too_many' });
    const taken = existing.map((p) => p.number);
    const start = input.startAt ?? Math.max(DEFAULT_PADDLE_START, Math.max(0, ...taken) + 1);
    const numbers = nextPaddleNumbers(taken, wanted.length, start);
    if (numbers.length < wanted.length)
      throw new DomainError('invalid_state', 'Not enough paddle numbers left', {
        field: 'startAt',
        reason: 'too_many',
      });
    const orgId = requireOrg(ctx);
    for (let i = 0; i < wanted.length; i += 500)
      await tx.insert(paddles).values(
        wanted.slice(i, i + 500).map((h, j) => ({
          orgId,
          eventId: event.id,
          number: numbers[i + j] as number,
          ...h,
        })),
      );
    await publishSpotterStateTx(tx, ctx, event.id);
    return { assigned: wanted.length, first: numbers[0] ?? null, last: numbers.at(-1) ?? null };
  },
  audit: (input, r) => ({
    action: 'donations.paddle.bulk_assign',
    targetType: 'event',
    targetId: input.eventId,
    data: { scope: input.scope, per: input.per, assigned: r.assigned },
  }),
});

/** Take a paddle back (it was given by mistake). Refused once it has entries that count. */
export const releasePaddleCommand = tenantCommand({
  name: 'donations.releasePaddle',
  input: z.object({ eventId: z.uuid(), paddleId: z.uuid() }),
  output: z.object({ released: z.boolean() }),
  entitlement: 'donations',
  permission: 'guests:write',
  category: 'delete',
  handler: async ({ input, ctx, tx }) => {
    const [p] = await tx
      .select({ id: paddles.id })
      .from(paddles)
      .where(and(eq(paddles.id, input.paddleId), eq(paddles.eventId, input.eventId)))
      .for('update');
    if (!p) throw new DomainError('not_found', 'Paddle not found');
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(paddleEntries)
      .where(and(eq(paddleEntries.paddleId, p.id), ne(paddleEntries.status, 'voided')));
    if (n > 0)
      throw new DomainError('invalid_state', 'This paddle has recorded entries', { reason: 'has_entries' });
    await tx.delete(paddles).where(eq(paddles.id, p.id));
    await publishSpotterStateTx(tx, ctx, input.eventId);
    return { released: true };
  },
  audit: (input) => ({
    action: 'donations.paddle.release',
    targetType: 'donation_paddle',
    targetId: input.paddleId,
  }),
});

/** Holder names of paddles, by paddle id (organizer views only). */
export async function paddleNamesTx(
  tx: TenantTx,
  rows: readonly { id: string; guestId: string | null; partyId: string | null }[],
) {
  const names = await paddleHolderNamesTx(tx, {
    guestIds: rows.flatMap((r) => (r.guestId ? [r.guestId] : [])),
    partyIds: rows.flatMap((r) => (r.partyId ? [r.partyId] : [])),
  });
  return new Map(rows.map((r) => [r.id, names.get(r.guestId ?? r.partyId ?? '') ?? null]));
}

/** The Paddles page: every paddle with its holder, and who has none yet. */
export const paddlesQuery = tenantQuery({
  name: 'donations.paddles',
  input: z.object({ eventId: z.uuid() }),
  output: PaddlesViewDto,
  entitlement: 'donations',
  permission: 'guests:read',
  handler: async ({ input, tx }) => {
    const event = await paddleEventTx(tx, input.eventId);
    const [holders, rows] = await Promise.all([
      paddleHoldersTx(tx, event.id),
      tx.select().from(paddles).where(eq(paddles.eventId, event.id)).orderBy(asc(paddles.number)),
    ]);
    const counts = new Map<string, number>();
    if (rows.length > 0)
      for (const c of await tx
        .select({ paddleId: paddleEntries.paddleId, n: sql<number>`count(*)::int` })
        .from(paddleEntries)
        .where(
          and(
            inArray(
              paddleEntries.paddleId,
              rows.map((r) => r.id),
            ),
            ne(paddleEntries.status, 'voided'),
          ),
        )
        .groupBy(paddleEntries.paddleId))
        counts.set(c.paddleId ?? '', c.n);
    const partyName = new Map(holders.parties.map((p) => [p.id, p.name]));
    const guest = new Map(holders.guests.map((g) => [g.id, g]));
    const has = new Set(rows.flatMap((r) => [r.guestId, r.partyId].filter((x): x is string => !!x)));
    const taken = rows.map((r) => r.number);
    return {
      paddles: rows.map((r) => {
        const g = r.guestId ? guest.get(r.guestId) : undefined;
        const kind: PaddleHolderKind = r.guestId ? 'guest' : 'party';
        return {
          id: r.id,
          number: r.number,
          holderKind: kind,
          holderName: g ? g.name : (partyName.get(r.partyId ?? '') ?? ''),
          partyName: g ? (partyName.get(g.partyId) ?? null) : (partyName.get(r.partyId ?? '') ?? null),
          entries: counts.get(r.id) ?? 0,
        };
      }),
      guestsWithout: holders.guests
        .filter((g) => !has.has(g.id))
        .map((g) => ({ id: g.id, name: g.name, partyName: partyName.get(g.partyId) ?? '' })),
      partiesWithout: holders.parties
        .filter((p) => !has.has(p.id))
        .map((p) => ({ id: p.id, name: p.name, isTable: !!p.tableUnitId })),
      tableCount: holders.parties.filter((p) => p.tableUnitId).length,
      nextNumber:
        nextPaddleNumbers(taken, 1, Math.max(DEFAULT_PADDLE_START, (taken.at(-1) ?? 0) + 1))[0] ?? null,
    };
  },
});
