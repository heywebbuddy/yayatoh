import { attendeesByIdsTx } from '@yayatoh/attendees';
import type { TenantTx } from '@yayatoh/db';
import { tenantQuery } from '@yayatoh/platform';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { guestPassSerial, hubTally } from './domain/hub.ts';
import { rsvpOpen } from './domain/rsvp.ts';
import { linkPartyTx } from './rsvp.ts';
import { eventOfTx, partyFacts, partyOfTx, rsvpFactsTx, settingsTx } from './rsvp-state.ts';
import { GUEST_KINDS, RESPONSE_STATUSES, SUB_EVENT_KINDS, sites } from './schema.ts';

/**
 * The party's guest hub (M4.7a): one mobile page per party, reached by the party's RSVP link
 * (same token, same reset, same expiry), with its RSVP, program, seats and tickets, installable to
 * the home screen. Seats and tickets belong to seating and ticketing (this module's tier), so the
 * app passes their readers in (`partySeatsTx`, `partyTicketsTx`), the way the Command Center gets
 * campaign names. Whatever they return is parsed through this DTO: the allowlist (P4-3).
 */

/** A person of the party as seating and ticketing know them (guest-list entry and/or ticket). */
export interface HubPerson {
  readonly attendeeId: string | null;
  readonly ticketId: string | null;
}

export interface HubSeat {
  readonly itemKind: 'row' | 'table';
  readonly itemLabel: string;
  readonly seatLabel: string;
  readonly sponsor: string | null;
}

export interface HubTicket {
  readonly id: string;
  readonly serial: number;
  readonly shortCode: string;
  readonly typeName: string;
  readonly holderName: string;
  /** The signed yy1 code the QR carries. */
  readonly code: string;
}

export interface PartyHubReaders {
  /** The party's seats, or null while the hosts haven't shared the seating (finder closed). */
  readonly seats: (
    tx: TenantTx,
    eventId: string,
    people: readonly HubPerson[],
  ) => Promise<{ seats: readonly HubSeat[]; unseated: number } | null>;
  /** The party's active tickets with their current codes (others are left out). */
  readonly tickets: (tx: TenantTx, eventId: string, ticketIds: readonly string[]) => Promise<readonly HubTicket[]>;
}

const Token = z.string().min(10).max(200);

const HubGuest = z.object({
  id: z.uuid(),
  kind: z.enum(GUEST_KINDS),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  hostFirstName: z.string().nullable(),
});

export const PartyHubDto = z.discriminatedUnion('state', [
  /** A link past its expiry (60 days after the event): the event's name and nothing else. */
  z.object({ state: z.literal('expired'), eventName: z.string() }),
  z.object({
    state: z.literal('ok'),
    eventName: z.string(),
    timezone: z.string(),
    startsAt: z.date(),
    endsAt: z.date(),
    /** The envelope name, else the party's name. */
    partyName: z.string(),
    /** The serial of the party's wallet pass. */
    passSerial: z.string(),
    rsvp: z.object({
      open: z.boolean(),
      deadline: z.date().nullable(),
      respondedAt: z.date().nullable(),
      attending: z.int().min(0),
      declined: z.int().min(0),
      awaiting: z.int().min(0),
    }),
    /** The party's own invited guests, plus-ones after their host. */
    guests: z.array(HubGuest),
    /** Only the sub-events the party is invited to, each with the party's answers. */
    program: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        kind: z.enum(SUB_EVENT_KINDS),
        startsAt: z.date(),
        endsAt: z.date(),
        place: z.string().nullable(),
        answers: z.array(z.object({ guestId: z.uuid(), status: z.enum(RESPONSE_STATUSES).nullable() })),
      }),
    ),
    /** Null while the hosts haven't shared the seating. */
    seating: z
      .object({
        seats: z.array(
          z.object({
            itemKind: z.enum(['row', 'table']),
            itemLabel: z.string(),
            seatLabel: z.string(),
            sponsor: z.string().nullable(),
          }),
        ),
        unseated: z.int().min(0),
      })
      .nullable(),
    tickets: z.array(
      z.object({
        id: z.uuid(),
        serial: z.int(),
        shortCode: z.string(),
        typeName: z.string(),
        holderName: z.string(),
        code: z.string(),
      }),
    ),
    /** The published guest website's address code (it still asks for its password). */
    siteCode: z.string().nullable(),
  }),
]);
export type PartyHubDto = z.infer<typeof PartyHubDto>;
export type PartyHubView = Extract<PartyHubDto, { state: 'ok' }>;

