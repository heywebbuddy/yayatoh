import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  addOccurrencesCommand,
  createEventCommand,
  type EventDto,
  pageTarget,
  transitionEventCommand,
} from '@yayatoh/events';
import { executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  addStandardSessionTypesCommand,
  agendaImportPreviewQuery,
  agendaQuery,
  claimSessionPlaceTx,
  createRoomCommand,
  createSessionCommand,
  createSessionGroupCommand,
  createSessionTypeCommand,
  createSpeakerCommand,
  deleteSessionGroupCommand,
  deleteSessionTypeCommand,
  importAgendaCommand,
  programQuery,
  publicProgram,
  publicSpeaker,
  publishAgendaCommand,
  recordGroupPickTx,
  releaseGroupPickTx,
  releaseSessionPlaceTx,
  setSessionAgendaCommand,
  unpublishAgendaCommand,
  updateSessionCommand,
} from '@yayatoh/program';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;

const H = 3_600_000;

async function newEvent(name: string, org = a): Promise<EventDto> {
  return executeCommand(
    createEventCommand,
    {
      name: `${name} ${org.org.slug}`,
      profile: 'conference',
      timezone: 'America/Chicago',
      startsAt: '2030-05-01T14:00:00Z',
      endsAt: '2030-05-02T23:00:00Z',
    },
    org.ctx(),
    ports,
  );
}

const at = (ev: EventDto, h: number) => new Date(ev.startsAt.getTime() + h * H);

async function session(ev: EventDto, title: string, h: number, extra: Record<string, unknown> = {}) {
  const res = await executeCommand(
    createSessionCommand,
    { eventId: ev.id, title, startsAt: at(ev, h), endsAt: at(ev, h + 1), ...extra },
    a.ctx(),
    ports,
  );
  return res.session;
}

const inTx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(systemCtx(a.org.id), fn);

const enrolledOf = async (sessionId: string) =>
  (
    await inTx((tx) =>
      tx.execute<{ enrolled: number; capacity: number | null }>(
        sql`select enrolled, capacity from program.session_details where session_id = ${sessionId}`,
      ),
    )
  )[0];

const outbox = (type: string, aggregateId: string) =>
  inTx((tx) =>
    tx.execute<{ n: number }>(
      sql`select count(*)::int as n from platform.domain_events where type = ${type} and aggregate_id = ${aggregateId}`,
    ),
  ).then((r) => r[0]?.n ?? 0);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});

afterAll(async () => {
  await closePools();
});

