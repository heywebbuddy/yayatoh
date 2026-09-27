import {
  checkinStatusQuery,
  createCheckpointCommand,
  deviceContext,
  deviceManifestQuery,
  doorStaffQuery,
  enrollDeviceCommand,
  removeDoorStaffCommand,
  scanTicketCommand,
  setCheckpointArchivedCommand,
  setDoorStaffCommand,
  syncScansCommand,
} from '@yayatoh/checkin';
import { type OfflineState, offlineVerdict, verifyManifestScope } from '@yayatoh/checkin-engine';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
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
let north: string;
let south: string;
let lounge: string;
let otherGate: string;
let tickets: { code: string; shortCode: string; id: string }[];
let outsiderId: string;

const DOORS = new Date('2027-12-01T20:00:00Z');
const at = (min: number) => new Date(DOORS.getTime() + min * 60_000);
const t = (i: number) => {
  const x = tickets[i];
  if (!x) throw new Error(`no ticket ${i}`);
  return x;
};

async function setup(f: OrgFixture, name: string) {
  const e = await executeCommand(
    createEventCommand,
    { name, timezone: 'America/Chicago', startsAt: '2027-12-01T15:00:00Z', endsAt: '2027-12-02T04:00:00Z' },
    f.ctx(),
    ports,
  );
  const tt = await executeCommand(
    createTicketTypeCommand,
    { eventId: e.id, name: 'GA', priceMinor: 0, quantityTotal: 50, maxPerOrder: 20 },
    f.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, f.ctx(), ports);
  return { eventId: e.id, ticketTypeId: tt.id };
}

const cp = async (event: string, name: string, kind: 'entrance' | 'zone' = 'entrance') =>
  (await executeCommand(createCheckpointCommand, { eventId: event, name, kind }, a.ctx(), ports)).id;

const viewer = (now = DOORS) => userCtx(a.viewerId, a.org.id, { now });
const scanAs = (ctx: Ctx, code: string, checkpointId?: string) =>
  executeCommand(
    scanTicketCommand,
    { eventId, code, clientScanId: `door-scope:${uuidv7()}`, ...(checkpointId ? { checkpointId } : {}) },
    ctx,
    ports,
  );

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const main = await setup(a, 'Scoped doors');
  eventId = main.eventId;
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId: main.ticketTypeId, quantity: 12 }],
      buyer: { email: 'scope@example.test', name: 'Scout' },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  tickets = ((await orderByManageToken(r.manageToken))?.tickets ?? []).map((x) => ({
    code: x.code,
    shortCode: x.shortCode,
    id: x.id,
  }));
  north = await cp(eventId, 'North gate');
  south = await cp(eventId, 'South gate');
  lounge = await cp(eventId, 'Lounge', 'zone');
  otherEventId = (await setup(a, 'Other doors')).eventId;
  otherGate = await cp(otherEventId, 'Other gate');
  // A member with no event role at all (a finance person).
  outsiderId = uuidv7();
  await executeCommand(addMemberCommand, { userId: outsiderId, role: 'finance' }, a.ctx(), ports);
});
afterAll(closePools);

