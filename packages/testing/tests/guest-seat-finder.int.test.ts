import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, type EventDto } from '@yayatoh/events';
import { quickLayout } from '@yayatoh/floorplan';
import {
  addPartyGuestCommand,
  addPlusOneCommand,
  createPartyCommand,
  createRsvpLinksCommand,
  createSubEventCommand,
  partyRsvpQuery,
  recordSubEventResponseCommand,
  resetRsvpLinkCommand,
  resetRsvpPinCommand,
  setInvitationsCommand,
} from '@yayatoh/guests';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  findGuestSeatByPinCommand,
  partySeatsQuery,
  publicVenueMapQuery,
  seatGuestsCommand,
  setEventLayoutCommand,
  setFinderSettingsCommand,
} from '@yayatoh/seating';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs } from '../src/index.ts';

/**
 * M4.4a guest seat finder: a party signed in through its own link sees its tables and its
 * tablemates (P4-3 d); PIN mode (exact full name + the party's PIN) answers with table labels and
 * counts only; every miss is one answer after the same work, so nobody can tell whether a name is
 * on the list (acceptance: "Unauthenticated lookups never show names; there is no enumeration").
 */

let a: OrgFixture;
let b: OrgFixture;

const guest = (orgId: string) => createCtx({ orgId });
const NAMES = ['Luis', 'Ana', 'Mei', 'Jun', 'Ada', 'Garcia', 'Chen', 'Okafor', 'Kai'];

/** A wedding with two tables, three parties, a reception and RSVP links for every party. */
async function wedding(f: OrgFixture, name: string) {
  const ev: EventDto = await executeCommand(
    createEventCommand,
    {
      name: `${name} ${f.org.slug} ${Date.now()}`,
      profile: 'wedding',
      timezone: 'America/Chicago',
      startsAt: '2030-06-01T20:00:00Z',
      endsAt: '2030-06-02T04:00:00Z',
    },
    f.ctx(),
    ports,
  );
  const doc = quickLayout({ rows: 0, seatsPerRow: 1, tables: 2, seatsPerTable: 6, stage: false });
  await executeCommand(setEventLayoutCommand, { eventId: ev.id, doc }, f.ctx(), ports);
  const [t1 = '', t2 = ''] = doc.items.map((i) => i.id);
  const party = (n: string, envelopeName?: string) =>
    executeCommand(createPartyCommand, { eventId: ev.id, name: n, envelopeName }, f.ctx(), ports);
  const garcia = await party('Garcia', 'The Garcia Family');
  const chen = await party('Chen');
  const okafor = await party('Okafor');
  const add = (partyId: string, firstName: string, lastName: string) =>
    executeCommand(addPartyGuestCommand, { eventId: ev.id, partyId, firstName, lastName }, f.ctx(), ports);
  const luis = await add(garcia.id, 'Luis', 'Garcia');
  const plus = await executeCommand(
    addPlusOneCommand,
    { eventId: ev.id, hostGuestId: luis.id },
    f.ctx(),
    ports,
  );
  const ana = await add(garcia.id, 'Ana', 'Garcia');
  const mei = await add(chen.id, 'Mei', 'Chen');
  const jun = await add(chen.id, 'Jun', 'Chen');
  const ada = await add(okafor.id, 'Ada', 'Okafor');
  const kai = await add(okafor.id, 'Kai', 'Okafor');
  await executeCommand(createRsvpLinksCommand, { eventId: ev.id }, f.ctx(), ports);
  const detail = (partyId: string) =>
    executeQuery(partyRsvpQuery, { eventId: ev.id, partyId }, f.ctx(), ports);
  const seat = (itemId: string, guestIds: string[], subEventId: string | null = null) =>
    executeCommand(seatGuestsCommand, { eventId: ev.id, subEventId, itemId, guestIds }, f.ctx(), ports);
  const open = (mode: 'code' | 'name' | 'pin', publicMap = true) =>
    executeCommand(setFinderSettingsCommand, { eventId: ev.id, publicMap, mode }, f.ctx(), ports);
  return { ev, t1, t2, garcia, chen, okafor, luis, plus, ana, mei, jun, ada, kai, detail, seat, open };
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});

