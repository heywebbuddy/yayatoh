import { addGuestCommand, cancelAttendeesTx, removeGuestCommand } from '@yayatoh/attendees';
import { catchUpParticipation } from '@yayatoh/audiences';
import { scanTicketCommand } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import {
  createEventCommand,
  createSeriesCommand,
  setEventSeriesCommand,
  transitionEventCommand,
} from '@yayatoh/events';
import { buildRow } from '@yayatoh/floorplan';
import { type Ctx, createCtx, executeCommand, uuidv7 } from '@yayatoh/kernel';
import { orderByManageToken, startCheckoutCommand } from '@yayatoh/orders';
import { assignSeatsCommand, setEventLayoutCommand } from '@yayatoh/seating';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { ports } from './ports.ts';

/** Two editions of one series: "last year" (2027) and "this year" (2028), in Chicago. */
export const AUDIENCE_EDITIONS = {
  last: { startsAt: '2027-06-05T18:00:00Z', endsAt: '2027-06-05T23:00:00Z', during: '2027-06-05T19:00:00Z' },
  this: { startsAt: '2028-06-03T18:00:00Z', endsAt: '2028-06-03T23:00:00Z', during: '2028-06-03T19:00:00Z' },
} as const;

export interface AudiencePerson {
  readonly email: string;
  readonly attendeeIds: string[];
  readonly codes: string[];
}

export interface AudienceScenario {
  readonly tag: string;
  readonly seriesId: string;
  readonly seriesName: string;
  readonly lastYear: string;
  readonly lastYearName: string;
  readonly thisYear: string;
  readonly thisYearName: string;
  readonly vip: string;
  readonly ga: string;
  readonly rowId: string;
  readonly people: ReadonlyMap<string, AudiencePerson>;
  readonly email: (who: string) => string;
  /** The vision audiences' exact members (M3.6 acceptance). */
  readonly expected: {
    readonly vipsWithoutSeats: readonly string[];
    readonly lastYearNotThisYear: readonly string[];
    readonly registeredNotCheckedIn: readonly string[];
  };
}

/**
 * The M3.6 audience scenario, built through the real commands in one org (integration tests and
 * e2e share it). Last year: Ava, Gus and Ivy checked in; Hal registered and never came. This year:
 * Ava (VIP, seated by the organizer), Ben (VIP, unseated, checked in), Dee (VIP, her attendee
 * record cancelled: still a buyer, off the list), Cy and Ivy (General), Fin (a guest labelled
 * "press"), Eve (a guest removed again). Then the participation projector catches up.
 */
export async function audienceScenario(
  orgId: string,
  ctx: Ctx = createCtx({ orgId, actor: { type: 'system', name: 'fixture' } }),
): Promise<AudienceScenario> {
  const tag = uuidv7().slice(-8);
  const email = (who: string) => `${who.toLowerCase()}.${tag}@audience.test`;
  const people = new Map<string, AudiencePerson>();
  const E = AUDIENCE_EDITIONS;
  const row = buildRow({ label: 'A', count: 6, x: 100, y: 100 });
  const at = (iso: string) => ({ ...ctx, now: new Date(iso) });

  const event = async (name: string, when: { startsAt: string; endsAt: string }) =>
    executeCommand(
      createEventCommand,
      { name, timezone: 'America/Chicago', startsAt: when.startsAt, endsAt: when.endsAt },
      ctx,
      ports,
    );
  const ticketType = async (eventId: string, name: string) =>
    (
      await executeCommand(
        createTicketTypeCommand,
        { eventId, name, priceMinor: 0, quantityTotal: 50 },
        ctx,
        ports,
      )
    ).id;
  const buy = async (eventId: string, ticketTypeId: string, who: string) => {
    const r = await executeCommand(
      startCheckoutCommand,
      { eventId, items: [{ ticketTypeId, quantity: 1 }], buyer: { email: email(who), name: who } },
      createCtx({ orgId }),
      ports,
    );
    const tickets = (await orderByManageToken(r.manageToken))?.tickets ?? [];
    const p = people.get(who) ?? { email: email(who), attendeeIds: [], codes: [] };
    for (const t of tickets) {
      p.codes.push(t.code);
      const [att] = await withTenant(ctx, (tx) =>
        tx.execute<{ id: string }>(sql`select id from attendees.attendees where ticket_id = ${t.id}`),
      );
      if (att) p.attendeeIds.push(att.id);
    }
    people.set(who, p);
  };
  const scan = (eventId: string, who: string, during: string) =>
    executeCommand(
      scanTicketCommand,
      { eventId, code: people.get(who)?.codes.at(-1) ?? '' },
      at(during),
      ports,
    );

  const seriesName = `Harbor Gala ${tag}`;
  const lastYearName = `Harbor Gala 2027 ${tag}`;
  const thisYearName = `Harbor Gala 2028 ${tag}`;
  const lastYear = (await event(lastYearName, E.last)).id;
  const thisYear = (await event(thisYearName, E.this)).id;
  const seriesId = (await executeCommand(createSeriesCommand, { name: seriesName }, ctx, ports)).id;
  for (const id of [lastYear, thisYear])
    await executeCommand(setEventSeriesCommand, { eventId: id, seriesId }, ctx, ports);
  const lastPass = await ticketType(lastYear, 'Pass');
  const vip = await ticketType(thisYear, 'VIP');
  const ga = await ticketType(thisYear, 'General');
  await executeCommand(
    setEventLayoutCommand,
    { eventId: thisYear, doc: { version: 1, width: 1600, height: 1000, items: [row] } },
    ctx,
    ports,
  );
  for (const id of [lastYear, thisYear])
    await executeCommand(transitionEventCommand, { eventId: id, transition: 'publish' }, ctx, ports);

  for (const who of ['Ava', 'Gus', 'Hal', 'Ivy']) await buy(lastYear, lastPass, who);
  for (const who of ['Ava', 'Gus', 'Ivy']) await scan(lastYear, who, E.last.during);
  for (const who of ['Ava', 'Ben', 'Dee']) await buy(thisYear, vip, who);
  for (const who of ['Cy', 'Ivy']) await buy(thisYear, ga, who);
  const fin = await executeCommand(
    addGuestCommand,
    { eventId: thisYear, name: 'Fin', email: email('Fin'), labels: ['press'] },
    ctx,
    ports,
  );
  people.set('Fin', { email: email('Fin'), attendeeIds: [fin.id], codes: [] });
  const eve = await executeCommand(
    addGuestCommand,
    { eventId: thisYear, name: 'Eve', email: email('Eve'), labels: ['press'] },
    ctx,
    ports,
  );
  await executeCommand(removeGuestCommand, { eventId: thisYear, attendeeId: eve.id }, ctx, ports);
  await executeCommand(
    assignSeatsCommand,
    { eventId: thisYear, attendeeIds: people.get('Ava')?.attendeeIds.slice(-1) ?? [], itemId: row.id },
    ctx,
    ports,
  );
  await scan(thisYear, 'Ben', E.this.during);
  await withTenant(ctx, (tx) => cancelAttendeesTx(tx, ctx, people.get('Dee')?.attendeeIds ?? []));
  await catchUpParticipation(orgId);
  return {
    tag,
    seriesId,
    seriesName,
    lastYear,
    lastYearName,
    thisYear,
    thisYearName,
    vip,
    ga,
    rowId: row.id,
    people,
    email,
    expected: {
      vipsWithoutSeats: ['Ben'],
      lastYearNotThisYear: ['Gus'],
      registeredNotCheckedIn: ['Ava', 'Cy', 'Fin', 'Ivy'],
    },
  };
}
