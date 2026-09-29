import { createECDH, randomBytes } from 'node:crypto';
import { evaluateEventAlertsTx, listAlertsQuery } from '@yayatoh/alerts';
import {
  addNoteCommand,
  assignCommand,
  assigneesQuery,
  assistanceTicketToken,
  guestRequestCommand,
  guestStatusQuery,
  queueQuery,
  staffRequestCommand,
  updateCommand,
} from '@yayatoh/assistance';
import {
  createCheckpointCommand,
  deviceContext,
  enrollDeviceCommand,
  heartbeatCommand,
  subscribeStaffPushCommand,
} from '@yayatoh/checkin';
import { assistanceWidget } from '@yayatoh/command-center';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { assignEventRoleCommand, createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { createNotifier } from '@yayatoh/notifications';
import { orderByManageToken, startCheckoutCommand } from '@yayatoh/orders';
import { postgresRateLimitStore, signLinkToken } from '@yayatoh/platform';
import { createRateLimiter, RATE_LIMIT_POLICIES } from '@yayatoh/platform/security';
import { addMemberCommand } from '@yayatoh/tenancy';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * Guest assistance (M3.3b): guest requests with a ticket's signed help link for that event only,
 * staff requests from a Scan PWA device, the queue's lifecycle and permissions, SLA escalation
 * into the alert engine, web push to on-duty staff devices, privacy of what travels, isolation.
 */
let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let otherEventId: string;
let tickets: string[];
let otherTickets: string[];
let bTickets: string[];
let north: string;
let otherCp: string;
let viewerId: string;
let managerId: string;
let scannerId: string;
let financeId: string;
let doorStaffId: string;

const DOORS = new Date('2027-12-01T20:00:00Z');
const at = (sec: number) => new Date(DOORS.getTime() + sec * 1000);
const guestCtx = (orgId: string, now = DOORS): Ctx => createCtx({ orgId, now });
const as = (userId: string, now = DOORS) => userCtx(userId, a.org.id, { now });

async function setup(f: OrgFixture, name: string, quantity: number) {
  const e = await executeCommand(
    createEventCommand,
    { name, timezone: 'America/Chicago', startsAt: '2027-12-01T15:00:00Z', endsAt: '2027-12-02T04:00:00Z' },
    f.ctx(),
    ports,
  );
  const tt = await executeCommand(
    createTicketTypeCommand,
    { eventId: e.id, name: 'GA', priceMinor: 0, quantityTotal: quantity, maxPerOrder: 20 },
    f.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, f.ctx(), ports);
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId: e.id,
      items: [{ ticketTypeId: tt.id, quantity }],
      buyer: { email: `help-${uuidv7().slice(-6)}@example.test`, name: 'Hana Guest' },
    },
    createCtx({ orgId: f.org.id }),
    ports,
  );
  const ids = ((await orderByManageToken(r.manageToken))?.tickets ?? []).map((t) => t.id);
  return { eventId: e.id, tickets: ids };
}

async function member(role: string) {
  const id = uuidv7();
  await executeCommand(addMemberCommand, { userId: id, role }, a.ctx(), ports);
  return id;
}

async function device(label: string, checkpointId: string | null = north) {
  const { token } = await executeCommand(enrollDeviceCommand, { label }, a.ctx(), ports);
  const dc = await deviceContext(token);
  if (!dc) throw new Error('device did not resolve');
  const ctx = (now = DOORS): Ctx => ({ ...dc.ctx, now });
  await executeCommand(
    heartbeatCommand,
    { batteryPct: 80, queueDepth: 0, clockOffsetMs: 0, eventId, checkpointId },
    ctx(),
    ports,
  );
  return { ctx, id: dc.ctx.actor.type === 'system' ? dc.ctx.actor.name.slice('device:'.length) : '' };
}

const ask = (
  ticketId: string,
  reason: 'seat' | 'accessibility' | 'medical' | 'lost_item' | 'other',
  opts: { note?: string; location?: string; now?: Date; event?: string; org?: string; token?: string } = {},
) =>
  executeCommand(
    guestRequestCommand,
    {
      eventId: opts.event ?? eventId,
      ticketToken: opts.token ?? assistanceTicketToken(ticketId),
      reason,
      note: opts.note ?? '',
      location: opts.location ?? '',
    },
    guestCtx(opts.org ?? a.org.id, opts.now),
    ports,
  );

