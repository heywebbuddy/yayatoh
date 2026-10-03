import type { TenantTx } from '@yayatoh/db';
import { FloorplanDoc } from '@yayatoh/floorplan';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { defineRealtimeChannel, publishRealtimeTx, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { onChart } from './chart.ts';
import {
  fitAt,
  OCCUPANT_STATUSES,
  type OccupantStatus,
  VIP_WARNINGS,
  vipWarning,
} from './domain/guest-seating.ts';
import { eventLayoutTx } from './layouts.ts';
import { eventSeats, guestSeats, subEventCharts, tableSponsors, vipTables } from './schema.ts';
import { resolveSubEventChartTx, SUB_EVENT_CHART_SOURCES } from './sub-event-charts.ts';

/**
 * Guest seating (M4.3a): the host seats the guests module's guests (parties, plus-ones) at the
 * tables or rows of a chart: the event plan, or the chart a sub-event uses (a ceremony in rows,
 * a reception at tables). See `domain/guest-seating.ts` for the rules.
 *
 * Guests is the same tier as seating, so it is reached through a port, `OccupantDirectory`,
 * registered in each app's composition root (`setOccupantDirectory`); this module never imports
 * guests. The directory answers in the caller's transaction (guests' own tables, same org).
 */

/* ------------------------------------------------------------------------ the port ---- */

export interface Occupant {
  readonly id: string;
  readonly kind: 'guest' | 'plus_one';
  /** Full name, or null for a plus-one not named yet. */
  readonly name: string | null;
  /** For an unnamed plus-one: their host's name ("Guest of …"). */
  readonly guestOf: string | null;
  readonly ageClass: 'adult' | 'child' | 'infant';
  readonly meal: string | null;
  readonly status: OccupantStatus;
}

export interface OccupantParty {
  readonly id: string;
  readonly name: string;
  readonly vip: boolean;
  readonly side: string | null;
  readonly tags: readonly string[];
  readonly guests: readonly Occupant[];
}

export interface OccupantSubEvent {
  readonly id: string;
  readonly name: string;
  readonly occurrenceId: string | null;
}

/**
 * Who can be seated (roadmap §3.5: seating's `OccupantDirectory`, implemented by guests).
 * `occupantsTx` lists the parties of the event with the guests who belong on the chart: for a
 * sub-event, the guests invited to it (plus-ones follow their host); for the event plan, every
 * guest. Each guest's `status` is their RSVP for that chart.
 */
export interface OccupantDirectory {
  subEventsTx(tx: TenantTx, eventId: string): Promise<readonly OccupantSubEvent[]>;
  occupantsTx(tx: TenantTx, eventId: string, subEventId: string | null): Promise<readonly OccupantParty[]>;
}

let directory: OccupantDirectory | null = null;

/** Register the directory (the apps' composition roots and the test ports). */
export function setOccupantDirectory(d: OccupantDirectory) {
  directory = d;
}

function occupants(): OccupantDirectory {
  if (!directory) throw new DomainError('internal', 'No occupant directory is registered');
  return directory;
}

/* -------------------------------------------------------------------- realtime ---- */

/**
 * Guest seating changes of one event (ids only): the editor re-reads. Published by the seating
 * commands in their transaction; the guest list's own changes travel on the guests module's
 * `event.guests` channel.
 */
export const GUEST_SEATS_CHANNEL = defineRealtimeChannel({
  scope: 'event',
  topic: 'guest-seats',
  source: 'log',
  description: 'Guest seating of one event: which tables changed (the editor re-reads)',
  entitlement: 'seating',
  access: { permission: 'guests:read' },
  events: {
    seats: z.object({
      subEventId: z.uuid().nullable(),
      itemIds: z.array(z.uuid()).max(50),
      at: z.iso.datetime({ offset: true }),
    }),
  },
});

export async function publishSeatsTx(
  tx: TenantTx,
  orgId: string,
  eventId: string,
  subEventId: string | null,
  itemIds: readonly string[],
  now: Date,
) {
  await publishRealtimeTx(tx, orgId, GUEST_SEATS_CHANNEL, {
    eventId,
    event: 'seats',
    data: { subEventId, itemIds: [...new Set(itemIds)].slice(0, 50), at: now.toISOString() },
  });
}

/* --------------------------------------------------------------------- charts ---- */

export const PLACE_KINDS = ['table', 'row'] as const;

interface Place {
  readonly itemId: string;
  readonly kind: (typeof PLACE_KINDS)[number];
  readonly label: string;
  readonly capacity: number;
  readonly sectionVip: boolean;
}

interface Chart {
  readonly source: (typeof SUB_EVENT_CHART_SOURCES)[number];
  readonly doc: FloorplanDoc | null;
  readonly places: readonly Place[];
}

function placesOf(doc: FloorplanDoc): Place[] {
  const vipSections = new Set(doc.sections.filter((s) => s.vip).map((s) => s.id));
  return doc.items.flatMap((i) =>
    i.kind === 'object'
      ? []
      : [
          {
            itemId: i.id,
            kind: i.kind,
            label: i.label,
            capacity: i.seats.length,
            sectionVip: i.sectionId !== null && vipSections.has(i.sectionId),
          },
        ],
  );
}

/** The chart guests are seated on: the event plan, or the chart the sub-event uses. */
async function chartTx(tx: TenantTx, eventId: string, sub: OccupantSubEvent | null): Promise<Chart> {
  if (!sub) {
    const plan = await eventLayoutTx(tx, eventId, null);
    const doc = plan ? FloorplanDoc.parse(plan.doc) : null;
    return { source: doc ? 'event' : 'none', doc, places: doc ? placesOf(doc) : [] };
  }
  const resolved = await resolveSubEventChartTx(tx, eventId, sub);
  let raw: unknown = null;
  if (resolved.source === 'sub_event') {
    const [own] = await tx
      .select({ doc: subEventCharts.doc })
      .from(subEventCharts)
      .where(and(eq(subEventCharts.eventId, eventId), eq(subEventCharts.subEventId, sub.id)));
    raw = own?.doc ?? null;
  } else if (resolved.source !== 'none') {
    raw = (await eventLayoutTx(tx, eventId, resolved.chartKey))?.doc ?? null;
  }
  const doc = raw ? FloorplanDoc.parse(raw) : null;
  return { source: doc ? resolved.source : 'none', doc, places: doc ? placesOf(doc) : [] };
}

/**
 * Seats of the event plan nobody else may use: sold or held to a buyer, given to an attendee
 * (M1.7d) or killed. Guest seating counts them as taken; it never changes them.
 */
async function takenByItemTx(tx: TenantTx, eventId: string): Promise<Map<string, number>> {
  const rows = await tx
    .select({ itemId: eventSeats.itemId, n: sql<number>`count(*)::int` })
    .from(eventSeats)
    .where(
      and(
        onChart(eventSeats, eventId, null),
        sql`(${eventSeats.status} in ('sold', 'held') or ${eventSeats.blockReason} in ('assigned', 'kill'))`,
      ),
    )
    .groupBy(eventSeats.itemId);
  return new Map(rows.map((r) => [r.itemId, Number(r.n)]));
}

export const onContext = (eventId: string, subEventId: string | null) =>
  and(
    eq(guestSeats.eventId, eventId),
    subEventId ? eq(guestSeats.subEventId, subEventId) : isNull(guestSeats.subEventId),
  );

async function seatedTx(tx: TenantTx, eventId: string, subEventId: string | null) {
  return tx
    .select({ guestId: guestSeats.guestId, itemId: guestSeats.itemId })
    .from(guestSeats)
    .where(onContext(eventId, subEventId));
}

async function vipItemsTx(tx: TenantTx, eventId: string): Promise<Set<string>> {
  const rows = await tx
    .select({ itemId: vipTables.itemId })
    .from(vipTables)
    .where(eq(vipTables.eventId, eventId));
  return new Set(rows.map((r) => r.itemId));
}

async function subEventOf(tx: TenantTx, eventId: string, subEventId: string | null) {
  if (!subEventId) return null;
  const sub = (await occupants().subEventsTx(tx, eventId)).find((s) => s.id === subEventId);
  if (!sub) throw new DomainError('not_found', 'Sub-event not found', { field: 'subEventId' });
  return sub;
}

/** The editor's whole view, assembled once (the query and the commands' checks share it). */
export async function viewTx(tx: TenantTx, eventId: string, subEventId: string | null) {
  const dir = occupants();
  const subEvents = await dir.subEventsTx(tx, eventId);
  const sub = subEventId ? subEvents.find((s) => s.id === subEventId) : null;
  if (subEventId && !sub) throw new DomainError('not_found', 'Sub-event not found', { field: 'subEventId' });
  const [chart, parties, seated, vip, taken] = await Promise.all([
    chartTx(tx, eventId, sub ?? null),
    dir.occupantsTx(tx, eventId, subEventId),
    seatedTx(tx, eventId, subEventId),
    vipItemsTx(tx, eventId),
    subEventId ? Promise.resolve(new Map<string, number>()) : takenByItemTx(tx, eventId),
  ]);
  const places = new Map(chart.places.map((p) => [p.itemId, p]));
  const known = new Map(parties.flatMap((p) => p.guests.map((g) => [g.id, { guest: g, party: p }] as const)));
  // A place on a table the chart no longer has (the plan changed) is no place: back to the queue.
  const placed = seated.filter((s) => places.has(s.itemId) && known.has(s.guestId));
  return { subEvents, chart, parties, placed, vip, taken, places, known };
}

/* ------------------------------------------------------------------------- DTO ---- */

export const GuestSeatDto = z.object({
  id: z.uuid(),
  kind: z.enum(['guest', 'plus_one']),
  name: z.string().nullable(),
  guestOf: z.string().nullable(),
  ageClass: z.enum(['adult', 'child', 'infant']),
  meal: z.string().nullable(),
  status: z.enum(OCCUPANT_STATUSES),
  /** The table or row the guest sits at on this chart, or null (in the queue). */
  itemId: z.uuid().nullable(),
});
export type GuestSeatDto = z.infer<typeof GuestSeatDto>;

export const SeatingPartyDto = z.object({
  id: z.uuid(),
  name: z.string(),
  vip: z.boolean(),
  side: z.string().nullable(),
  tags: z.array(z.string()),
  guests: z.array(GuestSeatDto),
});
export type SeatingPartyDto = z.infer<typeof SeatingPartyDto>;

export const SeatingPlaceDto = z.object({
  itemId: z.uuid(),
  kind: z.enum(PLACE_KINDS),
  label: z.string(),
  capacity: z.int(),
  /** Seats tickets or attendee seating hold (event plan only). */
  taken: z.int(),
  seated: z.int(),
  free: z.int(),
  /** A VIP zone: marked by the host, or in a VIP section of the plan. */
  vip: z.boolean(),
  /** The plan's own VIP section (the host can't unmark it here). */
  sectionVip: z.boolean(),
  sponsor: z.string().nullable(),
});
export type SeatingPlaceDto = z.infer<typeof SeatingPlaceDto>;

export const GuestSeatingDto = z.object({
  subEventId: z.uuid().nullable(),
  subEvents: z.array(z.object({ id: z.uuid(), name: z.string() })),
  source: z.enum(SUB_EVENT_CHART_SOURCES),
  doc: FloorplanDoc.nullable(),
  places: z.array(SeatingPlaceDto),
  parties: z.array(SeatingPartyDto),
  counts: z.object({
    guests: z.int(),
    seated: z.int(),
    unseated: z.int(),
    declinedSeated: z.int(),
  }),
});
export type GuestSeatingDto = z.infer<typeof GuestSeatingDto>;

const ContextInput = z.object({ eventId: z.uuid(), subEventId: z.uuid().nullable().default(null) });

/** The guest seating editor: the chart, its places with who sits there, and every party. */
export const guestSeatingQuery = tenantQuery({
  name: 'seating.guestSeating',
  input: ContextInput,
  output: GuestSeatingDto,
  entitlement: 'seating',
  permission: 'guests:read',
  handler: async ({ input, tx }) => {
    const v = await viewTx(tx, input.eventId, input.subEventId);
    const sponsors = input.subEventId
      ? []
      : await tx
          .select({ itemId: tableSponsors.itemId, name: tableSponsors.sponsorName })
          .from(tableSponsors)
          .where(eq(tableSponsors.eventId, input.eventId));
    const sponsorOf = new Map(sponsors.map((s) => [s.itemId, s.name]));
    const at = new Map(v.placed.map((s) => [s.guestId, s.itemId]));
    const places = v.chart.places.map((p) => {
      const seated = v.placed.filter((s) => s.itemId === p.itemId).length;
      const taken = v.taken.get(p.itemId) ?? 0;
      return {
        itemId: p.itemId,
        kind: p.kind,
        label: p.label,
        capacity: p.capacity,
        taken,
        seated,
        free: Math.max(0, p.capacity - taken - seated),
        vip: p.sectionVip || v.vip.has(p.itemId),
        sectionVip: p.sectionVip,
        sponsor: sponsorOf.get(p.itemId) ?? null,
      };
    });
    const parties = v.parties.map((p) => ({
      id: p.id,
      name: p.name,
      vip: p.vip,
      side: p.side,
      tags: [...p.tags],
      guests: p.guests.map((g) => ({
        id: g.id,
        kind: g.kind,
        name: g.name,
        guestOf: g.guestOf,
        ageClass: g.ageClass,
        meal: g.meal,
        status: g.status,
        itemId: at.get(g.id) ?? null,
      })),
    }));
    const all = parties.flatMap((p) => p.guests);
    return GuestSeatingDto.parse({
      subEventId: input.subEventId,
      subEvents: v.subEvents.map((s) => ({ id: s.id, name: s.name })),
      source: v.chart.source,
      doc: v.chart.doc,
      places,
      parties,
      counts: {
        guests: all.filter((g) => g.status !== 'declined').length,
        seated: all.filter((g) => g.itemId && g.status !== 'declined').length,
        unseated: all.filter((g) => !g.itemId && g.status !== 'declined').length,
        declinedSeated: all.filter((g) => g.itemId && g.status === 'declined').length,
      },
    });
  },
});

/* -------------------------------------------------------------------- commands ---- */

/** One host at a time per chart: capacity is checked and written under this lock. */
export const lockChartTx = (tx: TenantTx, eventId: string, subEventId: string | null) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`guest-seats:${eventId}:${subEventId ?? 'plan'}`}, 0))`,
  );

export const MAX_GUESTS_PER_SEATING = 200;

export const SeatGuestsInput = ContextInput.extend({
  itemId: z.uuid(),
  guestIds: z.array(z.uuid()).min(1).max(MAX_GUESTS_PER_SEATING),
});

export const SeatGuestsResult = z.object({
  /** Guests who got a seat here (moved from another table or from the queue). */
  seated: z.int(),
  /** VIP zone warnings, one per party that got one (never a refusal). */
  warnings: z.array(z.object({ partyId: z.uuid(), kind: z.enum(VIP_WARNINGS) })),
});

/**
 * Seat guests at a table or row (a party, several parties of a group, or one guest; moving a
 * seated guest is the same). All or nothing: when they don't all fit, nothing changes
 * (`cant_fit`, with how many do). Declined guests are refused; pending ones may be seated.
 */
export const seatGuestsCommand = tenantCommand({
  name: 'seating.seatGuests',
  input: SeatGuestsInput,
  output: SeatGuestsResult,
  entitlement: 'seating',
  permission: 'seating:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    await lockChartTx(tx, input.eventId, input.subEventId);
    const v = await viewTx(tx, input.eventId, input.subEventId);
    if (!v.chart.doc) throw new DomainError('not_found', 'There is no seating plan', { reason: 'no_plan' });
    const place = v.places.get(input.itemId);
    if (!place)
      throw new DomainError('validation_failed', 'Choose a table or row of the plan', {
        field: 'itemId',
        reason: 'not_a_place',
      });
    const ids = [...new Set(input.guestIds)];
    for (const id of ids) {
      const k = v.known.get(id);
      if (!k)
        throw new DomainError('not_found', 'Guest not found', { field: 'guestIds', reason: 'unknown_guest' });
      if (k.guest.status === 'declined')
        throw new DomainError('invalid_state', 'This guest declined', { reason: 'declined', guestId: id });
    }
    const fit = fitAt(
      { itemId: place.itemId, capacity: place.capacity, taken: v.taken.get(place.itemId) ?? 0, vip: false },
      v.placed,
      ids,
    );
    if (!fit.ok)
      throw new DomainError('conflict', `Only ${fit.fits} more fit here`, {
        reason: 'cant_fit',
        asked: fit.asked,
        fits: fit.fits,
      });
    const from = v.placed.filter((s) => fit.moving.includes(s.guestId)).map((s) => s.itemId);
    if (fit.moving.length) {
      // Any stale place (a table the chart lost) goes too: one place per guest per chart.
      await tx
        .delete(guestSeats)
        .where(and(onContext(input.eventId, input.subEventId), inArray(guestSeats.guestId, [...fit.moving])));
      await tx.insert(guestSeats).values(
        fit.moving.map((guestId) => ({
          orgId,
          eventId: input.eventId,
          subEventId: input.subEventId,
          guestId,
          itemId: place.itemId,
        })),
      );
      await publishSeatsTx(tx, orgId, input.eventId, input.subEventId, [place.itemId, ...from], ctx.now);
    }
    const placeVip = place.sectionVip || v.vip.has(place.itemId);
    const partyIds = [...new Set(ids.map((id) => v.known.get(id)?.party.id ?? ''))];
    const warnings = partyIds.flatMap((pid) => {
      const party = v.parties.find((p) => p.id === pid);
      const kind = party ? vipWarning(party.vip, placeVip) : null;
      return kind ? [{ partyId: pid, kind }] : [];
    });
    return { seated: fit.moving.length, warnings };
  },
  audit: (input, out) => ({
    action: 'seating.guests.seat',
    targetType: 'event',
    targetId: input.eventId,
    data: { subEventId: input.subEventId, itemId: input.itemId, count: out.seated },
  }),
});

/** Take guests back to the queue (their place on this chart goes). */
export const unseatGuestsCommand = tenantCommand({
  name: 'seating.unseatGuests',
  input: ContextInput.extend({ guestIds: z.array(z.uuid()).min(1).max(MAX_GUESTS_PER_SEATING) }),
  output: z.object({ unseated: z.int() }),
  entitlement: 'seating',
  permission: 'seating:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    await subEventOf(tx, input.eventId, input.subEventId);
    await lockChartTx(tx, input.eventId, input.subEventId);
    const gone = await tx
      .delete(guestSeats)
      .where(
        and(
          onContext(input.eventId, input.subEventId),
          inArray(guestSeats.guestId, [...new Set(input.guestIds)]),
        ),
      )
      .returning({ itemId: guestSeats.itemId });
    if (gone.length)
      await publishSeatsTx(
        tx,
        orgId,
        input.eventId,
        input.subEventId,
        gone.map((g) => g.itemId),
        ctx.now,
      );
    return { unseated: gone.length };
  },
  audit: (input, out) => ({
    action: 'seating.guests.unseat',
    targetType: 'event',
    targetId: input.eventId,
    data: { subEventId: input.subEventId, count: out.unseated },
  }),
});

/** Mark (or unmark) a table or row of the chart as a VIP zone (every chart of the event). */
export const setVipTableCommand = tenantCommand({
  name: 'seating.setVipTable',
  input: ContextInput.extend({ itemId: z.uuid(), vip: z.boolean() }),
  output: z.object({ itemId: z.uuid(), vip: z.boolean() }),
  entitlement: 'seating',
  permission: 'seating:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const sub = await subEventOf(tx, input.eventId, input.subEventId);
    const chart = await chartTx(tx, input.eventId, sub);
    if (!chart.doc) throw new DomainError('not_found', 'There is no seating plan', { reason: 'no_plan' });
    if (!chart.places.some((p) => p.itemId === input.itemId))
      throw new DomainError('validation_failed', 'Choose a table or row of the plan', {
        field: 'itemId',
        reason: 'not_a_place',
      });
    if (input.vip)
      await tx
        .insert(vipTables)
        .values({ orgId, eventId: input.eventId, itemId: input.itemId })
        .onConflictDoNothing();
    else
      await tx
        .delete(vipTables)
        .where(and(eq(vipTables.eventId, input.eventId), eq(vipTables.itemId, input.itemId)));
    await publishSeatsTx(tx, orgId, input.eventId, input.subEventId, [input.itemId], ctx.now);
    return { itemId: input.itemId, vip: input.vip };
  },
  audit: (input) => ({
    action: 'seating.vip_table.set',
    targetType: 'event',
    targetId: input.eventId,
    data: { itemId: input.itemId, vip: input.vip },
  }),
});
