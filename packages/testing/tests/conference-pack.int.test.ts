import { type AlertDto, listAlertsQuery, RULES, type RuleKey } from '@yayatoh/alerts';
import {
  type AnyWidgetDef,
  exhibitorActivityWidget,
  sessionAttendanceWidget,
  sessionFillWidget,
  sponsorActivityWidget,
  type WidgetDef,
} from '@yayatoh/command-center';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { assignEventRoleCommand } from '@yayatoh/events';
import { executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { createNotifier } from '@yayatoh/notifications';
import { addMemberCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CONFERENCE_FIXTURE,
  type ConferenceScenario,
  conferenceScenario,
  fakeConferenceSources,
  type OrgFixture,
  ports,
  systemCtx,
  twoOrgs,
  userCtx,
} from '../src/index.ts';

/**
 * M5.9a conference Command Center pack on the M3.2b engine. Acceptance: the fixture gives exactly
 * "3 sessions are over 95 % capacity" and "5 exhibitors have no leads", each clearing when fixed.
 * Also every other rule of the pack (raised once, cleared by its fix), who sees which alert and
 * tile (the door: stations and session attendance only, never money), and tenant isolation.
 */

let a: OrgFixture;
let b: OrgFixture;
let s: ConferenceScenario;
const sources = fakeConferenceSources();
const deps = { notifier: createNotifier(), conference: sources };
const members: Record<string, string> = {};

const alertsOf = async (f: OrgFixture, eventId: string, ctx = f.ctx()) => {
  const read = async (status: 'active' | 'resolved') =>
    (await executeQuery(listAlertsQuery, { status, eventId, limit: 200 }, ctx, ports)).filter(
      (x) => x.eventId === eventId,
    );
  return [...(await read('active')), ...(await read('resolved'))];
};
const active = async (eventId: string, ctx = a.ctx()) =>
  (await alertsOf(a, eventId, ctx)).filter((x) => x.state !== 'resolved');
const one = async (rule: RuleKey): Promise<AlertDto | undefined> => {
  const found = (await alertsOf(a, s.eventId)).filter((x) => x.rule === rule);
  expect(found.length).toBeLessThanOrEqual(1);
  return found[0];
};
const load = <O>(w: WidgetDef<O>, ctx = a.ctx()) =>
  executeQuery(w.loader, { eventId: s.eventId }, ctx, ports);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  s = await conferenceScenario(a.org.id, { deps });
  for (const role of ['finance', 'marketing', 'manager'] as const) {
    members[role] = uuidv7();
    await executeCommand(addMemberCommand, { userId: members[role], role }, a.ctx(), ports);
  }
  // The fixture viewer works the doors of the conference too (door role).
  await executeCommand(
    assignEventRoleCommand,
    { eventId: s.eventId, userId: a.viewerId, role: 'door_staff' },
    a.ctx(),
    ports,
  );
}, 240_000);

afterAll(async () => {
  await closePools();
});

describe('acceptance (M5.9a)', () => {
  it('the fixture gives exactly "3 sessions are over 95 % capacity", cleared when places are added', async () => {
    expect(await one('sessionsNearCapacity')).toMatchObject({
      state: 'open',
      severity: 'warning',
      count: CONFERENCE_FIXTURE.nearlyFull,
      fixPath: `/e/${s.eventSlug}/sessions`,
    });
    await s.addPlaces();
    await s.evaluate();
    expect(await one('sessionsNearCapacity')).toMatchObject({ state: 'resolved' });
  });

  it('the fixture gives exactly "5 exhibitors have no leads", cleared when each has a lead', async () => {
    expect(await one('exhibitorsNoLeads')).toMatchObject({
      state: 'open',
      count: CONFERENCE_FIXTURE.withoutLeads,
      params: { count: 5, exhibitors: 7 },
    });
    await s.recordLeads();
    await s.evaluate();
    expect(await one('exhibitorsNoLeads')).toMatchObject({ state: 'resolved' });
  });
});

