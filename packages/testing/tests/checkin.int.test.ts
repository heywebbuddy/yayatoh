import {
  checkinStatusQuery,
  enrollDeviceCommand,
  scanTicketCommand,
  undoAdmissionCommand,
} from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { orderByManageToken, startCheckoutCommand } from '@yayatoh/orders';
import { addMemberCommand } from '@yayatoh/tenancy';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let otherEventId: string;
type T = { code: string; shortCode: string };
let tickets: T[];
let gala: T;
let galaEvent: string;
let bTicket: T;

function pick<X>(list: readonly X[], i = 0): X {
  const x = list[i];
  if (!x) throw new Error(`no item ${i}`);
  return x;
}

// Event: Dec 1–2 2027 in Chicago. "Doors" = during the event.
const DURING = new Date('2027-12-01T20:00:00Z'); // 2 pm Chicago, Dec 1
const NEXT_DAY = new Date('2027-12-02T20:00:00Z'); // Dec 2
const EARLY = new Date('2027-11-30T12:00:00Z');

async function setup(f: OrgFixture, name: string, accessDates: { date: string; name: string }[] = []) {
  const e = await executeCommand(
    createEventCommand,
    { name, timezone: 'America/Chicago', startsAt: '2027-12-01T15:00:00Z', endsAt: '2027-12-03T04:00:00Z' },
    f.ctx(),
    ports,
  );
  const t = await executeCommand(
    createTicketTypeCommand,
    { eventId: e.id, name: 'Pass', priceMinor: 0, quantityTotal: 50, accessDates },
    f.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, f.ctx(), ports);
  return { eventId: e.id, ticketTypeId: t.id };
}

async function buy(f: OrgFixture, ev: { eventId: string; ticketTypeId: string }, quantity: number) {
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId: ev.eventId,
      items: [{ ticketTypeId: ev.ticketTypeId, quantity }],
      buyer: { email: 's@example.test', name: 'Sam Scan' },
    },
    createCtx({ orgId: f.org.id }),
    ports,
  );
  return (await orderByManageToken(r.manageToken))?.tickets ?? [];
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const main = await setup(a, 'Door');
  eventId = main.eventId;
  tickets = await buy(a, main, 3);
  const other = await setup(a, 'Other Door');
  otherEventId = other.eventId;
  const galaEv = await setup(a, 'Gala Only', [{ date: '2027-12-02', name: 'Gala Night' }]);
  gala = pick(await buy(a, galaEv, 1));
  galaEvent = galaEv.eventId;
  const bEv = await setup(b, 'Bravo Door');
  bTicket = pick(await buy(b, bEv, 1));
});
afterAll(closePools);

const scan = (code: string, at = DURING, on = eventId, extra: Record<string, unknown> = {}) =>
  executeCommand(scanTicketCommand, { eventId: on, code, ...extra }, a.ctx({ now: at }), ports);

