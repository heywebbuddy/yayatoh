import {
  correctedArrival,
  earlierArrival,
  GUEST_SNAPSHOT_VERSION,
  type GuestSnapshot,
  searchGuests,
} from '@yayatoh/checkin-engine';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { guestNamesTx } from '@yayatoh/guests';
import { DomainError, requireOrg, uuidv7 } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { guestPlacesTx } from '@yayatoh/seating';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { deviceIdOf } from './device-actor.ts';
import { ARRIVAL_SOURCES, type ArrivalSource, guestArrivals } from './schema.ts';
import { deviceScanScopeTx } from './staff.ts';

/**
 * Guest check-in on the day (M4.4b): wedding and gala guests (the guests module's parties) are
 * checked in by name or party on a Scan PWA device, by themselves at a guest kiosk, or by the
 * host on the day-of page. A device works from the guest snapshot (names, party labels, tables,
 * arrivals: never a contact detail, meal or private answer), offline too, and syncs its arrivals
 * later; the first arrival (corrected device time) wins.
 */

const STATUSES = ['attending', 'pending', 'declined'] as const;

const PlaceDto = z.object({
  chart: z.string().nullable(),
  kind: z.enum(['table', 'row']),
  label: z.string(),
});

/** The device snapshot: an allowlist (P4-3: names as the host wrote them, labels, tables). */
export const GuestSnapshotDto = z.object({
  version: z.int(),
  eventId: z.uuid(),
  generatedAt: z.iso.datetime({ offset: true }),
  parties: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      tags: z.array(z.string()),
      guests: z.array(
        z.object({
          id: z.uuid(),
          firstName: z.string().nullable(),
          lastName: z.string().nullable(),
          name: z.string().nullable(),
          guestOf: z.string().nullable(),
          status: z.enum(STATUSES),
          places: z.array(PlaceDto),
          arrivedAt: z.iso.datetime({ offset: true }).nullable(),
        }),
      ),
    }),
  ),
});

async function arrivalsTx(tx: TenantTx, eventId: string) {
  return tx
    .select({
      guestId: guestArrivals.guestId,
      arrivedAt: guestArrivals.arrivedAt,
      source: guestArrivals.source,
    })
    .from(guestArrivals)
    .where(eq(guestArrivals.eventId, eventId));
}

/** The event's guests with their names, labels, tables and arrivals, read once. */
async function guestDayTx(tx: TenantTx, eventId: string) {
  const [places, names, arrivals] = await Promise.all([
    guestPlacesTx(tx, eventId),
    guestNamesTx(tx, eventId),
    arrivalsTx(tx, eventId),
  ]);
  const arrived = new Map(arrivals.map((a) => [a.guestId, a]));
  return { ...places, names, arrived };
}

function snapshotOf(day: Awaited<ReturnType<typeof guestDayTx>>, eventId: string, now: Date): GuestSnapshot {
  return {
    version: GUEST_SNAPSHOT_VERSION,
    eventId,
    generatedAt: now.toISOString(),
    parties: day.parties.map((p) => ({
      id: p.id,
      name: p.name,
      tags: [...p.tags],
      guests: p.guests.map((g) => ({
        id: g.id,
        firstName: day.names.get(g.id)?.firstName ?? null,
        lastName: day.names.get(g.id)?.lastName ?? null,
        name: g.name,
        guestOf: g.guestOf,
        status: g.status,
        places: (day.placesOf.get(g.id) ?? []).map((pl) => ({
          chart: pl.subEventName,
          kind: pl.kind,
          label: pl.label,
        })),
        arrivedAt: day.arrived.get(g.id)?.arrivedAt.toISOString() ?? null,
      })),
    })),
  };
}

/** A device may work this event: it exists, and a device handed to door staff is assigned to it. */
async function deviceEventTx(tx: TenantTx, deviceId: string, eventId: string, now: Date) {
  const event = await findEventTx(tx, eventId);
  if (!event) throw new DomainError('not_found', 'Event not found');
  const scope = await deviceScanScopeTx(tx, deviceId, event.id, now);
  if (scope !== null && scope.size === 0)
    throw new DomainError('forbidden', 'This device is not assigned to this event');
  return event;
}

