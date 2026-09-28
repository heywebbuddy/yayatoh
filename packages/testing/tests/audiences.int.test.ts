import { addGuestCommand, removeGuestCommand, setAttendeeLabelsCommand } from '@yayatoh/attendees';
import {
  audienceExportBulk,
  catchUpParticipation,
  deleteSegmentCommand,
  getSegmentQuery,
  listSegmentsQuery,
  participationProjector,
  previewAudienceQuery,
  refreshParticipationTx,
  saveSegmentCommand,
  templateDefinition,
} from '@yayatoh/audiences';
import { scanTicketCommand } from '@yayatoh/checkin';
import type { SegmentDefinition } from '@yayatoh/crm';
import { recordConsentTx } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  assignEventRoleCommand,
  createEventCommand,
  createSeriesCommand,
  setEventSeriesCommand,
  transitionEventCommand,
} from '@yayatoh/events';
import { buildRow } from '@yayatoh/floorplan';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { orderByManageToken, startCheckoutCommand } from '@yayatoh/orders';
import { consumeEvent } from '@yayatoh/platform';
import { assignSeatsCommand, setEventLayoutCommand } from '@yayatoh/seating';
import { addMemberCommand } from '@yayatoh/tenancy';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, runBulk, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
const tag = uuidv7().slice(-8);
// Two editions of one series: "last year" (2027) and "this year" (2028).
const LAST = {
  startsAt: '2027-06-05T18:00:00Z',
  endsAt: '2027-06-05T23:00:00Z',
  during: '2027-06-05T19:00:00Z',
};
const THIS = {
  startsAt: '2028-06-03T18:00:00Z',
  endsAt: '2028-06-03T23:00:00Z',
  during: '2028-06-03T19:00:00Z',
};
let lastYear: string;
let thisYear: string;
let vip: string;
let ga: string;
let lastPass: string;
let seriesId: string;
const row = buildRow({ label: 'A', count: 6, x: 100, y: 100 });
const people = new Map<string, { email: string; attendeeIds: string[]; codes: string[] }>();
const email = (who: string) => `${who.toLowerCase()}.${tag}@audience.test`;

async function buy(f: OrgFixture, eventId: string, ticketTypeId: string, who: string) {
  const r = await executeCommand(
    startCheckoutCommand,
    { eventId, items: [{ ticketTypeId, quantity: 1 }], buyer: { email: email(who), name: who } },
    createCtx({ orgId: f.org.id }),
    ports,
  );
  const tickets = (await orderByManageToken(r.manageToken))?.tickets ?? [];
  const p = people.get(who) ?? { email: email(who), attendeeIds: [], codes: [] };
  for (const t of tickets) {
    p.codes.push(t.code);
    const [att] = await withTenant(f.ctx(), (tx) =>
      tx.execute<{ id: string }>(sql`select id from attendees.attendees where ticket_id = ${t.id}`),
    );
    if (att) p.attendeeIds.push(att.id);
  }
  people.set(who, p);
}

const scan = (eventId: string, who: string, at: string) =>
  executeCommand(
    scanTicketCommand,
    { eventId, code: people.get(who)?.codes.at(-1) ?? '' },
    a.ctx({ now: new Date(at) }),
    ports,
  );

async function event(f: OrgFixture, name: string, when: typeof LAST) {
  const e = await executeCommand(
    createEventCommand,
    { name: `${name} ${tag}`, timezone: 'America/Chicago', startsAt: when.startsAt, endsAt: when.endsAt },
    f.ctx(),
    ports,
  );
  return e.id;
}
const ticketType = async (f: OrgFixture, eventId: string, name: string, priceMinor = 0) =>
  (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name, priceMinor, quantityTotal: 50 },
      f.ctx(),
      ports,
    )
  ).id;

const preview = (definition: SegmentDefinition, ctx: Ctx = a.ctx(), eventId: string | null = null) =>
  executeQuery(previewAudienceQuery, { definition, eventId, limit: 100 }, ctx, ports);
const namesOf = async (definition: SegmentDefinition, ctx: Ctx = a.ctx(), eventId: string | null = null) => {
  const r = await preview(definition, ctx, eventId);
  expect(r.count).toBe(r.rows.length);
  return r.rows.map((x) => x.name).sort();
};