describe('agenda v2: session types, included/optional, pick-one groups (M5.2a)', () => {
  it('manages session types: standard set in one go (idempotent), names unique per event, delete keeps sessions', async () => {
    const ev = await newEvent('Types');
    const names = ['Keynote', 'Talk', 'Workshop', 'Panel', 'Break'];
    expect(
      await executeCommand(addStandardSessionTypesCommand, { eventId: ev.id, names }, a.ctx(), ports),
    ).toEqual({ added: 5 });
    expect(
      await executeCommand(addStandardSessionTypesCommand, { eventId: ev.id, names }, a.ctx(), ports),
    ).toEqual({ added: 0 });
    await expect(
      executeCommand(createSessionTypeCommand, { eventId: ev.id, name: 'WORKSHOP' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'conflict', details: { field: 'name' } });
    const lab = await executeCommand(
      createSessionTypeCommand,
      { eventId: ev.id, name: 'Lab' },
      a.ctx(),
      ports,
    );
    const agenda = await executeQuery(agendaQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(agenda.types.map((t) => t.name)).toEqual([...names, 'Lab']);
    const s = await session(ev, 'Hack lab', 1);
    await executeCommand(
      setSessionAgendaCommand,
      { eventId: ev.id, sessionId: s.id, typeId: lab.id },
      a.ctx(),
      ports,
    );
    await executeCommand(deleteSessionTypeCommand, { eventId: ev.id, typeId: lab.id }, a.ctx(), ports);
    const after = await executeQuery(agendaQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(after.sessions.find((x) => x.sessionId === s.id)).toMatchObject({ typeId: null });
    // A type of another event is unknown here.
    const other = await newEvent('Types other');
    const foreign = await executeCommand(
      createSessionTypeCommand,
      { eventId: other.id, name: 'Talk' },
      a.ctx(),
      ports,
    );
    await expect(
      executeCommand(
        setSessionAgendaCommand,
        { eventId: ev.id, sessionId: s.id, typeId: foreign.id },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { field: 'typeId', reason: 'unknown' } });
  });

  it('every session is included by default; only optional sessions join a group', async () => {
    const ev = await newEvent('Groups');
    const s1 = await session(ev, 'Workshop A', 1, { capacity: 30 });
    const s2 = await session(ev, 'Workshop B', 1, { capacity: 30 });
    const group = await executeCommand(
      createSessionGroupCommand,
      { eventId: ev.id, name: 'Afternoon pick' },
      a.ctx(),
      ports,
    );
    const agenda = await executeQuery(agendaQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(agenda.sessions.map((x) => [x.admission, x.enrolled, x.capacity, x.enrollmentOpen])).toEqual([
      ['included', 0, 30, true],
      ['included', 0, 30, true],
    ]);
    await expect(
      executeCommand(
        setSessionAgendaCommand,
        { eventId: ev.id, sessionId: s1.id, admission: 'included', groupId: group.id },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { field: 'groupId', reason: 'group_needs_optional' } });
    for (const s of [s1, s2])
      await executeCommand(
        setSessionAgendaCommand,
        { eventId: ev.id, sessionId: s.id, admission: 'optional', groupId: group.id },
        a.ctx(),
        ports,
      );
    const grouped = await executeQuery(agendaQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(grouped.groups).toEqual([
      expect.objectContaining({ name: 'Afternoon pick', sessionIds: [s1.id, s2.id].sort(), picks: 0 }),
    ]);
    // The database also refuses an included session in a group.
    await expect(
      inTx((tx) =>
        tx.execute(
          sql`update program.session_details set admission = 'included' where session_id = ${s1.id}`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  });

  it('warns (never blocks) when a room is smaller than the session capacity', async () => {
    const ev = await newEvent('Rooms');
    const room = await executeCommand(
      createRoomCommand,
      { eventId: ev.id, name: 'Seminar room', capacity: 40 },
      a.ctx(),
      ports,
    );
    const big = await session(ev, 'Popular talk', 1, { roomId: room.id, capacity: 60 });
    const small = await session(ev, 'Small talk', 3, { roomId: room.id, capacity: 40 });
    const agenda = await executeQuery(agendaQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(agenda.warnings).toEqual([
      {
        kind: 'room_too_small',
        sessionId: big.id,
        roomId: room.id,
        groupId: null,
        roomCapacity: 40,
        sessionCapacity: 60,
      },
    ]);
    const res = await executeCommand(
      setSessionAgendaCommand,
      { eventId: ev.id, sessionId: big.id, admission: 'optional' },
      a.ctx(),
      ports,
    );
    expect(res.agenda.admission).toBe('optional');
    expect(res.warnings.map((w) => w.kind)).toEqual(['room_too_small']);
    // Fixing the capacity clears it.
    await executeCommand(
      updateSessionCommand,
      {
        eventId: ev.id,
        sessionId: big.id,
        title: 'Popular talk',
        startsAt: at(ev, 1),
        endsAt: at(ev, 2),
        roomId: room.id,
        capacity: 40,
      },
      a.ctx(),
      ports,
    );
    expect((await executeQuery(agendaQuery, { eventId: ev.id }, a.ctx(), ports)).warnings).toEqual([]);
    expect(small.id).toBeTruthy();
  });
});

describe('agenda v2: capacity counter (M5.2a, claimed by M5.2b)', () => {
  it('concurrent claims never exceed the capacity; the CHECK refuses enrolled > capacity', async () => {
    const ev = await newEvent('Counter');
    const s = await session(ev, 'Limited workshop', 1, { capacity: 5 });
    await executeCommand(
      setSessionAgendaCommand,
      { eventId: ev.id, sessionId: s.id, admission: 'optional' },
      a.ctx(),
      ports,
    );
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, () => inTx((tx) => claimSessionPlaceTx(tx, s.id))),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(refused).toHaveLength(20);
    for (const r of refused)
      expect(r.reason).toMatchObject({ code: 'conflict', details: { reason: 'full' } });
    expect(await enrolledOf(s.id)).toEqual({ enrolled: 5, capacity: 5 });

    // Unguarded increments racing past the capacity: the CHECK stops every one of them.
    await inTx((tx) => releaseSessionPlaceTx(tx, s.id));
    await inTx((tx) => releaseSessionPlaceTx(tx, s.id));
    const raw = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        inTx((tx) =>
          tx.execute(
            sql`update program.session_details set enrolled = enrolled + 1 where session_id = ${s.id}`,
          ),
        ),
      ),
    );
    expect(raw.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    for (const r of raw.filter((x): x is PromiseRejectedResult => x.status === 'rejected'))
      expect(r.reason).toMatchObject({
        cause: { code: '23514', constraint_name: 'session_details_enrolled_check' },
      });
    expect(await enrolledOf(s.id)).toEqual({ enrolled: 5, capacity: 5 });
    // Lowering the session's capacity below the places held fails the same CHECK.
    await expect(
      executeCommand(
        updateSessionCommand,
        {
          eventId: ev.id,
          sessionId: s.id,
          title: 'Limited workshop',
          startsAt: at(ev, 1),
          endsAt: at(ev, 2),
          capacity: 3,
        },
        a.ctx(),
        ports,
      ),
    ).rejects.toBeTruthy();
    // Releasing never goes below zero.
    for (let i = 0; i < 7; i++) await inTx((tx) => releaseSessionPlaceTx(tx, s.id));
    expect(await enrolledOf(s.id)).toEqual({ enrolled: 0, capacity: 5 });
  });

  it('refuses claims for included sessions and when the organizer closed enrollment', async () => {
    const ev = await newEvent('Closed');
    const s = await session(ev, 'Plenary', 1, { capacity: 100 });
    await expect(inTx((tx) => claimSessionPlaceTx(tx, s.id))).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'included' },
    });
    await executeCommand(
      setSessionAgendaCommand,
      { eventId: ev.id, sessionId: s.id, admission: 'optional', enrollmentOpen: false },
      a.ctx(),
      ports,
    );
    await expect(inTx((tx) => claimSessionPlaceTx(tx, s.id))).rejects.toMatchObject({
      details: { reason: 'closed' },
    });
    await executeCommand(
      setSessionAgendaCommand,
      { eventId: ev.id, sessionId: s.id, admission: 'optional', enrollmentOpen: true },
      a.ctx(),
      ports,
    );
    await inTx((tx) => claimSessionPlaceTx(tx, s.id));
    // With a place held, the session can't become included.
    await expect(
      executeCommand(
        setSessionAgendaCommand,
        { eventId: ev.id, sessionId: s.id, admission: 'included' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'has_enrollments' } });
    // Another org can't claim it (RLS: not found).
    await expect(
      withTenant(systemCtx(b.org.id), (tx) => claimSessionPlaceTx(tx, s.id)),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('the database allows one pick per registrant and group, and only sessions of that group', async () => {
    const ev = await newEvent('Picks');
    const g = await executeCommand(
      createSessionGroupCommand,
      { eventId: ev.id, name: 'Pick' },
      a.ctx(),
      ports,
    );
    const [w1, w2, outside] = [
      await session(ev, 'W1', 1),
      await session(ev, 'W2', 1),
      await session(ev, 'Not grouped', 1),
    ];
    for (const s of [w1, w2])
      await executeCommand(
        setSessionAgendaCommand,
        { eventId: ev.id, sessionId: s.id, admission: 'optional', groupId: g.id },
        a.ctx(),
        ports,
      );
    const registrantId = uuidv7();
    await inTx((tx) =>
      recordGroupPickTx(tx, systemCtx(a.org.id), { groupId: g.id, sessionId: w1.id, registrantId }),
    );
    await expect(
      inTx((tx) =>
        recordGroupPickTx(tx, systemCtx(a.org.id), { groupId: g.id, sessionId: w2.id, registrantId }),
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'one_per_group' } });
    await expect(
      inTx((tx) =>
        recordGroupPickTx(tx, systemCtx(a.org.id), {
          groupId: g.id,
          sessionId: outside.id,
          registrantId: uuidv7(),
        }),
      ),
    ).rejects.toMatchObject({ details: { reason: 'not_in_group' } });
    // Raw inserts hit the same guards (unique key, composite key into the group).
    await expect(
      inTx((tx) =>
        tx.execute(
          sql`insert into program.session_group_picks (org_id, group_id, session_id, registrant_id) values (${a.org.id}, ${g.id}, ${w2.id}, ${registrantId})`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
    await expect(
      inTx((tx) =>
        tx.execute(
          sql`insert into program.session_group_picks (org_id, group_id, session_id, registrant_id) values (${a.org.id}, ${g.id}, ${outside.id}, ${uuidv7()})`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
    // Picks pin the group: it can't be deleted and its sessions can't leave it.
    await expect(
      executeCommand(deleteSessionGroupCommand, { eventId: ev.id, groupId: g.id }, a.ctx(), ports),
    ).rejects.toMatchObject({ details: { reason: 'group_in_use' } });
    await expect(
      executeCommand(
        setSessionAgendaCommand,
        { eventId: ev.id, sessionId: w1.id, admission: 'optional', groupId: null },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'has_enrollments' } });
    expect((await executeQuery(agendaQuery, { eventId: ev.id }, a.ctx(), ports)).groups[0]?.picks).toBe(1);
    // Released, a different pick is fine and the group can go (its sessions stay, ungrouped).
    await inTx((tx) => releaseGroupPickTx(tx, { groupId: g.id, registrantId }));
    await inTx((tx) =>
      recordGroupPickTx(tx, systemCtx(a.org.id), { groupId: g.id, sessionId: w2.id, registrantId }),
    );
    await inTx((tx) => releaseGroupPickTx(tx, { groupId: g.id, registrantId }));
    await executeCommand(deleteSessionGroupCommand, { eventId: ev.id, groupId: g.id }, a.ctx(), ports);
    const after = await executeQuery(agendaQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(after.groups).toEqual([]);
    expect(after.sessions.every((s) => s.groupId === null)).toBe(true);
  });
});

describe('agenda v2: publishing states (M5.2a)', () => {
  it('live → draft → published → changed; the public agenda serves only the published snapshot', async () => {
    const ev = await newEvent('Publish');
    await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, a.ctx(), ports);
    const target = await pageTarget(ev.slug);
    if (!target) throw new Error('no page');
    const speaker = await executeCommand(
      createSpeakerCommand,
      { eventId: ev.id, name: 'Ada' },
      a.ctx(),
      ports,
    );
    const type = await executeCommand(
      createSessionTypeCommand,
      { eventId: ev.id, name: 'Keynote' },
      a.ctx(),
      ports,
    );
    const s = await session(ev, 'Opening', 1, { speakerIds: [speaker.id], capacity: 500 });
    await executeCommand(
      setSessionAgendaCommand,
      { eventId: ev.id, sessionId: s.id, typeId: type.id },
      a.ctx(),
      ports,
    );
    const state = async () =>
      (await executeQuery(agendaQuery, { eventId: ev.id }, a.ctx(), ports)).publication;

    // Live (M1.4f behaviour): every change is public at once.
    expect(await state()).toEqual({ state: 'live', version: 0, publishedAt: null, publishedSessions: null });
    expect((await publicProgram(target)).sessions.map((x) => [x.title, x.type, x.admission])).toEqual([
      ['Opening', 'Keynote', 'included'],
    ]);
    // Draft: nothing public.
    expect((await executeCommand(unpublishAgendaCommand, { eventId: ev.id }, a.ctx(), ports)).state).toBe(
      'draft',
    );
    expect((await publicProgram(target)).sessions).toEqual([]);
    expect(await publicSpeaker(target, speaker.id)).toMatchObject({ sessions: [] });
    // Published: the snapshot, with the outbox event.
    const pub = await executeCommand(publishAgendaCommand, { eventId: ev.id }, a.ctx(), ports);
    expect(pub).toMatchObject({ state: 'published', version: 1, publishedSessions: 1 });
    expect(await outbox('program.agenda.published', ev.id)).toBe(1);
    const published = await publicProgram(target);
    expect(published.sessions.map((x) => x.title)).toEqual(['Opening']);
    expect(published.sessions[0]?.startsAt).toEqual(s.startsAt);
    expect(JSON.stringify(published)).not.toContain('capacity');
    // Publishing an unchanged agenda again: no new version, no second event.
    expect((await executeCommand(publishAgendaCommand, { eventId: ev.id }, a.ctx(), ports)).version).toBe(1);
    expect(await outbox('program.agenda.published', ev.id)).toBe(1);

    // A change: the console says "changed since publish"; the public still sees the snapshot.
    await executeCommand(
      updateSessionCommand,
      {
        eventId: ev.id,
        sessionId: s.id,
        title: 'Opening keynote',
        startsAt: at(ev, 1),
        endsAt: at(ev, 2),
        speakerIds: [speaker.id],
      },
      a.ctx(),
      ports,
    );
    await session(ev, 'Unannounced', 5);
    expect((await state()).state).toBe('changed');
    expect((await publicProgram(target)).sessions.map((x) => x.title)).toEqual(['Opening']);
    expect((await publicSpeaker(target, speaker.id))?.sessions.map((x) => x.title)).toEqual(['Opening']);
    // Publish again: the new agenda, version 2, a second event with the version in its payload.
    expect(await executeCommand(publishAgendaCommand, { eventId: ev.id }, a.ctx(), ports)).toMatchObject({
      state: 'published',
      version: 2,
      publishedSessions: 2,
    });
    expect((await publicProgram(target)).sessions.map((x) => x.title)).toEqual([
      'Opening keynote',
      'Unannounced',
    ]);
    const events = await inTx((tx) =>
      tx.execute<{ version: number; payload: { version: number; sessions: number; eventId: string } }>(
        sql`select version, payload from platform.domain_events where type = 'program.agenda.published' and aggregate_id = ${ev.id} order by created_at`,
      ),
    );
    expect(events.map((e) => [e.version, e.payload.version, e.payload.sessions, e.payload.eventId])).toEqual([
      [1, 1, 1, ev.id],
      [1, 2, 2, ev.id],
    ]);
  });
});

describe('agenda v2: CSV import (M5.2a)', () => {
  const header = 'key,title,starts,ends,type,admission,capacity,room,track,group,speakers,description';
  const file = [
    header,
    'K-1,Opening keynote,2030-05-01 09:00,2030-05-01 10:00,Keynote,included,,Main hall,,,Ada Lovelace <ada@import.test>,Welcome **all**.',
    'W-1,Workshop A,2030-05-01 10:30,2030-05-01 12:00,Workshop,optional,40,Room B,Build,Morning pick,ada@import.test; Grace Hopper <grace@import.test>,',
    'W-2,Workshop B,2030-05-01 10:30,2030-05-01 12:00,Workshop,optional,40,Room C,Build,Morning pick,,',
    ',=HYPERLINK("http://evil.test"),2030-05-01 13:00,2030-05-01 14:00,,,,,,,,',
    ',Lunch,2030-05-01 12:00,2030-05-01 13:00,Break,,,,,,,',
  ].join('\n');

  it('a dry run reports each row and writes nothing', async () => {
    const ev = await newEvent('Import dry');
    const res = await executeQuery(agendaImportPreviewQuery, { eventId: ev.id, csv: file }, a.ctx(), ports);
    expect(res.rows.map((r) => [r.line, r.action, r.errors])).toEqual([
      [2, 'create', []],
      [3, 'create', []],
      [4, 'create', []],
      [5, 'error', ['formula']],
      [6, 'create', []],
    ]);
    expect(res).toMatchObject({ applied: false, created: 4, failed: 1 });
    const program = await executeQuery(programQuery, { eventId: ev.id }, a.ctx(), ports);
    expect([program.sessions.length, program.rooms.length, program.speakers.length]).toEqual([0, 0, 0]);
  });

  it('applies: times in the event timezone, names and speakers created; re-running the same file changes nothing', async () => {
    const ev = await newEvent('Import apply');
    // A speaker added in the console (no email): the file's name picks them up.
    await executeCommand(createSpeakerCommand, { eventId: ev.id, name: 'Grace Hopper' }, a.ctx(), ports);
    const first = await executeCommand(importAgendaCommand, { eventId: ev.id, csv: file }, a.ctx(), ports);
    expect(first).toMatchObject({ applied: true, created: 4, updated: 0, unchanged: 0, failed: 1 });
    const program = await executeQuery(programQuery, { eventId: ev.id }, a.ctx(), ports);
    const agenda = await executeQuery(agendaQuery, { eventId: ev.id }, a.ctx(), ports);
    const opening = program.sessions.find((s) => s.title === 'Opening keynote');
    expect(opening?.startsAt.toISOString()).toBe('2030-05-01T14:00:00.000Z');
    expect(opening?.description).toBe('Welcome **all**.');
    expect(program.rooms.map((r) => r.name).sort()).toEqual(['Main hall', 'Room B', 'Room C']);
    expect(program.tracks.map((r) => r.name)).toEqual(['Build']);
    expect(program.speakers.map((p) => p.name).sort()).toEqual(['Ada Lovelace', 'Grace Hopper']);
    expect(agenda.types.map((t) => t.name).sort()).toEqual(['Break', 'Keynote', 'Workshop']);
    expect(agenda.groups).toEqual([expect.objectContaining({ name: 'Morning pick' })]);
    expect(agenda.groups[0]?.sessionIds).toHaveLength(2);
    const workshop = program.sessions.find((s) => s.title === 'Workshop A');
    expect(workshop?.speakerIds).toHaveLength(2);
    expect(agenda.sessions.find((d) => d.sessionId === workshop?.id)).toMatchObject({
      admission: 'optional',
      capacity: 40,
    });

    const snapshot = async () =>
      inTx((tx) =>
        tx.execute<{ t: string; n: number; changed: string }>(sql`
          select t, count(*)::int as n, max(updated_at)::text as changed from (
            select 'sessions' as t, updated_at from program.sessions where event_id = ${ev.id}
            union all select 'details', updated_at from program.session_details where event_id = ${ev.id}
            union all select 'rooms', updated_at from program.rooms where event_id = ${ev.id}
            union all select 'speakers', updated_at from program.speakers where event_id = ${ev.id}
            union all select 'contacts', updated_at from program.speaker_contacts where event_id = ${ev.id}
            union all select 'types', updated_at from program.session_types where event_id = ${ev.id}
            union all select 'groups', updated_at from program.session_groups where event_id = ${ev.id}
          ) x group by t order by t`),
      );
    const before = await snapshot();
    const again = await executeCommand(importAgendaCommand, { eventId: ev.id, csv: file }, a.ctx(), ports);
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 4, failed: 1 });
    expect(await snapshot()).toEqual(before);

    // An edited row updates just that session (matched by key).
    const edited = file.replace(
      'W-2,Workshop B,2030-05-01 10:30',
      'W-2,Workshop B (repeat),2030-05-01 10:30',
    );
    const third = await executeCommand(importAgendaCommand, { eventId: ev.id, csv: edited }, a.ctx(), ports);
    expect(third).toMatchObject({ created: 0, updated: 1, unchanged: 3 });
    const titles = (await executeQuery(programQuery, { eventId: ev.id }, a.ctx(), ports)).sessions.map(
      (s) => s.title,
    );
    expect(titles).toContain('Workshop B (repeat)');
    expect(titles).toHaveLength(4);
  });

  it('refuses unreadable files and files without the required columns', async () => {
    const ev = await newEvent('Import bad');
    await expect(
      executeQuery(agendaImportPreviewQuery, { eventId: ev.id, csv: 'title,room\nA,B' }, a.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'missing_columns', columns: ['starts', 'ends'] },
    });
    await expect(
      executeQuery(
        agendaImportPreviewQuery,
        { eventId: ev.id, csv: `${header}\n"unterminated` },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'unterminated_quote' } });
    await expect(
      executeQuery(agendaImportPreviewQuery, { eventId: ev.id, csv: header }, a.ctx(), ports),
    ).rejects.toMatchObject({ details: { reason: 'empty' } });
  });

  it('keeps a session inside its date on a multi-date event', async () => {
    const ev = await newEvent('Import dates');
    const [date] = await executeCommand(
      addOccurrencesCommand,
      { eventId: ev.id, dates: [{ startsAt: '2030-05-01T14:00:00Z', endsAt: '2030-05-01T18:00:00Z' }] },
      a.ctx(),
      ports,
    );
    if (!date) throw new Error('no date');
    const row = (from: string, to: string) => `key,title,starts,ends\nD-1,Dated talk,${from},${to}`;
    await executeCommand(
      importAgendaCommand,
      { eventId: ev.id, csv: row('2030-05-01 09:00', '2030-05-01 10:00') },
      a.ctx(),
      ports,
    );
    const [s] = (await executeQuery(programQuery, { eventId: ev.id }, a.ctx(), ports)).sessions;
    if (!s) throw new Error('no session');
    await executeCommand(
      updateSessionCommand,
      {
        eventId: ev.id,
        sessionId: s.id,
        title: s.title,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        occurrenceId: date.id,
      },
      a.ctx(),
      ports,
    );
    // 12:30–13:30 Chicago runs past the date's end (13:00): refused for that row.
    const res = await executeQuery(
      agendaImportPreviewQuery,
      { eventId: ev.id, csv: row('2030-05-01 12:30', '2030-05-01 13:30') },
      a.ctx(),
      ports,
    );
    expect(res.rows).toEqual([{ line: 2, action: 'error', title: 'Dated talk', errors: ['outside_date'] }]);
    const inside = await executeQuery(
      agendaImportPreviewQuery,
      { eventId: ev.id, csv: row('2030-05-01 11:00', '2030-05-01 12:00') },
      a.ctx(),
      ports,
    );
    expect(inside.rows.map((r) => r.action)).toEqual(['update']);
  });
});

describe('agenda v2: permissions and isolation (M5.2a)', () => {
  it('a viewer reads the agenda but every write is refused', async () => {
    const ev = await newEvent('Viewer');
    const s = await session(ev, 'Talk', 1);
    const g = await executeCommand(createSessionGroupCommand, { eventId: ev.id, name: 'G' }, a.ctx(), ports);
    const t = await executeCommand(createSessionTypeCommand, { eventId: ev.id, name: 'T' }, a.ctx(), ports);
    const viewer = userCtx(a.viewerId, a.org.id);
    expect((await executeQuery(agendaQuery, { eventId: ev.id }, viewer, ports)).sessions).toHaveLength(1);
    await expect(
      executeQuery(
        agendaImportPreviewQuery,
        { eventId: ev.id, csv: 'title,starts,ends\nA,2030-05-01 09:00,2030-05-01 10:00' },
        viewer,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    for (const [cmd, input] of [
      [createSessionTypeCommand, { eventId: ev.id, name: 'X' }],
      [addStandardSessionTypesCommand, { eventId: ev.id, names: ['X'] }],
      [deleteSessionTypeCommand, { eventId: ev.id, typeId: t.id }],
      [createSessionGroupCommand, { eventId: ev.id, name: 'X' }],
      [deleteSessionGroupCommand, { eventId: ev.id, groupId: g.id }],
      [setSessionAgendaCommand, { eventId: ev.id, sessionId: s.id, admission: 'optional' }],
      [publishAgendaCommand, { eventId: ev.id }],
      [unpublishAgendaCommand, { eventId: ev.id }],
      [
        importAgendaCommand,
        { eventId: ev.id, csv: 'title,starts,ends\nA,2030-05-01 09:00,2030-05-01 10:00' },
      ],
    ] as const)
      await expect(executeCommand(cmd as never, input as never, viewer, ports)).rejects.toMatchObject({
        code: 'forbidden',
      });
  });

  it('another org can neither read nor change this agenda', async () => {
    const ev = await newEvent('Isolated');
    const s = await session(ev, 'Private talk', 1);
    const g = await executeCommand(createSessionGroupCommand, { eventId: ev.id, name: 'G' }, a.ctx(), ports);
    await expect(executeQuery(agendaQuery, { eventId: ev.id }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    for (const [cmd, input] of [
      [setSessionAgendaCommand, { eventId: ev.id, sessionId: s.id, admission: 'optional' }],
      [deleteSessionGroupCommand, { eventId: ev.id, groupId: g.id }],
      [publishAgendaCommand, { eventId: ev.id }],
      [
        importAgendaCommand,
        { eventId: ev.id, csv: 'title,starts,ends\nA,2030-05-01 09:00,2030-05-01 10:00' },
      ],
    ] as const)
      await expect(executeCommand(cmd as never, input as never, b.ctx(), ports)).rejects.toMatchObject({
        code: 'not_found',
      });
    // Raw SQL as org b sees none of org a's agenda rows.
    const rows = await withTenant(b.ctx(), (tx) =>
      tx.execute<{ n: number }>(sql`
        select (select count(*) from program.session_details where event_id = ${ev.id})
             + (select count(*) from program.session_groups where event_id = ${ev.id})::int as n`),
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('a revoked sessions module refuses the agenda commands', async () => {
    const ev = await newEvent('Module');
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'sessions', effect: 'revoke', reason: 'test' },
      systemCtx(a.org.id),
      ports,
    );
    try {
      for (const [cmd, input] of [
        [createSessionTypeCommand, { eventId: ev.id, name: 'X' }],
        [publishAgendaCommand, { eventId: ev.id }],
        [
          importAgendaCommand,
          { eventId: ev.id, csv: 'title,starts,ends\nA,2030-05-01 09:00,2030-05-01 10:00' },
        ],
      ] as const)
        await expect(executeCommand(cmd as never, input as never, a.ctx(), ports)).rejects.toMatchObject({
          code: 'module_not_enabled',
        });
    } finally {
      await executeCommand(
        setEntitlementOverrideCommand,
        { moduleKey: 'sessions', effect: 'grant', reason: 'test' },
        systemCtx(a.org.id),
        ports,
      );
    }
  });
});