/** The guest snapshot a Scan PWA device downloads (device credentials only). */
export const guestSnapshotQuery = tenantQuery({
  name: 'checkin.guestSnapshot',
  input: z.object({ eventId: z.uuid() }),
  output: GuestSnapshotDto,
  entitlement: 'checkin',
  permission: 'checkin:device',
  handler: async ({ input, ctx, tx }) => {
    const event = await deviceEventTx(tx, deviceIdOf(ctx), input.eventId, ctx.now);
    return snapshotOf(await guestDayTx(tx, event.id), event.id, ctx.now);
  },
});

export const MAX_ARRIVALS_PER_SYNC = 500;

export const ARRIVAL_RESULTS = ['arrived', 'already', 'unknown'] as const;
export type ArrivalResult = (typeof ARRIVAL_RESULTS)[number];

export const GuestArrivalsInput = z.object({
  eventId: z.uuid(),
  arrivals: z
    .array(
      z.object({
        /** The device's id for this check-in: a resend is a no-op. */
        clientId: z.uuid(),
        guestId: z.uuid(),
        deviceTs: z.coerce.date(),
        clockOffsetMs: z.int().min(-86_400_000).max(86_400_000),
        source: z.enum(['scanner', 'kiosk']),
      }),
    )
    .min(1)
    .max(MAX_ARRIVALS_PER_SYNC),
});

export const GuestArrivalsResult = z.object({
  results: z.array(z.object({ clientId: z.uuid(), result: z.enum(ARRIVAL_RESULTS) })),
});

/**
 * Apply one arrival (first wins). `arrived`: this check-in is the guest's arrival (or was
 * already, on a resend); `already`: someone checked the guest in earlier; `unknown`: not a guest
 * of this event (removed since the snapshot, or never).
 */
async function applyArrivalTx(
  tx: TenantTx,
  orgId: string,
  eventId: string,
  a: {
    clientId: string;
    guestId: string;
    at: Date;
    source: ArrivalSource;
    deviceId: string | null;
    recordedBy: string | null;
  },
  known: ReadonlySet<string>,
): Promise<ArrivalResult> {
  const [mine] = await tx
    .select({ id: guestArrivals.id })
    .from(guestArrivals)
    .where(eq(guestArrivals.clientId, a.clientId));
  if (mine) return 'arrived';
  if (!known.has(a.guestId)) return 'unknown';
  const [current] = await tx
    .select({ id: guestArrivals.id, arrivedAt: guestArrivals.arrivedAt })
    .from(guestArrivals)
    .where(eq(guestArrivals.guestId, a.guestId));
  if (current && !earlierArrival(current.arrivedAt, a.at)) return 'already';
  const values = {
    arrivedAt: a.at,
    source: a.source,
    deviceId: a.deviceId,
    recordedBy: a.recordedBy,
    clientId: a.clientId,
  };
  if (current) {
    // An earlier arrival reached the server late: it takes over (first wins on corrected time).
    await tx
      .update(guestArrivals)
      .set({ ...values, updatedAt: a.at })
      .where(eq(guestArrivals.id, current.id));
  } else {
    await tx.insert(guestArrivals).values({ orgId, eventId, guestId: a.guestId, ...values });
  }
  return 'arrived';
}

