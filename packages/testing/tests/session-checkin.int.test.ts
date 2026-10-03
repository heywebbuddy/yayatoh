import {
  admitSessionOverrideCommand,
  createCheckpointCommand,
  deviceContext,
  deviceManifestQuery,
  enrollDeviceCommand,
  listCheckpointsQuery,
  scanTicketCommand,
  selfCheckInCommand,
  selfCheckinDoor,
  selfCheckinPageQuery,
  sessionAttendanceQuery,
  sessionDoorChoicesQuery,
  setSelfCheckinCommand,
  syncScansCommand,
} from '@yayatoh/checkin';
import { inRoomKey, type OfflineState, offlineVerdict, verifyManifestScope } from '@yayatoh/checkin-engine';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, type EventDto, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import { orderByManageToken, startCheckoutCommand } from '@yayatoh/orders';
import { recentEventsTx } from '@yayatoh/platform';
import { createRoomCommand, createSessionCommand, setSessionAgendaCommand } from '@yayatoh/program';
import {
  enrollSessionCommand,
  registrantsOfLinkTx,
  registrationSetupQuery,
  seedRegistrationDefaultsCommand,
  setCellCommand,
  setItemSessionsCommand,
  startRegistrationCommand,
} from '@yayatoh/registration';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M5.6a — session check-in: a session door's three gates (registered/enrolled, room capacity,
 * admission level) each with an audited override; scan in and out, dwell, duplicates; the offline
 * manifest v3 with signed session gates; 600 offline session scans syncing exactly once; the self
 * check-in flyer (attendance only); permissions and tenant isolation.
 */

let a: OrgFixture;
let b: OrgFixture;
let n = 0;
const H = 3_600_000;
const START = new Date('2030-09-14T14:00:00Z');
const at = (h: number) => new Date(START.getTime() + h * H);
const anon = (now?: Date, org = a): Ctx => createCtx({ orgId: org.org.id, ...(now ? { now } : {}) });
const sys = (org = a) => systemCtx(org.org.id);

interface Conf {
  ev: EventDto;
  member: string;
  fullPass: string;
  dayPass: string;
}

async function conference(org = a): Promise<Conf> {
  n += 1;
  const ev = await executeCommand(
    createEventCommand,
    {
      name: `Sessions ${n} ${org.org.slug}`,
      profile: 'conference',
      timezone: 'America/Chicago',
      startsAt: at(0),
      endsAt: at(10),
    },
    org.ctx(),
    ports,
  );
  await executeCommand(seedRegistrationDefaultsCommand, { eventId: ev.id, names: {} }, org.ctx(), ports);
  const setup = await executeQuery(registrationSetupQuery, { eventId: ev.id }, org.ctx(), ports);
  const member = setup.types.find((t) => t.key === 'member')?.id as string;
  const item = (key: string) => setup.items.find((i) => i.key === key)?.id as string;
  for (const key of ['full_pass', 'day_pass'])
    await executeCommand(
      setCellCommand,
      { eventId: ev.id, registrationTypeId: member, admissionItemId: item(key), priceMinor: 0 },
      org.ctx(),
      ports,
    );
  await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, org.ctx(), ports);
  return { ev, member, fullPass: item('full_pass'), dayPass: item('day_pass') };
}

async function session(
  c: Conf,
  title: string,
  h: number,
  opts: { capacity?: number | null; admission?: 'included' | 'optional'; roomCapacity?: number } = {},
  org = a,
) {
  const room =
    opts.roomCapacity !== undefined
      ? await executeCommand(
          createRoomCommand,
          { eventId: c.ev.id, name: `Room ${title}`, capacity: opts.roomCapacity },
          org.ctx(),
          ports,
        )
      : null;
  const res = await executeCommand(
    createSessionCommand,
    {
      eventId: c.ev.id,
      title,
      startsAt: at(h),
      endsAt: at(h + 1),
      capacity: opts.capacity === undefined ? null : opts.capacity,
      ...(room ? { roomId: room.id } : {}),
    },
    org.ctx(),
    ports,
  );
  await executeCommand(
    setSessionAgendaCommand,
    { eventId: c.ev.id, sessionId: res.session.id, admission: opts.admission ?? 'included', groupId: null },
    org.ctx(),
    ports,
  );
  return res.session;
}