async function participationRows(f: OrgFixture, eventId: string) {
  return withTenant(f.ctx(), (tx) =>
    tx.execute<Record<string, unknown>>(sql`
      select c.name, p.registered, p.tickets, p.ticket_type_ids, p.has_seat, p.checked_in, p.orders,
             p.spend_minor, p.labels, p.registered_at, p.source
      from crm.event_participation p join crm.contacts c on c.id = p.contact_id
      where p.event_id = ${eventId} order by c.name`),
  );
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  lastYear = await event(a, 'Harbor Gala 2027', LAST);
  thisYear = await event(a, 'Harbor Gala 2028', THIS);
  seriesId = (await executeCommand(createSeriesCommand, { name: `Harbor Gala ${tag}` }, a.ctx(), ports)).id;
  for (const id of [lastYear, thisYear])
    await executeCommand(setEventSeriesCommand, { eventId: id, seriesId }, a.ctx(), ports);
  lastPass = await ticketType(a, lastYear, 'Pass');
  vip = await ticketType(a, thisYear, 'VIP');
  ga = await ticketType(a, thisYear, 'General');
  await executeCommand(
    setEventLayoutCommand,
    { eventId: thisYear, doc: { version: 1, width: 1600, height: 1000, items: [row] } },
    a.ctx(),
    ports,
  );
  for (const id of [lastYear, thisYear])
    await executeCommand(transitionEventCommand, { eventId: id, transition: 'publish' }, a.ctx(), ports);

  // Last year: Ava, Gus and Ivy were checked in; Hal registered but never came.
  for (const who of ['Ava', 'Gus', 'Hal', 'Ivy']) await buy(a, lastYear, lastPass, who);
  for (const who of ['Ava', 'Gus', 'Ivy']) await scan(lastYear, who, LAST.during);
  // This year: Ava (VIP, seated by the organizer), Ben (VIP, unseated, checked in), Dee (VIP, then
  // her guest record is cancelled with her ticket below), Cy and Ivy (General), Fin (a guest).
  for (const who of ['Ava', 'Ben', 'Dee']) await buy(a, thisYear, vip, who);
  for (const who of ['Cy', 'Ivy']) await buy(a, thisYear, ga, who);
  const fin = await executeCommand(
    addGuestCommand,
    { eventId: thisYear, name: 'Fin', email: email('Fin'), labels: ['press'] },
    a.ctx(),
    ports,
  );
  people.set('Fin', { email: email('Fin'), attendeeIds: [fin.id], codes: [] });
  const eve = await executeCommand(
    addGuestCommand,
    { eventId: thisYear, name: 'Eve', email: email('Eve'), labels: ['press'] },
    a.ctx(),
    ports,
  );
  await executeCommand(removeGuestCommand, { eventId: thisYear, attendeeId: eve.id }, a.ctx(), ports);
  await executeCommand(
    assignSeatsCommand,
    { eventId: thisYear, attendeeIds: people.get('Ava')?.attendeeIds.slice(-1) ?? [], itemId: row.id },
    a.ctx(),
    ports,
  );
  await scan(thisYear, 'Ben', THIS.during);
  // Dee's attendee record is cancelled (as a voided ticket does): she leaves the list, still a buyer.
  await withTenant(a.ctx(), async (tx) => {
    const { cancelAttendeesTx } = await import('@yayatoh/attendees');
    await cancelAttendeesTx(tx, a.ctx(), people.get('Dee')?.attendeeIds ?? []);
  });
  // Bravo has look-alike people at its own event (isolation).
  const bEvent = await event(b, 'Bravo Gala', THIS);
  const bType = await ticketType(b, bEvent, 'VIP');
  await executeCommand(transitionEventCommand, { eventId: bEvent, transition: 'publish' }, b.ctx(), ports);
  await buy(b, bEvent, bType, 'Zed');

  await catchUpParticipation(a.org.id);
  await catchUpParticipation(b.org.id);
});
afterAll(closePools);

describe('the three vision audiences (M3.6 acceptance)', () => {
  it('VIPs who bought but have not selected seats', async () => {
    expect(
      await namesOf(templateDefinition('vipsWithoutSeats', { eventId: thisYear, ticketTypeIds: [vip] })),
    ).toEqual(['Ben']);
  });

  it("last year's attendees not registered this year (series-relative)", async () => {
    expect(await namesOf(templateDefinition('lastYearNotThisYear', { eventId: thisYear }))).toEqual(['Gus']);
  });

  it('registered but not checked in', async () => {
    expect(await namesOf(templateDefinition('registeredNotCheckedIn', { eventId: thisYear }))).toEqual([
      'Ava',
      'Cy',
      'Fin',
      'Ivy',
    ]);
  });

  it('the previous edition of the first edition is nobody', async () => {
    expect(await namesOf(templateDefinition('lastYearNotThisYear', { eventId: lastYear }))).toEqual([]);
  });
});