const queue = (ctx: Ctx, status: 'open' | 'closed' = 'open', event = eventId) =>
  executeQuery(queueQuery, { eventId: event, status }, ctx, ports);

const one = async (ctx: Ctx, requestId: string) => {
  const all = [...(await queue(ctx, 'open')), ...(await queue(ctx, 'closed'))];
  const r = all.find((x) => x.id === requestId);
  if (!r) throw new Error('request not in the queue');
  return r;
};

const sqlRows = <T extends Record<string, unknown>>(orgId: string, q: ReturnType<typeof sql>) =>
  withTenant(systemCtx(orgId), (tx) => tx.execute<T>(q));

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const main = await setup(a, 'Help desk gala', 12);
  eventId = main.eventId;
  tickets = main.tickets;
  const other = await setup(a, 'Help desk matinee', 2);
  otherEventId = other.eventId;
  otherTickets = other.tickets;
  bTickets = (await setup(b, 'Bravo help', 2)).tickets;
  north = (
    await executeCommand(
      createCheckpointCommand,
      { eventId, name: 'North gate', kind: 'entrance' },
      a.ctx(),
      ports,
    )
  ).id;
  otherCp = (
    await executeCommand(
      createCheckpointCommand,
      { eventId: otherEventId, name: 'Matinee door', kind: 'entrance' },
      a.ctx(),
      ports,
    )
  ).id;
  viewerId = await member('viewer');
  managerId = await member('manager');
  scannerId = await member('scanner');
  financeId = await member('finance');
  doorStaffId = await member('viewer');
  await executeCommand(
    assignEventRoleCommand,
    { eventId, userId: doorStaffId, role: 'door_staff' },
    a.ctx(),
    ports,
  );
}, 240_000);
afterAll(closePools);

