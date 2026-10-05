import { csvCell } from '@yayatoh/csv';
import { describe, expect, it } from 'vitest';
import {
  agendaCsvTime,
  agendaWarnings,
  type ExistingAgendaSession,
  formulaSafe,
  groupPickDecision,
  mapAgendaHeaders,
  parseAgendaTime,
  parseSpeakers,
  planAgendaImport,
  readAgendaRow,
} from '../src/domain/agenda.ts';

const TZ = 'America/Chicago';
const at = (iso: string) => new Date(iso);

describe('pick-one groups (M5.2a)', () => {
  // The fixture group: three parallel workshops.
  const group = { sessionIds: ['w1', 'w2', 'w3'] };

  it('allows exactly one pick in the fixture group', () => {
    expect(groupPickDecision(group, [], 'w1')).toEqual({ ok: true, alreadyHeld: false });
    // Holding w1, every other session of the group is refused.
    expect(groupPickDecision(group, ['w1'], 'w2')).toEqual({ ok: false, reason: 'one_per_group' });
    expect(groupPickDecision(group, ['w1'], 'w3')).toEqual({ ok: false, reason: 'one_per_group' });
    // Taking the held one again is a no-op, not a second pick.
    expect(groupPickDecision(group, ['w1'], 'w1')).toEqual({ ok: true, alreadyHeld: true });
    const picks = ['w1', 'w2', 'w3'].filter(
      (id, i, all) =>
        groupPickDecision(
          group,
          all.slice(0, i).filter((x) => x === 'w1'),
          id,
        ).ok,
    );
    expect(picks).toEqual(['w1']);
  });

  it('ignores sessions outside the group and refuses a session that is not in it', () => {
    expect(groupPickDecision(group, ['keynote', 'other-group-session'], 'w2')).toEqual({
      ok: true,
      alreadyHeld: false,
    });
    expect(groupPickDecision(group, [], 'keynote')).toEqual({ ok: false, reason: 'not_in_group' });
  });
});

describe('agenda warnings (M5.2a)', () => {
  const s = (
    id: string,
    from: string,
    to: string,
    extra: Partial<Parameters<typeof agendaWarnings>[0][0]> = {},
  ) => ({
    id,
    startsAt: at(from),
    endsAt: at(to),
    roomId: null,
    capacity: null,
    groupId: null,
    ...extra,
  });
  const rooms = [
    { id: 'small', capacity: 40 },
    { id: 'open', capacity: null },
  ];

  it('warns when a room is smaller than the session capacity (and only then)', () => {
    const w = agendaWarnings(
      [
        s('big', '2030-05-01T14:00:00Z', '2030-05-01T15:00:00Z', { roomId: 'small', capacity: 60 }),
        s('fits', '2030-05-01T16:00:00Z', '2030-05-01T17:00:00Z', { roomId: 'small', capacity: 40 }),
        s('no-cap', '2030-05-01T18:00:00Z', '2030-05-01T19:00:00Z', { roomId: 'small' }),
        s('open-room', '2030-05-01T18:00:00Z', '2030-05-01T19:00:00Z', { roomId: 'open', capacity: 900 }),
        s('no-room', '2030-05-01T18:00:00Z', '2030-05-01T19:00:00Z', { capacity: 900 }),
      ],
      rooms,
    );
    expect(w).toEqual([
      { kind: 'room_too_small', sessionId: 'big', roomId: 'small', roomCapacity: 40, sessionCapacity: 60 },
    ]);
  });

  it('warns about a grouped session that overlaps none of its group', () => {
    const w = agendaWarnings(
      [
        s('a', '2030-05-01T14:00:00Z', '2030-05-01T15:00:00Z', { groupId: 'g' }),
        s('b', '2030-05-01T14:30:00Z', '2030-05-01T15:30:00Z', { groupId: 'g' }),
        // Back to back with b (half-open): no overlap.
        s('late', '2030-05-01T15:30:00Z', '2030-05-01T16:00:00Z', { groupId: 'g' }),
        s('alone', '2030-05-01T09:00:00Z', '2030-05-01T10:00:00Z', { groupId: 'solo' }),
      ],
      rooms,
    );
    expect(w).toEqual([{ kind: 'group_not_overlapping', sessionId: 'late', groupId: 'g' }]);
  });
});

