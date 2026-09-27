import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { eventAttendeesMatchingTx } from '@yayatoh/attendees';
import { type TenantTx, withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { FloorplanDoc } from '@yayatoh/floorplan';
import { createCtx, DomainError, requireOrg, uuidv7 } from '@yayatoh/kernel';
import {
  appTokenSecret,
  defineSubscriber,
  hitRateLimitTx,
  type Notifier,
  tenantCommand,
  tenantQuery,
} from '@yayatoh/platform';
import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import { eventLayouts, eventSeats, FINDER_MODES, finderCodes, seatAssignments } from './schema.ts';

/** Lookups per device (cookie) and event per minute before a challenge (roadmap §6.1). */
export const FINDER_RATE_LIMIT = 30;
export const FINDER_RATE_WINDOW_MS = 60_000;
/** A code works once, for ten minutes, and locks after five wrong tries. */
export const FINDER_CODE_TTL_MS = 10 * 60_000;
export const FINDER_MAX_ATTEMPTS = 5;
/** New codes per address per event per hour (OTP limit per destination); then the last one stands. */
export const FINDER_CODES_PER_HOUR = 5;
/** How long a verified code shows the guest their seats (the page's cookie lives as long). */
export const FINDER_VIEW_MS = 24 * 3_600_000;

type FinderMode = (typeof FINDER_MODES)[number];

const mac = (label: string, value: string) =>
  createHmac('sha256', appTokenSecret()).update(`${label}:${value}`).digest();

/** The six-digit code for a code row: derived from its id under the app secret, never stored. */
export function finderCodeFor(codeId: string): string {
  return String(mac('seat-finder-code', codeId).readUInt32BE(0) % 1_000_000).padStart(6, '0');
}
const codeHash = (codeId: string, code: string) => mac('seat-finder-code-hash', `${codeId}:${code}`);
const emailHash = (eventId: string, email: string) =>
  mac('seat-finder-email', `${eventId}:${email}`).toString('hex');
const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** The event's plan and finder settings; refused unless the organizer opened the finder. */
async function openFinderTx(tx: TenantTx, eventId: string, mode: FinderMode | null) {
  const [l] = await tx
    .select({ doc: eventLayouts.doc, publicMap: eventLayouts.publicMap, mode: eventLayouts.finderMode })
    .from(eventLayouts)
    .where(eq(eventLayouts.eventId, eventId));
  if (!l?.publicMap)
    throw new DomainError('not_found', 'The seat finder is not open for this event', {
      reason: 'finder_closed',
    });
  if (mode && l.mode !== mode)
    throw new DomainError('invalid_state', 'This event looks up seats another way', {
      reason: 'finder_mode',
    });
  return { doc: FloorplanDoc.parse(l.doc), mode: l.mode as FinderMode };
}

/** Count this lookup against the device's budget for the event. */
async function overLimitTx(
  tx: TenantTx,
  ctx: Parameters<typeof hitRateLimitTx>[1],
  eventId: string,
  device: string,
) {
  const r = await hitRateLimitTx(tx, ctx, {
    bucket: `seat-finder:${eventId}:${device}`,
    limit: FINDER_RATE_LIMIT,
    windowMs: FINDER_RATE_WINDOW_MS,
  });
  return !r.allowed;
}

/** What a guest may see about their own party: seats and where they are, never names. */
export const SeatFinderResultDto = z.object({
  /** Someone matched (always true after a code; name lookups may find no one). */
  found: z.boolean(),
  seats: z.array(
    z.object({
      seatUuid: z.uuid(),
      itemId: z.uuid(),
      itemKind: z.enum(['row', 'table']),
      itemLabel: z.string(),
      seatLabel: z.string(),
    }),
  ),
  /** People in the party who have no seat yet. */
  unseated: z.int().min(0),
});
export type SeatFinderResultDto = z.infer<typeof SeatFinderResultDto>;

/** Seats of these attendees: given by the organizer (M1.7d) or bought with their ticket (M1.7c). */
async function seatsOfTx(
  tx: TenantTx,
  doc: FloorplanDoc,
  eventId: string,
  people: readonly { id: string; ticketId: string | null }[],
): Promise<SeatFinderResultDto> {
  const ids = people.map((p) => p.id);
  const ticketIds = people.flatMap((p) => (p.ticketId ? [p.ticketId] : []));
  const [assigned, bought] = await Promise.all([
    ids.length
      ? tx
          .select({ attendeeId: seatAssignments.attendeeId, seatUuid: seatAssignments.seatUuid })
          .from(seatAssignments)
          .where(and(eq(seatAssignments.eventId, eventId), inArray(seatAssignments.attendeeId, ids)))
      : [],
    ticketIds.length
      ? tx
          .select({ ticketId: eventSeats.ticketId, seatUuid: eventSeats.seatUuid })
          .from(eventSeats)
          .where(
            and(
              eq(eventSeats.eventId, eventId),
              eq(eventSeats.status, 'sold'),
              inArray(eventSeats.ticketId, ticketIds),
            ),
          )
      : [],
  ]);
  const mine = new Set([...assigned.map((a) => a.seatUuid), ...bought.map((b) => b.seatUuid)]);
  const seatedTickets = new Set(bought.map((b) => b.ticketId));
  const seatedPeople = new Set(assigned.map((a) => a.attendeeId));
  const seated = people.filter(
    (p) => seatedPeople.has(p.id) || (p.ticketId && seatedTickets.has(p.ticketId)),
  );
  // In plan order, so a party reads table by table.
  const seats = doc.items.flatMap((item) =>
    item.kind === 'object'
      ? []
      : item.seats
          .filter((s) => mine.has(s.id))
          .map((s) => ({
            seatUuid: s.id,
            itemId: item.id,
            itemKind: item.kind,
            itemLabel: item.label,
            seatLabel: s.label,
          })),
  );
  return SeatFinderResultDto.parse({
    found: people.length > 0,
    seats,
    unseated: people.length - seated.length,
  });
}

// ─── Organizer settings ─────────────────────────────────────────────────────────────────────

export const FinderSettingsDto = z.object({
  publicMap: z.boolean(),
  mode: z.enum(FINDER_MODES),
});

/** Open or close the venue map and seat finder to guests, and choose how guests look up. */
export const setFinderSettingsCommand = tenantCommand({
  name: 'seating.setFinderSettings',
  input: z.object({ eventId: z.uuid(), publicMap: z.boolean(), mode: z.enum(FINDER_MODES) }),
  output: FinderSettingsDto,
  entitlement: 'seat_finder',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .update(eventLayouts)
      .set({ publicMap: input.publicMap, finderMode: input.mode, updatedAt: ctx.now })
      .where(eq(eventLayouts.eventId, input.eventId))
      .returning({ publicMap: eventLayouts.publicMap, mode: eventLayouts.finderMode });
    if (!row) throw new DomainError('not_found', 'This event has no floor plan');
    return { publicMap: row.publicMap, mode: row.mode as FinderMode };
  },
  audit: (input) => ({
    action: 'seating.finder_settings',
    targetType: 'event',
    targetId: input.eventId,
    data: { publicMap: input.publicMap, mode: input.mode },
  }),
});