describe('guest requests need a ticket link for that event', () => {
  it('a guest asks with their ticket link: numbered, prioritised, timed, logged, published without their words', async () => {
    const r = await ask(tickets[0] as string, 'seat', {
      note: 'Someone is in my seat',
      location: 'Row C 12',
    });
    expect(r.number).toBeGreaterThanOrEqual(1);
    const row = await one(a.ctx(), r.requestId);
    expect(row).toMatchObject({
      source: 'guest',
      reason: 'seat',
      priority: 'normal',
      state: 'new',
      note: 'Someone is in my seat',
      location: 'Row C 12',
      guest: { name: 'Hana Guest' },
      assignee: null,
      overdue: false,
    });
    expect(row.dueAt.getTime() - row.createdAt.getTime()).toBe(10 * 60_000);
    expect(row.activity.map((x) => [x.kind, x.actor])).toEqual([['created', 'guest']]);

    // The guest's status link shows the state, never the note or staff.
    const status = await executeQuery(
      guestStatusQuery,
      { eventId, token: r.statusToken },
      guestCtx(a.org.id),
      ports,
    );
    expect(status).toEqual({
      number: r.number,
      reason: 'seat',
      state: 'new',
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });

    // Realtime: ids and states only; outbox: ids and states; audit: the reason, not the words.
    const [msg] = await sqlRows<{ channel: string; data: Record<string, unknown> }>(
      a.org.id,
      sql`select channel, data from platform.realtime_messages where data->>'requestId' = ${r.requestId} order by seq limit 1`,
    );
    expect(msg?.channel).toBe(`org:${a.org.id}:event:${eventId}:assistance`);
    expect(Object.keys(msg?.data ?? {}).sort()).toEqual(['at', 'priority', 'requestId', 'state']);
    const [ev] = await sqlRows<{ type: string; payload: Record<string, unknown> }>(
      a.org.id,
      sql`select type, payload from platform.domain_events where aggregate_id = ${r.requestId}`,
    );
    expect(ev?.type).toBe('assistance.requested');
    expect(JSON.stringify(ev?.payload)).not.toContain('seat');
    const audits = await sqlRows<{ data: unknown }>(
      a.org.id,
      sql`select data from platform.audit_events where target_id = ${r.requestId}`,
    );
    expect(JSON.stringify(audits)).not.toMatch(/Someone|Row C/);
  });

  it('refuses another event’s ticket, another org’s, a forged or void one, and a status link for another event', async () => {
    await expect(ask(otherTickets[0] as string, 'seat')).rejects.toMatchObject({ code: 'not_found' });
    await expect(ask(bTickets[0] as string, 'seat')).rejects.toMatchObject({ code: 'not_found' });
    // Another org's ticket link presented at that org's own… other org: RLS hides A's event.
    await expect(ask(tickets[1] as string, 'seat', { org: b.org.id })).rejects.toMatchObject({
      code: 'not_found',
    });
    const forged = `${tickets[1]}~${'A'.repeat(43)}`;
    await expect(ask(tickets[1] as string, 'seat', { token: forged })).rejects.toMatchObject({
      code: 'not_found',
    });
    // A token for another purpose (e.g. a waitlist link) is not a help link.
    const wrongPurpose = signLinkToken('orders.waitlist', tickets[1] as string);
    await expect(ask(tickets[1] as string, 'seat', { token: wrongPurpose })).rejects.toMatchObject({
      code: 'not_found',
    });
    await sqlRows(a.org.id, sql`update ticketing.tickets set status = 'void' where id = ${tickets[11]}`);
    await expect(ask(tickets[11] as string, 'seat')).rejects.toMatchObject({ code: 'not_found' });

    const r = await ask(tickets[2] as string, 'other');
    await expect(
      executeQuery(
        guestStatusQuery,
        { eventId: otherEventId, token: r.statusToken },
        guestCtx(a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeQuery(
        guestStatusQuery,
        { eventId, token: assistanceTicketToken(r.requestId) },
        guestCtx(a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    // Validation: a reason from the staff list, and text over the limits.
    await expect(ask(tickets[2] as string, 'backup' as never)).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(ask(tickets[2] as string, 'seat', { note: 'x'.repeat(501) })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(ask(tickets[2] as string, 'seat', { location: 'y'.repeat(121) })).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('a ticket has at most 3 open requests; the web limiter cuts bursts per ticket and device', async () => {
    const t = tickets[3] as string;
    for (let i = 0; i < 3; i++) await ask(t, 'lost_item');
    await expect(ask(t, 'lost_item')).rejects.toMatchObject({ code: 'conflict' });

    const rl = createRateLimiter(postgresRateLimitStore);
    const identity = `ticket-${uuidv7()}`;
    const now = Date.now();
    const { limit } = RATE_LIMIT_POLICIES.assistanceRequest.identity;
    for (let i = 0; i < limit; i++)
      expect(
        (await rl.check('assistanceRequest', { device: `dev-${uuidv7()}`, identity }, { now })).allowed,
      ).toBe(true);
    const denied = await rl.check('assistanceRequest', { device: `dev-${uuidv7()}`, identity }, { now });
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    const dev = `device-${uuidv7()}`;
    for (let i = 0; i < RATE_LIMIT_POLICIES.assistanceRequest.device.limit; i++)
      await rl.check('assistanceRequest', { device: dev, identity: `x-${i}-${uuidv7()}` }, { now });
    expect(
      (await rl.check('assistanceRequest', { device: dev, identity: `y-${uuidv7()}` }, { now })).allowed,
    ).toBe(false);
  });

  it('a draft or cancelled event takes no requests', async () => {
    const draft = await executeCommand(
      createEventCommand,
      {
        name: 'Draft help',
        timezone: 'UTC',
        startsAt: '2027-12-03T15:00:00Z',
        endsAt: '2027-12-03T18:00:00Z',
      },
      a.ctx(),
      ports,
    );
    await expect(ask(tickets[4] as string, 'seat', { event: draft.id })).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });
});

describe('priority rules and staff requests from the scanner', () => {
  it('medical is urgent (2 min), accessibility high (5 min); staff security urgent, device normal', async () => {
    const med = await ask(tickets[5] as string, 'medical', { location: 'Aisle 4' });
    const acc = await ask(tickets[5] as string, 'accessibility');
    expect(await one(a.ctx(), med.requestId)).toMatchObject({ priority: 'urgent' });
    const m = await one(a.ctx(), med.requestId);
    expect(m.dueAt.getTime() - m.createdAt.getTime()).toBe(120_000);
    const x = await one(a.ctx(), acc.requestId);
    expect(x).toMatchObject({ priority: 'high' });
    expect(x.dueAt.getTime() - x.createdAt.getTime()).toBe(300_000);
    // The most urgent first.
    const open = await queue(a.ctx());
    const ranks = open.map((r) => ({ urgent: 0, high: 1, normal: 2 })[r.priority]);
    expect(ranks).toEqual([...ranks].sort((p, q) => p - q));
  });

  it('a device raises a request tied to itself and its entrance; another event’s entrance is dropped; members can’t', async () => {
    const d = await device('Gate 1 phone');
    const r = await executeCommand(
      staffRequestCommand,
      { eventId, reason: 'security', note: 'Crowd at the gate', checkpointId: north },
      d.ctx(),
      ports,
    );
    expect(await one(a.ctx(), r.requestId)).toMatchObject({
      source: 'staff',
      reason: 'security',
      priority: 'urgent',
      device: 'Gate 1 phone',
      checkpoint: 'North gate',
      guest: null,
      activity: [{ kind: 'created', actor: 'device', actorDevice: 'Gate 1 phone' }],
    });
    const r2 = await executeCommand(
      staffRequestCommand,
      { eventId, reason: 'device', note: '', checkpointId: otherCp },
      d.ctx(),
      ports,
    );
    expect(await one(a.ctx(), r2.requestId)).toMatchObject({ checkpoint: null, priority: 'normal' });
    await expect(
      executeCommand(
        staffRequestCommand,
        { eventId, reason: 'backup', note: '', checkpointId: null },
        as(managerId),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        staffRequestCommand,
        { eventId, reason: 'seat' as never, note: '', checkpointId: null },
        d.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('the queue: lifecycle, assignment and permissions', () => {
  it('new → assigned (me) → in progress → resolved, with the activity; closed requests leave the open list', async () => {
    const r = await ask(tickets[6] as string, 'seat');
    let row = await executeCommand(
      assignCommand,
      { eventId, requestId: r.requestId, assignee: 'me' },
      as(managerId, at(30)),
      ports,
    );
    expect(row).toMatchObject({ state: 'assigned', assignee: { kind: 'user', id: managerId }, mine: true });
    row = await executeCommand(
      updateCommand,
      { eventId, requestId: r.requestId, action: 'start' },
      as(managerId, at(60)),
      ports,
    );
    expect(row.state).toBe('in_progress');
    row = await executeCommand(
      addNoteCommand,
      { eventId, requestId: r.requestId, body: 'Found a free seat' },
      as(managerId, at(90)),
      ports,
    );
    row = await executeCommand(
      updateCommand,
      { eventId, requestId: r.requestId, action: 'resolve' },
      as(managerId, at(120)),
      ports,
    );
    expect(row.state).toBe('resolved');
    expect(row.closedAt).not.toBeNull();
    expect(row.activity.map((x) => x.kind)).toEqual(['created', 'assigned', 'started', 'note', 'resolved']);
    expect(row.activity.find((x) => x.kind === 'note')).toMatchObject({
      body: 'Found a free seat',
      actorUserId: managerId,
    });
    await expect(
      executeCommand(
        updateCommand,
        { eventId, requestId: r.requestId, action: 'resolve' },
        as(managerId, at(150)),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    expect((await queue(a.ctx())).some((x) => x.id === r.requestId)).toBe(false);
    expect((await queue(a.ctx(), 'closed')).some((x) => x.id === r.requestId)).toBe(true);
    // The guest sees it resolved.
    const audits = await sqlRows<{ action: string; data: unknown }>(
      a.org.id,
      sql`select action, data from platform.audit_events where target_id = ${r.requestId} order by seq`,
    );
    expect(audits.map((x) => x.action)).toEqual([
      'assistance.guest_request',
      'assistance.assign',
      'assistance.start',
      'assistance.note',
      'assistance.resolve',
    ]);
    expect(JSON.stringify(audits)).not.toContain('Found a free seat');
  });

  it('starting an unassigned request takes it; cancelling closes it; the guest sees each state', async () => {
    const r = await ask(tickets[7] as string, 'other');
    const started = await executeCommand(
      updateCommand,
      { eventId, requestId: r.requestId, action: 'start' },
      as(scannerId),
      ports,
    );
    expect(started).toMatchObject({ state: 'in_progress', assignee: { kind: 'user', id: scannerId } });
    const status = () =>
      executeQuery(guestStatusQuery, { eventId, token: r.statusToken }, guestCtx(a.org.id), ports);
    expect((await status()).state).toBe('in_progress');
    await executeCommand(
      updateCommand,
      { eventId, requestId: r.requestId, action: 'cancel' },
      as(scannerId),
      ports,
    );
    expect((await status()).state).toBe('cancelled');
  });

  it('assign to a member who works the event (org or event role); not to a viewer; staff list', async () => {
    const r = await ask(tickets[8] as string, 'seat');
    await executeCommand(
      assignCommand,
      { eventId, requestId: r.requestId, assignee: doorStaffId },
      a.ctx(),
      ports,
    );
    expect(await one(a.ctx(), r.requestId)).toMatchObject({
      state: 'assigned',
      assignee: { id: doorStaffId },
      mine: false,
    });
    await expect(
      executeCommand(assignCommand, { eventId, requestId: r.requestId, assignee: viewerId }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(assignCommand, { eventId, requestId: r.requestId, assignee: uuidv7() }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    // The door staff member (a viewer made door staff at this event) may take it themselves.
    const mine = await executeCommand(
      assignCommand,
      { eventId, requestId: r.requestId, assignee: 'me' },
      as(doorStaffId),
      ports,
    );
    expect(mine.mine).toBe(true);
    const staff = (await executeQuery(assigneesQuery, { eventId }, a.ctx(), ports)).map((s) => s.userId);
    expect(staff).toEqual(expect.arrayContaining([a.ownerId, managerId, scannerId, doorStaffId]));
    expect(staff).not.toContain(viewerId);
    expect(staff).not.toContain(financeId);
  });

  it('viewers read but can’t act; finance can’t read; a device takes and resolves for itself', async () => {
    const r = await ask(tickets[9] as string, 'seat');
    expect((await queue(as(viewerId))).some((x) => x.id === r.requestId)).toBe(true);
    for (const cmd of [
      () =>
        executeCommand(
          assignCommand,
          { eventId, requestId: r.requestId, assignee: 'me' },
          as(viewerId),
          ports,
        ),
      () =>
        executeCommand(
          updateCommand,
          { eventId, requestId: r.requestId, action: 'resolve' },
          as(viewerId),
          ports,
        ),
      () =>
        executeCommand(addNoteCommand, { eventId, requestId: r.requestId, body: 'hi' }, as(viewerId), ports),
    ])
      await expect(cmd()).rejects.toMatchObject({ code: 'forbidden' });
    await expect(queue(as(financeId))).rejects.toMatchObject({ code: 'forbidden' });

    const d = await device('Roaming phone');
    const taken = await executeCommand(
      assignCommand,
      { eventId, requestId: r.requestId, assignee: 'me' },
      d.ctx(),
      ports,
    );
    expect(taken).toMatchObject({ assignee: { kind: 'device', label: 'Roaming phone' }, mine: true });
    expect((await one(a.ctx(), r.requestId)).mine).toBe(false);
    const done = await executeCommand(
      updateCommand,
      { eventId, requestId: r.requestId, action: 'resolve' },
      d.ctx(),
      ports,
    );
    expect(done.state).toBe('resolved');
    // A request is only reachable under its own event.
    await expect(
      executeCommand(
        updateCommand,
        { eventId: otherEventId, requestId: r.requestId, action: 'cancel' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('SLA escalation and on-duty push', () => {
  it('an unassigned request past its SLA raises the assistanceOverdue alert; taking it resolves the alert', async () => {
    const t0 = new Date(Date.now() - 60_000);
    const e = await setup(a, 'Escalation night', 2);
    const evalAt = (now: Date) =>
      withTenant(systemCtx(a.org.id), (tx) =>
        evaluateEventAlertsTx(
          tx,
          { ...systemCtx(a.org.id), now },
          e.eventId,
          { notifier: createNotifier() },
          now,
        ),
      );
    const r = await executeCommand(
      guestRequestCommand,
      {
        eventId: e.eventId,
        ticketToken: assistanceTicketToken(e.tickets[0] as string),
        reason: 'medical',
        note: '',
        location: '',
      },
      guestCtx(a.org.id, t0),
      ports,
    );
    const alertsNow = () =>
      executeQuery(listAlertsQuery, { eventId: e.eventId, status: 'active' }, a.ctx(), ports);
    await evalAt(new Date(t0.getTime() + 60_000));
    expect((await alertsNow()).some((x) => x.rule === 'assistanceOverdue')).toBe(false);
    await evalAt(new Date(t0.getTime() + 121_000));
    const [alert] = (await alertsNow()).filter((x) => x.rule === 'assistanceOverdue');
    expect(alert).toMatchObject({ severity: 'critical', count: 1, params: { count: 1, urgent: 1 } });
    expect(alert?.fixPath).toMatch(/^\/e\/[a-z0-9-]+\/assistance$/);
    // A viewer (assistance:read) sees it; finance (no assistance:read) doesn't.
    expect(
      (
        await executeQuery(listAlertsQuery, { eventId: e.eventId, status: 'active' }, as(viewerId), ports)
      ).some((x) => x.rule === 'assistanceOverdue'),
    ).toBe(true);
    expect(
      (
        await executeQuery(listAlertsQuery, { eventId: e.eventId, status: 'active' }, as(financeId), ports)
      ).some((x) => x.rule === 'assistanceOverdue'),
    ).toBe(false);
    await executeCommand(
      assignCommand,
      { eventId: e.eventId, requestId: r.requestId, assignee: 'me' },
      a.ctx(),
      ports,
    );
    await evalAt(new Date(t0.getTime() + 180_000));
    expect((await alertsNow()).some((x) => x.rule === 'assistanceOverdue')).toBe(false);
  });

  it('urgent and high requests are queued once for every subscribed staff device at the event but the sender', async () => {
    const k = createECDH('prime256v1');
    k.generateKeys();
    const copy = { title: 'T', body: '{label}' };
    const subscribe = subscribeStaffPushCommand((e) => e.startsWith('https://push.example.test/'));
    const phones = [await device('Push phone 1'), await device('Push phone 2')];
    for (const [i, p] of phones.entries())
      await executeCommand(
        subscribe,
        {
          endpoint: `https://push.example.test/help-${i}-${uuidv7()}`,
          keys: {
            p256dh: k.getPublicKey().toString('base64url'),
            auth: randomBytes(16).toString('base64url'),
          },
          locale: 'en',
          copy: {
            device_offline: copy,
            device_low_battery: copy,
            device_backlog: copy,
            capacity_near: copy,
            assistance: copy,
          },
        },
        p.ctx(),
        ports,
      );
    const pushesFor = async (requestId: string) =>
      sqlRows<{ kind: string; params: { label?: string } }>(
        a.org.id,
        sql`select kind, params from checkin.staff_alert_pushes where alert_key = ${`assistance:${requestId}`}`,
      );
    const urgent = await ask(tickets[10] as string, 'medical', { location: 'Balcony' });
    const q1 = await pushesFor(urgent.requestId);
    expect(q1.length).toBeGreaterThanOrEqual(2);
    expect(q1.every((p) => p.kind === 'assistance' && p.params.label === `#${urgent.number} · Balcony`)).toBe(
      true,
    );
    const normal = await ask(tickets[10] as string, 'seat');
    expect(await pushesFor(normal.requestId)).toEqual([]);
    const backup = await executeCommand(
      staffRequestCommand,
      { eventId, reason: 'backup', note: '', checkpointId: north },
      phones[0]?.ctx() as Ctx,
      ports,
    );
    const q2 = await pushesFor(backup.requestId);
    expect(q2.length).toBe(q1.length - 1);
    expect(q2[0]?.params.label).toBe(`#${backup.number} · North gate`);
  });
});

describe('Command Center widget and isolation', () => {
  it('the Assistance widget counts the queue for the owner (no guest details)', async () => {
    const w = await executeQuery(assistanceWidget.loader, { eventId }, a.ctx(), ports);
    expect(w.waiting + w.assigned + w.inProgress).toBeGreaterThan(0);
    expect(w.top.length).toBeLessThanOrEqual(5);
    expect(JSON.stringify(w)).not.toMatch(/Hana|Row C|Aisle/);
  });

  it('another org sees and changes nothing', async () => {
    const r = await ask(tickets[4] as string, 'seat');
    await expect(queue(b.ctx())).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(assignCommand, { eventId, requestId: r.requestId, assignee: 'me' }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeQuery(guestStatusQuery, { eventId, token: r.statusToken }, guestCtx(b.org.id), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    const [seen] = await sqlRows<{ n: number }>(
      b.org.id,
      sql`select count(*)::int as n from assistance.requests where id = ${r.requestId}`,
    );
    expect(seen?.n).toBe(0);
  });
});
