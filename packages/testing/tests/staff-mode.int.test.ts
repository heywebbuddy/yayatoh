import { createECDH, randomBytes } from 'node:crypto';
import {
  claimStaffPushCommand,
  createCheckpointCommand,
  derivedStaffAlerts,
  deviceContext,
  enrollDeviceCommand,
  exitKioskCommand,
  heartbeatCommand,
  requestDeviceSyncCommand,
  revokeDeviceCommand,
  type StaffPushSender,
  sendStaffAlertPushes,
  staffAlertsSubscriber,
  staffOverviewQuery,
  staffPushStatusQuery,
  startKioskCommand,
  stopKioskCommand,
  subscribeStaffPushCommand,
  supervisorViewQuery,
  switchDeviceCheckpointCommand,
  syncScansCommand,
  unsubscribeStaffPushCommand,
  verifyKioskPin,
} from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { assignEventRoleCommand, createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { orderByManageToken, startCheckoutCommand } from '@yayatoh/orders';
import { consumeEvent } from '@yayatoh/platform';
import { addMemberCommand, changeMemberRoleCommand } from '@yayatoh/tenancy';
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
let tickets: { code: string; shortCode: string; id: string }[];
let scannerId: string;
let managerId: string;
let kioskOpId: string;
let doorStaffId: string;

const DOORS = new Date('2027-12-01T20:00:00Z');
const at = (sec: number) => new Date(DOORS.getTime() + sec * 1000);
const overview = staffOverviewQuery(derivedStaffAlerts);
const supervisorView = supervisorViewQuery(derivedStaffAlerts);
const subscribe = subscribeStaffPushCommand((e) => e.startsWith('https://push.example.test/'));

async function setup(f: OrgFixture, name: string, quantity: number) {
  const e = await executeCommand(
    createEventCommand,
    { name, timezone: 'America/Chicago', startsAt: '2027-12-01T15:00:00Z', endsAt: '2027-12-02T04:00:00Z' },
    f.ctx(),
    ports,
  );
  const tt = await executeCommand(
    createTicketTypeCommand,
    { eventId: e.id, name: 'GA', priceMinor: 0, quantityTotal: quantity, maxPerOrder: 50 },
    f.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, f.ctx(), ports);
  return { eventId: e.id, ticketTypeId: tt.id };
}

const cp = async (event: string, name: string, kind: 'entrance' | 'zone' = 'entrance') =>
  (await executeCommand(createCheckpointCommand, { eventId: event, name, kind }, a.ctx(), ports)).id;

async function member(role: string) {
  const id = uuidv7();
  await executeCommand(addMemberCommand, { userId: id, role }, a.ctx(), ports);
  return id;
}

async function enroll(label: string, f = a) {
  const { token, deviceId } = await executeCommand(enrollDeviceCommand, { label }, f.ctx(), ports);
  const dc = await deviceContext(token);
  if (!dc) throw new Error('enrolled device did not resolve');
  return { token, deviceId, ctx: (now = DOORS): Ctx => ({ ...dc.ctx, now }) };
}

const beat = (
  d: { ctx: (now?: Date) => Ctx },
  opts: { now?: Date; eventId?: string; checkpointId?: string | null; battery?: number; queue?: number } = {},
) =>
  executeCommand(
    heartbeatCommand,
    {
      batteryPct: opts.battery ?? 90,
      queueDepth: opts.queue ?? 0,
      clockOffsetMs: 0,
      ...(opts.eventId === undefined ? { eventId } : opts.eventId ? { eventId: opts.eventId } : {}),
      ...(opts.checkpointId !== undefined ? { checkpointId: opts.checkpointId } : {}),
    },
    d.ctx(opts.now),
    ports,
  );

const as = (userId: string, now = DOORS, extra: Partial<Ctx> = {}) =>
  userCtx(userId, a.org.id, { now, ...extra });

function pushKeys() {
  const k = createECDH('prime256v1');
  k.generateKeys();
  return { p256dh: k.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
}
const COPY = {
  device_offline: { title: 'Offline', body: '{label} stopped reporting' },
  device_low_battery: { title: 'Battery', body: '{label} at {percent}%' },
  device_backlog: { title: 'Backlog', body: '{label}: {count} waiting' },
  capacity_near: { title: 'Nearly full', body: '{percent}% are in' },
};

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const main = await setup(a, 'Staff mode', 400);
  eventId = main.eventId;
  tickets = [];
  for (let i = 0; i < 8; i++) {
    const r = await executeCommand(
      startCheckoutCommand,
      {
        eventId,
        items: [{ ticketTypeId: main.ticketTypeId, quantity: 50 }],
        buyer: { email: `staff${i}@example.test`, name: `Guest ${i}` },
      },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    tickets.push(
      ...((await orderByManageToken(r.manageToken))?.tickets ?? []).map((x) => ({
        code: x.code,
        shortCode: x.shortCode,
        id: x.id,
      })),
    );
  }
  north = await cp(eventId, 'North gate');
  south = await cp(eventId, 'South gate');
  lounge = await cp(eventId, 'Lounge', 'zone');
  otherEventId = (await setup(a, 'Other doors', 5)).eventId;
  scannerId = await member('scanner');
  managerId = await member('manager');
  kioskOpId = await member('viewer');
  doorStaffId = await member('viewer');
  await executeCommand(
    assignEventRoleCommand,
    { eventId, userId: kioskOpId, role: 'kiosk_operator' },
    a.ctx(),
    ports,
  );
  await executeCommand(
    assignEventRoleCommand,
    { eventId, userId: doorStaffId, role: 'door_staff' },
    a.ctx(),
    ports,
  );
}, 240_000);
afterAll(closePools);

describe('offline robustness (M3.4a acceptance)', () => {
  it('600 offline scans across 3 devices — duplicates, retries and conflicting devices — sync exactly once', async () => {
    expect(tickets).toHaveLength(400);
    const devs = await Promise.all(['Gate A', 'Gate B', 'Gate C'].map((l) => enroll(l)));
    const offsets = [0, 45_000, -20_000];
    type Q = {
      scanId: string;
      code: string;
      deviceTs: string;
      clockOffsetMs: number;
      verdict: 'admit' | 'duplicate' | 'invalid';
      checkpointId?: string;
    };
    const queues: Q[][] = [[], [], []];
    /** Earliest true time each ticket was scanned (the first-wins answer). */
    const first = new Map<string, number>();
    const seenOn = [new Set<string>(), new Set<string>(), new Set<string>()];
    let n = 0;
    const scan = (dev: number, code: string, id: string | null, trueSec: number) => {
      const offset = offsets[dev] as number;
      const trueTime = at(trueSec).getTime();
      const local = seenOn[dev] as Set<string>;
      const verdict = id === null ? 'invalid' : local.has(id) ? 'duplicate' : 'admit';
      if (id) {
        local.add(id);
        first.set(id, Math.min(first.get(id) ?? Number.POSITIVE_INFINITY, trueTime));
      }
      (queues[dev] as Q[]).push({
        scanId: uuidv7(),
        code,
        // The device's clock is off by `offset`; the offset measured at its last sync corrects it.
        deviceTs: new Date(trueTime - offset).toISOString(),
        clockOffsetMs: offset,
        verdict,
        checkpointId: dev === 1 ? south : north,
      });
      n += 1;
    };
    // 400 tickets split over the devices (each once), 2.5 s apart per device (under the
    // velocity limit), then 150 cross-device duplicates, 30 same-device repeats, 20 bad codes.
    tickets.forEach((t, i) => {
      scan(i % 3, i % 2 ? t.code : t.shortCode, t.id, Math.floor(i / 3) * 2.5);
    });
    for (let i = 0; i < 150; i++) {
      const t = tickets[i * 2] as (typeof tickets)[number];
      // Some of these are *earlier* on the second device (it takes over; the first becomes a duplicate).
      scan((i * 2 + 1) % 3, t.shortCode, t.id, Math.floor((i * 2) / 3) * 2.5 + (i % 4 === 0 ? -1 : 400));
    }
    for (let i = 0; i < 30; i++) {
      const t = tickets[i * 3] as (typeof tickets)[number];
      scan(0, t.code, t.id, 600 + i * 2.5);
    }
    for (let i = 0; i < 20; i++) scan(2, `ZZZZ${String(i).padStart(4, '2')}`, null, 700 + i * 2.5);
    expect(n).toBe(600);

    // Back online: every device flushes its queue in batches of ≤ 500, and each batch is sent
    // twice at the same time (a retry racing its first attempt), all devices concurrently.
    const batches = devs.flatMap((d, i) => {
      const q = queues[i] as Q[];
      const out: { d: typeof d; scans: Q[] }[] = [];
      for (let j = 0; j < q.length; j += 500) out.push({ d, scans: q.slice(j, j + 500) });
      return out;
    });
    const send = (x: (typeof batches)[number]) =>
      executeCommand(syncScansCommand, { eventId, scans: x.scans }, x.d.ctx(at(900)), ports);
    const replies = await Promise.all(batches.flatMap((x) => [send(x), send(x)]));
    // Of each pair exactly one stored every scan; the other replayed the stored answers.
    const stored = replies.flatMap((r) => r.results.filter((s) => s.stored));
    expect(stored).toHaveLength(600);
    expect(new Set(stored.map((s) => s.scanId)).size).toBe(600);

    const counts = await withTenant(systemCtx(a.org.id), async (tx) => {
      const [c] = await tx.execute<{
        scans: number;
        admissions: number;
        tickets: number;
        admitted_events: number;
      }>(sql`
        select
          (select count(*)::int from checkin.scans where event_id = ${eventId} and offline) as scans,
          (select count(*)::int from checkin.admissions where event_id = ${eventId} and undone_at is null) as admissions,
          (select count(distinct ticket_id)::int from checkin.admissions where event_id = ${eventId} and undone_at is null) as tickets,
          (select count(*)::int from platform.domain_events
             where type = 'ticket.admitted' and payload->>'eventId' = ${eventId}) as admitted_events`);
      const wins = await tx.execute<{ ticket_id: string; admitted_at: string }>(
        sql`select ticket_id, admitted_at from checkin.admissions where event_id = ${eventId} and undone_at is null`,
      );
      return { ...c, wins };
    });
    expect(counts.scans).toBe(600);
    expect(counts.admissions).toBe(400);
    expect(counts.tickets).toBe(400);
    expect(counts.admitted_events).toBe(400);
    // First-wins on corrected time: every admission dates from the ticket's earliest scan.
    for (const w of counts.wins) expect(new Date(w.admitted_at).getTime()).toBe(first.get(w.ticket_id));
    const results = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ result: string; n: number }>(
        sql`select result, count(*)::int as n from checkin.scans where event_id = ${eventId} group by result`,
      ),
    );
    const byResult = Object.fromEntries(results.map((r) => [r.result, r.n]));
    // One winning scan per ticket; every other sighting is a (local or offline) duplicate.
    expect(byResult.admitted).toBe(400);
    expect(byResult.invalid).toBe(20);
    expect((byResult.duplicate ?? 0) + (byResult.duplicate_offline ?? 0)).toBe(180);
    expect(byResult.duplicate_offline).toBeGreaterThan(0);

    // A late third retry of everything changes nothing.
    const again = await Promise.all(batches.map(send));
    expect(again.flatMap((r) => r.results).every((s) => !s.stored)).toBe(true);
    const [after] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ scans: number; admissions: number }>(sql`
        select (select count(*)::int from checkin.scans where event_id = ${eventId}) as scans,
          (select count(*)::int from checkin.admissions where event_id = ${eventId} and undone_at is null) as admissions`),
    );
    expect(after).toEqual({ scans: 600, admissions: 400 });
  }, 240_000);
});