interface Person {
  token: string;
  id: string;
  code: string;
}

async function registrant(c: Conf, items = [c.fullPass], org = a): Promise<Person> {
  n += 1;
  const r = await executeCommand(
    startRegistrationCommand,
    {
      eventId: c.ev.id,
      registrationTypeId: c.member,
      itemIds: items,
      buyer: { email: `door${n}@example.test`, name: `Door ${n}` },
    },
    anon(at(-72), org),
    ports,
  );
  const [reg] = await withTenant(sys(org), (tx) => registrantsOfLinkTx(tx, r.manageToken));
  if (!reg) throw new Error('no registrant');
  const [t] = await withTenant(sys(org), (tx) =>
    tx.execute<{ short_code: string }>(sql`select short_code from ticketing.tickets where id = ${reg.id}`),
  );
  return { token: r.manageToken, id: reg.id, code: t?.short_code ?? '' };
}

const enrol = (p: Person, sessionId: string) =>
  executeCommand(
    enrollSessionCommand,
    { token: p.token, registrantId: p.id, sessionId, choice: 'refuse' },
    anon(at(-72)),
    ports,
  );

async function door(
  c: Conf,
  sessionId: string,
  opts: { capacity?: number; selfCheckin?: boolean } = {},
  org = a,
) {
  n += 1;
  return executeCommand(
    createCheckpointCommand,
    {
      eventId: c.ev.id,
      name: `Door ${n}`,
      kind: 'session',
      sessionId,
      capacity: opts.capacity ?? null,
      selfCheckin: opts.selfCheckin ?? false,
    },
    org.ctx(),
    ports,
  );
}

const scan = (
  c: Conf,
  checkpointId: string,
  code: string,
  now: Date,
  direction: 'in' | 'out' = 'in',
  ctx?: Ctx,
) =>
  executeCommand(
    scanTicketCommand,
    { eventId: c.ev.id, code, checkpointId, direction },
    ctx ?? { ...a.ctx(), now },
    ports,
  );

const override = (
  c: Conf,
  checkpointId: string,
  code: string,
  gates: ('enrollment' | 'admission_level' | 'capacity')[],
  now: Date,
  ctx?: Ctx,
) =>
  executeCommand(
    admitSessionOverrideCommand,
    { eventId: c.ev.id, checkpointId, code, gates, reason: 'Speaker guest, approved by the chair' },
    ctx ?? { ...a.ctx(), now },
    ports,
  );

const visits = (sessionId: string, org = a) =>
  withTenant(sys(org), (tx) =>
    tx.execute<{ ticket_id: string; out_at: Date | null; source: string; override_gates: string[] }>(
      sql`select ticket_id, out_at, source, override_gates from checkin.session_attendance where session_id = ${sessionId} order by in_at`,
    ),
  );

const code = async (err: Promise<unknown>) => {
  try {
    await err;
    return 'ok';
  } catch (e) {
    return isDomainError(e)
      ? `${e.code}:${(e.details as { reason?: string } | undefined)?.reason ?? ''}`
      : String(e);
  }
};

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

