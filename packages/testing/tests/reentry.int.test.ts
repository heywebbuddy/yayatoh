import { scanTicketCommand, setReentrySettingsCommand } from '@yayatoh/checkin';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { orderByManageToken, startCheckoutCommand } from '@yayatoh/orders';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs } from '../src/index.ts';

let a: OrgFixture;
let eventId: string;
let codes: string[];

// Chicago, Dec 1 2027: 2 pm local is 20:00Z; six hours later is still the same event day.
const T0 = new Date('2027-12-01T20:00:00Z');
const at = (hours: number) => new Date(T0.getTime() + hours * 3_600_000);

beforeAll(async () => {
  ({ a } = await twoOrgs());
  const e = await executeCommand(
    createEventCommand,
    {
      name: 'Re-entry door',
      timezone: 'America/Chicago',
      startsAt: '2027-12-01T15:00:00Z',
      endsAt: '2027-12-03T04:00:00Z',
    },
    a.ctx(),
    ports,
  );
  eventId = e.id;
  const t = await executeCommand(
    createTicketTypeCommand,
    { eventId, name: 'Pass', priceMinor: 0, quantityTotal: 20 },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId: t.id, quantity: 2 }],
      buyer: { email: 're@example.test', name: 'Re Entry' },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  codes = ((await orderByManageToken(r.manageToken))?.tickets ?? []).map((tk) => tk.code);
});
afterAll(closePools);

const scan = (code: string, now: Date) =>
  executeCommand(scanTicketCommand, { eventId, code }, a.ctx({ now }), ports);

describe('re-entry after N hours', () => {
  it('is off by default: a second scan the same day is a duplicate however late', async () => {
    const code = codes[0] ?? '';
    expect((await scan(code, T0)).result).toBe('admitted');
    expect((await scan(code, at(6))).result).toBe('duplicate');
  });

  it('admits again once N hours have passed since the last entry; inside the window stays a duplicate', async () => {
    await executeCommand(setReentrySettingsCommand, { eventId, hours: 3 }, a.ctx(), ports);
    const code = codes[1] ?? '';
    const first = await scan(code, T0);
    expect(first.result).toBe('admitted');
    const inside = await scan(code, at(2));
    expect(inside).toMatchObject({ result: 'duplicate', firstAdmittedAt: T0 });
    const back = await scan(code, at(3));
    expect(back).toMatchObject({ result: 'admitted', admissionId: first.admissionId });
    // The window restarts from the re-entry.
    expect(await scan(code, at(5))).toMatchObject({ result: 'duplicate', firstAdmittedAt: at(3) });
    expect((await scan(code, at(6))).result).toBe('admitted');
  });

  it('rejects windows outside 1 to 72 hours, and turning it off restores duplicates', async () => {
    await expect(
      executeCommand(setReentrySettingsCommand, { eventId, hours: 0 }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(setReentrySettingsCommand, { eventId, hours: 73 }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await executeCommand(setReentrySettingsCommand, { eventId, hours: null }, a.ctx(), ports);
    expect((await scan(codes[1] ?? '', at(8))).result).toBe('duplicate');
  });
});