describe('agenda CSV rows (M5.2a)', () => {
  const headers = [
    'Key',
    'Title',
    'Starts',
    'Ends',
    'Type',
    'Admission',
    'Capacity',
    'Room',
    'Track',
    'Group',
    'Speakers',
    'Description',
  ];
  const { columns } = mapAgendaHeaders(headers);
  const row = (over: Partial<Record<string, string>> = {}) => {
    const base: Record<string, string> = {
      key: 'W-1',
      title: 'Hands-on AI',
      starts: '2030-05-01 09:00',
      ends: '2030-05-01 10:30',
      type: 'Workshop',
      admission: 'optional',
      capacity: '40',
      room: 'Room B',
      track: 'Build',
      group: 'Morning pick',
      speakers: 'Ada Lovelace <ADA@example.org>; grace@example.org',
      description: 'Bring a **laptop**.',
      ...over,
    };
    return headers.map((h) => base[h.toLowerCase()] ?? '');
  };

  it('maps headers in any case and order and names the missing required ones', () => {
    expect(mapAgendaHeaders(['ENDS', ' title ', 'x']).missing).toEqual(['starts']);
    expect(columns.speakers).toBe(10);
  });

  it('reads a valid row: wall-clock times in the event timezone, speakers by email', () => {
    const r = readAgendaRow(row(), columns, TZ);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.startsAt.toISOString()).toBe('2030-05-01T14:00:00.000Z');
    expect(r.row.endsAt.toISOString()).toBe('2030-05-01T15:30:00.000Z');
    expect(r.row.speakers).toEqual([
      { email: 'ada@example.org', name: 'Ada Lovelace' },
      { email: 'grace@example.org', name: null },
    ]);
    expect(r.row).toMatchObject({ admission: 'optional', capacity: 40, group: 'Morning pick', key: 'W-1' });
  });

  it('defaults admission to included and accepts the T separator', () => {
    const r = readAgendaRow(row({ admission: '', group: '', starts: '2030-05-01T09:00' }), columns, TZ);
    expect(r.ok && r.row.admission).toBe('included');
  });

  it('reports every problem of a bad row', () => {
    const r = readAgendaRow(
      row({
        title: '',
        starts: '2030-02-30 09:00',
        ends: 'noon',
        admission: 'maybe',
        capacity: '0',
        speakers: 'not-an-email',
      }),
      columns,
      TZ,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect([...r.errors].sort()).toEqual(
      [
        'invalid_admission',
        'invalid_capacity',
        'invalid_ends',
        'invalid_speaker',
        'invalid_starts',
        'missing_title',
      ].sort(),
    );
    const order = readAgendaRow(row({ ends: '2030-05-01 08:00' }), columns, TZ);
    expect(!order.ok && order.errors).toEqual(['ends_before_starts']);
    const grouped = readAgendaRow(row({ admission: 'included' }), columns, TZ);
    expect(!grouped.ok && grouped.errors).toEqual(['group_needs_optional']);
    const long = readAgendaRow(row({ title: 'x'.repeat(161) }), columns, TZ);
    expect(!long.ok && long.errors).toEqual(['too_long']);
  });

  it('refuses formula-like cells (CSV injection) and reads back csvCell-escaped text', () => {
    for (const bad of ['=HYPERLINK("http://evil")', '+1+1', '@SUM(A1)', '-2+3'])
      expect(readAgendaRow(row({ title: bad }), columns, TZ)).toEqual({ ok: false, errors: ['formula'] });
    expect(readAgendaRow(row({ room: '=cmd' }), columns, TZ)).toEqual({ ok: false, errors: ['formula'] });
    expect(readAgendaRow(row({ speakers: '=x@y.z' }), columns, TZ)).toEqual({
      ok: false,
      errors: ['formula'],
    });
    expect(formulaSafe('- Coffee')).toEqual({ ok: true, value: '- Coffee' });
    // Our own exports escape with an apostrophe: the text comes back unchanged.
    expect(csvCell('=Plan B')).toBe("'=Plan B");
    expect(formulaSafe("'=Plan B")).toEqual({ ok: true, value: '=Plan B' });
    expect(formulaSafe("'Rock'n'roll")).toEqual({ ok: true, value: "'Rock'n'roll" });
  });

  it('parses times across DST and refuses impossible ones', () => {
    // 2030-03-10 is the spring-forward day in Chicago: 02:30 does not exist and moves forward.
    expect(parseAgendaTime('2030-03-10 02:30', TZ)?.toISOString()).toBe('2030-03-10T08:30:00.000Z');
    expect(parseAgendaTime('2030-07-01 09:00', TZ)?.toISOString()).toBe('2030-07-01T14:00:00.000Z');
    expect(parseAgendaTime('2030-13-01 09:00', TZ)).toBeNull();
    expect(parseAgendaTime('2030-05-01 24:00', TZ)).toBeNull();
    expect(parseAgendaTime('05/01/2030 9am', TZ)).toBeNull();
    expect(agendaCsvTime(at('2030-07-01T14:00:00Z'), TZ)).toBe('2030-07-01 09:00');
  });

  it('parses speaker lists', () => {
    expect(parseSpeakers('')).toEqual([]);
    expect(parseSpeakers('a@x.io | B <b@x.io> ; a@x.io')).toEqual([
      { email: 'a@x.io', name: null },
      { email: 'b@x.io', name: 'B' },
    ]);
    expect(parseSpeakers('Ada <nope>')).toBeNull();
  });
});