export const finderSettingsQuery = tenantQuery({
  name: 'seating.finderSettings',
  input: z.object({ eventId: z.uuid() }),
  output: FinderSettingsDto.nullable(),
  entitlement: 'seat_finder',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const [l] = await tx
      .select({ publicMap: eventLayouts.publicMap, mode: eventLayouts.finderMode })
      .from(eventLayouts)
      .where(eq(eventLayouts.eventId, input.eventId));
    return l ? { publicMap: l.publicMap, mode: l.mode as FinderMode } : null;
  },
});

// ─── Public ─────────────────────────────────────────────────────────────────────────────────

export const PublicVenueMapDto = z.object({ doc: FloorplanDoc, mode: z.enum(FINDER_MODES) });

/**
 * The venue map for guests: the plan as drawn (stage, entrances, tables…) and how the seat
 * finder works. Only once the organizer opened it; nothing about who sits where.
 */
export const publicVenueMapQuery = tenantQuery({
  name: 'seating.publicVenueMap',
  input: z.object({ eventId: z.uuid() }),
  output: PublicVenueMapDto.nullable(),
  entitlement: 'seat_finder',
  permission: 'public:seat_finder',
  handler: async ({ input, tx }) => {
    try {
      return await openFinderTx(tx, input.eventId, null);
    } catch (err) {
      if (err instanceof DomainError && err.code === 'not_found') return null;
      throw err;
    }
  },
});