describe('staff mode: overview, device board and alerts', () => {
  it('counts per entrance and date, board devices at the event, alerts by role', async () => {
    const staff = await enroll('Staff phone');
    const sup = await enroll('Supervisor phone');
    const flat = await enroll('Flat battery');
    const quiet = await enroll('Quiet one');
    await beat(staff, { checkpointId: north });
    await beat(sup, { checkpointId: south });
    await beat(flat, { battery: 12, queue: 75, checkpointId: north });
    await beat(quiet, { now: at(-600) });
    // A heartbeat naming another org's event, or a checkpoint of another event, is ignored.
    await beat(staff, { eventId: b.event.id, checkpointId: north });

    const view = await executeQuery(overview, { eventId }, staff.ctx(at(30)), ports);
    expect(view.expected).toBe(400);
    expect(view.checkedIn).toBe(400);
    expect(view.byEntrance.map((e) => e.name)).toEqual(['North gate', 'South gate']);
    expect(view.byEntrance.reduce((s, e) => s + e.checkedIn, 0)).toBe(400);
    expect(view.byDate).toEqual([{ day: '2027-12-01', checkedIn: 400 }]);
    const board = new Map(view.devices.map((d) => [d.label, d]));
    expect(board.get('Staff phone')).toMatchObject({ online: true, self: true, checkpointId: north });
    expect(board.get('Quiet one')).toMatchObject({ online: false, self: false });
    expect(board.get('Flat battery')).toMatchObject({ batteryPct: 12, queueDepth: 75 });
    // Everyone is in: capacity is near; device alerts are for supervisors' devices only.
    expect(view.alerts.map((x) => x.kind)).toEqual(['capacity_near']);
    expect(view.alerts[0]?.percent).toBe(100);

    // The supervisor's phone opts in to alerts and is claimed by a manager: device alerts too.
    await executeCommand(
      subscribe,
      { endpoint: 'https://push.example.test/sup', keys: pushKeys(), locale: 'en', copy: COPY },
      sup.ctx(),
      ports,
    );
    await executeCommand(
      claimStaffPushCommand,
      { eventId, deviceId: sup.deviceId, supervisor: true },
      as(managerId),
      ports,
    );
    const supView = await executeQuery(overview, { eventId }, sup.ctx(at(30)), ports);
    expect(supView.alerts.map((x) => `${x.kind}:${x.deviceLabel ?? ''}`).sort()).toEqual([
      'capacity_near:',
      'device_backlog:Flat battery',
      'device_low_battery:Flat battery',
      'device_offline:Quiet one',
    ]);
    // Demoted: the claim no longer shows device alerts.
    await executeCommand(changeMemberRoleCommand, { userId: managerId, role: 'viewer' }, a.ctx(), ports);
    const demoted = await executeQuery(overview, { eventId }, sup.ctx(at(30)), ports);
    expect(demoted.alerts.map((x) => x.kind)).toEqual(['capacity_near']);
    await executeCommand(changeMemberRoleCommand, { userId: managerId, role: 'manager' }, a.ctx(), ports);

    // Users can't read the device screen; another org's device can't read this event.
    await expect(executeQuery(overview, { eventId }, a.ctx(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const foreign = await enroll('Foreign', b);
    await expect(executeQuery(overview, { eventId }, foreign.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    // Allowlisted DTO: no token hash, PIN or endpoint anywhere.
    expect(JSON.stringify(supView)).not.toMatch(/token|pbkdf2|push\.example/);
  });

  it('staff web push: queued once per alert episode, device alerts only to supervisors, sent and expired', async () => {
    const watcher = await enroll('Watcher');
    const boss = await enroll('Boss phone');
    const gone = await enroll('Gone');
    await beat(watcher);
    await beat(boss);
    await beat(gone, { now: at(-300) });
    // Endpoint and copy are validated.
    await expect(
      executeCommand(
        subscribe,
        { endpoint: 'https://evil.test/x', keys: pushKeys(), locale: 'en', copy: COPY },
        watcher.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(
        subscribe,
        {
          endpoint: 'https://push.example.test/w',
          keys: pushKeys(),
          locale: 'en',
          copy: { ...COPY, capacity_near: { title: '<b>', body: 'x' } },
        },
        watcher.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await executeCommand(
      subscribe,
      { endpoint: 'https://push.example.test/w', keys: pushKeys(), locale: 'en', copy: COPY },
      watcher.ctx(),
      ports,
    );
    await executeCommand(
      subscribe,
      { endpoint: 'https://push.example.test/gone-boss', keys: pushKeys(), locale: 'ar', copy: COPY },
      boss.ctx(),
      ports,
    );
    // Only supervisors can claim device alerts: a scanner and door staff are refused.
    for (const who of [scannerId, doorStaffId])
      await expect(
        executeCommand(
          claimStaffPushCommand,
          { eventId, deviceId: boss.deviceId, supervisor: true },
          as(who),
          ports,
        ),
      ).rejects.toMatchObject({ code: 'forbidden' });
    await executeCommand(
      claimStaffPushCommand,
      { eventId, deviceId: boss.deviceId, supervisor: true },
      a.ctx(),
      ports,
    );
    expect(await executeQuery(staffPushStatusQuery, {}, boss.ctx(), ports)).toMatchObject({
      subscribed: true,
      supervisor: true,
    });

    // A heartbeat runs the subscriber (as the worker would), twice: queued once.
    const sub = staffAlertsSubscriber(derivedStaffAlerts, { now: () => at(60) });
    const [hb] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string; log_seq: number }>(
        sql`select id, log_seq from platform.domain_events where type = 'device.heartbeat' and aggregate_id = ${watcher.deviceId} order by log_seq desc limit 1`,
      ),
    );
    const published = {
      id: hb?.id ?? '',
      orgId: a.org.id,
      type: 'device.heartbeat',
      version: 1,
      aggregateType: 'device',
      aggregateId: watcher.deviceId,
      payload: { orgId: a.org.id, deviceId: watcher.deviceId },
      logSeq: Number(hb?.log_seq ?? 0),
    };
    expect(await consumeEvent(sub, published)).toBe(true);
    expect(await consumeEvent(sub, published)).toBe(false);
    const queued = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ device_id: string; kind: string; alert_key: string }>(sql`
        select s.device_id, p.kind, p.alert_key from checkin.staff_alert_pushes p
        join checkin.staff_push_subscriptions s on s.id = p.subscription_id
        where p.event_id = ${eventId} and p.status = 'queued'`),
    );
    const forWatcher = queued.filter((q) => q.device_id === watcher.deviceId).map((q) => q.kind);
    const forBoss = queued.filter((q) => q.device_id === boss.deviceId).map((q) => q.kind);
    expect(forWatcher).toEqual(['capacity_near']);
    expect(forBoss).toContain('device_offline');
    expect(forBoss).toContain('capacity_near');

    const sentTo: { token: string; title: string; body: string; lang?: string; dir?: string }[] = [];
    const sender: StaffPushSender = {
      send: async (m) => {
        sentTo.push(m);
        return m.token.includes('gone-')
          ? { error: 'invalid_token', status: 410 }
          : { providerMessageId: 'ok' };
      },
    };
    const r = await sendStaffAlertPushes(a.org.id, sender);
    expect(r.sent).toBeGreaterThanOrEqual(1);
    expect(sentTo.find((m) => m.token.endsWith('/w'))).toMatchObject({
      title: 'Nearly full',
      body: '100% are in',
    });
    expect(
      sentTo.find((m) => m.token.endsWith('/gone-boss') && m.body === 'Gone stopped reporting'),
    ).toMatchObject({ lang: 'ar', dir: 'rtl' });
    // Sending again sends nothing (each alert once per device); the expired one is disabled.
    const before = sentTo.length;
    await sendStaffAlertPushes(a.org.id, sender);
    expect(sentTo.length).toBe(before);
    expect(await executeQuery(staffPushStatusQuery, {}, boss.ctx(), ports)).toMatchObject({
      subscribed: false,
    });
    await executeCommand(unsubscribeStaffPushCommand, {}, watcher.ctx(), ports);
    expect(await executeQuery(staffPushStatusQuery, {}, watcher.ctx(), ports)).toMatchObject({
      subscribed: false,
    });
    // Another org sees none of it.
    const [other] = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from checkin.staff_alert_pushes where event_id = ${eventId}`,
      ),
    );
    expect(other?.n).toBe(0);
  });
});

describe('supervisor mode', () => {
  it('sees every device; force sync and switch entrance reach the device by heartbeat; audited', async () => {
    const d = await enroll('Switchable');
    await beat(d, { checkpointId: north });
    const unused = await enroll('Fresh from the box');
    const view = await executeQuery(supervisorView, { eventId }, a.ctx(), ports);
    expect(view.devices.find((x) => x.id === d.deviceId)).toMatchObject({
      where: 'here',
      checkpointId: north,
    });
    expect(view.devices.find((x) => x.id === unused.deviceId)).toMatchObject({
      where: 'unused',
      online: false,
    });
    expect(view.checkpoints.map((c) => c.name)).toEqual(['North gate', 'South gate', 'Lounge']);

    await executeCommand(
      requestDeviceSyncCommand,
      { eventId, deviceId: d.deviceId },
      as(managerId, at(60)),
      ports,
    );
    await executeCommand(
      switchDeviceCheckpointCommand,
      { eventId, deviceId: d.deviceId, checkpointId: lounge },
      as(managerId, at(60)),
      ports,
    );
    const hb = await beat(d, { now: at(61) });
    expect(hb.syncRequestedAt).toEqual(at(60));
    expect(hb.checkpoint).toEqual({ id: lounge, requestedAt: at(60) });
    await expect(
      executeCommand(
        switchDeviceCheckpointCommand,
        { eventId, deviceId: d.deviceId, checkpointId: uuidv7() },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const audits = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ action: string }>(
        sql`select action from platform.audit_events where target_id = ${d.deviceId} order by created_at`,
      ),
    );
    expect(audits.map((x) => x.action)).toEqual(
      expect.arrayContaining(['device.force_sync', 'device.switch_checkpoint']),
    );
    // The realtime poke names the device only.
    const [poke] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ data: unknown }>(
        sql`select data from platform.realtime_messages where event = 'command' and channel = ${`org:${a.org.id}:event:${eventId}:devices`} order by seq desc limit 1`,
      ),
    );
    expect(poke?.data).toEqual({ deviceId: d.deviceId, at: at(60).toISOString() });
  });

  it('permissions: scanner, door staff and viewer refused; kiosk operators read but do not supervise; other event and org refused', async () => {
    const d = await enroll('Guarded');
    await beat(d);
    const act = { eventId, deviceId: d.deviceId };
    for (const who of [scannerId, doorStaffId, a.viewerId, kioskOpId])
      await expect(executeCommand(requestDeviceSyncCommand, act, as(who), ports)).rejects.toMatchObject({
        code: 'forbidden',
      });
    for (const who of [scannerId, doorStaffId, a.viewerId])
      await expect(executeQuery(supervisorView, { eventId }, as(who), ports)).rejects.toMatchObject({
        code: 'forbidden',
      });
    expect(
      (await executeQuery(supervisorView, { eventId }, as(kioskOpId), ports)).devices.length,
    ).toBeGreaterThan(0);
    // The kiosk operator's role is for this event only.
    await expect(
      executeQuery(supervisorView, { eventId: otherEventId }, as(kioskOpId), ports),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    // A device working another event is out of reach from this one.
    await beat(d, { eventId: otherEventId });
    await expect(executeCommand(requestDeviceSyncCommand, act, a.ctx(), ports)).rejects.toMatchObject({
      code: 'conflict',
    });
    // Another org: not found.
    await expect(
      executeCommand(requestDeviceSyncCommand, { eventId: b.event.id, deviceId: d.deviceId }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('revoke needs a fresh step-up; the key stops working at once; audited', async () => {
    const d = await enroll('Lost phone');
    await beat(d);
    const act = { eventId, deviceId: d.deviceId };
    await expect(
      executeCommand(revokeDeviceCommand, act, as(managerId, DOORS, { stepUpAt: null }), ports),
    ).rejects.toMatchObject({ code: 'step_up_required' });
    expect(await deviceContext(d.token)).not.toBeNull();
    await executeCommand(revokeDeviceCommand, act, as(managerId), ports);
    expect(await deviceContext(d.token)).toBeNull();
    const [row] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ actor: string }>(
        sql`select actor from platform.audit_events where action = 'device.revoke' and target_id = ${d.deviceId}`,
      ),
    );
    expect(row?.actor).toContain(managerId);
    await expect(executeCommand(revokeDeviceCommand, act, as(managerId), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('kiosk mode', () => {
  it('locks a device to one entrance with a PIN the device checks offline; exit closes that kiosk session only', async () => {
    const k = await enroll('Lobby kiosk');
    await beat(k);
    const start = (input: { checkpointId: string | null; pin: string }, ctx = as(kioskOpId)) =>
      executeCommand(startKioskCommand, { eventId, deviceId: k.deviceId, ...input }, ctx, ports);
    await expect(start({ checkpointId: north, pin: '12' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(start({ checkpointId: north, pin: 'abcd' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(start({ checkpointId: lounge, pin: '1234' })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { field: 'checkpointId' },
    });
    await expect(start({ checkpointId: null, pin: '1234' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    // Door staff and viewers can't; the kiosk operator (event role) can.
    await expect(start({ checkpointId: north, pin: '1234' }, as(doorStaffId))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(start({ checkpointId: north, pin: '1234' }, as(a.viewerId))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await start({ checkpointId: north, pin: '482915' });

    const hb = await beat(k, { now: at(5) });
    expect(hb.kiosk).toMatchObject({ eventId, checkpointId: north });
    expect(verifyKioskPin('482915', hb.kiosk?.pinHash ?? '')).toBe(true);
    expect(verifyKioskPin('000000', hb.kiosk?.pinHash ?? '')).toBe(false);
    // A supervisor can't switch a kiosk's entrance.
    await expect(
      executeCommand(
        switchDeviceCheckpointCommand,
        { eventId, deviceId: k.deviceId, checkpointId: south },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    // The PIN is never in the audit log.
    const audits = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ action: string; data: unknown }>(
        sql`select action, data from platform.audit_events where target_id = ${k.deviceId}`,
      ),
    );
    expect(audits.map((x) => x.action)).toContain('device.kiosk_start');
    expect(JSON.stringify(audits)).not.toContain('482915');

    // The kiosk reports an exit for an older session: nothing changes; for this one: back to scanner.
    const startedAt = hb.kiosk?.startedAt as Date;
    expect(
      await executeCommand(
        exitKioskCommand,
        { startedAt: new Date(startedAt.getTime() - 1000) },
        k.ctx(),
        ports,
      ),
    ).toEqual({ ok: false });
    expect(await executeCommand(exitKioskCommand, { startedAt }, k.ctx(), ports)).toEqual({ ok: true });
    expect((await beat(k, { now: at(10) })).kiosk).toBeNull();
    // Users can't report an exit; stop from supervisor mode is idempotent.
    await expect(executeCommand(exitKioskCommand, { startedAt }, a.ctx(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await start({ checkpointId: south, pin: '7777' });
    await executeCommand(stopKioskCommand, { eventId, deviceId: k.deviceId }, as(kioskOpId), ports);
    await executeCommand(stopKioskCommand, { eventId, deviceId: k.deviceId }, as(kioskOpId), ports);
    expect((await beat(k, { now: at(20) })).kiosk).toBeNull();
  });
});
