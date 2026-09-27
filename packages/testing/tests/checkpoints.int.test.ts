import {
  checkinStatusQuery,
  createCheckpointCommand,
  deviceContext,
  deviceManifestQuery,
  enrollDeviceCommand,
  listCheckpointsQuery,
  scanTicketCommand,
  setCheckpointArchivedCommand,
  syncScansCommand,
} from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { orderByManageToken, startCheckoutCommand } from '@yayatoh/orders';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let gaType: string;
let vipType: string;
let ga: { code: string; shortCode: string }[];
let vip: { code: string; shortCode: string }[];

const DOORS = new Date('2027-12-01T20:00:00Z');
const at = (min: number) => new Date(DOORS.getTime() + min * 60_000);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const e = await executeCommand(
    createEventCommand,
    {
      name: 'Gates',
      timezone: 'America/Chicago',
      startsAt: '2027-12-01T15:00:00Z',
      endsAt: '2027-12-02T04:00:00Z',
    },
    a.ctx(),
    ports,
  );
  eventId = e.id;
  const type = async (name: string) =>
    (
      await executeCommand(
        createTicketTypeCommand,
        { eventId, name, priceMinor: 0, quantityTotal: 50, maxPerOrder: 10 },
        a.ctx(),
        ports,
      )
    ).id;
  gaType = await type('GA');
  vipType = await type('VIP');
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  const buy = async (ticketTypeId: string, quantity: number, name: string) => {
    const r = await executeCommand(
      startCheckoutCommand,
      {
        eventId,
        items: [{ ticketTypeId, quantity }],
        buyer: { email: `${name.toLowerCase()}@example.test`, name },
      },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    return (await orderByManageToken(r.manageToken))?.tickets ?? [];
  };
  ga = await buy(gaType, 6, 'Gale');
  vip = await buy(vipType, 2, 'Vera');
});
afterAll(closePools);

const cp = (name: string, kind: 'entrance' | 'zone', ticketTypeIds: string[] = []) =>
  executeCommand(createCheckpointCommand, { eventId, name, kind, ticketTypeIds }, a.ctx(), ports);
const scan = (code: string, checkpointId: string | undefined, when: Date) =>
  executeCommand(scanTicketCommand, { eventId, code, checkpointId }, a.ctx({ now: when }), ports);
const signals = () =>
  withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute<{ kind: string; n: number }>(
      sql`select kind, count(*)::int as n from checkin.fraud_signals where event_id = ${eventId} group by kind`,
    ),
  ).then((rows) => Object.fromEntries(rows.map((r) => [r.kind, r.n])));