/** Serialize the arrivals of one event (devices syncing together can't both insert a guest). */
async function lockEventTx(tx: TenantTx, eventId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`guest-arrivals:${eventId}`}, 0))`);
}

/** A Scan PWA device sends the arrivals it recorded (offline too); idempotent per `clientId`. */
export const recordGuestArrivalsCommand = tenantCommand({
  name: 'checkin.recordGuestArrivals',
  input: GuestArrivalsInput,
  output: GuestArrivalsResult,
  entitlement: 'checkin',
  permission: 'checkin:device',
  handler: async ({ input, ctx, tx }) => {
    const deviceId = deviceIdOf(ctx);
    const event = await deviceEventTx(tx, deviceId, input.eventId, ctx.now);
    await lockEventTx(tx, event.id);
    const known = new Set((await guestNamesTx(tx, event.id)).keys());
    const orgId = requireOrg(ctx);
    // Earliest first, so a batch holding two check-ins of one guest keeps the first.
    const ordered = input.arrivals
      .map((a) => ({ ...a, at: correctedArrival(a.deviceTs, a.clockOffsetMs, ctx.now) }))
      .sort((x, y) => x.at.getTime() - y.at.getTime());
    const byClient = new Map<string, ArrivalResult>();
    for (const a of ordered)
      byClient.set(
        a.clientId,
        await applyArrivalTx(tx, orgId, event.id, { ...a, deviceId, recordedBy: null }, known),
      );
    return {
      results: input.arrivals.map((a) => ({
        clientId: a.clientId,
        result: byClient.get(a.clientId) ?? 'unknown',
      })),
    };
  },
  audit: (input, output) => ({
    action: 'guest.arrivals_synced',
    targetType: 'event',
    targetId: input.eventId,
    data: {
      eventId: input.eventId,
      arrivals: input.arrivals.length,
      arrived: output.results.filter((r) => r.result === 'arrived').length,
    },
  }),
});

/** The host (or a planner at the door) checks guests in from the day-of page. */
export const markGuestsArrivedCommand = tenantCommand({
  name: 'checkin.markGuestsArrived',
  input: z.object({ eventId: z.uuid(), guestIds: z.array(z.uuid()).min(1).max(50) }),
  output: z.object({ arrived: z.int(), already: z.int() }),
  entitlement: 'checkin',
  permission: 'checkin:scan',
  handler: async ({ input, ctx, tx }) => {
    if (!(await findEventTx(tx, input.eventId))) throw new DomainError('not_found', 'Event not found');
    await lockEventTx(tx, input.eventId);
    const known = new Set((await guestNamesTx(tx, input.eventId)).keys());
    if (input.guestIds.some((id) => !known.has(id)))
      throw new DomainError('not_found', 'Guest not found', { field: 'guestIds' });
    let arrived = 0;
    let already = 0;
    for (const guestId of new Set(input.guestIds)) {
      const r = await applyArrivalTx(
        tx,
        requireOrg(ctx),
        input.eventId,
        {
          clientId: uuidv7(),
          guestId,
          at: ctx.now,
          source: 'host',
          deviceId: null,
          recordedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
        },
        known,
      );
      if (r === 'arrived') arrived += 1;
      else already += 1;
    }
    return { arrived, already };
  },
  audit: (input) => ({
    action: 'guest.arrived',
    targetType: 'event',
    targetId: input.eventId,
    data: { eventId: input.eventId, guestIds: input.guestIds },
  }),
});

/** Undo a mistaken check-in (the audit log keeps both). */
export const undoGuestArrivalCommand = tenantCommand({
  name: 'checkin.undoGuestArrival',
  input: z.object({ eventId: z.uuid(), guestId: z.uuid() }),
  output: z.object({ undone: z.boolean() }),
  entitlement: 'checkin',
  permission: 'checkin:scan',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .delete(guestArrivals)
      .where(and(eq(guestArrivals.eventId, input.eventId), eq(guestArrivals.guestId, input.guestId)))
      .returning({ id: guestArrivals.id });
    if (rows.length === 0) throw new DomainError('not_found', 'This guest is not checked in');
    return { undone: true };
  },
  audit: (input) => ({
    action: 'guest.arrival_undone',
    targetType: 'event',
    targetId: input.eventId,
    data: input,
  }),
});

/* ------------------------------------------------------------------ the host's day-of view ---- */

const PersonDto = z.object({
  guestId: z.uuid(),
  name: z.string().nullable(),
  guestOf: z.string().nullable(),
  partyName: z.string(),
});

export const DAY_OF_ARRIVALS_SHOWN = 200;
export const DAY_OF_MATCHES = 20;

export const DayOfDto = z.object({
  eventId: z.uuid(),
  timezone: z.string(),
  counts: z.object({
    /** Guests who haven't declined (attending or not answered). */
    expected: z.int(),
    attending: z.int(),
    pending: z.int(),
    declined: z.int(),
    arrived: z.int(),
    /** Expected guests who haven't arrived yet. */
    notArrived: z.int(),
    unseated: z.int(),
  }),
  /** Newest first, at most `DAY_OF_ARRIVALS_SHOWN`. */
  arrivals: z.array(
    PersonDto.extend({
      arrivedAt: z.date(),
      source: z.enum(ARRIVAL_SOURCES),
      places: z.array(PlaceDto),
    }),
  ),
  /** Guests who haven't declined and have no table on any chart (empty without a chart). */
  unseated: z.array(PersonDto.extend({ status: z.enum(['attending', 'pending']), arrived: z.boolean() })),
  /** Whether any chart (event plan or sub-event) has a floor plan. */
  hasChart: z.boolean(),
  /** The host's search (`q`: a guest's or party's name), at most `DAY_OF_MATCHES` guests. */
  matches: z.array(
    PersonDto.extend({
      status: z.enum(STATUSES),
      arrivedAt: z.date().nullable(),
      places: z.array(PlaceDto),
    }),
  ),
  /** Attending guests by meal (null: no choice yet), most first; arrived of them too. */
  meals: z.array(z.object({ meal: z.string().nullable(), guests: z.int(), arrived: z.int() })),
});
export type DayOfDto = z.infer<typeof DayOfDto>;

/** The host's day-of view: arrivals, unseated guests and meal counts. */
export const dayOfQuery = tenantQuery({
  name: 'checkin.dayOf',
  input: z.object({ eventId: z.uuid(), q: z.string().trim().max(80).default('') }),
  output: DayOfDto,
  entitlement: 'checkin',
  permission: 'guests:read',
  handler: async ({ input, tx }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const day = await guestDayTx(tx, event.id);
    const counts = {
      expected: 0,
      attending: 0,
      pending: 0,
      declined: 0,
      arrived: 0,
      notArrived: 0,
      unseated: 0,
    };
    const people = new Map<string, z.infer<typeof PersonDto>>();
    const unseated: DayOfDto['unseated'] = [];
    const meals = new Map<string | null, { guests: number; arrived: number }>();
    for (const p of day.parties)
      for (const g of p.guests) {
        const person = { guestId: g.id, name: g.name, guestOf: g.guestOf, partyName: p.name };
        people.set(g.id, person);
        const arrived = day.arrived.has(g.id);
        counts[g.status] += 1;
        if (arrived) counts.arrived += 1;
        if (g.status === 'declined') continue;
        counts.expected += 1;
        if (!arrived) counts.notArrived += 1;
        if (day.charts.length > 0 && !day.placesOf.get(g.id)?.length) {
          counts.unseated += 1;
          unseated.push({ ...person, status: g.status, arrived });
        }
        if (g.status === 'attending') {
          const m = meals.get(g.meal) ?? { guests: 0, arrived: 0 };
          m.guests += 1;
          if (arrived) m.arrived += 1;
          meals.set(g.meal, m);
        }
      }
    const latest = await tx
      .select({
        guestId: guestArrivals.guestId,
        arrivedAt: guestArrivals.arrivedAt,
        source: guestArrivals.source,
      })
      .from(guestArrivals)
      .where(eq(guestArrivals.eventId, event.id))
      .orderBy(desc(guestArrivals.arrivedAt), desc(guestArrivals.id))
      .limit(DAY_OF_ARRIVALS_SHOWN);
    return {
      eventId: event.id,
      timezone: event.timezone,
      counts,
      arrivals: latest.flatMap((a) => {
        const person = people.get(a.guestId);
        return person
          ? [
              {
                ...person,
                arrivedAt: a.arrivedAt,
                source: a.source as ArrivalSource,
                places: (day.placesOf.get(a.guestId) ?? []).map((pl) => ({
                  chart: pl.subEventName,
                  kind: pl.kind,
                  label: pl.label,
                })),
              },
            ]
          : [];
      }),
      unseated,
      matches: input.q
        ? searchGuests(snapshotOf(day, event.id, new Date()), input.q)
            .flatMap((p) =>
              p.guests.map((g) => ({
                guestId: g.id,
                name: g.name,
                guestOf: g.guestOf,
                partyName: p.name,
                status: g.status,
                arrivedAt: g.arrivedAt ? new Date(g.arrivedAt) : null,
                places: [...g.places],
              })),
            )
            .slice(0, DAY_OF_MATCHES)
        : [],
      hasChart: day.charts.length > 0,
      meals: [...meals.entries()]
        .map(([meal, m]) => ({ meal, ...m }))
        .sort((a, b) => b.guests - a.guests || (a.meal ?? '￿').localeCompare(b.meal ?? '￿')),
    };
  },
});

/** For tests and the DSAR/erasure paths: whether a guest has an arrival. */
export async function guestArrivedTx(tx: TenantTx, guestIds: readonly string[]): Promise<Set<string>> {
  if (!guestIds.length) return new Set();
  const rows = await tx
    .select({ guestId: guestArrivals.guestId })
    .from(guestArrivals)
    .where(inArray(guestArrivals.guestId, [...guestIds]));
  return new Set(rows.map((r) => r.guestId));
}
