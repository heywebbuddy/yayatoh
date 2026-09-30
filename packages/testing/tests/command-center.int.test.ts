import { deviceContext, enrollDeviceCommand, heartbeatCommand, scanTicketCommand } from '@yayatoh/checkin';
import {
  AlertsWidgetDto,
  alertsSlotWidget,
  COMMAND_CENTER_WIDGETS,
  checkinsWidget,
  DEVICE_BOARD_EVENTS,
  defineWidget,
  deviceBoardPublisher,
  deviceBoardWidget,
  devicesWidget,
  entrancesWidget,
  eventViewQuery,
  orgOverviewQuery,
  publishMetricsChangedTx,
  readinessWidget,
  resetWidgetLayoutCommand,
  salesWidget,
  saveWidgetLayoutCommand,
  seatFillWidget,
  setModeOverrideCommand,
  ticketsWidget,
  timelineWidget,
  WIDGET_META,
  type WidgetDef,
  withWidget,
} from '@yayatoh/command-center';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { updateEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { catchUpSubscriber, consumeEvent, type PublishedEvent } from '@yayatoh/platform';
import { catchUpMetrics, eventMetricsQuery } from '@yayatoh/reports';
import { addMemberCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';
import { buy, newEvent, publish, ticketsOf, typeOf } from './metrics-helpers.ts';

/**
 * M3.2a Command Center shell: role layouts, the widget registry's server-side refusal (the door
 * never gets revenue, even asking directly), per-member layouts, the audited manual mode, the
 * org overview, tenant isolation and the realtime channels' scoping.
 */

let a: OrgFixture;
let b: OrgFixture;
const members: Record<string, string> = {};
const as = (role: string, extra: Parameters<typeof userCtx>[2] = {}) =>
  userCtx(members[role] as string, a.org.id, extra);
const load = <O>(w: WidgetDef<O>, eventId: string, ctx = a.ctx()) =>
  executeQuery(w.loader, { eventId }, ctx, ports);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  for (const role of ['finance', 'marketing', 'manager', 'scanner', 'viewer'] as const) {
    members[role] = uuidv7();
    await executeCommand(addMemberCommand, { userId: members[role], role }, a.ctx(), ports);
  }
});

afterAll(async () => {
  await closePools();
});