describe('checkpoint-scoped door staff (M1.9d)', () => {
  it('assigns a member to checkpoints of the event; the scope is validated and audited', async () => {
    const set = (checkpointIds: string[], userId = a.viewerId, ctx = a.ctx()) =>
      executeCommand(setDoorStaffCommand, { eventId, userId, checkpointIds }, ctx, ports);
    await expect(set([otherGate])).rejects.toMatchObject({
      code: 'validation_failed',
      details: { field: 'checkpointIds' },
    });
    await expect(set([uuidv7()])).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(set([north], uuidv7())).rejects.toMatchObject({
      code: 'validation_failed',
      details: { field: 'userId' },
    });
    const archived = await cp(eventId, 'Old gate');
    await executeCommand(
      setCheckpointArchivedCommand,
      { eventId, checkpointId: archived, archived: true },
      a.ctx(),
      ports,
    );
    await expect(set([archived])).rejects.toMatchObject({ code: 'validation_failed' });

    expect(await set([north, north])).toMatchObject({ userId: a.viewerId, checkpointIds: [north] });
    const staff = await executeQuery(doorStaffQuery, { eventId }, viewer(), ports);
    expect(staff).toEqual([{ userId: a.viewerId, checkpointIds: [north], expiresAt: null }]);
    const [audit] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ data: { userId: string; checkpointIds: string[] } }>(
        sql`select data from platform.audit_events where action = 'event.door_staff.set' and target_id = ${eventId} order by created_at desc limit 1`,
      ),
    );
    expect(audit?.data).toEqual({ userId: a.viewerId, checkpointIds: [north] });
  });

  it('only members who manage the team can assign; the door staff member and viewers cannot', async () => {
    await expect(
      executeCommand(
        setDoorStaffCommand,
        { eventId, userId: a.viewerId, checkpointIds: [] },
        viewer(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(removeDoorStaffCommand, { eventId, userId: a.viewerId }, viewer(), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Another org can neither see nor change this event's staff.
    await expect(
      executeCommand(setDoorStaffCommand, { eventId, userId: b.viewerId, checkpointIds: [] }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await executeQuery(doorStaffQuery, { eventId }, b.ctx(), ports)).toEqual([]);
  });

  it('online: a scoped member admits at their checkpoint and gets wrong_checkpoint elsewhere', async () => {
    expect(await scanAs(viewer(at(1)), t(0).shortCode, north)).toMatchObject({ result: 'admitted' });
    const refused = await scanAs(viewer(at(2)), t(1).shortCode, south);
    // The refusal says nothing about the ticket, and nothing is admitted.
    expect(refused).toEqual({
      result: 'wrong_checkpoint',
      ticket: null,
      admissionId: null,
      firstAdmittedAt: null,
    });
    expect((await scanAs(viewer(at(3)), t(1).code)).result).toBe('wrong_checkpoint');
    expect((await scanAs(viewer(at(4)), t(1).shortCode, lounge)).result).toBe('wrong_checkpoint');
    const [log] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ n: number; with_ticket: number }>(
        sql`select count(*)::int as n, count(ticket_id)::int as with_ticket from checkin.scans where event_id = ${eventId} and result = 'wrong_checkpoint'`,
      ),
    );
    expect(log).toEqual({ n: 3, with_ticket: 0 });
    // The owner (an org role) is not scoped.
    expect((await scanAs(a.ctx({ now: at(5) }), t(1).shortCode, south)).result).toBe('admitted');
    const status = await executeQuery(checkinStatusQuery, { eventId }, a.ctx({ now: at(6) }), ports);
    expect(status.admittedToday).toBe(2);
    expect(status.staff).toEqual([
      { checkpointId: null, userIds: [] },
      { checkpointId: north, userIds: [a.viewerId] },
      { checkpointId: south, userIds: [] },
      { checkpointId: lounge, userIds: [] },
    ]);
  });

  it('widening to the whole event lifts the limit; an expired assignment grants nothing', async () => {
    await executeCommand(
      setDoorStaffCommand,
      { eventId, userId: a.viewerId, checkpointIds: [] },
      a.ctx(),
      ports,
    );
    expect((await scanAs(viewer(at(10)), t(2).shortCode, south)).result).toBe('admitted');
    expect((await scanAs(viewer(at(11)), t(3).shortCode)).result).toBe('admitted');
    const status = await executeQuery(checkinStatusQuery, { eventId }, a.ctx({ now: at(12) }), ports);
    expect(status.staff[0]).toEqual({ checkpointId: null, userIds: [a.viewerId] });
    await executeCommand(
      setDoorStaffCommand,
      { eventId, userId: a.viewerId, checkpointIds: [north], expiresAt: at(20) },
      a.ctx(),
      ports,
    );
    await expect(scanAs(viewer(at(21)), t(4).shortCode, north)).rejects.toMatchObject({ code: 'forbidden' });
    await executeCommand(
      setDoorStaffCommand,
      { eventId, userId: a.viewerId, checkpointIds: [north] },
      a.ctx(),
      ports,
    );
  });

  it('manifest: a device handed to scoped staff gets only their checkpoints, with a signed scope', async () => {
    const enroll = async (label: string, assignedUserId: string | null) => {
      const r = await executeCommand(enrollDeviceCommand, { label, assignedUserId }, a.ctx(), ports);
      const dc = await deviceContext(r.token);
      if (!dc) throw new Error('device did not resolve');
      return { ...r, ctx: (now = DOORS): Ctx => ({ ...dc.ctx, now }) };
    };
    await expect(
      executeCommand(enrollDeviceCommand, { label: 'Stranger', assignedUserId: uuidv7() }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { field: 'assignedUserId' } });

    const scoped = await enroll('Jordan phone', a.viewerId);
    const page = await executeQuery(deviceManifestQuery, { eventId, limit: 100 }, scoped.ctx(), ports);
    expect(page.header.version).toBe(2);
    expect(page.header.checkpoints.map((c) => c.name)).toEqual(['North gate']);
    expect(page.header.scope).toMatchObject({ eventId, deviceId: scoped.deviceId, checkpointIds: [north] });
    expect(await verifyManifestScope(page.header)).toBe(true);
    // A widened copy no longer verifies.
    expect(
      await verifyManifestScope({
        ...page.header,
        scope: { ...page.header.scope, checkpointIds: [north, south] },
      }),
    ).toBe(false);

    const state: OfflineState = {
      header: page.header,
      byId: new Map(page.rows.map((r) => [r.ticketId, r])),
      byShortCode: new Map(page.rows.map((r) => [r.shortCode, r])),
      admitted: new Set(),
      lastSyncAt: DOORS,
    };
    expect((await offlineVerdict(state, t(5).code, at(30), north)).verdict).toBe('admit');
    expect((await offlineVerdict(state, t(5).code, at(30), south)).verdict).toBe('wrong_checkpoint');

    // An org device (unassigned) sees every live checkpoint and an unrestricted scope.
    const org = await enroll('Org tablet', null);
    const all = await executeQuery(deviceManifestQuery, { eventId, limit: 1 }, org.ctx(), ports);
    expect(all.header.checkpoints.map((c) => c.name)).toEqual(['North gate', 'South gate', 'Lounge']);
    expect(all.header.scope.checkpointIds).toBeNull();
    expect(await verifyManifestScope(all.header)).toBe(true);

    // A device handed to someone with no role at this event gets nothing.
    const stray = await enroll('Stray', outsiderId);
    await expect(
      executeQuery(deviceManifestQuery, { eventId, limit: 1 }, stray.ctx(), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });

    // Sync: the server enforces the scope, including for old app versions that ignore it.
    const scans = [
      { at: 31, checkpointId: north, i: 6, verdict: 'admit' as const },
      { at: 32, checkpointId: south, i: 7, verdict: 'admit' as const },
      { at: 33, checkpointId: undefined, i: 8, verdict: 'admit' as const },
    ].map((s) => ({
      scanId: uuidv7(),
      code: t(s.i).code,
      deviceTs: at(s.at),
      clockOffsetMs: 0,
      verdict: s.verdict,
      ...(s.checkpointId ? { checkpointId: s.checkpointId } : {}),
    }));
    const res = await executeCommand(syncScansCommand, { eventId, scans }, scoped.ctx(at(40)), ports);
    expect(res.results.map((r) => r.result)).toEqual(['admitted', 'wrong_checkpoint', 'wrong_checkpoint']);
    const [admitted] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from checkin.admissions where event_id = ${eventId} and ticket_id in (${t(7).id}, ${t(8).id})`,
      ),
    );
    expect(admitted?.n).toBe(0);
  });

  it('removing the assignment ends access; isolation holds for another org', async () => {
    await executeCommand(removeDoorStaffCommand, { eventId, userId: a.viewerId }, a.ctx(), ports);
    await expect(
      executeCommand(removeDoorStaffCommand, { eventId, userId: a.viewerId }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(scanAs(viewer(at(50)), t(9).shortCode, north)).rejects.toMatchObject({ code: 'forbidden' });
    const [row] = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from events.event_role_assignments where event_id = ${eventId}`,
      ),
    );
    expect(row?.n).toBe(0);
    // Put it back for anyone running after us.
    await executeCommand(
      setDoorStaffCommand,
      { eventId, userId: a.viewerId, checkpointIds: [north] },
      a.ctx(),
      ports,
    );
  });
});
