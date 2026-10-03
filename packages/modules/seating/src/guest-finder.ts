import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { FloorplanDoc } from '@yayatoh/floorplan';
import { DomainError } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { z } from 'zod';
import { publicDoc } from './chart.ts';
import { type FinderPlaceRef, type PartyOnChart, partyOnChart } from './domain/guest-finder.ts';
import { PLACE_KINDS, viewTx } from './guest-seating.ts';
import { openFinderTx, overLimitTx } from './seat-finder.ts';
import { publicTableSponsorsTx } from './table-sponsors.ts';

/**
 * The guest seat finder (M4.4a, plan row M4.4a, P4-2, P4-3): wedding and gala guests seated by
 * the host (M4.3a, `guest_seats`, table-level) find their table.
 *
 * - **Signed in through their party link** (the M4.1d link, printed as a QR code on the
 *   invitation; the same link always works however the party is moved, so the QR is permanent):
 *   the party's own guests with their table or row on every chart it is on (the event plan, each
 *   sub-event it is invited to), highlighted on the map, and their **tablemates** as the host
 *   named them. Only this path ever returns a name (P4-3 d).
 * - **PIN mode** (the organizer's finder mode `pin`): a guest's exact full name plus the party's
 *   PIN. The answer carries table labels and counts only, never a name, and a miss (unknown,
 *   partial or misspelled name, wrong PIN) is one reply after the same work, so nobody can tell
 *   whether a name is on the list.
 *
 * Nothing is shown until the organizer opened the venue map and seat finder (`public_map`). The
 * party's credentials live in guests (same tier), reached through the `PartyCredentials` port.
 */

/* ------------------------------------------------------------------------ the port ---- */

export interface PartyCredentials {
  /** The party of a signed link (null: bad, reset, foreign or expired). */
  partyByLinkTx(
    tx: TenantTx,
    token: string,
    now: Date,
  ): Promise<{ eventId: string; partyId: string; partyName: string } | null>;
  /** The party behind an exact full name and its PIN (null on any miss, after the same work). */
  partyByNamePinTx(
    tx: TenantTx,
    eventId: string,
    name: string,
    pin: string,
  ): Promise<{ partyId: string } | null>;
}

let credentials: PartyCredentials | null = null;

/** Register the credentials (the apps' composition roots and the test ports). */
export function setPartyCredentials(c: PartyCredentials) {
  credentials = c;
}

function partyCredentials(): PartyCredentials {
  if (!credentials) throw new DomainError('internal', 'No party credentials are registered');
  return credentials;
}

/* --------------------------------------------------------------------------- charts ---- */

interface ChartPlaces {
  readonly subEventId: string | null;
  readonly name: string | null;
  readonly doc: FloorplanDoc;
  readonly on: PartyOnChart;
}

/**
 * Every chart the party is on, with where it sits: each sub-event it is invited to (on the chart
 * the sub-event uses), and the event plan when the event has no sub-events or the party has a
 * place on it. Charts without a plan are skipped.
 */
async function partyChartsTx(tx: TenantTx, eventId: string, partyId: string): Promise<ChartPlaces[]> {
  const plan = await viewTx(tx, eventId, null);
  const out: ChartPlaces[] = [];
  const add = (subEventId: string | null, name: string | null, v: Awaited<ReturnType<typeof viewTx>>) => {
    if (!v.chart.doc) return;
    const places: FinderPlaceRef[] = v.chart.places.map((p) => ({
      itemId: p.itemId,
      kind: p.kind,
      label: p.label,
    }));
    const on = partyOnChart({ partyId, parties: v.parties, placed: v.placed, places });
    if (!on) return;
    if (subEventId === null && plan.subEvents.length > 0 && on.places.length === 0) return;
    out.push({ subEventId, name, doc: publicDoc(v.chart.doc), on });
  };
  add(null, null, plan);
  for (const sub of plan.subEvents) add(sub.id, sub.name, await viewTx(tx, eventId, sub.id));
  return out;
}

const Person = z.object({ name: z.string().nullable(), guestOf: z.string().nullable() });

/* ------------------------------------------------------------------- the party's page ---- */

export const PARTY_SEATS_STATES = ['open', 'closed'] as const;

/** What a party signed in through its own link sees (P4-3 d: tablemates only here). */
export const PartySeatsDto = z.object({
  /** `closed` until the organizer opens the seat finder: nothing about tables is shown. */
  state: z.enum(PARTY_SEATS_STATES),
  eventName: z.string(),
  eventSlug: z.string(),
  /** The name the host chose for the party (envelope name, else the party's name). */
  partyName: z.string(),
  charts: z.array(
    z.object({
      /** Null = the event plan. */
      subEventId: z.uuid().nullable(),
      /** The sub-event's name (null for the event plan). */
      name: z.string().nullable(),
      doc: FloorplanDoc,
      places: z.array(
        z.object({
          itemId: z.uuid(),
          itemKind: z.enum(PLACE_KINDS),
          itemLabel: z.string(),
          sponsor: z.string().nullable(),
          sponsorLogoUrl: z.string().nullable(),
          guests: z.array(Person.extend({ id: z.uuid() })),
          tablemates: z.array(Person),
        }),
      ),
      unseated: z.array(Person.extend({ id: z.uuid() })),
    }),
  ),
});
export type PartySeatsDto = z.infer<typeof PartySeatsDto>;

const Token = z.string().min(10).max(200);

