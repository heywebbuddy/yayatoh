import { engineStaffAlerts } from '@yayatoh/alerts';
import {
  derivedStaffAlerts,
  deviceContext,
  deviceManifestQuery,
  enrollDeviceCommand,
  findTicketHoldersQuery,
  heartbeatCommand,
  scanTicketCommand,
} from '@yayatoh/checkin';
import { phoneLookupHash } from '@yayatoh/checkin-engine';
import { setContactPhoneTx, upsertContactTx } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { orderByManageToken, startCheckoutCommand } from '@yayatoh/orders';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

/**
 * Agreement §8 (audit 2026-10-12): door staff find ticket holders by name, email or phone when a
 * code won't scan, online (console) and offline (the manifest's phone hash); and the Scan PWA's
 * staff alerts follow the alert engine's acknowledgements.
 */
let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let ana: { id: string; shortCode: string };

const DOORS = new Date('2027-12-01T20:00:00Z');

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const e = await executeCommand(
    createEventCommand,
    {
      name: 'Door lookup',
      timezone: 'America/Chicago',
      startsAt: '2027-12-01T15:00:00Z',
      endsAt: '2027-12-02T04:00:00Z',
    },
    a.ctx(),
    ports,
  );
  eventId = e.id;
  const tt = await executeCommand(
    createTicketTypeCommand,
    { eventId, name: 'GA', priceMinor: 0, quantityTotal: 20, maxPerOrder: 5 },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  const buy = async (email: string, name: string) => {
    const r = await executeCommand(
      startCheckoutCommand,
      { eventId, items: [{ ticketTypeId: tt.id, quantity: 1 }], buyer: { email, name } },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    const t = (await orderByManageToken(r.manageToken))?.tickets[0];
    if (!t) throw new Error('no ticket');
    return { id: t.id, shortCode: t.shortCode };
  };
  ana = await buy('ana.lima@example.test', 'Ana Lima');
  await buy('zoe.park@example.test', 'Zoe Park');
  await withTenant(systemCtx(a.org.id), async (tx) => {
    const c = await upsertContactTx(tx, a.ctx(), {
      email: 'ana.lima@example.test',
      name: 'Ana Lima',
      source: 'manual',
    });
    await setContactPhoneTx(tx, a.ctx(), c.id, '+14155550134');
  });
}, 240_000);
afterAll(closePools);

const find = (query: string, ctx: Ctx = a.ctx({ now: DOORS })) =>
  executeQuery(findTicketHoldersQuery, { eventId, query }, ctx, ports);

describe('door lookup (agreement §8)', () => {
  it('finds a ticket holder by name, email and phone', async () => {
    expect((await find('ana li')).matches.map((m) => m.holderName)).toEqual(['Ana Lima']);
    const byEmail = await find('  ANA.LIMA@example.test ');
    expect(byEmail).toMatchObject({ kind: 'email', matches: [{ ticketId: ana.id, admittedToday: false }] });
    // Typed without the country code: the last eight digits match.
    const byPhone = await find('(415) 555-0134');
    expect(byPhone).toMatchObject({ kind: 'phone', matches: [{ ticketId: ana.id }] });
    expect((await find('nobody@example.test')).matches).toEqual([]);
    expect((await find('a')).matches).toEqual([]);
  });

  it('says who is already checked in today', async () => {
    await executeCommand(scanTicketCommand, { eventId, code: ana.shortCode }, a.ctx({ now: DOORS }), ports);
    expect((await find('Ana')).matches[0]).toMatchObject({ ticketId: ana.id, admittedToday: true });
  });

  it('never reaches another organization', async () => {
    await expect(find('Ana', b.ctx({ now: DOORS }))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('puts the holder phone number in the offline manifest as a salted hash only', async () => {
    const { token } = await executeCommand(enrollDeviceCommand, { label: 'Lookup gate' }, a.ctx(), ports);
    const dc = await deviceContext(token);
    if (!dc) throw new Error('device did not resolve');
    const page = await executeQuery(
      deviceManifestQuery,
      { eventId, limit: 100 },
      { ...dc.ctx, now: DOORS },
      ports,
    );
    const row = page.rows.find((r) => r.ticketId === ana.id);
    expect(row?.phoneHash).toBe(await phoneLookupHash(page.header.salt, '+14155550134'));
    expect(JSON.stringify(page)).not.toContain('5550134');
    expect(page.rows.find((r) => r.holderName === 'Zoe Park')?.phoneHash).toBeUndefined();
  });
});

describe('staff alerts on the alert engine', () => {
  it('quiets a device alert the organizer acknowledged, and only that one', async () => {
    const { token } = await executeCommand(enrollDeviceCommand, { label: 'Flat battery' }, a.ctx(), ports);
    const dc = await deviceContext(token);
    if (!dc) throw new Error('device did not resolve');
    await executeCommand(
      heartbeatCommand,
      { eventId, batteryPct: 5, queueDepth: 80, clockOffsetMs: 0 },
      { ...dc.ctx, now: DOORS },
      ports,
    );
    const source = engineStaffAlerts();
    const kinds = () =>
      withTenant(systemCtx(a.org.id), async (tx) =>
        (await source.list(tx, { eventId, now: DOORS })).map((x) => x.kind).sort(),
      );
    const derived = await withTenant(systemCtx(a.org.id), (tx) =>
      derivedStaffAlerts.list(tx, { eventId, now: DOORS }),
    );
    expect(derived.map((x) => x.kind)).toContain('device_low_battery');
    expect(await kinds()).toEqual(['device_backlog', 'device_low_battery']);
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(sql`insert into alerts.alerts (org_id, event_id, rule, scope_key, category, severity, state, count, acknowledged_at)
        values (${a.org.id}::uuid, ${eventId}::uuid, 'devicesLowBattery', ${eventId}, 'door', 'warning', 'acknowledged', 1, now())`),
    );
    expect(await kinds()).toEqual(['device_backlog']);
  });
});