describe('participation projection', () => {
  it('projects the sources exactly (live rows)', async () => {
    const rows = await participationRows(a, thisYear);
    const by = new Map(rows.map((r) => [r.name as string, r]));
    expect([...by.keys()]).toEqual(['Ava', 'Ben', 'Cy', 'Dee', 'Fin', 'Ivy']);
    expect(by.get('Ava')).toMatchObject({ registered: true, tickets: 1, has_seat: true, checked_in: false });
    expect(by.get('Ben')).toMatchObject({ registered: true, tickets: 1, has_seat: false, checked_in: true });
    expect(by.get('Ben')?.ticket_type_ids).toEqual([vip]);
    // Dee still bought (a buyer row) but holds nothing any more.
    expect(by.get('Dee')).toMatchObject({ registered: false, tickets: 0, orders: 1 });
    expect(by.get('Fin')).toMatchObject({ registered: true, tickets: 0, labels: ['press'], orders: 0 });
    expect(by.has('Eve')).toBe(false);
    expect(rows.every((r) => r.source === 'live')).toBe(true);
  });

  it('keeps contact_profile current (totals, first/last seen, labels)', async () => {
    const [p] = await withTenant(a.ctx(), (tx) =>
      tx.execute<Record<string, unknown>>(sql`
        select pr.events, pr.events_attended, pr.tickets, pr.orders, pr.labels, pr.email_consent,
               pr.first_seen_at <= pr.last_seen_at as ordered
        from crm.contact_profile pr join crm.contacts c on c.id = pr.contact_id where c.email_norm = ${email('Ava')}`),
    );
    expect(p).toMatchObject({ events: 2, events_attended: 1, tickets: 2, orders: 2, ordered: true });
    expect(p?.email_consent).toBe('none');
  });

  it('is idempotent: recomputing and redelivering change nothing', async () => {
    const before = await participationRows(a, thisYear);
    await withTenant(systemCtx(a.org.id), (tx) =>
      refreshParticipationTx(tx, systemCtx(a.org.id), thisYear, null),
    );
    expect(await participationRows(a, thisYear)).toEqual(before);
    // A processed event delivered again is skipped (exactly once per consumer).
    const [evt] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ id: string; type: string; payload: unknown }>(
        sql`select id, type, payload from platform.domain_events where type = 'order.paid' order by id limit 1`,
      ),
    );
    if (!evt) throw new Error('no event');
    const again = await consumeEvent(participationProjector(), {
      id: evt.id,
      orgId: a.org.id,
      type: evt.type,
      version: 1,
      aggregateType: 'order',
      aggregateId: 'x',
      payload: evt.payload,
      logSeq: 0,
    });
    expect(again).toBe(false);
    expect(await catchUpParticipation(a.org.id)).toBe(0);
    expect(await participationRows(a, thisYear)).toEqual(before);
  });

  it('projects backfilled (replayed) legacy events too, exactly once', async () => {
    const before = await participationRows(a, lastYear);
    // A legacy-style history event (replayed, already published) for Hal's order, after his row
    // was lost: the projector (which opts in to replayed events) rebuilds it.
    const [order] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ id: string }>(
        sql`select o.id from orders.orders o join crm.contacts c on c.id = o.buyer_contact_id
            where c.email_norm = ${email('Hal')} and o.event_id = ${lastYear}`,
      ),
    );
    if (!order) throw new Error('no order');
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(sql`
        delete from crm.event_participation p using crm.contacts c
        where c.id = p.contact_id and c.email_norm = ${email('Hal')} and p.event_id = ${lastYear}`),
    );
    expect((await participationRows(a, lastYear)).length).toBe(before.length - 1);
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(sql`
        insert into platform.domain_events (org_id, type, version, aggregate_type, aggregate_id, payload, actor,
                                            request_id, replayed)
        values (${a.org.id}, 'order.paid', 1, 'order', ${order.id},
                ${JSON.stringify({ orgId: a.org.id, orderId: order.id, eventId: lastYear, via: 'legacy' })}::jsonb,
                'legacy:test', 'legacy-backfill:test', true)`),
    );
    expect(await catchUpParticipation(a.org.id)).toBe(1);
    expect(await participationRows(a, lastYear)).toEqual(before);
    expect(await catchUpParticipation(a.org.id)).toBe(0);
  });

  it('follows changes: a seat, a label and a consent move people between audiences', async () => {
    await executeCommand(
      assignSeatsCommand,
      { eventId: thisYear, attendeeIds: people.get('Ben')?.attendeeIds ?? [], itemId: row.id },
      a.ctx(),
      ports,
    );
    await executeCommand(
      setAttendeeLabelsCommand,
      { eventId: thisYear, attendeeIds: people.get('Cy')?.attendeeIds ?? [], add: ['press'], remove: [] },
      a.ctx(),
      ports,
    );
    await withTenant(a.ctx(), async (tx) => {
      const [c] = await tx.execute<{ id: string }>(
        sql`select id from crm.contacts where email_norm = ${email('Ivy')}`,
      );
      await recordConsentTx(tx, a.ctx(), {
        contactId: c?.id ?? '',
        channel: 'email',
        purpose: 'marketing',
        status: 'granted',
        evidence: 'test',
      });
    });
    await catchUpParticipation(a.org.id);
    expect(
      await namesOf(templateDefinition('vipsWithoutSeats', { eventId: thisYear, ticketTypeIds: [vip] })),
    ).toEqual([]);
    const press: SegmentDefinition = {
      version: 1,
      root: {
        type: 'group',
        op: 'and',
        conditions: [
          { type: 'label', scope: { kind: 'event', eventId: thisYear }, label: 'press', negate: false },
        ],
      },
    };
    expect(await namesOf(press)).toEqual(['Cy', 'Fin']);
    const consented: SegmentDefinition = {
      version: 1,
      root: {
        type: 'group',
        op: 'or',
        conditions: [
          { type: 'consent', channel: 'email', granted: true },
          {
            type: 'group',
            op: 'and',
            conditions: [
              { type: 'totals', metric: 'eventsAttended', op: 'gte', value: 1 },
              {
                type: 'participation',
                scope: { kind: 'series', seriesId },
                negate: true,
                role: 'attendee',
                ticketTypeIds: [],
                seated: true,
                checkedIn: null,
                registeredFrom: null,
                registeredTo: null,
              },
            ],
          },
        ],
      },
    };
    // Ivy consented; Gus attended once and never had a seat in the series. Ben attended and now
    // has a seat; Ava attended and has one.
    // (Filtered to this test's people: the shared fixture's own buyer opted in at checkout.)
    const mine = new Set(['Ava', 'Ben', 'Cy', 'Dee', 'Fin', 'Gus', 'Hal', 'Ivy']);
    expect((await namesOf(consented)).filter((n) => n !== null && mine.has(n))).toEqual(['Gus', 'Ivy']);
  });
});