/** The hub query, with seating's and ticketing's readers (see the file comment). */
export const partyHubQuery = (readers: PartyHubReaders) =>
  tenantQuery({
    name: 'guests.partyHub',
    input: z.object({ token: Token }),
    output: PartyHubDto,
    entitlement: 'guests',
    permission: 'public:rsvp',
    handler: async ({ input, ctx, tx }) => {
      const row = await linkPartyTx(tx, input.token);
      const ev = await eventOfTx(tx, row.eventId);
      if (row.linkExpiresAt.getTime() <= ctx.now.getTime()) return { state: 'expired' as const, eventName: ev.name };
      const settings = await settingsTx(tx, row.eventId);
      const party = await partyOfTx(tx, row.eventId, row.partyId);
      const all = await rsvpFactsTx(tx, row.eventId, [row.partyId]);
      const f = partyFacts(all, row.partyId);
      const byId = new Map(f.guests.map((g) => [g.id, g]));
      const ordered = f.guests
        .filter((g) => g.kind === 'guest')
        .flatMap((g) => [g, ...f.guests.filter((p) => p.hostGuestId === g.id)]);
      const invitedIds = new Set([...f.invited.values()].flatMap((s) => [...s]));
      const program = all.subs
        .filter((s) => f.invited.has(s.id))
        .map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.kind,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          place: s.place,
          answers: ordered
            .filter((g) => f.invited.get(s.id)?.has(g.id))
            .map((g) => ({ guestId: g.id, status: all.responses.get(s.id)?.get(g.id) ?? null })),
        }));

      // Seats and tickets: the party's guests as seating and ticketing know them.
      const linked = await attendeesByIdsTx(
        tx,
        f.guests.flatMap((g) => (g.attendeeId ? [g.attendeeId] : [])),
      );
      const attendee = new Map(
        linked.filter((a) => a.eventId === row.eventId).map((a) => [a.id, a] as const),
      );
      const people: HubPerson[] = f.guests.flatMap((g) => {
        const a = g.attendeeId ? attendee.get(g.attendeeId) : undefined;
        const ticketId = g.ticketId ?? a?.ticketId ?? null;
        return a || ticketId ? [{ attendeeId: a?.id ?? null, ticketId }] : [];
      });
      const ticketIds = [...new Set(people.flatMap((p) => (p.ticketId ? [p.ticketId] : [])))];
      const [seating, tickets] = await Promise.all([
        readers.seats(tx, row.eventId, people),
        ticketIds.length ? readers.tickets(tx, row.eventId, ticketIds) : Promise.resolve([]),
      ]);
      const [site] = await tx
        .select({ code: sites.code })
        .from(sites)
        .where(and(eq(sites.eventId, row.eventId), eq(sites.status, 'published')));

      return {
        state: 'ok' as const,
        eventName: ev.name,
        timezone: ev.timezone,
        startsAt: ev.startsAt,
        endsAt: ev.endsAt,
        partyName: party.envelopeName ?? party.name,
        passSerial: guestPassSerial(row.partyId),
        rsvp: {
          open: rsvpOpen(settings?.deadline ?? null, ctx.now, row.reopened),
          deadline: settings?.deadline ?? null,
          respondedAt: row.respondedAt,
          ...hubTally(program.flatMap((p) => p.answers)),
        },
        guests: ordered
          .filter((g) => invitedIds.has(g.id))
          .map((g) => ({
            id: g.id,
            kind: g.kind as (typeof GUEST_KINDS)[number],
            firstName: g.firstName,
            lastName: g.lastName,
            hostFirstName: g.hostGuestId ? (byId.get(g.hostGuestId)?.firstName ?? null) : null,
          })),
        program,
        seating: seating ? { seats: [...seating.seats], unseated: seating.unseated } : null,
        tickets: [...tickets],
        siteCode: site?.code ?? null,
      };
    },
  });