const Device = z.string().min(1).max(128);

/**
 * Public: email me a code to see my seat. Every request is answered the same way and does the same
 * work — a code row, an outbox event, an audit row — whether or not the address is on the list;
 * only rows for listed addresses carry a real code and an address to mail. Past the device's
 * budget for the event, the caller must pass a human check (`human: true`, verified by the
 * transport before calling) or gets `challenge`.
 */
export const requestFinderCodeCommand = tenantCommand({
  name: 'seating.requestFinderCode',
  input: z.object({
    eventId: z.uuid(),
    email: z.email().max(254),
    device: Device,
    human: z.boolean().default(false),
  }),
  output: z.object({ status: z.enum(['sent', 'challenge']), codeId: z.uuid().nullable() }),
  entitlement: 'seat_finder',
  permission: 'public:seat_finder',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    await openFinderTx(tx, input.eventId, 'code');
    if ((await overLimitTx(tx, ctx, input.eventId, input.device)) && !input.human)
      return { status: 'challenge' as const, codeId: null };
    const email = normalizeEmail(input.email);
    const hash = emailHash(input.eventId, email);
    const [recent, people] = await Promise.all([
      tx
        .select({
          id: finderCodes.id,
          usedAt: finderCodes.usedAt,
          expiresAt: finderCodes.expiresAt,
          attempts: finderCodes.attempts,
        })
        .from(finderCodes)
        .where(
          and(
            eq(finderCodes.eventId, input.eventId),
            eq(finderCodes.emailHash, hash),
            gte(finderCodes.createdAt, new Date(ctx.now.getTime() - 3_600_000)),
          ),
        )
        .orderBy(desc(finderCodes.createdAt)),
      eventAttendeesMatchingTx(tx, input.eventId, { email }),
    ]);
    const spent = recent.length >= FINDER_CODES_PER_HOUR;
    if (spent) {
      // This address had its codes for the hour: the latest one that still works stands.
      const live = recent.find((r) => !r.usedAt && r.expiresAt > ctx.now && r.attempts < FINDER_MAX_ATTEMPTS);
      if (live) return { status: 'sent' as const, codeId: live.id };
    }
    // Codes past their use are pruned as new ones are made (the event's, a day after expiry).
    await tx
      .delete(finderCodes)
      .where(
        and(
          eq(finderCodes.eventId, input.eventId),
          lt(finderCodes.expiresAt, new Date(ctx.now.getTime() - 24 * 3_600_000)),
        ),
      );
    const id = uuidv7();
    const real = people.length > 0 && !spent;
    await tx.insert(finderCodes).values({
      id,
      orgId,
      eventId: input.eventId,
      emailHash: hash,
      email: real ? email : null,
      // Unlisted addresses get a code hash nothing can match (same length, same work).
      codeHash: (real ? codeHash(id, finderCodeFor(id)) : randomBytes(32)).toString('hex'),
      expiresAt: new Date(ctx.now.getTime() + FINDER_CODE_TTL_MS),
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    emit({
      type: 'seating.finder_code_created',
      version: 1,
      aggregateType: 'finder_code',
      aggregateId: id,
      payload: { orgId, eventId: input.eventId, codeId: id },
    });
    return { status: 'sent' as const, codeId: id };
  },
  audit: (input, r) => ({
    action: 'seating.finder_code_request',
    targetType: 'event',
    targetId: input.eventId,
    data: { status: r?.status, codeId: r?.codeId },
  }),
});

export const FINDER_VERIFY_STATUSES = ['ok', 'wrong', 'locked', 'expired', 'used', 'challenge'] as const;

/**
 * Public: check a seat finder code. Wrong codes count (five lock it); a right one is spent. The
 * outcome is returned, not thrown, so the attempt count commits.
 */
export const verifyFinderCodeCommand = tenantCommand({
  name: 'seating.verifyFinderCode',
  input: z.object({
    eventId: z.uuid(),
    codeId: z.uuid(),
    code: z.string().regex(/^\d{6}$/),
    device: Device,
    human: z.boolean().default(false),
  }),
  output: z.object({
    status: z.enum(FINDER_VERIFY_STATUSES),
    attemptsLeft: z.int().min(0).nullable(),
  }),
  entitlement: 'seat_finder',
  permission: 'public:seat_finder',
  handler: async ({ input, ctx, tx }) => {
    await openFinderTx(tx, input.eventId, 'code');
    if ((await overLimitTx(tx, ctx, input.eventId, input.device)) && !input.human)
      return { status: 'challenge' as const, attemptsLeft: null };
    const [row] = await tx
      .select()
      .from(finderCodes)
      .where(and(eq(finderCodes.id, input.codeId), eq(finderCodes.eventId, input.eventId)))
      .for('update');
    if (!row) return { status: 'expired' as const, attemptsLeft: null };
    if (row.usedAt) return { status: 'used' as const, attemptsLeft: null };
    if (row.expiresAt <= ctx.now) return { status: 'expired' as const, attemptsLeft: null };
    if (row.attempts >= FINDER_MAX_ATTEMPTS) return { status: 'locked' as const, attemptsLeft: 0 };
    const given = codeHash(row.id, input.code);
    const want = Buffer.from(row.codeHash, 'hex');
    const ok = row.email !== null && given.length === want.length && timingSafeEqual(given, want);
    if (!ok) {
      const attempts = row.attempts + 1;
      await tx.update(finderCodes).set({ attempts, updatedAt: ctx.now }).where(eq(finderCodes.id, row.id));
      return attempts >= FINDER_MAX_ATTEMPTS
        ? { status: 'locked' as const, attemptsLeft: 0 }
        : { status: 'wrong' as const, attemptsLeft: FINDER_MAX_ATTEMPTS - attempts };
    }
    await tx
      .update(finderCodes)
      .set({ usedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(finderCodes.id, row.id));
    return { status: 'ok' as const, attemptsLeft: null };
  },
  audit: (input, r) => ({
    action: 'seating.finder_code_verify',
    targetType: 'event',
    targetId: input.eventId,
    data: { status: r?.status, codeId: input.codeId },
  }),
});

/** Public: the seats of the party behind a code verified in the last 24 hours. */
export const finderResultQuery = tenantQuery({
  name: 'seating.finderResult',
  input: z.object({ eventId: z.uuid(), codeId: z.uuid() }),
  output: SeatFinderResultDto,
  entitlement: 'seat_finder',
  permission: 'public:seat_finder',
  handler: async ({ input, ctx, tx }) => {
    const { doc } = await openFinderTx(tx, input.eventId, 'code');
    const [row] = await tx
      .select({ email: finderCodes.email, usedAt: finderCodes.usedAt })
      .from(finderCodes)
      .where(and(eq(finderCodes.id, input.codeId), eq(finderCodes.eventId, input.eventId)));
    if (!row?.email || !row.usedAt || row.usedAt.getTime() <= ctx.now.getTime() - FINDER_VIEW_MS)
      throw new DomainError('not_found', 'Look up your seat again');
    const people = await eventAttendeesMatchingTx(tx, input.eventId, { email: row.email });
    return seatsOfTx(tx, doc, input.eventId, people);
  },
});

/**
 * Public, when the organizer chose instant name lookup: the seats of people whose full name
 * matches exactly (case and spacing aside, never partial matches or suggestions).
 */
export const findSeatByNameCommand = tenantCommand({
  name: 'seating.findSeatByName',
  input: z.object({
    eventId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    device: Device,
    human: z.boolean().default(false),
  }),
  output: z.object({ status: z.enum(['ok', 'challenge']), result: SeatFinderResultDto.nullable() }),
  entitlement: 'seat_finder',
  permission: 'public:seat_finder',
  handler: async ({ input, ctx, tx }) => {
    const { doc } = await openFinderTx(tx, input.eventId, 'name');
    if ((await overLimitTx(tx, ctx, input.eventId, input.device)) && !input.human)
      return { status: 'challenge' as const, result: null };
    const people = await eventAttendeesMatchingTx(tx, input.eventId, { name: input.name });
    return { status: 'ok' as const, result: await seatsOfTx(tx, doc, input.eventId, people) };
  },
  audit: (input, r) => ({
    action: 'seating.finder_name_lookup',
    targetType: 'event',
    targetId: input.eventId,
    data: { status: r?.status, found: r?.result?.found ?? null },
  }),
});

// ─── Mail ───────────────────────────────────────────────────────────────────────────────────

const CodePayload = z.object({ orgId: z.uuid(), eventId: z.uuid(), codeId: z.uuid() });

/**
 * Emails a seat finder code (worker). Lookups for addresses not on the list emit the same event;
 * their rows have no address, so nothing is sent. The code is re-derived; the event carries none.
 */
export function finderCodeMailer(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'seating.finder-code-mailer',
    events: ['seating.finder_code_created@1'],
    handle: async (tx, event) => {
      const p = CodePayload.parse(event.payload);
      const [row] = await tx
        .select({ id: finderCodes.id, email: finderCodes.email, expiresAt: finderCodes.expiresAt })
        .from(finderCodes)
        .where(eq(finderCodes.id, p.codeId));
      if (!row?.email || row.expiresAt <= new Date()) return;
      const ev = await findEventTx(tx, p.eventId);
      if (!ev) return;
      // Through the notifications core (M1.10): logged, deduplicated, urgent (no quiet hours).
      await deps.notifier.enqueue(tx, {
        kind: 'seating.finder-code',
        to: { email: row.email, timeZone: ev.timezone },
        params: {
          code: finderCodeFor(row.id),
          eventName: ev.name,
          url: `${deps.appOrigin}/events/${ev.slug}/seat-finder`,
          minutes: FINDER_CODE_TTL_MS / 60_000,
        },
        dedupeKey: `finder-code:${row.id}`,
        eventId: p.eventId,
      });
    },
  });
}

/**
 * Development and e2e only (the console mailer prints codes to the worker log, which browser
 * tests can't read): the latest code mailed to an address for an event. Refused unless dev
 * personas are enabled outside production; the web app's dev route is gated the same way.
 */
export async function devFinderCode(
  orgId: string,
  eventId: string,
  email: string,
): Promise<{ codeId: string; code: string } | null> {
  if (process.env.YAYATOH_DEV_AUTH !== '1' || process.env.VERCEL_ENV === 'production')
    throw new DomainError('forbidden', 'Development only');
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'seating.dev-finder-code' } });
  const [row] = await withTenant(ctx, (tx) =>
    tx
      .select({ id: finderCodes.id, email: finderCodes.email })
      .from(finderCodes)
      .where(
        and(
          eq(finderCodes.eventId, eventId),
          eq(finderCodes.emailHash, emailHash(eventId, normalizeEmail(email))),
        ),
      )
      .orderBy(desc(finderCodes.createdAt))
      .limit(1),
  );
  return row?.email ? { codeId: row.id, code: finderCodeFor(row.id) } : null;
}