describe('session doors: the three gates (M5.6a)', () => {
  it('a full room refuses with `capacity` and allows an audited override', async () => {
    const c = await conference();
    const s = await session(c, 'Small room talk', 1, { roomCapacity: 2 });
    const d = await door(c, s.id);
    const [p1, p2, p3] = [await registrant(c), await registrant(c), await registrant(c)];
    const now = at(1);
    expect((await scan(c, d.id, p1.code, now)).result).toBe('entered');
    expect((await scan(c, d.id, p2.code, now)).result).toBe('entered');
    const full = await scan(c, d.id, p3.code, now);
    expect(full.result).toBe('capacity');
    expect(full.ticket?.holderName).toMatch(/^Door /);
    const o = await override(c, d.id, p3.code, ['capacity'], now);
    expect(o.result).toBe('entered');
    const rows = await visits(s.id);
    expect(rows).toHaveLength(3);
    expect(rows.at(-1)).toMatchObject({ ticket_id: p3.id, source: 'override', override_gates: ['capacity'] });
    // The audit keeps the gates and the reason, on the ticket.
    const [audit] = await withTenant(sys(), (tx) =>
      tx.execute<{ action: string; target_id: string; data: { gates: string[]; reason: string } }>(
        sql`select action, target_id, data from platform.audit_events where action = 'checkin.session_override' and target_id = ${p3.id}`,
      ),
    );
    expect(audit?.data.gates).toEqual(['capacity']);
    expect(audit?.data.reason).toBe('Speaker guest, approved by the chair');
    // No event admission is recorded at a session door.
    const [adm] = await withTenant(sys(), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from checkin.admissions where event_id = ${c.ev.id}`,
      ),
    );
    expect(adm?.n).toBe(0);
    // The door's own number wins over the room's.
    const wide = await door(c, s.id, { capacity: 10 });
    const p4 = await registrant(c);
    expect((await scan(c, wide.id, p4.code, now)).result).toBe('entered');
  });

  it('enrollment: an optional session with a capacity needs a place; overrides waive only what is in the way', async () => {
    const c = await conference();
    const s = await session(c, 'Workshop', 2, { admission: 'optional', capacity: 5, roomCapacity: 1 });
    const d = await door(c, s.id);
    const enrolled = await registrant(c);
    const walkIn = await registrant(c);
    await enrol(enrolled, s.id);
    const now = at(2);
    expect((await scan(c, d.id, walkIn.code, now)).result).toBe('not_enrolled');
    expect((await scan(c, d.id, enrolled.code, now)).result).toBe('entered');
    // Waiving enrollment alone meets the full room next; both gates let them in.
    expect((await override(c, d.id, walkIn.code, ['enrollment'], now)).result).toBe('capacity');
    expect((await override(c, d.id, walkIn.code, ['enrollment', 'capacity'], now)).result).toBe('entered');
    const rows = await visits(s.id);
    expect(rows.at(-1)?.override_gates.sort()).toEqual(['capacity', 'enrollment']);
    // Someone already in: nothing to override.
    expect(await code(override(c, d.id, enrolled.code, ['capacity'], now))).toBe('ok');
    const o = await override(c, d.id, enrolled.code, ['capacity'], now);
    expect(o.result).toBe('duplicate');
  });

  it('nothing to override is refused; the event rules still apply', async () => {
    const c = await conference();
    const s = await session(c, 'Open talk', 1);
    const d = await door(c, s.id);
    const p = await registrant(c);
    expect(await code(override(c, d.id, p.code, ['capacity'], at(1)))).toBe(
      'invalid_state:nothing_to_override',
    );
    expect(await code(override(c, d.id, 'ZZZZZZZZ', ['capacity'], at(1)))).toBe('invalid_state:invalid');
    expect(await code(override(c, d.id, p.code, ['capacity'], at(30)))).toBe('invalid_state:outside_window');
  });

  it('admission level: a pass that does not give the session is refused; an override lets them in', async () => {
    const c = await conference();
    const keynote = await session(c, 'Keynote', 0);
    const deepDive = await session(c, 'Deep dive', 3);
    // The day pass gives the keynote only.
    await executeCommand(
      setItemSessionsCommand,
      { eventId: c.ev.id, admissionItemId: c.dayPass, sessionIds: [keynote.id] },
      a.ctx(),
      ports,
    );
    const day = await registrant(c, [c.dayPass]);
    const full = await registrant(c);
    const kd = await door(c, keynote.id);
    const dd = await door(c, deepDive.id);
    expect((await scan(c, kd.id, day.code, at(0))).result).toBe('entered');
    expect((await scan(c, dd.id, day.code, at(3))).result).toBe('admission_level');
    expect((await scan(c, dd.id, full.code, at(3))).result).toBe('entered');
    expect((await override(c, dd.id, day.code, ['admission_level'], at(3))).result).toBe('entered');
  });

  it('scan out closes the visit with its dwell; a second scan in is a duplicate; coming back is a new visit', async () => {
    const c = await conference();
    const s = await session(c, 'Long talk', 1);
    const d = await door(c, s.id);
    const p = await registrant(c);
    const first = await scan(c, d.id, p.code, at(1));
    expect(first.result).toBe('entered');
    const dup = await scan(c, d.id, p.code, new Date(at(1).getTime() + 60_000));
    expect(dup.result).toBe('duplicate');
    expect(dup.firstAdmittedAt?.toISOString()).toBe(at(1).toISOString());
    const out = await scan(c, d.id, p.code, new Date(at(1).getTime() + 25 * 60_000), 'out');
    expect(out).toMatchObject({ result: 'scanned_out', dwellMs: 25 * 60_000 });
    expect((await scan(c, d.id, p.code, new Date(at(1).getTime() + 26 * 60_000), 'out')).result).toBe(
      'not_in_room',
    );
    expect((await scan(c, d.id, p.code, new Date(at(1).getTime() + 30 * 60_000))).result).toBe('entered');
    await scan(c, d.id, p.code, new Date(at(1).getTime() + 35 * 60_000), 'out');
    const [row] = await executeQuery(sessionAttendanceQuery, { eventId: c.ev.id }, a.ctx(), ports);
    expect(row).toMatchObject({ attended: 1, inRoom: 0, avgDwellMs: 30 * 60_000, overrides: 0 });
    const events = await withTenant(sys(), (tx) =>
      recentEventsTx(tx, a.org.id, ['checkin.session_attended', 'checkin.session_left'], 24 * H),
    );
    const mine = events.filter((e) => (e.payload as { sessionId?: string }).sessionId === s.id);
    expect(mine.filter((e) => e.type === 'checkin.session_attended')).toHaveLength(2);
    expect(mine.filter((e) => e.type === 'checkin.session_left')).toHaveLength(2);
  });

  it('a session door must name a session of this event; only session doors have flyers', async () => {
    const c = await conference();
    const other = await conference();
    const s = await session(other, 'Elsewhere', 1);
    const mk = (input: Record<string, unknown>) =>
      code(
        executeCommand(
          createCheckpointCommand,
          { eventId: c.ev.id, name: `Bad ${++n}`, kind: 'session', ...input } as never,
          a.ctx(),
          ports,
        ),
      );
    expect(await mk({ sessionId: s.id })).toBe('validation_failed:');
    expect(await mk({})).toMatch(/^validation_failed/);
    expect(
      await code(
        executeCommand(
          createCheckpointCommand,
          { eventId: c.ev.id, name: 'Gate', kind: 'entrance', selfCheckin: true },
          a.ctx(),
          ports,
        ),
      ),
    ).toMatch(/^validation_failed/);
    const mine = await session(c, 'Mine', 1);
    const choices = await executeQuery(sessionDoorChoicesQuery, { eventId: c.ev.id }, a.ctx(), ports);
    expect(choices.map((x) => x.id)).toEqual([mine.id]);
    const d = await door(c, mine.id);
    const listed = await executeQuery(listCheckpointsQuery, { eventId: c.ev.id }, a.ctx(), ports);
    expect(listed.find((x) => x.id === d.id)).toMatchObject({
      kind: 'session',
      sessionId: mine.id,
      selfCheckin: false,
    });
  });

  it('a viewer can neither override nor set up doors; another org sees none of it', async () => {
    const c = await conference();
    const s = await session(c, 'Guarded', 1, { roomCapacity: 1 });
    const d = await door(c, s.id);
    const p = await registrant(c);
    const viewer = { ...userCtx(a.viewerId, a.org.id), now: at(1) };
    expect(await code(override(c, d.id, p.code, ['capacity'], at(1), viewer))).toMatch(/^forbidden/);
    expect(
      await code(
        executeCommand(
          setSelfCheckinCommand,
          { eventId: c.ev.id, checkpointId: d.id, enabled: true },
          viewer,
          ports,
        ),
      ),
    ).toMatch(/^forbidden/);
    // Org B: the door and its attendance are invisible (RLS), and B's tenant can't scan at it.
    await scan(c, d.id, p.code, at(1));
    expect(await executeQuery(sessionAttendanceQuery, { eventId: c.ev.id }, b.ctx(), ports)).toEqual([]);
    expect(await code(scan(c, d.id, p.code, at(1), 'in', { ...b.ctx(), now: at(1) }))).toMatch(/^not_found/);
    expect(await visits(s.id, b)).toEqual([]);
  });
});

describe('offline session doors (manifest v3)', () => {
  async function device(org = a) {
    const { token } = await executeCommand(
      enrollDeviceCommand,
      { label: `Session ${++n}` },
      org.ctx(),
      ports,
    );
    const dc = await deviceContext(token);
    if (!dc) throw new Error('device did not resolve');
    return (now: Date): Ctx => ({ ...dc.ctx, now });
  }

  async function manifest(c: Conf, ctx: Ctx): Promise<OfflineState> {
    const rows = [];
    let cursor: string | undefined;
    let header: OfflineState['header'] | undefined;
    for (;;) {
      const p = await executeQuery(deviceManifestQuery, { eventId: c.ev.id, cursor, limit: 500 }, ctx, ports);
      header = p.header;
      rows.push(...p.rows);
      cursor = p.cursor ?? undefined;
      if (p.complete) break;
    }
    if (!header) throw new Error('no header');
    return {
      header,
      byId: new Map(rows.map((r) => [r.ticketId, r])),
      byShortCode: new Map(rows.map((r) => [r.shortCode, r])),
      admitted: new Set(),
      lastSyncAt: new Date(header.serverTime),
    };
  }

  it('the manifest signs each session door’s gates; the device decides like the server', async () => {
    const c = await conference();
    const keynote = await session(c, 'Keynote', 0);
    const ws = await session(c, 'Workshop', 2, { admission: 'optional', capacity: 3, roomCapacity: 2 });
    await executeCommand(
      setItemSessionsCommand,
      { eventId: c.ev.id, admissionItemId: c.dayPass, sessionIds: [keynote.id] },
      a.ctx(),
      ports,
    );
    const enrolled = await registrant(c);
    const notEnrolled = await registrant(c);
    const day = await registrant(c, [c.dayPass]);
    await enrol(enrolled, ws.id);
    const kd = await door(c, keynote.id);
    const wd = await door(c, ws.id);
    const ctx = await device();
    const st = await manifest(c, ctx(at(2)));
    expect(st.header.version).toBe(3);
    expect(await verifyManifestScope(st.header)).toBe(true);
    const gate = st.header.scope?.sessionGates?.find((g) => g.checkpointId === wd.id);
    expect(gate).toEqual({
      checkpointId: wd.id,
      sessionId: ws.id,
      capacity: 2,
      enrollmentRequired: true,
      enrolled: [enrolled.id],
    });
    expect(st.header.sessions?.find((x) => x.checkpointId === wd.id)).toMatchObject({
      title: 'Workshop',
      occupied: 0,
    });
    expect(st.byId.get(day.id)?.sessionAccess).toEqual({ registrant: true, sessionIds: [keynote.id] });
    expect(st.byId.get(enrolled.id)?.sessionAccess).toEqual({ registrant: true, sessionIds: null });
    const v = async (p: Person, cp: string, extra: Partial<OfflineState> = {}) =>
      (await offlineVerdict({ ...st, ...extra }, p.code, at(2), cp)).verdict;
    expect(await v(enrolled, wd.id)).toBe('entered');
    expect(await v(notEnrolled, wd.id)).toBe('not_enrolled');
    expect(await v(day, kd.id)).toBe('entered');
    expect(await v(enrolled, wd.id, { occupancy: new Map([[ws.id, 2]]) })).toBe('capacity');
    expect(await v(enrolled, wd.id, { inRoom: new Set([inRoomKey(enrolled.id, ws.id)]) })).toBe('duplicate');
    // A widened gate no longer verifies: the device refuses the manifest.
    const tampered = {
      ...st.header,
      scope: { ...st.header.scope, sessionGates: [{ ...gate, capacity: 99 }] },
    } as typeof st.header;
    expect(await verifyManifestScope(tampered)).toBe(false);
  });

  it('600 offline session scans sync exactly once (retries and racing batches included)', async () => {
    // A plain ticketed event (no registration): every pass is registered and given every session.
    n += 1;
    const ev = await executeCommand(
      createEventCommand,
      { name: `Offline sessions ${n}`, timezone: 'America/Chicago', startsAt: at(0), endsAt: at(10) },
      a.ctx(),
      ports,
    );
    const c: Conf = { ev, member: '', fullPass: '', dayPass: '' };
    const tt = await executeCommand(
      createTicketTypeCommand,
      { eventId: ev.id, name: 'GA', priceMinor: 0, quantityTotal: 200, maxPerOrder: 50 },
      a.ctx(),
      ports,
    );
    await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, a.ctx(), ports);
    const codes: string[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await executeCommand(
        startCheckoutCommand,
        {
          eventId: ev.id,
          items: [{ ticketTypeId: tt.id, quantity: 50 }],
          buyer: { email: `bulk${i}@example.test`, name: 'Bulk' },
        },
        createCtx({ orgId: a.org.id }),
        ports,
      );
      codes.push(...((await orderByManageToken(r.manageToken))?.tickets ?? []).map((t) => t.shortCode));
    }
    expect(codes).toHaveLength(100);
    const s = await session(c, 'Big hall', 1);
    const d = await door(c, s.id);
    const ctx = await device();
    // 100 people, three visits each: in, out, in, out, in, out = 600 scans, a second apart.
    const scans: {
      scanId: string;
      code: string;
      deviceTs: Date;
      clockOffsetMs: number;
      verdict: 'entered' | 'scanned_out';
      checkpointId: string;
      direction: 'in' | 'out';
    }[] = [];
    let t = at(1).getTime();
    const tick = () => {
      t += 1000;
      return t;
    };
    for (let round = 0; round < 3; round++)
      for (const dir of ['in', 'out'] as const)
        for (const cd of codes)
          scans.push({
            scanId: uuidv7(),
            code: cd,
            deviceTs: new Date(tick()),
            clockOffsetMs: 0,
            verdict: dir === 'in' ? ('entered' as const) : ('scanned_out' as const),
            checkpointId: d.id,
            direction: dir,
          });
    expect(scans).toHaveLength(600);
    const first = scans.slice(0, 500);
    const second = scans.slice(500);
    const sync = (batch: typeof scans) =>
      executeCommand(syncScansCommand, { eventId: ev.id, scans: batch }, ctx(at(3)), ports);
    // The first batch races itself (a retry while the first attempt is in flight).
    const [r1, r1again] = await Promise.all([sync(first), sync(first)]);
    const r2 = await sync(second);
    const stored = [...r1.results, ...r1again.results, ...r2.results].filter((r) => r.stored);
    expect(stored).toHaveLength(600);
    expect([...r1.results, ...r2.results].every((r) => ['entered', 'scanned_out'].includes(r.result))).toBe(
      true,
    );
    // A full retry later changes nothing.
    const again = [...(await sync(first)).results, ...(await sync(second)).results];
    expect(again.every((r) => !r.stored)).toBe(true);
    const [counts] = await withTenant(sys(), (tx) =>
      tx.execute<{ visits: number; open: number; scans: number; people: number }>(sql`
        select (select count(*)::int from checkin.session_attendance where session_id = ${s.id}) as visits,
          (select count(*)::int from checkin.session_attendance where session_id = ${s.id} and out_at is null) as open,
          (select count(*)::int from checkin.scans where checkpoint_id = ${d.id}) as scans,
          (select count(distinct ticket_id)::int from checkin.session_attendance where session_id = ${s.id}) as people`),
    );
    expect(counts).toEqual({ visits: 300, open: 0, scans: 600, people: 100 });
    const [row] = await executeQuery(sessionAttendanceQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(row).toMatchObject({ attended: 100, inRoom: 0 });
    // Each person spent 3 × 100 s in the room (out scans come 100 s after the ins).
    expect(row?.avgDwellMs).toBe(300_000);
  }, 180_000);

  it('offline: the device’s capacity refusal stands; its admit past a full room is kept (people are in)', async () => {
    const c = await conference();
    const s = await session(c, 'Tiny', 1, { roomCapacity: 1 });
    const d = await door(c, s.id);
    const [p1, p2, p3] = [await registrant(c), await registrant(c), await registrant(c)];
    const ctx = await device();
    const mk = (p: Person, verdict: 'entered' | 'capacity', sec: number) => ({
      scanId: uuidv7(),
      code: p.code,
      deviceTs: new Date(at(1).getTime() + sec * 1000),
      clockOffsetMs: 0,
      verdict,
      checkpointId: d.id,
    });
    const r = await executeCommand(
      syncScansCommand,
      { eventId: c.ev.id, scans: [mk(p1, 'entered', 1), mk(p2, 'entered', 2), mk(p3, 'capacity', 3)] },
      ctx(at(2)),
      ports,
    );
    expect(r.results.map((x) => x.result)).toEqual(['entered', 'entered', 'capacity']);
    // A device that refused someone the server would let in (enrolled since the last manifest)
    // let nobody in: no visit is recorded, its refusal stands.
    const p4 = await registrant(c);
    const r2 = await executeCommand(
      syncScansCommand,
      {
        eventId: c.ev.id,
        scans: [{ ...mk(p4, 'entered', 4), verdict: 'not_enrolled' as const }],
      },
      ctx(at(2)),
      ports,
    );
    expect(r2.results.map((x) => x.result)).toEqual(['not_enrolled']);
    expect((await visits(s.id)).map((v) => v.ticket_id)).toEqual([p1.id, p2.id]);
  });
});

describe('self check-in flyers (attendance only)', () => {
  it('the flyer token finds its door; attendees check themselves in once; no gates, no seat', async () => {
    const c = await conference();
    const s = await session(c, 'Flyer talk', 1, { admission: 'optional', capacity: 5, roomCapacity: 1 });
    const d = await door(c, s.id, { selfCheckin: true });
    const [cp] = (await executeQuery(sessionAttendanceQuery, { eventId: c.ev.id }, a.ctx(), ports)).filter(
      (x) => x.checkpointId === d.id,
    );
    const token = cp?.selfCheckinToken as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await selfCheckinDoor(token)).toEqual({ orgId: a.org.id, checkpointId: d.id });
    expect(await selfCheckinDoor('x'.repeat(32))).toBeNull();
    const page = await executeQuery(selfCheckinPageQuery, { token }, anon(at(1)), ports);
    expect(page).toMatchObject({ title: 'Flyer talk', open: true });
    expect(Object.keys(page).sort()).toEqual([
      'endsAt',
      'eventName',
      'open',
      'roomName',
      'startsAt',
      'timezone',
      'title',
    ]);
    const p = await registrant(c); // not enrolled: the flyer doesn't gate
    const p2 = await registrant(c);
    const self = (cd: string, now = at(1)) =>
      executeCommand(selfCheckInCommand, { token, code: cd }, anon(now), ports);
    expect((await self(p.code)).result).toBe('entered');
    expect((await self(p.code)).result).toBe('duplicate');
    expect((await self(p2.code)).result).toBe('entered'); // the room (1) is not held by flyer check-ins
    expect((await self('ZZZZZZZZ')).result).toBe('not_found');
    expect((await self(p2.code, at(-2))).result).toBe('closed');
    const [row] = (await executeQuery(sessionAttendanceQuery, { eventId: c.ev.id }, a.ctx(), ports)).filter(
      (x) => x.checkpointId === d.id,
    );
    expect(row).toMatchObject({ attended: 2, selfCheckins: 2, inRoom: 0 });
    // Turning it off (or on again: a new token) retires the printed flyer.
    await executeCommand(
      setSelfCheckinCommand,
      { eventId: c.ev.id, checkpointId: d.id, enabled: true },
      a.ctx(),
      ports,
    );
    expect(await selfCheckinDoor(token)).toBeNull();
    // Another org's tenant can't use the token.
    expect(await code(executeQuery(selfCheckinPageQuery, { token }, anon(at(1), b), ports))).toMatch(
      /^not_found/,
    );
  });
});