describe('agenda import plan (M5.2a)', () => {
  const headers = ['key', 'title', 'starts', 'ends', 'admission', 'group', 'capacity', 'speakers'];
  const existing = (over: Partial<ExistingAgendaSession> = {}): ExistingAgendaSession => ({
    id: 's1',
    key: 'K1',
    title: 'Keynote',
    startsAt: at('2030-05-01T14:00:00Z'),
    endsAt: at('2030-05-01T15:00:00Z'),
    type: null,
    admission: 'included',
    capacity: null,
    room: null,
    track: null,
    group: null,
    speakerEmails: ['ada@x.io'],
    description: '',
    occurrence: null,
    locked: false,
    ...over,
  });
  const plan = (rows: string[][], sessions: ExistingAgendaSession[] = [existing()], emails = ['ada@x.io']) =>
    planAgendaImport(rows, headers, TZ, { sessions, speakerEmails: new Set(emails) }).map((p) =>
      p.action === 'error' ? [p.line, p.action, p.errors] : [p.line, p.action],
    );

  it('creates, updates and leaves unchanged; matching by key, else by title and start', () => {
    expect(
      plan([
        ['K1', 'Keynote', '2030-05-01 09:00', '2030-05-01 10:00', '', '', '', 'ada@x.io'],
        ['', 'Lunch', '2030-05-01 12:00', '2030-05-01 13:00', '', '', '', ''],
        ['', 'Keynote', '2030-05-01 09:00', '2030-05-01 10:30', '', '', '', 'ada@x.io'],
      ]),
    ).toEqual([
      [2, 'unchanged'],
      [3, 'create'],
      // No key: matched by title and start; its end moved.
      [4, 'update'],
    ]);
  });

  it('flags duplicates, unknown speakers, dates and enrollments', () => {
    expect(
      plan(
        [
          ['K2', 'A', '2030-05-01 09:00', '2030-05-01 10:00', '', '', '', ''],
          ['k2', 'B', '2030-05-01 09:00', '2030-05-01 10:00', '', '', '', ''],
          ['', 'C', '2030-05-01 09:00', '2030-05-01 10:00', '', '', '', ''],
          ['', 'c', '2030-05-01 09:00', '2030-05-01 11:00', '', '', '', ''],
          ['', 'D', '2030-05-01 09:00', '2030-05-01 10:00', '', '', '', 'who@x.io'],
          ['', 'E', '2030-05-01 09:00', '2030-05-01 10:00', '', '', '', 'New Person <new@x.io>'],
        ],
        [],
      ),
    ).toEqual([
      [2, 'create'],
      [3, 'error', ['duplicate_key']],
      [4, 'create'],
      [5, 'error', ['duplicate_row']],
      [6, 'error', ['unknown_speaker']],
      [7, 'create'],
    ]);
    const dated = existing({
      occurrence: { startsAt: at('2030-05-01T13:00:00Z'), endsAt: at('2030-05-01T16:00:00Z') },
    });
    expect(
      plan([['K1', 'Keynote', '2030-05-01 10:30', '2030-05-01 11:30', '', '', '', 'ada@x.io']], [dated]),
    ).toEqual([[2, 'error', ['outside_date']]]);
    const locked = existing({ admission: 'optional', capacity: 50, locked: true });
    expect(
      plan(
        [['K1', 'Keynote', '2030-05-01 09:00', '2030-05-01 10:00', 'optional', '', '20', 'ada@x.io']],
        [locked],
      ),
    ).toEqual([[2, 'error', ['has_enrollments']]]);
  });
});
