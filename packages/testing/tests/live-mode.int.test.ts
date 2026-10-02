import {
  acknowledgeAlertCommand,
  catchUpAlerts,
  evaluateOrgNow,
  listAlertsQuery,
  setMyAlertPhoneCommand,
  watchQuietDevices,
} from '@yayatoh/alerts';
import {
  createCheckpointCommand,
  DEVICE_ONLINE_WINDOW_MS,
  enrollDeviceCommand,
  heartbeatCommand,
  reportPresenceCommand,
  scanTicketCommand,
  setDoorStaffCommand,
  syncScansCommand,
  undoAdmissionCommand,
} from '@yayatoh/checkin';
import {
  assistanceWidget,
  capacityWidget,
  checkinSpeedWidget,
  createDisplayLinkCommand,
  deviceBoardWidget,
  displayLinksQuery,
  liveFeedWidget,
  resolveDisplayLink,
  revokeDisplayLinkCommand,
  scanIssuesWidget,
  staffPresenceWidget,
  tvBoardQuery,
  type WidgetDef,
} from '@yayatoh/command-center';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { createNotifier } from '@yayatoh/notifications';
import { catchUpMetrics } from '@yayatoh/reports';
import { addMemberCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';
import { buy, publish, ticketsOf, typeOf } from './metrics-helpers.ts';

/**
 * M3.3a Command Center live mode: tiles fed by scans, device transitions and the metrics
 * projector; offline detection with a fake clock; TV display links (scope and revocation); staff
 * presence; live-critical escalation; tenant isolation.
 */

let a: OrgFixture;
let b: OrgFixture;
const deps = { notifier: createNotifier() };
const MIN = 60_000;
let manager = '';
let eventId = '';
let north = '';
let south = '';
let vip = '';
let codes: string[] = [];
let deviceId = '';
const t0 = new Date();
const at = (ms: number) => new Date(t0.getTime() + ms);
const deviceCtx = (id: string, now: Date, f: OrgFixture = a): Ctx =>
  createCtx({ orgId: f.org.id, actor: { type: 'system', name: `device:${id}` }, now });
const load = <O>(
  w: WidgetDef<O>,
  ctx: Ctx,
  params: Record<string, string> = {},
  event: string = eventId,
): Promise<O> => executeQuery(w.loader, { eventId: event, params }, ctx, ports);
const owner = (now: Date = at(0)) => a.ctx({ now });
const door = (now: Date = at(0)) => userCtx(a.viewerId, a.org.id, { now });

async function liveEvent(f: OrgFixture, name: string) {
  const e = await executeCommand(
    createEventCommand,
    {
      name,
      slug: `live-${uuidv7().slice(-12)}`,
      timezone: 'America/Chicago',
      startsAt: new Date(t0.getTime() - 30 * MIN).toISOString(),
      endsAt: new Date(t0.getTime() + 4 * 60 * MIN).toISOString(),
    },
    f.ctx(),
    ports,
  );
  return e.id;
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  manager = uuidv7();
  await executeCommand(addMemberCommand, { userId: manager, role: 'manager' }, a.ctx(), ports);
  eventId = await liveEvent(a, 'Live mode night');
  const pass = await typeOf(a, eventId, 'Door pass', 0, 20);
  await publish(a, eventId);
  const order = await buy(a, eventId, [{ ticketTypeId: pass, quantity: 10 }], 'Livia');
  codes = (await ticketsOf(a, order.id)).map((t) => t.short_code);
  const gate = async (name: string, kind: 'entrance' | 'zone', capacity: number | null) =>
    (await executeCommand(createCheckpointCommand, { eventId, name, kind, capacity }, a.ctx(), ports)).id;
  north = await gate('North gate', 'entrance', 5);
  south = await gate('South gate', 'entrance', null);
  vip = await gate('VIP lounge', 'zone', 2);
  // The fixture viewer works the door at this event too.
  await executeCommand(setDoorStaffCommand, { eventId, userId: a.viewerId }, a.ctx(), ports);
  // A scanner handed to the manager, reporting in at the north gate.
  const d = await executeCommand(
    enrollDeviceCommand,
    { label: 'Door 1', assignedUserId: manager },
    a.ctx(),
    ports,
  );
  deviceId = d.deviceId;
  await executeCommand(
    heartbeatCommand,
    {
      batteryPct: 80,
      queueDepth: 0,
      clockOffsetMs: 0,
      eventId,
      checkpointId: north,
      appVersion: '1.4.2',
    },
    deviceCtx(deviceId, at(-6 * MIN)),
    ports,
  );
}, 120_000);