describe('the rest of the pack', () => {
  it('raises each rule once with its count, and each clears with its fix', async () => {
    const expected: [RuleKey, number, () => Promise<void>][] = [
      ['sessionWaitlists', 1, s.clearLine],
      ['roomsTooSmall', CONFERENCE_FIXTURE.roomsTooSmall, async () => {}],
      ['exhibitorsNoStaff', CONFERENCE_FIXTURE.withoutStaff, s.staffExhibitors],
      ['speakerTasksOverdue', CONFERENCE_FIXTURE.speakerTasksOverdue, s.completeSpeakerTasks],
      ['deliverablesOverdue', CONFERENCE_FIXTURE.deliverablesOverdue, async () => {}],
      [
        'printersKiosksOffline',
        CONFERENCE_FIXTURE.printersOffline + CONFERENCE_FIXTURE.kiosksOffline,
        s.bringStationsOnline,
      ],
      ['approvalBacklog', CONFERENCE_FIXTURE.approvalsPending, s.decideApplications],
      ['invoicesOverdue', CONFERENCE_FIXTURE.invoicesOverdue, s.settleInvoices],
    ];
    for (const [rule, count] of expected)
      expect(await one(rule), rule).toMatchObject({ state: 'open', count });
    expect((await one('printersKiosksOffline'))?.severity).toBe('critical');
    expect((await one('sessionWaitlists'))?.params).toMatchObject({ longest: 12, max: 10 });
    // Evaluating again changes nothing (one alert per rule and event).
    await s.evaluate();
    for (const [rule, count] of expected)
      expect(await one(rule), rule).toMatchObject({ state: 'open', count });
    // The fixes.
    for (const [, , fix] of expected) await fix();
    await s.evaluate();
    for (const rule of [
      'sessionWaitlists',
      'exhibitorsNoStaff',
      'speakerTasksOverdue',
      'printersKiosksOffline',
      'approvalBacklog',
      'invoicesOverdue',
    ] as const)
      expect(await one(rule), rule).toMatchObject({ state: 'resolved' });
    // Not fixed: the robotics lab still holds 45 places in a 40-seat room; deliverables still due.
    expect(await one('roomsTooSmall')).toMatchObject({ state: 'open', count: 1 });
    expect(await one('deliverablesOverdue')).toMatchObject({ state: 'open', count: 2 });
  });

  it('an unconnected source keeps its rule quiet (no leads, deliverables or printers without a port)', async () => {
    const quiet = await conferenceScenario(a.org.id, {
      deps: { notifier: createNotifier() },
      withoutFakes: true,
    });
    const rules = (await active(quiet.eventId)).map((x) => x.rule);
    expect(rules).toEqual(
      expect.arrayContaining(['sessionsNearCapacity', 'exhibitorsNoStaff', 'printersKiosksOffline']),
    );
    expect(rules).not.toContain('exhibitorsNoLeads');
    expect(rules).not.toContain('deliverablesOverdue');
    expect((await alertsOf(a, quiet.eventId)).find((x) => x.rule === 'printersKiosksOffline')?.count).toBe(1);
  }, 120_000);
});

