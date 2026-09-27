import { setFeeOverrideCommand } from '@yayatoh/billing';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  archiveTicketTypeCommand,
  createTicketTypeCommand,
  listTicketTypesQuery,
  publicTicketTypes,
  updateTicketTypeCommand,
} from '@yayatoh/ticketing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let slug: string;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const e = await executeCommand(
    createEventCommand,
    {
      name: `Ticketed ${a.org.slug}`,
      timezone: 'America/Chicago',
      startsAt: '2027-09-01T23:00:00Z',
      endsAt: '2027-09-02T03:00:00Z',
    },
    a.ctx(),
    ports,
  );
  eventId = e.id;
  slug = e.slug;
  // 2.5% + $0.99 for this org (a negotiated override), passed on to buyers.
  await executeCommand(
    setFeeOverrideCommand,
    { currency: 'USD', percentBps: 250, fixedMinor: 99, reason: 'test' },
    systemCtx(a.org.id),
    ports,
  );
});
afterAll(closePools);

const create = (fields: Record<string, unknown>, ctx = a.ctx()) =>
  executeCommand(
    createTicketTypeCommand,
    { eventId, name: 'GA', priceMinor: 24900, quantityTotal: 50, ...fields },
    ctx,
    ports,
  );

describe('ticket types', () => {
  it('creates in the event currency and presents the all-in price', async () => {
    const t = await create({ name: 'General Admission' });
    expect(t).toMatchObject({
      currency: 'USD',
      priceMinor: 24900,
      feeMinor: 721,
      allInMinor: 25621,
      quantitySold: 0,
    });
    const absorbed = await create({ name: 'Absorbed', feeMode: 'absorb' });
    expect(absorbed.allInMinor).toBe(24900);
    const free = await create({ name: 'Free RSVP', priceMinor: 0 });
    expect([free.feeMinor, free.allInMinor]).toEqual([0, 0]);
  });

  it('validates limits, windows and quantity floors', async () => {
    await expect(create({ minPerOrder: 5, maxPerOrder: 2 })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(
      create({ salesStartAt: '2027-08-01T00:00:00Z', salesEndAt: '2027-07-01T00:00:00Z' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(create({ priceMinor: -1 })).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('lists only live ticket types; archive hides one', async () => {
    const t = await create({ name: 'Temporary' });
    await executeCommand(archiveTicketTypeCommand, { ticketTypeId: t.id }, a.ctx(), ports);
    const list = await executeQuery(listTicketTypesQuery, { eventId }, a.ctx(), ports);
    expect(list.map((x) => x.name)).not.toContain('Temporary');
    expect(list.map((x) => x.name)).toContain('General Admission');
  });

  it('shows public passes only for a published event, all-in, without inventory internals', async () => {
    expect(await publicTicketTypes(slug)).toEqual([]);
    await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
    await create({ name: 'Hidden comp', visibility: 'hidden' });
    await create({ name: 'Early bird', salesStartAt: '2099-01-01T00:00:00Z' });
    const pub = await publicTicketTypes(slug);
    const ga = pub.find((p) => p.name === 'General Admission');
    expect(ga).toMatchObject({ allInMinor: 25621, availability: 'available', fewLeft: false });
    expect(Object.keys(ga ?? {})).not.toContain('quantitySold');
    expect(pub.map((p) => p.name)).not.toContain('Hidden comp');
    expect(pub.find((p) => p.name === 'Early bird')?.availability).toBe('not_yet_on_sale');
  });

  it('cannot shrink below sold + held (DB check backs the command)', async () => {
    const t = await create({ name: 'Shrink', quantityTotal: 10 });
    await expect(
      executeCommand(updateTicketTypeCommand, { ticketTypeId: t.id, quantityTotal: -1 }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const smaller = await executeCommand(
      updateTicketTypeCommand,
      { ticketTypeId: t.id, quantityTotal: 3 },
      a.ctx(),
      ports,
    );
    expect(smaller.quantityTotal).toBe(3);
  });

  it('isolation and roles: another org cannot add tickets to this event; a viewer cannot create', async () => {
    await expect(create({}, b.ctx())).rejects.toMatchObject({ code: 'not_found' });
    await expect(create({}, userCtx(a.viewerId, a.org.id))).rejects.toMatchObject({ code: 'forbidden' });
  });
});