describe('checkpoints', () => {
  let north: string;
  let south: string;
  let lounge: string;

  it('managers create entrances and zones; names are unique per event; types must belong to it', async () => {
    north = (await cp('North gate', 'entrance')).id;
    south = (await cp('South gate', 'entrance')).id;
    const z = await cp('VIP lounge', 'zone', [vipType]);
    lounge = z.id;
    expect(z).toMatchObject({ kind: 'zone', ticketTypeIds: [vipType], archived: false });
    await expect(cp('North gate', 'entrance')).rejects.toMatchObject({ code: 'conflict' });
    await expect(cp('Side', 'entrance', [gaType])).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(cp('Ghost', 'zone', [uuidv7()])).rejects.toMatchObject({ code: 'validation_failed' });
    // Door staff scan but don't set up the venue.
    await expect(
      executeCommand(
        createCheckpointCommand,
        { eventId: a.event.id, name: 'Nope', kind: 'entrance' },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const listed = await executeQuery(listCheckpointsQuery, { eventId }, a.ctx(), ports);
    expect(listed.map((c) => c.name)).toEqual(['North gate', 'South gate', 'VIP lounge']);
  });

  it('entrances admit once per day whichever gate; counts are kept per entrance', async () => {
    expect((await scan((ga[0] as { code: string }).code, north, at(0))).result).toBe('admitted');
    expect((await scan((ga[1] as { code: string }).code, south, at(0))).result).toBe('admitted');
    expect((await scan((vip[0] as { code: string }).code, north, at(0))).result).toBe('admitted');
    const s = await executeQuery(checkinStatusQuery, { eventId }, a.ctx({ now: at(1) }), ports);
    expect(s.admittedToday).toBe(3);
    expect(s.byCheckpoint).toEqual([
      { checkpointId: north, name: 'North gate', admittedToday: 2 },
      { checkpointId: south, name: 'South gate', admittedToday: 1 },
    ]);
  });

  it('a zone grants the listed types (again and again), refuses others, and admits nobody', async () => {
    expect((await scan((vip[0] as { code: string }).code, lounge, at(2))).result).toBe('granted');
    expect((await scan((vip[0] as { code: string }).code, lounge, at(3))).result).toBe('granted');
    const refused = await scan((ga[0] as { code: string }).code, lounge, at(3));
    expect(refused).toMatchObject({ result: 'no_access', ticket: { holderName: 'Gale' } });
    // A VIP never scanned at an entrance is still not admitted by the lounge.
    expect((await scan((vip[1] as { code: string }).code, lounge, at(4))).result).toBe('granted');
    const s = await executeQuery(checkinStatusQuery, { eventId }, a.ctx({ now: at(5) }), ports);
    expect(s.admittedToday).toBe(3);
  });

  it('the same ticket at a second entrance within minutes raises one two_entrances signal', async () => {
    expect((await scan((ga[0] as { code: string }).code, south, at(1))).result).toBe('duplicate');
    // The same gate again, or another gate much later, is an ordinary duplicate.
    expect((await scan((ga[0] as { code: string }).code, north, at(2))).result).toBe('duplicate');
    expect((await scan((ga[1] as { code: string }).code, north, at(30))).result).toBe('duplicate');
    expect(await signals()).toEqual({ two_entrances: 1 });
    const s = await executeQuery(checkinStatusQuery, { eventId }, a.ctx({ now: at(31) }), ports);
    expect(s.signals).toEqual([
      expect.objectContaining({ kind: 'two_entrances', holderName: 'Gale', checkpointName: 'South gate' }),
    ]);
    const [evt] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.domain_events where type = 'checkin.fraud_signal' and payload->>'eventId' = ${eventId}`,
      ),
    );
    expect(evt?.n).toBe(1);
  });

  it('five invalid codes from one scanner in a minute raise one invalid_burst', async () => {
    for (let i = 0; i < 7; i++)
      expect((await scan(`BOGUS-${i}`, north, new Date(at(40).getTime() + i * 5_000))).result).toBe(
        'invalid',
      );
    expect(await signals()).toEqual({ two_entrances: 1, invalid_burst: 1 });
  });

  it('archived checkpoints leave the list and refuse scans; counts keep their history', async () => {
    await executeCommand(
      setCheckpointArchivedCommand,
      { eventId, checkpointId: south, archived: true },
      a.ctx(),
      ports,
    );
    expect(
      (await executeQuery(listCheckpointsQuery, { eventId }, a.ctx(), ports)).map((c) => c.name),
    ).toEqual(['North gate', 'VIP lounge']);
    await expect(scan((ga[2] as { code: string }).code, south, at(50))).rejects.toMatchObject({
      code: 'not_found',
    });
    const s = await executeQuery(checkinStatusQuery, { eventId }, a.ctx({ now: at(51) }), ports);
    expect(s.byCheckpoint.map((c) => c.name)).toEqual(['North gate', 'South gate']);
  });

  it('devices get checkpoints in the manifest and sync zone and entrance scans', async () => {
    const { token } = await executeCommand(enrollDeviceCommand, { label: 'Lounge tablet' }, a.ctx(), ports);
    const dc = await deviceContext(token);
    if (!dc) throw new Error('device did not resolve');
    const m = await executeQuery(deviceManifestQuery, { eventId }, { ...dc.ctx, now: at(60) }, ports);
    expect(m.header.checkpoints.map((c) => [c.name, c.kind])).toEqual([
      ['North gate', 'entrance'],
      ['VIP lounge', 'zone'],
    ]);
    expect(m.rows.find((r) => r.shortCode === vip[1]?.shortCode)?.ticketTypeId).toBe(vipType);
    const r = await executeCommand(
      syncScansCommand,
      {
        eventId,
        scans: [
          { code: (vip[1] as { code: string }).code, checkpointId: lounge, verdict: 'granted' },
          { code: (ga[3] as { code: string }).code, checkpointId: lounge, verdict: 'no_access' },
          { code: (ga[3] as { code: string }).code, checkpointId: north, verdict: 'admit' },
        ].map((s, i) => ({ ...s, scanId: uuidv7(), deviceTs: at(61 + i), clockOffsetMs: 0 })),
      },
      { ...dc.ctx, now: at(65) },
      ports,
    );
    expect(r.results.map((x) => x.result)).toEqual(['granted', 'no_access', 'admitted']);
  });

  it('isolation: org B cannot scan at, list or archive org A checkpoints', async () => {
    const [north] = await executeQuery(listCheckpointsQuery, { eventId }, a.ctx(), ports);
    await expect(executeQuery(listCheckpointsQuery, { eventId }, b.ctx(), ports)).resolves.toEqual([]);
    await expect(
      executeCommand(
        setCheckpointArchivedCommand,
        { eventId, checkpointId: north?.id as string, archived: true },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(
        scanTicketCommand,
        { eventId: b.event.id, code: 'ZZZZZZZZ', checkpointId: north?.id },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