afterAll(async () => {
  await closePools();
});

describe('a party signed in through its link (M4.4a)', () => {
  it('sees nothing about tables until the organizer opens the seat finder', async () => {
    const w = await wedding(a, 'Closed');
    await w.seat(w.t1, [w.luis.id, w.plus.id, w.ana.id]);
    const { token } = await w.detail(w.garcia.id);
    const closed = await executeQuery(partySeatsQuery, { token: token as string }, guest(a.org.id), ports);
    expect(closed).toMatchObject({ state: 'closed', partyName: 'The Garcia Family', charts: [] });
    expect(closed.eventSlug).toBe(w.ev.slug);
  });

  it('sees its tables, who of the party sits where, and its tablemates as the host named them', async () => {
    const w = await wedding(a, 'Tablemates');
    await w.seat(w.t1, [w.luis.id, w.plus.id, w.mei.id, w.jun.id]);
    await w.seat(w.t2, [w.ada.id]);
    await executeCommand(
      recordSubEventResponseCommand,
      {
        eventId: w.ev.id,
        guestId: w.jun.id,
        subEventId: (await reception(w)).id,
        status: 'declined',
        source: 'paper',
      },
      a.ctx(),
      ports,
    );
    await w.open('code');
    const { token } = await w.detail(w.garcia.id);
    const v = await executeQuery(partySeatsQuery, { token: token as string }, guest(a.org.id), ports);
    expect(v.state).toBe('open');
    const plan = v.charts.find((c) => c.subEventId === null);
    expect(plan?.places.map((p) => [p.itemKind, p.itemLabel])).toEqual([['table', '1']]);
    expect(plan?.places[0]?.guests.map((g) => g.name ?? `guest of ${g.guestOf}`)).toEqual([
      'Luis Garcia',
      'guest of Luis Garcia',
    ]);
    // Jun declined (every sub-event he's invited to): he won't be there, so he is nobody's tablemate.
    expect(plan?.places[0]?.tablemates).toEqual([{ name: 'Mei Chen', guestOf: null }]);
    expect(plan?.unseated.map((g) => g.name)).toEqual(['Ana Garcia']);
    // The map is the plan as drawn: the table is in it, nobody's name is.
    expect(plan?.doc.items.some((i) => i.id === w.t1)).toBe(true);
    expect(JSON.stringify(plan?.doc)).not.toMatch(/Garcia|Chen|Okafor/);
    // The Reception (Luis and his plus-one invited) has no places yet: nothing to show for it.
    expect(v.charts.map((c) => c.subEventId)).toEqual([null]);
    // Okafor sees Ada alone at table 2 and Kai waiting; no other party's names.
    const ok = await executeQuery(
      partySeatsQuery,
      { token: (await w.detail(w.okafor.id)).token as string },
      guest(a.org.id),
      ports,
    );
    const okPlan = ok.charts.find((c) => c.subEventId === null);
    expect(okPlan?.places.map((p) => [p.itemLabel, p.tablemates.length])).toEqual([['2', 0]]);
    expect(okPlan?.unseated.map((g) => g.name)).toEqual(['Kai Okafor']);
  });

  it('a sub-event seated on its own shows as its own chart, named', async () => {
    const w = await wedding(a, 'Sub-event');
    const rec = await reception(w);
    await w.seat(w.t2, [w.luis.id, w.plus.id, w.mei.id], rec.id);
    await w.open('pin');
    const { token, pin } = await w.detail(w.garcia.id);
    const v = await executeQuery(partySeatsQuery, { token: token as string }, guest(a.org.id), ports);
    // Nobody is seated on the event plan: only the Reception, with Mei as the tablemate.
    expect(v.charts.map((c) => [c.name, c.places.map((p) => p.itemLabel)])).toEqual([['Reception', ['2']]]);
    expect(v.charts[0]?.places[0]?.tablemates).toEqual([{ name: 'Mei Chen', guestOf: null }]);
    const r = await executeCommand(
      findGuestSeatByPinCommand,
      { eventId: w.ev.id, name: 'Ana Garcia', pin: pin as string, device: `sub-${Date.now()}`, human: false },
      guest(a.org.id),
      ports,
    );
    expect(r.result?.charts.map((c) => [c.name, c.places.map((p) => [p.itemLabel, p.count])])).toEqual([
      ['Reception', [['2', 2]]],
    ]);
  });

  it('a link works for its own party only; a reset or forged link, or another org, finds nothing', async () => {
    const w = await wedding(a, 'Links');
    await w.open('pin');
    const { token } = await w.detail(w.garcia.id);
    const read = (t: string, orgId = a.org.id) =>
      executeQuery(partySeatsQuery, { token: t }, guest(orgId), ports);
    expect((await read(token as string)).partyName).toBe('The Garcia Family');
    await expect(read(token as string, b.org.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(read(`${token}x`)).rejects.toMatchObject({ code: 'not_found' });
    await expect(read('not-a-real-token-at-all')).rejects.toMatchObject({ code: 'not_found' });
    await executeCommand(resetRsvpLinkCommand, { eventId: w.ev.id, partyId: w.garcia.id }, a.ctx(), ports);
    await expect(read(token as string)).rejects.toMatchObject({ code: 'not_found' });
    const fresh = (await w.detail(w.garcia.id)).token as string;
    expect((await read(fresh)).state).toBe('open');
  });
});

/** The wedding's reception, inviting Luis, Mei and Jun (created on first use). */
const receptions = new Map<string, { id: string }>();
async function reception(w: Awaited<ReturnType<typeof wedding>>) {
  const known = receptions.get(w.ev.id);
  if (known) return known;
  const r = await executeCommand(
    createSubEventCommand,
    {
      eventId: w.ev.id,
      name: 'Reception',
      kind: 'reception',
      startsAt: '2030-06-01T22:00:00Z',
      endsAt: '2030-06-02T02:00:00Z',
    },
    a.ctx(),
    ports,
  );
  await executeCommand(
    setInvitationsCommand,
    {
      eventId: w.ev.id,
      subEventIds: [r.id],
      target: { kind: 'guests', guestIds: [w.luis.id, w.mei.id, w.jun.id] },
      invited: true,
    },
    a.ctx(),
    ports,
  );
  receptions.set(w.ev.id, r);
  return r;
}

describe('PIN mode (M4.4a)', () => {
  const lookup = (
    w: Awaited<ReturnType<typeof wedding>>,
    name: string,
    pin: string,
    device = 'dev-1',
    human = false,
  ) =>
    executeCommand(
      findGuestSeatByPinCommand,
      { eventId: w.ev.id, name, pin, device, human },
      guest(a.org.id),
      ports,
    );

  it('the exact full name and the PIN give table labels and counts, never a name', async () => {
    const w = await wedding(a, 'Pin found');
    await w.seat(w.t2, [w.luis.id, w.plus.id, w.mei.id]);
    await w.open('pin');
    const { pin } = await w.detail(w.garcia.id);
    const r = await lookup(w, '  ana   GARCIA ', pin as string, `found-${Date.now()}`);
    expect(r.status).toBe('found');
    const plan = r.result?.charts[0];
    expect(plan?.places.map((p) => [p.itemKind, p.itemLabel, p.count])).toEqual([['table', '2', 2]]);
    expect(plan?.unseated).toBe(1);
    expect(JSON.stringify(r)).not.toMatch(new RegExp(NAMES.join('|')));
  });

  it('every miss is the same answer after the same work: no enumeration', async () => {
    const w = await wedding(a, 'Pin miss');
    await w.seat(w.t1, [w.luis.id]);
    await w.open('pin');
    const { pin } = await w.detail(w.garcia.id);
    const wrongPin = String((Number(pin) + 1) % 1_000_000).padStart(6, '0');
    const miss = { status: 'no_match', result: null };
    let n = 0;
    for (const [name, p] of <[string, string][]>[
      ['Luis Garcia', wrongPin], // right name, wrong PIN
      ['Luis', pin as string], // partial name
      ['Garcia', pin as string],
      ['Luís Garcia', pin as string], // misspelled
      ['Nobody Here', pin as string], // unknown name
      ['Mei Chen', pin as string], // another party's guest with this PIN
      ['Luis Garcia', 'abc'], // malformed PIN
    ])
      expect(await lookup(w, name, p, `miss-${n++}`), `${name}/${p}`).toEqual(miss);

    const time = async (name: string, p: string) => {
      const runs: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        await lookup(w, name, p, `time-${name}-${i}`);
        runs.push(performance.now() - t0);
      }
      return runs.sort((x, y) => x - y)[2] as number;
    };
    const unknown = await time('Nobody Here', wrongPin);
    const wrong = await time('Luis Garcia', wrongPin);
    expect(Math.max(unknown, wrong) / Math.min(unknown, wrong)).toBeLessThan(4);

    // A new PIN: the printed one stops working.
    await executeCommand(resetRsvpPinCommand, { eventId: w.ev.id, partyId: w.garcia.id }, a.ctx(), ports);
    expect(await lookup(w, 'Luis Garcia', pin as string, 'reset-1')).toEqual(miss);
    const fresh = (await w.detail(w.garcia.id)).pin as string;
    expect((await lookup(w, 'Luis Garcia', fresh, 'reset-2')).status).toBe('found');
  });

  it('past the device budget a human check comes first; other devices are not affected', async () => {
    const w = await wedding(a, 'Pin limit');
    await w.open('pin');
    const device = `limit-${Date.now()}`;
    for (let i = 0; i < 30; i++)
      expect((await lookup(w, 'Nobody Here', '123456', device)).status).toBe('no_match');
    expect(await lookup(w, 'Nobody Here', '123456', device)).toEqual({ status: 'challenge', result: null });
    expect((await lookup(w, 'Nobody Here', '123456', device, true)).status).toBe('no_match');
    expect((await lookup(w, 'Nobody Here', '123456', `${device}-other`)).status).toBe('no_match');
  });

  it('is refused unless the finder is open in PIN mode', async () => {
    const w = await wedding(a, 'Pin closed');
    const { pin } = await w.detail(w.garcia.id);
    await expect(lookup(w, 'Luis Garcia', pin as string)).rejects.toMatchObject({ code: 'not_found' });
    await w.open('pin', false);
    await expect(lookup(w, 'Luis Garcia', pin as string)).rejects.toMatchObject({ code: 'not_found' });
    await w.open('code');
    await expect(lookup(w, 'Luis Garcia', pin as string)).rejects.toMatchObject({ code: 'invalid_state' });
    await w.open('name');
    await expect(lookup(w, 'Luis Garcia', pin as string)).rejects.toMatchObject({ code: 'invalid_state' });
    // Another org's event id is unknown in this org.
    await w.open('pin');
    await expect(
      executeCommand(
        findGuestSeatByPinCommand,
        { eventId: w.ev.id, name: 'Luis Garcia', pin: pin as string, device: 'x', human: false },
        guest(b.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('the public venue map says how lookups work and never who sits where', async () => {
    const w = await wedding(a, 'Pin map');
    await w.seat(w.t1, [w.luis.id, w.mei.id]);
    await w.open('pin');
    const map = await executeQuery(publicVenueMapQuery, { eventId: w.ev.id }, guest(a.org.id), ports);
    expect(map?.mode).toBe('pin');
    expect(JSON.stringify(map)).not.toMatch(new RegExp(NAMES.join('|')));
  });
});
