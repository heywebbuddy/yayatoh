import {
  checkinStatusQuery,
  createCheckpointCommand,
  detectionSettingsQuery,
  deviceContext,
  enrollDeviceCommand,
  listFraudSignalsQuery,
  resolveFraudSignalCommand,
  scanTicketCommand,
  setDetectionSettingsCommand,
  setDoorStaffCommand,
  syncScansCommand,
} from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { orderByManageToken, startCheckoutCommand } from '@yayatoh/orders';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let north: string;
let hall: string;
let tickets: { code: string; shortCode: string; id: string }[];

const DOORS = new Date('2027-12-01T20:00:00Z');
const at = (sec: number) => new Date(DOORS.getTime() + sec * 1000);
const t = (i: number) => {
  const x = tickets[i];
  if (!x) throw new Error(`no ticket ${i}`);
  return x;
};

async function enroll(label: string): Promise<{ deviceId: string; ctx: (now?: Date) => Ctx }> {
  const r = await executeCommand(enrollDeviceCommand, { label }, a.ctx(), ports);
  const dc = await deviceContext(r.token);
  if (!dc) throw new Error('device did not resolve');
  return { deviceId: r.deviceId, ctx: (now = DOORS) => ({ ...dc.ctx, now }) };
}

const offline = (
  code: string,
  sec: number,
  checkpointId?: string,
  verdict: 'admit' | 'duplicate' | 'granted' = 'admit',
) => ({
  scanId: uuidv7(),
  code,
  deviceTs: at(sec),
  clockOffsetMs: 0,
  verdict,
  ...(checkpointId ? { checkpointId } : {}),
});

async function signalsOf(kind: string) {
  return withTenant(a.ctx(), (tx) =>
    tx.execute<{
      id: string;
      severity: string;
      device_id: string | null;
      user_id: string | null;
      detail: Record<string, unknown>;
    }>(
      sql`select id, severity, device_id, user_id, detail from checkin.fraud_signals where event_id = ${eventId} and kind = ${kind} order by raised_at`,
    ),
  );
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const e = await executeCommand(
    createEventCommand,
    {
      name: 'Velocity',
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
    { eventId, name: 'GA', priceMinor: 0, quantityTotal: 50, maxPerOrder: 30 },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId: tt.id, quantity: 20 }],
      buyer: { email: 'v@example.test', name: 'Val' },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  tickets = ((await orderByManageToken(r.manageToken))?.tickets ?? []).map((x) => ({
    code: x.code,
    shortCode: x.shortCode,
    id: x.id,
  }));
  // Two gates ~700 m apart and a hall (a zone for every pass) next to the south gate.
  const cp = async (name: string, kind: 'entrance' | 'zone', latitude: number, longitude: number) =>
    (
      await executeCommand(
        createCheckpointCommand,
        { eventId, name, kind, latitude, longitude },
        a.ctx(),
        ports,
      )
    ).id;
  north = await cp('North gate', 'entrance', 41.8623, -87.6167);
  await cp('South gate', 'entrance', 41.856, -87.6167);
  hall = await cp('Hall', 'zone', 41.8561, -87.6167);
});
afterAll(closePools);

describe('checkpoint locations', () => {
  it('are both-or-neither and within range', async () => {
    const create = (latitude: number | null, longitude: number | null) =>
      executeCommand(
        createCheckpointCommand,
        { eventId, name: `Gate ${uuidv7()}`, kind: 'entrance', latitude, longitude },
        a.ctx(),
        ports,
      );
    await expect(create(41.8, null)).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(create(91, 10)).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(create(10, -181)).rejects.toMatchObject({ code: 'validation_failed' });
    expect(await create(null, null)).toMatchObject({ latitude: null, longitude: null });
  });
});

describe('detection settings', () => {
  it('defaults until set; set by managers only, within range, audited', async () => {
    expect(await executeQuery(detectionSettingsQuery, { eventId }, a.ctx(), ports)).toEqual({
      maxScansPerMinute: 40,
      maxTravelKmh: 12,
      custom: false,
    });
    const set = (maxScansPerMinute: number, maxTravelKmh: number, ctx = a.ctx()) =>
      executeCommand(setDetectionSettingsCommand, { eventId, maxScansPerMinute, maxTravelKmh }, ctx, ports);
    await expect(set(1, 12)).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(set(40, 0)).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(set(4, 12, userCtx(a.viewerId, a.org.id))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(set(4, 12, b.ctx())).rejects.toMatchObject({ code: 'not_found' });
    expect(await set(4, 12)).toEqual({ maxScansPerMinute: 4, maxTravelKmh: 12, custom: true });
    const [audit] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ data: unknown }>(
        sql`select data from platform.audit_events where action = 'checkin.detection_settings' and target_id = ${eventId}`,
      ),
    );
    expect(audit?.data).toEqual({ maxScansPerMinute: 4, maxTravelKmh: 12 });
  });
});