describe('segments: storage, scope and permissions', () => {
  it('saves, lists with live counts, reloads and deletes an audience', async () => {
    const def = templateDefinition('registeredNotCheckedIn', { eventId: thisYear });
    const saved = await executeCommand(
      saveSegmentCommand,
      { name: `  No-shows   ${tag} `, definition: def },
      a.ctx(),
      ports,
    );
    expect(saved.name).toBe(`No-shows ${tag}`);
    const list = await executeQuery(listSegmentsQuery, {}, a.ctx(), ports);
    expect(list.find((s) => s.id === saved.id)?.count).toBe(4);
    expect((await executeQuery(getSegmentQuery, { segmentId: saved.id }, a.ctx(), ports)).definition).toEqual(
      def,
    );
    await expect(
      executeCommand(saveSegmentCommand, { name: `no-shows ${tag}`, definition: def }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'conflict' });
    // Another org can't read or delete it.
    await expect(
      executeQuery(getSegmentQuery, { segmentId: saved.id }, b.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      executeCommand(deleteSegmentCommand, { segmentId: saved.id }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await executeCommand(deleteSegmentCommand, { segmentId: saved.id }, a.ctx(), ports);
  });

  it("is tenant-isolated: another org's event ids match nothing, and its people never show", async () => {
    const def = templateDefinition('registeredNotCheckedIn', { eventId: thisYear });
    expect((await preview(def, b.ctx())).count).toBe(0);
    const everyone = await namesOf(
      { version: 1, root: { type: 'group', op: 'and', conditions: [] } },
      b.ctx(),
    );
    expect(everyone).toContain('Zed');
    expect(everyone).not.toContain('Ava');
  });

  it('viewing needs messages:read and building needs messages:send', async () => {
    const def = templateDefinition('registeredNotCheckedIn', { eventId: thisYear });
    const viewer = userCtx(a.viewerId, a.org.id);
    await expect(preview(def, viewer)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(executeQuery(listSegmentsQuery, {}, viewer, ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const marketer = uuidv7();
    await executeCommand(addMemberCommand, { userId: marketer, role: 'marketing' }, a.ctx(), ports);
    const m = userCtx(marketer, a.org.id);
    expect((await preview(def, m)).count).toBe(4);
    const saved = await executeCommand(saveSegmentCommand, { name: `M ${tag}`, definition: def }, m, ports);
    // A box-office member may read messages but not send: they can view, not build.
    const box = uuidv7();
    await executeCommand(addMemberCommand, { userId: box, role: 'box_office' }, a.ctx(), ports);
    const bo = userCtx(box, a.org.id);
    expect((await preview(def, bo)).count).toBe(4);
    await expect(
      executeCommand(saveSegmentCommand, { name: `B ${tag}`, definition: def }, bo, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(deleteSegmentCommand, { segmentId: saved.id }, bo, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Exporting contact data needs attendees:export (the marketing role has none).
    await expect(
      executeCommand(
        audienceExportBulk.start,
        { selection: { filter: { segmentId: saved.id } }, params: EXPORT },
        m,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('preview respects event-scoped roles', async () => {
    const def = templateDefinition('registeredNotCheckedIn', { eventId: thisYear });
    const manager = uuidv7();
    await executeCommand(addMemberCommand, { userId: manager, role: 'scanner' }, a.ctx(), ports);
    await executeCommand(
      assignEventRoleCommand,
      { eventId: thisYear, userId: manager, role: 'event_manager' },
      a.ctx(),
      ports,
    );
    const em = userCtx(manager, a.org.id);
    // Org-wide: refused. Scoped to their event: allowed, and limited to that event's people.
    await expect(preview(def, em)).rejects.toMatchObject({ code: 'forbidden' });
    expect(await namesOf(def, em, thisYear)).toEqual(['Ava', 'Cy', 'Fin', 'Ivy']);
    const all = { version: 1 as const, root: { type: 'group' as const, op: 'and' as const, conditions: [] } };
    expect(await namesOf(all, em, thisYear)).toEqual(['Ava', 'Ben', 'Cy', 'Dee', 'Fin', 'Ivy']);
    // Nothing about other events: last year's edition, series, other events and profile totals.
    for (const other of [
      templateDefinition('lastYearNotThisYear', { eventId: thisYear }),
      templateDefinition('registeredNotCheckedIn', { eventId: lastYear }),
      {
        version: 1 as const,
        root: {
          type: 'group' as const,
          op: 'and' as const,
          conditions: [{ type: 'totals' as const, metric: 'events' as const, op: 'gte' as const, value: 1 }],
        },
      },
    ])
      await expect(preview(other, em, thisYear)).rejects.toMatchObject({ code: 'forbidden' });
    // Their event role does not reach last year's event at all.
    await expect(preview(all, em, lastYear)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('exports through the bulk path: step-up, audit, allowlisted CSV', async () => {
    const def = templateDefinition('registeredNotCheckedIn', { eventId: thisYear });
    const stale = a.ctx({ stepUpAt: new Date(Date.now() - 11 * 60_000) });
    await expect(
      executeCommand(
        audienceExportBulk.start,
        { selection: { filter: { definition: def } }, params: EXPORT },
        stale,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'step_up_required' });
    const { operationId, total } = await executeCommand(
      audienceExportBulk.start,
      { selection: { filter: { definition: def } }, params: EXPORT },
      a.ctx(),
      ports,
    );
    expect(total).toBe(4);
    await runBulk(a.org.id, operationId);
    const file = await executeQuery(audienceExportBulk.file, { operationId }, a.ctx(), ports);
    const lines = file.content.replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toBe(
      'Name,Email,Events,Attended,Tickets,First seen,Last seen,Email consent,SMS consent',
    );
    expect(
      lines
        .slice(1)
        .map((l) => l.split(',')[0])
        .sort(),
    ).toEqual(['Ava', 'Cy', 'Fin', 'Ivy']);
    expect(lines.find((l) => l.startsWith('Ivy'))).toContain(',Yes,No');
    const [audit] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ action: string }>(
        sql`select action from platform.audit_events where target_id = ${operationId}::text and action = 'bulk.start'`,
      ),
    );
    expect(audit?.action).toBe('bulk.start');
  });
});

const EXPORT = {
  headers: {
    name: 'Name',
    email: 'Email',
    events: 'Events',
    eventsAttended: 'Attended',
    tickets: 'Tickets',
    firstSeen: 'First seen',
    lastSeen: 'Last seen',
    emailConsent: 'Email consent',
    smsConsent: 'SMS consent',
  },
  consent: { granted: 'Yes', withdrawn: 'Withdrawn', unknown_legacy: 'Unknown', none: 'No' },
};
