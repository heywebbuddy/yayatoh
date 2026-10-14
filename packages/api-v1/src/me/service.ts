import { checkpointsForTicketTx } from '@yayatoh/checkin';
import { normalizeEmail } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { eventTicketFactsTx } from '@yayatoh/events';
import { type Ctx, createCtx } from '@yayatoh/kernel';
import { orgsWithAppAccess } from '@yayatoh/notifications';
import { organizationBrandTx } from '@yayatoh/tenancy';
import { type MyTicketDto, myTicketsTx } from '@yayatoh/ticketing';
import { findVenueTx } from '@yayatoh/venues';

/**
 * The attendee app's read model of a person's tickets (M7.2b). A person is their verified email;
 * the orgs where that address holds a ticket or bought an order come from the existing
 * SECURITY DEFINER lookup the push registration uses (`notifications.app_orgs_by_email`: org ids
 * only), and every row is then read under that org's RLS in its own tenant transaction. Nothing here
 * reads across orgs, and nothing takes an email from the request: the caller passes the session's.
 */
const actor = { type: 'system' as const, name: 'me.tickets' };
/** Orgs read at once; each is its own transaction. */
const CONCURRENCY = 6;

/** A person's context inside one org, for the commands that act for them (their own actor). */
export function orgCtx(me: Ctx, orgId: string): Ctx {
  return createCtx({
    orgId,
    requestId: me.requestId,
    actor: me.actor,
    locale: me.locale,
    stepUpAt: me.stepUpAt,
    idempotencyKey: me.idempotencyKey,
  });
}

export const personKey = (email: string) => normalizeEmail(email);

async function eachOrg<T>(orgIds: readonly string[], fn: (orgId: string) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < orgIds.length; i += CONCURRENCY)
    out.push(...(await Promise.all(orgIds.slice(i, i + CONCURRENCY).map(fn))));
  return out;
}

/** A ticket with the org's branding facts, before it is shaped for the wire. */
export interface PersonTicket {
  readonly ticket: MyTicketDto;
  readonly orgId: string;
  readonly organizerName: string;
  readonly brand: {
    readonly logoPath: string | null;
    readonly logoAlt: string | null;
    readonly accentColor: string | null;
    readonly poweredByVisible: boolean;
  };
}

/** The person's active tickets in every org they hold one in. */
export async function personTickets(email: string): Promise<PersonTicket[]> {
  const key = personKey(email);
  const orgs = await orgsWithAppAccess(key);
  const perOrg = await eachOrg(orgs, (orgId) =>
    withTenant(createCtx({ orgId, actor }), async (tx) => {
      const ctx = createCtx({ orgId, actor });
      const tickets = await myTicketsTx(tx, ctx, orgId, key);
      if (tickets.length === 0) return [];
      const org = await organizationBrandTx(tx, orgId);
      const facts = await eventTicketFactsTx(tx, [...new Set(tickets.map((t) => t.eventId))]);
      return tickets.map(
        (ticket): PersonTicket => ({
          ticket,
          orgId,
          organizerName: org?.name ?? '',
          brand: {
            logoPath: org?.logoPath ?? null,
            logoAlt: org?.logoAlt ?? null,
            accentColor: facts.get(ticket.eventId)?.brandColor ?? org?.brandColor ?? null,
            poweredByVisible: org?.poweredByVisible ?? true,
          },
        }),
      );
    }),
  );
  return perOrg.flat();
}

export interface PersonTicketDetail extends PersonTicket {
  readonly checkpoints: { name: string; kind: 'entrance' | 'zone' }[];
  readonly venue: {
    name: string;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    country: string | null;
    latitude: number | null;
    longitude: number | null;
    mapUrl: string | null;
    accessibilityNotes: string | null;
  } | null;
}

async function ticketDetailInOrg(
  orgId: string,
  key: string,
  ticketId: string,
): Promise<PersonTicketDetail | null> {
  return withTenant(createCtx({ orgId, actor }), async (tx) => {
    const ctx = createCtx({ orgId, actor });
    const [ticket] = await myTicketsTx(tx, ctx, orgId, key, { ticketId });
    if (!ticket) return null;
    const org = await organizationBrandTx(tx, orgId);
    const facts = (await eventTicketFactsTx(tx, [ticket.eventId])).get(ticket.eventId);
    const venue = facts?.venueId ? await findVenueTx(tx, facts.venueId) : null;
    return {
      ticket,
      orgId,
      organizerName: org?.name ?? '',
      brand: {
        logoPath: org?.logoPath ?? null,
        logoAlt: org?.logoAlt ?? null,
        accentColor: facts?.brandColor ?? org?.brandColor ?? null,
        poweredByVisible: org?.poweredByVisible ?? true,
      },
      checkpoints: await checkpointsForTicketTx(tx, ticket.eventId, ticket.ticketTypeId),
      venue: venue
        ? {
            name: venue.name,
            addressLine1: venue.addressLine1,
            addressLine2: venue.addressLine2,
            city: venue.city,
            region: venue.region,
            postalCode: venue.postalCode,
            country: venue.country,
            latitude: venue.latitude,
            longitude: venue.longitude,
            mapUrl: venue.mapUrl,
            accessibilityNotes: venue.accessibilityNotes,
          }
        : null,
    };
  });
}

/**
 * One ticket the person holds (active or voided), or null when no org has a ticket of that id held
 * by their address. The ticket id is looked up inside each of the person's orgs only: another
 * person's ticket id, or an unknown one, is the same null.
 */
export async function personTicket(email: string, ticketId: string): Promise<PersonTicketDetail | null> {
  const key = personKey(email);
  const found = await eachOrg(await orgsWithAppAccess(key), (orgId) =>
    ticketDetailInOrg(orgId, key, ticketId),
  );
  return found.find((t) => t !== null) ?? null;
}