describe('who sees what', () => {
  it('alerts follow the reader permissions; the door group is the stations alert only', async () => {
    // A scanner (no events:read) hears none of the pack; finance hears the invoices.
    const scanner = uuidv7();
    await executeCommand(addMemberCommand, { userId: scanner, role: 'scanner' }, a.ctx(), ports);
    await expect(alertsOf(a, s.eventId, userCtx(scanner, a.org.id))).rejects.toMatchObject({
      code: 'forbidden',
    });
    const finance = (await alertsOf(a, s.eventId, userCtx(members.finance as string, a.org.id))).map(
      (x) => x.rule,
    );
    expect(finance).toContain('invoicesOverdue');
    // The Command Center's alerts tile shows the door role its group only (devices and stations):
    // of the pack, that is printers and kiosks — never invoices, approvals or sessions.
    const pack = (await alertsOf(a, s.eventId)).filter((x) => !['devicesOffline'].includes(x.rule));
    expect(pack.filter((x) => RULES[x.rule].category === 'door').map((x) => x.rule)).toEqual([
      'printersKiosksOffline',
    ]);
    expect(RULES.invoicesOverdue.category).toBe('payments');
  });

  it('serves the door live session attendance and refuses it the other tiles', async () => {
    const door = userCtx(a.viewerId, a.org.id);
    const att = await load(sessionAttendanceWidget, door);
    expect(att.running).toBe(1);
    expect(att.sessions[0]).toMatchObject({
      title: 'Opening keynote',
      inRoom: CONFERENCE_FIXTURE.keynoteInRoom,
      running: true,
      level: 'ok',
    });
    // Only the keynote runs; the next session starts in an hour.
    expect(att.sessions.map((x) => x.title)).toEqual(['Opening keynote', 'Data workshop']);
    expect(JSON.stringify(att)).not.toMatch(/Minor|currency|email/i);
    const others: AnyWidgetDef[] = [
      sessionFillWidget,
      exhibitorActivityWidget(null),
      sponsorActivityWidget(null),
    ];
    for (const w of others) await expect(load(w, door)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(load(sessionFillWidget, userCtx(members.finance as string, a.org.id))).rejects.toMatchObject(
      {
        code: 'forbidden',
      },
    );
  });

  it('session fill: nearly full, full, lines and rooms too small for the owner and marketing', async () => {
    const fresh = await conferenceScenario(a.org.id, { deps });
    const fill = await executeQuery(sessionFillWidget.loader, { eventId: fresh.eventId }, a.ctx(), ports);
    expect(fill).toMatchObject({
      nearPct: 95,
      limited: 5,
      nearlyFull: 3,
      full: 1,
      waiting: 12,
      longLines: 1,
      roomsTooSmall: 1,
    });
    expect(fill.top.map((x) => [x.title, x.level])).toEqual([
      ['City panel', 'over'],
      ['Opening keynote', 'near'],
      ['Data workshop', 'near'],
      ['Robotics lab', 'ok'],
      ['Fireside chat', 'ok'],
    ]);
    expect(fill.top.find((x) => x.title === 'Robotics lab')?.roomTooSmall).toBe(true);
    await expect(
      executeQuery(
        sessionFillWidget.loader,
        { eventId: fresh.eventId },
        userCtx(members.marketing as string, a.org.id),
        ports,
      ),
    ).resolves.toMatchObject({ nearlyFull: 3 });
  }, 120_000);

  it('exhibitor and sponsor activity: people, leads through the port (or not connected), deliverables', async () => {
    const fresh = await conferenceScenario(a.org.id, { deps });
    const leads = sources.exhibitorLeads;
    const ex = await executeQuery(
      exhibitorActivityWidget(leads ?? null).loader,
      { eventId: fresh.eventId },
      a.ctx(),
      ports,
    );
    expect(ex).toMatchObject({ exhibitors: 7, staffed: 3, people: 3 });
    expect(ex.leads).toMatchObject({ total: 7, withoutLeads: 5 });
    expect(ex.leads?.top.map((x) => x.leads)).toEqual([4, 3]);
    const none = await executeQuery(
      exhibitorActivityWidget(null).loader,
      { eventId: fresh.eventId },
      a.ctx(),
      ports,
    );
    expect(none.leads).toBeNull();
    const sp = await executeQuery(
      sponsorActivityWidget(sources.overdueDeliverables ?? null).loader,
      { eventId: fresh.eventId },
      userCtx(members.manager as string, a.org.id),
      ports,
    );
    expect(sp).toEqual({ sponsors: 2, tiers: [{ tier: 'Gold', sponsors: 2 }], deliverablesOverdue: 2 });
  }, 120_000);
});

describe('tenant isolation', () => {
  it('another org sees none of the pack, and cannot load its tiles', async () => {
    expect(await alertsOf(b, s.eventId)).toEqual([]);
    const inB = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from alerts.alerts where event_id = ${s.eventId}::uuid`,
      ),
    );
    expect(Number(inB[0]?.n)).toBe(0);
    await expect(
      executeQuery(sessionFillWidget.loader, { eventId: s.eventId }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeQuery(
        sessionAttendanceWidget.loader,
        { eventId: s.eventId },
        userCtx(a.ownerId, b.org.id),
        ports,
      ),
    ).rejects.toBeDefined();
  });
});