describe('device velocity signals (M1.9d)', () => {
  it('online: a scanner going faster than the event limit raises one device_velocity per burst', async () => {
    // Limit 4 a minute. Five scans in 20 s: the fifth crosses it. More in the same minute don't repeat.
    for (let i = 0; i < 8; i++)
      await executeCommand(
        scanTicketCommand,
        { eventId, code: t(0).shortCode, checkpointId: north, clientScanId: `vel:${uuidv7()}` },
        a.ctx({ now: at(i * 5) }),
        ports,
      );
    const rows = await signalsOf('device_velocity');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ severity: 'medium', user_id: a.ownerId, device_id: null });
    expect(rows[0]?.detail).toEqual({ count: 5, windowSeconds: 60, limit: 4 });
    const [evt] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.domain_events where type = 'checkin.fraud_signal' and payload->>'kind' = 'device_velocity' and payload->>'eventId' = ${eventId}`,
      ),
    );
    expect(evt?.n).toBe(1);
  });

  it('offline: signals are computed on sync from the uploaded log (corrected time), once', async () => {
    const d = await enroll('Fast phone');
    // Six scans 3 s apart (by corrected time, sent out of order): device_velocity for this device.
    const batch = [0, 1, 2, 3, 4, 5].map((i) => offline(t(1 + i).code, 600 + i * 3, north)).reverse();
    await executeCommand(syncScansCommand, { eventId, scans: batch }, d.ctx(at(700)), ports);
    const mine = (await signalsOf('device_velocity')).filter((s) => s.device_id === d.deviceId);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.detail).toMatchObject({ count: 5, limit: 4 });
    // Re-syncing the same batch (a retry) raises nothing new.
    await executeCommand(syncScansCommand, { eventId, scans: batch }, d.ctx(at(710)), ports);
    expect((await signalsOf('device_velocity')).filter((s) => s.device_id === d.deviceId)).toHaveLength(1);
  });

  it('offline: a burst of refused scans from one device raises one rejected_burst', async () => {
    const d = await enroll('Refusing phone');
    // Eight duplicates (already admitted above), 16 s apart: under the rate limit, but all refused.
    const batch = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => offline(t(1).code, 1200 + i * 16, north, 'duplicate'));
    const res = await executeCommand(syncScansCommand, { eventId, scans: batch }, d.ctx(at(1400)), ports);
    expect(new Set(res.results.map((r) => r.result))).toEqual(new Set(['duplicate']));
    const rows = (await signalsOf('rejected_burst')).filter((s) => s.device_id === d.deviceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ severity: 'low' });
    expect(rows[0]?.detail).toEqual({ count: 8, windowSeconds: 120 });
    expect((await signalsOf('device_velocity')).filter((s) => s.device_id === d.deviceId)).toHaveLength(0);
  });

  it('offline: one ticket let in 700 m apart within a minute is impossible_travel (high), once', async () => {
    const gate = await enroll('North phone');
    const hallDevice = await enroll('Hall phone');
    await executeCommand(
      syncScansCommand,
      { eventId, scans: [offline(t(10).code, 2000, north)] },
      gate.ctx(at(2100)),
      ports,
    );
    const later = [offline(t(10).code, 2040, hall, 'granted')];
    await executeCommand(syncScansCommand, { eventId, scans: later }, hallDevice.ctx(at(2100)), ports);
    const rows = await signalsOf('impossible_travel');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.severity).toBe('high');
    expect(rows[0]?.detail).toMatchObject({ fromCheckpointId: north, seconds: 40 });
    expect(Number(rows[0]?.detail.kmh)).toBeGreaterThan(50);
    // The same pass at the south gate 10 minutes later is a walk, not a signal; a retry adds nothing.
    await executeCommand(syncScansCommand, { eventId, scans: later }, hallDevice.ctx(at(2200)), ports);
    await executeCommand(
      scanTicketCommand,
      { eventId, code: t(11).shortCode, checkpointId: north, clientScanId: `vel:${uuidv7()}` },
      a.ctx({ now: at(3000) }),
      ports,
    );
    await executeCommand(
      scanTicketCommand,
      { eventId, code: t(11).shortCode, checkpointId: hall, clientScanId: `vel:${uuidv7()}` },
      a.ctx({ now: at(3600) }),
      ports,
    );
    expect(await signalsOf('impossible_travel')).toHaveLength(1);
  });
});

describe('the fraud list and triage', () => {
  it('lists every signal with severity, open first; the door screen shows open ones only', async () => {
    const list = await executeQuery(listFraudSignalsQuery, { eventId }, a.ctx(), ports);
    expect(new Set(list.map((s) => s.kind))).toEqual(
      new Set(['device_velocity', 'rejected_burst', 'impossible_travel']),
    );
    expect(list[0]).toMatchObject({ kind: 'impossible_travel', severity: 'high', status: 'open' });
    expect(list[0]?.checkpointName).toBe('Hall');
    expect(list[0]?.fromCheckpointName).toBe('North gate');
    expect(list.find((s) => s.kind === 'rejected_burst')?.deviceLabel).toBe('Refusing phone');
    // Only allowlisted fields leave: no scan ids, no checkpoint ids in the detail (M1.9e adds the
    // checkout counts, known rule ids and a chat report's reason, all empty for door signals).
    expect(Object.keys(list[0]?.detail ?? {}).sort()).toEqual(
      [
        'count',
        'distanceM',
        'kmh',
        'limit',
        'seconds',
        'windowSeconds',
        'orders',
        'failures',
        'rules',
        'reason',
      ].sort(),
    );
    expect(list[0]?.detail).toMatchObject({ orders: null, failures: null, rules: [], reason: null });
  });

  it('managers acknowledge or dismiss (audited); viewers and door staff cannot; another org cannot', async () => {
    const list = await executeQuery(listFraudSignalsQuery, { eventId }, a.ctx(), ports);
    const travel = list.find((s) => s.kind === 'impossible_travel');
    const burst = list.find((s) => s.kind === 'rejected_burst');
    if (!travel || !burst) throw new Error('signals missing');
    // A dismissal carries its reason (M1.9e).
    const resolve = (signalId: string, status: 'acknowledged' | 'dismissed', ctx = a.ctx()) =>
      executeCommand(
        resolveFraudSignalCommand,
        { eventId, signalId, status, ...(status === 'dismissed' ? { note: 'Checked at the door' } : {}) },
        ctx,
        ports,
      );
    const viewer = userCtx(a.viewerId, a.org.id);
    await expect(resolve(travel.id, 'dismissed', viewer)).rejects.toMatchObject({ code: 'forbidden' });
    await executeCommand(
      setDoorStaffCommand,
      { eventId, userId: a.viewerId, checkpointIds: [] },
      a.ctx(),
      ports,
    );
    await expect(resolve(travel.id, 'dismissed', viewer)).rejects.toMatchObject({ code: 'forbidden' });
    // Door staff can read the list (they scan here); a plain viewer can't.
    expect((await executeQuery(listFraudSignalsQuery, { eventId }, viewer, ports)).length).toBe(list.length);
    await expect(resolve(travel.id, 'dismissed', b.ctx())).rejects.toMatchObject({ code: 'not_found' });

    expect(await resolve(travel.id, 'acknowledged')).toEqual({ id: travel.id, status: 'acknowledged' });
    await expect(resolve(travel.id, 'dismissed')).rejects.toMatchObject({ code: 'conflict' });
    expect(await resolve(burst.id, 'dismissed')).toEqual({ id: burst.id, status: 'dismissed' });
    await expect(resolve(uuidv7(), 'dismissed')).rejects.toMatchObject({ code: 'not_found' });

    const audits = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ action: string; target_id: string; actor: string }>(
        sql`select action, target_id, actor from platform.audit_events where target_type = 'fraud_signal' order by created_at`,
      ),
    );
    expect(audits.map((r) => [r.action, r.target_id])).toEqual([
      ['fraud_signal.acknowledge', travel.id],
      ['fraud_signal.dismiss', burst.id],
    ]);
    expect(audits[0]?.actor).toBe(`user:${a.ownerId}`);

    const after = await executeQuery(listFraudSignalsQuery, { eventId }, a.ctx(), ports);
    expect(after.at(-1)?.status).not.toBe('open');
    expect(after.find((s) => s.id === travel.id)).toMatchObject({ status: 'acknowledged' });
    const status = await executeQuery(checkinStatusQuery, { eventId }, a.ctx({ now: at(4000) }), ports);
    expect(status.signals.map((s) => s.id)).not.toContain(travel.id);
    expect(status.signals.every((s) => s.status === 'open')).toBe(true);
  });

  it('a viewer without an event role cannot read the fraud list; another org sees none of it', async () => {
    await expect(
      executeQuery(listFraudSignalsQuery, { eventId }, userCtx(b.viewerId, b.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await executeQuery(listFraudSignalsQuery, { eventId }, b.ctx(), ports)).toEqual([]);
  });
});
