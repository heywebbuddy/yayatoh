import { eventAttendeesMatchingTx } from '@yayatoh/attendees';
import { withTenant } from '@yayatoh/db';
import { transitionEventCommand } from '@yayatoh/events';
import { buildRoundTable } from '@yayatoh/floorplan';
import { partyHubQuery, updatePartyGuestCommand } from '@yayatoh/guests';
import { type Ctx, createCtx, executeCommand } from '@yayatoh/kernel';
import { startCheckoutCommand } from '@yayatoh/orders';
import {
  assignSeatsCommand,
  partySeatsTx,
  publishEventLayoutCommand,
  setEventLayoutCommand,
  setFinderSettingsCommand,
} from '@yayatoh/seating';
import { createTicketTypeCommand, partyTicketsTx } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { ports } from './ports.ts';
import { type RsvpScenario, rsvpScenario } from './rsvp.ts';

/** The hub query wired with seating's and ticketing's readers, as the web app wires it. */
export const partyHub = partyHubQuery({ seats: partySeatsTx, tickets: partyTicketsTx });

export interface GuestHubScenario extends RsvpScenario {
  /** Luis López's guest-list entry (his free ticket's attendee), seated at table 4. */
  readonly luisAttendeeId: string;
  readonly ticketShortCode: string;
  readonly tableLabel: string;
  readonly seatLabel: string;
}

/**
 * M4.7a e2e/integration data: the M4.1d wedding (ceremony for everyone, reception for Luis and his
 * plus-one), published, with a free "Guest pass" ticket for Luis linked to his guest row, a plan
 * with table 4 and Luis on its second seat. The seat finder is open (`seating: false` keeps it
 * closed, so the hub shows no seats yet). The Chens hold nothing.
 */
export async function guestHubScenario(
  orgId: string,
  opts: { seating?: boolean; deadline?: Date | null; ctx?: Ctx } = {},
): Promise<GuestHubScenario> {
  const ctx = opts.ctx ?? createCtx({ orgId, actor: { type: 'system', name: 'fixture' } });
  const w = await rsvpScenario(orgId, { ctx, deadline: opts.deadline ?? null });
  const eventId = w.eventId;
  const type = await executeCommand(
    createTicketTypeCommand,
    { eventId, name: 'Guest pass', priceMinor: 0, quantityTotal: 50, maxPerOrder: 4 },
    ctx,
    ports,
  );
  const table = buildRoundTable({ label: '4', seats: 8, x: 600, y: 500 });
  const doc = { version: 1, width: 1200, height: 1000, items: [table] };
  await executeCommand(setEventLayoutCommand, { eventId, doc }, ctx, ports);
  await executeCommand(publishEventLayoutCommand, { eventId }, ctx, ports);
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, ctx, ports);
  if (opts.seating !== false)
    await executeCommand(setFinderSettingsCommand, { eventId, publicMap: true, mode: 'code' }, ctx, ports);

  const email = `luis.${w.eventSlug}@hub.test`;
  await executeCommand(
    startCheckoutCommand,
    { eventId, items: [{ ticketTypeId: type.id, quantity: 1 }], buyer: { email, name: 'Luis López' } },
    createCtx({ orgId }),
    ports,
  );
  const { attendee, guestId, shortCode } = await withTenant(ctx, async (tx) => {
    const [a] = await eventAttendeesMatchingTx(tx, eventId, { email });
    const [g] = await tx.execute<{ id: string }>(
      sql`select id from guests.guests where event_id = ${eventId} and first_name = 'Luis'`,
    );
    const [t] = await tx.execute<{ short_code: string }>(
      sql`select short_code from ticketing.tickets where id = ${a?.ticketId ?? null}`,
    );
    return { attendee: a, guestId: g?.id, shortCode: t?.short_code };
  });
  if (!attendee?.ticketId || !guestId || !shortCode) throw new Error('guestHubScenario: no ticket');
  await executeCommand(
    updatePartyGuestCommand,
    { eventId, guestId, firstName: 'Luis', lastName: 'López', attendeeId: attendee.id },
    ctx,
    ports,
  );
  const seat = table.seats[1];
  if (!seat) throw new Error('guestHubScenario: no seat');
  await executeCommand(
    assignSeatsCommand,
    { eventId, attendeeIds: [attendee.id], itemId: table.id, seatUuid: seat.id },
    ctx,
    ports,
  );
  return {
    ...w,
    luisAttendeeId: attendee.id,
    ticketShortCode: shortCode,
    tableLabel: table.label,
    seatLabel: seat.label,
  };
}