/**
 * Public: the party behind a signed link, its tables on every chart it is on, and its
 * tablemates. A bad, reset or expired link is `not_found` (the page 404s).
 */
export const partySeatsQuery = tenantQuery({
  name: 'seating.partySeats',
  input: z.object({ token: Token }),
  output: PartySeatsDto,
  entitlement: 'seat_finder',
  permission: 'public:seat_finder',
  handler: async ({ input, ctx, tx }) => {
    const party = await partyCredentials().partyByLinkTx(tx, input.token, ctx.now);
    if (!party) throw new DomainError('not_found', 'Unknown link', { reason: 'unknown_link' });
    const ev = await findEventTx(tx, party.eventId);
    if (!ev) throw new DomainError('not_found', 'Unknown link', { reason: 'unknown_link' });
    const base = { eventName: ev.name, eventSlug: ev.slug, partyName: party.partyName };
    try {
      await openFinderTx(tx, party.eventId, null);
    } catch (err) {
      if (err instanceof DomainError && err.code === 'not_found')
        return { ...base, state: 'closed' as const, charts: [] };
      throw err;
    }
    const charts = await partyChartsTx(tx, party.eventId, party.partyId);
    const sponsors = await publicTableSponsorsTx(
      tx,
      party.eventId,
      charts.flatMap((c) => c.on.places.map((p) => p.itemId)),
    );
    return {
      ...base,
      state: 'open' as const,
      charts: charts.map((c) => ({
        subEventId: c.subEventId,
        name: c.name,
        doc: c.doc,
        places: c.on.places.map((p) => ({
          itemId: p.itemId,
          itemKind: p.kind,
          itemLabel: p.label,
          sponsor: sponsors.get(p.itemId)?.sponsorName ?? null,
          sponsorLogoUrl: sponsors.get(p.itemId)?.logoUrl ?? null,
          guests: p.guests.map((g) => ({ id: g.id, name: g.name, guestOf: g.guestOf })),
          tablemates: p.tablemates.map((g) => ({ name: g.name, guestOf: g.guestOf })),
        })),
        unseated: c.on.unseated.map((g) => ({ id: g.id, name: g.name, guestOf: g.guestOf })),
      })),
    };
  },
});

/* --------------------------------------------------------------------------- PIN mode ---- */

/** A PIN lookup's answer: tables and how many of the party sit there. Never a name. */
export const GuestSeatResultDto = z.object({
  charts: z.array(
    z.object({
      subEventId: z.uuid().nullable(),
      name: z.string().nullable(),
      /** The chart as drawn (the venue map highlights the tables); nothing about who sits where. */
      doc: FloorplanDoc,
      places: z.array(
        z.object({
          itemId: z.uuid(),
          itemKind: z.enum(PLACE_KINDS),
          itemLabel: z.string(),
          sponsor: z.string().nullable(),
          sponsorLogoUrl: z.string().nullable(),
          /** How many of the party sit here. */
          count: z.int().min(1),
        }),
      ),
      /** How many of the party have no place on this chart yet. */
      unseated: z.int().min(0),
    }),
  ),
});
export type GuestSeatResultDto = z.infer<typeof GuestSeatResultDto>;

export const PIN_LOOKUP_STATUSES = ['found', 'no_match', 'challenge'] as const;

/**
 * Public, when the organizer chose PIN mode: a guest's exact full name and the PIN printed on the
 * party's invitation. `no_match` for every miss, after the same work; past the device's budget
 * for the event, a human check first (`challenge`). The web action also applies the M1.14
 * `rsvpLookup` limiter before this.
 */
export const findGuestSeatByPinCommand = tenantCommand({
  name: 'seating.findGuestSeatByPin',
  input: z.object({
    eventId: z.uuid(),
    name: z.string().trim().min(1).max(170),
    pin: z.string().trim().max(20),
    device: z.string().min(1).max(128),
    human: z.boolean().default(false),
  }),
  output: z.object({ status: z.enum(PIN_LOOKUP_STATUSES), result: GuestSeatResultDto.nullable() }),
  entitlement: 'seat_finder',
  permission: 'public:seat_finder',
  handler: async ({ input, ctx, tx }) => {
    await openFinderTx(tx, input.eventId, 'pin');
    if ((await overLimitTx(tx, ctx, input.eventId, input.device)) && !input.human)
      return { status: 'challenge' as const, result: null };
    const party = await partyCredentials().partyByNamePinTx(tx, input.eventId, input.name, input.pin);
    if (!party) return { status: 'no_match' as const, result: null };
    const charts = await partyChartsTx(tx, input.eventId, party.partyId);
    const sponsors = await publicTableSponsorsTx(
      tx,
      input.eventId,
      charts.flatMap((c) => c.on.places.map((p) => p.itemId)),
    );
    return {
      status: 'found' as const,
      result: {
        charts: charts.map((c) => ({
          subEventId: c.subEventId,
          name: c.name,
          doc: c.doc,
          places: c.on.places.map((p) => ({
            itemId: p.itemId,
            itemKind: p.kind,
            itemLabel: p.label,
            sponsor: sponsors.get(p.itemId)?.sponsorName ?? null,
            sponsorLogoUrl: sponsors.get(p.itemId)?.logoUrl ?? null,
            count: p.guests.length,
          })),
          unseated: c.on.unseated.length,
        })),
      },
    };
  },
  audit: (input, r) => ({
    action: 'seating.finder_pin_lookup',
    targetType: 'event',
    targetId: input.eventId,
    data: { status: r?.status },
  }),
});