describe('check-in', () => {
  it('admits a signed code once per day; the second scan is a duplicate with the first time', async () => {
    const t = pick(tickets, 0);
    const first = await scan(t.code);
    expect(first).toMatchObject({ result: 'admitted', ticket: { holderName: 'Sam Scan', typeName: 'Pass' } });
    const again = await scan(t.code, new Date(DURING.getTime() + 60_000));
    expect(again).toMatchObject({
      result: 'duplicate',
      firstAdmittedAt: DURING,
      admissionId: first.admissionId,
    });
    // A new event day admits again (multi-day event).
    expect((await scan(t.code, NEXT_DAY)).result).toBe('admitted');
  });

  it('accepts the short code, case-insensitively', async () => {
    const t = pick(tickets, 1);
    expect((await scan(t.shortCode.toLowerCase())).result).toBe('admitted');
  });

  it('rejects tampered, foreign-org and unknown codes as invalid', async () => {
    const t = pick(tickets, 2);
    const last = t.code.at(-1) === 'A' ? 'B' : 'A';
    expect((await scan(`${t.code.slice(0, -1)}${last}`)).result).toBe('invalid');
    expect((await scan(bTicket.code)).result).toBe('invalid'); // signed by org B's key
    expect((await scan('HELLO-WORLD')).result).toBe('invalid');
    expect((await scan('ZZZZZZZZ')).result).toBe('invalid');
  });

  it('refuses another event of the same org without describing its ticket', async () => {
    const t = pick(tickets, 0);
    expect(await scan(t.code, DURING, otherEventId)).toEqual({
      result: 'wrong_event',
      ticket: null,
      admissionId: null,
      firstAdmittedAt: null,
      openSignals: 0,
    });
  });

  it('enforces the event window and access dates (event timezone)', async () => {
    const t = pick(tickets, 2);
    expect((await scan(t.code, EARLY)).result).toBe('outside_window');
    expect((await scan(gala.code, DURING, galaEvent)).result).toBe('not_today');
    expect((await scan(gala.code, NEXT_DAY, galaEvent)).result).toBe('admitted');
  });

  it('a retried scan (same client id) returns its first outcome, not a duplicate', async () => {
    const t = pick(tickets, 2);
    const id = `device-1:${uuidv7()}`;
    const first = await scan(t.code, DURING, eventId, { clientScanId: id });
    expect(first.result).toBe('admitted');
    expect(await scan(t.code, DURING, eventId, { clientScanId: id })).toEqual(first);
  });

  it('undo reopens the ticket for admission; status counts live admissions', async () => {
    const t = pick(tickets, 0);
    const dup = await scan(t.code);
    await executeCommand(
      undoAdmissionCommand,
      { eventId, admissionId: dup.admissionId as string },
      a.ctx(),
      ports,
    );
    await expect(
      executeCommand(
        undoAdmissionCommand,
        { eventId, admissionId: dup.admissionId as string },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect((await scan(t.code, new Date(DURING.getTime() + 120_000))).result).toBe('admitted');
    const status = await executeQuery(checkinStatusQuery, { eventId }, a.ctx({ now: DURING }), ports);
    expect(status.issued).toBe(3);
    expect(status.admittedToday).toBe(3);
    expect(status.recent[0]).toMatchObject({ result: 'admitted', holderName: 'Sam Scan' });
  });

  it('scanners can scan; viewers cannot; org B cannot scan org A codes into its events', async () => {
    const scanner = uuidv7();
    await executeCommand(addMemberCommand, { userId: scanner, role: 'scanner' }, a.ctx(), ports);
    const t = pick(tickets, 0);
    await expect(
      executeCommand(
        scanTicketCommand,
        { eventId, code: t.code },
        userCtx(scanner, a.org.id, { now: DURING }),
        ports,
      ),
    ).resolves.toMatchObject({ result: 'duplicate' });
    await expect(
      executeCommand(scanTicketCommand, { eventId, code: t.code }, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(scanTicketCommand, { eventId, code: t.code }, b.ctx({ now: DURING }), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('event-scoped door staff can scan their event only, and only while the assignment lasts', async () => {
    // The fixture made the viewer door_staff on the fixture event (not on this file's events).
    const viewer = (now?: Date) => userCtx(a.viewerId, a.org.id, now ? { now } : {});
    await expect(
      executeCommand(scanTicketCommand, { eventId: a.event.id, code: 'ZZZZZZZZ' }, viewer(), ports),
    ).resolves.toMatchObject({ result: 'invalid' });
    await expect(
      executeCommand(scanTicketCommand, { eventId, code: 'ZZZZZZZZ' }, viewer(), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Org-level device management is not part of door staff.
    await expect(
      executeCommand(enrollDeviceCommand, { label: 'Nope' }, viewer(), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(
        sql`update events.event_role_assignments set expires_at = now() - interval '1 minute' where user_id = ${a.viewerId}`,
      ),
    );
    await expect(
      executeCommand(scanTicketCommand, { eventId: a.event.id, code: 'ZZZZZZZZ' }, viewer(), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
