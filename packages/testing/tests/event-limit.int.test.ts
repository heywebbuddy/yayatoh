import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { recordBoxOfficeSaleCommand, startCheckoutCommand } from '@yayatoh/orders';
import { createTicketTypeCommand, eventLimitQuery, setEventLimitCommand } from '@yayatoh/ticketing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs } from '../src/index.ts';

let a: OrgFixture;
let eventId: string;
let ga: string;

beforeAll(async () => {
  ({ a } = await twoOrgs());
  eventId = (
    await executeCommand(
      createEventCommand,
      {
        name: 'Limit night',
        timezone: 'UTC',
        startsAt: '2028-09-01T18:00:00Z',
        endsAt: '2028-09-01T22:00:00Z',
      },
      a.ctx(),
      ports,
    )
  ).id;
  ga = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'GA', priceMinor: 2000, quantityTotal: 50, transfersAllowed: true },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
});
afterAll(closePools);

const buy = (n: string, quantity: number) =>
  executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId: ga, quantity }],
      buyer: { email: `lim-${n}@example.test`, name: `Lim ${n}` },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );

describe('event-wide attendee limit', () => {
  it('refuses a checkout or box-office sale past the limit, and frees places when it is raised', async () => {
    await executeCommand(setEventLimitCommand, { eventId, maxAttendees: 5 }, a.ctx(), ports);
    await buy('a', 3);
    await expect(buy('b', 3)).rejects.toMatchObject({ details: { reason: 'event_full', left: 2 } });
    await expect(
      executeCommand(
        recordBoxOfficeSaleCommand,
        {
          eventId,
          items: [{ ticketTypeId: ga, quantity: 3 }],
          buyer: { email: 'door@example.test', name: 'Door' },
          method: 'cash',
        },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'event_full' } });
    await buy('c', 2);
    expect(await executeQuery(eventLimitQuery, { eventId }, a.ctx(), ports)).toEqual({
      maxAttendees: 5,
      taken: 5,
    });
    await executeCommand(setEventLimitCommand, { eventId, maxAttendees: 8 }, a.ctx(), ports);
    await buy('d', 3);
  });

  it('cannot be set below what is taken, and no limit means no event-wide cap', async () => {
    await expect(
      executeCommand(setEventLimitCommand, { eventId, maxAttendees: 2 }, a.ctx(), ports),
    ).rejects.toMatchObject({ details: { reason: 'below_sold' } });
    await executeCommand(setEventLimitCommand, { eventId, maxAttendees: null }, a.ctx(), ports);
    await buy('e', 4);
  });
});