describe('role layouts', () => {
  it('shows the owner the full layout for the mode, and the door no revenue', async () => {
    const owner = await executeQuery(eventViewQuery, { eventId: a.event.id }, a.ctx(), ports);
    expect(owner.role).toBe('owner');
    expect(owner.canOverride).toBe(true);
    // The fixture forced pre-show; the fixture event (Oct 2027) is otherwise in planning.
    expect(owner.mode).toMatchObject({ mode: 'pre_show', override: 'pre_show', computed: 'planning' });
    // The fixture owner saved [sales, readiness] and hid the timeline.
    expect(owner.customized).toBe(true);
    expect(owner.layout.slice(0, 2).map((s) => s.key)).toEqual(['sales', 'readiness']);
    expect(owner.layout.find((s) => s.key === 'timeline')?.hidden).toBe(true);

    // The fixture viewer is door staff on this event: the door layout, no revenue anywhere.
    const door = await executeQuery(
      eventViewQuery,
      { eventId: a.event.id },
      userCtx(a.viewerId, a.org.id),
      ports,
    );
    expect(door.role).toBe('door');
    expect(door.canOverride).toBe(false);
    expect(door.layout.map((s) => s.key)).not.toContain('sales');
    expect(door.layout.filter((s) => !s.hidden).map((s) => s.key)).toEqual([
      'devices',
      'checkins',
      'alerts',
      // Batch 3d merge: M3.4a's device board on the door's pre-show layout.
      'deviceBoard',
      'timeline',
    ]);
    expect(door.customized).toBe(false);
  });

  it('gives finance, marketing and ops their own layouts', async () => {
    const view = async (role: string) =>
      (await executeQuery(eventViewQuery, { eventId: a.event.id }, as(role), ports)).layout
        .filter((s) => !s.hidden)
        .map((s) => s.key);
    expect(await view('finance')).toEqual(['sales', 'tickets', 'alerts', 'timeline']);
    expect(await view('marketing')).toEqual(['tickets', 'readiness', 'alerts', 'timeline']);
    expect(await view('manager')).toEqual([
      'readiness',
      'alerts',
      'devices',
      'tickets',
      'deviceBoard',
      'timeline',
    ]);
    // A member without event access (a scanner) has no Command Center.
    await expect(
      executeQuery(eventViewQuery, { eventId: a.event.id }, as('scanner'), ports),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('widget loaders refuse what the registry does not allow', () => {
  it('refuses the revenue loader for the door role even when asked directly', async () => {
    const door = userCtx(a.viewerId, a.org.id);
    // The viewer's org role has orders:read: the refusal is the registry's, not the permission's.
    await expect(load(salesWidget, a.event.id, door)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(load(checkinsWidget, a.event.id, door)).resolves.toMatchObject({
      total: expect.any(Number),
    });
    await expect(load(devicesWidget, a.event.id, door)).resolves.toMatchObject({
      online: expect.any(Number),
    });
    // Registered widgets for other roles are refused too.
    await expect(load(readinessWidget, a.event.id, door)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('serves M3.4a staff views to the door and refuses them to finance (batch 3d merge)', async () => {
    const door = userCtx(a.viewerId, a.org.id);
    const board = await load(deviceBoardWidget, a.event.id, door);
    // The fixture's enrolled device reported at this event (M3.4a heartbeat fixture).
    expect(board.devices.length).toBeGreaterThan(0);
    expect(Object.keys(board.devices[0] ?? {}).sort()).toEqual(
      // M3.3a adds the app version and the last scan.
      [
        'appVersion',
        'batteryPct',
        'checkpoint',
        'id',
        'kiosk',
        'label',
        'lastScanAt',
        'lastSeenAt',
        'online',
        'queueDepth',
      ].sort(),
    );
    const entrances = await load(entrancesWidget, a.event.id, door);
    expect(entrances.checkedIn).toBeGreaterThanOrEqual(0);
    expect(entrances.timeZone).toBe(a.event.timezone);
    await expect(load(deviceBoardWidget, a.event.id, as('finance'))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(load(entrancesWidget, a.event.id, as('marketing'))).rejects.toMatchObject({
      code: 'forbidden',
    });
    // Another org's event is not found under this org's RLS.
    await expect(load(deviceBoardWidget, b.event.id, door)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('checks roles and permissions for every widget', async () => {
    await expect(load(salesWidget, a.event.id, as('finance'))).resolves.toBeTruthy();
    await expect(load(checkinsWidget, a.event.id, as('finance'))).rejects.toMatchObject({
      code: 'forbidden',
    });
    // Marketing: no orders:read (the pipeline refuses before the registry is asked).
    await expect(load(salesWidget, a.event.id, as('marketing'))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(load(ticketsWidget, a.event.id, as('marketing'))).resolves.toBeTruthy();
    await expect(load(ticketsWidget, a.event.id, as('scanner'))).rejects.toMatchObject({ code: 'forbidden' });
    // A profile without seating (a concert) has no seat fill.
    const concert = await newEvent(a, 'Concert CC');
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(sql`update events.events set profile = 'concert' where id = ${concert}`),
    );
    await expect(load(seatFillWidget, concert)).rejects.toMatchObject({ code: 'forbidden' });
    const gala = await newEvent(a, 'Gala CC');
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(sql`update events.events set profile = 'gala' where id = ${gala}`),
    );
    await expect(load(seatFillWidget, gala)).resolves.toMatchObject({ occupied: 0, total: 0 });
    // The fixture event's profile ('other') has no seating either.
    await expect(load(seatFillWidget, a.event.id)).rejects.toMatchObject({ code: 'forbidden' });
    // API keys and anonymous callers never have a Command Center.
    await expect(load(ticketsWidget, a.event.id, createCtx({ orgId: a.org.id }))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('returns allowlisted numbers equal to the metric projection', async () => {
    const eventId = await newEvent(a, 'Numbers CC');
    const ga = await typeOf(a, eventId, 'GA', 2500, 50);
    await publish(a, eventId);
    const order = await buy(a, eventId, [{ ticketTypeId: ga, quantity: 3 }], 'Numbers', { pay: 'succeed' });
    await catchUpMetrics(a.org.id);
    const metrics = await executeQuery(
      eventMetricsQuery,
      { eventId, keys: ['sales.gross', 'tickets.sold', 'tickets.capacity'] },
      a.ctx(),
      ports,
    );
    const m = (k: string) => metrics.metrics.find((x) => x.key === k)?.value;
    const sales = await load(salesWidget, eventId);
    expect(sales.lines).toEqual([{ currency: 'USD', total: m('sales.gross'), today: 7500, refunds: 0 }]);
    expect(sales.lines[0]?.total).toBe(7500);
    expect(sales.orders).toBe(1);
    expect(Object.keys(sales).sort()).toEqual(['asOf', 'lines', 'orders']);
    const tickets = await load(ticketsWidget, eventId);
    expect(tickets).toMatchObject({ sold: 3, capacity: 50, comp: 0 });
    expect(tickets.capacity).toBe(m('tickets.capacity'));

    // Check-ins follow a scan (door staff scan the fixture event; the owner scans this one).
    const [ticket] = await ticketsOf(a, order.id);
    const before = await load(checkinsWidget, eventId);
    expect(before).toMatchObject({ today: 0, total: 0, valid: 3 });
    const live = { now: new Date('2028-06-01T23:30:00Z') };
    await executeCommand(
      scanTicketCommand,
      { eventId, code: ticket?.short_code as string },
      a.ctx(live),
      ports,
    );
    const after = await executeQuery(checkinsWidget.loader, { eventId }, a.ctx(live), ports);
    expect(after).toMatchObject({ today: 1, total: 1, valid: 3 });
  });

  it('scores readiness with the blocking items and their fix links', async () => {
    const eventId = await newEvent(a, 'Readiness CC');
    const r = await load(readinessWidget, eventId);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(100);
    expect(r.blocking.map((x) => x.key)).toEqual(
      expect.arrayContaining(['venueSet', 'ticketsCreated', 'published']),
    );
    expect(r.blocking.find((x) => x.key === 'ticketsCreated')?.path).toBe('tickets-orders');
    expect(r.blocking.find((x) => x.key === 'published')?.path).toBe('');
    await typeOf(a, eventId, 'GA', 1000);
    const after = await load(readinessWidget, eventId);
    expect(after.score).toBeGreaterThan(r.score);
    expect(after.blocking.map((x) => x.key)).not.toContain('ticketsCreated');
  });

  it('lists the upcoming timeline in the event time zone', async () => {
    const t = await load(timelineWidget, a.event.id, a.ctx({ now: new Date('2027-10-01T00:00:00Z') }));
    expect(t.timeZone).toBe('America/Chicago');
    expect(t.items.map((i) => i.kind).slice(0, 3)).toEqual(['preShow', 'live', 'start']);
    // Pre-show: the same Chicago wall-clock time the day before the start.
    expect(t.items[0]?.at).toBe('2027-10-13T14:00:00.000Z');
  });

  it('keeps an alerts slot the alert engine can fill (registry hook)', async () => {
    await expect(load(alertsSlotWidget, a.event.id)).resolves.toEqual({ engine: 'pending', alerts: [] });
    const alert = {
      id: uuidv7(),
      rule: 'unseated',
      severity: 'warning' as const,
      state: 'open' as const,
      count: 37,
      href: null,
      at: new Date().toISOString(),
    };
    const engine = defineWidget(WIDGET_META.alerts, AlertsWidgetDto, async () => ({
      engine: 'ready' as const,
      alerts: [alert],
    }));
    const registry = withWidget(COMMAND_CENTER_WIDGETS, engine);
    expect(registry.alerts).toBe(engine);
    expect(registry.sales).toBe(COMMAND_CENTER_WIDGETS.sales);
    await expect(load(engine, a.event.id)).resolves.toEqual({ engine: 'ready', alerts: [alert] });
    // The engine's loader applies the same rule: a scanner has no Command Center.
    await expect(load(engine, a.event.id, as('scanner'))).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('layouts per member per event', () => {
  it('saves, applies and resets a member’s own arrangement', async () => {
    const eventId = await newEvent(a, 'Layout CC');
    const mgr = as('manager');
    await executeCommand(
      saveWidgetLayoutCommand,
      { eventId, order: ['timeline', 'tickets'], hidden: ['readiness'] },
      mgr,
      ports,
    );
    const v = await executeQuery(eventViewQuery, { eventId }, mgr, ports);
    expect(v.customized).toBe(true);
    expect(v.layout.slice(0, 2).map((s) => s.key)).toEqual(['timeline', 'tickets']);
    expect(v.layout.find((s) => s.key === 'readiness')?.hidden).toBe(true);
    // Nobody else's layout changes.
    const other = await executeQuery(eventViewQuery, { eventId }, a.ctx(), ports);
    expect(other.customized).toBe(false);
    expect(other.layout[0]?.key).toBe('readiness');
    await expect(executeCommand(resetWidgetLayoutCommand, { eventId }, mgr, ports)).resolves.toEqual({
      reset: true,
    });
    expect((await executeQuery(eventViewQuery, { eventId }, mgr, ports)).customized).toBe(false);
  });

  it('refuses forbidden, unknown and repeated widgets', async () => {
    const door = userCtx(a.viewerId, a.org.id);
    await expect(
      executeCommand(
        saveWidgetLayoutCommand,
        { eventId: a.event.id, order: ['sales'], hidden: [] },
        door,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        saveWidgetLayoutCommand,
        { eventId: a.event.id, order: [], hidden: ['sales'] },
        door,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        saveWidgetLayoutCommand,
        { eventId: a.event.id, order: ['bogus'], hidden: [] },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(
        saveWidgetLayoutCommand,
        { eventId: a.event.id, order: ['tickets', 'tickets'], hidden: [] },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(
        saveWidgetLayoutCommand,
        { eventId: a.event.id, order: ['checkins'], hidden: [] },
        door,
        ports,
      ),
    ).resolves.toEqual({ order: ['checkins'], hidden: [] });
  });
});

describe('manual mode', () => {
  it('lets owners and event managers override the mode, audited; others are refused', async () => {
    const eventId = await newEvent(a, 'Mode CC');
    const r = await executeCommand(setModeOverrideCommand, { eventId, mode: 'live' }, a.ctx(), ports);
    expect(r).toEqual({ mode: 'live', computed: 'planning', override: 'live' });
    const v = await executeQuery(eventViewQuery, { eventId }, a.ctx(), ports);
    expect(v.mode).toMatchObject({ mode: 'live', computed: 'planning', override: 'live' });
    expect(v.layout.filter((s) => !s.hidden)[0]?.key).toBe('checkins');
    const [audit] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ action: string; data: { mode: string; computed: string } }>(
        sql`select action, data from platform.audit_events where target_id = ${eventId} and action like 'commandCenter.mode%' order by created_at desc limit 1`,
      ),
    );
    expect(audit).toMatchObject({
      action: 'commandCenter.mode.override',
      data: { mode: 'live', computed: 'planning' },
    });
    for (const who of [userCtx(a.viewerId, a.org.id), as('finance'), as('marketing'), as('viewer')])
      await expect(
        executeCommand(setModeOverrideCommand, { eventId, mode: 'wrap' }, who, ports),
      ).rejects.toMatchObject({ code: 'forbidden' });
    await executeCommand(setModeOverrideCommand, { eventId, mode: 'wrap' }, as('manager'), ports);
    expect((await executeQuery(eventViewQuery, { eventId }, a.ctx(), ports)).mode.mode).toBe('wrap');
    await expect(
      executeCommand(setModeOverrideCommand, { eventId, mode: null }, a.ctx(), ports),
    ).resolves.toEqual({
      mode: 'planning',
      computed: 'planning',
      override: null,
    });
  });

  it('computes the mode from the clock when there is no override', async () => {
    const eventId = await newEvent(a, 'Clock CC');
    const at = (iso: string) =>
      executeQuery(eventViewQuery, { eventId }, a.ctx({ now: new Date(iso) }), ports);
    // Starts 2028-06-01 18:00 Chicago (23:00Z), ends 22:00 (03:00Z).
    expect((await at('2028-05-31T22:59:00Z')).mode.mode).toBe('planning');
    expect((await at('2028-05-31T23:00:00Z')).mode.mode).toBe('pre_show');
    expect((await at('2028-06-01T21:00:00Z')).mode.mode).toBe('live');
    expect((await at('2028-06-02T05:00:00Z')).mode.mode).toBe('wrap');
    // Rescheduling moves the boundaries with it.
    await executeCommand(
      updateEventCommand,
      { eventId, startsAt: '2028-07-01T23:00:00Z', endsAt: '2028-07-02T03:00:00Z' },
      a.ctx(),
      ports,
    );
    expect((await at('2028-06-01T21:00:00Z')).mode.mode).toBe('planning');
  });
});

describe('org overview', () => {
  it('lists current events, live first, with readiness for roles that see it and no money', async () => {
    const liveEvent = await newEvent(a, 'Overview live CC');
    await executeCommand(setModeOverrideCommand, { eventId: liveEvent, mode: 'live' }, a.ctx(), ports);
    const o = await executeQuery(
      orgOverviewQuery,
      {},
      a.ctx({ now: new Date('2028-05-01T00:00:00Z') }),
      ports,
    );
    expect(o.role).toBe('owner');
    expect(o.events[0]).toMatchObject({
      eventId: liveEvent,
      mode: 'live',
      overridden: true,
      readiness: null,
    });
    const planning = o.events.find((e) => e.mode === 'planning');
    expect(planning?.readiness).toEqual(expect.any(Number));
    expect(JSON.stringify(o)).not.toMatch(/sales|gross|revenue|Minor/);
    // Finance sees no readiness; other orgs' events never appear.
    const fin = await executeQuery(
      orgOverviewQuery,
      {},
      as('finance', { now: new Date('2028-05-01T00:00:00Z') }),
      ports,
    );
    expect(fin.role).toBe('finance');
    expect(fin.events.every((e) => e.readiness === null)).toBe(true);
    const other = await executeQuery(orgOverviewQuery, {}, b.ctx(), ports);
    expect(other.events.map((e) => e.eventId)).not.toContain(liveEvent);
  });
});

describe('isolation', () => {
  it('never reaches another org’s event, layouts or overrides', async () => {
    await expect(executeQuery(eventViewQuery, { eventId: a.event.id }, b.ctx(), ports)).rejects.toMatchObject(
      {
        code: 'not_found',
      },
    );
    for (const w of Object.values(COMMAND_CENTER_WIDGETS))
      await expect(load(w, a.event.id, b.ctx())).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(saveWidgetLayoutCommand, { eventId: a.event.id, order: [], hidden: [] }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(setModeOverrideCommand, { eventId: a.event.id, mode: 'live' }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    const rows = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ n: number }>(sql`
        select (select count(*) from command_center.layouts where event_id = ${a.event.id})::int
             + (select count(*) from command_center.mode_overrides where event_id = ${a.event.id})::int as n`),
    );
    expect(rows[0]?.n).toBe(0);
    // A's owner in B's org context is not a member there.
    await expect(
      executeQuery(eventViewQuery, { eventId: b.event.id }, userCtx(a.ownerId, b.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('realtime channel scoping', () => {
  const messages = (orgId: string, channelLike: string) =>
    withTenant(systemCtx(orgId), (tx) =>
      tx.execute<{ channel: string; event: string; data: Record<string, unknown> }>(
        sql`select channel, event, data from platform.realtime_messages where channel like ${channelLike} order by seq`,
      ),
    );

  it('pings the event’s own metrics channel with no figures', async () => {
    const at = new Date();
    await withTenant(systemCtx(a.org.id), (tx) => publishMetricsChangedTx(tx, a.org.id, a.event.id, at));
    const rows = await messages(a.org.id, `org:${a.org.id}:event:${a.event.id}:metrics`);
    expect(rows.at(-1)).toMatchObject({ event: 'metric', data: { metric: 'changed', value: 0 } });
    expect(await messages(b.org.id, `%${a.event.id}%`)).toHaveLength(0);
    // Another org's channel can't be written from this org's transaction.
    await expect(
      withTenant(systemCtx(b.org.id), (tx) => publishMetricsChangedTx(tx, a.org.id, a.event.id, at)),
    ).rejects.toThrow();
  });

  it('publishes device presence to the org’s events in pre-show or live only', async () => {
    const liveEvent = await newEvent(a, 'Devices live CC');
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(
        sql`update events.events set starts_at = now() - interval '1 hour', ends_at = now() + interval '2 hours' where id = ${liveEvent}`,
      ),
    );
    const planningEvent = await newEvent(a, 'Devices later CC');
    const { deviceId, token } = await executeCommand(
      enrollDeviceCommand,
      { label: `Door ${uuidv7().slice(-4)}` },
      a.ctx(),
      ports,
    );
    const device = await deviceContext(token);
    if (!device) throw new Error('device token did not resolve');
    await executeCommand(
      heartbeatCommand,
      { batteryPct: 15, queueDepth: 2, clockOffsetMs: 0 },
      device.ctx,
      ports,
    );
    await catchUpSubscriber(deviceBoardPublisher(), a.org.id);
    const live = await messages(a.org.id, `org:${a.org.id}:event:${liveEvent}:devices`);
    expect(
      live.some((m) => m.data.deviceId === deviceId && m.data.state === 'online' && m.data.batteryPct === 15),
    ).toBe(true);
    expect(Object.keys(live.at(-1)?.data ?? {}).sort()).toEqual([
      'at',
      'batteryPct',
      'deviceId',
      'queueDepth',
      'state',
    ]);
    expect(await messages(a.org.id, `%${planningEvent}:devices`)).toHaveLength(0);
    expect(await messages(b.org.id, `%${deviceId}%`)).toHaveLength(0);
    expect(DEVICE_BOARD_EVENTS).toContain('device.heartbeat@1');
    // The device widget counts it (online, low battery).
    const w = await load(devicesWidget, liveEvent);
    expect(w.online).toBeGreaterThanOrEqual(1);
    expect(w.lowBattery).toBeGreaterThanOrEqual(1);
    // A malformed payload is ignored.
    const bogus = {
      id: uuidv7(),
      orgId: a.org.id,
      type: 'device.heartbeat',
      version: 1,
      aggregateType: 'device',
      aggregateId: uuidv7(),
      payload: {},
      logSeq: 0,
    } as PublishedEvent;
    await expect(consumeEvent(deviceBoardPublisher(), bogus)).resolves.toBeDefined();
  });
});