afterAll(async () => {
  await closePools();
});

describe('tiles fed from scans and projector events', () => {
  it('builds the live feed from scans (check-in, duplicate, refused, re-entry) and device transitions', async () => {
    const scan = (code: string, checkpointId: string, ctx: Ctx) =>
      executeCommand(scanTicketCommand, { eventId, code, checkpointId }, ctx, ports);
    // Three in at the north gate from the device, one at the south gate from the door screen.
    for (const [i, code] of codes.slice(0, 3).entries())
      expect((await scan(code, north, deviceCtx(deviceId, at(-5 * MIN + i * 20_000)))).result).toBe(
        'admitted',
      );
    expect((await scan(codes[3] as string, south, owner(at(-4 * MIN)))).result).toBe('admitted');
    // A pass shown twice, a bad code, and a lounge visit.
    expect((await scan(codes[0] as string, north, deviceCtx(deviceId, at(-3 * MIN)))).result).toBe(
      'duplicate',
    );
    expect((await scan('ZZZZZZZZ', north, deviceCtx(deviceId, at(-2 * MIN)))).result).toBe('invalid');
    expect((await scan(codes[1] as string, vip, owner(at(-2 * MIN)))).result).toBe('granted');
    // Undone at the south gate (they left), then back in: a re-entry.
    const s = await scan(codes[3] as string, south, owner(at(-90_000)));
    expect(s.result).toBe('duplicate');
    await executeCommand(
      undoAdmissionCommand,
      { eventId, admissionId: s.admissionId as string },
      owner(at(-80_000)),
      ports,
    );
    expect((await scan(codes[3] as string, south, owner(at(-MIN)))).result).toBe('admitted');

    const feed = await load(liveFeedWidget(null), owner());
    const kinds = feed.items.map((i) => `${i.kind}:${i.reason}`);
    expect(kinds).toEqual([
      'reentry:admitted',
      'duplicate:duplicate',
      'checkin:granted',
      'invalid:invalid',
      'duplicate:duplicate',
      'checkin:admitted',
      'checkin:admitted',
      'checkin:admitted',
      'checkin:admitted',
      'device:online',
    ]);
    const first = feed.items.find((i) => i.kind === 'invalid');
    expect(first).toMatchObject({ checkpoint: 'North gate', device: 'Door 1', offline: false });
    // Only allowlisted fields: no ticket, code or holder travels.
    expect(Object.keys(first ?? {}).sort()).toEqual(
      ['alert', 'at', 'checkpoint', 'device', 'id', 'kind', 'offline', 'reason'].sort(),
    );
    expect(JSON.stringify(feed)).not.toContain('Livia');
    expect(feed.options.checkpoints.map((c) => c.name).sort()).toEqual([
      'North gate',
      'South gate',
      'VIP lounge',
    ]);
    expect(feed.options.devices).toEqual([{ id: deviceId, label: 'Door 1' }]);

    // Filters: by outcome, by entrance (device transitions are not at an entrance), by device.
    const dups = await load(liveFeedWidget(null), owner(), { kind: 'duplicate' });
    expect(dups.items.map((i) => i.kind)).toEqual(['duplicate', 'duplicate']);
    const reentries = await load(liveFeedWidget(null), owner(), { kind: 'reentry' });
    expect(reentries.items).toHaveLength(1);
    const checkins = await load(liveFeedWidget(null), owner(), { kind: 'checkin' });
    expect(checkins.items).toHaveLength(5);
    const atNorth = await load(liveFeedWidget(null), owner(), { checkpoint: north });
    expect(atNorth.items.every((i) => i.checkpoint === 'North gate')).toBe(true);
    expect(atNorth.items).toHaveLength(5);
    const onDevice = await load(liveFeedWidget(null), owner(), { device: deviceId });
    expect(onDevice.items.map((i) => i.kind)).toEqual([
      'invalid',
      'duplicate',
      'checkin',
      'checkin',
      'checkin',
      'device',
    ]);
    expect(await load(liveFeedWidget(null), owner(), { kind: 'device' })).toMatchObject({
      items: [{ kind: 'device', reason: 'online', device: 'Door 1' }],
    });
    // Unknown filter values are ignored.
    expect(
      (await load(liveFeedWidget(null), owner(), { kind: 'bogus', checkpoint: 'x' })).items,
    ).toHaveLength(10);
    // Alerts come from the app's alert source, and only without an entrance or device filter.
    const withAlerts = liveFeedWidget(async () => [
      {
        id: uuidv7(),
        rule: 'devicesOffline',
        severity: 'critical',
        state: 'open',
        count: 1,
        at: at(-10_000),
      },
    ]);
    expect((await load(withAlerts, owner())).items[0]).toMatchObject({
      kind: 'alert',
      reason: 'devicesOffline',
      alert: { severity: 'critical', state: 'open', count: 1 },
    });
    expect(
      (await load(withAlerts, owner(), { checkpoint: north })).items.some((i) => i.kind === 'alert'),
    ).toBe(false);
  });

  it('shows check-in speed per entrance and device, with the per-minute series from the metric projection', async () => {
    await catchUpMetrics(a.org.id);
    const speed = await load(checkinSpeedWidget, owner());
    // 8 scans in the last five minutes (the lounge and refusals count as work at the door; the
    // first one, exactly five minutes ago, is out of the window).
    expect(speed.windowMin).toBe(5);
    expect(speed.scansPerMin).toBe(1.6);
    expect(speed.remaining).toBe(6);
    expect(speed.queueMin).toBe(4);
    expect(speed.entrances.map((e) => [e.name, e.scansPerMin])).toEqual([
      ['North gate', 0.8],
      ['South gate', 0.6],
    ]);
    // North gate in the window: 4:40 and 4:20 ago, then 3:00 and 2:00 ago → gaps 20, 80, 60 s.
    expect(speed.entrances[0]?.medianGapS).toBe(60);
    // The six guests still expected split like today's admissions (3 : 1): 4.5 at the north
    // gate at 0.8 a minute, 1.5 at the south gate at 0.6 a minute.
    expect(speed.entrances.map((e) => e.queueMin)).toEqual([6, 3]);
    expect(speed.devices.map((d) => [d.name, d.scansPerMin])).toEqual([
      ['Door 1', 0.8],
      [null, 0.8],
    ]);
    // The chart: admissions per minute from the projection's `checkins.tickets` series.
    expect(speed.series).toHaveLength(15);
    expect(speed.series.reduce((s, p) => s + p.count, 0)).toBe(4);
  });

  it('counts duplicates and refusals with reasons, deep-linking the order only for roles that read orders', async () => {
    const issues = await load(scanIssuesWidget, owner());
    expect(issues.counts).toEqual([
      { result: 'duplicate', count: 2 },
      { result: 'invalid', count: 1 },
    ]);
    expect([issues.duplicates, issues.refused]).toEqual([2, 1]);
    expect(issues.recent.map((r) => r.result)).toEqual(['duplicate', 'invalid', 'duplicate']);
    expect(issues.recent[0]?.orderId).toMatch(/^[0-9a-f-]{36}$/);
    expect(issues.recent[1]).toMatchObject({
      result: 'invalid',
      orderId: null,
      checkpoint: 'North gate',
      device: 'Door 1',
    });
    // The door sees the same counts, never a link into orders.
    const atDoor = await load(scanIssuesWidget, door());
    expect(atDoor.duplicates).toBe(2);
    expect(atDoor.recent.every((r) => r.orderId === null)).toBe(true);
  });

  it('gauges capacity for the event and per area, with the alert engine’s thresholds', async () => {
    const cap = await load(capacityWidget, owner());
    expect(cap).toMatchObject({
      nearPct: 95,
      overPct: 100,
      venue: { inside: 4, out: 1, capacity: 20, remaining: 16, percent: 20, level: 'ok' },
    });
    expect(cap.areas).toEqual([
      {
        name: 'North gate',
        kind: 'entrance',
        inside: 3,
        capacity: 5,
        remaining: 2,
        percent: 60,
        level: 'ok',
      },
      {
        name: 'South gate',
        kind: 'entrance',
        inside: 1,
        capacity: null,
        remaining: null,
        percent: null,
        level: 'none',
      },
      { name: 'VIP lounge', kind: 'zone', inside: 1, capacity: 2, remaining: 1, percent: 50, level: 'ok' },
    ]);
    // Two more through the north gate: at capacity (over); the event stays ok.
    for (const code of codes.slice(4, 6))
      await executeCommand(
        scanTicketCommand,
        { eventId, code, checkpointId: north },
        owner(at(-20_000)),
        ports,
      );
    const full = await load(capacityWidget, owner());
    expect(full.areas[0]).toMatchObject({ inside: 5, remaining: 0, percent: 100, level: 'over' });
    expect(full.venue.level).toBe('ok');
  });

  it('shows each device’s app version and last scan on the device board', async () => {
    const board = await load(deviceBoardWidget, owner());
    const d = board.devices.find((x) => x.id === deviceId);
    expect(d).toMatchObject({
      label: 'Door 1',
      appVersion: '1.4.2',
      checkpoint: 'North gate',
      online: false,
    });
    expect(d?.lastScanAt).toBe(at(-2 * MIN).toISOString());
    // A heartbeat without a version keeps the last one; an invalid one is refused.
    await executeCommand(
      heartbeatCommand,
      { batteryPct: 70, queueDepth: 0, clockOffsetMs: 0 },
      deviceCtx(deviceId, at(0)),
      ports,
    );
    expect((await load(deviceBoardWidget, owner())).devices.find((x) => x.id === deviceId)).toMatchObject({
      appVersion: '1.4.2',
      online: true,
    });
    await expect(
      executeCommand(
        heartbeatCommand,
        { batteryPct: 70, queueDepth: 0, clockOffsetMs: 0, appVersion: '<script>' },
        deviceCtx(deviceId, at(0)),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('lists staff presence: door screens and handed-out devices, expiring after two minutes', async () => {
    await executeCommand(reportPresenceCommand, { eventId, checkpointId: south }, owner(at(-30_000)), ports);
    const names = async (ids: readonly string[]) =>
      new Map(ids.map((id) => [id, id === manager ? 'Mona' : 'Pat']));
    const people = await load(staffPresenceWidget(names), door());
    expect(people.people.map((p) => [p.name, p.source, p.device, p.checkpoint])).toEqual([
      ['Mona', 'device', 'Door 1', 'North gate'],
      ['Pat', 'door_screen', null, 'South gate'],
    ]);
    // Unknown or archived checkpoints mean the whole event; the viewer (door staff) may report too.
    await executeCommand(
      reportPresenceCommand,
      { eventId, checkpointId: uuidv7() },
      door(at(-10_000)),
      ports,
    );
    // A scanner-less member can't report presence.
    const finance = uuidv7();
    await executeCommand(addMemberCommand, { userId: finance, role: 'finance' }, a.ctx(), ports);
    await expect(
      executeCommand(
        reportPresenceCommand,
        { eventId, checkpointId: null },
        userCtx(finance, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const three = await load(staffPresenceWidget(null), owner());
    expect(three.people).toHaveLength(3);
    expect(three.people.find((p) => p.userId === a.viewerId)?.checkpoint).toBeNull();
    // Two minutes after each one's last ping, gone: the owner (30 s ago) first.
    const later = await load(staffPresenceWidget(null), owner(at(100_000)));
    expect(later.people.map((p) => p.userId)).toEqual([manager, a.viewerId]);
    expect((await load(staffPresenceWidget(null), owner(at(3 * MIN)))).people).toEqual([]);
  });

  it("fills the guest-assistance slot with M3.3b's queue, and refuses live widgets to roles without them", async () => {
    // Batch 3g merge: M3.3b's help queue is the registry's assistance widget (no requests yet).
    expect(await load(assistanceWidget, door())).toMatchObject({
      waiting: 0,
      assigned: 0,
      inProgress: 0,
      overdue: 0,
      top: [],
    });
    const finance = uuidv7();
    await executeCommand(addMemberCommand, { userId: finance, role: 'finance' }, a.ctx(), ports);
    for (const w of [
      liveFeedWidget(null),
      checkinSpeedWidget,
      scanIssuesWidget,
      capacityWidget,
      assistanceWidget,
    ] as WidgetDef<unknown>[])
      await expect(load(w, userCtx(finance, a.org.id))).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('offline detection (fake clock)', () => {
  it('records the device going quiet and raises "devices offline" within 90 s of its last heartbeat', async () => {
    const hb = at(10 * MIN);
    await executeCommand(
      heartbeatCommand,
      { batteryPct: 70, queueDepth: 0, clockOffsetMs: 0 },
      deviceCtx(deviceId, hb),
      ports,
    );
    await catchUpAlerts(a.org.id, deps);
    const offlineAlert = async (now: Date) =>
      (await executeQuery(listAlertsQuery, { eventId, limit: 50 }, a.ctx({ now }), ports)).find(
        (x) => x.rule === 'devicesOffline',
      );
    // 60 s and exactly 90 s after: still online, nothing raised.
    for (const s of [60, 90]) {
      const r = await watchQuietDevices(a.org.id, deps, { now: new Date(hb.getTime() + s * 1000) });
      expect(r.quiet).toBe(0);
    }
    await evaluateOrgNow(a.org.id, deps, { now: new Date(hb.getTime() + 90_000), full: false });
    expect((await offlineAlert(new Date(hb.getTime() + 90_000)))?.state ?? 'none').not.toBe('open');
    // Just past the line: the transition is recorded at the line and the alert opens at once.
    const past = new Date(hb.getTime() + DEVICE_ONLINE_WINDOW_MS + 500);
    const r = await watchQuietDevices(a.org.id, deps, { now: past });
    expect(r.quiet).toBe(1);
    expect(r.changes.some((c) => c.rule === 'devicesOffline' && c.eventId === eventId)).toBe(true);
    const alert = await offlineAlert(past);
    expect(alert).toMatchObject({ state: 'open', severity: 'critical', count: 1 });
    expect((alert?.openedAt.getTime() ?? 0) - hb.getTime()).toBeLessThanOrEqual(
      DEVICE_ONLINE_WINDOW_MS + 1_000,
    );
    const feed = await load(liveFeedWidget(null), owner(past), { kind: 'device' });
    expect(feed.items[0]).toMatchObject({
      reason: 'offline',
      at: new Date(hb.getTime() + DEVICE_ONLINE_WINDOW_MS).toISOString(),
    });
    // The device board hears it over `event.devices` (ids and state only).
    const [msg] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ data: Record<string, unknown> }>(sql`
        select data from platform.realtime_messages
        where channel = ${`org:${a.org.id}:event:${eventId}:devices`} and data->>'state' = 'offline'
        order by seq desc limit 1`),
    );
    expect(Object.keys(msg?.data ?? {}).sort()).toEqual([
      'at',
      'batteryPct',
      'deviceId',
      'queueDepth',
      'state',
    ]);
    // Idempotent: a second look records nothing more.
    expect((await watchQuietDevices(a.org.id, deps, { now: new Date(past.getTime() + 1_000) })).quiet).toBe(
      0,
    );
    // Back online: an "online" transition; the alert resolves at the next evaluation.
    const back = new Date(past.getTime() + 5_000);
    await executeCommand(
      heartbeatCommand,
      { batteryPct: 70, queueDepth: 0, clockOffsetMs: 0 },
      deviceCtx(deviceId, back),
      ports,
    );
    await evaluateOrgNow(a.org.id, deps, { now: back, full: false });
    expect(await offlineAlert(back)).toBeUndefined();
    const again = await load(liveFeedWidget(null), owner(back), { kind: 'device' });
    expect(again.items.slice(0, 2).map((i) => i.reason)).toEqual(['online', 'offline']);
  });
});

describe('live-critical escalation', () => {
  it('texts on-duty staff at once (no quiet hours), and again when an acknowledgement times out', async () => {
    const e = await liveEvent(a, 'Escalation night');
    await executeCommand(
      setMyAlertPhoneCommand,
      { smsPhone: '+1 555 010 0222' },
      userCtx(manager, a.org.id),
      ports,
    );
    await executeCommand(setMyAlertPhoneCommand, { smsPhone: '+1 555 010 0223' }, a.ctx(), ports);
    // The manager is at this event's doors; the owner isn't.
    await executeCommand(
      reportPresenceCommand,
      { eventId: e, checkpointId: null },
      userCtx(manager, a.org.id, { now: at(20 * MIN) }),
      ports,
    );
    const d = await executeCommand(enrollDeviceCommand, { label: 'Door 9' }, a.ctx(), ports);
    await executeCommand(
      heartbeatCommand,
      { batteryPct: 80, queueDepth: 0, clockOffsetMs: 0 },
      deviceCtx(d.deviceId, at(19 * MIN)),
      ports,
    );
    const when = at(20 * MIN + 30_000);
    const r = await watchQuietDevices(a.org.id, deps, { now: when });
    expect(r.quiet).toBeGreaterThanOrEqual(1);
    const [alert] = (await executeQuery(listAlertsQuery, { eventId: e }, a.ctx({ now: when }), ports)).filter(
      (x) => x.rule === 'devicesOffline',
    );
    expect(alert).toMatchObject({ severity: 'critical', state: 'open' });
    const texts = async () =>
      withTenant(systemCtx(a.org.id), (tx) =>
        tx.execute<{ kind: string; user_id: string; dedupe_key: string }>(sql`
          select kind, recipient_user_id as user_id, dedupe_key from notifications.messages
          where channel = 'sms' and dedupe_key like ${`alert:${alert?.id}:%`} order by dedupe_key`),
      );
    const who = (id: string) => (id === manager ? 'manager' : id === a.ownerId ? 'owner' : 'other');
    expect((await texts()).map((t) => `${who(t.user_id)}:${t.kind}`).sort()).toEqual([
      'manager:alerts.alert-urgent-text',
      'owner:alerts.alert-text',
    ]);
    // The on-duty manager also hears it in the app and by push, whatever the routing says.
    const inbox = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ user_id: string }>(sql`
        select user_id from notifications.inbox_items where dedupe_key like ${`alert:${alert?.id}:%`}`),
    );
    expect(inbox.map((i) => who(i.user_id))).toContain('manager');

    // Acknowledged, still offline: after 10 minutes (live-critical) it opens and is sent again.
    await executeCommand(
      acknowledgeAlertCommand,
      { alertId: alert?.id as string },
      userCtx(manager, a.org.id, { now: when }),
      ports,
    );
    await executeCommand(
      reportPresenceCommand,
      { eventId: e, checkpointId: null },
      userCtx(manager, a.org.id, { now: at(29 * MIN) }),
      ports,
    );
    await evaluateOrgNow(a.org.id, deps, { now: at(29 * MIN), full: false });
    expect((await texts()).filter((t) => t.kind === 'alerts.alert-urgent-text')).toHaveLength(1);
    await evaluateOrgNow(a.org.id, deps, { now: at(30 * MIN + 31_000), full: false });
    const after = await texts();
    expect(after.filter((t) => t.kind === 'alerts.alert-urgent-text')).toHaveLength(2);
    // The manager left the doors (presence lapsed): the next re-send is an ordinary text.
    await executeCommand(
      acknowledgeAlertCommand,
      { alertId: alert?.id as string },
      userCtx(manager, a.org.id, { now: at(31 * MIN) }),
      ports,
    );
    await evaluateOrgNow(a.org.id, deps, { now: at(41 * MIN + 1_000), full: false });
    const third = await texts();
    expect(third.filter((t) => t.kind === 'alerts.alert-urgent-text')).toHaveLength(2);
    expect(third.filter((t) => t.kind === 'alerts.alert-text' && who(t.user_id) === 'manager')).toHaveLength(
      1,
    );
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(sql`update checkin.devices set revoked_at = now() where id = ${d.deviceId}::uuid`),
    );
  });
});

describe('TV mode display links', () => {
  it('opens the board with the token alone, read-only, and stops at revocation', async () => {
    const link = await executeCommand(
      createDisplayLinkCommand,
      { eventId, label: 'Main hall screen' },
      a.ctx(),
      ports,
    );
    expect(link.token).toMatch(/^yytv_[A-Za-z0-9_-]{43}$/);
    // Only the hash is stored; the audit row never holds the token.
    const stored = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ token_hash: string }>(
        sql`select token_hash from command_center.display_links where id = ${link.id}::uuid`,
      ),
    );
    expect(stored[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    const audit = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ data: unknown }>(
        sql`select data from platform.audit_events where action = 'commandCenter.display.create' and data->>'linkId' = ${link.id}`,
      ),
    );
    expect(JSON.stringify(audit)).not.toContain(link.token);

    const opened = await resolveDisplayLink(link.token);
    expect(opened).toMatchObject({ eventId, linkId: link.id });
    expect(opened?.ctx.orgId).toBe(a.org.id);
    const board = await executeQuery(
      tvBoardQuery,
      { eventId },
      { ...(opened?.ctx as Ctx), now: at(0) },
      ports,
    );
    expect(board).toMatchObject({
      eventName: 'Live mode night',
      mode: 'live',
      checkins: { total: 6, valid: 10 },
      capacity: { inside: 6, capacity: 20 },
      devices: { total: 1 },
    });
    // No money and no people on a public screen.
    const text = JSON.stringify(board);
    for (const leak of ['Livia', 'Minor', 'currency', 'holder', 'email', '@'])
      expect(text.toLowerCase()).not.toContain(leak.toLowerCase());
    // Scope: the link opens its own event only, never another.
    const other = await liveEvent(a, 'Other night');
    await expect(
      executeQuery(tvBoardQuery, { eventId: other }, opened?.ctx as Ctx, ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    // A member (not a display) can't read the TV board query either.
    await expect(executeQuery(tvBoardQuery, { eventId }, a.ctx(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    // Malformed and unknown tokens open nothing.
    expect(await resolveDisplayLink('yytv_nope')).toBeNull();
    expect(await resolveDisplayLink(`yytv_${'A'.repeat(43)}`)).toBeNull();

    // Revoked: the token stops resolving, and an old context stops reading.
    const viewer = userCtx(a.viewerId, a.org.id);
    await expect(
      executeCommand(revokeDisplayLinkCommand, { eventId, linkId: link.id }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(createDisplayLinkCommand, { eventId, label: 'Nope' }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(
      await executeCommand(revokeDisplayLinkCommand, { eventId, linkId: link.id }, a.ctx(), ports),
    ).toEqual({
      revoked: true,
    });
    expect(
      await executeCommand(revokeDisplayLinkCommand, { eventId, linkId: link.id }, a.ctx(), ports),
    ).toEqual({
      revoked: false,
    });
    expect(await resolveDisplayLink(link.token)).toBeNull();
    await expect(executeQuery(tvBoardQuery, { eventId }, opened?.ctx as Ctx, ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    // The viewer sees the list read-only, revoked last.
    const list = await executeQuery(displayLinksQuery, { eventId }, viewer, ports);
    expect(list.find((l) => l.id === link.id)?.revokedAt).toBeInstanceOf(Date);
    await expect(
      executeCommand(createDisplayLinkCommand, { eventId, label: '' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('isolation', () => {
  it('keeps another org’s live mode, presence, device transitions and display links apart', async () => {
    // Another org's owner reads nothing of this event.
    for (const w of [
      liveFeedWidget(null),
      checkinSpeedWidget,
      scanIssuesWidget,
      capacityWidget,
      staffPresenceWidget(null),
    ] as WidgetDef<unknown>[])
      await expect(load(w, b.ctx())).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(reportPresenceCommand, { eventId, checkpointId: null }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(createDisplayLinkCommand, { eventId, label: 'Theirs' }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    const links = await executeQuery(displayLinksQuery, { eventId: b.event.id }, b.ctx(), ports);
    const theirLink = await executeCommand(
      createDisplayLinkCommand,
      { eventId: b.event.id, label: 'B' },
      b.ctx(),
      ports,
    );
    await expect(
      executeCommand(revokeDisplayLinkCommand, { eventId, linkId: theirLink.id }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(links.every((l) => l.label !== 'Main hall screen')).toBe(true);
    // B's display context reading A's event: not found (RLS scopes the org).
    const theirs = await resolveDisplayLink(theirLink.token);
    await expect(executeQuery(tvBoardQuery, { eventId }, theirs?.ctx as Ctx, ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    // Under B's RLS none of A's rows are visible.
    const counts = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ n: number }>(sql`
        select (select count(*) from checkin.device_events where event_id = ${eventId}::uuid)
          + (select count(*) from checkin.staff_presence where event_id = ${eventId}::uuid)
          + (select count(*) from command_center.display_links where event_id = ${eventId}::uuid) as n`),
    );
    expect(Number(counts[0]?.n)).toBe(0);
    // A device of org B can't sync into A's event.
    const bd = await executeCommand(enrollDeviceCommand, { label: 'B door' }, b.ctx(), ports);
    await expect(
      executeCommand(
        syncScansCommand,
        {
          eventId,
          scans: [
            {
              scanId: uuidv7(),
              code: codes[9] as string,
              deviceTs: new Date(),
              clockOffsetMs: 0,
              verdict: 'admit',
            },
          ],
        },
        deviceCtx(bd.deviceId, at(0), b),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
